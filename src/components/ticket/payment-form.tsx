import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { SelectField, TextField, toNumber } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { formatPeso } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/tickets";

export const paymentSchema = z
  .object({
    amount: z
      .string()
      .trim()
      .refine((v) => toNumber(v) !== undefined && toNumber(v)! >= 0, "Enter the amount paid"),
    method: z.enum(["cash", "gcash", "maya", "bank_transfer", "card"]),
    reference: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (v.method !== "cash" && v.reference === "") {
      ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the reference number" });
    }
  });
type Values = z.infer<typeof paymentSchema>;

export type Payment = {
  amount: number;
  method: Values["method"];
  reference: string | undefined;
};

export function PaymentForm({
  total,
  submitLabel,
  pending,
  disabled,
  onSubmit,
}: {
  total: number;
  submitLabel: string;
  pending: boolean;
  disabled?: boolean;
  onSubmit: (p: Payment) => void;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: total.toFixed(2), method: "cash", reference: "" },
  });
  const method = form.watch("method");
  const amount = toNumber(form.watch("amount"));

  // Keep the amount in step with the total until the attendant types their own.
  useEffect(() => {
    if (!form.formState.dirtyFields.amount) form.setValue("amount", total.toFixed(2));
  }, [total, form]);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) =>
          onSubmit({
            amount: toNumber(v.amount)!,
            method: v.method,
            reference: v.reference || undefined,
          }),
        )}
        className="space-y-4"
        noValidate
      >
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total due</span>
          <span className="text-2xl font-semibold tabular-nums">{formatPeso(total)}</span>
        </div>
        <SelectField
          control={form.control}
          name="method"
          label="Payment method"
          options={Object.entries(PAYMENT_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <TextField
          control={form.control}
          name="amount"
          label="Amount paid (₱)"
          inputMode="decimal"
        />
        {amount !== undefined && Math.abs(amount - total) > 0.005 && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            This differs from the total. It will be flagged in the daily report.
          </p>
        )}
        {method !== "cash" && (
          <TextField
            control={form.control}
            name="reference"
            label="Reference number"
            autoComplete="off"
          />
        )}
        <Button
          type="submit"
          className="h-12 w-full text-base"
          disabled={pending || Boolean(disabled)}
        >
          {pending ? "Saving…" : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
