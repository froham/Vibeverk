// supabase-control/supabase/functions/broker-ping/index.ts
// Phase 7 mechanism-proof for the control-plane broker pattern (see the
// vibeverk-architect design notes referenced from docs/decisions/ADR-0007's
// forthcoming control-plane/data-plane ADR). Deliberately minimal, mirrors
// supabase/functions/manage-user/index.ts's two-client pattern (anon-key
// client validates the caller, service-role client performs the privileged
// action) but here the privileged action crosses into ANOTHER project's
// service_role, decrypted from Vault.
//
// Scope: prove the full chain works end to end — operator auth -> tenant
// lookup -> Vault secret decrypt -> cross-project service-role call —
// without mutating anything. Full write-side customer-management actions
// are Phase 8 scope, once Console exists to call them.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Ikkje autorisert" }, 401);

  const controlUrl      = Deno.env.get("SUPABASE_URL")!;
  const controlAnonKey  = Deno.env.get("SUPABASE_ANON_KEY")!;
  const controlSrvKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verify the caller is a real, logged-in control-plane operator.
  const callerSb = createClient(controlUrl, controlAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await callerSb.auth.getUser();
  if (authErr || !user) return json({ error: "Ugyldig token" }, 401);

  const { data: operator } = await callerSb
    .from("operators").select("status").eq("id", user.id).single();
  if (!operator || operator.status !== "active") {
    return json({ error: "Berre aktive operatørar" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const { tenant_id } = body;
  if (!tenant_id) return json({ error: "tenant_id er påkrevd" }, 400);

  const controlSrvSb = createClient(controlUrl, controlSrvKey);

  const { data: tenant, error: tenantErr } = await controlSrvSb
    .from("tenants").select("id, slug, data_plane_url").eq("id", tenant_id).single();
  if (tenantErr || !tenant) return json({ error: "Ukjend tenant" }, 404);

  // The one place the Vault secret is ever decrypted — via the control
  // plane's own service-role client, never exposed to the caller.
  const { data: tenantServiceKey, error: keyErr } = await controlSrvSb
    .rpc("get_tenant_service_role_key", { p_tenant_id: tenant_id });
  if (keyErr || !tenantServiceKey) {
    return json({ error: "Fann ikkje service_role-nøkkel" }, 500);
  }

  // Cross-project service-role call: trivial, read-only, proves the chain.
  const tenantSrvSb = createClient(tenant.data_plane_url, tenantServiceKey);
  const { error: listErr } = await tenantSrvSb.auth.admin.listUsers({ perPage: 1 });
  if (listErr) return json({ error: "Kryss-prosjekt-kall feila" }, 500);

  return json({
    success: true,
    tenant_slug: tenant.slug,
    data_plane_reachable: true,
  });
});
