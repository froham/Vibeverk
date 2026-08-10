// Server-only outbound HTTP client for Kundeanalyse.
//
// Security property: DNS is resolved and validated once for each request
// target, then Node's socket is forced to connect to that exact address via a
// custom lookup callback. The actual peer address is checked again after the
// connection is established. Redirects repeat the full process. This closes
// the DNS-rebinding gap left by "resolve, then ordinary fetch()".

import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

var DEFAULT_TIMEOUT_MS = 8000;
var DEFAULT_MAX_BYTES = 1024 * 1024;
var DEFAULT_MAX_REDIRECTS = 5;
var DEFAULT_USER_AGENT = "VibeverkKundeanalyse/1.0 (+https://vibeverk.no/kontakt)";

function AnalysisFetchError(code, message, status) {
  this.name = "AnalysisFetchError";
  this.code = code;
  this.message = message;
  this.status = status || 0;
  if (Error.captureStackTrace) Error.captureStackTrace(this, AnalysisFetchError);
}
AnalysisFetchError.prototype = Object.create(Error.prototype);
AnalysisFetchError.prototype.constructor = AnalysisFetchError;

var BLOCKED_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
];
var BLOCKED_V6 = [
  ["::", 128], ["::1", 128],
  ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["fc00::", 7],
  ["fe80::", 10], ["ff00::", 8]
];
var blockList = new net.BlockList();
BLOCKED_V4.forEach(function (entry) { blockList.addSubnet(entry[0], entry[1], "ipv4"); });
BLOCKED_V6.forEach(function (entry) { blockList.addSubnet(entry[0], entry[1], "ipv6"); });

function normalizeAddress(address) {
  var value = String(address || "").split("%")[0].toLowerCase();
  if (value.indexOf("::ffff:") === 0 && net.isIP(value.slice(7)) === 4) return value.slice(7);
  if (net.isIP(value) === 6) {
    try { return new URL("http://[" + value + "]").hostname.replace(/^\[|\]$/g, ""); }
    catch (e) { return ""; }
  }
  return value;
}

export function isBlockedAddress(address) {
  var normalized = normalizeAddress(address);
  var family = net.isIP(normalized);
  if (!family) return true;
  return blockList.check(normalized, family === 4 ? "ipv4" : "ipv6");
}

function hasBlockedHostnameSuffix(hostname) {
  var h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h || h.indexOf(".") === -1) return true;
  return ["localhost", "local", "internal", "intranet", "home", "lan", "localdomain", "test", "invalid", "example", "onion", "arpa"].some(function (suffix) {
    return h === suffix || h.endsWith("." + suffix);
  });
}

export function validateAnalysisUrl(input) {
  var parsed;
  try { parsed = new URL(String(input || "").trim()); }
  catch (e) { throw new AnalysisFetchError("invalid_url", "Nettadressen er ugyldig."); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AnalysisFetchError("blocked_protocol", "Bare HTTP og HTTPS er tillatt.");
  }
  if (parsed.username || parsed.password) {
    throw new AnalysisFetchError("credentials_not_allowed", "Nettadresser med brukernavn eller passord er ikke tillatt.");
  }
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    throw new AnalysisFetchError("blocked_port", "Bare standard webporter er tillatt.");
  }
  var hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (net.isIP(hostname) || hasBlockedHostnameSuffix(hostname)) {
    throw new AnalysisFetchError("blocked_hostname", "Interne vertsnavn og IP-adresser er ikke tillatt.");
  }
  parsed.hostname = hostname;
  parsed.hash = "";
  return parsed;
}

function equivalentWebHost(a, b) {
  function withoutWww(value) { return String(value || "").toLowerCase().replace(/^www\./, ""); }
  return withoutWww(a) === withoutWww(b);
}

async function resolvePinnedAddress(hostname, opts) {
  var resolver = opts && opts.resolve || dns.lookup;
  var timeoutMs = opts && opts.dnsTimeoutMs || 3000;
  var timer;
  var timeout = new Promise(function (_resolve, reject) {
    timer = setTimeout(function () { reject(new AnalysisFetchError("dns_timeout", "DNS-oppslaget tok for lang tid.")); }, timeoutMs);
  });
  var records;
  try {
    records = await Promise.race([resolver(hostname, { all: true, verbatim: true }), timeout]);
  } catch (e) {
    if (e instanceof AnalysisFetchError) throw e;
    throw new AnalysisFetchError("dns_failed", "Kunne ikke slå opp vertsnavnet.");
  } finally {
    clearTimeout(timer);
  }
  if (!Array.isArray(records) || !records.length) throw new AnalysisFetchError("dns_empty", "Vertsnavnet har ingen gyldig nettadresse.");
  var normalized = records.map(function (record) {
    var address = normalizeAddress(record.address);
    return { address: address, family: net.isIP(address) };
  });
  if (normalized.some(function (record) { return isBlockedAddress(record.address); })) {
    throw new AnalysisFetchError("blocked_address", "Vertsnavnet peker til en privat eller reservert nettadresse.");
  }
  normalized.sort(function (a, b) { return a.family - b.family || a.address.localeCompare(b.address); });
  return normalized[0];
}

