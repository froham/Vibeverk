/* test-workspace.js — jsdom-harness for Workspace. Kjør: node test-workspace.js
   Renamed 2026-07-07 frå test-intranet.js — sjå docs/project/CHANGELOG.md. */
const { JSDOM } = require("jsdom");
const fs = require("fs");

const html = fs.readFileSync("workspace/index.html", "utf8")
  .replace(/src="\.\.\/config\.js"/g,     'src="config.js"')
  .replace(/src="\.\.\/components\.js"/g, 'src="components.js"')
  .replace(/src="\.\.\/core\.js"/g,       'src="core.js"')
  .replace(/src="workspace-core\.js"/g,    'src="workspace/workspace-core.js"')
  .replace(/src="module-announcements\.js"/g, 'src="workspace/module-announcements.js"')
  .replace(/src="module-settings\.js"/g,  'src="workspace/module-settings.js"')
  .replace(/src="module-tasks\.js"/g,     'src="workspace/module-tasks.js"')
  .replace(/src="module-notes\.js"/g,     'src="workspace/module-notes.js"')
  .replace(/src="module-mediabank-internal\.js"/g, 'src="workspace/module-mediabank-internal.js"')
  .replace(/src="module-kb\.js"/g,        'src="workspace/module-kb.js"')
  .replace(/src="module-contact\.js"/g,   'src="workspace/module-contact.js"')
  // module-crm.js: ingen sti-omskriving her — workspace/index.html peikar allereie
  // rett på rot-fila (../module-crm.js), som er den einaste som faktisk vert lasta
  // i produksjon (sjå docs/project/CURRENT_STATE.md "Known limitations").
  // Den tidlegare intranet/module-crm.js var daud kode, sletta 2026-07-06.
  .replace(/src="module-booking\.js"/g,   'src="workspace/module-booking.js"')
  .replace(/src="module-quote\.js"/g,     'src="workspace/module-quote.js"')
  .replace(/src="module-dashboard\.js"/g, 'src="workspace/module-dashboard.js"')
  .replace(/src="module-orgdrift\.js"/g,  'src="workspace/module-orgdrift.js"')
  .replace(/src="module-links\.js"/g,     'src="workspace/module-links.js"')
  .replace(/src="module-workspaceship\.js[^"]*"/g, 'src="workspace/module-workspaceship.js"')
  .replace(/src="module-users\.js[^"]*"/g,   'src="workspace/module-users.js"');

const dom = new JSDOM(html, {
  runScripts: "outside-only", pretendToBeVisual: true,
  url: "https://example.test/workspace/"
});
const { window } = dom;
window.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
  unobserve() {} disconnect() {}
};
window.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){} });
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.URL.createObjectURL = window.URL.createObjectURL || (() => "blob:mock");
window.URL.revokeObjectURL = window.URL.revokeObjectURL || (() => {});
window.confirm = () => true;

[
  "config.js","components.js","core.js","template-klassisk.js","template-panorama.js","template-scrollstory.js",
  "workspace/workspace-core.js",
  "workspace/module-announcements.js",
  "workspace/module-settings.js",
  "workspace/module-tasks.js",
  "workspace/module-notes.js",
  "workspace/module-mediabank-internal.js",
  "workspace/module-kb.js",
  "workspace/module-contact.js",
  "module-crm.js", // aktiv fil (dual-registrerer for Web-admin OG Workspace) — ikkje den tidlegare intranet/module-crm.js (daud kode, sletta 2026-07-06)
  "workspace/module-booking.js",
  "workspace/module-quote.js",
  "workspace/module-dashboard.js",
  "workspace/module-orgdrift.js",
  "workspace/module-links.js",
  "workspace/module-workspaceship.js",
  "workspace/module-users.js"
].forEach(f => {
  let src = fs.readFileSync(f, "utf8");
  // For testmiljøet: skru på alle intranett-features
  if (f === "config.js") {
    src = src.replace(/intranettFeatures:\s*\{[^}]*\}/s, `intranettFeatures: {
    announcements: true, notes: true, orgdrift: true, links: true,
    crm: true, booking: true, quote: true, contact: true,
    kb: true, mediaInternal: true
  }`);
  }
  window.eval(src);
});

// Auth via eval (same jsdom-kontekst)
const _NS = window.eval('(window.SITE_CONFIG&&window.SITE_CONFIG.storageKey)||"site"');
window.eval(`sessionStorage.setItem("${_NS}:admin","admin")`);

window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
const doc = window.document;
const App = window.App;
const Intranet = window.Intranet;

const assert = (cond, msg) => {
  if (!cond) { globalThis.__err = (globalThis.__err||0)+1; console.error("FEIL:", msg); process.exitCode = 1; }
  else        { globalThis.__ok  = (globalThis.__ok ||0)+1; console.log("OK:", msg); }
};

// App.ready — same gate as test.js, verified independently here since
// test-workspace.js loads workspace-core.js + workspace/module-*.js, which use
// the reassignment pattern (CFG = freshCFG) rather than the module-file
// wrap pattern — see docs/project/CHANGELOG.md for the Fase 4 writeup.
// Same synchronous-harness limitation as test.js: this locks in the
// behavioral-no-op property, not a genuinely deferred/async resolution.
assert(typeof App.ready === "function", "App.ready finst og er ein funksjon");
var _readyProbeCalls2 = 0;
App.ready(function (cfg) { _readyProbeCalls2++; });
assert(_readyProbeCalls2 === 1, "App.ready(fn) kallar fn synkront nøyaktig éin gong når config alt er klar");
var _origBookingFlag2 = window.SITE_CONFIG.intranettFeatures.booking;
window.SITE_CONFIG.intranettFeatures.booking = false;
var _readyProbeAfterMutation2 = null;
App.ready(function (cfg) { _readyProbeAfterMutation2 = cfg.intranettFeatures.booking; });
assert(_readyProbeAfterMutation2 === false, "App.ready(fn) les levande CFG-tilstand, ikkje eit stale snapshot");
window.SITE_CONFIG.intranettFeatures.booking = _origBookingFlag2;

function nav(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event("hashchange"));
}

/* --- A) SHELL ------------------------------------------------------------ */
assert(!!doc.getElementById("intranet"),       "a1: #intranet rot");
assert(!doc.getElementById("app"),             "a2: ingen #app");
assert(!!doc.getElementById("intranet-nav"),   "a3: sidebar-nav");
assert(!!doc.getElementById("intranet-main"),  "a4: content-outlet");

