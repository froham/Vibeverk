-- hotfix_tasks_rls.sql
-- SUPERSERT (2026-07-01, sikkerheitsaudit): IKKJE køyr denne fila lenger.
-- 'owner' er fjerna som rolle (ADR-0006) — problem 2 er ikkje-gjeldande.
-- Problem 1 sitt forslag (WITH CHECK (true) på tasks_assignee) er FARLEG —
-- det let ein tildelt brukar tildele oppgåva til kven som helst. Rett fiks
-- (kolonne-avgrensa trigger) ligg no i migration.sql og i
-- hotfix_security_audit_2026-07-01.sql. Fila er teken vare på berre som
-- historikk over kva som vart vurdert og forkasta.
--
-- Problem 1 (opphavleg): tasks_assignee WITH CHECK hindra at tildelt brukar kunne endre assigned_to
-- Problem 2 (opphavleg): can_edit_content() mangla 'owner', so eigar kunne ikkje opprette oppgåver
-- Køyr i Supabase Dashboard → SQL Editor

-- Oppdater can_edit_content() til å inkludere owner
CREATE OR REPLACE FUNCTION can_edit_content()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('owner', 'admin', 'editor')
  );
$$;

-- Fiks tasks_assignee: tildelt brukar kan no endre kven oppgåva er tildelt til
DROP POLICY IF EXISTS tasks_assignee ON tasks;
CREATE POLICY tasks_assignee ON tasks FOR UPDATE TO authenticated
  USING   (assigned_to = auth.uid())
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
