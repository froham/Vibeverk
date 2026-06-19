<!DOCTYPE html>
<html lang="nb">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- Tittel settes av core.js fra config.company -->
  <title>Laster…</title>

  <!-- Content-Security-Policy: tillater eksplisitt alle eksterne tjenester denne
       kodebasen bruker (Google Fonts, Tabler Icons, Plausible).
       Dersom hosting-plattformen (f.eks. Cloudflare) også setter en CSP-header,
       gjelder den STRENGESTE av de to — oppdater begge steder ved behov. -->
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'self';
    script-src 'self' https://plausible.io;
    connect-src 'self' https://plausible.io;
    frame-src https://plausible.io;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net;
    font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net data:;
    img-src 'self' data: https:;
  ">

  <!-- Eneste eksterne avhengigheter: Tabler Icons (Google Fonts injiseres av core.js) -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.0.0/dist/tabler-icons.min.css">

  <!-- =========================================================================
       STRUKTURELL CSS
       -------------------------------------------------------------------------
       All visuell tilpasning skjer via CSS-variablene under, som core.js fyller
       med verdier fra config.js. Du skal aldri trenge å endre denne filen per
       kunde — bytt farger/fonter i config.js i stedet.
       ====================================================================== -->
  <style>
    :root {
      /* Fylles av core.js fra config.colors / config.fonts. Fallbacks her: */
      --color-primary:   #15616D;
      --color-secondary: #E8833A;
      --color-bg:        #FBFAF8;
      --font-display:    "Space Grotesk", system-ui, sans-serif;
      --font-body:       "Inter", system-ui, sans-serif;

      /* Utledede nyanser (kan overstyres via config.colors.text/muted/...) */
      --color-text:    #1B1B1F;
      --color-muted:   #6A6A73;
      --color-surface: #ffffff;
      --color-border:  color-mix(in srgb, var(--color-text) 12%, transparent);
      --color-alt:     color-mix(in srgb, var(--color-primary) 5%, var(--color-bg));
      --color-tint:    color-mix(in srgb, var(--color-primary) 10%, var(--color-bg));

      --maxw: 1080px;
      --radius: 14px;
      --gap: clamp(1rem, 2vw, 1.5rem);
      --section-y: clamp(3.5rem, 8vw, 7rem);
      --ease: cubic-bezier(.2, .7, .2, 1);
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      font-family: var(--font-body);
      color: var(--color-text);
      background: var(--color-bg);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3, h4 { font-family: var(--font-display); line-height: 1.1; margin: 0; }
    a { color: var(--color-primary); text-decoration: none; }
    img { max-width: 100%; display: block; }

    .container { width: 100%; max-width: var(--maxw); margin: 0 auto; padding: 0 clamp(1.1rem, 4vw, 2rem); }

    /* --- Knapper ---------------------------------------------------------- */
    .btn {
      display: inline-flex; align-items: center; gap: .5rem;
      font: inherit; font-weight: 600; cursor: pointer;
      padding: .8rem 1.4rem; border-radius: 999px; border: 1.5px solid transparent;
      transition: transform .15s var(--ease), background .2s, box-shadow .2s, opacity .2s;
      text-decoration: none; line-height: 1;
    }
    .btn:active { transform: translateY(1px); }
    .btn--primary   { background: var(--color-primary); color: #fff; }
    .btn--primary:hover { box-shadow: 0 8px 22px color-mix(in srgb, var(--color-primary) 35%, transparent); }
    .btn--secondary { background: var(--color-secondary); color: #fff; }
    .btn--secondary:hover { filter: brightness(1.05); }
    .btn--ghost     { background: transparent; color: var(--color-text); border-color: var(--color-border); }
    .btn--ghost:hover { background: var(--color-tint); }

    /* --- Header / nav ----------------------------------------------------- */
    .site-header {
      position: sticky; top: 0; z-index: 50;
      background: color-mix(in srgb, var(--color-bg) 88%, transparent);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--color-border);
    }
    .site-header__inner { display: flex; align-items: center; justify-content: space-between; height: 68px; }
    .brand { display: inline-flex; align-items: center; }
    .brand__name { font-family: var(--font-display); font-weight: 700; font-size: 1.25rem; color: var(--color-text); letter-spacing: -.01em; }
    .brand__logo { height: 42px; width: auto; }
    .nav__links { display: flex; gap: clamp(.55rem, 1.5vw, 1.4rem); overflow-x: auto; scrollbar-width: none; }
    .nav__link {
      color: var(--color-text); font-weight: 500; font-size: .98rem;
      padding: .3rem 0; position: relative; opacity: .82; transition: opacity .2s;
    }
    .nav__link:hover { opacity: 1; }
    .nav__link::after {
      content: ""; position: absolute; left: 0; bottom: -2px; height: 2px; width: 0;
      background: var(--color-primary); transition: width .25s var(--ease);
    }
    .nav__link.is-active { opacity: 1; }
    .nav__link.is-active::after { width: 100%; }
    .nav__toggle { display: none; background: none; border: 0; font-size: 1.6rem; color: var(--color-text); cursor: pointer; line-height: 1; }

    /* --- Seksjoner -------------------------------------------------------- */
    .section { padding-block: var(--section-y); background: var(--color-surface); }
    /* Forsiden: annenhver seksjon får alternerende bakgrunn automatisk */
    #main > .section:nth-child(even) { background: var(--color-alt); }
    /* Forsiden alternerer automatisk: hvit → beige → hvit → … */
    #main > .section:nth-child(even) { background: var(--color-alt); }
    .section__title { font-size: clamp(1.7rem, 4vw, 2.4rem); letter-spacing: -.02em; margin-bottom: 1.4rem; }

    /* Signaturgrep: liten aksentmarkør foran seksjonsetiketten */
    .eyebrow { display: flex; align-items: center; gap: .6rem; text-transform: uppercase; letter-spacing: .14em; font-size: .76rem; font-weight: 600; color: var(--color-muted); margin: 0 0 .8rem; }
    .eyebrow__mark { width: 22px; height: 2px; background: var(--color-secondary); display: inline-block; }

    .prose { font-size: 1.06rem; max-width: 60ch; color: color-mix(in srgb, var(--color-text) 90%, transparent); }
    .prose--muted { color: var(--color-muted); }

    /* --- Hero ------------------------------------------------------------- */
    .section--hero { position: relative; padding-top: clamp(4rem, 10vw, 8rem); background: radial-gradient(120% 90% at 80% -10%, var(--color-tint), transparent 60%); }
    .section--hero.has-image {
      background-size: cover; background-position: center; color: #fff;
      min-height: clamp(420px, 62vh, 640px); display: flex; align-items: center;
    }
    .section--hero.has-image .hero__subtitle { color: rgba(255,255,255,.88); }
    .hero { max-width: 760px; }
    .hero__title { font-size: clamp(2.3rem, 6.5vw, 4.2rem); letter-spacing: -.03em; }
    .hero__subtitle { font-size: clamp(1.05rem, 2.4vw, 1.35rem); color: var(--color-muted); margin: 1.3rem 0 2rem; max-width: 55ch; }

    /* --- Om oss ----------------------------------------------------------- */
    .about--with-media { display: grid; grid-template-columns: 1.2fr 1fr; gap: clamp(1.5rem, 5vw, 4rem); align-items: center; }
    .about__media { border-radius: var(--radius); overflow: hidden; }
    .about__img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }

    /* --- Tjenester (kort) ------------------------------------------------- */
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); grid-auto-rows: 1fr; gap: var(--gap); align-items: stretch; }
    .card {
      background: var(--color-surface); border: 1px solid var(--color-border);
      border-radius: var(--radius); overflow: hidden; height: 100%;
      display: flex; flex-direction: column;
      transition: transform .2s var(--ease), box-shadow .2s;
    }
    .card:hover { transform: translateY(-3px); box-shadow: 0 14px 30px color-mix(in srgb, var(--color-text) 8%, transparent); }
    .card__body { padding: 1.6rem; display: flex; flex-direction: column; flex: 1; }
    .card__media { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; display: block; }
    .card__icon { display: inline-grid; place-items: center; width: 46px; height: 46px; border-radius: 12px; background: var(--color-tint); color: var(--color-primary); font-size: 1.5rem; margin-bottom: 1rem; }
    .card__title { font-size: 1.2rem; margin-bottom: .4rem; }
    .card__text { color: var(--color-muted); font-size: .98rem; margin: 0; }

    /* --- Aktuelt (innlegg) ------------------------------------------------ */
    /* Status-system (Ny/Lest/Løst) */
    .stat-badge { display: inline-flex; align-items: center; font-size: .72rem; font-weight: 700; padding: .15rem .55rem; border-radius: 999px; text-transform: uppercase; letter-spacing: .03em; }
    .stat-badge--ny   { background: #fde8d7; color: #b5651d; }
    .stat-badge--lest { background: var(--color-tint); color: var(--color-primary); }
    .stat-badge--løst { background: #e3f3e8; color: #1e8449; }
    .stat-filters { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .stat-chip { font: inherit; font-size: .82rem; padding: .35rem .85rem; border-radius: 999px; border: 1.5px solid var(--color-border); background: var(--color-bg); color: var(--color-muted); cursor: pointer; transition: all .15s; }
    .stat-chip.is-on { border-color: currentColor; }
    .stat-chip--ny.is-on   { background: #fde8d7; color: #b5651d; border-color: #b5651d; }
    .stat-chip--lest.is-on { background: var(--color-tint); color: var(--color-primary); border-color: var(--color-primary); }
    .stat-chip--løst.is-on { background: #e3f3e8; color: #1e8449; border-color: #1e8449; }
    .stat-select { font: inherit; font-size: .8rem; padding: .3rem .5rem; border-radius: 8px; border: 1.5px solid var(--color-border); background: var(--color-bg); color: var(--color-text); }
    .lead-details { margin: .4rem 0; }
    .lead-details summary { cursor: pointer; font-size: .88rem; color: var(--color-muted); list-style: none; }
    .lead-details summary::-webkit-details-marker { display: none; }
    .lead-details summary::before { content: "▸ "; color: var(--color-primary); }
    .lead-details[open] summary::before { content: "▾ "; }
    .lead-details[open] summary { color: var(--color-text); font-weight: 600; }
    .crm-gdpr-box { margin-top: 1.8rem; border: 1.5px solid #e8c4c4; border-radius: var(--radius); padding: 1.2rem 1.3rem; background: #fff8f8; }
    .crm-gdpr-title { margin: 0 0 .4rem; font-size: .95rem; color: #c0392b; display: flex; align-items: center; gap: .4rem; }
    .crm-gdpr-desc { margin: 0 0 .9rem; font-size: .85rem; color: var(--color-muted); }
    /* CRM */
    .crm-stat { display: inline-flex; align-items: center; gap: .3rem; font-size: .78rem; font-weight: 600; padding: .2rem .55rem; border-radius: 999px; }
    .crm-stat--new { background: var(--color-tint); color: var(--color-primary); }
    .crm-stat--active { background: #eafaf1; color: #1e8449; }
    .crm-stat--done { background: var(--color-alt); color: var(--color-muted); }
    .crm-note { font-size: .85rem; color: var(--color-muted); font-style: italic; margin: .2rem 0 0; }
    .crm-custnum { display: inline-block; font-size: .76rem; font-weight: 600; color: var(--color-muted); background: var(--color-alt); border-radius: 999px; padding: .1rem .55rem; }
    .crm-custnum--bedrift { color: var(--color-primary); }
    .crm-history { margin: .6rem 0 0; padding: .6rem .8rem; background: var(--color-alt); border-radius: 8px; font-size: .82rem; }
    .crm-history__item { padding: .2rem 0; border-bottom: 1px solid var(--color-border); }
    .crm-history__item:last-child { border: 0; }
    /* Vilkår/personvern (delt mønster — kontakt, booking, tilbud) */
    .terms-row { display: flex; align-items: center; gap: .55rem; font-size: .9rem; margin-top: .8rem; flex-wrap: wrap; }
    .terms-link { background: none; border: 0; padding: 0; color: var(--color-primary); cursor: pointer; font: inherit; font-size: .9rem; text-decoration: underline; }
    .terms-modal-back { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 900; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .terms-modal { background: var(--color-surface); border-radius: var(--radius); max-width: 560px; width: 100%; padding: 1.6rem; max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,.18); }
    .terms-modal h3 { margin: 0 0 1rem; }
    .terms-modal-text { white-space: pre-wrap; font-size: .92rem; line-height: 1.75; color: var(--color-muted); }
    .terms-modal-close { margin-top: 1.4rem; width: 100%; }
    .nav__search { background: none; border: 0; color: var(--color-text); cursor: pointer; font-size: 1.25rem; line-height: 1; padding: .3rem; opacity: .75; transition: opacity .2s; flex-shrink: 0; }
    .nav__search:hover { opacity: 1; }
    /* Søkeoverlay */
    #search-overlay { position: fixed; inset: 0; z-index: 150; }
    .srch-back { position: absolute; inset: 0; background: rgba(0,0,0,.5); backdrop-filter: blur(4px); }
    .srch-panel { position: relative; max-width: 660px; margin: 6vh auto 0; border-radius: var(--radius); background: var(--color-bg); box-shadow: 0 24px 80px rgba(0,0,0,.3); overflow: hidden; }
    .srch-head { display: flex; align-items: center; gap: .6rem; padding: .85rem 1rem; border-bottom: 1px solid var(--color-border); }
    .srch-icon { color: var(--color-muted); font-size: 1.2rem; flex-shrink: 0; }
    .srch-input { flex: 1; font: inherit; font-size: 1.1rem; border: 0; background: transparent; color: var(--color-text); outline: none; }
    .srch-x { background: none; border: 0; cursor: pointer; color: var(--color-muted); font-size: 1.3rem; line-height: 1; }
    .srch-results { max-height: 60vh; overflow-y: auto; padding: .5rem 0; }
    .srch-empty { padding: 1.2rem 1.2rem; color: var(--color-muted); font-size: .95rem; }
    .srch-group { padding: 0 0 .5rem; }
    .srch-group__label { padding: .5rem 1.1rem .3rem; font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--color-muted); margin: 0; }
    .srch-hit { display: block; padding: .55rem 1.1rem; text-decoration: none; color: var(--color-text); transition: background .1s; }
    .srch-hit:hover { background: var(--color-tint); }
    .srch-hit__title { display: block; font-weight: 600; font-size: .95rem; }
    .srch-hit__meta { font-weight: 400; color: var(--color-muted); font-size: .82rem; margin-left: .5rem; }
    .srch-hit__text { display: block; font-size: .84rem; color: var(--color-muted); margin-top: .1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .srch-hit__text mark { background: var(--color-tint); color: var(--color-primary); border-radius: 2px; padding: 0 1px; font-style: normal; }
    @media (max-width: 700px) { .srch-panel { margin: 0; border-radius: 0; max-height: 100vh; } .srch-results { max-height: calc(100vh - 60px); } }
    .news-front { display: grid; gap: 1rem; }
    .nfc { display: grid; grid-template-columns: 220px 1fr; border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; background: var(--color-surface); color: inherit; transition: border-color .2s, transform .15s; }
    .nfc:hover { border-color: var(--color-primary); transform: translateY(-2px); }
    .nfc__img { display: block; height: 180px; overflow: hidden; flex-shrink: 0; background: var(--color-alt); }
    .nfc__img--empty { background: var(--color-alt); }
    .nfc__photo { width: 100%; height: 100%; object-fit: cover; display: block; }
    .nfc__body { padding: 1.1rem 1.3rem; display: flex; flex-direction: column; gap: .25rem; justify-content: center; }
    .nfc__title { font-size: 1.15rem; font-weight: 700; line-height: 1.3; color: var(--color-text); }
    .nfc__text { font-size: .9rem; color: var(--color-muted); line-height: 1.5; margin-top: .2rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .nfc__more { margin-top: .5rem; font-size: .88rem; font-weight: 600; color: var(--color-primary); display: inline-flex; align-items: center; gap: .3rem; }
    .nfc__more .ti { transition: transform .2s; }
    .nfc:hover .nfc__more .ti { transform: translateX(3px); }
    .news__more { margin-top: 1.2rem; }
    @media (max-width: 560px) { .nfc { grid-template-columns: 1fr; } .nfc__img { height: 140px; } }
    .post { border-left: 3px solid var(--color-tint); padding-left: 1.2rem; }
    .post__media { width: 100%; max-width: 560px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--radius); margin-bottom: .8rem; }
    .post__attachments { list-style: none; padding: 0; margin: .8rem 0 0; display: grid; gap: .4rem; max-width: 560px; }
    .post__attachments a { display: inline-flex; align-items: center; gap: .5rem; padding: .55rem .8rem; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); color: var(--color-text); font-size: .92rem; transition: border-color .2s, background .2s; }
    .post__attachments a:hover { border-color: var(--color-primary); background: var(--color-tint); }
    .post__attachments .ti { color: var(--color-primary); font-size: 1.15rem; }
    .post__att-size { color: var(--color-muted); font-size: .8rem; margin-left: auto; }
    .post__title a { color: inherit; }
    .post__title a:hover { color: var(--color-primary); }
    .post__more { display: inline-flex; align-items: center; gap: .3rem; margin-top: .6rem; font-weight: 600; font-size: .92rem; color: var(--color-primary); }
    .post__more .ti { font-size: 1rem; transition: transform .2s var(--ease); }
    .post__more:hover .ti { transform: translateX(3px); }
    .news__more { margin-top: 2rem; }

    /* Artikkelvisning (#sak/<id>) */
    .article { max-width: 760px; }
    .article__back { display: inline-flex; align-items: center; gap: .35rem; color: var(--color-muted); font-weight: 600; font-size: .9rem; margin-bottom: 1.4rem; }
    .article__back:hover { color: var(--color-primary); }
    .article__media { width: 100%; aspect-ratio: 16 / 7; object-fit: cover; border-radius: var(--radius); margin-bottom: 1.2rem; }
    .article__title { font-size: clamp(1.8rem, 4vw, 2.6rem); letter-spacing: -.02em; margin: .3rem 0 1rem; }
    .article__body { font-size: 1.08rem; }
    .article__body p { margin: 0 0 1rem; }

    /* Arkivvisning (#aktuelt/alle) */
    .archive__search { display: flex; align-items: center; gap: .5rem; border: 1.5px solid var(--color-border); border-radius: 999px; padding: .2rem .9rem; max-width: 420px; margin-bottom: 1.6rem; background: var(--color-surface); }
    .archive__search .ti { color: var(--color-muted); }
    .archive__search input { flex: 1; border: 0; background: transparent; font: inherit; padding: .6rem 0; color: var(--color-text); }
    .archive__search input:focus { outline: none; }
    .archive { list-style: none; padding: 0; margin: 0; display: grid; gap: 1rem; max-width: 720px; }
    .archive__link { display: grid; grid-template-columns: 120px 1fr; gap: 1rem; align-items: center; color: inherit; border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; background: var(--color-surface); transition: border-color .2s, transform .2s var(--ease); }
    .archive__link:hover { border-color: var(--color-primary); transform: translateY(-2px); }
    .archive__thumb { width: 120px; height: 90px; object-fit: cover; }
    .archive__thumb--blank { display: grid; place-items: center; background: var(--color-tint); color: var(--color-primary); font-size: 1.6rem; }
    .archive__meta { display: grid; gap: .15rem; padding: .6rem .9rem .6rem 0; min-width: 0; }
    .archive__title { font-family: var(--font-display); font-weight: 700; font-size: 1.1rem; }
    .archive__teaser { color: var(--color-muted); font-size: .9rem; }
    @media (max-width: 560px) {
      .archive__link { grid-template-columns: 84px 1fr; }
      .archive__thumb { width: 84px; height: 84px; }
      .archive__meta { padding: .6rem .8rem .6rem 0; }
    }
    .post__date { display: block; color: var(--color-muted); font-size: .82rem; text-transform: uppercase; letter-spacing: .08em; margin-bottom: .35rem; }
    .post__title { font-size: 1.3rem; margin-bottom: .35rem; }
    .post__text { color: color-mix(in srgb, var(--color-text) 85%, transparent); margin: 0; }

    /* --- Kontakt ---------------------------------------------------------- */
    .contact { display: grid; grid-template-columns: 1fr 1.1fr; gap: clamp(1.5rem, 5vw, 4rem); }
    .contact__list { list-style: none; padding: 0; margin: 1rem 0 0; display: grid; gap: .8rem; }
    .contact__list li { display: flex; align-items: center; gap: .7rem; color: var(--color-text); }
    .contact__list .ti { color: var(--color-primary); font-size: 1.2rem; }
    .contact__social { display: flex; gap: 1rem; margin-top: 1.2rem; }
    .contact__social a { display: inline-flex; align-items: center; gap: .4rem; color: var(--color-muted); font-size: .92rem; }
    .contact__extra { margin-top: 1.1rem; }
    .contact__extra-title { font-size: 1rem; margin-bottom: .15rem; }
    .contact__extra-text { margin: 0; color: color-mix(in srgb, var(--color-text) 85%, transparent); font-size: .95rem; white-space: pre-wrap; }
    .contact__form { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); padding: clamp(1.2rem, 3vw, 1.8rem); display: grid; gap: 1rem; }

    /* --- Skjemafelt ------------------------------------------------------- */
    .field { display: grid; gap: .35rem; }
    .field__hint { font-size: .78rem; color: var(--color-muted); margin: -.1rem 0 0; }
    .help-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: var(--color-border); color: var(--color-muted); font-size: .72rem; font-weight: 700; border: none; cursor: pointer; vertical-align: middle; margin-left: .35rem; padding: 0; line-height: 1; }
    .help-icon__pop { display: none; position: absolute; bottom: 135%; left: 50%; transform: translateX(-50%); width: 230px; background: var(--color-text); color: #fff; font-size: .78rem; font-weight: 400; line-height: 1.45; padding: .65rem .75rem; border-radius: 8px; z-index: 20; text-align: left; }
    .help-icon.is-open .help-icon__pop { display: block; }
    .field label { font-size: .85rem; font-weight: 600; color: var(--color-text); }
    .field__hint { font-weight: 400; color: var(--color-muted); font-size: .78rem; }
    .icon-field { display: flex; align-items: center; gap: .6rem; }
    .icon-field__preview { display: inline-grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; border-radius: 10px; background: var(--color-tint); color: var(--color-primary); font-size: 1.35rem; }
    .icon-field input { flex: 1; }

    /* Egendefinerte kontaktfelter i admin */
    .extra-fields { display: grid; gap: .6rem; margin-top: .3rem; }
    .extra-fields__label { font-size: .85rem; font-weight: 600; margin: .2rem 0 0; color: var(--color-text); }
    .extra-row { border: 1px solid var(--color-border); border-radius: 10px; padding: .8rem; display: grid; gap: .5rem; background: var(--color-surface); }
    .extra-row input, .extra-row textarea { font: inherit; padding: .6rem .75rem; border-radius: 8px; border: 1.5px solid var(--color-border); background: var(--color-bg); color: var(--color-text); width: 100%; resize: vertical; }
    .extra-row input:focus, .extra-row textarea:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 18%, transparent); }
    .extra-row__foot { display: flex; justify-content: flex-end; }
    .extra-row__foot .btn { padding: .45rem .85rem; font-size: .85rem; }

    /* Vedleggsliste i admin */
    .attach-field { display: grid; gap: .5rem; }
    .attach-add { justify-self: start; }
    .attach-list { list-style: none; padding: 0; margin: 0; display: grid; gap: .4rem; }
    .attach-list:empty { display: none; }
    .attach-item { display: flex; align-items: center; gap: .5rem; padding: .5rem .7rem; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); font-size: .9rem; }
    .attach-item .ti { color: var(--color-primary); }
    .attach-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .attach-size { color: var(--color-muted); font-size: .8rem; margin-left: auto; }
    .attach-item .btn { padding: .3rem .5rem; }

    /* Bildefelt i admin: hele bildet vises + flyttbart utsnitt-vindu (beskjæring) */
    .imgfield__preview { position: relative; border: 1px solid var(--color-border); border-radius: 10px; background: #15171a; overflow: hidden; aspect-ratio: 16 / 9; display: grid; place-items: center; }
    .imgfield__preview.is-set { cursor: grab; }
    .imgfield__preview.is-grabbing { cursor: grabbing; }
    .cropper__img { width: 100%; height: 100%; object-fit: cover; display: block; user-select: none; -webkit-user-drag: none; touch-action: none; }
    .cropper__window { position: absolute; box-sizing: border-box; border: 2px solid #fff; box-shadow: 0 0 0 9999px rgba(0,0,0,.5); border-radius: 2px; pointer-events: none; }
    .imgfield__empty { color: var(--color-muted); font-size: .9rem; display: inline-flex; align-items: center; gap: .4rem; }
    .imgfield__hint { margin: .4rem 0 0; font-size: .78rem; color: var(--color-muted); }
    .imgfield__controls { display: flex; gap: .5rem; margin-top: .5rem; align-items: stretch; }
    /* Bilde-merking (KI/copyright, enten/eller) + alt-tekst */
    .imgfield__alt { margin-top: .7rem; }
    .imgfield__altlabel { display: block; font-size: .82rem; color: var(--color-muted); margin-bottom: .35rem; }
    .imgfield__altinput { width: 100%; font: inherit; padding: .55rem .7rem; border-radius: 8px; border: 1.5px solid var(--color-border); background: var(--color-bg); color: var(--color-text); }
    .imgfield__credit { display: flex; flex-direction: column; gap: .5rem; margin-top: .9rem; }
    .imgfield__creditlabel { font-size: .82rem; color: var(--color-muted); margin: 0; }
    .imgfield__creditradios { display: flex; flex-wrap: wrap; gap: .9rem; }
    .imgfield__creditradios label { display: inline-flex; align-items: center; gap: .4rem; font-size: .9rem; cursor: pointer; }
    .imgfield__creditinput { font: inherit; padding: .55rem .7rem; border-radius: 8px; border: 1.5px solid var(--color-border); background: var(--color-bg); color: var(--color-text); }
    .imgfield__creditinput:disabled { opacity: .45; }
    /* Liten merke-badge ("KI"/"©") på bildet ute på siden — full merketekst vises
       kun som hover-tooltip, ikke som banner over hele bildet. */
    .has-credit { position: relative; display: block; overflow: hidden; }
    .has-credit > img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .img-credit-badge { position: absolute; right: .5rem; bottom: .5rem; font-size: .65rem; font-weight: 700; letter-spacing: .02em; color: #fff; background: rgba(0,0,0,.62); padding: .15rem .5rem; border-radius: 5px; cursor: default; }
    .contact__quote-cta { margin-top: 1.4rem; padding-top: 1.2rem; border-top: 1px solid var(--color-border); }
    .contact__quote-hint { margin: 0 0 .7rem; font-size: .92rem; color: var(--color-muted); }
    .contact__actions { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
    /* Analyse-fane */
    .an-wrap { max-width: 640px; }
    .an-heading { margin: 0 0 .8rem; font-size: 1rem; }
    .an-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: .8rem; margin-bottom: 1.6rem; }
    .an-card { border: 1px solid var(--color-border); border-radius: var(--radius); padding: 1rem 1.1rem; background: var(--color-surface); }
    .an-card__val { font-size: 2rem; font-weight: 700; line-height: 1; color: var(--color-primary); }
    .an-card__label { font-size: .85rem; color: var(--color-muted); margin: .3rem 0 .4rem; }
    .an-card__diff { font-size: .78rem; }
    .an-card__split { display: flex; gap: 1rem; }
    .an-card__split > div { flex: 1; }
    .an-card__split .an-card__val { font-size: 1.5rem; }
    .an-cat-list { display: flex; flex-wrap: wrap; gap: .5rem; margin: -.6rem 0 1.6rem; }
    .an-cat-chip { font-size: .82rem; border: 1px solid var(--color-border); border-radius: 999px; padding: .25rem .7rem; background: var(--color-surface); color: var(--color-muted); }
    .backup-summary { list-style: none; margin: 0 0 1.2rem; padding: 0; border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; }
    .backup-summary li { display: flex; justify-content: space-between; align-items: center; padding: .55rem .9rem; border-bottom: 1px solid var(--color-border); font-size: .9rem; }
    .backup-summary li:last-child { border-bottom: none; }
    .backup-summary li span { color: var(--color-muted); }
    .backup-filebtn { display: inline-flex; cursor: pointer; }
    .storage-meter { margin-bottom: .4rem; }
    .storage-meter__bar { height: 10px; border-radius: 999px; background: var(--color-border); overflow: hidden; }
    .storage-meter__fill { height: 100%; border-radius: 999px; background: var(--color-primary); transition: width .3s; }
    .storage-meter__label { font-size: .82rem; color: var(--color-muted); margin: .4rem 0 0; }
    [data-storage-level="mid"]  .storage-meter__fill { background: #d4a017; }
    [data-storage-level="high"] .storage-meter__fill { background: #c0392b; }
    .an-traffic { margin-bottom: 1rem; }
    .an-hint { color: var(--color-muted); font-size: .9rem; margin: 0 0 .7rem; }
    .an-ext-link { display: inline-flex; align-items: center; gap: .3rem; font-size: .9rem; color: var(--color-primary); margin-right: 1rem; }
    @media(max-width:560px) { .an-cards { grid-template-columns: 1fr; } }
    .imgfield__btn { white-space: nowrap; }
    .imgfield__url { flex: 1; min-width: 0; }
    .imgfield__clear { flex-shrink: 0; padding: .8rem .9rem; }
    .field input:not([type="color"]), .field textarea {
      font: inherit; padding: .7rem .85rem; border-radius: 10px;
      border: 1.5px solid var(--color-border); background: var(--color-bg); color: var(--color-text);
      width: 100%; transition: border-color .2s, box-shadow .2s; resize: vertical;
    }
    .field input:not([type="color"]):focus, .field textarea:focus {
      outline: none; border-color: var(--color-primary);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 18%, transparent);
    }
    /* Fargeveljar */
    .field input[type="color"] { width: 100%; height: 42px; padding: 3px 4px; border-radius: 10px; border: 1.5px solid var(--color-border); background: var(--color-bg); cursor: pointer; }
    .form__status { margin: 0; font-size: .9rem; min-height: 1.2em; }
    .form__status.is-ok { color: var(--color-primary); }
    .form__status.is-error { color: #c0392b; }

    /* --- Footer ----------------------------------------------------------- */
    .site-footer__meta { color: var(--color-muted); font-size: .88rem; }

    /* --- Reveal (signatur, respekterer reduced motion) -------------------- */
    .reveal { opacity: 0; transform: translateY(18px); transition: opacity .6s var(--ease), transform .6s var(--ease); }
    .reveal.is-visible { opacity: 1; transform: none; }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      .reveal { opacity: 1; transform: none; transition: none; }
    }

    /* --- Admin-panel ------------------------------------------------------ */
    .modal { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 1rem; }
    .modal__backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.45); }
    .modal__panel {
      position: relative; background: var(--color-bg); border-radius: var(--radius);
      width: min(440px, 100%); max-height: 90vh; overflow: auto;
      box-shadow: 0 30px 80px rgba(0,0,0,.3);
    }
    .modal__panel--wide  { width: min(640px,  100%); }
    .modal__panel--admin { width: min(1040px, 97vw); max-height: 92vh; }
    /* Admin: formatert meldingsvisning */
    .admin-lead-msg { border-top: 1px solid var(--color-border); margin-top: .5rem; padding-top: .5rem; max-height: 180px; overflow-y: auto; }
    /* Footer */
    /* Footer — fire seksjoner: Navn/info | Meny 1 | Meny 2 | Copyright */
    .site-footer { border-top: 1px solid var(--color-border); margin-top: 0; padding: 2rem 0; font-size: .88rem; color: var(--color-muted); }
    .site-footer__inner { display: flex; justify-content: space-between; align-items: flex-start; gap: 1.5rem; flex-wrap: wrap; }
    .site-footer__col { flex: 1 1 150px; min-width: 130px; }
    .site-footer__left { display: flex; flex-direction: column; gap: .35rem; flex: 1 1 200px; }
    .site-footer__brand { font-weight: 700; color: var(--color-text); }
    .site-footer__info { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .2rem; }
    .site-footer__info a { color: var(--color-muted); }
    .site-footer__nav ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
    .site-footer__navlink { color: var(--color-muted); font-size: .88rem; }
    .site-footer__navlink:hover { color: var(--color-primary); }
    .site-footer__copy-col { flex: 0 1 auto; text-align: right; }
    .site-footer__copy { white-space: nowrap; }
    .modal__head { display: flex; align-items: center; justify-content: space-between; padding: 1.1rem 1.4rem; border-bottom: 1px solid var(--color-border); position: sticky; top: 0; background: var(--color-bg); }
    .modal__title { font-size: 1.15rem; }
    .modal__close { background: none; border: 0; font-size: 1.3rem; cursor: pointer; color: var(--color-muted); line-height: 1; }
    .modal__body { padding: 1.4rem; }

    .tabs { display: flex; gap: .25rem; flex-wrap: wrap; border-bottom: 1px solid var(--color-border); margin-bottom: 1.2rem; }
    .admin-catbar { display: flex; gap: .4rem; flex-wrap: wrap; margin-bottom: .9rem; }
    .admin-cat { background: var(--color-bg); border: 1.5px solid var(--color-border); font: inherit; font-size: .85rem; font-weight: 600; color: var(--color-muted); padding: .45rem .9rem; border-radius: 999px; cursor: pointer; }
    .admin-cat.is-active { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
    .nav-label-input { width: 100%; min-width: 120px; border: 1px solid var(--color-border); border-radius: 6px; padding: .35rem .55rem; font: inherit; font-weight: 600; font-size: .9rem; background: var(--color-bg); color: var(--color-text); }
    .nav-label-input:focus { outline: none; border-color: var(--color-primary); }
    /* Rik tekst-felt (Aktuelt, FAQ, Referanser, Mediebank) */
    .rtfield__toolbar { display: flex; align-items: center; gap: .25rem; flex-wrap: wrap; border: 1px solid var(--color-border); border-bottom: 0; border-radius: 8px 8px 0 0; padding: .35rem .4rem; background: var(--color-alt); }
    .rtfield__toolbar button { background: none; border: 1px solid transparent; border-radius: 6px; padding: .3rem .55rem; cursor: pointer; font-size: .85rem; color: var(--color-text); line-height: 1; }
    .rtfield__toolbar button:hover { background: var(--color-bg); border-color: var(--color-border); }
    .rtfield__sep { width: 1px; height: 1.2rem; background: var(--color-border); margin: 0 .15rem; }
    .rtfield__colorlabel { display: inline-flex; align-items: center; gap: .25rem; padding: .3rem .4rem; border-radius: 6px; cursor: pointer; position: relative; }
    .rtfield__colorlabel:hover { background: var(--color-bg); }
    .rtfield__colorlabel input[type="color"] { width: 18px; height: 18px; padding: 0; border: 0; cursor: pointer; }
    .rtfield__editor { min-height: 120px; border: 1px solid var(--color-border); border-radius: 0 0 8px 8px; padding: .7rem .8rem; background: var(--color-bg); font: inherit; line-height: 1.6; }
    .rtfield__editor:focus { outline: none; border-color: var(--color-primary); }
    .rtfield__editor ul, .rtfield__editor ol { padding-left: 1.4rem; margin: .4rem 0; }
    .tab { background: none; border: 0; font: inherit; font-size: .9rem; font-weight: 600; color: var(--color-muted); padding: .5rem .65rem; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
    .tab.is-active { color: var(--color-primary); border-bottom-color: var(--color-primary); }

    .admin-form { display: grid; gap: 1rem; }
    .admin-form--card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 1.2rem; margin-top: 1rem; }
    .fontpair-row { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: .9rem; }
    .fontpair-btn { font: inherit; font-size: .82rem; padding: .4rem .8rem; border-radius: 999px; border: 1.5px solid var(--color-border); background: var(--color-bg); color: var(--color-text); cursor: pointer; }
    .fontpair-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .email-tpl-card { margin-top: 0; margin-bottom: 1.2rem; }
    .email-tpl-card summary { cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: .5rem; }
    .email-tpl-card__body { margin-top: .8rem; }
    .email-tpl-card__hint { font-size: .82rem; color: var(--color-muted); margin: 0 0 .6rem; }
    .email-tpl-card textarea { width: 100%; font: inherit; font-size: .88rem; padding: .6rem .7rem; border-radius: 8px; border: 1.5px solid var(--color-border); background: var(--color-bg); color: var(--color-text); resize: vertical; }
    .email-tpl-card__actions { display: flex; gap: .6rem; align-items: center; margin-top: .6rem; flex-wrap: wrap; }
    .admin-group { border: 1px solid var(--color-border); border-radius: 12px; padding: 1rem 1.1rem; display: grid; gap: .8rem; }
    .admin-group legend { font-family: var(--font-display); font-weight: 700; padding: 0 .4rem; }
    .admin-foot { margin-top: 1.2rem; display: flex; justify-content: space-between; align-items: center; padding-top: .8rem; border-top: 1px solid var(--color-border); }
    .admin-vibeverk { font-size: .78rem; font-style: italic; opacity: .3; cursor: default; user-select: none; transition: opacity .2s; }
    .admin-vibeverk:hover { opacity: .55; }

    .admin-list { list-style: none; padding: 0; margin: 1rem 0 0; display: grid; gap: .6rem; }
    .admin-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: .8rem 1rem; }
    .admin-row--lead { align-items: flex-start; }
    .admin-row__main { display: grid; gap: .15rem; min-width: 0; }
    .admin-row__meta { color: var(--color-muted); font-size: .8rem; }
    .admin-row__msg { margin: .3rem 0 0; color: color-mix(in srgb, var(--color-text) 85%, transparent); font-size: .92rem; white-space: pre-wrap; }
    .admin-row__actions { display: flex; gap: .4rem; flex-shrink: 0; }
    .admin-row__actions .btn { padding: .45rem .85rem; font-size: .85rem; }

    /* --- Mobil ------------------------------------------------------------ */
    @media (max-width: 760px) {
      .nav__toggle { display: block; }
      .nav__links {
        position: absolute; top: 68px; left: 0; right: 0;
        flex-direction: column; gap: 0; background: var(--color-bg);
        border-bottom: 1px solid var(--color-border);
        padding: .5rem 1.2rem 1rem; display: none;
        max-height: calc(100vh - 68px); overflow-y: auto; -webkit-overflow-scrolling: touch;
      }
      .site-header.is-open .nav__links { display: flex; }
      .nav__links .nav__link { padding: .8rem 0; border-bottom: 1px solid var(--color-border); }
      .nav__link::after { display: none; }
      .about--with-media, .contact { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <!-- Hele siden bygges inn her av core.js -->
  <div id="app"></div>
  <noscript style="display:block;padding:2rem;text-align:center;font-family:sans-serif">
    Denne siden krever JavaScript.
  </noscript>

  <!-- =========================================================================
       INNLASTING (rekkefølge er viktig)
       1) config.js      — kundedata     (window.SITE_CONFIG)
       2) components.js   — komponenter   (window.Components)
       3) core.js         — logikk/motor  (window.App)  → starter automatisk
       -------------------------------------------------------------------------
       NYE MODULER legges til HER, ETTER core.js, f.eks.:
         <script src="module-booking.js"></script>
       Modulen kaller App.registerModule({...}) og dukker opp i meny + side
       uten at noen basefil endres.
       ====================================================================== -->
  <script src="config.js"></script>
  <script src="components.js"></script>
  <script src="core.js"></script>
  <!-- Ekstra-moduler lastes her, etter core.js -->
  <script src="module-booking.js"></script>
  <script src="module-quote.js"></script>
  <script src="module-references.js"></script>
  <script src="module-faq.js"></script>
  <script src="module-crm.js"></script>
  <script src="module-mediabank.js"></script>
</body>
</html>
