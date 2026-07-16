# Security Baseline

This document describes the technical security principles as verified from the Vibeverk codebase. It describes current safeguards, not aspirational goals. Each item reflects a pattern or constraint that is implemented or required in the code.

## Anon isolation

**Anon role NEVER gets direct `SELECT` on `chat_messages` or `chat_conversations`.**

This is the most critical security constraint in the codebase. Violating it would expose all chat history to any anonymous visitor who can construct a PostgREST query. All visitor access to chat data goes through SECURITY DEFINER RPCs, which validate ownership before returning any data.

## SECURITY DEFINER functions

All Supabase functions exposed to the anon role must be declared as:

```sql
CREATE OR REPLACE FUNCTION function_name(params)
RETURNS return_type
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$ ... $$;
```

- `SECURITY DEFINER` — function runs with the privileges of the function owner (postgres), not the calling role (anon). This allows the function to access tables that anon cannot access directly.
- `STABLE` — signals to PostgreSQL that the function does not modify data (for functions that only read).
- `SET search_path = public` — prevents search path injection attacks where a malicious schema shadows public tables.

## visitor_id model

`visitor_id` is a random string generated in the browser and stored in localStorage. It is not a cryptographic identity — it cannot be used to authenticate a user.

Every visitor-scoped RPC must validate that the provided `visitor_id` matches the stored `visitor_id` for the conversation being accessed. A visitor who presents someone else's `visitor_id` should be denied access. This validation must happen inside the RPC — never rely on the caller to self-certify ownership.

## RLS helper

The `is_admin_or_owner()` PostgreSQL function returns `true` when `auth.uid()` belongs to a user with role `owner` or `admin` in the `users` table. This helper is used in RLS policies for tables where write access requires elevated role.

The `store` table's RLS as defined in `supabase/migration.sql` (corrected 2026-07-02, see `docs/architecture/storage-and-data-flow.md` — confirmed live against the production project, see below): anon has `SELECT` on all rows (a separately-tracked finding, not a hard constraint), authenticated users have `SELECT` on all rows, and writes require `is_admin_or_owner()` for the `superconfig`/`wsp-orgdrift` keys, `can_edit_content()` (admin/editor) for most other keys, and a key-specific carve-out for exactly `crm-customers`/`crm-bedrifter`/`crm-comms`/`crm-settings` — needed for `member`'s normal CRM access (create/edit customers, companies, templates, snippets, signatures), see `docs/architecture/roles-and-tenants.md`. **Writes are no longer a single `store_auth FOR ALL` policy**: a security review during this round found that a single `FOR ALL` policy with the CRM carve-out set to `true` would also cover `DELETE`, unconditionally letting `member` wipe an entire CRM key (e.g. `DELETE FROM store WHERE key='crm-customers'`) in one REST call — far broader than the "create/edit customers" requirement. `store_auth` was therefore split into three command-specific policies: `store_insert_auth` and `store_update_auth` both carry the CRM-keys carve-out (`member` included), but `store_delete_auth` does **not** — `DELETE` on every key, including the four CRM keys, still requires `can_edit_content()` (admin/editor). `member` cannot write (insert/update) any `store` key outside the four CRM keys, and cannot delete any `store` key at all. **The authenticated-`SELECT` policy (`store_read_authenticated`), the `wsp-orgdrift` write carve-out, and the CRM-keys insert/update carve-out have all been run against production and confirmed** — see "SQL run against production" below for both rounds. Verified directly via `pg_policies`: `store_anon_read`/`store_read_authenticated` (SELECT), `store_insert_auth` (INSERT), `store_update_auth` (UPDATE) and `store_delete_auth` (DELETE) all exist as separate policies on `store`, with no `store_auth FOR ALL` policy remaining.

### SQL run against production, confirmed by user — 2026-07-02 role/access remediation

