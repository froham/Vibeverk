-- Bolk 3/4 (2026-08-12, brukarvedtak): to nye, GLOBALE (ikkje tenant-skopa)
-- tabellar for Console sin nye "Compliance"-seksjon -- same "Vibeverk internt"
-- nav-gruppe som Priser/Kundeanalyse/Læring (sjå NAV_ITEMS i console-core.js,
-- Bolk 2 same dag). Følgjer NØYAKTIG same mønster som pricing_config
-- (20260804120000_add_pricing_config.sql) sin eigen, allereie Arkitekt- og
-- Security Auditor-gjennomgåtte disiplin: berre SELECT-RLS for authenticated
-- (Console les direkte, same lesemønster som tenants/operators/pricing_config),
-- ALL skriving går via nye tenant-admin-handlingar (set_compliance_record/
-- set_vendor) -- aldri direkte RLS-CRUD, sidan det hoppar forbi
-- broker_audit_log (same grunngjeving som pricing_config sin eigen kommentar).
--
-- Viktig scope-avklaring frå brukaren (IKKJE re-tolk utan ny eksplisitt
-- avgjerd): behandlingsprotokoll er KUN for Vibeverk AS sjølv, ALDRI ein
-- per-kunde-funksjon -- difor éin global tabell med éin rad per Vibeverk-eigen
-- behandlingsaktivitet, ikkje noko tenant_id-felt her i det heile. Same
-- grunngjeving for leverandørregisteret (VIBEVERK_VENDORS var alt ein delt,
-- ikkje-per-tenant JS-konstant -- dette flytter berre den same, framleis
-- delte, sanninga frå kode til database, ikkje til per-kunde-data).
--
-- compliance_record: éin rad per behandlingsaktivitet, dei same 8 aktivitetane
-- Arkitekten identifiserte i revisjonen 2026-08-12 (docs/compliance/
-- personvern-rammeverk-status-2026-08-12.md del 3). Felta følgjer det GDPR
-- art. 30 faktisk krev (formål/kategori registrerte/kategori data/
-- behandlingsgrunnlag/mottakere/lagringstid/sikkerheitstiltak) -- ei rein
-- intern journalføring, ALDRI publisert, ingen versjonering/godkjenning-
-- ceremoni (ulikt det kundevendte Personvern-dokumentet, som treng det for
-- eit HEILT anna formål -- sjå Arkitekten sin grunngjeving i revisjonen).
create table compliance_record (
  id text primary key,
  label text not null,
  formaal text not null default '',
  kategori_registrerte text not null default '',
  kategori_data text not null default '',
  behandlingsgrunnlag text not null default '',
  mottakere text not null default '',
  lagringstid text not null default '',
  sikkerhetstiltak text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references operators(id)
);

alter table compliance_record enable row level security;

create policy compliance_record_operator_read on compliance_record
  for select to authenticated
  using (is_control_plane_operator());

revoke all on compliance_record from anon;
revoke all on compliance_record from authenticated;
grant select on compliance_record to authenticated;
-- Eksplisitt service_role-grant per CLAUDE.md sin stadfesta ADR-0009-leksjon
-- (BYPASSRLS er ikkje det same som objekt-nivå-grantar) -- verifiser med
-- has_table_privilege('service_role','compliance_record','UPDATE') etter
-- deploy, ikkje berre ein rein migrasjons-exit-kode.
grant select, insert, update on compliance_record to service_role;

insert into compliance_record (id, label) values
  ('kontakt',     'Kontaktskjema'),
  ('tilbud',      'Tilbudsforespørsel'),
  ('booking',     'Booking'),
  ('chat',        'Chat'),
  ('crm',         'CRM'),
  ('ansatte',     'Ansatte (Workspace)'),
  ('sidetelling', 'Sidetelling (internt)'),
  ('ai',          'AI-moduler (Oversikt/Smart årshjul)');

-- vendor_registry: erstattar den hardkoda VIBEVERK_VENDORS-konstanten
-- (console-core.js) som einaste kjelde til sanning -- same fire leverandørar,
-- same felt. dpa_status inkluderer no eit ekte "tba"-alternativ (brukarvedtak
-- 2026-08-12: Vibeverk AS er ikkje stifta enno, DPA-ane skal signerast då --
-- IKKJE eit avvik å rette, berre eit kjent, venta administrativt steg).
-- dpa_document_path er MEDVITE uwired (ingen Storage-bucket finst enno) --
-- kolonna står klar, men fyllast ikkje ut før eit ekte signert dokument
-- finst (Arkitekten sin fase 5, eksplisitt utsett).
--
-- isActive(an)-logikken frå VIBEVERK_VENDORS (t.d. Plausible sin
-- an.plausible-sjekk) kan IKKJE flyttast reint inn i ein SQL-kolonne --
-- held fram som ein liten, hardkoda VENDOR_ACTIVITY_PREDICATES-map i
-- console-core.js, kopla saman med denne tabellen sine rader ved rendering.
create table vendor_registry (
  id text primary key,
  name text not null,
  what_it_does text not null default '',
  country text not null default 'eu' check (country in ('eu','us')),
  transfer_mechanism text not null default 'none' check (transfer_mechanism in ('none','scc','scc_or_dpf')),
  dpa_status text not null default 'tba' check (dpa_status in ('confirmed','likely_confirmed','unconfirmed','tba')),
  dpa_note text not null default '',
  dpa_document_path text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references operators(id)
);

alter table vendor_registry enable row level security;

create policy vendor_registry_operator_read on vendor_registry
  for select to authenticated
  using (is_control_plane_operator());

revoke all on vendor_registry from anon;
revoke all on vendor_registry from authenticated;
grant select on vendor_registry to authenticated;
grant select, insert, update on vendor_registry to service_role;

insert into vendor_registry (id, name, what_it_does, country, transfer_mechanism, dpa_status, dpa_note, sort_order) values
  ('supabase', 'Supabase', 'Database, autentisering og fillagring — all persondata plattformen lagrer', 'eu', 'none', 'tba',
    'Signerast via Supabase Dashboard når Vibeverk AS er stifta og registrert som kontoeigar.', 1),
  ('vercel', 'Vercel', 'Hosting og tenant-ruting', 'us', 'scc', 'tba',
    'DPA er automatisk inkludert på Pro/Enterprise-plan (dagens konto er på Hobby-planen) -- ordnast saman med oppgradering når Vibeverk AS er stifta.', 2),
  ('resend', 'Resend', 'Utsending og mottak av e-post', 'us', 'scc_or_dpf', 'tba',
    'Standardvilkåra er alt godteke ved kontoopprettinga, men ei formell databehandlaravtale under Vibeverk AS som eige rettssubjekt attstår til selskapet er stifta.', 3),
  ('plausible', 'Plausible Analytics', 'Cookiefri trafikkstatistikk', 'eu', 'none', 'tba',
    'Leverandøren tilbyr ei standard databehandlaravtale -- signerast under Vibeverk AS når selskapet er stifta.', 4);
