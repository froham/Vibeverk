/* =============================================================================
   template-klassisk.js — "Klassisk" designmal (Design-modul / "sidebygger")
   -----------------------------------------------------------------------------
   Fase 0 (ROADMAP.md "Design-modul (sidebygger)"): dagens eksisterande
   hero()/about()/services()-implementasjon, flytta HIT UENDRA (reint
   flyttesteg, ingen visuell endring) frå components.js. Kvar framtidig
   designmal skal vere sin eigen fil etter same mønster — ALDRI redigere
   ein eksisterande mal sin kode når ein ny mal vert lagt til, berre leggje
   til ei ny fil + éi ny <script>-linje. Sjå window.SiteTemplates under.
   ========================================================================== */
(function () {
  "use strict";
  var C = window.Components;
  if (!C) return;

  function hero(d) {
    var img = d.image && d.image.src ? d.image : null;
    var style = img
      ? ' style="background-image:linear-gradient(180deg,rgba(0,0,0,.5),rgba(0,0,0,.4)),url(\'' + C.esc(img.src) + '\');background-position:' + C.esc(img.pos || "50% 50%") + '"'
      : "";
    return (
      '<section id="hjem" class="section section--hero reveal ' + (img ? "has-image" : "") + '"' + style + '>' +
        '<div class="container hero">' +
          '<h1 class="hero__title">' + C.esc(d.title) + '</h1>' +
          '<p class="hero__subtitle">' + C.esc(d.subtitle) + '</p>' +
          '<div class="hero__actions">' +
            (d.ctaLabel && d.ctaTarget ? C.button({ label: d.ctaLabel, href: d.ctaTarget, variant: "primary" }) : "") +
          '</div>' +
        '</div>' +
        (img ? C.creditBadge(img) : "") +
      '</section>'
    );
  }

  function about(d) {
    var hasImg = d.image && d.image.src;
    var media = hasImg
      ? '<div class="about__media">' + C.coverImg(d.image, "about__img") + '</div>'
      : "";
    return (
      '<section id="om-oss" class="section reveal">' +
        '<div class="container about ' + (hasImg ? "about--with-media" : "") + '">' +
          '<div class="about__body">' +
            C.eyebrow(d.intro || d.heading) +
            '<h2 class="section__title">' + C.esc(d.heading) + '</h2>' +
            '<div class="prose">' + C.sanitizeRichHtml(d.text) + '</div>' +
          '</div>' +
          media +
        '</div>' +
      '</section>'
    );
  }

  function services(d) {
    var cards = (d.cards || []).map(function (c) {
      var hasImg = c.image && c.image.src;
      var media = hasImg
        ? C.coverImg(c.image, "card__media")
        : '<span class="card__icon">' + C.icon(c.icon) + '</span>';
      return (
        '<article class="card ' + (hasImg ? "card--media" : "") + '">' +
          (hasImg ? media : "") +
          '<div class="card__body">' +
            (hasImg ? "" : media) +
            '<h3 class="card__title">' + C.esc(c.title) + '</h3>' +
            '<div class="card__text">' + C.sanitizeRichHtml(c.text) + '</div>' +
          '</div>' +
        '</article>'
      );
    }).join("");
    return (
      '<section id="tjenester" class="section reveal">' +
        '<div class="container">' +
          C.eyebrow(d.intro || d.heading) +
          '<h2 class="section__title">' + C.esc(d.heading) + '</h2>' +
          '<div class="cards">' + cards + '</div>' +
        '</div>' +
      '</section>'
    );
  }

  window.SiteTemplates = window.SiteTemplates || {};
  window.SiteTemplates.klassisk = { id: "klassisk", label: "Klassisk", hero: hero, about: about, services: services };
})();
