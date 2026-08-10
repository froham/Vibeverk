-- Kundeanalyse v1 -- internt salgs- og kvalitetssikringsverktøy i Console.
-- Data ligg i vibeverk-control, aldri i ein kunde sitt data-plane-prosjekt.
--
-- Tryggleiksmodell:
--   * Aktive operatørar kan lese gjennom RLS.
--   * Nettlesaren har ingen direkte skrivetilgang.
--   * Alle skrivingar går gjennom den autentiserte Vercel-funksjonen med
--     service_role og vert registrerte i customer_analysis_events.
--   * claim_customer_analysis_run() serialiserer oppstart og handhevar
--     samtidig-køyring globalt og per måldomene i éin transaksjon.

create table if not exists customer_analyses (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  company_name text not null check (char_length(company_name) between 1 and 200),
  website_url text not null check (char_length(website_url) between 8 and 2048),
  target_host text not null check (char_length(target_host) between 1 and 253),
  industry text not null default '' check (char_length(industry) <= 160),
  internal_notes text not null default '' check (char_length(internal_notes) <= 4000),
  max_pages integer not null default 5 check (max_pages between 1 and 5),
  status text not null default 'draft' check (status in (
    'draft', 'pending', 'analyzing', 'review_ready', 'reviewed', 'failed', 'archived'
  )),
  overall_score integer check (overall_score between 0 and 100),
  overall_summary text not null default '' check (char_length(overall_summary) <= 2000),
  last_run_at timestamptz,
  created_by uuid not null references operators(id),
  updated_by uuid not null references operators(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customer_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references customer_analyses(id) on delete cascade,
  target_host text not null,
  status text not null default 'analyzing' check (status in ('analyzing', 'completed', 'failed')),
  requested_pages integer not null check (requested_pages between 1 and 5),
  fetched_pages integer not null default 0 check (fetched_pages between 0 and 5),
  ai_status text not null default 'skipped' check (ai_status in ('skipped', 'not_configured', 'completed', 'failed')),
  lease_expires_at timestamptz not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  metrics jsonb not null default '{}'::jsonb,
  created_by uuid not null references operators(id)
);

create index if not exists customer_analysis_runs_analysis_started_idx
  on customer_analysis_runs (analysis_id, started_at desc);
create index if not exists customer_analysis_runs_active_host_idx
  on customer_analysis_runs (target_host, lease_expires_at)
  where status = 'analyzing';

create table if not exists customer_analysis_pages (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references customer_analyses(id) on delete cascade,
  run_id uuid not null references customer_analysis_runs(id) on delete cascade,
  requested_url text not null check (char_length(requested_url) <= 2048),
  final_url text check (final_url is null or char_length(final_url) <= 2048),
  fetch_status text not null check (fetch_status in ('fetched', 'skipped', 'failed')),
  robots_allowed boolean,
  http_status integer,
  content_type text check (content_type is null or char_length(content_type) <= 200),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  size_bytes integer check (size_bytes is null or size_bytes >= 0),
  title text not null default '' check (char_length(title) <= 300),
  text_excerpt text not null default '' check (char_length(text_excerpt) <= 1800),
  redirect_chain jsonb not null default '[]'::jsonb,
  technical_result jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 700),
  created_at timestamptz not null default now(),
  unique (run_id, requested_url)
);

