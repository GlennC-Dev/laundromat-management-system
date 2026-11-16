import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

const now = new Date().toISOString();
const ticket = (over: Record<string, unknown>) => ({
  id: "t1",
  kind: "machine",
  machine_id: "m1",
  level: "cleaner",
  status: "completed",
  started_at: now,
  ends_at: now,
  completed_at: now,
  service_price: 100,
  total: 130,
  amount_paid: 130,
  payment_method: "gcash",
  reference_no: "GC123",
  detergent_qty: 1,
  detergent_unit_price: 20,
  fabcon_qty: 0,
  fabcon_unit_price: 0,
  extra_spin_count: 1,
  spin_unit_price: 10,
  extra_dry_minutes: 0,
  dry_ext_unit_price: 0,
  voided_at: null,
  void_reason: null,
  ...over,
});

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ["/history"] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Admin ticket browser", () => {
  beforeEach(() => {
    authMock.session = fakeSession("boss@example.com");
    setProfile("admin");
    supabaseMock.rpc.mockClear();
    supabaseMock.rpc.mockImplementation((async () => ({ data: [], error: null })) as never);
    dbMock.tables["machines"] = [
      { id: "m1", label: "W2", type: "wash", capacity_kg: 8, active: true, status: "available" },
    ];
    dbMock.tables["tickets"] = [
      ticket({}),
      ticket({
        id: "t2",
        kind: "counter",
        machine_id: null,
        level: null,
        service_price: null,
        total: 40,
      }),
      ticket({ id: "t3", voided_at: now, void_reason: "duplicate" }),
    ];
  });

  it("lists tickets and shows an itemised breakdown", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findAllByText("W2", { exact: false })).not.toHaveLength(0);
    expect(screen.getByText("Counter sale")).toBeInTheDocument();
    expect(screen.getByText("Voided")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /open w2 ticket/i })[0]!);
    expect(await screen.findByText("8 kg cleaner")).toBeInTheDocument();
    expect(screen.getByText("Detergent × 1")).toBeInTheDocument();
    expect(screen.getByText(/ref GC123/)).toBeInTheDocument();
  });

  it("voids a ticket with just a reason", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /open w2 ticket/i }))[0]!);
    await user.click(await screen.findByRole("button", { name: "Void ticket" }));
    await user.type(screen.getByLabelText("Reason"), "customer cancelled");
    await user.click(screen.getByRole("button", { name: "Void ticket" }));
    expect(supabaseMock.rpc).toHaveBeenCalledWith("void_ticket", {
      p_ticket_id: "t1",
      p_reason: "customer cancelled",
    });
  });
});
