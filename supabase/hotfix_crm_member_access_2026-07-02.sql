-- hotfix_crm_member_access_2026-07-02.sql
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard → SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- Context: earlier the same day, module-crm.js was given a client-side
-- roles:["admin","editor"] restriction after a Privacy/Compliance subagent
-- flagged that CRM had no role gating at all. That restriction was an
-- agent-inferred caution, not a user requirement, and has been reverted in
-- code. The user clarified: member should have normal CRM access (create/edit
-- customers, companies, customer actions, templates, snippets, signatures) —
-- the only exception is bulk CSV export, which stays admin/editor-only
-- (enforced client-side: hidden button + handler guard in module-crm.js,
-- honestly documented as NOT a real data-security boundary, since a member
-- with API access can already read the same underlying rows once this SQL
-- runs — see docs/security/security-baseline.md).
--
-- This grants member (and everyone else, unchanged for admin/editor) write
-- access to ONLY the four CRM-related store keys — NOT general store write
-- access. Every other key remains gated by can_edit_content() (admin/editor)
-- or is_admin_or_owner() (superconfig/wsp-orgdrift) as before.
--
-- SECURITY FIX (caught by security-review before this was ever run): the
-- original version of this hotfix used a single FOR ALL policy, which also
-- covers DELETE — that would have given member an unconditional right to
-- delete the ENTIRE customer/company/comms/settings blob for one REST call
-- (`DELETE FROM store WHERE key='crm-customers'`), not just create/edit.
-- Split into command-specific policies below so DELETE stays admin/editor-only
-- for all keys, including the CRM ones.
-- Idempotent: safe to run multiple times.

DROP POLICY IF EXISTS store_auth        ON store;
DROP POLICY IF EXISTS store_insert_auth ON store;
DROP POLICY IF EXISTS store_update_auth ON store;
DROP POLICY IF EXISTS store_delete_auth ON store;
CREATE POLICY store_insert_auth ON store FOR INSERT TO authenticated
  WITH CHECK (CASE
    WHEN key IN ('superconfig', 'wsp-orgdrift') THEN is_admin_or_owner()
    WHEN key IN ('crm-customers', 'crm-bedrifter', 'crm-comms', 'crm-settings') THEN true
    ELSE can_edit_content()
  END);
CREATE POLICY store_update_auth ON store FOR UPDATE TO authenticated
  USING (CASE
    WHEN key IN ('superconfig', 'wsp-orgdrift') THEN is_admin_or_owner()
    WHEN key IN ('crm-customers', 'crm-bedrifter', 'crm-comms', 'crm-settings') THEN true
    ELSE can_edit_content()
  END)
  WITH CHECK (CASE
    WHEN key IN ('superconfig', 'wsp-orgdrift') THEN is_admin_or_owner()
    WHEN key IN ('crm-customers', 'crm-bedrifter', 'crm-comms', 'crm-settings') THEN true
    ELSE can_edit_content()
  END);
CREATE POLICY store_delete_auth ON store FOR DELETE TO authenticated
  USING (CASE
    WHEN key IN ('superconfig', 'wsp-orgdrift') THEN is_admin_or_owner()
    ELSE can_edit_content()
  END);

NOTIFY pgrst, 'reload schema';
