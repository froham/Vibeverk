-- Follow-up to 20260708192115_grant_service_role_store_access.sql: an
-- UPSERT with ON CONFLICT evaluates the INSERT branch's DEFAULT expression
-- (nextval() on store_id_seq) even when the final action is an UPDATE, so
-- service_role also needs sequence USAGE, not just table-level grants.
-- Confirmed via a real broker set_config call failing with "permission
-- denied for sequence store_id_seq" even after the table grant above.
GRANT USAGE, SELECT ON SEQUENCE store_id_seq TO service_role;
