/* =============================================================================
   module-orgdrift-v8.js — ORGANISASJON & DRIFT (intranett)
   -----------------------------------------------------------------------------
   Praktisk styringsregister for småbedrifter:
   - Personer
   - Ansvar
   - Leverandører / partnere
   - Systemer / abonnementer
   - Innkjøp

   v5:
   - Organisasjonskart og IT-arkitektur er fjernet
   - Søk med støtte for felt-prefiks, f.eks. Avdeling: drift
   - Generelle vedlegg på kort med legg-til funksjon
   - Kortvisning og listevisning
   - Sorterbare tabeller
   - Klikk på kort/rad åpner detaljkort
   - Systemintegrasjoner velges fra eksisterende systemer
   - Avdelinger kan gjenbrukes på personkort

   Lagring:
   - App.store("wsp-orgdrift")
   - App.store("wsp-orgdrift-view")
   - App.store("wsp-orgdrift-filters")

   Avhengigheter:
   - Intranet
   - App
   - Components
   - Vanilla JS
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  if (!Intranet || !App || !C) return;

  App.ready(function (CFG) {
  if (CFG.intranettFeatures && CFG.intranettFeatures.orgdrift === false) return;

  var STORE_KEY = "wsp-orgdrift";
  var VIEW_KEY = "wsp-orgdrift-view";
  var FILTER_KEY = "wsp-orgdrift-filters";
  // Berre Eiendeler-fana bruker _sb -- dei fem andre fanene i denne modulen
  // er reint App.store-baserte (sjå kommentaren ved isAdminRole() under).
  var _sb = App.supabase;

  var esc = C.esc || function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  // Eiendeler (2026-08-10): eigen fane i denne modulen, men BAKA av ekte
  // Supabase-tabellar (assets/asset_categories) i staden for wsp-orgdrift-
  // blobben dei fem andre fanene brukar — sjå den store kommentarblokka lenger
  // ned ("EIENDELER") for grunngjeving og den fulle implementasjonen. Eige
  // flagg (intranettFeatures.eiendeler) i tillegg til orgdrift-flagget over,
  // sidan dette er ein nyare, meir omfattande fane enn resten av modulen.
  var EIENDELER_ENABLED = !!(CFG.intranettFeatures && CFG.intranettFeatures.eiendeler === true);

  var TABS = [
    ["people", "Personer"],
    ["responsibilities", "Ansvar"],
    ["vendors", "Leverandører"],
    ["systems", "Systemer"],
    ["purchasing", "Innkjøp"]
  ];
  if (EIENDELER_ENABLED) TABS.push(["eiendeler", "Eiendeler"]);

  var TAB_HELP = {
    people: "Kontakt- og rollekart for personer i organisasjonen. Bruk søk, f.eks. «Avdeling: drift» eller «Rolle: leder».",
    responsibilities: "Oversikt over hvem som eier interne ansvarsområder, med eventuell backup og forklaring.",
    vendors: "Leverandører og partnere med kontaktinfo, kundenummer, portal og hvordan bestilling skjer.",
    systems: "IT-systemer, abonnementer og digitale tjenester. Bruk søk, f.eks. «Kategori: IT-system», «Kritikalitet: høy» eller «Integrasjoner: ja».",
    purchasing: "Innkjøpsoversikt og regler: hva kjøpes hvor, hvem godkjenner og hvilke beløpsgrenser gjelder.",
    eiendeler: "Utstyr og eiendeler virksomheten eier, leier eller låner, med verdi og eierskapshistorikk."
  };

  var sortState = { type: "", key: "", dir: "asc" };

  // Heile "wsp-orgdrift" ligg som éin JSON-blob under éin store-nøkkel — RLS kan
  // difor ikkje skilje "opprett kort" frå "rediger eksisterande kort" inni blobben.
  // Minste sikre løysing (jf. Arkitekten): all skriving (ny/rediger/slett) er
  // admin-only, både i UI og i handlarane. Editor/member er read-only.
  function isAdminRole() {
    var ctx = Intranet.getContext ? Intranet.getContext() : null;
    return !!ctx && ctx.role === "admin";
  }

  function uid(prefix) {
    return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  }

  function defaults() {
    return {
      people: [
        { id: uid("p"), name: "Kari Nordmann", role: "Daglig leder", dept: "Ledelse", phone: "900 00 000", email: "kari@bedrift.no", manager: "", responsibilities: "Strategi, økonomi, større avtaler", note: "Godkjenner større innkjøp og avtaler." },
        { id: uid("p"), name: "Ola Hansen", role: "Driftsansvarlig", dept: "Drift", phone: "911 11 111", email: "ola@bedrift.no", manager: "Kari Nordmann", responsibilities: "Utstyr, bil, lager, drift", note: "Kontaktpunkt for utstyr, bil og lager." },
        { id: uid("p"), name: "Lise Berg", role: "Kontor og administrasjon", dept: "Administrasjon", phone: "922 22 222", email: "lise@bedrift.no", manager: "Kari Nordmann", responsibilities: "Faktura, bestilling, dokumenter", note: "Kontakt for faktura og leverandøravtaler." }
      ],
      responsibilities: [
        { id: uid("r"), area: "IT og tilganger", category: "IT", owner: "Kari Nordmann", backup: "Lise Berg", description: "Opprette brukere, avslutte tilganger og holde oversikt over systemer." },
        { id: uid("r"), area: "Firmabiler og utstyr", category: "Drift", owner: "Ola Hansen", backup: "", description: "Service, nøkler, utlån og feil." }
      ],
      vendors: [
        { id: uid("v"), name: "Domeneshop", type: "System", contact: "Kundeservice", phone: "", email: "kundeservice@domeneshop.no", website: "https://www.domeneshop.no", customerNo: "", ordering: "Endringer gjøres via kundeportal.", notes: "Domene, DNS og e-postrelaterte tjenester." },
        { id: uid("v"), name: "Ahlsell", type: "Innkjøp", contact: "Lokal avdeling", phone: "", email: "", website: "", customerNo: "Legg inn kundenummer", ordering: "Bestill via nettbutikk. Faktura merkes med prosjektnummer.", notes: "Arbeidsklær, verktøy og forbruksmateriell." }
      ],
      systems: [
        { id: uid("s"), name: "Microsoft 365", category: "IT-system", vendor: "Microsoft / IT-partner", owner: "Kari Nordmann", cost: "1290", cycle: "Månedlig", renewal: "", notice: "", loginUrl: "https://portal.office.com", integrations: "Outlook, Teams, SharePoint", criticality: "Høy", dataFlow: "E-post, dokumenter og intern samhandling.", notes: "Kritisk for daglig drift." },
        { id: uid("s"), name: "Tripletex", category: "Økonomi", vendor: "Tripletex", owner: "Lise Berg", cost: "699", cycle: "Månedlig", renewal: "", notice: "", loginUrl: "https://www.tripletex.no", integrations: "Bank, Altinn", criticality: "Høy", dataFlow: "Regnskap, faktura og lønn.", notes: "Økonomisystem." },
        { id: uid("s"), name: "Canva Pro", category: "Abonnement", vendor: "Canva", owner: "Kari Nordmann", cost: "149", cycle: "Månedlig", renewal: "", notice: "", loginUrl: "https://www.canva.com", integrations: "", criticality: "Lav", dataFlow: "Markedsmateriell.", notes: "Design og markedsmateriell." }
      ],
      purchasing: [
        { id: uid("i"), item: "Arbeidsklær", vendor: "Ahlsell", approver: "Daglig leder", method: "Nettbutikk", instructions: "Bruk firmakonto. Faktura merkes med prosjektnummer.", limit: "Avklar over 3000 kr" },
        { id: uid("i"), item: "PC og IT-utstyr", vendor: "IT-partner / Dustin", approver: "IT-ansvarlig", method: "E-post eller portal", instructions: "Sjekk først om utstyr finnes på lager.", limit: "Alltid godkjenning" }
      ],
      departments: ["Administrasjon", "Drift", "Ledelse"]
    };
  }

  function getData() {
    var data = App.store.get(STORE_KEY, null);
    if (!data) {
      data = defaults();
      setData(data);
    }

    data.people = data.people || [];
    data.responsibilities = data.responsibilities || [];
    data.vendors = data.vendors || [];
    data.systems = data.systems || [];
    data.purchasing = data.purchasing || [];
    data.departments = data.departments || collectDepartments(data.people);

    return data;
  }

  function setData(data) {
    App.store.set(STORE_KEY, data);
  }

  function getView() {
    return App.store.get(VIEW_KEY, "cards") || "cards";
  }

  function setView(v) {
    App.store.set(VIEW_KEY, v);
  }

  function getFilters() {
    return App.store.get(FILTER_KEY, {}) || {};
  }

  function getActiveFilter(tab) {
    var filters = getFilters();
    return filters[tab] || "all";
  }

  function setActiveFilter(tab, value) {
    var filters = getFilters();
    filters[tab] = value || "all";
    App.store.set(FILTER_KEY, filters);
  }

  function render() {
    return '<div id="orgdrift-root"></div>';
  }

  function mount(outlet, ctx, sub) {
    injectStyles();
    var root = outlet.querySelector("#orgdrift-root") || outlet;
    // Security Auditor-funn (LOW, 2026-08-10): utan denne sjekken kunne
    // direkte lenke/bokmerke til #/orgdrift/eiendeler nå fana sjølv om
    // intranettFeatures.eiendeler er av -- TABS-lista (fane-knappane) er alt
    // korrekt filtrert, men mount() tok tidlegare imot `sub` frå URL-en urørt.
    // Ikkje ein tilgangskontroll (RLS handhevar det uansett), berre konsistent
    // "skjult skal faktisk vere skjult"-åtferd, same idé som andre valfrie
    // modular sin "Modul ikke funnet"-fallback.
    if (sub === "eiendeler" && !EIENDELER_ENABLED) sub = "people";
    draw(root, sub || "people", "");
  }

  function injectStyles() {
    if (document.getElementById("orgdrift-v8-styles")) return;

    var s = document.createElement("style");
    s.id = "orgdrift-v8-styles";
    s.textContent = [
      ".od-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:1rem}",
      ".od-head h2{margin:.15rem 0 .3rem}",
      ".od-muted{margin:0;color:var(--color-muted);font-size:.9rem}",
      ".od-help{border:1px solid var(--color-border);border-radius:var(--radius);padding:.7rem .85rem;background:rgba(148,163,184,.08);color:var(--color-muted);font-size:.88rem;margin:-.2rem 0 1rem}",
      ".od-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.7rem;margin-bottom:1rem}",
      ".od-stat{border:1.5px solid var(--color-border);border-radius:var(--radius);padding:.75rem 1rem;background:var(--color-surface);display:flex;flex-direction:column;gap:.2rem}",
      ".od-stat span{display:block;color:var(--color-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em}",
      ".od-stat strong{font-size:1.35rem}",
      ".od-tabs{display:flex;flex-wrap:wrap;gap:.45rem;border-bottom:1px solid var(--color-border);padding-bottom:.7rem;margin-bottom:1rem}",
      ".od-tab{border:1px solid var(--color-border);background:var(--color-surface);border-radius:999px;padding:.45rem .75rem;cursor:pointer;font:inherit;font-size:.86rem;color:var(--color-text)}",
      ".od-tab.is-active{background:var(--color-primary);border-color:var(--color-primary);color:white}",
      ".od-filterbar{display:flex;flex-wrap:wrap;gap:.4rem;margin:-.2rem 0 1rem}",
      ".od-filter{border:1px solid var(--color-border);background:var(--color-surface);border-radius:999px;padding:.35rem .6rem;cursor:pointer;font:inherit;font-size:.8rem;color:var(--color-muted)}",
      ".od-filter.is-active{background:rgba(37,99,235,.10);border-color:var(--color-primary);color:var(--color-primary);font-weight:650}",
      ".od-tools{display:flex;gap:.6rem;margin-bottom:1rem;align-items:center}",
      ".od-search{flex:1;min-width:220px;border:1px solid var(--color-border);border-radius:999px;padding:.55rem .8rem;font:inherit;background:var(--color-surface);color:var(--color-text)}",
      ".od-view-toggle{display:flex;gap:.35rem}",
      ".od-view-toggle button{border:1px solid var(--color-border);background:var(--color-surface);border-radius:999px;padding:.45rem .65rem;cursor:pointer;font:inherit;font-size:.82rem}",
      ".od-view-toggle button.is-active{background:var(--color-primary);border-color:var(--color-primary);color:#fff}",
      ".od-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.85rem}",
      ".od-card{border:1px solid var(--color-border);background:var(--color-surface);border-radius:var(--radius);padding:.9rem;box-shadow:0 1px 2px rgba(15,23,42,.04);cursor:pointer;transition:transform .12s,box-shadow .12s,border-color .12s}",
      ".od-card:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(15,23,42,.08);border-color:var(--color-primary)}",
      ".od-card h3{font-size:1rem;margin:0 0 .35rem}",
      ".od-card p{margin:.25rem 0;color:var(--color-muted);font-size:.86rem;line-height:1.45}",
      ".od-pill{display:inline-flex;border:1px solid var(--color-border);border-radius:999px;padding:.18rem .5rem;color:var(--color-muted);font-size:.72rem;margin-bottom:.5rem}",
      ".od-kv{display:grid;gap:.26rem;margin-top:.55rem}",
      ".od-kv div{font-size:.84rem;color:var(--color-muted);line-height:1.4}",
      ".od-kv strong{color:var(--color-text)}",
      ".od-actions{display:flex;justify-content:flex-end;gap:.4rem;margin-top:.75rem}",
      ".od-empty{border:1px dashed var(--color-border);border-radius:var(--radius);padding:1rem;color:var(--color-muted);font-size:.9rem}",
      ".od-table-wrap{border:1px solid var(--color-border);border-radius:var(--radius);overflow:auto;background:var(--color-surface)}",
      ".od-table{width:100%;border-collapse:collapse;font-size:.88rem}",
      ".od-table th,.od-table td{padding:.7rem .75rem;border-bottom:1px solid var(--color-border);text-align:left;vertical-align:top;white-space:nowrap}",
      ".od-table th{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--color-muted);background:rgba(148,163,184,.08)}",
      ".od-table th[data-od-sort]{cursor:pointer;user-select:none}",
      ".od-table th[data-od-sort]:hover{color:var(--color-primary)}",
      ".od-table tr{cursor:pointer}",
      ".od-table tbody tr:hover{background:rgba(37,99,235,.06)}",
      ".od-form{display:grid;gap:.7rem}",
      ".od-form label{display:grid;gap:.25rem;color:var(--color-muted);font-size:.82rem}",
      ".od-form input,.od-form textarea,.od-form select{border:1px solid var(--color-border);border-radius:.7rem;padding:.55rem .65rem;font:inherit;background:var(--color-surface);color:var(--color-text)}",
      ".od-form textarea{min-height:80px;resize:vertical}",
      ".od-attachments{border:1px solid var(--color-border);border-radius:var(--radius);padding:.75rem;background:rgba(148,163,184,.06);display:grid;gap:.55rem}",
      ".od-attachment-row{display:grid;grid-template-columns:1fr 1.4fr auto auto;gap:.45rem;align-items:center;margin-bottom:.45rem}",
      ".od-attachment-list{display:grid;gap:.35rem;margin-top:.8rem}",
      ".od-attachment-item{border:1px solid var(--color-border);border-radius:.75rem;padding:.45rem .6rem;background:var(--color-surface);font-size:.84rem}",
      ".od-attachment-item span{color:var(--color-muted);font-size:.78rem;margin-left:.35rem}",
      ".od-row{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}",
      ".od-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:1rem}",
      ".od-modal{width:min(760px,100%);max-height:88vh;overflow:auto;background:var(--color-surface);border-radius:calc(var(--radius) + 4px);border:1px solid var(--color-border);box-shadow:0 30px 90px rgba(15,23,42,.25)}",
      ".od-modal-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;padding:1rem 1rem .7rem;border-bottom:1px solid var(--color-border)}",
      ".od-modal-head h3{margin:0}",
      ".od-modal-body{padding:1rem}",
      ".od-close{border:0;background:transparent;font-size:1.4rem;cursor:pointer;color:var(--color-muted)}",
      // UX-review-funn (MEDIUM, 2026-08-10): utan sticky forsvinn ×-knappen
      // ut av synsfeltet på dei lengre Eiendeler-skjemaa (14 felt for leigd/
      // lånt) ved liggjande mobilvising -- gjeld alle seks faner sine skjema,
      // ikkje berre Eiendeler, difor retta her på den delte regelen.
      ".od-modal-head{position:sticky;top:0;background:var(--color-surface);z-index:1}",
      "@media(max-width:650px){.od-head{display:block}.od-tools{display:block}.od-search{width:100%;box-sizing:border-box;margin-bottom:.6rem}.od-row{grid-template-columns:1fr}.od-view-toggle{margin-bottom:.6rem}}",
      /* --- Eiendeler (2026-08-10) ------------------------------------------- */
      ".ei-visual{position:relative;width:100%;aspect-ratio:16/9;border-radius:.7rem;background:var(--color-alt,rgba(148,163,184,.12));display:flex;align-items:center;justify-content:center;margin-bottom:.6rem;overflow:hidden}",
      ".ei-visual img{width:100%;height:100%;object-fit:cover}",
      ".ei-visual--placeholder{color:var(--color-muted);font-size:1.6rem}",
      ".ei-ownership{display:inline-block;border-radius:999px;padding:.1rem .5rem;font-size:.72rem;font-weight:650;vertical-align:middle}",
      // --owned brukte tidlegare ein fast blåfarge -- retta til --color-tint
      // (UX-review-funn MEDIUM) sidan det er nettopp "lys tone av primærfarge"-
      // bruken den variabelen finst for; --leased/--borrowed sine faste amber/
      // slate-fargar er OK, matchar .stat-badge sitt eige mønster for status.
      ".ei-ownership--owned{background:var(--color-tint);color:var(--color-primary)}",
      ".ei-ownership--leased{background:rgba(217,119,6,.14);color:#b45309}",
      ".ei-ownership--borrowed{background:rgba(100,116,139,.14);color:#475569}",
      ".ei-list{display:grid;gap:.4rem}",
      ".ei-list__head{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:.6rem;padding:.3rem .6rem;color:var(--color-muted);font-size:.76rem;text-transform:uppercase;letter-spacing:.04em}",
      ".ei-list__row{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:.6rem;align-items:center;padding:.65rem .6rem;border:1px solid var(--color-border);border-radius:.7rem;background:var(--color-surface);cursor:pointer}",
      ".ei-list__row:hover{border-color:var(--color-primary)}",
      // Skjult over 650px (kolonneoverskrifta over gjer jobben der) -- synleg
      // under, der .ei-list__head sjølv vert skjult (UX-review-funn HIGH:
      // utan denne var Kjøpspris/Verdi umoglege å skilje på smal skjerm).
      ".ei-list__mlabel{display:none;color:var(--color-muted);font-weight:600}",
      ".ei-ownership-choice{display:flex;gap:.4rem;margin-top:.3rem}",
      // min-height:44px (UX-review-funn MEDIUM: målt til berre 36px) -- same
      // touch-mål-minimum som resten av kodebasen alt handhevar andre stader.
      ".ei-ownership-choice button{flex:1;min-height:44px;border:1px solid var(--color-border);background:var(--color-surface);border-radius:.7rem;padding:.5rem;cursor:pointer;font:inherit}",
      ".ei-ownership-choice button.is-active{background:var(--color-primary);border-color:var(--color-primary);color:#fff}",
      // Delt fokus-ring-mønster (same som .crm-tl-row/.pw-toggle:focus-visible
      // i index.html) -- UX-review-funn (POLISH): nye interaktive element
      // hadde berre nettlesaren sin standardkant, ikkje appen sin eigen stil.
      ".od-card:focus-visible,.ei-list__row:focus-visible{outline:2px solid var(--color-primary);outline-offset:-2px}",
      "@media(max-width:650px){.ei-list__head{display:none}.ei-list__row{grid-template-columns:1fr;gap:.25rem}.ei-list__mlabel{display:inline}}",
      /* --- Eiendeler, Fase 2: eierskapshistorikk ----------------------------- */
      ".ei-history{margin-top:.8rem;padding-top:.6rem;border-top:1px solid var(--color-border)}",
      ".ei-history h4{margin:0 0 .3rem;font-size:.85rem;color:var(--color-muted)}",
      ".ei-history ul{margin:0;padding-left:1.1rem;font-size:.9rem}",
      ".ei-history li+li{margin-top:.15rem}",
      /* --- Eiendeler, Fase 3: bilder ------------------------------------------ */
      // Miniatyren i skjemaet skal ikkje ta heile bredda som kort-/detalj-
      // visinga sin 16:9-versjon -- avgrensa til ei fast, mindre høgd.
      ".ei-image-field{display:grid;gap:.5rem}",
      ".ei-image-field .ei-visual{max-width:220px;aspect-ratio:4/3;margin-bottom:0}",
      ".ei-image-field__actions{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}",
      // .ei-visual sjølv fekk position:relative lagt til øvst i denne lista
      // (Fase 3) -- treng ein eigen posisjoneringskontekst for denne knappen.
      ".ei-visual__upload{position:absolute;bottom:.5rem;left:50%;transform:translateX(-50%)}"
    ].join("");
    document.head.appendChild(s);
  }

  function draw(root, tab, q) {
    var data = getData();
    var view = getView();
    var isAdmin = isAdminRole();

    root.innerHTML =
      '<div class="od-head">' +
        '<div><p class="i-section-label">Arbeidsområde</p><h2>Organisasjon & drift</h2><p class="od-muted">Praktisk styringsregister for personer, ansvar, leverandører, systemer og innkjøp.</p></div>' +
      '</div>' +
      stats(data) +
      tabs(tab) +
      '<div class="od-help">' + esc(TAB_HELP[tab] || "") + (isAdmin ? "" : ' Kun lesetilgang for din rolle.') + '</div>' +
      tools(view, q, isAdmin) +
      '<div data-od-content>' + content(tab, data, q || "", view, isAdmin) + '</div>';

    bind(root, tab, isAdmin);
  }

  function stats(data) {
    var monthly = data.systems.reduce(function (sum, s) {
      var n = parseFloat(String(s.cost || "").replace(",", "."));
      return sum + (isNaN(n) ? 0 : n);
    }, 0);
    var high = data.systems.filter(function (s) { return String(s.criticality || "").toLowerCase() === "høy"; }).length;
    var missingOwner = data.systems.filter(function (s) { return !s.owner; }).length;

    return '<div class="od-stats">' +
      odStatCard("people",           "Personer",    data.people.length) +
      odStatCard("responsibilities", "Ansvar",      data.responsibilities.length) +
      odStatCard("vendors",          "Leverandørar", data.vendors.length) +
      odStatCard("systems",          "System",      data.systems.length) +
      odStatCard("purchases",        "Innkjøp",     (data.purchases || data.purchasing || []).length) +
    '</div>';
  }

  function odStatCard(tab, label, count) {
    return '<button class="od-stat" data-od-tab="' + tab + '" style="cursor:pointer;text-align:left;border:0;width:100%;font:inherit">' +
      '<span>' + label + '</span>' +
      '<strong>' + count + '</strong>' +
    '</button>';
  }

  function tabs(active) {
    return '<div class="od-tabs">' + TABS.map(function (t) {
      return '<button class="od-tab ' + (t[0] === active ? "is-active" : "") + '" data-od-tab="' + esc(t[0]) + '">' + esc(t[1]) + '</button>';
    }).join("") + '</div>';
  }

  function tools(view, q, isAdmin) {
    return '<div class="od-tools">' +
      '<input class="od-search" data-od-search type="search" placeholder="Søk eller bruk felt: verdi, f.eks. Avdeling: drift" value="' + esc(q || "") + '">' +
      '<div class="od-view-toggle">' +
        '<button data-od-view="cards" class="' + (view === "cards" ? "is-active" : "") + '">Kort</button>' +
        '<button data-od-view="list" class="' + (view === "list" ? "is-active" : "") + '">Liste</button>' +
      '</div>' +
      (isAdmin ? '<button data-od-new class="od-view-toggle-btn od-new-btn" style="border:1px solid var(--color-border);background:var(--color-surface);border-radius:999px;padding:.45rem .9rem;cursor:pointer;font:inherit;font-size:.82rem">Ny</button>' : '') +
    '</div>';
  }

  function filterBar(tab, data, active) {
    var chips = filterOptions(tab, data);
    return '<div class="od-filterbar">' + chips.map(function (chip) {
      return '<button class="od-filter ' + (chip.value === active ? "is-active" : "") + '" data-od-filter="' + esc(chip.value) + '">' +
        esc(chip.label) +
      '</button>';
    }).join("") + '</div>';
  }

  function filterOptions(tab, data) {
    var chips = [{ value: "all", label: "Alle" }];

    /*
      Enkle filter som følger tabellfeltene.
      Ikke ekstra "smarte" kategorier her.
    */

    if (tab === "people") {
      collectUnique(data.people, "dept").forEach(function (x) {
        chips.push({ value: "dept:" + x, label: "Avdeling: " + x });
      });
    }

    if (tab === "responsibilities") {
      collectUnique(data.responsibilities, "owner").forEach(function (x) {
        chips.push({ value: "owner:" + x, label: "Ansvarlig: " + x });
      });
      chips.push({ value: "missing-backup", label: "Backup: nei" });
    }

    if (tab === "vendors") {
      collectUnique(data.vendors, "type").forEach(function (x) {
        chips.push({ value: "type:" + x, label: "Type: " + x });
      });
    }

    if (tab === "systems") {
      collectUnique(data.systems, "category").forEach(function (x) {
        chips.push({ value: "category:" + x, label: "Kategori: " + x });
      });
      collectUnique(data.systems, "criticality").forEach(function (x) {
        chips.push({ value: "criticality:" + x, label: "Kritikalitet: " + x });
      });
      chips.push({ value: "has-integrations", label: "Integrasjoner: ja" });
      chips.push({ value: "missing-integrations", label: "Integrasjoner: nei" });
    }

    if (tab === "purchasing") {
      collectUnique(data.purchasing, "vendor").forEach(function (x) {
        chips.push({ value: "vendor:" + x, label: "Leverandør: " + x });
      });
      collectUnique(data.purchasing, "approver").forEach(function (x) {
        chips.push({ value: "approver:" + x, label: "Godkjenner: " + x });
      });
    }

    return chips;
  }

  function collectUnique(list, key) {
    var seen = {};
    (list || []).forEach(function (item) {
      var v = item[key];
      if (v) seen[v] = true;
    });
    return Object.keys(seen).sort();
  }

  function content(tab, data, q, view, isAdmin) {
    var items;

    if (tab === "people") {
      items = smartSearch("people", data.people, q);
      return renderCollection(tab, items, view, personDef(), isAdmin);
    }

    if (tab === "responsibilities") {
      items = smartSearch("responsibilities", data.responsibilities, q);
      return renderCollection(tab, items, view, respDef(), isAdmin);
    }

    if (tab === "vendors") {
      items = smartSearch("vendors", data.vendors, q);
      return renderCollection(tab, items, view, vendorDef(), isAdmin);
    }

    if (tab === "systems") {
      items = smartSearch("systems", data.systems, q);
      return renderCollection(tab, items, view, systemDef(), isAdmin);
    }

    if (tab === "purchasing") {
      items = smartSearch("purchasing", data.purchasing, q);
      return renderCollection(tab, items, view, purchaseDef(), isAdmin);
    }

    if (tab === "eiendeler") {
      return eiendelerContent(q, view);
    }

    return "";
  }

  function smartSearch(type, list, q) {
    q = String(q || "").trim();
    if (!q) return list;

    var parsed = parseSearch(type, q);
    if (parsed.field) {
      return list.filter(function (item) {
        return fieldMatches(item, parsed.field, parsed.value);
      });
    }

    var needle = q.toLowerCase();
    return list.filter(function (item) {
      return Object.keys(item).some(function (k) {
        if (k === "attachments") return attachmentText(item).toLowerCase().indexOf(needle) >= 0;
        return String(item[k] || "").toLowerCase().indexOf(needle) >= 0;
      });
    });
  }

  function parseSearch(type, q) {
    var m = String(q || "").match(/^([^:]+):\s*(.*)$/);
    if (!m) return { field: "", value: q };

    var label = normalizeLabel(m[1]);
    var value = String(m[2] || "").trim();
    var map = searchFieldMap(type);
    return { field: map[label] || "", value: value };
  }

  function normalizeLabel(v) {
    return String(v || "")
      .toLowerCase()
      .replace(/[æ]/g, "ae")
      .replace(/[ø]/g, "o")
      .replace(/[å]/g, "a")
      .replace(/\s+/g, "");
  }

  function searchFieldMap(type) {
    var common = {
      "navn": "name",
      "telefon": "phone",
      "epost": "email",
      "e-post": "email",
      "notat": "notes",
      "notater": "notes",
      "vedlegg": "attachments"
    };

    if (type === "people") return Object.assign({}, common, {
      "rolle": "role",
      "avdeling": "dept",
      "leder": "manager",
      "ansvar": "responsibilities"
    });

    if (type === "responsibilities") return Object.assign({}, common, {
      "omrade": "area",
      "område": "area",
      "kategori": "category",
      "ansvarlig": "owner",
      "backup": "backup",
      "beskrivelse": "description"
    });

    if (type === "vendors") return Object.assign({}, common, {
      "leverandor": "name",
      "leverandør": "name",
      "type": "type",
      "kontakt": "contact",
      "nettside": "website",
      "kundenr": "customerNo",
      "kundenummer": "customerNo",
      "bestilling": "ordering"
    });

    if (type === "systems") return Object.assign({}, common, {
      "system": "name",
      "kategori": "category",
      "leverandor": "vendor",
      "leverandør": "vendor",
      "eier": "owner",
      "kostnad": "cost",
      "kritikalitet": "criticality",
      "integrasjon": "integrations",
      "integrasjoner": "integrations",
      "dataflyt": "dataFlow"
    });

    if (type === "purchasing") return Object.assign({}, common, {
      "hva": "item",
      "innkjop": "item",
      "innkjøp": "item",
      "leverandor": "vendor",
      "leverandør": "vendor",
      "godkjenner": "approver",
      "metode": "method",
      "grense": "limit",
      "belopsgrense": "limit",
      "beløpsgrense": "limit",
      "instruks": "instructions"
    });

    return common;
  }

  function fieldMatches(item, field, value) {
    var wanted = String(value || "").toLowerCase();

    if (field === "attachments") {
      return attachmentText(item).toLowerCase().indexOf(wanted) >= 0;
    }

    if (field === "integrations") {
      var has = !!String(item.integrations || "").trim();
      if (wanted === "ja" || wanted === "yes") return has;
      if (wanted === "nei" || wanted === "no") return !has;
    }

    return String(item[field] || "").toLowerCase().indexOf(wanted) >= 0;
  }

  function attachmentText(item) {
    return (item.attachments || []).map(function (a) {
      return [a.title, a.url, a.visibility].join(" ");
    }).join(" ");
  }

  function filterSearch(list, q) {
    if (!q) return list;
    return list.filter(function (item) {
      return Object.keys(item).some(function (k) {
        return String(item[k] || "").toLowerCase().indexOf(q) >= 0;
      });
    });
  }

  function applyFilter(tab, list, filter) {
    if (!filter || filter === "all") return list;

    var parts = filter.split(":");
    var key = parts[0];
    var value = parts.slice(1).join(":");

    return list.filter(function (item) {
      if (tab === "people") {
        if (key === "dept") return item.dept === value;
        if (key === "role") return item.role === value;
        if (filter === "missing-contact") return !item.phone || !item.email;
        if (filter === "no-manager") return !item.manager;
      }

      if (tab === "responsibilities") {
        if (key === "category") return item.category === value;
        if (key === "owner") return item.owner === value;
        if (filter === "missing-backup") return !item.backup;
      }

      if (tab === "vendors") {
        if (key === "type") return item.type === value;
        if (filter === "missing-contact") return !item.phone && !item.email && !item.website;
        if (filter === "has-ordering") return !!item.ordering;
        if (filter === "missing-ordering") return !item.ordering;
      }

      if (tab === "systems") {
        if (key === "criticality") return item.criticality === value;
        if (key === "category") return item.category === value;
        if (key === "owner") return item.owner === value;
        if (filter === "missing-owner") return !item.owner;
        if (filter === "has-integrations") return !!item.integrations;
        if (filter === "missing-integrations") return !item.integrations;
      }

      if (tab === "purchasing") {
        if (key === "vendor") return item.vendor === value;
        if (key === "approver") return item.approver === value;
        if (key === "method") return item.method === value;
        if (filter === "has-limit") return !!item.limit;
        if (filter === "always-approval") return String(item.limit || "").toLowerCase().indexOf("alltid") >= 0 || String(item.approver || "").trim();
      }

      return true;
    });
  }

  function renderCollection(type, items, view, def, isAdmin) {
    if (!items.length) return '<div class="od-empty">Ingen oppføringer funnet.</div>';
    if (view === "list") return listView(type, items, def, isAdmin);
    return cardView(type, items, def, isAdmin);
  }

  function cardView(type, items, def, isAdmin) {
    return '<div class="od-grid">' + items.map(function (item) {
      var rows = def.rows(item);
      return '<article class="od-card" data-od-open="' + esc(type) + ':' + esc(item.id) + '">' +
        '<span class="od-pill">' + esc(def.pill(item)) + '</span>' +
        '<h3>' + esc(def.title(item)) + '</h3>' +
        '<div class="od-kv">' + rows.slice(0, 5).map(kvRow).join("") + '</div>' +
        (isAdmin ? '<div class="od-actions">' +
          '<button class="btn btn--ghost btn--sm" data-od-edit="' + esc(type) + ':' + esc(item.id) + '">Rediger</button>' +
          '<button class="btn btn--ghost btn--sm" data-od-del="' + esc(type) + ':' + esc(item.id) + '">Slett</button>' +
        '</div>' : '') +
      '</article>';
    }).join("") + '</div>';
  }

  function listView(type, items, def, isAdmin) {
    var sorted = sortItems(type, items);
    return '<div class="od-table-wrap"><table class="od-table">' +
      '<thead><tr>' + def.cols.map(function (c) {
        var mark = sortState.type === type && sortState.key === c[1] ? (sortState.dir === "asc" ? " ↑" : " ↓") : "";
        return '<th data-od-sort="' + esc(type) + ':' + esc(c[1]) + '">' + esc(c[0] + mark) + '</th>';
      }).join("") + '<th></th></tr></thead>' +
      '<tbody>' + sorted.map(function (item) {
        return '<tr data-od-open="' + esc(type) + ':' + esc(item.id) + '">' +
          def.cols.map(function (c) { return '<td>' + valueHtml(item[c[1]]) + '</td>'; }).join("") +
          '<td>' + (isAdmin ? '<button class="btn btn--ghost btn--sm" data-od-edit="' + esc(type) + ':' + esc(item.id) + '">Rediger</button>' : '') + '</td>' +
        '</tr>';
      }).join("") + '</tbody></table></div>';
  }

  function sortItems(type, items) {
    if (sortState.type !== type || !sortState.key) return items;
    return items.slice().sort(function (a, b) {
      var av = String(a[sortState.key] || "").toLowerCase();
      var bv = String(b[sortState.key] || "").toLowerCase();
      if (av < bv) return sortState.dir === "asc" ? -1 : 1;
      if (av > bv) return sortState.dir === "asc" ? 1 : -1;
      return 0;
    });
  }

  function kvRow(r) {
    return '<div><strong>' + esc(r[0]) + ':</strong> ' + valueHtml(r[1]) + '</div>';
  }

  function valueHtml(v) {
    if (!v) return "—";
    return esc(v);
  }

  function personDef() {
    return {
      title: function (p) { return p.name || "Uten navn"; },
      pill: function (p) { return p.dept || "Person"; },
      cols: [["Navn", "name"], ["Rolle", "role"], ["Avdeling", "dept"], ["Telefon", "phone"], ["E-post", "email"], ["Leder", "manager"]],
      rows: function (p) {
        return [["Rolle", p.role], ["Avdeling", p.dept], ["Telefon", p.phone], ["E-post", p.email], ["Nærmeste leder", p.manager], ["Ansvar", p.responsibilities], ["Notat", p.note]];
      }
    };
  }

  function respDef() {
    return {
      title: function (r) { return r.area || "Ansvar"; },
      pill: function (r) { return r.category || "Ansvar"; },
      cols: [["Område", "area"], ["Kategori", "category"], ["Ansvarlig", "owner"], ["Backup", "backup"], ["Beskrivelse", "description"]],
      rows: function (r) { return [["Kategori", r.category], ["Ansvarlig", r.owner], ["Backup", r.backup], ["Beskrivelse", r.description]]; }
    };
  }

  function vendorDef() {
    return {
      title: function (v) { return v.name || "Leverandør"; },
      pill: function (v) { return v.type || "Leverandør"; },
      cols: [["Navn", "name"], ["Type", "type"], ["Kontakt", "contact"], ["E-post", "email"], ["Kundenr.", "customerNo"]],
      rows: function (v) {
        return [["Kontakt", v.contact], ["Telefon", v.phone], ["E-post", v.email], ["Nettside", v.website], ["Kundenr.", v.customerNo], ["Bestilling", v.ordering], ["Notat", v.notes]];
      }
    };
  }

  function systemDef() {
    return {
      title: function (s) { return s.name || "System"; },
      pill: function (s) { return (s.category || "System") + (s.criticality ? " · " + s.criticality : ""); },
      cols: [["System", "name"], ["Kategori", "category"], ["Eier", "owner"], ["Leverandør", "vendor"], ["Kritikalitet", "criticality"], ["Integrert med", "integrations"]],
      rows: function (s) {
        return [["Leverandør", s.vendor], ["Intern eier", s.owner], ["Kostnad", s.cost ? s.cost + " kr / " + (s.cycle || "periode") : ""], ["Kritikalitet", s.criticality], ["Integrert med", s.integrations], ["Dataflyt", s.dataFlow], ["Fornying", s.renewal], ["Oppsigelse", s.notice], ["Innlogging", s.loginUrl], ["Notat", s.notes]];
      }
    };
  }

  function purchaseDef() {
    return {
      title: function (p) { return p.item || "Innkjøp"; },
      pill: function () { return "Innkjøp"; },
      cols: [["Hva", "item"], ["Leverandør", "vendor"], ["Godkjenner", "approver"], ["Metode", "method"], ["Grense", "limit"]],
      rows: function (p) { return [["Leverandør", p.vendor], ["Godkjenner", p.approver], ["Metode", p.method], ["Instruks", p.instructions], ["Beløpsgrense", p.limit]]; }
    };
  }

  function bind(root, tab, isAdmin) {
    root.querySelectorAll("[data-od-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var next = btn.getAttribute("data-od-tab");
        if (Intranet.navigate) Intranet.navigate("orgdrift", next);
        else draw(root, next, "");
      });
    });


    var search = root.querySelector("[data-od-search]");
    if (search) {
      search.addEventListener("input", function (e) {
        root.querySelector("[data-od-content]").innerHTML = content(tab, getData(), e.target.value, getView(), isAdmin);
        bindDynamic(root, tab);
      });
    }

    root.querySelectorAll("[data-od-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setView(btn.getAttribute("data-od-view"));
        draw(root, tab, search ? search.value : "");
      });
    });

    var newBtn = root.querySelector("[data-od-new]");
    if (newBtn) {
      newBtn.addEventListener("click", function () {
        if (!isAdminRole()) return; // «Ny» skal aldri fungere for editor/member, sjølv ved direkte kall
        if (tab === "eiendeler") openEiendelerEditor(root, null);
        else openEditor(root, tab, null);
      });
    }

    bindDynamic(root, tab);
    if (tab === "eiendeler") loadEiendelerDataIfNeeded(root);
  }

  function bindDynamic(root, tab) {
    if (tab === "eiendeler") { bindEiendelerDynamic(root); return; }

    root.querySelectorAll("[data-od-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var parts = th.getAttribute("data-od-sort").split(":");
        if (sortState.type === parts[0] && sortState.key === parts[1]) {
          sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
        } else {
          sortState.type = parts[0];
          sortState.key = parts[1];
          sortState.dir = "asc";
        }
        draw(root, parts[0], "");
      });
    });

    root.querySelectorAll("[data-od-open]").forEach(function (el) {
      el.addEventListener("click", function () {
        var parts = el.getAttribute("data-od-open").split(":");
        openDetail(root, parts[0], parts[1]);
      });
    });

    root.querySelectorAll("[data-od-edit]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!isAdminRole()) return;
        var parts = btn.getAttribute("data-od-edit").split(":");
        openEditor(root, parts[0], parts[1]);
      });
    });

    root.querySelectorAll("[data-od-del]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!isAdminRole()) return;
        var parts = btn.getAttribute("data-od-del").split(":");
        if (!confirm("Slette denne oppføringen? Kan ikke angres.")) return;
        var data = getData();
        data[parts[0]] = data[parts[0]].filter(function (x) { return x.id !== parts[1]; });
        setData(data);
        if (Intranet.logActivity) {
          Intranet.logActivity({ type: "orgdrift_updated", label: "Slettet frå Organisasjon & drift" });
        }
        draw(root, parts[0], "");
      });
    });
  }

  function getItem(type, idValue) {
    var data = getData();
    return (data[type] || []).find(function (x) { return x.id === idValue; });
  }

  function defFor(type) {
    if (type === "people") return personDef();
    if (type === "responsibilities") return respDef();
    if (type === "vendors") return vendorDef();
    if (type === "systems") return systemDef();
    return purchaseDef();
  }

  function openDetail(root, type, idValue) {
    var item = getItem(type, idValue);
    if (!item) return;

    var def = defFor(type);
    var isAdmin = isAdminRole();
    var body = '<div class="od-kv">' + def.rows(item).map(function (r) {
      return '<div><strong>' + esc(r[0]) + ':</strong> ' + richValue(r[1]) + '</div>';
    }).join("") + '</div>' +
    attachmentsView(item) +
    '<div class="od-actions">' +
      (isAdmin ? '<button class="btn btn--primary btn--sm" data-od-modal-edit>Rediger</button>' : '') +
      '<button class="btn btn--ghost btn--sm" data-od-modal-close>Lukk</button>' +
    '</div>';

    openModal(def.title(item), '<span class="od-pill">' + esc(def.pill(item)) + '</span>' + body, function (modal) {
      modal.querySelector("[data-od-modal-close]").addEventListener("click", closeModal);
      var editBtn = modal.querySelector("[data-od-modal-edit]");
      if (editBtn) editBtn.addEventListener("click", function () {
        if (!isAdminRole()) return;
        closeModal();
        openEditor(root, type, idValue);
      });
    });
  }

  function richValue(v) {
    if (!v) return "—";
    var str = String(v);
    if (/^https?:\/\//i.test(str)) return '<a href="' + esc(str) + '" target="_blank" rel="noopener">' + esc(str) + '</a>';
    if (/@/.test(str) && str.indexOf(" ") < 0) return '<a href="mailto:' + esc(str) + '">' + esc(str) + '</a>';
    return esc(str).replace(/\n/g, "<br>");
  }

  function openModal(title, bodyHtml, onMount) {
    closeModal();

    var wrap = document.createElement("div");
    wrap.className = "od-modal-backdrop";
    wrap.setAttribute("data-od-modal", "1");
    wrap.innerHTML =
      '<div class="od-modal" role="dialog" aria-modal="true">' +
        '<div class="od-modal-head">' +
          '<div><h3>' + esc(title) + '</h3></div>' +
          '<button class="od-close" data-od-x aria-label="Lukk">×</button>' +
        '</div>' +
        '<div class="od-modal-body">' + bodyHtml + '</div>' +
      '</div>';

    document.body.appendChild(wrap);
    wrap.querySelector("[data-od-x]").addEventListener("click", closeModal);
    wrap.addEventListener("click", function (e) {
      if (e.target === wrap) closeModal();
    });

    if (onMount) onMount(wrap);
  }

  function closeModal() {
    var old = document.querySelector("[data-od-modal]");
    if (old) old.remove();
  }

  function openEditor(root, type, itemId) {
    if (!isAdminRole()) return; // server (RLS) vil uansett avvise skriving frå ikkje-admin
    var data = getData();
    var item = itemId ? (data[type] || []).find(function (x) { return x.id === itemId; }) : null;
    var html = editorHtml(type, item);

    // Alltid sentrert modal — drawer er for smal for dette skjemaet
    openModal(item ? "Rediger oppføring" : "Ny oppføring", html +
      '<div class="od-actions"><button class="btn btn--primary btn--sm" data-od-save>Lagre</button><button class="btn btn--ghost btn--sm" data-od-cancel>Avbryt</button></div>',
      function (modal) { bindEditor(modal, root, type, item); });
  }

  function editorHtml(type, item) {
    item = item || {};

    if (type === "people") return form([
      input("name", "Navn", item.name, true),
      input("role", "Rolle", item.role),
      combo("dept", "Avdeling", item.dept, departmentOptions(item.dept)),
      row(input("phone", "Telefon", item.phone), input("email", "E-post", item.email)),
      combo("manager", "Nærmeste leder", item.manager, peopleOptions(item.name)),
      area("responsibilities", "Ansvarsområder", item.responsibilities),
      area("note", "Notat", item.note)
    ]);

    if (type === "responsibilities") return form([
      input("area", "Ansvarsområde", item.area, true),
      input("category", "Kategori", item.category),
      row(combo("owner", "Ansvarlig", item.owner, peopleOptions()), combo("backup", "Backup", item.backup, peopleOptions(), "Hvem som kan steppe inn hvis den ansvarlige er borte — ikke en datasikkerhetskopi.")),
      area("description", "Beskrivelse", item.description)
    ]);

    if (type === "vendors") return form([
      input("name", "Leverandør/partner", item.name, true),
      select("type", "Type", item.type, ["Innkjøp", "System", "Abonnement", "Partner", "Drift", "Annet"]),
      input("contact", "Kontaktperson", item.contact),
      row(input("phone", "Telefon", item.phone), input("email", "E-post", item.email)),
      input("website", "Nettside/bestillingsportal", item.website),
      input("customerNo", "Kundenummer/avtalenummer", item.customerNo),
      area("ordering", "Hvordan bestiller vi?", item.ordering),
      area("notes", "Notater", item.notes)
    ], item);

    if (type === "systems") return form([
      input("name", "System/abonnement", item.name, true),
      select("category", "Kategori", item.category, ["IT-system", "Abonnement", "Domene/hosting", "Økonomi", "Markedsføring", "HR", "Annet"]),
      row(combo("vendor", "Leverandør", item.vendor, vendorOptions()), combo("owner", "Intern eier", item.owner, peopleOptions())),
      row(input("cost", "Kostnad", item.cost), input("cycle", "Periode", item.cycle || "Månedlig")),
      select("criticality", "Kritikalitet", item.criticality, ["Lav", "Medium", "Høy"],
        "Vises på Dashboard og brukes til søk — velg «Høy» for systemer virksomheten ikke kan fungere uten."),
      integrationPicker(item),
      area("dataFlow", "Dataflyt / hva går gjennom systemet?", item.dataFlow),
      row(input("renewal", "Fornyelsesdato", item.renewal), input("notice", "Oppsigelsesfrist", item.notice)),
      input("loginUrl", "Innloggingslenke", item.loginUrl),
      area("notes", "Notater", item.notes)
    ]);

    return form([
      input("item", "Hva skal kjøpes?", item.item, true),
      row(combo("vendor", "Leverandør", item.vendor, vendorOptions()), combo("approver", "Godkjenner", item.approver, peopleOptions())),
      row(input("method", "Bestillingsmåte", item.method),
          input("limit", "Beløpsgrense", item.limit, false, "Kun en huskeregel her — beløpet håndheves ikke automatisk noe sted.")),
      area("instructions", "Instruks", item.instructions)
    ]);
  }

  function form(parts, item) {
    return '<form class="od-form" data-od-form>' + parts.join("") + attachmentEditor(item || {}) + '</form>';
  }

  function row(a, b) {
    return '<div class="od-row">' + a + b + '</div>';
  }

  // hint (valgfritt, siste parameter på kvar hjelpefunksjon): kort, alltid
  // synleg forklaringstekst under feltet -- same idé som field({hint}) i
  // components.js, men desse lokale skjema-hjelparane har ingen delt
  // komponent å arve det frå.
  function hintHtml(hint) {
    return hint ? '<p class="i-hint" style="margin-top:.15rem">' + esc(hint) + '</p>' : "";
  }
  function input(name, label, value, required, hint) {
    return '<label>' + esc(label) +
      '<input name="' + esc(name) + '" value="' + esc(value || "") + '"' + (required ? " required" : "") + '>' +
    '</label>' + hintHtml(hint);
  }

  function area(name, label, value) {
    return '<label>' + esc(label) +
      '<textarea name="' + esc(name) + '">' + esc(value || "") + '</textarea>' +
    '</label>';
  }

  function select(name, label, value, options, hint) {
    return '<label>' + esc(label) +
      '<select name="' + esc(name) + '">' +
        options.map(function (o) {
          return '<option value="' + esc(o) + '"' + (o === value ? " selected" : "") + '>' + esc(o) + '</option>';
        }).join("") +
      '</select>' +
    '</label>' + hintHtml(hint);
  }

  function combo(name, label, value, options, hint) {
    var listId = "od-list-" + name + "-" + Math.random().toString(36).slice(2, 7);
    return '<label>' + esc(label) +
      '<input name="' + esc(name) + '" list="' + esc(listId) + '" value="' + esc(value || "") + '">' +
      '<datalist id="' + esc(listId) + '">' + (options || []).map(function (o) {
        return '<option value="' + esc(o) + '"></option>';
      }).join("") + '</datalist>' +
    '</label>' + hintHtml(hint);
  }

  function integrationPicker(item) {
    var data = getData();
    var selected = splitIntegrations(item && item.integrations);
    var systems = data.systems.filter(function (s) { return !item || s.id !== item.id; });

    if (!systems.length) return area("integrations", "Integrert med", item ? item.integrations : "");

    return '<label>Integrert med' +
      '<div style="display:grid;gap:.35rem;border:1px solid var(--color-border);border-radius:.7rem;padding:.6rem;background:var(--color-surface)">' +
        systems.map(function (s) {
          var checked = selected.indexOf(s.name) >= 0 ? " checked" : "";
          return '<label style="display:flex;gap:.45rem;align-items:center;color:var(--color-text);font-size:.88rem">' +
            '<input type="checkbox" data-od-integration value="' + esc(s.name) + '"' + checked + '> ' + esc(s.name) +
          '</label>';
        }).join("") +
        '<input name="integrationsExtra" placeholder="Andre integrasjoner, kommaseparert" value="' + esc(extraIntegrations(selected, systems)) + '">' +
        '<input type="hidden" name="integrations" value="' + esc(selected.join(", ")) + '">' +
      '</div>' +
    '</label>' + hintHtml("Brukes til søk, f.eks. «Integrasjoner: ja».");
  }

  function extraIntegrations(selected, systems) {
    var names = systems.map(function (s) { return s.name; });
    return selected.filter(function (x) { return names.indexOf(x) < 0; }).join(", ");
  }

  function collectDepartments(people) {
    var found = {};
    (people || []).forEach(function (p) {
      if (p.dept) found[p.dept] = true;
    });
    return Object.keys(found).sort();
  }

  function departmentOptions(current) {
    var data = getData();
    var deps = data.departments || collectDepartments(data.people);
    if (current && deps.indexOf(current) < 0) deps.push(current);
    return deps.sort();
  }

  function peopleOptions(excludeName) {
    return getData().people
      .map(function (p) { return p.name; })
      .filter(function (name) { return name && name !== excludeName; })
      .sort();
  }

  function vendorOptions() {
    return getData().vendors.map(function (v) { return v.name; }).filter(Boolean).sort();
  }


  function attachmentsView(item) {
    var list = item.attachments || [];
    if (!list.length) return "";

    return '<div class="od-attachment-list">' +
      '<strong style="font-size:.9rem">Vedlegg</strong>' +
      list.map(function (a) {
        var label = a.title || a.url || "Vedlegg";
        var vis = a.visibility || "Ansatte";
        var link = a.url
          ? '<a href="' + esc(normalizeUrl(a.url)) + '" target="_blank" rel="noopener">' + esc(label) + '</a>'
          : esc(label);
        return '<div class="od-attachment-item">' + link + '<span>' + esc(vis) + '</span></div>';
      }).join("") +
    '</div>';
  }

  function attachmentEditor(item) {
    var list = item.attachments || [];
    return '<div class="od-attachments" data-od-attachments>' +
      '<strong style="font-size:.9rem">Vedlegg</strong>' +
      '<p class="od-muted">Legg inn lenke til kontrakt, avtale, DPA, teknisk dokumentasjon eller andre relevante filer. Faktisk filopplasting kan kobles til Supabase senere.</p>' +
      '<div data-od-attachment-rows>' +
        (list.length ? list : [{ title: "", url: "", visibility: "Ansatte" }]).map(function (a, i) {
          return attachmentRow(a, i);
        }).join("") +
      '</div>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-od-attachment-add>Legg til vedlegg</button>' +
    '</div>';
  }

  function attachmentRow(a, i) {
    return '<div class="od-attachment-row" data-od-attachment-row>' +
      '<input name="attachmentTitle' + i + '" placeholder="Navn på vedlegg" value="' + esc(a.title || "") + '">' +
      '<input name="attachmentUrl' + i + '" placeholder="Lenke / fil-URL" value="' + esc(a.url || "") + '">' +
      '<select name="attachmentVisibility' + i + '">' +
        option("Ansatte", a.visibility) +
        option("Ledere", a.visibility) +
        option("Admin", a.visibility) +
        option("Avdeling", a.visibility) +
      '</select>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-od-attachment-remove>Fjern</button>' +
    '</div>';
  }

  function option(value, current) {
    return '<option value="' + esc(value) + '"' + (value === current ? " selected" : "") + '>' + esc(value) + '</option>';
  }

  function readAttachments(scope) {
    var out = [];
    scope.querySelectorAll("[data-od-attachment-row]").forEach(function (row) {
      var title = row.querySelector('input[name^="attachmentTitle"]');
      var url = row.querySelector('input[name^="attachmentUrl"]');
      var visibility = row.querySelector('select[name^="attachmentVisibility"]');
      if (!title || !url) return;

      var t = title.value.trim();
      var u = url.value.trim();
      if (!t && !u) return;

      out.push({
        title: t || u,
        url: u,
        visibility: visibility ? visibility.value : "Ansatte"
      });
    });
    return out;
  }

  function bindAttachmentEditor(scope) {
    var box = scope.querySelector("[data-od-attachments]");
    if (!box) return;

    var rows = box.querySelector("[data-od-attachment-rows]");
    var add = box.querySelector("[data-od-attachment-add]");

    if (add && rows) {
      add.addEventListener("click", function () {
        var i = rows.querySelectorAll("[data-od-attachment-row]").length;
        rows.insertAdjacentHTML("beforeend", attachmentRow({ title: "", url: "", visibility: "Ansatte" }, i));
        bindAttachmentRemove(rows.lastElementChild);
      });
    }

    rows.querySelectorAll("[data-od-attachment-row]").forEach(bindAttachmentRemove);
  }

  function bindAttachmentRemove(row) {
    var btn = row.querySelector("[data-od-attachment-remove]");
    if (!btn) return;

    btn.addEventListener("click", function () {
      var parent = row.parentNode;
      if (parent && parent.querySelectorAll("[data-od-attachment-row]").length <= 1) {
        row.querySelectorAll("input").forEach(function (i) { i.value = ""; });
        return;
      }
      row.remove();
    });
  }

  function normalizeUrl(url) {
    if (!url) return "";
    return /^https?:\/\//i.test(url) || /^data:/i.test(url) ? url : "https://" + url;
  }

  function bindEditor(scope, root, type, item) {
    bindAttachmentEditor(scope);

    scope.querySelector("[data-od-save]").addEventListener("click", function () {
      var formEl = scope.querySelector("[data-od-form]");
      if (!formEl.checkValidity()) {
        formEl.reportValidity();
        return;
      }

      var data = getData();
      var obj = item ? Object.assign({}, item) : { id: uid(type.slice(0, 2)) };

      if (type === "systems") {
        var ints = [];
        scope.querySelectorAll("[data-od-integration]:checked").forEach(function (el) {
          ints.push(el.value);
        });
        var extra = formEl.querySelector('[name="integrationsExtra"]');
        if (extra && extra.value.trim()) {
          splitIntegrations(extra.value).forEach(function (x) { ints.push(x); });
        }
        var hidden = formEl.querySelector('[name="integrations"]');
        if (hidden) hidden.value = unique(ints).join(", ");
      }

      Array.prototype.slice.call(formEl.elements).forEach(function (el) {
        if (!el.name || el.name === "integrationsExtra" || el.name.indexOf("attachment") === 0) return;
        obj[el.name] = el.value.trim();
      });

      obj.attachments = readAttachments(scope);

      if (item) {
        var idx = data[type].findIndex(function (x) { return x.id === item.id; });
        if (idx >= 0) data[type][idx] = obj;
      } else {
        data[type].unshift(obj);
      }

      if (type === "people" && obj.dept) {
        data.departments = data.departments || [];
        if (data.departments.indexOf(obj.dept) < 0) data.departments.push(obj.dept);
        data.departments.sort();
      }

      setData(data);

      closeModal();

      draw(root, type, "");

      if (Intranet.logActivity) {
        Intranet.logActivity({ type: "orgdrift_updated", label: "Oppdatert Organisasjon & drift" });
      }
    });

    scope.querySelector("[data-od-cancel]").addEventListener("click", function () {
      closeModal();
    });
  }

  function splitIntegrations(v) {
    if (!v) return [];
    return String(v).split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function unique(arr) {
    var seen = {};
    return (arr || []).filter(function (x) {
      x = String(x || "").trim();
      if (!x || seen[x]) return false;
      seen[x] = true;
      return true;
    });
  }

  /* =========================================================================
     EIENDELER (Fase 1, 2026-08-10) — eigen fane i denne modulen, men EKTE
     Supabase-tabellar (assets/asset_categories) i staden for wsp-orgdrift-
     blobben dei andre fem fanene brukar over. Grunngjeving: RLS kan ikkje
     skilje lese/skrive-rettar innanfor éin JSON-blob (sjå kommentaren ved
     isAdminRole() over), og "ingen dummydata"-kravet for denne fana kolliderer
     med defaults() sin sådde testdata same stad. Same tilgangsnivå som resten
     av modulen likevel (admin-only skriv, isAdminRole() + is_admin_or_owner()
     i RLS) -- brukarvedtak, konsekvens for heile "Organisasjon & drift", ikkje
     eit hierarki av ulike tilgangsnivå per fane.

     Datahenting/skriving går via _sb.from("assets"/"asset_categories") med
     App.store-fallback når Supabase manglar, same idiom som module-tasks.js.
     _eiAssets/_eiCategories er modulvariablar (cache) -- draw()/content() les
     dei synkront, loadEiendelerDataIfNeeded() fyller dei async ved behov og
     re-rendrar berre [data-od-content] når svaret kjem (same mønster som
     søkefeltet sin eigen handterar over).
     ====================================================================== */
  var EI_STORE_KEY            = "wsp-eiendeler-assets";
  var EI_CATEGORIES_STORE_KEY = "wsp-eiendeler-categories";
  var EI_HISTORY_STORE_KEY    = "wsp-eiendeler-history";

  var EI_OWNERSHIP_LABELS = { owned: "Eid", leased: "Leid", borrowed: "Lånt" };
  var EI_STATUS_LABELS    = { in_use: "I bruk", in_storage: "På lager", in_service: "Til service" };
  var EI_STATUS_VALUE_BY_LABEL = { "I bruk": "in_use", "På lager": "in_storage", "Til service": "in_service" };

  var _eiAssets     = null;  // null = ikkje henta enno (skil frå ei ekte tom liste)
  var _eiCategories = [];
  // Historikk vert henta saman med assets/categories (same runde, Fase 2) --
  // difor ikkje sitt eige null-sentinel: han er alltid klar samstundes med
  // _eiAssets, sidan detaljvisinga (den einaste som treng han) berre er
  // nåbar etter at _eiAssets alt har gått frå null til ei liste.
  var _eiHistory    = [];
  var _eiLoadError  = null;
  var _eiLoading    = false;

  function eiKr(n) {
    return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(Number(n) || 0);
  }

  function eiendelerDateNo(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString("nb-NO");
  }

  function fetchEiendelerData(cb) {
    if (!_sb) {
      _eiCategories = App.store.get(EI_CATEGORIES_STORE_KEY, []) || [];
      _eiAssets     = App.store.get(EI_STORE_KEY, []) || [];
      _eiHistory    = App.store.get(EI_HISTORY_STORE_KEY, []) || [];
      cb(null);
      return;
    }
    // Sekvensielt, ikkje parallelt -- tre små spørringar, enklare å resonnere
    // om enn ein pending-teljar for eit marginalt tidsgevinst.
    _sb.from("asset_categories").select("*").order("name").then(function (catRes) {
      if (catRes.error) { cb(catRes.error); return; }
      _sb.from("assets").select("*").order("created_at", { ascending: false }).then(function (assetRes) {
        if (assetRes.error) { cb(assetRes.error); return; }
        _sb.from("asset_ownership_history").select("*").order("changed_on", { ascending: false }).then(function (histRes) {
          if (histRes.error) { cb(histRes.error); return; }
          _eiCategories = catRes.data || [];
          _eiAssets     = assetRes.data || [];
          _eiHistory    = histRes.data || [];
          cb(null);
        });
      });
    });
  }

  function loadEiendelerDataIfNeeded(root) {
    if (_eiAssets !== null || _eiLoading) return;
    _eiLoading = true;
    fetchEiendelerData(function (err) {
      _eiLoading = false;
      _eiLoadError = err || null;
      rerenderEiendelerContent(root);
    });
  }

  function rerenderEiendelerContent(root) {
    // Brukaren kan ha navigert vekk frå fana (eller heile Workspace) før
    // Supabase-svaret kom attende -- same "sjekk DOM-tilstand"-vakt som
    // fleire andre asynkrone rendrarar i kodebasen alt bruker.
    if (!root || !root.ownerDocument || !root.ownerDocument.contains(root)) return;
    var contentEl = root.querySelector("[data-od-content]");
    if (!contentEl) return;
    var search = root.querySelector("[data-od-search]");
    contentEl.innerHTML = eiendelerContent(search ? search.value : "", getView());
    bindEiendelerDynamic(root);
  }

  function eiendelerCategoryName(categoryId) {
    var cat = _eiCategories.filter(function (c) { return c.id === categoryId; })[0];
    return cat ? cat.name : "Uten kategori";
  }

  function eiendelerHistoryFor(assetId) {
    return (_eiHistory || [])
      .filter(function (h) { return h.asset_id === assetId; })
      .sort(function (a, b) { return (b.changed_on || "").localeCompare(a.changed_on || ""); });
  }

  function eiendelerHistoryHtml(assetId) {
    var hist = eiendelerHistoryFor(assetId);
    if (!hist.length) return "";
    return '<div class="ei-history"><h4>Eierskapshistorikk</h4><ul>' +
      hist.map(function (h) {
        return '<li>' + esc(eiendelerDateNo(h.changed_on)) + ': ' +
          esc(EI_OWNERSHIP_LABELS[h.from_ownership] || h.from_ownership) + ' → ' +
          esc(EI_OWNERSHIP_LABELS[h.to_ownership] || h.to_ownership) + '</li>';
      }).join("") +
    '</ul></div>';
  }

  function eiendelerFilter(list, q) {
    q = String(q || "").trim().toLowerCase();
    if (!q) return list;
    return list.filter(function (a) {
      return [a.name, a.model, a.location, a.supplier].join(" ").toLowerCase().indexOf(q) >= 0;
    });
  }

  function eiendelerSummary(assets) {
    var owned    = assets.filter(function (a) { return a.ownership === "owned"; });
    var leased   = assets.filter(function (a) { return a.ownership === "leased"; });
    var borrowed = assets.filter(function (a) { return a.ownership === "borrowed"; });
    var totalPrice  = owned.reduce(function (s, a) { return s + (Number(a.purchase_price) || 0); }, 0);
    var totalValue  = owned.reduce(function (s, a) { return s + (a.estimated_value != null ? Number(a.estimated_value) : 0); }, 0);
    var monthlyRent = assets.reduce(function (s, a) { return s + (Number(a.rent_per_month) || 0); }, 0);
    var missing     = owned.filter(function (a) { return a.estimated_value === null || a.estimated_value === undefined; }).length;

    return '<div class="od-stats">' +
        '<div class="od-stat"><span>Registrerte eiendeler</span><strong>' + assets.length + '</strong></div>' +
        '<div class="od-stat"><span>Eid · leid · lånt</span><strong style="font-size:1.05rem">' + owned.length + ' · ' + leased.length + ' · ' + borrowed.length + '</strong></div>' +
        '<div class="od-stat"><span>Kjøpsverdi (eid)</span><strong>' + eiKr(totalPrice) + '</strong></div>' +
        '<div class="od-stat"><span>Verdi i dag (eid)</span><strong>' + eiKr(totalValue) + '</strong></div>' +
        '<div class="od-stat"><span>Leiekostnad/måned</span><strong>' + eiKr(monthlyRent) + '</strong></div>' +
      '</div>' +
      (missing ? '<p class="od-help">' + missing + ' eide eiendeler mangler verdivurdering.</p>' : '');
  }

  // opts.quickUpload: syn ein "Last opp bilde"-knapp direkte i kort-/
  // detaljvisinga når biletet manglar (Fase 3) -- utan å måtte opne heile
  // redigeringsskjemaet. App.media.resolve() sidan verdien anten er ein ekte
  // Supabase-URL ELLER ein "media:"-lokal-referanse (App.supabase falsy,
  // t.d. i testmiljøet) -- same tolking som resten av kodebasen sine
  // biletfelt alt bruker (sjå core.js sin eigen Media.resolve()).
  function eiendelerVisual(a, opts) {
    opts = opts || {};
    if (a.image_url) return '<div class="ei-visual"><img src="' + esc(App.media.resolve(a.image_url)) + '" alt="' + esc(a.name) + '"></div>';
    var uploadBtn = (opts.quickUpload && isAdminRole())
      ? '<button type="button" class="btn btn--ghost btn--sm ei-visual__upload" data-ei-quick-upload="' + esc(a.id) + '">Last opp bilde</button>'
      : '';
    return '<div class="ei-visual ei-visual--placeholder"><span class="ti ti-package"></span>' + uploadBtn + '</div>';
  }

  function eiendelerValueLine(a) {
    if (a.ownership === "leased") return '<b>' + eiKr(a.rent_per_month) + '</b><br><small class="od-muted">per måned</small>';
    if (a.ownership === "borrowed") return '<em class="od-muted">Ingen kostnad</em>';
    if (a.estimated_value === null || a.estimated_value === undefined) return '<em class="od-muted">Ikke vurdert</em>';
    return '<b>' + eiKr(a.estimated_value) + '</b>';
  }

  function eiendelerCard(a) {
    return '<div class="od-card" data-ei-open="' + esc(a.id) + '" tabindex="0" role="button">' +
      eiendelerVisual(a, { quickUpload: true }) +
      '<h3>' + esc(a.name) + ' <span class="ei-ownership ei-ownership--' + esc(a.ownership) + '">' + esc(EI_OWNERSHIP_LABELS[a.ownership] || a.ownership) + '</span></h3>' +
      '<p>' + esc(a.model || "") + '</p>' +
      '<p class="od-muted">⌖ ' + esc(a.location || "Ingen plassering") + '</p>' +
      '<p>' + eiendelerValueLine(a) + '</p>' +
    '</div>';
  }

  function eiendelerCardView(list) {
    return '<div class="od-grid">' + list.map(eiendelerCard).join("") + '</div>';
  }

  // UX-review-funn (HIGH, 2026-08-10): på smal skjerm skjuler @media-regelen
  // .ei-list__head heilt -- utan ei etikett INNI kvar celle vart "28 000 kr"
  // og "19 000 kr" stabla identisk, umogleg å skilje Kjøpspris frå Verdi.
  // ei-list__mlabel er difor alltid i markupen, men CSS skjuler han over
  // 650px (der kolonneoverskrifta over alt gjer jobben).
  function eiendelerListView(list) {
    return '<div class="ei-list">' +
      '<div class="ei-list__head"><span>Eiendel</span><span>Kategori</span><span>Plassering</span><span>Kjøpspris</span><span>Verdi/kostnad</span></div>' +
      list.map(function (a) {
        return '<div class="ei-list__row" data-ei-open="' + esc(a.id) + '" tabindex="0" role="button">' +
          '<span><b>' + esc(a.name) + '</b> <em class="ei-ownership ei-ownership--' + esc(a.ownership) + '">' + esc(EI_OWNERSHIP_LABELS[a.ownership] || a.ownership) + '</em><br><small class="od-muted">' + esc(a.model || "") + '</small></span>' +
          '<span><small class="ei-list__mlabel">Kategori: </small><span class="od-muted">' + esc(eiendelerCategoryName(a.category_id)) + '</span></span>' +
          '<span><small class="ei-list__mlabel">Plassering: </small><span class="od-muted">' + esc(a.location || "—") + '</span></span>' +
          '<span><small class="ei-list__mlabel">Kjøpspris: </small>' + (a.ownership === "owned" && a.purchase_price != null ? eiKr(a.purchase_price) : "—") + '</span>' +
          '<span><small class="ei-list__mlabel">Verdi/kostnad: </small>' + eiendelerValueLine(a) + '</span>' +
        '</div>';
      }).join("") +
    '</div>';
  }

  function eiendelerContent(q, view) {
    if (_eiLoadError) {
      return '<div class="od-empty"><b>Kunne ikke laste eiendeler</b><p>' + esc(_eiLoadError.message || "Ukjent feil") + '. Prøv igjen, eller sjekk nettforbindelsen.</p>' +
        '<button class="btn btn--ghost btn--sm" data-ei-retry type="button">Prøv igjen</button></div>';
    }
    if (_eiAssets === null) {
      return '<div class="od-empty"><b>Laster eiendeler …</b></div>';
    }
    var filtered = eiendelerFilter(_eiAssets, q);
    var body = filtered.length === 0
      ? (_eiAssets.length === 0
          ? '<div class="od-empty"><b>Ingen eiendeler registrert ennå</b><p>Legg til den første eiendelen med «Ny».</p></div>'
          : '<div class="od-empty"><b>Ingen treff</b><p>Prøv et annet søk, eller nullstill det.</p></div>')
      : (view === "list" ? eiendelerListView(filtered) : eiendelerCardView(filtered));
    // Fase 3: mål for hurtig-opplasting-frå-kort sine feilmeldingar -- ei
    // slik handling skjer utanfor både redigeringsmodalen og detaljmodalen,
    // så det finst ingen [data-ei-status]/[data-ei-detail-status] å skrive
    // til. Tom som standard, same is-err-klasse som dei andre statuslinjene.
    return eiendelerSummary(_eiAssets) + '<p class="form__status" data-ei-quick-status></p>' + body;
  }

  function eiField(name, label, value, opts) {
    opts = opts || {};
    var type = opts.type || "text";
    var attrs = 'name="' + esc(name) + '" type="' + esc(type) + '"';
    if (value !== undefined && value !== null && value !== "") attrs += ' value="' + esc(value) + '"';
    if (opts.required) attrs += " required";
    if (type === "number") attrs += ' min="0" step="0.01"';
    if (opts.placeholder) attrs += ' placeholder="' + esc(opts.placeholder) + '"';
    return '<label>' + esc(label) + '<input ' + attrs + '></label>' + hintHtml(opts.hint);
  }

  function eiendelerOwnershipFields(ownership, asset) {
    asset = asset || {};
    if (ownership === "owned") {
      return row(
          eiField("acquisitionDate", "Kjøps-/overtakelsesdato", asset.acquisition_date, { type: "date" }),
          eiField("purchasePrice", "Kjøpspris (kr)", asset.purchase_price, { type: "number" })
        ) +
        row(
          eiField("estimatedValue", "Estimert verdi i dag", asset.estimated_value, { type: "number", placeholder: "Kan fylles inn senere", hint: "Valgfritt — kan beregnes senere ut fra kategori og alder." }),
          input("location", "Plassering", asset.location)
        );
    }
    return row(
        input("supplier", ownership === "leased" ? "Leverandør/utleier" : "Eier/utlåner", asset.supplier),
        input("agreementNumber", "Avtalenummer", asset.agreement_number)
      ) +
      (ownership === "leased" ? eiField("rentPerMonth", "Leie per måned (kr)", asset.rent_per_month, { type: "number" }) : "") +
      row(
        eiField("agreementStart", "Startdato", asset.agreement_start, { type: "date" }),
        eiField("agreementEnd", "Sluttdato/returfrist", asset.agreement_end, { type: "date" })
      ) +
      (ownership === "leased" ? eiField("noticeDate", "Oppsigelsesfrist", asset.notice_date, { type: "date" }) : "") +
      row(input("location", "Plassering", asset.location), input("responsibleName", "Ansvarlig", asset.responsible_name)) +
      area("returnTerms", "Returvilkår", asset.return_terms) +
      (ownership === "leased" ? input("purchaseOption", "Eventuell kjøpsopsjon", asset.purchase_option) : "");
  }

  // Fase 3: same vesle miniatyr som eiendelerVisual() sin "utan bilete"-gren
  // brukar (utan quickUpload-knappen -- her har skjemaet sitt eige fil-input
  // rett under, ein ekstra knapp inni miniatyren ville berre vore forvirrande).
  function eiendelerImagePreviewHtml(imageUrl) {
    if (!imageUrl) return '<div class="ei-visual ei-visual--placeholder"><span class="ti ti-package"></span></div>';
    return '<div class="ei-visual"><img src="' + esc(App.media.resolve(imageUrl)) + '" alt=""></div>';
  }

  function eiendelerEditorHtml(asset) {
    asset = asset || {};
    var ownership = asset.ownership || "owned";
    var rawCategoryName = eiendelerCategoryName(asset.category_id);
    var categoryValue = rawCategoryName === "Uten kategori" ? "" : rawCategoryName;
    var statusLabel = EI_STATUS_LABELS[asset.status] || "I bruk";

    return '<form class="od-form" data-ei-form>' +
      input("name", "Navn på eiendel", asset.name, true) +
      '<label>Bilde' +
        '<div class="ei-image-field" data-ei-image-field>' +
          '<div data-ei-image-preview>' + eiendelerImagePreviewHtml(asset.image_url) + '</div>' +
          '<div class="ei-image-field__actions">' +
            '<input type="file" accept="image/*" data-ei-image-input>' +
            (asset.image_url ? '<button type="button" class="btn btn--ghost btn--sm" data-ei-image-clear>Fjern bilde</button>' : '') +
          '</div>' +
        '</div>' +
      '</label>' +
      '<input type="hidden" name="imageUrl" value="' + esc(asset.image_url || "") + '" data-ei-image-hidden>' +
      '<label>Eierskap' +
        '<div class="ei-ownership-choice" data-ei-ownership-choice>' +
          ["owned", "leased", "borrowed"].map(function (o) {
            return '<button type="button" class="' + (o === ownership ? "is-active" : "") + '" data-ei-ownership="' + o + '">' + esc(EI_OWNERSHIP_LABELS[o]) + '</button>';
          }).join("") +
        '</div>' +
      '</label>' +
      '<input type="hidden" name="ownership" value="' + esc(ownership) + '">' +
      combo("categoryName", "Kategori", categoryValue, _eiCategories.map(function (c) { return c.name; }), "Skriv navnet på en ny kategori for å opprette den.") +
      input("model", "Merke/modell", asset.model) +
      '<div data-ei-ownership-fields>' + eiendelerOwnershipFields(ownership, asset) + '</div>' +
      select("status", "Status", statusLabel, [EI_STATUS_LABELS.in_use, EI_STATUS_LABELS.in_storage, EI_STATUS_LABELS.in_service]) +
      area("note", "Notat", asset.note) +
    '</form>';
  }

  function openEiendelerEditor(root, assetId) {
    if (!isAdminRole()) return;
    var asset = assetId ? (_eiAssets || []).filter(function (a) { return a.id === assetId; })[0] : null;
    var html = eiendelerEditorHtml(asset) +
      '<div class="od-actions"><button class="btn btn--primary btn--sm" data-ei-save type="button">Lagre</button><button class="btn btn--ghost btn--sm" data-ei-cancel type="button">Avbryt</button></div>' +
      '<p class="form__status" data-ei-status></p>';
    openModal(asset ? "Rediger eiendel" : "Ny eiendel", html, function (modal) {
      bindEiendelerEditor(modal, root, asset);
    });
  }

  function createAssetCategory(name, cb) {
    if (!_sb) {
      var cat = { id: uid("cat"), name: name, annual_depreciation_rate: 0.18 };
      _eiCategories.push(cat);
      App.store.set(EI_CATEGORIES_STORE_KEY, _eiCategories);
      cb(null, cat);
      return;
    }
    _sb.from("asset_categories").insert({ name: name }).select().single().then(function (r) {
      if (r.error) { cb(r.error); return; }
      _eiCategories.push(r.data);
      cb(null, r.data);
    });
  }

  function createAsset(row, cb) {
    if (!_sb) {
      var asset = Object.assign({ id: uid("asset"), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, row);
      _eiAssets.unshift(asset);
      App.store.set(EI_STORE_KEY, _eiAssets);
      cb(null, asset);
      return;
    }
    var ctx = Intranet.getContext();
    _sb.from("assets").insert(Object.assign({}, row, { created_by: ctx && ctx.userId })).select().single().then(function (r) {
      if (r.error) { cb(r.error); return; }
      _eiAssets.unshift(r.data);
      cb(null, r.data);
    });
  }

  function updateAsset(id, changes, cb) {
    var idx = (_eiAssets || []).findIndex(function (a) { return a.id === id; });
    if (!_sb) {
      if (idx >= 0) Object.assign(_eiAssets[idx], changes, { updated_at: new Date().toISOString() });
      App.store.set(EI_STORE_KEY, _eiAssets);
      cb(null);
      return;
    }
    var ctx = Intranet.getContext();
    _sb.from("assets").update(Object.assign({}, changes, { updated_by: ctx && ctx.userId })).eq("id", id).select().single().then(function (r) {
      if (r.error) { cb(r.error); return; }
      if (idx >= 0) _eiAssets[idx] = r.data;
      cb(null);
    });
  }

  function deleteAssetRow(id, cb) {
    var idx = (_eiAssets || []).findIndex(function (a) { return a.id === id; });
    if (idx < 0) { cb(null); return; }
    var removed = _eiAssets[idx];
    _eiAssets.splice(idx, 1);
    // Fase 3: frigjer biletet (Supabase Storage-objekt eller lokal "media:"-
    // referanse) samstundes -- elles hopar sletta eiendelar seg opp som
    // foreldrelause filer i den delte "media"-bucketen, same disiplin som
    // core.js sin eigen Media.free() alt handhevar ved erstatt/fjern.
    if (removed.image_url) App.media.free(removed.image_url);
    if (!_sb) {
      // Utan Supabase finst det ingen ON DELETE CASCADE -- fjern historikken
      // for hand, elles vert han verande att som foreldrelause rader i
      // App.store (den ekte asset_ownership_history-tabellen kaskaderer
      // dette sjølv, sjå migrasjonen).
      _eiHistory = (_eiHistory || []).filter(function (h) { return h.asset_id !== id; });
      App.store.set(EI_HISTORY_STORE_KEY, _eiHistory);
      App.store.set(EI_STORE_KEY, _eiAssets);
      cb(null);
      return;
    }
    _sb.from("assets").delete().eq("id", id).then(function (r) {
      if (r.error) { _eiAssets.splice(idx, 0, removed); cb(r.error); return; }
      cb(null);
    });
  }

  // Fase 2 (2026-08-10): skriv éin historikkrad for ei stadfesta eierskaps-
  // overgang (Eid/Leid/Lånt -> ein annan verdi). "Snapshot" tek vare på dei
  // ownership-spesifikke felta FØR overgangen (kjøpspris/verdi for eigde,
  // avtaledetaljar for leigde/lånte) sidan saveEiendelerFromForm nullar dei
  // ut ved sjølve eierskapsbyttet -- utan dette ville historikken vist kva
  // som endra seg, men ikkje kva verdien FAKTISK var før.
  //
  // fromOwnership/snapshot MÅ hentast ut FØR saveEiendelerFromForm() køyrer,
  // ikkje lesast av `asset` her -- i App.store-fallback-varianten muterer
  // updateAsset() same objektreferanse i _eiAssets in-place (Object.assign),
  // så `asset.ownership` ville alt vore den NYE verdien innan denne
  // funksjonen vart kalla (fanga live 2026-08-10, sjå test n15b).
  function recordOwnershipChange(assetId, fromOwnership, newOwnership, snapshot, cb) {
    var row = {
      asset_id:       assetId,
      from_ownership: fromOwnership,
      to_ownership:   newOwnership,
      changed_on:     new Date().toISOString().slice(0, 10),
      snapshot:       snapshot
    };
    if (!_sb) {
      row.id = uid("eih");
      row.created_at = new Date().toISOString();
      _eiHistory.push(row);
      App.store.set(EI_HISTORY_STORE_KEY, _eiHistory);
      cb(null);
      return;
    }
    var ctx = Intranet.getContext();
    _sb.from("asset_ownership_history").insert(Object.assign({}, row, { changed_by: ctx && ctx.userId })).select().single().then(function (r) {
      if (r.error) { cb(r.error); return; }
      _eiHistory.push(r.data);
      cb(null);
    });
  }

  function saveEiendelerFromForm(fd, existingAsset, cb) {
    var ownership = String(fd.get("ownership") || "owned");
    var statusLabel = String(fd.get("status") || "I bruk");
    var categoryName = String(fd.get("categoryName") || "").trim();

    function withCategory(next) {
      if (!categoryName) { next(null); return; }
      var existing = _eiCategories.filter(function (c) { return c.name.toLowerCase() === categoryName.toLowerCase(); })[0];
      if (existing) { next(existing.id); return; }
      createAssetCategory(categoryName, function (err, cat) {
        if (err) { cb(err); return; }
        next(cat.id);
      });
    }

    withCategory(function (categoryId) {
      var row = {
        name:        String(fd.get("name") || "").trim(),
        ownership:   ownership,
        status:      EI_STATUS_VALUE_BY_LABEL[statusLabel] || "in_use",
        category_id: categoryId,
        model:       String(fd.get("model") || "").trim() || null,
        note:        String(fd.get("note") || "").trim() || null,
        image_url:   String(fd.get("imageUrl") || "").trim() || null,
        location:    String(fd.get("location") || "").trim() || null
      };
      if (ownership === "owned") {
        row.acquisition_date  = String(fd.get("acquisitionDate") || "") || null;
        row.purchase_price    = fd.get("purchasePrice") !== "" ? Number(fd.get("purchasePrice")) : null;
        row.estimated_value   = fd.get("estimatedValue") !== "" ? Number(fd.get("estimatedValue")) : null;
        row.supplier = row.agreement_number = row.rent_per_month = null;
        row.agreement_start = row.agreement_end = row.notice_date = null;
        row.responsible_name = row.return_terms = row.purchase_option = null;
      } else {
        row.supplier         = String(fd.get("supplier") || "").trim() || null;
        row.agreement_number = String(fd.get("agreementNumber") || "").trim() || null;
        row.rent_per_month   = ownership === "leased" && fd.get("rentPerMonth") !== "" ? Number(fd.get("rentPerMonth")) : null;
        row.agreement_start  = String(fd.get("agreementStart") || "") || null;
        row.agreement_end    = String(fd.get("agreementEnd") || "") || null;
        row.notice_date      = ownership === "leased" ? (String(fd.get("noticeDate") || "") || null) : null;
        row.responsible_name = String(fd.get("responsibleName") || "").trim() || null;
        row.return_terms     = String(fd.get("returnTerms") || "").trim() || null;
        row.purchase_option  = ownership === "leased" ? (String(fd.get("purchaseOption") || "").trim() || null) : null;
        row.acquisition_date = row.purchase_price = row.estimated_value = null;
      }

      if (existingAsset) updateAsset(existingAsset.id, row, cb);
      else createAsset(row, cb);
    });
  }

  function bindEiendelerEditor(scope, root, asset) {
    var statusEl = scope.querySelector("[data-ei-status]");
    var ownershipChoice = scope.querySelector("[data-ei-ownership-choice]");
    var hiddenOwnership = scope.querySelector('[name="ownership"]');
    var fieldsWrap = scope.querySelector("[data-ei-ownership-fields]");
    if (ownershipChoice) {
      ownershipChoice.querySelectorAll("[data-ei-ownership]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var val = btn.getAttribute("data-ei-ownership");
          hiddenOwnership.value = val;
          ownershipChoice.querySelectorAll("[data-ei-ownership]").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
          fieldsWrap.innerHTML = eiendelerOwnershipFields(val, asset || {});
        });
      });
    }

    // Fase 3: biletopplasting inni skjemaet. imageHidden held den faktiske
    // verdien som vert lagra (URL/"media:"-ref) -- fil-input og "Fjern
    // bilde" oppdaterer berre DENNE og re-rendrar miniatyren, sjølve
    // lagringa skjer fyrst når heile skjemaet lagrast (data-ei-save under).
    var imageField   = scope.querySelector("[data-ei-image-field]");
    var imageInput   = scope.querySelector("[data-ei-image-input]");
    var imageHidden  = scope.querySelector("[data-ei-image-hidden]");
    var imagePreview = scope.querySelector("[data-ei-image-preview]");

    function bindImageClearBtn() {
      var btn = imageField.querySelector("[data-ei-image-clear]");
      if (!btn) return;
      btn.addEventListener("click", function () {
        App.media.free(imageHidden.value);
        imageHidden.value = "";
        imagePreview.innerHTML = eiendelerImagePreviewHtml("");
        syncImageClearBtn();
      });
    }
    function syncImageClearBtn() {
      var actions = imageField.querySelector(".ei-image-field__actions");
      var existing = imageField.querySelector("[data-ei-image-clear]");
      if (imageHidden.value && !existing) {
        actions.insertAdjacentHTML("beforeend", '<button type="button" class="btn btn--ghost btn--sm" data-ei-image-clear>Fjern bilde</button>');
        bindImageClearBtn();
      } else if (!imageHidden.value && existing) {
        existing.parentNode.removeChild(existing);
      }
    }
    bindImageClearBtn();

    if (imageInput) imageInput.addEventListener("change", function () {
      var f = imageInput.files && imageInput.files[0];
      imageInput.value = "";
      if (!f) return;
      var previousUrl = imageHidden.value;
      App.media.put(f).then(function (url) {
        if (previousUrl) App.media.free(previousUrl);
        imageHidden.value = url;
        imagePreview.innerHTML = eiendelerImagePreviewHtml(url);
        syncImageClearBtn();
      }).catch(function (err) {
        if (statusEl) { statusEl.textContent = "Kunne ikke laste opp bildet: " + (err.message || "ukjent feil") + ". Prøv et mindre bilde."; statusEl.className = "form__status is-err"; }
      });
    });

    scope.querySelector("[data-ei-cancel]").addEventListener("click", closeModal);
    scope.querySelector("[data-ei-save]").addEventListener("click", function () {
      var formEl = scope.querySelector("[data-ei-form]");
      if (!formEl.checkValidity()) { formEl.reportValidity(); return; }
      var fd = new FormData(formEl);
      var newOwnership = String(fd.get("ownership") || "owned");
      var ownershipChanged = !!(asset && asset.ownership !== newOwnership);
      // Fase 2: eierskapsbytte er ei reell driftsendring (påverkar oversikt
      // og verdi) -- Tier B-stadfesting FØR lagring, ikkje ein stille lagra
      // detalj blant alle dei andre felta.
      if (ownershipChanged && !confirm('Endre eierskap for «' + asset.name + '» fra ' +
          (EI_OWNERSHIP_LABELS[asset.ownership] || asset.ownership) + ' til ' +
          (EI_OWNERSHIP_LABELS[newOwnership] || newOwnership) +
          '? Dette påvirker oversikt og verdi, og blir lagt til i historikken.')) return;

      // Fanga FØR lagring -- sjå kommentaren ved recordOwnershipChange() for
      // kvifor: updateAsset() sin App.store-fallback muterer `asset` in-place.
      var priorOwnership = ownershipChanged ? asset.ownership : null;
      var priorSnapshot = ownershipChanged
        ? (asset.ownership === "owned"
            ? { purchase_price: asset.purchase_price, estimated_value: asset.estimated_value, acquisition_date: asset.acquisition_date }
            : { supplier: asset.supplier, agreement_number: asset.agreement_number, rent_per_month: asset.rent_per_month, agreement_start: asset.agreement_start, agreement_end: asset.agreement_end })
        : null;

      saveEiendelerFromForm(fd, asset, function (err) {
        if (err) {
          if (statusEl) { statusEl.textContent = "Kunne ikke lagre: " + (err.message || "ukjent feil") + ". Prøv igjen."; statusEl.className = "form__status is-err"; }
          return;
        }
        if (!ownershipChanged) {
          closeModal();
          draw(root, "eiendeler", "");
          if (Intranet.logActivity) Intranet.logActivity({ type: "eiendeler_updated", label: asset ? "Oppdatert eiendel" : "Ny eiendel registrert" });
          return;
        }
        recordOwnershipChange(asset.id, priorOwnership, newOwnership, priorSnapshot, function (histErr) {
          if (histErr) {
            // Sjølve eiendelen er alt lagra -- berre historikkrada feila.
            // Held modalen open og seier ifrå, i staden for å late som ingenting
            // skjedde (men utan å late brukaren tru heile lagringa feila).
            if (statusEl) { statusEl.textContent = "Eiendelen ble lagret, men historikken kunne ikke oppdateres: " + (histErr.message || "ukjent feil") + "."; statusEl.className = "form__status is-err"; }
            return;
          }
          closeModal();
          draw(root, "eiendeler", "");
          if (Intranet.logActivity) Intranet.logActivity({ type: "eiendeler_updated", label: "Oppdatert eiendel (eierskap endret)" });
        });
      });
    });
  }

  function openEiendelerDetail(root, assetId) {
    var a = (_eiAssets || []).filter(function (x) { return x.id === assetId; })[0];
    if (!a) return;
    var isAdmin = isAdminRole();
    var body = eiendelerVisual(a, { quickUpload: true }) +
      '<div class="od-kv">' +
        '<div><strong>Eierskap:</strong> ' + esc(EI_OWNERSHIP_LABELS[a.ownership] || a.ownership) + '</div>' +
        '<div><strong>Kategori:</strong> ' + esc(eiendelerCategoryName(a.category_id)) + '</div>' +
        '<div><strong>Status:</strong> ' + esc(EI_STATUS_LABELS[a.status] || a.status) + '</div>' +
        '<div><strong>Plassering:</strong> ' + esc(a.location || "Ikke registrert") + '</div>' +
        (a.ownership === "owned"
          ? '<div><strong>Kjøpsdato:</strong> ' + esc(eiendelerDateNo(a.acquisition_date) || "Ikke registrert") + '</div>' +
            '<div><strong>Kjøpspris:</strong> ' + (a.purchase_price != null ? eiKr(a.purchase_price) : "Ikke registrert") + '</div>' +
            '<div><strong>Estimert verdi i dag:</strong> ' + (a.estimated_value != null ? eiKr(a.estimated_value) : "Ikke vurdert") + '</div>'
          : '<div><strong>' + (a.ownership === "leased" ? "Leverandør/utleier" : "Eier/utlåner") + ':</strong> ' + esc(a.supplier || "Ikke registrert") + '</div>' +
            (a.agreement_number ? '<div><strong>Avtalenummer:</strong> ' + esc(a.agreement_number) + '</div>' : "") +
            (a.ownership === "leased" ? '<div><strong>Leie per måned:</strong> ' + eiKr(a.rent_per_month) + '</div>' : "") +
            '<div><strong>Avtaleperiode:</strong> ' + esc(eiendelerDateNo(a.agreement_start) || "Ikke satt") + ' – ' + esc(eiendelerDateNo(a.agreement_end) || "Ikke satt") + '</div>' +
            (a.notice_date ? '<div><strong>Oppsigelsesfrist:</strong> ' + esc(eiendelerDateNo(a.notice_date)) + '</div>' : "") +
            '<div><strong>Ansvarlig:</strong> ' + esc(a.responsible_name || "Ikke registrert") + '</div>' +
            '<div><strong>Returvilkår:</strong> ' + esc(a.return_terms || "Ikke registrert") + '</div>' +
            (a.purchase_option ? '<div><strong>Kjøpsopsjon:</strong> ' + esc(a.purchase_option) + '</div>' : "")) +
        '<div><strong>Notat:</strong> ' + richValue(a.note) + '</div>' +
      '</div>' +
      eiendelerHistoryHtml(a.id) +
      '<div class="od-actions">' +
        (isAdmin ? '<button class="btn btn--primary btn--sm" data-ei-modal-edit="' + esc(a.id) + '" type="button">Rediger</button>' : "") +
        (isAdmin ? '<button class="btn btn--danger btn--sm" data-ei-modal-del="' + esc(a.id) + '" type="button">Slett</button>' : "") +
        '<button class="btn btn--ghost btn--sm" data-od-modal-close type="button">Lukk</button>' +
      '</div>' +
      '<p class="form__status" data-ei-detail-status></p>';

    openModal(a.name + " · " + (EI_OWNERSHIP_LABELS[a.ownership] || a.ownership), '<span class="od-pill">' + esc(eiendelerCategoryName(a.category_id)) + '</span>' + body, function (modal) {
      modal.querySelector("[data-od-modal-close]").addEventListener("click", closeModal);
      var quickUploadBtn = modal.querySelector("[data-ei-quick-upload]");
      if (quickUploadBtn) quickUploadBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        triggerEiQuickUpload(a.id, function (err) {
          if (err) {
            var statusEl = modal.querySelector("[data-ei-detail-status]");
            if (statusEl) { statusEl.textContent = "Kunne ikke laste opp bildet: " + (err.message || "ukjent feil") + ". Prøv igjen, eller bruk et mindre bilde."; statusEl.className = "form__status is-err"; }
            return;
          }
          // Enklaste måte å syne det nye biletet med det same: lat att og opne
          // detaljvisinga på nytt (same "lukk + tegn på nytt"-mønster som
          // rediger/slett-handsamarane over) -- unngår å måtte duplisere
          // eiendelerVisual()-oppdateringslogikken inni ein alt open modal.
          closeModal();
          draw(root, "eiendeler", "");
          openEiendelerDetail(root, a.id);
        });
      });
      var editBtn = modal.querySelector("[data-ei-modal-edit]");
      if (editBtn) editBtn.addEventListener("click", function () {
        if (!isAdminRole()) return;
        closeModal();
        openEiendelerEditor(root, a.id);
      });
      var delBtn = modal.querySelector("[data-ei-modal-del]");
      if (delBtn) delBtn.addEventListener("click", function () {
        if (!isAdminRole()) return;
        if (!confirm('Slette «' + a.name + '»? Handlingen kan ikke angres.')) return;
        deleteAssetRow(a.id, function (err) {
          // UX-review-funn (HIGH, 2026-08-10): alert() var ein blokkerande,
          // ustila dialog for ein rutinemessig lagringsfeil -- module-tasks.js
          // sitt eige "same idiom"-førebilete bruker ei inline .form__status-
          // melding, ikkje alert(). Retta her og i editor-lagringa under.
          if (err) {
            var statusEl = modal.querySelector("[data-ei-detail-status]");
            if (statusEl) { statusEl.textContent = "Kunne ikke slette: " + (err.message || "ukjent feil") + ". Prøv igjen."; statusEl.className = "form__status is-err"; }
            return;
          }
          closeModal();
          draw(root, "eiendeler", "");
          if (Intranet.logActivity) Intranet.logActivity({ type: "eiendeler_updated", label: "Slettet eiendel: " + a.name });
        });
      });
    });
  }

  // Fase 3: hurtig-opplasting utanfor både redigerings- og detaljmodalen --
  // ein mellombels, usynleg fil-input som fjernar seg sjølv etter bruk (same
  // "trigger eit skjult input"-triks som mange skjermlesar-venlege opplastings-
  // knappar i heile nettet bruker, ingen eigen komponent finst i kodebasen
  // frå før å gjenbruke her).
  function triggerEiQuickUpload(assetId, cb) {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", function () {
      var f = input.files && input.files[0];
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!f) return;
      App.media.put(f).then(function (url) {
        updateAsset(assetId, { image_url: url }, function (err) { cb(err || null); });
      }).catch(function (err) { cb(err || new Error("upload")); });
    });
    input.click();
  }

  function bindEiendelerDynamic(root) {
    root.querySelectorAll("[data-ei-quick-upload]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        triggerEiQuickUpload(btn.getAttribute("data-ei-quick-upload"), function (err) {
          var statusEl = root.querySelector("[data-ei-quick-status]");
          if (err) {
            if (statusEl) { statusEl.textContent = "Kunne ikke laste opp bildet: " + (err.message || "ukjent feil") + ". Prøv igjen, eller bruk et mindre bilde."; statusEl.className = "form__status is-err"; }
            return;
          }
          rerenderEiendelerContent(root);
        });
      });
    });
    root.querySelectorAll("[data-ei-open]").forEach(function (el) {
      el.addEventListener("click", function () { openEiendelerDetail(root, el.getAttribute("data-ei-open")); });
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEiendelerDetail(root, el.getAttribute("data-ei-open")); }
      });
    });
    var retryBtn = root.querySelector("[data-ei-retry]");
    if (retryBtn) retryBtn.addEventListener("click", function () {
      _eiAssets = null;
      _eiLoadError = null;
      rerenderEiendelerContent(root);
      loadEiendelerDataIfNeeded(root);
    });
  }

  Intranet.registerModule({
    id: "orgdrift",
    navLabel: "Organisasjon & drift",
    icon: "building-community",
    order:    30,
    render: render,
    mount: mount
  });

  });
})();
