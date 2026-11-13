import { useOutletContext } from "react-router";

import type { Profile } from "@/lib/profile";

export function HomePage() {
  const me = useOutletContext<Profile>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Floor board</h1>
        <p className="text-sm text-muted-foreground">
          Hello, {me.display_name}. Machines and open tickets will show here.
        </p>
      </div>
      <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
        {me.role === "admin"
          ? "Use the menu above to set up machines, prices, stock and users."
          : "The floor board arrives once ticket entry is built."}
      </div>
    </div>
  );
}
