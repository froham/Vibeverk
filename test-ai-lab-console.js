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
        return Promise.resolve({ data: { session: { user: { id: "operator-test" }, expires_at: 4102444800 } } });
      },
      signOut: function () {},
    },
    from: function (table) {
      if (table === "operators") return thenableQuery({ data: { status: "active" }, error: null });
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
  window.confirm = function () { return false; };
  window.eval(consoleCode);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  await new Promise(function (resolve) { setTimeout(resolve, 25); });
  return dom;
}

test("AI Lab blir ikkje proba eller vist på produksjonsorigin", async function (t) {
  var calls = [];
  var dom = await mountConsole("https://vibeverk.no/console/", function (url) {
    calls.push(String(url));
    return Promise.reject(new Error("fetch skal ikkje kallast"));
  });
  t.after(function () { dom.window.close(); });
  assert.equal(dom.window.VwConsole.isAiLabLocalEnvironment(), false);
  assert.equal(calls.filter(function (url) { return url.indexOf("/__ai-lab/") !== -1; }).length, 0);
  assert.equal(dom.window.document.querySelector('[data-cs-nav="ai-lab"]'), null);
});

test("AI Lab er ei eiga lokal fane og Læring fungerer utan AI-kall", async function (t) {
  var calls = [];
  var mutationHeaders = [];
  var config = {
    apiVersion: "v1", csrfToken: "csrf-test",
    scenarios: [{ id: "learning-module", label: "Læringsmodulen" }],
    sources: [{ id: "safe-changes", label: "Trygge endringer", path: "docs/onboarding/safe-changes-guide.md", anthropicAllowed: true }],
    providers: [
      { id: "ollama", model: "gemma-test", configured: true },
      { id: "anthropic", model: "haiku-test", configured: false },
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
  assert.ok(window.document.querySelector('[data-cs-nav="ai-lab"]'));

  window.VwConsole.navigate("ai-lab");
  assert.match(window.document.getElementById("cs-section-wrap").textContent, /Separat fra Læring/);
  assert.match(window.document.getElementById("cs-section-wrap").textContent, /instruksjonen til Anthropic/);
  assert.match(window.document.getElementById("cs-section-wrap").textContent, /Haiku er ikke konfigurert lokalt/);
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
  assert.equal(mutationHeaders[0].Authorization, "Bearer lokal-test-token-som-ikkje-skal-lagrast");
  assert.match(window.document.getElementById("cs-ai-lab-gemma-result").textContent, /Trygt utkast/);
  assert.equal(window.document.querySelector("#cs-ai-lab-gemma-result img"), null);
  assert.ok(window.document.querySelector("#cs-ai-lab-gemma-result .ai-lab-raw pre"));
  assert.equal(window.document.querySelector('#cs-ai-lab-preference option[value="ollama"]').disabled, false);
  assert.equal(window.document.querySelector('#cs-ai-lab-preference option[value="anthropic"]').disabled, true);
  assert.equal(window.document.getElementById("cs-ai-lab-instruction").disabled, false);
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
