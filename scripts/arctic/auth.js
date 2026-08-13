"use strict";

var MAX_AUTH_RESPONSE_BYTES = 64 * 1024;

function authError(message, statusCode, code) {
  var error = new Error(message);
  error.statusCode = statusCode || 401;
  error.code = code || "ARCTIC_UNAUTHORIZED";
  return error;
}

function bearerToken(request) {
  var value = String(request.headers.authorization || "");
  var match = /^Bearer\s+([^\s]+)\s*$/i.exec(value);
  if (!match) throw authError("Du må være innlogget som superadmin.", 401);
  return match[1];
}

async function readBoundedJson(response) {
  var declaredLength = Number(response.headers && response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUTH_RESPONSE_BYTES) {
    if (response.body && typeof response.body.cancel === "function") {
      try { await response.body.cancel(); } catch (error) {}
    }
    throw authError("Tilgangskontrollen returnerte for mye data.", 502, "ARCTIC_AUTH_UNAVAILABLE");
  }
  var text;
  if (response.body && typeof response.body.getReader === "function") {
    var reader = response.body.getReader();
    var chunks = [];
    var bytes = 0;
    try {
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_AUTH_RESPONSE_BYTES) {
          try { await reader.cancel(); } catch (error) {}
          throw authError("Tilgangskontrollen returnerte for mye data.", 502, "ARCTIC_AUTH_UNAVAILABLE");
        }
        chunks.push(Buffer.from(part.value));
      }
    } finally {
      try { reader.releaseLock(); } catch (error) {}
    }
    text = Buffer.concat(chunks, bytes).toString("utf8");
  } else {
    text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_AUTH_RESPONSE_BYTES) {
      throw authError("Tilgangskontrollen returnerte for mye data.", 502, "ARCTIC_AUTH_UNAVAILABLE");
    }
  }
  try { return text ? JSON.parse(text) : null; }
  catch (error) { throw authError("Tilgangskontrollen returnerte ugyldige data.", 502, "ARCTIC_AUTH_UNAVAILABLE"); }
}

async function verifySuperadmin(token, config, options) {
  options = options || {};
  if (typeof options.verify === "function") {
    var verified = await options.verify(token);
    if (
      !verified || verified.ok !== true || verified.role !== "superadmin" ||
      typeof verified.userId !== "string" || !verified.userId
    ) throw authError("Arctic er bare tilgjengelig for aktiv superadmin.", 403, "ARCTIC_FORBIDDEN");
    return { ok: true, userId: verified.userId, role: verified.role };
  }
  var fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw authError("Tilgangskontrollen er ikke tilgjengelig.", 502, "ARCTIC_AUTH_UNAVAILABLE");
  }
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, options.timeoutMs || 5000);
  var authResponse;
  try {
    authResponse = await fetchImpl(config.controlUrl + "/auth/v1/user", {
      headers: { apikey: config.controlAnonKey, Authorization: "Bearer " + token },
      redirect: "error",
      signal: controller.signal,
    });
    if (!authResponse.ok) throw authError("Innloggingen er ugyldig eller utløpt.", 401);
    var user = await readBoundedJson(authResponse);
    if (!user || typeof user.id !== "string" || !user.id) throw authError("Innloggingen er ugyldig.", 401);

    var operatorResponse = await fetchImpl(
      config.controlUrl + "/rest/v1/operators?id=eq." + encodeURIComponent(user.id) + "&select=id,status,role",
      {
        headers: {
          apikey: config.controlAnonKey,
          Authorization: "Bearer " + token,
          Accept: "application/json",
        },
        redirect: "error",
        signal: controller.signal,
      }
    );
    if (!operatorResponse.ok) throw authError("Kunne ikke kontrollere superadmin-tilgangen.", 502, "ARCTIC_AUTH_UNAVAILABLE");
    var rows = await readBoundedJson(operatorResponse);
    var operator = Array.isArray(rows) && rows[0];
    if (!operator || operator.status !== "active" || operator.role !== "superadmin") {
      throw authError("Arctic er bare tilgjengelig for aktiv superadmin.", 403, "ARCTIC_FORBIDDEN");
    }
    return { ok: true, userId: user.id, role: operator.role };
  } catch (error) {
    if (error && error.code && String(error.code).startsWith("ARCTIC_")) throw error;
    if (controller.signal.aborted) {
      throw authError("Tilgangskontrollen brukte for lang tid.", 502, "ARCTIC_AUTH_UNAVAILABLE");
    }
    throw authError("Kunne ikke kontrollere superadmin-tilgangen.", 502, "ARCTIC_AUTH_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  authError: authError,
  bearerToken: bearerToken,
  verifySuperadmin: verifySuperadmin,
};
