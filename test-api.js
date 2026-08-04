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

function fakePostRequest(url, headers, bodyObj) {
  const req = fakeRequest(url, Object.assign({ "content-type": "application/json" }, headers || {}));
  req.method = "POST";
  req.json = async () => {
    if (bodyObj === undefined) throw new SyntaxError("Unexpected end of JSON input");
    return bodyObj;
  };
  return req;
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
          // custom_modules_manifest.smartAarshjul.enabled: true her (og
          // IKKJE i "aw-not-entitled" pga eigen gren under) -- api/ai/
          // annual-wheel.js sin eigen entitlement-sjekk (lagt til etter
          // tryggleiksgjennomgang) krev denne, uavhengig av rolla til
          // kallaren. Smart årshjul er ein customModules-oppføring, ikkje
          // ein intranettFeatures-brytar (sjå config.js). Andre forbrukarar
          // av denne mocken (tenant-config/tenant-manifest/middleware-
          // testane over) bryr seg ikkje om dette feltet, så det er trygt
          // å leggje det til her.
          // Kvar modul sin entitlement styrast av sin eigen "ikkje aktivert"-scenario
          // (aw-not-entitled / ov-not-entitled) -- uavhengige av kvarandre, sidan
          // scenario-strengen er delt men testane for kvart endepunkt køyrer i eigne,
          // ikkje-overlappande seksjonar (E for annual-wheel, F for oversikt).
          custom_modules_manifest: Object.assign(
            {},
            scenario === "aw-not-entitled" ? {} : { "smart-aarshjul": { label: "Smart årshjul", enabled: true, params: {} } },
            scenario === "ov-not-entitled" ? {} : { "oversikt": { label: "Oversikt", enabled: true, params: {} } }
          ),
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
    // api/ai/annual-wheel.js sine eigne tre hopp: tenantens Supabase Auth
    // (bearer-verifisering), tenantens users-tabell (rolleoppslag) og
    // Anthropic sjølv (den eine AI-genereringa). scenario-strengane her er
    // eksklusive for denne seksjonen (aw-*), kolliderer ikkje med scenarioa over.
    if (String(url).includes("/auth/v1/user")) {
      if (scenario === "aw-auth-fail") return { ok: false, status: 401 };
      return { ok: true, json: async () => ({ id: "user-123" }) };
    }
    if (String(url).includes("/rest/v1/users")) {
      if (scenario === "aw-role-member") return { ok: true, json: async () => [{ role: "member" }] };
      if (scenario === "aw-role-http-error") return { ok: false, status: 500 };
      return { ok: true, json: async () => [{ role: "admin" }] };
    }
    if (String(url).includes("api.anthropic.com")) {
      if (scenario === "aw-anthropic-http-error") return { ok: false, status: 500, json: async () => ({ error: { message: "modelloverbelastning" } }) };
      if (scenario === "aw-anthropic-bad-shape") return { ok: true, json: async () => ({ content: [{ type: "text", text: "ikkje eit tool_use-svar" }] }) };
      if (scenario === "ov-anthropic-http-error") return { ok: false, status: 500, json: async () => ({ error: { message: "modelloverbelastning" } }) };
      if (scenario === "ov-anthropic-bad-shape") return { ok: true, json: async () => ({ content: [{ type: "text", text: "ikkje eit tool_use-svar" }] }) };
      if (String(scenario).indexOf("ov-") === 0) {
        return {
          ok: true,
          json: async () => ({
            content: [{
              type: "tool_use", name: "return_overview",
              input: {
                detectedSituationProfile: { situationType: "Flytting av verksemd", scale: "Lite firma", keyThemes: ["lokale", "logistikk"] },
                summary: "Oversikta er tilpassa ei flytting av verkstaden.",
                needs: [
                  { title: "Vurder nye lokale", description: "Sjekk areal og planløysing.", reason: "Avgjer resten av planen.", category: "premises", priority: "high" },
                  { title: "<script>evil()</script>", description: "skal klemmast", reason: "test", category: "ukjend-kategori", priority: "ukjend" },
                ],
                dependencyNodes: [
                  { title: "Sei opp gamal leigekontrakt", description: "Avslutt eksisterande avtale.", category: "premises", priority: "high", milestone: false },
                  { title: "Flytt utstyr", description: "Flytt maskiner og inventar.", category: "logistics", priority: "normal", milestone: false },
                  { title: "Opne dørene igjen", description: "Start normal drift i nye lokale.", category: "operations", priority: "high", milestone: true },
                ],
                dependencyEdges: [
                  { fromIndex: 0, toIndex: 1, type: "required-before" },
                  { fromIndex: 1, toIndex: 2, type: "required-before" },
                  { fromIndex: 2, toIndex: 0, type: "required-before" }, // skal fjernast: ville skapt ein sirkel
                  { fromIndex: 0, toIndex: 99, type: "required-before" }, // skal fjernast: peikar utanfor lista
                  { fromIndex: 1, toIndex: 1, type: "required-before" }, // skal fjernast: sjølv-referanse
                ],
                impacts: [
                  { title: "Kundar må finne fram til nytt sted", description: "Kommuniser adresseendring.", reason: "Unngå tapt oppmøte.", category: "communication", impactLevel: "medium", consequences: ["Oppdater nettside", "Send e-post til kundar"] },
                ],
                blindSpots: [
                  { title: "Straum- og nettavtale på nytt sted", description: "Kontroller at avtalar er på plass.", reason: "Lett å gløyme.", category: "suppliers", priority: "normal", suggestedDestination: "needs" },
                ],
                nextSteps: [
                  { title: "Gå gjennom forslaga", description: "Ta med det som er relevant." },
                ],
              },
            }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          content: [{
            type: "tool_use", name: "return_annual_wheel_plan",
            input: {
              detectedBusinessProfile: {
                primaryIndustry: "Tømrarverksemd", specialization: "Rehabilitering av eldre bygg", hasEmployees: true,
                employeeCountApproximation: 5, seasonalPattern: "Høg aktivitet vår til haust", identifiedNeeds: ["kompetanseheving"],
              },
              summary: "Forslaga er tilpassa rehabilitering og vinteraktivitet.",
              suggestions: [
                { title: "Planlegg vårkampanje", description: "Lag ein enkel plan.", reason: "Synlegheit før høgsesong.", month: 3, day: null, recurrence: "none", category: "marketing", itemType: "", verificationRequired: false, sourceName: "", sourceUrl: "", sourceVerifiedAt: "", exactDate: "", applicability: "" },
                { title: "Lever a-melding", description: "Kontroller og lever a-meldinga.", reason: "Verksemda har tilsette.", month: 1, day: 5, recurrence: "monthly", category: "deadlines", itemType: "deadline", verificationRequired: true, sourceName: "Skatteetaten", sourceUrl: "https://www.skatteetaten.no/", sourceVerifiedAt: "2026-08-04", exactDate: "Den 5. kvar månad", applicability: "Berre dersom verksemda har plikt til å levere a-melding." },
                { title: "<script>evil()</script>", description: "skal klemmast/reinsast", reason: "test", month: 99, day: 999, recurrence: "ukjend", category: "ukjend-kategori", itemType: "ukjend", verificationRequired: "ja", sourceName: "", sourceUrl: "javascript:alert(1)", sourceVerifiedAt: "", exactDate: "", applicability: "" },
              ],
            },
          }],
        }),
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
  // annual-wheel.js sitt default-eksport er no { fetch(request) {...} } (Node.js
  // runtime sin Web Standard-form, sjå fila sin eigen header-kommentar for kvifor),
  // ikkje ein bar funksjon lenger (det var Edge runtime sin eigen konvensjon) --
  // hent ut .fetch éin gong her, resten av testane under held seg uendra.
  const { default: annualWheelModule } = await import("./api/ai/annual-wheel.js");
  const annualWheelHandler = annualWheelModule.fetch;
  const { default: oversiktModule } = await import("./api/ai/oversikt.js");
  const oversiktHandler = oversiktModule.fetch;

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

  /* =========================================================================
     E) api/ai/annual-wheel.js -- Smart årshjul sitt server-endepunkt.
     Fyrste endepunkt som brukar ein tredjeparts betalt LLM (Anthropic) --
     testar auth-gjerdet (tenant + bearer-token + rolle), inputvalidering,
     og at eit vellykka/mislykka AI-svar vert handtert trygt.
     ====================================================================== */
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  const validBody = { industry: "carpenter", businessDescription: "Lite tømrarfirma med fem tilsette.", existingActivities: [] };

  scenario = "full-success";
  r = await annualWheelHandler(fakeRequest("https://kunde.no/api/ai/annual-wheel", { host: "e1.kunde.no" }));
  assert(r.status === 405, "e1: berre POST er støtta (GET gjev 405)");

  delete process.env.ANTHROPIC_API_KEY;
  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e2.kunde.no", authorization: "Bearer t" }, validBody));
  assert(r.status === 500, "e2: 500 når ANTHROPIC_API_KEY manglar på serveren");
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e3.kunde.no" }, validBody));
  assert(r.status === 401, "e3: 401 utan Authorization-header");

  scenario = "no-tenant";
  r = await annualWheelHandler(fakePostRequest("https://ukjend.no/api/ai/annual-wheel", { host: "e4.ukjend.no", authorization: "Bearer t" }, validBody));
  assert(r.status === 404, "e4: 404 for ukjend installasjon (tenant finst ikkje)");

  scenario = "hop1-http-error";
  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e5.kunde.no", authorization: "Bearer t" }, validBody));
  assert(r.status === 502, "e5: 502 når kontrollplan-oppslaget feilar");

  scenario = "aw-not-entitled";
  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e5b.kunde.no", authorization: "Bearer t" }, validBody));
  assert(r.status === 403, "e5b: 403 når tenanten IKKJE har Smart årshjul aktivert i control-planet (tenant.custom_modules_manifest), sjølv med gyldig admin/editor-innlogging -- retta etter tryggleiksgjennomgang: rolle åleine var ikkje nok, sidan éin delt Vercel-utrulling/ANTHROPIC_API_KEY betener alle tenantar (ADR-0007)");

  scenario = "aw-auth-fail";
  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e6.kunde.no", authorization: "Bearer ugyldig" }, validBody));
  assert(r.status === 401, "e6: 401 ved ugyldig/utløpt innlogging (tenantens eigen Supabase Auth avviser tokenet)");

  scenario = "aw-role-member";
  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e7.kunde.no", authorization: "Bearer t" }, validBody));
  assert(r.status === 403, "e7: 403 for rolla member (krev admin/editor)");

  scenario = "aw-role-http-error";
  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e8.kunde.no", authorization: "Bearer t" }, validBody));
  assert(r.status === 401, "e8: 401 når rolleoppslaget mot tenantens users-tabell feilar");

  scenario = "full-success";
  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e9.kunde.no", authorization: "Bearer t" }, undefined));
  assert(r.status === 400, "e9: 400 ved ugyldig JSON i førespurnaden");

  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e10.kunde.no", authorization: "Bearer t" }, { industry: "carpenter" }));
  assert(r.status === 400, "e10: 400 når businessDescription manglar");

  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e11.kunde.no", authorization: "Bearer t" }, { businessDescription: "x".repeat(1201) }));
  assert(r.status === 400, "e11: 400 når businessDescription er for lang");

  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e12.kunde.no", authorization: "Bearer t" }, { businessDescription: "Test", existingActivities: [{ title: "x", month: 13, category: "planning", recurrence: "none", locked: false }] }));
  assert(r.status === 400, "e12: 400 ved ugyldig månad i existingActivities");

  scenario = "aw-anthropic-http-error";
  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e13.kunde.no", authorization: "Bearer t" }, validBody));
  assert(r.status === 502, "e13: 502 når Anthropic-kallet feilar med HTTP-feil (eksisterande aktivitetar er urørte -- ingen tilstand vert skriven server-side i det heile)");
  body = await r.json();
  assert(typeof body.error === "string" && body.error.length > 0, "e13b: feilrespons har ei lesbar norsk feilmelding");

  scenario = "aw-anthropic-bad-shape";
  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e14.kunde.no", authorization: "Bearer t" }, validBody));
  assert(r.status === 502, "e14: 502 når Anthropic-svaret manglar tool_use-blokka (ikkje tekst-parsing av eit vanleg svar)");

  scenario = "full-success";
  r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e15.kunde.no", authorization: "Bearer t" }, validBody));
  assert(r.status === 200, "e15: 200 ved fullt vellykka generering");
  body = await r.json();
  assert(body.detectedBusinessProfile && body.detectedBusinessProfile.primaryIndustry === "Tømrarverksemd", "e15b: detectedBusinessProfile kjem med frå modellsvaret");
  assert(Array.isArray(body.suggestions) && body.suggestions.length === 3, "e15c: alle tre forslaga frå modellen kjem gjennom valideringa");
  const monthly = body.suggestions.find(s => s.recurrence === "monthly");
  assert(monthly && monthly.month === 1 && monthly.day === 5 && monthly.sourceUrl === "https://www.skatteetaten.no/", "e15d: gyldig kjeldebasert, månadleg forslag (a-melding) kjem gjennom uendra");
  const malformed = body.suggestions[2];
  assert(malformed.month === 1 && malformed.day === null, "e15e: ugyldig månad/dag frå modellen vert klemte til trygge standardverdiar (månad 99 → 1, dag 999 → null)");
  assert(malformed.recurrence === "none" && malformed.category === "custom" && malformed.itemType === "", "e15f: ugyldige enum-verdiar frå modellen (gjentaking/kategori/type) vert klemte til trygge standardverdiar, aldri sleppte gjennom rått");
  assert(malformed.sourceUrl === "", "e15g: ein javascript:-URL frå modellen vert aldri sleppt gjennom (berre https:// er tillate)");
  assert(body.suggestions.every(s => typeof s.id === "string" && s.id.length > 0), "e15h: kvart forslag får ein server-generert id (stolar ikkje på modellen sin eigen)");
  assert(typeof body.disclaimer === "string" && body.disclaimer.length > 0, "e15i: svaret har alltid ei fast fråskrivingstekst (juridisk/skatte-/rekneskapsråd)");

  scenario = "full-success";
  let rateLimited = 0;
  for (let i = 0; i < 8; i++) {
    r = await annualWheelHandler(fakePostRequest("https://kunde.no/api/ai/annual-wheel", { host: "e16.kunde.no", authorization: "Bearer t" }, validBody));
    if (r.status === 429) rateLimited++;
  }
  assert(rateLimited > 0, "e16: gjentekne raske kall frå same tenant+brukar vert til slutt rate-limita (429) -- best-effort per-instans-vern, sjå fila sin eigen kommentar om at dette IKKJE er ein ekte distribuert avgrensar");

  /* =========================================================================
     F) api/ai/oversikt.js -- Oversikt sitt server-endepunkt. Same
     auth-/entitlement-/valideringsmønster som E-seksjonen over (annual-wheel),
     pluss eigne testar for kryssande-punkt-validering (dependencyEdges via
     fromIndex/toIndex, sirkelfjerning, utanfor-lista-fjerning).
     ====================================================================== */
  const validOvBody = { title: "Flytte verkstedet", description: "Vi skal flytte verkstedet til større lokaler innen høsten.", scenarioType: "relocation", depth: "normal", requestedSections: ["needs", "dependencies", "impacts", "blindSpots"], existingItemTitles: [] };

  scenario = "ov-full-success";
  r = await oversiktHandler(fakeRequest("https://kunde.no/api/ai/oversikt", { host: "f1.kunde.no" }));
  assert(r.status === 405, "f1: berre POST er støtta (GET gjev 405)");

  delete process.env.ANTHROPIC_API_KEY;
  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f2.kunde.no", authorization: "Bearer t" }, validOvBody));
  assert(r.status === 500, "f2: 500 når ANTHROPIC_API_KEY manglar på serveren");
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f3.kunde.no" }, validOvBody));
  assert(r.status === 401, "f3: 401 utan Authorization-header");

  scenario = "no-tenant";
  r = await oversiktHandler(fakePostRequest("https://ukjend.no/api/ai/oversikt", { host: "f4.ukjend.no", authorization: "Bearer t" }, validOvBody));
  assert(r.status === 404, "f4: 404 for ukjend installasjon (tenant finst ikkje)");

  scenario = "hop1-http-error";
  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f5.kunde.no", authorization: "Bearer t" }, validOvBody));
  assert(r.status === 502, "f5: 502 når kontrollplan-oppslaget feilar");

  scenario = "ov-not-entitled";
  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f5b.kunde.no", authorization: "Bearer t" }, validOvBody));
  assert(r.status === 403, "f5b: 403 når tenanten IKKJE har Oversikt aktivert i control-planet (tenant.custom_modules_manifest), sjølv med gyldig admin/editor-innlogging -- same entitlement-mønster som annual-wheel.js (ADR-0007: éin delt Vercel-utrulling/ANTHROPIC_API_KEY betener alle tenantar)");

  scenario = "aw-auth-fail";
  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f6.kunde.no", authorization: "Bearer ugyldig" }, validOvBody));
  assert(r.status === 401, "f6: 401 ved ugyldig/utløpt innlogging (tenantens eigen Supabase Auth avviser tokenet)");

  scenario = "aw-role-member";
  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f7.kunde.no", authorization: "Bearer t" }, validOvBody));
  assert(r.status === 403, "f7: 403 for rolla member (krev admin/editor)");

  scenario = "aw-role-http-error";
  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f8.kunde.no", authorization: "Bearer t" }, validOvBody));
  assert(r.status === 401, "f8: 401 når rolleoppslaget mot tenantens users-tabell feilar");

  scenario = "ov-full-success";
  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f9.kunde.no", authorization: "Bearer t" }, undefined));
  assert(r.status === 400, "f9: 400 ved ugyldig JSON i førespurnaden");

  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f10.kunde.no", authorization: "Bearer t" }, { scenarioType: "relocation" }));
  assert(r.status === 400, "f10: 400 når description manglar");

  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f11.kunde.no", authorization: "Bearer t" }, { description: "x".repeat(1501) }));
  assert(r.status === 400, "f11: 400 når description er for lang");

  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f12.kunde.no", authorization: "Bearer t" }, { description: "Test", requestedSections: ["ukjend-seksjon"] }));
  assert(r.status === 400, "f12: 400 ved ugyldig verdi i requestedSections");

  scenario = "ov-anthropic-http-error";
  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f13.kunde.no", authorization: "Bearer t" }, validOvBody));
  assert(r.status === 502, "f13: 502 når Anthropic-kallet feilar med HTTP-feil (eksisterande punkt er urørte -- ingen tilstand vert skriven server-side i det heile)");
  body = await r.json();
  assert(typeof body.error === "string" && body.error.length > 0, "f13b: feilrespons har ei lesbar norsk feilmelding");

  scenario = "ov-anthropic-bad-shape";
  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f14.kunde.no", authorization: "Bearer t" }, validOvBody));
  assert(r.status === 502, "f14: 502 når Anthropic-svaret manglar tool_use-blokka (ikkje tekst-parsing av eit vanleg svar)");

  scenario = "ov-full-success";
  r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f15.kunde.no", authorization: "Bearer t" }, validOvBody));
  assert(r.status === 200, "f15: 200 ved fullt vellykka generering");
  body = await r.json();
  assert(body.detectedSituationProfile && body.detectedSituationProfile.situationType === "Flytting av verksemd", "f15b: detectedSituationProfile kjem med frå modellsvaret");
  assert(Array.isArray(body.needs) && body.needs.length === 2, "f15c: begge needs frå modellen kjem gjennom valideringa");
  const badNeed = body.needs[1];
  assert(badNeed.category === "custom" && badNeed.priority === "normal", "f15d: ugyldige enum-verdiar frå modellen (kategori/prioritet) vert klemte til trygge standardverdiar, aldri sleppte gjennom rått");
  assert(body.dependencyNodes.length === 3, "f15e: alle tre dependencyNodes frå modellen kjem gjennom");
  assert(body.dependencyEdges.length === 2, "f15f: berre dei to gyldige, ikkje-sykliske kantane kjem gjennom -- sirkelkanten (2→0), utanfor-lista-kanten (0→99) og sjølv-referansen (1→1) er alle fjerna");
  const stepIds = body.dependencyNodes.map(n => n.id);
  assert(body.dependencyEdges.every(e => stepIds.includes(e.from) && stepIds.includes(e.to)), "f15g: kvar kant peikar på ekte, server-genererte id-ar (aldri modellen sin eigen fromIndex/toIndex rått)");
  assert(body.dependencyNodes.every(n => n.approvalStatus === "suggested" && n.status === "not-started"), "f15h: alle AI-genererte steg startar som «Forslag», aldri «Aktiv» -- ingenting skal telje i kart/oppsummering/eksport før brukaren tek dei med");
  assert(body.needs.every(n => typeof n.id === "string" && n.id.length > 0), "f15i: kvart punkt får ein server-generert id (stolar ikkje på modellen sin eigen)");
  assert(typeof body.disclaimer === "string" && body.disclaimer.length > 0, "f15j: svaret har alltid ei fast fråskrivingstekst");
  assert(body.title === validOvBody.title && body.description === validOvBody.description && body.scenarioType === validOvBody.scenarioType, "f15k: title/description/scenarioType frå den ORIGINALE førespurnaden kjem med i svaret uendra (retta tryggleiksgjennomgang-funn: desse gjekk tidlegare tapt, klienten viste alltid det generiske «Ny oversikt»)");

  scenario = "ov-full-success";
  let ovRateLimited = 0;
  for (let i = 0; i < 8; i++) {
    r = await oversiktHandler(fakePostRequest("https://kunde.no/api/ai/oversikt", { host: "f16.kunde.no", authorization: "Bearer t" }, validOvBody));
    if (r.status === 429) ovRateLimited++;
  }
  assert(ovRateLimited > 0, "f16: gjentekne raske kall frå same tenant+brukar vert til slutt rate-limita (429) -- same best-effort per-instans-vern som annual-wheel.js");

  console.log("\nResultat: OK " + __ok + " / FEIL " + __err);
}

main().catch(function (e) {
  console.error("test-api.js kræsja:", e);
  process.exitCode = 1;
});
