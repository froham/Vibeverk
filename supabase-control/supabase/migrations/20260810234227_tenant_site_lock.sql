-- Per-tenant sidesperre (forenkla design, 2026-08-10, jf. Arkitekt-runde +
-- brukarvedtak same dag om å forenkle vekk frå fullversjonen sitt eige
-- forsøksteljar-/eingongsvis-passord-design):
--
-- I dag finst berre EIN global SITE_LOCK_PASSWORD (middleware.js), delt på
-- tvers av ALLE domene. Denne migrasjonen legg til eit valfritt, PER TENANT
-- passord ein admin sjølv vel (ikkje serverautogenerert) -- når det er slått
-- på for ein tenant, erstattar det (ikkje i tillegg til) det globale passordet
-- for akkurat den tenanten sine domene, slik at ein kunde kan få nøyaktig sitt
-- eige passord utan samstundes å få nøkkelen til andre sine låste sider.
--
-- Medvite forenkla vekk frå full-runda sitt forslag: ingen eiga
-- forsøksteljar-/lockout-tabell (trugselbiletet her er "hindre tilfeldige
-- besøkjande", ikkje brute-force-motstand -- same nivå som det eksisterande
-- globale passordet alt aksepterer). Passordet er like fullt aldri lagra i
-- klartekst (pgcrypto bcrypt) -- gratis å behalde, kostar ingenting ekstra.
--
-- Hash-en ligg direkte på tenants, IKKJE i den offentleg anon-kallbare
-- resolve_tenant_by_hostname() sitt returskjema (verifisert direkte mot
-- databasen FØR denne migrasjonen vart skriven at den funksjonen alt er
-- anon-kjørbar) -- berre site_lock_enabled (eit ufarleg boolsk flagg) vert
-- lagt til der. Sjølve passordsjekken skjer i ein eigen funksjon som aldri
-- returnerer hash-en, berre eit boolsk resultat.

alter table tenants
  add column if not exists site_lock_enabled boolean not null default false,
  add column if not exists site_lock_password_hash text,
  add column if not exists site_lock_updated_at timestamptz;

-- Security Auditor-funn (2026-08-10, uavhengig gjennomgang FØR merge): baseline-
-- migrasjonen sitt "grant all on operators, tenants to authenticated" (sjå
-- 20260707235525_control_plane_baseline.sql) er tabellnivå, ikkje avgrensa til
-- spesifikke kolonnar -- og RLS-policyen tenants_operator_read (sjå
-- 20260708204201_restrict_tenants_operator_to_read_only.sql) filtrerer berre
-- RADER (via is_control_plane_operator()), ikkje KOLONNAR, og er dessutan
-- rolle-blind (gjeld like mykje "operator" som "superadmin"). Utan dette hadde
-- ein KVAR aktiv operatør -- ikkje berre superadmin, sjølv om
-- set_tenant_site_lock() sjølv ER superadmin-gata i tenant-admin -- kunna lese
-- site_lock_password_hash rått via eit direkte PostgREST-kall (forbi Console
-- sin eigen JS heilt), utan at det nokon gong går gjennom broker_audit_log.
--
-- FYRSTE forsøk var eit reint kolonnenivå-REVOKE (revoke select
-- (site_lock_password_hash) on tenants from authenticated) -- stadfesta
-- DIREKTE mot databasen (has_column_privilege()) at det IKKJE fungerte:
-- eit eksisterande tabellnivå-GRANT (pg_class.relacl) gjeld framleis for ALLE
-- kolonnar sjølv om ein seinare legg til eit meir spesifikt kolonnenivå-
-- REVOKE (pg_attribute.attacl) -- dei to slags ACL-ane er additive, ikkje
-- overstyrande, motsett av det ein kanskje skulle tru. Einaste verkelege
-- fiksen er å fjerne SELECT på TABELLNIVÅ og gje det attende eksplisitt for
-- alle kolonnar UNNTATT denne. INSERT/UPDATE på tabellnivå er urørt her --
-- dei er alt reelt inaktive for "authenticated" sidan
-- 20260708204201_restrict_tenants_operator_to_read_only.sql fjerna all
-- INSERT/UPDATE/DELETE-policy for den rolla (RLS utan policy for ein
-- kommando gjev null tilgang, sjølv om eit tabellnivå-GRANT framleis
-- teknisk finst) -- same mønster, ikkje noko nytt hòl.
revoke select on tenants from authenticated;
grant select (
  id, slug, hostnames, data_plane_url, data_plane_anon_key,
  data_plane_service_role_secret_id, theme, product_mode, enabled_modules,
  custom_modules_manifest, status, provisioning_status, created_by,
  created_at, updated_at, data_plane_storage_key, routing_verified_at,
  schema_verified_at, first_admin_invited_at, smtp_configured_at,
  site_lock_enabled, site_lock_updated_at
) on tenants to authenticated;

