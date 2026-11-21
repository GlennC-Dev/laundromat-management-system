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
  for (const m of [
    "select",
    "eq",
    "is",
    "in",
    "not",
    "gte",
    "lt",
    "range",
    "order",
    "limit",
    "insert",
    "update",
    "delete",
  ])
    b[m] = () => b;
  b["maybeSingle"] = async () => ({ data: rows()[0] ?? null, error: null });
  b["single"] = b["maybeSingle"];
  b["then"] = (resolve: (v: unknown) => unknown) =>
    resolve({ data: rows(), error: null, count: rows().length });
  return b;
}

type RealtimeChannelMock = {
  topic: string;
  subscribed: boolean;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
};

const realtimeChannels = new Map<string, RealtimeChannelMock>();

function makeChannel(topic: string): RealtimeChannelMock {
  const channel: RealtimeChannelMock = {
    topic,
    subscribed: false,
    on: vi.fn(() => {
      if (channel.subscribed) throw new Error("Cannot register listeners after subscribing");
      return channel;
    }),
    subscribe: vi.fn(() => {
      channel.subscribed = true;
      return channel;
    }),
  };
  return channel;
}

export const realtimeMock = { channels: realtimeChannels };

export function resetRealtimeMock() {
  realtimeChannels.clear();
}

export const supabaseMock = {
  auth: authMock,
  from: (table: string) => builder(table),
  rpc: vi.fn(async () => ({ data: [], error: null })),
  functions: { invoke: vi.fn(async () => ({ data: { ok: true }, error: null })) },
  channel: (topic: string) => {
    const existing = realtimeChannels.get(topic);
    if (existing) return existing;
    const channel = makeChannel(topic);
    realtimeChannels.set(topic, channel);
    return channel;
  },
  removeChannel: vi.fn(),
};

export function fakeSession(email: string): Session {
  return { user: { id: "u1", email } } as unknown as Session;
}

export function setProfile(role: "admin" | "staff", active = true) {
  dbMock.tables["profiles"] = [{ id: "u1", display_name: "Test User", role, active }];
}
