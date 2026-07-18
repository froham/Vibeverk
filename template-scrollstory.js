/* =============================================================================
   template-scrollstory.js — "Scroll-story" designmal (Design-modul / "sidebygger")
   -----------------------------------------------------------------------------
   Mal 3. Scrollytelling-uttrykk: heile sida les som ein SEKVENS av store,
   biletdominerte "augeblikk" som opnar seg progressivt idet kunden scrollar,
   i staden for Klassisk sitt sida-om-sida-oppsett eller Panorama sitt
   rutenett/seksjons-oppsett (sjølv om Panorama òg har store bilete). Bruker
   DEI SAME innhaldsfelta som Klassisk/Panorama (hero.title/image,
   about.heading/text/image, services sine kort) — berre layout/rytme er
   annleis, ingen nye admin-felt trengst for kunden.

   MEDVITE INGEN scroll-jacking/pinning (skjørt, dårleg for mobil/
   tilgjengelegheit, unødig teknisk risiko i eit rammeverk utan bundler).
   "Story"-kjensla kjem i staden av full-viewport-seksjonar + den EKSISTERANDE
   .reveal-mekanismen (index.html, respekterer alt prefers-reduced-motion) —
   kvart "augeblikk" (hero, about, KVART tenestekort) får si EIGA .reveal-
   klasse, sidan bindScrollReveal() observerer ALLE .reveal-element flatt
   (document.querySelectorAll(".reveal"), core.js) -- ikkje berre éin per
   seksjon. Dette gjev den sekvensielle "eitt augeblikk om gongen"-kjensla
   heilt utan eiga scroll-logikk.

   Eiga, sjølvstendig CSS injisert HER, klassenamn prefikssa "story-" for å
   aldri kollidere med Klassisk sine klassar eller Panorama sine "pano-"-
   klassar (stadfesta isolasjonsmønster, sjå ROADMAP.md). Kreditbadge er
   MEDVITE plassert som syskenelement til dei indre tekst-boksane (ikkje
   nesta inni dei) -- lærdom frå Panorama sin eigen UX-gjennomgang, der ein
   nesta badge flaut laust bort frå biletkanten på breie skjermar. */
