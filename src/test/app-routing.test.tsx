import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { routes } from "@/router";

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe("App routing", () => {
  it("renders the home page for /", () => {
    renderAt("/");

    expect(
      screen.getByRole("heading", { name: "Laundromat Management System" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Page not found")).not.toBeInTheDocument();
  });

  it("renders the not-found page for an unknown path", () => {
    renderAt("/does-not-exist");

    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });
});
