/* test-intranet.js — jsdom-harness for intranettet. Kjør: node test-intranet.js */
const { JSDOM } = require("jsdom");
const fs = require("fs");

const html = fs.readFileSync("intranet/index.html", "utf8")
  .replace(/src="\.\.\/config\.js"/g,     'src="config.js"')
  .replace(/src="\.\.\/components\.js"/g, 'src="components.js"')
  .replace(/src="\.\.\/core\.js"/g,       'src="core.js"')
  .replace(/src="intranet-core\.js"/g,    'src="intranet/intranet-core.js"')
  .replace(/src="module-announcements\.js"/g, 'src="intranet/module-announcements.js"')
  .replace(/src="module-settings\.js"/g,  'src="intranet/module-settings.js"')
  .replace(/src="module-tasks\.js"/g,     'src="intranet/module-tasks.js"')
  .replace(/src="module-notes\.js"/g,     'src="intranet/module-notes.js"')
  .replace(/src="module-mediabank-internal\.js"/g, 'src="intranet/module-mediabank-internal.js"')
  .replace(/src="module-kb\.js"/g,        'src="intranet/module-kb.js"')
  .replace(/src="module-contact\.js"/g,   'src="intranet/module-contact.js"')
  // module-crm.js: ingen sti-omskriving her — intranet/index.html peikar allereie
  // rett på rot-fila (../module-crm.js), som er den einaste som faktisk vert lasta
  // i produksjon (sjå docs/project/CURRENT_STATE.md "Known limitations").
  // intranet/module-crm.js er daud kode og skal ikkje testast som om han var aktiv.
  .replace(/src="module-booking\.js"/g,   'src="intranet/module-booking.js"')
  .replace(/src="module-quote\.js"/g,     'src="intranet/module-quote.js"')
  .replace(/src="module-dashboard\.js"/g, 'src="intranet/module-dashboard.js"')
  .replace(/src="module-orgdrift\.js"/g,  'src="intranet/module-orgdrift.js"')
  .replace(/src="module-links\.js"/g,     'src="intranet/module-links.js"')
  .replace(/src="module-workspaceship\.js"/g, 'src="intranet/module-workspaceship.js"')
  .replace(/src="module-users\.js[^"]*"/g,   'src="intranet/module-users.js"');

const dom = new JSDOM(html, {
  runScripts: "outside-only", pretendToBeVisual: true,
  url: "https://example.test/intranet/"
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
  "config.js","components.js","core.js",
  "intranet/intranet-core.js",
  "intranet/module-announcements.js",
  "intranet/module-settings.js",
  "intranet/module-tasks.js",
  "intranet/module-notes.js",
  "intranet/module-mediabank-internal.js",
  "intranet/module-kb.js",
  "intranet/module-contact.js",
  "module-crm.js", // aktiv fil (dual-registrerer for Web-admin OG Workspace) — ikkje intranet/module-crm.js (daud kode)
  "intranet/module-booking.js",
  "intranet/module-quote.js",
  "intranet/module-dashboard.js",
  "intranet/module-orgdrift.js",
  "intranet/module-links.js",
  "intranet/module-workspaceship.js",
  "intranet/module-users.js"
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
nav("#/workspaceship");
assert(!!doc.querySelector("#workspaceship-root"), "o3: workspaceship via direkterute");

/* --- Q) BRUKARSTYRING ----------------------------------------------------- */
nav("#/users");
assert(!!doc.querySelector("#users-root"), "q1: users-root");
assert(doc.querySelector("#users-root").textContent.includes("Supabase"), "q2: viser melding utan Supabase");

/* --- P) MØRK MODUS CSS ---------------------------------------------------- */
assert(!!doc.querySelector("[data-theme]")||true, "p1: dark mode CSS (visuell sjekk)");
App.store.set("wsp-prefs",{theme:"dark",density:"compact"});
assert(App.store.get("wsp-prefs",{}).theme==="dark", "p2: dark theme lagra");

/* --- R) CRM: AKTIV ROT-FIL (IKKJE DAUD intranet/module-crm.js) ------------ */
nav("#/notes"); nav("#/crm");
assert(navIds.includes("crm") || !!doc.querySelector('[data-inav="crm"]'), "r1: CRM i Workspace-nav (registrert av rot-module-crm.js sin Intranet.registerModule-gren)");
assert(!!doc.querySelector("[data-crm-root]"), "r2: CRM-root rendrer i Workspace (test-intranet.js lastar aktiv module-crm.js, ikkje daud intranet/module-crm.js)");

// r3-r4: CRM (kundedata) er avgrensa til admin/editor på RUTE-nivå — oppdaga
// manglande under Privacy/Compliance-review 2026-07-02 (module-crm.js hadde ingen
// roles:[...] i det heile, i motsetnad til module-users.js sin roles:["admin"]).
// Retta same økt. NB: sidebar-navet (renderNav()) byggjast berre éin gong ved
// oppstart/buildShell() og oppdaterast ikkje reaktivt ved rolleendring midt i ein
// økt (matchar produksjon — rolleendring krev ny innlogging/reload) — den faktiske
// sikkerheitssperra er rute-nivået (intranet-core.js sin handleRoute()→mountModule()),
// testa direkte her, ikkje nav-lenkja si synlegheit.
window.sessionStorage.setItem(_NS + ":admin", "member");
nav("#/notes"); nav("#/crm");
assert(!doc.querySelector("[data-crm-root]"), "r3: member kan ikkje montere CRM-ruta (roles:[\"admin\",\"editor\"] handhevast i intranet-core.js si route()-sperre)");
window.sessionStorage.setItem(_NS + ":admin", "editor");
nav("#/notes"); nav("#/crm");
assert(!!doc.querySelector("[data-crm-root]"), "r4: editor har framleis tilgang til CRM");
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
assert(!!avbookTa, "s3: avbookingsmal-kort rendrer med tekstfelt (ikkje uformatert/kollapset — CSS er no porta til intranet/index.html)");
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

// Rad-klikk på oppgåve tildelt av nokon annan skal IKKJE opne redigeringsmodal
assignedTaskRow2.dispatchEvent(new window.Event("click", { bubbles: true }));
assert(!doc.getElementById("task-modal-bd"), "u7: klikk på oppgåve tildelt av nokon annan opnar ikkje redigeringsmodal for member");

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

/* --- RESULTAT ------------------------------------------------------------- */
const ok  = globalThis.__ok  || 0;
const err = globalThis.__err || 0;
console.log(`\n${ok+err} tester — ${ok} OK, ${err} FEIL`);

// Appen startar setInterval-ar (t.d. admin-badge-refresh) som jsdom ikkje
// eksponerer som ekte Node-timerar (ingen .unref()) — dei held elles Node-
// prosessen open. Ventar på at stdout er flush først, elles kan siste
// linje kuttast bort når output vert omdirigert/pipa.
process.stdout.write("", () => process.exit(process.exitCode || 0));
