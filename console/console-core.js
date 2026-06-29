/* =============================================================================
   console-core.js  —  Vibeverk Console (per-kunde superadmin)
   -----------------------------------------------------------------------------
   Fullside admin-grensesnitt for Vibeverk-operatørar. Lastar etter core.js
   og overrider CSS-variablar til eit nøytralt konsolltema uavhengig av
   kundebranding. Skriv superconfig via App.store — endringane er aktive
   neste gong kunden lastar nettsida / Workspace.
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
     AUTH
     ====================================================================== */
  var AUTH_KEY = NS + ":console-auth";

  function isAuthed() { return sessionStorage.getItem(AUTH_KEY) === "ok"; }

  function doLogin(pw) {
    var ok = pw === (CFG.admin && CFG.admin.password);
    if (ok) sessionStorage.setItem(AUTH_KEY, "ok");
    return ok;
  }

  function logout() { sessionStorage.removeItem(AUTH_KEY); location.reload(); }

  /* =========================================================================
     SUPERCONFIG I/O
     ====================================================================== */
  function getSC()      { return App.store.get(SUPER_KEY, {}) || {}; }
  function saveSC(sc)   { App.store.set(SUPER_KEY, sc); }
  function resetSC() {
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
    setTimeout(function () { if (el) el.textContent = ""; }, 3000);
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

  function colorField(id, label, value) {
    return '<div class="field"><label>' + C.esc(label) + '</label>' +
      '<input type="color" id="' + id + '" value="' + C.esc(value) + '"></div>';
  }

  function saveBtn() {
    return '<div style="display:flex;gap:.6rem;align-items:center;margin-top:1.4rem">' +
      '<button type="submit" class="btn btn--primary">Lagre og bruk</button>' +
    '</div>' +
    '<p class="form__status" id="cs-status" style="margin-top:.6rem"></p>';
  }

  /* =========================================================================
     LOGIN
     ====================================================================== */
  function buildLogin() {
    var app = document.getElementById("console-app");
    app.innerHTML =
      '<div class="cs-login-wrap">' +
        '<div class="cs-login-box">' +
          '<div class="cs-login-brand"><span class="ti ti-layout-grid"></span> Console</div>' +
          '<p class="cs-login-sub">' + C.esc((CFG.company && CFG.company.name) || "Vibeverk") + '</p>' +
          '<form id="cs-login-form">' +
            C.field({ id: "cs-pw", label: "Passord", type: "password" }) +
            '<p id="cs-login-err" style="color:#c0392b;font-size:.87rem;min-height:1.2em;margin:.4rem 0 0"></p>' +
            '<button type="submit" class="btn btn--primary" style="width:100%;margin-top:.8rem;justify-content:center">Logg inn</button>' +
          '</form>' +
        '</div>' +
      '</div>';

    document.getElementById("cs-login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var pw = document.getElementById("cs-pw").value;
      if (doLogin(pw)) {
        buildShell();
      } else {
        document.getElementById("cs-login-err").textContent = "Feil passord.";
        document.getElementById("cs-pw").value = "";
        document.getElementById("cs-pw").focus();
      }
    });
    setTimeout(function () { var el = document.getElementById("cs-pw"); if (el) el.focus(); }, 50);
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
      { val: "web",       label: "Web",             desc: "Berre offentleg nettside" },
      { val: "workspace", label: "Workspace",        desc: "Berre intranett (ingen nettside)" },
      { val: "full",      label: "Web + Workspace",  desc: "Nettside og intranett" }
    ];
    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Produktpakke</legend>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 1rem">Bestemmer kva produkt kunden har tilgang til.</p>' +
          opts.map(function (o) {
            return '<label class="cs-radio-label">' +
              '<input type="radio" name="cs-mode" value="' + o.val + '"' + (mode === o.val ? " checked" : "") + '>' +
              '<span><strong>' + C.esc(o.label) + '</strong> — ' + C.esc(o.desc) + '</span>' +
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
      statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra!", true);
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
            colorField("cs-primary",   "Primærfarge",   col.primary   || "#1a7a6e") +
            colorField("cs-secondary", "Sekundærfarge", col.secondary || "#c17f3e") +
          '</div>' +
          colorField("cs-bg", "Bakgrunnsfarge", col.background || "#fbfaf8") +
          '<div class="bk-2col">' +
            colorField("cs-text",    "Tekstfarge",    col.text    || "#1B1B1F") +
            colorField("cs-surface", "Overflate",     col.surface || "#ffffff") +
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
        '</fieldset>' +
        saveBtn() +
      '</form>';

    wrap.querySelectorAll("[data-pair]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = FONT_PAIRS[parseInt(btn.getAttribute("data-pair"), 10)];
        if (!p) return;
        wrap.querySelector("#cs-dfont").value = p.display;
        wrap.querySelector("#cs-bfont").value = p.body;
        wrap.querySelector("#cs-dweights").value = "600,700,800";
        wrap.querySelector("#cs-bweights").value = "400,500,600";
      });
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
    var col = Object.assign({}, CFG.colors, sc.colors || {});
    var wsp = Object.assign({}, CFG.workspace || {}, sc.workspace || {});

    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Workspace-innstillingar</legend>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Desse innstillingane gjeld berre Workspace (intranett), uavhengig av nettside-brandinga.</p>' +
          C.field({ id:"cs-wsp-name", label:"Arbeidsområdenamn", value: wsp.name || "", placeholder:"Tomt = brukar firmanamnet" }) +
          colorField("cs-wsp-accent", "Aksentfarge (Workspace)", wsp.accentColor || col.primary || "#2563eb") +
          '<p style="font-size:.78rem;color:var(--color-muted);margin:.3rem 0 0">Overrider primærfargen berre i Workspace — nettsida brukar framleis sin eigen farge.</p>' +
        '</fieldset>' +
        saveBtn() +
      '</form>';

    wrap.querySelector("#cs-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var sc2 = getSC();
      sc2.workspace = {
        name:        wrap.querySelector("#cs-wsp-name").value.trim(),
        accentColor: wrap.querySelector("#cs-wsp-accent").value
      };
      saveSC(sc2);
      statusMsg(wrap.querySelector("#cs-status"), "✓ Lagra!", true);
    });
  }

  function renderModular(sc, wrap) {
    var ft  = Object.assign({}, CFG.features          || {}, sc.features          || {});
    var ift = Object.assign({}, CFG.intranettFeatures  || {}, sc.intranettFeatures  || {});

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
            hint:"Plausible → Site Settings → Visibility → Embed dashboard. Visast direkte i kundens Analyse-fane." }) +
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
    var supaUrl = (CFG.supabase && CFG.supabase.url) || "—";
    var supaKey = (CFG.supabase && CFG.supabase.anonKey) || "";
    var supaKeyShort = supaKey ? supaKey.slice(0, 40) + "…" : "—";

    wrap.innerHTML =
      '<form id="cs-form">' +
        '<fieldset class="admin-group"><legend>Admin-passord (for kunden)</legend>' +
          C.field({ id:"cs-apass", label:"Passord", value: CFG.admin && CFG.admin.password || "" }) +
          '<p style="font-size:.78rem;color:var(--color-muted);margin:.3rem 0 0">Kunden brukar dette for å opne web-admin via #admin. Endringa er aktiv ved neste sideopplasting.</p>' +
        '</fieldset>' +
        '<fieldset class="admin-group"><legend>Supabase-prosjekt</legend>' +
          '<div style="font-size:.87rem;color:var(--color-muted);display:grid;gap:.4rem">' +
            '<div><strong>URL:</strong> ' + C.esc(supaUrl) + '</div>' +
            '<div><strong>Anon-nøkkel:</strong> <code style="font-size:.76rem;word-break:break-all">' + C.esc(supaKeyShort) + '</code></div>' +
          '</div>' +
        '</fieldset>' +
        '<fieldset class="admin-group cs-danger-zone"><legend>Faresone</legend>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Nullstilling slettar all superconfig og startar frå config.js-verdiane. Kan ikkje angrast.</p>' +
          '<button type="button" class="btn btn--ghost" id="cs-reset-btn" style="border-color:#c0392b;color:#c0392b">Nullstill all konfig</button>' +
        '</fieldset>' +
        '<div style="display:flex;gap:.6rem;align-items:center;margin-top:1.4rem">' +
          '<button type="submit" class="btn btn--primary">Lagre passord</button>' +
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
    produkt: renderProdukt, web: renderWeb, workspace: renderWorkspace,
    modular: renderModular, analyse: renderAnalyse, personvern: renderPersonvern,
    system:  renderSystem
  };

  function renderSection(id) {
    var content = document.getElementById("cs-content");
    if (!content) return;
    var sc = getSC();
    content.innerHTML =
      '<div class="cs-page-head"><h1 class="cs-page-title">' + C.esc(TITLES[id] || id) + '</h1></div>' +
      '<div id="cs-section-wrap"></div>';
    var fn = RENDERERS[id];
    if (fn) fn(sc, document.getElementById("cs-section-wrap"));
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
