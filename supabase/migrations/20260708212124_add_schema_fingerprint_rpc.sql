-- Phase 9 (SaaS-scaling plan): a schema-fingerprint RPC so the
-- control-plane's tenant-admin Edge Function can verify a newly
-- provisioned customer project actually has the expected tables, rather
-- than trusting a clean `db push` exit code alone. Part of the baseline
-- going forward -- every future customer project gets this once their
-- migrations are applied, so onboarding automation always has a real
-- verification step available.
--
-- information_schema is not exposed via PostgREST by default, so this
-- wraps the check in a SECURITY DEFINER function instead of relying on
-- direct information_schema access from outside.
CREATE OR REPLACE FUNCTION verify_schema_fingerprint()
RETURNS TABLE (table_name text, table_exists boolean)
SECURITY DEFINER STABLE SET search_path = public
LANGUAGE sql AS $$
  SELECT t.expected_name, EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE information_schema.tables.table_schema = 'public'
      AND information_schema.tables.table_name = t.expected_name
  )
  FROM unnest(ARRAY['store', 'users', 'chat_conversations', 'leads', 'bookings']) AS t(expected_name);
$$;
REVOKE ALL ON FUNCTION verify_schema_fingerprint() FROM PUBLIC, anon, authenticated;
