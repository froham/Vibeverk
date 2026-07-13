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
  var VIBEVERK_VERSION = "0.33.1";

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
      .select("id, slug, hostnames, status, data_plane_url, data_plane_anon_key, data_plane_storage_key, data_plane_service_role_secret_id, schema_verified_at, routing_verified_at")
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

  /* =========================================================================
     SUPERCONFIG-PRIVATE I/O (2026-07-07, ruta om via broker i Fase 8)
     -----------------------------------------------------------------------
     Held hemmeleg per-kunde-config (i dag berre adminPassword-overstyringa)
     ATSKILT frå 'superconfig' — den er framleis med vilje anon-lesbar (naudsynt
     for at tema/feature-flagg skal fungere for ein ikkje-innlogga besøkande),
     så eit passord kan ALDRI liggje der i klartekst. RLS krev
     is_platform_operator() for BÅDE lesing og skriving av denne nøkkelen —
     no berre nåbar via broker Edge Function-en (get_private_config/set_config),
     aldri direkte frå klienten mot kundens eige prosjekt.
     ====================================================================== */
  var SUPER_PRIVATE_KEY = "superconfig-private";

  function getSCPrivate(cb) {
    brokerCall("get_private_config", {}, function (r) {
      if (r.error) { console.error("[console] superconfig-private-lesing feila:", r.error); cb({}); return; }
      cb(r.value || {});
    });
  }

  function saveSCPrivate(priv, tenantId) {
    var payload = { key: SUPER_PRIVATE_KEY, value: priv };
    if (tenantId) payload.tenant_id = tenantId;
    brokerCall("set_config", payload, function (r) {
      if (r.error) console.error("[console] superconfig-private-skriving feila:", r.error);
    });
  }

  /* =========================================================================
     KONSTANTER
     ====================================================================== */
  var FONT_PAIRS = [
    { label: "Syne + Inter",                    display: "Syne",             body: "Inter" },
    { label: "Playfair + Source Sans 3",         display: "Playfair Display", body: "Source Sans 3" },
    { label: "Space Grotesk + Work Sans",        display: "Space Grotesk",    body: "Work Sans" },
    { label: "Fraunces + Karla",                 display: "Fraunces",         body: "Karla" },
    { label: "Poppins + Nunito Sans",            display: "Poppins",          body: "Nunito Sans" }
  ];
  var FEAT_LABELS = {
    newsArchive:"Aktuelt", search:"Arkivsøk", attachments:"Vedlegg",
    social:"Sosiale lenker", contactForm:"Kontaktskjema", booking:"Booking", quote:"Tilbud",
    references:"Referansar", faq:"FAQ", siteSearch:"Søk i toppmeny",
    crm:"Kunder", crmFull:"Native e-post", mediabank:"Mediebank", scrollbanner:"Banner", chat:"Chat"
  };
  var IFEAT_LABELS = {
    announcements:"Aktuelt", notes:"Notatar", kb:"Kunnskapsbase",
    mediaInternal:"Mediebank", links:"Lenker", orgdrift:"Org & drift",
    crm:"Kunder", booking:"Booking", quote:"Tilbud", contact:"Kontakthenvendingar"
  };
  var NAV_ITEMS = [
    { id: "kundar",     icon: "building",    label: "Kundar" },
    { id: "produkt",    icon: "package",     label: "Produkt" },
    { id: "web",        icon: "world",       label: "Web" },
    { id: "workspace",  icon: "briefcase",   label: "Workspace" },
    { id: "modular",    icon: "puzzle",      label: "Modular" },
    { id: "analyse",    icon: "chart-bar",   label: "Analyse" },
    { id: "personvern", icon: "shield-lock", label: "Personvern" },
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

  function checkboxGrid(obj, labels, attr) {
    return '<div class="cs-checkbox-grid">' +
      Object.keys(obj).map(function (k) {
        return '<label class="cs-checkbox-label">' +
          '<input type="checkbox" data-' + attr + '="' + C.esc(k) + '"' + (obj[k] !== false ? " checked" : "") + '> ' +
          C.esc(labels[k] || k) +
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
          '<div class="cs-brand"><span class="ti ti-layout-grid"></span> Console</div>' +
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
              return '<button type="button" class="cs-nav__item" data-cs-nav="' + n.id + '">' +
                '<span class="ti ti-' + n.icon + '"></span> ' + C.esc(n.label) + '</button>';
            }).join("") +
          '</nav>' +
          '<div class="cs-sidebar__foot">' +
            '<button type="button" class="cs-logout-btn"><span class="ti ti-logout"></span> Logg ut</button>' +
            '<div class="cs-version" title="Sjå docs/project/CHANGELOG.md for endringshistorikk">Vibeverk v' + C.esc(VIBEVERK_VERSION) + '</div>' +
          '</div>' +
        '</aside>' +
        '<main class="cs-main"><div class="cs-content" id="cs-content"></div></main>' +
      '</div>';

    document.querySelectorAll("[data-cs-nav]").forEach(function (btn) {
      btn.addEventListener("click", function () { navigate(btn.getAttribute("data-cs-nav")); });
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
    // Ikkje CFG.colors/company/fonts som fallback -- sjå notatet i
    // renderProdukt. Nøytrale standardverdiar for ein tenant som ikkje har
    // lagra noko enno.
    var col = Object.assign({}, sc.colors  || {});
    var com = Object.assign({}, sc.company || {});
    var fnt = Object.assign({}, sc.fonts   || {});

    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Firma</legend>' +
          C.field({ id:"cs-name",    label:"Firmanavn",  value: com.name    || "" }) +
          C.field({ id:"cs-tagline", label:"Tagline",    value: com.tagline || "" }) +
          C.field({ id:"cs-logo",    label:"Logo-URL",   value: com.logoUrl || "", placeholder:"https://…" }) +
        '</fieldset>' +
        '<fieldset class="admin-group"><legend>SEO og deling</legend>' +
          C.field({ id:"cs-metadesc", label:"Meta-beskrivelse", multiline:true, rows:2,
            value: com.metaDescription || "", placeholder:"Kort beskrivelse, 1–2 setningar" }) +
          C.field({ id:"cs-ogimage", label:"Delingsbilde (OG-bilde)", value: com.ogImage || "", placeholder:"https://… (1200×630px)" }) +
          C.field({ id:"cs-favicon", label:"Favicon-URL", value: com.favicon || "", placeholder:"https://…" }) +
        '</fieldset>' +
        '<fieldset class="admin-group"><legend>Fargar</legend>' +
          '<div class="bk-2col">' +
            colorField("cs-primary",   "Primærfarge",   col.primary   || "#1a7a6e", "Knappar, lenker og aktive element") +
            colorField("cs-secondary", "Sekundærfarge", col.secondary || "#c17f3e", "CTA-knappar og uthevingar") +
          '</div>' +
          colorField("cs-bg", "Bakgrunnsfarge", col.background || "#fbfaf8", "Sideflata bak alt innhald") +
          '<div class="bk-2col">' +
            colorField("cs-text",    "Tekstfarge", col.text    || "#1B1B1F", "Hovudtekst og overskrifter") +
            colorField("cs-surface", "Overflate",  col.surface || "#ffffff", "Kort, modalar og paneler") +
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
          '<div class="bk-2col">' +
            C.field({ id:"cs-bfont",    label:"Brødtekst-font",  value: fnt.body || "", placeholder:"Inter" }) +
            C.field({ id:"cs-bweights", label:"Weights (komma)", value: (fnt.weights && fnt.weights.body ? fnt.weights.body.join(",") : "400,500,600"), hint:"For brødtekst" }) +
          '</div>' +
          '<div style="margin-top:.5rem">' +
            '<button type="button" class="btn btn--ghost btn--sm" id="cs-web-reset">↺ Nullstill fargar og fontar til standard</button>' +
          '</div>' +
        '</fieldset>' +
        saveBtn() +
      '</form>';

    wrap.querySelectorAll("[data-pair]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = FONT_PAIRS[parseInt(btn.getAttribute("data-pair"), 10)];
        if (!p) return;
        wrap.querySelector("#cs-dfont").value    = p.display;
        wrap.querySelector("#cs-bfont").value    = p.body;
        wrap.querySelector("#cs-dweights").value = "600,700,800";
        wrap.querySelector("#cs-bweights").value = "400,500,600";
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
      wrap.querySelector("#cs-dfont").value     = "Poppins";
      wrap.querySelector("#cs-bfont").value     = "Nunito Sans";
      wrap.querySelector("#cs-dweights").value  = "600,700,800";
      wrap.querySelector("#cs-bweights").value  = "400,500,600";
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
          surface:    wrap.querySelector("#cs-surface").value
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
            C.field({ id:"cs-wsp-dweights", label:"Weights (komma)", value: (wspFnt.weights && wspFnt.weights.display ? wspFnt.weights.display.join(",") : "600,700,800") }) +
          '</div>' +
          '<div class="bk-2col">' +
            C.field({ id:"cs-wsp-bfont",    label:"Brødtekst-font",  value: wspFnt.body || "", placeholder:"Tomt = same som nettsida" }) +
            C.field({ id:"cs-wsp-bweights", label:"Weights (komma)", value: (wspFnt.weights && wspFnt.weights.body ? wspFnt.weights.body.join(",") : "400,500,600") }) +
          '</div>' +
          '<div style="margin-top:.5rem">' +
            '<button type="button" class="btn btn--ghost btn--sm" id="cs-wsp-reset">↺ Nullstill fargar og fontar til standard</button>' +
          '</div>' +
        '</fieldset>' +
        saveBtn() +
      '</form>';

    wrap.querySelector("#cs-wsp-use-name").addEventListener("change", function () {
      wrap.querySelector("#cs-wsp-name-wrap").style.display = this.checked ? "" : "none";
    });

    wrap.querySelectorAll("[data-wsp-pair]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = FONT_PAIRS[parseInt(btn.getAttribute("data-wsp-pair"), 10)];
        if (!p) return;
        wrap.querySelector("#cs-wsp-dfont").value    = p.display;
        wrap.querySelector("#cs-wsp-bfont").value    = p.body;
        wrap.querySelector("#cs-wsp-dweights").value = "600,700,800";
        wrap.querySelector("#cs-wsp-bweights").value = "400,500,600";
      });
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
    Object.keys(labels).forEach(function (k) { d[k] = true; });
    return d;
  }

  function renderModular(sc, wrap) {
    var ft  = Object.assign(featureDefaults(FEAT_LABELS),  sc.features         || {});
    var ift = Object.assign(featureDefaults(IFEAT_LABELS), sc.intranettFeatures || {});

    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Nettside</legend>' +
          checkboxGrid(ft, FEAT_LABELS, "cs-feat") +
        '</fieldset>' +
        '<fieldset class="admin-group" style="margin-top:.8rem"><legend>Workspace</legend>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Dashboard, Oppgåver og Innstillingar er alltid på og visast ikkje her.</p>' +
          checkboxGrid(ift, IFEAT_LABELS, "cs-ifeat") +
        '</fieldset>' +
        saveBtn() +
      '</form>';

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
        statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra!", true);
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
  function renderAnalyse(sc, wrap) {
    // Fanga her, ikkje inne i submit-handteraren -- dette skjemaet
    // representerer tenanten som var aktiv DÅ SIDA VART TEIKNA, uansett kva
    // _activeTenant måtte verta seinare (sjå saveSC() sitt notat).
    var savingTenantId = _activeTenant && _activeTenant.id;
    getStoreKey("analytics", function (an) {
      wrap.innerHTML =
        '<form id="cs-form">' +
          '<fieldset class="admin-group"><legend>Analyse</legend>' +
            C.field({ id:"cs-an-pl",      label:"Plausible – domenenavn", value: an.plausible || "", placeholder:"vibeverk.no" }) +
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
            '<button type="button" class="btn btn--ghost btn--sm" id="cs-priv-fetch">↺ Hent Vibeverk sin standardtekst</button>' +
            '<p style="font-size:.78rem;color:var(--color-muted);margin:.3rem 0 0">Set inn same GDPR-standardtekst som gjeld overalt før noko er tilpassa — modul-tilpassa til kva som faktisk er aktivert for denne kunden (kontaktskjema/tilbud/booking/analyse). Kan redigerast fritt etterpå.</p>' +
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

  function renderSystem(sc, wrap) {
    var supaUrl     = (_activeTenant && _activeTenant.data_plane_url) || "—";
    var supaKey     = (_activeTenant && _activeTenant.data_plane_anon_key) || "";
    var supaKeyShrt = supaKey ? supaKey.slice(0, 40) + "…" : "—";
    var expiresAtSec = _session && _session.expires_at;
    var expiryStr   = expiresAtSec ? new Date(expiresAtSec * 1000).toLocaleString("nb-NO") : "—";

    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Innlogging</legend>' +
          '<p style="font-size:.85rem;color:var(--color-muted);margin:0 0 .4rem">Console brukar OTP via e-post mot vibeverk-control (Fase 8) — ingen passord å handtere her.</p>' +
          '<p style="font-size:.85rem;color:var(--color-muted);margin:0">Innlogga tenant: <strong>' + C.esc((_activeTenant && _activeTenant.slug) || "—") + '</strong></p>' +
          '<p style="font-size:.85rem;color:var(--color-muted);margin:0">Økta oppdaterast automatisk; gjeldande token utløper: <strong>' + C.esc(expiryStr) + '</strong></p>' +
        '</fieldset>' +
        '<fieldset class="admin-group"><legend>Nettside-admin (for kunden)</legend>' +
          C.field({ id:"cs-apass", label:"Passord for #admin-inngang", value:"", placeholder:"Laster…" }) +
          '<p style="font-size:.78rem;color:var(--color-muted);margin:.3rem 0 0">Verkar berre viss Supabase IKKJE er konfigurert for kunden (reint lokalt/test-miljø). For alle ekte, konfigurerte kundar krevst innlogging med e-post + passord via Supabase — dette feltet har då ingen effekt (sjå ADR-0003). Lagra åtskilt frå anna konfig og aldri anon-lesbart (sjå ADR-en for control-plane-splitten).</p>' +
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
        '</fieldset>' +
        '<div style="display:flex;gap:.6rem;align-items:center;margin-top:1.4rem">' +
          '<button type="submit" class="btn btn--primary">Lagre admin-passord</button>' +
        '</div>' +
        '<p class="form__status" id="cs-status" style="margin-top:.6rem"></p>' +
      '</form>';

    var apassInp = wrap.querySelector("#cs-apass");
    getSCPrivate(function (priv) {
      if (apassInp) { apassInp.value = priv.adminPassword || ""; apassInp.placeholder = ""; }
    });

    wrap.querySelector("#cs-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var savingTenantId = _activeTenant && _activeTenant.id;
      saveSCPrivate({ adminPassword: apassInp.value }, savingTenantId);
      statusMsg(wrap.querySelector("#cs-status"), "✓ Passord lagra!", true);
    });
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

  function kdStatusBadge(status) {
    var map = { provisioning: "#d4a017", active: "#1e8449", suspended: "#c0392b", archived: "#64748b" };
    return '<span style="font-size:.75rem;font-weight:700;color:' + (map[status] || "#64748b") + '">' + C.esc(status || "") + '</span>';
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
            return '<li class="kd-row" data-kd-row="' + C.esc(t.id) + '">' +
              '<strong>' + C.esc(t.slug) + '</strong>' +
              kdStatusBadge(t.status) +
            '</li>';
          }).join("") +
          (visible.length ? "" : '<li class="kd-row"><span style="color:var(--color-muted)">Ingen kundar registrert enno.</span></li>') +
        '</ul>' +
      '</div>' +
      '<div id="kd-new-form-wrap"></div>' +
      '<div id="kd-detail-wrap"></div>';

    wrap.querySelectorAll("[data-kd-row]").forEach(function (row) {
      row.addEventListener("click", function () {
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
                  ? 'Endrar du domenenamn må steg 4 (skjema) og steg 5 (ruting) verifiserast på nytt før aktivering.'
                  : '⚠️ Kunden er aktiv — endring tek effekt UMIDDELBART på det livesida svarer på, utan ny verifisering. Sjekk at DNS/Vercel peikar rett FØR du lagrar.') + '</p>' +
                '<p class="form__status" id="kd-hostnames-status" style="margin-top:.4rem"></p>' +
              '</form>'
            : '<p class="field__hint">Domenenamn: ' + (hasHostnames ? C.esc(tenant.hostnames.join(", ")) : "ingen registrert") + ' (kan ikkje endrast i denne statusen).</p>'
          ) +
        '</div>' +

        '<div class="kd-card"><strong>2. Opprett Supabase-prosjekt</strong>' +
          '<p class="field__hint">Gjer dette manuelt via Supabase Dashboard/CLI (kan ikkje automatiserast trygt — sjå Fase 9-notatet). Kom tilbake hit når prosjektet finst.</p>' +
        '</div>' +

        '<div class="kd-card"><strong>3. Kopling</strong> ' + (hasConnection ? "✓" : "—") +
          '<form id="kd-conn-form" style="margin-top:.6rem">' +
            C.field({ id: "kd-url", label: "data_plane_url", value: tenant.data_plane_url || "", placeholder: "https://xxxx.supabase.co" }) +
            C.field({ id: "kd-anon", label: "data_plane_anon_key", value: tenant.data_plane_anon_key || "", placeholder: "eyJ…" }) +
            '<button type="submit" class="btn btn--ghost btn--sm">Lagre kopling</button>' +
            '<p class="form__status" id="kd-conn-status" style="margin-top:.4rem"></p>' +
          '</form>' +
        '</div>' +

        '<div class="kd-card"><strong>3b. Service_role-nøkkel</strong> (lagra trygt via Vault, aldri vist att)' +
          '<form id="kd-key-form" style="margin-top:.6rem">' +
            C.field({ id: "kd-srvkey", label: "service_role-nøkkel", type: "password", placeholder: "eyJ…" }) +
            '<button type="submit" class="btn btn--ghost btn--sm">Lagre nøkkel</button>' +
            '<p class="form__status" id="kd-key-status" style="margin-top:.4rem"></p>' +
          '</form>' +
        '</div>' +

        '<div class="kd-card"><strong>4. Køyr og verifiser skjema</strong>' +
          '<p class="field__hint">Køyr migrasjonane manuelt mot det nye prosjektet (<code>npx supabase db push --db-url …</code>), deretter:</p>' +
          '<button type="button" class="btn btn--ghost btn--sm" id="kd-verify-btn">Verifiser skjema</button>' +
          '<p id="kd-verify-result" class="field__hint"></p>' +
        '</div>' +

        '<div class="kd-card"' + (schemaOk && hasHostnames ? "" : ' style="opacity:.6"') + '><strong>5. Verifiser ruting</strong> ' + (routingOk ? "✓" : "—") +
          '<p class="field__hint">Hostnames: ' + (hasHostnames ? C.esc(tenant.hostnames.join(", ")) : "ingen registrert") + '. Krev at DNS/Vercel-oppsettet for desse peikar hit FØR du trykkjer — sjekken gjer eit ekte HTTP-kall mot kvar hostname.</p>' +
          '<button type="button" class="btn btn--ghost btn--sm" id="kd-routing-btn"' + (schemaOk && hasHostnames ? "" : " disabled") + '>Verifiser ruting</button>' +
          '<p id="kd-routing-result" class="field__hint"></p>' +
        '</div>' +

        '<div class="kd-card">' +
          '<strong>6. Set aktiv</strong> — ' + (routingOk ? "klar" : "sperra (ruting ikkje verifisert enno)") +
          '<p class="field__hint">⚠️ Gjer kunden LIVE: nettsida/Workspace svarer no faktisk på domenenamna over, for alle besøkjande. Dette er det siste steget — dobbeltsjekk at alt over faktisk er korrekt fyrst.</p>' +
          '<div><button type="button" class="btn btn--primary btn--sm" id="kd-activate-btn"' + (routingOk ? "" : " disabled") + '>Set aktiv</button></div>' +
          '<p id="kd-activate-result" class="field__hint"></p>' +
        '</div>' +

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
    modular:"Modular", analyse:"Analyse", personvern:"Personvern", system:"System"
  };
  var RENDERERS = {
    kundar:     renderKundar,
    produkt:    renderProdukt,
    web:        renderWeb,
    workspace:  renderWorkspace,
    modular:    renderModular,
    analyse:    renderAnalyse,
    personvern: renderPersonvern,
    system:     renderSystem
  };

  // Generasjonsteljar: vaktar mot at eit forelda getSC()-kall (frå ein
  // seksjon/tenant brukaren alt har forlate) skriv inn i eit #cs-section-wrap
  // som no høyrer til ein heilt annan seksjon (same element-id vert attbrukt).
  var _renderGen = 0;

  function renderSection(id) {
    var content = document.getElementById("cs-content");
    if (!content) return;
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
