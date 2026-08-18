"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var http = require("node:http");
var os = require("node:os");
var path = require("node:path");
var test = require("node:test");

var configModule = require("./scripts/ai-lab/config");
var sourceModule = require("./scripts/ai-lab/sources");
var schemaModule = require("./scripts/ai-lab/schemas");
var promptModule = require("./scripts/ai-lab/prompts");
var contextModule = require("./scripts/ai-lab/context");
var sensitiveModule = require("./scripts/ai-lab/sensitive");
var workflowModule = require("./scripts/ai-lab/workflow");
var ollamaModule = require("./scripts/ai-lab/providers/ollama");
var anthropicModule = require("./scripts/ai-lab/providers/anthropic");
var serverModule = require("./scripts/ai-lab-server");

function validEnv(overrides) {
  return Object.assign({
    NODE_ENV: "development",
    AI_LAB_ENABLED: "true",
    AI_LAB_PORT: "8080",
    AI_LAB_ACCESS_TOKEN: "test-token-med-minst-trettito-tegn-123456",
    AI_LAB_OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    AI_LAB_OLLAMA_MODEL: "gemma4:26b",
    AI_LAB_ANTHROPIC_BASE_URL: "https://api.anthropic.com",
    AI_LAB_ANTHROPIC_MODEL: "claude-haiku-test",
    ANTHROPIC_API_KEY: "test-key",
    AI_LAB_ANTHROPIC_PROCESSING_APPROVED: "true",
    AI_LAB_TIMEOUT_MS: "5000",
    AI_LAB_ANTHROPIC_CALLS_PER_HOUR: "10",
    AI_LAB_MAX_PROMPT_CHARS: "200000",
  }, overrides || {});
}

function sourceRef(snapshot) {
  return [{ sourceId: snapshot.sources[0].id, startLine: 1, endLine: 1 }];
}

function validDraft(snapshot) {
  var refs = sourceRef(snapshot);
  return {
    schemaVersion: "learning-draft-v1",
    draftStatus: "UTKAST",
    title: "Trygge endringer",
    suggestedLevel: "grunnleggende",
    moduleDescription: { text: "Kort beskrivelse.", sourceRefs: refs },
    howItWorks: { text: "Slik fungerer det.", sourceRefs: refs },
    onboardingText: { text: "Onboardingtekst.", sourceRefs: refs },
    quizQuestions: [
      { question: "Spørsmål 1?", answer: "Svar 1.", sourceRefs: refs },
      { question: "Spørsmål 2?", answer: "Svar 2.", sourceRefs: refs },
    ],
    controlQuestions: [
      { question: "Kontroll 1?", expectedAnswer: "Svar 1.", sourceRefs: refs },
      { question: "Kontroll 2?", expectedAnswer: "Svar 2.", sourceRefs: refs },
    ],
    notDocumented: [{ status: "IKKE DOKUMENTERT", claim: "Ukjent detalj", reason: "Kjeldene omtaler ikkje dette." }],
  };
}

function approvedVerdict() {
  return { verdict: "GODKJENT", findings: [] };
}

function rejectedVerdict(snapshot) {
  return { verdict: "MÅ RETTES", findings: [{ status: "MÅ RETTES", message: "Gjer teksten meir presis.", sourceRefs: sourceRef(snapshot) }] };
}

function indexedVerdicts(count, verdictFn) {
  var out = [];
  for (var i = 0; i < count; i++) out.push(Object.assign({ index: i }, verdictFn()));
  return out;
}

function allApprovedReview(snapshot, draft) {
  return {
    schemaVersion: "learning-review-v2",
    decision: "GODKJENT",
    rationale: "Alle delar er dekt av kjeldene.",
    sectionVerdicts: {
      moduleDescription: approvedVerdict(),
      howItWorks: approvedVerdict(),
      onboardingText: approvedVerdict(),
      notDocumented: approvedVerdict(),
    },
    quizQuestionVerdicts: indexedVerdicts(draft.quizQuestions.length, approvedVerdict),
    controlQuestionVerdicts: indexedVerdicts(draft.controlQuestions.length, approvedVerdict),
  };
}

function validReview(snapshot, draft) {
  var review = allApprovedReview(snapshot, draft);
  review.decision = "MÅ RETTES";
  review.rationale = "Eitt punkt må presiserast.";
  review.sectionVerdicts.onboardingText = rejectedVerdict(snapshot);
  return review;
}

function rawHttpStatus(port, hostHeader, pathname) {
  return new Promise(function (resolve, reject) {
    var request = http.request({
      hostname: "127.0.0.1",
      port: port,
      path: pathname,
      method: "GET",
      headers: { Host: hostHeader },
    }, function (response) {
      response.resume();
      response.on("end", function () { resolve(response.statusCode); });
    });
    request.on("error", reject);
    request.end();
  });
}

test("konfigurasjon er eksplisitt lokal og miljøstyrt", function () {
  var config = configModule.readConfig(validEnv());
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.ollamaModel, "gemma4:26b");
  assert.equal(config.ollamaBaseUrl, "http://127.0.0.1:11434");
  assert.equal(config.anthropicProcessingApproved, true);
  assert.equal(config.bridgeAllowedOrigin, "");
  assert.equal(configModule.readConfig(validEnv({ ARCTIC_BRIDGE_ALLOWED_ORIGIN: "https://vibeverk.no" })).bridgeAllowedOrigin, "https://vibeverk.no");
  assert.equal(configModule.readConfig(validEnv({ AI_LAB_ANTHROPIC_PROCESSING_APPROVED: "false" })).anthropicProcessingApproved, false);
  assert.throws(function () { configModule.readConfig(validEnv({ NODE_ENV: "production" })); }, /sperra utanfor/);
  assert.throws(function () { configModule.readConfig(validEnv({ CI: "true" })); }, /CI eller Vercel/);
  assert.throws(function () { configModule.readConfig(validEnv({ VERCEL: "1" })); }, /CI eller Vercel/);
  assert.throws(function () { configModule.readConfig(validEnv({ VERCEL_ENV: "preview" })); }, /CI eller Vercel/);
  assert.throws(function () { configModule.readConfig(validEnv({ AI_LAB_ENABLED: "false" })); }, /AI_LAB_ENABLED/);
  assert.throws(function () { configModule.readConfig(validEnv(), { execArgv: ["--use-env-proxy"] }); }, /miljøproxy/);
  assert.throws(function () { configModule.readConfig(validEnv({ AI_LAB_ACCESS_TOKEN: "for-kort" })); }, /minst 32/);
  assert.throws(function () { configModule.readConfig(validEnv({ AI_LAB_OLLAMA_BASE_URL: "http://localhost:11434" })); }, /bokstavleg/);
  assert.throws(function () { configModule.readConfig(validEnv({ AI_LAB_OLLAMA_BASE_URL: "http://127.0.0.1:11434?next=remote" })); }, /bokstavleg/);
  assert.throws(function () { configModule.readConfig(validEnv({ AI_LAB_ANTHROPIC_BASE_URL: "https://evil.example" })); }, /api\.anthropic\.com/);
  assert.throws(function () { configModule.readConfig(validEnv({ ARCTIC_BRIDGE_ALLOWED_ORIGIN: "http://vibeverk.no" })); }, /eksakt HTTPS-origin/);
  assert.throws(function () { configModule.readConfig(validEnv({ ARCTIC_BRIDGE_ALLOWED_ORIGIN: "https://vibeverk.no/console" })); }, /eksakt HTTPS-origin/);
});

