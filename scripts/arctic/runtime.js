"use strict";

var auditModule = require("./audit");
var commandsModule = require("./commands");
var providersModule = require("./providers");
var servicesModule = require("./services");
var sessionsModule = require("./sessions");
var statusModule = require("./status");

function createRuntime(config, options) {
  options = options || {};
  var now = options.now || Date.now;
  var sharedOptions = Object.assign({}, options, { now: now });
  var audit = options.audit || auditModule.createAudit(config.arcticRuntimeDir, { now: now });

  function overview() { return statusModule.overviewPayload(config, sharedOptions); }
  function services() { return servicesModule.servicesPayload(config, sharedOptions); }
  function sessions() { return sessionsModule.sessionsPayload(now); }
  var executor = commandsModule.createExecutor({
    audit: audit,
    overview: overview,
    services: services,
    sessions: sessions,
    performanceNow: options.performanceNow,
    now: now,
    maxPerMinute: options.commandMaxPerMinute,
  });

  return {
    bootstrap: function (aiConfig) {
      var sampledAt = new Date(now()).toISOString();
      var sessionData = sessions();
      return {
        schemaVersion: "arctic-bootstrap-v1",
        connection: { kind: "local", status: "connected", checkedAt: sampledAt },
        freshness: { staleAfterMs: 90000, offlineAfterMs: 300000 },
        providers: providersModule.providerDescriptors(aiConfig),
        commands: commandsModule.registry(),
        workSessionAdapters: sessionData.adapters,
      };
    },
    overview: overview,
    services: services,
    sessions: sessions,
    executeCommand: executor.execute,
    auditAiEvent: function (fields) { return audit.writeAi(fields); },
  };
}

module.exports = { createRuntime: createRuntime };
