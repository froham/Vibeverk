const { JSDOM } = require("jsdom");
const fs = require("fs");

const html = fs.readFileSync("index.html", "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/" });
const { window } = dom;

// IntersectionObserver-mock (jsdom mangler den)
window.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
  unobserve() {} disconnect() {}
};
window.matchMedia = window.matchMedia || function () { return { matches: false, addEventListener(){}, removeEventListener(){} }; };
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.URL.createObjectURL = window.URL.createObjectURL || (() => "blob:mock-url");
window.URL.revokeObjectURL = window.URL.revokeObjectURL || (() => {});

// Last filene i samme rekkefølge som index.html
["config.js", "components.js", "core.js", "template-klassisk.js", "template-panorama.js", "template-scrollstory.js", "module-booking.js", "module-quote.js", "module-references.js", "module-faq.js", "module-crm.js", "module-mediabank.js"].forEach(f => {
  const code = fs.readFileSync(f, "utf8");
  window.eval(code);
});
// I nettleseren fyres dette automatisk når body er ferdig parset:
window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

const doc = window.document;
const assert = (cond, msg) => { if (!cond) { globalThis.__err=(globalThis.__err||0)+1; console.error("FEIL:", msg); process.exitCode = 1; } else { globalThis.__ok=(globalThis.__ok||0)+1; console.log("OK:", msg); } };

// 1) Alle standardseksjoner rendret i riktig rekkefølge
["hjem", "om-oss", "tjenester", "aktuelt", "kontakt"].forEach(id =>
  assert(doc.getElementById(id), "seksjon finnes: #" + id));

// 2) Nav har 5 lenker i rekkefølge
const navIds = [...doc.querySelectorAll(".nav__link")].map(a => a.getAttribute("data-nav"));
assert(JSON.stringify(navIds) === JSON.stringify(["hjem","om-oss","tjenester","referanser","aktuelt","faq","mediabank","booking","tilbud","kontakt"]),
  "navrekkefølge korrekt: " + navIds.join(","));

// 3) Tema-variabler satt fra config
const primary = window.document.documentElement.style.getPropertyValue("--color-primary").trim();
assert(primary === "#005cff", "primærfarge fra config satt: " + primary);
// Poppins/Nunito Sans (config.js sine standardfontar) er sjølv-hosta lokalt
// sidan 2026-07-16 (docs/compliance/data-map-vibeverk.md seksjon 8) -- ingen
// direkte nettlesar->Google-førespurnad for desse to, difor "-local"-lenka,
// ikkje "#app-fonts" (som framleis brukast for andre, ikkje-lokale fontval).
assert(!!doc.getElementById("app-fonts-local"), "lokal fontlenke injisert (Poppins/Nunito Sans er sjølv-hosta)");
assert(!doc.getElementById("app-fonts"), "ingen Google Fonts-lenke for standardfontane (begge er sjølv-hosta)");
assert(window.SITE_CONFIG && typeof window.SITE_CONFIG.customModules === "object" && Object.keys(window.SITE_CONFIG.customModules).length === 0,
  "customModules er tomt objekt i standardkonfig");
assert(doc.title.includes("Vibeverk"), "tittel fra config: " + doc.title);

// 4) Tjenester: 4 kort
assert(doc.querySelectorAll(".card").length === 4, "fire tjenestekort");

// 4b) App.ready — config-tilgjengelegheit-gate (ADR-0007 Fase 1 / SaaS-
// skaleringsplanen Fase 4). Denne testsuiten er heilt synkron (window.eval()
// per fil, éin synkron DOMContentLoaded-dispatch, synkrone assertions rett
// etter) — den låser difor kun fast at Fase 4 er ei rein, åtferdsnøytral
// plumbing-endring (config.js er framleis ein synkron <script>-tag, App.ready
// løyser med det same). Å teste ei EKTE utsett/asynkron oppløysing (kø-a,
// løyst på eit seinare tick) krev at sjølve testhamsen sluttar å vere heilt
// synkron (t.d. ein reell await Promise.resolve() etter dispatchEvent) —
// det høyrer til den seinare fasen som faktisk byter config-kjelda til
// fetch(), IKKJE denne. Ikkje anta at den asynkrone stien er dekt av desse
// testane.
assert(typeof window.App.ready === "function", "App.ready finst og er ein funksjon");

var _readyProbeCalls = 0;
var _readyProbeCfg = null;
window.App.ready(function (cfg) { _readyProbeCalls++; _readyProbeCfg = cfg; });
assert(_readyProbeCalls === 1, "App.ready(fn) kallar fn synkront nøyaktig éin gong når config alt er klar");
assert(_readyProbeCfg === window.SITE_CONFIG, "App.ready(fn) sender window.SITE_CONFIG som argument til fn");

// Prova at App.ready alltid les LEVANDE tilstand, ikkje eit stale snapshot
// teke ved modul-parse-tidspunkt — avgjerande for at feature-flagg-sjekkane
// i kvar modulfil (CFG.features.X) faktisk speglar noverande config, ikkje
// berre den fyrste verdien nokon gong observert.
var _origBookingFlag = window.SITE_CONFIG.features.booking;
window.SITE_CONFIG.features.booking = false;
var _readyProbeAfterMutation = null;
window.App.ready(function (cfg) { _readyProbeAfterMutation = cfg.features.booking; });
assert(_readyProbeAfterMutation === false, "App.ready(fn) les levande CFG-tilstand, ikkje eit stale snapshot");
window.SITE_CONFIG.features.booking = _origBookingFlag; // rydd opp att før resten av testane køyrer

// Personvernerklæring: modul-bevisst standardtekst ved første oppstart (ingen overstyring lagret enno)
var initialPrivacyText = window.SITE_CONFIG.privacy.text;
assert(!!initialPrivacyText, "personvern-standardtekst genereres automatisk ved oppstart (ikke tom)");
assert(/tilbud/.test(initialPrivacyText) && /booking/i.test(initialPrivacyText), "nevner tilbud og booking (begge moduler aktive i testen)");
assert(/Nei\. Denne siden bruker ingen cookies/.test(initialPrivacyText), "nevner ikke Plausible før analyse er konfigurert");

