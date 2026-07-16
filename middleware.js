// middleware.js — Vercel Routing Middleware (Phase 6 of the SaaS-scaling
// plan). Real implementation, replacing the Phase 0 mechanism-proof (which
// only echoed the Host header back in a response header). See
// docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md's Phase 6
// addendum for the full design and its sequencing rationale.
//
// MUST be named middleware.js, never middleware.mjs. Confirmed empirically
// 2026-07-08 (isolated single-variable retest): Vercel's "Framework Preset:
// Other" build pipeline silently fails to compile a root-level
// middleware.mjs into an actual Routing Middleware function -- no build
// error, no warning, it's just treated as an inert static asset.
// middleware.js works immediately, with no "type": "module" needed in
// package.json. Do not "fix" this back to .mjs because the docs say it
// should work -- that claim does not hold for this project shape.
//
// Two jobs:
// 1. Every request for /config.js is rewritten to /api/tenant-config (the
//    Phase 6 per-tenant config generator) -- unconditionally, since that
//    function does the real hostname resolution itself.
// 2. For actual page requests (the matcher below), resolve the tenant here
//    too, so an unknown hostname gets a real "not a customer" response
//    instead of silently serving index.html with no window.SITE_CONFIG
//    behind it (core.js is not guarded against that today).
//
// The matcher list below was empirically verified against a real deployment
// 2026-07-16 (curl against the live "vibeverk" Vercel project, --resolve to
// bypass DNS caching) -- root, /console(/), /workspace(/) all correctly
// serve their respective index.html via Vercel's own static routing.
//
// DNS cutover happened 2026-07-16: vibeverk.no's apex A-record now points at
// Vercel, replacing GitHub Pages (see docs/roadmap/ROADMAP.md "Next" point 2
// and ADR-0007's Phase 2 addendum for the full history) -- this file is now
// live for real production traffic, not just the "vibeverk-j1yg" canary
// project it was originally developed against.

import { next, rewrite } from "@vercel/functions";

export const config = {
  matcher: [
    "/",
    "/config.js",
    "/workspace",
    "/workspace/",
    "/console",
    "/console/",
    "/admin",
    "/admin/",
  ],
};

// ── Enkel utviklingsfase-sperre (2026-07-16) ────────────────────────────────
// IKKJE ekte tryggleik -- berre ei hindring mot tilfeldige besøkjande medan
// heile plattforma (inkl. vibeverk.no sjølv) framleis er i utviklingsfase.
// HTTP Basic Auth, sjekka FØR noko anna -- deler éin felles passordfrase på
// tvers av alle domene/hostnamen som går gjennom denne fila (same middleware
// på begge Vercel-prosjekt: "vibeverk" og "vibeverk-j1yg"). Gjeld difor
// samstundes vibeverk.no, console.vibeverk.no, workspace.vibeverk.no,
// staging.vibeverk.no OG sunnvask.vibeverk.no -- ikkje valfritt per domene.
// Kjem i TILLEGG til, ikkje i staden for, dei eksisterande admin-/Workspace-/
// Console-innloggingane (dei står urørte bak denne sperra).
// Slå AV att seinare ved å fjerne `SITE_LOCK_PASSWORD`-miljøvariabelen på
// begge prosjekt (ingen kodeendring naudsynt) -- viss variabelen manglar,
// sleppast alle gjennom uendra (fail-open, med vilje, sidan dette berre er
// ei mellombels hindring, ikkje ei sikkerheitsgrense).
function checkSiteLock(request) {
  const expected = process.env.SITE_LOCK_PASSWORD;
  if (!expected) return true;
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Basic ")) return false;
  let decoded;
  try { decoded = atob(auth.slice(6)); } catch (e) { return false; }
  const sep = decoded.indexOf(":");
  const pass = sep === -1 ? decoded : decoded.slice(sep + 1);
  return pass === expected;
}

export default async function middleware(request) {
  const url = new URL(request.url);

  if (!checkSiteLock(request)) {
    return new Response("Autentisering kravd.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Vibeverk (under utvikling)"' },
    });
  }

  if (url.pathname === "/config.js") {
    return rewrite(new URL("/api/tenant-config", request.url));
  }

  const controlUrl = process.env.VIBEVERK_CONTROL_URL;
  const controlAnonKey = process.env.VIBEVERK_CONTROL_ANON_KEY;
  const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];

  if (!controlUrl || !controlAnonKey || !host) {
    console.error("[vibeverk-middleware] mangler control-plane-config eller host — slepp gjennom uløyst");
    return next();
  }

  try {
    const resp = await fetch(controlUrl + "/rest/v1/rpc/resolve_tenant_by_hostname", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: controlAnonKey,
        Authorization: "Bearer " + controlAnonKey,
      },
      body: JSON.stringify({ p_hostname: host }),
    });
    if (!resp.ok) throw new Error("resolve_tenant_by_hostname HTTP " + resp.status);
    const rows = await resp.json();
    const tenant = Array.isArray(rows) ? rows[0] : null;
    if (!tenant) {
      return new Response(
        "Dette domenet er ikkje registrert som ein Vibeverk-kunde.",
        { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }
  } catch (e) {
    console.error("[vibeverk-middleware] tenant-oppslag feila", e);
    return new Response(
      "Mellombels feil — prøv igjen straks.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  return next();
}
