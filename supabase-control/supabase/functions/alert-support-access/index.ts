// supabase-control/supabase/functions/alert-support-access/index.ts
//
// Fase 2 (av 3) i logging/varsling-planen for get_tenant_service_role_key()/
// generate_support_access -- sjå Fase 1, 20260903120000_key_decrypt_log.sql,
// og Arkitekt-forslaget frå same runde for full grunngjeving.
//
// Sender Frode ei e-post kvar gong generate_support_access faktisk lykkast
// -- den einaste handlinga i tenant-admin som let ein operatør logge inn SOM
// ein eksisterande kunde-admin (impersonering via ei ekte, tidsavgrensa
// magic-link, aldri persistert nokon stad). Lågt volum, høgt signal --
// difor sanntids-varsling per hending, ikkje ein mønster-basert poll slik
// Fase 3 (get_tenant_service_role_key-mengde-anomali) vil vere.
//
// Utløysing: ein Postgres AFTER UPDATE-trigger på broker_audit_log (sjå
// migrasjonen i same PR) -- IKKJE ein direkte operatør-autentisert veg,
// sidan denne funksjonen har ingen menneskeleg brukar bak seg. Same
// eksplisitte service_role-nøkkel-samanlikning som retention-sweep bruker
// (ikkje generell JWT-godkjenning), av same grunn: prosjektet sin eigen
// anon-nøkkel er elles også ein gyldig, utilsikta signert JWT.
//
// Sender ALDRI sjølve magic-lenka -- ho vert aldri persistert nokon stad
// (uendra frå før denne runda) og trigger-funksjonen har uansett ikkje
// tilgang til ho, berre til metadata (kven, kva tenant, når).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface AlertPayload {
  tenant_slug?: string;
  tenant_hostname?: string;
  operator_email?: string;
  target_email?: string;
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
    console.error("[alert-support-access] SECURITY_ALERT_EMAIL ikkje satt i secrets");
    return json({ error: "SECURITY_ALERT_EMAIL ikkje satt i secrets" }, 500);
  }
  const resendApiKey = Deno.env.get("TENANT_SMTP_RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("[alert-support-access] TENANT_SMTP_RESEND_API_KEY ikkje satt i secrets");
    return json({ error: "TENANT_SMTP_RESEND_API_KEY ikkje satt i secrets" }, 500);
  }
  const fromEmail = Deno.env.get("TENANT_SMTP_SENDER_EMAIL") || "noreply@vibeverk.no";

  let payload: AlertPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON i førespurnaden" }, 400);
  }
  const tenantLabel = payload.tenant_hostname || payload.tenant_slug || "(ukjend tenant)";
  const operatorLabel = payload.operator_email || "(ukjend operatør)";
  const targetLabel = payload.target_email || "(ukjend mål-e-post)";
  const whenLabel = payload.called_at || new Date().toISOString();

  const subject = "Support-tilgang generert: " + tenantLabel;
  const text =
    "Ein Vibeverk-operatør genererte nettopp support-tilgang (impersonering) mot ein kunde.\n\n" +
    "Kunde: " + tenantLabel + "\n" +
    "Operatør: " + operatorLabel + "\n" +
    "Målbrukar (kven operatøren kan logge inn som): " + targetLabel + "\n" +
    "Tidspunkt: " + whenLabel + "\n\n" +
    "Sjølve tilgangslenka er ikkje inkludert her og er aldri lagra nokon stad " +
    "-- ho er einbruks og tidsavgrensa. Dette varselet er reint informativt; " +
    "sjekk broker_audit_log i vibeverk-control om du treng meir kontekst.";

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
    console.error("[alert-support-access] Resend feila", resendResp.status, errBody);
    return json({ error: "Resend returnerte feil" }, 502);
  }

  return json({ success: true });
});