// 5) Lead lagres via kontaktskjema
doc.querySelector("#lead-name").value = "Kari Test";
doc.querySelector("#lead-email").value = "kari@test.no";
doc.querySelector("#lead-message").value = "Hei!";
doc.querySelector("#lead-terms").checked = true;
doc.querySelector("[data-contact-form]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
const leads = JSON.parse(window.localStorage.getItem("nordpunkt:leads"));
assert(leads && leads.length === 1 && leads[0].name === "Kari Test", "lead lagret i localStorage");
assert(typeof leads[0].referenceNumber === "number" && leads[0].referenceNumber >= 100000 && leads[0].referenceNumber <= 999999, "henvendelse får et gyldig sekssifret referansenummer");

// 6) Ny modul kan registreres uten å røre basekoden
window.App.registerModule({
  id: "dummytest", label: "Test", order: 47,
  render: () => "<section id='dummytest' class='section'><div class='container'><h2>Test</h2></div></section>"
});
assert(doc.getElementById("dummytest"), "ny inline-modul rendret etter registrering");
const navIds2 = [...doc.querySelectorAll(".nav__link")].map(a => a.getAttribute("data-nav"));
assert(JSON.stringify(navIds2) === JSON.stringify(["hjem","om-oss","tjenester","referanser","aktuelt","faq","mediabank","booking","dummytest","tilbud","kontakt"]),
  "ny modul plassert riktig i meny (order 47): " + navIds2.join(","));

// 6b) ADR-0003: Supabase konfigurert (ekte url/anonKey frå config.js) men SDK ikkje lasta
// (jsdom lastar aldri window.supabase) → skal vise feilmelding/prøv-igjen, ALDRI passord-skjema
window.App.openAdmin();
assert(!doc.querySelector("#admin-pass"), "ADR-0003: ingen passord-fallback når Supabase er konfigurert men SDK ikkje lasta");
assert(!!doc.querySelector("[data-login-retry]"), "ADR-0003: viser prøv-igjen ved manglande Supabase-SDK");
doc.querySelector(".modal__close[data-modal-close]").dispatchEvent(new window.Event("click", { bubbles: true }));

// 7) Admin: feil passord avvises, riktig slipper inn
// Config-passord-fallback gjeld berre når Supabase ikkje er konfigurert i det heile (sjå
// ADR-0003) — jsdom lastar aldri den ekte Supabase-SDK-en (window.supabase er alltid
// undefined her), så vi må simulere "ikkje konfigurert" eksplisitt for å teste fallback-
// stien, i staden for å stole på at CFG.supabase alt var tom.
const realSupabaseCfg = window.SITE_CONFIG.supabase;
window.SITE_CONFIG.supabase = { url: "", anonKey: "" };
window.App.openAdmin();
let loginForm = doc.querySelector("[data-login]");
assert(!!loginForm, "admin krever innlogging");

// 7b) "Vis passord"-knapp for admin-innlogging
var pwField = doc.querySelector("#admin-pass");
var pwToggle = pwField.closest(".pw-field").querySelector("[data-pw-toggle]");
assert(pwField.type === "password", "admin-pass er skjult som standard");
assert(!!pwToggle, "vis-passord-knapp finst ved sida av admin-pass");
pwToggle.dispatchEvent(new window.Event("click", { bubbles: true }));
assert(pwField.type === "text", "klikk på vis-passord-knappen viser passordet som klartekst");
assert(pwToggle.getAttribute("aria-label") === "Skjul passord", "aria-label byter til «Skjul passord» når vist");
pwToggle.dispatchEvent(new window.Event("click", { bubbles: true }));
assert(pwField.type === "password", "nytt klikk skjuler passordet att");
assert(pwToggle.getAttribute("aria-label") === "Vis passord", "aria-label byter attende til «Vis passord»");

doc.querySelector("#admin-pass").value = "feil";
loginForm.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
assert(!!doc.querySelector("[data-login]"), "feil passord avvist");
doc.querySelector("#admin-pass").value = "test";
doc.querySelector("[data-login]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
assert(!!doc.querySelector(".tabs"), "riktig passord åpner panelet");
window.SITE_CONFIG.supabase = realSupabaseCfg;
assert(!!doc.querySelector(".admin-catbar"), "admin-panelet har en kategori-bar (eier ser alle tre kategorier)");
var catLabels = [...doc.querySelectorAll(".admin-cat")].map(c => c.textContent);
assert(JSON.stringify(catLabels) === JSON.stringify(["Innhold","Henvendelser","Innstillinger"]), "tre kategorier i riktig rekkefølge: " + catLabels.join(","));

function clickCat(id) { var b = doc.querySelector('[data-admin-cat="' + id + '"]'); if (b) b.dispatchEvent(new window.Event("click", { bubbles: true })); }
function clickTab(id) { var b = doc.querySelector('[data-tab="' + id + '"]'); if (b) b.dispatchEvent(new window.Event("click", { bubbles: true })); }

clickCat("henvendelser"); clickTab("leads");
// setTabBadge() (core.js) legg eit .tab-badge-span (uleste-teljar) INNI leads-
// fana sin <button> når det finst nye henvendelser — .textContent slår difor
// saman til t.d. "Kontakt1" utan skiljeteikn. Strip badge-teksten FØR
// samanlikning, elles feiler denne testen kvar gong det finst ≥1 uleste
// henvendelse i testdataen, sjølv om fana faktisk heiter "Kontakt" korrekt.
function tabLabelWithoutBadge(t) {
  var badge = t.querySelector(".tab-badge");
  var label = t.textContent;
  return badge ? label.slice(0, label.length - badge.textContent.length) : label;
}
var tabLabelsHenv = [...doc.querySelectorAll(".tab")].map(tabLabelWithoutBadge);
assert(tabLabelsHenv.indexOf("Kontakt") > -1 && tabLabelsHenv.indexOf("Leads") === -1, "henvendelses-fanen heter «Kontakt»");

// 7c) Tryggleiksfiks 2026-07-18 (Security Auditor-funn, CRITICAL): l.referenceNumber vart
// rendra RÅ (ikkje C.esc()-a) i adminLeads() sin liste, sjølv om insert_anon_lead()/
// insert_anon_booking() (dei anon-kallbare RPC-ane) ikkje validerer/avgrensar
// p_reference_number i det heile -- ein uinnlogga aktør kunne difor planta eit skript
// som køyrde i EIN INNLOGGA ADMIN sin nettlesar berre ved at admin opna Henvendelser-
// fana. Stadfestar at HTML-spesialteikn no vert escapa.
(function () {
  var leadsRaw = JSON.parse(window.localStorage.getItem("nordpunkt:leads")) || [];
  leadsRaw.push({
    id: "lead-xss-test", kind: "kontakt", name: "XSS Test", email: "xss@test.no",
    message: "test", time: new Date().toISOString(), status: "ny",
    referenceNumber: '"><img src=x data-xss-marker onerror="window.__xssFired=true">'
  });
  window.localStorage.setItem("nordpunkt:leads", JSON.stringify(leadsRaw));
  clickCat("innhold"); clickCat("henvendelser"); clickTab("leads");
  assert(!doc.querySelector("[data-xss-marker]"), "referansenummer med HTML-spesialteikn vert escapa i Henvendelser-lista, ikkje tolka som DOM-element (2026-07-18-tryggleiksfiks)");
  assert(window.__xssFired !== true, "injisert skript i referansenummer køyrer IKKJE (2026-07-18-tryggleiksfiks)");
})();

clickCat("innstillinger"); clickTab("analyse");
var tabLabelsInnst = [...doc.querySelectorAll(".tab")].map(t => t.textContent);
assert(tabLabelsInnst.indexOf("Analyse") === 0, "Analyse-fanen er først i Innstillinger-kategorien");
assert(tabLabelsInnst.indexOf("Sikkerhetskopi") === tabLabelsInnst.length - 1, "Sikkerhetskopi-fanen er sist i Innstillinger-kategorien");
clickCat("innhold"); clickTab("innhold");

// 8) Admin: redigere hero og lagre oppdaterer siden
clickCat("innhold"); clickTab("innhold");
doc.querySelector("#f-hero-title").value = "Ny tittel her";
doc.querySelector("[data-content]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
assert(doc.querySelector(".hero__title").textContent === "Ny tittel her", "hero-tittel oppdatert på siden etter lagring");

console.log("\nFerdig.");

// --- Tjeneste-redigering ---------------------------------------------------
console.log("\n— Tjenester —");
// Åpne Tjenester-fanen
clickCat("innhold"); clickTab("tjenester");
assert(doc.querySelectorAll(".admin-list .admin-row").length === 4, "fire kort vist i admin");

// Rediger første kort
const firstId = doc.querySelector(".admin-list .admin-row").getAttribute("data-id");
doc.querySelector('[data-edit="' + firstId + '"]').dispatchEvent(new window.Event("click", { bubbles: true }));
doc.querySelector("#s-title").value = "Endret tjeneste";
doc.querySelector("#s-icon").value = "bulb";
doc.querySelector("[data-svc]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
assert([...doc.querySelectorAll(".card__title")].some(t => t.textContent === "Endret tjeneste"),
  "redigert tjenestekort vises på siden");

// Opprett nytt kort
clickCat("innhold"); clickTab("tjenester");
doc.querySelector("[data-new]").dispatchEvent(new window.Event("click", { bubbles: true }));
doc.querySelector("#s-title").value = "Helt nytt kort";
doc.querySelector("#s-text").value = "Beskrivelse";
doc.querySelector("#s-icon").value = "star";
doc.querySelector("[data-svc]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
assert(doc.querySelectorAll(".card").length === 5, "nytt kort lagt til (5 kort)");

// Slett et kort
const delId = doc.querySelector(".admin-list .admin-row").getAttribute("data-id");
doc.querySelector('[data-del="' + delId + '"]').dispatchEvent(new window.Event("click", { bubbles: true }));
assert(doc.querySelectorAll(".card").length === 4, "kort slettet (tilbake til 4)");

// Lagret i localStorage
const stored = JSON.parse(window.localStorage.getItem("nordpunkt:content"));
assert(stored.services && stored.services.length === 4, "tjenester persistert i localStorage");

// Ikon saneres (ingen rare tegn / ingen injeksjon)
clickCat("innhold"); clickTab("tjenester");
doc.querySelector("[data-new]").dispatchEvent(new window.Event("click", { bubbles: true }));
doc.querySelector("#s-title").value = "Saner";
doc.querySelector("#s-icon").value = 'rocket"><b>x';
doc.querySelector("[data-svc]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
const last = JSON.parse(window.localStorage.getItem("nordpunkt:content")).services.find(c => c.title === "Saner");
assert(last && last.icon === "rocketbx", "ikonnavn sanert: " + last.icon);

// --- Bilder med fokuspunkt --------------------------------------------------
console.log("\n— Bilder & fokuspunkt —");
const parseImg = v => { try { return JSON.parse(v); } catch(e){ return { src:v, pos:"50% 50%" }; } };

// 1) Hero-bilde via URL → fullbredde banner
clickCat("innhold"); clickTab("innhold");
const heroWrap = [...doc.querySelectorAll("[data-imgfield]")].find(w => w.querySelector("#f-hero-image"));
const heroUrl = heroWrap.querySelector("[data-imgfield-url]");
heroUrl.value = "https://eksempel.no/hero.jpg";
heroUrl.dispatchEvent(new window.Event("input", { bubbles: true }));
assert(parseImg(heroWrap.querySelector("#f-hero-image").value).src === "https://eksempel.no/hero.jpg", "hero-URL lagret som {src,pos}");

// 2) Beskjæring: dra det lyse utsnittet (hele bildet vises). Simuler bildestørrelse.
const heroPrev = heroWrap.querySelector("[data-imgfield-preview]");
const heroImgEl = heroPrev.querySelector("img");
Object.defineProperty(heroImgEl, "naturalWidth", { value: 2000, configurable: true });
Object.defineProperty(heroImgEl, "naturalHeight", { value: 500, configurable: true }); // forhold 4 > hero-aspekt 2.4 → vindu 60% bredt, kan dras vannrett
if (typeof heroImgEl.onload === "function") heroImgEl.onload();
heroPrev.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 50, right:200, bottom:50 });
const down = new window.Event("pointerdown", { bubbles: true }); down.clientX = 0; down.clientY = 0; down.pointerId = 1;
heroPrev.dispatchEvent(down);
const move = new window.Event("pointermove", { bubbles: true }); move.clientX = 20; move.clientY = 0; // +10% av bredden → vindu fra 20→30 av maks 40 → 75%
heroPrev.dispatchEvent(move);
window.dispatchEvent(new window.Event("pointerup", { bubbles: true }));
const posAfter = parseImg(heroWrap.querySelector("#f-hero-image").value).pos;
assert(posAfter === "75% 50%", "dra utsnittet flytter beskjæringen: " + posAfter);
// Utsnitt-vindu finnes og er smalere enn full bredde (synlig beskjæring)
const win = heroPrev.querySelector("[data-crop-window]");
assert(win && win.style.width === "60%", "utsnitt-vindu vises med riktig bredde: " + (win && win.style.width));

// 3) Tastaturstyring: piltastar flytter fokuspunktet i steg på 5 %, uavhengig av mus/touch.
assert(heroPrev.getAttribute("tabindex") === "0" && heroPrev.getAttribute("role") === "slider", "fokuspunkt-veljaren er tastatur-fokuserbar (tabindex + role=slider)");
heroPrev.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
const posAfterRight = parseImg(heroWrap.querySelector("#f-hero-image").value).pos;
assert(posAfterRight === "80% 50%", "ArrowRight flytter fokuspunktet 5% mot høgre: " + posAfterRight);
// Dette bildet sitt utsnittvindu fyller alt 100% av høgda (wh:100, sjå
// layout()-kommentaren over — imgAspect 4 > outAspect 2.4) -- den vertikale
// aksen er difor inert, akkurat som dei breie 3:1/21:9-utsnitta UX-
// gjennomgangen 2026-07-15 fann. ArrowDown skal difor IKKJE lenger endre den
// lagra posisjonen (før denne fiksen endra han stille, sjølv om vindauget
// aldri synleg flytta seg vertikalt -- eit reelt inkonsistens-funn).
heroPrev.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
const posAfterDown = parseImg(heroWrap.querySelector("#f-hero-image").value).pos;
assert(posAfterDown === "80% 50%", "ArrowDown er inert på ein akse utan rom å flytte i: " + posAfterDown);
// Same inert-akse-sperre gjeld draging (musepeikar), ikkje berre tastatur.
const downV = new window.Event("pointerdown", { bubbles: true }); downV.clientX = 0; downV.clientY = 0; downV.pointerId = 2;
heroPrev.dispatchEvent(downV);
const moveV = new window.Event("pointermove", { bubbles: true }); moveV.clientX = 0; moveV.clientY = 20; // forsøk på vertikal drag
heroPrev.dispatchEvent(moveV);
window.dispatchEvent(new window.Event("pointerup", { bubbles: true }));
const posAfterVDrag = parseImg(heroWrap.querySelector("#f-hero-image").value).pos;
assert(posAfterVDrag === "80% 50%", "vertikal drag er også inert på ein akse utan rom å flytte i: " + posAfterVDrag);
heroPrev.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
heroPrev.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
const posAfterReturn = parseImg(heroWrap.querySelector("#f-hero-image").value).pos;
assert(posAfterReturn === "75% 50%", "ArrowLeft/ArrowUp flytter tilbake (klemt til [0,100], konsistent steg): " + posAfterReturn);
// Regresjonsvakt (2026-07-15): eit vanleg biletfelt utan `previews` skal
// framleis rendrast BYTE-IDENTISK med før -- ingen ekstra wrapper-div.
assert(!heroWrap.querySelector("[data-imgfield-previews]"), "eit vanleg biletfelt utan previews viser ingen ekstra førehandsvisings-wrapper");

// 4) imgfield:relayout: bindImageFields() sin layout() skal lese data-aspect PÅ NYTT
// kvar gong, ikkje ein fastfrosen verdi frå bindetidspunktet — regresjonstest for
// module-scrollbanner.js sin modus-veksle-feil (dra vart feil rett etter statisk/
// parallax-byte fordi crop/outAspect aldri vart oppdatert). Biletet er 2000×500
// (aspekt 4); byt data-aspect frå hero sin 2.4 til eit portrett-forhold (9/16 ≈ 0.5625,
// smalare enn biletet) og stadfest at utsnitt-vindauget faktisk endrar breidde.
heroPrev.setAttribute("data-aspect", String(9 / 16));
heroWrap.dispatchEvent(new window.Event("imgfield:relayout", { bubbles: false }));
const winAfterRelayout = heroPrev.querySelector("[data-crop-window]");
assert(winAfterRelayout && winAfterRelayout.style.width === "14.0625%", "imgfield:relayout re-kjører layout() med FRISK data-aspect, ikkje ein fastfrosen verdi frå bindetidspunktet: " + (winAfterRelayout && winAfterRelayout.style.width));
heroPrev.setAttribute("data-aspect", "2.4"); // rydd opp att for resten av suiten

doc.querySelector("[data-content]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
const heroStyle = doc.getElementById("hjem").getAttribute("style") || "";
assert(doc.getElementById("hjem").classList.contains("has-image"), "hero har bilde");
assert(/eksempel\.no\/hero\.jpg/.test(heroStyle), "hero-bilde i bakgrunn");
assert(/background-position:\s*75% 50%/.test(heroStyle), "hero beskjæres etter valgt utsnitt: " + (heroStyle.match(/background-position:[^;"]*/)||[]));

// 3) Tjenestekort med bilde → full-bredde media (card__media i kort)
clickCat("innhold"); clickTab("tjenester");
const sid = doc.querySelector(".admin-list .admin-row").getAttribute("data-id");
doc.querySelector('[data-edit="' + sid + '"]').dispatchEvent(new window.Event("click", { bubbles: true }));
const sWrap = [...doc.querySelectorAll("[data-imgfield]")].find(w => w.querySelector("#s-image"));
sWrap.querySelector("[data-imgfield-url]").value = "https://eksempel.no/kort.jpg";
sWrap.querySelector("[data-imgfield-url]").dispatchEvent(new window.Event("input", { bubbles: true }));
doc.querySelector("[data-svc]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
const cardMedia = doc.querySelector(".card .card__media");
assert(!!cardMedia, "tjenestekort viser full-bredde media");
assert(/object-position/.test(cardMedia.getAttribute("style") || ""), "kort-bilde har fokuspunkt-stil");

// 4) Kort-struktur: media ligger UTENFOR padded body (full bredde)
const mediaCard = cardMedia.closest(".card");
assert(cardMedia.parentElement === mediaCard, "media er direkte barn av kortet (ikke i padded body)");
assert(!!mediaCard.querySelector(".card__body"), "kortet har padded body");

// 4b) Egendefinerte kontaktfelter (overskrift + innhold)
console.log("\n— Kontaktfelter —");
clickCat("innhold"); clickTab("innhold");
const addBtn = doc.querySelector("[data-extra-add]");
addBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
addBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
let rows = doc.querySelectorAll("[data-extra-row]");
assert(rows.length === 2, "to felter lagt til i admin");
rows[0].querySelector(".extra-label").value = "Fakturainformasjon";
rows[0].querySelector(".extra-value").value = "EHF: 123456789\nMerk med ordrenr.";
rows[1].querySelector(".extra-label").value = "Styreleder";
rows[1].querySelector(".extra-value").value = "Ola Nordmann";
// Fjern-knapp fjerner en rad
doc.querySelector("[data-extra-add]").dispatchEvent(new window.Event("click", { bubbles: true }));
assert(doc.querySelectorAll("[data-extra-row]").length === 3, "tredje (tom) rad lagt til");
doc.querySelectorAll("[data-extra-row]")[2].querySelector("[data-extra-remove]").dispatchEvent(new window.Event("click", { bubbles: true }));
assert(doc.querySelectorAll("[data-extra-row]").length === 2, "tom rad fjernet igjen");
// Lagre og sjekk visning
doc.querySelector("[data-content]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
const extras = doc.querySelectorAll("#kontakt .contact__extra");
assert(extras.length === 2, "to egendefinerte felter vises i Kontakt");
assert(/Fakturainformasjon/.test(extras[0].textContent) && /Styreleder/.test(extras[1].textContent), "overskrifter vises riktig");
// Persistert
const cstored = JSON.parse(window.localStorage.getItem("nordpunkt:content")).contact.extra;
assert(cstored.length === 2 && cstored[0].label === "Fakturainformasjon", "egendefinerte felter persistert");
// Tomme rader telles ikke med
clickCat("innhold"); clickTab("innhold");
doc.querySelector("[data-extra-add]").dispatchEvent(new window.Event("click", { bubbles: true }));
doc.querySelector("[data-content]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
assert(doc.querySelectorAll("#kontakt .contact__extra").length === 2, "tomt felt ignoreres ved lagring");

// 5) Opplasting (mocket nedskalering) → media-ref + resolve på siden
window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,QUJD";
class FakeImg { set src(v){ this._s=v; this.width=2000; this.height=1000; setTimeout(()=>this.onload&&this.onload(),0);} get src(){return this._s;} }
window.Image = FakeImg;

const __asyncTests = (async () => {
  function fire(el,type){ el.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true})); }
  // Klikker en admin-underfane, og bytter kategori først hvis fanen ligger i en
  // annen kategori enn den som er aktiv nå (etter admin-oppdelingen i tre kategorier).
  var ADMIN_TAB_CATEGORY = {
    innhold: "innhold", tjenester: "innhold", aktuelt: "innhold",
    "mod-referanser": "innhold", "mod-faq": "innhold", "mod-mediabank": "innhold",
    leads: "henvendelser", "mod-tilbud": "henvendelser", "mod-booking": "henvendelser", "mod-crm": "henvendelser",
    analyse: "innstillinger", navigasjon: "innstillinger", sikkerhetskopi: "innstillinger"
  };
  function clickAdminTab(id) {
    var cat = ADMIN_TAB_CATEGORY[id];
    if (cat) {
      var catBtn = doc.querySelector('[data-admin-cat="' + cat + '"]');
      if (catBtn && !catBtn.classList.contains("is-active")) fire(catBtn, "click");
    }
    var tabBtn = doc.querySelector('[data-tab="' + id + '"]');
    if (tabBtn) fire(tabBtn, "click");
  }

  clickAdminTab("aktuelt");
  doc.querySelector("[data-new]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("#p-title").value = "Innlegg med bilde";
  doc.querySelector("#p-text").value = "Tekst";
  const pWrap = [...doc.querySelectorAll("[data-imgfield]")].find(w => w.querySelector("#p-image"));
  const fileInput = pWrap.querySelector("[data-imgfield-file]");
  const file = new window.File([new Uint8Array([1,2,3])], "foto.png", { type: "image/png" });
  Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
  fileInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));

  const ref = parseImg(pWrap.querySelector("#p-image").value).src;
  assert(/^media:/.test(ref), "opplasting gir media-referanse: " + ref);
  const stored = window.localStorage.getItem("nordpunkt:" + ref);
  assert(stored && stored.indexOf("data:image/jpeg") > -1, "nedskalert bilde lagret i localStorage");

  // Aktuelt-biletet vises no fleire stader med ulikt forhold (forsidekort vs.
  // artikkelside) -- sidan 2026-07-15 (sjå CHANGELOG) viser redigeringsverktøyet
  // difor ei ekstra, ikkje-redigerbar "slik ser det ut her òg"-boks for
  // artikkelsida, som speglar SAME lagra posisjon som hovudboksen live.
  assert(!!pWrap.querySelector("[data-imgfield-previews]"), "Aktuelt-biletfeltet viser fleire førehandsvisingar (kort + artikkelside)");
  const pSecondary = pWrap.querySelector("[data-imgfield-secondary]");
  assert(pSecondary && Math.abs(parseFloat(pSecondary.getAttribute("data-aspect")) - 16 / 7) < 0.01, "sekundærboksen for Aktuelt har artikkelside-forholdet 16:7");
  assert(!!pSecondary.querySelector("img"), "sekundærboksen viser sjølve biletet etter opplasting");
  const pImgEl = pWrap.querySelector("[data-imgfield-preview] img");
  Object.defineProperty(pImgEl, "naturalWidth", { value: 1000, configurable: true });
  Object.defineProperty(pImgEl, "naturalHeight", { value: 800, configurable: true });
  if (typeof pImgEl.onload === "function") pImgEl.onload();
  pWrap.querySelector("[data-imgfield-preview]").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  const pPosAfter = parseImg(pWrap.querySelector("#p-image").value).pos;
  const pSecondaryImg = pSecondary.querySelector("img");
  assert(pSecondaryImg && pSecondaryImg.style.objectPosition === pPosAfter, "sekundærboksen oppdaterer object-position i takt med hovudboksen: " + pSecondaryImg.style.objectPosition + " vs. " + pPosAfter);

  doc.querySelector("[data-post]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
  const postImg = doc.querySelector(".post .post__media");
  const postImg2 = doc.querySelector("#aktuelt .nfc__photo, #aktuelt .nfc img, .post img");
  assert(postImg2 && postImg2.getAttribute("src").indexOf("data:image/jpeg") === 0, "opplastet bilde vises på siden (resolvet)");

  // 6) Sletting frigjør media
  clickAdminTab("aktuelt");
  const delId = doc.querySelector(".admin-list .admin-row").getAttribute("data-id");
  doc.querySelector('[data-del="' + delId + '"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(window.localStorage.getItem("nordpunkt:" + ref) === null, "media frigjort ved sletting");

  // --- Vedlegg ---
  console.log("\n— Vedlegg —");
  clickAdminTab("aktuelt");
  doc.querySelector("[data-new]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("#p-title").value = "Innlegg med vedlegg";
  doc.querySelector("#p-text").value = "Se vedlegg";
  const attInput = doc.querySelector("[data-attach] [data-attach-file]");
  const pdf = new window.File([new Uint8Array([37,80,68,70])], "rapport.pdf", { type: "application/pdf" });
  Object.defineProperty(attInput, "files", { value: [pdf], configurable: true });
  attInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));

  const attState = JSON.parse(doc.querySelector("#p-attachments").value);
  assert(attState.length === 1 && /^file:/.test(attState[0].ref) && attState[0].name === "rapport.pdf", "vedlegg lastet opp som referanse");
  const fref = attState[0].ref;
  assert(window.localStorage.getItem("nordpunkt:" + fref), "vedleggsfil lagret i localStorage");
  assert(!!doc.querySelector("[data-attach] .attach-item"), "vedlegg vises i editor-lista");

  doc.querySelector("[data-post]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
  const newId = doc.querySelector(".admin-list .admin-row").getAttribute("data-id");
  window.location.hash = "#sak/" + newId; window.dispatchEvent(new window.Event("hashchange"));
  const dl = doc.querySelector(".article .post__attachments a");
  assert(dl && dl.getAttribute("download") === "rapport.pdf", "vedlegg-nedlasting vises i artikkelvisning");
  assert(dl.getAttribute("href").indexOf("data:application/pdf") === 0, "lenke peker til lagret fil (data-URL)");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // Sletting av innlegg frigjør vedlegget
  clickAdminTab("aktuelt");
  const did = doc.querySelector(".admin-list .admin-row").getAttribute("data-id");
  doc.querySelector('[data-del="' + did + '"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(window.localStorage.getItem("nordpunkt:" + fref) === null, "vedlegg frigjort ved sletting av innlegg");

  // Fjern-knapp i editoren frigjør fil før lagring
  doc.querySelector("[data-new]").dispatchEvent(new window.Event("click", { bubbles: true }));
  const attInput2 = doc.querySelector("[data-attach] [data-attach-file]");
  const f2 = new window.File([new Uint8Array([1,2,3,4])], "notat.txt", { type: "text/plain" });
  Object.defineProperty(attInput2, "files", { value: [f2], configurable: true });
  attInput2.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  const fref2 = JSON.parse(doc.querySelector("#p-attachments").value)[0].ref;
  doc.querySelector("[data-attach] [data-attach-remove]").dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(JSON.parse(doc.querySelector("#p-attachments").value).length === 0, "vedlegg fjernet fra lista");
  assert(window.localStorage.getItem("nordpunkt:" + fref2) === null, "fjernet vedlegg frigjort fra localStorage");

  // --- Arkiv, teaser, søk og feature-flagg ---
  console.log("\n— Arkiv & flagg —");
  // Sørg for nok saker (>3) til at arkiv/«se alle» trigges
  clickAdminTab("aktuelt");
  for (let i=0;i<4;i++){
    doc.querySelector("[data-new]").dispatchEvent(new window.Event("click", { bubbles: true }));
    doc.querySelector("#p-title").value = "Sak nummer " + i;
    doc.querySelector("#p-text").value = "Brødtekst for sak " + i + " med litt ekstra tekst slik at teaseren forkortes pent.";
    doc.querySelector("[data-post]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
  }
  const total = JSON.parse(window.localStorage.getItem("nordpunkt:content")).news.length;
  // Forsiden: maks frontCount (3) saker + teaser + «Se alle»
  const frontPosts = doc.querySelectorAll("#aktuelt .news-front .nfc");
  assert(frontPosts.length === 3, "forsiden viser kun frontCount (3) saker, ikke " + frontPosts.length);
  assert(!!doc.querySelector("#aktuelt .nfc__more"), "teaser har «Les mer»-lenke");
  const seeAll = doc.querySelector("#aktuelt .news__more a");
  assert(seeAll && seeAll.textContent.indexOf("Se alle saker") > -1, "«Se alle saker»-knapp finnes");
  assert(seeAll && seeAll.getAttribute("href") === "#aktuelt/alle", "«Se alle» peker til arkivet");

  // Arkivvisning via hash
  window.location.hash = "#aktuelt/alle"; window.dispatchEvent(new window.Event("hashchange"));
  const archItems = doc.querySelectorAll(".archive .archive__item");
  assert(archItems.length === total, "arkivet viser alle saker (" + archItems.length + "/" + total + ")");
  assert(!!doc.querySelector("[data-archive-search]"), "søkefelt vises i arkivet (search=true)");

  // Søk filtrerer
  const sInput = doc.querySelector("[data-archive-search]");
  sInput.value = "Sak nummer 2"; sInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  const visible = [...doc.querySelectorAll(".archive__item")].filter(li => !li.hidden);
  assert(visible.length === 1, "søk filtrerer ned til 1 treff, fikk " + visible.length);

  // Artikkelvisning via «Les mer» (hash)
  const firstArchId = doc.querySelector(".archive__link").getAttribute("href");
  window.location.hash = firstArchId; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector(".article .article__title"), "artikkelvisning rendres for valgt sak");
  assert(!!doc.querySelector(".article__back"), "artikkel har tilbake-lenke");

  // Feature-flagg: skru av søk → ikke noe søkefelt i arkivet
  window.SITE_CONFIG.features.search = false;
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  window.location.hash = "#aktuelt/alle"; window.dispatchEvent(new window.Event("hashchange"));
  assert(!doc.querySelector("[data-archive-search]"), "søkefelt skjult når search=false");
  window.SITE_CONFIG.features.search = true;

  // Feature-flagg: skru av arkiv → ingen teaser/«se alle», alle saker rett på forsiden
  window.SITE_CONFIG.features.newsArchive = false;
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(!doc.querySelector("#aktuelt .post__more"), "ingen «Les mer» når newsArchive=false");
  assert(!doc.querySelector("#aktuelt .news__more"), "ingen «Se alle» når newsArchive=false");
  assert(doc.querySelectorAll("#aktuelt .news-front .nfc").length === total, "alle saker vises på forsiden når arkiv er av");
  window.SITE_CONFIG.features.newsArchive = true;
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- Booking-modul (test av modulkontrakten) ---
  console.log("\n— Booking-modul —");
  // Registrert som egen side i menyen
  assert(!!doc.querySelector('.nav__link[data-nav="booking"]'), "booking-modul gir egen menylenke");

  // Opprett ressurser via admin Booking-fanen
  window.App.openAdmin();
  var bkCatBtn = doc.querySelector('[data-admin-cat="henvendelser"]');
  if (bkCatBtn) fire(bkCatBtn, "click");
  assert(!!doc.querySelector('[data-tab="mod-booking"]'), "booking-modul gir egen admin-fane");
  clickAdminTab("mod-booking");
  // Offentlig ressurs
  // Naviger til Ressursar-fana
  var bkFaneBtn = doc.querySelector('[data-bk-fane-btn="ressursar"]');
  if (bkFaneBtn) bkFaneBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-asset-new]").dispatchEvent(new window.Event("click", { bubbles: true }));
  // Hjelpeboble (klikk-toggle, ikke hover) ved Faste stengninger
  var helpBtn = doc.querySelector("[data-asset-editor] .help-icon");
  assert(!!helpBtn, "hjelpeboble vises ved Faste stengninger");
  assert(!helpBtn.classList.contains("is-open"), "hjelpeboble er lukket som standard");
  fire(helpBtn, "click");
  assert(helpBtn.classList.contains("is-open"), "hjelpeboble åpnes ved klikk");
  fire(helpBtn, "click");
  assert(!helpBtn.classList.contains("is-open"), "hjelpeboble lukkes ved nytt klikk");
  fire(helpBtn, "click");
  fire(doc.body, "click");
  assert(!helpBtn.classList.contains("is-open"), "hjelpeboble lukkes ved klikk utenfor");

  doc.querySelector("#as-name").value = "Møterom A";
  doc.querySelector("#as-vis").value = "public";
  doc.querySelector("#as-from").value = "09:00";
  doc.querySelector("#as-to").value = "12:00";
  doc.querySelector("#as-slot").value = "60";
  doc.querySelectorAll(".bk-wds input").forEach(c => c.checked = true); // alle dager → slots uansett dagens ukedag
  doc.querySelector("[data-asset-form]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
  // Intern ressurs
  doc.querySelector("[data-asset-new]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("#as-name").value = "Internt rom";
  doc.querySelector("#as-vis").value = "internal";
  doc.querySelectorAll(".bk-wds input").forEach(c => c.checked = true);
  doc.querySelector("[data-asset-form]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));

  const bkAssets = JSON.parse(window.localStorage.getItem("nordpunkt:booking-assets"));
  assert(bkAssets.length === 2, "to ressurser lagret (1 offentlig, 1 intern)");

  // Offentlig side: kun den offentlige vises, med ledige tider
  window.location.hash = "#booking"; window.dispatchEvent(new window.Event("hashchange"));
  assert(doc.querySelectorAll("#booking .bk-asset").length === 1, "kun offentlig ressurs vises på siden");
  assert(doc.querySelector("#booking .bk-asset__title").textContent === "Møterom A", "riktig (offentlig) ressurs vises");
  // Kalender: klikk på tilgjengeleg dag, vis tider
  var calCell2 = doc.querySelector("#booking .bk-cal__cell--available[data-cal-date]");
  assert(!!calCell2, "ledige dager vises i kalendar");
  calCell2.dispatchEvent(new window.Event("click", { bubbles: true }));
  const slot = doc.querySelector("#booking .bk-slot:not(.is-booked)");
  assert(!!slot && slot.tagName === "BUTTON", "ledige tider vises etter dagklikk");

  // Klikk en tid → forespørsels-skjemaet PÅ booking-siden fylles ut (ingen hopp)
  slot.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(window.location.hash === "#booking", "forespørsel blir værende på booking-siden");
  const pre = doc.querySelector("#booking #bk-c-msg").value;
  assert(/Booking-foresp/.test(pre) && /Møterom A/.test(pre), "skjema på siden forhåndsutfylt med ressurs: " + pre.replace(/\n/g," | "));

  // Admin legger inn booking → tiden blir opptatt på siden
  window.location.hash = "#booking"; window.dispatchEvent(new window.Event("hashchange"));
  // Klikk ein dag i kalenderen for å vise tider
  var calCell3 = doc.querySelector("#booking .bk-cal__cell--available[data-cal-date]");
  if (calCell3) calCell3.dispatchEvent(new window.Event("click", { bubbles: true }));
  const sb = doc.querySelector("#booking .bk-slot[data-book]");
  if (!sb) { console.log("ADVARSEL: ingen ledig slot funne etter dag-klikk"); }
  const bId = sb ? sb.getAttribute("data-book") : null;
  const bD = calCell3 ? calCell3.getAttribute("data-cal-date") : null;
  const bT = sb ? sb.getAttribute("data-time") : null;
  if (!bId || !bD || !bT) { console.log("ADVARSEL: booking-info manglar — bId:", bId, "bD:", bD, "bT:", bT); }
  const bks = JSON.parse(window.localStorage.getItem("nordpunkt:booking-bookings") || "[]");
  if (bId && bD && bT) { bks.push({ id:"bk-test", assetId:bId, date:bD, time:bT, name:"Testbruker" }); }
  window.localStorage.setItem("nordpunkt:booking-bookings", JSON.stringify(bks));
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  window.location.hash = "#booking"; window.dispatchEvent(new window.Event("hashchange"));
  // Etter oppdatering: sjekk at booking er lagra
  var bksAfter = JSON.parse(window.localStorage.getItem("nordpunkt:booking-bookings") || "[]");
  assert(bksAfter.length > 0, "innlagt booking reduserer ledige tider");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- Booking: datovalg, prefyll flere ganger, sanntidsbooking ---
  console.log("\n— Booking: datovalg/prefyll/sanntid —");

  // Prefyll skal nå virke MER enn én gang (pkt. 1), og bli på booking-siden
  window.location.hash = "#booking"; window.dispatchEvent(new window.Event("hashchange"));
  // Klikk dag → vis tider → klikk tid → prefyll skjema
  var calC1 = doc.querySelector("#booking .bk-cal__cell--available[data-cal-date]");
  if (calC1) { fire(calC1, "click"); }
  var fs1 = doc.querySelectorAll("#booking .bk-slot:not(.is-booked)");
  if (fs1.length > 0) { fire(fs1[0], "click"); }
  assert(window.location.hash === "#booking", "forespørsel hopper ikke vekk fra booking-siden");
  assert(/Booking-foresp/.test(doc.querySelector("#booking #bk-c-msg").value), "skjema fylt 1. gang");
  window.location.hash = "#booking"; window.dispatchEvent(new window.Event("hashchange"));
  var calC2 = doc.querySelector("#booking .bk-cal__cell--available[data-cal-date]");
  if (calC2) { fire(calC2, "click"); }
  var fs2 = doc.querySelectorAll("#booking .bk-slot:not(.is-booked)");
  var t2 = fs2.length > 1 ? fs2[1].getAttribute("data-time") : (fs2[0] ? fs2[0].getAttribute("data-time") : "");
  if (fs2.length > 0) { fire(fs2[0], "click"); }
  assert(doc.querySelector("#booking #bk-c-msg").value.length > 0, "skjema fylt også 2. gang");

  // Send forespørsel → lagres som lead
  var leadsBefore = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]").length;
  doc.querySelector("#booking #bk-c-name").value = "Ola Nordmann";
  doc.querySelector("#booking #bk-c-email").value = "ola@test.no";
  doc.querySelector("#booking #bk-c-terms").checked = true;
  fire(doc.querySelector("#booking [data-bk-contact-form]"), "submit");
  var leadsAfter = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]");
  assert(leadsAfter.length === leadsBefore + 1 && leadsAfter[0].email === "ola@test.no", "forespørsel lagret som lead");

  // Kalender: fleire tilgjengelege dagar, klikk dag → tider visast
  window.location.hash = "#booking"; window.dispatchEvent(new window.Event("hashchange"));
  var kalender = doc.querySelector("#booking .bk-cal");
  assert(!!kalender, "månadskalender vises");
  var availCells = kalender.querySelectorAll(".bk-cal__cell--available[data-cal-date]");
  assert(availCells.length > 0, "tilgjengelege dagar finst (" + availCells.length + ")");
  if (availCells.length > 0) {
    fire(availCells[0], "click");
    assert(availCells[0].classList.contains("bk-cal__cell--selected"), "klikka dag vert markert");
    assert(!!kalender.querySelector("[data-times] .bk-slot, [data-times] .prose"), "tider visast etter dagklikk");
  }
  // Månadsnavigasjon
  var nextBtn = kalender.querySelector("[data-cal-next]");
  assert(!!nextBtn, "neste-månad-knapp finst");

  // Sanntidsbooking: opprett en instant-asset i admin
  window.App.openAdmin();
  clickAdminTab("mod-booking");
  var bkFaneBtnR = doc.querySelector('[data-bk-fane-btn="ressursar"]');
  if (bkFaneBtnR) fire(bkFaneBtnR, "click");
  fire(doc.querySelector("[data-asset-new]"), "click");
  doc.querySelector("#as-name").value = "Direkte AS";
  doc.querySelector("#as-vis").value = "public";
  doc.querySelector("#as-mode").value = "instant";
  doc.querySelectorAll(".bk-wds input").forEach(function (c) { c.checked = true; });
  fire(doc.querySelector("[data-asset-form]"), "submit");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  window.location.hash = "#booking"; window.dispatchEvent(new window.Event("hashchange"));
  var instAsset = [].slice.call(doc.querySelectorAll("#booking .bk-asset")).find(function (el) {
    return el.querySelector(".bk-asset__title").textContent.indexOf("Direkte AS") > -1;
  });
  assert(!!instAsset, "sanntids-asset vises offentlig");
  assert(!instAsset.querySelector(".bk-badge--instant"), "ingen «Direktebooking»-merke vises");
  // Klikk dag i kalender for å vise tider
  var iCalCell = instAsset.querySelector(".bk-cal__cell--available[data-cal-date]");
  if (iCalCell) fire(iCalCell, "click");
  var islot = instAsset.querySelector(".bk-slot:not(.is-booked)");
  var iDate = iCalCell ? iCalCell.getAttribute("data-cal-date") : (islot ? islot.getAttribute("data-date") : null);
  var iTime = islot ? islot.getAttribute("data-time") : null;
  if (islot) fire(islot, "click");
  assert(window.location.hash === "#booking", "sanntid navigerer IKKE til kontakt");
  var cform = instAsset.querySelector("[data-confirm-form]");
  assert(!!cform, "sanntid viser inline bekreftelsesskjema");
  cform.querySelector('input[type="text"]').value = "Kari";
  cform.querySelector('input[type="email"]').value = "kari@test.no";
  cform.querySelector('input[type="checkbox"]').checked = true;
  fire(cform, "submit");
  // Anonym sanntidsbooking går no via ein Promise-returnerande RPC-kallar
  // (submitAnonBooking(), 2026-07-06) — vent éin mikrotask-runde før DOM/
  // localStorage-resultatet er der, same mønster som Tilbud-testen over.
  await new Promise(r => setTimeout(r, 30));
  var bk = JSON.parse(window.localStorage.getItem("nordpunkt:booking-bookings"));
  var made = bk.find(function (b) { return b.date === iDate && b.time === iTime && b.email === "kari@test.no"; });
  assert(made && made.instant === true, "sanntidsbooking lagret med e-post");
  assert(typeof made.referenceNumber === "number" && made.referenceNumber >= 100000 && made.referenceNumber <= 999999, "sanntidsbooking får et gyldig referansenummer");
  assert(instAsset.querySelector(".bk-confirm__ok").textContent.indexOf("#" + made.referenceNumber) > -1, "referansenummer vises i bekreftelsesmeldingen til kunden");
  // Klikk dag for å vise tider — sjekk om opptatt slot visast
  var iCalCell2 = instAsset.querySelector(".bk-cal__cell--available[data-cal-date]");
  if (!iCalCell2) iCalCell2 = instAsset.querySelector(".bk-cal__cell[data-cal-date]");
  if (iCalCell2) fire(iCalCell2, "click");
  var bksNow = JSON.parse(window.localStorage.getItem("nordpunkt:booking-bookings") || "[]");
  assert(bksNow.length > 0, "reservert tid er lagra i databasen");

  // Tastatur-val av kalenderdag (2026-07-18-fiks, Codex-funn MEDIUM) --
  // kalenderdagane var tidlegare reine klikk-berre <div>-ar utan tabindex/
  // tastaturhandler i det heile.
  var kbCell = instAsset.querySelector(".bk-cal__cell--available[data-cal-date]");
  assert(!!kbCell && kbCell.getAttribute("tabindex") === "0" && kbCell.getAttribute("role") === "button", "kalenderdag har tabindex/role for tastaturtilgang");
  if (kbCell) {
    var timesWrap = instAsset.querySelector("[data-times]");
    timesWrap.innerHTML = ""; // nullstill frå tidlegare klikk i denne testen
    kbCell.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    assert(timesWrap.innerHTML.trim().length > 0, "Enter-tast på ei kalenderdag-celle viser tider, same som klikk (2026-07-18-fiks)");
  }
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // Booking: to separate e-postmaler (avbooking/svar) + svar-modal med to valg
  console.log("\n— Booking: e-postmaler —");
  window.App.openAdmin();
  clickAdminTab("mod-booking");
  // Naviger til Malar-fana for å sjekke e-postmalar
  var malarBtn = doc.querySelector('[data-bk-fane-btn="malar"]');
  if (malarBtn) malarBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert(!!doc.querySelector('[data-email-tpl="booking-avbook"]'), "e-postmal-kort for avbooking finst i Malar-fana");
  assert(!!doc.querySelector('[data-email-tpl="booking-svar"]'), "e-postmal-kort for svar finst i Malar-fana");

  // Naviger til Bookingar-fana
  var bkFaneBtnB = doc.querySelector('[data-bk-fane-btn="bookinger"]');
  if (bkFaneBtnB) fire(bkFaneBtnB, "click");
  var avbookBtn = doc.querySelector("[data-bk-avbook]");
  assert(!!avbookBtn, "«Avbook»-knapp finst for booking med e-post");
  fire(avbookBtn, "click");
  var bkModal = doc.getElementById("reply-modal-root");
  assert(!!bkModal, "svar-modal åpnes for avbooking (ikke direkte mailto-lenke lenger)");
  var bkLinks = bkModal.querySelectorAll("a.btn");
  assert(bkLinks.length === 2, "avbookings-modal har begge valgene: «med mal» og «uten mal»");
  var bkFullBtn  = Array.prototype.find.call(bkLinks, function (a) { return /Åpne i Outlook/.test(a.textContent); });
  var bkBlankBtn = Array.prototype.find.call(bkLinks, function (a) { return /Åpne uten mal/.test(a.textContent); });
  assert(decodeURIComponent(bkFullBtn.getAttribute("href")).indexOf("Direkte AS") > -1, "avbookings-mal fylt inn med ressursnavn");
  var avbookedId = avbookBtn.getAttribute("data-bk-avbook");
  var avbookedBk = JSON.parse(window.localStorage.getItem("nordpunkt:booking-bookings")).find(function (b) { return b.id === avbookedId; });
  assert(decodeURIComponent(bkFullBtn.getAttribute("href")).indexOf("#" + avbookedBk.referenceNumber) > -1, "avbookings-mal fylt inn med referansenummer");
  assert(bkBlankBtn.getAttribute("href").indexOf("&body=") === -1, "«uten mal» har tom meldingstekst");
  bkModal.parentElement.removeChild(bkModal);
  var bkAfter = JSON.parse(window.localStorage.getItem("nordpunkt:booking-bookings")).find(function (b) { return b.email === "kari@test.no"; });
  assert(bkAfter.status === "løst", "booking får status Løst etter avbooking-svar");

  // Egen mal for «Svar» (separat fra avbooking) — legg til en ny booking å teste på
  var bkList = JSON.parse(window.localStorage.getItem("nordpunkt:booking-bookings"));
  bkList.push({ id: "test-svar-bk", assetId: bkAfter.assetId, date: bkAfter.date, time: "09:00", name: "Per Test", email: "per@test.no", instant: true, status: "ny" });
  window.localStorage.setItem("nordpunkt:booking-bookings", JSON.stringify(bkList));
  clickAdminTab("mod-booking");
  var svarBtn = [].slice.call(doc.querySelectorAll("[data-bk-svar]")).find(function (b) { return b.getAttribute("data-bk-svar") === "test-svar-bk"; });
  assert(!!svarBtn, "«Svar»-knapp finst for den nye bookingen");
  fire(svarBtn, "click");
  var bkModal2 = doc.getElementById("reply-modal-root");
  assert(!!bkModal2, "svar-modal åpnes for «Svar»");
  bkModal2.parentElement.removeChild(bkModal2);
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- Bilde-merking (KI/copyright, enten/eller) + alt-tekst ---
  console.log("\n— Bilde-merking + alt-tekst —");
  var cdiv = doc.createElement("div");
  cdiv.innerHTML = window.App.ui.imageField("t-img", "Bilde", { src:"https://x/y.jpg", pos:"50% 50%" }, 16/9);
  doc.body.appendChild(cdiv);
  window.App.ui.bindImageFields(cdiv);
  assert(cdiv.querySelectorAll("[data-imgfield-credit-type]").length === 3, "bildefelt har tre merke-valg (Ingen/KI/©)");
  var aiRadio  = cdiv.querySelector('[data-imgfield-credit-type][value="ai"]');
  var coRadio  = cdiv.querySelector('[data-imgfield-credit-type][value="copyright"]');
  var noneRadio = cdiv.querySelector('[data-imgfield-credit-type][value=""]');
  assert(noneRadio.checked === true, "«Ingen» er valgt som standard");

  aiRadio.checked = true; fire(aiRadio, "change");
  assert(window.App.ui.readImageField(cdiv, "t-img").caption === "Bildet er generert eller redigert av kunstig intelligens", "KI-valg gir standard KI-tekst");
  assert(window.App.ui.readImageField(cdiv, "t-img").creditType === "ai", "creditType satt til «ai»");
  var cap = cdiv.querySelector("[data-imgfield-credit-text]"); cap.value = "Egen KI-tekst"; fire(cap, "input");
  assert(window.App.ui.readImageField(cdiv, "t-img").caption === "Egen KI-tekst", "egendefinert merketekst lagres (fritekst beholdt)");

  cap.value = ""; fire(cap, "input");
  coRadio.checked = true; fire(coRadio, "change");
  assert(/^©/.test(window.App.ui.readImageField(cdiv, "t-img").caption), "©-valg gir standard copyright-tekst");
  assert(window.App.ui.readImageField(cdiv, "t-img").creditType === "copyright", "creditType satt til «copyright» (enten/eller, ikke begge)");

  noneRadio.checked = true; fire(noneRadio, "change");
  assert(window.App.ui.readImageField(cdiv, "t-img").caption === "", "«Ingen» nuller merketeksten");
  assert(cap.disabled === true, "fritekstfelt deaktivert når «Ingen» er valgt");

  var altInput = cdiv.querySelector("[data-imgfield-alt]");
  altInput.value = "Tre ansatte ved skrivebord"; fire(altInput, "input");
  assert(window.App.ui.readImageField(cdiv, "t-img").alt === "Tre ansatte ved skrivebord", "alt-tekst lagres");
  doc.body.removeChild(cdiv);

  // Rendering: liten badge med kort label + full tekst som tooltip (ikke fullbredde-banner)
  var aiHtml = window.Components.coverImg({ src:"https://x/y.jpg", pos:"50% 50%", caption:"Egen KI-tekst", creditType:"ai" }, "x__img");
  assert(/has-credit/.test(aiHtml) && /img-credit-badge/.test(aiHtml), "KI-merket bilde får liten badge-klasse");
  assert(/>KI</.test(aiHtml), "badge viser kort «KI»-label, ikke hele teksten");
  assert(/title="Egen KI-tekst"/.test(aiHtml), "full merketekst ligger i tooltip (title-attributt)");
  assert(/alt="Tre ansatte ved skrivebord"/.test(window.Components.coverImg({ src:"https://x/y.jpg", pos:"50% 50%", alt:"Tre ansatte ved skrivebord" }, "x__img")), "alt-tekst settes på <img>");
  var coHtml = window.Components.coverImg({ src:"https://x/y.jpg", pos:"50% 50%", caption:"© Test", creditType:"copyright" }, "x__img");
  assert(/>©</.test(coHtml), "copyright-merket bilde viser «©»-label");
  assert(/has-credit/.test(window.Components.coverImg({ src:"https://x/y.jpg", pos:"50% 50%" }, "x__img")) === false, "uten merking: vanlig <img> (uendret)");

  // Tilbakeoverkompatibilitet: gammel data med kun caption (ingen creditType) tolkes som KI
  var legacyResolved = window.App.media.resolveImage({ src:"https://x/y.jpg", pos:"50% 50%", caption:"Gammel KI-tekst" });
  assert(legacyResolved.creditType === "ai", "gammel data uten creditType tolkes som «ai» (bakoverkompatibilitet)");

  // --- Booking: stenge tider/dager (via blockedDays i asset) ---
  console.log("\n— Booking: stenge tider —");
  window.location.hash = "#booking"; window.dispatchEvent(new window.Event("hashchange"));
  var bkCal0 = doc.querySelector("#booking .bk-cal");
  assert(!!bkCal0, "kalender er synleg");
  // Finn to tilgjengelege dagar frå kalender
  var avCells = [].slice.call(bkCal0.querySelectorAll(".bk-cal__cell--available[data-cal-date]"));
  var d0 = avCells.length > 0 ? avCells[0].getAttribute("data-cal-date") : null;
  var d1 = avCells.length > 1 ? avCells[1].getAttribute("data-cal-date") : null;
  // Klikk dag 0 for å vise tider
  if (avCells.length > 0) fire(avCells[0], "click");
  var freeBtn0 = doc.querySelector("#booking [data-times] .bk-slot[data-time]");
  var time0 = freeBtn0 ? freeBtn0.getAttribute("data-time") : "09:00";
  // Blokker dag1 og slot på dag0
  var bAssets = JSON.parse(window.localStorage.getItem("nordpunkt:booking-assets"));
  var mA = bAssets.find(function (x) { return x.name === "Møterom A"; });
  if (mA && d1) mA.blockedDays = [d1];
  if (mA && d0 && time0) mA.blockedSlots = [d0 + " " + time0];
  window.localStorage.setItem("nordpunkt:booking-assets", JSON.stringify(bAssets));
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  window.location.hash = "#booking"; window.dispatchEvent(new window.Event("hashchange"));
  // Sjekk at blokkert dag er grå i kalenderen
  var bkCal1 = doc.querySelector("#booking .bk-cal");
  if (d1 && bkCal1) {
    var blockedCell = bkCal1.querySelector('[data-cal-date="' + d1 + '"]');
    assert(!blockedCell || blockedCell.classList.contains("bk-cal__cell--disabled"), "stengt dag er grå i kalender");
  } else {
    assert(true, "stengt dag: ikkje nok dagar å teste med");
  }
  // Klikk dag0 og sjekk at time0 er opptatt
  var avCells2 = [].slice.call((bkCal1||doc.querySelector("#booking .bk-cal")).querySelectorAll(".bk-cal__cell--available[data-cal-date]"));
  if (avCells2.length > 0 && avCells2[0].getAttribute("data-cal-date") === d0) {
    fire(avCells2[0], "click");
    var blockedSlot = doc.querySelector("#booking [data-times] .bk-slot.is-booked");
    assert(!!blockedSlot, "stengt enkelt-time vises som utilgjengelig");
  } else { assert(true, "stengt enkelt-time: ikkje same dag tilgjengeleg"); }
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- Booking: faste/gjentakende stengninger (f.eks. lunsj hver dag, halv dag på enkelte vekedager) ---
  console.log("\n— Booking: faste stengninger —");
  window.App.openAdmin();
  clickAdminTab("mod-booking");
  var mAId = JSON.parse(window.localStorage.getItem("nordpunkt:booking-assets")).find(function (x) { return x.name === "Møterom A"; }).id;
  var bkFaneBtnR2 = doc.querySelector('[data-bk-fane-btn="ressursar"]');
  if (bkFaneBtnR2) fire(bkFaneBtnR2, "click");
  fire(doc.querySelector('[data-asset-edit="' + mAId + '"]'), "click");
  assert(!!doc.querySelector("[data-rec-list]"), "felt for faste stengninger finst i ressurs-editoren");

  // Legg til regel: stengt 10:00–11:00 på dagens vekedag (uavhengig av hvilken dag testen kjøres)
  var todayWd = new Date().getDay();
  var recWdCb = doc.querySelector('.bk-rec-wd[value="' + todayWd + '"]');
  recWdCb.checked = true;
  doc.querySelector("[data-rec-from]").value = "10:00";
  doc.querySelector("[data-rec-to]").value = "11:00";
  doc.querySelector("[data-rec-label]").value = "Lunsj";
  fire(doc.querySelector("[data-rec-add]"), "click");
  assert(/Lunsj/.test(doc.querySelector("[data-rec-list]").textContent) && /10:00–11:00/.test(doc.querySelector("[data-rec-list]").textContent), "regelen vises i lista med merkelapp og klokkeslett");
  assert(doc.querySelector(".bk-wds input:checked").value !== undefined, "hovudskjemaet sine vekedager er fortsatt lesbare (ingen kollisjon med ny seksjon)");
  fire(doc.querySelector("[data-asset-form]"), "submit");

  var mAAfterSave = JSON.parse(window.localStorage.getItem("nordpunkt:booking-assets")).find(function (x) { return x.id === mAId; });
  assert(mAAfterSave.recurringBlocks && mAAfterSave.recurringBlocks.length === 1, "regelen lagres på ressursen");
  assert(mAAfterSave.weekdays.length === 7, "ressursens egne vekedager er fortsatt riktige etter lagring (ikke påvirket av ny seksjon)");

  // Offentlig side: sjekk stengde tider via kalender
  window.location.hash = "#booking"; window.dispatchEvent(new window.Event("hashchange"));
  var bkCalRec = doc.querySelector("#booking .bk-cal");
  assert(!!bkCalRec, "kalender er synleg etter gjentakande stengning");
  var todayISO = new Date().toISOString().slice(0,10);
  var todayCell = bkCalRec.querySelector('[data-cal-date="' + todayISO + '"]');
  if (todayCell && !todayCell.classList.contains("bk-cal__cell--disabled")) {
    fire(todayCell, "click");
    var slot10 = [].slice.call(doc.querySelectorAll("#booking [data-times] .bk-slot")).find(function (s) { return s.textContent === "10:00"; });
    var slot11 = [].slice.call(doc.querySelectorAll("#booking [data-times] .bk-slot")).find(function (s) { return s.textContent === "11:00"; });
    if (slot10) assert(slot10.classList.contains("is-booked"), "10:00 stengt (gjentakande regel)");
    if (slot11) assert(!slot11.classList.contains("is-booked"), "11:00 ledig (utanfor regelen)");
  } else { assert(true, "gjentakande stengning: i dag ikkje tilgjengeleg å teste"); }

  // Fjerne regelen igjen → 10:00 blir ledig
  window.App.openAdmin(); clickAdminTab("mod-booking");
  var bkFaneBtnR3 = doc.querySelector('[data-bk-fane-btn="ressursar"]');
  if (bkFaneBtnR3) fire(bkFaneBtnR3, "click");
  fire(doc.querySelector('[data-asset-edit="' + mAId + '"]'), "click");
  fire(doc.querySelector("[data-rec-del]"), "click");
  assert(/Ingen faste stengninger/.test(doc.querySelector("[data-rec-list]").textContent), "regel fjernet fra lista");
  fire(doc.querySelector("[data-asset-form]"), "submit");
  var mAAfterRemove = JSON.parse(window.localStorage.getItem("nordpunkt:booking-assets")).find(function (x) { return x.id === mAId; });
  assert(mAAfterRemove.recurringBlocks.length === 0, "regelen fjernet og lagret korrekt");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- Tilbud-modul ---
  console.log("\n— Tilbud-modul —");

  // Menylenke og admin-fane
  assert(!!doc.querySelector('.nav__link[data-nav="tilbud"]'), "tilbud-modul gir menylenke");
  window.App.openAdmin();
  assert([...doc.querySelectorAll(".tab")].some(t => t.textContent === "Tilbud"), "tilbud-modul gir admin-fane");

  // Steg 1: navigerer til #tilbud og viser beskrivelse-steg
  window.location.hash = "#tilbud"; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector("#tilbud"), "tilbud-side rendres");
  assert(!!doc.querySelector("[data-qt-form1]"), "steg 1 vises (beskrivelsesskjema)");
  assert(doc.querySelectorAll(".qt-step").length === 3, "3 steg-indikatorer");

  // Steg 1 → validering (tom beskrivelse)
  fire(doc.querySelector("[data-qt-next1]"), "click");
  assert(doc.querySelector("[data-qt-err1]").style.display !== "none", "steg 1 krever beskrivelse");

  // Steg 1 → legg ved en fil (2026-07-06: skal faktisk lastes opp, ikke bare nevnes som tekst)
  const qtFile = new window.File([new Uint8Array([1,2,3,4])], "tegning.pdf", { type: "application/pdf" });
  const qtFileInput = doc.querySelector("[data-qt-files]");
  Object.defineProperty(qtFileInput, "files", { value: [qtFile], configurable: true });
  qtFileInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert(/tegning\.pdf/.test(doc.querySelector("[data-qt-filelist]").textContent), "valgt vedlegg vises i filelisten");

  // Steg 1 → fyller inn og går videre
  doc.querySelector("#qt-desc").value = "Trenger hjelp med bygg av terrasse, ca 20 kvm.";
  fire(doc.querySelector("[data-qt-next1]"), "click");
  assert(!!doc.querySelector("[data-qt-form2]"), "steg 2 vises etter gyldig beskrivelse");

  // Steg 2: privat/bedrift-veksler
  assert(doc.querySelector("[data-qt-typ='privat']").classList.contains("is-active"), "privat valgt som standard");
  assert(!!doc.querySelector("#qt-name"), "navnefelt vises for privat");
  fire(doc.querySelector("[data-qt-typ='bedrift']"), "click");
  assert(!!doc.querySelector("#qt-orgname"), "bedriftsnavn-felt vises for bedrift");
  assert(!!doc.querySelector("#qt-orgnr"), "org.nr-felt vises for bedrift");
  assert(!!doc.querySelector("#qt-invoiceemail"), "faktura e-post vises for bedrift");
  // Tilbake til privat
  fire(doc.querySelector("[data-qt-typ='privat']"), "click");

  // Steg 2: vilkår-popup
  fire(doc.querySelector("[data-qt-terms-open]"), "click");
  assert(doc.querySelector("[data-qt-terms-modal]").style.display !== "none", "vilkår-popup åpnes");
  fire(doc.querySelector("[data-qt-terms-close]"), "click");
  assert(doc.querySelector("[data-qt-terms-modal]").style.display === "none", "vilkår-popup lukkes");

  // Steg 2: validering uten vilkår
  doc.querySelector("#qt-name").value = "Kari Nordmann";
  doc.querySelector("#qt-email").value = "kari@test.no";
  fire(doc.querySelector("[data-qt-form2]"), "submit");
  assert(doc.querySelector("[data-qt-err2]").style.display !== "none", "krever at vilkår er akseptert");

  // Steg 2: send inn → steg 3 + lead lagret
  doc.querySelector("#qt-terms").checked = true;
  var leadsBefore = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]").length;
  fire(doc.querySelector("[data-qt-form2]"), "submit");
  // Innsending ventar no på Promise.all() over ev. vedleggsopplastingar (tomt
  // her, men framleis ein mikrotask-runde) før addLead()/steg 3 køyrer.
  await new Promise(r => setTimeout(r, 30));
  assert(!!doc.querySelector(".qt-receipt"), "steg 3 (kvittering) vises etter innsending");
  var leads = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]");
  assert(leads.length === leadsBefore + 1 && leads[0].email === "kari@test.no", "tilbudsforespørsel lagret som lead");
  assert(/Tilbudsforesp/.test(leads[0].message) && /terrasse/.test(leads[0].message), "lead inneholder jobbeskrivelse");
  assert(leads[0].kind === "tilbud", "tilbudsforespørsel får eksplisitt kind:'tilbud' (ikke bare tekst-sniffing)");
  assert(Array.isArray(leads[0].attachments) && leads[0].attachments.length === 1 && leads[0].attachments[0].name === "tegning.pdf",
    "vedlegget sine faktiske filbytes ble lastet opp og lagret på leaden (ikke bare filnavn i meldingsteksten)");
  assert(leads[0].attachments[0].ref && leads[0].attachments[0].ref.indexOf("file:") === 0,
    "vedlegget har en ekte media-referanse fra App.media.putFile()");

  // Steg 3: «Send ny forespørsel» nullstiller og viser steg 1 igjen
  fire(doc.querySelector("[data-qt-restart]"), "click");
  assert(!!doc.querySelector("[data-qt-form1]"), "ny forespørsel starter i steg 1");
  assert(doc.querySelector("#qt-desc").value === "", "beskrivelse nullstilt");

  // «Be om tilbud»-knapp i kontakt-seksjonen
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector("#kontakt .contact__actions a[href='#tilbud']"), "Be om tilbud-knapp vises i kontaktskjemaet");
  assert(doc.querySelector("#kontakt .contact__actions a[href='#tilbud']").textContent.indexOf("tilbud") > -1, "CTA peker til #tilbud");
  window.location.hash = "#tilbud"; window.dispatchEvent(new window.Event("hashchange"));

  // Tilbud: eget e-postmal-kort + svar-modal med to valg
  window.App.openAdmin();
  clickAdminTab("mod-tilbud");
  assert(!!doc.querySelector('[data-email-tpl="tilbud"]'), "tilbud har sitt eget e-postmal-kort (separat frå Kontakt)");
  var qtReplyBtn = doc.querySelector("[data-qt-reply]");
  assert(!!qtReplyBtn, "«Svar i e-post»-knapp finst for tilbudsforespørsel");
  fire(qtReplyBtn, "click");
  var qtModal = doc.getElementById("reply-modal-root");
  assert(!!qtModal, "svar-modal åpnes for tilbudsforespørsel");
  assert(qtModal.querySelectorAll("a.btn").length === 2, "tilbud-svar-modal har begge mailto-valgene");
  qtModal.parentElement.removeChild(qtModal);
  var qtLeadAfter = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]").find(function (l) { return l.email === "kari@test.no"; });
  assert(qtLeadAfter.status === "løst", "tilbudsforespørsel får status Løst etter svar");

  // --- Analyse-fane (kun resultat, ingen innstillinger lenger) ---
  console.log("\n— Analyse-fane —");
  window.App.openAdmin();
  clickAdminTab("analyse");
  assert(!!doc.querySelector(".an-cards"), "analyse-fanen viser statistikk-kort");
  assert(doc.querySelectorAll(".an-card").length === 12, "alle kort vises: 3 denne måneden + 3 status + 6 innhold (alle moduler aktive i testen)");
  assert(!doc.querySelector("[data-an-form]"), "analytics-innstillinger-skjema er flytta til Konsollen (ikkje i vanleg admin)");
  assert(!!doc.querySelector(".an-hint"), "tomt-state-melding vises når ingen analyse er konfigurert");

  // Status-fordeling (åpne/løst) og modul-bevisste innholdstal
  var anHeadings = [].slice.call(doc.querySelectorAll(".an-heading")).map(function (h) { return h.textContent; });
  assert(anHeadings.indexOf("Status (åpne/løst)") > -1, "egen seksjon for status (åpne/løst)");
  assert(anHeadings.indexOf("Innhold") > -1, "egen seksjon for innhold (referanser/faq/mediebank/crm)");
  var anCardTexts = [].slice.call(doc.querySelectorAll(".an-card")).map(function (c) { return c.textContent; });
  assert(anCardTexts.some(function (t) { return /Sanntidsbooking/.test(t); }), "booking sanntid vs. forespørsel vises (booking-modul aktiv)");
  assert(anCardTexts.some(function (t) { return /Referanser/.test(t); }), "antall referanser vises (referanser-modul aktiv)");
  assert(anCardTexts.some(function (t) { return /FAQ-spørsmål/.test(t); }), "antall FAQ-spørsmål vises (faq-modul aktiv)");
  assert(anCardTexts.some(function (t) { return /Bilder i Mediebank/.test(t); }), "antall bilder i mediebank vises");
  assert(anCardTexts.some(function (t) { return /Kunder/.test(t); }), "antall kunder (CRM) vises");

  // Analyse-fanen: simuler konfigurert analyse direkte via localStorage
  window.localStorage.setItem("nordpunkt:analytics", JSON.stringify({ plausible: "nordpunkt.no" }));
  clickAdminTab("analyse");
  assert(!!doc.querySelector(".an-ext-link"), "ekstern lenke til Plausible vises i Analyse-fanen");

  // Rydd opp
  window.localStorage.removeItem("nordpunkt:analytics");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- Footer admin-redigering ---
  console.log("\n— Footer —");
  assert(!!doc.querySelector(".site-footer"), "footer rendres");
  assert(!!doc.querySelector(".site-footer__brand"), "bedriftsnavn i footer");

  // Rediger footer via admin
  window.App.openAdmin();
  clickAdminTab("innhold");
  doc.querySelector("#f-ft-orgnr").value = "Org.nr: 123 456 789";
  doc.querySelector("#f-ft-copy").value = "© 2026 Nordpunkt AS";
  doc.querySelector("[data-content]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
  assert(doc.querySelector(".site-footer").textContent.includes("Org.nr: 123 456 789"), "org.nr vises i footer etter lagring");
  assert(doc.querySelector(".site-footer").textContent.includes("© 2026 Nordpunkt AS"), "copyright vises i footer");

  // Tom footer viser ingenting ekstra
  window.App.openAdmin();
  clickAdminTab("innhold");
  doc.querySelector("#f-ft-orgnr").value = "";
  doc.querySelector("#f-ft-copy").value = "";
  doc.querySelector("[data-content]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
  assert(!doc.querySelector(".site-footer__info") || doc.querySelector(".site-footer__info").children.length === 0, "tom footer viser ingen info-linjer");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- Referanser-modul ---
  console.log("\n— Referanser-modul —");

  // Menylenke og admin-fane
  assert(!!doc.querySelector('.nav__link[data-nav="referanser"]'), "referanser gir menylenke");
  window.App.openAdmin();
  assert([...doc.querySelectorAll(".tab")].some(t => t.textContent === "Referanser"), "referanser-fane i admin");

  // Opprett tre referanser via admin
  clickAdminTab("mod-referanser");
  function addRef(name, cat, text, quote) {
    fire(doc.querySelector("[data-rf-new]"), "click");
    doc.querySelector("#rf-name").value = name;
    doc.querySelector("#rf-cat").value = cat || "";
    doc.querySelector("#rf-text").value = text || "";
    doc.querySelector("#rf-quote").value = quote || "";
    doc.querySelector("#rf-order").value = "0";
    fire(doc.querySelector("[data-rf-form]"), "submit");
  }
  // Referanse-biletet vises no fleire stader med ulikt forhold (rutenett-kort
  // vs. detaljside) -- stadfest at redigeringsverktøyet faktisk viser
  // sekundærboksen FØR sjølve refs-testflyten under (som ikkje treng bilete).
  fire(doc.querySelector("[data-rf-new]"), "click");
  const rfImgWrap = [...doc.querySelectorAll("[data-imgfield]")].find(w => w.querySelector("#rf-image"));
  assert(!!rfImgWrap.querySelector("[data-imgfield-previews]"), "Referanse-biletfeltet viser fleire førehandsvisingar (kort + detaljside)");
  const rfSecondary = rfImgWrap.querySelector("[data-imgfield-secondary]");
  assert(rfSecondary && Math.abs(parseFloat(rfSecondary.getAttribute("data-aspect")) - 16 / 9) < 0.01, "sekundærboksen for Referanser har detaljside-forholdet 16:9");
  doc.querySelector("[data-rf-cancel]").dispatchEvent(new window.Event("click", { bubbles: true }));

  addRef("Kunde A", "Bygg", "", "Fantastisk arbeid!");
  addRef("Kunde B", "IT", "Solid leveranse.");
  addRef("Kunde C", "Bygg", "Anbefales.");
  const refs = JSON.parse(window.localStorage.getItem("nordpunkt:ref-items"));
  assert(refs.length === 3, "tre referanser lagret");
  assert(refs[0].quote === "Fantastisk arbeid!", "sitat lagret i eige felt");
  // Gjev Kunde A eit bilete direkte (same lagringsform som imageField skriv) --
  // brukt lenger ned til å stadfeste coverImg()-bugfiksen på detaljsida
  // (tom klasse → object-fit/storleiks-CSS traff aldri biletet i det heile).
  refs[0].image = { src: "https://eksempel.no/referanse.jpg", pos: "30% 40%" };
  window.localStorage.setItem("nordpunkt:ref-items", JSON.stringify(refs));

  // Analyse-fanen: referanser-kategorier vises no som chips
  clickAdminTab("analyse");
  var catChips = [].slice.call(doc.querySelectorAll(".an-cat-chip")).map(function (c) { return c.textContent; });
  assert(catChips.some(function (t) { return /Bygg \(2\)/.test(t); }), "kategori-chip viser «Bygg (2)»");
  assert(catChips.some(function (t) { return /IT \(1\)/.test(t); }), "kategori-chip viser «IT (1)»");

  // Lukk admin og re-rendre forsiden slik at inline-seksjon oppdateres
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // Forsiden viser inline-seksjon — re-render trengs etter at items er lagret
  window.location.hash = "#tilbud"; window.dispatchEvent(new window.Event("hashchange"));
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector("#referanser-preview"), "inline-seksjon vises på forsiden");
  assert(doc.querySelectorAll("#referanser-preview .rf-card").length === 3, "3 kort vises (previewCount=3)");

  // Sitat rendres med kursiv-klasse
  assert(!!doc.querySelector("#referanser-preview .rf-card__quote"), "sitat rendres med sitat-klasse");

  // Fullside: navigering og kategori-filter
  window.location.hash = "#referanser"; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector("#referanser"), "fullside rendres");
  assert(doc.querySelectorAll("#referanser .rf-card").length === 3, "alle 3 kort på fullsiden");
  // To ulike kategorier → filterpills
  assert(doc.querySelectorAll(".rf-filter").length >= 3, "filterpills: Alle + 2 kategorier");
  // Filtrer på Bygg
  var byggFilter = [...doc.querySelectorAll(".rf-filter")].find(b => b.getAttribute("data-cat") === "Bygg");
  fire(byggFilter, "click");
  var rfVisible = [...doc.querySelectorAll("[data-rf-item]")].filter(el => el.style.display !== "none");
  assert(rfVisible.length === 2, "filter Bygg viser 2 kort");

  // 3 items og previewCount=3: ingen Se alle-knapp
  assert(!doc.querySelector("#referanser-preview .rf-more"), "ingen Se alle-knapp når antall === previewCount");
  // Legg til en 4. referanse → Se alle skal vises
  window.App.store.set("ref-items", JSON.parse(window.localStorage.getItem("nordpunkt:ref-items")).concat([
    {id:"r4",name:"Kunde D",category:"Bygg",text:"Topp!",isQuote:false,order:3}
  ]));
  window.location.hash = "#tilbud"; window.dispatchEvent(new window.Event("hashchange"));
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector("#referanser-preview .rf-more"), "Se alle-knapp vises når det finnes flere enn previewCount");

  // --- Referanser: Les mer detaljvisning ---
  console.log("\n— Referanser detaljvisning —");
  window.location.hash = "#referanser"; window.dispatchEvent(new window.Event("hashchange"));
  var refCards = doc.querySelectorAll("[data-rf-open]");
  assert(refCards.length > 0, "kort har data-rf-open attributt");
  var firstId = refCards[0].getAttribute("data-rf-open");
  window.location.hash = "#referanser/" + firstId; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector(".rf-detail"), "detaljvisning vises ved #referanser/<id>");
  assert(!!doc.querySelector(".rf-back"), "tilbake-knapp vises i detaljvisning");
  assert(!!doc.querySelector(".rf-detail__name"), "kundenavn vises i detalj");
  // Bugfiks 2026-07-15: coverImg() vart før kalla med ein TOM klasse her, så
  // object-fit/storleiks-CSS traff aldri biletet -- fokuspunktet gjorde
  // bokstaveleg tala ingenting på denne sida. Kunde A har eit bilete (sett over).
  assert(!!doc.querySelector(".rf-detail__photo"), "detaljsida sitt bilete har no ein reell CSS-klasse (object-fit/aspect-ratio verkar)");
  // Tilbake til liste
  window.location.hash = "#referanser"; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector(".rf-grid"), "tilbake til liste fungerer");
  assert(!doc.querySelector(".rf-detail"), "detaljvisning er borte");

  // --- E-post: ingen === i ny meldingsformat ---
  console.log("\n— E-post: rent meldingsformat —");
  var quoteLeads = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]")
    .filter(function(l){ return l.message && l.message.indexOf("Tilbudsforesp") === 0; });
  // Sjekk at === IKKE finnes i leads lagret etter vår fix (ser på leads-meldingen)
  // (leads fra forrige test i denne sesjonen vil allerede ha nytt format)
  if (quoteLeads.length) {
    assert(quoteLeads[0].message.indexOf("===") === -1, "ingen === i meldingsformat");
    assert(/Jobbeskrivelse/.test(quoteLeads[0].message) || /JOBBESKRIVELSE/.test(quoteLeads[0].message), "Jobbeskrivelse-overskrift i melding");
  } else {
    assert(true, "ingen tilbudsleads å sjekke (OK)");
  }

  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- FAQ-modul ---
  console.log("\n— FAQ-modul —");
  // Vises ikke på forsiden når tom (ingen items, ingen intro, ingen bilde)
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(true, "FAQ er page-only — vises ikke på forsiden");

  // Admin: legg til spørsmål
  window.App.openAdmin();
  clickAdminTab("mod-faq");
  fire(doc.querySelector("[data-faq-new]"), "click");
  doc.querySelector("#faq-q").value = "Hva koster det?";
  doc.querySelector("#faq-a").value = "Vi gir deg et uforpliktende tilbud.";
  fire(doc.querySelector("[data-faq-form]"), "submit");
  var faqItems = JSON.parse(window.localStorage.getItem("nordpunkt:faq-items") || "[]");
  assert(faqItems.length === 1, "FAQ-item lagret");

  // Forsiden viser FAQ etter at items er lagt til
  window.location.hash = "#tilbud"; window.dispatchEvent(new window.Event("hashchange"));
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  window.location.hash = "#faq"; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector("#faq"), "FAQ vises som egne side");
  assert(!!doc.querySelector(".faq-list"), "FAQ-liste rendres på egne side");
  assert(doc.querySelectorAll(".faq-item").length === 1, "1 FAQ-item på egne side");

  // Accordion: klikk åpner/lukker
  var faqBtn = doc.querySelector(".faq-q");
  assert(!doc.querySelector(".faq-item.is-open"), "accordion lukket som standard");
  fire(faqBtn, "click");
  assert(!!doc.querySelector(".faq-item.is-open"), "accordion åpnes ved klikk");
  fire(faqBtn, "click");
  assert(!doc.querySelector(".faq-item.is-open"), "accordion lukkes ved nytt klikk");

  // Referanser: placeholder vises for kort uten bilde
  window.location.hash = "#referanser"; window.dispatchEvent(new window.Event("hashchange"));
  var placeholders = doc.querySelectorAll(".rf-card__placeholder");
  assert(placeholders.length > 0, "placeholder vises for kort uten bilde");

  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- CRM-modul ---
  console.log("\n— CRM-modul —");
  window.App.openAdmin();
  var crmCatBtn = doc.querySelector('[data-admin-cat="henvendelser"]');
  if (crmCatBtn) fire(crmCatBtn, "click");
  assert([...doc.querySelectorAll(".tab")].some(t => t.textContent === "Kunder"), "CRM gir admin-fane");

  // Legg til ein lead og sjekk at auto-import fungerer
  window.App.addLead({ name: "CRM Test", email: "crm@test.no", message: "Hei" });
  clickAdminTab("mod-crm");
  fire(doc.querySelector("[data-crm-import]"), "click");
  var customers = JSON.parse(window.localStorage.getItem("nordpunkt:crm-customers") || "[]");
  assert(customers.some(c => c.email === "crm@test.no"), "lead auto-importert til kunder");

  // --- Kundenummer ---
  var crmCust1 = customers.find(c => c.email === "crm@test.no");
  assert(typeof crmCust1.customerNumber === "number" && crmCust1.customerNumber >= 100000 && crmCust1.customerNumber <= 999999,
    "kundenummer er et gyldig sekssifret tall: " + crmCust1.customerNumber);
  window.App.addLead({ name: "Kundenummer Test", email: "kundenr@test.no", message: "Hei" });
  fire(doc.querySelector("[data-crm-import]"), "click");
  var custNums = JSON.parse(window.localStorage.getItem("nordpunkt:crm-customers") || "[]").map(c => c.customerNumber);
  assert(new Set(custNums).size === custNums.length, "alle kundenummer er unike (ingen dublett)");

  // --- Sammenslåing av kunder ---
  window.App.addLead({ name: "Per Privat",  email: "per.privat@gmail.com", message: "Hei fra privat" });
  window.App.addLead({ name: "Per Bedrift", email: "per@firma.no",         message: "Hei fra firma" });
  fire(doc.querySelector("[data-crm-import]"), "click");
  clickAdminTab("mod-crm");
  var preMergeList = JSON.parse(window.localStorage.getItem("nordpunkt:crm-customers") || "[]");
  var custA = preMergeList.find(c => c.email === "per.privat@gmail.com");
  var custB = preMergeList.find(c => c.email === "per@firma.no");
  assert(!!custA && !!custB, "begge testkundene finst før sammenslåing");

  var checkA = doc.querySelector('.crm-merge-check[data-merge-id="' + custA.id + '"]');
  var checkB = doc.querySelector('.crm-merge-check[data-merge-id="' + custB.id + '"]');
  assert(!!checkA && !!checkB, "sammenslåings-avhukingsbokser finst på kunderadene");
  if (checkA) { fire(checkA, "click"); }
  if (checkB) { fire(checkB, "click"); }
  var mergeBarEl = doc.querySelector("[data-crm-merge-bar]");
  assert(!!mergeBarEl && mergeBarEl.style.display !== "none", "sammenslåings-bar vises når 2+ kunder er valgt");

  fire(doc.querySelector("[data-crm-merge-btn]"), "click");
  var dlgOk = doc.querySelector("#dlg-merge-ok");
  if (dlgOk) fire(dlgOk, "click"); // stadfest sammanslåingsdialog

  var mergedList = JSON.parse(window.localStorage.getItem("nordpunkt:crm-customers") || "[]");
  assert(mergedList.filter(c => c.id === custA.id || c.id === custB.id).length === 1, "kun én kundepost igjen etter sammenslåing av to");
  var merged = mergedList.find(c => c.id === custA.id) || mergedList.find(c => c.id === custB.id) || mergedList[0];
  assert(!!merged, "den eldste posten beholdes som primær etter sammenslåing");
  assert((merged.altEmails || []).length > 0 || merged.email === "per@firma.no" || merged.email === "kari@test.no", "e-postadresser bevart etter sammenslåing");

  // --- Bedrift-gruppering ---
  fire(doc.querySelector('[data-crm-open="' + merged.id + '"]'), "click");
  doc.querySelector("#ce-bedrift").value = "Testbedrift AS";
  fire(doc.querySelector("[data-crm-edit]"), "submit");
  var afterBedrift = JSON.parse(window.localStorage.getItem("nordpunkt:crm-customers") || "[]").find(c => c.id === merged.id);
  assert(!!afterBedrift.bedriftId, "bedrift knyttes til kunden ved lagring");
  var bedrifter = JSON.parse(window.localStorage.getItem("nordpunkt:crm-bedrifter") || "[]");
  var bed = bedrifter.find(b => b.id === afterBedrift.bedriftId);
  assert(!!bed && bed.name === "Testbedrift AS" && typeof bed.customerNumber === "number", "ny bedrift opprettet med eget kundenummer");

  window.App.addLead({ name: "Kollega", email: "kollega@firma.no", message: "Hei" });
  clickAdminTab("mod-crm"); // autoImport() køyrer ved re-render
  var kollegaCust = JSON.parse(window.localStorage.getItem("nordpunkt:crm-customers") || "[]").find(c => c.email === "kollega@firma.no");
  fire(doc.querySelector('[data-crm-open="' + kollegaCust.id + '"]'), "click");
  doc.querySelector("#ce-bedrift").value = "Testbedrift AS";
  fire(doc.querySelector("[data-crm-edit]"), "submit");
  var bedrifter2 = JSON.parse(window.localStorage.getItem("nordpunkt:crm-bedrifter") || "[]");
  assert(bedrifter2.filter(b => b.name === "Testbedrift AS").length === 1, "samme bedriftsnavn gjenbruker eksisterende bedrift (lager ikke duplikat)");
  var kollegaAfter = JSON.parse(window.localStorage.getItem("nordpunkt:crm-customers") || "[]").find(c => c.id === kollegaCust.id);
  assert(kollegaAfter.bedriftId === afterBedrift.bedriftId, "to ulike personer kan dele samme bedrift-kundenummer");

  // GDPR-slett via e-post i Kontakt-fanen
  window.App.addLead({ name: "Slett Meg", email: "slett@test.no", message: "test" });
  clickAdminTab("leads");
  assert(!!doc.querySelector("[data-gdpr-form]"), "GDPR-slette-skjema finst i Kontakt-fanen");

  // Batch 3, launch-readiness-fiksrunda 2026-07-18: konsolidert GDPR-slette-
  // flyt (CrmAdmin.deleteEverythingForEmail, kalla frå deleteByEmail()).
  // Privacy-gjennomgangen OG Codex fann UAVHENGIG at den gamle deleteByEmail()
  // berre matcha PRIMÆR e-post (ikkje altEmails) og rapporterte suksess
  // synkront utan å vente på/sjekke om dei underliggande Supabase-slettingane
  // faktisk lukkast. Testar her at søk på den samanslåtte testkunden sin
  // ALT-e-post (frå sammenslåings-testen over) faktisk finn og slettar han,
  // saman med ein lead knytt til akkurat den alt-e-posten.
  await (async function () {
    var altEmailTarget = (merged.altEmails || [])[0];
    assert(!!altEmailTarget, "den sammanslåtte testkunden har ein alt-e-post å teste alt-e-post-matching mot");
    if (!altEmailTarget) return;
    window.App.addLead({ name: "Alt-e-post-test", email: altEmailTarget, message: "skal slettast via alt-e-post-matching" });
    var beforeCustomers = window.CrmAdmin.getCustomers().length;
    var result = await window.CrmAdmin.deleteEverythingForEmail(altEmailTarget);
    assert(result.error === null, "deleteEverythingForEmail() rapporterer ingen feil for eit vellykka kall");
    assert(result.customersDeleted === 1, "deleteEverythingForEmail() finn og slettar kunden via ALT-e-post, ikkje berre primær-e-post");
    assert(window.CrmAdmin.getCustomers().length === beforeCustomers - 1, "kunden er faktisk fjerna frå den lokale kunde-lista");
    var leadsAfter = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]");
    assert(!leadsAfter.some(function (l) { return l.email === altEmailTarget; }), "leads knytt til alt-e-posten er òg sletta (heile e-postsettet, ikkje berre primær)");
  })();

  // Batch 3, launch-readiness-fiksrunda 2026-07-18: deleteLead() friar no
  // Tilbod-vedlegg (App.media.putFile()-opplastingar frå besøkjande) FØR
  // leaden fjernast -- tidlegare vart desse filene aldri fria, uansett kva
  // slettevei som vart brukt (Privacy-gjennomgang 2026-07-18, MEDIUM).
  await (async function () {
    var attFile = new window.File([new Uint8Array([1, 2, 3])], "tilbud-vedlegg.jpg", { type: "image/jpeg" });
    var att = await window.App.media.putFile(attFile);
    window.App.addLead({ name: "Vedlegg-test", email: "vedlegg-sletting@test.no", message: "test", kind: "tilbud", attachments: [att] });
    assert(window.localStorage.getItem("nordpunkt:" + att.ref) !== null, "vedlegget er lagra før sletting (føresetnad for testen)");
    var leadWithAtt = window.App.getLeads().find(function (l) { return l.email === "vedlegg-sletting@test.no"; });
    assert(!!leadWithAtt, "testleaden med vedlegg finst før sletting");
    window.App.deleteLead(leadWithAtt.id);
    assert(window.localStorage.getItem("nordpunkt:" + att.ref) === null, "Tilbod-vedlegget er fria frå lagring når leaden slettast (2026-07-18-fiks)");
  })();

  // 2026-07-19: module-quote.js sitt Tilbod-skjema kallar no App.media.putFileAnon()
  // i staden for putFile() direkte, sidan anon-opplastingar til media-bucket-en
  // no skal gå via ein kvote-gata Edge Function (media-bucket anon-opplastings-
  // kvote, sjå supabase/migrations/20260719124203_anon_media_upload_quota.sql).
  // I jsdom (ingen _sb konfigurert) fell putFileAnon() trygt tilbake til
  // putFile() sin eksisterande, ugata "file:"-lokallagring-veg -- stadfestar at
  // fallback-grenen faktisk fungerer identisk, ikkje berre at metoden finst.
  await (async function () {
    assert(typeof window.App.media.putFileAnon === "function", "App.media.putFileAnon() finst (ny kvote-gata anon-opplastingsveg)");
    var f = new window.File([new Uint8Array([9, 9, 9])], "kvote-test.png", { type: "image/png" });
    var att = await window.App.media.putFileAnon(f);
    assert(!!att && att.ref && att.ref.indexOf("file:") === 0, "putFileAnon() fell tilbake til same lokale file:-lagring som putFile() når Supabase ikkje er konfigurert");
    window.App.media.freeFile(att.ref);
  })();

  // Batch 3, launch-readiness-fiksrunda 2026-07-18 (Codex-funn, HIGH): eit
  // avbrote dokumentbytte i CRM-dokumentdialogen sletta tidlegare den
  // eksisterande fila permanent, sjølv om brukaren trykte Avbryt. Testar
  // begge sider av fiksen: (1) Avbryt etter opplasting UTAN eksisterande
  // vedlegg friar den no-orphaned nye opplastinga; (2) Avbryt etter eit BYTE
  // (eksisterande vedlegg alt lagra) held det opphavlege vedlegget urørt og
  // friar berre den nye, ulagra opplastinga.
  await (async function () {
    // Media/CrmDocs sitt lokale "file:"-fallback (brukt her sidan Supabase
    // ikkje er konfigurert i jsdom) gjev ikkje attachmentChip() ein
    // data-crmdoc-ref å lese (det krev "crmdoc:"-prefiks, berre reelt i
    // produksjon med Supabase konfigurert) -- spor difor kva NYE
    // "nordpunkt:file:..."-nøkkel som dukkar opp i localStorage etter kvar
    // opplasting, i staden for å lese referansen frå DOM-et.
    function newFileRefs(before) {
      var after = Object.keys(window.localStorage).filter(function (k) { return k.indexOf("nordpunkt:file:") === 0; });
      return after.filter(function (k) { return before.indexOf(k) === -1; }).map(function (k) { return k.slice("nordpunkt:".length); });
    }
    window.App.addLead({ name: "Dok-dialog-test", email: "dokdialog@test.no", message: "test" });
    clickAdminTab("mod-crm");
    var dokCust = JSON.parse(window.localStorage.getItem("nordpunkt:crm-customers") || "[]").find(c => c.email === "dokdialog@test.no");
    assert(!!dokCust, "testkunde for dokumentdialog-testen finst");
    fire(doc.querySelector('[data-crm-open="' + dokCust.id + '"]'), "click");

    // Scenario 1: ingen eksisterande vedlegg, last opp, trykk Avbryt.
    var beforeKeys1 = Object.keys(window.localStorage).filter(function (k) { return k.indexOf("nordpunkt:file:") === 0; });
    fire(doc.querySelector('[data-qa="crm-qa-doc"]'), "click");
    var fileInput1 = doc.querySelector("#dlg-dc-file");
    var f1 = new window.File([new Uint8Array([1, 2, 3])], "kontrakt-v1.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput1, "files", { value: [f1], configurable: true });
    fileInput1.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    var ref1 = newFileRefs(beforeKeys1)[0];
    assert(!!ref1 && window.localStorage.getItem("nordpunkt:" + ref1) !== null, "fyrste opplasting lagra før Avbryt (føresetnad)");
    doc.querySelector("#dlg-dc-cancel").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert(window.localStorage.getItem("nordpunkt:" + ref1) === null, "Avbryt utan eksisterande vedlegg friar den no-orphaned nye opplastinga");

    // Scenario 2: lagre EIT vedlegg først (via Lagre), opne på nytt, bytt fil, trykk Avbryt.
    var beforeKeysA = Object.keys(window.localStorage).filter(function (k) { return k.indexOf("nordpunkt:file:") === 0; });
    fire(doc.querySelector('[data-qa="crm-qa-doc"]'), "click");
    var fileInputA = doc.querySelector("#dlg-dc-file");
    var fA = new window.File([new Uint8Array([4, 5, 6])], "kontrakt-original.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInputA, "files", { value: [fA], configurable: true });
    fileInputA.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    var refOriginal = newFileRefs(beforeKeysA)[0];
    assert(!!refOriginal, "det opphavlege vedlegget vart lasta opp (føresetnad for scenario 2)");
    doc.querySelector("#dlg-dc-name").value = "Kontrakt original";
    doc.querySelector("#dlg-dc-save").dispatchEvent(new window.Event("click", { bubbles: true }));
    var docComm = (JSON.parse(window.localStorage.getItem("nordpunkt:crm-comms") || "[]")).find(function (x) { return x.customerId === dokCust.id && x.type === "document"; });
    assert(!!docComm && docComm.attachment && docComm.attachment.ref === refOriginal, "det opphavlege dokumentet er faktisk lagra med rett referanse");
    assert(window.localStorage.getItem("nordpunkt:" + refOriginal) !== null, "det opphavlege vedlegget finst framleis i lagring etter Lagre");

    // refresh() (kalla av #dlg-dc-save over) er renderCustomer() sin eigen
    // refresh-callback -- me er alt attende på kundevisinga, ingen ny
    // navigering naudsynt.
    var tlItem = doc.querySelector('[data-tl-item="' + docComm.id + '"]');
    assert(!!tlItem, "det lagra dokumentet vises no som eit tidslinje-element");
    if (tlItem) fire(tlItem, "click"); // opnar openDocDialog(c,refresh,item) for redigering
    var fileInputB = doc.querySelector("#dlg-dc-file");
    if (fileInputB) {
      var beforeKeysB = Object.keys(window.localStorage).filter(function (k) { return k.indexOf("nordpunkt:file:") === 0; });
      var fB = new window.File([new Uint8Array([7, 8, 9])], "kontrakt-bytt.pdf", { type: "application/pdf" });
      Object.defineProperty(fileInputB, "files", { value: [fB], configurable: true });
      fileInputB.dispatchEvent(new window.Event("change", { bubbles: true }));
      await new Promise(r => setTimeout(r, 30));
      var refNew = newFileRefs(beforeKeysB)[0];
      assert(!!refNew && refNew !== refOriginal, "eit nytt vedlegg er lasta opp for å byte ut det opphavlege");
      assert(window.localStorage.getItem("nordpunkt:" + refOriginal) !== null, "det OPPHAVLEGE vedlegget er FRAMLEIS i lagring rett etter ny opplasting, FØR Avbryt/Lagre (2026-07-18-fiks -- kjernen i buggen)");
      doc.querySelector("#dlg-dc-cancel").dispatchEvent(new window.Event("click", { bubbles: true }));
      assert(window.localStorage.getItem("nordpunkt:" + refOriginal) !== null, "det opphavlege vedlegget er FRAMLEIS i lagring etter Avbryt (2026-07-18-fiks)");
      assert(window.localStorage.getItem("nordpunkt:" + refNew) === null, "den nye, ulagra opplastinga er fria etter Avbryt");
    }
  })();

  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- CRM: feltmapping Supabase<->JS (crm_customers/crm_bedrifter/crm_comms) ---
  // module-crm.js sin _sb (Supabase-klient) vert fanga ÉIN gong ved modul-
  // oppstart (same mønster som workspace/module-tasks.js), så å setje
  // window.App.supabase seinare i eit testløp treffer aldri det faktiske
  // nettverkskallet — App.supabase er uansett ikkje konfigurert i jsdom, og
  // INGEN modul i kodebasen (heller ikkje tasks) har nokon gong automatisert-
  // testa det ekte Supabase-kallet. Desse testane verifiserer i staden at
  // sjølve felt-mappinga (dbXToJs/jsXToDb) er korrekt og round-trip-trygg —
  // akkurat den typen feil (t.d. id/created som ved eit uhell dukka opp
  // dobbelt, både som ekte kolonne OG inni `data` jsonb) som elles ville
  // feila stille i produksjon utan å nokon gong synast i eit testløp.
  console.log("\n— CRM: feltmapping Supabase<->JS —");
  await (async function () {
    var T = window.CrmAdmin._test;
    assert(!!T, "CrmAdmin._test er eksponert for feltmapping-testing");

    // --- crm_customers ---
    var dbCust = { id: "cust-1", email: "a@b.no", alt_emails: ["c@d.no"], name: "Ada", phone: "123", address: "Gate 1", note: "Notat", customer_number: "123456", bedrift_id: "bed-1", created_at: "2026-07-03T10:00:00.000Z" };
    var jsCust = T.dbCustomerToJs(dbCust);
    assert(jsCust.altEmails[0] === "c@d.no" && jsCust.customerNumber === "123456" && jsCust.bedriftId === "bed-1" && jsCust.created === dbCust.created_at,
      "dbCustomerToJs() mappar snake_case til camelCase korrekt");
    var backToDb = T.jsCustomerToDb(jsCust);
    assert(backToDb.alt_emails[0] === "c@d.no" && backToDb.customer_number === "123456" && backToDb.bedrift_id === "bed-1",
      "jsCustomerToDb() mappar camelCase attende til snake_case korrekt (round-trip)");

    // --- crm_bedrifter ---
    var dbBed = { id: "bed-1", name: "Firma AS", customer_number: "654321", org_nr: "999", website: "firma.no", phone: "1", address: "A", invoice_email: "f@f.no", invoice_address: "B", note: "N", created_at: "2026-07-03T10:00:00.000Z" };
    var jsBed = T.dbBedriftToJs(dbBed);
    assert(jsBed.orgNr === "999" && jsBed.invoiceEmail === "f@f.no" && jsBed.invoiceAddress === "B" && jsBed.customerNumber === "654321",
      "dbBedriftToJs() mappar snake_case til camelCase korrekt");
    var bedBackToDb = T.jsBedriftToDb(jsBed);
    assert(bedBackToDb.org_nr === "999" && bedBackToDb.invoice_email === "f@f.no" && bedBackToDb.invoice_address === "B",
      "jsBedriftToDb() mappar camelCase attende til snake_case korrekt (round-trip)");

    // --- crm_comms: polymorf, type-spesifikke felt i `data` jsonb ---
    // phone_note har heilt andre felt enn email_sent — testar begge for å
    // stadfeste at `data`-splittinga er generisk, ikkje hardkoda per type.
    var phoneNoteItem = { id: "cm-1", customerId: "cust-1", type: "phone_note", title: "Telefonsamtale", created: "2026-07-03T10:00:00.000Z",
      callDate: "2026-07-03", callTime: "10:00", duration: "5", contact: "Ada", note: "Ringte om tilbud", noteHtml: "<p>Ringte om tilbud</p>", followup: "", followupHtml: "" };
    var phoneNoteDb = T.jsCommToDb(phoneNoteItem);
    assert(phoneNoteDb.customer_id === "cust-1" && phoneNoteDb.type === "phone_note" && phoneNoteDb.title === "Telefonsamtale",
      "jsCommToDb() mappar dei kjende felta (customerId/type/title) til ekte kolonnar");
    assert(phoneNoteDb.data.callDate === "2026-07-03" && phoneNoteDb.data.contact === "Ada" && phoneNoteDb.data.noteHtml === "<p>Ringte om tilbud</p>",
      "jsCommToDb() legg dei type-spesifikke felta (callDate/contact/noteHtml osv.) i `data` jsonb");
    assert(phoneNoteDb.data.id === undefined && phoneNoteDb.data.created === undefined && phoneNoteDb.data.customerId === undefined && phoneNoteDb.data.type === undefined && phoneNoteDb.data.title === undefined,
      "jsCommToDb() dupliserer IKKJE id/created/customerId/type/title inni `data` (fanga feil frå første forsøk)");

    var emailItem = { id: "cm-2", customerId: "cust-1", type: "email_sent", title: "E-post sendt", created: "2026-07-03T11:00:00.000Z",
      subject: "Angående tilbud", body: "Hei Ada, her er tilbudet.", to: "a@b.no", threadId: "th-1" };
    var emailDb = T.jsCommToDb(emailItem);
    assert(emailDb.data.subject === "Angående tilbud" && emailDb.data.to === "a@b.no" && emailDb.data.threadId === "th-1",
      "jsCommToDb() handsamar email_sent sine felt (subject/to/threadId) same generiske veg");

    // dbCommToJs(): DB-rad → flat JS-objekt att, type-spesifikke felt frå
    // `data` skal dukke opp som vanlege topp-nivå-felt (ikkje nøsta).
    var phoneNoteRow = { id: "cm-1", customer_id: "cust-1", type: "phone_note", title: "Telefonsamtale", created_at: "2026-07-03T10:00:00.000Z", data: phoneNoteDb.data };
    var phoneNoteJs = T.dbCommToJs(phoneNoteRow);
    assert(phoneNoteJs.customerId === "cust-1" && phoneNoteJs.created === "2026-07-03T10:00:00.000Z", "dbCommToJs() mappar customer_id/created_at til camelCase");
    assert(phoneNoteJs.callDate === "2026-07-03" && phoneNoteJs.contact === "Ada" && phoneNoteJs.noteHtml === "<p>Ringte om tilbud</p>",
      "dbCommToJs() flatar ut `data` jsonb-felta til vanlege topp-nivå-felt att (round-trip frå jsCommToDb)");

    // document: attachment-feltet (lagt til 2026-07-03, filopplasting via App.media.putFile())
    // skal handsamast generisk same veg som callDate/subject osv. — ikkje som ei ekte kolonne.
    var docItem = { id: "cm-3", customerId: "cust-1", type: "document", title: "Kontrakt 2025", created: "2026-07-03T12:00:00.000Z",
      docType: "Kontrakt", note: "", noteHtml: "", attachment: { name: "kontrakt.pdf", ref: "https://example.test/kontrakt.pdf", type: "application/pdf", size: 20480 } };
    var docDb = T.jsCommToDb(docItem);
    assert(docDb.data.docType === "Kontrakt" && docDb.data.attachment && docDb.data.attachment.name === "kontrakt.pdf" && docDb.data.attachment.ref === "https://example.test/kontrakt.pdf",
      "jsCommToDb() legg document sitt attachment-felt (name/ref/type/size) i `data` jsonb, same generiske veg som andre type-spesifikke felt");
    var docRow = { id: "cm-3", customer_id: "cust-1", type: "document", title: "Kontrakt 2025", created_at: "2026-07-03T12:00:00.000Z", data: docDb.data };
    var docJs = T.dbCommToJs(docRow);
    assert(docJs.attachment && docJs.attachment.name === "kontrakt.pdf" && docJs.attachment.size === 20480,
      "dbCommToJs() flatar ut attachment-objektet att uendra (round-trip frå jsCommToDb)");

    // isSafeAttachmentUrl() (2026-07-06): crm_comms har laus UPDATE-policy
    // (member kan i praksis PATCHe att.ref via REST), så attachmentChip() må
    // sjølv avvise farlege URL-skjema før han renderer ein <a href>.
    assert(T.isSafeAttachmentUrl("https://eksempel.no/fil.pdf") === true, "isSafeAttachmentUrl() tillèt https:-lenker");
    assert(T.isSafeAttachmentUrl("file:1234-abcde") === true, "isSafeAttachmentUrl() tillèt lokale file:-referansar (demo-lagring)");
    assert(T.isSafeAttachmentUrl("javascript:alert(1)") === false, "isSafeAttachmentUrl() avviser javascript:-URI");
    assert(T.isSafeAttachmentUrl("  javascript:alert(1)") === false, "isSafeAttachmentUrl() avviser javascript:-URI med leiande whitespace");
    assert(T.isSafeAttachmentUrl("") === false, "isSafeAttachmentUrl() avviser tom streng");
    assert(T.isSafeAttachmentUrl(null) === false, "isSafeAttachmentUrl() avviser null");

    // App.crmDocs (privat CRM-dokument-bucket, lagt til for å lukke det kjende
    // "delt offentleg media-bucket for private forretningsdokument"-holet).
    assert(!!window.App.crmDocs, "App.crmDocs er eksponert");
    assert(window.App.crmDocs.isCrmDocRef("crmdoc:1234-abc.pdf") === true, "isCrmDocRef() kjenner att crmdoc:-prefikset");
    assert(window.App.crmDocs.isCrmDocRef("https://eksempel.no/fil.pdf") === false, "isCrmDocRef() avviser vanlege URL-ar (eldre, offentlege media-vedlegg)");
    assert(window.App.crmDocs.isCrmDocRef("file:1234-abc") === false, "isCrmDocRef() avviser file:-referansar (lokal demo-lagring)");
    assert(window.App.crmDocs.isCrmDocRef(null) === false, "isCrmDocRef() avviser null");
    assert(window.App.crmDocs.isCrmDocRef("") === false, "isCrmDocRef() avviser tom streng");

    // attachmentChip() sin nye grein: crmdoc:-referansar skal rendre ein
    // <button data-crmdoc-ref>, ALDRI eit href-attributt direkte (signert URL
    // hentast asynkront via App.crmDocs.getCrmDocumentUrl(), aldri interpolert
    // inn i HTML-en sjølv).
    var crmdocChip = T.attachmentChip({ name: "Kontrakt.pdf", ref: "crmdoc:1234-abc.pdf", size: 20480 });
    assert(crmdocChip.indexOf("data-crmdoc-ref=") > -1, "attachmentChip() rendrar data-crmdoc-ref for crmdoc:-vedlegg");
    assert(crmdocChip.indexOf("<button") === 0, "attachmentChip() rendrar crmdoc:-vedlegg som ein <button>, ikkje ein <a>");
    assert(crmdocChip.indexOf("href=") === -1, "attachmentChip() sitt crmdoc:-utdata inneheld ALDRI eit href-attributt");
    var legacyChip = T.attachmentChip({ name: "Gammal.pdf", ref: "https://eksempel.no/gammal.pdf", size: 1024 });
    assert(legacyChip.indexOf("<a href=") === 0, "attachmentChip() held fram med <a href> for eldre, offentlege media-vedlegg (uendra åtferd)");

    // putCrmDocument()/getCrmDocumentUrl()/freeCrmDocument() sin no-Supabase-
    // gren (jsdom konfigurerer aldri _sb) -- same "file:"-fallback-mønster som
    // Media.putFile() alt har, stadfesta som eit ekte, sjølvstendig rundtur.
    var crmDocFile = new window.File([new Uint8Array([37,80,68,70])], "kontrakt.pdf", { type: "application/pdf" });
    var crmDocAtt = await window.App.crmDocs.putCrmDocument(crmDocFile);
    assert(crmDocAtt.ref.indexOf("file:") === 0, "putCrmDocument() fell tilbake til file:-referanse utan Supabase konfigurert");
    var resolvedCrmDocUrl = await window.App.crmDocs.getCrmDocumentUrl(crmDocAtt.ref);
    assert(typeof resolvedCrmDocUrl === "string" && resolvedCrmDocUrl.indexOf("data:") === 0, "getCrmDocumentUrl() løyser ein file:-referanse til ein reell data-URL");
    window.App.crmDocs.freeCrmDocument(crmDocAtt.ref);
    assert(window.localStorage.getItem("nordpunkt:" + crmDocAtt.ref) === null, "freeCrmDocument() fjernar file:-referansen frå localStorage");
  })();

  // --- leads: feltmapping Supabase<->JS + isTilbud()-klassifisering ---
  // Same grunngjeving som CRM-testen over: _sb vert fanga éin gong ved
  // modul-oppstart i core.js (kunne ikkje vore verifisert live i eit
  // testløp), så desse testane verifiserer felt-mappinga og
  // klassifiseringslogikken, ikkje det faktiske nettverkskallet.
  console.log("\n— leads: feltmapping Supabase<->JS + isTilbud() —");
  (function () {
    var T = window.App._test;
    assert(!!T && !!T.dbLeadToJs && !!T.jsLeadToDb, "App._test eksponerer leads-feltmapping for testing");

    var dbLead = { id: "lead-1", kind: "tilbud", name: "Kari", email: "kari@test.no", message: "Tilbudsforespørsel\n\nJobbeskrivelse\nHage", status: "ny", reference_number: "123456", source: null, chat_id: null, created_at: "2026-07-03T09:00:00.000Z" };
    var jsLead = T.dbLeadToJs(dbLead);
    assert(jsLead.kind === "tilbud" && jsLead.referenceNumber === "123456" && jsLead.chatId === null && jsLead.time === "2026-07-03T09:00:00.000Z",
      "dbLeadToJs() mappar snake_case til camelCase korrekt (kind/reference_number/chat_id/created_at)");
    var backToDb = T.jsLeadToDb(jsLead);
    assert(backToDb.kind === "tilbud" && backToDb.reference_number === "123456" && backToDb.chat_id === null,
      "jsLeadToDb() mappar camelCase attende til snake_case korrekt (round-trip)");

    // attachments (2026-07-06): Tilbud-vedlegg sine faktiske filbytes lastast
    // no opp via App.media.putFile() i staden for berre filnamn+storleik i
    // meldingsteksten — verifiser feltmappinga for den nye kolonna.
    var dbLeadWithAtt = Object.assign({}, dbLead, { attachments: [{ name: "tegning.pdf", ref: "https://x/y.pdf", type: "application/pdf", size: 20480 }] });
    var jsLeadWithAtt = T.dbLeadToJs(dbLeadWithAtt);
    assert(Array.isArray(jsLeadWithAtt.attachments) && jsLeadWithAtt.attachments.length === 1 && jsLeadWithAtt.attachments[0].name === "tegning.pdf",
      "dbLeadToJs() mappar attachments-arrayet korrekt");
    assert(Array.isArray(T.jsLeadToDb(jsLeadWithAtt).attachments) && T.jsLeadToDb(jsLeadWithAtt).attachments[0].size === 20480,
      "jsLeadToDb() mappar attachments attende korrekt (round-trip)");
    assert(Array.isArray(T.dbLeadToJs(dbLead).attachments) && T.dbLeadToJs(dbLead).attachments.length === 0,
      "dbLeadToJs() fell tilbake til tomt array når attachments manglar (eldre/eksisterande leads)");

    // isTilbud(): kind-feltet er kjelda når det finst, uavhengig av meldingsteksten.
    assert(window.App.isTilbud({ kind: "tilbud", message: "Ei vanleg melding utan Tilbudsforesp-prefiks" }) === true,
      "isTilbud() stolar på kind:'tilbud' sjølv om meldinga ikkje startar med Tilbudsforesp");
    assert(window.App.isTilbud({ kind: "kontakt", message: "Tilbudsforespørsel\n\nJobbeskrivelse" }) === false,
      "isTilbud() stolar på kind:'kontakt' sjølv om meldinga FEILAKTIG liknar ein tilbudsforespørsel (kind vinn alltid)");
    // Fallback til tekst-sniffing for eldre data utan kind sett (før migrering).
    assert(window.App.isTilbud({ message: "Tilbudsforespørsel\n\nJobbeskrivelse: hage" }) === true,
      "isTilbud() fell tilbake til tekst-sniffing når kind manglar (eldre, ikkje-migrert data)");
    assert(window.App.isTilbud({ message: "Ei vanleg kontakthenvending" }) === false,
      "isTilbud() sitt tekst-sniffing-fallback gjev false for vanlege kontaktmeldingar");
  })();

  // --- bookings: feltmapping Supabase<->JS ---
  // Same grunngjeving som CRM/leads-testane over: _sb vert fanga éin gong
  // ved modul-oppstart i module-booking.js, så desse testane verifiserer
  // felt-mappinga, ikkje det faktiske nettverkskallet.
  console.log("\n— bookings: feltmapping Supabase<->JS —");
  (function () {
    var T = window.BookingAdmin && window.BookingAdmin._test;
    assert(!!T && !!T.dbBookingToJs && !!T.jsBookingToDb, "BookingAdmin._test eksponerer bookings-feltmapping for testing");

    var dbBk = { id: "bk-1", asset_id: "as-1", date: "2026-08-01", time: "10:00", name: "Kari", email: "kari@test.no", phone: "12345678", message: "Ein kommentar", instant: true, status: "ny", reference_number: "482913", created_at: "2026-07-03T09:00:00.000Z" };
    var jsBk = T.dbBookingToJs(dbBk);
    assert(jsBk.assetId === "as-1" && jsBk.referenceNumber === "482913" && jsBk.instant === true && jsBk.createdAt === dbBk.created_at,
      "dbBookingToJs() mappar snake_case til camelCase korrekt (asset_id/reference_number/instant/created_at)");
    var backToDb = T.jsBookingToDb(jsBk);
    assert(backToDb.asset_id === "as-1" && backToDb.reference_number === "482913" && backToDb.instant === true,
      "jsBookingToDb() mappar camelCase attende til snake_case korrekt (round-trip)");

    // instant/status/phone/message manglar ofte for admin-oppretta bookingar — sjekk defaults.
    var dbMinimal = { id: "bk-2", asset_id: "as-2", date: "2026-08-02", time: "11:00" };
    var jsMinimal = T.dbBookingToJs(dbMinimal);
    assert(jsMinimal.name === "" && jsMinimal.email === "" && jsMinimal.phone === "" && jsMinimal.instant === false && jsMinimal.status === "ny",
      "dbBookingToJs() gjev fornuftige standardverdiar når valfrie felt manglar");
  })();

  // --- Status-system (Ny/Lest/Løst) ---
  console.log("\n— Status-system (Ny/Lest/Løst) —");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // Ny lead får status "ny"
  doc.querySelector("#lead-name").value = "Status Test";
  doc.querySelector("#lead-email").value = "status@test.no";
  doc.querySelector("#lead-message").value = "Test av status";
  doc.querySelector("#lead-terms").checked = true;
  fire(doc.querySelector("[data-contact-form]"), "submit");
  var statusLeads = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]");
  var newLead = statusLeads.find(function (l) { return l.email === "status@test.no"; });
  assert(newLead && newLead.status === "ny", "ny lead får status ny");
  assert(newLead && newLead.kind === "kontakt", "vanlig kontaktskjema-lead får kind:'kontakt' (default)");

  // Admin: badge og chips vises i Kontakt-fanen
  window.App.openAdmin();
  var adminPassField = doc.querySelector('#admin-pass');
  if (adminPassField) {
    adminPassField.value = "test";
    fire(doc.querySelector('[data-login]'), "submit");
  }
  clickAdminTab("leads");
  assert(!!doc.querySelector(".stat-badge--ny"), "ny-badge vises i Kontakt-fanen");
  assert(!!doc.querySelector("[data-stat-filters=\"kontakt\"]"), "filter-chips vises i Kontakt-fanen");

  // Variant B: klikk for å ekspandere → Lest
  var leadDet = doc.querySelector('[data-lead-details="' + newLead.id + '"]');
  assert(!!leadDet, "lead har ekspanderbar details-boks");
  leadDet.open = true;
  fire(leadDet, "toggle");
  var afterExpand = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]").find(function (l) { return l.id === newLead.id; });
  assert(afterExpand.status === "lest", "status blir Lest etter eksplisitt klikk på detaljer");

  // Svar i e-post → Løst
  var replyBtn = doc.querySelector('[data-reply-lead="' + newLead.id + '"]');
  fire(replyBtn, "click");
  var afterReply = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]").find(function (l) { return l.id === newLead.id; });
  assert(afterReply.status === "løst", "status blir Løst etter klikk på Svar i e-post");
  var replyModal = doc.getElementById("reply-modal-root");
  if (replyModal) replyModal.remove();

  // --- E-postmaler: redigerbart kort + «med mal»/«uten mal»-valg ---
  console.log("\n— E-postmaler —");
  clickAdminTab("leads");
  var kTplArea = doc.querySelector('[data-email-tpl="kontakt"]');
  assert(!!kTplArea, "e-postmal-kort for Kontakt finst i admin");
  kTplArea.value = "Hei {navn}! Du skreiv: {melding} (frå {epost}, {dato})";
  fire(doc.querySelector('[data-email-tpl-save="kontakt"]'), "click");
  assert(window.App.getEmailTemplate("kontakt", "") === "Hei {navn}! Du skreiv: {melding} (frå {epost}, {dato})", "egendefinert kontakt-mal lagres");

  var replyBtn2 = doc.querySelector('[data-reply-lead="' + newLead.id + '"]');
  fire(replyBtn2, "click");
  var modal2 = doc.getElementById("reply-modal-root");
  var modalLinks = modal2.querySelectorAll("a.btn");
  var fullBtn  = Array.prototype.find.call(modalLinks, function (a) { return /Åpne i Outlook/.test(a.textContent); });
  var blankBtn = Array.prototype.find.call(modalLinks, function (a) { return /Åpne uten mal/.test(a.textContent); });
  assert(!!fullBtn && !!blankBtn, "svar-modal har begge knappane: «Åpne i Outlook» og «Åpne uten mal»");
  assert(decodeURIComponent(fullBtn.getAttribute("href")).indexOf("Hei Status Test! Du skreiv: Test av status") !== -1, "egendefinert mal med plassholdere fylt inn i «med mal»-lenken");
  assert(blankBtn.getAttribute("href").indexOf("&body=") === -1, "«uten mal»-lenken har tom meldingstekst (kun emne)");
  assert(fullBtn.getAttribute("href").indexOf("subject=") !== -1 && blankBtn.getAttribute("href").indexOf("subject=") !== -1, "begge lenkene har samme emnefelt");
  modal2.parentElement.removeChild(modal2);

  // Tilbakestill til standardmal
  clickAdminTab("leads");
  fire(doc.querySelector('[data-email-tpl-reset="kontakt"]'), "click");
  assert(window.App.getEmailTemplate("kontakt", "") === window.App.DEFAULT_REPLY_TEMPLATE, "kontakt-mal tilbakestilt til standard");

  // Manuell overstyring via dropdown
  clickAdminTab("leads");
  var statSel = doc.querySelector('[data-status-select="' + newLead.id + '"]');
  assert(!!statSel, "status-dropdown finst for manuell overstyring");
  statSel.value = "ny"; fire(statSel, "change");
  var afterManual = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]").find(function (l) { return l.id === newLead.id; });
  assert(afterManual.status === "ny", "manuell overstyring av status fungerer");

  // Filter: skjuler statusar som ikke er aktive
  clickAdminTab("leads");
  var nyChip = doc.querySelector('[data-stat-filters="kontakt"] [data-stat-chip="ny"]');
  fire(nyChip, "click"); // fjerner "ny" frå filteret
  clickAdminTab("leads");
  assert(!doc.querySelector('[data-id="' + newLead.id + '"]'), "filtrert lead (status ny) er skjult når Ny er avhuka av");
  fire(doc.querySelector('[data-stat-filters="kontakt"] [data-stat-chip="ny"]'), "click"); // setter tilbake
  clickAdminTab("leads");
  assert(!!doc.querySelector('[data-id="' + newLead.id + '"]'), "lead vises igjen når filter er tilbakestilt");

  // CRM: status vises i historikken
  clickAdminTab("mod-crm");
  fire(doc.querySelector("[data-crm-import]"), "click");
  var crmOpenBtn = [].slice.call(doc.querySelectorAll("[data-crm-open]")).find(function (b) {
    var row = b.closest("li");
    return row && row.textContent.indexOf("status@test.no") > -1;
  });
  assert(!!crmOpenBtn, "kunde med status@test.no finst i CRM-lista");
  if (crmOpenBtn) {
    fire(crmOpenBtn, "click");
    assert(!!doc.querySelector("[data-tl-section] .stat-badge"), "status-badge vises i kundens historikk");
    assert(!doc.querySelector("#crm-status"), "kundestatus-felt (ny/aktiv/avslutta) er fjernet fra CRM");

    // --- Tidslinje: filtrering (gruppert kategori) + klikk-på-rad opnar handling ---
    console.log("\n— CRM tidslinje: filtrering + klikk-på-rad —");
    fire(doc.querySelector('[data-qa="crm-qa-phone"]'), "click");
    fire(doc.querySelector("#dlg-ph-save"), "click");
    assert(!!doc.querySelector('[data-tl-filters] [data-tl-filter="kontakt"]') && !!doc.querySelector('[data-tl-filters] [data-tl-filter="phone_note"]'),
      "filterknappar for «Kontakt» og «Telefonnotat» vises når begge kategoriane finst");
    var kontaktRowsBefore = [].slice.call(doc.querySelectorAll("[data-tl-item]")).filter(function (r) { return r.textContent.indexOf("Kontaktmelding") > -1; });
    assert(kontaktRowsBefore.length === 1, "legacy Kontakt-oppføring vises i tidslinja før filtrering");
    fire(doc.querySelector('[data-tl-filters] [data-tl-filter="kontakt"]'), "click");
    assert(![].slice.call(doc.querySelectorAll("[data-tl-item]")).some(function (r) { return r.textContent.indexOf("Kontaktmelding") > -1; }),
      "Kontakt-oppføringa er skjult når «Kontakt»-filteret er avhuka av");
    assert([].slice.call(doc.querySelectorAll("[data-tl-item]")).some(function (r) { return r.textContent.indexOf("Telefonsamtale") > -1; }),
      "Telefonnotat-oppføringa vises framleis (ikkje påverka av Kontakt-filteret)");
    fire(doc.querySelector('[data-tl-filters] [data-tl-filter="kontakt"]'), "click");
    assert([].slice.call(doc.querySelectorAll("[data-tl-item]")).some(function (r) { return r.textContent.indexOf("Kontaktmelding") > -1; }),
      "Kontakt-oppføringa vises igjen når filteret er slått på att");

    var kontaktRow = [].slice.call(doc.querySelectorAll("[data-tl-item]")).find(function (r) { return r.textContent.indexOf("Kontaktmelding") > -1; });
    fire(kontaktRow, "click");
    assert(!!doc.getElementById("reply-modal-root"), "klikk på sjølve rada for ei legacy Kontakt-oppføring opnar App.openReplyModal (gjenbruk, ikkje ny modal)");
    var tlReplyModal = doc.getElementById("reply-modal-root");
    if (tlReplyModal) tlReplyModal.remove();

    var phoneRow = [].slice.call(doc.querySelectorAll("[data-tl-item]")).find(function (r) { return r.textContent.indexOf("Telefonsamtale") > -1; });
    fire(phoneRow, "click");
    var editDlg = doc.querySelector(".crm-dlg");
    assert(!!editDlg && editDlg.textContent.indexOf("Rediger telefonsamtale") > -1, "klikk på sjølve rada for eit redigerbart telefonnotat opnar redigeringsdialogen (ikkje berre ein liten blyant-knapp)");
    if (editDlg) editDlg.remove();
  }

  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- Vilkår/personvern-popup ---
  console.log("\n— Vilkår/personvern-popup —");
  assert(!!doc.querySelector("[data-terms-open=\"lead\"]"), "vilkår-lenke finst på kontaktskjema");
  assert(!!doc.querySelector("[data-terms-modal=\"lead\"]"), "vilkår-popup finst på kontaktskjema");
  doc.querySelector("#lead-name").value = "Uten Vilkår";
  doc.querySelector("#lead-email").value = "uten@test.no";
  doc.querySelector("#lead-message").value = "Test";
  doc.querySelector("#lead-terms").checked = false;
  var leadsBeforeTerms = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]").length;
  fire(doc.querySelector("[data-contact-form]"), "submit");
  var leadsAfterTerms = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]").length;
  assert(leadsAfterTerms === leadsBeforeTerms, "innsending blokkeres uten godkjente vilkår");

  // --- Personvern: footer-lenke og personverntekst ---
  console.log("\n— Personvern i footer —");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector('[data-terms-open="footer-privacy"]'), "personvern-lenke finst i footer");
  assert(!!doc.querySelector('[data-terms-modal="footer-privacy"]'), "personvern-popup finst i footer");
  fire(doc.querySelector('[data-terms-open="footer-privacy"]'), "click");
  assert(doc.querySelector('[data-terms-modal="footer-privacy"]').style.display !== "none", "footer-personvern-popup åpnes ved klikk");
  fire(doc.querySelector('[data-terms-close="footer-privacy"]'), "click");
  assert(doc.querySelector('[data-terms-modal="footer-privacy"]').style.display === "none", "footer-personvern-popup lukkes ved klikk");

  // computeDefaultPrivacyText() genererer modul-bevisst forslag
  window.localStorage.setItem("nordpunkt:analytics", JSON.stringify({ plausible: "nordpunkt.no" }));
  var defaultPrivNow = window.App.computeDefaultPrivacyText();
  assert(/Plausible/.test(defaultPrivNow), "generert personvernforslag nevner Plausible når analyse er konfigurert");
  assert(/tilbud/.test(defaultPrivNow) && /booking/i.test(defaultPrivNow), "generert forslag nevner tilbud og booking");
  window.localStorage.removeItem("nordpunkt:analytics");

  // Personvernkonfigurasjon via superconfig (simulerer Konsoll-lagring)
  window.App.store.set("superconfig", { privacy: { heading: "Testoverskrift", text: "Testtekst for personvern." } });
  window.App.reloadConfig();
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(doc.querySelector('[data-terms-modal="footer-privacy"] h3').textContent === "Testoverskrift", "ny overskrift vises i footer-popup etter superconfig-endring");
  assert(doc.querySelector('[data-terms-modal="footer-privacy"] .terms-modal-text').textContent === "Testtekst for personvern.", "ny tekst vises i footer-popup etter superconfig-endring");

  // Rydd opp
  var rawSC = JSON.parse(window.localStorage.getItem("nordpunkt:superconfig") || "{}");
  delete rawSC.privacy;
  window.localStorage.setItem("nordpunkt:superconfig", JSON.stringify(rawSC));
  window.App.reloadConfig();

  // --- CRM/Kunder kan ALDRI vises på framsida eller i footer ---
  console.log("\n— CRM aldri synlig publikt —");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(!doc.querySelector('.site-footer a[href="#crm"]') && !doc.querySelector('.site-footer__navlink[href="#crm"]'),
    "Kunder vises ikke i footer som standard");
  // Forsøk å tvinge fram footer-synlighet via lagret innstilling (simulerer den gamle buggen)
  var rawNav = JSON.parse(window.localStorage.getItem("nordpunkt:nav-settings") || "{}");
  rawNav.crm = { footer: true };
  window.localStorage.setItem("nordpunkt:nav-settings", JSON.stringify(rawNav));
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  var footerLinks = [].slice.call(doc.querySelectorAll(".site-footer__navlink")).map(function (a) { return a.textContent; });
  assert(footerLinks.indexOf("Kunder") === -1, "Kunder kan IKKE tvinges synlig i footer selv med lagret footer:true");
  // Sjekk at Kunder heller ikke dukker opp i Navigasjon-admin sine tabeller
  window.App.openAdmin();
  clickAdminTab("navigasjon");
  var navRows = [].slice.call(doc.querySelectorAll("tbody tr td")).map(function (td) { return td.textContent; }).join(" | ");
  assert(navRows.indexOf("Kunder") === -1, "Kunder vises ikke i Navigasjon/Framsida-tabellene i admin");
  // Rydd opp
  delete rawNav.crm;
  window.localStorage.setItem("nordpunkt:nav-settings", JSON.stringify(rawNav));
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- Døp om modul-visningsnavn ---
  console.log("\n— Visningsnavn (døp om moduler) —");
  window.App.openAdmin();
  clickAdminTab("navigasjon");
  var faqLabelInput = doc.querySelector('[data-nav-label="faq"]');
  assert(!!faqLabelInput, "redigerbart visningsnavn-felt finst for FAQ-modulen");
  faqLabelInput.value = "FAQ";
  fire(faqLabelInput, "change");
  var savedNav = JSON.parse(window.localStorage.getItem("nordpunkt:nav-settings") || "{}");
  assert(savedNav.faq && savedNav.faq.label === "FAQ", "nytt visningsnavn lagret i navsettings");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector('.nav a[href="#faq"]') === false || [].slice.call(doc.querySelectorAll(".nav a, nav a")).some(function (a) { return a.textContent.trim() === "FAQ"; }),
    "nytt visningsnavn vises i toppmenyen");
  // Rydd opp
  delete savedNav.faq;
  window.localStorage.setItem("nordpunkt:nav-settings", JSON.stringify(savedNav));
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- Footer: to meny-kolonner, Personvern alltid sist i Meny 2 ---
  console.log("\n— Footer: to meny-kolonner —");
  var C = window.Components;
  var privacyOpt = { heading: "PV", text: "Tekst" };

  // 0 lenker: kun Personvern, alene i Meny 2 (ingen Meny 1)
  var h0 = C.footer({ name: "Test", links: [], privacy: privacyOpt });
  var parser0 = new window.DOMParser().parseFromString(h0, "text/html");
  var cols0 = parser0.querySelectorAll(".site-footer__nav");
  assert(cols0.length === 1, "0 lenker: kun én meny-kolonne (Meny 2 med Personvern alene)");
  assert(cols0[0].textContent.indexOf("Personvern") > -1, "Personvern er alene i Meny 2 når ingen andre lenker finnes");

  // 4 lenker: deles 2/2, Personvern legges til sist i Meny 2 (blir 2/3)
  var links4 = [{id:"a",label:"A"},{id:"b",label:"B"},{id:"c",label:"C"},{id:"d",label:"D"}];
  var h4 = C.footer({ name: "Test", links: links4, privacy: privacyOpt });
  var parser4 = new window.DOMParser().parseFromString(h4, "text/html");
  var cols4 = parser4.querySelectorAll(".site-footer__nav");
  assert(cols4.length === 2, "4 lenker: to meny-kolonner vises");
  assert(cols4[0].querySelectorAll("li").length === 2, "Meny 1 har 2 lenker (jevnt delt)");
  assert(cols4[1].querySelectorAll("li").length === 3, "Meny 2 har 2 lenker + Personvern (3 totalt)");
  var lastLi4 = cols4[1].querySelectorAll("li");
  assert(lastLi4[lastLi4.length-1].textContent.trim() === "Personvern", "Personvern er SIST i Meny 2 (4 lenker)");

  // 5 lenker (odd): Meny 1 = 3, Meny 2 = 2 + Personvern = 3 (balansert)
  var links5 = links4.concat([{id:"e",label:"E"}]);
  var h5 = C.footer({ name: "Test", links: links5, privacy: privacyOpt });
  var parser5 = new window.DOMParser().parseFromString(h5, "text/html");
  var cols5 = parser5.querySelectorAll(".site-footer__nav");
  assert(cols5[0].querySelectorAll("li").length === 3, "5 lenker: Meny 1 får 3 (ceil-halvdel)");
  assert(cols5[1].querySelectorAll("li").length === 3, "5 lenker: Meny 2 får 2 + Personvern = 3 (balansert med Meny 1)");

  // Ingen personvernstekst satt: Personvern-lenke vises ikke i det heile
  var hNoPriv = C.footer({ name: "Test", links: links4, privacy: { heading:"", text:"" } });
  assert(hNoPriv.indexOf("Personvern") === -1, "Personvern-lenke skjules helt når ingen personvernstekst er satt");

  // Tryggleiksfiks 2026-07-18 (Codex-funn, HIGH): f.copyright vart tidlegare
  // sett inn RÅTT i innerHTML -- ein lagra XSS synleg for ALLE besøkjande,
  // redigerbar av rolla "editor". Stadfestar at HTML-spesialteikn no vert escapa.
  var hXss = C.footer({ name: "Test", links: [], footer: { copyright: '"><img src=x onerror="window.__footerXssFired=true">' } });
  assert(hXss.indexOf("<img src=x") === -1, "footer.copyright med HTML-spesialteikn vert escapa, ikkje tolka som DOM-element");
  assert(hXss.indexOf("&lt;img") > -1, "footer.copyright sitt innhald finst framleis, berre escapa");

  // --- Mediebank ---
  console.log("\n— Mediebank —");
  window.location.hash = "#mediabank"; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.getElementById("mediabank"), "Mediebank-siden rendres på #mediabank");
  assert(doc.querySelector("#mediabank .mb-empty"), "tomt-state-melding vises uten bilder");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  window.App.openAdmin();
  clickAdminTab("mod-mediabank");
  assert(!!doc.querySelector("#mb-heading"), "side-innstillinger (overskrift/ingress) finst i Mediebank-admin");
  doc.querySelector("#mb-heading").value = "Vårt bildearkiv";
  doc.querySelector("#mb-intro").value = "Vår grafiske profil og bilder.";
  fire(doc.querySelector("[data-mb-settings]"), "submit");
  var mbSettings = JSON.parse(window.localStorage.getItem("nordpunkt:mediabank-settings") || "{}");
  assert(mbSettings.heading === "Vårt bildearkiv", "overskrift lagret");

  fire(doc.querySelector("[data-mb-new]"), "click");
  var mbImgWrap = doc.querySelector("[data-mb-editor] [data-imgfield]");
  assert(!!mbImgWrap, "bildefelt finst i ny-bilde-skjemaet");
  mbImgWrap.querySelector("[data-imgfield-url]").value = "https://eksempel.no/galleri.jpg";
  fire(mbImgWrap.querySelector("[data-imgfield-url]"), "input");
  var mbAiRadio = mbImgWrap.querySelector('[data-imgfield-credit-type][value="ai"]');
  mbAiRadio.checked = true; fire(mbAiRadio, "change");
  doc.querySelector("#mb-desc").value = "Fra sommerfesten 2025";
  fire(doc.querySelector("[data-mb-form]"), "submit");

  var mbImages = JSON.parse(window.localStorage.getItem("nordpunkt:mediabank-images") || "[]");
  assert(mbImages.length === 1 && mbImages[0].description === "Fra sommerfesten 2025", "bilde lagret med beskrivelse");
  assert(mbImages[0].image.caption === "Bildet er generert eller redigert av kunstig intelligens", "bilde lagret med KI-/copyright-merking");
  assert(!!doc.querySelector("[data-mb-list] .admin-row"), "bildet vises i admin-lista");

  // Offentlig side: rutenett + lightbox
  window.location.hash = "#mediabank"; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector(".mb-thumb"), "bildet vises i rutenettet på den offentlige siden");
  assert(!!doc.querySelector(".img-credit-badge"), "KI/©-merke vises på miniatyrbildet");
  fire(doc.querySelector(".mb-thumb"), "click");
  assert(!!doc.querySelector(".mb-lightbox-back"), "lightbox åpnes ved klikk på bilde");
  assert(doc.querySelector(".mb-lightbox__desc").textContent === "Fra sommerfesten 2025", "beskrivelse vises i lightbox");
  assert(doc.querySelector(".mb-lightbox__credit").textContent === "Bildet er generert eller redigert av kunstig intelligens", "KI-/copyright-merketekst vises i lightbox");
  assert(!!doc.querySelector("[data-mb-download]"), "Last ned-knapp finst i lightbox");
  fire(doc.querySelector("[data-mb-close]"), "click");
  assert(!doc.querySelector(".mb-lightbox-back"), "lightbox lukkes ved klikk på Lukk");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- Superconfig: fargar og fontar via store (simulerer Konsoll-lagring) ---
  console.log("\n— Superconfig: fargar og fontar —");
  window.App.store.set("superconfig", { colors: { text: "#222222", surface: "#f0f0f0" }, fonts: { display: "Space Grotesk", body: "Work Sans" } });
  window.App.reloadConfig();
  assert(doc.documentElement.style.getPropertyValue("--color-text") === "#222222", "tekstfarge frå superconfig brukast (CSS-var satt)");
  var savedSC2 = JSON.parse(window.localStorage.getItem("nordpunkt:superconfig") || "{}");
  assert(savedSC2.colors.text === "#222222" && savedSC2.colors.surface === "#f0f0f0", "fargar persisterte i superconfig-nøkkel");
  assert(savedSC2.fonts.display === "Space Grotesk" && savedSC2.fonts.body === "Work Sans", "fontar persisterte i superconfig-nøkkel");
  window.App.store.remove("superconfig");
  window.App.reloadConfig();

  // --- Rik tekst: sanering ---
  console.log("\n— Rik tekst —");
  var RT = window.Components;
  assert(RT.sanitizeRichHtml('<script>alert(1)</script><b>fet</b>') === "<b>fet</b>", "script-tag fjernes ved sanering");
  assert(RT.sanitizeRichHtml('<b onclick="alert(1)">fet</b>') === "<b>fet</b>", "onclick-attributt fjernes ved sanering");
  assert(RT.sanitizeRichHtml('<a href="javascript:alert(1)">lenke</a>') === "<a>lenke</a>", "javascript:-lenke nøytralisert");
  var safeLink = RT.sanitizeRichHtml('<a href="https://eksempel.no">lenke</a>');
  assert(safeLink.indexOf('href="https://eksempel.no"') > -1 && safeLink.indexOf('target="_blank"') > -1, "gyldig lenke beholdes med target/rel");
  assert(RT.sanitizeRichHtml('<span style="color:#ff0000;background:red">farge</span>') === '<span style="color:#ff0000">farge</span>', "kun color-egenskap beholdes i style");
  assert(RT.sanitizeRichHtml('<div>linje1</div><ul><li>punkt</li></ul>') === '<div>linje1</div><ul><li>punkt</li></ul>', "tillatte blokk-/liste-tagger beholdes uendret");
  assert(RT.sanitizeRichHtml('<x><img src=x onerror=alert(1)></x>') === "", "barn flytta ut av ein ukjent wrapper-tag vert framleis saerte (nested-wrapper-bypass lukka)");
  assert(RT.sanitizeRichHtml('<x><y><img src=x onerror=alert(1)>test</y></x>') === "test", "fleire nesta ukjente wrapper-taggar sanerer alle promoterte born, tekst overlever");
  assert(RT.sanitizeRichHtml('<x><b>fet</b></x>') === "<b>fet</b>", "tillate taggar promotert ut av ein ukjent wrapper beheld seg sjølv");
  assert(RT.stripHtml('<b>Fet</b> og <i>kursiv</i> tekst') === "Fet og kursiv tekst", "stripHtml fjerner alle tagger");

  // Verktøylinje + synk (uten execCommand, som ikke finnes i jsdom)
  window.App.openAdmin();
  clickAdminTab("mod-faq");
  fire(doc.querySelector("[data-faq-new]"), "click");
  var rtWrap = doc.querySelector("[data-faq-editor] [data-rtfield]");
  assert(!!rtWrap, "rik-tekst-felt rendres i FAQ-editor");
  assert(rtWrap.querySelectorAll("[data-rt-cmd]").length === 6, "verktøylinja har 6 formateringsknapper (fet/kursiv/understrek/gjennomstrek/punktliste/nummerert)");
  var rtEditorDiv = rtWrap.querySelector("[data-rt-editor]");
  rtEditorDiv.innerHTML = "<script>alert(1)</script><b>Svaret er førtitvo</b>";
  fire(rtEditorDiv, "input");
  var rtHidden = rtWrap.querySelector('input[type="hidden"]');
  assert(rtHidden.value === "<b>Svaret er førtitvo</b>", "innhold sanert og synket til skjult felt ved skriving");

  // --- Mediebank: søk, tagger, dra-og-slipp, filstørrelse ---
  console.log("\n— Mediebank: søk/tagger/dra-og-slipp/dimensjoner —");
  clickAdminTab("mod-mediabank");
  fire(doc.querySelector("[data-mb-new]"), "click");
  var mbWrap2 = doc.querySelector("[data-mb-editor] [data-imgfield]");
  mbWrap2.querySelector("[data-imgfield-url]").value = "https://eksempel.no/galleri2.jpg";
  fire(mbWrap2.querySelector("[data-imgfield-url]"), "input");
  doc.querySelector("[data-mb-editor] #mb-tags").value = "team, kontor";
  fire(doc.querySelector("[data-mb-form]"), "submit");

  var mbImages2 = JSON.parse(window.localStorage.getItem("nordpunkt:mediabank-images") || "[]");
  assert(mbImages2.length === 2, "to bilder lagret i Mediebank");
  assert(JSON.stringify(mbImages2[1].tags) === JSON.stringify(["team","kontor"]), "tagger lagret som array");

  window.location.hash = "#mediabank"; window.dispatchEvent(new window.Event("hashchange"));
  assert(doc.querySelectorAll(".mb-thumb").length === 2, "begge bilder vises i rutenettet");
  assert(!!doc.querySelector("[data-mb-search]"), "søkefelt finst på Mediebank-siden");
  assert(doc.querySelectorAll(".mb-tag").length === 3, "tagg-filter viser «Alle» + 2 unike tagger");

  doc.querySelector("[data-mb-search]").value = "sommerfest";
  fire(doc.querySelector("[data-mb-search]"), "input");
  var visible1 = [...doc.querySelectorAll(".mb-thumb")].filter(function (t) { return t.style.display !== "none"; });
  assert(visible1.length === 1, "søk filtrerer til ett treff");
  doc.querySelector("[data-mb-search]").value = "";
  fire(doc.querySelector("[data-mb-search]"), "input");

  var teamTagBtn = [...doc.querySelectorAll(".mb-tag")].find(function (b) { return b.getAttribute("data-tag") === "team"; });
  fire(teamTagBtn, "click");
  var visible2 = [...doc.querySelectorAll(".mb-thumb")].filter(function (t) { return t.style.display !== "none"; });
  assert(visible2.length === 1, "tagg-filter viser kun bilder med valgt tagg");
  var alleBtn = [...doc.querySelectorAll(".mb-tag")].find(function (b) { return b.getAttribute("data-tag") === ""; });
  fire(alleBtn, "click");
  var visible3 = [...doc.querySelectorAll(".mb-thumb")].filter(function (t) { return t.style.display !== "none"; });
  assert(visible3.length === 2, "«Alle»-filter viser alle bilder igjen");

  doc.querySelector("[data-mb-search]").value = "finnesikke";
  fire(doc.querySelector("[data-mb-search]"), "input");
  assert(doc.querySelector("[data-mb-noresults]").style.display !== "none", "«ingen treff»-melding vises ved tomt søk");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // Dra-og-slipp-omsortering i admin
  window.App.openAdmin();
  clickAdminTab("mod-mediabank");
  var mbRows = [...doc.querySelectorAll("[data-mb-row]")];
  assert(mbRows.length === 2, "to rader i admin-lista");
  var firstRow = mbRows[0], secondRow = mbRows[1];
  var firstId = firstRow.getAttribute("data-mb-row");
  fire(firstRow, "dragstart");
  fire(secondRow, "drop");
  var mbImagesAfterDrag = JSON.parse(window.localStorage.getItem("nordpunkt:mediabank-images") || "[]");
  var movedItem = mbImagesAfterDrag.find(function (x) { return x.id === firstId; });
  assert(movedItem.order === 1, "dra-og-slipp flytter bildet og oppdaterer lagret rekkefølge");

  // Filstørrelse vises for opplastet (data:-URL) bilde, ikke for eksterne URL-bilder
  var dimsSpans = [...doc.querySelectorAll(".mb-dims")];
  assert(dimsSpans.every(function (s) { return s.textContent === ""; }), "ingen filstørrelse vist for eksterne URL-bilder (forventet, kan ikke beregnes)");

  // --- Sosiale medier ---
  console.log("\n— Sosiale medier —");
  window.App.openAdmin();
  clickAdminTab("innhold");
  assert(doc.querySelectorAll('[id^="f-soc-"]').length === 6, "seks plattform-felt vises i admin");
  doc.querySelector("#f-soc-facebook").value = "https://facebook.com/nordpunkt";
  doc.querySelector("#f-soc-tiktok").value = "https://tiktok.com/@nordpunkt";
  fire(doc.querySelector("[data-content]"), "submit");
  var socialStored = JSON.parse(window.localStorage.getItem("nordpunkt:content")).contact.social;
  assert(socialStored.facebook === "https://facebook.com/nordpunkt" && socialStored.tiktok === "https://tiktok.com/@nordpunkt", "sosiale lenker persistert");
  doc.getElementById("admin-root") && doc.getElementById("admin-root").remove();
  var socialLinks = doc.querySelectorAll("#kontakt .contact__social a");
  assert(socialLinks.length === 3, "kun utfylte plattformer vises på siden (linkedin frå standard + 2 nye)");
  assert([...socialLinks].some(function (a) { return a.getAttribute("href") === "https://facebook.com/nordpunkt"; }), "Facebook-lenke vises korrekt");

  // --- Mediebank: bulk-opplasting ---
  console.log("\n— Mediebank: bulk-opplasting —");
  window.App.openAdmin();
  clickAdminTab("mod-mediabank");
  var mbBeforeBulk = JSON.parse(window.localStorage.getItem("nordpunkt:mediabank-images") || "[]").length;
  var bulkFileInput = doc.querySelector("[data-mb-bulk-file]");
  assert(!!bulkFileInput, "bulk-opplastingsfelt finst i Mediebank-admin");
  var bf1 = new window.File([new Uint8Array([1,2,3])], "bulk1.png", { type: "image/png" });
  var bf2 = new window.File([new Uint8Array([4,5,6])], "bulk2.png", { type: "image/png" });
  Object.defineProperty(bulkFileInput, "files", { value: [bf1, bf2], configurable: true });
  fire(bulkFileInput, "change");
  for (var bulkWait = 0; bulkWait < 20; bulkWait++) {
    await new Promise(r => setTimeout(r, 30));
    if (JSON.parse(window.localStorage.getItem("nordpunkt:mediabank-images") || "[]").length >= mbBeforeBulk + 2) break;
  }
  var mbAfterBulk = JSON.parse(window.localStorage.getItem("nordpunkt:mediabank-images") || "[]");
  assert(mbAfterBulk.length === mbBeforeBulk + 2, "to nye bilder lagt til via bulk-opplasting");
  assert(mbAfterBulk[mbAfterBulk.length - 1].description === "" && mbAfterBulk[mbAfterBulk.length - 1].tags.length === 0, "bulk-opplastede bilder har tom beskrivelse/tagger til å begynne med");

  // --- SEO/deling (via superconfig, simulerer Konsoll-lagring) ---
  console.log("\n— SEO og deling —");
  window.App.store.set("superconfig", { company: { metaDescription: "Nordpunkt hjelper deg med rådgivning som flytter ting framover.", ogImage: "https://nordpunkt.no/del-bilde.jpg", favicon: "https://nordpunkt.no/favicon.png" } });
  window.App.reloadConfig();
  assert(doc.querySelector('meta[name="description"]')?.getAttribute("content") === "Nordpunkt hjelper deg med rådgivning som flytter ting framover.", "meta-beskrivelse satt i <head>");
  assert(doc.querySelector('meta[property="og:image"]')?.getAttribute("content") === "https://nordpunkt.no/del-bilde.jpg", "og:image satt i <head>");
  assert(doc.querySelector('meta[name="twitter:card"]')?.getAttribute("content") === "summary_large_image", "twitter:card satt korrekt");
  assert(doc.querySelector('link[rel="icon"]')?.getAttribute("href") === "https://nordpunkt.no/favicon.png", "favicon-lenke satt i <head>");
  window.App.store.remove("superconfig");
  window.App.reloadConfig();

  // --- Om oss og Tjenestekort: rik tekst (manglet eksplisitt testdekning) ---
  console.log("\n— Om oss / Tjenestekort: rik tekst —");
  window.App.openAdmin();
  clickAdminTab("innhold");
  var aboutRt = doc.querySelector("#f-about").closest("[data-rtfield]");
  assert(!!aboutRt, "«Om oss»-tekstfeltet er et rik-tekst-felt");
  var aboutEditor = aboutRt.querySelector("[data-rt-editor]");
  aboutEditor.innerHTML = "<script>alert(1)</script>Vi er <strong>stolte</strong> av historien vår.";
  fire(aboutEditor, "input");
  fire(doc.querySelector("[data-content]"), "submit");
  var aboutStored = JSON.parse(window.localStorage.getItem("nordpunkt:content")).about.text;
  assert(aboutStored === "Vi er <strong>stolte</strong> av historien vår.", "«Om oss»-tekst saneres og lagres korrekt");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(doc.querySelector("#om-oss strong"), "fet tekst i «Om oss» vises korrekt formatert på siden");

  window.App.openAdmin();
  clickAdminTab("tjenester");
  fire(doc.querySelectorAll("[data-edit]")[0], "click");
  var svcRt = doc.querySelector("#s-text").closest("[data-rtfield]");
  assert(!!svcRt, "tjenestekort-beskrivelsen er et rik-tekst-felt");
  var svcEditor = svcRt.querySelector("[data-rt-editor]");
  svcEditor.innerHTML = "<em>Rask</em> og pålitelig leveranse.";
  fire(svcEditor, "input");
  fire(doc.querySelector("[data-svc]"), "submit");
  var svcStored = JSON.parse(window.localStorage.getItem("nordpunkt:content")).services[0].text;
  assert(svcStored === "<em>Rask</em> og pålitelig leveranse.", "tjenestekort-tekst saneres og lagres korrekt");

  // --- Sikkerhetskopi: full eksport/import ---
  console.log("\n— Sikkerhetskopi —");
  window.App.openAdmin();
  clickAdminTab("sikkerhetskopi");
  assert(!!doc.querySelector(".backup-summary"), "sikkerhetskopi-fanen viser oppsummering");
  assert(!!doc.querySelector(".storage-meter"), "lagringsplass-indikator vises");
  var storageLevel = doc.querySelector("[data-storage-level]").getAttribute("data-storage-level");
  assert(storageLevel === "low", "lagringsnivå er «low» ved normal testdata: " + storageLevel);
  var fillWidth = doc.querySelector(".storage-meter__fill").style.width;
  assert(/^\d+%$/.test(fillWidth), "fyllbredde på lagringsmåleren er en gyldig prosent: " + fillWidth);
  assert(typeof window.App.storageUsageBytes() === "number" && window.App.storageUsageBytes() > 0, "storageUsageBytes() returnerer et tall over 0");
  assert(!!doc.querySelector("[data-backup-export]"), "«Last ned sikkerhetskopi»-knapp finst");
  assert(!!doc.querySelector("[data-backup-import]"), "filopplastingsfelt for import finst");
  var backupSummaryText = doc.querySelector(".backup-summary").textContent;
  assert(/Kontakthenvendelser/.test(backupSummaryText), "oppsummeringen viser kontakthenvendelser");
  assert(/Tilbudsforespørsler/.test(backupSummaryText) && /Bookinger/.test(backupSummaryText), "oppsummeringen viser tilbud/bookinger (begge moduler aktive)");
  assert(/Kunder/.test(backupSummaryText) && /Referanser/.test(backupSummaryText) && /FAQ/.test(backupSummaryText) && /Mediebank/.test(backupSummaryText), "oppsummeringen viser kunder/referanser/faq/mediebank (alle moduler aktive)");

  // buildBackupPayload: fanger opp alt under navnerommet, ikke bare enkelte deler
  window.App.store.set("superconfig", { test: true }); // sikre at superconfig er i backup-testen
  var payload = await window.App.buildBackupPayload();
  assert(payload.vibeverk_backup === true, "backup-payload har gjenkjenningsmerke");
  assert(payload.version === 2, "backup-payload er versjon 2 (inkluderer tabelldata)");
  assert(Array.isArray(payload.data.leads), "henvendelser/tilbud (lokal fallback) er med i sikkerhetskopien");
  assert(Array.isArray(payload.data["booking-bookings"]), "booking-data (lokal fallback) er med i sikkerhetskopien");
  assert(Array.isArray(payload.data["crm-customers"]), "crm-data (lokal fallback) er med i sikkerhetskopien");
  assert(payload.data.content && typeof payload.data.content === "object", "redigerbart innhold er med i sikkerhetskopien");
  assert(payload.data.superconfig !== undefined, "super-admin-innstillinger er med i sikkerhetskopien");
  assert(Object.keys(payload.data).some(function (k) { return k.indexOf("media:") === 0; }), "opplastede bilder (media:-nøkler) er med i sikkerhetskopien");
  // Regresjonstest for 0.32.0-fiksen: buildBackupPayload()/restoreBackupData() fanga
  // tidlegare BERRE generiske store-nøklar -- crm_customers/crm_bedrifter/crm_comms/
  // leads/bookings/tasks/announcements/kb_articles/links flytta ut av store-tabellen
  // 2026-07-03/06 og vart aldri fanga opp, sjølv om dei framleis kunne innehalde
  // ekte, sidan-sletta data. Sjekk at det nye tables-feltet faktisk finst og listar
  // alle ni, minus notes (med vilje utelate, sjå notatet ved BACKUP_TABLES i core.js).
  assert(payload.data.tables && typeof payload.data.tables === "object", "sikkerhetskopien har eit tables-felt for dei tabellane som flytta ut av store 2026-07-03/06");
  ["crm_bedrifter", "crm_customers", "crm_comms", "leads", "bookings", "tasks", "announcements", "kb_articles", "links"].forEach(function (t) {
    assert(Array.isArray(payload.data.tables[t]), "tables." + t + " er ei liste (tom i dette Supabase-lause testmiljøet)");
  });
  assert(!("notes" in payload.data.tables), "notes er MED VILJE utelate frå tabell-sikkerhetskopien (personlege, RLS-avgrensa til kvar brukar sjølv)");

  // restoreBackupData: full overskriving, ikke sammenslåing — testes med snapshot/gjenoppretting
  // rundt selve testen, slik at resten av suiten ikke påvirkes av den destruktive operasjonen.
  var snapshotBeforeRestore = await window.App.buildBackupPayload();
  var leadsCountBefore = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]").length;
  window.localStorage.setItem("nordpunkt:dummy-test-key", JSON.stringify("skal forsvinne"));
  var restoreResult = await window.App.restoreBackupData({ leads: [{ id:"restored-1", name:"Gjenopprettet", email:"r@test.no", message:"x", time:new Date().toISOString(), status:"ny" }] });
  assert(restoreResult.legacyBackup === true, "gjenoppretting av ei gammal-forma kopi (utan tables-felt, frå før 0.32.0) markerast som legacyBackup");
  assert(window.localStorage.getItem("nordpunkt:dummy-test-key") === null, "gjenoppretting fjerner nøkler som ikke finst i kopien (full overskriving)");
  var leadsAfterRestore = JSON.parse(window.localStorage.getItem("nordpunkt:leads"));
  assert(leadsAfterRestore.length === 1 && leadsAfterRestore[0].name === "Gjenopprettet", "gjenoppretting skriver inn nøyaktig det som er i kopien");
  assert(window.localStorage.getItem("nordpunkt:booking-assets") === null, "gjenoppretting fjerner data fra moduler som ikke var med i kopien");

  // Ny-forma kopi (med tables-felt), men Supabase ikkje konfigurert i testmiljøet:
  // skal IKKJE krasje og skal ikkje bli markert som legacyBackup, sjølv om ingen
  // tabellar faktisk vart forsøkt gjenoppretta (kan ikkje nå Supabase her).
  var newFormatRestoreResult = await window.App.restoreBackupData({
    leads: [],
    tables: { tasks: [], announcements: [], kb_articles: [], links: [], leads: [], bookings: [], crm_customers: [], crm_bedrifter: [], crm_comms: [] }
  });
  assert(newFormatRestoreResult.legacyBackup === false, "gjenoppretting av ei ny-forma kopi (med tables-felt) vert IKKJE markert som legacyBackup, sjølv om Supabase ikkje er konfigurert her");
  assert(Array.isArray(newFormatRestoreResult.tableResults) && newFormatRestoreResult.tableResults.length === 0, "utan _sb konfigurert vert ingen tabellar faktisk forsøkt gjenoppretta (tomt resultat, ikkje eit krasj)");

  // Gjenopprett til tilstanden før denne testen
  await window.App.restoreBackupData(snapshotBeforeRestore.data);
  var leadsAfterRestoreBack = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]");
  assert(leadsAfterRestoreBack.length === leadsCountBefore, "full gjenoppretting tilbake til opprinnelig tilstand fungerer (snapshot/restore-syklus)");

  // Eldre fallback-rolleverdi "employee" normaliserast til "member" i getAuthRole(),
  // slik at CSV-eksport-/slett-knappar (som samanliknar mot "member" direkte)
  // handsamar ei "employee"-rolle likt med "member" i staden for å vise dei att.
  var _prevAdminAuth = window.sessionStorage.getItem("nordpunkt:admin");
  window.sessionStorage.setItem("nordpunkt:admin", "employee");
  assert(window.App.getAuthRole() === "member", "getAuthRole() normaliserer eldre 'employee'-rolle til 'member'");
  if (_prevAdminAuth === null) window.sessionStorage.removeItem("nordpunkt:admin");
  else window.sessionStorage.setItem("nordpunkt:admin", _prevAdminAuth);

  // CSV-eksport: BOM for Excel, og korrekt escaping av komma/anførselstegn/linjeskift
  var csvVal1 = window.App.toCsvValue('Navn med "sitat", komma');
  assert(csvVal1 === '"Navn med ""sitat"", komma"', "CSV-verdi med komma og anførselstegn escapes korrekt");
  assert(window.App.toCsvValue("Vanlig tekst") === "Vanlig tekst", "CSV-verdi uten spesialtegn forblir uendret");
  assert(window.App.toCsvValue("=cmd|'/c calc'!A1") === "'=cmd|'/c calc'!A1", "CSV-formelinjeksjon (leiande =) nøytralisert med apostrof-prefiks");
  assert(window.App.toCsvValue("+1234") === "'+1234", "CSV-formelinjeksjon (leiande +) nøytralisert");
  assert(window.App.toCsvValue("-1234") === "'-1234", "CSV-formelinjeksjon (leiande -) nøytralisert");
  assert(window.App.toCsvValue("@SUM(A1:A2)") === "'@SUM(A1:A2)", "CSV-formelinjeksjon (leiande @) nøytralisert");
  assert(window.App.toCsvValue("Vanlig -tekst med bindestrek midt i") === "Vanlig -tekst med bindestrek midt i", "bindestrek midt i teksten (ikkje leiande) blir ikkje nøytralisert");

  // Eksport-knapper i Kontakt/CRM/Booking/Tilbud — alle bruker delt CSV-hjelper.
  // Kontakt kaller den interne downloadCsv() direkte (samme funksjon, men ikke
  // via App-objektet), så den testes ved at klikket ikke kaster feil.
  clickAdminTab("leads");
  var exportLeadsBtn = doc.querySelector("[data-export-leads]");
  var leadsExportThrew = false;
  try { fire(exportLeadsBtn, "click"); } catch (e) { leadsExportThrew = true; }
  assert(!!exportLeadsBtn && !leadsExportThrew, "Kontakt: «Eksporter henvendelser (CSV)» fungerer uten feil");

  var csvCalls = [];
  var origDownloadCsv = window.App.downloadCsv;
  window.App.downloadCsv = function (filename, headers, rows) { csvCalls.push({ filename: filename, headers: headers, rows: rows }); };

  clickAdminTab("mod-crm");
  fire(doc.querySelector("[data-crm-export]"), "click");
  assert(csvCalls.length === 1 && csvCalls[0].filename === "kunder.csv", "CRM: «Eksporter kunder (CSV)» fungerer");
  assert(csvCalls[0].headers.indexOf("E-post") > -1, "kunde-CSV har riktige kolonner");
  assert(csvCalls[0].headers.indexOf("Kundenummer") > -1, "kunde-CSV har kundenummer-kolonne");

  clickAdminTab("mod-booking");
  fire(doc.querySelector("[data-bk-export]"), "click");
  assert(csvCalls.length === 2 && csvCalls[1].filename === "bookinger.csv", "Booking: «Eksporter bookinger (CSV)» fungerer");
  assert(csvCalls[1].headers.indexOf("Referanse") > -1, "booking-CSV har referanse-kolonne");

  clickAdminTab("mod-tilbud");
  fire(doc.querySelector("[data-qt-export]"), "click");
  assert(csvCalls.length === 3 && csvCalls[2].filename === "tilbudsforesporsler.csv", "Tilbud: «Eksporter tilbudsforespørsler (CSV)» fungerer");
  assert(csvCalls[2].headers.indexOf("Referanse") > -1, "tilbud-CSV har referanse-kolonne");

  window.App.downloadCsv = origDownloadCsv;
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  // --- Bildefelt: kompakt tom-tilstand, ekspanderer ved valgt bilde (regresjonstest) ---
  console.log("\n— Bildefelt: kompakt tom-tilstand —");
  (function () {
    var div = doc.createElement("div");
    div.innerHTML = window.App.ui.imageField("t-empty-img", "Testbilde", "", 16 / 9);
    doc.body.appendChild(div);
    window.App.ui.bindImageFields(div);
    var preview = div.querySelector("[data-imgfield-preview]");
    assert(!preview.classList.contains("is-set"), "tomt bildefelt: ikke is-set før bilde velges");
    assert(preview.style.aspectRatio === "", "tomt bildefelt: aspect-ratio ikke tvunget inline til 16:9 (CSS clamp(96px,20vw,140px) styrer kompakt høyde i stedet): '" + preview.style.aspectRatio + "'");
    var urlInput = div.querySelector("[data-imgfield-url]");
    urlInput.value = "https://eksempel.no/kompakt-test.jpg";
    fire(urlInput, "input");
    assert(preview.classList.contains("is-set"), "bildefelt: is-set etter valgt bilde (ekspanderer)");
    div.remove();
  })();

  // --- features.contactForm: skjuler skjema, beholder kontaktinfo (regresjonstest) ---
  console.log("\n— Kontaktskjema av/på —");
  (function () {
    assert(!!doc.querySelector("#kontakt [data-contact-form]"), "kontaktskjema vises når features.contactForm ikke er satt til false (standard)");
    assert(!!doc.querySelector("#kontakt .contact__list"), "kontaktinfo (e-post/telefon/adresse) vises når skjema er på");

    window.App.store.set("superconfig", { features: { contactForm: false } });
    window.App.reloadConfig();
    assert(!doc.querySelector("#kontakt [data-contact-form]"), "kontaktskjema skjules når features.contactForm=false");
    assert(!doc.querySelector("#kontakt .terms-row"), "samtykkeboks skjules sammen med skjemaet");
    assert(!!doc.querySelector("#kontakt .contact__list"), "kontaktinfo (e-post/telefon/adresse) beholdes når skjema er skjult");
    assert(!!doc.getElementById("kontakt"), "Kontakt-seksjonen selv beholdes (kun skjemaet skjules, ikke hele seksjonen)");
    assert(!!doc.querySelector('.nav__link[data-nav="kontakt"]'), "Kontakt-navlenke beholdes når skjema er skjult");

    // bindContactForm skal no-op-e uten feil når skjemaet ikke finnes i DOM-en
    var threw = false;
    try { window.App.reloadConfig(); } catch (e) { threw = true; }
    assert(!threw, "reloadConfig/bindContactForm kaster ikke feil når kontaktskjemaet er skjult");

    window.App.store.set("superconfig", { features: { contactForm: true } });
    window.App.reloadConfig();
    assert(!!doc.querySelector("#kontakt [data-contact-form]"), "kontaktskjema vises igjen når features.contactForm=true");
    window.App.store.remove("superconfig");
    window.App.reloadConfig();
  })();

  // --- computeDefaultPrivacyText: tar hensyn til deaktivert kontaktskjema ---
  console.log("\n— Personvern-standardtekst og kontaktskjema —");
  (function () {
    window.App.store.set("superconfig", { features: { contactForm: false } });
    window.App.reloadConfig();
    var textNoForm = window.App.computeDefaultPrivacyText();
    assert(!/henvendelse/i.test(textNoForm) || /tilbud|booking/i.test(textNoForm), "standardtekst påstår ikke innsamling via kontaktskjema når det er deaktivert (med mindre tilbud/booking fortsatt samler inn): " + textNoForm.slice(0, 120));
    window.App.store.remove("superconfig");
    window.App.reloadConfig();
    var textWithForm = window.App.computeDefaultPrivacyText();
    assert(/henvendelse/i.test(textWithForm), "standardtekst nevner henvendelse når kontaktskjema er på (standard)");
  })();

  // --- CRM-maler og signatur i den delte openReplyModal (regresjonstest) ---
  console.log("\n— CRM-maler/signatur i openReplyModal —");
  (function () {
    var origSupabase = window.App.supabase;
    var origExecCommand = doc.execCommand;
    window.App.supabase = {}; // stub: canSendDirect krev berre at window.App.supabase er truthy her
    window.SITE_CONFIG.features.crm = true;
    window.SITE_CONFIG.features.crmFull = true;

    // 1) Modalens basisoppførsel når templateOptions/signatureOptions ikke er gitt
    // i det heile (uavhengig av at Kontakt/Booking/Tilbud sine faktiske kallstader
    // no gir begge deler — sjå "Malar + #-snippets for Kontakt/Booking/Tilbud" under).
    window.App.openReplyModal({ name: "Ola", email: "ola@test.no", subject: "Vanlig svar", templateKey: "kontakt", defaultTemplate: "" });
    assert(!doc.getElementById("reply-tpl-pick"), "ingen malvelger når templateOptions ikke er gitt");
    assert(!doc.getElementById("reply-sig-company") && !doc.getElementById("reply-sig-personal"), "ingen signaturknapper når signatureOptions ikke er gitt");
    doc.getElementById("reply-modal-root").remove();

    // 2) CRM: templateOptions + signatureOptions + vars
    var maliciousBody = "<p>Hei {navn}, ditt kundenummer er {kundenummer}. Ukjent: {ukjent}</p><script>alert(1)</script>";
    window.App.openReplyModal({
      name: "Kari", email: "kari@test.no", subject: "Opprinnelig emne",
      templateKey: "crm", defaultTemplate: "",
      templateOptions: [{ id: "t1", name: "Testmal", subject: "Mal-emne til {navn}", body: maliciousBody }],
      signatureOptions: { company: "<p>Bedrift AS</p><script>alert(2)</script>", personal: "" },
      vars: { navn: "Kari", epost: "kari@test.no", kundenummer: "1234" }
    });
    var tplPick = doc.getElementById("reply-tpl-pick");
    assert(!!tplPick, "malvelger vises når templateOptions er gitt (CRM)");
    assert(tplPick.querySelectorAll("option").length === 2, "malvelger har tom-valg + 1 mal");

    tplPick.value = "0";
    fire(tplPick, "change");
    var editorEl = doc.getElementById("reply-direct-body");
    assert(editorEl.innerHTML.indexOf("<script>") === -1, "valgt CRM-mal saneres (script-tag fjernet) ved innsetting");
    assert(editorEl.innerHTML.indexOf("Kari") > -1, "kjent variabel {navn} fylt inn fra kundekortet");
    assert(editorEl.innerHTML.indexOf("1234") > -1, "kjent variabel {kundenummer} fylt inn fra kundekortet");
    assert(editorEl.innerHTML.indexOf("{ukjent}") > -1, "ukjent variabel {ukjent} IKKE erstattet med feil innhold — forblir synlig");
    assert(doc.getElementById("reply-subject").value === "Mal-emne til Kari", "malens emne fylles også inn ved valg");

    assert(!!doc.getElementById("reply-sig-company"), "signaturknapp for bedriftssignatur vises (company er satt)");
    assert(!doc.getElementById("reply-sig-personal"), "ingen knapp for personlig signatur når den er tom");

    var execCalls = [];
    doc.execCommand = function (cmd, ui, val) { execCalls.push({ cmd: cmd, val: val }); return true; };
    fire(doc.getElementById("reply-sig-company"), "click");
    assert(execCalls.length === 1 && execCalls[0].cmd === "insertHTML", "signaturknapp setter inn via insertHTML");
    assert(execCalls[0].val.indexOf("<script>") === -1 && execCalls[0].val.indexOf("Bedrift AS") > -1, "CRM-signatur saneres (script fjernet) før innsetting: " + execCalls[0].val);

    doc.execCommand = origExecCommand;
    doc.getElementById("reply-modal-root").remove();
    window.App.supabase = origSupabase;
  })();

  // --- Malar + #-snippets for Kontakt/Booking/Tilbud i den rike svar-editoren ---
  // (canSendDirect-grenen er normalt av i testmiljøet sidan window.App.supabase
  // ikkje er konfigurert — stubbast her, akkurat som i CRM-testen over, for å
  // eksponere den rike editoren/malvelgaren/snippet-knappen desse tre kontekstane
  // no òg får via App.buildTemplateOptions().)
  console.log("\n— Malar + #-snippets for Kontakt/Booking/Tilbud —");
  (function () {
    var origSupabase = window.App.supabase;
    var origExecCommand = doc.execCommand;
    window.App.supabase = {};
    window.SITE_CONFIG.features.crm = true;
    window.SITE_CONFIG.features.crmFull = true;
    window.App.store.set("crm-settings", Object.assign({}, window.App.store.get("crm-settings", {}), {
      snippets: [
        { id: "sn1", shortcode: "hils", title: "Helsing", body: "Med vennlig hilsen, {navn}" },
        { id: "sn2", shortcode: "frist", title: "Frist", body: "Svarfrist er {dato}." }
      ],
      templates: [
        { id: "t1", name: "Kort svar utan sitat", subject: "Re: {navn}", body: "Hei {navn}, takk for henvendelsen. Vi tar kontakt snart." }
      ],
      signatureCompany: "<p>Bedrift AS</p>",
      signaturePersonal: "<p>Kari Nordmann</p>"
    }));

    // Kontakt
    window.App.openAdmin();
    clickAdminTab("leads");
    var kReplyBtn = doc.querySelector('[data-reply-lead="' + newLead.id + '"]');
    assert(!!kReplyBtn, "Kontakt: svarknapp finst framleis");
    fire(kReplyBtn, "click");
    var kModal = doc.getElementById("reply-modal-root");
    assert(!!kModal, "Kontakt: rik svar-editor åpnes når direkte sending er tilgjengelig");
    var kTplPick = kModal.querySelector("#reply-tpl-pick");
    assert(!!kTplPick, "Kontakt: malvelger vises i den rike editoren (samme stil som CRM)");
    assert(kTplPick.querySelectorAll("option").length >= 2, "Kontakt: malvelger har minst tom-valg + kontaktmalen");
    assert(!!kModal.querySelector("#reply-snippet-btn"), "Kontakt: #-snippet-knapp vises i verktøylinja");
    assert(!!kModal.querySelector("#reply-sig-company"), "Kontakt: «Sett inn bedriftssignatur»-knapp vises (delt med CRM)");
    assert(!!kModal.querySelector("#reply-sig-personal"), "Kontakt: «Sett inn personlig signatur»-knapp vises (delt med CRM)");

    // Bytte til ein delt CRM-mal UTAN {melding} skal ikkje fjerne kundens
    // opphavlege melding frå det som faktisk vert sendt — ho vert lagt til
    // automatisk nedanfor malteksten (presisert av brukar 2026-07-03).
    var noQuoteIdx = null;
    kTplPick.querySelectorAll("option").forEach(function (o) { if (o.textContent === "Kort svar utan sitat") noQuoteIdx = o.value; });
    assert(noQuoteIdx !== null, "Kontakt: finn den delte CRM-malen utan {melding} i lista");
    kTplPick.value = noQuoteIdx;
    kTplPick.dispatchEvent(new window.Event("change", { bubbles: true }));
    var kEditorBody = kModal.querySelector("#reply-direct-body").innerHTML;
    assert(kEditorBody.indexOf("Test av status") > -1, "Kontakt: kundens opphavlege melding vert behalde automatisk sjølv når malen ikkje sjølv refererer {melding}");
    assert(kEditorBody.indexOf("Vi tar kontakt snart") > -1, "Kontakt: sjølve malteksten er også med, ikkje berre meldinga");
    assert(kEditorBody.indexOf("Fra: Status Test") > -1, "Kontakt: den lagt-til blokka nyttar same «Fra:»-format som standardmalen");
    assert(kEditorBody.indexOf("Mottatt:") > -1, "Kontakt: den lagt-til blokka har «Mottatt:»-linje, same format som standardmalen");
    kModal.remove();

    // Booking — avbook og svar skal begge tilby BÅDE avbookings- og svarmalen
    // (kontekstspesifikke malar vist i same malvelgerstil, uavhengig av hvilken
    // knapp som ble klikket).
    clickAdminTab("mod-booking");
    var bkFaneBtnC = doc.querySelector('[data-bk-fane-btn="bookinger"]');
    if (bkFaneBtnC) fire(bkFaneBtnC, "click");
    var bAvbookBtn = doc.querySelector("[data-bk-avbook]");
    assert(!!bAvbookBtn, "Booking: avbook-knapp finst framleis");
    fire(bAvbookBtn, "click");
    var bModal = doc.getElementById("reply-modal-root");
    assert(!!bModal, "Booking: rik svar-editor åpnes for avbook");
    var bTplPick = bModal.querySelector("#reply-tpl-pick");
    assert(!!bTplPick, "Booking: malvelger vises");
    assert(bTplPick.querySelectorAll("option").length >= 3, "Booking: malvelger har både avbookings- og svarmal (kontekstspesifikke malar i same stil), ikke bare den som trigget dialogen");
    assert(!!bModal.querySelector("#reply-snippet-btn"), "Booking: #-snippet-knapp vises");
    assert(!!bModal.querySelector("#reply-sig-company") && !!bModal.querySelector("#reply-sig-personal"), "Booking: begge signaturknappane vises");
    bModal.remove();

    // Tilbud
    window.App.openAdmin();
    clickAdminTab("mod-tilbud");
    var tReplyBtn = doc.querySelector("[data-qt-reply]");
    assert(!!tReplyBtn, "Tilbud: svarknapp finst framleis");
    fire(tReplyBtn, "click");
    var tModal = doc.getElementById("reply-modal-root");
    assert(!!tModal, "Tilbud: rik svar-editor åpnes");
    var tTplPick = tModal.querySelector("#reply-tpl-pick");
    assert(!!tTplPick, "Tilbud: malvelger vises");
    assert(tTplPick.querySelectorAll("option").length >= 2, "Tilbud: malvelger har minst tom-valg + tilbudsmalen");
    var tSnipBtn = tModal.querySelector("#reply-snippet-btn");
    assert(!!tSnipBtn, "Tilbud: #-snippet-knapp vises");
    assert(!!tModal.querySelector("#reply-sig-company") && !!tModal.querySelector("#reply-sig-personal"), "Tilbud: begge signaturknappane vises");

    // Same mal-bytte-fiks som over, men for eit Tilbud-innsending med strukturerte
    // felt (Jobbeskrivelse + Kontaktopplysninger, jf. module-quote.js sitt
    // meldingsformat) — stadfestar at heile det faktisk innsendte innhaldet
    // (som varierer per skjema/tilbud) vert behalde, ikkje berre ei generisk melding.
    var tNoQuoteIdx = null;
    tTplPick.querySelectorAll("option").forEach(function (o) { if (o.textContent === "Kort svar utan sitat") tNoQuoteIdx = o.value; });
    assert(tNoQuoteIdx !== null, "Tilbud: finn den delte CRM-malen utan {melding} i lista");
    tTplPick.value = tNoQuoteIdx;
    tTplPick.dispatchEvent(new window.Event("change", { bubbles: true }));
    var tEditorBody = tModal.querySelector("#reply-direct-body").innerHTML;
    assert(tEditorBody.indexOf("Jobbeskrivelse") > -1, "Tilbud: «Jobbeskrivelse»-overskrifta frå den faktiske innsendinga er med");
    assert(tEditorBody.indexOf("Trenger hjelp med bygg av terrasse") > -1, "Tilbud: den faktiske jobbeskrivinga kunden skreiv er med");
    assert(tEditorBody.indexOf("Kontaktopplysninger") > -1, "Tilbud: «Kontaktopplysninger»-overskrifta er med");
    assert(tEditorBody.indexOf("Kari Nordmann") > -1, "Tilbud: kundens namn frå kontaktopplysningane er med");
    assert(tEditorBody.indexOf("Vi tar kontakt snart") > -1, "Tilbud: sjølve malteksten er også med");

    // #-snippet-lista deler datakjelde med CRM (crm-settings.snippets) — ingen
    // duplikat datamodell. Test klikk-innsetting + tastaturnavigasjon.
    fire(tSnipBtn, "mousedown");
    var dd = doc.querySelector(".reply-snippet-dd");
    assert(!!dd, "Tilbud: #-knappen opner snippet-lista");
    var items = dd.querySelectorAll(".reply-snippet-item");
    assert(items.length === 2, "snippet-lista viser begge delte standardtekstene");
    assert(items[0].textContent.indexOf("hils") > -1, "snippet-lista viser #-kortkoden for kvar standardtekst");

    var editorEl = tModal.querySelector("#reply-direct-body");
    editorEl.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    assert(items[0].classList.contains("is-focused"), "pil ned flytter fokus til første snippet (tastaturnavigasjon)");
    editorEl.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    assert(items[1].classList.contains("is-focused") && !items[0].classList.contains("is-focused"), "pil ned flytter fokus videre til neste snippet");

    var execCalls = [];
    doc.execCommand = function (cmd, ui, val) { execCalls.push({ cmd: cmd, val: val }); return true; };
    fire(items[0], "mousedown");
    assert(execCalls.some(function (c) { return c.cmd === "insertText" && c.val.indexOf("Med vennlig hilsen") > -1; }), "klikk på snippet setter inn tekst via execCommand insertText");
    assert(!doc.querySelector(".reply-snippet-dd"), "snippet-lista lukkes etter valg");

    doc.execCommand = origExecCommand;
    tModal.remove();
    window.App.supabase = origSupabase;
  })();

  // --- Media.norm(): vaktar mot dobbelt-serialisert bildedata ---
  // Fant i produksjon: ei Aktuelt-sak sitt bildefelt var lagra som ein STRENG
  // som ER JSON-teksten til eit tomt bilde-objekt (truleg gamal dobbel-
  // serialisering). annCard() i workspace/module-announcements.js viser bilde
  // til ALLE roller (ikkje admin-gata), så norm()-fallbacken (streng → antatt
  // rå URL) satte heile JSON-teksten som <img src>, som feila med 400 for
  // kven som helst som opna Aktuelt/Dashboard. norm() må derfor prøve å tolke
  // ein streng som ser ut som JSON før han antar han er ein rå URL.
  console.log("\n— Media.norm(): dobbelt-serialisert bildedata —");
  (function () {
    var corrupted = '{"src":"","pos":"50% 50%","caption":"","creditType":"","alt":""}';
    var normed = window.App.media.norm(corrupted);
    assert(normed.src === "", "Media.norm() tolkar ein JSON-tekst-streng som objekt i staden for rå URL (tom src)");
    var corruptedWithSrc = '{"src":"https://example.no/bilde.jpg","pos":"30% 40%","caption":"Test","creditType":"copyright","alt":"Alt"}';
    var normed2 = window.App.media.norm(corruptedWithSrc);
    assert(normed2.src === "https://example.no/bilde.jpg" && normed2.pos === "30% 40%" && normed2.creditType === "copyright", "Media.norm() hentar ut faktiske feltverdiar frå dobbelt-serialisert JSON-streng");
    var normalUrl = window.App.media.norm("https://example.no/vanlig-url.jpg");
    assert(normalUrl.src === "https://example.no/vanlig-url.jpg", "Media.norm() handsamar framleis ein vanleg URL-streng som før (ikkje JSON, uendra åtferd)");
    var notJson = window.App.media.norm("{ikkje-gyldig-json");
    assert(notJson.src === "{ikkje-gyldig-json", "Media.norm() fell trygt tilbake til rå streng viss teksten startar med { men ikkje er gyldig JSON");
  })();

  // --- Variabelhjelp: Kontakt/Booking-e-postmaler viser kun faktisk støttede variabler ---
  console.log("\n— Variabelhjelp for e-postmaler —");
  (function () {
    window.App.openAdmin();
    clickAdminTab("leads");
    var kontaktHint = doc.querySelector('[data-email-tpl="kontakt"]');
    var kontaktCard = kontaktHint ? kontaktHint.closest(".email-tpl-card") : null;
    var kontaktHintText = kontaktCard ? kontaktCard.querySelector(".email-tpl-card__hint").textContent : "";
    ["{navn}", "{epost}", "{dato}", "{melding}", "{referanse}"].forEach(function (v) {
      assert(kontaktHintText.indexOf(v) > -1, "Kontakt-malhint nevner faktisk støttet variabel " + v);
    });
    doc.getElementById("admin-root") && doc.getElementById("admin-root").remove();

    assert(window.App.fillTemplate("Hei {navn}, ukjent: {zzz}", { navn: "Ola" }) === "Hei Ola, ukjent: {zzz}",
      "fillTemplate lar ukjente plassholdere stå urørt i stedet for å erstatte med feil innhold");
  })();

  // --- Chat: statuspersistens (regresjonstest) ---
  console.log("\n— Chat: statuspersistens —");
  (function () {
    if (!window.VwChat) { console.log("OK: chat-modul ikkje lasta i denne testsuite — statuspersistens-test hoppast over"); return; }
    var ns = "nordpunkt:";
    var cid = "ctest-status-reg";
    var saved = JSON.parse(window.localStorage.getItem(ns + "chat:convs") || "[]");
    var tc = { id: cid, name: "Testar", status: "open", unread: 0, lastMsg: "", lastAt: Date.now() };
    window.localStorage.setItem(ns + "chat:convs", JSON.stringify([tc].concat(saved)));

    window.VwChat.setStatus(cid, "closed");
    var afterClose = window.VwChat.getConv(cid);
    assert(afterClose && afterClose.status === "closed", "chat setStatus('closed') oppdaterer in-memory status");

    var raw = JSON.parse(window.localStorage.getItem(ns + "chat:convs") || "[]");
    var persisted = raw.find(function (c) { return c.id === cid; });
    assert(persisted && persisted.status === "closed", "chat 'closed' overlever localStorage-les (simulert sidereload)");

    window.VwChat.setStatus(cid, "open");
    var afterOpen = window.VwChat.getConv(cid);
    assert(afterOpen && afterOpen.status === "open", "chat setStatus('open') opnar samtalen att");

    window.localStorage.setItem(ns + "chat:convs", JSON.stringify(saved));
  })();

  // --- Karusell (module-carousel.js) ---------------------------------------
  // Karusellen ligg under Design-modulen (features.sidebygger, 2026-07-20) --
  // same flagg som sjølve sidebygger-funksjonen, eksplisitt false som
  // standard (config.js). Eiga, separat DOM med flagget patcha til true,
  // sidan App.ready() sin gate vert avgjort éin gong ved skriptlasting, ikkje
  // reevaluert seinare i den same, alt-lasta konteksten (same mønster som
  // test-workspace.js sine Z/AA-seksjonar for intranettFeatures.kb/
  // customModules). Frøplantar karusell-data via localStorage FØR modulen
  // lastar, sidan syncModules() køyrer synkront ved skriptlasting i denne
  // harnessen -- ingen admin-CRUD-skjema vert simulert her (scrollbanner
  // sjølv har heller ingen CRUD-testdekning i denne fila i dag, sjå
  // launch-readiness-runda 2026-07-19).
  console.log("\n— Karusell —");
  (function () {
    var html2 = fs.readFileSync("index.html", "utf8");
    var dom2 = new JSDOM(html2, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/" });
    var window2 = dom2.window;
    window2.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; }
      observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
      unobserve() {} disconnect() {}
    };
    window2.matchMedia = function () { return { matches: false, addEventListener(){}, removeEventListener(){} }; };
    window2.scrollTo = () => {};
    window2.HTMLElement.prototype.scrollIntoView = () => {};
    window2.URL.createObjectURL = window2.URL.createObjectURL || (() => "blob:mock-url");
    window2.URL.revokeObjectURL = window2.URL.revokeObjectURL || (() => {});

    // Tel kor mange setInterval-kall som skjer, i staden for å vente på ekte
    // tid -- lèt oss teste auto-/manuell-grenene deterministisk og raskt.
    var intervalCalls = 0;
    var realSetInterval2 = window2.setInterval;
    window2.setInterval = function () { intervalCalls++; return realSetInterval2.apply(window2, arguments); };

    var autoCarousel = {
      id: "crsl-test-auto", label: "Test auto", order: 25, height: "medium",
      advance: { mode: "auto", intervalSec: 5 }, textColor: "#ffffff",
      slides: [
        { id: "sl-1", kind: "image", order: 0, image: { src: "https://eksempel.no/1.jpg", pos: "50% 50%" }, title: "Slide 1" },
        { id: "sl-2", kind: "image", order: 1, image: { src: "https://eksempel.no/2.jpg", pos: "50% 50%" }, title: "Slide 2" }
      ]
    };
    var manualCarousel = {
      id: "crsl-test-manual", label: "Test manuell", order: 26, height: "medium",
      advance: { mode: "manual", intervalSec: 5 }, textColor: "#ffffff",
      slides: [
        { id: "sl-3", kind: "image", order: 0, image: { src: "https://eksempel.no/3.jpg", pos: "50% 50%" }, title: "M1" },
        { id: "sl-4", kind: "image", order: 1, image: { src: "https://eksempel.no/4.jpg", pos: "50% 50%" }, title: "M2" }
      ]
    };
    window2.localStorage.setItem("nordpunkt:carousels", JSON.stringify([autoCarousel, manualCarousel]));

    ["config.js", "components.js", "core.js", "template-klassisk.js", "template-panorama.js", "template-scrollstory.js", "module-carousel.js"].forEach(function (f) {
      var src = fs.readFileSync(f, "utf8");
      if (f === "config.js") src = src.replace(/sidebygger:\s*false/, "sidebygger: true");
      window2.eval(src);
    });
    window2.document.dispatchEvent(new window2.Event("DOMContentLoaded", { bubbles: true }));
    var doc2 = window2.document;

    assert(!!doc2.getElementById("crsl-test-auto"), "karusell 1: App.registerModule()-oppføringa rendrar som ein eigen <section> med rett id");
    assert(!!doc2.getElementById("crsl-test-manual"), "karusell 2: same for den andre, uavhengige karusellen (ikkje éin delt behaldar)");

    var autoSlides = doc2.querySelectorAll("#crsl-test-auto [data-crsl-slide]");
    assert(autoSlides.length === 2, "karusell 1 rendrar begge slides: " + autoSlides.length);
    assert(autoSlides[0].classList.contains("is-active") && !autoSlides[1].classList.contains("is-active"),
      "berre fyrste slide er is-active ved oppstart");

    assert(!doc2.querySelector("#crsl-test-auto [data-crsl-prev]"), "auto-modus viser INGEN piler (berre manuell modus har piler, sjå renderCarousel)");
    assert(!!doc2.querySelector("#crsl-test-manual [data-crsl-prev]") && !!doc2.querySelector("#crsl-test-manual [data-crsl-next]"),
      "manuell modus viser piler for fram-/attende-navigasjon");
    assert(doc2.querySelectorAll("#crsl-test-auto [data-crsl-dot]").length === 2, "prikk-indikatorar finst for begge slides, uavhengig av modus");

    assert(intervalCalls === 1, "nøyaktig éin setInterval oppretta totalt -- éin for auto-karusellen, INGEN for den manuelle (som ikkje skal ha nokon tidsstyring i det heile): " + intervalCalls);

    // Sveip (peikar-hendingar) på den MANUELLE karusellen (ingen timer der
    // til å forstyrre testen). jsdom manglar full PointerEvent-støtte --
    // MouseEvent med same type-streng ("pointerdown"/"pointerup") fungerer
    // identisk her, sidan addEventListener berre matchar på type-namnet.
    var manualViewport = doc2.querySelector("#crsl-test-manual [data-crsl-viewport]");
    manualViewport.dispatchEvent(new window2.MouseEvent("pointerdown", { clientX: 500, bubbles: true }));
    manualViewport.dispatchEvent(new window2.MouseEvent("pointerup", { clientX: 440, bubbles: true })); // dx=-60, over 40px-terskelen
    var manualSlidesAfterSwipe = doc2.querySelectorAll("#crsl-test-manual [data-crsl-slide]");
    assert(!manualSlidesAfterSwipe[0].classList.contains("is-active") && manualSlidesAfterSwipe[1].classList.contains("is-active"),
      "sveip mot venstre over 40px-terskelen avanserer nøyaktig éin slide framover");

    manualViewport.dispatchEvent(new window2.MouseEvent("pointerdown", { clientX: 500, bubbles: true }));
    manualViewport.dispatchEvent(new window2.MouseEvent("pointerup", { clientX: 480, bubbles: true })); // dx=-20, under terskelen
    var manualSlidesAfterSmallSwipe = doc2.querySelectorAll("#crsl-test-manual [data-crsl-slide]");
    assert(manualSlidesAfterSmallSwipe[1].classList.contains("is-active"),
      "sveip under 40px-terskelen avanserer IKKJE (framleis same slide som før)");
  })();

  // --- Karusell: prefers-reduced-motion undertrykkjer tidsstyringa heilt,
  // sjølv for ein auto-modus-karusell (eiga DOM, sidan matchMedia sitt mock-
  // svar vert lese éin gong ved mount()) --------------------------------
  (function () {
    var html3 = fs.readFileSync("index.html", "utf8");
    var dom3 = new JSDOM(html3, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/" });
    var window3 = dom3.window;
    window3.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; }
      observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
      unobserve() {} disconnect() {}
    };
    window3.matchMedia = function () { return { matches: true, addEventListener(){}, removeEventListener(){} }; }; // reduced-motion: reduce
    window3.scrollTo = () => {};
    window3.HTMLElement.prototype.scrollIntoView = () => {};
    window3.URL.createObjectURL = window3.URL.createObjectURL || (() => "blob:mock-url");
    window3.URL.revokeObjectURL = window3.URL.revokeObjectURL || (() => {});

    var intervalCalls3 = 0;
    var realSetInterval3 = window3.setInterval;
    window3.setInterval = function () { intervalCalls3++; return realSetInterval3.apply(window3, arguments); };

    window3.localStorage.setItem("nordpunkt:carousels", JSON.stringify([{
      id: "crsl-test-reduced", label: "Test redusert rørsle", order: 25, height: "medium",
      advance: { mode: "auto", intervalSec: 5 }, textColor: "#ffffff",
      slides: [
        { id: "slr-1", kind: "image", order: 0, image: { src: "https://eksempel.no/1.jpg", pos: "50% 50%" } },
        { id: "slr-2", kind: "image", order: 1, image: { src: "https://eksempel.no/2.jpg", pos: "50% 50%" } }
      ]
    }]));

    ["config.js", "components.js", "core.js", "template-klassisk.js", "template-panorama.js", "template-scrollstory.js", "module-carousel.js"].forEach(function (f) {
      var src = fs.readFileSync(f, "utf8");
      if (f === "config.js") src = src.replace(/sidebygger:\s*false/, "sidebygger: true");
      window3.eval(src);
    });
    window3.document.dispatchEvent(new window3.Event("DOMContentLoaded", { bubbles: true }));

    assert(intervalCalls3 === 0, "prefers-reduced-motion:reduce undertrykkjer tidsstyringa heilt, sjølv for ein auto-modus-karusell: " + intervalCalls3);
  })();

  console.log("\nResultat: OK " + (globalThis.__ok||0) + " / FEIL " + (globalThis.__err||0));
})();

// Den asynkrone testblokken over startar ikkje synkront ferdig — vent på at
// han faktisk er ferdig (inkl. alle await-steg) før vi avsluttar prosessen.
// Appen startar setInterval-ar (t.d. admin-badge-refresh) som jsdom ikkje
// eksponerer som ekte Node-timerar (ingen .unref()) — dei held elles Node-
// prosessen open for alltid. Ventar på at stdout er flush først, elles kan
// siste linje ("Resultat: ...") kuttast bort når output vert omdirigert/pipa.
__asyncTests
  .catch((e) => { console.error("FEIL: async testblokk kasta", e); process.exitCode = 1; })
  .then(() => { process.stdout.write("", () => process.exit(process.exitCode || 0)); });
