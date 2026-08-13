"use strict";

function adapter(id, label) {
  return {
    id: id,
    label: label,
    status: "not_configured",
    reasonCode: "gateway_required",
    capabilities: {
      start: false,
      continue: false,
      resume: false,
      streaming: false,
      repoRead: false,
      repoWrite: false,
      diff: false,
      tests: false,
      approvals: false,
    },
  };
}

function sessionsPayload(now) {
  return {
    schemaVersion: "arctic-sessions-v1",
    sampledAt: new Date((now || Date.now)()).toISOString(),
    items: [],
    adapters: [adapter("claude", "Claude"), adapter("codex", "Codex")],
  };
}

module.exports = { sessionsPayload: sessionsPayload };