test("kjelder bruker allowlist, grenser og stabile snapshot-hashar", function () {
  var first = sourceModule.createSnapshot(process.cwd(), "learning-module", ["safe-changes"], "Lag ei kort innføring.", false);
  var second = sourceModule.createSnapshot(process.cwd(), "learning-module", ["safe-changes"], "Lag ei kort innføring.", false);
  assert.equal(first.hash, second.hash);
  assert.equal(first.sources[0].path, "docs/onboarding/safe-changes-guide.md");
  assert.equal(first.sources[0].anthropicAllowed, true);
  assert.ok(sourceModule.SOURCE_REGISTRY.every(function (source) {
    return /^[a-f0-9]{64}$/.test(source.anthropicApprovedSha256) &&
      sourceModule.approvedForAnthropic(process.cwd(), source);
  }));
  assert.throws(function () {
    sourceModule.createSnapshot(process.cwd(), "learning-module", ["../../.env"], "Test", false);
  }, /Ukjend kjelde-ID/);
  assert.throws(function () {
    sourceModule.createSnapshot(process.cwd(), "learning-module", ["safe-changes", "safe-changes"], "Test", false);
  }, /fleire gonger/);
  assert.throws(function () {
    sourceModule.createSnapshot(process.cwd(), "learning-module", ["safe-changes"], "", false);
  }, /Instruksjonen/);
});

test("standardkjeldene passar innan AI Lab si eksplisitte Ollama-promptgrense", function () {
  var config = configModule.readConfig(validEnv());
  var snapshot = sourceModule.createSnapshot(process.cwd(), "learning-module", [
    "employee-onboarding", "system-overview", "module-conventions",
  ], "Lag eit kort opplæringsutkast.", false);
  var draftPrompt = promptModule.buildDraftPrompt(snapshot);
  var reviewPrompt = promptModule.buildReviewPrompt(snapshot, validDraft(snapshot));
  assert.ok((draftPrompt.system + "\n\n" + draftPrompt.user).length < config.maxPromptChars);
  assert.ok((reviewPrompt.system + "\n\n" + reviewPrompt.user).length < config.maxPromptChars);
});

test("innlimt læringsmateriale blir en lokal, linjenummererbar kilde", function () {
  var snapshot = sourceModule.createSnapshot(
    process.cwd(), "learning-module", [], "Lag et kort utkast.", false,
    "Første linje.\nAndre linje.", "notater.txt"
  );
  assert.equal(snapshot.sources.length, 1);
  assert.deepEqual({
    id: snapshot.sources[0].id,
    label: snapshot.sources[0].label,
    path: snapshot.sources[0].path,
    lineCount: snapshot.sources[0].lineCount,
    anthropicAllowed: snapshot.sources[0].anthropicAllowed,
  }, {
    id: "pasted-material", label: "notater.txt",
    path: "midlertidig/innlimt-materiale.txt", lineCount: 2, anthropicAllowed: false,
  });
  assert.match(promptModule.buildDraftPrompt(snapshot).user, /Første linje/);
  assert.throws(function () {
    sourceModule.createSnapshot(process.cwd(), "learning-module", [], "Test", true, "Lokal tekst", "tekst.txt");
  }, /bare behandles lokalt/);
  assert.throws(function () {
    sourceModule.createSnapshot(process.cwd(), "learning-module", [], "Test", false, "x".repeat(20001), "tekst.txt");
  }, /20000/);
});

test("generelle kontekster er typet, avgrenset og inneholder ingen vilkårlige filstier", function () {
  var none = contextModule.createContext(process.cwd(), { kind: "none" });
  assert.equal(none.kind, "none");
  var pasted = contextModule.createContext(process.cwd(), { kind: "pasted-text", text: "  Kort tekst.  " });
  assert.equal(pasted.text, "Kort tekst.");
  var selected = contextModule.createContext(process.cwd(), { kind: "selected-sources", sourceIds: ["safe-changes"] });
  assert.deepEqual(selected.sources.map(function (source) { return source.id; }), ["safe-changes"]);
  assert.throws(function () { contextModule.createContext(process.cwd(), { kind: "none", path: "/etc/passwd" }); }, /ukjente felt/);
  assert.throws(function () { contextModule.createContext(process.cwd(), { kind: "pasted-text", text: "x".repeat(20001) }); }, /for lang/);
  assert.throws(function () { contextModule.createContext(process.cwd(), { kind: "selected-sources", sourceIds: ["../../etc/passwd"] }); }, /Ukjend kjelde-ID/);
});

