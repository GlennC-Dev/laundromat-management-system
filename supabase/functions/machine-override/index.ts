// Take a machine out of service, or bring it back, with admin override (same idea as void-override).
// A staff member is signed in on the till; an admin types their own email and password to authorise one
// change. The admin's credentials are used on a throwaway client (nothing persisted), so the staff
// session is untouched and the change is recorded under the admin, with the requesting staff member
// in the note.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // The requester must be a signed-in, active user.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerRole } = await caller.rpc("app_role");
  if (!callerRole) return json({ error: "Sign in first" }, 401);
  const { data: callerUser } = await caller.auth.getUser();
  const { data: callerProfile } = await caller
    .from("profiles")
    .select("display_name")
    .eq("id", callerUser.user?.id ?? "")
    .maybeSingle();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const machineId = String(body.machine_id ?? "");
  const action = String(body.action ?? "");
  const reason = String(body.reason ?? "");
  const note = String(body.note ?? "").trim();
  const email = String(body.admin_email ?? "").trim().toLowerCase();
  const password = String(body.admin_password ?? "");
  if (!machineId) return json({ error: "Missing machine" }, 400);
  if (action !== "down" && action !== "up") return json({ error: "Invalid request" }, 400);
  if (action === "down" && !reason) return json({ error: "Pick a reason" }, 400);
  if (action === "down" && reason === "other" && !note) return json({ error: "Describe the problem" }, 400);
  if (!email || !password) return json({ error: "Enter the admin email and password" }, 400);

  const adminClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await adminClient.auth.signInWithPassword({ email, password });
  // One message for every credential problem so this cannot be used to probe which emails exist.
  if (signInError) return json({ error: "Admin email or password is incorrect" }, 403);

  const { data: adminRole } = await adminClient.rpc("app_role");
  if (adminRole !== "admin") return json({ error: "That account is not an admin" }, 403);

  const requester = callerProfile?.display_name ?? "staff";
  const fullNote = `${note ? `${note} ` : ""}(override requested by ${requester})`;
  const { error } =
    action === "down"
      ? await adminClient.rpc("take_machine_down", { p_machine_id: machineId, p_reason: reason, p_note: fullNote })
      : await adminClient.rpc("bring_machine_up", { p_machine_id: machineId, p_note: fullNote });
  await adminClient.auth.signOut({ scope: "local" });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
});
