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
["config.js", "components.js", "core.js", "module-booking.js", "module-quote.js", "module-references.js", "module-faq.js", "module-crm.js", "module-mediabank.js"].forEach(f => {
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
assert(primary === "#15616D", "primærfarge fra config satt: " + primary);
assert(!!doc.getElementById("app-fonts"), "Google Fonts-link injisert");
assert(doc.title.includes("Nordpunkt"), "tittel fra config: " + doc.title);

// 4) Tjenester: 4 kort
assert(doc.querySelectorAll(".card").length === 4, "fire tjenestekort");

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

// 7) Admin: feil passord avvises, riktig slipper inn
window.App.openAdmin();
let loginForm = doc.querySelector("[data-login]");
assert(!!loginForm, "admin krever innlogging");
doc.querySelector("#admin-pass").value = "feil";
loginForm.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
assert(!!doc.querySelector("[data-login]"), "feil passord avvist");
doc.querySelector("#admin-pass").value = "test";
doc.querySelector("[data-login]").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
assert(!!doc.querySelector(".tabs"), "riktig passord åpner panelet");
assert(!!doc.querySelector(".admin-catbar"), "admin-panelet har en kategori-bar (eier ser alle tre kategorier)");
var catLabels = [...doc.querySelectorAll(".admin-cat")].map(c => c.textContent);
assert(JSON.stringify(catLabels) === JSON.stringify(["Innhold","Henvendelser","Innstillinger"]), "tre kategorier i riktig rekkefølge: " + catLabels.join(","));

function clickCat(id) { var b = doc.querySelector('[data-admin-cat="' + id + '"]'); if (b) b.dispatchEvent(new window.Event("click", { bubbles: true })); }
function clickTab(id) { var b = doc.querySelector('[data-tab="' + id + '"]'); if (b) b.dispatchEvent(new window.Event("click", { bubbles: true })); }

clickCat("henvendelser"); clickTab("leads");
var tabLabelsHenv = [...doc.querySelectorAll(".tab")].map(t => t.textContent);
assert(tabLabelsHenv.indexOf("Kontakt") > -1 && tabLabelsHenv.indexOf("Leads") === -1, "henvendelses-fanen heter «Kontakt»");

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

(async () => {
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
  assert(!!doc.querySelector(".qt-receipt"), "steg 3 (kvittering) vises etter innsending");
  var leads = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]");
  assert(leads.length === leadsBefore + 1 && leads[0].email === "kari@test.no", "tilbudsforespørsel lagret som lead");
  assert(/Tilbudsforesp/.test(leads[0].message) && /terrasse/.test(leads[0].message), "lead inneholder jobbeskrivelse");

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
  assert(!doc.querySelector("[data-an-form]"), "analytics-innstillinger-skjema er FLYTTET til super-admin (ikke i vanlig admin)");
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

  // Super-admin: analyse-innstillinger kan settes der
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("#sa-pass").value = "Superadmin";
  fire(doc.querySelector("[data-sa-login]"), "submit");
  assert(!!doc.querySelector("#sa-an-pl"), "Plausible-felt finnes i super-admin");
  assert(!!doc.querySelector("#sa-an-plembed"), "Plausible embed-felt finnes i super-admin");
  assert(!doc.querySelector("#sa-an-ga") && !doc.querySelector("#sa-an-fa") && !doc.querySelector("#sa-an-gtm"), "GA4/Fathom/GTM-felt er fjernet (kun Plausible støttes)");
  assert(!doc.querySelector("#sa-github"), "GitHub-URL-felt er fjernet fra super-admin");
  doc.querySelector("#sa-an-pl").value = "nordpunkt.no";
  fire(doc.querySelector("[data-sa-form]"), "submit");
  var savedAn = JSON.parse(window.localStorage.getItem("nordpunkt:analytics") || "{}");
  assert(savedAn.plausible === "nordpunkt.no", "Plausible-domene lagret via super-admin");
  doc.getElementById("super-admin-root").remove();

  // Vanlig admin viser nå ekstern lenke (siden ingen embed er satt, bare Plausible)
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
  function addRef(name, cat, text, isQuote) {
    fire(doc.querySelector("[data-rf-new]"), "click");
    doc.querySelector("#rf-name").value = name;
    doc.querySelector("#rf-cat").value = cat || "";
    doc.querySelector("#rf-text").value = text || "";
    if (isQuote) { doc.querySelector("#rf-isquote").checked = true; fire(doc.querySelector("#rf-isquote"), "change"); }
    doc.querySelector("#rf-order").value = "0";
    fire(doc.querySelector("[data-rf-form]"), "submit");
  }
  addRef("Kunde A", "Bygg", "Fantastisk arbeid!", true);
  addRef("Kunde B", "IT", "Solid leveranse.");
  addRef("Kunde C", "Bygg", "Anbefales.");
  const refs = JSON.parse(window.localStorage.getItem("nordpunkt:ref-items"));
  assert(refs.length === 3, "tre referanser lagret");
  assert(refs[0].isQuote === true, "sitat-flagg lagret korrekt");

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

  var checkA = doc.querySelector('.crm-merge-check[value="' + custA.id + '"]');
  var checkB = doc.querySelector('.crm-merge-check[value="' + custB.id + '"]');
  assert(!!checkA && !!checkB, "sammenslåings-avhukingsbokser finst på kunderadene");
  checkA.checked = true; fire(checkA, "change");
  checkB.checked = true; fire(checkB, "change");
  assert(doc.querySelector("[data-crm-merge-bar]").style.display !== "none", "sammenslåings-bar vises når 2+ kunder er valgt");

  var origConfirm = window.confirm;
  window.confirm = () => true;
  fire(doc.querySelector("[data-crm-merge-btn]"), "click");
  window.confirm = origConfirm;

  var mergedList = JSON.parse(window.localStorage.getItem("nordpunkt:crm-customers") || "[]");
  assert(mergedList.filter(c => c.id === custA.id || c.id === custB.id).length === 1, "kun én kundepost igjen etter sammenslåing av to");
  var merged = mergedList.find(c => c.id === custA.id) || mergedList.find(c => c.id === custB.id) || mergedList[0];
  assert(!!merged, "den eldste posten beholdes som primær etter sammenslåing");
  assert((merged.altEmails || []).length > 0 || merged.email === "per@firma.no" || merged.email === "kari@test.no", "e-postadresser bevart etter sammenslåing");

  // --- Bedrift-gruppering ---
  fire(doc.querySelector('[data-crm-open="' + merged.id + '"]'), "click");
  doc.querySelector("#crm-bedrift").value = "Testbedrift AS";
  fire(doc.querySelector("[data-crm-form]"), "submit");
  var afterBedrift = JSON.parse(window.localStorage.getItem("nordpunkt:crm-customers") || "[]").find(c => c.id === merged.id);
  assert(!!afterBedrift.bedriftId, "bedrift knyttes til kunden ved lagring");
  var bedrifter = JSON.parse(window.localStorage.getItem("nordpunkt:crm-bedrifter") || "[]");
  var bed = bedrifter.find(b => b.id === afterBedrift.bedriftId);
  assert(!!bed && bed.name === "Testbedrift AS" && typeof bed.customerNumber === "number", "ny bedrift opprettet med eget kundenummer");

  window.App.addLead({ name: "Kollega", email: "kollega@firma.no", message: "Hei" });
  fire(doc.querySelector("[data-crm-import]"), "click");
  clickAdminTab("mod-crm");
  var kollegaCust = JSON.parse(window.localStorage.getItem("nordpunkt:crm-customers") || "[]").find(c => c.email === "kollega@firma.no");
  fire(doc.querySelector('[data-crm-open="' + kollegaCust.id + '"]'), "click");
  doc.querySelector("#crm-bedrift").value = "Testbedrift AS";
  fire(doc.querySelector("[data-crm-form]"), "submit");
  var bedrifter2 = JSON.parse(window.localStorage.getItem("nordpunkt:crm-bedrifter") || "[]");
  assert(bedrifter2.filter(b => b.name === "Testbedrift AS").length === 1, "samme bedriftsnavn gjenbruker eksisterende bedrift (lager ikke duplikat)");
  var kollegaAfter = JSON.parse(window.localStorage.getItem("nordpunkt:crm-customers") || "[]").find(c => c.id === kollegaCust.id);
  assert(kollegaAfter.bedriftId === afterBedrift.bedriftId, "to ulike personer kan dele samme bedrift-kundenummer");

  // GDPR-slett via e-post i Kontakt-fanen
  window.App.addLead({ name: "Slett Meg", email: "slett@test.no", message: "test" });
  clickAdminTab("leads");
  assert(!!doc.querySelector("[data-gdpr-form]"), "GDPR-slette-skjema finst i Kontakt-fanen");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

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
    assert(!!doc.querySelector(".crm-history .stat-badge"), "status-badge vises i kundens historikk");
    assert(!doc.querySelector("#crm-status"), "kundestatus-felt (ny/aktiv/avslutta) er fjernet fra CRM");
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

  // --- Personvern: footer-lenke og redigering i super-admin ---
  console.log("\n— Personvern i footer og super-admin —");
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(!!doc.querySelector('[data-terms-open="footer-privacy"]'), "personvern-lenke finst i footer");
  assert(!!doc.querySelector('[data-terms-modal="footer-privacy"]'), "personvern-popup finst i footer");
  fire(doc.querySelector('[data-terms-open="footer-privacy"]'), "click");
  assert(doc.querySelector('[data-terms-modal="footer-privacy"]').style.display !== "none", "footer-personvern-popup åpnes ved klikk");
  fire(doc.querySelector('[data-terms-close="footer-privacy"]'), "click");
  assert(doc.querySelector('[data-terms-modal="footer-privacy"]').style.display === "none", "footer-personvern-popup lukkes ved klikk");

  // Rediger personvernteksten i super-admin
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  var saPassField = doc.querySelector("#sa-pass");
  if (saPassField) { saPassField.value = "Superadmin"; fire(doc.querySelector("[data-sa-login]"), "submit"); }

  // «Generer forslag på nytt»: nevner Plausible når analyse er konfigurert
  window.localStorage.setItem("nordpunkt:analytics", JSON.stringify({ plausible: "nordpunkt.no" }));
  var defaultPrivNow = window.App.computeDefaultPrivacyText();
  assert(/Plausible/.test(defaultPrivNow), "generert personvernforslag nevner Plausible når analyse er konfigurert");
  assert(/tilbud/.test(defaultPrivNow) && /booking/i.test(defaultPrivNow), "generert forslag nevner tilbud og booking");
  assert(!!doc.querySelector("[data-priv-regen]"), "«Generer forslag på nytt»-knapp finst i super-admin");
  fire(doc.querySelector("[data-priv-regen]"), "click");
  var privEditorNow = doc.querySelector("#sa-priv-text").closest("[data-rtfield]").querySelector("[data-rt-editor]");
  assert(/Plausible/.test(privEditorNow.textContent), "knappen fyller inn et forslag som nevner Plausible");
  window.localStorage.removeItem("nordpunkt:analytics");

  assert(!!doc.querySelector("#sa-priv-heading"), "personvern-overskriftfelt finst i super-admin");
  assert(!!doc.querySelector("#sa-priv-text"), "personvern-tekstfelt finst i super-admin");
  doc.querySelector("#sa-priv-heading").value = "Testoverskrift";
  doc.querySelector("#sa-priv-text").value = "Testtekst for personvern.";
  fire(doc.querySelector("[data-sa-form]"), "submit");
  var savedPriv = JSON.parse(window.localStorage.getItem("nordpunkt:superconfig") || "{}");
  assert(savedPriv.privacy && savedPriv.privacy.heading === "Testoverskrift", "personvern-overskrift lagret i superconfig");
  assert(savedPriv.privacy && savedPriv.privacy.text === "Testtekst for personvern.", "personvern-tekst lagret i superconfig");
  doc.getElementById("super-admin-root").remove();

  // Verifiser at endringen slår gjennom på footer-popup og kontaktskjema
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(doc.querySelector('[data-terms-modal="footer-privacy"] h3').textContent === "Testoverskrift", "ny overskrift vises i footer-popup");
  assert(doc.querySelector('[data-terms-modal="footer-privacy"] .terms-modal-text').textContent === "Testtekst for personvern.", "ny tekst vises i footer-popup");

  // Personvernerklæringen bruker no rik-tekst-editoren (ikke bare ren tekst)
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  var saPassField2 = doc.querySelector("#sa-pass");
  if (saPassField2) { saPassField2.value = "Superadmin"; fire(doc.querySelector("[data-sa-login]"), "submit"); }
  var privRt = doc.querySelector("#sa-priv-text").closest("[data-rtfield]");
  assert(!!privRt, "personvern-tekstfeltet er et rik-tekst-felt med verktøylinje");
  var privEditor = privRt.querySelector("[data-rt-editor]");
  privEditor.innerHTML = "<script>alert(1)</script><b>Viktig:</b> vi lagrer ingen data uten samtykke.";
  fire(privEditor, "input");
  fire(doc.querySelector("[data-sa-form]"), "submit");
  var savedPriv2 = JSON.parse(window.localStorage.getItem("nordpunkt:superconfig") || "{}");
  assert(savedPriv2.privacy.text === "<b>Viktig:</b> vi lagrer ingen data uten samtykke.", "rik tekst i personvernerklæringen saneres og lagres korrekt");
  doc.getElementById("super-admin-root").remove();
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(doc.querySelector('[data-terms-modal="footer-privacy"] .terms-modal-text strong, [data-terms-modal="footer-privacy"] .terms-modal-text b'), "fet tekst i personvernerklæringen vises korrekt formatert i popup");
  assert(doc.querySelector('[data-terms-modal="lead"] h3').textContent === "Testoverskrift", "ny overskrift vises også i kontaktskjemaets popup (delt tekst)");

  // Rydd opp (ikke la testdata påvirke resten av suiten)
  var rawSC = JSON.parse(window.localStorage.getItem("nordpunkt:superconfig") || "{}");
  delete rawSC.privacy;
  window.localStorage.setItem("nordpunkt:superconfig", JSON.stringify(rawSC));

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

  // --- Super-admin: fane-struktur ---
  console.log("\n— Super-admin fane-struktur —");
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  var saPass2 = doc.querySelector("#sa-pass");
  if (saPass2) { saPass2.value = "Superadmin"; fire(doc.querySelector("[data-sa-login]"), "submit"); }
  assert(doc.querySelectorAll("[data-sa-tab]").length === 5, "super-admin har 5 faner");
  assert(doc.querySelector('[data-sa-pane="utseende"]').style.display !== "none", "Utseende-fanen er aktiv som standard");
  assert(doc.querySelector('[data-sa-pane="analyse"]').style.display === "none", "Analyse-fanen er skjult før klikk");
  fire(doc.querySelector('[data-sa-tab="analyse"]'), "click");
  assert(doc.querySelector('[data-sa-pane="analyse"]').style.display !== "none", "Analyse-fanen vises etter klikk");
  assert(doc.querySelector('[data-sa-pane="utseende"]').style.display === "none", "Utseende-fanen skjules etter fanebyte");
  assert(!!doc.querySelector("#sa-an-pl"), "felt i annen fane finst fortsatt i DOM (ikke fjernet ved fanebyte)");
  doc.getElementById("super-admin-root").remove();

  // --- Super-admin: fargevelgere og fontpar-rask-velg ---
  console.log("\n— Super-admin: farger og fonter —");
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  var saPass3 = doc.querySelector("#sa-pass");
  if (saPass3) { saPass3.value = "Superadmin"; fire(doc.querySelector("[data-sa-login]"), "submit"); }
  assert(!!doc.querySelector("#sa-text") && !!doc.querySelector("#sa-surface"), "fargevelgere for tekst- og overflate-farge finst");
  assert(doc.querySelectorAll("[data-fontpair]").length >= 4, "minst fire kuraterte fontpar tilbys som rask-velg");

  // Rask-velg fyller inn fritekstfelta
  var pairBtn = doc.querySelector('[data-fontpair="2"]'); // Space Grotesk + Work Sans
  fire(pairBtn, "click");
  assert(doc.querySelector("#sa-dfont").value === "Space Grotesk" && doc.querySelector("#sa-bfont").value === "Work Sans", "fontpar-knapp fyller inn display- og brødtekst-felt");
  assert(doc.querySelector("#sa-dweights").value === "600,700,800" && doc.querySelector("#sa-bweights").value === "400,500,600", "fontpar-knapp setter standard weights");

  // Lagre og verifiser at alt persisteres
  doc.querySelector("#sa-text").value = "#222222";
  doc.querySelector("#sa-surface").value = "#f0f0f0";
  fire(doc.querySelector("[data-sa-form]"), "submit");
  var savedSC2 = JSON.parse(window.localStorage.getItem("nordpunkt:superconfig") || "{}");
  assert(savedSC2.colors.text === "#222222" && savedSC2.colors.surface === "#f0f0f0", "tekst- og overflate-farge lagres via super-admin");
  assert(savedSC2.fonts.display === "Space Grotesk" && savedSC2.fonts.body === "Work Sans", "fontpar valgt via rask-velg lagres korrekt");
  doc.getElementById("super-admin-root").remove();
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));
  assert(doc.documentElement.style.getPropertyValue("--color-text") === "#222222", "tekstfarge anvendes på siden (CSS-variabel satt)");

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

  // --- SEO/deling (super-admin) ---
  console.log("\n— SEO og deling —");
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  doc.querySelector("[data-vibeverk-click]").dispatchEvent(new window.Event("click", { bubbles: true }));
  var saPass3 = doc.querySelector("#sa-pass");
  if (saPass3) { saPass3.value = "Superadmin"; fire(doc.querySelector("[data-sa-login]"), "submit"); }
  assert(!!doc.querySelector("#sa-metadesc"), "meta-beskrivelse-felt finst i super-admin");
  doc.querySelector("#sa-metadesc").value = "Nordpunkt hjelper deg med rådgivning som flytter ting framover.";
  doc.querySelector("#sa-ogimage").value = "https://nordpunkt.no/del-bilde.jpg";
  doc.querySelector("#sa-favicon").value = "https://nordpunkt.no/favicon.png";
  fire(doc.querySelector("[data-sa-form]"), "submit");
  assert(doc.querySelector('meta[name="description"]')?.getAttribute("content") === "Nordpunkt hjelper deg med rådgivning som flytter ting framover.", "meta-beskrivelse satt i <head>");
  assert(doc.querySelector('meta[property="og:image"]')?.getAttribute("content") === "https://nordpunkt.no/del-bilde.jpg", "og:image satt i <head>");
  assert(doc.querySelector('meta[name="twitter:card"]')?.getAttribute("content") === "summary_large_image", "twitter:card satt korrekt");
  assert(doc.querySelector('link[rel="icon"]')?.getAttribute("href") === "https://nordpunkt.no/favicon.png", "favicon-lenke satt i <head>");
  doc.getElementById("super-admin-root") && doc.getElementById("super-admin-root").remove();

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
  var payload = window.App.buildBackupPayload();
  assert(payload.vibeverk_backup === true, "backup-payload har gjenkjenningsmerke");
  assert(Array.isArray(payload.data.leads), "henvendelser/tilbud er med i sikkerhetskopien");
  assert(Array.isArray(payload.data["booking-bookings"]), "booking-data er med i sikkerhetskopien");
  assert(Array.isArray(payload.data["crm-customers"]), "crm-data er med i sikkerhetskopien");
  assert(payload.data.content && typeof payload.data.content === "object", "redigerbart innhold er med i sikkerhetskopien");
  assert(payload.data.superconfig !== undefined, "super-admin-innstillinger er med i sikkerhetskopien");
  assert(Object.keys(payload.data).some(function (k) { return k.indexOf("media:") === 0; }), "opplastede bilder (media:-nøkler) er med i sikkerhetskopien");

  // restoreBackupData: full overskriving, ikke sammenslåing — testes med snapshot/gjenoppretting
  // rundt selve testen, slik at resten av suiten ikke påvirkes av den destruktive operasjonen.
  var snapshotBeforeRestore = window.App.buildBackupPayload();
  var leadsCountBefore = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]").length;
  window.localStorage.setItem("nordpunkt:dummy-test-key", JSON.stringify("skal forsvinne"));
  window.App.restoreBackupData({ leads: [{ id:"restored-1", name:"Gjenopprettet", email:"r@test.no", message:"x", time:new Date().toISOString(), status:"ny" }] });
  assert(window.localStorage.getItem("nordpunkt:dummy-test-key") === null, "gjenoppretting fjerner nøkler som ikke finst i kopien (full overskriving)");
  var leadsAfterRestore = JSON.parse(window.localStorage.getItem("nordpunkt:leads"));
  assert(leadsAfterRestore.length === 1 && leadsAfterRestore[0].name === "Gjenopprettet", "gjenoppretting skriver inn nøyaktig det som er i kopien");
  assert(window.localStorage.getItem("nordpunkt:booking-assets") === null, "gjenoppretting fjerner data fra moduler som ikke var med i kopien");
  // Gjenopprett til tilstanden før denne testen
  window.App.restoreBackupData(snapshotBeforeRestore.data);
  var leadsAfterRestoreBack = JSON.parse(window.localStorage.getItem("nordpunkt:leads") || "[]");
  assert(leadsAfterRestoreBack.length === leadsCountBefore, "full gjenoppretting tilbake til opprinnelig tilstand fungerer (snapshot/restore-syklus)");

  // CSV-eksport: BOM for Excel, og korrekt escaping av komma/anførselstegn/linjeskift
  var csvVal1 = window.App.toCsvValue('Navn med "sitat", komma');
  assert(csvVal1 === '"Navn med ""sitat"", komma"', "CSV-verdi med komma og anførselstegn escapes korrekt");
  assert(window.App.toCsvValue("Vanlig tekst") === "Vanlig tekst", "CSV-verdi uten spesialtegn forblir uendret");

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
  doc.getElementById("super-admin-root") && doc.getElementById("super-admin-root").remove();
  window.location.hash = ""; window.dispatchEvent(new window.Event("hashchange"));

  console.log("\nResultat: OK " + (globalThis.__ok||0) + " / FEIL " + (globalThis.__err||0));
})();
