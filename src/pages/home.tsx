import { useState } from "react";
import { Link, useOutletContext } from "react-router";
import { ShoppingBag } from "lucide-react";

import { CounterSaleDialog } from "@/components/ticket/counter-sale-dialog";
import { NewTicketDialog } from "@/components/ticket/new-ticket-dialog";
import { TicketSheet } from "@/components/ticket/ticket-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPeso, formatTime } from "@/lib/format";
import type { Profile } from "@/lib/profile";
import {
  formatDuration,
  runState,
  useMachines,
  useNow,
  useOpenTickets,
  type Machine,
  type Ticket,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";

function Tile({
  machine,
  tickets,
  now,
  onStart,
  onOpen,
}: {
  machine: Machine;
  tickets: Ticket[]; // open tickets on this machine, newest first
  now: number;
  onStart: () => void;
  onOpen: (t: Ticket) => void;
}) {
  const current = tickets[0];
  const earlier = tickets.slice(1);
  const out = machine.status === "out_of_service";
  const state = current ? runState(current, now) : null;
  const progress =
    current && state?.kind === "running"
      ? Math.min(
          100,
          Math.max(
            0,
            ((now - new Date(current.started_at).getTime()) /
              (new Date(current.ends_at).getTime() - new Date(current.started_at).getTime())) *
              100,
          ),
        )
      : 100;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-background p-4",
        out && "opacity-60",
        state?.kind === "done" && "border-amber-500/60 bg-amber-50 dark:bg-amber-950/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold leading-tight">{machine.label}</p>
          <p className="text-sm text-muted-foreground">{machine.capacity_kg} kg</p>
        </div>
        {out ? (
          <Badge variant="destructive">Out of service</Badge>
        ) : !current ? (
          <Badge variant="secondary">Free</Badge>
        ) : state?.kind === "running" ? (
          <Badge>Running</Badge>
        ) : (
          <Badge className="bg-amber-500 text-white hover:bg-amber-500">Done</Badge>
        )}
      </div>

      {current && state && (
        <button
          type="button"
          onClick={() => onOpen(current)}
          className="space-y-2 text-left"
          aria-label={`Open ticket on ${machine.label}`}
        >
          <p className="text-sm">
            <span className="capitalize">{current.level}</span> ·{" "}
            {state.kind === "running"
              ? `${formatDuration(state.msLeft)} left`
              : `done ${formatDuration(state.msOver)} ago`}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                state.kind === "running" ? "bg-primary" : "bg-amber-500",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Ends {formatTime(current.ends_at)} · {formatPeso(current.total ?? 0)}
          </p>
        </button>
      )}

      {earlier.length > 0 && (
        <button
          type="button"
          onClick={() => onOpen(earlier[earlier.length - 1]!)}
          className="text-left text-sm text-amber-700 underline dark:text-amber-400"
        >
          {earlier.length} earlier ticket{earlier.length > 1 ? "s" : ""} awaiting payment
        </button>
      )}

      {!out && (!current || state?.kind === "done") && (
        <Button
          className="mt-auto h-11"
          variant={current ? "outline" : "default"}
          onClick={onStart}
        >
          {current ? "Start another" : "Start"}
        </Button>
      )}
    </div>
  );
}

function Group({
  title,
  machines,
  ticketsBy,
  now,
  onStart,
  onOpen,
}: {
  title: string;
  machines: Machine[];
  ticketsBy: Map<string, Ticket[]>;
  now: number;
  onStart: (m: Machine) => void;
  onOpen: (t: Ticket) => void;
}) {
  if (machines.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {machines.map((m) => (
          <Tile
            key={m.id}
            machine={m}
            tickets={ticketsBy.get(m.id) ?? []}
            now={now}
            onStart={() => onStart(m)}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}

export function HomePage() {
  const me = useOutletContext<Profile>();
  const machines = useMachines();
  const open = useOpenTickets();
  const now = useNow();
  const [starting, setStarting] = useState<Machine | null>(null);
  const [viewing, setViewing] = useState<Ticket | null>(null);
  const [counter, setCounter] = useState(false);

  const active = (machines.data ?? []).filter((m) => m.active);
  const ticketsBy = new Map<string, Ticket[]>();
  for (const t of [...(open.data ?? [])].sort((a, b) => b.started_at.localeCompare(a.started_at))) {
    if (!t.machine_id) continue;
    ticketsBy.set(t.machine_id, [...(ticketsBy.get(t.machine_id) ?? []), t]);
  }
  const viewingMachine = viewing
    ? ((machines.data ?? []).find((m) => m.id === viewing.machine_id) ?? null)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Floor board</h1>
          <p className="text-sm text-muted-foreground">Hello, {me.display_name}.</p>
        </div>
        <Button variant="outline" className="h-11" onClick={() => setCounter(true)}>
          <ShoppingBag aria-hidden /> Counter sale
        </Button>
      </div>

      {(machines.isLoading || open.isLoading) && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {(machines.isError || open.isError) && (
        <p className="text-sm text-destructive">Could not load the floor board.</p>
      )}
      {machines.data && active.length === 0 && (
        <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          {me.role === "admin" ? (
            <>
              No machines yet. Add them on the{" "}
              <Link to="/machines" className="underline">
                Machines
              </Link>{" "}
              page, then set prices.
            </>
          ) : (
            "No machines have been set up yet. Ask an admin."
          )}
        </div>
      )}

      <Group
        title="Washers"
        machines={active.filter((m) => m.type === "wash")}
        ticketsBy={ticketsBy}
        now={now}
        onStart={setStarting}
        onOpen={setViewing}
      />
      <Group
        title="Dryers"
        machines={active.filter((m) => m.type === "dry")}
        ticketsBy={ticketsBy}
        now={now}
        onStart={setStarting}
        onOpen={setViewing}
      />

      <NewTicketDialog machine={starting} onClose={() => setStarting(null)} />
      <TicketSheet
        ticket={viewing}
        machine={viewingMachine}
        isAdmin={me.role === "admin"}
        onClose={() => setViewing(null)}
      />
      <CounterSaleDialog open={counter} onClose={() => setCounter(false)} />
    </div>
  );
}
