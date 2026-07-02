-- hotfix_tasks_readonly_for_assigned_2026-07-02.sql
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard → SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- Context: hotfix_tasks_member_self_create_2026-07-02.sql (already run
-- against production) let a member update ANY field but status on a task
-- assigned to them by someone else. The user has now clarified further:
-- a task assigned to member by someone else should be fully READ-ONLY —
-- member should not be able to change status on it either, only view it.
-- Member's own self-created tasks remain fully editable (unchanged).
--
-- This narrows tasks_assignee's UPDATE policy from "assigned_to = auth.uid()
-- OR created_by = auth.uid()" to "created_by = auth.uid()" only, and
-- simplifies restrict_assignee_task_columns() accordingly (the "assigned by
-- someone else, status-only" branch is now unreachable for non-admin/editor
-- and has been removed — the remaining rule is simply "never reassign to
-- someone else", which still applies to a member's own created tasks too).
-- Idempotent: safe to run multiple times.

DROP POLICY IF EXISTS tasks_assignee ON tasks;
CREATE POLICY tasks_assignee ON tasks FOR UPDATE TO authenticated
  USING      (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE OR REPLACE FUNCTION restrict_assignee_task_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF can_edit_content() THEN
    RETURN NEW;
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND NEW.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Berre admin/editor kan tildele oppgåve til ein annan brukar';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
