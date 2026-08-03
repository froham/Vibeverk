-- Fase 2 (steg 3b) av sidetellinga -- konverteringskobling: kva
-- lead/booking som kom frå ein besøkjande sidetellinga alt følgjer. Sjå
-- docs/project/CHANGELOG.md sitt 0.8x-innslag og
-- docs/architecture/sidetelling.md for full grunngjeving/Arkitekt-vurdering
-- (2026-08-03).
--
-- Nullable, laus kopling -- same mønster som leads.chat_id (sjå
-- 20260717140000_dedup_anon_lead_chat_id.sql): analytics_session_id er
-- IKKJE ein foreign key (session_id på analytics_events er ein
-- grupperingsnøkkel, ikkje unik/PRIMARY KEY -- ein ekte FK er ikkje mogleg).
-- Verdien kjem frå App.getAnalyticsSessionId() (core.js), same
-- sessionStorage-nøkkel sidetellinga sjølv skriv -- forsvinn ved
-- fane-lukking, aldri ein cookie. Er features.sidetelling av, er verdien
-- alltid NULL -- skjemaa fungerer heilt uendra.
ALTER TABLE leads    ADD COLUMN analytics_session_id text;
ALTER TABLE bookings ADD COLUMN analytics_session_id text;

-- Postgres-fallgruve (same som 20260803140201_add_analytics_device_bot.sql):
-- nye parametrar skapar ein NY, overlasta funksjon ved sida av den gamle,
-- CREATE OR REPLACE erstattar berre identiske signaturar. Droppar difor dei
-- gamle signaturane eksplisitt.
DROP FUNCTION IF EXISTS insert_anon_lead(text, text, text, text, text, text, text, text, jsonb, text);

CREATE OR REPLACE FUNCTION insert_anon_lead(
  p_id text, p_kind text, p_name text, p_email text, p_message text,
  p_reference_number text, p_source text DEFAULT NULL, p_chat_id text DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb, p_visitor_id text DEFAULT NULL,
  p_analytics_session_id text DEFAULT NULL
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_owned boolean := false;
BEGIN
  IF p_kind NOT IN ('kontakt', 'tilbud') THEN
    RAISE EXCEPTION 'Ugyldig kind';
  END IF;

  IF p_chat_id IS NOT NULL AND p_visitor_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM chat_conversations WHERE id = p_chat_id AND visitor_id = p_visitor_id
    ) INTO v_owned;
  END IF;

  IF v_owned THEN
    INSERT INTO leads (id, kind, name, email, message, reference_number, source, chat_id, attachments, analytics_session_id)
    VALUES (p_id, p_kind, COALESCE(p_name, ''), COALESCE(p_email, ''), p_message, p_reference_number, p_source, p_chat_id, COALESCE(p_attachments, '[]'::jsonb), left(p_analytics_session_id, 100))
    ON CONFLICT (chat_id) WHERE chat_id IS NOT NULL
    DO UPDATE SET
      message = EXCLUDED.message,
      name    = COALESCE(NULLIF(EXCLUDED.name, ''), leads.name),
      email   = COALESCE(NULLIF(EXCLUDED.email, ''), leads.email);
  ELSE
    INSERT INTO leads (id, kind, name, email, message, reference_number, source, chat_id, attachments, analytics_session_id)
    VALUES (p_id, p_kind, COALESCE(p_name, ''), COALESCE(p_email, ''), p_message, p_reference_number, p_source, p_chat_id, COALESCE(p_attachments, '[]'::jsonb), left(p_analytics_session_id, 100));
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION insert_anon_lead(text, text, text, text, text, text, text, text, jsonb, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION insert_anon_lead(text, text, text, text, text, text, text, text, jsonb, text, text) TO anon;

DROP FUNCTION IF EXISTS insert_anon_booking(text, text, date, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION insert_anon_booking(
  p_id text, p_asset_id text, p_date date, p_time text,
  p_name text, p_email text, p_phone text, p_message text, p_reference_number text,
  p_analytics_session_id text DEFAULT NULL
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO bookings (id, asset_id, date, time, name, email, phone, message, instant, reference_number, analytics_session_id)
  VALUES (p_id, p_asset_id, p_date, p_time, COALESCE(p_name, ''), COALESCE(p_email, ''), COALESCE(p_phone, ''), p_message, true, p_reference_number, left(p_analytics_session_id, 100));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Beklager, denne tiden er ikke lenger ledig.';
END;
$$;

REVOKE EXECUTE ON FUNCTION insert_anon_booking(text, text, date, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION insert_anon_booking(text, text, date, text, text, text, text, text, text, text) TO anon;

NOTIFY pgrst, 'reload schema';
