import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

export function Stepper({
  label,
  hint,
  value,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  max?: number;
  onChange: (n: number) => void;
}) {
  const atMax = max !== undefined && value >= max;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div>
        <p className="font-medium">{label}</p>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={value <= 0}
          onClick={() => onChange(value - 1)}
        >
          <Minus aria-hidden />
        </Button>
        <span className="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">
          {value}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={atMax}
          onClick={() => onChange(value + 1)}
        >
          <Plus aria-hidden />
        </Button>
      </div>
    </div>
  );
}
