"use strict";

// Conservative, server-side tripwires for common credential formats. This is
// intentionally a blocker, not a redactor: replacing bytes would invalidate
// AI Lab's line references and snapshot hash. Passing these checks is never a
// guarantee that content is anonymous or non-confidential.
var SECRET_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /https?:\/\/[^\s/:@]+:[^\s/@]+@/i,
  /^(?:API_KEY|ACCESS_TOKEN|SECRET|PASSWORD|SERVICE_ROLE_KEY|DATABASE_URL)\s*=\s*[^\s#]{12,}\s*$/mi,
  /^(?:[A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|SECRET|PASSWORD|SERVICE_ROLE_KEY))\s*=\s*[^\s#]{12,}\s*$/m,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|service[_-]?role[_-]?key|password)\b\s*[:=]\s*["'](?!\s*(?:example|test|your[-_]|<|\$\{))[^"'\r\n]{12,}["']/i,
]);

function containsKnownSecret(value) {
  if (typeof value !== "string" || !value) return false;
  return SECRET_PATTERNS.some(function (pattern) { return pattern.test(value); });
}

function snapshotContainsKnownSecret(snapshot, additionalText) {
  if (!snapshot || containsKnownSecret(snapshot.instruction)) return true;
  if ((snapshot.sources || []).some(function (source) { return containsKnownSecret(source && source.text); })) return true;
  return containsKnownSecret(additionalText || "");
}

module.exports = {
  containsKnownSecret: containsKnownSecret,
  snapshotContainsKnownSecret: snapshotContainsKnownSecret,
};
