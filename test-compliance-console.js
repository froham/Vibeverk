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

function query(result) {
  var value = {
    select: function () { return value; }, eq: function () { return value; },
    order: function () { return Promise.resolve(result); }, single: function () { return Promise.resolve(result); },
    maybeSingle: function () { return Promise.resolve(result); }
  };
  return value;
}

// Same 8 aktivitetar som den ekte seed-migrasjonen (20260812170000). Alle
// felt bortsett frå id/label tomme, akkurat som i produksjon før nokon har
// fylt ut noko.
var COMPLIANCE_RECORD_SEED = ["kontakt","tilbud","booking","chat","crm","ansatte","sidetelling","ai"].map(function (id) {
  var labels = { kontakt:"Kontaktskjema", tilbud:"Tilbudsforespørsel", booking:"Booking", chat:"Chat", crm:"CRM", ansatte:"Ansatte (Workspace)", sidetelling:"Sidetelling (internt)", ai:"AI-moduler (Oversikt/Smart årshjul)" };
  return { id:id, label:labels[id], formaal:"", kategori_registrerte:"", kategori_data:"", behandlingsgrunnlag:"", mottakere:"", lagringstid:"", sikkerhetstiltak:"" };
});
var VENDOR_REGISTRY_SEED = [
  { id:"supabase", name:"Supabase", what_it_does:"Database", country:"eu", transfer_mechanism:"none", dpa_status:"tba", dpa_note:"" }
];

async function mount() {
  var dom = new JSDOM('<!doctype html><html><body><div id="console-app"></div></body></html>', { runScripts:"outside-only", pretendToBeVisual:true, url:"https://vibeverk.no/console/" });
  var window = dom.window;
  window.SITE_CONFIG = { storageKey:"nordpunkt", company:{ name:"Vibeverk" } };
  window.App = { ready:function (callback) { callback(window.SITE_CONFIG); } };
  window.Components = { esc:esc, field:field, button:button, helpIcon:function () { return ""; } };
  var invokeCalls = [];
  var control = {
    auth:{ onAuthStateChange:function () {}, getSession:function () { return Promise.resolve({ data:{ session:{ access_token:"operator-token", user:{ id:"op-1" }, expires_at:4102444800 } } }); }, signOut:function () {} },
    from:function (table) {
      if (table === "operators") return query({ data:{ status:"active" }, error:null });
      if (table === "tenants") return query({ data:[{ id:"t1", slug:"tenant", status:"active", data_plane_url:"https://tenant.example", data_plane_anon_key:"anon", data_plane_storage_key:"nordpunkt" }], error:null });
      // Djupklone -- desse seeda vert MUTERT direkte av console-core.js sine
      // eigne lagre-handterarar (same objektreferanse elles ville lekt
      // mellom testar/mount()-kall, funne under skriving av Standardforslag-
      // testane: eit tidlegare test sitt lagra innhald synte seg som
      // "alt utfylt" i eit HEILT NYTT mount()-kall).
      if (table === "compliance_record") return query({ data:JSON.parse(JSON.stringify(COMPLIANCE_RECORD_SEED)), error:null });
      if (table === "vendor_registry") return query({ data:JSON.parse(JSON.stringify(VENDOR_REGISTRY_SEED)), error:null });
      throw new Error("Uventet tabell " + table);
    },
    functions:{ invoke:function (name, opts) {
      invokeCalls.push({ name:name, body:opts && opts.body });
      return Promise.resolve({ data:{ success:true }, error:null });
    } }
  };
  var tenant = { from:function () { return query({ data:{ value:{} }, error:null }); } };
  var calls = 0;
  window.supabase = { createClient:function () { calls += 1; return calls === 1 ? control : tenant; } };
  window.confirm = function () { return true; };
  window.alert = function () {};
  window.eval(code);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles:true }));
  await new Promise(function (resolve) { setTimeout(resolve, 25); });
  return { dom:dom, invokeCalls:invokeCalls };
}

test("Compliance er en egen, ikkje-tenant-skopa Console-fane med to underfaner", async function (t) {
  var m = await mount();
  var dom = m.dom;
  t.after(function () { dom.window.close(); });
  assert(dom.window.document.querySelector('[data-cs-nav="compliance"]'), "compliance-nav-knappen finst");
  dom.window.VwConsole.navigate("compliance");
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  var wrap = dom.window.document.querySelector("#cs-section-wrap");
  assert.match(wrap.textContent, /Behandlingsprotokoll/);
  assert.match(wrap.textContent, /Kontaktskjema/, "seededa behandlingsprotokoll-rader vert vist");
  assert(wrap.querySelector('[data-compliance-view="leverandorar"]'), "Leverandørar-underfana finst");
  var recordDetails = wrap.querySelector('[data-compliance-record="kontakt"]');
  assert.equal(recordDetails.tagName, "DETAILS", "kvar behandlingsaktivitet er ein <details>-gardinmeny");
  assert(!recordDetails.hasAttribute("open"), "gardinmenyen startar lukka");
});

