/* =============================================================================
   test-intranet.js  —  jsdom-harness for intranettet
   Speiler konvensjonene i test.js.
   Kjør: node test-intranet.js
   ========================================================================== */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "intranet/index.html"), "utf8");

// Reskriver relative stier slik jsdom finner filene fra repo-rot
const patchedHtml = html
  .replace(/src="\.\.\/config\.js"/g,     'src="config.js"')
  .replace(/src="\.\.\/components\.js"/g, 'src="components.js"')
  .replace(/src="\.\.\/core\.js"/g,       'src="core.js"')
  .replace(/src="intranet-core\.js"/g,    'src="intranet/intranet-core.js"')
  .replace(/src="module-settings\.js"/g,  'src="intranet/module-settings.js"')
  .replace(/src="module-tasks\.js"/g,     'src="intranet/module-tasks.js"')
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

// Samme mocks som test.js
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

// Last filer i rekkefølge
[
  "config.js", "components.js", "core.js",
  "intranet/intranet-core.js",
  "intranet/module-announcements.js",
  "intranet/module-settings.js",
  "intranet/module-tasks.js",
  "intranet/module-contact.js",
  "intranet/module-crm.js",
  "intranet/module-booking.js",
  "intranet/module-quote.js",
  "intranet/module-dashboard.js",
  "intranet/module-workspaceship.js"
].forEach(f => {
  window.eval(fs.readFileSync(f, "utf8"));
});

window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

const doc = window.document;
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

/* ---------------------------------------------------------------------------
   A) GRUNNLEGGENDE SHELL
   ------------------------------------------------------------------------ */
assert(!!doc.getElementById("intranet"), "a1: #intranet rot finnes");
assert(!doc.getElementById("app"),       "a2: #app finnes IKKE (core sin shell no-op-er)");
assert(!!doc.getElementById("intranet-nav"),  "a3: sidebar-nav rendret");
assert(!!doc.getElementById("intranet-main"), "a4: content-outlet rendret");

/* ---------------------------------------------------------------------------
   B) REGISTER OG NAV
   ------------------------------------------------------------------------ */
const Intranet = window.Intranet;
assert(typeof Intranet === "object" && typeof Intranet.registerModule === "function",
  "b1: window.Intranet eksponert med registerModule");

const navLinks = [...doc.querySelectorAll(".i-nav__link")];
const navIds   = navLinks.map(a => a.getAttribute("data-inav"));
assert(navIds.includes("dashboard"), "b2: dashboard i nav");
assert(navIds.includes("tasks"),     "b3: tasks i nav");
assert(navIds.includes("settings"),  "b4: settings i nav");
assert(navIds.indexOf("dashboard") < navIds.indexOf("tasks"),
  "b5: dashboard (order:10) før tasks (order:20)");
assert(navIds.indexOf("tasks") < navIds.indexOf("settings"),
  "b6: tasks (order:20) før settings (order:90)");

/* ---------------------------------------------------------------------------
   C) INGEN OFFENTLIG INNHOLD PÅ INTRANETT-SIDEN
   ------------------------------------------------------------------------ */
assert(!doc.querySelector(".site-header"), "c1: ingen offentlig site-header");
assert(!doc.querySelector(".site-footer"), "c2: ingen offentlig site-footer");
assert(!doc.getElementById("hjem"),        "c3: ingen #hjem-seksjon");

/* ---------------------------------------------------------------------------
   D) ROUTING OG MODUL-MOUNT
   ------------------------------------------------------------------------ */
const activeLink = doc.querySelector(".i-nav__link.is-active");
assert(activeLink && activeLink.getAttribute("data-inav") === "dashboard",
  "d1: dashboard er aktiv rute ved oppstart");

window.location.hash = "#/tasks";
window.dispatchEvent(new window.Event("hashchange"));
const taskActiveLink = doc.querySelector(".i-nav__link.is-active");
assert(taskActiveLink && taskActiveLink.getAttribute("data-inav") === "tasks",
  "d2: tasks aktiv etter #/tasks");
