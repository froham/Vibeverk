// api/workspace-manifest.js — Vercel Function, generates /workspace/manifest.json
// per tenant so "Legg til på Heimskjerm"/desktop install shows the tenant's own
// branding instead of nothing. middleware.js rewrites /workspace/manifest.json here
// (exempted from the site-lock Basic Auth gate -- see middleware.js's own comment,
// Chrome's background installability check for "Add to Home Screen" doesn't carry
// the tab's cached credentials, confirmed 2026-07-26).
//
// Generation itself lives in api/_lib/tenant-manifest.js, shared with
// api/site-manifest.js and api/admin-manifest.js (extracted 2026-07-26) -- see
// that file's header comment for the full two-hop trust-boundary rationale.

import { generateTenantManifestResponse } from "./_lib/tenant-manifest.js";
import { getOrCreateTraceparent } from "./_lib/trace.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  return generateTenantManifestResponse(request.headers.get("host") || "", {
    startUrl: "/workspace/",
    scope: "/workspace/",
    defaultName: "Arbeidsområde",
    defaultShortName: "Workspace",
    defaultBackground: "#ffffff",
    defaultTheme: "#2563eb",
    useWorkspaceAccent: true,
  }, getOrCreateTraceparent(request));
}
