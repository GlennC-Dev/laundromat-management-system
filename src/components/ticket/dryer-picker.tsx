import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Machine, Order } from "@/lib/tickets";

/** Pick a free dryer for a customer whose wash is done; the start dialog then opens with them selected. */
export function DryerPicker({
  order,
  dryers,
  onPick,
  onClose,
}: {
  order: Order | null;
  dryers: Machine[]; // free dryers only
  onPick: (machine: Machine) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={order !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Start a dryer</DialogTitle>
          <DialogDescription>For {order?.customer_name}. Pick a free dryer.</DialogDescription>
        </DialogHeader>
        {dryers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every dryer is busy right now.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {dryers.map((m) => (
              <Button
                key={m.id}
                variant="outline"
                className="h-auto flex-col gap-0 py-3"
                onClick={() => onPick(m)}
              >
                <span className="font-semibold">{m.label}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {m.capacity_kg} kg
                </span>
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
