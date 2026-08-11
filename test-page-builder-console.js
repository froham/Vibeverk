"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var test = require("node:test");
var JSDOM = require("jsdom").JSDOM;
var code = fs.readFileSync("console/console-core.js", "utf8");

function esc(value) {
  return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function field(o) {
  o = o || {};
  return '<div class="field"><label for="' + esc(o.id) + '">' + esc(o.label) + '</label>' +
    (o.multiline ? '<textarea id="' + esc(o.id) + '" rows="' + (o.rows || 3) + '">' + esc(o.value || "") + '</textarea>' : '<input id="' + esc(o.id) + '" type="' + esc(o.type || "text") + '" value="' + esc(o.value || "") + '">') + '</div>';
}
// Enkel stub -- den ekte richTextField() har ein verktøylinje/contenteditable-
// del bindRichTextFields() bind opp; her held det med ei skjult-felt-form som
// readRichTextField()-stubben under kan lese direkte .value frå.
function richTextField(o) {
  o = o || {};
  return '<div class="field"><label>' + esc(o.label) + '</label><input type="hidden" id="' + esc(o.id) + '" value="' + esc(o.value || "") + '"></div>';
}
function button(o) {
  o = o || {};
  var cls = "btn btn--" + (o.variant || "primary") + " " + (o.class || "");
  if (o.href) return '<a class="' + cls + '" href="' + esc(o.href) + '" ' + (o.attrs || "") + '>' + esc(o.label) + '</a>';
  return '<button type="' + (o.type || "button") + '" class="' + cls + '" ' + (o.attrs || "") + '>' + esc(o.label) + '</button>';
}
// Stub for den ekte pageSection()-dispatcheren i components.js -- brukt av
// den nye live-forhåndsvisinga (pbRenderPreviewInto, kallar C.pageSection()
// direkte inn i ein iframe). Treng ikkje pikselnøyaktig -- berre nok til at
// testane kan stadfeste at seksjonsdata faktisk kjem gjennom.
function pageSection(s) {
  return '<section class="pb-sect" data-type="' + esc(s.type) + '">' + esc((s.data && s.data.heading) || (s.data && s.data.text) || "") + '</section>';
}

function query(result) {
  var value = {
    select: function () { return value; }, eq: function () { return value; },
    order: function () { return Promise.resolve(result); }, single: function () { return Promise.resolve(result); },
    maybeSingle: function () { return Promise.resolve(result); }
  };
  return value;
}

// opts.storeValue: startverdien "custom-pages"-nøkkelen har i den valde
// tenanten sitt (mocka) prosjekt. opts.onInvoke(name, body): valfri hook for
// å overstyre eit spesifikt broker-svar (t.d. simulere ein feil) -- default
// oppfører seg som den ekte broker-funksjonen sin set_config-handling for
// "custom-pages" (skriv rett inn i den same mocka lagringa, slik at ein
// etterfølgjande lesing ser den ferske verdien, same som i produksjon).
async function mount(opts) {
  opts = opts || {};
  var invokeCalls = [];
  var storeValue = opts.storeValue !== undefined ? opts.storeValue : [];
  var dom = new JSDOM('<!doctype html><html><body><div id="console-app"></div></body></html>', { runScripts: "outside-only", pretendToBeVisual: true, url: "https://vibeverk.no/console/" });
  var window = dom.window;
  window.SITE_CONFIG = { storageKey: "nordpunkt", company: { name: "Vibeverk" } };
  window.App = {
    ready: function (cb) { cb(window.SITE_CONFIG); },
    ui: {
      bindRichTextFields: function () {},
      readRichTextField: function (root, id) { var el = root.querySelector("#" + id); return el ? el.value : ""; }
    }
  };
  window.Components = { esc: esc, field: field, richTextField: richTextField, button: button, pageSection: pageSection, helpIcon: function () { return ""; } };
  var control = {
    auth: { onAuthStateChange: function () {}, getSession: function () { return Promise.resolve({ data: { session: { access_token: "operator-token", user: { id: "op-1" }, expires_at: 4102444800 } } }); }, signOut: function () {} },
    from: function (table) {
      if (table === "operators") return query({ data: { status: "active" }, error: null });
      if (table === "tenants") return query({ data: [{ id: "t1", slug: "tenant", status: "active", data_plane_url: "https://tenant.example", data_plane_anon_key: "anon", data_plane_storage_key: "nordpunkt" }], error: null });
      throw new Error("Uventet tabell " + table);
    },
    functions: {
      invoke: function (name, invokeOpts) {
        var body = (invokeOpts && invokeOpts.body) || {};
        invokeCalls.push({ name: name, body: body });
        if (opts.onInvoke) {
          var override = opts.onInvoke(name, body);
          if (override) return Promise.resolve(override);
        }
        if (body.action === "set_config" && body.key === "custom-pages") {
          storeValue = body.value;
        }
        return Promise.resolve({ data: { success: true }, error: null });
      }
    }
  };
  var tenant = { from: function () { return query({ data: { value: storeValue }, error: null }); } };
  var calls = 0;
  window.supabase = { createClient: function () { calls += 1; return calls === 1 ? control : tenant; } };
  window.confirm = opts.confirmImpl || function () { return true; };
  window.alert = function () {};
  window.eval(code);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  await new Promise(function (resolve) { setTimeout(resolve, 25); });
  dom._invokeCalls = invokeCalls;
  dom._getStoreValue = function () { return storeValue; };
  return dom;
}

function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms || 15); }); }
function submit(el) { el.dispatchEvent(new el.ownerDocument.defaultView.Event("submit", { bubbles: true, cancelable: true })); }
function click(el) { el.dispatchEvent(new el.ownerDocument.defaultView.Event("click", { bubbles: true })); }
// Redesignet Sidebygger-editor (2026-08-11) lagrar automatisk (debounca
// 700ms) på kvart felt-input i staden for ein eksplisitt "Lagre"-knapp --
// set verdien OG dispatchar ein ekte input-hending, sidan berre å setje
// .value ikkje trigger nokon lyttar.
function setFieldValue(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true }));
}

