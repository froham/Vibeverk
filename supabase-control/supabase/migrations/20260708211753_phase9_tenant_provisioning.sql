-- Phase 9 (SaaS-scaling plan): semi-automated onboarding v1, narrowly scoped
-- per the Architect's recommendation (2026-07-08) -- this builds the
-- checklist/bookkeeping machinery only. No tenant onboarded through this
-- can be marked 'active' until Phase 6's real hostname->tenant resolver
-- exists in production (see routing_verified_at below).

-- =============================================================================
-- routing_verified_at -- a hard, structural gate. Only a future Phase 6
-- resolver-verification process may ever set this (never operator
-- self-report, never set by any function added in this migration).
-- activate_tenant (see tenant-admin Edge Function) refuses to proceed
-- while this is NULL.
-- =============================================================================
ALTER TABLE tenants ADD COLUMN routing_verified_at timestamptz;

-- =============================================================================
-- store_tenant_service_role_key -- the one place a tenant's data-plane
-- service_role key is ever written, via vault.create_secret(). Restricted
-- to service_role/postgres only (never anon/authenticated/PUBLIC, per the
-- Phase 7 default-ACL gotcha already documented in CLAUDE.md) -- callable
-- only from inside the tenant-admin Edge Function's service-role
-- connection, same pattern as get_tenant_service_role_key().
-- =============================================================================
CREATE OR REPLACE FUNCTION store_tenant_service_role_key(p_tenant_id uuid, p_key text, p_secret_name text)
RETURNS void
SECURITY DEFINER SET search_path = public, vault
LANGUAGE plpgsql AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  SELECT vault.create_secret(p_key, p_secret_name) INTO v_secret_id;
  UPDATE tenants SET data_plane_service_role_secret_id = v_secret_id, updated_at = now()
  WHERE id = p_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION store_tenant_service_role_key(uuid, text, text) FROM PUBLIC, anon, authenticated;
