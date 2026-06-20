/* =============================================================================
   module-scrollbanner.js  —  SCROLLBANNER (offentleg side)
   -----------------------------------------------------------------------------
   Ein tom seksjon som besøkande kan scrolle forbi. Brukast til å lage
   visuelle pausar, fullbredde bilete med tekst, CTA-banner eller tomme
   mellomrom i sideflyten.

   Funksjonar:
   - Valgfritt bakgrunnsbilde (med fokuspunkt-beskjæring)
   - Valgfri overleggsfarge med justerbar gjennomsiktigheit
   - Valgfri tittel og brødtekst
   - Valgfri CTA-knapp (tekst + lenke)
   - Justerbar høgde (lav / medium / høg / fullskjerm)
   - Admin: CRUD for fleire banner-seksjonar

   Lagring:  App.store("scrollbanners")
   Seksjon:  vises inline på forsida (page: false)
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App;
  var C   = window.Components;
  var CFG = window.SITE_CONFIG || {};
  if (!App || !C) return;
  if (CFG.features && CFG.features.scrollbanner === false) return;

  var esc  = C.esc;
  var STORE_KEY = "scrollbanners";

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getBanners() { return App.store.get(STORE_KEY, []) || []; }
  function setBanners(v) { App.store.set(STORE_KEY, v); }

  function newId() {
    return "sb-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }

  /* =========================================================================
     HØGDER
     ====================================================================== */
  var HEIGHTS = {
    lav:        "220px",
    medium:     "360px",
    høg:        "520px",
    fullskjerm: "100vh"
  };

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("scrollbanner-styles")) return;
    var s = document.createElement("style");
    s.id = "scrollbanner-styles";
    s.textContent = [
      ".scrollbanner{position:relative;width:100%;overflow:hidden;display:flex;align-items:center;justify-content:center}",
      ".scrollbanner__bg{position:absolute;inset:0;background-size:cover;background-repeat:no-repeat}",
      ".scrollbanner__overlay{position:absolute;inset:0}",
      ".scrollbanner__content{position:relative;z-index:1;text-align:center;padding:2rem var(--gap,1.5rem);max-width:860px;width:100%}",
      ".scrollbanner__title{font-family:var(--font-display);font-size:clamp(1.5rem,4vw,2.8rem);font-weight:700;line-height:1.15;margin:0 0 .75rem}",
      ".scrollbanner__text{font-size:clamp(.95rem,2vw,1.1rem);line-height:1.7;margin:0 0 1.4rem;max-width:600px;display:block;margin-left:auto;margin-right:auto}",
      ".scrollbanner__cta{display:inline-flex;align-items:center;gap:.5rem;font-weight:700;padding:.75rem 1.6rem;border-radius:999px;font-size:.95rem;text-decoration:none;transition:opacity .2s,transform .15s}",
      ".scrollbanner__cta:hover{opacity:.88;transform:translateY(-1px)}",
      /* Admin */
      ".sb-adm-row{display:flex;align-items:center;gap:.6rem;justify-content:space-between;padding:.65rem .9rem;background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;margin-bottom:.5rem}",
      ".sb-adm-row__main{font-size:.9rem;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".sb-adm-row__meta{font-size:.78rem;color:var(--color-muted)}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     RENDER SEKSJON (offentleg)
     ====================================================================== */
  function renderSection() {
    var banners = getBanners();
    if (!banners.length) return "";

    return banners.map(function (b) {
      var img    = App.media.resolveImage(b.image);
      var height = HEIGHTS[b.height] || HEIGHTS.medium;
      var hasBg  = img.src || b.overlayColor;
      var textColor = b.textColor || (hasBg ? "#ffffff" : "var(--color-text)");

      var bgStyle = img.src
        ? 'background-image:url(' + esc(img.src) + ');background-position:' + esc(img.pos || "50% 50%") + ';'
        : '';

      var overlayStyle = b.overlayColor
        ? 'background:' + esc(b.overlayColor) + ';opacity:' + (parseFloat(b.overlayOpacity || "0.4")) + ';'
        : '';

      return '<section class="scrollbanner reveal" id="scrollbanner-' + esc(b.id) + '" style="min-height:' + height + '">' +
        (bgStyle    ? '<div class="scrollbanner__bg" style="' + bgStyle + '"></div>' : '') +
        (overlayStyle ? '<div class="scrollbanner__overlay" style="' + overlayStyle + '"></div>' : '') +
        '<div class="scrollbanner__content">' +
          (b.title ? '<h2 class="scrollbanner__title" style="color:' + esc(textColor) + '">' + esc(b.title) + '</h2>' : '') +
          (b.text  ? '<span class="scrollbanner__text" style="color:' + esc(textColor) + '">' + esc(b.text) + '</span>' : '') +
          (b.ctaLabel && b.ctaUrl
            ? '<a href="' + esc(b.ctaUrl) + '" class="scrollbanner__cta" style="background:' + esc(b.ctaBg || "var(--color-primary)") + ';color:' + esc(b.ctaColor || "#fff") + '">' + esc(b.ctaLabel) + '</a>'
            : '') +
        '</div>' +
      '</section>';
    }).join("");
  }

  /* =========================================================================
     ADMIN
     ====================================================================== */
  function renderAdmin(root) {
    var banners = getBanners();

    root.innerHTML =
      '<div class="faq-adm__head"><h4>Scrollbanner-seksjonar</h4>' +
        C.button({ label:"Ny seksjon", icon:"plus", variant:"primary", attrs:"data-sb-new" }) +
      '</div>' +
      '<p class="prose prose--muted" style="margin:.4rem 0 .9rem;font-size:.85rem">Bannerane visast i rekkefølge nedover på framsida. Tom seksjon (utan bilde og tekst) gjev ein visuell pause.</p>' +
      (banners.length
        ? banners.map(function (b, i) {
            return '<div class="sb-adm-row">' +
              '<div>' +
                '<div class="sb-adm-row__main">' + esc(b.title || "(Tom seksjon)") + '</div>' +
                '<div class="sb-adm-row__meta">' + esc(b.height || "medium") + (b.image && b.image.src ? ' · med bilde' : '') + '</div>' +
              '</div>' +
              '<div style="display:flex;gap:.4rem">' +
                (i > 0 ? C.button({ label:"↑", variant:"ghost", attrs:'data-sb-up="' + esc(b.id) + '"' }) : '') +
                (i < banners.length - 1 ? C.button({ label:"↓", variant:"ghost", attrs:'data-sb-dn="' + esc(b.id) + '"' }) : '') +
                C.button({ label:"Rediger", variant:"ghost", attrs:'data-sb-edit="' + esc(b.id) + '"' }) +
                C.button({ label:"Slett", variant:"ghost", attrs:'data-sb-del="' + esc(b.id) + '"' }) +
              '</div>' +
            '</div>';
          }).join("")
        : '<p class="prose prose--muted">Ingen seksjonar ennå.</p>'
      ) +
      '<div data-sb-editor></div>';

    /* Bind */
    root.querySelector("[data-sb-new]").addEventListener("click", function () {
      openEditor(root, null);
    });
    root.querySelectorAll("[data-sb-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-sb-edit");
        var b  = getBanners().find(function (x) { return x.id === id; });
        if (b) openEditor(root, b);
      });
    });
    root.querySelectorAll("[data-sb-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-sb-del");
        setBanners(getBanners().filter(function (x) { return x.id !== id; }));
        renderAdmin(root);
      });
    });
    root.querySelectorAll("[data-sb-up]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var list = getBanners();
        var id = btn.getAttribute("data-sb-up");
        var idx = list.findIndex(function (x) { return x.id === id; });
        if (idx > 0) { var tmp = list[idx]; list[idx] = list[idx-1]; list[idx-1] = tmp; setBanners(list); renderAdmin(root); }
      });
    });
    root.querySelectorAll("[data-sb-dn]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var list = getBanners();
        var id = btn.getAttribute("data-sb-dn");
        var idx = list.findIndex(function (x) { return x.id === id; });
        if (idx < list.length - 1) { var tmp = list[idx]; list[idx] = list[idx+1]; list[idx+1] = tmp; setBanners(list); renderAdmin(root); }
      });
    });

    App.ui.bindImageFields(root);
  }

  function openEditor(root, banner) {
    var ed = root.querySelector("[data-sb-editor]");
    if (!ed) return;
    var b = banner || {};

    ed.innerHTML =
      '<form class="admin-form admin-form--card" data-sb-form style="margin-top:.9rem">' +
        '<h4>' + (b.id ? "Rediger seksjon" : "Ny seksjon") + '</h4>' +

        C.field({ id:"sb-title",   label:"Tittel (valgfritt)",    value: b.title  || "" }) +
        C.field({ id:"sb-text",    label:"Tekst (valgfritt)",     value: b.text   || "", multiline:true, rows:3 }) +
        App.ui.imageField("sb-image", "Bakgrunnsbilde (valgfritt)", b.image, 3) +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">' +
          '<div class="field"><label for="sb-overlay-color">Overleggsfarge</label>' +
            '<input type="color" id="sb-overlay-color" value="' + esc(b.overlayColor || "#000000") + '"></div>' +
          '<div class="field"><label for="sb-overlay-opacity">Dekking (0–1)</label>' +
            '<input type="number" id="sb-overlay-opacity" min="0" max="1" step="0.05" value="' + esc(String(b.overlayOpacity !== undefined ? b.overlayOpacity : "0")) + '"></div>' +
        '</div>' +

        '<div class="field"><label for="sb-text-color">Tekstfarge</label>' +
          '<input type="color" id="sb-text-color" value="' + esc(b.textColor || "#ffffff") + '"></div>' +

        '<div class="field"><label for="sb-height">Høgde</label>' +
          '<select id="sb-height">' +
            ['lav', 'medium', 'høg', 'fullskjerm'].map(function (h) {
              return '<option value="' + esc(h) + '"' + (h === (b.height || "medium") ? " selected" : "") + '>' + esc(h.charAt(0).toUpperCase() + h.slice(1)) + '</option>';
            }).join("") +
          '</select>' +
        '</div>' +

        '<fieldset class="admin-group"><legend>CTA-knapp (valgfritt)</legend>' +
          C.field({ id:"sb-cta-label", label:"Knapptekst",  value: b.ctaLabel || "" }) +
          C.field({ id:"sb-cta-url",   label:"Lenke (URL)", value: b.ctaUrl   || "" }) +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">' +
            '<div class="field"><label for="sb-cta-bg">Knappfarge</label><input type="color" id="sb-cta-bg" value="' + esc(b.ctaBg || "#15616D") + '"></div>' +
            '<div class="field"><label for="sb-cta-color">Tekstfarge</label><input type="color" id="sb-cta-color" value="' + esc(b.ctaColor || "#ffffff") + '"></div>' +
          '</div>' +
        '</fieldset>' +

        '<div style="display:flex;gap:.6rem">' +
          C.button({ label:"Lagre", type:"submit", variant:"primary" }) +
          C.button({ label:"Avbryt", variant:"ghost", attrs:"data-sb-cancel" }) +
        '</div>' +
        '<p class="form__status" data-sb-status></p>' +
      '</form>';

    App.ui.bindImageFields(ed);

    ed.querySelector("[data-sb-cancel]").addEventListener("click", function () {
      ed.innerHTML = "";
    });

    ed.querySelector("[data-sb-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      var list = getBanners();
      var obj = {
        id:             b.id || newId(),
        title:          ed.querySelector("#sb-title").value.trim(),
        text:           ed.querySelector("#sb-text").value.trim(),
        image:          App.ui.readImageField(ed, "sb-image"),
        overlayColor:   ed.querySelector("#sb-overlay-color").value,
        overlayOpacity: parseFloat(ed.querySelector("#sb-overlay-opacity").value) || 0,
        textColor:      ed.querySelector("#sb-text-color").value,
        height:         ed.querySelector("#sb-height").value,
        ctaLabel:       ed.querySelector("#sb-cta-label").value.trim(),
        ctaUrl:         ed.querySelector("#sb-cta-url").value.trim(),
        ctaBg:          ed.querySelector("#sb-cta-bg").value,
        ctaColor:       ed.querySelector("#sb-cta-color").value
      };

      if (b.id) {
        var idx = list.findIndex(function (x) { return x.id === b.id; });
        if (idx >= 0) list[idx] = obj; else list.push(obj);
      } else {
        list.push(obj);
      }
      setBanners(list);
      ed.innerHTML = "";
      renderAdmin(root);

      var st = root.querySelector("[data-sb-status]");
      if (st) { st.textContent = "Lagret."; st.className = "form__status is-ok"; }
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  injectStyles();

  App.registerModule({
    id:    "scrollbanner",
    label: "Scrollbanner",
    order: 22,          // mellom Hero (order 10) og Om oss (order 25) som standard
    render: renderSection,
    mount:  function () {},
    admin: {
      label:    "Scrollbanner",
      category: "innhold",
      render:   function () { return '<div data-sb-root></div>'; },
      mount:    function (body) {
        var root = body.querySelector("[data-sb-root]") || body;
        renderAdmin(root);
      }
    }
  });

})();