test("Sider er en egen Console-fane med tomt utgangspunkt og et opprett-skjema", async function (t) {
  var dom = await mount();
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  assert(dom.window.document.querySelector('[data-cs-nav="sidebygger-sider"]'), "navlenka finst");
  var wrap = dom.window.document.querySelector("#cs-section-wrap");
  assert.match(wrap.textContent, /Ingen sider oppretta enno/);
  assert(wrap.querySelector("#pb-new-form"), "opprett-ny-side-skjemaet finst");
});

test("opprette ny side sender rett set_config-nyttelast og opnar sideredigeringa", async function (t) {
  var dom = await mount();
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  dom.window.document.querySelector("#pb-new-title").value = "Jobb hos oss";
  submit(dom.window.document.querySelector("#pb-new-form"));
  await wait();
  var setCalls = dom._invokeCalls.filter(function (c) { return c.body.action === "set_config" && c.body.key === "custom-pages"; });
  assert.equal(setCalls.length, 1, "nøyaktig eitt set_config-kall for den nye sida");
  var savedPages = setCalls[0].body.value;
  assert.equal(savedPages.length, 1);
  assert.equal(savedPages[0].id, "jobb-hos-oss", "tittelen vert slugifisert til id-en");
  assert.equal(savedPages[0].label, "Jobb hos oss");
  assert.equal(savedPages[0].locked, true, "Fase 1: nye sider er alltid låst (ingen kundeflyt finst enno)");
  assert.equal(setCalls[0].body.tenant_id, "t1", "tenant_id sendast eksplisitt, ikkje avhengig av ein potensielt endra _activeTenant seinare");
  var wrap = dom.window.document.querySelector("#cs-section-wrap");
  assert(wrap.querySelector("#pbc-title"), "hoppar rett vidare til sideredigeringa etter oppretting");
});

test("ny side med tittel som kolliderer med eit fast modul-id vert automatisk gjort unik", async function (t) {
  var dom = await mount();
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  dom.window.document.querySelector("#pb-new-title").value = "Hjem";
  submit(dom.window.document.querySelector("#pb-new-form"));
  await wait();
  var savedPages = dom._getStoreValue();
  assert.equal(savedPages[0].id, "hjem-2", "kolliderer med det faste 'hjem'-id-et -- vert automatisk disambiguert, ikkje avvist");
});

