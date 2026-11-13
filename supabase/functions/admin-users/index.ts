// Admin-only user management. Creating logins and setting passwords needs the service role,
// which must never reach the browser, so it lives here. Every call is checked against the
// caller's own role first.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MIN_PASSWORD = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: role, error: roleError } = await caller.rpc("app_role");
  if (roleError || role !== "admin") return json({ error: "Admins only" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const admin = createClient(url, serviceKey);

  if (body.action === "list") {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (error) return json({ error: error.message }, 500);
    return json({ users: data.users.map((u) => ({ id: u.id, email: u.email ?? null })) });
  }

  if (body.action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const displayName = String(body.display_name ?? "").trim();
    const newRole = body.role === "admin" ? "admin" : "staff";
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return json({ error: "Enter a valid login email" }, 400);
    if (password.length < MIN_PASSWORD) return json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, 400);
    if (!displayName) return json({ error: "Enter a name" }, 400);

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error || !data.user) return json({ error: error?.message ?? "Could not create the user" }, 400);
    if (newRole === "admin") {
      const { error: promoteError } = await admin.from("profiles").update({ role: "admin" }).eq("id", data.user.id);
      if (promoteError) return json({ error: promoteError.message }, 500);
    }
    return json({ id: data.user.id });
  }

  if (body.action === "set_password") {
    const id = String(body.id ?? "");
    const password = String(body.password ?? "");
    if (!id) return json({ error: "Missing user" }, 400);
    if (password.length < MIN_PASSWORD) return json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, 400);
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
