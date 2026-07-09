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
// The matcher list below is a first pass, NOT yet empirically verified
// against how this project's static files actually get served under
// "Framework Preset: Other" (root index.html, workspace/index.html,
// console/index.html, admin/index.html) -- per this repo's own established
// discipline (the .js-vs-.mjs lesson above is a direct example of a Vercel
// doc claim that didn't hold), this MUST be checked with a real deployment
// and real requests before being trusted, not assumed correct from reading
// this file.
//
// Deployed ONLY to a disposable Vercel test/canary project for Phase 6
// development -- never pointed at vibeverk.no's live GitHub Pages domain.
// vibeverk.no's own cutover from GitHub Pages is a separate, later,
// explicitly-approved decision (see ADR-0007's Phase 2 addendum) -- nothing
// here changes that.

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

export default async function middleware(request) {
  const url = new URL(request.url);

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
