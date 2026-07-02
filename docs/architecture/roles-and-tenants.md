# Roles and Tenants

## Tenant isolation

Vibeverk provides complete tenant isolation via the one-Supabase-project-per-customer model. Each customer gets their own Supabase project with a separate PostgreSQL database. There is no shared database between customers, and no row-level tenant filtering is needed on most tables (the `store` table is an exception — it retains a `tenant_id` column for backward compatibility but functions as single-tenant in practice).

This model means:
- A breach of one customer's data does not affect any other customer.
- Each customer's Supabase project has its own anonKey, service role key, and URL.
- The Vibeverk Console can configure each customer's deployment independently by writing to that project's `store` table.

## Roles in the users table

Authenticated workspace users have a role stored in the `users` table. The database enforces exactly three roles via a CHECK constraint (`supabase/migration.sql`): `role IN ('admin', 'editor', 'member')`.

| Role | Access |
|---|---|
| `admin` | Full access: manage users, edit content, change roles, sees settings and user management modules. Highest role today. |
| `editor` | Content editing (`can_edit_content()` — tasks, announcements, KB, links, most `store` keys, media upload/delete) without user management or `superconfig`/org-drift access. |
| `member` | Read access in the workspace. Cannot change content or manage users. |

## Workspace module permission matrix (verified 2026-07-02)

Enforced in both UI (hidden controls) and handlers (reject unauthorized direct calls) — UI hiding alone is never treated as the security boundary; see the Supabase RLS notes below each row for what's actually enforced server-side.

| Action | admin | editor | member | Server-side enforcement |
|---|---|---|---|---|
| Dashboard: "Ny oppgave" quick action | yes | yes | yes — opens the create flow only, self-assigned/unassigned (see caveat below) | `tasks_self_create` RLS (new, see caveat) |
| Dashboard: "Ny kunngjering"/"Ny KB-artikkel" quick actions | yes | yes | no | via the module's own create-path RLS |
| Dashboard: "Nytt notat" | yes | yes | yes | `notes` RLS: `user_id = auth.uid()` |
| Tasks: create a new task for self (unassigned or self-assigned) | yes | yes | **yes** (corrected 2026-07-02 — see caveat below) | `tasks_self_create` RLS: `created_by = auth.uid() AND (assigned_to = auth.uid() OR assigned_to IS NULL)` |
| Tasks: create/assign a task to someone else | yes | yes | no | `tasks_admin` RLS: `can_edit_content()` only |
| Tasks: fully edit (title/description/due date) a task they **created themselves** | yes | yes | **yes** (corrected 2026-07-02 — see caveat below) | `restrict_assignee_task_columns()` trigger: unrestricted when `OLD.created_by = auth.uid()`, except reassignment (below) |
| Tasks: edit a task **assigned to them by someone else** (not self-created) | yes | yes | no — status-only via the row `<select>`, `openTaskModal()` blocks opening the edit modal | `restrict_assignee_task_columns()` trigger: only `status` may change unless `can_edit_content()` |
| Tasks: reassign any task to a different user | yes | yes | **no, never** — not even on a task they created themselves | trigger blocks `assigned_to` changes to anyone but self unless `can_edit_content()` |
| Tasks: change status on own assigned/created task | yes | yes | yes (via the row status `<select>`, or the full edit modal for self-created tasks) | `tasks` RLS: assignee/creator `WITH CHECK` + trigger |
| Internal media bank (`module-mediabank-internal.js`): read/search/download | yes | yes | yes | public Storage bucket (`media`), read is not RLS-gated |
| Internal media bank: upload/delete | yes | yes | no — upload UI hidden, `startUpload()`/delete handler no-op for member | `storage.objects` `media_insert`/`media_delete` policies require `can_edit_content()` (see `docs/project/CURRENT_STATE.md` — run against production and confirmed by user 2026-07-02) |
| Org drift (`module-orgdrift.js`): read | yes | yes | yes | `store` SELECT (see storage-and-data-flow.md) |
| Org drift: create/edit/delete a card | yes | **no** | no | `store_auth` policy: `wsp-orgdrift` key is admin-only (`is_admin_or_owner()`), same carve-out as `superconfig` — run against production and confirmed by user 2026-07-02 (`docs/security/security-baseline.md`) |
| CRM ("Kunder"): view module at all | yes | yes | **no** | client-side only (`Intranet.registerModule({..., roles:["admin","editor"]})`, matching `module-users.js`'s existing `roles:["admin"]` pattern) — see caveat below |

**CRM access caveat (added 2026-07-02, discovered during Privacy/Compliance review):** `module-crm.js`'s Workspace registration previously had no `roles` restriction at all — any logged-in role, including `member`, could view customer records (name/email/phone/notes/communication log). This is now gated to `admin`/`editor` via the existing `roles` mechanism (nav hiding + route-level block in `intranet-core.js`'s `handleRoute()`). **This is a client-side/route boundary only** — it does not, by itself, stop a `member` from reading CRM data (`crm-customers`/`crm-bedrifter`/`leads` keys in the `store` table) via a direct Supabase REST call, because `store_anon_read` already grants full `SELECT` on the entire `store` table to the *anon* role (a separate, already-documented CRITICAL finding — see `docs/project/CURRENT_STATE.md` "Still open"). The `store_read_authenticated` policy (run against production and confirmed by the user 2026-07-02) extends that same unrestricted `SELECT` to any *authenticated* role too — it does not make the underlying finding worse (anon already had full read), but it is a second, now-authenticated-and-attributable path to the same gap. Fixing the underlying issue properly requires the already-planned architecture change (splitting public config from private customer data into separate tables/keys) — not addressed in this pass.