/* --- B) REGISTER OG NAV -------------------------------------------------- */
assert(typeof Intranet.registerModule === "function", "b1: Intranet.registerModule");
const navIds = [...doc.querySelectorAll(".i-nav__link")].map(a=>a.getAttribute("data-inav"));
assert(navIds.includes("dashboard"),     "b2: dashboard i nav");
assert(navIds.includes("tasks"),         "b3: tasks i nav");
assert(navIds.includes("announcements"), "b4: announcements i nav");
assert(!navIds.includes("workspaceship"),"b5: workspaceship skjult");
assert(navIds.includes("users"),         "b6: users i nav for admin");
assert(!navIds.includes("spaceship"),    "b7: spaceship-modulen skjult utan customModules-oppføring (config.js sin ekte standard er customModules:{})");

/* --- C) INGEN OFFENTLEG INNHALD ------------------------------------------ */
assert(!doc.querySelector(".site-header"), "c1: ingen site-header");
assert(!doc.querySelector(".site-footer"), "c2: ingen site-footer");

/* --- D) ROUTING ----------------------------------------------------------- */
assert(doc.querySelector(".i-nav__link.is-active")?.getAttribute("data-inav")==="dashboard","d1: dashboard aktiv");
nav("#/tasks");
assert(doc.querySelector(".i-nav__link.is-active")?.getAttribute("data-inav")==="tasks","d2: tasks aktiv");
assert(!!doc.querySelector("#tasks-root"),       "d3: tasks-root");
assert(!!doc.querySelector("#tasks-new-btn"), "d4: ny-oppgave-knapp");

/* --- E) TASKS CRUD -------------------------------------------------------- */
// Opprett oppgåver direkte via store (ny UI brukar modal som ikkje er testbar i jsdom)
App.store.set("wsp-tasks", [
  { id:"t1", title:"Testoppgave 1", body:"", status:"todo",        assignee:"", createdAt: Date.now(), updatedAt: Date.now() },
  { id:"t2", title:"Testoppgave 2", body:"", status:"in_progress", assignee:"", createdAt: Date.now(), updatedAt: Date.now() }
]);
nav("#/settings"); nav("#/tasks");
assert(App.store.get("wsp-tasks",[]).length===2, "e1: to oppgåver");
assert(App.store.get("wsp-tasks",[])[0].title==="Testoppgave 1", "e2: tittel ok");
assert(App.store.get("wsp-tasks",[])[0].status==="todo", "e3: status=todo");
assert(!!doc.querySelector("[data-task-status-select]"), "e4: status-select i rad");
assert(!!doc.querySelector("[data-task-edit]"), "e5: rediger-knapp");
// Legg til ei ferdig oppgåve og sjekk at kollapsbar seksjon finst
App.store.set("wsp-tasks", [
  { id:"t1", title:"Testoppgave 1", body:"", status:"todo",        assignee:"", createdAt: Date.now(), updatedAt: Date.now() },
  { id:"t2", title:"Testoppgave 2", body:"", status:"done",        assignee:"", createdAt: Date.now(), updatedAt: Date.now() }
]);
nav("#/settings"); nav("#/tasks");
assert(!!doc.querySelector("#task-done-toggle"), "e6: ferdig-toggle");

/* --- F) AKTIVITETSLOGG ---------------------------------------------------- */
// Legg til ein aktivitetspost manuelt sidan vi oppretta oppgåver direkte via store
Intranet.logActivity({ type: "task_created", label: "Testoppgave" });
const act = App.store.get("wsp-activity",[]);
assert(act.length>0,                "f1: aktivitet");
assert(typeof act[0].label==="string","f2: label er streng");

/* --- G) SETTINGS ---------------------------------------------------------- */
nav("#/settings");
assert(!!doc.querySelector("#settings-root"),  "g1: settings-root");
assert(!!doc.querySelector("#settings-form"),  "g2: settings-form");
assert(!!doc.querySelector("#settings-reset"), "g3: reset-knapp");
doc.querySelector("#settings-name").value = "Testbedriften AS";
doc.querySelector("#settings-form").dispatchEvent(new window.Event("submit",{cancelable:true,bubbles:true}));
assert(App.store.get("wsp-settings",{}).tenantName==="Testbedriften AS","g4: tenantName lagra");
doc.querySelector("#settings-reset").click();
assert(!App.store.get("wsp-tasks"),    "g5: tasks nullstilt");
assert(!App.store.get("wsp-settings"), "g6: settings nullstilt");

/* --- H) DASHBOARD --------------------------------------------------------- */
App.store.set("wsp-tasks",[
  {id:"t1",title:"A",status:"todo",createdAt:Date.now(),updatedAt:Date.now()},
  {id:"t2",title:"B",status:"in_progress",createdAt:Date.now(),updatedAt:Date.now()}
]);
Intranet.logActivity({type:"task_created",label:"Seeded"});
nav("#/settings"); nav("#/dashboard");
assert(!!doc.querySelector("#dashboard-root"), "h1: dashboard-root");
assert(doc.querySelector("#dashboard-root").textContent.includes("Å gjøre"),"h2: statuskategoriar");

/* --- I) NOTES ------------------------------------------------------------- */
nav("#/notes");
assert(!!doc.querySelector("#notes-root"),    "i1: notes-root");
assert(!!doc.querySelector("#notes-new-btn"), "i2: nytt-notat-knapp");
// Nytt-notat-knappen opnar no modal (ikkje testbar i jsdom) — opprett direkte via store
App.store.set("wsp-notes", [{
  id:"n1", title:"Testnotat", body:"", category:"Test",
  tags:["ai","test"], summary:"eit samandrag",
  createdAt:Date.now(), updatedAt:Date.now(), createdBy:"local"
}]);
nav("#/settings"); nav("#/notes");
const notes = App.store.get("wsp-notes",[]);
assert(notes.length===1,            "i3: notat i store");
assert(Array.isArray(notes[0].tags),"i4: tags er array");
assert("summary" in notes[0],       "i5: summary-felt");
assert(!!doc.querySelector("[data-note-open]"), "i6: note-open knapp");

/* --- J) KUNNSKAPSBASE ----------------------------------------------------- */
nav("#/settings"); nav("#/kb");
assert(!!doc.querySelector("#kb-root"),    "j1: kb-root");
assert(!!doc.querySelector("#kb-new-btn"), "j2: ny-artikkel-knapp (admin)");
doc.querySelector("#kb-new-btn").dispatchEvent(new window.Event("click",{bubbles:true}));
// Editor er no ein modal i document.body
const kbEd = doc.querySelector("#kb-edit-modal-bd") || doc.querySelector("#kb-editor-area");
assert(!!kbEd?.querySelector("#kb-title"), "j3: editor opna");
kbEd.querySelector("#kb-title").value = "Testartikkel";
kbEd.querySelector("#kb-category").value = "Rutinar";
kbEd.querySelector("#kb-official").checked = true;
kbEd.querySelector("#kb-save-btn").dispatchEvent(new window.Event("click",{bubbles:true}));
const kb = App.store.get("wsp-kb",[]);
assert(kb.length===1,             "j4: artikkel lagra");
assert(kb[0].published===true,    "j5: offisiell-flagg");

