-- Innkomande e-post (steg 6f, ROADMAP.md "Next" punkt 6). Bygd etter tre
-- les-berre gjennomgangar (Arkitekt, Security Auditor, Privacy/Compliance
-- Advisor, alle 2026-07-17) — sjå ROADMAP.md for full grunngjeving. Denne
-- fila dekker berre server/skjema-halvdelen; webhook-Edge Function og
-- CRM-UI-endringar (mikro-CRM-tidslinje, «ikkje verifisert»-flagg,
-- bulk-sikringsventil) kjem i separate endringar.
--
-- Design (Arkitekt-konsultasjon 2026-07-17): crm_comms har ALT eit
-- fungerande utgåande e-post-mønster (type='email_sent', klient-generert
-- threadId i data-jsonb, sjå module-crm.js sin openEmailDialog()/newThreadId()).
-- Innkomande svar som MATCHAR ein reell Resend-Message-ID (send-reply lagrar
-- no data.resendMessageId på email_sent-raden via ein oppfølgingskall til
-- Resend sin GET /emails/{id}) hamnar difor rett inn i SAME kunde sin
-- crm_comms-tidslinje som ein ny email_received-rad — ikkje ein ny,
-- parallell tabell. Umatcha avsendarar (ein framand som skriv til catch-all-
-- adressa) følgjer framleis det opphavlege 2026-07-01-designet: ny
-- Kontakt-lead + ny CRM-kunde, sidan det er nøyaktig den eksisterande
-- Henvendelser ny/lest/løst-arbeidsflyten sitt inngangspunkt.

