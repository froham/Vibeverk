// api/workspace-manifest.js — Vercel Function, generates /workspace/manifest.json
// per tenant so "Legg til på Heimskjerm"/desktop install shows the tenant's own
// branding instead of nothing. middleware.js rewrites /workspace/manifest.json here.
//
// Two-hop resolution, same trust level as what core.js already does client-side
// for every anonymous visitor (see hydrateFromSupabase()):
//   Hop 1: control plane resolve_tenant_by_hostname() -> the tenant's OWN
//          Supabase project URL/anon key/storageKey (api/_lib/resolve-tenant.js,
//          shared with api/tenant-config.js).
//   Hop 2: that tenant's own `store` table, key='superconfig', for the live
//          company name/logo/colours -- resolve_tenant_by_hostname() deliberately
//          does not carry branding (see api/tenant-config.js's own header comment
//          and ADR-0007's Phase 6 addendum), so there is no way to get a real
//          per-tenant icon without this second hop.
//
// No Vibeverk-logo fallback for an unconfigured tenant (deliberate choice,
// 2026-07-25): an unconfigured tenant gets an installable-but-icon-less manifest
// rather than accidentally wearing Vibeverk's own branding.
//
// Always returns 200 with a best-effort manifest, even if either hop fails --
// a broken manifest.json shouldn't be a page-load error, just a missing icon.

import { resolveTenantByHostname } from "./_lib/resolve-tenant.js";

export const config = { runtime: "edge" };

var FALLBACK_MANIFEST = {
  name: "Arbeidsområde",
  short_name: "Workspace",
  start_url: "/workspace/",
  scope: "/workspace/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#2563eb",
  icons: [],
};

function respond(manifest) {
  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

export default async function handler(request) {
  var hostHeader = request.headers.get("host") || "";

  var tenant;
  try {
    tenant = await resolveTenantByHostname(hostHeader);
  } catch (e) {
    console.error("[workspace-manifest] resolve_tenant_by_hostname feila", e);
    return respond(FALLBACK_MANIFEST);
  }
  if (!tenant || !tenant.data_plane_url || !tenant.data_plane_anon_key) {
    return respond(FALLBACK_MANIFEST);
  }

  var superconfig = {};
  try {
    var url = tenant.data_plane_url + "/rest/v1/store"
      + "?tenant_id=eq." + encodeURIComponent(tenant.data_plane_storage_key || "default")
      + "&key=eq.superconfig&select=value";
    var resp = await fetch(url, {
      headers: {
        apikey: tenant.data_plane_anon_key,
        Authorization: "Bearer " + tenant.data_plane_anon_key,
      },
    });
    if (resp.ok) {
      var rows = await resp.json();
      superconfig = (Array.isArray(rows) && rows[0] && rows[0].value) || {};
    }
  } catch (e) {
    console.error("[workspace-manifest] henting av superconfig feila", e);
    // held fram med tom superconfig -- delvis manifest er betre enn ingen
  }

  var company = superconfig.company || {};
  var colors = superconfig.colors || {};
  var workspace = superconfig.workspace || {};
  var iconUrl = company.favicon || company.logoUrl || "";
  var name = company.name || FALLBACK_MANIFEST.name;

  var manifest = {
    name: name,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    start_url: "/workspace/",
    scope: "/workspace/",
    display: "standalone",
    background_color: colors.background || FALLBACK_MANIFEST.background_color,
    theme_color: workspace.accentColor || colors.primary || FALLBACK_MANIFEST.theme_color,
    icons: iconUrl ? [{ src: iconUrl, sizes: "any", type: "image/png" }] : [],
  };

  return respond(manifest);
}