create extension if not exists pgcrypto;

-- Utvidar returskjemaet med site_lock_enabled (ufarleg å eksponere -- seier
-- berre "denne tenanten er sperra", ikkje kva passordet er). WHERE-klausulen
-- er kopiert ORDRETT frå den faktiske, LIVE funksjonsdefinisjonen (henta via
-- pg_get_functiondef() rett før denne migrasjonen vart skriven, ikkje
-- rekonstruert frå baseline-fila -- ho er endra to gonger sidan baseline,
-- sist i 20260709224325_close_provisioning_tenant_exposure_window.sql).
-- Postgres tillèt ikkje CREATE OR REPLACE når returtypen (OUT-parametra til
-- RETURNS TABLE) endrar seg -- må DROP fyrst (stadfesta empirisk, fyrste
-- forsøk feila med SQLSTATE 42P13; heile migrasjonen rulla trygt attende
-- åtomisk, stadfesta direkte mot databasen før denne retten).
drop function if exists resolve_tenant_by_hostname(text);
create or replace function resolve_tenant_by_hostname(p_hostname text)
returns table(
  data_plane_url text, data_plane_anon_key text, data_plane_storage_key text,
  theme jsonb, product_mode text, enabled_modules jsonb, custom_modules_manifest jsonb,
  site_lock_enabled boolean
)
language sql stable security definer set search_path = public
as $$
  select data_plane_url, data_plane_anon_key, data_plane_storage_key, theme, product_mode, enabled_modules, custom_modules_manifest, site_lock_enabled
  from tenants
  where lower(p_hostname) = any(hostnames)
    and (status = 'active' or (status = 'provisioning' and schema_verified_at is not null));
$$;
revoke all on function resolve_tenant_by_hostname(text) from public, authenticated;
grant execute on function resolve_tenant_by_hostname(text) to anon;

-- Sjølve passordsjekken. Reint lese-og-samanlikn (ingen forsøksteljar å
-- mutere i det forenkla designet) -- difor stable, same som funksjonen over.
-- Same WHERE-klausul som resolve_tenant_by_hostname() -- ein tenant som ikkje
-- er offentleg synleg i det heile skal heller ikkje kunne passord-verifiserast.
-- search_path treng "extensions" i tillegg til "public" -- pgcrypto sine
-- funksjonar (crypt/gen_salt) bur der på dette prosjektet, ikkje i public
-- (stadfesta direkte: SELECT n.nspname FROM pg_proc p JOIN pg_namespace n...
-- ga "extensions", ikkje ei anteking). Fyrste forsøk utan dette feila med
-- "function crypt(text, text) does not exist" (SQLSTATE 42883).
create or replace function verify_tenant_site_lock_password(p_hostname text, p_password text)
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(
    (
      select site_lock_password_hash = crypt(p_password, site_lock_password_hash)
      from tenants
      where lower(p_hostname) = any(hostnames)
        and (status = 'active' or (status = 'provisioning' and schema_verified_at is not null))
        and site_lock_enabled = true
        and site_lock_password_hash is not null
    ),
    false
  );
$$;
revoke all on function verify_tenant_site_lock_password(text, text) from public, authenticated;
grant execute on function verify_tenant_site_lock_password(text, text) to anon;

-- Sjølve set/oppdater/slå-av-handlinga. Hashinga skjer HER (server-sida SQL),
-- ikkje i Edge-funksjonen -- unngår å måtte leggje til eit separat bcrypt-
-- bibliotek i Deno, og held all pgcrypto-bruk samla på éin stad. Berre
-- service_role kan kalle han (tenant-admin sin service-role-klient) --
-- aldri authenticated/anon direkte, same mønster som claim_customer_analysis_run.
create or replace function set_tenant_site_lock(p_tenant_id uuid, p_enabled boolean, p_password text default null)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_has_hash boolean;
begin
  if p_password is not null and length(p_password) < 4 then
    raise exception 'password too short';
  end if;

  select site_lock_password_hash is not null into v_has_hash
  from tenants where id = p_tenant_id;

  if v_has_hash is null then
    raise exception 'tenant not found';
  end if;

  if p_enabled and p_password is null and not v_has_hash then
    raise exception 'no password set';
  end if;

  update tenants
  set site_lock_enabled = p_enabled,
      site_lock_password_hash = case when p_password is not null then crypt(p_password, gen_salt('bf')) else site_lock_password_hash end,
      site_lock_updated_at = case when p_password is not null or site_lock_enabled is distinct from p_enabled then now() else site_lock_updated_at end,
      updated_at = now()
  where id = p_tenant_id;
end;
$$;
revoke all on function set_tenant_site_lock(uuid, boolean, text) from public, anon, authenticated;
grant execute on function set_tenant_site_lock(uuid, boolean, text) to service_role;

notify pgrst, 'reload schema';
