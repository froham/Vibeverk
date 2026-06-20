/* =============================================================================
   test-intranet.js  —  jsdom-harness for intranettet
   Kjør: node test-intranet.js
   ========================================================================== */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "intranet/index.html"), "utf8");

const patchedHtml = html
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
  .replace(/src="module-crm\.js"/g,       'src="intranet/module-crm.js"')
  .replace(/src="module-booking\.js"/g,   'src="intranet/module-booking.js"')
  .replace(/src="module-quote\.js"/g,     'src="intranet/module-quote.js"')
  .replace(/src="module-dashboard\.js"/g, 'src="intranet/module-dashboard.js"')
  .replace(/src="module-workspaceship\.js"/g, 'src="intranet/module-workspaceship.js"');

const dom = new JSDOM(patchedHtml, {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "https://example.test/intranet/"
});
const { window } = dom;

window.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
  unobserve() {} disconnect() {}
};
window.matchMedia = window.matchMedia || function () {
  return { matches: false, addEventListener(){}, removeEventListener(){} };
};
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.URL.createObjectURL = window.URL.createObjectURL || (() => "blob:mock-url");
window.URL.revokeObjectURL = window.URL.revokeObjectURL || (() => {});
window.confirm = () => true;

// Last filer
[
  "config.js", "components.js", "core.js",
  "intranet/intranet-core.js",
  "intranet/module-announcements.js",
  "intranet/module-settings.js",
  "intranet/module-tasks.js",
  "intranet/module-notes.js",
  "intranet/module-mediabank-internal.js",
  "intranet/module-kb.js",
  "intranet/module-links.js",
  "intranet/module-orgdrift.js",
  "intranet/module-contact.js",
  "intranet/module-crm.js",
  "intranet/module-booking.js",
  "intranet/module-quote.js",
  "intranet/module-dashboard.js",
  "intranet/module-workspaceship.js"
].forEach(f => { window.eval(fs.readFileSync(f, "utf8")); });

// Sett owner-auth via window.eval (same jsdom-kontekst som modulane)
const _NS = window.eval('(window.SITE_CONFIG && window.SITE_CONFIG.storageKey) || "site"');
window.eval(`sessionStorage.setItem("${_NS}:intranet-auth", "owner")`);

window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

const doc = window.document;
const App = window.App;
const Intranet = window.Intranet;

const assert = (cond, msg) => {
  if (!cond) {
    globalThis.__err = (globalThis.__err || 0) + 1;
    console.error("FEIL:", msg);
    process.exitCode = 1;
  } else {
    globalThis.__ok = (globalThis.__ok || 0) + 1;
    console.log("OK:", msg);
  }
};

/* --- A) SHELL ------------------------------------------------------------ */
assert(!!doc.getElementById("intranet"), "a1: #intranet rot finnes");
assert(!doc.getElementById("app"),       "a2: #app finnes IKKE");
assert(!!doc.getElementById("intranet-nav"),  "a3: sidebar-nav rendret");
assert(!!doc.getElementById("intranet-main"), "a4: content-outlet rendret");

/* --- B) REGISTER OG NAV -------------------------------------------------- */
assert(typeof Intranet === "object" && typeof Intranet.registerModule === "function",
  "b1: window.Intranet eksponert");
const navIds = [...doc.querySelectorAll(".i-nav__link")].map(a => a.getAttribute("data-inav"));
assert(navIds.includes("dashboard"), "b2: dashboard i nav");
assert(navIds.includes("tasks"),     "b3: tasks i nav");
assert(navIds.includes("settings"),  "b4: settings i nav");
assert(navIds.indexOf("dashboard") < navIds.indexOf("tasks"),   "b5: dashboard før tasks");
assert(navIds.indexOf("tasks")     < navIds.indexOf("settings"), "b6: tasks før settings");

/* --- C) INGEN OFFENTLIG INNHOLD ------------------------------------------ */
assert(!doc.querySelector(".site-header"), "c1: ingen offentlig site-header");
assert(!doc.querySelector(".site-footer"), "c2: ingen offentlig site-footer");
assert(!doc.getElementById("hjem"),        "c3: ingen #hjem-seksjon");

