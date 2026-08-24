// api/_lib/trace.js — W3C Trace Context (traceparent) helpers, shared by
// middleware.js and api/*.js. See docs/architecture/tracing.md for the full
// design rationale.
//
// One id per incoming request (or per page load, on the client side). Never
// persisted anywhere (no cookie, no localStorage, no DB row) -- purely
// in-flight header plumbing so a request can be correlated across Vercel's
// logs and Supabase's own logs (which now parse `traceparent` natively),
// without building a separate log aggregator. Format: standard
// `00-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>`, flags hardcoded to
// `01` ("sampled") since there's no sampling decision to make at this volume.

var TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

function randomHex(byteLength) {
  var bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  var hex = "";
  for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

export function generateTraceparent() {
  return "00-" + randomHex(16) + "-" + randomHex(8) + "-01";
}

// Reuses an incoming traceparent verbatim if it's well-formed (lets a trace
// id survive a hop between our own functions), otherwise mints a fresh one.
export function getOrCreateTraceparent(request) {
  var incoming = (request && request.headers && request.headers.get("traceparent")) || "";
  return TRACEPARENT_RE.test(incoming) ? incoming : generateTraceparent();
}
