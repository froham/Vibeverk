-- Fase 2 (av 3) i logging/varsling-planen for get_tenant_service_role_key()/
-- generate_support_access -- sjå Fase 1 (20260903120000_key_decrypt_log.sql)
-- og Arkitekt-forslaget frå same runde for full grunngjeving. Fase 3
-- (mønster-basert varsel på uvanleg mange get_tenant_service_role_key-kall)
-- er MEDVITE UTSETT til Fase 1 har samla nok reell logg-data til å
-- kalibrere terskelen -- ikkje bygd her.
--
-- generate_support_access er den einaste handlinga i tenant-admin som let
-- ein operatør logge inn SOM ein eksisterande kunde-admin. Allereie logga
-- via auditStart()/auditFinish() (broker_audit_log), men utan sanntids-
-- varsling måtte nokon manuelt sjekke loggen for å oppdage det. Denne
-- migrasjonen legg til ein trigger som varslar Frode med det same.

-- Same net.http_post + Vault-lagra-akkreditiv-mønster som
-- trigger_retention_sweep() (20260812234500_add_retention_sweep_cron.sql)
-- alt bruker og er stadfesta i drift -- ingen ny mekanisme oppfunne.
CREATE OR REPLACE FUNCTION alert_on_support_access()
RETURNS trigger
SECURITY DEFINER
SET search_path = public, vault
LANGUAGE plpgsql AS $$
DECLARE
  v_key             text;
  v_operator_email  text;
  v_tenant_slug     text;
  v_tenant_hostname text;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'control_plane_service_role_key'
  LIMIT 1;

  IF v_key IS NULL THEN
    RAISE NOTICE 'alert_on_support_access: control_plane_service_role_key ikkje sett i Vault enno, hoppar over';
    RETURN NEW;
  END IF;

  SELECT email INTO v_operator_email FROM operators WHERE id = NEW.operator_id;
  SELECT slug, (CASE WHEN array_length(hostnames, 1) > 0 THEN hostnames[1] ELSE NULL END)
    INTO v_tenant_slug, v_tenant_hostname
    FROM tenants WHERE id = NEW.tenant_id;

  PERFORM net.http_post(
    url := 'https://jxoglthrnshabqmdmnui.supabase.co/functions/v1/alert-support-access',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'tenant_slug', v_tenant_slug,
      'tenant_hostname', v_tenant_hostname,
      'operator_email', v_operator_email,
      -- detail har forma "support-tilgang generert for: <e-post>", sett av
      -- auditFinish() i tenant-admin/index.ts -- gjenbrukt her i staden for
      -- å leggje til ein eigen kolonne berre for dette eine feltet.
      'target_email', regexp_replace(coalesce(NEW.detail, ''), '^support-tilgang generert for: ', ''),
      'called_at', NEW.created_at
    )
  );

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION alert_on_support_access() FROM PUBLIC, anon, authenticated;

-- Fyrer berre når resultatet FAKTISK vart 'success' for nettopp denne
-- handlinga, og berre på den eine overgangen inn i 'success' (WHEN-klausulen
-- hindrar at ein eventuell framtidig, urelatert UPDATE på same rad
-- (t.d. ei rein re-lesing/re-skriving) varslar på nytt).
CREATE TRIGGER broker_audit_log_alert_support_access
AFTER UPDATE ON broker_audit_log
FOR EACH ROW
WHEN (
  NEW.action = 'generate_support_access'
  AND NEW.result = 'success'
  AND OLD.result IS DISTINCT FROM 'success'
)
EXECUTE FUNCTION alert_on_support_access();

NOTIFY pgrst, 'reload schema';
