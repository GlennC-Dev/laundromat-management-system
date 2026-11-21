import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PaymentForm, type Payment } from "@/components/ticket/payment-form";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPeso, formatTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { formatPhone, type Machine, type Order, type Ticket } from "@/lib/tickets";

/** One customer's open order: its jobs, and a single payment for all of them. */
export function OrderDialog({
  order,
  jobs,
  machines,
  onClose,
}: {
  order: Order | null;
  jobs: Ticket[]; // this order's pending jobs
  machines: Machine[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const label = (id: string | null) => machines.find((m) => m.id === id)?.label ?? "Machine";
  const now = Date.now();
  const running = jobs.filter((t) => new Date(t.ends_at).getTime() > now);
  const total = jobs.reduce((sum, t) => sum + (t.total ?? 0), 0);

  const pay = useMutation({
    mutationFn: async (p: Payment) => {
      const { error } = await supabase.rpc("pay_order", {
        p_order_id: order!.id,
        p_amount_paid: p.amount,
        p_payment_method: p.method,
        ...(p.reference ? { p_reference_no: p.reference } : {}),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all(
        ["open_tickets", "open_orders", "todays_tickets", "todays_orders"].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      );
      toast.success(`${order!.customer_name}'s order is paid`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={order !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        {order && (
          <>
            <DialogHeader>
              <DialogTitle>{order.customer_name}</DialogTitle>
              <DialogDescription>
                {formatPhone(order.phone)} · order {order.id}
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-2">
              {jobs.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{label(t.machine_id)}</span>
                    <span className="capitalize"> · {t.level}</span>
                    <span className="block text-xs text-muted-foreground">
                      {new Date(t.ends_at).getTime() > now
                        ? `Ends ${formatTime(t.ends_at)}`
                        : `Finished ${formatTime(t.ends_at)}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {new Date(t.ends_at).getTime() > now && <Badge>Running</Badge>}
                    <span className="tabular-nums">{formatPeso(t.total ?? 0)}</span>
                  </span>
                </li>
              ))}
              {jobs.length === 0 && (
                <li className="text-sm text-muted-foreground">No unpaid jobs on this order.</li>
              )}
            </ul>
            {running.length > 0 ? (
              <p className="rounded-lg bg-muted p-3 text-sm">
                {running.map((t) => label(t.machine_id)).join(", ")} still running. Pay the finished
                jobs one at a time from their machines, or wait until everything is done.
              </p>
            ) : (
              jobs.length > 0 && (
                <PaymentForm
                  total={total}
                  submitLabel="Pay entire order"
                  pending={pay.isPending}
                  onSubmit={(p) => pay.mutate(p)}
                />
              )
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
