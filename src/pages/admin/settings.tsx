import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { SelectField, TextField, toNumber } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Tables } from "@/lib/database.types";
import { todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";

const factor = (msg: string) =>
  z
    .string()
    .trim()
    .refine((v) => toNumber(v) !== undefined && toNumber(v)! > 0 && toNumber(v)! <= 1, msg);
const positive = (msg: string) =>
  z
    .string()
    .trim()
    .refine((v) => toNumber(v) !== undefined && toNumber(v)! > 0, msg);

const settingsSchema = z
  .object({
    opening_time: z.string().min(1, "Set the opening time"),
    closing_time: z.string().min(1, "Set the closing time"),
    washer_load_factor: factor("Between 0 and 1"),
    dryer_duty_dry: factor("Between 0 and 1"),
    dryer_duty_drier: factor("Between 0 and 1"),
    dryer_duty_driest: factor("Between 0 and 1"),
    water_factor_clean: positive("Greater than 0"),
    water_factor_cleaner: positive("Greater than 0"),
    water_factor_cleanest: positive("Greater than 0"),
  })
  .refine((v) => v.closing_time > v.opening_time, {
    path: ["closing_time"],
    message: "Closing must be after opening",
  });
type SettingsValues = z.infer<typeof settingsSchema>;

const hhmm = (t: string) => t.slice(0, 5);

function SettingsForm({ s }: { s: Tables<"settings"> }) {
  const qc = useQueryClient();
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    values: {
      opening_time: hhmm(s.opening_time),
      closing_time: hhmm(s.closing_time),
      washer_load_factor: String(s.washer_load_factor),
      dryer_duty_dry: String(s.dryer_duty_dry),
      dryer_duty_drier: String(s.dryer_duty_drier),
      dryer_duty_driest: String(s.dryer_duty_driest),
      water_factor_clean: String(s.water_factor_clean),
      water_factor_cleaner: String(s.water_factor_cleaner),
      water_factor_cleanest: String(s.water_factor_cleanest),
    },
  });
  const save = useMutation({
    mutationFn: async (v: SettingsValues) => {
      const { error } = await supabase
        .from("settings")
        .update({
          opening_time: v.opening_time,
          closing_time: v.closing_time,
          washer_load_factor: toNumber(v.washer_load_factor)!,
          dryer_duty_dry: toNumber(v.dryer_duty_dry)!,
          dryer_duty_drier: toNumber(v.dryer_duty_drier)!,
          dryer_duty_driest: toNumber(v.dryer_duty_driest)!,
          water_factor_clean: toNumber(v.water_factor_clean)!,
          water_factor_cleaner: toNumber(v.water_factor_cleaner)!,
          water_factor_cleanest: toNumber(v.water_factor_cleanest)!,
        })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-6" noValidate>
        <section className="space-y-3 rounded-xl border bg-background p-4">
          <h2 className="text-lg font-semibold">Shop hours</h2>
          <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
            <TextField control={form.control} name="opening_time" label="Opens" type="time" />
            <TextField
              control={form.control}
              name="closing_time"
              label="Closes (end of day)"
              type="time"
            />
          </div>
        </section>
        <section className="space-y-3 rounded-xl border bg-background p-4">
          <div>
            <h2 className="text-lg font-semibold">Utility estimate assumptions</h2>
            <p className="text-sm text-muted-foreground">
              Used to turn machine hours into kWh and litres. Estimates, not meter readings.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              control={form.control}
              name="washer_load_factor"
              label="Washer load factor"
              inputMode="decimal"
            />
            <TextField
              control={form.control}
              name="dryer_duty_dry"
              label="Dryer duty · dry"
              inputMode="decimal"
            />
            <TextField
              control={form.control}
              name="dryer_duty_drier"
              label="Dryer duty · drier"
              inputMode="decimal"
            />
            <TextField
              control={form.control}
              name="dryer_duty_driest"
              label="Dryer duty · driest"
              inputMode="decimal"
            />
            <TextField
              control={form.control}
              name="water_factor_clean"
              label="Water factor · clean"
              inputMode="decimal"
            />
            <TextField
              control={form.control}
              name="water_factor_cleaner"
              label="Water factor · cleaner"
              inputMode="decimal"
            />
            <TextField
              control={form.control}
              name="water_factor_cleanest"
              label="Water factor · cleanest"
              inputMode="decimal"
            />
          </div>
        </section>
        <Button type="submit" className="h-11" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </form>
    </Form>
  );
}

const rateSchema = z.object({
  kind: z.enum(["electricity", "water"]),
  rate: positive("Enter the rate"),
  effective_from: z.string().min(1, "Pick the start date"),
});
type RateValues = z.infer<typeof rateSchema>;
const UNIT = { electricity: "₱ per kWh", water: "₱ per m³" } as const;

function UtilityRates() {
  const qc = useQueryClient();
  const rates = useQuery({
    queryKey: ["utility_rates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("utility_rates")
        .select("*")
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const form = useForm<RateValues>({
    resolver: zodResolver(rateSchema),
    defaultValues: { kind: "electricity", rate: "", effective_from: todayISO() },
  });
  const save = useMutation({
    mutationFn: async (v: RateValues) => {
      const { error } = await supabase
        .from("utility_rates")
        .upsert(
          { kind: v.kind, rate: toNumber(v.rate)!, effective_from: v.effective_from },
          { onConflict: "kind,effective_from" },
        );
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["utility_rates"] });
      toast.success("Rate saved");
      form.reset({ kind: form.getValues("kind"), rate: "", effective_from: todayISO() });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="space-y-3 rounded-xl border bg-background p-4">
      <div>
        <h2 className="text-lg font-semibold">Utility rates</h2>
        <p className="text-sm text-muted-foreground">
          Electricity and water, effective-dated. Cost for a day uses the rate in effect that day.
        </p>
      </div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
          className="grid gap-3 sm:grid-cols-4 sm:items-start"
          noValidate
        >
          <SelectField
            control={form.control}
            name="kind"
            label="Utility"
            options={[
              { value: "electricity", label: "Electricity (per kWh)" },
              { value: "water", label: "Water (per m³)" },
            ]}
          />
          <TextField control={form.control} name="rate" label="Rate (₱)" inputMode="decimal" />
          <TextField control={form.control} name="effective_from" label="Starts on" type="date" />
          <Button type="submit" className="h-11 sm:mt-[1.625rem]" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Add rate"}
          </Button>
        </form>
      </Form>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Utility</TableHead>
              <TableHead>Starts</TableHead>
              <TableHead className="text-right">Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No rates yet. Utility costs stay blank until you add one.
                </TableCell>
              </TableRow>
            )}
            {rates.data?.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="capitalize">{r.kind}</TableCell>
                <TableCell>{r.effective_from}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.rate} <span className="text-muted-foreground">{UNIT[r.kind]}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").eq("id", true).single();
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Shop hours, estimate assumptions and utility rates.
        </p>
      </div>
      {settings.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {settings.isError && <p className="text-sm text-destructive">Could not load settings.</p>}
      {settings.data && <SettingsForm s={settings.data} />}
      <UtilityRates />
    </div>
  );
}
