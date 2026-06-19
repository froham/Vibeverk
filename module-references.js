/* =============================================================================
   module-references.js  —  REFERANSER-MODUL
   -----------------------------------------------------------------------------
   Selvstendig IIFE. Lastes etter core.js. Slås av/på med features.references.

   Vises på TO måter:
     1. Inline-seksjon på forsiden: viser de første N kortene (config.references.
        previewCount, standard 3) + «Se alle referanser»-knapp dersom det finnes
        flere.
     2. Egen fullside (#referanser): viser alle, med kategori-filter dersom
        minst ett kort har kategori satt.

   Hvert kort har:
     - Bilde (valgfritt, 16:9 cover)
     - Kundenavn / prosjektnavn  (påkrevd)
     - Kategori/bransje          (valgfritt — brukes som filter)
     - Tekst / sitat             (valgfritt)
     - Sitat-modus               (valgfritt — kursiv + anførselstegn)
     - Navn og tittel på den som uttaler seg (valgfritt, kun i sitat-modus)
     - Rekkefølge (order)        (tall, lavere = først)

   Admin: full CRUD under «Referanser»-fanen.
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App, C = window.Components, CFG = window.SITE_CONFIG || {};
  if (!App || !C) return;
  if (CFG.features && CFG.features.references === false) return;

  var esc = C.esc;
  var RCF = CFG.references || {};
  var PREVIEW_COUNT = RCF.previewCount || 3;
  var STORE_KEY = "ref-items";

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getItems() { return App.store.get(STORE_KEY, []) || []; }
  function setItems(v) { App.store.set(STORE_KEY, v); }
  function sorted(items) {
    return items.slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name);
    });
  }

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("rf-styles")) return;
    var s = document.createElement("style");
    s.id = "rf-styles";
    s.textContent = [
      /* Rutenett */
      ".rf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:.9rem;margin-top:1rem}",
      ".rf-card{border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden;background:var(--color-surface);display:flex;flex-direction:column;height:360px;transition:border-color .15s,transform .15s}",
      ".rf-card:hover{border-color:var(--color-primary);transform:translateY(-2px)}",
      /* Preview-grid på forsiden: alltid 3 kolonner i full bredde */
      ".rf-grid--preview{grid-template-columns:repeat(3,1fr)}",
      "@media(max-width:700px){.rf-grid--preview{grid-template-columns:1fr}}",
      /* Kort */
      ".rf-card{border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden;background:var(--color-surface);display:flex;flex-direction:column}",

      ".rf-card__img{width:100%;height:140px;object-fit:cover;display:block}",
      ".rf-card__img.has-credit{display:block;height:140px}",
      ".rf-card__placeholder{width:100%;height:140px;background:var(--color-alt);display:flex;align-items:center;justify-content:center;flex-shrink:0}",
      ".rf-card__placeholder span{font-size:.8rem;color:var(--color-muted);font-style:italic}",
      ".rf-card__body{padding:.8rem .9rem .95rem;display:flex;flex-direction:column;flex:1;gap:.3rem;overflow:hidden;min-height:0}",
      ".rf-card__cat{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-primary);flex-shrink:0}",
      ".rf-card__name{font-size:.9rem;font-weight:700;margin:0;flex-shrink:0}",
      /* Sitat-stil */
      ".rf-card__quote{font-style:italic;color:var(--color-muted);margin:0;font-size:.85rem;line-height:1.55;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}",
      ".rf-card__quote::before{content:'\\201C';font-size:1.4em;line-height:0;vertical-align:-.3em;margin-right:.1em;color:var(--color-primary)}",
      ".rf-card__quote::after{content:'\\201D';font-size:1.4em;line-height:0;vertical-align:-.3em;margin-left:.1em;color:var(--color-primary)}",
      /* Vanlig tekst */
      ".rf-card__text{color:var(--color-muted);margin:0;font-size:.85rem;line-height:1.55;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}",
      /* Avsender */
      ".rf-card__by{font-size:.76rem;color:var(--color-muted);margin-top:auto;padding-top:.4rem;border-top:1px solid var(--color-border)}",
      ".rf-card__by strong{color:var(--color-text)}",
      /* Kategori-filter */
      ".rf-filters{display:flex;flex-wrap:wrap;gap:.45rem;margin-bottom:.5rem}",
      ".rf-filter{font:inherit;font-size:.84rem;padding:.38rem .8rem;border-radius:999px;border:1.5px solid var(--color-border);background:transparent;color:var(--color-text);cursor:pointer}",
      ".rf-filter:hover{border-color:var(--color-primary)}",
      ".rf-filter.is-active{background:var(--color-primary);border-color:var(--color-primary);color:#fff}",
      /* «Se alle»-rad */
      ".rf-more{margin-top:1.4rem;text-align:center}",
      ".rf-readmore{font-size:.78rem;color:var(--color-primary);margin-top:auto;padding-top:.3rem;display:inline-flex;align-items:center;gap:.2rem;font-weight:600}",
      /* Detaljvisning */
      ".rf-detail{max-width:720px;margin:0 auto}",
      ".rf-detail__img{width:100%;border-radius:var(--radius);overflow:hidden;margin-bottom:1.4rem}",
      ".rf-detail__cat{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-primary);margin-bottom:.3rem}",
      ".rf-detail__name{font-size:1.8rem;font-weight:800;margin:0 0 1rem}",
      ".rf-detail__quote{font-style:italic;font-size:1.15rem;line-height:1.7;color:var(--color-muted);margin:0 0 1rem}",
      ".rf-detail__quote::before{content:'\\201C';font-size:1.4em;line-height:0;vertical-align:-.3em;margin-right:.1em;color:var(--color-primary)}",
      ".rf-detail__quote::after{content:'\\201D';font-size:1.4em;line-height:0;vertical-align:-.3em;margin-left:.1em;color:var(--color-primary)}",
      ".rf-detail__text{color:var(--color-muted);line-height:1.75;margin:0 0 1rem;font-size:1.05rem}",
      ".rf-detail__by{display:flex;align-items:center;gap:.5rem;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--color-border)}",
      ".rf-detail__by strong{color:var(--color-text)}",
      ".rf-back{margin-bottom:1.4rem}",
      /* Admin */
      ".rf-adm__head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.6rem}",
      ".rf-adm__head h4{margin:0}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     KORT-HTML  (delt mellom inline + fullside)
     ====================================================================== */
  function cardHtml(item) {
    var img = App.media.resolveImage(item.image);
    var imgHtml = img.src
      ? C.coverImg(img, "rf-card__img")
      : '<div class="rf-card__placeholder"><span>Bilde kommer</span></div>';
    var catHtml = item.category
      ? '<span class="rf-card__cat">' + esc(item.category) + '</span>' : "";
    var textHtml = "";
    var plainText = C.stripHtml(item.text);
    if (item.text) {
      if (item.isQuote) {
        textHtml = '<p class="rf-card__quote">' + esc(plainText) + '</p>';
      } else {
        textHtml = '<p class="rf-card__text">' + esc(plainText) + '</p>';
      }
    }
    var byHtml = (item.isQuote && item.byName)
      ? '<p class="rf-card__by"><strong>' + esc(item.byName) + '</strong>' +
          (item.byTitle ? ' · ' + esc(item.byTitle) : '') + '</p>'
      : "";
    return '<article class="rf-card" data-rf-open="' + esc(item.id) + '">' +
      imgHtml +
      '<div class="rf-card__body">' +
        catHtml +
        '<h3 class="rf-card__name">' + esc(item.name) + '</h3>' +
        textHtml +
        byHtml +
        (plainText.length > 80
          ? '<span class="rf-readmore">Les mer →</span>'
          : "") +
      '</div>' +
    '</article>';
  }

  /* --- Detaljvisning -------------------------------------------------------- */
  function detailHtml(item) {
    var img = App.media.resolveImage(item.image);
    var imgHtml = img.src ? '<div class="rf-detail__img">' + C.coverImg(img, "") + '</div>' : "";
    var textHtml = "";
    if (item.text) {
      if (item.isQuote) {
        textHtml = '<p class="rf-detail__quote">' + C.sanitizeRichHtml(item.text) + '</p>';
        if (item.byName) {
          textHtml += '<p class="rf-detail__by"><strong>' + esc(item.byName) + '</strong>' +
            (item.byTitle ? '<span style="color:var(--color-muted)"> · ' + esc(item.byTitle) + '</span>' : '') + '</p>';
        }
      } else {
        textHtml = '<div class="rf-detail__text">' + C.sanitizeRichHtml(item.text) + '</div>';
      }
    }
    return '<section id="referanser" class="section reveal"><div class="container">' +
      '<div class="rf-back">' +
        C.button({ label: "← Alle referanser", href: "#referanser", variant: "ghost" }) +
      '</div>' +
      '<div class="rf-detail">' +
        imgHtml +
        (item.category ? '<p class="rf-detail__cat">' + esc(item.category) + '</p>' : '') +
        '<h2 class="rf-detail__name">' + esc(item.name) + '</h2>' +
        textHtml +
      '</div>' +
    '</div></section>';
  }

  /* =========================================================================
     INLINE-SEKSJON (forsiden)
     ====================================================================== */
  function renderSection() {
    var items = sorted(getItems());
    if (!items.length) return "";
    var preview = items.slice(0, PREVIEW_COUNT);
    var hasMore = items.length > PREVIEW_COUNT;
    var cards = preview.map(cardHtml).join("");
    var moreBtn = hasMore
      ? '<div class="rf-more">' +
          C.button({ label: "Se alle referanser (" + items.length + ")", href: "#referanser", variant: "ghost" }) +
        '</div>'
      : "";
    return '<section id="referanser-preview" class="section reveal"><div class="container">' +
      C.eyebrow(RCF.intro || RCF.heading || "Referanser") +
      '<h2 class="section__title">' + esc(RCF.heading || "Referanser") + '</h2>' +
      '<div class="rf-grid rf-grid--preview">' + cards + '</div>' +
      moreBtn +
    '</div></section>';
  }

  /* =========================================================================
     FULLSIDE  (#referanser)
     ====================================================================== */
  function renderPage() {
    // Sjekk om vi er på #referanser/<id>
    var hash = (window.location && window.location.hash || "").replace(/^#/, "");
    var sub = hash.indexOf("referanser/") === 0 ? hash.slice("referanser/".length) : null;
    if (sub) {
      var item = sorted(getItems()).find(function (x) { return x.id === sub; });
      return item ? detailHtml(item) : renderListHtml();
    }
    return renderListHtml();
  }

  function renderListHtml() {
    var items = sorted(getItems());
    var cats = [];
    items.forEach(function (it) {
      if (it.category && cats.indexOf(it.category) === -1) cats.push(it.category);
    });
    var filterHtml = cats.length > 1
      ? '<div class="rf-filters" data-rf-filters>' +
          '<button type="button" class="rf-filter is-active" data-cat="">Alle</button>' +
          cats.map(function (c) {
            return '<button type="button" class="rf-filter" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
          }).join("") +
        '</div>'
      : "";
    var cards = items.length
      ? items.map(function (it) {
          return '<div data-rf-item data-cat="' + esc(it.category || "") + '">' + cardHtml(it) + '</div>';
        }).join("")
      : '<p class="prose prose--muted">Ingen referanser lagt til ennå.</p>';
    return '<section id="referanser" class="section reveal"><div class="container">' +
      C.eyebrow(RCF.intro || RCF.heading || "Referanser") +
      '<h2 class="section__title">' + esc(RCF.heading || "Referanser") + '</h2>' +
      filterHtml +
      '<div class="rf-grid" data-rf-grid>' + cards + '</div>' +
    '</div></section>';
  }

  function mountPage(container) {
    // Klikk på kort → naviger til detaljvisning
    container.addEventListener("click", function (e) {
      var card = e.target.closest("[data-rf-open]");
      if (card) {
        window.location.hash = "#referanser/" + card.getAttribute("data-rf-open");
        return;
      }
      // Kategori-filter
      var btn = e.target.closest("[data-cat]");
      var filters = container.querySelector("[data-rf-filters]");
      if (btn && filters) {
        var cat = btn.getAttribute("data-cat");
        filters.querySelectorAll(".rf-filter").forEach(function (b) {
          b.classList.toggle("is-active", b === btn);
        });
        container.querySelectorAll("[data-rf-item]").forEach(function (el) {
          el.style.display = (!cat || el.getAttribute("data-cat") === cat) ? "" : "none";
        });
      }
    });
  }

  /* =========================================================================
     ADMIN
     ====================================================================== */
  function renderAdmin(root) {
    var items = sorted(getItems());
    root.innerHTML =
      '<div class="rf-adm__head"><h4>Referanser</h4>' +
        C.button({ label: "Ny referanse", icon: "plus", variant: "primary", attrs: "data-rf-new" }) +
      '</div>' +
      '<ul class="admin-list" data-rf-list>' +
        (items.length ? items.map(adminRow).join("") : '<li class="prose prose--muted">Ingen referanser ennå.</li>') +
      '</ul>' +
      '<div data-rf-editor></div>';

    root.querySelector("[data-rf-new]").addEventListener("click", function () {
      openEditor(root, null);
    });
    root.querySelectorAll("[data-rf-edit]").forEach(function (b) {
      b.addEventListener("click", function () { openEditor(root, b.getAttribute("data-rf-edit")); });
    });
    root.querySelectorAll("[data-rf-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-rf-del");
        var item = getItems().find(function (x) { return x.id === id; });
        if (item && item.image) App.media.free(item.image);
        setItems(getItems().filter(function (x) { return x.id !== id; }));
        renderAdmin(root);
      });
    });
  }

  function adminRow(item) {
    var badge = item.category
      ? ' <span class="bk-badge bk-badge--public">' + esc(item.category) + '</span>' : "";
    var mode = item.isQuote ? "sitat" : "tekst";
    return '<li class="admin-row">' +
      '<div class="admin-row__main">' +
        '<strong>' + esc(item.name) + badge + '</strong>' +
        '<span class="admin-row__meta">' + mode + (item.text ? ' · ' + esc(C.stripHtml(item.text).slice(0, 60)) + '…' : '') + '</span>' +
      '</div>' +
      '<div class="admin-row__actions">' +
        C.button({ label: "Rediger", variant: "ghost", attrs: 'data-rf-edit="' + esc(item.id) + '"' }) +
        C.button({ label: "Slett",   variant: "ghost", attrs: 'data-rf-del="'  + esc(item.id) + '"' }) +
      '</div>' +
    '</li>';
  }

  function openEditor(root, id) {
    var items = getItems();
    var item = id ? items.find(function (x) { return x.id === id; }) : null;
    var ed = root.querySelector("[data-rf-editor]");
    ed.innerHTML =
      '<form class="admin-form admin-form--card" data-rf-form>' +
        '<h4>' + (item ? "Rediger referanse" : "Ny referanse") + '</h4>' +
        C.field({ id: "rf-name",  label: "Kundenavn / prosjektnavn", required: true,  value: item ? item.name : "" }) +
        C.field({ id: "rf-cat",   label: "Kategori / bransje",       value: item ? (item.category || "") : "",
                  placeholder: "f.eks. Bygg, Interiør, IT …", hint: "Brukes som filter på referansesiden" }) +
        App.ui.imageField("rf-image", "Bilde (valgfritt)", item ? item.image : "", 16 / 9) +
        C.richTextField({ id: "rf-text", label: "Tekst / sitat", value: item ? (item.text || "") : "" }) +
        '<div class="field"><label class="imgfield__creditrow" style="font-size:.9rem">' +
          '<input type="checkbox" id="rf-isquote" ' + (item && item.isQuote ? "checked" : "") + '> ' +
          '<span>Vis som sitat (kursiv med anførselstegn)</span>' +
        '</label></div>' +
        '<div data-rf-byfields style="' + (item && item.isQuote ? "" : "display:none") + '">' +
          C.field({ id: "rf-byname",  label: "Navn på den som uttaler seg", value: item ? (item.byName || "") : "" }) +
          C.field({ id: "rf-bytitle", label: "Tittel / stilling",           value: item ? (item.byTitle || "") : "" }) +
        '</div>' +
        C.field({ id: "rf-order", label: "Rekkefølge", type: "number", value: item ? (item.order || 0) : items.length,
                  hint: "Lavere tall vises først" }) +
        '<div class="admin-row__actions">' +
          C.button({ label: item ? "Oppdater" : "Legg til", type: "submit", variant: "primary" }) +
          C.button({ label: "Avbryt", variant: "ghost", attrs: "data-rf-cancel" }) +
        '</div>' +
      '</form>';

    App.ui.bindImageFields(ed);
    App.ui.bindRichTextFields(ed);

    // Vis/skjul sitat-felt
    var chk = ed.querySelector("#rf-isquote");
    var byFields = ed.querySelector("[data-rf-byfields]");
    chk.addEventListener("change", function () {
      byFields.style.display = chk.checked ? "" : "none";
    });

    ed.querySelector("[data-rf-cancel]").addEventListener("click", function () { ed.innerHTML = ""; });
    ed.querySelector("[data-rf-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = ed.querySelector("#rf-name").value.trim();
      if (!name) return;
      var obj = {
        id:       item ? item.id : ("rf-" + Date.now()),
        name:     name,
        category: ed.querySelector("#rf-cat").value.trim(),
        image:    App.ui.readImageField(ed, "rf-image"),
        text:     App.ui.readRichTextField(ed, "rf-text"),
        isQuote:  ed.querySelector("#rf-isquote").checked,
        byName:   ed.querySelector("#rf-byname").value.trim(),
        byTitle:  ed.querySelector("#rf-bytitle").value.trim(),
        order:    parseInt(ed.querySelector("#rf-order").value, 10) || 0
      };
      var list = getItems();
      if (item) {
        var idx = list.findIndex(function (x) { return x.id === item.id; });
        list[idx] = obj;
      } else {
        list.push(obj);
      }
      setItems(list);
      renderAdmin(root);
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  injectStyles();
  App.registerModule({
    id:    "referanser",
    label: RCF.heading || "Referanser",
    order: 35,        // mellom Tjenester (30) og Aktuelt (40)
    // Vises BÅDE som inline-seksjon på forsiden OG som egen side
    render:     renderSection,   // inline-seksjon på forsiden
    inline:     true,            // vis på forsiden selv om page:true
    page:       true,            // har også eigen fullside (#referanser)
    renderPage: renderPage,
    mount:      mountPage,       // same handler: kortklikkene virker på forsiden OG på egensida
    mountPage:  mountPage,
    admin: {
      label:  "Referanser",
      category: "innhold",
      render: function () { return '<div data-rf-root></div>'; },
      mount:  function (body) { renderAdmin(body.querySelector("[data-rf-root]") || body); }
    }
  });
})();
