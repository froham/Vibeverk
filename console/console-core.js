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
  var VIBEVERK_VERSION = "0.98.6";

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
      .select("id, slug, hostnames, status, data_plane_url, data_plane_anon_key, data_plane_storage_key, data_plane_service_role_secret_id, schema_verified_at, routing_verified_at, first_admin_invited_at, smtp_configured_at, custom_modules_manifest")
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
  var NAV_ITEMS = [
    { id: "kundar",     icon: "building",    label: "Kundar" },
    { id: "produkt",    icon: "package",     label: "Produkt" },
    { id: "web",        icon: "world",       label: "Web" },
    { id: "workspace",  icon: "briefcase",   label: "Workspace" },
    { id: "modular",    icon: "puzzle",      label: "Modular" },
    { id: "priser",     icon: "tag",         label: "Priser" },
    { id: "analyse",    icon: "chart-bar",   label: "Analyse" },
    { id: "personvern", icon: "shield-lock", label: "Personvern" },
    { id: "laring",     icon: "book",        label: "Læring" },
    { id: "system",     icon: "settings",    label: "System" }
  ];

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
            NAV_ITEMS.map(function (n) {
              return '<button type="button" class="cs-nav__item" data-cs-nav="' + n.id + '" title="' + C.esc(n.label) + '">' +
                '<span class="ti ti-' + n.icon + '"></span> <span class="cs-nav__item-label">' + C.esc(n.label) + '</span></button>';
            }).join("") +
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

  // Same tekstformular som computeDefaultPrivacyText() i core.js (Vibeverk sin
  // standard personvernstekst, modul-medviten) -- MEN tek sc/an som argument
  // i staden for å lese CFG/modules/Store, sidan CFG i Konsollen alltid er
  // konsollen sin eigen, verkelege primærtenant (aldri tenant-skopert, sjå
  // notatet ved renderProdukt). Å kalle App.computeDefaultPrivacyText() her
  // ville lekt konsollen sin EIGEN tenant sine modulval inn i ein annan kunde
  // sitt forslag. Hald denne i sync med core.js-versjonen viss teksten
  // endrar seg der.
  function computeTenantPrivacyDefault(sc, an) {
    var ft = sc.features || {};
    var hasContactForm = ft.contactForm !== false;
    var hasTilbud   = !!ft.quote;
    var hasBooking  = !!ft.booking;
    var hasAnalytics = !!(an && (an.plausible || an.plausibleEmbed));

    var collectBits = [];
    if (hasContactForm) collectBits.push("en henvendelse");
    if (hasTilbud)  collectBits.push("ber om tilbud");
    if (hasBooking) collectBits.push("reserverer en booking");
    if (!collectBits.length) collectBits.push("tar kontakt med oss");
    var collectPhrase = collectBits.length > 1
      ? collectBits.slice(0, -1).join(", ") + " eller " + collectBits[collectBits.length - 1]
      : collectBits[0];

    var storedBits = [];
    if (hasContactForm) storedBits.push("henvendelser");
    if (hasTilbud)  storedBits.push("tilbud");
    if (hasBooking) storedBits.push("bookinger");
    if (!storedBits.length) storedBits.push("kontaktopplysninger");
    var storedPhrase = storedBits.length > 1
      ? storedBits.slice(0, -1).join(", ") + " og " + storedBits[storedBits.length - 1]
      : storedBits[0];

    var cookieText = hasAnalytics
      ? "Ja, vi bruker Plausible Analytics for trafikkstatistikk — et personvernvennlig analyseverktøy uten sporingscookies, som ikke samler inn personidentifiserbar informasjon om besøkende."
      : "Nei. Denne siden bruker ingen cookies eller analyseverktøy som samler inn personopplysninger.";

    return "Når du sender oss " + collectPhrase + ", lagrer vi opplysningene du selv oppgir — typisk navn, e-postadresse, telefonnummer og innholdet i meldingen eller bestillingen din. Opplysningene brukes utelukkende til å besvare henvendelsen din eller behandle bestillingen, og deles ikke med tredjeparter for markedsføringsformål.\n\n" +
      "Hvor lagres opplysningene?\n" +
      "Nettsiden er bygget som en statisk side og driftes via GitHub Pages. Innsendte opplysninger lagres i en database hos Supabase, med servere i EU.\n\n" +
      "Bruker vi cookies?\n" + cookieText + "\n\n" +
      "Hvor lenge lagres opplysningene?\n" +
      "Vi oppbevarer " + storedPhrase + " så lenge det er nødvendig for å følge opp saken din. Du kan når som helst be om at opplysningene dine slettes.\n\n" +
      "Dine rettigheter\n" +
      "Du har rett til innsyn i hvilke opplysninger vi har lagret om deg, samt rett til å få disse korrigert eller slettet, i tråd med personopplysningsloven/GDPR. For å be om innsyn eller sletting, ta kontakt via kontaktinformasjonen på denne siden og merk henvendelsen «Personvern». Vi sletter opplysningene dine uten ugrunnet opphold.\n\n" +
      "Samtykke\n" +
      "Ved å sende inn dette skjemaet samtykker du til at vi behandler opplysningene dine slik beskrevet over.";
  }

  function renderPersonvern(sc, wrap) {
    var priv = Object.assign({}, sc.privacy || {});
    var textHtml = migrateLegacyPrivacyText(priv.text || "");

    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Personvernerklæring</legend>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Vises i popup på kontaktskjema, booking og tilbud, og via «Personvern»-lenka i footer.</p>' +
          C.field({ id:"cs-priv-heading", label:"Overskrift", value: priv.heading || "" }) +
          '<div style="margin:-.3rem 0 .6rem">' +
            '<button type="button" class="btn btn--ghost btn--sm" id="cs-priv-fetch">↺ Bygg basert på gjeldande modular</button>' +
            '<p style="font-size:.78rem;color:var(--color-muted);margin:.3rem 0 0">Set inn eit forslag til personvernerklæring, tilpassa til kva som faktisk er aktivert for denne kunden (kontaktskjema/tilbod/booking/Plausible-tilkopling). <strong>Dette er berre eit utgangspunkt frå oss</strong> — dersom kunden nyttar andre tredjepartsløysingar (t.d. anna analyseverktøy, betalingsløysing, ekstern CRM), må dei sjølve leggje til tekst om det. Kunden er juridisk ansvarleg for at teksten faktisk stemmer. Kan redigerast fritt etterpå.</p>' +
          '</div>' +
          C.richTextField({ id:"cs-priv-text", label:"Tekst", value: textHtml }) +
        '</fieldset>' +
        saveBtn() +
      '</form>';

    App.ui.bindRichTextFields(wrap);

    wrap.querySelector("#cs-priv-fetch").addEventListener("click", function () {
      var hidden = wrap.querySelector("#cs-priv-text");
      var hasExisting = hidden && App.ui.readRichTextField(wrap, "cs-priv-text").trim();
      if (hasExisting && !confirm("Dette erstattar teksten som står i feltet no. Fortsette?")) return;
      getStoreKey("analytics", function (an) {
        var html = App.ui.textToRichHtml(computeTenantPrivacyDefault(sc, an));
        var editor = hidden.closest("[data-rtfield]").querySelector("[data-rt-editor]");
        editor.innerHTML = html;
        editor.dispatchEvent(new Event("input"));
      });
    });

    wrap.querySelector("#cs-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var textVal = App.ui.readRichTextField(wrap, "cs-priv-text");
      var savingTenantId = _activeTenant && _activeTenant.id;
      getSC(function (sc2) {
        sc2.privacy = {
          heading: wrap.querySelector("#cs-priv-heading").value.trim(),
          text:    textVal
        };
        saveSC(sc2, savingTenantId);
        statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra!", true);
      });
    });
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
     SEKSJONSDISPATCH
     ====================================================================== */
  var TITLES = {
    kundar:"Kundar", produkt:"Produkt", web:"Web", workspace:"Workspace",
    modular:"Modular", priser:"Priser", analyse:"Analyse", personvern:"Personvern", laring:"Læring", system:"System"
  };
  var RENDERERS = {
    kundar:     renderKundar,
    produkt:    renderProdukt,
    web:        renderWeb,
    workspace:  renderWorkspace,
    modular:    renderModular,
    priser:     renderPriser,
    analyse:    renderAnalyse,
    personvern: renderPersonvern,
    laring:     renderLaring,
    system:     renderSystem
  };

  // Generasjonsteljar: vaktar mot at eit forelda getSC()-kall (frå ein
  // seksjon/tenant brukaren alt har forlate) skriv inn i eit #cs-section-wrap
  // som no høyrer til ein heilt annan seksjon (same element-id vert attbrukt).
  var _renderGen = 0;

  function renderSection(id) {
    var content = document.getElementById("cs-content");
    if (!content) return;
    // Berre Priser treng breiare enn lesebreidde -- sjå CSS-kommentaren ved
    // .cs-content--wide (console/index.html) for grunngjeving.
    content.classList.toggle("cs-content--wide", id === "priser");
    var myGen = ++_renderGen;
    content.innerHTML =
      '<div class="cs-page-head"><h1 class="cs-page-title">' + C.esc(TITLES[id] || id) + '</h1></div>' +
      '<div id="cs-section-wrap"></div>';
    var fn = RENDERERS[id];
    if (!fn) return;
    var wrap = document.getElementById("cs-section-wrap"); // fanga no, før det asynkrone hoppet
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

  return { navigate: navigate };
})();
