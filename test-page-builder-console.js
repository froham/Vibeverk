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
// Stub for den ekte pbBlocksLayout()-tabellen i components.js -- console-
// core.js sin "Kolonne"-veljar (pbLayoutColCount) gjenbruker denne direkte,
// same tabell som den ekte fila eksporterer.
var PB_BLOCKS_LAYOUTS_STUB = {
  "1col": 1, "2col": 2, "2col-2-1": 2, "2col-1-2": 2, "3col": 3, "4col": 4
};
function pbBlocksLayout(layout) {
  return { cols: PB_BLOCKS_LAYOUTS_STUB[layout] || 1 };
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
  window.Components = { esc: esc, field: field, richTextField: richTextField, button: button, pageSection: pageSection, helpIcon: function () { return ""; }, pbBlocksLayout: pbBlocksLayout };
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
  assert(typeCards.length === 9, "alle ni seksjonstypar (inkl. «Blokker») er tilgjengelege i ikon-veljaren: " + typeCards.length);
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
  assert(!ed.querySelector("#pb-sec-imgshape"), "hero-seksjonen har INGEN biletform-veljar -- hero sitt bilete er ein fullbleed-bakgrunn, ikkje eit sjølvstendig innramma bilete");
  assert.match(ed.textContent, /ingen eiga biletform her/, "UX-funn: hero forklarer KVIFOR biletform manglar her, i staden for at fråveret berre ser ut som ein mangel");
});

test("«Biletform»-veljaren finst for bilde+tekst, stort bilete og rutenett (seksjonsnivå), og lagrar rett imageShape i set_config-nyttelasten", async function (t) {
  var dom = await mount({ storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] }] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();

  click(dom.window.document.querySelector("#pbc-add-trigger"));
  await wait();
  click(dom.window.document.querySelector('[data-pb-add-type="image-text"]'));
  await wait();
  var ed1 = dom.window.document.querySelector(".pbc-section-editor");
  var shapeSel1 = ed1.querySelector("#pb-sec-imgshape");
  assert(shapeSel1, "bilde+tekst har ein biletform-veljar");
  assert.match(ed1.textContent, /skjer biletet til eit sentrert kvadrat/, "UX-funn: hint forklarer at sirkel skjer til eit SENTRERT kvadrat -- Sidebygger sitt eige biletfelt har ingen fokuspunktkontroll");
  shapeSel1.value = "circle";
  shapeSel1.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait(800);
  assert.equal(dom._getStoreValue()[0].sections[0].data.imageShape, "circle");

  click(dom.window.document.querySelector('[data-pb-toggle="' + dom._getStoreValue()[0].sections[0].id + '"]'));
  click(dom.window.document.querySelector("#pbc-add-trigger"));
  await wait();
  click(dom.window.document.querySelector('[data-pb-add-type="big-image"]'));
  await wait();
  var savedAfterFirst = dom._getStoreValue();
  var newSectionEl = dom.window.document.querySelector('.pbc-section-card[data-id="' + savedAfterFirst[0].sections[1].id + '"] .pbc-section-editor');
  var shapeSel2 = newSectionEl.querySelector("#pb-sec-imgshape");
  assert(shapeSel2, "stort bilete har ein biletform-veljar");
  shapeSel2.value = "square";
  shapeSel2.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait(800);
  assert.equal(dom._getStoreValue()[0].sections[1].data.imageShape, "square");
});

test("rutenett sin «Biletform»-veljar (Antall kolonner sitt naboval) gjeld HEILE rutenettet, ikkje per rute", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [{ id: "s1", type: "grid", open: true, variant: {}, data: { columns: 3, imageShape: "rounded", items: [{ image: { src: "x.jpg" }, heading: "Rute" }] } }]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  var shapeSel = ed.querySelector("#pb-sec-imgshape");
  assert(shapeSel, "rutenett-seksjonen har ein biletform-veljar på SEKSJONSNIVÅ, ikkje éin per rute");
  assert.match(ed.textContent, /Gjeld alle rutene i rutenettet/, "UX-funn: eige hint under valet forklarer at det gjeld HEILE rutenettet -- den einaste ikkje-per-rute-innstillinga på denne seksjonstypen");
  shapeSel.value = "circle";
  shapeSel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait(800);
  assert.equal(dom._getStoreValue()[0].sections[0].data.imageShape, "circle");
});