-- ── 1. INBOUND_EMAILS (idempotens + revisjonsspor, IKKJE ein CRM-tabell) ────
--
-- Loggar metadata om ALLE webhook-kall frå Resend, inkl. avviste/forfalska
-- e-postar som ALDRI vart nokon kunde eller crm_comms-rad (Privacy-gjennomgang:
-- eige tryggingslogg-formål, skilt frå kundehistorikk-formålet crm_comms har).
-- `id` = Resend sin eigen email_id — doblar som idempotens-nøkkel via
-- ON CONFLICT DO NOTHING i RPC-en under (H2/Security: reelle gjentak av same
-- webhook skal aldri prosesserast to gonger, men ein tilstandsmaskin, ikkje
-- berre eit stille no-op).
CREATE TABLE IF NOT EXISTS inbound_emails (
  id                  text         PRIMARY KEY,
  from_email          text         NOT NULL DEFAULT '',
  from_name           text                  DEFAULT '',
  to_email            text                  DEFAULT '',
  subject             text                  DEFAULT '',
  message_id          text,
  in_reply_to         text,
  refs                text[]                DEFAULT '{}',
  spf_result          text,
  dkim_result         text,
  dmarc_result        text,
  status              text         NOT NULL DEFAULT 'received'
                       CHECK (status IN ('received','matched','unmatched_created','rejected_spoofed','rejected_invalid_sig')),
  matched_customer_id text         REFERENCES crm_customers(id) ON DELETE SET NULL,
  matched_comm_id     text         REFERENCES crm_comms(id) ON DELETE SET NULL,
  -- MERK: webhooken (supabase/functions/inbound-email) sender berre eit
  -- avgrensa utval headera hit (message-id/from/to/subject/date/
  -- authentication-results/in-reply-to/references), ALDRI det rå,
  -- ufiltrerte Resend-headerobjektet — retta etter kodenivå-Privacy-
  -- gjennomgang 2026-07-17 (fann fyrste versjonen dumpa alt, inkl.
  -- Received-kjeder med IP-ar til mellomliggande e-postserverar).
  headers             jsonb                 DEFAULT '{}',
  received_at         timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE inbound_emails ENABLE ROW LEVEL SECURITY;

-- Berre admin/editor kan sjå denne logg-tabellen (Privacy-gjennomgang: ho
-- inneheld metadata om avvist/forfalska post frå ukjende avsendarar, ikkje
-- noko ein "member" treng for vanleg kundeoppfølging). INGEN INSERT/UPDATE/
-- DELETE-policy for authenticated/anon i det heile — einaste skrivevegen er
-- RPC-en under, som køyrer som service_role (webhooken sin eigen økt, aldri
-- ein nettlesar).
DROP POLICY IF EXISTS inbound_emails_select ON inbound_emails;
CREATE POLICY inbound_emails_select ON inbound_emails FOR SELECT TO authenticated USING (can_edit_content());

-- Naudsynt for deleteAllForEmail() (GDPR §17-sletteflyten i module-crm.js) —
-- ho slettar alt anna PII-berande for ein e-postadresse via akkurat denne
-- authenticated+can_edit_content()-vegen (leads/bookings/crm_comms/chat), og
-- inbound_emails inneheld avsendar-e-post/emne/rå-headera, altså PII som må
-- kunne slettast same veg (Privacy-gjennomgang 2026-07-17).
DROP POLICY IF EXISTS inbound_emails_delete ON inbound_emails;
CREATE POLICY inbound_emails_delete ON inbound_emails FOR DELETE TO authenticated USING (can_edit_content());

-- Matching-indeks: kva email_sent-rad (om nokon) svarar denne meldinga på.
-- Expression-indeks over data->>'resendMessageId', ikkje ein ny ekte kolonne
-- (Arkitekt: held seg til crm_comms sin eksisterande polymorfe-data-konvensjon).
CREATE INDEX IF NOT EXISTS crm_comms_resend_message_id_idx
  ON crm_comms ((data->>'resendMessageId'))
  WHERE type = 'email_sent';

-- ── 2. UNVERIFISERT-FLAGG (Privacy-gjennomgave si lettvekts-tryggingsventil) ─
--
-- Ingen ny kolonne på crm_customers — flagget høyrer til DEN SPESIFIKKE
-- auto-oppretta email_received-comm-en (data.autoCreated), ikkje kunden som
-- heilskap (same kunde kan seinare få ekte, menneskeleg-stadfesta kontakt).
-- CRM-UI-et (eiga endring) les data.autoCreated frå crm_comms/leads for å
-- vise «ikkje verifisert»-indikatoren og bulk-sikringsventilen sitt utval.

-- ── 3. FINN-ELLER-OPPRETT CRM-KUNDE, SERIALISERT (Arkitekt: dedup-race) ─────
--
-- Same check-then-insert-mønster som autoImport() sin klientsidige upsert()
-- alt gjer (module-crm.js linje ~422) — men no kalla frå ein webhook som kan
-- prosessere fleire samstundes innkomande e-postar frå éin heilt ny
-- avsendar samstundes (eller Resend som prøver på nytt), noko den
-- synkrone eittfane-føresetnaden til upsert() ikkje held for. Serialiserer
-- på e-postadressa inni éin transaksjon — IKKJE ein hard UNIQUE-skranke,
-- sidan ekte duplikatar alt er ein kjend, tolerert, manuelt reparerbar
-- tilstand via merge_crm_customers().
CREATE OR REPLACE FUNCTION find_or_create_crm_customer_by_email(p_email text, p_name text)
RETURNS crm_customers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := lower(trim(p_email));
  result  crm_customers;
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'Manglar e-postadresse';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_email));

  SELECT * INTO result FROM crm_customers
  WHERE lower(email) = v_email OR EXISTS (SELECT 1 FROM unnest(alt_emails) x WHERE lower(x) = v_email)
  LIMIT 1;
  IF FOUND THEN RETURN result; END IF;

  INSERT INTO crm_customers (id, email, name)
  VALUES ('cust-' || gen_random_uuid(), p_email, COALESCE(p_name, ''))
  RETURNING * INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION find_or_create_crm_customer_by_email(text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION find_or_create_crm_customer_by_email(text, text) TO service_role;

-- ── 4. PROSESSER EIN INNKOMANDE E-POST (webhooken sitt einaste DB-inngangspunkt) ─
--
-- service_role-only (H4/Security) — webhooken har alt gjort svix-
-- signaturverifisering FØR dette kallet i det heile skjer (H2/H3, handheva i
-- Edge Function-koden, ikkje her). p_auth_pass er domene-autentiseringa
-- (SPF/DKIM begge pass) — krevst OGSÅ for matcha trådar, ikkje berre
-- ny-oppretting (H1: In-Reply-To/References er forfalskbare headera åleine).
-- VOLATILE (standard, ikkje sett STABLE) sidan funksjonen skriv data —
-- ulikt dei STABLE lese-RPC-ane som insert_anon_lead() sine næraste slektningar.
CREATE OR REPLACE FUNCTION process_inbound_email(
  p_id          text,
  p_from_email  text,
  p_from_name   text,
  p_to_email    text,
  p_subject     text,
  p_html        text,
  p_text        text,
  p_message_id  text,
  p_in_reply_to text,
  p_refs        text[],
  p_spf         text,
  p_dkim        text,
  p_dmarc       text,
  p_headers     jsonb,
  p_auth_pass   boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id text;
  v_thread_id   text;
  v_comm_id     text;
  v_lead_id     text;
  v_customer    crm_customers;
BEGIN
  -- Idempotens: éin rad per Resend email_id. Om raden alt finst (webhook-
  -- gjentak), IKKJE prosesser vidare — returner den eksisterande tilstanden
  -- i staden for eit stilt no-op (MEDIUM-funn frå Security-gjennomgangen).
  BEGIN
    INSERT INTO inbound_emails
      (id, from_email, from_name, to_email, subject, message_id, in_reply_to, refs, spf_result, dkim_result, dmarc_result, headers)
    VALUES
      (p_id, COALESCE(p_from_email,''), COALESCE(p_from_name,''), COALESCE(p_to_email,''), COALESCE(p_subject,''),
       p_message_id, p_in_reply_to, COALESCE(p_refs,'{}'), p_spf, p_dkim, p_dmarc, COALESCE(p_headers,'{}'::jsonb));
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', (SELECT status FROM inbound_emails WHERE id = p_id), 'already_processed', true);
  END;

  IF NOT p_auth_pass THEN
    UPDATE inbound_emails SET status = 'rejected_spoofed' WHERE id = p_id;
    RETURN jsonb_build_object('status', 'rejected_spoofed');
  END IF;

  -- Prøv å matche mot ein tidlegare utgåande e-post (crm_comms.email_sent,
  -- data.resendMessageId) via In-Reply-To FØRST, så References (eldre
  -- meldingar i same tråd) — sjå indeksen i del 1.
  SELECT customer_id, data->>'threadId' INTO v_customer_id, v_thread_id
  FROM crm_comms
  WHERE type = 'email_sent' AND data->>'resendMessageId' = p_in_reply_to
  LIMIT 1;

  IF v_customer_id IS NULL AND p_refs IS NOT NULL AND array_length(p_refs,1) > 0 THEN
    SELECT customer_id, data->>'threadId' INTO v_customer_id, v_thread_id
    FROM crm_comms
    WHERE type = 'email_sent' AND data->>'resendMessageId' = ANY(p_refs)
    LIMIT 1;
  END IF;

  -- CRITICAL-funn frå kode-nivå Security Auditor-gjennomgang 2026-07-17: eit
  -- In-Reply-To/References-treff åleine stadfestar berre AT tråden finst,
  -- IKKJE at DENNE avsendaren faktisk er kunden tråden høyrer til. SPF+DKIM
  -- stadfestar berre at avsendaren eig SITT EIGE domene (trivielt for kven
  -- som helst) — seier ingenting om kven dei er. Utan denne sjekken kunne
  -- kven som helst med eit gyldig SPF/DKIM-oppsett og ein tidlegare observert
  -- Message-ID (synleg for cc/bcc-mottakarar, vidaresendarar, eller nokon som
  -- såg dei rå headera) forfalske In-Reply-To og injisere vilkårleg innhald
  -- inn i EIN ANNAN kunde sin CRM-tidslinje som om det var eit ekte svar.
  -- Krev difor OGSÅ at avsendaren si e-postadresse faktisk høyrer til den
  -- matcha kunden FØR treffet godtakast — elles fell heilt igjennom til
  -- umatcha-greina (ny/gjenbrukt kunde via find_or_create, ikkje avvist).
  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm_customers
    WHERE id = v_customer_id
      AND (lower(email) = lower(trim(p_from_email))
           OR EXISTS (SELECT 1 FROM unnest(alt_emails) x WHERE lower(x) = lower(trim(p_from_email))))
  ) THEN
    v_customer_id := NULL;
    v_thread_id := NULL;
  END IF;

  IF v_customer_id IS NOT NULL THEN
    v_comm_id := 'cm-' || gen_random_uuid();
    INSERT INTO crm_comms (id, customer_id, type, title, data)
    VALUES (v_comm_id, v_customer_id, 'email_received', p_subject, jsonb_build_object(
      'subject', p_subject, 'body', left(COALESCE(p_text,''), 5000), 'html', left(COALESCE(p_html,''), 5000),
      'from', p_from_email, 'threadId', v_thread_id, 'resendMessageId', p_message_id
    ));
    UPDATE inbound_emails SET status = 'matched', matched_customer_id = v_customer_id, matched_comm_id = v_comm_id
    WHERE id = p_id;
    RETURN jsonb_build_object('status', 'matched', 'customer_id', v_customer_id, 'comm_id', v_comm_id);
  END IF;

  -- Ingen treff: heilt ukjend/uverifisert avsendar. Same mønster som
  -- autoImport()/insert_anon_lead() — ny Kontakt-lead (Henvendelser-
  -- arbeidsflyten sitt inngangspunkt) + ny/gjenbrukt CRM-kunde, MEN merkt
  -- data.autoCreated=true (Privacy-gjennomgangen sitt "ikkje verifisert av
  -- eit menneske"-flagg — sjå del 2) slik at CRM-UI-et kan vise ein
  -- indikator og la ein admin bulk-fjerne spuriøse oppføringar utan å
  -- reintrodusere den manuelle godkjenningskøen brukaren avviste 2026-07-01.
  v_customer := find_or_create_crm_customer_by_email(p_from_email, p_from_name);
  v_lead_id  := 'lead-' || gen_random_uuid();
  INSERT INTO leads (id, kind, name, email, message, source, chat_id, attachments)
  VALUES (v_lead_id, 'kontakt', COALESCE(p_from_name,''), COALESCE(p_from_email,''), COALESCE(p_text,''), 'epost-innkommande', NULL, '[]'::jsonb);

  v_comm_id := 'cm-' || gen_random_uuid();
  INSERT INTO crm_comms (id, customer_id, type, title, data)
  VALUES (v_comm_id, v_customer.id, 'email_received', p_subject, jsonb_build_object(
    'subject', p_subject, 'body', left(COALESCE(p_text,''), 5000), 'html', left(COALESCE(p_html,''), 5000),
    'from', p_from_email, 'resendMessageId', p_message_id, 'autoCreated', true, 'leadId', v_lead_id
  ));

  UPDATE inbound_emails SET status = 'unmatched_created', matched_customer_id = v_customer.id, matched_comm_id = v_comm_id
  WHERE id = p_id;

  RETURN jsonb_build_object('status', 'unmatched_created', 'customer_id', v_customer.id, 'comm_id', v_comm_id, 'lead_id', v_lead_id);
END;
$$;

REVOKE ALL ON FUNCTION process_inbound_email(text, text, text, text, text, text, text, text, text, text[], text, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION process_inbound_email(text, text, text, text, text, text, text, text, text, text[], text, text, text, jsonb, boolean) TO service_role;

-- MERK — ingen direkte tabell-GRANT til service_role her (ulikt den
-- dokumenterte CLAUDE.md-fella om "service_role bypasserer RLS men får ingen
-- automatiske grants"): webhooken (supabase/functions/inbound-email) kallar
-- ALDRI .from(...) direkte, berre .rpc("process_inbound_email", …) — sjølve
-- RPC-en køyrer SECURITY DEFINER som funksjonseigaren (postgres, same som
-- insert_anon_lead()/merge_crm_customers()), som alt har full tabelltilgang
-- utan eksplisitt grant. Eit ekstra GRANT TIL service_role her ville vore
-- ubrukt (ingenting kallar tabellane som service_role direkte) og misvisande
-- å lese for ein framtidig utviklar.

NOTIFY pgrst, 'reload schema';
