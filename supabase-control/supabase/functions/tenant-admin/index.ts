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

  // Shared Auth-config-sync slice, extracted from configure_tenant_smtp's own
  // authPatch/PATCH/confirm-GET logic (Codex-gjennomgang 2026-07-18, HIGH --
  // Arkitekt-konsultert 2026-07-18 for denne utpakkinga): update_tenant_hostnames
  // skreiv tidlegare BERRE tenants.hostnames-kolonna, og rørte aldri det
  // tilhøyrande Supabase-prosjektet sin Auth site_url/uri_allow_list -- ein
  // kunde som byter hostname EtTER sitt fyrste SMTP-oppsett fekk difor ein
  // stille forelda Auth-konfig, som kunne sende nye invitasjons-/support-
  // lenker (som alt les hostnames FERSKT ved kvart kall) til eit domene Auth
  // sjølv ikkje kjenner att -- GoTrue feilar ikkje på ei ukjend redirectTo,
  // ho fell berre stille tilbake til den forelda site_url.
  //
  // NB (Arkitekt-tilråding): dette er MEDVITE ein delt SLICE, ikkje éin stor
  // delt funksjon med configure_tenant_smtp -- SMTP-felta (smtp_host/-pass/...)
  // høyrer framleis heime lokalt i configure_tenant_smtp, ikkje her, sidan
  // update_tenant_hostnames ikkje eig SMTP-oppsettet i det heile.
  //
  // Kallar returnerer { ok: true } eller { ok: false, detail } -- feilar
  // ALDRI heile den kallande handlinga (hostname-skrivinga sjølv må framleis
  // lukkast for at routing skal fungere), og gjer INGENTING (returnerer
  // { ok: true } stille) viss tenanten ikkje har noko live data_plane_url
  // enno (provisioning-steg der configure_tenant_smtp uansett vil setje rett
  // verdi seinare, når han faktisk køyrer).
  async function patchTenantAuthConfig(tenant: { data_plane_url?: string | null; hostnames?: string[] | null }): Promise<{ ok: true } | { ok: false; detail: string }> {
    if (!tenant.data_plane_url) return { ok: true };
    const mgmtToken = Deno.env.get("TENANT_MGMT_API_TOKEN");
    if (!mgmtToken) return { ok: false, detail: "TENANT_MGMT_API_TOKEN manglar på server" };
    const hostnames = (tenant.hostnames as string[]) || [];
    if (hostnames.length === 0) return { ok: true };
    const ref = tenant.data_plane_url.replace(/^https:\/\//, "").split(".")[0];
    const mgmtHeaders = { "Authorization": "Bearer " + mgmtToken, "Content-Type": "application/json" };
    const authPatch: Record<string, unknown> = {
      site_url: "https://" + hostnames[0],
      uri_allow_list: hostnames.map((h) => "https://" + h + "/**").join(","),
    };
    try {
      const patchResp = await fetch("https://api.supabase.com/v1/projects/" + ref + "/config/auth", {
        method: "PATCH",
        headers: mgmtHeaders,
        body: JSON.stringify(authPatch),
      });
      if (!patchResp.ok) {
        const bodyText = await patchResp.text().catch(() => "");
        return { ok: false, detail: "Management API PATCH HTTP " + patchResp.status + (bodyText ? ": " + bodyText : "") };
      }
      // Stadfest at det faktisk landa, ikkje berre stol på PATCH-en (same
      // disiplin som configure_tenant_smtp alt brukar).
      const getResp = await fetch("https://api.supabase.com/v1/projects/" + ref + "/config/auth", {
        method: "GET",
        headers: mgmtHeaders,
      });
      if (!getResp.ok) return { ok: false, detail: "stadfesting feila: GET HTTP " + getResp.status };
      const confirmed = await getResp.json();
      if (confirmed.site_url !== authPatch.site_url) return { ok: false, detail: "stadfesting feila: site_url matcha ikkje etter lagring" };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "nettverksfeil" };
    }
    return { ok: true };
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

  // ── set_pricing_config ───────────────────────────────────────────────────
  // Console "Priser"-fane (Innsikt-runda sin oppfølgar, 2026-08-03): global,
  // ikkje-tenant-skopa prisdokument (modulprisliste + pakkeforslag), IKKJE
  // ekte fakturering. Høyrer heime her og ikkje i broker.ts av same grunn som
  // register_tenant over -- broker.brokerCall() krev alltid ein vald
  // _activeTenant (sjå console-core.js), og dette datasettet er ikkje bunde
  // til nokon tenant i det heile. Ingen get_pricing_config-handling her med
  // vilje (Arkitekt-konsultert 2026-08-03): lesing skjer direkte mot
  // pricing_config sin eigen RLS-SELECT-policy (same mønster som
  // console-core.js alt bruker for tenants/operators), sidan denne funksjonen
  // sin blanke superadmin-sperre (linje ~185) elles ville gjort lesing
  // strengare enn skriving-RLS-en treng å vere -- to lesevegar til same data
  // med to ulike tilgangsgrenser er akkurat den typen inkonsekvens ADR-området
  // for control-plane-tilgang åtvarar mot.
  if (action === "set_pricing_config") {
    const { data } = body;
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return json({ error: "Ugyldig format -- data må vere eit objekt" }, 400);
    }
    const dataObj = data as Record<string, unknown>;
    const topKeys = Object.keys(dataObj);
    if (topKeys.length !== 2 || !topKeys.includes("prices") || !topKeys.includes("packages")) {
      return json({ error: "Ugyldig format -- forventa nøyaktig prices/packages" }, 400);
    }

    // Modulnøklar (features.*/intranettFeatures.*) er camelCase-identifikatorar
    // i heile resten av kodebasen -- valideringa her sjekkar FORMA på nøklane,
    // ikkje at dei finst i ei fast liste (den lista lever i console-core.js og
    // kan vekse utan at denne funksjonen treng ei ny deploy for kvar nye modul).
    const FEATURE_KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,49}$/;
    const PKG_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
    // Strengt hex-format -- badgeColor vert interpolert direkte inn i eit
    // style="border-color:...">-attributt klientsida (renderPreview()) utan
    // eiga escaping der. Utan denne sperra kunne ein operatør (eller nokon som
    // fekk skrive direkte i databasen) bryte ut av attributtet med eit
    // anførselsteikn og injisere vilkårleg HTML/skript -- lagra XSS som ville
    // ramme KVAR EIN operatør som opnar Priser-fana seinare. Klientsida
    // validerer det same på nytt før rendering, som eit andre forsvarslag.
    const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
    // Reint datakvalitets-tak (Security Auditor-funn, 2026-08-04) -- isFinite
    // åleine stoppar NaN/Infinity, men ikkje eit urimeleg stort tal som
    // 1e300. 10 millionar kr er langt over noko realistisk pris/oppstart for
    // denne produktkatalogen, men høgt nok til aldri å kollidere med ein
    // ekte verdi.
    const MAX_PRICE_KR = 10000000;

    function validatePriceEntry(key: string, v: unknown): string | null {
      if (!FEATURE_KEY_RE.test(key)) return "ugyldig modulnøkkel: «" + key + "»";
      if (v === null || typeof v !== "object" || Array.isArray(v)) return "«" + key + "» må vere eit objekt";
      const e = v as Record<string, unknown>;
      const keys = Object.keys(e);
      if (keys.length !== 3 || !keys.includes("monthly") || !keys.includes("setup") || !keys.includes("standard")) {
        return "«" + key + "» må ha nøyaktig monthly/setup/standard";
      }
      if (typeof e.monthly !== "number" || !isFinite(e.monthly) || e.monthly < 0 || e.monthly > MAX_PRICE_KR) return "«" + key + "» sin monthly må vere eit tal mellom 0 og " + MAX_PRICE_KR;
      if (typeof e.setup !== "number" || !isFinite(e.setup) || e.setup < 0 || e.setup > MAX_PRICE_KR) return "«" + key + "» sin setup må vere eit tal mellom 0 og " + MAX_PRICE_KR;
      if (typeof e.standard !== "boolean") return "«" + key + "» sin standard må vere true/false";
      return null;
    }

    const prices = dataObj.prices;
    if (prices === null || typeof prices !== "object" || Array.isArray(prices)) {
      return json({ error: "Ugyldig format -- prices må vere eit objekt" }, 400);
    }
    const pricesObj = prices as Record<string, unknown>;
    const priceNsKeys = Object.keys(pricesObj);
    if (priceNsKeys.length !== 2 || !priceNsKeys.includes("f") || !priceNsKeys.includes("i")) {
      return json({ error: "Ugyldig format -- prices må ha nøyaktig f/i" }, 400);
    }
    for (const ns of ["f", "i"] as const) {
      const nsVal = pricesObj[ns];
      if (nsVal === null || typeof nsVal !== "object" || Array.isArray(nsVal)) {
        return json({ error: "Ugyldig format -- prices." + ns + " må vere eit objekt" }, 400);
      }
      const nsObj = nsVal as Record<string, unknown>;
      if (Object.keys(nsObj).length > 200) return json({ error: "For mange modular i prices." + ns }, 400);
      for (const [k, v] of Object.entries(nsObj)) {
        const err = validatePriceEntry(k, v);
        if (err) return json({ error: "prices." + ns + ": " + err }, 400);
      }
    }

    const packages = dataObj.packages;
    if (!Array.isArray(packages)) return json({ error: "Ugyldig format -- packages må vere ei liste" }, 400);
    if (packages.length > 50) return json({ error: "For mange pakkar (maks 50)" }, 400);

    function validateStringArray(v: unknown, label: string, maxItems: number): string | null {
      if (!Array.isArray(v)) return label + " må vere ei liste";
      if (v.length > maxItems) return label + " har for mange element";
      for (const item of v) {
        if (typeof item !== "string" || !FEATURE_KEY_RE.test(item)) return label + " inneheld ein ugyldig modulnøkkel";
      }
      return null;
    }
    function validateTagMap(v: unknown, label: string): string | null {
      if (v === null || typeof v !== "object" || Array.isArray(v)) return label + " må vere eit objekt";
      const obj = v as Record<string, unknown>;
      if (Object.keys(obj).length > 200) return label + " har for mange oppføringar";
      for (const [k, val] of Object.entries(obj)) {
        if (!FEATURE_KEY_RE.test(k)) return label + " har ein ugyldig modulnøkkel: «" + k + "»";
        if (typeof val !== "string" || val.length > 100) return label + "." + k + " må vere ein tekst på maks 100 teikn";
      }
      return null;
    }

    // allStandard (singular) -> allStandardF/allStandardI, + priceOnRequest og
    // trafficGBPerMonth lagt til (Priser-utvidingar 2026-08-05, sjå
    // console-core.js sin priserBackfillStandardFlags()/PRISER_CAP_FIELDS) --
    // klientsida sitt datamodell endra seg, denne lista MÅ endre seg med den,
    // elles avviser denne funksjonen kvar lagring av ei elles gyldig pakke.
    const PKG_ALLOWED_KEYS = ["id", "name", "price", "setupCost", "desc", "features", "iFeatures", "tags", "allStandardF", "allStandardI", "priceOnRequest", "featured", "badgeText", "badgeColor", "storageGB", "trafficGBPerMonth", "emailsPerMonth", "usersIncluded"];
    // -1 er ein sentinel-verdi for "ubegrensa" (klientsida sin "Ubegrenset"-
    // avkryssing, 2026-08-04) -- alt anna må vere eit ikkje-negativt tal.
    const MAX_CAP_VALUE = 1000000;
    function validateCapField(v: unknown, label: string, pkgName: string): string | null {
      if (typeof v !== "number" || !isFinite(v) || v < -1 || v > MAX_CAP_VALUE || (v !== -1 && !Number.isInteger(v))) {
        return "Ugyldig " + label + " for «" + pkgName + "»";
      }
      return null;
    }
    // Unikskapskontroll (Security Auditor-funn, 2026-08-04): klientsida sin
    // _priserData.packages.find(...) løyser alltid til FYRSTE treff --
    // duplikate id-ar ville stille fått "Fjern pakke"/feltredigering til å
    // ramme feil kort. Serversida sin einaste jobb her er å hindre at eit
    // slikt dokument nokon gong kjem forbi lagring, uansett klient-bug.
    const seenPkgIds = new Set<string>();
    for (const pkgRaw of packages) {
      if (pkgRaw === null || typeof pkgRaw !== "object" || Array.isArray(pkgRaw)) {
        return json({ error: "Ugyldig pakke -- må vere eit objekt" }, 400);
      }
      const pkg = pkgRaw as Record<string, unknown>;
      const pkgKeys = Object.keys(pkg);
      const unknownKey = pkgKeys.find((k) => !PKG_ALLOWED_KEYS.includes(k));
      if (unknownKey || pkgKeys.length !== PKG_ALLOWED_KEYS.length) {
        return json({ error: "Ugyldig pakke -- forventa nøyaktig " + PKG_ALLOWED_KEYS.join("/") }, 400);
      }
      if (typeof pkg.id !== "string" || !PKG_ID_RE.test(pkg.id)) return json({ error: "Ugyldig pakke-id" }, 400);
      if (seenPkgIds.has(pkg.id)) return json({ error: "Duplikat pakke-id: «" + pkg.id + "»" }, 400);
      seenPkgIds.add(pkg.id);
      if (typeof pkg.name !== "string" || !pkg.name.trim() || pkg.name.length > 200) return json({ error: "Ugyldig pakkenavn" }, 400);
      if (typeof pkg.price !== "number" || !isFinite(pkg.price) || pkg.price < 0 || pkg.price > MAX_PRICE_KR) return json({ error: "Ugyldig pris for «" + pkg.name + "»" }, 400);
      if (typeof pkg.setupCost !== "number" || !isFinite(pkg.setupCost) || pkg.setupCost < 0 || pkg.setupCost > MAX_PRICE_KR) return json({ error: "Ugyldig oppstartskostnad for «" + pkg.name + "»" }, 400);
      if (typeof pkg.desc !== "string" || pkg.desc.length > 2000) return json({ error: "Ugyldig beskrivelse for «" + pkg.name + "»" }, 400);
      const featErr = validateStringArray(pkg.features, "features", 200);
      if (featErr) return json({ error: "«" + pkg.name + "»: " + featErr }, 400);
      const iFeatErr = validateStringArray(pkg.iFeatures, "iFeatures", 200);
      if (iFeatErr) return json({ error: "«" + pkg.name + "»: " + iFeatErr }, 400);
      if (pkg.tags === null || typeof pkg.tags !== "object" || Array.isArray(pkg.tags)) {
        return json({ error: "Ugyldig tags for «" + pkg.name + "»" }, 400);
      }
      const tagsObj = pkg.tags as Record<string, unknown>;
      const tagNsKeys = Object.keys(tagsObj);
      if (tagNsKeys.length !== 2 || !tagNsKeys.includes("f") || !tagNsKeys.includes("i")) {
        return json({ error: "Ugyldig tags for «" + pkg.name + "» -- forventa nøyaktig f/i" }, 400);
      }
      const tagFErr = validateTagMap(tagsObj.f, "tags.f");
      if (tagFErr) return json({ error: "«" + pkg.name + "»: " + tagFErr }, 400);
      const tagIErr = validateTagMap(tagsObj.i, "tags.i");
      if (tagIErr) return json({ error: "«" + pkg.name + "»: " + tagIErr }, 400);
      if (typeof pkg.allStandardF !== "boolean") return json({ error: "Ugyldig allStandardF for «" + pkg.name + "»" }, 400);
      if (typeof pkg.allStandardI !== "boolean") return json({ error: "Ugyldig allStandardI for «" + pkg.name + "»" }, 400);
      if (typeof pkg.priceOnRequest !== "boolean") return json({ error: "Ugyldig priceOnRequest for «" + pkg.name + "»" }, 400);
      if (typeof pkg.featured !== "boolean") return json({ error: "Ugyldig featured for «" + pkg.name + "»" }, 400);
      if (typeof pkg.badgeText !== "string" || pkg.badgeText.length > 100) return json({ error: "Ugyldig merkelapptekst for «" + pkg.name + "»" }, 400);
      if (typeof pkg.badgeColor !== "string" || !HEX_COLOR_RE.test(pkg.badgeColor)) return json({ error: "Ugyldig farge for «" + pkg.name + "» -- må vere #rrggbb" }, 400);
      const storageErr = validateCapField(pkg.storageGB, "datalagringsgrense", pkg.name);
      if (storageErr) return json({ error: storageErr }, 400);
      const trafficErr = validateCapField(pkg.trafficGBPerMonth, "datatrafikkgrense", pkg.name);
      if (trafficErr) return json({ error: trafficErr }, 400);
      const emailsErr = validateCapField(pkg.emailsPerMonth, "e-postgrense", pkg.name);
      if (emailsErr) return json({ error: emailsErr }, 400);
      const usersErr = validateCapField(pkg.usersIncluded, "brukergrense", pkg.name);
      if (usersErr) return json({ error: usersErr }, 400);
    }

    const serialized = JSON.stringify(dataObj);
    // Same UTF-8-byte-teljing-disiplin som set_custom_modules_manifest (over)
    // -- .length på strengen tel UTF-16-kodeeiningar, ikkje dei faktiske
    // bytane som vert lagra i jsonb-kolonna.
    const PRICING_CONFIG_MAX_BYTES = 300 * 1024;
    if (new TextEncoder().encode(serialized).length > PRICING_CONFIG_MAX_BYTES) {
      return json({ error: "Prisdokumentet er for stort (maks " + Math.round(PRICING_CONFIG_MAX_BYTES / 1024) + "KB)" }, 400);
    }

    const auditId = await auditStart(null, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { error } = await controlSrvSb
      .from("pricing_config")
      .update({ data: dataObj, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq("id", true);
    if (error) {
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Lagring feila" }, 500);
    }
    await auditFinish(auditId, "success", packages.length + " pakkar lagra");
    return json({ success: true });
  }

  // ── set_compliance_record ────────────────────────────────────────────────
  // Bolk 3 (2026-08-12): Console "Compliance"-fane, behandlingsprotokoll
  // (GDPR art. 30) -- KUN for Vibeverk AS sjølv, aldri ein per-kunde-funksjon
  // (eksplisitt brukarvedtak, sjå migrasjonen 20260812170000 sin eigen
  // kommentar). Global, ikkje tenant-skopa, same "høyrer heime her, ikkje i
  // broker.ts"-grunngjeving som set_pricing_config over. Rein UPDATE mot ei
  // av dei 8 førehandssådde radene -- ingen ny rad kan opprettast herifrå
  // (COMPLIANCE_RECORD_IDS er ei lukka liste, med vilje strengare enn eit
  // fritt tekstfelt for id ville vore).
  if (action === "set_compliance_record") {
    const COMPLIANCE_RECORD_IDS = ["kontakt", "tilbud", "booking", "chat", "crm", "ansatte", "sidetelling", "ai"];
    const recordId = typeof body.id === "string" ? body.id : "";
    if (!COMPLIANCE_RECORD_IDS.includes(recordId)) {
      return json({ error: "Ukjend behandlingsaktivitet: «" + recordId + "»" }, 400);
    }
    const TEXT_FIELDS = ["formaal", "kategori_registrerte", "kategori_data", "behandlingsgrunnlag", "mottakere", "lagringstid", "sikkerhetstiltak"] as const;
    const MAX_FIELD_LEN = 4000;
    const update: Record<string, string> = {};
    for (const f of TEXT_FIELDS) {
      const v = (body as Record<string, unknown>)[f];
      if (v === undefined) continue;
      if (typeof v !== "string" || v.length > MAX_FIELD_LEN) {
        return json({ error: "Ugyldig verdi for «" + f + "» (maks " + MAX_FIELD_LEN + " teikn)" }, 400);
      }
      update[f] = v;
    }
    const auditId = await auditStart(null, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { error } = await controlSrvSb
      .from("compliance_record")
      .update({ ...update, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq("id", recordId);
    if (error) {
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Lagring feila" }, 500);
    }
    await auditFinish(auditId, "success", "behandlingsaktivitet «" + recordId + "» oppdatert");
    return json({ success: true });
  }

  // ── set_vendor ────────────────────────────────────────────────────────────
  // Bolk 4 (2026-08-12): Console "Compliance"-fane, leverandør-/DPA-register
  // -- erstattar den hardkoda VIBEVERK_VENDORS-konstanten (console-core.js)
  // som kjelde til sanning. Same global/superadmin/auditert mønster som
  // set_compliance_record over. Rein UPDATE mot éi av dei 4 førehandssådde
  // radene -- ingen ny leverandør kan leggjast til herifrå (krev ein ny
  // migrasjon, same disiplin som å leggje til ein ny leverandør i
  // VIBEVERK_VENDORS gjorde tidlegare -- eit medvite, sjeldan steg).
  // dpa_document_path er MEDVITE IKKJE eit felt her -- ingen opplastingsveg
  // finst enno (Arkitekten sin fase 5, eksplisitt utsett).
  if (action === "set_vendor") {
    const VENDOR_IDS = ["supabase", "vercel", "resend", "plausible"];
    const vendorId = typeof body.id === "string" ? body.id : "";
    if (!VENDOR_IDS.includes(vendorId)) {
      return json({ error: "Ukjend leverandør: «" + vendorId + "»" }, 400);
    }
    const COUNTRY_VALUES = ["eu", "us"];
    const TRANSFER_VALUES = ["none", "scc", "scc_or_dpf"];
    const DPA_STATUS_VALUES = ["confirmed", "likely_confirmed", "unconfirmed", "tba"];
    const MAX_FIELD_LEN = 2000;
    const update: Record<string, unknown> = {};
    const b = body as Record<string, unknown>;
    if (b.name !== undefined) {
      if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 200) return json({ error: "Ugyldig namn" }, 400);
      update.name = b.name;
    }
    if (b.what_it_does !== undefined) {
      if (typeof b.what_it_does !== "string" || b.what_it_does.length > MAX_FIELD_LEN) return json({ error: "Ugyldig skildring" }, 400);
      update.what_it_does = b.what_it_does;
    }
    if (b.country !== undefined) {
      if (typeof b.country !== "string" || !COUNTRY_VALUES.includes(b.country)) return json({ error: "Ugyldig land" }, 400);
      update.country = b.country;
    }
    if (b.transfer_mechanism !== undefined) {
      if (typeof b.transfer_mechanism !== "string" || !TRANSFER_VALUES.includes(b.transfer_mechanism)) return json({ error: "Ugyldig overføringsmekanisme" }, 400);
      update.transfer_mechanism = b.transfer_mechanism;
    }
    if (b.dpa_status !== undefined) {
      if (typeof b.dpa_status !== "string" || !DPA_STATUS_VALUES.includes(b.dpa_status)) return json({ error: "Ugyldig DPA-status" }, 400);
      update.dpa_status = b.dpa_status;
    }
    if (b.dpa_note !== undefined) {
      if (typeof b.dpa_note !== "string" || b.dpa_note.length > MAX_FIELD_LEN) return json({ error: "Ugyldig DPA-notat" }, 400);
      update.dpa_note = b.dpa_note;
    }
    const auditId = await auditStart(null, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { error } = await controlSrvSb
      .from("vendor_registry")
      .update({ ...update, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq("id", vendorId);
    if (error) {
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Lagring feila" }, 500);
    }
    await auditFinish(auditId, "success", "leverandør «" + vendorId + "» oppdatert");
    return json({ success: true });
  }

  // Every action below operates on an existing tenant (tenant_id already
  // destructured above, alongside action, for the auth-failure audit path).
  if (!tenant_id) return json({ error: "tenant_id er påkrevd" }, 400);

  const { data: tenant, error: tenantErr } = await controlSrvSb
    .from("tenants")
    .select("id, slug, hostnames, data_plane_url, data_plane_anon_key, data_plane_storage_key, data_plane_service_role_secret_id, status, schema_verified_at, routing_verified_at, first_admin_invited_at, smtp_configured_at, site_lock_enabled, site_lock_updated_at")
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
  //
  // Extended 2026-07-12 (user request) to also allow this action for
  // status = 'active', not just 'provisioning'. Deliberately the simple/
  // immediate-effect variant (user's explicit choice over a safer
  // re-verification-gated flow): resolve_tenant_by_hostname() resolves an
  // 'active' tenant unconditionally (status = 'active' short-circuits the
  // schema/routing checks entirely, see that migration), so there is no
  // exposure-window risk here the way there is for 'provisioning' -- the
  // new hostname just starts resolving to this tenant's real connection
  // info the moment this write commits, with no verification step. That's
  // the intended behaviour (fast-path fix for a typo on a live customer),
  // not a gap. schema_verified_at/routing_verified_at are only reset when
  // still 'provisioning' -- for an 'active' tenant they no longer gate
  // anything, and clearing them would misleadingly make Console's steps
  // 4/5 badges look unverified again for a tenant that needs no further
  // action.
  if (action === "update_tenant_hostnames") {
    if (tenant.status !== "provisioning" && tenant.status !== "active") {
      await auditReject(tenant.id, action, "tenant er ikkje i status 'provisioning' eller 'active' (er: " + tenant.status + ")");
      return json({ error: "Denne handlinga er berre tillate mens kunden er 'provisioning' eller 'active'" }, 403);
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
    const updatePayload: Record<string, unknown> = { hostnames: cleanHostnames, updated_at: new Date().toISOString() };
    if (tenant.status === "provisioning") {
      updatePayload.routing_verified_at = null;
      updatePayload.schema_verified_at = null;
    }
    const { data: updated, error } = await controlSrvSb
      .from("tenants")
      .update(updatePayload)
      .eq("id", tenant_id)
      .eq("status", tenant.status)
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
      return json({ error: "Tenanten sin status endra seg — prøv igjen" }, 409);
    }
    // Hald Auth sin site_url/uri_allow_list i takt med det nye hostnamnet
    // (Codex-funn 2026-07-18, sjå patchTenantAuthConfig sin eigen kommentar).
    // Feilar ALDRI heile handlinga over dette -- hostname-skrivinga sjølv
    // (routing sitt grunnlag) har alt lukkast på dette punktet, og ein Auth-
    // synk-feil er ein lågare-alvorsgrad forelda-risiko, ikkje ein grunn til
    // å blokkere routing. Skriv resultatet inn i audit-detaljen slik at
    // Console kan syne ei "hugs å stadfeste Auth-oppsettet"-åtvaring seinare,
    // same mønster som smtp_configured_at sin eigen suksess-med-atterhald.
    const authSync = await patchTenantAuthConfig({ data_plane_url: tenant.data_plane_url, hostnames: cleanHostnames });
    await auditFinish(auditId, "success", authSync.ok ? undefined : "hostname lagra, men Auth-konfig-synkronisering feila: " + authSync.detail);
    return json({ success: true, auth_config_warning: authSync.ok ? undefined : authSync.detail });
  }

  // ── update_tenant_slug ────────────────────────────────────────────────────
  // Slug is purely a human-readable identifier (Console display + the label
  // baked into the Vault secret name in set_tenant_service_role_key below) --
  // unlike hostnames it has NO connection to resolve_tenant_by_hostname() or
  // any public routing/exposure, so (unlike update_tenant_hostnames above)
  // there's no reason to restrict this to 'provisioning' only. Allowed for
  // any status except 'archived' -- a frozen, soft-deleted tenant has no
  // reason to be renamed.
  const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  if (action === "update_tenant_slug") {
    if (tenant.status === "archived") {
      await auditReject(tenant.id, action, "tenant er arkivert");
      return json({ error: "Ein arkivert tenant kan ikkje endrast" }, 403);
    }
    const newSlug = String(body.slug || "").trim().toLowerCase();
    if (!newSlug || !SLUG_RE.test(newSlug)) {
      return json({ error: "Ugyldig slug-format (berre små bokstavar, tal og bindestrek)" }, 400);
    }
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { data: updated, error } = await controlSrvSb
      .from("tenants")
      .update({ slug: newSlug, updated_at: new Date().toISOString() })
      .eq("id", tenant_id)
      .neq("status", "archived")
      .select("id");
    if (error) {
      await auditFinish(auditId, "error", error.message);
      if (error.message && error.message.indexOf("duplicate key") !== -1) {
        return json({ error: "Slugen «" + newSlug + "» er alt i bruk av ein annan kunde" }, 409);
      }
      return json({ error: "Lagring feila" }, 500);
    }
    if (!updated || updated.length === 0) {
      await auditFinish(auditId, "error", "status endra seg mens handlinga køyrde");
      return json({ error: "Tenanten vart arkivert mens handlinga køyrde" }, 409);
    }
    await auditFinish(auditId, "success");
    return json({ success: true });
  }

  // ── set_tenant_site_lock ─────────────────────────────────────────────────
  // Per-tenant sidesperre (forenkla design, 2026-08-10 -- sjå
  // 20260810234227_tenant_site_lock.sql sin eigen kommentar for full
  // grunngjeving). Erstattar den globale SITE_LOCK_PASSWORD i middleware.js
  // for akkurat denne tenanten sine domene når enabled = true. Passordet vert
  // ALDRI lese attende her -- berre set/endra/slå av, same
  // write-only-mønster som set_tenant_service_role_key over. Hashinga skjer
  // inne i set_tenant_site_lock()-SQL-funksjonen (service_role-only, sjå
  // migrasjonen), ikkje her -- denne handlinga er berre eit tynt, audit-logga
  // kall inn til den.
  //
  // Tillate for 'provisioning' og 'active' (same gate som
  // update_tenant_hostnames) -- ein operatør kan ønskje å sperre ein tenant
  // sine domene mens han framleis vert bygd saman med kunden, ikkje berre
  // etter go-live.
  if (action === "set_tenant_site_lock") {
    if (tenant.status !== "provisioning" && tenant.status !== "active") {
      await auditReject(tenant.id, action, "tenant er ikkje i status 'provisioning' eller 'active' (er: " + tenant.status + ")");
      return json({ error: "Denne handlinga er berre tillate mens kunden er 'provisioning' eller 'active'" }, 403);
    }
    const { enabled, password } = body;
    if (typeof enabled !== "boolean") {
      return json({ error: "enabled må vere true/false" }, 400);
    }
    const hasPassword = password !== undefined && password !== null && password !== "";
    if (hasPassword && (typeof password !== "string" || password.length < 4)) {
      return json({ error: "Passordet må vere minst 4 teikn" }, 400);
    }
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { error } = await controlSrvSb.rpc("set_tenant_site_lock", {
      p_tenant_id: tenant_id,
      p_enabled: enabled,
      p_password: hasPassword ? password : null,
    });
    if (error) {
      await auditFinish(auditId, "error", error.message);
      if (error.message && error.message.indexOf("no password set") !== -1) {
        return json({ error: "Kan ikkje slå på sperra før eit passord er sett" }, 400);
      }
      if (error.message && error.message.indexOf("password too short") !== -1) {
        return json({ error: "Passordet må vere minst 4 teikn" }, 400);
      }
      return json({ error: "Lagring feila" }, 500);
    }
    await auditFinish(auditId, "success", enabled ? "sperre PÅ" + (hasPassword ? " (nytt passord)" : "") : "sperre AV");
    return json({ success: true });
  }

  // ── set_custom_modules_manifest ──────────────────────────────────────────
  // Console "Modular"-fana sin redigering av tenants.custom_modules_manifest
  // (Fase 10 slice 2, sjå docs/roadmap/ROADMAP.md "Later"). Deliberately NOT
  // routed through broker/set_config -- dette er operatør-forfatta innhald
  // (kva skreddarsydde tilleggsmodular finst for denne kunden), ikkje
  // kunde-redigerbar config, per Arkitekt-avgjerda frå slice 1 (2026-07-16).
  // Erstattar HEILE kolonna, same "heile-blob"-semantikk som
  // update_tenant_hostnames over -- ikkje ei per-nøkkel samanslåing.
  //
  // Arkitekt-konsultasjon 2026-07-17 (les-berre, før implementasjon):
  // - Validering: streng struktur der funksjonen faktisk KAN vurdere
  //   (modul-id-format, at kvar oppføring er nøyaktig {label,enabled,params}),
  //   men params sitt INNHALD er med vilje IKKJE validert -- funksjonen kan
  //   ikkje vite kva eit ikkje-bygd spesialmodul faktisk treng.
  // - Storleikstak lagt til (CUSTOM_MODULES_MAX_BYTES): dette er den fyrste
  //   genuint ubundne blob-en ein superadmin kan lime inn i dette filet --
  //   alt anna (slug/hostname/e-post) er alt avgrensa i lengd av eige format.
  // - Statusport: same to tillatne status som update_tenant_hostnames
  //   (provisioning/active), avvis archived.
  // - Audit-logg: KOMPAKT strukturell oppsummering, ALDRI rå params-innhald
  //   -- eit HMS-sjekkliste-modul sine params kunne t.d. innehalde sensitiv
  //   tekst, same prinsipp som verify_tenant_schema sin logging av
  //   tabellnamn, ikkje radinnhald.
  const CUSTOM_MODULE_ID_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  const CUSTOM_MODULES_MAX_BYTES = 100 * 1024;
  if (action === "set_custom_modules_manifest") {
    if (tenant.status !== "provisioning" && tenant.status !== "active") {
      await auditReject(tenant.id, action, "tenant er ikkje i status 'provisioning' eller 'active' (er: " + tenant.status + ")");
      return json({ error: "Denne handlinga er berre tillate mens kunden er 'provisioning' eller 'active'" }, 403);
    }
    const { manifest } = body;
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
      return json({ error: "Ugyldig format -- manifestet må vere eit objekt" }, 400);
    }
    const manifestObj = manifest as Record<string, unknown>;
    const ids = Object.keys(manifestObj);
    const ALLOWED_ENTRY_KEYS = ["label", "enabled", "params"];
    for (const id of ids) {
      if (!CUSTOM_MODULE_ID_RE.test(id)) {
        return json({ error: "Ugyldig modul-id: «" + id + "» (berre små bokstavar, tal og bindestrek)" }, 400);
      }
      const entry = manifestObj[id];
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        return json({ error: "Ugyldig oppføring for «" + id + "» -- må vere eit objekt" }, 400);
      }
      const e = entry as Record<string, unknown>;
      const entryKeys = Object.keys(e);
      const unknownKey = entryKeys.find((k) => !ALLOWED_ENTRY_KEYS.includes(k));
      if (unknownKey || entryKeys.length !== ALLOWED_ENTRY_KEYS.length) {
        return json({ error: "Ugyldig oppføring for «" + id + "» -- forventa nøyaktig label/enabled/params" }, 400);
      }
      if (typeof e.label !== "string" || !e.label.trim()) {
        return json({ error: "«" + id + "» manglar ein gyldig label" }, 400);
      }
      if (typeof e.enabled !== "boolean") {
        return json({ error: "«" + id + "» sin enabled må vere true/false" }, 400);
      }
      if (e.params === null || typeof e.params !== "object" || Array.isArray(e.params)) {
        return json({ error: "«" + id + "» sin params må vere eit objekt" }, 400);
      }
    }
    const serialized = JSON.stringify(manifestObj);
    // Security Auditor review (2026-07-17): .length counts UTF-16 code units,
    // not the actual UTF-8 bytes stored in the jsonb column -- diacritics/
    // CJK content could pass this check while the real stored payload runs
    // 2-3x larger. Measure actual encoded bytes instead.
    if (new TextEncoder().encode(serialized).length > CUSTOM_MODULES_MAX_BYTES) {
      return json({ error: "Manifestet er for stort (maks " + Math.round(CUSTOM_MODULES_MAX_BYTES / 1024) + "KB)" }, 400);
    }
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { data: updated, error } = await controlSrvSb
      .from("tenants")
      .update({ custom_modules_manifest: manifestObj, updated_at: new Date().toISOString() })
      .eq("id", tenant_id)
      .eq("status", tenant.status)
      .select("id");
    if (error) {
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Lagring feila" }, 500);
    }
    if (!updated || updated.length === 0) {
      await auditFinish(auditId, "error", "status endra seg mens handlinga køyrde");
      return json({ error: "Tenanten sin status endra seg — prøv igjen" }, 409);
    }
    const enabledCount = ids.filter((id) => (manifestObj[id] as Record<string, unknown>).enabled === true).length;
    await auditFinish(auditId, "success", ids.length + " modular (" + enabledCount + " PÅ, " + (ids.length - enabledCount) + " AV)");
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

  // ── fetch_tenant_project_keys ─────────────────────────────────────────────
  // Merges update_tenant_connection + set_tenant_service_role_key into one
  // step: the operator still has to create the Supabase project by hand and
  // paste in its URL (that part is deliberately not automated, see the "2.
  // Opprett Supabase-prosjekt" card and ADR-0010 -- would need an org-wide,
  // project-create/delete/billing-capable token, a categorically bigger
  // secret than anything else this file holds), but no longer has to
  // separately copy the anon key and the service_role key out of the
  // Dashboard by hand. Uses the SAME platform-level Management API token
  // configure_tenant_smtp already uses -- this doesn't expand what that
  // token can already reach, it's still read-only against a project's own
  // key set, on a tenant this operator is already privileged to configure.
  //
  // Same CONTROL_PLANE_PROJECT_REF self-target guard as configure_tenant_smtp,
  // for the same reason: this is the other action using the platform-wide
  // token rather than a per-tenant Vault key.
  if (action === "fetch_tenant_project_keys") {
    if (tenant.status !== "provisioning") {
      await auditReject(tenant.id, action, "tenant er ikkje i status 'provisioning' (er: " + tenant.status + ")");
      return json({ error: "Denne handlinga er berre tillate mens kunden er i status 'provisioning'" }, 403);
    }
    const { data_plane_url } = body;
    if (!data_plane_url || !SUPABASE_PROJECT_URL_RE.test(data_plane_url)) {
      return json({ error: "data_plane_url må vera ein ekte Supabase-prosjekt-URL (https://xxxx.supabase.co)" }, 400);
    }
    const mgmtToken = Deno.env.get("TENANT_MGMT_API_TOKEN");
    if (!mgmtToken) {
      await auditReject(tenant.id, action, "Management API-token manglar på server");
      return json({ error: "Management API-token manglar på server (kontakt utviklar)" }, 500);
    }
    const ref = data_plane_url.replace(/^https:\/\//, "").split(".")[0];
    const CONTROL_PLANE_PROJECT_REF = "jxoglthrnshabqmdmnui";
    if (ref === CONTROL_PLANE_PROJECT_REF) {
      await auditReject(tenant.id, action, "data_plane_url peikar på kontrollplanet sjølv");
      return json({ error: "Ugyldig data_plane_url — peikar på kontrollplanet sjølv" }, 400);
    }
    // Security Auditor finding (2026-07-16, read-only pass): the guard above
    // only blocked targeting the control plane itself -- nothing stopped a
    // (mistaken or malicious) call from targeting a DIFFERENT, already-live
    // tenant's data_plane_url, fetching and storing THEIR real service_role
    // key onto this unrelated provisioning tenant's row. No DB-level unique
    // constraint exists on data_plane_url either, so this must be checked
    // explicitly here, before ever calling the Management API.
    const { data: conflictRows, error: conflictErr } = await controlSrvSb
      .from("tenants")
      .select("id")
      .eq("data_plane_url", data_plane_url)
      .neq("id", tenant_id);
    if (conflictErr) {
      await auditReject(tenant.id, action, "kunne ikkje sjekke om data_plane_url alt er i bruk: " + conflictErr.message);
      return json({ error: "Kunne ikkje verifisere at data_plane_url er unik — prøv igjen" }, 500);
    }
    if (conflictRows && conflictRows.length > 0) {
      await auditReject(tenant.id, action, "data_plane_url er alt registrert på ein annan tenant");
      return json({ error: "Denne Supabase-prosjekt-URL-en er alt registrert på ein annan kunde" }, 409);
    }
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    let anonKey: string | undefined;
    let serviceRoleKey: string | undefined;
    try {
      const keysResp = await fetch("https://api.supabase.com/v1/projects/" + ref + "/api-keys?reveal=true", {
        headers: { "Authorization": "Bearer " + mgmtToken },
      });
      if (!keysResp.ok) {
        const bodyText = await keysResp.text().catch(() => "");
        await auditFinish(auditId, "error", "Management API GET HTTP " + keysResp.status + (bodyText ? ": " + bodyText : ""));
        return json({ error: "Fann ikkje nøklane for dette prosjektet (HTTP " + keysResp.status + ") — er ref-en riktig?" }, 500);
      }
      const keys = await keysResp.json();
      anonKey = (keys as Array<{ name: string; type: string; api_key: string }>)
        .find((k) => k.name === "anon" && k.type === "legacy")?.api_key;
      serviceRoleKey = (keys as Array<{ name: string; type: string; api_key: string }>)
        .find((k) => k.name === "service_role" && k.type === "legacy")?.api_key;
    } catch (e) {
      await auditFinish(auditId, "error", e instanceof Error ? e.message : "nettverksfeil");
      return json({ error: "Kunne ikkje nå Supabase Management API" }, 500);
    }
    if (!anonKey || !serviceRoleKey) {
      await auditFinish(auditId, "error", "fann ikkje anon/service_role-nøkkel i svaret");
      return json({ error: "Fann ikkje anon- eller service_role-nøkkel for dette prosjektet" }, 500);
    }
    // Never log/return serviceRoleKey itself -- same discipline as
    // set_tenant_service_role_key, which this mirrors.
    const { data: updated, error: connErr } = await controlSrvSb
      .from("tenants")
      .update({ data_plane_url, data_plane_anon_key: anonKey, updated_at: new Date().toISOString() })
      .eq("id", tenant_id)
      .eq("status", "provisioning")
      .select("id");
    if (connErr) {
      await auditFinish(auditId, "error", connErr.message);
      return json({ error: "Lagring av kopling feila" }, 500);
    }
    if (!updated || updated.length === 0) {
      await auditFinish(auditId, "error", "status endra seg mens handlinga køyrde");
      return json({ error: "Tenanten er ikkje lenger i status 'provisioning' — prøv igjen" }, 409);
    }
    const secretName = "tenant-" + tenant.slug + "-service-role-" + Date.now();
    const { error: keyErr } = await controlSrvSb.rpc("store_tenant_service_role_key", {
      p_tenant_id: tenant_id,
      p_key: serviceRoleKey,
      p_secret_name: secretName,
    });
    if (keyErr) {
      await auditFinish(auditId, "error", "kopling lagra, men nøkkel-lagring feila: " + keyErr.message);
      return json({ error: "Kopling vart lagra, men service_role-nøkkelen kunne ikkje lagrast — prøv igjen" }, 500);
    }
    await auditFinish(auditId, "success", "henta nøklar for ref " + ref);
    return json({ success: true });
  }

  // ── configure_tenant_smtp ─────────────────────────────────────────────────
  // Step 3c (Architect design, 2026-07-13): closes the email-delivery gap
  // found while testing invite_tenant_admin -- a freshly provisioned tenant
  // defaults to Supabase Auth's built-in mailer (2 emails/hour, see
  // supabase/config.toml's [auth.rate_limit] comment), which silently fails
  // to reliably deliver invite/support-access email. Runs BEFORE
  // invite_tenant_admin (4b) for exactly that reason -- an invite sent before
  // this step "succeeds" (sets first_admin_invited_at) while the email may
  // never actually arrive.
  //
  // Unlike every other action in this file, this one does NOT use the
  // tenant's own Vault-stored service_role key -- it calls Supabase's
  // platform Management API (a genuinely different, platform-level
  // credential, not a per-tenant one) to set the SAME shared Resend SMTP
  // credentials on every tenant project. One shared Vibeverk-branded sender
  // (not a per-tenant domain) is used deliberately -- these are operational
  // emails to the CUSTOMER'S OWN STAFF (invite/reset/support-access), not
  // customer-facing correspondence, so there's no branding reason to require
  // a per-tenant verified sending domain (which would reintroduce exactly
  // the onboarding friction this automates away).
  //
  // Never trusts the PATCH response alone -- re-fetches the config
  // afterward and confirms smtp_host/smtp_user actually match what was sent,
  // per this repo's standing "a clean response isn't proof of the intended
  // effect" rule (see CLAUDE.md's Supabase rules).
  if (action === "configure_tenant_smtp") {
    // Security Auditor findings (2026-07-13), all fixed here:
    // - archived tenants were not rejected, unlike every sibling action
    //   that can make a real cross-project write against a still-live
    //   customer project after the relationship supposedly ended.
    // - precondition failures below didn't call auditReject, leaving no
    //   trace of an attempted-and-rejected call, unlike every sibling
    //   action's precondition checks.
    if (tenant.status === "archived") {
      await auditReject(tenant.id, action, "tenant er arkivert");
      return json({ error: "Kan ikkje setje opp SMTP for ein arkivert kunde" }, 403);
    }
    if (!tenant.data_plane_url) {
      await auditReject(tenant.id, action, "kopling (steg 3) manglar");
      return json({ error: "Kopling (steg 3) må vera sett opp først" }, 400);
    }
    const mgmtToken = Deno.env.get("TENANT_MGMT_API_TOKEN");
    const resendKey = Deno.env.get("TENANT_SMTP_RESEND_API_KEY");
    const senderEmail = Deno.env.get("TENANT_SMTP_SENDER_EMAIL");
    const senderName = Deno.env.get("TENANT_SMTP_SENDER_NAME") || "Vibeverk";
    if (!mgmtToken || !resendKey || !senderEmail) {
      await auditReject(tenant.id, action, "delt SMTP-oppsett manglar på server");
      return json({ error: "Delt SMTP-oppsett manglar på server (kontakt utviklar)" }, 500);
    }
    // data_plane_url is already validated (SUPABASE_PROJECT_URL_RE, see
    // update_tenant_connection above) as https://<ref>.supabase.co --
    // extracting the ref here is safe given that existing write-time guard.
    const ref = tenant.data_plane_url.replace(/^https:\/\//, "").split(".")[0];
    // Security Auditor finding (2026-07-13, MEDIUM): this is the one action
    // in this file that uses a PLATFORM-wide Management API token rather
    // than a per-tenant Vault-scoped key -- unlike every other cross-project
    // action, nothing here would otherwise stop a mistaken or malicious
    // data_plane_url pointing at vibeverk-control's own project ref from
    // successfully reconfiguring the control plane's own Auth SMTP.
    const CONTROL_PLANE_PROJECT_REF = "jxoglthrnshabqmdmnui";
    if (ref === CONTROL_PLANE_PROJECT_REF) {
      await auditReject(tenant.id, action, "data_plane_url peikar på kontrollplanet sjølv");
      return json({ error: "Ugyldig data_plane_url — peikar på kontrollplanet sjølv" }, 400);
    }
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const mgmtHeaders = { "Authorization": "Bearer " + mgmtToken, "Content-Type": "application/json" };
    // Found live 2026-07-14: a fresh project's site_url defaults to
    // http://localhost:3000 and its redirect allow-list is empty, so
    // invite_tenant_admin's/generate_support_access's redirectTo (the
    // tenant's real hostname) silently falls back to that localhost
    // default instead -- GoTrue does not error on an unlisted redirectTo,
    // it just ignores it. Set both here from the tenant's own hostnames so
    // the links this same button's hint text already promises ("faktisk
    // kjem fram") actually land on the right place, not localhost.
    const hostnames = (tenant.hostnames as string[]) || [];
    const authPatch: Record<string, unknown> = {
      external_email_enabled: true,
      smtp_host: "smtp.resend.com",
      smtp_port: "587",
      smtp_user: "resend",
      smtp_pass: resendKey,
      smtp_sender_name: senderName,
      smtp_admin_email: senderEmail,
    };
    if (hostnames.length > 0) {
      authPatch.site_url = "https://" + hostnames[0];
      authPatch.uri_allow_list = hostnames.map((h) => "https://" + h + "/**").join(",");
    }
    try {
      const patchResp = await fetch("https://api.supabase.com/v1/projects/" + ref + "/config/auth", {
        method: "PATCH",
        headers: mgmtHeaders,
        body: JSON.stringify(authPatch),
      });
      if (!patchResp.ok) {
        const bodyText = await patchResp.text().catch(() => "");
        const detail = "Management API PATCH HTTP " + patchResp.status + (bodyText ? ": " + bodyText : "");
        await auditFinish(auditId, "error", detail);
        return json({ error: "Kunne ikkje setje SMTP-oppsett (HTTP " + patchResp.status + ")" }, 500);
      }
      // Confirm it actually landed rather than trusting the PATCH alone.
      const getResp = await fetch("https://api.supabase.com/v1/projects/" + ref + "/config/auth", {
        method: "GET",
        headers: mgmtHeaders,
      });
      if (!getResp.ok) {
        await auditFinish(auditId, "error", "stadfesting feila: GET HTTP " + getResp.status);
        return json({ error: "Klarte ikkje stadfeste SMTP-oppsettet etterpå" }, 500);
      }
      const confirmed = await getResp.json();
      const siteUrlOk = hostnames.length === 0 || confirmed.site_url === authPatch.site_url;
      if (confirmed.smtp_host !== "smtp.resend.com" || confirmed.smtp_user !== "resend" || !siteUrlOk) {
        await auditFinish(auditId, "error", "stadfesting feila: verdiane matcha ikkje etter lagring");
        return json({ error: "SMTP-oppsettet vart ikkje lagra korrekt — prøv igjen" }, 500);
      }
    } catch (e) {
      // Never include resendKey/mgmtToken in any error surfaced or logged.
      await auditFinish(auditId, "error", e instanceof Error ? e.message : "nettverksfeil");
      return json({ error: "Kunne ikkje nå Supabase Management API" }, 500);
    }
    // Security Auditor finding (2026-07-13, LOW): check this write's own
    // error rather than claiming unconditional success -- the vendor-side
    // config was genuinely applied and confirmed at this point, but if THIS
    // write fails, smtp_configured_at stays null and Console's badge would
    // misleadingly keep showing "not configured" despite the "✓" just shown.
    const { error: bookkeepingErr } = await controlSrvSb
      .from("tenants")
      .update({ smtp_configured_at: new Date().toISOString() })
      .eq("id", tenant_id);
    if (bookkeepingErr) {
      await auditFinish(auditId, "error", "SMTP sett opp hjå leverandøren, men kunne ikkje lagre stadfestinga: " + bookkeepingErr.message);
      return json({ error: "SMTP vart sett opp, men kunne ikkje lagre stadfestinga — prøv å trykk igjen" }, 500);
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

  // ── invite_tenant_admin ──────────────────────────────────────────────────
  // Step 4b (Architect design, 2026-07-13): closes the onboarding gap found
  // during vibeverk-as-tenant dry-run testing -- a freshly provisioned
  // tenant has zero Auth users in its own project, so nobody can log in
  // until someone manually creates a user via the Supabase dashboard. This
  // sends a REAL Supabase invite (via the tenant's own Admin API, using the
  // already-stored Vault service_role key -- same cross-project pattern as
  // verify_tenant_schema above) to the customer's real first-admin email.
  // The tenant's own baseline schema already has everything needed to turn
  // that into a role='admin' row: handle_new_user() (see
  // supabase/migrations/20260707000001_baseline_schema.sql) inserts into
  // public.users with role taken from raw_user_meta_data->>'role' whenever
  // NEW.invited_at IS NOT NULL -- so this deliberately does NOT hand-write a
  // users row itself, only passes role/display_name in the invite's data
  // payload and lets that existing trigger do the rest.
  //
  // A standing, shared default-admin account across every tenant was
  // considered and explicitly rejected (Architect design): it's a classic
  // never-rotated-shared-secret risk, and worse, it would be a persistent,
  // undisclosed account sitting inside a customer's OWN database --
  // something a customer inspecting their own auth.users table would
  // reasonably read as an undisclosed backdoor. A one-time, real-identity
  // invite has none of that exposure.
  //
  // Gated on schema_verified_at (not routing_verified_at/activation) --
  // resolve_tenant_by_hostname() already resolves a 'provisioning' tenant
  // once schema_verified_at is set (see the exposure-window-closing
  // migration), which is what the invite's redirectTo link needs to
  // actually work when the customer clicks it.
  if (action === "invite_tenant_admin") {
    // .trim().toLowerCase() -- GoTrue normalizes Auth emails to lowercase on
    // invite/signup, and handle_new_user() copies that straight into
    // public.users.email; a differently-cased input here would otherwise
    // silently mismatch generate_support_access's later lookup.
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const { display_name } = body;
    if (!email || email.indexOf("@") === -1) {
      return json({ error: "Gyldig e-postadresse er påkrevd" }, 400);
    }
    if (!tenant.schema_verified_at) {
      await auditReject(tenant.id, action, "skjema er ikkje verifisert enno");
      return json({ error: "Skjema må vera verifisert (steg 5) før admin-brukar kan inviterast" }, 403);
    }
    if (!tenant.data_plane_service_role_secret_id) {
      await auditReject(tenant.id, action, "service_role-nøkkel manglar");
      return json({ error: "Service_role-nøkkel manglar (steg 3)" }, 400);
    }
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { data: tenantServiceKey, error: keyErr } = await controlSrvSb
      .rpc("get_tenant_service_role_key", { p_tenant_id: tenant_id });
    if (keyErr || !tenantServiceKey) {
      await auditFinish(auditId, "error", "fann ikkje service_role-nøkkel");
      return json({ error: "Fann ikkje service_role-nøkkel" }, 400);
    }
    const tenantSrvSb = createClient(tenant.data_plane_url, tenantServiceKey);
    const hostnames = (tenant.hostnames as string[]) || [];
    const redirectTo = hostnames.length > 0 ? "https://" + hostnames[0] + "/workspace/" : undefined;
    const { data: inviteData, error: inviteErr } = await tenantSrvSb.auth.admin.inviteUserByEmail(email, {
      data: { role: "admin", display_name: display_name || email.split("@")[0] },
      redirectTo,
    });
    if (inviteErr) {
      await auditFinish(auditId, "error", inviteErr.message);
      return json({ error: "Invitasjon feila: " + inviteErr.message }, 500);
    }
    await controlSrvSb
      .from("tenants")
      .update({ first_admin_invited_at: tenant.first_admin_invited_at || new Date().toISOString() })
      .eq("id", tenant_id);
    // Audit log records that an invite was sent and to whom (needed to know
    // who has admin access to a customer's project) -- flagged for a Privacy
    // and Compliance Advisor pass before this handles a real paying
    // customer's data, since this is customer PII in a control-plane table
    // readable by every superadmin, not yet reviewed for that.
    await auditFinish(auditId, "success", "invitert: " + email);
    return json({ success: true, user_id: inviteData?.user?.id });
  }

  // ── generate_support_access ──────────────────────────────────────────────
  // Architect design (2026-07-13): lets an operator help a customer
  // directly, without knowing their password and without any standing
  // shared credential. Mints a genuinely time-limited Supabase magic-link
  // for an EXISTING real admin user at that tenant (impersonation via real
  // identity, not a phantom account) -- naturally expires per the tenant
  // project's own OTP-expiry setting, nothing persistent left behind.
  //
  // Deliberately does NOT persist the returned link/token anywhere (it is a
  // live bearer credential until used or expired) -- only the fact that an
  // operator requested access, for whom, and when goes into
  // broker_audit_log. Console shows the link once for the operator to open
  // directly; it is never emailed to the customer, since the entire point
  // is bypassing the need for their password for a direct support session.
  //
  // Allowed for 'provisioning' or 'active' (not 'archived') -- support
  // access can legitimately be needed before a tenant ever goes live, e.g.
  // while helping finish onboarding.
  if (action === "generate_support_access") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.indexOf("@") === -1) {
      return json({ error: "Gyldig e-postadresse er påkrevd" }, 400);
    }
    if (tenant.status === "archived") {
      await auditReject(tenant.id, action, "tenant er arkivert");
      return json({ error: "Kan ikkje gje support-tilgang til ein arkivert kunde" }, 403);
    }
    if (!tenant.data_plane_service_role_secret_id) {
      await auditReject(tenant.id, action, "service_role-nøkkel manglar");
      return json({ error: "Service_role-nøkkel manglar (steg 3)" }, 400);
    }
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { data: tenantServiceKey, error: keyErr } = await controlSrvSb
      .rpc("get_tenant_service_role_key", { p_tenant_id: tenant_id });
    if (keyErr || !tenantServiceKey) {
      await auditFinish(auditId, "error", "fann ikkje service_role-nøkkel");
      return json({ error: "Fann ikkje service_role-nøkkel" }, 400);
    }
    const tenantSrvSb = createClient(tenant.data_plane_url, tenantServiceKey);
    // Confirm a real admin user actually exists for this email before
    // minting a link -- a clear error naming Problem 1 (invite_tenant_admin)
    // as the fix, rather than a confusing failure from generateLink() itself
    // against an email with no user.
    const { data: existingUser, error: userLookupErr } = await tenantSrvSb
      .from("users")
      .select("id, role")
      .eq("email", email)
      .eq("role", "admin")
      .maybeSingle();
    if (userLookupErr || !existingUser) {
      await auditFinish(auditId, "error", "ingen admin-brukar med denne e-posten finst (inviter admin_brukar først)");
      return json({ error: "Ingen admin-brukar med denne e-posten finst enno — inviter admin-brukar først (steg 10)" }, 404);
    }
    const hostnames = (tenant.hostnames as string[]) || [];
    const redirectTo = hostnames.length > 0 ? "https://" + hostnames[0] + "/workspace/?support=1" : undefined;
    const { data: linkData, error: linkErr } = await tenantSrvSb.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (linkErr) {
      await auditFinish(auditId, "error", linkErr.message);
      return json({ error: "Klarte ikkje lage support-lenke: " + linkErr.message }, 500);
    }
    // Never log the actual link/token -- it's a live bearer credential.
    await auditFinish(auditId, "success", "support-tilgang generert for: " + email);
    return json({ success: true, action_link: linkData?.properties?.action_link });
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
  //
  // Architect design (2026-07-13): also allowed for status = 'active', same
  // dual-status pattern already used by update_tenant_hostnames below --
  // a real, currently-live customer legitimately needs routing re-verified
  // after go-live too (DNS provider migration, added hostname), and the only
  // alternative -- reverting an already-active tenant back to 'provisioning'
  // just to run this check -- is itself dangerous, since
  // resolve_tenant_by_hostname() treats the two statuses differently
  // (active resolves unconditionally; provisioning requires
  // schema_verified_at). 'archived' still rejected: nothing is publicly
  // resolvable for an archived tenant, so there is nothing to verify.
  if (action === "verify_tenant_routing") {
    if (tenant.status !== "provisioning" && tenant.status !== "active") {
      await auditReject(tenant.id, action, "tenant er ikkje i status 'provisioning' eller 'active' (er: " + tenant.status + ")");
      return json({ error: "Denne handlinga er berre tillate mens kunden er i status 'provisioning' eller 'active'" }, 403);
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
      return json({ error: "Skjema må vera verifisert (steg 5) før ruting kan verifiserast" }, 403);
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
    // Architect design (2026-07-13): on failure, only clear routing_verified_at
    // for a still-provisioning tenant (unchanged behavior -- this still gates
    // activate_tenant below). For an already-active tenant, a failed re-check
    // must NOT null out "last known good" history -- a transient DNS hiccup
    // shouldn't flip Console's badge back to "unverified" for a customer who
    // is, in fact, still being served correctly right now. The audit log
    // below records the failed re-check either way, so no visibility is lost.
    const updatePayload: { routing_verified_at?: string | null } = {};
    if (allOk) {
      updatePayload.routing_verified_at = new Date().toISOString();
    } else if (tenant.status === "provisioning") {
      updatePayload.routing_verified_at = null;
    }
    // Security Auditor finding (2026-07-13): this write spans a per-hostname
    // fetch loop that can take several seconds -- unlike every sibling action
    // in this file (update_tenant_hostnames, activate_tenant, archive_tenant),
    // it previously never checked whether the row actually matched, so a
    // status change mid-flight (e.g. another operator archiving this tenant)
    // would silently persist nothing while the audit log still said
    // "success". Now mirrors the sibling pattern: check row count, record a
    // distinct audit outcome when the tenant's status moved out from under
    // this call, and tell the caller instead of reporting a false success.
    if (Object.keys(updatePayload).length > 0) {
      // .eq("status", tenant.status) -- not the old hardcoded "provisioning" --
      // otherwise this write would silently affect 0 rows for an active tenant,
      // leaving the operator with a misleading result and nothing persisted.
      const { data: updated, error: updateErr } = await controlSrvSb
        .from("tenants")
        .update(updatePayload)
        .eq("id", tenant_id)
        .eq("status", tenant.status)
        .select("id");
      if (updateErr) {
        await auditFinish(auditId, "error", updateErr.message);
        return json({ error: "Klarte ikkje lagre rutingresultatet" }, 500);
      }
      if (!updated || updated.length === 0) {
        await auditFinish(auditId, "error", "status endra seg mens handlinga køyrde — resultatet vart ikkje lagra");
        return json({ error: "Tenanten sin status endra seg medan sjekken køyrde — prøv igjen" }, 409);
      }
    }
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
    // Architect design (2026-07-13): a tenant with zero admin users has no
    // path to log in at all once live -- confirms an invite was SENT, not
    // accepted (same class of cached-check as schema/routing_verified_at
    // above), but that's enough to stop a customer going live with nobody
    // able to sign in.
    if (!tenant.first_admin_invited_at) missing.push("ingen admin-brukar er invitert enno (køyr invite_tenant_admin)");
    if (!tenant.smtp_configured_at) missing.push("SMTP er ikkje sett opp enno (køyr configure_tenant_smtp)");
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

  // ── archive_tenant ────────────────────────────────────────────────────────
  // "Sletting" for a tenant is a soft archive, never a hard DELETE: a real
  // DELETE would break broker_audit_log's tenant_id trail for no benefit,
  // since the customer's actual data-plane Supabase project is a completely
  // separate project this control-plane row never touches either way --
  // removing the row wouldn't remove any customer data, only the ability to
  // ever look back at what happened. Archiving also fully stops public
  // exposure as a side effect with no extra code: resolve_tenant_by_hostname()
  // (see the migrations above) only ever resolves status = 'active'
  // unconditionally, or status = 'provisioning' with schema_verified_at set
  // -- 'archived' matches neither branch, so an archived tenant's hostnames
  // stop resolving the moment this write commits.
  if (action === "archive_tenant") {
    if (tenant.status === "archived") {
      return json({ error: "Tenanten er alt arkivert" }, 409);
    }
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { data: updated, error } = await controlSrvSb
      .from("tenants")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", tenant_id)
      .eq("status", tenant.status)
      .select("id");
    if (error) {
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Arkivering feila" }, 500);
    }
    if (!updated || updated.length === 0) {
      await auditFinish(auditId, "error", "status endra seg mens handlinga køyrde");
      return json({ error: "Tenanten sin status endra seg — prøv igjen" }, 409);
    }
    await auditFinish(auditId, "success");
    return json({ success: true });
  }

  await auditReject(tenant.id, String(action), "ukjend handling");
  return json({ error: "Ukjend handling: " + action }, 400);
});
