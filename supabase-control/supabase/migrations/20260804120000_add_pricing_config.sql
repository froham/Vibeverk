-- Console "Priser"-fane (oppfølgar til Innsikt-runda same dag, 2026-08-03/04):
-- eit internt, GLOBALT (ikkje tenant-skopa) pris-/pakkeforslags-dokument for
-- Vibeverk sine eigne tilsette -- ikkje ekte fakturering, ikkje synleg for
-- nokon kunde. Designa saman med brukaren via ein interaktiv mockup, deretter
-- Arkitekt-konsultert to gonger for sjølve persistens-mønsteret:
--
-- 1. FØRSTE runde tilrådde direkte RLS-gata CRUD ("FOR ALL ... WITH CHECK
--    (is_control_plane_operator())"), etter mønster frå den opphavlege
--    operators_operator_all-policyen.
-- 2. Det synte seg FEIL ved direkte lesing av migrasjonshistorikken: nøyaktig
--    den policyen vart FJERNA i 20260708222400_restrict_operators_to_read_only.sql
--    (Security Auditor-funn M3) -- same feilklasse som 20260708204201 sin
--    tilsvarande innstramming av tenants. Grunngjevinga begge stader: direkte
--    autentisert skriving via RLS hoppar heilt forbi broker_audit_log, sidan
--    ingenting skriv dit for ei rein PostgREST-skriving. Standande
--    prosjektmønster sidan då: NYE kontrollplan-skrivingar går gjennom ein
--    dedikert, auditert broker-/tenant-admin-handling, aldri direkte RLS-CRUD.
--
-- Denne tabellen følgjer difor det retta mønsteret: berre SELECT-RLS for
-- authenticated (same lesemønster som tenants/operators alt bruker), ALL
-- skriving går via tenant-admin sin nye set_pricing_config-handling
-- (supabase-control/supabase/functions/tenant-admin/index.ts), som brukar
-- service_role internt (omgår RLS same veg som resten av funksjonen) og
-- auditerer kvart forsøk til broker_audit_log med tenant_id = NULL (denne
-- datamengda er ikkje bunden til nokon tenant -- tenant-admin sin eigen
-- auditStart()/auditFinish() tolererer NULL alt, stadfesta av
-- register_tenant-handlinga sin eksisterande bruk).
--
-- Singleton-tabell (éin rad, id-kolonnen tvinga til boolean TRUE) -- eit
-- vanleg Postgres-triks for "nøyaktig éitt dokument", same ånd som
-- superconfig/superconfig-private sin nøkkel-verdi-lagring i kunde-sida sin
-- eigen store-tabell, berre kontrollplan-sida og global i staden for
-- tenant-skopa.
create table pricing_config (
  id boolean primary key default true,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references operators(id),
  constraint pricing_config_singleton check (id)
);

alter table pricing_config enable row level security;

-- Lesing: kva som helst aktiv operatør (same nivå som tenants/operators sine
-- eigne read-policyar) -- IKKJE via tenant-admin (som krev superadmin
-- blankt for ALLE handlingar sine, sjå funksjonen sin eigen kommentar), sidan
-- det ville gjort lesing STRENGARE enn skrivinga treng vere. Console les
-- difor direkte mot denne RLS-SELECT-policyen, akkurat slik han alt les
-- tenants/operators.
create policy pricing_config_operator_read on pricing_config
  for select to authenticated
  using (is_control_plane_operator());

-- Ingen INSERT/UPDATE/DELETE-policy for authenticated i det heile -- all
-- skriving skjer via tenant-admin sin set_pricing_config-handling
-- (service_role, omgår RLS, superadmin-gata, auditert). Same mønster som
-- operators/tenants sine eigne read-only-policyar etter M3-/Phase 8-fiksane.
revoke all on pricing_config from anon;
revoke all on pricing_config from authenticated;
grant select on pricing_config to authenticated;

-- Eksplisitt service_role-grant, sjølv om broker_audit_log (Phase 8) klarte
-- seg utan éin -- CLAUDE.md sin eigen stadfesta leksjon (ADR-0009): BYPASSRLS
-- er IKKJE det same som objekt-nivå-grantar, og "verka på eit anna prosjekt/
-- ein annan tabell før" er ikkje å stole på utan å faktisk verifisere denne
-- spesifikke tabellen på DENNE spesifikke prosjektet. Verifiser etter deploy
-- med has_table_privilege('service_role','pricing_config','UPDATE'), ikkje
-- berre at migrasjonen gjekk gjennom utan feil.
grant select, update on pricing_config to service_role;

-- Éin rad, sett opp éin gong. Startverdiane speglar mockupen sitt
-- utgangsforslag (module priser + tre eksempelpakkar) -- alt fritt
-- redigerbart frå Console sin eigen "Priser"-fane frå fyrste dag, ikkje meint
-- som fasit.
insert into pricing_config (id, data) values (true, '{
  "prices": {
    "f": {
      "contactForm": { "monthly": 0,   "setup": 500,  "standard": true },
      "newsArchive": { "monthly": 200, "setup": 500,  "standard": true },
      "references":  { "monthly": 200, "setup": 500,  "standard": true },
      "faq":         { "monthly": 150, "setup": 300,  "standard": true },
      "mediabank":   { "monthly": 250, "setup": 500,  "standard": true },
      "booking":     { "monthly": 500, "setup": 1500, "standard": true },
      "quote":       { "monthly": 400, "setup": 1000, "standard": true },
      "siteSearch":  { "monthly": 150, "setup": 0,    "standard": true },
      "social":      { "monthly": 0,   "setup": 0,    "standard": true },
      "search":      { "monthly": 100, "setup": 0,    "standard": true },
      "attachments": { "monthly": 100, "setup": 0,    "standard": true },
      "crm":         { "monthly": 600, "setup": 2000, "standard": false },
      "chat":        { "monthly": 500, "setup": 1500, "standard": false },
      "crmFull":     { "monthly": 400, "setup": 1000, "standard": false },
      "sidebygger":  { "monthly": 1200,"setup": 3000, "standard": false },
      "sidetelling": { "monthly": 400, "setup": 500,  "standard": false }
    },
    "i": {
      "announcements": { "monthly": 100, "setup": 0,   "standard": true },
      "notes":         { "monthly": 100, "setup": 0,   "standard": true },
      "mediaInternal": { "monthly": 200, "setup": 300, "standard": true },
      "links":         { "monthly": 50,  "setup": 0,   "standard": true },
      "booking":       { "monthly": 300, "setup": 500, "standard": true },
      "quote":         { "monthly": 300, "setup": 500, "standard": true },
      "contact":       { "monthly": 200, "setup": 300, "standard": true },
      "kb":            { "monthly": 300, "setup": 500,  "standard": false },
      "orgdrift":      { "monthly": 300, "setup": 500,  "standard": false },
      "crm":           { "monthly": 400, "setup": 1000, "standard": false }
    }
  },
  "packages": [
    {
      "id": "p1", "name": "Grunnpakke", "price": 2990, "setupCost": 3000,
      "desc": "Nettside med det viktigste på plass.",
      "features": ["contactForm", "newsArchive", "references", "faq", "mediabank"],
      "iFeatures": [], "tags": { "f": {}, "i": {} }, "allStandard": false,
      "featured": false, "badgeText": "Mest valgt", "badgeColor": "#2563eb"
    },
    {
      "id": "p2", "name": "Standard", "price": 4990, "setupCost": 5000,
      "desc": "Mer funksjonalitet for å fange og følge opp henvendelser.",
      "features": ["contactForm", "newsArchive", "references", "faq", "mediabank", "booking", "quote", "crm", "chat", "siteSearch"],
      "iFeatures": [], "tags": { "f": {}, "i": {} }, "allStandard": false,
      "featured": true, "badgeText": "Mest valgt", "badgeColor": "#2563eb"
    },
    {
      "id": "p3", "name": "Komplett", "price": 8990, "setupCost": 9000,
      "desc": "Alt vi tilbyr, inkludert Workspace og avanserte tillegg.",
      "features": ["contactForm", "newsArchive", "references", "faq", "mediabank", "booking", "quote", "crm", "chat", "siteSearch", "social", "search", "attachments", "crmFull", "sidebygger", "sidetelling"],
      "iFeatures": ["announcements", "notes", "kb", "mediaInternal", "links", "orgdrift", "crm", "booking", "quote", "contact"],
      "tags": { "f": { "sidebygger": "Tillegg", "sidetelling": "Tillegg" }, "i": {} }, "allStandard": true,
      "featured": false, "badgeText": "For voksende team", "badgeColor": "#7c3aed"
    }
  ]
}'::jsonb);
