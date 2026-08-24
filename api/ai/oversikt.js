// api/ai/oversikt.js — Vercel Function (Node.js Runtime) backing Workspace's
// Oversikt module (workspace/module-oversikt.js). Second server endpoint on
// the platform calling a third-party paid LLM (Anthropic), mirroring
// api/ai/annual-wheel.js's shape exactly -- including its Node.js-runtime
// choice from day one (annual-wheel.js originally shipped on Edge runtime
// and hit a real production 25s-timeout incident before switching, see
// docs/project/CHANGELOG.md 0.95.1 -- this endpoint starts where that one
// ended up, not where it started).
//
// Pipeline: analyzeSituationInput → generateOverviewAnalysis →
// validateOverviewResponse (see api/_lib/oversikt-ai.js).
//
// Auth: same pattern as annual-wheel.js -- resolve tenant by Host header,
// verify the caller's bearer token against that SAME tenant's own Supabase
// Auth + users-table role, and check
// tenant.custom_modules_manifest["oversikt"].enabled
// (control-plane-authoritative, never the client's own CFG.customModules)
// before ever calling Anthropic. admin/editor only, not member -- this
// endpoint spends real money per GENERATION, so only roles that can trigger
// one may call it. This does NOT mean member can't see an already-generated
// analysis: the `store` table's existing store_read_authenticated RLS policy
// (supabase/migrations/20260707000001_baseline_schema.sql) already lets any
// authenticated role read any non-superconfig key, including
// "wsp-oversikt" -- same read-visibility as every other App.store-backed
// Workspace module (confirmed security-reviewed 2026-08-05, not a
// regression introduced here, just documented precisely).

import { resolveTenantByHostname } from "../_lib/resolve-tenant.js";
import { getOrCreateTraceparent } from "../_lib/trace.js";
import { analyzeSituationInput, generateOverviewAnalysis, validateOverviewResponse } from "../_lib/oversikt-ai.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function errorResponse(status, message) {
  return jsonResponse({ error: message }, status);
}

// Best-effort, per-instance-only rate limit -- same known gap as
// annual-wheel.js's own limiter (see that file's comment): Vercel Function
// instances are ephemeral, this Map is not shared across regions/cold
// starts. Same numeric ceiling for parity with the sibling endpoint;
// Oversikt's "Oppdater oversikten" (iterate-on-description) flow may turn
// out to need a looser ceiling once real usage data exists, but don't
// invent new infra to guess that in advance.
var recentCalls = new Map();
var RATE_LIMIT_WINDOW_MS = 60000;
var RATE_LIMIT_MAX = 5;
function isRateLimited(key) {
  var now = Date.now();
  var hits = (recentCalls.get(key) || []).filter(function (t) { return now - t < RATE_LIMIT_WINDOW_MS; });
  hits.push(now);
  recentCalls.set(key, hits);
  return hits.length > RATE_LIMIT_MAX;
}

var MAX_EXISTING_TITLES = 300;

function validateRequestBody(body) {
  if (!body || typeof body !== "object") return "Mangler førespurnadsinnhald.";
  if (typeof body.description !== "string" || !body.description.trim()) return "Mangler skildring av situasjonen.";
  if (body.description.length > 1500) return "Skildringa er for lang.";
  if (body.title !== undefined && (typeof body.title !== "string" || body.title.length > 90)) return "Ugyldig tittelfelt.";
  if (body.scenarioType !== undefined && typeof body.scenarioType !== "string") return "Ugyldig felt: type situasjon.";
  if (body.depth !== undefined && ["simple", "normal", "thorough"].indexOf(body.depth) === -1) return "Ugyldig felt: omfang.";
  if (body.requestedSections !== undefined) {
    if (!Array.isArray(body.requestedSections)) return "requestedSections må vere ei liste.";
    for (var i = 0; i < body.requestedSections.length; i++) {
      if (["needs", "dependencies", "impacts", "blindSpots"].indexOf(body.requestedSections[i]) === -1) return "Ugyldig analyseområde i requestedSections.";
    }
  }
  if (body.existingItemTitles !== undefined) {
    if (!Array.isArray(body.existingItemTitles)) return "existingItemTitles må vere ei liste.";
    if (body.existingItemTitles.length > MAX_EXISTING_TITLES) return "For mange eksisterande punkt.";
    for (var j = 0; j < body.existingItemTitles.length; j++) {
      var x = body.existingItemTitles[j];
      if (!x || typeof x !== "object" || typeof x.title !== "string" || !x.title.trim() || x.title.length > 160) return "Ugyldig punkt i existingItemTitles.";
      if (x.section !== undefined && ["needs", "dependencies", "impacts", "blindSpots"].indexOf(x.section) === -1) return "Ugyldig section i existingItemTitles.";
    }
  }
  return null;
}

