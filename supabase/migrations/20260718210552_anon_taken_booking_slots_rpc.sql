-- Fixes a real, previously-accepted UX gap (Codex-gjennomgang 2026-07-18,
-- MEDIUM): anon har ALDRI hatt SELECT-tilgang på bookings (med vilje, sidan
-- rada inneheld namn/e-post/telefon/melding for kunden som booka) --
-- insert_anon_booking() sin eigen kommentar (20260707000001_baseline_schema.sql)
-- dokumenterer alt at isBooked()/isBlocked() (klient) difor er "blind" for
-- anon, og stolte medvite berre på den atomiske UNIQUE-konstrainten
-- (bookings_asset_date_time_key) for å hindre faktisk dobbeltbooking -- ein
-- akseptert avveging DENGANG, ikkje ein feil.
--
-- Reell konsekvens: kalenderen viser ALLE tider som ledige for ein besøkjande,
-- sjølv fullbooka dagar -- dei fyller ut heile skjemaet og vert FYRST avvist
-- av insert_anon_booking() sin unique_violation-fangst heilt til slutt. Denne
-- funksjonen gjev anon nok informasjon til å teikne kalenderen korrekt, UTAN
-- å eksponere noko personopplysning i det heile -- berre (asset_id, date,
-- time)-tuplar for ALLE eksisterande bookingar, ingen id/namn/e-post/telefon/
-- melding/referansenummer. Ingen asset_id-parameter -- loadBookings() (klient)
-- lastar alt heile bookings-cachen for alle asset i eitt kall ved modul-
-- oppstart (same "menneskeleg skala"-føresetnad som resten av appen), denne
-- funksjonen speglar akkurat det mønsteret for anon-grenen.
CREATE OR REPLACE FUNCTION get_taken_booking_slots()
RETURNS TABLE (asset_id text, date date, time text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT b.asset_id, b.date, b.time FROM bookings b;
$$;

-- Supabase sine plattform-standard-ACL-ar gjev EXECUTE på nye funksjonar
-- direkte til anon/authenticated/service_role, uavhengig av PUBLIC (sjå
-- CLAUDE.md) -- REVOKE ALL ... FROM PUBLIC åleine strippar ikkje dette, må
-- eksplisitt REVOKE frå anon/authenticated også, så GRANT berre til anon
-- (den einaste rolla som treng dette -- authenticated/admin brukar den
-- fulle, alt-eksisterande .select("*")-vegen med heile radene).
REVOKE ALL ON FUNCTION get_taken_booking_slots() FROM PUBLIC;
REVOKE ALL ON FUNCTION get_taken_booking_slots() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION get_taken_booking_slots() TO anon;

NOTIFY pgrst, 'reload schema';