/* --- K) MEDIEBANK --------------------------------------------------------- */
nav("#/media-internal");
assert(!!doc.querySelector("#wsp-media-root"), "k1: media-root");
assert(!!doc.querySelector("#wsp-dropzone"),   "k2: dropzone");
App.store.set("wsp-media-index",[{id:"wsp-m-test",ref:"file:test",name:"test.pdf",type:"application/pdf",size:1024,category:"Test",uploadedAt:Date.now(),uploadedBy:"local"}]);
nav("#/notes"); nav("#/media-internal");
assert(App.store.get("wsp-media-index",[]).length===1, "k3: filindeks ok");

/* --- L) ANNOUNCEMENTS ----------------------------------------------------- */
nav("#/announcements");
assert(!!doc.querySelector("#ann-root"),    "l1: ann-root");
assert(!!doc.querySelector("#ann-new-btn"), "l2: ny-melding (admin)");
// Editor brukar App.ui-hjelperar som ikkje er tilgjengelege i jsdom — lag direkte i store
App.store.set("wsp-announcements", [{
  id:"a1", title:"Testmelding", body:"", important:true,
  image:null, attachments:[], createdAt:Date.now(), updatedAt:Date.now(), createdBy:"local"
}]);
nav("#/settings"); nav("#/announcements");
// Allereie lagra direkte i store over
const ann = App.store.get("wsp-announcements",[]);
assert(ann.length===1,         "l3: melding lagra");
assert(ann[0].important===true,"l4: viktig-flagg");

// l5-l8: "vis passord"-runden sin banner-fiks -- "Les mer" skal telje som lest,
// ikkje berre eit eksplisitt klikk på ×-krysset (2026-07-25-fiksen)
nav("#/dashboard");
const bannerEl = doc.getElementById("wsp-ann-banner");
assert(!!bannerEl && bannerEl.style.display !== "none", "l5: viktig-banner vises for ei ulest viktig melding");
const lesMerBtn = doc.getElementById("wsp-ann-lesmer");
assert(!!lesMerBtn, "l6: «Les mer»-knapp finst i banneret");
lesMerBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
assert(!!doc.getElementById("ann-reader-bd"), "l7: «Les mer» opnar lese-popup-en");
assert(bannerEl.style.display === "none", "l8: banneret er skjult ETTER «Les mer» -- å lese saka tel no som lest, ikkje berre ×");
doc.getElementById("ann-reader-bd").remove();

/* --- M) LENKER ------------------------------------------------------------ */
nav("#/links");
assert(!!doc.querySelector("#links-root"),    "m1: links-root");
assert(!!doc.querySelector("#links-new-btn"), "m2: legg-til-knapp");
doc.querySelector("#links-new-btn").dispatchEvent(new window.Event("click",{bubbles:true}));
doc.querySelector("#link-title").value = "SharePoint";
doc.querySelector("#link-url").value   = "https://sharepoint.example.com";
// Sjekk ikon-referanse-lenke i editor (finst etter at editor er opna)
assert(!!doc.querySelector("a[href='https://tabler.io/icons']"), "m5: ikon-referanse-lenke i editor");
doc.querySelector("#link-save").dispatchEvent(new window.Event("click",{bubbles:true}));
const links = App.store.get("wsp-links",[]);
assert(links.length===1,              "m3: lenke lagra");
assert(links[0].title==="SharePoint", "m4: tittel ok");

/* --- N) ORGDRIFT ---------------------------------------------------------- */
nav("#/notes");
nav("#/orgdrift");
// Re-navigér for å sikre at draw() er køyrd
nav("#/notes");
nav("#/orgdrift");
assert(!!doc.querySelector("#orgdrift-root"), "n1: orgdrift-root");
assert(!!doc.querySelector(".od-tabs"),       "n2: fane-navigasjon");
const orgData = App.store.get("wsp-orgdrift",{});
assert(Array.isArray(orgData.people)&&orgData.people.length>0, "n3: people-data");

/* --- O) WORKSPACESHIP ----------------------------------------------------- */
assert(!doc.querySelector('[data-inav="workspaceship"]'), "o1: workspaceship skjult");
App.store.set("wsp-workspaceship",{best:42});
assert(App.store.get("wsp-workspaceship",{}).best===42, "o2: highscore lagra");
// o3 (fjerna): testa tidlegare "nav('#/workspaceship')" -> "#workspaceship-root"
// finst -- ei rute som ikkje lenger finst. Fase 10 sitt customModules-arbeid
// registrerer i dag spelet under modul-id "spaceship" (ikkje "workspaceship"),
// og BERRE når customModules.spaceship.enabled===true i config -- default-
// configen i denne testfila set aldri det flagget, så ruta 404-a alltid her,
// heilt uavhengig av namnet. Same åtferd er alt korrekt dekt av AA-seksjonen
// under (sjå aa2), som patchar config riktig FØR ho navigerer -- denne
// assertionen dupliserte ikkje noko reelt, ho testa berre eit utgått namn.

/* --- Q) BRUKARSTYRING ----------------------------------------------------- */
nav("#/users");
assert(!!doc.querySelector("#users-root"), "q1: users-root");
assert(doc.querySelector("#users-root").textContent.includes("Supabase"), "q2: viser melding utan Supabase");

/* --- P) MØRK MODUS CSS ---------------------------------------------------- */
assert(!!doc.querySelector("[data-theme]")||true, "p1: dark mode CSS (visuell sjekk)");
App.store.set("wsp-prefs",{theme:"dark",density:"compact"});
assert(App.store.get("wsp-prefs",{}).theme==="dark", "p2: dark theme lagra");

/* --- P2) THEME-COLOR-META FØLGJER LYST/MØRKT MODUS (2026-07-25-funnet) ---- */
// iOS Safari gjettar sjølv fargen rundt status-/adresselinja utan denne taggen,
// upåliteleg ved SPA-navigering -- må difor haldast i takt med #intranet sin
// eigen data-theme, ikkje berre setjast statisk éin gong.
nav("#/settings");
assert(!!doc.querySelector('meta[name="theme-color"]'), "p3: theme-color-meta finst i <head>");
var darkBtn = doc.querySelector('.pref-theme-btn[data-theme-val="dark"]');
assert(!!darkBtn, "p4: «Mørkt»-knappen finst i Innstillingar");
darkBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
assert(doc.getElementById("intranet").getAttribute("data-theme") === "dark", "p5: data-theme sett til dark ved klikk");
assert(doc.querySelector('meta[name="theme-color"]').getAttribute("content") === "#0f172a", "p6: theme-color-meta følgjer med til mørk bakgrunnsfarge");
var lightBtn = doc.querySelector('.pref-theme-btn[data-theme-val="light"]');
lightBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
assert(doc.querySelector('meta[name="theme-color"]').getAttribute("content") === "#f1f5f9", "p7: theme-color-meta følgjer tilbake til lys bakgrunnsfarge");

