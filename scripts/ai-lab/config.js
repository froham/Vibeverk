"use strict";

var path = require("node:path");

var LOOPBACK_BASE_RE = /^http:\/\/127\.0\.0\.1(?::([0-9]{1,5}))?\/?$/;
var DEFAULT_CONTROL_URL = "https://jxoglthrnshabqmdmnui.supabase.co";
var DEFAULT_CONTROL_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4b2dsdGhybnNoYWJxbWRtbnVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NTU5NDMsImV4cCI6MjA5OTAzMTk0M30.W1_bBTWxbalRdxuDnIFrRdoNFcOI8IECCbGIxTkiECM";

function enabledFlag(value) {
  return ["1", "true", "yes", "on"].indexOf(String(value || "").trim().toLowerCase()) !== -1;
}

function hasUseEnvProxyArg(args) {
  return Array.isArray(args) && args.some(function (arg) {
    return arg === "--use-env-proxy" || arg.indexOf("--use-env-proxy=") === 0;
  });
}

function requiredText(env, name, maxLength) {
  var value = String(env[name] || "").trim();
  if (!value) throw new Error("Mangler " + name + ".");
  if (value.length > maxLength || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(name + " er ugyldig.");
  }
  return value;
}

function readPositiveInteger(env, name, fallback, min, max) {
  var raw = String(env[name] || "").trim();
  var value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(name + " må vere eit heiltal mellom " + min + " og " + max + ".");
  }
  return value;
}

function readBridgeOrigin(env) {
  var raw = String(env.ARCTIC_BRIDGE_ALLOWED_ORIGIN || "").trim();
  if (!raw) return "";
  var parsed;
  try { parsed = new URL(raw); } catch (error) { throw new Error("ARCTIC_BRIDGE_ALLOWED_ORIGIN er ugyldig."); }
  if (
    parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port ||
    parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.origin !== raw
  ) throw new Error("ARCTIC_BRIDGE_ALLOWED_ORIGIN må være én eksakt HTTPS-origin uten sti.");
  return parsed.origin;
}

