-- hotfix_crm_data_migration_2026-07-03.sql
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- Migrerer eksisterande crm-bedrifter/crm-customers/crm-comms JSON-blobbar
-- (i store-tabellen) til dei nye normaliserte tabellane crm_bedrifter/
-- crm_customers/crm_comms (sjå migration.sql). Denne SQL-en må køyrast ETTER
-- at migration.sql (som opprettar dei nye tabellane/RLS/RPC) er køyrt.
--
-- Ingen ID-mapping naudsynt: crm_bedrifter/crm_customers/crm_comms bruker
-- `text PRIMARY KEY`, ikkje `uuid` (sjå migration.sql sitt notat om kvifor —
-- store synkron kode i module-crm.js, t.d. findOrCreateBedrift(), forventar
-- ID-en synkront med ein gong). Difor er IDen i dei nye tabellane identisk
-- med den gamle klient-genererte IDen frå JSON-blobben.
--
-- VIKTIG: dette SLETTAR IKKJE dei gamle store-radene. Dei vert verande urørt
-- til nokon uttrykkeleg har stadfesta at dei nye tabellane har riktig data
-- (radetal stemmer, stikkprøver ser rette ut) — sjå verifiseringsspørringane
-- og det kommenterte opprydningssteget nedst i denne fila. Idempotent
-- (ON CONFLICT DO NOTHING) — trygt å køyre fleire gonger.
--
-- Rekkefølgje: bedrifter FØR kundar (FK crm_customers.bedrift_id), kundar
-- FØR comms (FK crm_comms.customer_id).

-- 1) crm_bedrifter
INSERT INTO crm_bedrifter (id, name, customer_number, org_nr, website, phone, address, invoice_email, invoice_address, note, created_at)
SELECT
  b->>'id',
  COALESCE(b->>'name', ''),
  b->>'customerNumber',
  COALESCE(b->>'orgNr', ''),
  COALESCE(b->>'website', ''),
  COALESCE(b->>'phone', ''),
  COALESCE(b->>'address', ''),
  COALESCE(b->>'invoiceEmail', ''),
  COALESCE(b->>'invoiceAddress', ''),
  COALESCE(b->>'note', ''),
  COALESCE((NULLIF(b->>'created', ''))::timestamptz, now())
FROM store, jsonb_array_elements(value) AS b
WHERE key = 'crm-bedrifter' AND b->>'id' IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- 2) crm_customers
INSERT INTO crm_customers (id, email, alt_emails, name, phone, address, note, customer_number, bedrift_id, created_at)
SELECT
  c->>'id',
  COALESCE(c->>'email', ''),
  COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(COALESCE(c->'altEmails', '[]'::jsonb)) x), '{}'),
  COALESCE(c->>'name', ''),
  COALESCE(c->>'phone', ''),
  COALESCE(c->>'address', ''),
  COALESCE(c->>'note', ''),
  c->>'customerNumber',
  c->>'bedriftId',
  COALESCE((NULLIF(c->>'created', ''))::timestamptz, now())
FROM store, jsonb_array_elements(value) AS c
WHERE key = 'crm-customers' AND c->>'id' IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- 3) crm_comms — kjende kolonnar (id/customerId/type/title/created) vert
-- ekte kolonnar, resten (subject/body/to/threadId/callDate/callTime/
-- duration/contact/followup/text/html/tag/docType/dueDate/done, alt etter
-- "type") hamnar samla i `data` jsonb — same "known"-liste som
-- jsCommToDb()/dbCommToJs() i module-crm.js bruker, slik at klient og
-- migrering er samstemte. Berre comms som peikar på ein kunde som faktisk
-- vart migrert vert tatt med, for å unngå FK-feil frå eventuelt orfanerte
-- comms (t.d. frå den kjende mangelen i den gamle mergeCustomers()-logikken,
-- omtala i migration.sql, der samanslegne kundar sine comms vart verande
-- orfanerte i staden for flytta).
INSERT INTO crm_comms (id, customer_id, type, title, data, created_at)
SELECT
  cm->>'id',
  cm->>'customerId',
  COALESCE(cm->>'type', 'internal_note'),
  cm->>'title',
  (cm - 'id' - 'customerId' - 'type' - 'title' - 'created'),
  COALESCE((NULLIF(cm->>'created', ''))::timestamptz, now())
FROM store, jsonb_array_elements(value) AS cm
WHERE key = 'crm-comms' AND cm->>'id' IS NOT NULL AND cm->>'customerId' IS NOT NULL
  AND EXISTS (SELECT 1 FROM crm_customers WHERE id = cm->>'customerId')
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFISERING — køyr desse og samanlikn radetal FØR du stolar på dei nye
-- tabellane eller køyrer opprydningssteget nedanfor.
-- =============================================================================
-- SELECT (SELECT count(*) FROM jsonb_array_elements(value)) AS gamle_bedrifter FROM store WHERE key = 'crm-bedrifter';
-- SELECT count(*) AS nye_bedrifter FROM crm_bedrifter;
-- SELECT (SELECT count(*) FROM jsonb_array_elements(value)) AS gamle_kundar FROM store WHERE key = 'crm-customers';
-- SELECT count(*) AS nye_kundar FROM crm_customers;
-- SELECT (SELECT count(*) FROM jsonb_array_elements(value)) AS gamle_comms FROM store WHERE key = 'crm-comms';
-- SELECT count(*) AS nye_comms FROM crm_comms;
-- (nye_comms kan vere lågare enn gamle_comms viss det fanst orfanerte comms
-- i den gamle blobben, jf. notatet over — sjekk differansen stemmer med det.)

-- =============================================================================
-- OPPRYDNING — KØYR IKKJE FØR VERIFISERINGA OVER ER STADFESTA OG DETTE STEGET
-- ER EKSPLISITT GODKJENT ÅLEINE (separat frå resten av denne fila):
-- DELETE FROM store WHERE key IN ('crm-bedrifter', 'crm-customers', 'crm-comms');
-- =============================================================================
