"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var test = require("node:test");

var authModule = require("./scripts/arctic/auth");
var auditModule = require("./scripts/arctic/audit");
var commandsModule = require("./scripts/arctic/commands");
var configModule = require("./scripts/ai-lab/config");
var runtimeModule = require("./scripts/arctic/runtime");
var servicesModule = require("./scripts/arctic/services");

function validEnv(runtimeDir) {
  return {
    NODE_ENV: "development",
    AI_LAB_ENABLED: "true",
    AI_LAB_PORT: "8080",
    AI_LAB_ACCESS_TOKEN: "test-token-med-minst-trettito-tegn-123456",
    AI_LAB_OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    AI_LAB_OLLAMA_MODEL: "gemma4:26b",
    AI_LAB_ANTHROPIC_BASE_URL: "https://api.anthropic.com",
    AI_LAB_ANTHROPIC_MODEL: "claude-test",
    AI_LAB_ANTHROPIC_PROCESSING_APPROVED: "true",
    AI_LAB_TIMEOUT_MS: "5000",
    AI_LAB_ANTHROPIC_CALLS_PER_HOUR: "10",
    AI_LAB_MAX_PROMPT_CHARS: "200000",
    ARCTIC_RUNTIME_DIR: runtimeDir,
  };
}

function deterministicOptions() {
  var cpuCall = 0;
  var cpuSets = [
    [{ times: { user: 100, sys: 50, idle: 850 } }],
    [{ times: { user: 140, sys: 60, idle: 900 } }],
  ];
  return {
    now: function () { return Date.parse("2026-08-12T12:00:00.000Z"); },
    performanceNow: (function () { var value = 0; return function () { value += 5; return value; }; })(),
    wait: async function () {},
    cpuSampleMs: 0,
    osModule: {
      cpus: function () { return cpuSets[Math.min(cpuCall++, cpuSets.length - 1)]; },
      uptime: function () { return 3600; },
      totalmem: function () { return 1000; },
      freemem: function () { return 250; },
    },
    fsModule: { statfsSync: function () { return { blocks: 1000, bavail: 400 }; } },
    processUptime: function () { return 120; },
    fetchImpl: async function (url) {
      assert.equal(String(url), "http://127.0.0.1:11434/api/tags");
      return new Response(JSON.stringify({ models: [{ name: "gemma4:26b" }] }), { status: 200 });
    },
  };
}

test("Arctic-kommandoer bruker eksakt allowlist og avviser shellsyntaks", function () {
  assert.equal(commandsModule.parse("  GEMMA   status ").id, "gemma-status");
  ["health; id", "services | cat", "health && whoami", "health > out", "health $(id)",
    "health`id`", "health\nservices", "health\\test", "health[0]", "health 'x'"]
    .forEach(function (input) {
      assert.throws(function () { commandsModule.parse(input); }, function (error) {
        return error.code === "ARCTIC_COMMAND_UNSAFE";
      }, input);
    });
  assert.throws(function () { commandsModule.parse("docker ps"); }, /ikke registrert/);
  assert.throws(function () { commandsModule.parse("x".repeat(201)); }, /for lang/);
});

test("lokale Arctic-kommandoer har en prosesslokal sikkerhetsgrense", async function () {
  var records = [];
  var executor = commandsModule.createExecutor({
    audit: { write: function (record) { records.push(record); } },
    overview: async function () { return { overallStatus: "ok" }; },
    services: async function () { return { items: [] }; },
    sessions: function () { return { items: [] }; },
    now: function () { return 1000; },
    maxPerMinute: 2,
  });
  assert.equal((await executor.execute("health", "operator-1")).status, "completed");
  assert.equal((await executor.execute("services", "operator-1")).status, "completed");
  await assert.rejects(executor.execute("sessions", "operator-1"), function (error) {
    return error.statusCode === 429 && error.code === "ARCTIC_RATE_LIMITED";
  });
  assert.equal(records.length, 4);
});

test("tjenesteadapteren returnerer bare den faste Vibeverk-allowlisten", async function () {
  var config = configModule.readConfig(validEnv(path.join(process.cwd(), ".runtime", "unused-arctic-runtime")));
  var payload = await servicesModule.servicesPayload(config, deterministicOptions());
  assert.deepEqual(payload.items.map(function (item) { return item.id; }), ["arctic-local-api", "gemma"]);
  var serialized = JSON.stringify(payload).toLowerCase();
  assert.doesNotMatch(serialized, /palworld|docker|tailscale|portainer|hostname/);
  assert.equal(payload.items[1].status, "healthy");
});

