-- Oppdaga live under produksjonsdeploy av 20260719124203_anon_media_upload_quota.sql:
-- den migrasjonen antok (per ADR-0008 sin dokumenterte lærdom) at Supabase sin
-- plattform-standard-ACL automatisk gjev service_role EXECUTE på nye funksjonar.
-- Stadfesta 2026-07-19 at DETTE IKKJE STEMMER for denne produksjonen (avvik frå
-- vibeverk-staging, som fekk EXECUTE automatisk) — has_function_privilege('service_role', ...)
-- returnerte false rett etter migrasjonen var pusha til clzczbyklgdtdhgjphup, sjølv
-- om han returnerte true på staging. Truleg ein skilnad i kva tidspunkt/policy-versjon
-- kvart av dei to prosjekta vart oppretta under (sjå config.toml sin kommentar om at
-- "auto_expose_new_tables"-standarden endra seg og vert fjerna 2026-10-30).
--
-- Same lærdom som ADR-0009: ANTA ALDRI service_role har EXECUTE/tilgang — gje det
-- alltid eksplisitt. Denne migrasjonen er trygg å køyre på alle miljø (staging
-- inkludert), sjølv der grant alt fanst via plattform-standard.
GRANT EXECUTE ON FUNCTION bump_and_check_anon_upload_quota(text, int) TO service_role;

NOTIFY pgrst, 'reload schema';
