import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/lib/auth";
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

describe("App routing", () => {
  beforeEach(() => {
    authMock.session = null;
    dbMock.tables = {};
  });

  it("sends a signed-out visitor from / to the login page", async () => {
    renderAt("/");

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows staff the floor board without the admin menu", async () => {
    authMock.session = fakeSession("attendant@example.com");
    setProfile("staff");
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "Floor board" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  });

  it("shows admins the setup menu", async () => {
    authMock.session = fakeSession("boss@example.com");
    setProfile("admin");
    renderAt("/");

    expect(await screen.findByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Machines" })).toBeInTheDocument();
  });

  it("tells a deactivated user they have no access", async () => {
    authMock.session = fakeSession("gone@example.com");
    setProfile("staff", false);
    renderAt("/");

    expect(await screen.findByText("This account has no access.")).toBeInTheDocument();
  });

  it("sends a signed-in user away from the login page", async () => {
    authMock.session = fakeSession("attendant@example.com");
    setProfile("staff");
    renderAt("/login");

    expect(await screen.findByRole("heading", { name: "Floor board" })).toBeInTheDocument();
  });

  it("renders the not-found page for an unknown path", () => {
    renderAt("/does-not-exist");

    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });
});
