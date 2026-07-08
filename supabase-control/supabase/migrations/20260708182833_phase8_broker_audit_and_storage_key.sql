-- Phase 8 schema additions (SaaS-scaling plan): Console auth + real broker
-- actions beyond the Phase 7 ping mechanism-proof. Designed by the
-- vibeverk-architect subagent, 2026-07-08.

-- =============================================================================
-- tenants.data_plane_storage_key — the tenant-scoped "tenant_id" value each
-- customer's own `store` table rows are keyed to (config.js's storageKey,
-- e.g. "nordpunkt" for the current customer). Needed so the broker Edge
-- Function knows which store rows belong to a given tenant, without
-- hardcoding a single customer's value.
-- =============================================================================
ALTER TABLE tenants ADD COLUMN data_plane_storage_key text NOT NULL DEFAULT 'site';

UPDATE tenants SET data_plane_storage_key = 'nordpunkt' WHERE slug = 'vibeverk';

-- =============================================================================
-- broker_audit_log — append-only record of every action the broker Edge
-- Function performs on an operator's behalf. Readable by any active
-- operator; writable ONLY by the broker's own service-role connection
-- (which bypasses RLS entirely) — no INSERT/UPDATE/DELETE policy exists for
-- `authenticated` at all, so a compromised operator session can read
-- history but never tamper with it. Never store secret VALUES here, only
-- that an action happened.
-- =============================================================================
CREATE TABLE broker_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid REFERENCES operators(id),
  tenant_id    uuid REFERENCES tenants(id),
  action       text NOT NULL,
  result       text NOT NULL CHECK (result IN ('success', 'error')),
  detail       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE broker_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON broker_audit_log FROM PUBLIC, anon;
GRANT SELECT ON broker_audit_log TO authenticated;

CREATE POLICY broker_audit_log_operator_read ON broker_audit_log
  FOR SELECT TO authenticated
  USING (is_control_plane_operator());

-- Deliberately no INSERT/UPDATE/DELETE policy for `authenticated` — only the
-- broker Edge Function's service_role connection may write, via a direct
-- Postgres connection that bypasses RLS.
