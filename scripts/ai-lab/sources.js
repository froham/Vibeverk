"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");
var util = require("node:util");

var MAX_SOURCE_COUNT = 6;
var MAX_TOTAL_BYTES = 120000;
var MAX_TOTAL_LINES = 5000;
var MAX_PASTED_CHARS = 20000;
var PROMPT_VERSION = "learning-prompt-v1";
var SCHEMA_VERSION = "learning-draft-v1";

var SOURCE_REGISTRY = Object.freeze([
  { id: "project-readme", label: "Prosjektoversikt", repoRelativePath: "README.md", maxBytes: 25000, anthropicAllowed: true, anthropicApprovedSha256: "b8a6cfdb9b14bd7314a44528b3f0d1c0b758fc6e4e481b64a7e4d8933ab01398" },
  { id: "employee-onboarding", label: "Onboarding for nye medarbeidere", repoRelativePath: "docs/onboarding/new-team-member-onboarding.md", maxBytes: 20000, anthropicAllowed: true, anthropicApprovedSha256: "05113fcda13649853c5abbc266efc7083ba5c527f40339f060ee26caa00dfabc" },
  { id: "safe-changes", label: "Guide til trygge endringer", repoRelativePath: "docs/onboarding/safe-changes-guide.md", maxBytes: 12000, anthropicAllowed: true, anthropicApprovedSha256: "683f416a30e0030fa415930d7673c1082388d8eb97ffc231f139b5193c48e19d" },
  { id: "system-overview", label: "Systemoversikt", repoRelativePath: "docs/architecture/system-overview.md", maxBytes: 16000, anthropicAllowed: true, anthropicApprovedSha256: "2211fb28d55ab37c13f3da4f8ae9b26d3980491da530c13e918bfe2da7440316" },
  { id: "module-conventions", label: "Modulkonvensjoner", repoRelativePath: "docs/architecture/module-conventions.md", maxBytes: 14000, anthropicAllowed: true, anthropicApprovedSha256: "31a48b8e7ac9f26e05fd5d71270c1b7cea61d212cbe4bfc3313122a32e883fe8" },
  { id: "storage-flow", label: "Lagring og dataflyt", repoRelativePath: "docs/architecture/storage-and-data-flow.md", maxBytes: 26000, anthropicAllowed: true, anthropicApprovedSha256: "5ed5327824f4b157c06b7c80960e4a2d9eb5ecf7ffef01c2c2de10615644264a" },
  { id: "roles-tenants", label: "Roller og tenantmodell", repoRelativePath: "docs/architecture/roles-and-tenants.md", maxBytes: 30000, anthropicAllowed: true, anthropicApprovedSha256: "7e1d83441c9b82b938a304bf786fc13711e5903cded30f1a625ca135e29776b1" },
  { id: "faq-code", label: "FAQ-modulen (kode)", repoRelativePath: "module-faq.js", maxBytes: 18000, anthropicAllowed: true, anthropicApprovedSha256: "11e7bfc20500eecac1e6de91b38751cc19ed52f6a284dbbf36fbca551d5c8945" },
  { id: "tasks-code", label: "Oppgavemodulen (kode)", repoRelativePath: "workspace/module-tasks.js", maxBytes: 32000, anthropicAllowed: true, anthropicApprovedSha256: "bb365996c1f82924eb65986aca2a1836122a32d7afc14a2796522de1f51bcefb" },
  { id: "structured-ai-code", label: "Strukturert AI-integrasjon (kode)", repoRelativePath: "api/_lib/annual-wheel-ai.js", maxBytes: 20000, anthropicAllowed: true, anthropicApprovedSha256: "a9990e26c71cc4ab146e6ae5adf2eac633921532faa8f9773b6e0ecbeb2486d9" },
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

function approvedForAnthropic(repoRoot, item) {
  if (!repoRoot || !item.anthropicAllowed || !item.anthropicApprovedSha256) return false;
  try {
    var rootReal = fs.realpathSync(repoRoot);
    var rootPrefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
    var candidate = path.resolve(rootReal, item.repoRelativePath);
    if (!candidate.startsWith(rootPrefix) || fs.lstatSync(candidate).isSymbolicLink()) return false;
    var candidateReal = fs.realpathSync(candidate);
    if (!candidateReal.startsWith(rootPrefix)) return false;
    var raw = readRegularFileNoFollow(candidateReal, item.maxBytes);
    return crypto.createHash("sha256").update(raw).digest("hex") === item.anthropicApprovedSha256;
  } catch (error) { return false; }
}

function publicSources(repoRoot) {
  return SOURCE_REGISTRY.map(function (item) {
    return {
      id: item.id,
      label: item.label,
      path: item.repoRelativePath,
      anthropicAllowed: approvedForAnthropic(repoRoot, item),
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
    var candidate = path.resolve(rootReal, item.repoRelativePath);
    if (!candidate.startsWith(rootPrefix)) throw sourceError("Kjeldestien går utanfor prosjektet.");
    var linkStats = fs.lstatSync(candidate);
    if (linkStats.isSymbolicLink()) throw sourceError("Symbolske lenkjer er ikkje tillatne som kjelde.");
    var candidateReal = fs.realpathSync(candidate);
    if (!candidateReal.startsWith(rootPrefix)) throw sourceError("Kjelda går utanfor prosjektet.");
    var raw = readRegularFileNoFollow(candidateReal, item.maxBytes);
    var anthropicAllowed = item.anthropicAllowed === true &&
      crypto.createHash("sha256").update(raw).digest("hex") === item.anthropicApprovedSha256;
    if (requireAnthropic && !anthropicAllowed) {
      throw sourceError("Kjelda må gjennomgåast på nytt før ho kan sendast til Anthropic.", 403);
    }
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
      anthropicAllowed: anthropicAllowed,
      bytes: raw,
      text: text,
      lineCount: lineCount,
    };
  });
}

function createPastedSource(text, label, requireAnthropic) {
  if (text == null || text === "") return null;
  if (requireAnthropic) throw sourceError("Innlimt materiale kan bare behandles lokalt.", 403);
  if (typeof text !== "string" || !text.trim() || text.length > MAX_PASTED_CHARS) {
    throw sourceError("Innlimt materiale må inneholde mellom 1 og 20000 tegn.", text && text.length > MAX_PASTED_CHARS ? 413 : 400);
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw sourceError("Innlimt materiale inneholder ugyldige kontrolltegn.");
  label = typeof label === "string" && label.trim() ? label.trim() : "Innlimt materiale";
  if (label.length > 80 || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(label)) throw sourceError("Navnet på innlimt materiale er ugyldig.");
  var normalized = text.trim();
  var bytes = Buffer.from(normalized, "utf8");
  var lineCount = normalized.split("\n").length;
  return {
    id: "pasted-material", label: label, path: "midlertidig/innlimt-materiale.txt",
    anthropicAllowed: false, bytes: bytes, text: normalized, lineCount: lineCount,
  };
}

function createSnapshot(repoRoot, scenarioId, sourceIds, instruction, requireAnthropic, pastedText, pastedLabel) {
  if (scenarioId !== "learning-module") throw sourceError("Ukjent scenario.");
  if (typeof instruction !== "string" || !instruction.trim() || instruction.length > 4000) {
    throw sourceError("Instruksjonen må innehalde mellom 1 og 4000 teikn.");
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(instruction)) {
    throw sourceError("Instruksjonen inneheld ugyldige kontrollteikn.");
  }
  if (!Array.isArray(sourceIds)) throw sourceError("Kildelisten har ugyldig format.");
  var pastedSource = createPastedSource(pastedText, pastedLabel, requireAnthropic);
  if (!sourceIds.length && !pastedSource) throw sourceError("Velg eller legg til minst én kilde.");
  if (sourceIds.length + (pastedSource ? 1 : 0) > MAX_SOURCE_COUNT) throw sourceError("Vel mellom 1 og " + MAX_SOURCE_COUNT + " kjelder totalt.");
  var sources = sourceIds.length ? loadSources(repoRoot, sourceIds, requireAnthropic) : [];
  if (pastedSource) sources.push(pastedSource);
  var totalBytes = sources.reduce(function (sum, source) { return sum + source.bytes.length; }, 0);
  var totalLines = sources.reduce(function (sum, source) { return sum + source.lineCount; }, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw sourceError("Valde kjelder er samla sett for store.");
  if (totalLines > MAX_TOTAL_LINES) throw sourceError("Valde kjelder har for mange linjer.");
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
  approvedForAnthropic: approvedForAnthropic,
  createPastedSource: createPastedSource,
  createSnapshot: createSnapshot,
  loadSources: loadSources,
  publicSources: publicSources,
};