test("bilde-blokka sin «Biletform»-veljar lagrar rett imageShape, uavhengig av «Ramme inn»-avkryssinga", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [{ id: "s1", type: "blocks", open: true, variant: {}, data: { layout: "1col", blocks: [
      { id: "b1", type: "image", slot: 0, data: { image: { src: "x.jpg" }, imageShape: "rounded", frame: false } }
    ] } }]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  var shapeSel = ed.querySelector("#pb-block-0-imgshape");
  assert(shapeSel, "bilde-blokka har ein biletform-veljar");
  shapeSel.value = "circle";
  shapeSel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait(800);
  var savedBlock = dom._getStoreValue()[0].sections[0].data.blocks[0];
  assert.equal(savedBlock.data.imageShape, "circle");
  assert.equal(savedBlock.data.frame, false, "ramme-valet er urørt av biletform-endringa");
});

test("«Blokker»-seksjonen sin type-veljar tilbyr alle 6 blokktypane, og kvar type rendrar rette felt når han vert valt", async function (t) {
  var dom = await mount({ storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] }] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  click(dom.window.document.querySelector("#pbc-add-trigger"));
  await wait();
  click(dom.window.document.querySelector('[data-pb-add-type="blocks"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  assert(ed && ed.querySelector("#pb-sec-blocks-layout"), "«Blokker»-seksjonen opnar seg automatisk med kolonneoppsett-veljaren synleg");
  click(ed.querySelector('[data-pb-blocks-add-slot="0"]'));
  await wait();
  var blockTypeCards = ed.querySelectorAll("[data-pb-add-block-type]");
  assert.equal(blockTypeCards.length, 6, "alle 6 blokktypane er tilgjengelege i blokk-paletten");
  click(ed.querySelector('[data-pb-add-block-type="contact-item"]'));
  await wait();
  assert(ed.querySelector("#pb-block-0-kind"), "kontaktinfo-blokka rendrar sine eigne felt (type/etikett/verdi) med det same");
  assert(ed.querySelector("#pb-block-0-label"));
  assert(ed.querySelector("#pb-block-0-value"));
});

test("redigere felt i ei blokk lagrar rett blocks[i].data i set_config-nyttelasten", async function (t) {
  // Merk: denne testen sin pageSection()-stubb (øvst i fila) er bevisst
  // enkel og les berre s.data.heading/s.data.text på SEKSJONSNIVÅ -- han
  // representerer ikkje innhaldet inni enkeltblokker. Rendringsstadfesting
  // for blokk-innhald høyrer heime i test.js (mot den ekte components.js),
  // ikkje her -- denne testen stadfestar berre at Console-UI-en faktisk
  // skriv rette verdiar inn i set_config-nyttelasten.
  var dom = await mount({ storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] }] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  click(dom.window.document.querySelector("#pbc-add-trigger"));
  await wait();
  click(dom.window.document.querySelector('[data-pb-add-type="blocks"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  click(ed.querySelector('[data-pb-blocks-add-slot="0"]'));
  await wait();
  click(ed.querySelector('[data-pb-add-block-type="heading"]'));
  await wait();
  setFieldValue(ed.querySelector("#pb-block-0-text"), "Ny blokk-overskrift");
  await wait();
  await wait(800);
  var savedPages = dom._getStoreValue();
  assert.equal(savedPages[0].sections[0].type, "blocks");
  assert.equal(savedPages[0].sections[0].data.blocks.length, 1);
  assert.equal(savedPages[0].sections[0].data.blocks[0].type, "heading");
  assert.equal(savedPages[0].sections[0].data.blocks[0].data.text, "Ny blokk-overskrift");
});

test("EKTE BUG (2026-08-12, brukarrapport): «Legg til blokk» kan klikkast FLEIRE gonger på rad utan å måtte minimere/opne seksjonen på nytt mellom kvar -- tidlegare hopa klikklyttarar seg opp på den vedvarande triggerknappen kvar gong renderBlocksEditor() køyrde att, slik at andre klikk opna OG stengde pickeren i same synkrone handling", async function (t) {
  var dom = await mount({ storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] }] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  click(dom.window.document.querySelector("#pbc-add-trigger"));
  await wait();
  click(dom.window.document.querySelector('[data-pb-add-type="blocks"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  // Legg til FØRSTE blokk.
  click(ed.querySelector('[data-pb-blocks-add-slot="0"]'));
  await wait();
  click(ed.querySelector('[data-pb-add-block-type="heading"]'));
  await wait();
  // Legg til ANDRE blokk med DET SAME (no friskt gjenskapte) triggeren --
  // utan noka minimering/opning av seksjonen mellom klikka. Med den gamle
  // buggen synte pickeren seg ALDRI opp her (to lyttarar kansellerte
  // kvarandre), så eit andre klikk på ein type-card ville feila (elementet
  // fanst aldri i DOM-en).
  var trigger2 = ed.querySelector('[data-pb-blocks-add-slot="0"]');
  click(trigger2);
  await wait();
  var picker = trigger2.nextElementSibling;
  assert.equal(picker.style.display, "grid", "pickeren opnar seg synleg ved andre klikk på triggeren, utan omveg om å minimere seksjonen");
  var typeCards = ed.querySelectorAll("[data-pb-add-block-type]");
  assert.equal(typeCards.length, 6, "alle 6 blokktypane er tilgjengelege andre gongen òg");
  click(ed.querySelector('[data-pb-add-block-type="richtext"]'));
  await wait(800);
  var savedPages = dom._getStoreValue();
  var blocks = savedPages[0].sections[0].data.blocks;
  assert.equal(blocks.length, 2, "nøyaktig 2 blokker lagt til -- IKKJE fleire pga. dobbelbundne klikklyttarar frå tidlegare rendringar: " + blocks.length);
  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[1].type, "richtext");
});

test("fleirkolonna «Blokker»-seksjon grupperer blokkene visuelt PER KOLONNE, og «Legg til blokk» i kolonne 2 sin boks legg den nye blokka DIREKTE i kolonne 2 (slot 1), ikkje kolonne 1", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [{ id: "s1", type: "blocks", open: true, variant: {}, data: { layout: "2col", blocks: [
      { id: "b1", type: "heading", slot: 0, data: { level: "h2", text: "Kolonne 1-innhald" } }
    ] } }]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  var colGroups = ed.querySelectorAll(".pbc-blocks-col");
  assert.equal(colGroups.length, 2, "to tydeleg avgrensa kolonne-grupper vert vist for eit 2col-oppsett");
  assert.match(colGroups[0].querySelector(".pbc-blocks-col__head").textContent, /Kolonne 1/);
  assert.match(colGroups[1].querySelector(".pbc-blocks-col__head").textContent, /Kolonne 2/);
  assert.match(colGroups[1].querySelector(".pbc-blocks-col__empty").textContent, /Ingen blokker/, "kolonne 2 (tom) viser ein tydeleg tom-tilstand, ikkje berre eit blankt felt");
  var col2Trigger = colGroups[1].querySelector('[data-pb-blocks-add-slot="1"]');
  assert(col2Trigger, "kolonne 2 sin eigen «Legg til blokk»-knapp finst");
  click(col2Trigger);
  await wait();
  click(ed.querySelector('[data-pb-add-block-type="contact-item"]'));
  await wait(800);
  var savedPages = dom._getStoreValue();
  var blocks = savedPages[0].sections[0].data.blocks;
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].type, "contact-item");
  assert.equal(blocks[1].slot, 1, "blokka lagt til via kolonne 2 sin knapp hamnar RETT i kolonne 2 (slot 1), ikkje standard kolonne 1 (slot 0)");
});

