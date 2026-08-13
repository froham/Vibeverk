"use strict";

var assert = require("node:assert/strict");
var crypto = require("node:crypto");
var fs = require("node:fs");
var test = require("node:test");
var JSDOM = require("jsdom").JSDOM;
var serverModule = require("./scripts/ai-lab-server");

var consoleCode = fs.readFileSync("console/console-core.js", "utf8");

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function thenableQuery(result) {
  var query = {
    select: function () { return query; },
    eq: function () { return query; },
    order: function () { return Promise.resolve(result); },
    single: function () { return Promise.resolve(result); },
    maybeSingle: function () { return Promise.resolve(result); },
  };
  return query;
}

function createSupabaseMock() {
  var tenant = {
    id: "tenant-test", slug: "test", status: "active",
    data_plane_url: "https://tenant.example", data_plane_anon_key: "anon-test",
    data_plane_storage_key: "tenant-test",
  };
  var control = {
    auth: {
      onAuthStateChange: function () {},
      getSession: function () {
        return Promise.resolve({ data: { session: { user: { id: "operator-test" }, access_token: "console-jwt-test", expires_at: 4102444800 } } });
      },
      signOut: function () {},
    },
    from: function (table) {
      if (table === "operators") return thenableQuery({ data: { status: "active", role: "superadmin" }, error: null });
      if (table === "tenants") return thenableQuery({ data: [tenant], error: null });
      throw new Error("Uventa control-tabell: " + table);
    },
    functions: { invoke: function () { return Promise.resolve({ data: {}, error: null }); } },
  };
  var tenantClient = {
    from: function (table) {
      if (table !== "store") throw new Error("Uventa tenant-tabell: " + table);
      return thenableQuery({ data: { value: {} }, error: null });
    },
  };
  var calls = 0;
  return {
    createClient: function () {
      calls += 1;
      return calls === 1 ? control : tenantClient;
    },
  };
}

async function mountConsole(url, fetchImpl) {
  var dom = new JSDOM('<!doctype html><html><body><div id="console-app"></div></body></html>', {
    runScripts: "outside-only", pretendToBeVisual: true, url: url,
  });
  var window = dom.window;
  window.SITE_CONFIG = { storageKey: "nordpunkt", company: { name: "Vibeverk" } };
  window.App = { ready: function (callback) { callback(window.SITE_CONFIG); } };
  window.Components = {
    esc: esc,
    helpIcon: function () { return ""; },
    field: function () { return ""; },
  };
  window.supabase = createSupabaseMock();
  window.fetch = fetchImpl;
  window.TextDecoder = global.TextDecoder;
  window.TextEncoder = global.TextEncoder;
  Object.defineProperty(window.crypto, "subtle", { configurable: true, value: crypto.webcrypto.subtle });
  window.confirm = function () { return false; };
  window.eval(consoleCode);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  await new Promise(function (resolve) { setTimeout(resolve, 25); });
  return dom;
}

test("AI Lab blir ikkje proba på produksjonsorigin og har ikkje eige hovudmenypunkt", async function (t) {
  var calls = [];
  var dom = await mountConsole("https://vibeverk.no/console/", function (url) {
    calls.push(String(url));
    return Promise.reject(new Error("fetch skal ikkje kallast"));
  });
  t.after(function () { dom.window.close(); });
  assert.equal(dom.window.VwConsole.isAiLabLocalEnvironment(), false);
  assert.equal(calls.filter(function (url) { return url.indexOf("/__ai-lab/") !== -1; }).length, 0);
  assert.equal(dom.window.document.querySelector('[data-cs-nav="ai-lab"]'), null);
  assert.ok(dom.window.document.querySelector('[data-cs-nav="arctic"]'));
});

