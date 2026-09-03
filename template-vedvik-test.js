/* =============================================================================
   template-vedvik-test.js — MIDLERTIDIG plumbing-test, ikkje ein ekte designmal
   -----------------------------------------------------------------------------
   Formål: bevise at éin einskild tenant kan få tildelt sin eigen bespoke
   window.SiteTemplates-mal via Console sitt "Design-mal (avansert)"-felt
   (get_design_template/set_design_template i broker), utan å røre dei tre
   faste malane. Rendrar tydeleg som ein TEST — ikkje meint å visast for
   nokon kunde. Skal fjernast (fil + <script>-linje i index.html) når det
   ekte "vedvik"-malprosjektet startar, sjå docs/marketing/ (lokalt, gitignora)
   for designarbeidet. Same hero/about/services-kontrakt som
   template-klassisk.js, sjå den fila for kva C-hjelparar som finst.
   ========================================================================== */
(function () {
  "use strict";
  var C = window.Components;
  if (!C) return;

  var BANNER = '<div style="background:#bd5a2e;color:#fff;text-align:center;padding:.6rem 1rem;font:600 13px/1.4 system-ui,sans-serif;letter-spacing:.04em;">PLUMBING-TEST — vedvik-test-mal, ikkje ekte innhald</div>';

  function hero(d) {
    return (
      BANNER +
      '<section id="hjem" class="section section--hero reveal" style="background:#0b2b35;color:#fff;">' +
        '<div class="container hero">' +
          '<h1 class="hero__title">' + C.esc(d.title) + '</h1>' +
          '<p class="hero__subtitle">' + C.esc(d.subtitle) + '</p>' +
        '</div>' +
      '</section>'
    );
  }

  function about(d) {
    return (
      '<section id="om-oss" class="section reveal">' +
        '<div class="container about">' +
          '<div class="about__body">' +
            C.eyebrow(d.intro || d.heading) +
            '<h2 class="section__title">' + C.esc(d.heading) + '</h2>' +
            '<div class="prose">' + C.sanitizeRichHtml(d.text) + '</div>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function services(d) {
    var cards = (d.cards || []).map(function (c) {
      return (
        '<article class="card">' +
          '<div class="card__body">' +
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
  window.SiteTemplates["vedvik-test"] = { id: "vedvik-test", label: "(TEST) Vedvik plumbing", hero: hero, about: about, services: services };
})();