test("legge til en hero-seksjon (via ikon-veljaren) opnar ho automatisk og autolagrar seksjonen med i set_config-nyttelasten", async function (t) {
  var dom = await mount({ storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] }] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  click(dom.window.document.querySelector("#pbc-add-trigger"));
  await wait();
  var typeCards = dom.window.document.querySelectorAll("[data-pb-add-type]");
  assert(typeCards.length === 8, "alle åtte seksjonstypar er tilgjengelege i ikon-veljaren: " + typeCards.length);
  click(dom.window.document.querySelector('[data-pb-add-type="hero"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  assert(ed && ed.querySelector("#pb-sec-heading"), "hero-seksjonen opnar seg automatisk med felta synlege, ingen ekstra «rediger»-klikk trengst");
  setFieldValue(ed.querySelector("#pb-sec-heading"), "Velkommen til oss");
  setFieldValue(ed.querySelector("#pb-sec-text"), "Ein ingress");
  var iframe = dom.window.document.querySelector("#pbc-preview-iframe");
  await wait();
  assert.match(iframe.contentDocument.body.textContent, /Velkommen til oss/, "forhåndsvisinga oppdaterer seg live mens du skriv, utan å måtte lagre/opne sida på nytt");
  await wait(800); // vent på den debounca autolagringa (700ms)
  var savedPages = dom._getStoreValue();
  assert.equal(savedPages[0].sections.length, 1);
  assert.equal(savedPages[0].sections[0].type, "hero");
  assert.equal(savedPages[0].sections[0].data.heading, "Velkommen til oss");
  assert.match(dom.window.document.querySelector("#pbc-save-status").textContent, /Alt lagra/, "lagre-status viser at autolagringa faktisk fullførte");
});

test("pbPreviewCss(): eit forsøk på å bryte ut av <style>-taggen via superconfig sine farge-/font-felt vert nøytralisert (Security Auditor-funn BLOCKER, 2026-08-11)", async function (t) {
  var dom = await mount();
  t.after(function () { dom.window.close(); });
  var maliciousSc = {
    colors: { primary: "red;}</style><script>window.__pwned=1</script><style>{color:blue" },
    fonts: { display: "Inter</style><script>window.__pwned2=1</script>" }
  };
  var css = dom.window.VwConsole._test.pbPreviewCss(maliciousSc);
  assert(css.indexOf("</style>") === -1, "den genererte CSS-en inneheld ALDRI ein bokstaveleg </style>-sekvens: " + css.slice(0, 200));
  assert(css.indexOf("<script") === -1, "den genererte CSS-en inneheld ALDRI ein bokstaveleg <script-sekvens: " + css.slice(0, 200));
  assert.match(css, /--color-primary:#2563eb/, "ugyldig fargeverdi fell attende til den nøytrale standardfargen, ikkje den rå (farlege) verdien");
  assert.match(css, /--font-display:'Inter'/, "ugyldig fontnamn fell attende til standardfonten, ikkje den rå (farlege) verdien");
});

test("pbPreviewCss(): eit GYLDIG hex-fargenamn/fontnamn frå superconfig kjem faktisk gjennom (saneringa er ikkje overivrig)", async function (t) {
  var dom = await mount();
  t.after(function () { dom.window.close(); });
  var css = dom.window.VwConsole._test.pbPreviewCss({ colors: { primary: "#ff0033" }, fonts: { display: "Roboto Slab" } });
  assert.match(css, /--color-primary:#ff0033/, "eit ekte, gyldig hex-fargenamn vert brukt uendra");
  assert.match(css, /--font-display:'Roboto Slab'/, "eit ekte, gyldig fontnamn (med mellomrom) vert brukt uendra");
});

test("førehandsvisings-iframen har sandbox=\"allow-same-origin\" (ALDRI allow-scripts) -- andre forsvarslag mot Security Auditor-funnet over", async function (t) {
  var dom = await mount({ storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] }] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var iframe = dom.window.document.querySelector("#pbc-preview-iframe");
  var sandbox = iframe.getAttribute("sandbox") || "";
  assert.match(sandbox, /allow-same-origin/, "iframen har sandbox-attributtet sett");
  assert(sandbox.indexOf("allow-scripts") === -1, "sandbox tillèt ALDRI skriptkøyring inne i iframen, sjølv om ein framtidig verdi skulle sleppe usanert gjennom");
});

test("flytt ned bytter rekkjefølgja på seksjonane i set_config-nyttelasten", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [
      { id: "s1", type: "text", variant: {}, data: { heading: "Første" } },
      { id: "s2", type: "text", variant: {}, data: { heading: "Andre" } }
    ]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  click(dom.window.document.querySelector('[data-pb-move-down="s1"]'));
  await wait();
  var savedPages = dom._getStoreValue();
  assert.equal(savedPages[0].sections[0].id, "s2", "s2 er no først");
  assert.equal(savedPages[0].sections[1].id, "s1", "s1 er no sist");
});

test("slett seksjon spør om stadfesting (Nivå B) og fjernar seksjonen ved ja", async function (t) {
  var confirmText = null;
  var startPage = { id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [{ id: "s1", type: "text", variant: {}, data: { heading: "Ei tekstøkt" } }] };
  var dom = await mount({ storeValue: [startPage], confirmImpl: function (msg) { confirmText = msg; return true; } });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  click(dom.window.document.querySelector('[data-pb-del-section="s1"]'));
  await wait();
  assert.match(confirmText, /Slett denne seksjonen/);
  assert.match(confirmText, /kan ikke angres/i);
  assert.equal(dom._getStoreValue()[0].sections.length, 0, "seksjonen er fjerna etter stadfesting");
});

test("slett seksjon gjer INGENTING dersom operatøren avbryt stadfestinga", async function (t) {
  var startPage = { id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [{ id: "s1", type: "text", variant: {}, data: { heading: "Ei tekstøkt" } }] };
  var dom = await mount({ storeValue: [startPage], confirmImpl: function () { return false; } });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  click(dom.window.document.querySelector('[data-pb-del-section="s1"]'));
  await wait();
  assert.equal(dom._getStoreValue()[0].sections.length, 1, "seksjonen står urørt når stadfestinga vert avbroten");
  var setCalls = dom._invokeCalls.filter(function (c) { return c.body.action === "set_config"; });
  assert.equal(setCalls.length, 0, "ingen set_config-kall i det heile vart gjort");
});

test("slett side spør om stadfesting (Nivå B) med sidenamn og hash i teksten, og fjernar sida ved ja", async function (t) {
  var confirmText = null;
  var startPage = { id: "jobb-hos-oss", label: "Jobb hos oss", order: 60, navHidden: false, locked: true, sections: [] };
  var dom = await mount({ storeValue: [startPage], confirmImpl: function (msg) { confirmText = msg; return true; } });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-del-page="jobb-hos-oss"]'));
  await wait();
  assert.match(confirmText, /Slett siden «Jobb hos oss»/);
  assert.match(confirmText, /#jobb-hos-oss/);
  assert.match(confirmText, /kan ikke angres/i);
  assert.equal(dom._getStoreValue().length, 0, "sida er fjerna etter stadfesting");
});

test("dra-og-slipp flytter en seksjon til en ny posisjon i set_config-nyttelasten", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [
      { id: "s1", type: "text", variant: {}, data: { heading: "Første" } },
      { id: "s2", type: "text", variant: {}, data: { heading: "Andre" } },
      { id: "s3", type: "text", variant: {}, data: { heading: "Tredje" } }
    ]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var win = dom.window;
  var s1Card = win.document.querySelector('.pbc-section-card[data-id="s1"]');
  var s3Card = win.document.querySelector('.pbc-section-card[data-id="s3"]');
  assert.equal(s1Card.getAttribute("draggable"), "true", "lukka seksjonskort er dragbare");
  function dragEvt(type) { var e = new win.Event(type, { bubbles: true, cancelable: true }); e.dataTransfer = {}; return e; }
  s1Card.dispatchEvent(dragEvt("dragstart"));
  s3Card.dispatchEvent(dragEvt("dragover"));
  s3Card.dispatchEvent(dragEvt("drop"));
  await wait(800);
  var savedPages = dom._getStoreValue();
  var ids = savedPages[0].sections.map(function (s) { return s.id; });
  assert.equal(ids.indexOf("s1") > ids.indexOf("s2"), true, "s1 vart flytta bort frå fyrsteplass etter draing: " + ids.join(","));
});

