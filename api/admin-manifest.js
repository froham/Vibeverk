// api/admin-manifest.js — Vercel Function, generates /admin/manifest.json for
// Web-admin, per tenant. Same pattern/trust boundary as api/workspace-manifest.js
// (see api/_lib/tenant-manifest.js) -- generalized here rather than duplicated,
// 2026-07-26.

import { generateTenantManifestResponse } from "./_lib/tenant-manifest.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  return generateTenantManifestResponse(request.headers.get("host") || "", {
    startUrl: "/admin/",
    scope: "/admin/",
    defaultName: "Administrasjon",
    defaultShortName: "Admin",
    defaultBackground: "#ffffff",
    defaultTheme: "#2563eb",
    useWorkspaceAccent: false,
  });
}
