-- Fase 1 (grunnmur) av automatisert sletting/retensjon, Arkitekt-planlagt
-- 2026-08-12 (sjå docs/compliance/personvern-rammeverk-status-2026-08-12.md
-- del 2 for slettefristforslaga denne bygger på). Formål: bevise at ein ekte,
-- tidsstyrt slettemekanisme kan byggast for minst éin datakategori
-- (kontaktskjema-leads), ikkje berre lovast som tekst.
--
-- DENNE MIGRASJONEN GJER INGEN SLETTING MOGLEG. Han legg berre til:
--   1) retention_policy på tenants -- kva kategoriar/frister som GJELD,
--      default eksplisitt AV (opt-in, ikkje opt-out) for kvar einaste kunde.
--   2) retention_runs -- ein strukturert logg over kvar sweep-køyring
--      (Edge Function `retention-sweep`, Fase 1: dry-run-only, skriv
--      aldri dry_run=false).
--
-- Fase 3 (faktisk sletting for éin bevis-kunde) krev ein eigen, seinare
-- kodeendring i sjølve Edge Function-en pluss ein Security Auditor-pass
-- FØR han rullast ut for nokon --  ikkje berre eit policy-flip her.

alter table tenants
  add column retention_policy jsonb not null default '{"leads": {"enabled": false, "months": 12}}'::jsonb;

comment on column tenants.retention_policy is
  'Strukturert, maskinlesbar retensjonspolicy per kategori -- IKKJE same felt som den fritekst-"retention"-strengen i sc.privacy.forms{} (den er berre visningstekst for personvernerklæringa, ikkje handhevingsgrunnlag). Default enabled=false for kvar kategori -- eksplisitt opt-in per kunde, aldri global big-bang.';

-- =============================================================================
-- retention_runs -- éin rad per sweep-forsøk per kunde per kategori.
-- Skriv utelukkande av retention-sweep Edge Function sin service_role-
-- tilkopling (som omgår RLS), same tilgangsmønster som broker_audit_log
-- (Phase 8). Talbaserte kolonnar (ikkje ein fritekst-detalj-streng) sidan
-- Console-visninga (Fase 2) treng å lese tal direkte, ikkje parse ein
-- logglinje.
-- =============================================================================
create table retention_runs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid references tenants(id),
  category           text not null default 'leads',
  run_at             timestamptz not null default now(),
  dry_run            boolean not null default true,
  candidates_found   integer not null default 0,
  rows_deleted       integer not null default 0,
  attachments_freed  integer not null default 0,
  error              text
);

alter table retention_runs enable row level security;

revoke all on retention_runs from public, anon;
grant select on retention_runs to authenticated;

create policy retention_runs_operator_read on retention_runs
  for select to authenticated
  using (is_control_plane_operator());

-- Deliberately ingen INSERT/UPDATE/DELETE-policy for authenticated -- berre
-- retention-sweep sin eigen service_role-tilkopling skriv, akkurat som
-- broker_audit_log. Eksplisitt service_role-grant (ikkje anta platform-
-- default, CLAUDE.md/ADR-0009 sin stadfesta fallgruve).
grant select, insert on retention_runs to service_role;
