-- Eiendeler: sett som database-standard PÅ for alle NYE tenants (brukarvedtak
-- 2026-08-10 -- eit medvite unntak frå den elles gjennomgåande "aktiverast
-- per kunde"-modellen resten av intranettFeatures-flagga følgjer, sjå
-- config.js sin eigen "Standard AV"-seksjon i det einskilde repoet).
--
-- Berre ALTER COLUMN ... SET DEFAULT -- rører IKKJE eksisterande tenant-rader
-- (deira enabled_modules er alt sett, uendra av dette). Eksisterande tenants
-- (vibeverk, Sunnvask-demo, staging-tenanten) er oppdaterte i ein separat,
-- direkte UPDATE (2026-08-10, ikkje ein migrasjon -- éin gongs datakorreksjon
-- for allereie eksisterande rader, same skilje som CLAUDE.md sjølv gjer
-- mellom skjemaendringar og datakorreksjonar).
--
-- MERK: køyrd manuelt via Supabase Dashboard SQL Editor for vibeverk-control
-- (ingen pooler-tilkoplingsstreng tilgjengeleg i denne økta) -- same mønster
-- som Priser/pricing_config-migrasjonen (sjå docs/project/CURRENT_STATE.md,
-- 0.88.0). Konsekvens: supabase_migrations.schema_migrations veit ikkje at
-- denne er brukt før nokon køyrer
-- `npx supabase migration repair 20260810134012 --status applied --db-url ...`
-- neste gong ein pooler-tilkoplingsstreng er tilgjengeleg -- elles vil ein
-- framtidig `db push` prøve å køyre denne på nytt og feile på "already
-- exists"-typefeil (som her ville vore harmlaus, sidan ALTER COLUMN SET
-- DEFAULT er idempotent, men konsistens-praksisen bør følgjast likevel).

ALTER TABLE tenants
  ALTER COLUMN enabled_modules
  SET DEFAULT '{"intranettFeatures": {"eiendeler": true}}'::jsonb;
