"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");
var util = require("node:util");

var MAX_SOURCE_COUNT = 6;
var MAX_TOTAL_BYTES = 120000;
var MAX_TOTAL_LINES = 5000;
var PROMPT_VERSION = "learning-prompt-v1";
var SCHEMA_VERSION = "learning-draft-v1";

var SOURCE_REGISTRY = Object.freeze([
  { id: "project-readme", label: "Prosjektoversikt", repoRelativePath: "README.md", maxBytes: 25000, anthropicAllowed: true },
  { id: "employee-onboarding", label: "Onboarding for nye medarbeidere", repoRelativePath: "docs/onboarding/new-team-member-onboarding.md", maxBytes: 20000, anthropicAllowed: true },
  { id: "safe-changes", label: "Guide til trygge endringer", repoRelativePath: "docs/onboarding/safe-changes-guide.md", maxBytes: 12000, anthropicAllowed: true },
  { id: "system-overview", label: "Systemoversikt", repoRelativePath: "docs/architecture/system-overview.md", maxBytes: 16000, anthropicAllowed: true },
  { id: "module-conventions", label: "Modulkonvensjoner", repoRelativePath: "docs/architecture/module-conventions.md", maxBytes: 14000, anthropicAllowed: true },
  { id: "storage-flow", label: "Lagring og dataflyt", repoRelativePath: "docs/architecture/storage-and-data-flow.md", maxBytes: 26000, anthropicAllowed: true },
  { id: "roles-tenants", label: "Roller og tenantmodell", repoRelativePath: "docs/architecture/roles-and-tenants.md", maxBytes: 30000, anthropicAllowed: true },
  { id: "faq-code", label: "FAQ-modulen (kode)", repoRelativePath: "module-faq.js", maxBytes: 18000, anthropicAllowed: true },
  { id: "tasks-code", label: "Oppgavemodulen (kode)", repoRelativePath: "workspace/module-tasks.js", maxBytes: 32000, anthropicAllowed: true },
  { id: "structured-ai-code", label: "Strukturert AI-integrasjon (kode)", repoRelativePath: "api/_lib/annual-wheel-ai.js", maxBytes: 20000, anthropicAllowed: true },
]);

var SOURCE_BY_ID = SOURCE_REGISTRY.reduce(function (map, item) {
  map[item.id] = item;
  return map;
}, Object.create(null));

function sourceError(message, statusCode) {
  var error = new Error(message);
  error.statusCode = statusCode || 400;
  error.code = "AI_LAB_SOURCE_ERROR";
  return error;
}

function publicSources() {
  return SOURCE_REGISTRY.map(function (item) {
    return {
      id: item.id,
      label: item.label,
      path: item.repoRelativePath,
      anthropicAllowed: item.anthropicAllowed,
    };
  });
}

function readRegularFileNoFollow(filename, maxBytes) {
  var flags = fs.constants.O_RDONLY;
  if (typeof fs.constants.O_NOFOLLOW === "number") flags |= fs.constants.O_NOFOLLOW;
  var descriptor;
  try {
    descriptor = fs.openSync(filename, flags);
    var stats = fs.fstatSync(descriptor);
    if (!stats.isFile()) throw sourceError("Kjelda er ikkje ei vanleg fil.");
    if (stats.size > maxBytes) throw sourceError("Kjelda er større enn tillaten grense.");
    var buffer = Buffer.alloc(stats.size);
    var offset = 0;
    while (offset < buffer.length) {
      var count = fs.readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    if (offset !== buffer.length) throw sourceError("Kjelda kunne ikkje lesast fullstendig.");
    return buffer;
  } catch (error) {
    if (error && error.code === "AI_LAB_SOURCE_ERROR") throw error;
    throw sourceError("Kjelda kunne ikkje lesast.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function loadSources(repoRoot, sourceIds, requireAnthropic) {
  if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds.length > MAX_SOURCE_COUNT) {
    throw sourceError("Vel mellom 1 og " + MAX_SOURCE_COUNT + " kjelder.");
  }
  var unique = [];
  sourceIds.forEach(function (sourceId) {
    if (typeof sourceId !== "string" || !SOURCE_BY_ID[sourceId]) {
      throw sourceError("Ukjend kjelde-ID.");
    }
    if (unique.indexOf(sourceId) !== -1) throw sourceError("Same kjelde kan ikkje veljast fleire gonger.");
    unique.push(sourceId);
  });

  var rootReal = fs.realpathSync(repoRoot);
  var rootPrefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  var totalBytes = 0;
  var totalLines = 0;
  var decoder = new util.TextDecoder("utf-8", { fatal: true });

  return unique.map(function (sourceId) {
    var item = SOURCE_BY_ID[sourceId];
    if (requireAnthropic && !item.anthropicAllowed) {
      throw sourceError("Kjelda er ikkje godkjend for Anthropic.", 403);
    }
    var candidate = path.resolve(rootReal, item.repoRelativePath);
    if (!candidate.startsWith(rootPrefix)) throw sourceError("Kjeldestien går utanfor prosjektet.");
    var linkStats = fs.lstatSync(candidate);
    if (linkStats.isSymbolicLink()) throw sourceError("Symbolske lenkjer er ikkje tillatne som kjelde.");
    var candidateReal = fs.realpathSync(candidate);
    if (!candidateReal.startsWith(rootPrefix)) throw sourceError("Kjelda går utanfor prosjektet.");
    var raw = readRegularFileNoFollow(candidateReal, item.maxBytes);
    totalBytes += raw.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw sourceError("Valde kjelder er samla sett for store.");
    var text;
    try {
      text = decoder.decode(raw);
    } catch (error) {
      throw sourceError("Kjelda er ikkje gyldig UTF-8.");
    }
    var lineCount = text ? text.split("\n").length : 0;
    totalLines += lineCount;
    if (totalLines > MAX_TOTAL_LINES) throw sourceError("Valde kjelder har for mange linjer.");
    return {
      id: item.id,
      label: item.label,
      path: item.repoRelativePath,
      anthropicAllowed: item.anthropicAllowed,
      bytes: raw,
      text: text,
      lineCount: lineCount,
    };
  });
}

function createSnapshot(repoRoot, scenarioId, sourceIds, instruction, requireAnthropic) {
  if (scenarioId !== "learning-module") throw sourceError("Ukjent scenario.");
  if (typeof instruction !== "string" || !instruction.trim() || instruction.length > 4000) {
    throw sourceError("Instruksjonen må innehalde mellom 1 og 4000 teikn.");
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(instruction)) {
    throw sourceError("Instruksjonen inneheld ugyldige kontrollteikn.");
  }
  var sources = loadSources(repoRoot, sourceIds, requireAnthropic);
  var hash = crypto.createHash("sha256");
  hash.update(PROMPT_VERSION + "\0" + SCHEMA_VERSION + "\0" + scenarioId + "\0" + instruction.trim() + "\0");
  sources.forEach(function (source) {
    hash.update(source.id + "\0" + source.path + "\0");
    hash.update(source.bytes);
    hash.update("\0");
  });
  return {
    scenarioId: scenarioId,
    instruction: instruction.trim(),
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    hash: hash.digest("hex"),
    sources: sources,
  };
}

module.exports = {
  MAX_SOURCE_COUNT: MAX_SOURCE_COUNT,
  SOURCE_REGISTRY: SOURCE_REGISTRY,
  createSnapshot: createSnapshot,
  loadSources: loadSources,
  publicSources: publicSources,
};
