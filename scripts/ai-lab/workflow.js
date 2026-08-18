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
var MAX_IMAGE_BYTES = 2 * 1024 * 1024;
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

  function readImageDimensions(bytes, mimeType) {
    var offset;
    if (mimeType === "image/png") {
      if (bytes.length < 24 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mimeType === "image/jpeg") {
      offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 255) { offset += 1; continue; }
        var marker = bytes[offset + 1];
        if (marker === 216 || marker === 217 || marker === 1) { offset += 2; continue; }
        if (offset + 4 > bytes.length) return null;
        var segmentLength = bytes.readUInt16BE(offset + 2);
        if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) return null;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].indexOf(marker) !== -1) {
          return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
        }
        offset += 2 + segmentLength;
      }
      return null;
    }
    if (mimeType === "image/webp" && bytes.length >= 30) {
      var chunk = bytes.subarray(12, 16).toString("ascii");
      if (chunk === "VP8X") {
        return {
          width: 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536,
          height: 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536,
        };
      }
      if (chunk === "VP8L" && bytes[20] === 47 && bytes.length >= 25) {
        return {
          width: 1 + bytes[21] + ((bytes[22] & 63) << 8),
          height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10),
        };
      }
      if (chunk === "VP8 " && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
        return { width: bytes.readUInt16LE(26) & 16383, height: bytes.readUInt16LE(28) & 16383 };
      }
    }
    return null;
  }

  function normalizeImage(image) {
    if (image == null) return null;
    if (!image || typeof image !== "object" || Array.isArray(image) ||
        Object.keys(image).some(function (key) { return ["mimeType", "data"].indexOf(key) === -1; }) ||
        ["image/jpeg", "image/png", "image/webp"].indexOf(image.mimeType) === -1 ||
        typeof image.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
      throw workflowError("Bildevedlegget har ugyldig format.");
    }
    var bytes = Buffer.from(image.data, "base64");
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw workflowError("Bildet må være mindre enn 2 MB.", 413);
    var validMagic = image.mimeType === "image/png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      image.mimeType === "image/jpeg" && bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ||
      image.mimeType === "image/webp" && bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!validMagic) throw workflowError("Bildeinnholdet samsvarer ikke med filtypen.");
    var dimensions = readImageDimensions(bytes, image.mimeType);
    if (!dimensions || !dimensions.width || !dimensions.height) throw workflowError("Bildets dimensjoner kunne ikke valideres.");
    if (dimensions.width > 16384 || dimensions.height > 16384 || dimensions.width * dimensions.height > 40000000) {
      throw workflowError("Bildet har for store dimensjoner (maks 40 megapiksler).", 413);
    }
    return { mimeType: image.mimeType, dataUrl: "data:" + image.mimeType + ";base64," + image.data };
  }

  async function runOperation(contextId, operation, messages, streamOptions, ownerId, image) {
    if (OPERATIONS.indexOf(operation) === -1) throw workflowError("Ukjent AI Lab-operasjon.");
    var history = normalizeHistory(messages);
    var entry = acquireContext(contextId, ownerId);
    try {
      if (operation !== "chat" && entry.context.kind === "none") {
        throw workflowError("Denne analysehandlingen krever innlimt tekst eller eksplisitt valgte kilder.");
      }
      var promptMessages = prompts.buildOperationMessages(operation, entry.context, history);
      var normalizedImage = normalizeImage(image);
      if (normalizedImage) {
        var last = promptMessages[promptMessages.length - 1];
        last.content = [
          { type: "text", text: last.content },
          { type: "image_url", image_url: { url: normalizedImage.dataUrl } },
        ];
      }
      var started = performanceNow();
      var reasoningEffort = streamOptions && streamOptions.reasoningEffort;
      if (reasoningEffort == null) reasoningEffort = operation === "analyze-text" ? "low" : "none";
      if (["none", "low"].indexOf(reasoningEffort) === -1) throw workflowError("Ugyldig svarmodus.");
      var providerOptions = Object.assign({}, streamOptions || {}, { reasoningEffort: reasoningEffort });
      var result = await ollama.streamOperation(promptMessages, providerOptions);
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

  async function waitForProviderIdle(providerId, timeoutMs) {
    if (providerId !== "ollama") throw workflowError("Ukjent AI Lab-provider.");
    if (!ollama || typeof ollama.waitUntilIdle !== "function") {
      throw workflowError("Provideren støtter ikke oppryddingskontroll.", 503);
    }
    await ollama.waitUntilIdle(timeoutMs);
    return { provider: providerId, idle: true };
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
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some(function (key) { return ["scenarioId", "sourceIds", "instruction", "pastedText", "pastedLabel"].indexOf(key) === -1; })) {
      throw workflowError("Snapshotforespørselen har ugyldig format.");
    }
    var snapshot = sourceModule.createSnapshot(
      config.repoRoot,
      input && input.scenarioId,
      input && input.sourceIds,
      input && input.instruction,
      false,
      input && input.pastedText,
      input && input.pastedLabel
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
    waitForProviderIdle: waitForProviderIdle,
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
            capabilities: { chat: true, streaming: true, vision: true, documentAnalysis: true, codeAnalysis: true, fileAccess: false, codeChanges: false, tools: false },
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