function requestPinned(parsed, pinned, opts) {
  var requestImpl = opts && opts.request;
  var transport = parsed.protocol === "https:" ? https : http;
  var timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  var maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES;
  var userAgent = opts.userAgent || process.env.CUSTOMER_ANALYSIS_USER_AGENT || DEFAULT_USER_AGENT;

  return new Promise(function (resolve, reject) {
    var finished = false;
    function fail(error) {
      if (finished) return;
      finished = true;
      reject(error instanceof AnalysisFetchError ? error : new AnalysisFetchError("network_error", "Kunne ikke hente siden."));
    }
    var requestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: "GET",
      agent: false,
      autoSelectFamily: false,
      servername: parsed.hostname,
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        "Connection": "close"
      },
      lookup: function (_hostname, lookupOptions, callback) {
        if (lookupOptions && lookupOptions.all) callback(null, [{ address:pinned.address, family:pinned.family }]);
        else callback(null, pinned.address, pinned.family);
      }
    };
    var req;
    try {
      req = requestImpl ? requestImpl(parsed, requestOptions) : transport.request(requestOptions);
    } catch (e) {
      fail(e);
      return;
    }
    req.once("socket", function (socket) {
      socket.once("connect", function () {
        var peer = normalizeAddress(socket.remoteAddress);
        if (!peer || peer !== normalizeAddress(pinned.address)) {
          req.destroy(new AnalysisFetchError("peer_mismatch", "Tilkoblingen gikk til en annen adresse enn den som ble kontrollert."));
        }
      });
    });
    req.setTimeout(timeoutMs, function () {
      req.destroy(new AnalysisFetchError("timeout", "Siden brukte for lang tid på å svare."));
    });
    req.once("error", fail);
    req.once("response", function (response) {
      var encoding = String(response.headers["content-encoding"] || "identity").toLowerCase();
      if (encoding !== "identity") {
        response.destroy();
        fail(new AnalysisFetchError("compressed_response", "Komprimerte svar kan ikke analyseres sikkert."));
        return;
      }
      var chunks = [];
      var bytes = 0;
      response.on("data", function (chunk) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy(new AnalysisFetchError("response_too_large", "Siden er større enn analysegrensen."));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", fail);
      response.once("end", function () {
        if (finished) return;
        finished = true;
        resolve({
          status: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
          pinnedAddress: pinned.address
        });
      });
    });
    req.end();
  });
}

export async function secureFetch(input, options) {
  var opts = Object.assign({
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBytes: DEFAULT_MAX_BYTES,
    maxRedirects: DEFAULT_MAX_REDIRECTS
  }, options || {});
  var current = validateAnalysisUrl(input);
  var initialHost = current.hostname;
  var redirects = [];
  var started = Date.now();

  for (var hop = 0; hop <= opts.maxRedirects; hop++) {
    if (opts.totalTimeoutMs && Date.now() - started >= opts.totalTimeoutMs) {
      throw new AnalysisFetchError("total_timeout", "Den samlede hentetiden ble for lang.");
    }
    var pinned = await resolvePinnedAddress(current.hostname, opts);
    var response = await requestPinned(current, pinned, opts);
    if (response.status >= 300 && response.status < 400) {
      var location = response.headers.location;
      if (!location) throw new AnalysisFetchError("redirect_without_location", "Siden svarte med en ufullstendig omdirigering.", response.status);
      if (hop === opts.maxRedirects) throw new AnalysisFetchError("too_many_redirects", "Siden har for mange omdirigeringer.");
      var next = validateAnalysisUrl(new URL(location, current).toString());
      if (!equivalentWebHost(initialHost, next.hostname)) {
        throw new AnalysisFetchError("cross_site_redirect", "Siden omdirigerer til et annet domene som ikke analyseres.", response.status);
      }
      if (current.protocol === "https:" && next.protocol !== "https:") {
        throw new AnalysisFetchError("redirect_downgrade", "Siden forsøkte å omdirigere fra HTTPS til ukryptert HTTP.", response.status);
      }
      redirects.push({ from: current.toString(), to: next.toString(), status: response.status });
      current = next;
      continue;
    }
    return {
      url: current.toString(),
      status: response.status,
      headers: response.headers,
      body: response.body,
      bytes: response.body.length,
      durationMs: Date.now() - started,
      redirectChain: redirects,
      pinnedAddress: response.pinnedAddress
    };
  }
  throw new AnalysisFetchError("too_many_redirects", "Siden har for mange omdirigeringer.");
}

export { AnalysisFetchError, equivalentWebHost };
