// supabase-control/supabase/functions/alert-key-decrypt-anomaly/index.ts
//
// Fase 3 (av 3, siste) i logging/varsling-planen for
// get_tenant_service_role_key() -- sjå Fase 1 (key_decrypt_log) og Fase 2
// (alert-support-access) for full kontekst. Kalla frå ein pg_cron-poll kvar
// 5. minutt (check_key_decrypt_anomaly(), same migrasjon som denne fila vart
// lagt til i), IKKJE ein synkron trigger på kvart einaste kall -- signalet
// her er eit MØNSTER over tid (meir enn 1 distinkt tenant_id dekryptert
// innanfor eit rullerande 15-minutters-vindauge), ikkje ei enkelthending.
//
// Kalibrert mot 11 dagar reell trafikk FØR utrulling (sjå migrasjonsfila sin
// eigen kommentar) -- terskelen er uendra frå det opphavlege forslaget, ikkje
// eit gjett. Ein enkel 30-minutters cooldown (key_decrypt_alert_state-
// tabellen) hindrar at éi samanhengande hending sender fleire duplikat-
// e-postar etter kvarandre.
//
// Same auth-/leverings-mønster som alert-support-access: eksplisitt
// service_role-nøkkel-samanlikning (ikkje generell JWT-godkjenning, sidan
// prosjektet sin eigen anon-nøkkel elles også er ein gyldig, utilsikta
// signert JWT), Resend for sjølve e-posten.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface TenantCallCount {
  tenant_slug?: string | null;
  tenant_hostname?: string | null;
  calls?: number;
}

interface AlertPayload {
  distinct_tenants?: number;
  window_minutes?: number;
  tenants?: TenantCallCount[];
  called_at?: string;
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Berre POST er støtta" }, 405);

  const controlSrvKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") || "";
  if (auth !== `Bearer ${controlSrvKey}`) {
    return json({ error: "Ikkje tilgjengeleg" }, 401);
  }

  const alertEmail = Deno.env.get("SECURITY_ALERT_EMAIL");
  if (!alertEmail) {
    console.error("[alert-key-decrypt-anomaly] SECURITY_ALERT_EMAIL ikkje satt i secrets");
    return json({ error: "SECURITY_ALERT_EMAIL ikkje satt i secrets" }, 500);
  }
  const resendApiKey = Deno.env.get("TENANT_SMTP_RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("[alert-key-decrypt-anomaly] TENANT_SMTP_RESEND_API_KEY ikkje satt i secrets");
    return json({ error: "TENANT_SMTP_RESEND_API_KEY ikkje satt i secrets" }, 500);
  }
  const fromEmail = Deno.env.get("TENANT_SMTP_SENDER_EMAIL") || "noreply@vibeverk.no";

  let payload: AlertPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON i førespurnaden" }, 400);
  }
  const distinctTenants = payload.distinct_tenants ?? "?";
  const windowMinutes = payload.window_minutes ?? 15;
  const whenLabel = payload.called_at || new Date().toISOString();
  const tenants = Array.isArray(payload.tenants) ? payload.tenants : [];

  const tenantLines = tenants.length
    ? tenants
        .map((t) => `  - ${t.tenant_hostname || t.tenant_slug || "(ukjend tenant)"}: ${t.calls ?? "?"} kall`)
        .join("\n")
    : "  (ingen detaljar tilgjengeleg)";

  const subject = `Uvanleg nøkkel-dekrypteringsmønster: ${distinctTenants} ulike kundar på ${windowMinutes} minutt`;
  const text =
    `get_tenant_service_role_key() vart kalla for ${distinctTenants} ulike kundar innanfor eit rullerande ${windowMinutes}-minutters-vindauge -- ` +
    "ein operatør jobbar normalt mot éin kunde om gongen i Console, så fleire ulike kundar på kort tid kan vere heilt legitimt " +
    "(t.d. rask veksling mellom to kundeøkter), men kan òg vere teikn på ein lekka nøkkel/eit kompromittert Console-innlogg brukt til å hente ut fleire kundar sine data-plane-nøklar.\n\n" +
    "Kundar involvert i vindauget:\n" +
    tenantLines +
    "\n\n" +
    "Tidspunkt: " + whenLabel + "\n\n" +
    "Dette varselet er reint informativt (same filosofi som support-tilgang-varselet) -- sjekk broker_audit_log og key_decrypt_log " +
    "i vibeverk-control om du treng meir kontekst, t.d. kva operatør som var innlogga då dette skjedde.";

  const resendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `Vibeverk sikkerhet <${fromEmail}>`,
      to: [alertEmail],
      subject,
      text,
    }),
  });
  if (!resendResp.ok) {
    const errBody = await resendResp.text().catch(() => "");
    console.error("[alert-key-decrypt-anomaly] Resend feila", resendResp.status, errBody);
    return json({ error: "Resend returnerte feil" }, 502);
  }

  return json({ success: true });
});
