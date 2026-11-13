import type { Enums, Tables } from "@/lib/database.types";

export type PriceRow = Tables<"price_list">;
type MachineLite = Pick<Tables<"machines">, "type" | "capacity_kg" | "active">;

export type Slot = {
  kind: Enums<"price_kind">;
  code: Enums<"price_code"> | null;
  machine_type: Enums<"machine_type"> | null;
  size_kg: number | null;
  level: Enums<"service_level"> | null;
  label: string;
  group: "wash" | "dry" | "other";
  /** Minutes are fixed for this slot (dryer extensions are priced per 5 minutes). */
  fixedMinutes: number | null;
};

const WASH_LEVELS: Enums<"service_level">[] = ["clean", "cleaner", "cleanest"];
const DRY_LEVELS: Enums<"service_level">[] = ["dry", "drier", "driest"];

export function slotKey(s: {
  kind: string;
  code: string | null;
  machine_type: string | null;
  size_kg: number | null;
  level: string | null;
}): string {
  return [s.kind, s.code ?? "", s.machine_type ?? "", s.size_kg ?? "", s.level ?? ""].join("|");
}

/** The prices the shop needs, derived from the machines currently in use. */
export function buildSlots(machines: MachineLite[]): Slot[] {
  const active = machines.filter((m) => m.active);
  const slots: Slot[] = [];
  const sizes = (type: "wash" | "dry") =>
    [...new Set(active.filter((m) => m.type === type).map((m) => Number(m.capacity_kg)))].sort(
      (a, b) => a - b,
    );

  for (const size of sizes("wash")) {
    for (const level of WASH_LEVELS) {
      slots.push({
        kind: "service",
        code: null,
        machine_type: "wash",
        size_kg: size,
        level,
        label: `${size} kg washer · ${level}`,
        group: "wash",
        fixedMinutes: null,
      });
    }
  }
  for (const size of sizes("dry")) {
    for (const level of DRY_LEVELS) {
      slots.push({
        kind: "service",
        code: null,
        machine_type: "dry",
        size_kg: size,
        level,
        label: `${size} kg dryer · ${level}`,
        group: "dry",
        fixedMinutes: null,
      });
    }
  }
  if (sizes("wash").length > 0) {
    slots.push({
      kind: "add_on",
      code: "extra_spin",
      machine_type: "wash",
      size_kg: null,
      level: null,
      label: "Extra spin",
      group: "other",
      fixedMinutes: null,
    });
  }
  for (const size of sizes("dry")) {
    slots.push({
      kind: "add_on",
      code: "dry_extension",
      machine_type: "dry",
      size_kg: size,
      level: null,
      label: `${size} kg dryer · extra 5 minutes`,
      group: "other",
      fixedMinutes: 5,
    });
  }
  slots.push({
    kind: "item",
    code: "detergent",
    machine_type: null,
    size_kg: null,
    level: null,
    label: "Detergent (per dose)",
    group: "other",
    fixedMinutes: null,
  });
  slots.push({
    kind: "item",
    code: "fabcon",
    machine_type: null,
    size_kg: null,
    level: null,
    label: "Fabric conditioner (per dose)",
    group: "other",
    fixedMinutes: null,
  });
  return slots;
}

/** Price in effect on `today`, and the next scheduled change if any. Dates are YYYY-MM-DD. */
export function priceFor(
  rows: PriceRow[],
  slot: Slot,
  today: string,
): { current: PriceRow | null; upcoming: PriceRow | null } {
  const key = slotKey(slot);
  const mine = rows
    .filter((r) => slotKey(r) === key)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const current = [...mine].reverse().find((r) => r.effective_from <= today) ?? null;
  const upcoming = mine.find((r) => r.effective_from > today) ?? null;
  return { current, upcoming };
}
