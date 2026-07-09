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
//
// Security Auditor follow-up round 2 (2026-07-09):
// - Every action here now requires operators.role = 'superadmin', not just
//   status = 'active'. This whole function is the newest, least-reviewed
//   write surface in the control plane, and onboarding a customer is rare
//   and high-stakes -- there's no current need for an ordinary operator to
//   call any of these actions.
// - update_tenant_connection / set_tenant_service_role_key now refuse
//   unless the tenant is still status = 'provisioning' (finding 1, HIGH):
//   previously a compromised active operator session could repoint an
//   already-LIVE tenant's data-plane project or swap its service_role key
//   with no status check at all.
// - Mutating actions (register_tenant, update_tenant_connection,
//   set_tenant_service_role_key, verify_tenant_schema, activate_tenant) now
//   write the audit row BEFORE performing the action and abort with 500 if
//   that write fails (finding 4) -- previously an audit-insert failure was
//   only console.error'd and the privileged action proceeded regardless.
// - verify_tenant_schema now persists its result onto
//   tenants.schema_verified_at (set on pass, cleared to NULL on fail), and
//   activate_tenant now requires status = 'provisioning', a non-empty
//   data_plane_url, a stored service_role secret, AND schema_verified_at,
//   in addition to the existing routing_verified_at gate (finding 2) --
//   previously routing_verified_at was the only precondition checked, so a
//   tenant with a blank connection or a never-verified schema could in
//   principle be activated the moment Phase 6 starts setting that column.
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
    .from("operators").select("status, role").eq("id", user.id).single();
  if (!operator || operator.status !== "active") {
    return json({ error: "Berre aktive operatørar" }, 403);
  }
  // Every action in this function is a tenant-onboarding/connection-critical
  // write (or the one cross-project check that gates activation) -- not
  // ordinary day-to-day operator work. Require superadmin uniformly rather
  // than picking and choosing per action.
  if (operator.role !== "superadmin") {
    return json({ error: "Berre superadmin kan utføre kundeadministrasjon" }, 403);
  }

  const controlSrvSb = createClient(controlUrl, controlSrvKey);

  // Fail-closed audit pair for mutating actions: auditStart() writes the
  // attempt BEFORE the privileged action runs and returns null if that
  // insert itself failed (caller must then abort, never perform the
  // action). auditFinish() flips the same row to its terminal result after
  // the action completes -- if THAT update fails there's nothing left to
  // abort, so it only logs to function logs, same as before.
  async function auditStart(tenantId: string | null, action: string): Promise<string | null> {
    const { data, error } = await controlSrvSb
      .from("broker_audit_log")
      .insert({ operator_id: user.id, tenant_id: tenantId, action, result: "pending" })
      .select("id")
      .single();
    if (error) {
      console.error("[tenant-admin] KRITISK: audit-logg (pre-action) feila", { action, tenantId, error: error.message });
      return null;
    }
    return data.id as string;
  }
  async function auditFinish(auditId: string | null, result: "success" | "error", detail?: string) {
    if (!auditId) return;
    const { error } = await controlSrvSb
      .from("broker_audit_log")
      .update({ result, detail: detail || null })
      .eq("id", auditId);
    if (error) {
      console.error("[tenant-admin] KRITISK: audit-logg (post-action) feila", { auditId, result, error: error.message });
    }
  }
  // Non-mutating / already-rejected-before-any-write paths (unknown tenant,
  // unknown action, precondition failures) keep the simpler single-call
  // logger -- nothing has been mutated, so there's nothing to fail closed
  // in front of.
  async function auditReject(tenantId: string | null, action: string, detail: string) {
    const { error } = await controlSrvSb.from("broker_audit_log").insert({
      operator_id: user.id, tenant_id: tenantId, action, result: "error", detail,
    });
    if (error) {
      console.error("[tenant-admin] KRITISK: audit-logg-skriving feila", { action, tenantId, error: error.message });
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
    const auditId = await auditStart(null, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
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
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Registrering feila (finst slugen alt?)" }, 400);
    }
    await auditFinish(auditId, "success");
    return json({ success: true, tenant_id: data.id });
  }

  // Every action below operates on an existing tenant.
  const { tenant_id } = body;
  if (!tenant_id) return json({ error: "tenant_id er påkrevd" }, 400);

  const { data: tenant, error: tenantErr } = await controlSrvSb
    .from("tenants")
    .select("id, slug, data_plane_url, data_plane_storage_key, data_plane_service_role_secret_id, status, schema_verified_at, routing_verified_at")
    .eq("id", tenant_id)
    .single();
  if (tenantErr || !tenant) {
    await auditReject(tenant_id, action, "ukjend tenant");
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
    if (tenant.status !== "provisioning") {
      await auditReject(tenant.id, action, "tenant er ikkje i status 'provisioning' (er: " + tenant.status + ")");
      return json({ error: "Denne handlinga er berre tillate mens kunden er i status 'provisioning'" }, 403);
    }
    const { data_plane_url, data_plane_anon_key } = body;
    if (!data_plane_url || !data_plane_anon_key) {
      return json({ error: "data_plane_url og data_plane_anon_key er påkrevd" }, 400);
    }
    if (!SUPABASE_PROJECT_URL_RE.test(data_plane_url)) {
      await auditReject(tenant.id, action, "ugyldig data_plane_url-format");
      return json({ error: "data_plane_url må vera ein ekte Supabase-prosjekt-URL (https://xxxx.supabase.co)" }, 400);
    }
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { error } = await controlSrvSb
      .from("tenants")
      .update({ data_plane_url, data_plane_anon_key, updated_at: new Date().toISOString() })
      .eq("id", tenant_id);
    if (error) {
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Lagring feila" }, 500);
    }
    await auditFinish(auditId, "success");
    return json({ success: true });
  }

  // ── set_tenant_service_role_key ──────────────────────────────────────────
  // Step 3b: the one place a tenant's service_role key is ever written,
  // via the Vault-backed SQL function -- never stored as a plain column,
  // never logged (only that the action happened).
  if (action === "set_tenant_service_role_key") {
    if (tenant.status !== "provisioning") {
      await auditReject(tenant.id, action, "tenant er ikkje i status 'provisioning' (er: " + tenant.status + ")");
      return json({ error: "Denne handlinga er berre tillate mens kunden er i status 'provisioning'" }, 403);
    }
    const { service_role_key } = body;
    if (!service_role_key) return json({ error: "service_role_key er påkrevd" }, 400);
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const secretName = "tenant-" + tenant.slug + "-service-role-" + Date.now();
    const { error } = await controlSrvSb.rpc("store_tenant_service_role_key", {
      p_tenant_id: tenant_id,
      p_key: service_role_key,
      p_secret_name: secretName,
    });
    if (error) {
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Lagring av nøkkel feila" }, 500);
    }
    await auditFinish(auditId, "success");
    return json({ success: true });
  }

  // ── verify_tenant_schema ─────────────────────────────────────────────────
  // Step 4: a lightweight schema-fingerprint check against the newly
  // provisioned data-plane project -- cross-project, needs the
  // Vault-decrypted key. Confirms a handful of expected tables/functions
  // exist rather than trusting a clean `db push` exit code alone. Now
  // persists the result onto tenants.schema_verified_at (set on pass,
  // cleared on fail) so activate_tenant can actually require it, instead of
  // this being a one-off check whose result only ever reached the caller.
  if (action === "verify_tenant_schema") {
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { data: tenantServiceKey, error: keyErr } = await controlSrvSb
      .rpc("get_tenant_service_role_key", { p_tenant_id: tenant_id });
    if (keyErr || !tenantServiceKey) {
      await auditFinish(auditId, "error", "fann ikkje service_role-nøkkel");
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
      await controlSrvSb.from("tenants").update({ schema_verified_at: null }).eq("id", tenant_id);
      await auditFinish(auditId, "error", rpcErr.message);
      return json({ error: "Skjema-sjekk feila (manglar verify_schema_fingerprint()? køyr migrasjonane først)", reachable: false }, 500);
    }
    const missing = ((rows as { table_name: string; table_exists: boolean }[]) || [])
      .filter((r) => !r.table_exists)
      .map((r) => r.table_name);
    const ok = missing.length === 0;
    await controlSrvSb
      .from("tenants")
      .update({ schema_verified_at: ok ? new Date().toISOString() : null })
      .eq("id", tenant_id);
    await auditFinish(auditId, ok ? "success" : "error", ok ? undefined : "manglar: " + missing.join(","));
    return json({ success: true, schema_ok: ok, missing_tables: missing });
  }

  // ── activate_tenant ───────────────────────────────────────────────────────
  // Step 6. Requires ALL of: status still 'provisioning', a real connection
  // (data_plane_url set), a stored service_role secret, a passing schema
  // verification (schema_verified_at), AND routing_verified_at. The last of
  // these remains a hard, structural gate: nothing in this codebase sets it
  // yet, so this action cannot succeed today regardless of the other four,
  // by design -- Phase 6's real hostname->tenant resolver must exist first.
  if (action === "activate_tenant") {
    const missing: string[] = [];
    if (tenant.status !== "provisioning") missing.push("status må vera 'provisioning' (er: " + tenant.status + ")");
    if (!tenant.data_plane_url) missing.push("tilkoplingsinfo (data_plane_url) manglar");
    if (!tenant.data_plane_service_role_secret_id) missing.push("service_role-nøkkel manglar");
    if (!tenant.schema_verified_at) missing.push("skjema er ikkje verifisert (køyr verify_tenant_schema)");
    if (!tenant.routing_verified_at) missing.push("ruting er ikkje verifisert (Fase 6 manglar)");
    if (missing.length > 0) {
      await auditReject(tenant.id, action, missing.join("; "));
      return json({ error: "Sperra: " + missing.join("; ") }, 403);
    }
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { error } = await controlSrvSb
      .from("tenants")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", tenant_id);
    if (error) {
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Aktivering feila" }, 500);
    }
    await auditFinish(auditId, "success");
    return json({ success: true });
  }

  await auditReject(tenant.id, String(action), "ukjend handling");
  return json({ error: "Ukjend handling: " + action }, 400);
});
