// api/tenant-config.js — Vercel Function (Phase 6 of the SaaS-scaling plan).
//
// Serves window.SITE_CONFIG=... as if it were the static config.js file,
// generated per-request from the control plane's tenant registry instead
// of being a fixed per-customer fork. middleware.js rewrites any request
// for /config.js to this function.
//
// Deliberately minimal: does NOT replace the existing superconfig/broker
// layer (core.js's applySuperConfig(), already polling the tenant's OWN
// data-plane project every 5s for workspace colours/fonts/features) --
// this only replaces the static base-skeleton layer that used to be a
// per-customer config.js fork. See docs/decisions/ADR-0007's Phase 6
// addendum for the full design rationale, including why this is a smaller
// change than it looks (no core.js rewrite needed -- it only ever depended
// on window.SITE_CONFIG existing before it runs, which is still true here).
//
// Written as plain .js (not .mjs) using ESM import/export syntax, matching
// middleware.js's own already-confirmed convention for this project shape
// (no "type": "module" in package.json). That confirmation was specific to
// Vercel's Routing Middleware compilation step, NOT to ordinary Vercel
// Functions under /api -- MUST be re-verified empirically once this is
// actually deployed (a real curl of the endpoint), not assumed to work the
// same way just because middleware.js does.
//
// Never touches vibeverk.no -- deployed only to a disposable test/canary
// Vercel project per Phase 6's design, same as middleware.js today.

import { resolveTenantByHostname } from "./_lib/resolve-tenant.js";

export const config = { runtime: "edge" };

var FALLBACK_JS =
  "window.SITE_CONFIG = null;\n" +
  "console.error('[vibeverk] Ukjend hostname — dette domenet er ikkje registrert som ein Vibeverk-kunde.');\n";

export default async function handler(request) {
  var controlUrl = process.env.VIBEVERK_CONTROL_URL;
  var controlAnonKey = process.env.VIBEVERK_CONTROL_ANON_KEY;
  if (!controlUrl || !controlAnonKey) {
    console.error("[tenant-config] mangler VIBEVERK_CONTROL_URL/VIBEVERK_CONTROL_ANON_KEY env-variablar");
    return new Response(FALLBACK_JS, { status: 500, headers: { "Content-Type": "application/javascript" } });
  }

  var hostHeader = request.headers.get("host") || "";
  if (!hostHeader.split(":")[0]) {
    return new Response(FALLBACK_JS, { status: 400, headers: { "Content-Type": "application/javascript" } });
  }

  var tenant;
  try {
    tenant = await resolveTenantByHostname(hostHeader);
  } catch (e) {
    console.error("[tenant-config] resolve_tenant_by_hostname feila", e);
    return new Response(FALLBACK_JS, { status: 502, headers: { "Content-Type": "application/javascript" } });
  }

  if (!tenant) {
    return new Response(FALLBACK_JS, { status: 404, headers: { "Content-Type": "application/javascript" } });
  }

  // Minimal base skeleton -- deliberately does NOT attempt full per-tenant
  // branding parity (company name/logo/admin password/analytics/etc). Those
  // live in the existing superconfig/broker layer, already fetched by
  // core.js after this file's window.SITE_CONFIG is set — see the ADR-0007
  // Phase 6 addendum for why full dynamic branding is explicitly deferred.
  var enabledModules = tenant.enabled_modules || {};
  var siteConfig = {
    supabase: {
      url: tenant.data_plane_url,
      anonKey: tenant.data_plane_anon_key,
    },
    storageKey: tenant.data_plane_storage_key,
    productMode: tenant.product_mode || "web",
    features: enabledModules.features || {},
    intranettFeatures: enabledModules.intranettFeatures || {},
    customModules: tenant.custom_modules_manifest || {},
    theme: tenant.theme || {},
  };

  var js = "window.SITE_CONFIG = " + JSON.stringify(siteConfig) + ";";
  return new Response(js, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-store",
    },
  });
}
