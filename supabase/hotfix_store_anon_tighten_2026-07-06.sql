-- =============================================================================
-- hotfix_store_anon_tighten_2026-07-06.sql
-- -----------------------------------------------------------------------------
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- Funn (2026-07-06 audit, sjå docs/project/CURRENT_STATE.md "Still open"):
-- store_anon_read (`USING (true)`) gir anon-nøkkelen lesetilgang til KVAR
-- rad i store, utan filter på nøkkel. Dei tre private datasetta frå Fase 1-
-- revisjonen (crm-customers/crm-bedrifter/crm-comms, leads, booking-bookings)
-- vart alle flytta ut av store til eigne tabellar med RLS som nektar anon
-- heilt (sjå 0.10.0/0.11.0/0.12.0 i CHANGELOG.md) — NYE skrivingar går
-- difor ikkje lenger via store og er ikkje anon-lesbare. MEN dei GAMLE
-- store-radene for desse fem nøklane vart bevisst IKKJE sletta (kvar
-- migreringsfil sitt opprydningssteg er framleis kommentert ut, ventar på
-- eksplisitt godkjenning) — så namn/e-post/meldingar/CRM-notat/bookingar frå
-- FØR migreringa er framleis lesbare med anon-nøkkelen i dag, sjølv om dei
-- er stale/ikkje-lenger-skrivne-til.
--
-- Løysing, i to steg:
--   1) Nekt anon SELECT på nøyaktig desse fem nøklane (denylist, IKKJE ei
--      full allowlist-omskriving — store har 15+ andre nøklar som skal
--      halde fram med å vere offentleg lesbare for det faktiske offentlege
--      sideinnhaldet: "content", faq-items, ref-items, mediabank-images,
--      nav-settings, superconfig (tema/farge/font), analytics, osv. — ei
--      allowlist-omskriving ville kravd å telje opp ALLE desse nøyaktig og
--      har mykje høgare risiko for å bryte offentleg sidevising ved eit
--      glipp. Denylist av dei fem KJENTE, allereie-migrerte, private
--      nøklane er den langt tryggare, minimalt avgrensa endringa som
--      faktisk lukkar det stadfesta funnet).
--   2) EIN GONG radetal er verifisert og du har eksplisitt godkjent det
--      separat (steget er kommentert ut nedst i denne fila, akkurat som i
--      dei tre opphavlege migreringsfilene) — slett dei gamle radene heilt,
--      då vert denylisten i steg 1 rein defense-in-depth for framtidige
--      nøklar, ikkje den einaste sperra.
--
-- Denne fila er også lagt inn i supabase/migration.sql (idempotent
-- fullskjema, for framtidige/friske kundeprosjekt — der finst desse fem
-- nøklane uansett aldri i store frå dag éin).
-- =============================================================================

-- ── 1. Nekt anon SELECT på dei fem kjende, allereie-migrerte, private nøklane ──

DROP POLICY IF EXISTS store_anon_read ON store;
CREATE POLICY store_anon_read ON store FOR SELECT TO anon
  USING (key NOT IN ('crm-customers', 'crm-bedrifter', 'crm-comms', 'leads', 'booking-bookings'));

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFISERING — køyr desse FØR du godkjenner opprydningssteget nedanfor.
-- Samanlikn "gamle_*"-radetala mot dei tilsvarande "nye_*"-tabellane (same
-- spørringar som i hotfix_crm_data_migration_2026-07-03.sql,
-- hotfix_leads_data_migration_2026-07-03.sql og
-- hotfix_bookings_data_migration_2026-07-03.sql — repetert samla her for
-- enkelheit sin skuld).
-- =============================================================================
-- SELECT (SELECT count(*) FROM jsonb_array_elements(value)) AS gamle_bedrifter FROM store WHERE key = 'crm-bedrifter';
-- SELECT count(*) AS nye_bedrifter FROM crm_bedrifter;
-- SELECT (SELECT count(*) FROM jsonb_array_elements(value)) AS gamle_kundar FROM store WHERE key = 'crm-customers';
-- SELECT count(*) AS nye_kundar FROM crm_customers;
-- SELECT (SELECT count(*) FROM jsonb_array_elements(value)) AS gamle_comms FROM store WHERE key = 'crm-comms';
-- SELECT count(*) AS nye_comms FROM crm_comms;
-- SELECT (SELECT count(*) FROM store, jsonb_array_elements(value) WHERE key = 'leads') AS gamle_leads;
-- SELECT count(*) AS nye_leads FROM leads;
-- SELECT (SELECT count(*) FROM store, jsonb_array_elements(value) WHERE key = 'booking-bookings') AS gamle_bookingar;
-- SELECT count(*) AS nye_bookingar FROM bookings;

-- =============================================================================
-- OPPRYDNING — KØYR IKKJE FØR VERIFISERINGA OVER ER STADFESTA OG DETTE STEGET
-- ER EKSPLISITT GODKJENT ÅLEINE (separat frå resten av denne fila). Etter
-- dette er kjørt kan `key NOT IN (...)`-lista i steg 1 over trekkjast attende
-- til ei generell `USING (true)` att, MEN det er tryggast å berre la
-- denylisten stå som eit permanent andre lag med forsvar:
-- DELETE FROM store WHERE key IN ('crm-bedrifter', 'crm-customers', 'crm-comms', 'leads', 'booking-bookings');
-- =============================================================================