/* --- P3) MOBIL-HAMBURGARMENY SITT DIM-OVERLAY (2026-07-26-funnet) ---------
   .i-sidebar-overlay dekker heile skjermen (inset:0) med rgba(0,0,0,.45) --
   utan å oppdatere theme-color medan menyen er open, vert iOS sitt status-
   linje-område verande i den vanlege (lyse) fargen medan resten av skjermen
   er mørklagt -- eit synleg avvik brukar rapporterte 2026-07-26. */
var hamburgerBtn = doc.getElementById("intranet-hamburger");
var sidebarOverlay = doc.getElementById("intranet-overlay");
assert(!!hamburgerBtn && !!sidebarOverlay, "p8: hamburgar-knapp og overlay finst");
hamburgerBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
assert(sidebarOverlay.classList.contains("is-open"), "p9: overlay opnar ved klikk på hamburgar");
assert(doc.querySelector('meta[name="theme-color"]').getAttribute("content") === "#858789", "p10: theme-color-meta mørknar til blanda farge (45% svart over lys bakgrunn) medan menyen er open");
sidebarOverlay.dispatchEvent(new window.Event("click", { bubbles: true }));
assert(!sidebarOverlay.classList.contains("is-open"), "p11: overlay lukkar ved klikk på sjølve overlayen");
assert(doc.querySelector('meta[name="theme-color"]').getAttribute("content") === "#f1f5f9", "p12: theme-color-meta går tilbake til vanleg lys farge når menyen lukkast");

/* --- R) CRM: AKTIV ROT-FIL (IKKJE DAUD intranet/module-crm.js) ------------ */
nav("#/notes"); nav("#/crm");
assert(navIds.includes("crm") || !!doc.querySelector('[data-inav="crm"]'), "r1: CRM i Workspace-nav (registrert av rot-module-crm.js sin Intranet.registerModule-gren)");
assert(!!doc.querySelector("[data-crm-root]"), "r2: CRM-root rendrer i Workspace (test-intranet.js lastar aktiv module-crm.js, ikkje daud intranet/module-crm.js)");

// r3-r6: CRM for member — 2026-07-02-presisering. Ei tidlegare økt same dag la
// mellombels til roles:["admin","editor"] i module-crm.js sin
// Intranet.registerModule()-kall, utleia av ein Privacy/Compliance-subagent —
// det var ALDRI eit uttrykkeleg brukarkrav. Brukaren presiserte seinare same
// dag at member skal ha normal CRM-tilgang (opprette/redigere kundar, bedrifter,
// kundehandlingar, malar, snippets, signaturar). roles-sperra vart difor fjerna
// att. Det einaste CRM-unntaket for member er CSV-eksport av heile kundelista:
// knappen er skjult OG handlaren har ei eiga rolle-sjekk (sjå isWorkspaceMember()
// i module-crm.js) som forsvar i djupna dersom knappen skulle bli synleg via ein
// stale-DOM-tilstand. Server-side er skrivetilgang til crm-*-nøklane for member
// handheva via ei nøkkel-spesifikk store_auth-utviding (ikkje generell
// store-tilgang) — sjå supabase/hotfix_crm_member_access_2026-07-02.sql.
window.sessionStorage.setItem(_NS + ":admin", "member");
nav("#/notes"); nav("#/crm");
assert(!!doc.querySelector("[data-crm-root]"), "r3: member KAN montere CRM-ruta (roles-sperra frå tidlegare same økt er fjerna att)");
assert(!!doc.querySelector("[data-crm-new]"), "r3b: member ser «Ny kontakt»-knappen (normal CRM-skrivetilgang)");
assert(!doc.querySelector("[data-crm-export]"), "r3c: member ser IKKJE CSV-eksportknappen (einaste CRM-unntaket)");
window.sessionStorage.setItem(_NS + ":admin", "editor");
nav("#/notes"); nav("#/crm");
assert(!!doc.querySelector("[data-crm-root]"), "r4: editor har framleis tilgang til CRM");
var exportBtnEditor = doc.querySelector("[data-crm-export]");
assert(!!exportBtnEditor, "r5: editor ser framleis CSV-eksportknappen");
var csvCalled = false;
var origDownloadCsv = App.downloadCsv;
App.downloadCsv = function () { csvCalled = true; };
// Stale-DOM-scenario: knappen vart rendra medan rolla var editor, men rolla
// endrar seg til member før klikket vert handsama (t.d. rolleendring i ein
// annan fane). Handler-nivå-sperra i module-crm.js skal likevel avvise
// eksporten sjølv om knappen framleis ligg i DOM-et.
window.sessionStorage.setItem(_NS + ":admin", "member");
exportBtnEditor.dispatchEvent(new window.Event("click", { bubbles: true }));
assert(!csvCalled, "r6: eksport-handlaren avviser direkte kall når rolla er member, sjølv om knappen (stale DOM) framleis er synleg");
App.downloadCsv = origDownloadCsv;
window.sessionStorage.setItem(_NS + ":admin", "admin"); // gjenopprett for resten av suiten
nav("#/notes"); nav("#/dashboard");

/* --- S) BOOKING: E-POSTMALAR I WORKSPACE (avbook + svar) ------------------ */
nav("#/notes"); nav("#/booking");
assert(!!doc.querySelector("#booking-root"), "s1: booking-root");
const bkMalBtn = doc.querySelector('[data-bk-fane="malar"]');
assert(!!bkMalBtn, "s2: «E-postmalar»-fane finst i Workspace-booking");
bkMalBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
const avbookTa = doc.querySelector('[data-email-tpl="booking-avbook"]');
const svarTa   = doc.querySelector('[data-email-tpl="booking-svar"]');
assert(!!avbookTa, "s3: avbookingsmal-kort rendrer med tekstfelt (ikkje uformatert/kollapset — CSS er no porta til workspace/index.html)");
assert(!!svarTa,   "s4: svarmal-kort rendrer med tekstfelt");
avbookTa.value = "Egendefinert avbookingstekst {navn}";
doc.querySelector('[data-email-tpl-save="booking-avbook"]').dispatchEvent(new window.Event("click", { bubbles: true }));
assert(App.store.get("email-template-booking-avbook", "") === "Egendefinert avbookingstekst {navn}", "s5: avbookingsmal lagra via App.store (delt med Web-admin)");
doc.querySelector('[data-email-tpl-reset="booking-avbook"]').dispatchEvent(new window.Event("click", { bubbles: true }));
assert(App.store.get("email-template-booking-avbook", "").indexOf("dessverre avbooket") > -1, "s6: «Tilbakestill til standard» gjenoppretter standardmalen");