test("produksjons-Console kobler eksplisitt til verifisert loopback-bro før JWT sendes", async function (t) {
  var token = "test-token-med-minst-trettito-tegn-123456";
  var calls = [];
  var config = {
    apiVersion: "v1", csrfToken: "csrf-bridge", sources: [],
    providers: [{ id: "ollama", label: "Lokal Ollama", model: "gemma-test", configured: true, processing: "local", capabilities: { chat: true, streaming: true }, operations: ["chat"] }],
  };
  var dom = await mountConsole("https://vibeverk.no/console/", function (url, init) {
    var href = String(url);
    calls.push({ url: href, init: init || {} });
    if (href.indexOf("/api/arctic?") === 0) {
      var resource = new URL(href, "https://vibeverk.no").searchParams.get("resource");
      if (resource === "bootstrap") return Promise.resolve(new Response(JSON.stringify({ schemaVersion: "arctic-bootstrap-v1", connection: { status: "not_configured" }, freshness: {}, commands: [], workSessionAdapters: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ schemaVersion: "arctic-overview-v1", overallStatus: "offline", metrics: {}, servicesSummary: {}, backup: {}, sessions: {}, events: [] }), { status: 200 }));
    }
    if (href === "http://127.0.0.1:8081/__arctic/v1/bridge-info") {
      var nonce = init.headers["X-Arctic-Bridge-Nonce"];
      return Promise.resolve(new Response(JSON.stringify({
        schemaVersion: "arctic-bridge-info-v1", origin: "https://vibeverk.no",
        proof: serverModule.bridgeProof(token, "https://vibeverk.no", nonce),
      }), { status: 200 }));
    }
    if (href === "http://127.0.0.1:8081/__ai-lab/v1/config") {
      return Promise.resolve(new Response(JSON.stringify(config), { status: 200 }));
    }
    return Promise.reject(new Error("Uventa fetch: " + href));
  });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("arctic");
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  dom.window.document.querySelector('[data-arctic-tab="ai-lab"]').click();
  var tokenInput = dom.window.document.querySelector("#cs-ai-lab-bridge-token");
  assert.ok(tokenInput);
  tokenInput.value = token;
  dom.window.document.querySelector("#cs-ai-lab-bridge-connect").click();
  await new Promise(function (resolve) { setTimeout(resolve, 40); });
  var bridgeCall = calls.filter(function (call) { return call.url.indexOf("bridge-info") !== -1; })[0];
  var configCall = calls.filter(function (call) { return call.url.indexOf("/__ai-lab/v1/config") !== -1; })[0];
  assert.equal(Object.prototype.hasOwnProperty.call(bridgeCall.init.headers, "Authorization"), false, "JWT sendes ikke før lokal server er verifisert");
  assert.equal(Object.prototype.hasOwnProperty.call(bridgeCall.init.headers, "X-Arctic-Access-Token"), false, "rå lokal token sendes ikke i identitetsproben");
  assert.equal(configCall.init.headers.Authorization, "Bearer console-jwt-test");
  assert.ok(dom.window.document.querySelector("#cs-ai-lab-composer"), "AI Lab rendres etter verifisert bridge og superadmin-config");
  assert.ok(dom.window.document.querySelector(".ai-lab-bridge__disconnect"));
});

test("feil lokal token stopper bridge før Console-JWT sendes", async function (t) {
  var serverToken = "server-token-med-minst-trettito-tegn-12345";
  var calls = [];
  var dom = await mountConsole("https://vibeverk.no/console/", function (url, init) {
    var href = String(url);
    calls.push({ url: href, init: init || {} });
    if (href.indexOf("/api/arctic?") === 0) {
      var resource = new URL(href, "https://vibeverk.no").searchParams.get("resource");
      if (resource === "bootstrap") return Promise.resolve(new Response(JSON.stringify({ schemaVersion: "arctic-bootstrap-v1", connection: { status: "not_configured" }, freshness: {}, commands: [], workSessionAdapters: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ schemaVersion: "arctic-overview-v1", overallStatus: "offline", metrics: {}, servicesSummary: {}, backup: {}, sessions: {}, events: [] }), { status: 200 }));
    }
    if (href.indexOf("bridge-info") !== -1) {
      var nonce = init.headers["X-Arctic-Bridge-Nonce"];
      return Promise.resolve(new Response(JSON.stringify({ schemaVersion: "arctic-bridge-info-v1", origin: "https://vibeverk.no", proof: serverModule.bridgeProof(serverToken, "https://vibeverk.no", nonce) }), { status: 200 }));
    }
    return Promise.reject(new Error("config skal aldri kalles med feil token"));
  });
  t.after(function () { dom.window.close(); });
  dom.window.VwConsole.navigate("arctic");
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  dom.window.document.querySelector('[data-arctic-tab="ai-lab"]').click();
  dom.window.document.querySelector("#cs-ai-lab-bridge-token").value = "feil-token-med-minst-trettito-tegn-123456";
  dom.window.document.querySelector("#cs-ai-lab-bridge-connect").click();
  await new Promise(function (resolve) { setTimeout(resolve, 40); });
  assert.match(dom.window.document.querySelector("#cs-ai-lab-bridge-status").textContent, /kunne ikke bekrefte/);
  assert.equal(calls.filter(function (call) { return call.url.indexOf("/__ai-lab/v1/config") !== -1; }).length, 0);
  var probe = calls.filter(function (call) { return call.url.indexOf("bridge-info") !== -1; })[0];
  assert.equal(Object.prototype.hasOwnProperty.call(probe.init.headers, "Authorization"), false);
});

