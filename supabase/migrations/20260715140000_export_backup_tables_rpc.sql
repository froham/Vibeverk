-- Admin-gated full-dataset export RPC for the Web-admin "Sikkerhetskopi"
-- backup/restore feature. Mirrors restore_backup_tables' access boundary
-- (is_admin_or_owner()) for the READ/export side, which had none until now.
--
-- Found by the Privacy/Compliance Advisor review (2026-07-15, see
-- docs/project/CHANGELOG.md): buildBackupPayload() in core.js is reachable
-- from any authenticated browser console session
-- (window.App.buildBackupPayload()), and RLS SELECT on these nine tables is
-- intentionally USING(true) for authenticated -- member/editor need this for
-- normal browsing in CRM/tasks/announcements/etc, a confirmed design
-- decision, see docs/project/CURRENT_STATE.md 2026-07-13 -- so nothing
-- stopped a non-admin from assembling the exact same full export by hand,
-- one table at a time, even though the "Sikkerhetskopi" button itself is
-- only ever shown to admin in the UI.
--
-- IMPORTANT, confirmed with the user (2026-07-15): this closes the
-- inconsistency where the backup FEATURE claims to be admin-only but had no
-- matching database-level enforcement -- it does NOT, and structurally
-- cannot without breaking normal CRM/leads/bookings/etc browsing for
-- editor/member, prevent a technically able member from still querying each
-- of these nine tables directly and reassembling the same data by hand.
-- That gap is inherent to the already-confirmed "member reads everything via
-- RLS" role model, not something a single aggregation function can close.

CREATE OR REPLACE FUNCTION export_backup_tables()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_admin_or_owner() THEN
    RAISE EXCEPTION 'Berre admin kan eksportere full sikkerhetskopi';
  END IF;

  SELECT jsonb_build_object(
    'crm_bedrifter', COALESCE((SELECT jsonb_agg(t) FROM crm_bedrifter t), '[]'::jsonb),
    'crm_customers', COALESCE((SELECT jsonb_agg(t) FROM crm_customers t), '[]'::jsonb),
    'crm_comms',     COALESCE((SELECT jsonb_agg(t) FROM crm_comms     t), '[]'::jsonb),
    'leads',         COALESCE((SELECT jsonb_agg(t) FROM leads         t), '[]'::jsonb),
    'bookings',      COALESCE((SELECT jsonb_agg(t) FROM bookings      t), '[]'::jsonb),
    'tasks',         COALESCE((SELECT jsonb_agg(t) FROM tasks         t), '[]'::jsonb),
    'announcements', COALESCE((SELECT jsonb_agg(t) FROM announcements t), '[]'::jsonb),
    'kb_articles',   COALESCE((SELECT jsonb_agg(t) FROM kb_articles   t), '[]'::jsonb),
    'links',         COALESCE((SELECT jsonb_agg(t) FROM links         t), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Supabase's platform default ACLs grant EXECUTE on every newly created
-- function directly to anon/authenticated/service_role, independent of
-- PUBLIC (see CLAUDE.md) -- REVOKE ALL ... FROM PUBLIC alone does not strip
-- this, so anon/authenticated must be revoked explicitly as their own
-- statement, then authenticated re-granted (the function's own
-- is_admin_or_owner() check is the real gate, same pattern as
-- restore_backup_tables).
REVOKE ALL ON FUNCTION export_backup_tables() FROM PUBLIC;
REVOKE ALL ON FUNCTION export_backup_tables() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION export_backup_tables() TO authenticated;

NOTIFY pgrst, 'reload schema';
