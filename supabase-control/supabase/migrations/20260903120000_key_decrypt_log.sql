-- Fase 1 (av 3) i logging/varsling-planen for get_tenant_service_role_key():
-- funksjonen sjølv logga historisk INGENTING -- all eksisterande sporing
-- (broker_audit_log) skjer i KALLAR-koden (broker/tenant-admin Edge
-- Functions), ikkje i sjølve dekrypteringsfunksjonen. Det betyr at eit rått
-- RPC-kall mot get_tenant_service_role_key() -- t.d. med ein lekka
-- VIBEVERK_CONTROL_SERVICE_ROLE_KEY, HEILT UTANOM broker/tenant-admin --
-- ville vore usporbart. Denne migrasjonen tettar nøyaktig det hòlet: alle
-- kall vert no logga INNI funksjonen, uansett kallveg.
--
-- Berre logging i denne fasen -- INGEN varsling enno (fase 2/3, seinare
-- eigne migrasjonar, etter at dette har kjørt ei stund i produksjon og
-- mønsteret er kalibrert mot ekte trafikk). Arkitekt-design (2026-09-03),
-- Security Auditor-pass kravd før produksjonsutrulling per CLAUDE.md sine
-- faste reglar for kontrollplan-endringar.

-- =============================================================================
-- key_decrypt_log — append-only, minimal logg over KVART kall til
-- get_tenant_service_role_key(), uavhengig av om kallet kom frå broker/
-- tenant-admin sin eigen Edge Function-kode eller eit direkte RPC-kall som
-- går utanom dei heilt. Deliberately IKKJE same tabell som broker_audit_log
-- -- den er forma rundt ei operatør-initiert handling med eit resultat
-- (success/error) avgjort av KALLAREN; denne funksjonen har ingen
-- operatør-identitet tilgjengeleg (kallast berre frå ein service_role-
-- tilkobling) og ingen meiningsfull resultat-status utover at ho vart kalla.
--
-- Ingen tilgang for authenticated i det heile -- strengare enn
-- broker_audit_log sitt "operatørar kan lese historikk"-mønster, med vilje:
-- poenget er at ein kompromittert Console-økt ikkje eingong skal kunne
-- stadfeste at denne loggen finst, berre service_role kan lese ho.
-- =============================================================================
-- tenant_id har MED VILJE ingen REFERENCES tenants(id) -- ein FK ville feila
-- (og dermed hoppa over) sjølve INSERT-en for eit ugyldig/oppdikta tenant_id,
-- som er akkurat den mest sannsynlege forma eit lekka-nøkkel-forsøk ville
-- teke (prøver seg fram med tilfeldige/gjetta UUID-ar). Denne tabellen er
-- ein rein logg, ikkje eit referanseintegritets-berande register -- å logge
-- eit kall mot ein tenant som ikkje finst er nettopp poenget, ikkje ein feil.
CREATE TABLE key_decrypt_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid,
  called_at   timestamptz NOT NULL DEFAULT now(),
  called_via  text  -- best-effort kalle-kontekst-hint, oftast NULL (sjå
                     -- Arkitekt-notat: full per-kallar-attribusjon krev å
                     -- endre broker/tenant-admin til å sende ein hint-
                     -- parameter, medvite utsett til ein eigen, seinare runde)
);

ALTER TABLE key_decrypt_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON key_decrypt_log FROM PUBLIC, anon, authenticated;
-- service_role får INGEN automatisk tabelltilgang (stadfesta gjentekne
-- gongar i denne kodebasen, sjå CLAUDE.md sine Supabase-reglar) -- utan
-- denne eksplisitte GRANT-en ville eit framtidig Fase 2-varslingskall
-- (service_role via PostgREST) fått 42501, sjølv om han er den einaste
-- rolla loggen er meint å vere lesbar for.
GRANT SELECT ON key_decrypt_log TO service_role;
-- Ingen CREATE POLICY i det heile -- ingen rolle utanom service_role
-- (som bypassar RLS uansett) kan lese eller skrive denne tabellen.

-- Vekstavgrensing (Arkitekt-funn: broker dekrypterer på KVART einaste
-- kall, uavhengig av handling -- denne tabellen kan vekse fort under reell
-- Console-bruk). Dagleg opprydding av rader eldre enn 90 dagar, same
-- pg_cron-mekanisme som retention-sweep-jobben alt bruker, men her ein
-- rein SQL DELETE -- ingen ekstern Edge Function-kall trengst, sidan dette
-- ikkje rører nokon tenant sitt eige prosjekt.
SELECT cron.schedule(
  'key-decrypt-log-cleanup-daily',
  '43 3 * * *', -- kvar natt 03:43, unngår kollisjon med retention-sweep (03:17)
  $$DELETE FROM key_decrypt_log WHERE called_at < now() - interval '90 days';$$
);

-- =============================================================================
-- get_tenant_service_role_key() — skriven om frå LANGUAGE sql til
-- LANGUAGE plpgsql for å kunne logge som ein reell, ordna bieffekt FØR
-- verdien returnerast. Same signatur, same SECURITY DEFINER/search_path,
-- same faktiske dekrypterings-SELECT som før -- ingen åtferdsendring for
-- nokon av dei 4 eksisterande, verifiserte kallstadene (broker/index.ts,
-- tenant-admin/index.ts sine tre stadar).
--
-- Fail-closed med vilje (Arkitekt-tilråding, matchar broker sitt eige
-- "auditStart feila -> heile handlinga avbrytast"-mønster): INSERT-en køyrer
-- FØR verdien vert henta/returnert. Feilar logginga (t.d. eit framtidig RLS-
-- feilsteg), feilar heile funksjonen -- ingen nøkkel vert nokon gong
-- returnert utan at kallet fyrst er logga. Ingen eigen exception-handling
-- trengst for dette -- ein feila INSERT ropar naturleg vidare og avbryt heile
-- transaksjonen/funksjonskallet.
CREATE OR REPLACE FUNCTION get_tenant_service_role_key(p_tenant_id uuid)
RETURNS text
SECURITY DEFINER VOLATILE SET search_path = public, vault
LANGUAGE plpgsql AS $$
DECLARE
  v_key text;
BEGIN
  INSERT INTO key_decrypt_log (tenant_id) VALUES (p_tenant_id);

  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  JOIN tenants ON tenants.data_plane_service_role_secret_id = vault.decrypted_secrets.id
  WHERE tenants.id = p_tenant_id;

  RETURN v_key;
END;
$$;

-- MÅ gjentakast eksplisitt sjølv om funksjonen berre er CREATE OR REPLACE
-- (same signatur som før) -- Supabase sine plattform-standard-ACL-ar kan gje
-- anon/authenticated/service_role EXECUTE direkte, uavhengig av tidlegare
-- REVOKE-ar på den gamle funksjonskroppen (stadfesta fallgruve, sjå
-- CLAUDE.md sine Supabase-reglar og ADR-0008 sitt eige "Consequences"-avsnitt).
REVOKE ALL ON FUNCTION get_tenant_service_role_key(uuid) FROM PUBLIC, anon, authenticated;
-- Eksplisitt GRANT til service_role i staden for å stole på plattform-
-- standarden -- denne funksjonen MÅ alltid vere kallbar av broker/
-- tenant-admin (same "stol aldri på default for service_role"-regel som
-- CLAUDE.md sine Supabase-reglar allereie krev andre stader).
GRANT EXECUTE ON FUNCTION get_tenant_service_role_key(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
