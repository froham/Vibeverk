-- Intern, cookiefri sidetelling (Fase 1) -- alternativ til Plausible for
-- kundar som ikkje har eige Plausible-konto. Sjå docs/project/CHANGELOG.md
-- for grunngjeving/scope-avgrensing (2026-07-31).
--
-- session_id er generert og lagra klientsida i sessionStorage (IKKJE ein
-- cookie -- forsvinn ved fane-lukking, sendast aldri automatisk til
-- server) -- brukast berre til å gruppere treff til same besøk, slik at
-- inngangs-/utgangssider kan spørrast fram i etterkant. Ingen unike
-- besøkjande, ingen bot-filtrering, ingen geolokasjon/enhets-metadata --
-- alt dette er medvite utsett til ei seinare, eiga fase.
CREATE TABLE analytics_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  text        NOT NULL,
  type        text        NOT NULL DEFAULT 'pageview' CHECK (type IN ('pageview', 'cta')),
  path        text        NOT NULL,
  referrer    text,                 -- kun hostname, ALDRI full URL/querystring -- strippa klientsida og cappa her
  cta_id      text CHECK (cta_id IS NULL OR cta_id IN ('tel', 'mailto', 'kontakt', 'tilbud', 'booking')),
  is_test     boolean     NOT NULL DEFAULT false,  -- syntetiske rader frå seed_test_pageviews() -- sjå supabase/staging-only/. Filtrerast bort i admin-spørringar UNNTATT på vibeverk-staging (sjå module-sidetelling.js sin isStagingProject()).
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analytics_events_created_at_idx     ON analytics_events (created_at);
CREATE INDEX analytics_events_session_created_idx ON analytics_events (session_id, created_at);
CREATE INDEX analytics_events_path_idx           ON analytics_events (path);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Anon skriv kun via insert_analytics_event() nedanfor -- ingen direkte
-- tabelltilgang for anon i det heile (same prinsipp som chat-tabellane).
-- Kun innlogga admin/eigar kan lese (Web-admin sitt Analyse-panel).
CREATE POLICY analytics_events_admin_select ON analytics_events
  FOR SELECT TO authenticated USING (is_admin_or_owner());

-- Eksplisitte tabell-grants, same mønster som baseline-migrasjonen sin eigen
-- "-- 7. GRANTS"-seksjon (t.d. chat_conversations/chat_messages): stol ALDRI
-- på at Supabase sin plattform-default alt har gjeve rette tilgangar, gjer
-- det eksplisitt sjølv. Anon skal ikkje ha NOKON direkte tabelltilgang i det
-- heile -- skriving skjer utelukkande via insert_analytics_event() (SECURITY
-- DEFINER, køyrer som funksjonseigar, uavhengig av anon sine eigne grants).
-- authenticated MÅ ha eit eksplisitt SELECT-grant her -- utan det ville
-- RLS-policyen ovanfor aldri nå fram til å bli evaluert i det heile (Postgres
-- avviser på privilegie-nivå FØR RLS, uansett kor korrekt policyen er).
REVOKE ALL  ON analytics_events FROM anon;
GRANT SELECT ON analytics_events TO authenticated;

CREATE OR REPLACE FUNCTION insert_analytics_event(
  p_session_id text, p_type text, p_path text,
  p_referrer text DEFAULT NULL, p_cta_id text DEFAULT NULL
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  IF p_type NOT IN ('pageview', 'cta') THEN
    RAISE EXCEPTION 'Ugyldig type';
  END IF;
  INSERT INTO analytics_events (session_id, type, path, referrer, cta_id)
  VALUES (left(p_session_id, 100), p_type, left(p_path, 300), left(p_referrer, 200), left(p_cta_id, 50));
END;
$$;

-- Eksplisitt REVOKE frå både PUBLIC og authenticated, deretter eksplisitt
-- GRANT kun til anon -- Supabase sin plattform-default gir elles EXECUTE
-- til anon/authenticated/service_role uavhengig av REVOKE ... FROM PUBLIC
-- (stadfesta fallgruve, sjå CLAUDE.md).
REVOKE ALL ON FUNCTION insert_analytics_event(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION insert_analytics_event(text, text, text, text, text) TO anon;

NOTIFY pgrst, 'reload schema';
