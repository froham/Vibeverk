-- hotfix_bookings_data_migration_2026-07-03.sql
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- Migrerer den eksisterande booking-bookings-blobben (i store-tabellen) til
-- den nye bookings-tabellen (sjå migration.sql). Denne SQL-en må køyrast
-- ETTER at migration.sql (som opprettar bookings-tabellen/RLS) er køyrt.
--
-- Dette er det TREDJE og siste steget i å flytte private datasett ut av
-- store (sjå hotfix_crm_data_migration_2026-07-03.sql og
-- hotfix_leads_data_migration_2026-07-03.sql for dei to første) — fullfører
-- CRITICAL-funnet om ubetinga anon-SELECT på heile store-tabellen.
-- booking-assets (ressursane sjølve — bilar/møterom/timar) er IKKJE del av
-- denne migreringa, vert verande i store (lav sensitivitet, admin-config,
-- ikkje kundedata).
--
-- Ingen ID-mapping naudsynt: bookings.id er `text`, same format som den
-- gamle klient-genererte IDen ("bk-"+Date.now()+...).
--
-- VIKTIG: dette SLETTAR IKKJE dei gamle store-radene. Sjå verifiserings-
-- spørringane og det kommenterte opprydningssteget nedst i denne fila.

INSERT INTO bookings (id, asset_id, date, time, name, email, phone, message, instant, status, reference_number, created_at)
SELECT
  b->>'id',
  b->>'assetId',
  (b->>'date')::date,
  b->>'time',
  COALESCE(b->>'name', ''),
  COALESCE(b->>'email', ''),
  COALESCE(b->>'phone', ''),
  b->>'message',
  COALESCE((b->>'instant')::boolean, false),
  COALESCE(b->>'status', 'ny'),
  b->>'referenceNumber',
  COALESCE((NULLIF(b->>'createdAt', ''))::timestamptz, now())
FROM store, jsonb_array_elements(value) AS b
WHERE key = 'booking-bookings' AND b->>'id' IS NOT NULL AND b->>'assetId' IS NOT NULL AND b->>'date' IS NOT NULL AND b->>'time' IS NOT NULL
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFISERING — køyr desse og samanlikn radetal FØR du stolar på den nye
-- tabellen eller køyrer opprydningssteget nedanfor. Rader som manglar
-- assetId/date/time (skulle ikkje finnast i praksis, men WHERE-klausulen
-- over hoppar dei stille over) forklarer eventuelt avvik.
-- =============================================================================
-- SELECT (SELECT count(*) FROM store, jsonb_array_elements(value) WHERE key = 'booking-bookings') AS gamle_bookingar;
-- SELECT count(*) AS nye_bookingar FROM bookings;

-- =============================================================================
-- OPPRYDNING — KØYR IKKJE FØR VERIFISERINGA OVER ER STADFESTA OG DETTE STEGET
-- ER EKSPLISITT GODKJENT ÅLEINE (separat frå resten av denne fila):
-- DELETE FROM store WHERE key = 'booking-bookings';
-- =============================================================================
