-- Del av Fase 1 av automatisert lead-retensjon (kontrollplan-sida, sjå
-- supabase-control/supabase/migrations/20260812233000_add_retention_sweep_schema.sql
-- for grunngjeving). service_role har BYPASSRLS men ingen automatiske
-- tabellrettar (stadfesta fallgruve, CLAUDE.md/ADR-0009) -- den nye
-- retention-sweep Edge Function-en (i vibeverk-control) treng eksplisitt
-- SELECT+DELETE på leads i KVART kundeprosjekt for å kunne telje kandidatar
-- (dry-run, Fase 1) og seinare faktisk slette dei (Fase 3, eiga
-- kodeendring + Security Auditor-pass, ikkje aktivert av denne migrasjonen).
--
-- Ingen ny sletting er mogleg av denne migrasjonen åleine -- det er berre
-- ein rettar-grant. Verifiser etter deploy med
-- information_schema.role_table_grants, ikkje berre grønt migrasjonsutfall.

grant select, delete on leads to service_role;