/* --- D) ROUTING ----------------------------------------------------------- */
const activeLink = doc.querySelector(".i-nav__link.is-active");
assert(activeLink && activeLink.getAttribute("data-inav") === "dashboard", "d1: dashboard aktiv ved oppstart");
window.location.hash = "#/tasks";
window.dispatchEvent(new window.Event("hashchange"));
assert(doc.querySelector(".i-nav__link.is-active")?.getAttribute("data-inav") === "tasks", "d2: tasks aktiv");
assert(!!doc.querySelector("#tasks-root"),       "d3: tasks-root rendret");
assert(!!doc.querySelector("#tasks-quick-form"), "d4: hurtig-opprett form rendret");

/* --- E) TASKS CRUD -------------------------------------------------------- */
doc.querySelector("#tasks-quick-input").value = "Testoppgave 1";
doc.querySelector("#tasks-quick-form").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
const tasks1 = App.store.get("wsp-tasks", []);
assert(tasks1.length === 1,              "e1: én oppgave lagret");
assert(tasks1[0].title === "Testoppgave 1", "e2: tittel korrekt");
assert(tasks1[0].status === "todo",         "e3: status=todo");

doc.querySelector("#tasks-quick-input").value = "Testoppgave 2";
doc.querySelector("#tasks-quick-form").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
assert(App.store.get("wsp-tasks", []).length === 2, "e4: to oppgaver");

window.location.hash = "#/settings"; window.dispatchEvent(new window.Event("hashchange"));
window.location.hash = "#/tasks";    window.dispatchEvent(new window.Event("hashchange"));
const statusBtn = doc.querySelector("[data-task-status]");
assert(!!statusBtn, "e5: statusknapp finnes");
statusBtn.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
assert(App.store.get("wsp-tasks", []).some(t => t.status !== "todo"), "e6: status endret");

/* --- F) AKTIVITETSLOGG ---------------------------------------------------- */
const act = App.store.get("wsp-activity", []);
assert(act.length > 0,                  "f1: aktivitetslogg har poster");
assert(act[0].ts > 0,                   "f2: ts er satt");
assert(typeof act[0].label === "string", "f3: label er streng");

/* --- G) SETTINGS ---------------------------------------------------------- */
window.location.hash = "#/settings"; window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#settings-root"),  "g1: settings-root rendret");
assert(!!doc.querySelector("#settings-form"),  "g2: settings-form finnes");
assert(!!doc.querySelector("#settings-reset"), "g3: reset-knapp finnes");
doc.querySelector("#settings-name").value = "Testbedriften AS";
doc.querySelector("#settings-form").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
assert(App.store.get("wsp-settings", {}).tenantName === "Testbedriften AS", "g4: tenantName lagret");
doc.querySelector("#settings-reset").click();
assert(!App.store.get("wsp-tasks"),    "g5: wsp-tasks nullstilt");
assert(!App.store.get("wsp-settings"), "g6: wsp-settings nullstilt");
assert(!App.store.get("wsp-activity"), "g7: wsp-activity nullstilt");

/* --- H) DASHBOARD --------------------------------------------------------- */
App.store.set("wsp-tasks", [
  { id: "t1", title: "A", status: "todo",        createdAt: Date.now(), updatedAt: Date.now() },
  { id: "t2", title: "B", status: "in_progress", createdAt: Date.now(), updatedAt: Date.now() }
]);
Intranet.logActivity({ type: "task_created", label: "Seeded" });
window.location.hash = "#/settings"; window.dispatchEvent(new window.Event("hashchange"));
window.location.hash = "#/dashboard"; window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#dashboard-root"), "h1: dashboard-root rendret");
assert(doc.querySelector("#dashboard-root").textContent.includes("Å gjøre"), "h2: dashboard viser statuskategorier");
assert(typeof App.store.get === "function",           "h3: App.store.get tilgjengelig");
assert(typeof App.store.set === "function",           "h4: App.store.set tilgjengelig");
assert(typeof App.media.resolveImage === "function",  "h5: App.media tilgjengelig");