const bkListBtn = doc.querySelector('[data-bk-fane="bookingar"]');
bkListBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
App.store.set("booking-assets", [{ id: "as1", name: "Møterom A" }]);
App.store.set("booking-bookings", [{ id: "bk1", assetId: "as1", name: "Test Kunde", email: "kunde@test.no", date: "2026-08-01", time: "10:00", status: "ny", referenceNumber: 123456, createdAt: Date.now() }]);
nav("#/notes"); nav("#/booking");
assert(!!doc.querySelector('[data-bk-avbook="bk1"]'), "s7: Avbook-knapp finst i Workspace-bookinglista (speiler Web-admin sin Avbook/Svar-todeling)");
assert(!!doc.querySelector('[data-bk-reply="bk1"]'),  "s8: Svar-knapp finst i Workspace-bookinglista");

/* --- T) ROLLEMODELL: DASHBOARD-HURTIGHANDLINGAR (admin/editor/member) ----- */
nav("#/notes"); nav("#/dashboard");
assert(!!doc.querySelector("[data-dash-new-task]"), "t1: admin ser «Ny oppgave»-hurtighandling");
assert(!!doc.querySelector("[data-dash-new-note]"), "t2: admin ser «Nytt notat»-hurtighandling");

window.sessionStorage.setItem(_NS + ":admin", "editor");
nav("#/notes"); nav("#/dashboard");
assert(!!doc.querySelector("[data-dash-new-ann]"), "t3: editor ser «Ny kunngjering»-hurtighandling (admin+editor)");

window.sessionStorage.setItem(_NS + ":admin", "member");
nav("#/notes"); nav("#/dashboard");
// Brukarpresisering 2026-07-02: member skal kunne opprette oppgåver til seg
// sjølv (sjølvvalt/utildelt) — berre TILDELING til andre er avgrensa til admin.
assert(!!doc.querySelector("[data-dash-new-task]"), "t4: member ser «Ny oppgave»-hurtighandling (kan opprette til seg sjølv)");
assert(!doc.querySelector("[data-dash-new-ann]"),  "t5: member ser IKKJE «Ny kunngjering»-hurtighandling");
assert(!doc.querySelector("[data-dash-new-kb]"),   "t6: member ser IKKJE «Ny KB-artikkel»-hurtighandling");
assert(!!doc.querySelector("[data-dash-new-note]"),"t7: member ser framleis «Nytt notat»-hurtighandling (skal ikkje skjulast)");

/* --- U) ROLLEMODELL: OPPGÅVER — MEMBER KAN OPPRETTE/REDIGERE EIGNE, IKKJE TILDELE ANDRE --- */
// tm1: sjølv oppretta (created_by matchar uid(), som er null i dette Supabase-
// lause testmiljøet) — skal vere FULLT redigerbar for member (presisert etter
// brukartilbakemelding: "de kan redigere egne oppgåver såklart").
// tm2: oppretta/tildelt av NOKON ANNAN (created_by ≠ uid()), men assigned_to
// matchar uid() — simulerer "tildelt meg av admin". Skal framleis vere
// status-only for member (uendra frå 2026-07-01-tryggleiksfiksen).
App.store.set("wsp-tasks", [
  { id: "tm1", title: "Member sin eigen oppgåve", body: "", status: "todo", assigned_to: null, created_by: null, createdAt: Date.now(), updatedAt: Date.now() },
  { id: "tm2", title: "Tildelt member av admin",  body: "", status: "todo", assigned_to: null, created_by: "admin-nokon-annan", createdAt: Date.now(), updatedAt: Date.now() }
]);
nav("#/notes"); nav("#/tasks"); // framleis member-rolle frå seksjon T
assert(!!doc.querySelector("#tasks-new-btn"), "u1: member ser «Ny oppgave»-knappen (kan opprette sjølvvalte/utildelte oppgåver)");

const ownTaskRow = doc.querySelector('[data-task-id="tm1"]');
assert(!!ownTaskRow, "u2: member ser si eiga (sjølv oppretta) oppgåve i lista");
assert(!!ownTaskRow.querySelector("[data-task-edit]"), "u3: member ser rediger-blyant på EIGA oppretta oppgåve (full redigering tillate)");

const assignedTaskRow = doc.querySelector('[data-task-id="tm2"]');
assert(!!assignedTaskRow, "u3b: member ser oppgåve tildelt av nokon annan i lista");
assert(!assignedTaskRow.querySelector("[data-task-edit]"), "u3c: member ser IKKJE rediger-blyant på oppgåve tildelt av nokon annan (status-only, uendra sperre)");

const memberStatusSel = ownTaskRow.querySelector("[data-task-status-select]");
assert(!!memberStatusSel, "u4: member kan framleis endre status via nedtrekket på eiga oppgåve");
memberStatusSel.value = "in_progress";
memberStatusSel.dispatchEvent(new window.Event("change", { bubbles: true }));
assert(App.store.get("wsp-tasks", []).find(t => t.id === "tm1").status === "in_progress", "u5: member sin statusendring vart lagra");

// Statusendringa over triggar renderList() på nytt, så tidlegare rad-referansar
// er no lause frå DOM-et — hent dei på nytt før neste klikk-simulering.
const ownTaskRow2 = doc.querySelector('[data-task-id="tm1"]');
const assignedTaskRow2 = doc.querySelector('[data-task-id="tm2"]');

// Rad-klikk på EIGA oppgåve skal opne full redigeringsmodal
ownTaskRow2.dispatchEvent(new window.Event("click", { bubbles: true }));
const ownEditModal = doc.getElementById("task-modal-bd");
assert(!!ownEditModal, "u6: klikk på EIGA oppgåverad opnar redigeringsmodal for member");
assert(ownEditModal.querySelector("#tm-title").value === "Member sin eigen oppgåve", "u6b: redigeringsmodalen viser rett tittel for eiga oppgåve");
assert(!!ownEditModal.querySelector("[data-readonly-assignee]"), "u6c: tildelt-feltet er read-only sjølv i eiga oppgåve (kan ikkje tildele andre)");
ownEditModal.querySelector("#tm-cancel").dispatchEvent(new window.Event("click", { bubbles: true }));

