/* =============================================================================
   module-sidetelling.js  —  INTERN, COOKIEFRI SIDETELLING
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
       enhet/nettleser/skjerm-metadata utover kategori, rollup-tabell,
       AI-oppsummering, Workspace-analyse, CMS-per-side-widget, ukedag/
       tid-på-døgnet-varmekart (vurdert i mockup-runden 2026-08-03, utsatt --
       se docs/architecture/sidetelling.md). Egne, senere vurderte faser.

   Ingen nettleserlagring for sesjonsgruppering: modulen leser eller skriver
   ALDRI cookie, localStorage eller sessionStorage. Klienten sender ingen
   sesjons-ID. Edge Function-en `sidetelling-event` lager i stedet en
   server-side SHA-256-hash av UTC-dag + nettstedsdomene + request-IP +
   User-Agent ved HVER pageview/CTA-hendelse. Av requestkonteksten lagres bare
   hashverdien, sammen med selve hendelsesfeltene; dagsverdien beregnes
   deterministisk og lagres ikke i egen salttabell. Se migrasjonen, Edge-koden
   og arkitekturdokumentet.

   Innsikt-runden (2026-08-03): admin-panelet flyttet til egen "Innsikt"-
   kategori i adminpanelet (var underfane under Innstillinger), fikk et
   periodevalg (7/30/90 dager) som overordnet filter, og sub-faner
   (Oversikt/Sider/Kilder & enheter) i stedet for én lang scroll. Se
   docs/architecture/sidetelling.md for full historie/design-runde.

   UTM-sporing (2026-08-07): fanger utm_source/utm_medium/utm_campaign fra
   pageview-URLen når kunden selv har merket en utgående lenke -- ikke et
   nytt datainnsamlingsprinsipp, bare et nytt felt på samme hendelse (ingen
   API-kall, ingen ny nettleserlagring). Geolokasjon er fortsatt bevisst
   IKKE bygget (krever enten et eksternt API-kall eller lagring av IP-
   adresse -- bryter prinsipp 2/3, se docs/architecture/sidetelling.md).
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
  var sbCfg = CFG.supabase || {};
  var edgeUrl = String(sbCfg.url || "").replace(/\/+$/, "") + "/functions/v1/sidetelling-event";
  var anonKey = sbCfg.anonKey || "";
  if (!_sb || !sbCfg.url || !anonKey) return;

  function strippedReferrer() {
    var r = document.referrer;
    if (!r) return null;
    try { return new URL(r).hostname || null; } catch (e) { return null; }
  }

  // UTM-sporing: fanger kampanjemerking KUNDEN SJØLV har lagt i sine egne
  // utgående lenker (annonseplattform, e-postkampanje, QR-kode) -- ikke noe
  // om den besøkende. Rein lesing av location.search, ingen ny nettleser-
  // lagring, ingen eksternt API-kall (prinsipp 2/3 uendra). Kun på pageview,
  // aldri på cta -- same landingsside-eigenskap-logikk som strippedReferrer()
  // over, sidan intern mjuk-scroll-navigasjon aldri endrar location.search.
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"];
  function currentUtmParams() {
    var out = {};
    try {
      var params = new URLSearchParams(location.search);
      UTM_KEYS.forEach(function (k) {
        var v = params.get(k);
        out[k] = v ? v.trim().slice(0, 100) : null;
      });
    } catch (e) {
      UTM_KEYS.forEach(function (k) { out[k] = null; });
    }
    return out;
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
    if (typeof window.fetch !== "function") return;
    // Bruk medvite IKKJE Supabase-klienten sin functions.invoke() her. Han
    // hentar auth-sesjonen før kvart kall og kan dermed lese/oppdatere
    // localStorage. Direkte fetch med den offentlege anon-nøkkelen held
    // analysegrupperinga heilt fri for cookie/localStorage/sessionStorage;
    // credentials:"omit" og cache:"no-store" gjer òg transportgrensa tydeleg.
    window.fetch(edgeUrl, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: {
        "apikey": anonKey,
        "authorization": "Bearer " + anonKey,
        "content-type": "application/json"
      },
      body: JSON.stringify((function () {
        var utm = type === "pageview" ? currentUtmParams() : {};
        return {
          type: type,
          path: path,
          referrer: type === "pageview" ? strippedReferrer() : null,
          cta_id: ctaId || null,
          device_type: detectDeviceType(),
          is_bot: detectIsBot(),
          utm_source: utm.utm_source || null,
          utm_medium: utm.utm_medium || null,
          utm_campaign: utm.utm_campaign || null
        };
      })())
    }).then(function (r) {
      // Stille -- sidetelling skal aldri forstyrre besøkende med feilmeldinger.
      if (r && !r.ok && window.console) console.warn("Sidetelling: kunne ikke lagre hendelse");
    }).catch(function () {
      if (window.console) console.warn("Sidetelling: kunne ikke lagre hendelse");
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
     ADMINPANEL — kalles fra core.js sin adminAnalyse() (Innsikt-fanen), IKKE
     en egen registrert admin-fane. Eksponert på window slik konvensjonen sier
     (window.VwChatAdmin, window.CrmAdmin, ...).
     ====================================================================== */

  // Panelet henter ALLTID det maksimale, faste vinduet (90 dager) én gang --
  // periodevalget (7/30/90) under skjer så helt klientside ved å filtrere
  // de allerede hentede radene, ikke ved å spørre Supabase på nytt. Samme
  // mønster som "Trender" alt brukte for å unngå en ekstra spørring (sjå
  // kommentaren ved TREND_PERIOD_HALF under) -- generalisert til å gjelde
  // hele panelet, ikke bare trend-sammenligningen.
  var MAX_LOOKBACK_DAYS = 90;
  var PERIOD_OPTIONS = [7, 30, 90];
  var DEFAULT_PERIOD_DAYS = 30;
  // Hvor mange dager hver halvdel av "Trender"-sammenligningen dekker, per
  // valgt periode -- en fast oppslagstabell (periodene er et lukket sett på
  // tre valg, ikke en vilkårlig brukerinput), ikke en generell days/2-formel.
  // 90 dager -> daglige søyler blir 90 tynne, uleselige streker, så den
  // perioden viser ukentlige søyler i stedet (se BUCKET_MODE/barsHtml under).
  var TREND_PERIOD_HALF = { 7: 3, 30: 15, 90: 45 };
  var BUCKET_MODE = { 7: "day", 30: "day", 90: "week" };

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

  // Hard tak på antall rader hentet til nettleseren -- servervegen har no
  // eigne dags-/gruppekvotar, men klienten skal framleis aldri måtte hente og
  // iterere eit uavgrensa historisk resultatsett ved opning av Innsikt-fanen.
  // Fast uansett periodevalg -- se docs/architecture/sidetelling.md: ved
  // Vibeverk sine kunders faktiske trafikkvolum (noen hundre besøk/måned) er
  // 5000 rader trygt over selv 90 dagers volum, og en hardere grense er
  // bevisst en abuse-himmel, ikke en volumdimensjonering som bør skaleres.
  var MAX_ROWS = 5000;

  function fetchStats(cb) {
    var since = new Date(Date.now() - MAX_LOOKBACK_DAYS * 86400000).toISOString();
    var q = _sb.from("analytics_events").select("type,path,referrer,cta_id,session_id,device_type,utm_source,utm_medium,utm_campaign,created_at");
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

  // Sanntids besøkstal (2026-08-06): eiga, uavhengig kjelde frå fetchStats()
  // sin faste 90-dagars/5000-rads-henting -- dette er eit smalt, ferskt
  // spørsmål ("kor mange unike besøksgrupper hadde AKTIVITET siste 5 min"),
  // aldri ei utviding av den historiske spørringa. Ingen ny tabell, ingen ny
  // RPC -- rein klientside-telling av distinkte session_id blant nyleg
  // henta rader, same "fetch rått, aggreger i JS"-stil som resten av fila.
  var LIVE_WINDOW_MS = 5 * 60000;
  var LIVE_POLL_MS = 20000;

  function fetchLiveVisitorCount(cb) {
    var since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
    var q = _sb.from("analytics_events").select("session_id");
    if (!isStagingProject()) q = q.eq("is_test", false);
    q = q.eq("is_bot", false);
    q.gte("created_at", since).then(function (r) {
      // UX-review-funn (MEDIUM): loggar feilen, i staden for å svelgje ho
      // heilt stille -- utan dette var "lastar enno" og "har feila for godt"
      // visuelt umogleg å skilje frå kvarandre (begge synte berre "–").
      if (r.error) { console.error("[sidetelling] henting av sanntids besøkstal feila:", r.error); cb(null); return; }
      var seen = {};
      (r.data || []).forEach(function (row) { seen[row.session_id] = true; });
      cb(Object.keys(seen).length);
    });
  }

  // Éin fetch + éin DOM-oppdatering, ingen timer -- skild ut for seg sjølv
  // slik at ho kan kallast/testast direkte utan å vente på ekte forløpen tid
  // (startLiveVisitorPoll() under kallar ho med ein gong OG frå intervallet).
  function updateLiveVisitorCount(container) {
    fetchLiveVisitorCount(function (n) {
      var el = container.querySelector("[data-an-live-count]");
      if (el) el.textContent = n === null ? "–" : String(n);
    });
  }

  // Pollar kvart 20. sekund, oppdaterer BERRE tal-elementet, aldri heile
  // panelet -- heilt uavhengig av periodeval/fanebyte/"Oppdater". Sjølv-
  // reinsande om containeren forsvinn frå DOM-en (t.d. admin navigerer heilt
  // vekk frå Innsikt) -- same "sjekk DOM-tilstand i kvart tick"-idiom som
  // renderAdminPanel() sin ownerDocument.contains()-sjekk alt brukar, ingen
  // eigen livssyklus-hake i core.js trengst. container._anLiveInterval
  // ryddar opp att FØRRE intervallet ved kvar ny mounting (t.d. "Oppdater"),
  // sidan container-noden sjølv (ulikt innhaldet) lever vidare mellom dei.
  function startLiveVisitorPoll(container) {
    if (container._anLiveInterval) clearInterval(container._anLiveInterval);
    container._anLiveInterval = setInterval(function () {
      if (!container.ownerDocument || !container.ownerDocument.contains(container)) {
        clearInterval(container._anLiveInterval);
        container._anLiveInterval = null;
        return;
      }
      updateLiveVisitorCount(container);
    }, LIVE_POLL_MS);
    updateLiveVisitorCount(container); // hent med ein gong, ikkje vent 20 sekund på fyrste tal
  }

  // Fase 2 steg 3b (konverteringskobling, fetchConversions()) er FJERNA
  // (beslutningsmøte 2026-08-06, sjå docs/compliance/legal-complexity-vs-
  // value-2026-08-06.md del 5) -- kobla elles anonyme pageview-rader til ein
  // namngjeven henvendelse, eit eige GDPR-spørsmål for lita verdi. Sjå
  // core.js sin addLead()-kommentar for tilsvarande grunngjeving på
  // skrivesida. Historiske analytics_session_id-verdiar frå før denne
  // endringa kan framleis finnast i databasen, men vert ikkje lenger lest
  // eller vist her.

  function esc(s) { return C.esc(String(s == null ? "" : s)); }

  function topN(counts, n) {
    return Object.keys(counts)
      .map(function (k) { return { key: k, n: counts[k] }; })
      .sort(function (a, b) { return b.n - a.n; })
      .slice(0, n);
  }

  // rank/is-top -- første rad er tonet og markert, så øyet har noe å lande
  // på med det samme (UX-review-funn 2026-08-03: alle rader hadde tidligere
  // lik visuell vekt). Forklaringstekst går no via C.helpIcon() i staden for
  // ei fast synleg <p class="an-hint">-avsnitt -- components.js sin eigen
  // konvensjon (sjå kommentaren ved helpIcon()-definisjonen) seier
  // hand-rulla forklaringsavsnitt skal unngåast til fordel for denne.
  function toplistHtml(title, items, labelFn, hint) {
    if (!items.length) return "";
    return '<div class="an-card an-toplist"><h5>' + esc(title) + (hint ? " " + C.helpIcon(hint) : "") + '</h5>' +
      '<ul>' +
      items.map(function (i, idx) {
        return '<li class="' + (idx === 0 ? "is-top" : "") + '"><span class="an-toplist__rank">' + (idx + 1) + '</span><span>' + esc(labelFn(i)) + '</span><strong>' + i.n + '</strong></li>';
      }).join("") +
      '</ul></div>';
  }

  function sliceRowsToPeriod(rows, days) {
    var since = Date.now() - days * 86400000;
    return rows.filter(function (r) { return new Date(r.created_at).getTime() >= since; });
  }

  // ISO-uke-nøkkel (mandag i uka som dato-streng) -- brukt for 90-dagers-
  // grafene, som viser ukentlige søyler i staden for 90 tynne, uleselige
  // dagssøyler (UX-review-prioritet #3, 2026-08-03-runden). dayStr er alt
  // ein UTC-kalenderdag (same String(created_at).slice(0,10)-utleiing som
  // resten av fila brukar for dagsgruppering) -- held heile utrekninga i
  // UTC (getUTCDay/setUTCDate) i staden for lokal tid, elles kunne
  // vekemerkinga bomme med éin dag avhengig av admin sin tidssone.
  function weekKey(dayStr) {
    var d = new Date(dayStr + "T00:00:00Z");
    var isoDay = (d.getUTCDay() + 6) % 7; // 0 = mandag
    d.setUTCDate(d.getUTCDate() - isoDay);
    return d.toISOString().slice(0, 10);
  }
  function bucketKey(dayStr, mode) { return mode === "week" ? weekKey(dayStr) : dayStr; }

  // Bygger søylegrafen for "N per dag/uke" -- delt mellom sidevisninger og
  // CTA-klikk, hver med sin egen skala (deling av samme skala ville gjort
  // CTA-søylene usynlig små, siden CTA-tall normalt er mye lavere). Toppsøylen
  // merkes med tallet sitt direkte over (i staden for berre ein hover-
  // tooltip), og alle søyler har ein tap/klikk-utløyst verditooltip -- title=
  // åleine verka ikkje på touch (UX-review-funn 2026-08-03).
  function barsHtml(byBucket, buckets, mode) {
    if (!buckets.length) return { bars: "", range: "" };
    var max = Math.max.apply(null, buckets.map(function (b) { return byBucket[b]; }).concat([1]));
    var peakIdx = 0;
    buckets.forEach(function (b, i) { if (byBucket[b] > byBucket[buckets[peakIdx]]) peakIdx = i; });
    var bars = buckets.map(function (b, i) {
      var v = byBucket[b];
      var h = Math.round((v / max) * 60) + 4;
      var isPeak = i === peakIdx;
      // tabindex/role/aria-label -- ein rein <div> nådde aldri tastaturfokus
      // og verdien i .an-bar__tip (display:none utanom hover/.is-tipped) var
      // difor heilt utilgjengeleg for skjermlesar/tastatur (UX-review-funn).
      return '<div class="an-bar' + (isPeak ? " is-peak" : "") + '" style="height:' + h + 'px" data-val="' + v + '" tabindex="0" role="img" aria-label="' + esc(b) + ': ' + v + '">' +
        (isPeak ? '<span class="an-bar__peak">' + v + '</span>' : "") +
        '<span class="an-bar__tip">' + esc(b) + ': ' + v + '</span>' +
      '</div>';
    }).join("");
    var unitLabel = mode === "week" ? "per uke" : "per dag";
    var range = '<p class="an-hint" style="margin-top:.3rem">' + esc(buckets[0]) + ' – ' + esc(buckets[buckets.length - 1]) + ' (' + unitLabel + ') · tips/klikk en søyle for tall</p>';
    return { bars: bars, range: range };
  }

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

  // Trend-vinduet er no "andre halvdel av valgt periode mot første halvdel"
  // (generalisert frå den tidlegare faste "siste 7 mot føregåande 7 dagar",
  // sjå TREND_PERIOD_HALF). Opererer på dei FULLE, uslissa radene (opptil 90
  // dagar) sidan halvparten for periode=90 (45) krev historikk lenger tilbake
  // enn dei 7/30 dagane som eventuelt er valde for visinga elles -- akkurat
  // difor hentar fetchStats() alltid heile 90-dagarsvindauget på førehand.
  function buildTrendsHtml(allRows, days) {
    var half = TREND_PERIOD_HALF[days];
    var now = Date.now(), DAY = 86400000;
    var cutThis = now - half * DAY;
    var cutPrev = now - half * 2 * DAY;
    function inWindow(r, from, to) { var t = new Date(r.created_at).getTime(); return t >= from && t < to; }
    var thisRows = allRows.filter(function (r) { return inWindow(r, cutThis, now); });
    var prevRows = allRows.filter(function (r) { return inWindow(r, cutPrev, cutThis); });
    var cur = periodStats(thisRows), prev = periodStats(prevRows);
    if (cur.pageviews === 0) return "";

    var items = [];
    var pvChange = pctChange(cur.pageviews, prev.pageviews);
    items.push(pvChange === null
      ? "Første halvdel av perioden med nok data -- ingen sammenligning ennå."
      : (pvChange >= 0 ? "↑ " : "↓ ") + Math.abs(pvChange) + "% " + (pvChange >= 0 ? "flere" : "færre") + " sidevisninger enn de " + half + " dagene før.");

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

    return '<div class="an-card" style="margin-bottom:1.2rem">' +
      '<h5>Trender ' + C.helpIcon("Sammenligner andre halvdel av valgt periode mot første halvdel. Ingen KI -- bare enkel regning på tallene over.") + '</h5>' +
      '<ul style="list-style:none;padding:0;margin:0">' +
        items.map(function (t) { return '<li style="padding:.35rem 0;border-bottom:1px solid var(--color-border);font-size:.88rem">' + t + '</li>'; }).join("") +
      '</ul></div>';
  }

  /* --- Oversikt-fane -------------------------------------------------------- */
  function renderOversiktPane(rows, days) {
    var pageviews = rows.filter(function (r) { return r.type === "pageview"; });
    var ctas      = rows.filter(function (r) { return r.type === "cta"; });

    var bySession = {};
    pageviews.forEach(function (r) {
      if (!bySession[r.session_id]) bySession[r.session_id] = [];
      bySession[r.session_id].push(r);
    });
    var sessionIds = Object.keys(bySession);
    var bounceSessions = sessionIds.filter(function (sid) { return bySession[sid].length === 1; }).length;
    var bounceRate = sessionIds.length ? Math.round((bounceSessions / sessionIds.length) * 100) : 0;
    var avgPagesPerSession = sessionIds.length ? Math.round((pageviews.length / sessionIds.length) * 10) / 10 : 0;
    var conversionRate = pageviews.length ? Math.round((ctas.length / pageviews.length) * 1000) / 10 : 0;

    var mode = BUCKET_MODE[days];
    var byBucketPv = {};
    pageviews.forEach(function (r) {
      var b = bucketKey(String(r.created_at).slice(0, 10), mode);
      byBucketPv[b] = (byBucketPv[b] || 0) + 1;
    });
    var pvBuckets = Object.keys(byBucketPv).sort();
    var pvBars = barsHtml(byBucketPv, pvBuckets, mode);

    var byBucketCta = {};
    ctas.forEach(function (r) {
      var b = bucketKey(String(r.created_at).slice(0, 10), mode);
      byBucketCta[b] = (byBucketCta[b] || 0) + 1;
    });
    var ctaBuckets = Object.keys(byBucketCta).sort();
    var ctaBars = barsHtml(byBucketCta, ctaBuckets, mode);

    return '<div class="an-cards">' +
        '<div class="an-card an-card--live"><div class="an-card__val" data-an-live-count role="status" aria-live="polite">–</div><div class="an-card__label">Besøkende akkurat nå ' + C.helpIcon("Antall unike besøksgrupper med aktivitet de siste 5 minuttene. Oppdateres automatisk hvert 20. sekund.") + '</div></div>' +
        '<div class="an-card"><div class="an-card__val">' + pageviews.length + '</div><div class="an-card__label">Sidevisninger</div></div>' +
        '<div class="an-card"><div class="an-card__val">' + conversionRate + '%</div><div class="an-card__label">Konverteringsrate</div></div>' +
        '<div class="an-card"><div class="an-card__val">' + bounceRate + '%</div><div class="an-card__label">Anslått avvisningsrate ' + C.helpIcon("Anslag basert på sidevisninger som ser ut til å komme fra samme besøkende samme dag. Delte nettverk og flere besøk samme dag kan påvirke tallet.") + '</div></div>' +
        '<div class="an-card"><div class="an-card__val">' + avgPagesPerSession + '</div><div class="an-card__label">Anslåtte sider per besøk ' + C.helpIcon("Anslag basert på sider som ser ut til å bli sett av samme besøkende samme dag. Flere separate besøk samme dag kan bli gruppert sammen.") + '</div></div>' +
      '</div>' +
      buildTrendsHtml(rows, days) +
      '<h4 class="an-heading">Trafikk ' + (mode === "week" ? "per uke" : "per dag") + '</h4>' +
      '<div class="an-chart-row">' +
        '<div class="an-card"><h5>Sidevisninger</h5><div class="an-bars">' + (pvBars.bars || "") + '</div>' +
          (pvBars.bars ? pvBars.range : '<p class="an-hint">Ingen data ennå.</p>') + '</div>' +
        (ctaBars.bars
          ? '<div class="an-card"><h5>CTA-klikk</h5><div class="an-bars">' + ctaBars.bars + '</div>' + ctaBars.range + '</div>'
          : "") +
      '</div>';
  }

  /* --- Sider-fane ------------------------------------------------------------ */
  function renderSiderPane(rows, days) {
    var pageviews = rows.filter(function (r) { return r.type === "pageview"; });
    var ctas      = rows.filter(function (r) { return r.type === "cta"; });

    var byPath = {};
    pageviews.forEach(function (r) { byPath[r.path] = (byPath[r.path] || 0) + 1; });
    var topPaths = topN(byPath, 10);

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
    var ctaChipsHtml = Object.keys(byCta).length
      ? '<div class="an-cta-chips">' + Object.keys(byCta).map(function (k) {
          return '<span class="an-cta-chip">' + esc(CTA_LABELS[k] || k) + ' <strong>' + byCta[k] + '</strong></span>';
        }).join("") + '</div>'
      : '<p class="an-hint">Ingen CTA-klikk i valgt periode.</p>';

    return '<h4 class="an-heading">Sidebruk</h4>' +
      '<div class="an-list-grid">' +
        toplistHtml("Mest besøkte sider", topPaths, function (i) { return displayPath(i.key); }) +
        toplistHtml("Inngangssider", topEntry, function (i) { return displayPath(i.key); }, "Første registrerte side i hver daglige besøksgruppe") +
        toplistHtml("Utgangssider", topExit, function (i) { return displayPath(i.key); }, "Siste registrerte side i hver daglige besøksgruppe") +
      '</div>' +
      '<h4 class="an-heading">CTA-klikk etter type</h4>' +
      ctaChipsHtml;
  }

  /* --- Kilder & enheter-fane ------------------------------------------------- */
  function renderKilderPane(rows) {
    var pageviews = rows.filter(function (r) { return r.type === "pageview"; });

    var byRef = {};
    pageviews.forEach(function (r) { var k = r.referrer || "Direkte"; byRef[k] = (byRef[k] || 0) + 1; });
    var topRefs = topN(byRef, 10);

    // Kampanjekilder (UTM): berre besøk frå ei lenke kunden sjølv har merka.
    // Bevisst eigne kort, ikkje slått saman med Henvisningar over -- dei
    // svarer på ulike spørsmål (sjå helpIcon-teksten under) og eit besøk kan
    // ha begge, ingen av dei, eller berre det eine.
    var byUtmSource = {}, byUtmCampaign = {};
    pageviews.forEach(function (r) {
      if (r.utm_source) byUtmSource[r.utm_source] = (byUtmSource[r.utm_source] || 0) + 1;
      if (r.utm_campaign) byUtmCampaign[r.utm_campaign] = (byUtmCampaign[r.utm_campaign] || 0) + 1;
    });
    var topUtmSources = topN(byUtmSource, 10);
    var topUtmCampaigns = topN(byUtmCampaign, 10);
    // UX-review-funn (MEDIUM, 2026-08-07): dei to korta hadde tidlegare
    // identisk hjelpetekst, som forklarte UTM generelt men aldri kva som
    // faktisk skil dei to listene frå kvarandre. Éin delt setning (kva UTM
    // er, skilnaden frå Henvisningar) pluss éi eiga, kort avsluttande setning
    // per kort (kva ordet sjølv betyr).
    var utmHintShared = "Vises bare for besøk som kom fra en lenke du selv har merket med en kampanjekode (ofte kalt UTM). Dette er noe annet enn «Henvisninger», som viser hvilken nettside besøkende faktisk kom fra -- noen besøk har begge, de fleste har bare det ene. ";
    var utmHtml = (topUtmSources.length || topUtmCampaigns.length)
      ? toplistHtml("Kampanjekilder", topUtmSources, function (i) { return i.key; }, utmHintShared + "Kilden er ofte plattformen lenken kom fra, som «google» eller «facebook».") +
        toplistHtml("Kampanjer", topUtmCampaigns, function (i) { return i.key; }, utmHintShared + "Kampanjenavnet er det du selv valgte da du laget lenken.")
      : "";

    // "Ukjent" dekkjer rader frå før device_type-kolonnen fanst (nullable).
    var DEVICE_LABELS = { mobil: "Mobil", nettbrett: "Nettbrett", pc: "PC" };
    var byDevice = {};
    pageviews.forEach(function (r) { var k = r.device_type || "Ukjent"; byDevice[k] = (byDevice[k] || 0) + 1; });
    var total = pageviews.length || 1;
    var deviceOrder = ["mobil", "pc", "nettbrett"].filter(function (k) { return byDevice[k]; })
      .concat(Object.keys(byDevice).filter(function (k) { return ["mobil", "pc", "nettbrett"].indexOf(k) === -1; }));
    var shades = ["var(--color-primary)", "color-mix(in srgb, var(--color-primary) 55%, var(--color-bg))", "color-mix(in srgb, var(--color-primary) 25%, var(--color-bg))"];
    var deviceBarHtml = deviceOrder.length
      ? '<div class="an-device-bar">' + deviceOrder.map(function (k, i) {
          var pct = Math.round((byDevice[k] / total) * 100);
          return '<span style="width:' + pct + '%;background:' + (shades[i] || shades[shades.length - 1]) + '">' + (pct >= 8 ? pct + "%" : "") + '</span>';
        }).join("") + '</div>' +
        '<div class="an-device-legend">' + deviceOrder.map(function (k, i) {
          return '<span class="an-device-legend__item"><span class="an-device-legend__sw" style="background:' + (shades[i] || shades[shades.length - 1]) + '"></span>' + esc(DEVICE_LABELS[k] || k) + ' (' + byDevice[k] + ')</span>';
        }).join("") + '</div>'
      : '<p class="an-hint">Ingen data ennå.</p>';

    return '<h4 class="an-heading">Henvisninger og enheter</h4>' +
      '<div class="an-list-grid">' +
        toplistHtml("Henvisninger", topRefs, function (i) { return i.key; }, "«Direkte» = besøkende skrev inn adressen selv, brukte et bokmerke, eller kom fra en app.") +
        '<div class="an-card"><h5>Enheter</h5>' + deviceBarHtml + '</div>' +
        utmHtml +
      '</div>';
  }

  /* --- Panel-skjelett, periodevalg og sub-faner ------------------------------ */
  function shellHtml(days) {
    return '<div class="an-sidetelling">' +
      '<div style="display:flex;justify-content:flex-end;margin-bottom:.6rem">' +
        C.button({ label: "Oppdater", variant: "ghost", attrs: 'type="button" data-sidetelling-refresh' }) +
      '</div>' +
      '<div class="an-period">' +
        '<span class="an-period__lbl">Periode</span>' +
        '<div class="an-period__seg" data-an-period-seg>' +
          PERIOD_OPTIONS.map(function (d) {
            return '<button type="button" class="' + (d === days ? "is-active" : "") + '" data-an-days="' + d + '">' + d + ' dager</button>';
          }).join("") +
        '</div>' +
      '</div>' +
      '<div class="an-subtabs" role="tablist">' +
        '<button type="button" class="an-subtab is-active" role="tab" aria-selected="true" aria-controls="an-pane-oversikt" data-an-tab="oversikt">Oversikt</button>' +
        '<button type="button" class="an-subtab" role="tab" aria-selected="false" aria-controls="an-pane-sider" data-an-tab="sider">Sider</button>' +
        '<button type="button" class="an-subtab" role="tab" aria-selected="false" aria-controls="an-pane-kilder" data-an-tab="kilder">Kilder &amp; enheter</button>' +
      '</div>' +
      '<div class="an-pane is-active" role="tabpanel" id="an-pane-oversikt" data-an-pane="oversikt"></div>' +
      '<div class="an-pane" role="tabpanel" id="an-pane-sider" data-an-pane="sider"></div>' +
      '<div class="an-pane" role="tabpanel" id="an-pane-kilder" data-an-pane="kilder"></div>' +
      '<p style="font-size:.78rem;color:var(--color-muted);margin-top:.8rem">Analyse fra Vibeverk — ingen cookies eller nettleserlagring for besøksgruppering, og ingen separat analyseleverandør. Hendelser lagres i nettsidens Supabase-database. Besøksbaserte tall er daglige anslag.</p>' +
    '</div>';
  }

  function renderPanes(container, rows, days) {
    var sliced = sliceRowsToPeriod(rows, days);
    container.querySelector('[data-an-pane="oversikt"]').innerHTML = renderOversiktPane(sliced, days);
    container.querySelector('[data-an-pane="sider"]').innerHTML = renderSiderPane(sliced, days);
    container.querySelector('[data-an-pane="kilder"]').innerHTML = renderKilderPane(sliced);
  }

  function mountPanel(container, rows) {
    var state = { days: DEFAULT_PERIOD_DAYS };
    container.innerHTML = shellHtml(state.days) + testDataButtonHtml();
    renderPanes(container, rows, state.days);
    bindPanel(container, rows, state);
    bindBarTooltips(container);
    startLiveVisitorPoll(container);
    var seedBtn = container.querySelector("[data-sidetelling-seed]");
    if (seedBtn) seedBtn.addEventListener("click", function () { runSeedTestData(container, seedBtn); });
  }

  // Tap/klikk/tastatur-tooltip på søylene (title= virker ikke på touch,
  // UX-review-funn 2026-08-03) -- delegert på CONTAINEREN (ikkje per søyle,
  // sidan søylene rendrast på nytt ved kvart periodeval). container-noden
  // sjølv vert ALDRI erstatta av "Oppdater" (kun container.innerHTML), så
  // dette må bindast KUN ÉIN GONG per container -- elles hopar det seg opp
  // éin ny delegert click-lyttar for kvart "Oppdater"-klikk (reell, funne
  // lekkasje, UX-review 2026-08-03). Bunde i mountPanel(), ikkje bindPanel()
  // (som køyrer på nytt ved kvar "Oppdater"), og verna med eit flagg.
  function bindBarTooltips(container) {
    if (container._anBarsBound) return;
    container._anBarsBound = true;
    function toggle(bar) {
      var wasOpen = bar.classList.contains("is-tipped");
      container.querySelectorAll(".an-bar.is-tipped").forEach(function (b) { b.classList.remove("is-tipped"); });
      if (!wasOpen) bar.classList.add("is-tipped");
    }
    container.addEventListener("click", function (e) {
      var bar = e.target.closest && e.target.closest(".an-bar");
      if (bar) toggle(bar);
    });
    // Enter/mellomrom -- søylene har tabindex="0"/role="img" (sjå barsHtml()),
    // men var elles berre nåbare med mus/touch (UX-review-funn).
    container.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      var bar = e.target.closest && e.target.closest(".an-bar");
      if (!bar) return;
      e.preventDefault();
      toggle(bar);
    });
  }

  function bindPanel(container, rows, state) {
    // Sub-faner (Oversikt/Sider/Kilder & enheter) -- egen attributt/klasse,
    // IKKE C.tabbar()/.tab: en tablist nøstet inne i den øverste admin-
    // fanens .tab/.tabbar ville både kollidert med test.js sine
    // .tab/[data-tab]-spørringer og vore eit ARIA-antimønster (tablist i
    // tablist). Bundet lokalt her, same mønster som modulen alt bruker for
    // oppdater-/prøv igjen-knappane sine. Desse knappane er ferske DOM-
    // element ved kvar mountPanel()-køyring (shellHtml() byggjer heile
    // skjelettet på nytt), så direkte binding her -- i motsetnad til
    // søyle-tap-lyttaren over -- lek ikkje: gamle knappar (med sine gamle
    // lyttarar) vert kasta saman med resten av det gamle DOM-treet.
    container.querySelectorAll("[data-an-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        container.querySelectorAll("[data-an-tab]").forEach(function (b) { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); });
        container.querySelectorAll("[data-an-pane]").forEach(function (p) { p.classList.remove("is-active"); });
        btn.classList.add("is-active");
        btn.setAttribute("aria-selected", "true");
        container.querySelector('[data-an-pane="' + btn.getAttribute("data-an-tab") + '"]').classList.add("is-active");
      });
    });

    container.querySelectorAll("[data-an-days]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.days = Number(btn.getAttribute("data-an-days"));
        container.querySelectorAll("[data-an-days]").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        renderPanes(container, rows, state.days);
        // UX-review-funn (2026-08-06, HIGH): renderPanes() byggjer Oversikt-
        // fana sitt DOM heilt på nytt (fersk data-an-live-count-node, tilbake
        // til "–"-plasshaldaren), men sanntids-intervallet (starta éin gong i
        // mountPanel()) oppdaterer han ikkje att før neste 20-sekunders-tick
        // -- talet blenka difor tomt ved kvart periodeval, sjølv om det
        // korrekte, alt kjende talet er periode-uavhengig. Hent på nytt med
        // ein gong i staden for å vente.
        updateLiveVisitorCount(container);
      });
    });

    var refreshBtn = container.querySelector("[data-sidetelling-refresh]");
    if (refreshBtn) refreshBtn.addEventListener("click", function () { renderAdminPanel(container); });
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
      mountPanel(container, rows);
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

  window.VwSidetelling = { renderAdminPanel: renderAdminPanel, updateLiveVisitorCount: updateLiveVisitorCount };
  });
})();
