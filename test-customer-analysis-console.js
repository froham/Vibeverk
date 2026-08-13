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

function query(result) {
  var value = {
    select: function () { return value; }, eq: function () { return value; },
    order: function () { return Promise.resolve(result); }, single: function () { return Promise.resolve(result); },
    maybeSingle: function () { return Promise.resolve(result); }
  };
  return value;
}

async function mount(fetchImpl) {
  var dom = new JSDOM('<!doctype html><html><body><div id="console-app"></div></body></html>', { runScripts:"outside-only", pretendToBeVisual:true, url:"https://vibeverk.no/console/" });
  var window = dom.window;
  window.SITE_CONFIG = { storageKey:"nordpunkt", company:{ name:"Vibeverk" } };
  window.App = { ready:function (callback) { callback(window.SITE_CONFIG); } };
  window.Components = { esc:esc, field:field, helpIcon:function () { return ""; } };
  var control = {
    auth:{ onAuthStateChange:function () {}, getSession:function () { return Promise.resolve({ data:{ session:{ access_token:"operator-token", user:{ id:"op-1" }, expires_at:4102444800 } } }); }, signOut:function () {} },
    from:function (table) {
      if (table === "operators") return query({ data:{ status:"active" }, error:null });
      if (table === "tenants") return query({ data:[{ id:"t1", slug:"tenant", status:"active", data_plane_url:"https://tenant.example", data_plane_anon_key:"anon", data_plane_storage_key:"nordpunkt" }], error:null });
      throw new Error("Uventet tabell " + table);
    }, functions:{ invoke:function () { return Promise.resolve({ data:{}, error:null }); } }
  };
  var tenant = { from:function () { return query({ data:{ value:{} }, error:null }); } };
  var calls = 0;
  window.supabase = { createClient:function () { calls += 1; return calls === 1 ? control : tenant; } };
  window.fetch = fetchImpl;
  window.confirm = function () { return true; };
  window.alert = function () {};
  window.eval(code);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles:true }));
  await new Promise(function (resolve) { setTimeout(resolve, 25); });
  return dom;
}

test("Kundeanalyse er en egen Console-fane og sender Console-token til API-et", async function (t) {
  var authorization = "";
  var dom = await mount(function (_url, options) {
    authorization = options.headers.Authorization;
    return Promise.resolve(new dom.window.Response(JSON.stringify({ analyses:[] }), { status:200, headers:{ "Content-Type":"application/json" } }));
  });
  t.after(function () { dom.window.close(); });
  // jsdom 29 eksponerer ikke alltid window.Response; bruk global Response.
  dom.window.fetch = function (_url, options) {
    authorization = options.headers.Authorization;
    return Promise.resolve(new Response(JSON.stringify({ analyses:[] }), { status:200, headers:{ "Content-Type":"application/json" } }));
  };
  dom.window.VwConsole.navigate("kundeanalyse");
  await new Promise(function (resolve) { setTimeout(resolve, 15); });
  assert(dom.window.document.querySelector('[data-cs-nav="kundeanalyse"]'));
  assert.equal(authorization, "Bearer operator-token");
  assert.match(dom.window.document.querySelector("#cs-section-wrap").textContent, /Internt verktøy/);
});