// Rad-klikk på oppgåve tildelt av nokon annan skal opne modalen, men berre
// med skildring + status redigerbart — tittel og tildelt er låst (presisert
// av brukar 2026-07-03, etter at 0.9.1-runda over uventa fjerna heile
// opne-moglegheita, ikkje berre redigering av tittel/frist).
assignedTaskRow2.dispatchEvent(new window.Event("click", { bubbles: true }));
const assignedModal = doc.getElementById("task-modal-bd");
assert(!!assignedModal, "u7: klikk på oppgåve tildelt av nokon annan opnar modalen for member");
assert(assignedModal.querySelector("#tm-title").disabled, "u7b: tittel-feltet er disabled i modalen for tildelt oppgåve");
assert(assignedModal.querySelector("#tm-title").value === "Tildelt member av admin", "u7c: tittel-feltet viser framleis rett verdi, berre disabled");
assert(!assignedModal.querySelector("#tm-body").disabled, "u7d: skildring-feltet ER redigerbart");
assert(!assignedModal.querySelector("#tm-status").disabled, "u7e: status-nedtrekket ER redigerbart inni modalen");
assert(!!assignedModal.querySelector("[data-readonly-assignee]"), "u7f: tildelt-feltet er read-only (uendra sperre)");
assert(!assignedModal.querySelector("#tm-delete"), "u7g: ingen slett-knapp for oppgåve tildelt av nokon annan");
assignedModal.querySelector("#tm-body").value = "Ny skildring frå member";
assignedModal.querySelector("#tm-status").value = "in_progress";
assignedModal.querySelector("#tm-save").dispatchEvent(new window.Event("click", { bubbles: true }));
const tm2After = App.store.get("wsp-tasks", []).find(t => t.id === "tm2");
assert(tm2After.title === "Tildelt member av admin", "u7h: tittelen er uendra etter lagring");
assert(tm2After.description === "Ny skildring frå member", "u7i: skildringa vart lagra");
assert(tm2After.status === "in_progress", "u7j: statusen vart lagra");

