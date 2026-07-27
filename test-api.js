/* test-api.js — Node harness for Vercel Functions (api/*.js) and middleware.js.
   Kjør: node test-api.js

   Desse filene er reine Request/Response-funksjonar (Vercel Edge Runtime) --
   ingen DOM, difor ingen jsdom her (ulikt test.js/test-workspace.js). Testa
   direkte ved å mocke global fetch() og kalle handler-funksjonane sjølv.

   Fram til 2026-07-27 hadde denne familien filer (api/tenant-config.js,
   api/workspace-manifest.js, api/site-manifest.js, api/admin-manifest.js,
   api/_lib/*, middleware.js) ingen committa testdekning i det heile -- kvar
   ny funksjon vart berre verifisert via eit eingongs-mock-skript skrive i
   /tmp for den spesifikke økta, aldri køyrt att i CI. Denne fila samlar dei
   scenarioa til éin permanent, gjenbrukbar test.

   api/*.js/middleware.js bruker ESM import/export (kravd av Vercel sin Edge
   Runtime) -- lasta her via dynamisk import() sidan package.json ikkje har
   "type":"module" (CommonJS er standard for .js-filer i dette repoet, same
   som test.js/test-workspace.js). */

let __ok = 0, __err = 0;
function assert(cond, msg) {
  if (!cond) { __err++; console.error("FEIL:", msg); process.exitCode = 1; }
  else { __ok++; console.log("OK:", msg); }
}