test("«Slett side»-knappen inne i redigeringsvisninga (ikkje berre sidelista) spør om stadfesting og fjernar sida", async function (t) {
  var confirmText = null;
  var startPage = { id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] };
  var dom = await mount({ storeValue: [startPage], confirmImpl: function (msg) { confirmText = msg; return true; } });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  click(dom.window.document.querySelector("#pbc-del-page"));
  await wait();
  assert.match(confirmText, /Slett siden «Testside»/);
  assert.match(confirmText, /kan ikke angres/i);
  assert.equal(dom._getStoreValue().length, 0, "sida er fjerna");
  assert(dom.window.document.querySelector("#pb-new-form"), "hamnar attende på sidelista etter sletting");
});

test("biletopplasting: grensene står synlege FØR nokon fil er valt, og eit for stort bilete gjev ei tydeleg, handlingsretta feilmelding", async function (t) {
  var dom = await mount({ storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [{ id: "s1", type: "hero", open: true, variant: {}, data: {} }] }] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  assert(ed, "seksjonen (lagra med open:true) startar allereie open");
  assert.match(ed.textContent, /8MB/, "PNG\/JPEG-grensa er synleg FØR nokon fil er valt");
  assert.match(ed.textContent, /600KB/, "SVG\/WebP-grensa er synleg FØR nokon fil er valt");

  var fileInput = ed.querySelector("#pb-sec-img-file");
  var file = new dom.window.File([new Uint8Array(10)], "stort.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: 9 * 1024 * 1024 });
  Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
  fileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait();
  var statusText = dom.window.document.querySelector("#pb-sec-img-status").textContent;
  assert.match(statusText, /for stort/i, "feilmeldinga seier tydeleg at fila er for stor");
  assert.match(statusText, /8MB/, "feilmeldinga nemner den faktiske grensa, ikkje berre 'for stor'");
  assert.match(statusText, /lavere oppløsning/, "feilmeldinga gjev eit konkret, handlingsretta forslag -- ikkje berre ei avvisning");
});

test("«Lagre no»-knappen lagrar umiddelbart, utan å vente på den 700ms debounca autolagringa", async function (t) {
  var setCallTimes = [];
  var start = Date.now();
  var dom = await mount({
    storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] }],
    onInvoke: function (name, body) { if (body.action === "set_config") setCallTimes.push(Date.now() - start); return null; }
  });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  setFieldValue(dom.window.document.querySelector("#pbc-title"), "Nytt namn");
  var saveNowBtn = dom.window.document.querySelector("#pbc-save-now");
  assert(saveNowBtn, "ein eksplisitt «Lagre no»-knapp finst, i tillegg til autolagringa");
  click(saveNowBtn);
  await wait(30);
  assert.equal(setCallTimes.length, 1, "nøyaktig eitt set_config-kall skjedde, umiddelbart etter klikk");
  assert(setCallTimes[0] < 200, "lagringa skjedde langt før dei 700ms autolagringa elles ville venta: " + setCallTimes[0] + "ms");
  assert.match(dom.window.document.querySelector("#pbc-save-status").textContent, /Alt lagra/);
  await wait(800); // stadfest at IKKJE eit ekstra, duplikat set_config-kall kjem seinare frå den (no kansellerte) debounce-timeren
  assert.equal(setCallTimes.length, 1, "ingen duplikat, seinare set_config-kall frå den kansellerte autolagringstimeren");
});

