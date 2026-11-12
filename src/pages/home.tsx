import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export function HomePage() {
  const { session, signOut } = useAuth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        Laundromat Management System
      </h1>
      <p className="text-sm text-muted-foreground">Signed in as {session?.user.email}</p>
      <Button variant="outline" onClick={() => void signOut()}>
        Sign out
      </Button>
    </main>
  );
}
