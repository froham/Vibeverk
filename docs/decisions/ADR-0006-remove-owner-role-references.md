# ADR-0006: Remove lingering "owner" role references; admin/editor/member is the complete role model

**Status:** Accepted
**Date:** 2026-07-01

## Context

While investigating the Console access bug fixed in ADR-0004 (a user with `role = "admin"` was denied Console access because the old check required exactly `role = "owner"`), the user asked directly whether `"owner"` still exists as a role at all.

Investigation confirmed it does not: `supabase/migration.sql`'s CHECK constraint only permits `role IN ('admin', 'editor', 'member')`. The role model was simplified to these three roles in an earlier commit (`2f8a92b`, "forenkla rollemodell til admin/editor/member"; the actual removal was carried out via `supabase/hotfix_roles.sql`, which converted existing `owner` rows to `admin` and updated the constraint and RLS helper functions). However, references to `owner` as if it were still a live, assignable role were left scattered across the codebase and documentation:

- **A real, user-facing bug**: `module-users.js` (web-admin user management) still offered `owner` as a selectable role in its invite/edit dropdowns, and had logic to hide/protect "owner" accounts. Selecting `owner` there would have failed against the database CHECK constraint. `intranet/module-users.js` (the Workspace equivalent) had already been correctly updated to admin/editor/member only — the two files had drifted apart.
- **A fail-open default**: `core.js`'s `onAuthStateChange` handler defaulted a failed role lookup to `"owner"` (highest trust) rather than least privilege.
- **Redundant but harmless comparisons**: several places compared `role === "owner" || role === "admin"`, which can never evaluate differently from `role === "admin"` alone since `owner` cannot exist in the database — code that reads as testing something it cannot actually test.
- **Documentation and comments**: `docs/architecture/roles-and-tenants.md`, `README.md`, `docs/security/security-baseline.md`, `docs/architecture/storage-and-data-flow.md`, and the `.codex/agents/vibeverk-security-auditor.toml` audit prompt all described `owner` as a current, valid role, and in places (README.md, security-baseline.md) described the pre-ADR-0004 Console access model as requiring it.

The `is_admin_or_owner()` SQL helper function's name is also historical (it only ever checks `role = 'admin'` today) but was **not** renamed — it's referenced by name in multiple RLS policies in `migration.sql`, and renaming it safely would require its own coordinated migration (drop/recreate function, update every referencing policy) run manually in the Supabase Dashboard. This is deferred as a separate, optional future cleanup, not bundled into this pass.

`intranet/module-orgdrift.js`'s many uses of "owner" are unrelated — a data field for "who's responsible for this system/vendor" in the org-drift module, not a role or permission concept. Not touched.

## Decision

Treat `admin`/`editor`/`member` as the complete, current role model everywhere. Specifically:
- Fixed `module-users.js` to stop offering `owner` as an assignable role (matching the already-correct `intranet/module-users.js`).
- Changed the fail-open `"owner"`/`"admin"` role-lookup-failure defaults to `"member"` (see also ADR-0005, same principle applied to the intranet login).
- Simplified all `role === "owner" || role === "admin"` comparisons to `role === "admin"` (`core.js`, `intranet/module-tasks.js`, `intranet/module-announcements.js`, `intranet/module-kb.js`, `intranet/module-links.js`).
- Updated documentation and the security-auditor prompt to describe the actual, current role model and to explain the historical `is_admin_or_owner()` naming rather than presenting it as accurate.
- Left `is_admin_or_owner()`'s name unchanged (cosmetic, deferred — see above).

## Consequences

- Closes a genuine bug: nobody can be silently offered a role assignment that the database will reject.
- Removes a fail-open security default in favor of fail-closed.
- Future readers of the code, docs, or security-auditor findings won't be misled into thinking a fourth, higher-privilege role exists or is checked anywhere.
- If a role above `admin` is wanted in the future (e.g. a true one-per-tenant "business owner" tier), that requires a new, deliberate product decision and its own ADR — this ADR does not propose or preclude that, it only aligns the codebase with the decision already made in `2f8a92b`/`hotfix_roles.sql`.

## Evidence

`supabase/migration.sql` (CHECK constraint, `is_admin_or_owner()`), `supabase/hotfix_roles.sql` (the original removal), `module-users.js`, `core.js`, `intranet/intranet-core.js`, `intranet/module-tasks.js`, `intranet/module-announcements.js`, `intranet/module-kb.js`, `intranet/module-links.js`, `docs/architecture/roles-and-tenants.md`, `docs/security/security-baseline.md`, `docs/architecture/storage-and-data-flow.md`, `README.md`, `.codex/agents/vibeverk-security-auditor.toml`.
