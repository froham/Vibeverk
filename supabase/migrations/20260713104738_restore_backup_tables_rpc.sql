-- Transactional restore RPC for the nine tables covered by the Web-admin
-- "Sikkerhetskopi" backup/restore feature (crm_bedrifter/crm_customers/
-- crm_comms/leads/bookings/tasks/announcements/kb_articles/links).
--
-- Replaces the client-orchestrated per-table delete-then-insert restore in
-- core.js, which an external security review (2026-07-13, see
-- docs/project/CURRENT_STATE.md and CHANGELOG.md 0.32.1) found to be a real
-- BLOCKER: no transaction (a failed INSERT after a successful DELETE loses
-- data with no rollback), and FK actions on sibling tables
-- (crm_customers.bedrift_id -> crm_bedrifter ON DELETE SET NULL,
-- crm_comms.customer_id -> crm_customers ON DELETE CASCADE) meant the
-- "one table at a time" isolation the old code claimed didn't actually hold.
-- core.js's restore path has been fully disabled (stopgap, v0.32.1) since
-- that review; this function is the real fix, designed with the
-- vibeverk-architect agent (2026-07-13).
--
-- One function call = one Postgres transaction: any exception (bad row
-- shape, FK violation, missing table in the payload) rolls back every
-- effect automatically, so a failure partway through never leaves some
-- tables emptied and others untouched.

