import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import type { Enums } from "@/lib/database.types";
import { callFunction } from "@/lib/edge";
import { supabase } from "@/lib/supabase";
import type { Machine } from "@/lib/tickets";
import { cn } from "@/lib/utils";

export const OUTAGE_REASONS: { value: Enums<"outage_reason">; label: string }[] = [
  { value: "broken", label: "Broken" },
  { value: "maintenance", label: "Maintenance" },
  { value: "out_of_service", label: "Out of service" },
  { value: "waiting_for_parts", label: "Waiting for parts" },
  { value: "other", label: "Other" },
];
export const reasonLabel = (r: string) => OUTAGE_REASONS.find((o) => o.value === r)?.label ?? r;

type Values = {
  reason: Enums<"outage_reason">;
  note: string;
  admin_email: string;
  admin_password: string;
};

function schemaFor(isAdmin: boolean, down: boolean) {
  return z
    .object({
      reason: z.enum(["broken", "maintenance", "out_of_service", "waiting_for_parts", "other"]),
      note: z.string().trim(),
      admin_email: isAdmin ? z.string() : z.string().trim().min(1, "Enter the admin email"),
      admin_password: isAdmin ? z.string() : z.string().min(1, "Enter the admin password"),
    })
    .superRefine((v, ctx) => {
      if (down && v.reason === "other" && v.note === "") {
        ctx.addIssue({ code: "custom", path: ["note"], message: "Describe the problem" });
      }
    });
}

/**
 * Take a free machine out of service, or bring one back. Admins act directly; staff need an admin to
 * type their own email and password (a manager override, as on a till).
 */
export function OutageDialog({
  machine,
  isAdmin,
  onClose,
}: {
  machine: Machine | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const down = machine?.status !== "out_of_service";
  return (
    <Dialog open={machine !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        {machine && (
          <Body
            key={`${machine.id}-${down}`}
            machine={machine}
            down={down}
            isAdmin={isAdmin}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  machine,
  down,
  isAdmin,
  onClose,
}: {
  machine: Machine;
  down: boolean;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schemaFor(isAdmin, down)) as never,
    defaultValues: { reason: "broken", note: "", admin_email: "", admin_password: "" },
  });
  const reason = form.watch("reason");

  const run = useMutation({
    mutationFn: async (v: Values) => {
      const note = v.note.trim();
      if (isAdmin) {
        const { error } = down
          ? await supabase.rpc("take_machine_down", {
              p_machine_id: machine.id,
              p_reason: v.reason,
              ...(note ? { p_note: note } : {}),
            })
          : await supabase.rpc("bring_machine_up", {
              p_machine_id: machine.id,
              ...(note ? { p_note: note } : {}),
            });
        if (error) throw error;
      } else {
        await callFunction("machine-override", {
          machine_id: machine.id,
          action: down ? "down" : "up",
          ...(down ? { reason: v.reason } : {}),
          note,
          admin_email: v.admin_email,
          admin_password: v.admin_password,
        });
      }
    },
    onSuccess: async () => {
      await Promise.all(
        ["machines", "open_outages", "open_tickets"].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      );
      toast.success(
        down ? `${machine.label} is out of service` : `${machine.label} is back in service`,
      );
      onClose();
    },
    onError: (e: Error) => {
      form.resetField("admin_password");
      toast.error(e.message);
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {down ? `Take ${machine.label} out of service` : `Bring ${machine.label} back`}
        </DialogTitle>
        <DialogDescription>
          {down
            ? "No job can start on it until it is brought back."
            : "It will be free to use again."}{" "}
          {isAdmin ? "" : "An admin must approve this."}
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => run.mutate(v))} className="space-y-4" noValidate>
          {down && (
            <div role="radiogroup" aria-label="Reason" className="grid grid-cols-2 gap-2">
              {OUTAGE_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={reason === r.value}
                  onClick={() => form.setValue("reason", r.value, { shouldValidate: true })}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm",
                    reason === r.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
          <TextField
            control={form.control}
            name="note"
            label={down && reason === "other" ? "What is wrong" : "Note (optional)"}
          />
          {!isAdmin && (
            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">Admin approval</legend>
              <TextField
                control={form.control}
                name="admin_email"
                label="Admin email"
                type="email"
                autoComplete="off"
              />
              <TextField
                control={form.control}
                name="admin_password"
                label="Admin password"
                type="password"
                autoComplete="off"
              />
            </fieldset>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={run.isPending}>
              {run.isPending ? "Saving…" : down ? "Take out of service" : "Bring back"}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  );
}
