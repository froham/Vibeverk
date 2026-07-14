-- Two real, pre-existing gaps found while testing invite_tenant_admin /
-- generate_support_access (2026-07-14):
--
-- 1. handle_new_user() fired AFTER INSERT ON auth.users and trusted
--    raw_user_meta_data->>'role' only when NEW.invited_at IS NOT NULL (a
--    deliberate anti-self-registration-to-admin guard, see
--    hotfix_signup_role_hardening_2026-07-06.sql). But GoTrue's
--    admin.inviteUserByEmail() creates the row first and sets invited_at in
--    a SEPARATE follow-up update -- so at the moment this trigger actually
--    fired, invited_at was still NULL even for a genuine invite, and role
--    always fell through to 'member'. Confirmed directly: a fresh invite's
--    auth.users.raw_user_meta_data.role was correctly "admin", but the
--    resulting public.users.role was stored as 'member'.
--
--    Fixed by also firing on the UPDATE that sets invited_at (the moment
--    GoTrue actually confirms the invite), and updating role then. Same
--    security invariant as before -- invited_at is still never client-
--    settable -- just caught at the right instant.
--
-- 2. service_role never had SELECT/INSERT/UPDATE/DELETE on `users`, only
--    REFERENCES/TRIGGER/TRUNCATE (same class of gap as ADR-0009's `store`
--    fix) -- confirmed via information_schema.role_table_grants against
--    production. generate_support_access's existence check
--    (tenantSrvSb.from("users").select(...), using the tenant's own
--    service_role key) silently failed on this and was indistinguishable
--    from "no admin user exists", always returning a misleading 404 even
--    when a real admin user was present.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO service_role;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.users (id, display_name, role, email)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
      CASE
        WHEN NEW.invited_at IS NOT NULL THEN COALESCE(NEW.raw_user_meta_data->>'role', 'member')
        ELSE 'member'
      END,
      NEW.email
    )
    ON CONFLICT (id) DO NOTHING;
  ELSIF TG_OP = 'UPDATE' AND NEW.invited_at IS NOT NULL AND OLD.invited_at IS NULL THEN
    UPDATE public.users
    SET role = COALESCE(NEW.raw_user_meta_data->>'role', 'member')
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE OF invited_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

NOTIFY pgrst, 'reload schema';
