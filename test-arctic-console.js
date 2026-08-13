"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var test = require("node:test");
var JSDOM = require("jsdom").JSDOM;

var consoleCode = fs.readFileSync("console/console-core.js", "utf8");

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function query(result) {
  var chain = {
    select: function () { return chain; },
    eq: function () { return chain; },
    order: function () { return Promise.resolve(result); },
    single: function () { return Promise.resolve(result); },
    maybeSingle: function () { return Promise.resolve(result); },
  };
  return chain;
}

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms === undefined ? 20 : ms); });
}

function createSupabaseMock(role) {
  var tenantRecord = {
    id: "tenant-test", slug: "test", status: "active",
    data_plane_url: "https://tenant.example", data_plane_anon_key: "anon-test",
    data_plane_storage_key: "nordpunkt",
  };
  var control = {
    auth: {
      onAuthStateChange: function () {},
      getSession: function () {
        return Promise.resolve({ data: { session: {
          access_token: "console-jwt-test",
          expires_at: 4102444800,
          user: { id: "operator-test" },
        } } });
      },
      signOut: function () {},
    },
    from: function (table) {
      if (table === "operators") return query({ data: { status: "active", role: role }, error: null });
      if (table === "tenants") return query({ data: [tenantRecord], error: null });
      throw new Error("Uventet control-tabell: " + table);
    },
    functions: { invoke: function () { return Promise.resolve({ data: {}, error: null }); } },
  };
  var tenant = {
    from: function (table) {
      if (table !== "store") throw new Error("Uventet tenant-tabell: " + table);
      return query({ data: { value: {} }, error: null });
    },
  };
  var clientCount = 0;
  return {
    createClient: function () {
      clientCount += 1;
      return clientCount === 1 ? control : tenant;
    },
  };
}

async function mountConsole(options) {
  options = options || {};
  var dom = new JSDOM('<!doctype html><html><body><div id="console-app"></div></body></html>', {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: options.url || "https://vibeverk.no/console/",
  });
  var window = dom.window;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: options.width || 1280 });
  window.SITE_CONFIG = { storageKey: "nordpunkt", company: { name: "Vibeverk" } };
  window.App = { ready: function (callback) { callback(window.SITE_CONFIG); } };
  window.Components = {
    esc: esc,
    helpIcon: function () { return ""; },
    field: function () { return ""; },
    button: function () { return ""; },
  };
  window.supabase = createSupabaseMock(options.role || "superadmin");
  window.fetch = options.fetch || function () { return Promise.reject(new Error("Uventet fetch")); };
  window.confirm = function () { return false; };
  window.alert = function () {};
  window.eval(consoleCode);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  await wait(options.mountWait === undefined ? 35 : options.mountWait);
  return dom;
}

function jsonResponse(body, status) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  }));
}

function header(init, name) {
  var headers = init && init.headers;
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  var wanted = name.toLowerCase();
  var key = Object.keys(headers).filter(function (candidate) { return candidate.toLowerCase() === wanted; })[0];
  return key ? headers[key] : null;
}

function bootstrapFixture(kind) {
  var isLocal = kind === "local";
  return {
    schemaVersion: "arctic-bootstrap-v1",
    connection: { kind: kind || "gateway", status: isLocal ? "connected" : "not_configured", checkedAt: new Date().toISOString() },
    freshness: { staleAfterMs: 90000, offlineAfterMs: 300000 },
    providers: [
      { id: "ollama", label: "Gemma / lokal modell", model: isLocal ? "gemma-test" : null, configured: isLocal, processing: "local", capabilities: { chat: false, streaming: false, documentAnalysis: true, codeAnalysis: true, fileAccess: false, codeChanges: false, tools: false }, operations: isLocal ? ["learning-draft"] : [], reasonCode: isLocal ? null : "gateway_required" },
      { id: "anthropic", label: "Claude", model: null, configured: false, processing: "external", capabilities: { chat: false, streaming: false, documentAnalysis: true, codeAnalysis: true, fileAccess: false, codeChanges: false, tools: false }, operations: [], reasonCode: "credentials_not_configured" },
      { id: "codex", label: "Codex", model: null, configured: false, processing: "external", capabilities: { chat: false, streaming: false, documentAnalysis: false, codeAnalysis: false, fileAccess: false, codeChanges: false, tools: false }, operations: [], reasonCode: "gateway_required" },
    ],
    commands: [
      { id: "health", input: "health", label: "Helse", description: "Viser avgrenset systemhelse.", available: isLocal, mutates: false, reasonCode: isLocal ? null : "gateway_required" },
      { id: "backup-status", input: "backup status", label: "Backupstatus", description: "Krever avgrenset backupkilde.", available: false, mutates: false, reasonCode: "not_configured" },
    ],
    workSessionAdapters: [
      { id: "claude", label: "Claude", status: "not_configured", reasonCode: "gateway_required", capabilities: { start: false, resume: false, streaming: false, repoRead: false, repoWrite: false } },
      { id: "codex", label: "Codex", status: "not_configured", reasonCode: "gateway_required", capabilities: { start: false, resume: false, streaming: false, repoRead: false, repoWrite: false } },
    ],
  };
}

