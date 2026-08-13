"use strict";

var perfHooks = require("node:perf_hooks");

var MAX_PROBE_BYTES = 256 * 1024;

function safeService(id, label, status, checkedAt, values) {
  values = values || {};
  return {
    id: id,
    label: label,
    status: status,
    uptimeSeconds: Number.isFinite(values.uptimeSeconds) ? Math.max(0, Math.round(values.uptimeSeconds)) : null,
    responseTimeMs: Number.isFinite(values.responseTimeMs) ? Math.max(0, Math.round(values.responseTimeMs)) : null,
    lastCheckedAt: checkedAt,
    safeMessage: values.safeMessage || null,
    checkType: values.checkType || null,
    configuredModel: values.configuredModel || null,
    modelAvailable: typeof values.modelAvailable === "boolean" ? values.modelAvailable : null,
    registeredModelCount: Number.isInteger(values.registeredModelCount) ? values.registeredModelCount : null,
  };
}

async function readBoundedJson(response) {
  var declaredLength = Number(response.headers && response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROBE_BYTES) {
    if (response.body && typeof response.body.cancel === "function") {
      try { await response.body.cancel(); } catch (error) {}
    }
    throw new Error("response too large");
  }
  var text;
  if (response.body && typeof response.body.getReader === "function") {
    var reader = response.body.getReader();
    var chunks = [];
    var bytes = 0;
    try {
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_PROBE_BYTES) {
          try { await reader.cancel(); } catch (error) {}
          throw new Error("response too large");
        }
        chunks.push(Buffer.from(part.value));
      }
    } finally {
      try { reader.releaseLock(); } catch (error) {}
    }
    text = Buffer.concat(chunks, bytes).toString("utf8");
  } else {
    text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_PROBE_BYTES) throw new Error("response too large");
  }
  return text ? JSON.parse(text) : null;
}

async function probeGemma(config, options) {
  options = options || {};
  var fetchImpl = options.fetchImpl || globalThis.fetch;
  var now = options.now || Date.now;
  var performanceNow = options.performanceNow || perfHooks.performance.now.bind(perfHooks.performance);
  var checkedAt = new Date(now()).toISOString();
  if (typeof fetchImpl !== "function") {
    return safeService("gemma", "Gemma / lokal modell", "unknown", checkedAt, { safeMessage: "Statuskontrollen er ikke tilgjengelig." });
  }
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, options.timeoutMs || 2000);
  var started = performanceNow();
  try {
    var response = await fetchImpl(config.ollamaBaseUrl + "/api/tags", {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    var duration = performanceNow() - started;
    if (!response.ok) {
      if (response.body && typeof response.body.cancel === "function") response.body.cancel().catch(function () {});
      return safeService("gemma", "Gemma / lokal modell", "down", checkedAt, {
        responseTimeMs: duration,
        safeMessage: "Den lokale modelltjenesten svarte ikke normalt.",
      });
    }
    var data = await readBoundedJson(response);
    var models = data && Array.isArray(data.models) ? data.models : [];
    var configuredModel = String(config.ollamaModel || "");
    var loaded = models.some(function (model) {
      var name = String(model && (model.name || model.model) || "");
      return name === configuredModel || name.split(":")[0] === configuredModel.split(":")[0];
    });
    return safeService("gemma", "Gemma / lokal modell", loaded ? "healthy" : "degraded", checkedAt, {
      responseTimeMs: duration,
      safeMessage: loaded ? null : "Den konfigurerte modellen er ikke lastet inn.",
      checkType: "model-registry",
      configuredModel: configuredModel,
      modelAvailable: loaded,
      registeredModelCount: models.length,
    });
  } catch (error) {
    return safeService("gemma", "Gemma / lokal modell", "down", checkedAt, {
      responseTimeMs: performanceNow() - started,
      safeMessage: controller.signal.aborted
        ? "Statuskontrollen brukte for lang tid."
        : "Fikk ikke kontakt med den lokale modelltjenesten.",
      checkType: "model-registry",
      configuredModel: String(config.ollamaModel || ""),
      modelAvailable: false,
    });
  } finally { clearTimeout(timeout); }
}

async function servicesPayload(config, options) {
  options = options || {};
  var now = options.now || Date.now;
  var sampledAt = new Date(now()).toISOString();
  var gemma = await probeGemma(config, options);
  return {
    schemaVersion: "arctic-services-v1",
    sampledAt: sampledAt,
    // This is the complete server-owned allowlist. Upstream service names,
    // Docker containers and process lists are never accepted or forwarded.
    items: [
      safeService("arctic-local-api", "Arctic lokaltilkobling", "healthy", sampledAt, {
        uptimeSeconds: (options.processUptime || process.uptime)(),
      }),
      gemma,
    ],
  };
}

module.exports = { probeGemma: probeGemma, servicesPayload: servicesPayload };
