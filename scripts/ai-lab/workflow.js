"use strict";

var crypto = require("node:crypto");
var perfHooks = require("node:perf_hooks");
var prompts = require("./prompts");
var schemas = require("./schemas");
var sourceModule = require("./sources");
var ollamaModule = require("./providers/ollama");
var anthropicModule = require("./providers/anthropic");

var MAX_SNAPSHOTS = 20;

function workflowError(message, statusCode, code) {
  var error = new Error(message);
  error.statusCode = statusCode || 400;
  error.code = code || "AI_LAB_WORKFLOW_ERROR";
  return error;
}

function createWorkflow(config, options) {
  options = options || {};
  var now = options.now || Date.now;
  var performanceNow = options.performanceNow || perfHooks.performance.now.bind(perfHooks.performance);
  var ollama = options.ollamaProvider || ollamaModule.createOllamaProvider(config, options.ollamaOptions);
  var anthropic = options.anthropicProvider || anthropicModule.createAnthropicProvider(config, options.anthropicOptions);
  var snapshots = new Map();

  function cleanupSnapshots() {
    var current = now();
    snapshots.forEach(function (entry, id) {
      if (entry.expiresAt <= current) snapshots.delete(id);
    });
    while (snapshots.size >= MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value);
  }

  function publicSnapshot(id, snapshot, expiresAt) {
    return {
      id: id,
      scenarioId: snapshot.scenarioId,
      snapshotHash: snapshot.hash,
      promptVersion: snapshot.promptVersion,
      schemaVersion: snapshot.schemaVersion,
      expiresAt: new Date(expiresAt).toISOString(),
      sources: snapshot.sources.map(function (source) {
        return { id: source.id, path: source.path, lineCount: source.lineCount };
      }),
    };
  }

  function createSnapshot(input) {
    cleanupSnapshots();
    var snapshot = sourceModule.createSnapshot(
      config.repoRoot,
      input && input.scenarioId,
      input && input.sourceIds,
      input && input.instruction,
      false
    );
    var id = crypto.randomUUID();
    var expiresAt = now() + config.snapshotTtlMs;
    snapshots.set(id, { snapshot: snapshot, expiresAt: expiresAt });
    return publicSnapshot(id, snapshot, expiresAt);
  }

  function getSnapshot(id) {
    cleanupSnapshots();
    if (typeof id !== "string" || !id) throw workflowError("Mangler snapshot-ID.");
    var entry = snapshots.get(id);
    if (!entry) throw workflowError("Snapshotet finst ikkje eller har gått ut.", 410, "AI_LAB_SNAPSHOT_EXPIRED");
    return entry;
  }

  function assertAnthropicSources(snapshot) {
    snapshot.sources.forEach(function (source) {
      if (!source.anthropicAllowed) throw workflowError("Snapshotet inneheld ei kjelde som ikkje kan sendast til Anthropic.", 403);
    });
  }

  async function timedCall(provider, operation) {
    var started = performanceNow();
    var output = await operation();
    return {
      output: output,
      provider: provider.id,
      model: provider.model,
      durationMs: Math.max(0, Math.round(performanceNow() - started)),
    };
  }

  async function runDraft(snapshotId, providerId) {
    var entry = getSnapshot(snapshotId);
    var snapshot = entry.snapshot;
    var prompt = prompts.buildDraftPrompt(snapshot);
    var provider;
    if (providerId === "ollama") provider = ollama;
    else if (providerId === "anthropic") {
      assertAnthropicSources(snapshot);
      provider = anthropic;
    } else throw workflowError("Ukjend provider.");

    var result = await timedCall(provider, function () {
      return provider.generateDraft(prompt, schemas.learningDraftSchema(snapshot));
    });
    var draft = schemas.validateLearningDraft(result.output, snapshot);
    return {
      schemaVersion: "ai-lab-result-v1",
      snapshot: publicSnapshot(snapshotId, snapshot, entry.expiresAt),
      provider: { id: result.provider, model: result.model, durationMs: result.durationMs },
      draft: draft,
    };
  }

  async function runGemmaReview(snapshotId) {
    var entry = getSnapshot(snapshotId);
    var snapshot = entry.snapshot;
    assertAnthropicSources(snapshot);
    var gemmaResult = await timedCall(ollama, function () {
      return ollama.generateDraft(prompts.buildDraftPrompt(snapshot), schemas.learningDraftSchema(snapshot));
    });
    var draft = schemas.validateLearningDraft(gemmaResult.output, snapshot);
    var reviewResult = await timedCall(anthropic, function () {
      return anthropic.reviewDraft(prompts.buildReviewPrompt(snapshot, draft), schemas.learningReviewSchema(snapshot, draft));
    });
    var review = schemas.validateLearningReview(reviewResult.output, snapshot, draft);
    return {
      schemaVersion: "ai-lab-review-result-v1",
      snapshot: publicSnapshot(snapshotId, snapshot, entry.expiresAt),
      draftProvider: { id: gemmaResult.provider, model: gemmaResult.model, durationMs: gemmaResult.durationMs },
      reviewProvider: { id: reviewResult.provider, model: reviewResult.model, durationMs: reviewResult.durationMs },
      draft: draft,
      review: review,
    };
  }

  return {
    createSnapshot: createSnapshot,
    getConfig: function () {
      return {
        apiVersion: "v1",
        scenarios: [{ id: "learning-module", label: "Læringsmodulen" }],
        sources: sourceModule.publicSources(),
        providers: [
          { id: "ollama", label: "Lokal Ollama", model: ollama.model, configured: true },
          { id: "anthropic", label: "Anthropic", model: anthropic.model, configured: !!anthropic.configured },
        ],
      };
    },
    runDraft: runDraft,
    runGemmaReview: runGemmaReview,
  };
}

module.exports = {
  createWorkflow: createWorkflow,
};
