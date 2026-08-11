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
  window.Components = { esc: esc, field: field, richTextField: richTextField, button: button, helpIcon: function () { return ""; } };
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
  assert(wrap.querySelector("#pb-page-title"), "hoppar rett vidare til sideredigeringa etter oppretting");
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

test("legge til en hero-seksjon og lagre sender seksjonen med i set_config-nyttelasten", async function (t) {
  var dom = await mount({ storeValue: [{ id: "test-side", label: "Testside", order: 60, navHidden: false, locked: true, sections: [] }] });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("sidebygger-sider");
  await wait();
  click(dom.window.document.querySelector('[data-pb-edit-page="test-side"]'));
  await wait();
  dom.window.document.querySelector("#pb-add-section-type").value = "hero";
  click(dom.window.document.querySelector("#pb-add-section-btn"));
  await wait();
  var ed = dom.window.document.querySelector("#pb-section-editor");
  assert(ed.querySelector("#pb-sec-heading"), "hero-seksjonens felt (overskrift) er rendra");
  ed.querySelector("#pb-sec-heading").value = "Velkommen til oss";
  ed.querySelector("#pb-sec-text").value = "Ein ingress";
  click(ed.querySelector("[data-pb-sec-save]"));
  await wait();
  var savedPages = dom._getStoreValue();
  assert.equal(savedPages[0].sections.length, 1);
  assert.equal(savedPages[0].sections[0].type, "hero");
  assert.equal(savedPages[0].sections[0].data.heading, "Velkommen til oss");
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

test("Console-CSS/skript er cache-busta for Sidebygger-endringane", function () {
  var html = fs.readFileSync("console/index.html", "utf8");
  assert.match(html, /components\.js\?v=22/);
});
