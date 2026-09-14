-- Fase 3 (av 3, siste) i logging/varsling-planen for
-- get_tenant_service_role_key() -- sjå Fase 1 (20260903120000_key_decrypt_log.sql,
-- loggar KVART kall) og Fase 2 (20260903143000_alert_on_support_access.sql,
-- sanntidsvarsel på generate_support_access). Same Vault-nøkkel/net.http_post/
-- Resend-mønster som Fase 2 og trigger_retention_sweep() alt bruker i drift
-- -- ingen ny leveringsmekanisme oppfunne her.
--
-- Kalibrert mot 11 dagar reell trafikk (2026-09-03 til 2026-09-14, 118 rader,
-- 3 distinkte tenantar totalt) FØR denne vart bygd, ikkje berre eit gjett --
-- sjå Arkitekt-vurderinga i samtalen som følgjer opp det opphavlege forslaget
-- frå 2026-09-03 (ROADMAP.md sitt Fase 3-punkt). Funn: KUN ÉIN 15-min-vindauge
-- av fleire hundre hadde meir enn 1 distinkt tenant_id (2 tenantar, 4 kall),
-- medan vindauge med HØGT VOLUM mot éin einaste tenant (opptil 35 kall) aldri
-- trigga -- stadfestar at tenant-MANGFALD, ikkje volum, faktisk er signalet,
-- akkurat som premisset for heile Fase 3 sa. Terskelen ">1 distinkt tenant i
-- eit rullerande 15-min-vindauge" er difor uendra frå originalforslaget, IKKJE
-- heva -- ei høgare grense ville fjerna den einaste reelle hendinga som
-- nokon gong har stadfesta at heile varslingskjeda faktisk fungerer.

-- =============================================================================
-- key_decrypt_alert_state -- eit einaste singleton-rad som held styr på når
-- varselet sist vart sendt, for ein enkel cooldown (Arkitekt-tilråding: utan
-- dette ville EIN samanhengande hending sendt eit nytt e-postvarsel kvar
-- einaste gong 5-min-pollen køyrer så lenge det rullerande vindauget framleis
-- inneheld avviket -- typisk 3-4+ duplikatvarsel for éi hending). 30 minutt
-- cooldown = 6 poll-syklusar, lang nok til å dekkje éi samanhengande hending
-- (sjølve vindauget er berre 15 min), kort nok til at ei NY, seinare hending
-- same time framleis varslar friskt. Same access-mønster som key_decrypt_log
-- -- ingen tilgang for authenticated i det heile, berre service_role.
-- =============================================================================
CREATE TABLE key_decrypt_alert_state (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  last_alerted_at  timestamptz
);
INSERT INTO key_decrypt_alert_state (last_alerted_at) VALUES (NULL);

ALTER TABLE key_decrypt_alert_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON key_decrypt_alert_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON key_decrypt_alert_state TO service_role;
-- Ingen CREATE POLICY -- service_role bypassar RLS uansett, og ingen annan
-- rolle skal nokon gong lese/skrive denne tabellen.

-- =============================================================================
-- check_key_decrypt_anomaly() -- kalla av pg_cron kvar 5. minutt. Reknar ut
-- kor mange DISTINKTE tenant_id som vart dekryptert i det siste rullerande
-- 15-minutters-vindauget; varslar berre dersom tersken er broten OG cooldown
-- har gått ut. Systemomfatta terskel (IKKJE per-tenant-par) -- Arkitekt-
-- vurdering: called_via-per-kallar-attribusjon ville kravd å endre
-- broker/tenant-admin sjølve (dei faktiske kundevendte funksjonane) for ein
-- fordel data ikkje stadfestar behovet for enno (éi hending på 11 dagar, med
-- ei fullt truverdig legitim forklaring). Framleis medvite utsett.
-- =============================================================================
CREATE OR REPLACE FUNCTION check_key_decrypt_anomaly()
RETURNS void
SECURITY DEFINER VOLATILE SET search_path = public, vault, extensions
LANGUAGE plpgsql AS $$
DECLARE
  v_distinct_tenants int;
  v_claimed_rows     int;
  v_key              text;
  v_tenants_json     jsonb;
BEGIN
  SELECT count(DISTINCT tenant_id) INTO v_distinct_tenants
  FROM key_decrypt_log
  WHERE called_at > now() - interval '15 minutes';

  IF v_distinct_tenants <= 1 THEN
    RETURN;
  END IF;

  -- Atomisk "krav" på cooldown-vindauget -- EIN UPDATE...WHERE i staden for
  -- eit separat SELECT-så-sjekk-så-UPDATE. Security Auditor-funn (MEDIUM,
  -- 2026-09-14): den opphavlege to-stegs-varianten hadde eit ekte TOCTOU-
  -- kappløp -- pg_cron garanterer ikkje at same jobb aldri overlappar (t.d.
  -- ein uvanleg treg køyring rett før neste 5-min-tick, eller ein operatør
  -- som køyrer funksjonen manuelt midt i eit planlagt tick) -- to samtidige
  -- køyringar kunne begge lese ein utgått cooldown FØR nokon av dei rakk å
  -- skrive, og difor begge sende kvart sitt e-postvarsel for same hending.
  -- Radlåsen ein UPDATE gjev gjer at berre éin samtidig kallar nokon gong
  -- vinn krava (den andre sin WHERE-føresetnad er ikkje lenger sann når han
  -- får løyve til å skrive, sidan vinnaren alt har sett last_alerted_at).
  UPDATE key_decrypt_alert_state
  SET last_alerted_at = now()
  WHERE last_alerted_at IS NULL OR last_alerted_at <= now() - interval '30 minutes';
  GET DIAGNOSTICS v_claimed_rows = ROW_COUNT;
  IF v_claimed_rows = 0 THEN
    RETURN; -- cooldown framleis aktiv, eller ein samtidig kallar vann kappløpet -- ikkje eit nytt varsel
  END IF;

  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'control_plane_service_role_key'
  LIMIT 1;
  IF v_key IS NULL THEN
    RAISE NOTICE 'check_key_decrypt_anomaly: control_plane_service_role_key ikkje sett i Vault enno, hoppar over';
    RETURN;
  END IF;

  -- Per-tenant-oppsummering for vindauget, til bruk i sjølve e-postteksten --
  -- gjev Frode nok kontekst til å vurdere hendinga direkte frå e-posten,
  -- utan å måtte spørre databasen fyrst.
  SELECT jsonb_agg(jsonb_build_object(
           'tenant_slug', t.slug,
           'tenant_hostname', CASE WHEN array_length(t.hostnames, 1) > 0 THEN t.hostnames[1] ELSE NULL END,
           'calls', k.calls
         ) ORDER BY k.calls DESC)
    INTO v_tenants_json
  FROM (
    SELECT tenant_id, count(*) AS calls
    FROM key_decrypt_log
    WHERE called_at > now() - interval '15 minutes'
    GROUP BY tenant_id
  ) k
  LEFT JOIN tenants t ON t.id = k.tenant_id;

  PERFORM net.http_post(
    url := 'https://jxoglthrnshabqmdmnui.supabase.co/functions/v1/alert-key-decrypt-anomaly',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'distinct_tenants', v_distinct_tenants,
      'window_minutes', 15,
      'tenants', v_tenants_json,
      'called_at', now()
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION check_key_decrypt_anomaly() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'key-decrypt-anomaly-poll',
  '*/5 * * * *',
  $$SELECT check_key_decrypt_anomaly();$$
);

NOTIFY pgrst, 'reload schema';