**Tasks self-create/self-edit caveat (corrected 2026-07-02, after two rounds of user clarification):** the task spec this matrix was originally built from said member should not be able to create tasks at all. The user corrected this in two steps: (1) member should be able to create a task for themselves, just not assign one to someone else; (2) member should also be able to *fully edit* (title/description/due date, not just status) a task they created themselves — the earlier fix had gone too far and blocked editing entirely. The final rule, implemented in `intranet/module-tasks.js` and enforced server-side by `restrict_assignee_task_columns()`:
- A task **created by the member themselves** (`created_by = auth.uid()`): full edit rights (title/description/due date/status), via `openTaskModal()`'s edit modal (row click or edit pencil, both now shown/allowed for own tasks) — but the assignee field stays read-only (`canAssignTasks()` gates it to admin only), so they can never redirect it to someone else.
- A task **assigned to the member by someone else** (`created_by` is not them): unchanged from the 2026-07-01 security fix — status-only via the row `<select>`; `openTaskModal()` refuses to open the edit modal for it at all (`canEditTask()` helper).
- **No non-admin/editor user can ever set `assigned_to` to a different user**, regardless of whether they created the task — enforced first in the trigger, independent of the create-vs-assigned-to-me distinction above.

**Server-side enforcement — run against production and confirmed 2026-07-02**: a broadened `tasks_assignee` UPDATE policy (now matches `created_by = auth.uid()` too, not just `assigned_to`), the new `tasks_self_create` INSERT policy, and a rewritten `restrict_assignee_task_columns()` trigger implementing the three rules above. All three are in `supabase/hotfix_tasks_member_self_create_2026-07-02.sql` (also folded into `supabase/migration.sql`), run via `npx supabase db query --linked` and verified against `pg_policies`/`pg_proc` in production the same session.

**Why editor is read-only for org drift, not just blocked from "Ny":** the entire org-drift record (people/responsibilities/vendors/systems/purchasing) is stored as one JSON blob under a single `store` key (`wsp-orgdrift`). Row-level security operates per-row, not per-JSON-field, so it cannot distinguish "editor is creating a new card" from "editor is editing an existing card" within that blob — there is no way to grant one and deny the other at the database level. Rather than rely on UI-only gating for "edit" (which the server would silently accept from any `can_edit_content()` user, undermining the admin-only "create" restriction the task required), the whole key was made admin-only. This is a deliberate, documented widening of scope beyond "hide the Ny button for editor" — confirmed necessary by inspecting the actual `store_auth` policy in `supabase/migration.sql`, not assumed.

**Note on "owner":** an earlier design had a fourth role, `owner`, above `admin`. It was removed in commit `2f8a92b` ("forenkla rollemodell til admin/editor/member") and is **not** a valid value in the current database — but references lingered in code comments, `is_admin_or_owner()`'s name, and a UI bug in `module-users.js` (which offered "owner" as an assignable role option that would have failed the DB constraint if selected). Cleaned up 2026-07-01 — see `docs/decisions/ADR-0006-remove-owner-role-references.md`. If a tier above `admin` is wanted in the future, that would be a new, deliberate product decision (its own ADR), not a restoration of the old value.

## is_admin_or_owner() RLS helper

The Supabase function `is_admin_or_owner()` returns `true` when the currently authenticated user (`auth.uid()`) has a role of `admin` in the `users` table. The name is historical (predates the role simplification above) — it is **not** renamed because many RLS policies reference it by name; renaming would require a coordinated migration. This function is used in RLS policies for tables that require admin access to write (tasks, announcements, KB articles, links, etc.).

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
