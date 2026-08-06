-- Fase 2 (personvern-videreutvikling) -- samtykke-revisjonsspor: kva som
-- faktisk vart vist/svart ved sjølve innsendingstidspunktet, fryst inline på
-- sjølve rada. Sjå docs/compliance/legal-complexity-vs-value-2026-08-06.md
-- og console/console-core.js sin Personvern-fane (Samtykker-fana) for
-- korleis desse formåla vert definerte.
--
-- Nullbar, aldri obligatorisk -- eit skjema utan konfigurerte
-- samtykkeformål (dei aller fleste, i dag) sender aldri noko p_consent i
-- det heile, kolonna forblir NULL. Struktur (dokumentert, ikkje handheva av
-- databasen):
--   { formKey: "kontakt"|"tilbud"|"booking",
--     privacyVersionId: text|null, privacyPublishedAt: text|null,
--     purposes: [ { id, label, answer: bool, at: iso-tidsstempel } ] }
ALTER TABLE leads    ADD COLUMN consent jsonb;
ALTER TABLE bookings ADD COLUMN consent jsonb;

-- Postgres-fallgruve (same som ved tidlegare parameter-tilføyingar): nye
-- parametrar skapar ein NY, overlasta funksjon ved sida av den gamle,
-- CREATE OR REPLACE erstattar berre identiske signaturar. Droppar difor dei
-- gamle signaturane eksplisitt.
DROP FUNCTION IF EXISTS insert_anon_lead(text, text, text, text, text, text, text, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION insert_anon_lead(
  p_id text, p_kind text, p_name text, p_email text, p_message text,
  p_reference_number text, p_source text DEFAULT NULL, p_chat_id text DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb, p_visitor_id text DEFAULT NULL,
  p_analytics_session_id text DEFAULT NULL, p_consent jsonb DEFAULT NULL
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
    INSERT INTO leads (id, kind, name, email, message, reference_number, source, chat_id, attachments, analytics_session_id, consent)
    VALUES (p_id, p_kind, COALESCE(p_name, ''), COALESCE(p_email, ''), p_message, p_reference_number, p_source, p_chat_id, COALESCE(p_attachments, '[]'::jsonb), left(p_analytics_session_id, 100), p_consent)
    ON CONFLICT (chat_id) WHERE chat_id IS NOT NULL
    DO UPDATE SET
      message = EXCLUDED.message,
      name    = COALESCE(NULLIF(EXCLUDED.name, ''), leads.name),
      email   = COALESCE(NULLIF(EXCLUDED.email, ''), leads.email);
  ELSE
    INSERT INTO leads (id, kind, name, email, message, reference_number, source, chat_id, attachments, analytics_session_id, consent)
    VALUES (p_id, p_kind, COALESCE(p_name, ''), COALESCE(p_email, ''), p_message, p_reference_number, p_source, p_chat_id, COALESCE(p_attachments, '[]'::jsonb), left(p_analytics_session_id, 100), p_consent);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION insert_anon_lead(text, text, text, text, text, text, text, text, jsonb, text, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION insert_anon_lead(text, text, text, text, text, text, text, text, jsonb, text, text, jsonb) TO anon;

DROP FUNCTION IF EXISTS insert_anon_booking(text, text, date, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION insert_anon_booking(
  p_id text, p_asset_id text, p_date date, p_time text,
  p_name text, p_email text, p_phone text, p_message text, p_reference_number text,
  p_analytics_session_id text DEFAULT NULL, p_consent jsonb DEFAULT NULL
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO bookings (id, asset_id, date, time, name, email, phone, message, instant, reference_number, analytics_session_id, consent)
  VALUES (p_id, p_asset_id, p_date, p_time, COALESCE(p_name, ''), COALESCE(p_email, ''), COALESCE(p_phone, ''), p_message, true, p_reference_number, left(p_analytics_session_id, 100), p_consent);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Beklager, denne tiden er ikke lenger ledig.';
END;
$$;

REVOKE EXECUTE ON FUNCTION insert_anon_booking(text, text, date, text, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION insert_anon_booking(text, text, date, text, text, text, text, text, text, text, jsonb) TO anon;

NOTIFY pgrst, 'reload schema';
