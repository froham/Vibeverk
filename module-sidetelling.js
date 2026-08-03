/* =============================================================================
   module-sidetelling.js  —  INTERN, COOKIEFRI SIDETELLING (Fase 1, 2026-07-31)
   -----------------------------------------------------------------------------
   Selvstendig IIFE. Lastes etter core.js. Slås av/på med features.sidetelling,
   og kjører KUN når analytics.plausible er tom (kunden velger ett av de to,
   se adminAnalyse() i core.js).

   Scope, bevisst avgrenset (se Arkitekt-vurdering i samtale 2026-07-31):
     - Fanger: sidevisning ved sidelast/hash-endring, referrer (kun hostname),
       og klikk på telefon/e-post/kontakt/tilbud/booking-CTA.
     - Inngangs-/utgangssider krever INGEN egen fangst-hendelse -- de er
       allerede den første/siste pageview-raden for en økt, en ren spørring
       i adminpanelet (renderAdminPanel under). Ingen sendBeacon/pagehide.
     - Uttrykkelig IKKE med: unike besøkende, bot-filtrering, geolokasjon,
       enhet/nettleser/skjerm-metadata, rollup-tabell, AI-oppsummering,
       Workspace-analyse, CMS-per-side-widget. Egne, senere vurderte faser.

   Cookiefritt: sesjons-ID genereres og lagres i sessionStorage, IKKE en
   cookie -- forsvinner ved fane-lukking, sendes aldri automatisk til
   server. Personvernstekst-gren for dette ligger i core.js sin
   computeDefaultPrivacyText().
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App, C = window.Components;
  if (!App || !C) return;

  App.ready(function (CFG) {
  if (!(CFG.features && CFG.features.sidetelling === true)) return;
  var an = CFG.analytics || {};
  if (an.plausible) return; // kunden har valgt Plausible -- kjør ikke begge samtidig

  var _sb = App.supabase;
  if (!_sb) return; // krever Supabase -- ingen lokal fallback for anon-skriving

  var SESSION_KEY = "vw-sidetelling-session";

  function sessionId() {
    try {
      var id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : (String(Date.now()) + "-" + Math.random().toString(36).slice(2));
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (e) { return "no-session-storage"; }
  }

  function strippedReferrer() {
    var r = document.referrer;
    if (!r) return null;
    try { return new URL(r).hostname || null; } catch (e) { return null; }
  }

  // Fase 2 (steg 1) -- einingskategori + bot-filtrering. Begge avleia av
  // navigator.userAgent, aldri lagra rå (sjå migrasjonen sin eigen
  // kommentar for personvernsgrunngjevinga -- same mønster som
  // chat_conversations.browser/os i module-chat.js sin getBrowserInfo()).
  function detectDeviceType() {
    var w = window.innerWidth || (screen && screen.width) || 0;
    if (w < 640) return "mobil";
    if (w < 1024) return "nettbrett";
    return "pc";
  }

  // Enkel signatur-liste, ikkje ei ekstern bot-deteksjonsteneste (prinsipp
  // 2: ingen API-kall). Fangar dei store søkemotor-crawlarane og vanlege
  // SEO-/scraping-bottar -- ikkje uttømmande, og bottar som bevisst
  // forfalskar User-Agent-en sin vert ikkje fanga. Godt nok for formålet
  // (unngå at ekte crawler-trafikk feilaktig ser ut som kundetrafikk i
  // Analyse-panelet), ikkje meint som ei tryggingssperre.
  var BOT_UA_RE = /bot|crawl|spider|slurp|facebookexternalhit|googlebot|bingbot|yandex|duckduckbot|baiduspider|semrushbot|ahrefsbot|mj12bot|petalbot|headless/i;
  function detectIsBot() {
    return BOT_UA_RE.test(navigator.userAgent || "");
  }

  function currentPath() { return location.hash || "#"; }

  // Kva hash-endringar som faktisk skal telje som EI NY visning. De fleste
  // seksjonar på framsida (Om oss, Tenester osb.) er mjuk-scroll internt i
  // core.js sin bindGlobalNav() -- han bruker history.replaceState(), som
  // ALDRI utløyser 'hashchange', så desse tel aldri som noko nytt (bevisst,
  // stadfesta av brukar 2026-08-03, sjå CHANGELOG). Problemet var at NOKRE
  // seksjonar (Referansar/Aktuelt) likevel vart talde -- reint tilfeldig,
  // fordi bindGlobalNav() sin document.getElementById(id)-sjekk feila (t.d.
  // seksjonen ikkje rendra enno), og klikket då fall attende til ekte
  // nettlesar-navigering. I staden for å stole på DEN tilfeldigheita, sjekk
  // eksplisitt mot dei same unntaka bindGlobalNav() sjølv bruker (id ===
  // "admin", "sak/"-prefiks, "aktuelt/alle") pluss kjende page:true-modular.
  // NB: berre "booking" er page:true i dag (module-booking.js) -- ein
  // framtidig ny page:true-modul må leggjast til her óg, same
  // vedlikehaldskopling som bindGlobalNav() sjølv alt har.
  var REAL_PAGE_PATTERNS = [/^#booking(\/|$)/, /^#aktuelt\/alle$/, /^#sak\//];
  function isRealPage(path) {
    for (var i = 0; i < REAL_PAGE_PATTERNS.length; i++) {
      if (REAL_PAGE_PATTERNS[i].test(path)) return true;
    }
    return false;
  }

  function send(type, path, ctaId) {
    _sb.rpc("insert_analytics_event", {
      p_session_id: sessionId(),
      p_type: type,
      p_path: path,
      p_referrer: type === "pageview" ? strippedReferrer() : null,
      p_cta_id: ctaId || null,
      p_device_type: detectDeviceType(),
      p_is_bot: detectIsBot()
    }).then(function (r) {
      // Stille -- sidetelling skal aldri forstyrre besøkende med feilmeldinger.
      if (r && r.error && window.console) console.warn("Sidetelling: kunne ikke lagre hendelse", r.error);
    });
  }

  function trackPageview() { send("pageview", currentPath()); }

  var CTA_MATCHERS = [
    { id: "tel",     test: function (a) { return (a.getAttribute("href") || "").indexOf("tel:") === 0; } },
    { id: "mailto",  test: function (a) { return (a.getAttribute("href") || "").indexOf("mailto:") === 0; } },
    { id: "kontakt", test: function (a) { return a.getAttribute("href") === "#kontakt"; } },
    { id: "tilbud",  test: function (a) { return a.getAttribute("href") === "#tilbud"; } },
    { id: "booking", test: function (a) { return a.getAttribute("href") === "#booking"; } }
  ];

  function bindCtaTracking() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a");
      if (!a) return;
      for (var i = 0; i < CTA_MATCHERS.length; i++) {
        if (CTA_MATCHERS[i].test(a)) { send("cta", currentPath(), CTA_MATCHERS[i].id); return; }
      }
    });
  }

  trackPageview(); // alltid ved fyrste lasting -- dette er inngangssida, uansett hash-verdi
  window.addEventListener("hashchange", function () {
    if (isRealPage(currentPath())) trackPageview();
  });
  bindCtaTracking();

  /* =========================================================================
     ADMINPANEL — kalles fra core.js sin adminAnalyse() (Analyse-fanen), IKKE
     en egen registrert admin-fane. Eksponert på window slik konvensjonen sier
     (window.VwChatAdmin, window.CrmAdmin, ...).
     ====================================================================== */
  var DAYS_BACK = 30;
  var CTA_LABELS = { tel: "Telefon-klikk", mailto: "E-post-klikk", kontakt: "Kontakt-CTA", tilbud: "Tilbud-CTA", booking: "Booking-CTA" };

  // Lesbare namn for kjende sider/seksjonar -- viser STANDARDNAMNET, ikkje
  // eit ev. kundetilpassa seksjonsnamn (t.d. ein tilpassa FAQ-overskrift),
  // sidan adminpanelet ikkje har tilgang til dei tilpassa CMS-tekstane, berre
  // CFG. Alt anna (skreddarsydde modular, banner-/karusell-id-ar) fell tilbake
  // til ein generisk formatering under.
  var PATH_LABELS = {
    "#":            "Hjem",
    "#hjem":        "Hjem",
    "#om-oss":      "Om oss",
    "#tjenester":   "Tjenester",
    "#kontakt":     "Kontakt",
    "#referanser":  "Referanser",
    "#aktuelt":     "Aktuelt",
    "#aktuelt/alle": "Aktuelt (arkiv)",
    "#tilbud":      "Tilbud",
    "#mediabank":   "Mediebank",
    "#faq":         "Spørsmål og svar",
    "#booking":     "Booking",
    "#admin":       "Admin-innlogging"
  };
  function displayPath(path) {
    if (PATH_LABELS[path]) return PATH_LABELS[path];
    if (path.indexOf("#sak/") === 0) return "Aktuelt (enkeltsak)";
    var raw = String(path).replace(/^#/, "").replace(/[\/-]/g, " ").trim();
    if (!raw) return "Hjem";
    return raw.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // Hard tak på antall rader hentet til nettleseren -- uten dette kan et
  // uratebegrenset antall anon-innsendinger (insert_analytics_event har
  // ingen rate-limiting) i praksis gjøre adminpanelet ubrukelig (nettleseren
  // må hente og iterere hele resultatsettet ved hver åpning av Analyse-fanen).
  var MAX_ROWS = 5000;

  function fetchStats(cb) {
    var since = new Date(Date.now() - DAYS_BACK * 86400000).toISOString();
    var q = _sb.from("analytics_events").select("type,path,referrer,cta_id,session_id,device_type,created_at");
    // is_test-rader filtreres bort for ekte kunder, men MÅ vises på staging --
    // ellers viser ikke "Generer testdata"-knappen noensinne noe (den setter
    // is_test=true på alt den lager, se seed_test_pageviews.sql).
    if (!isStagingProject()) q = q.eq("is_test", false);
    // is_bot filtreres ALLTID bort, uavhengig av staging/produksjon -- dette
    // handler ikke om testdata, men om ekte robot-/crawler-trafikk som aldri
    // skal telle med i tallene en kunde faktisk ser.
    q = q.eq("is_bot", false);
    q.gte("created_at", since).order("created_at", { ascending: true }).limit(MAX_ROWS)
      .then(function (r) { cb(r.error ? null : (r.data || [])); });
  }

  function esc(s) { return C.esc(String(s == null ? "" : s)); }

  function topN(counts, n) {
    return Object.keys(counts)
      .map(function (k) { return { key: k, n: counts[k] }; })
      .sort(function (a, b) { return b.n - a.n; })
      .slice(0, n);
  }

  function toplistHtml(title, items, labelFn, hint) {
    if (!items.length) return "";
    return '<div class="an-toplist"><h5>' + esc(title) + '</h5>' +
      (hint ? '<p class="an-hint" style="margin-top:-.2rem">' + esc(hint) + '</p>' : "") +
      '<ul>' +
      items.map(function (i) {
        return '<li><span>' + esc(labelFn(i)) + '</span><strong>' + i.n + '</strong></li>';
      }).join("") +
      '</ul></div>';
  }

  // Bygger søylegrafen for "N per dag" -- delt mellom sidevisninger og
  // CTA-klikk, hver med sin egen skala (deling av samme skala ville gjort
  // CTA-søylene usynlig små, siden CTA-tall normalt er mye lavere).
  function dayBarsHtml(byDay, days) {
    if (!days.length) return { bars: "", range: "" };
    var max = Math.max.apply(null, days.map(function (d) { return byDay[d]; }).concat([1]));
    var bars = days.map(function (d) {
      var h = Math.round((byDay[d] / max) * 60) + 4;
      return '<div class="an-bar" style="height:' + h + 'px" title="' + esc(d + ": " + byDay[d]) + '"></div>';
    }).join("");
    // title-tooltip virker ikke på touch -- en synlig datoperiode under grafen
    // gir i det minste en referanse selv uten hover/mus (funn fra UX-review).
    var range = '<p class="an-hint" style="margin-top:.3rem">' + esc(days[0]) + ' – ' + esc(days[days.length - 1]) + '</p>';
    return { bars: bars, range: range };
  }

  // Fase 2 (steg 2) -- "Trendar": rein periode-mot-periode-samanlikning,
  // ingen AI/eksternt kall (same "rule-based"-filosofi som
  // computeWebsiteHealth(), sjå docs/architecture/website-health-scoring.md).
  // Talde innanfor dei siste DAYS_BACK dagane fetchStats() alt hentar --
  // TREND_PERIOD_DAYS*2 (14) er godt innanfor DAYS_BACK (30), så ingen ny
  // spørring trengst (unngår MAX_ROWS-faren ved å hente to gonger så mykje
  // data mot same tak -- Arkitekt-notat 2026-08-03).
  var TREND_PERIOD_DAYS = 7;

  function periodStats(rows) {
    var pageviews = rows.filter(function (r) { return r.type === "pageview"; });
    var ctas      = rows.filter(function (r) { return r.type === "cta"; });
    var byDay = {}, byRef = {}, byPath = {};
    pageviews.forEach(function (r) {
      var d = String(r.created_at).slice(0, 10);
      byDay[d] = (byDay[d] || 0) + 1;
      var ref = r.referrer || "Direkte";
      byRef[ref] = (byRef[ref] || 0) + 1;
      byPath[r.path] = (byPath[r.path] || 0) + 1;
    });
    return {
      pageviews: pageviews.length,
      ctas: ctas.length,
      conversionRate: pageviews.length ? (ctas.length / pageviews.length) * 100 : 0,
      byRef: byRef,
      bestDay: topN(byDay, 1)[0] || null,
      topPath: topN(byPath, 1)[0] || null
    };
  }

  // null = "ny" (kan ikkje rekne ei prosentendring frå null)
  function pctChange(now, before) {
    if (before === 0) return now === 0 ? 0 : null;
    return Math.round(((now - before) / before) * 1000) / 10;
  }

  function buildTrendsHtml(pageviews, ctas) {
    var now = Date.now(), DAY = 86400000;
    var cutThis = now - TREND_PERIOD_DAYS * DAY;
    var cutPrev = now - TREND_PERIOD_DAYS * 2 * DAY;
    function inWindow(r, from, to) { var t = new Date(r.created_at).getTime(); return t >= from && t < to; }
    var thisRows = pageviews.concat(ctas).filter(function (r) { return inWindow(r, cutThis, now); });
    var prevRows = pageviews.concat(ctas).filter(function (r) { return inWindow(r, cutPrev, cutThis); });
    var cur = periodStats(thisRows), prev = periodStats(prevRows);
    if (cur.pageviews === 0) return "";

    var items = [];
    var pvChange = pctChange(cur.pageviews, prev.pageviews);
    items.push(pvChange === null
      ? "Fyrste periode med nok data -- ingen samanligning enda."
      : (pvChange >= 0 ? "↑ " : "↓ ") + Math.abs(pvChange) + "% " + (pvChange >= 0 ? "flere" : "færre") + " sidevisninger enn de " + TREND_PERIOD_DAYS + " dagene før.");

    if (cur.bestDay) items.push("Beste dag: " + esc(cur.bestDay.key) + " (" + cur.bestDay.n + " sidevisninger).");

    if (prev.pageviews > 0) {
      var crChange = Math.round((cur.conversionRate - prev.conversionRate) * 10) / 10;
      items.push("Konverteringsrate " + (crChange >= 0 ? "opp" : "ned") + " " + Math.abs(crChange) + " prosentpoeng, nå " + (Math.round(cur.conversionRate * 10) / 10) + "%.");
    }

    var refKeys = {};
    Object.keys(cur.byRef).forEach(function (k) { refKeys[k] = true; });
    Object.keys(prev.byRef).forEach(function (k) { refKeys[k] = true; });
    var biggestRefMove = null;
    Object.keys(refKeys).forEach(function (k) {
      var delta = (cur.byRef[k] || 0) - (prev.byRef[k] || 0);
      if (!biggestRefMove || Math.abs(delta) > Math.abs(biggestRefMove.delta)) biggestRefMove = { key: k, delta: delta };
    });
    if (biggestRefMove && biggestRefMove.delta !== 0) {
      items.push((biggestRefMove.delta > 0 ? "Flere besøk kom fra " : "Færre besøk kom fra ") + esc(biggestRefMove.key) + " enn før (" + (biggestRefMove.delta > 0 ? "+" : "") + biggestRefMove.delta + ").");
    }

    if (cur.topPath && prev.topPath && displayPath(cur.topPath.key) !== displayPath(prev.topPath.key)) {
      items.push(esc(displayPath(cur.topPath.key)) + " er nå mest besøkt side (var " + esc(displayPath(prev.topPath.key)) + " forrige periode).");
    }

    return '<h5>Trender</h5>' +
      '<p class="an-hint" style="margin-top:-.2rem">Sammenligner de siste ' + TREND_PERIOD_DAYS + ' dagene mot de ' + TREND_PERIOD_DAYS + ' dagene før. Ingen AI -- bare enkel regning på tallene over.</p>' +
      '<ul style="list-style:none;padding:0;margin:0 0 1.2rem">' +
        items.map(function (t) { return '<li style="padding:.35rem 0;border-bottom:1px solid var(--color-border);font-size:.88rem">' + t + '</li>'; }).join("") +
      '</ul>';
  }

  function buildPanelHtml(rows) {
    var pageviews = rows.filter(function (r) { return r.type === "pageview"; });
    var ctas      = rows.filter(function (r) { return r.type === "cta"; });

    var byDay = {};
    pageviews.forEach(function (r) {
      var d = String(r.created_at).slice(0, 10);
      byDay[d] = (byDay[d] || 0) + 1;
    });
    var days = Object.keys(byDay).sort();
    var pageviewBars = dayBarsHtml(byDay, days);

    var byDayCta = {};
    ctas.forEach(function (r) {
      var d = String(r.created_at).slice(0, 10);
      byDayCta[d] = (byDayCta[d] || 0) + 1;
    });
    var ctaDays = Object.keys(byDayCta).sort();
    var ctaBars = dayBarsHtml(byDayCta, ctaDays);

    var byPath = {};
    pageviews.forEach(function (r) { byPath[r.path] = (byPath[r.path] || 0) + 1; });
    var topPaths = topN(byPath, 10);

    var byRef = {};
    pageviews.forEach(function (r) { var k = r.referrer || "Direkte"; byRef[k] = (byRef[k] || 0) + 1; });
    var topRefs = topN(byRef, 10);

    // "Ukjent" dekkjer rader frå før device_type-kolonnen fanst (nullable).
    var DEVICE_LABELS = { mobil: "Mobil", nettbrett: "Nettbrett", pc: "PC" };
    var byDevice = {};
    pageviews.forEach(function (r) { var k = r.device_type || "Ukjent"; byDevice[k] = (byDevice[k] || 0) + 1; });
    var topDevices = topN(byDevice, 5);

    var bySession = {};
    pageviews.forEach(function (r) {
      if (!bySession[r.session_id]) bySession[r.session_id] = [];
      bySession[r.session_id].push(r);
    });
    var entryCount = {}, exitCount = {};
    Object.keys(bySession).forEach(function (sid) {
      var list = bySession[sid].slice().sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
      entryCount[list[0].path] = (entryCount[list[0].path] || 0) + 1;
      exitCount[list[list.length - 1].path] = (exitCount[list[list.length - 1].path] || 0) + 1;
    });
    var topEntry = topN(entryCount, 5);
    var topExit  = topN(exitCount, 5);

    var byCta = {};
    ctas.forEach(function (r) { byCta[r.cta_id] = (byCta[r.cta_id] || 0) + 1; });
    var ctaCardsHtml = Object.keys(byCta).map(function (k) {
      return '<div class="an-card"><div class="an-card__val">' + byCta[k] + '</div><div class="an-card__label">' + esc(CTA_LABELS[k] || k) + '</div></div>';
    }).join("");

    var conversionRate = pageviews.length ? Math.round((ctas.length / pageviews.length) * 1000) / 10 : 0;

    return '<div class="an-sidetelling">' +
      '<div style="display:flex;justify-content:flex-end;margin-bottom:.6rem">' +
        C.button({ label: "Oppdater", variant: "ghost", attrs: 'type="button" data-sidetelling-refresh' }) +
      '</div>' +
      '<div class="an-cards">' +
        '<div class="an-card"><div class="an-card__val">' + pageviews.length + '</div><div class="an-card__label">Sidevisninger, siste ' + DAYS_BACK + ' dager</div></div>' +
        '<div class="an-card"><div class="an-card__val">' + conversionRate + '%</div><div class="an-card__label">Konverteringsrate</div></div>' +
      '</div>' +
      '<p class="an-hint" style="margin-top:-.4rem">Konverteringsrate = andel sidevisninger som endte med et CTA-klikk (telefon, e-post, kontakt, tilbud eller booking).</p>' +
      buildTrendsHtml(pageviews, ctas) +
      '<h5>Sidevisninger per dag</h5>' +
      '<div class="an-bars" aria-hidden="true">' + (pageviewBars.bars || "") + '</div>' +
      (pageviewBars.bars ? pageviewBars.range : '<p class="an-hint">Ingen data ennå.</p>') +
      (ctaBars.bars
        ? '<h5>CTA-klikk per dag</h5><div class="an-bars" aria-hidden="true">' + ctaBars.bars + '</div>' + ctaBars.range
        : "") +
      toplistHtml("Mest besøkte sider", topPaths, function (i) { return displayPath(i.key); }) +
      toplistHtml("Henvisninger", topRefs, function (i) { return i.key; }, "«Direkte» = besøkende skrev inn adressen selv, brukte et bokmerke, eller kom fra en app.") +
      toplistHtml("Enheter", topDevices, function (i) { return DEVICE_LABELS[i.key] || i.key; }, "Hva slags skjerm besøkende brukte -- mobil, nettbrett eller PC.") +
      toplistHtml("Inngangssider", topEntry, function (i) { return displayPath(i.key); }, "Siden en besøkende kom inn på nettsiden") +
      toplistHtml("Utgangssider", topExit, function (i) { return displayPath(i.key); }, "Siden en besøkende forlot nettsiden fra") +
      (ctaCardsHtml
        ? '<h5>CTA-klikk</h5><p class="an-hint" style="margin-top:-.2rem">Klikk på telefon-, e-post-, kontakt-, tilbuds- og bookingknapper.</p><div class="an-cards">' + ctaCardsHtml + '</div>'
        : "") +
      '<p style="font-size:.78rem;color:var(--color-muted);margin-top:.8rem">Analyse fra Vibeverk — cookiefritt, ingen tredjepart involvert.</p>' +
    '</div>';
  }

  // Rein kosmetisk synlighets-sjekk — den REELLE beskyttelsen mot at
  // testdata havner i et kundeprosjekt sitter server-side i
  // seed_test_pageviews() selv (is_staging-GUC + is_admin_or_owner-sjekk,
  // se supabase/staging-only/seed_test_pageviews.sql). Denne knappen skal
  // aldri være den eneste beskyttelsen.
  var STAGING_PROJECT_REF = "syqnyfeponexmkdvnsga";
  function isStagingProject() {
    var url = (CFG.supabase && CFG.supabase.url) || "";
    return url.indexOf(STAGING_PROJECT_REF) > -1;
  }

  function renderAdminPanel(container) {
    if (!container) return;
    container.innerHTML = '<p class="an-hint">Laster sidetelling…</p>';
    fetchStats(function (rows) {
      if (!container.ownerDocument || !container.ownerDocument.contains(container)) return;
      if (!rows) {
        container.innerHTML = '<p class="an-hint">Kunne ikke laste sidetelling.</p>' +
          C.button({ label: "Prøv igjen", variant: "ghost", attrs: 'type="button" data-sidetelling-retry' });
        var retryBtn = container.querySelector("[data-sidetelling-retry]");
        if (retryBtn) retryBtn.addEventListener("click", function () { renderAdminPanel(container); });
        return;
      }
      container.innerHTML = buildPanelHtml(rows) + testDataButtonHtml();
      var btn = container.querySelector("[data-sidetelling-seed]");
      if (btn) btn.addEventListener("click", function () { runSeedTestData(container, btn); });
      var refreshBtn = container.querySelector("[data-sidetelling-refresh]");
      if (refreshBtn) refreshBtn.addEventListener("click", function () { renderAdminPanel(container); });
    });
  }

  function testDataButtonHtml() {
    if (!isStagingProject()) return "";
    return '<div style="margin-top:1rem;padding-top:1rem;border-top:1px dashed var(--color-border)">' +
      C.button({ label: "Generer testdata (kun testmiljø)", variant: "ghost", attrs: 'type="button" data-sidetelling-seed' }) +
      '<p class="an-hint" style="margin-top:.4rem">Fyller sidetellingen med testdata så du kan se hvordan panelet ser ut med innhold. Vises bare fordi dette er et testmiljø, aldri hos en ekte kunde.</p>' +
    '</div>';
  }

  function runSeedTestData(container, btn) {
    btn.disabled = true;
    btn.textContent = "Genererer…";
    _sb.rpc("seed_test_pageviews", {}).then(function (r) {
      if (r.error) { window.alert("Kunne ikke generere testdata: " + (r.error.message || r.error)); btn.disabled = false; return; }
      renderAdminPanel(container);
    });
  }

  window.VwSidetelling = { renderAdminPanel: renderAdminPanel };
  });
})();
