/* =============================================================================
   template-klassisk.js — "Klassisk" designmal (Design-modul / "sidebygger")
   -----------------------------------------------------------------------------
   Fase 0 (ROADMAP.md "Design-modul (sidebygger)"): dagens eksisterande
   hero()/about()/services()-implementasjon, flytta HIT UENDRA (reint
   flyttesteg, ingen visuell endring) frå components.js. Kvar framtidig
   designmal skal vere sin eigen fil etter same mønster — ALDRI redigere
   ein eksisterande mal sin kode når ein ny mal vert lagt til, berre leggje
   til ei ny fil + éi ny <script>-linje. Sjå window.SiteTemplates under.

   data-content-key (2026-09-17, fyrste skive av "rediger direkte på sida",
   sjå core.js sin liveEdit*-kode og docs/decisions for Architect-vurderinga):
   eit minimalt, INKREMENTELT konvensjon-attributt som koplar eit synleg
   element direkte til stien i det faktiske content-objektet det viser.
   Kvar ny nøkkel krev både (1) attributtet her og (2) ei oppføring i
   LIVE_EDIT_FIELDS-kvitelista i core.js, elles vert klikket ignorert.
   ALDRI legg attributtet på eit element utan ekte innhaldsfelt bak (t.d.
   reint dekorative/hardkoda element) -- sjå Architect-vurderinga om kvifor
   template-vibeverk-cinema.js sitt "tre grunnar"-band og terminal-
   animasjon MÅ haldast utanfor dette heilt.

   Utvida 2026-09-17 fyrst til fire enkle plain-text-felt (hero.title,
   hero.subtitle, about.heading, servicesSection.heading), deretter SAME
   DAG (etter eksplisitt ønske om "alle tilgjengelege tekstfelt" + rik
   tekst-redigering) til ALLE tekstfelt malen faktisk viser:
   - about.intro/servicesSection.intro (C.eyebrow() sin valfrie
     contentKey-parameter, viser `d.intro || d.heading` -- å redigere
     denne set INTRO eksplisitt, som naturleg avsluttar fallback-åtferda)
   - about.text/services[].text (RIK TEKST -- get()/set() les/skriv
     el.innerHTML, ikkje textContent, og core.js sin startInlineEdit()
     køyrer C.sanitizeRichHtml() på vegen inn IGJEN før lagring, sjølv om
     render()-sida alt gjer det -- forsvar i djupn, ikkje stol på at berre
     éin av dei to sidene sanerer)
   - services[].title/.text (DYNAMISK per kort -- data-content-key er
     "services.<id>.title"/"services.<id>.text", løyst i core.js sin
     resolveDynamicField() mot content.services sin FAKTISKE, noverande
     liste -- eit ukjent/oppdikta id gjev ALDRI eit gyldig mål, akkurat
     same prinsipp som den statiske kvitelista, berre mønster+eksistens-
     sjekk i staden for eit fast oppslag)

   Framleis heilt utanfor: template-vibeverk-cinema.js sitt hardkoda "tre
   grunnar"-band og terminal-animasjon (ALDRI data-content-key -- ingen
   ekte innhaldsfelt bak dei), og alle andre malar (panorama/scrollstory)
   -- eksplisitt utsett til seinare, sjå samtale 2026-09-17.
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
          '<h1 class="hero__title" data-content-key="hero.title">' + C.esc(d.title) + '</h1>' +
          '<p class="hero__subtitle" data-content-key="hero.subtitle">' + C.esc(d.subtitle) + '</p>' +
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
            C.eyebrow(d.intro || d.heading, "about.intro") +
            '<h2 class="section__title" data-content-key="about.heading">' + C.esc(d.heading) + '</h2>' +
            '<div class="prose" data-content-key="about.text">' + C.sanitizeRichHtml(d.text) + '</div>' +
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
            '<h3 class="card__title" data-content-key="services.' + C.esc(c.id) + '.title">' + C.esc(c.title) + '</h3>' +
            '<div class="card__text" data-content-key="services.' + C.esc(c.id) + '.text">' + C.sanitizeRichHtml(c.text) + '</div>' +
          '</div>' +
        '</article>'
      );
    }).join("");
    return (
      '<section id="tjenester" class="section reveal">' +
        '<div class="container">' +
          C.eyebrow(d.intro || d.heading, "servicesSection.intro") +
          '<h2 class="section__title" data-content-key="servicesSection.heading">' + C.esc(d.heading) + '</h2>' +
          '<div class="cards">' + cards + '</div>' +
        '</div>' +
      '</section>'
    );
  }

  window.SiteTemplates = window.SiteTemplates || {};
  window.SiteTemplates.klassisk = { id: "klassisk", label: "Klassisk", hero: hero, about: about, services: services };
})();