test("AI Lab ligg under lokal Arctic og Læring fungerer utan AI-kall", async function (t) {
  var calls = [];
  var mutationHeaders = [];
  var config = {
    apiVersion: "v1", csrfToken: "csrf-test",
    scenarios: [{ id: "learning-module", label: "Læringsmodulen" }],
    sources: [{ id: "safe-changes", label: "Trygge endringer", path: "docs/onboarding/safe-changes-guide.md", anthropicAllowed: true }],
    providers: [
      { id: "ollama", label: "Lokal Ollama", model: "gemma-test", configured: true, processing: "local", capabilities: { chat: false, streaming: false, documentAnalysis: true, codeAnalysis: true, fileAccess: false, codeChanges: false, tools: false }, operations: ["learning-draft"], reasonCode: null },
      { id: "anthropic", label: "Claude / Anthropic", model: "haiku-test", configured: false, processing: "external", capabilities: { chat: false, streaming: false, documentAnalysis: true, codeAnalysis: true, fileAccess: false, codeChanges: false, tools: false }, operations: [], reasonCode: "credentials_not_configured" },
      { id: "codex", label: "Codex", model: null, configured: false, processing: "external", capabilities: { chat: false, streaming: false, documentAnalysis: false, codeAnalysis: false, fileAccess: false, codeChanges: false, tools: false }, operations: [], reasonCode: "gateway_required" },
    ],
  };
  var dom = await mountConsole("http://127.0.0.1:8080/console/", function (url, init) {
    calls.push(String(url));
    if (String(url) === "/__ai-lab/v1/config") return Promise.resolve(new Response(JSON.stringify(config), { status: 200 }));
    if (String(url) === "/__ai-lab/v1/snapshots") {
      mutationHeaders.push(init.headers);
      return Promise.resolve(new Response(JSON.stringify({
        id: "snapshot-ui", scenarioId: "learning-module", snapshotHash: "hash-ui",
        promptVersion: "learning-prompt-v1", schemaVersion: "learning-draft-v1",
        sources: [{ id: "safe-changes", path: "docs/onboarding/safe-changes-guide.md", lineCount: 10 }],
      }), { status: 201 }));
    }
    if (String(url) === "/__ai-lab/v1/run") {
      mutationHeaders.push(init.headers);
      var refs = [{ sourceId: "safe-changes", startLine: 1, endLine: 2 }];
      return Promise.resolve(new Response(JSON.stringify({
        schemaVersion: "ai-lab-result-v1",
        snapshot: { id: "snapshot-ui", snapshotHash: "hash-ui" },
        provider: { id: "ollama", model: "gemma-test", durationMs: 42 },
        draft: {
          schemaVersion: "learning-draft-v1", draftStatus: "UTKAST",
          title: "<img src=x onerror=alert(1)> Trygt utkast", suggestedLevel: "grunnleggende",
          moduleDescription: { text: "Beskrivelse", sourceRefs: refs },
          howItWorks: { text: "Forklaring", sourceRefs: refs },
          onboardingText: { text: "Onboarding", sourceRefs: refs },
          quizQuestions: [{ question: "Q1", answer: "A1", sourceRefs: refs }, { question: "Q2", answer: "A2", sourceRefs: refs }],
          controlQuestions: [{ question: "K1", expectedAnswer: "S1", sourceRefs: refs }, { question: "K2", expectedAnswer: "S2", sourceRefs: refs }],
          notDocumented: [],
        },
      }), { status: 200 }));
    }
    if (String(url).indexOf("docs/onboarding/") !== -1) return Promise.resolve(new Response("# Statisk læringsinnhold", { status: 200 }));
    return Promise.reject(new Error("Uventa fetch: " + url));
  });
  t.after(function () { dom.window.close(); });
  var window = dom.window;
  assert.equal(window.VwConsole.isAiLabLocalEnvironment(), true);
  assert.ok(window.document.querySelector('[data-cs-nav="arctic"]'));
  assert.equal(window.document.querySelector('[data-cs-nav="ai-lab"]'), null);

  window.VwConsole.navigate("ai-lab");
  assert.match(window.document.getElementById("cs-section-wrap").textContent, /Separat fra Læring/);
  assert.match(window.document.getElementById("cs-section-wrap").textContent, /Modellverksted/);
  assert.equal(window.document.querySelectorAll("[data-ai-lab-provider]").length, 3);
  assert.match(window.document.querySelector('[data-ai-lab-provider="ollama"]').textContent, /Lokal behandling|Konfigurert/);
  assert.match(window.document.querySelector('[data-ai-lab-provider="codex"]').textContent, /gateway|ikke konfigurert/i);
  assert.match(window.document.getElementById("cs-section-wrap").textContent, /instruksjonen til Anthropic/);
  assert.match(window.document.getElementById("cs-section-wrap").textContent, /Haiku er ikke tilgjengelig/);
  assert.equal(window.document.querySelector('[data-ai-lab-run="anthropic"]').disabled, true);
  window.document.querySelector('[data-ai-lab-source][value="safe-changes"]').checked = true;
  window.document.querySelector('[data-ai-lab-source][value="safe-changes"]').dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(window.document.getElementById("cs-ai-lab-source-count").textContent, "1 av 6 valgt");
  window.document.getElementById("cs-ai-lab-access-token").value = "lokal-test-token-som-ikkje-skal-lagrast";
  window.document.getElementById("cs-ai-lab-access-token").dispatchEvent(new window.Event("input", { bubbles: true }));
  window.document.querySelector('[data-ai-lab-run="ollama"]').click();
  assert.equal(window.document.getElementById("cs-ai-lab-instruction").disabled, true);
  assert.equal(window.document.getElementById("cs-ai-lab-access-token").disabled, true);
  assert.equal(window.document.querySelector('[data-ai-lab-source][value="safe-changes"]').disabled, true);
  await new Promise(function (resolve) { setTimeout(resolve, 15); });
  assert.equal(mutationHeaders.length, 2);
  assert.equal(mutationHeaders[0].Authorization, "Bearer console-jwt-test");
  assert.equal(mutationHeaders[0]["X-Arctic-Access-Token"], "lokal-test-token-som-ikkje-skal-lagrast");
  assert.equal(mutationHeaders[0]["X-AI-Lab-Token"], "csrf-test");
  assert.match(window.document.getElementById("cs-ai-lab-gemma-result").textContent, /Trygt utkast/);
  assert.match(window.document.getElementById("cs-ai-lab-gemma-result").textContent, /lokal behandling/);
  assert.equal(window.document.querySelector("#cs-ai-lab-gemma-result img"), null);
  assert.ok(window.document.querySelector("#cs-ai-lab-gemma-result .ai-lab-raw pre"));
  var resultActions = window.document.querySelectorAll("#cs-ai-lab-gemma-result .ai-lab-result__actions button");
  assert.equal(resultActions.length, 2);
  assert.deepEqual(Array.from(resultActions).map(function (button) { return button.textContent; }), ["Kopier JSON", "Bruk som nytt grunnlag"]);
  assert.match(window.document.getElementById("cs-ai-lab-status").textContent, /utkastet er klart/i);
  assert.equal(window.document.activeElement.id, "cs-ai-lab-gemma-title");
  assert.equal(window.document.querySelector('#cs-ai-lab-preference option[value="ollama"]').disabled, false);
  assert.equal(window.document.querySelector('#cs-ai-lab-preference option[value="anthropic"]').disabled, true);
  assert.equal(window.document.getElementById("cs-ai-lab-instruction").disabled, false);
  var copied = "";
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: function (value) { copied = value; return Promise.resolve(); } },
  });
  resultActions[0].click();
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.match(copied, /Trygt utkast/);
  window.confirm = function () { return true; };
  resultActions[1].click();
  assert.match(window.document.getElementById("cs-ai-lab-instruction").value, /Vurder og forbedre/);
  assert.match(window.document.getElementById("cs-ai-lab-gemma-result").textContent, /vises her/);
  window.document.getElementById("cs-ai-lab-clear").click();
  assert.equal(window.document.getElementById("cs-ai-lab-access-token").value, "");
  assert.match(window.document.getElementById("cs-ai-lab-instruction").value, /Lag et kort, presist/);
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);

  var aiCallsBeforeLearning = calls.filter(function (url) { return url.indexOf("/__ai-lab/") !== -1; }).length;
  window.VwConsole.navigate("laring");
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.match(window.document.getElementById("cs-section-wrap").textContent, /Læringsdokument/);
  assert.match(window.document.getElementById("cs-section-wrap").textContent, /Statisk læringsinnhold/);
  assert.equal(calls.filter(function (url) { return url.indexOf("/__ai-lab/") !== -1; }).length, aiCallsBeforeLearning);
});

