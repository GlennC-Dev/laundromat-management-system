import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import type { Tables } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

export type Profile = Pick<Tables<"profiles">, "id" | "display_name" | "role" | "active">;

/** The signed-in user's profile; null data means no profile row (no access). */
export function useProfile() {
  const { session } = useAuth();
  const uid = session?.user.id;
  return useQuery({
    queryKey: ["profile", uid],
    enabled: Boolean(uid),
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, role, active")
        .eq("id", uid!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
