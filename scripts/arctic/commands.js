"use strict";

var crypto = require("node:crypto");
var perfHooks = require("node:perf_hooks");

var DEFINITIONS = Object.freeze([
  { id: "health", input: "health", label: "Helse", description: "Hent oppdatert, avgrenset systemstatus.", availability: "available" },
  { id: "services", input: "services", label: "Tjenester", description: "Hent status for registrerte Vibeverk-tjenester.", availability: "available" },
  { id: "gemma-status", input: "gemma status", label: "Gemma-status", description: "Kontroller den registrerte lokale modellen.", availability: "available" },
  { id: "sessions", input: "sessions", label: "Arbeidsøkter", description: "Hent arbeidsøkter og adapterstatus.", availability: "available" },
  { id: "log-errors-24h", input: "logs errors --last 24h", label: "Feil siste døgn", description: "Hent filtrerte Vibeverk-feilhendelser.", availability: "unavailable", reasonCode: "filtered_log_source_missing" },
  { id: "backup-status", input: "backup status", label: "Backup-status", description: "Hent status for en avgrenset Vibeverk-backup.", availability: "unavailable", reasonCode: "vibeverk_backup_source_missing" },
  { id: "vibeverk-test", input: "vibeverk test", label: "Vibeverk-tester", description: "Kjør registrerte tester i et avgrenset arbeidsområde.", availability: "unavailable", reasonCode: "approval_gateway_required" },
  { id: "deploy-status", input: "deploy status", label: "Publiseringsstatus", description: "Hent status for registrerte Vibeverk-publiseringer.", availability: "unavailable", reasonCode: "deployment_source_missing" },
]);

function commandError(message, statusCode, code) {
  var error = new Error(message);
  error.statusCode = statusCode || 400;
  error.code = code || "ARCTIC_COMMAND_INVALID";
  return error;
}

function registry() {
  return DEFINITIONS.map(function (item) {
    return {
      id: item.id,
      input: item.input,
      label: item.label,
      description: item.description,
      availability: item.availability,
      available: item.availability === "available",
      mutatesState: false,
      reasonCode: item.reasonCode || null,
    };
  });
}

