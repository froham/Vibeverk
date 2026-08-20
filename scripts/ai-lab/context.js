"use strict";

var crypto = require("node:crypto");
var sourceModule = require("./sources");

var MAX_PASTED_CHARS = 20000;

function contextError(message, statusCode, code) {
  var error = new Error(message);
  error.statusCode = statusCode || 400;
  error.code = code || "AI_LAB_CONTEXT_ERROR";
  return error;
}

function exactKeys(input, allowed) {
  return Object.keys(input).every(function (key) { return allowed.indexOf(key) !== -1; });
}

function createContext(repoRoot, input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.kind !== "string") {
    throw contextError("Konteksten har ugyldig format.");
  }
  var hash = crypto.createHash("sha256");
  hash.update("ai-lab-context-v1\0" + input.kind + "\0");
  if (input.kind === "none") {
    if (!exactKeys(input, ["kind"])) throw contextError("Tom kontekst har ukjente felt.");
    return { kind: "none", hash: hash.digest("hex"), text: "", bytes: null, sources: [] };
  }
  if (input.kind === "pasted-text") {
    if (!exactKeys(input, ["kind", "text"]) || typeof input.text !== "string" || !input.text.trim()) {
      throw contextError("Innlimt tekst må være en ikke-tom tekst.");
    }
    if (input.text.length > MAX_PASTED_CHARS) throw contextError("Innlimt tekst er for lang (maks 20000 tegn).", 413);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.text)) throw contextError("Innlimt tekst inneholder ugyldige kontrolltegn.");
    var text = input.text.trim();
    var bytes = Buffer.from(text, "utf8");
    hash.update(bytes);
    return { kind: "pasted-text", hash: hash.digest("hex"), text: text, bytes: bytes, sources: [] };
  }
  if (input.kind === "selected-sources") {
    if (!exactKeys(input, ["kind", "sourceIds"])) throw contextError("Valgt kildekontekst har ukjente felt.");
    var sources;
    try { sources = sourceModule.loadSources(repoRoot, input.sourceIds, false); }
    catch (error) { throw error; }
    sources.forEach(function (source) { hash.update(source.id + "\0"); hash.update(source.bytes); hash.update("\0"); });
    return { kind: "selected-sources", hash: hash.digest("hex"), text: "", bytes: null, sources: sources };
  }
  throw contextError("Ukjent konteksttype.");
}

function publicContext(id, context, expiresAt) {
  return {
    id: id,
    kind: context.kind,
    contextHash: context.hash,
    expiresAt: new Date(expiresAt).toISOString(),
    characterCount: context.kind === "pasted-text" ? context.text.length : context.sources.reduce(function (sum, source) { return sum + source.text.length; }, 0),
    sources: context.sources.map(function (source) { return { id: source.id, path: source.path, lineCount: source.lineCount }; }),
  };
}

function disposeContent(context) {
  if (Buffer.isBuffer(context.bytes)) context.bytes.fill(0);
  context.bytes = null;
  context.text = "";
  (context.sources || []).forEach(function (source) {
    if (Buffer.isBuffer(source.bytes)) source.bytes.fill(0);
    source.bytes = null;
    source.text = "";
  });
}

module.exports = {
  MAX_PASTED_CHARS: MAX_PASTED_CHARS,
  contextError: contextError,
  createContext: createContext,
  disposeContent: disposeContent,
  publicContext: publicContext,
};
