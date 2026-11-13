import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PaymentForm } from "@/components/ticket/payment-form";
import { Stepper } from "@/components/ticket/stepper";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPeso, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { unitPrice, usePriceList, useStockLevels } from "@/lib/tickets";

function Body({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const prices = usePriceList();
  const stock = useStockLevels();
  const [detergent, setDetergent] = useState(0);
  const [fabcon, setFabcon] = useState(0);

  const rows = prices.data ?? [];
  const today = todayISO();
  const det = unitPrice(
    rows,
    { kind: "item", code: "detergent", machine_type: null, size_kg: null, level: null },
    today,
  );
  const fab = unitPrice(
    rows,
    { kind: "item", code: "fabcon", machine_type: null, size_kg: null, level: null },
    today,
  );
  const left = (item: "detergent" | "fabcon") =>
    stock.data?.find((s) => s.item === item)?.doses ?? 0;
  const total = detergent * (det?.price ?? 0) + fabcon * (fab?.price ?? 0);

  const sell = useMutation({
    mutationFn: async (p: {
      amount: number;
      method: "cash" | "gcash" | "maya" | "bank_transfer" | "card";
      reference: string | undefined;
    }) => {
      const { error } = await supabase.rpc("counter_sale", {
        p_detergent_qty: detergent,
        p_fabcon_qty: fabcon,
        p_amount_paid: p.amount,
        p_payment_method: p.method,
        ...(p.reference ? { p_reference_no: p.reference } : {}),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["stock_levels"] });
      toast.success("Sale recorded");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Stepper
        label="Detergent"
        hint={
          det ? `${formatPeso(det.price)} per dose · ${left("detergent")} in stock` : "No price set"
        }
        value={detergent}
        max={det ? left("detergent") : 0}
        onChange={setDetergent}
      />
      <Stepper
        label="Fabric conditioner"
        hint={
          fab ? `${formatPeso(fab.price)} per dose · ${left("fabcon")} in stock` : "No price set"
        }
        value={fabcon}
        max={fab ? left("fabcon") : 0}
        onChange={setFabcon}
      />
      <div className="border-t pt-4">
        <PaymentForm
          total={total}
          submitLabel="Record sale"
          pending={sell.isPending}
          disabled={detergent + fabcon === 0}
          onSubmit={(p) => sell.mutate(p)}
        />
      </div>
    </div>
  );
}

export function CounterSaleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Counter sale</DialogTitle>
          <DialogDescription>
            Detergent or fabric conditioner sold without a machine.
          </DialogDescription>
        </DialogHeader>
        {open && <Body onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
