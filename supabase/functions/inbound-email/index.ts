// inbound-email — mottek Resend sin "email.received"-webhook, verifiserer
// og lagrar via process_inbound_email()-RPC-en (sjå
// supabase/migrations/20260717120000_inbound_email.sql).
//
// Krev: RESEND_API_KEY (alt sett for send-reply), RESEND_WEBHOOK_SECRET
// (whsec_-verdien frå Resend sitt webhook-oppsett — IKKJE same som
// RESEND_API_KEY), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Fail-closed rekkefølgje (Security Auditor-gjennomgang 2026-07-17, H2/H3 —
// ikkje-forhandlbart): svix-signaturverifisering skjer FØRST, før NOKO anna
// (inkl. Resend-hentekallet). Feilar verifiseringa, stoppar alt her — ingen
// DB-skriving, ingen Resend-kall. Bruker det offisielle svix-biblioteket
// (handterer tidsstempel-/repriseverm sjølv), ikkje eigenutvikla HMAC.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Webhook } from "https://esm.sh/svix@1.97.0?target=deno";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Domene-autentisering (H1 — In-Reply-To/References åleine er forfalskbare
// headera, må ALLTID krevje eit reelt SPF+DKIM-pass, både for matcha tråd-
// innsetjingar og ny-oppretting, ikkje mindre strengt for nokon av dei).
// Resend dokumenterer ikkje eit eige spf/dkim-felt i verken webhook-nyttelasta
// eller GET /emails/receiving/{id} (stadfesta via dokumentasjonssøk 2026-07-17)
// — hentar det i staden ut av den rå "authentication-results"-e-postheaderen,
// same konvensjon dei fleste mottakande mailtenarar (Gmail, Postfix, m.fl.)
// alt bruker. Manglar denne headeren heilt, tel IKKJE som pass (fail-closed:
// eit fråvær av signal er IKKJE det same som eit stadfesta signal) — sjå
// kjend-avgrensing-notatet i ROADMAP.md, bør stadfestast med ein ekte
// testepost etter fyrste deploy, ikkje anteke frå dokumentasjon åleine.
function parseAuthResults(headers: Record<string, string>): { spf: string | null; dkim: string | null; dmarc: string | null; pass: boolean } {
  var raw = headers["authentication-results"] || "";
  var spfM  = raw.match(/\bspf=(\w+)/i);
  var dkimM = raw.match(/\bdkim=(\w+)/i);
  var dmarcM = raw.match(/\bdmarc=(\w+)/i);
  var spf   = spfM  ? spfM[1].toLowerCase()  : null;
  var dkim  = dkimM ? dkimM[1].toLowerCase() : null;
  var dmarc = dmarcM ? dmarcM[1].toLowerCase() : null;
  return { spf, dkim, dmarc, pass: spf === "pass" && dkim === "pass" };
}

// Resend sin "references"-header er ei mellomromsskild liste med Message-ID-ar
// (RFC 5322-format, kvar innpakka i <>) — same eldre-meldingar-i-tråden-
// konvensjon alle e-postklientar brukar.
function parseReferences(headers: Record<string, string>): string[] {
  var raw = headers["references"] || "";
  return raw.split(/\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
}

// "From"-headeren er heile "Vise Namn <adresse@domene>"-forma, ikkje berre
// visingsnamnet — utan denne parsinga hamna heile den rå headeren i
// crm_customers.name (funne av kode-nivå Security-gjennomgang 2026-07-17,
// datakvalitets-hol, ikkje ein trygleikssårbarheit — verdien vert alltid
// esc()-a ved vising).
function parseDisplayName(fromHeader: string): string {
  var m = fromHeader.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
  return m ? m[1].trim() : "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });
  if (req.method !== "POST") return json({ error: "Kun POST" }, 405);

  // Rå tekst FØR JSON-parsing — svix-verifisering MÅ få den upåverka
  // request-kroppen, JSON-parsing+re-stringifisering ville øydelagt signaturen
  // (eksplisitt dokumentert åtvaring frå Resend/svix).
  const rawBody = await req.text();

  const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!webhookSecret) return json({ error: "RESEND_WEBHOOK_SECRET ikkje satt i secrets" }, 500);

  let event: any;
  try {
    const wh = new Webhook(webhookSecret);
    event = wh.verify(rawBody, {
      "svix-id":        req.headers.get("svix-id") || "",
      "svix-timestamp": req.headers.get("svix-timestamp") || "",
      "svix-signature": req.headers.get("svix-signature") || "",
    });
  } catch (e) {
    // Fail-closed: ugyldig/manglande signatur stoppar alt her, ingen
    // Resend-henting, ingen DB-skriving.
    return json({ error: "Ugyldig webhook-signatur" }, 401);
  }

  if (!event || event.type !== "email.received") {
    return json({ ok: true, ignored: true });
  }

  const emailId = event.data && event.data.email_id;
  if (!emailId) return json({ error: "Manglar email_id" }, 400);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "RESEND_API_KEY ikkje satt i secrets" }, 500);

  const resp = await fetch("https://api.resend.com/emails/receiving/" + emailId, {
    headers: { "Authorization": "Bearer " + apiKey },
  });
  if (!resp.ok) return json({ error: "Klarte ikkje hente e-postinnhald frå Resend" }, 502);
  const full = await resp.json();

  const headers: Record<string, string> = full.headers || {};
  const auth = parseAuthResults(headers);
  const inReplyTo = headers["in-reply-to"] || "";
  const refs = parseReferences(headers);

  // Berre eit avgrensa utval av headera vert lagra i inbound_emails.headers
  // (revisjonsspor-formålet, sjå migrasjonen) — IKKJE heile det rå Resend-
  // headerobjektet, som elles kan innehalde Received-kjeder med IP-adresser
  // til mellomliggande e-postserverar og andre mottakarar sine adresser
  // (Privacy-gjennomgang av koden 2026-07-17, data-minimering).
  const HEADER_ALLOWLIST = ["message-id", "from", "to", "subject", "date", "authentication-results", "in-reply-to", "references"];
  const loggedHeaders: Record<string, string> = {};
  HEADER_ALLOWLIST.forEach(function (k) { if (headers[k] !== undefined) loggedHeaders[k] = headers[k]; });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data, error } = await supabase.rpc("process_inbound_email", {
    p_id:          emailId,
    p_from_email:  full.from || "",
    p_from_name:   parseDisplayName(headers["from"] || ""),
    p_to_email:    Array.isArray(full.to) ? (full.to[0] || "") : (full.to || ""),
    p_subject:     full.subject || "",
    p_html:        full.html || null,
    p_text:        full.text || "",
    p_message_id:  full.message_id || null,
    p_in_reply_to: inReplyTo || null,
    p_refs:        refs,
    p_spf:         auth.spf,
    p_dkim:        auth.dkim,
    p_dmarc:       auth.dmarc,
    p_headers:     loggedHeaders,
    p_auth_pass:   auth.pass,
  });

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, result: data });
});