assert(!!doc.querySelector("#tasks-root"), "d3: tasks-root rendret");
assert(!!doc.querySelector("#tasks-quick-form"), "d4: hurtig-opprett form rendret");

/* ---------------------------------------------------------------------------
   E) TASKS CRUD
   ------------------------------------------------------------------------ */
const App = window.App;
const inp = doc.querySelector("#tasks-quick-input");
inp.value = "Testoppgave 1";
doc.querySelector("#tasks-quick-form").dispatchEvent(
  new window.Event("submit", { cancelable: true, bubbles: true })
);
const tasks1 = App.store.get("wsp-tasks", []);
assert(tasks1.length === 1, "e1: én oppgave lagret etter opprett");
assert(tasks1[0].title === "Testoppgave 1", "e2: tittel korrekt");
assert(tasks1[0].status === "todo",         "e3: status=todo ved opprettelse");

const inp2 = doc.querySelector("#tasks-quick-input");
inp2.value = "Testoppgave 2";
doc.querySelector("#tasks-quick-form").dispatchEvent(
  new window.Event("submit", { cancelable: true, bubbles: true })
);
const tasks2 = App.store.get("wsp-tasks", []);
assert(tasks2.length === 2, "e4: to oppgaver etter andre opprett");

window.location.hash = "#/settings";
window.dispatchEvent(new window.Event("hashchange"));
window.location.hash = "#/tasks";
window.dispatchEvent(new window.Event("hashchange"));
const statusBtn = doc.querySelector("[data-task-status]");
assert(!!statusBtn, "e5: statusknapp finnes i listen");
statusBtn.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
const tasks3 = App.store.get("wsp-tasks", []);
assert(tasks3.some(t => t.status !== "todo"), "e6: minst én oppgave har endret status");

/* ---------------------------------------------------------------------------
   F) AKTIVITETSLOGG
   ------------------------------------------------------------------------ */
const activity = App.store.get("wsp-activity", []);
assert(activity.length > 0,         "f1: aktivitetslogg har poster");
assert(activity[0].ts > 0,          "f2: ts er satt");
assert(typeof activity[0].label === "string", "f3: label er streng");

/* ---------------------------------------------------------------------------
   G) SETTINGS
   ------------------------------------------------------------------------ */
window.location.hash = "#/settings";
window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#settings-root"), "g1: settings-root rendret");
assert(!!doc.querySelector("#settings-form"), "g2: settings-form finnes");
assert(!!doc.querySelector("#settings-reset"), "g3: reset-knapp finnes");

doc.querySelector("#settings-name").value = "Testbedriften AS";
doc.querySelector("#settings-form").dispatchEvent(
  new window.Event("submit", { cancelable: true, bubbles: true })
);
const saved = App.store.get("wsp-settings", {});
assert(saved.tenantName === "Testbedriften AS", "g4: tenantName lagret");

doc.querySelector("#settings-reset").click();
assert(!App.store.get("wsp-tasks"),    "g5: wsp-tasks slettet etter reset");
assert(!App.store.get("wsp-settings"), "g6: wsp-settings slettet etter reset");
assert(!App.store.get("wsp-activity"), "g7: wsp-activity slettet etter reset");

/* ---------------------------------------------------------------------------
   H) DASHBOARD
   ------------------------------------------------------------------------ */
App.store.set("wsp-tasks", [
  { id: "t1", title: "A", status: "todo",        createdAt: Date.now(), updatedAt: Date.now() },
  { id: "t2", title: "B", status: "in_progress", createdAt: Date.now(), updatedAt: Date.now() }
]);
Intranet.logActivity({ type: "task_created", label: "Seeded for test" });

window.location.hash = "#/settings";
window.dispatchEvent(new window.Event("hashchange"));
window.location.hash = "#/dashboard";
window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#dashboard-root"), "h1: dashboard-root rendret");
assert(doc.querySelector("#dashboard-root").textContent.includes("Å gjøre") &&
       doc.querySelector("#dashboard-root").textContent.includes("Pågår"),
  "h2: dashboard viser statuskategorier med oppgavetall");
