-- Ny, eigen Storage-bucket for karusell-video-slides (module-carousel.js, 2026-07-19).
--
-- IKKJE ei utviding av den eksisterande `media`-bucketen: `media` sin `files/`-
-- prefiks er den same prefiksen den anonyme, kvote-styrte tilbods-vedlegg-
-- flyten (anon-media-upload-token, 20260719124203_anon_media_upload_quota.sql)
-- har lov til å skrive til. Å utvide `media` sin storleiksgrense/MIME-liste
-- for video ville OGSÅ opna den anonyme, kvote-styrte flyten for video --
-- ei uønska og ikkje-vurdert kopling. Speglar same grunngjeving som
-- 20260718113648_crm_documents_bucket.sql (eiga bucket for eit nytt
-- bruksområde, ikkje den delte offentlege media-bucketen).
--
-- v1-scope (avklart med brukar): berre video/mp4, 20 MB per fil (same
-- grense som biletbucketen) -- stille/ambiente korte produktvideoar.
-- GIF og bilete dekkjast alt av den eksisterande media-bucketen sin
-- allowed_mime_types (image/gif er alt der) -- ingen endring trengst der.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media-video', 'media-video', true,
        20971520,
        ARRAY['video/mp4'])
ON CONFLICT (id) DO NOTHING;

-- Berre authenticated admin/editor kan laste opp/slette -- dette er
-- admin-kuratert marknadsføringsinnhald, ALDRI besøkjande-innsendt, so det
-- finst ingen anonym opplastingsveg å skjerme her (strengare enn `media`
-- sin files/-karve-ut for anonyme tilbods-vedlegg).
CREATE POLICY "media_video_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'media-video' AND can_edit_content());
CREATE POLICY "media_video_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'media-video' AND can_edit_content());
-- Ingen eigen SELECT-policy trengst -- public:true-bucketar serverer lesing
-- via den offentlege URL-en utan å gå via storage.objects sin RLS, same som
-- `media` i dag.

NOTIFY pgrst, 'reload schema';