test("UX-funn: å endre ei EKSISTERANDE blokk sin «Kolonne»-veljar flyttar kortet visuelt til den nye kolonne-boksen med det same, ikkje berre i den lagra dataen", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [{ id: "s1", type: "blocks", open: true, variant: {}, data: { layout: "2col", blocks: [
      { id: "b1", type: "heading", slot: 0, data: { level: "h2", text: "Flytt meg" } }
    ] } }]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  var colGroups = ed.querySelectorAll(".pbc-blocks-col");
  assert.equal(colGroups[0].querySelectorAll(".pbc-block-card").length, 1, "blokka ligg i kolonne 1 sin boks til å byrje med");
  assert.equal(colGroups[1].querySelectorAll(".pbc-block-card").length, 0, "kolonne 2 sin boks er tom til å byrje med");
  var slotSel = ed.querySelector("#pb-block-0-slot");
  slotSel.value = "1";
  slotSel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait();
  var colGroupsAfter = ed.querySelectorAll(".pbc-blocks-col");
  assert.equal(colGroupsAfter[0].querySelectorAll(".pbc-block-card").length, 0, "kortet er BORTE frå kolonne 1 sin boks med det same, utan å måtte leggje til/fjerne noko anna først");
  assert.equal(colGroupsAfter[1].querySelectorAll(".pbc-block-card").length, 1, "og STÅR i kolonne 2 sin boks med det same");
  await wait(800);
  var savedPages = dom._getStoreValue();
  assert.equal(savedPages[0].sections[0].data.blocks[0].slot, 1, "og den nye kolonneplasseringa er faktisk lagra");
});

