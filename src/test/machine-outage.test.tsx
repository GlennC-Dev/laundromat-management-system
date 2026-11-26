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

const machine = (id: string, label: string, status = "available") => ({
  id,
  label,
  type: "wash",
  capacity_kg: 8,
  motor_kw: 0.5,
  element_kw: null,
  water_l_per_cycle: 44,
  status,
  active: true,
});

function setup(role: "staff" | "admin") {
  authMock.session = fakeSession(role === "admin" ? "boss@example.com" : "attendant@example.com");
  setProfile(role);
  supabaseMock.rpc.mockClear();
  supabaseMock.rpc.mockImplementation((async () => ({ data: [], error: null })) as never);
  supabaseMock.functions.invoke.mockClear();
  dbMock.tables["machines"] = [
    machine("m1", "W1"),
    machine("m2", "W2"),
    machine("m3", "W3", "out_of_service"),
  ];
  dbMock.tables["tickets"] = [
    {
      id: "t1",
      machine_id: "m2",
      order_id: null,
      kind: "machine",
      level: "clean",
      status: "pending",
      started_at: minutes(-5),
      ends_at: minutes(25),
      total: 80,
      service_price: 80,
      detergent_qty: 0,
      fabcon_qty: 0,
      extra_dry_minutes: 0,
      extra_spin_count: 0,
      dry_ext_unit_price: 0,
      spin_unit_price: 0,
      detergent_unit_price: 0,
      fabcon_unit_price: 0,
      voided_at: null,
    },
  ];
  dbMock.tables["orders"] = [];
  dbMock.tables["machine_outages"] = [
    {
      id: "o1",
      machine_id: "m3",
      reason: "waiting_for_parts",
      note: "New drum bearing ordered",
      started_at: minutes(-600),
      ended_at: null,
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

describe("Taking machines out of service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers it only on a free machine, and shows why one is down", async () => {
    setup("staff");
    expect(
      await screen.findByRole("button", { name: "Take W1 out of service" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Take W2 out of service" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for parts")).toBeInTheDocument();
    expect(screen.getByText("New drum bearing ordered")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bring W3 back" })).toBeInTheDocument();
  });

  it("lets an admin take a machine down with a reason, no password", async () => {
    const user = userEvent.setup();
    setup("admin");
    await user.click(await screen.findByRole("button", { name: "Take W1 out of service" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Admin email")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: "Maintenance" }));
    await user.type(within(dialog).getByLabelText(/Note/), "Oil the bearings");
    await user.click(within(dialog).getByRole("button", { name: "Take out of service" }));

    expect(supabaseMock.rpc).toHaveBeenCalledWith("take_machine_down", {
      p_machine_id: "m1",
      p_reason: "maintenance",
      p_note: "Oil the bearings",
    });
    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled();
  });

  it("asks staff for an admin's email and password first", async () => {
    const user = userEvent.setup();
    setup("staff");
    await user.click(await screen.findByRole("button", { name: "Take W1 out of service" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Take out of service" }));
    expect(await within(dialog).findByText("Enter the admin email")).toBeInTheDocument();
    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Admin email"), "boss@example.com");
    await user.type(within(dialog).getByLabelText("Admin password"), "secret-pass");
    await user.click(within(dialog).getByRole("button", { name: "Take out of service" }));

    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith("machine-override", {
      body: {
        machine_id: "m1",
        action: "down",
        reason: "broken",
        note: "",
        admin_email: "boss@example.com",
        admin_password: "secret-pass",
      },
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith("take_machine_down", expect.anything());
  });

  it("needs a description when the reason is Other", async () => {
    const user = userEvent.setup();
    setup("admin");
    await user.click(await screen.findByRole("button", { name: "Take W1 out of service" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Other" }));
    await user.click(within(dialog).getByRole("button", { name: "Take out of service" }));
    expect(await within(dialog).findByText("Describe the problem")).toBeInTheDocument();
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith("take_machine_down", expect.anything());
  });

  it("brings a machine back: admin directly, staff with approval", async () => {
    const user = userEvent.setup();
    setup("admin");
    await user.click(await screen.findByRole("button", { name: "Bring W3 back" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Bring back" }));
    expect(supabaseMock.rpc).toHaveBeenCalledWith("bring_machine_up", { p_machine_id: "m3" });
  });

  it("sends staff's bring-back through the override", async () => {
    const user = userEvent.setup();
    setup("staff");
    await user.click(await screen.findByRole("button", { name: "Bring W3 back" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Admin email"), "boss@example.com");
    await user.type(within(dialog).getByLabelText("Admin password"), "secret-pass");
    await user.click(within(dialog).getByRole("button", { name: "Bring back" }));
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith("machine-override", {
      body: {
        machine_id: "m3",
        action: "up",
        note: "",
        admin_email: "boss@example.com",
        admin_password: "secret-pass",
      },
    });
  });
});
