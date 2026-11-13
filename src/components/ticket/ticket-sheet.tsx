import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PaymentForm, type Payment } from "@/components/ticket/payment-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatPeso, formatTime, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import {
  formatDuration,
  runState,
  unitPrice,
  useNow,
  usePriceList,
  useStockLevels,
  type Machine,
  type Ticket,
} from "@/lib/tickets";

type AddArgs = { dry?: number; spins?: number; detergent?: number; fabcon?: number };

function Line({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex justify-between text-sm">
      <span>{label}</span>
      <span className="tabular-nums">{formatPeso(amount)}</span>
    </div>
  );
}

function Body({
  ticket,
  machine,
  isAdmin,
  onClose,
}: {
  ticket: Ticket;
  machine: Machine;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const now = useNow();
  const prices = usePriceList();
  const stock = useStockLevels();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["open_tickets"] }),
      qc.invalidateQueries({ queryKey: ["stock_levels"] }),
    ]);

  const add = useMutation({
    mutationFn: async (a: AddArgs) => {
      const { error } = await supabase.rpc("add_to_ticket", {
        p_ticket_id: ticket.id,
        p_extra_dry_minutes: a.dry ?? 0,
        p_extra_spins: a.spins ?? 0,
        p_detergent_qty: a.detergent ?? 0,
        p_fabcon_qty: a.fabcon ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const complete = useMutation({
    mutationFn: async (p: Payment) => {
      const { error } = await supabase.rpc("complete_ticket", {
        p_ticket_id: ticket.id,
        p_amount_paid: p.amount,
        p_payment_method: p.method,
        ...(p.reference ? { p_reference_no: p.reference } : {}),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      toast.success(`${machine.label} completed`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const voidIt = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("void_ticket", {
        p_ticket_id: ticket.id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Ticket voided");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = prices.data ?? [];
  const today = todayISO();
  const listPrice = (key: Parameters<typeof unitPrice>[1]) => unitPrice(rows, key, today)?.price;
  const dryPrice =
    ticket.extra_dry_minutes > 0
      ? ticket.dry_ext_unit_price
      : listPrice({
          kind: "add_on",
          code: "dry_extension",
          machine_type: "dry",
          size_kg: Number(machine.capacity_kg),
          level: null,
        });
  const spinPrice =
    ticket.extra_spin_count > 0
      ? ticket.spin_unit_price
      : listPrice({
          kind: "add_on",
          code: "extra_spin",
          machine_type: "wash",
          size_kg: null,
          level: null,
        });
  const detPrice =
    ticket.detergent_qty > 0
      ? ticket.detergent_unit_price
      : listPrice({
          kind: "item",
          code: "detergent",
          machine_type: null,
          size_kg: null,
          level: null,
        });
  const fabPrice =
    ticket.fabcon_qty > 0
      ? ticket.fabcon_unit_price
      : listPrice({ kind: "item", code: "fabcon", machine_type: null, size_kg: null, level: null });
  const left = (item: "detergent" | "fabcon") =>
    stock.data?.find((s) => s.item === item)?.doses ?? 0;

  const state = runState(ticket, now);
  const total = ticket.total ?? 0;
  const busy = add.isPending;

  type Quick = { label: string; price: number | undefined; args: AddArgs; blocked?: boolean };
  const quick: Quick[] = [
    ...(machine.type === "dry"
      ? [
          { label: "+5 min", price: dryPrice, args: { dry: 5 } },
          {
            label: "+10 min",
            price: dryPrice === undefined ? undefined : dryPrice * 2,
            args: { dry: 10 },
          },
        ]
      : [{ label: "+1 extra spin", price: spinPrice, args: { spins: 1 } }]),
    {
      label: "+1 detergent",
      price: detPrice,
      args: { detergent: 1 },
      blocked: left("detergent") < 1,
    },
    { label: "+1 fabcon", price: fabPrice, args: { fabcon: 1 }, blocked: left("fabcon") < 1 },
  ];

  return (
    <div className="space-y-5 px-4 pb-6">
      <div className="rounded-xl bg-muted p-3 text-sm">
        <p className="font-medium capitalize">
          {ticket.level} · started {formatTime(ticket.started_at)}
        </p>
        <p className="text-muted-foreground">
          {state.kind === "running"
            ? `Ends ${formatTime(ticket.ends_at)} · ${formatDuration(state.msLeft)} left`
            : `Finished ${formatTime(ticket.ends_at)} · waiting for pickup and payment`}
        </p>
      </div>

      <section className="space-y-1.5">
        <Line
          label={`${machine.capacity_kg} kg ${ticket.level}`}
          amount={ticket.service_price ?? 0}
        />
        {ticket.extra_dry_minutes > 0 && (
          <Line
            label={`Extra drying ${ticket.extra_dry_minutes} min`}
            amount={(ticket.extra_dry_minutes / 5) * ticket.dry_ext_unit_price}
          />
        )}
        {ticket.extra_spin_count > 0 && (
          <Line
            label={`Extra spin × ${ticket.extra_spin_count}`}
            amount={ticket.extra_spin_count * ticket.spin_unit_price}
          />
        )}
        {ticket.detergent_qty > 0 && (
          <Line
            label={`Detergent × ${ticket.detergent_qty}`}
            amount={ticket.detergent_qty * ticket.detergent_unit_price}
          />
        )}
        {ticket.fabcon_qty > 0 && (
          <Line
            label={`Fabric conditioner × ${ticket.fabcon_qty}`}
            amount={ticket.fabcon_qty * ticket.fabcon_unit_price}
          />
        )}
        <div className="flex justify-between border-t pt-2 text-lg font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatPeso(total)}</span>
        </div>
      </section>

      {!paying && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Add to this ticket</h3>
          <div className="grid grid-cols-2 gap-2">
            {quick.map((q) => (
              <Button
                key={q.label}
                variant="outline"
                className="h-auto flex-col gap-0 py-2"
                disabled={busy || q.price === undefined || q.blocked}
                onClick={() => add.mutate(q.args)}
              >
                <span>{q.label}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {q.blocked
                    ? "Out of stock"
                    : q.price === undefined
                      ? "No price set"
                      : formatPeso(q.price)}
                </span>
              </Button>
            ))}
          </div>
        </section>
      )}

      {paying ? (
        <section className="space-y-3 border-t pt-4">
          <PaymentForm
            total={total}
            submitLabel="Complete ticket"
            pending={complete.isPending}
            onSubmit={(p) => complete.mutate(p)}
          />
          <Button variant="ghost" className="w-full" onClick={() => setPaying(false)}>
            Back
          </Button>
        </section>
      ) : (
        <Button className="h-12 w-full text-base" onClick={() => setPaying(true)}>
          Take payment · {formatPeso(total)}
        </Button>
      )}

      {isAdmin && !paying && (
        <section className="space-y-2 border-t pt-4">
          {voiding ? (
            <>
              <Input
                placeholder="Reason for voiding"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-11"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => setVoiding(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={reason.trim() === "" || voidIt.isPending}
                  onClick={() => voidIt.mutate()}
                >
                  {voidIt.isPending ? "Voiding…" : "Void ticket"}
                </Button>
              </div>
            </>
          ) : (
            <Button
              variant="ghost"
              className="w-full text-destructive"
              onClick={() => setVoiding(true)}
            >
              Void this ticket…
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

export function TicketSheet({
  ticket,
  machine,
  isAdmin,
  onClose,
}: {
  ticket: Ticket | null;
  machine: Machine | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={ticket !== null && machine !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{machine?.label}</SheetTitle>
          <SheetDescription>Open ticket. It locks once payment is taken.</SheetDescription>
        </SheetHeader>
        {ticket && machine && (
          <Body
            key={ticket.id}
            ticket={ticket}
            machine={machine}
            isAdmin={isAdmin}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
