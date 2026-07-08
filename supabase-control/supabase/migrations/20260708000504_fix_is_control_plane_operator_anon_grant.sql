-- Fix: is_control_plane_operator()'s original REVOKE only targeted PUBLIC,
-- missing that Supabase's platform default ACLs grant EXECUTE on new
-- functions directly to anon/authenticated/service_role at creation time
-- (independent of PUBLIC) — confirmed via pg_default_acl on this project.
-- get_tenant_service_role_key() and the table-level REVOKEs in the
-- baseline migration already correctly listed anon/authenticated
-- explicitly; this one did not. Low practical impact (the function only
-- returns a boolean based on auth.uid(), which is null for anon), but it
-- should still be locked down to match the intended design.
REVOKE ALL ON FUNCTION is_control_plane_operator() FROM anon;
