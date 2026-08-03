-- Fase 2 (steg 1) av sidetellinga -- einingskategori + bot-filtrering.
-- Sjå docs/project/CHANGELOG.md sitt 0.8x-innslag og
-- docs/architecture/sidetelling.md for full grunngjeving/Arkitekt-vurdering
-- (2026-08-03).
--
-- Begge felta er avleia klientsida frå navigator.userAgent, same mønster
-- som chat_conversations.browser/os (module-chat.js sin getBrowserInfo())
-- alt bruker -- FØREHANDSREKNA, kategoriske felt, aldri ein rå UA-streng
-- lagra server-sida (personvernsomsyn: ein rå UA-streng er ein del av ein
-- fingerprinting-vektor, ein kategorisk verdi som "mobil"/"pc" er det ikkje).
ALTER TABLE analytics_events
  ADD COLUMN device_type text CHECK (device_type IS NULL OR device_type IN ('mobil', 'nettbrett', 'pc')),
  ADD COLUMN is_bot       boolean NOT NULL DEFAULT false;

-- Same filter-mønster som is_test alt har i adminspørringane
-- (module-sidetelling.js sin fetchStats()) -- bot-trafikk skal aldri telje
-- med i dei tala ein kunde faktisk ser, uavhengig av staging/produksjon.
CREATE INDEX analytics_events_is_bot_idx ON analytics_events (is_bot) WHERE is_bot = true;

-- Postgres-fallgruve: å leggje til nye parametrar på ein eksisterande
-- funksjon skapar ein NY, overlasta funksjon ved sida av den gamle --
-- CREATE OR REPLACE erstattar berre funksjonar med IDENTISK
-- parametertypeliste. Droppar difor den gamle 5-argument-signaturen
-- eksplisitt her, i staden for å la han liggje att utilsikta (ingen behov
-- for gradvis utrulling av denne funksjonen -- klienten og databasen
-- deployast alltid saman i dette repoet).
DROP FUNCTION IF EXISTS insert_analytics_event(text, text, text, text, text);

CREATE OR REPLACE FUNCTION insert_analytics_event(
  p_session_id text, p_type text, p_path text,
  p_referrer text DEFAULT NULL, p_cta_id text DEFAULT NULL,
  p_device_type text DEFAULT NULL, p_is_bot boolean DEFAULT false
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  IF p_type NOT IN ('pageview', 'cta') THEN
    RAISE EXCEPTION 'Ugyldig type';
  END IF;
  IF p_device_type IS NOT NULL AND p_device_type NOT IN ('mobil', 'nettbrett', 'pc') THEN
    RAISE EXCEPTION 'Ugyldig device_type';
  END IF;
  INSERT INTO analytics_events (session_id, type, path, referrer, cta_id, device_type, is_bot)
  VALUES (left(p_session_id, 100), p_type, left(p_path, 300), left(p_referrer, 200), left(p_cta_id, 50), p_device_type, coalesce(p_is_bot, false));
END;
$$;

-- Eksplisitt REVOKE frå både PUBLIC og authenticated, deretter eksplisitt
-- GRANT kun til anon -- same stadfesta plattform-default-fallgruve som
-- 20260731103651_add_analytics_events.sql sjølv åtvarar om, gjeld like
-- mykje for denne nye, overlasta signaturen.
REVOKE ALL ON FUNCTION insert_analytics_event(text, text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION insert_analytics_event(text, text, text, text, text, text, boolean) TO anon;

NOTIFY pgrst, 'reload schema';
