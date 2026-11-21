import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { TicketLines } from "@/components/ticket/ticket-lines";
import { VoidDialog } from "@/components/ticket/void-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPeso, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { PAYMENT_LABEL, formatPhone, useMachines, type Ticket } from "@/lib/tickets";

const PAGE = 50;

type Filters = {
  from: string;
  to: string;
  status: "all" | "open" | "paid" | "voided";
  machine: string; // "all", "counter", or a machine id
  payment: string; // "all" or a payment method
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString("en-CA");

// Shop days run on Manila time (UTC+8, no daylight saving).
const dayStart = (d: string) => `${d}T00:00:00+08:00`;
const dayAfter = (d: string) => {
  const next = new Date(`${d}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T00:00:00+08:00`;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });

function useHistory(f: Filters, page: number) {
  return useQuery({
    queryKey: ["ticket_history", f, page],
    queryFn: async () => {
      let q = supabase
        .from("tickets")
        .select("*", { count: "exact" })
        .gte("started_at", dayStart(f.from))
        .lt("started_at", dayAfter(f.to));
      if (f.status === "open") q = q.eq("status", "pending").is("voided_at", null);
      if (f.status === "paid") q = q.eq("status", "completed").is("voided_at", null);
      if (f.status === "voided") q = q.not("voided_at", "is", null);
      if (f.machine === "counter") q = q.eq("kind", "counter");
      else if (f.machine !== "all") q = q.eq("machine_id", f.machine);
      if (f.payment !== "all") q = q.eq("payment_method", f.payment as keyof typeof PAYMENT_LABEL);
      const { data, error, count } = await q
        .order("started_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data, count: count ?? data.length };
    },
  });
}

/** The customers behind a page of tickets. */
function useCustomers(rows: Ticket[]) {
  const ids = [...new Set(rows.flatMap((t) => (t.order_id === null ? [] : [t.order_id])))].sort();
  return useQuery({
    queryKey: ["history_orders", ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select("*").in("id", ids);
      if (error) throw error;
      return data;
    },
  });
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10 w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StatusBadge({ t }: { t: Ticket }) {
  if (t.voided_at) return <Badge variant="destructive">Voided</Badge>;
  if (t.status === "completed") return <Badge variant="secondary">Paid</Badge>;
  return <Badge>Open</Badge>;
}

export function TicketHistoryPage() {
  const machines = useMachines();
  const [filters, setFilters] = useState<Filters>(() => ({
    from: daysAgo(6),
    to: todayISO(),
    status: "all",
    machine: "all",
    payment: "all",
  }));
  const [page, setPage] = useState(0);
  const [viewing, setViewing] = useState<Ticket | null>(null);
  const [voiding, setVoiding] = useState<Ticket | null>(null);
  const history = useHistory(filters, page);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(0);
  };
  const machineOf = (id: string | null) => (machines.data ?? []).find((m) => m.id === id);
  const label = (t: Ticket) =>
    t.machine_id ? (machineOf(t.machine_id)?.label ?? "Machine") : "Counter sale";

  const rows = history.data?.rows ?? [];
  const customers = useCustomers(rows);
  const orderOf = (t: Ticket) => (customers.data ?? []).find((o) => o.id === t.order_id);
  const count = history.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
        <p className="text-sm text-muted-foreground">Every ticket, filtered by start date.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-xl border bg-background p-3 md:grid-cols-5">
        <div className="space-y-1">
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="date"
            className="h-10"
            value={filters.from}
            max={filters.to}
            onChange={(e) => e.target.value && set("from", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to">To</Label>
          <Input
            id="to"
            type="date"
            className="h-10"
            value={filters.to}
            min={filters.from}
            onChange={(e) => e.target.value && set("to", e.target.value)}
          />
        </div>
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => set("status", v as Filters["status"])}
          options={[
            { value: "all", label: "All" },
            { value: "open", label: "Open" },
            { value: "paid", label: "Paid" },
            { value: "voided", label: "Voided" },
          ]}
        />
        <FilterSelect
          label="Machine"
          value={filters.machine}
          onChange={(v) => set("machine", v)}
          options={[
            { value: "all", label: "All" },
            { value: "counter", label: "Counter sales" },
            ...(machines.data ?? []).map((m) => ({ value: m.id, label: m.label })),
          ]}
        />
        <FilterSelect
          label="Payment"
          value={filters.payment}
          onChange={(v) => set("payment", v)}
          options={[
            { value: "all", label: "All" },
            ...Object.entries(PAYMENT_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
      </div>

      {history.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {history.isError && <p className="text-sm text-destructive">Could not load tickets.</p>}
      {history.data && rows.length === 0 && (
        <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          No tickets match these filters.
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setViewing(t)}
              aria-label={`Open ${label(t)} ticket from ${when(t.started_at)}`}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-background p-3 text-left hover:bg-accent/40"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {label(t)}
                  {t.level && <span className="font-normal capitalize"> · {t.level}</span>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {orderOf(t) && `${orderOf(t)!.customer_name} · `}
                  {when(t.started_at)}
                  {t.payment_method && ` · ${PAYMENT_LABEL[t.payment_method]}`}
                </p>
              </div>
              <span className="font-medium tabular-nums">{formatPeso(t.total ?? 0)}</span>
              <StatusBadge t={t} />
            </button>
          </li>
        ))}
      </ul>

      {count > PAGE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page + 1} of {pages} · {count} tickets
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {label(viewing)} · <StatusBadge t={viewing} />
                </DialogTitle>
                <DialogDescription>
                  {orderOf(viewing) &&
                    `${orderOf(viewing)!.customer_name} · ${formatPhone(orderOf(viewing)!.phone)} · order ${viewing.order_id} · `}
                  Started {when(viewing.started_at)}
                  {viewing.machine_id && ` · ends ${when(viewing.ends_at)}`}
                </DialogDescription>
              </DialogHeader>
              <TicketLines
                ticket={viewing}
                {...(machineOf(viewing.machine_id)
                  ? { capacityKg: Number(machineOf(viewing.machine_id)!.capacity_kg) }
                  : {})}
              />
              <dl className="space-y-1 text-sm">
                {viewing.completed_at && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Paid</dt>
                    <dd>
                      {formatPeso(viewing.amount_paid ?? 0)}
                      {viewing.payment_method && ` · ${PAYMENT_LABEL[viewing.payment_method]}`}
                      {viewing.reference_no && ` · ref ${viewing.reference_no}`}
                    </dd>
                  </div>
                )}
                {viewing.completed_at && viewing.amount_paid !== viewing.total && (
                  <p className="text-signal">Amount paid differs from the total.</p>
                )}
                {viewing.voided_at && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Voided {when(viewing.voided_at)}</dt>
                    <dd className="text-right">{viewing.void_reason}</dd>
                  </div>
                )}
              </dl>
              {!viewing.voided_at && (
                <Button
                  variant="destructive"
                  onClick={() => {
                    setVoiding(viewing);
                    setViewing(null);
                  }}
                >
                  Void ticket
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <VoidDialog
        ticketId={voiding?.id ?? null}
        summary={voiding ? `${label(voiding)} · ${formatPeso(voiding.total ?? 0)}` : ""}
        isAdmin
        onClose={() => setVoiding(null)}
      />
    </div>
  );
}
