-- Tighten tasks_read RLS: a non-admin/editor should only SELECT tasks they
-- are assigned to or created themselves -- matching what
-- workspace/module-tasks.js's UI already restricts to (it groups tasks into
-- "Mine oppgåver"/"Tildelt til andre av meg"/"Andre sine oppgåver", and only
-- shows the third group to admin/owner). Previously tasks_read used
-- `USING (true)`, so RLS allowed SELECT on every row for ANY authenticated
-- role regardless of the UI's own grouping -- a member could fetch every
-- task company-wide via a direct API call. Decided by user 2026-07-13, see
-- docs/roadmap/ROADMAP.md "Avgjerder teke 2026-07-13".
--
-- Admin/editor visibility is UNCHANGED: tasks_admin's existing
-- `FOR ALL ... USING (can_edit_content())` policy already covers SELECT for
-- them (permissive RLS policies for the same command are combined with OR),
-- so removing the "OR true" from tasks_read alone is sufficient -- no need
-- to duplicate the can_edit_content() check here.
DROP POLICY IF EXISTS tasks_read ON tasks;
CREATE POLICY tasks_read ON tasks FOR SELECT TO authenticated
  USING (assigned_to = auth.uid() OR created_by = auth.uid());