test("lokal runtime gir reelle målinger, ærlige adaptertilstander og metadata-only audit", async function (t) {
  var runtimeRoot = path.join(process.cwd(), ".runtime");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  var temp = fs.mkdtempSync(path.join(runtimeRoot, "arctic-test-"));
  t.after(function () { fs.rmSync(temp, { recursive: true, force: true }); });
  var config = configModule.readConfig(validEnv(temp));
  var runtime = runtimeModule.createRuntime(config, deterministicOptions());
  var bootstrap = runtime.bootstrap({ providers: [
    { id: "ollama", model: "gemma4:26b", configured: true },
    { id: "anthropic", model: "claude-test", configured: false },
  ] });
  assert.equal(bootstrap.connection.status, "connected");
  assert.equal(bootstrap.providers[0].configured, true);
  assert.equal(bootstrap.providers[0].capabilities.streaming, true);
  assert.deepEqual(bootstrap.providers[0].operations.slice(0, 4), ["chat", "analyze-text", "summarize", "rewrite"]);
  assert.equal(bootstrap.providers[2].id, "codex");
  assert.equal(bootstrap.providers[2].reasonCode, "gateway_required");
  assert.equal(bootstrap.workSessionAdapters[0].status, "not_configured");

  var overview = await runtime.overview();
  assert.equal(overview.metrics.uptimeSeconds.value, 3600);
  assert.equal(overview.metrics.memoryUsedPercent.value, 75);
  assert.equal(overview.metrics.diskUsedPercent.value, 60);
  assert.equal(overview.metrics.cpuTemperatureC.status, "unavailable");
  assert.equal(overview.backup.status, "not_configured");

  var result = await runtime.executeCommand("health", "operator-test");
  assert.equal(result.status, "completed");
  var gemmaStatus = await runtime.executeCommand("gemma status", "operator-test");
  assert.match(gemmaStatus.summary, /tilgjengelig/);
  assert.equal(gemmaStatus.details[1].value, "gemma4:26b");
  var unavailable = await runtime.executeCommand("backup status", "operator-test");
  assert.equal(unavailable.status, "unavailable");
  runtime.auditAiEvent({
    requestId: "ai-request",
    operatorId: "operator-test",
    actionId: "learning-draft",
    providerId: "anthropic",
    modelId: "haiku-test",
    processing: "external",
    snapshotHash: "c".repeat(64),
    sourceIds: ["safe-changes"],
    result: "completed",
    durationMs: 20,
  });
  var lines = fs.readFileSync(path.join(temp, "audit.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 7);
  assert.ok(lines.every(function (line) { return line.operatorId === "operator-test"; }));
  assert.ok(lines.slice(0, 6).every(function (line) {
    return Object.keys(line).sort().join(",") === "actionId,durationMs,errorCode,id,operatorId,requestId,result,schemaVersion,timestamp";
  }));
  assert.equal(lines[6].schemaVersion, "arctic-ai-audit-v1");
  assert.equal(lines[6].processing, "external");
  assert.deepEqual(lines[6].sourceIds, ["safe-changes"]);
  assert.equal(Object.prototype.hasOwnProperty.call(lines[6], "snapshotHash"), false);
  var auditText = JSON.stringify(lines);
  assert.doesNotMatch(auditText, /backup status|gemma4|prompt|secret/i);
  assert.equal(fs.statSync(temp).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(temp, "audit.ndjson")).mode & 0o777, 0o600);
});

test("Arctic-audit fjerner metadatafiler etter den faste retensjonsperioden", function (t) {
  var runtimeRoot = path.join(process.cwd(), ".runtime");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  var temp = fs.mkdtempSync(path.join(runtimeRoot, "arctic-retention-test-"));
  t.after(function () { fs.rmSync(temp, { recursive: true, force: true }); });
  var expired = path.join(temp, "audit.ndjson");
  fs.writeFileSync(expired, "{}\n", { mode: 0o600 });
  var now = Date.parse("2026-08-12T12:00:00.000Z");
  var old = new Date(now - auditModule.AUDIT_RETENTION_MS - 1000);
  fs.utimesSync(expired, old, old);
  auditModule.createAudit(temp, { now: function () { return now; } });
  assert.equal(fs.existsSync(expired), false);
});

test("Arctic-audit roterer aktiv fil ved UTC-døgnskifte slik at retensjon ikke forlenges av nye poster", function (t) {
  var runtimeRoot = path.join(process.cwd(), ".runtime");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  var temp = fs.mkdtempSync(path.join(runtimeRoot, "arctic-daily-rotation-test-"));
  t.after(function () { fs.rmSync(temp, { recursive: true, force: true }); });
  var active = path.join(temp, "audit.ndjson");
  fs.writeFileSync(active, '{"timestamp":"2026-08-11T23:59:00.000Z"}\n', { mode: 0o600 });
  var yesterday = new Date("2026-08-11T23:59:00.000Z");
  fs.utimesSync(active, yesterday, yesterday);
  auditModule.appendRecord(temp, { timestamp: "2026-08-12T00:01:00.000Z" }, Date.parse("2026-08-12T00:01:00.000Z"));
  var names = fs.readdirSync(temp);
  assert.ok(names.some(function (name) { return /^audit-.*\.ndjson$/.test(name); }));
  assert.match(fs.readFileSync(active, "utf8"), /2026-08-12/);
});

test("Arctic runtime-katalogen kan ikke flyttes utenfor repoets gitignorerte område", function () {
  var env = validEnv(path.join(os.tmpdir(), "arctic-outside-repo"));
  assert.throws(function () { configModule.readConfig(env); }, /må ligge under repoets \.runtime/);
});

test("serververifisering krever aktiv superadmin", async function () {
  var config = {
    controlUrl: "https://control.supabase.co",
    controlAnonKey: "anon",
  };
  async function fetchFor(role, status) {
    return authModule.verifySuperadmin("jwt", config, { fetchImpl: async function (url) {
      if (String(url).includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
      return new Response(JSON.stringify([{ id: "user-1", role: role, status: status }]), { status: 200 });
    } });
  }
  assert.equal((await fetchFor("superadmin", "active")).ok, true);
  await assert.rejects(fetchFor("operator", "active"), function (error) {
    return error.statusCode === 403 && error.code === "ARCTIC_FORBIDDEN";
  });
  await assert.rejects(fetchFor("superadmin", "disabled"), function (error) {
    return error.statusCode === 403;
  });
  await assert.rejects(authModule.verifySuperadmin("jwt", config, {
    verify: async function () { return { ok: false, userId: "user-1", role: "superadmin" }; },
  }), function (error) { return error.statusCode === 403 && error.code === "ARCTIC_FORBIDDEN"; });
  await assert.rejects(authModule.verifySuperadmin("jwt", config, {
    verify: async function () { return { ok: true, userId: "user-1", role: "operator" }; },
  }), function (error) { return error.statusCode === 403 && error.code === "ARCTIC_FORBIDDEN"; });
});

test("Arctic avbryter for store strømmede auth- og tjenestesvar", async function () {
  var authConfig = { controlUrl: "https://control.supabase.co", controlAnonKey: "anon" };
  await assert.rejects(authModule.verifySuperadmin("jwt", authConfig, {
    fetchImpl: async function () {
      return new Response(new ReadableStream({
        start: function (controller) {
          controller.enqueue(new Uint8Array(40000));
          controller.enqueue(new Uint8Array(40000));
          controller.close();
        },
      }), { status: 200 });
    },
  }), function (error) {
    return error.statusCode === 502 && error.code === "ARCTIC_AUTH_UNAVAILABLE";
  });

  var config = configModule.readConfig(validEnv(path.join(process.cwd(), ".runtime", "unused-arctic-runtime")));
  var service = await servicesModule.probeGemma(config, {
    fetchImpl: async function () {
      return new Response(new ReadableStream({
        start: function (controller) {
          controller.enqueue(new Uint8Array(200000));
          controller.enqueue(new Uint8Array(100000));
          controller.close();
        },
      }), { status: 200 });
    },
    timeoutMs: 1000,
  });
  assert.equal(service.status, "down");
  assert.match(service.safeMessage, /kontakt|svarte/i);
});

test("produksjons-API krever superadmin og returnerer ærlig gateway-status", async function () {
  var previous = {
    url: process.env.VIBEVERK_CONTROL_URL,
    anon: process.env.VIBEVERK_CONTROL_ANON_KEY,
  };
  process.env.VIBEVERK_CONTROL_URL = "https://control.example";
  process.env.VIBEVERK_CONTROL_ANON_KEY = "anon";
  delete process.env.VIBEVERK_CONTROL_SERVICE_ROLE_KEY;
  var originalFetch = global.fetch;
  global.fetch = async function (url, init) {
    var auth = init && init.headers && (init.headers.Authorization || init.headers.authorization) || "";
    var isOperator = auth === "Bearer operator-token";
    if (String(url).includes("/auth/v1/user")) {
      if (auth === "Bearer expired-token") return new Response("{}", { status: 401 });
      if (auth === "Bearer oversized-token") return new Response("x".repeat(70000), { status: 200 });
      return new Response(JSON.stringify({ id: isOperator ? "op-2" : "op-1" }), { status: 200 });
    }
    if (String(url).includes("/rest/v1/operators")) {
      return new Response(JSON.stringify([{ id: isOperator ? "op-2" : "op-1", status: "active", role: isOperator ? "operator" : "superadmin" }]), { status: 200 });
    }
    throw new Error("Uventet URL: " + url);
  };
  try {
    var api = await import("./api/arctic.js?test=" + Date.now());
    var missing = await api.default.fetch(new Request("https://vibeverk.no/api/arctic?resource=overview"));
    assert.equal(missing.status, 401);
    var expired = await api.default.fetch(new Request("https://vibeverk.no/api/arctic?resource=overview", { headers: { Authorization: "Bearer expired-token" } }));
    assert.equal(expired.status, 401);
    var oversized = await api.default.fetch(new Request("https://vibeverk.no/api/arctic?resource=overview", { headers: { Authorization: "Bearer oversized-token" } }));
    assert.equal(oversized.status, 502);
    var forbidden = await api.default.fetch(new Request("https://vibeverk.no/api/arctic?resource=overview", { headers: { Authorization: "Bearer operator-token" } }));
    assert.equal(forbidden.status, 403);
    var response = await api.default.fetch(new Request("https://vibeverk.no/api/arctic?resource=overview", { headers: { Authorization: "Bearer super-token" } }));
    assert.equal(response.status, 200);
    var body = await response.json();
    assert.equal(body.overallStatus, "offline");
    assert.equal(body.metrics.cpuUsedPercent.status, "unavailable");
    assert.doesNotMatch(JSON.stringify(body), /service-role|super-token|operator-token|127\.0\.0\.1/);

    var wrongMethod = await api.default.fetch(new Request("https://vibeverk.no/api/arctic?resource=overview", {
      method: "POST", headers: { Authorization: "Bearer super-token" },
    }));
    assert.equal(wrongMethod.status, 405);

    var unsafe = await api.default.fetch(new Request("https://vibeverk.no/api/arctic?resource=commands", {
      method: "POST",
      headers: { Authorization: "Bearer super-token", "Content-Type": "application/json" },
      body: JSON.stringify({ input: "health; id" }),
    }));
    assert.equal(unsafe.status, 400);
    var unknown = await api.default.fetch(new Request("https://vibeverk.no/api/arctic?resource=commands", {
      method: "POST",
      headers: { Authorization: "Bearer super-token", "Content-Type": "application/json" },
      body: JSON.stringify({ input: "docker ps" }),
    }));
    assert.equal(unknown.status, 400);
    var extraField = await api.default.fetch(new Request("https://vibeverk.no/api/arctic?resource=commands", {
      method: "POST",
      headers: { Authorization: "Bearer super-token", "Content-Type": "application/json" },
      body: JSON.stringify({ input: "health", target: "private-service" }),
    }));
    assert.equal(extraField.status, 400);
    var invalidJson = await api.default.fetch(new Request("https://vibeverk.no/api/arctic?resource=commands", {
      method: "POST",
      headers: { Authorization: "Bearer super-token", "Content-Type": "application/json" },
      body: "{",
    }));
    assert.equal(invalidJson.status, 400);
    var unavailable = await api.default.fetch(new Request("https://vibeverk.no/api/arctic?resource=commands", {
      method: "POST",
      headers: { Authorization: "Bearer super-token", "Content-Type": "application/json" },
      body: JSON.stringify({ input: "health" }),
    }));
    assert.equal(unavailable.status, 200);
    assert.equal((await unavailable.json()).status, "unavailable");
  } finally {
    global.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.VIBEVERK_CONTROL_URL; else process.env.VIBEVERK_CONTROL_URL = previous.url;
    if (previous.anon === undefined) delete process.env.VIBEVERK_CONTROL_ANON_KEY; else process.env.VIBEVERK_CONTROL_ANON_KEY = previous.anon;
  }
});