test("Gemma + review viser delvurderingar per seksjon og spørsmål, ikkje berre eit flatt review", async function (t) {
  var config = {
    apiVersion: "v1", csrfToken: "csrf-test",
    scenarios: [{ id: "learning-module", label: "Læringsmodulen" }],
    sources: [{ id: "safe-changes", label: "Trygge endringer", path: "docs/onboarding/safe-changes-guide.md", anthropicAllowed: true }],
    providers: [
      { id: "ollama", model: "gemma-test", configured: true },
      { id: "anthropic", model: "haiku-test", configured: true },
    ],
  };
  var refs = [{ sourceId: "safe-changes", startLine: 1, endLine: 2 }];
  var draft = {
    schemaVersion: "learning-draft-v1", draftStatus: "UTKAST",
    title: "Utkast til review", suggestedLevel: "grunnleggende",
    moduleDescription: { text: "Beskrivelse", sourceRefs: refs },
    howItWorks: { text: "Forklaring", sourceRefs: refs },
    onboardingText: { text: "<img src=x onerror=alert(1)> Onboarding", sourceRefs: refs },
    quizQuestions: [{ question: "Kva er trygt?", answer: "A1", sourceRefs: refs }],
    controlQuestions: [{ question: "Kva sjekkar vi?", expectedAnswer: "S1", sourceRefs: refs }],
    notDocumented: [],
  };
  var approvedVerdict = { verdict: "GODKJENT", findings: [] };
  var rejectedVerdict = { verdict: "MÅ RETTES", findings: [{ status: "MÅ RETTES", message: "Onboarding-teksten dekker berre halve påstanden.", sourceRefs: refs }] };
  var review = {
    schemaVersion: "learning-review-v2", decision: "MÅ RETTES", rationale: "Onboarding-avsnittet må rettast.",
    sectionVerdicts: { moduleDescription: approvedVerdict, howItWorks: approvedVerdict, onboardingText: rejectedVerdict, notDocumented: approvedVerdict },
    quizQuestionVerdicts: [{ index: 0, verdict: "GODKJENT", findings: [] }],
    controlQuestionVerdicts: [{ index: 0, verdict: "GODKJENT", findings: [] }],
  };
  var dom = await mountConsole("http://127.0.0.1:8080/console/", function (url, init) {
    if (String(url) === "/__ai-lab/v1/config") return Promise.resolve(new Response(JSON.stringify(config), { status: 200 }));
    if (String(url) === "/__ai-lab/v1/snapshots") {
      return Promise.resolve(new Response(JSON.stringify({
        id: "snapshot-ui", scenarioId: "learning-module", snapshotHash: "hash-ui",
        promptVersion: "learning-prompt-v1", schemaVersion: "learning-draft-v1",
        sources: [{ id: "safe-changes", path: "docs/onboarding/safe-changes-guide.md", lineCount: 10 }],
      }), { status: 201 }));
    }
    if (String(url) === "/__ai-lab/v1/gemma-review") {
      return Promise.resolve(new Response(JSON.stringify({
        schemaVersion: "ai-lab-review-result-v1",
        snapshot: { id: "snapshot-ui", snapshotHash: "hash-ui" },
        draftProvider: { id: "ollama", model: "gemma-test", durationMs: 30 },
        reviewProvider: { id: "anthropic", model: "haiku-test", durationMs: 50 },
        draft: draft, review: review,
      }), { status: 200 }));
    }
    if (String(url).indexOf("docs/onboarding/") !== -1) return Promise.resolve(new Response("# Statisk læringsinnhold", { status: 200 }));
    return Promise.reject(new Error("Uventa fetch: " + url));
  });
  t.after(function () { dom.window.close(); });
  var window = dom.window;
  window.confirm = function () { return true; };
  window.VwConsole.navigate("ai-lab");
  window.document.querySelector('[data-ai-lab-source][value="safe-changes"]').checked = true;
  window.document.querySelector('[data-ai-lab-source][value="safe-changes"]').dispatchEvent(new window.Event("change", { bubbles: true }));
  window.document.getElementById("cs-ai-lab-access-token").value = "lokal-test-token-som-ikkje-skal-lagrast";
  window.document.getElementById("cs-ai-lab-access-token").dispatchEvent(new window.Event("input", { bubbles: true }));
  window.document.querySelector('[data-ai-lab-run="review"]').click();
  await new Promise(function (resolve) { setTimeout(resolve, 15); });

  var reviewPanel = window.document.getElementById("cs-ai-lab-review-result");
  assert.ok(reviewPanel);
  assert.match(reviewPanel.textContent, /Kort modulbeskrivelse/);
  assert.match(reviewPanel.textContent, /Onboarding-tekst/);
  assert.match(reviewPanel.textContent, /Kva er trygt\?/);
  assert.match(reviewPanel.textContent, /Kva sjekkar vi\?/);
  assert.match(reviewPanel.textContent, /IKKE DOKUMENTERT/);
  assert.match(reviewPanel.textContent, /Onboarding-teksten dekker berre halve påstanden/);
  // XSS-regresjon: draft-tekst i utkastet vart injisert med rå HTML tidlegare i denne testfila sin
  // søskentest -- reviewpanelet må òg rendre med textContent, aldri innerHTML, for kjeldeinnhald.
  assert.equal(reviewPanel.querySelector("img"), null);
  assert.match(reviewPanel.textContent, /MÅ RETTES/);
  assert.ok(reviewPanel.querySelector(".ai-lab-raw pre"));
});

