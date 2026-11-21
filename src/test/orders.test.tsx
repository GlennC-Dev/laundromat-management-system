import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/lib/auth";
import { routes } from "@/router";
import { authMock, dbMock, fakeSession, setProfile, supabaseMock } from "./supabase-mock";

vi.mock("@/lib/supabase", async () => {
  const { supabaseMock } = await import("./supabase-mock");
  return { supabase: supabaseMock };
});

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

const machine = (id: string, label: string, type: "wash" | "dry", kg: number) => ({
  id,
  label,
  type,
  capacity_kg: kg,
  motor_kw: 0.5,
  element_kw: type === "dry" ? 8 : null,
  water_l_per_cycle: type === "wash" ? 44 : null,
  status: "available",
  active: true,
});

const job = (id: string, machine_id: string, level: string, endsInMin: number, total: number) => ({
  id,
  machine_id,
  order_id: 45_000_000_001,
  kind: "machine",
  level,
  status: "pending",
  started_at: minutes(endsInMin - 30),
  ends_at: minutes(endsInMin),
  total,
  service_price: total,
  detergent_qty: 0,
  fabcon_qty: 0,
  extra_dry_minutes: 0,
  extra_spin_count: 0,
  dry_ext_unit_price: 0,
  spin_unit_price: 0,
  detergent_unit_price: 0,
  fabcon_unit_price: 0,
  voided_at: null,
});

function setup(jobs: ReturnType<typeof job>[]) {
  authMock.session = fakeSession("attendant@example.com");
  setProfile("staff");
  supabaseMock.rpc.mockClear();
  supabaseMock.rpc.mockImplementation((async () => ({ data: [], error: null })) as never);
  dbMock.tables["machines"] = [
    machine("m1", "W1", "wash", 8),
    machine("m2", "W2", "wash", 8),
    machine("m3", "D1", "dry", 12),
    machine("m4", "W3", "wash", 8),
  ];
  dbMock.tables["tickets"] = jobs;
  dbMock.tables["orders"] = [
    {
      id: 45_000_000_001,
      customer_name: "Maria Santos",
      phone: "09171234567",
      status: "open",
      opened_at: minutes(-90),
    },
    {
      id: 45_000_000_002,
      customer_name: "Jun Reyes",
      phone: "09181112222",
      status: "open",
      opened_at: minutes(-10),
    },
  ];
  dbMock.tables["price_list"] = [
    {
      id: "p1",
      kind: "service",
      code: null,
      machine_type: "wash",
      size_kg: 8,
      level: "clean",
      price: 80,
      default_minutes: 30,
      effective_from: "2025-01-01",
      created_at: "",
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Orders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the customer on each machine and lists open orders", async () => {
    setup([job("t1", "m2", "clean", -3, 80), job("t2", "m3", "dry", 20, 60)]);
    const strip = await screen.findByRole("region", { name: "Open orders" });
    expect(within(strip).getByText("Maria Santos")).toBeInTheDocument();
    expect(within(strip).getByText(/2 jobs · ₱140\.00/)).toBeInTheDocument();
    expect(screen.getAllByText("Maria Santos").length).toBeGreaterThan(2);
  });

  it("starts another job on an existing customer's order", async () => {
    const user = userEvent.setup();
    setup([job("t1", "m2", "clean", -3, 80)]);
    const free = (await screen.findByText("W1")).closest("div.rounded-xl") as HTMLElement;
    await user.click(within(free).getByRole("button", { name: "Start" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /Maria Santos/ }));
    expect(within(dialog).queryByLabelText("Name")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: /clean.*₱80/i }));
    await user.click(within(dialog).getByRole("button", { name: "Start machine" }));

    expect(supabaseMock.rpc).toHaveBeenCalledWith("create_ticket", {
      p_machine_id: "m1",
      p_level: "clean",
      p_detergent_qty: 0,
      p_fabcon_qty: 0,
      p_order_id: 45_000_000_001,
    });
  });

  it("will not take one payment for the order while a machine is still running", async () => {
    const user = userEvent.setup();
    setup([job("t1", "m2", "clean", -3, 80), job("t2", "m3", "dry", 20, 60)]);
    await user.click(await screen.findByRole("button", { name: "Open order for Maria Santos" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/D1 still running/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Pay entire order" }),
    ).not.toBeInTheDocument();
  });

  it("pays the entire order once every job has finished", async () => {
    const user = userEvent.setup();
    setup([job("t1", "m2", "clean", -10, 80), job("t2", "m3", "dry", -2, 60)]);
    await user.click(await screen.findByRole("button", { name: "Open order for Maria Santos" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/0917 123 4567/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Pay entire order" }));

    expect(supabaseMock.rpc).toHaveBeenCalledWith("pay_order", {
      p_order_id: 45_000_000_001,
      p_amount_paid: 140,
      p_payment_method: "cash",
    });
  });
});
