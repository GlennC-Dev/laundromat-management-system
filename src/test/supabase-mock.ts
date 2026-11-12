import { vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

export const authMock = {
  session: null as Session | null,
  getSession: vi.fn(async () => ({ data: { session: authMock.session } })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
};

export function fakeSession(email: string): Session {
  return { user: { id: "u1", email } } as unknown as Session;
}