test("lokal origin skjuler AI Lab når den lokale API-proben feiler", async function (t) {
  var calls = [];
  var dom = await mountConsole("http://localhost:8080/console/", function (url) {
    calls.push(String(url));
    return Promise.resolve(new Response("", { status: 503 }));
  });
  t.after(function () { dom.window.close(); });
  assert.deepEqual(calls, ["/__ai-lab/v1/config"]);
  assert.equal(dom.window.document.querySelector('[data-cs-nav="ai-lab"]'), null);
});

test("Samtale strømmer trygg tekst, bruker eksplisitt kontekst og disponerer snapshotet", async function (t) {
  var calls = [];
  var config = {
    apiVersion: "v1", csrfToken: "csrf-test", sources: [{ id: "safe-changes", label: "Trygge endringer", path: "docs/safe.md" }],
    providers: [{ id: "ollama", model: "gemma-test", configured: true, processing: "local", capabilities: { chat: true, streaming: true, documentAnalysis: true }, operations: ["chat", "analyze-text", "summarize", "rewrite", "learning-draft"] }],
  };
  var dom = await mountConsole("http://127.0.0.1:8080/console/", function (url, init) {
    calls.push({ url: String(url), init: init || {} });
    if (String(url) === "/__ai-lab/v1/config") return Promise.resolve(new Response(JSON.stringify(config), { status: 200 }));
    if (String(url) === "/__ai-lab/v1/contexts") return Promise.resolve(new Response(JSON.stringify({ id: "context-1", kind: "pasted-text", contextHash: "hash", expiresAt: new Date(Date.now() + 60000).toISOString(), summary: "tekst" }), { status: 201 }));
    if (String(url) === "/__ai-lab/v1/contexts/dispose") return Promise.resolve(new Response(JSON.stringify({ disposed: true }), { status: 200 }));
    if (String(url) === "/__ai-lab/v1/stream") {
      var encoder = new TextEncoder();
      var stream = new ReadableStream({ start: function (controller) {
        controller.enqueue(encoder.encode('{"type":"meta","model":"gemma-test"}\n'));
        controller.enqueue(encoder.encode('{"type":"delta","text":"<img src=x onerror=alert(1)> Hei"}\n'));
        controller.enqueue(encoder.encode('{"type":"delta","text":" tilbake"}\n{"type":"complete"}\n'));
        controller.close();
      } });
      return Promise.resolve(new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } }));
    }
    return Promise.reject(new Error("Uventa fetch: " + url));
  });
  t.after(function () { dom.window.close(); });
  var window = dom.window;
  window.VwConsole.navigate("ai-lab");
  assert.equal(window.document.querySelector('[data-ai-lab-mode="chat"]').getAttribute("aria-pressed"), "true");
  assert.deepEqual(Array.from(window.document.getElementById("cs-ai-lab-analysis-operation").options).map(function (item) { return item.value; }), ["analyze-text", "summarize", "rewrite"]);
  window.document.getElementById("cs-ai-lab-general-token").value = "minnelokal-token";
  window.document.getElementById("cs-ai-lab-general-token").dispatchEvent(new window.Event("input", { bubbles: true }));
  var kind = window.document.getElementById("cs-ai-lab-context-kind");
  kind.value = "pasted-text"; kind.dispatchEvent(new window.Event("change", { bubbles: true }));
  var pasted = window.document.getElementById("cs-ai-lab-pasted-text");
  pasted.value = "Eksplisitt analysetekst"; pasted.dispatchEvent(new window.Event("input", { bubbles: true }));
  window.document.getElementById("cs-ai-lab-composer").value = "HEI";
  window.document.getElementById("cs-ai-lab-stream-run").click();
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  var transcript = window.document.getElementById("cs-ai-lab-transcript");
  assert.match(transcript.textContent, /Hei tilbake/);
  assert.equal(transcript.querySelector("img"), null);
  var contextCall = calls.filter(function (call) { return call.url === "/__ai-lab/v1/contexts"; })[0];
  assert.deepEqual(JSON.parse(contextCall.init.body), { kind: "pasted-text", text: "Eksplisitt analysetekst" });
  var streamCall = calls.filter(function (call) { return call.url === "/__ai-lab/v1/stream"; })[0];
  assert.equal(JSON.parse(streamCall.init.body).operation, "chat");
  assert.equal(streamCall.init.headers["X-Arctic-Access-Token"], "minnelokal-token");
  assert.equal(calls.filter(function (call) { return call.url === "/__ai-lab/v1/contexts/dispose"; }).length, 1);
  assert.equal(kind.disabled, true);
  assert.equal(window.document.getElementById("cs-ai-lab-context-lock").hidden, false);
  window.document.getElementById("cs-ai-lab-new-session").click();
  assert.equal(window.document.getElementById("cs-ai-lab-context-kind").value, "none");
  assert.equal(window.document.getElementById("cs-ai-lab-context-kind").disabled, false);
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);
});

