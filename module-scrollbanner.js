/* =============================================================================
   module-scrollbanner.js  —  SCROLLBANNER (offentleg side)
   -----------------------------------------------------------------------------
   To modus:
   1) STATISK      — fast bilde, background-attachment:scroll
   2) PARALLAX     — background-attachment:fixed, bildet står stille medan
                     seksjonen scrollar over som eit vindauge (VG/Nille-effekt)

   Forhåndsvisning og utsnitt: gjenbrukar App.ui.imageField med riktig
   aspect-ratio (16:9 for statisk, 9:16 for parallax portrett).
   Dra det lyse utsnittet for å velje kva del av bildet som visast.
   pos-verdien frå imageField er direkte brukbar som background-position.

   Kvar banner = eigen registrert modul, vises i Navigasjon-fanen men
   IKKJE i toppmeny (navHidden:true).
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
  function newId()       { return "sb-" + Date.now() + "-" + Math.random().toString(36).slice(2,6); }

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("scrollbanner-styles")) return;
    var s = document.createElement("style");
    s.id  = "scrollbanner-styles";
    s.textContent = [
      /* Felles */
      ".sb-section{position:relative;width:100%;display:flex;align-items:center;justify-content:center}",

      /* Statisk — bildet er fast, scrollar med sida */
      ".sb-section--static{overflow:hidden}",
      ".sb-section--static .sb-bg{position:absolute;inset:0;background-size:cover;background-repeat:no-repeat;background-attachment:scroll}",

      /* Parallax — bildet er fast i viewport medan seksjonen scrollar over */
      ".sb-section--parallax{overflow:hidden}",
      ".sb-section--parallax .sb-bg{position:absolute;inset:0;background-size:cover;background-repeat:no-repeat;background-attachment:fixed}",
      /* iOS-fallback: fixed fungerer ikkje på iPhone/iPad */
      "@supports (-webkit-touch-callout: none){.sb-section--parallax .sb-bg{background-attachment:scroll}}",

      /* Overlegg og innhald */
      ".sb-overlay{position:absolute;inset:0;pointer-events:none}",
      ".sb-content{position:relative;z-index:1;text-align:center;padding:3rem var(--gap,1.5rem);max-width:860px;width:100%}",
      ".sb-title{font-family:var(--font-display);font-size:clamp(1.5rem,4vw,2.8rem);font-weight:700;line-height:1.12;margin:0 0 .75rem;text-shadow:0 2px 12px rgba(0,0,0,.2)}",
      ".sb-text{font-size:clamp(.92rem,2vw,1.1rem);line-height:1.7;margin:0 0 1.5rem;max-width:620px;display:block;margin-left:auto;margin-right:auto;text-shadow:0 1px 6px rgba(0,0,0,.15)}",
      ".sb-cta{display:inline-flex;align-items:center;gap:.5rem;font-weight:700;padding:.78rem 1.75rem;border-radius:999px;font-size:.95rem;text-decoration:none;transition:opacity .2s,transform .15s,box-shadow .2s;box-shadow:0 4px 18px rgba(0,0,0,.18)}",
      ".sb-cta:hover{opacity:.9;transform:translateY(-2px)}",

      /* Admin */
      ".sb-adm-row{display:flex;align-items:center;gap:.65rem;padding:.7rem .9rem;background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;margin-bottom:.45rem}",
      ".sb-adm-thumb{width:52px;height:36px;border-radius:6px;background:var(--color-alt);flex-shrink:0;background-size:cover;background-position:50% 50%}",
      ".sb-adm-info{flex:1;min-width:0}",
      ".sb-adm-title{font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".sb-adm-meta{font-size:.75rem;color:var(--color-muted);margin-top:.1rem}",
      ".sb-adm-btns{display:flex;gap:.3rem;flex-shrink:0}",
      ".sb-fieldset{border:1px solid var(--color-border);border-radius:10px;padding:.85rem;margin-bottom:.6rem}",
      ".sb-fieldset legend{font-weight:600;font-size:.82rem;padding:0 .35rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:.07em}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     RENDER EIN BANNER
     ====================================================================== */
  function renderBanner(b) {
    if (!b) return "";
    var img      = App.media.resolveImage(b.image);
    var hasBg    = !!(img && img.src);
    var isParallax = b.mode === "parallax";
    var height   = { lav:"260px", medium:"420px", høg:"580px", fullskjerm:"100vh" }[b.height] || "420px";
    var textColor = b.textColor || (hasBg ? "#ffffff" : "var(--color-text)");
    var bgPos    = (img && img.pos) ? img.pos : "50% 50%";

    var sectionCls = "sb-section section reveal " + (isParallax ? "sb-section--parallax" : "sb-section--static");
    var bgStyle    = hasBg
      ? "background-image:url(" + esc(img.src) + ");background-position:" + esc(bgPos) + ";"
      : "background:var(--color-alt);";

    var overlayHtml = (b.overlayColor && parseFloat(b.overlayOpacity || "0") > 0)
      ? '<div class="sb-overlay" style="background:' + esc(b.overlayColor) + ';opacity:' + parseFloat(b.overlayOpacity) + '"></div>'
      : "";

    var contentHtml = (b.title || b.text || (b.ctaLabel && b.ctaUrl))
      ? '<div class="sb-content">' +
          (b.title ? '<h2 class="sb-title" style="color:' + esc(textColor) + '">' + esc(b.title) + '</h2>' : "") +
          (b.text  ? '<span class="sb-text" style="color:' + esc(textColor) + '">' + esc(b.text) + '</span>' : "") +
          (b.ctaLabel && b.ctaUrl
            ? '<a href="' + esc(b.ctaUrl) + '" class="sb-cta" style="background:' + esc(b.ctaBg || "var(--color-primary)") + ';color:' + esc(b.ctaColor || "#fff") + '">' + esc(b.ctaLabel) + '</a>'
            : "") +
        '</div>'
      : "";

    return '<section class="' + sectionCls + '" id="' + esc(b.id) + '" style="min-height:' + height + '">' +
      '<div class="sb-bg" style="' + bgStyle + '"></div>' +
      overlayHtml + contentHtml +
    '</section>';
  }

  /* =========================================================================
     DYNAMISK REGISTRERING
     ====================================================================== */
  var registered = {};

  function syncModules() {
    getBanners().forEach(function (b) {
      if (registered[b.id]) return;
      registered[b.id] = true;
      var bid = b.id;
      App.registerModule({
        id:        b.id,
        label:     b.label || "Scrollbanner",
        order:     typeof b.order === "number" ? b.order : 25,
        navHidden: true,
        render:    function () {
          var cur = getBanners().find(function (x) { return x.id === bid; });
          return cur ? renderBanner(cur) : "";
        },
        mount:     function () {}
      });
    });
  }

  /* =========================================================================
     ADMIN — CRUD
     ====================================================================== */
  function renderAdminRoot(root) {
    var banners = getBanners();
    root.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:.8rem;margin-bottom:.8rem">' +
        '<div>' +
          '<h4 style="margin:0">Scrollbanner-seksjonar</h4>' +
          '<p class="prose prose--muted" style="margin:.2rem 0 0;font-size:.82rem">Kvar seksjon kan plasserast fritt i Navigasjon-fanen. Vises ikkje i toppmeny.</p>' +
        '</div>' +
        C.button({ label:"Ny seksjon", icon:"plus", variant:"primary", attrs:"data-sb-new" }) +
      '</div>' +
      '<div id="sb-list">' +
        (banners.length
          ? banners.map(function (b) {
              var img = App.media.resolveImage(b.image);
              var hasBg = !!(img && img.src);
              return '<div class="sb-adm-row">' +
                '<div class="sb-adm-thumb" style="' + (hasBg ? "background-image:url(" + esc(img.src) + ")" : "") + '"></div>' +
                '<div class="sb-adm-info">' +
                  '<div class="sb-adm-title">' + esc(b.label || "(Utan namn)") + '</div>' +
                  '<div class="sb-adm-meta">' + esc(b.height || "medium") + " · " + esc(b.mode === "parallax" ? "parallax" : "statisk") + (hasBg ? " · bilde" : "") + " · order " + (b.order || 25) + '</div>' +
                '</div>' +
                '<div class="sb-adm-btns">' +
                  C.button({ label:"Rediger", variant:"ghost", attrs:'data-sb-edit="' + esc(b.id) + '"' }) +
                  C.button({ label:"Slett",   variant:"ghost", attrs:'data-sb-del="'  + esc(b.id) + '"' }) +
                '</div>' +
              '</div>';
            }).join("")
          : '<p class="prose prose--muted">Ingen seksjonar ennå.</p>'
        ) +
      '</div>' +
      '<div id="sb-editor"></div>';

    App.ui.bindImageFields(root);
    bindAdmin(root);
  }

  function bindAdmin(root) {
    root.querySelector("[data-sb-new]").addEventListener("click", function () { openEditor(root, null); });
    root.querySelectorAll("[data-sb-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var b = getBanners().find(function (x) { return x.id === btn.getAttribute("data-sb-edit"); });
        if (b) openEditor(root, b);
      });
    });
    root.querySelectorAll("[data-sb-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-sb-del");
        var b  = getBanners().find(function (x) { return x.id === id; });
        if (!b || !confirm('Slett "' + (b.label || "seksjon") + '"?')) return;
        setBanners(getBanners().filter(function (x) { return x.id !== id; }));
        delete registered[id];
        renderAdminRoot(root);
      });
    });
  }

  function openEditor(root, banner) {
    var ed = root.querySelector("#sb-editor");
    if (!ed) return;
    var b = banner || {};
    var nextOrder = 25;
    if (!b.id) {
      var orders = getBanners().map(function (x) { return x.order || 25; });
      nextOrder = orders.length ? Math.max.apply(null, orders) + 5 : 25;
    }
    var isParallax = b.mode === "parallax";
    /* Aspect ratio: parallax brukar 9:16 portrett som standard forhåndsvisning,
       statisk brukar 16:9. Begge kan bruke kva bilde som helst. */
    var aspect = isParallax ? (9/16) : (16/9);

    ed.innerHTML =
      '<div class="admin-form admin-form--card" style="margin-top:.9rem">' +
        '<h4 style="margin:0 0 1rem">' + (b.id ? "Rediger seksjon" : "Ny seksjon") + '</h4>' +

        '<fieldset class="sb-fieldset"><legend>Identitet</legend>' +
          C.field({ id:"sb-label", label:"Namn (visast i Navigasjon-fanen) *", value: b.label || "" }) +
          '<div class="field"><label for="sb-order">Plassering (order)</label>' +
            '<input id="sb-order" type="number" min="1" max="999" value="' + esc(String(b.order || nextOrder)) + '">' +
            '<p style="font-size:.76rem;color:var(--color-muted);margin:.2rem 0 0">Hjem=10 · Om oss=20 · Tenester=30 · Aktuelt=40 · Kontakt=50</p>' +
          '</div>' +
        '</fieldset>' +

        '<fieldset class="sb-fieldset"><legend>Modus</legend>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem" id="sb-mode-wrap">' +
            modeCard("static",   "Statisk",        "Fast bilde, scrollar med sida",          !isParallax) +
            modeCard("parallax", "Parallax-scroll", "Bildet er fast, sida scrollar over det", isParallax) +
          '</div>' +
          '<p style="font-size:.78rem;color:var(--color-muted);margin:.5rem 0 0">Parallax: best med stående (portrett) bilete. Forhåndsvisinga brukar 9:16-format ved parallax.</p>' +
        '</fieldset>' +

        '<fieldset class="sb-fieldset"><legend>Bilde og utsnitt</legend>' +
          App.ui.imageField("sb-image", "Bakgrunnsbilde", b.image, aspect) +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:.7rem">' +
            '<div class="field"><label for="sb-overlay-color">Overleggsfarge</label><input type="color" id="sb-overlay-color" value="' + esc(b.overlayColor || "#000000") + '"></div>' +
            '<div class="field"><label for="sb-overlay-opacity">Dekking (0–1)</label><input type="number" id="sb-overlay-opacity" min="0" max="1" step="0.05" value="' + esc(String(b.overlayOpacity !== undefined ? b.overlayOpacity : 0)) + '"></div>' +
          '</div>' +
        '</fieldset>' +

        '<fieldset class="sb-fieldset"><legend>Høgde</legend>' +
          '<div class="field"><select id="sb-height">' +
            ['lav:Lav (260px)', 'medium:Medium (420px)', 'høg:Høg (580px)', 'fullskjerm:Fullskjerm (100vh)'].map(function (h) {
              var p = h.split(":"); return '<option value="' + esc(p[0]) + '"' + (p[0] === (b.height || "medium") ? " selected" : "") + '>' + esc(p[1]) + '</option>';
            }).join("") +
          '</select></div>' +
        '</fieldset>' +

        '<fieldset class="sb-fieldset"><legend>Tekst (valgfritt)</legend>' +
          C.field({ id:"sb-title", label:"Tittel",    value: b.title || "" }) +
          C.field({ id:"sb-text",  label:"Brødtekst", value: b.text  || "", multiline:true, rows:2 }) +
          '<div class="field"><label for="sb-text-color">Tekstfarge</label><input type="color" id="sb-text-color" value="' + esc(b.textColor || "#ffffff") + '"></div>' +
        '</fieldset>' +

        '<fieldset class="sb-fieldset"><legend>CTA-knapp (valgfritt)</legend>' +
          C.field({ id:"sb-cta-label", label:"Knapptekst", value: b.ctaLabel || "" }) +
          C.field({ id:"sb-cta-url",   label:"Lenke",      value: b.ctaUrl   || "" }) +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">' +
            '<div class="field"><label for="sb-cta-bg">Knappfarge</label><input type="color" id="sb-cta-bg" value="' + esc(b.ctaBg || "#15616D") + '"></div>' +
            '<div class="field"><label for="sb-cta-color">Tekstfarge</label><input type="color" id="sb-cta-color" value="' + esc(b.ctaColor || "#ffffff") + '"></div>' +
          '</div>' +
        '</fieldset>' +

        '<div style="display:flex;gap:.6rem">' +
          C.button({ label:"Lagre", variant:"primary", attrs:"data-sb-save" }) +
          C.button({ label:"Avbryt", variant:"ghost",  attrs:"data-sb-cancel" }) +
        '</div>' +
        '<p class="form__status" id="sb-status"></p>' +
      '</div>';

    App.ui.bindImageFields(ed);

    /* Modus-veksling — oppdater forhåndsvisnings-aspect-ratio */
    ed.querySelectorAll('[name="sb-mode"]').forEach(function (radio) {
      radio.addEventListener("change", function () {
        var newAspect = radio.value === "parallax" ? (9/16) : (16/9);
        /* Oppdater data-aspect på preview-elementet og trigger re-layout */
        var preview = ed.querySelector(".imgfield__preview");
        if (preview) {
          preview.setAttribute("data-aspect", newAspect);
          /* Trigge re-render ved å kalle layout på nytt (imageField har allereie init) */
          var img = preview.querySelector("img");
          if (img && img.naturalWidth) {
            var newWW, newWH;
            var imgAsp = img.naturalWidth / img.naturalHeight;
            if (imgAsp > newAspect) { newWH = 100; newWW = (newAspect / imgAsp) * 100; }
            else { newWW = 100; newWH = (imgAsp / newAspect) * 100; }
            var win = preview.querySelector("[data-crop-window]");
            if (win) { win.style.width = newWW + "%"; win.style.height = newWH + "%"; }
            preview.style.aspectRatio = String(imgAsp);
            preview.style.width = "min(100%, " + Math.round(340 * imgAsp) + "px)";
          }
        }
      });
    });

    ed.querySelector("[data-sb-cancel]").addEventListener("click", function () { ed.innerHTML = ""; });

    ed.querySelector("[data-sb-save]").addEventListener("click", function () {
      var label = ed.querySelector("#sb-label").value.trim();
      var st    = ed.querySelector("#sb-status");
      if (!label) { st.textContent = "Namn er påkrevd."; st.className = "form__status is-err"; return; }

      var modeEl = ed.querySelector('[name="sb-mode"]:checked');
      var obj = {
        id:             b.id || newId(),
        label:          label,
        order:          parseInt(ed.querySelector("#sb-order").value, 10) || nextOrder,
        mode:           modeEl ? modeEl.value : "static",
        image:          App.ui.readImageField(ed, "sb-image"),
        overlayColor:   ed.querySelector("#sb-overlay-color").value,
        overlayOpacity: parseFloat(ed.querySelector("#sb-overlay-opacity").value) || 0,
        textColor:      ed.querySelector("#sb-text-color").value,
        height:         ed.querySelector("#sb-height").value,
        ctaLabel:       ed.querySelector("#sb-cta-label").value.trim(),
        ctaUrl:         ed.querySelector("#sb-cta-url").value.trim(),
        ctaBg:          ed.querySelector("#sb-cta-bg").value,
        ctaColor:       ed.querySelector("#sb-cta-color").value,
        title:          ed.querySelector("#sb-title").value.trim(),
        text:           ed.querySelector("#sb-text").value.trim()
      };

      var list = getBanners();
      if (b.id) {
        var idx = list.findIndex(function (x) { return x.id === b.id; });
        if (idx >= 0) list[idx] = obj; else list.push(obj);
        delete registered[b.id];
      } else {
        list.push(obj);
      }
      setBanners(list);
      syncModules();
      ed.innerHTML = "";
      renderAdminRoot(root);
    });
  }

  function modeCard(value, title, desc, checked) {
    return '<label style="display:flex;align-items:flex-start;gap:.5rem;cursor:pointer;padding:.65rem .8rem;' +
      'border:1.5px solid ' + (checked ? "var(--color-primary)" : "var(--color-border)") + ';border-radius:9px">' +
      '<input type="radio" name="sb-mode" value="' + esc(value) + '"' + (checked ? " checked" : "") + ' style="margin-top:.15rem">' +
      '<div><strong style="font-size:.88rem;display:block">' + esc(title) + '</strong>' +
        '<span style="font-size:.76rem;color:var(--color-muted)">' + esc(desc) + '</span>' +
      '</div>' +
    '</label>';
  }

  /* =========================================================================
     OPPSTART
     ====================================================================== */
  injectStyles();
  syncModules();

  App.registerModule({
    id:        "scrollbanner-admin",
    label:     "",
    order:     9999,
    adminOnly: true,
    render:    function () { return ""; },
    admin: {
      label:    "Scrollbanner",
      category: "innhold",
      render:   function () { return '<div data-sb-admin-root></div>'; },
      mount:    function (body) {
        renderAdminRoot(body.querySelector("[data-sb-admin-root]") || body);
      }
    }
  });

})();
