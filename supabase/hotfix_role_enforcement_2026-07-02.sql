-- hotfix_role_enforcement_2026-07-02.sql
-- Prepared, NOT executed against production. Run manually in Supabase Dashboard
-- → SQL Editor only after explicit user approval, per CLAUDE.md.
--
-- Context: 2026-07-02 role/access remediation pass. UI-level role gating
-- (member/editor restrictions in intranet/module-dashboard.js, module-tasks.js,
-- module-mediabank-internal.js, module-orgdrift.js) is NOT a security boundary
-- on its own — these two RLS/policy changes close the matching server-side gaps.
-- Idempotent: safe to run multiple times.
--
-- 1) store: 'wsp-orgdrift' (Organisasjon & drift) is a single JSON blob per
--    key — RLS cannot distinguish "create a new card" from "edit an existing
--    card" inside that blob. The whole key is made admin-only, matching the
--    existing 'superconfig' carve-out. Editor/member become read-only for
--    orgdrift at the database level (not just hidden in the UI).
--
-- 2) storage.objects 'media_insert': previously allowed ANY authenticated
--    user to upload into the 'media' bucket (no role check at all), even
--    though 'media_delete' already correctly required can_edit_content().
--    Member could bypass the UI (which now hides upload controls) via a
--    direct Storage API call. Brought in line with media_delete.
--
-- 3) DISCOVERED while touching this policy, not originally in scope: store_auth
--    is a FOR ALL policy, so its USING clause also governs SELECT, not just
--    writes. With only can_edit_content() in USING, a "member" (not
--    admin/editor) could not SELECT their own store rows at all (e.g. their
--    own dashboard shortcuts) — likely an unintended side effect of the
--    2026-07-01 security hotfix, which was only meant to restrict writes.
--    store_read_authenticated below restores SELECT for all authenticated
--    users (Postgres ORs multiple permissive policies for the same command)
--    without weakening store_auth's write restriction.

DROP POLICY IF EXISTS store_auth ON store;
DROP POLICY IF EXISTS store_read_authenticated ON store;
CREATE POLICY store_read_authenticated ON store FOR SELECT TO authenticated USING (true);
CREATE POLICY store_auth ON store FOR ALL TO authenticated
  USING      (CASE WHEN key IN ('superconfig', 'wsp-orgdrift') THEN is_admin_or_owner() ELSE can_edit_content() END)
  WITH CHECK (CASE WHEN key IN ('superconfig', 'wsp-orgdrift') THEN is_admin_or_owner() ELSE can_edit_content() END);

DROP POLICY IF EXISTS "media_insert" ON storage.objects;
CREATE POLICY "media_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND can_edit_content());

NOTIFY pgrst, 'reload schema';
