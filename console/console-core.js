/* =============================================================================
   console-core.js  —  Vibeverk Console (per-kunde superadmin)
   -----------------------------------------------------------------------------
   Fullside admin-grensesnitt for Vibeverk-operatørar. Lastar etter core.js
   og overrider CSS-variablar til eit nøytralt konsolltema. Autentisering via
   Supabase OTP (e-post → 8-sifra kode) mot control-plane-prosjektet
   vibeverk-control (Fase 8, sjå docs/decisions/ADR-0008) — ikkje lenger mot
   kunden sitt eige Supabase-prosjekt. Skriv superconfig via ein broker
   Edge Function i vibeverk-control, som krysser inn i kundens eige prosjekt
   med ein Vault-dekryptert service_role-nøkkel.
   ========================================================================== */

window.VwConsole = (function () {
  "use strict";

  var App = window.App;
  var C   = window.Components;
  var CFG = window.SITE_CONFIG || {};
  var NS  = CFG.storageKey || "site";
  var SUPER_KEY = "superconfig";

  // Control-plane (vibeverk-control) — Fase 8. Faste verdiar, ikkje
  // per-kunde-config: dette er Vibeverk sin eigen operatør-database, den
  // same for alle kundar. Anon-nøkkelen er trygg å ha her, som alle
  // Supabase anon-nøklar sendt til ein nettlesar (rate-avgrensa +
  // RLS-verna, aldri service_role-nøkkelen).
  var CONTROL_URL      = "https://jxoglthrnshabqmdmnui.supabase.co";
  var CONTROL_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4b2dsdGhybnNoYWJxbWRtbnVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NTU5NDMsImV4cCI6MjA5OTAzMTk0M30.W1_bBTWxbalRdxuDnIFrRdoNFcOI8IECCbGIxTkiECM";

  // Plattformversjon — bump ved kvar meiningsfulle endring, sjå docs/project/CHANGELOG.md
  var VIBEVERK_VERSION = "0.140.0";

  if (!App || !C) {
    var errEl = document.getElementById("console-app");
    if (errEl) errEl.innerHTML = '<p style="padding:2rem;color:#c0392b;font-family:sans-serif">Feil: core.js / components.js ikkje lasta. Sjekk konsollen.</p>';
    return {};
  }

  /* =========================================================================
     KONSOLL-TEMA  — overrider kundefargane som core.js set
     ====================================================================== */
  function applyConsoleTheme() {
    var r = document.documentElement;
    r.style.setProperty("--color-primary",   "#2563eb");
    r.style.setProperty("--color-secondary", "#7c3aed");
    r.style.setProperty("--color-bg",        "#f1f5f9");
    r.style.setProperty("--color-surface",   "#ffffff");
    r.style.setProperty("--color-text",      "#0f172a");
    r.style.setProperty("--color-muted",     "#64748b");
    r.style.setProperty("--color-border",    "rgba(15,23,42,.12)");
    r.style.setProperty("--color-alt",       "rgba(37,99,235,.04)");
    r.style.setProperty("--color-tint",      "rgba(37,99,235,.08)");
    r.style.setProperty("--font-display",    '"Inter", system-ui, sans-serif');
    r.style.setProperty("--font-body",       '"Inter", system-ui, sans-serif');
  }

  /* =========================================================================
     CONTROL-PLANE-KLIENT  — Fase 8: eigen, sesjonspersisterande klient mot
     vibeverk-control, brukt til OTP-innlogging og alle broker-kall.
     -------------------------------------------------------------------------
     App.ready-gate (ADR-0007 Fase 1 / SaaS-skaleringsplanen Fase 4): denne
     fila er, som workspace-core.js, EIN stor vedvarande IIFE der CFG vert
     fanga éin gong via closure og delt av mange funksjonar (renderSystem,
     applySuperConfig, m.fl.) — ikkje kvar sin eigen vesle IIFE som modulfilene.
     Difor: tilordne den same CFG-variabelen på nytt (i staden for å skygge
     han lokalt) OG opprett _sbControl inne i same gate.

     Ulikt den gamle _sb-klienten (som var mot KUNDENS eige prosjekt og ikkje
     persisterte sesjonen): _sbControl er mot vibeverk-control og BRUKAR
     persistSession/autoRefreshToken, sidan JWT-en no faktisk er sanninga om
     kor lenge operatøren er innlogga (sjå isAuthed() under — fiksar ein reell,
     tidlegare dokumentert bug der UI-et kunne sjå innlogga ut lenge etter at
     den underliggande sesjonen faktisk hadde gått ut).
     ====================================================================== */
  var _sbControl   = null;
  var _session     = null;
  var _tenants     = [];
  var _activeTenant = null;

  App.ready(function (freshCFG) {
    CFG = freshCFG;
    if (window.supabase) {
      _sbControl = window.supabase.createClient(CONTROL_URL, CONTROL_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      _sbControl.auth.onAuthStateChange(function (_event, session) {
        _session = session;
      });
    }
  });

  /* =========================================================================
     AUTH  — OTP mot vibeverk-control, ekte Supabase-sesjon (ikkje eit
     handrulla localStorage-tidsstempel lenger)
     ====================================================================== */
  var _otpEmail = "";

  function isAuthed() { return !!_session; }

  function logout() {
    if (_sbControl) _sbControl.auth.signOut();
    _session = null;
    _activeTenant = null;
    location.reload();
  }

  // supabase-js sitt functions.invoke() set berre ei GENERISK melding
  // ("Edge Function returned a non-2xx status code") på error.message for
  // KVAR EINASTE ikkje-2xx respons, uansett kva funksjonen faktisk svarte.
  // Vår eigen json({ error: "..." }, 4xx/5xx)-kropp (t.d. "Tenanten er alt
  // arkivert", "Berre superadmin kan utføre kundeadministrasjon") ligg berre
  // tilgjengeleg via error.context (den rå Response-en) og må lesast async.
  // Utan dette synte Console berre den generiske meldinga uansett kva som
  // faktisk gjekk gale (fann dette 2026-07-12 via brukarrapport om
  // arkivering/domenenamn-endring — men bugen råka ALLE handlingar via
  // brokerCall/tenantAdminCall, ikkje berre desse to).
  function extractFunctionErrorMessage(error, cb) {
    if (error && error.context && typeof error.context.json === "function") {
      error.context.json().then(function (body) {
        cb((body && body.error) || (error && error.message) || "Feil mot control-plane");
      }).catch(function () {
        cb((error && error.message) || "Feil mot control-plane");
      });
      return;
    }
    cb((error && error.message) || "Feil mot control-plane");
  }

  // Kallar den nye broker Edge Function-en i vibeverk-control. Krev at
  // operatøren er innlogga (Authorization-header vert sett automatisk av
  // _sbControl frå gjeldande sesjon) og at ein aktiv tenant er vald.
  function brokerCall(action, payload, cb) {
    if (!_sbControl || !_activeTenant) { cb({ error: "Ikkje klar" }); return; }
    var body = Object.assign({ action: action, tenant_id: _activeTenant.id }, payload || {});
    _sbControl.functions.invoke("broker", { body: body }).then(function (r) {
      if (r.error) { extractFunctionErrorMessage(r.error, function (msg) { cb({ error: msg }); }); return; }
      cb(r.data || {});
    });
  }

  // Fase 9: kallar tenant-admin Edge Function-en (kunde-onboarding-sjekklista)
  // — ei eiga funksjon, atskilt frå broker over, sidan denne skriv direkte i
  // tenant-registeret (control-plane-eigne skrivingar, ikkje kryssprosjekt-
  // handlingar mot ein KUNDE sitt prosjekt slik broker gjer, bortsett frå
  // verify_tenant_schema-handlinga). tenant_id er valfri her (register_tenant
  // har ingen enno) — payload avgjer, ikkje _activeTenant.
  function tenantAdminCall(action, payload, cb) {
    if (!_sbControl) { cb({ error: "Ikkje klar" }); return; }
    var body = Object.assign({ action: action }, payload || {});
    _sbControl.functions.invoke("tenant-admin", { body: body }).then(function (r) {
      if (r.error) { extractFunctionErrorMessage(r.error, function (msg) { cb({ error: msg }); }); return; }
      cb(r.data || {});
    });
  }

  // Stadfestar at den innlogga brukaren faktisk er ein aktiv operatør (RLS-
  // policyen operators_self_read let ein brukar lese si eiga rad). Dette er
  // NO den fulle tilgangssjekken — flytta til etter OTP-verifisering i staden
  // for ei hardkoda e-postliste sjekka FØR koden vert sendt (den kunne i
  // teorien bli brukt som eit "finst denne e-posten"-orakel).
  function checkOperatorActive(cb) {
    if (!_session) { cb(false); return; }
    _sbControl.from("operators").select("status").eq("id", _session.user.id).single().then(function (r) {
      cb(!r.error && r.data && r.data.status === "active");
    });
  }

  function loadTenants(cb) {
    // Må hente ALLE felt Kundar-sjekklista (renderKdDetail) treng — status,
    // data_plane_url, data_plane_storage_key, routing_verified_at — ikkje
    // berre id/slug/hostnames (som var nok for tenant-veljaren åleine).
    // Elles vil sjekklista alltid vise "ikkje kopla"/tom status sjølv når
    // databasen faktisk har rette verdiar.
    _sbControl.from("tenants")
      .select("id, slug, hostnames, status, data_plane_url, data_plane_anon_key, data_plane_storage_key, data_plane_service_role_secret_id, schema_verified_at, routing_verified_at, first_admin_invited_at, smtp_configured_at, custom_modules_manifest, site_lock_enabled, site_lock_ever_enabled, site_lock_updated_at")
      .order("slug").then(function (r) {
        _tenants = r.data || [];
        // Ikkje default til ein arkivert tenant -- sidan sidepanel-veljaren
        // (buildShell()) no skjuler arkiverte, ville _activeTenant elles peike
        // på ein tenant som ikkje finst blant valgmoglegheitene i det heile.
        var selectable = _tenants.filter(function (t) { return t.status !== "archived"; });
        _activeTenant = selectable[0] || _tenants[0] || null;
        cb();
      });
  }

  /* =========================================================================
     SUPERCONFIG I/O
     -------------------------------------------------------------------------
     Fase 6-oppfølging (2026-07-09): getSC() las tidlegare frå App.store, ein
     lokal cache fylt av core.js sin EIGEN, heilt separate hydrering av
     KONSOLLEN sitt eige config.js-prosjekt (alltid det verkelege
     produksjonsprosjektet, sidan Console lastar vibeverk.no sin eigen
     config.js) — uavhengig av kva for tenant som er vald i sidepanelet. Dette
     var eit medvite forenkla val i Fase 8 (då fanst berre éin tenant, så
     "cachen sin tenant" og "vald tenant" var alltid same prosjekt). Den andre
     ekte kanari-tenanten avslørte at dette faktisk er ein feil no: å velje ein
     annan tenant synte framleis DEN VERKELEGE tenanten sine verdiar, og lagring
     forureina den same lokale cachen.
     Arkitekt-konsultert fiks: les tenant-skopert, direkte mot DEN VALDE
     tenanten sitt eige prosjekt med anon-nøkkelen (superconfig er med vilje
     anon-lesbar via store_anon_read RLS, nøyaktig same mønster core.js sjølv
     brukar for sin eigen tenant) — ikkje via broker (broker sitt formål er
     PRIVILEGERT kryssprosjekt-tilgang og audit-logging, unaudvendig for ei
     lesing som allereie er meint å vera offentleg).
     ====================================================================== */
  var _tenantPublicClients = {}; // cached per tenant id — unngår å laga ny klient kvar seksjonsbyte

  function tenantPublicClient() {
    if (!_activeTenant) return null;
    var cached = _tenantPublicClients[_activeTenant.id];
    if (cached) return cached;
    var client = window.supabase.createClient(_activeTenant.data_plane_url, _activeTenant.data_plane_anon_key,
      { auth: { persistSession: false } }); // berre anon-lesing, ingen sesjon å halde ved lag
    _tenantPublicClients[_activeTenant.id] = client;
    return client;
  }

  // Generisk tenant-skopert lesing av éin store-nøkkel (anon-lesbar, som
  // superconfig og analytics er) — direkte mot DEN VALDE tenanten sitt eige
  // prosjekt, ikkje via broker og ikkje via nokon lokal cache.
  function getStoreKey(key, cb) {
    var sb = tenantPublicClient();
    if (!sb) { cb({}); return; }
    sb.from("store").select("value")
      .eq("tenant_id", _activeTenant.data_plane_storage_key)
      .eq("key", key)
      .maybeSingle()
      .then(function (r) {
        if (r.error) { console.error("[console] lesing av '" + key + "' feila:", r.error); cb({}); return; }
        cb((r.data && r.data.value) || {});
      });
  }

  function getSC(cb) { getStoreKey(SUPER_KEY, cb); }

  // Same spørring som getStoreKey(), MEN eksponerer ein feil til kallaren i
  // staden for å svelgje han og returnere eit stille {} -- brukt berre av
  // personvern sin hybrid-vakt ved publisering (privacyGuardBlockedBlocks),
  // sidan eit tomt {} ved ein forbigåande nettverksfeil elles kunne la
  // operatøren publisere med eit ekskludert analyse-avsnitt UTAN at han fekk
  // vite at sjekken faktisk ikkje fekk verifisert ekte data (UX-review-funn
  // 2026-08-06).
  function getStoreKeyOrError(key, cb) {
    var sb = tenantPublicClient();
    if (!sb) { cb(null, new Error("Ingen tilkopling")); return; }
    sb.from("store").select("value")
      .eq("tenant_id", _activeTenant.data_plane_storage_key)
      .eq("key", key)
      .maybeSingle()
      .then(function (r) {
        if (r.error) { cb(null, r.error); return; }
        cb((r.data && r.data.value) || {}, null);
      });
  }

  // Skriving går via broker Edge Function-en i vibeverk-control (Fase 8),
  // ikkje lenger direkte mot kundens eige prosjekt — sjå brokerCall() over.
  // Skriv IKKJE lenger til nokon lokal cache (fjerna saman med getSC()-fiksen
  // over — cachen var berre feil-kjelda, tente ingen føremål her lenger).
  //
  // Security/QA-gjennomgang (2026-07-09, Codex + QA-agent, uavhengig av
  // kvarandre): saveSC() las tidlegare tenant_id via brokerCall() sin EIGEN,
  // FERSKE _activeTenant på skrivetidspunktet -- ikkje tenanten som var
  // aktiv då operatøren opna/redigerte skjemaet. Dei seks
  // lagre-handterarane gjer alle getSC(function(sc2){ ...; saveSC(sc2); }) --
  // viss operatøren byter tenant i sidepanelet MEDAN getSC() sitt asynkrone
  // kall står ustengt, ville saveSC() sin brokerCall() bruke DEN NYE
  // tenanten, og skrive det gamle skjemaet sitt (feil) innhald inn i feil
  // kunde sin store-rad. Fiksa ved at kvar lagre-handtering no fangar
  // tenant-IDen FØR nokon asynkron lesing startar, og sender han eksplisitt
  // her -- ikkje via den potensielt endra _activeTenant seinare.
  function saveSC(sc, tenantId) {
    var payload = { key: SUPER_KEY, value: sc };
    if (tenantId) payload.tenant_id = tenantId;
    brokerCall("set_config", payload, function (r) {
      if (r.error) console.error("[console] superconfig-skriving feila:", r.error);
    });
  }

  function resetSC() {
    if (!confirm("Nullstille ALLE tilpassa innstillingar for denne kunden (farger, fontar, tekstar, aktiverte funksjonar, personvernstekst osv.) tilbake til dei nøytrale standardverdiane? Dette skjer umiddelbart og er synleg for besøkjande med ein gong. Kan ikkje angrast. Er du sikker?")) return;
    // App.store.remove(SUPER_KEY) fjerna saman med resten av den lokale
    // cache-fjerninga (sjå getSC()/saveSC() sine notat) -- den nullstilte
    // berre KONSOLLEN sin eigen, uavhengige lokale cache for den VERKELEGE
    // tenanten, ikkje nokon relevant tilstand for den tenanten som faktisk
    // er vald her.
    // Same tenant-fanging som saveSC() -- fangar _activeTenant FØR kallet,
    // ikkje avhengig av at han framleis er den same når nullstillinga
    // faktisk køyrer.
    var resettingTenantId = _activeTenant && _activeTenant.id;
    var payload = resettingTenantId ? { tenant_id: resettingTenantId } : {};
    brokerCall("reset_config", payload, function (r) {
      if (r.error) console.error("[console] nullstilling feila:", r.error);
      location.reload();
    });
  }

  // Merk: Console sin klientside-tilgang til 'superconfig-private' (via
  // broker sine get_private_config/set_config-actions) vart fjerna herifrå
  // 2026-07-17 saman med "Nettside-admin (for kunden)"-boksen i renderSystem()
  // -- det var det einaste bruksområdet. Broker-actionen og RLS-oppsettet
  // (is_platform_operator()) er urørt server-side, og core.js sin eigen
  // lesing av adminPassword-fallbacken (ADR-0003) er ei heilt anna, urørt
  // kodesti (går direkte mot kundens eige Supabase-prosjekt, ikkje via denne
  // fila). Om eit nytt privat per-kunde-felt treng redigering frå Console
  // seinare, kan get_private_config/set_config-kalla gjenreisast då.

  /* =========================================================================
     KONSTANTER
     ====================================================================== */
  var FONT_PAIRS = [
    { label: "Syne + Inter",                    display: "Syne",               body: "Inter" },
    { label: "Playfair + Source Sans 3",         display: "Playfair Display",   body: "Source Sans 3" },
    { label: "Space Grotesk + Work Sans",        display: "Space Grotesk",      body: "Work Sans" },
    { label: "Fraunces + Karla",                 display: "Fraunces",           body: "Karla" },
    { label: "Poppins + Nunito Sans",            display: "Poppins",            body: "Nunito Sans" },
    { label: "Bricolage Grotesque + Inter",      display: "Bricolage Grotesque",body: "Inter" },
    { label: "DM Serif Display + DM Sans",       display: "DM Serif Display",   body: "DM Sans" },
    { label: "Libre Baskerville + Lato",         display: "Libre Baskerville",  body: "Lato" },
    { label: "Archivo + Roboto",                 display: "Archivo",            body: "Roboto" },
    { label: "Outfit + Plus Jakarta Sans",       display: "Outfit",             body: "Plus Jakarta Sans" },
    { label: "Cormorant Garamond + Mulish",      display: "Cormorant Garamond", body: "Mulish" }
  ];

  /* --- Live fontforhandsvisning (Fontar-seksjonane i Nettside/Workspace) -----
     Ren admin-bekvemmelighet -- viser valgt font direkte i feltet sitt eige
     forhandsvisningselement, henta frå Google Fonts sitt CSS2-API, same
     mønster som core.js sin injectGoogleFonts() (ikkje delt kode, sidan
     Console aldri lastar core.js). Delt <link>-element for alle aktive
     forhandsvisingar samstundes (nettside display/body + Workspace
     display/body), bygd på nytt kvar gong éin av dei endrar seg. */
  var _fontPreviewState = {};

  function rebuildPreviewFontLink() {
    var families = [];
    var seen = {};
    Object.keys(_fontPreviewState).forEach(function (k) {
      var f = _fontPreviewState[k];
      var key = f.name + "|" + f.weights.join(",");
      if (seen[key]) return;
      seen[key] = true;
      families.push("family=" + encodeURIComponent(f.name).replace(/%20/g, "+") + ":wght@" + f.weights.join(";"));
    });
    var linkEl = document.getElementById("cs-preview-fonts");
    if (!families.length) return;
    if (!linkEl) {
      linkEl = document.createElement("link");
      linkEl.id = "cs-preview-fonts";
      linkEl.rel = "stylesheet";
      document.head.appendChild(linkEl);
    }
    linkEl.href = "https://fonts.googleapis.com/css2?" + families.join("&") + "&display=swap";
  }

  function fontPreviewMarkup(id) {
    return '<p id="' + id + '" style="margin:.4rem 0 0;padding:.55rem .75rem;' +
      'border:1px solid var(--color-border);border-radius:8px;font-size:1.15rem;' +
      'opacity:.45;transition:opacity .15s" aria-hidden="true">Aa Bb Cc — Eksempeltekst 123</p>';
  }

  // Oppdaterer eitt forhandsvisingselement no, ut frå feltet sin noverande
  // verdi -- kallast både på 'input' og etter programmatiske verdi-endringar
  // (fontpar-knappar, nullstill-knapp) som ikkje sjølv utløyser 'input'.
  function refreshFontPreview(nameId, weightsId, previewId) {
    var nameEl = document.getElementById(nameId);
    var prevEl = document.getElementById(previewId);
    if (!nameEl || !prevEl) return;
    var name = nameEl.value.trim();
    if (!name) {
      prevEl.style.fontFamily = "inherit";
      prevEl.style.opacity = ".45";
      delete _fontPreviewState[previewId];
      rebuildPreviewFontLink();
      return;
    }
    prevEl.style.fontFamily = "'" + name.replace(/'/g, "") + "', sans-serif";
    prevEl.style.opacity = "1";
    var weightsEl = weightsId && document.getElementById(weightsId);
    var weights = weightsEl
      ? weightsEl.value.split(",").map(function (w) { return parseInt(w.trim(), 10); }).filter(Boolean)
      : [];
    if (!weights.length) weights = [400, 700];
    _fontPreviewState[previewId] = { name: name, weights: weights };
    rebuildPreviewFontLink();
  }

  // Kobler eit fontnamn-felt + valfritt weights-felt til sitt eige
  // forhandsvisingselement -- legg til 'input'-lyttarar (kall EIN gong per
  // felt-sett) pluss ein umiddelbar fyrste visning med dagens lagra verdi.
  function bindFontPreview(nameId, weightsId, previewId) {
    function refresh() { refreshFontPreview(nameId, weightsId, previewId); }
    var nameEl = document.getElementById(nameId);
    var weightsEl = weightsId && document.getElementById(weightsId);
    if (nameEl) nameEl.addEventListener("input", refresh);
    if (weightsEl) weightsEl.addEventListener("input", refresh);
    refresh();
  }

  // Markerer kva for eit av dei fastdefinerte fontparknappane (om nokon) som
  // matchar dei noverande display/body-verdiane, slik brukaren ser kva par
  // som faktisk er i bruk -- ikkje berre ein rad blanke knappar. Kallast på
  // fyrste rendering og kvar gong felta endrar seg (klikk på eit par,
  // nullstill, "speil nettside", eller fritekst-redigering).
  function refreshFontPairActive(wrap, dfontId, bfontId, attr) {
    var dEl = wrap.querySelector("#" + dfontId);
    var bEl = wrap.querySelector("#" + bfontId);
    var d = (dEl ? dEl.value : "").trim().toLowerCase();
    var b = (bEl ? bEl.value : "").trim().toLowerCase();
    wrap.querySelectorAll("[" + attr + "]").forEach(function (btn) {
      var p = FONT_PAIRS[parseInt(btn.getAttribute(attr), 10)];
      var isMatch = !!p && p.display.toLowerCase() === d && p.body.toLowerCase() === b;
      btn.classList.toggle("is-active", isMatch);
    });
  }

  var FEAT_LABELS = {
    newsArchive:"Aktuelt", search:"Arkivsøk", attachments:"Vedlegg",
    social:"Sosiale lenker", contactForm:"Kontaktskjema", booking:"Booking", quote:"Tilbud",
    references:"Referansar", faq:"FAQ", siteSearch:"Søk i toppmeny",
    crm:"Kunder", crmFull:"Native e-post", mediabank:"Mediebank", chat:"Chat",
    sidebygger:"Design", sidetelling:"Innsikt"
  };
  // Opt-in-brytarar -- MÅ defaulte til AV for ein kunde som aldri har lagra
  // features eksplisitt, i motsetnad til alle andre brytarar over (som er
  // opt-OUT og difor skal defaulte til PÅ). featureDefaults() under brukar
  // denne til å avgjere kva som er rett default per nøkkel -- utan denne
  // lista ville checkboxen for eit nytt opt-in-flagg vist seg som hukt av
  // for enhver kunde som aldri har rørt fana, sjølv om den faktiske,
  // lagra verdien er av. Det ville i tillegg lagra "true" stille inn viss
  // operatøren trykte "Lagra" av ein heilt annan grunn (t.d. skrudde på
  // FAQ), sidan skjemaet skriv HEILE features-objektet på nytt kvar gong.
  var OPT_IN_FEATURES = { sidebygger: true, sidetelling: true };
  // Kva kvar bryter faktisk gjer -- rendrast som ein helpIcon() ved sida av
  // kvar checkbox (copy-clarity-initiativet, fase 4, 2026-07-13). Vald i
  // staden for å gjette meining frå den korte labelen åleine, sidan fleire
  // (t.d. "crmFull"/"Native e-post") ikkje er sjølvforklarande.
  var FEAT_HELP = {
    newsArchive: "Viser eit arkiv med ALLE tidlegare Aktuelt-innlegg, ikkje berre dei nyaste på framsida.",
    search:      "Legg til eit søkefelt i arkiv-visninga for Aktuelt-innlegg.",
    attachments: "Lèt besøkjande laste opp vedlegg (t.d. bilete) i Tilbod-skjemaet.",
    social:      "Viser lenker til sosiale medium (Facebook, Instagram m.m.) i footer.",
    contactForm: "Viser sjølve kontaktskjemaet på Kontakt-sida. Kontaktinfo (e-post/telefon/adresse) vert alltid vist, uansett.",
    booking:     "Aktiverer Booking-seksjonen der besøkjande kan reservere tid/ressursar sjølv.",
    quote:       "Aktiverer Tilbod-seksjonen der besøkjande kan be om pristilbod.",
    references:  "Aktiverer ein seksjon for kundecase/tidlegare prosjekt.",
    faq:         "Aktiverer eit spørsmål-og-svar-avsnitt.",
    siteSearch:  "Legg til eit søkefelt i topp-navigasjonen.",
    crm:         "Aktiverer kundehandtering (CRM) i Web-admin.",
    crmFull:     "Sender e-post direkte frå systemet i staden for å opne kunden sin eigen e-postklient (Outlook e.l.) ved svar til kundar.",
    mediabank:   "Aktiverer eit bildegalleri synleg for besøkjande på nettsida.",
    chat:        "Aktiverer live chat-widgeten for besøkjande.",
    sidebygger:  "Gjev kunden ein eigen «Design»-fane i Web-admin, der dei sjølv kan velje mellom fleire designmalar for heile nettsida, i tillegg til Banner- og Karusell-seksjonar — eit betalt tillegg.",
    sidetelling: "Aktiverer Vibeverk sin eigen, cookiefrie analyse (sidevisningar, henvisningar og klikk på knappar), synleg for kunden i den eigne Innsikt-fana i Web-admin (var underfane under Innstillinger, no ei eiga fane i adminpanelet). Kan ikkje brukast saman med eit eksternt verktøy (t.d. Plausible) sett opp i Analyse-fana her i Console — er begge slått på, vinn Plausible automatisk, og denne interne analysen samlar ikkje inn noko."
  };
  var IFEAT_LABELS = {
    announcements:"Aktuelt", notes:"Notatar", kb:"Kunnskapsbase",
    mediaInternal:"Mediebank", links:"Lenker", orgdrift:"Org & drift",
    crm:"Kunder", booking:"Booking", quote:"Tilbud", contact:"Kontakthenvendingar"
  };
  var IFEAT_HELP = {
    announcements: "Kunngjeringar/interne nyheiter, synleg for alle i Workspace.",
    notes:         "Personlege notat -- kvar tilsett ser berre sine eigne.",
    kb:            "Intern kunnskapsbase/dokumentasjon for dei tilsette.",
    mediaInternal: "Internt bildearkiv for tilsette -- skilt frå det offentlege mediebank-galleriet (sjå Nettside-fana).",
    links:         "Ei samling nyttige lenker (t.d. til andre system) synleg i Workspace.",
    orgdrift:      "Organisasjons- og driftsinformasjon (t.d. bemanning, faste rutinar).",
    crm:           "Gjev tilgang til kundehandtering (CRM) frå Workspace, i tillegg til Web-admin.",
    booking:       "Sjå og handtere bookingar frå Workspace.",
    quote:         "Sjå og handtere tilbodsførespurnadar frå Workspace.",
    contact:       "Sjå og svare på kontakthenvendingar frå Workspace."
  };

  // Rein PRISINGS-katalog (brukarønske 2026-08-05) -- Hosting/vedlikehold
  // (nettside og Workspace) og to skreddersydde Workspace-tillegg. Desse har
  // INGEN tilsvarande reell av/på-brytar i config.js (i motsetnad til ALT i
  // FEAT_LABELS/IFEAT_LABELS over, som "Modular"-fana (renderModular)
  // attbruker for å styre faktiske kundefunksjonar). Difor EIT MERGA sett,
  // berre for Priser sine eigne funksjonar -- Modular-fana bruker framleis
  // FEAT_LABELS/IFEAT_LABELS direkte, urørt, aldri disse nye nøklane. Utan
  // dette skiljet ville "Hosting og vedlikehold" og "Skreddersydd..." dukke
  // opp som togglar i Modular som ikkje gjer noko når dei klikkast.
  var PRICING_ONLY_F_LABELS = { hosting: "Hosting og vedlikehold av nettside" };
  var PRICING_ONLY_F_HELP = {
    hosting: "Løpande hosting, oppdateringar og teknisk drift av nettsida. Dette er IKKJE ein ekte av/på-brytar i appen -- eit rent prisingslinjeelement for tilbod og pakkar."
  };
  var PRICING_ONLY_I_LABELS = {
    hosting: "Hosting og vedlikehold av Workspace",
    customModule: "Skreddersydd modul",
    customAiModule: "Skreddersydd AI-modul"
  };
  var PRICING_ONLY_I_HELP = {
    hosting: "Løpande hosting, oppdateringar og teknisk drift av Workspace. Dette er IKKJE ein ekte av/på-brytar i appen -- eit rent prisingslinjeelement for tilbod og pakkar.",
    customModule: "Ein bestilt, tilpassa funksjon bygd spesielt for denne kunden. Ingen fast katalogpris -- sett ein pris her når modulen faktisk brukast i eit konkret tilbod.",
    customAiModule: "Ein bestilt, tilpassa AI-driven funksjon (t.d. i stil med Smart årshjul) bygd spesielt for denne kunden. Ingen fast katalogpris -- sett ein pris her når modulen faktisk brukast i eit konkret tilbod."
  };
  // Merga sett, KUN brukt av Priser-funksjonane under (aldri av renderModular
  // over). Object.assign() bevarer kvar kildes nøkkel-rekkjefølgje -- dei tre
  // nye prisingselementa hamnar difor FØR "Aktuelt" og resten, akkurat som
  // etterspurt.
  var PRISER_F_LABELS = Object.assign({}, PRICING_ONLY_F_LABELS, FEAT_LABELS);
  var PRISER_F_HELP   = Object.assign({}, PRICING_ONLY_F_HELP, FEAT_HELP);
  var PRISER_I_LABELS = Object.assign({}, PRICING_ONLY_I_LABELS, IFEAT_LABELS);
  var PRISER_I_HELP   = Object.assign({}, PRICING_ONLY_I_HELP, IFEAT_HELP);
  // "group" (2026-08-12, brukarvedtak): skil kundespesifikke seksjonar
  // (render(sc, wrap) med sc-avhengig innhald -- kva som helst nedanfor
  // avhenger av kven som er valt i kundeveljaren) frå Vibeverk-interne
  // seksjonar (same innhald uansett kven som er valt, eller ingen kunde
  // valt i det heile). Verifisert direkte i kvar render-funksjon før denne
  // gruppa vart sett, ikkje berre gjetta frå namnet -- t.d. "system" har eit
  // generisk namn, men er faktisk kundespesifikk (viser den valde kunden sitt
  // Supabase-prosjekt), medan "priser"/"kundeanalyse"/"laring" har eit
  // usynt-brukt sc/_sc-parameter og ALDRI les den valde kunden. "kundar"
  // (tenant-registeret sjølv) har ingen gruppe -- han er MEKANISMEN ein vel
  // kunde gjennom, ikkje eit medlem av nokon av dei to datasetta. Reint ei
  // rendering-/CSS-gruppering her -- NAV_ITEMS/RENDERERS/TITLES sine id-ar,
  // renderSection()-dispatchen og data-cs-nav-attributta er alle urørte.
  var NAV_ITEMS = [
    { id: "kundar",     icon: "building",    label: "Kundar",     group: null },
    { id: "produkt",    icon: "package",     label: "Produkt",    group: "kundedrift" },
    { id: "web",        icon: "world",       label: "Web",        group: "kundedrift" },
    { id: "sidebygger-sider", icon: "files", label: "Sider",      group: "kundedrift" },
    { id: "workspace",  icon: "briefcase",   label: "Workspace",  group: "kundedrift" },
    { id: "modular",    icon: "puzzle",      label: "Modular",    group: "kundedrift" },
    { id: "priser",     icon: "tag",         label: "Priser",     group: "internt" },
    { id: "kundeanalyse", icon: "zoom-check", label: "Kundeanalyse", group: "internt" },
    { id: "compliance", icon: "clipboard-text", label: "Compliance", group: "internt" },
    { id: "analyse",    icon: "chart-bar",   label: "Analyse",    group: "kundedrift" },
    { id: "personvern", icon: "shield-lock", label: "Personvern", group: "kundedrift" },
    { id: "laring",     icon: "book",        label: "Læring",     group: "internt" },
    { id: "system",     icon: "settings",    label: "System",     group: "kundedrift" }
  ];
  var NAV_GROUP_LABEL = { kundedrift: "Kundedrift", internt: "Vibeverk internt" };

  // AI Lab er eit utviklingsverktøy, ikkje ein del av den vanlege Console-
  // flata og ikkje det same som Læring. På ikkje-lokal origin returnerer
  // denne sjekken før eit einaste AI Lab-nettverkskall kan skje.
  var _aiLabConfig = null;
  var _aiLabProbeFinished = false;

  function isAiLabLocalEnvironment() {
    var loc = window.location;
    return !!loc && loc.protocol === "http:" &&
      (loc.hostname === "127.0.0.1" || loc.hostname === "localhost");
  }

  function shellNavItems() {
    var items = NAV_ITEMS.slice();
    if (_aiLabConfig) {
      // AI Lab er lokalt-berre og les aldri ein vald kunde -- same "internt"-
      // gruppe som Priser/Kundeanalyse/Læring.
      items.push({ id: "ai-lab", icon: "flask", label: "AI Lab", group: "internt" });
    }
    return items;
  }

  // Grupperer shellNavItems() sitt flate resultat til sidemeny-rendering --
  // "kundar" står for seg sjølv (ingen overskrift), deretter "kundedrift",
  // deretter "internt", kvar med si eiga overskrift. Rekkefølgja INNANFOR
  // kvar gruppe følgjer NAV_ITEMS sin eksisterande rekkefølgje uendra.
  function shellNavGroups() {
    var items = shellNavItems();
    var ungrouped = items.filter(function (n) { return !n.group; });
    var groupIds = ["kundedrift", "internt"];
    var groups = groupIds.map(function (gid) {
      return { id: gid, label: NAV_GROUP_LABEL[gid], items: items.filter(function (n) { return n.group === gid; }) };
    }).filter(function (g) { return g.items.length; });
    return { ungrouped: ungrouped, groups: groups };
  }

  /* =========================================================================
     NAVIGASJON
     ====================================================================== */
  var activeSection = "produkt";

  function navigate(id) {
    // Sesjonen vart tidlegare berre sjekka éin gong, ved DOMContentLoaded —
    // ei 48-timars-økt som gjekk ut MEDAN operatøren hadde Console open i eit
    // ope faneblad, heldt fram å fungere heilt til neste sideoppfriskning
    // (motsa den dokumenterte oppførselen i roles-and-tenants.md). RLS stogga
    // framleis faktiske skrivingar (is_platform_operator() sjekkar JWT-en
    // sin faktiske utløpstid, ikkje denne localStorage-tidsstempelen), men
    // UI-et såg ut til å framleis fungere normalt inntil ei skriving feila.
    if (!isAuthed()) { logout(); return; }
    activeSection = id;
    document.querySelectorAll("[data-cs-nav]").forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-cs-nav") === id);
    });
    renderSection(id);
  }

  /* =========================================================================
     HJELPAR
     ====================================================================== */
  function statusMsg(el, text, isOk) {
    if (!el) return;
    el.textContent = text;
    el.className = "form__status " + (isOk ? "is-ok" : "is-error");
    setTimeout(function () { if (el) el.textContent = ""; }, 3500);
  }

  // Generisk fulltekst-førehandsvising (2026-08-12, brukarønske: "generer
  // full tekstversjon"-knapp på både Personvern og Behandlingsprotokoll, for
  // å gjere det lettare å lese gjennom heile dokumentet samanhengande i
  // staden for boks for boks). Sjølvstendig, inline-styla modal -- brukar
  // ikkje nokon delt CSS-klasse frå public-sida sin termsField()-popup,
  // sidan Console har sitt eige, separate stilsett. isHtml=true for allereie
  // sanert rik-tekst-HTML (Personvern sine blokker), isHtml=false/utelate for
  // rein tekst som må escapast (Behandlingsprotokoll sine frie tekstfelt).
  function showTextPreviewModal(title, content, isHtml) {
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1.5rem";
    overlay.innerHTML =
      '<div style="background:var(--color-surface,#fff);border-radius:12px;max-width:760px;width:100%;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
        '<div style="padding:1rem 1.4rem;border-bottom:1px solid var(--color-border,#e2e8f0);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">' +
          '<strong>' + C.esc(title) + '</strong>' +
          '<button type="button" id="cs-text-preview-close" aria-label="Lukk" style="background:none;border:0;font-size:1.4rem;line-height:1;cursor:pointer;color:var(--color-muted,#64748b)">×</button>' +
        '</div>' +
        '<div style="padding:1.4rem;overflow:auto;font-size:.88rem;line-height:1.65">' +
          (isHtml ? content : '<div style="white-space:pre-wrap">' + C.esc(content) + '</div>') +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    overlay.querySelector("#cs-text-preview-close").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
  }

  function checkboxGrid(obj, labels, attr, help) {
    return '<div class="cs-checkbox-grid">' +
      Object.keys(obj).map(function (k) {
        return '<label class="cs-checkbox-label">' +
          '<input type="checkbox" data-' + attr + '="' + C.esc(k) + '"' + (obj[k] !== false ? " checked" : "") + '> ' +
          C.esc(labels[k] || k) +
          (help && help[k] ? " " + C.helpIcon(help[k]) : "") +
        '</label>';
      }).join("") +
    '</div>';
  }

  function colorField(id, label, value, hint) {
    return '<div class="field"><label>' + C.esc(label) + '</label>' +
      '<input type="color" id="' + id + '" value="' + C.esc(value) + '">' +
      (hint ? '<p class="field__hint">' + C.esc(hint) + '</p>' : '') +
    '</div>';
  }

  // WCAG-kontrastrekning (relativ luminans -> kontrastforhold), reint
  // klientside, ingen lagring -- berre ei live tilbakemelding til operatøren
  // mens dei vel fargar. Sjå docs/roadmap/ROADMAP.md "Later" (custom
  // design-modul-punktet, WCAG AA-kontrastvalidator).
  function hexToRgb(hex) {
    var h = (hex || "").replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var num = parseInt(h, 16) || 0;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  function relLuminance(hex) {
    var rgb = hexToRgb(hex);
    var chans = [rgb.r, rgb.g, rgb.b].map(function (c) {
      var s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * chans[0] + 0.7152 * chans[1] + 0.0722 * chans[2];
  }
  function contrastRatio(hex1, hex2) {
    var l1 = relLuminance(hex1), l2 = relLuminance(hex2);
    var lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // Fargeforslag ved WCAG-brot ("generer forslag", ønska av brukar under
  // live-test 2026-07-17 av kontrastvalidatoren over): flyttar lysstyrken
  // (HSL-lightness) til føregrunnsfargen mot svart ELLER kvitt -- kva retning
  // som faktisk aukar kontrasten mot bakgrunnen -- til terskelen er nådd.
  // Behelder same fargetone/metning, berre lysstyrken justerast.
  function hexToHsl(hex) {
    var rgb = hexToRgb(hex);
    var r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }
  function hslToHex(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      var hue2rgb = function (p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    function toHex(x) { var v = Math.round(x * 255).toString(16); return v.length === 1 ? "0" + v : v; }
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }
  function suggestAccessibleColor(fgHex, bgHex, targetRatio) {
    var hsl = hexToHsl(fgHex);
    var darker  = hslToHex(hsl.h, hsl.s, Math.max(0, hsl.l - 10));
    var lighter = hslToHex(hsl.h, hsl.s, Math.min(100, hsl.l + 10));
    var goDarker = contrastRatio(darker, bgHex) >= contrastRatio(lighter, bgHex);
    var l = hsl.l, hex = fgHex;
    for (var i = 0; i < 40 && contrastRatio(hex, bgHex) < targetRatio; i++) {
      l = goDarker ? Math.max(0, l - 2.5) : Math.min(100, l + 2.5);
      hex = hslToHex(hsl.h, hsl.s, l);
      if (l <= 0 || l >= 100) break;
    }
    return hex;
  }

  // Set saman eit HEILT, samanhengande fargeforslag (ikkje berre éin farge om
  // gongen som suggestAccessibleColor() over) -- ønska av brukar 2026-07-17
  // som ei utviding av "Generer forslag"-knappane. Vel ein tilfeldig
  // basis-fargetone og byggjer primær/sekundær/bakgrunn/tekst/overflate
  // rundt han, og bruker so suggestAccessibleColor() som eit sikringsnett på
  // kvart resultat -- garanterer at forslaget faktisk oppfyller WCAG AA FØR
  // det vert vist, ikkje berre "sannsynlegvis OK".
  function generateThemePalette() {
    var hue = Math.floor(Math.random() * 360);
    var secondaryHue = (hue + 150 + Math.floor(Math.random() * 60)) % 360;
    var background = hslToHex(hue, 12, 97);
    var surface = "#ffffff";
    var text      = suggestAccessibleColor(hslToHex(hue, 15, 15), background, 4.5);
    var primary   = suggestAccessibleColor(hslToHex(hue, 70, 45), background, 3);
    var secondary = suggestAccessibleColor(hslToHex(secondaryHue, 65, 48), background, 3);
    return { primary: primary, secondary: secondary, background: background, text: text, surface: surface };
  }

  function refreshContrastInfo(wrap) {
    var el = wrap.querySelector("#cs-contrast-info");
    if (!el) return;
    var text = wrap.querySelector("#cs-text").value;
    var bg = wrap.querySelector("#cs-bg").value;
    var primary = wrap.querySelector("#cs-primary").value;
    var textRatio = contrastRatio(text, bg);
    var primaryRatio = contrastRatio(primary, bg);
    var textOk = textRatio >= 4.5;
    var primaryOk = primaryRatio >= 3;
    el.innerHTML =
      '<p style="margin:.4rem 0 0;font-size:.82rem">' +
        (textOk ? "✓" : "⚠") + ' Tekst mot bakgrunn: ' + textRatio.toFixed(1) + ':1 ' +
        (textOk ? "(oppfyller WCAG AA-krav på 4.5:1)" : "(under WCAG AA-krav på 4.5:1 for brødtekst)") +
        (textOk ? "" : ' <button type="button" class="btn btn--ghost btn--sm" data-suggest="cs-text" data-suggest-target="4.5" style="padding:.15rem .5rem;font-size:.76rem">Generer forslag</button>') +
      '</p>' +
      '<p style="margin:.2rem 0 0;font-size:.82rem">' +
        (primaryOk ? "✓" : "⚠") + ' Primærfarge mot bakgrunn: ' + primaryRatio.toFixed(1) + ':1 ' +
        (primaryOk ? "(oppfyller WCAG AA-krav på 3:1 for grensesnittelement)" : "(under WCAG AA-krav på 3:1 for grensesnittelement, t.d. knappekantar)") +
        (primaryOk ? "" : ' <button type="button" class="btn btn--ghost btn--sm" data-suggest="cs-primary" data-suggest-target="3" style="padding:.15rem .5rem;font-size:.76rem">Generer forslag</button>') +
      '</p>';
  }

  function saveBtn() {
    return '<div style="display:flex;gap:.6rem;align-items:center;margin-top:1.4rem">' +
      '<button type="submit" class="btn btn--primary">Lagre og bruk</button>' +
    '</div>' +
    '<p class="form__status" id="cs-status" style="margin-top:.6rem"></p>';
  }

  /* =========================================================================
     INNLOGGING  — to steg: e-post → OTP-kode
     ====================================================================== */
  function buildLogin() {
    var app = document.getElementById("console-app");
    if (!_sbControl) {
      app.innerHTML =
        '<div class="cs-login-wrap"><div class="cs-login-box">' +
          '<div class="cs-login-brand"><span class="ti ti-layout-grid"></span> Console</div>' +
          '<p style="color:#c0392b;font-size:.9rem;margin:.8rem 0 0">Supabase ikkje konfigurert — OTP-innlogging krev ein aktiv Supabase-tilkopling.</p>' +
        '</div></div>';
      return;
    }
    renderLoginStep1();
  }

  function renderLoginStep1() {
    var app = document.getElementById("console-app");
    app.innerHTML =
      '<div class="cs-login-wrap">' +
        '<div class="cs-login-box">' +
          '<div class="cs-login-brand"><span class="ti ti-layout-grid"></span> Console</div>' +
          '<p class="cs-login-sub">' + C.esc((CFG.company && CFG.company.name) || "Vibeverk") + '</p>' +
          '<form id="cs-login-form">' +
            C.field({ id: "cs-email", label: "E-postadresse", type: "email", placeholder: "namn@eksempel.no" }) +
            '<p id="cs-login-err" style="font-size:.87rem;min-height:1.2em;margin:.5rem 0 0"></p>' +
            '<button type="submit" class="btn btn--primary" style="width:100%;margin-top:.8rem;justify-content:center">Send eingongskode</button>' +
          '</form>' +
        '</div>' +
      '</div>';

    document.getElementById("cs-login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("cs-email").value.trim().toLowerCase();
      var err   = document.getElementById("cs-login-err");
      if (!email) { err.textContent = "Skriv inn e-postadresse."; err.style.color = "#c0392b"; return; }
      // Ingen e-postliste-sjekk her lenger (Fase 8) — same melding uansett om
      // e-posten er ein reell operatør eller ikkje, sidan shouldCreateUser:false
      // uansett no-oppar trygt for ukjende e-postar. Den faktiske tilgangs-
      // sjekken (operators.status = 'active') skjer FØRST etter OTP-verifisering,
      // sjå renderLoginStep2 — unngår at denne sjekken kan brukast som eit
      // "finst denne e-posten som operatør"-orakel.
      err.textContent = "Sender kode…"; err.style.color = "";
      _sbControl.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } }).then(function (res) {
        if (res.error) { err.textContent = "Feil: " + res.error.message; err.style.color = "#c0392b"; return; }
        _otpEmail = email;
        renderLoginStep2();
      });
    });
    setTimeout(function () { var el = document.getElementById("cs-email"); if (el) el.focus(); }, 50);
  }

  function renderLoginStep2() {
    var app = document.getElementById("console-app");
    app.innerHTML =
      '<div class="cs-login-wrap">' +
        '<div class="cs-login-box">' +
          '<div class="cs-login-brand"><span class="ti ti-layout-grid"></span> Console</div>' +
          '<p class="cs-login-sub">Kode sendt til <strong>' + C.esc(_otpEmail) + '</strong></p>' +
          '<form id="cs-otp-form">' +
            '<div class="field" style="margin-bottom:.5rem">' +
              '<label for="cs-otp">Eingongskode (8 siffer)</label>' +
              '<input id="cs-otp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="8" ' +
                'autocomplete="one-time-code" placeholder="00000000" ' +
                'style="font-size:1.4rem;letter-spacing:.2em;text-align:center">' +
            '</div>' +
            '<p id="cs-otp-err" style="font-size:.87rem;min-height:1.2em;margin:.4rem 0 0"></p>' +
            '<button type="submit" class="btn btn--primary" style="width:100%;margin-top:.8rem;justify-content:center">Logg inn</button>' +
            '<button type="button" id="cs-resend" class="btn btn--ghost" style="width:100%;margin-top:.5rem;justify-content:center;border-radius:999px">Send ny kode</button>' +
            '<button type="button" id="cs-back" class="btn btn--ghost" style="width:100%;margin-top:.4rem;justify-content:center;border-radius:999px;font-size:.85rem;opacity:.7">Anna e-post</button>' +
          '</form>' +
        '</div>' +
      '</div>';

    document.getElementById("cs-otp-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var token = document.getElementById("cs-otp").value.trim();
      var err   = document.getElementById("cs-otp-err");
      err.textContent = "Verifiserer…"; err.style.color = "";
      _sbControl.auth.verifyOtp({ email: _otpEmail, token: token, type: "email" }).then(function (vr) {
        if (vr.error) {
          err.textContent = "Feil kode — prøv igjen."; err.style.color = "#c0392b";
          document.getElementById("cs-otp").value = "";
          document.getElementById("cs-otp").focus();
          return;
        }
        _session = vr.data.session;
        // Den fulle tilgangssjekken (Fase 8): er denne brukaren ein aktiv rad
        // i operators-tabellen i vibeverk-control? Vibeverk-operatøren er
        // ikkje ein kundebrukar og skal ikkje trenge ei rad i denne kundens
        // users-tabell — sjå docs/decisions/ADR-0004 (framleis gyldig
        // resonnement, berre flytta til control-plane-tabellen).
        checkOperatorActive(function (ok) {
          if (!ok) {
            _sbControl.auth.signOut();
            _session = null;
            err.textContent = "Ingen tilgang til Console."; err.style.color = "#c0392b";
            return;
          }
          loadTenants(function () { buildShell(); });
        });
      });
    });
    document.getElementById("cs-resend").addEventListener("click", function () {
      var err = document.getElementById("cs-otp-err");
      err.textContent = "Sender ny kode…"; err.style.color = "";
      _sbControl.auth.signInWithOtp({ email: _otpEmail, options: { shouldCreateUser: false } }).then(function () {
        err.textContent = "Ny kode sendt!"; err.style.color = "#16a34a";
      });
    });
    document.getElementById("cs-back").addEventListener("click", renderLoginStep1);
    setTimeout(function () { var el = document.getElementById("cs-otp"); if (el) el.focus(); }, 50);
  }

  /* =========================================================================
     SHELL
     ====================================================================== */
  function buildShell() {
    if (isAiLabLocalEnvironment() && !_aiLabProbeFinished) {
      _aiLabProbeFinished = true;
      var probeController = new AbortController();
      var probeTimeout = setTimeout(function () { probeController.abort(); }, 1500);
      fetch("/__ai-lab/v1/config", { method: "GET", cache: "no-store", credentials: "omit", signal: probeController.signal })
        .then(function (response) {
          if (!response.ok) throw new Error("AI Lab er ikkje tilgjengeleg");
          return response.json();
        })
        .then(function (config) {
          if (!config || config.apiVersion !== "v1" || !config.csrfToken || !Array.isArray(config.sources)) {
            throw new Error("Ugyldig AI Lab-konfigurasjon");
          }
          _aiLabConfig = config;
        })
        .catch(function () { _aiLabConfig = null; })
        .then(function () { clearTimeout(probeTimeout); buildShell(); });
      return;
    }
    var app = document.getElementById("console-app");
    app.innerHTML =
      '<div class="cs-wrap">' +
        '<aside class="cs-sidebar">' +
          '<button type="button" class="cs-sidebar__collapse-btn" id="cs-sidebar-collapse" title="Minimer sidemeny" aria-label="Minimer sidemeny">' +
            '<span class="ti ti-chevron-left"></span>' +
          '</button>' +
          '<div class="cs-brand"><span class="ti ti-layout-grid"></span> <span class="cs-brand__label">Console</span></div>' +
          '<div class="cs-tenant-picker">' +
            '<select id="cs-tenant-select" title="Vel kunde">' +
              _tenants.filter(function (t) { return t.status !== "archived"; }).map(function (t) {
                return '<option value="' + C.esc(t.id) + '"' + (_activeTenant && t.id === _activeTenant.id ? " selected" : "") + '>' +
                  C.esc(t.slug) + '</option>';
              }).join("") +
            '</select>' +
          '</div>' +
          '<nav class="cs-nav">' +
            (function () {
              function navBtn(n) {
                return '<button type="button" class="cs-nav__item" data-cs-nav="' + n.id + '" title="' + C.esc(n.label) + '">' +
                  '<span class="ti ti-' + n.icon + '"></span> <span class="cs-nav__item-label">' + C.esc(n.label) + '</span></button>';
              }
              var g = shellNavGroups();
              return g.ungrouped.map(navBtn).join("") +
                g.groups.map(function (grp) {
                  return '<div class="cs-nav__group">' +
                    '<div class="cs-nav__group-label">' + C.esc(grp.label) + '</div>' +
                    grp.items.map(navBtn).join("") +
                  '</div>';
                }).join("");
            })() +
          '</nav>' +
          '<div class="cs-sidebar__foot">' +
            '<button type="button" class="cs-logout-btn"><span class="ti ti-logout"></span> Logg ut</button>' +
            '<div class="cs-version" title="Sjå docs/project/CHANGELOG.md for endringshistorikk">Vibeverk v' + C.esc(VIBEVERK_VERSION) + '</div>' +
          '</div>' +
        '</aside>' +
        '<div class="cs-sidebar-overlay" id="cs-sidebar-overlay"></div>' +
        '<main class="cs-main">' +
          '<div class="cs-mobile-bar">' +
            '<button type="button" class="cs-hamburger" id="cs-hamburger" aria-label="Meny"><span class="ti ti-menu-2"></span></button>' +
            '<span class="cs-mobile-bar__brand">Console</span>' +
          '</div>' +
          '<div class="cs-content" id="cs-content"></div>' +
        '</main>' +
      '</div>';

    // Hamburgermeny (mobil) — same av/på-mønster som Workspace sitt
    // .i-hamburger/.i-sidebar-overlay (workspace-core.js buildShell()).
    var csSidebar = document.querySelector(".cs-sidebar");
    var csOverlay = document.getElementById("cs-sidebar-overlay");
    var csHamburger = document.getElementById("cs-hamburger");
    function openCsSidebar() {
      if (csSidebar) csSidebar.classList.add("is-open");
      if (csOverlay) csOverlay.classList.add("is-open");
    }
    function closeCsSidebar() {
      if (csSidebar) csSidebar.classList.remove("is-open");
      if (csOverlay) csOverlay.classList.remove("is-open");
    }
    if (csHamburger) csHamburger.addEventListener("click", openCsSidebar);
    if (csOverlay) csOverlay.addEventListener("click", closeCsSidebar);

    // Minimer sidemeny -- reint visuelt/plasssparande, skil seg frå mobil sin
    // hamburger-open/lukk over (heilt skjult vs. synleg på smale skjermar).
    // Same mønster som Workspace sin .i-sidebar.is-collapsed
    // (workspace-core.js/workspace/index.html), berre persistert via
    // localStorage direkte sidan Console ikkje har App.store (heilt separat
    // app frå den offentlege sida/Workspace). Brukarønske 2026-08-04 --
    // Priser sitt breie kort-rutenett gjorde det tydeleg at den faste
    // 224px-sidemenyen jamt tek meir plass enn ønskeleg.
    var CS_COLLAPSE_KEY = "cs-sidebar-collapsed";
    var csCollapseBtn = document.getElementById("cs-sidebar-collapse");
    function applyCsCollapsed(collapsed) {
      if (!csSidebar) return;
      csSidebar.classList.toggle("is-collapsed", collapsed);
      if (csCollapseBtn) {
        csCollapseBtn.querySelector(".ti").className = "ti ti-" + (collapsed ? "chevron-right" : "chevron-left");
        csCollapseBtn.title = collapsed ? "Vis sidemeny" : "Minimer sidemeny";
        csCollapseBtn.setAttribute("aria-label", csCollapseBtn.title);
      }
    }
    applyCsCollapsed(localStorage.getItem(CS_COLLAPSE_KEY) === "true");
    if (csCollapseBtn) csCollapseBtn.addEventListener("click", function () {
      var next = !csSidebar.classList.contains("is-collapsed");
      applyCsCollapsed(next);
      localStorage.setItem(CS_COLLAPSE_KEY, next ? "true" : "false");
    });

    document.querySelectorAll("[data-cs-nav]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeCsSidebar(); navigate(btn.getAttribute("data-cs-nav")); });
    });
    document.querySelector(".cs-logout-btn").addEventListener("click", logout);
    var tenantSelect = document.getElementById("cs-tenant-select");
    if (tenantSelect) {
      tenantSelect.addEventListener("change", function () {
        var picked = _tenants.filter(function (t) { return t.id === tenantSelect.value; })[0];
        if (picked) { _activeTenant = picked; navigate(activeSection); }
      });
    }
    navigate(activeSection);
  }

  /* =========================================================================
     SEKSJONAR
     ====================================================================== */

  function renderProdukt(sc, wrap) {
    // UX-gjennomgang (2026-07-09): brukte tidlegare CFG.productMode som
    // fallback -- CFG er alltid KONSOLLEN sin eigen, verkelege primærtenant
    // (aldri tenant-skopert), så ein splitter ny tenant synte den VERKELEGE
    // tenanten sin produktmodus som om det var ein nøytral standard. Same
    // feilklasse for alle CFG.*-fallback under (renderWeb/Workspace/
    // Modular/Personvern) -- retta til nøytrale standardverdiar.
    var mode = sc.productMode || "web";
    var opts = [
      { val: "web",       label: "Web",            desc: "Berre offentleg nettside — Workspace er blokkert" },
      { val: "workspace", label: "Workspace",       desc: "Berre Workspace — nettsida visar vidare til /workspace/" },
      { val: "full",      label: "Web + Workspace", desc: "Begge er aktive (standard)" }
    ];
    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Produktpakke</legend>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 1rem">' +
            'Bestemmer kva produkt kunden har tilgang til. Endringa trer i kraft neste gong nettsida eller Workspace vert lasta.' +
          '</p>' +
          opts.map(function (o) {
            return '<label class="cs-radio-label">' +
              '<input type="radio" name="cs-mode" value="' + o.val + '"' + (mode === o.val ? " checked" : "") + '>' +
              '<span><strong>' + C.esc(o.label) + '</strong> — <span style="color:var(--color-muted)">' + C.esc(o.desc) + '</span></span>' +
            '</label>';
          }).join("") +
        '</fieldset>' +
        saveBtn() +
      '</form>';

    wrap.querySelector("#cs-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var checked = wrap.querySelector("input[name='cs-mode']:checked");
      // Fanga FØR getSC() sitt asynkrone kall -- sjå saveSC() sitt notat om
      // kvifor (unngår å skrive til feil tenant viss operatøren byter
      // medan lesinga står ustengt).
      var savingTenantId = _activeTenant && _activeTenant.id;
      getSC(function (sc2) {
        sc2.productMode = checked ? checked.value : "web";
        saveSC(sc2, savingTenantId);
        statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra! Trer i kraft ved neste sideopplasting.", true);
      });
    });
  }

  function renderWeb(sc, wrap) {
    // Fanga NO -- same _renderGen-vaktmønster som renderSection() sitt eige
    // getSC()-kall (sjå kommentaren ved _renderGen), men her for DEI TRE
    // ekstra, asynkrone getStoreKey()-kalla Nettsidehelse-seksjonen under
    // treng (content/faq-items/ref-items). Utan denne vaktar ein operatør
    // som rekk å byte tenant/fane FØR desse kalla svarer, elles risikere at
    // svaret vert skrive inn i eit #cs-nettsidehelse som no høyrer til ein
    // heilt annan seksjon (same element-id vert attbrukt).
    var webRenderGen = _renderGen;

    // Ikkje CFG.colors/company/fonts som fallback -- sjå notatet i
    // renderProdukt. Nøytrale standardverdiar for ein tenant som ikkje har
    // lagra noko enno.
    var col = Object.assign({}, sc.colors  || {});
    var com = Object.assign({}, sc.company || {});
    var fnt = Object.assign({}, sc.fonts   || {});
    var ftr = Object.assign({}, sc.footer  || {});

    // Design-modulen ("sidebygger") gjev no kunden sin EIGEN, direkte
    // skrivetilgang til farge/font (Web-admin sin nye "Design"-fane, same
    // superconfig-nøkkel som HER). saveSC() sender heile det gjeldande
    // superconfig-objektet frå operatøren sitt eige, potensielt eldre
    // nettlesarminne (ikkje ein fersk refetch før lagring) -- lagrar
    // operatøren HER etter at kunden alt har endra farge/font sjølv, vinn
    // operatøren sin eldre kopi. Medvite valt som ei enkel åtvaring i
    // staden for å byggje om alle seks lagre-handterarane til å refetche
    // ferskt (brukar vurderte kollisjonsrisikoen som lita i praksis).
    var sidebyggerWarning = (sc.features && sc.features.sidebygger === true)
      ? '<div class="i-notice i-notice--warn" style="margin-bottom:1rem;padding:.8rem 1rem;border:1.5px solid #E8833A;border-radius:8px;background:color-mix(in srgb,#E8833A 10%,transparent);font-size:.88rem">' +
          '<strong>Denne kunden har Design-modulen aktivert.</strong> Kunden kan sjølv endre farge/font direkte i Web-admin. Ver varsam med å lagre endringar her — di lagring overskriv HEILE fargar/fontar-oppsettet, inkludert eventuelle endringar kunden nyleg har gjort sjølv.' +
        '</div>'
      : "";

    wrap.innerHTML =
      '<form id="cs-form">' +
        sidebyggerWarning +
        '<fieldset class="admin-group"><legend>Firma</legend>' +
          C.field({ id:"cs-name",    label:"Firmanavn",  value: com.name    || "" }) +
          C.field({ id:"cs-orgnr",   label:"Org.nr", value: ftr.orgNr || "", placeholder:"f.eks. 123 456 789",
            help:"Brukast i personvernerklæringa sitt avsnitt om behandlingsansvarleg, og i footer på nettsida. Same felt som kunden sjølv kan redigere i sitt eige adminpanel." }) +
          C.field({ id:"cs-tagline", label:"Tagline",    value: com.tagline || "" }) +
          C.field({ id:"cs-logo",    label:"Logo-URL",   value: com.logoUrl || "", placeholder:"https://…",
            help:"Lim inn ei lenke til ein logo som alt er hosta ein annan stad, ELLER last opp ei fil under." }) +
          '<div class="field" style="margin-top:-.6rem">' +
            '<label>Last opp logo (SVG eller WebP maks 300KB — PNG/JPEG maks 6MB, komprimerast automatisk ned mot 300KB)</label>' +
            '<input type="file" id="cs-logo-file" accept="image/svg+xml,image/png,image/jpeg,image/webp">' +
            '<p class="field__hint" id="cs-logo-upload-status"></p>' +
          '</div>' +
        '</fieldset>' +
        '<fieldset class="admin-group"><legend>SEO og deling</legend>' +
          C.field({ id:"cs-metadesc", label:"Meta-beskrivelse", multiline:true, rows:2,
            value: com.metaDescription || "", placeholder:"Kort beskrivelse, 1–2 setningar",
            help:"Teksten som vises under tittelen i Google-søk. Kort og beskrivende, 1–2 setningar." }) +
          C.field({ id:"cs-ogimage", label:"Delingsbilde (OG-bilde)", value: com.ogImage || "", placeholder:"https://… (1200×630px)",
            help:"Bildet som vises når nokon deler lenka til sida på Facebook, LinkedIn eller andre sosiale medium." }) +
          C.field({ id:"cs-favicon", label:"Favicon-URL", value: com.favicon || "", placeholder:"https://…",
            help:"Det vesle ikonet som vises i nettlesar-fana og bokmerke. Står dette tomt, vert Logo-URL brukt automatisk." }) +
        '</fieldset>' +
        '<fieldset class="admin-group" id="cs-nettsidehelse"><legend>Nettsidehelse</legend><p class="prose prose--muted" style="font-size:.85rem;margin:0">Lastar nettsidehelse …</p></fieldset>' +
        '<fieldset class="admin-group"><legend>Fargar</legend>' +
          '<div style="margin:0 0 .9rem">' +
            '<button type="button" class="btn btn--ghost btn--sm" id="cs-palette-generate">🎨 Generer fargepalett</button>' +
            '<p class="field__hint">Set saman eit heilt fargeforslag (primær, sekundær, bakgrunn, tekst, overflate) som oppfyller WCAG AA-kontrastkrava. Klikk gjerne fleire gongar for ulike forslag. Ingenting vert lagra før du trykkjer «Lagre og bruk».</p>' +
          '</div>' +
          '<div class="bk-2col">' +
            colorField("cs-primary",   "Primærfarge",   col.primary   || "#1a7a6e", "Knappar, lenker og aktive element") +
            colorField("cs-secondary", "Sekundærfarge", col.secondary || "#c17f3e", "CTA-knappar og uthevingar") +
          '</div>' +
          colorField("cs-bg", "Bakgrunnsfarge", col.background || "#fbfaf8", "Sideflata bak alt innhald") +
          '<div class="bk-2col">' +
            colorField("cs-text",    "Tekstfarge", col.text    || "#1B1B1F", "Hovudtekst og overskrifter") +
            colorField("cs-surface", "Overflate",  col.surface || "#ffffff", "Kort, modalar og paneler") +
          '</div>' +
          '<div id="cs-contrast-info"></div>' +
          '<div class="field" style="margin-top:.8rem">' +
            '<label>Hjørne-radius</label>' +
            '<select id="cs-radius">' +
              '<option value="0">Skarpe hjørner</option>' +
              '<option value="8">Litt runde</option>' +
              '<option value="14">Standard</option>' +
              '<option value="24">Runde</option>' +
            '</select>' +
            '<p class="field__hint">Styrer avrundinga på kort og bilete i heile nettstaden. Knappar er runde (pill-form) på Standard og Runde, og vert litt firkanta på Skarpe hjørner og Litt runde.</p>' +
          '</div>' +
        '</fieldset>' +
        '<fieldset class="admin-group"><legend>Fontar</legend>' +
          '<div class="fontpair-row">' +
            FONT_PAIRS.map(function (p, i) {
              return '<button type="button" class="fontpair-btn" data-pair="' + i + '">' + C.esc(p.label) + '</button>';
            }).join("") +
          '</div>' +
          '<div class="bk-2col">' +
            C.field({ id:"cs-dfont",    label:"Display-font",    value: fnt.display || "", placeholder:"Syne" }) +
            C.field({ id:"cs-dweights", label:"Weights (komma)", value: (fnt.weights && fnt.weights.display ? fnt.weights.display.join(",") : "600,700,800"), hint:"For overskrifter" }) +
          '</div>' +
          fontPreviewMarkup("cs-dfont-preview") +
          '<div class="bk-2col" style="margin-top:.8rem">' +
            C.field({ id:"cs-bfont",    label:"Brødtekst-font",  value: fnt.body || "", placeholder:"Inter" }) +
            C.field({ id:"cs-bweights", label:"Weights (komma)", value: (fnt.weights && fnt.weights.body ? fnt.weights.body.join(",") : "400,500,600"), hint:"For brødtekst" }) +
          '</div>' +
          fontPreviewMarkup("cs-bfont-preview") +
          '<div style="margin-top:.5rem">' +
            '<button type="button" class="btn btn--ghost btn--sm" id="cs-web-reset">↺ Nullstill fargar og fontar til standard</button>' +
          '</div>' +
        '</fieldset>' +
        saveBtn() +
      '</form>';

    bindFontPreview("cs-dfont", "cs-dweights", "cs-dfont-preview");
    bindFontPreview("cs-bfont", "cs-bweights", "cs-bfont-preview");

    refreshFontPairActive(wrap, "cs-dfont", "cs-bfont", "data-pair");
    ["cs-dfont", "cs-bfont"].forEach(function (id) {
      wrap.querySelector("#" + id).addEventListener("input", function () {
        refreshFontPairActive(wrap, "cs-dfont", "cs-bfont", "data-pair");
      });
    });

    wrap.querySelector("#cs-radius").value = String(col.radius != null ? col.radius : 14);

    refreshContrastInfo(wrap);
    ["cs-text", "cs-bg", "cs-primary"].forEach(function (id) {
      wrap.querySelector("#" + id).addEventListener("input", function () { refreshContrastInfo(wrap); });
    });
    wrap.querySelector("#cs-palette-generate").addEventListener("click", function () {
      var palette = generateThemePalette();
      wrap.querySelector("#cs-primary").value   = palette.primary;
      wrap.querySelector("#cs-secondary").value = palette.secondary;
      wrap.querySelector("#cs-bg").value        = palette.background;
      wrap.querySelector("#cs-text").value      = palette.text;
      wrap.querySelector("#cs-surface").value   = palette.surface;
      refreshContrastInfo(wrap);
    });
    // Delegert lyttar -- overlever at refreshContrastInfo() byggjer #cs-contrast-info
    // sitt innhald (inkl. "Generer forslag"-knappane) på nytt kvar gong.
    wrap.querySelector("#cs-contrast-info").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-suggest]");
      if (!btn) return;
      var fieldId = btn.getAttribute("data-suggest");
      var target  = parseFloat(btn.getAttribute("data-suggest-target"));
      var bg = wrap.querySelector("#cs-bg").value;
      var fg = wrap.querySelector("#" + fieldId).value;
      wrap.querySelector("#" + fieldId).value = suggestAccessibleColor(fg, bg, target);
      refreshContrastInfo(wrap);
    });

    // Logo-filopplasting -- går via broker sin upload_logo-handling (kryssar
    // inn i KUNDEN sitt eige Storage-prosjekt via service_role, same mønster
    // som set_config). Klientsjekkane under er berre rask UX-tilbakemelding;
    // den faktiske handhevinga (filtype/storleik/SVG-sanering) skjer i
    // broker-funksjonen sjølv, sjå supabase-control/supabase/functions/broker.
    (function () {
      var fileInput = wrap.querySelector("#cs-logo-file");
      var statusEl  = wrap.querySelector("#cs-logo-upload-status");
      var ALLOWED_TYPES = { "image/svg+xml": 1, "image/png": 1, "image/jpeg": 1, "image/webp": 1 };
      // PNG/JPEG vert automatisk komprimert av broker-funksjonen ned mot
      // 300KB om dei er større -- difor kan klienten tillate ei mykje større
      // rå fil for desse to. SVG (tekst, ingen komprimering) og WebP (kan
      // ikkje dekodast/komprimerast av biletbiblioteket broker brukar) held
      // fram med 300KB som absolutt tak, uendra.
      var COMPRESSIBLE_TYPES = { "image/png": 1, "image/jpeg": 1 };
      var MAX_BYTES = 300 * 1024;
      var RAW_MAX_BYTES = 6 * 1024 * 1024;
      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        if (!ALLOWED_TYPES[file.type]) {
          statusEl.textContent = "Filtypen er ikkje støtta. Bruk SVG, PNG, JPEG eller WebP.";
          fileInput.value = "";
          return;
        }
        var ceiling = COMPRESSIBLE_TYPES[file.type] ? RAW_MAX_BYTES : MAX_BYTES;
        if (file.size > ceiling) {
          statusEl.textContent = "Fila er for stor (maks " + Math.round(ceiling / 1024) + "KB).";
          fileInput.value = "";
          return;
        }
        statusEl.textContent = file.size > MAX_BYTES ? "Lastar opp og komprimerer …" : "Lastar opp …";
        var reader = new FileReader();
        reader.onerror = function () { statusEl.textContent = "Kunne ikkje lese fila."; };
        reader.onload = function () {
          var base64 = String(reader.result).split(",")[1] || "";
          var oldLogoUrl = wrap.querySelector("#cs-logo").value.trim();
          brokerCall("upload_logo", { file_base64: base64, content_type: file.type, old_logo_url: oldLogoUrl }, function (r) {
            if (r.error) { statusEl.textContent = "Opplasting feila: " + r.error; return; }
            wrap.querySelector("#cs-logo").value = r.url;
            statusEl.textContent = "✓ Lasta opp! Hugs å trykkje «Lagre og bruk» for å ta han i bruk.";
            fileInput.value = "";
          });
        };
        reader.readAsDataURL(file);
      });
    })();

    wrap.querySelectorAll("[data-pair]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = FONT_PAIRS[parseInt(btn.getAttribute("data-pair"), 10)];
        if (!p) return;
        wrap.querySelector("#cs-dfont").value    = p.display;
        wrap.querySelector("#cs-bfont").value    = p.body;
        wrap.querySelector("#cs-dweights").value = "600,700,800";
        wrap.querySelector("#cs-bweights").value = "400,500,600";
        refreshFontPreview("cs-dfont", "cs-dweights", "cs-dfont-preview");
        refreshFontPreview("cs-bfont", "cs-bweights", "cs-bfont-preview");
        refreshFontPairActive(wrap, "cs-dfont", "cs-bfont", "data-pair");
      });
    });

    wrap.querySelector("#cs-web-reset").addEventListener("click", function () {
      // Same feilklasse som resten av CFG.*-fallback i denne fila (sjå
      // renderProdukt sitt notat): "Nullstill til standard" skal gje ein
      // FAST, nøytral standard -- ikkje kopiere KONSOLLEN sin eigen
      // verkelege primærtenant sine live-verdiar via CFG.
      wrap.querySelector("#cs-primary").value   = "#005cff";
      wrap.querySelector("#cs-secondary").value = "#ff7a00";
      wrap.querySelector("#cs-bg").value        = "#f7fbff";
      wrap.querySelector("#cs-text").value      = "#142033";
      wrap.querySelector("#cs-surface").value   = "#ffffff";
      wrap.querySelector("#cs-radius").value    = "14";
      wrap.querySelector("#cs-dfont").value     = "Poppins";
      wrap.querySelector("#cs-bfont").value     = "Nunito Sans";
      wrap.querySelector("#cs-dweights").value  = "600,700,800";
      wrap.querySelector("#cs-bweights").value  = "400,500,600";
      refreshFontPreview("cs-dfont", "cs-dweights", "cs-dfont-preview");
      refreshFontPreview("cs-bfont", "cs-bweights", "cs-bfont-preview");
      refreshFontPairActive(wrap, "cs-dfont", "cs-bfont", "data-pair");
      refreshContrastInfo(wrap);
    });

    wrap.querySelector("#cs-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var savingTenantId = _activeTenant && _activeTenant.id;
      getSC(function (sc2) {
        sc2.company = {
          name:            wrap.querySelector("#cs-name").value.trim(),
          tagline:         wrap.querySelector("#cs-tagline").value.trim(),
          logoUrl:         wrap.querySelector("#cs-logo").value.trim(),
          metaDescription: wrap.querySelector("#cs-metadesc").value.trim(),
          ogImage:         wrap.querySelector("#cs-ogimage").value.trim(),
          favicon:         wrap.querySelector("#cs-favicon").value.trim()
        };
        // Berre orgNr endra her -- resten av footer (invoiceEmail/invoiceAddress/
        // extraLines/copyright) er kunden sitt eige felt via lokalt adminpanel,
        // ikkje synleg i denne Console-fana. sc2 er nyleg henta av getSC() over,
        // så sc2.footer har alt kunden sine eksisterande verdiar -- her held vi
        // dei urørte og legg berre inn/overskriv orgNr.
        sc2.footer = Object.assign({}, sc2.footer || {}, { orgNr: wrap.querySelector("#cs-orgnr").value.trim() });
        sc2.colors = {
          primary:    wrap.querySelector("#cs-primary").value,
          secondary:  wrap.querySelector("#cs-secondary").value,
          background: wrap.querySelector("#cs-bg").value,
          text:       wrap.querySelector("#cs-text").value,
          surface:    wrap.querySelector("#cs-surface").value,
          radius:     parseInt(wrap.querySelector("#cs-radius").value, 10)
        };
        sc2.fonts = {
          display: wrap.querySelector("#cs-dfont").value.trim(),
          body:    wrap.querySelector("#cs-bfont").value.trim(),
          weights: {
            display: wrap.querySelector("#cs-dweights").value.split(",").map(function (w) { return parseInt(w.trim(), 10); }).filter(Boolean),
            body:    wrap.querySelector("#cs-bweights").value.split(",").map(function (w) { return parseInt(w.trim(), 10); }).filter(Boolean)
          }
        };
        saveSC(sc2, savingTenantId);
        statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra! Endringane er aktive ved neste sideopplasting.", true);
      });
    });

    // Nettsidehelse (2026-07-27) -- same regelbaserte sjekk som Web-admin sin
    // Design → SEO-fane (core.js sin computeWebsiteHealth()/
    // renderNettsidehelseSection()), no attbrukt her slik at ein operatør kan
    // køyre han for KVA SOM HELST tenant uavhengig av om DEN tenanten sjølv
    // har feat("sidebygger") -- sjå docs/architecture/website-health-scoring.md.
    // superconfig (sc) er alt henta synkront av kallaren; content/faq-items/
    // ref-items må hentast ekstra her, tenant-skopa via getStoreKey().
    (function () {
      var pending = 3;
      var fetched = { content: {}, faqItems: [], refItems: [] };
      function done() {
        pending--;
        if (pending > 0) return;
        if (webRenderGen !== _renderGen) return; // sjå notatet ved webRenderGen over
        var target = wrap.querySelector("#cs-nettsidehelse");
        if (!target) return;
        var ct = Object.assign({ hero: {}, about: {}, contact: {}, footer: {}, services: [] }, fetched.content);
        var enabledModules = {
          faq:        !(sc.features && sc.features.faq        === false),
          referanser: !(sc.features && sc.features.references === false)
        };
        target.innerHTML = "<legend>Nettsidehelse</legend>" + window.App.renderNettsidehelseSection({
          skipHeading:    true, // legenden over ER tittelen -- sjå notatet ved renderNettsidehelseSection()
          superconfig:    sc,
          content:        ct,
          enabledModules: enabledModules,
          faqItems:       fetched.faqItems,
          refItems:       fetched.refItems,
          privacyText:    (sc.privacy && sc.privacy.text) || ""
        });
      }
      getStoreKey("content", function (v) { fetched.content = v || {}; done(); });
      getStoreKey("faq-items", function (v) { fetched.faqItems = (v && v.length !== undefined) ? v : []; done(); });
      getStoreKey("ref-items", function (v) { fetched.refItems = (v && v.length !== undefined) ? v : []; done(); });
    })();
  }

  function renderWorkspace(sc, wrap) {
    // Berre tilgjengeleg når Workspace er aktivert
    if (sc.productMode === "web") {
      wrap.innerHTML =
        '<div style="min-height:40vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem">' +
          '<div style="max-width:340px">' +
            '<span class="ti ti-briefcase-off" style="font-size:3rem;color:var(--color-muted)"></span>' +
            '<h2 style="margin:.8rem 0 .5rem;font-size:1.3rem">Workspace er ikkje aktivert</h2>' +
            '<p style="color:var(--color-muted);margin:0 0 1.4rem;font-size:.9rem">Aktiver Workspace i Produkt-seksjonen for å konfigurere tema og innstillingar.</p>' +
            '<button type="button" class="btn btn--primary" data-goto-produkt>Gå til Produkt</button>' +
          '</div>' +
        '</div>';
      wrap.querySelector("[data-goto-produkt]").addEventListener("click", function () { navigate("produkt"); });
      return;
    }

    // Ikkje CFG.workspace/colors/fonts som fallback -- sjå notatet i
    // renderProdukt. Feltnivå-standardverdiane under dekkjer det tomme
    // tilfellet.
    var wsp    = Object.assign({}, sc.workspace || {});
    var wspCol = Object.assign({}, wsp.colors || {});
    var wspFnt = Object.assign({}, wsp.fonts  || {});
    var pri    = (wsp.colors && wsp.colors.primary) || wsp.accentColor || wspCol.primary || "#2563eb";

    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Identitet</legend>' +
          '<label class="cs-checkbox-label" style="margin-bottom:.6rem">' +
            '<input type="checkbox" id="cs-wsp-use-name"' + (wsp.name ? " checked" : "") + '> ' +
            'Bruk eige namn for arbeidsområdet (i staden for bedriftsnamnet)' +
          '</label>' +
          '<div id="cs-wsp-name-wrap" style="' + (wsp.name ? "" : "display:none") + '">' +
            C.field({ id:"cs-wsp-name", label:"Arbeidsområdenamn", value: wsp.name || "", placeholder:"T.d. eit kallenamn" }) +
          '</div>' +
          '<p style="font-size:.78rem;color:var(--color-muted);margin:.5rem 0 0">Dette valet vinn alltid over kunden si eiga "Bedriftsnavn"-innstilling i Workspace → Innstillingar, når det er aktivert her.</p>' +
        '</fieldset>' +
        '<fieldset class="admin-group"><legend>Fargar</legend>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Desse fargane gjeld berre Workspace — uavhengig av nettside-tema.</p>' +
          '<div style="margin:0 0 .8rem">' +
            '<button type="button" class="btn btn--ghost btn--sm" id="cs-wsp-mirror-web">⇄ Speil nettside</button>' +
            '<p class="field__hint">Kopierer fargane og fontane som er lagra på Web-fana inn i felta under. Kan endrast fritt etterpå — ingenting vert lagra før du trykkjer «Lagre».</p>' +
          '</div>' +
          '<div class="bk-2col">' +
            colorField("cs-wsp-primary",   "Primærfarge",   pri,                      "Knappar, lenker og aktive element") +
            colorField("cs-wsp-secondary", "Sekundærfarge", wspCol.secondary || "#7c3aed", "CTA-knappar og uthevingar") +
          '</div>' +
          colorField("cs-wsp-bg", "Bakgrunnsfarge", wspCol.background || "#f1f5f9", "Sideflata bak alt Workspace-innhald") +
          '<div class="bk-2col">' +
            colorField("cs-wsp-text",    "Tekstfarge", wspCol.text    || "#0f172a", "Hovudtekst og overskrifter") +
            colorField("cs-wsp-surface", "Overflate",  wspCol.surface || "#ffffff", "Kort, modalar og paneler") +
          '</div>' +
          colorField("cs-wsp-muted", "Sekundærtekst", wspCol.muted || "#64748b", "Dempet tekst, seksjonsoverskrifter og etiketter") +
        '</fieldset>' +
        '<fieldset class="admin-group"><legend>Fontar</legend>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Tomt = arvar frå nettside-tema.</p>' +
          '<div class="fontpair-row">' +
            FONT_PAIRS.map(function (p, i) {
              return '<button type="button" class="fontpair-btn" data-wsp-pair="' + i + '">' + C.esc(p.label) + '</button>';
            }).join("") +
          '</div>' +
          '<div class="bk-2col">' +
            C.field({ id:"cs-wsp-dfont",    label:"Display-font",    value: wspFnt.display || "", placeholder:"Tomt = same som nettsida" }) +
            C.field({ id:"cs-wsp-dweights", label:"Weights (komma)", value: (wspFnt.weights && wspFnt.weights.display ? wspFnt.weights.display.join(",") : "600,700,800"), hint:"For overskrifter" }) +
          '</div>' +
          fontPreviewMarkup("cs-wsp-dfont-preview") +
          '<div class="bk-2col" style="margin-top:.8rem">' +
            C.field({ id:"cs-wsp-bfont",    label:"Brødtekst-font",  value: wspFnt.body || "", placeholder:"Tomt = same som nettsida" }) +
            C.field({ id:"cs-wsp-bweights", label:"Weights (komma)", value: (wspFnt.weights && wspFnt.weights.body ? wspFnt.weights.body.join(",") : "400,500,600"), hint:"For brødtekst" }) +
          '</div>' +
          fontPreviewMarkup("cs-wsp-bfont-preview") +
          '<div style="margin-top:.5rem">' +
            '<button type="button" class="btn btn--ghost btn--sm" id="cs-wsp-reset">↺ Nullstill fargar og fontar til standard</button>' +
          '</div>' +
        '</fieldset>' +
        saveBtn() +
      '</form>';

    wrap.querySelector("#cs-wsp-use-name").addEventListener("change", function () {
      wrap.querySelector("#cs-wsp-name-wrap").style.display = this.checked ? "" : "none";
    });

    bindFontPreview("cs-wsp-dfont", "cs-wsp-dweights", "cs-wsp-dfont-preview");
    bindFontPreview("cs-wsp-bfont", "cs-wsp-bweights", "cs-wsp-bfont-preview");

    refreshFontPairActive(wrap, "cs-wsp-dfont", "cs-wsp-bfont", "data-wsp-pair");
    ["cs-wsp-dfont", "cs-wsp-bfont"].forEach(function (id) {
      wrap.querySelector("#" + id).addEventListener("input", function () {
        refreshFontPairActive(wrap, "cs-wsp-dfont", "cs-wsp-bfont", "data-wsp-pair");
      });
    });

    wrap.querySelectorAll("[data-wsp-pair]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = FONT_PAIRS[parseInt(btn.getAttribute("data-wsp-pair"), 10)];
        if (!p) return;
        wrap.querySelector("#cs-wsp-dfont").value    = p.display;
        wrap.querySelector("#cs-wsp-bfont").value    = p.body;
        wrap.querySelector("#cs-wsp-dweights").value = "600,700,800";
        wrap.querySelector("#cs-wsp-bweights").value = "400,500,600";
        refreshFontPreview("cs-wsp-dfont", "cs-wsp-dweights", "cs-wsp-dfont-preview");
        refreshFontPreview("cs-wsp-bfont", "cs-wsp-bweights", "cs-wsp-bfont-preview");
        refreshFontPairActive(wrap, "cs-wsp-dfont", "cs-wsp-bfont", "data-wsp-pair");
      });
    });

    wrap.querySelector("#cs-wsp-mirror-web").addEventListener("click", function () {
      var webCol = sc.colors || {};
      var webFnt = sc.fonts  || {};
      if (!webCol.primary && !webFnt.display) {
        alert("Nettsida har ikkje lagra fargar/fontar enno — gå til Web-fana og lagre først.");
        return;
      }
      wrap.querySelector("#cs-wsp-primary").value   = webCol.primary    || "#2563eb";
      wrap.querySelector("#cs-wsp-secondary").value = webCol.secondary  || "#7c3aed";
      wrap.querySelector("#cs-wsp-bg").value        = webCol.background || "#f1f5f9";
      wrap.querySelector("#cs-wsp-text").value      = webCol.text      || "#0f172a";
      wrap.querySelector("#cs-wsp-surface").value   = webCol.surface   || "#ffffff";
      wrap.querySelector("#cs-wsp-dfont").value     = webFnt.display   || "";
      wrap.querySelector("#cs-wsp-bfont").value     = webFnt.body      || "";
      wrap.querySelector("#cs-wsp-dweights").value  = (webFnt.weights && webFnt.weights.display ? webFnt.weights.display.join(",") : "600,700,800");
      wrap.querySelector("#cs-wsp-bweights").value  = (webFnt.weights && webFnt.weights.body    ? webFnt.weights.body.join(",")    : "400,500,600");
      refreshFontPreview("cs-wsp-dfont", "cs-wsp-dweights", "cs-wsp-dfont-preview");
      refreshFontPreview("cs-wsp-bfont", "cs-wsp-bweights", "cs-wsp-bfont-preview");
      refreshFontPairActive(wrap, "cs-wsp-dfont", "cs-wsp-bfont", "data-wsp-pair");
    });

    wrap.querySelector("#cs-wsp-reset").addEventListener("click", function () {
      wrap.querySelector("#cs-wsp-primary").value   = "#2563eb";
      wrap.querySelector("#cs-wsp-secondary").value = "#7c3aed";
      wrap.querySelector("#cs-wsp-bg").value        = "#f1f5f9";
      wrap.querySelector("#cs-wsp-text").value      = "#0f172a";
      wrap.querySelector("#cs-wsp-surface").value   = "#ffffff";
      wrap.querySelector("#cs-wsp-muted").value     = "#64748b";
      wrap.querySelector("#cs-wsp-dfont").value     = "";
      wrap.querySelector("#cs-wsp-bfont").value     = "";
      wrap.querySelector("#cs-wsp-dweights").value  = "600,700,800";
      wrap.querySelector("#cs-wsp-bweights").value  = "400,500,600";
      refreshFontPreview("cs-wsp-dfont", "cs-wsp-dweights", "cs-wsp-dfont-preview");
      refreshFontPreview("cs-wsp-bfont", "cs-wsp-bweights", "cs-wsp-bfont-preview");
      refreshFontPairActive(wrap, "cs-wsp-dfont", "cs-wsp-bfont", "data-wsp-pair");
    });

    wrap.querySelector("#cs-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var primary = wrap.querySelector("#cs-wsp-primary").value;
      var useCustomName = wrap.querySelector("#cs-wsp-use-name").checked;
      var savingTenantId = _activeTenant && _activeTenant.id;
      getSC(function (sc2) {
        sc2.workspace = Object.assign({}, sc2.workspace || {}, {
          name:        useCustomName ? wrap.querySelector("#cs-wsp-name").value.trim() : "",
          accentColor: primary,
          colors: {
            primary:    primary,
            secondary:  wrap.querySelector("#cs-wsp-secondary").value,
            background: wrap.querySelector("#cs-wsp-bg").value,
            text:       wrap.querySelector("#cs-wsp-text").value,
            surface:    wrap.querySelector("#cs-wsp-surface").value,
            muted:      wrap.querySelector("#cs-wsp-muted").value
          },
          fonts: {
            display: wrap.querySelector("#cs-wsp-dfont").value.trim(),
            body:    wrap.querySelector("#cs-wsp-bfont").value.trim(),
            weights: {
              display: wrap.querySelector("#cs-wsp-dweights").value.split(",").map(function (w) { return parseInt(w.trim(), 10); }).filter(Boolean),
              body:    wrap.querySelector("#cs-wsp-bweights").value.split(",").map(function (w) { return parseInt(w.trim(), 10); }).filter(Boolean)
            }
          }
        });
        saveSC(sc2, savingTenantId);
        statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra! Trer i kraft ved neste Workspace-opplasting.", true);
      });
    });
  }

  function featureDefaults(labels) {
    var d = {};
    Object.keys(labels).forEach(function (k) { d[k] = !OPT_IN_FEATURES[k]; });
    return d;
  }

  // Modul-id-format for skreddarsydde modular -- same mønster som slug/
  // hostname andre stader i denne fila, og same regex som server-sida
  // (set_custom_modules_manifest i tenant-admin) handhevar, sidan desse
  // id-ane er meint å til slutt matche module-custom-<kunde>-<id>.js-namn.
  var CUSTOM_MODULE_ID_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

  function customModuleCardHtml(id, m) {
    m = m || { label: "", enabled: false, params: {} };
    var paramsJson = JSON.stringify(m.params || {}, null, 2);
    return '<div class="admin-group" style="margin-bottom:.8rem">' +
      '<form class="cs-cm-form" data-cm-id="' + C.esc(id) + '">' +
        '<p style="font-size:.78rem;color:var(--color-muted);margin:0 0 .5rem">Modul-id: <code>' + C.esc(id) + '</code></p>' +
        C.field({ id: "cm-label-" + id, label: "Namn", value: m.label || "" }) +
        '<label class="cs-checkbox-label" style="display:block;margin:.5rem 0">' +
          '<input type="checkbox" id="cm-enabled-' + C.esc(id) + '"' + (m.enabled ? " checked" : "") + '> Aktivert' +
        '</label>' +
        '<div class="field"><label for="cm-params-' + C.esc(id) + '">Innstillingar (JSON)</label>' +
          '<textarea id="cm-params-' + C.esc(id) + '" rows="5" style="width:100%;font-family:monospace;font-size:.82rem;padding:.5rem;border-radius:8px;border:1.5px solid var(--color-border);background:var(--color-bg);color:var(--color-text)">' +
            C.esc(paramsJson) +
          '</textarea>' +
          '<p class="field__hint">Fritt JSON-format -- kvart skreddarsydd modul har sin eigen form her. Lat stå <code>{}</code> om modulet ikkje treng innstillingar enno.</p>' +
        '</div>' +
        (_activeTenant && _activeTenant.status === "active"
          ? '<p style="font-size:.78rem;color:#c0392b;margin:.4rem 0">⚠️ Kunden er aktiv — dette kan slå PÅ/AV innhald synleg for besøkjande UMIDDELBART når du lagrar. Sjekk at det er tilsikta før du lagrar.</p>'
          : '<p class="field__hint">Kunden er ikkje aktiv enno -- endringar her har ingen synleg effekt før aktivering.</p>') +
        '<div style="display:flex;gap:.6rem;align-items:center;margin-top:.4rem">' +
          '<button type="submit" class="btn btn--ghost btn--sm">Lagre</button>' +
          '<button type="button" class="btn btn--ghost btn--sm cs-cm-remove" data-cm-id="' + C.esc(id) + '" style="color:#c0392b;border-color:#c0392b;margin-left:auto">Fjern</button>' +
        '</div>' +
        '<p class="form__status" id="cm-status-' + C.esc(id) + '" style="margin-top:.4rem"></p>' +
      '</form>' +
    '</div>';
  }

  function renderModular(sc, wrap) {
    var ft  = Object.assign(featureDefaults(FEAT_LABELS),  sc.features         || {});
    var ift = Object.assign(featureDefaults(IFEAT_LABELS), sc.intranettFeatures || {});
    var customModules = (_activeTenant && _activeTenant.custom_modules_manifest) || {};
    var customIds = Object.keys(customModules);

    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Nettside</legend>' +
          checkboxGrid(ft, FEAT_LABELS, "cs-feat", FEAT_HELP) +
        '</fieldset>' +
        '<fieldset class="admin-group" style="margin-top:.8rem"><legend>Workspace</legend>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Dashboard, Oppgåver og Innstillingar er alltid på og visast ikkje her.</p>' +
          checkboxGrid(ift, IFEAT_LABELS, "cs-ifeat", IFEAT_HELP) +
        '</fieldset>' +
        saveBtn() +
      '</form>' +
      '<fieldset class="admin-group" style="margin-top:.8rem"><legend>Skreddarsydde modular</legend>' +
        '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Spesialbygde tilleggsmodular for denne kunden (bein 3, sjå docs/STRATEGY.md).</p>' +
        (customIds.length === 0
          ? '<p style="font-size:.85rem;color:var(--color-muted);margin:0 0 .8rem">Ingen skreddarsydde modular for denne kunden enno.</p>'
          : customIds.map(function (id) { return customModuleCardHtml(id, customModules[id]); }).join("")) +
        '<div class="admin-group" style="border-style:dashed">' +
          '<strong style="font-size:.85rem">Legg til ny modul</strong>' +
          '<form id="cs-cm-add-form" style="margin-top:.6rem">' +
            C.field({ id: "cm-new-id", label: "Modul-id", placeholder: "t.d. vaktplan (berre små bokstavar, tal og bindestrek)" }) +
            C.field({ id: "cm-new-label", label: "Namn", placeholder: "t.d. Vaktplan" }) +
            '<button type="submit" class="btn btn--ghost btn--sm">Legg til</button>' +
            '<p class="form__status" id="cm-add-status" style="margin-top:.4rem"></p>' +
          '</form>' +
        '</div>' +
      '</fieldset>';

    wrap.querySelector("#cs-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var feats = {}, ifeats = {};
      wrap.querySelectorAll("[data-cs-feat]").forEach(function (cb)  { feats[cb.getAttribute("data-cs-feat")]   = cb.checked; });
      wrap.querySelectorAll("[data-cs-ifeat]").forEach(function (cb) { ifeats[cb.getAttribute("data-cs-ifeat")] = cb.checked; });
      var savingTenantId = _activeTenant && _activeTenant.id;
      getSC(function (sc2) {
        sc2.features = feats;
        sc2.intranettFeatures = ifeats;
        saveSC(sc2, savingTenantId);
        statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra! Trer i kraft ved neste sideopplasting.", true);
      });
    });

    // Skreddarsydde modular -- kvart kort lagrar/fjernar seg sjølv via
    // set_custom_modules_manifest (heile-blob-erstatning, sjå Arkitekt-notatet
    // i tenant-admin/index.ts). Oppdaterer _activeTenant.custom_modules_manifest
    // direkte i minnet på suksess i staden for å kalle loadTenants() -- den
    // funksjonen nullstiller _activeTenant til den fyrste veljelege tenanten
    // i lista, noko som ville bytt Console sin heile "gjeldande kunde" utan
    // varsel om kalla herifrå.
    wrap.querySelectorAll(".cs-cm-form").forEach(function (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var id = form.getAttribute("data-cm-id");
        var statusEl = wrap.querySelector("#cm-status-" + id);
        var label = wrap.querySelector("#cm-label-" + id).value.trim();
        var enabled = wrap.querySelector("#cm-enabled-" + id).checked;
        var paramsRaw = wrap.querySelector("#cm-params-" + id).value;
        if (!label) { statusMsg(statusEl, "Namn er påkravd.", false); return; }
        var params;
        try {
          params = JSON.parse(paramsRaw);
        } catch (parseErr) {
          statusMsg(statusEl, "Innstillingane er ikkje gyldig JSON-format — sjekk for manglande komma eller anførselsteikn.", false);
          return;
        }
        if (params === null || typeof params !== "object" || Array.isArray(params)) {
          statusMsg(statusEl, "Innstillingane må vere eit JSON-objekt, t.d. {}", false);
          return;
        }
        statusMsg(statusEl, "Lagrar…", true);
        var newManifest = Object.assign({}, _activeTenant.custom_modules_manifest || {});
        newManifest[id] = { label: label, enabled: enabled, params: params };
        tenantAdminCall("set_custom_modules_manifest", { tenant_id: _activeTenant.id, manifest: newManifest }, function (r) {
          if (r.error) { statusMsg(statusEl, r.error, false); return; }
          _activeTenant.custom_modules_manifest = newManifest;
          statusMsg(statusEl, "✓ Lagra!", true);
        });
      });
    });

    wrap.querySelectorAll(".cs-cm-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-cm-id");
        var statusEl = wrap.querySelector("#cm-status-" + id);
        var m = (_activeTenant.custom_modules_manifest || {})[id] || {};
        var liveWarning = (_activeTenant.status === "active" && m.enabled)
          ? " Denne modulen er PÅ og synleg for besøkjande no — han forsvinn frå nettsida med det same du fjernar han her."
          : "";
        if (!confirm('Fjerne modulen «' + (m.label || id) + '» heilt? Alt innhald i han (innstillingane) går tapt og må skrivast inn på nytt om han skal leggjast til igjen.' + liveWarning + ' Dette påverkar ikkje andre modular eller resten av kunden sitt oppsett. Kan ikkje angrast. Er du sikker?')) return;
        statusMsg(statusEl, "Fjernar…", true);
        var newManifest = Object.assign({}, _activeTenant.custom_modules_manifest || {});
        delete newManifest[id];
        tenantAdminCall("set_custom_modules_manifest", { tenant_id: _activeTenant.id, manifest: newManifest }, function (r) {
          if (r.error) { statusMsg(statusEl, "Feil: " + r.error, false); return; }
          _activeTenant.custom_modules_manifest = newManifest;
          renderModular(sc, wrap);
        });
      });
    });

    wrap.querySelector("#cs-cm-add-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var statusEl = wrap.querySelector("#cm-add-status");
      var id = wrap.querySelector("#cm-new-id").value.trim().toLowerCase();
      var label = wrap.querySelector("#cm-new-label").value.trim();
      if (!label) { statusMsg(statusEl, "Namn er påkravd.", false); return; }
      if (!CUSTOM_MODULE_ID_RE.test(id)) {
        statusMsg(statusEl, "Ugyldig modul-id (berre små bokstavar, tal og bindestrek).", false);
        return;
      }
      var existing = _activeTenant.custom_modules_manifest || {};
      if (existing[id]) { statusMsg(statusEl, "Ein modul med denne id-en finst alt.", false); return; }
      statusMsg(statusEl, "Legg til…", true);
      var newManifest = Object.assign({}, existing);
      newManifest[id] = { label: label, enabled: false, params: {} };
      tenantAdminCall("set_custom_modules_manifest", { tenant_id: _activeTenant.id, manifest: newManifest }, function (r) {
        if (r.error) { statusMsg(statusEl, r.error, false); return; }
        _activeTenant.custom_modules_manifest = newManifest;
        renderModular(sc, wrap);
      });
    });
  }

  // Fase 6-oppfølging (2026-07-09): brukte tidlegare App.store.get/set("analytics", …)
  // — verken tenant-skopert (same feil som getSC(), sjå notatet der) ELLER
  // nokosinne faktisk skrive gjennom til Supabase for NOKON tenant (App.store
  // sitt write-through er gata på _isAuthed, som berre vert sett av ei
  // signInWithPassword mot ein tenant sitt eige prosjekt — noko Console aldri
  // gjer, den autentiserer berre mot vibeverk-control). Endringar vart altså
  // stille tapt ved sideoppfrisking, for alle kundar. Retta til same
  // tenant-skoperte lesing (getStoreKey) og broker-skriving (saveSC-mønster)
  // som resten av superconfig — "analytics" lagt til broker sin
  // ALLOWED_CONFIG_KEYS.
  /* =========================================================================
     PRISER — internt pris-/pakkeforslags-verktøy for Vibeverk sjølv, GLOBALT
     (ikkje tenant-skopa, difor ignorerer renderPriser sc-argumentet sitt --
     same mønster som renderKundar over). Design- og arkitekturhistorie:
     interaktiv mockup bygd saman med brukaren, deretter Arkitekt-konsultert
     TO gonger for persistens-mønsteret -- fyrste runde tilrådde direkte
     RLS-CRUD, men det synte seg feil ved direkte lesing av
     migrasjonshistorikken (Security Auditor-funn M3 hadde alt fjerna
     nøyaktig den policyen på operators-tabellen, same grunn som tenants).
     Retta mønster: lesing direkte via RLS-SELECT (som tenants/operators),
     skriving KUN via ein ny, audited tenant-admin-handling
     (set_pricing_config) -- sjå supabase-control/supabase/functions/
     tenant-admin/index.ts og migrasjonen 20260804120000_add_pricing_config.sql
     for full grunngjeving.

     Datamodell (pricing_config.data, éin rad): { prices: { f, i }, packages }
     -- "f"/"i" namnerom sidan features.crm og intranettFeatures.crm er ulike
     modular med same nøkkelnamn. Modulnamn/-hjelpetekst hentast IKKJE frå ei
     eiga liste her -- attbruker FEAT_LABELS/IFEAT_LABELS (over, alt brukt av
     Modular-fana), slik at Priser aldri kan gå ut av synk med den faktiske
     flaggmengda.
     ====================================================================== */
  var _priserData = null;              // { prices, packages } -- null til fyrste lasting er ferdig
  var _priserLoading = false;
  var _priserView = "edit";            // "edit" | "prices" | "quote" | "preview" | "budget"
  var _privacyView = "dokument";       // "dokument" | "skjema" | "samtykke" | "historikk" -- personvern-fana, Fase 1 (2026-08-06)
  var _priserQuote = { f: [], i: [] }; // "Bygg tilbud" -- reint økt-lokalt, aldri lagra
  var _priserPkgIdSeq = 1;
  var _priserEditSelected = null;      // vald pakke-id i "Rediger pakker" -- master/detail (brukarønske 2026-08-04: alle pakkane opne samtidig var "rotete og uoversiktleg")
  var _priserPreviewVisible = null;    // { pkgId: true } -- kva pakkar som vert vist i Forhåndsvisning, reint økt-lokalt (kan variere per kunde/tilbod, aldri lagra i pricing_config)
  // "Budsjett" -- monthlyQty: { pkgId: forventa talet på NYE sal PER MÅNAD },
  // target: månadleg inntektsmål (kr/mnd). Driv ein 12-månaders prognose der
  // MRR AKKUMULERER (kundar frå tidlegare månadar held fram å betale) medan
  // eingongsinntekt held seg FLAT kvar månad (berre frå den månaden sine nye
  // sal) -- sjå priserBudgetForecast(). Reint økt-lokalt, aldri lagra
  // (brukarønske 2026-08-05, presisert frå ein enkel éin-periode-kalkulator
  // til ein 12-månaders vekstprognose med graf undervegs i same økt).
  // annualTarget: eit ÅRSmål (kr/år), driv ein separat kalkulator (brukar-
  // ønske 2026-08-05, tillegg same økt) -- attbrukar dei SAME monthlyQty-
  // tala som forholdet mellom pakkane i miksen, men reknar utan tidsfasing:
  // kvar kunde tel med FULL førsteårsverdi (oppstartskostnad + 12×månedspris),
  // skalert opp til årsmålet. Sjå priserBudgetAnnualBreakdown().
  // annualCount: { pkgId: talet på kundar DU planlegg for året } -- den
  // OMVENDE retninga (brukarønske 2026-08-05, endå eit tillegg): her fyller
  // brukaren inn talet sjølv, HEILT UAVHENGIG av monthlyQty-miksen over, og
  // årsinntekta vert generert. Sjå priserBudgetAnnualCountRows().
  // annualCountTargets: { year1, year2 } -- to måltal (kr) for høvesvis Sum
  // 1. år og Sum år 2+ frå kalkulatoren over, vist mot dei faktiske summane
  // i eit eige søylediagram (brukarønske 2026-08-05, endå eit tillegg same
  // økt). Sjå priserAnnualCountChartHtml().
  var _priserBudget = { monthlyQty: {}, target: 0, annualTarget: 0, annualCount: {}, annualCountTargets: { year1: 0, year2: 0 } };

  function priserPriceEntry(ns, key) {
    var src = (ns === "f" ? _priserData.prices.f : _priserData.prices.i) || {};
    // Fallback dekkjer ein flaggnøkkel FEAT_LABELS/IFEAT_LABELS har fått
    // EtTER at denne rada sist vart lagra -- manglar prisoppføring, ikkje
    // ein feil, berre "ikkje prissett enno".
    return src[key] || { monthly: 0, setup: 0, standard: true };
  }
  function priserStandardKeys(ns) {
    var labels = ns === "f" ? PRISER_F_LABELS : PRISER_I_LABELS;
    return Object.keys(labels).filter(function (k) { return priserPriceEntry(ns, k).standard; });
  }
  function priserSum(featureKeys, iFeatureKeys) {
    var monthly = 0, setup = 0;
    (featureKeys || []).forEach(function (k) { var p = priserPriceEntry("f", k); monthly += p.monthly; setup += p.setup; });
    (iFeatureKeys || []).forEach(function (k) { var p = priserPriceEntry("i", k); monthly += p.monthly; setup += p.setup; });
    return { monthly: monthly, setup: setup };
  }
  // "Spar kr X" (brukarønske 2026-08-05) -- syner differansen når SETT pris
  // (pkg.price/setupCost) er lågare enn den KALKULERTE modulsummen (sum,
  // frå priserSum() over). Berre positive differansar tel som ei faktisk
  // "spart" innsparing -- ein pakke SETT høgare enn modulsummen (t.d. eit
  // medvite prispåslag) skal ikkje vise ei negativ "spar"-tekst.
  function priserSavings(pkg, sum) {
    return { monthly: Math.max(0, sum.monthly - pkg.price), setup: Math.max(0, sum.setup - (pkg.setupCost || 0)) };
  }
  function priserSavingsText(pkg, sum) {
    var s = priserSavings(pkg, sum);
    if (!s.monthly && !s.setup) return "";
    if (s.monthly && s.setup) return "Spar " + priserFmtPrice(s.monthly) + " kr/mnd + " + priserFmtPrice(s.setup) + " kr i oppstart";
    if (s.monthly) return "Spar " + priserFmtPrice(s.monthly) + " kr/mnd";
    return "Spar " + priserFmtPrice(s.setup) + " kr i oppstart";
  }

  /* =========================================================================
     BUDSJETT -- 12-månaders inntektsprognose (brukarønske 2026-08-05)
     ====================================================================== */
  // "Avtales separat"-pakkar har ingen fast pris å multiplisere med eit
  // salsantal -- einaste staden denne ekskluderinga skal leve, attbrukt av
  // både salsplan-tabellen og prognosen.
  function priserBudgetSellablePackages() {
    return _priserData.packages.filter(function (p) { return !p.priceOnRequest; });
  }
  // Éin månad sitt bidrag frå NYE sal DEN månaden, ved konstant salstakt:
  // ny MRR lagt til (akkumulerer over tid, sjå priserBudgetForecast) og
  // eingongsinntekt (gjentek seg ALDRI -- kvar månad sine nye kundar betaler
  // oppstartskostnaden sin éin gong, ikkje kvar månad).
  function priserBudgetMonthlyNew() {
    var newMrr = 0, oneTime = 0;
    priserBudgetSellablePackages().forEach(function (p) {
      var qty = Number(_priserBudget.monthlyQty[p.id]) || 0;
      newMrr += qty * (p.price || 0);
      oneTime += qty * (p.setupCost || 0);
    });
    return { newMrr: newMrr, oneTime: oneTime };
  }
  // 12 månadar framover ved KONSTANT salstakt: MRR i månad m er m × ny-MRR-
  // per-månad (månad 1 sine kundar betaler også i månad 2, 3, ... -- klassisk
  // lineær SaaS-vekstmodell), medan eingongsinntekt er FLAT kvar månad.
  function priserBudgetForecast() {
    var monthly = priserBudgetMonthlyNew();
    var months = [];
    for (var m = 1; m <= 12; m++) {
      months.push({ month: m, mrr: m * monthly.newMrr, oneTime: monthly.oneTime, total: m * monthly.newMrr + monthly.oneTime });
    }
    return months;
  }
  // Kor mange månadar (ved denne salstakta) før MRR-en når målet.
  // null = "aldri med denne salstakta" (skil frå 0 = "målet er alt 0/nådd").
  function priserBudgetMonthsToTarget() {
    var target = Number(_priserBudget.target) || 0;
    if (target <= 0) return 0;
    var monthly = priserBudgetMonthlyNew();
    if (monthly.newMrr <= 0) return null;
    return Math.ceil(target / monthly.newMrr);
  }
  // Delt tekst-tolking for "Når nås målet?" -- brukt begge stadene
  // (fyrste render og punktoppdatering) slik at dei aldri kan gli frå
  // kvarandre. Skil eksplisitt "ingen mål sett enno" frå "målet er alt nådd"
  // (UX-review-funn 2026-08-05: mtt===0 dekkjer BERRE target<=0-tilfellet,
  // så det las tidlegare feilaktig som "målet nådd" før brukaren i det heile
  // hadde skrive inn eit mål), og varslar eksplisitt når svaret ligg UTANFOR
  // dei synlege 12 månadane i staden for berre å vise eit stort tal utan
  // samanheng med grafen/tabellen under.
  function priserBudgetMttText(mtt, target) {
    if (target <= 0) return "Sett et mål over for å se når du når det.";
    if (mtt === null) return "Aldri med denne salstakta.";
    if (mtt > 12) return "Ikke innen 12 måneder (måned " + mtt + " ved denne takta).";
    return "Måned " + mtt;
  }
  // "Hvor mange kunder for eit årsmål?" (brukarønske 2026-08-05, tillegg til
  // 12-månaders-prognosen). Attbruker DEI SAME monthlyQty-tala som forholdet
  // mellom pakkane -- ingen ny miks-input. Reknar UTAN tidsfasing: verdien av
  // éin runde av miksen er 12×newMrr + oneTime, som er algebraisk identisk
  // med qty_i × (12×price_i + setupCost_i) summert -- altså nøyaktig "kvar
  // kunde tel med full oppstartskostnad + 12 månader" slik brukaren sjølv
  // rekna for hand (t.d. Grunnpakken: 4990 + 12×990 = 16870 per kunde).
  function priserBudgetAnnualMixValue() {
    var monthly = priserBudgetMonthlyNew();
    return 12 * monthly.newMrr + monthly.oneTime;
  }
  // null = uråd å rekne (ingen miks sett, eller ikkje noko mål sett enno).
  // Elles: { scale, mixValue, totalCustomers, rows: [{pkg, count}] }, der
  // count er talet på kundar av DEN pakken (Math.ceil per pakke, same
  // "rund opp for å garantere at målet faktisk vert nådd"-idiom som
  // priserBudgetMonthsToTarget()). Pakkar med 0 i miksen er ekskluderte frå
  // rows (skalerer framleis til 0, ingenting å vise).
  function priserBudgetAnnualBreakdown(annualTarget) {
    var mixValue = priserBudgetAnnualMixValue();
    if (annualTarget <= 0 || mixValue <= 0) return null;
    var scale = annualTarget / mixValue;
    var rows = priserBudgetSellablePackages().map(function (p) {
      var qty = Number(_priserBudget.monthlyQty[p.id]) || 0;
      return { pkg: p, count: Math.ceil(qty * scale) };
    }).filter(function (r) { return r.count > 0; });
    var totalCustomers = rows.reduce(function (s, r) { return s + r.count; }, 0);
    return { scale: scale, mixValue: mixValue, totalCustomers: totalCustomers, rows: rows };
  }
  // Den OMVENDE retninga (brukarønske 2026-08-05): brukaren fyller inn talet
  // på kundar sjølv, PER PAKKE, HEILT UAVHENGIG av monthlyQty-miksen over --
  // årsinntekta vert generert, ikkje sett som mål. Skil no eksplisitt mellom
  // 1. år (oppstartskostnaden kjem berre éin gong, ved teiknedato) og år 2+
  // (rein løpande abonnementsinntekt, ingen oppstartskostnad) -- brukarønske
  // 2026-08-05, tillegg til same kalkulator.
  function priserBudgetAnnualCountRows() {
    return priserBudgetSellablePackages().map(function (p) {
      var perCustomerYear1 = 12 * (p.price || 0) + (p.setupCost || 0);
      var perCustomerYear2 = 12 * (p.price || 0);
      var count = Number(_priserBudget.annualCount[p.id]) || 0;
      return {
        pkg: p, count: count,
        perCustomerYear1: perCustomerYear1, perCustomerYear2: perCustomerYear2,
        year1: perCustomerYear1 * count, year2: perCustomerYear2 * count
      };
    });
  }
  function priserBudgetAnnualCountTotals() {
    return priserBudgetAnnualCountRows().reduce(function (s, r) {
      s.year1 += r.year1; s.year2 += r.year2; s.count += r.count;
      return s;
    }, { year1: 0, year2: 0, count: 0 });
  }

  // Splitta i to uavhengige flagg (brukarfunn 2026-08-05, tidlegare ETT
  // felles pkg.allStandard styrte BÅDE nettside- og Workspace-modular samla
  // -- gjorde det umogleg å t.d. ha "alle standardmodular" for nettsida, men
  // eksplisitt valde Workspace-modular for same pakke, utan at det ene valet
  // uventa styrte det andre namnerommet også). priserBackfillStandardFlags()
  // migrerer eksisterande lagra pakkar frå det gamle, delte feltet.
  function priserAllStandard(pkg, ns) { return ns === "f" ? !!pkg.allStandardF : !!pkg.allStandardI; }

  // Når allStandard(ns) er på: standardmodular reknast med DYNAMISK (følgjer
  // kva som til ei kvar tid er merka standard i Modulpriser), ikkje eit
  // fastfrose augeblinksbilete -- pkg.features/iFeatures held då berre styr
  // på dei eksplisitt valde TILLEGG-modulane.
  function priserEffectiveKeys(pkg, ns) {
    var explicit = ns === "f" ? pkg.features : pkg.iFeatures;
    if (!priserAllStandard(pkg, ns)) return explicit;
    var addonPicked = explicit.filter(function (k) { return !priserPriceEntry(ns, k).standard; });
    return priserStandardKeys(ns).concat(addonPicked);
  }
  // Farge er brukarredigerbar (<input type="color"> gjev alltid eit gyldig
  // #rrggbb frå nettlesaren sjølv når brukaren endrar han), men vert like
  // fullt validert på nytt her før interpolering inn i eit style=-attributt
  // (renderPriserPreview) eller eit value=-attributt (fargeveljaren sjølv) --
  // lagra data kan i prinsippet vere eldre enn denne kontrollen, eller
  // stamme frå ei framtidig endring som gjekk glipp av noko server-sida.
  // Utan dette kunne eit anførselsteikn i verdien bryte ut av attributtet og
  // injisere vilkårleg HTML/skript -- lagra XSS som ville ramme kvar
  // operatør som opnar Priser-fana seinare.
  function priserSafeHex(c) {
    return (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) ? c : "#2563eb";
  }
  function priserFmtPrice(n) { return Number(n || 0).toLocaleString("nb-NO"); }

  // Maks-tal (brukarønske 2026-08-04): inkludert datalagring, e-post-
  // utsendingar og brukarkontoar per pakke -- -1 er sentinel-verdien for
  // "ubegrenset" (vist/redigert via ei eiga avkryssingsboks, sjå
  // priserCapFieldHtml()), same idé som andre delar av kodebasen brukar ein
  // sentinel i staden for eit eige boolsk flagg per felt. Berre eit
  // startforslag, tilpassa til kva app'en faktisk måler i dag (mediebank-
  // lagring, e-postutsending via Resend send-reply, brukarkontoar i
  // Workspace/Web-admin) -- fritt redigerbart per pakke, akkurat som pris.
  // trafficGBPerMonth lagt til (brukarønske 2026-08-05): eit informativt tal
  // for datatrafikk/overføring -- den faktiske kostnadsdrivaren hos Supabase
  // utover lagring (egress-bandbreidde). Same "kun informativt, ikkje teknisk
  // handheva"-status som dei andre grensene her -- eit reelt overvakings-/
  // handhevingssystem mot faktisk Supabase-forbruk er eksplisitt IKKJE bygd
  // no (ville kravd ny infrastruktur, vurdert og avslått av brukaren 2026-08-05
  // som eiga, større oppgåve).
  var PRISER_CAP_FIELDS = [
    { key: "storageGB",          label: "Datalagring",       unit: "GB",         deflt: [2, 10, 50] },
    { key: "trafficGBPerMonth",  label: "Datatrafikk",       unit: "GB/mnd",     deflt: [10, 50, 200] },
    { key: "emailsPerMonth",     label: "E-postutsendinger", unit: "e-post/mnd", deflt: [200, 1000, 5000] },
    { key: "usersIncluded",      label: "Brukerkontoer",     unit: "brukere",    deflt: [2, 5, -1] }
  ];
  // Tre-stegs terskel basert på pris -- fungerer for dei tre eksisterande
  // pakkane (Grunnpakke/Standard/Komplett) OG for ei ukjend framtidig pakke,
  // i staden for å hardkode etter pakke-id/namn.
  function priserDefaultCapsFor(pkg) {
    var tier = pkg.price < 4000 ? 0 : (pkg.price < 7000 ? 1 : 2);
    var out = {};
    PRISER_CAP_FIELDS.forEach(function (f) { out[f.key] = f.deflt[tier]; });
    return out;
  }
  // Fyller inn manglande cap-felt på pakkar lasta frå FØR denne funksjonen
  // fanst (dei tre live pakkane hadde ingen av desse felta enno) -- utan
  // dette ville talfelta vist "undefined" i redigeringa til brukaren lagra
  // på nytt éin gong.
  function priserBackfillCaps(pkg) {
    var defaults = priserDefaultCapsFor(pkg);
    PRISER_CAP_FIELDS.forEach(function (f) {
      if (typeof pkg[f.key] !== "number") pkg[f.key] = defaults[f.key];
    });
  }

  // Migrerer pakkar lagra FØR "Standardmoduler" vart splitta i to (sjå
  // priserAllStandard()) -- det gamle, delte pkg.allStandard-feltet vinn over
  // for BÅDE namnerom, slik at ei alt lagra pakke framleis oppfører seg
  // nøyaktig som før, fram til operatøren eksplisitt endrar eitt av dei to
  // nye flagga. pkg.priceOnRequest ("Pris etter avtale", brukarønske
  // 2026-08-05) manglar heilt på alle eksisterande pakkar -- defaultar til av.
  function priserBackfillStandardFlags(pkg) {
    if (typeof pkg.allStandardF !== "boolean") pkg.allStandardF = !!pkg.allStandard;
    if (typeof pkg.allStandardI !== "boolean") pkg.allStandardI = !!pkg.allStandard;
    delete pkg.allStandard;
    if (typeof pkg.priceOnRequest !== "boolean") pkg.priceOnRequest = false;
  }

  // Fyller inn dei nye, rein-prisings-katalogelementa (Hosting/Skreddersydd,
  // brukarønske 2026-08-05) med faste, meiningsfulle standardverdiar den
  // FYRSTE gongen dei møter lagra data som ikkje kjenner dem -- utan dette
  // ville priserPriceEntry() sin generiske fallback ({monthly:0,setup:0,
  // standard:TRUE}) gjort BÅDE "Skreddersydd modul" og "Skreddersydd AI-
  // modul" til Standard ved fyrste opning, feil for to eksplisitt opt-in-
  // tillegg. Idempotent -- gjer ingenting om verdiane alt finst (t.d. etter
  // operatøren sjølv har lagra ei endring på dem).
  function priserBackfillPricingOnlyEntries() {
    function ensure(ns, key, standard) {
      if (!_priserData.prices[ns]) _priserData.prices[ns] = {};
      if (!_priserData.prices[ns][key]) _priserData.prices[ns][key] = { monthly: 0, setup: 0, standard: standard };
    }
    ensure("f", "hosting", true);
    ensure("i", "hosting", true);
    ensure("i", "customModule", false);
    ensure("i", "customAiModule", false);
  }

  function priserLoad(wrap) {
    if (_priserLoading) return;
    _priserLoading = true;
    _sbControl.from("pricing_config").select("data").eq("id", true).maybeSingle().then(function (r) {
      _priserLoading = false;
      if (r.error || !r.data) {
        wrap.innerHTML = '<p style="color:var(--color-muted)">Kunne ikke laste prisdata.</p>' +
          C.button({ label: "Prøv igjen", variant: "ghost", attrs: 'type="button" id="priser-retry"' });
        var retryBtn = wrap.querySelector("#priser-retry");
        if (retryBtn) retryBtn.addEventListener("click", function () { priserLoad(wrap); });
        return;
      }
      _priserData = r.data.data;
      (_priserData.packages || []).forEach(priserBackfillCaps);
      (_priserData.packages || []).forEach(priserBackfillStandardFlags);
      priserBackfillPricingOnlyEntries();
      renderPriser(null, wrap);
    });
  }

  function priserSave(btn, statusEl) {
    if (btn) btn.disabled = true;
    tenantAdminCall("set_pricing_config", { data: _priserData }, function (r) {
      if (btn) btn.disabled = false;
      if (r.error) { statusMsg(statusEl, "✗ " + r.error, false); return; }
      statusMsg(statusEl, "✓ Lagra!", true);
    });
  }
  function priserSaveRowHtml() {
    return '<div style="display:flex;justify-content:flex-end;align-items:center;gap:.7rem;margin-top:1.2rem">' +
      '<span class="form__status" id="priser-save-status"></span>' +
      C.button({ label: "Lagre alle endringer", variant: "primary", attrs: 'type="button" id="priser-save-btn"' }) +
    '</div>';
  }
  function priserBindSaveRow(wrap) {
    var btn = wrap.querySelector("#priser-save-btn");
    if (btn) btn.addEventListener("click", function () { priserSave(btn, wrap.querySelector("#priser-save-status")); });
  }

  // Delt hjelpefunksjon: deler ei nøkkelliste i "Standard"/"Tillegg" basert
  // på priserPriceEntry(ns,key).standard, og rendrar kvar gruppe for seg via
  // chipFn(key). "Da blir det standard + modulnavn" (brukarønske
  // 2026-08-03): standardmodular vises kompakt/samla øvst, dei ekte
  // tilleggsmodulane får sin eigen, tydeleg avgrensa seksjon.
  function priserGroupedGrid(keys, ns, chipFn, wrapClass) {
    wrapClass = wrapClass === undefined ? "feat-grid" : wrapClass;
    var std = keys.filter(function (k) { return priserPriceEntry(ns, k).standard; });
    var addon = keys.filter(function (k) { return !priserPriceEntry(ns, k).standard; });
    function section(title, list) {
      if (!list.length) return "";
      var inner = list.map(chipFn).join("");
      return '<div class="feat-subgroup-title">' + title + '</div>' + (wrapClass ? '<div class="' + wrapClass + '">' + inner + '</div>' : inner);
    }
    return section("Standard", std) + section("Tillegg", addon);
  }

  // PRISER_F_LABELS/PRISER_I_LABELS er FEAT_LABELS/IFEAT_LABELS (attbrukt frå
  // Modular-fana) MERGA med den rene prisings-katalogen (Hosting/Skreddersydd
  // -- sjå PRICING_ONLY_*-konstantane over), same gjeld PRISER_F_HELP/
  // PRISER_I_HELP -- UX-review-funn 2026-08-04: forklaringane fanst alt for
  // kvar nøkkel, men vart aldri vist på Priser sine chips, sjølv om ei
  // rekkje modular (t.d. "crmFull"→"Native e-post") ikkje er sjølvforklarande
  // av namnet åleine.
  function priserHelpFor(ns, key) { return (ns === "f" ? PRISER_F_HELP : PRISER_I_HELP)[key]; }

  function priserFeatChip(key, label, checked, pkgId, group, tagValue) {
    var help = priserHelpFor(group, key);
    var chip = '<div class="feat-chip' + (checked ? " is-checked" : "") + '">' +
      '<label class="feat-chip__label">' +
        '<input type="checkbox" data-priser-pkg="' + C.esc(pkgId) + '" data-priser-group="' + group + '" data-priser-feat="' + C.esc(key) + '" ' + (checked ? "checked" : "") + '>' +
        '<span>' + C.esc(label) + '</span>' +
      '</label>' + (help ? C.helpIcon(help) : "");
    if (checked) {
      chip += '<input type="text" class="feat-chip__tag" placeholder="tag (valgfritt)" maxlength="100" ' +
        'data-priser-tag-pkg="' + C.esc(pkgId) + '" data-priser-tag-group="' + group + '" data-priser-tag-key="' + C.esc(key) + '" value="' + C.esc(tagValue || "") + '">';
    }
    return chip + '</div>';
  }

  function priserPkgFeatGroup(pkg, ns, labels, chipFn) {
    var keys = Object.keys(labels);
    if (!priserAllStandard(pkg, ns)) return priserGroupedGrid(keys, ns, chipFn);
    var addonKeys = keys.filter(function (k) { return !priserPriceEntry(ns, k).standard; });
    var html = '<p class="all-standard-line">Alle standardmoduler</p>';
    if (addonKeys.length) html += '<div class="feat-subgroup-title">Tillegg</div><div class="feat-grid">' + addonKeys.map(chipFn).join("") + '</div>';
    return html;
  }

  // Ekte ramma "kort" per grense (brukarfunn 2026-08-04: fanst INGEN ramme
  // her frå før, medan rada sjølv strekte kvart kort ut over ei heil
  // 1fr-brei rutenett-kolonne -- eit lite tal flytande i eit stort tomt
  // rom, sett saman med to nabo-kort like tomme, las ut som broten/rotete).
  // `.cap-card` veks difor IKKJE lenger til å fylle rada -- flex med ei
  // fast basisbreidde -- og tal-verdien er farga (same "stat"-mønster som
  // Pris/Oppstartskostnad-korta og .an-card__val i Analyse-fana).
  function priserCapFieldHtml(pkg, f) {
    var unlimited = pkg[f.key] === -1;
    return '<div class="cap-card">' +
      '<label class="cap-label">' + C.esc(f.label) + '</label>' +
      '<div class="stat-input-row">' +
        '<input type="number" min="0" max="1000000" step="1" data-priser-cap="' + f.key + '" data-priser-pkg="' + C.esc(pkg.id) + '" value="' + (unlimited ? "" : pkg[f.key]) + '" ' + (unlimited ? "disabled" : "") + '>' +
        '<span class="unit">' + C.esc(f.unit) + '</span>' +
      '</div>' +
      '<label class="cap-unlimited"><input type="checkbox" data-priser-cap-unlimited="' + f.key + '" data-priser-pkg="' + C.esc(pkg.id) + '" ' + (unlimited ? "checked" : "") + '> Ubegrenset</label>' +
    '</div>';
  }

  // Kompakt rad i pakke-lista til venstre (master/detail, brukarønske
  // 2026-08-04) -- prikken speglar merkelappfargen for ei fremheva pakke,
  // elles nøytral border-farge.
  // Rekkjefølgja her (array-orden i _priserData.packages) er ALT det som
  // styrer visingsordenen i «Forhåndsvisning» (renderPriserPreview itererer
  // packages.filter(...) i same orden) -- pil opp/ned flytter difor berre
  // element i denne arrayen, ingen eiga "order"-felt trengst (brukarønske
  // 2026-08-05: pilene skal bu her i pakke-rada, ikkje på Modulpriser-sida,
  // sidan pakkar ikkje finst der).
  function priserPkgRailRowHtml(pkg, isActive, isFirst, isLast) {
    var dotStyle = pkg.featured ? ' style="background:' + priserSafeHex(pkg.badgeColor) + '"' : "";
    return '<div class="pkg-row-wrap">' +
      '<button type="button" class="pkg-row' + (isActive ? " is-active" : "") + '" data-priser-select="' + C.esc(pkg.id) + '" aria-current="' + (isActive ? "true" : "false") + '">' +
        '<span class="pkg-row__dot"' + dotStyle + '></span>' +
        '<span class="pkg-row__body">' +
          '<span class="pkg-row__name">' + C.esc(pkg.name || "(uten navn)") + '</span>' +
          '<span class="pkg-row__price">' + (pkg.priceOnRequest ? "Pris etter avtale" : (priserFmtPrice(pkg.price) + ' kr/mnd')) + '</span>' +
        '</span>' +
      '</button>' +
      '<span class="pkg-row__reorder">' +
        '<button type="button" class="pkg-row__move" data-priser-move-up="' + C.esc(pkg.id) + '" aria-label="Flytt «' + C.esc(pkg.name || "pakke") + '» opp"' + (isFirst ? " disabled" : "") + '><i class="ti ti-chevron-up"></i></button>' +
        '<button type="button" class="pkg-row__move" data-priser-move-down="' + C.esc(pkg.id) + '" aria-label="Flytt «' + C.esc(pkg.name || "pakke") + '» ned"' + (isLast ? " disabled" : "") + '><i class="ti ti-chevron-down"></i></button>' +
      '</span>' +
    '</div>';
  }

  function priserEditSubtitle(pkg) {
    var fCount = priserEffectiveKeys(pkg, "f").length, iCount = priserEffectiveKeys(pkg, "i").length;
    return fCount + " nettside-modul" + (fCount === 1 ? "" : "er") + ", " + iCount + " Workspace-modul" + (iCount === 1 ? "" : "er") + " valgt";
  }

  function priserPkgFieldsHtml(pkg) {
    var featGrid = priserPkgFeatGroup(pkg, "f", PRISER_F_LABELS, function (k) {
      return priserFeatChip(k, PRISER_F_LABELS[k], pkg.features.indexOf(k) > -1, pkg.id, "f", pkg.tags.f[k]);
    });
    // Workspace-funksjoner vises på lik linje med Nettside-funksjoner --
    // samme rutenett, alltid synlig, ingen "Inkluderer Workspace"-sperre
    // foran (brukarønske 2026-08-03).
    var iFeatGrid = priserPkgFeatGroup(pkg, "i", PRISER_I_LABELS, function (k) {
      return priserFeatChip(k, PRISER_I_LABELS[k], pkg.iFeatures.indexOf(k) > -1, pkg.id, "i", pkg.tags.i[k]);
    });
    var sum = priserSum(priserEffectiveKeys(pkg, "f"), priserEffectiveKeys(pkg, "i"));

    var highlightFields = pkg.featured ? (
      '<div class="highlight-fieldset__row">' +
        '<div class="field"><label>Merkelapptekst</label><input type="text" maxlength="100" data-priser-field="badgeText" data-priser-pkg="' + C.esc(pkg.id) + '" value="' + C.esc(pkg.badgeText) + '"></div>' +
        '<div class="field" style="flex:0"><label>Farge</label><input type="color" data-priser-field="badgeColor" data-priser-pkg="' + C.esc(pkg.id) + '" value="' + priserSafeHex(pkg.badgeColor) + '"></div>' +
      '</div>'
    ) : "";

    // "Pris etter avtale" (brukarønske 2026-08-05, for skreddersydde
    // pakkar/modular utan fast pris): byter ut heile stat-row-en med éin
    // enkel tekstlinje -- ingen tal å "Hent priser" inn i eller lagre for ei
    // pakke som per definisjon ikkje har ein fast sum.
    var priceBlock = pkg.priceOnRequest
      ? '<div class="stat-row"><p class="stat-onrequest">Pris etter avtale — ingen fast månedspris eller oppstartskostnad for denne pakken.</p></div>'
      : '<div class="stat-row">' +
          '<div class="stat-box"><label>Pris pr. mnd' + C.helpIcon("Veiledende sum fra modulpriser: " + priserFmtPrice(sum.monthly) + " kr/mnd") + '</label>' +
            '<div class="stat-input-row"><input type="number" min="0" data-priser-field="price" data-priser-pkg="' + C.esc(pkg.id) + '" value="' + pkg.price + '"><span class="unit">kr</span>' +
            C.button({ label: "Hent priser", variant: "ghost", class: "btn--sm stat-fetch-btn", attrs: 'data-priser-fetch-price="' + C.esc(pkg.id) + '" title="Sett til summen fra Modulpriser (' + priserFmtPrice(sum.monthly) + ' kr/mnd)"' }) +
            '</div></div>' +
          '<div class="stat-box"><label>Oppstartskostnad' + C.helpIcon("Veiledende sum fra modulpriser: " + priserFmtPrice(sum.setup) + " kr") + '</label>' +
            '<div class="stat-input-row"><input type="number" min="0" data-priser-field="setupCost" data-priser-pkg="' + C.esc(pkg.id) + '" value="' + (pkg.setupCost || 0) + '"><span class="unit">kr</span>' +
            C.button({ label: "Hent priser", variant: "ghost", class: "btn--sm stat-fetch-btn", attrs: 'data-priser-fetch-setup="' + C.esc(pkg.id) + '" title="Sett til summen fra Modulpriser (' + priserFmtPrice(sum.setup) + ' kr)"' }) +
            '</div></div>' +
        '</div>';

    // Seksjonert i .rp-section-blokker med tydeleg skiljelinje mellom kvar
    // (UX-review-funn 2026-08-04: éin lang, udelt kolonne av felt kjentest
    // "rotete/uoversiktleg"). Pris/Oppstartskostnad er no reine "stat"-kort
    // (farga tal, same mønster som .an-card__val i Analyse-fana -- brukar
    // bad eksplisitt om litt farge for "dynamikk") med berre eit tal, ingen
    // eining-tekst attmed eller hint-linje under (brukarønske 2026-08-04:
    // "Ikke noe mer på de to rutene") -- den tidlegare "Veiledende sum"-
    // teksten ligg no i ein helpIcon() i staden for å forsvinne heilt.
    return '<div class="rp-section">' +
        '<div class="feat-section-title">Grunnleggende</div>' +
        '<div class="field"><label>Pakkenavn</label><input type="text" maxlength="200" data-priser-field="name" data-priser-pkg="' + C.esc(pkg.id) + '" value="' + C.esc(pkg.name) + '"></div>' +
        priceBlock +
        (!pkg.priceOnRequest ? '<p class="stat-row-savings" data-priser-savings="' + C.esc(pkg.id) + '"' + (priserSavingsText(pkg, sum) ? "" : ' hidden') + '>' + C.esc(priserSavingsText(pkg, sum) + " sammenlignet med modulsum") + '</p>' : "") +
        '<div class="field"><label>Kort beskrivelse</label><textarea rows="2" maxlength="2000" data-priser-field="desc" data-priser-pkg="' + C.esc(pkg.id) + '">' + C.esc(pkg.desc) + '</textarea></div>' +
      '</div>' +
      '<div class="rp-section">' +
        '<div class="feat-section-title">Innstillinger</div>' +
        '<div class="highlight-fieldset">' +
          '<label class="highlight-fieldset__toggle"><input type="checkbox" data-priser-field="featured" data-priser-pkg="' + C.esc(pkg.id) + '" ' + (pkg.featured ? "checked" : "") + '> Fremhev i forhåndsvisning (ramme + merkelapp)</label>' +
          highlightFields +
        '</div>' +
        '<label class="highlight-fieldset__toggle"><input type="checkbox" data-priser-field="priceOnRequest" data-priser-pkg="' + C.esc(pkg.id) + '" ' + (pkg.priceOnRequest ? "checked" : "") + '> Pris etter avtale</label>' +
        C.helpIcon("For skreddersydde pakker/moduler uten fast pris (f.eks. «Skreddersydd modul», «Skreddersydd AI-modul»). Skjuler Pris pr. mnd og Oppstartskostnad, viser i stedet «Pris etter avtale» overalt prisen ellers ville vist seg.") +
      '</div>' +
      '<div class="rp-section">' +
        '<div class="feat-section-title">Grenser (maks inkludert)' + C.helpIcon("Vises til kunden i Forhåndsvisning som en del av pakkebeskrivelsen. Kun informative tall her — de håndheves ikke teknisk noe sted ennå.") + '</div>' +
        '<div class="cap-row">' + PRISER_CAP_FIELDS.map(function (f) { return priserCapFieldHtml(pkg, f); }).join("") + '</div>' +
      '</div>' +
      '<div class="rp-section">' +
        '<div class="feat-section-title">Nettside-/Web-admin-funksjoner</div>' +
        '<label class="highlight-fieldset__toggle"><input type="checkbox" data-priser-field="allStandardF" data-priser-pkg="' + C.esc(pkg.id) + '" ' + (pkg.allStandardF ? "checked" : "") + '> Standardmoduler — Nettside</label>' +
        C.helpIcon("Pakken følger automatisk de nettside-/Web-admin-modulene som er merket «Standard» i Modulpriser-fanen, også etter at du har lagret og senere endrer hva som er standard der. Skru av for å velge nøyaktig hvilke nettside-moduler denne pakken skal ha. Styrer KUN nettside-modulene under — Workspace-modulene har sin egen, uavhengige bryter lenger ned.") +
        featGrid +
      '</div>' +
      '<div class="rp-section">' +
        '<div class="feat-section-title">Workspace-funksjoner</div>' +
        '<label class="highlight-fieldset__toggle"><input type="checkbox" data-priser-field="allStandardI" data-priser-pkg="' + C.esc(pkg.id) + '" ' + (pkg.allStandardI ? "checked" : "") + '> Standardmoduler — Workspace</label>' +
        C.helpIcon("Pakken følger automatisk de Workspace-modulene som er merket «Standard» i Modulpriser-fanen, uavhengig av nettside-bryteren over. Skru av for å velge nøyaktig hvilke Workspace-moduler denne pakken skal ha.") +
        iFeatGrid +
      '</div>';
  }

  function priserEditPanelHtml(pkg) {
    return '<div class="edit-panel">' +
      '<div class="edit-panel__head">' +
        '<div><div class="edit-panel__title">' + C.esc(pkg.name || "(uten navn)") + '</div>' +
        '<div class="edit-panel__sub">' + C.esc(priserEditSubtitle(pkg)) + '</div></div>' +
        '<button type="button" class="edit-panel__del" data-priser-del="' + C.esc(pkg.id) + '">Fjern pakke</button>' +
      '</div>' +
      '<div class="edit-panel__body">' + priserPkgFieldsHtml(pkg) + '</div>' +
    '</div>';
  }

  function priserFindMatch(wrap, selectorAttr, matchAttrs) {
    var candidates = wrap.querySelectorAll(selectorAttr);
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i], ok = true;
      for (var attr in matchAttrs) { if (el.getAttribute(attr) !== matchAttrs[attr]) { ok = false; break; } }
      if (ok) return el;
    }
    return null;
  }

  // Eit fullt re-render av heile pakke-panelet (renderPriserEdit) mistar
  // tastaturfokus -- kritisk for eit skjema med opp mot 25 avkryssingsboksar
  // per pakke (UX-review-funn 2026-08-04: ein tastaturbrukar måtte Tab-e frå
  // toppen på nytt etter KVART avkryssa felt). Fangar kva felt som var
  // fokusert FØR re-render, finn att same felt etterpå og gjev det fokus på
  // nytt -- dekkjer feature- og featured-/allStandard-avkryssingane, dei
  // einaste elementa som utløyser eit fullt re-render herifrå.
  function priserRerenderEditPreservingFocus(wrap) {
    var active = document.activeElement;
    var restore = null;
    if (active && wrap.contains(active)) {
      if (active.hasAttribute("data-priser-feat")) {
        restore = { selectorAttr: "[data-priser-feat]", attrs: {
          "data-priser-pkg": active.getAttribute("data-priser-pkg"),
          "data-priser-group": active.getAttribute("data-priser-group"),
          "data-priser-feat": active.getAttribute("data-priser-feat")
        } };
      } else if (active.hasAttribute("data-priser-field")) {
        restore = { selectorAttr: "[data-priser-field]", attrs: {
          "data-priser-pkg": active.getAttribute("data-priser-pkg"),
          "data-priser-field": active.getAttribute("data-priser-field")
        } };
      } else if (active.hasAttribute("data-priser-cap-unlimited")) {
        restore = { selectorAttr: "[data-priser-cap-unlimited]", attrs: {
          "data-priser-pkg": active.getAttribute("data-priser-pkg"),
          "data-priser-cap-unlimited": active.getAttribute("data-priser-cap-unlimited")
        } };
      } else if (active.hasAttribute("data-priser-fetch-price")) {
        restore = { selectorAttr: "[data-priser-fetch-price]", attrs: { "data-priser-fetch-price": active.getAttribute("data-priser-fetch-price") } };
      } else if (active.hasAttribute("data-priser-fetch-setup")) {
        restore = { selectorAttr: "[data-priser-fetch-setup]", attrs: { "data-priser-fetch-setup": active.getAttribute("data-priser-fetch-setup") } };
      }
    }
    renderPriserEdit(wrap);
    if (restore) {
      var el = priserFindMatch(wrap, restore.selectorAttr, restore.attrs);
      if (el) el.focus();
    }
  }

  /* =========================================================================
     SIDEBYGGER — SIDER (Fase 1, Console-only)
     -------------------------------------------------------------------------
     Lagring: éin store-nøkkel "custom-pages" på den valde tenanten sitt eige
     prosjekt (same mønster som superconfig -- lest via getStoreKey(), skrive
     via brokerCall("set_config", ...) sidan Console si eiga tenantPublicClient()
     er anon/persistSession:false og aldri kan tilfredsstille store sin
     can_edit_content()-RLS). Sjå module-page-builder.js for korleis desse
     sidene faktisk vert rendra på den offentlege sida.

     Ingen kundeflyt her enno (Fase 2) -- alt går via Console, "locked" er
     difor alltid true og aldri vist som ein redigerbar brytar.
     ====================================================================== */
  var PB_SECTION_TYPES = [
    { type: "hero", label: "Hero/banner", desc: "Stort bilde med overskrift og knapp øverst på siden", icon: "photo" },
    { type: "text", label: "Tekstblokk", desc: "Overskrift og brødtekst", icon: "align-left" },
    { type: "image-text", label: "Bilde + tekst", desc: "Bilde ved siden av tekst", icon: "layout-2" },
    { type: "big-image", label: "Stort bilde", desc: "Fullbredde bilde, valgfri bildetekst", icon: "photo-scan" },
    { type: "quote", label: "Sitat", desc: "Fremhevet sitat med navn og rolle", icon: "quote" },
    { type: "grid", label: "Rutenett", desc: "1–4 kolonner, hver rute med bilde/tekst/knapp", icon: "layout-grid" },
    { type: "cta", label: "CTA (handling)", desc: "Overskrift, tekst og en tydelig knapp", icon: "click" },
    { type: "spacer", label: "Mellomrom", desc: "Luft mellom to seksjoner", icon: "arrows-vertical" },
    { type: "blocks", label: "Blokker", desc: "Fritt sett av små blokker (overskrift, tekst, bilde, knapp, kontaktinfo, mellomrom) i 1–4 kolonner", icon: "layout-board" }
  ];

  // Blokk-paletten inni ei "blocks"-seksjon (sjå PB_SECTION_TYPES over) --
  // same idé som PB_SECTION_TYPES, berre éin abstraksjonsnivå ned: kvar
  // "blocks"-seksjon kan innehalde eit fritt tal av desse, uavhengig typa.
  var PB_BLOCK_TYPES = [
    { type: "heading", label: "Overskrift", desc: "Kort overskrift (stor eller mindre)", icon: "heading" },
    { type: "richtext", label: "Tekst", desc: "Formatert brødtekst", icon: "align-left" },
    { type: "image", label: "Bilde", desc: "Enkeltbilde", icon: "photo" },
    { type: "button", label: "Knapp", desc: "Klikkbar knapp eller lenke", icon: "click" },
    { type: "contact-item", label: "Kontaktinfo", desc: "Telefon, e-post, adresse eller fritekst", icon: "address-book" },
    { type: "spacer", label: "Mellomrom", desc: "Luft mellom to blokker", icon: "arrows-vertical" }
  ];
  var PB_BLOCKS_LAYOUT_OPTIONS = [
    ["1col", "1 kolonne"], ["2col", "2 kolonner (like)"],
    ["2col-2-1", "2 kolonner (bred + smal)"], ["2col-1-2", "2 kolonner (smal + bred)"],
    ["3col", "3 kolonner"], ["4col", "4 kolonner"]
  ];
  // Gjenbruker components.js sin EKSPORTERTE pbBlocksLayout()-tabell for
  // kolonnetal -- unngår ein tredje, sjølvstendig duplisert kopi av same
  // enum (CSS-en er alt eit medvite dupliserte unntak, dokumentert der).
  function pbLayoutColCount(layout) { return C.pbBlocksLayout(layout).cols; }
  function pbNewBlockId() {
    return "blk-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }
  var PB_SECTION_LABELS = PB_SECTION_TYPES.reduce(function (m, t) { m[t.type] = t.label; return m; }, {});
  // Faste modul-id-ar + tidlegare sidebygger-fane sjølv -- ei ny side kan
  // aldri kollidere med desse, sidan App.registerModule() (core.js) no-oppar
  // stille på duplikat-id utan feilmelding.
  var PB_RESERVED_IDS = ["hjem", "om-oss", "tjenester", "aktuelt", "kontakt", "booking", "referanser", "mediabank", "faq", "admin", "sak", "sidebygger-sider"];

  function pbSlugify(s) {
    var out = String(s || "").trim().toLowerCase()
      .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return out || "side";
  }
  function pbUniquePageId(base, existingIds) {
    var id = base, n = 2;
    while (PB_RESERVED_IDS.indexOf(id) !== -1 || existingIds.indexOf(id) !== -1) {
      id = base + "-" + n; n++;
    }
    return id;
  }
  function pbNewSectionId() {
    return "sec-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }
  // Djup kopi av ein heil seksjon -- gjev sjølve seksjonen ein FRISK id
  // (kritisk: s.id vert brukt som data-id for DOM-oppslag og lookup i
  // move/delete/toggle, to seksjonar med same id ville broten desse), og
  // for "blocks"-seksjonar òg friske id-ar på KVAR blokk (ikkje strengt
  // naudsynt i dag, sidan blokker vert indekserte etter array-posisjon,
  // ikkje id -- men god hygiene, unngår duplikat-id-ar om framtidig kode
  // nokon gong slår opp ei blokk via id).
  function pbCloneSection(s) {
    var clone = JSON.parse(JSON.stringify(s));
    clone.id = pbNewSectionId();
    clone.open = false;
    if (clone.type === "blocks" && clone.data && Array.isArray(clone.data.blocks)) {
      clone.data.blocks = clone.data.blocks.map(function (b) {
        var bc = JSON.parse(JSON.stringify(b));
        bc.id = pbNewBlockId();
        return bc;
      });
    }
    return clone;
  }
  function pbSelectField(id, label, options, value) {
    return '<div class="field"><label for="' + id + '">' + C.esc(label) + '</label><select id="' + id + '">' +
      options.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === value ? " selected" : "") + '>' + C.esc(o[1]) + '</option>'; }).join("") +
    '</select></div>';
  }

  // Eige, enkelt biletopplastingsfelt (IKKJE App.ui.imageField/Media.put() --
  // dei krev ei ekte, innlogga KUNDE-økt, som Console aldri har, sjå
  // console-core.js sin tenantPublicClient()-kommentar). Går via
  // brokerCall("upload_section_image", ...), same mønster som logo-
  // opplastinga i renderWeb() (#cs-logo-file), berre med eit anna
  // storleikstak (fullbreidde-innhaldsbilete, ikkje ein liten logo).
  // UX-funn 2026-08-11 (brukartilbakemelding etter fyrste faktiske bruk):
  // avgrensingane (storleik/filtype) vart berre synt ETTER at eit bilete
  // alt var avvist -- ingen stad stod dei på førehand. Hint-teksten under
  // står no alltid synleg i feltet, uansett om noko er lasta opp enno.
  function pbImageFieldHtml(id, label, img) {
    img = img || {};
    return '<div class="field">' +
      '<label>' + C.esc(label) + '</label>' +
      '<div class="pbc-img-upload">' +
        '<div class="pbc-img-upload__row">' +
          '<div class="pbc-img-upload__thumb" id="' + id + '-thumb" style="' + (img.src ? "background-image:url('" + C.esc(img.src) + "')" : "") + '">' + (img.src ? "" : '<i class="ti ti-photo"></i>') + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<input type="file" id="' + id + '-file" accept="image/svg+xml,image/png,image/jpeg,image/webp">' +
            '<p class="field__hint" style="margin-top:.3rem">PNG/JPEG: opptil 8MB (komprimerast automatisk ned mot 600KB) · SVG/WebP: opptil 600KB rått</p>' +
          '</div>' +
        '</div>' +
        '<input type="hidden" id="' + id + '-src" value="' + C.esc(img.src || "") + '">' +
        '<input type="text" id="' + id + '-alt" placeholder="Alt-tekst (for skjermlesere/SEO)" value="' + C.esc(img.alt || "") + '">' +
        '<p class="field__hint" id="' + id + '-status"></p>' +
      '</div>' +
    '</div>';
  }
  // onChange-hooken kallast etter ei VELLUKKA opplasting -- brukt til å
  // trigge forhåndsvisinga sin friske render utan at kallaren treng vite
  // korleis biletfeltet sjølv fungerer.
  // UX-funn 2026-08-11: "✓ Lasta opp" åleine synte ALDRI kva komprimeringa
  // faktisk resulterte i -- berre at ho hadde skjedd. broker sin
  // upload_section_image returnerer no den faktiske endelege storleiken
  // (size), som vert samanlikna mot originalfila sin storleik her.
  function pbFormatBytes(n) {
    if (typeof n !== "number") return "";
    if (n > 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + "MB";
    return Math.round(n / 1024) + "KB";
  }
  function pbBindImageField(root, id, tenantId, onChange) {
    var fileInput = root.querySelector("#" + id + "-file");
    if (!fileInput) return;
    var statusEl = root.querySelector("#" + id + "-status");
    var srcEl    = root.querySelector("#" + id + "-src");
    var thumbEl  = root.querySelector("#" + id + "-thumb");
    var ALLOWED_TYPES = { "image/svg+xml": 1, "image/png": 1, "image/jpeg": 1, "image/webp": 1 };
    var COMPRESSIBLE_TYPES = { "image/png": 1, "image/jpeg": 1 };
    var MAX_BYTES = 600 * 1024, RAW_MAX_BYTES = 8 * 1024 * 1024;
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (!ALLOWED_TYPES[file.type]) {
        statusEl.textContent = "Filtypen «" + (file.type || "ukjend") + "» er ikkje støtta. Bruk SVG, PNG, JPEG eller WebP.";
        fileInput.value = ""; return;
      }
      var isCompressible = !!COMPRESSIBLE_TYPES[file.type];
      var ceiling = isCompressible ? RAW_MAX_BYTES : MAX_BYTES;
      if (file.size > ceiling) {
        var maxLabel = isCompressible ? "8MB" : "600KB";
        var tip = isCompressible
          ? " Prøv å lagre bildet i lavere oppløsning før du laster opp på nytt."
          : " Denne filtypen vert ikkje komprimert automatisk -- bruk PNG eller JPEG i staden, eller last opp eit mindre bilete.";
        statusEl.textContent = "Bildet er for stort (maks " + maxLabel + " for " + file.type.split("/")[1].toUpperCase() + ")." + tip;
        fileInput.value = ""; return;
      }
      statusEl.textContent = file.size > MAX_BYTES ? "Lastar opp og komprimerer …" : "Lastar opp …";
      var reader = new FileReader();
      reader.onerror = function () { statusEl.textContent = "Kunne ikkje lese fila."; };
      reader.onload = function () {
        var base64 = String(reader.result).split(",")[1] || "";
        var oldUrl = srcEl.value;
        brokerCall("upload_section_image", { file_base64: base64, content_type: file.type, old_image_url: oldUrl, tenant_id: tenantId }, function (r) {
          if (r.error) { statusEl.textContent = "Opplasting feila: " + r.error; return; }
          srcEl.value = r.url;
          // Vis det faktiske komprimeringsresultatet (ikkje berre "det skjedde")
          // -- viser "frå X til Y" berre når storleiken faktisk gjekk merkbart
          // ned, elles berre den endelege storleiken.
          var sizeNote = "";
          if (typeof r.size === "number") {
            sizeNote = (file.size - r.size > 10 * 1024)
              ? " (komprimert frå " + pbFormatBytes(file.size) + " til " + pbFormatBytes(r.size) + ")"
              : " (" + pbFormatBytes(r.size) + ")";
          }
          statusEl.textContent = "✓ Lasta opp" + sizeNote;
          fileInput.value = "";
          if (thumbEl) { thumbEl.style.backgroundImage = "url('" + r.url + "')"; thumbEl.innerHTML = ""; }
          if (typeof onChange === "function") onChange();
        });
      };
      reader.readAsDataURL(file);
    });
  }
  function pbReadImageField(root, id) {
    var srcEl = root.querySelector("#" + id + "-src");
    var altEl = root.querySelector("#" + id + "-alt");
    if (!srcEl || !srcEl.value) return null;
    return { src: srcEl.value, alt: altEl ? altEl.value.trim() : "" };
  }

  // Brukarønske 2026-08-12: valfri biletform, delt på tvers av alle stadar
  // bilete kan leggjast inn (IKKJE hero -- sjå grunngjeving i components.js
  // sin pbImgShapeClass()).
  var PB_IMG_SHAPE_OPTIONS = [["rounded", "Avrunda hjørne (standard)"], ["square", "Kvadratisk"], ["circle", "Sirkel/rund"]];
  // UX-funn 2026-08-12: Sidebygger sitt eige biletfelt (pbImageFieldHtml,
  // sjå der) har ingen fokuspunkt-/beskjeringskontroll -- "Sirkel/rund"
  // skjer difor ALLTID til eit sentrert kvadrat. Utan denne hintteksten
  // ville ein operatør som vel sirkel på eit bilete med eit ikkje-sentrert
  // motiv (t.d. eit ansikt langt til venstre i biletet) fått eit dårleg
  // beskore resultat utan noka åtvaring om KVIFOR, berre forhåndsvisinga
  // sjølv (som riktignok oppdaterer seg live) å oppdage det på.
  var PB_IMG_SHAPE_HINT = '<p class="field__hint">Sirkel skjer biletet til eit sentrert kvadrat. Sjekk forhåndsvisinga for å sjå korleis det ser ut.</p>';

  function pbSectionDataFieldsHtml(type, d) {
    if (type === "hero") {
      return pbImageFieldHtml("pb-sec-img", "Bilde (valgfritt)", d.image) +
        '<p class="field__hint">Hero-biletet er ein bakgrunn bak teksten, difor er det ingen eiga biletform her.</p>' +
        C.field({ id: "pb-sec-heading", label: "Overskrift", value: d.heading || "" }) +
        C.field({ id: "pb-sec-text", label: "Tekst", value: d.text || "", multiline: true, rows: 3 }) +
        '<div class="pbc-field-grid">' +
          C.field({ id: "pb-sec-btn-label", label: "Knapptekst (valgfritt)", value: (d.button && d.button.label) || "" }) +
          C.field({ id: "pb-sec-btn-url", label: "Knapplenke", value: (d.button && d.button.url) || "" }) +
        '</div>';
    }
    if (type === "text") {
      return C.field({ id: "pb-sec-heading", label: "Overskrift (valgfritt)", value: d.heading || "" }) +
        C.richTextField({ id: "pb-sec-text-rt", label: "Tekst", value: d.text || "" });
    }
    if (type === "image-text") {
      return pbImageFieldHtml("pb-sec-img", "Bilde", d.image) +
        pbSelectField("pb-sec-imgpos", "Biletplassering", [["left", "Venstre"], ["right", "Høgre"]], d.imagePosition || "left") +
        pbSelectField("pb-sec-imgshape", "Biletform", PB_IMG_SHAPE_OPTIONS, d.imageShape || "rounded") + PB_IMG_SHAPE_HINT +
        C.field({ id: "pb-sec-heading", label: "Overskrift (valgfritt)", value: d.heading || "" }) +
        C.richTextField({ id: "pb-sec-text-rt", label: "Tekst", value: d.text || "" });
    }
    if (type === "big-image") {
      return pbImageFieldHtml("pb-sec-img", "Bilde", d.image) +
        pbSelectField("pb-sec-imgshape", "Biletform", PB_IMG_SHAPE_OPTIONS, d.imageShape || "rounded") + PB_IMG_SHAPE_HINT +
        C.field({ id: "pb-sec-caption", label: "Bildetekst (valgfritt)", value: d.caption || "" });
    }
    if (type === "quote") {
      return C.field({ id: "pb-sec-text", label: "Sitat", value: d.text || "", multiline: true, rows: 2 }) +
        '<div class="pbc-field-grid">' +
          C.field({ id: "pb-sec-author", label: "Navn (valgfritt)", value: d.author || "" }) +
          C.field({ id: "pb-sec-role", label: "Rolle/tittel (valgfritt)", value: d.role || "" }) +
        '</div>';
    }
    if (type === "grid") {
      // Biletform gjeld for HEILE rutenettet (alle ruter sine bilete), ikkje
      // per rute -- same grunngjeving som i components.js sin pbGrid().
      // UX-funn 2026-08-12: dette er det EINASTE feltet på rutenettet som
      // ikkje er per-rute (bilete/overskrift/tekst/knapp er det), difor
      // eit eige hint her -- parentesen i etiketten åleine er lett å
      // rulle forbi når ein sit inne i sjølve rute-redigeringa seinare.
      return pbSelectField("pb-sec-cols", "Antall kolonner", [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]], String(d.columns || 3)) +
        pbSelectField("pb-sec-imgshape", "Biletform (gjeld alle ruter)", PB_IMG_SHAPE_OPTIONS, d.imageShape || "rounded") +
        '<p class="field__hint">Gjeld alle rutene i rutenettet -- kan ikkje setjast per rute.</p>' + PB_IMG_SHAPE_HINT +
        '<div class="pbc-grid-items" id="pb-grid-items"></div>' +
        '<button type="button" class="btn btn--ghost btn--sm" id="pb-grid-add-item"><i class="ti ti-plus"></i> Legg til rute</button>';
    }
    if (type === "cta") {
      return C.field({ id: "pb-sec-heading", label: "Overskrift", value: d.heading || "" }) +
        C.field({ id: "pb-sec-text", label: "Tekst (valgfritt)", value: d.text || "", multiline: true, rows: 2 }) +
        '<div class="pbc-field-grid">' +
          C.field({ id: "pb-sec-btn-label", label: "Knapptekst", value: (d.button && d.button.label) || "" }) +
          C.field({ id: "pb-sec-btn-url", label: "Knapplenke", value: (d.button && d.button.url) || "" }) +
        '</div>';
    }
    if (type === "spacer") {
      return '<p class="field__hint">Mellomrommet sin storleik styrast av «Luft»-valet over.</p>';
    }
    if (type === "blocks") {
      // Kvar kolonne sitt "Legg til blokk"-triggar/-picker vert rendra INNI
      // #pb-blocks-items av renderBlocksEditor() sjølv (gruppert per kolonne,
      // sjå der) -- ikkje her som ein statisk, persistent søskenelement.
      return pbSelectField("pb-sec-blocks-layout", "Kolonneoppsett", PB_BLOCKS_LAYOUT_OPTIONS, d.layout || "1col") +
        '<div class="pbc-blocks-items" id="pb-blocks-items"></div>';
    }
    return "";
  }

  // Per-blokktype felt-editorar, same mønster som pbSectionDataFieldsHtml/
  // pbReadSectionDataFields over -- men ID-prefiksa (idp) sidan fleire
  // blokker kan liggje opne i same DOM samstundes (same teknikk som
  // renderGridItems alt bruker: "pb-grid-heading-" + i).
  function pbBlockDataFieldsHtml(type, d, idp) {
    d = d || {};
    var fields;
    if (type === "heading") {
      fields = pbSelectField(idp + "-level", "Storleik", [["h2", "Stor"], ["h3", "Mindre"]], d.level || "h2") +
        C.field({ id: idp + "-text", label: "Overskriftstekst", value: d.text || "" });
    } else if (type === "richtext") {
      fields = C.richTextField({ id: idp + "-text-rt", label: "Tekst", value: d.text || "" });
    } else if (type === "image") {
      fields = pbImageFieldHtml(idp + "-img", "Bilde", d.image) +
        pbSelectField(idp + "-imgshape", "Biletform", PB_IMG_SHAPE_OPTIONS, d.imageShape || "rounded") + PB_IMG_SHAPE_HINT;
    } else if (type === "button") {
      fields = '<div class="pbc-field-grid">' +
          C.field({ id: idp + "-label", label: "Knapptekst", value: d.label || "" }) +
          C.field({ id: idp + "-url", label: "Knapplenke", value: d.url || "" }) +
        '</div>' +
        pbSelectField(idp + "-variant", "Stil", [["primary", "Primær"], ["secondary", "Sekundær"], ["ghost", "Diskret"]], d.variant || "primary");
    } else if (type === "contact-item") {
      fields = pbSelectField(idp + "-kind", "Type", [["phone", "Telefon"], ["email", "E-post"], ["address", "Adresse"], ["custom", "Anna (fritekst)"]], d.kind || "phone") +
        C.field({ id: idp + "-label", label: "Etikett (valgfritt)", value: d.label || "", hint: "F.eks. «Ring oss» — vises foran verdien" }) +
        C.field({ id: idp + "-value", label: "Verdi", value: d.value || "", hint: "For telefon/e-post lages lenken automatisk ut fra verdien — du skriver aldri inn en egen lenke." });
    } else if (type === "spacer") {
      return '<p class="field__hint">Fast mellomrom mellom to blokker i same kolonne.</p>';
    } else {
      return "";
    }
    // Brukarønske 2026-08-12: valfri ramme (bakgrunn+kant) rundt kvar blokk,
    // same visuelle handsaming som .pb-grid__item -- av med vilje for
    // "mellomrom" (ingen synleg innhald å ramme inn), på for resten.
    fields += '<label><input type="checkbox" id="' + idp + '-frame"' + (d.frame ? " checked" : "") + '> Ramme inn (bakgrunn og kant)</label>';
    return fields;
  }
  function pbReadBlockDataFields(root, type, idp) {
    var out;
    if (type === "heading") {
      out = {
        level: root.querySelector("#" + idp + "-level").value,
        text: root.querySelector("#" + idp + "-text").value.trim()
      };
    } else if (type === "richtext") {
      out = { text: App.ui.readRichTextField(root, idp + "-text-rt") };
    } else if (type === "image") {
      out = { image: pbReadImageField(root, idp + "-img"), imageShape: root.querySelector("#" + idp + "-imgshape").value };
    } else if (type === "button") {
      out = {
        label: root.querySelector("#" + idp + "-label").value.trim(),
        url: root.querySelector("#" + idp + "-url").value.trim(),
        variant: root.querySelector("#" + idp + "-variant").value
      };
    } else if (type === "contact-item") {
      out = {
        kind: root.querySelector("#" + idp + "-kind").value,
        label: root.querySelector("#" + idp + "-label").value.trim(),
        value: root.querySelector("#" + idp + "-value").value.trim()
      };
    } else {
      out = {};
    }
    var frameEl = root.querySelector("#" + idp + "-frame");
    if (frameEl) out.frame = frameEl.checked;
    return out;
  }
  var PB_BLOCK_DEFAULTS = {
    heading: { level: "h2", text: "", frame: false }, richtext: { text: "", frame: false }, image: { image: null, imageShape: "rounded", frame: false },
    button: { label: "", url: "", variant: "primary", frame: false }, "contact-item": { kind: "phone", label: "", value: "", frame: false }, spacer: {}
  };

  function pbReadSectionDataFields(ed, type) {
    if (type === "hero") {
      var hbl = ed.querySelector("#pb-sec-btn-label").value.trim();
      var hbu = ed.querySelector("#pb-sec-btn-url").value.trim();
      return {
        image: pbReadImageField(ed, "pb-sec-img"),
        heading: ed.querySelector("#pb-sec-heading").value.trim(),
        text: ed.querySelector("#pb-sec-text").value.trim(),
        button: (hbl && hbu) ? { label: hbl, url: hbu } : null
      };
    }
    if (type === "text") {
      return {
        heading: ed.querySelector("#pb-sec-heading").value.trim(),
        text: App.ui.readRichTextField(ed, "pb-sec-text-rt")
      };
    }
    if (type === "image-text") {
      return {
        image: pbReadImageField(ed, "pb-sec-img"),
        imagePosition: ed.querySelector("#pb-sec-imgpos").value,
        imageShape: ed.querySelector("#pb-sec-imgshape").value,
        heading: ed.querySelector("#pb-sec-heading").value.trim(),
        text: App.ui.readRichTextField(ed, "pb-sec-text-rt")
      };
    }
    if (type === "big-image") {
      return {
        image: pbReadImageField(ed, "pb-sec-img"),
        imageShape: ed.querySelector("#pb-sec-imgshape").value,
        caption: ed.querySelector("#pb-sec-caption").value.trim()
      };
    }
    if (type === "quote") {
      return {
        text: ed.querySelector("#pb-sec-text").value.trim(),
        author: ed.querySelector("#pb-sec-author").value.trim(),
        role: ed.querySelector("#pb-sec-role").value.trim()
      };
    }
    if (type === "cta") {
      var cbl = ed.querySelector("#pb-sec-btn-label").value.trim();
      var cbu = ed.querySelector("#pb-sec-btn-url").value.trim();
      return {
        heading: ed.querySelector("#pb-sec-heading").value.trim(),
        text: ed.querySelector("#pb-sec-text").value.trim(),
        button: (cbl && cbu) ? { label: cbl, url: cbu } : null
      };
    }
    return {};
  }

  // Skriv HEILE sida (denne eine, oppdaterte) inn i den ferske "custom-pages"-
  // arrayen -- refetchar FØR skriving (i staden for å stole på ein potensielt
  // gamal array halden i lukking) for å unngå å overskrive ei anna side som
  // vart endra av nokon andre medan denne redigeringa stod open.
  function pbSavePage(wrap, tenantId, page, cb) {
    getStoreKey("custom-pages", function (v) {
      var list = Array.isArray(v) ? v : [];
      var idx = list.findIndex(function (x) { return x.id === page.id; });
      if (idx >= 0) list[idx] = page; else list.push(page);
      brokerCall("set_config", { key: "custom-pages", value: list, tenant_id: tenantId }, function (r) {
        cb(r.error || null);
      });
    });
  }

  // Éin-line-oppsummering av ein seksjon sitt faktiske innhald -- brukt i
  // seksjonslista slik at operatøren kan sjå PÅ SIDA kva som faktisk står
  // der, ikkje berre typenamnet (UX-redesign 2026-08-11, brukartilbakemelding
  // "vanskeleg å forholde seg til" etter fyrste faktiske bruk).
  function pbSectionSummary(s) {
    var d = s.data || {};
    if (s.type === "hero" || s.type === "cta" || s.type === "text" || s.type === "image-text") return d.heading || "(uten overskrift)";
    if (s.type === "big-image") return d.caption || "(uten bildetekst)";
    if (s.type === "quote") return d.text ? "«" + d.text.slice(0, 34) + (d.text.length > 34 ? "…" : "") + "»" : "(uten sitat)";
    if (s.type === "grid") return (d.columns || 3) + " kolonner · " + (d.items || []).length + " ruter";
    if (s.type === "spacer") return "Luft: " + ((s.variant && s.variant.spacing) || "normal");
    if (s.type === "blocks") {
      var n = (d.blocks || []).length;
      var layoutOpt = PB_BLOCKS_LAYOUT_OPTIONS.filter(function (o) { return o[0] === (d.layout || "1col"); })[0];
      var layoutLabel = layoutOpt ? layoutOpt[1] : "1 kolonne";
      return n + " blokk" + (n === 1 ? "" : "er") + " · " + layoutLabel;
    }
    return "";
  }

  // CSS injisert INNI førehandsvisings-iframen (sjå pbRenderPreviewInto under)
  // -- KOPI av module-page-builder.js sin injectStyles()-array (den ekte,
  // publiserte offentleg-side-koden), pluss ein minimal :root med tema-
  // variablar henta frå superconfig sine FAKTISKE farge-/font-val når dei
  // finst (elles nøytrale standardverdiar) og ein forenkla .btn/.btn--*-
  // approksimasjon (den ekte kjem frå index.html sitt globale stilsett, som
  // ALDRI er lasta inni denne isolerte iframen -- CSS-eigenskapar arvar
  // ikkje over ein iframe-grense). MÅ haldast i synk MANUELT med
  // module-page-builder.js sin injectStyles() -- ingen delt fil mellom
  // offentleg side og Console.
  // Security Auditor-funn (BLOCKER, 2026-08-11, uavhengig gjennomgang FØR
  // merge): sc.colors/sc.fonts kjem frå superconfig, som ein KUNDE-ADMIN
  // (lågare tillitsnivå enn ein Console-operatør) fritt kan setje via sin
  // eigen Web-admin ("Design → Fontar" er eit reint fritekstfelt, berre
  // .trim(), ingen allowlist -- sjå core.js). Desse vart tidlegare limt
  // UENDRA inn i ein CSS-streng som gjekk gjennom doc.write() -- ein ekte
  // HTML-parsar, ikkje innerHTML -- så ein verdi som "...';}</style><script>
  // ..." kunne bryte ut av <style>-taggen og KØYRE inne i iframen. Iframen
  // hadde ingen sandbox og delte difor same opphav som Console sjølv,
  // inkludert tilgang til _sbControl sin persistSession:true-token i
  // localStorage -- ein kunde-admin kunne difor i teorien stele ein ekte
  // Console-operatør sin plattform-brei økt. Retta med TO uavhengige lag:
  // (1) streng allowlist her (fargar må sjå ut som #hex, fontnamn eit trygt
  // teiknsett) -- alt anna fell attende til nøytrale standardverdiar; (2) ny
  // sandbox="allow-same-origin" på sjølve <iframe>-en (IKKJE allow-scripts)
  // lenger nede i denne funksjonen sin kallar, som gjer at INGEN skript kan
  // køyre der i det heile, sjølv om ein framtidig ny superconfig-verdi vert
  // limt inn usanert ved ein feil.
  function pbSafeCssColor(v, fallback) {
    return (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v)) ? v : fallback;
  }
  function pbSafeCssFontName(v, fallback) {
    return (typeof v === "string" && /^[\w \-]{1,60}$/.test(v)) ? v : fallback;
  }
  function pbPreviewCss(sc) {
    var col = (sc && sc.colors) || {};
    var fnt = (sc && sc.fonts) || {};
    var vars = ":root{" +
      "--color-primary:" + pbSafeCssColor(col.primary, "#2563eb") + ";" +
      "--color-secondary:" + pbSafeCssColor(col.secondary, "#7c3aed") + ";" +
      "--color-bg:" + pbSafeCssColor(col.background, "#f1f5f9") + ";" +
      "--color-surface:" + pbSafeCssColor(col.surface, "#ffffff") + ";" +
      "--color-text:" + pbSafeCssColor(col.text, "#0f172a") + ";" +
      "--color-muted:#64748b;--color-border:rgba(15,23,42,.12);--color-tint:rgba(37,99,235,.08);--btn-radius:999px;" +
      "--font-display:'" + pbSafeCssFontName(fnt.display, "Inter") + "',system-ui,sans-serif;" +
      "--font-body:'" + pbSafeCssFontName(fnt.body, "Inter") + "',system-ui,sans-serif;" +
    "}";
    var chrome = "*{box-sizing:border-box}body{margin:0;font-family:var(--font-body);color:var(--color-text);background:var(--color-surface);line-height:1.55}" +
      "h1,h2,h3{font-family:var(--font-display)}img{max-width:100%;display:block}" +
      ".btn{display:inline-flex;align-items:center;gap:.5rem;font:inherit;font-weight:600;padding:.8rem 1.4rem;border-radius:var(--btn-radius);border:1.5px solid transparent;text-decoration:none;line-height:1}" +
      ".btn--primary{background:var(--color-primary);color:#fff}" +
      ".btn--ghost{background:transparent;color:var(--color-text);border-color:var(--color-border)}";
    var pb = [
      ".pb-page{}",
      ".pb-sect{padding:3rem var(--gap,1.5rem)}",
      ".pb-sect__inner{max-width:1100px;margin:0 auto}",
      ".pb-sect--w-narrow .pb-sect__inner{max-width:760px}",
      ".pb-sect--sp-small{padding-top:1.5rem;padding-bottom:1.5rem}",
      ".pb-sect--sp-normal{padding-top:3rem;padding-bottom:3rem}",
      ".pb-sect--sp-large{padding-top:5rem;padding-bottom:5rem}",
      ".pb-sect--bg-light{background:var(--color-bg)}",
      ".pb-sect--bg-dark{background:var(--color-text);color:#fff}",
      ".pb-sect--bg-branded{background:var(--color-primary);color:#fff}",
      ".pb-sect--al-center .pb-sect__inner{text-align:center}",
      ".pb-hero{position:relative}",
      ".pb-hero.has-image{border-radius:12px;overflow:hidden}",
      ".pb-hero__img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}",
      ".pb-hero.has-image::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.45),rgba(0,0,0,.3));z-index:0}",
      ".pb-hero__body{position:relative;z-index:1;padding:3rem 1.5rem}",
      ".pb-hero.has-image .pb-hero__body{color:#fff}",
      ".pb-hero__title{font-family:var(--font-display);font-size:clamp(1.5rem,4vw,2.4rem);font-weight:700;margin:0 0 .6rem}",
      ".pb-hero__text{font-size:clamp(.95rem,2vw,1.1rem);line-height:1.6;margin:0 0 1.2rem}",
      ".pb-text__title{font-family:var(--font-display);font-size:1.6rem;margin:0 0 .8rem}",
      ".pb-imgtext{display:flex;gap:2rem;align-items:center}",
      ".pb-imgtext--right{flex-direction:row-reverse}",
      ".pb-imgtext__img{flex:1 1 45%;width:100%;max-width:520px;border-radius:12px;object-fit:cover;aspect-ratio:4/3}",
      ".pb-imgtext__body{flex:1 1 45%;min-width:0}",
      ".pb-imgtext__title{font-family:var(--font-display);font-size:1.5rem;margin:0 0 .8rem}",
      "@media(max-width:700px){.pb-imgtext{flex-direction:column}.pb-imgtext__img{max-width:100%}}",
      ".pb-bigimage__img{width:100%;border-radius:12px;object-fit:cover;max-height:70vh}",
      ".pb-bigimage__caption{font-size:.85rem;color:var(--color-muted);margin:.6rem 0 0;text-align:center}",
      ".pb-quote{border-left:4px solid var(--color-primary);padding-left:1.5rem;margin:0}",
      ".pb-quote__text{font-size:1.3rem;font-style:italic;line-height:1.5;margin:0 0 .8rem}",
      ".pb-quote__author{font-weight:600;font-style:normal}",
      ".pb-quote__role{font-weight:400;color:var(--color-muted)}",
      ".pb-grid{display:grid;gap:1.5rem}",
      ".pb-grid--cols-1{grid-template-columns:repeat(1,1fr)}",
      ".pb-grid--cols-2{grid-template-columns:repeat(2,1fr)}",
      ".pb-grid--cols-3{grid-template-columns:repeat(3,1fr)}",
      ".pb-grid--cols-4{grid-template-columns:repeat(4,1fr)}",
      ".pb-grid__item{background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:1.2rem;overflow:hidden}",
      ".pb-grid__img{width:100%;border-radius:8px;object-fit:cover;aspect-ratio:4/3;margin-bottom:.8rem}",
      ".pb-grid__title{font-size:1.05rem;margin:0 0 .4rem}",
      ".pb-grid__text{font-size:.9rem;color:var(--color-muted);margin:0 0 .6rem}",
      "@media(max-width:900px){.pb-grid--cols-3,.pb-grid--cols-4{grid-template-columns:repeat(2,1fr)}}",
      "@media(max-width:600px){.pb-grid{grid-template-columns:1fr!important}}",
      ".pb-cta__title{font-family:var(--font-display);font-size:1.6rem;margin:0 0 .6rem}",
      ".pb-cta__text{margin:0 0 1.2rem}",
      ".pb-spacer{height:1px}",
      // Blokker -- MÅ haldast synk med den identiske kopien i
      // module-page-builder.js sin injectStyles().
      ".pb-blocks{display:grid;gap:1.5rem}",
      ".pb-blocks--1col{grid-template-columns:1fr}",
      ".pb-blocks--2col{grid-template-columns:1fr 1fr}",
      ".pb-blocks--2col-2-1{grid-template-columns:2fr 1fr}",
      ".pb-blocks--2col-1-2{grid-template-columns:1fr 2fr}",
      ".pb-blocks--3col{grid-template-columns:1fr 1fr 1fr}",
      ".pb-blocks--4col{grid-template-columns:1fr 1fr 1fr 1fr}",
      ".pb-blocks__slot{display:flex;flex-direction:column;gap:1.2rem;min-width:0}",
      ".pb-block-heading{margin:0;font-family:var(--font-display);font-weight:700}",
      ".pb-block-heading--h2{font-size:1.5rem}",
      ".pb-block-heading--h3{font-size:1.15rem}",
      ".pb-block-image__img{width:100%;border-radius:12px;object-fit:cover}",
      ".pb-block-button{margin:.2rem 0}",
      ".pb-block-contact{display:flex;align-items:center;gap:.6rem;font-size:.95rem}",
      ".pb-block-contact a{color:inherit}",
      ".pb-block-spacer{height:1px}",
      ".pb-block--framed{background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:1.2rem}",
      ".pb-blocks__slot--framed{background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:1.2rem}",
      // Biletform -- MÅ haldast synk med den identiske kopien i
      // module-page-builder.js sin injectStyles().
      ".pb-img-shape--square{border-radius:0}",
      ".pb-img-shape--circle{border-radius:50%;aspect-ratio:1/1}",
      "@media(max-width:900px){.pb-blocks--3col,.pb-blocks--4col{grid-template-columns:1fr 1fr}}",
      "@media(max-width:600px){.pb-blocks{grid-template-columns:1fr!important}}"
    ].join("");
    return vars + chrome + pb;
  }

  // Rendrar INN I ei ekte <iframe> (ikkje ein vanleg <div>) -- avgjerande for
  // at mobil-/skrivebord-brytaren under faktisk skal teste rette bruddpunkt.
  // CSS-medieforespørsler reagerer på VINDAUGET sin eigen breidde, ikkje ein
  // vilkårleg indre boks -- eit tidlegare mockup-forsøk brukte ein vanleg,
  // smalna <div>, som ALDRI trigga @media(max-width:600px) osv. i det heile,
  // og synte difor feilaktig eit ustabla rutenett på "mobil" (brukarfunn
  // 2026-08-11, sjå skjermbilete i samtalen). Bruker C.pageSection() DIREKTE
  // -- same, ekte rendringsfunksjon som module-page-builder.js kallar på den
  // faktiske offentlege sida -- så det operatøren ser her ER det som blir
  // publisert, ikkje ein tilnærma kopi.
  function pbRenderPreviewInto(iframeEl, sections, sc) {
    var doc = iframeEl.contentDocument || (iframeEl.contentWindow && iframeEl.contentWindow.document);
    if (!doc) return;
    var body = (sections && sections.length)
      ? '<div class="pb-page">' + sections.map(function (s) { return C.pageSection(s); }).join("") + '</div>'
      : '<div style="padding:3rem 1.5rem;text-align:center;color:#94a3b8;font-size:.9rem">Ingen seksjonar enno — legg til den første i panelet til venstre.</div>';
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"><style>' + pbPreviewCss(sc) + '</style></head><body>' + body + '</body></html>');
    doc.close();
  }

  function renderPageEditor(wrap, tenantId, page, sc) {
    var saveTimer = null;
    var dragFromId = null;

    function doSaveNow() {
      clearTimeout(saveTimer);
      saveTimer = null;
      pbSavePage(wrap, tenantId, page, function (err) {
        var el = wrap.querySelector("#pbc-save-status");
        if (!el) return;
        if (err) { el.className = "pbc-save-status is-error"; el.textContent = err; return; }
        el.className = "pbc-save-status is-ok"; el.textContent = "✓ Alt lagra";
      });
    }

    function scheduleSave() {
      var st = wrap.querySelector("#pbc-save-status");
      if (st) { st.className = "pbc-save-status"; st.textContent = "Lagrar …"; }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(doSaveNow, 700);
    }

    function refreshPreview() {
      var iframe = wrap.querySelector("#pbc-preview-iframe");
      if (iframe) pbRenderPreviewInto(iframe, page.sections || [], sc);
    }

    function findSection(id) { return (page.sections || []).find(function (x) { return x.id === id; }); }

    function sectionEditorFieldsHtml(section) {
      var v = section.variant || {};
      return '<div class="pbc-variant-row">' +
          pbSelectField("pb-sec-bg", "Bakgrunn", [["light", "Lys"], ["dark", "Mørk"], ["branded", "Merkefarge"]], v.background || "light") +
          pbSelectField("pb-sec-width", "Bredde", [["wide", "Bred"], ["narrow", "Smal"]], v.width || "wide") +
          pbSelectField("pb-sec-spacing", "Luft", [["small", "Liten"], ["normal", "Normal"], ["large", "Stor"]], v.spacing || "normal") +
          pbSelectField("pb-sec-align", "Justering", [["left", "Venstre"], ["center", "Sentrert"]], v.align || "left") +
        '</div>' +
        pbSectionDataFieldsHtml(section.type, section.data || {}) +
        '<p class="field__hint">Endringar vert lagra automatisk mens du skriv, og syner i forhåndsvisinga med det same.</p>';
    }

    // Syncar det OPNE seksjonskortet sine skjemaverdiar tilbake til
    // page.sections (in-memory modellen) -- kalla på kvar input/change, FØR
    // refreshPreview()/scheduleSave(), slik at forhåndsvisinga og den
    // faktiske lagringa alltid reflekterer det som faktisk står i felta.
    function syncOpenSectionFromDom(section, cardEl) {
      var ed = cardEl.querySelector(".pbc-section-editor");
      if (!ed) return;
      section.variant = {
        background: ed.querySelector("#pb-sec-bg").value,
        width:      ed.querySelector("#pb-sec-width").value,
        spacing:    ed.querySelector("#pb-sec-spacing").value,
        align:      ed.querySelector("#pb-sec-align").value
      };
      if (section.type === "grid") {
        section.data = section.data || {};
        section.data.columns = parseInt(ed.querySelector("#pb-sec-cols").value, 10) || 3;
        section.data.imageShape = ed.querySelector("#pb-sec-imgshape").value;
      } else if (section.type === "blocks") {
        section.data = section.data || {};
        section.data.layout = ed.querySelector("#pb-sec-blocks-layout").value;
      } else {
        section.data = pbReadSectionDataFields(ed, section.type);
      }
    }

    function bindSectionEditor(section, cardEl) {
      var ed = cardEl.querySelector(".pbc-section-editor");
      if (!ed) return;
      function onFieldChange() { syncOpenSectionFromDom(section, cardEl); updateSummaryInPlace(section); refreshPreview(); scheduleSave(); }
      ed.querySelectorAll("select, input[type=text], input[type=url], textarea").forEach(function (el) {
        el.addEventListener(el.tagName === "SELECT" ? "change" : "input", onFieldChange);
      });
      if (section.type === "hero" || section.type === "image-text" || section.type === "big-image") {
        pbBindImageField(ed, "pb-sec-img", tenantId, onFieldChange);
      }
      if (section.type === "text" || section.type === "image-text") {
        App.ui.bindRichTextFields(ed);
        ed.querySelectorAll(".rtfield__editor").forEach(function (rt) { rt.addEventListener("input", onFieldChange); });
      }
      if (section.type === "grid") {
        section.data = section.data || {};
        section.data.items = Array.isArray(section.data.items) ? section.data.items : [];
        renderGridItems(section, ed);
      }
      if (section.type === "blocks") {
        section.data = section.data || {};
        section.data.layout = section.data.layout || "1col";
        section.data.blocks = Array.isArray(section.data.blocks) ? section.data.blocks : [];
        section.data.colFrame = Array.isArray(section.data.colFrame) ? section.data.colFrame : [];
        renderBlocksEditor(section, ed);
        // Kolonneoppsett-veljaren er alt fanga av den generiske
        // onFieldChange-lyttaren over (oppdaterer section.data.layout FØR
        // denne lyttaren køyrer, sidan han vart registrert først på same
        // element) -- denne re-rendrar berre blokklista slik at "Kolonne"-
        // valet sitt alternativtal og eventuelle no-ugyldige slot-verdiar
        // held seg synkronisert med det nye kolonnetalet.
        var layoutSel = ed.querySelector("#pb-sec-blocks-layout");
        if (layoutSel) layoutSel.addEventListener("change", function () {
          var cols = pbLayoutColCount(section.data.layout);
          section.data.blocks.forEach(function (b) { if ((b.slot || 0) >= cols) b.slot = cols - 1; });
          renderBlocksEditor(section, ed);
        });
      }
    }

    function renderGridItems(section, ed) {
      var box = ed.querySelector("#pb-grid-items");
      if (!box) return;
      var items = section.data.items;
      box.innerHTML = items.map(function (it, i) {
        return '<div class="pbc-grid-item-fields">' +
          '<p class="field__hint" style="margin:0;font-weight:700">Rute ' + (i + 1) + '</p>' +
          pbImageFieldHtml("pb-grid-img-" + i, "Bilde (valgfritt)", it.image) +
          C.field({ id: "pb-grid-heading-" + i, label: "Overskrift (valgfritt)", value: it.heading || "" }) +
          C.field({ id: "pb-grid-text-" + i, label: "Tekst (valgfritt)", value: it.text || "", multiline: true, rows: 2 }) +
          '<div class="pbc-field-grid">' +
            C.field({ id: "pb-grid-btn-label-" + i, label: "Knapptekst (valgfritt)", value: (it.button && it.button.label) || "" }) +
            C.field({ id: "pb-grid-btn-url-" + i, label: "Knapplenke", value: (it.button && it.button.url) || "" }) +
          '</div>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-pb-grid-remove="' + i + '"><i class="ti ti-trash"></i> Fjern rute</button>' +
        '</div>';
      }).join("");
      function readItemsFromDom() {
        items.forEach(function (it, i) {
          it.image = pbReadImageField(box, "pb-grid-img-" + i);
          it.heading = (box.querySelector("#pb-grid-heading-" + i) || {}).value || "";
          it.text = (box.querySelector("#pb-grid-text-" + i) || {}).value || "";
          var bl = ((box.querySelector("#pb-grid-btn-label-" + i) || {}).value || "").trim();
          var bu = ((box.querySelector("#pb-grid-btn-url-" + i) || {}).value || "").trim();
          it.button = (bl && bu) ? { label: bl, url: bu } : null;
        });
      }
      function onItemChange() { readItemsFromDom(); updateSummaryInPlace(section); refreshPreview(); scheduleSave(); }
      box.querySelectorAll("select, input[type=text], input[type=url], textarea").forEach(function (el) {
        el.addEventListener(el.tagName === "SELECT" ? "change" : "input", onItemChange);
      });
      items.forEach(function (it, i) { pbBindImageField(box, "pb-grid-img-" + i, tenantId, onItemChange); });
      box.querySelectorAll("[data-pb-grid-remove]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          readItemsFromDom();
          items.splice(parseInt(btn.getAttribute("data-pb-grid-remove"), 10), 1);
          renderGridItems(section, ed);
          updateSummaryInPlace(section); refreshPreview(); scheduleSave();
        });
      });
      var addBtn = ed.querySelector("#pb-grid-add-item");
      if (addBtn) addBtn.addEventListener("click", function () {
        readItemsFromDom();
        items.push({ image: null, heading: "", text: "", button: null });
        renderGridItems(section, ed);
        updateSummaryInPlace(section); refreshPreview(); scheduleSave();
      });
    }

    // Blokk-redigering inni ei "blocks"-seksjon -- modellert direkte på
    // renderGridItems over (same add/remove/re-render-mønster, muterer
    // section.data.blocks direkte), med éin ny ting utan noko eksisterande
    // mønster å kopiere: SLOT-medviten opp/ned-reorder. Ei "kolonne" kan
    // innehalde fleire blokker stabla i array-rekkjefølgje -- "flytt opp/ned"
    // flyttar ei blokk berre INNANFOR si eiga slot-gruppe, aldri på tvers.
    // Knapp-basert reorder (ikkje dra-og-slipp) -- same mobil-brukbarheits-
    // grunngjeving som alt gjeld for seksjon-nivå reorder.
    function renderBlocksEditor(section, ed) {
      var box = ed.querySelector("#pb-blocks-items");
      if (!box) return;
      var blocks = section.data.blocks;
      var cols = pbLayoutColCount(section.data.layout);
      var slotOptions = [];
      for (var c = 0; c < cols; c++) slotOptions.push([String(c), "Kolonne " + (c + 1)]);

      function blockDef(type) {
        var found = PB_BLOCK_TYPES.filter(function (t) { return t.type === type; })[0];
        return found || { label: type, icon: "square" };
      }
      function sameSlotIndices(slot) {
        var out = [];
        blocks.forEach(function (b, i) { if ((b.slot || 0) === slot) out.push(i); });
        return out;
      }
      function renderBlockCard(i) {
        var b = blocks[i];
        var idp = "pb-block-" + i;
        var group = sameSlotIndices(b.slot || 0);
        var pos = group.indexOf(i);
        var def = blockDef(b.type);
        return '<div class="pbc-block-card">' +
          '<div class="pbc-block-card__head">' +
            '<span class="pbc-block-card__type"><i class="ti ti-' + def.icon + '"></i> ' + C.esc(def.label) + '</span>' +
            '<div class="pbc-mini-actions">' +
              '<button type="button" class="pbc-icon-btn" title="Flytt opp" aria-label="Flytt blokk opp" ' + (pos === 0 ? "disabled" : "") + ' data-pb-block-up="' + i + '"><i class="ti ti-chevron-up"></i></button>' +
              '<button type="button" class="pbc-icon-btn" title="Flytt ned" aria-label="Flytt blokk ned" ' + (pos === group.length - 1 ? "disabled" : "") + ' data-pb-block-down="' + i + '"><i class="ti ti-chevron-down"></i></button>' +
              '<button type="button" class="pbc-icon-btn" title="Dupliser blokk" aria-label="Dupliser blokk" data-pb-block-dup="' + i + '"><i class="ti ti-copy"></i></button>' +
              '<button type="button" class="pbc-icon-btn danger" title="Fjern blokk" aria-label="Fjern blokk" data-pb-block-remove="' + i + '"><i class="ti ti-trash"></i></button>' +
            '</div>' +
          '</div>' +
          (cols > 1 ? pbSelectField(idp + "-slot", "Kolonne", slotOptions, String(b.slot || 0)) : "") +
          pbBlockDataFieldsHtml(b.type, b.data || {}, idp) +
        '</div>';
      }

      // Grupper blokkene visuelt PER KOLONNE, kvar med si eiga "Legg til
      // blokk"-knapp/type-picker -- UX-tilbakemelding 2026-08-12: eit
      // fleirkolonna oppsett synte tidlegare som éi flat liste + éin
      // generisk "Legg til blokk"-knapp som alltid la nye blokker i
      // kolonne 1, med berre eit uklårt "Kolonne"-val for å flytte dei att
      // -- operatøren kunne ikkje sjå/fylle alle N kolonnane direkte. No får
      // kvar kolonne sin eigen, tydeleg avgrensa boks med si eiga "Legg til
      // blokk"-knapp som legg den nye blokka RETT i den kolonnen.
      // "Kolonne"-veljaren på kvart kort står att for å flytte ei
      // EKSISTERANDE blokk til ein annan kolonne seinare.
      var colFrame = section.data.colFrame || [];
      function firstEmptyOtherSlot(srcSlot) {
        for (var o = 0; o < cols; o++) { if (o !== srcSlot && sameSlotIndices(o).length === 0) return o; }
        return -1;
      }
      var colsHtml = "";
      for (var s = 0; s < cols; s++) {
        var idxs = sameSlotIndices(s);
        var cardsHtml = idxs.map(renderBlockCard).join("");
        var headHtml = "";
        if (cols > 1) {
          var hasTarget = idxs.length && firstEmptyOtherSlot(s) !== -1;
          headHtml = '<div class="pbc-blocks-col__head">' +
            '<span>Kolonne ' + (s + 1) + '</span>' +
            (idxs.length ? '<button type="button" class="pbc-icon-btn" ' + (hasTarget ? "" : "disabled") + ' title="' + (hasTarget ? "Dupliser kolonne til ei tom kolonne" : "Ingen tomme kolonner å kopiere til") + '" aria-label="Dupliser kolonne ' + (s + 1) + '" data-pb-blocks-dup-col="' + s + '"><i class="ti ti-copy"></i></button>' : "") +
          '</div>';
        }
        // Brukarønske 2026-08-12 (oppfølging): "frame" på KVAR blokk gjev
        // fleire separate boksar, ikkje éin samanhengande boks rundt heile
        // kolonnen sitt innhald (sjå skjermbilete i tilbakemeldinga). Denne
        // avkryssinga rammar heile kolonnen i éin bolk i staden.
        var frameHtml = idxs.length
          ? '<label class="pbc-blocks-col__frame"><input type="checkbox" data-pb-blocks-colframe="' + s + '"' + (colFrame[s] ? " checked" : "") + '> Ramme inn heile kolonna (bakgrunn og kant)</label>'
          : "";
        colsHtml += '<div class="pbc-blocks-col">' + headHtml + frameHtml +
          '<div class="pbc-blocks-col__list">' + (cardsHtml || '<p class="pbc-blocks-col__empty">Ingen blokker i denne kolonnen enno.</p>') + '</div>' +
          '<button type="button" class="btn btn--ghost btn--sm pbc-blocks-add-trigger" data-pb-blocks-add-slot="' + s + '"><i class="ti ti-plus"></i> Legg til blokk</button>' +
          '<div class="pbc-type-picker" data-pb-blocks-picker-for="' + s + '" style="display:none"></div>' +
        '</div>';
      }
      box.innerHTML = colsHtml;

      function readBlocksFromDom() {
        blocks.forEach(function (b, i) {
          var idp = "pb-block-" + i;
          var slotEl = box.querySelector("#" + idp + "-slot");
          if (slotEl) b.slot = parseInt(slotEl.value, 10) || 0;
          b.data = pbReadBlockDataFields(box, b.type, idp);
        });
      }
      function onBlockChange() { readBlocksFromDom(); updateSummaryInPlace(section); refreshPreview(); scheduleSave(); }
      // UX-funn: "Kolonne"-veljaren (idp+"-slot") flytta FAKTISK blokka i
      // dataen/lagringa korrekt, men kortet vart ikkje visuelt flytta til
      // den nye kolonne-boksen -- det stod urørt att under den GAMLE
      // "Kolonne N"-overskrifta til noko anna (leggje til/fjerne ei blokk,
      // eller opne seksjonen på nytt) tvinga fram ei full re-rendring.
      // Sidan HEILE poenget med denne runda er at operatøren skal SJÅ kva
      // som ligg kvar, må nettopp denne veljaren utløyse ei full
      // renderBlocksEditor()-att-rendring, ikkje berre den generiske
      // onBlockChange() (som aldri rørte DOM-strukturen).
      function onSlotChange() { readBlocksFromDom(); renderBlocksEditor(section, ed); updateSummaryInPlace(section); refreshPreview(); scheduleSave(); }

      box.querySelectorAll("select, input[type=text], input[type=url], textarea").forEach(function (el) {
        var handler = /-slot$/.test(el.id) ? onSlotChange : onBlockChange;
        el.addEventListener(el.tagName === "SELECT" ? "change" : "input", handler);
      });
      // "Ramme inn"-avkryssinga (input[type=checkbox]) er MEDVITE utanfor
      // selektoren over -- ho treng "change", ikkje "input", og var ikkje
      // dekt av det generiske utvalet (som berre fanga select/tekst/url/
      // textarea, sidan ingen av dei 8 faste seksjonstypane har noka
      // avkryssingsboks i sin eigen felt-editor i dag). Kolonne-ramme-
      // avkryssinga (data-pb-blocks-colframe) er MEDVITE UTELATEN her og
      // bunden separat under, sidan ho ikkje høyrer til noka enkelt-blokk
      // og treng skrive til section.data.colFrame, ikkje pbReadBlockDataFields().
      box.querySelectorAll("input[type=checkbox]:not([data-pb-blocks-colframe])").forEach(function (el) {
        el.addEventListener("change", onBlockChange);
      });
      box.querySelectorAll("[data-pb-blocks-colframe]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          var s = parseInt(cb.getAttribute("data-pb-blocks-colframe"), 10);
          section.data.colFrame = section.data.colFrame || [];
          section.data.colFrame[s] = cb.checked;
          refreshPreview(); scheduleSave();
        });
      });
      App.ui.bindRichTextFields(box);
      box.querySelectorAll(".rtfield__editor").forEach(function (rt) { rt.addEventListener("input", onBlockChange); });
      blocks.forEach(function (b, i) {
        if (b.type === "image") pbBindImageField(box, "pb-block-" + i + "-img", tenantId, onBlockChange);
      });

      box.querySelectorAll("[data-pb-block-dup]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          readBlocksFromDom();
          var idx = parseInt(btn.getAttribute("data-pb-block-dup"), 10);
          var copy = JSON.parse(JSON.stringify(blocks[idx]));
          copy.id = pbNewBlockId();
          blocks.splice(idx + 1, 0, copy);
          renderBlocksEditor(section, ed);
          updateSummaryInPlace(section); refreshPreview(); scheduleSave();
        });
      });
      box.querySelectorAll("[data-pb-block-remove]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          readBlocksFromDom();
          var idx = parseInt(btn.getAttribute("data-pb-block-remove"), 10);
          var removedSlot = blocks[idx].slot || 0;
          blocks.splice(idx, 1);
          // UX-polish: om kolonnen no er heilt tom, nullstill eit ev. "ramme
          // heile kolonna"-val for henne -- elles ville ein seinare NY blokk
          // lagt til i same kolonne stille arve eit gamalt ramme-val
          // operatøren aldri fekk stadfesta på nytt.
          if (section.data.colFrame && sameSlotIndices(removedSlot).length === 0) {
            section.data.colFrame[removedSlot] = false;
          }
          renderBlocksEditor(section, ed);
          updateSummaryInPlace(section); refreshPreview(); scheduleSave();
        });
      });
      // Dupliser HEILE kolonna -- kopierer alle blokker i kjeldekolonna inn
      // i den FYRSTE tomme ANDRE kolonna i same seksjon (brukaravklaring
      // 2026-08-12: eksplisitt valt framfor "ny sjølvstendig seksjon" eller
      // å droppe kolonne-duplisering heilt). Disabled/no-op om ingen tom
      // kolonne finst (fastsett ved rendring over, men også dobbeltsjekka
      // her sidan eit synhetisk klikk kan omgå eit HTML disabled-attributt).
      box.querySelectorAll("[data-pb-blocks-dup-col]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var srcSlot = parseInt(btn.getAttribute("data-pb-blocks-dup-col"), 10);
          var targetSlot = firstEmptyOtherSlot(srcSlot);
          if (targetSlot === -1) return;
          readBlocksFromDom();
          var copies = sameSlotIndices(srcSlot).map(function (i) {
            var c = JSON.parse(JSON.stringify(blocks[i]));
            c.id = pbNewBlockId();
            c.slot = targetSlot;
            return c;
          });
          blocks.push.apply(blocks, copies);
          // UX-funn: dupliseringa kopierte tidlegare ALDRI kjeldekolonna sitt
          // eige "Ramme inn heile kolonna"-val -- kopien synte seg difor
          // urframma sjølv om operatøren nettopp bad om å kopiere ei ramma
          // kolonne, ei stille motseiing av det heile "dupliser" skal bety.
          if (section.data.colFrame && section.data.colFrame[srcSlot]) {
            section.data.colFrame[targetSlot] = true;
          }
          renderBlocksEditor(section, ed);
          updateSummaryInPlace(section); refreshPreview(); scheduleSave();
        });
      });
      function moveWithinSlot(idx, dir) {
        readBlocksFromDom();
        var group = sameSlotIndices(blocks[idx].slot || 0);
        var pos = group.indexOf(idx);
        var swapIdx = group[pos + dir];
        if (swapIdx === undefined) return;
        var tmp = blocks[idx]; blocks[idx] = blocks[swapIdx]; blocks[swapIdx] = tmp;
        renderBlocksEditor(section, ed);
        updateSummaryInPlace(section); refreshPreview(); scheduleSave();
      }
      box.querySelectorAll("[data-pb-block-up]").forEach(function (btn) {
        btn.addEventListener("click", function () { moveWithinSlot(parseInt(btn.getAttribute("data-pb-block-up"), 10), -1); });
      });
      box.querySelectorAll("[data-pb-block-down]").forEach(function (btn) {
        btn.addEventListener("click", function () { moveWithinSlot(parseInt(btn.getAttribute("data-pb-block-down"), 10), 1); });
      });

      // "Legg til blokk"-triggarane/-pickerane er no INNI #pb-blocks-items
      // sjølv (éin per kolonne, sett opp over) -- difor vert dei totalt
      // øydelagde og friskt oppretta att KVAR gong box.innerHTML vert sett
      // på nytt over, og lyttarane under vert difor aldri dobbelbundne.
      // Ekte bug retta 2026-08-12: triggeren var FØR denne endringa eit
      // vedvarande søskenelement UTANFOR box (aldri fjerna/gjenskapt), så
      // KVAR renderBlocksEditor()-kalling (dvs. kvar gong ein la til/fjerna/
      // flytta ei blokk) la på ENDÅ EIN "click"-lyttar oppå den same,
      // uendra knappen. Andre gongen operatøren klikka "Legg til blokk"
      // fyrte NO TO lyttarar synkront etter kvarandre på same klikk -- den
      // fyrste opna pickeren, den andre las (feilaktig) det som ei "lukk"-
      // handling og stengde han att i same augeblink, slik at ingenting
      // synte seg å skje. Operatøren måtte minimere/opne seksjonen på nytt
      // (som tvinga fram ei FRISK bindSectionEditor()/renderBlocksEditor()-
      // kalling, og dermed nullstilte lyttar-talet til éin att) for å kunne
      // leggje til éi einaste blokk til.
      box.querySelectorAll("[data-pb-blocks-add-slot]").forEach(function (trigger) {
        var slotIdx = parseInt(trigger.getAttribute("data-pb-blocks-add-slot"), 10);
        var picker = trigger.nextElementSibling;
        if (!picker) return;
        trigger.addEventListener("click", function () {
          var open = picker.style.display !== "none";
          // UX-funn: med éin trigger/picker per kolonne kan fleire
          // type-pickerar no i teorien stå opne samstundes (før denne
          // endringa fanst det berre éin trigger i heile seksjonen) --
          // lukk alle ANDRE opne pickerar FØR denne vert opna.
          box.querySelectorAll('[data-pb-blocks-picker-for]').forEach(function (p) {
            if (p !== picker) p.style.display = "none";
          });
          if (open) { picker.style.display = "none"; return; }
          picker.style.display = "grid";
          picker.innerHTML = PB_BLOCK_TYPES.map(function (t) {
            return '<button type="button" class="pbc-type-card" data-pb-add-block-type="' + t.type + '">' +
              '<span class="pbc-type-card__icon"><i class="ti ti-' + t.icon + '"></i></span>' +
              '<span><span class="pbc-type-card__title">' + C.esc(t.label) + '</span><div class="pbc-type-card__desc">' + C.esc(t.desc) + '</div></span>' +
            '</button>';
          }).join("");
          picker.querySelectorAll("[data-pb-add-block-type]").forEach(function (btn2) {
            btn2.addEventListener("click", function () {
              var type = btn2.getAttribute("data-pb-add-block-type");
              readBlocksFromDom();
              blocks.push({ id: pbNewBlockId(), type: type, slot: slotIdx, data: Object.assign({}, PB_BLOCK_DEFAULTS[type]) });
              renderBlocksEditor(section, ed);
              // UX-funn: flytt fokus inn i den nye blokka sitt fyrste felt --
              // utan dette må ein tastatur-operatør tabbe gjennom heile
              // lista på nytt for å nå fram til det han nettopp la til.
              var newColLists = box.querySelectorAll(".pbc-blocks-col__list");
              var targetList = newColLists[slotIdx];
              var newCards = targetList ? targetList.querySelectorAll(".pbc-block-card") : [];
              var lastCard = newCards[newCards.length - 1];
              var firstField = lastCard && lastCard.querySelector("input, select, textarea, [contenteditable]");
              if (firstField) firstField.focus();
              updateSummaryInPlace(section); refreshPreview(); scheduleSave();
            });
          });
        });
      });
    }

    function updateSummaryInPlace(section) {
      var row = wrap.querySelector('.pbc-section-card[data-id="' + section.id + '"] .pbc-section-meta__summary');
      if (row) row.textContent = pbSectionSummary(section);
    }

    function toggleSection(id) {
      page.sections = (page.sections || []).map(function (s) { return Object.assign({}, s, { open: s.id === id ? !s.open : false }); });
      renderSectionList();
    }

    function bindDragAndDrop() {
      var cards = wrap.querySelectorAll(".pbc-section-card");
      cards.forEach(function (card) {
        card.addEventListener("dragstart", function (e) {
          dragFromId = card.getAttribute("data-id");
          card.classList.add("is-dragging");
          e.dataTransfer.effectAllowed = "move";
        });
        card.addEventListener("dragend", function () {
          card.classList.remove("is-dragging");
          cards.forEach(function (c) { c.classList.remove("drop-before", "drop-after"); });
        });
        card.addEventListener("dragover", function (e) {
          e.preventDefault();
          if (card.getAttribute("data-id") === dragFromId) return;
          var rect = card.getBoundingClientRect();
          var before = (e.clientY - rect.top) < rect.height / 2;
          card.classList.toggle("drop-before", before);
          card.classList.toggle("drop-after", !before);
        });
        card.addEventListener("dragleave", function () { card.classList.remove("drop-before", "drop-after"); });
        card.addEventListener("drop", function (e) {
          e.preventDefault();
          var toId = card.getAttribute("data-id");
          var before = card.classList.contains("drop-before");
          card.classList.remove("drop-before", "drop-after");
          if (!dragFromId || dragFromId === toId) return;
          var list = page.sections || [];
          var fromIdx = list.findIndex(function (s) { return s.id === dragFromId; });
          var moved = list.splice(fromIdx, 1)[0];
          var toIdx = list.findIndex(function (s) { return s.id === toId; });
          if (!before) toIdx += 1;
          list.splice(toIdx, 0, moved);
          page.sections = list;
          dragFromId = null;
          renderSectionList();
          refreshPreview();
          scheduleSave();
        });
      });
    }

    function renderSectionList() {
      var listEl = wrap.querySelector("#pbc-section-list");
      var countEl = wrap.querySelector("#pbc-section-count");
      var sections = page.sections || [];
      if (countEl) countEl.textContent = sections.length + " seksjon" + (sections.length === 1 ? "" : "ar");
      if (!listEl) return;
      if (!sections.length) {
        listEl.innerHTML = '<div class="pbc-empty-sections">Ingen seksjonar enno. Trykk «Legg til seksjon» under for å komme i gang.</div>';
        refreshPreview();
        return;
      }
      listEl.innerHTML = sections.map(function (s, i) {
        var def = PB_SECTION_TYPES.filter(function (t) { return t.type === s.type; })[0] || { label: s.type, icon: "square" };
        return '<div class="pbc-section-card' + (s.open ? " is-open" : "") + '" data-id="' + C.esc(s.id) + '" draggable="' + (s.open ? "false" : "true") + '">' +
          '<div class="pbc-section-row">' +
            '<button type="button" class="pbc-drag-handle" tabindex="0" aria-label="Dra for å flytte «' + C.esc(def.label) + '»"><i class="ti ti-grip-vertical"></i></button>' +
            '<span class="pbc-section-icon"><i class="ti ti-' + def.icon + '"></i></span>' +
            '<button type="button" class="pbc-section-meta" data-pb-toggle="' + C.esc(s.id) + '">' +
              '<div class="pbc-section-meta__type">' + C.esc(def.label) + '</div>' +
              '<div class="pbc-section-meta__summary">' + C.esc(pbSectionSummary(s)) + '</div>' +
            '</button>' +
            '<div class="pbc-mini-actions">' +
              '<button type="button" class="pbc-icon-btn" title="Flytt opp" aria-label="Flytt «' + C.esc(def.label) + '» opp" ' + (i === 0 ? "disabled" : "") + ' data-pb-move-up="' + C.esc(s.id) + '"><i class="ti ti-chevron-up"></i></button>' +
              '<button type="button" class="pbc-icon-btn" title="Flytt ned" aria-label="Flytt «' + C.esc(def.label) + '» ned" ' + (i === sections.length - 1 ? "disabled" : "") + ' data-pb-move-down="' + C.esc(s.id) + '"><i class="ti ti-chevron-down"></i></button>' +
              '<button type="button" class="pbc-icon-btn" title="Dupliser seksjon" aria-label="Dupliser «' + C.esc(def.label) + '»" data-pb-dup-section="' + C.esc(s.id) + '"><i class="ti ti-copy"></i></button>' +
              '<button type="button" class="pbc-icon-btn danger" title="Slett seksjon" aria-label="Slett «' + C.esc(def.label) + '»" data-pb-del-section="' + C.esc(s.id) + '"><i class="ti ti-trash"></i></button>' +
            '</div>' +
          '</div>' +
          (s.open ? '<div class="pbc-section-editor">' + sectionEditorFieldsHtml(s) + '</div>' : "") +
        '</div>';
      }).join("");

      listEl.querySelectorAll("[data-pb-toggle]").forEach(function (btn) {
        btn.addEventListener("click", function () { toggleSection(btn.getAttribute("data-pb-toggle")); });
      });
      listEl.querySelectorAll("[data-pb-move-up]").forEach(function (btn) {
        btn.addEventListener("click", function () { moveSection(btn.getAttribute("data-pb-move-up"), -1); });
      });
      listEl.querySelectorAll("[data-pb-move-down]").forEach(function (btn) {
        btn.addEventListener("click", function () { moveSection(btn.getAttribute("data-pb-move-down"), 1); });
      });
      listEl.querySelectorAll("[data-pb-dup-section]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-pb-dup-section");
          var idx = (page.sections || []).findIndex(function (x) { return x.id === id; });
          if (idx < 0) return;
          var copy = pbCloneSection(page.sections[idx]);
          page.sections.splice(idx + 1, 0, copy);
          renderSectionList();
          refreshPreview();
          scheduleSave();
        });
      });
      listEl.querySelectorAll("[data-pb-del-section]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-pb-del-section");
          if (!confirm("Slett denne seksjonen? Innholdet i seksjonen fjernes fra siden. Dette kan ikke angres.")) return;
          page.sections = (page.sections || []).filter(function (x) { return x.id !== id; });
          renderSectionList();
          refreshPreview();
          scheduleSave();
        });
      });
      sections.forEach(function (s) {
        if (!s.open) return;
        var cardEl = listEl.querySelector('.pbc-section-card[data-id="' + C.esc(s.id) + '"]');
        if (cardEl) bindSectionEditor(s, cardEl);
      });
      bindDragAndDrop();
      refreshPreview();
    }

    function moveSection(id, dir) {
      var list = page.sections || [];
      var idx = list.findIndex(function (x) { return x.id === id; });
      var swapIdx = idx + dir;
      if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
      var tmp = list[idx]; list[idx] = list[swapIdx]; list[swapIdx] = tmp;
      page.sections = list;
      renderSectionList();
      refreshPreview();
      scheduleSave();
    }

    wrap.innerHTML =
      '<div class="pbc-editor-head">' +
        '<div>' +
          '<button type="button" class="btn btn--ghost btn--sm" id="pbc-back" style="margin-bottom:.5rem"><i class="ti ti-arrow-left"></i> Til sider</button>' +
          '<div><input class="pbc-title-input" id="pbc-title" value="' + C.esc(page.label || "") + '" aria-label="Sidetittel"></div>' +
          '<div class="pbc-editor-sub">' +
            '<span>#' + C.esc(page.id) + '</span>' +
            '<label><input type="checkbox" id="pbc-navhidden"' + (page.navHidden ? " checked" : "") + '> Skjul frå toppmeny</label>' +
          '</div>' +
        '</div>' +
        '<div class="pbc-editor-actions">' +
          '<span class="pbc-live-pill"><span class="pbc-live-pill__dot" aria-hidden="true"></span>Live på nettstedet</span>' +
          '<span class="pbc-save-status is-ok" id="pbc-save-status">✓ Alt lagra</span>' +
          // UX-tilbakemelding 2026-08-11: "Sjølv om det ofte er auto-lagring,
          // så trur eg også ein lagreknapp er lurt" -- ein eksplisitt knapp
          // GJEV IKKJE eit anna resultat enn autolagringa (same doSaveNow()),
          // berre trygdar operatøren utan å måtte vente på debounce-en.
          C.button({ label: "Lagre no", variant: "ghost", class: "btn--sm", attrs: 'id="pbc-save-now"' }) +
          C.button({ label: "Slett side", variant: "ghost", class: "btn--sm", attrs: 'id="pbc-del-page" style="color:#c0392b;border-color:#c0392b"' }) +
        '</div>' +
      '</div>' +
      '<div class="pbc-workspace">' +
        // UX-tilbakemelding 2026-08-11: forhåndsvisinga ligg no FØRST i
        // DOM-en, alltid i full breidde, og STARTAR MINIMERT som standard
        // -- eit tidlegare sidestilt to-kolonne-forsøk let kolonnebreidda
        // stå urørt sjølv når minimert, som berre skapte tomt, ubrukt rom
        // ("veldig tullete"). Eit stabla, alltid-full-breidde oppsett gjer
        // at minimering faktisk fjernar plassen ho tok, ikkje berre
        // innhaldet inni ho.
        '<div class="pbc-panel pbc-preview-panel is-minimized" id="pbc-preview-panel">' +
          '<div class="pbc-panel__head">' +
            '<h4>Forhåndsvisning</h4>' +
            '<div class="pbc-preview-toolbar">' +
              '<span class="pbc-preview-width-label" id="pbc-pv-width-label">Skrivebord</span>' +
              '<button type="button" class="is-active" id="pbc-pv-desktop" aria-label="Skrivebordsbredde" title="Skrivebord"><i class="ti ti-device-desktop"></i></button>' +
              '<button type="button" id="pbc-pv-mobile" aria-label="Mobilbredde" title="Mobil"><i class="ti ti-device-mobile"></i></button>' +
              '<button type="button" id="pbc-pv-toggle" aria-label="Vis forhåndsvisning" aria-expanded="false" title="Vis forhåndsvisning"><i class="ti ti-chevron-down"></i></button>' +
            '</div>' +
          '</div>' +
          '<div class="pbc-preview-frame-wrap"><iframe class="pbc-preview-frame" id="pbc-preview-iframe" title="Forhåndsvisning av siden" sandbox="allow-same-origin"></iframe></div>' +
        '</div>' +
        '<div class="pbc-panel">' +
          '<div class="pbc-panel__head"><h4>Seksjonar</h4><span class="pbc-panel__head-hint" id="pbc-section-count"></span></div>' +
          '<div class="pbc-section-list" id="pbc-section-list"></div>' +
          '<div class="pbc-add-section">' +
            '<button type="button" class="pbc-add-trigger" id="pbc-add-trigger"><i class="ti ti-plus"></i> Legg til seksjon</button>' +
            '<div class="pbc-type-picker" id="pbc-type-picker" style="display:none"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    wrap.querySelector("#pbc-back").addEventListener("click", function () {
      getStoreKey("custom-pages", function (v) { renderPagesList(wrap, tenantId, Array.isArray(v) ? v : [], sc); });
    });
    wrap.querySelector("#pbc-title").addEventListener("input", function () {
      page.label = this.value.trim();
      scheduleSave();
    });
    wrap.querySelector("#pbc-navhidden").addEventListener("change", function () {
      page.navHidden = this.checked;
      scheduleSave();
    });
    wrap.querySelector("#pbc-save-now").addEventListener("click", function () {
      var st = wrap.querySelector("#pbc-save-status");
      if (st) { st.className = "pbc-save-status"; st.textContent = "Lagrar …"; }
      doSaveNow();
    });
    wrap.querySelector("#pbc-del-page").addEventListener("click", function () {
      if (!confirm('Slett siden «' + (page.label || "siden") + '»? Alle seksjonene og innstillingene for denne siden fjernes, og siden («#' + page.id + '») blir utilgjengelig for besøkende. Dette kan ikke angres.')) return;
      getStoreKey("custom-pages", function (v) {
        var list = (Array.isArray(v) ? v : []).filter(function (x) { return x.id !== page.id; });
        brokerCall("set_config", { key: "custom-pages", value: list, tenant_id: tenantId }, function (r) {
          if (r.error) { alert(r.error); return; }
          renderPagesList(wrap, tenantId, list, sc);
        });
      });
    });
    wrap.querySelector("#pbc-add-trigger").addEventListener("click", function () {
      var picker = wrap.querySelector("#pbc-type-picker");
      var open = picker.style.display !== "none";
      if (open) { picker.style.display = "none"; return; }
      picker.style.display = "grid";
      picker.innerHTML = PB_SECTION_TYPES.map(function (t) {
        return '<button type="button" class="pbc-type-card" data-pb-add-type="' + t.type + '">' +
          '<span class="pbc-type-card__icon"><i class="ti ti-' + t.icon + '"></i></span>' +
          '<span><span class="pbc-type-card__title">' + C.esc(t.label) + '</span><div class="pbc-type-card__desc">' + C.esc(t.desc) + '</div></span>' +
        '</button>';
      }).join("");
      picker.querySelectorAll("[data-pb-add-type]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var type = btn.getAttribute("data-pb-add-type");
          var defaults = {
            hero: { image: null, heading: "Ny overskrift", text: "", button: null },
            text: { heading: "", text: "" },
            "image-text": { image: null, imagePosition: "left", imageShape: "rounded", heading: "", text: "" },
            "big-image": { image: null, imageShape: "rounded", caption: "" },
            quote: { text: "", author: "", role: "" },
            grid: { columns: 3, imageShape: "rounded", items: [] },
            cta: { heading: "Ny overskrift", text: "", button: null },
            spacer: {},
            blocks: { layout: "1col", blocks: [] }
          };
          page.sections = page.sections || [];
          page.sections = page.sections.map(function (s) { return Object.assign({}, s, { open: false }); });
          page.sections.push({ id: pbNewSectionId(), type: type, open: true, variant: { background: "light", width: "wide", spacing: "normal", align: "left" }, data: defaults[type] });
          picker.style.display = "none";
          renderSectionList();
          refreshPreview();
          scheduleSave();
        });
      });
    });
    wrap.querySelector("#pbc-pv-desktop").addEventListener("click", function () {
      wrap.querySelector("#pbc-preview-iframe").classList.remove("w-mobile");
      this.classList.add("is-active");
      wrap.querySelector("#pbc-pv-mobile").classList.remove("is-active");
      wrap.querySelector("#pbc-pv-width-label").textContent = "Skrivebord";
    });
    wrap.querySelector("#pbc-pv-mobile").addEventListener("click", function () {
      wrap.querySelector("#pbc-preview-iframe").classList.add("w-mobile");
      this.classList.add("is-active");
      wrap.querySelector("#pbc-pv-desktop").classList.remove("is-active");
      wrap.querySelector("#pbc-pv-width-label").textContent = "Mobil (~380px)";
    });
    wrap.querySelector("#pbc-pv-toggle").addEventListener("click", function () {
      var panel = wrap.querySelector("#pbc-preview-panel");
      var minimized = panel.classList.toggle("is-minimized");
      this.setAttribute("aria-expanded", String(!minimized));
      this.setAttribute("aria-label", minimized ? "Vis forhåndsvisning" : "Minimer forhåndsvisning");
      this.setAttribute("title", minimized ? "Vis forhåndsvisning" : "Minimer forhåndsvisning");
      this.innerHTML = '<i class="ti ti-chevron-' + (minimized ? "down" : "up") + '"></i>';
    });

    renderSectionList();
  }

  function renderPagesList(wrap, tenantId, pages, sc) {
    wrap.innerHTML =
      '<div class="admin-group">' +
        '<h3 style="margin:0">Sider</h3>' +
        '<p class="field__hint" style="margin:.2rem 0 .8rem">Ekstrasider bygd av kontrollerte seksjonar (hero, tekst, bilde, rutenett osv.) — same mønster som Mediabank/Aktuelt, egen side med egen URL. Kunden kan ikke redigere selv ennå.</p>' +
        // Nivå B-inline (docs/architecture/copy-style-guide.md) -- UX-funn
        // 2026-08-11: ingen stad synte at Sidebygger manglar kladd/publisert i
        // det heile. Alt Console lagrar her går live UMIDDELBART på den ekte
        // offentlege sida, same risikoprofil som ei kvar anna Console-lagring,
        // men utan noka gjennomgangs- eller angrestег -- må difor seiast
        // eksplisitt, ikkje berre antakast forstått.
        '<div class="i-notice i-notice--warn" style="margin-bottom:1rem;padding:.8rem 1rem;border:1.5px solid #E8833A;border-radius:8px;background:color-mix(in srgb,#E8833A 10%,transparent);font-size:.88rem">' +
          '<strong>⚠️ Ingen kladd eller forhåndsvisning i denne versjonen.</strong> Alt du oppretter eller endrar her, blir umiddelbart synleg for besøkjande på det offentlege nettstedet med det same du lagrar.' +
        '</div>' +
        '<form id="pb-new-form" style="display:flex;gap:.6rem;align-items:flex-end;margin-bottom:1rem;flex-wrap:wrap">' +
          '<div style="flex:1;min-width:200px">' + C.field({ id: "pb-new-title", label: "Ny side", placeholder: "F.eks. Jobb hos oss" }) + '</div>' +
          '<button type="submit" class="btn btn--primary btn--sm">Opprett side</button>' +
        '</form>' +
        '<p class="form__status" id="pb-new-status"></p>' +
        '<div id="pb-list">' +
          (pages.length
            ? pages.map(function (p) {
                var icons = (p.sections || []).slice(0, 6).map(function (s) {
                  var def = PB_SECTION_TYPES.filter(function (t) { return t.type === s.type; })[0] || { icon: "square" };
                  return '<span title="' + C.esc(def.label || s.type) + '"><i class="ti ti-' + def.icon + '"></i></span>';
                }).join("");
                return '<div class="kd-card" style="display:flex;align-items:center;justify-content:space-between;gap:.8rem;flex-wrap:wrap">' +
                  '<div>' +
                    '<strong>' + C.esc(p.label || p.id) + '</strong>' +
                    '<p class="field__hint" style="margin:.2rem 0 0">#' + C.esc(p.id) + ' · ' + ((p.sections || []).length) + ' seksjonar' + (p.navHidden ? " · skjult frå meny" : "") + '</p>' +
                    (icons ? '<div class="pbc-page-card__types">' + icons + '</div>' : "") +
                  '</div>' +
                  '<div style="display:flex;gap:.4rem">' +
                    C.button({ label: "Rediger", variant: "ghost", class: "btn--sm", attrs: 'data-pb-edit-page="' + C.esc(p.id) + '"' }) +
                    C.button({ label: "Slett", variant: "ghost", class: "btn--sm", attrs: 'data-pb-del-page="' + C.esc(p.id) + '"' }) +
                  '</div>' +
                '</div>';
              }).join("")
            : '<p class="field__hint">Ingen sider oppretta enno.</p>'
          ) +
        '</div>' +
      '</div>';

    wrap.querySelector("#pb-new-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var title = wrap.querySelector("#pb-new-title").value.trim();
      var out = wrap.querySelector("#pb-new-status");
      if (!title) { statusMsg(out, "Tittel er påkrevd", false); return; }
      var id = pbUniquePageId(pbSlugify(title), pages.map(function (p) { return p.id; }));
      var now = new Date().toISOString();
      var newPage = { id: id, label: title, order: 60, navHidden: false, locked: true, createdAt: now, updatedAt: now, sections: [] };
      var list = pages.concat([newPage]);
      statusMsg(out, "Oppretter …", true);
      brokerCall("set_config", { key: "custom-pages", value: list, tenant_id: tenantId }, function (r) {
        if (r.error) { statusMsg(out, r.error, false); return; }
        renderPageEditor(wrap, tenantId, newPage, sc);
      });
    });

    wrap.querySelectorAll("[data-pb-edit-page]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = pages.find(function (x) { return x.id === btn.getAttribute("data-pb-edit-page"); });
        if (p) renderPageEditor(wrap, tenantId, p, sc);
      });
    });
    wrap.querySelectorAll("[data-pb-del-page]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-pb-del-page");
        var p = pages.find(function (x) { return x.id === id; });
        if (!p) return;
        if (!confirm('Slett siden «' + (p.label || "siden") + '»? Alle seksjonene og innstillingene for denne siden fjernes, og siden («#' + p.id + '») blir utilgjengelig for besøkende. Dette kan ikke angres.')) return;
        var list = pages.filter(function (x) { return x.id !== id; });
        brokerCall("set_config", { key: "custom-pages", value: list, tenant_id: tenantId }, function (r) {
          if (r.error) { alert(r.error); return; }
          renderPagesList(wrap, tenantId, list, sc);
        });
      });
    });
  }

  function renderSidebyggerSider(sc, wrap) {
    var tenantId = _activeTenant && _activeTenant.id;
    var myGen = _renderGen;
    getStoreKey("custom-pages", function (v) {
      if (myGen !== _renderGen) return; // avløyst av ein seinare navigate()/tenant-byte
      renderPagesList(wrap, tenantId, Array.isArray(v) ? v : [], sc);
    });
  }

  function renderPriserEdit(wrap) {
    // Held fast på valet mellom render (t.d. etter eit felt-endring-triggra
    // re-render) -- fell attende til fyrste pakke viss valet ikkje lenger
    // finst (sletta pakke, eller aller fyrste render denne økta).
    if (!_priserEditSelected || !_priserData.packages.some(function (p) { return p.id === _priserEditSelected; })) {
      _priserEditSelected = _priserData.packages.length ? _priserData.packages[0].id : null;
    }
    var selected = _priserData.packages.find(function (p) { return p.id === _priserEditSelected; });

    wrap.innerHTML =
      '<div class="edit-layout">' +
        '<div class="pkg-rail">' +
          '<div class="pkg-rail__head">Pakker (' + _priserData.packages.length + ')</div>' +
          _priserData.packages.map(function (p, i) { return priserPkgRailRowHtml(p, p.id === _priserEditSelected, i === 0, i === _priserData.packages.length - 1); }).join("") +
          '<button type="button" class="pkg-rail__add" id="priser-add-pkg"><span class="plus">+</span> Ny pakke</button>' +
        '</div>' +
        (selected
          ? priserEditPanelHtml(selected)
          : '<div class="edit-panel"><div class="edit-panel__body"><p style="color:var(--color-muted);margin:0">Ingen pakker ennå — legg til en for å komme i gang.</p></div></div>') +
      '</div>' +
      // "Lagre alle endringer" lagrar HEILE pakke-lista, ikkje berre den opne
      // pakken -- held han difor på sidenivå, utanfor .edit-layout, i staden
      // for inni panelet til den valde pakken (UX-review-funn 2026-08-04:
      // plassert saman med eit pakke-spesifikt "Fjern pakke" ga inntrykk av
      // at lagringa berre gjaldt den eine, opne pakken).
      priserSaveRowHtml();

    priserBindPkgEvents(wrap);
    priserBindSaveRow(wrap);
    wrap.querySelectorAll("[data-priser-select]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        _priserEditSelected = btn.getAttribute("data-priser-select");
        renderPriserEdit(wrap);
        // Behald tastaturfokus på den valde rada (UX-review-funn 2026-08-04:
        // eit fullt re-render her mista fokuset heilt, ulikt resten av fana
        // sin eksisterande priserRerenderEditPreservingFocus()-disiplin).
        var newBtn = wrap.querySelector('[data-priser-select="' + _priserEditSelected + '"]');
        if (newBtn) newBtn.focus();
      });
    });
    function priserMovePkg(id, delta) {
      var idx = _priserData.packages.findIndex(function (p) { return p.id === id; });
      var target = idx + delta;
      if (idx < 0 || target < 0 || target >= _priserData.packages.length) return;
      var arr = _priserData.packages;
      var tmp = arr[idx]; arr[idx] = arr[target]; arr[target] = tmp;
      renderPriserEdit(wrap);
      // Behald tastaturfokus på den same knappen (same disiplin/grunngjeving
      // som data-priser-select over) -- elles hoppar fokus til <body> ved
      // kvar flytting, plagsamt for ein tastaturbrukar som flytter éi pakke
      // fleire hakk på rad.
      var again = wrap.querySelector('[data-priser-move-' + (delta > 0 ? "down" : "up") + '="' + id + '"]');
      if (again && !again.disabled) again.focus();
    }
    wrap.querySelectorAll("[data-priser-move-up]").forEach(function (btn) {
      btn.addEventListener("click", function () { priserMovePkg(btn.getAttribute("data-priser-move-up"), -1); });
    });
    wrap.querySelectorAll("[data-priser-move-down]").forEach(function (btn) {
      btn.addEventListener("click", function () { priserMovePkg(btn.getAttribute("data-priser-move-down"), 1); });
    });
    wrap.querySelector("#priser-add-pkg").addEventListener("click", function () {
      var pkg = {
        id: "p" + (_priserPkgIdSeq++) + "-" + Date.now().toString(36), name: "Ny pakke", price: 0, setupCost: 0, desc: "",
        features: [], iFeatures: [], tags: { f: {}, i: {} }, allStandardF: false, allStandardI: false, priceOnRequest: false,
        featured: false, badgeText: "Mest valgt", badgeColor: "#2563eb"
      };
      priserBackfillCaps(pkg);
      _priserData.packages.push(pkg);
      _priserEditSelected = pkg.id;
      renderPriserEdit(wrap);
      // Rett i "Pakkenavn"-feltet -- vesentleg meir nyttig enn å måtte klikke
      // seg inn manuelt kvar gong ein legg til ei ny pakke (UX-review-forslag
      // 2026-08-04), no som berre éitt panel er synleg om gongen.
      var nameInput = wrap.querySelector('[data-priser-field="name"][data-priser-pkg="' + pkg.id + '"]');
      if (nameInput) { nameInput.focus(); nameInput.select(); }
    });
  }

  function priserBindPkgEvents(wrap) {
    wrap.querySelectorAll("[data-priser-field]").forEach(function (el) {
      var evt = el.type === "checkbox" ? "change" : "input";
      el.addEventListener(evt, function () {
        var pkg = _priserData.packages.find(function (p) { return p.id === el.getAttribute("data-priser-pkg"); });
        var field = el.getAttribute("data-priser-field");
        if (field === "featured" || field === "allStandardF" || field === "allStandardI" || field === "priceOnRequest") {
          pkg[field] = el.checked;
          priserRerenderEditPreservingFocus(wrap); // re-render for å vise/skjule avhengige felt/lister, utan å miste fokus
          return;
        }
        if (field === "badgeColor") {
          pkg.badgeColor = priserSafeHex(el.value);
          // Same "punktoppdater rada, ikkje re-render"-mønster som namn/pris
          // (UX-review-funn 2026-08-04: utan dette heldt rad-prikken fram
          // med å vise den gamle fargen heilt til noko anna utløyste eit
          // fullt re-render av panelet).
          var dotEl = wrap.querySelector('[data-priser-select="' + pkg.id + '"] .pkg-row__dot');
          if (dotEl) dotEl.style.background = pkg.badgeColor;
          return;
        }
        pkg[field] = (field === "price" || field === "setupCost") ? (Number(el.value) || 0) : el.value;
        // Namn/pris vises óg i pakke-lista og panel-tittelen (master/detail) --
        // punktoppdaterer BERRE dei to tekstnodane her i staden for eit fullt
        // renderPriserEdit()-kall, same "aldri re-render på kvart tastetrykk"-
        // disiplin som resten av fana (UX-review-funn 2026-08-04).
        if (field === "name" || field === "price") {
          var railRow = wrap.querySelector('[data-priser-select="' + pkg.id + '"]');
          if (field === "name") {
            var titleEl = wrap.querySelector(".edit-panel__title");
            if (titleEl) titleEl.textContent = pkg.name || "(uten navn)";
            if (railRow) railRow.querySelector(".pkg-row__name").textContent = pkg.name || "(uten navn)";
          } else if (railRow) {
            railRow.querySelector(".pkg-row__price").textContent = priserFmtPrice(pkg.price) + " kr/mnd";
          }
        }
        if (field === "price" || field === "setupCost") {
          // "Spar kr X"-linja (brukarønske 2026-08-05) må halde seg synkron
          // medan admin skriv, same punktoppdaterings-disiplin som namn/pris
          // over -- elles ville ho vist eit forelda tal heilt til neste fulle
          // re-render (t.d. "Hent priser" eller pakkebyte).
          var savingsEl = wrap.querySelector('[data-priser-savings="' + pkg.id + '"]');
          if (savingsEl) {
            var freshSum = priserSum(priserEffectiveKeys(pkg, "f"), priserEffectiveKeys(pkg, "i"));
            var text = priserSavingsText(pkg, freshSum);
            savingsEl.hidden = !text;
            if (text) savingsEl.textContent = text + " sammenlignet med modulsum";
          }
        }
      });
    });
    // "Hent priser" (brukarønske 2026-08-05) -- set pkg.price/setupCost til
    // den FERSKE modulsummen (same priserSum()-kall som allereie driv
    // "Veiledande sum"-hjelpeteksten), og re-rendrar for å vise det nye
    // tallet. Eit re-render her er trygt/enkelt (ikkje eit tastetrykk-per-
    // tastetrykk-tilfelle som elles krev punktoppdatering) sidan dette berre
    // skjer ved eit diskret knappeklikk.
    wrap.querySelectorAll("[data-priser-fetch-price]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pkg = _priserData.packages.find(function (p) { return p.id === btn.getAttribute("data-priser-fetch-price"); });
        if (!pkg) return;
        var sum = priserSum(priserEffectiveKeys(pkg, "f"), priserEffectiveKeys(pkg, "i"));
        pkg.price = sum.monthly;
        priserRerenderEditPreservingFocus(wrap);
      });
    });
    wrap.querySelectorAll("[data-priser-fetch-setup]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pkg = _priserData.packages.find(function (p) { return p.id === btn.getAttribute("data-priser-fetch-setup"); });
        if (!pkg) return;
        var sum = priserSum(priserEffectiveKeys(pkg, "f"), priserEffectiveKeys(pkg, "i"));
        pkg.setupCost = sum.setup;
        priserRerenderEditPreservingFocus(wrap);
      });
    });
    wrap.querySelectorAll("[data-priser-cap]").forEach(function (input) {
      input.addEventListener("input", function () {
        var pkg = _priserData.packages.find(function (p) { return p.id === input.getAttribute("data-priser-pkg"); });
        pkg[input.getAttribute("data-priser-cap")] = Math.min(1000000, Math.max(0, Number(input.value) || 0));
      });
    });
    wrap.querySelectorAll("[data-priser-cap-unlimited]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var pkg = _priserData.packages.find(function (p) { return p.id === cb.getAttribute("data-priser-pkg"); });
        var key = cb.getAttribute("data-priser-cap-unlimited");
        if (cb.checked) {
          pkg[key] = -1;
        } else {
          var def = priserDefaultCapsFor(pkg)[key];
          pkg[key] = def === -1 ? 0 : def;
        }
        priserRerenderEditPreservingFocus(wrap); // felt vert aktivert/deaktivert -- treng re-render
      });
    });
    wrap.querySelectorAll("[data-priser-feat]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var pkg = _priserData.packages.find(function (p) { return p.id === cb.getAttribute("data-priser-pkg"); });
        var group = cb.getAttribute("data-priser-group");
        var key = cb.getAttribute("data-priser-feat");
        var list = group === "f" ? pkg.features : pkg.iFeatures;
        var idx = list.indexOf(key);
        if (cb.checked && idx === -1) list.push(key);
        if (!cb.checked && idx > -1) { list.splice(idx, 1); delete pkg.tags[group][key]; }
        priserRerenderEditPreservingFocus(wrap); // re-render slik at tag-feltet vises/skjules riktig, utan å miste fokus
      });
    });
    wrap.querySelectorAll("[data-priser-tag-key]").forEach(function (input) {
      input.addEventListener("input", function () {
        var pkg = _priserData.packages.find(function (p) { return p.id === input.getAttribute("data-priser-tag-pkg"); });
        var group = input.getAttribute("data-priser-tag-group");
        var key = input.getAttribute("data-priser-tag-key");
        pkg.tags[group][key] = input.value;
      });
    });
    // Tier B-stadfesting (UX-review-funn 2026-08-04) -- fjerning her hadde
    // ingen bekreftelse i det heile, ulikt kvar annan destruktiv handling i
    // denne fila (modul-fjerning linje ~1478, kunde-arkivering linje ~2639).
    wrap.querySelectorAll("[data-priser-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-priser-del");
        var pkg = _priserData.packages.find(function (p) { return p.id === id; });
        var navn = (pkg && pkg.name) || "denne pakken";
        if (!confirm('Fjerne pakken «' + navn + '»? Alt innhold i den (pris, oppstartskostnad, beskrivelse, valgte moduler og tags) forsvinner fra denne oversikten med det samme. Endringen blir permanent først når du trykker «Lagre alle endringer» — til da kan du fortsatt angre ved å ikke lagre. Er du sikker?')) return;
        _priserData.packages = _priserData.packages.filter(function (p) { return p.id !== id; });
        renderPriserEdit(wrap);
      });
    });
  }

  function renderPriserPrices(wrap) {
    function row(key, label, ns) {
      var p = priserPriceEntry(ns, key);
      return '<tr>' +
        '<td>' + C.esc(label) + '</td>' +
        '<td><label style="display:inline-flex;padding:.5rem;cursor:pointer"><input type="checkbox" data-priser-standard-ns="' + ns + '" data-priser-standard-key="' + C.esc(key) + '" ' + (p.standard ? "checked" : "") + '></label></td>' +
        '<td><input type="number" min="0" data-priser-price-ns="' + ns + '" data-priser-price-key="' + C.esc(key) + '" data-priser-price-field="monthly" value="' + p.monthly + '"></td>' +
        '<td><input type="number" min="0" data-priser-price-ns="' + ns + '" data-priser-price-key="' + C.esc(key) + '" data-priser-price-field="setup" value="' + p.setup + '"></td>' +
      '</tr>';
    }
    wrap.innerHTML =
      '<p class="preview-note">Denne listen er kilden pakkene og «Bygg tilbud» henter priser og standard/tillegg-status fra.</p>' +
      '<div class="price-table-wrap"><table class="price-table">' +
        '<thead><tr><th>Modul</th><th>Standard</th><th>Månedspris (kr)</th><th>Oppstartskostnad (kr, engang)</th></tr></thead>' +
        '<tbody>' +
          '<tr class="group-row"><td colspan="4">Nettside-/Web-admin-funksjoner</td></tr>' +
          Object.keys(PRISER_F_LABELS).map(function (k) { return row(k, PRISER_F_LABELS[k], "f"); }).join("") +
          '<tr class="group-row"><td colspan="4">Workspace-funksjoner</td></tr>' +
          Object.keys(PRISER_I_LABELS).map(function (k) { return row(k, PRISER_I_LABELS[k], "i"); }).join("") +
        '</tbody>' +
      '</table></div>' +
      priserSaveRowHtml();

    wrap.querySelectorAll("[data-priser-price-key]").forEach(function (input) {
      input.addEventListener("input", function () {
        var ns = input.getAttribute("data-priser-price-ns"), key = input.getAttribute("data-priser-price-key"), field = input.getAttribute("data-priser-price-field");
        priserPriceEntry(ns, key); // sikrar at objektet finst før vi skriv i det
        if (!_priserData.prices[ns][key]) _priserData.prices[ns][key] = { monthly: 0, setup: 0, standard: true };
        _priserData.prices[ns][key][field] = Number(input.value) || 0;
      });
    });
    wrap.querySelectorAll("[data-priser-standard-key]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var ns = cb.getAttribute("data-priser-standard-ns"), key = cb.getAttribute("data-priser-standard-key");
        if (!_priserData.prices[ns][key]) _priserData.prices[ns][key] = { monthly: 0, setup: 0, standard: true };
        _priserData.prices[ns][key].standard = cb.checked;
      });
    });
    priserBindSaveRow(wrap);
  }

  function priserQuoteChip(key, label, ns) {
    var p = priserPriceEntry(ns, key);
    var added = _priserQuote[ns].indexOf(key) > -1;
    var help = priserHelpFor(ns, key);
    return '<div class="quote-chip' + (added ? " is-added" : "") + '">' +
      '<span>' + C.esc(label) + (help ? C.helpIcon(help) : "") + '<span class="quote-chip__meta"> — ' + priserFmtPrice(p.monthly) + ' kr/mnd, ' + priserFmtPrice(p.setup) + ' kr oppstart</span></span>' +
      (added
        ? '<button type="button" class="quote-chip__rm" data-priser-q-rm="' + ns + ":" + C.esc(key) + '">Fjern</button>'
        : '<button type="button" class="quote-chip__add" data-priser-q-add="' + ns + ":" + C.esc(key) + '">+ Legg til</button>') +
    '</div>';
  }

  function priserQuoteCartGroupHtml(title, items) {
    if (!items.length) return "";
    return '<div class="feat-section-title" style="margin-top:.6rem">' + title + '</div><ul>' + items.map(function (it) {
      return '<li><span>' + C.esc(it.label) + '</span><span>' + priserFmtPrice(it.monthly) + ' kr/mnd</span>' +
        '<button type="button" class="quote-chip__rm" data-priser-q-rm="' + it.ns + ":" + C.esc(it.key) + '" aria-label="Fjern ' + C.esc(it.label) + '">×</button></li>';
    }).join("") + '</ul>';
  }

  // Oppdaterer BERRE sum-tala, ikkje heile paneet -- brukt av
  // "Generell oppstartskostnad"-feltet sin egen input-handsamar (UX-review-
  // funn 2026-08-04: eit fullt wrap.innerHTML-kall på kvart tastetrykk
  // øydelegg og skaper feltet på nytt, som gjer at tastaturfokus forsvinn
  // etter kvar einaste teikn -- reelt sett umogleg å skrive inn eit tal).
  function priserRefreshQuoteTotals(wrap) {
    var sum = priserSum(_priserQuote.f, _priserQuote.i);
    var extra = _priserQuote.extraSetup || 0;
    var totalsEl = wrap.querySelector("#priser-quote-totals");
    if (!totalsEl) return;
    totalsEl.innerHTML =
      '<div class="quote-cart__row"><span>Moduler, sum/mnd</span><span>' + priserFmtPrice(sum.monthly) + ' kr</span></div>' +
      '<div class="quote-cart__row"><span>Oppstartskostnad (moduler)</span><span>' + priserFmtPrice(sum.setup) + ' kr</span></div>' +
      '<div class="quote-cart__row"><span>Generell oppstartskostnad</span><span>' + priserFmtPrice(extra) + ' kr</span></div>' +
      '<div class="quote-cart__row is-total"><span>Totalt per måned</span><span>' + priserFmtPrice(sum.monthly) + ' kr</span></div>' +
      '<div class="quote-cart__row is-total"><span>Totalt oppstart</span><span>' + priserFmtPrice(sum.setup + extra) + ' kr</span></div>';
  }

  function renderPriserQuote(wrap) {
    // Same kanonisk-rekkjefølgje-fiks som priserFeatListHtml() -- kurven her
    // er bygd i klikk-orden ("+ Legg til"), ikkje Modulpriser sin faste orden.
    var fCartItems = priserOrderedFeatureKeys(_priserQuote.f, PRISER_F_LABELS).map(function (k) { return { label: PRISER_F_LABELS[k], monthly: priserPriceEntry("f", k).monthly, ns: "f", key: k }; });
    var iCartItems = priserOrderedFeatureKeys(_priserQuote.i, PRISER_I_LABELS).map(function (k) { return { label: PRISER_I_LABELS[k], monthly: priserPriceEntry("i", k).monthly, ns: "i", key: k }; });
    // "til venstre" var feil på alle skjermar ≤800px, der plukkeren stables
    // OVER handlekurven, ikkje til venstre for han (UX-review-funn).
    var cartHtml = (!fCartItems.length && !iCartItems.length)
      ? '<p class="quote-cart__empty">Ingen moduler lagt til ennå — velg moduler under.</p>'
      : priserQuoteCartGroupHtml("Nettside", fCartItems) + priserQuoteCartGroupHtml("Workspace", iCartItems);

    var extra = _priserQuote.extraSetup || 0;

    wrap.innerHTML =
      '<p class="preview-note">Sett sammen et tilbud modul for modul, uavhengig av de faste pakkene — nyttig når en kunde bare vil ha noen få enkeltmoduler. Lagres ikke, kun en økt-lokal kalkulator.</p>' +
      '<div class="quote-layout">' +
        '<div class="quote-picker">' +
          '<div class="feat-section-title">Nettside-/Web-admin-funksjoner</div>' +
          priserGroupedGrid(Object.keys(PRISER_F_LABELS), "f", function (k) { return priserQuoteChip(k, PRISER_F_LABELS[k], "f"); }, "") +
          '<div class="feat-section-title">Workspace-funksjoner</div>' +
          priserGroupedGrid(Object.keys(PRISER_I_LABELS), "i", function (k) { return priserQuoteChip(k, PRISER_I_LABELS[k], "i"); }, "") +
        '</div>' +
        '<div class="quote-cart">' +
          '<h4>Valgte moduler</h4>' +
          cartHtml +
          '<div class="quote-extra">' +
            '<label for="priser-quote-extra">Generell oppstartskostnad (ikke modulspesifikk — f.eks. domene, merkevare, oppstartsmøte)</label>' +
            '<input type="number" min="0" id="priser-quote-extra" value="' + extra + '">' +
          '</div>' +
          '<div class="quote-cart__totals" id="priser-quote-totals"></div>' +
        '</div>' +
      '</div>';
    priserRefreshQuoteTotals(wrap);

    wrap.querySelectorAll("[data-priser-q-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var parts = btn.getAttribute("data-priser-q-add").split(":");
        if (_priserQuote[parts[0]].indexOf(parts[1]) === -1) _priserQuote[parts[0]].push(parts[1]);
        renderPriserQuote(wrap);
      });
    });
    wrap.querySelectorAll("[data-priser-q-rm]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var parts = btn.getAttribute("data-priser-q-rm").split(":");
        var idx = _priserQuote[parts[0]].indexOf(parts[1]);
        if (idx > -1) _priserQuote[parts[0]].splice(idx, 1);
        renderPriserQuote(wrap);
      });
    });
    wrap.querySelector("#priser-quote-extra").addEventListener("input", function (e) {
      _priserQuote.extraSetup = Number(e.target.value) || 0;
      priserRefreshQuoteTotals(wrap); // ALDRI eit fullt re-render her -- sjå kommentaren over
    });
  }

  /* =========================================================================
     BUDSJETT-FANE (brukarønske 2026-08-05)
     ====================================================================== */
  // Rundar opp til næraste "fine" tal (1/2/5 × 10^n) for y-akse-taket --
  // same prinsipp som eit vanleg diagram-bibliotek sin auto-skalering.
  function priserBudgetNiceMax(v) {
    if (v <= 0) return 1000;
    var pow = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var n = v / pow;
    var nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return nice * pow;
  }
  // Fargane er henta frå den validerte standardpaletten (dataviz-skill,
  // 2026-08-05): #2a78d6 (blå, MRR-linja) og #008300 (grøn, eingongs-
  // stolpane) -- stadfesta med scripts/validate_palette.js mot Console sin
  // faktiske kvite overflate (--color-surface:#ffffff): alle sjekkar
  // (lysheit, kroma, CVD-skilje, normalsyn-golv, kontrast) PASS.
  function priserBudgetChartHtml(forecast, target) {
    var W = 720, H = 300, padR = 16, padT = 16, padB = 30;
    var n = forecast.length;
    var maxMrr = forecast[n - 1] ? forecast[n - 1].mrr : 0;
    var maxOneTime = forecast[0] ? forecast[0].oneTime : 0;
    var niceMax = priserBudgetNiceMax(Math.max(target, maxMrr, maxOneTime, 1));
    // padL må vekse med breidda på det STØRSTE y-akse-talet -- elles klipper
    // SVG-en (som IKKJE viser overflow som standard) av dei fremste sifra på
    // det viktigaste talet i heile grafen (toppgitterlinja), nøyaktig når
    // brukaren har sett eit ambisiøst mål/høg salstakt (UX-review-funn
    // 2026-08-05: fast padL=60 klippa 6-7-sifra kr-beløp).
    var padL = Math.max(48, 18 + priserFmtPrice(niceMax).length * 7);
    var plotW = W - padL - padR, plotH = H - padT - padB;
    function yScale(v) { return padT + plotH - (v / niceMax) * plotH; }
    var slotW = plotW / n;
    var barW = Math.min(24, slotW * 0.45);
    // Åtvaring når målet dreg y-aksen SÅ mykje høgare enn den faktiske
    // prognosen at MRR-linja/stolpane vert klemde ned i eit tynt felt nedst
    // (UX-review-funn 2026-08-05) -- unngår at "nesten flat graf" vert
    // mistolka som "nesten ingen vekst" når det eigentleg berre er skalert
    // mot eit fjernt mål.
    var scaleWarning = (target > 0 && maxMrr > 0 && target > maxMrr * 3)
      ? '<p class="budget-scale-note">Grafen er skalert til målet ditt (' + priserFmtPrice(target) + ' kr/mnd) -- den faktiske prognosen ligg langt under, og kan difor se flatare ut enn veksten faktisk er.</p>'
      : "";

    var gridSteps = 4, gridSvg = "";
    for (var g = 0; g <= gridSteps; g++) {
      var gv = niceMax * g / gridSteps, gy = yScale(gv);
      gridSvg += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="var(--color-border)" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="11" fill="var(--color-muted)">' + priserFmtPrice(Math.round(gv)) + '</text>';
    }

    var barsSvg = "", dotsSvg = "", xLabelsSvg = "", hitsSvg = "", linePts = [];
    forecast.forEach(function (mo, i) {
      var cx = padL + slotW * i + slotW / 2;
      var barY = yScale(mo.oneTime), barH = Math.max(0, (padT + plotH) - barY);
      barsSvg += '<rect x="' + (cx - barW / 2) + '" y="' + barY + '" width="' + barW + '" height="' + barH + '" rx="4" fill="#008300"/>';
      linePts.push([cx, yScale(mo.mrr)]);
      xLabelsSvg += '<text x="' + cx + '" y="' + (H - padB + 16) + '" text-anchor="middle" font-size="11" fill="var(--color-muted)">' + mo.month + '</text>';
      hitsSvg += '<rect class="budget-hit" tabindex="0" data-month="' + mo.month + '" data-mrr="' + mo.mrr + '" data-onetime="' + mo.oneTime + '" data-total="' + mo.total + '" ' +
        'x="' + (padL + slotW * i) + '" y="' + padT + '" width="' + slotW + '" height="' + plotH + '" fill="transparent" ' +
        'aria-label="Måned ' + mo.month + ': MRR ' + priserFmtPrice(mo.mrr) + ' kr, eingongsinntekt ' + priserFmtPrice(mo.oneTime) + ' kr, totalt ' + priserFmtPrice(mo.total) + ' kr"></rect>';
    });
    linePts.forEach(function (p, i) {
      dotsSvg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" fill="#2a78d6" stroke="var(--color-surface)" stroke-width="2"/>';
    });
    var linePath = linePts.map(function (p, i) { return (i === 0 ? "M" : "L") + p[0] + " " + p[1]; }).join(" ");

    // niceMax >= target alltid (sjå priserBudgetNiceMax), så target ligg
    // aldri utanfor plottet -- ingen clamp nødvendig her.
    var targetSvg = "";
    if (target > 0) {
      var ty = yScale(target);
      targetSvg = '<line x1="' + padL + '" y1="' + ty + '" x2="' + (W - padR) + '" y2="' + ty + '" stroke="var(--color-muted)" stroke-width="1.5" stroke-dasharray="4 4"/>' +
        '<text x="' + (W - padR) + '" y="' + (ty - 6) + '" text-anchor="end" font-size="11" fill="var(--color-muted)">Mål: ' + priserFmtPrice(target) + ' kr/mnd</text>';
    }

    return (
      '<div class="budget-legend">' +
        '<span class="budget-legend__item"><span class="budget-legend__line" style="background:#2a78d6"></span>MRR (akkumulert)</span>' +
        '<span class="budget-legend__item"><span class="budget-legend__swatch" style="background:#008300"></span>Eingongsinntekt (ny per månad)</span>' +
      '</div>' +
      scaleWarning +
      // role="group", IKKJE "img" -- ein "img"-rolle flatar ut/kan skjule dei
      // individuelt fokuserbare/merkelappa .budget-hit-borna for ein skjerm-
      // lesar sin virtuell-markør-navigasjon (UX-review-funn 2026-08-05).
      // Sjølve grafen sin overordna omtale ligg no i ein eigen <title>.
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="budget-chart-svg" role="group" aria-label="Inntektsprognose neste 12 månadar">' +
        '<title>Inntektsprognose neste 12 månadar</title>' +
        gridSvg + barsSvg +
        '<path d="' + linePath + '" fill="none" stroke="#2a78d6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        dotsSvg + targetSvg + xLabelsSvg + hitsSvg +
      '</svg>' +
      '<div class="budget-tooltip" id="priser-budget-tooltip" hidden></div>'
    );
  }
  // Punktoppdaterer heile tal-/graf-/tabell-utgangen frå input-felta --
  // sjølve skjemafelta (antal, mål) rører denne funksjonen ALDRI, så
  // tastaturfokus held fram akkurat som priserRefreshQuoteTotals().
  function priserRefreshBudgetTotals(wrap) {
    var monthly = priserBudgetMonthlyNew();
    var forecast = priserBudgetForecast();
    var target = Number(_priserBudget.target) || 0;
    var mttText = priserBudgetMttText(priserBudgetMonthsToTarget(), target);

    var newMrrEl = wrap.querySelector("#priser-budget-newmrr-display");
    if (newMrrEl) newMrrEl.textContent = priserFmtPrice(monthly.newMrr);
    var mttEl = wrap.querySelector("#priser-budget-monthstotarget");
    if (mttEl) mttEl.textContent = mttText;

    var chartEl = wrap.querySelector("#priser-budget-chart");
    if (chartEl) chartEl.innerHTML = priserBudgetChartHtml(forecast, target);

    var tbody = wrap.querySelector("#priser-budget-table-body");
    if (tbody) tbody.innerHTML = forecast.map(function (mo) {
      return '<tr><td>' + mo.month + '</td><td>' + priserFmtPrice(mo.mrr) + '</td><td>' + priserFmtPrice(mo.oneTime) + '</td><td>' + priserFmtPrice(mo.total) + '</td></tr>';
    }).join("");

    priserBindBudgetTooltip(wrap);
  }
  // Punktoppdaterer berre "Hvor mange kunder for et årsmål?"-resultatet --
  // same disiplin som priserRefreshBudgetTotals, aldri eit fullt re-render.
  function priserRefreshAnnualBreakdown(wrap) {
    var el = wrap.querySelector("#priser-budget-annual-result");
    if (!el) return;
    var annualTarget = Number(_priserBudget.annualTarget) || 0;
    var mixValue = priserBudgetAnnualMixValue();
    if (mixValue <= 0) {
      el.innerHTML = '<p class="preview-note">Fyll inn forventet salg for minst én pakke i salgsplanen over.</p>';
      return;
    }
    if (annualTarget <= 0) {
      el.innerHTML = '<p class="preview-note">Sett et årsmål over for å se hvor mange kunder du trenger.</p>';
      return;
    }
    var b = priserBudgetAnnualBreakdown(annualTarget);
    if (!b || !b.rows.length) {
      el.innerHTML = '<p class="preview-note">Fyll inn forventet salg for minst én pakke i salgsplanen over.</p>';
      return;
    }
    el.innerHTML =
      '<p class="preview-note">Du trenger totalt <strong>' + priserFmtPrice(b.totalCustomers) + ' kunder</strong> i denne miksen for å nå ' + priserFmtPrice(annualTarget) + ' kr i året:</p>' +
      '<div class="price-table-wrap"><table class="price-table">' +
        '<thead><tr><th>Pakke</th><th>Antall kunder trengs</th></tr></thead>' +
        '<tbody>' + b.rows.map(function (r) {
          return '<tr><td>' + C.esc(r.pkg.name || "(uten navn)") + '</td><td>' + priserFmtPrice(r.count) + '</td></tr>';
        }).join("") + '</tbody>' +
      '</table></div>';
  }
  // Søylediagram som viser Sum 1. år / Sum år 2+ mot to uavhengige måltal
  // (brukarønske 2026-08-05: "sette eit måltall for 1. år og 2. år og lage
  // ein graf, lignende den akkumulerte"). Ingen tidsakse her (i motsetnad
  // til priserBudgetChartHtml sin 12-månaders prognose) -- berre to faste
  // kategoriar, difor éi mållinje PER SØYLE (avgrensa til søyla sin eigen
  // x-sone) i staden for éi delt mållinje over heile plottet. Same validerte
  // fargepar som resten av fana (#2a78d6/#008300, sjå kommentaren ved
  // priserBudgetChartHtml).
  function priserAnnualCountChartHtml(totals, target1, target2) {
    var W = 720, H = 280, padR = 16, padT = 16, padB = 30;
    var cats = [
      { label: "1. år", value: totals.year1, target: target1, color: "#2a78d6" },
      { label: "år 2+", value: totals.year2, target: target2, color: "#008300" }
    ];
    var maxVal = Math.max(cats[0].value, cats[1].value, target1, target2, 1);
    var niceMax = priserBudgetNiceMax(maxVal);
    var padL = Math.max(48, 18 + priserFmtPrice(niceMax).length * 7);
    var plotW = W - padL - padR, plotH = H - padT - padB;
    function yScale(v) { return padT + plotH - (v / niceMax) * plotH; }
    var slotW = plotW / cats.length;
    var barW = Math.min(90, slotW * 0.35);
    var maxActual = Math.max(cats[0].value, cats[1].value, 1);
    var scaleWarning = ((target1 > 0 && target1 > maxActual * 3) || (target2 > 0 && target2 > maxActual * 3))
      ? '<p class="budget-scale-note">Grafen er skalert til det høgaste måltalet du har sett -- søylene kan difor sjå lågare ut enn dei eigentleg er i forhold til kvarandre.</p>'
      : "";

    var gridSteps = 4, gridSvg = "";
    for (var g = 0; g <= gridSteps; g++) {
      var gv = niceMax * g / gridSteps, gy = yScale(gv);
      gridSvg += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="var(--color-border)" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="11" fill="var(--color-muted)">' + priserFmtPrice(Math.round(gv)) + '</text>';
    }

    var barsSvg = "", labelsSvg = "", xLabelsSvg = "", targetSvg = "", hitsSvg = "";
    cats.forEach(function (c, i) {
      var slotX = padL + slotW * i, cx = slotX + slotW / 2;
      var barY = yScale(c.value), barH = Math.max(0, (padT + plotH) - barY);
      barsSvg += '<rect x="' + (cx - barW / 2) + '" y="' + barY + '" width="' + barW + '" height="' + barH + '" rx="4" fill="' + c.color + '"/>';
      labelsSvg += '<text x="' + cx + '" y="' + (barY - 8) + '" text-anchor="middle" font-size="12" font-weight="600" fill="var(--color-text)">' + priserFmtPrice(c.value) + ' kr</text>';
      xLabelsSvg += '<text x="' + cx + '" y="' + (H - padB + 18) + '" text-anchor="middle" font-size="12" fill="var(--color-muted)">' + C.esc(c.label) + '</text>';
      var pct = c.target > 0 ? Math.round((c.value / c.target) * 100) : null;
      if (c.target > 0) {
        var ty = yScale(c.target);
        // Mållinja er avgrensa til søyla si eiga breidde + litt margin, IKKJE
        // heile slot-breidda -- elles kan to nære måltal (frå to uavhengige
        // kategoriar) møtast midt mellom søylene og lese ut som ÉI delt
        // mållinje over heile grafen (UX-review-funn 2026-08-05).
        var tLineHalf = (barW + 20) / 2;
        // Verdi-etiketten (over søyla) og mål-etiketten (over mållinja) kolliderer
        // nettopp når verdien er nær målet -- det ein brukar opnar denne grafen
        // FOR å sjekke. Flytt mål-etiketten under linja i staden for over når
        // dei to ligg for tett (UX-review-funn 2026-08-05).
        var tooClose = Math.abs(barY - ty) < 16;
        var tLabelY = tooClose ? ty + 14 : ty - 6;
        targetSvg += '<line x1="' + (cx - tLineHalf) + '" y1="' + ty + '" x2="' + (cx + tLineHalf) + '" y2="' + ty + '" stroke="var(--color-muted)" stroke-width="1.5" stroke-dasharray="4 4"/>' +
          '<text x="' + cx + '" y="' + tLabelY + '" text-anchor="middle" font-size="11" fill="var(--color-muted)">Mål: ' + priserFmtPrice(c.target) + ' kr</text>';
      }
      hitsSvg += '<rect class="budget-hit" tabindex="0" data-label="' + C.esc(c.label) + '" data-value="' + c.value + '" data-target="' + c.target + '" data-pct="' + (pct === null ? "" : pct) + '" ' +
        'x="' + slotX + '" y="' + padT + '" width="' + slotW + '" height="' + plotH + '" fill="transparent" ' +
        'aria-label="' + C.esc(c.label) + ': ' + priserFmtPrice(c.value) + ' kr' + (c.target > 0 ? ", mål " + priserFmtPrice(c.target) + " kr (" + pct + " % nådd)" : "") + '"></rect>';
    });

    return (
      scaleWarning +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="budget-chart-svg" role="group" aria-label="Sum 1. år og år 2+ mot måltal">' +
        '<title>Sum 1. år og år 2+ mot måltal</title>' +
        gridSvg + barsSvg + labelsSvg + targetSvg + xLabelsSvg + hitsSvg +
      '</svg>' +
      '<div class="budget-tooltip" id="priser-budget-annualcount-tooltip" hidden></div>'
    );
  }
  // Same getBoundingClientRect()-mønster som priserBindBudgetTooltip, berre
  // for dei to søylene her (kategori/verdi/mål/prosent i staden for
  // månad/MRR/eingongsinntekt/totalt).
  function priserBindAnnualCountTooltip(wrap) {
    var chartWrap = wrap.querySelector("#priser-budget-annualcount-chart");
    var tip = wrap.querySelector("#priser-budget-annualcount-tooltip");
    if (!chartWrap || !tip) return;
    function show(hit) {
      var label = hit.getAttribute("data-label"), value = hit.getAttribute("data-value");
      var target = Number(hit.getAttribute("data-target")) || 0, pct = hit.getAttribute("data-pct");
      tip.innerHTML =
        '<div class="budget-tt-row is-total"><strong>' + priserFmtPrice(value) + ' kr</strong><span>' + C.esc(label) + '</span></div>' +
        (target > 0 ? '<div class="budget-tt-row"><span>Mål: ' + priserFmtPrice(target) + ' kr (' + C.esc(pct) + ' % nådd)</span></div>' : '<div class="budget-tt-row"><span>Ingen mål sett</span></div>');
      tip.hidden = false;
      var wrapRect = chartWrap.getBoundingClientRect(), hitRect = hit.getBoundingClientRect();
      var tipW = tip.offsetWidth, tipH = tip.offsetHeight;
      var centerX = hitRect.left - wrapRect.left + hitRect.width / 2;
      var left = Math.min(Math.max(centerX, tipW / 2), wrapRect.width - tipW / 2);
      var topAbove = hitRect.top - wrapRect.top - tipH - 8;
      var top = topAbove >= 0 ? topAbove : Math.max(0, hitRect.top - wrapRect.top + 4);
      tip.style.left = left + "px";
      tip.style.top = top + "px";
      tip.style.transform = "translateX(-50%)";
    }
    function hide() { tip.hidden = true; }
    wrap.querySelectorAll("#priser-budget-annualcount-chart .budget-hit").forEach(function (hit) {
      hit.addEventListener("pointerenter", function () { show(hit); });
      hit.addEventListener("pointermove", function () { show(hit); });
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("focus", function () { show(hit); });
      hit.addEventListener("blur", hide);
    });
  }
  // Punktoppdaterer BERRE per-rad "Sum"-cella + totalen + grafen -- ALDRI
  // heile <tbody>-en, sidan den inneheld sjølve talet-på-kundar-input-en
  // brukaren nettopp skreiv i (sjå kommentaren ved annualCountBody i
  // renderPriserBudget() for full grunngjeving). Sjølve grafen (eit rein
  // frittståande <div>, ingen input-born) vert trygt fullt omskriven kvar
  // gong, akkurat som priserBudgetChartHtml-grafen over.
  function priserRefreshAnnualCount(wrap) {
    var rows = priserBudgetAnnualCountRows();
    rows.forEach(function (r) {
      var y1cell = wrap.querySelector('[data-priser-budget-annualcount-y1="' + r.pkg.id + '"]');
      if (y1cell) y1cell.textContent = priserFmtPrice(r.year1) + " kr";
      var y2cell = wrap.querySelector('[data-priser-budget-annualcount-y2="' + r.pkg.id + '"]');
      if (y2cell) y2cell.textContent = priserFmtPrice(r.year2) + " kr";
    });
    var totals = priserBudgetAnnualCountTotals();
    var totalEl = wrap.querySelector("#priser-budget-annualcount-total");
    if (totalEl) totalEl.innerHTML =
      '<div class="quote-cart__row"><span>Sum antall kunder</span><span>' + priserFmtPrice(totals.count) + '</span></div>' +
      '<div class="quote-cart__row is-total"><span>Sum 1. år (inkl. oppstart)</span><span>' + priserFmtPrice(totals.year1) + ' kr</span></div>' +
      '<div class="quote-cart__row is-total"><span>Sum år 2+ (per år)</span><span>' + priserFmtPrice(totals.year2) + ' kr</span></div>';
    var target1 = Number(_priserBudget.annualCountTargets.year1) || 0;
    var target2 = Number(_priserBudget.annualCountTargets.year2) || 0;
    var chartEl = wrap.querySelector("#priser-budget-annualcount-chart");
    if (chartEl) {
      chartEl.innerHTML = priserAnnualCountChartHtml(totals, target1, target2);
      priserBindAnnualCountTooltip(wrap);
    }
  }
  // Tooltip via getBoundingClientRect() (verkar korrekt uansett viewBox-
  // skalering, ingen manuell piksel-rekning). Kvar treffe-rect er tilgjengeleg
  // for tastaturbrukarar (tabindex+aria-label), OG same 12 tal ligg alltid
  // synlege i tabellen under grafen -- tooltipen er difor eit tillegg, aldri
  // einaste vegen til dataen (dataviz-skill sitt "tooltips enhance, never gate").
  function priserBindBudgetTooltip(wrap) {
    var chartWrap = wrap.querySelector("#priser-budget-chart");
    var tip = wrap.querySelector("#priser-budget-tooltip");
    if (!chartWrap || !tip) return;
    function show(hit) {
      var month = hit.getAttribute("data-month"), mrr = hit.getAttribute("data-mrr"), oneTime = hit.getAttribute("data-onetime"), total = hit.getAttribute("data-total");
      tip.innerHTML =
        '<div class="budget-tt-row"><span class="budget-tt-key" style="background:#2a78d6"></span><strong>' + priserFmtPrice(mrr) + ' kr</strong><span>MRR</span></div>' +
        '<div class="budget-tt-row"><span class="budget-tt-key" style="background:#008300"></span><strong>' + priserFmtPrice(oneTime) + ' kr</strong><span>Eingongsinntekt</span></div>' +
        '<div class="budget-tt-row is-total"><strong>' + priserFmtPrice(total) + ' kr</strong><span>Totalt, månad ' + C.esc(month) + '</span></div>';
      tip.hidden = false;
      var wrapRect = chartWrap.getBoundingClientRect(), hitRect = hit.getBoundingClientRect();
      var tipW = tip.offsetWidth, tipH = tip.offsetHeight;
      // Vassrett: klem sentrum mellom tipW/2 og wrapRect.width-tipW/2 slik at
      // tooltipen aldri stikk ut av kortet ved månad 1/12 (UX-review-funn
      // 2026-08-05 -- ingen klemming fanst frå før).
      var centerX = hitRect.left - wrapRect.left + hitRect.width / 2;
      var left = Math.min(Math.max(centerX, tipW / 2), wrapRect.width - tipW / 2);
      // Loddrett: føretrekk over punktet; fell tilbake til INNI plottet
      // (nær toppen av treffesona) i staden for å stikke over kortkanten
      // dersom det ikkje er nok plass over (UX-review-funn 2026-08-05).
      var topAbove = hitRect.top - wrapRect.top - tipH - 8;
      var top = topAbove >= 0 ? topAbove : Math.max(0, hitRect.top - wrapRect.top + 4);
      tip.style.left = left + "px";
      tip.style.top = top + "px";
      tip.style.transform = "translateX(-50%)";
    }
    function hide() { tip.hidden = true; }
    wrap.querySelectorAll(".budget-hit").forEach(function (hit) {
      hit.addEventListener("pointerenter", function () { show(hit); });
      hit.addEventListener("pointermove", function () { show(hit); });
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("focus", function () { show(hit); });
      hit.addEventListener("blur", hide);
    });
  }
  function renderPriserBudget(wrap) {
    var pkgs = _priserData.packages;
    var startTarget = Number(_priserBudget.target) || 0;
    var mttText = priserBudgetMttText(priserBudgetMonthsToTarget(), startTarget);

    var rows = pkgs.length ? pkgs.map(function (p) {
      if (p.priceOnRequest) {
        return '<tr><td>' + C.esc(p.name || "(uten navn)") + '</td><td colspan="2">Avtales separat</td>' +
          '<td><input type="number" value="0" disabled title="Denne pakken har ikke en fast pris, så den telles ikke med i budsjettet."></td></tr>';
      }
      var qty = _priserBudget.monthlyQty[p.id] || 0;
      return '<tr><td>' + C.esc(p.name || "(uten navn)") + '</td><td>' + priserFmtPrice(p.price) + ' kr</td><td>' + priserFmtPrice(p.setupCost || 0) + ' kr</td>' +
        '<td><input type="number" min="0" step="1" data-priser-budget-qty="' + C.esc(p.id) + '" value="' + qty + '"></td></tr>';
    }).join("") : '<tr><td colspan="4" style="text-align:center;color:var(--color-muted)">Ingen pakker ennå.</td></tr>';

    // "Regn ut årsinntekt fra antall kunder" -- input-cellene vert bygde HER,
    // ÉIN gong, og ALDRI rørt av priserRefreshAnnualCount() (som berre
    // punktoppdaterer "Sum"-cella + totalen) -- elles ville kvart tastetrykk
    // øydelagt og gjenskapt akkurat den input-en brukaren skriv i, med tap av
    // tastaturfokus som følgje (same feilklasse som er unngått overalt elles
    // i denne fana).
    var annualCountRows = priserBudgetAnnualCountRows();
    var annualCountBody = annualCountRows.length ? annualCountRows.map(function (r) {
      return '<tr><td>' + C.esc(r.pkg.name || "(uten navn)") + '</td>' +
        '<td>' + priserFmtPrice(r.perCustomerYear1) + ' kr</td>' +
        '<td>' + priserFmtPrice(r.perCustomerYear2) + ' kr</td>' +
        '<td><input type="number" min="0" step="1" data-priser-budget-annualcount="' + C.esc(r.pkg.id) + '" value="' + r.count + '"></td>' +
        '<td data-priser-budget-annualcount-y1="' + C.esc(r.pkg.id) + '">' + priserFmtPrice(r.year1) + ' kr</td>' +
        '<td data-priser-budget-annualcount-y2="' + C.esc(r.pkg.id) + '">' + priserFmtPrice(r.year2) + ' kr</td></tr>';
    }).join("") : '<tr><td colspan="6" style="text-align:center;color:var(--color-muted)">' +
      (pkgs.length ? "Ingen pakker med fast pris -- pakker merket «Avtales separat» kan ikke telles her." : "Ingen pakker ennå.") +
      '</td></tr>';

    wrap.innerHTML =
      '<p class="preview-note">Sett forventet nysalg per pakke <strong>per måned</strong> for å se hvordan inntekten vokser de neste 12 månedene. Lagres ikke, kun en økt-lokal kalkulator.</p>' +
      '<div class="price-table-wrap"><table class="price-table">' +
        '<thead><tr><th>Pakke</th><th>Pris/mnd</th><th>Oppstart</th><th>Forventet nysalg/mnd</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '<div class="stat-row">' +
        '<div class="stat-box"><label>Målsetting' + C.helpIcon("Den faste, tilbakevendende inntekten (kalt MRR) du sikter mot per måned. Dette er beløpet kunder betaler løpende hver måned -- ikke engangskostnader som oppstartsgebyr.") + '</label>' +
          '<div class="stat-input-row"><input type="number" min="0" id="priser-budget-target" value="' + (Number(_priserBudget.target) || 0) + '"><span class="unit">kr/mnd</span></div></div>' +
        '<div class="stat-box"><label>Ny fast inntekt per måned' + C.helpIcon("MRR = Monthly Recurring Revenue, altså løpende inntekt kundene betaler hver måned. Dette er hvor mye NY løpende inntekt den planlagte salgstakten din legger til hver eneste måned.") + '</label><div class="stat-input-row"><strong id="priser-budget-newmrr-display" style="font-size:1.4rem">0</strong><span class="unit">kr/mnd</span></div></div>' +
        '<div class="stat-box"><label>Når nås målet?</label><div class="stat-input-row"><strong id="priser-budget-monthstotarget" style="font-size:1.05rem">' + C.esc(mttText) + '</strong></div></div>' +
      '</div>' +
      '<div class="budget-chart-wrap" id="priser-budget-chart"></div>' +
      '<div class="price-table-wrap"><table class="price-table">' +
        '<thead><tr><th>Måned</th><th>MRR (kr)</th><th>Eingongsinntekt (kr)</th><th>Totalt (kr)</th></tr></thead>' +
        '<tbody id="priser-budget-table-body"></tbody>' +
      '</table></div>' +
      '<div class="rp-section">' +
        '<div class="feat-section-title">Hvor mange kunder for et årsmål?</div>' +
        '<p class="preview-note">Bruker <strong>samme miks</strong> som salgsplanen over -- forholdet mellom pakkene der. Hver kunde telles med full førsteårsverdi (oppstartskostnad + 12 måneder), uten hensyn til når på året de tegner avtale.</p>' +
        '<div class="stat-row">' +
          '<div class="stat-box"><label>Årsmål' + C.helpIcon("Total inntekt du ønsker å oppnå i løpet av ett år, fra denne pakke-miksen -- summen av alle nye kunders oppstartskostnad og 12 måneders abonnement.") + '</label>' +
            '<div class="stat-input-row"><input type="number" min="0" id="priser-budget-annual-target" value="' + (Number(_priserBudget.annualTarget) || 0) + '"><span class="unit">kr/år</span></div></div>' +
        '</div>' +
        '<div id="priser-budget-annual-result"></div>' +
      '</div>' +
      '<div class="rp-section">' +
        '<div class="feat-section-title">Regn ut årsinntekt fra antall kunder</div>' +
        '<p class="preview-note">Fyll inn selv hvor mange kunder du planlegger å selge av hver pakke i løpet av året -- helt uavhengig av salgsplanen over -- så regnes årsinntekten ut automatisk.</p>' +
        '<div class="price-table-wrap"><table class="price-table">' +
          '<thead><tr><th>Pakke</th><th>Verdi 1. år/kunde' + C.helpIcon("12 måneders abonnement pluss oppstartskostnad -- det kunden faktisk betaler i sitt første år.") + '</th><th>Verdi år 2+/kunde' + C.helpIcon("12 måneders abonnement UTEN oppstartskostnad -- den løpende verdien fra og med andre året, siden oppstart bare betales én gang.") + '</th><th>Antall kunder i år</th><th>Sum 1. år</th><th>Sum år 2+</th></tr></thead>' +
          '<tbody>' + annualCountBody + '</tbody>' +
        '</table></div>' +
        '<div class="quote-cart__totals" id="priser-budget-annualcount-total"></div>' +
        '<div class="stat-row" style="margin-top:1rem">' +
          '<div class="stat-box"><label>Måltall 1. år' + C.helpIcon("Hva du ønsker Sum 1. år skal nå -- vises som en stiplet linje i grafen under.") + '</label>' +
            '<div class="stat-input-row"><input type="number" min="0" id="priser-budget-annualcount-target1" value="' + (Number(_priserBudget.annualCountTargets.year1) || 0) + '"><span class="unit">kr</span></div></div>' +
          '<div class="stat-box"><label>Måltall år 2+' + C.helpIcon("Hva du ønsker Sum år 2+ skal nå -- vises som en stiplet linje i grafen under.") + '</label>' +
            '<div class="stat-input-row"><input type="number" min="0" id="priser-budget-annualcount-target2" value="' + (Number(_priserBudget.annualCountTargets.year2) || 0) + '"><span class="unit">kr</span></div></div>' +
        '</div>' +
        '<div class="budget-chart-wrap" id="priser-budget-annualcount-chart"></div>' +
      '</div>';

    priserRefreshBudgetTotals(wrap);
    priserRefreshAnnualBreakdown(wrap);
    priserRefreshAnnualCount(wrap);

    wrap.querySelectorAll("[data-priser-budget-qty]").forEach(function (input) {
      input.addEventListener("input", function () {
        _priserBudget.monthlyQty[input.getAttribute("data-priser-budget-qty")] = Number(input.value) || 0;
        priserRefreshBudgetTotals(wrap); // ALDRI eit fullt renderPriserBudget()-kall her -- sjå priserRefreshQuoteTotals sin eigen kommentar
        priserRefreshAnnualBreakdown(wrap); // same miks driv begge seksjonane
      });
    });
    wrap.querySelector("#priser-budget-target").addEventListener("input", function (e) {
      _priserBudget.target = Number(e.target.value) || 0;
      priserRefreshBudgetTotals(wrap);
    });
    // "change" i tillegg til "input" -- brukarrapport 2026-08-05 synte eit
    // avvik mellom talet i feltet og talet i resultatteksten som ikkje let
    // seg forklare av sjølve utrekninga (same variabel driv begge); eit
    // sannsynleg forklaring er nettlesar-autoutfylling/scroll-på-tal-felt som
    // ikkje alltid utløyser "input" i alle nettlesarar -- "change" dekkjer
    // desse tilfella som eit vern, sjølv om rotårsaka ikkje er stadfesta.
    wrap.querySelector("#priser-budget-annual-target").addEventListener("input", function (e) {
      _priserBudget.annualTarget = Number(e.target.value) || 0;
      priserRefreshAnnualBreakdown(wrap);
    });
    wrap.querySelector("#priser-budget-annual-target").addEventListener("change", function (e) {
      _priserBudget.annualTarget = Number(e.target.value) || 0;
      priserRefreshAnnualBreakdown(wrap);
    });
    wrap.querySelectorAll("[data-priser-budget-annualcount]").forEach(function (input) {
      input.addEventListener("input", function () {
        _priserBudget.annualCount[input.getAttribute("data-priser-budget-annualcount")] = Number(input.value) || 0;
        priserRefreshAnnualCount(wrap); // ALDRI eit fullt renderPriserBudget()-kall her
      });
    });
    wrap.querySelector("#priser-budget-annualcount-target1").addEventListener("input", function (e) {
      _priserBudget.annualCountTargets.year1 = Number(e.target.value) || 0;
      priserRefreshAnnualCount(wrap);
    });
    wrap.querySelector("#priser-budget-annualcount-target2").addEventListener("input", function (e) {
      _priserBudget.annualCountTargets.year2 = Number(e.target.value) || 0;
      priserRefreshAnnualCount(wrap);
    });
  }

  // Speiler same "Standardmoduler"-kollaps som pakkeredigeringa: er
  // priserAllStandard(pkg, ns) på for DETTE namnerommet, vis "Alle
  // standardmoduler" som éin rad i staden for kvar standardmodul, og list kun
  // dei eksplisitt valde tillegga under.
  // Nettside/Workspace-overskrifter på kvar sin liste hindrar at t.d.
  // "Aktuelt" (finst i begge namnerom) dukkar opp to gonger utan skille.
  // Brukarfunn 2026-08-05: denne lista viste modulane i den rekkjefølgja dei
  // vart HUKA AV i (pkg.features/iFeatures sin rå array-orden), ikkje den
  // faste rekkjefølgja frå Modulpriser -- ein nyleg lagt til modul (t.d.
  // "Hosting og vedlikehold") som vart huka av SIST på ei ELDRE pakke hamna
  // difor sist i lista, langt bak "FAQ", i staden for først som Modulpriser
  // faktisk viser han. `labels` ER Modulpriser sin kanoniske rekkjefølgje
  // (Object.keys() bevarer innsettingsorden) -- sorterer pkg sine valde
  // nøklar etter DEN, uavhengig av kva rekkjefølgje dei vart huka av i.
  function priserOrderedFeatureKeys(rawKeys, labels) {
    var canonical = Object.keys(labels);
    return rawKeys.slice().sort(function (a, b) { return canonical.indexOf(a) - canonical.indexOf(b); });
  }

  function priserFeatListHtml(title, pkg, ns, labels) {
    var keys = priserOrderedFeatureKeys(ns === "f" ? pkg.features : pkg.iFeatures, labels);
    var tags = ns === "f" ? pkg.tags.f : pkg.tags.i;
    if (!priserAllStandard(pkg, ns)) {
      if (!keys.length) return "";
      return '<div class="compare-card__group-title">' + title + '</div><ul>' + keys.map(function (k) {
        var tag = tags[k];
        return '<li><span class="check">✓</span><span>' + C.esc(labels[k]) + '</span>' + (tag ? '<span class="addon-tag">' + C.esc(tag) + '</span>' : "") + '</li>';
      }).join("") + '</ul>';
    }
    var addonKeys = keys.filter(function (k) { return !priserPriceEntry(ns, k).standard; });
    var stdCount = priserStandardKeys(ns).length;
    if (!stdCount && !addonKeys.length) return "";
    var items = stdCount ? ['<li><span class="check">✓</span><span>Alle standardmoduler</span></li>'] : [];
    addonKeys.forEach(function (k) {
      var tag = tags[k];
      items.push('<li><span class="check">✓</span><span>' + C.esc(labels[k]) + '</span>' + (tag ? '<span class="addon-tag">' + C.esc(tag) + '</span>' : "") + '</li>');
    });
    return '<div class="compare-card__group-title">' + title + '</div><ul>' + items.join("") + '</ul>';
  }

  // "Last ned som bilde" (brukarønske 2026-08-04, ekte PNG valgt eksplisitt
  // over ei enklare utskrift-til-PDF-løysing) -- html2canvas rendrar
  // .compare-grid til eit <canvas>, som så vert trigga som ei nedlasting.
  // Skalert 2x for eit skarpt bilete på skjermar med høg pikseltettleik
  // (presentasjonar vert ofte vist prosjektert/forstørra).
  function priserExportImage(btn, statusEl) {
    if (typeof window.html2canvas !== "function") {
      statusMsg(statusEl, "✗ Bildeeksport er ikke lastet inn riktig -- prøv å laste siden på nytt.", false);
      return;
    }
    var target = document.querySelector(".compare-grid");
    if (!target) return;
    btn.disabled = true;
    var origLabel = btn.textContent;
    btn.textContent = "Genererer bilde…";
    window.html2canvas(target, { backgroundColor: "#ffffff", scale: 2 }).then(function (canvas) {
      canvas.toBlob(function (blob) {
        btn.disabled = false;
        btn.textContent = origLabel;
        if (!blob) { statusMsg(statusEl, "✗ Kunne ikke generere bilde.", false); return; }
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        var stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = "vibeverk-priser-" + stamp + ".png";
        a.click();
        URL.revokeObjectURL(url);
        statusMsg(statusEl, "✓ Lastet ned!", true);
      }, "image/png");
    }).catch(function (err) {
      console.error("priserExportImage:", err); // teknisk detalj i konsollen, aldri i brukarvend tekst (copy-style-guide)
      btn.disabled = false;
      btn.textContent = origLabel;
      statusMsg(statusEl, "✗ Kunne ikke generere bildet. Prøv å laste siden på nytt og forsøk igjen.", false);
    });
  }

  function priserCapsLine(pkg) {
    // "0 GB, 0 brukere osv." gjev feil signal for ei pris-etter-avtale-pakke
    // (t.d. "Skreddersydd AI-modul") -- omfanget er per definisjon ikkje fastsett
    // enno, ikkje faktisk null (brukarfunn 2026-08-05).
    if (pkg.priceOnRequest) return "";
    var parts = PRISER_CAP_FIELDS.map(function (f) {
      var v = pkg[f.key];
      return (v === -1 ? "Ubegrenset " + f.label.toLowerCase() : v + " " + f.unit);
    });
    return '<div class="compare-card__caps">' + parts.map(function (p) { return '<span>' + C.esc(p) + '</span>'; }).join("") + '</div>';
  }

  // Kva pakkar som er kryssa av for denne forhåndsvisninga -- reint
  // økt-lokalt (aldri lagra), sidan kva ein vil vise fram kan variere frå
  // kunde til kunde/tilbod til tilbod (brukarønske 2026-08-04). Syncar inn
  // manglande/fjerna pakke-ID-ar ved kvar render i staden for å initialisere
  // berre éin gong, slik at ei nyleg lagt-til pakke i "Rediger pakker" dukkar
  // opp som avkryssa (default PÅ) utan at brukaren må huke ho av manuelt.
  function priserSyncPreviewVisible() {
    if (!_priserPreviewVisible) _priserPreviewVisible = {};
    _priserData.packages.forEach(function (p) { if (!(p.id in _priserPreviewVisible)) _priserPreviewVisible[p.id] = true; });
  }

  function renderPriserPreview(wrap) {
    priserSyncPreviewVisible();
    var visiblePkgs = _priserData.packages.filter(function (p) { return _priserPreviewVisible[p.id]; });

    wrap.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:.6rem">' +
        '<p class="preview-note" style="margin-bottom:0">Slik kunne pakkene sett ut presentert som en enkel sammenligning — kun en intern forhåndsvisning, ikke en publisert side. Velg hvilke pakker som skal vises for denne kunden — kan variere fra tilbud til tilbud.</p>' +
        '<div style="text-align:right;flex-shrink:0">' +
          C.button({ label: "Last ned som bilde", variant: "ghost", attrs: 'type="button" id="priser-export-btn"' + (visiblePkgs.length ? "" : ' disabled title="Velg minst én pakke over for å laste ned et bilde"') }) +
          '<div class="form__status" id="priser-export-status" style="margin-top:.3rem"></div>' +
        '</div>' +
      '</div>' +
      '<div class="pv-select">' +
        _priserData.packages.map(function (pkg) {
          var on = !!_priserPreviewVisible[pkg.id];
          return '<button type="button" class="pv-chip' + (on ? " is-on" : "") + '" data-priser-pv-toggle="' + C.esc(pkg.id) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
            '<span class="box">' + (on ? "✓" : "") + '</span>' + C.esc(pkg.name || "(uten navn)") +
          '</button>';
        }).join("") +
      '</div>' +
      (visiblePkgs.length
        ? '<div class="compare-grid">' +
            visiblePkgs.map(function (pkg) {
              var color = priserSafeHex(pkg.badgeColor);
              var style = pkg.featured ? ' style="border-color:' + color + '"' : "";
              var badge = pkg.featured ? '<span class="compare-card__badge" style="background:' + color + '">' + C.esc(pkg.badgeText || "Fremhevet") + '</span>' : "";
              // "Spar kr X" (brukarønske 2026-08-05) -- automatisk utrekna,
              // ikkje ein manuelt sett merkelapp som featured-badgen over.
              var savingsText = pkg.priceOnRequest ? "" : priserSavingsText(pkg, priserSum(priserEffectiveKeys(pkg, "f"), priserEffectiveKeys(pkg, "i")));
              return '<div class="compare-card' + (pkg.featured ? " is-featured" : "") + '"' + style + '>' +
                badge +
                '<div class="compare-card__name">' + C.esc(pkg.name) + '</div>' +
                (pkg.priceOnRequest
                  ? '<div class="compare-card__price">Pris etter avtale</div>'
                  : '<div class="compare-card__price">' + priserFmtPrice(pkg.price) + ' kr</div>' +
                    '<div class="compare-card__unit">per måned' + (pkg.setupCost ? ' + ' + priserFmtPrice(pkg.setupCost) + ' kr i oppstartskostnad' : '') + '</div>') +
                (savingsText ? '<div><span class="compare-card__savings">' + C.esc(savingsText) + '</span></div>' : "") +
                '<div class="compare-card__desc">' + C.esc(pkg.desc || "") + '</div>' +
                priserCapsLine(pkg) +
                priserFeatListHtml("Nettside", pkg, "f", PRISER_F_LABELS) +
                priserFeatListHtml("Workspace", pkg, "i", PRISER_I_LABELS) +
              '</div>';
            }).join("") +
          '</div>'
        : '<div class="pv-empty">Ingen pakker valgt — kryss av minst én over for å vise noe her.</div>');

    wrap.querySelectorAll("[data-priser-pv-toggle]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var id = chip.getAttribute("data-priser-pv-toggle");
        _priserPreviewVisible[id] = !_priserPreviewVisible[id];
        renderPriserPreview(wrap);
        // Same fokus-disiplin som pakke-lista i "Rediger pakker" (UX-review-
        // funn 2026-08-04) -- utan dette hoppar fokus til <body> ved kvar
        // avkryssing, og ein tastaturbrukar som veks/vel fleire pakkar etter
        // kvarandre må Tab-e frå toppen på nytt for kvar av dei.
        var newChip = wrap.querySelector('[data-priser-pv-toggle="' + id + '"]');
        if (newChip) newChip.focus();
      });
    });
    var exportBtn = wrap.querySelector("#priser-export-btn");
    if (exportBtn) exportBtn.addEventListener("click", function () {
      priserExportImage(exportBtn, wrap.querySelector("#priser-export-status"));
    });
  }

  function renderPriser(_sc, wrap) {
    if (!_priserData) {
      wrap.innerHTML = '<p style="color:var(--color-muted)">Laster prisdata…</p>';
      priserLoad(wrap);
      return;
    }
    var views = [["edit", "Rediger pakker"], ["prices", "Modulpriser"], ["quote", "Bygg tilbud"], ["budget", "Budsjett"], ["preview", "Forhåndsvisning"]];
    wrap.innerHTML =
      '<div class="seg" id="priser-view-toggle" style="margin-bottom:1.4rem">' +
        views.map(function (v) {
          return '<button type="button" class="' + (v[0] === _priserView ? "is-active" : "") + '" data-priser-view="' + v[0] + '">' + C.esc(v[1]) + '</button>';
        }).join("") +
      '</div>' +
      '<div id="priser-pane"></div>';

    wrap.querySelectorAll("[data-priser-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        _priserView = btn.getAttribute("data-priser-view");
        renderPriser(null, wrap);
      });
    });

    var pane = wrap.querySelector("#priser-pane");
    if (_priserView === "edit") renderPriserEdit(pane);
    else if (_priserView === "prices") renderPriserPrices(pane);
    else if (_priserView === "quote") renderPriserQuote(pane);
    else if (_priserView === "budget") renderPriserBudget(pane);
    else renderPriserPreview(pane); // "preview" og enhver ukjend/framtidig verdi -- eksplisitt fallback, ikkje ein implisitt catch-all for ein 6. fane
  }

  function renderAnalyse(sc, wrap) {
    // Fanga her, ikkje inne i submit-handteraren -- dette skjemaet
    // representerer tenanten som var aktiv DÅ SIDA VART TEIKNA, uansett kva
    // _activeTenant måtte verta seinare (sjå saveSC() sitt notat).
    var savingTenantId = _activeTenant && _activeTenant.id;
    // Sjå OPT_IN_FEATURES-notatet ved FEAT_LABELS: den interne Analyse-modulen
    // (features.sidetelling, slått av/på i Modular-fana) og eit eksternt verktøy
    // sett opp HER kan aldri vere aktive samtidig. Retninga er IKKJE symmetrisk:
    // initAnalytics() i core.js lastar Plausible-scriptet ubetinga når
    // analytics.plausible er sett, utan å sjå på features.sidetelling i det
    // heile -- det er module-sidetelling.js sjølv som gjev seg
    // (`if (an.plausible) return;`) når Plausible er sett. Plausible vinn altså
    // alltid, den interne analysen går stille i dvale, ikkje omvendt (funne av
    // Project Historian 2026-08-03, sjå CHANGELOG). Boksen under må difor
    // åtvare i DEN retninga: lagrar du Plausible-felta under mens kunden har
    // intern analyse på, er det Plausible som tek over.
    var sidetellingWarning = (sc.features && sc.features.sidetelling === true)
      ? '<div class="i-notice i-notice--warn" style="margin-bottom:1rem;padding:.8rem 1rem;border:1.5px solid #E8833A;border-radius:8px;background:color-mix(in srgb,#E8833A 10%,transparent);font-size:.88rem">' +
          '<strong>Kunden har intern analyse aktivert i Modular-fana.</strong> Fyller du inn Plausible under og lagrar, tek Plausible automatisk over — den interne analysen sluttar då stille å samle inn data (ingen feilmelding, og det som alt er samla går ikkje tapt). Vil du halde fram med intern analyse for denne kunden, lat felta under stå tomme.' +
        '</div>'
      : "";
    getStoreKey("analytics", function (an) {
      wrap.innerHTML =
        '<form id="cs-form">' +
          sidetellingWarning +
          '<fieldset class="admin-group"><legend>Analyse</legend>' +
            '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Koblar kunden sitt nettsted til Plausible Analytics, eit personvernvenleg verktøy for besøksstatistikk (ingen sporingscookies). Krev at kunden har ein eigen Plausible-konto.</p>' +
            C.field({ id:"cs-an-pl",      label:"Plausible – domenenavn", value: an.plausible || "", placeholder:"vibeverk.no",
              help:"Domenet slik det er registrert i Plausible, utan https://." }) +
            C.field({ id:"cs-an-plembed", label:"Plausible – delt dashboard-lenke", value: an.plausibleEmbed || "",
              placeholder:"https://plausible.io/share/…",
              hint:"Plausible → Site Settings → Visibility → Embed dashboard." }) +
          '</fieldset>' +
          saveBtn() +
        '</form>';

      wrap.querySelector("#cs-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var value = {
          plausible:      wrap.querySelector("#cs-an-pl").value.trim(),
          plausibleEmbed: wrap.querySelector("#cs-an-plembed").value.trim()
        };
        var payload = { key: "analytics", value: value };
        if (savingTenantId) payload.tenant_id = savingTenantId;
        brokerCall("set_config", payload, function (r) {
          if (r.error) { statusMsg(wrap.querySelector("#cs-status"), r.error, false); return; }
          statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra!", true);
        });
      });
    });
  }

  // Gammal lagra personverntekst var rein tekst (\n\n mellom avsnitt, \n for
  // linjeskift — sjå computeDefaultPrivacyText() i core.js). Rik-tekst-editoren
  // krev HTML. Konverter éin gong, idempotent: køyrer berre når teksten IKKJE
  // alt inneheld HTML-taggar, så alt konvertert innhald let vi vera i fred.
  function migrateLegacyPrivacyText(text) {
    var t = String(text || "");
    if (!t || /<[a-z][\s\S]*>/i.test(t)) return t;
    return App.ui.textToRichHtml(t);
  }

  /* =========================================================================
     PERSONVERN — Fase 1 (videreutvikling 2026-08-06, sjå docs/compliance/ for
     grunngjeving og beslutningsmøte-referat).

     sc.privacy veks frå det opphavlege { heading, text } til ein strukturert,
     versjonert form. heading/text står FRAMLEIS på toppnivå, urørt -- dei er
     ein FLAT projeksjon av innhaldet i den til ei kvar tid PUBLISERTE
     versjonen. Nettsida (core.js sin applySuperConfig()) og termsField() les
     framleis berre desse to felta, uendra -- null risiko for det publiserte
     innhaldet, ingen kodeendring der. Dei nye felta (versions/forms/
     consentPurposes) er reine Console-interne strukturar for redigering/
     historikk/skjematekster.
     ====================================================================== */
  // "nyhetsbrev" fjerna herifrå 2026-08-12 -- var eit skjematype-felt utan
  // noko faktisk skjema bak seg (ingen module-newsletter.js finst), synte
  // difor ingen stad i det publiserte dokumentet (computeRetentionBlock()
  // ekskluderte det alt eksplisitt). Det EKTE behovet (kunden vil bruke
  // e-postar samla inn via kontakt/tilbod/booking til marknadsføring)
  // dekkast av consentPurposes[] i staden -- eit eige, uavhuka samtykke-
  // formål, sjå hint-teksten i renderPersonvernSamtykker(). Gamal, lagra
  // sc.privacy.forms.nyhetsbrev-data for tenantar som måtte ha fylt ut noko
  // her tidlegare vert ikkje sletta, berre ikkje lenger vist/redigert.
  var PRIVACY_FORM_TYPES = [
    { id: "kontakt",    label: "Kontaktskjema" },
    { id: "tilbud",     label: "Tilbudsskjema" },
    { id: "booking",    label: "Booking" }
  ];
  var PRIVACY_LEGAL_BASIS_OPTIONS = [
    ["", "Ikke fastsatt"],
    ["avtale", "Avtale / oppfyllelse før avtale"],
    ["samtykke", "Samtykke"],
    ["berettiget_interesse", "Berettiget interesse"],
    ["rettslig_plikt", "Rettslig plikt"]
  ];
  // Brukt av "Foreslå tekst" (Skjematekster-fana, 2026-08-10) -- kort,
  // kundevendt formulering av kvart behandlingsgrunnlag, sett inn i ei
  // enkeltsetning saman med Formål/Lagringstid. Ikkje meint som juridisk
  // fasitforklaring, berre eit lesbart utgangspunkt (same fråskriving som
  // Standardforslag sjølv).
  var PRIVACY_LEGAL_BASIS_BLURB = {
    avtale: "fordi det er nødvendig for å inngå eller oppfylle avtalen med deg",
    samtykke: "basert på samtykket du gir når du sender inn skjemaet -- du kan når som helst trekke samtykket tilbake",
    berettiget_interesse: "fordi vi har en berettiget interesse i å kunne følge opp henvendelsen din",
    rettslig_plikt: "for å oppfylle en rettslig plikt"
  };

  // Fase 4 (godkjenning/eksport, 2026-08-06): REIN INTERN journalføring --
  // brukaren avklarte eksplisitt (AskUserQuestion) at det IKKJE skal byggjast
  // nokon ny kundevendt flate (ingen lenke/e-post kunden sjølv opnar), og at
  // "godkjent" er REINT INFORMATIVT -- sperrar ALDRI "Publiser" (jf.
  // renderPersonvernDokument sin publiser-handterar, urørt av denne fasen).
  // Operatøren fyller inn desse tre felta sjølv, etter ein ekte samtale
  // (telefon/e-post/møte) med kunden -- Console har ingen måte å verifisere
  // at samtalen faktisk fann stad, difor aldri ei sperre, berre eit notat.
  var APPROVAL_CHANNELS = [
    ["", "Ikkje valt"],
    ["epost", "E-post"],
    ["telefon", "Telefon"],
    ["mote", "Møte"],
    ["anna", "Anna"]
  ];
  var APPROVAL_CHANNEL_LABEL = { epost: "e-post", telefon: "telefon", mote: "møte", anna: "anna kanal" };

  // Fase 5 (endringsvarsling): brukarvende namn på moduleId, til bruk i
  // "desse avsnitta bør sjekkast"-lista -- operatøren skal aldri sjå den
  // interne id-en ("booking") rått.
  var PRIVACY_MODULE_LABEL = {
    baseline: "Generelt", contactForm: "Kontaktskjema", quote: "Tilbud",
    booking: "Booking", analytics: "Cookies/analyse", suppliers: "Leverandørar",
    intro: "Innledning", controller: "Behandlingsansvarlig",
    retention: "Lagringstid", breach: "Avviksvarsling", employees: "Tilsette (Workspace)",
    chat: "Chat"
  };

  // Fase 3 (leverandørregister, 2026-08-06): Vibeverk-heile leverandørfakta
  // -- IKKJE per-kunde-data, IKKJE Console-redigerbart nokon stad. Dette er
  // Vibeverk sitt EIGE forhold til kvar leverandør (data-map-vibeverk.md sin
  // rolleavklaring: kundane har ALDRI eit eige, direkte avtaleforhold til
  // desse). console-core.js er éin delt fil for alle tenantar (kun config.js/
  // superconfig skil dei) -- ein hardkoda konstant her er difor rett stad for
  // ein fakta som er identisk for alle kundar, ikkje ein databasetabell.
  // Endring av dpaStatus/transferMechanism skal vere eit medvite, sjeldan steg
  // -- verifiser mot leverandøren sin eigen DPA-side, noter i CHANGELOG.md,
  // same disiplin som CDN-versjonspinning i CLAUDE.md. Domeneshop er MEDVITE
  // utelaten (beslutningsmøte 2026-08-06 sak 7 -- berre Vibeverk sin eigen
  // leverandør for vibeverk.no, aldri kundevendt). Anthropic (Oversikt/Smart
  // årshjul) er MEDVITE utelaten (sak 4 -- framleis trial-fase, ikkje tilbydd
  // nokon reell kunde enno) -- ikkje legg til ein rad for han før den
  // avgjerda faktisk er teken.
  // isActive(an) -- EINASTE staden som avgjer om ein leverandør faktisk er i
  // bruk for ein gjeven kunde (Security Auditor-funn, Fase 3, LOW: tidlegare
  // hardkoda `v.id === "plausible"` i to ulike funksjonar, ei lett-å-gløyme
  // kopling om ein ny valfri leverandør nokon gong vert lagt til -- no finst
  // det berre EI sanning, her, per leverandør).
  // DPA-status endra til "tba" for alle fire 2026-08-12 (brukarvedtak): Vibeverk
  // AS er enno ikkje stifta som eige rettssubjekt, så INGEN av desse kan ha
  // ei formelt signert databehandlaravtale endå -- det er ikkje ein feil/eit
  // gløymt steg, berre venting på eit konkret, kjent administrativt steg.
  // Brukar signerer sjølv når selskapet er registrert. IKKJE les "tba" som
  // "ikkje undersøkt" -- dei tidlegare unconfirmed/likely_confirmed-funna
  // (data-map-vibeverk.md) er framleis gyldige faktaopplysningar, berre
  // omformulerte i dpaNote til å seie KVA som attstår, ikkje at det er uklart.
  var VIBEVERK_VENDORS = [
    { id: "supabase", name: "Supabase",
      whatItDoes: "Database, autentisering og fillagring — all persondata plattformen lagrer",
      isActive: function () { return true; }, country: "eu", transferMechanism: "none",
      dpaStatus: "tba",
      dpaNote: "Signerast via Supabase Dashboard når Vibeverk AS er stifta og registrert som kontoeigar." },
    { id: "vercel", name: "Vercel",
      whatItDoes: "Hosting og tenant-ruting",
      isActive: function () { return true; }, country: "us", transferMechanism: "scc",
      dpaStatus: "tba",
      dpaNote: "DPA er automatisk inkludert på Pro/Enterprise-plan (dagens konto er på Hobby-planen) -- ordnast saman med oppgradering når Vibeverk AS er stifta." },
    { id: "resend", name: "Resend",
      whatItDoes: "Utsending og mottak av e-post",
      isActive: function () { return true; }, country: "us", transferMechanism: "scc_or_dpf",
      dpaStatus: "tba",
      dpaNote: "Standardvilkåra er alt godteke ved kontoopprettinga, men ei formell databehandlaravtale under Vibeverk AS som eige rettssubjekt attstår til selskapet er stifta." },
    { id: "plausible", name: "Plausible Analytics",
      whatItDoes: "Cookiefri trafikkstatistikk",
      isActive: function (an) { return !!(an && (an.plausible || an.plausibleEmbed)); },
      country: "eu", transferMechanism: "none",
      dpaStatus: "tba",
      dpaNote: "Leverandøren tilbyr ei standard databehandlaravtale -- signerast under Vibeverk AS når selskapet er stifta." }
  ];
  var VENDOR_COUNTRY_LABEL = { eu: "EU/EØS", us: "USA" };
  var VENDOR_TRANSFER_LABEL = {
    none: "Ikkje relevant (ingen overføring ut av EU/EØS)",
    scc: "EUs standardavtaler (SCC)",
    scc_or_dpf: "SCC og/eller EU–US Data Privacy Framework (ikkje stadfesta kva)"
  };
  var VENDOR_DPA_LABEL = { confirmed: "Stadfesta", likely_confirmed: "Truleg alt i kraft", unconfirmed: "Ikkje stadfesta", tba: "TBA — Vibeverk AS ikkje stifta enno" };
  // Kundevendt (offentleg publisert) ordlyd for overføringsgrunnlag --
  // MEDVITE ULIK VENDOR_TRANSFER_LABEL over, som er skriven for OPERATØREN
  // (Leverandørar-fana) og difor hedgar ærleg ("ikkje stadfesta kva"). Den
  // hedginga skal ALDRI lekke rått til ein besøkjande -- sjå computeSupplierBlock().
  var VENDOR_TRANSFER_CUSTOMER_LABEL = {
    scc: "overføringen er dekket av EUs standardavtaler (SCC)",
    scc_or_dpf: "overføringen er dekket av EUs standardavtaler og/eller tilsvarende godkjente overføringsmekanismer"
  };

  // "Bolk 5" (2026-08-12): kundevendt Leverandørar-tekst byrjar no lese frå
  // vendor_registry (kontrollplanet, redigerbar via Compliance-fana) i staden
  // for BERRE denne hardkoda VIBEVERK_VENDORS-konstanten. VIBEVERK_VENDORS
  // sjølv er MEDVITE IKKJE fjerna -- ho står att som synkron
  // bootstrap-fallback for aller fyrste rendering (sc._vendorRegistry er
  // berre sett etter ei vellykka async henting, same "kan vere fråverande på
  // fyrste rendering, sjølv-lækande neste"-mønster som sc._privacyAn alt
  // brukar for "analytics").
  //
  // isActive(an)-funksjonar (t.d. Plausible sin an.plausible-sjekk) kan ikkje
  // flyttast reint inn i ein databaserad -- VENDOR_ACTIVITY_PREDICATES held
  // fram som den EINASTE sanninga for "er denne leverandøren aktiv", uansett
  // om vendor-objektet kom frå VIBEVERK_VENDORS (har framleis sin eigen
  // isActive-metode, no ubrukt) eller frå ein normalisert vendor_registry-rad
  // (reint dataobjekt, ingen metodar i det heile).
  var VENDOR_ACTIVITY_PREDICATES = {
    supabase: function () { return true; },
    vercel: function () { return true; },
    resend: function () { return true; },
    plausible: function (an) { return !!(an && (an.plausible || an.plausibleEmbed)); }
  };
  function vendorIsActive(v, an) {
    var pred = VENDOR_ACTIVITY_PREDICATES[v.id];
    return pred ? pred(an) : true;
  }

  // Bygger om ein rå vendor_registry-databaserad (snake_case-kolonnenamn) til
  // nøyaktig same camelCase-forma VIBEVERK_VENDORS alt har -- held
  // computeSupplierBlock()/renderPersonvernLeverandorerLoaded() heilt uendra
  // bortsett frå kva array dei les frå.
  function normalizeVendorRow(row) {
    return {
      id: row.id, name: row.name, whatItDoes: row.what_it_does,
      country: row.country, transferMechanism: row.transfer_mechanism,
      dpaStatus: row.dpa_status, dpaNote: row.dpa_note
    };
  }

  function privacyNewId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  // HERDING 2026-08-06 (funne under planlegging av Fase 2, retta før Fase 2
  // vart bygd, sjå docs/compliance/): sc.privacy budde opphavleg HEILT i den
  // anon-lesbare 'superconfig'-nøkkelen -- inkludert versions[] (heile
  // versjonshistorikken, MED IKKJE-PUBLISERTE UTKAST). Sidan heile
  // superconfig-rada vert henta av kven som helst med anon-nøkkelen (naudsynt
  // for at fyrste sideoppslag skal fungere for ein ikkje-innlogga besøkjande),
  // var upublisert utkast-tekst i praksis hentbar utanfrå, sjølv om ingen UI
  // synte han. Same feilklasse som vart funne og retta 2026-07-07
  // (adminPassword-verdien låg tidlegare i klartekst i superconfig, sjå
  // baseline_schema.sql sin eigen kommentar ved store_anon_read-policyen).
  //
  // Løysing: `versions[]`/`activeVersionId` bur no i 'superconfig-private'
  // (RLS krev is_platform_operator(), ALDRI anon-lesbar), lest/skrive via
  // broker sine get_private_config/set_config-handlingar (gjeninnført her,
  // sjå notatet dei vart fjerna med 2026-07-17 -- "om eit nytt privat felt
  // treng redigering frå Console seinare, kan kalla gjenreisast då"). Berre
  // `heading`/`text` (den PUBLISERTE flate projeksjonen) + `forms`/
  // `consentPurposes` (strukturert innhald meint for offentleg bruk uansett,
  // sjå Fase 2) står att i den offentlege 'superconfig'-nøkkelen.
  //
  // sc.privacy vert sett saman av BÅDE delane i minnet for Console sin eigen
  // redigering (sjå renderPersonvern()), men kvar lagring skil dei att --
  // sjå privacyPublicProjection()/savePrivacyVersions().
  function migratePrivacyPublicPart(priv) {
    priv = priv || {};
    var forms = {};
    PRIVACY_FORM_TYPES.forEach(function (f) {
      forms[f.id] = (priv.forms && priv.forms[f.id]) || { purpose: "", legalBasis: "", retention: "", recipients: "", blurbHtml: "" };
    });
    return {
      heading: priv.heading || "",
      text: priv.text || "",
      forms: forms,
      consentPurposes: priv.consentPurposes || [],
      publishedVersionId: priv.publishedVersionId || null,
      publishedAt: priv.publishedAt || null,
      // Fase 3 (leverandørregister): einaste genuint per-kunde-feltet --
      // resten (kva leverandørar som faktisk er aktive) er avleia av
      // eksisterande config, ikkje lagra separat, sjå computeSupplierBlock().
      suppliers: { supabaseRegion: (priv.suppliers && priv.suppliers.supabaseRegion) || "" }
    };
  }

  // Køyrer éin gong per kunde -- pakkar det gamle { heading, text } inn som
  // versjon 1 (alt PUBLISERT, sidan det alt var det synlege innhaldet på
  // nettsida) OM superconfig-private ikkje alt har ein versjonshistorikk frå
  // før (heilt ny kunde, eller legacy-data frå FØR 2026-08-06-herdinga over).
  // Idempotent.
  //
  // stalePublicVersions (Security Auditor-funn 2026-08-06): om ein kunde
  // FAKTISK fekk versions/activeVersionId lagra i den offentlege nøkkelen
  // medan sårbarheita var open (før denne herdinga), er det REELL data --
  // draft-arbeid ein operatør faktisk gjorde -- ikkje noko å forkaste. Bruk
  // ho som andreprioritet (etter ekte privat historikk, før ein heilt fersk
  // v1) slik at ho vert berga inn i superconfig-private i staden for tapt.
  function migratePrivacyVersions(privatePrivacy, publicPriv, stalePublicVersions) {
    if (privatePrivacy && privatePrivacy.versions && privatePrivacy.versions.length) {
      return { activeVersionId: privatePrivacy.activeVersionId, versions: privatePrivacy.versions };
    }
    if (stalePublicVersions && stalePublicVersions.versions && stalePublicVersions.versions.length) {
      return { activeVersionId: stalePublicVersions.activeVersionId, versions: stalePublicVersions.versions };
    }
    var now = Date.now();
    var legacyHtml = migrateLegacyPrivacyText(publicPriv.text || "");
    var v1 = {
      id: "v1", status: "published", basedOnVersionId: null,
      createdAt: now, publishedAt: now,
      heading: publicPriv.heading || "",
      bodyBlocks: legacyHtml
        ? [{ id: "b-legacy", source: "manual", moduleId: null, included: true, edited: true, body: legacyHtml }]
        : [],
      // Fase 4 (godkjenning, 2026-08-06): null til operatøren registrerer noko
      // via "Registrer godkjenning" (renderPersonvernDokument). Skapet, når
      // sett: { approvedBy: text, channel: ""|"epost"|"telefon"|"mote"|"anna",
      // note: text, approvedAt: ms-epoch }. REIN INTERN journalføring (brukar
      // avklarte eksplisitt, AskUserQuestion 2026-08-06 -- ingen kundevendt
      // flate) og REINT INFORMATIVT -- sperrar ALDRI publisering.
      approval: null
    };
    return { activeVersionId: "v1", versions: [v1] };
  }

  // Den EINASTE forma sc.privacy skal skrivast attende til den OFFENTLEGE
  // 'superconfig'-nøkkelen i -- ALDRI send sc.privacy (som i minnet også
  // inneheld versions/activeVersionId) direkte til saveSC(), det ville
  // undergrave heile herdinga over.
  // publishedVersionId/publishedAt (Fase 2, 2026-08-06): reine, ufarlege
  // peikarar (ein kort id-streng + eit tidsstempel, ALDRI sjølve
  // versjonsinnhaldet) -- naudsynt sidan sjølve versions[]/activeVersionId
  // no medvite ALDRI er anon-lesbare (sjå migratePrivacyVersions() sitt
  // herdingsnotat). Nettsida treng likevel EIN peikar å stemple ei reell
  // samtykke-innsending med, for å kunne seie "dette vart avgjeve då DENNE
  // versjonen var publisert" utan å eksponere noko meir. Trygt å gjere
  // offentleg, same idé som eit synleg "versjon"-tal i eit vanleg produkt.
  function privacyPublicProjection(sc) {
    return {
      heading: sc.privacy.heading, text: sc.privacy.text,
      forms: sc.privacy.forms, consentPurposes: sc.privacy.consentPurposes,
      publishedVersionId: sc.privacy.publishedVersionId || null,
      publishedAt: sc.privacy.publishedAt || null,
      suppliers: sc.privacy.suppliers || { supabaseRegion: "" }
    };
  }

  // Les-endre-skriv mot 'superconfig-private', same disiplin som getSC()/
  // saveSC() brukar for den offentlege nøkkelen -- unngår å overskrive andre
  // private felt som måtte liggje der (t.d. ein tidlegare adminPassword-
  // verdi, sjølv om UI-et for han er fjerna, sjå notatet ved renderSystem()).
  function savePrivacyVersions(sc, tenantId, cb) {
    var getPayload = tenantId ? { tenant_id: tenantId } : {};
    brokerCall("get_private_config", getPayload, function (r) {
      if (r.error) { cb(r); return; }
      var privBlob = r.value || {};
      privBlob.privacy = { activeVersionId: sc.privacy.activeVersionId, versions: sc.privacy.versions };
      var setPayload = { key: "superconfig-private", value: privBlob };
      if (tenantId) setPayload.tenant_id = tenantId;
      brokerCall("set_config", setPayload, cb);
    });
  }

  function privacyActiveVersion(sc) {
    var priv = sc.privacy;
    var found = (priv.versions || []).filter(function (v) { return v.id === priv.activeVersionId; })[0];
    return found || priv.versions[priv.versions.length - 1];
  }

  // Publisert versjon skal vere eit uforanderleg augeblikksbilete -- redigering
  // opprettar alltid ein NY versjon i staden for å mutere ein publisert ein.
  function privacyCloneVersionAsDraft(version) {
    return {
      id: privacyNewId("v"), status: "draft", basedOnVersionId: version.id,
      createdAt: Date.now(), publishedAt: null,
      heading: version.heading,
      bodyBlocks: (version.bodyBlocks || []).map(function (b) { return Object.assign({}, b); }),
      // Fase 4 (godkjenning, 2026-08-06): null til operatøren registrerer noko
      // via "Registrer godkjenning" (renderPersonvernDokument). Skapet, når
      // sett: { approvedBy: text, channel: ""|"epost"|"telefon"|"mote"|"anna",
      // note: text, approvedAt: ms-epoch }. REIN INTERN journalføring (brukar
      // avklarte eksplisitt, AskUserQuestion 2026-08-06 -- ingen kundevendt
      // flate) og REINT INFORMATIVT -- sperrar ALDRI publisering.
      approval: null
    };
  }

  // Kva "modul" (i personvern-forstand) er faktisk aktiv for denne kunden no
  // -- brukt av hybrid-vakta til å nekte publisering dersom eit avsnitt
  // knytt til ein reelt aktiv modul er ekskludert utan vidare. Aldri la ein
  // manuell fjern-/avhuk-handling stille skjule at ein aktiv modul faktisk
  // behandlar personopplysningar (brukarønske, sjå ChatGPT-utforma oppdrag
  // 2026-08-06 punkt 4).
  function privacyModuleActive(sc, an, moduleId) {
    var ft = sc.features || {};
    if (moduleId === "baseline")    return true;
    if (moduleId === "contactForm") return ft.contactForm !== false;
    if (moduleId === "quote")       return !!ft.quote;
    if (moduleId === "booking")     return !!ft.booking;
    if (moduleId === "analytics")   return !!(an && (an.plausible || an.plausibleEmbed)) || ft.sidetelling === true;
    // Fase 3: Supabase/Vercel/Resend er strukturelt alltid aktive for kvar
    // einaste kunde (jf. VIBEVERK_VENDORS sin alwaysActive) -- denne blokka
    // skal difor ALDRI kunne hybrid-vakt-blokkerast bort, ulikt dei
    // funksjonsflagg-styrte modulane over.
    if (moduleId === "suppliers")   return true;
    // Fase "Standardforslag" (2026-08-06): faste juridiske standardavsnitt,
    // ikkje styrt av noko features.*-flagg -- same "alltid aktiv"-grunngjeving
    // som baseline/suppliers over.
    if (moduleId === "intro" || moduleId === "controller" || moduleId === "retention" || moduleId === "breach" || moduleId === "employees") return true;
    // module-chat.js sin eigen standard er "på" med mindre eksplisitt skrudd
    // av (same !== false-mønster som contactForm over) -- IKKJE eit "alltid
    // aktiv"-modul slik baseline/suppliers er, sidan features.chat faktisk
    // kan setjast til false.
    if (moduleId === "chat") return ft.chat !== false;
    return false; // ukjend/fjerna modul-id -- tving ikkje inkludering
  }

  // Same sakstoff som core.js sin computeDefaultPrivacyText() (Vibeverk sin
  // standard-forslagstekst, modul-medviten), MEN no delt opp i sjølvstendige
  // BLOKKER (éin per modul) i staden for éin samanhengande streng -- kvar
  // blokk kan inkluderast/ekskluderast/redigerast for seg (hybridmodellen).
  // Tek sc/an som argument, ikkje CFG, av same grunn som den gamle
  // computeTenantPrivacyDefault() hadde (konsollen sin eigen tenant må ikkje
  // lekke inn i eit ANNA sitt forslag).
  //
  // MERK: "Samtykke"-utsegna frå den gamle éin-strengs-versjonen ("Ved å
  // sende inn dette skjemaet samtykker du...") er MEDVITE FJERNA frå
  // forslaget her -- beslutningsmøtet 2026-08-06 fann (grunngjeve i
  // Datatilsynet sin eigen rettleiing, sjå docs/compliance/) at samtykke
  // sannsynlegvis IKKJE er rett behandlingsgrunnlag for eit vanleg skjema
  // (avtale/før-avtale er meir nærliggjande) -- forslaget skal difor ikkje
  // lenger PÅSTÅ eit grunnlag vi ikkje har stadfesta. Sjå forms.*.legalBasis
  // (framleis tomt, fylt inn av operatør/jurist i Skjematekster-fana) i
  // staden.
  //
  // Rettar òg ein reell drift frå core.js sin tilsvarande, IKKJE strukturerte
  // versjon: den hadde eit sidetelling-medvite cookieText-steg (3-vegs:
  // Plausible/sidetelling/ingen) som denne fila sin gamle
  // computeTenantPrivacyDefault() mangla (berre 2-vegs Plausible/ingen).
  // "Standardforslag" (2026-08-06): kunden ("litt svakt" var tilbakemeldinga
  // på det forrige forslaget) ønska EIT komplett, samanhengande utkast i eitt
  // klikk -- ikkje berre modul-avsnitt, men òg dei faste juridiske avsnitta
  // ein reell personvernerklæring treng (behandlingsansvarleg, klagerett,
  // avvikshandtering, lagringstid). Innhaldet er Privacy/Compliance Advisor
  // sitt konkrete utkast (køyrt denne økta, las faktisk kode/dokumentasjon
  // FØR forslaget vart skrive) -- framleis "berre eit utgangspunkt frå oss",
  // ikkje juridisk kvalitetssikra åleine.
  // UX-funn (2026-08-10, brukar): App.ui.textToRichHtml() gjer ingen skilnad
  // på ei "tittel-linje" og brødtekst -- alt vart like usynleg formatert som
  // vanlege avsnitt, sjølv om kvar blokk under alt er skriven med ei tydeleg
  // "tittel fyrst"-line. Denne funksjonen er ein eigen, privacy-spesifikk
  // variant (IKKJE ei endring av den delte App.ui.textToRichHtml(), som òg
  // brukast av migrateLegacyPrivacyText() for fritt, ustrukturert gamalt
  // innhald utan nokon "# "-konvensjon -- ei endring der ville feiltolka
  // vilkårleg gamal tekst som overskrifter).
  //
  // Konvensjon: ei linje som startar med "# " vert overskrift (feit, eiga
  // linje) for RESTEN av same avsnitt (til neste \n\n). Ei linje UTAN "# "
  // vert verande vanleg brødtekst. Dette let fleire avsnitt i éin og same
  // blokk få kvar sin overskrift (t.d. "Hvor lagres opplysningene?" OG "Dine
  // rettigheter" i baseline-blokka), MEN listeaktig innhald (leverandørrader,
  // lagringstid-linjer) som medvite IKKJE skal bli eigne overskrifter kan
  // stå urørt utan prefikset.
  //
  // Rendrar som <p><strong>…</strong></p>, ikkje ein ekte <hN>-tag -- unngår
  // å måtte utvide RICH_ALLOWED_TAGS (components.js sin sanitizeRichHtml())
  // for noko brukaren sjølv ba om i reint visuelle termar ("fet skrift på
  // overskrifter"), og er trygt IDEMPOTENT gjennom rik-tekst-editoren sin
  // eigen sanering (B/STRONG/P er alt tillatne, ingen ny åtferd der).
  function privacyTextToRichHtml(text) {
    return String(text || "").split(/\n\n+/).map(function (para) {
      var lines = para.split("\n");
      if (lines[0].indexOf("# ") === 0) {
        var heading = lines[0].slice(2);
        var restLines = lines.slice(1);
        var html = "<p><strong>" + C.esc(heading) + "</strong></p>";
        if (restLines.length) html += "<p>" + C.esc(restLines.join("\n")).replace(/\n/g, "<br>") + "</p>";
        return html;
      }
      return "<p>" + C.esc(para).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }

  function computeRetentionBlock(sc, hasContactForm, hasTilbud, hasBooking) {
    var forms = sc.privacy.forms || {};
    var activeIds = [];
    if (hasContactForm) activeIds.push("kontakt");
    if (hasTilbud)       activeIds.push("tilbud");
    if (hasBooking)      activeIds.push("booking");

    var filled = activeIds.filter(function (id) { return forms[id] && forms[id].retention; });
    // "# "-prefikset FØRSTE linje vert overskrifta (sjå privacyTextToRichHtml());
    // resten skal vere BRØDTEKST under same overskrift, difor \n (ikkje \n\n)
    // ved samanslåing under -- elles ville kvar enkelt lagringstid-linje blitt
    // sin eigen (feilaktige) overskrift i staden for éin liste under éi.
    var lines = ["# Hvor lenge lagrer vi opplysningene?"];

    if (!activeIds.length || !filled.length) {
      // Ingen aktive skjema, ELLER ingen av dei har fylt inn lagringstid --
      // kollaps til ÉI generisk setning i staden for N nesten-identiske
      // "ikkje fastsett"-linjer (Advisor sin eigen "svakt/repeterande"-åtvaring).
      lines.push("Vi lagrer opplysningene dine så lenge det er nødvendig for formålet de ble samlet inn for, og sletter dem deretter uten ugrunnet opphold, med mindre vi har en lovpålagt plikt til å lagre dem lenger.");
    } else {
      filled.forEach(function (id) {
        var label = PRIVACY_FORM_TYPES.filter(function (t) { return t.id === id; })[0].label;
        lines.push(label + ": " + forms[id].retention);
      });
      var unfilled = activeIds.filter(function (id) { return filled.indexOf(id) === -1; });
      if (unfilled.length) lines.push("For øvrige henvendelser lagrer vi ikke opplysningene lenger enn nødvendig for formålet.");
    }
    return privacyTextToRichHtml(lines.join("\n"));
  }

  function computeTenantPrivacyBlocks(sc, an) {
    var ft = sc.features || {};
    var hasContactForm = ft.contactForm !== false;
    var hasTilbud       = !!ft.quote;
    var hasBooking       = !!ft.booking;
    var hasChat          = ft.chat !== false;
    var hasAnalytics     = !!(an && (an.plausible || an.plausibleEmbed));
    var hasSidetelling   = !hasAnalytics && ft.sidetelling === true;
    // Konsolekrasj (2026-08-10, funne av brukar via reell testing på Vibeverk
    // sin eigen tenant): sc.contact/sc.company vart tidlegare lest rått, utan
    // fallback. Vibeverk sin eigen konfig manglar sc.contact heilt, som gav
    // "Cannot read properties of undefined (reading 'email')" -- kasta INNI
    // ein promise-kjede (både Standardforslag-klikket og drift-sjekken i den
    // publiserte visinga kallar denne funksjonen), så feilen synte seg aldri
    // som ei synleg feilmelding -- berre som "ingenting skjer" ved klikk, og
    // eit tomt Dokument-panel ved fanebyte tilbake (render kutta av FØR
    // pane.innerHTML vart sett, sidan begge stadene skjer FØR sjølve HTML-en
    // vert bygd). Same forsvarsmønster som resten av fila alt bruker andre
    // stader (t.d. sc.company || {} i renderSystem()).
    var company = sc.company || {};
    var contact = sc.contact || {};
    var contactInfo = [contact.email, contact.phone, contact.address].filter(Boolean);
    var orgNr = ((sc.footer || {}).orgNr || "").trim();

    var blocks = [];
    blocks.push({ id: "intro", source: "module", moduleId: "intro", included: true, edited: false, body: privacyTextToRichHtml(
      "# Om denne personvernerklæringen\nDenne personvernerklæringen forteller deg hvilke personopplysninger vi samler inn, hva vi bruker dem til, hvor lenge vi lagrer dem, og hvilke rettigheter du har. Den gjelder for alle som besøker nettsiden, tar kontakt med oss via skjemaene her, eller er ansatt og bruker våre interne arbeidsverktøy (Workspace)."
    ) });
    blocks.push({ id: "controller", source: "module", moduleId: "controller", included: true, edited: false, body: privacyTextToRichHtml(
      "# Hvem er behandlingsansvarlig?\n" + (company.name || "Vi") + (orgNr ? " (org.nr " + orgNr + ")" : "") + " er behandlingsansvarlig for personopplysningene som samles inn gjennom denne nettsiden. Det betyr at det er " + (company.name || "vi") + " — ikke leverandøren av selve nettsideplattformen — som bestemmer hva opplysningene brukes til og hvordan de behandles." +
      (contactInfo.length ? " Har du spørsmål om personvern, kan du kontakte oss på " + contactInfo.join(", ") + "." : "")
    ) });
    blocks.push({ id: "baseline", source: "module", moduleId: "baseline", included: true, edited: false, body: privacyTextToRichHtml(
      "# Hvor lagres opplysningene?\nNettsiden driftes hos Vercel. Innsendte opplysninger lagres i en database hos Supabase, med servere i Irland (EU).\n\n" +
      "# Dine rettigheter\nDu har rett til innsyn i hvilke opplysninger vi har lagret om deg, samt rett til å få disse korrigert eller slettet, i tråd med personopplysningsloven/GDPR. For å be om innsyn eller sletting, ta kontakt via kontaktinformasjonen på denne siden og merk henvendelsen «Personvern». Vi sletter opplysningene dine uten ugrunnet opphold. Du har også rett til å klage til Datatilsynet dersom du mener vi behandler personopplysningene dine i strid med regelverket. Du finner informasjon om hvordan du klager på datatilsynet.no."
    ) });
    // Vedtak 2026-08-06 (sak 6, "byggjast med standardformulering") -- bygd
    // 2026-08-12, ein månad forseinka (funne av begge agentane i den
    // uavhengige revisjonen, ikkje av brukaren fyrst). Alltid inkludert,
    // same "alltid aktiv"-grunngjeving som baseline/suppliers/intro/
    // controller/retention/breach -- Workspace-brukarkontoar finst
    // strukturelt for kvar einaste tenant (Supabase Auth), ikkje styrt av
    // noko features.*-flagg. MERK: teksten finst no i det publiserte
    // dokumentet, men ingen stad i Workspace lenkjer faktisk hit enno --
    // reell oppfølging, ikkje del av denne minimale fiksen.
    blocks.push({ id: "employees", source: "module", moduleId: "employees", included: true, edited: false, body: privacyTextToRichHtml(
      "# Personopplysninger om ansatte (Workspace)\nAnsatte som bruker vårt interne arbeidsverktøy (Workspace) får en brukerkonto med navn, e-postadresse og rolle. Opplysningene behandles for å administrere arbeidsforholdet og gi nødvendig tilgang til de interne verktøyene, med grunnlag i arbeidsforholdet og vår berettigede interesse i å drifte virksomheten. Kontoen og tilhørende opplysninger fjernes normalt når arbeidsforholdet opphører.\n" +
      "# Brukerstøtte\nVed behov for direkte brukerstøtte kan vår leverandør av nettsideplattformen generere en tidsavgrenset innloggingslenke for å bistå en administrator i Workspace, uten å få kjennskap til passordet. Dette skjer kun etter avtale, lenken utløper raskt, og hver forespørsel logges."
    ) });
    if (hasContactForm) blocks.push({ id: "mod-kontakt", source: "module", moduleId: "contactForm", included: true, edited: false, body: privacyTextToRichHtml(
      "# Kontaktskjema\nNår du sender oss en henvendelse, lagrer vi opplysningene du selv oppgir — typisk navn, e-postadresse, telefonnummer og innholdet i meldingen. Opplysningene brukes utelukkende til å besvare henvendelsen din, og deles ikke med tredjeparter for markedsføringsformål."
    ) });
    if (hasTilbud) blocks.push({ id: "mod-tilbud", source: "module", moduleId: "quote", included: true, edited: false, body: privacyTextToRichHtml(
      "# Tilbudsforespørsel\nNår du ber om tilbud, lagrer vi navn, e-postadresse, telefonnummer, innholdet i forespørselen og eventuelle vedlegg du laster opp. Opplysningene brukes til å utarbeide og sende deg et tilbud."
    ) });
    if (hasBooking) blocks.push({ id: "mod-booking", source: "module", moduleId: "booking", included: true, edited: false, body: privacyTextToRichHtml(
      "# Booking\nNår du reserverer en time/booking, lagrer vi navn, e-postadresse, telefonnummer, valgt tidspunkt og en eventuell melding. Opplysningene brukes til å gjennomføre avtalen."
    ) });
    blocks.push({ id: "retention", source: "module", moduleId: "retention", included: true, edited: false, body: computeRetentionBlock(sc, hasContactForm, hasTilbud, hasBooking) });
    var cookieText = hasAnalytics
      ? "Ja, vi bruker Plausible Analytics for trafikkstatistikk — et personvernvennlig analyseverktøy uten sporingscookies, som ikke samler inn personidentifiserbar informasjon om besøkende."
      : hasSidetelling
      ? "Den interne sidetellingen bruker ingen cookies og verken leser fra eller skriver til nettleserlagring for analysegruppering. Vi bruker sidetellingen til trafikkstatistikk (sidevisninger, henvisninger, klikk på kontaktknapper, en grov enhetskategori, enkel filtrering av automatisert trafikk, hvilke sider besøkende kommer fra/går til, og hvilken kampanje en lenke er merket med hvis du selv har lagt til dette i lenken, ofte kalt UTM). På serveren lager vi en kode av datoen, nettstedsadressen, IP-adressen og informasjon nettleseren automatisk sender. Selve hendelsen og dagskoden lagres. Av IP-adressen, nettstedsadressen og den detaljerte nettleserinformasjonen lagres bare dagskoden, ikke de rå verdiene, og koden endres automatisk hver dag. Vi bruker ingen separat analyseleverandør; hendelsene og dagskoden lagres i nettsidens Supabase-database hos driftsleverandøren."
      : "Nei. Denne siden bruker ingen cookies eller analyseverktøy som samler inn personopplysninger.";
    if (hasChat) blocks.push({ id: "mod-chat", source: "module", moduleId: "chat", included: true, edited: false, body: privacyTextToRichHtml(
      "# Chat\nNår du bruker chat-funksjonen på nettsiden, lagrer vi det du skriver, samt navn og e-postadresse dersom du oppgir dette. Vi lagrer også tekniske opplysninger som hvilken side du chattet fra, hvor du kom fra, og grunnleggende informasjon om nettleseren din. Opplysningene brukes til å besvare henvendelsen din."
    ) });
    blocks.push({ id: "mod-analytics", source: "module", moduleId: "analytics", included: true, edited: false, body: privacyTextToRichHtml("# Bruker vi cookies?\n" + cookieText) });
    blocks.push({ id: "mod-suppliers", source: "module", moduleId: "suppliers", included: true, edited: false, body: computeSupplierBlock(sc, an) });
    blocks.push({ id: "breach", source: "module", moduleId: "breach", included: true, edited: false, body: privacyTextToRichHtml(
      "# Melding ved brudd på personopplysningssikkerheten\nDersom det skulle oppstå et brudd på personopplysningssikkerheten — for eksempel uautorisert tilgang til eller tap av opplysninger — som medfører risiko for dine rettigheter og friheter, vil vi varsle Datatilsynet uten unødig opphold og senest innen 72 timer etter at vi ble kjent med bruddet, i tråd med personvernforordningen (GDPR) artikkel 33. Dersom bruddet innebærer høy risiko for deg, vil vi også varsle deg direkte."
    ) });
    return blocks;
  }

  // Fase 3 (leverandørregister): genererer "Tredjeparter"-blokka frå
  // VIBEVERK_VENDORS (faste fakta) + sc.privacy.suppliers.supabaseRegion
  // (einaste per-kunde-feltet) + den same hasAnalytics-avleiinga som
  // computeTenantPrivacyBlocks() alt reknar ut. IKKJE ei sjølvstendig
  // rendering-sti -- vert kalla FRÅ computeTenantPrivacyBlocks() og går
  // gjennom same mergePrivacyBlocks()/privacyGuardBlockedBlocks()-maskineri
  // som alle andre blokker, slik at ein operatør sin eigen redigering aldri
  // vert stille overskriven.
  //
  // Tom supabaseRegion (sak flagga av Arkitekten 2026-08-06, ikkje avklart
  // av beslutningsmøtet): skriv ALDRI ein spesifikk region vi ikkje har
  // stadfesta -- fell tilbake til ei generisk "i EU"-formulering til feltet
  // faktisk er fylt inn i Leverandørar-fana, same sikre standard som resten
  // av forslagsteksten alt brukar (aldri påstå meir enn vi veit).
  function computeSupplierBlock(sc, an) {
    var region = (sc.privacy.suppliers && sc.privacy.suppliers.supabaseRegion) || "";
    var lines = ["# Hvilke leverandører behandler opplysningene dine?"];
    var transferLines = [];
    (sc._vendorRegistry || VIBEVERK_VENDORS).forEach(function (v) {
      if (!vendorIsActive(v, an)) return;
      var whereText = v.id === "supabase"
        ? (region ? "Data er plassert i " + region + "." : "Data er plassert i EU.")
        : (VENDOR_COUNTRY_LABEL[v.country] === "USA" ? "Leverandøren er etablert i USA." : "Leverandøren er etablert i EU/EØS.");
      lines.push(v.name + " — " + v.whatItDoes + ". " + whereText);
      // "Standardforslag": VENDOR_TRANSFER_CUSTOMER_LABEL, ALDRI VENDOR_TRANSFER_LABEL
      // -- sistnemnde sin operatør-vende hedge ("ikkje stadfesta kva") skal
      // aldri lekke rått til ein besøkjande, sjå notatet ved definisjonen.
      if (v.transferMechanism && v.transferMechanism !== "none" && VENDOR_TRANSFER_CUSTOMER_LABEL[v.transferMechanism]) {
        transferLines.push(v.name + ": " + VENDOR_TRANSFER_CUSTOMER_LABEL[v.transferMechanism] + ".");
      }
    });
    if (transferLines.length) {
      lines.push("# Overføring av opplysninger utenfor EU/EØS\nNoen av leverandørene våre er etablert utenfor EU/EØS. Vi sørger for at slike overføringer skjer i tråd med personvernregelverket:\n" + transferLines.join("\n"));
    }
    return privacyTextToRichHtml(lines.join("\n\n"));
  }

  // Slår saman eit friskt sett med modul-forslag med det som alt står i
  // dokumentet: ei blokk operatøren HAR REDIGERT (edited:true) vert normalt
  // aldri stille overskriven; manuelle blokker vert ALLTID tekne vare på
  // (uansett forceOverwrite); ei modul-blokk for ein modul som ikkje lenger
  // er aktiv vert òg teken vare på (operatøren må fjerne ho sjølv via
  // hybrid-vakta sitt varsel) -- aldri stille sletta berre fordi ho ikkje
  // dukka opp i det friske forslaget.
  //
  // forceOverwrite (2026-08-10, brukarvedtak): "Standardforslag" skal kunne
  // nullstille redigerte modul-avsnitt til fersk standardtekst -- MEN aldri
  // røre eigne, manuelt tilføyde avsnitt (source:"manual" er urørt uansett,
  // sjå pushen under). Klikk-handteraren viser ei åtvaring FØR dette kallet
  // skjer dersom det faktisk finst noko redigert å overskrive.
  function mergePrivacyBlocks(existingBlocks, freshBlocks, forceOverwrite) {
    var existingById = {};
    (existingBlocks || []).forEach(function (b) { existingById[b.id] = b; });
    var merged = freshBlocks.map(function (fresh) {
      var existing = existingById[fresh.id];
      if (existing && existing.edited && !forceOverwrite) return existing;
      return Object.assign({}, fresh, { included: existing ? existing.included : true });
    });
    var freshIds = {};
    freshBlocks.forEach(function (f) { freshIds[f.id] = true; });
    (existingBlocks || []).forEach(function (b) {
      if (b.source === "manual" || !freshIds[b.id]) merged.push(b);
    });
    return merged;
  }

  function privacyGuardBlockedBlocks(sc, an, blocks) {
    return (blocks || []).filter(function (b) {
      return b.source === "module" && !b.included && privacyModuleActive(sc, an, b.moduleId);
    });
  }

  // Fase 5 (endringsvarsling, 2026-08-06): kva modul-avsnitt kan ha drive
  // vekk frå verkelegheita SIDAN denne versjonen vart publisert -- ALDRI ei
  // sperre, ALDRI ei automatisk tekstendring, berre eit varsel om at ein NY
  // draft bør lagast for å sjå eit oppdatert forslag.
  //
  // To signal, medvite avgrensa (Arkitekt-planlagt, sjå CHANGELOG 0.104.0):
  //  (a) manglar heilt -- eit modul-avsnitt computeTenantPrivacyBlocks()
  //      ville generert i dag finst ikkje i det heile i den publiserte
  //      teksten (ny funksjon slått på ETTER publisering, eller ein versjon
  //      publisert før akkurat den modulen/blokka fanst i det heile).
  //  (b) uendra tekst har drive -- eit `edited:false`-avsnitt (aldri redigert
  //      av operatøren) sitt lagra innhald matchar ikkje lenger det
  //      computeTenantPrivacyBlocks() ville generert for same blokk i dag
  //      (t.d. cookie-teksten sin 3-vegs Plausible/sidetelling/ingen-gren).
  //
  // Medvite IKKJE flagga:
  //  - `edited:true`-avsnitt (operatøren sin eigen tekst -- mergePrivacyBlocks()
  //    sin heile føremål er at desse ALDRI vert samanlikna mot forslaget att).
  //  - Eit no-inaktivt sitt avsnitt som framleis står att i publisert tekst
  //    (mergePrivacyBlocks() sitt eksisterande, medvitne "operatøren fjernar
  //    sjølv"-mønster -- eit anna, alt akseptert problem, ikkje denne fasen).
  //  - `included:false` i det heile -- strukturelt uråd på ein publisert
  //    versjon, sidan privacyGuardBlockedBlocks() alt nekta publisering av
  //    ein ekskludert-men-aktiv modul-blokk i utgangspunktet.
  function privacyPublishedDrift(sc, an, version) {
    var fresh = computeTenantPrivacyBlocks(sc, an);
    var freshById = {};
    fresh.forEach(function (f) { freshById[f.id] = f; });
    var published = (version.bodyBlocks || []).filter(function (b) { return b.source === "module"; });
    var publishedIds = {};
    published.forEach(function (b) { publishedIds[b.id] = true; });

    var driftedModuleIds = fresh
      .filter(function (f) { return !publishedIds[f.id]; })
      .map(function (f) { return f.moduleId; });
    published.forEach(function (b) {
      if (!b.edited && freshById[b.id] && freshById[b.id].body !== b.body && driftedModuleIds.indexOf(b.moduleId) === -1) {
        driftedModuleIds.push(b.moduleId);
      }
    });
    return driftedModuleIds;
  }

  function privacyBlocksToFlatHtml(blocks) {
    return (blocks || []).filter(function (b) { return b.included; }).map(function (b) { return b.body; }).join("");
  }

  // Fase 4 (godkjenning, UX-funn HIGH): billeg "har noko endra sidan
  // godkjenninga"-fingeravtrykk -- ingen hashing, berre den flate teksten
  // sjølv (heading + innhald), same idiom som resten av fila brukar (t.d.
  // privacyBlocksToFlatHtml() sjølv). Lagra på version.approval.contentSnapshot
  // ved registreringstidspunktet, samanlikna mot noverande innhald ved kvar
  // rendering -- IKKJE for å fjerne journalposten (datoen/kven/kanalen er
  // framleis sann historie), berre for å varsle at TEKSTEN har drive vekk frå
  // det som faktisk vart godkjent.
  function privacyApprovalContentSnapshot(version) {
    return (version.heading || "") + "|" + privacyBlocksToFlatHtml(version.bodyBlocks);
  }

  // Fase 4 (godkjenning/eksport): "Last ned som HTML" for DEN PUBLISERTE
  // versjonen -- til kunden sitt eige compliance-arkiv. Reint statisk,
  // sjølvstendig HTML-dokument (ingen ekstern CDN-referanse, ingen
  // avhengigheit til Vibeverk sin eigen infrastruktur for å opnast seinare).
  // Same nedlastingsmønster som priserExportImage() (Blob + ObjectURL +
  // trigga <a download>), berre tekst i staden for eit <canvas>-bilete.
  function privacyExportPublishedHtml(version, tenantName) {
    // Security Auditor-funn (Fase 4, MEDIUM): termsField() (components.js)
    // sanerer ALLTID denne same typen innhald på nytt ved kvar rendering til
    // ein ekte besøkjande, sidan gamal migrert priv.text (frå FØR
    // versjonssystemet, sjå migrateLegacyPrivacyText()) kan innehalde
    // usanert HTML som aldri vart rørt igjen om ein operatør aldri opna og
    // lagra akkurat den blokka i editoren. Denne eksportfunksjonen las
    // tidlegare bodyBlocks RÅTT, utan denne same "saner ved bruk"-disiplinen
    // -- farleg spesifikt her sidan fila er MEINT å opnast i ein nettlesar
    // seinare (kunden sitt eige arkiv). sanitizeRichHtml() er idempotent, så
    // dette er gratis for det vanlege, alt trygge tilfellet.
    var bodyHtml = C.sanitizeRichHtml(privacyBlocksToFlatHtml(version.bodyBlocks)) || "<p>(Tomt innhald)</p>";
    var publishedStr = version.publishedAt ? new Date(version.publishedAt).toLocaleString("nb-NO") : "";
    var doc = "<!doctype html><html lang=\"no\"><head><meta charset=\"utf-8\">" +
      "<title>" + C.esc(version.heading || "Personvernerklæring") + "</title>" +
      "<style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:2.5rem auto;padding:0 1.5rem;color:#1a1a1a}h1{font-size:1.5rem}p.meta{color:#666;font-size:.85rem}</style>" +
      "</head><body>" +
      "<h1>" + C.esc(version.heading || "Personvernerklæring") + "</h1>" +
      (publishedStr ? "<p class=\"meta\">" + (tenantName ? C.esc(tenantName) + " — " : "") + "Publisert " + C.esc(publishedStr) + "</p>" : "") +
      bodyHtml +
      "</body></html>";
    var blob = new Blob([doc], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = "personvernerklaering-" + (tenantName ? tenantName + "-" : "") + stamp + ".html";
    a.click();
    URL.revokeObjectURL(url);
  }

  /* --- Dokument-fana ------------------------------------------------------ */
  function renderPersonvernDokument(sc, pane, wrap) {
    var priv = sc.privacy;
    var version = privacyActiveVersion(sc);

    if (version.status === "published") {
      if (wrap) wrap._privacyFlush = null; // ingenting redigerbart i denne greina
      // Fase 5 (endringsvarsling, 2026-08-06): sc._privacyAn er berre sett
      // etter fyrste vellykka henting (sjå fetch-blokka under) -- fyrste
      // rendering i ei fersk fane-opning har han difor ikkje enno, og
      // drift-sjekken hoppar trygt over (tom liste, ingen falsk pille) til
      // svaret kjem attende og paneet vert bedt om å rendre seg sjølv på
      // nytt éin gong.
      var an = sc._privacyAn || null;
      var drift = an ? privacyPublishedDrift(sc, an, version) : [];
      var driftLabels = drift.map(function (id) { return PRIVACY_MODULE_LABEL[id] || id; });
      // UX-funn (Fase 5, MEDIUM): pilla flytta UT av <legend> og inn i
      // avsnittet under -- to piller i sjølve overskrifta stabla til 3 rader
      // på 375px (målt i faktisk rendering), medan avsnittsteksten alt
      // wrappar fint på smale skjermar. "Sjekkar …"-linja under (vist FØR
      // svaret kjem attende) fjernar òg det uforklarte layout-hoppet --
      // operatøren ser no KVIFOR noko endrar seg eit augeblikk seinare.
      pane.innerHTML =
        '<fieldset class="admin-group"><legend>Personvernerklæring — <span class="kd-pill kd-pill--active">Publisert</span></legend>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Publisert ' + C.esc(new Date(version.publishedAt).toLocaleString("nb-NO")) + '. Ei publisert versjon kan ikkje redigerast direkte — trykk "Rediger" for å opprette eit nytt utkast basert på henne. Historikken held fram uendra.</p>' +
          (driftLabels.length
            ? '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem"><span class="kd-pill kd-pill--provisioning">Bør sjekkast</span> Sidan denne teksten vart publisert kan desse avsnitta ha endra seg: <strong>' + C.esc(driftLabels.join(", ")) + '</strong>. Teksten er ikkje endra automatisk — opprett eit nytt utkast for å sjå eit oppdatert forslag.</p>'
            : (an ? '' : '<p style="font-size:.78rem;color:var(--color-muted);margin:0 0 .8rem">Sjekkar om innhaldet framleis stemmer med aktive modular…</p>')) +
          '<div style="border:1px solid var(--color-border);border-radius:8px;padding:.8rem">' + (privacyBlocksToFlatHtml(version.bodyBlocks) || '<p style="color:var(--color-muted)">(Tomt innhald)</p>') + '</div>' +
        '</fieldset>' +
        '<div style="margin-top:1rem;display:flex;gap:.6rem;flex-wrap:wrap">' +
          C.button({ label: "Rediger (opprett nytt utkast)", variant: "primary", attrs: 'type="button" id="cs-priv-new-draft"' }) +
          C.button({ label: "Generer full tekstversjon", variant: "ghost", attrs: 'type="button" id="cs-priv-fulltext"' }) +
          C.button({ label: "Last ned som HTML", variant: "ghost", attrs: 'type="button" id="cs-priv-export"' }) +
        '</div>';
      pane.querySelector("#cs-priv-new-draft").addEventListener("click", function () {
        var draft = privacyCloneVersionAsDraft(version);
        priv.versions.push(draft);
        priv.activeVersionId = draft.id;
        // Same fire-and-forget-konvensjon som saveSC() sjølv (loggar berre
        // feil, ventar ikkje på stadfesta skriving før UI-et går vidare) --
        // konsistent med resten av denne fana.
        savePrivacyVersions(sc, _activeTenant && _activeTenant.id, function (r) {
          if (r && r.error) console.error("[console] personvern-versjonering feila:", r.error);
        });
        renderPersonvernDokument(sc, pane, wrap);
      });
      // Brukarønske (2026-08-12): éin samanhengande, lesbar visning av heile
      // dokumentet -- lettare å lese gjennom enn å bla mellom enkeltavsnitt.
      // Reint les-modus, ingen redigering, difor trygt å bruke same
      // privacyBlocksToFlatHtml() som den publiserte visinga alt brukar.
      pane.querySelector("#cs-priv-fulltext").addEventListener("click", function () {
        showTextPreviewModal("Personvernerklæring — full tekst", privacyBlocksToFlatHtml(version.bodyBlocks) || "<p>(Tomt innhald)</p>", true);
      });
      // Fase 4 (eksport, 2026-08-06): brukaren avklarte eksplisitt -- kun ein
      // nedlastbar fil av DEN PUBLISERTE versjonen, til kunden sitt eige
      // compliance-arkiv. Ingen revisjonseksport/JSON i denne fasen.
      pane.querySelector("#cs-priv-export").addEventListener("click", function () {
        privacyExportPublishedHtml(version, _activeTenant && _activeTenant.slug);
      });
      // Fase 5: hentar "analytics" lat, kun om ikkje alt i minnet -- éin
      // rendering til med drift-sjekken påslått, aldri ei blokkerande
      // innlasting av sjølve visinga over. getStoreKeyOrError(), IKKJE
      // getStoreKey() -- same grunn som Leverandørar-fana sin tilsvarande
      // fiks (Fase 3, MEDIUM): ein forbigåande nettverksfeil skal ALDRI
      // stille cachast som "{}" (tolka som "ingen analyse konfigurert"),
      // sidan det kunne slå ut ei feilaktig "Cookies/analyse bør sjekkast"-
      // varsling for ein kunde som faktisk har Plausible aktivt. Ved feil:
      // ikkje cache noko, berre prøv på nytt neste gong nokon opnar fana.
      if (!an) {
        getStoreKeyOrError("analytics", function (fetchedAn, err) {
          if (_privacyView !== "dokument") return; // same navigert-vekk-vakt som resten av fila
          if (err) { console.error("[console] kunne ikkje hente analytics for endringsvarsling:", err); return; }
          sc._privacyAn = fetchedAn || {};
          renderPersonvernDokument(sc, pane, wrap);
        });
      }
      return;
    }

    var blocks = version.bodyBlocks || [];
    var blocksHtml = blocks.length ? blocks.map(function (b) {
      var isModule = b.source === "module";
      var moduleActive = isModule && privacyModuleActive(sc, sc._privacyAn || {}, b.moduleId);
      var sourceLabel = isModule ? ("Modul: " + (PRIVACY_MODULE_LABEL[b.moduleId] || b.moduleId || "")) : "Manuelt lagt til";
      // Brukarvedtak (2026-08-10): sidan "Standardforslag" no kan overskrive
      // redigerte avsnitt (sjå #cs-priv-fetch), skal det ALLTID vere synleg,
      // ikkje berre hugsa i data, kva for avsnitt som faktisk avviker fra
      // Vibeverk sin standardtekst -- gjev operatøren (og reelt Vibeverk sjølv
      // om noko seinare vert juridisk omtvista) eit tydeleg spor over kven som
      // har endra kva.
      var deviationPill = (isModule && b.edited)
        ? ' <span class="kd-pill kd-pill--provisioning" title="Denne teksten er redigert bort fra Vibeverk sitt standardforslag">Avviker fra standardforslag</span>'
        : '';
      return '<div class="admin-group" data-privacy-block="' + C.esc(b.id) + '" style="margin-bottom:1rem">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;flex-wrap:wrap;gap:.5rem">' +
          '<span style="display:flex;align-items:center;flex-wrap:wrap;gap:.4rem"><span style="font-size:.76rem;font-weight:700;color:var(--color-muted);text-transform:uppercase;letter-spacing:.03em">' + C.esc(sourceLabel) + '</span>' + deviationPill + '</span>' +
          '<label style="font-size:.85rem;display:flex;align-items:center;gap:.4rem"><input type="checkbox" data-privacy-block-included="' + C.esc(b.id) + '"' + (b.included ? " checked" : "") + '> Inkluder i publisert tekst</label>' +
        '</div>' +
        (moduleActive && !b.included ? '<p style="font-size:.78rem;color:#c0392b;margin:0 0 .5rem">⚠ Denne modulen er aktiv for kunden, men avsnittet er ekskludert — kan ikkje publiserast slik.</p>' : '') +
        C.richTextField({ id: "privacy-block-" + b.id, label: "Innhold", value: b.body }) +
        (isModule ? "" : '<button type="button" class="btn btn--ghost btn--sm" data-privacy-block-remove="' + C.esc(b.id) + '" style="margin-top:.5rem">Fjern avsnitt</button>') +
      '</div>';
    }).join("") : '<p style="color:var(--color-muted)">Ingen avsnitt ennå — bruk "Standardforslag" eller legg til eit eige.</p>';

    pane.innerHTML =
      '<fieldset class="admin-group"><legend>Personvernerklæring — <span class="kd-pill kd-pill--provisioning">Utkast</span></legend>' +
        '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Vises i popup på kontaktskjema, booking og tilbud, og via «Personvern»-lenka i footer, ETTER publisering.</p>' +
        C.field({ id: "cs-priv-heading", label: "Overskrift", value: version.heading || "" }) +
        '<div style="margin:.6rem 0 1rem;display:flex;gap:.6rem;flex-wrap:wrap">' +
          C.button({ label: "Standardforslag", variant: "ghost", attrs: 'type="button" id="cs-priv-fetch"' }) +
          C.button({ label: "+ Legg til eige avsnitt", variant: "ghost", attrs: 'type="button" id="cs-priv-add"' }) +
        '</div>' +
        '<p style="font-size:.78rem;color:var(--color-muted);margin:0 0 1rem">"Standardforslag" set saman eit fullstendig utkast: avsnitt for kvar aktiv modul (kontaktskjema, tilbud, booking, cookies/analyse, leverandørar) pluss Vibeverk sine faste standardavsnitt (innleiing, behandlingsansvarleg, lagringstid, avviksvarsling). Alle desse avsnitta kan redigerast fritt, men — i likskap med «Generelt» og «Leverandørar» — kan dei IKKJE ekskluderast frå publisert tekst med avkryssingsboksen, sidan dei gjeld alle kundar likt. Manuelt lagde avsnitt kan derimot fjernast heilt. <strong>Trykker du "Standardforslag" på nytt, blir tidlegare redigerte avsnitt overskrivne med fersk standardtekst (etter ei åtvaring) — eigne, manuelt tilføyde avsnitt vert aldri rørt.</strong> Redigerte avsnitt er merkte "Avviker fra standardforslag" så du ser kva som er endra. <strong>Dette er berre eit utgangspunkt frå oss</strong> — kunden er juridisk ansvarleg for at teksten faktisk stemmer.</p>' +
        '<div id="privacy-blocks">' + blocksHtml + '</div>' +
      '</fieldset>' +
      '<fieldset class="admin-group"><legend>Godkjenning frå kunden</legend>' +
        '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Reint internt notat — registrer at kunden faktisk har sett og godtatt innhaldet, t.d. etter ein telefonsamtale eller e-postutveksling. <strong>Blokkerer ikkje publisering</strong> — til eiga dokumentasjon.</p>' +
        (version.approval && version.approval.approvedAt
          ? '<p style="font-size:.85rem;margin:0 0 .8rem">' +
            (version.approval.contentSnapshot === privacyApprovalContentSnapshot(version)
              ? '<span class="kd-pill kd-pill--active">Godkjent</span>'
              // UX-funn (Fase 4, HIGH): utan dette ville ei godkjenning stå att
              // som eit grønt, tilsynelatande gyldig stempel sjølv etter at
              // avsnitta faktisk er endra sidan -- kunden godkjende IKKJE den
              // noverande teksten. Fjernar aldri sjølve journalposten (dato/
              // kven/kanal er framleis sann historie), varslar berre at
              // INNHALDET har drive vekk frå det som vart godkjent.
              : '<span class="kd-pill kd-pill--provisioning">Godkjent (innhald endra sidan)</span>') +
            ' av ' + C.esc(version.approval.approvedBy || "(ikkje oppgitt)") +
            ' via ' + C.esc(APPROVAL_CHANNEL_LABEL[version.approval.channel] || "ikkje oppgitt") + ', ' + C.esc(new Date(version.approval.approvedAt).toLocaleString("nb-NO")) +
            (version.approval.note ? '<br><span style="color:var(--color-muted)">' + C.esc(version.approval.note) + '</span>' : '') +
            ' ' + C.button({ label: "Fjern godkjenning", variant: "ghost", attrs: 'type="button" id="cs-approval-clear" style="margin-left:.4rem;padding:.15rem .6rem;font-size:.76rem"' }) +
            '</p>'
          : '<p style="font-size:.85rem;color:var(--color-muted);margin:0 0 .8rem">Ikkje registrert enno.</p>') +
        C.field({ id: "cs-approval-by", label: "Godkjent av (namn/rolle hos kunden)", value: (version.approval && version.approval.approvedBy) || "" }) +
        '<div class="field"><label for="cs-approval-channel">Kanal</label><select id="cs-approval-channel">' +
          APPROVAL_CHANNELS.map(function (o) { return '<option value="' + o[0] + '"' + ((version.approval && version.approval.channel) === o[0] ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") +
        '</select></div>' +
        C.field({ id: "cs-approval-note", label: "Notat (valfritt)", value: (version.approval && version.approval.note) || "", multiline: true, rows: 2 }) +
        C.button({ label: "Registrer godkjenning", variant: "ghost", attrs: 'type="button" id="cs-approval-save"' }) +
      '</fieldset>' +
      '<div style="display:flex;gap:.6rem;align-items:center;margin-top:1rem;flex-wrap:wrap">' +
        C.button({ label: "Lagre som utkast", variant: "ghost", attrs: 'type="button" id="cs-priv-save-draft"' }) +
        C.button({ label: "Publiser", variant: "primary", attrs: 'type="button" id="cs-priv-publish"' }) +
        C.button({ label: "Generer full tekstversjon", variant: "ghost", attrs: 'type="button" id="cs-priv-fulltext"' }) +
      '</div>' +
      '<p class="form__status" id="cs-status" style="margin-top:.6rem"></p>';

    App.ui.bindRichTextFields(pane);

    function captureFieldEdits() {
      var headingEl = pane.querySelector("#cs-priv-heading");
      if (!headingEl) return; // paneet er alt bytt vekk -- ingenting å fange
      version.heading = headingEl.value.trim();
      blocks.forEach(function (b) {
        var html = App.ui.readRichTextField(pane, "privacy-block-" + b.id);
        if (html !== b.body) { b.body = html; if (b.source === "module") b.edited = true; }
      });
      // Fase 4: held godkjennings-FELTA i synk med det operatøren skriv (så
      // eit fanebyte ikkje mistar det), MEN rører ALDRI approvedAt her --
      // det tidsstempelet vert berre sett av den eksplisitte "Registrer
      // godkjenning"-knappen under, aldri berre av å skrive i eit felt.
      var byEl = pane.querySelector("#cs-approval-by");
      if (byEl) {
        version.approval = version.approval || {};
        version.approval.approvedBy = byEl.value.trim();
        version.approval.channel = pane.querySelector("#cs-approval-channel").value;
        version.approval.note = pane.querySelector("#cs-approval-note").value.trim();
      }
    }
    // UX-review-funn 2026-08-06 (STENGJANDE): registrer denne som fana sin
    // eigen "flush"-funksjon -- kalla av renderPersonvern() FØR sjølve
    // fanebytet knuser dette paneet sin DOM, slik at skrivne-men-ikkje-lagra
    // rik-tekst-endringar ikkje forsvinn stille.
    if (wrap) wrap._privacyFlush = captureFieldEdits;

    pane.querySelectorAll("[data-privacy-block-included]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        captureFieldEdits();
        var id = cb.getAttribute("data-privacy-block-included");
        var block = blocks.filter(function (b) { return b.id === id; })[0];
        if (block) block.included = cb.checked;
        renderPersonvernDokument(sc, pane, wrap); // trygt å fullt re-rendre -- ingen tastetrykk pågår, berre ei avkryssingsboks som endra seg
      });
    });

    pane.querySelectorAll("[data-privacy-block-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        captureFieldEdits();
        var id = btn.getAttribute("data-privacy-block-remove");
        version.bodyBlocks = blocks.filter(function (b) { return b.id !== id; });
        renderPersonvernDokument(sc, pane, wrap);
      });
    });

    // Fase 4 (godkjenning, 2026-08-06): eksplisitt "Registrer"-knapp, IKKJE
    // berre å skrive i felta -- approvedAt skal berre stemplast ved eit
    // MEDVITE klikk, aldri implisitt av captureFieldEdits() sin flush-bruk
    // (sjå notatet der). Same fire-and-forget-lagringskonvensjon som "Rediger
    // (opprett nytt utkast)" over.
    pane.querySelector("#cs-approval-save").addEventListener("click", function () {
      captureFieldEdits();
      // UX-funn (Fase 4, MEDIUM): utan denne sjekken kunne eit tomt klikk
      // registrere ei "godkjenning" utan noka faktisk namn -- syner då som
      // "Godkjent av (ikkje oppgitt)", som ser ut som korrupt data, ikkje
      // som "ikkje registrert".
      if (!version.approval || !version.approval.approvedBy) {
        statusMsg(pane.querySelector("#cs-status"), "Fyll inn kven som godkjente før du registrerer.", false);
        return;
      }
      version.approval.approvedAt = Date.now();
      version.approval.contentSnapshot = privacyApprovalContentSnapshot(version);
      savePrivacyVersions(sc, _activeTenant && _activeTenant.id, function (r) {
        if (r && r.error) { statusMsg(pane.querySelector("#cs-status"), "Kunne ikkje lagre: " + r.error, false); return; }
        renderPersonvernDokument(sc, pane, wrap);
      });
    });

    // UX-funn (Fase 4, MEDIUM): ingen veg tilbake til "Ikkje registrert enno"
    // utan denne -- ei feilregistrering (t.d. finn C over, eller berre eit
    // feilklikk) kunne elles berre OVERSKRIVAST, aldri fjernast heilt. Tier A
    // (fullt reversibel, rører ikkje sjølve avsnitta/publiseringsstatus) --
    // ingen confirm() trengst, per copy-style-guide.
    var clearBtn = pane.querySelector("#cs-approval-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        captureFieldEdits();
        version.approval = null;
        savePrivacyVersions(sc, _activeTenant && _activeTenant.id, function (r) {
          if (r && r.error) { statusMsg(pane.querySelector("#cs-status"), "Kunne ikkje lagre: " + r.error, false); return; }
          renderPersonvernDokument(sc, pane, wrap);
        });
      });
    }

    pane.querySelector("#cs-priv-fetch").addEventListener("click", function () {
      captureFieldEdits();
      // Brukarvedtak (2026-08-10, ingen ekte kundar enno): "Standardforslag"
      // skal nullstille redigerte modul-avsnitt til fersk standardtekst i
      // staden for å stille la dei stå (den gamle, trygge fletting-åtferda) --
      // grunngjeving: ein operatør som sjølv har endra teksten, og seinare
      // trur eit nytt klikk faktisk oppdaterer henne, skal ikkje sitje att med
      // ei stille uendra, kanskje utdatert side utan å vite det. Åtvarar FØR
      // noko skjer, og berre når det faktisk finst noko å overskrive -- eit
      // heilt ferskt/urørt dokument treng ingen åtvaring. Eigne, manuelt
      // tilføyde avsnitt (source:"manual") vert ALDRI overskrivne/fjerna,
      // uansett -- sjå mergePrivacyBlocks() sin eigen kommentar.
      var hasEditedModuleBlocks = (blocks || []).some(function (b) { return b.source === "module" && b.edited; });
      if (hasEditedModuleBlocks && !confirm("Dette vil overskrive alle avsnitt du har redigert bort fra Vibeverk sitt standardforslag, med fersk standardtekst. Egne, manuelt tilføyde avsnitt blir ikke rørt. Fortsette?")) return;
      getStoreKey("analytics", function (an) {
        // UX-review-funn 2026-08-06 (HIGH): fangar felta PÅ NYTT etter det
        // asynkrone spranget -- ein operatør kan ha rokke å skrive meir i eit
        // ANNA avsnitt medan nettverkskallet var undervegs, og den fyrste
        // captureFieldEdits()-en over fangar ikkje det.
        captureFieldEdits();
        sc._privacyAn = an;
        var fresh = computeTenantPrivacyBlocks(sc, an);
        version.bodyBlocks = mergePrivacyBlocks(version.bodyBlocks, fresh, true);
        renderPersonvernDokument(sc, pane, wrap);
      });
    });

    pane.querySelector("#cs-priv-add").addEventListener("click", function () {
      captureFieldEdits();
      version.bodyBlocks = blocks.concat([{ id: privacyNewId("b"), source: "manual", moduleId: null, included: true, edited: true, body: "" }]);
      renderPersonvernDokument(sc, pane, wrap);
    });

    pane.querySelector("#cs-priv-save-draft").addEventListener("click", function () {
      captureFieldEdits();
      // "Lagre som utkast" rører BERRE versions/activeVersionId -- skal
      // ALDRI kalle saveSC()/den offentlege nøkkelen (sjå notatet ved
      // migratePrivacyVersions()). Ventar her på stadfesta skriving (i
      // motsetnad til fire-and-forget elles i fana) sidan denne skrive-
      // operasjonen er fleire steg (les-endre-skriv mot ein annan nøkkel) og
      // kan reelt feile på ein måte operatøren bør få vite om før dei går
      // vidare og trur utkastet er trygt lagra.
      var savingTenantId = _activeTenant && _activeTenant.id;
      savePrivacyVersions(sc, savingTenantId, function (r) {
        if (r && r.error) { statusMsg(pane.querySelector("#cs-status"), "Kunne ikkje lagre: " + r.error, false); return; }
        statusMsg(pane.querySelector("#cs-status"), "✓ Lagra som utkast", true);
      });
    });

    // Brukarønske (2026-08-12): fangar FYRST opp skrivne-men-ikkje-lagra
    // endringar (same captureFieldEdits() som Lagre/Publiser brukar) slik at
    // førehandsvisinga speglar det operatøren faktisk ser i felta akkurat
    // no, ikkje sist lagra tilstand.
    pane.querySelector("#cs-priv-fulltext").addEventListener("click", function () {
      captureFieldEdits();
      showTextPreviewModal("Personvernerklæring — full tekst (utkast)", privacyBlocksToFlatHtml(version.bodyBlocks) || "<p>(Tomt innhald)</p>", true);
    });

    pane.querySelector("#cs-priv-publish").addEventListener("click", function () {
      captureFieldEdits();
      // UX-review-funn 2026-08-06 (HIGH): brukar getStoreKeyOrError(), ikkje
      // getStoreKey(), for nettopp DENNE sjekken -- ein forbigåande
      // nettverksfeil skal ALDRI stille tolkast som "ingen analyseverktøy
      // aktivt" og la publiseringa gå gjennom uverifisert. Hybrid-vakta sitt
      // heile føremål er å hindre nettopp dette.
      getStoreKeyOrError("analytics", function (an, err) {
        if (err) {
          statusMsg(pane.querySelector("#cs-status"), "Kunne ikkje verifisere kundens moduloppsett -- prøv igjen før du publiserer.", false);
          return;
        }
        // UX-review-funn 2026-08-06 (HIGH): fangar felta PÅ NYTT etter det
        // asynkrone spranget, av same grunn som i fetch-handteraren over.
        captureFieldEdits();
        var blocked = privacyGuardBlockedBlocks(sc, an, version.bodyBlocks);
        if (blocked.length) {
          alert('Kan ikkje publisere: ' + blocked.length + ' avsnitt knytt til ein aktiv modul er ekskludert (' + blocked.map(function (b) { return PRIVACY_MODULE_LABEL[b.moduleId] || b.moduleId; }).join(", ") + '). Inkluder dei att, eller fjern/deaktiver modulen for kunden fyrst i Modular-fana.');
          return;
        }
        if (!confirm("Publisere denne versjonen? Han vert synleg for besøkjande på nettsida med ein gong. Den nåverande publiserte teksten (om nokon) forsvinn ikkje -- ho held fram i Historikk, og du kan alltid rette opp ein feil ved å publisere ein ny versjon seinare.")) return;
        version.status = "published";
        version.publishedAt = Date.now();
        priv.activeVersionId = version.id;
        priv.heading = version.heading || "";
        priv.text = privacyBlocksToFlatHtml(version.bodyBlocks);
        // Trygge, ufarlege peikarar til den offentlege nøkkelen (Fase 2) --
        // sjå privacyPublicProjection() sitt notat for kvifor.
        priv.publishedVersionId = version.id;
        priv.publishedAt = version.publishedAt;
        var savingTenantId = _activeTenant && _activeTenant.id;
        // To skrivingar: FYRST versions/activeVersionId til superconfig-
        // private (aldri anon-lesbar), DEREFTER den offentlege flate
        // projeksjonen (heading/text/forms/consentPurposes) til superconfig
        // -- i DEN rekkjefølgja, slik at eit feila privat-skriv aldri let ein
        // NY, uverifisert versjon bli synt offentleg utan at han faktisk vart
        // trygt lagra fyrst.
        savePrivacyVersions(sc, savingTenantId, function (r1) {
          if (r1 && r1.error) { statusMsg(pane.querySelector("#cs-status"), "Kunne ikkje lagre versjonshistorikk: " + r1.error, false); return; }
          getSC(function (sc2) {
            sc2.privacy = privacyPublicProjection(sc);
            saveSC(sc2, savingTenantId);
            statusMsg(pane.querySelector("#cs-status"), "✓ Publisert!", true);
            renderPersonvernDokument(sc, pane, wrap);
          });
        });
      });
    });
  }

  /* --- Skjematekster-fana -------------------------------------------------- */
  function renderPersonvernSkjema(sc, pane, wrap) {
    var forms = sc.privacy.forms || {};
    pane.innerHTML =
      '<form id="cs-form">' +
        PRIVACY_FORM_TYPES.map(function (f) {
          var form = forms[f.id] || {};
          return '<fieldset class="admin-group" style="margin-bottom:1rem"><legend>' + C.esc(f.label) + '</legend>' +
            C.field({ id: "priv-form-" + f.id + "-purpose", label: "Formål", value: form.purpose || "" }) +
            '<div class="field"><label>Behandlingsgrunnlag' + C.helpIcon("Hvilket av de seks GDPR-grunnlagene som gjelder. Ikke fylt inn automatisk -- avgjøres av deg eller en jurist. For et vanlig kontaktskjema er «Avtale / oppfyllelse før avtale» ofte mer riktig enn samtykke.") + '</label>' +
              '<select id="priv-form-' + f.id + '-legalbasis">' +
                PRIVACY_LEGAL_BASIS_OPTIONS.map(function (o) { return '<option value="' + o[0] + '"' + (form.legalBasis === o[0] ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") +
              '</select></div>' +
            C.field({ id: "priv-form-" + f.id + "-retention", label: "Lagringstid", value: form.retention || "", placeholder: "Ikke fastsatt", hint: "Hvor lenge opplysningene beholdes, f.eks. «12 måneder etter avsluttet dialog»." }) +
            C.field({ id: "priv-form-" + f.id + "-recipients", label: "Mottakere", value: form.recipients || "", hint: "Andre som mottar disse opplysningene, f.eks. et bookingsystem eller regnskapsfører. La stå tomt om ingen." }) +
            '<div style="margin:.4rem 0 .3rem">' + C.button({ label: "Foreslå tekst", variant: "ghost", attrs: 'type="button" data-priv-form-suggest="' + C.esc(f.id) + '"' }) + '</div>' +
            C.richTextField({ id: "priv-form-" + f.id + "-blurb", label: "Korttekst ved skjemaet", value: form.blurbHtml || "" }) +
          '</fieldset>';
        }).join("") +
        saveBtn() +
      '</form>';

    App.ui.bindRichTextFields(pane);

    // "Foreslå tekst" (2026-08-10, brukarønske): genererer eit kort,
    // redigerbart forslag til "Korttekst ved skjemaet" basert på Formål +
    // Behandlingsgrunnlag + Lagringstid -- MEDVITE kort, viser til
    // hovudpersonvernerklæringa for detaljar i staden for å gjenta heile
    // teksten her (same "eitt utgangspunkt, aldri siste ord"-filosofi som
    // Standardforslag). Landar rett i tekstboksen (App.ui.setRichTextField),
    // ikkje eit eige forslags-steg -- operatøren redigerer/lagrar sjølv.
    pane.querySelectorAll("[data-priv-form-suggest]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var fid = btn.getAttribute("data-priv-form-suggest");
        var legalBasis = pane.querySelector("#priv-form-" + fid + "-legalbasis").value;
        if (!legalBasis) { alert("Velg et behandlingsgrunnlag over først, så genereres et forslag ut fra det."); return; }
        var purpose = pane.querySelector("#priv-form-" + fid + "-purpose").value.trim();
        var retention = pane.querySelector("#priv-form-" + fid + "-retention").value.trim();
        var basisText = PRIVACY_LEGAL_BASIS_BLURB[legalBasis] || "";
        var purposeText = purpose ? " for å " + purpose.charAt(0).toLowerCase() + purpose.slice(1).replace(/\.+$/, "") : "";
        var text = "Vi behandler opplysningene du oppgir her" + purposeText + (basisText ? ", " + basisText : "") + "." +
          (retention ? " Vi lagrer opplysningene i " + retention + "." : "") +
          " Se vår fullstendige personvernerklæring for mer informasjon.";
        App.ui.setRichTextField(pane, "priv-form-" + fid + "-blurb", "<p>" + C.esc(text) + "</p>");
      });
    });

    // UX-review-funn 2026-08-06: same "flush ved fanebyte"-mønster som
    // Dokument-fana (sjå renderPersonvern()) -- skrivne-men-ikkje-lagra felt
    // her skal heller ikkje forsvinne stille om operatøren byter fane utan
    // å trykke "Lagre" fyrst.
    function captureFormsEdits() {
      var firstEl = pane.querySelector("#priv-form-" + PRIVACY_FORM_TYPES[0].id + "-purpose");
      if (!firstEl) return; // paneet er alt bytt vekk -- ingenting å fange
      PRIVACY_FORM_TYPES.forEach(function (f) {
        forms[f.id] = {
          purpose: pane.querySelector("#priv-form-" + f.id + "-purpose").value.trim(),
          legalBasis: pane.querySelector("#priv-form-" + f.id + "-legalbasis").value,
          retention: pane.querySelector("#priv-form-" + f.id + "-retention").value.trim(),
          recipients: pane.querySelector("#priv-form-" + f.id + "-recipients").value.trim(),
          blurbHtml: App.ui.readRichTextField(pane, "priv-form-" + f.id + "-blurb")
        };
      });
      sc.privacy.forms = forms;
    }
    if (wrap) wrap._privacyFlush = captureFormsEdits;

    pane.querySelector("#cs-form").addEventListener("submit", function (e) {
      e.preventDefault();
      captureFormsEdits();
      var savingTenantId = _activeTenant && _activeTenant.id;
      getSC(function (sc2) {
        // privacyPublicProjection(), ALDRI sc.privacy direkte -- sc.privacy
        // inneheld i minnet òg versions/activeVersionId (henta frå den
        // PRIVATE nøkkelen for Console sin eigen redigering), som ALDRI skal
        // hamne attende i den offentlege 'superconfig'-nøkkelen (sjå
        // migratePrivacyVersions()).
        sc2.privacy = privacyPublicProjection(sc);
        saveSC(sc2, savingTenantId);
        statusMsg(pane.querySelector("#cs-status"), "✓ Lagra!", true);
      });
    });
  }

  /* --- Samtykker-fana ------------------------------------------------------- */
  function renderPersonvernSamtykke(sc, pane, wrap) {
    var purposes = sc.privacy.consentPurposes || [];
    var rowsHtml = purposes.length ? purposes.map(function (p) {
      return '<div class="admin-group" style="margin-bottom:.8rem" data-consent-purpose="' + C.esc(p.id) + '">' +
        C.field({ id: "cp-" + p.id + "-label", label: "Formål (vist ved avkryssingsboksen)", value: p.label || "" }) +
        '<div class="field"><label>Gjeld skjema</label><div style="display:flex;gap:.9rem;flex-wrap:wrap;margin-top:.3rem">' +
          PRIVACY_FORM_TYPES.map(function (f) {
            var checked = (p.forms || []).indexOf(f.id) !== -1;
            return '<label style="font-size:.85rem;display:flex;align-items:center;gap:.35rem"><input type="checkbox" data-cp-form="' + C.esc(f.id) + '"' + (checked ? " checked" : "") + '> ' + C.esc(f.label) + '</label>';
          }).join("") +
        '</div></div>' +
        '<label style="font-size:.85rem;display:flex;align-items:center;gap:.4rem;margin:.7rem 0 .3rem"><input type="checkbox" data-cp-active' + (p.active !== false ? " checked" : "") + '> Aktiv' + C.helpIcon("Formål som ikke er aktive vises ikke på nettsiden. Merk: i denne første versjonen har ikke «Aktiv» noen effekt ennå uansett -- selve avkryssingsboksen på det virkelige skjemaet kommer i et senere steg.") + '</label>' +
        '<p style="font-size:.76rem;color:var(--color-muted);margin:0 0 .6rem">Vert alltid vist IKKJE-forhandsavhuka på nettsida — dette er ikkje redigerbart, per krava til gyldig samtykke (Datatilsynet).</p>' +
        C.button({ label: "Fjern formål", variant: "ghost", attrs: 'type="button" data-cp-remove="' + C.esc(p.id) + '"' }) +
      '</div>';
    }).join("") : '<p style="color:var(--color-muted)">Ingen valfrie samtykkeformål definert ennå.</p>';

    pane.innerHTML =
      '<fieldset class="admin-group"><legend>Samtykker</legend>' +
        '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Kun for EKTE, valfrie formål (t.d. nyhetsbrev, markedsføring) — ikkje for vanlege kontakt-/tilbods-/bookingskjema, der samtykke normalt IKKJE er rett behandlingsgrunnlag (sjå Behandlingsgrunnlag i Skjematekster-fana). Registrering av faktiske svar per innsending kjem i eit seinare steg — dette er berre SJØLVE FORMÅLA/definisjonane.</p>' +
        '<div id="cp-list">' + rowsHtml + '</div>' +
        C.button({ label: "+ Legg til formål", variant: "ghost", attrs: 'type="button" id="cp-add"' }) +
      '</fieldset>' +
      '<div style="margin-top:1rem">' + C.button({ label: "Lagre", variant: "primary", attrs: 'type="button" id="cp-save"' }) + '</div>' +
      '<p class="form__status" id="cs-status" style="margin-top:.6rem"></p>';

    // UX-review-funn 2026-08-06: same "flush ved fanebyte"-mønster som
    // Dokument-/Skjematekster-fana (sjå renderPersonvern()).
    function captureConsentEdits() {
      purposes.forEach(function (p) {
        var row = pane.querySelector('[data-consent-purpose="' + p.id + '"]');
        if (!row) return;
        p.label = row.querySelector("#cp-" + p.id + "-label").value.trim();
        p.forms = [].slice.call(row.querySelectorAll("[data-cp-form]:checked")).map(function (cb) { return cb.getAttribute("data-cp-form"); });
        p.active = row.querySelector("[data-cp-active]").checked;
      });
      sc.privacy.consentPurposes = purposes;
    }
    if (wrap) wrap._privacyFlush = captureConsentEdits;

    pane.querySelectorAll("[data-cp-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        sc.privacy.consentPurposes = purposes.filter(function (p) { return p.id !== btn.getAttribute("data-cp-remove"); });
        renderPersonvernSamtykke(sc, pane, wrap);
      });
    });
    pane.querySelector("#cp-add").addEventListener("click", function () {
      purposes.push({ id: privacyNewId("cp"), label: "", forms: [], active: true });
      sc.privacy.consentPurposes = purposes;
      renderPersonvernSamtykke(sc, pane, wrap);
    });
    pane.querySelector("#cp-save").addEventListener("click", function () {
      captureConsentEdits();
      var savingTenantId = _activeTenant && _activeTenant.id;
      getSC(function (sc2) {
        sc2.privacy = privacyPublicProjection(sc); // sjå notatet i renderPersonvernSkjema() sin tilsvarande skriving
        saveSC(sc2, savingTenantId);
        statusMsg(pane.querySelector("#cs-status"), "✓ Lagra!", true);
      });
    });
  }

  /* --- Leverandørar-fana (Fase 3, 2026-08-06) -------------------------------
     Syner Vibeverk sine EIGNE, faste leverandørfakta (VIBEVERK_VENDORS,
     read-only -- operatøren kan ikkje redigere desse, dei gjeld Vibeverk som
     selskap, ikkje denne einskilde kunden), pluss det EINASTE genuint
     redigerbare per-kunde-feltet (Supabase-regionen). Domeneshop er MEDVITE
     ikkje med her -- sjå VIBEVERK_VENDORS sin eigen kommentar. ------------ */
  function renderPersonvernLeverandorer(sc, pane, wrap) {
    var suppliers = sc.privacy.suppliers || { supabaseRegion: "" };
    // "analytics" er si EIGA store-nøkkel (ikkje eit felt på sc/superconfig),
    // same henting som Dokument-fana sin "Standardforslag"/publiser-
    // handterar brukar -- syner "Laster …" til svaret kjem attende.
    pane.innerHTML = '<p style="color:var(--color-muted)">Laster leverandørinformasjon…</p>';
    // Security Auditor-funn (Fase 3, 2026-08-06, MEDIUM): denne fana er den
    // EINASTE av Personvern sine underfaner som hentar noko asynkront FØR ho
    // registrerer wrap._privacyFlush. Utan vakta under kunne operatøren rekke
    // å byte til ei ANNA fane, skrive noko der, og så -- når dette kallet
    // endeleg svarer -- få _privacyFlush overskrive med denne fana sin eigen
    // handterar, som ville fanga OPP DEN ANDRE FANA sine ulagra endringar
    // (dei hamnar aldri i sc.privacy, forsvinn stille). Same feilklasse som
    // 2026-08-06-kommentarane elles i denne fila ved "fangar felta PÅ NYTT
    // etter det asynkrone spranget" -- her er fiksen å ALDRI gjere noko med
    // svaret om brukaren alt har navigert vekk frå denne fana i mellomtida.
    // UX-review-funn (Fase 3, MEDIUM): brukar getStoreKeyOrError(), IKKJE
    // getStoreKey() -- ein forbigåande nettverksfeil skal ALDRI stille synast
    // som "Plausible er ikkje aktiv" utan at operatøren får vite at sjekken
    // faktisk ikkje fekk stadfesta noko (same feilklasse getStoreKeyOrError()
    // vart bygd for å hindre ved publiseringssjekken, sjå notatet der).
    var myView = _privacyView;
    getStoreKeyOrError("analytics", function (an, err) {
      if (_privacyView !== myView) return;
      if (err) {
        pane.innerHTML = '<p style="color:#c0392b">Kunne ikkje stadfeste om Plausible er aktiv for denne kunden.</p>' +
          C.button({ label: "Prøv igjen", variant: "ghost", attrs: 'type="button" id="sup-retry-load"' });
        pane.querySelector("#sup-retry-load").addEventListener("click", function () { renderPersonvernLeverandorer(sc, pane, wrap); });
        return;
      }
      // "Bolk 5" (2026-08-12): vendor_registry er GLOBAL kontrollplan-data,
      // ikkje tenant-skopa -- henta éin gong per Console-økt (ikkje per
      // kundebyte, sidan innhaldet er identisk uansett kva kunde er vald) og
      // cacha på sc._vendorRegistry, same "hent lat, fell trygt attende viss
      // ikkje alt i minnet"-mønster som sc._privacyAn. Feil ved henting fell
      // stille attende til VIBEVERK_VENDORS-fallbacken i staden for å blokkere
      // heile fana -- konsistent med at fallbacken uansett har identisk
      // innhald til nokon faktisk redigerer i Compliance-fana.
      if (sc._vendorRegistry) {
        renderPersonvernLeverandorerLoaded(sc, pane, wrap, suppliers, an || {});
        return;
      }
      _sbControl.from("vendor_registry").select("*").order("sort_order").then(function (r) {
        if (_privacyView !== myView) return;
        if (r.error || !r.data || !r.data.length) {
          if (r.error) console.error("[console] kunne ikkje hente vendor_registry, fell attende til VIBEVERK_VENDORS:", r.error);
        } else {
          sc._vendorRegistry = r.data.map(normalizeVendorRow);
        }
        renderPersonvernLeverandorerLoaded(sc, pane, wrap, suppliers, an || {});
      });
    });
  }
  function renderPersonvernLeverandorerLoaded(sc, pane, wrap, suppliers, an) {
    var hasAnalytics = !!(an.plausible || an.plausibleEmbed);
    var vendorRowsHtml = (sc._vendorRegistry || VIBEVERK_VENDORS).map(function (v) {
      if (!vendorIsActive(v, an)) return "";
      // "tba" fell trygt inn i same nøytrale, grå fallback-klasse som
      // "unconfirmed" tidlegare gjorde -- ikkje raud/åtvarande styling for
      // noko som berre ventar på eit kjent, planlagt steg (selskapsregistrering).
      var dpaPillClass = v.dpaStatus === "confirmed" ? "kd-pill--active" : v.dpaStatus === "likely_confirmed" ? "kd-pill--provisioning" : "kd-pill--archived";
      return '<div class="admin-group" style="margin-bottom:.6rem">' +
        '<div style="font-weight:600">' + C.esc(v.name) + ' <span class="kd-pill ' + dpaPillClass + '">DPA: ' + C.esc(VENDOR_DPA_LABEL[v.dpaStatus]) + '</span></div>' +
        '<div style="font-size:.84rem;color:var(--color-muted);margin-top:.2rem">' + C.esc(v.whatItDoes) + ' — ' + C.esc(VENDOR_COUNTRY_LABEL[v.country]) + ' — ' + C.esc(VENDOR_TRANSFER_LABEL[v.transferMechanism]) + '</div>' +
        '<div style="font-size:.78rem;color:var(--color-muted);margin-top:.2rem">' + C.esc(v.dpaNote) + '</div>' +
      '</div>';
    }).join("");

    pane.innerHTML =
      '<fieldset class="admin-group"><legend>Leverandørar</legend>' +
        '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Desse fakta gjeld Vibeverk som selskap, ikkje denne einskilde kunden — sjå <code>docs/compliance/data-map-vibeverk.md</code>. Kan ikkje redigerast her.</p>' +
        vendorRowsHtml +
        '<p style="font-size:.78rem;color:var(--color-muted);margin-top:.4rem">Plausible ' + (hasAnalytics ? "er" : "er IKKJE") + ' aktiv for denne kunden akkurat no (styrt av Analyse-fana), og ' + (hasAnalytics ? "vert difor" : "vert difor ikkje") + ' teken med i forslaget under.</p>' +
      '</fieldset>' +
      '<fieldset class="admin-group"><legend>Denne kunden</legend>' +
        C.field({ id: "sup-supabase-region", label: "Supabase-region for denne kunden", value: suppliers.supabaseRegion,
          placeholder: "f.eks. Irland",
          // UX-review-funn (Fase 3, HIGH): verdien limest inn RÅTT i offentleg,
          // kundevendt personvernerklæringstekst ("Data er plassert i X.") --
          // utan denne presiseringa ville ulike operatørar skrive inn ulike,
          // stundom tekniske Supabase-regionkodar (t.d. "eu-west-1") rett inn
          // i vanleg-språk juridisk tekst. Kort hint (alltid synleg, sjølve
          // regelen); Dashboard-navigasjonsdetaljen høyrer heller heime i
          // help() (copy-style-guide.md sitt hint-vs-help-skilje).
          hint: "Skriv eit vanleg stadnamn som gir meining i ei setning til kunden, f.eks. «Irland» — ikkje den tekniske regionkoden. Stå tom viser ei generell «i EU»-formulering i staden.",
          help: "Finn regionen i Supabase Dashboard → Project Settings → Infrastructure. Fylles inn éin gong ved onboarding." }) +
      '</fieldset>' +
      '<div style="margin-top:1rem">' + C.button({ label: "Lagre", variant: "primary", attrs: 'type="button" id="sup-save"' }) + '</div>' +
      '<p class="form__status" id="sup-status" style="margin-top:.6rem"></p>';

    function captureSupplierEdits() {
      suppliers.supabaseRegion = pane.querySelector("#sup-supabase-region").value.trim();
      sc.privacy.suppliers = suppliers;
    }
    if (wrap) wrap._privacyFlush = captureSupplierEdits;

    pane.querySelector("#sup-save").addEventListener("click", function () {
      captureSupplierEdits();
      var savingTenantId = _activeTenant && _activeTenant.id;
      getSC(function (sc2) {
        sc2.privacy = privacyPublicProjection(sc); // same skriveregel som Skjematekster/Samtykker -- ALDRI sc.privacy direkte
        saveSC(sc2, savingTenantId);
        statusMsg(pane.querySelector("#sup-status"), "✓ Lagra!", true);
      });
    });
  }

  /* --- Historikk-fana ------------------------------------------------------- */
  function renderPersonvernHistorikk(sc, pane, wrap) {
    var priv = sc.privacy;
    var versions = (priv.versions || []).slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    var rowsHtml = versions.map(function (v) {
      var statusPillClass = v.status === "published" ? "kd-pill--active" : v.status === "draft" ? "kd-pill--provisioning" : "kd-pill--archived";
      var statusLabel = v.status === "published" ? "Publisert" : v.status === "draft" ? "Utkast" : "Arkivert";
      var dateStr = new Date((v.status === "published" && v.publishedAt) || v.createdAt).toLocaleString("nb-NO");
      var isActive = v.id === priv.activeVersionId;
      var approvalStr = (v.approval && v.approval.approvedAt)
        ? "Godkjent av " + (v.approval.approvedBy || "(ikkje oppgitt)") + " (" + (APPROVAL_CHANNEL_LABEL[v.approval.channel] || "ikkje oppgitt") + "), " + new Date(v.approval.approvedAt).toLocaleDateString("nb-NO")
        : "";
      return '<div class="admin-group" style="margin-bottom:.7rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.6rem">' +
        '<div>' +
          '<div style="font-weight:600">' + C.esc(v.heading || "(uten overskrift)") + (isActive ? ' <span class="kd-pill kd-pill--active">Gjeldande</span>' : '') + '</div>' +
          '<div style="font-size:.78rem;color:var(--color-muted)"><span class="kd-pill ' + statusPillClass + '">' + statusLabel + '</span> — ' + C.esc(dateStr) + '</div>' +
          (approvalStr ? '<div style="font-size:.76rem;color:var(--color-muted);margin-top:.2rem">✓ ' + C.esc(approvalStr) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:.5rem">' +
          C.button({ label: "Vis", variant: "ghost", attrs: 'type="button" data-hist-view="' + C.esc(v.id) + '"' }) +
          (isActive ? "" : C.button({ label: "Bruk som utgangspunkt for nytt utkast", variant: "ghost", attrs: 'type="button" data-hist-restore="' + C.esc(v.id) + '"' })) +
        '</div>' +
      '</div>';
    }).join("");

    pane.innerHTML =
      '<fieldset class="admin-group"><legend>Historikk</legend>' + (rowsHtml || '<p style="color:var(--color-muted)">Ingen versjonar ennå.</p>') + '</fieldset>' +
      '<div id="hist-preview"></div>';

    pane.querySelectorAll("[data-hist-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = versions.filter(function (x) { return x.id === btn.getAttribute("data-hist-view"); })[0];
        pane.querySelector("#hist-preview").innerHTML =
          '<fieldset class="admin-group"><legend>' + C.esc(v.heading || "(uten overskrift)") + '</legend>' +
            '<div style="border:1px solid var(--color-border);border-radius:8px;padding:.8rem">' + (privacyBlocksToFlatHtml(v.bodyBlocks) || '<p style="color:var(--color-muted)">(Tomt innhald)</p>') + '</div>' +
          '</fieldset>';
      });
    });
    pane.querySelectorAll("[data-hist-restore]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        // UX-review-funn 2026-08-06 (MEDIUM): ingen confirm() her -- dette er
        // ei Tier A-handling (fullt reversibel, rører ikkje gjeldande
        // publiserte versjon, ingen synleg endring for besøkjande før nokon
        // seinare eksplisitt publiserer). Sjølve utkastet som dukkar opp på
        // Dokument-fana ER tilbakemeldinga, per copy-style-guide.md.
        var v = versions.filter(function (x) { return x.id === btn.getAttribute("data-hist-restore"); })[0];
        var draft = privacyCloneVersionAsDraft(v);
        priv.versions.push(draft);
        priv.activeVersionId = draft.id;
        // Rører BERRE versions/activeVersionId -- savePrivacyVersions(), ikkje
        // saveSC()/den offentlege nøkkelen. sc.privacy er alt fullstendig i
        // minnet, ingen grunn til å hente på nytt -- renderPersonvernShell(),
        // ikkje renderPersonvern() (som ville trigga eit unødvendig nytt
        // get_private_config-kall).
        savePrivacyVersions(sc, _activeTenant && _activeTenant.id, function (r) {
          if (r && r.error) console.error("[console] personvern-versjonering feila:", r.error);
        });
        _privacyView = "dokument";
        renderPersonvernShell(sc, wrap);
      });
    });
  }

  /* --- Fane-dispatch --------------------------------------------------------
     Splitta i to funksjonar 2026-08-06 (herding, sjå notatet ved
     migratePrivacyVersions()): renderPersonvern() er det YTRE inngangspunktet
     RENDERERS/renderSection() kallar ved kvar navigering TIL Personvern-fana
     -- alltid med eit HEILT FERSKT sc-objekt (ny getSC()-lesing), som IKKJE
     har versions/activeVersionId enno (dei bur no i superconfig-private,
     henta her via eit eige get_private_config-kall). renderPersonvernShell()
     er den INDRE synkrone fanedispatchen (same mønster som renderPriser() sin
     _priserView-dispatch) -- kalla éin gong av renderPersonvern() sjølv etter
     lastinga, OG direkte av kvart internt fanebyte-klikk UTAN å hente den
     private delen på nytt (sc er alt fullstendig på det tidspunktet). Alle
     underfanene deler den SAME sc-referansen, så ingen internt fanebyte
     misser ulagra endringar (sjå wrap._privacyFlush-mekanismen under). ====== */
  function renderPersonvern(sc, wrap) {
    // Security Auditor-funn 2026-08-06: 0.100.0 (før denne herdinga) kunne
    // faktisk ha lagra versions/activeVersionId i den offentlege nøkkelen om
    // ein operatør rakk å bruke Personvern-fana då. Sjølve migratePrivacyPublicPart()
    // fjernar dei frå MINNET, men om vi ikkje gjer noko meir, ligg dei att i
    // Supabase til NOKON tilfeldigvis trykker Lagre i Skjematekster/Samtykker/
    // Publiser (som skriv via privacyPublicProjection()) -- ikkje eit reelt
    // sjølv-lækande steg for ein kunde ingen rører ved på ei stund. Fangar
    // difor stale felt HER, proaktivt, kvar gong nokon i det heile opnar
    // Personvern-fana, og flyttar/reinsar med ein gong.
    var rawPublicPriv = sc.privacy || {};
    var stalePublicVersions = (rawPublicPriv.versions || rawPublicPriv.activeVersionId)
      ? { activeVersionId: rawPublicPriv.activeVersionId, versions: rawPublicPriv.versions }
      : null;
    sc.privacy = migratePrivacyPublicPart(rawPublicPriv);
    wrap.innerHTML = '<p style="color:var(--color-muted)">Laster personvern…</p>';

    // "Bolk 5" (2026-08-12, Security Auditor-funn CONFIRMED under gjennomgang
    // av vendor_registry-byttet): vendor_registry vert no henta HER, proaktivt,
    // FØR nokon underfane vert vist -- IKKJE berre lat inni Leverandørar-fana
    // slik fyrste utkastet av byttet gjorde. Utan dette kunne ein operatør opne
    // Personvern (standardfana er Dokument) og trykke "Standardforslag" der
    // FØR nokon nokon gong hadde besøkt Leverandørar-fana i same økt --
    // computeSupplierBlock() ville då stille brukt den hardkoda
    // VIBEVERK_VENDORS-fallbacken i staden for det faktiske, operatør-
    // redigerte registeret, og undergrave heile poenget med byttet. Berre
    // henta om ikkje alt cacha (éin gong per Console-økt, sidan innhaldet er
    // globalt/kontrollplan-data, ikkje tenant-skopa -- byte av kunde i
    // veljaren skal ikkje trigge ei ny henting).
    //
    // get_private_config sin feilhandtering er MEDVITE ikkje kopla til denne
    // sameiningsvakta -- ein reell backend-feil skal visast med det same,
    // ikkje vente på at vendor_registry-hentinga (uavhengig, kan aldri feile
    // på ein måte brukaren treng varslast om) òg er ferdig.
    var vendorRegistryReady = !!sc._vendorRegistry;
    var privateConfigReady = false;
    var privateConfigResult = null;
    function afterBothLoaded() {
      if (!privateConfigReady || !vendorRegistryReady) return;
      var versionsPart = migratePrivacyVersions((privateConfigResult.value || {}).privacy, sc.privacy, stalePublicVersions);
      sc.privacy.activeVersionId = versionsPart.activeVersionId;
      sc.privacy.versions = versionsPart.versions;
      if (stalePublicVersions) {
        // Berga (om reell) inn i superconfig-private FYRST, deretter reinsa
        // den offentlege nøkkelen for dei feilaktig eksponerte felta -- i DEN
        // rekkjefølgja, same forsiktige mønster som Publiser-handteraren.
        var cleanupTenantId = _activeTenant && _activeTenant.id;
        savePrivacyVersions(sc, cleanupTenantId, function (r1) {
          if (r1 && r1.error) { console.error("[console] kunne ikkje flytte historikk til privat nøkkel under oppreinsking:", r1.error); return; }
          getSC(function (sc2) {
            sc2.privacy = privacyPublicProjection(sc);
            saveSC(sc2, cleanupTenantId);
            console.warn("[console] fjerna versjonshistorikk som feilaktig låg i den offentlege superconfig-nøkkelen for denne kunden (herding 2026-08-06, sjå CHANGELOG 0.100.1) -- trygt flytta til superconfig-private fyrst.");
          });
        });
      }
      renderPersonvernShell(sc, wrap);
    }
    brokerCall("get_private_config", {}, function (r) {
      if (r.error) {
        wrap.innerHTML = '<p style="color:#c0392b">Kunne ikkje laste versjonshistorikk (' + C.esc(r.error) + ').</p>' +
          C.button({ label: "Prøv igjen", variant: "ghost", attrs: 'type="button" id="cs-priv-retry-load"' });
        var retryBtn = wrap.querySelector("#cs-priv-retry-load");
        if (retryBtn) retryBtn.addEventListener("click", function () { renderPersonvern(sc, wrap); });
        return;
      }
      privateConfigResult = r;
      privateConfigReady = true;
      afterBothLoaded();
    });
    if (!vendorRegistryReady) {
      _sbControl.from("vendor_registry").select("*").order("sort_order").then(function (r) {
        if (!r.error && r.data && r.data.length) sc._vendorRegistry = r.data.map(normalizeVendorRow);
        else if (r.error) console.error("[console] kunne ikkje hente vendor_registry, fell attende til VIBEVERK_VENDORS:", r.error);
        vendorRegistryReady = true;
        afterBothLoaded();
      });
    }
  }

  function renderPersonvernShell(sc, wrap) {
    // UX-review-funn 2026-08-06 (STENGJANDE): kvar underfane sine skrivne-men-
    // ikkje-lagra endringar (rik-tekst/vanlege felt) syncar berre til DOM-en
    // sitt skjulte input, IKKJE inn i sc.privacy -- den faktiske overgangen til
    // ei anna fane (eller attende til same, sjå under) knuser DOM-en før noko
    // fangar opp verdiane. Kvar underrenderar registrerer difor sin eigen
    // wrap._privacyFlush-funksjon (kallar captureFieldEdits()-ekvivalenten sin
    // eigen, utan å lagre til Supabase) -- kalla HER, FØR wrap.innerHTML vert
    // bytt ut, uansett kva veg brukaren navigerer vidare.
    if (wrap._privacyFlush) { wrap._privacyFlush(); wrap._privacyFlush = null; }
    var views = [["dokument", "Dokument"], ["skjema", "Skjematekster"], ["samtykke", "Samtykker"], ["leverandorer", "Leverandører"], ["historikk", "Historikk"]];
    wrap.innerHTML =
      '<div class="seg" id="privacy-view-toggle" style="margin-bottom:1.4rem">' +
        views.map(function (v) {
          return '<button type="button" class="' + (v[0] === _privacyView ? "is-active" : "") + '" data-privacy-view="' + v[0] + '">' + C.esc(v[1]) + '</button>';
        }).join("") +
      '</div>' +
      '<div id="privacy-pane"></div>';

    wrap.querySelectorAll("[data-privacy-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        _privacyView = btn.getAttribute("data-privacy-view");
        renderPersonvernShell(sc, wrap); // IKKJE renderPersonvern() att -- ikkje hent den private delen på nytt, sc er alt fullstendig
      });
    });

    var pane = wrap.querySelector("#privacy-pane");
    if (_privacyView === "skjema") renderPersonvernSkjema(sc, pane, wrap);
    else if (_privacyView === "samtykke") renderPersonvernSamtykke(sc, pane, wrap);
    else if (_privacyView === "leverandorer") renderPersonvernLeverandorer(sc, pane, wrap);
    else if (_privacyView === "historikk") renderPersonvernHistorikk(sc, pane, wrap);
    else renderPersonvernDokument(sc, pane, wrap); // "dokument" og enhver ukjend/framtidig verdi -- eksplisitt fallback
  }

  /* =========================================================================
     LÆRING — viser docs/onboarding/*.md (+ tilgrensande dokument) direkte i
     Console, i staden for at nokon må opne rå Markdown-filer i repoet.
     Ikkje tenant-spesifikt -- same innhald uansett kva kunde er vald i
     kundeveljaren, sidan dette er interne Vibeverk-dokument, ikkje
     kundekonfigurasjon. Hentar rå .md-filer via fetch() (same opphav, sjølve
     kjeldedokumenta er alt del av det statiske repoet som blir servert) og
     konverterer til HTML med `marked` (lasta via CDN, sjå console/index.html).
     ====================================================================== */
  var LARING_DOCS = [
    { id: "onboarding", label: "Læringsdokument",  path: "../docs/onboarding/new-team-member-onboarding.md" },
    { id: "safe",       label: "Trygge endringar", path: "../docs/onboarding/safe-changes-guide.md" },
    { id: "incident",   label: "Hendingsguide",    path: "../docs/security/incident-and-escalation-guide.md" },
    { id: "delivery",   label: "Kundeleveranse",   path: "../docs/architecture/customer-delivery-checklist.md" }
  ];
  var _laringActive = LARING_DOCS[0].id;

  function renderLaring(sc, wrap) {
    wrap.innerHTML =
      '<div class="cs-md-tabs">' +
        LARING_DOCS.map(function (d) {
          return '<button type="button" class="cs-md-tab' + (d.id === _laringActive ? " is-active" : "") + '" data-laring-doc="' + d.id + '">' + C.esc(d.label) + '</button>';
        }).join("") +
      '</div>' +
      '<div class="cs-md-body" id="cs-md-body"><p style="color:var(--color-muted)">Lastar…</p></div>';

    wrap.querySelectorAll("[data-laring-doc]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        _laringActive = btn.getAttribute("data-laring-doc");
        renderLaring(sc, wrap);
      });
    });

    loadLaringDoc(_laringActive);
  }

  function loadLaringDoc(id) {
    var doc = LARING_DOCS.filter(function (d) { return d.id === id; })[0];
    var body = document.getElementById("cs-md-body");
    if (!doc || !body) return;
    fetch(doc.path).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function (md) {
      if (!document.getElementById("cs-md-body")) return; // brukar navigerte vekk medan henting pågjekk
      if (window.marked) {
        document.getElementById("cs-md-body").innerHTML = window.marked.parse(md);
      } else {
        // marked lasta ikkje (t.d. CDN utilgjengeleg) -- vis rå tekst i staden
        // for ei tom side.
        var pre = document.createElement("pre");
        pre.style.whiteSpace = "pre-wrap";
        pre.textContent = md;
        document.getElementById("cs-md-body").innerHTML = "";
        document.getElementById("cs-md-body").appendChild(pre);
      }
    }).catch(function (e) {
      if (!document.getElementById("cs-md-body")) return;
      document.getElementById("cs-md-body").innerHTML =
        '<p style="color:#c0392b">Kunne ikkje laste dokumentet (' + C.esc(e.message) + '). Sjå ' + C.esc(doc.path) + ' direkte i repoet.</p>';
    });
  }

  /* =========================================================================
     AI LAB — lokal utvikling og kvalitetssikring
     -------------------------------------------------------------------------
     Eige konsept frå Læring over. AI Lab produserer berre utkast og kan
     aldri skrive til læringsdokument, Supabase, App.store eller localStorage.
     Serveren held kjeldesnapshotet i minnet; klienten sender berre kjelde-ID-ar.
     ====================================================================== */
  var _aiLabSnapshot = null;
  var _aiLabSnapshotKey = "";
  var _aiLabInstruction = "Lag et kort, presist opplæringsutkast for Vibeverk-ansatte. Prioriter praktisk forståelse og skill tydelig mellom dokumenterte fakta og det kildene ikke dekker.";
  var _aiLabSelectedSources = ["safe-changes"];
  var _aiLabResults = { ollama: null, anthropic: null, review: null };
  var _aiLabPreference = "";
  var _aiLabComment = "";
  var _aiLabAccessToken = "";
  var _aiLabBusy = false;

  function aiLabProviderConfig(id) {
    var providers = (_aiLabConfig && _aiLabConfig.providers) || [];
    return providers.filter(function (provider) { return provider.id === id; })[0] || null;
  }

  function aiLabInputKey() {
    return JSON.stringify({
      scenarioId: "learning-module",
      sourceIds: _aiLabSelectedSources.slice().sort(),
      instruction: _aiLabInstruction.trim()
    });
  }

  function invalidateAiLabSnapshot() {
    _aiLabSnapshot = null;
    _aiLabSnapshotKey = "";
    _aiLabResults = { ollama: null, anthropic: null, review: null };
    _aiLabPreference = "";
    renderAiLabResults();
  }

  function refreshAiLabSourceLimit() {
    var boxes = Array.from(document.querySelectorAll("[data-ai-lab-source]"));
    var selected = boxes.filter(function (box) { return box.checked; }).length;
    var count = document.getElementById("cs-ai-lab-source-count");
    if (count) count.textContent = selected + " av 6 valgt";
    if (_aiLabBusy) return;
    boxes.forEach(function (box) { box.disabled = selected >= 6 && !box.checked; });
  }

  function aiLabApi(path, body) {
    var options = { method: body ? "POST" : "GET", cache: "no-store", credentials: "omit", headers: {} };
    if (body) {
      options.headers["Content-Type"] = "application/json";
      options.headers["X-AI-Lab-Token"] = _aiLabConfig.csrfToken;
      options.headers.Authorization = "Bearer " + _aiLabAccessToken;
      options.body = JSON.stringify(body);
    }
    return fetch("/__ai-lab/v1/" + path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) {
          var message = payload && payload.error && payload.error.message;
          var error = new Error(message || "AI Lab-feil (HTTP " + response.status + ")");
          error.statusCode = response.status;
          error.code = payload && payload.error && payload.error.code;
          throw error;
        }
        return payload;
      });
    });
  }

  function ensureAiLabSnapshot() {
    var key = aiLabInputKey();
    var expiresAt = _aiLabSnapshot && Date.parse(_aiLabSnapshot.expiresAt);
    if (_aiLabSnapshot && _aiLabSnapshotKey === key && Number.isFinite(expiresAt) && expiresAt > Date.now() + 1000) {
      return Promise.resolve(_aiLabSnapshot);
    }
    if (_aiLabSnapshot) invalidateAiLabSnapshot();
    return aiLabApi("snapshots", {
      scenarioId: "learning-module",
      sourceIds: _aiLabSelectedSources.slice(),
      instruction: _aiLabInstruction.trim()
    }).then(function (snapshot) {
      _aiLabSnapshot = snapshot;
      _aiLabSnapshotKey = key;
      return snapshot;
    });
  }

  function handleAiLabRunError(error) {
    if (error && (error.statusCode === 410 || error.code === "AI_LAB_SNAPSHOT_EXPIRED")) {
      invalidateAiLabSnapshot();
      setAiLabBusy(false, "Kildesnapshotet gikk ut. Tidligere svar er fjernet; kjør sammenligningen på nytt.");
      return;
    }
    setAiLabBusy(false, error.message);
  }

  function setAiLabBusy(busy, message) {
    _aiLabBusy = busy;
    var status = document.getElementById("cs-ai-lab-status");
    if (status) {
      status.textContent = message || "";
      status.style.color = busy ? "var(--color-muted)" : "#c0392b";
    }
    document.querySelectorAll("[data-ai-lab-run]").forEach(function (button) {
      button.disabled = busy || button.getAttribute("data-provider-ready") === "false";
    });
    document.querySelectorAll("[data-ai-lab-source], #cs-ai-lab-instruction, #cs-ai-lab-access-token, #cs-ai-lab-scenario").forEach(function (field) {
      field.disabled = busy;
    });
    if (!busy) refreshAiLabSourceLimit();
  }

  function runAiLabProvider(providerId) {
    if (_aiLabBusy || !_aiLabConfig) return;
    if (!_aiLabAccessToken.trim()) { setAiLabBusy(false, "Lim inn lokal tilgangstoken først."); return; }
    if (!_aiLabSelectedSources.length) { setAiLabBusy(false, "Vel minst én kilde."); return; }
    if (!_aiLabInstruction.trim()) { setAiLabBusy(false, "Instruksjonen kan ikke være tom."); return; }
    var requestKey = aiLabInputKey();
    setAiLabBusy(true, "Klargjør identisk kildesnapshot og kjører " + (providerId === "ollama" ? "Gemma" : "Haiku") + " …");
    ensureAiLabSnapshot().then(function (snapshot) {
      return aiLabApi("run", { snapshotId: snapshot.id, provider: providerId });
    }).then(function (result) {
      if (requestKey !== aiLabInputKey()) throw new Error("Input ble endret under kjøringen; svaret er forkastet.");
      _aiLabResults[providerId] = result;
      setAiLabBusy(false, "");
      renderAiLabResults();
    }).catch(function (error) {
      handleAiLabRunError(error);
    });
  }

  function runAiLabReview() {
    if (_aiLabBusy || !_aiLabConfig) return;
    if (!_aiLabAccessToken.trim()) { setAiLabBusy(false, "Lim inn lokal tilgangstoken først."); return; }
    if (!_aiLabSelectedSources.length) { setAiLabBusy(false, "Vel minst én kilde."); return; }
    if (!_aiLabInstruction.trim()) { setAiLabBusy(false, "Instruksjonen kan ikke være tom."); return; }
    var requestKey = aiLabInputKey();
    setAiLabBusy(true, "Gemma lager utkast, deretter reviewer Haiku mot samme snapshot …");
    ensureAiLabSnapshot().then(function (snapshot) {
      return aiLabApi("gemma-review", { snapshotId: snapshot.id });
    }).then(function (result) {
      if (requestKey !== aiLabInputKey()) throw new Error("Input ble endret under kjøringen; svaret er forkastet.");
      _aiLabResults.review = result;
      _aiLabResults.ollama = {
        schemaVersion: "ai-lab-result-v1",
        snapshot: result.snapshot,
        provider: result.draftProvider,
        draft: result.draft
      };
      setAiLabBusy(false, "");
      renderAiLabResults();
    }).catch(function (error) {
      handleAiLabRunError(error);
    });
  }

  function aiLabRefsText(refs) {
    return (refs || []).map(function (ref) {
      return ref.sourceId + " L" + ref.startLine + "–" + ref.endLine;
    }).join(", ");
  }

  function appendAiLabText(parent, tagName, className, value) {
    var element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = value;
    parent.appendChild(element);
    return element;
  }

  function appendAiLabDocumented(parent, heading, section) {
    appendAiLabText(parent, "h3", "ai-lab-result__heading", heading);
    appendAiLabText(parent, "p", "ai-lab-result__text", section.text);
    appendAiLabText(parent, "p", "ai-lab-result__refs", "Kilder: " + aiLabRefsText(section.sourceRefs));
  }

  function appendAiLabQuestions(parent, heading, questions, answerField) {
    appendAiLabText(parent, "h3", "ai-lab-result__heading", heading);
    var list = document.createElement("ol");
    list.className = "ai-lab-result__questions";
    questions.forEach(function (question) {
      var item = document.createElement("li");
      appendAiLabText(item, "strong", "", question.question);
      appendAiLabText(item, "p", "", question[answerField]);
      appendAiLabText(item, "p", "ai-lab-result__refs", "Kilder: " + aiLabRefsText(question.sourceRefs));
      list.appendChild(item);
    });
    parent.appendChild(list);
  }

  function renderAiLabDraft(container, result, emptyText) {
    if (!container) return;
    container.innerHTML = "";
    if (!result) { appendAiLabText(container, "p", "ai-lab-empty", emptyText); return; }
    var draft = result.draft;
    appendAiLabText(container, "p", "ai-lab-result__meta", result.provider.id + " · " + result.provider.model + " · " + result.provider.durationMs + " ms");
    appendAiLabText(container, "p", "ai-lab-draft-badge", draft.draftStatus + " · " + draft.suggestedLevel);
    appendAiLabText(container, "h2", "ai-lab-result__title", draft.title);
    appendAiLabDocumented(container, "Kort modulbeskrivelse", draft.moduleDescription);
    appendAiLabDocumented(container, "Slik fungerer det", draft.howItWorks);
    appendAiLabDocumented(container, "Onboarding-tekst", draft.onboardingText);
    appendAiLabQuestions(container, "Quizspørsmål", draft.quizQuestions, "answer");
    appendAiLabQuestions(container, "Kontrollspørsmål", draft.controlQuestions, "expectedAnswer");
    if (draft.notDocumented.length) {
      appendAiLabText(container, "h3", "ai-lab-result__heading", "IKKE DOKUMENTERT");
      var missing = document.createElement("ul");
      missing.className = "ai-lab-not-documented";
      draft.notDocumented.forEach(function (item) {
        var row = document.createElement("li");
        appendAiLabText(row, "strong", "", item.status + ": " + item.claim);
        appendAiLabText(row, "p", "", item.reason);
        missing.appendChild(row);
      });
      container.appendChild(missing);
    }
    var details = document.createElement("details");
    details.className = "ai-lab-raw";
    appendAiLabText(details, "summary", "", "Rå JSON");
    appendAiLabText(details, "pre", "", JSON.stringify(result, null, 2));
    container.appendChild(details);
  }

  function appendAiLabVerdictBadge(parent, verdict) {
    appendAiLabText(parent, "p", "ai-lab-review-decision ai-lab-review-decision--" + verdict.toLowerCase().replace(/\s+/g, "-"), verdict);
  }

  function appendAiLabVerdictFindings(parent, findings) {
    if (!findings.length) return;
    var list = document.createElement("ul");
    list.className = "ai-lab-review-findings";
    findings.forEach(function (finding) {
      var item = document.createElement("li");
      appendAiLabText(item, "strong", "", finding.status);
      appendAiLabText(item, "p", "", finding.message);
      if (finding.sourceRefs.length) appendAiLabText(item, "p", "ai-lab-result__refs", "Kilder: " + aiLabRefsText(finding.sourceRefs));
      list.appendChild(item);
    });
    parent.appendChild(list);
  }

  function appendAiLabSectionVerdict(parent, heading, sectionVerdict) {
    var wrap = document.createElement("div");
    wrap.className = "ai-lab-review-section";
    appendAiLabText(wrap, "h3", "ai-lab-result__heading", heading);
    appendAiLabVerdictBadge(wrap, sectionVerdict.verdict);
    appendAiLabVerdictFindings(wrap, sectionVerdict.findings);
    parent.appendChild(wrap);
  }

  function appendAiLabIndexedVerdicts(parent, heading, verdicts, questions) {
    var wrap = document.createElement("div");
    wrap.className = "ai-lab-review-section";
    appendAiLabText(wrap, "h3", "ai-lab-result__heading", heading);
    var list = document.createElement("ol");
    list.className = "ai-lab-result__questions";
    verdicts.forEach(function (verdict) {
      var item = document.createElement("li");
      var question = questions[verdict.index];
      appendAiLabText(item, "strong", "", question ? question.question : "Spørsmål " + (verdict.index + 1));
      appendAiLabVerdictBadge(item, verdict.verdict);
      appendAiLabVerdictFindings(item, verdict.findings);
      list.appendChild(item);
    });
    wrap.appendChild(list);
    parent.appendChild(wrap);
  }

  function renderAiLabReview(container, result) {
    if (!container) return;
    container.innerHTML = "";
    if (!result) { appendAiLabText(container, "p", "ai-lab-empty", "Kjør «Gemma + review» for en separat kvalitetsvurdering."); return; }
    appendAiLabText(container, "p", "ai-lab-result__meta", result.reviewProvider.id + " · " + result.reviewProvider.model + " · " + result.reviewProvider.durationMs + " ms");
    appendAiLabVerdictBadge(container, result.review.decision);
    appendAiLabText(container, "p", "ai-lab-result__text", result.review.rationale);
    var sectionVerdicts = result.review.sectionVerdicts;
    appendAiLabSectionVerdict(container, "Kort modulbeskrivelse", sectionVerdicts.moduleDescription);
    appendAiLabSectionVerdict(container, "Slik fungerer det", sectionVerdicts.howItWorks);
    appendAiLabSectionVerdict(container, "Onboarding-tekst", sectionVerdicts.onboardingText);
    appendAiLabIndexedVerdicts(container, "Quizspørsmål", result.review.quizQuestionVerdicts, result.draft.quizQuestions);
    appendAiLabIndexedVerdicts(container, "Kontrollspørsmål", result.review.controlQuestionVerdicts, result.draft.controlQuestions);
    appendAiLabSectionVerdict(container, "IKKE DOKUMENTERT", sectionVerdicts.notDocumented);
    var details = document.createElement("details");
    details.className = "ai-lab-raw";
    appendAiLabText(details, "summary", "", "Rå JSON");
    appendAiLabText(details, "pre", "", JSON.stringify(result.review, null, 2));
    container.appendChild(details);
  }

  function renderAiLabResults() {
    renderAiLabDraft(document.getElementById("cs-ai-lab-gemma-result"), _aiLabResults.ollama, "Gemma-resultatet vises her.");
    renderAiLabDraft(document.getElementById("cs-ai-lab-haiku-result"), _aiLabResults.anthropic, "Haiku-resultatet vises her.");
    renderAiLabReview(document.getElementById("cs-ai-lab-review-result"), _aiLabResults.review);
    var exportButton = document.getElementById("cs-ai-lab-export");
    if (exportButton) exportButton.disabled = !_aiLabResults.ollama && !_aiLabResults.anthropic && !_aiLabResults.review;
    var preference = document.getElementById("cs-ai-lab-preference");
    if (preference) {
      var ollamaOption = preference.querySelector('option[value="ollama"]');
      var anthropicOption = preference.querySelector('option[value="anthropic"]');
      if (ollamaOption) ollamaOption.disabled = !_aiLabResults.ollama;
      if (anthropicOption) anthropicOption.disabled = !_aiLabResults.anthropic;
    }
  }

  function exportAiLabJson() {
    if (!_aiLabResults.ollama && !_aiLabResults.anthropic && !_aiLabResults.review) return;
    var payload = {
      schemaVersion: "ai-lab-export-v1",
      exportedAt: new Date().toISOString(),
      status: "UTKAST_TIL_MENNESKELEG_GODKJENNING",
      scenario: "learning-module",
      instruction: _aiLabInstruction,
      selectedSourceIds: _aiLabSelectedSources.slice(),
      snapshot: _aiLabSnapshot ? {
        snapshotHash: _aiLabSnapshot.snapshotHash,
        promptVersion: _aiLabSnapshot.promptVersion,
        schemaVersion: _aiLabSnapshot.schemaVersion,
        sources: _aiLabSnapshot.sources
      } : null,
      preference: _aiLabPreference || null,
      comment: _aiLabComment || "",
      results: _aiLabResults
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "vibeverk-ai-lab-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function renderAiLab(sc, wrap) {
    if (!isAiLabLocalEnvironment() || !_aiLabConfig) {
      wrap.innerHTML = '<p class="i-notice i-notice--warn">AI Lab er bare tilgjengelig fra den lokale utviklingsserveren.</p>';
      return;
    }
    var anthropic = aiLabProviderConfig("anthropic");
    var ollama = aiLabProviderConfig("ollama");
    var sourceHtml = _aiLabConfig.sources.map(function (source) {
      var checked = _aiLabSelectedSources.indexOf(source.id) !== -1 ? " checked" : "";
      return '<label class="ai-lab-source">' +
        '<input type="checkbox" value="' + C.esc(source.id) + '" data-ai-lab-source' + checked + '>' +
        '<span><strong>' + C.esc(source.label) + '</strong><small>' + C.esc(source.path) +
          (source.anthropicAllowed ? ' · kan sendes til Haiku' : ' · bare lokal') + '</small></span>' +
      '</label>';
    }).join("");
    wrap.innerHTML =
      '<div class="ai-lab-banner"><span class="ai-lab-banner__badge">INTERN TEST · KUN LOKALT</span>' +
        '<h2>AI Lab</h2><p>Sammenlign og review AI-utkast. Ingenting lagres eller publiseres automatisk.</p>' +
        '<p><strong>Separat fra Læring:</strong> Godkjent læringsinnhold vises uten AI Lab, Ollama eller Anthropic.</p></div>' +
      '<div class="ai-lab-config">' +
        '<div class="field"><label for="cs-ai-lab-scenario">Scenario</label><select id="cs-ai-lab-scenario"><option value="learning-module">Læringsmodulen</option></select></div>' +
        '<div class="field"><label for="cs-ai-lab-access-token">Lokal tilgangstoken</label><input id="cs-ai-lab-access-token" type="password" autocomplete="off" spellcheck="false" placeholder="Samme verdi som AI_LAB_ACCESS_TOKEN">' +
          '<p class="field__hint">Holdes bare i minnet i denne Console-fanen og blir ikke med i eksporten.</p></div>' +
        '<fieldset class="admin-group"><legend>Kildemateriale</legend><p class="field__hint">Velg 1–6 eksplisitt godkjente prosjektfiler. Start med én liten kilde; velger du for mye på én gang kan modellen miste deler av innholdet eller svare dårligere. Kilder merket for Haiku sendes til Anthropic når du bruker Haiku eller review. <strong id="cs-ai-lab-source-count"></strong></p>' +
          '<div class="ai-lab-sources">' + sourceHtml + '</div></fieldset>' +
        '<div class="field"><label for="cs-ai-lab-instruction">Instruksjon</label><textarea id="cs-ai-lab-instruction" rows="5" maxlength="4000"></textarea>' +
          '<p class="field__hint">Ikke skriv inn navn, kontaktopplysninger, kundeinnhold, API-nøkler, passord eller annet fortrolig innhold. Endring av instruksjon eller kilder oppretter et nytt snapshot og nullstiller sammenligningen.</p></div>' +
        '<div class="ai-lab-actions">' +
          '<button type="button" class="btn btn--primary" data-ai-lab-run="ollama" data-provider-ready="true">Kjør Gemma</button>' +
          '<button type="button" class="btn btn--ghost" data-ai-lab-run="anthropic" data-provider-ready="' + (anthropic && anthropic.configured ? "true" : "false") + '"' + (anthropic && anthropic.configured ? "" : " disabled title=\"Mangler lokal ANTHROPIC_API_KEY\"") + '>Kjør Haiku</button>' +
          '<button type="button" class="btn btn--ghost" data-ai-lab-run="review" data-provider-ready="' + (anthropic && anthropic.configured ? "true" : "false") + '"' + (anthropic && anthropic.configured ? "" : " disabled title=\"Mangler lokal ANTHROPIC_API_KEY\"") + '>Gemma + review</button>' +
        '</div>' +
        '<p class="i-notice i-notice--warn ai-lab-external-note"><strong>Ekstern behandling:</strong> Haiku-kall sender valgte kildefiler og instruksjonen til Anthropic. «Gemma + review» sender i tillegg det validerte Gemma-utkastet. Ikke bruk personopplysninger, kundeinnhold eller hemmeligheter.</p>' +
        (anthropic && anthropic.configured ? '' : '<p class="field__hint ai-lab-provider-status">Haiku er ikke konfigurert lokalt. Sett ANTHROPIC_API_KEY og start AI Lab-serveren på nytt for å aktivere knappene.</p>') +
        '<p class="field__hint">Modeller: Gemma ' + C.esc((ollama && ollama.model) || "—") + ' · Haiku ' + C.esc((anthropic && anthropic.model) || "—") + '</p>' +
        '<p id="cs-ai-lab-status" class="form__status" role="status"></p>' +
      '</div>' +
      '<div class="ai-lab-compare"><section class="ai-lab-result" aria-labelledby="cs-ai-lab-gemma-title"><h2 id="cs-ai-lab-gemma-title">Gemma</h2><div id="cs-ai-lab-gemma-result"></div></section>' +
        '<section class="ai-lab-result" aria-labelledby="cs-ai-lab-haiku-title"><h2 id="cs-ai-lab-haiku-title">Haiku</h2><div id="cs-ai-lab-haiku-result"></div></section></div>' +
      '<section class="ai-lab-result ai-lab-review" aria-labelledby="cs-ai-lab-review-title"><h2 id="cs-ai-lab-review-title">Haiku-review av Gemma</h2><div id="cs-ai-lab-review-result"></div></section>' +
      '<section class="ai-lab-evaluation"><h2>Testerens vurdering</h2>' +
        '<div class="field"><label for="cs-ai-lab-preference">Foretrukket svar</label><select id="cs-ai-lab-preference"><option value="">Ikke valgt</option><option value="ollama">Gemma</option><option value="anthropic">Haiku</option></select></div>' +
        '<div class="field"><label for="cs-ai-lab-comment">Kommentar</label><textarea id="cs-ai-lab-comment" rows="4" maxlength="4000" placeholder="Hva var bedre, svakere eller manglet?"></textarea></div>' +
        '<button type="button" class="btn btn--ghost" id="cs-ai-lab-export" disabled>Eksporter som JSON</button>' +
        '<p class="field__hint">Eksporten legger ikke ved kildefilene eller API-nøkler automatisk, men inneholder instruksjon, kommentar og modelloutput. Kontroller filen for sensitivt innhold før deling.</p></section>';

    var instruction = wrap.querySelector("#cs-ai-lab-instruction");
    instruction.value = _aiLabInstruction;
    instruction.addEventListener("input", function () {
      _aiLabInstruction = instruction.value;
      invalidateAiLabSnapshot();
    });
    var accessToken = wrap.querySelector("#cs-ai-lab-access-token");
    accessToken.value = _aiLabAccessToken;
    accessToken.addEventListener("input", function () { _aiLabAccessToken = accessToken.value; });
    wrap.querySelectorAll("[data-ai-lab-source]").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        _aiLabSelectedSources = Array.from(wrap.querySelectorAll("[data-ai-lab-source]:checked")).map(function (item) { return item.value; });
        invalidateAiLabSnapshot();
        refreshAiLabSourceLimit();
      });
    });
    wrap.querySelectorAll("[data-ai-lab-run]").forEach(function (button) {
      button.addEventListener("click", function () {
        var action = button.getAttribute("data-ai-lab-run");
        if (action === "review") runAiLabReview();
        else runAiLabProvider(action);
      });
    });
    var preference = wrap.querySelector("#cs-ai-lab-preference");
    preference.value = _aiLabPreference;
    preference.addEventListener("change", function () { _aiLabPreference = preference.value; });
    var comment = wrap.querySelector("#cs-ai-lab-comment");
    comment.value = _aiLabComment;
    comment.addEventListener("input", function () { _aiLabComment = comment.value; });
    wrap.querySelector("#cs-ai-lab-export").addEventListener("click", exportAiLabJson);
    renderAiLabResults();
    refreshAiLabSourceLimit();
    if (_aiLabBusy) setAiLabBusy(true, "Et AI-kall pågår …");
  }

  /* =========================================================================
     KUNDEANALYSE — internt control-plane-verktøy
     -------------------------------------------------------------------------
     Dette er global Vibeverk-data, ikkje data for den valde kunden i
     sidepanelet. All lesing og skriving går gjennom det autentiserte
     /api/customer-analysis-endepunktet; nettlesaren hentar aldri målsida.
     ====================================================================== */
  var _kaMode = "list";
  var _kaDetailId = null;
  var _kaDetailData = null;
  var _kaTab = "summary";
  var _kaEditingFindingId = null;
  var _kaWrap = null;
  var _kaBusy = false;

  var KA_STATUS = {
    draft:"Kladd", pending:"Venter", analyzing:"Analyserer", review_ready:"Klar til gjennomgang",
    reviewed:"Gjennomgått", failed:"Mislykket", archived:"Arkivert"
  };
  var KA_CATEGORY = {
    technical:"Tekniske funn", seo:"SEO og synlighet", accessibility:"Universell utforming",
    privacy:"Personvern og tillit", content:"Innhold og brukerreise", strength:"Sterke sider"
  };
  var KA_PRIORITY = { low:"Lav", medium:"Middels", high:"Høy" };
  var KA_REVIEW = { unreviewed:"Ikke vurdert", approved:"Godkjent", edited:"Redigert", removed:"Fjernet" };
  var KA_TYPE = { automatic:"Automatisk kontroll", ai:"AI-vurdering", manual:"Manuelt funn" };
  // Må holdes i sync med ALLOWED_AI_MODELS i api/_lib/customer-analysis-ai.js
  // -- serveren validerer uansett mot si eiga liste, denne styrer berre kva
  // som vert vist/sendt herfrå.
  var KA_MODELS = [
    { id:"claude-haiku-4-5-20251001", label:"Haiku – rask og rimelig" },
    { id:"claude-sonnet-5", label:"Sonnet – grundigere vurdering, høyere kostnad" }
  ];
  var _kaSelectedModel = KA_MODELS[0].id;

  function kaModelSelect(id) {
    return '<select id="' + id + '" title="AI-modell for neste kjøring">' +
      KA_MODELS.map(function (m) { return '<option value="' + C.esc(m.id) + '"' + (m.id === _kaSelectedModel ? " selected" : "") + '>' + C.esc(m.label) + '</option>'; }).join("") +
      '</select>';
  }

  function kaDate(value) {
    if (!value) return "—";
    try { return new Date(value).toLocaleString("nb-NO", { dateStyle:"medium", timeStyle:"short" }); }
    catch (e) { return "—"; }
  }

  function kaRequestKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (char) {
      var n = Math.random() * 16 | 0;
      return (char === "x" ? n : (n & 3 | 8)).toString(16);
    });
  }

  function kaApi(query, options) {
    var opts = options || {};
    var headers = Object.assign({ Accept:"application/json" }, opts.headers || {});
    if (_session && _session.access_token) headers.Authorization = "Bearer " + _session.access_token;
    if (opts.body && typeof opts.body !== "string") {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    opts.headers = headers;
    opts.cache = "no-store";
    return fetch("/api/customer-analysis" + (query || ""), opts).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          // Produksjonsfunn (2026-08-10): body.error er normalt ein streng
          // frå vårt eige API, men ein rå plattformfeil (t.d. funksjonen
          // krasja før handler() nokon gong køyrde) kan gje eit heilt anna
          // JSON-skap der "error" sjølv er eit objekt. new Error(objekt)
          // gjer message til "[object Object]" i staden for lesbar tekst --
          // avvis alt som ikkje faktisk er ein streng, i staden for å stole
          // blindt på skapet til svaret.
          var text = typeof body.error === "string" && body.error ? body.error : "Kundeanalyse svarte med en feil.";
          var err = new Error(text);
          err.status = response.status;
          err.code = typeof body.code === "string" ? body.code : undefined;
          throw err;
        }
        return body;
      });
    });
  }

  function kaLoading(text) {
    if (!_kaWrap) return;
    _kaWrap.innerHTML = '<div class="ka-loading" role="status"><span class="ti ti-loader-2"></span><span class="ka-loading__text">' + C.esc(text || "Laster …") + '</span></div>';
  }

  function kaShowError(message, retry) {
    if (!_kaWrap) return;
    _kaWrap.innerHTML = '<div class="ka-notice ka-error" role="alert">' + C.esc(message) + '</div>' +
      (retry ? '<button type="button" class="btn btn--ghost" id="ka-retry">Prøv igjen</button>' : '');
    if (retry) _kaWrap.querySelector("#ka-retry").addEventListener("click", retry);
  }

  function renderKundeanalyse(sc, wrap) {
    _kaWrap = wrap;
    if (_kaMode === "create") { kaRenderCreate(); return; }
    if (_kaMode === "detail" && _kaDetailId) { kaLoadDetail(_kaDetailId); return; }
    if (_kaMode === "catalog") { kaLoadCatalog(); return; }
    kaLoadList();
  }

  function kaLoadList(search, status) {
    _kaMode = "list";
    kaLoading("Henter analyser …");
    var query = "?view=list" + (search ? "&search=" + encodeURIComponent(search) : "") + (status ? "&status=" + encodeURIComponent(status) : "");
    kaApi(query).then(function (data) {
      if (_kaMode !== "list" || !_kaWrap) return;
      kaRenderList(data.analyses || [], search || "", status || "");
    }).catch(function (err) { kaShowError(err.message, function () { kaLoadList(search, status); }); });
  }

  function kaRenderList(items, search, status) {
    var rows = items.map(function (item) {
      return '<tr><td><strong>' + C.esc(item.company_name) + '</strong><br><span style="color:var(--color-muted)">' + C.esc(item.target_host) + '</span></td>' +
        '<td>' + C.esc(item.industry || "—") + '</td>' +
        '<td><span class="ka-status ka-status--' + C.esc(item.status) + '">' + C.esc(KA_STATUS[item.status] || item.status) + '</span></td>' +
        '<td>' + (item.overall_score === null ? "—" : C.esc(item.overall_score) + "/100") + '</td>' +
        '<td>' + C.esc(item.approved_findings || 0) + '</td><td>' + C.esc(kaDate(item.last_run_at || item.updated_at)) + '</td>' +
        '<td><div class="ka-actions"><button type="button" class="btn btn--ghost btn--sm" data-ka-open="' + C.esc(item.id) + '">Åpne</button>' +
        (item.status !== "analyzing" && item.status !== "archived" ? '<button type="button" class="btn btn--ghost btn--sm" data-ka-run="' + C.esc(item.id) + '">Kjør' + (item.last_run_at ? " på nytt" : "") + '</button>' : '') +
        (item.status !== "analyzing" && item.status !== "archived" ? '<button type="button" class="btn btn--ghost btn--sm" data-ka-archive="' + C.esc(item.id) + '">Arkiver</button>' : '') +
        (item.status !== "analyzing" ? '<button type="button" class="btn btn--ghost btn--sm" data-ka-delete="' + C.esc(item.id) + '">Slett permanent</button>' : '') + '</div></td></tr>';
    }).join("");
    _kaWrap.innerHTML =
      '<div class="ka-notice"><strong>Internt verktøy.</strong> Kundeanalyse undersøker bare offentlig tilgjengelige sider og lager utkast til menneskelig gjennomgang. Ingenting sendes til virksomheten automatisk.</div>' +
      '<div class="ka-toolbar"><div class="ka-toolbar__filters"><input id="ka-search" type="search" placeholder="Søk etter virksomhet eller domene" value="' + C.esc(search) + '">' +
        '<select id="ka-status"><option value="">Alle statuser</option>' + Object.keys(KA_STATUS).map(function (key) { return '<option value="' + key + '"' + (status === key ? " selected" : "") + '>' + C.esc(KA_STATUS[key]) + '</option>'; }).join("") + '</select>' +
        '<button type="button" class="btn btn--ghost" id="ka-filter">Søk</button></div><div class="ka-actions">' +
        '<button type="button" class="btn btn--ghost" id="ka-catalog">Tjenestekatalog</button><button type="button" class="btn btn--primary" id="ka-new">Ny analyse</button></div></div>' +
      (items.length ? '<div class="ka-table-wrap"><table class="ka-table"><thead><tr><th>Virksomhet</th><th>Bransje</th><th>Status</th><th>Vurdering</th><th>Godkjent</th><th>Sist kjørt</th><th>Handlinger</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="ka-empty"><strong>Ingen analyser funnet.</strong><p>Opprett en analyse for å undersøke et offentlig nettsted.</p></div>');
    _kaWrap.querySelector("#ka-new").addEventListener("click", function () { _kaMode = "create"; kaRenderCreate(); });
    _kaWrap.querySelector("#ka-catalog").addEventListener("click", function () { _kaMode = "catalog"; kaLoadCatalog(); });
    _kaWrap.querySelector("#ka-filter").addEventListener("click", function () { kaLoadList(_kaWrap.querySelector("#ka-search").value.trim(), _kaWrap.querySelector("#ka-status").value); });
    _kaWrap.querySelector("#ka-search").addEventListener("keydown", function (event) { if (event.key === "Enter") _kaWrap.querySelector("#ka-filter").click(); });
    _kaWrap.querySelectorAll("[data-ka-open]").forEach(function (button) { button.addEventListener("click", function () { kaOpenDetail(button.getAttribute("data-ka-open")); }); });
    _kaWrap.querySelectorAll("[data-ka-run]").forEach(function (button) { button.addEventListener("click", function () { kaRun(button.getAttribute("data-ka-run")); }); });
    _kaWrap.querySelectorAll("[data-ka-archive]").forEach(function (button) { button.addEventListener("click", function () { kaArchive(button.getAttribute("data-ka-archive"), function () { kaLoadList(search, status); }); }); });
    _kaWrap.querySelectorAll("[data-ka-delete]").forEach(function (button) { button.addEventListener("click", function () { kaDeletePermanently(button.getAttribute("data-ka-delete"), function () { kaLoadList(search, status); }); }); });
  }

  function kaRenderCreate() {
    _kaMode = "create";
    _kaWrap.innerHTML =
      '<button type="button" class="btn btn--ghost" id="ka-back">← Til analyseoversikten</button>' +
      '<div class="ka-notice" style="margin-top:1rem"><strong>Dette gjør analysen:</strong> Leser startsiden og inntil fem trygge, offentlige undersider, respekterer robots.txt og lager dokumenterbare tekniske funn. Dersom Anthropic er konfigurert, sendes bare korte, rensede tekstutdrag til modellen.<br><strong>Dette gjør den ikke:</strong> Logger inn, sender skjemaer, omgår blokkeringer, gjør sikkerhetsskanning eller trekker juridiske konklusjoner.</div>' +
      '<form class="ka-form" id="ka-create-form"><h2>Opprett analyse</h2>' +
        C.field({ id:"ka-company", label:"Virksomhetsnavn", required:true, placeholder:"Eksempel AS" }) +
        C.field({ id:"ka-url", label:"Nettadresse", type:"url", required:true, placeholder:"https://eksempel.no" }) +
        C.field({ id:"ka-industry", label:"Bransje (valgfritt)", placeholder:"For eksempel bygg og anlegg" }) +
        C.field({ id:"ka-notes", label:"Interne notater (valgfritt)", multiline:true, rows:4, hint:"Ikke legg inn unødvendige personopplysninger." }) +
        '<div class="field"><label for="ka-max-pages">Maksimalt antall sider</label><select id="ka-max-pages"><option value="3">3 sider</option><option value="5" selected>5 sider</option><option value="1">Bare startsiden</option></select><p class="field__hint">Forsiktig standard: startsiden og inntil fire relevante undersider.</p></div>' +
        '<p id="ka-create-status" class="form__status" role="status"></p><div class="ka-actions"><button type="submit" class="btn btn--primary" id="ka-create-submit">Opprett analyse</button><button type="button" class="btn btn--ghost" id="ka-create-cancel">Avbryt</button></div>' +
      '</form>';
    function back() { _kaMode = "list"; kaLoadList(); }
    _kaWrap.querySelector("#ka-back").addEventListener("click", back);
    _kaWrap.querySelector("#ka-create-cancel").addEventListener("click", back);
    var submitted = false;
    _kaWrap.querySelector("#ka-create-form").addEventListener("submit", function (event) {
      event.preventDefault();
      if (submitted) return;
      submitted = true;
      var button = _kaWrap.querySelector("#ka-create-submit");
      var statusEl = _kaWrap.querySelector("#ka-create-status");
      button.disabled = true;
      statusEl.textContent = "Oppretter analysen …";
      kaApi("", { method:"POST", body:{
        action:"create", requestKey:kaRequestKey(), companyName:_kaWrap.querySelector("#ka-company").value,
        websiteUrl:_kaWrap.querySelector("#ka-url").value, industry:_kaWrap.querySelector("#ka-industry").value,
        internalNotes:_kaWrap.querySelector("#ka-notes").value, maxPages:Number(_kaWrap.querySelector("#ka-max-pages").value)
      }}).then(function (data) { kaOpenDetail(data.analysis.id); }).catch(function (err) {
        submitted = false; button.disabled = false; statusEl.textContent = err.message; statusEl.className = "form__status is-error";
      });
    });
  }

  function kaOpenDetail(id) {
    _kaMode = "detail"; _kaDetailId = id; _kaTab = "summary"; _kaEditingFindingId = null; kaLoadDetail(id);
  }

  function kaLoadDetail(id) {
    _kaMode = "detail"; _kaDetailId = id; kaLoading("Henter analysen …");
    kaApi("?view=detail&id=" + encodeURIComponent(id)).then(function (data) {
      if (_kaMode !== "detail" || _kaDetailId !== id) return;
      _kaDetailData = data; kaRenderDetail();
    }).catch(function (err) { kaShowError(err.message, function () { kaLoadDetail(id); }); });
  }

  function kaTabButton(id, label, count) {
    return '<button type="button" class="ka-tab' + (_kaTab === id ? " is-active" : "") + '" data-ka-tab="' + id + '">' + C.esc(label) + (count === undefined ? "" : " (" + C.esc(count) + ")") + '</button>';
  }

  function kaRenderDetail() {
    var data = _kaDetailData;
    if (!data) return;
    var analysis = data.analysis;
    var counts = {};
    data.findings.forEach(function (item) { counts[item.category] = (counts[item.category] || 0) + 1; });
    var approved = data.findings.filter(function (item) { return item.review_status === "approved"; }).length;
    _kaWrap.innerHTML =
      '<div class="ka-toolbar"><button type="button" class="btn btn--ghost" id="ka-detail-back">← Til analyseoversikten</button><div class="ka-actions">' +
        (analysis.status !== "analyzing" && analysis.status !== "archived" ? kaModelSelect("ka-detail-model") : '') +
        (analysis.status !== "analyzing" && analysis.status !== "archived" ? '<button type="button" class="btn btn--primary" id="ka-detail-run">' + (analysis.last_run_at ? "Kjør på nytt" : "Start analyse") + '</button>' : '') +
        (analysis.status !== "analyzing" && analysis.status !== "archived" ? '<button type="button" class="btn btn--ghost" id="ka-detail-archive">Arkiver</button>' : '') +
        (analysis.status !== "analyzing" ? '<button type="button" class="btn btn--ghost" id="ka-detail-delete">Slett permanent</button>' : '') + '</div></div>' +
      '<section class="ka-hero"><div><div class="ka-card__meta"><span class="ka-status ka-status--' + C.esc(analysis.status) + '">' + C.esc(KA_STATUS[analysis.status] || analysis.status) + '</span><span class="ka-badge">' + approved + ' godkjent</span></div>' +
        '<h2>' + C.esc(analysis.company_name) + '</h2><p>' + C.esc(analysis.website_url) + '</p><p>' + C.esc(analysis.industry || "Bransje ikke oppgitt") + ' · Sist kjørt ' + C.esc(kaDate(analysis.last_run_at)) + '</p></div>' +
        '<div class="ka-score" title="Automatisk, veiledende vurdering">' + (analysis.overall_score === null ? "—" : C.esc(analysis.overall_score)) + '</div></section>' +
      (analysis.status === "analyzing" ? '<div class="ka-notice"><span class="ti ti-loader-2"></span> Analysen kjører. Hold denne fanen åpen til resultatet er lagret.</div>' : '') +
      '<nav class="ka-tabs" aria-label="Analyseområder">' + kaTabButton("summary", "Oppsummering") + kaTabButton("technical", "Teknisk", counts.technical || 0) + kaTabButton("seo", "SEO", counts.seo || 0) + kaTabButton("accessibility", "Universell utforming", counts.accessibility || 0) + kaTabButton("privacy", "Personvern og tillit", counts.privacy || 0) + kaTabButton("content", "Innhold og brukerreise", counts.content || 0) + kaTabButton("opportunities", "Muligheter for Vibeverk") + kaTabButton("meeting", "Møtegrunnlag") + '</nav>' +
      '<div id="ka-tab-panel"></div>';
    _kaWrap.querySelector("#ka-detail-back").addEventListener("click", function () { _kaMode = "list"; kaLoadList(); });
    var modelSelect = _kaWrap.querySelector("#ka-detail-model");
    if (modelSelect) modelSelect.addEventListener("change", function () { _kaSelectedModel = modelSelect.value; });
    var run = _kaWrap.querySelector("#ka-detail-run"); if (run) run.addEventListener("click", function () {
      // UX-review-funn (BLOCKER, 2026-08-10): ei ny køyring hentar godkjente/
      // redigerte funn frå FØRRE køyring usynlege (dei er framleis i databasen,
      // men detail() viser berre funn knytt til siste run_id) -- utan denne
      // åtvaringa forsvinn timevis med gjennomgangsarbeid utan varsel.
      if (analysis.last_run_at && !confirm("Kjøre analysen på nytt? Godkjente og redigerte funn fra forrige gjennomgang blir ikke vist før de vurderes på nytt i den nye kjøringen.")) return;
      kaRun(analysis.id);
    });
    var archive = _kaWrap.querySelector("#ka-detail-archive"); if (archive) archive.addEventListener("click", function () { kaArchive(analysis.id, function () { kaLoadDetail(analysis.id); }); });
    var del = _kaWrap.querySelector("#ka-detail-delete"); if (del) del.addEventListener("click", function () { kaDeletePermanently(analysis.id, function () { _kaMode = "list"; kaLoadList(); }); });
    _kaWrap.querySelectorAll("[data-ka-tab]").forEach(function (button) { button.addEventListener("click", function () { _kaTab = button.getAttribute("data-ka-tab"); _kaEditingFindingId = null; kaRenderDetail(); }); });
    kaRenderTab();
  }

  function kaRenderTab() {
    var panel = _kaWrap.querySelector("#ka-tab-panel");
    var data = _kaDetailData;
    if (_kaTab === "summary") { kaRenderSummary(panel, data); return; }
    if (_kaTab === "meeting") { kaRenderMeeting(panel, data); return; }
    if (_kaTab === "opportunities") { kaRenderFindings(panel, data.findings.filter(function (item) { return item.review_status !== "removed"; }), true); return; }
    kaRenderFindings(panel, data.findings.filter(function (item) { return item.category === _kaTab; }), false);
  }

  function kaRenderSummary(panel, data) {
    var run = data.latestRun;
    var pageHtml = data.pages.map(function (page) {
      return '<div class="ka-page"><div><strong>' + C.esc(page.title || page.requested_url) + '</strong><br><span>' + C.esc(page.final_url || page.requested_url) + '</span>' + (page.error_message ? '<br><span style="color:#991b1b">' + C.esc(page.error_message) + '</span>' : '') + '</div><span class="ka-badge ka-badge--' + (page.fetch_status === "fetched" ? "approved" : "high") + '">' + C.esc(page.fetch_status === "fetched" ? "Lest" : page.fetch_status === "skipped" ? "Utelatt" : "Feilet") + '</span></div>';
    }).join("");
    panel.innerHTML =
      '<div class="ka-notice"><strong>Veiledende resultat:</strong> ' + C.esc(data.analysis.overall_summary || "Analysen er ikke kjørt ennå.") + '</div>' +
      (run && run.ai_status === "not_configured" ? '<div class="ka-notice">AI-vurderingen var utilgjengelig fordi Anthropic ikke er konfigurert. De tekniske kontrollene er likevel gjennomført.</div>' : '') +
      (run && run.ai_status === "failed" ? '<div class="ka-notice ka-error">AI-vurderingen feilet. De tekniske kontrollene og resultatene er fortsatt lagret.</div>' : '') +
      '<div class="ka-grid"><section class="ka-card"><h3>Kjøring</h3><p><strong>Status:</strong> ' + C.esc(run ? run.status : "Ikke startet") + '</p><p><strong>AI:</strong> ' + C.esc(run ? run.ai_status : "—") + '</p><p><strong>Startet:</strong> ' + C.esc(kaDate(run && run.started_at)) + '</p><p><strong>Fullført:</strong> ' + C.esc(kaDate(run && run.finished_at)) + '</p></section>' +
      '<section class="ka-card"><h3>Avgrensning</h3><p>Maks ' + C.esc(data.analysis.max_pages) + ' sider. Automatiske kontroller er ikke en full WCAG-, SEO-, personvern- eller ytelsesvurdering.</p><p>Konklusjoner som krever juridisk eller faglig vurdering må undersøkes manuelt.</p></section></div>' +
      '<h2 style="margin:1.3rem 0 .7rem">Undersøkte sider</h2>' + (pageHtml ? '<div class="ka-page-list">' + pageHtml + '</div>' : '<div class="ka-empty">Ingen sider er undersøkt ennå.</div>');
  }

  function kaServicesForFinding(findingId) {
    var serviceIds = _kaDetailData.findingServices.filter(function (link) { return link.finding_id === findingId; }).map(function (link) { return link.service_id; });
    return _kaDetailData.catalog.filter(function (service) { return serviceIds.indexOf(service.id) !== -1; });
  }

  function kaFindingCard(item, opportunities) {
    var editing = _kaEditingFindingId === item.id;
    var services = kaServicesForFinding(item.id);
    if (editing) {
      var selected = {};
      services.forEach(function (service) { selected[service.id] = true; });
      return '<article class="ka-card"><form class="ka-edit" data-ka-edit-form="' + C.esc(item.id) + '"><label>Tittel<input name="title" maxlength="240" value="' + C.esc(item.title) + '"></label>' +
        '<label>Observasjon<textarea name="observation" rows="4" maxlength="2000">' + C.esc(item.observation) + '</textarea></label><label>Berørt element (valgfritt)<input name="affectedElement" maxlength="500" value="' + C.esc(item.affected_element) + '"></label><label>Betydning<textarea name="significance" rows="3" maxlength="1600">' + C.esc(item.significance) + '</textarea></label>' +
        '<label>Forslag til tiltak<textarea name="recommendation" rows="3" maxlength="1600">' + C.esc(item.recommendation) + '</textarea></label>' +
        '<label>Prioritet<select name="priority">' + Object.keys(KA_PRIORITY).map(function (key) { return '<option value="' + key + '"' + (item.priority === key ? " selected" : "") + '>' + KA_PRIORITY[key] + '</option>'; }).join("") + '</select></label>' +
        '<label>Vibeverk-tjenester<select name="services" multiple size="5">' + _kaDetailData.catalog.filter(function (service) { return service.active; }).map(function (service) { return '<option value="' + C.esc(service.id) + '"' + (selected[service.id] ? " selected" : "") + '>' + C.esc(service.title + (service.delivery_status === "adaptation" ? " (mulig tilpasning)" : "")) + '</option>'; }).join("") + '</select></label>' +
        '<label>Interne notater<textarea name="internalNotes" rows="3" maxlength="3000">' + C.esc(item.internal_notes) + '</textarea></label><p class="form__status" role="status"></p><div class="ka-actions"><button type="submit" class="btn btn--primary">Lagre som redigert</button><button type="button" class="btn btn--ghost" data-ka-edit-cancel>Avbryt</button></div></form></article>';
    }
    return '<article class="ka-card' + (item.review_status === "removed" ? " is-removed" : "") + '"><div class="ka-card__meta"><span class="ka-badge ka-badge--' + C.esc(item.finding_type) + '">' + C.esc(KA_TYPE[item.finding_type] || item.finding_type) + '</span>' +
      '<span class="ka-badge ka-badge--' + C.esc(item.priority) + '">' + C.esc(KA_PRIORITY[item.priority] || item.priority) + '</span>' + (item.finding_type === "ai" ? '<span class="ka-badge">AI-sikkerhet: ' + C.esc(KA_PRIORITY[item.confidence] || item.confidence) + '</span>' : '') + '<span class="ka-badge ka-badge--' + C.esc(item.review_status) + '">' + C.esc(KA_REVIEW[item.review_status] || item.review_status) + '</span></div>' +
      '<h3>' + C.esc(item.title) + '</h3><p>' + C.esc(item.observation) + '</p>' + (item.significance ? '<p><strong>Betydning:</strong> ' + C.esc(item.significance) + '</p>' : '') + (item.recommendation ? '<p><strong>Forslag:</strong> ' + C.esc(item.recommendation) + '</p>' : '') +
      (item.source_url && /^https?:\/\//i.test(item.source_url) ? '<a class="ka-card__source" href="' + C.esc(item.source_url) + '" target="_blank" rel="noopener noreferrer">Kilde: ' + C.esc(item.source_url) + '</a>' : '') +
      (services.length ? '<p><strong>Mulige leveranser:</strong> ' + services.map(function (service) { return C.esc(service.title + (service.delivery_status === "adaptation" ? " (mulig tilpasning)" : "")); }).join(", ") + '</p>' : '') +
      (item.internal_notes ? '<p><strong>Internt:</strong> ' + C.esc(item.internal_notes) + '</p>' : '') +
      '<div class="ka-card__buttons">' + (item.review_status !== "approved" ? '<button type="button" class="btn btn--primary btn--sm" data-ka-approve="' + C.esc(item.id) + '">Godkjenn</button>' : '') + '<button type="button" class="btn btn--ghost btn--sm" data-ka-edit="' + C.esc(item.id) + '">Rediger</button>' + (item.review_status !== "removed" ? '<button type="button" class="btn btn--ghost btn--sm" data-ka-remove="' + C.esc(item.id) + '">Fjern</button>' : '') + '</div></article>';
  }

  function kaRenderFindings(panel, items, opportunities) {
    panel.innerHTML = (opportunities ? '<div class="ka-notice">Tiltak er forslag knyttet til dokumenterte funn. Tjenester merket «mulig tilpasning» er ikke ferdige produktmoduler.</div>' : '<div class="ka-notice">AI-funn er utkast. Godkjenn, rediger eller fjern hvert funn før det kan brukes i møtegrunnlaget.</div>') +
      '<div class="ka-toolbar"><h2 style="margin:0">' + C.esc(opportunities ? "Muligheter for Vibeverk" : KA_CATEGORY[_kaTab]) + '</h2><button type="button" class="btn btn--ghost" id="ka-add-manual">Legg til manuelt funn</button></div>' +
      (items.length ? '<div class="ka-grid">' + items.map(function (item) { return kaFindingCard(item, opportunities); }).join("") + '</div>' : '<div class="ka-empty">Ingen funn i denne kategorien.</div>') + '<div id="ka-manual-slot"></div>';
    panel.querySelector("#ka-add-manual").addEventListener("click", function () { kaRenderManualForm(panel.querySelector("#ka-manual-slot")); });
    panel.querySelectorAll("[data-ka-approve]").forEach(function (button) { button.addEventListener("click", function () { kaSetReviewStatus(button.getAttribute("data-ka-approve"), "approved", button); }); });
    panel.querySelectorAll("[data-ka-remove]").forEach(function (button) { button.addEventListener("click", function () { kaSetReviewStatus(button.getAttribute("data-ka-remove"), "removed", button); }); });
    panel.querySelectorAll("[data-ka-edit]").forEach(function (button) { button.addEventListener("click", function () { _kaEditingFindingId = button.getAttribute("data-ka-edit"); kaRenderDetail(); }); });
    panel.querySelectorAll("[data-ka-edit-cancel]").forEach(function (button) { button.addEventListener("click", function () { _kaEditingFindingId = null; kaRenderDetail(); }); });
    panel.querySelectorAll("[data-ka-edit-form]").forEach(function (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var serviceIds = Array.from(form.elements.services.selectedOptions).map(function (option) { return option.value; });
        kaUpdateFinding({ id:form.getAttribute("data-ka-edit-form"), reviewStatus:"edited", title:form.elements.title.value, observation:form.elements.observation.value, affectedElement:form.elements.affectedElement.value, significance:form.elements.significance.value, recommendation:form.elements.recommendation.value, priority:form.elements.priority.value, internalNotes:form.elements.internalNotes.value, serviceIds:serviceIds }, form.querySelector('[type="submit"]'));
      });
    });
  }

  function kaUpdateFinding(payload, button) {
    if (_kaBusy) return;
    _kaBusy = true; if (button) button.disabled = true;
    kaApi("", { method:"POST", body:Object.assign({ action:"update_finding" }, payload) }).then(function () {
      _kaBusy = false; _kaEditingFindingId = null; kaLoadDetail(_kaDetailId);
    }).catch(function (err) { _kaBusy = false; if (button) button.disabled = false; alert(err.message); });
  }

  // UX-review-funn (HIGH, 2026-08-10): Godkjenn/Fjern er den klart hyppigaste
  // handlinga (opptil fleire dusin per analyse) og endrar berre review_status
  // -- eit fullt nettverksoppslag + spinner-blink + hel omteikning av
  // verktøylinje/hero/faner for kvart einaste klikk var unødvendig treigt.
  // Server-svaret for update_finding gir ikkje raden attende, men klienten
  // sender alt nøyaktig den nye reviewStatus-verdien -- trygt å oppdatere
  // _kaDetailData lokalt og teikne om utan nytt nettverksoppslag. Redigering
  // (kaUpdateFinding over) endrar fleire felt + tenestekoplingar samstundes,
  // så den nyttar framleis fullt reload for å halde seg garantert korrekt.
  function kaSetReviewStatus(id, status, button) {
    if (_kaBusy) return;
    _kaBusy = true; if (button) button.disabled = true;
    kaApi("", { method:"POST", body:{ action:"update_finding", id:id, reviewStatus:status } }).then(function () {
      _kaBusy = false;
      var item = _kaDetailData && _kaDetailData.findings.find(function (f) { return f.id === id; });
      if (item) item.review_status = status;
      kaRenderDetail();
    }).catch(function (err) { _kaBusy = false; if (button) button.disabled = false; alert(err.message); });
  }

  function kaRenderManualForm(slot) {
    slot.innerHTML = '<form class="ka-form" id="ka-manual-form" style="margin-top:1rem"><h2>Nytt manuelt funn</h2><div class="ka-form__row"><div class="field"><label>Kategori<select name="category">' + Object.keys(KA_CATEGORY).map(function (key) { return '<option value="' + key + '">' + C.esc(KA_CATEGORY[key]) + '</option>'; }).join("") + '</select></label></div><div class="field"><label>Prioritet<select name="priority"><option value="medium">Middels</option><option value="high">Høy</option><option value="low">Lav</option></select></label></div></div>' +
      C.field({ id:"ka-manual-title", label:"Tittel", required:true }) + C.field({ id:"ka-manual-observation", label:"Konkret observasjon", multiline:true, rows:4, required:true }) + C.field({ id:"ka-manual-source", label:"Kilde-URL (valgfritt)", type:"url" }) + C.field({ id:"ka-manual-element", label:"Berørt element (valgfritt)" }) + C.field({ id:"ka-manual-significance", label:"Betydning", multiline:true, rows:3 }) + C.field({ id:"ka-manual-recommendation", label:"Forslag til tiltak", multiline:true, rows:3 }) +
      '<p class="form__status" role="status"></p><div class="ka-actions"><button type="submit" class="btn btn--primary">Lagre funn</button><button type="button" class="btn btn--ghost" id="ka-manual-cancel">Avbryt</button></div></form>';
    slot.querySelector("#ka-manual-cancel").addEventListener("click", function () { slot.innerHTML = ""; });
    slot.querySelector("#ka-manual-form").addEventListener("submit", function (event) {
      event.preventDefault(); var form = event.currentTarget; var button = form.querySelector('[type="submit"]'); button.disabled = true;
      kaApi("", { method:"POST", body:{ action:"add_finding", analysisId:_kaDetailId, category:form.elements.category.value, priority:form.elements.priority.value, title:form.querySelector("#ka-manual-title").value, observation:form.querySelector("#ka-manual-observation").value, sourceUrl:form.querySelector("#ka-manual-source").value, affectedElement:form.querySelector("#ka-manual-element").value, significance:form.querySelector("#ka-manual-significance").value, recommendation:form.querySelector("#ka-manual-recommendation").value, serviceIds:[] } }).then(function () { kaLoadDetail(_kaDetailId); }).catch(function (err) { button.disabled = false; var status = form.querySelector(".form__status"); status.textContent = err.message; status.className = "form__status is-error"; });
    });
  }

  function kaRenderMeeting(panel, data) {
    var latest = data.briefs[0];
    var content = latest && latest.content;
    panel.innerHTML = '<div class="ka-notice">Møtegrunnlaget bruker bare funn som er uttrykkelig godkjent. Redigerte funn må godkjennes etter redigering. Det sendes ikke automatisk til kunden.</div><div class="ka-actions">' + kaModelSelect("ka-brief-model") + '<button type="button" class="btn btn--primary" id="ka-generate-brief">Lag nytt møtegrunnlag</button></div><p id="ka-brief-status" class="form__status" role="status"></p>' +
      (content ? '<article class="ka-card ka-brief" style="margin-top:1rem"><h2>' + C.esc(content.title) + '</h2>' + (content.aiStatus === "not_configured" ? '<p class="ka-notice">Møtegrunnlaget er satt sammen uten AI fordi Anthropic ikke er konfigurert.</p>' : content.aiStatus === "failed" ? '<p class="ka-notice ka-error">AI-formuleringen feilet. Et regelbasert møtegrunnlag fra de godkjente funnene ble lagret i stedet.</p>' : '') + '<p>' + C.esc(content.companyDescription) + '</p><h3>Sterke sider</h3>' + kaStringList(content.strengths) + '<h3>Viktigste forbedringsmuligheter</h3>' + kaObjectList(content.opportunities) + '<h3>Spørsmål til møtet</h3>' + kaStringList(content.questions) + '<h3>Mulige Vibeverk-leveranser</h3>' + kaDeliveryList(content.possibleDeliveries) + '<h3>Anbefalt neste steg</h3><p>' + C.esc(content.recommendedNextStep) + '</p><h3>Interne notater</h3><p>' + C.esc(content.internalNotes || "Ingen interne notater.") + '</p><p class="field__hint">' + C.esc(content.disclaimer) + '</p></article>' : '<div class="ka-empty" style="margin-top:1rem">Det finnes ikke noe møtegrunnlag ennå.</div>');
    var briefModelSelect = panel.querySelector("#ka-brief-model");
    if (briefModelSelect) briefModelSelect.addEventListener("change", function () { _kaSelectedModel = briefModelSelect.value; });
    panel.querySelector("#ka-generate-brief").addEventListener("click", function (event) {
      var button = event.currentTarget; var status = panel.querySelector("#ka-brief-status"); button.disabled = true; status.textContent = "Lager møtegrunnlag …";
      kaApi("", { method:"POST", body:{ action:"generate_brief", id:_kaDetailId, aiModel:_kaSelectedModel } }).then(function () { kaLoadDetail(_kaDetailId); }).catch(function (err) { button.disabled = false; status.textContent = err.message; status.className = "form__status is-error"; });
    });
  }

  function kaStringList(items) { return items && items.length ? '<ul>' + items.map(function (item) { return '<li>' + C.esc(item) + '</li>'; }).join("") + '</ul>' : '<p>Ingen godkjente punkter.</p>'; }
  function kaObjectList(items) { return items && items.length ? '<ul>' + items.map(function (item) { return '<li><strong>' + C.esc(item.title) + ':</strong> ' + C.esc(item.observation) + '</li>'; }).join("") + '</ul>' : '<p>Ingen godkjente punkter.</p>'; }
  function kaDeliveryList(items) { return items && items.length ? '<ul>' + items.map(function (item) { return '<li>' + C.esc(item.title) + (item.deliveryStatus === "adaptation" ? " (mulig tilpasning)" : "") + '</li>'; }).join("") + '</ul>' : '<p>Ingen tjenester er koblet til godkjente funn.</p>'; }

  var KA_RUN_STEPS = ["Klargjør sikker innhenting …", "Henter og leser sider …", "Kontrollerer robots.txt og sitemap …", "Kjører AI-vurdering (hvis konfigurert) …", "Lagrer resultatet …"];

  function kaRun(id) {
    if (_kaBusy) return;
    _kaBusy = true; _kaMode = "detail"; _kaDetailId = id;
    var stepIndex = 0;
    kaLoading(KA_RUN_STEPS[0] + " Dette kan ta et par minutter.");
    // UX-review-funn (HIGH, 2026-08-10): ei enkelt, klientside tidsstyrt
    // steg-tekst -- ikkje ekte serverframdrift (det finst ingen streaming-/
    // pollingmekanisme), men gjer at det lange, stille venteintervallet ikkje
    // ser heilt frose ut.
    var stepTimer = setInterval(function () {
      stepIndex = Math.min(stepIndex + 1, KA_RUN_STEPS.length - 1);
      if (_kaMode === "detail" && _kaDetailId === id && _kaBusy) {
        var statusEl = _kaWrap.querySelector(".ka-loading__text");
        if (statusEl) statusEl.textContent = KA_RUN_STEPS[stepIndex] + " Dette kan ta et par minutter.";
      }
    }, 12000);
    kaApi("", { method:"POST", body:{ action:"run", id:id, aiModel:_kaSelectedModel } }).then(function (data) {
      clearInterval(stepTimer);
      _kaBusy = false;
      // UX-review-funn (BLOCKER, 2026-08-10): utan denne sjekken kan ei
      // køyring som vart starta for analyse A, og som fyrst svarer etter
      // operatøren alt har navigert vidare til analyse B, stille erstatte
      // skjermen operatøren no faktisk ser på med A sitt resultat.
      if (_kaDetailId !== id) return;
      _kaDetailData = data; _kaTab = "summary"; kaRenderDetail();
    }).catch(function (err) {
      clearInterval(stepTimer);
      _kaBusy = false;
      if (_kaDetailId !== id) return;
      kaShowError(err.message, function () { kaLoadDetail(id); });
    });
  }

  function kaArchive(id, done) {
    if (!confirm("Arkivere denne analysen? Den blir skjult fra den vanlige arbeidslisten. Historikken slettes ikke, men det finnes ingen måte å gjenåpne analysen fra Console i dag.")) return;
    kaApi("", { method:"POST", body:{ action:"archive", id:id } }).then(done).catch(function (err) { alert(err.message); });
  }

  // Brukarønske (2026-08-10): ein reell sletteveg, ikkje berre arkivering,
  // før ekte (ikkje-mocka) bruk mot eit reelt nettstad -- nivå B-stadfesting
  // per copy-style-guide.md: eksakt omfang, kva som IKKJE påverkast, og at
  // det ikkje kan angrast.
  function kaDeletePermanently(id, done) {
    if (!confirm("Slette denne analysen permanent? Dette fjerner virksomhetsnavn, nettadresse, alle undersøkte sider, funn og møtegrunnlag knyttet til denne analysen for godt. Den anonyme hendelsesloggen (uten virksomhetsnavn eller URL) beholdes for sporbarhet. Dette kan IKKE angres.")) return;
    kaApi("", { method:"POST", body:{ action:"delete", id:id } }).then(done).catch(function (err) { alert(err.message); });
  }

  function kaLoadCatalog() {
    _kaMode = "catalog"; kaLoading("Henter tjenestekatalogen …");
    kaApi("?view=catalog").then(function (data) { if (_kaMode === "catalog") kaRenderCatalog(data.catalog || []); }).catch(function (err) { kaShowError(err.message, kaLoadCatalog); });
  }

  function kaRenderCatalog(catalog) {
    _kaWrap.innerHTML = '<div class="ka-toolbar"><button type="button" class="btn btn--ghost" id="ka-catalog-back">← Til analyseoversikten</button></div><div class="ka-notice">Denne katalogen er kilden for tiltak Kundeanalyse kan foreslå. «Mulig tilpasning» skal ikke presenteres som en ferdig modul.</div><div class="ka-service-list">' + catalog.map(function (service) {
      return '<form class="ka-service ka-edit" data-ka-service="' + C.esc(service.id) + '"><label>Navn<input name="title" maxlength="200" value="' + C.esc(service.title) + '"></label><label>Beskrivelse<textarea name="description" rows="2" maxlength="1200">' + C.esc(service.description) + '</textarea></label><div class="ka-form__row"><label>Leveransestatus<select name="deliveryStatus"><option value="available"' + (service.delivery_status === "available" ? " selected" : "") + '>Tilgjengelig i dag</option><option value="adaptation"' + (service.delivery_status === "adaptation" ? " selected" : "") + '>Mulig tilpasning</option></select></label><label style="display:flex;align-items:center;gap:.5rem"><input type="checkbox" name="active"' + (service.active ? " checked" : "") + '> Aktiv i forslag</label></div><div class="ka-actions"><button type="submit" class="btn btn--ghost">Lagre</button><span class="form__status" role="status"></span></div></form>';
    }).join("") + '</div>';
    _kaWrap.querySelector("#ka-catalog-back").addEventListener("click", function () { _kaMode = "list"; kaLoadList(); });
    _kaWrap.querySelectorAll("[data-ka-service]").forEach(function (form) { form.addEventListener("submit", function (event) {
      event.preventDefault(); var button = form.querySelector('[type="submit"]'); var status = form.querySelector(".form__status"); button.disabled = true;
      kaApi("", { method:"POST", body:{ action:"save_service", service:{ id:form.getAttribute("data-ka-service"), title:form.elements.title.value, description:form.elements.description.value, deliveryStatus:form.elements.deliveryStatus.value, active:form.elements.active.checked } } }).then(function () { button.disabled = false; status.textContent = "Lagret."; status.className = "form__status is-ok"; }).catch(function (err) { button.disabled = false; status.textContent = err.message; status.className = "form__status is-error"; });
    }); });
  }

  function renderSystem(sc, wrap) {
    var supaUrl     = (_activeTenant && _activeTenant.data_plane_url) || "—";
    var supaKey     = (_activeTenant && _activeTenant.data_plane_anon_key) || "";
    var supaKeyShrt = supaKey ? supaKey.slice(0, 40) + "…" : "—";
    var expiresAtSec = _session && _session.expires_at;
    var expiryStr   = expiresAtSec ? new Date(expiresAtSec * 1000).toLocaleString("nb-NO") : "—";

    // "Nettside-admin (for kunden)"-boksen (redigering av det lokale
    // #admin-fallback-passordet, superconfig-private.adminPassword) vart
    // fjerna herifrå 2026-07-17 -- brukar stadfesta at han ikkje har nokon
    // praktisk funksjon for ekte kundar (verkar berre når Supabase IKKJE er
    // konfigurert i det heile, sjå ADR-0003, noko som aldri er tilfellet for
    // ein kunde styrt via Console). Sjølve fallback-mekanismen i core.js er
    // urørt -- berre redigerings-UI-et her er fjerna.
    wrap.innerHTML =
      '<fieldset class="admin-group"><legend>Innlogging</legend>' +
        '<p style="font-size:.85rem;color:var(--color-muted);margin:0 0 .4rem">Console brukar OTP via e-post mot vibeverk-control (Fase 8) — ingen passord å handtere her.</p>' +
        '<p style="font-size:.85rem;color:var(--color-muted);margin:0">Innlogga tenant: <strong>' + C.esc((_activeTenant && _activeTenant.slug) || "—") + '</strong></p>' +
        '<p style="font-size:.85rem;color:var(--color-muted);margin:0">Økta oppdaterast automatisk; gjeldande token utløper: <strong>' + C.esc(expiryStr) + '</strong></p>' +
      '</fieldset>' +
      '<fieldset class="admin-group"><legend>Supabase-prosjekt</legend>' +
        '<div style="font-size:.87rem;color:var(--color-muted);display:grid;gap:.4rem">' +
          '<div><strong>URL:</strong> ' + C.esc(supaUrl) + '</div>' +
          '<div><strong>Anon-nøkkel:</strong> <code style="font-size:.76rem;word-break:break-all">' + C.esc(supaKeyShrt) + '</code></div>' +
        '</div>' +
      '</fieldset>' +
      '<fieldset class="admin-group cs-danger-zone"><legend>Faresone</legend>' +
        '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Nullstiller ALLE tilpassa innstillingar for denne kunden (farger, fontar, tekstar, aktiverte funksjonar, personvernstekst osv.) tilbake til dei nøytrale standardverdiane. Dette skjer umiddelbart og er synleg for besøkjande på kunden sitt nettside/Workspace med ein gong. Kan ikkje angrast.</p>' +
        '<button type="button" class="btn btn--ghost" id="cs-reset-btn" style="border-color:#c0392b;color:#c0392b">Nullstill all konfig</button>' +
      '</fieldset>';

    wrap.querySelector("#cs-reset-btn").addEventListener("click", resetSC);
  }

  /* =========================================================================
     KUNDAR — Fase 9: semi-automatisert onboarding-sjekkliste (narrow scope)
     -----------------------------------------------------------------------
     Ingen kunde registrert her kan setjast 'active' før den ekte
     hostname-ruteren (Fase 6) finst — activate_tenant i tenant-admin
     Edge Function-en avviser ubetinga inntil routing_verified_at er sett,
     noko INGENTING i dagens kode set. Sjå Fase 9-designnotatet (Arkitekt,
     2026-07-08) for kvifor dette er strukturert slik.
     ====================================================================== */
  var _kdSelectedId = null;
  // Arkiverte kundar er "ferdige"/frosne (sjå archive_tenant) -- ingen vits i
  // å sjå dei blanda med aktive/provisioning i det daglege overblikket.
  // Skjult som standard, vist berre via avkryssingsboksen under.
  var _kdShowArchived = false;

  // Pille i staden for laus, farga tekst -- lesast raskare ved eit blikk
  // (stilrefresh 2026-08-04, same "status som farge+form"-idé som allereie
  // brukast for tags/badge-tekst andre stader i Console).
  var KD_STATUS_MAP = {
    provisioning: { label: "Etableres",  cls: "provisioning" },
    active:       { label: "Aktiv",      cls: "active" },
    suspended:    { label: "Suspendert", cls: "suspended" },
    archived:     { label: "Arkivert",   cls: "archived" }
  };
  function kdStatusBadge(status) {
    var s = KD_STATUS_MAP[status] || { label: status || "", cls: "archived" };
    return '<span class="kd-pill kd-pill--' + s.cls + '">' + C.esc(s.label) + '</span>';
  }
  // Initialar til rad-ikonet -- fyrste bokstav i dei to fyrste "orda" i
  // slug-en ("nordpunkt-regnskap" -> "NR"), elles berre dei to fyrste
  // teikna ("sunnvask" -> "SU").
  function kdInitials(slug) {
    var parts = (slug || "").split(/[-_.\s]+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  function renderKundar(_sc, wrap) {
    var selected = _tenants.filter(function (t) { return t.id === _kdSelectedId; })[0];
    var archivedCount = _tenants.filter(function (t) { return t.status === "archived"; }).length;
    var visible = _kdShowArchived ? _tenants : _tenants.filter(function (t) { return t.status !== "archived"; });

    wrap.innerHTML =
      '<div class="admin-group" style="margin-bottom:1.2rem">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.8rem">' +
          '<strong>Registrerte kundar</strong>' +
          '<button type="button" class="btn btn--primary btn--sm" id="kd-new-btn">+ Ny kunde</button>' +
        '</div>' +
        (archivedCount
          ? '<label style="display:flex;align-items:center;gap:.4rem;font-size:.85rem;color:var(--color-muted);margin-bottom:.6rem;cursor:pointer">' +
              '<input type="checkbox" id="kd-show-archived"' + (_kdShowArchived ? " checked" : "") + '> Vis arkiverte (' + archivedCount + ')' +
            '</label>'
          : "") +
        '<ul class="kd-list">' +
          visible.map(function (t) {
            var domain = (t.hostnames && t.hostnames.length) ? t.hostnames[0] : "ingen domene ennå";
            // "Valgt"-tilstand fanst ikkje i det heile før (stilrefresh
            // 2026-08-04) -- einaste måten å sjå kven som var vald var å
            // sjå etter sjekklista under lista.
            return '<li class="kd-row' + (t.id === _kdSelectedId ? " is-active" : "") + '" data-kd-row="' + C.esc(t.id) + '" tabindex="0" role="button" aria-pressed="' + (t.id === _kdSelectedId ? "true" : "false") + '">' +
              '<span class="kd-row__avatar' + (t.status === "archived" ? " is-archived" : "") + '">' + C.esc(kdInitials(t.slug)) + '</span>' +
              '<span class="kd-row__body"><span class="kd-row__name">' + C.esc(t.slug) + '</span><span class="kd-row__meta">' + C.esc(domain) + '</span></span>' +
              kdStatusBadge(t.status) +
            '</li>';
          }).join("") +
          (visible.length ? "" : '<li class="kd-row"><span style="color:var(--color-muted)">Ingen kundar registrert enno.</span></li>') +
        '</ul>' +
      '</div>' +
      '<div id="kd-new-form-wrap"></div>' +
      '<div id="kd-detail-wrap"></div>';

    // Tastatur-operabel liste (UX-review-funn 2026-08-04) -- fanst berre ein
    // click-lyttar frå før, som gjorde radvalet reint mus-/touch-avhengig.
    // Same mønster som .pkg-row i "Rediger pakker" (Enter/mellomrom = klikk).
    wrap.querySelectorAll("[data-kd-row]").forEach(function (row) {
      row.addEventListener("click", function () {
        _kdSelectedId = row.getAttribute("data-kd-row");
        renderKundar(_sc, wrap);
      });
      row.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        _kdSelectedId = row.getAttribute("data-kd-row");
        renderKundar(_sc, wrap);
      });
    });

    var showArchivedCb = wrap.querySelector("#kd-show-archived");
    if (showArchivedCb) {
      showArchivedCb.addEventListener("change", function () {
        _kdShowArchived = showArchivedCb.checked;
        renderKundar(_sc, wrap);
      });
    }

    wrap.querySelector("#kd-new-btn").addEventListener("click", function () {
      renderKdNewForm(wrap.querySelector("#kd-new-form-wrap"));
    });

    if (selected) renderKdDetail(selected, wrap.querySelector("#kd-detail-wrap"), wrap, _sc);
  }

  function renderKdNewForm(wrap) {
    if (wrap.innerHTML) { wrap.innerHTML = ""; return; } // toggle av/på
    wrap.innerHTML =
      '<div class="admin-group" style="margin-bottom:1.2rem">' +
        '<form id="kd-new-form">' +
          C.field({ id: "kd-slug", label: "Slug (unik, t.d. \"kundenamn\")", placeholder: "kundenamn" }) +
          C.field({ id: "kd-hostnames", label: "Domenenamn (kommaseparert)", placeholder: "kunde.no, www.kunde.no" }) +
          C.field({ id: "kd-storagekey", label: "Lagringsnøkkel (storageKey frå kundens config.js)", placeholder: "t.d. kundenamn" }) +
          '<p id="kd-new-err" style="font-size:.85rem;color:#c0392b;min-height:1.2em"></p>' +
          '<button type="submit" class="btn btn--primary">Registrer kunde</button>' +
        '</form>' +
      '</div>';
    wrap.querySelector("#kd-new-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var err = wrap.querySelector("#kd-new-err");
      var slug = wrap.querySelector("#kd-slug").value.trim();
      var storageKey = wrap.querySelector("#kd-storagekey").value.trim();
      var hostnames = wrap.querySelector("#kd-hostnames").value.split(",").map(function (h) { return h.trim(); }).filter(Boolean);
      if (!slug || !storageKey) { err.textContent = "Slug og lagringsnøkkel er påkrevd."; return; }
      err.textContent = "Registrerer…";
      tenantAdminCall("register_tenant", { slug: slug, hostnames: hostnames, data_plane_storage_key: storageKey }, function (r) {
        if (r.error) { err.textContent = r.error; return; }
        loadTenants(function () {
          _kdSelectedId = r.tenant_id;
          wrap.innerHTML = "";
          navigate("kundar");
        });
      });
    });
  }

  function renderKdDetail(tenant, wrap, fullWrap, _sc) {
    var hasConnection = !!(tenant.data_plane_url);
    var schemaOk = !!tenant.schema_verified_at;
    var routingOk = !!tenant.routing_verified_at;
    var hasHostnames = !!(tenant.hostnames && tenant.hostnames.length);
    var adminInvitedOk = !!tenant.first_admin_invited_at;
    var smtpOk = !!tenant.smtp_configured_at;

    wrap.innerHTML =
      '<div class="admin-group">' +
        '<h3 style="margin:0 0 .8rem">Sjekkliste: ' + C.esc(tenant.slug) + ' ' + kdStatusBadge(tenant.status) + '</h3>' +

        '<div class="kd-card"><strong>1. Registrert</strong> ✓' +
          (tenant.status !== "archived"
            ? '<form id="kd-slug-form" style="margin-top:.6rem">' +
                C.field({ id: "kd-slug-edit", label: "Slug", value: tenant.slug, placeholder: "kundenamn" }) +
                '<button type="submit" class="btn btn--ghost btn--sm">Lagre slug</button>' +
                '<p class="field__hint">Berre visningsnamn i Console — påverkar ikkje domene, ruting eller kundens eigen konfigurasjon.</p>' +
                '<p class="form__status" id="kd-slug-status" style="margin-top:.4rem"></p>' +
              '</form>'
            : '<p class="field__hint">Slug: ' + C.esc(tenant.slug) + ' (arkivert — kan ikkje endrast).</p>') +
          '<p class="field__hint">Lagringsnøkkel: ' + C.esc(tenant.data_plane_storage_key || "") + '.</p>' +
          (tenant.status === "provisioning" || tenant.status === "active"
            ? '<form id="kd-hostnames-form" style="margin-top:.6rem">' +
                C.field({ id: "kd-hostnames-edit", label: "Domenenamn (kommaseparert)", value: (tenant.hostnames || []).join(", "), placeholder: "kunde.no, www.kunde.no" }) +
                '<button type="submit" class="btn btn--ghost btn--sm">Lagre domenenamn</button>' +
                '<p class="field__hint">' + (tenant.status === "provisioning"
                  ? 'Endrar du domenenamn må steg 5 (skjema) og steg 9 (ruting) verifiserast på nytt før aktivering.'
                  : '⚠️ Kunden er aktiv — endring tek effekt UMIDDELBART på det livesida svarer på, utan ny verifisering. Sjekk at DNS/Vercel peikar rett FØR du lagrar.') + '</p>' +
                '<p class="form__status" id="kd-hostnames-status" style="margin-top:.4rem"></p>' +
              '</form>'
            : '<p class="field__hint">Domenenamn: ' + (hasHostnames ? C.esc(tenant.hostnames.join(", ")) : "ingen registrert") + ' (kan ikkje endrast i denne statusen).</p>'
          ) +
        '</div>' +

        '<div class="kd-card"><strong>2. Opprett Supabase-prosjekt</strong>' +
          '<p class="field__hint">Gjer dette manuelt via Supabase Dashboard/CLI (kan ikkje automatiserast trygt — sjå Fase 9-notatet). Kom tilbake hit når prosjektet finst.</p>' +
        '</div>' +

        '<div class="kd-card"><strong>3. Kopling og nøklar</strong> ' + (hasConnection && tenant.data_plane_service_role_secret_id ? "✓" : "—") +
          '<p class="field__hint">Lim inn berre prosjekt-URL-en og hent nøklane automatisk, ELLER lim inn alle tre sjølv under.</p>' +
          '<form id="kd-autofetch-form" style="margin-top:.6rem">' +
            C.field({ id: "kd-autofetch-url", label: "data_plane_url", value: tenant.data_plane_url || "", placeholder: "https://xxxx.supabase.co" }) +
            '<button type="submit" class="btn btn--ghost btn--sm">Hent nøklar automatisk</button>' +
            '<p class="form__status" id="kd-autofetch-status" style="margin-top:.4rem"></p>' +
          '</form>' +
          '<details style="margin-top:.6rem">' +
            '<summary style="cursor:pointer;font-size:.85rem;color:#2563eb">…eller lim inn nøklane manuelt</summary>' +
            '<form id="kd-conn-form" style="margin-top:.6rem">' +
              C.field({ id: "kd-url", label: "data_plane_url", value: tenant.data_plane_url || "", placeholder: "https://xxxx.supabase.co" }) +
              C.field({ id: "kd-anon", label: "data_plane_anon_key", value: tenant.data_plane_anon_key || "", placeholder: "eyJ…" }) +
              '<button type="submit" class="btn btn--ghost btn--sm">Lagre kopling</button>' +
              '<p class="form__status" id="kd-conn-status" style="margin-top:.4rem"></p>' +
            '</form>' +
            '<form id="kd-key-form" style="margin-top:.6rem">' +
              C.field({ id: "kd-srvkey", label: "service_role-nøkkel", type: "password", placeholder: "eyJ…" }) +
              '<button type="submit" class="btn btn--ghost btn--sm">Lagre nøkkel</button>' +
              '<p class="form__status" id="kd-key-status" style="margin-top:.4rem"></p>' +
            '</form>' +
          '</details>' +
        '</div>' +

        '<div class="kd-card"><strong>4. Køyr migrasjonar</strong>' +
          '<p class="field__hint">Køyr migrasjonane manuelt mot det nye prosjektet (<code>npx supabase db push --db-url …</code>) — dette gir kunden heile databaseskjemaet (tabellar, RLS, funksjonar).</p>' +
          '<details style="margin:.4rem 0">' +
            '<summary style="cursor:pointer;font-size:.85rem;color:#2563eb">Generer kommandoen frå tilkoplingsstrengen</summary>' +
            '<div style="margin-top:.5rem">' +
              C.field({ id: "kd-migrate-connstr", label: "Lim inn tilkoplingsstrengen frå Supabase Dashboard (Session pooler, med passord)", type: "password", placeholder: "postgresql://postgres.xxxx:PASSORD@aws-0-region.pooler.supabase.com:5432/postgres" }) +
              '<button type="button" class="btn btn--ghost btn--sm" id="kd-migrate-gen-btn">Generer kommando</button>' +
              '<p class="field__hint" style="font-size:.75rem">Vert ALDRI sendt nokon stad — berre brukt lokalt i nettlesaren til å byggje kommandoen (URL-kodar passordet riktig for deg).</p>' +
              '<pre id="kd-migrate-cmd" style="white-space:pre-wrap;word-break:break-all;background:#f1f5f9;padding:.6rem;border-radius:6px;font-size:.8rem;margin-top:.5rem;display:none"></pre>' +
            '</div>' +
          '</details>' +
        '</div>' +

        '<div class="kd-card"><strong>5. Verifiser skjema</strong> ' + (schemaOk ? "✓" : "—") +
          '<p class="field__hint">Sjekk at migrasjonane i steg 4 faktisk gjekk gjennom (tabellar finst, RLS er på) — ikkje berre stol på at kommandoen ikkje viste feil.</p>' +
          '<button type="button" class="btn btn--ghost btn--sm" id="kd-verify-btn">Verifiser skjema</button>' +
          '<p id="kd-verify-result" class="field__hint"></p>' +
        '</div>' +

        '<div class="kd-card"><strong>6. Deploy Edge Functions</strong>' +
          '<p class="field__hint">Lett å gløyme — <code>db push</code> (steg 4) gir berre databaseskjemaet, IKKJE Edge Functions. Utan dette feilar Workspace sin eigen brukaradmin (manage-user) og chat/kontaktskjema-svar (send-reply) med ei uklar CORS-feil, ikkje ei tydeleg "ikkje deploya"-melding.</p>' +
          '<pre style="white-space:pre-wrap;word-break:break-all;background:#f1f5f9;padding:.6rem;border-radius:6px;font-size:.8rem">npx supabase functions deploy manage-user --project-ref &lt;ref&gt;\nnpx supabase functions deploy send-reply --project-ref &lt;ref&gt;</pre>' +
          '<p class="field__hint">send-reply treng i tillegg sin eigen <code>RESEND_API_KEY</code>-hemmelegheit (<code>npx supabase secrets set RESEND_API_KEY=... --project-ref &lt;ref&gt;</code>) — berre naudsynt om kunden skal bruke chat/kontaktskjema-svar, ikkje for vanleg innlogging/brukaradmin.</p>' +
        '</div>' +

        '<div class="kd-card"><strong>7. Set opp e-post (SMTP)</strong> ' + (smtpOk ? "✓" : "—") +
          '<p class="field__hint">Set opp e-postsending for denne kunden (delt Vibeverk-avsendar) slik at invitasjon/support-lenker faktisk kjem fram — utan dette er kunden avgrensa til 2 e-postar i timen frå Supabase sin standard-sendar.</p>' +
          '<button type="button" class="btn btn--ghost btn--sm" id="kd-smtp-btn">Set opp e-post</button>' +
          '<p id="kd-smtp-result" class="field__hint"></p>' +
        '</div>' +

        '<div class="kd-card"><strong>8. Set opp kundekonfigurasjon</strong>' +
          '<p class="field__hint">Firmanamn, farger/fontar, tekst (hero/om/kontakt/nyhende/tenester), personvernerklæring, web-admin-passord, modul-val — gjer dette i dei andre Console-fanene ("Produkt", "Web", "Workspace", "Modular", "Analyse", "Personvern"), ikkje her. Gjer dette FØR steg 10 (invitasjon) slik at den ekte kunde-adminen ser eit ferdig oppsett med det same, ikkje standardverdiar.</p>' +
        '</div>' +

        '<div class="kd-card"' + (schemaOk && hasHostnames ? "" : ' style="opacity:.6"') + '><strong>9. Peik hostname mot Vercel og verifiser ruting</strong> ' + (routingOk ? "✓" : "—") +
          '<p class="field__hint">Hostnames: ' + (hasHostnames ? C.esc(tenant.hostnames.join(", ")) : "ingen registrert") + '. Krev at DNS/Vercel-oppsettet for desse peikar hit FØR du trykkjer — sjekken gjer eit ekte HTTP-kall mot kvar hostname. Demo utan eige domene: legg til ein ledig <code>namn.vercel.app</code>-alias i Vercel-prosjektet. Ekte kunde med eige domene: dette er ein eigen, seinare, eksplisitt godkjend DNS-cutover — aldri bunta inn her.' +
            (tenant.status === "active" ? " Kan òg køyrast etter at kunden er aktiv, t.d. etter at DNS er flytta til ny leverandør — sjekken les berre av og påverkar ikkje den ekte trafikken." : "") +
          '</p>' +
          '<button type="button" class="btn btn--ghost btn--sm" id="kd-routing-btn"' + (schemaOk && hasHostnames ? "" : " disabled") + '>Verifiser ruting</button>' +
          '<p id="kd-routing-result" class="field__hint"></p>' +
        '</div>' +

        '<div class="kd-card"' + (schemaOk ? "" : ' style="opacity:.6"') + '><strong>10. Inviter admin-brukar</strong> ' + (adminInvitedOk ? "✓" : "—") +
          '<p class="field__hint">Sender ei ekte invitasjonslenke til kunden sin fyrste admin-brukar (dei set sjølv passord). Kan sendast fleire gongar (t.d. om e-posten ikkje kjem fram). Gjer steg 7 (e-post) og 8 (kundekonfigurasjon) fyrst.</p>' +
          '<form id="kd-invite-form" style="margin-top:.6rem">' +
            C.field({ id: "kd-invite-email", label: "E-post til fyrste admin", placeholder: "post@kunden.no" }) +
            '<button type="submit" class="btn btn--ghost btn--sm"' + (schemaOk ? "" : " disabled") + '>Send invitasjon</button>' +
            '<p class="form__status" id="kd-invite-status" style="margin-top:.4rem"></p>' +
          '</form>' +
        '</div>' +

        '<div class="kd-card">' +
          '<strong>11. Set aktiv</strong> — ' + (tenant.status === "active" ? "kunden er alt aktiv" : ((routingOk && adminInvitedOk && smtpOk) ? "klar" : "sperra (" + [!routingOk && "ruting ikkje verifisert", !adminInvitedOk && "ingen admin-brukar invitert", !smtpOk && "e-post ikkje sett opp"].filter(Boolean).join(", ") + " enno)")) +
          '<p class="field__hint">⚠️ Gjer kunden LIVE: nettsida/Workspace svarer no faktisk på domenenamna over, for alle besøkjande. Dette er det siste steget — dobbeltsjekk at alt over faktisk er korrekt fyrst.</p>' +
          '<div><button type="button" class="btn btn--primary btn--sm" id="kd-activate-btn"' + ((routingOk && adminInvitedOk && smtpOk) ? "" : " disabled") + '>Set aktiv</button></div>' +
          '<p id="kd-activate-result" class="field__hint"></p>' +
        '</div>' +

        '<div class="kd-card"><strong>Sidesperre for dette domenet</strong> — ' +
          (tenant.site_lock_enabled ? "PÅ (eige passord)" : (tenant.site_lock_ever_enabled ? "AV (heilt open)" : "aldri konfigurert (bruker delt utviklingssperre)")) +
          '<p class="field__hint">Eit eige passord berre for denne kunden sine domene. <strong>PÅ</strong> = domena krev dette passordet i staden for den delte utviklingssperra. <strong>AV</strong> (kun etter at sperra HAR vore PÅ minst éin gong) = domena er HEILT opne, ingen sperre i det heile, verken dette passordet eller den delte utviklingssperra. Har du berre lagra eit passord utan å krysse av «Sperre PÅ», gjeld framleis den delte utviklingssperra — passordet er lagra, men ingenting opnar seg. Nyttig når de utviklar saman med kunden og treng å vise fram noko utan at tilfeldige besøkjande ser det. Ikkje meint som sterk tryggleik — ingen avgrensing på talet på forsøk.</p>' +
          (tenant.status === "active"
            ? '<p class="field__hint">⚠️ Kunden er aktiv — lagrar du med sperra PÅ, vert ekte besøkjande blokkerte frå den livesida UMIDDELBART. Har sperra vore PÅ før og du no lagrar med han AV, vert domena HEILT opne for alle UMIDDELBART (også forbi den delte utviklingssperra). Sjekk at det er tilsikta før du lagrar.</p>'
            : '') +
          (tenant.status === "provisioning" || tenant.status === "active"
            ? '<form id="kd-sitelock-form" style="margin-top:.6rem">' +
                C.field({ id: "kd-sitelock-password", label: "Nytt passord (la stå tomt for å behalde noverande)", type: "password", placeholder: "minst 4 teikn" }) +
                '<label style="display:flex;align-items:center;gap:.4rem;margin:.6rem 0"><input type="checkbox" id="kd-sitelock-enabled"' + (tenant.site_lock_enabled ? " checked" : "") + '> Sperre PÅ (av, etter fyrste gong PÅ = domena vert heilt opne)</label>' +
                '<button type="submit" class="btn btn--ghost btn--sm">Lagre sidesperre</button>' +
                '<p class="field__hint">' + (tenant.site_lock_updated_at ? "Sist endra: " + C.esc(new Date(tenant.site_lock_updated_at).toLocaleString("nb-NO")) : "Ingen sperre sett enno — domena bruker den delte utviklingssperra.") + '</p>' +
                '<p class="form__status" id="kd-sitelock-status" style="margin-top:.4rem"></p>' +
              '</form>'
            : '<p class="field__hint">Kan ikkje endrast i denne statusen.</p>'
          ) +
        '</div>' +

        (tenant.status !== "archived"
          ? '<div class="kd-card"><strong>Support-tilgang</strong>' +
              '<p class="field__hint">Lagar ei mellombels innloggingslenke for ein eksisterande admin-brukar, slik at du kan hjelpe kunden direkte utan å kjenne passordet deira. Lenka går berre til DEG (ikkje til kunden) og går ut av seg sjølv. Kunden ser ei tydeleg melding i Workspace mens ho er i bruk.</p>' +
              '<form id="kd-support-form" style="margin-top:.6rem">' +
                C.field({ id: "kd-support-email", label: "E-post til admin-brukaren", placeholder: "post@kunden.no" }) +
                '<button type="submit" class="btn btn--ghost btn--sm">Lag support-lenke</button>' +
                '<p class="form__status" id="kd-support-status" style="margin-top:.4rem;word-break:break-all"></p>' +
              '</form>' +
            '</div>'
          : '') +

        (tenant.status !== "archived"
          ? '<div class="kd-card" style="border-color:#c0392b">' +
              '<strong style="color:#c0392b">Fareområde</strong>' +
              '<p class="field__hint">Arkivering gjer kunden IKKJE lenger tilgjengeleg på domena sine, umiddelbart. Kunden sitt eige Supabase-prosjekt (og alt innhaldet der) vert IKKJE sletta eller påverka — berre denne registreringa i Console vert markert arkivert. Det finst i dag ingen måte å oppheve dette på i Console.</p>' +
              '<button type="button" class="btn btn--ghost btn--sm" id="kd-archive-btn" style="color:#c0392b;border-color:#c0392b">Arkiver kunde</button>' +
              '<p id="kd-archive-result" class="field__hint"></p>' +
            '</div>'
          : '') +
      '</div>';

    var slugForm = wrap.querySelector("#kd-slug-form");
    if (slugForm) {
      slugForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var slug = wrap.querySelector("#kd-slug-edit").value.trim().toLowerCase();
        tenantAdminCall("update_tenant_slug", { tenant_id: tenant.id, slug: slug }, function (r) {
          if (r.error) { statusMsg(wrap.querySelector("#kd-slug-status"), r.error, false); return; }
          loadTenants(function () { renderKundar(_sc, fullWrap); });
        });
      });
    }

    var hostnamesForm = wrap.querySelector("#kd-hostnames-form");
    if (hostnamesForm) {
      hostnamesForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var hostnames = wrap.querySelector("#kd-hostnames-edit").value.split(",").map(function (h) { return h.trim(); }).filter(Boolean);
        tenantAdminCall("update_tenant_hostnames", { tenant_id: tenant.id, hostnames: hostnames }, function (r) {
          if (r.error) { statusMsg(wrap.querySelector("#kd-hostnames-status"), r.error, false); return; }
          loadTenants(function () { renderKundar(_sc, fullWrap); });
        });
      });
    }

    wrap.querySelector("#kd-autofetch-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var url = wrap.querySelector("#kd-autofetch-url").value.trim();
      var out = wrap.querySelector("#kd-autofetch-status");
      if (!url) { statusMsg(out, "data_plane_url er påkrevd", false); return; }
      statusMsg(out, "Hentar…", true);
      tenantAdminCall("fetch_tenant_project_keys", { tenant_id: tenant.id, data_plane_url: url }, function (r) {
        statusMsg(out, r.error || "✓ Kopling og service_role-nøkkel henta og lagra", !r.error);
        if (!r.error) loadTenants(function () { renderKundar(_sc, fullWrap); });
      });
    });

    var migrateGenBtn = wrap.querySelector("#kd-migrate-gen-btn");
    if (migrateGenBtn) {
      migrateGenBtn.addEventListener("click", function () {
        var raw = wrap.querySelector("#kd-migrate-connstr").value.trim();
        var out = wrap.querySelector("#kd-migrate-cmd");
        var m = raw.match(/^(postgresql:\/\/[^:]+:)([^@]+)(@.+)$/);
        out.style.display = "block";
        if (!m) {
          out.textContent = "Kjente ikkje igjen formatet — lim inn heile tilkoplingsstrengen Supabase viser deg (Session pooler).";
          return;
        }
        out.textContent = 'npx supabase db push --db-url "' + m[1] + encodeURIComponent(m[2]) + m[3] + '"';
      });
    }

    wrap.querySelector("#kd-conn-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var url = wrap.querySelector("#kd-url").value.trim();
      var anon = wrap.querySelector("#kd-anon").value.trim();
      tenantAdminCall("update_tenant_connection", { tenant_id: tenant.id, data_plane_url: url, data_plane_anon_key: anon }, function (r) {
        if (r.error) { statusMsg(wrap.querySelector("#kd-conn-status"), r.error, false); return; }
        loadTenants(function () { renderKundar(_sc, fullWrap); });
      });
    });

    wrap.querySelector("#kd-key-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var keyInp = wrap.querySelector("#kd-srvkey");
      var key = keyInp.value;
      if (!key) return;
      tenantAdminCall("set_tenant_service_role_key", { tenant_id: tenant.id, service_role_key: key }, function (r) {
        keyInp.value = "";
        statusMsg(wrap.querySelector("#kd-key-status"), r.error || "✓ Lagra", !r.error);
      });
    });

    wrap.querySelector("#kd-verify-btn").addEventListener("click", function () {
      var out = wrap.querySelector("#kd-verify-result");
      out.textContent = "Sjekkar…";
      tenantAdminCall("verify_tenant_schema", { tenant_id: tenant.id }, function (r) {
        if (r.error) { out.textContent = r.error; return; }
        if (r.schema_ok) {
          out.textContent = "✓ Skjema OK (tabellar finst, RLS på)";
        } else {
          var parts = [];
          if (r.missing_tables && r.missing_tables.length) parts.push("manglar tabellar: " + r.missing_tables.join(", "));
          if (r.rls_missing && r.rls_missing.length) parts.push("RLS ikkje påslege: " + r.rls_missing.join(", "));
          out.textContent = parts.join(" | ") || "Skjema-sjekk feila";
        }
        // Refresh so step 5's button unlocks immediately once schema_ok,
        // instead of requiring a manual reload to see the new state.
        loadTenants(function () { renderKundar(_sc, fullWrap); });
      });
    });

    wrap.querySelector("#kd-smtp-btn").addEventListener("click", function () {
      var out = wrap.querySelector("#kd-smtp-result");
      out.textContent = "Set opp…";
      tenantAdminCall("configure_tenant_smtp", { tenant_id: tenant.id }, function (r) {
        statusMsg(out, r.error || "✓ E-post sett opp", !r.error);
        if (!r.error) loadTenants(function () { renderKundar(_sc, fullWrap); });
      });
    });

    var inviteForm = wrap.querySelector("#kd-invite-form");
    if (inviteForm) {
      inviteForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var email = wrap.querySelector("#kd-invite-email").value.trim().toLowerCase();
        var out = wrap.querySelector("#kd-invite-status");
        out.textContent = "Sender…";
        tenantAdminCall("invite_tenant_admin", { tenant_id: tenant.id, email: email }, function (r) {
          statusMsg(out, r.error || "✓ Invitasjon sendt til " + email, !r.error);
          if (!r.error) loadTenants(function () { renderKundar(_sc, fullWrap); });
        });
      });
    }

    var supportForm = wrap.querySelector("#kd-support-form");
    if (supportForm) {
      supportForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var email = wrap.querySelector("#kd-support-email").value.trim().toLowerCase();
        var out = wrap.querySelector("#kd-support-status");
        out.textContent = "Lagar lenke…";
        tenantAdminCall("generate_support_access", { tenant_id: tenant.id, email: email }, function (r) {
          if (r.error) { statusMsg(out, r.error, false); return; }
          out.innerHTML = "✓ <a href=\"" + C.esc(r.action_link) + "\" target=\"_blank\" rel=\"noopener\">Opne support-økt</a> (bruk snart — lenka går ut av seg sjølv)";
        });
      });
    }

    wrap.querySelector("#kd-routing-btn").addEventListener("click", function () {
      var out = wrap.querySelector("#kd-routing-result");
      out.textContent = "Sjekkar (ekte HTTP-kall mot kvar hostname, kan ta nokre sekund)…";
      tenantAdminCall("verify_tenant_routing", { tenant_id: tenant.id }, function (r) {
        if (r.error) { out.textContent = r.error; return; }
        if (r.routing_ok) {
          out.textContent = "✓ Ruting verifisert for alle hostnames";
        } else {
          out.textContent = (r.results || []).map(function (row) {
            return row.hostname + ": " + (row.ok ? "OK" : (row.detail || "feila"));
          }).join(" | ");
        }
        loadTenants(function () { renderKundar(_sc, fullWrap); });
      });
    });

    wrap.querySelector("#kd-activate-btn").addEventListener("click", function () {
      var out = wrap.querySelector("#kd-activate-result");
      out.textContent = "…";
      tenantAdminCall("activate_tenant", { tenant_id: tenant.id }, function (r) {
        out.textContent = r.error || "✓ Aktivert";
        if (!r.error) loadTenants(function () { renderKundar(_sc, fullWrap); });
      });
    });

    var sitelockForm = wrap.querySelector("#kd-sitelock-form");
    if (sitelockForm) {
      sitelockForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var password = wrap.querySelector("#kd-sitelock-password").value;
        var enabled = wrap.querySelector("#kd-sitelock-enabled").checked;
        var out = wrap.querySelector("#kd-sitelock-status");
        var payload = { tenant_id: tenant.id, enabled: enabled };
        if (password) payload.password = password;
        statusMsg(out, "Lagrar…", true);
        tenantAdminCall("set_tenant_site_lock", payload, function (r) {
          if (r.error) { statusMsg(out, r.error, false); return; }
          statusMsg(out, "✓ Lagra", true);
          loadTenants(function () { renderKundar(_sc, fullWrap); });
        });
      });
    }

    var archiveBtn = wrap.querySelector("#kd-archive-btn");
    if (archiveBtn) {
      archiveBtn.addEventListener("click", function () {
        if (!confirm("Arkivere «" + tenant.slug + "»? Kunden sluttar UMIDDELBART å svare på domenenamna sine (nettside og Workspace vert utilgjengeleg for besøkjande). Kunden sitt eige Supabase-prosjekt vert IKKJE sletta eller påverka. Det finst i dag ingen måte å oppheve arkivering på i Console — ta kontakt med utviklar om dette må reverserast. Er du sikker?")) return;
        var out = wrap.querySelector("#kd-archive-result");
        out.textContent = "…";
        tenantAdminCall("archive_tenant", { tenant_id: tenant.id }, function (r) {
          out.textContent = r.error || "✓ Arkivert";
          if (!r.error) loadTenants(function () { renderKundar(_sc, fullWrap); });
        });
      });
    }
  }

  /* =========================================================================
     COMPLIANCE (Bolk 3/4, 2026-08-12) -- reint Vibeverk-internt, IKKJE
     tenant-skopa (same "internt"-nav-gruppe som Priser/Kundeanalyse/Læring,
     sjå NAV_ITEMS). To sjølvstendige register i separate tabellar
     (compliance_record/vendor_registry, migrasjon 20260812170000):
     - Behandlingsprotokoll (GDPR art. 30) -- KUN for Vibeverk AS sjølv,
       ALDRI ein per-kunde-funksjon (eksplisitt brukarvedtak). Ingen
       versjonering/godkjenning-ceremoni, ulikt det kundevendte Personvern-
       dokumentet -- rein direkte redigering, éi rad per behandlingsaktivitet.
     - Leverandør-/DPA-register -- SAMA globale sanning som VIBEVERK_VENDORS
       (console-core.js, Personvern-modulen) hadde som hardkoda JS-konstant,
       no flytta til database og gjort redigerbar. VIBEVERK_VENDORS SJØLV ER
       IKKJE RØRT ENNO -- Personvern-fana sin eigen Leverandørar-tab (kunde-
       vendt tekstgenerering) les framleis frå den gamle konstanten, med
       vilje isolert frå dette nye registeret til det er operatør-verifisert
       (Arkitekten sin fase 4/"Bolk 5", eit seinare steg).
     Lesing: direkte mot _sbControl (same mønster som pricing_config/
     tenants/operators). Skriving: tenant-admin sine set_compliance_record/
     set_vendor-handlingar (superadmin-gata, auditert til broker_audit_log
     med tenant_id=NULL).
     ====================================================================== */
  var _complianceData = null;    // { records: [...], vendors: [...] } -- null til fyrste lasting er ferdig
  var _complianceLoading = false;
  var _complianceView = "protokoll"; // "protokoll" | "leverandorar"
  var COMPLIANCE_COUNTRY_LABEL = { eu: "EU/EØS", us: "USA" };
  var COMPLIANCE_TRANSFER_LABEL = { none: "Ikkje relevant (ingen overføring ut av EU/EØS)", scc: "EUs standardavtaler (SCC)", scc_or_dpf: "SCC og/eller DPF" };
  var COMPLIANCE_DPA_STATUS_OPTIONS = [
    ["tba", "TBA — Vibeverk AS ikkje stifta enno"],
    ["unconfirmed", "Ikkje stadfesta"],
    ["likely_confirmed", "Truleg alt i kraft"],
    ["confirmed", "Stadfesta"]
  ];
  var COMPLIANCE_RECORD_FIELDS = [
    ["formaal", "Formål"],
    ["kategori_registrerte", "Kategori registrerte (t.d. besøkjande, tilsette)"],
    ["kategori_data", "Kategori personopplysningar"],
    ["behandlingsgrunnlag", "Behandlingsgrunnlag"],
    ["mottakere", "Mottakarar"],
    ["lagringstid", "Lagringstid"],
    ["sikkerhetstiltak", "Sikkerheitstiltak"]
  ];

  // Standardforslag (2026-08-12, brukarønske): Vibeverk AS sitt EIGE utkast
  // til behandlingsprotokoll, grunngjeve i det som faktisk er stadfesta om
  // eigen arkitektur/leverandørar gjennom heile denne økta (docs/compliance/
  // data-map-vibeverk.md, VIBEVERK_VENDORS, dei faktiske modulane). Same
  // fråskriving som resten av "Standardforslag"-mønsteret i denne fila --
  // eit utgangspunkt, ikkje juridisk kvalitetssikra åleine. Konkrete
  // lagringstider er forretningsskjøn (same fråskriving som del B i
  // docs/compliance/personvern-rammeverk-status-2026-08-12.md), ikkje
  // stadfesta juridisk minimum.
  var COMPLIANCE_STANDARD_SUGGESTIONS = {
    kontakt: {
      formaal: "Besvare henvendelser fra besøkende på vibeverk.no som tar kontakt via kontaktskjemaet.",
      kategori_registrerte: "Besøkende på vibeverk.no som sender en henvendelse.",
      kategori_data: "Navn, e-postadresse, telefonnummer (hvis oppgitt), innholdet i meldingen.",
      behandlingsgrunnlag: "Berettiget interesse i å kunne besvare henvendelser rettet til oss (GDPR art. 6(1)(f)), evt. tiltak før avtaleinngåelse (art. 6(1)(b)) dersom henvendelsen gjelder et konkret oppdrag.",
      mottakere: "Ingen eksterne mottakere. Lagres hos Supabase (databehandler, EU).",
      lagringstid: "Inntil 12 måneder etter siste aktivitet, med mindre kundeforhold etableres.",
      sikkerhetstiltak: "Tilgang begrenset til autoriserte Vibeverk-ansatte via rollestyrt pålogging (RLS). Data overføres kryptert (TLS)."
    },
    tilbud: {
      formaal: "Utarbeide og sende tilbud til potensielle kunder som ber om det via vibeverk.no.",
      kategori_registrerte: "Potensielle kunder som ber om tilbud.",
      kategori_data: "Navn, e-postadresse, telefonnummer, beskrivelse av forespørselen, eventuelle vedlegg.",
      behandlingsgrunnlag: "Tiltak før avtaleinngåelse (GDPR art. 6(1)(b)).",
      mottakere: "Ingen eksterne mottakere. Lagres hos Supabase (databehandler, EU).",
      lagringstid: "Inntil 12 måneder etter at tilbudet er avsluttet/utgått, med mindre kundeforhold etableres.",
      sikkerhetstiltak: "Tilgang begrenset til autoriserte Vibeverk-ansatte. Vedlegg lagres i tilgangskontrollert Storage med signerte URL-er."
    },
    booking: {
      formaal: "Gjennomføre avtalte møter/timer bestilt via vibeverk.no.",
      kategori_registrerte: "Personer som bestiller en time/møte.",
      kategori_data: "Navn, e-postadresse, telefonnummer, valgt tidspunkt, eventuell melding.",
      behandlingsgrunnlag: "Oppfyllelse av avtale (GDPR art. 6(1)(b)).",
      mottakere: "Ingen eksterne mottakere. Lagres hos Supabase (databehandler, EU).",
      lagringstid: "Inntil 12-24 måneder etter avtalt dato.",
      sikkerhetstiltak: "Tilgang begrenset til autoriserte Vibeverk-ansatte via rollestyrt pålogging (RLS)."
    },
    chat: {
      formaal: "Besvare henvendelser fra besøkende via chat-funksjonen på vibeverk.no.",
      kategori_registrerte: "Besøkende som starter en chat-samtale.",
      kategori_data: "Navn og e-postadresse (hvis oppgitt), meldingsinnhold, side/henvisning, grunnleggende nettlesertekniske opplysninger.",
      behandlingsgrunnlag: "Berettiget interesse i å kunne besvare henvendelsen (GDPR art. 6(1)(f)).",
      mottakere: "Ingen eksterne mottakere. Lagres hos Supabase (databehandler, EU).",
      lagringstid: "Inntil 6-12 måneder etter siste melding i samtalen.",
      sikkerhetstiltak: "Tilgang begrenset til autoriserte Vibeverk-ansatte via rollestyrt pålogging (RLS)."
    },
    crm: {
      formaal: "Administrere løpende kunde- og samarbeidsrelasjoner (kontaktinformasjon, kommunikasjonshistorikk).",
      kategori_registrerte: "Kontaktpersoner hos kunder og samarbeidspartnere.",
      kategori_data: "Navn, e-postadresse, telefonnummer, tittel/rolle, kommunikasjonslogg (e-post/notater).",
      behandlingsgrunnlag: "Berettiget interesse i å administrere pågående forretningsforhold (GDPR art. 6(1)(f)), evt. oppfyllelse av avtale (art. 6(1)(b)).",
      mottakere: "Ingen eksterne mottakere. Lagres hos Supabase (databehandler, EU).",
      lagringstid: "Så lenge kundeforholdet er aktivt, og inntil 24 måneder etter siste aktivitet.",
      sikkerhetstiltak: "Tilgang begrenset til autoriserte Vibeverk-ansatte via rollestyrt pålogging (Workspace)."
    },
    ansatte: {
      formaal: "Administrere arbeidsforholdet og gi tilgang til interne arbeidsverktøy (Workspace).",
      kategori_registrerte: "Ansatte i Vibeverk.",
      kategori_data: "Navn, e-postadresse, rolle/tilgangsnivå, aktivitet i Workspace (oppgaver, notater, kunnskapsbase).",
      behandlingsgrunnlag: "Nødvendig for å oppfylle arbeidsavtalen og berettiget interesse i å drifte virksomheten (GDPR art. 6(1)(b) og (f)).",
      mottakere: "Ingen eksterne mottakere. Lagres hos Supabase (databehandler, EU).",
      lagringstid: "Så lenge arbeidsforholdet varer. Fjernes normalt ved avslutning av arbeidsforholdet.",
      sikkerhetstiltak: "Rollestyrt tilgang (admin/editor/member), autentisering via Supabase Auth."
    },
    sidetelling: {
      formaal: "Intern trafikkstatistikk for vibeverk.no (sidevisninger, henvisninger).",
      kategori_registrerte: "Besøkende på vibeverk.no.",
      kategori_data: "Pseudonymisert, daglig rotert hash av IP-adresse/nettleserinformasjon/domene -- ingen rå IP-adresse eller direkte identifiserbare opplysninger lagres.",
      behandlingsgrunnlag: "Berettiget interesse i å forstå trafikk til egen nettside (GDPR art. 6(1)(f)) -- endelig vurdering under arbeid, se docs/architecture/sidetelling.md.",
      mottakere: "Ingen eksterne mottakere. Lagres hos Supabase (databehandler, EU).",
      lagringstid: "Hash roteres daglig -- ingen rå identifiserende data lagres over tid.",
      sikkerhetstiltak: "Ingen cookies eller nettleserlagring brukt. Hash-basert pseudonymisering utført på server."
    },
    ai: {
      formaal: "AI-baserte forslag (Oversikt, Smart årshjul) til intern bruk i Workspace -- fortsatt i trial-fase, ikke tilbudt kunder.",
      kategori_registrerte: "Ansatte i Vibeverk som bruker modulene.",
      kategori_data: "Tekst/innhold ansatte selv skriver inn som grunnlag for AI-forslaget.",
      behandlingsgrunnlag: "Berettiget interesse i å teste og forbedre interne arbeidsverktøy (GDPR art. 6(1)(f)).",
      mottakere: "Anthropic (databehandler for AI-modellkall) -- DPA-status ikke avklart, se Leverandørar-fana. Kun trial-fase.",
      lagringstid: "Så lenge modulen er i aktiv bruk/trial.",
      sikkerhetstiltak: "Tilgang begrenset til autoriserte Vibeverk-ansatte via rollestyrt pålogging (Workspace)."
    }
  };

  function complianceLoad(wrap) {
    if (_complianceLoading) return;
    _complianceLoading = true;
    Promise.all([
      _sbControl.from("compliance_record").select("*").order("id"),
      _sbControl.from("vendor_registry").select("*").order("sort_order")
    ]).then(function (results) {
      _complianceLoading = false;
      var recordsRes = results[0], vendorsRes = results[1];
      var err = recordsRes.error || vendorsRes.error;
      if (err) {
        wrap.innerHTML = '<p style="color:#c0392b">Kunne ikkje laste Compliance-data: ' + C.esc(err.message) + '</p>' +
          C.button({ label: "Prøv igjen", variant: "ghost", attrs: 'type="button" id="compliance-retry"' });
        var retryBtn = wrap.querySelector("#compliance-retry");
        if (retryBtn) retryBtn.addEventListener("click", function () { complianceLoad(wrap); });
        return;
      }
      _complianceData = { records: recordsRes.data || [], vendors: vendorsRes.data || [] };
      renderCompliance(null, wrap);
    });
  }

  function renderCompliance(_sc, wrap) {
    if (!_complianceData) {
      wrap.innerHTML = '<p style="color:var(--color-muted)">Lastar …</p>';
      complianceLoad(wrap);
      return;
    }
    var views = [["protokoll", "Behandlingsprotokoll"], ["leverandorar", "Leverandørar"]];
    wrap.innerHTML =
      '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 1rem">Reint internt for Vibeverk AS — aldri publisert, aldri kundevendt. Sjå <code>docs/compliance/personvern-rammeverk-status-2026-08-12.md</code>.</p>' +
      '<div class="seg" id="compliance-view-toggle" style="margin-bottom:1.4rem">' +
        views.map(function (v) {
          return '<button type="button" class="' + (v[0] === _complianceView ? "is-active" : "") + '" data-compliance-view="' + v[0] + '">' + C.esc(v[1]) + '</button>';
        }).join("") +
      '</div>' +
      '<div id="compliance-pane"></div>';
    wrap.querySelectorAll("[data-compliance-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        _complianceView = btn.getAttribute("data-compliance-view");
        renderCompliance(null, wrap);
      });
    });
    var pane = wrap.querySelector("#compliance-pane");
    if (_complianceView === "protokoll") renderComplianceProtokoll(pane);
    else renderComplianceLeverandorar(pane);
  }

  // Genererer éin samanhengande tekstversjon av heile behandlingsprotokollen
  // frå DEI FAKTISKE FELTVERDIANE I DOM-EN (skrivne-men-ikkje-lagra endringar
  // tekne med, same "les live, ikkje sist lagra"-prinsipp som Personvern sin
  // eigen fulltekst-knapp).
  function complianceProtokollFullText(pane) {
    return _complianceData.records.map(function (rec) {
      var lines = [rec.label];
      COMPLIANCE_RECORD_FIELDS.forEach(function (f) {
        var el = pane.querySelector("#cr-" + rec.id + "-" + f[0]);
        var v = (el ? el.value : (rec[f[0]] || "")).trim();
        lines.push(f[1] + ": " + (v || "(ikkje fylt ut)"));
      });
      return lines.join("\n");
    }).join("\n\n" + "—".repeat(3) + "\n\n");
  }

  // Lagrar éin behandlingsaktivitet -- feltverdiane vert lest frå DOM-en, ikkje
  // sende inn som argument, sidan både enkelt-Lagre-knappen og "Lagre alle"
  // skal lese akkurat det som faktisk står i felta no. cb(errorOrNull).
  function saveComplianceRecord(pane, id, cb) {
    var payload = { id: id };
    COMPLIANCE_RECORD_FIELDS.forEach(function (f) {
      payload[f[0]] = pane.querySelector("#cr-" + id + "-" + f[0]).value;
    });
    tenantAdminCall("set_compliance_record", payload, function (r) {
      if (!r.error) {
        var rec = _complianceData.records.filter(function (x) { return x.id === id; })[0];
        if (rec) COMPLIANCE_RECORD_FIELDS.forEach(function (f) { rec[f[0]] = payload[f[0]]; });
      }
      cb(r.error || null);
    });
  }

  function renderComplianceProtokoll(pane) {
    // <details>/<summary> (brukarønske 2026-08-12: "gardinmeny" per seksjon)
    // -- same native kollaps-mønster som alt brukast andre stader i Console
    // (t.d. AI Lab sin rå-JSON-visning, Kundar sitt manuelle nøkkel-felt).
    // Alle startar LUKKA -- 8 rader × 7 tekstfelt kvar er mykje loddrett plass
    // om alt er opna samstundes.
    pane.innerHTML =
      '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1rem">' +
        C.button({ label: "Standardforslag", variant: "ghost", attrs: 'type="button" id="cp-standard"' }) +
        C.button({ label: "Lagre alle", variant: "primary", attrs: 'type="button" id="cp-save-all"' }) +
        C.button({ label: "Generer full tekstversjon", variant: "ghost", attrs: 'type="button" id="cp-fulltext"' }) +
      '</div>' +
      '<p class="form__status" id="cp-bulk-status" style="margin:0 0 .8rem"></p>' +
      _complianceData.records.map(function (rec) {
        return '<details class="admin-group" style="margin-bottom:.8rem" data-compliance-record="' + C.esc(rec.id) + '">' +
          '<summary style="cursor:pointer;font-weight:700;font-size:.95rem">' + C.esc(rec.label) + '</summary>' +
          COMPLIANCE_RECORD_FIELDS.map(function (f) {
            return C.field({ id: "cr-" + rec.id + "-" + f[0], label: f[1], multiline: true, rows: 2, value: rec[f[0]] || "" });
          }).join("") +
          C.button({ label: "Lagre", variant: "primary", attrs: 'type="button" class="compliance-record-save" data-id="' + C.esc(rec.id) + '"' }) +
          '<span class="cs-status" data-compliance-record-status="' + C.esc(rec.id) + '"></span>' +
        '</details>';
      }).join("");

    pane.querySelectorAll(".compliance-record-save").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        var statusEl = pane.querySelector('[data-compliance-record-status="' + id + '"]');
        btn.disabled = true;
        statusMsg(statusEl, "Lagrar…", true);
        saveComplianceRecord(pane, id, function (err) {
          btn.disabled = false;
          statusMsg(statusEl, err ? err : "✓ Lagra", !err);
        });
      });
    });

    // Standardforslag (brukarønske 2026-08-12): fyller INN I FELTA (lagrar
    // ikkje automatisk -- operatøren stadfestar med Lagre/Lagre alle, same
    // "utgangspunkt, ikkje automatisk skriving"-prinsipp som resten av
    // Standardforslag-mønsteret i denne fila). Åtvarar FØR overskriving viss
    // noko alt er fylt ut, same mønster som den kundevendte Standardforslag-
    // knappen i Personvern-fana.
    pane.querySelector("#cp-standard").addEventListener("click", function () {
      var hasContent = _complianceData.records.some(function (rec) {
        return COMPLIANCE_RECORD_FIELDS.some(function (f) {
          return (pane.querySelector("#cr-" + rec.id + "-" + f[0]).value || "").trim();
        });
      });
      if (hasContent && !confirm("Dette fyller inn standardforslag i alle felt som har innhald frå før, og overskriv det som står der. Ingenting vert lagra automatisk -- du må framleis trykke Lagre/Lagre alle. Fortsette?")) return;
      _complianceData.records.forEach(function (rec) {
        var suggestion = COMPLIANCE_STANDARD_SUGGESTIONS[rec.id];
        if (!suggestion) return;
        COMPLIANCE_RECORD_FIELDS.forEach(function (f) {
          var el = pane.querySelector("#cr-" + rec.id + "-" + f[0]);
          if (el) el.value = suggestion[f[0]] || "";
        });
      });
      statusMsg(pane.querySelector("#cp-bulk-status"), "Standardforslag fylt inn -- hugs å trykke «Lagre alle» for å lagre.", true);
    });

    pane.querySelector("#cp-save-all").addEventListener("click", function () {
      var btn = pane.querySelector("#cp-save-all");
      var statusEl = pane.querySelector("#cp-bulk-status");
      btn.disabled = true;
      statusMsg(statusEl, "Lagrar alle …", true);
      var ids = _complianceData.records.map(function (rec) { return rec.id; });
      var errors = [];
      var remaining = ids.length;
      ids.forEach(function (id) {
        saveComplianceRecord(pane, id, function (err) {
          if (err) errors.push(rec_label(id) + ": " + err);
          remaining--;
          if (remaining === 0) {
            btn.disabled = false;
            statusMsg(statusEl, errors.length ? ("Lagra med feil -- " + errors.join("; ")) : "✓ Alle " + ids.length + " aktivitetar lagra", !errors.length);
          }
        });
      });
      function rec_label(id) { var r = _complianceData.records.filter(function (x) { return x.id === id; })[0]; return r ? r.label : id; }
    });

    pane.querySelector("#cp-fulltext").addEventListener("click", function () {
      showTextPreviewModal("Behandlingsprotokoll — full tekst", complianceProtokollFullText(pane), false);
    });
  }

  function renderComplianceLeverandorar(pane) {
    // Same <details>/<summary>-kollaps som renderComplianceProtokoll() over.
    pane.innerHTML = _complianceData.vendors.map(function (v) {
      return '<details class="admin-group" style="margin-bottom:.8rem" data-compliance-vendor="' + C.esc(v.id) + '">' +
        '<summary style="cursor:pointer;font-weight:700;font-size:.95rem">' + C.esc(v.name) + '</summary>' +
        C.field({ id: "cv-" + v.id + "-name", label: "Namn", value: v.name || "" }) +
        C.field({ id: "cv-" + v.id + "-what", label: "Kva leverandøren gjer", multiline: true, rows: 2, value: v.what_it_does || "" }) +
        '<div class="field"><label for="cv-' + v.id + '-country">Land</label><select id="cv-' + v.id + '-country">' +
          Object.keys(COMPLIANCE_COUNTRY_LABEL).map(function (c) {
            return '<option value="' + c + '"' + (v.country === c ? " selected" : "") + '>' + C.esc(COMPLIANCE_COUNTRY_LABEL[c]) + '</option>';
          }).join("") +
        '</select></div>' +
        '<div class="field"><label for="cv-' + v.id + '-transfer">Overføringsmekanisme</label><select id="cv-' + v.id + '-transfer">' +
          Object.keys(COMPLIANCE_TRANSFER_LABEL).map(function (t) {
            return '<option value="' + t + '"' + (v.transfer_mechanism === t ? " selected" : "") + '>' + C.esc(COMPLIANCE_TRANSFER_LABEL[t]) + '</option>';
          }).join("") +
        '</select></div>' +
        '<div class="field"><label for="cv-' + v.id + '-dpastatus">DPA-status</label><select id="cv-' + v.id + '-dpastatus">' +
          COMPLIANCE_DPA_STATUS_OPTIONS.map(function (o) {
            return '<option value="' + o[0] + '"' + (v.dpa_status === o[0] ? " selected" : "") + '>' + C.esc(o[1]) + '</option>';
          }).join("") +
        '</select></div>' +
        C.field({ id: "cv-" + v.id + "-note", label: "DPA-notat", multiline: true, rows: 2, value: v.dpa_note || "",
          help: "Operatør-internt notat — lekk aldri direkte til kundevendt tekst." }) +
        C.button({ label: "Lagre", variant: "primary", attrs: 'type="button" class="compliance-vendor-save" data-id="' + C.esc(v.id) + '"' }) +
        '<span class="cs-status" data-compliance-vendor-status="' + C.esc(v.id) + '"></span>' +
      '</details>';
    }).join("");

    pane.querySelectorAll(".compliance-vendor-save").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        var statusEl = pane.querySelector('[data-compliance-vendor-status="' + id + '"]');
        var payload = {
          id: id,
          name: pane.querySelector("#cv-" + id + "-name").value,
          what_it_does: pane.querySelector("#cv-" + id + "-what").value,
          country: pane.querySelector("#cv-" + id + "-country").value,
          transfer_mechanism: pane.querySelector("#cv-" + id + "-transfer").value,
          dpa_status: pane.querySelector("#cv-" + id + "-dpastatus").value,
          dpa_note: pane.querySelector("#cv-" + id + "-note").value
        };
        btn.disabled = true;
        statusMsg(statusEl, "Lagrar…", true);
        tenantAdminCall("set_vendor", payload, function (r) {
          btn.disabled = false;
          if (r.error) { statusMsg(statusEl, r.error, false); return; }
          statusMsg(statusEl, "✓ Lagra", true);
          var v = _complianceData.vendors.filter(function (x) { return x.id === id; })[0];
          if (v) Object.assign(v, payload);
        });
      });
    });
  }

  /* =========================================================================
     SEKSJONSDISPATCH
     ====================================================================== */
  var TITLES = {
    kundar:"Kundar", produkt:"Produkt", web:"Web", "sidebygger-sider":"Sider", workspace:"Workspace",
    modular:"Modular", priser:"Priser", kundeanalyse:"Kundeanalyse", compliance:"Compliance", analyse:"Analyse", personvern:"Personvern", laring:"Læring", "ai-lab":"AI Lab", system:"System"
  };
  var RENDERERS = {
    kundar:     renderKundar,
    produkt:    renderProdukt,
    web:        renderWeb,
    "sidebygger-sider": renderSidebyggerSider,
    workspace:  renderWorkspace,
    modular:    renderModular,
    priser:     renderPriser,
    kundeanalyse: renderKundeanalyse,
    compliance: renderCompliance,
    analyse:    renderAnalyse,
    personvern: renderPersonvern,
    laring:     renderLaring,
    "ai-lab":  renderAiLab,
    system:     renderSystem
  };

  // Generasjonsteljar: vaktar mot at eit forelda getSC()-kall (frå ein
  // seksjon/tenant brukaren alt har forlate) skriv inn i eit #cs-section-wrap
  // som no høyrer til ein heilt annan seksjon (same element-id vert attbrukt).
  var _renderGen = 0;

  function renderSection(id) {
    var content = document.getElementById("cs-content");
    if (!content) return;
    // Priser og den eksplisitte side-ved-side-visninga i AI Lab treng breiare
    // enn lesebreidde -- sjå CSS-kommentaren ved
    // .cs-content--wide (console/index.html) for grunngjeving.
    content.classList.toggle("cs-content--wide", id === "priser" || id === "ai-lab" || id === "kundeanalyse" || id === "sidebygger-sider");
    var myGen = ++_renderGen;
    content.innerHTML =
      '<div class="cs-page-head"><h1 class="cs-page-title">' + C.esc(TITLES[id] || id) + '</h1></div>' +
      '<div id="cs-section-wrap"></div>';
    var fn = RENDERERS[id];
    if (!fn) return;
    var wrap = document.getElementById("cs-section-wrap"); // fanga no, før det asynkrone hoppet
    // AI Lab er eit reint lokalt utviklingsverktøy utan tenant-data, database
    // eller App.store. Det skal difor ikkje hentast eller koplast til SC-data.
    if (id === "ai-lab" || id === "kundeanalyse" || id === "compliance") {
      fn({}, wrap);
      return;
    }
    getSC(function (sc) {
      if (myGen !== _renderGen) return; // avløyst av ein seinare navigate()/tenant-byte
      fn(sc, wrap);
    });
  }

  /* =========================================================================
     INIT
     ====================================================================== */
  document.addEventListener("DOMContentLoaded", function () {
    App.ready(function () {
      applyConsoleTheme();
      if (!_sbControl) { buildLogin(); return; }
      // Sjekk om det finst ei ekte, framleis gyldig Supabase-sesjon mot
      // vibeverk-control FØR vi viser skallet — ikkje eit lokalt tidsstempel
      // som kan seie "innlogga" lenge etter at den underliggande JWT-en
      // faktisk har gått ut (den gamle, no fiksa buggen, sjå AUTH-seksjonen).
      _sbControl.auth.getSession().then(function (r) {
        _session = r.data && r.data.session;
        if (!_session) { buildLogin(); return; }
        checkOperatorActive(function (ok) {
          if (!ok) { logout(); return; }
          loadTenants(function () { buildShell(); });
        });
      });
    });
  });

  return {
    navigate: navigate, isAiLabLocalEnvironment: isAiLabLocalEnvironment,
    // Eksponerer reine funksjonar for testing, same mønster som core.js sin
    // eigen _test: {dbLeadToJs, jsLeadToDb} -- pbPreviewCss() sin sanering av
    // superconfig sine farge-/font-verdiar er sikkerheitskritisk (Security
    // Auditor-funn BLOCKER, 2026-08-11) og bør testast direkte, ikkje berre
    // implisitt gjennom eit mock-oppsett som ikkje skil ut superconfig frå
    // andre store-nøklar.
    _test: { pbPreviewCss: pbPreviewCss, pbSafeCssColor: pbSafeCssColor, pbSafeCssFontName: pbSafeCssFontName }
  };
})();
