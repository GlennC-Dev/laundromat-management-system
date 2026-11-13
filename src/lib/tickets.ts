import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { Enums, Tables } from "@/lib/database.types";
import { priceFor, type PriceRow } from "@/lib/price-slots";
import { supabase } from "@/lib/supabase";

export type Machine = Tables<"machines">;
export type Ticket = Tables<"tickets">;

export function useMachines() {
  return useQuery({
    queryKey: ["machines"],
    queryFn: async () => {
      const { data, error } = await supabase.from("machines").select("*").order("label");
      if (error) throw error;
      return data;
    },
  });
}

export function usePriceList() {
  return useQuery({
    queryKey: ["price_list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("price_list").select("*").order("effective_from");
      if (error) throw error;
      return data;
    },
  });
}

export function useStockLevels() {
  return useQuery({
    queryKey: ["stock_levels"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("stock_levels");
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Open (pending, unvoided) tickets, kept fresh by realtime plus a slow poll. Realtime alone is not
 * enough: staff lose read access to a ticket the moment it completes, so that update never reaches them.
 */
export function useOpenTickets() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("open-tickets")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => {
        void qc.invalidateQueries({ queryKey: ["open_tickets"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  return useQuery({
    queryKey: ["open_tickets"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select("*")
        .eq("status", "pending")
        .is("voided_at", null)
        .order("started_at");
      if (error) throw error;
      return data;
    },
  });
}

/** Re-renders every `ms` so countdowns stay current. */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export type RunState = { kind: "running"; msLeft: number } | { kind: "done"; msOver: number };

/** "Done" is derived from the scheduled end, never stored. */
export function runState(ticket: Pick<Ticket, "ends_at">, now: number): RunState {
  const diff = new Date(ticket.ends_at).getTime() - now;
  return diff > 0 ? { kind: "running", msLeft: diff } : { kind: "done", msOver: -diff };
}

export function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "under 1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min`;
}

export function levelsFor(type: Machine["type"]): Enums<"service_level">[] {
  return type === "wash" ? ["clean", "cleaner", "cleanest"] : ["dry", "drier", "driest"];
}

type PriceKey = Parameters<typeof priceFor>[1];

/** Price in effect today for one thing, or null if none is set. */
export function unitPrice(rows: PriceRow[], key: PriceKey, today: string): PriceRow | null {
  return priceFor(rows, key, today).current;
}

export const PAYMENT_LABEL = {
  cash: "Cash",
  gcash: "GCash",
  maya: "Maya",
  bank_transfer: "Bank transfer",
  card: "Card",
} as const;
