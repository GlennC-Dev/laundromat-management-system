import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/lib/auth";
import { formatDuration, runState } from "@/lib/tickets";
import { paymentSchema } from "@/components/ticket/payment-form";
import { routes } from "@/router";
import { authMock, dbMock, fakeSession, setProfile, supabaseMock } from "./supabase-mock";

vi.mock("@/lib/supabase", async () => {
  const { supabaseMock } = await import("./supabase-mock");
  return { supabase: supabaseMock };
});

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

function machine(id: string, label: string, type: "wash" | "dry", kg: number) {
  return {
    id,
    label,
    type,
    capacity_kg: kg,
    motor_kw: 0.5,
    element_kw: type === "dry" ? 8 : null,
    water_l_per_cycle: type === "wash" ? 44 : null,
    status: "available",
    active: true,
  };
}
function ticket(id: string, machine_id: string, level: string, endsInMin: number, total: number) {
  return {
    id,
    machine_id,
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
  };
}

function renderBoard() {
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Floor board", () => {
  beforeEach(() => {
    authMock.session = fakeSession("attendant@example.com");
    setProfile("staff");
    supabaseMock.rpc.mockClear();
    dbMock.tables["machines"] = [
      machine("m1", "W1", "wash", 8),
      machine("m2", "W2", "wash", 8),
      machine("m3", "D1", "dry", 12),
    ];
    dbMock.tables["tickets"] = [
      ticket("t1", "m2", "cleaner", 20.5, 110),
      ticket("t2", "m3", "dry", -5.5, 60),
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
  });

  it("shows free, running and done machines", async () => {
    renderBoard();

    expect(await screen.findByText("W1")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText(/20 min left/)).toBeInTheDocument();
    expect(screen.getByText(/done 5 min ago/)).toBeInTheDocument();
  });

  it("starts a machine through create_ticket", async () => {
    renderBoard();
    const free = (await screen.findByText("W1")).closest("div.rounded-xl") as HTMLElement;
    await userEvent.click(within(free).getByRole("button", { name: "Start" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: /clean.*₱80/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Start machine" }));

    expect(supabaseMock.rpc).toHaveBeenCalledWith("create_ticket", {
      p_machine_id: "m1",
      p_level: "clean",
      p_detergent_qty: 0,
      p_fabcon_qty: 0,
    });
  });

  it("opens the ticket for a running machine", async () => {
    renderBoard();
    await userEvent.click(await screen.findByRole("button", { name: "Open ticket on W2" }));

    expect(await screen.findByRole("button", { name: /Take payment/ })).toBeInTheDocument();
  });
});

describe("run state helpers", () => {
  it("derives done from the scheduled end", () => {
    expect(runState({ ends_at: new Date(1_000_000).toISOString() }, 400_000).kind).toBe("running");
    expect(runState({ ends_at: new Date(1_000_000).toISOString() }, 1_000_001).kind).toBe("done");
  });
  it("formats durations", () => {
    expect(formatDuration(30_000)).toBe("under 1 min");
    expect(formatDuration(25 * 60_000)).toBe("25 min");
    expect(formatDuration(75 * 60_000)).toBe("1 h 15 min");
  });
});

describe("paymentSchema", () => {
  it("needs a reference for non-cash methods only", () => {
    expect(paymentSchema.safeParse({ amount: "100", method: "cash", reference: "" }).success).toBe(
      true,
    );
    expect(paymentSchema.safeParse({ amount: "100", method: "gcash", reference: "" }).success).toBe(
      false,
    );
    expect(
      paymentSchema.safeParse({ amount: "100", method: "gcash", reference: "GC-1" }).success,
    ).toBe(true);
  });
  it("rejects a missing or negative amount", () => {
    expect(paymentSchema.safeParse({ amount: "", method: "cash", reference: "" }).success).toBe(
      false,
    );
    expect(paymentSchema.safeParse({ amount: "-5", method: "cash", reference: "" }).success).toBe(
      false,
    );
  });
});
