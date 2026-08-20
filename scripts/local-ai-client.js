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

function localAbortError(message) {
  var error = new Error(message || "Ollama-kallet vart avbrote.");
  error.code = "LOCAL_AI_ABORTED";
  return error;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  var safe = {};
  ["prompt_tokens", "completion_tokens", "total_tokens"].forEach(function (key) {
    var value = usage[key];
    if (Number.isSafeInteger(value) && value >= 0 && value <= 100000000) safe[key] = value;
  });
  return Object.keys(safe).length ? safe : null;
}

function validateMessages(messages, maxLength) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 24) {
    throw new Error("Meldingshistorikken må innehalde mellom 1 og 24 meldingar.");
  }
  var total = 0;
  var normalized = messages.map(function (message) {
    if (!message || typeof message !== "object" || Array.isArray(message) ||
        ["system", "user", "assistant"].indexOf(message.role) === -1 ||
        !(typeof message.content === "string" || Array.isArray(message.content))) {
      throw new Error("Meldingshistorikken har ugyldig format.");
    }
    if (typeof message.content === "string") {
      if (!message.content.trim()) throw new Error("Meldingshistorikken har ugyldig format.");
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message.content)) {
        throw new Error("Ei melding inneheld ugyldige kontrollteikn.");
      }
      total += message.content.length;
      return { role: message.role, content: message.content.trim() };
    }
    if (message.role !== "user" || message.content.length !== 2) throw new Error("Bildevedlegg må ligge i én brukermelding.");
    var textPart = message.content[0];
    var imagePart = message.content[1];
    if (!textPart || Object.keys(textPart).some(function (key) { return ["type", "text"].indexOf(key) === -1; }) ||
        textPart.type !== "text" || typeof textPart.text !== "string" || !textPart.text.trim() ||
        !imagePart || Object.keys(imagePart).some(function (key) { return ["type", "image_url"].indexOf(key) === -1; }) ||
        imagePart.type !== "image_url" || !imagePart.image_url ||
        Object.keys(imagePart.image_url).some(function (key) { return key !== "url"; }) ||
        typeof imagePart.image_url.url !== "string" ||
        !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imagePart.image_url.url) ||
        imagePart.image_url.url.length > 2800000) {
      throw new Error("Bildevedlegget har ugyldig format.");
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(textPart.text)) {
      throw new Error("Ei melding inneheld ugyldige kontrollteikn.");
    }
    total += textPart.text.length;
    return {
      role: message.role,
      content: [
        { type: "text", text: textPart.text.trim() },
        { type: "image_url", image_url: { url: imagePart.image_url.url } },
      ],
    };
  });
  if (total > maxLength) throw new Error("Meldingshistorikken er for lang (maks " + maxLength + " teikn).");
  return normalized;
}

function parseSseEvent(raw, onDelta, state) {
  var lines = raw.split(/\r?\n/);
  var dataLines = lines.filter(function (line) { return line.indexOf("data:") === 0; })
    .map(function (line) { return line.slice(5).trimStart(); });
  if (!dataLines.length) return;
  var payload = dataLines.join("\n");
  if (payload === "[DONE]") { state.done = true; return; }
  var parsed;
  try { parsed = JSON.parse(payload); } catch (error) {
    var invalid = new Error("Ollama gav ein ugyldig SSE-hending.");
    invalid.code = "LOCAL_AI_INVALID_STREAM";
    throw invalid;
  }
  var choice = parsed && parsed.choices && parsed.choices[0];
  var text = choice && choice.delta && choice.delta.content;
  if (typeof text === "string" && text) {
    state.content += text;
    onDelta(text);
  }
  if (choice && choice.finish_reason) state.finishReason = choice.finish_reason;
  if (parsed && parsed.usage) state.usage = normalizeUsage(parsed.usage);
}