function parse(input) {
  if (typeof input !== "string" || !input.trim()) throw commandError("Skriv inn en registrert kommando.");
  if (input.length > 200) throw commandError("Kommandoen er for lang.");
  if (/[\x00-\x1f\x7f;|&<>`$(){}\[\]"'\\]/.test(input)) {
    throw commandError("Shelloperatorer og spesialtegn er ikke tillatt.", 400, "ARCTIC_COMMAND_UNSAFE");
  }
  var canonical = input.trim().toLowerCase().replace(/\s+/g, " ");
  var definition = DEFINITIONS.filter(function (item) { return item.input === canonical; })[0];
  if (!definition) throw commandError("Kommandoen er ikke registrert for Arctic.", 400, "ARCTIC_COMMAND_NOT_ALLOWED");
  return definition;
}

function createExecutor(dependencies) {
  var audit = dependencies.audit;
  var performanceNow = dependencies.performanceNow || perfHooks.performance.now.bind(perfHooks.performance);
  var now = dependencies.now || Date.now;
  var maxPerMinute = dependencies.maxPerMinute || 30;
  var rateWindows = new Map();

  function claimRate(operatorId) {
    var key = String(operatorId || "unknown");
    var timestamp = now();
    var entry = rateWindows.get(key);
    if (!entry || timestamp - entry.startedAt >= 60000) entry = { startedAt: timestamp, count: 0 };
    entry.count += 1;
    rateWindows.set(key, entry);
    if (rateWindows.size > 100) {
      rateWindows.forEach(function (value, mapKey) {
        if (timestamp - value.startedAt >= 60000) rateWindows.delete(mapKey);
      });
    }
    if (entry.count > maxPerMinute) {
      throw commandError("For mange Arctic-kommandoer. Vent litt og prøv igjen.", 429, "ARCTIC_RATE_LIMITED");
    }
  }

  async function execute(input, operatorId) {
    var definition = parse(input);
    claimRate(operatorId);
    var requestId = crypto.randomUUID();
    var started = performanceNow();
    audit.write({ requestId: requestId, operatorId: operatorId, actionId: definition.id, result: "requested" });
    if (definition.availability !== "available") {
      audit.write({
        requestId: requestId,
        operatorId: operatorId,
        actionId: definition.id,
        result: "unavailable",
        errorCode: definition.reasonCode,
        durationMs: performanceNow() - started,
      });
      return {
        schemaVersion: "arctic-command-result-v1",
        requestId: requestId,
        commandId: definition.id,
        status: "unavailable",
        executedAt: new Date(now()).toISOString(),
        reasonCode: definition.reasonCode,
        summary: "Handlingen er ikke konfigurert ennå.",
        details: [{ label: "Årsak", value: definition.reasonCode }],
        result: null,
      };
    }

    var result;
    try {
      if (definition.id === "health") result = await dependencies.overview();
      else if (definition.id === "services") result = await dependencies.services();
      else if (definition.id === "sessions") result = dependencies.sessions();
      else if (definition.id === "gemma-status") {
        var servicePayload = await dependencies.services();
        result = servicePayload.items.filter(function (item) { return item.id === "gemma"; })[0] || null;
      }
      var summary;
      var details = [];
      if (definition.id === "gemma-status") {
        summary = !result ? "Gemma-status kunne ikke leses."
          : result.status === "healthy" ? "Gemma er tilgjengelig med den konfigurerte modellen."
            : "Gemma er ikke fullt tilgjengelig.";
        if (result) {
          details.push({ label: "Status", value: result.status });
          details.push({ label: "Modell", value: result.configuredModel || "Ikke oppgitt" });
          details.push({ label: "Responstid", value: Number.isFinite(result.responseTimeMs) ? result.responseTimeMs + " ms" : "Ikke målt" });
          details.push({ label: "Kontroll", value: result.checkType === "model-registry" ? "Modellregister" : "Tilgjengelighet" });
          if (result.safeMessage) details.push({ label: "Merknad", value: result.safeMessage });
        }
      } else if (definition.id === "services") {
        var serviceItems = result && result.items || [];
        summary = serviceItems.filter(function (item) { return item.status === "healthy"; }).length + " av " + serviceItems.length + " registrerte tjenester fungerer.";
        details = serviceItems.map(function (item) { return { label: item.label, value: item.status }; });
      } else if (definition.id === "health") {
        summary = result && result.overallStatus === "ok" ? "Systemstatus er normal." : "Systemstatus er oppdatert; se detaljene.";
      } else if (definition.id === "sessions") {
        var sessionItems = result && result.items || [];
        summary = sessionItems.length ? sessionItems.length + " arbeidsøkter er registrert." : "Ingen arbeidsøkter er registrert; øktadapterne er ikke konfigurert.";
      }
      audit.write({
        requestId: requestId,
        operatorId: operatorId,
        actionId: definition.id,
        result: "completed",
        durationMs: performanceNow() - started,
      });
      return {
        schemaVersion: "arctic-command-result-v1",
        requestId: requestId,
        commandId: definition.id,
        status: "completed",
        executedAt: new Date(now()).toISOString(),
        reasonCode: null,
        summary: summary || null,
        details: details,
        result: result,
      };
    } catch (error) {
      try {
        audit.write({
          requestId: requestId,
          operatorId: operatorId,
          actionId: definition.id,
          result: "failed",
          errorCode: error && error.code || "ARCTIC_COMMAND_FAILED",
          durationMs: performanceNow() - started,
        });
      } catch (auditFailure) {}
      throw error;
    }
  }
  return { execute: execute };
}

module.exports = { DEFINITIONS: DEFINITIONS, commandError: commandError, createExecutor: createExecutor, parse: parse, registry: registry };
