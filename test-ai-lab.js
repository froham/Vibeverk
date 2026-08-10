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
});

test("kjelder bruker allowlist, grenser og stabile snapshot-hashar", function () {
  var first = sourceModule.createSnapshot(process.cwd(), "learning-module", ["safe-changes"], "Lag ei kort innføring.", false);
  var second = sourceModule.createSnapshot(process.cwd(), "learning-module", ["safe-changes"], "Lag ei kort innføring.", false);
  assert.equal(first.hash, second.hash);
  assert.equal(first.sources[0].path, "docs/onboarding/safe-changes-guide.md");
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
  var provider = {
    id: "ollama", model: "gemma-test",
    generateDraft: async function () { called = true; return {}; },
  };
  var config = configModule.readConfig(validEnv({ AI_LAB_SNAPSHOT_TTL_MS: "60000" }));
  var workflow = workflowModule.createWorkflow(config, {
    now: function () { return currentTime; },
    ollamaProvider: provider,
    anthropicProvider: { id: "anthropic", model: "haiku-test", configured: true },
  });
  var snapshot = workflow.createSnapshot({ scenarioId: "learning-module", sourceIds: ["safe-changes"], instruction: "Test" });
  currentTime += 60001;
  await assert.rejects(workflow.runDraft(snapshot.id, "ollama"), function (error) {
    return error.statusCode === 410 && error.code === "AI_LAB_SNAPSHOT_EXPIRED";
  });
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
  var config = configModule.readConfig(validEnv({ AI_LAB_PORT: "0" }), { allowEphemeralPort: true, execArgv: [] });
  var workflow = {
    getConfig: function () { return { apiVersion: "v1", scenarios: [], sources: [], providers: [] }; },
    createSnapshot: function () { return { id: "snapshot-test" }; },
    runDraft: async function () { return { ok: true }; },
    runGemmaReview: async function () { return { ok: true }; },
  };
  var app = serverModule.createAiLabServer(config, { workflow: workflow, csrfToken: "csrf-test" });
  await new Promise(function (resolve) { app.server.listen(0, "127.0.0.1", resolve); });
  t.after(function () { app.server.close(); });
  config.port = app.server.address().port;
  var base = "http://127.0.0.1:" + config.port;

  var response = await fetch(base + "/__ai-lab/v1/config", { headers: { Host: "127.0.0.1:" + config.port } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).csrfToken, "csrf-test");

  response = await fetch(base + "/__ai-lab/v1/snapshots", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer " + config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 201);

  response = await fetch(base + "/__ai-lab/v1/snapshots", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 401);

  response = await fetch(base + "/__ai-lab/v1/snapshots", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Authorization: "Bearer " + config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);

  response = await fetch(base + "/__ai-lab/v1/snapshots", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer " + config.accessToken, "X-AI-Lab-Token": "feil", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);

  response = await fetch(base + "/__ai-lab/v1/snapshots", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer " + config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "text/plain" },
    body: "{}",
  });
  assert.equal(response.status, 415);

  assert.equal(await rawHttpStatus(config.port, "evil.example", "/__ai-lab/v1/config"), 403);
});

test("HTTP-laget lek ikkje avkorta-kontekst-feilen som generisk intern feil", async function (t) {
  var config = configModule.readConfig(validEnv({ AI_LAB_PORT: "0" }), { allowEphemeralPort: true, execArgv: [] });
  var truncatedError = new Error("Ollama-svaret vart avkorta av kontekstvinduet.");
  truncatedError.statusCode = 502;
  truncatedError.code = "AI_LAB_TRUNCATED_RESPONSE";
  var workflow = {
    getConfig: function () { return { apiVersion: "v1", scenarios: [], sources: [], providers: [] }; },
    createSnapshot: function () { return { id: "snapshot-test" }; },
    runDraft: async function () { throw truncatedError; },
    runGemmaReview: async function () { return { ok: true }; },
  };
  var app = serverModule.createAiLabServer(config, { workflow: workflow, csrfToken: "csrf-test" });
  await new Promise(function (resolve) { app.server.listen(0, "127.0.0.1", resolve); });
  t.after(function () { app.server.close(); });
  config.port = app.server.address().port;
  var base = "http://127.0.0.1:" + config.port;

  var response = await fetch(base + "/__ai-lab/v1/run", {
    method: "POST",
    headers: { Host: "127.0.0.1:" + config.port, Origin: base, Authorization: "Bearer " + config.accessToken, "X-AI-Lab-Token": "csrf-test", "Content-Type": "application/json" },
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
