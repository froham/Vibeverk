// middleware.js — Vercel Routing Middleware (Phase 6 of the SaaS-scaling
// plan). Real implementation, replacing the Phase 0 mechanism-proof (which
// only echoed the Host header back in a response header). See
// docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md's Phase 6
// addendum for the full design and its sequencing rationale.
//
// MUST be named middleware.js, never middleware.mjs. Confirmed empirically
// 2026-07-08 (isolated single-variable retest): Vercel's "Framework Preset:
// Other" build pipeline silently fails to compile a root-level
// middleware.mjs into an actual Routing Middleware function -- no build
// error, no warning, it's just treated as an inert static asset.
// middleware.js works immediately, with no "type": "module" needed in
// package.json. Do not "fix" this back to .mjs because the docs say it
// should work -- that claim does not hold for this project shape.
//
// Three jobs:
// 1. Every request for /config.js is rewritten to /api/tenant-config (the
//    Phase 6 per-tenant config generator) -- unconditionally, since that
//    function does the real hostname resolution itself.
// 2. For actual page requests (the matcher below), resolve the tenant here
//    too, so an unknown hostname gets a real "not a customer" response
//    instead of silently serving index.html with no window.SITE_CONFIG
//    behind it (core.js is not guarded against that today).
// 3. Any /qr/<code> request (module-qrcode.js's dynamic/redirect QR codes,
//    2026-08-19) is rewritten to /api/qr-redirect?code=<code>, which does
//    its OWN independent tenant resolution (same self-contained pattern as
//    api/tenant-config.js) rather than reusing the `tenant` resolved below
//    -- kept deliberately decoupled so the function stays testable in
//    isolation. This request still goes through the same site-lock gate as
//    every other page below -- no bypass for QR scans while a tenant's
//    site-lock is on. /api/qr-redirect is ALSO listed directly in the
//    matcher below (Security Auditor finding, 2026-08-19): without that, a
//    request straight to /api/qr-redirect (skipping the /qr/<code> rewrite
//    entirely) would never run through this file at all, bypassing the
//    site-lock check the header above claims applies unconditionally.
//
// The matcher list below was empirically verified against a real deployment
// 2026-07-16 (curl against the live "vibeverk" Vercel project, --resolve to
// bypass DNS caching) -- root, /console(/), /workspace(/) all correctly
// serve their respective index.html via Vercel's own static routing.
//
// DNS cutover happened 2026-07-16: vibeverk.no's apex A-record now points at
// Vercel, replacing GitHub Pages (see docs/roadmap/ROADMAP.md "Next" point 2
// and ADR-0007's Phase 2 addendum for the full history) -- this file is now
// live for real production traffic, not just the "vibeverk-j1yg" canary
// project it was originally developed against.

import { next, rewrite } from "@vercel/functions";
import { getOrCreateTraceparent } from "./api/_lib/trace.js";

export const config = {
  matcher: [
    "/",
    "/manifest.json",
    "/config.js",
    "/workspace",
    "/workspace/",
    "/workspace/manifest.json",
    "/console",
    "/console/",
    "/admin",
    "/admin/",
    "/admin/manifest.json",
    "/qr/:code",
    "/qr/:code/",
    "/api/qr-redirect",
    "/api/qr-redirect/",
  ],
};

