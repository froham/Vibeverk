// supabase/functions/sidetelling-event/handler.js
//
// Server-side dagsgruppering for module-sidetelling.js. Den besøkjande sin
// browser sender ALDRI ein analyse-/sesjons-ID og les/skriv ALDRI cookie,
// browser-cache, localStorage eller sessionStorage for denne grupperinga.
// Edge-funksjonen les IP, User-Agent og Origin frå den innkomande requesten,
// reknar ein deterministisk SHA-256 for UTC-dagen og sender berre hashen av
// requestkonteksten, saman med sjølve hendingsfelta, til ein smal service-only
// PostgreSQL-funksjon. Ingen salt, nøkkel eller token vert lagra.
//
// Supabase sitt edge-/proxy-lag kan ha eigne request-loggar. Påstanden over
// gjeld Vibeverk sin eigen funksjonskode og analytics_events-tabellen, ikkje
// leverandøren si separate infrastrukturlogging.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

const MAX_BODY_LENGTH = 4096;
const CTA_IDS = ["tel", "mailto", "kontakt", "tilbud", "booking"];
const DEVICE_TYPES = ["mobil", "nettbrett", "pc"];

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function firstHeaderPart(value) {
  return (value || "").split(",")[0].trim();
}

function normalizeIp(value) {
  var candidate = (value || "").trim();
  if (!candidate || candidate.indexOf("%") !== -1) return null;

  if (candidate.indexOf(":") === -1) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) return null;
    var parts = candidate.split(".");
    for (var i = 0; i < parts.length; i++) {
      var part = Number(parts[i]);
      if (!Number.isInteger(part) || part < 0 || part > 255) return null;
      parts[i] = String(part);
    }
    return parts.join(".");
  }

  try {
    var host = new URL("http://[" + candidate + "]/").hostname;
    if (host.charAt(0) !== "[" || host.charAt(host.length - 1) !== "]") return null;
    return host.slice(1, -1).toLowerCase();
  } catch (_err) {
    return null;
  }
}

function requestIp(headers) {
  // Empirisk stadfesta mot vibeverk-staging (2026-08-07, sjå CHANGELOG):
  // Cloudflare-edgen framfor Supabase skriv HEILT OM x-forwarded-for til den
  // ekte proxy-kjeda (eit forfalska klient-verdi vert kasta, aldri bevart
  // som fyrste ledd) og NEKTAR (403, Cloudflare-feilkode 1000) heile
  // requesten dersom klienten prøver å setje cf-connecting-ip sjølv. x-real-ip
  // vert strippa heilt uansett. Ingen av dei tre er difor reelt klient-
  // forfalskbare i denne infrastrukturen -- stadfesta med eit throwaway
  // diagnostikk-endepunkt som ekkoa rå headerar attende, sletta att straks
  // verifiseringa var gjort. Minutt-kvota (sjå migrasjonen) står likevel ved
  // lag som forsvar i djupna mot ei ANNA trusselklasse (ekte, distribuerte
  // IP-ar i eit reelt volum-åtak), ikkje fordi spoofing via desse headerane
  // faktisk er mogleg.
  var candidates = [
    firstHeaderPart(headers.get("x-forwarded-for")),
    headers.get("cf-connecting-ip") || "",
    headers.get("x-real-ip") || "",
  ];
  for (var i = 0; i < candidates.length; i++) {
    var normalized = normalizeIp(candidates[i]);
    if (normalized) return normalized;
  }
  return null;
}

function requestSite(headers) {
  var candidates = [headers.get("origin") || "", headers.get("referer") || ""];
  for (var i = 0; i < candidates.length; i++) {
    var value = candidates[i].trim();
    if (!value || value.toLowerCase() === "null") continue;
    try {
      var parsed = new URL(value);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      if (parsed.hostname) return parsed.host.toLowerCase();
    } catch (_err) {
      // Prøv neste server-motta header; Origin er aldri autentisering.
    }
  }
  return null;
}

