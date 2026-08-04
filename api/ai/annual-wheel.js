// api/ai/annual-wheel.js — Vercel Function (Edge Runtime) backing Workspace's
// Smart årshjul module (workspace/module-smart-aarshjul.js). First server
// endpoint on the platform that calls a third-party paid LLM (Anthropic) —
// see docs/decisions/ for the ADR this warrants once the design is confirmed
// in production.
//
// Pipeline (spec section 14, kept as separate, testable functions):
//   analyzeBusinessInput → identifyRelevantSourceQueries → searchApprovedSources
//   → normalizeSourceResults → generateAnnualWheelSuggestions → validateAnnualWheelResponse
//
// Auth: this endpoint spends real money per call and must not be an open
// door. Workspace itself is gated behind Supabase Auth (email+password,
// role admin/editor/member) — this endpoint re-verifies that same gate
// server-side (resolve tenant by Host header, exactly like
// api/tenant-config.js, then verify the caller's bearer token against that
// SAME tenant's own Supabase Auth + users-table role), rather than trusting
// the client. Per ADR-0007, a single Vercel deployment can serve many
// tenant hostnames, so "resolve by Host" is required here even though each
// tenant's own data is single-tenant.
//
// Written as plain .js using ESM import/export, matching tenant-config.js's
// already-confirmed convention for this project shape (no "type":"module"
// in package.json; Vercel's Edge Runtime compiles this directly, unlike
// middleware.js's separate, already-documented .mjs pitfall).

import { resolveTenantByHostname } from "../_lib/resolve-tenant.js";
import {
  identifyRelevantSourceQueries,
  searchApprovedSources,
  normalizeSourceResults,
  INDUSTRIES,
} from "../_lib/annual-wheel-sources.js";
import {
  analyzeBusinessInput,
  generateAnnualWheelSuggestions,
  validateAnnualWheelResponse,
} from "../_lib/annual-wheel-ai.js";

export const config = { runtime: "edge" };

var MAX_ACTIVITIES = 500;
var ALLOWED_CATEGORIES = ["planning", "marketing", "seasonal", "maintenance", "purchasing", "digital", "professional", "events", "administration", "deadlines", "evaluation", "custom"];
var ALLOWED_RECURRENCE = ["none", "monthly"];

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function errorResponse(status, message) {
  return jsonResponse({ error: message }, status);
}

// Best-effort, per-instance-only rate limit -- Edge Function instances are
// ephemeral and this map is NOT shared across regions/cold starts, so this is
// a cheap speed bump, not a real distributed limiter. Documented as a known
// gap (see this file's own header + the ADR this endpoint warrants) rather
// than pretending it's robust: there's no Upstash/shared-store infra in this
// project yet to build a real one on.
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

function validMonth(v) {
  return Number.isInteger(v) && v > 0 && v < 13;
}
function validDay(v) {
  return v === null || (Number.isInteger(v) && v > 0 && v < 32);
}