test("dobbelt innsending oppretter bare én analyse", async function (t) {
  var createCalls = 0;
  var releaseCreate;
  var dom = await mount(function () { return Promise.resolve(new Response(JSON.stringify({ analyses:[] }), { status:200, headers:{ "Content-Type":"application/json" } })); });
  t.after(function () { dom.window.close(); });
  dom.window.fetch = function (_url, options) {
    if (!options || options.method !== "POST") return Promise.resolve(new Response(JSON.stringify({ analyses:[] }), { status:200, headers:{ "Content-Type":"application/json" } }));
    createCalls += 1;
    return new Promise(function (resolve) { releaseCreate = function () { resolve(new Response(JSON.stringify({ analysis:{ id:"11111111-1111-4111-8111-111111111111" } }), { status:201, headers:{ "Content-Type":"application/json" } })); }; });
  };
  dom.window.VwConsole.navigate("kundeanalyse");
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  dom.window.document.querySelector("#ka-new").click();
  dom.window.document.querySelector("#ka-company").value = "Test AS";
  dom.window.document.querySelector("#ka-url").value = "https://example.no";
  var form = dom.window.document.querySelector("#ka-create-form");
  form.dispatchEvent(new dom.window.Event("submit", { bubbles:true, cancelable:true }));
  form.dispatchEvent(new dom.window.Event("submit", { bubbles:true, cancelable:true }));
  assert.equal(createCalls, 1);
  releaseCreate();
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
});

test("API-feil vises som feiltilstand med en ekte prøv-igjen-knapp", async function (t) {
  var dom = await mount(function () { return Promise.resolve(new Response(JSON.stringify({ error:"Tjenesten er midlertidig utilgjengelig." }), { status:503, headers:{ "Content-Type":"application/json" } })); });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("kundeanalyse");
  await new Promise(function (resolve) { setTimeout(resolve, 15); });
  assert.match(dom.window.document.querySelector("#cs-section-wrap").textContent, /midlertidig utilgjengelig/);
  assert(dom.window.document.querySelector("#ka-retry"));
});

test("operatøren kan velge Sonnet i stedet for standardmodellen Haiku før en kjøring", async function (t) {
  var runBody = null;
  var analysis = { id:"22222222-2222-4222-8222-222222222222", company_name:"Test AS", website_url:"https://example.no", industry:"", status:"draft", overall_score:null, last_run_at:null };
  var dom = await mount(function () { return Promise.resolve(new Response(JSON.stringify({ analyses:[analysis] }), { status:200, headers:{ "Content-Type":"application/json" } })); });
  t.after(function () { dom.window.close(); });
  dom.window.fetch = function (url, options) {
    url = String(url);
    if (url.indexOf("view=detail") !== -1) {
      return Promise.resolve(new Response(JSON.stringify({ analysis:analysis, runs:[], latestRun:null, pages:[], findings:[], findingServices:[], catalog:[], briefs:[] }), { status:200, headers:{ "Content-Type":"application/json" } }));
    }
    if (options && options.method === "POST") {
      runBody = JSON.parse(options.body);
      return Promise.resolve(new Response(JSON.stringify({ error:"Analysen kan ikke startes fra denne statusen." }), { status:409, headers:{ "Content-Type":"application/json" } }));
    }
    return Promise.resolve(new Response(JSON.stringify({ analyses:[analysis] }), { status:200, headers:{ "Content-Type":"application/json" } }));
  };
  dom.window.VwConsole.navigate("kundeanalyse");
  await new Promise(function (resolve) { setTimeout(resolve, 15); });
  dom.window.document.querySelector('[data-ka-open="' + analysis.id + '"]').click();
  await new Promise(function (resolve) { setTimeout(resolve, 15); });
  var select = dom.window.document.querySelector("#ka-detail-model");
  assert(select, "modellvelgeren skal finnes i detaljvisinga sin verktøylinje");
  assert.match(select.textContent, /Haiku/);
  assert.match(select.textContent, /Sonnet/);
  select.value = "claude-sonnet-5";
  select.dispatchEvent(new dom.window.Event("change", { bubbles:true }));
  dom.window.document.querySelector("#ka-detail-run").click();
  await new Promise(function (resolve) { setTimeout(resolve, 15); });
  assert.equal(runBody.aiModel, "claude-sonnet-5");
});

test("Console-CSS har en eksplisitt mobiltilpasning for Kundeanalyse", function () {
  var html = fs.readFileSync("console/index.html", "utf8");
  assert.match(html, /@media\(max-width:700px\).*\.ka-form__row/s);
  assert.match(html, /console-core\.js\?v=272/);
});
