import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Enums } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/** Mirrors the database: a job can be halted for this long after it starts, and its machine
 *  cannot start another job for the same long afterwards. */
export const HALT_WINDOW_MS = 60_000;
export const HALT_COOLDOWN_MS = 60_000;

const REASONS: { value: Enums<"halt_reason">; label: string }[] = [
  { value: "machine_error", label: "Machine error" },
  { value: "door_problem", label: "Door or lid problem" },
  { value: "wrong_cycle", label: "Wrong cycle" },
  { value: "customer_changed_mind", label: "Customer changed mind" },
  { value: "other", label: "Other" },
];

/** Stops a job within its first minute, with no admin approval. */
export function HaltDialog({
  ticketId,
  machineLabel,
  open,
  onClose,
  onHalted,
}: {
  ticketId: string;
  machineLabel: string;
  open: boolean;
  onClose: () => void;
  onHalted: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<Enums<"halt_reason"> | null>(null);
  const [note, setNote] = useState("");
  const needsNote = reason === "other";

  const halt = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("halt_ticket", {
        p_ticket_id: ticketId,
        p_reason: reason!,
        ...(note.trim() ? { p_note: note.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all(
        ["open_tickets", "stock_levels", "todays_tickets", "todays_orders", "open_orders"].map(
          (k) => qc.invalidateQueries({ queryKey: [k] }),
        ),
      );
      toast.success(`${machineLabel} halted. It can start again in a minute.`);
      onHalted();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Halt {machineLabel}</DialogTitle>
          <DialogDescription>
            Stops the job with no charge. Only possible in the first minute.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Reason" className="grid gap-2">
          {REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={reason === r.value}
              onClick={() => setReason(r.value)}
              className={cn(
                "h-11 rounded-lg border px-3 text-left text-sm",
                reason === r.value ? "border-primary bg-accent font-medium" : "bg-background",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="halt-note">{needsNote ? "What happened?" : "Note (optional)"}</Label>
          <Input
            id="halt-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-11"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason || (needsNote && note.trim() === "") || halt.isPending}
            onClick={() => halt.mutate()}
          >
            {halt.isPending ? "Halting…" : "Halt job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
