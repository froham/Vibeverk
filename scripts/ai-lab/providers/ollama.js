"use strict";

var localClient = require("../../local-ai-client");

function providerError(message, statusCode, code) {
  var error = new Error(message);
  error.statusCode = statusCode || 502;
  error.code = code || "AI_LAB_PROVIDER_ERROR";
  return error;
}

function parseStrictJson(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw providerError("Ollama gav eit tomt svar.", 502, "AI_LAB_EMPTY_RESPONSE");
  var trimmed = raw.trim();
  if (trimmed.startsWith("```") || trimmed.endsWith("```")) {
    throw providerError("Ollama gav kodegjerde i staden for rein JSON.", 422, "AI_LAB_INVALID_JSON");
  }
  var parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw providerError("Ollama gav ugyldig JSON.", 422, "AI_LAB_INVALID_JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw providerError("Ollama gav eit ugyldig JSON-objekt.", 422, "AI_LAB_INVALID_JSON");
  }
  return parsed;
}

function createOllamaProvider(config, options) {
  options = options || {};
  var sendPrompt = options.sendPrompt || localClient.sendPrompt;
  var sendMessagesStream = options.sendMessagesStream || localClient.sendMessagesStream;
  var busy = false;
  var idleWaiters = [];

  function releaseBusy() {
    busy = false;
    var waiters = idleWaiters.slice();
    idleWaiters = [];
    waiters.forEach(function (resolve) { resolve(); });
  }

  function waitUntilIdle(timeoutMs) {
    if (!busy) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timeout = setTimeout(function () {
        if (settled) return;
        settled = true;
        idleWaiters = idleWaiters.filter(function (waiter) { return waiter !== onIdle; });
        reject(providerError("Gemma brukte for lang tid på å avslutte det avbrutte kallet.", 504, "AI_LAB_PROVIDER_CLEANUP_TIMEOUT"));
      }, timeoutMs);
      function onIdle() {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      }
      idleWaiters.push(onIdle);
    });
  }

  async function generateDraft(prompt, schema) {
    if (busy) throw providerError("Lokal AI er opptatt med eit anna kall.", 429, "AI_LAB_OLLAMA_BUSY");
    busy = true;
    try {
      var raw;
      try {
        raw = await sendPrompt(prompt.system + "\n\n" + prompt.user, {
          env: {
            NODE_ENV: "development",
            AI_PROVIDER: "ollama",
            AI_MODEL: config.ollamaModel,
            AI_BASE_URL: config.ollamaBaseUrl + "/v1",
            CI: "",
            VERCEL: "",
            VERCEL_ENV: "",
            NODE_USE_ENV_PROXY: "",
            NODE_OPTIONS: "",
          },
          fetchImpl: options.fetchImpl,
          timeoutMs: config.timeoutMs,
          maxPromptLength: config.maxPromptChars,
          responseFormat: {
            type: "json_schema",
            json_schema: {
              name: "learning_draft",
              strict: true,
              schema: schema,
            },
          },
          temperature: 0,
          reasoningEffort: "none",
        });
      } catch (error) {
        if (error && error.code === "AI_LAB_OLLAMA_BUSY") throw error;
        if (error && error.code === "LOCAL_AI_OUTPUT_TRUNCATED") {
          throw providerError(
            "Ollama-svaret vart avkorta av kontekstvinduet.",
            502,
            "AI_LAB_TRUNCATED_RESPONSE"
          );
        }
        throw providerError(
          error && /svarte ikkje innan/.test(error.message)
            ? "Ollama nådde tidsgrensa."
            : "Ollama-kallet feila.",
          502,
          error && /svarte ikkje innan/.test(error.message) ? "AI_LAB_TIMEOUT" : "AI_LAB_PROVIDER_ERROR"
        );
      }
      return parseStrictJson(raw);
    } finally { releaseBusy(); }
  }

  async function streamOperation(messages, streamOptions) {
    if (busy) throw providerError("Lokal AI er opptatt med et annet kall.", 429, "AI_LAB_OLLAMA_BUSY");
    busy = true;
    try {
      return await sendMessagesStream(messages, {
        env: {
          NODE_ENV: "development", AI_PROVIDER: "ollama", AI_MODEL: config.ollamaModel,
          AI_BASE_URL: config.ollamaBaseUrl + "/v1", CI: "", VERCEL: "", VERCEL_ENV: "",
          NODE_USE_ENV_PROXY: "", NODE_OPTIONS: "",
        },
        fetchImpl: options.fetchImpl,
        timeoutMs: config.timeoutMs,
        maxPromptLength: config.maxPromptChars,
        signal: streamOptions && streamOptions.signal,
        onDelta: streamOptions && streamOptions.onDelta,
        reasoningEffort: streamOptions && streamOptions.reasoningEffort,
      });
    } catch (error) {
      if (error && error.code === "LOCAL_AI_ABORTED") throw providerError("Kjøringen ble avbrutt.", 499, "AI_LAB_CANCELLED");
      if (error && error.code === "LOCAL_AI_RESPONSE_TOO_LARGE") throw providerError("Ollama-svaret var for stort.", 502, "AI_LAB_RESPONSE_TOO_LARGE");
      if (error && /svarte ikkje innan/.test(error.message)) throw providerError("Ollama nådde tidsgrensen.", 504, "AI_LAB_TIMEOUT");
      if (error && error.code && error.code.indexOf("AI_LAB_") === 0) throw error;
      throw providerError("Ollama-kallet feilet.", 502, "AI_LAB_PROVIDER_ERROR");
    } finally { releaseBusy(); }
  }

  return {
    id: "ollama",
    model: config.ollamaModel,
    generateDraft: generateDraft,
    streamOperation: streamOperation,
    waitUntilIdle: waitUntilIdle,
    isBusy: function () { return busy; },
  };
}

module.exports = {
  createOllamaProvider: createOllamaProvider,
  parseStrictJson: parseStrictJson,
};
