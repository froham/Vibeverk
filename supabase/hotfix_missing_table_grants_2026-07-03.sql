-- hotfix_missing_table_grants_2026-07-03.sql
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- URGENT PRODUCTION BUG, found via live testing 2026-07-03: the leads,
-- bookings, crm_customers, crm_bedrifter and crm_comms tables (added across
-- the 0.10.0/0.11.0/0.12.0 CRITICAL-fix rounds) got RLS policies but were
-- NEVER added to the base GRANT statement that every other authenticated
-- table in this schema has (see migration.sql's "GRANTS" section, which
-- already lists store/users/notes/tasks/announcements/kb_articles/links).
-- Without a table-level GRANT, Postgres rejects every operation from the
-- `authenticated` role with "permission denied for table X" BEFORE RLS is
-- even evaluated, regardless of how permissive the RLS policies are.
--
-- Practical effect confirmed live: a logged-in admin submitting the public
-- Kontakt form got an optimistic local update (looked like it worked) while
-- the real INSERT to `leads` silently failed (the fire-and-forget
-- `.then(function(){})` swallows the error) - the lead never appeared in
-- Workspace (separate page, its own fetch, correctly showed nothing), and
-- disappeared from Web-admin on refresh (loadLeads() re-fetching from
-- Supabase also fails silently, resetting the local cache to empty). The
-- same missing-GRANT bug affects crm_customers/crm_bedrifter/crm_comms and
-- bookings identically - any authenticated read or write against these five
-- tables has been failing in production since each one's migration.sql was
-- first run, undetected because no live UI smoke test was done for CRM
-- (0.10.0) or leads (0.11.0) at the time - only pg_tables/pg_policies
-- schema-level checks.
--
-- RLS policies on these tables are correct as-is and are NOT weakened by
-- this fix - GRANT is the SQL-standard "can this role touch this table at
-- all" gate; RLS narrows it further per-row/per-command (e.g. member can't
-- DELETE, still enforced by each table's `_delete` policy's
-- `can_edit_content()` check). This is the same two-layer pattern already
-- used for store/tasks/announcements/etc.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  leads, bookings, crm_customers, crm_bedrifter, crm_comms
TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFISERING — køyr denne og stadfest at authenticated no har alle fire
-- rettar (SELECT/INSERT/UPDATE/DELETE) på alle fem tabellane:
-- =============================================================================
-- SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name IN ('leads','bookings','crm_customers','crm_bedrifter','crm_comms')
--     AND grantee = 'authenticated'
--   ORDER BY table_name, privilege_type;