// ── Enkel utviklingsfase-sperre (2026-07-16) ────────────────────────────────
// IKKJE ekte tryggleik -- berre ei hindring mot tilfeldige besøkjande medan
// heile plattforma (inkl. vibeverk.no sjølv) framleis er i utviklingsfase.
// HTTP Basic Auth, sjekka FØR noko anna -- deler éin felles passordfrase på
// tvers av alle domene/hostnamen som går gjennom denne fila (same middleware
// på begge Vercel-prosjekt: "vibeverk" og "vibeverk-j1yg"). Gjeld difor
// samstundes vibeverk.no, console.vibeverk.no, workspace.vibeverk.no,
// staging.vibeverk.no OG sunnvask.vibeverk.no -- ikkje valfritt per domene.
// Kjem i TILLEGG til, ikkje i staden for, dei eksisterande admin-/Workspace-/
// Console-innloggingane (dei står urørte bak denne sperra).
// Slå AV att seinare ved å fjerne `SITE_LOCK_PASSWORD`-miljøvariabelen på
// begge prosjekt (ingen kodeendring naudsynt) -- viss variabelen manglar,
// sleppast alle gjennom uendra (fail-open, med vilje, sidan dette berre er
// ei mellombels hindring, ikkje ei sikkerheitsgrense).
function checkSiteLock(request) {
  const expected = process.env.SITE_LOCK_PASSWORD;
  if (!expected) return true;
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Basic ")) return false;
  let decoded;
  try { decoded = atob(auth.slice(6)); } catch (e) { return false; }
  const sep = decoded.indexOf(":");
  const pass = sep === -1 ? decoded : decoded.slice(sep + 1);
  return pass === expected;
}

// ── Per-tenant sidesperre (2026-08-10, utvida 2026-08-11 med AV-tilstand) ───
// Ekte, kundevald passord (forenkla design, sjå
// supabase-control/supabase/migrations/20260810234227_tenant_site_lock.sql
// for full grunngjeving) som ERSTATTAR den globale utviklingsfase-sperra over
// for akkurat denne tenanten sine domene, når admin har slått han på i
// Console. Tre tilstandar totalt (sjå lock-avgjerda i middleware()):
// PÅ (eige passord), AV-etter-å-ha-vore-konfigurert (heilt open, ingen
// sperre), og aldri-konfigurert (fell attende til den globale sperra) --
// sjå 20260811074128_tenant_site_lock_off_state.sql for grunngjevinga bak
// kvifor eit reint boolsk flagg ikkje held for å skilje dei to siste frå
// kvarandre. Trong for tenant-oppløysing FØR sperre-avgjerda vert teken --
// difor er tenant-oppslaget nedanfor flytta framfor sjekken, i motsetnad til
// den opphavlege rekkjefølgja (som berre løyste opp tenant for å avvise
// ukjende domene, etter sperra alt var sjekka globalt).
//
// Fail-CLOSED ved feil (i motsetnad til checkSiteLock sin med-vilje
// fail-open) -- dette er eit ekte passord kunden sjølv har sett, ikkje ei
// mellombels utviklingssperre, så ein feila RPC-kall skal ALDRI stille som
// eit ope hol.
async function checkTenantSiteLock(request, host, controlUrl, controlAnonKey, traceparent) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Basic ")) return false;
  let decoded;
  try { decoded = atob(auth.slice(6)); } catch (e) { return false; }
  const sep = decoded.indexOf(":");
  const pass = sep === -1 ? decoded : decoded.slice(sep + 1);
  try {
    const resp = await fetch(controlUrl + "/rest/v1/rpc/verify_tenant_site_lock_password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: controlAnonKey,
        Authorization: "Bearer " + controlAnonKey,
        traceparent: traceparent,
      },
      body: JSON.stringify({ p_hostname: host, p_password: pass }),
    });
    if (!resp.ok) return false;
    return (await resp.json()) === true;
  } catch (e) {
    console.error("[vibeverk-middleware] tenant-sitelock-verifisering feila", e);
    return false;
  }
}

async function resolveTenant(controlUrl, controlAnonKey, host, traceparent) {
  const resp = await fetch(controlUrl + "/rest/v1/rpc/resolve_tenant_by_hostname", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: controlAnonKey,
      Authorization: "Bearer " + controlAnonKey,
      traceparent: traceparent,
    },
    body: JSON.stringify({ p_hostname: host }),
  });
  if (!resp.ok) throw new Error("resolve_tenant_by_hostname HTTP " + resp.status);
  const rows = await resp.json();
  return Array.isArray(rows) ? rows[0] : null;
}

