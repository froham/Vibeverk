import { commandRegistry } from "./arctic-commands.js";

export var GATEWAY_NOT_CONFIGURED = "gateway_not_configured";

function now() { return new Date().toISOString(); }

function provider(id, label, processing, reasonCode) {
  return {
    id: id,
    label: label,
    model: null,
    configured: false,
    processing: processing,
    capabilities: {
      chat: false,
      streaming: false,
      documentAnalysis: false,
      codeAnalysis: false,
      fileAccess: false,
      codeChanges: false,
      tools: false
    },
    operations: [],
    reasonCode: reasonCode
  };
}

function sessionAdapters() {
  return ["claude", "codex"].map(function (id) {
    return {
      id: id,
      label: id === "claude" ? "Claude" : "Codex",
      status: "not_configured",
      reasonCode: "gateway_required",
      capabilities: { start: false, resume: false, streaming: false, repoRead: false, repoWrite: false }
    };
  });
}

function unavailableMetric(unit, sampledAt) {
  return { status: "unavailable", value: null, unit: unit, sampledAt: sampledAt };
}

export function bootstrapPayload() {
  var checkedAt = now();
  return {
    schemaVersion: "arctic-bootstrap-v1",
    connection: { kind: "gateway", status: "not_configured", checkedAt: checkedAt },
    freshness: { staleAfterMs: 90000, offlineAfterMs: 300000 },
    providers: [
      provider("ollama", "Gemma / lokal modell", "local", "gateway_required"),
      provider("anthropic", "Claude", "external", "credentials_not_configured"),
      provider("codex", "Codex", "external", "gateway_required")
    ],
    commands: commandRegistry(),
    workSessionAdapters: sessionAdapters()
  };
}

export function overviewPayload() {
  var sampledAt = now();
  return {
    schemaVersion: "arctic-overview-v1",
    sampledAt: sampledAt,
    overallStatus: "offline",
    freshness: "missing",
    metrics: {
      uptimeSeconds: unavailableMetric("s", sampledAt),
      cpuUsedPercent: unavailableMetric("%", sampledAt),
      memoryUsedPercent: unavailableMetric("%", sampledAt),
      diskUsedPercent: unavailableMetric("%", sampledAt),
      cpuTemperatureC: unavailableMetric("°C", sampledAt),
      nvmeTemperatureC: unavailableMetric("°C", sampledAt)
    },
    gemma: {
      status: "not_configured",
      model: null,
      lastCheckedAt: null,
      responseTimeMs: null,
      safeMessage: "Krever en konfigurert Arctic-agent/gateway."
    },
    servicesSummary: { healthy: 0, degraded: 0, down: 0, unavailable: 3 },
    backup: { status: "not_configured", reasonCode: "vibeverk_backup_source_missing" },
    sessions: { activeCount: 0, recent: [] },
    events: []
  };
}

export function servicesPayload() {
  var sampledAt = now();
  return {
    schemaVersion: "arctic-services-v1",
    sampledAt: sampledAt,
    // These are identities in the explicit Vibeverk allowlist, not probes.
    // Production does not contact any of them without a constrained gateway.
    items: [
      {
        id: "vibeverk-console-dev-server",
        label: "Lokal Vibeverk-utviklingsserver",
        status: "not_configured",
        uptimeSeconds: null,
        responseTimeMs: null,
        lastCheckedAt: null,
        safeMessage: "Den lokale utviklingsserveren er ikke tilgjengelig fra produksjon."
      },
      {
        id: "ollama-gemma",
        label: "Gemma / lokal modell",
        status: "not_configured",
        uptimeSeconds: null,
        responseTimeMs: null,
        lastCheckedAt: null,
        safeMessage: "Krever en konfigurert Arctic-agent/gateway."
      },
      {
        id: "vibeverk-backup",
        label: "Vibeverk-backup",
        status: "not_configured",
        uptimeSeconds: null,
        responseTimeMs: null,
        lastCheckedAt: null,
        safeMessage: "En avgrenset Vibeverk-backupkilde er ikke konfigurert."
      }
    ]
  };
}

export function sessionsPayload() {
  return {
    schemaVersion: "arctic-sessions-v1",
    sampledAt: now(),
    items: [],
    adapters: sessionAdapters()
  };
}

export function commandsPayload() {
  return {
    schemaVersion: "arctic-commands-v1",
    sampledAt: now(),
    items: commandRegistry(),
    history: []
  };
}

export function unavailableCommandResult(command) {
  return {
    schemaVersion: "arctic-command-result-v1",
    commandId: command.id,
    input: command.input,
    status: "unavailable",
    executedAt: null,
    reasonCode: GATEWAY_NOT_CONFIGURED,
    message: "Kommandoen kan ikke kjøres før Arctic-agent/gateway er konfigurert.",
    result: null
  };
}