`supabase/hotfix_role_enforcement_2026-07-02.sql`, folded into `supabase/migration.sql`. Run manually by the user in the Supabase Dashboard SQL Editor against `clzczbyklgdtdhgjphup`, confirmed the same day.
- `wsp-orgdrift` added to `store_auth`'s admin-only key carve-out — the whole org-drift record is one JSON blob per `store` row, so RLS cannot distinguish "create" from "edit" inside it; the entire key is admin-only server-side (editor/member UI restrictions alone would not have been a real security boundary).
- `store_read_authenticated`: new SELECT policy restoring read access for all authenticated users, fixing the member-read regression above without weakening the write restriction.
- `media_insert` (Supabase Storage): now requires `can_edit_content()`, closing a gap where any authenticated user (including member) could upload directly via the Storage API regardless of UI restrictions. `media_delete` was already correctly gated.

### SQL run against production, confirmed — 2026-07-02 round 2 (CRM member access + tasks fully read-only)

Both files below are idempotent, folded into `supabase/migration.sql`, and were run against production via `npx supabase db query --linked --file <path>` after explicit user approval ("kjør"). Verified immediately afterward by querying `pg_policies` directly against production.

- `supabase/hotfix_crm_member_access_2026-07-02.sql`: splits the single `store_auth FOR ALL` policy into `store_insert_auth`/`store_update_auth`/`store_delete_auth`, adding a key-specific carve-out to the INSERT and UPDATE policies granting `member` (and everyone else, unchanged for admin/editor) write access to exactly `crm-customers`/`crm-bedrifter`/`crm-comms`/`crm-settings` — not general `store` write access, and **not** DELETE (`store_delete_auth` keeps `can_edit_content()` for all keys, including the CRM ones, specifically so `member` cannot bulk-delete a CRM key in one REST call). Reverts a same-day, agent-inferred `roles:["admin","editor"]` UI restriction on `module-crm.js` that was never a user requirement; see `docs/architecture/roles-and-tenants.md` for the full CRM-access caveat, including the honestly-documented limit of the CSV-export UI restriction (a technically capable `member` can already read equivalent data via the REST API, since `member` needs `SELECT` on these keys to edit at all). Confirmed live: `pg_policies` for `store` shows the three command-specific policies with no `FOR ALL` policy remaining.
- `supabase/hotfix_tasks_readonly_for_assigned_2026-07-02.sql`: narrows `tasks_assignee`'s UPDATE policy from `assigned_to = auth.uid() OR created_by = auth.uid()` to `created_by = auth.uid()` only, and simplifies `restrict_assignee_task_columns()` accordingly (the now-unreachable "status-only for assigned-by-others" branch removed). Tightens `hotfix_tasks_member_self_create_2026-07-02.sql` (already run against production), per user clarification that a task assigned to `member` by someone else must be fully read-only, not status-editable. Confirmed live: `pg_policies` shows `tasks_assignee` as a single UPDATE policy.

## REVOKE and GRANT

When granting execute permission to anon on an RPC:

1. Always REVOKE FROM PUBLIC first, with the explicit function signature:
   ```sql
   REVOKE EXECUTE ON FUNCTION function_name(text, text) FROM PUBLIC;
   ```
2. Then GRANT to anon:
   ```sql
   GRANT EXECUTE ON FUNCTION function_name(text, text) TO anon;
   ```

Using explicit signatures prevents accidental permission grants when function overloads exist. REVOKE FROM PUBLIC first ensures no unintended roles inherit access.

## NOTIFY after function changes

After any `CREATE OR REPLACE FUNCTION`:

```sql
NOTIFY pgrst, 'reload schema';
```

Without this, PostgREST will continue serving the old function definition from its schema cache until the next restart. This can cause security-critical functions to behave unexpectedly after a hotfix.

## Console authentication

**Superseded 2026-07-08 (Phase 8, `docs/decisions/ADR-0009-console-control-plane-auth-and-broker-actions.md`)** — corrected here 2026-07-16 after being found stale (this section still described the pre-Phase-8 model). Current model:

The Vibeverk Console uses OTP-based authentication against **`vibeverk-control`** (the control-plane Supabase project, ref `jxoglthrnshabqmdmnui`), not the customer's own project. Access requires:
1. `signInWithOtp({ shouldCreateUser: false })` is called **unconditionally** — there is no longer a client-side email allowlist checked before the OTP is sent. That pre-check was itself an unauthenticated "does this email have access" oracle and was removed for that reason; the same "code sent" response is returned regardless of whether the email is a real operator.
2. A valid OTP code, verified via Supabase against `vibeverk-control`.
3. **Only after OTP verification succeeds**: `operators.status = 'active'` is checked in `vibeverk-control`. A failed check signs the session back out immediately.