/* --- I) NOTES ------------------------------------------------------------- */
window.location.hash = "#/notes"; window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#notes-root"),    "i-n1: notes-root rendret");
assert(!!doc.querySelector("#notes-new-btn"), "i-n2: nytt-notat-knapp finnes");
doc.querySelector("#notes-new-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
const notes1 = App.store.get("wsp-notes", []);
assert(notes1.length === 1,              "i-n3: notat opprettet");
assert(notes1[0].title === "Nytt notat", "i-n4: standardtittel korrekt");
assert(Array.isArray(notes1[0].tags),    "i-n5: tags er array");
assert("summary" in notes1[0],           "i-n6: summary-felt finnes");
assert(notes1[0].createdAt > 0,          "i-n7: timestamp satt");

/* --- I-K) KUNNSKAPSBASE --------------------------------------------------- */
window.location.hash = "#/notes"; window.dispatchEvent(new window.Event("hashchange"));
window.location.hash = "#/kb";    window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#kb-root"),    "ik1: kb-root rendret");
assert(!!doc.querySelector("#kb-new-btn"), "ik2: ny-artikkel-knapp synlig (owner)");

doc.querySelector("#kb-new-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
const kbEd = doc.querySelector("#kb-editor-area");
assert(!!kbEd && !!kbEd.querySelector("#kb-title"), "ik3: editor opna");
kbEd.querySelector("#kb-title").value = "Testartikkel";
kbEd.querySelector("#kb-category").value = "Rutinar";
kbEd.querySelector("#kb-official").checked = true;
kbEd.querySelector("#kb-save-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
const kbItems = App.store.get("wsp-kb", []);
assert(kbItems.length === 1,               "ik4: artikkel lagret");
assert(kbItems[0].title === "Testartikkel", "ik5: tittel korrekt");
assert(kbItems[0].category === "Rutinar",  "ik6: kategori korrekt");
assert(kbItems[0].official === true,       "ik7: offisiell-flagg satt");
assert(Array.isArray(kbItems[0].tags),     "ik8: tags er array");
assert("summary" in kbItems[0],            "ik9: summary-felt finnes");

/* --- I-M) INTERN MEDIEBANK ------------------------------------------------ */
window.location.hash = "#/media-internal"; window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#wsp-media-root"), "im1: media-root rendret");
assert(!!doc.querySelector("#wsp-dropzone"),   "im2: dropzone finnes");
assert(!!doc.querySelector("#wsp-file-input"), "im3: filinput finnes");
App.store.set("wsp-media-index", [{ id:"wsp-m-test", ref:"file:test", name:"test.pdf", type:"application/pdf", size:1024, category:"Tester", uploadedAt:Date.now(), uploadedBy:"local" }]);
window.location.hash = "#/notes";         window.dispatchEvent(new window.Event("hashchange"));
window.location.hash = "#/media-internal"; window.dispatchEvent(new window.Event("hashchange"));
const mediaIdx = App.store.get("wsp-media-index", []);
assert(mediaIdx.length === 1,             "im4: filindeks lagret");
assert(mediaIdx[0].category === "Tester", "im5: kategori korrekt");

/* --- J) ANNOUNCEMENTS ----------------------------------------------------- */
window.location.hash = "#/announcements"; window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#ann-root"),    "j1: announcements-root rendret");
assert(!!doc.querySelector("#ann-new-btn"), "j2: ny-melding-knapp synlig (owner)");
doc.querySelector("#ann-new-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
doc.querySelector("#ann-title").value = "Testmelding";
doc.querySelector("#ann-important").checked = true;
doc.querySelector("#ann-save").dispatchEvent(new window.Event("click", { bubbles: true }));
const annItems = App.store.get("wsp-announcements", []);
assert(annItems.length === 1,              "j3: melding lagret");
assert(annItems[0].important === true,     "j4: viktig-flagg satt");
assert(annItems[0].title === "Testmelding", "j5: tittel korrekt");
assert(App.store.get("wsp-activity", []).some(a => a.type === "ann_created"), "j6: aktivitet logget");

/* --- J2) BRUKERPREFERANSER ------------------------------------------------ */
App.store.set("wsp-prefs", { theme: "dark", density: "compact" });
assert(App.store.get("wsp-prefs", {}).theme === "dark",    "j7: dark theme lagret");
assert(App.store.get("wsp-prefs", {}).density === "compact", "j8: compact density lagret");

/* --- K) KONTAKT OG SIDEBAR ------------------------------------------------ */
assert(!!doc.querySelector('[data-inav="contact"]'), "k1: contact i nav");
assert(!!doc.querySelector(".i-nav__section"),       "k2: Henvendelser-seksjon finnes");
assert(doc.querySelector(".i-nav__section-label").textContent.includes("Henvendelser"), "k3: seksjonstittel");
window.location.hash = "#/contact"; window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#contact-root"), "k4: contact-root rendret");

/* --- K2) LENKER ----------------------------------------------------------- */
window.location.hash = "#/links"; window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#links-root"),    "k2-1: links-root rendret");
assert(!!doc.querySelector("#links-new-btn"), "k2-2: legg-til-knapp synlig (owner)");
doc.querySelector("#links-new-btn").dispatchEvent(new window.Event("click",{bubbles:true}));
doc.querySelector("#link-title").value = "SharePoint";
doc.querySelector("#link-url").value   = "https://sharepoint.example.com";
doc.querySelector("#link-save").dispatchEvent(new window.Event("click",{bubbles:true}));
const linkItems = App.store.get("wsp-links",[]);
assert(linkItems.length === 1,                    "k2-3: lenke lagret");
assert(linkItems[0].title === "SharePoint",       "k2-4: tittel korrekt");
assert(linkItems[0].url   === "https://sharepoint.example.com", "k2-5: URL korrekt");
assert(linkItems[0].icon  === "link",             "k2-6: standard-ikon satt");


// Standarddata er lasta
// Fanebytte


// Verifiser at defaultdata er lasta

// Søk fungerer

// Faneskifte

/* --- K3) ORGDRIFT --------------------------------------------------------- */
window.location.hash = "#/notes"; window.dispatchEvent(new window.Event("hashchange"));
window.location.hash = "#/orgdrift"; window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#orgdrift-root"), "k3-1: orgdrift-root rendret");
assert(!!doc.querySelector(".od-tabs"),       "k3-2: fane-navigasjon finnes");
assert(!!doc.querySelector(".od-stats"),      "k3-3: statistikk-rad finnes");
const orgData = App.store.get("wsp-orgdrift", {});
assert(Array.isArray(orgData.people) && orgData.people.length > 0,  "k3-4: people-defaultdata lasta");
assert(Array.isArray(orgData.systems) && orgData.systems.length > 0, "k3-5: systems-defaultdata lasta");
assert(Array.isArray(orgData.vendors) && orgData.vendors.length > 0, "k3-6: vendors-defaultdata lasta");
assert(!!doc.querySelector("[data-od-search]"),           "k3-7: søkefelt finnes");
assert(!!doc.querySelector('[data-od-tab="vendors"]'),    "k3-8: vendors-fane finnes");

/* --- L) WORKSPACESHIP ----------------------------------------------------- */
assert(!doc.querySelector('[data-inav="workspaceship"]'), "l1: workspaceship skjult i nav");
App.store.set("wsp-workspaceship", { best: 42 });
assert(App.store.get("wsp-workspaceship", {}).best === 42, "l2: highscore lagret");
window.location.hash = "#/workspaceship"; window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#workspaceship-root"), "l3: workspaceship rendret via direkterute");

/* --- RESULTAT ------------------------------------------------------------- */
const ok  = globalThis.__ok  || 0;
const err = globalThis.__err || 0;
console.log(`\n${ok + err} tester — ${ok} OK, ${err} FEIL`);
