#!/usr/bin/env node
"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var http = require("node:http");
var path = require("node:path");
var configModule = require("./ai-lab/config");
var workflowModule = require("./ai-lab/workflow");

var MAX_BODY_BYTES = 32768;
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

function safeError(error) {
  var knownCodes = [
    "AI_LAB_REQUEST_ERROR", "AI_LAB_SOURCE_ERROR", "AI_LAB_SCHEMA_ERROR",
    "AI_LAB_WORKFLOW_ERROR", "AI_LAB_SNAPSHOT_EXPIRED", "AI_LAB_OLLAMA_BUSY",
    "AI_LAB_EMPTY_RESPONSE", "AI_LAB_INVALID_JSON", "AI_LAB_INVALID_RESPONSE",
    "AI_LAB_TIMEOUT", "AI_LAB_RESPONSE_TOO_LARGE", "AI_LAB_PROVIDER_NOT_CONFIGURED",
    "AI_LAB_PROVIDER_ERROR", "AI_LAB_ANTHROPIC_BUSY", "AI_LAB_ANTHROPIC_RATE_LIMITED",
    "AI_LAB_TRUNCATED_RESPONSE",
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

function readJsonBody(request) {
  return new Promise(function (resolve, reject) {
    var contentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(contentType)) {
      reject(labError("Content-Type må vere application/json.", 415));
      return;
    }
    var chunks = [];
    var bytes = 0;
    request.on("data", function (chunk) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(labError("Førespurnaden er for stor.", 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", function () {
      if (bytes > MAX_BODY_BYTES) return;
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

function validateMutationRequest(request, host, csrfToken) {
  var origin = String(request.headers.origin || "");
  if (origin !== "http://" + host) throw labError("Ugyldig Origin for lokal AI Lab.", 403);
  if (request.headers["x-ai-lab-token"] !== csrfToken) throw labError("Ugyldig AI Lab-token.", 403);
}

function validateAccessToken(request, configuredToken) {
  var authorization = String(request.headers.authorization || "");
  var expected = "Bearer " + configuredToken;
  var actualBuffer = Buffer.from(authorization);
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
  var csrfToken = options.csrfToken || crypto.randomBytes(32).toString("base64url");

  async function handle(request, response) {
    var host = validateHost(request, config);
    var url = new URL(request.url, "http://" + host);
    if (!url.pathname.startsWith("/__ai-lab/")) {
      sendStatic(request, response, config, url.pathname);
      return;
    }
    if (url.search || url.hash) throw labError("Query og fragment er ikkje støtta av AI Lab API-et.", 400);

    if (request.method === "GET" && url.pathname === "/__ai-lab/v1/config") {
      var publicConfig = workflow.getConfig();
      publicConfig.csrfToken = csrfToken;
      sendJson(response, 200, publicConfig);
      return;
    }
    if (request.method !== "POST") throw labError("Metoden er ikkje støtta.", 405);
    validateMutationRequest(request, host, csrfToken);
    validateAccessToken(request, config.accessToken);
    var body = await readJsonBody(request);

    if (url.pathname === "/__ai-lab/v1/snapshots") {
      sendJson(response, 201, workflow.createSnapshot(body));
      return;
    }
    if (url.pathname === "/__ai-lab/v1/run") {
      sendJson(response, 200, await workflow.runDraft(body.snapshotId, body.provider));
      return;
    }
    if (url.pathname === "/__ai-lab/v1/gemma-review") {
      sendJson(response, 200, await workflow.runGemmaReview(body.snapshotId));
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
    if (!config.anthropicApiKey) console.log("Anthropic er ikkje konfigurert; Gemma kan framleis testast lokalt.");
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
  validateAccessToken: validateAccessToken,
  start: start,
};