function metric(value, unit, sampledAt) {
  return { status: value === null ? "unavailable" : "available", value: value, unit: unit, sampledAt: sampledAt };
}

function overviewFixture(options) {
  options = options || {};
  var sampledAt = options.sampledAt || new Date().toISOString();
  var status = options.status || "ok";
  return {
    schemaVersion: "arctic-overview-v1",
    sampledAt: sampledAt,
    lastSuccessfulContactAt: status === "offline" ? null : sampledAt,
    overallStatus: status,
    freshness: options.freshness || (status === "offline" ? "missing" : "fresh"),
    metrics: {
      uptimeSeconds: metric(status === "offline" ? null : 7200, "seconds", sampledAt),
      cpuUsedPercent: metric(status === "offline" ? null : 12.5, "percent", sampledAt),
      memoryUsedPercent: metric(status === "offline" ? null : 48.2, "percent", sampledAt),
      diskUsedPercent: metric(status === "offline" ? null : 63.1, "percent", sampledAt),
      cpuTemperatureC: metric(null, "celsius", sampledAt),
      nvmeTemperatureC: metric(null, "celsius", sampledAt),
    },
    gemma: { status: status === "offline" ? "not_configured" : "healthy", model: status === "offline" ? null : "gemma-test", lastCheckedAt: status === "offline" ? null : sampledAt, responseTimeMs: status === "offline" ? null : 18, safeMessage: status === "offline" ? "Krever en konfigurert Arctic-agent/gateway." : null },
    servicesSummary: status === "offline" ? { healthyCount: 0, degradedCount: 0, unavailableCount: 2, totalCount: 2 } : { healthy: 2, degraded: 0, down: 0, unavailable: 0 },
    backup: { status: "not_configured", reasonCode: "vibeverk_backup_source_missing", lastSuccessfulAt: null },
    sessions: { activeCount: 0, recent: [] },
    events: [],
  };
}

function servicesFixture(items) {
  return { schemaVersion: "arctic-services-v1", sampledAt: new Date().toISOString(), items: items || [] };
}

function sessionsFixture() {
  return {
    schemaVersion: "arctic-sessions-v1",
    sampledAt: new Date().toISOString(),
    items: [],
    adapters: bootstrapFixture().workSessionAdapters,
  };
}

function fixtureBackend(options) {
  options = options || {};
  var calls = [];
  var localConfig = options.localConfig || {
    apiVersion: "v1", csrfToken: "csrf-test",
    scenarios: [{ id: "learning-module", label: "Læringsmodulen" }],
    sources: [{ id: "safe-changes", label: "Trygge endringer", path: "docs/onboarding/safe-changes-guide.md", anthropicAllowed: true }],
    providers: [
      { id: "ollama", model: "gemma-test", configured: true },
      { id: "anthropic", model: "haiku-test", configured: false },
    ],
  };
  function fetchImpl(url, init) {
    var href = String(url);
    calls.push({ url: href, init: init || {} });
    if (href === "/__ai-lab/v1/config") return jsonResponse(localConfig);
    var resource = null;
    var localMatch = /^\/__arctic\/v1\/(bootstrap|overview|services|sessions|commands)$/.exec(href);
    if (localMatch) resource = localMatch[1];
    if (href.indexOf("/api/arctic?") === 0) resource = new URL(href, "https://vibeverk.no").searchParams.get("resource");
    if (!resource) return Promise.reject(new Error("Uventet fetch: " + href));
    if (resource === "bootstrap") return jsonResponse(options.bootstrap || bootstrapFixture(localMatch ? "local" : "gateway"));
    if (resource === "overview") {
      if (typeof options.overview === "function") return options.overview(calls.filter(function (call) { return /(?:resource=overview|\/overview)$/.test(call.url); }).length, init);
      return jsonResponse(options.overview || overviewFixture({ status: localMatch ? "ok" : "offline" }));
    }
    if (resource === "services") return jsonResponse(options.services || servicesFixture([]));
    if (resource === "sessions") return jsonResponse(options.sessions || sessionsFixture());
    if ((init && init.method) === "POST") {
      return jsonResponse(options.commandResult || {
        schemaVersion: "arctic-command-result-v1", commandId: "health", input: "health",
        status: "completed", executedAt: new Date().toISOString(), reasonCode: null,
        message: "Helsesjekken er fullført.", summary: "Alt fungerer normalt.",
        details: [{ label: "Gemma", value: "18 ms" }], result: { overallStatus: "ok" },
      });
    }
    return jsonResponse({ schemaVersion: "arctic-commands-v1", sampledAt: new Date().toISOString(), items: (options.bootstrap || bootstrapFixture()).commands, history: [] });
  }
  return { calls: calls, fetch: fetchImpl };
}

