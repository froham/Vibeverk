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
  var snapshotBodies = [];
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
      snapshotBodies.push(JSON.parse(init.body));
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
  assert.match(window.document.getElementById("cs-section-wrap").textContent, /Velg arbeidsmåte/);
  assert.equal(window.document.querySelectorAll("[data-ai-lab-provider]").length, 3);
  assert.match(window.document.querySelector('[data-ai-lab-provider="ollama"]').textContent, /Lokal behandling|Konfigurert/);
  assert.match(window.document.querySelector('[data-ai-lab-provider="codex"]').textContent, /gateway|ikke konfigurert/i);
  assert.match(window.document.getElementById("cs-section-wrap").textContent, /Haiku er ikke tilgjengelig/);
  assert.equal(window.document.getElementById("cs-ai-lab-general").hidden, true);
  assert.equal(window.document.getElementById("cs-ai-lab-learning").hidden, false);
  assert.ok(window.document.querySelector("#cs-ai-lab-learning .ai-lab-learning-setup"));
  assert.ok(window.document.querySelector("#cs-ai-lab-learning .ai-lab-learning-output #cs-ai-lab-learning-empty"));
  var consoleHtml = fs.readFileSync("console/index.html", "utf8");
  assert.match(consoleHtml, /\.arctic-pane \[hidden\]\s*\{\s*display:none !important;/);
  assert.match(consoleHtml, /\.ai-lab-learning-layout\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.ok(window.document.getElementById("cs-ai-lab-open-sources"));
  assert.ok(window.document.getElementById("cs-ai-lab-open-paste"));
  assert.ok(window.document.getElementById("cs-ai-lab-upload-text"));
  assert.equal(window.document.querySelector('[data-ai-lab-run="anthropic"]').disabled, true);
  window.document.querySelector('[data-ai-lab-source][value="safe-changes"]').checked = true;
  window.document.querySelector('[data-ai-lab-source][value="safe-changes"]').dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(window.document.getElementById("cs-ai-lab-source-count").textContent, "1 av 6 vedlegg");
  window.document.getElementById("cs-ai-lab-open-paste").click();
  assert.equal(window.document.getElementById("cs-ai-lab-paste-picker").open, true);
  window.document.getElementById("cs-ai-lab-learning-label").value = "møte-notater.txt";
  window.document.getElementById("cs-ai-lab-learning-label").dispatchEvent(new window.Event("input", { bubbles: true }));
  window.document.getElementById("cs-ai-lab-learning-text").value = "Første linje\nAndre linje";
  window.document.getElementById("cs-ai-lab-learning-text").dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(window.document.getElementById("cs-ai-lab-source-count").textContent, "2 av 6 vedlegg");
  assert.match(window.document.getElementById("cs-ai-lab-learning-attachments").textContent, /møte-notater\.txt/);
  var textFileInput = window.document.getElementById("cs-ai-lab-text-file");
  Object.defineProperty(textFileInput, "files", { configurable: true, value: [new window.File(["Opplastet linje én\nOpplastet linje to"], "brief.md", { type: "text/markdown" })] });
  textFileInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.equal(window.document.getElementById("cs-ai-lab-learning-label").value, "brief.md");
  assert.match(window.document.getElementById("cs-ai-lab-learning-text").value, /Opplastet linje én/);
  window.document.getElementById("cs-ai-lab-access-token").value = "lokal-test-token-som-ikkje-skal-lagrast";
  window.document.getElementById("cs-ai-lab-access-token").dispatchEvent(new window.Event("input", { bubbles: true }));
  window.document.querySelector('[data-ai-lab-run="ollama"]').click();
  assert.equal(window.document.getElementById("cs-ai-lab-instruction").disabled, true);
  assert.equal(window.document.getElementById("cs-ai-lab-access-token").disabled, true);
  assert.equal(window.document.querySelector('[data-ai-lab-source][value="safe-changes"]').disabled, true);
  await new Promise(function (resolve) { setTimeout(resolve, 15); });
  assert.equal(mutationHeaders.length, 2);
  assert.equal(snapshotBodies[0].pastedText, "Opplastet linje én\nOpplastet linje to");
  assert.equal(snapshotBodies[0].pastedLabel, "brief.md");
  assert.equal(mutationHeaders[0].Authorization, "Bearer console-jwt-test");
  assert.equal(mutationHeaders[0]["X-Arctic-Access-Token"], "lokal-test-token-som-ikkje-skal-lagrast");
  assert.equal(mutationHeaders[0]["X-AI-Lab-Token"], "csrf-test");
  assert.match(window.document.getElementById("cs-ai-lab-gemma-result").textContent, /Trygt utkast/);
  assert.equal(window.document.getElementById("cs-ai-lab-gemma-section").hidden, false);
  assert.equal(window.document.getElementById("cs-ai-lab-haiku-section").hidden, true);
  assert.equal(window.document.getElementById("cs-ai-lab-learning-empty").hidden, true);
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
  var streamBodies = [];
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
      streamBodies.push(JSON.parse(init.body));
      var encoder = new TextEncoder();
      var stream = new ReadableStream({ start: function (controller) {
        controller.enqueue(encoder.encode('{"type":"meta","model":"gemma-test"}\n'));
        controller.enqueue(encoder.encode('{"type":"delta","text":"<img src=x onerror=alert(1)> Hei"}\n'));
        controller.enqueue(encoder.encode(JSON.stringify({ type: "delta", text: " tilbake\n```html\n<!doctype html><html><body><h1>Hei</h1></body></html>\n```" }) + '\n{"type":"complete"}\n'));
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
  assert.equal(window.document.getElementById("cs-ai-lab-general").hidden, false);
  assert.equal(window.document.getElementById("cs-ai-lab-learning").hidden, true);
  assert.deepEqual(Array.from(window.document.getElementById("cs-ai-lab-analysis-operation").options).map(function (item) { return item.value; }), ["analyze-text", "summarize", "rewrite"]);
  window.document.getElementById("cs-ai-lab-access-token").value = "minnelokal-token";
  window.document.getElementById("cs-ai-lab-access-token").dispatchEvent(new window.Event("input", { bubbles: true }));
  var kind = window.document.getElementById("cs-ai-lab-context-kind");
  kind.value = "pasted-text"; kind.dispatchEvent(new window.Event("change", { bubbles: true }));
  var pasted = window.document.getElementById("cs-ai-lab-pasted-text");
  pasted.value = "Eksplisitt analysetekst"; pasted.dispatchEvent(new window.Event("input", { bubbles: true }));
  var imageInput = window.document.getElementById("cs-ai-lab-image-file");
  var clipboardImage = new window.File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], "skisse.png", { type: "image/png" });
  var pasteEvent = new window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(pasteEvent, "clipboardData", { configurable: true, value: { items: [{ type: "image/png", getAsFile: function () { return clipboardImage; } }] } });
  window.document.getElementById("cs-ai-lab-composer").dispatchEvent(pasteEvent);
  assert.equal(pasteEvent.defaultPrevented, true);
  var textPasteEvent = new window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(textPasteEvent, "clipboardData", { configurable: true, value: { items: [{ type: "text/plain", getAsFile: function () { return null; } }] } });
  window.document.getElementById("cs-ai-lab-composer").dispatchEvent(textPasteEvent);
  assert.equal(textPasteEvent.defaultPrevented, false);
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.equal(window.document.getElementById("cs-ai-lab-pending-image").hidden, false);
  assert.match(window.document.getElementById("cs-ai-lab-pending-image").textContent, /skisse\.png/);
  window.document.getElementById("cs-ai-lab-composer").value = "HEI";
  window.document.getElementById("cs-ai-lab-stream-run").click();
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  var transcript = window.document.getElementById("cs-ai-lab-transcript");
  assert.match(transcript.textContent, /Hei tilbake/);
  assert.match(transcript.textContent, /Viba/);
  assert.equal(transcript.getAttribute("aria-label"), "Samtale med Viba");
  assert.match(window.document.querySelector(".ai-lab-banner").textContent, /Viba/);
  assert.match(window.document.querySelector(".ai-lab-providers").textContent, /Gemma/);
  assert.equal(transcript.querySelector("img"), null);
  assert.equal(transcript.querySelector(".ai-lab-code code").textContent, "<!doctype html><html><body><h1>Hei</h1></body></html>");
  assert.match(transcript.querySelector(".ai-lab-code-warning").textContent, /utrygg/i);
  var copiedCode = "";
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: function (value) { copiedCode = value; return Promise.resolve(); } } });
  transcript.querySelector(".ai-lab-code .ai-lab-message-action").click();
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.match(copiedCode, /<!doctype html>/);
  var downloadedName = "";
  window.URL.createObjectURL = function () { return "blob:ai-lab-test"; };
  window.URL.revokeObjectURL = function () {};
  window.HTMLAnchorElement.prototype.click = function () { downloadedName = this.download; };
  transcript.querySelectorAll(".ai-lab-code .ai-lab-message-action")[1].click();
  assert.match(downloadedName, /\.html$/);
  transcript.querySelector(".ai-lab-message__actions .ai-lab-message-action").click();
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.match(copiedCode, /```html/);
  var contextCall = calls.filter(function (call) { return call.url === "/__ai-lab/v1/contexts"; })[0];
  assert.deepEqual(JSON.parse(contextCall.init.body), { kind: "pasted-text", text: "Eksplisitt analysetekst" });
  var streamCall = calls.filter(function (call) { return call.url === "/__ai-lab/v1/stream"; })[0];
  assert.equal(JSON.parse(streamCall.init.body).operation, "chat");
  assert.equal(streamBodies[0].image.mimeType, "image/png");
  assert.ok(streamBodies[0].image.data.length > 0);
  assert.equal(streamBodies[0].reasoningEffort, "none");
  assert.match(transcript.textContent, /Bilde · skisse\.png/);
  assert.equal(window.document.getElementById("cs-ai-lab-pending-image").hidden, true);
  var originalCreateElement = window.document.createElement.bind(window.document);
  var originalImage = window.Image;
  window.Image = function () {
    var self = this;
    self.width = 2400; self.height = 1600;
    Object.defineProperty(self, "src", { set: function () { setTimeout(function () { self.onload(); }, 0); } });
  };
  window.document.createElement = function (name) {
    if (String(name).toLowerCase() !== "canvas") return originalCreateElement(name);
    return {
      width: 0, height: 0,
      getContext: function () { return { fillStyle: "", fillRect: function () {}, drawImage: function () {} }; },
      toBlob: function (callback) { callback(new window.Blob([new Uint8Array([255, 216, 255, 0])], { type: "image/jpeg" })); },
    };
  };
  Object.defineProperty(imageInput, "files", { configurable: true, value: [new window.File(["x".repeat(2 * 1024 * 1024 + 1)], "stort.png", { type: "image/png" })] });
  imageInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise(function (resolve) { setTimeout(resolve, 35); });
  assert.match(window.document.getElementById("cs-ai-lab-pending-image").textContent, /2,0 MB → 1 kB/);
  window.document.createElement = originalCreateElement;
  window.Image = originalImage;
  assert.equal(streamCall.init.headers["X-Arctic-Access-Token"], "minnelokal-token");
  assert.equal(calls.filter(function (call) { return call.url === "/__ai-lab/v1/contexts/dispose"; }).length, 1);
  assert.equal(kind.disabled, true);
  assert.equal(window.document.getElementById("cs-ai-lab-context-lock").hidden, false);
  window.confirm = function () { return true; };
  window.document.getElementById("cs-ai-lab-composer").value = "/compact";
  window.document.getElementById("cs-ai-lab-stream-run").click();
  await new Promise(function (resolve) { setTimeout(resolve, 50); });
  assert.equal(streamBodies[1].operation, "summarize");
  assert.equal(streamBodies[1].reasoningEffort, "low");
  assert.match(window.document.querySelector(".ai-lab-compaction-note").textContent, /2 eldre meldinger/);
  assert.match(window.document.getElementById("cs-ai-lab-context-count").textContent, /2 av 20/);
  window.document.getElementById("cs-ai-lab-composer").value = "Fortsett fra sammendraget";
  window.document.getElementById("cs-ai-lab-stream-run").click();
  await new Promise(function (resolve) { setTimeout(resolve, 35); });
  assert.equal(streamBodies[2].messages.length, 3);
  assert.match(streamBodies[2].messages[0].content, /lokalt sammendrag/);
  assert.match(streamBodies[2].messages[1].content, /<!doctype html>/);
  window.document.getElementById("cs-ai-lab-composer").value = "/clear";
  window.document.getElementById("cs-ai-lab-stream-run").click();
  assert.equal(window.document.querySelectorAll("#cs-ai-lab-transcript article").length, 0);
  assert.match(window.document.getElementById("cs-ai-lab-context-count").textContent, /0 av 20/);
  window.document.getElementById("cs-ai-lab-new-session").click();
  assert.equal(window.document.getElementById("cs-ai-lab-context-kind").value, "none");
  assert.equal(window.document.getElementById("cs-ai-lab-context-kind").disabled, false);
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);
});

test("Samtale venter på provider-opprydding etter avbrudd og økter slettes eksplisitt", async function (t) {
  var config = { apiVersion: "v1", csrfToken: "csrf-test", sources: [], providers: [{ id: "ollama", model: "gemma-test", configured: true, processing: "local", capabilities: { chat: true, streaming: true }, operations: ["chat"] }] };
  var releaseProviderIdle;
  var dom = await mountConsole("http://127.0.0.1:8080/console/", function (url, init) {
    if (String(url) === "/__ai-lab/v1/config") return Promise.resolve(new Response(JSON.stringify(config), { status: 200 }));
    if (String(url) === "/__ai-lab/v1/contexts") return Promise.resolve(new Response(JSON.stringify({ id: "context-cancel", kind: "none", expiresAt: new Date(Date.now() + 60000).toISOString() }), { status: 201 }));
    if (String(url) === "/__ai-lab/v1/contexts/dispose") return Promise.resolve(new Response("{}", { status: 200 }));
    if (String(url) === "/__ai-lab/v1/provider-idle") return new Promise(function (resolve) { releaseProviderIdle = function () { resolve(new Response(JSON.stringify({ provider: "ollama", idle: true }), { status: 200 })); }; });
    if (String(url) === "/__ai-lab/v1/stream") return new Promise(function (resolve, reject) {
      init.signal.addEventListener("abort", function () { var error = new Error("aborted"); error.name = "AbortError"; reject(error); });
    });
    return Promise.reject(new Error("Uventa fetch: " + url));
  });
  t.after(function () { dom.window.close(); });
  var window = dom.window;
  window.VwConsole.navigate("ai-lab");
  window.document.getElementById("cs-ai-lab-access-token").value = "token";
  window.document.getElementById("cs-ai-lab-access-token").dispatchEvent(new window.Event("input", { bubbles: true }));
  window.document.getElementById("cs-ai-lab-composer").value = "Langt svar";
  window.document.getElementById("cs-ai-lab-stream-run").click();
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  window.document.getElementById("cs-ai-lab-stop").click();
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.match(window.document.getElementById("cs-ai-lab-transcript").textContent, /Avbrutt|delvis/i);
  assert.match(window.document.getElementById("cs-ai-lab-general-status").textContent, /rydder opp/i);
  assert.equal(window.document.getElementById("cs-ai-lab-stream-run").disabled, true);
  releaseProviderIdle();
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.equal(window.document.getElementById("cs-ai-lab-stream-run").disabled, false);

  window.document.getElementById("cs-ai-lab-new-session").click();
  window.document.getElementById("cs-ai-lab-new-session").click();
  window.document.querySelectorAll("[data-ai-lab-delete-session]")[1].click();
  assert.equal(window.document.querySelectorAll("#cs-ai-lab-session-list .ai-lab-session").length, 2);
  var retainedSessionId = window.document.querySelector("#cs-ai-lab-session-list .ai-lab-session").getAttribute("data-ai-lab-session-id");
  for (var i = 0; i < 12; i += 1) window.document.getElementById("cs-ai-lab-new-session").click();
  assert.equal(window.document.querySelectorAll("#cs-ai-lab-session-list .ai-lab-session").length, 10);
  assert.equal(window.document.getElementById("cs-ai-lab-new-session").disabled, true);
  assert.match(window.document.getElementById("cs-ai-lab-session-count").textContent, /10 av 10/);
  assert.ok(window.document.querySelector('[data-ai-lab-session-id="' + retainedSessionId + '"]'));
});
