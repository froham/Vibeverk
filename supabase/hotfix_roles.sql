-- =============================================================================
-- hotfix_roles.sql — Forenkla rollemodell: fjern "owner", behold admin/editor/member
-- -----------------------------------------------------------------------------
-- Køyr éin gong i Supabase Dashboard → SQL Editor.
-- Er idempotent: trygt å køyre fleire gonger.
-- OBS: Deploy også manage-user Edge Function etter dette (supabase functions deploy manage-user)
-- =============================================================================

-- 1. Konverter eksisterande owner-brukarar til admin
UPDATE public.users SET role = 'admin' WHERE role = 'owner';

-- 2. Oppdater CHECK-constraint (drop + re-add for idempotens)
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'editor', 'member'));

-- 3. Oppdater is_admin_or_owner() — berre admin no (funksjonnamnet behaldt for bakoverkompatibilitet)
CREATE OR REPLACE FUNCTION is_admin_or_owner()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- 4. Oppdater can_edit_content() — owner fjerna
CREATE OR REPLACE FUNCTION can_edit_content()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin', 'editor')
  );
$$;

-- 5. Reload PostgREST-schema
NOTIFY pgrst, 'reload schema';
