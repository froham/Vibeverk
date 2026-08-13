"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");

var MAX_AUDIT_BYTES = 10 * 1024 * 1024;
var ROTATE_AUDIT_BYTES = 1024 * 1024;
var AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
var AUDIT_FILE_RE = /^audit(?:-[0-9TZ.-]+-[a-f0-9-]+)?\.ndjson$/;

function auditError() {
  var error = new Error("Revisjonsloggen er ikke tilgjengelig. Kommandoen ble ikke kjørt.");
  error.statusCode = 507;
  error.code = "ARCTIC_AUDIT_UNAVAILABLE";
  return error;
}

function ensureRuntimeDir(runtimeDir) {
  try {
    fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
    var stats = fs.lstatSync(runtimeDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("unsafe runtime dir");
    fs.chmodSync(runtimeDir, 0o700);
  } catch (error) { throw auditError(); }
}

function auditFiles(runtimeDir) {
  return fs.readdirSync(runtimeDir).filter(function (name) { return AUDIT_FILE_RE.test(name); });
}

function safeAuditStats(runtimeDir, name) {
  var filename = path.join(runtimeDir, name);
  var stats = fs.lstatSync(filename);
  if (!stats.isFile() || stats.isSymbolicLink()) throw auditError();
  fs.chmodSync(filename, 0o600);
  return { filename: filename, stats: stats };
}

function purgeExpired(runtimeDir, nowMs) {
  ensureRuntimeDir(runtimeDir);
  var cutoff = nowMs - AUDIT_RETENTION_MS;
  try {
    auditFiles(runtimeDir).forEach(function (name) {
      var file = safeAuditStats(runtimeDir, name);
      if (file.stats.mtimeMs <= cutoff) fs.unlinkSync(file.filename);
    });
  } catch (error) {
    if (error && error.code === "ARCTIC_AUDIT_UNAVAILABLE") throw error;
    throw auditError();
  }
}

function totalAuditBytes(runtimeDir) {
  return auditFiles(runtimeDir).reduce(function (total, name) {
    return total + safeAuditStats(runtimeDir, name).stats.size;
  }, 0);
}

function rotateActiveAudit(runtimeDir, incomingBytes, nowMs) {
  var filename = path.join(runtimeDir, "audit.ndjson");
  if (!fs.existsSync(filename)) return;
  var file = safeAuditStats(runtimeDir, "audit.ndjson");
  var utcDayStart = Date.parse(new Date(nowMs).toISOString().slice(0, 10) + "T00:00:00.000Z");
  var belongsToOlderUtcDay = file.stats.mtimeMs < utcDayStart;
  if (!belongsToOlderUtcDay && file.stats.size + incomingBytes <= ROTATE_AUDIT_BYTES) return;
  var stamp = new Date(nowMs).toISOString().replace(/[:]/g, "-");
  var rotated = path.join(runtimeDir, "audit-" + stamp + "-" + crypto.randomUUID() + ".ndjson");
  fs.renameSync(filename, rotated);
  fs.chmodSync(rotated, 0o600);
}

function appendRecord(runtimeDir, record, nowMs) {
  ensureRuntimeDir(runtimeDir);
  nowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  purgeExpired(runtimeDir, nowMs);
  var line = JSON.stringify(record) + "\n";
  var lineBytes = Buffer.byteLength(line, "utf8");
  try {
    rotateActiveAudit(runtimeDir, lineBytes, nowMs);
    if (totalAuditBytes(runtimeDir) + lineBytes > MAX_AUDIT_BYTES) throw auditError();
  } catch (error) {
    if (error && error.code === "ARCTIC_AUDIT_UNAVAILABLE") throw error;
    throw auditError();
  }
  var filename = path.join(runtimeDir, "audit.ndjson");
  var flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND;
  if (typeof fs.constants.O_NOFOLLOW === "number") flags |= fs.constants.O_NOFOLLOW;
  var descriptor;
  try {
    descriptor = fs.openSync(filename, flags, 0o600);
    var stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.size + lineBytes > ROTATE_AUDIT_BYTES) throw new Error("audit full");
    fs.fchmodSync(descriptor, 0o600);
    fs.writeSync(descriptor, line, null, "utf8");
    fs.fsyncSync(descriptor);
  } catch (error) { throw auditError(); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function createAudit(runtimeDir, options) {
  options = options || {};
  var now = options.now || Date.now;
  var append = options.append || appendRecord;
  purgeExpired(runtimeDir, now());
  function write(fields) {
    var record = {
      schemaVersion: "arctic-audit-v1",
      id: crypto.randomUUID(),
      requestId: fields.requestId,
      timestamp: new Date(now()).toISOString(),
      operatorId: fields.operatorId || null,
      actionId: fields.actionId || "unknown",
      result: fields.result,
      errorCode: fields.errorCode || null,
      durationMs: Number.isFinite(fields.durationMs) ? Math.max(0, Math.round(fields.durationMs)) : null,
    };
    append(runtimeDir, record, now());
    return record;
  }
  function writeAi(fields) {
    var sourceIds = Array.isArray(fields.sourceIds) ? fields.sourceIds.slice(0, 6).map(function (id) {
      return String(id || "").slice(0, 100);
    }) : [];
    var record = {
      schemaVersion: "arctic-ai-audit-v1",
      id: crypto.randomUUID(),
      requestId: fields.requestId,
      timestamp: new Date(now()).toISOString(),
      operatorId: fields.operatorId || null,
      actionId: fields.actionId || "unknown",
      providerId: String(fields.providerId || "unknown").slice(0, 50),
      modelId: String(fields.modelId || "unknown").slice(0, 200),
      processing: fields.processing === "external" ? "external" : "local",
      sourceIds: sourceIds,
      result: fields.result,
      errorCode: fields.errorCode || null,
      durationMs: Number.isFinite(fields.durationMs) ? Math.max(0, Math.round(fields.durationMs)) : null,
    };
    append(runtimeDir, record, now());
    return record;
  }
  return { write: write, writeAi: writeAi };
}

module.exports = {
  AUDIT_RETENTION_MS: AUDIT_RETENTION_MS,
  MAX_AUDIT_BYTES: MAX_AUDIT_BYTES,
  ROTATE_AUDIT_BYTES: ROTATE_AUDIT_BYTES,
  appendRecord: appendRecord,
  createAudit: createAudit,
  purgeExpired: purgeExpired,
};
