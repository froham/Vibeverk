/* =============================================================================
   module-smart-aarshjul.js  —  SMART ÅRSHJUL (Workspace)
   -----------------------------------------------------------------------------
   Konvertert frå ein godkjend, sjølvstendig HTML-demo til ein ekte Workspace-
   modul. Lagring: App.store (nøkkel "wsp-smart-aarshjul"), ikkje Supabase-
   tabell (spec seksjon 6). Forslag genererast av eit ekte serverkall til
   POST /api/ai/annual-wheel (api/ai/annual-wheel.js) -- ingen lokal
   simulering lenger. Slås av/på med config.intranettFeatures.smartAarshjul
   (standard AV -- ny, betalt AI-funksjon, sjå config.js).

   CSS er avgrensa til modulen (alle klassar prefiksa "saa-"). Delegerte
   klikk/endrings-lyttarar vert bundne ÉIN gong per mount() på #saa-root --
   #saa-root vert øydelagd og laga på nytt av workspace-core.js sin
   mountModule() (outlet.innerHTML = render()) kvar gong brukaren navigerer
   TIL denne modulen, så gamle lyttarar hamnar aldri saman med nye. Interne
   re-renderingar (filter, val, redigering) byter berre ut #saa-content sitt
   innhald, aldri #saa-root sjølv -- difor kan lyttarane bindast éin gong.
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App = window.App;
  var C = window.Components;
  var CFG = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.smartAarshjul === false) return;

  var STORE_KEY = "wsp-smart-aarshjul";
  var STYLE_ID = "saa-styles";

  var MONTHS = ["Januar", "Februar", "Mars", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Desember"];
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Des"];

  var CATS = {
    planning: "Planlegging", marketing: "Synlegheit og marknadsføring", seasonal: "Sesong og kampanjar",
    maintenance: "Drift og vedlikehald", purchasing: "Innkjøp og leverandørar", digital: "Nettside og digital synlegheit",
    professional: "Fagleg utvikling", events: "Messer og arrangement", administration: "Administrasjon",
    deadlines: "Offentlege fristar", evaluation: "Evaluering og årsavslutning", custom: "Eigendefinert"
  };
  var STAT = { planned: "Planlagt", progress: "Pågår", completed: "Fullført", postponed: "Utsett" };
  var INDUSTRIES = {
    carpenter: "Tømrar / handverkar", hairdresser: "Frisør", photographer: "Fotograf",
    cleaning: "Reinhaldsverksemd", restaurant: "Restaurant / kafé", office: "Lite kontorfirma", other: "Anna verksemd"
  };

  /* =========================================================================
     HJELPEFUNKSJONAR
     ====================================================================== */
  function esc(v) { return C.esc(v); }
  function norm(v) {
    return String(v == null ? "" : v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function uid(p) { return p + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
  function month(v) { v = +v; return Number.isInteger(v) && v > 0 && v < 13 ? v : 1; }
  function day(v) { if (v === "" || v === null || v === undefined) return null; v = +v; return Number.isInteger(v) && v > 0 && v < 32 ? v : null; }
  function occurs(x, m) { return x.recurrence === "monthly" || x.month === m; }
  function scheduleLabel(x) {
    if (x.recurrence === "monthly") return x.day ? "Kvar månad · dag " + x.day : "Kvar månad";
    return x.day ? x.day + ". " + MONTHS[x.month - 1].toLowerCase() : MONTHS[x.month - 1];
  }
  function catColorVar(category) { return "var(--saa-cat-" + (CATS[category] ? category : "custom") + ")"; }

  /* =========================================================================
     TILSTAND
     ====================================================================== */
  function defaultBusiness() { return { industry: "carpenter", description: "", seasons: "", focus: "" }; }
  function defaultState() {
    return {
      screen: "setup", currentView: "year", selectedMonth: new Date().getMonth() + 1,
      business: defaultBusiness(), suggestions: [], activities: [],
      filters: { search: "", category: "all", month: "all" }, summary: "", disclaimer: "", mode: "new"
    };
  }

  function cleanActivity(x) {
    if (!x || typeof x !== "object" || !String(x.title || "").trim()) return null;
    return {
      id: String(x.id || uid("a")),
      title: String(x.title).trim().slice(0, 160),
      description: String(x.description || "").slice(0, 900),
      reason: String(x.reason || "").slice(0, 700),
      month: month(x.month),
      category: CATS[x.category] ? x.category : "custom",
      source: x.source === "custom" ? "custom" : "smart-suggestion",
      status: STAT[x.status] ? x.status : "planned",
      locked: !!x.locked,
      recurrence: x.recurrence === "monthly" ? "monthly" : "none",
      day: day(x.day),
      verificationRequired: !!x.verificationRequired,
      itemType: ["deadline", "course", "event"].indexOf(x.itemType) !== -1 ? x.itemType : "",
      exactDate: String(x.exactDate || "").slice(0, 180),
      sourceName: String(x.sourceName || "").slice(0, 180),
      sourceUrl: /^https:\/\//.test(String(x.sourceUrl || "")) ? String(x.sourceUrl) : "",
      sourceVerifiedAt: String(x.sourceVerifiedAt || "").slice(0, 80),
      applicability: String(x.applicability || "").slice(0, 500),
      createdAt: String(x.createdAt || new Date().toISOString())
    };
  }

  // Migrerer eldre/manglande felt trygt (spec seksjon 20) -- aldri slett ein
  // aktivitet berre fordi han manglar nyare felt, berre fyll inn standardverdiar.
  function validateState(raw) {
    var d = defaultState();
    if (!raw || typeof raw !== "object") return d;
    d.screen = ["setup", "workshop", "wheel"].indexOf(raw.screen) !== -1 ? raw.screen : "setup";
    d.currentView = ["year", "list", "balance"].indexOf(raw.currentView) !== -1 ? raw.currentView : "year";
    d.selectedMonth = month(raw.selectedMonth);
    if (raw.business) {
      d.business.industry = INDUSTRIES[raw.business.industry] ? raw.business.industry : "other";
      d.business.description = String(raw.business.description || "").slice(0, 1200);
      d.business.seasons = String(raw.business.seasons || "").slice(0, 700);
      d.business.focus = String(raw.business.focus || "").slice(0, 700);
    }
    d.activities = Array.isArray(raw.activities) ? raw.activities.map(cleanActivity).filter(Boolean).slice(0, 500) : [];
    d.suggestions = Array.isArray(raw.suggestions) ? raw.suggestions.map(function (x) {
      var a = cleanActivity(Object.assign({}, x, { status: "planned" }));
      return a ? Object.assign(a, { selected: x.selected !== false, duplicateOf: x.duplicateOf || null }) : null;
    }).filter(Boolean).slice(0, 200) : [];
    if (raw.filters) {
      d.filters.search = String(raw.filters.search || "").slice(0, 120);
      d.filters.category = raw.filters.category === "all" || CATS[raw.filters.category] ? raw.filters.category : "all";
      d.filters.month = raw.filters.month === "all" || (+raw.filters.month > 0 && +raw.filters.month < 13) ? String(raw.filters.month) : "all";
    }
    d.summary = String(raw.summary || "").slice(0, 800);
    d.disclaimer = String(raw.disclaimer || "").slice(0, 400);
    d.mode = raw.mode === "more" ? "more" : "new";
    if (d.screen === "workshop" && !d.suggestions.length) d.screen = d.activities.length ? "wheel" : "setup";
    if (d.screen === "wheel" && !d.activities.length) d.screen = "setup";
    return d;
  }

  var state = defaultState();
  var generating = false;
  var pendingImport = null;

  function load() { state = validateState(App.store.get(STORE_KEY, null)); }
  function save() {
    if (!App.store.set(STORE_KEY, state)) toast("Endringane kunne ikkje lagrast lokalt.", "error");
  }

  /* =========================================================================
     API-KALL
     ====================================================================== */
  function getAccessToken() {
    if (!App.supabase) return Promise.resolve(null);
    return App.supabase.auth.getSession().then(function (r) {
      return (r.data && r.data.session && r.data.session.access_token) || null;
    });
  }

  // Feil merkte med .saaSafe kan visast rått i eit varsel -- alt anna
  // (nettverksfeil, "Failed to fetch", JSON-parsefeil) skal ALDRI visast rått,
  // sidan nettlesaren sine eigne feiltekstar er engelske/tekniske og ville
  // brote copy-style-guide sitt "vanleg språk"-krav.
  function safeError(msg) {
    var e = new Error(msg);
    e.saaSafe = true;
    return e;
  }

  function requestSuggestions() {
    return getAccessToken().then(function (token) {
      if (!token) throw safeError("Du må vere innlogga på nytt.");
      return fetch("/api/ai/annual-wheel", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          industry: state.business.industry,
          businessDescription: state.business.description,
          importantSeasons: state.business.seasons,
          focusAreasText: state.business.focus,
          existingActivities: state.activities.map(function (a) {
            return { title: a.title, month: a.month, day: a.day, recurrence: a.recurrence, category: a.category, locked: a.locked };
          })
        })
      }).then(function (resp) {
        return resp.json().then(function (data) {
          if (!resp.ok) throw safeError((data && data.error) || "Forslaga kunne ikkje hentast.");
          return data;
        });
      });
    });
  }

  // Merk moglege duplikat mot eksisterande aktivitetar (tittel+kategori,
  // normalisert) -- serveren kjenner ikkje til klientens eige normaliserings-
  // format, så dette skjer her, same logikk som i den godkjende demoen.
  function markDuplicates(suggestions) {
    var existing = {};
    state.activities.forEach(function (a) { existing[norm(a.title) + "|" + a.category] = a; });
    return suggestions.map(function (x) {
      var match = existing[norm(x.title) + "|" + x.category];
      return match ? Object.assign({}, x, { selected: false, duplicateOf: match.id }) : x;
    });
  }

  /* =========================================================================
     FILTRERING
     ====================================================================== */
  function activitiesForMonth(m) { return state.activities.filter(function (x) { return occurs(x, m); }); }
  function occurrenceCount() {
    var sum = 0;
    for (var i = 1; i <= 12; i++) sum += activitiesForMonth(i).length;
    return sum;
  }
  function filteredSuggestions() {
    var q = norm(state.filters.search);
    return state.suggestions.filter(function (x) {
      if (state.filters.category !== "all" && x.category !== state.filters.category) return false;
      if (state.filters.month !== "all" && !occurs(x, +state.filters.month)) return false;
      if (q) {
        var hay = norm(x.title + " " + x.description + " " + x.reason + " " + (x.exactDate || "") + " " + (x.sourceName || "") + " " + CATS[x.category] + " " + MONTHS[x.month - 1]);
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /* =========================================================================
     TOASTS
     ====================================================================== */
  var toastsEl = null;
  function toast(text, type) {
    if (!toastsEl) return;
    var el = document.createElement("div");
    el.className = "saa-toast" + (type ? " saa-toast--" + type : "");
    el.innerHTML = "<span>" + esc(text) + "</span>";
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Lukk");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", function () { el.remove(); });
    el.appendChild(closeBtn);
    toastsEl.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  /* =========================================================================
     CSS
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "#saa-root{--saa-q1:#668db8;--saa-q1-soft:#d9e7f3;--saa-q2:#5d967b;--saa-q2-soft:#dcece4;--saa-q3:#b28a4d;--saa-q3-soft:#f0e5cf;--saa-q4:#8b688f;--saa-q4-soft:#eadfed;" +
      "--saa-cat-planning:#dbe6f3;--saa-cat-marketing:#e6dff0;--saa-cat-seasonal:#eee5d0;--saa-cat-maintenance:#dce9e1;--saa-cat-purchasing:#eadfd9;--saa-cat-digital:#d9e8ec;" +
      "--saa-cat-professional:#e6e7d8;--saa-cat-events:#eee0e5;--saa-cat-administration:#e4e7ed;--saa-cat-deadlines:#f0e3d8;--saa-cat-evaluation:#e7dfd8;--saa-cat-custom:#e3e1eb;position:relative}",
      "#saa-root,#saa-root *{box-sizing:border-box}",
      "#saa-root .saa-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem;margin-bottom:1.1rem}",
      "#saa-root .saa-step{width:100%;font:inherit;text-align:left;background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:.75rem .9rem;display:flex;gap:.6rem;align-items:center;color:var(--color-muted);cursor:pointer}",
      "#saa-root .saa-step:hover:not(:disabled){border-color:var(--color-primary)}",
      "#saa-root .saa-step:disabled{cursor:not-allowed;opacity:.5}",
      "#saa-root .saa-step i{font-style:normal;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--color-bg);font-size:.7rem;font-weight:800;flex:0 0 auto}",
      "#saa-root .saa-step.is-active{background:var(--color-bg);color:var(--color-text);border-color:var(--color-primary)}",
      "#saa-root .saa-step.is-active i{background:var(--color-primary);color:#fff}",
      "#saa-root .saa-step.is-done i{background:#dcebe5;color:#2e6654}",
      "#saa-root .saa-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:14px;padding:1.2rem}",
      "#saa-root .saa-grid2{display:grid;grid-template-columns:1fr 1fr;gap:.9rem}",
      "#saa-root .saa-field{display:flex;flex-direction:column;gap:.35rem;margin-bottom:.9rem}",
      "#saa-root .saa-span2{grid-column:1/-1}",
      "#saa-root .saa-field label{font-size:.85rem;font-weight:700}",
      "#saa-root .saa-hint{font-size:.78rem;color:var(--color-muted)}",
      "#saa-root .saa-field input,#saa-root .saa-field select,#saa-root .saa-field textarea{width:100%;border:1px solid var(--color-border);border-radius:9px;background:var(--color-bg);color:var(--color-text);padding:.55rem .6rem;font:inherit}",
      "#saa-root .saa-field textarea{min-height:96px;resize:vertical}",
      "#saa-root .saa-count{text-align:right;font-size:.72rem;color:var(--color-muted)}",
      "#saa-root .saa-safebox{margin:0 0 1rem;padding:.7rem .8rem;border:1px solid #cfe0d8;border-radius:10px;background:#f0f7f4;color:#365e51;font-size:.85rem}",
      "#saa-root .saa-formfoot{border-top:1px solid var(--color-border);margin-top:1rem;padding-top:1rem;display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap}",
      "#saa-root .saa-formnote{color:var(--color-muted);font-size:.82rem;max-width:640px}",
      "#saa-root .saa-title{display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;margin-bottom:1rem;flex-wrap:wrap}",
      "#saa-root .saa-title p{margin:.3rem 0 0;color:var(--color-muted)}",
      "#saa-root .saa-actions{display:flex;gap:.5rem;flex-wrap:wrap}",
      "#saa-root .saa-work{display:grid;grid-template-columns:270px minmax(0,1fr);gap:1rem}",
      "#saa-root .saa-filters{align-self:start;position:sticky;top:0}",
      "#saa-root .saa-filters h2{font-size:.95rem;margin:0 0 .8rem}",
      "#saa-root .saa-filterbuttons{display:grid;grid-template-columns:1fr 1fr;gap:.4rem}",
      "#saa-root .saa-selection{background:var(--color-primary);color:#fff;padding:.8rem;border-radius:10px;margin:.5rem 0}",
      "#saa-root .saa-selection strong{font-size:1.5rem;display:block}",
      "#saa-root .saa-selection span{font-size:.72rem;opacity:.85}",
      "#saa-root .saa-catlines{display:grid;gap:.4rem;max-height:220px;overflow:auto}",
      "#saa-root .saa-catline{display:flex;justify-content:space-between;gap:.5rem;font-size:.75rem;color:var(--color-muted)}",
      "#saa-root .saa-dot{width:8px;height:8px;border-radius:3px;display:inline-block;margin-right:.4rem}",
      "#saa-root .saa-toolbar{background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:.7rem .85rem;margin-bottom:.7rem;display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;font-size:.8rem;color:var(--color-muted)}",
      "#saa-root .saa-sgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem}",
      "#saa-root .saa-sug{background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:.9rem;position:relative;overflow:hidden}",
      "#saa-root .saa-sug:before,#saa-root .saa-activity:before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--saa-cat)}",
      "#saa-root .saa-sug.is-off{opacity:.65}",
      "#saa-root .saa-sug.is-dup{background:#fffaf3}",
      "#saa-root .saa-sugtop{display:flex;gap:.6rem;align-items:flex-start;cursor:pointer;min-height:44px}",
      "#saa-root .saa-check{width:19px;height:19px;flex:0 0 auto;margin-top:2px}",
      "#saa-root .saa-sug h3,#saa-root .saa-activity h3{margin:0;font-size:.92rem;line-height:1.35}",
      "#saa-root .saa-badges{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.4rem}",
      "#saa-root .saa-badge,#saa-root .saa-origin,#saa-root .saa-lock,#saa-root .saa-status{display:inline-flex;padding:.2rem .45rem;border-radius:99px;font-size:.66rem;font-weight:700}",
      "#saa-root .saa-badge{background:var(--saa-cat)}",
      "#saa-root .saa-badge--verify{background:#f5ead6;color:#76551e}",
      "#saa-root .saa-badge--dup{background:#f1dfc6;color:#73501c}",
      "#saa-root .saa-origin{background:var(--color-bg);color:var(--color-muted)}",
      "#saa-root .saa-lock{background:#eeeaf3;color:#5f5275}",
      "#saa-root .saa-sug p,#saa-root .saa-activity p{font-size:.78rem;color:var(--color-muted)}",
      "#saa-root .saa-reason{background:var(--color-bg);border-radius:8px;padding:.55rem;font-size:.75rem;color:var(--color-muted);margin-top:.5rem}",
      "#saa-root .saa-sourcebox{margin-top:.6rem;padding:.55rem .6rem;border:1px solid var(--color-border);border-radius:9px;background:var(--color-bg);display:grid;gap:.4rem;font-size:.72rem;color:var(--color-muted)}",
      "#saa-root .saa-sourcetop,#saa-root .saa-sourcemeta{display:flex;align-items:center;justify-content:space-between;gap:.4rem;flex-wrap:wrap}",
      "#saa-root .saa-sourcedate{font-weight:800;color:var(--color-text)}",
      "#saa-root .saa-sourcelink{display:inline-flex;align-items:center;gap:.25rem;padding:.2rem .4rem;border:1px solid var(--color-border);border-radius:7px;background:var(--color-surface);color:var(--color-primary);font-weight:700;text-decoration:none}",
      "#saa-root .saa-repeathelp{padding:.55rem .6rem;border:1px solid var(--color-border);border-radius:8px;background:var(--color-bg);color:var(--color-muted);font-size:.75rem}",
      "#saa-root .saa-sugfoot{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-top:.7rem;flex-wrap:wrap}",
      "#saa-root .saa-sugfoot select{width:auto;font-size:.75rem;padding:.35rem}",
      "#saa-root .saa-cardbuttons{display:flex;gap:.35rem}",
      "#saa-root .saa-empty{background:var(--color-surface);border:1px dashed var(--color-border);border-radius:12px;padding:1.8rem 1.2rem;text-align:center;color:var(--color-muted)}",
      "#saa-root .saa-empty strong{display:block;color:var(--color-text);font-size:1rem;margin-bottom:.3rem}",
      "#saa-root .saa-approve{position:sticky;bottom:.6rem;z-index:5;background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:.7rem .85rem;margin-top:.8rem;display:flex;justify-content:space-between;align-items:center;gap:.7rem;flex-wrap:wrap}",
      "#saa-root .saa-approve p{margin:0;color:var(--color-muted);font-size:.78rem}",
      "#saa-root .saa-tabs{display:inline-flex;background:var(--color-bg);border:1px solid var(--color-border);border-radius:11px;padding:3px;gap:2px;margin-bottom:1rem;flex-wrap:wrap}",
      "#saa-root .saa-tab{border:0;background:transparent;border-radius:8px;padding:.5rem .75rem;color:var(--color-muted);font-weight:700;font-size:.82rem}",
      "#saa-root .saa-tab.is-on{background:var(--color-surface);color:var(--color-text)}",
      "#saa-root .saa-wlayout{display:grid;grid-template-columns:minmax(400px,1.15fr) minmax(280px,.85fr);gap:1rem;align-items:start}",
      "#saa-root .saa-wheelintro{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}",
      "#saa-root .saa-qlegend span{display:inline-flex;align-items:center;gap:.3rem;padding:.25rem .45rem;border-radius:99px;font-size:.66rem;font-weight:800}",
      "#saa-root .saa-qlegend i{width:7px;height:7px;border-radius:50%}",
      "#saa-root .saa-qlegend .saa-q1{background:var(--saa-q1-soft);color:#365b82}",
      "#saa-root .saa-qlegend .saa-q2{background:var(--saa-q2-soft);color:#376650}",
      "#saa-root .saa-qlegend .saa-q3{background:var(--saa-q3-soft);color:#745522}",
      "#saa-root .saa-qlegend .saa-q4{background:var(--saa-q4-soft);color:#65486b}",
      "#saa-root .saa-qlegend .saa-q1 i{background:var(--saa-q1)}#saa-root .saa-qlegend .saa-q2 i{background:var(--saa-q2)}#saa-root .saa-qlegend .saa-q3 i{background:var(--saa-q3)}#saa-root .saa-qlegend .saa-q4 i{background:var(--saa-q4)}",
      "#saa-root .saa-wheel{width:min(560px,100%);aspect-ratio:1;margin:1rem auto;position:relative;border-radius:50%;border:1px solid var(--color-border);background:radial-gradient(circle at center,var(--color-surface) 0 27.5%,transparent 31.5%),repeating-conic-gradient(from -15deg,transparent 0 89.2deg,rgba(20,30,50,.14) 89.2deg 90deg),conic-gradient(from -15deg,color-mix(in srgb,var(--saa-q1) 16%,var(--color-surface)) 0 90deg,color-mix(in srgb,var(--saa-q2) 16%,var(--color-surface)) 90deg 180deg,color-mix(in srgb,var(--saa-q3) 18%,var(--color-surface)) 180deg 270deg,color-mix(in srgb,var(--saa-q4) 16%,var(--color-surface)) 270deg 360deg)}",
      "#saa-root .saa-wcenter{position:absolute;inset:35%;display:grid;place-items:center;text-align:center;z-index:5;border:1px solid var(--color-border);border-radius:50%;background:var(--color-surface)}",
      "#saa-root .saa-wcenter strong{font-size:1.7rem}",
      "#saa-root .saa-wcenter small{color:var(--color-muted)}",
      "#saa-root .saa-currentq{display:inline-flex;margin-top:.35rem;padding:.2rem .45rem;border-radius:99px;background:var(--saa-current-q-soft);color:var(--saa-current-q);font-size:.62rem;font-weight:800}",
      "#saa-root .saa-qlabel{--saa-quarter-color:var(--saa-q1);position:absolute;left:50%;top:50%;z-index:3;transform:translate(-50%,-50%) rotate(var(--saa-angle)) translateY(-116px) rotate(calc(-1 * var(--saa-angle)));display:flex;align-items:center;justify-content:center;min-width:38px;padding:.2rem .4rem;border-radius:99px;background:var(--color-surface);color:var(--saa-quarter-color);border:1px solid var(--color-border);font-size:.66rem;font-weight:800;pointer-events:none}",
      "#saa-root .saa-qlabel.saa-q1{--saa-quarter-color:var(--saa-q1)}#saa-root .saa-qlabel.saa-q2{--saa-quarter-color:var(--saa-q2)}#saa-root .saa-qlabel.saa-q3{--saa-quarter-color:var(--saa-q3)}#saa-root .saa-qlabel.saa-q4{--saa-quarter-color:var(--saa-q4)}",
      "#saa-root .saa-mnode{--saa-node-accent:var(--color-primary);position:absolute;left:50%;top:50%;z-index:4;width:78px;min-height:56px;transform:translate(-50%,-50%) rotate(calc(var(--saa-i)*30deg)) translateY(-184px) rotate(calc(var(--saa-i)*-30deg));border:1px solid color-mix(in srgb,var(--saa-node-accent) 35%,var(--color-border));border-radius:11px;background:var(--color-surface);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:.5rem .35rem;overflow:hidden;cursor:pointer}",
      "#saa-root .saa-mnode:before{content:'';position:absolute;left:0;right:0;top:0;height:3px;background:var(--saa-node-accent)}",
      "#saa-root .saa-mnode.saa-q1{--saa-node-accent:var(--saa-q1)}#saa-root .saa-mnode.saa-q2{--saa-node-accent:var(--saa-q2)}#saa-root .saa-mnode.saa-q3{--saa-node-accent:var(--saa-q3)}#saa-root .saa-mnode.saa-q4{--saa-node-accent:var(--saa-q4)}",
      "#saa-root .saa-mnode.is-on{background:color-mix(in srgb,var(--saa-node-accent) 10%,var(--color-surface));outline:2px solid color-mix(in srgb,var(--saa-node-accent) 20%,transparent)}",
      "#saa-root .saa-mnode span{font-size:.68rem;color:var(--color-muted);font-weight:700}",
      "#saa-root .saa-mnode b{font-size:.78rem}",
      "#saa-root .saa-bubble{background:var(--saa-node-accent);color:#fff;min-width:20px;height:17px;border-radius:99px;display:grid;place-items:center;font-size:.62rem;font-style:normal;margin-top:.2rem}",
      "#saa-root .saa-mobilemonths{display:none;grid-template-columns:repeat(4,1fr);gap:.4rem;margin:.9rem 0}",
      "#saa-root .saa-mchip{--saa-chip-accent:var(--color-primary);border:1px solid color-mix(in srgb,var(--saa-chip-accent) 30%,var(--color-border));background:var(--color-surface);border-radius:9px;padding:.5rem .3rem;font-size:.68rem;min-height:44px;display:flex;align-items:center;justify-content:center}",
      "#saa-root .saa-mchip.saa-q1{--saa-chip-accent:var(--saa-q1)}#saa-root .saa-mchip.saa-q2{--saa-chip-accent:var(--saa-q2)}#saa-root .saa-mchip.saa-q3{--saa-chip-accent:var(--saa-q3)}#saa-root .saa-mchip.saa-q4{--saa-chip-accent:var(--saa-q4)}",
      "#saa-root .saa-mchip.is-on{background:color-mix(in srgb,var(--saa-chip-accent) 16%,var(--color-surface));border-color:var(--saa-chip-accent)}",
      "#saa-root .saa-detailhead{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--color-border);padding-bottom:.7rem}",
      "#saa-root .saa-detailhead small{color:var(--color-muted)}",
      "#saa-root .saa-astack{display:grid;gap:.55rem;margin-top:.7rem;max-height:560px;overflow:auto}",
      "#saa-root .saa-activity{border:1px solid var(--color-border);border-radius:11px;padding:.7rem;position:relative;background:var(--color-surface);overflow:hidden}",
      "#saa-root .saa-activity:before{top:8px;bottom:8px;width:3px}",
      "#saa-root .saa-activity h3{padding-right:2.75rem}",
      "#saa-root .saa-menu{position:absolute;right:.1rem;top:.1rem;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;background:transparent;border:0;color:var(--color-muted);cursor:pointer;font-weight:800}",
      "#saa-root .saa-status.saa-planned{background:var(--color-bg);color:var(--color-text)}",
      "#saa-root .saa-status.saa-progress{background:#eee6d2;color:#76591f}",
      "#saa-root .saa-status.saa-completed{background:#dcebe4;color:#2e6654}",
      "#saa-root .saa-status.saa-postponed{background:#eee1e2;color:#814a4e}",
      "#saa-root .saa-monthgroup{margin-bottom:1.2rem}",
      "#saa-root .saa-monthhead{display:flex;justify-content:space-between;border-bottom:1px solid var(--color-border);padding-bottom:.4rem;margin-bottom:.5rem}",
      "#saa-root .saa-monthhead h2{margin:0;font-size:1.05rem}",
      "#saa-root .saa-lgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem}",
      "#saa-root .saa-inline{display:grid;grid-template-columns:1fr 1fr;gap:.4rem;margin-top:.6rem}",
      "#saa-root .saa-inline select{padding:.35rem;font-size:.7rem}",
      "#saa-root .saa-mstats{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem;margin-bottom:1rem}",
      "#saa-root .saa-mstat,#saa-root .saa-chart{border:1px solid var(--color-border);border-radius:11px;background:var(--color-surface);padding:.85rem}",
      "#saa-root .saa-mstat strong{display:block;font-size:1.4rem}",
      "#saa-root .saa-mstat span{font-size:.68rem;color:var(--color-muted)}",
      "#saa-root .saa-bgrid{display:grid;grid-template-columns:1.2fr .8fr;gap:1rem}",
      "#saa-root .saa-chart h2{font-size:.9rem;margin:0}",
      "#saa-root .saa-chart>p{font-size:.72rem;color:var(--color-muted);margin:.2rem 0 .8rem}",
      "#saa-root .saa-bars{display:grid;gap:.45rem}",
      "#saa-root .saa-barrow{display:grid;grid-template-columns:80px minmax(0,1fr) 26px;gap:.5rem;align-items:center;font-size:.68rem}",
      "#saa-root .saa-track{height:9px;background:var(--color-bg);border-radius:99px;overflow:hidden}",
      "#saa-root .saa-fill{height:100%;background:var(--color-primary);border-radius:99px}",
      "#saa-root .saa-fill.is-heavy{background:#967958}",
      "#saa-root .saa-insight{margin-top:.9rem;background:var(--color-bg);border:1px solid var(--color-border);border-radius:10px;padding:.75rem;color:var(--color-text);font-size:.8rem}",
      "#saa-root .saa-insight strong{display:block;margin-bottom:.2rem}",
      "#saa-root .saa-backdrop{position:fixed;inset:0;background:rgba(9,18,31,.55);z-index:2000;display:grid;place-items:center;padding:1rem}",
      "#saa-root .saa-modal{width:min(600px,100%);max-height:calc(100vh - 2.4rem);overflow:hidden;display:flex;flex-direction:column;background:var(--color-surface);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.3)}",
      "#saa-root .saa-modal>form{display:flex;flex-direction:column;min-height:0;flex:1 1 auto}",
      "#saa-root .saa-modalhead{flex:0 0 auto;padding:1.1rem 1.2rem .8rem;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;gap:.7rem}",
      "#saa-root .saa-modalhead h2{margin:0;font-size:1.05rem}",
      "#saa-root .saa-modalhead p{margin:.2rem 0 0;color:var(--color-muted);font-size:.75rem}",
      "#saa-root .saa-modalbody{flex:1 1 auto;overflow-y:auto;min-height:0;padding:1.1rem 1.2rem}",
      "#saa-root .saa-modalfoot{flex:0 0 auto;padding:.8rem 1.2rem 1.1rem;display:flex;justify-content:flex-end;gap:.5rem;flex-wrap:wrap}",
      "#saa-root .saa-checkline{display:flex;gap:.5rem;align-items:flex-start;font-size:.82rem}",
      "#saa-root .saa-toasts{position:fixed;right:1rem;bottom:1rem;z-index:2100;display:grid;gap:.5rem;width:min(360px,calc(100% - 2rem))}",
      "#saa-root .saa-toast{background:#172840;color:#fff;border-radius:10px;padding:.65rem .8rem;box-shadow:0 12px 30px rgba(0,0,0,.2);display:flex;justify-content:space-between;gap:.6rem;font-size:.82rem}",
      "#saa-root .saa-toast--warning{background:#725b2d}",
      "#saa-root .saa-toast--error{background:#773f43}",
      "#saa-root .saa-toast button{border:0;background:transparent;color:#fff;font-size:1.1rem;cursor:pointer}",
      "#saa-root .saa-loading{min-height:300px;display:grid;place-items:center;padding:1.5rem}",
      "#saa-root .saa-loadcard{width:min(560px,100%);text-align:center}",
      "#saa-root .saa-loadmark{width:64px;height:64px;margin:0 auto 1.1rem;border-radius:20px;background:var(--color-bg);position:relative}",
      "#saa-root .saa-loadmark:before,#saa-root .saa-loadmark:after{content:'';position:absolute;inset:14px;border:2px solid var(--color-primary);border-radius:50%;animation:saa-pulse 1.35s infinite}",
      "#saa-root .saa-loadmark:after{inset:24px;animation-delay:.35s;opacity:.6}",
      "@keyframes saa-pulse{50%{transform:scale(1.08);opacity:1}0%,100%{transform:scale(.9);opacity:.35}}",
      "#saa-root .saa-loadstatus{color:var(--color-muted);min-height:1.4rem;margin:.3rem 0 0}",
      "#saa-root .saa-progress{height:7px;background:var(--color-bg);border-radius:99px;overflow:hidden;margin-top:1.2rem}",
      "#saa-root .saa-progress span{display:block;height:100%;background:var(--color-primary);transition:width .3s}",
      "@media(max-width:980px){#saa-root .saa-work,#saa-root .saa-wlayout,#saa-root .saa-bgrid{grid-template-columns:1fr}#saa-root .saa-filters{position:static}}",
      "@media(max-width:720px){#saa-root .saa-grid2,#saa-root .saa-sgrid,#saa-root .saa-lgrid,#saa-root .saa-mstats{grid-template-columns:1fr}#saa-root .saa-span2{grid-column:auto}#saa-root .saa-wheel{display:none}#saa-root .saa-mobilemonths{display:grid}#saa-root .saa-step span{display:none}#saa-root .saa-title{align-items:flex-start;flex-direction:column}}",
      "@media(prefers-reduced-motion:reduce){#saa-root *,#saa-root *:before,#saa-root *:after{animation-duration:.01ms!important;transition-duration:.01ms!important}}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     KATEGORI-/MÅNADS-/BRANSJE-VELJARAR
     ====================================================================== */
  function catOpts(sel, all) {
    var out = all ? '<option value="all"' + (sel === "all" ? " selected" : "") + '>Alle kategoriar</option>' : "";
    Object.keys(CATS).forEach(function (k) { out += '<option value="' + k + '"' + (k === sel ? " selected" : "") + '>' + esc(CATS[k]) + '</option>'; });
    return out;
  }
  function monOpts(sel, all) {
    var out = all ? '<option value="all"' + (sel === "all" ? " selected" : "") + '>Alle månader</option>' : "";
    MONTHS.forEach(function (m, i) { out += '<option value="' + (i + 1) + '"' + (String(i + 1) === String(sel) ? " selected" : "") + '>' + m + '</option>'; });
    return out;
  }
  function statOpts(sel) {
    var out = "";
    Object.keys(STAT).forEach(function (k) { out += '<option value="' + k + '"' + (k === sel ? " selected" : "") + '>' + STAT[k] + '</option>'; });
    return out;
  }
  function indOpts(sel) {
    var out = "";
    Object.keys(INDUSTRIES).forEach(function (k) { out += '<option value="' + k + '"' + (k === sel ? " selected" : "") + '>' + esc(INDUSTRIES[k]) + '</option>'; });
    return out;
  }

  /* =========================================================================
     STEG-NAVIGASJON
     ====================================================================== */
  function stepNav(n) {
    var available = { 1: true, 2: state.suggestions.length > 0, 3: state.activities.length > 0 };
    var labels = ["Vel utgangspunkt", "Tilpass forslag", "Bruk årshjulet"];
    var html = '<nav class="saa-steps" aria-label="Steg i Smart årshjul">';
    labels.forEach(function (label, i) {
      var num = i + 1, enabled = available[num], done = num < n || (num === 3 && state.activities.length > 0 && n < 3);
      html += '<button type="button" class="saa-step ' + (num === n ? "is-active" : done ? "is-done" : "") + '" data-a="stepNav" data-step="' + num + '"' + (enabled ? "" : " disabled") +
        (num === n ? ' aria-current="step"' : "") + ' title="' + esc(enabled ? "Gå til: " + label : label + " er ikkje klart enno") + '"><i>' + (done ? "✓" : num) + '</i><span>' + esc(label) + '</span></button>';
    });
    return html + "</nav>";
  }

  /* =========================================================================
     STEG 1 — OPPSETT
     ====================================================================== */
  function renderSetup() {
    var b = state.business;
    return '<div>' + stepNav(1) +
      '<div class="saa-title"><div><h1>Skildre verksemda</h1><p>Vel bransje og skriv nokre setningar. Du får konkrete aktivitetar du kan velje, redigere og fordele gjennom året.</p></div></div>' +
      '<form id="saa-setup-form" class="saa-card">' +
      '<div class="saa-grid2">' +
      '<div class="saa-field"><label for="saa-industry">Bransje</label><select id="saa-industry">' + indOpts(b.industry) + '</select></div>' +
      '<div class="saa-field saa-span2"><label for="saa-description">Kort skildring av verksemda <span class="saa-hint">obligatorisk</span></label>' +
      '<textarea id="saa-description" maxlength="1200" required>' + esc(b.description) + '</textarea>' +
      '<div class="saa-count"><span id="saa-dcount">' + b.description.length + '</span> / 1200</div>' +
      '<p class="saa-hint">Skriv gjerne kva de driv med, kor mange tilsette de er, og kva de treng meir struktur på.</p></div>' +
      '<div class="saa-field"><label for="saa-seasons">Viktige sesongar <span class="saa-hint">valfritt</span></label><textarea id="saa-seasons" maxlength="700">' + esc(b.seasons) + '</textarea></div>' +
      '<div class="saa-field"><label for="saa-focus">Kva ønskjer du meir struktur på? <span class="saa-hint">valfritt</span></label><textarea id="saa-focus" maxlength="700">' + esc(b.focus) + '</textarea></div>' +
      '</div>' +
      (state.activities.length
        ? '<div class="saa-safebox"><b>Trygg generering:</b> Dei ' + state.activities.length + ' eksisterande aktivitetane dine blir ikkje endra eller sletta. Nye forslag hamnar i forslagsverkstaden, og ingenting blir lagt til før du godkjenner det.</div>'
        : "") +
      '<div class="saa-formfoot"><div class="saa-formnote">' +
      (state.activities.length ? "Berre eit uferdig forslagsutval blir erstatta dersom du finn fleire forslag. Bruk stega øvst for å gå tilbake til årshjulet." : "Du får forslag til aktivitetar, i tillegg til konkrete fristar, kurs og arrangement med kjelde der det finst. Ingenting blir lagt i årshjulet før du godkjenner utvalet.") +
      '</div><div class="saa-actions"><button class="btn btn--primary" type="submit">' + (state.activities.length ? "Finn fleire forslag" : "Finn smarte forslag") + '</button></div></div>' +
      '</form></div>';
  }

  /* =========================================================================
     STEG 2 — FORSLAGSVERKSTAD
     ====================================================================== */
  function sourceBox(x) {
    if (!x.itemType) return "";
    var typeLabel = x.itemType === "deadline" ? "Offisiell frist" : x.itemType === "course" ? "Kurs" : "Messe / arrangement";
    return '<div class="saa-sourcebox"><div class="saa-sourcetop"><span class="saa-badge">' + typeLabel + '</span>' +
      (x.exactDate ? '<span class="saa-sourcedate">' + esc(x.exactDate) + '</span>' : "") + '</div>' +
      (x.applicability ? '<div>' + esc(x.applicability) + '</div>' : "") +
      '<div class="saa-sourcemeta">' +
      (x.sourceName ? '<span>Kjelde: <b>' + esc(x.sourceName) + '</b>' + (x.sourceVerifiedAt ? ' · kontrollert ' + esc(x.sourceVerifiedAt) : "") + '</span>' : "") +
      (x.sourceUrl ? '<a class="saa-sourcelink" href="' + esc(x.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Opne kjelda ↗</a>' : "") +
      '</div></div>';
  }

  function sugCard(x) {
    return '<article class="saa-sug ' + (x.selected ? "" : "is-off") + ' ' + (x.duplicateOf ? "is-dup" : "") + '" style="--saa-cat:' + catColorVar(x.category) + '">' +
      '<label class="saa-sugtop"><input class="saa-check" type="checkbox" data-a="toggleSug" data-id="' + x.id + '" aria-label="Vel ' + esc(x.title) + '"' + (x.selected ? " checked" : "") + '>' +
      '<div><h3>' + esc(x.title) + '</h3><div class="saa-badges"><span class="saa-badge">' + esc(CATS[x.category]) + '</span>' +
      (x.recurrence === "monthly" ? '<span class="saa-badge">Kvar månad</span>' : "") +
      (x.day ? '<span class="saa-badge">Dag ' + x.day + '</span>' : "") +
      (x.verificationRequired ? '<span class="saa-badge saa-badge--verify">Må kontrollerast</span>' : "") +
      (x.duplicateOf ? '<span class="saa-badge saa-badge--dup">Mogleg duplikat</span>' : "") +
      '</div></div></label>' +
      '<p>' + esc(x.description) + '</p>' +
      '<div class="saa-reason"><b>Kvifor foreslått?</b> ' + esc(x.reason) + '</div>' +
      sourceBox(x) +
      '<div class="saa-sugfoot">' +
      (x.recurrence === "monthly" ? '<span class="saa-repeathelp">' + esc(scheduleLabel(x)) + '</span>' : '<select data-a="sugMonth" data-id="' + x.id + '" aria-label="Månad">' + monOpts(x.month) + '</select>') +
      '<div class="saa-cardbuttons"><button type="button" class="btn btn--ghost btn--sm" data-a="editSug" data-id="' + x.id + '" aria-label="Rediger"><i class="ti ti-pencil"></i></button>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-a="delSug" data-id="' + x.id + '" aria-label="Fjern"><i class="ti ti-x"></i></button></div>' +
      '</div></article>';
  }

  function renderWorkshop() {
    var vis = filteredSuggestions(), chosen = state.suggestions.filter(function (x) { return x.selected; }).length;
    var lines = "";
    Object.keys(CATS).forEach(function (k) {
      var all = state.suggestions.filter(function (x) { return x.category === k; });
      var sel = all.filter(function (x) { return x.selected; }).length;
      if (all.length) lines += '<div class="saa-catline"><span><i class="saa-dot" style="background:' + catColorVar(k) + '"></i>' + esc(CATS[k]) + '</span><b>' + sel + '/' + all.length + '</b></div>';
    });
    return '<div>' + stepNav(2) +
      '<div class="saa-title"><div><h1>Tilpass før du legg noko i planen</h1><p>' + esc(state.summary || "Vel det som passar, og endre månad eller tekst før godkjenning.") + '</p></div>' +
      '<div class="saa-actions"><button type="button" class="btn btn--secondary" data-a="newSug">Legg til eige forslag</button></div></div>' +
      (state.disclaimer ? '<p class="saa-hint" style="margin:-.4rem 0 1rem">' + esc(state.disclaimer) + '</p>' : "") +
      '<div class="saa-work"><aside class="saa-card saa-filters"><h2>Filtrer og vel</h2>' +
      '<div class="saa-field"><label for="saa-search">Søk i forslag</label><input id="saa-search" type="search" value="' + esc(state.filters.search) + '" placeholder="Tittel, tekst eller kategori"></div>' +
      '<div class="saa-field"><label for="saa-catfilter">Kategori</label><select id="saa-catfilter">' + catOpts(state.filters.category, true) + '</select></div>' +
      '<div class="saa-field"><label for="saa-monthfilter">Månad</label><select id="saa-monthfilter">' + monOpts(state.filters.month, true) + '</select></div>' +
      '<div class="saa-filterbuttons"><button type="button" class="btn btn--secondary btn--sm" data-a="selectVis">Vel alle synlege</button><button type="button" class="btn btn--secondary btn--sm" data-a="unselectVis">Fjern alle synlege</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-a="selectCat">Vel alle i kategori</button><button type="button" class="btn btn--ghost btn--sm" data-a="unselectCat">Fjern kategori</button></div>' +
      '<div class="saa-selection"><strong>' + chosen + '</strong><span>av ' + state.suggestions.length + ' forslag er valde</span></div>' +
      '<div class="saa-catlines">' + lines + '</div></aside>' +
      '<section><div class="saa-toolbar"><span><b>' + vis.length + '</b> forslag blir viste' +
      (state.suggestions.some(function (x) { return x.itemType; }) ? " · kjeldebaserte forslag er merkte" : "") +
      (state.suggestions.some(function (x) { return x.duplicateOf; }) ? " · duplikat er merkte" : "") + '</span>' +
      '<button type="button" class="btn btn--secondary btn--sm" data-a="clearFilter">Nullstill filter</button></div>' +
      (vis.length ? '<div class="saa-sgrid">' + vis.map(sugCard).join("") + '</div>' : '<div class="saa-empty"><strong>Ingen forslag passar filteret.</strong>Prøv ein annan månad, kategori eller søketekst.</div>') +
      '<div class="saa-approve"><p><strong>' + chosen + ' av ' + state.suggestions.length + ' forslag er valde.</strong><br>Eksisterande aktivitetar blir bevarte. Bruk stega øvst dersom du vil gå vidare utan å godkjenne.</p>' +
      '<button type="button" class="btn btn--primary" data-a="approve"' + (chosen ? "" : " disabled") + '>Legg valde aktivitetar i årshjulet</button></div></section></div></div>';
  }

  /* =========================================================================
     STEG 3 — ÅRSHJULET
     ====================================================================== */
  function actCard(x, list) {
    return '<article class="saa-activity" style="--saa-cat:' + catColorVar(x.category) + '">' +
      '<button type="button" class="saa-menu" data-a="editAct" data-id="' + x.id + '" aria-label="Rediger"><i class="ti ti-dots"></i></button>' +
      '<h3>' + esc(x.title) + '</h3><div class="saa-badges"><span class="saa-badge">' + esc(CATS[x.category]) + '</span>' +
      (x.recurrence === "monthly" ? '<span class="saa-badge">Kvar månad</span>' : "") +
      (x.day ? '<span class="saa-badge">' + esc(scheduleLabel(x)) + '</span>' : "") +
      '<span class="saa-status saa-' + x.status + '">' + STAT[x.status] + '</span>' +
      '<span class="saa-origin">' + (x.source === "custom" ? "Eigen aktivitet" : "Smart forslag") + '</span>' +
      (x.locked ? '<span class="saa-lock">Låst</span>' : "") +
      (x.verificationRequired ? '<span class="saa-badge saa-badge--verify">Må kontrollerast</span>' : "") +
      '</div>' + (x.description ? '<p>' + esc(x.description) + '</p>' : "") + sourceBox(x) +
      (list ? '<div class="saa-inline">' +
        (x.recurrence === "monthly" ? '<span class="saa-repeathelp">' + esc(scheduleLabel(x)) + '</span>' : '<select data-a="actMonth" data-id="' + x.id + '">' + monOpts(x.month) + '</select>') +
        '<select data-a="actStatus" data-id="' + x.id + '">' + statOpts(x.status) + '</select></div>' : "") +
      '</article>';
  }

  function yearView() {
    var counts = [];
    for (var i = 1; i <= 12; i++) counts.push(activitiesForMonth(i).length);
    var items = activitiesForMonth(state.selectedMonth), currentQ = Math.ceil(state.selectedMonth / 3);
    var qVars = { 1: ["var(--saa-q1)", "var(--saa-q1-soft)"], 2: ["var(--saa-q2)", "var(--saa-q2-soft)"], 3: ["var(--saa-q3)", "var(--saa-q3-soft)"], 4: ["var(--saa-q4)", "var(--saa-q4-soft)"] };
    var nodes = "", chips = "";
    MONTHS.forEach(function (m, i) {
      var q = Math.floor(i / 3) + 1, on = state.selectedMonth === i + 1;
      nodes += '<button type="button" class="saa-mnode saa-q' + q + (on ? " is-on" : "") + '" style="--saa-i:' + i + '" data-a="month" data-month="' + (i + 1) + '"><span>' + SHORT[i] + '</span><b>' + m + '</b><i class="saa-bubble">' + counts[i] + '</i></button>';
      chips += '<button type="button" class="saa-mchip saa-q' + q + (on ? " is-on" : "") + '" data-a="month" data-month="' + (i + 1) + '">' + SHORT[i] + ' · ' + counts[i] + '</button>';
    });
    return '<div class="saa-wlayout"><section class="saa-card">' +
      '<div class="saa-wheelintro"><div><h2>Året i eitt blikk</h2><p class="saa-hint">Kvartala har eigne fargar. Talmarkørane viser aktivitetar per månad.</p></div>' +
      '<div class="saa-qlegend" aria-label="Kvartalsfargar"><span class="saa-q1"><i></i>Q1 · jan–mar</span><span class="saa-q2"><i></i>Q2 · apr–jun</span><span class="saa-q3"><i></i>Q3 · jul–sep</span><span class="saa-q4"><i></i>Q4 · okt–des</span></div></div>' +
      '<div class="saa-wheel" style="--saa-current-q:' + qVars[currentQ][0] + ';--saa-current-q-soft:' + qVars[currentQ][1] + '">' +
      '<div class="saa-wcenter"><div><strong>' + occurrenceCount() + '</strong><br><small>månadsplasseringar</small><br><span class="saa-currentq">Q' + currentQ + ' · ' + MONTHS[state.selectedMonth - 1] + '</span></div></div>' +
      '<div class="saa-qlabel saa-q1" style="--saa-angle:30deg"><b>Q1</b></div><div class="saa-qlabel saa-q2" style="--saa-angle:120deg"><b>Q2</b></div>' +
      '<div class="saa-qlabel saa-q3" style="--saa-angle:210deg"><b>Q3</b></div><div class="saa-qlabel saa-q4" style="--saa-angle:300deg"><b>Q4</b></div>' +
      nodes + '</div><div class="saa-mobilemonths">' + chips + '</div></section>' +
      '<aside class="saa-card"><div class="saa-detailhead"><div><h2>' + MONTHS[state.selectedMonth - 1] + '</h2><small>' + items.length + ' aktivitetar</small></div>' +
      '<button type="button" class="btn btn--secondary btn--sm" data-a="newActMonth">Ny aktivitet</button></div>' +
      '<div class="saa-astack">' + (items.length ? items.map(function (x) { return actCard(x, false); }).join("") : '<div class="saa-empty"><strong>Ingen aktivitetar denne månaden.</strong>Legg til eller flytt ein aktivitet.</div>') + '</div></aside></div>';
  }

  function listView() {
    var g = "";
    MONTHS.forEach(function (m, i) {
      var a = activitiesForMonth(i + 1);
      if (!a.length) return;
      g += '<section class="saa-monthgroup"><div class="saa-monthhead"><h2>' + m + '</h2><span>' + a.length + ' aktivitetar</span></div><div class="saa-lgrid">' + a.map(function (x) { return actCard(x, true); }).join("") + '</div></section>';
    });
    return '<section class="saa-card">' + (g || '<div class="saa-empty"><strong>Årshjulet er tomt.</strong></div>') + '</section>';
  }

  function balanceView() {
    var mc = [];
    for (var i = 1; i <= 12; i++) mc.push(activitiesForMonth(i).length);
    var cats = Object.keys(CATS).map(function (id) { return { id: id, n: state.activities.filter(function (x) { return x.category === id; }).length }; }).filter(function (x) { return x.n; });
    var mx = Math.max(1, Math.max.apply(null, mc)), cx = Math.max(1, Math.max.apply(null, cats.map(function (x) { return x.n; }).concat([0])));
    var avg = occurrenceCount() / 12;
    var heavy = mc.map(function (n, idx) { return { n: n, i: idx }; }).filter(function (x) { return x.n >= Math.max(4, Math.ceil(avg * 1.6)); });
    var empty = mc.map(function (n, idx) { return { n: n, i: idx }; }).filter(function (x) { return !x.n; });
    var msg = heavy.length
      ? heavy.map(function (x) { return MONTHS[x.i]; }).join(" og ") + " har mange aktivitetar. Vurder om noko kan flyttast."
      : empty.length
        ? empty.slice(0, 3).map(function (x) { return MONTHS[x.i]; }).join(", ") + " har få eller ingen aktivitetar."
        : "Aktivitetane er jamt fordelte gjennom året.";
    return '<section class="saa-card"><div class="saa-mstats">' +
      '<div class="saa-mstat"><strong>' + state.activities.length + '</strong><span>unike aktivitetar</span></div>' +
      '<div class="saa-mstat"><strong>' + Math.max.apply(null, mc) + '</strong><span>flest i éin månad</span></div>' +
      '<div class="saa-mstat"><strong>' + cats.length + '</strong><span>kategoriar i bruk</span></div></div>' +
      '<div class="saa-bgrid"><div class="saa-chart"><h2>Aktivitetar per månad</h2><p>Finn periodar som er tettare enn resten.</p><div class="saa-bars">' +
      MONTHS.map(function (m, i) { return '<div class="saa-barrow"><span>' + m + '</span><div class="saa-track"><div class="saa-fill ' + (heavy.some(function (x) { return x.i === i; }) ? "is-heavy" : "") + '" style="width:' + (mc[i] ? Math.max(5, mc[i] / mx * 100) : 0) + '%"></div></div><b>' + mc[i] + '</b></div>'; }).join("") +
      '</div></div><div class="saa-chart"><h2>Aktivitetar per kategori</h2><p>Kva planen legg mest vekt på.</p><div class="saa-bars">' +
      cats.map(function (x) { return '<div class="saa-barrow"><span title="' + esc(CATS[x.id]) + '">' + esc(CATS[x.id].split(" og ")[0]) + '</span><div class="saa-track"><div class="saa-fill" style="width:' + Math.max(5, x.n / cx * 100) + '%"></div></div><b>' + x.n + '</b></div>'; }).join("") +
      '</div></div></div><div class="saa-insight"><strong>Enkel balanseanalyse</strong>' + esc(msg) + '</div></section>';
  }

  function renderWheel() {
    return '<div>' + stepNav(3) +
      '<div class="saa-title"><div><h1>' + esc(INDUSTRIES[state.business.industry] || "Verksemda") + '</h1><p>' + state.activities.length + ' aktivitetar gir ' + occurrenceCount() + ' plasseringar gjennom året.</p></div>' +
      '<div class="saa-actions"><button type="button" class="btn btn--secondary" data-a="exportMenu">Eksport / backup</button><button type="button" class="btn btn--secondary" data-a="newAct">Legg til aktivitet</button><button type="button" class="btn btn--primary" data-a="more">Finn fleire forslag</button></div></div>' +
      '<div class="saa-tabs" role="tablist">' +
      [["year", "Årsvisning"], ["list", "Månads- og listevisning"], ["balance", "Balansevisning"]].map(function (v) {
        return '<button type="button" class="saa-tab ' + (state.currentView === v[0] ? "is-on" : "") + '" data-a="view" data-view="' + v[0] + '">' + v[1] + '</button>';
      }).join("") + '</div>' +
      (state.currentView === "year" ? yearView() : state.currentView === "list" ? listView() : balanceView()) + '</div>';
  }

  /* =========================================================================
     GENERERING (venteskjerm)
     ====================================================================== */
  var GEN_MESSAGES = ["Analyserer verksemda", "Sjekkar sesong og behov", "Finn aktuelle kurs og arrangement", "Kontrollerer relevante fristar", "Gjer forslaga klare"];
  function renderLoading() {
    return '<div class="saa-loading"><div class="saa-loadcard"><div class="saa-loadmark"></div><h2>Smarte forslag</h2><div class="saa-loadstatus" id="saa-loadstatus">' + GEN_MESSAGES[0] + '</div>' +
      '<div class="saa-progress"><span id="saa-loadbar" style="width:15%"></span></div></div></div>';
  }

  /* =========================================================================
     HOVUD-RENDER
     ====================================================================== */
  var contentEl = null;
  var loadingTimer = null;

  function renderContent() {
    if (!contentEl) return;
    if (generating) { contentEl.innerHTML = renderLoading(); return; }
    try {
      contentEl.innerHTML = state.screen === "setup" ? renderSetup() : state.screen === "workshop" ? renderWorkshop() : renderWheel();
    } catch (e) {
      console.error("[smart-aarshjul]", e);
      contentEl.innerHTML = '<div class="saa-empty"><strong>Noko gjekk gale i visninga.</strong>Ingen data er sletta. <button type="button" class="btn btn--primary" data-a="recover">Opne trygg startside</button></div>';
    }
  }

  function startGenerate() {
    generating = true;
    renderContent();
    var i = 0;
    loadingTimer = setInterval(function () {
      i = Math.min(i + 1, GEN_MESSAGES.length - 1);
      var s = contentEl.querySelector("#saa-loadstatus"), b = contentEl.querySelector("#saa-loadbar");
      if (s) s.textContent = GEN_MESSAGES[i];
      if (b) b.style.width = (15 + i * 18) + "%";
    }, 900);

    requestSuggestions().then(function (data) {
      clearInterval(loadingTimer);
      generating = false;
      state.suggestions = markDuplicates(data.suggestions || []);
      state.summary = data.summary || "";
      state.disclaimer = data.disclaimer || "";
      state.filters = { search: "", category: "all", month: "all" };
      state.screen = "workshop";
      save();
      renderContent();
      toast(state.suggestions.length + " forslag er klare.");
    }).catch(function (e) {
      clearInterval(loadingTimer);
      generating = false;
      state.screen = state.activities.length ? "wheel" : "setup";
      renderContent();
      toast((e && e.saaSafe && e.message) || "Forslaga kunne ikkje genererast. Dei eksisterande aktivitetane dine er urørte.", "error");
    });
  }

  /* =========================================================================
     MODAL
     ====================================================================== */
  var modalEl = null, returnFocus = null;

  function openModal(html, focusSel) {
    if (!modalEl) return;
    returnFocus = document.activeElement;
    modalEl.innerHTML = '<div class="saa-backdrop" data-a="backdrop"><div class="saa-modal" role="dialog" aria-modal="true">' + html + '</div></div>';
    document.addEventListener("keydown", modalKeydown);
    requestAnimationFrame(function () {
      var el = modalEl.querySelector(focusSel || "button,input,select,textarea");
      if (el) el.focus();
    });
  }
  function closeModal() {
    if (!modalEl) return;
    modalEl.innerHTML = "";
    document.removeEventListener("keydown", modalKeydown);
    if (returnFocus && returnFocus.focus) returnFocus.focus();
    returnFocus = null;
  }
  function modalKeydown(e) {
    if (!modalEl || !modalEl.innerHTML) return;
    if (e.key === "Escape") { closeModal(); return; }
    if (e.key === "Tab") {
      var focusable = modalEl.querySelectorAll("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])");
      if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function editor(kind, id, presetMonth) {
    var isSug = kind === "suggestion";
    var arr = isSug ? state.suggestions : state.activities;
    var old = id ? arr.find(function (x) { return x.id === id; }) : null;
    var x = old || {
      title: "", description: "", reason: isSug ? "Eige forslag lagt til i verkstaden." : "", month: presetMonth || state.selectedMonth,
      category: "custom", source: "custom", status: "planned", locked: false, recurrence: "none", day: null
    };
    openModal(
      '<div class="saa-modalhead"><div><h2>' + (old ? "Rediger" : "Legg til") + " " + (isSug ? "forslag" : "aktivitet") + '</h2>' +
      '<p>' + (isSug ? "Tilpass før godkjenning." : "Oppdater månad, kategori, status og låsing.") + '</p></div>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-a="close" aria-label="Lukk"><i class="ti ti-x"></i></button></div>' +
      '<form id="saa-editor-form" data-kind="' + kind + '" data-id="' + (id || "") + '"><div class="saa-modalbody"><div class="saa-grid2">' +
      '<div class="saa-field saa-span2"><label for="saa-etitle">Tittel</label><input id="saa-etitle" name="title" maxlength="160" required value="' + esc(x.title) + '"></div>' +
      '<div class="saa-field saa-span2"><label for="saa-edesc">Beskriving</label><textarea id="saa-edesc" name="description" maxlength="900">' + esc(x.description) + '</textarea></div>' +
      (isSug ? '<div class="saa-field saa-span2"><label for="saa-ereason">Kvifor foreslått?</label><textarea id="saa-ereason" name="reason" maxlength="700">' + esc(x.reason) + '</textarea></div>' : "") +
      '<div class="saa-field"><label for="saa-erepeat">Gjentaking</label><select id="saa-erepeat" name="recurrence"><option value="none"' + (x.recurrence !== "monthly" ? " selected" : "") + '>Éin gong</option><option value="monthly"' + (x.recurrence === "monthly" ? " selected" : "") + '>Kvar månad</option></select></div>' +
      '<div class="saa-field"><label for="saa-eday">Dag i månaden <span class="saa-hint">valfritt</span></label><input id="saa-eday" name="day" type="number" min="1" max="31" inputmode="numeric" placeholder="Til dømes 5" value="' + (x.day == null ? "" : x.day) + '"></div>' +
      '<div class="saa-field" id="saa-emonthfield"' + (x.recurrence === "monthly" ? " hidden" : "") + '><label for="saa-emonth">Månad</label><select id="saa-emonth" name="month">' + monOpts(x.month) + '</select></div>' +
      '<div class="saa-field"><label for="saa-ecat">Kategori</label><select id="saa-ecat" name="category">' + catOpts(x.category) + '</select></div>' +
      '<div class="saa-field saa-span2 saa-repeathelp" id="saa-repeatinfo">' + (x.recurrence === "monthly" ? "Aktiviteten blir vist i alle tolv månader og redigert som éin aktivitet." : "Vel ein månad for eingongsaktiviteten.") + '</div>' +
      (!isSug ? '<div class="saa-field"><label for="saa-estatus">Status</label><select id="saa-estatus" name="status">' + statOpts(x.status) + '</select></div>' +
        '<div class="saa-field saa-span2"><label class="saa-checkline"><input type="checkbox" name="locked"' + (x.locked ? " checked" : "") + '><span><b>Lås aktiviteten.</b><br><span class="saa-hint">Låste aktivitetar blir alltid bevarte ved ny generering.</span></span></label></div>' : "") +
      '</div></div><div class="saa-modalfoot">' +
      (old && !isSug ? '<button type="button" class="btn btn--danger" data-a="delAct" data-id="' + x.id + '">Slett</button><button type="button" class="btn btn--secondary" data-a="duplicate" data-id="' + x.id + '">Dupliser</button>' : "") +
      '<button type="button" class="btn btn--secondary" data-a="close">Avbryt</button><button type="submit" class="btn btn--primary">Lagre</button></div></form>',
      "#saa-etitle"
    );
  }

  function exportMenu() {
    openModal(
      '<div class="saa-modalhead"><div><h2>Eksport, backup og import</h2><p>Alle filer blir handterte lokalt i nettlesaren din.</p></div><button type="button" class="btn btn--ghost btn--sm" data-a="close" aria-label="Lukk"><i class="ti ti-x"></i></button></div>' +
      '<div class="saa-modalbody">' +
      '<div class="saa-chart"><h2>Sikkerheitskopi</h2><p>Last ned ei komplett fil med verksemdstekst, aktivitetar, forslag, statusar, låsing, datoar og gjentaking.</p><button type="button" class="btn btn--primary" data-a="backup">Last ned sikkerheitskopi</button></div>' +
      '<div class="saa-chart" style="margin-top:.7rem"><h2>Les inn sikkerheitskopi</h2><p>Vel ei tidlegare fil. Du får sjå ei oppsummering før dette erstattar noverande data.</p><input id="saa-backup-file" type="file" accept=".json,application/json" hidden><button type="button" class="btn btn--secondary" data-a="importBackup">Vel fil</button><div class="saa-hint" style="margin-top:.4rem">Ingenting blir endra før du stadfestar innlesinga.</div></div>' +
      '<div class="saa-chart" style="margin-top:.7rem"><h2>CSV</h2><p>Månad, dag, gjentaking, tittel, kategori, beskriving, status og opphav.</p><button type="button" class="btn btn--secondary" data-a="csv"' + (state.activities.length ? "" : " disabled") + '>Last ned CSV</button></div>' +
      '<div class="saa-chart" style="margin-top:.7rem"><h2>Tekstoversikt</h2><p>Aktivitetar grupperte per månad.</p><button type="button" class="btn btn--secondary" data-a="txt"' + (state.activities.length ? "" : " disabled") + '>Last ned tekstfil</button></div>' +
      '</div>', '[data-a="backup"]'
    );
  }

  function download(name, text, type) {
    try {
      var blob = new Blob([text], { type: type }), url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 800);
    } catch (e) { toast("Fila kunne ikkje lagast.", "error"); }
  }
  function exportBackup() {
    var payload = { format: "vibeverk-smart-aarshjul-backup", formatVersion: 1, exportedAt: new Date().toISOString(), data: state };
    download("vibeverk-smart-aarshjul-backup-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    closeModal();
    toast("Sikkerheitskopien er klar.");
  }
  function csvCell(v) { return '"' + String(v == null ? "" : v).replace(/\r?\n/g, " ").replace(/"/g, '""') + '"'; }
  function exportCSV() {
    if (!state.activities.length) return toast("Årshjulet er tomt.", "warning");
    var body = [];
    MONTHS.forEach(function (m, i) {
      activitiesForMonth(i + 1).forEach(function (x) {
        body.push([m, x.day || "", x.recurrence === "monthly" ? "Kvar månad" : "Éin gong", x.title, CATS[x.category], x.description, STAT[x.status], x.source === "custom" ? "Eigen aktivitet" : "Smart forslag"]);
      });
    });
    var rows = [["Månad", "Dag", "Gjentaking", "Tittel", "Kategori", "Beskriving", "Status", "Opphav"]].concat(body);
    download("vibeverk-smart-aarshjul.csv", "﻿" + rows.map(function (r) { return r.map(csvCell).join(";"); }).join("\r\n"), "text/csv;charset=utf-8");
    closeModal();
    toast("CSV-fila er klar.");
  }
  function exportText() {
    if (!state.activities.length) return toast("Årshjulet er tomt.", "warning");
    var l = ["SMART ÅRSHJUL", INDUSTRIES[state.business.industry] || "Verksemd", ""];
    MONTHS.forEach(function (m, i) {
      var a = activitiesForMonth(i + 1);
      if (!a.length) return;
      l.push(m.toUpperCase(), "-".repeat(m.length));
      a.forEach(function (x) {
        l.push("• " + x.title, "  Tidspunkt: " + scheduleLabel(x) + " | Kategori: " + CATS[x.category] + " | Status: " + STAT[x.status] + " | Opphav: " + (x.source === "custom" ? "Eigen aktivitet" : "Smart forslag"));
        if (x.description) l.push("  " + x.description);
        if (x.exactDate) l.push("  Dato/periode: " + x.exactDate);
        if (x.sourceName) l.push("  Kjelde: " + x.sourceName + (x.sourceUrl ? " – " + x.sourceUrl : ""));
        if (x.verificationRequired) l.push("  Merk: Må kontrollerast før bruk.");
        l.push("");
      });
    });
    download("vibeverk-smart-aarshjul.txt", "﻿" + l.join("\r\n"), "text/plain;charset=utf-8");
    closeModal();
    toast("Tekstoversikta er klar.");
  }
  function chooseBackup() {
    var input = modalEl.querySelector("#saa-backup-file");
    if (input) { input.value = ""; input.click(); }
  }
  function readBackupFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var raw = JSON.parse(String(reader.result || ""));
        if (raw.format !== "vibeverk-smart-aarshjul-backup" || !raw.data || typeof raw.data !== "object") throw new Error("Ugyldig format");
        var imported = validateState(raw.data);
        pendingImport = imported;
        // Lukk den framleis opne eksport-modalen fyrst -- elles fangar den
        // nye openModal() under sin eigen returnFocus-snapshot det skjulte
        // filveljar-input-et (ikkje eit ekte fokuserbart element), og fokus
        // hamnar ingen stad når brukaren seinare stadfestar/avbryt importen.
        closeModal();
        openModal(
          '<div class="saa-modalhead"><div><h2>Les inn sikkerheitskopi?</h2><p>Kontroller innhaldet før noverande data blir erstatta.</p></div><button type="button" class="btn btn--ghost btn--sm" data-a="close" aria-label="Lukk"><i class="ti ti-x"></i></button></div>' +
          '<div class="saa-modalbody"><div class="saa-safebox"><b>' + esc(INDUSTRIES[imported.business.industry] || "Verksemd") + '</b><br>' + imported.activities.length + ' aktivitetar · ' + imported.suggestions.length + ' uferdige forslag</div>' +
          '<p>Dette overskriv ALT noverande innhald i Smart årshjul med innhaldet i denne fila. Dette kan ikkje angrast. Ta gjerne ein sikkerheitskopi av det du har no først.</p></div>' +
          '<div class="saa-modalfoot"><button type="button" class="btn btn--secondary" data-a="cancelImport">Avbryt</button><button type="button" class="btn btn--danger" data-a="confirmImport">Ja, erstatt med denne fila</button></div>',
          '[data-a="confirmImport"]'
        );
      } catch (e) {
        pendingImport = null;
        toast("Fila er ikkje ei gyldig Smart årshjul-sikkerheitskopi.", "error");
      }
    };
    reader.onerror = function () { toast("Fila kunne ikkje lesast.", "error"); };
    reader.readAsText(file, "utf-8");
  }
  function confirmImport() {
    if (!pendingImport) return toast("Ingen gyldig fil er klar.", "error");
    state = pendingImport;
    pendingImport = null;
    if (state.activities.length && state.screen === "setup") state.screen = "wheel";
    save();
    closeModal();
    renderContent();
    toast("Sikkerheitskopien er lesen inn.");
  }

  /* =========================================================================
     GODKJENNING
     ====================================================================== */
  function approve() {
    var chosen = state.suggestions.filter(function (x) { return x.selected; });
    if (!chosen.length) return toast("Vel minst eitt forslag.", "warning");
    var keys = {};
    state.activities.forEach(function (a) { keys[norm(a.title) + "|" + a.category] = true; });
    var added = 0, skipped = 0;
    chosen.forEach(function (x) {
      var k = norm(x.title) + "|" + x.category;
      if (keys[k]) { skipped++; return; }
      state.activities.push({
        id: uid("a"), title: x.title, description: x.description, reason: x.reason, month: x.month, category: x.category,
        source: x.source === "custom" ? "custom" : "smart-suggestion", status: "planned", locked: false,
        recurrence: x.recurrence === "monthly" ? "monthly" : "none", day: day(x.day), verificationRequired: x.verificationRequired,
        itemType: x.itemType || "", exactDate: x.exactDate || "", sourceName: x.sourceName || "", sourceUrl: x.sourceUrl || "",
        sourceVerifiedAt: x.sourceVerifiedAt || "", applicability: x.applicability || "", createdAt: new Date().toISOString()
      });
      keys[k] = true;
      added++;
    });
    state.suggestions = [];
    state.screen = "wheel";
    state.currentView = "year";
    if (added) state.selectedMonth = state.activities[state.activities.length - 1].month;
    save();
    renderContent();
    toast(added + " aktivitetar vart lagde til" + (skipped ? ". " + skipped + " duplikat vart hoppa over." : "."));
  }

  /* =========================================================================
     HENDINGSBINDING (éin gong per mount(), sjå filhovudet)
     ====================================================================== */
  function bindEvents(root) {
    root.addEventListener("click", function (e) {
      var t = e.target.closest("[data-a]");
      if (!t) return;
      var a = t.dataset.a, id = t.dataset.id;

      if (a === "exportMenu") return exportMenu();
      if (a === "backup") return exportBackup();
      if (a === "importBackup") return chooseBackup();
      if (a === "confirmImport") return confirmImport();
      if (a === "cancelImport") { pendingImport = null; return closeModal(); }
      if (a === "csv") return exportCSV();
      if (a === "txt") return exportText();
      if (a === "close") { pendingImport = null; return closeModal(); }
      if (a === "backdrop" && e.target === t) return closeModal();
      // Berre byt til det enklaste, tryggaste steget -- IKKJE state = defaultState(),
      // som ville sletta aktivitetane/forslaga stikk i strid med teksten på same
      // skjerm ("Ingen data er sletta"). Sjølve krasjet er nesten alltid eit
      // render-problem, ikkje eit datalagringsproblem, så aktivitetane er urørte.
      if (a === "recover") { state.screen = "setup"; save(); return renderContent(); }

      if (a === "stepNav") {
        var target = +t.dataset.step;
        if (target === 1) { state.screen = "setup"; state.mode = state.activities.length ? "more" : "new"; }
        else if (target === 2 && state.suggestions.length) { state.screen = "workshop"; }
        else if (target === 3 && state.activities.length) { state.screen = "wheel"; }
        else { toast("Dette steget er ikkje klart enno.", "warning"); return; }
        save();
        return renderContent();
      }

      if (a === "newSug") return editor("suggestion");
      if (a === "editSug") return editor("suggestion", id);
      if (a === "delSug") { state.suggestions = state.suggestions.filter(function (x) { return x.id !== id; }); save(); return renderContent(); }

      if (a === "selectVis" || a === "unselectVis") {
        var yes = a === "selectVis", visIds = {};
        filteredSuggestions().forEach(function (x) { visIds[x.id] = true; });
        state.suggestions.forEach(function (x) { if (visIds[x.id]) x.selected = yes; });
        save(); return renderContent();
      }
      if (a === "selectCat" || a === "unselectCat") {
        if (state.filters.category === "all") return toast("Vel ein kategori i filteret først.", "warning");
        var yesCat = a === "selectCat";
        state.suggestions.forEach(function (x) { if (x.category === state.filters.category) x.selected = yesCat; });
        save(); return renderContent();
      }
      if (a === "clearFilter") { state.filters = { search: "", category: "all", month: "all" }; save(); return renderContent(); }
      if (a === "approve") return approve();

      if (a === "view") { state.currentView = t.dataset.view; save(); return renderContent(); }
      if (a === "month") { state.selectedMonth = month(t.dataset.month); save(); return renderContent(); }

      if (a === "newAct") return editor("activity");
      if (a === "newActMonth") return editor("activity", null, state.selectedMonth);
      if (a === "editAct") return editor("activity", id);
      if (a === "delAct") { state.activities = state.activities.filter(function (x) { return x.id !== id; }); closeModal(); save(); renderContent(); toast("Aktiviteten er sletta."); return; }
      if (a === "duplicate") {
        var src = state.activities.find(function (x) { return x.id === id; });
        if (src) { state.activities.push(Object.assign({}, src, { id: uid("a"), title: src.title + " – kopi", locked: false, createdAt: new Date().toISOString() })); closeModal(); save(); renderContent(); toast("Aktiviteten er duplisert."); }
        return;
      }
      if (a === "more") { state.screen = "setup"; state.mode = "more"; save(); return renderContent(); }
    });

    root.addEventListener("change", function (e) {
      var t = e.target, a = t.dataset.a, id = t.dataset.id;
      if (t.id === "saa-backup-file") { readBackupFile(t.files && t.files[0]); return; }
      if (t.id === "saa-erepeat") {
        var monthly = t.value === "monthly", mf = modalEl.querySelector("#saa-emonthfield"), info = modalEl.querySelector("#saa-repeatinfo");
        if (mf) mf.hidden = monthly;
        if (info) info.textContent = monthly ? "Aktiviteten blir vist i alle tolv månader og redigert som éin aktivitet." : "Vel ein månad for eingongsaktiviteten.";
        return;
      }
      if (t.id === "saa-industry") { state.business.industry = t.value; save(); return; }
      if (t.id === "saa-catfilter") { state.filters.category = t.value; save(); return renderContent(); }
      if (t.id === "saa-monthfilter") { state.filters.month = t.value; save(); return renderContent(); }
      if (a === "toggleSug") { var s1 = state.suggestions.find(function (x) { return x.id === id; }); if (s1) s1.selected = t.checked; save(); return renderContent(); }
      if (a === "sugMonth") { var s2 = state.suggestions.find(function (x) { return x.id === id; }); if (s2) s2.month = month(t.value); save(); return renderContent(); }
      if (a === "actMonth") { var s3 = state.activities.find(function (x) { return x.id === id; }); if (s3) s3.month = month(t.value); save(); return renderContent(); }
      if (a === "actStatus") { var s4 = state.activities.find(function (x) { return x.id === id; }); if (s4 && STAT[t.value]) s4.status = t.value; save(); return renderContent(); }
    });

    var searchTimer;
    root.addEventListener("input", function (e) {
      var t = e.target;
      if (t.id === "saa-description") { var c = contentEl.querySelector("#saa-dcount"); if (c) c.textContent = t.value.length; }
      if (t.id === "saa-search") {
        clearTimeout(searchTimer);
        state.filters.search = t.value;
        save();
        var pos = t.selectionStart;
        searchTimer = setTimeout(function () {
          renderContent();
          var n = contentEl.querySelector("#saa-search");
          if (n) { n.focus(); n.setSelectionRange(pos, pos); }
        }, 80);
      }
    });

    root.addEventListener("submit", function (e) {
      if (e.target.id === "saa-setup-form") {
        e.preventDefault();
        var industryEl = contentEl.querySelector("#saa-industry");
        var descEl = contentEl.querySelector("#saa-description");
        var description = descEl.value.trim();
        if (!description) { toast("Skriv ei kort skildring.", "error"); descEl.focus(); return; }
        state.business = {
          industry: industryEl.value, description: description,
          seasons: contentEl.querySelector("#saa-seasons").value.trim(),
          focus: contentEl.querySelector("#saa-focus").value.trim()
        };
        save();
        startGenerate();
        return;
      }
      if (e.target.id === "saa-editor-form") {
        e.preventDefault();
        var f = e.target, d = new FormData(f), kind = f.dataset.kind, editId = f.dataset.id || null;
        var title = String(d.get("title") || "").trim();
        if (!title) return toast("Skriv ein tittel.", "error");
        if (kind === "suggestion") {
          var oldSug = state.suggestions.find(function (x) { return x.id === editId; });
          var xs = {
            id: (oldSug && oldSug.id) || uid("s-custom"), title: title, description: String(d.get("description") || "").trim(),
            reason: String(d.get("reason") || "").trim() || "Eigne aktivitetar gjer planen relevant for verksemda.",
            month: month(d.get("month")), category: CATS[d.get("category")] ? d.get("category") : "custom",
            source: (oldSug && oldSug.source) || "custom", selected: oldSug ? oldSug.selected : true, locked: false,
            recurrence: d.get("recurrence") === "monthly" ? "monthly" : "none", day: day(d.get("day")),
            verificationRequired: (oldSug && oldSug.verificationRequired) || false, duplicateOf: (oldSug && oldSug.duplicateOf) || null,
            itemType: (oldSug && oldSug.itemType) || "", exactDate: (oldSug && oldSug.exactDate) || "", sourceName: (oldSug && oldSug.sourceName) || "",
            sourceUrl: (oldSug && oldSug.sourceUrl) || "", sourceVerifiedAt: (oldSug && oldSug.sourceVerifiedAt) || "", applicability: (oldSug && oldSug.applicability) || ""
          };
          if (oldSug) Object.assign(oldSug, xs); else state.suggestions.unshift(xs);
        } else {
          var oldAct = state.activities.find(function (x) { return x.id === editId; });
          var xa = {
            id: (oldAct && oldAct.id) || uid("a"), title: title, description: String(d.get("description") || "").trim(),
            reason: (oldAct && oldAct.reason) || "", month: month(d.get("month")), category: CATS[d.get("category")] ? d.get("category") : "custom",
            source: (oldAct && oldAct.source) || "custom", status: STAT[d.get("status")] ? d.get("status") : "planned", locked: d.get("locked") === "on",
            recurrence: d.get("recurrence") === "monthly" ? "monthly" : "none", day: day(d.get("day")),
            verificationRequired: (oldAct && oldAct.verificationRequired) || false, itemType: (oldAct && oldAct.itemType) || "",
            exactDate: (oldAct && oldAct.exactDate) || "", sourceName: (oldAct && oldAct.sourceName) || "", sourceUrl: (oldAct && oldAct.sourceUrl) || "",
            sourceVerifiedAt: (oldAct && oldAct.sourceVerifiedAt) || "", applicability: (oldAct && oldAct.applicability) || "",
            createdAt: (oldAct && oldAct.createdAt) || new Date().toISOString()
          };
          if (oldAct) Object.assign(oldAct, xa); else state.activities.push(xa);
          state.selectedMonth = xa.month;
        }
        closeModal();
        save();
        renderContent();
        toast("Endringa er lagra.");
      }
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  function render() {
    return '<div id="saa-root"><div id="saa-content"></div><div class="saa-toasts" id="saa-toasts" aria-live="polite"></div><div id="saa-modal"></div></div>';
  }

  function mount(outlet) {
    var root = outlet.querySelector("#saa-root");
    if (!root) return;
    injectStyles();
    contentEl = root.querySelector("#saa-content");
    toastsEl = root.querySelector("#saa-toasts");
    modalEl = root.querySelector("#saa-modal");
    generating = false;
    load();
    renderContent();
    bindEvents(root);
  }

  Intranet.registerModule({
    id: "smart-aarshjul",
    navLabel: "Smart årshjul",
    icon: "calendar-stats",
    order: 60,
    render: render,
    mount: mount
  });
})();
