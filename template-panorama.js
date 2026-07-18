/* =============================================================================
   template-panorama.js — "Panorama" designmal (Design-modul / "sidebygger")
   -----------------------------------------------------------------------------
   Mal 2 (fyrste FAKTISK nye malen, sjå ROADMAP.md "Design-modul (sidebygger)").
   Kontrast til "Klassisk": store bilete er hovudelementet, teksten er
   minimal/redaksjonell i staden for informativ/tett. Bruker DEI SAME
   innhaldsfelta som Klassisk (hero.title/image, about.heading/text/image,
   services sine kort) — berre layout/typografi/biletvekt er annleis, ingen
   nye admin-felt trengst for kunden.

   Eiga, sjølvstendig CSS injisert HER (ikkje i index.html sin delte
   <style>-blokk) — held malen fullstendig isolert frå Klassisk sin CSS og
   frå framtidige malar sin CSS, nøyaktig som Arkitekt-konsultasjonen
   tilrådde. Klassenamn er prefikssa "pano-" for å aldri kollidere med
   Klassisk sine eksisterande klassar (.hero, .about__media, .card, osv.).
   ========================================================================== */
(function () {
  "use strict";
  var C = window.Components;
  if (!C) return;

  var CSS =
    '.pano-hero{position:relative;min-height:100vh;display:flex;align-items:flex-end;background-size:cover;background-position:50% 50%;color:#fff}' +
    '.pano-hero__scrim{position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.72),rgba(0,0,0,.15) 55%,rgba(0,0,0,0) 75%)}' +
    '.pano-hero__inner{position:relative;padding:3rem clamp(1.2rem,5vw,4rem) 4rem;max-width:900px}' +
    '.pano-hero__title{font-size:clamp(2.4rem,6vw,5rem);line-height:1.02;margin:0 0 .6rem;font-weight:800;letter-spacing:-.01em}' +
    '.pano-hero__subtitle{font-size:1.05rem;opacity:.9;margin:0 0 1.2rem;max-width:46ch}' +
    '.pano-about{padding:clamp(2rem,6vw,5rem) 0}' +
    '.pano-about__img{display:block;width:100%;aspect-ratio:21/9;object-fit:cover;border-radius:4px}' +
    '.pano-about__body{max-width:720px;margin:1.6rem auto 0;text-align:center;padding:0 1.2rem}' +
    '.pano-about__body h2{font-size:clamp(1.6rem,3vw,2.4rem);margin:0 0 .8rem}' +
    '.pano-services{padding:clamp(2rem,6vw,5rem) 0}' +
    '.pano-services__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;max-width:1200px;margin:0 auto;padding:0 clamp(1.1rem,4vw,2rem)}' +
    '.pano-card{position:relative;border-radius:4px;overflow:hidden;aspect-ratio:4/5;background:var(--color-surface,#eee)}' +
    '.pano-card__img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.pano-card__caption{position:absolute;left:0;right:0;bottom:0;padding:1.2rem 1rem .9rem;background:linear-gradient(0deg,rgba(0,0,0,.8) 0%,rgba(0,0,0,.4) 60%,rgba(0,0,0,0) 100%);color:#fff;font-weight:700;font-size:1.05rem}' +
    '.pano-card--noimg{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:.5rem;aspect-ratio:auto;padding:2rem 1rem;border:1.5px solid var(--color-border,#ddd);background:var(--color-surface,#f8f8f8)}' +
    '.pano-card--noimg .card__icon{font-size:1.8rem;color:var(--color-primary,#1a7a6e)}' +
    '@media (max-width:700px){.pano-hero{min-height:70vh}.pano-hero__inner{padding:2rem 1.2rem 2.4rem}.pano-about__img{aspect-ratio:4/3}}';

  function injectCss() {
    if (document.getElementById("tmpl-panorama-css")) return;
    var style = document.createElement("style");
    style.id = "tmpl-panorama-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function hero(d) {
    injectCss();
    var img = d.image && d.image.src ? d.image : null;
    var style = img
      ? ' style="background-image:url(\'' + C.esc(img.src) + '\');background-position:' + C.esc(img.pos || "50% 50%") + '"'
      : "";
    return (
      '<section id="hjem" class="pano-hero reveal"' + style + '>' +
        (img ? '<div class="pano-hero__scrim"></div>' : "") +
        '<div class="pano-hero__inner">' +
          '<h1 class="pano-hero__title">' + C.esc(d.title) + '</h1>' +
          (d.subtitle ? '<p class="pano-hero__subtitle">' + C.esc(d.subtitle) + '</p>' : "") +
          (d.ctaLabel && d.ctaTarget ? C.button({ label: d.ctaLabel, href: d.ctaTarget, variant: "primary" }) : "") +
        '</div>' +
        (img ? C.creditBadge(img) : "") +
      '</section>'
    );
  }

  function about(d) {
    injectCss();
    var hasImg = d.image && d.image.src;
    return (
      '<section id="om-oss" class="pano-about reveal">' +
        '<div class="container">' +
          (hasImg ? C.coverImg(d.image, "pano-about__img") : "") +
          '<div class="pano-about__body">' +
            C.eyebrow(d.intro || d.heading) +
            '<h2>' + C.esc(d.heading) + '</h2>' +
            '<div class="prose">' + C.sanitizeRichHtml(d.text) + '</div>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function services(d) {
    injectCss();
    var cards = (d.cards || []).map(function (c) {
      var hasImg = c.image && c.image.src;
      if (hasImg) {
        return (
          '<article class="pano-card">' +
            C.coverImg(c.image, "pano-card__img") +
            '<div class="pano-card__caption">' + C.esc(c.title) + '</div>' +
          '</article>'
        );
      }
      // Fallback utan bilete -- Panorama sin visjon føreset store bilete, men
      // eit kort utan bilete skal likevel vere lesbart, ikkje tomt/knust.
      return (
        '<article class="pano-card pano-card--noimg">' +
          '<span class="card__icon">' + C.icon(c.icon) + '</span>' +
          '<h3 style="margin:0;font-size:1rem">' + C.esc(c.title) + '</h3>' +
          '<div class="card__text" style="font-size:.85rem;text-align:center">' + C.sanitizeRichHtml(c.text) + '</div>' +
        '</article>'
      );
    }).join("");
    return (
      '<section id="tjenester" class="pano-services reveal">' +
        '<div class="container" style="text-align:center;margin-bottom:1.5rem">' +
          C.eyebrow(d.intro || d.heading) +
          '<h2 class="section__title">' + C.esc(d.heading) + '</h2>' +
        '</div>' +
        '<div class="pano-services__grid">' + cards + '</div>' +
      '</section>'
    );
  }

  window.SiteTemplates = window.SiteTemplates || {};
  window.SiteTemplates.panorama = { id: "panorama", label: "Panorama", hero: hero, about: about, services: services };
})();
