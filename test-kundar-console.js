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

// Mock som støttar .select().eq().eq().order().limit() -- retention_runs sin
// faktiske spørjekjede (renderKdDetail sin nye "siste køyring"-hentar), i
// tillegg til det enklare tenants/operators-mønsteret dei andre testfilene
// alt dekker.
function chainQuery(result) {
  var value = {
    select: function () { return value; },
    eq: function () { return value; },
    // order() må vere BÅDE thenable (loadTenants() gjer .order("slug").then(...))
    // OG vidare kjedbar til .limit() (retention_runs sin faktiske spørjekjede) --
    // eit ekte Promise kan ikkje få ein ekstra .limit()-metode via Object.assign,
    // difor eit eige lite objekt med begge delar her.
    order: function () {
      return {
        then: function (resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
        limit: function () { return Promise.resolve(result); }
      };
    },
    limit: function () { return Promise.resolve(result); },
    single: function () { return Promise.resolve(result); },
    maybeSingle: function () { return Promise.resolve(result); }
  };
  return value;
}

var TENANT_SEED = { id: "t1", slug: "tenant", status: "active", data_plane_url: "https://tenant.example", data_plane_anon_key: "anon", data_plane_storage_key: "nordpunkt", retention_policy: { leads: { enabled: false, months: 12 } } };

async function mount(retentionRunsSeed) {
  var dom = new JSDOM('<!doctype html><html><body><div id="console-app"></div></body></html>', { runScripts: "outside-only", pretendToBeVisual: true, url: "https://vibeverk.no/console/" });
  var window = dom.window;
  window.SITE_CONFIG = { storageKey: "nordpunkt", company: { name: "Vibeverk" } };
  window.App = { ready: function (callback) { callback(window.SITE_CONFIG); } };
  window.Components = { esc: esc, field: field, button: button, helpIcon: function () { return ""; } };
  var invokeCalls = [];
  var control = {
    auth: { onAuthStateChange: function () {}, getSession: function () { return Promise.resolve({ data: { session: { access_token: "operator-token", user: { id: "op-1" }, expires_at: 4102444800 } } }); }, signOut: function () {} },
    from: function (table) {
      if (table === "operators") return chainQuery({ data: { status: "active" }, error: null });
      if (table === "tenants") return chainQuery({ data: [JSON.parse(JSON.stringify(TENANT_SEED))], error: null });
      if (table === "retention_runs") return chainQuery({ data: retentionRunsSeed || [], error: null });
      throw new Error("Uventet tabell " + table);
    },
    functions: { invoke: function (name, opts) {
      invokeCalls.push({ name: name, body: opts && opts.body });
      return Promise.resolve({ data: { success: true }, error: null });
    } }
  };
  var tenant = { from: function () { return chainQuery({ data: { value: {} }, error: null }); } };
  var calls = 0;
  window.supabase = { createClient: function () { calls += 1; return calls === 1 ? control : tenant; } };
  window.confirm = function () { return true; };
  window.alert = function () {};
  window.eval(code);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  await new Promise(function (resolve) { setTimeout(resolve, 25); });
  return { dom: dom, invokeCalls: invokeCalls };
}

async function openKdDetail(dom) {
  dom.window.VwConsole.navigate("kundar");
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  var row = dom.window.document.querySelector('[data-kd-row="t1"]');
  assert(row, "kundelista viser den seeda tenanten");
  row.click();
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
}

test("Retensjons-brytaren startar AV som standard og lagrar via set_tenant_retention_policy", async function (t) {
  var m = await mount([]);
  var dom = m.dom;
  t.after(function () { dom.window.close(); });
  await openKdDetail(dom);
  var wrap = dom.window.document.querySelector("#cs-section-wrap");
  var checkbox = wrap.querySelector("#kd-retention-enabled");
  assert(checkbox, "retensjons-avkryssingsboksen finst");
  assert.equal(checkbox.checked, false, "startar AV som standard for ein kunde utan tidlegare vedtak");
  checkbox.checked = true;
  wrap.querySelector("#kd-retention-months").value = "6";
  wrap.querySelector("#kd-retention-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  var call = m.invokeCalls.filter(function (c) { return c.name === "tenant-admin"; }).pop();
  assert(call, "tenant-admin vart kalla");
  assert.equal(call.body.action, "set_tenant_retention_policy");
  assert.equal(call.body.category, "leads");
  assert.equal(call.body.enabled, true);
  assert.equal(call.body.months, 6);
});

test("«Sist kjørt» viser tal frå siste retention_runs-rad, ikkje berre ei tom side", async function (t) {
  var m = await mount([{ run_at: "2026-08-13T03:17:00.000Z", dry_run: true, candidates_found: 4, rows_deleted: 0, error: null }]);
  var dom = m.dom;
  t.after(function () { dom.window.close(); });
  await openKdDetail(dom);
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  var lastrun = dom.window.document.querySelector("#kd-retention-lastrun");
  assert.match(lastrun.textContent, /4 kandidatar funne/);
  assert.match(lastrun.textContent, /dry-run/);
});

test("«Sist kjørt» seier tydeleg frå når ingen køyring finst enno, ikkje berre tomt", async function (t) {
  var m = await mount([]);
  var dom = m.dom;
  t.after(function () { dom.window.close(); });
  await openKdDetail(dom);
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  var lastrun = dom.window.document.querySelector("#kd-retention-lastrun");
  assert.match(lastrun.textContent, /Ingen køyring registrert enno/);
});
