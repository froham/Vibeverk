-- UTM-sporing for sidetellinga -- fangar kampanjemerking (utm_source/
-- utm_medium/utm_campaign) kunden SJØLV har lagt i sine eigne utgåande
-- lenker (annonseplattform, e-postkampanje, QR-kode). Dette er ikkje ein
-- ny datainnsamlingskategori om den besøkjande -- det er ein eigenskap ved
-- lenka, same slag kategorisk metadata som referrer/device_type alt er.
-- Ingen eksternt API-kall, ingen ny nettlesarlagring -- prinsipp 2/3 i
-- docs/architecture/sidetelling.md er uendra. Arkitekt-konsultert plan
-- 2026-08-07 før koding, sjå docs/project/CHANGELOG.md.
ALTER TABLE analytics_events
  ADD COLUMN utm_source   text CHECK (utm_source   IS NULL OR length(utm_source)   <= 100),
  ADD COLUMN utm_medium   text CHECK (utm_medium   IS NULL OR length(utm_medium)   <= 100),
  ADD COLUMN utm_campaign text CHECK (utm_campaign IS NULL OR length(utm_campaign) <= 100);

-- Same "ny overlasta funksjon ved sida av den gamle"-fallgruve som
-- 20260803140201_add_analytics_device_bot.sql sjølv dokumenterer -- droppar
-- den gamle 7-argument-signaturen eksplisitt før CREATE OR REPLACE, sidan
-- klient og database alltid vert deploya saman i dette repoet (ingen
-- gradvis utrullingsvindauge å ta omsyn til for denne skrivefunksjonen).
DROP FUNCTION IF EXISTS insert_analytics_event_service(text, text, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION insert_analytics_event_service(
  p_session_id text,
  p_type text,
  p_path text,
  p_referrer text DEFAULT NULL,
  p_cta_id text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_is_bot boolean DEFAULT false,
  p_utm_source text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_group_count integer;
  v_minute_count integer;
  v_global_count integer;
  v_minute_bucket text;
BEGIN
  -- Same fail-closed rollesjekk som resten av funksjonen alt hadde --
  -- uendra av denne utvidinga.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Berre service_role kan lagre sidetellingshendingar';
  END IF;

  IF p_session_id IS NULL OR p_session_id !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Ugyldig dagskode';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('pageview', 'cta') THEN
    RAISE EXCEPTION 'Ugyldig type';
  END IF;
  IF p_path IS NULL OR btrim(p_path) = '' OR length(p_path) > 300 THEN
    RAISE EXCEPTION 'Ugyldig path';
  END IF;
  IF p_referrer IS NOT NULL AND length(p_referrer) > 200 THEN
    RAISE EXCEPTION 'Ugyldig referrer';
  END IF;
  IF p_cta_id IS NOT NULL AND p_cta_id NOT IN ('tel', 'mailto', 'kontakt', 'tilbud', 'booking') THEN
    RAISE EXCEPTION 'Ugyldig cta_id';
  END IF;
  IF p_device_type IS NOT NULL AND p_device_type NOT IN ('mobil', 'nettbrett', 'pc') THEN
    RAISE EXCEPTION 'Ugyldig device_type';
  END IF;
  IF p_utm_source IS NOT NULL AND length(p_utm_source) > 100 THEN
    RAISE EXCEPTION 'Ugyldig utm_source';
  END IF;
  IF p_utm_medium IS NOT NULL AND length(p_utm_medium) > 100 THEN
    RAISE EXCEPTION 'Ugyldig utm_medium';
  END IF;
  IF p_utm_campaign IS NOT NULL AND length(p_utm_campaign) > 100 THEN
    RAISE EXCEPTION 'Ugyldig utm_campaign';
  END IF;

  -- Serialiser berre kall for same dags-hash, slik at parallelle requestar
  -- ikkje kan passere gruppetaket samtidig. Hashen er allereie dagsavgrensa.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id, 20260806));
  SELECT count(*) INTO v_group_count
  FROM analytics_events
  WHERE session_id = p_session_id;
  IF v_group_count >= 200 THEN
    RETURN false;
  END IF;

  -- Minutt-kvote, uendra frå 20260806170936 -- sjå den migrasjonen sin
  -- eigen kommentar for Security Auditor-grunngjevinga.
  v_minute_bucket := to_char(date_trunc('minute', statement_timestamp() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_minute_bucket, 20260806));
  INSERT INTO analytics_event_minute_quota (minute_bucket, event_count)
  VALUES (v_minute_bucket, 1)
  ON CONFLICT (minute_bucket) DO UPDATE
    SET event_count = analytics_event_minute_quota.event_count + 1
    WHERE analytics_event_minute_quota.event_count < 60
  RETURNING event_count INTO v_minute_count;
  IF v_minute_count IS NULL THEN
    RETURN false;
  END IF;

  -- Atomisk globalt dagsbudsjett, uendra frå 20260806170936.
  INSERT INTO analytics_event_daily_quota (day, event_count)
  VALUES ((statement_timestamp() AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (day) DO UPDATE
    SET event_count = analytics_event_daily_quota.event_count + 1
    WHERE analytics_event_daily_quota.event_count < 10000
  RETURNING event_count INTO v_global_count;
  IF v_global_count IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO analytics_events (session_id, type, path, referrer, cta_id, device_type, is_bot, utm_source, utm_medium, utm_campaign)
  VALUES (
    p_session_id,
    p_type,
    p_path,
    p_referrer,
    p_cta_id,
    p_device_type,
    COALESCE(p_is_bot, false),
    p_utm_source,
    p_utm_medium,
    p_utm_campaign
  );

  RETURN true;
END;
$$;

-- Eksplisitte rolletilgangar for den nye signaturen -- same disiplin som
-- 20260806170936 sjølv innfører og CLAUDE.md krev (plattform-defaultane
-- varierer mellom prosjekt, må aldri antakast).
REVOKE ALL ON FUNCTION insert_analytics_event_service(text, text, text, text, text, text, boolean, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION insert_analytics_event_service(text, text, text, text, text, text, boolean, text, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
