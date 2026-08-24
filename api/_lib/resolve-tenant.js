// api/_lib/resolve-tenant.js — shared hostname→tenant lookup against the
// control plane (vibeverk-control). Extracted from api/tenant-config.js so
// api/workspace-manifest.js doesn't carry a third copy of the same
// resolve_tenant_by_hostname() call (middleware.js has its own copy too,
// for its own reasons — see that file's header comment).
//
// Returns the tenant row (same shape as resolve_tenant_by_hostname()'s
// columns: data_plane_url, data_plane_anon_key, data_plane_storage_key,
// product_mode, enabled_modules, custom_modules_manifest, theme), or null
// if the hostname isn't a registered tenant, or throws on a genuine
// control-plane failure (network/env/HTTP error) — callers decide how to
// degrade for their own endpoint.

export async function resolveTenantByHostname(hostHeader, traceparent) {
  const controlUrl = process.env.VIBEVERK_CONTROL_URL;
  const controlAnonKey = process.env.VIBEVERK_CONTROL_ANON_KEY;
  if (!controlUrl || !controlAnonKey) {
    throw new Error("mangler VIBEVERK_CONTROL_URL/VIBEVERK_CONTROL_ANON_KEY env-variablar");
  }
  const host = (hostHeader || "").toLowerCase().split(":")[0];
  if (!host) throw new Error("mangler Host-header");

  const headers = {
    "Content-Type": "application/json",
    apikey: controlAnonKey,
    Authorization: "Bearer " + controlAnonKey,
  };
  if (traceparent) headers.traceparent = traceparent;

  const resp = await fetch(controlUrl + "/rest/v1/rpc/resolve_tenant_by_hostname", {
    method: "POST",
    headers: headers,
    body: JSON.stringify({ p_hostname: host }),
  });
  if (!resp.ok) throw new Error("resolve_tenant_by_hostname HTTP " + resp.status);
  const rows = await resp.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}
