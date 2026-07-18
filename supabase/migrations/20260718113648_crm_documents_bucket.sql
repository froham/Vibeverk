-- CRM-dokument-vedlegg: eigen, PRIVAT Storage-bucket, ikkje den delte,
-- offentlege "media"-bucket-en (brukt av Tilbod/mediebank/kunngjeringar/
-- hero-/om oss-bilete, uendra av denne migreringa). Arkitekt-konsultasjon
-- 2026-07-18 (re-verifisert mot 2026-07-06 sin opphavlege spesifikasjon).
--
-- Avgjerder stadfesta av brukar 2026-07-18:
-- - INSERT/DELETE: berre admin/editor (can_edit_content()) -- CRM-dokument er
--   forretningsdokument, ikkje personlege opplastingar; crm_comms_delete
--   krev alt can_edit_content(), så Storage skal ikkje vere lausare enn det.
-- - SELECT: ALLE autentiserte roller (inkl. member) -- matchar crm_comms_select
--   sin eigen "USING (true) TO authenticated"-permissivitet. crm_comms har
--   ingen eigarskap-kolonne, så eit smalare "berre eigne dokument"-utval er
--   ikkje mogleg utan ei skjemaendring, og vart eksplisitt ikkje ønska no.
--   MERK (Security Auditor-funn 2026-07-18, eksplisitt dokumentert her, ikkje
--   berre "teoretisk gjetbar sti"): denne policyen er BUCKET-VID, ikkje
--   kommentar-/kunde-avgrensa -- ein member kan kalle
--   `_sb.storage.from('crm-documents').list()` direkte og få EIN LISTE over
--   ALLE filstiar i heile bucket-en i eitt kall (ingen gjetting av den
--   tilfeldige stien nødvendig), og deretter hente ein signert URL for kva
--   som helst av dei. Dette er IKKJE ei ny eskalering samanlikna med resten
--   av CRM (crm_comms_select er alt like ope), men er ein meir direkte
--   tilgangsveg enn "gjetting" -- stadfesta akseptert av brukar, ikkje ein
--   attverande feil.
-- - Eksisterande CRM-dokument i den gamle, offentlege media-bucket-en vert
--   MEDVITE IKKJE migrerte -- dei held fram som før (vanlege offentlege
--   URL-ar). Berre NYE opplastingar går gjennom denne bucket-en (sjå
--   App.crmDocs i core.js sin "crmdoc:"-prefiks-skilnad).
--
-- Ingen ny Postgres-funksjon her (rein bucket + RLS på storage.objects), så
-- korkje ADR-0008 sin default-ACL-EXECUTE-fallgruve eller ADR-0009 sin
-- service_role-grant-fallgruve gjeld denne migreringa.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crm-documents', 'crm-documents', false,
  20971520,  -- 20 MB per fil, same tak som App.crmDocs.MAX_FILE_MB_REMOTE i core.js
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg', 'image/png', 'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "crm_documents_insert" ON storage.objects;
DROP POLICY IF EXISTS "crm_documents_select" ON storage.objects;
DROP POLICY IF EXISTS "crm_documents_delete" ON storage.objects;

CREATE POLICY "crm_documents_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crm-documents' AND can_edit_content());

CREATE POLICY "crm_documents_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'crm-documents');

CREATE POLICY "crm_documents_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'crm-documents' AND can_edit_content());

-- Ingen NOTIFY pgrst her (berre bucket/RLS, ingen funksjonsendring) -- inkludert
-- likevel per CLAUDE.md sin standardregel, harmlaust for eit reint RLS-pass.
NOTIFY pgrst, 'reload schema';
