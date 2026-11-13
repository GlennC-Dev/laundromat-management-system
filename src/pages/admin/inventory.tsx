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
import { formatPeso } from "@/lib/format";
import { supabase } from "@/lib/supabase";

const ITEM_LABEL = { detergent: "Detergent", fabcon: "Fabric conditioner" } as const;

const schema = z.object({
  item: z.enum(["detergent", "fabcon"]),
  doses: z
    .string()
    .trim()
    .refine(
      (v) => Number.isInteger(toNumber(v)) && toNumber(v)! > 0,
      "Enter a whole number of doses",
    ),
  unit_cost: z
    .string()
    .trim()
    .refine((v) => toNumber(v) !== undefined && toNumber(v)! >= 0, "Enter the cost per dose"),
});
type Values = z.infer<typeof schema>;

export function InventoryPage() {
  const qc = useQueryClient();
  const stock = useQuery({
    queryKey: ["stock_levels"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("stock_levels");
      if (error) throw error;
      return data;
    },
  });
  const history = useQuery({
    queryKey: ["restocks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restocks")
        .select("*")
        .order("restocked_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { item: "detergent", doses: "", unit_cost: "" },
  });

  const restock = useMutation({
    mutationFn: async (v: Values) => {
      const { error } = await supabase.rpc("restock", {
        p_item: v.item,
        p_doses: toNumber(v.doses)!,
        p_unit_cost: toNumber(v.unit_cost)!,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["stock_levels"] }),
        qc.invalidateQueries({ queryKey: ["restocks"] }),
      ]);
      toast.success("Stock added");
      form.reset({
        item: form.getValues("item"),
        doses: "",
        unit_cost: form.getValues("unit_cost"),
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Counted in doses. Stock is restocks minus what tickets have used.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(["detergent", "fabcon"] as const).map((item) => {
          const doses = stock.data?.find((s) => s.item === item)?.doses;
          return (
            <div key={item} className="rounded-xl border bg-background p-4">
              <p className="text-sm text-muted-foreground">{ITEM_LABEL[item]}</p>
              <p className="text-3xl font-semibold tabular-nums">{doses ?? "–"}</p>
              <p className="text-sm text-muted-foreground">doses in stock</p>
            </div>
          );
        })}
      </div>

      <section className="space-y-3 rounded-xl border bg-background p-4">
        <h2 className="text-lg font-semibold">Add stock</h2>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => restock.mutate(v))}
            className="grid gap-3 sm:grid-cols-4 sm:items-start"
            noValidate
          >
            <SelectField
              control={form.control}
              name="item"
              label="Item"
              options={[
                { value: "detergent", label: ITEM_LABEL.detergent },
                { value: "fabcon", label: ITEM_LABEL.fabcon },
              ]}
            />
            <TextField control={form.control} name="doses" label="Doses" inputMode="numeric" />
            <TextField
              control={form.control}
              name="unit_cost"
              label="Cost per dose (₱)"
              inputMode="decimal"
            />
            <Button type="submit" className="h-11 sm:mt-[1.625rem]" disabled={restock.isPending}>
              {restock.isPending ? "Adding…" : "Add stock"}
            </Button>
          </form>
        </Form>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Recent restocks</h2>
        <div className="overflow-x-auto rounded-xl border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Doses</TableHead>
                <TableHead className="text-right">Cost per dose</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    No restocks yet.
                  </TableCell>
                </TableRow>
              )}
              {history.data?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.restocked_at).toLocaleString("en-PH")}</TableCell>
                  <TableCell>{ITEM_LABEL[r.item]}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.doses}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPeso(r.unit_cost)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
