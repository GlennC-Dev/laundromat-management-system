import { callFunction } from "@/lib/edge";

/** Calls the admin-users edge function and surfaces its error message. */
export const adminUsers = <T>(body: Record<string, unknown>) =>
  callFunction<T>("admin-users", body);
