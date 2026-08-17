"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var test = require("node:test");
var JSDOM = require("jsdom").JSDOM;
var code = fs.readFileSync("console/console-core.js", "utf8");

function esc(value) {
  return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function field(options) {
  var o = options || {};
  return '<div class="field"><label for="' + esc(o.id) + '">' + esc(o.label) + '</label>' +
    (o.multiline ? '<textarea id="' + esc(o.id) + '" rows="' + (o.rows || 3) + '">' + esc(o.value || "") + '</textarea>' : '<input id="' + esc(o.id) + '" type="' + esc(o.type || "text") + '" value="' + esc(o.value || "") + '">') + '</div>';
}

function button(options) {
  var o = options || {};
  return '<button ' + (o.attrs || "") + '>' + esc(o.label || "") + '</button>';
}

// Minimal, tru kopi av richTextField()/App.ui-funksjonane (same mønster som
// test-compliance-console.js alt brukar) -- naudsynt her for at "Rediger
// (opprett nytt utkast)" (renderPersonvernDokument sin draft-gren) skal
// kunne rendrast utan å krasje på App.ui.bindRichTextFields.
function sanitizeRichHtml(html) { return String(html || ""); }
function richTextField(o) {
  o = o || {};
  return '<div class="field rtfield" data-rtfield><label>' + esc(o.label) + '</label>' +
    '<div class="rtfield__editor" contenteditable="true" data-rt-editor></div>' +
    '<input type="hidden" id="' + esc(o.id) + '" value="' + esc(sanitizeRichHtml(o.value || "")) + '"></div>';
}
function bindRichTextFields(scope) {
  scope.querySelectorAll("[data-rtfield]").forEach(function (wrap) {
    var editor = wrap.querySelector("[data-rt-editor]");
    var hidden = wrap.querySelector('input[type="hidden"]');
    editor.innerHTML = hidden.value || "";
    function sync() { hidden.value = sanitizeRichHtml(editor.innerHTML); }
    editor.addEventListener("input", sync);
    editor.addEventListener("blur", sync);
  });
}
function readRichTextField(scope, id) {
  var el = scope.querySelector("#" + id);
  return el ? sanitizeRichHtml(el.value) : "";
}
function setRichTextField(scope, id, html) {
  var hidden = scope.querySelector("#" + id);
  if (!hidden) return;
  var wrap = hidden.closest("[data-rtfield]");
  var editor = wrap && wrap.querySelector("[data-rt-editor]");
  var sanitized = sanitizeRichHtml(html || "");
  hidden.value = sanitized;
  if (editor) editor.innerHTML = sanitized;
}
function textToRichHtml(text) {
  return String(text || "").split(/\n\n+/).map(function (para) {
    return "<p>" + esc(para).replace(/\n/g, "<br>") + "</p>";
  }).join("");
}

// Ei generisk kontrollplan-tabellspørring (operators/tenants osv.) -- same
// "same svar uansett kjede"-mønster som dei andre Console-testfilene alt
// brukar (test-customer-analysis-console.js sin query()).
function query(result) {
  var value = {
    select: function () { return value; }, eq: function () { return value; },
    order: function () { return Promise.resolve(result); }, single: function () { return Promise.resolve(result); },
    maybeSingle: function () { return Promise.resolve(result); }
  };
  return value;
}

// KUNDEN sin eigen "store"-tabell (superconfig/analytics) -- MÅ skilje på kva
// key som faktisk vert spurt om (getSC() spør "superconfig", Personvern sine
// Leverandørar-/Dokument-faner spør "analytics" separat), difor ein eigen,
// smartare mock enn den generiske query()-en over.
function storeQuery(valuesByKey) {
  var lastKey = null;
  var chain = {
    select: function () { return chain; },
    eq: function (col, val) { if (col === "key") lastKey = val; return chain; },
    maybeSingle: function () { return Promise.resolve({ data: { value: valuesByKey[lastKey] || {} }, error: null }); }
  };
  return chain;
}

var SC_SEED = {
  productMode: "web",
  features: { contactForm: true, quote: false, booking: false, chat: false },
  company: { name: "Test AS" },
  contact: {},
  footer: { orgNr: "" },
  privacy: { heading: "Personvern", text: "", forms: {}, consentPurposes: [], suppliers: { supabaseRegion: "" } }
};

// dpa_status-verdiane her matchar no den RETTA modellen (2026-08-13, sjå
// migrasjon 20260813120000): supabase/resend/plausible "confirmed" (DPA
// stadfesta i kraft automatisk via kvar leverandør sin eigen ToS), vercel
// "blocked" (DPA gjeld stadfesta berre Pro/Enterprise, kontoen er Hobby).
var VENDOR_REGISTRY_SEED = [
  { id: "supabase", name: "Supabase", what_it_does: "TILPASSA SKILDRING FRÅ DATABASEN, IKKJE HARDKODA", country: "eu", transfer_mechanism: "none", dpa_status: "confirmed", dpa_note: "Signert av ekte Vibeverk AS.", sort_order: 1 },
  { id: "vercel", name: "Vercel", what_it_does: "Hosting og tenant-ruting", country: "us", transfer_mechanism: "scc", dpa_status: "blocked", dpa_note: "", sort_order: 2 },
  { id: "resend", name: "Resend", what_it_does: "Utsending og mottak av e-post", country: "us", transfer_mechanism: "scc_or_dpf", dpa_status: "confirmed", dpa_note: "", sort_order: 3 },
  { id: "plausible", name: "Plausible Analytics", what_it_does: "Cookiefri trafikkstatistikk", country: "eu", transfer_mechanism: "none", dpa_status: "confirmed", dpa_note: "", sort_order: 4 }
];

// Returnerer { dom, vendorRegistryFetchCount() } -- teljaren let testane
// stadfeste at vendor_registry vert henta NØYAKTIG éin gong per Console-økt
// (proaktivt ved Personvern-opning), ikkje fleire gonger eller aldri
// (Security Auditor-funn 2026-08-12: fyrste utkastet av byttet henta berre
// lat inni Leverandørar-fana, som lét "Standardforslag" i Dokument-fana --
// standardfana -- stille bruke den hardkoda VIBEVERK_VENDORS-fallbacken
// heilt til nokon tilfeldigvis hadde besøkt Leverandørar fyrst).
async function mount(opts) {
  opts = opts || {};
  var dom = new JSDOM('<!doctype html><html><body><div id="console-app"></div></body></html>', { runScripts: "outside-only", pretendToBeVisual: true, url: "https://vibeverk.no/console/" });
  var window = dom.window;
  window.SITE_CONFIG = { storageKey: "nordpunkt", company: { name: "Vibeverk" } };
  window.App = { ready: function (callback) { callback(window.SITE_CONFIG); }, ui: { bindRichTextFields: bindRichTextFields, readRichTextField: readRichTextField, setRichTextField: setRichTextField, textToRichHtml: textToRichHtml } };
  window.Components = { esc: esc, field: field, button: button, richTextField: richTextField, sanitizeRichHtml: sanitizeRichHtml, helpIcon: function () { return ""; } };
  var vendorRegistryFetchCount = 0;
  var control = {
    auth: { onAuthStateChange: function () {}, getSession: function () { return Promise.resolve({ data: { session: { access_token: "operator-token", user: { id: "op-1" }, expires_at: 4102444800 } } }); }, signOut: function () {} },
    from: function (table) {
      if (table === "operators") return query({ data: { status: "active" }, error: null });
      if (table === "tenants") return query({ data: [{ id: "t1", slug: "tenant", status: "active", data_plane_url: "https://tenant.example", data_plane_anon_key: "anon", data_plane_storage_key: "nordpunkt" }], error: null });
      if (table === "vendor_registry") { vendorRegistryFetchCount++; return query(opts.vendorRegistryResult || { data: VENDOR_REGISTRY_SEED, error: null }); }
      throw new Error("Uventet kontrollplan-tabell " + table);
    },
    functions: { invoke: function (name, invokeOpts) {
      var body = (invokeOpts && invokeOpts.body) || {};
      if (name === "broker" && body.action === "get_private_config") {
        return Promise.resolve({ data: { value: {} }, error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    } }
  };
  // Djup klone -- SC_SEED er delt mellom alle mount()-kall i denne fila.
  // sc er ein referanse som seinare vert MUTERT direkte (sc.privacy = ...,
  // sc._vendorRegistry = ...) av console-core.js sjølv -- utan klonen ville
  // ein test sin cacha sc._vendorRegistry lekke inn i neste, heilt urelaterte
  // test (fanga under skriving av denne testfila, ikkje eit ekte
  // produksjonsproblem, sidan éin verkeleg operatørsesjon berre har ÉIN sc).
  var scSeedClone = JSON.parse(JSON.stringify(SC_SEED));
  // opts.features (2026-08-17, ny for "Kunder og kundedialog"-testane): lèt
  // ein test overstyre enkeltfelt i features utan å måtte klone/skrive om
  // heile SC_SEED sjølv.
  if (opts.features) Object.assign(scSeedClone.features, opts.features);
  // opts.privacyVersions (2026-08-17, orphan-avsnitt-regresjonstesten):
  // let ein test seede eit ALT PUBLISERT versjonssett direkte, i staden for
  // å la migratePrivacyVersions() lage ein tom v1 -- naudsynt for å
  // simulere ein tenant som publiserte FØR 0.150.0 (med intro/breach-
  // blokker alt liggjande i bodyBlocks).
  if (opts.privacyVersions) Object.assign(scSeedClone.privacy, opts.privacyVersions);
  var tenant = {
    from: function (table) {
      // "content" (2026-08-13-brukarfunn): kunden sitt eige Web-admin-
      // innhald (kontaktinfo m.m.) -- ei HEILT ANNA lagringsnøkkel enn
      // superconfig, sjå notatet ved computeTenantPrivacyBlocks().
      //
      // superconfig: MÅ vere ein FRISK klone kvar gong (ikkje scSeedClone
      // direkte) -- getSC() (Publiser-handteraren sin avsluttande
      // "hent fersk, skriv attende"-runde) ville elles fått sc2 === sc
      // (same objekt-referanse), og sc2.privacy = privacyPublicProjection(sc)
      // ville då stille RIVE VEKK sc.privacy.versions/activeVersionId frå
      // operatøren sin eigen, framleis-i-bruk in-memory-tilstand (funne under
      // skriving av denne testen -- ekte produksjon hentar alltid eit
      // separat, deserialisert objekt frå databasen, aldri same JS-referanse).
      if (table === "store") return storeQuery({ superconfig: JSON.parse(JSON.stringify(scSeedClone)), analytics: opts.analytics || {}, content: opts.content || {} });
      throw new Error("Uventa tenant-tabell " + table);
    }
  };
  var calls = 0;
  window.supabase = { createClient: function () { calls += 1; return calls === 1 ? control : tenant; } };
  window.confirm = function () { return true; };
  window.alert = function () {};
  window.eval(code);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  await new Promise(function (resolve) { setTimeout(resolve, 25); });
  return { dom: dom, vendorRegistryFetchCount: function () { return vendorRegistryFetchCount; } };
}

async function openPersonvern(m) {
  m.dom.window.VwConsole.navigate("personvern");
  await new Promise(function (resolve) { setTimeout(resolve, 25); }); // ventar på BÅDE get_private_config OG vendor_registry
}
async function switchToLeverandorerTab(m) {
  m.dom.window.document.querySelector('[data-privacy-view="leverandorer"]').click();
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
}
function sectionText(m) { return m.dom.window.document.querySelector("#cs-section-wrap").textContent; }

test("Leverandørar-fana viser vendor_registry sitt innhald, ikkje lenger berre den hardkoda VIBEVERK_VENDORS-teksten", async function (t) {
  var m = await mount({});
  t.after(function () { m.dom.window.close(); });
  await openPersonvern(m);
  await switchToLeverandorerTab(m);
  var text = sectionText(m);
  assert.match(text, /TILPASSA SKILDRING FRÅ DATABASEN, IKKJE HARDKODA/, "vendor_registry-innhaldet er faktisk det som vert vist");
  assert.match(text, /Stadfesta/, "DPA-status frå databasen (confirmed) vert vist, ikkje ein hardkoda 'tba'");
});

test("«blocked» DPA-status (Vercel-tilfellet, P0-fiks 2026-08-13) vises som Blokkert, ikkje som TBA/Stadfesta", async function (t) {
  var m = await mount({});
  t.after(function () { m.dom.window.close(); });
  await openPersonvern(m);
  await switchToLeverandorerTab(m);
  var text = sectionText(m);
  assert.match(text, /Blokkert/, "den nye 'blocked'-statusen (feil plan hos leverandøren) har eit eige, synleg operatørspråk");
});

test("vendor_registry vert henta proaktivt ved Personvern-opning (Dokument er standardfana), ikkje berre lat inni Leverandørar", async function (t) {
  var m = await mount({});
  t.after(function () { m.dom.window.close(); });
  await openPersonvern(m);
  // Framleis på Dokument-fana (standard) -- ingen har trykt på Leverandørar enno.
  assert.equal(m.vendorRegistryFetchCount(), 1, "vendor_registry er alt henta FØR nokon underfane er vald, sidan Standardforslag (i Dokument) treng han med det same");
  await switchToLeverandorerTab(m);
  assert.equal(m.vendorRegistryFetchCount(), 1, "byte til Leverandørar-fana hentar IKKJE på nytt -- alt cacha frå den proaktive hentinga");
  assert.match(sectionText(m), /TILPASSA SKILDRING FRÅ DATABASEN, IKKJE HARDKODA/);
});

test("Plausible-raden filtrerast framleis på om Plausible faktisk er aktiv for kunden (vendorIsActive-logikken flytta ikkje til SQL)", async function (t) {
  var mUtenPlausible = await mount({ analytics: {} });
  t.after(function () { mUtenPlausible.dom.window.close(); });
  await openPersonvern(mUtenPlausible);
  await switchToLeverandorerTab(mUtenPlausible);
  assert.doesNotMatch(sectionText(mUtenPlausible), /Plausible Analytics/, "Plausible skal IKKJE visast når han ikkje er aktiv");

  var mMedPlausible = await mount({ analytics: { plausible: "example.no" } });
  await openPersonvern(mMedPlausible);
  await switchToLeverandorerTab(mMedPlausible);
  assert.match(sectionText(mMedPlausible), /Plausible Analytics/, "Plausible SKAL visast når han er aktiv");
  mMedPlausible.dom.window.close();
});

test("Feil ved henting av vendor_registry fell trygt attende til VIBEVERK_VENDORS i staden for å krasje fana", async function (t) {
  var m = await mount({ vendorRegistryResult: { data: null, error: { message: "nettverksfeil" } } });
  t.after(function () { m.dom.window.close(); });
  await openPersonvern(m);
  await switchToLeverandorerTab(m);
  var text = sectionText(m);
  assert.match(text, /Supabase/, "fallback-innhaldet (VIBEVERK_VENDORS) vert vist i staden for ei tom/krasja fane");
  assert.doesNotMatch(text, /TILPASSA SKILDRING/, "ingen DB-tekst skal dukke opp når hentinga feila");
});

test("«Generer full tekstversjon» opnar ei lesbar førehandsvising og kan lukkast att (publisert visning)", async function (t) {
  var m = await mount({});
  t.after(function () { m.dom.window.close(); });
  await openPersonvern(m);
  // Framleis på Dokument-fana (standard) -- ein fersk v1 er alltid PUBLISERT
  // (migratePrivacyVersions()), sjølv med tomt innhald.
  var btn = m.dom.window.document.querySelector("#cs-priv-fulltext");
  assert(btn, "«Generer full tekstversjon»-knappen finst i den publiserte visinga");
  btn.click();
  var modalText = m.dom.window.document.body.textContent;
  assert.match(modalText, /Personvernerklæring — full tekst/, "modal-tittelen er sett");
  assert.match(modalText, /Tomt innhald/, "eit tomt fersk utkast syner placeholder-teksten, ikkje ein feil/krasj");
  var closeBtn = m.dom.window.document.querySelector("#cs-text-preview-close");
  assert(closeBtn, "lukk-knappen finst");
  closeBtn.click();
  assert.equal(m.dom.window.document.querySelector("#cs-text-preview-close"), null, "modalen fjernar seg sjølv frå DOM-en ved lukking");
});

// Ein fersk v1 er alltid PUBLISERT (migratePrivacyVersions()) -- «Publiser»-
// knappen finst berre i eit UTKAST, difor "Rediger (opprett nytt utkast)"
// fyrst i begge testane under, same steg ein ekte operatør må gjennom.
async function openNewDraft(m) {
  m.dom.window.document.querySelector("#cs-priv-new-draft").click();
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
}

test("Publiser-sperra sjekkar kunden sitt eige 'content' (Web-admin-kontaktinfo), IKKJE sc.contact som aldri eksisterer (2026-08-13-brukarfunn)", async function (t) {
  var m = await mount({ content: {} }); // content.contact heilt fråverande -- akkurat scenarioet brukaren trefte
  t.after(function () { m.dom.window.close(); });
  await openPersonvern(m);
  await openNewDraft(m);
  var capturedAlert = null;
  m.dom.window.alert = function (msg) { capturedAlert = msg; };
  var btn = m.dom.window.document.querySelector("#cs-priv-publish");
  assert(btn, "«Publiser»-knappen finst i utkast-visinga");
  btn.click();
  await new Promise(function (resolve) { setTimeout(resolve, 20); }); // ventar på getStoreKeyOrError("content", ...)
  assert(capturedAlert, "sperra utløyser eit varsel når kontaktinfo manglar");
  assert.match(capturedAlert, /kontaktinformasjon/, "varselet nemner kontaktinformasjon");
  assert.match(capturedAlert, /Web-admin-panel.*Innhald.*Kontaktinfo/, "varselet peikar til den FAKTISKE staden (kunden sitt eige Web-admin, Innhald -> Kontaktinfo) -- IKKJE Console sin eigen 'Web -> Firma'-fane, som aldri har hatt desse felta");
});

test("Publiser går gjennom når kunden faktisk har fylt ut kontaktinfo i sitt eige Web-admin-panel", async function (t) {
  var m = await mount({ content: { contact: { email: "post@kunden.no", phone: "", address: "" } } });
  t.after(function () { m.dom.window.close(); });
  await openPersonvern(m);
  await openNewDraft(m);
  var capturedAlert = null;
  m.dom.window.alert = function (msg) { capturedAlert = msg; };
  var btn = m.dom.window.document.querySelector("#cs-priv-publish");
  btn.click();
  await new Promise(function (resolve) { setTimeout(resolve, 30); }); // ventar på content- OG analytics-hentinga, deretter sjølve lagringa
  assert.equal(capturedAlert, null, "ingen publiseringssperre-varsel når content.contact faktisk har ein verdi: " + capturedAlert);
  assert.match(sectionText(m), /Publisert/, "publiseringa gjekk faktisk gjennom");
});

// MERK (oppdatert 2026-08-17): kommentaren som stod her hevda "Standardforslag"
// var for kostbar å teste end-to-end (kravde rik-tekst-editor-infrastruktur).
// Den investeringa vart likevel gjort (sjå sanitizeRichHtml/richTextField/
// bindRichTextFields/readRichTextField/setRichTextField over, lagt til for
// openNewDraft()/Publiser-testane) -- "Standardforslag" kan no testast billig,
// difor testane under. computeSupplierBlock() sin eigen vendor_registry-logikk
// er framleis dekt direkte via Leverandørar-fana over, ikkje duplisert her.
test("Standardforslag genererer «Kunder og kundedialog»-avsnittet (nytt 2026-08-17), IKKJE lenger noko «Melding ved brudd»-avsnitt (flytta til DPA)", async function (t) {
  var m = await mount({});
  t.after(function () { m.dom.window.close(); });
  await openPersonvern(m);
  await openNewDraft(m);
  m.dom.window.document.querySelector("#cs-priv-fetch").click();
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  var text = sectionText(m);
  assert.match(text, /Kunder og kundedialog/, "ny kundedialog-blokk finst i standardforslaget (features.crm er ikkje sett -- default på)");
  assert.doesNotMatch(text, /Melding ved brudd/, "breach-avsnittet skal IKKJE lenger finnast i personvernteksten -- flytta til DPA-malen");
});

test("Standardforslag: opningsavsnittet bruker kundens eige firmanavn dynamisk, ikkje ein hardkoda placeholder", async function (t) {
  var m = await mount({});
  t.after(function () { m.dom.window.close(); });
  await openPersonvern(m);
  await openNewDraft(m);
  m.dom.window.document.querySelector("#cs-priv-fetch").click();
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  var text = sectionText(m);
  assert.match(text, /Test AS er behandlingsansvarlig/, "SC_SEED sitt firmanavn (Test AS) kjem gjennom i den genererte teksten: " + text.slice(0, 300));
});

test("Standardforslag: «Kunder og kundedialog» forsvinn når features.crm er skrudd eksplisitt av", async function (t) {
  var m = await mount({ features: { crm: false } });
  t.after(function () { m.dom.window.close(); });
  await openPersonvern(m);
  await openNewDraft(m);
  m.dom.window.document.querySelector("#cs-priv-fetch").click();
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  assert.doesNotMatch(sectionText(m), /Kunder og kundedialog/, "blokka skal IKKJE genererast når kunden ikkje har CRM-modulen");
});

// MERK 2026-08-17 (same dag, brukaren ombestemte seg): "intro" var
// opphavleg pensjonert saman med "breach" i denne testen sin fyrste
// versjon, men brukaren ville ha "intro" attende (med NY tekst, sjå
// computeTenantPrivacyBlocks()) -- berre "breach" er faktisk pensjonert no.
// Testen dekker difor to ulike ting: "intro" sin GAMLE tekst skal
// erstattast (ikkje ståande att i tillegg til den nye), "breach" skal
// forsvinne heilt (ingen fresh-versjon i det heile lenger).
test("Standardforslag erstattar gamal «intro»-tekst med fersk tekst (ikkje begge), og droppar «breach» heilt (arkitektonisk pensjonert, flytta til DPA)", async function (t) {
  var oldIntroBlock = { id: "intro", source: "module", moduleId: "intro", included: true, edited: false, body: "<p><strong>Om denne personvernerklæringen</strong></p><p>Gamal, pensjonert innleiingstekst.</p>" };
  var oldBreachBlock = { id: "breach", source: "module", moduleId: "breach", included: true, edited: false, body: "<p><strong>Melding ved brudd på personopplysningssikkerheten</strong></p><p>Gamal, pensjonert tekst -- høyrer no heime i DPA-en.</p>" };
  var oldVersion = { id: "v1", status: "published", basedOnVersionId: null, createdAt: Date.now(), publishedAt: Date.now(), heading: "Personvern", bodyBlocks: [oldIntroBlock, oldBreachBlock], approval: null };
  var m = await mount({ privacyVersions: { activeVersionId: "v1", versions: [oldVersion] } });
  t.after(function () { m.dom.window.close(); });
  await openPersonvern(m);
  assert.match(sectionText(m), /Gamal, pensjonert innleiingstekst/, "føresetnad: den gamle, alt-publiserte intro-teksten er faktisk synleg før noko utkast vert laga");
  await openNewDraft(m);
  m.dom.window.document.querySelector("#cs-priv-fetch").click();
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  var text = sectionText(m);
  assert.doesNotMatch(text, /Gamal, pensjonert innleiingstekst/, "gamal intro-tekst skal vere bytta ut med fersk tekst frå computeTenantPrivacyBlocks(), ikkje ståande att i tillegg til den nye");
  assert.match(text, /Denne personvernerklæringen forklarer hvordan Test AS/, "den nye intro-teksten (brukaren sitt seinare ombestemte utkast) kjem gjennom");
  assert.doesNotMatch(text, /Melding ved brudd/, "gamal breach-tekst skal IKKJE dukke opp att -- flytta til DPA-en, ikkje berre gøymd, og «breach» har ingen fresh-versjon lenger");
  var introPos = text.indexOf("Denne personvernerklæringen forklarer hvordan");
  var controllerPos = text.indexOf("er behandlingsansvarlig for behandlingen");
  assert(introPos >= 0 && controllerPos >= 0 && introPos < controllerPos,
    "«Om denne personvernerklæringen» skal stå FØR «Hvem er behandlingsansvarlig» -- heile poenget med at brukaren bad om intro-en attende");
});
