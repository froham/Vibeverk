-- =============================================================================
-- hotfix_security_audit_2026-07-01.sql
-- -----------------------------------------------------------------------------
-- Rettar dei tryggast/mest velavgrensa funna frå full sikkerheitsaudit 2026-07-01
-- (docs/project/CHANGELOG.md 0.6.0/0.7.0, docs/project/CURRENT_STATE.md).
--
-- IKKJE inkludert her (krev eigen design + klientkode-endring, sjå eige punkt
-- i docs/roadmap/ROADMAP.md):
--   - Chat anon IDOR (chat_conversations/chat_messages) — treng SECURITY DEFINER
--     RPC-ar som erstattar direkte anon INSERT/UPDATE, tett kobla til
--     module-chat.js. IKKJE gjer denne endringa isolert i SQL åleine.
--   - Kontakt/Tilbud/Booking-leads når ikkje Supabase for anonyme besøkjande —
--     krev ein ny, ekte tabell (ikkje JSON-blob i store) + SECURITY DEFINER RPC
--     for anon-innsending, pluss omskriving av core.js/module-booking.js/
--     module-quote.js sin lagringslogikk.
--
-- Køyr HEILE denne fila i Supabase Dashboard → SQL Editor. Idempotent (trygt
-- å køyre fleire gongar). Avslutt med NOTIFY pgrst, 'reload schema'.
--
-- Desse fire fiksane er også lagt inn i supabase/migration.sql (idempotent
-- fullskjema, for framtidige/friske kundeprosjekt). Denne fila er det du
-- faktisk køyrer MOT PRODUKSJON no — migration.sql åleine endrar ingenting
-- før nokon køyrer det manuelt i Supabase Dashboard.
-- =============================================================================


-- ── 1. Hindre sjølv-eskalering til admin-rolle ──────────────────────────────
-- Funn: users_self_update sjekkar berre at raden er din eigen (auth.uid()=id),
-- ikkje at role-kolonnen forblir uendra. Ein "member" kan i dag sende
-- PATCH /rest/v1/users?id=eq.<seg sjølv> med {"role":"admin"} og få full
-- admin-tilgang, sidan RLS er rad-nivå og ikkje kan avgrense enkeltkolonnar
-- åleine. Løysing: ein trigger som blokkerer role-endring med mindre kallaren
-- alt er admin (uavhengig av kva RLS-policy som slapp UPDATE-en gjennom).

CREATE OR REPLACE FUNCTION prevent_self_role_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT is_admin_or_owner() THEN
    RAISE EXCEPTION 'Berre admin kan endre rolle';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_role_escalation ON users;
CREATE TRIGGER trg_prevent_self_role_escalation
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION prevent_self_role_escalation();


-- ── 2. Avgrens store-tabellen sine skrive-rettar ────────────────────────────
-- Funn: store_auth tillet ALLE autentiserte (admin/editor/member) full
-- lese/skrive/slette-tilgang til HEILE tabellen — inkludert superconfig
-- (feature-flagg, tema, personverntekst, admin-passord-fallback). Ein
-- "member" kunne t.d. skru av crmFull eller endre productMode direkte via API.
-- Løysing: superconfig-nøkkelen krev admin; andre nøklar (kontakt-/CRM-/
-- booking-/tilbod-data, sideinnhald) krev minst can_edit_content() (admin
-- eller editor) — ikkje lenger opent for "member".

DROP POLICY IF EXISTS store_auth ON store;
CREATE POLICY store_auth ON store FOR ALL TO authenticated
  USING (
    CASE WHEN key = 'superconfig' THEN is_admin_or_owner() ELSE can_edit_content() END
  )
  WITH CHECK (
    CASE WHEN key = 'superconfig' THEN is_admin_or_owner() ELSE can_edit_content() END
  );

-- store_anon_read (anon SELECT på heile tabellen, inkl. CRM/leads/booking/tilbod
-- som i dag ligg i same tabell) er IKKJE retta her — det krev å skilje offentleg
-- sideinnhald frå privat kundedata (eiga tabell eller nøkkel-prefiks-basert RLS),
-- som er ei arkitekturendring. Sjå docs/project/CURRENT_STATE.md.


-- ── 3. Media-bucket: slett berre eigne filer (eller admin/editor) ──────────
-- Funn: media_delete sjekkar berre bucket_id, ikkje kven som lasta opp fila —
-- kommentaren i migration.sql hevda "eigne filer", men SQL-en handheva det
-- aldri. Løysing: bruk storage.objects sin innebygde owner-kolonne.

DROP POLICY IF EXISTS "media_delete" ON storage.objects;
CREATE POLICY "media_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND (owner = auth.uid() OR can_edit_content()));


-- ── 4. Oppgåver: tildelt brukar kan berre endre status, ikkje andre felt ────
-- Funn: tasks_assignee sin WITH CHECK avgrensar ikkje kolonnar — ein tildelt
-- brukar (kva som helst rolle) kan i dag endre tittel/beskrivelse/frist via
-- direkte API-kall, ikkje berre status. Den eldre hotfix_tasks_rls.sql sette i
-- tillegg WITH CHECK til "true" (tillet omtildeling til kven som helst) — denne
-- fila DROP+CREATE policyen på nytt med rett, avgrensa oppførsel, uavhengig av
-- om den gamle hotfixen vart køyrt.

DROP POLICY IF EXISTS tasks_assignee ON tasks;
CREATE POLICY tasks_assignee ON tasks FOR UPDATE TO authenticated
  USING      (assigned_to = auth.uid())
  WITH CHECK (assigned_to = auth.uid());

CREATE OR REPLACE FUNCTION restrict_assignee_task_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT can_edit_content() AND OLD.assigned_to = auth.uid() THEN
    IF NEW.title       IS DISTINCT FROM OLD.title
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       OR NEW.due_date    IS DISTINCT FROM OLD.due_date
       OR NEW.created_by  IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Tildelt brukar kan berre endre status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restrict_assignee_task_columns ON tasks;
CREATE TRIGGER trg_restrict_assignee_task_columns
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION restrict_assignee_task_columns();


NOTIFY pgrst, 'reload schema';
