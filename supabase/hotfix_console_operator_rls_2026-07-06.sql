-- =============================================================================
-- hotfix_console_operator_rls_2026-07-06.sql
-- -----------------------------------------------------------------------------
-- Prepared, NOT executed against production yet. Run manually in Supabase
-- Dashboard -> SQL Editor (or `npx supabase db query --linked --file ...`)
-- only after explicit user approval, per CLAUDE.md.
--
-- REQUIRES the paired console/console-core.js client change described at the
-- bottom of this file to actually take effect end-to-end — read that section
-- before running this against production.
--
-- Funn (2026-07-06 audit): the `superconfig` store-key write policy checks
-- is_admin_or_owner() -- i.e. "does the caller have a public.users row with
-- role='admin' in THIS customer's own database" -- which has nothing to do
-- with Console's actual authorization model (SUPERADMIN_EMAILS allowlist +
-- verified OTP, see ADR-0004). Two consequences of this mismatch, discussed
-- with the user 2026-07-06:
--   1. Any of a CUSTOMER'S OWN regular admin users can write `superconfig`
--      directly via REST, entirely bypassing Console -- RLS doesn't know
--      Console exists.
--   2. Console's OWN OTP-verified session is, today, never actually used to
--      authorize the write at all: console-core.js calls App.store.set(),
--      which queues a write that core.js's _flushSync() only sends if
--      core.js's OWN, separately-persisted Supabase client (_isAuthed) has a
--      session -- a completely different client instance than the one that
--      just verified the OTP (console-core.js's own `_sb` is created with
--      `persistSession: false` specifically for OTP verification, and is
--      never otherwise used). In practice, superconfig writes only succeed
--      today because the operator's browser also happens to carry a
--      persisted tenant-admin session from a separate Web-admin/Workspace
--      login (or the operator's own account also has role='admin' in this
--      one customer's users table, per ADR-0004's own note).
--
-- Explicitly rejected approach: requiring is_admin_or_owner() (a tenant-role
-- row) for the operator would reintroduce exactly the scaling problem
-- ADR-0004 already solved once -- "every new customer needs a manually
-- provisioned operator row in ITS OWN users table" does not scale to many
-- customers. The fix below instead mirrors SUPERADMIN_EMAILS itself (an
-- email allowlist, checked via the operator's own verified Supabase Auth
-- JWT), matching the *actual* authorization model Console already uses at
-- the page-access layer -- just enforced at the database layer too.
--
-- Scaling notes (as discussed with the user):
--   - This does NOT require a public.users/role row per customer (unlike the
--     rejected approach) -- only a plain Supabase Auth user (auth.users) for
--     the operator's email in each customer's project, so that
--     `signInWithOtp({ shouldCreateUser: false })` has an account to send a
--     code to at all. That's the same one-time, lightweight step every new
--     customer already needs regardless of this fix.
--   - The allowlist below is a literal list, same shape as SUPERADMIN_EMAILS
--     in console-core.js -- adding a teammate later means updating BOTH (one
--     shared code file, redeployed to every customer; one SQL statement run
--     against each EXISTING customer's own database -- new customers get it
--     for free from the template). This is consistent with how every other
--     hotfix in this project already gets applied (manual, per-project,
--     explicit approval) -- not a new operational pattern, just naming it.
--   - `wsp-orgdrift` is a DIFFERENT, unrelated store key (Workspace's
--     tenant-internal "org drift" feature, intranet/module-orgdrift.js,
--     written by the CUSTOMER'S OWN admin/editor, never by Console) --
--     it deliberately keeps is_admin_or_owner() unchanged below. Only
--     `superconfig` (the one key Console itself writes) changes.
--
-- Denne fila er også lagt inn i supabase/migration.sql.
-- =============================================================================


-- ── 1. Operatør-allowlist (spegel av SUPERADMIN_EMAILS i console-core.js) ────
-- MERK: hald denne lista synkronisert med SUPERADMIN_EMAILS manuelt -- det
-- finst ingen automatisk kopling mellom JS-fila og denne SQL-funksjonen.

CREATE OR REPLACE FUNCTION is_platform_operator()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(auth.jwt()->>'email', '') IN (
    'frode@hammerseth.com'
    -- Legg til fleire e-postar her, kommaseparert, når fleire utviklarar treng
    -- Console-tilgang. Hugs å oppdatere SUPERADMIN_EMAILS i console-core.js
    -- samstundes (den listar kven som ser Console-innlogginga i det heile;
    -- denne listar kven som faktisk får skrive superconfig i databasen).
  );
$$;


-- ── 2. Superconfig-skriving krev operatør-identitet, ikkje tenant-rolle ─────

DROP POLICY IF EXISTS store_insert_auth ON store;
DROP POLICY IF EXISTS store_update_auth ON store;
DROP POLICY IF EXISTS store_delete_auth ON store;

CREATE POLICY store_insert_auth ON store FOR INSERT TO authenticated
  WITH CHECK (CASE
    WHEN key = 'superconfig'  THEN is_platform_operator()
    WHEN key = 'wsp-orgdrift' THEN is_admin_or_owner()
    WHEN key IN ('crm-customers', 'crm-bedrifter', 'crm-comms', 'crm-settings') THEN true
    ELSE can_edit_content()
  END);

CREATE POLICY store_update_auth ON store FOR UPDATE TO authenticated
  USING (CASE
    WHEN key = 'superconfig'  THEN is_platform_operator()
    WHEN key = 'wsp-orgdrift' THEN is_admin_or_owner()
    WHEN key IN ('crm-customers', 'crm-bedrifter', 'crm-comms', 'crm-settings') THEN true
    ELSE can_edit_content()
  END)
  WITH CHECK (CASE
    WHEN key = 'superconfig'  THEN is_platform_operator()
    WHEN key = 'wsp-orgdrift' THEN is_admin_or_owner()
    WHEN key IN ('crm-customers', 'crm-bedrifter', 'crm-comms', 'crm-settings') THEN true
    ELSE can_edit_content()
  END);

CREATE POLICY store_delete_auth ON store FOR DELETE TO authenticated
  USING (CASE
    WHEN key = 'superconfig'  THEN is_platform_operator()
    WHEN key = 'wsp-orgdrift' THEN is_admin_or_owner()
    ELSE can_edit_content()
  END);

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- REQUIRED CLIENT CHANGE (console/console-core.js) -- DO NOT RUN THIS FILE
-- AGAINST PRODUCTION UNTIL THIS IS DONE, since after this file runs, a
-- customer's own tenant-admin session (what App.store.set() currently relies
-- on for the write to go through at all) will be REJECTED for 'superconfig'
-- -- only a request carrying the operator's own OTP-verified JWT will pass.
--
-- saveSC() must write DIRECTLY via console-core.js's own `_sb` client (the
-- one already holding the operator's verified session in memory after
-- verifyOtp(), currently unused for anything past that one call) instead of
-- going through App.store.set() (which queues the write for core.js's
-- SEPARATE, persisted-session client -- a different identity entirely).
-- getSC() / read access does NOT need to change: 'superconfig' stays
-- anon-readable via store_anon_read (only the five already-migrated private
-- keys are denylisted there), so the existing localStorage-hydration read
-- path keeps working unchanged.
--
-- Sketch (verify exact current saveSC() shape in console-core.js before
-- applying -- this is a sketch, not a diff):
--
--   function saveSC(sc) {
--     App.store.set(SUPER_KEY, sc); // held lokal cache i sync med det same
--     if (!_sb) return;             // ingen Supabase konfigurert -- uendra åtferd
--     _sb.from("store").upsert(
--       { tenant_id: NS, key: SUPER_KEY, value: sc },
--       { onConflict: "tenant_id,key" }
--     ).then(function (r) {
--       if (r.error) console.error("[console] superconfig-skriving feila:", r.error);
--     });
--   }
--
-- Manual test required after the client change, before running this file:
-- 1) Log into Console via OTP as the operator, change a color/font, save --
--    confirm it persists (reload Console, value should stick).
-- 2) AFTER running this file: log into that SAME customer's Web-admin as a
--    regular tenant admin (not via Console/OTP) and attempt a raw REST PATCH
--    to store?key=eq.superconfig -- must now be rejected (permission denied),
--    where it previously would have succeeded.
-- 3) Re-confirm Console itself can still save successfully after the SQL is
--    live (step 1 again).
-- =============================================================================
