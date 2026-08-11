/* =============================================================================
   module-page-builder.js — SIDEBYGGER (offentleg side, Fase 1)
   -----------------------------------------------------------------------------
   Console-only i denne fasen (sjå docs/roadmap): Vibeverk-operatøren bygger
   ekstrasider (t.d. "Jobb hos oss", "Ansatte", "HMS") som ei ordna liste av
   kontrollerte seksjonstypar (hero/tekst/bilde+tekst/stort bilde/sitat/
   rutenett/CTA/mellomrom/blokker) — INGEN fri HTML/CSS/JS, INGEN
   pikselplassering.
   Kunden kan ikkje redigere sjølv enno (det er Fase 2, gata på
   page.locked===false, ikkje bygd her).

   Tilgjengeleg for ALLE tenantar (brukaravklaring 2026-08-11) — ikkje gata
   på features.sidebygger, sidan Fase 1 uansett er operatør-drive, ikkje
   kundens eige verktøy.

   Lagring: éin store-nøkkel "custom-pages", flat array av sider, kvar med
   ei ordna liste av seksjonar — same mønster som module-scrollbanner.js sin
   "scrollbanners"-nøkkel. Kvar side vert registrert som ein eigen page:true-
   modul (som Mediabank/Aktuelt/FAQ), IKKJE innbaka på forsida.

   Ingen unregister-mekanisme finst i App.registerModule() (verifisert i
   core.js) — renderCustomPage() les difor lagringa PÅ NYTT kvar gong han
   kallast, og viser "finst ikkje lenger" om sida er sletta i mellomtida,
   same mønster som module-scrollbanner.js sin renderBanner()-closure bruker
   for sletta banner-element.
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App;
  var C   = window.Components;
  if (!App || !C) return;

  App.ready(function () {

  var STORE_KEY = "custom-pages";

  function getPages() { return App.store.get(STORE_KEY, []) || []; }

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("page-builder-styles")) return;
    var s = document.createElement("style");
    s.id  = "page-builder-styles";
    s.textContent = [
      ".pb-page{}",
      ".pb-sect{padding:3rem var(--gap,1.5rem)}",
      ".pb-sect__inner{max-width:1100px;margin:0 auto}",
      ".pb-sect--w-narrow .pb-sect__inner{max-width:760px}",
      ".pb-sect--sp-small{padding-top:1.5rem;padding-bottom:1.5rem}",
      ".pb-sect--sp-normal{padding-top:3rem;padding-bottom:3rem}",
      ".pb-sect--sp-large{padding-top:5rem;padding-bottom:5rem}",
      ".pb-sect--bg-light{background:var(--color-bg)}",
      ".pb-sect--bg-dark{background:var(--color-text);color:#fff}",
      ".pb-sect--bg-branded{background:var(--color-primary);color:#fff}",
      ".pb-sect--al-center .pb-sect__inner{text-align:center}",

      /* Hero */
      ".pb-hero{position:relative}",
      ".pb-hero.has-image{border-radius:12px;overflow:hidden}",
      ".pb-hero__img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}",
      ".pb-hero.has-image::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.45),rgba(0,0,0,.3));z-index:0}",
      ".pb-hero__body{position:relative;z-index:1;padding:3rem 1.5rem}",
      ".pb-hero.has-image .pb-hero__body{color:#fff}",
      ".pb-hero__title{font-family:var(--font-display);font-size:clamp(1.5rem,4vw,2.4rem);font-weight:700;margin:0 0 .6rem}",
      ".pb-hero__text{font-size:clamp(.95rem,2vw,1.1rem);line-height:1.6;margin:0 0 1.2rem}",

      /* Tekst */
      ".pb-text__title{font-family:var(--font-display);font-size:1.6rem;margin:0 0 .8rem}",

      /* Bilde + tekst */
      ".pb-imgtext{display:flex;gap:2rem;align-items:center}",
      ".pb-imgtext--right{flex-direction:row-reverse}",
      ".pb-imgtext__img{flex:1 1 45%;width:100%;max-width:520px;border-radius:12px;object-fit:cover;aspect-ratio:4/3}",
      ".pb-imgtext__body{flex:1 1 45%;min-width:0}",
      ".pb-imgtext__title{font-family:var(--font-display);font-size:1.5rem;margin:0 0 .8rem}",
      "@media(max-width:700px){.pb-imgtext{flex-direction:column}.pb-imgtext__img{max-width:100%}}",

      /* Stort bilde */
      ".pb-bigimage__img{width:100%;border-radius:12px;object-fit:cover;max-height:70vh}",
      ".pb-bigimage__caption{font-size:.85rem;color:var(--color-muted);margin:.6rem 0 0;text-align:center}",

      /* Sitat */
      ".pb-quote{border-left:4px solid var(--color-primary);padding-left:1.5rem;margin:0}",
      ".pb-quote__text{font-size:1.3rem;font-style:italic;line-height:1.5;margin:0 0 .8rem}",
      ".pb-quote__author{font-weight:600;font-style:normal}",
      ".pb-quote__role{font-weight:400;color:var(--color-muted)}",

      /* Rutenett — fast repeat(n,1fr), IKKJE auto-fit sidan kolonnetalet er
         eit medvite operatørval, ikkje noko layouten skal overstyre sjølv. */
      ".pb-grid{display:grid;gap:1.5rem}",
      ".pb-grid--cols-1{grid-template-columns:repeat(1,1fr)}",
      ".pb-grid--cols-2{grid-template-columns:repeat(2,1fr)}",
      ".pb-grid--cols-3{grid-template-columns:repeat(3,1fr)}",
      ".pb-grid--cols-4{grid-template-columns:repeat(4,1fr)}",
      ".pb-grid__item{background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:1.2rem;overflow:hidden}",
      ".pb-grid__img{width:100%;border-radius:8px;object-fit:cover;aspect-ratio:4/3;margin-bottom:.8rem}",
      ".pb-grid__title{font-size:1.05rem;margin:0 0 .4rem}",
      ".pb-grid__text{font-size:.9rem;color:var(--color-muted);margin:0 0 .6rem}",
      "@media(max-width:900px){.pb-grid--cols-3,.pb-grid--cols-4{grid-template-columns:repeat(2,1fr)}}",
      "@media(max-width:600px){.pb-grid{grid-template-columns:1fr!important}}",

      /* CTA */
      ".pb-cta__title{font-family:var(--font-display);font-size:1.6rem;margin:0 0 .6rem}",
      ".pb-cta__text{margin:0 0 1.2rem}",

      /* Mellomrom */
      ".pb-spacer{height:1px}",

      /* Blokker (9. seksjonstype) — .pb-blocks__slot er MEDVITE ein eigen
         klassefamilie, ikkje .pb-grid__item: ein slot kan stable FLEIRE,
         ulikt-typa blokker, ikkje eitt fast kort. Same "faste fr-verdiar,
         ikkje auto-fit"-filosofi og same brotpunkt (900px/600px) som
         .pb-grid over -- ingen nye verdiar oppfunne. MÅ haldast synk med
         den identiske kopien i console/console-core.js sin pbPreviewCss(). */
      ".pb-blocks{display:grid;gap:1.5rem}",
      ".pb-blocks--1col{grid-template-columns:1fr}",
      ".pb-blocks--2col{grid-template-columns:1fr 1fr}",
      ".pb-blocks--2col-2-1{grid-template-columns:2fr 1fr}",
      ".pb-blocks--2col-1-2{grid-template-columns:1fr 2fr}",
      ".pb-blocks--3col{grid-template-columns:1fr 1fr 1fr}",
      ".pb-blocks--4col{grid-template-columns:1fr 1fr 1fr 1fr}",
      ".pb-blocks__slot{display:flex;flex-direction:column;gap:1.2rem;min-width:0}",
      ".pb-block-heading{margin:0;font-family:var(--font-display);font-weight:700}",
      ".pb-block-heading--h2{font-size:1.5rem}",
      ".pb-block-heading--h3{font-size:1.15rem}",
      ".pb-block-image__img{width:100%;border-radius:12px;object-fit:cover}",
      ".pb-block-button{margin:.2rem 0}",
      ".pb-block-contact{display:flex;align-items:center;gap:.6rem;font-size:.95rem}",
      ".pb-block-contact a{color:inherit}",
      ".pb-block-spacer{height:1px}",
      "@media(max-width:900px){.pb-blocks--3col,.pb-blocks--4col{grid-template-columns:1fr 1fr}}",
      "@media(max-width:600px){.pb-blocks{grid-template-columns:1fr!important}}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     RENDER EI SIDE
     ====================================================================== */
  function renderCustomPage(pageId) {
    var p = getPages().find(function (x) { return x.id === pageId; });
    if (!p) {
      return C.simpleView("Denne siden finnes ikke lenger", "Siden er fjernet eller flyttet.", "#", "Til forsiden");
    }
    return '<div class="pb-page">' +
      (p.sections || []).map(function (s) { return C.pageSection(s); }).join("") +
    '</div>';
  }

  /* =========================================================================
     DYNAMISK REGISTRERING — same mønster som module-scrollbanner.js sin
     syncModules(), men éin page:true-modul per side i staden for éin inline-
     seksjon per banner.
     ====================================================================== */
  var registered = {};

  function syncModules() {
    getPages().forEach(function (p) {
      if (!p || !p.id || registered[p.id]) return;
      registered[p.id] = true;
      var pid = p.id;
      App.registerModule({
        id:         p.id,
        label:      p.label || p.id,
        order:      typeof p.order === "number" ? p.order : 60,
        navHidden:  !!p.navHidden,
        page:       true,
        renderPage: function () { return renderCustomPage(pid); },
        mountPage:  function () {}
      });
    });
  }

  injectStyles();
  syncModules();

  });
})();
