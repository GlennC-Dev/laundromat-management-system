import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { TextField, toNumber } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { formatPeso, todayISO } from "@/lib/format";
import { buildSlots, priceFor, slotKey, type PriceRow, type Slot } from "@/lib/price-slots";
import { supabase } from "@/lib/supabase";

const schema = z.object({
  price: z
    .string()
    .trim()
    .refine((v) => toNumber(v) !== undefined && toNumber(v)! >= 0, "Enter a price, 0 or more"),
  minutes: z.string().trim(),
  effective_from: z.string().min(1, "Pick the date it starts"),
});
type Values = z.infer<typeof schema>;

function PriceDialog({
  slot,
  rows,
  onClose,
}: {
  slot: Slot | null;
  rows: PriceRow[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const current = slot ? priceFor(rows, slot, todayISO()).current : null;
  const needsMinutes = slot ? slot.kind !== "item" : false;

  const form = useForm<Values>({
    resolver: zodResolver(
      schema.superRefine((v, ctx) => {
        if (needsMinutes && !(toNumber(v.minutes)! > 0)) {
          ctx.addIssue({ code: "custom", path: ["minutes"], message: "Enter the minutes" });
        }
      }),
    ),
    values: {
      price: current ? String(current.price) : "",
      minutes: String(
        slot?.fixedMinutes ?? current?.default_minutes ?? (slot?.code === "extra_spin" ? 5 : ""),
      ),
      effective_from: todayISO(),
    },
  });

  const save = useMutation({
    mutationFn: async (v: Values) => {
      if (!slot) return;
      const row = {
        kind: slot.kind,
        code: slot.code,
        machine_type: slot.machine_type,
        size_kg: slot.size_kg,
        level: slot.level,
        price: toNumber(v.price)!,
        default_minutes: needsMinutes ? toNumber(v.minutes)! : null,
        effective_from: v.effective_from,
      };
      // A price already starting on that date is corrected in place; otherwise a new version starts.
      const same = rows.find(
        (r) => slotKeyOf(r) === slotKey(slot) && r.effective_from === v.effective_from,
      );
      const { error } = same
        ? await supabase.from("price_list").update(row).eq("id", same.id)
        : await supabase.from("price_list").insert(row);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["price_list"] });
      toast.success("Price saved");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={slot !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{slot?.label}</DialogTitle>
          <DialogDescription>
            Past tickets keep the price they were sold at. A new price applies from its start date.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => save.mutate(v))}
            className="space-y-4"
            noValidate
          >
            <TextField control={form.control} name="price" label="Price (₱)" inputMode="decimal" />
            {needsMinutes && (
              <TextField
                control={form.control}
                name="minutes"
                label={slot?.code === "dry_extension" ? "Minutes per step" : "Minutes"}
                inputMode="numeric"
                disabled={slot?.fixedMinutes != null}
              />
            )}
            <TextField control={form.control} name="effective_from" label="Starts on" type="date" />
            <Button type="submit" className="h-11 w-full" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save price"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const slotKeyOf = (r: PriceRow) => slotKey(r);

function Section({
  title,
  slots,
  rows,
  onEdit,
}: {
  title: string;
  slots: Slot[];
  rows: PriceRow[];
  onEdit: (s: Slot) => void;
}) {
  if (slots.length === 0) return null;
  const today = todayISO();
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ul className="divide-y rounded-xl border bg-background">
        {slots.map((s) => {
          const { current, upcoming } = priceFor(rows, s, today);
          return (
            <li key={slotKey(s)} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium first-letter:uppercase">{s.label}</p>
                <p className="text-sm text-muted-foreground">
                  {current
                    ? `${current.default_minutes ? `${current.default_minutes} min · ` : ""}since ${current.effective_from}`
                    : "No price yet"}
                  {upcoming && ` · ${formatPeso(upcoming.price)} from ${upcoming.effective_from}`}
                </p>
              </div>
              {current ? (
                <span className="font-semibold tabular-nums">{formatPeso(current.price)}</span>
              ) : (
                <Badge variant="destructive">Not set</Badge>
              )}
              <Button variant="outline" size="sm" onClick={() => onEdit(s)}>
                {current ? "Change" : "Set price"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function PricesPage() {
  const [slot, setSlot] = useState<Slot | null>(null);
  const machines = useQuery({
    queryKey: ["machines"],
    queryFn: async () => {
      const { data, error } = await supabase.from("machines").select("*").order("label");
      if (error) throw error;
      return data;
    },
  });
  const prices = useQuery({
    queryKey: ["price_list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("price_list").select("*").order("effective_from");
      if (error) throw error;
      return data;
    },
  });

  if (machines.isLoading || prices.isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (machines.isError || prices.isError)
    return <p className="text-sm text-destructive">Could not load prices.</p>;

  const slots = buildSlots(machines.data ?? []);
  const rows = prices.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Prices</h1>
        <p className="text-sm text-muted-foreground">
          One price per machine size and level, plus add-ons and detergent. Add machines first to
          see their slots.
        </p>
      </div>
      {slots.filter((s) => s.kind !== "item").length === 0 && (
        <p className="rounded-xl border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">
          No machines yet. Add them on the Machines page and their price slots appear here.
        </p>
      )}
      <Section
        title="Washers"
        slots={slots.filter((s) => s.group === "wash")}
        rows={rows}
        onEdit={setSlot}
      />
      <Section
        title="Dryers"
        slots={slots.filter((s) => s.group === "dry")}
        rows={rows}
        onEdit={setSlot}
      />
      <Section
        title="Add-ons and items"
        slots={slots.filter((s) => s.group === "other")}
        rows={rows}
        onEdit={setSlot}
      />
      <PriceDialog slot={slot} rows={rows} onClose={() => setSlot(null)} />
    </div>
  );
}
