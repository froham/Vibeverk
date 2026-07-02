-- hotfix_tasks_member_self_create_2026-07-02.sql
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard → SQL Editor only after explicit user approval, per CLAUDE.md.
--
-- Context: earlier the same day, member was blocked from creating or editing
-- tasks at all (RLS had no INSERT policy for non-admin/editor, and the
-- existing UPDATE policy + trigger only allowed the row's assignee to change
-- status). The user clarified the intent in two steps:
--   1. Member should be able to create tasks for themselves (self-assigned
--      or unassigned), just not assign a task to someone else.
--   2. Member should be able to fully edit (title/description/due date, not
--      just status) tasks they created themselves — just still never able to
--      assign a task to someone else. A task ASSIGNED TO them BY SOMEONE ELSE
--      remains status-only, unchanged from the 2026-07-01 security fix.
-- Idempotent: safe to run multiple times.

-- 1) Broaden the UPDATE policy so a task's CREATOR (not just its assignee)
--    can update the row. Column-level restriction still happens entirely in
--    the trigger below — RLS alone can only restrict rows, not columns.
DROP POLICY IF EXISTS tasks_assignee ON tasks;
CREATE POLICY tasks_assignee ON tasks FOR UPDATE TO authenticated
  USING      (assigned_to = auth.uid() OR created_by = auth.uid())
  WITH CHECK (assigned_to = auth.uid() OR created_by = auth.uid());

-- 2) Allow member to INSERT a task for themselves (self-assigned or
--    unassigned). Assigning to someone else still requires admin/editor via
--    the existing tasks_admin policy (can_edit_content()).
DROP POLICY IF EXISTS tasks_self_create ON tasks;
CREATE POLICY tasks_self_create ON tasks FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND (assigned_to = auth.uid() OR assigned_to IS NULL));

-- 3) Column-level enforcement: a non-admin/editor user can fully edit a task
--    they created themselves, but a task assigned to them by someone else is
--    still status-only. Nobody outside admin/editor can ever reassign a task
--    to a different user, regardless of who created it.
CREATE OR REPLACE FUNCTION restrict_assignee_task_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF can_edit_content() THEN
    RETURN NEW; -- admin/editor: no restriction
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND NEW.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Berre admin/editor kan tildele oppgåve til ein annan brukar';
  END IF;

  IF OLD.created_by = auth.uid() THEN
    RETURN NEW; -- self-created: free edit of the other fields
  END IF;

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
