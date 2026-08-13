-- Del av OAuth-innlogging (Microsoft/Google) for Workspace + Web-admin,
-- 2026-08-13. Arkitekt-gjennomgått FØR denne vart skriven -- fann ein
-- reell feil i det fyrste utkastet mitt (sjå historikk i denne økta).
--
-- PROBLEM (stadfesta i kode, ikkje teoretisk): handle_new_user() sitt
-- INSERT-tilfelle (20260714131500) opprettar UBETINGA ein public.users-rad
-- for KVAR NYE auth.users-rad, uansett korleis han vart oppretta. Supabase
-- sin signInWithOAuth() opprettar automatisk ein NY auth.users-rad for
-- KVEN SOM HELST med ein gyldig Microsoft-/Google-konto som logger inn --
-- det finst ingen innebygd Supabase-sperre mot dette. Utan denne fiksen
-- ville ein HEILT UINVITERT person med ein Microsoft-/Google-konto fått
-- ein ekte, fungerande public.users-rad med role='member' berre ved å
-- klikke "Logg inn med Microsoft" -- eit reelt sjølvregistrering-hol.
--
-- FYRSTE UTKAST AV DENNE FIKSEN (gjort betinga på invited_at IS NOT NULL
-- i INSERT-tilfellet, UTAN å endre UPDATE-tilfellet) var SJØLV FEIL --
-- fanga av Arkitekt-gjennomgang før commit: GoTrue sin
-- admin.inviteUserByEmail() set invited_at i eit SEPARAT UPDATE-steg ETTER
-- sjølve INSERT-en (stadfesta i 20260714131500 sin eigen kommentar). Å
-- gjere INSERT-tilfellet betinga UTAN å endre UPDATE-tilfellet til ein
-- UPSERT ville ha øydelagt HEILE invitasjonsflyten: ekte inviterte
-- brukarar ville aldri fått nokon rad i det heile (INSERT hoppa over sidan
-- invited_at er NULL då, UPDATE-tilfellet finn 0 rader sidan INSERT aldri
-- oppretta noko å oppdatere).
--
-- RETT FIKS: INSERT-tilfellet vert betinga (som før forsøkt), MEN
-- UPDATE-tilfellet vert gjort om til ein ekte UPSERT (INSERT ... ON
-- CONFLICT DO UPDATE), ikkje ein rein UPDATE. Dette dekker begge stega i
-- GoTrue sin to-stegs invitasjonsflyt korrekt:
--   - Ekte invitasjon: INSERT (invited_at NULL, hoppa over) -> UPDATE
--     (invited_at vert sett, UPSERT oppretter/oppdaterer raden med rett
--     rolle FRÅ raw_user_meta_data).
--   - Sjølvregistrert OAuth/anna: INSERT (invited_at NULL, hoppa over) ->
--     invited_at vert ALDRI sett seinare (kun sett av admin-invitasjon)
--     -> UPDATE-tilfellet fyrer ALDRI -> INGEN rad vert nokon gong oppretta.
--
-- Klientkoden (core.js, workspace-core.js) er OGSÅ endra same runde: alle
-- fire stadene som slo opp rolle etter innlogging hadde eit "fail-closed
-- til role='member'" fallback når oppslaget fann ingen rad. Dette var
-- trygt for passordinnlogging (kan ikkje nå fram utan at nokon alt sette
-- eit passord via ein ekte invitasjon), men IKKJE trygt for OAuth (finn
-- ingen rad = faktisk ikkje invitert). Endra universelt til AVVISNING
-- (signOut + tydeleg melding) i staden for eit "member"-fallback, for alle
-- fire innloggingsstiane -- enklare og meir robust enn ein OAuth-spesifikk
-- gren, sidan eit manglande rolleoppslag ALDRI bør gje tilgang, uansett
-- innloggingsmetode.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.invited_at IS NOT NULL THEN
    INSERT INTO public.users (id, display_name, role, email)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
      COALESCE(NEW.raw_user_meta_data->>'role', 'member'),
      NEW.email
    )
    ON CONFLICT (id) DO NOTHING;
  ELSIF TG_OP = 'UPDATE' AND NEW.invited_at IS NOT NULL AND OLD.invited_at IS NULL THEN
    INSERT INTO public.users (id, display_name, role, email)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
      COALESCE(NEW.raw_user_meta_data->>'role', 'member'),
      NEW.email
    )
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
