/* =============================================================================
   module-settings.js  —  INNSTILLINGER (intranett)
   -----------------------------------------------------------------------------
   Bedriftsinnstillinger for intranettet: tenant-navn, brukerpreferanser og
   data reset for wsp-*-nøkler. Tvinger context og App.store i bruk.

   Lagring: App.store.get/set("wsp-settings") — namespacet av core via storageKey.
   Ruter:   #/settings
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  if (!Intranet || !App || !C) return;

  var STORE_KEY  = "wsp-settings";
  var PREFS_KEY  = "wsp-prefs";

  /* =========================================================================
     BRUKERPREFERANSER — mørkt modus + tetthet
     Lagras per browser (localStorage), klar for per-brukar med ekte auth.
     ====================================================================== */
  function getPrefs() {
    return Object.assign({ theme: "light", density: "normal" }, App.store.get(PREFS_KEY, {}) || {});
  }

  function savePrefs(v) { App.store.set(PREFS_KEY, v); }

  function applyPrefs(prefs) {
    var root = document.getElementById("intranet");
    if (!root) return;
    root.setAttribute("data-theme",   prefs.theme   || "light");
    root.setAttribute("data-density", prefs.density || "normal");
  }

  // Bruk lagra preferansar ved oppstart
  applyPrefs(getPrefs());

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getSettings() {
    var CFG = window.SITE_CONFIG || {};
    return Object.assign(
      {
        tenantName:   (CFG.company && CFG.company.name) || "",
        contactEmail: (CFG.contact && CFG.contact.email) || "",
        preferences:  {}
      },
      App.store.get(STORE_KEY, {}) || {}
    );
  }

  function saveSettings(v) {
    App.store.set(STORE_KEY, v);
  }

  /* =========================================================================
     DATA RESET (kun wsp-* nøkler)
     ====================================================================== */
  function resetWspData() {
    // Tøm kun intranett-nøkler. Offentlig innhold, leads, media etc. røres ikke.
    var WSP_KEYS = [
      "wsp-settings", "wsp-tasks", "wsp-notes", "wsp-activity"
    ];
    WSP_KEYS.forEach(function (k) { App.store.remove(k); });
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  function render() {
    return '<div id="settings-root"></div>';
  }

  function mount(outlet) {
    var root = outlet.querySelector("#settings-root") || outlet;
    renderSettings(root);
  }

  function renderSettings(root) {
    var s = getSettings();

    root.innerHTML =
      '<div class="i-page-head"><h2>Innstillinger</h2></div>' +

      /* --- Workspace-innstillinger ---------------------------------------- */
      '<div class="i-card" style="margin-bottom:1rem">' +
        '<p class="i-section-label">Workspace</p>' +
        '<form class="i-form" id="settings-form">' +
          field("settings-name",  "Bedriftsnavn", s.tenantName,   "text",  "Nordpunkt AS") +
          field("settings-email", "Kontakt-e-post", s.contactEmail, "email", "post@bedrift.no") +
          '<div style="margin-top:.4rem">' +
            '<button type="submit" class="btn btn--primary btn--sm">Lagre</button>' +
            ' <span class="form__status" id="settings-status"></span>' +
          '</div>' +
        '</form>' +
      '</div>' +

      /* Utseende-seksjonen er deaktivert — styrast sentralt av admin */

      /* --- Farlig sone ------------------------------------------------------- */
      '<div class="i-card" style="border-color:color-mix(in srgb,#c0392b 35%,transparent)">' +
        '<p class="i-section-label" style="color:#c0392b">Farlig sone</p>' +
        '<p style="font-size:.88rem;color:var(--color-muted);margin:.3rem 0 .9rem">' +
          'Nullstiller kun intranett-data (oppgaver, notater, aktivitetslogg, innstillinger). ' +
          'Offentlig innhold, leads og mediabank påvirkes ikke.' +
        '</p>' +
        '<button class="btn btn--danger btn--sm" id="settings-reset">Nullstill intranett-data</button>' +
        ' <span class="form__status" id="settings-reset-status"></span>' +
      '</div>';

    /* Bind skjema */
    root.querySelector("#settings-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var cur = getSettings();
      cur.tenantName   = root.querySelector("#settings-name").value.trim();
      cur.contactEmail = root.querySelector("#settings-email").value.trim();
      saveSettings(cur);
      Intranet.logActivity({ type: "settings", label: "Innstillinger oppdatert" });
      Intranet.refresh(); // oppdater sidebar-navn
      var st = root.querySelector("#settings-status");
      st.textContent = "Lagret."; st.className = "form__status is-ok";
      setTimeout(function () { if (st) st.textContent = ""; }, 2500);
    });

    /* Bind tema-knapper */
    root.querySelectorAll(".pref-theme-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var prefs = getPrefs();
        prefs.theme = btn.getAttribute("data-theme-val");
        savePrefs(prefs);
        applyPrefs(prefs);
        root.querySelectorAll(".pref-theme-btn").forEach(function (b) {
          b.classList.toggle("is-active-pref", b === btn);
          b.style.background = b === btn ? "var(--color-primary)" : "";
          b.style.color      = b === btn ? "#fff" : "";
          b.style.borderColor= b === btn ? "var(--color-primary)" : "";
        });
      });
      // Sett initial aktiv-stil
      if (btn.getAttribute("data-theme-val") === getPrefs().theme) {
        btn.style.background  = "var(--color-primary)";
        btn.style.color       = "#fff";
        btn.style.borderColor = "var(--color-primary)";
      }
    });

    /* Bind tetthet-knapper */
    root.querySelectorAll(".pref-density-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var prefs = getPrefs();
        prefs.density = btn.getAttribute("data-density-val");
        savePrefs(prefs);
        applyPrefs(prefs);
        root.querySelectorAll(".pref-density-btn").forEach(function (b) {
          b.classList.toggle("is-active-pref", b === btn);
          b.style.background = b === btn ? "var(--color-primary)" : "";
          b.style.color      = b === btn ? "#fff" : "";
          b.style.borderColor= b === btn ? "var(--color-primary)" : "";
        });
      });
      // Sett initial aktiv-stil
      if (btn.getAttribute("data-density-val") === getPrefs().density) {
        btn.style.background  = "var(--color-primary)";
        btn.style.color       = "#fff";
        btn.style.borderColor = "var(--color-primary)";
      }
    });

    /* Bind reset */
    root.querySelector("#settings-reset").addEventListener("click", function () {
      if (!confirm("Er du sikker? All intranett-data slettes permanent.")) return;
      resetWspData();
      applyPrefs({ theme: "light", density: "normal" });
      var st = root.querySelector("#settings-reset-status");
      st.textContent = "Nullstilt."; st.className = "form__status is-ok";
      Intranet.refresh();
      setTimeout(function () { renderSettings(root); }, 500);
    });
  }

  /* =========================================================================
     HJELPERE
     ====================================================================== */
  function field(id, label, value, type, placeholder) {
    return '<div class="i-field">' +
      '<label for="' + C.esc(id) + '">' + C.esc(label) + '</label>' +
      '<input id="' + C.esc(id) + '" type="' + C.esc(type || "text") + '"' +
        ' value="' + C.esc(value || "") + '"' +
        ' placeholder="' + C.esc(placeholder || "") + '">' +
    '</div>';
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  Intranet.registerModule({
    id:       "settings",
    navLabel: "Innstillinger",
    icon:     "settings",
    order:    90,
    render:   render,
    mount:    mount
  });

})();
