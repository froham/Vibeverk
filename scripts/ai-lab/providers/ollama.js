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
  var busy = false;

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
    } finally {
      busy = false;
    }
  }

  return {
    id: "ollama",
    model: config.ollamaModel,
    generateDraft: generateDraft,
    isBusy: function () { return busy; },
  };
}

module.exports = {
  createOllamaProvider: createOllamaProvider,
  parseStrictJson: parseStrictJson,
};