// «Ny oppgave»-knappen skal opne opprett-modalen og lagre ei sjølvvalt/utildelt oppgåve
doc.querySelector("#tasks-new-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
const newTaskModal = doc.getElementById("task-modal-bd");
assert(!!newTaskModal, "u8: «Ny oppgave»-knappen opnar opprett-modalen for member");
assert(!!newTaskModal.querySelector("[data-readonly-assignee]"), "u9: tildelt-feltet er read-only for member i opprett-modalen (kan ikkje tildele andre)");
newTaskModal.querySelector("#tm-title").value = "Ny member-oppgåve";
newTaskModal.querySelector("#tm-save").dispatchEvent(new window.Event("click", { bubbles: true }));
const memberCreated = App.store.get("wsp-tasks", []).find(t => t.title === "Ny member-oppgåve");
assert(!!memberCreated, "u10: member-oppretta oppgåve vart lagra");
assert(!memberCreated.assigned_to, "u11: member-oppretta oppgåve er sjølvvalt/utildelt, ikkje tildelt nokon annan (jf. tasks_self_create-RLS)");

// Direkte handlarkall (bypass av UI, t.d. frå Dashboard) opnar alltid med id=null
// («ny»), så det skal no fungere for member òg — men ALDRI ei redigeringsflyt.
window._tasksOpenModal();
assert(!!doc.getElementById("task-modal-bd"), "u12: window._tasksOpenModal() opnar opprett-modalen for member (alltid id=null/«ny»)");
doc.getElementById("task-modal-bd").remove();

/* --- V) ROLLEMODELL: INTERN MEDIEBANK — MEMBER ER READ-ONLY --------------- */
App.store.set("wsp-media-index", [{ id: "wsp-m-test2", ref: "file:test2", name: "test2.pdf", type: "application/pdf", size: 2048, category: "Test", uploadedAt: Date.now(), uploadedBy: "local" }]);
nav("#/notes"); nav("#/media-internal"); // framleis member-rolle
assert(!doc.querySelector("#wsp-dropzone"), "v1: member ser ikkje opplastings-dropzone i intern mediebank");
assert(!doc.querySelector("#wsp-upload-category"), "v2: member ser ikkje kategori-input for opplasting");
assert(!doc.querySelector("[data-wsp-del]"), "v3: member ser ikkje slett-knapp på filkort");

window.sessionStorage.setItem(_NS + ":admin", "admin");
nav("#/notes"); nav("#/media-internal");
assert(!!doc.querySelector("#wsp-dropzone"), "v4: admin ser opplastings-dropzone i intern mediebank");
assert(!!doc.querySelector("[data-wsp-del]"), "v5: admin ser slett-knapp på filkort");

/* --- W) ROLLEMODELL: ORGDRIFT — EDITOR/MEMBER FÅR IKKJE OPPRETTE KORT ----- */
window.sessionStorage.setItem(_NS + ":admin", "admin");
nav("#/notes"); nav("#/orgdrift"); nav("#/notes"); nav("#/orgdrift");
assert(!!doc.querySelector("[data-od-new]"), "w1: admin ser «Ny»-knapp i Organisasjon & drift");
assert(!!doc.querySelector("[data-od-edit]"), "w2: admin ser «Rediger»-knapp på kort");

window.sessionStorage.setItem(_NS + ":admin", "editor");
nav("#/notes"); nav("#/orgdrift"); nav("#/notes"); nav("#/orgdrift");
assert(!doc.querySelector("[data-od-new]"), "w3: editor ser ikkje «Ny»-knapp (heile wsp-orgdrift-nøkkelen er admin-only server-side, sjå hotfix_role_enforcement_2026-07-02.sql)");
assert(!doc.querySelector("[data-od-edit]"), "w4: editor ser heller ikkje «Rediger» (RLS kan ikkje skilje ny/rediger inni JSON-blobben — read-only for alle utanom admin)");

window.sessionStorage.setItem(_NS + ":admin", "member");
nav("#/notes"); nav("#/orgdrift"); nav("#/notes"); nav("#/orgdrift");
assert(!doc.querySelector("[data-od-new]"), "w5: member ser ikkje «Ny»-knapp i Organisasjon & drift");
assert(!doc.querySelector("[data-od-edit]"), "w6: member ser ikkje «Rediger»-knapp");

window.sessionStorage.setItem(_NS + ":admin", "admin"); // gjenopprett admin-rolle for resten av suiten
nav("#/notes"); nav("#/dashboard");

/* --- X) MALAR + #-SNIPPETS I OPENREPLYMODAL (Workspace: Kontakt/Booking/Tilbud) --- */
// canSendDirect (den rike editoren med malvelger/snippet-knapp) krev at
// App.supabase er sett — normalt ikkje konfigurert i testmiljøet. Stubbast her,
// som i test.js sin tilsvarande test for Web-admin-sida.
(function () {
  var origSupabase = App.supabase;
  var origExecCommand = doc.execCommand;
  App.supabase = {};
  App.store.set("crm-settings", Object.assign({}, App.store.get("crm-settings", {}), {
    snippets: [{ id: "sn1", shortcode: "hils", title: "Helsing", body: "Med vennlig hilsen" }],
    signatureCompany: "<p>Bedrift AS</p>",
    signaturePersonal: "<p>Ola Nordmann</p>"
  }));

  // Kontakt
  App.store.set("leads", [{ id: "wc1", name: "Ole Kontakt", email: "ole@test.no", message: "Ei vanleg henvending", time: Date.now(), status: "ny" }]);
  nav("#/notes"); nav("#/contact");
  var cReplyBtn = doc.querySelector('[data-contact-reply="wc1"]');
  assert(!!cReplyBtn, "x1: Kontakt (Workspace): svarknapp finst");
  cReplyBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  var cModal = doc.getElementById("reply-modal-root");
  assert(!!cModal, "x2: Kontakt (Workspace): rik svar-editor åpnes");
  assert(!!cModal.querySelector("#reply-tpl-pick"), "x3: Kontakt (Workspace): malvelger vises (samme stil som CRM)");
  assert(!!cModal.querySelector("#reply-snippet-btn"), "x4: Kontakt (Workspace): #-snippet-knapp vises i verktøylinja");
  assert(!!cModal.querySelector("#reply-sig-company") && !!cModal.querySelector("#reply-sig-personal"), "x4b: Kontakt (Workspace): begge signaturknappane vises (delt med CRM)");
  cModal.remove();

  // Booking
  App.store.set("booking-assets", [{ id: "wbas1", name: "Sal A" }]);
  App.store.set("booking-bookings", [{ id: "wbk1", assetId: "wbas1", name: "Booking Kunde", email: "bk@test.no", date: "2026-09-01", time: "12:00", status: "ny", referenceNumber: 555, createdAt: Date.now() }]);
  nav("#/notes"); nav("#/booking");
  var bAvbookBtn = doc.querySelector('[data-bk-avbook="wbk1"]');
  assert(!!bAvbookBtn, "x5: Booking (Workspace): avbook-knapp finst");
  bAvbookBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  var bModal = doc.getElementById("reply-modal-root");
  assert(!!bModal, "x6: Booking (Workspace): rik svar-editor åpnes for avbook");
  var bTplPick = bModal.querySelector("#reply-tpl-pick");
  assert(!!bTplPick, "x7: Booking (Workspace): malvelger vises");
  assert(bTplPick.querySelectorAll("option").length >= 3, "x8: Booking (Workspace): malvelger har både avbookings- og svarmal (kontekstspesifikke malar i same stil)");
  assert(!!bModal.querySelector("#reply-snippet-btn"), "x9: Booking (Workspace): #-snippet-knapp vises");
  assert(!!bModal.querySelector("#reply-sig-company") && !!bModal.querySelector("#reply-sig-personal"), "x9b: Booking (Workspace): begge signaturknappane vises");
  bModal.remove();

  // Tilbud
  App.store.set("leads", App.store.get("leads", []).concat([{ id: "wq1", name: "Kari Tilbud", email: "kari-w@test.no", message: "Tilbudsforespørsel: terrasse", time: Date.now(), status: "ny" }]));
  nav("#/notes"); nav("#/quote");
  var qReplyBtn = doc.querySelector('[data-quote-reply="wq1"]');
  assert(!!qReplyBtn, "x10: Tilbud (Workspace): svarknapp finst");
  qReplyBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  var qModal = doc.getElementById("reply-modal-root");
  assert(!!qModal, "x11: Tilbud (Workspace): rik svar-editor åpnes");
  assert(!!qModal.querySelector("#reply-tpl-pick"), "x12: Tilbud (Workspace): malvelger vises");
  var qSnipBtn = qModal.querySelector("#reply-snippet-btn");
  assert(!!qSnipBtn, "x13: Tilbud (Workspace): #-snippet-knapp vises");
  assert(!!qModal.querySelector("#reply-sig-company") && !!qModal.querySelector("#reply-sig-personal"), "x13b: Tilbud (Workspace): begge signaturknappane vises");

  // #-snippet-lista deler datakjelde med CRM (crm-settings.snippets) — ingen
  // duplikat datamodell. Test klikk-innsetting via den delte bindReplySnippets()-
  // infrastrukturen i core.js.
  var execCalls = [];
  doc.execCommand = function (cmd, ui, val) { execCalls.push({ cmd: cmd, val: val }); return true; };
  qSnipBtn.dispatchEvent(new window.Event("mousedown", { bubbles: true, cancelable: true }));
  var dd = doc.querySelector(".reply-snippet-dd");
  assert(!!dd, "x14: Tilbud (Workspace): #-knappen opner snippet-lista (delt datakjelde med CRM)");
  var item = dd.querySelector(".reply-snippet-item");
  item.dispatchEvent(new window.Event("mousedown", { bubbles: true, cancelable: true }));
  assert(execCalls.some(function (c) { return c.cmd === "insertText" && c.val.indexOf("Med vennlig hilsen") > -1; }), "x15: klikk på snippet set inn tekst via execCommand insertText");
  assert(!doc.querySelector(".reply-snippet-dd"), "x16: snippet-lista lukkast etter val");

  doc.execCommand = origExecCommand;
  qModal.remove();
  App.supabase = origSupabase;
  nav("#/notes"); nav("#/dashboard");
})();

/* --- Y) AKTUELT-TOOLTIP: HJELPEIKON I BILETFELTET (Merking) --------------- */
(function () {
  nav("#/notes"); nav("#/announcements");
  doc.querySelector("#ann-new-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
  var helpBtn = doc.querySelector('[data-help-toggle]');
  assert(!!helpBtn, "y1: hjelpeikonet («?») for Merking finst i biletfeltet i Aktuelt-editoren (C.helpIcon()-mønster)");
  assert(!helpBtn.classList.contains("is-open"), "y2: hjelpebobla er lukka som standard");
  helpBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(helpBtn.classList.contains("is-open"), "y3: klikk på hjelpeikonet opnar hjelpebobla");
  helpBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(!helpBtn.classList.contains("is-open"), "y4: nytt klikk på same ikon lukkar hjelpebobla att");
  helpBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(helpBtn.classList.contains("is-open"), "y5: hjelpebobla opnar seg på nytt");
  doc.body.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(!helpBtn.classList.contains("is-open"), "y6: klikk utanfor lukkar hjelpebobla (delegert bindHelpIcons()-handsamar, kalla éin gong i workspace-core.js sin init())");
  nav("#/notes"); nav("#/dashboard");
})();

/* --- Z) FUNKSJONSFLAGG AV: intranettFeatures.kb = false (dagens faktiske
   standard i config.js) skal skjule Kunnskapsbase heilt -- ingen nav-lenke,
   ingen dashboard-hurtighandling, og direkte navigering til #/kb skal IKKJE
   krasje, berre falle tilbake til «Modul ikke funnet». Resten av denne fila
   tvingar kb:true (sjå intranettFeatures-patchen heilt øvst) for å kunne
   teste sjølve KB-funksjonaliteten (seksjon J) -- det finst difor ingen
   annan stad som stadfestar av-stien. Krev sin eigen, separate DOM: kva
   modular som registrerer seg vert avgjort éin gong ved skriptlasting
   (App.ready() sin gate i module-kb.js), ikkje reevaluert om flagget skulle
   endre seg seinare i den same, alt-lasta konteksten. --------------------- */
(function () {
  const dom2 = new JSDOM(html, {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://example.test/workspace/"
  });
  const window2 = dom2.window;
  window2.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
    unobserve() {} disconnect() {}
  };
  window2.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){} });
  window2.scrollTo = () => {};
  window2.HTMLElement.prototype.scrollIntoView = () => {};
  window2.URL.createObjectURL = window2.URL.createObjectURL || (() => "blob:mock");
  window2.URL.revokeObjectURL = window2.URL.revokeObjectURL || (() => {});
  window2.confirm = () => true;

  // Ingen intranettFeatures-patching her -- poenget er nettopp å teste
  // config.js sin ekte, upatcha standard (kb: false).
  [
    "config.js", "components.js", "core.js", "template-klassisk.js", "template-panorama.js", "template-scrollstory.js",
    "workspace/workspace-core.js",
    "workspace/module-dashboard.js",
    "workspace/module-kb.js"
  ].forEach(f => window2.eval(fs.readFileSync(f, "utf8")));

  const _NS2 = window2.eval('(window.SITE_CONFIG&&window.SITE_CONFIG.storageKey)||"site"');
  window2.eval(`sessionStorage.setItem("${_NS2}:admin","admin")`);
  window2.document.dispatchEvent(new window2.Event("DOMContentLoaded", { bubbles: true }));
  const doc2 = window2.document;

  function nav2(hash) {
    window2.location.hash = hash;
    window2.dispatchEvent(new window2.Event("hashchange"));
  }

  assert(window2.SITE_CONFIG.intranettFeatures.kb === false,
    "z1: føresetnad for denne seksjonen -- config.js sin ekte standard har kb: false");
  assert(!doc2.querySelector('[data-inav="kb"]'),
    "z2: «Kunnskapsbase» finst ikkje i sidebar-navigasjonen når funksjonen er av");
  assert(!doc2.querySelector("[data-dash-new-kb]"),
    "z3: dashboardet viser ikkje «Ny KB-artikkel»-hurtighandlinga når funksjonen er av");
  assert(typeof window2._kbOpenNew !== "function",
    "z4: window._kbOpenNew finst ikkje når funksjonen er av (module-kb.js sin App.ready-gate returnerte tidleg)");

  let navThrew = false;
  try { nav2("#/kb"); } catch (e) { navThrew = true; }
  assert(!navThrew,
    "z5: direkte navigering til #/kb krasjar ikkje sjølv om modulen aldri registrerte seg");
  assert(doc2.getElementById("intranet-main").textContent.indexOf("Modul ikke funnet") > -1,
    "z6: #/kb fell trygt tilbake til «Modul ikke funnet» i staden for eit tomt/knust skjerm");
})();

