import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

/** Calls the admin-users edge function and surfaces its error message. */
export async function adminUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detail = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(detail?.error ?? error.message);
    }
    throw error;
  }
  return data as T;
}
