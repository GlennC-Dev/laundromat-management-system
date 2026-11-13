import { vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

export const authMock = {
  session: null as Session | null,
  getSession: vi.fn(async () => ({ data: { session: authMock.session } })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
};

/** Rows returned per table by the chainable query mock below. */
export const dbMock = { tables: {} as Record<string, unknown[]> };

function builder(table: string) {
  const rows = () => dbMock.tables[table] ?? [];
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "insert", "update", "delete"]) b[m] = () => b;
  b["maybeSingle"] = async () => ({ data: rows()[0] ?? null, error: null });
  b["single"] = b["maybeSingle"];
  b["then"] = (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null });
  return b;
}

export const supabaseMock = {
  auth: authMock,
  from: (table: string) => builder(table),
  rpc: vi.fn(),
};

export function fakeSession(email: string): Session {
  return { user: { id: "u1", email } } as unknown as Session;
}

export function setProfile(role: "admin" | "staff", active = true) {
  dbMock.tables["profiles"] = [{ id: "u1", display_name: "Test User", role, active }];
}
