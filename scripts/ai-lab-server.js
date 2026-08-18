#!/usr/bin/env node
"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var http = require("node:http");
var path = require("node:path");
var configModule = require("./ai-lab/config");
var workflowModule = require("./ai-lab/workflow");
var arcticAuthModule = require("./arctic/auth");
var arcticRuntimeModule = require("./arctic/runtime");

var MAX_BODY_BYTES = 65536;
var MAX_STREAM_BODY_BYTES = 3 * 1024 * 1024;
var MAX_STATIC_BYTES = 25 * 1024 * 1024;
var DENIED_STATIC_SEGMENTS = ["node_modules", "scripts", "supabase", "supabase-control", ".git", ".claude", ".codex", ".agents", ".vercel"];
var MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function labError(message, statusCode, code) {
  var error = new Error(message);
  error.statusCode = statusCode || 400;
  error.code = code || "AI_LAB_REQUEST_ERROR";
  return error;
}

function securityHeaders(contentType) {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, securityHeaders("application/json; charset=utf-8"));
  response.end(JSON.stringify(body));
}

function bridgeProof(accessToken, origin, nonce) {
  return crypto.createHmac("sha256", accessToken)
    .update("vibeverk-arctic-bridge-v1\n" + origin + "\n" + nonce, "utf8")
    .digest("base64url");
}

function bridgeOrigin(request, config) {
  var origin = String(request.headers.origin || "");
  return !!origin && !!config.bridgeAllowedOrigin && origin === config.bridgeAllowedOrigin;
}