test("Behandlingsprotokoll lagrar via set_compliance_record, ikkje direkte RLS-skriving", async function (t) {
  var m = await mount();
  var dom = m.dom;
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("compliance");
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  var formaalInput = dom.window.document.querySelector("#cr-kontakt-formaal");
  formaalInput.value = "Besvare henvendelser fra nettsidens kontaktskjema.";
  dom.window.document.querySelector('.compliance-record-save[data-id="kontakt"]').click();
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  var call = m.invokeCalls.filter(function (c) { return c.name === "tenant-admin"; }).pop();
  assert(call, "tenant-admin vart kalla");
  assert.equal(call.body.action, "set_compliance_record");
  assert.equal(call.body.id, "kontakt");
  assert.equal(call.body.formaal, "Besvare henvendelser fra nettsidens kontaktskjema.");
});

test("Leverandørar-underfana lagrar via set_vendor med DPA-status frå det ekte «tba»-alternativet", async function (t) {
  var m = await mount();
  var dom = m.dom;
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("compliance");
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  dom.window.document.querySelector('[data-compliance-view="leverandorar"]').click();
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.match(dom.window.document.querySelector("#cs-section-wrap").textContent, /Supabase/);
  var vendorDetails = dom.window.document.querySelector('[data-compliance-vendor="supabase"]');
  assert.equal(vendorDetails.tagName, "DETAILS", "kvar leverandør er òg ein <details>-gardinmeny");
  assert(!vendorDetails.hasAttribute("open"), "gardinmenyen startar lukka");
  var statusSelect = dom.window.document.querySelector("#cv-supabase-dpastatus");
  assert.equal(statusSelect.value, "tba", "seeda DPA-status er tba, ikkje unconfirmed");
  dom.window.document.querySelector('.compliance-vendor-save[data-id="supabase"]').click();
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  var call = m.invokeCalls.filter(function (c) { return c.name === "tenant-admin"; }).pop();
  assert.equal(call.body.action, "set_vendor");
  assert.equal(call.body.id, "supabase");
  assert.equal(call.body.dpa_status, "tba");
});

test("Standardforslag fyller inn felta men lagrar ikkje automatisk", async function (t) {
  var m = await mount();
  var dom = m.dom;
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("compliance");
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  assert.equal(dom.window.document.querySelector("#cr-kontakt-formaal").value, "", "tomt før Standardforslag");
  dom.window.document.querySelector("#cp-standard").click();
  assert.match(dom.window.document.querySelector("#cr-kontakt-formaal").value, /kontaktskjemaet/i, "Standardforslag fyller inn eit reelt forslag for kontakt-aktiviteten");
  assert.match(dom.window.document.querySelector("#cr-ansatte-behandlingsgrunnlag").value, /arbeidsavtalen/i, "og for ansatte-aktiviteten");
  assert.equal(m.invokeCalls.filter(function (c) { return c.name === "tenant-admin"; }).length, 0, "ingenting lagra automatisk -- berre felta er fylt inn");
});

test("Lagre alle lagrar kvar av dei 8 behandlingsaktivitetane via éin tenant-admin-kall per aktivitet", async function (t) {
  var m = await mount();
  var dom = m.dom;
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("compliance");
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  dom.window.document.querySelector("#cp-standard").click();
  dom.window.document.querySelector("#cp-save-all").click();
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  var calls = m.invokeCalls.filter(function (c) { return c.name === "tenant-admin" && c.body.action === "set_compliance_record"; });
  assert.equal(calls.length, 8, "alle 8 behandlingsaktivitetar vart lagra");
  assert.match(dom.window.document.querySelector("#cp-bulk-status").textContent, /8 aktivitetar lagra/);
});

test("Generer full tekstversjon viser ei samanhengande, lesbar visning av behandlingsprotokollen", async function (t) {
  var m = await mount();
  var dom = m.dom;
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("compliance");
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  dom.window.document.querySelector("#cr-kontakt-formaal").value = "Ein test-formålstekst.";
  dom.window.document.querySelector("#cp-fulltext").click();
  var modalText = dom.window.document.body.textContent;
  assert.match(modalText, /Ein test-formålstekst\./, "fulltekstvisinga speglar live, ulagra feltverdiar");
  assert.match(modalText, /Kontaktskjema/, "aktivitetsnamnet er med");
  dom.window.document.querySelector("#cs-text-preview-close").click();
  assert.equal(dom.window.document.querySelector("#cs-text-preview-close"), null, "modalen lukkar seg");
});
