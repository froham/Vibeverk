/* =============================================================================
   module-carousel.js  —  BILDE/FILM-KARUSELL (offentleg side)
   -----------------------------------------------------------------------------
   Sjølvstendig syskenmodul til module-scrollbanner.js — same registrerings-
   /lagrings-/admin-mønster (eiga Store-nøkkel, eiga admin-kategori "innhold",
   éin App.registerModule() per lagra karusell), MEN med heilt ny rulle-
   mekanikk scrollbanner ikkje har noko tilsvarande av (scrollbanner er ei
   uavhengig, statisk enkelt-bilete-seksjon per banner — ikkje ein roterande
   karusell). Sjå docs/project/CHANGELOG.md for grunngjeving/avklaringar.

   Kvar karusell har fleire "slides" (bilde ELLER video), og eitt av to
   framdrifts-modus:
     - auto:   rullerer sjølv kvart N. sekund (pausar ved hover/fokus/skjult
               fane, respekterer prefers-reduced-motion)
     - manual: berre piler/prikkar/sveip, ingen automatisk framdrift

   Bilde-slides gjenbrukar App.ui.imageField/bindImageFields/readImageField
   ordrett (inkl. GIF, via den eksisterande media-bucketen). Video-slides
   brukar ein ny, enklare widget (ingen fokuspunkt-beskjering) og lastar opp
   til den DEDIKERTE media-video-bucketen via App.media.putVideo() — sjå
   supabase/migrations/20260719224831_carousel_video_bucket.sql for kvifor
   dette er ein eigen bucket, ikkje ei utviding av den delte media-bucketen.

   Feature-flag: gjenbrukar features.sidebygger (same "MÅ vere eksplisitt
   TRUE"-flagg som Design-modulen sjølv, sjå config.js) — karusellen ligg
   under Design-modulen, ikkje bak sin eigen separate brytar. Same gate
   gjeld no også module-scrollbanner.js (sjå der) — begge vert aktiverte
   samla når kunden har Design-modulen på i Console.
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App;
  var C   = window.Components;
  if (!App || !C) return;

  App.ready(function (CFG) {
  if (!(CFG.features && CFG.features.sidebygger === true)) return;

  var esc       = C.esc;
  var STORE_KEY = "carousels";

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getCarousels() { return App.store.get(STORE_KEY, []) || []; }
  function setCarousels(v) { App.store.set(STORE_KEY, v); }
  function newId()      { return "crsl-" + Date.now() + "-" + Math.random().toString(36).slice(2,6); }
  function newSlideId() { return "crslsl-" + Date.now() + "-" + Math.random().toString(36).slice(2,6); }

  var HEIGHT_PX = { lav:"260px", medium:"420px", høg:"580px", fullskjerm:"100vh" };

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("carousel-styles")) return;
    var s = document.createElement("style");
    s.id  = "carousel-styles";
    s.textContent = [
      ".crsl-section{position:relative;width:100%;overflow:hidden}",
      ".crsl-viewport{position:relative;width:100%;height:100%}",
      ".crsl-slide{position:absolute;inset:0;opacity:0;transition:opacity .6s ease;pointer-events:none;display:flex;align-items:center;justify-content:center}",
      ".crsl-slide.is-active{opacity:1;pointer-events:auto}",
      "@media (prefers-reduced-motion: reduce){.crsl-slide{transition:none}}",
      ".crsl-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 50%;background:var(--color-alt)}",
      ".crsl-overlay{position:absolute;inset:0;pointer-events:none}",
      ".crsl-content{position:relative;z-index:1;text-align:center;padding:3rem var(--gap,1.5rem);max-width:860px;width:100%}",
      ".crsl-title{font-family:var(--font-display);font-size:clamp(1.5rem,4vw,2.8rem);font-weight:700;line-height:1.12;margin:0 0 .75rem;text-shadow:0 2px 12px rgba(0,0,0,.2)}",
      ".crsl-text{font-size:clamp(.92rem,2vw,1.1rem);line-height:1.7;margin:0 0 1.5rem;max-width:620px;display:block;margin-left:auto;margin-right:auto;text-shadow:0 1px 6px rgba(0,0,0,.15)}",
      ".crsl-cta{display:inline-flex;align-items:center;gap:.5rem;font-weight:700;padding:.78rem 1.75rem;border-radius:999px;font-size:.95rem;text-decoration:none;transition:opacity .2s,transform .15s,box-shadow .2s;box-shadow:0 4px 18px rgba(0,0,0,.18)}",
      ".crsl-cta:hover{opacity:.9;transform:translateY(-2px)}",
      /* Piler/prikkar — usynleg utvida treffflate (same mønster som CRM-tidslinja sine ikonknappar) for ≥44px touch-mål utan å auke den synlege ikonstorleiken */
      ".crsl-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:2;width:44px;height:44px;border:0;border-radius:999px;background:rgba(0,0,0,.35);color:#fff;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s}",
      ".crsl-arrow:hover{background:rgba(0,0,0,.55)}",
      ".crsl-arrow--prev{left:.8rem}",
      ".crsl-arrow--next{right:.8rem}",
      ".crsl-dots{position:absolute;bottom:1rem;left:0;right:0;z-index:2;display:flex;justify-content:center;gap:.5rem}",
      ".crsl-dot{position:relative;width:10px;height:10px;border-radius:999px;border:0;background:rgba(255,255,255,.5);cursor:pointer;padding:0}",
      ".crsl-dot::before{content:'';position:absolute;inset:-12px}", /* usynleg utvida treffflate */
      ".crsl-dot.is-active{background:#fff}",

      /* Admin */
      ".crsl-adm-row{display:flex;align-items:center;gap:.65rem;padding:.7rem .9rem;background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;margin-bottom:.45rem}",
      ".crsl-adm-thumb{width:52px;height:36px;border-radius:6px;background:var(--color-alt);flex-shrink:0;background-size:cover;background-position:50% 50%}",
      ".crsl-adm-info{flex:1;min-width:0}",
      ".crsl-adm-title{font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".crsl-adm-meta{font-size:.75rem;color:var(--color-muted);margin-top:.1rem}",
      ".crsl-adm-btns{display:flex;gap:.3rem;flex-shrink:0}",
      ".crsl-fieldset{border:1px solid var(--color-border);border-radius:10px;padding:.85rem;margin-bottom:.6rem}",
      ".crsl-fieldset legend{font-weight:600;font-size:.82rem;padding:0 .35rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:.07em}",
      ".crsl-slide-row{border:1px solid var(--color-border);border-radius:9px;padding:.7rem;margin-bottom:.6rem;background:var(--color-surface)}",
      ".crsl-slide-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem}",
      ".crsl-draghandle{cursor:grab;color:var(--color-muted)}",
      ".crsl-video-preview{width:100%;max-height:180px;border-radius:8px;background:#000}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     RENDER EIN KARUSELL (offentleg)
     ====================================================================== */
  function renderSlide(sl, i) {
    var overlayHtml = (sl.overlayColor && parseFloat(sl.overlayOpacity || "0") > 0)
      ? '<div class="crsl-overlay" style="background:' + esc(sl.overlayColor) + ';opacity:' + parseFloat(sl.overlayOpacity) + '"></div>'
      : "";
    var textColorAttr = sl._textColor ? 'style="color:' + esc(sl._textColor) + '"' : "";
    var contentHtml = (sl.title || sl.text || (sl.ctaLabel && sl.ctaUrl))
      ? '<div class="crsl-content">' +
          (sl.title ? '<h2 class="crsl-title" ' + textColorAttr + '>' + esc(sl.title) + '</h2>' : "") +
          (sl.text  ? '<span class="crsl-text" ' + textColorAttr + '>' + esc(sl.text) + '</span>' : "") +
          (sl.ctaLabel && sl.ctaUrl
            ? '<a href="' + esc(sl.ctaUrl) + '" class="crsl-cta" style="background:' + esc(sl.ctaBg || "var(--color-primary)") + ';color:' + esc(sl.ctaColor || "#fff") + '">' + esc(sl.ctaLabel) + '</a>'
            : "") +
        '</div>'
      : "";

    var mediaHtml;
    if (sl.kind === "video" && sl.video && sl.video.src) {
      var posterAttr = sl.video.poster && App.media.resolveImage(sl.video.poster).src
        ? ' poster="' + esc(App.media.resolveImage(sl.video.poster).src) + '"'
        : "";
      mediaHtml = '<video class="crsl-media" src="' + esc(sl.video.src) + '"' + posterAttr +
        ' muted loop playsinline preload="metadata" aria-label="' + esc(sl.video.alt || "") + '"></video>';
    } else {
      var img = App.media.resolveImage(sl.image);
      mediaHtml = img.src
        ? '<img class="crsl-media" src="' + esc(img.src) + '" style="object-position:' + esc(img.pos || "50% 50%") + '" alt="' + esc(img.alt || "") + '" loading="lazy">'
        : '<div class="crsl-media"></div>';
    }

    return '<div class="crsl-slide' + (i === 0 ? " is-active" : "") + '" data-crsl-slide="' + esc(sl.id) + '">' +
      mediaHtml + overlayHtml + contentHtml +
    '</div>';
  }

  function renderCarousel(c) {
    if (!c) return "";
    var height = HEIGHT_PX[c.height] || "420px";
    var slides = c.slides || [];
    // textColor er delt for heile karusellen (v1-forenkling, sjå plan) —
    // dett inn på kvar slide sitt renderingssteg via ein midlertidig felt
    // (_textColor), ikkje lagra i sjølve slide-objektet.
    slides.forEach(function (sl) { sl._textColor = c.textColor || "#ffffff"; });

    var slidesHtml = slides.map(renderSlide).join("");
    var arrowsHtml = (c.advance && c.advance.mode === "manual" && slides.length > 1)
      ? '<button type="button" class="crsl-arrow crsl-arrow--prev" data-crsl-prev aria-label="Førre">' + C.icon("chevron-left") + '</button>' +
        '<button type="button" class="crsl-arrow crsl-arrow--next" data-crsl-next aria-label="Neste">' + C.icon("chevron-right") + '</button>'
      : "";
    var dotsHtml = (slides.length > 1)
      ? '<div class="crsl-dots">' + slides.map(function (sl, i) {
          return '<button type="button" class="crsl-dot' + (i === 0 ? " is-active" : "") + '" data-crsl-dot="' + i + '" aria-label="Gå til bilde ' + (i+1) + '"></button>';
        }).join("") + '</div>'
      : "";

    return '<section class="crsl-section section reveal" id="' + esc(c.id) + '" style="min-height:' + height + '" ' +
      'data-crsl-mode="' + esc((c.advance && c.advance.mode) || "auto") + '" ' +
      'data-crsl-interval="' + esc(String((c.advance && c.advance.intervalSec) || 5)) + '">' +
      '<div class="crsl-viewport" data-crsl-viewport tabindex="0">' + slidesHtml + '</div>' +
      arrowsHtml + dotsHtml +
    '</section>';
  }

  /* =========================================================================
     KLIENT-ÅTFERD (rullering/piler/sveip) — kalla frå mount()
     ====================================================================== */
  var timers = {}; // carousel-id -> setInterval-handle, ryddar opp ved re-mount

  function mountCarousel(main, c) {
    var section = main.querySelector("#" + (window.CSS && window.CSS.escape ? window.CSS.escape(c.id) : c.id));
    if (!section) return;
    var viewport = section.querySelector("[data-crsl-viewport]");
    var slideEls = Array.prototype.slice.call(section.querySelectorAll("[data-crsl-slide]"));
    if (!viewport || slideEls.length < 2) {
      // Éin (eller null) slide — ingenting å rullere, men behald video-autoplay under.
      startVisibleVideos(section);
      return;
    }

    var mode = section.getAttribute("data-crsl-mode") || "auto";
    var intervalSec = parseFloat(section.getAttribute("data-crsl-interval")) || 5;
    var dots = Array.prototype.slice.call(section.querySelectorAll("[data-crsl-dot]"));
    var cur = 0;

    function show(i) {
      cur = ((i % slideEls.length) + slideEls.length) % slideEls.length;
      slideEls.forEach(function (el, idx) { el.classList.toggle("is-active", idx === cur); });
      dots.forEach(function (d, idx) { d.classList.toggle("is-active", idx === cur); });
      startVisibleVideos(section);
    }

    // Rydd opp ein evt. tidlegare timer for AKKURAT denne karusellen (unngår
    // dupliserte tellarar viss heile sida sin render()/mount() køyrer på
    // nytt — same feilklasse som chat-admin-panelet sin kjende poll-lekkasje).
    if (timers[c.id]) { clearInterval(timers[c.id]); delete timers[c.id]; }

    var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function startTimer() {
      if (mode !== "auto" || reducedMotion) return;
      if (timers[c.id]) return;
      timers[c.id] = setInterval(function () {
        if (document.visibilityState !== "visible") return;
        show(cur + 1);
      }, intervalSec * 1000);
    }
    function stopTimer() {
      if (timers[c.id]) { clearInterval(timers[c.id]); delete timers[c.id]; }
    }

    startTimer();
    section.addEventListener("mouseenter", stopTimer);
    section.addEventListener("mouseleave", startTimer);
    section.addEventListener("focusin", stopTimer);
    section.addEventListener("focusout", startTimer);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") stopTimer(); else startTimer();
    });

    // Piler (berre til stades i manual-modus, sjå renderCarousel)
    var prevBtn = section.querySelector("[data-crsl-prev]");
    var nextBtn = section.querySelector("[data-crsl-next]");
    if (prevBtn) prevBtn.addEventListener("click", function () { show(cur - 1); });
    if (nextBtn) nextBtn.addEventListener("click", function () { show(cur + 1); });

    // Prikkar (klikkbare i begge modus)
    dots.forEach(function (d, i) { d.addEventListener("click", function () { show(i); }); });

    // Tastatur (berre når karusellen har fokus)
    viewport.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { show(cur - 1); }
      else if (e.key === "ArrowRight") { show(cur + 1); }
    });

    // Sveip (peikar-hendingar, same stil som core.js sin bindImageFields()
    // sin eigen dra-logikk brukar — ny bruk av eit kjent mønster, ikkje ein
    // ny interaksjonsstil for kodebasen).
    var dragStartX = null;
    viewport.addEventListener("pointerdown", function (e) { dragStartX = e.clientX; });
    viewport.addEventListener("pointerup", function (e) {
      if (dragStartX === null) return;
      var dx = e.clientX - dragStartX;
      dragStartX = null;
      var THRESHOLD = 40;
      if (dx > THRESHOLD) show(cur - 1);
      else if (dx < -THRESHOLD) show(cur + 1);
    });

    show(0);
  }

  // Video-slides autoavspelar berre når dei er den aktive slide-en (unngår
  // fleire samtidige videoar som spelar av usynleg i bakgrunnen).
  function startVisibleVideos(section) {
    section.querySelectorAll("video.crsl-media").forEach(function (v) {
      var isActive = v.closest(".crsl-slide") && v.closest(".crsl-slide").classList.contains("is-active");
      if (isActive) { v.play().catch(function () {}); }
      else { v.pause(); }
    });
  }

  /* =========================================================================
     DYNAMISK REGISTRERING
     ====================================================================== */
  var registered = {};

  function syncModules() {
    getCarousels().forEach(function (c) {
      if (registered[c.id]) return;
      registered[c.id] = true;
      var cid = c.id;
      App.registerModule({
        id:        c.id,
        label:     c.label || "Karusell",
        order:     typeof c.order === "number" ? c.order : 25,
        navHidden: true,
        render:    function () {
          var cur = getCarousels().find(function (x) { return x.id === cid; });
          return cur ? renderCarousel(cur) : "";
        },
        mount:     function (main) {
          var cur = getCarousels().find(function (x) { return x.id === cid; });
          if (cur) mountCarousel(main, cur);
        }
      });
    });
  }

  /* =========================================================================
     ADMIN — CRUD
     ====================================================================== */
  function renderAdminRoot(root) {
    var carousels = getCarousels();
    root.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:.8rem;margin-bottom:.8rem">' +
        '<div>' +
          '<h4 style="margin:0">Bilde/film-karusellar</h4>' +
          '<p class="prose prose--muted" style="margin:.2rem 0 0;font-size:.82rem">Hver karusell kan plasseres fritt i Navigasjon-fanen. Vises ikke i toppmenyen.</p>' +
        '</div>' +
        C.button({ label:"Ny karusell", icon:"plus", variant:"primary", attrs:"data-crsl-new" }) +
      '</div>' +
      '<div id="crsl-list">' +
        (carousels.length
          ? carousels.map(function (c) {
              var first = (c.slides && c.slides[0]) || null;
              var thumbSrc = first ? (first.kind === "video" ? "" : App.media.resolveImage(first.image).src) : "";
              return '<div class="crsl-adm-row">' +
                '<div class="crsl-adm-thumb" style="' + (thumbSrc ? "background-image:url(" + esc(thumbSrc) + ")" : "") + '"></div>' +
                '<div class="crsl-adm-info">' +
                  '<div class="crsl-adm-title">' + esc(c.label || "(Utan namn)") + '</div>' +
                  '<div class="crsl-adm-meta">' + esc(c.height || "medium") + " · " + ((c.advance && c.advance.mode === "manual") ? "manuell" : "auto (" + ((c.advance && c.advance.intervalSec) || 5) + "s)") + " · " + ((c.slides || []).length) + " slide" + ((c.slides || []).length === 1 ? "" : "r") + " · order " + (c.order || 25) + '</div>' +
                '</div>' +
                '<div class="crsl-adm-btns">' +
                  C.button({ label:"Rediger", variant:"ghost", attrs:'data-crsl-edit="' + esc(c.id) + '"' }) +
                  C.button({ label:"Slett",   variant:"ghost", attrs:'data-crsl-del="'  + esc(c.id) + '"' }) +
                '</div>' +
              '</div>';
            }).join("")
          : '<p class="prose prose--muted">Ingen karusellar ennå.</p>'
        ) +
      '</div>' +
      '<div id="crsl-editor"></div>';

    bindAdmin(root);
  }

  function bindAdmin(root) {
    root.querySelector("[data-crsl-new]").addEventListener("click", function () { openEditor(root, null); });
    root.querySelectorAll("[data-crsl-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var c = getCarousels().find(function (x) { return x.id === btn.getAttribute("data-crsl-edit"); });
        if (c) openEditor(root, c);
      });
    });
    root.querySelectorAll("[data-crsl-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-crsl-del");
        var c  = getCarousels().find(function (x) { return x.id === id; });
        if (!c || !confirm('Slett karusellen «' + (c.label || "karusell") + '»? Alle slides, bilde og videoklipp for denne karusellen fjernes for godt. Dette kan ikke angres.')) return;
        (c.slides || []).forEach(freeSlideMedia);
        if (timers[id]) { clearInterval(timers[id]); delete timers[id]; }
        setCarousels(getCarousels().filter(function (x) { return x.id !== id; }));
        delete registered[id];
        renderAdminRoot(root);
      });
    });
  }

  function freeSlideMedia(sl) {
    if (!sl) return;
    if (sl.kind === "video") {
      if (sl.video && sl.video.src) App.media.freeVideo(sl.video.src);
      if (sl.video && sl.video.poster) App.media.free(sl.video.poster);
    } else {
      if (sl.image) App.media.free(sl.image);
    }
  }

  function openEditor(root, carousel) {
    var ed = root.querySelector("#crsl-editor");
    if (!ed) return;
    var c = carousel || {};
    var nextOrder = 25;
    if (!c.id) {
      var orders = getCarousels().map(function (x) { return x.order || 25; });
      nextOrder = orders.length ? Math.max.apply(null, orders) + 5 : 25;
    }
    var advance = c.advance || { mode: "auto", intervalSec: 5 };
    var slides  = (c.slides || []).map(function (sl) { return Object.assign({}, sl); }); // arbeidskopi

    renderEditorShell();

    function renderEditorShell() {
      var aspect = aspectForHeight(c.height || "medium");
      ed.innerHTML =
        '<div class="admin-form admin-form--card" style="margin-top:.9rem">' +
          '<h4 style="margin:0 0 1rem">' + (c.id ? "Rediger karusell" : "Ny karusell") + '</h4>' +

          '<fieldset class="crsl-fieldset"><legend>Identitet</legend>' +
            C.field({ id:"crsl-label", label:"Namn (visast i Navigasjon-fanen) *", value: c.label || "" }) +
            '<div class="field"><label for="crsl-order">Plassering (order)</label>' +
              '<input id="crsl-order" type="number" min="1" max="999" value="' + esc(String(c.order || nextOrder)) + '">' +
              '<p style="font-size:.76rem;color:var(--color-muted);margin:.2rem 0 0">Hjem=10 · Om oss=20 · Tenester=30 · Aktuelt=40 · Kontakt=50</p>' +
            '</div>' +
          '</fieldset>' +

          '<fieldset class="crsl-fieldset"><legend>Framdrift</legend>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem" id="crsl-advance-wrap">' +
              advanceCard("auto",   "Automatisk", "Rullerer selv, kan settes på pause ved å holde musen over", advance.mode !== "manual") +
              advanceCard("manual", "Manuell",    "Kun piler, prikker og sveip — ingen automatisk rullering",   advance.mode === "manual") +
            '</div>' +
            '<div class="field" id="crsl-interval-wrap" style="margin-top:.6rem' + (advance.mode === "manual" ? ";display:none" : "") + '">' +
              '<label for="crsl-interval">Sekund mellom hver slide</label>' +
              '<input id="crsl-interval" type="number" min="2" max="60" value="' + esc(String(advance.intervalSec || 5)) + '">' +
            '</div>' +
          '</fieldset>' +

          '<fieldset class="crsl-fieldset"><legend>Høgde</legend>' +
            '<div class="field"><select id="crsl-height">' +
              ['lav:Lav (260px)', 'medium:Medium (420px)', 'høg:Høg (580px)', 'fullskjerm:Fullskjerm (100vh)'].map(function (h) {
                var p = h.split(":"); return '<option value="' + esc(p[0]) + '"' + (p[0] === (c.height || "medium") ? " selected" : "") + '>' + esc(p[1]) + '</option>';
              }).join("") +
            '</select></div>' +
          '</fieldset>' +

          '<fieldset class="crsl-fieldset"><legend>Tekstfarge (felles for alle slides)</legend>' +
            '<input type="color" id="crsl-text-color" value="' + esc(c.textColor || "#ffffff") + '">' +
          '</fieldset>' +

          '<fieldset class="crsl-fieldset"><legend>Slides</legend>' +
            '<div id="crsl-slides-list"></div>' +
            C.button({ label:"Legg til bilde-slide", icon:"photo", variant:"ghost", attrs:'data-crsl-add-slide="image"' }) + ' ' +
            C.button({ label:"Legg til video-slide", icon:"video", variant:"ghost", attrs:'data-crsl-add-slide="video"' }) +
          '</fieldset>' +

          '<div style="display:flex;gap:.6rem">' +
            C.button({ label:"Lagre", variant:"primary", attrs:"data-crsl-save" }) +
            C.button({ label:"Avbryt", variant:"ghost",  attrs:"data-crsl-cancel" }) +
          '</div>' +
          '<p class="form__status" id="crsl-status"></p>' +
        '</div>';

      renderSlidesList();

      ed.querySelectorAll('[name="crsl-advance"]').forEach(function (radio) {
        radio.addEventListener("change", function () {
          var wrap = ed.querySelector("#crsl-interval-wrap");
          wrap.style.display = radio.value === "manual" ? "none" : "";
        });
      });

      ed.querySelector("#crsl-height").addEventListener("change", function () {
        // Same imgfield:relayout-mønster scrollbanner brukar ved modusbyte —
        // alle opne bilde-slide-forhandsvisingar må omkalkulere croppen sin
        // når karusellen sin delte aspect-ratio endrar seg.
        var newAspect = aspectForHeight(ed.querySelector("#crsl-height").value);
        ed.querySelectorAll(".imgfield__preview").forEach(function (preview) {
          preview.setAttribute("data-aspect", newAspect);
          var wrap = preview.closest("[data-imgfield]");
          if (wrap) wrap.dispatchEvent(new Event("imgfield:relayout"));
        });
      });

      ed.querySelector("[data-crsl-cancel]").addEventListener("click", function () { ed.innerHTML = ""; });
      ed.querySelector("[data-crsl-save]").addEventListener("click", onSave);
      ed.querySelectorAll("[data-crsl-add-slide]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          slides.push({ id: newSlideId(), kind: btn.getAttribute("data-crsl-add-slide"), order: slides.length });
          renderSlidesList();
        });
      });
    }

    function aspectForHeight(height) {
      // Karusellar er breie, landskapsforma boksar i alle høgdepresettar
      // (ulikt scrollbanner sitt static/parallax-skilje) — 16:9 for alle
      // unntatt fullskjerm, som brukar ein breiare 21:9 sidan 100vh-boksen
      // ofte er mykje breiare enn han er høg på skrivebord.
      return height === "fullskjerm" ? (21/9) : (16/9);
    }

    function renderSlidesList() {
      var listEl = ed.querySelector("#crsl-slides-list");
      if (!listEl) return;
      var aspect = aspectForHeight(ed.querySelector("#crsl-height") ? ed.querySelector("#crsl-height").value : (c.height || "medium"));
      listEl.innerHTML = slides.map(function (sl, i) { return slideRowHtml(sl, i, aspect); }).join("");

      App.ui.bindImageFields(listEl);

      // Dra-og-slipp-omsortering — same mønster som module-mediabank.js, MEN
      // draggable="true" sit her berre på handtaket (.crsl-draghandle), IKKJE
      // på heile rada slik mediabank sine reine bilde-miniatyrar tillèt seg --
      // ei bilete-/video-slide-rad her inneheld eit imageField med sin eigen
      // museklikk-baserte fokuspunkt-dra-funksjon, som elles ville kollidert
      // med nettlesaren sin native HTML5-dra-og-slepp (eit drag inni
      // beskjeringsvindauget ville starta ei rad-omsortering i staden for å
      // flytte fokuspunktet). dragover/drop lyttar framleis på heile rada,
      // sidan dei berre bryr seg om KVAR musepeikaren slepper, ikkje kva
      // element som faktisk er sett draggable.
      var dragSrc = null;
      listEl.querySelectorAll("[data-crsl-slide-row]").forEach(function (row) {
        var handle = row.querySelector(".crsl-draghandle");
        if (handle) {
          handle.addEventListener("dragstart", function (e) {
            dragSrc = row; row.classList.add("is-dragging");
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          });
          handle.addEventListener("dragend", function () { row.classList.remove("is-dragging"); });
        }
        row.addEventListener("dragover", function (e) { e.preventDefault(); });
        row.addEventListener("drop", function (e) {
          e.preventDefault();
          if (!dragSrc || dragSrc === row) return;
          var rows = Array.prototype.slice.call(listEl.querySelectorAll("[data-crsl-slide-row]"));
          var srcIdx = rows.indexOf(dragSrc), dstIdx = rows.indexOf(row);
          if (srcIdx < dstIdx) listEl.insertBefore(dragSrc, row.nextSibling);
          else listEl.insertBefore(dragSrc, row);
          syncSlideValuesFromDom(); // les av gjeldande feltverdiar FØR vi endrar rekkefølgda i `slides`-arrayet
          var newOrderIds = Array.prototype.slice.call(listEl.querySelectorAll("[data-crsl-slide-row]")).map(function (el) { return el.getAttribute("data-crsl-slide-row"); });
          slides.sort(function (a, b) { return newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id); });
        });
      });

      listEl.querySelectorAll("[data-crsl-slide-del]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-crsl-slide-del");
          if (!confirm("Fjerne denne slide-en? Kan ikke angres.")) return;
          var sl = slides.find(function (x) { return x.id === id; });
          freeSlideMedia(sl);
          slides = slides.filter(function (x) { return x.id !== id; });
          renderSlidesList();
        });
      });
      listEl.querySelectorAll("[data-crsl-video-input]").forEach(function (input) {
        input.addEventListener("change", function () {
          var file = input.files && input.files[0];
          var slideId = input.getAttribute("data-crsl-video-input");
          var statusEl = listEl.querySelector('[data-crsl-video-status="' + slideId + '"]');
          if (!file) return;
          if (statusEl) { statusEl.textContent = "Laster opp …"; statusEl.className = "form__status"; }
          App.media.putVideo(file).then(function (url) {
            var sl = slides.find(function (x) { return x.id === slideId; });
            if (sl) sl.video = Object.assign({}, sl.video, { src: url });
            if (statusEl) { statusEl.textContent = "Lastet opp."; statusEl.className = "form__status is-ok"; }
            renderSlidesList();
          }).catch(function (err) {
            var msg = err && err.message === "type" ? "Kun MP4-filer er støttet."
              : err && err.message === "size" ? "Filen er for stor (maks " + App.media.MAX_VIDEO_MB + " MB)."
              : "Kunne ikke laste opp klippet. Prøv igjen.";
            if (statusEl) { statusEl.textContent = msg; statusEl.className = "form__status is-err"; }
          });
        });
      });
    }

    function slideRowHtml(sl, i, aspect) {
      var kindLabel = sl.kind === "video" ? "Video" : "Bilde";
      var body;
      if (sl.kind === "video") {
        var v = sl.video || {};
        body = (v.src ? '<video class="crsl-video-preview" src="' + esc(v.src) + '" controls muted></video>' : "") +
          '<div class="field" style="margin-top:.5rem"><label>Videoklipp (MP4, maks ' + App.media.MAX_VIDEO_MB + ' MB)</label>' +
            '<input type="file" accept="video/mp4" data-crsl-video-input="' + esc(sl.id) + '"></div>' +
          '<p class="form__status" data-crsl-video-status="' + esc(sl.id) + '"></p>' +
          C.field({ id:"crsl-slide-alt-" + sl.id, label:"Alt-tekst", value: v.alt || "" }) +
          App.ui.imageField("crsl-slide-poster-" + sl.id, "Poster-bilde (valgfritt, vises før avspilling)", v.poster, aspect);
      } else {
        body = App.ui.imageField("crsl-slide-image-" + sl.id, "Bilde", sl.image, aspect);
      }
      return '<div class="crsl-slide-row" data-crsl-slide-row="' + esc(sl.id) + '">' +
        '<div class="crsl-slide-head">' +
          '<span class="crsl-draghandle" draggable="true" title="Dra for å endre rekkefølge">' + C.icon("grip-vertical") + '</span>' +
          '<strong style="flex:1;font-size:.85rem">' + kindLabel + '-slide ' + (i+1) + '</strong>' +
          C.button({ label:"Fjern", variant:"ghost", attrs:'data-crsl-slide-del="' + esc(sl.id) + '"' }) +
        '</div>' +
        body +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:.7rem">' +
          '<div class="field"><label for="crsl-ov-color-' + sl.id + '">Overleggsfarge</label><input type="color" id="crsl-ov-color-' + sl.id + '" value="' + esc(sl.overlayColor || "#000000") + '"></div>' +
          '<div class="field"><label for="crsl-ov-opacity-' + sl.id + '">Dekking (0–1)</label><input type="number" id="crsl-ov-opacity-' + sl.id + '" min="0" max="1" step="0.05" value="' + esc(String(sl.overlayOpacity !== undefined ? sl.overlayOpacity : 0)) + '"></div>' +
        '</div>' +
        C.field({ id:"crsl-title-" + sl.id, label:"Tittel", value: sl.title || "" }) +
        C.field({ id:"crsl-text-" + sl.id, label:"Brødtekst", value: sl.text || "", multiline:true, rows:2 }) +
        C.field({ id:"crsl-cta-label-" + sl.id, label:"Knapptekst", value: sl.ctaLabel || "" }) +
        C.field({ id:"crsl-cta-url-" + sl.id, label:"Lenke", value: sl.ctaUrl || "" }) +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">' +
          '<div class="field"><label for="crsl-cta-bg-' + sl.id + '">Knappfarge</label><input type="color" id="crsl-cta-bg-' + sl.id + '" value="' + esc(sl.ctaBg || "#15616D") + '"></div>' +
          '<div class="field"><label for="crsl-cta-color-' + sl.id + '">Tekstfarge</label><input type="color" id="crsl-cta-color-' + sl.id + '" value="' + esc(sl.ctaColor || "#ffffff") + '"></div>' +
        '</div>' +
      '</div>';
    }

    function advanceCard(value, title, desc, checked) {
      return '<label style="display:flex;align-items:flex-start;gap:.5rem;cursor:pointer;padding:.65rem .8rem;' +
        'border:1.5px solid ' + (checked ? "var(--color-primary)" : "var(--color-border)") + ';border-radius:9px">' +
        '<input type="radio" name="crsl-advance" value="' + esc(value) + '"' + (checked ? " checked" : "") + ' style="margin-top:.15rem">' +
        '<div><strong style="font-size:.88rem;display:block">' + esc(title) + '</strong>' +
          '<span style="font-size:.76rem;color:var(--color-muted)">' + esc(desc) + '</span>' +
        '</div>' +
      '</label>';
    }

    // Les av dei ferdig-redigerte feltverdiane frå DOM-et tilbake inn i
    // `slides`-arrayet FØR ei omsortering/lagring — elles ville ei drag-and-
    // drop-omsortering (som berre flyttar DOM-radene, ikkje arrayet direkte)
    // mista ferdig utfylte, ikkje-lagra felt.
    function syncSlideValuesFromDom() {
      slides.forEach(function (sl) {
        if (sl.kind === "video") {
          sl.video = sl.video || {};
          var altEl = ed.querySelector("#crsl-slide-alt-" + sl.id);
          if (altEl) sl.video.alt = altEl.value.trim();
          sl.video.poster = App.ui.readImageField(ed, "crsl-slide-poster-" + sl.id);
        } else {
          sl.image = App.ui.readImageField(ed, "crsl-slide-image-" + sl.id);
        }
        var ov = ed.querySelector("#crsl-ov-color-" + sl.id);
        var ovOp = ed.querySelector("#crsl-ov-opacity-" + sl.id);
        if (ov) sl.overlayColor = ov.value;
        if (ovOp) sl.overlayOpacity = parseFloat(ovOp.value) || 0;
        var titleEl = ed.querySelector("#crsl-title-" + sl.id);
        var textEl  = ed.querySelector("#crsl-text-" + sl.id);
        if (titleEl) sl.title = titleEl.value.trim();
        if (textEl)  sl.text  = textEl.value.trim();
        var ctaLabelEl = ed.querySelector("#crsl-cta-label-" + sl.id);
        var ctaUrlEl   = ed.querySelector("#crsl-cta-url-" + sl.id);
        var ctaBgEl    = ed.querySelector("#crsl-cta-bg-" + sl.id);
        var ctaColorEl = ed.querySelector("#crsl-cta-color-" + sl.id);
        if (ctaLabelEl) sl.ctaLabel = ctaLabelEl.value.trim();
        if (ctaUrlEl) {
          var u = ctaUrlEl.value.trim();
          sl.ctaUrl = (u && !u.startsWith('http') && !u.startsWith('#') && !u.startsWith('mailto:') && !u.startsWith('/')) ? 'https://' + u : u;
        }
        if (ctaBgEl) sl.ctaBg = ctaBgEl.value;
        if (ctaColorEl) sl.ctaColor = ctaColorEl.value;
      });
    }

    function onSave() {
      var label = ed.querySelector("#crsl-label").value.trim();
      var st    = ed.querySelector("#crsl-status");
      if (!label) { st.textContent = "Namn er påkrevd."; st.className = "form__status is-err"; return; }
      if (!slides.length) { st.textContent = "Legg til minst én slide."; st.className = "form__status is-err"; return; }

      syncSlideValuesFromDom();

      var advanceEl = ed.querySelector('[name="crsl-advance"]:checked');
      var obj = {
        id:        c.id || newId(),
        label:     label,
        order:     parseInt(ed.querySelector("#crsl-order").value, 10) || nextOrder,
        height:    ed.querySelector("#crsl-height").value,
        textColor: ed.querySelector("#crsl-text-color").value,
        advance: {
          mode:        advanceEl ? advanceEl.value : "auto",
          intervalSec: parseInt(ed.querySelector("#crsl-interval").value, 10) || 5
        },
        slides: slides.map(function (sl, i) {
          var out = { id: sl.id, kind: sl.kind, order: i,
            overlayColor: sl.overlayColor, overlayOpacity: sl.overlayOpacity,
            title: sl.title, text: sl.text,
            ctaLabel: sl.ctaLabel, ctaUrl: sl.ctaUrl, ctaBg: sl.ctaBg, ctaColor: sl.ctaColor };
          if (sl.kind === "video") out.video = sl.video || {}; else out.image = sl.image;
          return out;
        })
      };

      var list = getCarousels();
      if (c.id) {
        var idx = list.findIndex(function (x) { return x.id === c.id; });
        if (idx >= 0) list[idx] = obj; else list.push(obj);
        delete registered[c.id];
        if (timers[c.id]) { clearInterval(timers[c.id]); delete timers[c.id]; }
      } else {
        list.push(obj);
      }
      setCarousels(list);
      syncModules();
      ed.innerHTML = "";
      renderAdminRoot(root);
    }
  }

  /* =========================================================================
     OPPSTART
     ====================================================================== */
  injectStyles();
  syncModules();

  App.registerModule({
    id:        "carousel-admin",
    label:     "",
    order:     9999,
    adminOnly: true,
    render:    function () { return ""; },
    admin: {
      label:    "Karusell",
      category: "innhold",
      render:   function () { return '<div data-crsl-admin-root></div>'; },
      mount:    function (body) {
        renderAdminRoot(body.querySelector("[data-crsl-admin-root]") || body);
      }
    }
  });

  });
})();
