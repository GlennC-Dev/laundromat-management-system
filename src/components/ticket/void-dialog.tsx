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
import { callFunction } from "@/lib/edge";
import { supabase } from "@/lib/supabase";

const staffSchema = z.object({
  reason: z.string().trim().min(1, "Say why this is being voided"),
  admin_email: z.string().trim().min(1, "Enter the admin email"),
  admin_password: z.string().min(1, "Enter the admin password"),
});
const adminSchema = staffSchema.pick({ reason: true });
type Values = z.infer<typeof staffSchema>;

/**
 * Void a ticket. Admins just give a reason. Staff need an admin to type their own email and
 * password (a manager override, as on a till); the admin never signs in on this device.
 */
export function VoidDialog({
  ticketId,
  summary,
  isAdmin,
  onClose,
  onVoided,
}: {
  ticketId: string | null;
  summary: string;
  isAdmin: boolean;
  onClose: () => void;
  onVoided?: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(isAdmin ? (adminSchema as unknown as typeof staffSchema) : staffSchema),
    defaultValues: { reason: "", admin_email: "", admin_password: "" },
  });

  const close = () => {
    form.reset();
    onClose();
  };

  const run = useMutation({
    mutationFn: async (v: Values) => {
      if (!ticketId) return;
      if (isAdmin) {
        const { error } = await supabase.rpc("void_ticket", {
          p_ticket_id: ticketId,
          p_reason: v.reason,
        });
        if (error) throw error;
      } else {
        await callFunction("void-override", { ticket_id: ticketId, ...v });
      }
    },
    onSuccess: async () => {
      await Promise.all(
        [
          "todays_tickets",
          "todays_orders",
          "open_tickets",
          "open_orders",
          "stock_levels",
          "ticket_history",
        ].map((k) => qc.invalidateQueries({ queryKey: [k] })),
      );
      toast.success("Ticket voided");
      close();
      onVoided?.();
    },
    onError: (e: Error) => {
      form.resetField("admin_password");
      toast.error(e.message);
    },
  });

  return (
    <Dialog open={ticketId !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void ticket</DialogTitle>
          <DialogDescription>
            {summary}. {isAdmin ? "This cannot be undone." : "An admin must approve this."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => run.mutate(v))} className="space-y-4" noValidate>
            <TextField control={form.control} name="reason" label="Reason" />
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
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={run.isPending}>
                {run.isPending ? "Voiding…" : "Void ticket"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
