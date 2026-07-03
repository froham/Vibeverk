-- hotfix_tasks_status_editable_revert_2026-07-03.sql
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- Context: hotfix_tasks_readonly_for_assigned_2026-07-02.sql (run against
-- production 2026-07-02) narrowed tasks_assignee so a task assigned to
-- member by someone else became fully read-only, not even status-editable.
-- The user has now clarified (2026-07-03) that this was wrong: a member
-- MUST be able to change status on a task assigned to them by someone
-- else -- that is expected, everyday behaviour, not a permission gap.
-- This reverts tasks_assignee and restrict_assignee_task_columns() back
-- to the "assigned-by-others: status-only" rule from
-- hotfix_tasks_member_self_create_2026-07-02.sql (also run against
-- production 2026-07-02) -- i.e. this SQL supersedes and reverts
-- hotfix_tasks_readonly_for_assigned_2026-07-02.sql specifically.
-- Member's own self-created tasks remain fully editable (unchanged, not
-- affected by any of this).
-- Idempotent: safe to run multiple times.

DROP POLICY IF EXISTS tasks_assignee ON tasks;
CREATE POLICY tasks_assignee ON tasks FOR UPDATE TO authenticated
  USING      (assigned_to = auth.uid() OR created_by = auth.uid())
  WITH CHECK (assigned_to = auth.uid() OR created_by = auth.uid());

CREATE OR REPLACE FUNCTION restrict_assignee_task_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF can_edit_content() THEN
    RETURN NEW; -- admin/editor: inga avgrensing
  END IF;

  -- Ingen ikkje-admin/editor kan nokon gong tildele oppgåva til NOKON ANNAN
  -- enn seg sjølv (eller nullstille tildelinga) -- uavhengig av om dei sjølv
  -- oppretta oppgåva.
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND NEW.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Berre admin/editor kan tildele oppgåve til ein annan brukar';
  END IF;

  -- Eiga oppretta oppgåve: fri redigering av dei andre felta.
  IF OLD.created_by = auth.uid() THEN
    RETURN NEW;
  END IF;

  -- Tildelt av nokon annan: berre status kan endrast.
  IF OLD.assigned_to = auth.uid() THEN
    IF NEW.title       IS DISTINCT FROM OLD.title
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.due_date    IS DISTINCT FROM OLD.due_date
       OR NEW.created_by  IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Tildelt brukar kan berre endre status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
