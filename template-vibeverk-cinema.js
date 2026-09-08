/* =============================================================================
   template-vibeverk-cinema.js — "Cinematisk" designmal (bespoke, éin tenant)
   -----------------------------------------------------------------------------
   IKKJE ein av dei tre faste, kundevalbare malane (klassisk/panorama/
   scrollstory i adminDesignMal()) — dette er ein bespoke mal for Vibeverk AS
   sin eigen nettside, tildelt via Console sitt "Design-mal (avansert)"-felt
   (get_design_template/set_design_template i broker), same mønster som
   template-vedvik-test.js viste var mogleg. IKKJE lagt til i adminDesignMal()
   sin kundevalbare liste.

   Opphav: bygd frå eit interaktivt HTML-mockup (separat side-prosjekt
   "vibeverk-template" på heimeserveren, IKKJE ein del av dette repoet) etter
   fleire tilbakemeldingsrundar med Frode. Same hero/about/services-kontrakt
   som template-klassisk.js/-panorama.js — kun desse tre er malstyrbare i
   dagens arkitektur.

   Bevisst UTELATE frå denne malen (finst i mockupen, men er IKKJE mogleg å
   style per mal i dagens kode — Referansar/Aktuelt/Quiz rendrast av sine
   eigne delte modular/komponentar (module-references.js/C.news()/
   module-quiz.js), uavhengig av kva designmal som er aktiv):
     - Referansar sine flip-cards
     - Aktuelt sitt eige rutenett
     - Quiz sin mørke kort-stil
   Desse tre seksjonane vil vise seg med plattforma sin vanlege, delte stil
   uansett kva mal som er valt. Å gjere dei malstyrbare krev ei eiga,
   arkitektonisk større endring (per-modul malhooks) — ikkje gjort her.

   Terminal-animasjonen i heroet ER bevisst hardkoda (Vibeverk-spesifikk
   "vibeverk deploy ..."-tekst) — reint dekorativt, ingen kundedata, del av
   MALEN sin faste stil, ikkje noko ein administrator treng redigere. Same
   grunngjeving som i mockupen sin eigen historikk.
   ========================================================================== */
