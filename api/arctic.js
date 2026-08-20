// Authenticated production seam for Console's Arctic section.
//
// This Vercel Function deliberately does not contact Ollama, Docker, SSH,
// private addresses or an Arctic host. A separately deployed, constrained
// outbound gateway is required before operational data or commands can be
// enabled. Until then every data route returns an honest, stable
// gateway_not_configured response.

import { verifyConsoleOperator } from "./_lib/customer-analysis-store.js";
import {
  bootstrapPayload,
  overviewPayload,
  servicesPayload,
  sessionsPayload,
  commandsPayload,
  unavailableCommandResult
} from "./_lib/arctic-contract.js";
import { parseArcticCommand } from "./_lib/arctic-commands.js";

var RESOURCES = ["bootstrap", "overview", "services", "sessions", "commands"];

function json(body, status, extraHeaders) {
  var headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
  Object.keys(extraHeaders || {}).forEach(function (key) { headers[key] = extraHeaders[key]; });
  return new Response(JSON.stringify(body), { status: status || 200, headers: headers });
}

function error(status, code, message, extraHeaders) {
  return json({ ok: false, error: { code: code, message: message }, code: code, message: message }, status, extraHeaders);
}

function bearer(request) {
  var match = /^Bearer\s+([^\s]+)\s*$/i.exec(request.headers.get("authorization") || "");
  return match && match[1];
}

function requestedResource(request) {
  var url = new URL(request.url);
  var resource = url.searchParams.get("resource") || url.searchParams.get("route") || url.searchParams.get("view");
  if (!resource) {
    var marker = "/api/arctic/";
    var at = url.pathname.indexOf(marker);
    if (at !== -1) resource = url.pathname.slice(at + marker.length).split("/")[0];
  }
  return resource || "bootstrap";
}

async function commandResponse(request) {
  if (request.method === "GET") return json(commandsPayload());
  if (request.method !== "POST") {
    return error(405, "method_not_allowed", "Kommandoer støtter bare GET og POST.", { Allow: "GET, POST" });
  }
  var contentType = request.headers.get("content-type") || "";
  if (contentType.toLowerCase().split(";")[0].trim() !== "application/json") {
    return error(415, "unsupported_media_type", "Forespørselen må være JSON.");
  }
  var contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 4096) return error(413, "request_too_large", "Forespørselen er for stor.");

  var rawBody;
  try { rawBody = await request.text(); }
  catch (e) { return error(400, "invalid_json", "Ugyldig JSON i forespørselen."); }
  if (new TextEncoder().encode(rawBody).byteLength > 4096) return error(413, "request_too_large", "Forespørselen er for stor.");
  var body;
  try { body = JSON.parse(rawBody); }
  catch (e) { return error(400, "invalid_json", "Ugyldig JSON i forespørselen."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return error(400, "invalid_command", "Mangler en gyldig kommando.");
  }
  var bodyKeys = Object.keys(body);
  if (bodyKeys.length !== 1 || bodyKeys[0] !== "input") {
    return error(400, "invalid_command", "Forespørselen har ugyldige kommandofelt.");
  }
  var parsed = parseArcticCommand(body.input);
  if (!parsed.ok) return error(400, parsed.code, parsed.message);

  // Parsing proves only that this is a registered future action. There is
  // intentionally no execution adapter in the production function yet.
  return json(unavailableCommandResult(parsed.command));
}

async function handler(request) {
  var token = bearer(request);
  if (!token) return error(401, "unauthorized", "Du må være innlogget.");

  var caller;
  try {
    caller = await verifyConsoleOperator(token, { requiredRole: "superadmin" });
  } catch (e) {
    console.error("[arctic] operatørkontroll feilet", { code: "auth_unavailable" });
    return error(502, "auth_unavailable", "Kunne ikke kontrollere Console-tilgangen.");
  }
  if (!caller.ok) {
    var authCode = caller.status === 401 ? "unauthorized" : "forbidden";
    return error(caller.status, authCode, caller.reason);
  }

  var resource;
  try { resource = requestedResource(request); }
  catch (e) { return error(400, "invalid_request", "Ugyldig forespørselsadresse."); }
  if (RESOURCES.indexOf(resource) === -1) return error(404, "unknown_resource", "Ukjent Arctic-ressurs.");

  if (resource === "commands") return commandResponse(request);
  if (request.method !== "GET") {
    return error(405, "method_not_allowed", "Denne ressursen støtter bare GET.", { Allow: "GET" });
  }
  if (resource === "bootstrap") return json(bootstrapPayload());
  if (resource === "overview") return json(overviewPayload());
  if (resource === "services") return json(servicesPayload());
  return json(sessionsPayload());
}

export default { fetch: handler };
