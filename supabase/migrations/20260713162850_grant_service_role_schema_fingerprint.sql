-- verify_schema_fingerprint() was created twice (20260708212124,
-- 20260709193227) and both migrations only REVOKE ALL ... FROM PUBLIC,
-- anon, authenticated -- neither ever explicitly GRANTs EXECUTE TO
-- service_role. Confirmed 2026-07-13: on production,
-- has_function_privilege('service_role', ..., 'EXECUTE') was false, so
-- tenant-admin's verify_tenant_schema action (which connects to the
-- tenant's data-plane project using its stored service_role key) fails
-- with "Skjema-sjekk feila" even though the function exists. Same lesson
-- as ADR-0008/ADR-0009: never assume service_role has a grant, verify and
-- grant explicitly.
GRANT EXECUTE ON FUNCTION verify_schema_fingerprint() TO service_role;

NOTIFY pgrst, 'reload schema';
