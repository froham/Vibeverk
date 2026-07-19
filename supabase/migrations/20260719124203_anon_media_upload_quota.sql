-- Anon-opplasting til den offentlege "media"-bucket-en (Tilbod-skjemaet sine
-- vedlegg, module-quote.js) har i dag INGEN grense på talet på filer eller
-- opplastingsfrekvens frå éin einskild besøkjande -- berre ei 20MB-per-fil-
-- grense. Funne av ekstern Codex-gjennomgang 2026-07-18, medvite utsett i
-- Batch 2 (sjå docs/project/CHANGELOG.md 0.51.0/0.52.0) i påvente av eit
-- arkitektur-konsultasjon om mekanisme. Arkitekten konkluderte 2026-07-19:
-- ein rein Postgres-trigger/RLS-sjekk kan ALDRI sjå den faktiske besøkjande
-- sin IP (Storage-API opnar si eiga tilkopling, ikkje via PostgREST), så
-- kvoteteljinga må skje via ein Edge Function som les IP frå request-headers
-- og kallar denne funksjonen -- sjå supabase/functions/anon-media-upload-token.

CREATE TABLE IF NOT EXISTS anon_upload_quota (
  bucket_key    text NOT NULL,
  day           date NOT NULL,
  upload_count  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, day)
);

-- bucket_key er ein hasha (ikkje rå) representasjon av besøkjande sin IP --
-- sjølve hashinga skjer i Edge Function-en (HMAC med ein hemmeleg pepper frå
-- miljøvariabel), ikkje her. Ingen RLS-policyar gjev anon/authenticated
-- tilgang i det heile -- denne tabellen er berre nåbar via funksjonen under,
-- som køyrer med eigaren (postgres) sine rettar uavhengig av kallaren.
ALTER TABLE anon_upload_quota ENABLE ROW LEVEL SECURITY;

-- Aukar dagens teljar for ein gjeven kvotenøkkel atomisk, og returnerer
-- true dersom talet framleis er under grensa (inkludert dette kallet).
-- VOLATILE (ikkje STABLE) sidan funksjonen skriv -- avvik medvite frå
-- CLAUDE.md sin vanlege "STABLE for anon-RPC-ar"-konvensjon, som gjeld
-- funksjonar utan skriveeffekt.
CREATE OR REPLACE FUNCTION bump_and_check_anon_upload_quota(p_key text, p_limit int DEFAULT 20)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO anon_upload_quota (bucket_key, day, upload_count)
  VALUES (p_key, CURRENT_DATE, 1)
  ON CONFLICT (bucket_key, day) DO UPDATE
    SET upload_count = anon_upload_quota.upload_count + 1
  RETURNING upload_count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

-- Denne funksjonen skal ALDRI vere kallbar direkte av ein klient -- berre av
-- Edge Function-en sin service_role-klient (som får EXECUTE via Supabase sin
-- plattform-standard-ACL, stadfesta i ADR-0008 -- ikkje noko denne
-- migrasjonen treng gje eksplisitt). REVOKE ALL FROM PUBLIC åleine er IKKJE
-- nok (same ADR-0008-lærdom), difor eksplisitt REVOKE frå anon/authenticated
-- som eiga setning.
REVOKE ALL ON FUNCTION bump_and_check_anon_upload_quota(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION bump_and_check_anon_upload_quota(text, int) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
