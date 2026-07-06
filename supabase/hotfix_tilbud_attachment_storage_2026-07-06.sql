-- =============================================================================
-- hotfix_tilbud_attachment_storage_2026-07-06.sql
-- -----------------------------------------------------------------------------
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- Funn (found via live browser testing 2026-07-06, "Bolk D" verification
-- pass): the Tilbud attachment-upload fix (0.16.0, `hotfix_tilbud_attachments_2026-07-06.sql`)
-- wires `App.media.putFile()` into the anonymous Tilbud submit flow, but
-- `storage.objects`'s "media_insert" policy requires `TO authenticated` +
-- `can_edit_content()` (admin/editor) -- an anonymous visitor can NEVER
-- satisfy that. Confirmed live: a real anonymous Tilbud submission with an
-- attached file fails with "Kunne ikke laste opp ett eller flere vedlegg" and
-- (correctly, fail-closed) never creates the lead at all. This is a genuinely
-- separate gap from the RPC/table-level fix -- Storage has its own RLS layer.
--
-- Scope of the fix: `Media.putFile()` (core.js) -- the shared generic-
-- attachment upload function used by Tilbud AND the Aktuelt/news post-
-- attachment feature -- always writes under the `files/` path prefix.
-- `Media.put()`/the image-upload path used by mediabank/Aktuelt IMAGES writes
-- to the bucket root (no `files/` prefix) and is deliberately NOT covered by
-- this policy -- only the generic-attachment path needs anon write access,
-- image uploads stay admin/editor-only as today.
--
-- Same trade-off already accepted elsewhere today (2026-07-06): anon can
-- already freely INSERT into `leads`/`bookings`/`chat_conversations`/
-- `chat_messages` via the new RPCs -- allowing anon to write into the
-- `files/` prefix specifically (not the whole bucket) is the same category
-- of trust, bounded by the bucket's own existing `file_size_limit` (20MB) and
-- `allowed_mime_types` allowlist (unchanged, already enforced regardless of
-- this policy). Spam/abuse-volume mitigation (rate limiting) is explicitly
-- out of scope here, same as it was for the leads/bookings RPCs.
--
-- Denne fila er også lagt inn i supabase/migration.sql.
-- =============================================================================

DROP POLICY IF EXISTS "media_insert_anon_attachments" ON storage.objects;
CREATE POLICY "media_insert_anon_attachments" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'media' AND name LIKE 'files/%');

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- MANUAL TEST REQUIRED AFTER RUNNING (per the live-test finding this fixes):
-- 1) As a genuine anonymous visitor (private browser window), submit Tilbud
--    with a real file attached -- confirm it now uploads successfully and the
--    lead is created with a real, working attachment link in the admin view.
-- 2) Confirm image uploads (mediabank/Aktuelt) still require admin/editor —
--    this policy only covers the `files/` prefix, not the bucket root.
-- =============================================================================
