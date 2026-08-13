"use strict";

var fs = require("node:fs");
var os = require("node:os");
var servicesModule = require("./services");
var sessionsModule = require("./sessions");

function metric(value, unit, sampledAt) {
  if (!Number.isFinite(value)) return { status: "unavailable", value: null, unit: unit, sampledAt: sampledAt };
  return { status: "available", value: Math.round(value * 10) / 10, unit: unit, sampledAt: sampledAt };
}

function cpuSnapshot(osModule) {
  var idle = 0;
  var total = 0;
  (osModule.cpus() || []).forEach(function (cpu) {
    Object.keys(cpu.times || {}).forEach(function (key) {
      var value = Number(cpu.times[key]) || 0;
      total += value;
      if (key === "idle") idle += value;
    });
  });
  return { idle: idle, total: total };
}

async function cpuUsedPercent(osModule, options) {
  var first = cpuSnapshot(osModule);
  var wait = options.wait || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  await wait(options.cpuSampleMs === undefined ? 100 : options.cpuSampleMs);
  var second = cpuSnapshot(osModule);
  var totalDelta = second.total - first.total;
  var idleDelta = second.idle - first.idle;
  if (totalDelta <= 0) return null;
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

function diskUsedPercent(repoRoot, fsModule) {
  try {
    var stats = fsModule.statfsSync(repoRoot);
    var blocks = Number(stats.blocks);
    var available = Number(stats.bavail);
    if (!Number.isFinite(blocks) || blocks <= 0 || !Number.isFinite(available)) return null;
    return Math.max(0, Math.min(100, (1 - available / blocks) * 100));
  } catch (error) { return null; }
}

function summarizeServices(items) {
  return (items || []).reduce(function (summary, item) {
    if (item.status === "healthy") summary.healthy += 1;
    else if (item.status === "degraded") summary.degraded += 1;
    else if (item.status === "down") summary.down += 1;
    else summary.unavailable += 1;
    return summary;
  }, { healthy: 0, degraded: 0, down: 0, unavailable: 0 });
}

async function overviewPayload(config, options) {
  options = options || {};
  var osModule = options.osModule || os;
  var fsModule = options.fsModule || fs;
  var now = options.now || Date.now;
  var sampledAt = new Date(now()).toISOString();
  var results = await Promise.all([
    cpuUsedPercent(osModule, options),
    servicesModule.servicesPayload(config, options),
  ]);
  var totalMemory = Number(osModule.totalmem());
  var freeMemory = Number(osModule.freemem());
  var memoryPercent = totalMemory > 0 ? (1 - freeMemory / totalMemory) * 100 : null;
  var metrics = {
    uptimeSeconds: metric(Number(osModule.uptime()), "s", sampledAt),
    cpuUsedPercent: metric(results[0], "%", sampledAt),
    memoryUsedPercent: metric(memoryPercent, "%", sampledAt),
    diskUsedPercent: metric(diskUsedPercent(config.repoRoot, fsModule), "%", sampledAt),
    cpuTemperatureC: metric(null, "°C", sampledAt),
    nvmeTemperatureC: metric(null, "°C", sampledAt),
  };
  var services = results[1];
  var gemmaService = services.items.filter(function (item) { return item.id === "gemma"; })[0];
  var coreMetricMissing = [metrics.uptimeSeconds, metrics.cpuUsedPercent, metrics.memoryUsedPercent, metrics.diskUsedPercent]
    .some(function (item) { return item.status !== "available"; });
  var overallStatus = coreMetricMissing ? "partial"
    : gemmaService && gemmaService.status === "healthy" ? "ok"
    : "warning";
  var sessionData = sessionsModule.sessionsPayload(now);
  return {
    schemaVersion: "arctic-overview-v1",
    sampledAt: sampledAt,
    lastSuccessfulContactAt: sampledAt,
    overallStatus: overallStatus,
    freshness: "fresh",
    metrics: metrics,
    gemma: {
      status: gemmaService ? gemmaService.status : "unknown",
      configured: true,
      model: config.ollamaModel,
      lastCheckedAt: gemmaService ? gemmaService.lastCheckedAt : sampledAt,
      responseTimeMs: gemmaService ? gemmaService.responseTimeMs : null,
      safeMessage: gemmaService ? gemmaService.safeMessage : "Status er ikke tilgjengelig.",
    },
    servicesSummary: summarizeServices(services.items),
    backup: { status: "not_configured", reasonCode: "vibeverk_backup_source_missing", lastSuccessfulAt: null },
    sessions: { activeCount: 0, recent: sessionData.items },
    events: [],
  };
}

module.exports = {
  cpuUsedPercent: cpuUsedPercent,
  diskUsedPercent: diskUsedPercent,
  metric: metric,
  overviewPayload: overviewPayload,
  summarizeServices: summarizeServices,
};
