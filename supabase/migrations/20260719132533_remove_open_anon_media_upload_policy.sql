-- Fjernar den opne anon-INSERT-policyen på media-bucket-en sitt "files/"-
-- prefiks (Tilbod-skjemaet sine vedlegg). Denne policyen let ein scripta
-- åtakar laste opp direkte via .upload() med berre anon-nøkkelen, HEILT
-- UTANOM den nye kvote-gata anon-media-upload-token Edge Function-en (sjå
-- 20260719124203_anon_media_upload_quota.sql) -- kvoten var difor til no
-- berre eit vedlegg til den opne vegen, ikkje ei reell sperre.
--
-- Empirisk stadfesta trygt å fjerne, 2026-07-19, direkte mot vibeverk-
-- staging (ikkje berre anteke): med denne policyen mellombels fjerna,
-- (1) eit direkte anon .upload()-kall feila korrekt med RLS-avvising, OG
-- (2) den signerte opplastings-token-flyten frå Edge Function-en fungerte
-- FRAMLEIS heilt normalt. Dette stadfester at Supabase sin signert-
-- opplastings-URL-mekanisme autoriserer via sjølve tokenet (utferda av
-- ein service_role-klient etter ein godkjent kvotesjekk), IKKJE via denne
-- RLS-policyen -- akkurat den uvissa Arkitekten uttrykkeleg bad om å
-- stadfeste før dette steget, sjå docs/project/CHANGELOG.md 0.55.0.
--
-- Etter denne migrasjonen er anon-media-upload-token-funksjonen DEN EINASTE
-- vegen inn for anonyme opplastingar til "files/%" i media-bucket-en.
DROP POLICY IF EXISTS "media_insert_anon_attachments" ON storage.objects;

NOTIFY pgrst, 'reload schema';
