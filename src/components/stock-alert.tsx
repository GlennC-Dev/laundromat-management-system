import { TriangleAlert } from "lucide-react";

import { LOW_STOCK, useStockLevels } from "@/lib/tickets";

const NAME = { detergent: "Detergent", fabcon: "Fabric conditioner" } as const;

/** Warns when a supply is under the threshold, so someone can restock before it runs out. */
export function StockAlert() {
  const stock = useStockLevels();
  const low = (stock.data ?? []).filter((s) => s.doses < LOW_STOCK);
  if (low.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-signal/60 bg-highlight p-3 text-sm text-highlight-foreground"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
      <div>
        <p className="font-medium">Running low on supplies</p>
        <ul className="mt-0.5">
          {low.map((s) => (
            <li key={s.item}>
              {NAME[s.item]}: {s.doses === 0 ? "out of stock" : `${s.doses} doses left`}
            </li>
          ))}
        </ul>
        <p className="mt-1 opacity-80">Let an admin know so it can be restocked.</p>
      </div>
    </div>
  );
}
