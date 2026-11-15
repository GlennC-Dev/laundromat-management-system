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
const base = {
  kind: "machine",
  level: "clean",
  machine_id: "m1",
  started_at: now,
  ends_at: now,
  payment_method: "cash",
  voided_at: null,
  void_reason: null,
};
const todays = [
  { ...base, id: "t1", status: "completed", total: 80, amount_paid: 80 },
  {
    ...base,
    id: "t2",
    status: "completed",
    total: 60,
    amount_paid: 60,
    voided_at: now,
    void_reason: "wrong machine",
  },
];

function setup(path: string, stock: { item: string; doses: number }[] = []) {
  supabaseMock.rpc.mockImplementation((async (fn: string) => {
    if (fn === "todays_tickets") return { data: todays, error: null };
    if (fn === "stock_levels") return { data: stock, error: null };
    return { data: [], error: null };
  }) as never);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Staff: today's tickets and void override", () => {
  beforeEach(() => {
    authMock.session = fakeSession("attendant@example.com");
    setProfile("staff");
    supabaseMock.rpc.mockClear();
    supabaseMock.functions.invoke.mockClear();
    dbMock.tables["machines"] = [
      { id: "m1", label: "W1", type: "wash", capacity_kg: 8, active: true, status: "available" },
    ];
  });

  it("lists today's tickets with a void button only on live ones", async () => {
    setup("/tickets");
    expect(await screen.findByText(/1 paid · ₱80\.00 collected/)).toBeInTheDocument();
    expect(screen.getByText("Voided")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /void w1 ticket/i })).toHaveLength(1);
  });

  it("asks staff for admin credentials and sends them to the override function", async () => {
    const user = userEvent.setup();
    setup("/tickets");
    await user.click(await screen.findByRole("button", { name: /void w1 ticket/i }));

    await user.type(screen.getByLabelText("Reason"), "rang up twice");
    await user.click(screen.getByRole("button", { name: "Void ticket" }));
    expect(await screen.findByText("Enter the admin email")).toBeInTheDocument();
    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Admin email"), "boss@example.com");
    await user.type(screen.getByLabelText("Admin password"), "secret-pass");
    await user.click(screen.getByRole("button", { name: "Void ticket" }));

    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith("void-override", {
      body: {
        ticket_id: "t1",
        reason: "rang up twice",
        admin_email: "boss@example.com",
        admin_password: "secret-pass",
      },
    });
  });

  it("lets an admin void with just a reason", async () => {
    setProfile("admin");
    const user = userEvent.setup();
    setup("/tickets");
    await user.click(await screen.findByRole("button", { name: /void w1 ticket/i }));
    expect(screen.queryByLabelText("Admin password")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Reason"), "test");
    await user.click(screen.getByRole("button", { name: "Void ticket" }));
    expect(supabaseMock.rpc).toHaveBeenCalledWith("void_ticket", {
      p_ticket_id: "t1",
      p_reason: "test",
    });
  });

  it("warns on the floor board when a supply is under 20 doses", async () => {
    setup("/", [
      { item: "detergent", doses: 19 },
      { item: "fabcon", doses: 0 },
    ]);
    expect(await screen.findByText("Detergent: 19 doses left")).toBeInTheDocument();
    expect(screen.getByText("Fabric conditioner: out of stock")).toBeInTheDocument();
  });

  it("stays quiet when stock is at 20 or more", async () => {
    setup("/", [{ item: "detergent", doses: 20 }]);
    await screen.findByText("Floor board");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