CREATE OR REPLACE FUNCTION restore_backup_tables(p_tables jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_names text[] := ARRAY['crm_bedrifter','crm_customers','crm_comms','leads',
                           'bookings','tasks','announcements','kb_articles','links'];
  v_name text;
  v_result jsonb := '[]'::jsonb;
  v_restored int;
  v_orphaned int;
  v_sanitized jsonb;
BEGIN
  -- Admin-only -- a full nine-table wipe-and-replace is categorically more
  -- destructive than any single row-level write the per-table RLS policies
  -- (can_edit_content(), admin+editor) were written for. This check is the
  -- only real access boundary here: window.App.buildBackupPayload/
  -- restoreBackupData are both reachable from any authenticated browser
  -- console session, and the Web-admin panel's own gate is a local
  -- config-password check with no relationship to the Supabase session.
  IF NOT is_admin_or_owner() THEN
    RAISE EXCEPTION 'Berre admin kan gjenopprette sikkerhetskopi';
  END IF;

  -- Serialiserer samtidige kall -- utan denne kan to admin-øktar/faner som
  -- gjenopprettar rundt same tidspunkt sjå kvarandre sine allereie-committa
  -- rader (READ COMMITTED-semantikk: ein DELETE ser berre si eiga snapshot),
  -- slik at resultatet stille vert ei SAMANSLÅING av to ulike kopiar i staden
  -- for at den siste vinn reint, i strid med "eksakt spegel"-garantien over.
  -- Låsen sleppast automatisk ved slutten av transaksjonen (xact-scoped).
  PERFORM pg_advisory_xact_lock(hashtext('restore_backup_tables'));

  IF p_tables IS NULL OR jsonb_typeof(p_tables) <> 'object' THEN
    RAISE EXCEPTION 'Ugyldig sikkerhetskopi: tables-feltet er ikkje eit objekt';
  END IF;

  -- Structural validation BEFORE any deletion -- a payload missing one of
  -- the nine expected tables (a truncated file, a hand-edited/corrupted
  -- export) must reject outright, not be silently treated as "this table
  -- restores to empty" (that is only legitimate when the key IS present
  -- with an empty array).
  FOREACH v_name IN ARRAY v_names LOOP
    IF NOT (p_tables ? v_name) THEN
      RAISE EXCEPTION 'Ugyldig sikkerhetskopi: manglar tabellen "%"', v_name;
    END IF;
    IF jsonb_typeof(p_tables -> v_name) <> 'array' THEN
      RAISE EXCEPTION 'Ugyldig sikkerhetskopi: "%" er ikkje ei liste', v_name;
    END IF;
  END LOOP;

  -- Practical size guard -- this is a single-tenant, human-scale dataset
  -- (one company's CRM/tasks/etc, realistically hundreds to low thousands
  -- of rows). A controlled error is better than an uncontrolled platform
  -- payload-size rejection or statement_timeout cutoff mid-transaction.
  IF (
    jsonb_array_length(p_tables->'crm_bedrifter') + jsonb_array_length(p_tables->'crm_customers') +
    jsonb_array_length(p_tables->'crm_comms')     + jsonb_array_length(p_tables->'leads') +
    jsonb_array_length(p_tables->'bookings')      + jsonb_array_length(p_tables->'tasks') +
    jsonb_array_length(p_tables->'announcements') + jsonb_array_length(p_tables->'kb_articles') +
    jsonb_array_length(p_tables->'links')
  ) > 20000 THEN
    RAISE EXCEPTION 'Sikkerhetskopien er for stor til å gjenopprettast automatisk -- ta kontakt med Vibeverk';
  END IF;

  -- Tøm alle ni -- rekkefølgja er trygg her sidan ALT vert sett inn att i
  -- same transaksjon rett under (ein FK SET NULL/CASCADE-sideeffekt frå å
  -- slette ein "forelder" spelar inga rolle, sidan "barnet" også straks
  -- vert sletta og sett inn att på nytt).
  DELETE FROM crm_comms;
  DELETE FROM crm_customers;
  DELETE FROM crm_bedrifter;
  DELETE FROM leads;
  DELETE FROM bookings;
  DELETE FROM tasks;
  DELETE FROM announcements;
  DELETE FROM kb_articles;
  DELETE FROM links;

  -- Set inn att i FK-trygg rekkefølgje for INSERT: bedrifter -> customers ->
  -- comms (NOT NULL FK-ar), resten har ingen FK til kvarandre.
  INSERT INTO crm_bedrifter SELECT * FROM jsonb_populate_recordset(NULL::crm_bedrifter, p_tables->'crm_bedrifter');
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  v_result := v_result || jsonb_build_object('table','crm_bedrifter','restored',v_restored,'orphaned',0);

  INSERT INTO crm_customers SELECT * FROM jsonb_populate_recordset(NULL::crm_customers, p_tables->'crm_customers');
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  v_result := v_result || jsonb_build_object('table','crm_customers','restored',v_restored,'orphaned',0);

  INSERT INTO crm_comms SELECT * FROM jsonb_populate_recordset(NULL::crm_comms, p_tables->'crm_comms');
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  v_result := v_result || jsonb_build_object('table','crm_comms','restored',v_restored,'orphaned',0);

  INSERT INTO leads SELECT * FROM jsonb_populate_recordset(NULL::leads, p_tables->'leads');
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  v_result := v_result || jsonb_build_object('table','leads','restored',v_restored,'orphaned',0);

  INSERT INTO bookings SELECT * FROM jsonb_populate_recordset(NULL::bookings, p_tables->'bookings');
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  v_result := v_result || jsonb_build_object('table','bookings','restored',v_restored,'orphaned',0);

  -- tasks/announcements/kb_articles/links: author/assignee columns are all
  -- nullable with ON DELETE SET NULL as of
  -- 20260712203346_fix_user_delete_fk_restrict.sql, specifically so content
  -- is PRESERVED (never dropped) when the referenced user no longer
  -- exists. The old client-side BACKUP_USER_FK_RULES dropped the whole row
  -- instead -- a direct contradiction of that migration's own intent,
  -- confirmed as one of the BLOCKER review's findings. Null out instead,
  -- uniformly, for all five affected columns.
  --
  -- IMPORTANT (found via real testing against vibeverk-staging, not obvious
  -- from design alone): the users(id) FK is NOT deferrable, so it is
  -- enforced at INSERT time, not at COMMIT -- inserting a row with a
  -- dangling author id and fixing it up with an UPDATE afterward (the first
  -- draft of this function) fails immediately with a foreign-key violation,
  -- it never reaches the UPDATE. The JSONB rows must be sanitized (dangling
  -- ids replaced with JSON null) BEFORE jsonb_populate_recordset/INSERT.

  WITH src AS (
    SELECT elem,
      (elem->>'created_by')  IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = (elem->>'created_by')::uuid)  AS bad_cb,
      (elem->>'assigned_to') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = (elem->>'assigned_to')::uuid) AS bad_at
    FROM jsonb_array_elements(p_tables->'tasks') AS elem
  )
  -- jsonb_set()'s new_value returns SQL NULL (nulling the WHOLE row, not just
  -- the column) if new_value itself is NULL -- which elem->'x' returns when
  -- the key is entirely ABSENT (as opposed to present with JSON null, where
  -- elem->'x' returns 'null'::jsonb). COALESCE(...,'null'::jsonb) treats a
  -- missing key identically to an explicit null, so a malformed/hand-edited
  -- row (this function's own stated threat model, see comment above) can
  -- never silently null an entire row -- confirmed by Security Auditor
  -- review 2026-07-13 (MEDIUM), fixed same day.
  SELECT jsonb_agg(
           jsonb_set(
             jsonb_set(elem, '{created_by}',  CASE WHEN bad_cb THEN 'null'::jsonb ELSE COALESCE(elem->'created_by',  'null'::jsonb) END),
             '{assigned_to}',                 CASE WHEN bad_at THEN 'null'::jsonb ELSE COALESCE(elem->'assigned_to', 'null'::jsonb) END
           )
         ),
         count(*) FILTER (WHERE bad_cb OR bad_at)
    INTO v_sanitized, v_orphaned
    FROM src;
  INSERT INTO tasks SELECT * FROM jsonb_populate_recordset(NULL::tasks, COALESCE(v_sanitized, '[]'::jsonb));
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  v_result := v_result || jsonb_build_object('table','tasks','restored',v_restored,'orphaned',COALESCE(v_orphaned,0));

  WITH src AS (
    SELECT elem, (elem->>'author_id') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = (elem->>'author_id')::uuid) AS bad
    FROM jsonb_array_elements(p_tables->'announcements') AS elem
  )
  SELECT jsonb_agg(jsonb_set(elem, '{author_id}', CASE WHEN bad THEN 'null'::jsonb ELSE COALESCE(elem->'author_id', 'null'::jsonb) END)),
         count(*) FILTER (WHERE bad)
    INTO v_sanitized, v_orphaned
    FROM src;
  INSERT INTO announcements SELECT * FROM jsonb_populate_recordset(NULL::announcements, COALESCE(v_sanitized, '[]'::jsonb));
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  v_result := v_result || jsonb_build_object('table','announcements','restored',v_restored,'orphaned',COALESCE(v_orphaned,0));

  WITH src AS (
    SELECT elem, (elem->>'author_id') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = (elem->>'author_id')::uuid) AS bad
    FROM jsonb_array_elements(p_tables->'kb_articles') AS elem
  )
  SELECT jsonb_agg(jsonb_set(elem, '{author_id}', CASE WHEN bad THEN 'null'::jsonb ELSE COALESCE(elem->'author_id', 'null'::jsonb) END)),
         count(*) FILTER (WHERE bad)
    INTO v_sanitized, v_orphaned
    FROM src;
  INSERT INTO kb_articles SELECT * FROM jsonb_populate_recordset(NULL::kb_articles, COALESCE(v_sanitized, '[]'::jsonb));
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  v_result := v_result || jsonb_build_object('table','kb_articles','restored',v_restored,'orphaned',COALESCE(v_orphaned,0));

  WITH src AS (
    SELECT elem, (elem->>'created_by') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = (elem->>'created_by')::uuid) AS bad
    FROM jsonb_array_elements(p_tables->'links') AS elem
  )
  SELECT jsonb_agg(jsonb_set(elem, '{created_by}', CASE WHEN bad THEN 'null'::jsonb ELSE COALESCE(elem->'created_by', 'null'::jsonb) END)),
         count(*) FILTER (WHERE bad)
    INTO v_sanitized, v_orphaned
    FROM src;
  INSERT INTO links SELECT * FROM jsonb_populate_recordset(NULL::links, COALESCE(v_sanitized, '[]'::jsonb));
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  v_result := v_result || jsonb_build_object('table','links','restored',v_restored,'orphaned',COALESCE(v_orphaned,0));

  RETURN v_result;
END;
$$;

-- Supabase's platform default ACLs grant EXECUTE on every newly created
-- function directly to anon/authenticated/service_role, independent of
-- PUBLIC (see CLAUDE.md) -- REVOKE ALL ... FROM PUBLIC alone does not strip
-- this, so anon/authenticated must be revoked explicitly as their own
-- statement, then authenticated re-granted (the function's own
-- is_admin_or_owner() check is the real gate).
REVOKE ALL ON FUNCTION restore_backup_tables(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION restore_backup_tables(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION restore_backup_tables(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