function readConfig(env, options) {
  env = env || process.env;
  options = options || {};
  var execArgv = Array.isArray(options.execArgv) ? options.execArgv : process.execArgv;
  if (env.NODE_ENV !== "development") {
    throw new Error("AI Lab er sperra utanfor NODE_ENV=development.");
  }
  if (!enabledFlag(env.AI_LAB_ENABLED)) {
    throw new Error("AI Lab krev AI_LAB_ENABLED=true.");
  }
  if (enabledFlag(env.CI) || enabledFlag(env.VERCEL) || String(env.VERCEL_ENV || "").trim()) {
    throw new Error("AI Lab kan ikkje startast i CI eller Vercel.");
  }
  if (
    enabledFlag(env.NODE_USE_ENV_PROXY) ||
    String(env.NODE_OPTIONS || "").indexOf("--use-env-proxy") !== -1 ||
    hasUseEnvProxyArg(execArgv)
  ) {
    throw new Error("AI Lab kan ikkje startast med Node-miljøproxy aktivert.");
  }

  var ollamaBaseUrl = requiredText(env, "AI_LAB_OLLAMA_BASE_URL", 200).replace(/\/$/, "");
  var match = LOOPBACK_BASE_RE.exec(ollamaBaseUrl);
  if (!match) {
    throw new Error("AI_LAB_OLLAMA_BASE_URL må vere ei bokstavleg http://127.0.0.1-adresse.");
  }
  var parsed = new URL(ollamaBaseUrl);
  var port = parsed.port ? Number(parsed.port) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || parsed.pathname !== "/") {
    throw new Error("AI_LAB_OLLAMA_BASE_URL er ugyldig.");
  }
  var anthropicBaseUrl = requiredText(env, "AI_LAB_ANTHROPIC_BASE_URL", 200).replace(/\/$/, "");
  var anthropicParsed;
  try { anthropicParsed = new URL(anthropicBaseUrl); } catch (error) {
    throw new Error("AI_LAB_ANTHROPIC_BASE_URL er ugyldig.");
  }
  if (
    anthropicParsed.protocol !== "https:" || anthropicParsed.hostname !== "api.anthropic.com" ||
    anthropicParsed.port || anthropicParsed.username || anthropicParsed.password ||
    anthropicParsed.pathname !== "/" || anthropicParsed.search || anthropicParsed.hash
  ) {
    throw new Error("AI_LAB_ANTHROPIC_BASE_URL må vere ei rein https://api.anthropic.com-adresse.");
  }

  var accessToken = requiredText(env, "AI_LAB_ACCESS_TOKEN", 500);
  if (accessToken.length < 32) throw new Error("AI_LAB_ACCESS_TOKEN må ha minst 32 teikn.");

  var controlUrl = String(env.ARCTIC_CONTROL_URL || DEFAULT_CONTROL_URL).trim().replace(/\/$/, "");
  var controlAnonKey = String(env.ARCTIC_CONTROL_ANON_KEY || DEFAULT_CONTROL_ANON_KEY).trim();
  var controlParsed;
  try { controlParsed = new URL(controlUrl); } catch (error) { throw new Error("ARCTIC_CONTROL_URL er ugyldig."); }
  if (
    controlParsed.protocol !== "https:" || !/\.supabase\.co$/.test(controlParsed.hostname) ||
    controlParsed.port || controlParsed.username || controlParsed.password ||
    controlParsed.pathname !== "/" || controlParsed.search || controlParsed.hash
  ) throw new Error("ARCTIC_CONTROL_URL må være en ren https-adresse til Supabase.");
  if (!controlAnonKey || controlAnonKey.length > 2000 || /[\x00-\x1f\x7f]/.test(controlAnonKey)) {
    throw new Error("ARCTIC_CONTROL_ANON_KEY er ugyldig.");
  }
  var repoRoot = path.resolve(__dirname, "../..");
  var runtimeDir = String(env.ARCTIC_RUNTIME_DIR || path.join(repoRoot, ".runtime", "arctic")).trim();
  if (!path.isAbsolute(runtimeDir)) runtimeDir = path.resolve(repoRoot, runtimeDir);
  var runtimeRoot = path.join(repoRoot, ".runtime");
  if (runtimeDir !== runtimeRoot && !runtimeDir.startsWith(runtimeRoot + path.sep)) {
    throw new Error("ARCTIC_RUNTIME_DIR må ligge under repoets .runtime-katalog.");
  }

  return {
    host: "127.0.0.1",
    port: options.allowEphemeralPort && String(env.AI_LAB_PORT || "") === "0"
      ? 0
      : readPositiveInteger(env, "AI_LAB_PORT", 8080, 1, 65535),
    repoRoot: repoRoot,
    ollamaBaseUrl: ollamaBaseUrl,
    ollamaModel: requiredText(env, "AI_LAB_OLLAMA_MODEL", 200),
    anthropicModel: requiredText(env, "AI_LAB_ANTHROPIC_MODEL", 200),
    anthropicBaseUrl: anthropicBaseUrl,
    anthropicApiKey: String(env.ANTHROPIC_API_KEY || "").trim(),
    anthropicProcessingApproved: enabledFlag(env.AI_LAB_ANTHROPIC_PROCESSING_APPROVED),
    accessToken: accessToken,
    timeoutMs: readPositiveInteger(env, "AI_LAB_TIMEOUT_MS", 120000, 1000, 300000),
    anthropicCallsPerHour: readPositiveInteger(env, "AI_LAB_ANTHROPIC_CALLS_PER_HOUR", 10, 1, 100),
    maxPromptChars: readPositiveInteger(env, "AI_LAB_MAX_PROMPT_CHARS", 200000, 20000, 200000),
    snapshotTtlMs: readPositiveInteger(env, "AI_LAB_SNAPSHOT_TTL_MS", 1800000, 60000, 86400000),
    controlUrl: controlUrl,
    controlAnonKey: controlAnonKey,
    arcticRuntimeDir: runtimeDir,
    bridgeAllowedOrigin: readBridgeOrigin(env),
  };
}

module.exports = {
  enabledFlag: enabledFlag,
  hasUseEnvProxyArg: hasUseEnvProxyArg,
  readConfig: readConfig,
};