create table if not exists customer_analysis_findings (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references customer_analyses(id) on delete cascade,
  run_id uuid references customer_analysis_runs(id) on delete set null,
  category text not null check (category in ('technical', 'seo', 'accessibility', 'privacy', 'content', 'strength')),
  title text not null check (char_length(title) between 1 and 240),
  observation text not null check (char_length(observation) between 1 and 2000),
  source_url text check (source_url is null or char_length(source_url) <= 2048),
  affected_element text not null default '' check (char_length(affected_element) <= 500),
  significance text not null default '' check (char_length(significance) <= 1600),
  recommendation text not null default '' check (char_length(recommendation) <= 1600),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  finding_type text not null check (finding_type in ('automatic', 'ai', 'manual')),
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'approved', 'edited', 'removed')),
  internal_notes text not null default '' check (char_length(internal_notes) <= 3000),
  evidence jsonb not null default '{}'::jsonb,
  created_by uuid not null references operators(id),
  updated_by uuid not null references operators(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_analysis_findings_analysis_idx
  on customer_analysis_findings (analysis_id, category, review_status);

create table if not exists customer_analysis_service_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 1200),
  delivery_status text not null check (delivery_status in ('available', 'adaptation')),
  module_key text not null default '' check (char_length(module_key) <= 100),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references operators(id),
  updated_by uuid references operators(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customer_analysis_finding_services (
  finding_id uuid not null references customer_analysis_findings(id) on delete cascade,
  service_id uuid not null references customer_analysis_service_catalog(id),
  rationale text not null default '' check (char_length(rationale) <= 1200),
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  primary key (finding_id, service_id)
);

create table if not exists customer_analysis_meeting_briefs (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references customer_analyses(id) on delete cascade,
  run_id uuid references customer_analysis_runs(id) on delete set null,
  content jsonb not null,
  approved_finding_ids uuid[] not null default '{}',
  created_by uuid not null references operators(id),
  created_at timestamptz not null default now()
);

create index if not exists customer_analysis_briefs_analysis_idx
  on customer_analysis_meeting_briefs (analysis_id, created_at desc);

create table if not exists customer_analysis_events (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid references customer_analyses(id) on delete set null,
  run_id uuid references customer_analysis_runs(id) on delete set null,
  operator_id uuid references operators(id),
  action text not null check (char_length(action) between 1 and 100),
  result text not null check (result in ('success', 'error', 'denied')),
  detail text check (detail is null or char_length(detail) <= 700),
  created_at timestamptz not null default now()
);

create index if not exists customer_analysis_events_analysis_idx
  on customer_analysis_events (analysis_id, created_at desc);

-- Same active-operator read gate as the rest of Console's control-plane data.
alter table customer_analyses enable row level security;
alter table customer_analysis_runs enable row level security;
alter table customer_analysis_pages enable row level security;
alter table customer_analysis_findings enable row level security;
alter table customer_analysis_service_catalog enable row level security;
alter table customer_analysis_finding_services enable row level security;
alter table customer_analysis_meeting_briefs enable row level security;
alter table customer_analysis_events enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'customer_analyses', 'customer_analysis_runs', 'customer_analysis_pages',
    'customer_analysis_findings', 'customer_analysis_service_catalog',
    'customer_analysis_finding_services', 'customer_analysis_meeting_briefs',
    'customer_analysis_events'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_operator_read', t);
    execute format(
      'create policy %I on %I for select to authenticated using (is_control_plane_operator())',
      t || '_operator_read', t
    );
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end $$;

-- Historikk og møtegrunnlag er append-only frå API-et. service_role kan
-- lese/skrive nye rader, men ikkje omskrive eller slette spor i etterkant.
revoke update, delete on customer_analysis_events from service_role;
revoke update, delete on customer_analysis_meeting_briefs from service_role;

-- Atomisk lease: advisory-locken gjer count+insert serialisert på tvers av
-- Vercel-instansar. Utløpte køyringar tel ikkje og kan trygt prøvast på nytt.
create or replace function claim_customer_analysis_run(
  p_analysis_id uuid,
  p_operator_id uuid,
  p_target_host text,
  p_requested_pages integer,
  p_global_limit integer default 3
) returns uuid
security definer set search_path = public
language plpgsql as $$
declare
  v_run_id uuid;
  v_active_count integer;
begin
  perform pg_advisory_xact_lock(729015);

  if not exists (select 1 from operators where id = p_operator_id and status = 'active') then
    raise exception 'operator unavailable';
  end if;

  if p_requested_pages < 1 or p_requested_pages > 5 then
    raise exception 'invalid page limit';
  end if;

  if exists (
    select 1 from customer_analysis_runs
    where target_host = p_target_host
      and status = 'analyzing'
      and lease_expires_at > now()
  ) then
    raise exception 'target already analyzing';
  end if;

  select count(*) into v_active_count
  from customer_analysis_runs
  where status = 'analyzing' and lease_expires_at > now();

  if v_active_count >= greatest(1, least(p_global_limit, 5)) then
    raise exception 'global analysis limit reached';
  end if;

  update customer_analysis_runs
  set status = 'failed', finished_at = now(), error_code = 'lease_expired',
      error_message = 'Kjøringen mistet leasen og kan prøves på nytt.'
  where analysis_id = p_analysis_id and status = 'analyzing' and lease_expires_at <= now();

  insert into customer_analysis_runs (
    analysis_id, target_host, requested_pages, lease_expires_at, created_by
  ) values (
    p_analysis_id, p_target_host, p_requested_pages, now() + interval '4 minutes', p_operator_id
  ) returning id into v_run_id;

  update customer_analyses
  set status = 'analyzing', updated_by = p_operator_id, updated_at = now()
  where id = p_analysis_id and status <> 'archived';

  if not found then
    raise exception 'analysis unavailable';
  end if;

  insert into customer_analysis_events (analysis_id, run_id, operator_id, action, result)
  values (p_analysis_id, v_run_id, p_operator_id, 'run_started', 'success');

  return v_run_id;
end;
$$;
revoke all on function claim_customer_analysis_run(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function claim_customer_analysis_run(uuid, uuid, text, integer, integer) to service_role;

-- Katalogen er basert på funksjonar som faktisk finst i produktet. Tenester
-- utan ein ferdig modul er tydeleg merkte adaptation, aldri presenterte som
-- ferdige produktfunksjonar.
insert into customer_analysis_service_catalog (code, title, description, delivery_status, module_key, sort_order) values
  ('modern-website', 'Ny eller modernisert nettside', 'Vibeverk-nettside med redigerbart innhold og modulbasert oppsett.', 'available', 'web', 10),
  ('responsive-design', 'Responsivt design', 'Tilpasning av nettsiden for mobil, nettbrett og større skjermer.', 'available', 'web', 20),
  ('content-structure', 'Innholdsstruktur og publisering', 'Strukturering og publisering av tydelig, vedlikeholdbart nettsideinnhold.', 'available', 'web', 30),
  ('contact-form', 'Kontaktskjema og henvendelser', 'Kontaktskjema med oppfølging av henvendelser i Vibeverk.', 'available', 'contactForm', 40),
  ('privacy-module', 'Personvernmodul', 'Versjonert personverninnhold med manuell godkjenning før publisering.', 'available', 'privacy', 50),
  ('faq', 'FAQ', 'Spørsmål-og-svar-seksjon på nettsiden.', 'available', 'faq', 60),
  ('news', 'Nyheter og aktuelt', 'Publisering og arkiv for aktuelt-innhold.', 'available', 'newsArchive', 70),
  ('workspace', 'Workspace', 'Intern arbeidsflate for ansatte og intern informasjon.', 'available', 'workspace', 80),
  ('knowledge-base', 'Kunnskapsbase og dokumentoversikt', 'Intern kunnskapsbase og dokumentasjon i Workspace.', 'available', 'kb', 90),
  ('org-operations', 'Organisasjons- og driftsoversikt', 'Oversikt over personer, ansvar, leverandører, systemer og drift.', 'available', 'orgdrift', 100),
  ('crm', 'Enkel CRM og henvendelsesoversikt', 'Kunde- og henvendelsesoppfølging i Web-admin eller Workspace.', 'available', 'crm', 110),
  ('cookie-light-analytics', 'Analyse uten unødvendige cookies', 'Vibeverks egen sideinnsikt eller konfigurert ekstern analyse.', 'available', 'sidetelling', 120),
  ('seo-health-check', 'SEO-helsesjekk', 'Manuell oppfølging og forbedring av tekniske og innholdsmessige SEO-funn.', 'adaptation', '', 130),
  ('accessibility-review', 'Universell utforming og kvalitetskontroll', 'Manuell og teknisk kvalitetskontroll; omfang avtales særskilt.', 'adaptation', '', 140)
on conflict (code) do nothing;

notify pgrst, 'reload schema';
