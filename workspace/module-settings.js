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

  var STORE_KEY     = "wsp-settings";
  var PREFS_KEY     = "wsp-prefs";

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

  function mount(outlet, ctx) {
    var root = outlet.querySelector("#settings-root") || outlet;
    renderSettings(root, ctx && ctx.role);
  }

  function renderSettings(root, role) {
    var isAdmin = role === "admin";
    var s = getSettings();

    root.innerHTML =
      '<div class="i-page-head"><h2>Innstillinger</h2></div>' +

      /* --- Utseende ------------------------------------------------------- */
      '<div class="i-card" style="margin-bottom:1rem">' +
        '<p class="i-section-label">Utseende</p>' +
        '<p style="font-size:.85rem;font-weight:600;margin:0 0 .4rem">Tema</p>' +
        '<p style="font-size:.8rem;color:var(--color-muted);margin:0 0 .6rem">Gjeld berre denne nettlesaren.</p>' +
        '<div style="display:flex;gap:.45rem">' +
          '<button type="button" class="pref-theme-btn btn btn--ghost btn--sm" data-theme-val="light"><i class="ti ti-sun"></i> Lyst</button>' +
          '<button type="button" class="pref-theme-btn btn btn--ghost btn--sm" data-theme-val="dark"><i class="ti ti-moon"></i> Mørkt</button>' +
        '</div>' +
      '</div>' +

      /* --- Workspace-innstillinger (berre admin) ----------------------------- */
      (isAdmin
        ? '<div class="i-card" style="margin-bottom:1rem">' +
            '<p class="i-section-label">Workspace</p>' +
            '<form class="i-form" id="settings-form">' +
              field("settings-name",  "Bedriftsnavn", s.tenantName,   "text",  "Nordpunkt AS") +
              field("settings-email", "Kontakt-e-post", s.contactEmail, "email", "post@bedrift.no") +
              '<div style="margin-top:.4rem">' +
                '<button type="submit" class="btn btn--primary btn--sm">Lagre</button>' +
                ' <span class="form__status" id="settings-status"></span>' +
              '</div>' +
            '</form>' +
          '</div>'
        : '') +

      /* --- E-postkonfigurasjon (CRM) — berre admin -------------------------- */
      (isAdmin ? emailProviderCard() : "") +

      /* --- Supabase-synkronisering — berre admin ---------------------------- */
      (isAdmin && App.supabase
        ? '<div class="i-card" style="margin-bottom:1rem">' +
            '<p class="i-section-label">Synkronisering</p>' +
            '<p style="font-size:.88rem;color:var(--color-muted);margin:.3rem 0 .9rem">' +
              'Last opp alle lokale data til Supabase — nødvendig første gang, eller om data kun finnes på denne enheten.' +
            '</p>' +
            '<button class="btn btn--primary btn--sm" id="settings-sync-up">Last opp til Supabase</button>' +
            ' <span class="form__status" id="settings-sync-status"></span>' +
          '</div>'
        : '') +

      /* --- Endre passord ----------------------------------------------------- */
      (App.supabase
        ? '<div class="i-card" style="margin-bottom:1rem">' +
            '<p class="i-section-label">Endre passord</p>' +
            '<div style="display:grid;gap:.9rem;max-width:360px">' +
              field("settings-pass1", "Nytt passord", "", "password", "Minst 8 teikn") +
              '<div id="settings-pass-strength" style="display:grid;gap:.25rem;padding:.65rem .9rem;background:var(--color-alt);border-radius:10px;font-size:.8rem"></div>' +
              field("settings-pass2", "Gjenta passord", "", "password", "") +
              '<div style="display:flex;align-items:center;gap:.8rem">' +
                '<button class="btn btn--primary btn--sm" id="settings-change-pass">Endre passord</button>' +
                '<span class="form__status" id="settings-pass-status"></span>' +
              '</div>' +
            '</div>' +
          '</div>'
        : '') +

      /* --- Farlig sone — berre admin ----------------------------------------- */
      (isAdmin
        ? '<div class="i-card" style="border-color:color-mix(in srgb,#c0392b 35%,transparent)">' +
        '<p class="i-section-label" style="color:#c0392b">Farlig sone</p>' +
        '<p style="font-size:.88rem;color:var(--color-muted);margin:.3rem 0 .9rem">' +
          'Nullstiller kun intranett-data (oppgaver, notater, aktivitetslogg, innstillinger). ' +
          'Offentlig innhold, leads og mediabank påvirkes ikke.' +
        '</p>' +
        '<button class="btn btn--danger btn--sm" id="settings-reset">Nullstill intranett-data</button>' +
        ' <span class="form__status" id="settings-reset-status"></span>' +
        '</div>'
        : '');

    /* Bind skjema (berre admin) */
    var settingsForm = root.querySelector("#settings-form");
    if (settingsForm) settingsForm.addEventListener("submit", function (e) {
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

    /* Bind endre passord */
    var pass1El    = root.querySelector("#settings-pass1");
    var strengthEl = root.querySelector("#settings-pass-strength");
    var changePsBtn = root.querySelector("#settings-change-pass");

    function passRules(pw) {
      return [
        { label: "Minst 8 teikn",        ok: pw.length >= 8 },
        { label: "Stor bokstav (A–Z)",    ok: /[A-Z]/.test(pw) },
        { label: "Liten bokstav (a–z)",   ok: /[a-z]/.test(pw) },
        { label: "Tal (0–9)",              ok: /[0-9]/.test(pw) },
        { label: "Spesialtegn (!@#$…)",   ok: /[^A-Za-z0-9]/.test(pw) }
      ];
    }

    function renderStrength(pw) {
      if (!strengthEl) return;
      strengthEl.innerHTML = passRules(pw).map(function (r) {
        return '<div style="display:flex;align-items:center;gap:.4rem;color:' + (r.ok ? '#16a34a' : 'var(--color-muted)') + '">' +
          '<i class="ti ti-' + (r.ok ? 'circle-check' : 'circle') + '" style="font-size:.85rem"></i>' +
          r.label + '</div>';
      }).join("");
    }

    if (pass1El) {
      renderStrength("");
      pass1El.addEventListener("input", function () { renderStrength(this.value); });
    }

    if (changePsBtn) {
      changePsBtn.addEventListener("click", function() {
        var p1    = pass1El ? pass1El.value : "";
        var p2    = root.querySelector("#settings-pass2").value;
        var st    = root.querySelector("#settings-pass-status");
        var rules = passRules(p1);
        var failed = rules.find(function (r) { return !r.ok; });
        st.className = "form__status";
        if (failed) { st.textContent = failed.label + " manglar."; st.className = "form__status is-error"; return; }
        if (p1 !== p2) { st.textContent = "Passorda er ikkje like."; st.className = "form__status is-error"; return; }
        App.supabase.auth.updateUser({ password: p1 }).then(function(r) {
          if (r.error) { st.textContent = r.error.message; st.className = "form__status is-error"; return; }
          st.textContent = "Passord endra."; st.className = "form__status is-ok";
          if (pass1El) pass1El.value = "";
          root.querySelector("#settings-pass2").value = "";
          renderStrength("");
          setTimeout(function() { if (st) st.textContent = ""; }, 3000);
        });
      });
    }

    /* Bind synk-opp */
    var syncUpBtn = root.querySelector("#settings-sync-up");
    if (syncUpBtn) {
      syncUpBtn.addEventListener("click", function () {
        var st = root.querySelector("#settings-sync-status");
        var keys = App.allStoreKeys ? App.allStoreKeys() : [];
        var count = 0;
        keys.forEach(function (k) {
          var val = App.store.get(k, null);
          if (val !== null) { App.store.set(k, val); count++; }
        });
        st.textContent = "Synkroniserer " + count + " nøklar…"; st.className = "form__status is-ok";
        setTimeout(function () { if (st) st.textContent = "Ferdig — data er no tilgjengeleg på alle einingar."; }, 600);
      });
    }

    /* Bind reset (berre admin) */
    var resetBtn = root.querySelector("#settings-reset");
    if (resetBtn) resetBtn.addEventListener("click", function () {
      if (!confirm("Er du sikker? All intranett-data slettes permanent.")) return;
      resetWspData();
      applyPrefs({ theme: "light", density: "normal" });
      var st = root.querySelector("#settings-reset-status");
      st.textContent = "Nullstilt."; st.className = "form__status is-ok";
      Intranet.refresh();
      setTimeout(function () { renderSettings(root, role); }, 500);
    });
  }

  /* =========================================================================
     E-POST PROVIDER CARD
     ====================================================================== */
  function emailProviderCard() {
    var CFG = window.SITE_CONFIG || {};
    var crmFull = !!(CFG.features && CFG.features.crm && CFG.features.crmFull);

    return '<div class="i-card" style="margin-bottom:1rem">' +
      '<p class="i-section-label" style="margin:0 0 .5rem">E-postsvar</p>' +
      '<p style="font-size:.85rem;line-height:1.5;margin:0 0 .5rem">' +
        (crmFull
          ? '<i class="ti ti-circle-check" style="color:#16a34a"></i> Sending: aktivert (Vibeverk/Resend). Svar kan sendast direkte frå Kontakt, Booking og Tilbud.'
          : '<i class="ti ti-mail-forward" style="color:var(--color-muted)"></i> Sending: Outlook (e-postklient). Direkte sending er ikkje aktivert for denne kunden.') +
      '</p>' +
      '<p style="font-size:.78rem;color:var(--color-muted);margin:0">' +
        '<i class="ti ti-info-circle"></i> Mottak av e-post er ikkje støtta enno.' +
      '</p>' +
    '</div>';
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
