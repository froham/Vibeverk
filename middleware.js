// middleware.js — Vercel Routing Middleware (Phase 6 of the SaaS-scaling
// plan, mechanism-proof scope only — see docs/decisions/ADR-0007-multi-tenant-
// hosting-architecture.md's 2026-07-08 addendum).
//
// This is the FIRST server/edge code this app has ever had — everything
// else is static HTML/JS served as-is, no build step, no bundler.
//
// Scope, deliberately minimal per Architect consultation: read the Host
// header, pass the request through completely unchanged, echo the Host
// value back in a response header so it can be verified externally
// (curl -I). No tenant lookup, no registry, no Supabase project selection —
// there is no registry yet (that's a later phase). This step only proves
// the underlying Vercel Edge Middleware mechanism works at all for this
// codebase, which had never been exercised before this file existed.
//
// MUST be named middleware.js, never middleware.mjs. Confirmed empirically
// 2026-07-08 (isolated single-variable retest, same project/settings, only
// the filename changed): Vercel's "Framework Preset: Other" build pipeline
// silently fails to compile a root-level middleware.mjs into an actual
// Routing Middleware function — no build error, no warning, it's just
// treated as an inert static asset. middleware.js works immediately, with
// no "type": "module" needed in package.json. This contradicts Vercel's
// own docs, which present .mjs as a documented equivalent to
// "type": "module" — that claim does not hold for this project shape.
// Do not "fix" this back to .mjs because the docs say it should work.
//
// Deployed ONLY to the disposable Vercel test project from the Phase 0
// parity test — never pointed at vibeverk.no's live GitHub Pages domain.

import { next } from "@vercel/functions";

export default function middleware(request) {
  const host = request.headers.get("host") || "unknown";
  console.log(`[vibeverk-middleware] invoked, host=${host}`);
  return next({
    headers: {
      "x-vibeverk-host-seen": host
    }
  });
}
