// supabase-control/supabase/functions/retention-sweep/index.ts
//
// Fase 1 (grunnmur) av automatisert lead-retensjon -- Arkitekt-planlagt
// 2026-08-12, sjå docs/compliance/personvern-rammeverk-status-2026-08-12.md
// del 2 for slettefristforslaget dette byggjer på ("kontaktskjema-leads,
// 12 md. etter -- her: opprettinga, sjå grunngjeving under -- deretter
// slett"), og PR-skildringa for full Arkitekt-vurdering.
//
// DENNE FUNKSJONEN SLETTAR ALDRI NOKO. Han tel berre kandidatar per aktiv
// tenant med retention_policy.leads.enabled=true og skriv resultatet til
// retention_runs (dry_run: true, rows_deleted/attachments_freed alltid 0).
// Faktisk sletting er eit HELT SEPARAT, seinare kodesteg (Fase 3) som må
// gjennom ein eigen Security Auditor-pass før han rullast ut for nokon
// kunde -- ikkje eit policy-flip i denne fila.
//
// Kvifor "opprettinga" og ikkje "siste aktivitet": leads-tabellen har i
// dag ingen updated_at-kolonne (kun created_at) -- updateLead() i core.js
// endrar status utan å røre noko tidsstempel. "Siste aktivitet" er difor
// ikkje målbart utan ei separat skjemaendring; dokumentert her som ei
// medviten, mellombels forenkling for bevis-fasen, ikkje ei forgløymt
// avgrensing.
//
// Utløysing: tiltenkt kalla av eit pg_cron-job (via net.http_post) inne i
// dette same kontrollplan-prosjektet -- IKKJE av broker/tenant-admin sine
// operatør-autentiserte vegar, sidan denne funksjonen har ingen menneskeleg
// brukar bak seg. Autentisering er difor eit direkte, eksplisitt
// service_role-nøkkel-samanlikning (ikkje generell JWT-godkjenning), sidan
// prosjektet sin eigen anon-nøkkel elles også ville vore ein gyldig,
// utilsikta signert JWT mot denne funksjonen.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RETENTION_MONTHS_DEFAULT = 12;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const controlUrl    = Deno.env.get("SUPABASE_URL")!;
  const controlSrvKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Berre den faktiske service_role-nøkkelen (aldri anon-nøkkelen, aldri ein
  // operatør-JWT) får kalle denne funksjonen -- ho har ingen operatør-
  // autentiseringsveg i det heile, sidan ho er meint kalla av pg_cron, ikkje
  // ein innlogga person.
  const auth = req.headers.get("Authorization") || "";
  if (auth !== `Bearer ${controlSrvKey}`) {
    return json({ error: "Ikkje tilgjengeleg" }, 401);
  }

  const controlSrvSb = createClient(controlUrl, controlSrvKey);

  const { data: tenants, error: tenantsErr } = await controlSrvSb
    .from("tenants")
    .select("id, slug, data_plane_url, retention_policy")
    .eq("status", "active");
  if (tenantsErr) {
    return json({ error: "Fann ikkje tenants: " + tenantsErr.message }, 500);
  }

  const results: unknown[] = [];

  for (const tenant of tenants || []) {
    const leadsPolicy = (tenant.retention_policy || {})?.leads || {};
    if (!leadsPolicy.enabled) continue; // eksplisitt opt-in, default av

    const months = typeof leadsPolicy.months === "number" ? leadsPolicy.months : RETENTION_MONTHS_DEFAULT;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    let candidatesFound = 0;
    let errorMsg: string | null = null;

    try {
      const { data: tenantServiceKey, error: keyErr } = await controlSrvSb
        .rpc("get_tenant_service_role_key", { p_tenant_id: tenant.id });
      if (keyErr || !tenantServiceKey) {
        throw new Error("fann ikkje service_role-nøkkel");
      }

      const tenantSrvSb = createClient(tenant.data_plane_url, tenantServiceKey);
      const { count, error: countErr } = await tenantSrvSb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .lt("created_at", cutoff.toISOString());
      if (countErr) throw new Error(countErr.message);
      candidatesFound = count || 0;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    const { error: logErr } = await controlSrvSb.from("retention_runs").insert({
      tenant_id: tenant.id,
      category: "leads",
      dry_run: true,
      candidates_found: candidatesFound,
      rows_deleted: 0,
      attachments_freed: 0,
      error: errorMsg,
    });
    if (logErr) {
      console.error("[retention-sweep] KRITISK: kunne ikkje skrive retention_runs", { tenant: tenant.slug, logErr: logErr.message });
    }

    results.push({ tenant: tenant.slug, candidatesFound, error: errorMsg });
  }

  return json({ success: true, dryRun: true, results });
});
