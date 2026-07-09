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

-- Pre-merge Security Auditor review of the above (M1, TOCTOU): the Edge
-- Function's tenant.status === 'provisioning' checks for
-- update_tenant_connection/set_tenant_service_role_key/activate_tenant were
-- read-then-branch in application code, not enforced atomically by the
-- database. The two plain-table actions were fixed by repeating
-- `.eq("status", "provisioning")` on their own UPDATE calls in
-- tenant-admin/index.ts (no SQL change needed for those). This function is
-- the one write that happens via RPC instead of a direct .update() call, so
-- the same guard has to live here: the UPDATE now only applies while the
-- row is still 'provisioning', and a zero-row result raises an exception
-- rather than silently doing nothing (which would otherwise look identical
-- to success to a caller not checking rowcount).
CREATE OR REPLACE FUNCTION store_tenant_service_role_key(p_tenant_id uuid, p_key text, p_secret_name text)
RETURNS void
SECURITY DEFINER SET search_path = public, vault
LANGUAGE plpgsql AS $$
DECLARE
  v_secret_id uuid;
  v_updated_rows int;
BEGIN
  SELECT vault.create_secret(p_key, p_secret_name) INTO v_secret_id;
  UPDATE tenants SET data_plane_service_role_secret_id = v_secret_id, updated_at = now()
  WHERE id = p_tenant_id AND status = 'provisioning';
  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows = 0 THEN
    -- The Vault secret above was already created by this point -- accepted
    -- tradeoff: a rare, low-severity orphaned secret on this rejection path
    -- is preferable to wrapping the whole function in a row lock just to
    -- avoid it. The tenant row itself was never touched, so there's no
    -- inconsistency, only an unused secret to clean up eventually.
    RAISE EXCEPTION 'tenant % is not in status provisioning (or does not exist)', p_tenant_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION store_tenant_service_role_key(uuid, text, text) FROM PUBLIC, anon, authenticated;
