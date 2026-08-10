"use strict";

var MAX_RESPONSE_BYTES = 1024 * 1024;

function providerError(message, statusCode, code) {
  var error = new Error(message);
  error.statusCode = statusCode || 502;
  error.code = code || "AI_LAB_PROVIDER_ERROR";
  return error;
}

async function readBoundedJson(response) {
  var text;
  if (!response.body || typeof response.body.getReader !== "function") {
    text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw providerError("Anthropic-svaret var for stort.", 502, "AI_LAB_RESPONSE_TOO_LARGE");
    }
  } else {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var parts = [];
    var bytes = 0;
    try {
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          reader.cancel().catch(function () {});
          throw providerError("Anthropic-svaret var for stort.", 502, "AI_LAB_RESPONSE_TOO_LARGE");
        }
        parts.push(decoder.decode(chunk.value, { stream: true }));
      }
      parts.push(decoder.decode());
      text = parts.join("");
    } finally {
      reader.releaseLock();
    }
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    throw providerError("Anthropic gav ugyldig JSON.", 502, "AI_LAB_INVALID_JSON");
  }
}

function createAnthropicProvider(config, options) {
  options = options || {};
  var fetchImpl = options.fetchImpl || globalThis.fetch;
  var now = options.now || Date.now;
  var busy = false;
  var callTimes = [];

  function reserveCall() {
    if (busy) throw providerError("Anthropic er opptatt med eit anna kall.", 429, "AI_LAB_ANTHROPIC_BUSY");
    var cutoff = now() - 60 * 60 * 1000;
    callTimes = callTimes.filter(function (startedAt) { return startedAt > cutoff; });
    if (callTimes.length >= config.anthropicCallsPerHour) {
      throw providerError("Lokal Anthropic-kvote for denne timen er brukt opp.", 429, "AI_LAB_ANTHROPIC_RATE_LIMITED");
    }
    busy = true;
    callTimes.push(now());
  }

  async function callTool(prompt, toolName, description, schema) {
    if (!config.anthropicApiKey) {
      throw providerError("Anthropic er ikkje konfigurert lokalt.", 503, "AI_LAB_PROVIDER_NOT_CONFIGURED");
    }
    reserveCall();
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, config.timeoutMs);
    var response;
    try {
      try {
        response = await fetchImpl(config.anthropicBaseUrl + "/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": config.anthropicApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: config.anthropicModel,
            max_tokens: 8000,
            system: prompt.system,
            messages: [{ role: "user", content: prompt.user }],
            tools: [{ name: toolName, description: description, input_schema: schema }],
            tool_choice: { type: "tool", name: toolName },
          }),
          redirect: "error",
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw providerError("Anthropic nådde tidsgrensa.", 502, "AI_LAB_TIMEOUT");
        throw providerError("Anthropic-kallet feila.", 502, "AI_LAB_PROVIDER_ERROR");
      }
      if (!response.ok) {
        if (response.body && typeof response.body.cancel === "function") response.body.cancel().catch(function () {});
        throw providerError("Anthropic API-feil (HTTP " + response.status + ").", 502, "AI_LAB_PROVIDER_ERROR");
      }
      var data;
      try {
        data = await readBoundedJson(response);
      } catch (error) {
        if (error && error.code === "AI_LAB_RESPONSE_TOO_LARGE") throw error;
        if (error && error.code === "AI_LAB_INVALID_JSON") throw error;
        if (controller.signal.aborted) throw providerError("Anthropic nådde tidsgrensa.", 502, "AI_LAB_TIMEOUT");
        throw providerError("Klarte ikkje å lese Anthropic-svaret.", 502, "AI_LAB_PROVIDER_ERROR");
      }
      var block = data && Array.isArray(data.content) && data.content.find(function (item) {
        return item && item.type === "tool_use" && item.name === toolName;
      });
      if (!block || !block.input) throw providerError("Anthropic gav eit ufullstendig strukturert svar.", 422, "AI_LAB_INVALID_RESPONSE");
      return block.input;
    } finally {
      clearTimeout(timeout);
      busy = false;
    }
  }

  return {
    id: "anthropic",
    model: config.anthropicModel,
    configured: !!config.anthropicApiKey,
    isBusy: function () { return busy; },
    generateDraft: function (prompt, schema) {
      return callTool(prompt, "return_learning_draft", "Returner eit kjeldebasert utkast til Læringsmodulen.", schema);
    },
    reviewDraft: function (prompt, schema) {
      return callTool(prompt, "return_learning_review", "Review Gemma-utkastet mot dei same kjeldene.", schema);
    },
  };
}

module.exports = {
  createAnthropicProvider: createAnthropicProvider,
  readBoundedJson: readBoundedJson,
};
