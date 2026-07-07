// middleware.mjs — Vercel Routing Middleware (Phase 6 of the SaaS-scaling
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
// .mjs extension (not .js) is deliberate: Vercel's non-framework convention
// requires either "type": "module" in package.json or a .mjs extension for
// middleware using ES module imports. Adding "type": "module" globally
// would break test.js/test-workspace.js's CommonJS require("jsdom") calls —
// .mjs avoids that entirely, no package.json "type" field needed.
//
// Deployed ONLY to the disposable Vercel test project from the Phase 0
// parity test — never pointed at vibeverk.no's live GitHub Pages domain.

import { next } from "@vercel/functions";

export default function middleware(request) {
  const host = request.headers.get("host") || "unknown";
  // TEMPORARY diagnostic log — Phase 6 mechanism-proof debugging only,
  // remove once the x-vibeverk-host-seen response header is confirmed
  // reaching real HTTP responses. Vercel's Logs panel only shows console
  // output, not invocation telemetry, so this is the only way to tell
  // "middleware didn't run" apart from "middleware ran but its header
  // got stripped downstream".
  console.log(`[vibeverk-middleware] invoked, host=${host}`);
  return next({
    headers: {
      "x-vibeverk-host-seen": host
    }
  });
}
