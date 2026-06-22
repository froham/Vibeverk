/* =============================================================================
   module-scrollbanner.js  —  SCROLLBANNER (offentleg side)
   -----------------------------------------------------------------------------
   Kvar scrollbanner er ein eigen registrert modul med unik id, label og order.
   Det betyr at dei dukkar opp i Navigasjon-fanen og kan plasserast fritt mellom
   andre seksjonar på framsida — mellom Hjem og Om oss, mellom Tenester og
   Aktuelt, osv.

   Parallax-effekt: bakgrunnsbildet beveger seg saktare enn sida ved scrolling,
   noko som er ideelt for stående/portrett-bilete der brukaren "avdekker" bildet
   gradvis. Brukar background-attachment:fixed med JS-fallback for iOS/mobil.

   Lagring:
   - App.store("scrollbanners")  ← liste av banner-definisjonar
     Kvar banner: { id, label, order, title, text, image, overlayColor,
                    overlayOpacity, textColor, height, ctaLabel, ctaUrl,
                    ctaBg, ctaColor, parallax }

   Admin: eigen fane under Innhold → Scrollbanner (CRUD + rekkefølge)
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App;
  var C   = window.Components;
  var CFG = window.SITE_CONFIG || {};
  if (!App || !C) return;
  if (CFG.features && CFG.features.scrollbanner === false) return;

  var esc       = C.esc;
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
    "lav":        "260px",
    "medium":     "420px",
    "høg":        "580px",
    "fullskjerm": "100vh"
  };

  /* =========================================================================
     PARALLAX (JS-variant — fungerer på iOS der background-attachment:fixed ikkje gjer det)
     ====================================================================== */
  function initParallax() {
    if (document.getElementById("sb-parallax-init")) return;
    var marker = document.createElement("span");
    marker.id = "sb-parallax-init";
    document.body.appendChild(marker);

    var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    function updateParallax() {
      document.querySelectorAll(".scrollbanner--parallax .scrollbanner__bg").forEach(function (bg) {
        if (isMobile) {
          // iOS: flytt bakgrunnsbildet med transform i staden
          var section = bg.closest(".scrollbanner");
          if (!section) return;
          var rect   = section.getBoundingClientRect();
          var offset = (rect.top / window.innerHeight) * 40; // 40% parallax-faktor
          bg.style.transform = "translateY(" + offset + "px) scale(1.15)";
        }
        // Desktop: background-attachment:fixed i CSS gjer jobben
      });
    }

    window.addEventListener("scroll", updateParallax, { passive: true });
    window.addEventListener("resize", updateParallax, { passive: true });
    updateParallax();
  }

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("scrollbanner-styles")) return;
    var s = document.createElement("style");
    s.id = "scrollbanner-styles";
    s.textContent = [
      /* Grunnleggjande layout */
      ".scrollbanner{position:relative;width:100%;overflow:hidden;display:flex;align-items:center;justify-content:center}",
      ".scrollbanner__bg{position:absolute;inset:-20%;background-size:cover;background-repeat:no-repeat;background-position:50% 50%;will-change:transform}",
      /* Parallax på desktop via fixed attachment */
      ".scrollbanner--parallax .scrollbanner__bg{background-attachment:fixed;inset:0}",
      /* iOS/mobil: fixed virkar ikkje, JS tar over */
      "@media (max-width:768px){.scrollbanner--parallax .scrollbanner__bg{background-attachment:scroll}}",
      /* Overlegg og innhald */
      ".scrollbanner__overlay{position:absolute;inset:0;pointer-events:none}",
      ".scrollbanner__content{position:relative;z-index:1;text-align:center;padding:3rem var(--gap,1.5rem);max-width:860px;width:100%}",
      ".scrollbanner__title{font-family:var(--font-display);font-size:clamp(1.6rem,4vw,3rem);font-weight:700;line-height:1.12;margin:0 0 .8rem;text-shadow:0 2px 12px rgba(0,0,0,.18)}",
      ".scrollbanner__text{font-size:clamp(.95rem,2vw,1.15rem);line-height:1.7;margin:0 0 1.6rem;max-width:620px;display:block;margin-left:auto;margin-right:auto;text-shadow:0 1px 6px rgba(0,0,0,.15)}",
      ".scrollbanner__cta{display:inline-flex;align-items:center;gap:.5rem;font-weight:700;padding:.8rem 1.8rem;border-radius:999px;font-size:.98rem;text-decoration:none;transition:opacity .2s,transform .15s,box-shadow .2s;box-shadow:0 4px 18px rgba(0,0,0,.18)}",
      ".scrollbanner__cta:hover{opacity:.9;transform:translateY(-2px);box-shadow:0 8px 28px rgba(0,0,0,.22)}",
      /* Admin */
      ".sb-adm-list{display:grid;gap:.5rem;margin-bottom:.9rem}",
      ".sb-adm-row{display:flex;align-items:center;gap:.6rem;padding:.7rem .9rem;background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px}",
      ".sb-adm-row__info{flex:1;min-width:0}",
      ".sb-adm-row__title{font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".sb-adm-row__meta{font-size:.75rem;color:var(--color-muted);margin-top:.1rem}",
      ".sb-adm-row__actions{display:flex;gap:.3rem;flex-shrink:0}",
      ".sb-form-section{border:1px solid var(--color-border);border-radius:var(--radius);padding:.9rem;margin-bottom:.7rem}",
      ".sb-form-section legend{font-weight:600;font-size:.85rem;padding:0 .4rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:.07em}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     RENDER EIN BANNER (brukt av kvar registrert modul)
     ====================================================================== */
  function renderBanner(b) {
    if (!b) return "";
    var img      = App.media.resolveImage(b.image);
    var height   = HEIGHTS[b.height] || HEIGHTS["medium"];
    var parallax = b.parallax !== false; // standard på
    var hasBg    = !!(img.src);

    var bgStyle = hasBg
      ? 'background-image:url(' + esc(img.src) + ');background-position:' + esc(img.pos || "50% 50%") + ';'
      : 'background:var(--color-alt);';

    var overlayOpacity = parseFloat(b.overlayOpacity || "0");
    var overlayStyle   = (b.overlayColor && overlayOpacity > 0)
      ? 'background:' + esc(b.overlayColor) + ';opacity:' + overlayOpacity + ';'
      : '';

    var textColor = b.textColor || (hasBg ? "#ffffff" : "var(--color-text)");
    var cls = "scrollbanner section reveal" + (hasBg && parallax ? " scrollbanner--parallax" : "");

    return '<section class="' + cls + '" id="' + esc(b.id) + '" style="min-height:' + height + '">' +
      '<div class="scrollbanner__bg" style="' + bgStyle + '"></div>' +
      (overlayStyle ? '<div class="scrollbanner__overlay" style="' + overlayStyle + '"></div>' : '') +
      ((b.title || b.text || (b.ctaLabel && b.ctaUrl))
        ? '<div class="scrollbanner__content">' +
            (b.title ? '<h2 class="scrollbanner__title" style="color:' + esc(textColor) + '">' + esc(b.title) + '</h2>' : '') +
            (b.text  ? '<span class="scrollbanner__text"  style="color:' + esc(textColor) + '">' + esc(b.text) + '</span>' : '') +
            (b.ctaLabel && b.ctaUrl
              ? '<a href="' + esc(b.ctaUrl) + '" class="scrollbanner__cta" style="background:' + esc(b.ctaBg || "var(--color-primary)") + ';color:' + esc(b.ctaColor || "#fff") + '">' + esc(b.ctaLabel) + '</a>'
              : '') +
          '</div>'
        : '') +
    '</section>';
  }

  /* =========================================================================
     DYNAMISK MODUL-REGISTRERING
     Kvar banner vert ein eigen modul i App-registeret.
     ====================================================================== */
  var registered = {}; // id → true, for å unngå dobbel-registrering

  function syncModules() {
    var banners = getBanners();
    banners.forEach(function (b) {
      if (registered[b.id]) return; // allereie registrert
      registered[b.id] = true;

      var banner = b; // closure-kopi
      App.registerModule({
        id:    b.id,
        label: b.label || "Scrollbanner",
        order: typeof b.order === "number" ? b.order : 25,
        render: function () { return renderBanner(getBanners().find(function (x) { return x.id === banner.id; }) || banner); },
        mount:  function (el) {
          if (banner.parallax !== false) initParallax();
        }
      });
    });
  }

  /* =========================================================================
     ADMIN — hovudfane (CRUD)
     ====================================================================== */
  function renderAdminRoot(root) {
    var banners = getBanners();

    root.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.8rem">' +
        '<div>' +
          '<h4 style="margin:0">Scrollbanner-seksjonar</h4>' +
          '<p class="prose prose--muted" style="margin:.25rem 0 0;font-size:.82rem">Kvar banner er ein eigen seksjon du kan plassere fritt i Navigasjon-fanen.</p>' +
        '</div>' +
        C.button({ label:"Ny seksjon", icon:"plus", variant:"primary", attrs:"data-sb-new" }) +
      '</div>' +
      '<div class="sb-adm-list">' +
        (banners.length
          ? banners.map(bannerAdminRow).join("")
          : '<p class="prose prose--muted">Ingen seksjonar ennå. Opprett ein ny for å kome i gang.</p>'
        ) +
      '</div>' +
      '<div data-sb-editor></div>';

    App.ui.bindImageFields(root);
    bindAdminRoot(root);
  }

  function bannerAdminRow(b) {
    var img     = App.media.resolveImage(b.image);
    var hasBg   = !!(img.src);
    var preview = b.title
      ? esc(b.title)
      : hasBg ? "(bilde utan tekst)" : "(tom seksjon)";

    return '<div class="sb-adm-row" data-sb-row="' + esc(b.id) + '">' +
      (hasBg
        ? '<div style="width:44px;height:36px;border-radius:6px;background-image:url(' + esc(img.src) + ');background-size:cover;background-position:50% 50%;flex-shrink:0"></div>'
        : '<div style="width:44px;height:36px;border-radius:6px;background:var(--color-alt);flex-shrink:0"></div>') +
      '<div class="sb-adm-row__info">' +
        '<div class="sb-adm-row__title">' + preview + '</div>' +
        '<div class="sb-adm-row__meta">' +
          esc(b.height || "medium") +
          (b.parallax !== false ? " · parallax" : "") +
          (hasBg ? " · med bilde" : "") +
          ' · order ' + (b.order || 25) +
        '</div>' +
      '</div>' +
      '<div class="sb-adm-row__actions">' +
        C.button({ label:"Rediger", variant:"ghost", attrs:'data-sb-edit="' + esc(b.id) + '"' }) +
        C.button({ label:"Slett",   variant:"ghost", attrs:'data-sb-del="'  + esc(b.id) + '"' }) +
      '</div>' +
    '</div>';
  }

  function bindAdminRoot(root) {
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
        var b  = getBanners().find(function (x) { return x.id === id; });
        if (!b || !confirm('Slett "' + (b.label || b.title || "seksjon") + '"?')) return;
        setBanners(getBanners().filter(function (x) { return x.id !== id; }));
        // Fjern frå registered slik at han kan re-registrerast med ny config
        delete registered[id];
        renderAdminRoot(root);
      });
    });
  }

  /* =========================================================================
     EDITOR
     ====================================================================== */
  function openEditor(root, banner) {
    var ed = root.querySelector("[data-sb-editor]");
    if (!ed) return;
    var b = banner || {};

    // Foreslå neste order-verdi
    var nextOrder = 25;
    if (!b.id) {
      var orders = getBanners().map(function (x) { return x.order || 25; });
      nextOrder = orders.length ? Math.max.apply(null, orders) + 5 : 25;
    }

    ed.innerHTML =
      '<div class="admin-form admin-form--card" style="margin-top:.9rem">' +
        '<h4 style="margin:0 0 1rem">' + (b.id ? "Rediger seksjon" : "Ny seksjon") + '</h4>' +

        /* Identitet */
        '<fieldset class="sb-form-section"><legend>Identitet</legend>' +
          C.field({ id:"sb-label", label:"Namn i navigasjonsmeny *", value: b.label || "", hint:"T.d. «Banner 1», «Kampanje» eller «Mellomrom»" }) +
          '<div class="field"><label for="sb-order">Plassering (order-tal)</label>' +
            '<input id="sb-order" type="number" min="1" max="999" step="1" value="' + esc(String(b.order || nextOrder)) + '">' +
            '<p class="field__hint" style="font-size:.78rem;color:var(--color-muted);margin:.2rem 0 0">Hjem=10, Om oss=20, Tenester=30, Aktuelt=40, Kontakt=50. Legg mellom ved å velje eit tal imellom.</p>' +
          '</div>' +
        '</fieldset>' +

        /* Bilde og parallax */
        '<fieldset class="sb-form-section"><legend>Bilde</legend>' +
          App.ui.imageField("sb-image", "Bakgrunnsbilde (valgfritt)", b.image, 3) +
          '<label style="display:flex;align-items:center;gap:.5rem;margin-top:.7rem;font-size:.88rem;cursor:pointer">' +
            '<input type="checkbox" id="sb-parallax"' + (b.parallax !== false ? " checked" : "") + '>' +
            'Parallax-effekt (bildet beveger seg saktare enn sida ved scrolling)' +
          '</label>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:.7rem">' +
            '<div class="field"><label for="sb-overlay-color">Overleggsfarge</label>' +
              '<input type="color" id="sb-overlay-color" value="' + esc(b.overlayColor || "#000000") + '"></div>' +
            '<div class="field"><label for="sb-overlay-opacity">Dekking (0 = ingen, 1 = heilt dekt)</label>' +
              '<input type="number" id="sb-overlay-opacity" min="0" max="1" step="0.05" value="' + esc(String(b.overlayOpacity !== undefined ? b.overlayOpacity : 0)) + '"></div>' +
          '</div>' +
        '</fieldset>' +

        /* Høgde */
        '<fieldset class="sb-form-section"><legend>Høgde</legend>' +
          '<div class="field"><label for="sb-height">Høgde på seksjonen</label>' +
            '<select id="sb-height">' +
              ['lav:Lav (260px)', 'medium:Medium (420px)', 'høg:Høg (580px)', 'fullskjerm:Fullskjerm (100vh)'].map(function (h) {
                var parts = h.split(":");
                return '<option value="' + esc(parts[0]) + '"' + (parts[0] === (b.height || "medium") ? " selected" : "") + '>' + esc(parts[1]) + '</option>';
              }).join("") +
            '</select>' +
          '</div>' +
        '</fieldset>' +

        /* Tekst */
        '<fieldset class="sb-form-section"><legend>Tekst (valgfritt)</legend>' +
          C.field({ id:"sb-title", label:"Tittel",  value: b.title || "" }) +
          C.field({ id:"sb-text",  label:"Brødtekst", value: b.text  || "", multiline:true, rows:2 }) +
          '<div class="field"><label for="sb-text-color">Tekstfarge</label>' +
            '<input type="color" id="sb-text-color" value="' + esc(b.textColor || "#ffffff") + '"></div>' +
        '</fieldset>' +

        /* CTA */
        '<fieldset class="sb-form-section"><legend>CTA-knapp (valgfritt)</legend>' +
          C.field({ id:"sb-cta-label", label:"Knapptekst",  value: b.ctaLabel || "" }) +
          C.field({ id:"sb-cta-url",   label:"Lenke (URL)", value: b.ctaUrl   || "" }) +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">' +
            '<div class="field"><label for="sb-cta-bg">Knappfarge</label><input type="color" id="sb-cta-bg" value="' + esc(b.ctaBg || "#15616D") + '"></div>' +
            '<div class="field"><label for="sb-cta-color">Tekstfarge</label><input type="color" id="sb-cta-color" value="' + esc(b.ctaColor || "#ffffff") + '"></div>' +
          '</div>' +
        '</fieldset>' +

        '<div style="display:flex;gap:.6rem">' +
          C.button({ label:"Lagre", variant:"primary", attrs:"data-sb-save" }) +
          C.button({ label:"Avbryt", variant:"ghost", attrs:"data-sb-cancel" }) +
        '</div>' +
        '<p class="form__status" id="sb-status"></p>' +
      '</div>';

    App.ui.bindImageFields(ed);

    ed.querySelector("[data-sb-cancel]").addEventListener("click", function () {
      ed.innerHTML = "";
    });

    ed.querySelector("[data-sb-save]").addEventListener("click", function () {
      var label = ed.querySelector("#sb-label").value.trim();
      var st    = ed.querySelector("#sb-status");
      if (!label) {
        st.textContent = "Namn i navigasjonsmeny er påkrevd.";
        st.className = "form__status is-err";
        return;
      }

      var obj = {
        id:             b.id || newId(),
        label:          label,
        order:          parseInt(ed.querySelector("#sb-order").value, 10) || nextOrder,
        title:          ed.querySelector("#sb-title").value.trim(),
        text:           ed.querySelector("#sb-text").value.trim(),
        image:          App.ui.readImageField(ed, "sb-image"),
        parallax:       ed.querySelector("#sb-parallax").checked,
        overlayColor:   ed.querySelector("#sb-overlay-color").value,
        overlayOpacity: parseFloat(ed.querySelector("#sb-overlay-opacity").value) || 0,
        textColor:      ed.querySelector("#sb-text-color").value,
        height:         ed.querySelector("#sb-height").value,
        ctaLabel:       ed.querySelector("#sb-cta-label").value.trim(),
        ctaUrl:         ed.querySelector("#sb-cta-url").value.trim(),
        ctaBg:          ed.querySelector("#sb-cta-bg").value,
        ctaColor:       ed.querySelector("#sb-cta-color").value
      };

      var list = getBanners();
      if (b.id) {
        var idx = list.findIndex(function (x) { return x.id === b.id; });
        if (idx >= 0) list[idx] = obj; else list.push(obj);
        // Tillat re-registrering med oppdatert order/label
        delete registered[b.id];
      } else {
        list.push(obj);
      }
      setBanners(list);

      // Registrer den nye/oppdaterte modulen
      syncModules();

      ed.innerHTML = "";
      renderAdminRoot(root);
    });
  }

  /* =========================================================================
     OPPSTART — registrer alle eksisterande bannarar
     ====================================================================== */
  injectStyles();
  syncModules();

  /* =========================================================================
     ADMIN-INNGANGSPUNKT (eigen fane i Admin → Innhold)
     ====================================================================== */
  App.registerModule({
    id:      "scrollbanner-admin",
    label:   "",          // tom = vises ikkje i nav
    order:   9999,
    adminOnly: true,
    render:  function () { return ""; },
    admin: {
      label:    "Scrollbanner",
      category: "innhold",
      render:   function () { return '<div data-sb-admin-root></div>'; },
      mount:    function (body) {
        var root = body.querySelector("[data-sb-admin-root]") || body;
        renderAdminRoot(root);
      }
    }
  });

})();
