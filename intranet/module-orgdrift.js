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
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.orgdrift === false) return;

  var STORE_KEY = "wsp-orgdrift";
  var VIEW_KEY = "wsp-orgdrift-view";
  var FILTER_KEY = "wsp-orgdrift-filters";

  var esc = C.esc || function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  var TABS = [
    ["people", "Personer"],
    ["responsibilities", "Ansvar"],
    ["vendors", "Leverandører"],
    ["systems", "Systemer"],
    ["purchasing", "Innkjøp"]
  ];

  var TAB_HELP = {
    people: "Kontakt- og rollekart for personer i organisasjonen. Bruk søk, f.eks. «Avdeling: drift» eller «Rolle: leder».",
    responsibilities: "Oversikt over hvem som eier interne ansvarsområder, med eventuell backup og forklaring.",
    vendors: "Leverandører og partnere med kontaktinfo, kundenummer, portal og hvordan bestilling skjer.",
    systems: "IT-systemer, abonnementer og digitale tjenester. Bruk søk, f.eks. «Kategori: IT-system», «Kritikalitet: høy» eller «Integrasjoner: ja».",
    purchasing: "Innkjøpsoversikt og regler: hva kjøpes hvor, hvem godkjenner og hvilke beløpsgrenser gjelder."
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
      "@media(max-width:650px){.od-head{display:block}.od-tools{display:block}.od-search{width:100%;box-sizing:border-box;margin-bottom:.6rem}.od-row{grid-template-columns:1fr}.od-view-toggle{margin-bottom:.6rem}}"
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
        openEditor(root, tab, null);
      });
    }

    bindDynamic(root, tab);
  }

  function bindDynamic(root, tab) {
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
        if (!confirm("Slette denne oppføringen?")) return;
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
      row(combo("owner", "Ansvarlig", item.owner, peopleOptions()), combo("backup", "Backup", item.backup, peopleOptions())),
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
      select("criticality", "Kritikalitet", item.criticality, ["Lav", "Medium", "Høy"]),
      integrationPicker(item),
      area("dataFlow", "Dataflyt / hva går gjennom systemet?", item.dataFlow),
      row(input("renewal", "Fornyelsesdato", item.renewal), input("notice", "Oppsigelsesfrist", item.notice)),
      input("loginUrl", "Innloggingslenke", item.loginUrl),
      area("notes", "Notater", item.notes)
    ]);

    return form([
      input("item", "Hva skal kjøpes?", item.item, true),
      row(combo("vendor", "Leverandør", item.vendor, vendorOptions()), combo("approver", "Godkjenner", item.approver, peopleOptions())),
      row(input("method", "Bestillingsmåte", item.method), input("limit", "Beløpsgrense", item.limit)),
      area("instructions", "Instruks", item.instructions)
    ]);
  }

  function form(parts, item) {
    return '<form class="od-form" data-od-form>' + parts.join("") + attachmentEditor(item || {}) + '</form>';
  }

  function row(a, b) {
    return '<div class="od-row">' + a + b + '</div>';
  }

  function input(name, label, value, required) {
    return '<label>' + esc(label) +
      '<input name="' + esc(name) + '" value="' + esc(value || "") + '"' + (required ? " required" : "") + '>' +
    '</label>';
  }

  function area(name, label, value) {
    return '<label>' + esc(label) +
      '<textarea name="' + esc(name) + '">' + esc(value || "") + '</textarea>' +
    '</label>';
  }

  function select(name, label, value, options) {
    return '<label>' + esc(label) +
      '<select name="' + esc(name) + '">' +
        options.map(function (o) {
          return '<option value="' + esc(o) + '"' + (o === value ? " selected" : "") + '>' + esc(o) + '</option>';
        }).join("") +
      '</select>' +
    '</label>';
  }

  function combo(name, label, value, options) {
    var listId = "od-list-" + name + "-" + Math.random().toString(36).slice(2, 7);
    return '<label>' + esc(label) +
      '<input name="' + esc(name) + '" list="' + esc(listId) + '" value="' + esc(value || "") + '">' +
      '<datalist id="' + esc(listId) + '">' + (options || []).map(function (o) {
        return '<option value="' + esc(o) + '"></option>';
      }).join("") + '</datalist>' +
    '</label>';
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
    '</label>';
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

  Intranet.registerModule({
    id: "orgdrift",
    navLabel: "Organisasjon & drift",
    icon: "building-community",
    order:    30,
    render: render,
    mount: mount
  });

})();
