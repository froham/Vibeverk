// api/_lib/tenant-manifest.js — shared per-tenant manifest.json generation,
// used by api/workspace-manifest.js, api/site-manifest.js, api/admin-manifest.js.
// Extracted 2026-07-26 when the same two-hop pattern (control plane ->
// tenant's own Supabase) was about to be copied a second and third time —
// see api/workspace-manifest.js's original header comment for the full
// rationale (trust boundary, no-Vibeverk-fallback decision, etc.), unchanged
// here, just generalized across start_url/scope/defaults per surface.
//
// Console is deliberately NOT built on this helper -- Console is Vibeverk's
// own internal operator tool, never customer-branded regardless of hostname,
// so it gets a plain static console/manifest.json instead (no tenant
// resolution needed or wanted there).

import { resolveTenantByHostname } from "./resolve-tenant.js";

export async function fetchTenantSuperconfig(tenant, traceparent) {
  if (!tenant || !tenant.data_plane_url || !tenant.data_plane_anon_key) return {};
  try {
    var url = tenant.data_plane_url + "/rest/v1/store"
      + "?tenant_id=eq." + encodeURIComponent(tenant.data_plane_storage_key || "default")
      + "&key=eq.superconfig&select=value";
    var headers = {
      apikey: tenant.data_plane_anon_key,
      Authorization: "Bearer " + tenant.data_plane_anon_key,
    };
    if (traceparent) headers.traceparent = traceparent;
    var resp = await fetch(url, { headers: headers });
    if (!resp.ok) return {};
    var rows = await resp.json();
    return (Array.isArray(rows) && rows[0] && rows[0].value) || {};
  } catch (e) {
    console.error("[tenant-manifest] henting av superconfig feila", e);
    return {};
  }
}

// opts: { startUrl, scope, defaultName, defaultShortName, defaultBackground,
//         defaultTheme, useWorkspaceAccent }
// useWorkspaceAccent: Workspace visually overrides the site's primary colour
// with its own accentColor (applyWorkspaceTheme()) -- the public site and
// Web-admin don't have that layer, so they should always prefer
// colors.primary directly instead.
export function buildManifest(superconfig, opts) {
  var company = superconfig.company || {};
  var colors = superconfig.colors || {};
  var workspace = superconfig.workspace || {};
  var iconUrl = company.favicon || company.logoUrl || "";
  var name = company.name || opts.defaultName;

  return {
    name: name,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    start_url: opts.startUrl,
    scope: opts.scope,
    display: "standalone",
    background_color: colors.background || opts.defaultBackground,
    theme_color: (opts.useWorkspaceAccent && workspace.accentColor) || colors.primary || opts.defaultTheme,
    // Ingen Vibeverk-logo-fallback for ein uinnstilt tenant (medvite val,
    // 2026-07-25) -- installerbart-men-ikonlaust i staden for å utilsikta
    // bere Vibeverk sin eigen logo.
    icons: iconUrl ? [{ src: iconUrl, sizes: "any", type: "image/png" }] : [],
  };
}

function fallbackManifest(opts) {
  return {
    name: opts.defaultName,
    short_name: opts.defaultShortName || opts.defaultName,
    start_url: opts.startUrl,
    scope: opts.scope,
    display: "standalone",
    background_color: opts.defaultBackground,
    theme_color: opts.defaultTheme,
    icons: [],
  };
}

function respond(manifest) {
  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

// Always returns 200 with a best-effort manifest, even if either hop fails --
// a broken manifest.json shouldn't be a page-load error, just a missing icon.
export async function generateTenantManifestResponse(hostHeader, opts, traceparent) {
  var tenant;
  try {
    tenant = await resolveTenantByHostname(hostHeader, traceparent);
  } catch (e) {
    console.error("[tenant-manifest] resolve_tenant_by_hostname feila", e);
    return respond(fallbackManifest(opts));
  }
  if (!tenant) return respond(fallbackManifest(opts));

  var superconfig = await fetchTenantSuperconfig(tenant, traceparent);
  return respond(buildManifest(superconfig, opts));
}
