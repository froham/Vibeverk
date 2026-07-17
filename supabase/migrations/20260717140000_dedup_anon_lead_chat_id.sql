-- Retta 2026-07-17: chat-samtalar som vart lukka BÅDE av admin OG av
-- besøkjande (kunden sitt eige "Kunden lukket chatvinduet"-steg,
-- module-chat.js ~line 1006-1009) kunne lage TO separate leads for SAME
-- chat_id. Rotårsak: getLeadByChatId() (module-chat.js) sjekkar
-- App.getLeads() -- for ein ANONYM besøkjande fell dette tilbake til DEN
-- BESØKJANDE SI EIGE localStorage-blob (RLS gjev anon ingen lesetilgang til
-- den ekte leads-tabellen i det heile), som ALDRI har sett ein lead ein
-- admin (eller ein tidlegare visit) alt oppretta i Supabase. Den besøkjande
-- sin eigen "lukk chat"-hending trur difor alltid at ingen lead finst enno,
-- og insert_anon_lead() (einaste vegen inn for anon) var ein rein INSERT
-- utan nokon eksistenssjekk -- fann av brukar 2026-07-17 via eit ekte
-- duplikat i produksjonsdata (to leads, same chat_id, ~80 sekund frå
-- kvarandre).
--
-- Løysing: gjer sjølve INSERT-en dedup-medviten på chat_id (server-sida,
-- sidan klienten aldri kan sjekke dette pålitande for anon). Ein partiell
-- unik indeks (berre for rader som FAKTISK har ein chat_id -- vanlege
-- Kontakt/Tilbud-leads har ingen, og skal ALDRI kollidere med kvarandre)
-- pluss ON CONFLICT DO UPDATE i staden for ein hard feil.

-- Rydd opp EKSISTERANDE duplikat FØR den unike indeksen vert oppretta --
-- CREATE UNIQUE INDEX ville elles feila umiddelbart mot produksjonsdata som
-- alt har nøyaktig dette duplikatet (stadfesta 2026-07-17). Behald raden med
-- nyaste created_at per chat_id (i den observerte duplikaten var det den
-- mest komplette transkripsjonen, inkl. "Kunden lukket chatvinduet"-lina).
-- Tie-breaker på id (ikkje berre created_at) -- to rader med byte-identisk
-- created_at ville elles begge overlevd og fått CREATE UNIQUE INDEX til å
-- feile hardt rett under (Security-gjennomgang 2026-07-17). Stadfesta
-- produksjonstilfelle hadde ~80 sekund mellomrom, men denne dedup-logikken
-- er skriven generelt, ikkje berre for det eine tilfellet.
DELETE FROM leads a USING leads b
WHERE a.chat_id IS NOT NULL
  AND a.chat_id = b.chat_id
  AND (a.created_at < b.created_at
       OR (a.created_at = b.created_at AND a.id < b.id));

CREATE UNIQUE INDEX IF NOT EXISTS leads_chat_id_unique_idx
  ON leads (chat_id) WHERE chat_id IS NOT NULL;

-- HIGH-funn frå Security-gjennomgang 2026-07-17, retta før deploy: den
-- fyrste versjonen av denne funksjonen gjorde ON CONFLICT DO UPDATE utløyst
-- åleine av chat_id -- eit klient-generert, IKKJE-kryptografisk sterkt felt
-- ("c"+Date.now()+kort random-hale, sjå module-chat.js newId()), sendt
-- direkte av kallaren. Utan ei eigarskapssjekk kunne KVEN SOM HELST med den
-- offentlege anon-nøkkelen kalle denne RPC-en direkte med eit gjetta/observert
-- chat_id og overskrive ein FRAMAND kunde sin lead-melding/namn/e-post --
-- nøyaktig det SAMA mønsteret get_visitor_conv()/insert_visitor_message()
-- (sjå baseline-migrasjonen, "VISITOR-SCOPED RPCs") alt krev ei
-- eigarskapssjekk for. p_visitor_id er Chat.getVid() sin stabile,
-- per-nettlesar-token -- same verdi som vart lagra i
-- chat_conversations.visitor_id då samtalen starta, så sjekket matchar
-- korrekt for den ekte besøkjande som faktisk lukka SIN EIGEN chat.
-- Kan IKKJE stadfeste eigarskap (manglar p_visitor_id, eller chat_id høyrer
-- ikkje til denne besøkjande) -> fell tilbake til ein rein INSERT, som anten
-- lukkast (ingen kollisjon, vanleg Kontakt/Tilbud-tilfelle) eller feilar
-- høgt (unique_violation -- fanga og logga av addLead() sin .then(), aldri
-- ein stille overskriving av framand data).
CREATE OR REPLACE FUNCTION insert_anon_lead(
  p_id text, p_kind text, p_name text, p_email text, p_message text,
  p_reference_number text, p_source text DEFAULT NULL, p_chat_id text DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb, p_visitor_id text DEFAULT NULL
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_owned boolean := false;
BEGIN
  IF p_kind NOT IN ('kontakt', 'tilbud') THEN
    RAISE EXCEPTION 'Ugyldig kind';
  END IF;

  IF p_chat_id IS NOT NULL AND p_visitor_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM chat_conversations WHERE id = p_chat_id AND visitor_id = p_visitor_id
    ) INTO v_owned;
  END IF;

  IF v_owned THEN
    INSERT INTO leads (id, kind, name, email, message, reference_number, source, chat_id, attachments)
    VALUES (p_id, p_kind, COALESCE(p_name, ''), COALESCE(p_email, ''), p_message, p_reference_number, p_source, p_chat_id, COALESCE(p_attachments, '[]'::jsonb))
    ON CONFLICT (chat_id) WHERE chat_id IS NOT NULL
    DO UPDATE SET
      message = EXCLUDED.message,
      name    = COALESCE(NULLIF(EXCLUDED.name, ''), leads.name),
      email   = COALESCE(NULLIF(EXCLUDED.email, ''), leads.email);
  ELSE
    INSERT INTO leads (id, kind, name, email, message, reference_number, source, chat_id, attachments)
    VALUES (p_id, p_kind, COALESCE(p_name, ''), COALESCE(p_email, ''), p_message, p_reference_number, p_source, p_chat_id, COALESCE(p_attachments, '[]'::jsonb));
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION insert_anon_lead(text, text, text, text, text, text, text, text, jsonb, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION insert_anon_lead(text, text, text, text, text, text, text, text, jsonb, text) TO anon;

-- Den GAMLE 9-parameters signaturen (utan p_visitor_id) er no overflødig --
-- PostgreSQL overloadar på parametertal, så begge ville elles eksistere
-- samstundes. Fjern han eksplisitt, elles kan ein gamal, ikkje-oppdatert
-- klient framleis kalle 9-parameter-versjonen (som ikkje finst lenger etter
-- CREATE OR REPLACE over -- CREATE OR REPLACE bytter berre ut same signatur,
-- lagar ikkje ein ny overload for eit ULIKT parametertal).
DROP FUNCTION IF EXISTS insert_anon_lead(text, text, text, text, text, text, text, text, jsonb);

NOTIFY pgrst, 'reload schema';
