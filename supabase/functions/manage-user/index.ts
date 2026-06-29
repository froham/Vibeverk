// supabase/functions/manage-user/index.ts
// Handterest brukarliv-syklusen: invite, remove.
// Krev service_role-nøkkel — aldri eksponer til klient.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Ikkje autorisert" }, 401);

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
  const serviceKey     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey        = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Verifiser at kallaren er innlogga og har owner/admin-rolle
  const callerSb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await callerSb.auth.getUser();
  if (authErr || !user) return json({ error: "Ugyldig token" }, 401);

  const adminSb = createClient(supabaseUrl, serviceKey);

  // Rolle-sjekk via autentisert brukar (callerSb) — unngår service_role-avhengigheit for oppslaget
  const { data: caller } = await callerSb.from("users").select("role").eq("id", user.id).single();
  if (!caller || caller.role !== "admin") {
    return json({ error: "Berre admin kan administrere brukarar" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  // ── INVITE ──────────────────────────────────────────────────────────────────
  if (action === "invite") {
    const { email, role = "member", display_name = "", redirect_to = "" } = body;
    if (!email) return json({ error: "E-post er påkrevd" }, 400);

    // Maks 50 brukarar per tenant
    const { count } = await adminSb
      .from("users").select("id", { count: "exact", head: true });
    if ((count ?? 0) >= 50) return json({ error: "Maks 50 brukarar" }, 400);

    const inviteOpts: { data: Record<string, string>; redirectTo?: string } = {
      data: { role, display_name: display_name || email.split("@")[0] },
    };
    if (redirect_to) inviteOpts.redirectTo = redirect_to;

    const { data, error } = await adminSb.auth.admin.inviteUserByEmail(email, inviteOpts);
    if (error) return json({ error: error.message }, 400);
    return json({ success: true, id: data.user.id });
  }

  // ── REMOVE ──────────────────────────────────────────────────────────────────
  if (action === "remove") {
    const { user_id } = body;
    if (!user_id) return json({ error: "user_id er påkrevd" }, 400);
    if (user_id === user.id) return json({ error: "Kan ikkje slette deg sjølv" }, 400);

    const { error } = await adminSb.auth.admin.deleteUser(user_id);
    if (error) return json({ error: error.message }, 400);
    return json({ success: true });
  }

  return json({ error: "Ukjend handling: " + action }, 400);
});
