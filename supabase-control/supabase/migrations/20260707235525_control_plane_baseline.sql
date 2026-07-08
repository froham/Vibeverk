-- vibeverk-control baseline schema (Phase 7 of the SaaS-scaling plan)
-- Designed by the vibeverk-architect subagent, 2026-07-08. See
-- docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md and the
-- new control-plane/data-plane split ADR (to be drafted once this is
-- pushed and verified) for full rationale.

-- =============================================================================
-- operators — real Supabase Auth users, replaces SUPERADMIN_EMAILS (JS) /
-- is_platform_operator() (SQL) duplication in each per-customer project.
-- =============================================================================
CREATE TABLE operators (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  display_name text,
  role         text NOT NULL DEFAULT 'operator' CHECK (role IN ('operator', 'superadmin')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  invited_by   uuid REFERENCES operators(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION is_control_plane_operator()
RETURNS boolean
SECURITY DEFINER STABLE SET search_path = public
LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM operators WHERE id = auth.uid() AND status = 'active');
$$;
REVOKE ALL ON FUNCTION is_control_plane_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_control_plane_operator() TO authenticated;

-- =============================================================================
-- tenants — one row per customer. data_plane_service_role_secret_id points
-- into Supabase Vault; the raw key is NEVER stored as a plain column here.
-- =============================================================================
CREATE TABLE tenants (
  id                                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                               text UNIQUE NOT NULL,
  hostnames                          text[] NOT NULL DEFAULT '{}',
  data_plane_url                     text NOT NULL,
  data_plane_anon_key                text NOT NULL,
  data_plane_service_role_secret_id  uuid REFERENCES vault.secrets(id),
  theme                              jsonb NOT NULL DEFAULT '{}',
  product_mode                       text NOT NULL DEFAULT 'web' CHECK (product_mode IN ('web', 'workspace', 'full')),
  enabled_modules                    jsonb NOT NULL DEFAULT '{}',
  custom_modules_manifest            jsonb NOT NULL DEFAULT '{}',
  status                             text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'active', 'suspended', 'archived')),
  provisioning_status                jsonb NOT NULL DEFAULT '{}',
  created_by                         uuid REFERENCES operators(id),
  created_at                         timestamptz NOT NULL DEFAULT now(),
  updated_at                         timestamptz NOT NULL DEFAULT now()
);

-- Narrow accessor for the Vault-stored service_role key. Granted to NO
-- PostgREST-reachable role — only callable from a service_role Postgres
-- connection, i.e. only from inside the broker Edge Function.
CREATE OR REPLACE FUNCTION get_tenant_service_role_key(p_tenant_id uuid)
RETURNS text
SECURITY DEFINER SET search_path = public, vault
LANGUAGE sql AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets
  JOIN tenants ON tenants.data_plane_service_role_secret_id = vault.decrypted_secrets.id
  WHERE tenants.id = p_tenant_id;
$$;
REVOKE ALL ON FUNCTION get_tenant_service_role_key(uuid) FROM PUBLIC, anon, authenticated;

-- Anon-safe hostname resolver. Explicit column list (not SETOF tenants) is
-- a structural guardrail: adding a column to tenants later cannot leak it
-- through this function.
CREATE OR REPLACE FUNCTION resolve_tenant_by_hostname(p_hostname text)
RETURNS TABLE (
  data_plane_url text,
  data_plane_anon_key text,
  theme jsonb,
  product_mode text,
  enabled_modules jsonb,
  custom_modules_manifest jsonb
)
SECURITY DEFINER STABLE SET search_path = public
LANGUAGE sql AS $$
  SELECT data_plane_url, data_plane_anon_key, theme, product_mode, enabled_modules, custom_modules_manifest
  FROM tenants
  WHERE p_hostname = ANY(hostnames) AND status = 'active';
$$;
REVOKE ALL ON FUNCTION resolve_tenant_by_hostname(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_hostname(text) TO anon;

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

GRANT ALL ON operators, tenants TO authenticated;
REVOKE ALL ON operators, tenants FROM anon;

CREATE POLICY operators_self_read ON operators
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY operators_operator_all ON operators
  FOR ALL TO authenticated
  USING (is_control_plane_operator())
  WITH CHECK (is_control_plane_operator());

CREATE POLICY tenants_operator_all ON tenants
  FOR ALL TO authenticated
  USING (is_control_plane_operator())
  WITH CHECK (is_control_plane_operator());
