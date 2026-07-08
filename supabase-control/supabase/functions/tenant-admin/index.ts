// supabase-control/supabase/functions/tenant-admin/index.ts
// Phase 9 of the SaaS-scaling plan: semi-automated onboarding v1, narrowly
// scoped per the Architect's recommendation (2026-07-08, see the Phase 9
// design notes and the original plan file). Handles CONTROL-PLANE-ONLY
// tenant-registry writes (register/update/activate) plus the one
// cross-project action needed to verify a newly provisioned schema.
//
// Kept separate from broker/index.ts (which handles the already-audited
// cross-project config actions) so this new, less-reviewed write surface
// doesn't touch that function's tested code path.
//
// Same two-client pattern throughout: anon-key client validates the caller
// is a real, active control-plane operator; a service-role client then
// performs the privileged action. Same audit table as broker
// (broker_audit_log) for a single, consistent trail.
//
// HARD GATE: activate_tenant refuses unconditionally until Phase 6's real
// hostname->tenant resolver exists and sets tenants.routing_verified_at --
// nothing in this function, or anywhere else yet, ever sets that column.
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

  const controlUrl     = Deno.env.get("SUPABASE_URL")!;
  const controlAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const controlSrvKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    const { error: auditErr } = await controlSrvSb.from("broker_audit_log").insert({
      operator_id: user.id,
      tenant_id: tenantId,
      action,
      result,
      detail: detail || null,
    });
    if (auditErr) {
      console.error("[tenant-admin] KRITISK: audit-logg-skriving feila", { action, tenantId, auditErr: auditErr.message });
    }
  }

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  // ── register_tenant ──────────────────────────────────────────────────────
  // Step 1 of the checklist. Creates the tenants row; status is always
  // 'provisioning' regardless of what the caller sends (a new tenant is
  // never created any other way).
  if (action === "register_tenant") {
    const { slug, hostnames, data_plane_storage_key } = body;
    if (!slug || !data_plane_storage_key) {
      return json({ error: "slug og data_plane_storage_key er påkrevd" }, 400);
    }
    const { data, error } = await controlSrvSb
      .from("tenants")
      .insert({
        slug,
        hostnames: Array.isArray(hostnames) ? hostnames : [],
        data_plane_storage_key,
        data_plane_url: "",
        data_plane_anon_key: "",
        status: "provisioning",
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error) {
      await audit(null, action, "error", error.message);
      return json({ error: "Registrering feila (finst slugen alt?)" }, 400);
    }
    await audit(data.id, action, "success");
    return json({ success: true, tenant_id: data.id });
  }

  // Every action below operates on an existing tenant.
  const { tenant_id } = body;
  if (!tenant_id) return json({ error: "tenant_id er påkrevd" }, 400);

  const { data: tenant, error: tenantErr } = await controlSrvSb
    .from("tenants")
    .select("id, slug, data_plane_url, data_plane_storage_key, status, routing_verified_at")
    .eq("id", tenant_id)
    .single();
  if (tenantErr || !tenant) {
    await audit(tenant_id, action, "error", "ukjend tenant");
    return json({ error: "Ukjend tenant" }, 404);
  }

  // ── update_tenant_connection ─────────────────────────────────────────────
  // Step 2/3 of the checklist: paste in the newly created project's URL +
  // anon key (both non-secret, safe to store as plain columns).
  //
  // Security Auditor finding M1 (2026-07-09, Phase 9 follow-up review):
  // data_plane_url previously accepted any string, which verify_tenant_schema
  // then used as an outbound request target using an operator-supplied
  // key -- an SSRF-adjacent relay primitive once more than one operator
  // exists. Restricted to the real Supabase project-URL shape.
  const SUPABASE_PROJECT_URL_RE = /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/;
  if (action === "update_tenant_connection") {
    const { data_plane_url, data_plane_anon_key } = body;
    if (!data_plane_url || !data_plane_anon_key) {
      return json({ error: "data_plane_url og data_plane_anon_key er påkrevd" }, 400);
    }
    if (!SUPABASE_PROJECT_URL_RE.test(data_plane_url)) {
      await audit(tenant.id, action, "error", "ugyldig data_plane_url-format");
      return json({ error: "data_plane_url må vera ein ekte Supabase-prosjekt-URL (https://xxxx.supabase.co)" }, 400);
    }
    const { error } = await controlSrvSb
      .from("tenants")
      .update({ data_plane_url, data_plane_anon_key, updated_at: new Date().toISOString() })
      .eq("id", tenant_id);
    if (error) {
      await audit(tenant.id, action, "error", error.message);
      return json({ error: "Lagring feila" }, 500);
    }
    await audit(tenant.id, action, "success");
    return json({ success: true });
  }

  // ── set_tenant_service_role_key ──────────────────────────────────────────
  // Step 3b: the one place a tenant's service_role key is ever written,
  // via the Vault-backed SQL function -- never stored as a plain column,
  // never logged (only that the action happened).
  if (action === "set_tenant_service_role_key") {
    const { service_role_key } = body;
    if (!service_role_key) return json({ error: "service_role_key er påkrevd" }, 400);
    const secretName = "tenant-" + tenant.slug + "-service-role-" + Date.now();
    const { error } = await controlSrvSb.rpc("store_tenant_service_role_key", {
      p_tenant_id: tenant_id,
      p_key: service_role_key,
      p_secret_name: secretName,
    });
    if (error) {
      await audit(tenant.id, action, "error", error.message);
      return json({ error: "Lagring av nøkkel feila" }, 500);
    }
    await audit(tenant.id, action, "success");
    return json({ success: true });
  }

  // ── verify_tenant_schema ─────────────────────────────────────────────────
  // Step 4: a lightweight schema-fingerprint check against the newly
  // provisioned data-plane project -- cross-project, needs the
  // Vault-decrypted key. Confirms a handful of expected tables/functions
  // exist rather than trusting a clean `db push` exit code alone.
  if (action === "verify_tenant_schema") {
    const { data: tenantServiceKey, error: keyErr } = await controlSrvSb
      .rpc("get_tenant_service_role_key", { p_tenant_id: tenant_id });
    if (keyErr || !tenantServiceKey) {
      await audit(tenant.id, action, "error", "fann ikkje service_role-nøkkel");
      return json({ error: "Fann ikkje service_role-nøkkel — steg 3 må gjerast først" }, 400);
    }
    const tenantSrvSb = createClient(tenant.data_plane_url, tenantServiceKey);
    // Relies on verify_schema_fingerprint() existing in the tenant's own
    // project (added to the baseline migrations, see
    // supabase/migrations/20260708212124_add_schema_fingerprint_rpc.sql) --
    // if it's missing entirely, that itself means the schema push hasn't
    // been run yet or used an older baseline.
    const { data: rows, error: rpcErr } = await tenantSrvSb.rpc("verify_schema_fingerprint");
    if (rpcErr) {
      await audit(tenant.id, action, "error", rpcErr.message);
      return json({ error: "Skjema-sjekk feila (manglar verify_schema_fingerprint()? køyr migrasjonane først)", reachable: false }, 500);
    }
    const missing = ((rows as { table_name: string; table_exists: boolean }[]) || [])
      .filter((r) => !r.table_exists)
      .map((r) => r.table_name);
    const ok = missing.length === 0;
    await audit(tenant.id, action, ok ? "success" : "error", ok ? undefined : "manglar: " + missing.join(","));
    return json({ success: true, schema_ok: ok, missing_tables: missing });
  }

  // ── activate_tenant ───────────────────────────────────────────────────────
  // Step 6, hard-gated: refuses unconditionally until routing_verified_at
  // is set by a future Phase 6 process. Nothing in this codebase sets that
  // column yet -- this action cannot succeed today, by design.
  if (action === "activate_tenant") {
    if (!tenant.routing_verified_at) {
      await audit(tenant.id, action, "error", "routing_verified_at er ikkje sett (Fase 6 manglar)");
      return json({
        error: "Sperra: den ekte domene-ruteren (Fase 6) er ikkje bygd enno, så denne kunden kan ikkje setjast aktiv. Sjå ADR-0007/Fase 9-notat.",
      }, 403);
    }
    const { error } = await controlSrvSb
      .from("tenants")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", tenant_id);
    if (error) {
      await audit(tenant.id, action, "error", error.message);
      return json({ error: "Aktivering feila" }, 500);
    }
    await audit(tenant.id, action, "success");
    return json({ success: true });
  }

  await audit(tenant.id, String(action), "error", "ukjend handling");
  return json({ error: "Ukjend handling: " + action }, 400);
});
