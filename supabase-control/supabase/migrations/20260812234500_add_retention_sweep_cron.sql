-- Del 2 av Fase 1 (retention-sweep): tidsstyrt utløysing av
-- retention-sweep Edge Function via pg_cron + pg_net, kun i dette
-- kontrollplan-prosjektet (IKKJE i kvart kundeprosjekt -- sjølve
-- sweep-logikken bur sentralt, sjå Arkitekt-vurderinga i PR-skildringa).
--
-- MERK -- eitt manuelt steg krevst FØR jobben faktisk gjer noko:
-- kontrollplanet sin EIGEN service_role-nøkkel må leggjast i Vault under
-- namnet 'control_plane_service_role_key', KØYRD SEPARAT (aldri i ein
-- git-sporet migrasjon, same disiplin som per-tenant-nøklane i
-- ADR-0008/CLAUDE.md):
--   select vault.create_secret('<den faktiske service_role-nøkkelen>', 'control_plane_service_role_key');
-- Fram til det er gjort, feilar trigger_retention_sweep() stille (fangar
-- feilen, loggar, gjer ingenting anna) -- trygt, sidan retention-sweep
-- uansett berre er dry-run i denne fasen.
--
-- STADFESTA EMPIRISK 2026-08-12 (fyrste faktiske utrulling): "den faktiske
-- service_role-nøkkelen" over må vere den NYE `sb_secret_...`-forma
-- (Project Settings → API Keys → "secret", IKKJE "Legacy service_role
-- API key" som framleis er eit JWT). Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
-- inne i sjølve Edge Function-en returnerer den nye forma for prosjekt som
-- har rulla ut det nyare API-nøkkel-systemet -- den gamle legacy-JWT-en gav
-- eit reelt, stadfesta 401 ("Ikkje tilgjengeleg") heilt til nøkkelen vart
-- bytt til `sb_secret_...`-forma, verifisert direkte via net._http_response.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- SECURITY DEFINER slik at pg_cron (som køyrer som postgres) kan lese
-- Vault-hemmeleg utan at nokon annan rolle får det via denne funksjonen.
create or replace function trigger_retention_sweep()
returns void
security definer
set search_path = public, vault, extensions
language plpgsql as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'control_plane_service_role_key'
  limit 1;

  if v_key is null then
    raise notice 'retention-sweep: control_plane_service_role_key ikkje sett i Vault enno, hoppar over';
    return;
  end if;

  perform net.http_post(
    url := 'https://jxoglthrnshabqmdmnui.supabase.co/functions/v1/retention-sweep',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function trigger_retention_sweep() from public, anon, authenticated;

select cron.schedule(
  'retention-sweep-daily',
  '17 3 * * *', -- kvar natt 03:17, unngår heile-time-kollisjon med andre jobbar
  $$select trigger_retention_sweep();$$
);
