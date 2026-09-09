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
   dagens arkitektur. Retta 2026-09-08 etter tilbakemelding om at fyrste
   versjon avvik for mykje frå mockupen: Tenester var opphavleg ein
   sjølvoppfunnen fane-veljar (ikkje i mockupen), no bytt ut med mockupen sin
   faktiske "tj-band"-stabla nummerbånd-layout. Fargane bruka òg feil/ikkje-
   eksisterande CSS-variabel (--color-accent, finst ikkje i core.js sin
   applyTheme() — retta til --color-secondary, som er den faktiske,
   kunde-konfigurerbare andrefargen).

   Bevisst UTELATE frå denne malen (finst i mockupen, men krev ny DOM-
   struktur/JS-åtferd som IKKJE kan leggjast til frå ei CSS-fil åleine --
   Referansar/Aktuelt/Quiz sin faktiske MARKUP kjem frå sine eigne delte
   modular (module-references.js/C.news()/module-quiz.js), uavhengig av kva
   designmal som er aktiv):
     - Referansar sine flip-cards (3D-vend-mekanikken sjølv, ikkje fargen)
     - Aktuelt sitt eige rutenett-oppsett
   Fargar/typografi/mørk stemning på desse ER derimot malstyrt her (sjå
   retting 2026-09-09 over) -- det er berre den interaktive STRUKTUREN som
   framleis krev ei eiga, arkitektonisk større endring (per-modul malhooks)
   for å kunne portast heilt.

   Terminal-animasjonen i heroet ER bevisst hardkoda (Vibeverk-spesifikk
   "vibeverk deploy ..."-tekst) — reint dekorativt, ingen kundedata, del av
   MALEN sin faste stil, ikkje noko ein administrator treng redigere. Same
   grunngjeving som i mockupen sin eigen historikk.

   Retta 2026-09-09 etter tilbakemelding om at malen burde vere meir
   FØRANDE for heilskapen, ikkje berre hero/om-oss/tenester:
   - "Om Vibeverk" (tre-grunnar-banda frå mockupen) fanst ikkje i den
     opphavlege versjonen, sidan det er ein HEILT EIGEN seksjon i mockupen
     (id="om", skilt frå "Bak Vibeverk"/founder-cinema), og content-modellen
     berre har éin about()-plass. Løyst ved å hardkode teksten (Vibeverk sin
     eigen, generiske verdiproposisjon -- ikkje kundedata, difor trygt å
     hardkode akkurat som terminal-sekvensane) INNI same about()-funksjonen,
     stabla over "Bak Vibeverk".
   - Oppdaga at malen sin eigen injiserte CSS FAKTISK gjeld heile sida (nav,
     søk, Kontakt, Quiz, Referansar), ikkje berre hero/om-oss/tenester --
     tidlegare fila sin eigen påstand om at desse "ikkje er mogleg å style
     per mal" var difor for bastant. Retta ved å faktisk leggje til CSS for:
     - Toppmenyen gjennomsiktig over hero, kvit tekst, solid ved scroll
       (same idé som mockupen sin `.nav.on-image`).
     - Søkje-overlayet (`.srch-*`, kjernefunksjon i core.js) mørk/cinematisk
       reskin.
     - Mørkt, utheva "kort"-utsjåande (som mockupen sin `.kontakt-form-card`)
       på Kontakt-skjemaet (`.contact__form`), Quiz-boksen (`.quiz-box`) og
       Referansar-korta (`.rf-card`) -- berre farge/typografi/bakgrunn via
       CSS mot EKSISTERANDE klassenamn, ingen ny DOM-struktur (flip-korta
       sin 3D-vend-mekanikk er framleis ikkje porta, det krev ny markup).
   - Fiksa reell midtstillings-bug: brukte hardkoda 1160px i staden for
     plattforma sin faktiske `--maxw`-breidde-variabel (1080px, brukt av
     toppmenyen), som gjorde at seksjonane mine ikkje stemte breiddemessig
     med resten av sida.

   VIKTIG oppstart-mekanisme: hero()/about()/services() returnerer berre HTML-
   strengar (ingen mount()-steg i denne malkontrakten, sjå core.js sine
   registerBuiltinSections()-kall for hjem/om-oss/tjenester -- dei sender
   berre `render`, aldri `mount`). App sin eigen render() set `main.innerHTML`
   EIN GONG PER RUTE, lenge etter at DOMContentLoaded alt har fyrt (App.init()
   sjølv ventar på asynkron henting av innhald fyrst). Eit tidlegare forsøk på
   å starte terminal-animasjonen frå eit eingongs DOMContentLoaded-kall feila
   difor stille -- elementet fanst rett og slett ikkje enno i DOM-en når koden
   køyrde. Fiksa ved å observere #main med MutationObserver og starte
   animasjonen når terminal-elementet faktisk dukkar opp (handterer òg at
   heile heltseksjonen vert bytt ut med ein FERSK DOM-node kvar gong brukaren
   navigerer attende til framsida via ankerlenker).
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
    '.vc-terminal__body .out{color:#c6cfe8;}' +
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
    '@media (prefers-reduced-motion: reduce){.vc-about__grid-bg,.vc-about__sweep{animation:none;}}' +
    '.vc-about__grid{position:relative;z-index:2;display:grid;grid-template-columns:1fr 1.1fr;gap:6vw;align-items:center;' +
      'max-width:var(--maxw,1080px);margin:0 auto;padding:12vh 6vw;}' +
    '.vc-about__grid.vc-about__grid--noimg{grid-template-columns:1fr;text-align:center;max-width:760px;}' +
    '.vc-about__photo img{width:100%;height:auto;max-height:70vh;object-fit:contain;border-radius:16px;' +
      'box-shadow:0 24px 70px rgba(0,0,0,.4);}' +
    '.vc-about__body .eyebrow{color:var(--color-secondary,#ff7a00);}' +
    '.vc-about__body h2{font-size:clamp(1.6rem,3vw,2.4rem);margin:0 0 20px;color:#fff;}' +
    '.vc-about__body .prose{color:var(--vc-deep-muted);line-height:1.7;}' +
    /* Om Vibeverk — tre grunnar, hardkoda tekst-kort (sjå VC_REASONS under) */
    '.vc-reasons{max-width:var(--maxw,1080px);margin:0 auto;padding:clamp(2.5rem,6vw,5rem) 6vw 0;}' +
    '.vc-reasons__intro{max-width:64ch;}' +
    '.vc-reasons__grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2.5rem;margin-top:2.5rem;}' +
    '.vc-reason__num{font-weight:800;font-size:1.6rem;color:var(--color-primary,#005cff);margin-bottom:.6rem;}' +
    '.vc-reason h3{font-size:1.1rem;margin:0 0 .6rem;}' +
    '.vc-reason .prose{font-size:.94rem;line-height:1.6;color:var(--color-muted,#5c6b80);}' +
    /* Tenester (services) — stabla nummerbånd, éin band per teneste (som mockupen sin tj-band) */
    '.vc-services{padding:clamp(2.5rem,6vw,5rem) 6vw;max-width:var(--maxw,1080px);margin:0 auto;}' +
    '.vc-services__intro{margin-bottom:1rem;}' +
    '.vc-services__intro h2{font-size:clamp(1.6rem,3vw,2.4rem);margin:.4rem 0 0;}' +
    '.vc-tj-band{display:grid;grid-template-columns:.5fr 1fr 1fr;gap:4vw;align-items:start;padding:6vh 0;' +
      'border-top:1px solid var(--color-border,#e2e9f5);}' +
    '.vc-tj-band:first-of-type{border-top:none;}' +
    '.vc-tj-band__num{font-weight:800;font-size:clamp(2.4rem,4vw,3.6rem);line-height:1;opacity:.7;}' +
    '.vc-tj-band h3{font-size:1.3rem;margin:0 0 12px;}' +
    '.vc-tj-band .prose{font-size:.98rem;line-height:1.65;color:var(--color-muted,#5c6b80);}' +
    /* Toppmeny gjennomsiktig over hero, kvit tekst -- solid att så snart brukaren
       scroller forbi hero (klasse `vc-on-image` sett/fjerna av scroll-lyttaren
       nedst i fila). Gjeld berre når hero-seksjonen faktisk finst i DOM-en
       (JS-en legg klassen på <body>, ikkje permanent i CSS), så andre
       sider/ruter (artikkel, arkiv, admin) er upåverka. */
    '.vc-on-image .site-header{background:transparent;box-shadow:none;transition:background .25s,box-shadow .25s;}' +
    '.vc-on-image .site-header .brand__name,.vc-on-image .site-header .nav__link,.vc-on-image .site-header .nav__search{color:#fff;}' +
    '.vc-on-image .site-header .nav__search{opacity:.85;}' +
    '.site-header{transition:background .25s,box-shadow .25s;}' +
    /* Søkje-overlay (core.js sin eigen `.srch-*`-funksjon) -- mørk/cinematisk reskin */
    '.srch-panel{background:var(--vc-deep-bg);color:#fff;}' +
    '.srch-head{border-bottom:1px solid var(--vc-deep-line);}' +
    '.srch-icon{color:var(--vc-deep-muted);}' +
    '.srch-input{color:#fff;}' +
    '.srch-input::placeholder{color:var(--vc-deep-muted);}' +
    '.srch-x{color:var(--vc-deep-muted);}' +
    '.srch-empty{color:var(--vc-deep-muted);}' +
    '.srch-group__label{color:var(--vc-deep-muted);}' +
    '.srch-hit{color:#fff;}' +
    '.srch-hit:hover{background:rgba(255,255,255,.06);}' +
    '.srch-hit__meta,.srch-hit__text{color:var(--vc-deep-muted);}' +
    '.srch-hit__text mark{background:rgba(0,92,255,.35);color:#fff;}' +
    /* Mørkt, utheva "kort"-utsjåande (som mockupen sin .kontakt-form-card) på
       Kontakt-skjema, Quiz-boks og Referansar-kort -- berre farge/typografi
       mot EKSISTERANDE klassenamn frå core.js/module-quiz.js/
       module-references.js, ingen ny DOM-struktur. */
    '.contact__form,.quiz-box,.rf-card{position:relative;background:var(--vc-deep-bg);color:#fff;' +
      'border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.22);}' +
    '.contact__form::before,.quiz-box::before,.rf-card::before{content:"";position:absolute;top:0;left:0;right:0;' +
      'height:4px;background:linear-gradient(90deg,var(--color-primary,#005cff),var(--color-secondary,#ff7a00));}' +
    '.contact__form{padding:2rem;}' +
    '.contact__form label{color:#fff;}' +
    '.contact__form .field input,.contact__form .field textarea{' +
      'background:rgba(255,255,255,.04);border:1.5px solid var(--vc-deep-line);color:#fff;}' +
    '.contact__form .field input::placeholder,.contact__form .field textarea::placeholder{color:var(--vc-deep-muted);}' +
    '.contact__form .field__hint{color:var(--vc-deep-muted);}' +
    '.quiz-box{padding:1.75rem;}' +
    '.quiz-q,.quiz-result h3{color:#fff;}' +
    '.quiz-intro{color:var(--vc-deep-muted);}' +
    '.quiz-choice{background:rgba(255,255,255,.03);border:1.5px solid var(--vc-deep-line);color:#fff;}' +
    '.quiz-choice:hover{background:rgba(255,255,255,.08);}' +
    '.rf-card__name{color:#fff;}' +
    '.rf-card__text,.rf-card__quote,.rf-card__by{color:var(--vc-deep-muted);}' +
    '.rf-card__body{padding:1.1rem 1.25rem 1.4rem;}' +
    '@media (max-width:700px){' +
      '.vc-about__grid{grid-template-columns:1fr;gap:2rem;padding:8vh 6vw;}' +
      '.vc-tj-band{grid-template-columns:1fr;gap:12px;}' +
      '.vc-reasons__grid{grid-template-columns:1fr;gap:1.75rem;}' +
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
          '<h1 class="vc-hero__title">' + C.esc(d.title) + '</h1>' +
          (d.subtitle ? '<p class="vc-hero__subtitle">' + C.esc(d.subtitle) + '</p>' : "") +
          (d.ctaLabel && d.ctaTarget ? C.button({ label: d.ctaLabel, href: d.ctaTarget, variant: "primary" }) : "") +
          '<div class="vc-terminal" id="vcTerminal">' +
            '<div class="vc-terminal__bar"><span></span><span></span><span></span></div>' +
            '<div class="vc-terminal__body" data-vc-terminal-body></div>' +
          '</div>' +
        '</div>' +
        (img ? C.creditBadge(img) : "") +
      '</section>'
    );
  }

  /* =========================================================================
     OM VIBEVERK (tre grunnar) + BAK VIBEVERK (about)
     Mockupen sitt "Om Vibeverk" (id="om") er ein HEILT EIGEN seksjon, skilt
     frå "Bak Vibeverk"/founder-cinema -- men content-modellen har berre éin
     about()-plass (id="om-oss"). Løysing: begge stablast inni same
     seksjonen. Tre-grunnar-teksten er Vibeverk sin eigen, generiske
     verdiproposisjon -- ikkje kundedata, difor trygt hardkoda her, same
     grunngjeving som terminal-sekvensane i heroet.
     ====================================================================== */
  var VC_REASONS = [
    { title: "Bygd for å tilpassast", text: "Ved å byggje på ei felles plattform med gjennomprøvde modular kan vi levere profesjonelle løysingar som samtidig vert tilpassa den enkelte verksemda — til ein fornuftig pris." },
    { title: "Kontroll, ikkje avhengigheit", text: "Løysingane har eit enkelt og brukarvennleg publiseringsverktøy, slik at du kan handtere det daglege innhaldet sjølv. Målet er å gje deg kontroll, ikkje gjere deg avhengig av kostbart etterarbeid." },
    { title: "Personvern på alvor", text: "Vi prioriterer datalagring innanfor EU og separate databasar for kvar kunde, kombinert med tydeleg tilgangsstyring og relevante sikkerheitstiltak." }
  ];
  function about(d) {
    injectCss();
    var hasImg = d.image && d.image.src;
    var photoHtml = hasImg ? '<div class="vc-about__photo reveal">' + C.coverImg(d.image, "") + '</div>' : "";
    var reasonsHtml = '<div class="vc-reasons">' +
      '<div class="vc-reasons__intro reveal">' +
        C.eyebrow("Om Vibeverk") +
        '<h2>Tre grunnar til å nytte Vibeverk.</h2>' +
        '<p class="prose">Vibeverk er ein skreddarsydd digital plattform — modulbasert og tilpassa, levert som ei personleg forvalta teneste. Vi trur på at kundane våre er unike og har stoltheit for sitt produkt og varemerke.</p>' +
      '</div>' +
      '<div class="vc-reasons__grid">' +
        VC_REASONS.map(function (r, i) {
          return '<div class="vc-reason reveal">' +
            '<div class="vc-reason__num">0' + (i + 1) + '</div>' +
            '<h3>' + C.esc(r.title) + '</h3>' +
            '<div class="prose">' + C.esc(r.text) + '</div>' +
          '</div>';
        }).join("") +
      '</div>' +
    '</div>';
    return (
      '<section id="om-oss">' +
        reasonsHtml +
        '<div class="vc-about">' +
          '<div class="vc-about__grid-bg"></div><div class="vc-about__sweep"></div>' +
          '<div class="vc-about__grid' + (hasImg ? "" : " vc-about__grid--noimg") + '">' +
            photoHtml +
            '<div class="vc-about__body reveal">' +
              C.eyebrow(d.intro || d.heading) +
              '<h2>' + C.esc(d.heading) + '</h2>' +
              '<div class="prose">' + C.sanitizeRichHtml(d.text) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  /* =========================================================================
     TENESTER (services) — stabla nummerbånd, som mockupen sin "tj-band"
     ====================================================================== */
  // Same tre fargar som mockupen (primær/sekundær/eit tredje, fast rosa-tal),
  // syklar vidare for tenester utover tre -- mockupen viste berre 3 kort, men
  // content.services sin lengde er ikkje fast i den faktiske datamodellen.
  var TJ_COLORS = ["var(--color-primary,#005cff)", "var(--color-secondary,#ff7a00)", "#ff1072"];
  function services(d) {
    injectCss();
    var cards = d.cards || [];
    var bandsHtml = cards.map(function (c, i) {
      var num = i < 9 ? "0" + (i + 1) : String(i + 1);
      return '<div class="vc-tj-band reveal">' +
        '<div class="vc-tj-band__num" style="color:' + TJ_COLORS[i % TJ_COLORS.length] + '">' + num + '</div>' +
        '<h3>' + C.esc(c.title) + '</h3>' +
        '<div class="prose">' + C.sanitizeRichHtml(c.text) + '</div>' +
      '</div>';
    }).join("");
    return (
      '<section id="tjenester" class="vc-services">' +
        '<div class="vc-services__intro reveal">' +
          C.eyebrow(d.intro || d.heading) +
          '<h2>' + C.esc(d.heading) + '</h2>' +
        '</div>' +
        bandsHtml +
      '</section>'
    );
  }

  /* =========================================================================
     ATFERD — terminal-loop (dekorativ)
     Ingen mount()-steg finst for hjem/om-oss/tjenester (sjå filoverskrifta),
     så vi kan ikkje vente på eit mount-kall frå App. I staden observerer vi
     #main med MutationObserver og startar animasjonen når
     [data-vc-terminal-body] faktisk dukkar opp i DOM-en -- fungerer likt anten
     dette er fyrste sidelasting eller brukaren navigerer attende til
     framsida seinare (som gjev ein HEILT NY DOM-node kvar gong, sidan App
     sin render() erstattar #main sitt innhald i sin heilskap per rute).
     ====================================================================== */
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

  function startTerminal(termBody) {
    if (reduceMotion) {
      termBody.innerHTML = TERMINAL_SEQUENCES[0].map(function (l) {
        return '<div class="' + l.type + '">' + C.esc(l.text) + '</div>';
      }).join("");
      return;
    }
    (function runTerminal(seqIdx) {
      if (!termBody.isConnected) return; // heltseksjonen vart bytt ut -- stopp loopen for denne noden
      var lines = TERMINAL_SEQUENCES[seqIdx];
      var lineIdx = 0, charIdx = 0;
      termBody.innerHTML = "";
      function typeNext() {
        if (!termBody.isConnected) return;
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
        if (!termBody.isConnected) return;
        var clearEl = document.createElement("div");
        clearEl.className = "prompt";
        termBody.appendChild(clearEl);
        var CLEAR_CMD = "$ clear", i = 0;
        (function typeChar() {
          if (!termBody.isConnected) return;
          i++;
          clearEl.textContent = CLEAR_CMD.slice(0, i);
          if (i < CLEAR_CMD.length) setTimeout(typeChar, 38);
          else setTimeout(function () { runTerminal((seqIdx + 1) % TERMINAL_SEQUENCES.length); }, 450);
        })();
      }
      typeNext();
    })(0);
  }

  // Gjennomsiktig-toppmeny-over-hero (`vc-on-image`-klassen på <body>, sjå
  // CSS) -- spør DOM-en på nytt kvar gong i staden for å cache ein referanse,
  // sidan heile heltseksjonen vert bytt ut med ein fersk node kvar gong
  // brukaren navigerer attende til framsida, og forsvinn heilt på andre
  // ruter (artikkel/arkiv/admin), der body difor aldri får klassen.
  function updateOnImage() {
    var hero = document.querySelector("#hjem.vc-hero");
    document.body.classList.toggle("vc-on-image", !!hero && (window.scrollY || 0) < hero.offsetHeight - 80);
  }

  // Éin felles skanning køyrer både ved kvar #main-mutasjon (nye seksjonar
  // etter rute-/innhaldsendring) OG ved kvar scroll-tick (nav-toggle) --
  // terminal-oppstart skjer berre for nye, ubundne element.
  function scanForNewElements() {
    document.querySelectorAll("[data-vc-terminal-body]:not([data-vc-bound])").forEach(function (el) {
      el.setAttribute("data-vc-bound", "1");
      startTerminal(el);
    });
    updateOnImage();
  }

  function bindObserver() {
    scanForNewElements();
    var target = document.getElementById("main") || document.body;
    new MutationObserver(scanForNewElements).observe(target, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindObserver);
  } else {
    bindObserver();
  }

  // Parallax på hero-bakgrunnen + nav-toggle ved scroll.
  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      updateOnImage();
      if (!reduceMotion) {
        var heroBg = document.getElementById("vcHeroBg");
        if (heroBg) heroBg.style.transform = "translateY(" + ((window.scrollY || 0) * 0.15) + "px)";
      }
      ticking = false;
    });
  }, { passive: true });

  window.SiteTemplates = window.SiteTemplates || {};
  window.SiteTemplates["vibeverk-cinema"] = { id: "vibeverk-cinema", label: "(Bespoke) Vibeverk — Cinematisk", hero: hero, about: about, services: services };
})();
