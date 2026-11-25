import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { HALT_WINDOW_MS, HaltDialog } from "@/components/ticket/halt-dialog";
import { PaymentForm, type Payment } from "@/components/ticket/payment-form";
import { TicketLines } from "@/components/ticket/ticket-lines";
import { VoidDialog } from "@/components/ticket/void-dialog";
import { Button } from "@/components/ui/button";
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
  formatPhone,
  useOpenOrders,
  useOpenTickets,
  usePriceList,
  useStockLevels,
  type Machine,
  type Order,
  type Ticket,
} from "@/lib/tickets";

type AddArgs = { dry?: number; spins?: number; detergent?: number; fabcon?: number };

function Body({
  ticket,
  machine,
  isAdmin,
  onClose,
  onHalted,
  onOpenOrder,
}: {
  ticket: Ticket;
  machine: Machine;
  isAdmin: boolean;
  onClose: () => void;
  onHalted: (machineId: string) => void;
  onOpenOrder: (o: Order) => void;
}) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const orders = useOpenOrders();
  const openTickets = useOpenTickets();
  const order = (orders.data ?? []).find((o) => o.id === ticket.order_id);
  const orderJobs = (openTickets.data ?? []).filter((t) => t.order_id === ticket.order_id);
  const prices = usePriceList();
  const stock = useStockLevels();
  const [paying, setPaying] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [haltOpen, setHaltOpen] = useState(false);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["open_tickets"] }),
      qc.invalidateQueries({ queryKey: ["open_orders"] }),
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
  const canHalt = now - new Date(ticket.started_at).getTime() < HALT_WINDOW_MS;
  const secondsToHalt = Math.max(
    0,
    Math.ceil((HALT_WINDOW_MS - (now - new Date(ticket.started_at).getTime())) / 1000),
  );

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
    ...(machine.type === "wash"
      ? [
          {
            label: "+1 detergent",
            price: detPrice,
            args: { detergent: 1 },
            blocked: left("detergent") < 1,
          },
          {
            label: "+1 fabcon",
            price: fabPrice,
            args: { fabcon: 1 },
            blocked: left("fabcon") < 1,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5 px-4 pb-6">
      <div className="rounded-xl bg-muted p-3 text-sm">
        {order && (
          <p className="mb-1 font-semibold">
            {order.customer_name}
            <span className="font-normal text-muted-foreground"> · {formatPhone(order.phone)}</span>
          </p>
        )}
        <p className="font-medium capitalize">
          {ticket.level} · started {formatTime(ticket.started_at)}
        </p>
        <p className="text-muted-foreground">
          {state.kind === "running"
            ? `Ends ${formatTime(ticket.ends_at)} · ${formatDuration(state.msLeft)} left`
            : `Finished ${formatTime(ticket.ends_at)} · waiting for pickup and payment`}
        </p>
      </div>

      <TicketLines ticket={ticket} capacityKg={Number(machine.capacity_kg)} />

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

      {order && orderJobs.length > 1 && !paying && (
        <Button variant="outline" className="w-full" onClick={() => onOpenOrder(order)}>
          Pay entire order ({orderJobs.length} jobs)
        </Button>
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

      {!paying && (
        <section className="space-y-2 border-t pt-4">
          {canHalt ? (
            <Button
              variant="outline"
              className="w-full border-destructive/50 text-destructive"
              onClick={() => setHaltOpen(true)}
            >
              Halt job ({secondsToHalt}s left)
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="w-full text-destructive"
              onClick={() => setVoidOpen(true)}
            >
              {isAdmin ? "Void this ticket…" : "Void this ticket (admin approval)…"}
            </Button>
          )}
        </section>
      )}

      <HaltDialog
        ticketId={ticket.id}
        machineLabel={machine.label}
        open={haltOpen}
        onClose={() => setHaltOpen(false)}
        onHalted={() => {
          setHaltOpen(false);
          onHalted(machine.id);
          onClose();
        }}
      />
      <VoidDialog
        ticketId={voidOpen ? ticket.id : null}
        summary={`${machine.label} · ${formatPeso(total)}`}
        isAdmin={isAdmin}
        onClose={() => setVoidOpen(false)}
        onVoided={onClose}
      />
    </div>
  );
}

export function TicketSheet({
  ticket,
  machine,
  isAdmin,
  onClose,
  onHalted,
  onOpenOrder,
}: {
  ticket: Ticket | null;
  machine: Machine | null;
  isAdmin: boolean;
  onClose: () => void;
  onHalted: (machineId: string) => void;
  onOpenOrder: (o: Order) => void;
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
            onHalted={onHalted}
            onOpenOrder={onOpenOrder}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
