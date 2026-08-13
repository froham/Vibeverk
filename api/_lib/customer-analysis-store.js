// Small REST client for Kundeanalyse's control-plane tables. Browser writes
// are deliberately not granted in SQL; this module is server-only and uses a
// service-role key only after the caller's control-plane session and active
// operator row have been verified.

function env(options) {
  options = options || {};
  var url = process.env.VIBEVERK_CONTROL_URL;
  var anonKey = process.env.VIBEVERK_CONTROL_ANON_KEY;
  var serviceKey = process.env.VIBEVERK_CONTROL_SERVICE_ROLE_KEY;
  if (!url || !anonKey || (!options.authOnly && !serviceKey)) throw new Error("Kundeanalyse mangler control-plane-miljøvariabler");
  return { url: url.replace(/\/$/, ""), anonKey: anonKey, serviceKey: serviceKey };
}

async function readJson(response) {
  var text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch (e) { throw new Error("Control-plane returnerte ugyldig JSON"); }
}

async function readBoundedAuthJson(response) {
  var maxBytes = 64 * 1024;
  var declared = Number(response.headers && response.headers.get && response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (response.body && typeof response.body.cancel === "function") {
      try { await response.body.cancel(); } catch (e) {}
    }
    throw new Error("For stort svar fra kontrollplanet");
  }
  var text = "";
  if (response.body && typeof response.body.getReader === "function") {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var bytes = 0;
    try {
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maxBytes) {
          try { await reader.cancel(); } catch (e) {}
          throw new Error("For stort svar fra kontrollplanet");
        }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      try { reader.releaseLock(); } catch (e) {}
    }
  } else if (typeof response.text === "function") {
    text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("For stort svar fra kontrollplanet");
  } else {
    // Test doubles in the existing API suite expose json() only.
    var mocked = await response.json();
    if (new TextEncoder().encode(JSON.stringify(mocked)).byteLength > maxBytes) throw new Error("For stort svar fra kontrollplanet");
    return mocked;
  }
  if (!text) return null;
  try { return JSON.parse(text); }
  catch (e) { throw new Error("Control-plane returnerte ugyldig JSON"); }
}

async function request(path, options) {
  var opts = options || {};
  var cfg = env({ authOnly: !!opts.userToken });
  var key = opts.userToken ? cfg.anonKey : cfg.serviceKey;
  var bearer = opts.userToken || cfg.serviceKey;
  var headers = {
    apikey: key,
    Authorization: "Bearer " + bearer,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (opts.prefer) headers.Prefer = opts.prefer;
  var response = await (opts.fetch || fetch)(cfg.url + path, {
    method: opts.method || "GET",
    headers: headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  var data = await readJson(response);
  if (!response.ok) {
    var error = new Error("Control-plane-operasjon feilet (HTTP " + response.status + ")");
    error.status = response.status;
    error.dbCode = data && data.code;
    error.dbMessage = data && data.message;
    throw error;
  }
  return data;
}

export async function verifyConsoleOperator(bearerToken, options) {
  var opts = options || {};
  // Arctic bruker bare brukerens JWT + den offentlige anon-nøkkelen for
  // rollekontroll. Kundeanalyse beholder den strengere, eksisterende env-
  // kontrakten når requiredRole ikke er satt, slik at ingen kallsteder får
  // endret oppførsel utilsiktet.
  var cfg = env({ authOnly: !!opts.requiredRole });
  var fetchImpl = opts.fetch || fetch;
  var requiredRole = opts.requiredRole;
  var controller = requiredRole ? new AbortController() : null;
  var timeout = controller ? setTimeout(function () { controller.abort(); }, opts.timeoutMs || 5000) : null;
  try {
    var auth = await fetchImpl(cfg.url + "/auth/v1/user", {
      headers: { apikey: cfg.anonKey, Authorization: "Bearer " + bearerToken },
      redirect: requiredRole ? "error" : undefined,
      signal: controller ? controller.signal : undefined
    });
    if (!auth.ok) {
      if (auth.body && typeof auth.body.cancel === "function") {
        try { await auth.body.cancel(); } catch (e) {}
      }
      return { ok: false, status: 401, reason: "Ugyldig eller utløpt innlogging." };
    }
    var user = requiredRole ? await readBoundedAuthJson(auth) : await auth.json();
    if (!user || !user.id) return { ok: false, status: 401, reason: "Ugyldig innlogging." };
    var select = requiredRole ? "id,status,role" : "id,status";
    var rows;
    if (requiredRole) {
      var operatorResponse = await fetchImpl(
        cfg.url + "/rest/v1/operators?id=eq." + encodeURIComponent(user.id) + "&select=" + select,
        {
          headers: { apikey: cfg.anonKey, Authorization: "Bearer " + bearerToken, Accept: "application/json" },
          redirect: "error",
          signal: controller.signal
        }
      );
      if (!operatorResponse.ok) {
        if (operatorResponse.body && typeof operatorResponse.body.cancel === "function") {
          try { await operatorResponse.body.cancel(); } catch (e) {}
        }
        throw new Error("Control-plane-operasjon feilet (HTTP " + operatorResponse.status + ")");
      }
      rows = await readBoundedAuthJson(operatorResponse);
    } else {
      rows = await request("/rest/v1/operators?id=eq." + encodeURIComponent(user.id) + "&select=" + select, {
        userToken: bearerToken, fetch: fetchImpl
      });
    }
    var operator = Array.isArray(rows) && rows[0];
    if (!operator || operator.status !== "active") return { ok: false, status: 403, reason: "Bare aktive Console-operatører har tilgang." };
    if (requiredRole && operator.role !== requiredRole) {
      return { ok: false, status: 403, reason: "Denne funksjonen krever superadmin-rolle." };
    }
    if (requiredRole) return { ok: true, userId: user.id, role: operator.role };
    return { ok: true, userId: user.id };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function rest(path, options) { return request(path, options); }

export async function auditEvent(event) {
  try {
    await request("/rest/v1/customer_analysis_events", {
      method: "POST", prefer: "return=minimal", body: {
        analysis_id: event.analysisId || null,
        run_id: event.runId || null,
        operator_id: event.operatorId || null,
        action: String(event.action || "unknown").slice(0, 100),
        result: event.result || "error",
        detail: event.detail ? String(event.detail).slice(0, 700) : null
      }
    });
    return true;
  } catch (e) {
    console.error("[customer-analysis] audit-logg feilet", { action: event.action, result: event.result });
    return false;
  }
}

export async function getAnalysis(id) {
  var rows = await request("/rest/v1/customer_analyses?id=eq." + encodeURIComponent(id) + "&select=*");
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function getCatalog() {
  return await request("/rest/v1/customer_analysis_service_catalog?select=*&order=sort_order.asc,title.asc");
}

export async function claimRun(analysis, operatorId) {
  return await request("/rest/v1/rpc/claim_customer_analysis_run", {
    method: "POST", prefer: "return=representation", body: {
      p_analysis_id: analysis.id,
      p_operator_id: operatorId,
      p_target_host: analysis.target_host,
      p_requested_pages: analysis.max_pages,
      p_global_limit: 3
    }
  });
}
