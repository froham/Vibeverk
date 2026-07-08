-- Security Auditor finding M2 (2026-07-08, Phase 8 review): the original
-- tenants_operator_all policy gave every active operator's ordinary
-- `authenticated` PostgREST session full CRUD on `tenants` directly,
-- bypassing the broker Edge Function entirely -- meaning a compromised or
-- malicious operator session could silently repoint data_plane_url or flip
-- status (suspended/archived) with zero entry in broker_audit_log, since
-- only the broker function writes there. Narrowed to read-only; any future
-- operator-initiated tenant-metadata change should go through a dedicated,
-- audited broker action instead, matching the pattern already used for
-- superconfig (set_config/reset_config).
DROP POLICY tenants_operator_all ON tenants;

CREATE POLICY tenants_operator_read ON tenants
  FOR SELECT TO authenticated
  USING (is_control_plane_operator());

-- No INSERT/UPDATE/DELETE policy for `authenticated` at all now -- tenant
-- writes happen only via the Dashboard SQL editor (service_role/postgres,
-- bypasses RLS) until a real, audited broker action for tenant management
-- is built.
