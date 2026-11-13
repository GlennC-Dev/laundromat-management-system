import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/lib/auth";
import { machineSchema } from "@/pages/admin/machines";
import { routes } from "@/router";
import { authMock, dbMock, fakeSession, setProfile } from "./supabase-mock";

vi.mock("@/lib/supabase", async () => {
  const { supabaseMock } = await import("./supabase-mock");
  return { supabase: supabaseMock };
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Admin pages", () => {
  beforeEach(() => {
    authMock.session = fakeSession("boss@example.com");
    dbMock.tables = {};
  });

  it("keeps staff out of admin screens", async () => {
    setProfile("staff");
    renderAt("/machines");

    expect(await screen.findByRole("heading", { name: "Floor board" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Machines" })).not.toBeInTheDocument();
  });

  it("lists machines for an admin", async () => {
    setProfile("admin");
    dbMock.tables["machines"] = [
      {
        id: "m1",
        label: "W1",
        type: "wash",
        capacity_kg: 8,
        motor_kw: 0.56,
        element_kw: null,
        water_l_per_cycle: 44,
        status: "available",
        active: true,
      },
      {
        id: "m2",
        label: "D1",
        type: "dry",
        capacity_kg: 12,
        motor_kw: 0.37,
        element_kw: 7.8,
        water_l_per_cycle: null,
        status: "out_of_service",
        active: true,
      },
    ];
    renderAt("/machines");

    expect(await screen.findByText("W1")).toBeInTheDocument();
    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.getByText("Out of service")).toBeInTheDocument();
  });
});

describe("machineSchema", () => {
  const base = {
    label: "W1",
    type: "wash" as const,
    capacity_kg: "8",
    motor_kw: "0.56",
    element_kw: "",
    water_l_per_cycle: "44",
    status: "available" as const,
    active: true,
  };

  it("accepts a complete washer", () => {
    expect(machineSchema.safeParse(base).success).toBe(true);
  });

  it("requires water for a washer and heat for a dryer", () => {
    expect(machineSchema.safeParse({ ...base, water_l_per_cycle: "" }).success).toBe(false);
    expect(machineSchema.safeParse({ ...base, type: "dry" }).success).toBe(false);
    expect(machineSchema.safeParse({ ...base, type: "dry", element_kw: "7.8" }).success).toBe(true);
  });

  it("rejects a blank label and a zero capacity", () => {
    expect(machineSchema.safeParse({ ...base, label: " " }).success).toBe(false);
    expect(machineSchema.safeParse({ ...base, capacity_kg: "0" }).success).toBe(false);
  });
});
