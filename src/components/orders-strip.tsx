import { formatPeso } from "@/lib/format";
import { type Order, type Ticket } from "@/lib/tickets";

/** Customers with an order still open, so staff can find one and pay it. */
export function OrdersStrip({
  orders,
  tickets,
  onOpen,
}: {
  orders: Order[];
  tickets: Ticket[];
  onOpen: (o: Order) => void;
}) {
  if (orders.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Open orders">
      <h2 className="text-lg font-semibold">Open orders</h2>
      <div className="flex flex-wrap gap-2">
        {orders.map((o) => {
          const mine = tickets.filter((t) => t.order_id === o.id);
          const total = mine.reduce((sum, t) => sum + (t.total ?? 0), 0);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onOpen(o)}
              aria-label={`Open order for ${o.customer_name}`}
              className="rounded-xl border bg-background px-3 py-2 text-left text-sm hover:bg-accent/40"
            >
              <span className="block font-medium">{o.customer_name}</span>
              <span className="block text-xs text-muted-foreground">
                {mine.length} job{mine.length === 1 ? "" : "s"} · {formatPeso(total)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
