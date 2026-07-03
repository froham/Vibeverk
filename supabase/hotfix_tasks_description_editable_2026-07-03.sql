-- hotfix_tasks_description_editable_2026-07-03.sql
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- Context: hotfix_tasks_status_editable_revert_2026-07-03.sql (run earlier
-- today) restored restrict_assignee_task_columns() to only allow STATUS
-- changes on a task assigned to member by someone else. The user then
-- clarified further, in the same conversation: clicking such a task
-- should open the edit modal (it previously no-op'd silently), and inside
-- that modal, DESCRIPTION should also be editable, not just status --
-- title and assignee stay locked. This hotfix updates the trigger function
-- to match: description is no longer blocked for the "assigned by someone
-- else" case, only title/due_date/created_by remain locked.
-- No RLS policy change needed -- tasks_assignee's UPDATE policy already
-- covers assigned_to = auth.uid() OR created_by = auth.uid() and is
-- unaffected by this hotfix.
-- Idempotent: safe to run multiple times.

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

  -- Tildelt av nokon annan: skildring og status kan endrast, resten er låst.
  IF OLD.assigned_to = auth.uid() THEN
    IF NEW.title       IS DISTINCT FROM OLD.title
       OR NEW.due_date    IS DISTINCT FROM OLD.due_date
       OR NEW.created_by  IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Tildelt brukar kan berre endre skildring og status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
