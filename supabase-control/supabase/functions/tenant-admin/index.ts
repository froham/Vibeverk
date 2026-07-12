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
//
// Security Auditor pre-merge review of the round-2 changes above (2026-07-09)
// found two further MEDIUM gaps, also fixed here:
// - M1 (TOCTOU): the new status guards were check-then-act in application
//   code, not enforced by the database itself -- two near-simultaneous
//   requests could both pass the JS-level "status === provisioning" check
//   before either write landed. The actual UPDATE statements for
//   update_tenant_connection and activate_tenant now repeat the status
//   condition (`.eq("status", "provisioning")`) so the guard is enforced by
//   the single atomic UPDATE itself, not just the earlier read; a zero-row
//   result is treated as the precondition no longer holding. The same fix
//   is applied inside store_tenant_service_role_key() (SQL function, see
//   this round's migration) since that write happens via RPC, not a plain
//   .update() call here.
// - M2: authorization failures (inactive operator, wrong role) were not
//   audit-logged at all -- every other rejection path in this file writes
//   to broker_audit_log, but a probing or compromised-but-unauthorized
//   caller left zero trace. Body parsing moved earlier so action/tenant_id
//   are available to log even on an auth failure.
//
// Phase 6 (2026-07-09, Architect-designed, see ADR-0007's Phase 6 addendum):
// new verify_tenant_routing action -- the one thing in this codebase that
// can ever set routing_verified_at, which activate_tenant already required
// unconditionally. Needed a companion migration
// (20260709170108_phase6_hostname_resolver_hardening.sql) widening
// resolve_tenant_by_hostname() to also resolve 'provisioning' tenants
// (otherwise this action's own outbound check could never succeed -- a
// tenant not yet active was previously unresolvable, so routing could
// never be verified, so it could never activate) and adding a
// hostname-uniqueness trigger.
//
// Security Auditor pre-merge review of Phase 6 (2026-07-09), verdict
// CAUTION -- 2 HIGH + 1 MEDIUM + 2 LOW, all fixed before merge:
// - H1: HOSTNAME_RE's own comment claimed it rejected bare IP literals; it
//   didn't -- "127.0.0.1"/"169.254.169.254" (cloud metadata) matched the
//   domain shape fine, handing an SSRF-adjacent outbound-fetch target to
//   verify_tenant_routing. Fixed via IPV4_LITERAL_RE plus a real DNS
//   resolution + private/reserved-range check (assertHostnameSafeToFetch)
//   before any fetch to an operator-supplied hostname.
// - H2: widening resolve_tenant_by_hostname() to 'provisioning' tenants
//   means a tenant's real hostname (and real Supabase credentials) can go
//   publicly live before activate_tenant's gate ever runs -- and
//   verify_tenant_schema previously only checked tables EXIST, not that
//   RLS was enabled on them. Fixed: verify_schema_fingerprint() (customer
//   baseline, see supabase/migrations/20260709193227_...) now also reports
//   rls_enabled per table; verify_tenant_schema requires it, same as
//   table existence. **Follow-up, 2026-07-09**: the auditor's own review
//   noted this narrowed but didn't eliminate the exposure window -- a
//   tenant was still publicly resolvable from the moment it merely had a
//   hostname+connection registered (steps 1-3), before schema_verified_at
//   was ever set (step 4). Closed via migration
//   20260709224325_close_provisioning_tenant_exposure_window.sql:
//   resolve_tenant_by_hostname() now only resolves a 'provisioning' tenant
//   once schema_verified_at is non-null. verify_tenant_routing (below) now
//   checks that precondition explicitly too, for a clear error instead of
//   a confusing per-hostname "HTTP 404" if called out of order.
// - M1: the hostname-uniqueness trigger (this round's migration) was a
//   real TOCTOU race under READ COMMITTED -- fixed with a fixed-key
//   pg_advisory_xact_lock serializing hostname-mutating transactions.
// - L1: the migration's DROP+CREATE of resolve_tenant_by_hostname() was
//   missing NOTIFY pgrst, 'reload schema' -- added.
// - L2: verify_tenant_routing's outbound fetch had no timeout or response
//   size bound -- added a 5s AbortController timeout and a 64KB read cap.
//
// Second-opinion review (2026-07-09/10), Codex external review + 4 parallel
// read-only Claude reviewers, synthesized and fixed together with a Console
// write-race (console-core.js) and a CFG-fallback leak (console-core.js) --
// 2 findings landed here:
// - Redirect-following gap: fetch() in verify_tenant_routing had no
//   `redirect` option, so it followed 3xx responses automatically -- a
//   hostname that passed assertHostnameSafeToFetch could still 30x-redirect
//   to an unvalidated/private target, and this action would fetch AND trust
//   that response. Fixed with `redirect: "manual"` plus explicit rejection
//   of any 3xx/opaqueredirect result.
// - IPv6/AAAA gap: isPrivateOrReservedIp() already had IPv6 patterns
//   (::1, fe80::/10, fc00::/7) but they were unreachable -- only "A" records
//   were ever resolved, so a hostname resolving solely to a private AAAA
//   target slipped through unchecked. Fixed by also resolving "AAAA" in
//   assertHostnameSafeToFetch and checking those results too; a normal
//   "no AAAA record" lookup failure is not treated as blocking (only "A"
//   failures are, unchanged from before).
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

  // Parsed early (before the operator checks below) so a rejected
  // authorization attempt can still be logged with the action/tenant_id it
  // was trying to reach (M2 fix) -- previously this happened after, so an
  // unauthorized caller left zero trace.
  const body = await req.json().catch(() => ({}));
  const { action, tenant_id } = body;

  const controlSrvSb = createClient(controlUrl, controlSrvKey);

  async function auditReject(tenantId: string | null, actionName: string, detail: string) {
    const { error } = await controlSrvSb.from("broker_audit_log").insert({
      operator_id: user.id, tenant_id: tenantId, action: actionName, result: "error", detail,
    });
    if (error) {
      console.error("[tenant-admin] KRITISK: audit-logg-skriving feila", { actionName, tenantId, error: error.message });
    }
  }

  const { data: operator } = await callerSb
    .from("operators").select("status, role").eq("id", user.id).single();
  if (!operator || operator.status !== "active") {
    await auditReject(tenant_id || null, action || "ukjend", "avvist: ikkje aktiv operatør");
    return json({ error: "Berre aktive operatørar" }, 403);
  }
  // Every action in this function is a tenant-onboarding/connection-critical
  // write (or the one cross-project check that gates activation) -- not
  // ordinary day-to-day operator work. Require superadmin uniformly rather
  // than picking and choosing per action.
  if (operator.role !== "superadmin") {
    await auditReject(tenant_id || null, action || "ukjend", "avvist: ikkje superadmin (rolle: " + operator.role + ")");
    return json({ error: "Berre superadmin kan utføre kundeadministrasjon" }, 403);
  }

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
  // auditReject (used above for the auth-failure paths too) covers the rest
  // of the non-mutating / already-rejected-before-any-write paths below
  // (unknown tenant, unknown action, precondition failures) -- nothing has
  // been mutated in any of those, so there's nothing to fail closed in
  // front of.

  // Real domain-name shape, no protocol/port/path, no bare "localhost"
  // (requires at least one dot) -- used both when registering a tenant's
  // hostnames and when verify_tenant_routing decides which hostnames it's
  // safe to make an outbound request to (Phase 6).
  //
  // Security Auditor finding H1 (Phase 6 pre-merge review, 2026-07-09):
  // this regex alone does NOT reject a bare IPv4 literal like "127.0.0.1"
  // or "169.254.169.254" (a cloud metadata address) -- digits satisfy the
  // same character class as letters, so an all-numeric hostname still
  // matches the domain shape. A prior version of this comment claimed
  // otherwise; that claim was wrong. Fixed via the explicit
  // IPV4_LITERAL_RE check below, used everywhere HOSTNAME_RE is checked.
  const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
  const IPV4_LITERAL_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

  function isPrivateOrReservedIp(ip: string): boolean {
    const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
    if (v4) {
      const a = parseInt(v4[1], 10);
      const b = parseInt(v4[2], 10);
      if (a === 10) return true;
      if (a === 127) return true;
      if (a === 169 && b === 254) return true; // link-local, includes the 169.254.169.254 cloud metadata address
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 0) return true;
      return false;
    }
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local fc00::/7
    return false;
  }

  // Full safety check before any outbound fetch to an operator-supplied
  // hostname (Security Auditor finding H1): shape, bare-IP rejection, AND
  // a real server-side DNS resolution to reject private/loopback/
  // link-local targets -- closes the gap a syntax-only check leaves open
  // (a legitimate-looking domain name whose DNS happens to point at
  // internal infrastructure). Does NOT fully close DNS-rebinding (the
  // resolved address could change between this check and the fetch() a
  // moment later) -- accepted residual risk given this action is already
  // superadmin-only and every outcome is audit-logged; see this round's
  // ADR-0007 addendum.
  async function assertHostnameSafeToFetch(hostname: string): Promise<{ safe: boolean; reason?: string }> {
    if (!HOSTNAME_RE.test(hostname)) return { safe: false, reason: "ugyldig hostname-format" };
    if (IPV4_LITERAL_RE.test(hostname)) return { safe: false, reason: "IP-adresser er ikkje tillatne som hostname" };
    let aRecords: string[];
    try {
      aRecords = await Deno.resolveDns(hostname, "A");
    } catch (e) {
      return { safe: false, reason: "DNS-oppslag (A) feila: " + (e instanceof Error ? e.message : "ukjend feil") };
    }
    // Codex-runde 2026-07-09: isPrivateOrReservedIp() hadde alt IPv6-mønster
    // (::1, fe80::/10, fc00::/7), men dei var uoppnåelege sidan berre "A"
    // vart slått opp -- ein hostname med KUN ein privat AAAA-post (ingen A)
    // slapp gjennom usjekka. Manglande AAAA-postar er normalt (dei fleste
    // domene har berre A) og skal IKKJE blokkerast som feil.
    let aaaaRecords: string[] = [];
    try {
      aaaaRecords = await Deno.resolveDns(hostname, "AAAA");
    } catch {
      aaaaRecords = [];
    }
    for (const ip of [...aRecords, ...aaaaRecords]) {
      if (isPrivateOrReservedIp(ip)) {
        return { safe: false, reason: "hostname løyser til ei privat/reservert IP-adresse" };
      }
    }
    return { safe: true };
  }

  // ── register_tenant ──────────────────────────────────────────────────────
  // Step 1 of the checklist. Creates the tenants row; status is always
  // 'provisioning' regardless of what the caller sends (a new tenant is
  // never created any other way).
  if (action === "register_tenant") {
    const { slug, hostnames, data_plane_storage_key } = body;
    if (!slug || !data_plane_storage_key) {
      return json({ error: "slug og data_plane_storage_key er påkrevd" }, 400);
    }
    const cleanHostnames = (Array.isArray(hostnames) ? hostnames : [])
      .map((h: unknown) => String(h).trim().toLowerCase())
      .filter((h: string) => h.length > 0);
    const badHostname = cleanHostnames.find((h: string) => !HOSTNAME_RE.test(h) || IPV4_LITERAL_RE.test(h));
    if (badHostname) {
      return json({ error: "Ugyldig hostname-format: " + badHostname }, 400);
    }
    const auditId = await auditStart(null, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { data, error } = await controlSrvSb
      .from("tenants")
      .insert({
        slug,
        hostnames: cleanHostnames,
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
      // The hostname-overlap trigger (Phase 6 migration) raises a Postgres
      // exception if a hostname is already claimed by another tenant --
      // surface that distinctly rather than the generic "finst slugen alt?"
      // message, which would be misleading here.
      if (error.message && error.message.indexOf("already registered to another tenant") !== -1) {
        return json({ error: "Ein eller fleire hostnames er alt registrert på ein annan kunde" }, 409);
      }
      return json({ error: "Registrering feila (finst slugen alt?)" }, 400);
    }
    await auditFinish(auditId, "success");
    return json({ success: true, tenant_id: data.id });
  }

  // Every action below operates on an existing tenant (tenant_id already
  // destructured above, alongside action, for the auth-failure audit path).
  if (!tenant_id) return json({ error: "tenant_id er påkrevd" }, 400);

  const { data: tenant, error: tenantErr } = await controlSrvSb
    .from("tenants")
    .select("id, slug, hostnames, data_plane_url, data_plane_anon_key, data_plane_storage_key, data_plane_service_role_secret_id, status, schema_verified_at, routing_verified_at")
    .eq("id", tenant_id)
    .single();
  if (tenantErr || !tenant) {
    await auditReject(tenant_id, action, "ukjend tenant");
    return json({ error: "Ukjend tenant" }, 404);
  }

  // ── update_tenant_hostnames ──────────────────────────────────────────────
  // Step 1 of the checklist ("Registrert") had no edit path at all until
  // now -- register_tenant only ever creates a row, once. Typos happen, and
  // a tenant commonly moves from a temporary test domain to its real one
  // just before go-live, so requiring a brand-new tenant row for that is
  // unnecessary friction. Same status gate, hostname validation, and
  // hostname-overlap-trigger error mapping as register_tenant.
  //
  // Also resets routing_verified_at AND schema_verified_at: a routing check
  // against the OLD hostnames says nothing about whether the NEW ones
  // actually route -- without this, activate_tenant could activate a
  // tenant off a stale verification for hostnames that no longer apply.
  //
  // Security review finding (2026-07-12): resolve_tenant_by_hostname() (see
  // 20260709224325_close_provisioning_tenant_exposure_window.sql) is
  // anon-callable and exposes a 'provisioning' tenant's data_plane_url/
  // data_plane_anon_key/theme/etc. for any of its hostnames gated SOLELY on
  // schema_verified_at IS NOT NULL -- it never checks routing_verified_at.
  // Resetting only routing_verified_at here left schema_verified_at (set
  // for the OLD hostnames) still valid for the NEW ones, so switching a
  // tenant's hostname after schema verification would immediately expose
  // the new hostname's connection info via that anon RPC, before routing
  // was ever verified for it. Must reset both together.
  if (action === "update_tenant_hostnames") {
    if (tenant.status !== "provisioning") {
      await auditReject(tenant.id, action, "tenant er ikkje i status 'provisioning' (er: " + tenant.status + ")");
      return json({ error: "Denne handlinga er berre tillate mens kunden er i status 'provisioning'" }, 403);
    }
    const { hostnames } = body;
    const cleanHostnames = (Array.isArray(hostnames) ? hostnames : [])
      .map((h: unknown) => String(h).trim().toLowerCase())
      .filter((h: string) => h.length > 0);
    const badHostname = cleanHostnames.find((h: string) => !HOSTNAME_RE.test(h) || IPV4_LITERAL_RE.test(h));
    if (badHostname) {
      return json({ error: "Ugyldig hostname-format: " + badHostname }, 400);
    }
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { data: updated, error } = await controlSrvSb
      .from("tenants")
      .update({ hostnames: cleanHostnames, routing_verified_at: null, schema_verified_at: null, updated_at: new Date().toISOString() })
      .eq("id", tenant_id)
      .eq("status", "provisioning")
      .select("id");
    if (error) {
      await auditFinish(auditId, "error", error.message);
      if (error.message && error.message.indexOf("already registered to another tenant") !== -1) {
        return json({ error: "Ein eller fleire hostnames er alt registrert på ein annan kunde" }, 409);
      }
      return json({ error: "Lagring feila" }, 500);
    }
    if (!updated || updated.length === 0) {
      await auditFinish(auditId, "error", "status endra seg mens handlinga køyrde");
      return json({ error: "Tenanten er ikkje lenger i status 'provisioning' — prøv igjen" }, 409);
    }
    await auditFinish(auditId, "success");
    return json({ success: true });
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
    // Security Auditor pre-merge finding M1: repeat the status condition on
    // the actual UPDATE (not just the earlier JS-level read above) so the
    // guard is enforced atomically against the row's state at write time --
    // closes the window where a concurrent activate_tenant could flip the
    // tenant to 'active' between the read at the top of this request and
    // this write.
    const { data: updated, error } = await controlSrvSb
      .from("tenants")
      .update({ data_plane_url, data_plane_anon_key, updated_at: new Date().toISOString() })
      .eq("id", tenant_id)
      .eq("status", "provisioning")
      .select("id");
    if (error) {
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Lagring feila" }, 500);
    }
    if (!updated || updated.length === 0) {
      await auditFinish(auditId, "error", "status endra seg mens handlinga køyrde");
      return json({ error: "Tenanten er ikkje lenger i status 'provisioning' — prøv igjen" }, 409);
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
    // Security Auditor pre-merge finding M1: store_tenant_service_role_key()
    // itself now re-checks status = 'provisioning' atomically inside its own
    // UPDATE (see this round's migration) -- the JS-level check above is a
    // fast-path rejection, the SQL function is what actually enforces it
    // against a concurrent status change.
    const { error } = await controlSrvSb.rpc("store_tenant_service_role_key", {
      p_tenant_id: tenant_id,
      p_key: service_role_key,
      p_secret_name: secretName,
    });
    if (error) {
      await auditFinish(auditId, "error", error.message);
      if (error.message && error.message.indexOf("not in status provisioning") !== -1) {
        return json({ error: "Tenanten er ikkje lenger i status 'provisioning' — prøv igjen" }, 409);
      }
      return json({ error: "Lagring av nøkkel feila" }, 500);
    }
    await auditFinish(auditId, "success");
    return json({ success: true });
  }

  // ── verify_tenant_schema ─────────────────────────────────────────────────
  // Step 4: a schema-fingerprint check against the newly provisioned
  // data-plane project -- cross-project, needs the Vault-decrypted key.
  // Confirms a handful of expected tables exist AND that RLS is actually
  // enabled on them, rather than trusting a clean `db push` exit code
  // alone. Now persists the result onto tenants.schema_verified_at (set on
  // pass, cleared on fail) so activate_tenant can actually require it.
  //
  // Security Auditor finding H2 (Phase 6 pre-merge review, 2026-07-09): the
  // RLS check was added specifically because resolve_tenant_by_hostname()
  // (see this round's migration) now resolves 'provisioning' tenants too --
  // meaning a tenant's real hostname can go publicly live, with its real
  // Supabase credentials handed to any visitor's browser, before
  // activate_tenant's gate ever runs. Checking table existence alone left
  // a freshly `db push`-ed project (RLS not yet enabled on some table) as a
  // real, unauthenticated data-exposure risk the moment DNS pointed at it.
  // Checking rls_enabled here doesn't remove that exposure window
  // entirely (schema_verified_at only gates activate_tenant, not whether
  // the hostname already resolves) but it does mean a customer can't reach
  // "schema verified" while a table is still wide open.
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
    // supabase/migrations/20260708212124_add_schema_fingerprint_rpc.sql,
    // extended with rls_enabled by 20260709193227_add_rls_check_to_schema_fingerprint.sql)
    // -- if it's missing entirely, or missing the rls_enabled column, that
    // itself means the schema push hasn't been run yet or used an older
    // baseline.
    const { data: rows, error: rpcErr } = await tenantSrvSb.rpc("verify_schema_fingerprint");
    if (rpcErr) {
      await controlSrvSb.from("tenants").update({ schema_verified_at: null }).eq("id", tenant_id);
      await auditFinish(auditId, "error", rpcErr.message);
      return json({ error: "Skjema-sjekk feila (manglar verify_schema_fingerprint()? køyr migrasjonane først)", reachable: false }, 500);
    }
    type FingerprintRow = { table_name: string; table_exists: boolean; rls_enabled?: boolean };
    const fingerprint = (rows as FingerprintRow[]) || [];
    const missing = fingerprint.filter((r) => !r.table_exists).map((r) => r.table_name);
    const rlsMissing = fingerprint
      .filter((r) => r.table_exists && r.rls_enabled === false)
      .map((r) => r.table_name);
    const ok = missing.length === 0 && rlsMissing.length === 0;
    await controlSrvSb
      .from("tenants")
      .update({ schema_verified_at: ok ? new Date().toISOString() : null })
      .eq("id", tenant_id);
    const detailParts: string[] = [];
    if (missing.length) detailParts.push("manglar tabellar: " + missing.join(","));
    if (rlsMissing.length) detailParts.push("RLS ikkje på: " + rlsMissing.join(","));
    await auditFinish(auditId, ok ? "success" : "error", ok ? undefined : detailParts.join("; "));
    return json({ success: true, schema_ok: ok, missing_tables: missing, rls_missing: rlsMissing });
  }

  // ── verify_tenant_routing ────────────────────────────────────────────────
  // Step 5 (Phase 6): the only action in this codebase that can ever set
  // routing_verified_at, which activate_tenant requires below. For every
  // hostname registered to this tenant, makes a REAL server-side HTTP
  // request (never trusts a client-supplied claim) to
  // https://<hostname>/config.js and confirms both that it responds 200
  // AND that the returned body actually names THIS tenant's
  // data_plane_url/data_plane_anon_key -- not just that some config.js was
  // served. That second check is what would catch a hostname pointed at
  // someone else's deployment (the write-time half of the same protection
  // is the hostname-uniqueness trigger added in this round's migration).
  // Requires resolve_tenant_by_hostname() to already resolve 'provisioning'
  // tenants (same migration) -- otherwise the fetch below would 404/serve
  // nothing even for a correctly-configured hostname.
  if (action === "verify_tenant_routing") {
    if (tenant.status !== "provisioning") {
      await auditReject(tenant.id, action, "tenant er ikkje i status 'provisioning' (er: " + tenant.status + ")");
      return json({ error: "Denne handlinga er berre tillate mens kunden er i status 'provisioning'" }, 403);
    }
    // Security Auditor finding H2, closed 2026-07-09: resolve_tenant_by_hostname()
    // (see this round's migration) now only resolves a 'provisioning' tenant
    // once schema_verified_at is set -- so calling this before step 4 (verify
    // schema) would otherwise just fail with a confusing "HTTP 404" per
    // hostname, when the real problem is an unmet precondition. Checked here
    // explicitly for a clear error message; Console's own UI already disables
    // this step's button until schema_ok, this is defense-in-depth for a
    // direct API call.
    if (!tenant.schema_verified_at) {
      await auditReject(tenant.id, action, "skjema er ikkje verifisert enno");
      return json({ error: "Skjema må vera verifisert (steg 4) før ruting kan verifiserast" }, 403);
    }
    const hostnames = (tenant.hostnames as string[]) || [];
    if (hostnames.length === 0) {
      await auditReject(tenant.id, action, "ingen hostnames registrert");
      return json({ error: "Ingen hostnames registrert for denne kunden" }, 400);
    }
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const results: { hostname: string; ok: boolean; detail: string }[] = [];
    for (const hostname of hostnames) {
      // Security Auditor finding H1: full safety check (shape + bare-IP
      // rejection + real DNS resolution against private/reserved ranges)
      // before this hostname is ever handed to fetch() below -- not just
      // the syntactic HOSTNAME_RE test this used to be.
      const safety = await assertHostnameSafeToFetch(hostname);
      if (!safety.safe) {
        results.push({ hostname, ok: false, detail: safety.reason || "utrygt hostname" });
        continue;
      }
      // Security Auditor finding L2: bounded timeout and response size --
      // an operator-supplied hostname could otherwise point at a slow or
      // deliberately huge response.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        // Codex-runde 2026-07-09: utan "redirect: manual" følgjer fetch()
        // automatisk 3xx-svar -- ein hostname som besto assertHostnameSafeToFetch
        // kunne likevel 30x-omdirigere til eit uvalidert/privat mål, og
        // dette laget ville ha henta OG stolt på det svaret. Handsam alle
        // 3xx som feil i staden for å følgja dei blindt.
        const resp = await fetch("https://" + hostname + "/config.js", { method: "GET", signal: controller.signal, redirect: "manual" });
        if (resp.type === "opaqueredirect" || (resp.status >= 300 && resp.status < 400)) {
          results.push({ hostname, ok: false, detail: "omdirigering (HTTP " + (resp.status || "3xx") + ") er ikkje tillate" });
          continue;
        }
        if (!resp.ok) {
          results.push({ hostname, ok: false, detail: "HTTP " + resp.status });
          continue;
        }
        const reader = resp.body ? resp.body.getReader() : null;
        let text = "";
        if (reader) {
          const decoder = new TextDecoder();
          let totalBytes = 0;
          const MAX_BYTES = 65536; // config.js is a few hundred bytes in practice
          while (totalBytes < MAX_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            text += decoder.decode(value, { stream: true });
          }
          await reader.cancel().catch(() => {});
        } else {
          text = await resp.text();
        }
        const matches = text.indexOf(tenant.data_plane_url) !== -1 && text.indexOf(tenant.data_plane_anon_key) !== -1;
        results.push({ hostname, ok: matches, detail: matches ? "" : "config.js svara, men peika ikkje på denne kunden sitt prosjekt" });
      } catch (e) {
        const isAbort = e instanceof Error && e.name === "AbortError";
        results.push({ hostname, ok: false, detail: isAbort ? "tidsavbrot (5s)" : (e instanceof Error ? e.message : "nettverksfeil") });
      } finally {
        clearTimeout(timeoutId);
      }
    }
    const allOk = results.every((r) => r.ok);
    await controlSrvSb
      .from("tenants")
      .update({ routing_verified_at: allOk ? new Date().toISOString() : null })
      .eq("id", tenant_id)
      .eq("status", "provisioning");
    await auditFinish(auditId, allOk ? "success" : "error", allOk ? undefined : JSON.stringify(results));
    return json({ success: true, routing_ok: allOk, results });
  }

  // ── activate_tenant ───────────────────────────────────────────────────────
  // Step 6. Requires ALL of: status still 'provisioning', a real connection
  // (data_plane_url set), a stored service_role secret, a passing schema
  // verification (schema_verified_at), AND routing_verified_at -- the last of
  // these is now set by verify_tenant_routing above, once Phase 6's actual
  // resolver (middleware.js + /api/tenant-config.js) is deployed somewhere
  // that hostname can reach. Until then, no tenant's hostnames will resolve
  // to a real Vibeverk deployment, so this check keeps failing honestly.
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
    // Same M1 atomicity fix as update_tenant_connection above: repeat the
    // status condition on the write itself.
    const { data: updated, error } = await controlSrvSb
      .from("tenants")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", tenant_id)
      .eq("status", "provisioning")
      .select("id");
    if (error) {
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Aktivering feila" }, 500);
    }
    if (!updated || updated.length === 0) {
      await auditFinish(auditId, "error", "status endra seg mens handlinga køyrde");
      return json({ error: "Tenanten er ikkje lenger i status 'provisioning' — prøv igjen" }, 409);
    }
    await auditFinish(auditId, "success");
    return json({ success: true });
  }

  await auditReject(tenant.id, String(action), "ukjend handling");
  return json({ error: "Ukjend handling: " + action }, 400);
});
