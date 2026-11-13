import { describe, expect, it } from "vitest";

import { buildSlots, priceFor, type PriceRow } from "@/lib/price-slots";

const machines = [
  { type: "wash" as const, capacity_kg: 8, active: true },
  { type: "wash" as const, capacity_kg: 8, active: true },
  { type: "wash" as const, capacity_kg: 12, active: true },
  { type: "dry" as const, capacity_kg: 16, active: true },
  { type: "dry" as const, capacity_kg: 12, active: false },
];

describe("buildSlots", () => {
  const slots = buildSlots(machines);

  it("lists three levels per active size, once per size", () => {
    expect(slots.filter((s) => s.group === "wash")).toHaveLength(6);
    expect(slots.filter((s) => s.group === "dry")).toHaveLength(3);
  });

  it("ignores retired machines", () => {
    expect(slots.some((s) => s.machine_type === "dry" && s.size_kg === 12)).toBe(false);
  });

  it("adds the spin, dryer extension and item prices", () => {
    expect(slots.filter((s) => s.code === "extra_spin")).toHaveLength(1);
    expect(slots.find((s) => s.code === "dry_extension")?.fixedMinutes).toBe(5);
    expect(slots.filter((s) => s.kind === "item")).toHaveLength(2);
  });
});

describe("priceFor", () => {
  const slot = buildSlots(machines)[0]!;
  const row = (price: number, effective_from: string): PriceRow => ({
    id: effective_from,
    kind: "service",
    code: null,
    machine_type: "wash",
    size_kg: 8,
    level: "clean",
    price,
    default_minutes: 30,
    effective_from,
    created_at: "",
  });

  it("uses the latest price that has started, and reports the next change", () => {
    const rows = [row(80, "2026-01-01"), row(90, "2026-06-01"), row(100, "2026-12-01")];
    const { current, upcoming } = priceFor(rows, slot, "2026-11-13");
    expect(current?.price).toBe(90);
    expect(upcoming?.price).toBe(100);
  });

  it("has no current price before the first one starts", () => {
    expect(priceFor([row(80, "2027-01-01")], slot, "2026-11-13").current).toBeNull();
  });
});