assert(typeof App.store.get === "function",   "h3: App.store.get tilgjengelig");
assert(typeof App.store.set === "function",   "h4: App.store.set tilgjengelig");
assert(typeof App.media.resolveImage === "function", "h5: App.media tilgjengelig");

/* ---------------------------------------------------------------------------
   I) ANNOUNCEMENTS + BRUKERPREFERANSER
   ------------------------------------------------------------------------ */
// Announcements i nav — seed owner-sesjon
const NS2 = (window.SITE_CONFIG && window.SITE_CONFIG.storageKey) || "site";
window.sessionStorage.setItem(NS2 + ":admin", "owner");
window.location.hash = "#/settings";
window.dispatchEvent(new window.Event("hashchange"));
window.location.hash = "#/announcements";
window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#ann-root"), "i-ann1: announcements-root rendret");
assert(!!doc.querySelector("#ann-new-btn"), "i-ann2: ny-melding-knapp synlig (owner)");

// Opprett melding — klikk "Ny melding" først for å vise editor
doc.querySelector("#ann-new-btn").dispatchEvent(
  new window.Event("click", { bubbles: true })
);
doc.querySelector("#ann-title").value = "Testmelding";
doc.querySelector("#ann-important").checked = true;
doc.querySelector("#ann-save").dispatchEvent(
  new window.Event("click", { bubbles: true })
);
const annItems = App.store.get("wsp-announcements", []);
assert(annItems.length === 1, "i-ann3: melding lagret");
assert(annItems[0].important === true, "i-ann4: viktig-flagg satt");
assert(annItems[0].title === "Testmelding", "i-ann5: tittel korrekt");

// Aktivitetslogg
const annAct = App.store.get("wsp-activity", []);
assert(annAct.some(function(a) { return a.type === "ann_created"; }), "i-ann6: aktivitet logget");

// Brukerpreferanser — store-lagring
App.store.set("wsp-prefs", { theme: "dark", density: "compact" });
const prefs = App.store.get("wsp-prefs", {});
assert(prefs.theme === "dark",    "i-pref1: dark theme lagret");
assert(prefs.density === "compact", "i-pref2: compact density lagret");

/* ---------------------------------------------------------------------------
   K) KONTAKTMODUL OG SIDEBAR-GRUPPERING
   ------------------------------------------------------------------------ */
// Kontaktmodul i nav
const contactNavLink = doc.querySelector('[data-inav="contact"]');
assert(!!contactNavLink, "k0: contact-modul vises i nav");

// Henvendelser-seksjon i sidebar
assert(!!doc.querySelector(".i-nav__section"), "k0b: Henvendelser-seksjon finnes i sidebar");
assert(doc.querySelector(".i-nav__section-label").textContent.includes("Henvendelser"),
  "k0c: seksjonstittel er Henvendelser");

// Naviger til kontakt
window.location.hash = "#/contact";
window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#contact-root"), "k0d: contact-root rendret");

/* ---------------------------------------------------------------------------
   L) WORKSPACESHIP EASTER EGG
   ------------------------------------------------------------------------ */
const wsNavLink = doc.querySelector('[data-inav="workspaceship"]');
assert(!wsNavLink, "l1: workspaceship vises ikke i sidebar-nav (hideFromNav)");

App.store.set("wsp-workspaceship", { best: 42 });
const wsState = App.store.get("wsp-workspaceship", {});
assert(wsState.best === 42, "l2: highscore lagres og leses via App.store");

// Workspaceship er registrert (tilgjengelig via ruting selv om skjult i nav)
window.location.hash = "#/workspaceship";
window.dispatchEvent(new window.Event("hashchange"));
assert(!!doc.querySelector("#workspaceship-root"), "l3: workspaceship-root rendret via direkterute");

/* ---------------------------------------------------------------------------
   RESULTAT
   ------------------------------------------------------------------------ */
const ok  = globalThis.__ok  || 0;
const err = globalThis.__err || 0;
console.log(`\n${ok + err} tester — ${ok} OK, ${err} FEIL`);
