-- =============================================================================
-- hotfix_signup_role_hardening_2026-07-06.sql
-- -----------------------------------------------------------------------------
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- Funn (2026-07-04/06 audit, sjå docs/project/CURRENT_STATE.md "Pending"):
-- handle_new_user() sette role direkte frå klient-levert
-- raw_user_meta_data->>'role' ved kontoopprettelse, med ingen server-side
-- sperre. Dersom Supabase Dashboard -> Authentication -> Sign In / Up sin
-- "Allow new users to sign up" nokon gong er/vert på for dette prosjektet,
-- kunne kven som helst sjølvregistrere seg med role:"admin" i
-- signup-metadata og bli admin utan invitasjon -- prevent_self_role_escalation()
-- blokkerer berre SEINARE UPDATE, ikkje denne INSERT-en.
--
-- Brukar stadfesta 2026-07-06 at "Allow new users to sign up" var PÅ og har
-- no slått den AV for clzczbyklgdtdhgjphup -- den akutte, live-eksponerte
-- vegen er difor stengt. Denne fila er likevel verd å køyre som
-- defense-in-depth: Dashboard-toggelen er ikkje versjonskontrollert, så ein
-- framtidig re-aktivering (t.d. for ein demo-kunde) opnar hòlet att momentant
-- med null kodeendring, med mindre sjølve triggeren er herda.
--
-- Løysing: stol berre på metadata-rolla når kontoen faktisk vart oppretta via
-- den ekte admin-invitasjonsflyten (manage-user Edge Function sin
-- inviteUserByEmail()) -- Supabase Auth set automatisk auth.users.invited_at
-- FOR DENNE OPERASJONEN ÅLEINE, aldri for eit vanleg signup (uavhengig av om
-- signup-toggelen er på/av, og ikkje noko ein klient kan setje sjølv via
-- signUp()). Elles: alltid 'member', uansett kva raw_user_meta_data seier.
--
-- Krev INGEN endring i supabase/functions/manage-user/index.ts -- det
-- eksisterande inviteUserByEmail(email, {data:{role,...}})-kallet set både
-- role-metadata OG invited_at automatisk, så invitasjonar med
-- role:"editor"/"admin" held fram med å fungere akkurat som før denne fila.
--
-- Denne fila er også lagt inn i supabase/migration.sql (idempotent
-- fullskjema, for framtidige/friske kundeprosjekt).
-- =============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
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
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- MANUELL TEST ETTER KØYRING (kan ikkje verifiserast frå repoet):
-- 1) Sjølvregistrer ein testkonto (viss signup er på) med
--    raw_user_meta_data = {"role": "admin"} -- kontoen skal lande som
--    role='member' i public.users, IKKJE 'admin'.
-- 2) Inviter ein ekte brukar via Workspace -> Brukarar med rolle "editor" --
--    kontoen skal framleis lande som role='editor' (invited_at IS NOT NULL-
--    greina), ikkje 'member'.
-- =============================================================================
