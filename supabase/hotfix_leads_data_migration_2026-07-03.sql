-- hotfix_leads_data_migration_2026-07-03.sql
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- Migrerer den eksisterande leads-blobben (i store-tabellen) til den nye
-- leads-tabellen (sjå migration.sql). Denne SQL-en må køyrast ETTER at
-- migration.sql (som opprettar leads-tabellen/RLS) er køyrt.
--
-- kind-feltet vert sett basert på den gamle tekst-sniffinga
-- (message ser ut som "Tilbudsforespørsel...") for EKSISTERANDE data, sidan
-- gamle rader ikkje har eit ekte kind-felt frå før. Nye leads (etter denne
-- migreringa) får kind sett eksplisitt av klienten (core.js sin addLead(),
-- module-quote.js sin kind:"tilbud") — sjå isTilbud()-hjelparen i core.js
-- for korleis klienten sjølv fell tilbake til same sniffing-logikk for
-- data som endå ikkje har kind sett (t.d. under overgangen før denne
-- migreringa har køyrt).
--
-- Ingen ID-mapping naudsynt: leads.id er `text`, same format som den gamle
-- klient-genererte IDen ("lead-"+Date.now()+...).
--
-- VIKTIG: dette SLETTAR IKKJE dei gamle store-radene. Sjå verifiserings-
-- spørringane og det kommenterte opprydningssteget nedst i denne fila.

INSERT INTO leads (id, kind, name, email, message, status, reference_number, source, chat_id, created_at)
SELECT
  l->>'id',
  CASE WHEN l->>'message' LIKE 'Tilbudsforesp%' THEN 'tilbud' ELSE 'kontakt' END,
  COALESCE(l->>'name', ''),
  COALESCE(l->>'email', ''),
  l->>'message',
  COALESCE(l->>'status', 'ny'),
  l->>'referenceNumber',
  l->>'source',
  l->>'chatId',
  COALESCE((NULLIF(l->>'time', ''))::timestamptz, now())
FROM store, jsonb_array_elements(value) AS l
WHERE key = 'leads' AND l->>'id' IS NOT NULL
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFISERING — køyr desse og samanlikn radetal, og stadfest kind-fordelinga
-- ser rimelig ut (talet på 'tilbud' bør matche talet på gamle rader med
-- meldingar som byrjar på "Tilbudsforespørsel"), FØR du stolar på den nye
-- tabellen eller køyrer opprydningssteget nedanfor.
-- =============================================================================
-- SELECT (SELECT count(*) FROM store, jsonb_array_elements(value) WHERE key = 'leads') AS gamle_leads;
-- SELECT count(*) AS nye_leads FROM leads;
-- SELECT kind, count(*) FROM leads GROUP BY kind;

-- =============================================================================
-- OPPRYDNING — KØYR IKKJE FØR VERIFISERINGA OVER ER STADFESTA OG DETTE STEGET
-- ER EKSPLISITT GODKJENT ÅLEINE (separat frå resten av denne fila):
-- DELETE FROM store WHERE key = 'leads';
-- =============================================================================
