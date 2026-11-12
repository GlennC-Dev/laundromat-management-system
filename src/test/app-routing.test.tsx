import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/lib/auth";
import { routes } from "@/router";
import { authMock, fakeSession } from "./supabase-mock";

vi.mock("@/lib/supabase", async () => {
  const { authMock: auth } = await import("./supabase-mock");
  return { supabase: { auth } };
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

describe("App routing", () => {
  beforeEach(() => {
    authMock.session = null;
  });

  it("sends a signed-out visitor from / to the login page", async () => {
    renderAt("/");

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows the home page to a signed-in user", async () => {
    authMock.session = fakeSession("attendant@example.com");
    renderAt("/");

    expect(await screen.findByText("Signed in as attendant@example.com")).toBeInTheDocument();
  });

  it("sends a signed-in user away from the login page", async () => {
    authMock.session = fakeSession("attendant@example.com");
    renderAt("/login");

    expect(await screen.findByText("Signed in as attendant@example.com")).toBeInTheDocument();
  });

  it("renders the not-found page for an unknown path", () => {
    renderAt("/does-not-exist");

    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });
});
