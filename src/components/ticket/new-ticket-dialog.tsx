import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Stepper } from "@/components/ticket/stepper";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Enums } from "@/lib/database.types";
import { formatPeso, formatTime, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { levelsFor, unitPrice, usePriceList, useStockLevels, type Machine } from "@/lib/tickets";
import { cn } from "@/lib/utils";

function Body({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const qc = useQueryClient();
  const prices = usePriceList();
  const stock = useStockLevels();
  const [level, setLevel] = useState<Enums<"service_level"> | null>(null);
  const [detergent, setDetergent] = useState(0);
  const [fabcon, setFabcon] = useState(0);

  const rows = prices.data ?? [];
  const today = todayISO();
  const service = (l: Enums<"service_level">) =>
    unitPrice(
      rows,
      {
        kind: "service",
        code: null,
        machine_type: machine.type,
        size_kg: Number(machine.capacity_kg),
        level: l,
      },
      today,
    );
  const detPrice = unitPrice(
    rows,
    { kind: "item", code: "detergent", machine_type: null, size_kg: null, level: null },
    today,
  );
  const fabPrice = unitPrice(
    rows,
    { kind: "item", code: "fabcon", machine_type: null, size_kg: null, level: null },
    today,
  );

  const chosen = level ? service(level) : null;
  const total =
    (chosen?.price ?? 0) + detergent * (detPrice?.price ?? 0) + fabcon * (fabPrice?.price ?? 0);
  const left = (item: "detergent" | "fabcon") => stock.data?.find((s) => s.item === item)?.doses;

  const start = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("create_ticket", {
        p_machine_id: machine.id,
        p_level: level!,
        p_detergent_qty: detergent,
        p_fabcon_qty: fabcon,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["open_tickets"] }),
        qc.invalidateQueries({ queryKey: ["stock_levels"] }),
      ]);
      const end = new Date(Date.now() + (chosen?.default_minutes ?? 0) * 60_000);
      toast.success(`Started ${machine.label}, ends about ${formatTime(end.getTime())}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Cycle level">
        {levelsFor(machine.type).map((l) => {
          const p = service(l);
          return (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={level === l}
              disabled={!p}
              onClick={() => setLevel(l)}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                level === l
                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-background hover:bg-muted",
              )}
            >
              <span className="block font-semibold capitalize">{l}</span>
              <span className="block text-sm">{p ? formatPeso(p.price) : "No price set"}</span>
              {p?.default_minutes && (
                <span className="block text-xs opacity-80">{p.default_minutes} min</span>
              )}
            </button>
          );
        })}
      </div>

      <Stepper
        label="Detergent"
        hint={
          detPrice
            ? `${formatPeso(detPrice.price)} per dose · customers may bring their own`
            : "No price set"
        }
        value={detergent}
        max={Math.min(left("detergent") ?? 0, detPrice ? Infinity : 0)}
        onChange={setDetergent}
      />
      <Stepper
        label="Fabric conditioner"
        hint={fabPrice ? `${formatPeso(fabPrice.price)} per dose` : "No price set"}
        value={fabcon}
        max={Math.min(left("fabcon") ?? 0, fabPrice ? Infinity : 0)}
        onChange={setFabcon}
      />

      <div className="flex items-baseline justify-between border-t pt-3">
        <span className="text-sm text-muted-foreground">Total</span>
        <span className="text-2xl font-semibold tabular-nums">{formatPeso(total)}</span>
      </div>
      <Button
        className="h-12 w-full text-base"
        disabled={!level || start.isPending}
        onClick={() => start.mutate()}
      >
        {start.isPending ? "Starting…" : "Start machine"}
      </Button>
    </div>
  );
}

export function NewTicketDialog({
  machine,
  onClose,
}: {
  machine: Machine | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={machine !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start {machine?.label}</DialogTitle>
          <DialogDescription>
            {machine && `${machine.capacity_kg} kg ${machine.type === "wash" ? "washer" : "dryer"}`}
          </DialogDescription>
        </DialogHeader>
        {machine && <Body key={machine.id} machine={machine} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
