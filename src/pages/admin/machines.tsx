import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { SelectField, SwitchField, TextField, toNumber } from "@/components/form-fields";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Tables } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

type Machine = Tables<"machines">;

const positive = (msg: string) =>
  z
    .string()
    .trim()
    .refine((v) => toNumber(v) !== undefined && toNumber(v)! > 0, msg);

export const machineSchema = z
  .object({
    label: z.string().trim().min(1, "Give the machine a label"),
    type: z.enum(["wash", "dry"]),
    capacity_kg: positive("Enter the capacity in kg"),
    motor_kw: positive("Enter the motor power in kW"),
    element_kw: z.string().trim(),
    water_l_per_cycle: z.string().trim(),
    status: z.enum(["available", "out_of_service"]),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "dry" && !(toNumber(v.element_kw)! > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["element_kw"],
        message: "Dryers need the heating element kW",
      });
    }
    if (v.type === "wash" && !(toNumber(v.water_l_per_cycle)! > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["water_l_per_cycle"],
        message: "Washers need litres per cycle",
      });
    }
  });
type Values = z.infer<typeof machineSchema>;

function toValues(m: Machine | null): Values {
  return {
    label: m?.label ?? "",
    type: m?.type ?? "wash",
    capacity_kg: m ? String(m.capacity_kg) : "",
    motor_kw: m ? String(m.motor_kw) : "",
    element_kw: m?.element_kw != null ? String(m.element_kw) : "",
    water_l_per_cycle: m?.water_l_per_cycle != null ? String(m.water_l_per_cycle) : "",
    status: m?.status ?? "available",
    active: m?.active ?? true,
  };
}

function MachineDialog({
  machine,
  open,
  onOpenChange,
}: {
  machine: Machine | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(machineSchema),
    values: toValues(machine),
  });
  const type = form.watch("type");

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const row = {
        label: v.label,
        type: v.type,
        capacity_kg: toNumber(v.capacity_kg)!,
        motor_kw: toNumber(v.motor_kw)!,
        element_kw: v.type === "dry" ? toNumber(v.element_kw)! : null,
        water_l_per_cycle: v.type === "wash" ? toNumber(v.water_l_per_cycle)! : null,
        status: v.status,
        active: v.active,
      };
      const { error } = machine
        ? await supabase.from("machines").update(row).eq("id", machine.id)
        : await supabase.from("machines").insert(row);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["machines"] });
      toast.success(machine ? "Machine updated" : "Machine added");
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("machines_label_key") ? "That label is already used" : e.message,
      ),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{machine ? `Edit ${machine.label}` : "Add machine"}</DialogTitle>
          <DialogDescription>
            Power and water figures feed the utility cost estimates.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => save.mutate(v))}
            className="space-y-4"
            noValidate
          >
            <TextField control={form.control} name="label" label="Label" />
            <SelectField
              control={form.control}
              name="type"
              label="Type"
              disabled={Boolean(machine)}
              options={[
                { value: "wash", label: "Washer" },
                { value: "dry", label: "Dryer" },
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                control={form.control}
                name="capacity_kg"
                label="Capacity (kg)"
                inputMode="decimal"
              />
              <TextField
                control={form.control}
                name="motor_kw"
                label="Motor (kW)"
                inputMode="decimal"
              />
            </div>
            {type === "dry" ? (
              <TextField
                control={form.control}
                name="element_kw"
                label="Heating element (kW)"
                inputMode="decimal"
              />
            ) : (
              <TextField
                control={form.control}
                name="water_l_per_cycle"
                label="Water per cycle (litres)"
                inputMode="decimal"
              />
            )}
            <SelectField
              control={form.control}
              name="status"
              label="Status"
              options={[
                { value: "available", label: "Available" },
                { value: "out_of_service", label: "Out of service" },
              ]}
            />
            <SwitchField control={form.control} name="active" label="In use at the shop" />
            <Button type="submit" className="h-11 w-full" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function MachinesPage() {
  const [editing, setEditing] = useState<Machine | null>(null);
  const [open, setOpen] = useState(false);
  const machines = useQuery({
    queryKey: ["machines"],
    queryFn: async () => {
      const { data, error } = await supabase.from("machines").select("*").order("label");
      if (error) throw error;
      return data;
    },
  });

  function openDialog(m: Machine | null) {
    setEditing(m);
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Machines</h1>
          <p className="text-sm text-muted-foreground">The washers and dryers on the floor.</p>
        </div>
        <Button onClick={() => openDialog(null)}>
          <Plus aria-hidden /> Add machine
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Power / water</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {machines.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {machines.isError && (
              <TableRow>
                <TableCell colSpan={6} className="text-destructive">
                  Could not load machines.
                </TableCell>
              </TableRow>
            )}
            {machines.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No machines yet. Add your first washer or dryer.
                </TableCell>
              </TableRow>
            )}
            {machines.data?.map((m) => (
              <TableRow key={m.id} className={m.active ? "" : "opacity-60"}>
                <TableCell className="font-medium">{m.label}</TableCell>
                <TableCell>{m.type === "wash" ? "Washer" : "Dryer"}</TableCell>
                <TableCell>{m.capacity_kg} kg</TableCell>
                <TableCell>
                  {m.motor_kw} kW motor
                  {m.type === "dry" ? ` · ${m.element_kw} kW heat` : ` · ${m.water_l_per_cycle} L`}
                </TableCell>
                <TableCell>
                  {!m.active ? (
                    <Badge variant="outline">Retired</Badge>
                  ) : m.status === "available" ? (
                    <Badge variant="secondary">Available</Badge>
                  ) : (
                    <Badge variant="destructive">Out of service</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => openDialog(m)}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <MachineDialog machine={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}
