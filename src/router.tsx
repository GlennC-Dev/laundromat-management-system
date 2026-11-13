import type { RouteObject } from "react-router";

import { AppShell } from "@/components/app-shell";
import { RequireRole } from "@/components/require-role";
import { RequireAuth } from "@/components/require-auth";
import { InventoryPage } from "@/pages/admin/inventory";
import { MachinesPage } from "@/pages/admin/machines";
import { PricesPage } from "@/pages/admin/prices";
import { SettingsPage } from "@/pages/admin/settings";
import { UsersPage } from "@/pages/admin/users";
import { ErrorPage } from "@/pages/error-page";
import { HomePage } from "@/pages/home";
import { LoginPage } from "@/pages/login";
import { NotFoundPage } from "@/pages/not-found";

// Route table, kept separate from main.tsx so tests can build a memory router from it.
// Role-based routing for staff and admin arrives with the app shell stage.
export const routes: RouteObject[] = [
  {
    path: "/",
    errorElement: <ErrorPage />,
    children: [
      { path: "login", element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <HomePage /> },
              {
                element: <RequireRole role="admin" />,
                children: [
                  { path: "machines", element: <MachinesPage /> },
                  { path: "prices", element: <PricesPage /> },
                  { path: "inventory", element: <InventoryPage /> },
                  { path: "settings", element: <SettingsPage /> },
                  { path: "users", element: <UsersPage /> },
                ],
              },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
