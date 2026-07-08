// supabase-control/supabase/functions/broker/index.ts
// Phase 8 of the SaaS-scaling plan: real broker actions, extending the
// Phase 7 broker-ping mechanism-proof (see docs/decisions/ADR-0008 and its
// forthcoming Phase 8 addendum/ADR). Same two-client pattern as broker-ping
// and supabase/functions/manage-user: an anon-key client validates the
// caller is a real, active control-plane operator; a service-role client
// then performs the privileged action, crossing into the TARGET tenant's
// own data-plane project using a Vault-decrypted key that is never
// returned to the caller.
//
// Every action writes an entry to broker_audit_log (via the control
// plane's own service-role client, which bypasses that table's RLS) before
// returning — success or failure, but NEVER the value of any secret.
//
// Deliberately out of scope for this action set: inviting/removing a
// data-plane user on an operator's behalf. That overlaps the still-open
// "support access" question (see ADR-0008 and the Phase 8 design notes),
// which needs Privacy/Compliance input before being decided — not
// pre-empted here.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Only these two store keys may ever be read/written through this broker —
// an explicit allowlist, not "any key the caller names."
const ALLOWED_CONFIG_KEYS = ["superconfig", "superconfig-private"];

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

  const controlUrl     = Deno.env.get("SUPABASE_URL")!;
  const controlAnonKey  = Deno.env.get("SUPABASE_ANON_KEY")!;
  const controlSrvKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerSb = createClient(controlUrl, controlAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await callerSb.auth.getUser();
  if (authErr || !user) return json({ error: "Ugyldig token" }, 401);

  const { data: operator } = await callerSb
    .from("operators").select("status").eq("id", user.id).single();
  if (!operator || operator.status !== "active") {
    return json({ error: "Berre aktive operatørar" }, 403);
  }

  const controlSrvSb = createClient(controlUrl, controlSrvKey);

  async function audit(tenantId: string | null, action: string, result: "success" | "error", detail?: string) {
    await controlSrvSb.from("broker_audit_log").insert({
      operator_id: user.id,
      tenant_id: tenantId,
      action,
      result,
      detail: detail || null,
    });
  }

  const body = await req.json().catch(() => ({}));
  const { action, tenant_id } = body;
  if (!tenant_id) return json({ error: "tenant_id er påkrevd" }, 400);

  const { data: tenant, error: tenantErr } = await controlSrvSb
    .from("tenants")
    .select("id, slug, data_plane_url, data_plane_storage_key")
    .eq("id", tenant_id)
    .single();
  if (tenantErr || !tenant) {
    await audit(tenant_id, action, "error", "ukjend tenant");
    return json({ error: "Ukjend tenant" }, 404);
  }

  const { data: tenantServiceKey, error: keyErr } = await controlSrvSb
    .rpc("get_tenant_service_role_key", { p_tenant_id: tenant_id });
  if (keyErr || !tenantServiceKey) {
    await audit(tenant.id, action, "error", "fann ikkje service_role-nøkkel");
    return json({ error: "Fann ikkje service_role-nøkkel" }, 500);
  }

  const tenantSrvSb = createClient(tenant.data_plane_url, tenantServiceKey);
  const storageKey = tenant.data_plane_storage_key;

  // ── get_private_config ──────────────────────────────────────────────────
  // superconfig-private is never anon-readable (RLS requires
  // is_platform_operator() for both read and write) — only reachable via
  // this broker now.
  if (action === "get_private_config") {
    const { data, error } = await tenantSrvSb
      .from("store").select("value")
      .eq("tenant_id", storageKey).eq("key", "superconfig-private")
      .maybeSingle();
    if (error) {
      await audit(tenant.id, action, "error", error.message);
      return json({ error: "Lesing feila" }, 500);
    }
    await audit(tenant.id, action, "success");
    return json({ success: true, value: (data && data.value) || {} });
  }

  // ── set_config ───────────────────────────────────────────────────────────
  if (action === "set_config") {
    const { key, value } = body;
    if (ALLOWED_CONFIG_KEYS.indexOf(key) === -1) {
      await audit(tenant.id, action, "error", "ikkje-tillaten nøkkel: " + key);
      return json({ error: "Ikkje-tillaten nøkkel" }, 400);
    }
    const { error } = await tenantSrvSb
      .from("store")
      .upsert({ tenant_id: storageKey, key, value }, { onConflict: "tenant_id,key" });
    if (error) {
      await audit(tenant.id, action, "error", error.message);
      return json({ error: "Skriving feila" }, 500);
    }
    await audit(tenant.id, action + ":" + key, "success");
    return json({ success: true });
  }

  // ── reset_config ─────────────────────────────────────────────────────────
  if (action === "reset_config") {
    const { error } = await tenantSrvSb
      .from("store").delete()
      .eq("tenant_id", storageKey)
      .in("key", ALLOWED_CONFIG_KEYS);
    if (error) {
      await audit(tenant.id, action, "error", error.message);
      return json({ error: "Nullstilling feila" }, 500);
    }
    await audit(tenant.id, action, "success");
    return json({ success: true });
  }

  // ── get_tenant_status ────────────────────────────────────────────────────
  // Extends the Phase 7 broker-ping mechanism-proof into something an
  // operator dashboard can actually use — read-only, same risk profile.
  if (action === "get_tenant_status") {
    const { data: listResult, error: listErr } = await tenantSrvSb.auth.admin.listUsers({ perPage: 1 });
    if (listErr) {
      await audit(tenant.id, action, "error", listErr.message);
      return json({ error: "Kryss-prosjekt-kall feila", reachable: false }, 500);
    }
    await audit(tenant.id, action, "success");
    return json({
      success: true,
      tenant_slug: tenant.slug,
      reachable: true,
      user_count: typeof listResult.total === "number" ? listResult.total : listResult.users.length,
    });
  }

  await audit(tenant.id, String(action), "error", "ukjend handling");
  return json({ error: "Ukjend handling: " + action }, 400);
});