function isExactPreviewDeployment(host) {
  const deploymentHost = String(process.env.VERCEL_URL || "").trim().toLowerCase();
  return process.env.VERCEL_ENV === "preview" &&
    !!deploymentHost &&
    host === deploymentHost;
}

function isExactConsolePreview(url, host) {
  return isExactPreviewDeployment(host) &&
    (url.pathname === "/console" || url.pathname === "/console/");
}

export default async function middleware(request) {
  const url = new URL(request.url);

  // W3C Trace Context (traceparent) -- generated once per request here,
  // since this file fronts every request Vibeverk serves (page loads,
  // /config.js, manifests, QR redirects). Forwarded on this file's own
  // outbound fetch()es to the control plane, on the request headers of
  // every rewrite()/next() so api/*.js can read and forward it too, and on
  // the response so it's visible in devtools / Supabase's own request logs
  // (which now parse this header natively). See api/_lib/trace.js and
  // docs/architecture/tracing.md.
  const traceparent = getOrCreateTraceparent(request);
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.set("traceparent", traceparent);

  // manifest.json vert henta av Chrome/Android sin eigen bakgrunns-
  // installerbarheits-sjekk ved "Legg til på Startskjerm", ikkje som ein
  // vanleg side-førespurnad frå brukaren sin fane -- ho ber IKKJE med seg
  // fana sitt mellombels site-lock-passord (Basic Auth vert normalt berre
  // cacha for interaktive sidenavigeringar/sub-ressursar i same fane, ikkje
  // Chrome sin eigen separate manifest-hentar). Utan dette unntaket feilar
  // manifest-henting alltid (401) for installerte heim-skjerm-appar, og
  // Chrome fell tilbake til generisk grå fargelegging heile tida --
  // stadfesta 2026-07-26 (brukar sitt Android-heim-skjerm-app-skjermbilete).
  // Ingen reell tryggleiksrisiko å unnta -- manifestet inneheld berre
  // offentleg brukbar merkevarebygging (namn/logo/fargar), ikkje hemmelegheiter.
  // Same unntak gjeld no /manifest.json (offentleg side) og
  // /admin/manifest.json (Web-admin), 2026-07-26 -- console/manifest.json
  // treng ikkje dette då han er ei statisk fil utanfor matcher-lista over,
  // og difor aldri når denne funksjonen i det heile.
  if (url.pathname === "/workspace/manifest.json") {
    return rewrite(new URL("/api/workspace-manifest", request.url), { request: { headers: forwardHeaders } });
  }
  if (url.pathname === "/manifest.json") {
    return rewrite(new URL("/api/site-manifest", request.url), { request: { headers: forwardHeaders } });
  }
  if (url.pathname === "/admin/manifest.json") {
    return rewrite(new URL("/api/admin-manifest", request.url), { request: { headers: forwardHeaders } });
  }

  const controlUrl = process.env.VIBEVERK_CONTROL_URL;
  const controlAnonKey = process.env.VIBEVERK_CONTROL_ANON_KEY;
  const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];

  let tenant = null;
  if (controlUrl && controlAnonKey && host) {
    try {
      tenant = await resolveTenant(controlUrl, controlAnonKey, host, traceparent);
    } catch (e) {
      console.error("[vibeverk-middleware] tenant-oppslag feila", e);
      return new Response(
        "Mellombels feil — prøv igjen straks.",
        { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", traceparent: traceparent } }
      );
    }
  } else {
    console.error("[vibeverk-middleware] mangler control-plane-config eller host — slepp gjennom uløyst");
  }

  // Tre tilstandar (2026-08-11, jf. brukarfeedback -- "AV = heilt av"):
  // 1. tenant.site_lock_enabled === true -- tenanten sitt eige passord.
  // 2. site_lock_enabled er false, MEN site_lock_ever_enabled er true --
  //    tenanten HAR hatt sperra PÅ minst éin gong før og operatøren har
  //    sidan eksplisitt slått han AV -- HEILT open, ingen sperre i det
  //    heile, verken tenant-spesifikk eller global.
  // 3. site_lock_ever_enabled er false -- tenanten har ALDRI hatt sperra PÅ
  //    -- fell tilbake til den delte, globale utviklingssperra (uendra
  //    åtferd for alle andre, urørte tenantar).
  //
  // Medvite IKKJE basert på site_lock_updated_at (Security Auditor-funn
  // HIGH, 2026-08-11): den kolonna vert sett av set_tenant_site_lock() kvar
  // gong eit passord vert lagra, UAVHENGIG av om "Sperre PÅ" er kryssa av
  // -- ein operatør som berre "legg inn eit passord for seinare" utan å
  // krysse av boksen ville elles ved eit uhell opna domenet heilt.
  // site_lock_ever_enabled er monotont og vert kun sant etter ei EKTE
  // PÅ-hending, difor upåverka av eit reint passord-lagre.
  const lockOk = tenant && tenant.site_lock_enabled
    ? await checkTenantSiteLock(request, host, controlUrl, controlAnonKey, traceparent)
    : (tenant && tenant.site_lock_ever_enabled ? true : checkSiteLock(request));
  if (!lockOk) {
    return new Response("Autentisering kravd.", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Vibeverk (under utvikling)"',
        traceparent: traceparent,
      },
    });
  }

  if (url.pathname === "/config.js") {
    // Console brukar den statiske basiskonfigurasjonen før core.js startar.
    // På den eksakte Vercel-preview-hostnamen finst ingen tenant å generere
    // config frå; ei omskriving til tenant-config ville difor setje
    // SITE_CONFIG=null og få core.js til å stoppe før Console vert montert.
    // SITE_LOCK er allereie kontrollert over. Unntaket gjeld berre denne eine
    // statiske fila på Vercel si servereigde preview-hostname.
    if (isExactPreviewDeployment(host)) return next({ request: { headers: forwardHeaders } });
    return rewrite(new URL("/api/tenant-config", request.url), { request: { headers: forwardHeaders } });
  }

  // Console er global og tenant-uavhengig, men den genererte preview-hostname
  // finst med vilje ikkje i tenantregisteret. Slepp berre gjennom akkurat den
  // deployment-hostname Vercel sjølv annonserer, berre i preview-miljøet og
  // berre for /console. SITE_LOCK er kontrollert over, og Console krev framleis
  // control-plane-innlogging. Produksjon, Workspace, kundesider og andre
  // *.vercel.app-hostar held fram med 404 ved manglande tenant.
  if (controlUrl && controlAnonKey && host && !tenant && !isExactConsolePreview(url, host)) {
    return new Response(
      "Dette domenet er ikkje registrert som ein Vibeverk-kunde.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", traceparent: traceparent } }
    );
  }

  if (url.pathname === "/console" || url.pathname === "/console/") {
    return next({
      headers: { "Permissions-Policy": "loopback-network=(self)" },
      request: { headers: forwardHeaders },
    });
  }

  if (url.pathname.indexOf("/qr/") === 0) {
    // vercel.json sitt trailingSlash:true 308-redirecter /qr/<code> til
    // /qr/<code>/ FØR denne fila i det heile nås -- den reelle pathname
    // her har difor alltid ein etterslengande skråstrek. Stadfesta i
    // produksjon rett etter fyrste deploy (2026-08-19): utan replace(/\/+$/)
    // vart heile koden (inkl. skråstreken) sendt vidare som ?code=, som
    // aldri matcha noka lagra rad -- kvar einaste skanna QR-kode enda på
    // ei generisk Vercel-404 i staden for den venlege qr-redirect-sida.
    const qrCode = url.pathname.slice(4).replace(/\/+$/, "");
    if (qrCode) {
      return rewrite(
        new URL("/api/qr-redirect?code=" + encodeURIComponent(qrCode), request.url),
        { request: { headers: forwardHeaders } }
      );
    }
  }

  return next({ request: { headers: forwardHeaders } });
}
