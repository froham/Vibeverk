-- Security Auditor finding H2, closed 2026-07-09 (see docs/decisions/ADR-0007's
-- Phase 6 addendum and the pre-merge Security Auditor review section there
-- for the original finding).
--
-- resolve_tenant_by_hostname() was widened (previous Phase 6 migration,
-- 20260709170108) to also resolve 'provisioning' tenants -- necessary to
-- break the circular dependency where routing could never be verified for
-- a tenant that wasn't resolvable yet. But as written, this meant a
-- tenant's real hostname (and its real data_plane_url/anon_key) became
-- fully publicly servable the moment steps 1-3 of the onboarding checklist
-- were done (register + connection + secret) -- well before step 4
-- (schema/RLS verification) had ever run. A freshly `db push`-ed project
-- with RLS not yet enabled on some table would already be reachable by
-- any visitor of that hostname.
--
-- This migration narrows the window: a 'provisioning' tenant is now only
-- resolvable once schema_verified_at is set (step 4 passed), not from the
-- moment it merely has a hostname + connection registered. This still
-- allows the intended flow to work end-to-end -- verify_tenant_routing
-- (step 5) always runs AFTER verify_tenant_schema (step 4) in the
-- checklist, so schema_verified_at is already set by the time routing
-- verification needs the tenant to resolve. No circularity introduced:
-- verify_tenant_schema itself never depends on resolve_tenant_by_hostname
-- (it reaches the tenant's project directly via the already-known
-- data_plane_url column, not via anon hostname resolution).
--
-- Return type is unchanged from the previous version, so this is a plain
-- CREATE OR REPLACE (unlike the DROP+CREATE the prior migration needed).
CREATE OR REPLACE FUNCTION resolve_tenant_by_hostname(p_hostname text)
RETURNS TABLE (
  data_plane_url text,
  data_plane_anon_key text,
  data_plane_storage_key text,
  theme jsonb,
  product_mode text,
  enabled_modules jsonb,
  custom_modules_manifest jsonb
)
SECURITY DEFINER STABLE SET search_path = public
LANGUAGE sql AS $$
  SELECT data_plane_url, data_plane_anon_key, data_plane_storage_key, theme, product_mode, enabled_modules, custom_modules_manifest
  FROM tenants
  WHERE lower(p_hostname) = ANY(hostnames)
    AND (status = 'active' OR (status = 'provisioning' AND schema_verified_at IS NOT NULL));
$$;
-- CREATE OR REPLACE preserves existing grants, but restated explicitly per
-- this repo's standing discipline around Supabase's default-ACL gotcha --
-- verify via a real anon-key REST call after deploying, not just a clean
-- migration exit code.
REVOKE ALL ON FUNCTION resolve_tenant_by_hostname(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_hostname(text) TO anon;

NOTIFY pgrst, 'reload schema';
