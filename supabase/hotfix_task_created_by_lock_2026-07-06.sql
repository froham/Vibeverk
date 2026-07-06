-- =============================================================================
-- hotfix_task_created_by_lock_2026-07-06.sql
-- -----------------------------------------------------------------------------
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- Funn (2026-07-06 audit): restrict_assignee_task_columns() sin gr ein for
-- "eiga oppretta oppgåve" (OLD.created_by = auth.uid()) let NEW.created_by
-- sjølv endrast fritt saman med alle andre felt -- ein member kan difor via
-- ein vanleg UPDATE forfalske kven som oppretta ei oppgåve dei sjølv
-- oppretta (t.d. sette created_by til ein annan brukar sin id). Ingen
-- rettigheitseskalering resulterer av dette i dag (ingen annan logikk
-- bruker created_by til autorisasjon), men det er eit reelt
-- dataintegritets-/sporbarheitsgap (falsifiserbar oppgåveopphav).
--
-- Løysing: same gren skal framleis tillate fri redigering av tittel/
-- skildring/frist/status for eiga oppretta oppgåve, men blokkere endring av
-- created_by sjølv (med mindre kallaren er admin/editor, som alt har full
-- tilgang via den fyrste greina i funksjonen).
--
-- Denne fila er også lagt inn i supabase/migration.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION restrict_assignee_task_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF can_edit_content() THEN
    RETURN NEW; -- admin/editor: inga avgrensing
  END IF;

  -- Ingen ikkje-admin/editor kan nokon gong tildele oppgåva til NOKON ANNAN
  -- enn seg sjølv (eller nullstille tildelinga) — uavhengig av om dei sjølv
  -- oppretta oppgåva.
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND NEW.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Berre admin/editor kan tildele oppgåve til ein annan brukar';
  END IF;

  -- Eiga oppretta oppgåve: fri redigering av dei andre felta — MEN created_by
  -- sjølv skal aldri kunne endrast av nokon som ikkje er admin/editor, elles
  -- kan ein member forfalske kven som oppretta oppgåva (2026-07-06-funn).
  IF OLD.created_by = auth.uid() THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Berre admin/editor kan endre kven som oppretta oppgåva';
    END IF;
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

-- =============================================================================
-- MANUELL TEST ETTER KØYRING:
-- Logg inn som ein "member"-testkonto, opprett ei eiga oppgåve, forsøk
-- deretter PATCH /rest/v1/tasks?id=eq.<id> med {"created_by": "<annan-id>"}
-- -- skal avvisast med "Berre admin/editor kan endre kven som oppretta
-- oppgåva". Vanleg redigering av tittel/skildring/frist/status på same
-- oppgåve skal framleis fungere uendra.
-- =============================================================================
