/* =============================================================================
   module-oversikt.js  —  OVERSIKT (Workspace)
   -----------------------------------------------------------------------------
   Konvertert frå ein godkjend, sjølvstendig HTML-demo (kritisk gjennomgått og
   feilretta 2026-08-05 -- sjå docs/project/CHANGELOG.md) til ein ekte
   Workspace-modul, same mønster som module-smart-aarshjul.js. Lagring:
   App.store (nøkkel "wsp-oversikt"), ikkje Supabase-tabell. Forslag genererast
   av eit ekte serverkall til POST /api/ai/oversikt (api/ai/oversikt.js) --
   ingen lokal simulering (demoen sine 5 fiktive scenario er fjerna, berre
   dei fem korte eksempel-skildringane er att, som utgangspunkt brukaren kan
   fylle inn skjemaet med). Slås av/på via config.customModules.oversikt
   (skreddarsydd modul, same absent-som-standard-konvensjon som spaceship og
   smart-aarshjul).

   Fem "skjermar" i éin modul: eit oppsettskjema (før nokon analyse finst),
   deretter fire interne visningar (Samlet oversikt / Analyseverksted /
   Visuelt kart / Oppsummering) styrte av modulen sin eigen state.currentView
   -- IKKJE Workspace sin eigen sidebar-navigasjon, som berre har éin
   oppføring for heile modulen. Same "bind lyttarar éin gong per mount(),
   byt berre ut #ov-content sitt innhald ved intern navigering"-mønster som
   smart-aarshjul.
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App = window.App;
  var C = window.Components;
  var CFG = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  var OV_MODULE = (CFG.customModules || {})["oversikt"];
  if (!OV_MODULE || OV_MODULE.enabled !== true) return;

  var STORE_KEY = "wsp-oversikt";
  var STYLE_ID = "ov-styles";

  var CATEGORIES = { premises: "Lokaler og områder", equipment: "Utstyr", digital: "Digitale tjenester", operations: "Drift", communication: "Informasjon og kommunikasjon", logistics: "Logistikk", suppliers: "Leverandører og avtaler", documentation: "Dokumentasjon", visibility: "Synlighet", purchasing: "Innkjøp", planning: "Planlegging", workflow: "Arbeidsflyt", event: "Arrangement", custom: "Annet" };
  var PRIORITIES = { low: "Lav", normal: "Normal", high: "Høy" };
  var STATUSES = { suggested: "Forslag", approved: "Aktiv", ready: "Klar", "not-started": "Ikke startet", "in-progress": "Pågår", completed: "Ferdig", blocked: "Blokkert", rejected: "Ikke relevant" };
  var IMPACT_LEVELS = { low: "Lav", medium: "Middels", high: "Høy" };
  var SECTION_LABELS = { needs: "Behov", dependencies: "Avhengigheter", impacts: "Påvirkning", blindSpots: "Glemte punkter" };
  var VALID_PRIORITIES = Object.keys(PRIORITIES), VALID_STATUSES = Object.keys(STATUSES), VALID_IMPACTS = Object.keys(IMPACT_LEVELS);
  var VIEW_LABELS = [["dashboard", "Samlet oversikt"], ["workshop", "Analyseverksted"], ["maps", "Visuelt kart"], ["summary", "Oppsummering"]];

  // Korte eksempel-utgangspunkt for oppsettskjemaet -- berre tittel/skildring/
  // type, IKKJE dei fem fiktive, fullt genererte analysane demoen hadde
  // (SCENARIOS). Ekte AI genererer no det faktiske innhaldet.
  var EXAMPLES = [
    { key: "workshop", title: "Flytte verkstedet", type: "relocation", text: "Vi skal flytte verkstedet til større lokaler innen høsten. Maskiner, lager, internett og skilting må på plass, og vi ønsker kortest mulig driftsstans." },
    { key: "event", title: "Arrangere kundedag", type: "event", text: "Vi skal arrangere en åpen kundedag med demonstrasjoner, enkel servering og presentasjon av tjenestene våre." },
    { key: "warehouse", title: "Ta i bruk nytt lager", type: "premises", text: "Vi skal ta i bruk et nytt lager for utstyr og forbruksmateriell. Vi trenger en god plassering, merking og oversikt før lageret tas i bruk." },
    { key: "service", title: "Starte ny tjeneste", type: "service", text: "Vi skal starte en ny serviceordning og må få oversikt over hva som må være klart før lansering." },
    { key: "digital", title: "Bytte digitale systemer", type: "digital", text: "Vi skal gå fra flere små systemer til ett nytt felles system og ønsker oversikt over forberedelser, avhengigheter og berørte områder." },
  ];

  function $(sel, root) { return (root || contentEl).querySelector(sel); }
  function $$(sel, root) { return [].slice.call((root || contentEl).querySelectorAll(sel)); }
  function esc(v) { return C.esc(v); }
  function escAttr(v) { return esc(v).replace(/`/g, "&#96;"); }
  function normalize(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9æøå ]/g, " ").replace(/\s+/g, " ").trim(); }
  function similarity(a, b) { var A = {}, B = {}; a.split(" ").forEach(function (w) { A[w] = true; }); b.split(" ").forEach(function (w) { B[w] = true; }); var inter = 0, union = {}; Object.keys(A).forEach(function (w) { union[w] = true; if (B[w]) inter++; }); Object.keys(B).forEach(function (w) { union[w] = true; }); var unionSize = Object.keys(union).length; return unionSize ? inter / unionSize : 0; }
  function deepClone(x) { return JSON.parse(JSON.stringify(x)); }
  function slug(s) { return normalize(s).replace(/\s+/g, "-") || "vibeverk"; }
  function debounce(fn, ms) { var t; return function () { var args = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, args); }, ms); }; }

  /* =========================================================================
     TILSTAND
     ====================================================================== */
  function defaultState() {
    return {
      version: 1,
      input: { title: "", description: "", scenarioType: "change", depth: "normal", requestedSections: ["needs", "dependencies", "impacts", "blindSpots"], exampleKey: null },
      analysis: null, currentView: "dashboard", workshopSection: "needs", workshopView: "list",
      filters: { query: "", category: "all", priority: "all", display: "active", flowStatuses: ["ready", "in-progress"], flowMenuOpen: false, showRejectedFlow: false },
      mapType: "dependencies", updatedAt: null,
    };
  }

  function connectNodes(nodes, edges) {
    nodes.forEach(function (n) { n.dependsOn = []; n.blocks = []; });
    edges.forEach(function (e) {
      var a = nodes.find(function (n) { return n.id === e.from; }), b = nodes.find(function (n) { return n.id === e.to; });
      if (a && b) { a.blocks.push(b.id); b.dependsOn.push(a.id); }
    });
  }

  // Migrerer eldre/manglande felt trygt -- aldri slett eit punkt berre fordi
  // det manglar nyare felt, berre fyll inn standardverdiar. Same prinsipp som
  // module-smart-aarshjul.js sin eigen validateState()/cleanActivity().
  function validateAnalysis(raw) {
    var a = raw && typeof raw === "object" ? raw : {};
    var safe = {
      analysisId: String(a.analysisId || "overview-" + Date.now()), title: String(a.title || "Ny oversikt"),
      description: String(a.description || ""), scenarioType: String(a.scenarioType || "custom"),
      summary: String(a.summary || "Oversikten samler forslag til behov, rekkefølge og påvirkede områder."),
      disclaimer: String(a.disclaimer || "Dette er forslag til struktur og vurderingspunkter, ikke en fullstendig faglig vurdering."),
      needs: Array.isArray(a.needs) ? a.needs : [], dependencyNodes: Array.isArray(a.dependencyNodes) ? a.dependencyNodes : [],
      dependencyEdges: Array.isArray(a.dependencyEdges) ? a.dependencyEdges : [], impacts: Array.isArray(a.impacts) ? a.impacts : [],
      blindSpots: Array.isArray(a.blindSpots) ? a.blindSpots : [], nextSteps: Array.isArray(a.nextSteps) ? a.nextSteps : [],
    };
    var seen = {};
    function fix(item, type, i) {
      var id = String((item && item.id) || (type + "-" + (i + 1)));
      while (seen[id]) id = id + "-" + (i + 1);
      seen[id] = true;
      var out = {
        id: id, title: String((item && item.title) || "Uten tittel"), description: String((item && item.description) || "Ingen forklaring er lagt til."),
        reason: String((item && item.reason) || "Kan være relevant å vurdere."), category: CATEGORIES[item && item.category] ? item.category : "custom",
        priority: VALID_PRIORITIES.indexOf(item && item.priority) !== -1 ? item.priority : "normal",
        status: VALID_STATUSES.indexOf(item && item.status) !== -1 ? item.status : "suggested",
        source: (item && item.source) === "custom" ? "custom" : "smart-analysis", selected: !(item && item.selected === false),
        approvalStatus: ["suggested", "approved", "rejected"].indexOf(item && item.approvalStatus) !== -1 ? item.approvalStatus : ((item && item.source === "custom") ? "approved" : "suggested"),
        locked: !!(item && item.locked), important: !!(item && item.important),
        relatedIds: Array.isArray(item && item.relatedIds) ? item.relatedIds.map(String) : [], isNew: !!(item && item.isNew), duplicateOf: (item && item.duplicateOf) || null,
      };
      if (type === "impact") { out.impactLevel = VALID_IMPACTS.indexOf(item && item.impactLevel) !== -1 ? item.impactLevel : "medium"; out.consequences = Array.isArray(item && item.consequences) ? item.consequences.map(String) : []; }
      if (type === "node") { out.dependsOn = Array.isArray(item && item.dependsOn) ? item.dependsOn.map(String) : []; out.blocks = Array.isArray(item && item.blocks) ? item.blocks.map(String) : []; out.milestone = !!(item && item.milestone); }
      return out;
    }
    safe.needs = safe.needs.map(function (x, i) { return fix(x, "need", i); });
    safe.dependencyNodes = safe.dependencyNodes.map(function (x, i) { return fix(x, "step", i); });
    safe.impacts = safe.impacts.map(function (x, i) { return fix(x, "impact", i); });
    safe.blindSpots = safe.blindSpots.map(function (x, i) { var f = fix(x, "blind", i); f.suggestedDestination = (x && x.suggestedDestination) || "needs"; return f; });
    var validNodeIds = {}; safe.dependencyNodes.forEach(function (n) { validNodeIds[n.id] = true; });
    safe.dependencyEdges = safe.dependencyEdges.map(function (e, i) {
      return { id: String((e && e.id) || "edge-" + (i + 1)), from: String((e && e.from) || ""), to: String((e && e.to) || ""), type: ["required-before", "recommended-before"].indexOf(e && e.type) !== -1 ? e.type : "required-before" };
    }).filter(function (e) { return e.from && e.to && e.from !== e.to && validNodeIds[e.from] && validNodeIds[e.to]; });
    connectNodes(safe.dependencyNodes, safe.dependencyEdges);
    var ids = {};
    safe.needs.concat(safe.dependencyNodes, safe.impacts, safe.blindSpots).forEach(function (x) { ids[x.id] = true; });
    safe.needs.concat(safe.dependencyNodes, safe.impacts, safe.blindSpots).forEach(function (x) { x.relatedIds = x.relatedIds.filter(function (id) { return ids[id] && id !== x.id; }); });
    return safe;
  }

  // Fjernar duplikat oppretta ved eit tidlegare, no retta dobbelt-klikk-tilfelle
  // (spec-krav: "Dupliser skal lage nøyaktig én kopi") -- ekstra sikkerheitsnett
  // ved lasting, i tillegg til debounce-vernet i duplicateItem().
  function dedupeAccidentalCopies(analysis) {
    if (!analysis || typeof analysis !== "object") return analysis;
    var removed = {};
    ["needs", "dependencyNodes", "impacts", "blindSpots"].forEach(function (key) {
      var list = Array.isArray(analysis[key]) ? analysis[key] : [];
      var seenSig = {};
      analysis[key] = list.filter(function (item) {
        var isCopy = item && item.source === "custom" && /\s[–-]\s*kopi(?:\s*\d+)?$/i.test(String(item.title || ""));
        if (!isCopy) return true;
        var base = normalize(String(item.title || "").replace(/\s[–-]\s*kopi(?:\s*\d+)?$/i, ""));
        var signature = [base, item.category || "", normalize(item.description || "")].join("|");
        if (seenSig[signature]) { removed[String(item.id || "")] = true; return false; }
        seenSig[signature] = true; return true;
      });
    });
    if (Object.keys(removed).length) {
      analysis.dependencyEdges = (analysis.dependencyEdges || []).filter(function (e) { return !removed[String(e.from)] && !removed[String(e.to)]; });
      ["needs", "dependencyNodes", "impacts", "blindSpots"].forEach(function (key) {
        (analysis[key] || []).forEach(function (item) { item.relatedIds = (item.relatedIds || []).filter(function (id) { return !removed[String(id)]; }); });
      });
    }
    return analysis;
  }

  function validateState(raw) {
    var d = defaultState();
    if (!raw || typeof raw !== "object") return d;
    if (raw.input) {
      d.input.title = String(raw.input.title || "").slice(0, 90);
      d.input.description = String(raw.input.description || "").slice(0, 1500);
      d.input.scenarioType = String(raw.input.scenarioType || "change");
      d.input.depth = ["simple", "normal", "thorough"].indexOf(raw.input.depth) !== -1 ? raw.input.depth : "normal";
      d.input.requestedSections = Array.isArray(raw.input.requestedSections) ? raw.input.requestedSections.filter(function (s) { return SECTION_LABELS[s]; }) : d.input.requestedSections;
      d.input.exampleKey = raw.input.exampleKey || null;
    }
    d.analysis = raw.analysis ? validateAnalysis(raw.analysis) : null;
    d.analysis = dedupeAccidentalCopies(d.analysis);
    d.currentView = ["dashboard", "workshop", "maps", "summary"].indexOf(raw.currentView) !== -1 ? raw.currentView : "dashboard";
    d.workshopSection = SECTION_LABELS[raw.workshopSection] ? raw.workshopSection : "needs";
    d.workshopView = raw.workshopView === "cards" ? "cards" : "list";
    if (raw.filters) {
      d.filters.query = String(raw.filters.query || "").slice(0, 160);
      d.filters.category = raw.filters.category === "all" || CATEGORIES[raw.filters.category] ? raw.filters.category : "all";
      d.filters.priority = ["all"].concat(VALID_PRIORITIES, VALID_IMPACTS).indexOf(raw.filters.priority) !== -1 ? raw.filters.priority : "all";
      d.filters.display = ["active", "approved", "smart", "new", "all"].indexOf(raw.filters.display) !== -1 ? raw.filters.display : "active";
      d.filters.flowStatuses = Array.isArray(raw.filters.flowStatuses) ? raw.filters.flowStatuses.filter(function (s) { return ["ready", "in-progress", "blocked", "completed"].indexOf(s) !== -1; }) : d.filters.flowStatuses;
      d.filters.flowMenuOpen = !!raw.filters.flowMenuOpen;
      d.filters.showRejectedFlow = !!raw.filters.showRejectedFlow;
    }
    d.mapType = raw.mapType === "impacts" ? "impacts" : "dependencies";
    d.updatedAt = raw.updatedAt || null;
    return d;
  }

  var state = defaultState();
  var pendingExistingAnalysis = null;
  var lastDuplicate = { id: "", at: 0 };
  var generating = false;
  // Sann etter fyrste vellykka innlasting denne sideøkta -- hindrar at eit
  // etterfølgjande mount() (dvs. kvar gong brukaren navigerer INN i modulen
  // att) overskriv ein god state i minnet med ei ELDRE lagra utgåve dersom
  // ei tidlegare save() faktisk feila (t.d. fullt localStorage-kvote, sjå
  // App.store sin nye feillogging i core.js). Brukarrapport 2026-08-05:
  // eit ekte generert årshjul/oversikt kunne forsvinne heilt ved berre å
  // byte fane og komme attende, sjølv om objektet i minnet framleis var
  // korrekt -- state = defaultState()/resetState() nullstiller denne
  // sjølv, så eit ekte "Ny oversikt"/"Nullstill" fungerer som før.
  var _loadedThisSession = false;
  function load() { state = validateState(App.store.get(STORE_KEY, null)); }
  function save(show) {
    state.updatedAt = new Date().toISOString();
    // Feil vert ALLTID varsla, uavhengig av show -- ein stille save() (dei
    // fleste rutinehandlingane i modulen brukar denne) skal framleis fortelje
    // brukaren om noko faktisk ikkje vart lagra (brukarrapport 2026-08-05:
    // Oversikt verka som han "fungerte" -- ingen feilmelding -- medan Smart
    // årshjul synte feilboksen for nøyaktig same underliggjande lagringsfeil,
    // fordi Årshjul sin eigen save() manglar dette show-vernet i det heile).
    // Berre den POSITIVE stadfestinga ("lagra lokalt") held fram å vere stille
    // med mindre show er sett, for å ikkje spamme ein toast for kvar rutinemessige
    // endring (avkryssing, statusbyte, osb.).
    if (!App.store.set(STORE_KEY, state)) toast("Endringene kunne ikke lagres lokalt.", "error");
    else if (show) toast("Oversikten er lagret lokalt.");
  }
  function resetState() {
    App.store.remove ? App.store.remove(STORE_KEY) : App.store.set(STORE_KEY, null);
    state = defaultState();
    renderApp();
    toast("Oversikten er nullstilt.");
  }

  /* =========================================================================
     API-KALL (ekte Anthropic-kall via api/ai/oversikt.js)
     ====================================================================== */
  function getAccessToken() {
    if (!App.supabase) return Promise.resolve(null);
    return App.supabase.auth.getSession().then(function (r) {
      return (r.data && r.data.session && r.data.session.access_token) || null;
    });
  }
  // Feil merkte med .ovSafe kan visast rått i eit varsel -- alt anna
  // (nettverksfeil, JSON-parsefeil) skal ALDRI visast rått (copy-style-guide).
  function safeError(msg) { var e = new Error(msg); e.ovSafe = true; return e; }

  function requestOverview(input) {
    return getAccessToken().then(function (token) {
      if (!token) throw safeError("Du må logge inn på nytt.");
      var existingItemTitles = pendingExistingAnalysis
        ? allItemsOf(pendingExistingAnalysis).map(function (x) { return { title: x.title, section: x._section }; })
        : [];
      return fetch("/api/ai/oversikt", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          title: input.title, description: input.description, scenarioType: input.scenarioType, depth: input.depth,
          requestedSections: input.requestedSections, existingItemTitles: existingItemTitles,
        }),
      }).then(function (resp) {
        return resp.json().then(function (data) {
          if (!resp.ok) throw safeError((data && data.error) || "Oversikten kunne ikke hentes.");
          return data;
        });
      });
    });
  }

  /* =========================================================================
     RELASJONAR / OPPSLAG
     ====================================================================== */
  function allItemsOf(analysis) {
    if (!analysis) return [];
    return [].concat(
      analysis.needs.map(function (x) { return Object.assign({}, x, { _section: "needs" }); }),
      analysis.dependencyNodes.map(function (x) { return Object.assign({}, x, { _section: "dependencies" }); }),
      analysis.impacts.map(function (x) { return Object.assign({}, x, { _section: "impacts" }); }),
      analysis.blindSpots.map(function (x) { return Object.assign({}, x, { _section: "blindSpots" }); })
    );
  }
  function allItems() { return allItemsOf(state.analysis); }

  function activeItem(x) { return x.approvalStatus === "approved" && x.status !== "rejected" && x.selected !== false; }
  function countActive(list) { return list.filter(activeItem).length; }
  function totalCount() { var a = state.analysis; return a.needs.length + a.dependencyNodes.length + a.impacts.length + a.blindSpots.length; }
  function approvedCount() { return allItems().filter(function (x) { return x.approvalStatus === "approved"; }).length; }
  function approvalPercent() { return totalCount() ? Math.round((approvedCount() / totalCount()) * 100) : 0; }

  function orderedDependencyNodes(nodes) {
    nodes = nodes || (state.analysis ? state.analysis.dependencyNodes.filter(activeItem) : []);
    var nodeIds = {}; nodes.forEach(function (n) { nodeIds[n.id] = true; });
    var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
    var indegree = {}; nodes.forEach(function (n) { indegree[n.id] = 0; });
    var adj = {}; nodes.forEach(function (n) { adj[n.id] = []; });
    (state.analysis ? state.analysis.dependencyEdges : []).filter(function (e) { return nodeIds[e.from] && nodeIds[e.to]; }).forEach(function (e) { adj[e.from].push(e.to); indegree[e.to] = (indegree[e.to] || 0) + 1; });
    var queue = nodes.filter(function (n) { return indegree[n.id] === 0; }).sort(function (a, b) { return a.title.localeCompare(b.title, "nb"); });
    var ordered = [];
    while (queue.length) {
      var node = queue.shift();
      ordered.push(node);
      (adj[node.id] || []).forEach(function (id) {
        indegree[id] = indegree[id] - 1;
        if (indegree[id] === 0) { queue.push(byId[id]); queue.sort(function (a, b) { return a.title.localeCompare(b.title, "nb"); }); }
      });
    }
    nodes.forEach(function (node) { if (!ordered.some(function (x) { return x.id === node.id; })) ordered.push(node); });
    return ordered;
  }

  function findItem(id) {
    if (!state.analysis) return null;
    var sections = [["needs", state.analysis.needs], ["dependencies", state.analysis.dependencyNodes], ["impacts", state.analysis.impacts], ["blindSpots", state.analysis.blindSpots]];
    for (var i = 0; i < sections.length; i++) {
      var item = sections[i][1].find(function (x) { return x.id === id; });
      if (item) return { item: item, section: sections[i][0], list: sections[i][1] };
    }
    return null;
  }
  function relatedItems(item) { return (item.relatedIds || []).map(findItem).filter(Boolean); }
  function addRelation(fromId, toId) {
    if (fromId === toId) return;
    var a = findItem(fromId), b = findItem(toId);
    if (!a || !b) return;
    a.item.relatedIds = uniq((a.item.relatedIds || []).concat(toId));
    b.item.relatedIds = uniq((b.item.relatedIds || []).concat(fromId));
    save(); renderCurrentView(); toast("Sammenheng lagt til.");
  }
  function removeRelation(fromId, toId) {
    var a = findItem(fromId), b = findItem(toId);
    if (a) a.item.relatedIds = (a.item.relatedIds || []).filter(function (id) { return id !== toId; });
    if (b) b.item.relatedIds = (b.item.relatedIds || []).filter(function (id) { return id !== fromId; });
    save(); renderCurrentView(); toast("Sammenheng fjernet.");
  }
  function uniq(arr) { var seen = {}, out = []; arr.forEach(function (x) { if (!seen[x]) { seen[x] = true; out.push(x); } }); return out; }

  /* =========================================================================
     FILTRERING
     ====================================================================== */
  function filteredItems(section) {
    var list = section === "dependencies" ? state.analysis.dependencyNodes : (state.analysis[section] || []);
    var q = normalize(state.filters.query);
    var flowStatuses = Array.isArray(state.filters.flowStatuses) ? state.filters.flowStatuses : [];
    return list.filter(function (item) {
      if (q && normalize(item.title + " " + item.description + " " + item.reason + " " + CATEGORIES[item.category]).indexOf(q) === -1) return false;
      if (state.filters.category !== "all" && item.category !== state.filters.category) return false;
      if (state.filters.priority !== "all") {
        var val = section === "impacts" ? item.impactLevel : item.priority;
        if (val !== state.filters.priority) return false;
      }
      if (section === "dependencies") {
        if (item.approvalStatus === "rejected") return !!state.filters.showRejectedFlow;
        if (item.approvalStatus === "approved" && flowStatuses.indexOf(item.status) === -1) return false;
        return true;
      }
      if (state.filters.display === "active" && item.approvalStatus === "rejected") return false;
      if (state.filters.display === "approved" && item.approvalStatus !== "approved") return false;
      if (state.filters.display === "smart" && item.source !== "smart-analysis") return false;
      if (state.filters.display === "new" && !item.isNew) return false;
      return true;
    });
  }
  function inclusionLabel(item) { return item.approvalStatus === "approved" ? "Aktiv" : item.approvalStatus === "rejected" ? "Ikke relevant" : "Forslag"; }
  function inclusionChipClass(item) { return item.approvalStatus === "approved" ? "approved" : item.approvalStatus === "rejected" ? "rejected" : "suggested"; }
  function categoryOptions(selected) { return Object.keys(CATEGORIES).map(function (k) { return '<option value="' + k + '"' + (selected === k ? " selected" : "") + ">" + esc(CATEGORIES[k]) + "</option>"; }).join(""); }
  function priorityFilterOptions(section) {
    var obj = section === "impacts" ? IMPACT_LEVELS : PRIORITIES;
    return Object.keys(obj).map(function (k) { return '<option value="' + k + '"' + (state.filters.priority === k ? " selected" : "") + ">" + obj[k] + "</option>"; }).join("");
  }
  function prioritySelect(item, section) {
    var isImpact = section === "impacts";
    var value = isImpact ? item.impactLevel : item.priority;
    var options = isImpact ? IMPACT_LEVELS : PRIORITIES;
    var label = isImpact ? "Påvirkningsgrad" : "Prioritet";
    return '<label class="ov-list-priority"><span class="ov-sr-only">' + label + " for " + esc(item.title) + '</span><select data-item-priority="' + item.id + '" data-section="' + section + '" aria-label="' + label + " for " + escAttr(item.title) + '">' +
      Object.keys(options).map(function (key) { return '<option value="' + key + '" ' + (value === key ? "selected" : "") + ">" + options[key] + "</option>"; }).join("") + "</select></label>";
  }

  /* =========================================================================
     AVHENGIGHEITSSTATUS
     ====================================================================== */
  function syncDependencyStatuses() {
    if (!state.analysis) return;
    var nodes = state.analysis.dependencyNodes;
    var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
    var included = {}; nodes.filter(activeItem).forEach(function (n) { included[n.id] = true; });
    nodes.forEach(function (n) {
      if (!included[n.id]) { if (n.status !== "completed" && n.status !== "in-progress") n.status = "not-started"; return; }
      if (n.status === "completed" || n.status === "in-progress") return;
      var required = state.analysis.dependencyEdges.filter(function (e) { return e.to === n.id && e.type === "required-before" && included[e.from]; }).map(function (e) { return byId[e.from]; }).filter(Boolean);
      n.status = !required.length ? "ready" : required.every(function (dep) { return dep.status === "completed"; }) ? "ready" : "blocked";
    });
  }
  function dependencyActionButton(n) {
    if (n.status === "ready") return '<button type="button" class="btn btn--primary btn--sm ov-node-progress" data-action="step-progress" data-id="' + n.id + '" data-next-status="in-progress">Start steg</button>';
    if (n.status === "in-progress") return '<button type="button" class="btn btn--primary btn--sm ov-node-progress" data-action="step-progress" data-id="' + n.id + '" data-next-status="completed">Marker ferdig</button>';
    if (n.status === "completed") return '<button type="button" class="btn btn--ghost btn--sm ov-node-progress" data-action="step-progress" data-id="' + n.id + '" data-next-status="not-started">Åpne på nytt</button>';
    return '<button type="button" class="btn btn--ghost btn--sm ov-node-progress" disabled title="Et obligatorisk foregående steg må bli ferdig først">Venter på tidligere steg</button>';
  }
  function updateDependencyProgress(id, nextStatus) {
    var found = findItem(id);
    if (!found || found.section !== "dependencies") return;
    var node = found.item;
    if (nextStatus === "in-progress" && node.status !== "ready") { toast("Steget er ikke klart ennå.", "error"); return; }
    node.status = nextStatus;
    node.approvalStatus = "approved"; node.selected = true;
    syncDependencyStatuses(); save(); renderCurrentView();
    toast(nextStatus === "completed" ? "Steget er ferdig. Neste steg er oppdatert." : nextStatus === "in-progress" ? "Steget er startet." : "Steget er åpnet igjen.");
  }
  function updateStatus(id, status) {
    var found = findItem(id);
    if (!found) return;
    var isDependency = found.section === "dependencies";
    if (status === "approved") { found.item.approvalStatus = "approved"; found.item.selected = true; found.item.isNew = false; if (!isDependency) found.item.status = "approved"; }
    else if (status === "rejected") { found.item.approvalStatus = "rejected"; found.item.selected = false; if (!isDependency) found.item.status = "rejected"; }
    if (isDependency) syncDependencyStatuses();
    save(); renderCurrentView();
  }

  /* =========================================================================
     RENDER — hovudramme og intern navigasjon
     ====================================================================== */
  function viewNav() {
    return '<div class="ov-viewnav" role="tablist" aria-label="Oversikt-visningar">' +
      VIEW_LABELS.map(function (v) { return '<button type="button" class="ov-viewnav-btn" data-nav="' + v[0] + '" aria-current="' + (state.currentView === v[0] ? "page" : "false") + '">' + v[1] + "</button>"; }).join("") +
      "</div>";
  }
  function topActions() {
    return '<div class="ov-top-actions">' +
      '<button type="button" class="btn btn--ghost btn--sm" id="ov-save-top">Lagre</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="ov-reset-top">Nullstill</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="ov-new-top">Ny oversikt</button>' +
      "</div>";
  }

  function renderApp() {
    try {
      requestAnimationFrame(function () { if (contentEl) contentEl.scrollTop = 0; });
      state.analysis = state.analysis ? validateAnalysis(state.analysis) : null;
      if (state.analysis) syncDependencyStatuses();
      if (!contentEl) return;
      if (!state.analysis) { contentEl.innerHTML = renderStart(); bindStartEvents(); return; }
      contentEl.innerHTML = renderWorkspaceShell();
      bindShellEvents();
      renderCurrentView();
    } catch (err) { renderFatal(err); }
  }

  function renderWorkspaceShell() {
    var a = state.analysis;
    return '<div class="ov-shell-head"><div><div class="ov-kicker">Automatisk strukturert</div><h1>' + esc(a.title) + "</h1><p>" + esc(a.summary) + '</p><p class="ov-shell-disclaimer">' + esc(a.disclaimer) + "</p></div>" +
      '<div class="ov-shell-head-actions"><button type="button" class="btn btn--ghost btn--sm" id="ov-edit-source">Rediger beskrivelse</button><button type="button" class="btn btn--primary btn--sm" id="ov-update-analysis">Oppdater oversikten</button></div></div>' +
      topActions() + viewNav() + '<div id="ov-view-root"></div>';
  }

  function renderCurrentView() {
    var root = $("#ov-view-root");
    if (!root || !state.analysis) return;
    var html = state.currentView === "dashboard" ? renderDashboard()
      : state.currentView === "workshop" ? renderWorkshop()
      : state.currentView === "maps" ? renderMaps()
      : renderSummary();
    root.innerHTML = '<div class="ov-view" data-view="' + state.currentView + '">' + html + "</div>";
    bindViewEvents();
    if (state.currentView === "maps") requestAnimationFrame(drawMapLines);
  }

  /* =========================================================================
     OPPSETTSKJEMA
     ====================================================================== */
  function renderStart() {
    var i = state.input;
    return '<div class="ov-hero"><div class="ov-kicker">Smart analyse</div><h1>Gjør en kort beskrivelse om til en visuell oversikt</h1>' +
      "<p>Se mulige behov, avhengigheter, ringvirkninger og punkter som kan være glemt – i en strukturert arbeidsflate du kan redigere.</p></div>" +
      '<div class="ov-start-grid"><form class="ov-card ov-panel" id="ov-start-form" novalidate>' +
      '<div class="ov-section-head"><h2>Beskriv situasjonen</h2><p>Unngå personopplysninger, kundedata og sensitive detaljer.</p></div>' +
      '<div class="ov-form-grid">' +
      '<div class="ov-field ov-field-full"><label for="ov-title">Tittel</label><input id="ov-title" maxlength="90" placeholder="For eksempel: Flytte verkstedet" value="' + escAttr(i.title) + '" required><div class="ov-error ov-hidden" data-error="title"></div></div>' +
      '<div class="ov-field ov-field-full"><label for="ov-description">Hva skal skje?</label><textarea id="ov-description" maxlength="1500" placeholder="Beskriv planen, endringen eller aktiviteten med noen setninger." required>' + esc(i.description) + '</textarea><small><span id="ov-char-count">' + i.description.length + '</span>/1500 tegn</small><div class="ov-error ov-hidden" data-error="description"></div></div>' +
      '<div class="ov-field"><label for="ov-type">Type situasjon</label><select id="ov-type">' +
      '<option value="change"' + sel(i.scenarioType, "change") + '>Endring</option>' +
      '<option value="relocation"' + sel(i.scenarioType, "relocation") + '>Flytting</option>' +
      '<option value="event"' + sel(i.scenarioType, "event") + '>Arrangement</option>' +
      '<option value="startup"' + sel(i.scenarioType, "startup") + '>Oppstart</option>' +
      '<option value="service"' + sel(i.scenarioType, "service") + '>Ny tjeneste</option>' +
      '<option value="premises"' + sel(i.scenarioType, "premises") + '>Nye lokale</option>' +
      '<option value="workflow"' + sel(i.scenarioType, "workflow") + '>Ny arbeidsflyt</option>' +
      '<option value="digital"' + sel(i.scenarioType, "digital") + '>Digitalisering</option>' +
      '<option value="custom"' + sel(i.scenarioType, "custom") + '>Annet</option>' +
      '</select><small>Brukes til å tilpasse forslagene til situasjonen din.</small></div>' +
      '<div class="ov-field"><label for="ov-depth">Omfang</label><select id="ov-depth"><option value="simple"' + sel(i.depth, "simple") + '>Enkel oversikt</option><option value="normal"' + sel(i.depth, "normal") + '>Normal oversikt</option><option value="thorough"' + sel(i.depth, "thorough") + '>Grundig oversikt</option></select><small>Styrer hvor mange forslag og hvor mye detalj du får.</small></div>' +
      '<fieldset class="ov-field ov-field-full ov-fieldset"><legend>Hva ønsker du oversikt over?</legend><div class="ov-check-grid">' +
      section("needs", "Hva trenger vi?", "Mulige behov og forberedelser", i) + section("dependencies", "Hva må skje først?", "Rekkefølge og avhengigheter", i) +
      section("impacts", "Hva blir påvirket?", "Ringvirkninger og sammenhenger", i) + section("blindSpots", "Hva kan være glemt?", "Detaljer som kan falle mellom stolene", i) +
      '</div><div class="ov-error ov-hidden" data-error="sections"></div></fieldset></div>' +
      '<div class="ov-form-footer"><div class="ov-disclaimer">Resultatet er forslag til struktur og vurderingspunkter, ikke en fullstendig faglig vurdering.</div>' +
      '<button class="btn btn--primary" type="submit">Lag oversikt →</button></div></form>' +
      '<aside class="ov-card ov-panel"><div class="ov-section-head"><h2>Prøv et eksempel</h2><p>Fyll ut skjemaet med ett klikk.</p></div><div class="ov-examples">' +
      EXAMPLES.map(function (e) { return '<button type="button" class="ov-example" data-example="' + e.key + '"><strong>' + esc(e.title) + "</strong><span>" + esc(e.text) + "</span></button>"; }).join("") +
      "</div></aside></div>";
  }
  function sel(current, value) { return current === value ? " selected" : ""; }
  function section(key, title, hint, i) {
    var checked = (i.requestedSections || []).indexOf(key) !== -1;
    return '<label class="ov-check"><input type="checkbox" name="sections" value="' + key + '"' + (checked ? " checked" : "") + "><span><strong>" + title + "</strong><br><small>" + hint + "</small></span></label>";
  }

  function bindStartEvents() {
    $$("[data-example]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var sample = EXAMPLES.find(function (x) { return x.key === btn.dataset.example; });
        state.input = Object.assign({}, state.input, { title: sample.title, description: sample.text, scenarioType: sample.type, exampleKey: sample.key });
        $("#ov-title").value = state.input.title; $("#ov-description").value = state.input.description; $("#ov-type").value = state.input.scenarioType;
        $("#ov-char-count").textContent = String(state.input.description.length);
        $("#ov-title").focus();
        save();
      });
    });
    // Skriv skjemaverdiane inn i state og lagra fortløpande, ikkje berre ved
    // innsending -- elles går utfylt-men-ikkje-sendt tekst tapt om brukaren
    // byter fane og kjem attende før generering er starta.
    $("#ov-title").addEventListener("input", function (e) { state.input.title = e.target.value; save(); });
    $("#ov-description").addEventListener("input", function (e) { state.input.description = e.target.value; $("#ov-char-count").textContent = String(e.target.value.length); save(); });
    $("#ov-type").addEventListener("change", function (e) { state.input.scenarioType = e.target.value; save(); });
    $("#ov-depth").addEventListener("change", function (e) { state.input.depth = e.target.value; save(); });
    $$('input[name="sections"]').forEach(function (cb) {
      cb.addEventListener("change", function () {
        state.input.requestedSections = $$('input[name="sections"]').filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
        save();
      });
    });
    $("#ov-start-form").addEventListener("submit", handleGenerate);
  }

  /* =========================================================================
     GENERERING
     ====================================================================== */
  var GEN_MESSAGES = ["Tolker situasjonen", "Finn aktuelle behov", "Ser etter avhengigheter", "Kartlegg mulige ringvirkninger", "Ser etter punkter som kan være glemt", "Bygger den visuelle oversikten"];
  function readForm() {
    return {
      title: $("#ov-title").value.trim(), description: $("#ov-description").value.trim(), scenarioType: $("#ov-type").value, depth: $("#ov-depth").value,
      requestedSections: $$('input[name="sections"]').filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; }),
      exampleKey: state.input.exampleKey || null,
    };
  }
  function validateInput(input) {
    var e = {};
    if (!input.title) e.title = "Skriv inn en kort tittel.";
    if (!input.description) e.description = "Beskriv hva som skal skje.";
    else if (input.description.length < 25) e.description = "Beskrivelsen bør være minst 25 tegn.";
    if (!input.requestedSections.length) e.sections = "Velg minst ett analyseområde.";
    return e;
  }
  function clearErrors() { $$(".ov-error").forEach(function (x) { x.classList.add("ov-hidden"); x.textContent = ""; }); }
  function showErrors(errors) {
    Object.keys(errors).forEach(function (k) {
      var el = $('[data-error="' + k + '"]');
      if (el) { el.textContent = errors[k]; el.classList.remove("ov-hidden"); }
    });
    var first = Object.keys(errors)[0];
    var target = first === "sections" ? $('input[name="sections"]') : $("#ov-" + first);
    if (target) target.focus();
  }

  function startGenerate(input) {
    generating = true;
    contentEl.innerHTML = renderLoading();
    var i = 0;
    var timer = setInterval(function () {
      i = Math.min(i + 1, GEN_MESSAGES.length - 1);
      var s = $("#ov-loading-status"), b = $("#ov-loading-bar");
      if (s) s.textContent = GEN_MESSAGES[i];
      if (b) b.style.width = Math.round(((i + 1) / GEN_MESSAGES.length) * 100) + "%";
    }, 900);

    requestOverview(input).then(function (fresh) {
      clearInterval(timer); generating = false;
      state.analysis = pendingExistingAnalysis ? mergeAnalysis(pendingExistingAnalysis, fresh) : validateAnalysis(fresh);
      syncDependencyStatuses(); pendingExistingAnalysis = null;
      state.currentView = "workshop"; state.workshopSection = "needs"; state.workshopView = "list"; state.filters = defaultState().filters;
      save(); renderApp(); toast("Forslagene er klare for gjennomgang.");
    }).catch(function (e) {
      clearInterval(timer); generating = false;
      renderApp();
      toast((e && e.ovSafe && e.message) || "Oversikten kunne ikke genereres. Eksisterende punkter er urørte.", "error");
    });
  }
  function renderLoading() {
    return '<div class="ov-loading"><div class="ov-card ov-loading-card"><div class="ov-loader-orbit" aria-hidden="true"></div><h2>Bygger oversikt</h2>' +
      '<p id="ov-loading-status">' + GEN_MESSAGES[0] + '</p><div class="ov-progress"><span id="ov-loading-bar" style="width:15%"></span></div></div></div>';
  }

  function handleGenerate(e) {
    e.preventDefault(); clearErrors();
    var input = readForm(), errors = validateInput(input);
    if (Object.keys(errors).length) { showErrors(errors); return; }
    state.input = input;
    startGenerate(input);
  }
  function handleUpdate() {
    var input = state.input;
    if (!input || !input.description) { editSource(); return; }
    pendingExistingAnalysis = deepClone(state.analysis);
    startGenerate(input);
  }
  function editSource() {
    pendingExistingAnalysis = deepClone(state.analysis);
    state.analysis = null;
    renderApp();
    requestAnimationFrame(function () {
      $("#ov-title").value = state.input.title; $("#ov-description").value = state.input.description; $("#ov-type").value = state.input.scenarioType; $("#ov-depth").value = state.input.depth;
      $("#ov-char-count").textContent = String(state.input.description.length);
      $("#ov-title").focus();
    });
  }

  // Same rein, klient-side samanslåingsalgoritme som demoen sin eigen
  // mergeAnalysis() -- ingen AI-vurdering trengst her, berre normalisert
  // tittel-matching + likskapsscore for moglege duplikat. Server-sida
  // sender berre EKSISTERANDE TITLAR (ikkje heile analysen) til AI-en, sjå
  // api/_lib/oversikt-ai.js sin eigen kommentar om kvifor.
  function mergeAnalysis(oldA, newA) {
    function merge(oldList, newList) {
      var existingTitles = {}; oldList.forEach(function (x) { existingTitles[normalize(x.title)] = x; });
      var result = oldList.slice();
      newList.forEach(function (n) {
        var existing = existingTitles[normalize(n.title)];
        if (existing) {
          if (!existing.locked && existing.source !== "custom" && existing.status !== "completed") {
            var idx = result.findIndex(function (x) { return x.id === existing.id; });
            result[idx] = Object.assign({}, existing, { reason: n.reason, description: existing.description || n.description, isNew: false });
          }
        } else {
          var similar = oldList.find(function (x) { return similarity(normalize(x.title), normalize(n.title)) > 0.58; });
          result.push(Object.assign({}, n, { id: n.id + "-new-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5), isNew: true, status: "suggested", duplicateOf: similar ? similar.id : null }));
        }
      });
      return result;
    }
    var merged = Object.assign({}, newA, {
      needs: merge(oldA.needs, newA.needs), dependencyNodes: merge(oldA.dependencyNodes, newA.dependencyNodes),
      impacts: merge(oldA.impacts, newA.impacts), blindSpots: merge(oldA.blindSpots, newA.blindSpots),
    });
    var nodeIds = {}; merged.dependencyNodes.forEach(function (n) { nodeIds[n.id] = true; });
    merged.dependencyEdges = oldA.dependencyEdges.filter(function (e) { return nodeIds[e.from] && nodeIds[e.to]; }).concat(
      newA.dependencyEdges.filter(function (e) { return nodeIds[e.from] && nodeIds[e.to] && !oldA.dependencyEdges.some(function (x) { return x.from === e.from && x.to === e.to; }); })
    );
    connectNodes(merged.dependencyNodes, merged.dependencyEdges);
    return validateAnalysis(merged);
  }

  /* =========================================================================
     DASHBOARD
     ====================================================================== */
  function renderDashboard() {
    var a = state.analysis;
    var priority = allItems().filter(activeItem).filter(function (x) { return x.important || x.priority === "high" || x.impactLevel === "high"; }).slice(0, 6);
    return '<div class="ov-stat-grid">' + statCard(countActive(a.needs), "Aktive behov", "needs") + statCard(countActive(a.dependencyNodes), "Aktive steg i flyten", "dependencies") + statCard(countActive(a.impacts), "Aktive påvirkningsområder", "impacts") + statCard(countActive(a.blindSpots), "Aktive glemte punkter", "blindSpots") + "</div>" +
      '<div class="ov-dashboard-grid"><div class="ov-stack"><div class="ov-card ov-panel"><div class="ov-section-head"><div><h2>Prioriterte punkter</h2><p>Aktive punkter med høy prioritet eller påvirkning.</p></div><button type="button" class="btn btn--ghost btn--sm" data-go="workshop">Åpne analyseverkstedet</button></div>' +
      '<div class="ov-stack">' + (priority.length ? priority.map(function (x) { return '<button type="button" class="ov-priority-item" data-action="details" data-id="' + x.id + '"><span class="ov-priority-mark"></span><span><strong>' + esc(x.title) + "</strong><small>" + esc(SECTION_LABELS[x._section]) + " · " + esc(CATEGORIES[x.category]) + "</small></span></button>"; }).join("") : '<div class="ov-empty">Ingen aktive punkter med høy prioritet ennå.</div>') + "</div></div>" +
      '<div class="ov-card ov-panel"><div class="ov-section-head"><div><h2>Aktiv rekkefølge</h2><p>En forenklet visning av stegene som er tatt med.</p></div><button type="button" class="btn btn--ghost btn--sm" data-go-map="dependencies">Se kart</button></div>' +
      '<div class="ov-mini-flow">' + (orderedDependencyNodes().slice(0, 6).map(function (n, i2) { return (i2 ? '<span class="ov-mini-arrow" aria-hidden="true">→</span>' : "") + '<button class="ov-mini-node" data-action="details" data-id="' + n.id + '" type="button"><strong>' + esc(n.title) + '</strong><br><span class="ov-chip ov-chip-' + n.status + '">' + STATUSES[n.status] + "</span></button>"; }).join("") || "<span>Ingen steg er tatt med i flyten ennå.</span>") + "</div></div></div>" +
      '<div class="ov-stack"><div class="ov-card ov-panel"><div class="ov-section-head"><div><h2>Påvirkning rundt planen</h2><p>Aktive områder som kan få ringvirkninger.</p></div><button type="button" class="btn btn--ghost btn--sm" data-go-map="impacts">Se kart</button></div>' +
      '<div class="ov-mini-impact">' + (a.impacts.filter(activeItem).map(function (x) { return '<button class="ov-chip ov-chip-impact-' + x.impactLevel + '" data-action="details" data-id="' + x.id + '" type="button">' + esc(x.title) + " · " + IMPACT_LEVELS[x.impactLevel] + "</button>"; }).join("") || "Ingen påvirkningsområder er tatt med ennå.") + "</div></div>" +
      '<div class="ov-card ov-panel"><div class="ov-section-head"><h2>Naturlige neste steg</h2></div><div class="ov-next-grid">' + a.nextSteps.map(function (n, i2) { return '<div class="ov-next"><span class="ov-kicker">Steg ' + (i2 + 1) + "</span><strong>" + esc(n.title) + "</strong><span>" + esc(n.description) + "</span></div>"; }).join("") + "</div></div>" +
      '<div class="ov-card ov-panel"><div class="ov-section-head"><h2>Punkter tatt med</h2><p>' + approvedCount() + " av " + totalCount() + ' forslag er aktive i oversikten.</p></div><div class="ov-progress"><span style="width:' + approvalPercent() + '%"></span></div></div></div></div>';
  }
  function statCard(count, label, section) { return '<button type="button" class="ov-card ov-stat" data-workshop-section="' + section + '"><div class="ov-stat-top"><strong>' + count + "</strong></div><span>" + label + "</span></button>"; }

  /* =========================================================================
     ANALYSEVERKSTAD
     ====================================================================== */
  function flowFilterLabel() {
    var selected = Array.isArray(state.filters.flowStatuses) ? state.filters.flowStatuses : [];
    var labels = { ready: "Klar", "in-progress": "Pågår", blocked: "Blokkert", completed: "Ferdig" };
    if (!selected.length) return "Ingen valgte statuser";
    if (selected.length === 4) return "Alle statuser";
    return selected.map(function (x) { return labels[x]; }).filter(Boolean).join(" + ");
  }
  function renderWorkshop() {
    var section = state.workshopSection;
    var items = filteredItems(section);
    var selectedStatuses = Array.isArray(state.filters.flowStatuses) ? state.filters.flowStatuses : [];
    var flowOptions = [["ready", "Klar"], ["in-progress", "Pågår"], ["blocked", "Blokkert"], ["completed", "Ferdig"]];
    var displayFilter = section === "dependencies"
      ? '<details class="ov-filter-multi" id="ov-filter-flow" ' + (state.filters.flowMenuOpen ? "open" : "") + "><summary>" + esc(flowFilterLabel()) + '</summary><div class="ov-filter-menu">' +
        flowOptions.map(function (o) { return '<label class="ov-filter-option"><input type="checkbox" data-flow-status="' + o[0] + '" ' + (selectedStatuses.indexOf(o[0]) !== -1 ? "checked" : "") + "><span>" + o[1] + "</span></label>"; }).join("") +
        '<label class="ov-filter-option ov-filter-option-separator"><input type="checkbox" id="ov-show-rejected-flow" ' + (state.filters.showRejectedFlow ? "checked" : "") + '><span>Vis fjernede steg</span></label>' +
        '<div class="ov-filter-hint">Forslag vises til de er vurdert. Statusvalgene filtrerer stegene du har tatt med.</div></div></details>'
      : '<select id="ov-filter-display"><option value="active"' + sel(state.filters.display, "active") + '>Forslag og aktive</option><option value="approved"' + sel(state.filters.display, "approved") + '>Bare aktive</option><option value="smart"' + sel(state.filters.display, "smart") + '>Automatiske forslag</option><option value="new"' + sel(state.filters.display, "new") + '>Nye forslag</option><option value="all"' + sel(state.filters.display, "all") + ">Vis alle</option></select>";
    var viewToggle = '<div class="ov-workshop-viewbar"><div><strong>' + items.length + ' punkter vises</strong><span>Ta med relevante forslag. Bare aktive punkter brukes i kart, oppsummering og eksport.</span></div>' +
      '<div class="ov-segment"><button type="button" data-workshop-view="list" aria-pressed="' + (state.workshopView === "list") + '">Liste</button><button type="button" data-workshop-view="cards" aria-pressed="' + (state.workshopView === "cards") + '">Kort</button></div></div>';
    var content = state.workshopView === "list" ? renderItemList(items, section) : '<div class="ov-item-grid">' + (items.map(function (item) { return renderItemCard(item, section); }).join("") || '<div class="ov-card ov-empty">Ingen punkter samsvarer med filtrene.</div>') + "</div>";
    return '<div class="ov-card ov-toolbar"><div class="ov-toolbar-left"><div class="ov-segment">' + Object.keys(SECTION_LABELS).map(function (k) { return '<button type="button" data-workshop-section="' + k + '" aria-pressed="' + (section === k) + '">' + SECTION_LABELS[k] + "</button>"; }).join("") + '</div>' +
      '<div class="ov-search"><input id="ov-filter-search" value="' + escAttr(state.filters.query) + '" placeholder="Søk i forslag"></div></div>' +
      '<div class="ov-toolbar-right"><select id="ov-filter-category"><option value="all">Alle kategorier</option>' + categoryOptions(state.filters.category) + '</select><select id="ov-filter-priority"><option value="all">Alle nivåer</option>' + priorityFilterOptions(section) + "</select>" + displayFilter +
      '<button class="btn btn--primary btn--sm" data-action="add-item">+ Legg til</button></div></div>' +
      (state.filters.display === "new" && section !== "dependencies" ? '<div class="ov-note ov-warning-note">Nye forslag må vurderes før de blir en del av oversikten.</div>' : "") + viewToggle + content;
  }
  function renderItemList(items, section) {
    if (!items.length) return '<div class="ov-card ov-empty">Ingen punkter samsvarer med filtrene.</div>';
    return '<div class="ov-card ov-list"><div class="ov-list-head"><span>Punkt</span><span>Status</span><span>' + (section === "impacts" ? "Påvirkning" : "Prioritet") + '</span><span>Handling</span></div>' +
      items.map(function (item) {
        var active = item.approvalStatus === "approved";
        return '<div class="ov-list-row ' + (item.approvalStatus === "rejected" ? "ov-list-row-rejected" : "") + '" data-item-id="' + item.id + '"><button type="button" class="ov-list-title" data-action="details" data-id="' + item.id + '"><strong>' + esc(item.title) + "</strong><span>" + esc(CATEGORIES[item.category]) + " · " + esc(item.description) + "</span></button>" +
          '<div class="ov-list-status"><span class="ov-chip ov-chip-' + inclusionChipClass(item) + '">' + inclusionLabel(item) + "</span>" + (section === "dependencies" && active ? '<span class="ov-chip ov-chip-' + item.status + '">' + STATUSES[item.status] + "</span>" : "") + "</div>" +
          prioritySelect(item, section) +
          '<div class="ov-list-actions"><button type="button" class="btn ' + (active ? "btn--primary" : "btn--ghost") + ' btn--sm" data-action="approve" data-id="' + item.id + '">' + (active ? "✓ Tatt med" : "Ta med") + '</button><button type="button" class="btn btn--ghost btn--sm" data-action="reject" data-id="' + item.id + '"' + (item.approvalStatus === "rejected" ? " disabled" : "") + ">" + (item.approvalStatus === "rejected" ? "Fjernet" : "Fjern") + "</button>" +
          (section === "dependencies" && active ? dependencyActionButton(item) : "") + "</div></div>";
      }).join("") + "</div>";
  }
  function renderItemCard(item, section) {
    var level = section === "impacts" ? item.impactLevel : item.priority;
    var levelLabel = section === "impacts" ? IMPACT_LEVELS[level] : PRIORITIES[level];
    var progress = section === "dependencies" && item.approvalStatus === "approved" ? '<div class="ov-item-flow-actions"><button type="button" class="btn btn--ghost btn--sm" data-action="edit-flow-node" data-id="' + item.id + '">Endre flyt</button>' + dependencyActionButton(item) + "</div>" : "";
    return '<article class="ov-card ov-item-card ' + (item.approvalStatus === "rejected" ? "ov-rejected" : "") + " " + (item.important ? "ov-important" : "") + " " + (item.locked ? "ov-locked" : "") + '"><div class="ov-card-kicker"><span class="ov-chip">' + esc(CATEGORIES[item.category]) + "</span><span>" + (item.important ? '<span aria-hidden="true">★</span><span class="ov-sr-only">Høy prioritet</span>' : "") + '</span></div><div><h3>' + esc(item.title) + "</h3><p>" + esc(item.description) + '</p></div><div class="ov-item-meta"><span class="ov-chip ov-chip-' + (section === "impacts" ? "impact-" : "") + level + '">' + levelLabel + '</span><span class="ov-chip ov-chip-' + inclusionChipClass(item) + '">' + inclusionLabel(item) + "</span>" +
      (section === "dependencies" && item.approvalStatus === "approved" ? '<span class="ov-chip ov-chip-' + item.status + '">' + STATUSES[item.status] + "</span>" : "") + (item.source === "custom" ? '<span class="ov-chip ov-chip-custom">Eget punkt</span>' : "") + (item.isNew ? '<span class="ov-chip ov-chip-new">Nytt forslag</span>' : "") + (item.duplicateOf ? '<span class="ov-chip ov-chip-high">Ligner et eksisterende punkt</span>' : "") + '</div><div class="ov-item-reason"><strong>Kan være relevant fordi:</strong> ' + esc(item.reason) + "</div>" + progress +
      '<div class="ov-item-actions"><button type="button" class="btn ' + (item.approvalStatus === "approved" ? "btn--primary" : "btn--ghost") + ' btn--sm" data-action="approve" data-id="' + item.id + '">' + (item.approvalStatus === "approved" ? "✓ Tatt med" : "Ta med") + '</button><button type="button" class="btn btn--ghost btn--sm" data-action="details" data-id="' + item.id + '">Vis hvorfor</button><button type="button" class="btn btn--ghost btn--sm" data-action="edit" data-id="' + item.id + '">Rediger</button><button type="button" class="btn btn--ghost btn--sm" data-action="reject" data-id="' + item.id + '"' + (item.approvalStatus === "rejected" ? " disabled" : "") + ">" + (item.approvalStatus === "rejected" ? "Fjernet" : "Fjern") + "</button></div></article>";
  }

  /* =========================================================================
     KART
     ====================================================================== */
  function renderMaps() {
    var help = state.mapType === "dependencies"
      ? '<div class="ov-map-help"><strong>Slik fungerer flyten:</strong> «Aktiv» betyr at steget er tatt med i oversikten. «Klar», «Pågår», «Ferdig» og «Blokkert» viser fremdriften. En pil betyr at steget til høyre er avhengig av steget til venstre. Når et obligatorisk foregående steg blir markert ferdig, blir neste steg automatisk klart.</div>'
      : '<div class="ov-map-help"><strong>Slik fungerer konsekvenskartet:</strong> Planen står i sentrum. Kort rundt viser områder som kan bli påvirket. Linjen viser bare sammenheng, mens merket på kortet viser lav, middels eller høy påvirkning. Dette er ikke en risikovurdering.</div>';
    return '<div class="ov-card ov-map-toolbar"><div class="ov-segment"><button type="button" data-map-type="dependencies" aria-pressed="' + (state.mapType === "dependencies") + '">Avhengighetskart</button><button type="button" data-map-type="impacts" aria-pressed="' + (state.mapType === "impacts") + '">Konsekvenskart</button></div>' +
      '<div class="ov-inline-actions"><button class="btn btn--ghost btn--sm" data-action="fit-map">Tilpass visning</button>' + (state.mapType === "dependencies" ? '<button class="btn btn--primary btn--sm" data-action="edit-flow">Endre flyt</button>' : '<button class="btn btn--primary btn--sm" data-action="add-relation">Legg til sammenheng</button>') + "</div></div>" +
      help + '<div class="ov-card ov-map-wrap">' + (state.mapType === "dependencies" ? renderDependencyMap() : renderImpactMap()) + "</div>";
  }
  function layoutDependency(nodes, edges) {
    var nodeSet = {}; nodes.forEach(function (n) { nodeSet[n.id] = true; });
    var indeg = {}; nodes.forEach(function (n) { indeg[n.id] = 0; });
    edges.filter(function (e) { return nodeSet[e.from] && nodeSet[e.to]; }).forEach(function (e) { indeg[e.to]++; });
    var levels = {};
    var queue = nodes.filter(function (n) { return indeg[n.id] === 0; }).map(function (n) { return n.id; });
    queue.forEach(function (id) { levels[id] = 0; });
    var guard = 0;
    while (queue.length && guard++ < 1000) {
      var id = queue.shift();
      edges.filter(function (e) { return e.from === id && nodeSet[e.to]; }).forEach(function (e) {
        levels[e.to] = Math.max(levels[e.to] || 0, (levels[id] || 0) + 1);
        indeg[e.to]--;
        if (indeg[e.to] <= 0) queue.push(e.to);
      });
    }
    nodes.forEach(function (n, i) { if (levels[n.id] == null) levels[n.id] = i; });
    var groups = {};
    nodes.forEach(function (n) { (groups[levels[n.id]] = groups[levels[n.id]] || []).push(n); });
    var colW = 230, rowH = 280, pad = 30, positions = {};
    Object.keys(groups).forEach(function (lvl) { groups[lvl].forEach(function (n, i) { positions[n.id] = { x: pad + (+lvl) * colW, y: pad + i * rowH }; }); });
    var maxLvl = Math.max.apply(null, Object.keys(groups).map(Number).concat([0]));
    var maxGroupSize = Math.max.apply(null, Object.keys(groups).map(function (k) { return groups[k].length; }).concat([1]));
    return { positions: positions, width: Math.max(760, pad * 2 + (maxLvl + 1) * colW), height: Math.max(500, pad * 2 + maxGroupSize * rowH) };
  }
  function renderDependencyMap() {
    var nodes = orderedDependencyNodes();
    if (!nodes.length) return '<div class="ov-card ov-empty">Ingen aktive steg i flyten ennå. Ta med steg i analyseverkstedet for å se dem her.</div>';
    var layout = layoutDependency(nodes, state.analysis.dependencyEdges);
    return '<div class="ov-map-stage" id="ov-dependency-stage" style="min-width:' + layout.width + 'px;min-height:' + layout.height + 'px"><svg id="ov-dependency-svg" width="' + layout.width + '" height="' + layout.height + '" aria-hidden="true"><defs><marker id="ov-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path class="ov-edge-arrow" d="M0,0 L8,4 L0,8 z"></path></marker></defs></svg>' +
      nodes.map(function (n) {
        var p = layout.positions[n.id];
        return '<div class="ov-node ' + (n.status === "blocked" ? "ov-node-blocked" : "") + " " + (n.milestone ? "ov-node-milestone" : "") + '" data-node-id="' + n.id + '" style="left:' + p.x + "px;top:" + p.y + 'px"><strong>' + esc(n.title) + "</strong><small>" + esc(n.description) + '</small><span class="ov-node-badges"><span class="ov-chip ov-chip-' + (n.approvalStatus || "suggested") + '">' + inclusionLabel(n) + '</span><span class="ov-chip ov-chip-' + n.status + '">' + STATUSES[n.status] + "</span>" + (n.milestone ? '<span class="ov-chip">Milepæl</span>' : "") + '</span><div class="ov-node-actions"><button type="button" class="btn btn--ghost btn--sm" data-action="details" data-id="' + n.id + '">Detaljer</button><button type="button" class="btn btn--ghost btn--sm" data-action="edit-flow-node" data-id="' + n.id + '">Endre flyt</button>' + dependencyActionButton(n) + "</div></div>";
      }).join("") + '<div class="ov-map-mobile-flow">' + nodes.map(function (n, i2) { return '<div class="ov-mobile-node"><span class="ov-mobile-dot">' + (i2 + 1) + '</span><div class="ov-mobile-card"><strong>' + esc(n.title) + "</strong><br><small>" + esc(n.description) + '</small><br><span class="ov-chip ov-chip-' + (n.approvalStatus || "suggested") + '">' + inclusionLabel(n) + '</span> <span class="ov-chip ov-chip-' + n.status + '">' + STATUSES[n.status] + '</span><div class="ov-node-actions"><button type="button" class="btn btn--ghost btn--sm" data-action="details" data-id="' + n.id + '">Detaljer</button><button type="button" class="btn btn--ghost btn--sm" data-action="edit-flow-node" data-id="' + n.id + '">Endre flyt</button>' + dependencyActionButton(n) + "</div></div></div>"; }).join("") + "</div></div>" +
      '<details class="ov-card ov-map-text-list"><summary>Tekstversjon av avhengighetene</summary><ul>' + nodes.map(function (n) { return "<li><strong>" + esc(n.title) + "</strong>" + (n.dependsOn.length ? " – avhengig av " + n.dependsOn.map(function (id) { var f = findItem(id); return esc(f ? f.item.title : id); }).join(", ") : " – startpunkt") + "</li>"; }).join("") + "</ul></details>";
  }
  function renderImpactMap() {
    var impacts = state.analysis.impacts.filter(activeItem).slice(0, 8);
    if (!impacts.length) return '<div class="ov-card ov-empty">Ingen aktive påvirkningsområder ennå. Ta med punkter i analyseverkstedet for å se dem her.</div>';
    return '<div class="ov-impact-stage" id="ov-impact-stage"><svg id="ov-impact-svg" aria-hidden="true"></svg><div class="ov-impact-center"><strong>' + esc(state.analysis.title) + '</strong><span>Mulig påvirkning</span></div>' +
      impacts.map(function (x, i2) { return '<button type="button" class="ov-impact-node" data-impact-id="' + x.id + '" data-level="' + x.impactLevel + '" data-slot="' + i2 + '" data-action="details" data-id="' + x.id + '"><strong>' + esc(x.title) + "</strong><small>" + esc(x.description) + '</small><span class="ov-chip ov-chip-impact-' + x.impactLevel + '">' + IMPACT_LEVELS[x.impactLevel] + " påvirkning</span></button>"; }).join("") + "</div>" +
      '<details class="ov-card ov-map-text-list"><summary>Tekstversjon av påvirkningskartet</summary><ul>' + impacts.map(function (x) { return "<li><strong>" + esc(x.title) + "</strong> – " + esc(x.description) + "</li>"; }).join("") + "</ul></details>";
  }
  function drawMapLines() { if (state.mapType === "dependencies") drawDependencyLines(); else drawImpactLines(); }
  function drawDependencyLines() {
    var stage = $("#ov-dependency-stage"), svg = $("#ov-dependency-svg");
    if (!stage || !svg) return;
    $$(".ov-edge", svg).forEach(function (e) { e.remove(); });
    var rect = stage.getBoundingClientRect();
    state.analysis.dependencyEdges.forEach(function (edge) {
      var from = stage.querySelector('[data-node-id="' + cssEscape(edge.from) + '"]'), to = stage.querySelector('[data-node-id="' + cssEscape(edge.to) + '"]');
      if (!from || !to) return;
      var a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
      var x1 = a.right - rect.left + stage.scrollLeft, y1 = a.top + a.height / 2 - rect.top + stage.scrollTop, x2 = b.left - rect.left + stage.scrollLeft, y2 = b.top + b.height / 2 - rect.top + stage.scrollTop;
      var dx = Math.max(60, (x2 - x1) * 0.5, Math.abs(y2 - y1) * 0.4);
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M" + x1 + "," + y1 + " C" + (x1 + dx) + "," + y1 + " " + (x2 - dx) + "," + y2 + " " + x2 + "," + y2);
      path.setAttribute("class", "ov-edge " + (edge.type === "recommended-before" ? "ov-edge-recommended" : ""));
      path.setAttribute("marker-end", "url(#ov-arrow)");
      svg.appendChild(path);
    });
  }
  function drawImpactLines() {
    var stage = $("#ov-impact-stage"), svg = $("#ov-impact-svg");
    if (!stage || !svg) return;
    var center = stage.querySelector(".ov-impact-center");
    if (!center) return;
    svg.innerHTML = "";
    var rect = stage.getBoundingClientRect(), c = center.getBoundingClientRect(), x1 = c.left + c.width / 2 - rect.left, y1 = c.top + c.height / 2 - rect.top;
    $$("[data-impact-id]", stage).forEach(function (node) {
      var b = node.getBoundingClientRect(), x2 = b.left + b.width / 2 - rect.left, y2 = b.top + b.height / 2 - rect.top;
      var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1); line.setAttribute("y1", y1); line.setAttribute("x2", x2); line.setAttribute("y2", y2);
      line.setAttribute("class", "ov-impact-line ov-impact-line-" + (node.dataset.level || "medium"));
      svg.appendChild(line);
    });
  }
  function cssEscape(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }

  /* =========================================================================
     OPPSUMMERING
     ====================================================================== */
  function summaryList(items, empty, impact) {
    if (!items.length) return "<p>" + empty + "</p>";
    return "<ul>" + items.map(function (x) { return "<li><strong>" + esc(x.title) + "</strong>" + (impact ? " (" + IMPACT_LEVELS[x.impactLevel].toLowerCase() + " påvirkning)" : "") + " – " + esc(x.description) + "</li>"; }).join("") + "</ul>";
  }
  function renderSummary() {
    var a = state.analysis;
    var needs = a.needs.filter(activeItem), nodes = orderedDependencyNodes(), impacts = a.impacts.filter(activeItem), blinds = a.blindSpots.filter(activeItem);
    return '<div class="ov-summary-actions"><button class="btn btn--ghost btn--sm" data-action="export-text">Eksporter tekst</button><button class="btn btn--ghost btn--sm" data-action="export-json">Eksporter JSON</button><button class="btn btn--primary btn--sm" data-action="print">Skriv ut</button></div>' +
      '<article class="ov-card ov-summary-document"><div class="ov-kicker">Oppsummering</div><h2>' + esc(a.title) + "</h2><p>" + esc(a.description) + '</p><div class="ov-note">' + esc(a.disclaimer) + "</div>" +
      "<h3>Viktigste behov</h3>" + summaryList(needs, "Ingen behov er tatt med ennå.") +
      "<h3>Foreslått rekkefølge</h3>" + (nodes.length ? "<ol>" + nodes.map(function (n) { return "<li><strong>" + esc(n.title) + "</strong> – " + esc(n.description) + "</li>"; }).join("") + "</ol>" : "<p>Ingen avhengighetssteg er valgt.</p>") +
      "<h3>Viktigste påvirkningsområder</h3>" + summaryList(impacts, "Ingen påvirkningsområder er tatt med ennå.", true) +
      "<h3>Mulige glemte punkter</h3>" + summaryList(blinds, "Ingen glemte punkter er tatt med ennå.") +
      "<h3>Neste steg</h3><ol>" + a.nextSteps.map(function (x) { return "<li><strong>" + esc(x.title) + "</strong> – " + esc(x.description) + "</li>"; }).join("") + "</ol></article>";
  }
  function exportText() {
    var a = state.analysis;
    var needs = a.needs.filter(activeItem), nodes = orderedDependencyNodes(), impacts = a.impacts.filter(activeItem), blinds = a.blindSpots.filter(activeItem);
    var lines = [a.title, new Array(a.title.length + 1).join("="), "", "Situasjon: " + a.description, "", a.disclaimer, "", "VIKTIGSTE BEHOV"]
      .concat(needs.map(function (x) { return "- " + x.title + ": " + x.description; }), ["", "FORESLÅTT REKKEFØLGE"], nodes.map(function (x, i2) { return (i2 + 1) + ". " + x.title + ": " + x.description; }),
        ["", "PÅVIRKNINGSOMRÅDER"], impacts.map(function (x) { return "- " + x.title + " (" + IMPACT_LEVELS[x.impactLevel] + "): " + x.description; }),
        ["", "MULIGE GLEMTE PUNKTER"], blinds.map(function (x) { return "- " + x.title + ": " + x.description; }),
        ["", "NESTE STEG"], a.nextSteps.map(function (x, i2) { return (i2 + 1) + ". " + x.title + ": " + x.description; }));
    download(slug(a.title) + "-oversikt.txt", lines.join("\n"), "text/plain;charset=utf-8");
    toast("Eksporten er klar.");
  }
  function exportJSON() {
    var a = state.analysis, activeNodes = orderedDependencyNodes(), nodeIds = {};
    activeNodes.forEach(function (n) { nodeIds[n.id] = true; });
    var exportAnalysis = Object.assign({}, a, {
      needs: a.needs.filter(activeItem), dependencyNodes: activeNodes,
      dependencyEdges: a.dependencyEdges.filter(function (e) { return nodeIds[e.from] && nodeIds[e.to]; }),
      impacts: a.impacts.filter(activeItem), blindSpots: a.blindSpots.filter(activeItem),
    });
    download(slug(a.title) + "-oversikt.json", JSON.stringify({ input: state.input, analysis: exportAnalysis }, null, 2), "application/json");
    toast("Eksporten er klar.");
  }
  function download(name, content, type) {
    try {
      var blob = new Blob([content], { type: type }), url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { toast("Eksporten mislyktes.", "error"); }
  }

  /* =========================================================================
     MODAL
     ====================================================================== */
  var modalEl = null, lastFocus = null;
  function openModal(html, binder) {
    if (!modalEl) return;
    lastFocus = document.activeElement;
    modalEl.innerHTML = '<div class="ov-modal-backdrop" role="presentation">' + html + "</div>";
    var modal = modalEl.querySelector(".ov-modal");
    modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
    modalEl.querySelector(".ov-modal-backdrop").addEventListener("mousedown", function (e) { if (e.target === e.currentTarget) closeModal(); });
    document.addEventListener("keydown", modalKeydown);
    if (binder) binder(modalEl);
    requestAnimationFrame(function () { var el = modalEl.querySelector("input,button,select,textarea"); if (el) el.focus(); });
  }
  function closeModal() {
    if (!modalEl || !modalEl.innerHTML) return;
    modalEl.innerHTML = "";
    document.removeEventListener("keydown", modalKeydown);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }
  function modalKeydown(e) {
    if (!modalEl || !modalEl.innerHTML) return;
    if (e.key === "Escape") { closeModal(); return; }
    if (e.key !== "Tab") return;
    var focusable = $$("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])", modalEl);
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function openDetails(id) {
    var found = findItem(id);
    if (!found) return;
    var item = found.item, section = found.section, related = relatedItems(item);
    openModal('<div class="ov-modal"><div class="ov-modal-head"><div><div class="ov-kicker">' + SECTION_LABELS[section] + "</div><h2>" + esc(item.title) + '</h2></div><button class="btn btn--ghost btn--sm" data-modal-close aria-label="Lukk">×</button></div>' +
      '<div class="ov-modal-body"><div><span class="ov-chip">' + esc(CATEGORIES[item.category]) + '</span> <span class="ov-chip ov-chip-' + (item.approvalStatus || "suggested") + '">' + inclusionLabel(item) + "</span>" + (section === "dependencies" ? ' <span class="ov-chip ov-chip-' + item.status + '">' + STATUSES[item.status] + "</span>" : "") + "</div>" +
      "<div><strong>Forklaring</strong><p>" + esc(item.description) + '</p></div><div class="ov-note"><strong>Hvorfor dette kan være relevant</strong><br>' + esc(item.reason) + "</div>" +
      (section === "impacts" ? '<div><strong>Mulige følger</strong><div class="ov-consequence-list">' + item.consequences.map(function (x) { return '<div class="ov-consequence">' + esc(x) + "</div>"; }).join("") + "</div></div>" : "") +
      '<div><h3>Sammenhenger</h3><p>Dette punktet henger sammen med ' + related.length + ' andre deler av oversikten.</p><div class="ov-related-list">' +
      (related.map(function (r) { return '<div class="ov-related"><span><strong>' + esc(r.item.title) + "</strong><span>" + SECTION_LABELS[r.section] + " · " + CATEGORIES[r.item.category] + '</span></span><button class="btn btn--ghost btn--sm" data-remove-relation="' + r.item.id + '" data-from="' + item.id + '">Fjern</button></div>'; }).join("") || "<p>Ingen direkte sammenhenger er lagt til.</p>") + "</div></div>" +
      '<div class="ov-inline-actions"><button type="button" class="btn btn--ghost btn--sm" data-detail-edit="' + item.id + '">Rediger</button><button type="button" class="btn btn--ghost btn--sm" data-detail-lock="' + item.id + '" aria-pressed="' + item.locked + '" title="Beholder punktet og egne endringer når analysen oppdateres">' + (item.locked ? "Fjern bevaring" : "Bevar ved ny analyse") + '</button><button type="button" class="btn btn--ghost btn--sm" data-detail-duplicate="' + item.id + '">Dupliser</button>' +
      (section === "blindSpots" ? '<button class="btn btn--ghost btn--sm" data-convert="needs" data-id="' + item.id + '">Legg til som behov</button><button class="btn btn--ghost btn--sm" data-convert="dependencies" data-id="' + item.id + '">Legg til som steg</button><button class="btn btn--ghost btn--sm" data-convert="impacts" data-id="' + item.id + '">Legg til som påvirkning</button>' : "") +
      (section === "needs" ? '<button class="btn btn--ghost btn--sm" data-convert="dependencies" data-id="' + item.id + '">Konverter til steg</button>' : "") +
      (section === "dependencies" ? '<button type="button" class="btn btn--ghost btn--sm" data-detail-move="flow" data-id="' + item.id + '">Endre flyt</button>' : "") +
      '<button type="button" class="btn btn--danger btn--sm" data-detail-delete="' + item.id + '">Slett permanent</button></div></div>' +
      '<div class="ov-modal-foot"><button type="button" class="btn btn--ghost btn--sm" data-modal-close>Lukk</button>' +
      (item.approvalStatus === "approved" ? '<button type="button" class="btn btn--ghost btn--sm" data-detail-reject="' + item.id + '">Fjern fra oversikten</button>' : '<button type="button" class="btn btn--primary btn--sm" data-detail-approve="' + item.id + '">Ta med</button>') + "</div></div>", bindDetailModal);
  }
  function bindDetailModal(root) {
    root.addEventListener("click", function (e) {
      if (e.target.closest("[data-modal-close]")) { closeModal(); return; }
      var edit = e.target.closest("[data-detail-edit]"); if (edit) { var eid = edit.dataset.detailEdit; closeModal(); openEdit(eid); return; }
      var lock = e.target.closest("[data-detail-lock]");
      if (lock) {
        var lid = lock.dataset.detailLock, lf = findItem(lid);
        if (!lf) return;
        lf.item.locked = !lf.item.locked;
        save(); renderCurrentView(); openDetails(lid);
        toast(lf.item.locked ? "Punktet bevares ved ny analyse." : "Punktet følger vanlige oppdateringsregler.");
        return;
      }
      var dup = e.target.closest("[data-detail-duplicate]");
      if (dup) { var newId = duplicateItem(dup.dataset.detailDuplicate); if (newId) { closeModal(); openEdit(newId); } return; }
      var rem = e.target.closest("[data-remove-relation]");
      if (rem) { var from = rem.dataset.from; removeRelation(from, rem.dataset.removeRelation); openDetails(from); return; }
      var move = e.target.closest("[data-detail-move]");
      if (move) { var mid = move.dataset.id; closeModal(); openFlowModal(mid); return; }
      var del = e.target.closest("[data-detail-delete]");
      if (del) { if (deleteItem(del.dataset.detailDelete)) closeModal(); return; }
      var approve = e.target.closest("[data-detail-approve]");
      if (approve) { updateStatus(approve.dataset.detailApprove, "approved"); closeModal(); return; }
      var reject = e.target.closest("[data-detail-reject]");
      if (reject) { updateStatus(reject.dataset.detailReject, "rejected"); closeModal(); return; }
      var convert = e.target.closest("[data-convert]");
      if (convert) { convertItem(convert.dataset.id, convert.dataset.convert); closeModal(); return; }
    });
  }
  function openEdit(id) {
    var found = findItem(id);
    if (!found) return;
    openModal(editFormHTML(found.item, found.section, "Rediger punkt"), function (root) { bindEditForm(root, found.item.id, found.section); });
  }
  function openAdd() {
    var section = state.workshopSection, id = "custom-" + Date.now();
    var item = {
      id: id, title: "", description: "", reason: "Eget punkt lagt til av brukeren.", category: "custom", priority: "normal", impactLevel: "medium",
      status: section === "dependencies" ? "not-started" : "approved", source: "custom", selected: true, approvalStatus: "approved", locked: false,
      important: false, relatedIds: [], dependsOn: [], blocks: [], consequences: [],
    };
    openModal(editFormHTML(item, section, "Legg til nytt punkt"), function (root) { bindEditForm(root, id, section, true, item); });
  }
  function editFormHTML(item, section, title) {
    var flowInfo = section === "dependencies" ? '<div class="ov-note"><strong>Fremdrift og avhengigheter</strong><br>Statusene Klar og Blokkert beregnes fra flyten. Bruk «Endre flyt» i detaljpanelet eller kartet for å endre hvilke steg som må skje først.</div>' : "";
    return '<form class="ov-modal" id="ov-edit-form"><div class="ov-modal-head"><div><div class="ov-kicker">' + SECTION_LABELS[section] + "</div><h2>" + title + '</h2></div><button type="button" class="btn btn--ghost btn--sm" data-modal-close aria-label="Lukk">×</button></div>' +
      '<div class="ov-modal-body"><div class="ov-field"><label for="ov-edit-title">Tittel</label><input id="ov-edit-title" name="title" value="' + escAttr(item.title) + '" required maxlength="100"></div>' +
      '<div class="ov-field"><label for="ov-edit-description">Kort forklaring</label><textarea id="ov-edit-description" name="description" required>' + esc(item.description) + "</textarea></div>" +
      '<div class="ov-field"><label for="ov-edit-reason">Hvorfor kan dette være relevant?</label><textarea id="ov-edit-reason" name="reason">' + esc(item.reason) + "</textarea></div>" +
      '<div class="ov-form-row"><div class="ov-field"><label for="ov-edit-category">Kategori</label><select id="ov-edit-category" name="category">' + categoryOptions(item.category) + "</select></div>" +
      (section === "impacts"
        ? '<div class="ov-field"><label for="ov-edit-impact">Påvirkningsgrad</label><select id="ov-edit-impact" name="impactLevel">' + Object.keys(IMPACT_LEVELS).map(function (k) { return '<option value="' + k + '" ' + (item.impactLevel === k ? "selected" : "") + ">" + IMPACT_LEVELS[k] + "</option>"; }).join("") + "</select></div>"
        : '<div class="ov-field"><label for="ov-edit-priority">Prioritet</label><select id="ov-edit-priority" name="priority">' + Object.keys(PRIORITIES).map(function (k) { return '<option value="' + k + '" ' + (item.priority === k ? "selected" : "") + ">" + PRIORITIES[k] + "</option>"; }).join("") + "</select></div>") +
      '</div><div class="ov-field"><label>Bevaring</label><label class="ov-check"><input type="checkbox" name="locked" ' + (item.locked ? "checked" : "") + "> Bevar punktet ved ny analyse</label><small>Bruk dette for egne endringer som ikke skal erstattes av nye forslag.</small></div>" + flowInfo +
      '</div><div class="ov-modal-foot"><button type="button" class="btn btn--ghost btn--sm" data-modal-close>Avbryt</button><button class="btn btn--primary btn--sm" type="submit">Lagre punkt</button></div></form>';
  }
  function bindEditForm(root, id, section, isNew, newItem) {
    root.addEventListener("click", function (e) { if (e.target.closest("[data-modal-close]")) closeModal(); });
    $("#ov-edit-form", root).addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.currentTarget), target;
      if (isNew) { target = Object.assign({}, newItem); (section === "dependencies" ? state.analysis.dependencyNodes : state.analysis[section]).push(target); }
      else target = findItem(id).item;
      target.title = String(fd.get("title") || "").trim();
      target.description = String(fd.get("description") || "").trim();
      target.reason = String(fd.get("reason") || "").trim() || "Kan være relevant å vurdere.";
      target.category = String(fd.get("category") || "custom");
      target.priority = String(fd.get("priority") || target.priority || "normal");
      target.impactLevel = String(fd.get("impactLevel") || target.impactLevel || "medium");
      target.locked = fd.get("locked") === "on";
      target.isNew = false;
      target.approvalStatus = target.approvalStatus || "approved";
      target.selected = target.approvalStatus !== "rejected";
      if (section === "dependencies") { target.status = target.status || "not-started"; connectNodes(state.analysis.dependencyNodes, state.analysis.dependencyEdges); syncDependencyStatuses(); }
      else if (target.approvalStatus === "approved") target.status = "approved";
      save(); closeModal(); renderCurrentView(); toast("Punktet er lagret.");
    });
  }
  function duplicateItem(id) {
    var now = Date.now();
    if (lastDuplicate.id === id && now - lastDuplicate.at < 900) return null;
    lastDuplicate = { id: id, at: now };
    var found = findItem(id);
    if (!found) return null;
    var copy = deepClone(found.item);
    copy.id = copy.id + "-copy-" + now + "-" + Math.random().toString(36).slice(2, 6);
    copy.title = copy.title.replace(/\s[–-]\s*kopi(?:\s*\d+)?$/i, "") + " – kopi";
    copy.source = "custom"; copy.locked = false; copy.important = false; copy.approvalStatus = "approved"; copy.selected = true; copy.relatedIds = []; copy.isNew = false;
    if (found.section === "dependencies") { copy.status = "not-started"; copy.dependsOn = []; copy.blocks = []; copy.milestone = false; } else copy.status = "approved";
    found.list.push(copy);
    if (found.section === "dependencies") syncDependencyStatuses();
    save(); renderCurrentView(); toast("Én kopi er opprettet.");
    return copy.id;
  }
  function deleteItem(id) {
    var found = findItem(id);
    if (!found) return false;
    if (found.item.locked) { toast("Lås opp punktet før du sletter det.", "error"); return false; }
    if (!confirm('Slette «' + found.item.title + '» permanent? Eventuelle koblinger til andre punkter fjernes også. Dette kan ikke angres.')) return false;
    found.list.splice(found.list.findIndex(function (x) { return x.id === id; }), 1);
    state.analysis.dependencyEdges = state.analysis.dependencyEdges.filter(function (e) { return e.from !== id && e.to !== id; });
    allItems().forEach(function (x) { var f = findItem(x.id); if (f) f.item.relatedIds = (f.item.relatedIds || []).filter(function (r) { return r !== id; }); });
    connectNodes(state.analysis.dependencyNodes, state.analysis.dependencyEdges);
    syncDependencyStatuses(); save(); renderCurrentView(); toast("Punktet er slettet.");
    return true;
  }
  function convertItem(id, destination) {
    var found = findItem(id);
    if (!found) return;
    var src = found.item, copy = Object.assign(deepClone(src), { id: "custom-" + destination + "-" + Date.now(), source: "custom", status: "approved", selected: true, approvalStatus: "approved", isNew: false, relatedIds: [src.id] });
    src.relatedIds = uniq((src.relatedIds || []).concat(copy.id));
    if (destination === "needs") { copy.priority = copy.priority || "normal"; state.analysis.needs.push(copy); }
    if (destination === "dependencies") { copy.status = "not-started"; copy.dependsOn = []; copy.blocks = []; copy.milestone = false; state.analysis.dependencyNodes.push(copy); }
    if (destination === "impacts") { copy.impactLevel = "medium"; copy.consequences = [copy.description]; state.analysis.impacts.push(copy); }
    save(); renderCurrentView();
    toast("Punktet er lagt til som " + (destination === "needs" ? "behov" : destination === "dependencies" ? "steg" : "påvirkning") + ".");
  }
  function openFlowModal(focusId) {
    var nodes = state.analysis.dependencyNodes.filter(activeItem), focus = focusId ? (findItem(focusId) || {}).item : null;
    var incoming = focus ? state.analysis.dependencyEdges.filter(function (e) { return e.to === focus.id; }) : [];
    var existing = focus
      ? '<div class="ov-field"><label>Eksisterende steg før dette</label><div class="ov-related-list">' + (incoming.length ? incoming.map(function (e) { var ff = findItem(e.from); return '<div class="ov-related"><span><strong>' + esc(ff ? ff.item.title : e.from) + "</strong><span>" + (e.type === "required-before" ? "Obligatorisk før" : "Anbefalt før") + '</span></span><button type="button" class="btn btn--ghost btn--sm" data-remove-flow-edge="' + e.id + '" data-focus-id="' + focus.id + '">Fjern</button></div>'; }).join("") : "<p>Ingen. Dette er et startpunkt.</p>") + "</div>" + (incoming.length ? '<button type="button" class="btn btn--ghost btn--sm" data-clear-flow-to="' + focus.id + '">Gjør til startpunkt</button>' : "") + "</div>"
      : "";
    openModal('<form class="ov-modal" id="ov-flow-form"><div class="ov-modal-head"><div><div class="ov-kicker">Avhengighetskart</div><h2>' + (focus ? "Endre flyt for «" + esc(focus.title) + "»" : "Endre flyt") + '</h2></div><button type="button" class="btn btn--ghost btn--sm" data-modal-close aria-label="Lukk">×</button></div>' +
      '<div class="ov-modal-body"><div class="ov-note"><strong>Kort forklart:</strong> En obligatorisk kobling gjør neste steg blokkert frem til det foregående steget er ferdig. En anbefalt kobling viser bare ønsket rekkefølge.</div>' + existing +
      (focus
        ? '<div class="ov-field"><label for="ov-flow-from">Legg til et steg som må skje før dette</label><select id="ov-flow-from" name="from"><option value="">Velg steg</option>' + nodes.filter(function (n) { return n.id !== focus.id && !incoming.some(function (e) { return e.from === n.id; }); }).map(function (n) { return '<option value="' + n.id + '">' + esc(n.title) + "</option>"; }).join("") + '</select></div><input type="hidden" name="to" value="' + focus.id + '">'
        : '<div class="ov-field"><label for="ov-flow-from">Foregående steg</label><select id="ov-flow-from" name="from"><option value="">Velg steg</option>' + nodes.map(function (n) { return '<option value="' + n.id + '">' + esc(n.title) + "</option>"; }).join("") + '</select></div><div class="ov-field"><label for="ov-flow-to">Neste steg</label><select id="ov-flow-to" name="to"><option value="">Velg steg</option>' + nodes.map(function (n) { return '<option value="' + n.id + '">' + esc(n.title) + "</option>"; }).join("") + "</select></div>") +
      '<div class="ov-field"><label for="ov-flow-type">Koblingstype</label><select id="ov-flow-type" name="type"><option value="required-before">Obligatorisk før – kan blokkere neste steg</option><option value="recommended-before">Anbefalt før – viser bare ønsket rekkefølge</option></select></div></div>' +
      '<div class="ov-modal-foot"><button type="button" class="btn btn--ghost btn--sm" data-modal-close>Avbryt</button><button type="submit" class="btn btn--primary btn--sm">' + (focus ? "Legg til kobling" : "Lagre flyt") + "</button></div></form>", function (root) {
      root.addEventListener("click", function (e) {
        if (e.target.closest("[data-modal-close]")) { closeModal(); return; }
        var remove = e.target.closest("[data-remove-flow-edge]");
        if (remove) { state.analysis.dependencyEdges = state.analysis.dependencyEdges.filter(function (edge) { return edge.id !== remove.dataset.removeFlowEdge; }); connectNodes(state.analysis.dependencyNodes, state.analysis.dependencyEdges); syncDependencyStatuses(); save(); renderCurrentView(); openFlowModal(remove.dataset.focusId); return; }
        var clear = e.target.closest("[data-clear-flow-to]");
        if (clear) { state.analysis.dependencyEdges = state.analysis.dependencyEdges.filter(function (edge) { return edge.to !== clear.dataset.clearFlowTo; }); connectNodes(state.analysis.dependencyNodes, state.analysis.dependencyEdges); syncDependencyStatuses(); save(); renderCurrentView(); openFlowModal(clear.dataset.clearFlowTo); return; }
      });
      $("#ov-flow-form", root).addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(e.currentTarget), from = String(fd.get("from") || ""), to = String(fd.get("to") || ""), type = String(fd.get("type") || "required-before");
        if (!from && !to) { closeModal(); return; }
        if (!from || !to || from === to) { toast("Velg to ulike steg.", "error"); return; }
        if (wouldCreateCycle(from, to)) { toast("Denne koblingen ville skapt en sirkel i flyten.", "error"); return; }
        state.analysis.dependencyEdges = state.analysis.dependencyEdges.filter(function (edge) { return !(edge.from === from && edge.to === to); });
        state.analysis.dependencyEdges.push({ id: "edge-" + Date.now(), from: from, to: to, type: type });
        connectNodes(state.analysis.dependencyNodes, state.analysis.dependencyEdges); syncDependencyStatuses(); save(); closeModal(); renderCurrentView(); toast("Flyten er oppdatert.");
      });
    });
  }
  function wouldCreateCycle(from, to) {
    var edges = state.analysis.dependencyEdges.concat([{ from: from, to: to }]);
    var adj = {};
    edges.forEach(function (e) { (adj[e.from] = adj[e.from] || []).push(e.to); });
    var seen = {}, stack = {};
    function visit(id) {
      if (stack[id]) return true;
      if (seen[id]) return false;
      seen[id] = true; stack[id] = true;
      for (var i = 0; i < (adj[id] || []).length; i++) if (visit(adj[id][i])) return true;
      stack[id] = false;
      return false;
    }
    return state.analysis.dependencyNodes.some(function (n) { return visit(n.id); });
  }
  function openRelationModal() {
    var items = allItems().filter(activeItem);
    openModal('<form class="ov-modal ov-modal-sm" id="ov-relation-form"><div class="ov-modal-head"><h2>Legg til sammenheng</h2><button type="button" class="btn btn--ghost btn--sm" data-modal-close aria-label="Lukk">×</button></div>' +
      '<div class="ov-modal-body"><div class="ov-field"><label for="ov-rel-from">Fra punkt</label><select id="ov-rel-from" name="from" required><option value="">Velg punkt</option>' + items.map(function (x) { return '<option value="' + x.id + '">' + SECTION_LABELS[x._section] + ": " + esc(x.title) + "</option>"; }).join("") + "</select></div>" +
      '<div class="ov-field"><label for="ov-rel-to">Til punkt</label><select id="ov-rel-to" name="to" required><option value="">Velg punkt</option>' + items.map(function (x) { return '<option value="' + x.id + '">' + SECTION_LABELS[x._section] + ": " + esc(x.title) + "</option>"; }).join("") + '</select></div><div class="ov-note">Sammenhengen vises begge veier i detaljpanelet.</div></div>' +
      '<div class="ov-modal-foot"><button type="button" class="btn btn--ghost btn--sm" data-modal-close>Avbryt</button><button type="submit" class="btn btn--primary btn--sm">Legg til</button></div></form>', function (root) {
      root.addEventListener("click", function (e) { if (e.target.closest("[data-modal-close]")) closeModal(); });
      $("#ov-relation-form", root).addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(e.currentTarget), from = fd.get("from"), to = fd.get("to");
        if (!from || !to || from === to) { toast("Velg to ulike punkt.", "error"); return; }
        addRelation(from, to); closeModal();
      });
    });
  }

  /* =========================================================================
     HENDINGSBINDING
     ====================================================================== */
  function bindShellEvents() {
    $("#ov-save-top").addEventListener("click", function () { save(true); });
    $("#ov-reset-top").addEventListener("click", function () { if (confirm("Vil du nullstille denne oversikten? Alle lokalt lagrede endringer blir slettet. Dette kan ikke angres.")) resetState(); });
    $("#ov-new-top").addEventListener("click", function () { if (confirm("Vil du starte en ny oversikt? Den lagrede analysen beholdes til du lager en ny.")) { pendingExistingAnalysis = null; state.analysis = null; state.currentView = "dashboard"; renderApp(); } });
    $("#ov-edit-source").addEventListener("click", editSource);
    $("#ov-update-analysis").addEventListener("click", handleUpdate);
    $$("[data-nav]").forEach(function (btn) { btn.addEventListener("click", function () { state.currentView = btn.dataset.nav; save(); renderCurrentView(); $$("[data-nav]").forEach(function (b) { b.setAttribute("aria-current", b.dataset.nav === state.currentView ? "page" : "false"); }); }); });
  }
  function bindViewEvents() {
    var root = $("#ov-view-root");
    root.onclick = handleViewClick;
    var search = $("#ov-filter-search", root);
    if (search) search.addEventListener("input", debounce(function (e) { state.filters.query = e.target.value; renderCurrentView(); }, 180));
    var catSel = $("#ov-filter-category", root); if (catSel) catSel.addEventListener("change", function (e) { state.filters.category = e.target.value; renderCurrentView(); });
    var prioSel = $("#ov-filter-priority", root); if (prioSel) prioSel.addEventListener("change", function (e) { state.filters.priority = e.target.value; renderCurrentView(); });
    var dispSel = $("#ov-filter-display", root); if (dispSel) dispSel.addEventListener("change", function (e) { state.filters.display = e.target.value; renderCurrentView(); });
    var flowFilter = $("#ov-filter-flow", root);
    if (flowFilter) flowFilter.addEventListener("toggle", function () { state.filters.flowMenuOpen = flowFilter.open; });
    $$("[data-flow-status]", root).forEach(function (cb) {
      cb.addEventListener("change", function (e) {
        var value = e.target.dataset.flowStatus, selected = {};
        (Array.isArray(state.filters.flowStatuses) ? state.filters.flowStatuses : []).forEach(function (s) { selected[s] = true; });
        if (e.target.checked) selected[value] = true; else delete selected[value];
        state.filters.flowStatuses = Object.keys(selected); state.filters.flowMenuOpen = true; save(); renderCurrentView();
      });
    });
    var showRej = $("#ov-show-rejected-flow", root);
    if (showRej) showRej.addEventListener("change", function (e) { state.filters.showRejectedFlow = e.target.checked; state.filters.flowMenuOpen = true; save(); renderCurrentView(); });
    $$("[data-item-priority]", root).forEach(function (select) {
      select.addEventListener("change", function (e) {
        var found = findItem(e.target.dataset.itemPriority);
        if (!found) return;
        if (e.target.dataset.section === "impacts") found.item.impactLevel = e.target.value; else found.item.priority = e.target.value;
        save(); renderCurrentView();
      });
    });
  }
  function handleViewClick(e) {
    var t = e.target.closest("button,[data-action],[data-go],[data-workshop-section],[data-workshop-view],[data-map-type]");
    if (!t) return;
    if (t.dataset.go) { state.currentView = t.dataset.go; renderApp(); return; }
    if (t.dataset.goMap) { state.currentView = "maps"; state.mapType = t.dataset.goMap; renderApp(); return; }
    if (t.dataset.workshopView) { state.workshopView = t.dataset.workshopView; save(); renderCurrentView(); return; }
    if (t.dataset.workshopSection) { state.currentView = "workshop"; state.workshopSection = t.dataset.workshopSection; state.filters.priority = "all"; state.filters.flowMenuOpen = false; renderApp(); return; }
    if (t.dataset.mapType) { state.mapType = t.dataset.mapType; renderCurrentView(); return; }
    var action = t.dataset.action, id = t.dataset.id;
    if (action === "details" || action === "show-why") openDetails(id);
    else if (action === "edit") openEdit(id);
    else if (action === "step-progress") updateDependencyProgress(id, t.dataset.nextStatus);
    else if (action === "approve") updateStatus(id, "approved");
    else if (action === "reject") updateStatus(id, "rejected");
    else if (action === "add-item") openAdd();
    else if (action === "add-relation") openRelationModal();
    else if (action === "edit-flow") openFlowModal();
    else if (action === "edit-flow-node") openFlowModal(id);
    else if (action === "fit-map") {
      var stage = $(".ov-map-stage", $("#ov-view-root")) || $(".ov-impact-stage", $("#ov-view-root"));
      if (stage) { var left = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2), top = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2); stage.scrollTo({ left: left, top: top, behavior: "smooth" }); }
      drawMapLines();
    }
    else if (action === "export-text") exportText();
    else if (action === "export-json") exportJSON();
    else if (action === "print") window.print();
  }

  /* =========================================================================
     TOASTS
     ====================================================================== */
  var toastsEl = null;
  function toast(text, type) {
    if (!toastsEl) return;
    var el = document.createElement("div");
    el.className = "ov-toast" + (type === "error" ? " ov-toast-error" : "");
    el.textContent = text;
    toastsEl.replaceChildren(el);
    setTimeout(function () { if (el.isConnected) el.remove(); }, 2200);
  }
  function renderFatal(err) {
    console.error("[oversikt]", err);
    if (contentEl) contentEl.innerHTML = '<div class="ov-card ov-empty"><strong>Oversikt kunne ikke starte riktig.</strong> Ingen data er slettet.<br><button type="button" class="btn btn--danger btn--sm" id="ov-safe-reset" style="margin-top:.6rem">Nullstill og last inn på nytt</button></div>';
    var btn = document.getElementById("ov-safe-reset");
    if (btn) btn.addEventListener("click", function () { App.store.set(STORE_KEY, null); location.reload(); });
  }

  /* =========================================================================
     CSS
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "#ov-root{--ov-blue-soft:color-mix(in srgb,var(--color-primary) 12%,var(--color-surface));--ov-purple-soft:#f0edf4;--ov-success:#2f7258;--ov-success-soft:#e8f3ee;--ov-warning:#946b22;--ov-warning-soft:#fbf2df;--ov-danger:#9a4a52;--ov-danger-soft:#faeaec;--ov-ink:color-mix(in srgb,var(--color-text) 82%,var(--color-muted) 18%);position:relative}",
      "#ov-root,#ov-root *{box-sizing:border-box}",
      // Mjukare "blekk" for feit tekst/overskrifter -- rå var(--color-text) er ofte nesten
      // svart, og saman med nettlesaren sin standard fete vekt vart alt frå kort-titlar til
      // modal-overskrifter unødig hardt (UX-tilbakemelding 2026-08-05). To unntak held fram
      // med kvit tekst på farga bakgrunn (sjå .ov-hero h1 og .ov-impact-center strong nedanfor),
      // sidan dei er meir spesifikke selektorar og difor vinn over denne globale regelen.
      "#ov-root strong,#ov-root h1,#ov-root h2,#ov-root h3{color:var(--ov-ink)}",
      "#ov-root strong:not(h1 strong):not(h2 strong):not(h3 strong){font-weight:650}",
      "#ov-root .ov-hidden{display:none!important}#ov-root .ov-sr-only{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important}",
      "#ov-root .ov-kicker{text-transform:uppercase;font-size:.72rem;letter-spacing:.09em;font-weight:800;color:var(--color-primary)}",
      "#ov-root .ov-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:14px}#ov-root .ov-panel{padding:1.1rem}",
      "#ov-root .ov-hero{background:linear-gradient(135deg,var(--color-primary),color-mix(in srgb,var(--color-primary) 60%,#1a2b45));color:#fff;padding:1.5rem;border-radius:16px;margin-bottom:1rem}",
      "#ov-root .ov-hero h1{font-size:1.5rem;margin:.3rem 0 .5rem;color:#fff}#ov-root .ov-hero p{margin:0;opacity:.92}#ov-root .ov-hero .ov-kicker{color:#dbe6f3}",
      "#ov-root .ov-start-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:1rem;align-items:start}",
      "#ov-root .ov-section-head{margin-bottom:.9rem}#ov-root .ov-section-head h2{margin:0 0 .2rem;font-size:1.05rem}#ov-root .ov-section-head p{margin:0;color:var(--color-muted);font-size:.85rem}",
      "#ov-root .ov-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:.9rem}#ov-root .ov-field{display:grid;gap:.35rem}#ov-root .ov-field-full{grid-column:1/-1}",
      "#ov-root .ov-field label,#ov-root .ov-fieldset legend{font-size:.85rem;font-weight:700}",
      "#ov-root .ov-field input,#ov-root .ov-field textarea,#ov-root .ov-field select{width:100%;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);border-radius:9px;padding:.55rem .6rem;min-height:44px;font:inherit}",
      "#ov-root .ov-field textarea{min-height:110px;resize:vertical}#ov-root .ov-field small{color:var(--color-muted);font-size:.75rem}",
      "#ov-root .ov-fieldset{border:0;padding:0;margin:0}#ov-root .ov-check-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}",
      "#ov-root .ov-check{display:flex;gap:.6rem;align-items:flex-start;padding:.6rem .65rem;border:1px solid var(--color-border);border-radius:9px;background:var(--color-bg);cursor:pointer;min-height:44px}",
      "#ov-root .ov-check input{flex:0 0 auto;width:19px;height:19px;margin-top:2px}",
      "#ov-root .ov-error{color:var(--ov-danger);font-size:.78rem;font-weight:650}",
      "#ov-root .ov-form-footer{display:flex;align-items:center;justify-content:space-between;gap:.8rem;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--color-border);flex-wrap:wrap}",
      "#ov-root .ov-disclaimer{font-size:.72rem;color:var(--color-muted);max-width:420px}",
      "#ov-root .ov-examples{display:grid;gap:.6rem}#ov-root .ov-example{border:1px solid var(--color-border);background:var(--color-surface);border-radius:10px;padding:.75rem;text-align:left}",
      "#ov-root .ov-example:hover{border-color:var(--color-primary)}#ov-root .ov-example strong{display:block;margin-bottom:.15rem}#ov-root .ov-example span{display:block;font-size:.78rem;color:var(--color-muted)}",
      "#ov-root .ov-loading{min-height:280px;display:grid;place-items:center;padding:1.2rem}#ov-root .ov-loading-card{max-width:420px;width:100%;text-align:center;padding:1.5rem}",
      "#ov-root .ov-loader-orbit{width:56px;height:56px;margin:0 auto .9rem;border:2px solid var(--color-border);border-top-color:var(--color-primary);border-radius:50%;animation:ov-spin 1s linear infinite}",
      "@keyframes ov-spin{to{transform:rotate(360deg)}}",
      "#ov-root .ov-progress{height:7px;background:var(--color-bg);border-radius:99px;margin-top:1rem;overflow:hidden}#ov-root .ov-progress span{display:block;height:100%;background:var(--color-primary);border-radius:99px;transition:width .3s}",
      "#ov-root .ov-shell-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:1rem;flex-wrap:wrap}#ov-root .ov-shell-head h1{margin:0 0 .3rem;font-size:1.35rem}#ov-root .ov-shell-head p{margin:0 0 .3rem;color:var(--color-text);max-width:620px;font-size:.92rem}",
      "#ov-root .ov-shell-head p.ov-shell-disclaimer{margin:0;color:var(--color-muted);font-size:.74rem;max-width:620px}",
      "#ov-root .ov-shell-head-actions{display:flex;gap:.5rem;flex-wrap:wrap}#ov-root .ov-top-actions{display:flex;gap:.4rem;justify-content:flex-end;margin-bottom:.6rem;flex-wrap:wrap}",
      "#ov-root .ov-viewnav{display:inline-flex;background:var(--color-bg);border:1px solid var(--color-border);border-radius:11px;padding:3px;gap:2px;margin-bottom:1rem;flex-wrap:wrap}",
      "#ov-root .ov-viewnav-btn{border:0;background:transparent;border-radius:8px;padding:.5rem .8rem;color:var(--color-muted);font-weight:700;font-size:.85rem}",
      "#ov-root .ov-viewnav-btn[aria-current=\"page\"]{background:var(--color-surface);color:var(--color-text);box-shadow:0 2px 8px rgba(15,34,56,.08)}",
      "#ov-root .ov-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:.7rem;margin-bottom:1rem}#ov-root .ov-stat{padding:.9rem;text-align:left}",
      "#ov-root .ov-stat-top strong{font-size:1.6rem;letter-spacing:-.02em}#ov-root .ov-stat span{font-size:.78rem;color:var(--color-muted);display:block;margin-top:.4rem}",
      "#ov-root .ov-dashboard-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:1rem}#ov-root .ov-stack{display:grid;gap:.9rem}",
      "#ov-root .ov-priority-item{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.7rem;align-items:center;padding:.7rem;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface);width:100%;text-align:left;min-height:44px}",
      "#ov-root .ov-priority-mark{width:9px;height:9px;border-radius:50%;background:var(--ov-warning);box-shadow:0 0 0 4px color-mix(in srgb,var(--ov-warning) 15%,var(--color-surface))}#ov-root .ov-priority-item strong{display:block}#ov-root .ov-priority-item small{color:var(--color-muted)}",
      "#ov-root .ov-chip{display:inline-flex;align-items:center;gap:.35rem;border-radius:99px;padding:.32rem .7rem;background:var(--color-bg);color:var(--color-text);font-size:.7rem;font-weight:700;white-space:nowrap}",
      "#ov-root .ov-chip-high{background:var(--ov-warning-soft);color:#7a561a}#ov-root .ov-chip-normal{background:var(--ov-blue-soft);color:var(--color-primary)}#ov-root .ov-chip-low{background:var(--color-bg);color:var(--color-muted)}",
      "#ov-root .ov-chip-approved,#ov-root .ov-chip-ready,#ov-root .ov-chip-completed{background:var(--ov-success-soft);color:var(--ov-success)}",
      "#ov-root .ov-chip-rejected,#ov-root .ov-chip-blocked{background:var(--ov-danger-soft);color:var(--ov-danger)}",
      "#ov-root .ov-chip-suggested,#ov-root .ov-chip-not-started{background:var(--color-bg);color:var(--color-muted)}#ov-root .ov-chip-in-progress{background:var(--ov-purple-soft);color:#655976}",
      "#ov-root .ov-chip-impact-high{background:var(--ov-warning-soft);color:#7a561a}#ov-root .ov-chip-impact-medium{background:var(--ov-blue-soft);color:var(--color-primary)}#ov-root .ov-chip-impact-low{background:var(--color-bg);color:var(--color-muted)}",
      "#ov-root .ov-chip-new{background:var(--ov-success-soft);color:var(--ov-success)}#ov-root .ov-chip-custom{background:var(--ov-purple-soft);color:#665b75}",
      "#ov-root .ov-mini-flow{display:flex;align-items:stretch;gap:.5rem;overflow:auto;padding:.2rem}#ov-root .ov-mini-node{min-width:140px;padding:.6rem;border:1px solid var(--color-border);border-radius:10px;background:var(--color-bg);font-size:.8rem;text-align:left}",
      "#ov-root .ov-mini-arrow{display:grid;place-items:center;color:var(--color-muted)}#ov-root .ov-mini-impact{display:flex;flex-wrap:wrap;gap:.4rem}",
      "#ov-root .ov-next-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem}#ov-root .ov-next{padding:.7rem;border:1px solid var(--color-border);border-radius:10px;background:var(--color-bg)}#ov-root .ov-next strong{display:block;margin:.2rem 0}#ov-root .ov-next span{font-size:.78rem;color:var(--color-muted)}",
      "#ov-root .ov-toolbar{display:flex;gap:.6rem;align-items:center;justify-content:space-between;padding:.7rem;margin-bottom:.8rem;flex-wrap:wrap}#ov-root .ov-toolbar-left,#ov-root .ov-toolbar-right{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}",
      "#ov-root .ov-search input{height:40px;border:1px solid var(--color-border);border-radius:9px;padding:0 .7rem;background:var(--color-bg);color:var(--color-text);min-width:200px}",
      "#ov-root .ov-toolbar select{height:40px;border:1px solid var(--color-border);border-radius:9px;background:var(--color-bg);color:var(--color-text);padding:0 .6rem}",
      "#ov-root .ov-segment{display:inline-flex;flex-wrap:wrap;background:var(--color-bg);padding:3px;border-radius:10px;gap:2px}#ov-root .ov-segment button{border:0;background:transparent;padding:.4rem .6rem;border-radius:7px;font-weight:700;color:var(--color-muted);font-size:.82rem}",
      "#ov-root .ov-segment button[aria-pressed=\"true\"]{background:var(--color-surface);color:var(--color-text)}",
      "#ov-root .ov-filter-multi{position:relative}#ov-root .ov-filter-multi>summary{height:40px;min-width:150px;border:1px solid var(--color-border);border-radius:9px;background:var(--color-bg);padding:0 .6rem;display:flex;align-items:center;cursor:pointer;font-size:.85rem;list-style:none}",
      "#ov-root .ov-filter-multi>summary::-webkit-details-marker{display:none}",
      "#ov-root .ov-filter-menu{position:absolute;right:0;top:44px;z-index:30;width:220px;padding:.5rem;background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.15)}",
      "#ov-root .ov-filter-option{display:flex;align-items:center;gap:.5rem;padding:.4rem;border-radius:7px;cursor:pointer;font-size:.85rem;min-height:36px}#ov-root .ov-filter-option:hover{background:var(--color-tint)}",
      "#ov-root .ov-filter-option-separator{border-top:1px solid var(--color-border);margin-top:.3rem;padding-top:.6rem}#ov-root .ov-filter-hint{padding:.4rem;color:var(--color-muted);font-size:.7rem}",
      "#ov-root .ov-workshop-viewbar{display:flex;align-items:center;justify-content:space-between;gap:.7rem;margin:0 0 .7rem;padding:.55rem .65rem;border:1px solid var(--color-border);border-radius:10px;background:var(--color-bg)}#ov-root .ov-workshop-viewbar span{font-size:.75rem;color:var(--color-muted)}",
      "#ov-root .ov-list{overflow:hidden}#ov-root .ov-list-head,#ov-root .ov-list-row{display:grid;grid-template-columns:minmax(260px,1fr) minmax(150px,.35fr) minmax(130px,.25fr) minmax(190px,.35fr);gap:.6rem;align-items:center}",
      "#ov-root .ov-list-head{padding:.55rem .7rem;background:var(--color-bg);border-bottom:1px solid var(--color-border);font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;font-weight:800;color:var(--color-muted)}",
      "#ov-root .ov-list-row{padding:.6rem .7rem;border-bottom:1px solid var(--color-border)}#ov-root .ov-list-row:last-child{border-bottom:0}#ov-root .ov-list-row-rejected{opacity:.6}",
      "#ov-root .ov-list-title{border:0;background:transparent;text-align:left;padding:0;min-width:0;color:var(--color-text)}#ov-root .ov-list-title strong{display:block;font-size:.88rem}#ov-root .ov-list-title span{display:block;color:var(--color-muted);font-size:.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#ov-root .ov-list-status,#ov-root .ov-list-actions{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}#ov-root .ov-list-priority select{width:100%;height:36px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-bg);color:var(--color-text);padding:0 .5rem}",
      "#ov-root .ov-list-actions{justify-content:flex-end}",
      "#ov-root .ov-item-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem}#ov-root .ov-item-card{padding:.9rem;display:flex;flex-direction:column;gap:.6rem;min-height:210px}",
      "#ov-root .ov-item-card.ov-rejected{opacity:.6}#ov-root .ov-item-card.ov-important{border-color:#d2b069}",
      "#ov-root .ov-card-kicker{display:flex;align-items:center;justify-content:space-between}#ov-root .ov-item-card h3{margin:0;font-size:.95rem}#ov-root .ov-item-card p{margin:0;color:var(--color-muted);font-size:.78rem}",
      "#ov-root .ov-item-meta{display:flex;flex-wrap:wrap;gap:.35rem}#ov-root .ov-item-reason{background:var(--color-bg);border-radius:8px;padding:.5rem .6rem;font-size:.72rem;color:var(--color-muted)}",
      "#ov-root .ov-item-actions{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:auto;padding-top:.2rem}#ov-root .ov-item-flow-actions{display:flex;gap:.4rem;flex-wrap:wrap;padding:.5rem 0 0;border-top:1px solid var(--color-border)}",
      "#ov-root .ov-empty{padding:1.8rem 1.2rem;text-align:center;color:var(--color-muted)}",
      "#ov-root .ov-map-toolbar{padding:.7rem;display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:.8rem;flex-wrap:wrap}#ov-root .ov-map-wrap{padding:1rem;min-height:400px;overflow:auto}",
      "#ov-root .ov-map-stage{position:relative;min-height:400px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-bg);overflow:auto}",
      "#ov-root .ov-map-stage svg{position:absolute;inset:0;pointer-events:none;z-index:1;overflow:visible}",
      "#ov-root .ov-map-stage .ov-node{position:absolute;z-index:2;width:190px;min-height:120px;border:1px solid var(--color-border);border-radius:11px;background:var(--color-surface);padding:.7rem;box-shadow:0 4px 14px rgba(15,34,56,.06);text-align:left}",
      "#ov-root .ov-node.ov-node-blocked{border-color:#d19aa1}#ov-root .ov-node.ov-node-milestone{box-shadow:0 0 0 2px color-mix(in srgb,var(--color-primary) 20%,transparent)}",
      "#ov-root .ov-node strong{display:block;font-size:.85rem;margin-bottom:.25rem}#ov-root .ov-node small{color:var(--color-muted);display:block;font-size:.72rem}",
      "#ov-root .ov-node-badges{display:flex;gap:.25rem;flex-wrap:wrap;margin-top:.4rem}#ov-root .ov-node-actions{display:grid;grid-template-columns:1fr 1fr;gap:.35rem;margin-top:.6rem}",
      "#ov-root .ov-node-progress{grid-column:1/-1}#ov-root .ov-node-actions .btn{font-size:.72rem;padding:.4rem .5rem;min-height:32px}",
      "#ov-root .ov-edge{stroke:var(--color-muted);stroke-width:2;fill:none}#ov-root .ov-edge-recommended{stroke-dasharray:6 5}#ov-root .ov-edge-arrow{fill:var(--color-muted)}",
      "#ov-root .ov-impact-stage{position:relative;width:100%;min-width:0;min-height:400px;overflow:hidden;border:1px solid var(--color-border);border-radius:12px;background:var(--color-bg);display:grid;grid-template-columns:repeat(3,minmax(150px,1fr));grid-template-rows:repeat(3,minmax(120px,auto));gap:.9rem;padding:1.1rem;align-items:center}",
      "#ov-root .ov-impact-stage svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1}",
      "#ov-root .ov-impact-center{position:relative;grid-column:2;grid-row:2;z-index:3;width:min(100%,190px);min-height:100px;border-radius:16px;background:var(--color-primary);color:#fff;padding:.8rem;text-align:center;display:grid;place-items:center;justify-self:center}#ov-root .ov-impact-center strong{color:#fff}",
      "#ov-root .ov-impact-node{position:relative;z-index:2;width:min(100%,200px);min-height:95px;border-radius:11px;border:1px solid var(--color-border);background:var(--color-surface);padding:.6rem;box-shadow:0 3px 10px rgba(15,34,56,.06);text-align:left;justify-self:center}",
      "#ov-root .ov-impact-node[data-slot=\"0\"]{grid-column:1;grid-row:1}#ov-root .ov-impact-node[data-slot=\"1\"]{grid-column:2;grid-row:1}#ov-root .ov-impact-node[data-slot=\"2\"]{grid-column:3;grid-row:1}#ov-root .ov-impact-node[data-slot=\"3\"]{grid-column:3;grid-row:2}#ov-root .ov-impact-node[data-slot=\"4\"]{grid-column:3;grid-row:3}#ov-root .ov-impact-node[data-slot=\"5\"]{grid-column:2;grid-row:3}#ov-root .ov-impact-node[data-slot=\"6\"]{grid-column:1;grid-row:3}#ov-root .ov-impact-node[data-slot=\"7\"]{grid-column:1;grid-row:2}",
      "#ov-root .ov-impact-line{stroke:var(--color-muted);stroke-width:2;fill:none}",
      "#ov-root .ov-map-help{padding:.6rem .7rem;margin-bottom:.7rem;background:var(--color-bg);border:1px solid var(--color-border);border-radius:9px;color:var(--color-muted);font-size:.78rem}",
      "#ov-root .ov-map-text-list{margin-top:.7rem;padding:.7rem}#ov-root .ov-map-text-list summary{font-weight:800;cursor:pointer}",
      "#ov-root .ov-map-mobile-flow{display:none}",
      "#ov-root .ov-summary-document{padding:1.3rem;max-width:820px;margin:0 auto}#ov-root .ov-summary-document h2{font-size:1.3rem;margin:0 0 .3rem}#ov-root .ov-summary-document h3{margin-top:1.3rem;border-bottom:1px solid var(--color-border);padding-bottom:.4rem}",
      "#ov-root .ov-summary-document p,#ov-root .ov-summary-document li{color:var(--color-text)}#ov-root .ov-summary-actions{display:flex;gap:.4rem;justify-content:flex-end;margin-bottom:.8rem;flex-wrap:wrap}",
      "#ov-root .ov-note{border-left:4px solid var(--color-primary);background:var(--ov-blue-soft);padding:.6rem .7rem;border-radius:0 9px 9px 0;color:var(--color-text);font-size:.78rem}",
      "#ov-root .ov-warning-note{border-left-color:var(--ov-warning);background:var(--ov-warning-soft)}",
      "#ov-root .ov-modal-backdrop{position:fixed;inset:0;background:rgba(7,19,31,.5);z-index:2000;display:flex;justify-content:flex-end}",
      "#ov-root .ov-modal{height:100%;max-height:100vh;width:min(520px,100%);background:var(--color-surface);box-shadow:-18px 0 50px rgba(5,18,30,.2);display:flex;flex-direction:column;min-height:0}",
      "#ov-root .ov-modal-sm{width:min(430px,100%)}#ov-root .ov-modal-head{flex:0 0 auto;padding:1.1rem 1.2rem;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;gap:.8rem}",
      "#ov-root .ov-modal-head h2{font-size:1.1rem;margin:0}#ov-root .ov-modal-body{padding:1.1rem 1.2rem;overflow:auto;display:grid;gap:.9rem;flex:1 1 auto;min-height:0}",
      "#ov-root .ov-modal-foot{flex:0 0 auto;padding:.8rem 1.2rem;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end;gap:.4rem;flex-wrap:wrap}",
      "#ov-root .ov-related-list{display:grid;gap:.4rem}#ov-root .ov-related{padding:.6rem;border:1px solid var(--color-border);border-radius:9px;display:flex;justify-content:space-between;gap:.5rem;align-items:center;background:var(--color-bg)}",
      "#ov-root .ov-related strong{display:block;font-size:.78rem}#ov-root .ov-related span{font-size:.7rem;color:var(--color-muted)}",
      "#ov-root .ov-form-row{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}#ov-root .ov-inline-actions{display:flex;gap:.4rem;flex-wrap:wrap}",
      "#ov-root .ov-consequence-list{display:grid;gap:.35rem}#ov-root .ov-consequence{padding:.45rem .55rem;border-radius:8px;background:var(--color-bg);font-size:.78rem}",
      "#ov-root .ov-toasts{position:fixed;right:1rem;bottom:1rem;z-index:2100;display:grid;gap:.5rem;width:min(340px,calc(100% - 2rem))}",
      "#ov-root .ov-toast{background:#172840;color:#fff;border-radius:10px;padding:.6rem .75rem;box-shadow:0 12px 30px rgba(0,0,0,.2);font-size:.82rem}#ov-root .ov-toast-error{background:#773f43}",
      "@media(max-width:1120px){#ov-root .ov-item-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#ov-root .ov-stat-grid{grid-template-columns:repeat(2,1fr)}#ov-root .ov-dashboard-grid{grid-template-columns:1fr}#ov-root .ov-start-grid{grid-template-columns:1fr}#ov-root .ov-next-grid{grid-template-columns:1fr 1fr}#ov-root .ov-list-head,#ov-root .ov-list-row{grid-template-columns:minmax(200px,1fr) minmax(110px,.3fr) minmax(100px,.2fr) minmax(160px,.3fr)}}",
      "@media(max-width:820px){#ov-root .ov-workshop-viewbar{align-items:stretch;flex-direction:column}#ov-root .ov-list-head{display:none}#ov-root .ov-list-row{grid-template-columns:1fr 1fr;padding:.7rem}#ov-root .ov-list-title{grid-column:1/-1}#ov-root .ov-item-grid{grid-template-columns:1fr}#ov-root .ov-map-wrap{padding:.5rem;min-height:0}#ov-root .ov-map-stage{min-width:0!important;width:100%!important;min-height:0!important;overflow:visible;padding:.6rem}#ov-root .ov-map-stage>svg,#ov-root .ov-map-stage>.ov-node{display:none}#ov-root .ov-map-mobile-flow{display:grid;gap:0}",
      "#ov-root .ov-mobile-node{display:grid;grid-template-columns:26px minmax(0,1fr);gap:.5rem;position:relative}#ov-root .ov-mobile-node:not(:last-child):before{content:'';position:absolute;left:12px;top:32px;bottom:-.4rem;width:2px;background:var(--color-border)}",
      "#ov-root .ov-mobile-dot{width:26px;height:26px;border-radius:50%;background:var(--color-primary);color:#fff;display:grid;place-items:center;font-size:.7rem;z-index:1}#ov-root .ov-mobile-card{margin-bottom:.8rem;padding:.6rem;border:1px solid var(--color-border);border-radius:9px;background:var(--color-surface)}",
      "#ov-root .ov-impact-stage{display:grid;grid-template-columns:1fr;grid-template-rows:auto;gap:.6rem;min-width:0;min-height:0;padding:.6rem}#ov-root .ov-impact-stage>svg{display:none}#ov-root .ov-impact-center,#ov-root .ov-impact-node{position:relative;grid-column:1!important;grid-row:auto!important;width:100%;min-height:0}#ov-root .ov-impact-center{border-radius:12px;order:-1}",
      "#ov-root .ov-form-grid,#ov-root .ov-form-row{grid-template-columns:1fr}#ov-root .ov-check-grid{grid-template-columns:1fr}#ov-root .ov-stat-grid{grid-template-columns:1fr 1fr}#ov-root .ov-next-grid{grid-template-columns:1fr}}",
      "@media(max-width:480px){#ov-root .ov-list-row{grid-template-columns:1fr}#ov-root .ov-stat-grid{grid-template-columns:1fr}#ov-root .ov-modal{width:100%}#ov-root .ov-form-footer{display:grid}#ov-root .ov-form-footer .btn{width:100%}}",
      "@media(prefers-reduced-motion:reduce){#ov-root *,#ov-root *:before,#ov-root *:after{animation-duration:.01ms!important;transition-duration:.01ms!important}}",
      "@media print{#ov-root .ov-top-actions,#ov-root .ov-viewnav,#ov-root .ov-shell-head,#ov-root .ov-summary-actions,#ov-root .ov-toasts,#ov-root .ov-toolbar,#ov-root .ov-map-toolbar{display:none!important}#ov-root .ov-view:not([data-view=\"summary\"]){display:none!important}#ov-root .ov-summary-document{box-shadow:none;border:0;max-width:none;padding:0}}",
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  var contentEl = null;
  function render() { return '<div id="ov-root"><div id="ov-content"></div><div class="ov-toasts" id="ov-toasts" aria-live="polite"></div><div id="ov-modal"></div></div>'; }
  function mount(outlet) {
    var root = outlet.querySelector("#ov-root");
    if (!root) return;
    injectStyles();
    contentEl = root.querySelector("#ov-content");
    toastsEl = root.querySelector("#ov-toasts");
    modalEl = root.querySelector("#ov-modal");
    generating = false;
    if (!_loadedThisSession) { load(); _loadedThisSession = true; }
    renderApp();
  }

  Intranet.registerModule({
    id: "oversikt",
    navLabel: OV_MODULE.label || "Oversikt",
    icon: "layout-grid",
    order: 62,
    render: render,
    mount: mount,
  });
})();
