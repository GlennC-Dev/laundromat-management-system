import { useState } from "react";
import { useOutletContext } from "react-router";

import { VoidDialog } from "@/components/ticket/void-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPeso, formatTime } from "@/lib/format";
import type { Profile } from "@/lib/profile";
import {
  PAYMENT_LABEL,
  useMachines,
  useTodaysOrders,
  useTodaysTickets,
  type Ticket,
} from "@/lib/tickets";

function StatusBadge({ t }: { t: Ticket }) {
  if (t.voided_at) return <Badge variant="destructive">Voided</Badge>;
  if (t.status === "completed") return <Badge variant="secondary">Paid</Badge>;
  return <Badge>Open</Badge>;
}

export function TicketsPage() {
  const me = useOutletContext<Profile>();
  const tickets = useTodaysTickets();
  const machines = useMachines();
  const orders = useTodaysOrders();
  const customerOf = (t: Ticket) =>
    t.order_id === null
      ? undefined
      : (orders.data ?? []).find((o) => o.id === t.order_id)?.customer_name;
  const [voiding, setVoiding] = useState<Ticket | null>(null);

  const label = (id: string | null) =>
    id ? ((machines.data ?? []).find((m) => m.id === id)?.label ?? "Machine") : "Counter sale";
  const rows = tickets.data ?? [];
  const paid = rows.filter((t) => t.status === "completed" && !t.voided_at);
  const collected = paid.reduce((sum, t) => sum + (t.amount_paid ?? 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today's tickets</h1>
        <p className="text-sm text-muted-foreground">
          {paid.length} paid · {formatPeso(collected)} collected
        </p>
      </div>

      {tickets.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {tickets.isError && <p className="text-sm text-destructive">Could not load tickets.</p>}
      {tickets.data && rows.length === 0 && (
        <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          No tickets yet today.
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((t) => (
          <li
            key={t.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-background p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {label(t.machine_id)}
                {t.level && <span className="font-normal capitalize"> · {t.level}</span>}
              </p>
              <p className="text-sm text-muted-foreground">
                {customerOf(t) && `${customerOf(t)} · `}
                {formatTime(t.started_at)}
                {t.payment_method && ` · ${PAYMENT_LABEL[t.payment_method]}`}
                {t.voided_at && t.void_reason && ` · ${t.void_reason}`}
              </p>
            </div>
            <span className="font-medium tabular-nums">{formatPeso(t.total ?? 0)}</span>
            <StatusBadge t={t} />
            {!t.voided_at && (
              <Button
                variant="outline"
                size="sm"
                aria-label={`Void ${label(t.machine_id)} ticket`}
                onClick={() => setVoiding(t)}
              >
                Void
              </Button>
            )}
          </li>
        ))}
      </ul>

      <VoidDialog
        ticketId={voiding?.id ?? null}
        summary={voiding ? `${label(voiding.machine_id)} · ${formatPeso(voiding.total ?? 0)}` : ""}
        isAdmin={me.role === "admin"}
        onClose={() => setVoiding(null)}
      />
    </div>
  );
}
