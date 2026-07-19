-- Gjev "ukjend avsendar"-greina i process_inbound_email() ein threadId òg
-- (2026-07-19). Fram til no fekk berre den MATCHA greina ein threadId
-- (kopiert frå den matcha email_sent-rada, sjå 20260717120000_inbound_email.sql
-- linje 216-226) — den umatcha greina (linje 228-245 i den fila) sette ALDRI
-- threadId i det heile, sjølv om ho koplar meldinga til rett kunde via
-- find_or_create_crm_customer_by_email(). Dette hindra CRM-tidslinja frå å
-- kunne gruppere e-postar i éin samanslegen "samtale" (module-crm.js sin
-- planlagde tråd-gruppering) for AKKURAT dei e-postane som trong det mest —
-- kundar der tråd-matchinga (In-Reply-To/References mot
-- crm_comms.data.resendMessageId) av ein eller annan grunn ikkje lykkast,
-- til dømes fordi send-reply sitt Message-ID-fangst-oppfølgingskall aldri
-- har fungert i produksjon (sjå supabase/functions/send-reply/index.ts sin
-- eigen fiks same dag).
--
-- Design: i staden for å alltid mynte ein heilt ny threadId for kvar umatcha
-- e-post (som ville fragmentert éin kunde sin samtale i eit separat
-- pseudo-tråd PER e-post for alltid, sidan gamle email_sent-rader sin
-- resendMessageId er permanent NULL og aldri kan matchast av seg sjølv),
-- gjenbruk kunden sin siste eksisterande tråd viss ein finst, og mynt berre
-- ein fersk id for ein heilt fyrste-gongs-kontakt. v_thread_id er alt
-- deklarert i funksjonen og garantert NULL på dette punktet (anten aldri
-- sett, eller eksplisitt nullstilt av spoofing-sjekken lenger opp).
--
-- Ingen etterfylling av historiske rader (avklart med brukar 2026-07-19) —
-- denne migrasjonen er reint framoverretta.
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
  -- meldingar i same tråd) — sjå indeksen i 20260717120000_inbound_email.sql.
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
  -- eit menneske"-flagg) slik at CRM-UI-et kan vise ein indikator og la ein
  -- admin bulk-fjerne spuriøse oppføringar utan å reintrodusere den manuelle
  -- godkjenningskøen brukaren avviste 2026-07-01.
  v_customer := find_or_create_crm_customer_by_email(p_from_email, p_from_name);
  v_lead_id  := 'lead-' || gen_random_uuid();
  INSERT INTO leads (id, kind, name, email, message, source, chat_id, attachments)
  VALUES (v_lead_id, 'kontakt', COALESCE(p_from_name,''), COALESCE(p_from_email,''), COALESCE(p_text,''), 'epost-innkommande', NULL, '[]'::jsonb);

  -- NYTT 2026-07-19: gjenbruk kunden sin siste eksisterande tråd (om ein
  -- finst) i staden for å la denne rada stå heilt utan threadId — slik kan
  -- CRM-tidslinja gruppere han saman med resten av samtalen, sjølv om
  -- akkurat denne meldinga ikkje sjølv kunne tråd-matchast via
  -- In-Reply-To/References.
  SELECT data->>'threadId' INTO v_thread_id
  FROM crm_comms
  WHERE customer_id = v_customer.id
    AND type IN ('email_sent','email_received')
    AND data->>'threadId' IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    v_thread_id := 'th-' || replace(gen_random_uuid()::text, '-', '');
  END IF;

  v_comm_id := 'cm-' || gen_random_uuid();
  INSERT INTO crm_comms (id, customer_id, type, title, data)
  VALUES (v_comm_id, v_customer.id, 'email_received', p_subject, jsonb_build_object(
    'subject', p_subject, 'body', left(COALESCE(p_text,''), 5000), 'html', left(COALESCE(p_html,''), 5000),
    'from', p_from_email, 'threadId', v_thread_id, 'resendMessageId', p_message_id, 'autoCreated', true, 'leadId', v_lead_id
  ));

  UPDATE inbound_emails SET status = 'unmatched_created', matched_customer_id = v_customer.id, matched_comm_id = v_comm_id
  WHERE id = p_id;

  RETURN jsonb_build_object('status', 'unmatched_created', 'customer_id', v_customer.id, 'comm_id', v_comm_id, 'lead_id', v_lead_id);
END;
$$;

REVOKE ALL ON FUNCTION process_inbound_email(text, text, text, text, text, text, text, text, text, text[], text, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION process_inbound_email(text, text, text, text, text, text, text, text, text, text[], text, text, text, jsonb, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
