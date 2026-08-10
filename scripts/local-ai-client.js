"use strict";

var DEFAULT_TIMEOUT_MS = 90000;
var MAX_PROMPT_LENGTH = 20000;
var MAX_RESPONSE_BYTES = 1024 * 1024;
var LITERAL_LOOPBACK_V1_RE = /^http:\/\/127\.0\.0\.1(?::[0-9]{1,5})?\/v1\/?$/;

function hasUseEnvProxyArg(args) {
  return Array.isArray(args) && args.some(function (arg) {
    return arg === "--use-env-proxy" || arg.indexOf("--use-env-proxy=") === 0;
  });
}

function isEnabledEnvFlag(value) {
  var normalized = String(value || "").trim().toLowerCase();
  return !!normalized && ["0", "false", "no", "off"].indexOf(normalized) === -1;
}

function readConfig(env, execArgv) {
  env = env || process.env;
  execArgv = Array.isArray(execArgv) ? execArgv : process.execArgv;

  if (env.NODE_ENV !== "development") {
    throw new Error("Den lokale AI-klienten er sperra utanfor NODE_ENV=development.");
  }
  if (env.CI || env.VERCEL || env.VERCEL_ENV) {
    throw new Error("Den lokale AI-klienten kan ikkje køyrast i CI eller Vercel.");
  }
  if (
    isEnabledEnvFlag(env.NODE_USE_ENV_PROXY) ||
    String(env.NODE_OPTIONS || "").indexOf("--use-env-proxy") !== -1 ||
    hasUseEnvProxyArg(execArgv)
  ) {
    throw new Error("Den lokale AI-klienten kan ikkje køyrast med Node-miljøproxy aktivert.");
  }

  var provider = String(env.AI_PROVIDER || "").trim();
  var model = String(env.AI_MODEL || "").trim();
  var baseUrl = String(env.AI_BASE_URL || "").trim();
  if (!provider) throw new Error("Mangler AI_PROVIDER.");
  if (!model) throw new Error("Mangler AI_MODEL.");
  if (!baseUrl) throw new Error("Mangler AI_BASE_URL.");
  if (provider !== "ollama") {
    throw new Error("AI_PROVIDER må vere `ollama` for den lokale klienten.");
  }
  if (model.length > 200 || /[\x00-\x1F\x7F]/.test(model)) {
    throw new Error("AI_MODEL er ugyldig.");
  }
  if (!LITERAL_LOOPBACK_V1_RE.test(baseUrl)) {
    throw new Error("Lokal AI-URL må vere ei bokstavleg http://127.0.0.1-adresse med /v1.");
  }

  var parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    throw new Error("AI_BASE_URL er ikkje ei gyldig URL.");
  }

  var path = parsed.pathname.replace(/\/+$/, "");
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error("Lokal AI-URL må bruke http://127.0.0.1.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || path !== "/v1") {
    throw new Error("Lokal AI-URL må vere ei rein /v1-adresse utan innlogging, query eller fragment.");
  }

  return {
    provider: provider,
    completionsUrl: parsed.origin + "/v1/chat/completions",
    model: model,
  };
}

function normalizePrompt(prompt, maxLength) {
  maxLength = Number.isInteger(maxLength) && maxLength >= 1000 && maxLength <= 200000
    ? maxLength
    : MAX_PROMPT_LENGTH;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("Prompten må vere ein ikkje-tom tekst.");
  }
  if (prompt.length > maxLength) {
    throw new Error("Prompten er for lang (maks " + maxLength + " teikn).");
  }
  return prompt.trim();
}

function responseTooLargeError() {
  var error = new Error("Ollama-svaret er større enn " + MAX_RESPONSE_BYTES + " byte.");
  error.code = "LOCAL_AI_RESPONSE_TOO_LARGE";
  return error;
}

async function readResponseText(response) {
  if (!response.body || typeof response.body.getReader !== "function") {
    var text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw responseTooLargeError();
    }
    return text;
  }

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
        throw responseTooLargeError();
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    reader.releaseLock();
  }
}

async function sendPrompt(prompt, options) {
  options = options || {};
  var config = readConfig(options.env, options.execArgv);
  var normalizedPrompt = normalizePrompt(prompt, options.maxPromptLength);
  var fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Denne Node-versjonen manglar fetch; bruk Node 20 eller nyare.");
  }

  var timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, timeoutMs);
  var response;
  var rawText;
  var requestBody = {
    model: config.model,
    messages: [{ role: "user", content: normalizedPrompt }],
    stream: false,
  };
  if (options.responseFormat && typeof options.responseFormat === "object") {
    requestBody.response_format = options.responseFormat;
  }
  if (Number.isFinite(options.temperature)) {
    requestBody.temperature = options.temperature;
  }
  if (["none", "low", "medium", "high"].indexOf(options.reasoningEffort) !== -1) {
    requestBody.reasoning_effort = options.reasoningEffort;
  }

  try {
    try {
      response = await fetchImpl(config.completionsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Ollama svarte ikkje innan " + timeoutMs + " ms.");
      }
      throw new Error(
        "Fekk ikkje kontakt med lokal Ollama. Kontroller at `ollama serve` køyrer og at modellen er lasta ned."
      );
    }

    if (!response.ok) {
      if (response.body && typeof response.body.cancel === "function") {
        response.body.cancel().catch(function () {});
      }
      throw new Error("Ollama API-feil (HTTP " + response.status + ").");
    }

    try {
      rawText = await readResponseText(response);
    } catch (error) {
      if (error && error.code === "LOCAL_AI_RESPONSE_TOO_LARGE") throw error;
      if (controller.signal.aborted) {
        throw new Error("Ollama svarte ikkje innan " + timeoutMs + " ms.");
      }
      throw new Error("Klarte ikkje å lese svaret frå Ollama.");
    }
  } finally {
    clearTimeout(timeout);
  }

  var data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    if (response.ok) throw new Error("Ollama gav eit ugyldig JSON-svar.");
  }

  var choice = data && data.choices && data.choices[0];
  if (choice && choice.finish_reason === "length") {
    var truncatedError = new Error("Ollama brukte opp kontekstvinduet før svaret var ferdig.");
    truncatedError.code = "LOCAL_AI_OUTPUT_TRUNCATED";
    throw truncatedError;
  }
  var content = choice && choice.message && choice.message.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Ollama gav eit uventa svarformat utan choices[0].message.content.");
  }
  return content.trim();
}

module.exports = {
  readConfig: readConfig,
  sendPrompt: sendPrompt,
};
