import { WashingMachine } from "lucide-react";
import { NavLink, Outlet } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useProfile, type Profile } from "@/lib/profile";
import { cn } from "@/lib/utils";

const adminLinks = [
  { to: "/machines", label: "Machines" },
  { to: "/prices", label: "Prices" },
  { to: "/inventory", label: "Inventory" },
  { to: "/users", label: "Users" },
  { to: "/settings", label: "Settings" },
];

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center text-sm">
      {children}
    </div>
  );
}

export function AppShell() {
  const { signOut } = useAuth();
  const profile = useProfile();

  if (profile.isLoading) {
    return <Centered>Loading…</Centered>;
  }
  if (profile.isError) {
    return (
      <Centered>
        <p>Could not load your account. Check your connection and try again.</p>
        <Button variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </Centered>
    );
  }
  const me: Profile | null = profile.data ?? null;
  if (!me || !me.active) {
    return (
      <Centered>
        <p className="font-medium">This account has no access.</p>
        <p className="text-muted-foreground">Ask an admin to set up or reactivate your account.</p>
        <Button variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </Centered>
    );
  }

  const links = [{ to: "/", label: "Floor" }, ...(me.role === "admin" ? adminLinks : [])];

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <WashingMachine className="size-4" aria-hidden />
            </span>
            <span className="hidden sm:inline">Laundromat</span>
          </div>
          <nav aria-label="Main" className="-mx-1 flex flex-1 gap-1 overflow-x-auto px-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm md:inline">{me.display_name}</span>
            <Badge variant={me.role === "admin" ? "default" : "secondary"}>{me.role}</Badge>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet context={me} />
      </main>
    </div>
  );
}
