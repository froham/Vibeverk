-- Legg til site_lock_ever_enabled: eit MONOTONT flagg (kan berre gå frå
-- false til true, aldri attende) som er sant for ein tenant KUN dersom
-- sperra HAR vore slått PÅ minst éin gong for han. Dette -- ikkje
-- site_lock_updated_at -- er det rette skiljet mellom "aldri konfigurert"
-- (fell attende til den globale utviklingssperra) og "operatøren har
-- eksplisitt slått AV att etter å ha hatt sperra PÅ" (heilt open, ingen
-- sperre i det heile).
--
-- Brukarfeedback 2026-08-11 etter fyrste faktiske bruk: å slå AV sperra i
-- Console fall tilbake til den globale utviklingssperra i staden for å opne
-- sida heilt -- brukaren fann dette feil ("AV = heilt av").
--
-- Security Auditor-funn (HIGH, 2026-08-11, uavhengig gjennomgang FØR merge
-- av denne retten): eit FYRSTE forsøk brukte site_lock_updated_at som dette
-- skiljet -- MEN set_tenant_site_lock() (sjå 20260810234227_tenant_site_lock
-- .sql) set den kolonna kvar gong eit passord vert lagra, UAVHENGIG av
-- p_enabled: "site_lock_updated_at = case when p_password is not null or
-- site_lock_enabled is distinct from p_enabled then now() else ... end".
-- Det betydde at ein operatør som berre ville "leggje inn eit passord for
-- seinare" -- skriv eit passord, let "Sperre PÅ"-boksen stå urørt (framleis
-- av, standardtilstanden), trykkjer Lagre -- ved eit uhell ville OPNA
-- domenet HEILT, forbi både eit (ikkje-eksisterande) tenant-passord OG den
-- globale utviklingssperra, sjølv om dei aldri hadde tenkt å slå sperra PÅ i
-- det heile. site_lock_ever_enabled er MONOTONT og vert kun sant etter ei
-- EKTE PÅ-hending (p_enabled = true), difor upåverka av eit reint
-- passord-lagre der boksen aldri vart kryssa av.
alter table tenants
  add column if not exists site_lock_ever_enabled boolean not null default false;

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
      site_lock_ever_enabled = site_lock_ever_enabled or p_enabled,
      site_lock_password_hash = case when p_password is not null then crypt(p_password, gen_salt('bf')) else site_lock_password_hash end,
      site_lock_updated_at = case when p_password is not null or site_lock_enabled is distinct from p_enabled then now() else site_lock_updated_at end,
      updated_at = now()
  where id = p_tenant_id;
end;
$$;
revoke all on function set_tenant_site_lock(uuid, boolean, text) from public, anon, authenticated;
grant execute on function set_tenant_site_lock(uuid, boolean, text) to service_role;

-- resolve_tenant_by_hostname(): eksponerer site_lock_ever_enabled i staden
-- for site_lock_updated_at -- førstnemnde er det einaste feltet
-- middleware.js faktisk treng for lock-avgjerda (sjå kommentaren over).
-- Same ufarleg-å-eksponere-vurdering som før: eit reint monotont flagg,
-- ikkje passordet eller hash-en, og seier ikkje meir enn "denne tenanten
-- har brukt funksjonen minst éin gong" -- ingen driftsmessig eller
-- tryggleiksmessig verdi for ein utanforståande å kjenne til.
drop function if exists resolve_tenant_by_hostname(text);
create or replace function resolve_tenant_by_hostname(p_hostname text)
returns table(
  data_plane_url text, data_plane_anon_key text, data_plane_storage_key text,
  theme jsonb, product_mode text, enabled_modules jsonb, custom_modules_manifest jsonb,
  site_lock_enabled boolean, site_lock_ever_enabled boolean
)
language sql stable security definer set search_path = public
as $$
  select data_plane_url, data_plane_anon_key, data_plane_storage_key, theme, product_mode, enabled_modules, custom_modules_manifest, site_lock_enabled, site_lock_ever_enabled
  from tenants
  where lower(p_hostname) = any(hostnames)
    and (status = 'active' or (status = 'provisioning' and schema_verified_at is not null));
$$;
revoke all on function resolve_tenant_by_hostname(text) from public, authenticated;
grant execute on function resolve_tenant_by_hostname(text) to anon;

notify pgrst, 'reload schema';
