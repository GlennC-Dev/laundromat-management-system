import type { RouteObject } from "react-router";

import { ErrorPage } from "@/pages/error-page";
import { HomePage } from "@/pages/home";
import { NotFoundPage } from "@/pages/not-found";

// Route table, kept separate from main.tsx so tests can build a memory router from it.
// Role-based routing for staff and admin arrives with the app shell stage.
export const routes: RouteObject[] = [
  {
    path: "/",
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
