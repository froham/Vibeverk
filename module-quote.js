/* =============================================================================
   module-quote.js  —  TILBUD-MODUL
   -----------------------------------------------------------------------------
   Selvstendig IIFE. Lastes etter core.js. Slås av/på med features.quote.
   Registrerer seg som egen side (#tilbud) i toppmenyen og i admin.

   Tre steg for sluttkunden:
     1. Beskrivelse av jobben (fritekst + vedlegg)
     2. Kontaktopplysninger (privat ELLER bedrift) + avhuking av vilkår
     3. Kvittering / fullført

   Kontakt-seksjonen får en «Be om tilbud»-knapp (gjennom at modulen registrerer
   en ekstra CTA som core.js leser fra App.getQuoteCTA()).

   Innsendte tilbud lagres som leads (synlig i admin under Kontakt-fanen).
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App, C = window.Components, CFG = window.SITE_CONFIG || {};
  if (!App || !C) return;
  if (CFG.features && CFG.features.quote === false) return;

  var esc = C.esc;
  var QCF = CFG.quote || {};
  var TERMS_HEADING = QCF.termsHeading || (CFG.privacy && CFG.privacy.heading) || "Vilkår og personvern";
  var TERMS_TEXT    = QCF.termsText    || (CFG.privacy && CFG.privacy.text)    || "Standardvilkår — rediger i config.js under quote.termsText.";
  var MAX_FILE_MB   = 8;

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("qt-styles")) return;
    var s = document.createElement("style");
    s.id = "qt-styles";
    s.textContent = [
      /* Stegindikatoren */
      ".qt-steps{display:flex;align-items:center;gap:0;margin:0 0 2rem;counter-reset:qt}",
      ".qt-step{display:flex;align-items:center;gap:.55rem;font-size:.88rem;color:var(--color-muted);font-weight:500;flex:1}",
      ".qt-step:not(:last-child)::after{content:'';flex:1;height:2px;background:var(--color-border);margin:0 .5rem}",
      ".qt-step__num{width:28px;height:28px;border-radius:50%;border:2px solid var(--color-border);display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;flex-shrink:0;background:var(--color-bg)}",
      ".qt-step.is-active{color:var(--color-primary)}",
      ".qt-step.is-active .qt-step__num{border-color:var(--color-primary);background:var(--color-primary);color:#fff}",
      ".qt-step.is-done{color:var(--color-text)}",
      ".qt-step.is-done .qt-step__num{border-color:var(--color-primary);background:var(--color-tint);color:var(--color-primary)}",
      /* Veiviseren */
      ".qt-panel{max-width:680px}",
      ".qt-panel .section__title{margin-bottom:.3rem}",
      ".qt-lead{color:var(--color-muted);margin:0 0 1.8rem}",
      ".qt-nav{display:flex;justify-content:space-between;align-items:center;margin-top:1.4rem;gap:.8rem}",
      ".qt-nav--end{justify-content:flex-end}",
      /* Vedlegg */
      ".qt-attach{margin-top:.4rem}",
      ".qt-attach-label{display:inline-flex;align-items:center;gap:.4rem;padding:.5rem .9rem;border-radius:8px;border:1.5px solid var(--color-border);cursor:pointer;font-size:.9rem;font:inherit;background:var(--color-bg)}",
      ".qt-attach-label:hover{border-color:var(--color-primary)}",
      ".qt-attach-list{list-style:none;margin:.6rem 0 0;padding:0;display:flex;flex-wrap:wrap;gap:.4rem}",
      ".qt-attach-item{display:inline-flex;align-items:center;gap:.4rem;font-size:.83rem;border:1px solid var(--color-border);border-radius:999px;padding:.25rem .35rem .25rem .75rem;background:var(--color-bg)}",
      ".qt-attach-x{border:0;background:color-mix(in srgb,var(--color-text) 10%,transparent);border-radius:999px;width:20px;height:20px;cursor:pointer;font-size:.9rem;line-height:1}",
      /* Privat/bedrift-velger */
      ".qt-typrow{display:flex;gap:.7rem;margin-bottom:1.2rem}",
      ".qt-typ{flex:1;border:2px solid var(--color-border);border-radius:12px;padding:.9rem 1rem;cursor:pointer;text-align:center;font:inherit;font-size:.95rem;font-weight:500;background:var(--color-bg);color:var(--color-text);transition:border-color .15s}",
      ".qt-typ.is-active{border-color:var(--color-primary);background:var(--color-tint);color:var(--color-primary)}",
      /* Vilkår-avhuking */
      ".qt-terms-row{display:flex;align-items:center;gap:.55rem;font-size:.9rem;margin-top:.5rem;flex-wrap:wrap}",
      ".qt-terms-link{background:none;border:0;padding:0;color:var(--color-primary);cursor:pointer;font:inherit;font-size:.9rem;text-decoration:underline}",
      /* Vilkår-popup */
      ".qt-modal-back{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;display:flex;align-items:center;justify-content:center;padding:1rem}",
      ".qt-modal{background:var(--color-surface);border-radius:var(--radius);max-width:540px;width:100%;padding:1.6rem;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.18)}",
      ".qt-modal h3{margin:0 0 1rem}",
      ".qt-modal-text{white-space:pre-wrap;font-size:.92rem;line-height:1.7;color:var(--color-muted)}",
      ".qt-modal-close{margin-top:1.4rem;width:100%}",
      /* Kvittering */
      ".qt-receipt{text-align:center;padding:2.5rem 1rem}",
      ".qt-receipt__icon{font-size:3.5rem;color:var(--color-primary);display:block;margin:0 auto .8rem}",
      ".qt-receipt__title{font-size:1.6rem;margin:0 0 .5rem}",
      ".qt-receipt__text{color:var(--color-muted);margin:0 0 1.4rem}",
      /* 2-kolonnerutenett for kontaktfelter */
      ".qt-grid{display:grid;grid-template-columns:1fr 1fr;gap:.2rem 1rem}",
      "@media(max-width:560px){.qt-grid{grid-template-columns:1fr}.qt-typrow{flex-direction:column}}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     STAT  (lokalt pr. sidevisning — nullstilles ved steg 1)
     ====================================================================== */
  var _state = null;
  function freshState() {
    return { step: 1, desc: "", files: [], type: "privat",
             name: "", email: "", phone: "", address: "", zip: "",
             orgName: "", ordererName: "", orgNr: "", invoiceEmail: "" };
  }

  /* =========================================================================
     FILHÅNDTERING (kun i minne — ingen localStorage for vedlegg her)
     ====================================================================== */
  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return Math.round(n / 1024) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  function renderPage() {
    return '<section id="tilbud" class="section reveal"><div class="container qt-panel">' +
      C.eyebrow(QCF.intro || QCF.heading || "Tilbud") +
      '<h2 class="section__title">' + esc(QCF.heading || "Be om tilbud") + '</h2>' +
      '<p class="qt-lead">' + esc(QCF.intro || "") + '</p>' +
      '<div data-qt-inner></div>' +
    '</div></section>';
  }

  function stepIndicator(current) {
    var steps = ["Beskriv jobben", "Kontaktinfo", "Fullført"];
    return '<div class="qt-steps">' + steps.map(function (l, i) {
      var n = i + 1;
      var cls = n < current ? "is-done" : n === current ? "is-active" : "";
      return '<div class="qt-step ' + cls + '"><span class="qt-step__num">' + (n < current ? "✓" : n) + '</span><span>' + l + '</span></div>';
    }).join("") + "</div>";
  }

  /* --- Steg 1: Beskrivelse + vedlegg --------------------------------------- */
  function renderStep1(inner) {
    inner.innerHTML = stepIndicator(1) +
      '<form data-qt-form1>' +
        C.field({ id:"qt-desc", label:"Beskrivelse av jobben", required:true, multiline:true, rows:6,
                  placeholder:"Fortell hva du ønsker hjelp til. Jo mer detaljer, desto bedre tilbud kan vi gi." }) +
        '<div class="field"><label>Vedlegg <span style="font-weight:400;color:var(--color-muted)">(valgfritt, maks ' + MAX_FILE_MB + ' MB pr. fil)</span></label>' +
          '<div class="qt-attach">' +
            '<label class="qt-attach-label">' + C.icon("upload") + ' Legg ved filer<input type="file" multiple hidden data-qt-files></label>' +
            '<ul class="qt-attach-list" data-qt-filelist></ul>' +
          '</div>' +
        '</div>' +
        '<p class="form__status is-error" data-qt-err1 style="display:none"></p>' +
        '<div class="qt-nav qt-nav--end">' +
          C.button({ label:"Neste", variant:"primary", attrs:"data-qt-next1" }) +
        '</div>' +
      '</form>';

    var st = _state;
    var ta = inner.querySelector("#qt-desc");
    if (st.desc) ta.value = st.desc;

    // Filvisning
    var fileList = inner.querySelector("[data-qt-filelist]");
    function renderFiles() {
      fileList.innerHTML = st.files.map(function (f, i) {
        return '<li class="qt-attach-item">' + esc(f.name) + ' <span style="color:var(--color-muted)">(' + formatBytes(f.size) + ')</span>' +
          '<button type="button" class="qt-attach-x" data-rm="' + i + '" aria-label="Fjern">×</button></li>';
      }).join("");
      fileList.querySelectorAll("[data-rm]").forEach(function (b) {
        b.addEventListener("click", function () { st.files.splice(parseInt(b.getAttribute("data-rm"), 10), 1); renderFiles(); });
      });
    }
    renderFiles();

    inner.querySelector("[data-qt-files]").addEventListener("change", function (e) {
      var picked = Array.prototype.slice.call(e.target.files || []);
      picked.forEach(function (f) {
        if (f.size > MAX_FILE_MB * 1024 * 1024) { alert(f.name + " er for stor (maks " + MAX_FILE_MB + " MB)."); return; }
        st.files.push(f);
      });
      e.target.value = "";
      renderFiles();
    });

    inner.querySelector("[data-qt-next1]").addEventListener("click", function () {
      var err = inner.querySelector("[data-qt-err1]");
      st.desc = ta.value.trim();
      if (!st.desc) { err.textContent = "Beskriv jobben før du går videre."; err.style.display = ""; return; }
      err.style.display = "none";
      renderStep2(inner);
    });
  }

  /* --- Steg 2: Kontaktinfo + vilkår --------------------------------------- */
  function renderStep2(inner) {
    inner.innerHTML = stepIndicator(2) +
      '<form data-qt-form2>' +
        '<div class="qt-typrow">' +
          '<button type="button" class="qt-typ' + (_state.type === "privat" ? " is-active" : "") + '" data-qt-typ="privat">' + C.icon("user") + ' Privat</button>' +
          '<button type="button" class="qt-typ' + (_state.type === "bedrift" ? " is-active" : "") + '" data-qt-typ="bedrift">' + C.icon("building") + ' Bedrift</button>' +
        '</div>' +
        '<div data-qt-fields></div>' +
        '<div class="qt-terms-row">' +
          '<input type="checkbox" id="qt-terms" data-qt-terms> ' +
          '<label for="qt-terms">Jeg aksepterer</label>' +
          '<button type="button" class="qt-terms-link" data-qt-terms-open>' + esc(TERMS_HEADING) + '</button>' +
        '</div>' +
        '<p class="form__status is-error" data-qt-err2 style="display:none"></p>' +
        '<div class="qt-nav">' +
          C.button({ label:"Tilbake", variant:"ghost", attrs:"data-qt-back2" }) +
          C.button({ label:"Send inn", variant:"primary", type:"submit" }) +
        '</div>' +
      '</form>' +
      /* Vilkår-popup (skjult til knappen klikkes) */
      '<div class="qt-modal-back" data-qt-terms-modal style="display:none">' +
        '<div class="qt-modal">' +
          '<h3>' + esc(TERMS_HEADING) + '</h3>' +
          '<p class="qt-modal-text">' + esc(TERMS_TEXT) + '</p>' +
          C.button({ label:"Lukk", variant:"ghost", attrs:'data-qt-terms-close class="qt-modal-close"' }) +
        '</div>' +
      '</div>';

    var st = _state;
    var fieldsWrap = inner.querySelector("[data-qt-fields]");

    function renderFields() {
      if (st.type === "privat") {
        fieldsWrap.innerHTML =
          '<div class="qt-grid">' +
            C.field({ id:"qt-name",  label:"Navn",     required:true,  value:st.name }) +
            C.field({ id:"qt-email", label:"E-post",   required:true,  type:"email", value:st.email }) +
            C.field({ id:"qt-phone", label:"Telefon",  value:st.phone }) +
          '</div>' +
          '<div class="qt-grid">' +
            C.field({ id:"qt-addr",  label:"Adresse",  value:st.address }) +
            C.field({ id:"qt-zip",   label:"Postnummer", value:st.zip }) +
          '</div>';
      } else {
        fieldsWrap.innerHTML =
          C.field({ id:"qt-orgname",  label:"Bedriftsnavn",  required:true,  value:st.orgName }) +
          '<div class="qt-grid">' +
            C.field({ id:"qt-email",      label:"E-post",         required:true, type:"email", value:st.email }) +
            C.field({ id:"qt-phone",      label:"Telefon",        value:st.phone }) +
          '</div>' +
          C.field({ id:"qt-name",      label:"Bestillers navn",  required:true, value:st.ordererName || st.name }) +
          '<div class="qt-grid">' +
            C.field({ id:"qt-addr",  label:"Adresse",   value:st.address }) +
            C.field({ id:"qt-zip",   label:"Postnummer", value:st.zip }) +
          '</div>' +
          '<div class="qt-grid">' +
            C.field({ id:"qt-orgnr",      label:"Org.nr (EHF)",      value:st.orgNr,
                      placeholder:"000 000 000" }) +
            C.field({ id:"qt-invoiceemail", label:"Faktura e-post",    value:st.invoiceEmail,
                      type:"email", placeholder:"faktura@bedrift.no" }) +
          '</div>' +
          '<p style="font-size:.82rem;color:var(--color-muted);margin:.2rem 0 .6rem">Fyll inn Org.nr for EHF-faktura eller e-postadresse for faktura på e-post.</p>';
      }
    }
    renderFields();

    // Privat/bedrift-veksler
    inner.querySelectorAll("[data-qt-typ]").forEach(function (b) {
      b.addEventListener("click", function () {
        saveFields();
        st.type = b.getAttribute("data-qt-typ");
        inner.querySelectorAll("[data-qt-typ]").forEach(function (x) { x.classList.toggle("is-active", x === b); });
        renderFields();
      });
    });

    function g(id) { var el = inner.querySelector("#" + id); return el ? el.value.trim() : ""; }
    function saveFields() {
      st.email = g("qt-email"); st.phone = g("qt-phone");
      st.address = g("qt-addr"); st.zip = g("qt-zip");
      if (st.type === "privat") {
        st.name = g("qt-name");
      } else {
        st.orgName = g("qt-orgname"); st.ordererName = g("qt-name");
        st.orgNr = g("qt-orgnr"); st.invoiceEmail = g("qt-invoiceemail");
      }
    }

    // Vilkår-popup
    var modal = inner.querySelector("[data-qt-terms-modal]");
    inner.querySelector("[data-qt-terms-open]").addEventListener("click", function () { modal.style.display = ""; });
    inner.querySelector("[data-qt-terms-close]").addEventListener("click", function () { modal.style.display = "none"; });
    modal.addEventListener("click", function (e) { if (e.target === modal) modal.style.display = "none"; });

    // Tilbake
    inner.querySelector("[data-qt-back2]").addEventListener("click", function () {
      saveFields();
      renderStep1(inner);
    });

    // Send inn
    inner.querySelector("[data-qt-form2]").addEventListener("submit", function (e) {
      e.preventDefault();
      saveFields();
      var err = inner.querySelector("[data-qt-err2]");
      var terms = inner.querySelector("[data-qt-terms]");

      // Validering
      var name = st.type === "privat" ? st.name : (st.ordererName || st.orgName);
      if (!name)       { err.textContent = "Fyll inn navn."; err.style.display = ""; return; }
      if (!st.email)   { err.textContent = "Fyll inn e-post."; err.style.display = ""; return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(st.email)) { err.textContent = "Sjekk e-postadressen."; err.style.display = ""; return; }
      if (!terms.checked) { err.textContent = "Du må akseptere vilkårene for å sende inn."; err.style.display = ""; return; }

      // Bygg meldings-sammendrag
      var lines = ["Tilbudsforespørsel", ""];
      lines.push("Jobbeskrivelse");
      lines.push(st.desc);
      if (st.files.length) lines.push("\nVedlegg: " + st.files.map(function (f) { return f.name + " (" + formatBytes(f.size) + ")"; }).join(", "));
      lines.push("\nKontaktopplysninger");
      lines.push("Type: " + (st.type === "privat" ? "Privat" : "Bedrift"));
      if (st.type === "bedrift" && st.orgName) lines.push("Bedrift: " + st.orgName);
      lines.push("Navn: " + name);
      if (st.phone)   lines.push("Tlf: " + st.phone);
      if (st.address) lines.push("Adresse: " + st.address + (st.zip ? ", " + st.zip : ""));
      if (st.type === "bedrift") {
        if (st.orgNr)        lines.push("Org.nr: " + st.orgNr);
        if (st.invoiceEmail) lines.push("Faktura e-post: " + st.invoiceEmail);
      }

      App.addLead({ name: name, email: st.email, message: lines.join("\n") });
      renderStep3(inner);
    });
  }

  /* --- Steg 3: Kvittering -------------------------------------------------- */
  function renderStep3(inner) {
    inner.innerHTML = stepIndicator(3) +
      '<div class="qt-receipt">' +
        '<i class="ti ti-circle-check qt-receipt__icon"></i>' +
        '<h3 class="qt-receipt__title">Takk for forespørselen!</h3>' +
        '<p class="qt-receipt__text">Vi har mottatt forespørselen din og tar kontakt så snart vi kan.</p>' +
        C.button({ label:"Send ny forespørsel", variant:"ghost", attrs:"data-qt-restart" }) +
      '</div>';
    _state = freshState();
    inner.querySelector("[data-qt-restart]").addEventListener("click", function () { renderStep1(inner); });
  }

  /* =========================================================================
     MOUNT
     ====================================================================== */
  function mountPage(container) {
    var section = container.querySelector("#tilbud") || container;
    var inner = section.querySelector("[data-qt-inner]");
    if (!inner) return;
    _state = freshState();
    renderStep1(inner);
  }

  /* =========================================================================
     ADMIN  – viser innsendte tilbudsforespørsler direkte i fanen
     ====================================================================== */
  function renderAdminInfo(body) {
    var allLeads = App.getLeads ? App.getLeads() : [];
    var allQuotes = allLeads.filter(function (l) { return l.message && l.message.indexOf("Tilbudsforesp") === 0; });
    var active = App.getActiveStatuses("tilbud");
    var quotes = allQuotes.filter(function (l) { return active.indexOf(l.status || "ny") > -1; });
    var counts = { ny: 0, lest: 0, løst: 0 };
    allQuotes.forEach(function (l) { counts[l.status || "ny"]++; });

    var rows = quotes.length ? quotes.map(function (l) {
      var st = l.status || "ny";
      var preview = (l.message || "").split("\n").filter(function (ln) {
        return ln.trim() && ln.indexOf("===") === -1 && ln !== "Tilbudsforespørsel";
      }).slice(0, 2).join(" · ").slice(0, 120);
      var dato = l.time ? new Date(l.time).toLocaleDateString("nb-NO", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "";
      return '<li class="admin-row" style="flex-direction:column;align-items:stretch;gap:.4rem">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;flex-wrap:wrap">' +
          '<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">' +
            '<strong>' + esc(l.name || "(ukjent)") + '</strong>' +
            ' <a href="mailto:' + esc(l.email) + '" style="color:var(--color-primary)">' + esc(l.email) + '</a>' +
            App.statusBadge(st) +
            (dato ? '<span class="admin-row__meta" style="margin-left:.4rem">' + dato + '</span>' : '') +
          '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:.4rem">' +
            '<div style="display:flex;gap:.4rem">' +
              C.button({ label:"Svar i e-post", icon:"mail-forward", variant:"primary", attrs:'data-qt-reply="' + esc(l.id) + '"' }) +
              C.button({ label:"Slett", variant:"ghost", attrs:'data-qt-del="' + esc(l.id) + '"' }) +
            '</div>' +
            '<select class="stat-select" data-qt-status="' + esc(l.id) + '">' +
              App.STATUS_ORDER.map(function (s) { return '<option value="' + s + '" ' + (s===st?"selected":"") + '>' + App.STATUS_LABELS[s] + '</option>'; }).join("") +
            '</select>' +
          '</div>' +
        '</div>' +
        '<details class="lead-details" data-qt-details="' + esc(l.id) + '">' +
          '<summary>' + esc(preview) + (preview.length >= 120 ? "…" : "") + '</summary>' +
          '<div class="admin-lead-msg">' + esc(l.message).replace(/\n/g, "<br>") + '</div>' +
        '</details>' +
      '</li>';
    }).join("") : '<li class="prose prose--muted">Ingen tilbudsforespørsler med valgt status.</li>';

    body.innerHTML = App.statusFilterBar("tilbud", counts) + '<ul class="admin-list">' + rows + '</ul>';

    App.bindStatusFilterBar(body, "tilbud", function () { renderAdminInfo(body); });

    // Variant B: eksplisitt klikk på «Vis hele meldingen» → Lest
    body.querySelectorAll("[data-qt-details]").forEach(function (det) {
      det.addEventListener("toggle", function () {
        if (!det.open) return;
        var id = det.getAttribute("data-qt-details");
        var lead = App.getLeads().find(function (l) { return l.id === id; });
        if (lead && (lead.status || "ny") === "ny") { App.setLeadStatus(id, "lest"); renderAdminInfo(body); }
      });
    });

    body.querySelectorAll("[data-qt-reply]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-qt-reply");
        var lead = App.getLeads().find(function (l) { return l.id === id; });
        if (lead && App.openReplyModal) {
          App.setLeadStatus(id, "løst");
          App.openReplyModal(lead, "Re: Tilbudsforespørsel – " + (lead.name || ""));
          renderAdminInfo(body);
        }
      });
    });
    body.querySelectorAll("[data-qt-status]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        App.setLeadStatus(sel.getAttribute("data-qt-status"), sel.value);
        renderAdminInfo(body);
      });
    });
    body.querySelectorAll("[data-qt-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-qt-del");
        App.store.set("leads", App.getLeads().filter(function (l) { return l.id !== id; }));
        renderAdminInfo(body);
      });
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  injectStyles();
  App.registerModule({
    id:     "tilbud",
    label:  QCF.heading || "Tilbud",
    order:  48,      // mellom Booking (45) og Kontakt (50)
    page:   true,
    render: renderPage,
    mount:  mountPage,
    admin: {
      label:  "Tilbud",
      render: function () { return '<div data-qt-adm></div>'; },
      mount:  function (body) { renderAdminInfo(body.querySelector("[data-qt-adm]") || body); }
    }
  });
})();