(function () {
  "use strict";
  var C = window.Components;
  if (!C) return;

  var CSS =
    ':root{--vc-deep-bg:#0c1738;--vc-deep-surface:#131f4a;--vc-deep-line:#25316a;--vc-deep-muted:#9fb0da;}' +
    '.vc-hero{position:relative;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
      'text-align:center;color:#fff;padding:120px 6vw 60px;overflow:hidden;}' +
    '.vc-hero__visual{position:absolute;inset:0;overflow:hidden;z-index:0;}' +
    '.vc-hero__bg{position:absolute;inset:0;background-size:cover;background-position:50% 45%;' +
      'will-change:transform;transition:transform .1s linear;}' +
    '.vc-hero__bg--fallback{background:linear-gradient(160deg,var(--color-primary,#005cff),var(--vc-deep-bg));}' +
    '.vc-hero__scrim{position:absolute;inset:0;' +
      'background:radial-gradient(ellipse at center, rgba(6,12,32,.55) 0%, rgba(6,12,32,.4) 45%, rgba(6,12,32,.78) 100%);}' +
    '.vc-hero__inner{position:relative;z-index:2;max-width:900px;margin:0 auto;display:flex;flex-direction:column;align-items:center;}' +
    '.vc-hero__eyebrow{display:inline-block;font-size:12.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;' +
      'color:#fff;opacity:.75;margin-bottom:20px;}' +
    '.vc-hero__title{font-weight:800;font-size:clamp(2.4rem,6vw,4.4rem);line-height:1.05;letter-spacing:-.03em;' +
      'margin:0 0 20px;color:#fff;}' +
    '.vc-hero__subtitle{font-size:1.1rem;line-height:1.6;color:rgba(255,255,255,.85);max-width:600px;margin:0 0 34px;}' +
    '.vc-terminal{margin-top:12px;width:100%;max-width:640px;background:#0c1128;border-radius:12px;overflow:hidden;' +
      'box-shadow:0 30px 70px rgba(0,0,0,.4);font-family:"SFMono-Regular",Menlo,Consolas,monospace;text-align:left;}' +
    '.vc-terminal__bar{display:flex;align-items:center;gap:7px;padding:12px 16px;background:#161c3d;}' +
    '.vc-terminal__bar span{width:11px;height:11px;border-radius:50%;background:#3a4270;}' +
    '.vc-terminal__bar span:nth-child(1){background:#ff5f57;}' +
    '.vc-terminal__bar span:nth-child(2){background:#febc2e;}' +
    '.vc-terminal__bar span:nth-child(3){background:#28c840;}' +
    '.vc-terminal__body{padding:22px 20px;font-size:.88rem;line-height:1.9;color:#8be9c1;height:210px;overflow:hidden;}' +
    '.vc-terminal__body .prompt{color:#6c8fff;}' +
    /* Bak Vibeverk (about) — mørk sitat-/portrettseksjon */
    '.vc-about{background:var(--vc-deep-bg);color:#fff;overflow:hidden;position:relative;}' +
    '.vc-about__grid-bg{position:absolute;inset:0;z-index:0;' +
      'background-image:linear-gradient(var(--vc-deep-line) 1px, transparent 1px),' +
      'linear-gradient(90deg, var(--vc-deep-line) 1px, transparent 1px);background-size:64px 64px;opacity:.5;' +
      'animation:vc-grid-scan 60s linear infinite;}' +
    '@keyframes vc-grid-scan{0%{background-position:0 0,0 0;}100%{background-position:0 640px,640px 0;}}' +
    '.vc-about__sweep{position:absolute;inset:-20% -10%;z-index:0;pointer-events:none;' +
      'background:linear-gradient(115deg, transparent 30%, rgba(0,92,255,.25) 45%, rgba(255,122,0,.18) 52%, transparent 65%);' +
      'animation:vc-sweep-move 14s ease-in-out infinite;}' +
    '@keyframes vc-sweep-move{0%,100%{transform:translateX(-18%) translateY(-4%);}50%{transform:translateX(18%) translateY(4%);}}' +
    '.vc-about__grid{position:relative;z-index:2;display:grid;grid-template-columns:1fr 1.1fr;gap:6vw;align-items:center;' +
      'max-width:1160px;margin:0 auto;padding:12vh 6vw;}' +
    '.vc-about__grid.vc-about__grid--noimg{grid-template-columns:1fr;text-align:center;max-width:760px;}' +
    '.vc-about__photo img{width:100%;height:auto;max-height:70vh;object-fit:contain;border-radius:16px;' +
      'box-shadow:0 24px 70px rgba(0,0,0,.4);}' +
    '.vc-about__body .eyebrow{color:var(--color-accent,#ff7a00);}' +
    '.vc-about__body h2{font-size:clamp(1.6rem,3vw,2.4rem);margin:0 0 20px;color:#fff;}' +
    '.vc-about__body .prose{color:var(--vc-deep-muted);line-height:1.7;}' +
    /* Tenester (services) — interaktiv fane-veljar */
    '.vc-services{padding:clamp(2.5rem,6vw,5rem) 6vw;max-width:1160px;margin:0 auto;}' +
    '.vc-services__intro{text-align:center;margin-bottom:2.5rem;}' +
    '.vc-services__intro h2{font-size:clamp(1.6rem,3vw,2.4rem);margin:.4rem 0 0;}' +
    '.vc-tabs{display:grid;grid-template-columns:.85fr 1.15fr;gap:0;border:1px solid var(--color-border,#e2e9f5);' +
      'border-radius:14px;overflow:hidden;background:var(--color-surface,#fff);min-height:260px;}' +
    '.vc-tabs__list{display:flex;flex-direction:column;border-right:1px solid var(--color-border,#e2e9f5);}' +
    '.vc-tabs__btn{display:flex;align-items:center;gap:14px;padding:20px 22px;background:none;border:none;' +
      'border-bottom:1px solid var(--color-border,#e2e9f5);cursor:pointer;text-align:left;font:600 .96rem/1.3 inherit;' +
      'color:var(--color-muted,#5c6b80);transition:background .2s,color .2s;}' +
    '.vc-tabs__btn:last-child{border-bottom:none;}' +
    '.vc-tabs__btn .ic{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;' +
      'font-size:17px;flex:none;background:var(--color-tint,rgba(0,92,255,.08));}' +
    '.vc-tabs__btn.is-active{background:var(--color-tint,rgba(0,92,255,.06));color:var(--color-text,#142033);' +
      'box-shadow:inset 3px 0 0 var(--color-primary,#005cff);}' +
    '.vc-tabs__panel{position:relative;padding:34px 32px;}' +
    '.vc-tabs__item{display:none;}' +
    '.vc-tabs__item.is-active{display:block;}' +
    '.vc-tabs__item h3{font-size:1.2rem;margin:0 0 12px;}' +
    '.vc-tabs__item .prose{color:var(--color-muted,#5c6b80);}' +
    '@media (max-width:700px){' +
      '.vc-about__grid{grid-template-columns:1fr;gap:2rem;padding:8vh 6vw;}' +
      '.vc-tabs{grid-template-columns:1fr;}' +
      '.vc-tabs__list{flex-direction:row;overflow-x:auto;border-right:none;border-bottom:1px solid var(--color-border,#e2e9f5);}' +
      '.vc-tabs__btn{border-bottom:none;white-space:nowrap;}' +
      '.vc-tabs__btn.is-active{box-shadow:inset 0 -3px 0 var(--color-primary,#005cff);}' +
    '}';

  function injectCss() {
    if (document.getElementById("tmpl-vibeverk-cinema-css")) return;
    var style = document.createElement("style");
    style.id = "tmpl-vibeverk-cinema-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* =========================================================================
     HERO
     ====================================================================== */
  function hero(d) {
    injectCss();
    var img = d.image && d.image.src ? d.image : null;
    var bgHtml = img
      ? '<div class="vc-hero__bg" id="vcHeroBg" style="background-image:url(\'' + C.esc(img.src) + '\')"></div>'
      : '<div class="vc-hero__bg vc-hero__bg--fallback"></div>';
    return (
      '<section id="hjem" class="vc-hero reveal">' +
        '<div class="vc-hero__visual">' + bgHtml + '<div class="vc-hero__scrim"></div></div>' +
        '<div class="vc-hero__inner">' +
          '<span class="vc-hero__eyebrow">' + C.esc(d.subtitle ? "" : "") + '</span>' +
          '<h1 class="vc-hero__title">' + C.esc(d.title) + '</h1>' +
          (d.subtitle ? '<p class="vc-hero__subtitle">' + C.esc(d.subtitle) + '</p>' : "") +
          (d.ctaLabel && d.ctaTarget ? C.button({ label: d.ctaLabel, href: d.ctaTarget, variant: "primary" }) : "") +
          '<div class="vc-terminal" id="vcTerminal">' +
            '<div class="vc-terminal__bar"><span></span><span></span><span></span></div>' +
            '<div class="vc-terminal__body" id="vcTerminalBody"></div>' +
          '</div>' +
        '</div>' +
        (img ? C.creditBadge(img) : "") +
      '</section>'
    );
  }

  /* =========================================================================
     BAK VIBEVERK (about)
     ====================================================================== */
  function about(d) {
    injectCss();
    var hasImg = d.image && d.image.src;
    var photoHtml = hasImg ? '<div class="vc-about__photo reveal">' + C.coverImg(d.image, "") + '</div>' : "";
    return (
      '<section id="om-oss" class="vc-about">' +
        '<div class="vc-about__grid-bg"></div><div class="vc-about__sweep"></div>' +
        '<div class="vc-about__grid' + (hasImg ? "" : " vc-about__grid--noimg") + '">' +
          photoHtml +
          '<div class="vc-about__body reveal">' +
            C.eyebrow(d.intro || d.heading) +
            '<h2>' + C.esc(d.heading) + '</h2>' +
            '<div class="prose">' + C.sanitizeRichHtml(d.text) + '</div>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  /* =========================================================================
     TENESTER (services) — interaktiv fane-veljar
     ====================================================================== */
  function services(d) {
    injectCss();
    var cards = d.cards || [];
    var tabsHtml = cards.map(function (c, i) {
      return '<button type="button" class="vc-tabs__btn' + (i === 0 ? " is-active" : "") + '" data-vc-tab="' + i + '">' +
        '<span class="ic">' + C.icon(c.icon || "check") + '</span><span>' + C.esc(c.title) + '</span>' +
      '</button>';
    }).join("");
    var panelsHtml = cards.map(function (c, i) {
      return '<div class="vc-tabs__item' + (i === 0 ? " is-active" : "") + '" data-vc-panel="' + i + '">' +
        '<h3>' + C.esc(c.title) + '</h3>' +
        '<div class="prose">' + C.sanitizeRichHtml(c.text) + '</div>' +
      '</div>';
    }).join("");
    return (
      '<section id="tjenester" class="vc-services reveal">' +
        '<div class="vc-services__intro">' +
          C.eyebrow(d.intro || d.heading) +
          '<h2>' + C.esc(d.heading) + '</h2>' +
        '</div>' +
        (cards.length
          ? '<div class="vc-tabs" data-vc-tabs><div class="vc-tabs__list">' + tabsHtml + '</div>' +
            '<div class="vc-tabs__panel">' + panelsHtml + '</div></div>'
          : '') +
      '</section>'
    );
  }

  /* =========================================================================
     ATFERD — terminal-loop (dekorativ) + fane-veksling
     Bindast via ein delegert, dokument-global click-lyttar (registrert éin
     gong), same mønster som App sin eigen bindMainBehaviors() — sidan
     hero/about/services-funksjonane over berre returnerer HTML-strengar,
     ikkje har noko eige mount()-steg i denne malkontrakten.
     ====================================================================== */
  var boundOnce = false;
  function bindBehaviors() {
    if (boundOnce) return;
    boundOnce = true;

    document.addEventListener("click", function (e) {
      var tabBtn = e.target.closest("[data-vc-tab]");
      if (tabBtn) {
        var tabs = tabBtn.closest("[data-vc-tabs]");
        var idx = tabBtn.getAttribute("data-vc-tab");
        tabs.querySelectorAll("[data-vc-tab]").forEach(function (b) { b.classList.toggle("is-active", b === tabBtn); });
        tabs.querySelectorAll("[data-vc-panel]").forEach(function (p) {
          p.classList.toggle("is-active", p.getAttribute("data-vc-panel") === idx);
        });
      }
    });

    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var TERMINAL_SEQUENCES = [
      [
        { type: "prompt", text: "$ vibeverk deploy --tenant=di-bedrift" },
        { type: "out", text: "→ set opp heimeside, arbeidsplattform og modular …" },
        { type: "out", text: "→ eiga database, EU-lagring ✓" },
        { type: "out", text: "→ personvernstekst generert ✓" },
        { type: "out", text: "✓ live om ca. 3 veker" }
      ],
      [
        { type: "prompt", text: "$ vibeverk status --tenant=di-bedrift" },
        { type: "out", text: "→ 12 nye bookingar denne veka" },
        { type: "out", text: "→ 3 tilbod sendt automatisk" },
        { type: "out", text: "→ 0 timar brukt på manuell oppfølging" },
        { type: "out", text: "✓ alt samla på éin stad" }
      ],
      [
        { type: "prompt", text: "$ vibeverk ai --analyser drift" },
        { type: "out", text: "→ identifiserer repeterande oppgåver …" },
        { type: "out", text: "→ foreslår automatisering for fakturering og oppfølging" },
        { type: "out", text: "✓ spart tid: ca. 6 t/veke" }
      ],
      [
        { type: "prompt", text: "$ vibeverk sikkerheit --sjekk" },
        { type: "out", text: "→ eiga database per kunde ✓" },
        { type: "out", text: "→ EU-lagring stadfesta ✓" },
        { type: "out", text: "→ ingen delte data med andre kundar" },
        { type: "out", text: "✓ personvern tilpassa dykkar modular" }
      ]
    ];
    var termBody = document.getElementById("vcTerminalBody");
    if (termBody) {
      if (reduceMotion) {
        termBody.innerHTML = TERMINAL_SEQUENCES[0].map(function (l) {
          return '<div class="' + l.type + '">' + l.text + '</div>';
        }).join("");
      } else {
        (function runTerminal(seqIdx) {
          var lines = TERMINAL_SEQUENCES[seqIdx];
          var lineIdx = 0, charIdx = 0;
          termBody.innerHTML = "";
          function typeNext() {
            if (lineIdx >= lines.length) { setTimeout(typeClear, 2200); return; }
            var line = lines[lineIdx];
            var lineEl = termBody.children[lineIdx];
            if (!lineEl) { lineEl = document.createElement("div"); lineEl.className = line.type; termBody.appendChild(lineEl); }
            charIdx++;
            lineEl.textContent = line.text.slice(0, charIdx);
            if (charIdx < line.text.length) setTimeout(typeNext, line.type === "prompt" ? 38 : 16);
            else { lineIdx++; charIdx = 0; setTimeout(typeNext, 260); }
          }
          function typeClear() {
            var clearEl = document.createElement("div");
            clearEl.className = "prompt";
            termBody.appendChild(clearEl);
            var CLEAR_CMD = "$ clear", i = 0;
            (function typeChar() {
              i++;
              clearEl.textContent = CLEAR_CMD.slice(0, i);
              if (i < CLEAR_CMD.length) setTimeout(typeChar, 38);
              else setTimeout(function () { runTerminal((seqIdx + 1) % TERMINAL_SEQUENCES.length); }, 450);
            })();
          }
          typeNext();
        })(0);
      }
    }

    var heroBg = document.getElementById("vcHeroBg");
    if (heroBg && !reduceMotion) {
      var ticking = false;
      window.addEventListener("scroll", function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          var y = window.scrollY || 0;
          heroBg.style.transform = "translateY(" + (y * 0.15) + "px)";
          ticking = false;
        });
      }, { passive: true });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindBehaviors);
  } else {
    bindBehaviors();
  }

  window.SiteTemplates = window.SiteTemplates || {};
  window.SiteTemplates["vibeverk-cinema"] = { id: "vibeverk-cinema", label: "(Bespoke) Vibeverk — Cinematisk", hero: hero, about: about, services: services };
})();