test("Samtale kan avbrytes og øktlisten begrenses til ti i nettleserminnet", async function (t) {
  var config = { apiVersion: "v1", csrfToken: "csrf-test", sources: [], providers: [{ id: "ollama", model: "gemma-test", configured: true, processing: "local", capabilities: { chat: true, streaming: true }, operations: ["chat"] }] };
  var dom = await mountConsole("http://127.0.0.1:8080/console/", function (url, init) {
    if (String(url) === "/__ai-lab/v1/config") return Promise.resolve(new Response(JSON.stringify(config), { status: 200 }));
    if (String(url) === "/__ai-lab/v1/contexts") return Promise.resolve(new Response(JSON.stringify({ id: "context-cancel", kind: "none", expiresAt: new Date(Date.now() + 60000).toISOString() }), { status: 201 }));
    if (String(url) === "/__ai-lab/v1/contexts/dispose") return Promise.resolve(new Response("{}", { status: 200 }));
    if (String(url) === "/__ai-lab/v1/stream") return new Promise(function (resolve, reject) {
      init.signal.addEventListener("abort", function () { var error = new Error("aborted"); error.name = "AbortError"; reject(error); });
    });
    return Promise.reject(new Error("Uventa fetch: " + url));
  });
  t.after(function () { dom.window.close(); });
  var window = dom.window;
  window.VwConsole.navigate("ai-lab");
  window.document.getElementById("cs-ai-lab-general-token").value = "token";
  window.document.getElementById("cs-ai-lab-general-token").dispatchEvent(new window.Event("input", { bubbles: true }));
  window.document.getElementById("cs-ai-lab-composer").value = "Langt svar";
  window.document.getElementById("cs-ai-lab-stream-run").click();
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  window.document.getElementById("cs-ai-lab-stop").click();
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.match(window.document.getElementById("cs-ai-lab-transcript").textContent, /Avbrutt|delvis/i);
  for (var i = 0; i < 11; i += 1) window.document.getElementById("cs-ai-lab-new-session").click();
  assert.equal(window.document.querySelectorAll("#cs-ai-lab-session-list .ai-lab-session").length, 10);
});