test("«Ramme inn»-avkryssinga finst for kvar blokktype (utanom mellomrom) og lagrar frame:true i blokk-dataen", async function (t) {
  var dom = await mount({ storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] }] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  click(dom.window.document.querySelector("#pbc-add-trigger"));
  await wait();
  click(dom.window.document.querySelector('[data-pb-add-type="blocks"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  click(ed.querySelector('[data-pb-blocks-add-slot="0"]'));
  await wait();
  click(ed.querySelector('[data-pb-add-block-type="heading"]'));
  await wait();
  var frameCheckbox = ed.querySelector("#pb-block-0-frame");
  assert(frameCheckbox, "«Ramme inn»-avkryssinga finst for overskrift-blokka");
  frameCheckbox.checked = true;
  frameCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait(800);
  var savedPages = dom._getStoreValue();
  assert.equal(savedPages[0].sections[0].data.blocks[0].data.frame, true, "frame:true vert lagra når avkryssinga er huka av");
});

test("«Dupliser blokk» set inn ein eksakt kopi RETT ETTER blokka i SAME kolonne, med fri id", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [{ id: "s1", type: "blocks", open: true, variant: {}, data: { layout: "1col", blocks: [
      { id: "b1", type: "heading", slot: 0, data: { level: "h2", text: "Fyrste" } },
      { id: "b2", type: "heading", slot: 0, data: { level: "h2", text: "Andre" } }
    ] } }]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  click(ed.querySelector('[data-pb-block-dup="0"]'));
  await wait(800);
  var savedPages = dom._getStoreValue();
  var blocks = savedPages[0].sections[0].data.blocks;
  assert.equal(blocks.length, 3, "ei tredje blokk vart lagt til: " + blocks.length);
  assert.equal(blocks[0].data.text, "Fyrste");
  assert.equal(blocks[1].data.text, "Fyrste", "kopien hamna RETT ETTER originalen, ikkje sist i lista");
  assert.equal(blocks[2].data.text, "Andre", "den opphavlege andre blokka er urørt, berre flytta ein plass ned");
  assert.notEqual(blocks[1].id, "b1", "kopien har ein FRISK id");
});

