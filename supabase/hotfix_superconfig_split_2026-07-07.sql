-- =============================================================================
-- hotfix_superconfig_split_2026-07-07.sql
-- -----------------------------------------------------------------------------
-- Splits the 'superconfig' store key into a public part (unchanged, must stay
-- anon-readable so an unauthenticated visitor's first page load gets theme/
-- feature-flag overrides) and a new 'superconfig-private' key (currently just
-- Console's "Nettside-admin (for kunden)" adminPassword override field).
--
-- Found 2026-07-07, during SaaS-scaling security reconciliation:
-- `superconfig.adminPassword` sat in plaintext inside the anon-readable
-- 'superconfig' key — any anonymous REST call with the public anon key
-- (`GET .../rest/v1/store?key=eq.superconfig`) returned it verbatim. ADR-0003
-- already made this value unreachable for actual login on any Supabase-
-- configured customer deployment, but the value itself was still exposed
-- regardless of whether the app ever used it, which is the actual problem
-- (password-reuse risk, general secret-hygiene).
--
-- This file is a RECORD of the one-time production fix already applied
-- (see docs/project/CHANGELOG.md 0.17.9) — the schema/RLS half is folded
-- into migration.sql directly (search 'superconfig-private'); this file's
-- own DDL is idempotent and safe to re-run, but the data-migration section
-- (extracting the existing plaintext value) is a one-time operation already
-- performed against production.
-- =============================================================================

-- ── Schema/RLS (idempotent, also present in migration.sql) ─────────────────
-- See migration.sql's "6. RLS" section for store_anon_read/
-- store_read_authenticated/store_insert_auth/store_update_auth/
-- store_delete_auth — all updated there to add 'superconfig-private' to the
-- anon-exclusion list and to the is_platform_operator()-gated branches.
-- Not repeated here to avoid two sources of truth for the same policies.

-- ── One-time data migration (already run against production 2026-07-07) ───
-- 1. Move the existing plaintext adminPassword value (if any) into the new
--    private key, preserving it exactly.
INSERT INTO store (tenant_id, key, value)
SELECT tenant_id, 'superconfig-private', jsonb_build_object('adminPassword', value->>'adminPassword')
FROM store
WHERE key = 'superconfig' AND value ? 'adminPassword'
ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value;

-- 2. Strip adminPassword out of the public superconfig blob — everything
--    else in it (theme, feature flags, privacy text, productMode, workspace
--    settings) stays exactly as-is and remains anon-readable by design.
UPDATE store SET value = value - 'adminPassword'
WHERE key = 'superconfig' AND value ? 'adminPassword';

NOTIFY pgrst, 'reload schema';

-- Verification used after running (see CHANGELOG for the actual output):
--   SELECT value FROM store WHERE key = 'superconfig-private';
--   SELECT value ? 'adminPassword' FROM store WHERE key = 'superconfig'; -- expect false