async function sha256Hex(parts) {
  var bytes = new TextEncoder().encode(JSON.stringify(parts));
  var digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

function envValue(name, options) {
  var configured = name === "SUPABASE_URL"
    ? options.SUPABASE_URL
    : (name === "SUPABASE_SERVICE_ROLE_KEY" ? options.SUPABASE_SERVICE_ROLE_KEY : "");
  if (configured) return configured;
  if (typeof Deno !== "undefined") return Deno.env.get(name) || "";
  return "";
}

export async function handleSidetellingEvent(req, options) {
  options = options || {};
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Berre POST er støtta" }, 405);

  var rawBody = await req.text();
  if (!rawBody || rawBody.length > MAX_BODY_LENGTH) {
    return json({ error: "Ugyldig hendelse" }, 400);
  }

  var body;
  try {
    body = JSON.parse(rawBody);
  } catch (_err) {
    return json({ error: "Ugyldig hendelse" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Ugyldig hendelse" }, 400);
  }

  var type = typeof body.type === "string" ? body.type : "";
  var path = typeof body.path === "string" ? body.path : "";
  var referrer = body.referrer === null || body.referrer === undefined ? null : body.referrer;
  var ctaId = body.cta_id === null || body.cta_id === undefined ? null : body.cta_id;
  var deviceType = body.device_type === null || body.device_type === undefined ? null : body.device_type;
  var isBot = body.is_bot === true;

  if ((type !== "pageview" && type !== "cta") || !path.trim() || path.length > 300) {
    return json({ error: "Ugyldig hendelse" }, 400);
  }
  if (referrer !== null && (typeof referrer !== "string" || referrer.length > 200)) {
    return json({ error: "Ugyldig hendelse" }, 400);
  }
  if (ctaId !== null && (typeof ctaId !== "string" || CTA_IDS.indexOf(ctaId) === -1)) {
    return json({ error: "Ugyldig hendelse" }, 400);
  }
  if (deviceType !== null && (typeof deviceType !== "string" || DEVICE_TYPES.indexOf(deviceType) === -1)) {
    return json({ error: "Ugyldig hendelse" }, 400);
  }
  if (body.is_bot !== undefined && typeof body.is_bot !== "boolean") {
    return json({ error: "Ugyldig hendelse" }, 400);
  }

  var ip = requestIp(req.headers);
  var userAgent = (req.headers.get("user-agent") || "").trim();
  var site = requestSite(req.headers);
  if (!ip || !userAgent || !site) {
    return json({ error: "Mangler request-kontekst" }, 400);
  }

  var now = options.now instanceof Date ? options.now : new Date();
  var utcDay = now.toISOString().slice(0, 10);
  var dailyHash = await sha256Hex([
    "vibeverk-sidetelling-v1",
    utcDay,
    site.slice(0, 300),
    ip,
    userAgent.slice(0, 1000),
  ]);

  var supabaseUrl = envValue("SUPABASE_URL", options).replace(/\/$/, "");
  var serviceKey = envValue("SUPABASE_SERVICE_ROLE_KEY", options);
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Sidetelling er ikke konfigurert" }, 500);
  }

  var fetchImpl = options.fetch || fetch;
  var rpcResponse;
  try {
    rpcResponse = await fetchImpl(supabaseUrl + "/rest/v1/rpc/insert_analytics_event_service", {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "authorization": "Bearer " + serviceKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_session_id: dailyHash,
        p_type: type,
        p_path: path,
        p_referrer: referrer,
        p_cta_id: ctaId,
        p_device_type: deviceType,
        p_is_bot: isBot,
      }),
    });
  } catch (_err) {
    return json({ error: "Kunne ikke lagre hendelsen" }, 500);
  }

  if (!rpcResponse.ok) {
    return json({ error: "Kunne ikke lagre hendelsen" }, 500);
  }

  var inserted = await rpcResponse.json().catch(function () { return false; });
  // Kvotetak er eit stille analyseavvik, aldri ein brukarfeil eller eit signal
  // om den private kvotestatusen. Sida skal fungere heilt normalt vidare.
  if (inserted !== true) return json({ ok: true }, 202);
  return json({ ok: true }, 202);
}