test("Arctic er skjult og direkte navigasjon blokkert for operatører uten superadminrolle", async function (t) {
  for (var i = 0; i < 2; i += 1) {
    var role = i === 0 ? "operator" : "customeradmin";
    var calls = [];
    var dom = await mountConsole({ role: role, fetch: function (url) { calls.push(String(url)); return Promise.reject(new Error("Skal ikke kalles")); } });
    assert.equal(dom.window.document.querySelector('[data-cs-nav="arctic"]'), null, role + " skal ikke se Arctic");
    assert.equal(dom.window.VwConsole.navigate("arctic"), false, role + " skal ikke kunne åpne Arctic direkte");
    assert.equal(dom.window.VwConsole.navigate("ai-lab"), false, role + " skal ikke kunne bruke gammel AI Lab-rute");
    assert.deepEqual(calls, [], role + " skal ikke utløse Arctic- eller AI-kall");
    dom.window.close();
  }
  t.after(function () {});
});

test("superadmin får Arctic med fem bokmålsfaner og JWT på produksjonskall", async function (t) {
  var backend = fixtureBackend({ overview: overviewFixture({ status: "offline" }) });
  var dom = await mountConsole({ fetch: backend.fetch });
  t.after(function () { dom.window.close(); });
  var window = dom.window;
  assert.ok(window.document.querySelector('[data-cs-nav="arctic"]'));
  assert.equal(window.document.querySelector('[data-cs-nav="ai-lab"]'), null);
  assert.equal(window.VwConsole.navigate("arctic"), true);
  await wait();

  var tabs = Array.from(window.document.querySelectorAll("[data-arctic-tab]"));
  assert.deepEqual(tabs.map(function (tab) { return tab.textContent.trim(); }), ["Oversikt", "AI Lab", "Arbeidsøkter", "Tjenester", "Kommandoer"]);
  assert.ok(tabs.every(function (tab) { return tab.tagName === "BUTTON" && tab.getAttribute("role") === "tab"; }));
  assert.match(window.document.querySelector('[role="tablist"]').getAttribute("aria-label"), /Arctic/);
  assert.equal(window.document.getElementById("cs-arctic-pane").getAttribute("role"), "tabpanel");
  assert.equal(window.document.querySelector('[data-arctic-tab="overview"]').getAttribute("aria-selected"), "true");
  assert.match(window.document.getElementById("cs-arctic-status").textContent, /Frakoblet/i);
  assert.ok(window.document.querySelector('[data-arctic-metric="uptimeSeconds"]'));

  var arcticCalls = backend.calls.filter(function (call) { return call.url.indexOf("/api/arctic?") === 0; });
  assert.ok(arcticCalls.some(function (call) { return call.url.indexOf("resource=bootstrap") !== -1; }));
  assert.ok(arcticCalls.some(function (call) { return call.url.indexOf("resource=overview") !== -1; }));
  arcticCalls.forEach(function (call) {
    assert.equal(header(call.init, "Authorization"), "Bearer console-jwt-test");
    assert.equal(call.init.cache, "no-store");
  });
  assert.equal(backend.calls.filter(function (call) { return call.url.indexOf("/__arctic/") === 0; }).length, 0);

  window.document.querySelector('[data-arctic-tab="ai-lab"]').click();
  assert.equal(window.document.querySelector('[data-arctic-tab="ai-lab"]').getAttribute("aria-selected"), "true");
  assert.match(window.document.getElementById("cs-arctic-pane").textContent, /lokal tilkobling|koble til lokal|ikke konfigurert/i);

  window.document.querySelector('[data-arctic-tab="commands"]').click();
  await wait();
  assert.equal(window.document.getElementById("cs-arctic-command-input").disabled, true);
  assert.match(window.document.getElementById("cs-arctic-pane").textContent, /Ingen kommandoer kan kjøres|ikke tilgjengelig/i);
});