test("UX-funn: «Dupliser kolonne» tek MED SEG kjeldekolonna sitt «Ramme inn heile kolonna»-val til den nye kolonna", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [{ id: "s1", type: "blocks", open: true, variant: {}, data: { layout: "2col", colFrame: [true, false], blocks: [
      { id: "b1", type: "heading", slot: 0, data: { level: "h2", text: "Ramma innhald" } }
    ] } }]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  click(ed.querySelector('[data-pb-blocks-dup-col="0"]'));
  await wait(800);
  var savedPages = dom._getStoreValue();
  assert.equal(savedPages[0].sections[0].data.colFrame[1], true, "kolonne 2 (den nye kopien) er ramma inn, sidan kjeldekolonna (kolonne 1) var det");
});

test("UX-polish: å fjerne den SISTE blokka i ei ramma kolonne nullstiller kolonna sitt ramme-val, slik at ei seinare NY blokk ikkje stille arvar det gamle valet", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [{ id: "s1", type: "blocks", open: true, variant: {}, data: { layout: "1col", colFrame: [true], blocks: [
      { id: "b1", type: "heading", slot: 0, data: { level: "h2", text: "Åleine" } }
    ] } }]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  click(ed.querySelector('[data-pb-block-remove="0"]'));
  await wait(800);
  var savedPages = dom._getStoreValue();
  assert.equal(savedPages[0].sections[0].data.colFrame[0], false, "kolonna (no tom) sitt ramme-val vart nullstilt");
});

test("«Dupliser kolonne» kopierer alle blokkene i kolonna inn i den FYRSTE tomme ANDRE kolonna, og er deaktivert når ingen tom kolonne finst", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [{ id: "s1", type: "blocks", open: true, variant: {}, data: { layout: "3col", blocks: [
      { id: "b1", type: "heading", slot: 0, data: { level: "h2", text: "Kol1-A" } },
      { id: "b2", type: "richtext", slot: 0, data: { text: "Kol1-B" } }
    ] } }]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  var dupColBtn = ed.querySelector('[data-pb-blocks-dup-col="0"]');
  assert(dupColBtn, "dupliser-kolonne-knappen finst for kolonne 1 (har innhald)");
  assert(!dupColBtn.disabled, "aktiv sidan kolonne 2 og 3 er tomme");
  click(dupColBtn);
  await wait(800);
  var savedPages = dom._getStoreValue();
  var blocks = savedPages[0].sections[0].data.blocks;
  assert.equal(blocks.length, 4, "2 nye blokker (kopiar av dei 2 i kolonne 1) lagt til: " + blocks.length);
  var col1Slot2 = blocks.filter(function (b) { return b.slot === 1; });
  assert.equal(col1Slot2.length, 2, "kopiane hamna i kolonne 2 (fyrste tomme ANDRE kolonne), ikkje kolonne 3");
  assert.equal(col1Slot2[0].data.text, "Kol1-A");
  assert.equal(col1Slot2[1].data.text, "Kol1-B");
  assert.notEqual(col1Slot2[0].id, "b1", "kopiane har friske id-ar");
  assert.equal(blocks[0].id, "b1", "originalane i kolonne 1 er heilt urørte");

  // No er kolonne 1 OG 2 fylte, kolonne 3 er den einaste tomme att.
  var ed2 = dom.window.document.querySelector(".pbc-section-editor");
  var dupColBtnAgain = ed2.querySelector('[data-pb-blocks-dup-col="0"]');
  assert(!dupColBtnAgain.disabled, "framleis aktiv sidan kolonne 3 framleis er tom");
  click(dupColBtnAgain);
  await wait(800);
  savedPages = dom._getStoreValue();
  blocks = savedPages[0].sections[0].data.blocks;
  assert.equal(blocks.filter(function (b) { return b.slot === 2; }).length, 2, "andre duplisering hamnar i kolonne 3 (no den einaste tomme)");

  // No har alle 3 kolonnane innhald -- dupliser-knappen for kolonne 1 skal vere deaktivert.
  var ed3 = dom.window.document.querySelector(".pbc-section-editor");
  var dupColBtnFinal = ed3.querySelector('[data-pb-blocks-dup-col="0"]');
  assert(dupColBtnFinal.disabled, "deaktivert no som alle kolonnar har innhald -- ingen tom kolonne att å kopiere til");
  var blocksBeforeClick = savedPages[0].sections[0].data.blocks.length;
  click(dupColBtnFinal);
  await wait(300);
  assert.equal(dom._getStoreValue()[0].sections[0].data.blocks.length, blocksBeforeClick, "eit klikk på den deaktiverte knappen gjer ingenting");
});

