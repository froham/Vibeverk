-- Byter sidetellinga si sesjonsgruppering frå ein klientgenerert verdi i
-- sessionStorage til ein dagsavgrensa SHA-256-hash rekna i Edge Function-en
-- `sidetelling-event`. Sjå docs/architecture/sidetelling.md og
-- docs/compliance/legal-complexity-vs-value-2026-08-06.md del 5.
--
-- Personvern-/lagringsgrense (eksplisitt): den NYE sesjonsgrupperinga les
-- eller skriv ALDRI cookie, localStorage eller sessionStorage. IP-adresse,
-- User-Agent og Origin vert i sjølve Edge-funksjonen berre behandla som
-- request-headerar; av denne requestkonteksten vert berre den 64 teikn lange
-- dags-hashen sendt til skrivefunksjonen og lagra saman med hendingsfelta.
-- Supabase-infrastrukturen sine eventuelle request-loggar er ein separat,
-- leverandørstyrt dataflyt som må verifiserast.
-- UTC-dagen er deterministisk og vert ikkje lagra i ei salttabell -- det
-- finst ingen nøkkelrotasjon, token-tabell eller HLL-mekanisme her.

-- Ressursvern for den offentlege Edge-endepunktet: éi global teljarrad per
-- UTC-dag avgrensar databasevekst til 10 000 analysehendingar per installasjon
-- og dag. Tabellen inneheld berre dato + tal -- ingen IP, UA, hash, salt,
-- token eller besøksidentitet. Eit eige tak på 200 rader per dags-hash brukar
-- den eksisterande analytics_events-indeksen og lagrar ingen ny identifikator.
CREATE TABLE IF NOT EXISTS analytics_event_daily_quota (
  day         date PRIMARY KEY,
  event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0)
);

ALTER TABLE analytics_event_daily_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON analytics_event_daily_quota FROM PUBLIC, anon, authenticated, service_role;

-- Security Auditor-funn (2026-08-06, HIGH), retta før merge: p_session_id er
-- ein dags-hash rekna av Edge Function-en frå IP+UA+Origin-headerar --
-- headerar ein kallar UTAN nettlesar (rein HTTP-script, ingen CORS-vern
-- gjeld) i prinsippet kan forfalske (fyrste ledd i X-Forwarded-For er ikkje
-- verifisert plattform-sett enno, sjå notatet ved insert_analytics_event_service
-- under). Utan denne ekstra sperra kunne ein angripar generere mange ULIKE
-- forfalska hash-ar (kvar under 200-taket sitt eige tak) og på nokre få
-- sekund tømme HEILE dagsbudsjettet på 10 000 -- og dermed stille alle ekte
-- besøkjande sine hendingar resten av dagen, sidan det globale taket rammar
-- ALLE, ikkje berre angriparen. Éin ekstra, smal minutt-bøtte gjer at eit
-- raskt utført skript ikkje lenger kan tømme heile dagen sitt budsjett i éin
-- einaste smell -- ekte trafikk for ein vanleg kundenettstad spreier seg
-- naturleg utover dagen og råkar aldri denne grensa. Same "berre dato/tal,
-- ingen identitet"-prinsipp som dagstabellen over.
CREATE TABLE IF NOT EXISTS analytics_event_minute_quota (
  minute_bucket text PRIMARY KEY,
  event_count   integer NOT NULL DEFAULT 0 CHECK (event_count >= 0)
);

ALTER TABLE analytics_event_minute_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON analytics_event_minute_quota FROM PUBLIC, anon, authenticated, service_role;

-- Gamle, cachelagra klientar kallar framleis denne funksjonen og kan framleis
-- røre den gamle sessionStorage-nøkkelen fram til fana vert lasta på nytt.
-- Behald difor signaturen mellombels, men gjer han til ein medviten STABLE
-- no-op: den gamle klient-ID-en vert aldri lagra, og klienten får heller ikkje
-- ein PostgREST-feil under database-fyrst-utrullinga. Ny klient brukar berre
-- Edge Function-en. Denne kompatibilitetsfunksjonen kan droppast seinare.
CREATE OR REPLACE FUNCTION insert_analytics_event(
  p_session_id text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_path text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_cta_id text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_is_bot boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION insert_analytics_event(text, text, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION insert_analytics_event(text, text, text, text, text, text, boolean)
  TO anon;

-- Smal skriveveg for Edge Function-en. Han tek berre imot den ferdige
-- dags-hashen og kategoriske/avgrensa hendingsfelt -- ALDRI rå IP, UA eller
-- Origin. VOLATILE er naudsynt fordi funksjonen gjer INSERT; dette er ikkje
-- eit avvik for ein anon-vend funksjon, sidan berre service_role får EXECUTE.
CREATE OR REPLACE FUNCTION insert_analytics_event_service(
  p_session_id text,
  p_type text,
  p_path text,
  p_referrer text DEFAULT NULL,
  p_cta_id text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_is_bot boolean DEFAULT false
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
  -- ACL-en under er nødvendig, men ikkje den einaste sperra: valider òg den
  -- faktiske JWT-rolla inne i SECURITY DEFINER-kroppen og feil lukka dersom
  -- framtidige plattform-defaultar eller grant-drift opnar EXECUTE ved eit
  -- uhell. Edge Function-en er den einaste legitime service_role-kallaren.
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

  -- Serialiser berre kall for same dags-hash, slik at parallelle requestar
  -- ikkje kan passere gruppetaket samtidig. Hashen er allereie dagsavgrensa.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id, 20260806));
  SELECT count(*) INTO v_group_count
  FROM analytics_events
  WHERE session_id = p_session_id;
  IF v_group_count >= 200 THEN
    RETURN false;
  END IF;

  -- Security Auditor-funn (2026-08-06, HIGH): sjå notatet ved
  -- analytics_event_minute_quota over. Serialiserer per minutt-bøtte, same
  -- mønster som pg_advisory_xact_lock-en over. 60/minutt er ei rundeleg
  -- ramme for ekte augeblikkeleg trafikk (t.d. mange samtidige besøkjande
  -- rett etter ein e-postutsending), men stoppar eit skript frå å tømme
  -- heile dagen sitt 10 000-budsjett i løpet av nokre få sekund.
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

  -- Atomisk globalt dagsbudsjett. WHERE-vakta gjer at RETURNING ikkje gjev
  -- noka rad når taket er nådd; då vert sjølve hendinga ikkje sett inn.
  INSERT INTO analytics_event_daily_quota (day, event_count)
  VALUES ((statement_timestamp() AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (day) DO UPDATE
    SET event_count = analytics_event_daily_quota.event_count + 1
    WHERE analytics_event_daily_quota.event_count < 10000
  RETURNING event_count INTO v_global_count;
  IF v_global_count IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO analytics_events (session_id, type, path, referrer, cta_id, device_type, is_bot)
  VALUES (
    p_session_id,
    p_type,
    p_path,
    p_referrer,
    p_cta_id,
    p_device_type,
    COALESCE(p_is_bot, false)
  );

  RETURN true;
END;
$$;

-- Eksplisitte rolletilgangar -- Supabase-defaultane varierer mellom prosjekt.
-- Edge-funksjonen har service key i servermiljøet; browseren kan aldri kalle
-- denne hjelpefunksjonen direkte med anon-/authenticated-rolla.
REVOKE ALL ON FUNCTION insert_analytics_event_service(text, text, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION insert_analytics_event_service(text, text, text, text, text, text, boolean)
  TO service_role;

NOTIFY pgrst, 'reload schema';
