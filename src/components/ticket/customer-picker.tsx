import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhone, normalizePhone, type Order } from "@/lib/tickets";
import { cn } from "@/lib/utils";

export type CustomerChoice = { orderId: number | null; name: string; phone: string };
export const NEW_CUSTOMER: CustomerChoice = { orderId: null, name: "", phone: "" };

export function customerReady(c: CustomerChoice): boolean {
  return c.orderId !== null || (c.name.trim() !== "" && normalizePhone(c.phone) !== null);
}

/** Who is this job for: a new customer, or someone with an order still open. */
export function CustomerPicker({
  orders,
  jobs,
  value,
  onChange,
}: {
  orders: Order[];
  jobs: Map<number, number>; // open jobs per order
  value: CustomerChoice;
  onChange: (c: CustomerChoice) => void;
}) {
  const option = (selected: boolean) =>
    cn(
      "w-full rounded-lg border px-3 py-2 text-left text-sm",
      selected ? "border-primary bg-accent font-medium" : "bg-background hover:bg-muted",
    );
  const phoneBad = value.phone.trim() !== "" && normalizePhone(value.phone) === null;

  return (
    <section className="space-y-2" aria-label="Customer">
      <h3 className="text-sm font-medium text-muted-foreground">Customer</h3>
      <div role="radiogroup" aria-label="Customer" className="grid gap-2">
        {orders.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value.orderId === o.id}
            className={option(value.orderId === o.id)}
            onClick={() => onChange({ orderId: o.id, name: "", phone: "" })}
          >
            {o.customer_name} · {formatPhone(o.phone)}
            <span className="block text-xs font-normal text-muted-foreground">
              {jobs.get(o.id) ?? 0} open job{jobs.get(o.id) === 1 ? "" : "s"}
            </span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={value.orderId === null}
          className={option(value.orderId === null)}
          onClick={() => onChange({ ...value, orderId: null })}
        >
          New customer
        </button>
      </div>
      {value.orderId === null && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="cust-name">Name</Label>
            <Input
              id="cust-name"
              className="h-11"
              autoComplete="off"
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-phone">Mobile number</Label>
            <Input
              id="cust-phone"
              className="h-11"
              inputMode="tel"
              autoComplete="off"
              placeholder="0917 123 4567"
              aria-invalid={phoneBad}
              value={value.phone}
              onChange={(e) => onChange({ ...value, phone: e.target.value })}
            />
          </div>
          {phoneBad && (
            <p className="col-span-2 text-xs text-destructive">
              Enter a mobile number like 0917 123 4567.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
