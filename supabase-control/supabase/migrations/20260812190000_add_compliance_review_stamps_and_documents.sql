-- Bolk 7/8/9/11 (2026-08-12, brukarønske): "stempling" av reelt vurderte
-- compliance-felt (dato + kven), pluss tre nye frie tekstdokument (kundeavtale/
-- DPA, sikkerheitspolicy, rutine for registrerte sine rettar). Same globale,
-- ikkje-tenant-skopa, Vibeverk-interne mønster som compliance_record/
-- vendor_registry frå Bolk 3/4 (20260812170000) -- SELECT-RLS for
-- authenticated, ALL skriving via nye tenant-admin-handlingar.
--
-- Stemplinga er MEDVITE enkel og på RAD-nivå (ikkje per felt) -- ei eiga
-- "reviewed_at/reviewed_by"-handling, aldri implisitt sett av eit vanleg
-- Lagre-klikk, same "godkjenning er alltid ei eiga, medviten handling"-
-- disiplin som Personvern sin eigen approval-journal (Fase 4, 2026-08-06)
-- alt bruker for det publiserte dokumentet.
alter table compliance_record add column reviewed_at timestamptz;
alter table compliance_record add column reviewed_by text;

-- compliance_document: eitt fritekst-dokument per rad (kundeavtale/
-- sikkerheitspolicy/rettar-rutine er samanhengande tekst, ikkje strukturerte
-- datapunkt slik behandlingsprotokollen sine 7 felt er) -- difor éin tabell
-- med "content"-felt i staden for fleire smale kolonnar per dokumenttype.
create table compliance_document (
  id text primary key,
  title text not null,
  content text not null default '',
  reviewed_at timestamptz,
  reviewed_by text,
  updated_at timestamptz not null default now(),
  updated_by uuid references operators(id)
);

alter table compliance_document enable row level security;

create policy compliance_document_operator_read on compliance_document
  for select to authenticated
  using (is_control_plane_operator());

revoke all on compliance_document from anon;
revoke all on compliance_document from authenticated;
grant select on compliance_document to authenticated;
grant select, insert, update on compliance_document to service_role;

insert into compliance_document (id, title) values
  ('kundeavtale', 'Databehandleravtale (Vibeverk -> kunde)'),
  ('sikkerheitspolicy', 'Sikkerheits- og tilgangspolicy'),
  ('rettar_rutine', 'Rutine for registrerte sine rettar (Vibeverk sitt eige)');
