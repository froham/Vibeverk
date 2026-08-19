/* =============================================================================
   module-qrcode.js  —  QR-KODER (dynamisk/redirect)
   -----------------------------------------------------------------------------
   Dual-registrerer for både Web-admin (App.registerModule) og Workspace
   (window.Intranet.registerModule), etter same mønster som module-crm.js —
   ÉIN fil, delt kode og datanøkkel («qr-codes» i App.store), slik at ein
   QR-kode oppretta i Web-admin er synleg og redigerbar i Workspace og omvendt.

   Kvar QR-kode koder for ei FAST adresse på eige domene (/qr/<code>), aldri
   for mål-lenka direkte — sjølve QR-biletet endrar seg difor aldri, sjølv om
   mål-lenka byttast ut seinare (sjå api/qr-redirect.js + middleware.js for
   sjølve videresendinga). Slette ein kode gjer den trykte/delte QR-en
   verdilaus (vennleg feilside i staden for videresending) — irreversibelt,
   difor Nivå B-stadfesting ved sletting (docs/architecture/copy-style-guide.md).

   Krev det eksterne QR-biblioteket «qr-code-styling» (window.QRCodeStyling),
   lasta via CDN i index.html/workspace/index.html FØR denne fila.

   Uavhengige funksjonsbrytarar (begge MÅ vere eksplisitt true, standard er
   false for begge — sjå config.js):
     features.qrCode           → admin-fane i Web-admin
     intranettFeatures.qrCode  → eiga side i Workspace
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App, C = window.Components;
  if (!App || !C) return;

  App.ready(function (CFG) {
    var esc = C.esc;
    var STORE_KEY = "qr-codes";

    var siteOn = !!(CFG.features && CFG.features.qrCode === true);
    var wsOn   = !!(CFG.intranettFeatures && CFG.intranettFeatures.qrCode === true);
    if (!siteOn && !wsOn) return;

    /* =======================================================================
       LAGRING  (delt datanøkkel — App.store skriv/les via same "store"-tabell
       på begge overflater sidan begge autentiserer mot same Supabase-prosjekt)
       ==================================================================== */
    function getItems() { return App.store.get(STORE_KEY, []) || []; }
    function setItems(v) { App.store.set(STORE_KEY, v); }

    function genCode(existing) {
      var alphabet = "abcdefghijkmnpqrstuvwxyz23456789"; // utan 0/o/1/l/i — vanskeleg å forveksle
      var code;
      do {
        code = "";
        for (var i = 0; i < 8; i++) code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
      } while (existing.some(function (r) { return r.code === code; }));
      return code;
    }

    function slug(s) {
      return (s || "qr").toLowerCase()
        .replace(/[æå]/g, "a").replace(/ø/g, "o")
        .replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "") || "qr";
    }

    /* =======================================================================
       QR-GENERERING  (window.QRCodeStyling)
       ==================================================================== */
    function qrTargetUrl(record) { return window.location.origin + "/qr/" + record.code; }

    function buildQr(record, extra) {
      var opts = Object.assign({
        width: 280, height: 280, margin: 8,
        data: qrTargetUrl(record),
        qrOptions: { errorCorrectionLevel: "H" },
        dotsOptions: { color: record.fgColor || "#142033", type: "rounded" },
        cornersSquareOptions: { type: "extra-rounded", color: record.fgColor || "#142033" },
        backgroundOptions: { color: record.bgColor || "#ffffff" },
        imageOptions: { crossOrigin: "anonymous", imageSize: 0.35, margin: 6, hideBackgroundDots: true }
      }, extra || {});
      if (record.useLogo && CFG.company && CFG.company.logoUrl) opts.image = CFG.company.logoUrl;
      return new window.QRCodeStyling(opts);
    }

    function renderPreview(container, record) {
      container.innerHTML = "";
      if (!window.QRCodeStyling) {
        container.textContent = "QR-biblioteket kunne ikke lastes — sjekk internettforbindelsen.";
        return;
      }
      try { buildQr(record, { type: "canvas" }).append(container); }
      catch (e) { container.textContent = "Kunne ikke tegne forhåndsvisning."; }
    }

    function exportQr(record, extension) {
      if (!window.QRCodeStyling) return;
      var type = extension === "svg" ? "svg" : "canvas";
      try {
        buildQr(record, { type: type }).download({ name: slug(record.label), extension: extension });
      } catch (e) {
        console.error("[qrcode] eksport feila", e);
      }
    }

    /* =======================================================================
       DELT UI  (identisk i Web-admin og Workspace — same CSS-klassar finst
       på begge overflater, sjå .admin-form/.admin-list/.admin-row)
       ==================================================================== */
    function renderManager(root) {
      var items = getItems();
      root.innerHTML =
        '<div class="qr-adm__head" style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.8rem">' +
          '<h4 style="margin:0">QR-koder</h4>' +
          C.button({ label: "Ny QR-kode", icon: "plus", variant: "primary", attrs: "data-qr-new" }) +
        '</div>' +
        '<div data-qr-editor></div>' +
        '<ul class="admin-list" data-qr-list>' +
          (items.length ? items.map(qrRow).join("") : '<li class="prose prose--muted">Ingen QR-koder ennå.</li>') +
        '</ul>';

      root.querySelector("[data-qr-new]").addEventListener("click", function () { openEditor(root, null); });
      root.querySelectorAll("[data-qr-edit]").forEach(function (b) {
        b.addEventListener("click", function () { openEditor(root, b.getAttribute("data-qr-edit")); });
      });
      root.querySelectorAll("[data-qr-toggle]").forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-qr-toggle");
          var list = getItems();
          var idx = list.findIndex(function (x) { return x.id === id; });
          if (idx < 0) return;
          list[idx] = Object.assign({}, list[idx], { active: !list[idx].active, updatedAt: new Date().toISOString() });
          setItems(list);
          renderManager(root);
        });
      });
      root.querySelectorAll("[data-qr-png]").forEach(function (b) {
        b.addEventListener("click", function () { exportForId(items, b.getAttribute("data-qr-png"), "png"); });
      });
      root.querySelectorAll("[data-qr-svg]").forEach(function (b) {
        b.addEventListener("click", function () { exportForId(items, b.getAttribute("data-qr-svg"), "svg"); });
      });
      root.querySelectorAll("[data-qr-del]").forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-qr-del");
          var rec = items.find(function (x) { return x.id === id; });
          if (!rec) return;
          if (!window.confirm(
            'Slette QR-koden «' + rec.label + '»? Den trykte eller delte QR-koden vil da ikke lenger virke ' +
            '(den peker fortsatt på samme lenke fysisk, men lenken finnes ikke lenger her). Dette kan ikke angres.'
          )) return;
          setItems(getItems().filter(function (x) { return x.id !== id; }));
          renderManager(root);
        });
      });
    }

    function exportForId(items, id, extension) {
      var rec = items.find(function (x) { return x.id === id; });
      if (rec) exportQr(rec, extension);
    }

    function qrRow(r) {
      return '<li class="admin-row" style="align-items:center;gap:.8rem">' +
        '<div class="admin-row__main">' +
          '<strong>' + esc(r.label) + '</strong>' +
          (r.active === false ? ' <span class="badge" style="opacity:.6">Deaktivert</span>' : '') +
          '<span class="admin-row__meta" style="display:block;word-break:break-all">' + esc(r.targetUrl) + '</span>' +
        '</div>' +
        '<div class="admin-row__actions" style="display:flex;flex-wrap:wrap;gap:.4rem">' +
          C.button({ label: "Rediger",            variant: "ghost", attrs: 'data-qr-edit="'   + esc(r.id) + '"' }) +
          C.button({ label: "PNG",                 variant: "ghost", attrs: 'data-qr-png="'    + esc(r.id) + '"' }) +
          C.button({ label: "SVG",                 variant: "ghost", attrs: 'data-qr-svg="'    + esc(r.id) + '"' }) +
          C.button({ label: r.active === false ? "Aktiver" : "Deaktiver", variant: "ghost", attrs: 'data-qr-toggle="' + esc(r.id) + '"' }) +
          C.button({ label: "Slett",               variant: "ghost", attrs: 'data-qr-del="'    + esc(r.id) + '"' }) +
        '</div>' +
      '</li>';
    }

    function openEditor(root, id) {
      var items = getItems();
      var item = id ? items.find(function (x) { return x.id === id; }) : null;
      var rec = item ? Object.assign({}, item) : {
        id: "qr-" + Date.now(), code: genCode(items),
        label: "", targetUrl: "", active: true, useLogo: true,
        fgColor: "#142033", bgColor: "#ffffff"
      };

      var ed = root.querySelector("[data-qr-editor]");
      ed.innerHTML =
        '<form class="admin-form admin-form--card" data-qr-form>' +
          '<h4 style="margin:0">' + (item ? "Rediger QR-kode" : "Ny QR-kode") + '</h4>' +
          '<div style="display:grid;grid-template-columns:1fr 200px;gap:1.4rem;align-items:start">' +
            '<div>' +
              C.field({ id: "qr-label", label: "Navn/merkelapp", required: true, value: rec.label,
                hint: "Kun til intern bruk — vises ikke når koden skannes." }) +
              C.field({ id: "qr-url", label: "Mål-lenke", type: "url", required: true, value: rec.targetUrl,
                help: "Dit QR-koden sender folk. Denne kan endres senere uten at den trykte/delte QR-koden slutter å virke — koden peker alltid på en fast adresse hos oss, som igjen sender videre dit du sier her.",
                placeholder: "https://…" }) +
              '<label style="display:flex;align-items:center;gap:.5rem;margin:.4rem 0">' +
                '<input type="checkbox" data-qr-uselogo' + (rec.useLogo ? " checked" : "") + '> Vis logo midt i QR-koden' +
              '</label>' +
              '<div style="display:flex;gap:1.2rem;flex-wrap:wrap;margin:.4rem 0">' +
                '<label style="display:flex;align-items:center;gap:.4rem">Forgrunn <input type="color" data-qr-fg value="' + esc(rec.fgColor) + '"></label>' +
                '<label style="display:flex;align-items:center;gap:.4rem">Bakgrunn <input type="color" data-qr-bg value="' + esc(rec.bgColor) + '"></label>' +
              '</div>' +
              '<div class="admin-row__actions" style="margin-top:.6rem">' +
                C.button({ label: item ? "Oppdater" : "Opprett", type: "submit", variant: "primary" }) +
                C.button({ label: "Avbryt", variant: "ghost", attrs: "data-qr-cancel" }) +
              '</div>' +
              '<p class="field__hint">Fysisk lenke: ' + esc(qrTargetUrl(rec)) + '</p>' +
              '<p class="form__status" data-qr-status></p>' +
            '</div>' +
            '<div data-qr-preview style="display:flex;justify-content:center;align-items:center;min-height:280px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius)"></div>' +
          '</div>' +
        '</form>';

      var previewEl = ed.querySelector("[data-qr-preview]");
      function currentDraft() {
        return Object.assign({}, rec, {
          label:   ed.querySelector("#qr-label").value.trim() || rec.label,
          useLogo: ed.querySelector("[data-qr-uselogo]").checked,
          fgColor: ed.querySelector("[data-qr-fg]").value,
          bgColor: ed.querySelector("[data-qr-bg]").value
        });
      }
      renderPreview(previewEl, rec);
      ["[data-qr-uselogo]", "[data-qr-fg]", "[data-qr-bg]"].forEach(function (sel) {
        ed.querySelector(sel).addEventListener("input", function () { renderPreview(previewEl, currentDraft()); });
      });

      ed.querySelector("[data-qr-cancel]").addEventListener("click", function () { ed.innerHTML = ""; });
      ed.querySelector("[data-qr-form]").addEventListener("submit", function (e) {
        e.preventDefault();
        var label = ed.querySelector("#qr-label").value.trim();
        var url   = ed.querySelector("#qr-url").value.trim();
        var st    = ed.querySelector("[data-qr-status]");
        if (!label || !url) { st.textContent = "Navn og mål-lenke er påkrevd."; st.className = "form__status is-error"; return; }
        if (!/^https?:\/\//i.test(url)) url = "https://" + url;

        var list = getItems();
        var obj = {
          id: rec.id, code: rec.code, label: label, targetUrl: url,
          active: item ? rec.active : true,
          useLogo: ed.querySelector("[data-qr-uselogo]").checked,
          fgColor: ed.querySelector("[data-qr-fg]").value,
          bgColor: ed.querySelector("[data-qr-bg]").value,
          createdAt: item ? item.createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        if (item) {
          var idx = list.findIndex(function (x) { return x.id === item.id; });
          list[idx] = obj;
        } else {
          list.push(obj);
        }
        setItems(list);
        ed.innerHTML = "";
        renderManager(root);
      });
    }

    /* =======================================================================
       REGISTRERING
       ==================================================================== */
    if (siteOn) {
      App.registerModule({
        id: "qrcode", label: "QR-koder", order: 999, adminOnly: true,
        render: function () { return ""; },
        admin: {
          label: "QR-koder", category: "innhold",
          render: function () { return '<div data-qr-root></div>'; },
          mount: function (body) { renderManager(body.querySelector("[data-qr-root]") || body); }
        }
      });
    }

    if (wsOn && window.Intranet && typeof window.Intranet.registerModule === "function") {
      window.Intranet.registerModule({
        id: "qrcode", navLabel: "QR-koder", icon: "qrcode", order: 68,
        render: function () { return '<div id="qrcode-root" style="padding:1.4rem"></div>'; },
        mount: function (outlet) { renderManager(outlet.querySelector("#qrcode-root") || outlet); }
      });
    }
  });
})();