async function verifyWorkspaceCaller(tenant, bearerToken) {
  if (!tenant.data_plane_url || !tenant.data_plane_anon_key) return { ok: false, status: 500, reason: "Tenanten manglar Supabase-oppsett." };
  var authResp = await fetch(tenant.data_plane_url + "/auth/v1/user", {
    headers: { apikey: tenant.data_plane_anon_key, Authorization: "Bearer " + bearerToken },
  });
  if (!authResp.ok) return { ok: false, status: 401, reason: "Ugyldig eller utløpt innlogging." };
  var user = await authResp.json();
  if (!user || !user.id) return { ok: false, status: 401, reason: "Ugyldig innlogging." };

  var roleResp = await fetch(
    tenant.data_plane_url + "/rest/v1/users?id=eq." + encodeURIComponent(user.id) + "&select=role",
    { headers: { apikey: tenant.data_plane_anon_key, Authorization: "Bearer " + bearerToken } }
  );
  if (!roleResp.ok) return { ok: false, status: 401, reason: "Kunne ikkje stadfeste brukarrolle." };
  var rows = await roleResp.json();
  var role = Array.isArray(rows) && rows[0] && rows[0].role;
  if (role !== "admin" && role !== "editor") return { ok: false, status: 403, reason: "Denne funksjonen krev admin- eller redaktør-rolle." };
  return { ok: true, userId: user.id, role: role };
}

async function handler(request) {
  if (request.method !== "POST") return errorResponse(405, "Berre POST er støtta.");

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[oversikt] mangler ANTHROPIC_API_KEY");
    return errorResponse(500, "Oversikt er ikkje ferdig sett opp på denne installasjonen.");
  }

  var authHeader = request.headers.get("authorization") || "";
  var bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!bearerMatch) return errorResponse(401, "Du må vere innlogga.");
  var bearerToken = bearerMatch[1];

  var hostHeader = request.headers.get("host") || "";
  var tenant;
  try {
    tenant = await resolveTenantByHostname(hostHeader, getOrCreateTraceparent(request));
  } catch (e) {
    console.error("[oversikt] resolve_tenant_by_hostname feila", e);
    return errorResponse(502, "Kunne ikkje slå opp installasjonen.");
  }
  if (!tenant) return errorResponse(404, "Ukjend installasjon.");

  // Same grunngjeving som annual-wheel.js sin eigen tilsvarande sjekk: rolle
  // åleine er ikkje nok, sidan éin delt Vercel-utrulling/ANTHROPIC_API_KEY
  // betener alle tenantar (ADR-0007) -- utan denne sjekken kunne ein
  // admin/editor hos EIN KVA SOM HELST tenant bruke opp ekte Anthropic-
  // kostnad sjølv om tenanten deira aldri har fått Oversikt aktivert.
  var customModulesManifest = tenant.custom_modules_manifest || {};
  var oversiktModule = customModulesManifest["oversikt"];
  if (!oversiktModule || oversiktModule.enabled !== true) {
    return errorResponse(403, "Oversikt er ikkje aktivert for denne installasjonen.");
  }

  var callerCheck;
  try {
    callerCheck = await verifyWorkspaceCaller(tenant, bearerToken);
  } catch (e) {
    console.error("[oversikt] innloggingskontroll feila", e);
    return errorResponse(502, "Kunne ikkje stadfeste innlogginga.");
  }
  if (!callerCheck.ok) return errorResponse(callerCheck.status, callerCheck.reason);

  if (isRateLimited(hostHeader + ":" + callerCheck.userId)) {
    return errorResponse(429, "For mange forsøk på kort tid. Prøv igjen om litt.");
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse(400, "Ugyldig JSON i førespurnaden.");
  }
  var validationError = validateRequestBody(body);
  if (validationError) return errorResponse(400, validationError);

  try {
    var profile = analyzeSituationInput(body);

    var raw;
    try {
      raw = await generateOverviewAnalysis(profile);
    } catch (e) {
      // Ikkje logg full skildringstekst -- berre metadata som er nyttig for
      // feilsøking utan å eksponere kundens skrivne innhald (same prinsipp
      // som annual-wheel.js sin eigen feillogging).
      console.error("[oversikt] AI-generering feila", { scenarioType: profile.scenarioType, descLength: profile.description.length, error: String(e && e.message || e) });
      return errorResponse(502, "Oversikten kunne ikkje genererast akkurat no. Eksisterande punkt er urørte.");
    }

    var validated = validateOverviewResponse(raw, profile);
    return jsonResponse(validated, 200);
  } catch (e) {
    console.error("[oversikt] uventa feil", e);
    return errorResponse(500, "Noko gjekk gale. Eksisterande punkt er urørte.");
  }
}

export default { fetch: handler };
