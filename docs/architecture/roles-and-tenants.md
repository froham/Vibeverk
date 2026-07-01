# Roles and Tenants

## Tenant isolation

Vibeverk provides complete tenant isolation via the one-Supabase-project-per-customer model. Each customer gets their own Supabase project with a separate PostgreSQL database. There is no shared database between customers, and no row-level tenant filtering is needed on most tables (the `store` table is an exception — it retains a `tenant_id` column for backward compatibility but functions as single-tenant in practice).

This model means:
- A breach of one customer's data does not affect any other customer.
- Each customer's Supabase project has its own anonKey, service role key, and URL.
- The Vibeverk Console can configure each customer's deployment independently by writing to that project's `store` table.

## Roles in the users table

Authenticated workspace users have a role stored in the `users` table:

| Role | Access |
|---|---|
| `owner` | Full access to all intranet modules including settings and user management. The owner row is visible to the owner themselves. The owner's role cannot be changed by anyone else. |
| `admin` | Can manage users (except the owner), edit content, change user roles up to and including `admin`. Sees settings and user management modules. |
| `editor` | TBD — not fully implemented across all modules. Intended for content editing without full admin access. |
| `member` | Read access in the workspace. Cannot change content or manage users. |

## is_admin_or_owner() RLS helper

The Supabase function `is_admin_or_owner()` returns `true` when the currently authenticated user (`auth.uid()`) has a role of `owner` or `admin` in the `users` table. This function is used in RLS policies for tables that require admin or owner access to write (tasks, announcements, KB articles, links, etc.).

Private notes use a different check: `user_id = auth.uid()` — notes are visible only to the user who created them.

## The three admin surfaces

### 1. Web admin (`/#admin`)

- **Authentication:** Static password from `config.js → admin.password`. Checked client-side in JavaScript.
- **Access method:** Triple-click the footer, or append `#admin` to the URL, then enter the password.
- **Authorization:** Binary — either you have the password or you do not. No role-based access control. No Supabase Auth.
- **Scope:** All web admin module panels registered via `App.registerModule()`. Can manage content (booking slots, FAQ, references, quotes, mediabank), see chat admin, manage CRM, adjust site settings.
- **Security note:** The password is in `config.js`, which is committed to git and served publicly. This is a known design constraint. The password is intended to be shared with the customer's staff rather than treated as a high-security secret.

### 2. Workspace / Intranet (`/intranet/`)

- **Authentication:** Supabase Auth (email + password). Session persists across page loads via Supabase session storage.
- **Access method:** Log in at `/intranet/` with a registered email and password.
- **Authorization:** Role-based. Role is read from the `users` table after login. Owner and admin see the settings and user management modules. All roles see the workspace content.
- **Session:** Managed by Supabase Auth. Calling `_sb.auth.signOut()` clears the session. Role is fetched from `users` table after successful auth state change.
- **Boot guard:** `productMode: "web"` blocks intranet boot entirely.

### 3. Vibeverk Operator Console (`/console/`)

- **Authentication:** Two-step OTP flow. Step 1: enter email, checked against a hardcoded `SUPERADMIN_EMAILS` allowlist before an OTP is even sent. Step 2: Supabase sends an 8-digit code to that email. User enters the code. Supabase Auth validates it.
- **Access control:** Being on `SUPERADMIN_EMAILS` plus a successfully verified OTP is the complete authorization — no tenant-role lookup. As of 2026-07-01 (`docs/decisions/ADR-0004-console-access-decoupled-from-tenant-role.md`), Console explicitly does **not** check the customer's `users` table at all; the Vibeverk operator is not a customer user and doesn't need a role in any tenant's database.
- **Session:** A 48-hour expiry timestamp is stored in `localStorage["nordpunkt:console-auth"]`. Every console action should verify this timestamp has not expired.
- **Scope:** Vibeverk operator only. Used to set `productMode`, override feature flags, set workspace colors and fonts, inspect deployment configuration, and write to `superconfig` in the Supabase store.
- **Security note:** The session is stored in localStorage as a timestamp, not in an httpOnly cookie. This means the session is accessible to JavaScript running on the page. XSS on the console page would expose the session.

## productMode and surface access

| productMode | Public site | Intranet |
|---|---|---|
| `"web"` | Enabled | Blocked at boot |
| `"workspace"` | Blocked at boot | Enabled |
| `"full"` | Enabled | Enabled |

productMode is read from `superconfig` in the Supabase `store` table. It is set by the Vibeverk Console. It is never read from `config.js` defaults (doing so would block test harness execution in environments without Supabase).
