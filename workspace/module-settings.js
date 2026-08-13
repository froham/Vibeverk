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
    var theme = prefs.theme || "light";
    root.setAttribute("data-theme",   theme);
    root.setAttribute("data-density", prefs.density || "normal");
    // Held iOS Safari sin status-/adresselinje-farge i takt med #intranet sin
    // eigen --color-bg (sjå workspace/index.html) -- utan dette gjettar Safari
    // sjølv, upåliteleg ved SPA-navigering (2026-07-25-funnet).
    var themeColorTag = document.querySelector('meta[name="theme-color"]');
    if (themeColorTag) themeColorTag.setAttribute("content", theme === "dark" ? "#0f172a" : "#f1f5f9");
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
              field("settings-name",  "Bedriftsnavn", s.tenantName,   "text",  "Nordpunkt AS",
                "Vises i sidepanelet for alle i Workspace. Kan bli overstyrt hvis Vibeverk har satt et eget arbeidsområdenavn for dere.") +
              field("settings-email", "Kontakt-e-post", s.contactEmail, "email", "post@bedrift.no",
                "Kun en lagret notat-e-post foreløpig — brukes ikke andre steder i løsningen ennå.") +
              '<div style="margin-top:.4rem">' +
                '<button type="submit" class="btn btn--primary btn--sm">Lagre</button>' +
                ' <span class="form__status" id="settings-status"></span>' +
              '</div>' +
            '</form>' +
          '</div>'
        : '') +

      /* --- E-postkonfigurasjon (CRM) — berre admin -------------------------- */
      (isAdmin ? emailProviderCard() : "") +

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

      /* --- To-faktor-innlogging (TOTP, 2026-08-13) ---------------------------
         Valfri, sjølvmeldt av kvar brukar -- ikkje avhengig av rolle, alle
         som har ein ekte Supabase-konto (App.supabase) kan skru han på for
         seg sjølv. Faktoren gjeld same auth.users-rad på tvers av Web-admin
         og Workspace (delt Supabase-prosjekt), så innlogging på BEGGE
         flatene krev koden når fyrst skrudd på (sjå mfaChallengeThenProceed()
         i core.js/workspace-core.js). ------------------------------------- */
      (App.supabase
        ? '<div class="i-card" style="margin-bottom:1rem">' +
            '<p class="i-section-label">To-faktor-innlogging</p>' +
            '<div id="settings-mfa-body"><p style="color:var(--color-muted);font-size:.85rem">Sjekker status…</p></div>' +
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

    /* Bind reset (berre admin) */
    var resetBtn = root.querySelector("#settings-reset");
    if (resetBtn) resetBtn.addEventListener("click", function () {
      if (!confirm("Nullstiller innstillingar, oppgåver, notat og aktivitetslogg for Workspace. Kunngjeringar, kunnskapsbase, lenker og anna innhald vert IKKJE påverka. Kan ikkje angrast. Er du sikker?")) return;
      resetWspData();
      applyPrefs({ theme: "light", density: "normal" });
      var st = root.querySelector("#settings-reset-status");
      st.textContent = "Nullstilt."; st.className = "form__status is-ok";
      Intranet.refresh();
      setTimeout(function () { renderSettings(root, role); }, 500);
    });

    if (App.supabase) renderMfaCard(root);
  }

  /* =========================================================================
     TO-FAKTOR-INNLOGGING (TOTP)-KORT
     ====================================================================== */
  // Seks enkeltsifra-bokser (i staden for eitt fritekstfelt) -- same
  // hjelpefunksjonar (og same grunngjeving) som core.js/workspace-core.js
  // sine eigne versjonar, brukt i innloggingsutfordringa -- her ved
  // stadfesting av ein splitter ny faktor, ikkje ved sjølve innlogginga.
  function mfaCodeBoxesHtml() {
    var boxes = "";
    for (var i = 0; i < 6; i++) {
      boxes += '<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="one-time-code" aria-label="Siffer ' + (i + 1) + ' av 6" data-mfa-digit style="width:2.6rem;height:3.1rem;text-align:center;font-size:1.35rem;font-weight:700;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);color:inherit">';
    }
    return '<div style="display:flex;gap:.5rem;margin:0 0 .3rem">' + boxes + '</div>';
  }
  function wireMfaCodeBoxes(container, doSubmit) {
    var boxes = Array.prototype.slice.call(container.querySelectorAll("[data-mfa-digit]"));
    function currentCode() { return boxes.map(function (b) { return b.value; }).join(""); }
    boxes.forEach(function (box, i) {
      box.addEventListener("input", function () {
        box.value = box.value.replace(/[^0-9]/g, "").slice(-1);
        if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
        if (currentCode().length === boxes.length) doSubmit();
      });
      box.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !box.value && i > 0) { boxes[i - 1].focus(); boxes[i - 1].value = ""; }
      });
      box.addEventListener("paste", function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData("text").replace(/[^0-9]/g, "");
        if (!text) return;
        boxes.forEach(function (b, j) { b.value = text[j] || ""; });
        var lastFilled = Math.min(text.length, boxes.length) - 1;
        if (lastFilled >= 0) boxes[lastFilled].focus();
        if (currentCode().length === boxes.length) doSubmit();
      });
    });
    if (boxes[0]) setTimeout(function () { boxes[0].focus(); }, 50);
    return currentCode;
  }

  function renderMfaCard(root) {
    var body = root.querySelector("#settings-mfa-body");
    if (!body) return;
    App.supabase.auth.mfa.listFactors().then(function (lf) {
      if (lf.error) {
        body.innerHTML = '<p style="color:#c0392b;font-size:.85rem">Kunne ikkje hente status. Prøv å laste sida på nytt.</p>';
        return;
      }
      var factor = lf.data && lf.data.totp && lf.data.totp[0];
      if (factor) { renderMfaOn(body, factor); return; }
      renderMfaOff(body);
    });
  }

  function renderMfaOff(body) {
    body.innerHTML =
      '<p style="font-size:.85rem;color:var(--color-muted);margin:0 0 .7rem">Krev en kode fra en autentiseringsapp (f.eks. Google Authenticator) i tillegg til passord ved innlogging. Gjelder både Web-admin og Workspace.</p>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="settings-mfa-enroll-btn">Skru på to-faktor-innlogging</button>' +
      '<p class="form__status" id="settings-mfa-enroll-status"></p>';
    body.querySelector("#settings-mfa-enroll-btn").addEventListener("click", function () {
      var statusEl = body.querySelector("#settings-mfa-enroll-status");
      statusEl.className = ""; statusEl.textContent = "Setter opp…";
      App.supabase.auth.mfa.enroll({ factorType: "totp" }).then(function (r) {
        if (r.error) { statusEl.className = "form__status is-error"; statusEl.textContent = r.error.message; return; }
        renderMfaEnrollStep(body, r.data);
      });
    });
  }

  function renderMfaEnrollStep(body, enrollData) {
    body.innerHTML =
      '<p style="font-size:.85rem;color:var(--color-muted);margin:0 0 .7rem">Skann koden under med autentiseringsappen din (f.eks. Google Authenticator), eller skriv inn nøkkelen manuelt. Skriv så inn koden appen viser, for å bekrefte.</p>' +
      '<div style="max-width:200px;margin:0 0 .7rem">' + enrollData.totp.qr_code + '</div>' +
      '<p style="font-size:.78rem;color:var(--color-muted);margin:0 0 .9rem;word-break:break-all">Manuell nøkkel: <code>' + C.esc(enrollData.totp.secret) + '</code></p>' +
      '<div id="settings-mfa-verify-form" style="display:grid;gap:.6rem;max-width:280px">' +
        mfaCodeBoxesHtml() +
        '<div style="display:flex;align-items:center;gap:.7rem">' +
          '<button type="button" class="btn btn--primary btn--sm" id="settings-mfa-verify-btn">Bekreft</button>' +
          '<button type="button" class="btn btn--ghost btn--sm" id="settings-mfa-cancel-btn">Avbryt</button>' +
          '<span class="form__status" id="settings-mfa-verify-status"></span>' +
        '</div>' +
      '</div>';
    body.querySelector("#settings-mfa-cancel-btn").addEventListener("click", function () {
      // Sjølve enroll()-kallet oppretter alt eit "unverified"-faktor -- fjern
      // det att viss brukaren avbryt, elles hopar det seg opp som daude,
      // aldri-stadfesta faktor ved kvart avbrotne forsøk.
      App.supabase.auth.mfa.unenroll({ factorId: enrollData.id }).then(function () { renderMfaOff(body); });
    });
    var verifyForm = body.querySelector("#settings-mfa-verify-form");
    function submitVerify(code) {
      var statusEl = body.querySelector("#settings-mfa-verify-status");
      if (!code || code.length !== 6) return;
      statusEl.className = ""; statusEl.textContent = "Sjekker…";
      App.supabase.auth.mfa.challenge({ factorId: enrollData.id }).then(function (ch) {
        if (ch.error) { statusEl.className = "form__status is-error"; statusEl.textContent = ch.error.message; return; }
        App.supabase.auth.mfa.verify({ factorId: enrollData.id, challengeId: ch.data.id, code: code }).then(function (v) {
          if (v.error) { statusEl.className = "form__status is-error"; statusEl.textContent = "Feil kode. Prøv igjen."; return; }
          renderMfaOn(body, { id: enrollData.id });
        });
      });
    }
    var getVerifyCode = wireMfaCodeBoxes(verifyForm, function () { submitVerify(getVerifyCode()); });
    body.querySelector("#settings-mfa-verify-btn").addEventListener("click", function () { submitVerify(getVerifyCode()); });
  }

  function renderMfaOn(body, factor) {
    body.innerHTML =
      '<p style="font-size:.85rem;margin:0 0 .7rem"><i class="ti ti-circle-check" style="color:#16a34a"></i> Skrudd på.</p>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="settings-mfa-off-btn" style="color:#c0392b;border-color:#c0392b">Skru av to-faktor-innlogging</button>' +
      '<p class="form__status" id="settings-mfa-off-status"></p>';
    body.querySelector("#settings-mfa-off-btn").addEventListener("click", function () {
      // Tier B-varsel (destruktivt, svekker tryggleiken på kontoen): tydeleg
      // om KVA som skjer, ikkje berre "er du sikker".
      if (!confirm("Skrur av to-faktor-innlogging for kontoen din. Etter dette held passord åleine fram med å vere nok til å logge inn. Vil du fortsette?")) return;
      var statusEl = body.querySelector("#settings-mfa-off-status");
      statusEl.className = ""; statusEl.textContent = "Skrur av…";
      App.supabase.auth.mfa.unenroll({ factorId: factor.id }).then(function (r) {
        if (r.error) { statusEl.className = "form__status is-error"; statusEl.textContent = r.error.message; return; }
        renderMfaOff(body);
      });
    });
  }

  /* =========================================================================
     E-POST PROVIDER CARD
     ====================================================================== */
  function emailProviderCard() {
    var CFG = window.SITE_CONFIG || {};
    var crmFull = !!(CFG.features && CFG.features.crm && CFG.features.crmFull);
    var IFEAT = CFG.intranettFeatures || {};
    var replyModules = [];
    if (IFEAT.contact) replyModules.push("Kontakt");
    if (IFEAT.booking) replyModules.push("Booking");
    if (IFEAT.quote)   replyModules.push("Tilbud");
    var replyModulesText = replyModules.length === 0 ? "" :
      replyModules.length === 1 ? " fra " + replyModules[0] :
      " fra " + replyModules.slice(0, -1).join(", ") + " og " + replyModules[replyModules.length - 1];

    return '<div class="i-card" style="margin-bottom:1rem">' +
      '<p class="i-section-label" style="margin:0 0 .5rem">E-postsvar</p>' +
      '<p style="font-size:.85rem;line-height:1.5;margin:0 0 .5rem">' +
        (crmFull
          ? '<i class="ti ti-circle-check" style="color:#16a34a"></i> Dere kan svare direkte' + C.esc(replyModulesText) + ' i systemet, uten å bytte til e-postprogrammet deres.'
          : '<i class="ti ti-mail-forward" style="color:var(--color-muted)"></i> Svar må sendes fra e-postprogrammet deres (f.eks. Outlook) — direkte svar herfra i systemet er ikke satt opp for dere.') +
      '</p>' +
      '<p style="font-size:.78rem;color:var(--color-muted);margin:0">' +
        (crmFull
          ? '<i class="ti ti-info-circle"></i> Svar fra kunder på en e-post sendt herfra dukker automatisk opp i historikken til riktig kunde under «Kunder».'
          : '<i class="ti ti-info-circle"></i> Å motta e-post direkte inn i systemet er ikke støttet ennå — svar fra kunder kommer fortsatt som vanlig e-post i innboksen deres.') +
      '</p>' +
    '</div>';
  }

  /* =========================================================================
     HJELPERE
     ====================================================================== */
  function field(id, label, value, type, placeholder, hint) {
    var input = '<input id="' + C.esc(id) + '" type="' + C.esc(type || "text") + '"' +
        ' value="' + C.esc(value || "") + '"' +
        ' placeholder="' + C.esc(placeholder || "") + '">';
    var control = type === "password" ? '<div class="pw-field">' + input + C.passwordToggle() + '</div>' : input;
    return '<div class="i-field">' +
      '<label for="' + C.esc(id) + '">' + C.esc(label) + '</label>' +
      control +
      (hint ? '<p class="i-hint">' + C.esc(hint) + '</p>' : '') +
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