test("«Ramme inn heile kolonna»-avkryssinga lagrar colFrame[slot]=true, uavhengig av kvar blokk sin eigen «Ramme inn»-avkryssing", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [{ id: "s1", type: "blocks", open: true, variant: {}, data: { layout: "2col", blocks: [
      { id: "b1", type: "heading", slot: 0, data: { level: "h2", text: "Innhald" } }
    ] } }]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  var colFrameCb = ed.querySelector('[data-pb-blocks-colframe="0"]');
  assert(colFrameCb, "kolonne-ramme-avkryssinga finst for kolonne 1 (har innhald)");
  assert(!ed.querySelector('[data-pb-blocks-colframe="1"]'), "kolonne 2 (tom) har inga ramme-avkryssing -- ingenting å ramme inn");
  colFrameCb.checked = true;
  colFrameCb.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait(800);
  var savedPages = dom._getStoreValue();
  assert.equal(savedPages[0].sections[0].data.colFrame[0], true, "colFrame[0] vart lagra");
});

test("«Fjern blokk»-knappen fjernar berre den eine blokka, resten av blokk-lista står urørt", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [{ id: "s1", type: "blocks", open: true, variant: {}, data: { layout: "1col", blocks: [
      { id: "b1", type: "heading", slot: 0, data: { level: "h2", text: "Fyrste" } },
      { id: "b2", type: "heading", slot: 0, data: { level: "h2", text: "Andre" } }
    ] } }]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  click(ed.querySelector('[data-pb-block-remove="0"]'));
  await wait(800);
  var savedPages = dom._getStoreValue();
  var blocks = savedPages[0].sections[0].data.blocks;
  assert.equal(blocks.length, 1, "berre éi blokk att");
  assert.equal(blocks[0].data.text, "Andre", "den GJENVERANDE blokka er den som IKKJE vart fjerna");
});

test("opp/ned-reorder av blokker er avgrensa til SAME kolonne (slot) -- flytting av ei blokk i slot 0 rører aldri blokka i slot 1", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [{ id: "s1", type: "blocks", open: true, variant: {}, data: { layout: "2col", blocks: [
      { id: "b1", type: "heading", slot: 0, data: { level: "h2", text: "Slot0-A" } },
      { id: "b2", type: "heading", slot: 0, data: { level: "h2", text: "Slot0-B" } },
      { id: "b3", type: "heading", slot: 1, data: { level: "h2", text: "Slot1-einaste" } }
    ] } }]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  // b2 (Slot0-B) er posisjon 1 innanfor slot 0 -- flytt han opp, forbi b1.
  click(ed.querySelector('[data-pb-block-up="1"]'));
  await wait(800);
  var savedPages = dom._getStoreValue();
  var blocks = savedPages[0].sections[0].data.blocks;
  var texts = blocks.map(function (b) { return b.data.text; });
  assert.deepEqual(texts, ["Slot0-B", "Slot0-A", "Slot1-einaste"], "b1/b2 bytte plass innanfor slot 0, b3 (åleine i slot 1) er heilt urørt: " + texts.join(","));
  assert.equal(blocks[2].slot, 1, "slot-verdien til den urørte blokka er framleis 1");
});

