-- Security Auditor follow-up round 2 (2026-07-09), findings against
-- tenant-admin/index.ts and broker/index.ts. See docs/decisions/ADR-0010
-- and docs/project/CHANGELOG.md for the earlier Phase 9 follow-up
-- (M1/M2/M3, commit c813542) this builds on.
--
-- Finding 2 (persist schema verification so activate_tenant can check it,
-- not just routing_verified_at):
ALTER TABLE tenants ADD COLUMN schema_verified_at timestamptz;

COMMENT ON COLUMN tenants.schema_verified_at IS
  'Set by tenant-admin''s verify_tenant_schema action on a passing check, '
  'cleared back to NULL on a failing one -- a stale pass must not linger. '
  'activate_tenant now requires this to be non-null, in addition to '
  'routing_verified_at.';

-- Finding 5 (DB-level constraint, not just Edge Function validation, for
-- data_plane_url -- allows the empty string used during provisioning
-- before update_tenant_connection has run):
ALTER TABLE tenants ADD CONSTRAINT tenants_data_plane_url_format
  CHECK (data_plane_url = '' OR data_plane_url ~ '^https://[a-z0-9]+\.supabase\.co/?$');

-- Finding 4 (fail-closed audit logging for mutating actions): broker_audit_log
-- previously only allowed a terminal 'success'/'error' result, written AFTER
-- the privileged action already happened -- an insert failure here was
-- silently swallowed (console.error only) and the action proceeded anyway.
-- Adding 'pending' lets mutating actions write the audit row FIRST and abort
-- if that write fails, then flip it to 'success'/'error' once the action
-- completes. An audit row stuck on 'pending' is itself a useful forensic
-- signal (action started, but the process didn't reach the update step).
ALTER TABLE broker_audit_log DROP CONSTRAINT IF EXISTS broker_audit_log_result_check;
ALTER TABLE broker_audit_log ADD CONSTRAINT broker_audit_log_result_check
  CHECK (result IN ('pending', 'success', 'error'));
