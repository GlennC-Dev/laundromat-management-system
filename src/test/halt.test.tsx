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

const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
const inMin = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

const job = (startedSecondsAgo: number) => ({
  id: "t1",
  machine_id: "m1",
  kind: "machine",
  level: "clean",
  status: "pending",
  started_at: ago(startedSecondsAgo),
  ends_at: inMin(25),
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
});

function setup(startedSecondsAgo: number) {
  authMock.session = fakeSession("attendant@example.com");
  setProfile("staff");
  supabaseMock.rpc.mockClear();
  supabaseMock.rpc.mockImplementation((async () => ({ data: [], error: null })) as never);
  dbMock.tables["machines"] = [
    { id: "m1", label: "W1", type: "wash", capacity_kg: 8, active: true, status: "available" },
  ];
  dbMock.tables["tickets"] = [job(startedSecondsAgo)];
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

describe("Halt", () => {
  beforeEach(() => vi.clearAllMocks());

  it("halts a job inside the first minute with a reason and no admin", async () => {
    const user = userEvent.setup();
    setup(20);
    await user.click(await screen.findByRole("button", { name: "Open ticket on W1" }));
    await user.click(await screen.findByRole("button", { name: /Halt job \(\d+s left\)/ }));

    const confirm = screen.getByRole("button", { name: "Halt job" });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Machine error" }));
    await user.type(screen.getByLabelText("Note (optional)"), "door sensor");
    await user.click(confirm);

    expect(supabaseMock.rpc).toHaveBeenCalledWith("halt_ticket", {
      p_ticket_id: "t1",
      p_reason: "machine_error",
      p_note: "door sensor",
    });
    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled();
  });

  it("needs a description when the reason is Other", async () => {
    const user = userEvent.setup();
    setup(10);
    await user.click(await screen.findByRole("button", { name: "Open ticket on W1" }));
    await user.click(await screen.findByRole("button", { name: /Halt job \(\d+s left\)/ }));
    await user.click(screen.getByRole("radio", { name: "Other" }));
    expect(screen.getByRole("button", { name: "Halt job" })).toBeDisabled();
    await user.type(screen.getByLabelText("What happened?"), "smoke");
    expect(screen.getByRole("button", { name: "Halt job" })).toBeEnabled();
  });

  it("after the first minute it becomes a void that needs admin approval", async () => {
    const user = userEvent.setup();
    setup(120);
    await user.click(await screen.findByRole("button", { name: "Open ticket on W1" }));
    expect(screen.queryByRole("button", { name: /Halt job/ })).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: /Void this ticket \(admin approval\)/ }),
    );
    expect(await screen.findByLabelText("Admin password")).toBeInTheDocument();
  });
});
