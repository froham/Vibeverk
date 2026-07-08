-- Security Auditor finding M3 (2026-07-09, Phase 9 follow-up review): the
-- original operators_operator_all policy gave every active operator's
-- ordinary authenticated PostgREST session full CRUD on the operators
-- table directly -- meaning any active operator could PATCH another
-- operator's row (including self-escalating role to 'superadmin', or
-- disabling a colleague) with zero entry in broker_audit_log, since
-- nothing writes there for direct table access. Same class of gap as the
-- tenants_operator_all fix from Phase 8 (20260708204201) -- narrowed the
-- same way. Any future operator-management write (invite, role change,
-- disable) should go through a dedicated, audited broker/tenant-admin
-- action instead, not a direct table write.
DROP POLICY operators_operator_all ON operators;

CREATE POLICY operators_operator_read ON operators
  FOR SELECT TO authenticated
  USING (is_control_plane_operator());

-- operators_self_read (auth.uid() = id) already covers an operator reading
-- their own row even before this policy; kept unchanged. No
-- INSERT/UPDATE/DELETE policy for `authenticated` at all now -- operator
-- writes happen only via the Dashboard SQL editor (service_role/postgres,
-- bypasses RLS) until a real, audited operator-management action is built.
