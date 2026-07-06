-- =============================================================================
-- hotfix_anon_leads_bookings_rpc_2026-07-06.sql
-- -----------------------------------------------------------------------------
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- REQUIRES the paired core.js/module-booking.js client change described at
-- the bottom of this file. Unlike the chat-visitor-RPC hotfix, this file is
-- purely additive (anon has no existing leads/bookings grant to revoke), so
-- there is no dangerous ordering window — running this SQL alone is safe even
-- before the client change lands (it just adds unused capability). The client
-- change is what actually makes anonymous submissions start reaching Supabase.
--
-- ORDERING: must run AFTER hotfix_tilbud_attachments_2026-07-06.sql (this
-- file's insert_anon_lead() writes to leads.attachments, which that file adds).
--
-- Funn ("Bolk D", Architect-konsultasjon 2026-07-06): anonyme innsendingar av
-- Kontakt-/Tilbud-leads og sanntidsbooking når aldri Supabase. `addLead()`
-- (core.js) og `createBooking()` (module-booking.js) hoppar bevisst over
-- Supabase-kallet for uinnlogga besøkande og skriv berre til den eine
-- besøkande sin eigen localStorage — admin ser aldri innsendinga, sjølv om
-- UI-en viser "mottatt"/"Reservert!". `leads`/`bookings` har ingen anon-GRANT
-- i det heile (stadfesta i migration.sql), så eit rått anon-innsett ville
-- uansett vorte avvist av RLS.
--
-- Løysing: same mønster som dei eksisterande visitor-chat-RPC-ane
-- (get_visitor_conv/get_visitor_msgs, update_visitor_presence/
-- insert_visitor_message) — SECURITY DEFINER-funksjonar som anon får EXPLICIT
-- EXECUTE-tilgang til, i staden for direkte RLS-opna INSERT. Ingen visitor_id-
-- eigarskapssjekk er naudsynt her (ulikt chat) sidan dette er reine
-- one-shot-innsettingar utan seinare anon-lesing/oppdatering nokon stad i koden.
--
-- Bookingar krev i tillegg ein ATOMISK konfliktsjekk: anon kan i dag ikkje
-- SELECT bookings i det heile (ingen anon-GRANT), så isBooked()/isBlocked()
-- (klient) er alt "blind" for anon og fungerer ikkje som reell dobbeltbooking-
-- sperre. Ein UNIQUE-constraint på (asset_id, date, time) + fange
-- unique_violation inne i RPC-en er den einaste måten å gjere konfliktsjekken
-- trygg under samtidige innsendingar (elles er "sjekk så skriv" i klientkode
-- aldri atomisk). Ingen statusfilter i constrainten sidan isBooked() sjølv
-- ikkje filtrerer på status (`ny`/`lest`/`løst` tel alle som "oppteke" til
-- admin slettar raden).
--
-- Denne fila er også lagt inn i supabase/migration.sql.
-- =============================================================================


-- ── 1. Leads (Kontakt + Tilbud, delt éin RPC same som addLead() deler éin JS-funksjon) ──

-- p_attachments dekker Tilbud-vedlegg (App.media.putFile()-resultat, sjå
-- hotfix_tilbud_attachments_2026-07-06.sql sin nye attachments-kolonne) —
-- lagt til her sidan anon-Tilbud-innsendingar elles ville mista vedlegga sine
-- akkurat som resten av leaden gjorde før den fila.
CREATE OR REPLACE FUNCTION insert_anon_lead(
  p_id text, p_kind text, p_name text, p_email text, p_message text,
  p_reference_number text, p_source text DEFAULT NULL, p_chat_id text DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  IF p_kind NOT IN ('kontakt', 'tilbud') THEN
    RAISE EXCEPTION 'Ugyldig kind';
  END IF;
  INSERT INTO leads (id, kind, name, email, message, reference_number, source, chat_id, attachments)
  VALUES (p_id, p_kind, COALESCE(p_name, ''), COALESCE(p_email, ''), p_message, p_reference_number, p_source, p_chat_id, COALESCE(p_attachments, '[]'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION insert_anon_lead(text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION insert_anon_lead(text, text, text, text, text, text, text, text, jsonb) TO anon;


-- ── 2. Bookingar (sanntid), med atomisk konfliktsjekk ───────────────────────

-- Idempotent constraint-tillegg (ADD CONSTRAINT har ingen IF NOT EXISTS i
-- Postgres < 17 sin egen syntaks for constraints -- bruk ein DO-blokk).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_asset_date_time_key'
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_asset_date_time_key UNIQUE (asset_id, date, time);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION insert_anon_booking(
  p_id text, p_asset_id text, p_date date, p_time text,
  p_name text, p_email text, p_phone text, p_message text, p_reference_number text
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO bookings (id, asset_id, date, time, name, email, phone, message, instant, reference_number)
  VALUES (p_id, p_asset_id, p_date, p_time, COALESCE(p_name, ''), COALESCE(p_email, ''), COALESCE(p_phone, ''), p_message, true, p_reference_number);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Beklager, denne tiden er ikke lenger ledig.';
END;
$$;

REVOKE EXECUTE ON FUNCTION insert_anon_booking(text, text, date, text, text, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION insert_anon_booking(text, text, date, text, text, text, text, text, text) TO anon;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- REQUIRED CLIENT CHANGE (core.js + module-booking.js):
--
-- core.js's addLead(lead): split the current single
-- `if (!_sb || !_isAuthed) { ...localStorage-only... }` gate into two:
--   if (!_sb) { ...unchanged localStorage-only fallback... }
--   else if (!_isAuthed) {
--     _sb.rpc('insert_anon_lead', { p_id:newLead.id, p_kind:newLead.kind,
--       p_name:newLead.name, p_email:newLead.email, p_message:newLead.message,
--       p_reference_number:newLead.referenceNumber, p_source:newLead.source,
--       p_chat_id:newLead.chatId, p_attachments:newLead.attachments
--       }).then(function(r){ if (r.error) logWriteError("opprette anonym henvendelse", r.error); });
--     return newLead; // uendra synkron retur, ingen kallar les tilbake
--   }
--   else { ...uendra autentisert gren (_leads.unshift + _sb.from("leads").insert...))... }
--
-- module-booking.js: add a new submitAnonBooking(data) Promise-returning
-- helper that calls _sb.rpc('insert_anon_booking', {...}) and rejects with a
-- readable error on failure (including the unique_violation friendly message
-- above). Update openConfirm()'s submit handler (module-booking.js, the
-- anonymous real-time booking confirm form) to AWAIT this instead of calling
-- createBooking() directly -- show a brief pending state ("Reserverer…",
-- submit disabled) and render either the existing success message or a
-- "tiden er ikke lenger ledig" error. createBooking() itself stays
-- synchronous/fire-and-forget, used only by the admin-panel "legg til
-- booking" form (always authenticated) -- its anon caller moves to
-- submitAnonBooking() instead, it does not need further changes itself.
--
-- Manual test required after the client change, before running this file:
-- 1) As a genuine anonymous visitor (private window, no admin session):
--    submit Kontakt, submit Tilbud, submit a booking request form, and
--    complete an instant booking -- confirm each actually reaches Supabase
--    (visible in Web-admin/Workspace afterward, not just in the submitting
--    browser's own localStorage).
-- 2) Deliberately double-submit the same instant-booking slot from two
--    separate browser tabs/windows to confirm the unique-violation path
--    surfaces the friendly "tiden er ikke lenger ledig" error instead of a
--    false "Reservert!" for the second submission.
-- 3) Confirm the admin-authenticated booking-creation flow (Workspace/
--    Web-admin "legg til booking" form) still works unchanged.
-- =============================================================================
