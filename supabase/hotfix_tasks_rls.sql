-- hotfix_tasks_rls.sql
-- Problem 1: tasks_assignee WITH CHECK hindra at tildelt brukar kunne endre assigned_to
-- Problem 2: can_edit_content() mangla 'owner', so eigar kunne ikkje opprette oppgåver
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
