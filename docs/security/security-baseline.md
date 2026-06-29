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

The `store` table uses an `auth_only` RLS policy: only `authenticated` role can read or write. Anon visitors have no access to the store table.

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

The Vibeverk Console uses OTP-based authentication (not password). After OTP validation, the session is stored as a 48-hour expiry timestamp in `localStorage["nordpunkt:console-auth"]`. Access to the console requires:
1. A valid OTP code sent to a known email address
2. The authenticated user having `role = 'owner'` in the `users` table

The console session is stored in localStorage, not in an httpOnly cookie. This is a known limitation — the session is accessible to JavaScript.

## Web admin password

The web admin password is stored in `config.js`, committed to git, and served as a public JS file. Authentication is purely client-side. This is a known design constraint (not a bug). The password is treated as a shared access code for the customer's staff rather than a high-security credential.

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
