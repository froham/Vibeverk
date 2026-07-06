-- =============================================================================
-- hotfix_tilbud_attachments_2026-07-06.sql
-- -----------------------------------------------------------------------------
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- Funn (2026-07-04/06 audit, "Bolk D"): Tilbud (quote) file attachments were
-- never actually uploaded. `module-quote.js`'s submit handler only ever put
-- `f.name + " (" + formatBytes(f.size) + ")"` into the lead's message text
-- -- the real `File` objects picked in step 1 (`st.files`) were never passed
-- to `App.media.putFile()` or any upload call anywhere in the file. Fixed in
-- the client (module-quote.js now awaits Promise.all() over putFile() calls
-- before creating the lead) -- this file is the matching schema change: a
-- new `attachments jsonb` column on `leads`, storing an array of
-- `{name, ref, type, size}` objects (same shape `App.media.putFile()` already
-- returns, and the same shape CRM's document-attachment field already uses).
--
-- Idempotent (`ADD COLUMN IF NOT EXISTS`, safe default `'[]'::jsonb`) --
-- existing leads without attachments are unaffected.
--
-- Denne fila er også lagt inn i supabase/migration.sql.
-- =============================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
