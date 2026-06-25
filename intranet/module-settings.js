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
  var EMAIL_PROV_KEY = "wsp-email-provider";

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

      /* --- E-postkonfigurasjon (CRM) ----------------------------------------- */
      emailProviderCard() +

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

    /* Bind e-postleverandør */
    var epSaved = root.querySelector("#email-prov-save");
    if (epSaved) {
      /* Vis konfig-felt basert på valg */
      function updateEmailProviderUI() {
        var sel = root.querySelector("input[name='email-prov']:checked");
        var cfg = root.querySelector("#email-prov-cfg");
        if (!sel || !cfg) return;
        var prov = sel.value;
        var fields = {
          m365: [["Tenant ID","email-m365-tenant","text","xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"],
                 ["Klient-ID (Azure App)","email-m365-client","text","xxxxxxxx-…"],
                 ["Klient-hemmelighet","email-m365-secret","password","…"]],
          gmail: [["Klientepost (Google)","email-gmail-user","email","deg@gmail.com"],
                  ["App-passord","email-gmail-pass","password","16-tegns app-passord"]],
          imap:  [["IMAP-server","email-imap-host","text","mail.bedrift.no"],
                  ["SMTP-server","email-smtp-host","text","smtp.bedrift.no"],
                  ["Brukernavn","email-imap-user","email","post@bedrift.no"],
                  ["Passord","email-imap-pass","password","…"]],
          vibe:  [["Dette er Vibeverkmail. Ingen ekstra konfig kreves.","","info",""]]
        };
        if (prov === "none" || !fields[prov]) { cfg.innerHTML = ""; return; }
        cfg.innerHTML = fields[prov].map(function (f) {
          if (f[2] === "info") return '<p style="font-size:.85rem;color:var(--color-muted);margin:0 0 .4rem">' + C.esc(f[0]) + '</p>';
          return field(f[1], f[0], "", f[2], f[3]);
        }).join("") +
        '<p style="font-size:.75rem;color:var(--color-muted);margin:.4rem 0 0">' +
          '<i class="ti ti-info-circle"></i> Kobling til ekstern e-posttjeneste er ikke implementert ennå — dette er en forhåndsvisning.</p>';
      }
      root.querySelectorAll("input[name='email-prov']").forEach(function (r) {
        r.addEventListener("change", updateEmailProviderUI);
      });
      updateEmailProviderUI();
      epSaved.addEventListener("click", function () {
        var sel = root.querySelector("input[name='email-prov']:checked");
        if (!sel) return;
        App.store.set(EMAIL_PROV_KEY, sel.value);
        var st = root.querySelector("#email-prov-status");
        st.textContent = "Valg lagret."; st.className = "form__status is-ok";
        setTimeout(function () { if (st) st.textContent = ""; }, 2000);
      });
    }

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
     E-POST PROVIDER CARD
     ====================================================================== */
  function emailProviderCard() {
    var current = App.store.get(EMAIL_PROV_KEY, "none") || "none";
    var PROVS = [
      { id: "none",  icon: "mail-off",   label: "Ikke konfigurert",
        desc: "E-post sendes ikke. Telefonnotater og interne notater fungerer som normalt." },
      { id: "m365",  icon: "brand-office",label: "Microsoft 365",
        desc: "Koble til Outlook via Azure AD App Registration." },
      { id: "gmail", icon: "brand-google",label: "Gmail / Google Workspace",
        desc: "Koble til Gmail med en Google Cloud OAuth-app." },
      { id: "imap",  icon: "server",      label: "IMAP / SMTP",
        desc: "Koble til hvilken som helst e-posttjeneste via standard IMAP og SMTP." },
      { id: "vibe",  icon: "sparkles",    label: "Vibeverk Mail",
        desc: "Bruk Vibeverkmail (kommer snart) — ingen ekstra oppsett kreves." }
    ];

    return '<div class="i-card" style="margin-bottom:1rem">' +
      '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">' +
        '<p class="i-section-label" style="margin:0;flex:1">E-postkonfigurasjon</p>' +
        '<span style="font-size:.68rem;font-weight:700;padding:.1rem .4rem;border-radius:999px;' +
             'background:var(--color-alt);color:var(--color-muted)">Mockup</span>' +
      '</div>' +
      '<p style="font-size:.85rem;color:var(--color-muted);margin:.3rem 0 .9rem;line-height:1.5">' +
        'Koble CRM-modulen til e-post for å sende og motta e-post direkte på kundekortet.' +
      '</p>' +
      '<div style="display:grid;gap:.45rem;margin-bottom:.9rem">' +
        PROVS.map(function (p) {
          var active = p.id === current;
          return '<label style="display:flex;align-items:flex-start;gap:.75rem;padding:.65rem .85rem;' +
            'border:1.5px solid ' + (active ? "var(--color-primary)" : "var(--color-border)") + ';' +
            'border-radius:10px;cursor:pointer;background:' + (active ? "color-mix(in srgb,var(--color-primary) 6%,var(--color-surface))" : "var(--color-surface)") + '">' +
            '<input type="radio" name="email-prov" value="' + p.id + '" ' + (active ? "checked" : "") + ' ' +
              'style="margin-top:.2rem;accent-color:var(--color-primary)">' +
            '<div style="display:flex;align-items:flex-start;gap:.6rem;flex:1;min-width:0">' +
              '<i class="ti ti-' + p.icon + '" style="font-size:1.1rem;color:' + (active ? "var(--color-primary)" : "var(--color-muted)") + ';flex-shrink:0;margin-top:.1rem"></i>' +
              '<div>' +
                '<div style="font-size:.9rem;font-weight:600">' + C.esc(p.label) + '</div>' +
                '<div style="font-size:.78rem;color:var(--color-muted);line-height:1.4;margin-top:.1rem">' + C.esc(p.desc) + '</div>' +
              '</div>' +
            '</div>' +
          '</label>';
        }).join("") +
      '</div>' +
      '<div id="email-prov-cfg" style="margin-bottom:.7rem"></div>' +
      '<div style="display:flex;align-items:center;gap:.5rem">' +
        '<button class="btn btn--primary btn--sm" id="email-prov-save">Lagre valg</button>' +
        '<span class="form__status" id="email-prov-status"></span>' +
      '</div>' +
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