test("biletopplasting viser det FAKTISKE komprimeringsresultatet (frå-til), ikkje berre at noko vart lasta opp", async function (t) {
  var dom = await mount({
    storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [{ id: "s1", type: "hero", open: true, variant: {}, data: {} }] }],
    onInvoke: function (name, body) {
      if (body.action === "upload_section_image") return { data: { success: true, url: "https://example.test/img.jpg", size: 580 * 1024 }, error: null };
      return null;
    }
  });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  var fileInput = ed.querySelector("#pb-sec-img-file");
  var file = new dom.window.File([new Uint8Array(10)], "bilde.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: 3 * 1024 * 1024 }); // 3MB original
  Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
  fileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait();
  var statusText = dom.window.document.querySelector("#pb-sec-img-status").textContent;
  assert.match(statusText, /komprimert/i, "meldinga nemner at biletet faktisk vart komprimert");
  assert.match(statusText, /3\.0MB/, "meldinga viser den ORIGINALE storleiken");
  assert.match(statusText, /580KB/, "meldinga viser den FAKTISKE, ENDELEGE storleiken -- ikkje berre at noko skjedde");
});

test("den opne seksjonsredigeringa har eiga, avgrensa rulling (ikkje éi delt, uklår rulling for heile lista)", function () {
  var html = fs.readFileSync("console/index.html", "utf8");
  assert.match(html, /\.pbc-section-editor\s*\{[^}]*overflow-y:auto/, "seksjonsredigeringa har sitt eige rullefelt, avgrensa til si eiga høgd");
});

test("Console-CSS/skript er cache-busta for Sidebygger-endringane", function () {
  var html = fs.readFileSync("console/index.html", "utf8");
  assert.match(html, /components\.js\?v=22/);
});