test("vision-vedlegg valideres lokalt og sendes som én OpenAI-innholdsdel", async function () {
  var capturedMessages;
  var capturedOptions;
  var workflow = workflowModule.createWorkflow(configModule.readConfig(validEnv()), {
    ollamaProvider: {
      id: "ollama", model: "gemma-test",
      streamOperation: async function (messages, options) { capturedMessages = messages; capturedOptions = options; return { content: "Et bilde", finishReason: "stop", usage: null }; },
      waitUntilIdle: async function () {},
    },
    anthropicProvider: { id: "anthropic", model: "haiku-test", configured: false },
  });
  var context = workflow.createContext({ kind: "none" }, "operator-a");
  var pngBytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(pngBytes);
  Buffer.from("IHDR").copy(pngBytes, 12);
  pngBytes.writeUInt32BE(1, 16);
  pngBytes.writeUInt32BE(1, 20);
  var png = pngBytes.toString("base64");
  await workflow.runOperation(context.id, "chat", [{ role: "user", content: "Hva ser du?" }], { onDelta: function () {} }, "operator-a", { mimeType: "image/png", data: png });
  assert.equal(capturedMessages[capturedMessages.length - 1].content[0].type, "text");
  assert.match(capturedMessages[capturedMessages.length - 1].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(capturedOptions.reasoningEffort, "none");
  await assert.rejects(workflow.runOperation(context.id, "chat", [{ role: "user", content: "Test" }], {}, "operator-a", { mimeType: "image/png", data: Buffer.from("ikke png").toString("base64") }), /samsvarer ikke/);
  pngBytes.writeUInt32BE(20000, 16);
  await assert.rejects(workflow.runOperation(context.id, "chat", [{ role: "user", content: "Test" }], {}, "operator-a", { mimeType: "image/png", data: pngBytes.toString("base64") }), /for store dimensjoner/);
  await assert.rejects(workflow.runOperation(context.id, "chat", [{ role: "user", content: "Test" }], {}, "operator-a", { mimeType: "image/svg+xml", data: png }), /ugyldig format/);
});

test("generell Gemma-flyt bruker begrenset historikk, strømmer og kan tømme kontekst", async function () {
  var captured;
  var deltas = [];
  var workflow = workflowModule.createWorkflow(configModule.readConfig(validEnv()), {
    ollamaProvider: {
      id: "ollama", model: "gemma-test",
      generateDraft: async function () { return {}; },
      streamOperation: async function (messages, options) {
        captured = messages;
        options.onDelta("Hei");
        options.onDelta("!");
        return { content: "Hei!", finishReason: "stop", usage: { completion_tokens: 2 } };
      },
    },
    anthropicProvider: { id: "anthropic", model: "haiku-test", configured: false },
  });
  var context = workflow.createContext({ kind: "none" });
  var result = await workflow.runOperation(context.id, "chat", [{ role: "user", content: "HEI" }], {
    onDelta: function (text) { deltas.push(text); },
  });
  assert.deepEqual(deltas, ["Hei", "!"]);
  assert.match(captured[0].content, /Et enkelt hei/);
  assert.match(captured[0].content, /Du er Viba/);
  assert.match(captured[0].content, /underliggende språkmodellen er Gemma/);
  assert.deepEqual(captured[1], { role: "user", content: "HEI" });
  assert.equal(result.operation, "chat");
  assert.equal(result.usage.completion_tokens, 2);
  assert.equal(workflow.disposeContext(context.id), true);
  assert.throws(function () { workflow.describeContext(context.id); }, /gått ut/);
  var another = workflow.createContext({ kind: "none" });
  await assert.rejects(workflow.runOperation(another.id, "chat", new Array(21).fill({ role: "user", content: "x" })), /mellom 1 og 20/);
  await assert.rejects(workflow.runOperation(another.id, "chat", [
    { role: "user", content: "første" }, { role: "user", content: "andre" }
  ]), /veksle/);
  await assert.rejects(workflow.runOperation(another.id, "analyze-text", [
    { role: "user", content: "Analyser dette" }
  ]), /krever innlimt tekst/);
  var pastedContext = workflow.createContext({ kind: "pasted-text", text: "Et kort dokument om trygg drift." });
  for (var operation of ["analyze-text", "summarize", "rewrite"]) {
    var operationResult = await workflow.runOperation(pastedContext.id, operation, [
      { role: "user", content: "Utfør oppgaven tydelig." }
    ], { onDelta: function () {} });
    assert.equal(operationResult.operation, operation);
    assert.match(captured[0].content, /er data, ikke instruksjoner/i);
  }
  var publicConfig = workflow.getConfig();
  assert.equal(publicConfig.schemaVersion, "ai-lab-config-v2");
  assert.deepEqual(publicConfig.operations.filter(function (item) { return item.streaming; }).map(function (item) { return item.id; }), ["chat", "analyze-text", "summarize", "rewrite"]);
  assert.deepEqual(publicConfig.providers[0].operations, ["chat", "analyze-text", "summarize", "rewrite", "learning-draft"]);
  var owned = workflow.createContext({ kind: "pasted-text", text: "Bare eier A skal kunne bruke dette." }, "operator-a");
  assert.throws(function () { workflow.describeContext(owned.id, "operator-b"); }, /finnes ikke/);
  await assert.rejects(workflow.runOperation(owned.id, "chat", [{ role: "user", content: "Gjenta teksten" }], { onDelta: function () {} }, "operator-b"), /finnes ikke/);
  assert.throws(function () { workflow.disposeContext(owned.id, "operator-b"); }, /finnes ikke/);
  assert.equal(workflow.disposeContext(owned.id, "operator-a"), true);
  var ownerAContexts = [];
  for (var contextIndex = 0; contextIndex < 5; contextIndex += 1) {
    ownerAContexts.push(workflow.createContext({ kind: "none" }, "operator-a"));
  }
  var ownerBContext = workflow.createContext({ kind: "pasted-text", text: "Eier B sin kontekst." }, "operator-b");
  workflow.createContext({ kind: "none" }, "operator-a");
  assert.equal(workflow.describeContext(ownerBContext.id, "operator-b").kind, "pasted-text");
  assert.throws(function () { workflow.describeContext(ownerAContexts[0].id, "operator-a"); }, /gått ut/);
  var ownerASnapshots = [];
  for (var snapshotIndex = 0; snapshotIndex < 5; snapshotIndex += 1) {
    ownerASnapshots.push(workflow.createSnapshot({ scenarioId: "learning-module", sourceIds: ["safe-changes"], instruction: "Eier A " + snapshotIndex }, "operator-a"));
  }
  var ownerBSnapshot = workflow.createSnapshot({ scenarioId: "learning-module", sourceIds: ["safe-changes"], instruction: "Eier B" }, "operator-b");
  workflow.createSnapshot({ scenarioId: "learning-module", sourceIds: ["safe-changes"], instruction: "Eier A ny" }, "operator-a");
  assert.equal(workflow.describeSnapshot(ownerBSnapshot.id, "operator-b").scenarioId, "learning-module");
  assert.throws(function () { workflow.describeSnapshot(ownerASnapshots[0].id, "operator-a"); }, /gått ut/);
});

test("kildelesing avviser symlink og katalog", function (t) {
  var temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lab-source-"));
  t.after(function () { fs.rmSync(temp, { recursive: true, force: true }); });
  fs.symlinkSync(path.join(process.cwd(), "README.md"), path.join(temp, "README.md"));
  assert.throws(function () {
    sourceModule.createSnapshot(temp, "learning-module", ["project-readme"], "Test", false);
  }, /Symbolske lenkjer/);
  fs.unlinkSync(path.join(temp, "README.md"));
  fs.mkdirSync(path.join(temp, "README.md"));
  assert.throws(function () {
    sourceModule.createSnapshot(temp, "learning-module", ["project-readme"], "Test", false);
  }, /vanleg fil/);
  fs.rmdirSync(path.join(temp, "README.md"));
  fs.writeFileSync(path.join(temp, "README.md"), "x".repeat(25001));
  assert.throws(function () {
    sourceModule.createSnapshot(temp, "learning-module", ["project-readme"], "Test", false);
  }, /større enn tillaten grense/);
});

test("strukturvalidator avviser ekstra felt og falske kjeldereferansar", function () {
  var snapshot = sourceModule.createSnapshot(process.cwd(), "learning-module", ["safe-changes"], "Test", false);
  var draft = validDraft(snapshot);
  var draftSchema = schemaModule.learningDraftSchema(snapshot);
  var reviewSchema = schemaModule.learningReviewSchema(snapshot, draft);
  assert.deepEqual(
    draftSchema.properties.moduleDescription.properties.sourceRefs.items.properties.sourceId.enum,
    ["safe-changes"]
  );
  assert.deepEqual(
    reviewSchema.properties.sectionVerdicts.properties.moduleDescription.properties.findings.items.properties.sourceRefs.items.properties.sourceId.enum,
    ["safe-changes"]
  );
  var good = validDraft(snapshot);
  assert.equal(schemaModule.validateLearningDraft(good, snapshot).draftStatus, "UTKAST");
  var extra = Object.assign({}, good, { published: true });
  assert.throws(function () { schemaModule.validateLearningDraft(extra, snapshot); }, /ukjent felt/);
  var badRef = validDraft(snapshot);
  badRef.moduleDescription = { text: "Påstand", sourceRefs: [{ sourceId: "ikkje-vald", startLine: 1, endLine: 1 }] };
  assert.throws(function () { schemaModule.validateLearningDraft(badRef, snapshot); }, /ikkje finst/);
  var outOfRange = validDraft(snapshot);
  outOfRange.howItWorks = { text: "Påstand", sourceRefs: [{ sourceId: snapshot.sources[0].id, startLine: 1, endLine: 999999 }] };
  assert.throws(function () { schemaModule.validateLearningDraft(outOfRange, snapshot); }, /linjeintervall/);

  var approved = allApprovedReview(snapshot, draft);
  assert.equal(schemaModule.validateLearningReview(approved, snapshot, draft).decision, "GODKJENT");

  // (a) alle GODKJENT med tomme findings validerer -- allereie stadfesta over.
  // (b) ei GODKJENT-delvurdering med ikkje-tomme findings skal avvisast.
  var godkjentMedFunn = allApprovedReview(snapshot, draft);
  godkjentMedFunn.sectionVerdicts.moduleDescription = { verdict: "GODKJENT", findings: [{ status: "MÅ RETTES", message: "x", sourceRefs: [] }] };
  assert.throws(function () { schemaModule.validateLearningReview(godkjentMedFunn, snapshot, draft); }, /findings/);

  // (c) ei ikkje-GODKJENT-delvurdering med tomme findings skal avvisast.
  var rettesUtanFunn = allApprovedReview(snapshot, draft);
  rettesUtanFunn.decision = "MÅ RETTES";
  rettesUtanFunn.sectionVerdicts.howItWorks = { verdict: "MÅ RETTES", findings: [] };
  assert.throws(function () { schemaModule.validateLearningReview(rettesUtanFunn, snapshot, draft); }, /findings/);

  // (d) direkte regresjonstest for den rapporterte feilen: samla GODKJENT er
  // umogleg når éin delvurdering (her: onboardingText) ikkje er GODKJENT.
  var falskGodkjent = allApprovedReview(snapshot, draft);
  falskGodkjent.sectionVerdicts.onboardingText = rejectedVerdict(snapshot);
  assert.throws(function () { schemaModule.validateLearningReview(falskGodkjent, snapshot, draft); }, /kan ikkje vere GODKJENT/);

  // (e) feil lengd på quizQuestionVerdicts skal avvisast.
  var feilLengd = allApprovedReview(snapshot, draft);
  feilLengd.quizQuestionVerdicts = feilLengd.quizQuestionVerdicts.slice(0, 1);
  assert.throws(function () { schemaModule.validateLearningReview(feilLengd, snapshot, draft); }, /quizQuestionVerdicts/);

  // (f) duplisert index i controlQuestionVerdicts skal avvisast.
  var dupIndex = allApprovedReview(snapshot, draft);
  dupIndex.controlQuestionVerdicts[1].index = 0;
  assert.throws(function () { schemaModule.validateLearningReview(dupIndex, snapshot, draft); }, /dupliserte verdiar/);

  // review kan ikkje validerast utan tilhøyrande utkast.
  assert.throws(function () { schemaModule.validateLearningReview(approved, snapshot, null); }, /utan det tilhøyrande utkastet/);
  assert.throws(function () { schemaModule.learningReviewSchema(snapshot, null); }, /krev det tilhøyrande utkastet/);
});

test("kjente hemmelighetsformat blokkeres før ekstern behandling", async function () {
  assert.equal(sensitiveModule.containsKnownSecret("vanlig dokumentasjon uten nøkkel"), false);
  assert.equal(sensitiveModule.containsKnownSecret("ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuv"), true);
  assert.equal(sensitiveModule.containsKnownSecret("-----BEGIN PRIVATE KEY-----\nabc"), true);
  assert.equal(sensitiveModule.containsKnownSecret("API_KEY=abcdefghijklmnopqrstuv"), true);
  assert.equal(sensitiveModule.containsKnownSecret("PASSWORD=correct-horse-battery-staple"), true);
  assert.equal(sensitiveModule.containsKnownSecret("github_pat_abcdefghijklmnopqrstuvwx"), true);
  assert.equal(sensitiveModule.containsKnownSecret("eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop"), true);

  var currentTime = 1000000;
  var anthropicCalled = false;
  var config = configModule.readConfig(validEnv());
  var workflow = workflowModule.createWorkflow(config, {
    now: function () { return currentTime; },
    ollamaProvider: { id: "ollama", model: "gemma-test", generateDraft: async function () { return {}; } },
    anthropicProvider: {
      id: "anthropic", model: "haiku-test", configured: true,
      generateDraft: async function () { anthropicCalled = true; return {}; },
    },
  });
  var snapshot = workflow.createSnapshot({
    scenarioId: "learning-module", sourceIds: ["safe-changes"],
    instruction: "Oppsummer. ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuv",
  });
  await assert.rejects(workflow.runDraft(snapshot.id, "anthropic"), function (error) {
    return error.statusCode === 422 && error.code === "AI_LAB_SENSITIVE_CONTENT" && !/sk-ant/.test(error.message);
  });
  assert.equal(anthropicCalled, false);
});

test("workflow bruker identisk snapshot for Gemma og Haiku og atomisk review", async function () {
  var calls = [];
  var currentSnapshot = { sources: [{ id: "safe-changes" }] };
  var ollama = {
    id: "ollama", model: "gemma-test",
    generateDraft: async function (prompt, schema) { calls.push({ provider: "ollama", prompt: prompt, schema: schema }); return validDraft(currentSnapshot); },
  };
  var anthropic = {
    id: "anthropic", model: "haiku-test", configured: true,
    generateDraft: async function (prompt, schema) { calls.push({ provider: "anthropic", prompt: prompt, schema: schema }); return validDraft(currentSnapshot); },
    reviewDraft: async function (prompt, schema) { calls.push({ provider: "review", prompt: prompt, schema: schema }); return validReview(currentSnapshot, validDraft(currentSnapshot)); },
  };
  var config = configModule.readConfig(validEnv());
  var workflow = workflowModule.createWorkflow(config, { ollamaProvider: ollama, anthropicProvider: anthropic });
  var publicSnapshot = workflow.createSnapshot({ scenarioId: "learning-module", sourceIds: ["safe-changes"], instruction: "Lag ei innføring." });
  var gemma = await workflow.runDraft(publicSnapshot.id, "ollama");
  var haiku = await workflow.runDraft(publicSnapshot.id, "anthropic");
  assert.equal(gemma.snapshot.snapshotHash, haiku.snapshot.snapshotHash);
  assert.equal(calls[0].prompt.user, calls[1].prompt.user);
  assert.deepEqual(calls[0].schema.properties.moduleDescription.properties.sourceRefs.items.properties.sourceId.enum, ["safe-changes"]);
  assert.deepEqual(calls[1].schema.properties.moduleDescription.properties.sourceRefs.items.properties.sourceId.enum, ["safe-changes"]);
  var reviewed = await workflow.runGemmaReview(publicSnapshot.id);
  assert.equal(reviewed.snapshot.snapshotHash, publicSnapshot.snapshotHash);
  assert.equal(reviewed.review.decision, "MÅ RETTES");
  assert.match(calls[3].prompt.user, /VALIDERT GEMMA-UTKAST/);
  assert.match(calls[3].prompt.user, /"draftStatus":"UTKAST"/);
  assert.deepEqual(
    calls[3].schema.properties.sectionVerdicts.properties.moduleDescription.properties.findings.items.properties.sourceRefs.items.properties.sourceId.enum,
    ["safe-changes"]
  );
  // Schema-en for reviewet er bygd frå det FAKTISKE utkastet sitt tal på
  // spørsmål (2 quiz + 2 kontroll frå validDraft()), ikkje ei hardkoda grense
  // -- dette er sjølve mekanismen bak "nøyaktig éin verdict per spørsmål".
  assert.equal(calls[3].schema.properties.quizQuestionVerdicts.minItems, 2);
  assert.equal(calls[3].schema.properties.quizQuestionVerdicts.maxItems, 2);
  assert.equal(calls[3].schema.properties.controlQuestionVerdicts.minItems, 2);
});

test("workflow avviser utgått snapshot før providerkall", async function () {
  var currentTime = 1000000;
  var called = false;
  var expiryCallback;
  var cleared = false;
  var provider = {
    id: "ollama", model: "gemma-test",
    generateDraft: async function () { called = true; return {}; },
  };
  var config = configModule.readConfig(validEnv({ AI_LAB_SNAPSHOT_TTL_MS: "60000" }));
  var workflow = workflowModule.createWorkflow(config, {
    now: function () { return currentTime; },
    setTimer: function (callback, delay) { assert.equal(delay, 60000); expiryCallback = callback; return 7; },
    clearTimer: function (timer) { assert.equal(timer, 7); cleared = true; },
    ollamaProvider: provider,
    anthropicProvider: { id: "anthropic", model: "haiku-test", configured: true },
  });
  var snapshot = workflow.createSnapshot({ scenarioId: "learning-module", sourceIds: ["safe-changes"], instruction: "Test" });
  assert.equal(typeof expiryCallback, "function");
  expiryCallback();
  await assert.rejects(workflow.runDraft(snapshot.id, "ollama"), function (error) {
    return error.statusCode === 410 && error.code === "AI_LAB_SNAPSHOT_EXPIRED";
  });
  assert.equal(cleared, false);
  assert.equal(called, false);
});

test("Ollama-adapter avviser tomt/ugyldig JSON og handhever éin aktiv jobb", async function () {
  var config = configModule.readConfig(validEnv());
  assert.throws(function () { ollamaModule.parseStrictJson(""); }, /tomt svar/);
  assert.throws(function () { ollamaModule.parseStrictJson("```json\n{}\n```"); }, /kodegjerde/);
  assert.throws(function () { ollamaModule.parseStrictJson("ikkje-json"); }, /ugyldig JSON/);

  var release;
  var observedOptions;
  var provider = ollamaModule.createOllamaProvider(config, {
    sendPrompt: function (prompt, options) { observedOptions = options; return new Promise(function (resolve) { release = resolve; }); },
  });
  var draftSchema = { type: "object", additionalProperties: false };
  var first = provider.generateDraft({ system: "S", user: "U" }, draftSchema);
  await assert.rejects(provider.generateDraft({ system: "S", user: "U" }, draftSchema), function (error) {
    return error.statusCode === 429 && error.code === "AI_LAB_OLLAMA_BUSY";
  });
  release("{}");
  assert.deepEqual(await first, {});
  assert.equal(observedOptions.maxPromptLength, 200000);
  assert.equal(observedOptions.temperature, 0);
  assert.equal(observedOptions.reasoningEffort, "none");
  assert.equal(observedOptions.responseFormat.type, "json_schema");
  assert.equal(observedOptions.responseFormat.json_schema.name, "learning_draft");
  assert.equal(observedOptions.responseFormat.json_schema.strict, true);
  assert.deepEqual(observedOptions.responseFormat.json_schema.schema, draftSchema);
});

test("Ollama-adapter bruker samme single-flight for læringsutkast og generell strøm", async function () {
  var config = configModule.readConfig(validEnv());
  var release;
  var provider = ollamaModule.createOllamaProvider(config, {
    sendMessagesStream: function () { return new Promise(function (resolve) { release = resolve; }); },
    sendPrompt: async function () { return "{}"; },
  });
  var streaming = provider.streamOperation([{ role: "user", content: "Hei" }], { onDelta: function () {} });
  await assert.rejects(provider.generateDraft({ system: "S", user: "U" }, {}), function (error) {
    return error.statusCode === 429 && error.code === "AI_LAB_OLLAMA_BUSY";
  });
  release({ content: "Hei", finishReason: "stop", usage: null });
  assert.equal((await streaming).content, "Hei");
});

test("Ollama-adapter bekrefter idle først etter at avbrutt providerjobb er ryddet", async function () {
  var config = configModule.readConfig(validEnv());
  var release;
  var provider = ollamaModule.createOllamaProvider(config, {
    sendMessagesStream: function () { return new Promise(function (resolve) { release = resolve; }); },
  });
  var streaming = provider.streamOperation([{ role: "user", content: "Vent" }], { onDelta: function () {} });
  var idleConfirmed = false;
  var idle = provider.waitUntilIdle(1000).then(function () { idleConfirmed = true; });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.equal(idleConfirmed, false);
  release({ content: "Ferdig", finishReason: "stop", usage: null });
  await streaming;
  await idle;
  assert.equal(idleConfirmed, true);
  assert.equal(provider.isBusy(), false);
});

test("Ollama-adapter gjer avkorta kontekstsvar tydeleg", async function () {
  var config = configModule.readConfig(validEnv());
  var provider = ollamaModule.createOllamaProvider(config, {
    sendPrompt: async function () {
      var error = new Error("rå leverandørdetalj");
      error.code = "LOCAL_AI_OUTPUT_TRUNCATED";
      throw error;
    },
  });
  await assert.rejects(provider.generateDraft({ system: "S", user: "U" }, {}), function (error) {
    return error.code === "AI_LAB_TRUNCATED_RESPONSE" &&
      /avkorta av kontekstvinduet/.test(error.message) &&
      !/leverandørdetalj/.test(error.message);
  });
});

test("Anthropic-adapter sanitiserer providerfeil, ugyldig JSON og timeout", async function () {
  var config = configModule.readConfig(validEnv({ AI_LAB_TIMEOUT_MS: "1000" }));
  var observedRedirect;
  var observedUrl;
  var httpProvider = anthropicModule.createAnthropicProvider(config, {
    fetchImpl: async function (url, init) { observedUrl = url; observedRedirect = init.redirect; return new Response(JSON.stringify({ error: { message: "hemmeleg providerdetalj" } }), { status: 500 }); },
  });
  await assert.rejects(httpProvider.generateDraft({ system: "S", user: "U" }, {}), function (error) {
    assert.match(error.message, /HTTP 500/);
    assert.doesNotMatch(error.message, /hemmeleg/);
    return true;
  });
  assert.equal(observedRedirect, "error");
  assert.equal(observedUrl, "https://api.anthropic.com/v1/messages");
  var invalidProvider = anthropicModule.createAnthropicProvider(config, {
    fetchImpl: async function () { return new Response("ikkje-json", { status: 200 }); },
  });
  await assert.rejects(invalidProvider.generateDraft({ system: "S", user: "U" }, {}), /ugyldig JSON/);

  var emptyProvider = anthropicModule.createAnthropicProvider(config, {
    fetchImpl: async function () { return new Response("", { status: 200 }); },
  });
  await assert.rejects(emptyProvider.generateDraft({ system: "S", user: "U" }, {}), /ufullstendig strukturert svar/);

  var largeProvider = anthropicModule.createAnthropicProvider(config, {
    fetchImpl: async function () { return new Response("x".repeat(1024 * 1024 + 1), { status: 200 }); },
  });
  await assert.rejects(largeProvider.generateDraft({ system: "S", user: "U" }, {}), function (error) {
    return error.code === "AI_LAB_RESPONSE_TOO_LARGE";
  });

  var fastConfig = Object.assign({}, config, { timeoutMs: 5 });
  var timeoutProvider = anthropicModule.createAnthropicProvider(fastConfig, {
    fetchImpl: function (url, init) {
      return new Promise(function (resolve, reject) {
        init.signal.addEventListener("abort", function () { reject(new Error("provider secret")); }, { once: true });
      });
    },
  });
  await assert.rejects(timeoutProvider.generateDraft({ system: "S", user: "U" }, {}), function (error) {
    return error.code === "AI_LAB_TIMEOUT" && !/secret/.test(error.message);
  });
});

test("Anthropic krever eksplisitt server-side godkjenning i tillegg til API-nøkkel", async function () {
  var config = configModule.readConfig(validEnv({ AI_LAB_ANTHROPIC_PROCESSING_APPROVED: "false" }));
  var provider = anthropicModule.createAnthropicProvider(config, {
    fetchImpl: async function () { throw new Error("skal ikke kalles"); },
  });
  assert.equal(provider.configured, false);
  await assert.rejects(provider.generateDraft({ system: "S", user: "U" }, {}), function (error) {
    return error.statusCode === 503 && error.code === "AI_LAB_EXTERNAL_PROCESSING_NOT_APPROVED";
  });
});

test("Anthropic-adapter handhever éin aktiv jobb og prosesslokal timekvote", async function () {
  var config = configModule.readConfig(validEnv({ AI_LAB_ANTHROPIC_CALLS_PER_HOUR: "1" }));
  var release;
  var provider = anthropicModule.createAnthropicProvider(config, {
    fetchImpl: function () {
      return new Promise(function (resolve) { release = resolve; });
    },
  });
  var first = provider.generateDraft({ system: "S", user: "U" }, {});
  await assert.rejects(provider.generateDraft({ system: "S", user: "U" }, {}), function (error) {
    return error.code === "AI_LAB_ANTHROPIC_BUSY" && error.statusCode === 429;
  });
  release(new Response(JSON.stringify({ content: [{ type: "tool_use", name: "return_learning_draft", input: {} }] }), { status: 200 }));
  assert.deepEqual(await first, {});
  await assert.rejects(provider.generateDraft({ system: "S", user: "U" }, {}), function (error) {
    return error.code === "AI_LAB_ANTHROPIC_RATE_LIMITED" && error.statusCode === 429;
  });
});

test("lokal HTTP-server krev korrekt Host, Origin, token og JSON", async function (t) {
  var bridgeOrigin = "https://vibeverk.no";
  var config = configModule.readConfig(validEnv({ AI_LAB_PORT: "0", ARCTIC_BRIDGE_ALLOWED_ORIGIN: bridgeOrigin }), { allowEphemeralPort: true, execArgv: [] });
  var auditEvents = [];
  var workflow = {
    getConfig: function () { return { apiVersion: "v1", scenarios: [], sources: [], providers: [{ id: "ollama", model: "gemma-test", processing: "local" }] }; },
    describeSnapshot: function () { return { snapshotHash: "a".repeat(64), sources: [{ id: "safe-changes" }] }; },
    createSnapshot: function () { return { id: "snapshot-test" }; },
    disposeSnapshot: function () { return true; },
    createContext: function (body) { return { id: "context-test", kind: body.kind, contextHash: "d".repeat(64), sources: [] }; },
    describeContext: function () { return { id: "context-test", kind: "none", contextHash: "d".repeat(64), sources: [] }; },
    disposeContext: function () { return true; },
    waitForProviderIdle: async function (providerId) { return { provider: providerId, idle: true }; },
    runOperation: async function (contextId, operation, messages, options) {
      assert.equal(auditEvents[auditEvents.length - 1].result, "requested");
      options.onDelta("Hei");
      return { finishReason: "stop", usage: { completion_tokens: 1 }, provider: { durationMs: 7 } };
    },
    runDraft: async function () { return { ok: true }; },
    runGemmaReview: async function () { return { ok: true }; },
  };
  var app = serverModule.createAiLabServer(config, {
    workflow: workflow,
    csrfToken: "csrf-test",
    verifyArcticAccess: async function () { return { ok: true, userId: "superadmin-test", role: "superadmin" }; },
    arcticRuntime: {
      bootstrap: function () { return { schemaVersion: "arctic-bootstrap-v1", connection: { status: "connected" } }; },
      overview: async function () { return { schemaVersion: "arctic-overview-v1", overallStatus: "ok" }; },
      services: async function () { return { schemaVersion: "arctic-services-v1", items: [] }; },
      sessions: function () { return { schemaVersion: "arctic-sessions-v1", items: [] }; },
      executeCommand: async function (input, operatorId) {
        return { schemaVersion: "arctic-command-result-v1", commandId: input, operatorId: operatorId, status: "completed" };
      },
      auditAiEvent: function (fields) { auditEvents.push(fields); },
    },
  });
  await new Promise(function (resolve) { app.server.listen(0, "127.0.0.1", resolve); });
  t.after(function () { app.server.close(); });
  config.port = app.server.address().port;
  var base = "http://127.0.0.1:" + config.port;

  var bridgeNonce = "n".repeat(43);
  var response = await fetch(base + "/__arctic/v1/bridge-info", {
    headers: { Host: "127.0.0.1:" + config.port, Origin: bridgeOrigin, "X-Arctic-Bridge-Nonce": bridgeNonce },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), bridgeOrigin);
  var bridgeInfo = await response.json();
  assert.equal(bridgeInfo.schemaVersion, "arctic-bridge-info-v1");
  assert.equal(bridgeInfo.proof, serverModule.bridgeProof(config.accessToken, bridgeOrigin, bridgeNonce));

  response = await fetch(base + "/__arctic/v1/bridge-info", {
    headers: { Host: "127.0.0.1:" + config.port, Origin: "https://evil.example", "X-Arctic-Bridge-Nonce": bridgeNonce },
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);

  response = await fetch(base + "/__ai-lab/v1/config", {
    method: "OPTIONS",
    headers: { Host: "127.0.0.1:" + config.port, Origin: bridgeOrigin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), bridgeOrigin);

  response = await fetch(base + "/__arctic/v1/bootstrap", {
    headers: { Host: "127.0.0.1:" + config.port, Origin: bridgeOrigin, Authorization: "Bearer console-jwt" },
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);

  response = await fetch(base + "/__ai-lab/v1/config", { headers: { Host: "127.0.0.1:" + config.port } });
  assert.equal(response.status, 401);

  response = await fetch(base + "/__ai-lab/v1/config", {
    headers: { Host: "127.0.0.1:" + config.port, Authorization: "Bearer console-jwt" },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).csrfToken, "csrf-test");

  response = await fetch(base + "/__ai-lab/v1/config", {
    headers: { Host: "127.0.0.1:" + config.port, Origin: bridgeOrigin, Authorization: "Bearer console-jwt" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), bridgeOrigin);

  response = await fetch(base + "/__ai-lab/v1/snapshots", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 201);

  response = await fetch(base + "/__ai-lab/v1/contexts", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "none" }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, "context-test");

  response = await fetch(base + "/__ai-lab/v1/contexts", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: bridgeOrigin, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "none" }),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), bridgeOrigin);

  response = await fetch(base + "/__ai-lab/v1/stream", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "chat", provider: "ollama", contextId: "context-test", messages: [{ role: "user", content: "Hei" }] }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  var frames = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.deepEqual(frames.map(function (frame) { return frame.type; }), ["meta", "delta", "complete"]);
  assert.equal(Object.prototype.hasOwnProperty.call(frames[0].context, "id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(frames[0].context, "contextHash"), false);
  assert.equal(frames[1].text, "Hei");
  assert.deepEqual(auditEvents.slice(-2).map(function (event) { return event.result; }), ["requested", "completed"]);

  response = await fetch(base + "/__ai-lab/v1/contexts/dispose", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: JSON.stringify({ contextId: "context-test" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).disposed, true);

  response = await fetch(base + "/__ai-lab/v1/provider-idle", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "ollama" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { provider: "ollama", idle: true });

  response = await fetch(base + "/__ai-lab/v1/snapshots/dispose", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: JSON.stringify({ snapshotId: "snapshot-test" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).disposed, true);

  response = await fetch(base + "/__ai-lab/v1/snapshots", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer console-jwt", "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 401);

  response = await fetch(base + "/__ai-lab/v1/snapshots", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);

  response = await fetch(base + "/__ai-lab/v1/snapshots", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "feil", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);

  response = await fetch(base + "/__ai-lab/v1/snapshots", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "text/plain" },
    body: "{}",
  });
  assert.equal(response.status, 415);

  response = await fetch(base + "/__arctic/v1/bootstrap", {
    headers: { Host: "127.0.0.1:" + config.port },
  });
  assert.equal(response.status, 401);

  response = await fetch(base + "/__arctic/v1/bootstrap", {
    headers: { Host: "127.0.0.1:" + config.port, Authorization: "Bearer console-jwt" },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).schemaVersion, "arctic-bootstrap-v1");

  response = await fetch(base + "/__arctic/v1/commands", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: JSON.stringify({ input: "health", extra: true }),
  });
  assert.equal(response.status, 400);

  response = await fetch(base + "/__arctic/v1/commands", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: JSON.stringify({ input: "health" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).operatorId, "superadmin-test");

  assert.equal(await rawHttpStatus(config.port, "evil.example", "/__ai-lab/v1/config"), 403);
});

test("HTTP-laget lek ikkje avkorta-kontekst-feilen som generisk intern feil", async function (t) {
  var config = configModule.readConfig(validEnv({ AI_LAB_PORT: "0" }), { allowEphemeralPort: true, execArgv: [] });
  var truncatedError = new Error("Ollama-svaret vart avkorta av kontekstvinduet.");
  truncatedError.statusCode = 502;
  truncatedError.code = "AI_LAB_TRUNCATED_RESPONSE";
  var workflow = {
    getConfig: function () { return { apiVersion: "v1", scenarios: [], sources: [], providers: [] }; },
    describeSnapshot: function () { return { snapshotHash: "b".repeat(64), sources: [{ id: "safe-changes" }] }; },
    createSnapshot: function () { return { id: "snapshot-test" }; },
    runDraft: async function () { throw truncatedError; },
    runGemmaReview: async function () { return { ok: true }; },
  };
  var app = serverModule.createAiLabServer(config, {
    workflow: workflow,
    csrfToken: "csrf-test",
    verifyArcticAccess: async function () { return { ok: true, userId: "superadmin-test", role: "superadmin" }; },
    arcticRuntime: {
      auditAiEvent: function () {},
    },
  });
  await new Promise(function (resolve) { app.server.listen(0, "127.0.0.1", resolve); });
  t.after(function () { app.server.close(); });
  config.port = app.server.address().port;
  var base = "http://127.0.0.1:" + config.port;

  var response = await fetch(base + "/__ai-lab/v1/run", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer console-jwt", "X-Arctic-Access-Token": config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: JSON.stringify({ snapshotId: "snapshot-test", provider: "ollama" }),
  });
  var body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.error.code, "AI_LAB_TRUNCATED_RESPONSE");
  assert.match(body.error.message, /avkorta av kontekstvinduet/);
  assert.notEqual(body.error.code, "AI_LAB_INTERNAL_ERROR");
});

test("statisk utviklingsserver blokkerer skjulte og sensitive stiar", function (t) {
  var temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lab-static-"));
  t.after(function () { fs.rmSync(temp, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(temp, "index.html"), "ok");
  fs.mkdirSync(path.join(temp, "scripts"));
  fs.writeFileSync(path.join(temp, "scripts", "secret.txt"), "secret");
  assert.equal(serverModule.resolveStaticFile(temp, "/"), path.join(temp, "index.html"));
  assert.throws(function () { serverModule.resolveStaticFile(temp, "/scripts/secret.txt"); }, /ikkje tilgjengeleg/);
  assert.throws(function () { serverModule.resolveStaticFile(temp, "/.env"); }, /ikkje tilgjengeleg/);
  // Regresjon: denylista må vere store/små bokstavar-uavhengig, elles kan han
  // omgåast på case-insensitive filsystem (macOS/Windows) med t.d. /SCRIPTS/.
  assert.throws(function () { serverModule.resolveStaticFile(temp, "/SCRIPTS/secret.txt"); }, /ikkje tilgjengeleg/);
  assert.throws(function () { serverModule.resolveStaticFile(temp, "/Scripts/secret.txt"); }, /ikkje tilgjengeleg/);
});