test("å endre kolonneoppsettet på ei «Blokker»-seksjon klemmer no-ugyldige slot-verdiar til siste gyldige kolonne", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [{ id: "s1", type: "blocks", open: true, variant: {}, data: { layout: "2col", blocks: [
      { id: "b1", type: "heading", slot: 0, data: { level: "h2", text: "Venstre" } },
      { id: "b2", type: "heading", slot: 1, data: { level: "h2", text: "Høgre" } }
    ] } }]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var ed = dom.window.document.querySelector(".pbc-section-editor");
  var layoutSel = ed.querySelector("#pb-sec-blocks-layout");
  layoutSel.value = "1col";
  layoutSel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait(800);
  var savedPages = dom._getStoreValue();
  var blocks = savedPages[0].sections[0].data.blocks;
  assert.equal(savedPages[0].sections[0].data.layout, "1col", "kolonneoppsettet vert faktisk lagra");
  assert(blocks.every(function (b) { return b.slot === 0; }), "begge blokkene sine slot-verdiar er klemt til 0, den einaste gyldige kolonnen i «1col»: " + blocks.map(function (b) { return b.slot; }).join(","));
  assert(!ed.querySelector("#pb-block-1-slot"), "kolonne-veljaren for kvar blokk er sjølv skjult att når det berre finst éi kolonne");
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

test("«Dupliser seksjon» set inn ein eksakt kopi RETT ETTER originalen, med fri id -- for ei «blocks»-seksjon får òg kvar blokk ein fri id", async function (t) {
  var startPage = {
    id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true,
    sections: [
      { id: "s1", type: "text", variant: { background: "dark" }, data: { heading: "Original" } },
      { id: "s2", type: "blocks", variant: {}, data: { layout: "1col", blocks: [{ id: "b1", type: "heading", slot: 0, data: { level: "h2", text: "Blokkinnhald" } }] } }
    ]
  };
  var dom = await mount({ storeValue: [startPage] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  click(dom.window.document.querySelector('[data-pb-dup-section="s1"]'));
  await wait(800);
  var savedPages = dom._getStoreValue();
  var sections = savedPages[0].sections;
  assert.equal(sections.length, 3, "ein tredje seksjon vart lagt til: " + sections.length);
  assert.equal(sections[1].type, "text");
  assert.equal(sections[1].data.heading, "Original", "kopien har same innhald som originalen");
  assert.equal(sections[1].variant.background, "dark", "kopien har same variant som originalen");
  assert.notEqual(sections[1].id, "s1", "kopien har ein FRISK id, ikkje same id som originalen");
  assert.equal(sections[0].id, "s1", "originalen sjølv er urørt");
  assert.equal(sections[2].id, "s2", "duplikatet hamna RETT ETTER originalen, ikkje sist i lista");

  click(dom.window.document.querySelector('[data-pb-dup-section="s2"]'));
  await wait(800);
  savedPages = dom._getStoreValue();
  // Rekkjefølgja er no [s1, s1-kopi, s2, s2-kopi] -- s2 flytta til indeks 2
  // etter den FYRSTE dupliseringa, så s2 sin eigen kopi hamnar på indeks 3.
  var dupBlocksSection = savedPages[0].sections[3];
  assert.equal(dupBlocksSection.type, "blocks");
  assert.equal(dupBlocksSection.data.blocks[0].data.text, "Blokkinnhald");
  assert.notEqual(dupBlocksSection.data.blocks[0].id, "b1", "blokka inni ein duplisert «blocks»-seksjon får òg ein FRISK id");
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

test("verken den opne seksjonsredigeringa eller seksjonslista har ei kunstig høgd-grense lenger (UX-tilbakemelding: for trongt, vanskeleg å nå botnen -- sidan-nivå rulling handterer veksten no)", function () {
  var html = fs.readFileSync("console/index.html", "utf8");
  var editorRule = html.match(/\.pbc-section-editor\s*\{[^}]*\}/)[0];
  var listRule = html.match(/\.pbc-section-list\s*\{[^}]*\}/)[0];
  assert.doesNotMatch(editorRule, /max-height/, "seksjonsredigeringa har ikkje lenger ei eiga høgd-grense");
  assert.doesNotMatch(listRule, /max-height/, "seksjonslista har ikkje lenger ei eiga høgd-grense");
});

test("«Minimer forhåndsvisning»-knappen skjular ramma og let deg vise ho att, utan å påverke sjølve lagringa", async function (t) {
  var dom = await mount({ storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] }] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var panel = dom.window.document.querySelector("#pbc-preview-panel");
  var toggleBtn = dom.window.document.querySelector("#pbc-pv-toggle");
  assert(toggleBtn, "minimer-knappen finst");
  // UX-tilbakemelding 2026-08-11 (0.133.4): eit sidestilt to-kolonne-forsøk
  // let kolonnebreidda stå urørt sjølv minimert, som berre skapte tomt,
  // ubrukt rom ("veldig tullete"). Arbeidsområdet er no alltid éin stabla
  // kolonne, og forhåndsvisinga startar MINIMERT som standard -- minimering
  // fjernar difor faktisk plassen ho tok, ikkje berre innhaldet inni ho.
  assert.equal(toggleBtn.getAttribute("aria-expanded"), "false", "startar minimert som standard");
  assert(panel.classList.contains("is-minimized"), "panelet ER minimert som standard");
  click(toggleBtn);
  assert(!panel.classList.contains("is-minimized"), "eitt klikk viser panelet");
  assert.equal(toggleBtn.getAttribute("aria-expanded"), "true");
  assert.match(toggleBtn.getAttribute("aria-label"), /Minimer forhåndsvisning/);
  click(toggleBtn);
  assert(panel.classList.contains("is-minimized"), "eit andre klikk minimerer att");
  assert.equal(toggleBtn.getAttribute("aria-expanded"), "false");
});

test("arbeidsområdet er éin stabla kolonne med forhåndsvisinga FØRST i DOM-en, ikkje sidestilte kolonnar", async function (t) {
  var dom = await mount({ storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] }] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var workspace = dom.window.document.querySelector(".pbc-workspace");
  var panels = workspace.children;
  assert.equal(panels.length, 2, "arbeidsområdet har nøyaktig to panel");
  assert(panels[0].classList.contains("pbc-preview-panel"), "forhåndsvisingspanelet er FØRST i DOM-en");
  assert(!panels[1].classList.contains("pbc-preview-panel"), "seksjonspanelet er ANDRE");
});

test("mobil-/skrivebord-brytaren viser ei tydeleg breiddeetikett (ikkje berre eit ikon)", async function (t) {
  var dom = await mount({ storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] }] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  var label = dom.window.document.querySelector("#pbc-pv-width-label");
  assert.equal(label.textContent, "Skrivebord", "startar med skrivebord-etiketten");
  click(dom.window.document.querySelector("#pbc-pv-mobile"));
  assert.match(label.textContent, /Mobil.*380px/, "etiketten seier faktisk kva breidde 'mobil' simulerer");
  click(dom.window.document.querySelector("#pbc-pv-desktop"));
  assert.equal(label.textContent, "Skrivebord", "byter attende ved klikk på skrivebordsknappen");
});

test("Console-CSS/skript er cache-busta for Sidebygger-endringane", function () {
  var html = fs.readFileSync("console/index.html", "utf8");
  assert.match(html, /components\.js\?v=26/);
  assert.match(html, /console-core\.js\?v=256/);
});
