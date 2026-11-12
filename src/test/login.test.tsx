import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/lib/auth";
import { routes } from "@/router";
import { authMock, fakeSession } from "./supabase-mock";

vi.mock("@/lib/supabase", async () => {
  const { authMock: auth } = await import("./supabase-mock");
  return { supabase: { auth } };
});

function renderLogin() {
  const router = createMemoryRouter(routes, { initialEntries: ["/login"] });
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

describe("Login page", () => {
  beforeEach(() => {
    authMock.session = null;
    authMock.signInWithPassword.mockReset();
  });

  it("asks for both fields before submitting", async () => {
    renderLogin();
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter your email")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(authMock.signInWithPassword).not.toHaveBeenCalled();
  });

  it("shows the error when credentials are wrong", async () => {
    authMock.signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    renderLogin();

    await userEvent.type(await screen.findByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
  });

  it("lands on the home page after a successful sign-in", async () => {
    authMock.signInWithPassword.mockImplementation(async () => {
      authMock.session = fakeSession("a@b.co");
      return { error: null };
    });
    renderLogin();

    await userEvent.type(await screen.findByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "right");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(authMock.signInWithPassword).toHaveBeenCalledWith({
        email: "a@b.co",
        password: "right",
      }),
    );
  });
});
