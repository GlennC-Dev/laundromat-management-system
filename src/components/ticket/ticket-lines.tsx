import { formatPeso } from "@/lib/format";
import type { Ticket } from "@/lib/tickets";

function Line({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex justify-between text-sm">
      <span>{label}</span>
      <span className="tabular-nums">{formatPeso(amount)}</span>
    </div>
  );
}

/** Itemised charges and total, from the prices snapshotted on the ticket. */
export function TicketLines({ ticket, capacityKg }: { ticket: Ticket; capacityKg?: number }) {
  return (
    <section className="space-y-1.5">
      {ticket.service_price !== null && (
        <Line
          label={`${capacityKg ? `${capacityKg} kg ` : ""}${ticket.level ?? "service"}`}
          amount={ticket.service_price}
        />
      )}
      {ticket.extra_dry_minutes > 0 && (
        <Line
          label={`Extra drying ${ticket.extra_dry_minutes} min`}
          amount={(ticket.extra_dry_minutes / 5) * ticket.dry_ext_unit_price}
        />
      )}
      {ticket.extra_spin_count > 0 && (
        <Line
          label={`Extra spin × ${ticket.extra_spin_count}`}
          amount={ticket.extra_spin_count * ticket.spin_unit_price}
        />
      )}
      {ticket.detergent_qty > 0 && (
        <Line
          label={`Detergent × ${ticket.detergent_qty}`}
          amount={ticket.detergent_qty * ticket.detergent_unit_price}
        />
      )}
      {ticket.fabcon_qty > 0 && (
        <Line
          label={`Fabric conditioner × ${ticket.fabcon_qty}`}
          amount={ticket.fabcon_qty * ticket.fabcon_unit_price}
        />
      )}
      <div className="flex justify-between border-t pt-2 text-lg font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatPeso(ticket.total ?? 0)}</span>
      </div>
    </section>
  );
}
