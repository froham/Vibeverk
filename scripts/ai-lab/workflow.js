"use strict";

var crypto = require("node:crypto");
var perfHooks = require("node:perf_hooks");
var prompts = require("./prompts");
var contextModule = require("./context");
var schemas = require("./schemas");
var sensitive = require("./sensitive");
var sourceModule = require("./sources");
var ollamaModule = require("./providers/ollama");
var anthropicModule = require("./providers/anthropic");

var MAX_SNAPSHOTS = 20;
var MAX_CONTEXTS = 20;
var MAX_RESOURCES_PER_OWNER = 5;
var MAX_HISTORY_MESSAGES = 20;
var MAX_HISTORY_CHARS = 24000;
var OPERATIONS = ["chat", "analyze-text", "summarize", "rewrite"];

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
  var setTimer = options.setTimer || setTimeout;
  var clearTimer = options.clearTimer || clearTimeout;
  var snapshots = new Map();
  var contexts = new Map();

  function assertOwner(entry, ownerId) {
    if (typeof ownerId === "string" && entry.ownerId !== ownerId) {
      throw workflowError("Ressursen finnes ikke eller har gått ut.", 410, "AI_LAB_RESOURCE_EXPIRED");
    }
  }

  function disposeSnapshot(id, ownerId) {
    var entry = snapshots.get(id);
    if (!entry) return;
    assertOwner(entry, ownerId);
    entry.expired = true;
    if (entry.activeCount > 0) return;
    if (entry.timer) clearTimer(entry.timer);
    (entry.snapshot.sources || []).forEach(function (source) {
      if (Buffer.isBuffer(source.bytes)) source.bytes.fill(0);
      source.bytes = null;
      source.text = "";
    });
    entry.snapshot.instruction = "";
    snapshots.delete(id);
  }

  function expireSnapshot(id) {
    var entry = snapshots.get(id);
    if (!entry) return;
    entry.timer = null;
    disposeSnapshot(id);
  }

  function cleanupSnapshots(ownerId) {
    var current = now();
    snapshots.forEach(function (entry, id) {
      if (entry.expiresAt <= current) disposeSnapshot(id);
    });
    function ownedSnapshotCount() {
      return Array.from(snapshots.values()).filter(function (entry) { return entry.ownerId === ownerId; }).length;
    }
    while (typeof ownerId === "string" && (snapshots.size >= MAX_SNAPSHOTS || ownedSnapshotCount() >= MAX_RESOURCES_PER_OWNER)) {
      var disposableId = Array.from(snapshots.entries()).filter(function (pair) {
        return pair[1].activeCount === 0 && pair[1].ownerId === ownerId;
      }).map(function (pair) { return pair[0]; })[0];
      if (!disposableId) throw workflowError("For mange aktive læringssnapshot. Tøm en egen arbeidsflate eller vent til en kjøring er ferdig.", 429, "AI_LAB_SNAPSHOT_LIMIT");
      disposeSnapshot(disposableId);
    }
  }

  function disposeContext(id, ownerId) {
    var entry = contexts.get(id);
    if (!entry) return false;
    assertOwner(entry, ownerId);
    entry.expired = true;
    if (entry.activeCount > 0) return true;
    if (entry.timer) clearTimer(entry.timer);
    contextModule.disposeContent(entry.context);
    contexts.delete(id);
    return true;
  }

  function cleanupContexts(ownerId) {
    var current = now();
    contexts.forEach(function (entry, id) { if (entry.expiresAt <= current) disposeContext(id); });
    function ownedContextCount() {
      return Array.from(contexts.values()).filter(function (entry) { return entry.ownerId === ownerId; }).length;
    }
    while (typeof ownerId === "string" && (contexts.size >= MAX_CONTEXTS || ownedContextCount() >= MAX_RESOURCES_PER_OWNER)) {
      var id = Array.from(contexts.entries()).filter(function (pair) { return pair[1].activeCount === 0; })
        .filter(function (pair) { return pair[1].ownerId === ownerId; })
        .map(function (pair) { return pair[0]; })[0];
      if (!id) throw workflowError("For mange aktive kontekster. Vent til en kjøring er ferdig.", 429, "AI_LAB_CONTEXT_LIMIT");
      disposeContext(id);
    }
  }

  function createContext(input, ownerId) {
    cleanupContexts(ownerId);
    var context = contextModule.createContext(config.repoRoot, input);
    var id = crypto.randomUUID();
    var expiresAt = now() + config.snapshotTtlMs;
    var timer = setTimer(function () { var entry = contexts.get(id); if (entry) { entry.timer = null; disposeContext(id); } }, config.snapshotTtlMs);
    if (timer && typeof timer.unref === "function") timer.unref();
    contexts.set(id, { context: context, ownerId: ownerId, expiresAt: expiresAt, timer: timer, activeCount: 0, expired: false });
    return contextModule.publicContext(id, context, expiresAt);
  }

  function getContext(id, ownerId) {
    cleanupContexts();
    if (typeof id !== "string" || !id) throw workflowError("Mangler kontekst-ID.");
    var entry = contexts.get(id);
    if (!entry || entry.expired || entry.expiresAt <= now()) {
      if (entry) disposeContext(id);
      throw workflowError("Konteksten finnes ikke eller har gått ut.", 410, "AI_LAB_CONTEXT_EXPIRED");
    }
    assertOwner(entry, ownerId);
    return entry;
  }

  function acquireContext(id, ownerId) { var entry = getContext(id, ownerId); entry.activeCount += 1; return entry; }
  function releaseContext(id, entry) {
    entry.activeCount = Math.max(0, entry.activeCount - 1);
    if (entry.expired || entry.expiresAt <= now()) disposeContext(id);
  }

  function normalizeHistory(messages) {
    if (!Array.isArray(messages) || !messages.length || messages.length > MAX_HISTORY_MESSAGES) {
      throw workflowError("Samtalen må inneholde mellom 1 og " + MAX_HISTORY_MESSAGES + " meldinger.");
    }
    var total = 0;
    var normalized = messages.map(function (message, index) {
      if (!message || typeof message !== "object" || Array.isArray(message) ||
          Object.keys(message).some(function (key) { return ["role", "content"].indexOf(key) === -1; }) ||
          ["user", "assistant"].indexOf(message.role) === -1 || typeof message.content !== "string" || !message.content.trim()) {
        throw workflowError("Melding " + (index + 1) + " har ugyldig format.");
      }
      if (message.role !== (index % 2 === 0 ? "user" : "assistant")) {
        throw workflowError("Samtalen må veksle mellom bruker og assistent.");
      }
      if (index === messages.length - 1 && message.role !== "user") throw workflowError("Siste melding må være fra brukeren.");
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message.content)) throw workflowError("En melding inneholder ugyldige kontrolltegn.");
      total += message.content.length;
      return { role: message.role, content: message.content.trim() };
    });
    if (total > MAX_HISTORY_CHARS) throw workflowError("Samtalehistorikken er for lang (maks " + MAX_HISTORY_CHARS + " tegn).", 413);
    return normalized;
  }

  async function runOperation(contextId, operation, messages, streamOptions, ownerId) {
    if (OPERATIONS.indexOf(operation) === -1) throw workflowError("Ukjent AI Lab-operasjon.");
    var history = normalizeHistory(messages);
    var entry = acquireContext(contextId, ownerId);
    try {
      if (operation !== "chat" && entry.context.kind === "none") {
        throw workflowError("Denne analysehandlingen krever innlimt tekst eller eksplisitt valgte kilder.");
      }
      var promptMessages = prompts.buildOperationMessages(operation, entry.context, history);
      var started = performanceNow();
      var result = await ollama.streamOperation(promptMessages, streamOptions || {});
      return {
        schemaVersion: "ai-lab-stream-result-v1",
        operation: operation,
        context: contextModule.publicContext(contextId, entry.context, entry.expiresAt),
        provider: { id: ollama.id, model: ollama.model, durationMs: Math.max(0, Math.round(performanceNow() - started)) },
        finishReason: result.finishReason,
        usage: result.usage || null,
      };
    } finally { releaseContext(contextId, entry); }
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

  function createSnapshot(input, ownerId) {
    cleanupSnapshots(ownerId);
    var snapshot = sourceModule.createSnapshot(
      config.repoRoot,
      input && input.scenarioId,
      input && input.sourceIds,
      input && input.instruction,
      false
    );
    var id = crypto.randomUUID();
    var expiresAt = now() + config.snapshotTtlMs;
    var timer = setTimer(function () { expireSnapshot(id); }, config.snapshotTtlMs);
    if (timer && typeof timer.unref === "function") timer.unref();
    snapshots.set(id, { snapshot: snapshot, ownerId: ownerId, expiresAt: expiresAt, timer: timer, activeCount: 0, expired: false });
    return publicSnapshot(id, snapshot, expiresAt);
  }

  function getSnapshot(id, ownerId) {
    cleanupSnapshots();
    if (typeof id !== "string" || !id) throw workflowError("Mangler snapshot-ID.");
    var entry = snapshots.get(id);
    if (!entry || entry.expired || entry.expiresAt <= now()) {
      if (entry) disposeSnapshot(id);
      throw workflowError("Snapshotet finst ikkje eller har gått ut.", 410, "AI_LAB_SNAPSHOT_EXPIRED");
    }
    assertOwner(entry, ownerId);
    return entry;
  }

  function acquireSnapshot(id, ownerId) {
    var entry = getSnapshot(id, ownerId);
    entry.activeCount += 1;
    return entry;
  }

  function releaseSnapshot(id, entry) {
    entry.activeCount = Math.max(0, entry.activeCount - 1);
    if (entry.expired || entry.expiresAt <= now()) disposeSnapshot(id);
  }

  function assertAnthropicSources(snapshot, additionalText) {
    snapshot.sources.forEach(function (source) {
      if (!source.anthropicAllowed) throw workflowError("Snapshotet inneheld ei kjelde som ikkje kan sendast til Anthropic.", 403);
    });
    if (sensitive.snapshotContainsKnownSecret(snapshot, additionalText)) {
      throw workflowError(
        "Ekstern behandling ble blokkert fordi innholdet kan inneholde en hemmelighet. Fjern verdien og opprett et nytt snapshot.",
        422,
        "AI_LAB_SENSITIVE_CONTENT"
      );
    }
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

  async function runDraft(snapshotId, providerId, ownerId) {
    var entry = acquireSnapshot(snapshotId, ownerId);
    try {
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
    } finally { releaseSnapshot(snapshotId, entry); }
  }

  async function runGemmaReview(snapshotId, ownerId) {
    var entry = acquireSnapshot(snapshotId, ownerId);
    try {
      var snapshot = entry.snapshot;
      assertAnthropicSources(snapshot);
      var gemmaResult = await timedCall(ollama, function () {
        return ollama.generateDraft(prompts.buildDraftPrompt(snapshot), schemas.learningDraftSchema(snapshot));
      });
      var draft = schemas.validateLearningDraft(gemmaResult.output, snapshot);
      assertAnthropicSources(snapshot, JSON.stringify(draft));
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
    } finally { releaseSnapshot(snapshotId, entry); }
  }

  return {
    createSnapshot: createSnapshot,
    disposeSnapshot: function (snapshotId, ownerId) {
      if (typeof snapshotId !== "string" || !snapshotId) throw workflowError("Mangler snapshot-ID.");
      var existed = snapshots.has(snapshotId);
      disposeSnapshot(snapshotId, ownerId);
      return existed;
    },
    describeSnapshot: function (snapshotId, ownerId) {
      var entry = getSnapshot(snapshotId, ownerId);
      return publicSnapshot(snapshotId, entry.snapshot, entry.expiresAt);
    },
    createContext: createContext,
    describeContext: function (contextId, ownerId) {
      var entry = getContext(contextId, ownerId);
      return contextModule.publicContext(contextId, entry.context, entry.expiresAt);
    },
    disposeContext: disposeContext,
    runOperation: runOperation,
    getConfig: function () {
      return {
        schemaVersion: "ai-lab-config-v2",
        apiVersion: "v1",
        operations: [
          { id: "chat", label: "Samtale", mode: "chat", streaming: true, contextKinds: ["none", "pasted-text", "selected-sources"] },
          { id: "analyze-text", label: "Analyse", mode: "analyze", streaming: true, contextKinds: ["pasted-text", "selected-sources"] },
          { id: "summarize", label: "Oppsummer", mode: "analyze", streaming: true, contextKinds: ["pasted-text", "selected-sources"] },
          { id: "rewrite", label: "Skriv om", mode: "analyze", streaming: true, contextKinds: ["pasted-text", "selected-sources"] },
          { id: "learning-draft", label: "Læringsutkast", mode: "learning", streaming: false, contextKinds: ["selected-sources"] },
          { id: "learning-review", label: "Kvalitetsvurdering", mode: "learning", streaming: false, contextKinds: ["selected-sources"] },
        ],
        scenarios: [{ id: "learning-module", label: "Læringsmodulen" }],
        sources: sourceModule.publicSources(config.repoRoot),
        providers: [
          {
            id: "ollama", label: "Lokal Ollama", model: ollama.model, configured: true,
            processing: "local",
            capabilities: { chat: true, streaming: true, documentAnalysis: true, codeAnalysis: true, fileAccess: false, codeChanges: false, tools: false },
            operations: ["chat", "analyze-text", "summarize", "rewrite", "learning-draft"], reasonCode: null,
          },
          {
            id: "anthropic", label: "Claude / Anthropic", model: anthropic.model, configured: !!anthropic.configured,
            processing: "external",
            capabilities: { chat: false, streaming: false, documentAnalysis: true, codeAnalysis: true, fileAccess: false, codeChanges: false, tools: false },
            operations: anthropic.configured ? ["learning-draft", "learning-review"] : [],
            reasonCode: anthropic.configured ? null
              : config.anthropicApiKey && !config.anthropicProcessingApproved
                ? "external_processing_not_approved"
                : "credentials_not_configured",
          },
          {
            id: "codex", label: "Codex", model: null, configured: false,
            processing: "external",
            capabilities: { chat: false, streaming: false, documentAnalysis: false, codeAnalysis: false, fileAccess: false, codeChanges: false, tools: false },
            operations: [], reasonCode: "gateway_required",
          },
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