test("lokale Arctic-kommandoer bruker separat JWT, CSRF-token og lokal tilgangstoken", async function (t) {
  var backend = fixtureBackend({ bootstrap: bootstrapFixture("local"), overview: overviewFixture({ status: "ok" }) });
  var dom = await mountConsole({ url: "http://127.0.0.1:8080/console/", fetch: backend.fetch, mountWait: 55 });
  t.after(function () { dom.window.close(); });
  var window = dom.window;
  window.VwConsole.navigate("arctic");
  await wait();
  window.document.querySelector('[data-arctic-tab="commands"]').click();
  await wait();

  var token = window.document.getElementById("cs-arctic-local-token");
  var input = window.document.getElementById("cs-arctic-command-input");
  assert.ok(token && input);
  token.value = "lokal-arctic-token-som-ikke-lagres";
  token.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.value = "health";
  window.document.getElementById("cs-arctic-command-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await wait();

  var commandCalls = backend.calls.filter(function (call) { return call.url === "/__arctic/v1/commands" && call.init.method === "POST"; });
  assert.equal(commandCalls.length, 1);
  assert.equal(header(commandCalls[0].init, "Authorization"), "Bearer console-jwt-test");
  assert.equal(header(commandCalls[0].init, "X-AI-Lab-Token"), "csrf-test");
  assert.equal(header(commandCalls[0].init, "X-Arctic-Access-Token"), "lokal-arctic-token-som-ikke-lagres");
  assert.deepEqual(JSON.parse(commandCalls[0].init.body), { input: "health" });
  assert.match(window.document.getElementById("cs-arctic-command-result").textContent, /fullført|Alt fungerer/i);
  assert.match(window.document.getElementById("cs-arctic-command-result").textContent, /Gemma/);
  assert.match(window.document.getElementById("cs-arctic-command-result").textContent, /18 ms/);
  assert.ok(window.document.querySelector(".arctic-command-result__details"));
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);

  var localReads = backend.calls.filter(function (call) { return call.url.indexOf("/__arctic/v1/") === 0 && call.init.method !== "POST"; });
  assert.ok(localReads.length >= 2);
  localReads.forEach(function (call) { assert.equal(header(call.init, "Authorization"), "Bearer console-jwt-test"); });
});

test("Oversikt viser loading, utdaterte data og trygg feil etter manuell oppdatering", async function (t) {
  var resolveFirstOverview;
  var overviewCount = 0;
  var oldSample = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  var backend = fixtureBackend({
    overview: function () {
      overviewCount += 1;
      if (overviewCount === 1) {
        return new Promise(function (resolve) { resolveFirstOverview = resolve; });
      }
      return jsonResponse({ error: { code: "gateway_unavailable", message: "Arctic svarte ikke." } }, 503);
    },
  });
  var dom = await mountConsole({ fetch: backend.fetch });
  t.after(function () { dom.window.close(); });
  var window = dom.window;
  window.VwConsole.navigate("arctic");
  await wait(2);
  assert.match(window.document.getElementById("cs-arctic-pane").textContent, /Laster|Henter/i);

  resolveFirstOverview(jsonResponse(overviewFixture({ status: "warning", sampledAt: oldSample })));
  await wait();
  assert.match(window.document.getElementById("cs-arctic-freshness").textContent, /utdatert/i);
  assert.equal(window.document.getElementById("cs-arctic-refresh").disabled, false);
  window.document.getElementById("cs-arctic-refresh").click();
  await wait();
  assert.match(window.document.getElementById("cs-arctic-pane").textContent, /Arctic svarte ikke|Kunne ikke|feil/i);
});

test("tomme tjenester og arbeidsøkter er ærlige, og fanene beholder semantikk ved mobilbredde", async function (t) {
  var backend = fixtureBackend({ services: servicesFixture([]), sessions: sessionsFixture() });
  var dom = await mountConsole({ fetch: backend.fetch, width: 375 });
  t.after(function () { dom.window.close(); });
  var window = dom.window;
  window.VwConsole.navigate("arctic");
  await wait();

  var tabs = Array.from(window.document.querySelectorAll("[data-arctic-tab]"));
  assert.equal(tabs.length, 5);
  assert.ok(tabs.every(function (tab) { return tab.type === "button"; }));
  tabs[0].focus();
  tabs[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(window.document.activeElement, tabs[1]);
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  window.document.querySelector('[data-arctic-tab="services"]').click();
  await wait();
  assert.equal(window.document.querySelector('[data-arctic-tab="services"]').getAttribute("aria-selected"), "true");
  assert.equal(window.document.querySelectorAll("[data-arctic-service]").length, 0);
  assert.match(window.document.getElementById("cs-arctic-pane").textContent, /ingen|ikke.*tilgjengelig/i);

  window.document.querySelector('[data-arctic-tab="sessions"]').click();
  await wait();
  assert.equal(window.document.querySelector('[data-arctic-tab="sessions"]').getAttribute("aria-selected"), "true");
  assert.equal(window.document.querySelectorAll("[data-arctic-adapter]").length, 2);
  assert.match(window.document.getElementById("cs-arctic-pane").textContent, /ingen.*arbeidsøkter/i);
  assert.match(window.document.getElementById("cs-arctic-pane").textContent, /ikke konfigurert/i);
});
