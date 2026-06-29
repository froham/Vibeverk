/* =============================================================================
   console-core.js  —  Vibeverk Console (per-kunde superadmin)
   -----------------------------------------------------------------------------
   Fullside admin-grensesnitt for Vibeverk-operatørar. Lastar etter core.js
   og overrider CSS-variablar til eit nøytralt konsolltema. Autentisering via
   Supabase OTP (e-post → 8-sifra kode) med 48 timars sesjonslevetid i
   localStorage. Skriv superconfig via App.store.
   ========================================================================== */

window.VwConsole = (function () {
  "use strict";

  var App = window.App;
  var C   = window.Components;
  var CFG = window.SITE_CONFIG || {};
  var NS  = CFG.storageKey || "site";
  var SUPER_KEY = "superconfig";

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
     SUPABASE-KLIENT  — eigen klient utan persistert sesjon for Console
     ====================================================================== */
  var _sb = null;
  if (window.supabase && CFG.supabase && CFG.supabase.url) {
    _sb = window.supabase.createClient(CFG.supabase.url, CFG.supabase.anonKey, {
      auth: { persistSession: false }
    });
  }

  /* =========================================================================
     AUTH  — OTP via Supabase, sesjon i localStorage med 48h utløp
     ====================================================================== */
  var AUTH_KEY   = NS + ":console-auth";
  var AUTH_HOURS = 48;
  var _otpEmail  = "";

  function isAuthed() {
    var expiry = parseInt(localStorage.getItem(AUTH_KEY) || "0", 10);
    return Date.now() < expiry;
  }

  function setAuthed() {
    localStorage.setItem(AUTH_KEY, (Date.now() + AUTH_HOURS * 3600000).toString());
  }

  function logout() {
    localStorage.removeItem(AUTH_KEY);
    if (_sb) _sb.auth.signOut();
    location.reload();
  }

  /* =========================================================================
     SUPERCONFIG I/O
     ====================================================================== */
  function getSC()    { return App.store.get(SUPER_KEY, {}) || {}; }
  function saveSC(sc) { App.store.set(SUPER_KEY, sc); }
  function resetSC()  {
    if (!confirm("Nullstill all superconfig og gå tilbake til config.js-verdiane?")) return;
    App.store.remove(SUPER_KEY);
    location.reload();
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
    social:"Sosiale lenker", booking:"Booking", quote:"Tilbud",
    references:"Referansar", faq:"FAQ", siteSearch:"Søk i toppmeny",
    crm:"Kunder", mediabank:"Mediebank", scrollbanner:"Banner", chat:"Chat"
  };
  var IFEAT_LABELS = {
    announcements:"Aktuelt", notes:"Notatar", kb:"Kunnskapsbase",
    mediaInternal:"Mediebank", links:"Lenker", orgdrift:"Org & drift",
    crm:"Kunder", booking:"Booking", quote:"Tilbud", contact:"Kontakthenvendingar"
  };
  var NAV_ITEMS = [
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
    if (!_sb) {
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
      var email = document.getElementById("cs-email").value.trim();
      var err   = document.getElementById("cs-login-err");
      if (!email) { err.textContent = "Skriv inn e-postadresse."; err.style.color = "#c0392b"; return; }
      err.textContent = "Sender kode…"; err.style.color = "";
      _sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } }).then(function (res) {
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
      _sb.auth.verifyOtp({ email: _otpEmail, token: token, type: "email" }).then(function (vr) {
        if (vr.error) {
          err.textContent = "Feil kode — prøv igjen."; err.style.color = "#c0392b";
          document.getElementById("cs-otp").value = "";
          document.getElementById("cs-otp").focus();
          return;
        }
        _sb.from("users").select("role").eq("id", vr.data.user.id).single().then(function (ur) {
          if (!ur.data || ur.data.role !== "owner") {
            err.textContent = "Tilgang nekta — ikkje owner-konto."; err.style.color = "#c0392b"; return;
          }
          setAuthed();
          buildShell();
        });
      });
    });
    document.getElementById("cs-resend").addEventListener("click", function () {
      var err = document.getElementById("cs-otp-err");
      err.textContent = "Sender ny kode…"; err.style.color = "";
      _sb.auth.signInWithOtp({ email: _otpEmail, options: { shouldCreateUser: false } }).then(function () {
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
          '<div class="cs-customer">' + C.esc((CFG.company && CFG.company.name) || "") + '</div>' +
          '<nav class="cs-nav">' +
            NAV_ITEMS.map(function (n) {
              return '<button type="button" class="cs-nav__item" data-cs-nav="' + n.id + '">' +
                '<span class="ti ti-' + n.icon + '"></span> ' + C.esc(n.label) + '</button>';
            }).join("") +
          '</nav>' +
          '<div class="cs-sidebar__foot">' +
            '<button type="button" class="cs-logout-btn"><span class="ti ti-logout"></span> Logg ut</button>' +
          '</div>' +
        '</aside>' +
        '<main class="cs-main"><div class="cs-content" id="cs-content"></div></main>' +
      '</div>';

    document.querySelectorAll("[data-cs-nav]").forEach(function (btn) {
      btn.addEventListener("click", function () { navigate(btn.getAttribute("data-cs-nav")); });
    });
    document.querySelector(".cs-logout-btn").addEventListener("click", logout);
    navigate(activeSection);
  }

  /* =========================================================================
     SEKSJONAR
     ====================================================================== */

  function renderProdukt(sc, wrap) {
    var mode = sc.productMode || CFG.productMode || "web";
    var opts = [
      { val: "web",       label: "Web",            desc: "Berre offentleg nettside — Workspace er blokkert" },
      { val: "workspace", label: "Workspace",       desc: "Berre intranett — nettsida visar vidare til /intranet/" },
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
      var sc2 = getSC();
      var checked = wrap.querySelector("input[name='cs-mode']:checked");
      sc2.productMode = checked ? checked.value : "web";
      saveSC(sc2);
      statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra! Trer i kraft ved neste sideopplasting.", true);
    });
  }

  function renderWeb(sc, wrap) {
    var col = Object.assign({}, CFG.colors,  sc.colors  || {});
    var com = Object.assign({}, CFG.company, sc.company || {});
    var fnt = Object.assign({}, CFG.fonts,   sc.fonts   || {});

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
      var def = CFG.colors || {};
      var fnt = CFG.fonts  || {};
      wrap.querySelector("#cs-primary").value   = def.primary    || "#005cff";
      wrap.querySelector("#cs-secondary").value = def.secondary  || "#ff7a00";
      wrap.querySelector("#cs-bg").value        = def.background || "#f7fbff";
      wrap.querySelector("#cs-text").value      = def.text       || "#142033";
      wrap.querySelector("#cs-surface").value   = def.surface    || "#ffffff";
      wrap.querySelector("#cs-dfont").value     = fnt.display    || "Poppins";
      wrap.querySelector("#cs-bfont").value     = fnt.body       || "Nunito Sans";
      wrap.querySelector("#cs-dweights").value  = (fnt.weights && fnt.weights.display) ? fnt.weights.display.join(",") : "600,700,800";
      wrap.querySelector("#cs-bweights").value  = (fnt.weights && fnt.weights.body)    ? fnt.weights.body.join(",")    : "400,500,600";
    });

    wrap.querySelector("#cs-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var sc2 = getSC();
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
      saveSC(sc2);
      statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra! Endringane er aktive ved neste sideopplasting.", true);
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

    var wsp    = Object.assign({}, CFG.workspace || {}, sc.workspace || {});
    var wspCol = Object.assign({}, CFG.colors || {}, wsp.colors || {});
    var wspFnt = Object.assign({}, CFG.fonts  || {}, wsp.fonts  || {});
    var pri    = (wsp.colors && wsp.colors.primary) || wsp.accentColor || wspCol.primary || "#2563eb";

    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Identitet</legend>' +
          C.field({ id:"cs-wsp-name", label:"Arbeidsområdenamn", value: wsp.name || "", placeholder:"Tomt = brukar firmanamnet" }) +
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
      var sc2 = getSC();
      sc2.workspace = Object.assign({}, sc2.workspace || {}, {
        name:        wrap.querySelector("#cs-wsp-name").value.trim(),
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
      saveSC(sc2);
      statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra! Trer i kraft ved neste Workspace-opplasting.", true);
    });
  }

  function renderModular(sc, wrap) {
    var ft  = Object.assign({}, CFG.features         || {}, sc.features         || {});
    var ift = Object.assign({}, CFG.intranettFeatures || {}, sc.intranettFeatures || {});

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
      var sc2 = getSC();
      sc2.features = feats;
      sc2.intranettFeatures = ifeats;
      saveSC(sc2);
      statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra!", true);
    });
  }

  function renderAnalyse(sc, wrap) {
    var an = App.store.get("analytics", null) || (CFG.analytics || {});

    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Analyse og integrasjonar</legend>' +
          C.field({ id:"cs-an-tawk", label:"Tidio – Public Key", value: an.tawkto || "", placeholder:"abc123defg456",
            hint:"Finn Public Key under Settings → General i Tidio. Ingen cookies, EU/EEA-serverar." }) +
          C.field({ id:"cs-an-pl",      label:"Plausible – domenenavn", value: an.plausible || "", placeholder:"vibeverk.no" }) +
          C.field({ id:"cs-an-plembed", label:"Plausible – delt dashboard-lenke", value: an.plausibleEmbed || "",
            placeholder:"https://plausible.io/share/…",
            hint:"Plausible → Site Settings → Visibility → Embed dashboard." }) +
        '</fieldset>' +
        saveBtn() +
      '</form>';

    wrap.querySelector("#cs-form").addEventListener("submit", function (e) {
      e.preventDefault();
      App.store.set("analytics", {
        tawkto:         wrap.querySelector("#cs-an-tawk").value.trim(),
        plausible:      wrap.querySelector("#cs-an-pl").value.trim(),
        plausibleEmbed: wrap.querySelector("#cs-an-plembed").value.trim()
      });
      statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra!", true);
    });
  }

  function renderPersonvern(sc, wrap) {
    var priv = Object.assign({}, CFG.privacy || {}, sc.privacy || {});

    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Personvernerklæring</legend>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Vises i popup på kontaktskjema, booking og tilbud, og via «Personvern»-lenka i footer.</p>' +
          C.field({ id:"cs-priv-heading", label:"Overskrift", value: priv.heading || "" }) +
          C.field({ id:"cs-priv-text", label:"Tekst", multiline:true, rows:10, value: priv.text || "" }) +
        '</fieldset>' +
        saveBtn() +
      '</form>';

    wrap.querySelector("#cs-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var sc2 = getSC();
      sc2.privacy = {
        heading: wrap.querySelector("#cs-priv-heading").value.trim(),
        text:    wrap.querySelector("#cs-priv-text").value
      };
      saveSC(sc2);
      statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra!", true);
    });
  }

  function renderSystem(sc, wrap) {
    var supaUrl     = (CFG.supabase && CFG.supabase.url) || "—";
    var supaKey     = (CFG.supabase && CFG.supabase.anonKey) || "";
    var supaKeyShrt = supaKey ? supaKey.slice(0, 40) + "…" : "—";
    var expiryMs    = parseInt(localStorage.getItem(AUTH_KEY) || "0", 10);
    var expiryStr   = expiryMs > 0 ? new Date(expiryMs).toLocaleString("nb-NO") : "—";

    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Innlogging</legend>' +
          '<p style="font-size:.85rem;color:var(--color-muted);margin:0 0 .4rem">Console brukar OTP via e-post — ingen passord å handtere her.</p>' +
          '<p style="font-size:.85rem;color:var(--color-muted);margin:0">Sesjon utløper: <strong>' + C.esc(expiryStr) + '</strong></p>' +
        '</fieldset>' +
        '<fieldset class="admin-group"><legend>Nettside-admin (for kunden)</legend>' +
          C.field({ id:"cs-apass", label:"Passord for #admin-inngang", value: (CFG.admin && CFG.admin.password) || "" }) +
          '<p style="font-size:.78rem;color:var(--color-muted);margin:.3rem 0 0">Kunden brukar dette for å opne web-admin via #admin-lenkja. Aktiv ved neste sideopplasting.</p>' +
        '</fieldset>' +
        '<fieldset class="admin-group"><legend>Supabase-prosjekt</legend>' +
          '<div style="font-size:.87rem;color:var(--color-muted);display:grid;gap:.4rem">' +
            '<div><strong>URL:</strong> ' + C.esc(supaUrl) + '</div>' +
            '<div><strong>Anon-nøkkel:</strong> <code style="font-size:.76rem;word-break:break-all">' + C.esc(supaKeyShrt) + '</code></div>' +
          '</div>' +
        '</fieldset>' +
        '<fieldset class="admin-group cs-danger-zone"><legend>Faresone</legend>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Nullstilling slettar all superconfig og startar frå config.js-verdiane. Kan ikkje angrast.</p>' +
          '<button type="button" class="btn btn--ghost" id="cs-reset-btn" style="border-color:#c0392b;color:#c0392b">Nullstill all konfig</button>' +
        '</fieldset>' +
        '<div style="display:flex;gap:.6rem;align-items:center;margin-top:1.4rem">' +
          '<button type="submit" class="btn btn--primary">Lagre admin-passord</button>' +
        '</div>' +
        '<p class="form__status" id="cs-status" style="margin-top:.6rem"></p>' +
      '</form>';

    wrap.querySelector("#cs-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var sc2 = getSC();
      sc2.adminPassword = wrap.querySelector("#cs-apass").value;
      saveSC(sc2);
      statusMsg(wrap.querySelector("#cs-status"), "✓ Passord lagra!", true);
    });
    wrap.querySelector("#cs-reset-btn").addEventListener("click", resetSC);
  }

  /* =========================================================================
     SEKSJONSDISPATCH
     ====================================================================== */
  var TITLES = {
    produkt:"Produkt", web:"Web", workspace:"Workspace",
    modular:"Modular", analyse:"Analyse", personvern:"Personvern", system:"System"
  };
  var RENDERERS = {
    produkt:    renderProdukt,
    web:        renderWeb,
    workspace:  renderWorkspace,
    modular:    renderModular,
    analyse:    renderAnalyse,
    personvern: renderPersonvern,
    system:     renderSystem
  };

  function renderSection(id) {
    var content = document.getElementById("cs-content");
    if (!content) return;
    content.innerHTML =
      '<div class="cs-page-head"><h1 class="cs-page-title">' + C.esc(TITLES[id] || id) + '</h1></div>' +
      '<div id="cs-section-wrap"></div>';
    var fn = RENDERERS[id];
    if (fn) fn(getSC(), document.getElementById("cs-section-wrap"));
  }

  /* =========================================================================
     INIT
     ====================================================================== */
  document.addEventListener("DOMContentLoaded", function () {
    applyConsoleTheme();
    if (isAuthed()) {
      buildShell();
    } else {
      buildLogin();
    }
  });

  return { navigate: navigate };
})();
