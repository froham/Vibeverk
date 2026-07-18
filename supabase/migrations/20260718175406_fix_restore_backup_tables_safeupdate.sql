-- Fixes a real, previously-unverified bug in restore_backup_tables()
-- (20260713104738_restore_backup_tables_rpc.sql): its nine DELETE FROM
-- <table>; statements have no WHERE clause. Supabase's own pg-safeupdate
-- extension (loaded via session_preload_libraries for the role PostgREST/RPC
-- calls execute as) rejects ANY UPDATE/DELETE without a WHERE clause in that
-- session -- including ones issued from inside a SECURITY DEFINER function's
-- body, not just direct client queries. This applies regardless of a direct
-- superuser connection (e.g. `npx supabase db query`) never hitting it, since
-- that goes through a completely different, non-PostgREST session/role.
--
-- Found 2026-07-18 via the FIRST-EVER live run of the .claude/skills/
-- smoke-vibeverk backup-restore flow (see docs/project/CHANGELOG.md) -- this
-- function has apparently never actually been exercised end-to-end before,
-- neither in staging nor production, since its creation on 2026-07-13. Every
-- restore attempt via the real Web-admin "Sikkerhetskopi" import button would
-- have failed with "DELETE requires a WHERE clause" the moment it reached the
-- first DELETE (crm_comms).
--
-- Fix: pg-safeupdate only requires a WHERE clause to be syntactically
-- present -- it does not need to be restrictive. `WHERE true` satisfies it
-- while preserving the exact same "delete everything" semantics the function
-- always intended.

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
  IF NOT is_admin_or_owner() THEN
    RAISE EXCEPTION 'Berre admin kan gjenopprette sikkerhetskopi';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('restore_backup_tables'));

  IF p_tables IS NULL OR jsonb_typeof(p_tables) <> 'object' THEN
    RAISE EXCEPTION 'Ugyldig sikkerhetskopi: tables-feltet er ikkje eit objekt';
  END IF;

  FOREACH v_name IN ARRAY v_names LOOP
    IF NOT (p_tables ? v_name) THEN
      RAISE EXCEPTION 'Ugyldig sikkerhetskopi: manglar tabellen "%"', v_name;
    END IF;
    IF jsonb_typeof(p_tables -> v_name) <> 'array' THEN
      RAISE EXCEPTION 'Ugyldig sikkerhetskopi: "%" er ikkje ei liste', v_name;
    END IF;
  END LOOP;

  IF (
    jsonb_array_length(p_tables->'crm_bedrifter') + jsonb_array_length(p_tables->'crm_customers') +
    jsonb_array_length(p_tables->'crm_comms')     + jsonb_array_length(p_tables->'leads') +
    jsonb_array_length(p_tables->'bookings')      + jsonb_array_length(p_tables->'tasks') +
    jsonb_array_length(p_tables->'announcements') + jsonb_array_length(p_tables->'kb_articles') +
    jsonb_array_length(p_tables->'links')
  ) > 20000 THEN
    RAISE EXCEPTION 'Sikkerhetskopien er for stor til å gjenopprettast automatisk -- ta kontakt med Vibeverk';
  END IF;

  -- WHERE true added to all nine (2026-07-18 fix) -- see header comment.
  DELETE FROM crm_comms WHERE true;
  DELETE FROM crm_customers WHERE true;
  DELETE FROM crm_bedrifter WHERE true;
  DELETE FROM leads WHERE true;
  DELETE FROM bookings WHERE true;
  DELETE FROM tasks WHERE true;
  DELETE FROM announcements WHERE true;
  DELETE FROM kb_articles WHERE true;
  DELETE FROM links WHERE true;

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

  WITH src AS (
    SELECT elem,
      (elem->>'created_by')  IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = (elem->>'created_by')::uuid)  AS bad_cb,
      (elem->>'assigned_to') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = (elem->>'assigned_to')::uuid) AS bad_at
    FROM jsonb_array_elements(p_tables->'tasks') AS elem
  )
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

-- Function signature is unchanged (same name/args), so grants carry over --
-- REVOKE/GRANT re-stated here anyway per CLAUDE.md convention (explicit on
-- every function-defining migration, not assumed to survive a CREATE OR
-- REPLACE untouched).
REVOKE ALL ON FUNCTION restore_backup_tables(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION restore_backup_tables(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION restore_backup_tables(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
