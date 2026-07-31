-- ============================================================================
-- seed_test_pageviews.sql — STAGING-ONLY, ALDRI EIN MIGRASJON
-- ============================================================================
-- IKKJE flytt denne fila til supabase/migrations/. Den mappa er delt,
-- deployable migrasjonshistorikk som til slutt vert køyrt mot ETVKART
-- kundeprosjekt (npx supabase db push --linked) -- denne funksjonen skal
-- ALDRI finnast der. Den lever her, køyrast manuelt kun mot
-- vibeverk-staging (ref syqnyfeponexmkdvnsga), aldri mot produksjon
-- (clzczbyklgdtdhgjphup) eller noko anna kundeprosjekt:
--
--   npx supabase db query --file supabase/staging-only/seed_test_pageviews.sql \
--     --db-url "<vibeverk-staging pooler connection string>"
--
-- Deretter kall funksjonen sjølv (som innlogga admin/eigar i staging):
--   select seed_test_pageviews();      -- 500 rader siste 30 dagar (standard)
--   select seed_test_pageviews(60, 2000);  -- 60 dagar, 2000 rader
--
-- FORUTSETNING (må gjerast MANUELT, kun éin gong, kun på vibeverk-staging):
-- Set ein Postgres-konfigurasjonsverdi som markerer prosjektet som staging,
-- via Dashboard -> Project Settings -> Database -> "Custom Postgres config"
-- (eller tilsvarande via connection-streng-parameter):
--   app.settings.is_staging = on
-- Funksjonen NEKTAR å køyre om denne ikkje er sett til nøyaktig 'on' --
-- fail-closed by construction, ikkje ei allow-liste å vedlikehalde. Verifiser
-- faktisk med:  select current_setting('app.settings.is_staging', true);
-- FØR fyrste bruk her, ikkje anta at det er sett.
-- ============================================================================

CREATE OR REPLACE FUNCTION seed_test_pageviews(p_days int DEFAULT 30, p_count int DEFAULT 500)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_paths     text[] := ARRAY['#hjem', '#om-oss', '#tjenester', '#referanser', '#aktuelt', '#faq', '#kontakt', '#tilbud', '#booking'];
  v_referrers text[] := ARRAY[NULL, NULL, NULL, 'google.com', 'facebook.com', 'instagram.com'];
  v_ctas      text[] := ARRAY['tel', 'mailto', 'kontakt', 'tilbud', 'booking'];
  i           int;
  v_session   text;
  v_path      text;
  v_ts        timestamptz;
BEGIN
  IF NOT is_admin_or_owner() THEN
    RAISE EXCEPTION 'Ikke tilgang';
  END IF;
  IF current_setting('app.settings.is_staging', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'seed_test_pageviews() finnes kun i testmiljø (vibeverk-staging)';
  END IF;

  FOR i IN 1..p_count LOOP
    -- Grupper ~1-4 sidevisninger per "besøk" ved å gjenbruke samme
    -- session_id for et par rader på rad, slik at inngangs-/utgangssider
    -- ser realistiske ut i adminpanelet.
    IF i = 1 OR random() < 0.35 THEN
      v_session := gen_random_uuid()::text;
    END IF;
    v_path := v_paths[1 + floor(random() * array_length(v_paths, 1))::int];
    v_ts   := now() - (random() * p_days || ' days')::interval;

    INSERT INTO analytics_events (session_id, type, path, referrer, is_test, created_at)
    VALUES (v_session, 'pageview', v_path, v_referrers[1 + floor(random() * array_length(v_referrers, 1))::int], true, v_ts);

    IF random() < 0.15 THEN
      INSERT INTO analytics_events (session_id, type, path, cta_id, is_test, created_at)
      VALUES (v_session, 'cta', v_path, v_ctas[1 + floor(random() * array_length(v_ctas, 1))::int], true, v_ts + interval '1 second');
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION seed_test_pageviews(int, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION seed_test_pageviews(int, int) TO authenticated;

-- Rydd unna testdata igjen (kjør manuelt når du er ferdig å teste UI-et):
--   delete from analytics_events where is_test = true;