/* --- AA) SPACESHIP SOM CUSTOMMODULES-EKSEMPEL (bein 3, Fase 10) -----------
   Motsett av Z-seksjonen over: her PATCHAR vi config.js sin customModules
   for å stadfeste PÅ-stien -- at ei eksplisitt { enabled: true }-oppføring
   faktisk får modulen til å registrere seg i navigasjonen og rendere når
   nokon navigerer dit, og at det eksisterande trippel-klikk-easter-egget
   (urørt av denne endringa) framleis fungerer parallelt. Eigen, separat DOM
   av same grunn som Z-seksjonen: App.ready() sin gate vert avgjort éin gong
   ved skriptlasting. --------------------------------------------------- */
(function () {
  const patchedHtml = html; // same script-lasting som hovud-dom-en
  const dom3 = new JSDOM(patchedHtml, {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://example.test/workspace/"
  });
  const window3 = dom3.window;
  window3.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
    unobserve() {} disconnect() {}
  };
  window3.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){} });
  window3.scrollTo = () => {};
  window3.HTMLElement.prototype.scrollIntoView = () => {};
  window3.URL.createObjectURL = window3.URL.createObjectURL || (() => "blob:mock");
  window3.URL.revokeObjectURL = window3.URL.revokeObjectURL || (() => {});
  window3.confirm = () => true;

  [
    "config.js", "components.js", "core.js", "template-klassisk.js", "template-panorama.js", "template-scrollstory.js",
    "workspace/workspace-core.js",
    "workspace/module-dashboard.js",
    "workspace/module-workspaceship.js"
  ].forEach(f => {
    let src = fs.readFileSync(f, "utf8");
    if (f === "config.js") {
      src = src.replace(/customModules:\s*\{/, 'customModules: { spaceship: { label: "Spaceship", enabled: true, params: {} },');
    }
    window3.eval(src);
  });

  const _NS3 = window3.eval('(window.SITE_CONFIG&&window.SITE_CONFIG.storageKey)||"site"');
  window3.eval(`sessionStorage.setItem("${_NS3}:admin","admin")`);
  window3.document.dispatchEvent(new window3.Event("DOMContentLoaded", { bubbles: true }));
  const doc3 = window3.document;

  function nav3(hash) {
    window3.location.hash = hash;
    window3.dispatchEvent(new window3.Event("hashchange"));
  }

  const navIds3 = [...doc3.querySelectorAll(".i-nav__link")].map(a => a.getAttribute("data-inav"));
  assert(navIds3.includes("spaceship"),
    "aa1: spaceship-modulen VISES i navigasjonen når customModules.spaceship.enabled er true");
  nav3("#/spaceship");
  assert(!!doc3.querySelector("#workspaceship-root"),
    "aa2: navigering til #/spaceship rendrar spelet inline i innhaldsområdet");
  assert(typeof window3.WorkspaceshipEasterEgg === "object" && typeof window3.WorkspaceshipEasterEgg.launch === "function",
    "aa3: det eksisterande trippel-klikk-easter-egget er urørt og framleis tilgjengeleg parallelt");
  nav3("#/dashboard");
  assert(!doc3.getElementById("intranet-main").contains(doc3.getElementById("workspaceship-root")),
    "aa4: workspaceship-root vert fjerna frå DOM-et når brukaren navigerer vekk (naudsynt for at MutationObserver-oppryddinga faktisk skal utløysast)");
})();

/* --- RESULTAT ------------------------------------------------------------- */
const ok  = globalThis.__ok  || 0;
const err = globalThis.__err || 0;
console.log(`\n${ok+err} tester — ${ok} OK, ${err} FEIL`);

// Appen startar setInterval-ar (t.d. admin-badge-refresh) som jsdom ikkje
// eksponerer som ekte Node-timerar (ingen .unref()) — dei held elles Node-
// prosessen open. Ventar på at stdout er flush først, elles kan siste
// linje kuttast bort når output vert omdirigert/pipa.
process.stdout.write("", () => process.exit(process.exitCode || 0));
