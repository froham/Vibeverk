/* =============================================================================
   module-scrollbanner.js  —  SCROLLBANNER (offentleg side)
   -----------------------------------------------------------------------------
   To modus per banner:

   1) STATISK — vanlegt fullbredde bilde, fast posisjon. Same som alle andre
      bildeseksjonar. Brukast for liggande (landscape) bilete.

   2) PARALLAX-SCROLL — seksjonen har fast høgde (t.d. 420px) mens bakgrunns-
      bildet er mykje høgare (t.d. eit 9:16 portrett). Bildet beveger seg
      saktare enn sida, slik at brukaren "scrollar gjennom" bildet vertikalt
      og ser nye delar etter kvart. Effekten er reinast med stående bilete.

   Kvar banner er ein eigen registrert modul — dukkar IKKJE opp i toppmeny
   (label er tom / navHidden:true), men visast som eigen rad i navigasjonsfanen
   slik at admin kan plassere banneret fritt mellom andre seksjonar.

   Lagring:  App.store("scrollbanners")
   Admin:    Innhold → Scrollbanner (CRUD)
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
      ".sb-section{position:relative;width:100%;overflow:hidden;display:flex;align-items:center;justify-content:center}",

      /* Statisk bakgrunn */
      ".sb-section--static .sb-bg{position:absolute;inset:0;background-size:cover;background-repeat:no-repeat}",

      /* Parallax: fixed bakgrunn — bildet står stille medan seksjonen scrollar over */
      ".sb-section--parallax{overflow:visible !important;isolation:auto !important}",
      ".sb-section--parallax .sb-bg{",
      "  position:fixed !important;",
      "  top:0;left:0;right:0;bottom:0;",
      "  background-size:cover;",
      "  background-repeat:no-repeat;",
      "  z-index:-1;",
      "}",
      /* Seksjon-innhald og overlegg ligg over det faste bakgrunnsbildet */
      ".sb-section--parallax .sb-overlay{position:absolute;inset:0;z-index:0}",
      ".sb-section--parallax .sb-content{position:relative;z-index:1}",

      /* Overlegg og innhald */
      ".sb-overlay{position:absolute;inset:0;pointer-events:none}",
      ".sb-content{position:relative;z-index:1;text-align:center;padding:3rem var(--gap,1.5rem);max-width:860px;width:100%}",
      ".sb-title{font-family:var(--font-display);font-size:clamp(1.5rem,4vw,2.8rem);font-weight:700;line-height:1.12;margin:0 0 .75rem;text-shadow:0 2px 12px rgba(0,0,0,.2)}",
      ".sb-text{font-size:clamp(.92rem,2vw,1.1rem);line-height:1.7;margin:0 0 1.5rem;max-width:620px;display:block;margin-left:auto;margin-right:auto;text-shadow:0 1px 6px rgba(0,0,0,.15)}",
      ".sb-cta{display:inline-flex;align-items:center;gap:.5rem;font-weight:700;padding:.78rem 1.75rem;border-radius:999px;font-size:.95rem;text-decoration:none;transition:opacity .2s,transform .15s,box-shadow .2s;box-shadow:0 4px 18px rgba(0,0,0,.18)}",
      ".sb-cta:hover{opacity:.9;transform:translateY(-2px)}",

      /* Admin */
      ".sb-adm-row{display:flex;align-items:center;gap:.65rem;padding:.7rem .9rem;background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;margin-bottom:.45rem}",
      ".sb-adm-thumb{width:44px;height:36px;border-radius:6px;background:var(--color-alt);flex-shrink:0;background-size:cover;background-position:50% 50%}",
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
     PARALLAX JS
     Oppdaterer transform på .sb-bg-element basert på scroll-posisjon.
     Brukar transform (ikkje background-position) for GPU-akselerasjon.
     ====================================================================== */
  var parallaxInited = false;

  function initParallax() {
    if (parallaxInited) return;
    parallaxInited = true;

    // position:fixed-bakgrunn treng at vi synkroniserer background-position
    // med kva del av skjermen seksjonen okkuperer.
    // Bildet er allereie fixed — vi treng berre å sørgje for at
    // background-position matchar posX/posY-valet.
    //
    // For å avsløre riktig del av eit stående bilde:
    // Vi justerer background-position-y basert på scroll-progress.
    function update() {
      document.querySelectorAll(".sb-section--parallax .sb-bg").forEach(function (bg) {
        var section = bg.closest(".sb-section");
        if (!section) return;
        var rect     = section.getBoundingClientRect();
        var winH     = window.innerHeight;
        var secH     = section.offsetHeight;

        // Kor mykje av seksjonen er passert? 0=topp av seksjon ved botn av skjerm, 1=ferdig
        var progress = 1 - (rect.bottom / (winH + secH));
        progress = Math.max(0, Math.min(1, progress));

        // Flytt background-position-y for å avdekke bildet frå topp til botn
        var posY = (progress * 100).toFixed(1) + "%";
        bg.style.backgroundPositionY = posY;
      });
    }

    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  }

  /* =========================================================================
     RENDER EIN BANNER
     ====================================================================== */
  function renderBanner(b) {
    if (!b) return "";

    var imgSrc   = b.imageSrc || (b.image && (typeof b.image === "string" ? b.image : (b.image.src || "")));
    var hasBg    = !!(imgSrc);
    var posX     = b.posX || "center";
    var posY     = b.posY || "center";
    var isParallax = hasBg && b.mode === "parallax";
    var height   = { lav:"260px", medium:"420px", høg:"580px", fullskjerm:"100vh" }[b.height] || "420px";
    var textColor = b.textColor || (hasBg ? "#ffffff" : "var(--color-text)");

    var sectionCls = "sb-section section reveal " + (isParallax ? "sb-section--parallax" : "sb-section--static");

    var bgStyle = hasBg
      ? "background-image:url(" + esc(imgSrc) + ");background-position:" + esc(posX) + " " + esc(posY) + ";"
      : "background:var(--color-alt);";
    // Parallax: ingen overflow:hidden — fixed bakgrunn scrollar gjennom
    var sectionExtra = "";

    var overlayHtml = "";
    if (b.overlayColor && parseFloat(b.overlayOpacity || "0") > 0) {
      overlayHtml = '<div class="sb-overlay" style="background:' + esc(b.overlayColor) + ';opacity:' + parseFloat(b.overlayOpacity) + '"></div>';
    }

    var contentHtml = "";
    if (b.title || b.text || (b.ctaLabel && b.ctaUrl)) {
      contentHtml =
        '<div class="sb-content">' +
          (b.title ? '<h2 class="sb-title" style="color:' + esc(textColor) + '">' + esc(b.title) + '</h2>' : "") +
          (b.text  ? '<span class="sb-text" style="color:' + esc(textColor) + '">' + esc(b.text) + '</span>' : "") +
          (b.ctaLabel && b.ctaUrl
            ? '<a href="' + esc(b.ctaUrl) + '" class="sb-cta" style="background:' + esc(b.ctaBg || "var(--color-primary)") + ';color:' + esc(b.ctaColor || "#fff") + '">' + esc(b.ctaLabel) + '</a>'
            : "") +
        '</div>';
    }

    return '<section class="' + sectionCls + '" id="' + esc(b.id) + '" style="min-height:' + height + ';' + sectionExtra + '">' +
      '<div class="sb-bg" style="' + bgStyle + '"></div>' +
      overlayHtml +
      contentHtml +
    '</section>';
  }

  function mountBanner(el, b) {
    if (b && b.mode === "parallax") initParallax();
  }

  /* =========================================================================
     DYNAMISK REGISTRERING — kvar banner = eigen modul, IKKJE i toppmeny
     ====================================================================== */
  var registered = {};

  function syncModules() {
    getBanners().forEach(function (b) {
      if (registered[b.id]) {
        // Oppdater label/order på eksisterande modul
        var existing = App._modules && App._modules.find(function (m) { return m.id === b.id; });
        if (existing) { existing.label = b.label || "Scrollbanner"; existing.order = b.order || 25; }
        return;
      }
      registered[b.id] = true;
      var bid = b.id;
      App.registerModule({
        id:         b.id,
        label:      b.label || "Scrollbanner",
        order:      typeof b.order === "number" ? b.order : 25,
        navHidden:  true,   // Vises IKKJE i toppmeny, berre i Navigasjon-fanen
        render:     function () {
          var cur = getBanners().find(function (x) { return x.id === bid; });
          return cur ? renderBanner(cur) : "";
        },
        mount:      function (el) {
          var cur = getBanners().find(function (x) { return x.id === bid; });
          if (cur) mountBanner(el, cur);
        }
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
              var imgSrc2 = b.imageSrc || (b.image && (typeof b.image === "string" ? b.image : (b.image.src || "")));
              var hasBg   = !!(imgSrc2);
              var thumbStyle = hasBg ? "background-image:url(" + esc(imgSrc2) + ")" : "";
              return '<div class="sb-adm-row">' +
                '<div class="sb-adm-thumb" style="' + thumbStyle + '"></div>' +
                '<div class="sb-adm-info">' +
                  '<div class="sb-adm-title">' + esc(b.label || "(Utan namn)") + '</div>' +
                  '<div class="sb-adm-meta">' + esc(b.height || "medium") + " · " + esc(b.mode === "parallax" ? "parallax-scroll" : "statisk") + (hasBg ? " · bilde" : "") + " · order " + (b.order || 25) + '</div>' +
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
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">' +
            '<label style="display:flex;align-items:flex-start;gap:.5rem;cursor:pointer;padding:.6rem;border:1.5px solid ' + (b.mode !== "parallax" ? "var(--color-primary)" : "var(--color-border)") + ';border-radius:8px">' +
              '<input type="radio" name="sb-mode" value="static" ' + (b.mode !== "parallax" ? "checked" : "") + ' style="margin-top:.15rem">' +
              '<div><strong style="font-size:.88rem">Statisk</strong><br><span style="font-size:.76rem;color:var(--color-muted)">Fast bilde, liggande format</span></div>' +
            '</label>' +
            '<label style="display:flex;align-items:flex-start;gap:.5rem;cursor:pointer;padding:.6rem;border:1.5px solid ' + (b.mode === "parallax" ? "var(--color-primary)" : "var(--color-border)") + ';border-radius:8px">' +
              '<input type="radio" name="sb-mode" value="parallax" ' + (b.mode === "parallax" ? "checked" : "") + ' style="margin-top:.15rem">' +
              '<div><strong style="font-size:.88rem">Parallax-scroll</strong><br><span style="font-size:.76rem;color:var(--color-muted)">Scroll gjennom stående bilde (9:16)</span></div>' +
            '</label>' +
          '</div>' +
        '</fieldset>' +

        '<fieldset class="sb-fieldset"><legend>Bilde og høgde</legend>' +
          /* Eige bileteopplasting utan fast utsnitt */
          '<div class="field">' +
            '<label>Bakgrunnsbilde</label>' +
            '<div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-start">' +
              '<label class="btn btn--ghost btn--sm" style="cursor:pointer">' +
                '<i class="ti ti-upload"></i> Last opp' +
                '<input type="file" id="sb-img-file" accept="image/*" style="display:none">' +
              '</label>' +
              '<input id="sb-img-url" type="url" placeholder="…eller lim inn bilde-URL" ' +
                'style="flex:1;min-width:160px;font:inherit;font-size:.85rem;padding:.45rem .7rem;border:1.5px solid var(--color-border);border-radius:7px;background:var(--color-bg);color:var(--color-text)" ' +
                'value="' + esc(b.imageSrc || "") + '">' +
              (b.imageSrc
                ? '<button type="button" id="sb-img-clear" class="btn btn--ghost btn--sm"><i class="ti ti-trash"></i></button>'
                : '') +
            '</div>' +
            (b.imageSrc
              ? '<div style="margin-top:.5rem;border-radius:8px;overflow:hidden;max-width:280px;max-height:200px">' +
                '<img id="sb-img-preview" src="' + esc(b.imageSrc) + '" style="width:100%;height:auto;display:block" alt="">' +
              '</div>'
              : '<div id="sb-img-preview-wrap"></div>') +
            '<input type="hidden" id="sb-img-hidden" value="' + esc(b.imageSrc || "") + '">' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:.6rem">' +
            '<div class="field"><label for="sb-pos-x">Horisontal posisjon</label>' +
              '<select id="sb-pos-x">' +
                ['left:Venstre', 'center:Midten', 'right:Høgre'].map(function(o){ var p=o.split(":"); return "<option value=\""+esc(p[0])+"\""+((b.posX||"center")===p[0]?" selected":"")+">"+esc(p[1])+"</option>"; }).join("") +
              '</select></div>' +
            '<div class="field"><label for="sb-pos-y">Vertikal posisjon (start)</label>' +
              '<select id="sb-pos-y">' +
                ['top:Topp', 'center:Midten', 'bottom:Botn'].map(function(o){ var p=o.split(":"); return "<option value=\""+esc(p[0])+"\""+((b.posY||"center")===p[0]?" selected":"")+">"+esc(p[1])+"</option>"; }).join("") +
              '</select></div>' +
          '</div>' +
          '<div class="field" style="margin-top:.7rem"><label for="sb-height">Høgde på seksjonen</label>' +
            '<select id="sb-height">' +
              ['lav:Lav (260px)', 'medium:Medium (420px)', 'høg:Høg (580px)', 'fullskjerm:Fullskjerm (100vh)'].map(function (h) {
                var p = h.split(":"); return '<option value="' + esc(p[0]) + '"' + (p[0] === (b.height || "medium") ? " selected" : "") + '>' + esc(p[1]) + '</option>';
              }).join("") +
            '</select>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:.6rem">' +
            '<div class="field"><label for="sb-overlay-color">Overleggsfarge</label><input type="color" id="sb-overlay-color" value="' + esc(b.overlayColor || "#000000") + '"></div>' +
            '<div class="field"><label for="sb-overlay-opacity">Dekking (0–1)</label><input type="number" id="sb-overlay-opacity" min="0" max="1" step="0.05" value="' + esc(String(b.overlayOpacity !== undefined ? b.overlayOpacity : 0)) + '"></div>' +
          '</div>' +
        '</fieldset>' +

        '<fieldset class="sb-fieldset"><legend>Tekst (valgfritt)</legend>' +
          C.field({ id:"sb-title", label:"Tittel",     value: b.title || "" }) +
          C.field({ id:"sb-text",  label:"Brødtekst",  value: b.text  || "", multiline:true, rows:2 }) +
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

    // Eigen bilete-binding (ikkje standard imageField)
    (function () {
      var fileInp   = ed.querySelector("#sb-img-file");
      var urlInp    = ed.querySelector("#sb-img-url");
      var hidden    = ed.querySelector("#sb-img-hidden");
      var prevWrap  = ed.querySelector("#sb-img-preview-wrap") || ed.querySelector("#sb-img-preview");
      var clearBtn  = ed.querySelector("#sb-img-clear");

      function setPreview(src) {
        if (!hidden) return;
        hidden.value = src || "";
        if (urlInp) urlInp.value = src || "";
        // Oppdater preview
        var existing = ed.querySelector("#sb-img-preview");
        if (src) {
          if (existing) {
            existing.src = src;
          } else if (prevWrap) {
            prevWrap.innerHTML = '<img id="sb-img-preview" src="' + src + '" style="width:100%;height:auto;display:block;border-radius:8px;max-width:280px;margin-top:.5rem" alt="">';
          }
        } else {
          if (existing) existing.remove();
        }
      }

      if (fileInp) {
        fileInp.addEventListener("change", function () {
          var file = fileInp.files && fileInp.files[0];
          if (!file) return;
          App.media.put(file).then(function (ref) {
            var src = App.media.resolve(ref);
            setPreview(src);
          }).catch(function () {});
          fileInp.value = "";
        });
      }
      if (urlInp) {
        urlInp.addEventListener("change", function () { setPreview(urlInp.value.trim()); });
        urlInp.addEventListener("blur",   function () { setPreview(urlInp.value.trim()); });
      }
      if (clearBtn) {
        clearBtn.addEventListener("click", function () { setPreview(""); });
      }
    })();

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
        title:          ed.querySelector("#sb-title").value.trim(),
        text:           ed.querySelector("#sb-text").value.trim(),
        imageSrc:       ed.querySelector("#sb-img-hidden") ? ed.querySelector("#sb-img-hidden").value.trim() : (b.imageSrc || ""),
        posX:           ed.querySelector("#sb-pos-x") ? ed.querySelector("#sb-pos-x").value : "center",
        posY:           ed.querySelector("#sb-pos-y") ? ed.querySelector("#sb-pos-y").value : "center",
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

  /* =========================================================================
     NAVIGASJONSFANE: skjul scrollbanner frå toppmeny
     ====================================================================== */
  // Monkey-patch buildShell/nav til å respektere navHidden på moduler
  // Dette skjer ved å overstyre modNavVisible i core.js sin scope er ikkje mogleg,
  // men core.js brukar `mod.label` for å avgjere om ein modul kjem i nav.
  // Vi set label til "" for scrollbanner-modulane ved oppstart.
  // (label er sett av syncModules, men navHidden er flagget vi brukar)

  /* =========================================================================
     OPPSTART
     ====================================================================== */
  injectStyles();
  syncModules();

  /* Admin-inngangspunkt */
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