function applyBridgeCors(request, response, config) {
  if (!bridgeOrigin(request, config)) return false;
  response.setHeader("Access-Control-Allow-Origin", config.bridgeAllowedOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-AI-Lab-Token, X-Arctic-Access-Token, X-Arctic-Bridge-Nonce");
  response.setHeader("Access-Control-Max-Age", "0");
  response.setHeader("Vary", "Origin");
  return true;
}

function safeError(error) {
  var knownCodes = [
    "AI_LAB_REQUEST_ERROR", "AI_LAB_SOURCE_ERROR", "AI_LAB_SCHEMA_ERROR",
    "AI_LAB_WORKFLOW_ERROR", "AI_LAB_SNAPSHOT_EXPIRED", "AI_LAB_OLLAMA_BUSY",
    "AI_LAB_EMPTY_RESPONSE", "AI_LAB_INVALID_JSON", "AI_LAB_INVALID_RESPONSE",
    "AI_LAB_TIMEOUT", "AI_LAB_RESPONSE_TOO_LARGE", "AI_LAB_PROVIDER_NOT_CONFIGURED",
    "AI_LAB_PROVIDER_ERROR", "AI_LAB_ANTHROPIC_BUSY", "AI_LAB_ANTHROPIC_RATE_LIMITED",
    "AI_LAB_TRUNCATED_RESPONSE", "AI_LAB_SENSITIVE_CONTENT",
    "AI_LAB_EXTERNAL_PROCESSING_NOT_APPROVED",
    "AI_LAB_CONTEXT_ERROR", "AI_LAB_CONTEXT_EXPIRED", "AI_LAB_CONTEXT_LIMIT",
    "AI_LAB_CANCELLED",
    "ARCTIC_UNAUTHORIZED", "ARCTIC_FORBIDDEN", "ARCTIC_AUTH_UNAVAILABLE",
    "ARCTIC_COMMAND_INVALID", "ARCTIC_COMMAND_UNSAFE", "ARCTIC_COMMAND_NOT_ALLOWED",
    "ARCTIC_AUDIT_UNAVAILABLE", "ARCTIC_RATE_LIMITED",
  ];
  if (error && knownCodes.indexOf(error.code) !== -1) {
    return {
      statusCode: Number.isInteger(error.statusCode) ? error.statusCode : 400,
      body: { error: { code: error.code, message: error.message } },
    };
  }
  return {
    statusCode: 500,
    body: { error: { code: "AI_LAB_INTERNAL_ERROR", message: "AI Lab fekk ein intern feil." } },
  };
}

function readJsonBody(request, maxBodyBytes) {
  return new Promise(function (resolve, reject) {
    maxBodyBytes = maxBodyBytes || MAX_BODY_BYTES;
    var contentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(contentType)) {
      reject(labError("Content-Type må vere application/json.", 415));
      return;
    }
    var chunks = [];
    var bytes = 0;
    request.on("data", function (chunk) {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        reject(labError("Førespurnaden er for stor.", 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", function () {
      if (bytes > maxBodyBytes) return;
      try {
        var raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(labError("Ugyldig JSON i førespurnaden.", 400));
      }
    });
    request.on("error", function () { reject(labError("Førespurnaden kunne ikkje lesast.", 400)); });
  });
}

function validateHost(request, config) {
  var host = String(request.headers.host || "").toLowerCase();
  var allowed = ["127.0.0.1:" + config.port, "localhost:" + config.port];
  if (allowed.indexOf(host) === -1) throw labError("Ugyldig Host for lokal AI Lab.", 403);
  return host;
}

function validateMutationRequest(request, host, csrfToken, config) {
  var origin = String(request.headers.origin || "");
  if (origin !== "http://" + host && !(config && origin === config.bridgeAllowedOrigin)) {
    throw labError("Ugyldig Origin for lokal AI Lab.", 403);
  }
  if (request.headers["x-ai-lab-token"] !== csrfToken) throw labError("Ugyldig AI Lab-token.", 403);
}

function validateAccessToken(request, configuredToken) {
  var actual = String(request.headers["x-arctic-access-token"] || "");
  var expected = configuredToken;
  var actualBuffer = Buffer.from(actual);
  var expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw labError("Manglande eller ugyldig lokal tilgangstoken.", 401);
  }
}

function resolveStaticFile(repoRoot, pathname) {
  var decoded;
  try { decoded = decodeURIComponent(pathname); } catch (error) { throw labError("Ugyldig URL.", 400); }
  if (decoded.indexOf("\0") !== -1 || decoded.indexOf("\\") !== -1) throw labError("Ugyldig URL.", 400);
  var segments = decoded.split("/").filter(Boolean);
  if (segments.some(function (segment) {
    return segment.startsWith(".") || DENIED_STATIC_SEGMENTS.indexOf(segment.toLowerCase()) !== -1;
  })) throw labError("Fila er ikkje tilgjengeleg frå utviklingsserveren.", 404);

  var rootReal = fs.realpathSync(repoRoot);
  var candidate = path.resolve(rootReal, "." + decoded);
  var rootPrefix = rootReal + path.sep;
  if (candidate !== rootReal && !candidate.startsWith(rootPrefix)) throw labError("Ugyldig filsti.", 400);
  var stats;
  try { stats = fs.lstatSync(candidate); } catch (error) { throw labError("Fila finst ikkje.", 404); }
  if (stats.isSymbolicLink()) throw labError("Symbolske lenkjer vert ikkje serverte.", 404);
  if (stats.isDirectory()) {
    candidate = path.join(candidate, "index.html");
    try { stats = fs.lstatSync(candidate); } catch (error) { throw labError("Fila finst ikkje.", 404); }
  }
  if (!stats.isFile() || stats.isSymbolicLink()) throw labError("Fila finst ikkje.", 404);
  var real = fs.realpathSync(candidate);
  if (!real.startsWith(rootPrefix) || fs.statSync(real).size > MAX_STATIC_BYTES) throw labError("Fila kan ikkje serverast.", 404);
  return real;
}

function sendStatic(request, response, config, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") throw labError("Metoden er ikkje støtta.", 405);
  var filename = resolveStaticFile(config.repoRoot, pathname);
  var type = MIME_TYPES[path.extname(filename).toLowerCase()] || "application/octet-stream";
  var headers = securityHeaders(type);
  headers["Content-Length"] = fs.statSync(filename).size;
  response.writeHead(200, headers);
  if (request.method === "HEAD") { response.end(); return; }
  fs.createReadStream(filename).on("error", function () { response.destroy(); }).pipe(response);
}

function createAiLabServer(config, options) {
  options = options || {};
  var workflow = options.workflow || workflowModule.createWorkflow(config, options.workflowOptions);
  var arctic = options.arcticRuntime || arcticRuntimeModule.createRuntime(config, options.arcticOptions);
  var csrfToken = options.csrfToken || crypto.randomBytes(32).toString("base64url");

  async function verifySuperadmin(request) {
    var token = arcticAuthModule.bearerToken(request);
    return arcticAuthModule.verifySuperadmin(token, config, {
      verify: options.verifyArcticAccess,
      fetchImpl: options.authFetchImpl,
    });
  }

  async function runAuditedAi(caller, actionId, snapshotId, providerId, operation) {
    if (!arctic || typeof arctic.auditAiEvent !== "function") {
      throw labError("Revisjonsloggen for AI Lab er ikke tilgjengelig.", 507, "ARCTIC_AUDIT_UNAVAILABLE");
    }
    if (!workflow || typeof workflow.describeSnapshot !== "function") {
      throw labError("Kildesnapshotet kan ikke kontrolleres.", 500);
    }
    var snapshot = workflow.describeSnapshot(snapshotId, caller.userId);
    var provider = (workflow.getConfig().providers || []).filter(function (item) { return item.id === providerId; })[0];
    var requestId = crypto.randomUUID();
    var startedAt = Date.now();
    var auditFields = {
      requestId: requestId,
      operatorId: caller.userId,
      actionId: actionId,
      providerId: providerId,
      modelId: provider && provider.model,
      processing: provider && provider.processing,
      snapshotHash: snapshot.snapshotHash,
      sourceIds: (snapshot.sources || []).map(function (source) { return source.id; }),
    };
    arctic.auditAiEvent(Object.assign({}, auditFields, { result: "requested" }));
    try {
      var result = await operation();
      arctic.auditAiEvent(Object.assign({}, auditFields, {
        result: "completed",
        durationMs: Date.now() - startedAt,
      }));
      return result;
    } catch (error) {
      try {
        arctic.auditAiEvent(Object.assign({}, auditFields, {
          result: "failed",
          errorCode: error && error.code || "AI_LAB_PROVIDER_ERROR",
          durationMs: Date.now() - startedAt,
        }));
      } catch (auditFailure) {}
      throw error;
    }
  }

  async function handle(request, response) {
    var host = validateHost(request, config);
    var url = new URL(request.url, "http://" + host);
    if (!url.pathname.startsWith("/__ai-lab/") && !url.pathname.startsWith("/__arctic/")) {
      sendStatic(request, response, config, url.pathname);
      return;
    }
    if (url.search || url.hash) throw labError("Query og fragment er ikke støttet av det lokale API-et.", 400);

    var requestOrigin = String(request.headers.origin || "");
    var sameOrigin = !requestOrigin || requestOrigin === "http://" + host;
    if (!sameOrigin) {
      if (url.pathname !== "/__arctic/v1/bridge-info" && !url.pathname.startsWith("/__ai-lab/")) {
        throw labError("Browser-broen gir ikke tilgang til lokale Arctic-ruter.", 403);
      }
      if (!applyBridgeCors(request, response, config)) throw labError("Ugyldig Origin for lokal AI Lab.", 403);
    }
    if (request.method === "OPTIONS") {
      if (!requestOrigin || !bridgeOrigin(request, config)) throw labError("Ugyldig bridge-preflight.", 403);
      response.writeHead(204, securityHeaders("text/plain; charset=utf-8"));
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/__arctic/v1/bridge-info") {
      if (!bridgeOrigin(request, config)) throw labError("Arctic-broen er ikke konfigurert for denne origin.", 403);
      var nonce = String(request.headers["x-arctic-bridge-nonce"] || "");
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(nonce)) throw labError("Ugyldig bridge-nonce.", 400);
      sendJson(response, 200, {
        schemaVersion: "arctic-bridge-info-v1",
        origin: config.bridgeAllowedOrigin,
        proof: bridgeProof(config.accessToken, config.bridgeAllowedOrigin, nonce),
      });
      return;
    }

    if (url.pathname.startsWith("/__arctic/")) {
      var caller = await verifySuperadmin(request);
      if (request.method === "GET") {
        if (url.pathname === "/__arctic/v1/bootstrap") {
          sendJson(response, 200, arctic.bootstrap(workflow.getConfig()));
          return;
        }
        if (url.pathname === "/__arctic/v1/overview") {
          sendJson(response, 200, await arctic.overview());
          return;
        }
        if (url.pathname === "/__arctic/v1/services") {
          sendJson(response, 200, await arctic.services());
          return;
        }
        if (url.pathname === "/__arctic/v1/sessions") {
          sendJson(response, 200, arctic.sessions());
          return;
        }
        throw labError("Ukjent Arctic-rute.", 404);
      }
      if (request.method !== "POST" || url.pathname !== "/__arctic/v1/commands") {
        throw labError("Metoden er ikke støttet.", 405);
      }
      validateMutationRequest(request, host, csrfToken, config);
      validateAccessToken(request, config.accessToken);
      var commandBody = await readJsonBody(request, 4096);
      if (
        !commandBody || typeof commandBody !== "object" || Array.isArray(commandBody) ||
        Object.keys(commandBody).length !== 1 || typeof commandBody.input !== "string"
      ) throw labError("Kommandoforespørselen er ugyldig.", 400);
      sendJson(response, 200, await arctic.executeCommand(commandBody.input, caller.userId));
      return;
    }

    if (request.method === "GET" && url.pathname === "/__ai-lab/v1/config") {
      await verifySuperadmin(request);
      var publicConfig = workflow.getConfig();
      publicConfig.csrfToken = csrfToken;
      sendJson(response, 200, publicConfig);
      return;
    }
    if (request.method !== "POST") throw labError("Metoden er ikkje støtta.", 405);
    validateMutationRequest(request, host, csrfToken, config);
    var aiCaller = await verifySuperadmin(request);
    validateAccessToken(request, config.accessToken);
    var body = await readJsonBody(request, url.pathname === "/__ai-lab/v1/stream" ? MAX_STREAM_BODY_BYTES : undefined);

    if (url.pathname === "/__ai-lab/v1/snapshots") {
      sendJson(response, 201, workflow.createSnapshot(body, aiCaller.userId));
      return;
    }
    if (url.pathname === "/__ai-lab/v1/contexts") {
      sendJson(response, 201, workflow.createContext(body, aiCaller.userId));
      return;
    }
    if (url.pathname === "/__ai-lab/v1/contexts/dispose") {
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 || typeof body.contextId !== "string") {
        throw labError("Ugyldig forespørsel om å tømme kontekst.", 400);
      }
      workflow.disposeContext(body.contextId, aiCaller.userId);
      sendJson(response, 200, { disposed: true });
      return;
    }
    if (url.pathname === "/__ai-lab/v1/provider-idle") {
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 || body.provider !== "ollama") {
        throw labError("Ugyldig forespørsel om providerstatus.", 400);
      }
      var idleStatus = await workflow.waitForProviderIdle("ollama", 15000);
      sendJson(response, 200, idleStatus);
      return;
    }
    if (url.pathname === "/__ai-lab/v1/snapshots/dispose") {
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 || typeof body.snapshotId !== "string") {
        throw labError("Ugyldig forespørsel om å tømme læringssnapshot.", 400);
      }
      workflow.disposeSnapshot(body.snapshotId, aiCaller.userId);
      sendJson(response, 200, { disposed: true });
      return;
    }
    if (url.pathname === "/__ai-lab/v1/stream") {
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).some(function (key) { return ["operation", "provider", "contextId", "messages", "image", "reasoningEffort"].indexOf(key) === -1; }) ||
          body.provider !== "ollama" || typeof body.contextId !== "string" ||
          typeof body.operation !== "string" || !Array.isArray(body.messages) ||
          (body.reasoningEffort != null && ["none", "low"].indexOf(body.reasoningEffort) === -1)) {
        throw labError("Ugyldig strømmeforespørsel.", 400);
      }
      if (!arctic || typeof arctic.auditAiEvent !== "function") {
        throw labError("Revisjonsloggen for AI Lab er ikke tilgjengelig.", 507, "ARCTIC_AUDIT_UNAVAILABLE");
      }
      var contextInfo = workflow.describeContext(body.contextId, aiCaller.userId);
      var streamProvider = (workflow.getConfig().providers || []).filter(function (item) { return item.id === "ollama"; })[0];
      var streamRequestId = crypto.randomUUID();
      var streamStarted = Date.now();
      var streamAudit = {
        requestId: streamRequestId, operatorId: aiCaller.userId, actionId: body.operation,
        providerId: "ollama", modelId: streamProvider && streamProvider.model, processing: "local",
        snapshotHash: contextInfo.contextHash,
        sourceIds: (contextInfo.sources || []).map(function (source) { return source.id; }),
      };
      // Fail closed before response headers and before the provider is invoked.
      arctic.auditAiEvent(Object.assign({}, streamAudit, { result: "requested" }));
      var streamAbort = new AbortController();
      function abortDisconnectedClient() { if (!response.writableEnded) streamAbort.abort(); }
      request.on("aborted", abortDisconnectedClient);
      response.on("close", abortDisconnectedClient);
      var headers = securityHeaders("application/x-ndjson; charset=utf-8");
      headers.Connection = "keep-alive";
      headers["X-Accel-Buffering"] = "no";
      response.writeHead(200, headers);
      function writeEvent(event) {
        if (!response.destroyed && !response.writableEnded) response.write(JSON.stringify(event) + "\n");
      }
      writeEvent({
        type: "meta", schemaVersion: "ai-lab-stream-v1", requestId: streamRequestId,
        operation: body.operation,
        provider: { id: "ollama", model: streamProvider && streamProvider.model, processing: "local" },
        context: {
          kind: contextInfo.kind,
          characterCount: contextInfo.characterCount,
          sources: contextInfo.sources,
        },
        imageAttached: !!body.image,
        reasoningEffort: body.reasoningEffort || (body.operation === "analyze-text" ? "low" : "none"),
      });
      try {
        var streamed = await workflow.runOperation(body.contextId, body.operation, body.messages, {
          signal: streamAbort.signal,
          onDelta: function (text) { writeEvent({ type: "delta", text: text }); },
          reasoningEffort: body.reasoningEffort,
        }, aiCaller.userId, body.image);
        arctic.auditAiEvent(Object.assign({}, streamAudit, { result: "completed", durationMs: Date.now() - streamStarted }));
        writeEvent({
          type: "complete", finishReason: streamed.finishReason,
          usage: streamed.usage, durationMs: streamed.provider.durationMs,
        });
      } catch (streamError) {
        try {
          arctic.auditAiEvent(Object.assign({}, streamAudit, {
            result: streamError && streamError.code === "AI_LAB_CANCELLED" ? "cancelled" : "failed",
            errorCode: streamError && streamError.code || "AI_LAB_PROVIDER_ERROR",
            durationMs: Date.now() - streamStarted,
          }));
        } catch (auditFailure) {
          streamError = auditFailure;
        }
        if (streamError && streamError.code === "AI_LAB_CANCELLED") writeEvent({ type: "cancelled" });
        else {
          var streamSafe = safeError(streamError);
          writeEvent({
            type: "error",
            code: streamSafe.body.error.code,
            message: streamSafe.body.error.message,
          });
        }
      }
      if (!response.destroyed && !response.writableEnded) response.end();
      return;
    }
    if (url.pathname === "/__ai-lab/v1/run") {
      if (!body || typeof body.snapshotId !== "string" || ["ollama", "anthropic"].indexOf(body.provider) === -1) {
        throw labError("Ugyldig AI Lab-kjøring.", 400);
      }
      sendJson(response, 200, await runAuditedAi(
        aiCaller,
        "learning-draft",
        body.snapshotId,
        body.provider,
        function () { return workflow.runDraft(body.snapshotId, body.provider, aiCaller.userId); }
      ));
      return;
    }
    if (url.pathname === "/__ai-lab/v1/gemma-review") {
      if (!body || typeof body.snapshotId !== "string") throw labError("Ugyldig AI Lab-review.", 400);
      sendJson(response, 200, await runAuditedAi(
        aiCaller,
        "learning-review",
        body.snapshotId,
        "anthropic",
        function () { return workflow.runGemmaReview(body.snapshotId, aiCaller.userId); }
      ));
      return;
    }
    throw labError("Ukjent AI Lab-rute.", 404);
  }

  var server = http.createServer(function (request, response) {
    handle(request, response).catch(function (error) {
      if (response.headersSent) { response.destroy(); return; }
      var safe = safeError(error);
      sendJson(response, safe.statusCode, safe.body);
    });
  });
  return { server: server, csrfToken: csrfToken, workflow: workflow };
}

function start() {
  var config = configModule.readConfig(process.env);
  var app = createAiLabServer(config);
  app.server.listen(config.port, config.host, function () {
    console.log("AI Lab development server: http://127.0.0.1:" + config.port + "/console/");
    console.log("Ollama model: " + config.ollamaModel + " | Anthropic model: " + config.anthropicModel);
    if (!config.anthropicApiKey) console.log("Anthropic manglar API-nøkkel; Gemma kan framleis testast lokalt.");
    else if (!config.anthropicProcessingApproved) console.log("Anthropic er deaktivert til AI_LAB_ANTHROPIC_PROCESSING_APPROVED=true er eksplisitt godkjent.");
  });
  return app.server;
}

if (require.main === module) {
  try { start(); } catch (error) {
    console.error("[ai-lab] " + error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  createAiLabServer: createAiLabServer,
  readJsonBody: readJsonBody,
  resolveStaticFile: resolveStaticFile,
  safeError: safeError,
  bridgeProof: bridgeProof,
  validateAccessToken: validateAccessToken,
  start: start,
};
