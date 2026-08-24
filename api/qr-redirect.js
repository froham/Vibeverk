// api/qr-redirect.js — Vercel Edge Function serving the public, dynamic QR
// redirect (module-qrcode.js). middleware.js rewrites any request for
// /qr/<code> to /api/qr-redirect?code=<code>.
//
// Why this exists: a printed/shared QR code encodes a FIXED address on the
// tenant's own domain (/qr/<code>), never the destination link directly, so
// the destination can be changed later without reprinting the code. This
// function is the lookup: resolve which tenant owns the current hostname
// (same pattern as api/tenant-config.js), read that tenant's own
// "qr-codes" row from the shared `store` table (App.store's write-through
// table — anon SELECT is already allowed there, see baseline migration's
// store_anon_read policy, so no new table/RLS was needed for this), find an
// ACTIVE record with a matching code, and 302 to its target_url.
//
// Self-contained (own resolveTenantByHostname call) rather than depending on
// middleware.js having already resolved the tenant, matching
// api/tenant-config.js's existing convention — keeps this function testable
// in isolation (see test-api.js) and independent of the rewrite's internal
// request shape.
//
// Uses the get_qr_redirect_target(code, tenant_id) SECURITY DEFINER RPC (see
// supabase/migrations/20260819150944_qr_codes_lockdown.sql and its
// 20260819155245_qr_codes_scope_tenant.sql follow-up), NOT a raw SELECT
// against the `store` table — the `qr-codes` key is deliberately excluded
// from the table's anon-read policy in that same migration (Security
// Auditor finding, HIGH, 2026-08-19: an earlier draft of this file did a raw
// anon SELECT, which handed over every code/target/label in one request
// instead of the single matching target_url). This function must also be
// reachable ONLY via the /qr/:code rewrite in middleware.js, which enforces
// the tenant's site-lock first — /api/qr-redirect is therefore listed
// directly in middleware.js's own matcher too, so a direct call to this path
// (bypassing /qr/:code) still gets gated the same way (same Security Auditor
// round, second finding). The RPC's p_tenant_id (tenant.data_plane_storage_key,
// the same value core.js uses as `store.tenant_id` when App.store() writes
// "qr-codes") is required, not optional -- caught during post-deploy manual
// verification, not by the auditor: `store`'s real key is (tenant_id, key),
// so a lookup on `key` alone could in principle match the wrong tenant_id
// row and return a stale/foreign target_url.

import { resolveTenantByHostname } from "./_lib/resolve-tenant.js";
import { getOrCreateTraceparent } from "./_lib/trace.js";

export const config = { runtime: "edge" };

var NOT_FOUND_HTML =
  "<!doctype html><html lang=\"no\"><meta charset=\"utf-8\">" +
  "<title>Fant ikke QR-koden</title>" +
  "<body style=\"font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;text-align:center\">" +
  "<h1 style=\"font-size:1.3rem\">Denne QR-koden finnes ikke lenger</h1>" +
  "<p>Lenken den pekte på er fjernet eller koden er slettet.</p>" +
  "</body></html>";

function notFound() {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default async function handler(request) {
  var url = new URL(request.url);
  var code = (url.searchParams.get("code") || "").trim();
  if (!code) return notFound();

  var hostHeader = request.headers.get("host") || "";
  if (!hostHeader.split(":")[0]) return notFound();

  var traceparent = getOrCreateTraceparent(request);

  var tenant;
  try {
    tenant = await resolveTenantByHostname(hostHeader, traceparent);
  } catch (e) {
    console.error("[qr-redirect] resolve_tenant_by_hostname feila", e);
    return notFound();
  }
  if (!tenant || !tenant.data_plane_url || !tenant.data_plane_anon_key) return notFound();

  var rpcUrl = tenant.data_plane_url + "/rest/v1/rpc/get_qr_redirect_target";
  var resp;
  try {
    resp = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: tenant.data_plane_anon_key,
        Authorization: "Bearer " + tenant.data_plane_anon_key,
        traceparent: traceparent,
      },
      body: JSON.stringify({ p_code: code, p_tenant_id: tenant.data_plane_storage_key || "default" }),
    });
  } catch (e) {
    console.error("[qr-redirect] get_qr_redirect_target feila", e);
    return notFound();
  }
  if (!resp.ok) return notFound();

  var targetUrl;
  try { targetUrl = await resp.json(); } catch (e) { return notFound(); }
  if (typeof targetUrl !== "string" || !/^https?:\/\//i.test(targetUrl)) return notFound();

  return new Response(null, {
    status: 302,
    headers: { Location: targetUrl, "Cache-Control": "no-store" },
  });
}
