import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

const url = import.meta.env["VITE_SUPABASE_URL"];
const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

export const supabaseConfigured = Boolean(url && key);

// Placeholders keep the module loadable when config is missing; App shows a message instead.
export const supabase = createClient<Database>(url || "http://localhost", key || "missing");
