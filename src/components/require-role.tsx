import { Navigate, Outlet, useOutletContext } from "react-router";

import type { Profile } from "@/lib/profile";

/** Renders its children only for the given role; must sit inside AppShell. */
export function RequireRole({ role }: { role: Profile["role"] }) {
  const me = useOutletContext<Profile>();
  if (me.role !== role) return <Navigate to="/" replace />;
  return <Outlet context={me} />;
}