function validateRequestBody(body) {
  if (!body || typeof body !== "object") return "Mangler førespurnadsinnhald.";
  if (typeof body.businessDescription !== "string" || !body.businessDescription.trim()) return "Mangler skildring av verksemda.";
  if (body.businessDescription.length > 1200) return "Skildringa av verksemda er for lang.";
  if (body.importantSeasons !== undefined && (typeof body.importantSeasons !== "string" || body.importantSeasons.length > 700)) return "Ugyldig felt: viktige sesongar.";
  if (body.focusAreasText !== undefined && (typeof body.focusAreasText !== "string" || body.focusAreasText.length > 700)) return "Ugyldig felt: fokusområde.";
  if (body.industry !== undefined && typeof body.industry !== "string") return "Ugyldig bransjefelt.";
  if (body.existingActivities !== undefined) {
    if (!Array.isArray(body.existingActivities)) return "existingActivities må vere ei liste.";
    if (body.existingActivities.length > MAX_ACTIVITIES) return "For mange eksisterande aktivitetar.";
    for (var i = 0; i < body.existingActivities.length; i++) {
      var a = body.existingActivities[i];
      if (!a || typeof a !== "object") return "Ugyldig aktivitet i lista.";
      if (typeof a.title !== "string" || !a.title.trim() || a.title.length > 160) return "Ugyldig tittel i eksisterande aktivitet.";
      if (a.month !== undefined && a.month !== null && !validMonth(a.month)) return "Ugyldig månad i eksisterande aktivitet.";
      if (a.day !== undefined && !validDay(a.day)) return "Ugyldig dag i eksisterande aktivitet.";
      if (a.recurrence !== undefined && ALLOWED_RECURRENCE.indexOf(a.recurrence) === -1) return "Ugyldig gjentakingsverdi.";
      if (a.category !== undefined && ALLOWED_CATEGORIES.indexOf(a.category) === -1) return "Ugyldig kategori i eksisterande aktivitet.";
      if (a.locked !== undefined && typeof a.locked !== "boolean") return "Ugyldig låsefelt.";
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

export default async function handler(request) {
  if (request.method !== "POST") return errorResponse(405, "Berre POST er støtta.");

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[annual-wheel] mangler ANTHROPIC_API_KEY");
    return errorResponse(500, "Smart årshjul er ikkje ferdig sett opp på denne installasjonen.");
  }

  var authHeader = request.headers.get("authorization") || "";
  var bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!bearerMatch) return errorResponse(401, "Du må vere innlogga.");
  var bearerToken = bearerMatch[1];

  var hostHeader = request.headers.get("host") || "";
  var tenant;
  try {
    tenant = await resolveTenantByHostname(hostHeader);
  } catch (e) {
    console.error("[annual-wheel] resolve_tenant_by_hostname feila", e);
    return errorResponse(502, "Kunne ikkje slå opp installasjonen.");
  }
  if (!tenant) return errorResponse(404, "Ukjend installasjon.");

  // Rolle (admin/editor) er IKKJE det same som at tenanten faktisk har fått
  // denne funksjonen aktivert -- utan denne sjekken kan ein admin/editor hos
  // EIN KVA SOM HELST tenant (same delte Vercel-utrulling/ANTHROPIC_API_KEY
  // betener alle tenantar, jf. ADR-0007) kalle endepunktet direkte og bruke
  // opp ekte Anthropic-kostnad sjølv om tenanten deira aldri har fått Smart
  // årshjul aktivert. tenant.enabled_modules er den kontrollplan-autoritative
  // kjelda (same felt som api/tenant-config.js sin eigen
  // `intranettFeatures: enabledModules.intranettFeatures || {}"`), IKKJE
  // klienten sin eigen CFG.intranettFeatures (som berre styrer UI-synlegheit).
  var enabledModules = tenant.enabled_modules || {};
  var tenantIntranettFeatures = enabledModules.intranettFeatures || {};
  if (tenantIntranettFeatures.smartAarshjul !== true) {
    return errorResponse(403, "Smart årshjul er ikkje aktivert for denne installasjonen.");
  }

  var callerCheck;
  try {
    callerCheck = await verifyWorkspaceCaller(tenant, bearerToken);
  } catch (e) {
    console.error("[annual-wheel] innloggingskontroll feila", e);
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
  if (INDUSTRIES.indexOf(body.industry) === -1) body.industry = "other";

  try {
    var profile = analyzeBusinessInput(body);
    var queries = identifyRelevantSourceQueries(profile);
    var candidates = searchApprovedSources(queries);
    var sourceResults = normalizeSourceResults(candidates);

    // Ikkje logg full verksemdstekst (spec seksjon 17) -- berre metadata som
    // er nyttig for feilsøking utan å eksponere kundens skrivne innhald.
    var raw;
    try {
      raw = await generateAnnualWheelSuggestions(profile, sourceResults);
    } catch (e) {
      console.error("[annual-wheel] AI-generering feila", { industry: profile.industry, descLength: profile.businessDescription.length, error: String(e && e.message || e) });
      return errorResponse(502, "Forslaga kunne ikkje genererast akkurat no. Dei eksisterande aktivitetane dine er urørte.");
    }

    var validated = validateAnnualWheelResponse(raw);
    return jsonResponse(validated, 200);
  } catch (e) {
    console.error("[annual-wheel] uventa feil", e);
    return errorResponse(500, "Noko gjekk gale. Dei eksisterande aktivitetane dine er urørte.");
  }
}