function fakeRequest(url, headers) {
  const h = new Map(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return { url, headers: { get: (k) => h.get(k.toLowerCase()) || null } };
}

function basicAuthHeader(password) {
  return "Basic " + Buffer.from("x:" + password).toString("base64");
}

async function main() {
  process.env.VIBEVERK_CONTROL_URL = "https://control.example.test";
  process.env.VIBEVERK_CONTROL_ANON_KEY = "control-anon-key";

  // Scenario-styrt mock av global fetch -- éin variabel les av alle
  // handlarane sine faktiske fetch()-kall, sidan dei ikkje tek imot nokon
  // injiserbar HTTP-klient (same mønster som funksjonane sjølv bruker global
  // fetch()). Endra mellom seksjonar under, aldri parallelt.
  let scenario = "full-success";
  global.fetch = async (url) => {
    if (String(url).includes("resolve_tenant_by_hostname")) {
      if (scenario === "no-tenant") return { ok: true, json: async () => [] };
      if (scenario === "hop1-http-error") return { ok: false, status: 500 };
      return {
        ok: true,
        json: async () => [{
          data_plane_url: "https://tenant.supabase.co",
          data_plane_anon_key: "tenant-anon-key",
          data_plane_storage_key: "nordpunkt",
          product_mode: "full",
          enabled_modules: { features: { crm: true }, intranettFeatures: { tasks: true } },
          custom_modules_manifest: {},
          theme: { primary: "#000000" },
        }],
      };
    }
    if (String(url).includes("/rest/v1/store")) {
      if (scenario === "hop2-http-error") return { ok: false, status: 500 };
      if (scenario === "hop2-empty") return { ok: true, json: async () => [] };
      return {
        ok: true,
        json: async () => [{
          value: {
            company: { name: "Testkunden AS", logoUrl: "https://cdn.example.test/logo.png" },
            colors: { primary: "#123456", background: "#f0f0f0" },
            workspace: { accentColor: "#654321" },
          },
        }],
      };
    }
    throw new Error("uventa fetch-URL i test: " + url);
  };

  const { resolveTenantByHostname } = await import("./api/_lib/resolve-tenant.js");
  const { fetchTenantSuperconfig, buildManifest, generateTenantManifestResponse } = await import("./api/_lib/tenant-manifest.js");
  const { default: tenantConfigHandler } = await import("./api/tenant-config.js");
  const { default: workspaceManifestHandler } = await import("./api/workspace-manifest.js");
  const { default: siteManifestHandler } = await import("./api/site-manifest.js");
  const { default: adminManifestHandler } = await import("./api/admin-manifest.js");
  const { default: middleware } = await import("./middleware.js");

  /* =========================================================================
     A) api/_lib/resolve-tenant.js
     ====================================================================== */
  scenario = "full-success";
  let tenant = await resolveTenantByHostname("kunde.no");
  assert(tenant && tenant.data_plane_url === "https://tenant.supabase.co", "a1: resolveTenantByHostname returnerer tenant-rad ved treff");
  assert(tenant.data_plane_storage_key === "nordpunkt", "a2: data_plane_storage_key kjem med (kravd for hop 2-filtrering)");

  scenario = "no-tenant";
  tenant = await resolveTenantByHostname("ukjend.no");
  assert(tenant === null, "a3: resolveTenantByHostname returnerer null for ukjend hostname (ikkje feil)");

  scenario = "hop1-http-error";
  let threw = false;
  try { await resolveTenantByHostname("kunde.no"); } catch (e) { threw = true; }
  assert(threw, "a4: resolveTenantByHostname kastar ved HTTP-feil frå kontrollplanet");

  delete process.env.VIBEVERK_CONTROL_URL;
  threw = false;
  try { await resolveTenantByHostname("kunde.no"); } catch (e) { threw = true; }
  assert(threw, "a5: resolveTenantByHostname kastar når VIBEVERK_CONTROL_URL manglar");
  process.env.VIBEVERK_CONTROL_URL = "https://control.example.test";

  /* =========================================================================
     B) api/tenant-config.js -- alle statuskodar (Phase 6, live i produksjon)
     ====================================================================== */
  scenario = "full-success";
  let r = await tenantConfigHandler(fakeRequest("https://kunde.no/config.js", { host: "kunde.no" }));
  let text = await r.text();
  assert(r.status === 200, "b1: tenant-config 200 ved full suksess");
  assert(text.includes('"anonKey":"tenant-anon-key"'), "b2: tenant-config gjev rett anonKey");
  assert(text.includes('"storageKey":"nordpunkt"'), "b3: tenant-config gjev rett storageKey");

  scenario = "no-tenant";
  r = await tenantConfigHandler(fakeRequest("https://ukjend.no/config.js", { host: "ukjend.no" }));
  assert(r.status === 404, "b4: tenant-config 404 for ukjend hostname");

  scenario = "hop1-http-error";
  r = await tenantConfigHandler(fakeRequest("https://kunde.no/config.js", { host: "kunde.no" }));
  assert(r.status === 502, "b5: tenant-config 502 ved kontrollplan-feil");

  r = await tenantConfigHandler(fakeRequest("https://x/config.js", { host: "" }));
  assert(r.status === 400, "b6: tenant-config 400 ved manglande Host-header");

  delete process.env.VIBEVERK_CONTROL_URL;
  r = await tenantConfigHandler(fakeRequest("https://kunde.no/config.js", { host: "kunde.no" }));
  assert(r.status === 500, "b7: tenant-config 500 ved manglande env-variablar");
  process.env.VIBEVERK_CONTROL_URL = "https://control.example.test";

  /* =========================================================================
     C) api/_lib/tenant-manifest.js sine tre forbrukarar
     ====================================================================== */
  scenario = "full-success";
  r = await workspaceManifestHandler(fakeRequest("https://kunde.no/workspace/manifest.json", { host: "kunde.no" }));
  let body = await r.json();
  assert(r.status === 200 && r.headers.get("Content-Type") === "application/manifest+json", "c1: workspace-manifest 200 + rett Content-Type");
  assert(body.name === "Testkunden AS" && body.start_url === "/workspace/", "c2: workspace-manifest namn+start_url frå superconfig");
  assert(body.theme_color === "#654321", "c3: workspace-manifest theme_color = workspace.accentColor (useWorkspaceAccent:true)");
  assert(body.icons.length === 1 && body.icons[0].src === "https://cdn.example.test/logo.png", "c4: workspace-manifest icons inneheld tenanten sin eigen logoUrl");

  r = await siteManifestHandler(fakeRequest("https://kunde.no/manifest.json", { host: "kunde.no" }));
  body = await r.json();
  assert(body.start_url === "/" && body.scope === "/", "c5: site-manifest rett start_url/scope");
  assert(body.theme_color === "#123456", "c6: site-manifest theme_color = colors.primary (IKKJE workspace.accentColor, useWorkspaceAccent:false)");

  r = await adminManifestHandler(fakeRequest("https://kunde.no/admin/manifest.json", { host: "kunde.no" }));
  body = await r.json();
  assert(body.start_url === "/admin/" && body.scope === "/admin/", "c7: admin-manifest rett start_url/scope");
  assert(body.theme_color === "#123456", "c8: admin-manifest theme_color = colors.primary");

  scenario = "no-tenant";
  r = await siteManifestHandler(fakeRequest("https://ukjend.no/manifest.json", { host: "ukjend.no" }));
  body = await r.json();
  assert(r.status === 200, "c9: manifest-funksjonar returnerer ALLTID 200, aldri ei feilside for ukjend tenant");
  assert(body.name === "Nettside" && body.icons.length === 0, "c10: generisk fallback-namn, INGEN Vibeverk-ikon for ukjend tenant (medvite val 2026-07-25)");

  scenario = "hop1-http-error";
  r = await workspaceManifestHandler(fakeRequest("https://kunde.no/workspace/manifest.json", { host: "kunde.no" }));
  assert(r.status === 200, "c11: manifest 200 sjølv om kontrollplan-oppslaget feilar");

  scenario = "hop2-http-error";
  r = await workspaceManifestHandler(fakeRequest("https://kunde.no/workspace/manifest.json", { host: "kunde.no" }));
  body = await r.json();
  assert(r.status === 200 && body.icons.length === 0, "c12: manifest 200 med tomt ikon når tenanten sitt eige Supabase-oppslag feilar");

  scenario = "hop2-empty";
  r = await workspaceManifestHandler(fakeRequest("https://kunde.no/workspace/manifest.json", { host: "kunde.no" }));
  body = await r.json();
  assert(body.name === "Arbeidsområde", "c13: fell tilbake til generisk namn når superconfig-rada ikkje finst enno");

  // buildManifest()/fetchTenantSuperconfig() direkte, isolert frå HTTP-laget
  scenario = "full-success";
  const scForBuild = await fetchTenantSuperconfig({ data_plane_url: "https://tenant.supabase.co", data_plane_anon_key: "k", data_plane_storage_key: "nordpunkt" });
  assert(scForBuild.company && scForBuild.company.name === "Testkunden AS", "c14: fetchTenantSuperconfig() hentar riktig verdi isolert");
  const builtManifest = buildManifest(scForBuild, { startUrl: "/x/", scope: "/x/", defaultName: "X", defaultBackground: "#fff", defaultTheme: "#000", useWorkspaceAccent: false });
  assert(builtManifest.theme_color === "#123456", "c15: buildManifest() bruker colors.primary når useWorkspaceAccent er false");
  assert((await fetchTenantSuperconfig(null)) && Object.keys(await fetchTenantSuperconfig(null)).length === 0, "c16: fetchTenantSuperconfig(null) returnerer tomt objekt, kastar ikkje");

  /* =========================================================================
     D) middleware.js -- site-lock + alle rute-omskrivingar
     ====================================================================== */
  scenario = "full-success";
  process.env.SITE_LOCK_PASSWORD = "hemmelig";

  for (const p of ["/manifest.json", "/workspace/manifest.json", "/admin/manifest.json"]) {
    r = await middleware(fakeRequest("https://kunde.no" + p, { host: "kunde.no" }));
    assert(r.status !== 401, "d-manifest: " + p + " er unnateke site-lock utan Basic Auth (status " + r.status + ")");
  }

  r = await middleware(fakeRequest("https://kunde.no/workspace/", { host: "kunde.no" }));
  assert(r.status === 401, "d1: /workspace/ krev framleis site-lock utan Basic Auth");

  r = await middleware(fakeRequest("https://kunde.no/workspace/", { host: "kunde.no", authorization: basicAuthHeader("hemmelig") }));
  assert(r.status !== 401, "d2: /workspace/ sleppast gjennom site-lock MED rett passord");

  r = await middleware(fakeRequest("https://kunde.no/workspace/", { host: "kunde.no", authorization: basicAuthHeader("feil") }));
  assert(r.status === 401, "d3: /workspace/ avviser FEIL passord (ikkje berre manglande)");

  delete process.env.SITE_LOCK_PASSWORD;
  r = await middleware(fakeRequest("https://kunde.no/workspace/", { host: "kunde.no" }));
  assert(r.status !== 401, "d4: site-lock er fail-open (slepp alle gjennom) når SITE_LOCK_PASSWORD ikkje er sett");
  process.env.SITE_LOCK_PASSWORD = "hemmelig";

  r = await middleware(fakeRequest("https://kunde.no/config.js", { host: "kunde.no", authorization: basicAuthHeader("hemmelig") }));
  assert(r.status === 200, "d5: /config.js vert skrive om til tenant-config (uendra Phase 6-åtferd)");

  scenario = "no-tenant";
  r = await middleware(fakeRequest("https://ukjend.no/", { host: "ukjend.no", authorization: basicAuthHeader("hemmelig") }));
  assert(r.status === 404, "d6: ukjend hostname på ei vanleg side gjev 404 «ikkje registrert som kunde» (etter site-lock, uendra åtferd)");

  console.log("\nResultat: OK " + __ok + " / FEIL " + __err);
}

main().catch(function (e) {
  console.error("test-api.js kræsja:", e);
  process.exitCode = 1;
});