async function sendMessagesStream(messages, options) {
  options = options || {};
  var config = readConfig(options.env, options.execArgv);
  var maxLength = Number.isInteger(options.maxPromptLength) ? options.maxPromptLength : MAX_PROMPT_LENGTH;
  var normalizedMessages = validateMessages(messages, maxLength);
  var fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Denne Node-versjonen manglar fetch; bruk Node 20 eller nyare.");
  var onDelta = typeof options.onDelta === "function" ? options.onDelta : function () {};
  var timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  var reasoningEffort = options.reasoningEffort;
  if (reasoningEffort != null && ["none", "low"].indexOf(reasoningEffort) === -1) throw new Error("Ugyldig reasoning-nivå.");
  var controller = new AbortController();
  var externalSignal = options.signal;
  var externallyAborted = false;
  function abortFromCaller() { externallyAborted = true; controller.abort(); }
  if (externalSignal) {
    if (externalSignal.aborted) abortFromCaller();
    else externalSignal.addEventListener("abort", abortFromCaller, { once: true });
  }
  var timedOut = false;
  var timeout = setTimeout(function () { timedOut = true; controller.abort(); }, timeoutMs);
  var response;
  try {
    try {
      var requestBody = { model: config.model, messages: normalizedMessages, stream: true };
      if (reasoningEffort != null) requestBody.reasoning_effort = reasoningEffort;
      response = await fetchImpl(config.completionsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(requestBody),
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (externallyAborted) throw localAbortError();
      if (timedOut) throw new Error("Ollama svarte ikkje innan " + timeoutMs + " ms.");
      throw new Error("Fekk ikkje kontakt med lokal Ollama. Kontroller at `ollama serve` køyrer og at modellen er lasta ned.");
    }
    if (!response.ok) {
      if (response.body && typeof response.body.cancel === "function") response.body.cancel().catch(function () {});
      throw new Error("Ollama API-feil (HTTP " + response.status + ").");
    }
    if (!response.body || typeof response.body.getReader !== "function") {
      throw new Error("Ollama gav ikkje eit strømbart svar.");
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    var bytes = 0;
    var state = { content: "", done: false, finishReason: null, usage: null };
    try {
      while (!state.done) {
        var chunk;
        try { chunk = await reader.read(); } catch (error) {
          if (externallyAborted) throw localAbortError();
          if (timedOut) throw new Error("Ollama svarte ikkje innan " + timeoutMs + " ms.");
          throw error;
        }
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          controller.abort();
          throw responseTooLargeError();
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        var boundary;
        while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
          var eventText = buffer.slice(0, boundary);
          var delimiter = /^\r\n\r\n/.test(buffer.slice(boundary)) ? 4 : 2;
          buffer = buffer.slice(boundary + delimiter);
          parseSseEvent(eventText, onDelta, state);
          if (externallyAborted) throw localAbortError();
        }
      }
      buffer += decoder.decode();
      if (buffer.trim() && !state.done) parseSseEvent(buffer, onDelta, state);
      if (externallyAborted) throw localAbortError();
    } finally { try { reader.releaseLock(); } catch (error) {} }
    if (!state.content.trim()) throw new Error("Ollama gav ein tom svarstraum.");
    if (state.finishReason === "length") {
      var truncatedStream = new Error("Ollama-svaret vart avkorta av kontekstvinduet.");
      truncatedStream.code = "LOCAL_AI_OUTPUT_TRUNCATED";
      throw truncatedStream;
    }
    if (!state.done) {
      var incompleteStream = new Error("Ollama avslutta svarstraumen utan ein fullføringsmarkør.");
      incompleteStream.code = "LOCAL_AI_INCOMPLETE_STREAM";
      throw incompleteStream;
    }
    return { content: state.content, finishReason: state.finishReason || "stop", usage: state.usage };
  } finally {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener("abort", abortFromCaller);
  }
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
  sendMessagesStream: sendMessagesStream,
  validateMessages: validateMessages,
};
