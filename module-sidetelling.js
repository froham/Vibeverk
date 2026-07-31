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

  function currentPath() { return location.hash || "#"; }

  function send(type, path, ctaId) {
    _sb.rpc("insert_analytics_event", {
      p_session_id: sessionId(),
      p_type: type,
      p_path: path,
      p_referrer: type === "pageview" ? strippedReferrer() : null,
      p_cta_id: ctaId || null
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

  trackPageview();
  window.addEventListener("hashchange", trackPageview);
  bindCtaTracking();

  /* =========================================================================
     ADMINPANEL — kalles fra core.js sin adminAnalyse() (Analyse-fanen), IKKE
     en egen registrert admin-fane. Eksponert på window slik konvensjonen sier
     (window.VwChatAdmin, window.CrmAdmin, ...).
     ====================================================================== */
  var DAYS_BACK = 30;
  var CTA_LABELS = { tel: "Telefon-klikk", mailto: "E-post-klikk", kontakt: "Kontakt-CTA", tilbud: "Tilbud-CTA", booking: "Booking-CTA" };

  // Hard tak på antall rader hentet til nettleseren -- uten dette kan et
  // uratebegrenset antall anon-innsendinger (insert_analytics_event har
  // ingen rate-limiting) i praksis gjøre adminpanelet ubrukelig (nettleseren
  // må hente og iterere hele resultatsettet ved hver åpning av Analyse-fanen).
  var MAX_ROWS = 5000;

  function fetchStats(cb) {
    var since = new Date(Date.now() - DAYS_BACK * 86400000).toISOString();
    var q = _sb.from("analytics_events").select("type,path,referrer,cta_id,session_id,created_at");
    // is_test-rader filtreres bort for ekte kunder, men MÅ vises på staging --
    // ellers viser ikke "Generer testdata"-knappen noensinne noe (den setter
    // is_test=true på alt den lager, se seed_test_pageviews.sql).
    if (!isStagingProject()) q = q.eq("is_test", false);
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

  function buildPanelHtml(rows) {
    var pageviews = rows.filter(function (r) { return r.type === "pageview"; });
    var ctas      = rows.filter(function (r) { return r.type === "cta"; });

    var byDay = {};
    pageviews.forEach(function (r) {
      var d = String(r.created_at).slice(0, 10);
      byDay[d] = (byDay[d] || 0) + 1;
    });
    var days = Object.keys(byDay).sort();
    var max = Math.max.apply(null, days.map(function (d) { return byDay[d]; }).concat([1]));
    var barsHtml = days.map(function (d) {
      var h = Math.round((byDay[d] / max) * 60) + 4;
      return '<div class="an-bar" style="height:' + h + 'px" title="' + esc(d + ": " + byDay[d]) + '"></div>';
    }).join("");
    // title-tooltip virker ikke på touch -- en synlig datoperiode under grafen
    // gir i det minste en referanse selv uten hover/mus (funn fra UX-review).
    var barsRangeHtml = days.length
      ? '<p class="an-hint" style="margin-top:.3rem">' + esc(days[0]) + ' – ' + esc(days[days.length - 1]) + '</p>'
      : "";

    var byPath = {};
    pageviews.forEach(function (r) { byPath[r.path] = (byPath[r.path] || 0) + 1; });
    var topPaths = topN(byPath, 10);

    var byRef = {};
    pageviews.forEach(function (r) { var k = r.referrer || "Direkte"; byRef[k] = (byRef[k] || 0) + 1; });
    var topRefs = topN(byRef, 10);

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

    return '<div class="an-sidetelling">' +
      '<div class="an-cards"><div class="an-card"><div class="an-card__val">' + pageviews.length + '</div><div class="an-card__label">Sidevisninger, siste ' + DAYS_BACK + ' dager</div></div></div>' +
      '<h5>Sidevisninger per dag</h5>' +
      '<div class="an-bars" aria-hidden="true">' + (barsHtml || "") + '</div>' +
      (barsHtml ? barsRangeHtml : '<p class="an-hint">Ingen data ennå.</p>') +
      toplistHtml("Mest besøkte sider", topPaths, function (i) { return i.key; }) +
      toplistHtml("Henvisninger", topRefs, function (i) { return i.key; }) +
      toplistHtml("Inngangssider", topEntry, function (i) { return i.key; }, "Siden en besøkende kom inn på nettsiden") +
      toplistHtml("Utgangssider", topExit, function (i) { return i.key; }, "Siden en besøkende forlot nettsiden fra") +
      (ctaCardsHtml ? '<h5>CTA-klikk</h5><div class="an-cards">' + ctaCardsHtml + '</div>' : "") +
      '<p style="font-size:.78rem;color:var(--color-muted);margin-top:.8rem">Sidetelling fra Vibeverk — cookiefritt, ingen tredjepart involvert.</p>' +
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