There is still no check against any customer/tenant's own `users` table — Console access is entirely a control-plane concept, consistent with `docs/decisions/ADR-0004-console-access-decoupled-from-tenant-role.md`'s original reasoning (only its specific mechanism, the pre-OTP allowlist, has changed).

The session is a real, live Supabase session against `vibeverk-control` (`_sbControl`, persistent with auto-refresh) — `isAuthed()` reflects this via `onAuthStateChange`, not a fixed-window timestamp. (A previously-documented bug — a 48-hour `localStorage` timestamp that could say "authenticated" long after the underlying session had actually expired — was fixed as part of this same Phase 8 change.)

All config reads/writes for the operator's picked tenant go through a `broker` Edge Function in `vibeverk-control` (an anon-key client confirms active-operator status, then a service-role client acts on the target tenant's own project via a Vault-decrypted key never returned to the caller); every action is written to `broker_audit_log` before returning. See `docs/architecture/roles-and-tenants.md` for the full current model.

This is still a browser-side JS session, not an httpOnly cookie — XSS on the console page would still expose it. **Not yet independently reviewed by a Security Auditor pass as of ADR-0009** (a named, acknowledged gap in that ADR) — see `docs/project/CURRENT_STATE.md`'s security-findings tracking for whether a later pass has since covered it.

## Web admin password

The web admin password (`config.js → admin.password`) is only reachable as an authentication path when Supabase isn't configured for the deployment at all (local/test environments). As of 2026-07-01 (`docs/decisions/ADR-0003-close-admin-auth-fallback.md`), any deployment with Supabase configured requires Supabase Auth (email + password) — the config password is never used as a fallback, even if the Supabase SDK transiently fails to load (that case now shows a retry prompt instead). For genuinely unconfigured local/test environments, the password remains purely client-side and untreated as a high-security credential — a known, accepted design constraint for that narrow case only.

## Roles

The `users` table only permits three roles (database CHECK constraint): `admin`, `editor`, `member`. An earlier `owner` role was removed (commit `2f8a92b`); references were cleaned up repo-wide 2026-07-01 (`docs/decisions/ADR-0006-remove-owner-role-references.md`). `is_admin_or_owner()` is a historically-named RLS helper that in practice only checks `role = 'admin'` — not renamed since many RLS policies reference it by name.

## Supabase anonKey

The anonKey is in `config.js` and is intentionally public. This is the standard PostgREST pattern: the anonKey identifies the project and grants access to the anon role, but all data access is controlled by RLS policies. The anonKey is not a secret. Keeping it out of the source code would provide no additional security if RLS is correctly configured.

## localStorage security model

localStorage is a working copy, not a security boundary. Data in localStorage can be read and modified by any JavaScript running on the page. The security model relies on:
- Supabase RLS policies enforced server-side
- SECURITY DEFINER RPCs that validate ownership before returning data
- JWT-based authentication for authenticated sessions (managed by Supabase Auth)

## HTML injection prevention

`components.js` provides `C.esc()` for HTML escaping. All module code that renders user-supplied values into HTML strings must use `C.esc()`.

Failure to escape a user-supplied value creates a stored XSS vector: a malicious visitor could submit a name or message containing `<script>` tags, which would execute in the browser of every admin who views the admin panel.

Required: `C.esc()` on every user-supplied value before it is inserted into an HTML string. This includes: visitor name, visitor email, message content, CRM fields, announcement content, KB article content, task titles and descriptions, file names, and any other value that originated outside the application.

## SQL idempotency

All SQL files (`migration.sql`, `hotfix_*.sql`) must be safe to run multiple times. Use `CREATE OR REPLACE`, `IF NOT EXISTS`, and `DROP ... IF EXISTS`. This prevents errors when the same migration is applied to an existing schema.

## Deployment safeguard

No `git push`, production deployment, Supabase SQL execution, or remote Supabase action may be performed without explicit user approval. The code assistant must propose the command and wait for confirmation before executing.
