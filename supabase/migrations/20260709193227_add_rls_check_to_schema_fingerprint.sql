-- Security Auditor finding H2 (Phase 6 pre-merge review, 2026-07-09):
-- verify_schema_fingerprint() only ever confirmed expected tables EXIST --
-- it said nothing about whether RLS is actually enabled on them. Combined
-- with the Phase 6 migration widening resolve_tenant_by_hostname() to also
-- resolve 'provisioning' tenants (needed to break a circular dependency,
-- see supabase-control's Phase 6 migration), a tenant's real pages and
-- real Supabase credentials become publicly reachable via its registered
-- hostname before any check beyond "the tables exist" has run -- a freshly
-- `db push`-ed project with RLS not yet enabled on a table would pass the
-- old check and still be a real, unauthenticated data-exposure risk the
-- moment DNS points at it.
--
-- Adds rls_enabled per table (via pg_class.relrowsecurity, not
-- information_schema -- RLS status isn't exposed there) so
-- tenant-admin's verify_tenant_schema action can require it, not just
-- table existence.
--
-- Postgres can't CREATE OR REPLACE a function into a different return
-- type, so this is a DROP + CREATE rather than a plain REPLACE.
DROP FUNCTION IF EXISTS verify_schema_fingerprint();
CREATE FUNCTION verify_schema_fingerprint()
RETURNS TABLE (table_name text, table_exists boolean, rls_enabled boolean)
SECURITY DEFINER STABLE SET search_path = public
LANGUAGE sql AS $$
  SELECT
    t.expected_name,
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE information_schema.tables.table_schema = 'public'
        AND information_schema.tables.table_name = t.expected_name
    ),
    COALESCE((
      SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t.expected_name
    ), false)
  FROM unnest(ARRAY['store', 'users', 'chat_conversations', 'leads', 'bookings']) AS t(expected_name);
$$;
-- DROP + CREATE means grants are gone, not just "restated for clarity" --
-- required again from scratch, same lesson as supabase-control's Phase 6
-- migration.
REVOKE ALL ON FUNCTION verify_schema_fingerprint() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
