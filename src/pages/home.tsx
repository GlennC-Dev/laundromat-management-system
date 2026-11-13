import { Link, useOutletContext } from "react-router";

import type { Profile } from "@/lib/profile";

const setup = [
  { to: "/machines", title: "Machines", text: "Washers and dryers on the floor" },
  { to: "/prices", title: "Prices", text: "Per size and level, plus add-ons" },
  { to: "/inventory", title: "Inventory", text: "Detergent and fabcon stock" },
  { to: "/users", title: "Users", text: "Add and edit logins" },
  { to: "/settings", title: "Settings", text: "Hours, estimates, utility rates" },
];

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
      {me.role === "admin" ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Shop setup</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {setup.map((s) => (
              <Link
                key={s.to}
                to={s.to}
                className="rounded-xl border bg-background p-4 transition-colors hover:bg-muted"
              >
                <p className="font-medium">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.text}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          The floor board arrives once ticket entry is built.
        </div>
      )}
    </div>
  );
}
