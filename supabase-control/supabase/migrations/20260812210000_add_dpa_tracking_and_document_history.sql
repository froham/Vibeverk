-- Brukarønske 2026-08-12 ("gjer det ferdig" på DPA-arbeidet): to separate
-- ting.
--
-- 1. Signerings-sporing FOR KVAR KUNDE (dpa_sent_at/dpa_signed_at/
--    dpa_document_path på tenants) -- brukaren stadfesta eksplisitt at
--    signerte avtaler skal sporast i kontrollplanet/Console (Kundar-fana),
--    IKKJE i nokon Workspace (verken kunden sin eigen eller Vibeverk sin
--    eigen). Signeringsprosessen sjølv er manuell utanfor systemet (Word ->
--    PDF -> sendt til kunde for signatur) -- ingen e-signeringsintegrasjon.
--    Berre den SIGNERTE PDF-en (opplasta i etterkant) lagrast her.
--
-- 2. Lett versjonshistorikk på compliance_document (history jsonb) -- IKKJE
--    det fulle draft/publiser/godkjenn-maskineriet Personvern-dokumentet
--    har, brukaren bad eksplisitt om noko enklare ("Versjoneringsforslaget
--    er OK" til nettopp dette enklare forslaget): kvar gong innhaldet vert
--    lagra, snapshottast det FORRIGE innhaldet med tidsstempel, avgrensa til
--    siste 20 for å unngå ubunda vekst.
alter table tenants add column dpa_sent_at timestamptz;
alter table tenants add column dpa_signed_at timestamptz;
alter table tenants add column dpa_document_path text;

alter table compliance_document add column history jsonb not null default '[]'::jsonb;

-- Privat bøtte for signerte kunde-DPA-ar -- kontrollplanet, IKKJE kunden sitt
-- eige data-plane-prosjekt, sidan dette er Vibeverk sitt eige administrerte
-- forhold til kunden (same grunngjeving som resten av Compliance-arbeidet:
-- kunden har ingen Console-tilgang, Vibeverk administrerer på deira vegne).
-- Ingen storage.objects-RLS-policy for authenticated i det heile -- all
-- tilgang (opplasting OG nedlasting) går via tenant-admin-handlingar med
-- service_role, som genererer eit kortvarig signert URL for nedlasting i
-- staden for å opne bøtta for direkte klientlesing.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-dpa-documents', 'customer-dpa-documents', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
