import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";

import { AuthProvider } from "./lib/auth";
import { supabaseConfigured } from "./lib/supabase";
import { routes } from "./router";
import "./styles.css";

const queryClient = new QueryClient();
const router = createBrowserRouter(routes);

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element in index.html");

if (!supabaseConfigured) {
  createRoot(container).render(
    <p style={{ padding: 24, fontFamily: "sans-serif" }}>
      Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
    </p>,
  );
} else {
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