(function () {
  "use strict";
  var C = window.Components;
  if (!C) return;

  var CSS =
    '.story-hero{position:relative;min-height:100vh;min-height:100svh;display:flex;align-items:center;justify-content:center;text-align:center;background-size:cover;background-position:50% 50%;color:#fff;overflow:hidden}' +
    '.story-hero--noimg{color:inherit;background:var(--color-tint,#f3f3f3)}' +
    '.story-hero__scrim{position:absolute;inset:0;background:rgba(0,0,0,.58)}' +
    '.story-hero__inner{position:relative;max-width:760px;margin:0 auto;padding:2rem 1.5rem;text-align:center}' +
    '.story-hero__title{font-size:clamp(2.6rem,7vw,5.5rem);line-height:1.03;margin:0 0 .8rem;font-weight:800;letter-spacing:-.01em}' +
    '.story-hero__subtitle{font-size:1.1rem;opacity:.92;margin:0 auto 1.4rem;max-width:52ch}' +
    '.story-scrollcue{position:absolute;left:50%;bottom:1.8rem;transform:translateX(-50%);width:26px;height:42px;border:2px solid rgba(255,255,255,.75);border-radius:999px}' +
    '.story-scrollcue span{position:absolute;top:8px;left:50%;width:5px;height:9px;background:#fff;border-radius:999px;transform:translateX(-50%);animation:story-scroll-bounce 1.8s infinite}' +
    '@keyframes story-scroll-bounce{0%{opacity:1;top:8px}70%{opacity:0;top:22px}100%{opacity:0;top:8px}}' +
    '@media (prefers-reduced-motion:reduce){.story-scrollcue span{animation:none}}' +
    '@media (max-height:480px){.story-scrollcue{display:none}.story-hero__inner{padding:1rem 1.2rem}.story-hero__title{font-size:clamp(1.8rem,6vw,3rem)}.story-hero__subtitle{margin-bottom:.8rem}}' +
    '.story-about{position:relative;min-height:100vh;min-height:100svh;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;padding:4rem 1.5rem}' +
    '.story-about__media{position:absolute;inset:0;overflow:hidden}' +
    '.story-about__media>*{position:absolute;inset:0;width:100%;height:100%}' +
    '.story-about__media img{object-fit:cover;display:block}' +
    '.story-about__scrim{position:absolute;inset:0;background:rgba(0,0,0,.58)}' +
    '.story-about--noimg{background:var(--color-tint,#f3f3f3)}' +
    '.story-about__body{position:relative;max-width:640px;margin:0 auto}' +
    '.story-about:not(.story-about--noimg) .story-about__body{color:#fff}' +
    '.story-about:not(.story-about--noimg) .eyebrow{color:rgba(255,255,255,.85)}' +
    '.story-about:not(.story-about--noimg) .eyebrow__mark{background:rgba(255,255,255,.85)}' +
    '.story-about__body h2{font-size:clamp(1.8rem,4vw,3rem);margin:.3rem 0 1rem}' +
    '.story-services__intro{text-align:center;padding:clamp(3rem,8vw,6rem) 1.5rem}' +
    '.story-moment{position:relative;min-height:100vh;min-height:100svh;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;color:#fff}' +
    '.story-moment__media{position:absolute;inset:0;overflow:hidden}' +
    '.story-moment__media>*{position:absolute;inset:0;width:100%;height:100%}' +
    '.story-moment__media img{object-fit:cover;display:block}' +
    '.story-moment__scrim{position:absolute;inset:0;background:rgba(0,0,0,.55)}' +
    '.story-moment__body{position:relative;max-width:600px;margin:0 auto;padding:0 1.5rem}' +
    '.story-moment__body h3{font-size:clamp(1.6rem,4vw,2.6rem);margin:0 0 .6rem;font-weight:800}' +
    '.story-moment--noimg{min-height:auto;flex-direction:column;gap:.6rem;padding:clamp(2.5rem,6vw,4rem) 1.5rem;background:var(--color-tint,#f3f3f3);color:inherit}' +
    '.story-moment--noimg .card__icon{font-size:2rem;color:var(--color-primary,#1a7a6e)}' +
    '@media (max-width:700px){.story-hero__inner{padding:1.5rem 1.2rem}.story-about{padding:3rem 1.2rem}}';

  function injectCss() {
    if (document.getElementById("tmpl-scrollstory-css")) return;
    var style = document.createElement("style");
    style.id = "tmpl-scrollstory-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function hero(d) {
    injectCss();
    var img = d.image && d.image.src ? d.image : null;
    // MEDVITE fastheld på rå background-image her (ikkje C.coverImg()) --
    // same konvensjon som Klassisk/Panorama sin eigen hero(), og "loading=lazy"
    // (som coverImg() alltid legg på) ville vore direkte skadeleg for LCP på
    // det aller fyrste, alltid-over-brettet biletet. aria-label på seksjonen
    // gjev likevel ei tekstalternativ, sidan eit CSS-bakgrunnsbilete ikkje har
    // nokon innebygd alt-mekanisme.
    var style = img
      ? ' style="background-image:url(\'' + C.esc(img.src) + '\');background-position:' + C.esc(img.pos || "50% 50%") + '"'
      : "";
    var ariaLabel = img && img.alt ? ' aria-label="' + C.esc(img.alt) + '"' : "";
    return (
      '<section id="hjem" class="story-hero reveal' + (img ? "" : " story-hero--noimg") + '"' + style + ariaLabel + '>' +
        (img ? '<div class="story-hero__scrim"></div>' : "") +
        '<div class="story-hero__inner">' +
          '<h1 class="story-hero__title">' + C.esc(d.title) + '</h1>' +
          (d.subtitle ? '<p class="story-hero__subtitle">' + C.esc(d.subtitle) + '</p>' : "") +
          (d.ctaLabel && d.ctaTarget ? C.button({ label: d.ctaLabel, href: d.ctaTarget, variant: "primary" }) : "") +
        '</div>' +
        (img ? '<div class="story-scrollcue" aria-hidden="true"><span></span></div>' : "") +
        (img ? C.creditBadge(img) : "") +
      '</section>'
    );
  }

  function about(d) {
    injectCss();
    var hasImg = d.image && d.image.src;
    return (
      '<section id="om-oss" class="story-about reveal' + (hasImg ? "" : " story-about--noimg") + '">' +
        (hasImg ? '<div class="story-about__media">' + C.coverImg(d.image, "") + '</div><div class="story-about__scrim"></div>' : "") +
        '<div class="story-about__body">' +
          C.eyebrow(d.intro || d.heading) +
          '<h2 class="reveal">' + C.esc(d.heading) + '</h2>' +
          '<div class="prose reveal" style="transition-delay:.15s">' + C.sanitizeRichHtml(d.text) + '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function services(d) {
    injectCss();
    var intro =
      '<div class="story-services__intro">' +
        C.eyebrow(d.intro || d.heading) +
        '<h2 class="reveal">' + C.esc(d.heading) + '</h2>' +
      '</div>';
    // Kvart kort er sitt EIGE "augeblikk" i sekvensen -- fungerer best med eit
    // moderat tal kort (~3-6). Svært mange kort gjev ei ekstremt lang side,
    // same type ærlege avgrensing som Panorama sitt biletbrennpunkt-notat.
    var cards = (d.cards || []).map(function (c) {
      var hasImg = c.image && c.image.src;
      if (hasImg) {
        return (
          '<article class="story-moment reveal">' +
            '<div class="story-moment__media">' + C.coverImg(c.image, "") + '</div>' +
            '<div class="story-moment__scrim"></div>' +
            '<div class="story-moment__body">' +
              '<h3>' + C.esc(c.title) + '</h3>' +
              (c.text ? '<div class="prose">' + C.sanitizeRichHtml(c.text) + '</div>' : "") +
            '</div>' +
          '</article>'
        );
      }
      // Fallback utan bilete -- same prinsipp som Panorama sin
      // .pano-card--noimg: framleis lesbart, ikkje tomt/knust.
      return (
        '<article class="story-moment story-moment--noimg reveal">' +
          '<span class="card__icon">' + C.icon(c.icon) + '</span>' +
          '<h3 style="margin:0;font-size:1.2rem">' + C.esc(c.title) + '</h3>' +
          (c.text ? '<div class="prose" style="font-size:.9rem">' + C.sanitizeRichHtml(c.text) + '</div>' : "") +
        '</article>'
      );
    }).join("");
    return (
      '<section id="tjenester" class="story-services">' +
        intro +
        cards +
      '</section>'
    );
  }

  window.SiteTemplates = window.SiteTemplates || {};
  window.SiteTemplates.scrollstory = { id: "scrollstory", label: "Scroll-story", hero: hero, about: about, services: services };
})();
