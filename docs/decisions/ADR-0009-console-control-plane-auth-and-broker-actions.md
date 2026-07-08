# ADR-0009: Console authenticates against the control plane; first real broker actions

**Status:** Accepted (shipped and verified live)
**Date:** 2026-07-08

## Context

ADR-0008 stood up `vibeverk-control` as the control plane and proved the cross-project broker pattern with a single, read-only mechanism-proof (`broker-ping`). Console itself still authenticated the operator directly against the one real customer's own Supabase project (OTP against `clzczbyklgdtdhgjphup`, gated by a hardcoded `SUPERADMIN_EMAILS` list checked client-side before the code was even sent) and wrote configuration directly into that project's `store` table via its own Supabase client.

This is Phase 8 of the SaaS-scaling plan: move Console's authentication to the control plane, and add the first real (non-ping) broker actions Console needs to keep working once that move happens.

**Load-bearing finding that shaped the whole implementation** (surfaced by the Architect subagent during design): Supabase JWTs are project-scoped. The moment Console's login moves to `vibeverk-control`, the resulting JWT can never satisfy `is_platform_operator()`'s check in the tenant's own project — that check inspects `auth.jwt()->>'email'`, and the JWT is now signed by a different project. This is cryptographic, not a permissions setting to adjust. **Auth-move and write-path-move are therefore not independently shippable** — they had to land as one release.

## Decision

**Console now authenticates via OTP against `vibeverk-control`, not the customer's own project.** Concretely:

- A new `_sbControl` Supabase client (persistent session, auto-refresh) replaces the old per-tenant `_sb` client for everything Console does.
- The client-side `SUPERADMIN_EMAILS` pre-check (run *before* the OTP code was even sent) is removed — it was an unauthenticated string-match that could double as an "does this email have access" oracle. `signInWithOtp({ shouldCreateUser: false })` is now called unconditionally with the same "code sent" response regardless of whether the email is real, and the actual access check — `operators.status = 'active'` in `vibeverk-control` — happens *after* OTP verification succeeds. A failed check signs the session back out immediately.
- A tenant picker was added to Console's sidebar even though only one tenant exists today — cheap now, avoids a second Console rewrite at customer #2.
- A real, previously-documented bug is fixed as part of the same rewrite (touching the exact same code): the old 48h `localStorage` timestamp could say "authenticated" long after the underlying session had actually expired. `isAuthed()` now reflects a real, live Supabase session via `onAuthStateChange`.

**All config reads/writes now go through a new `broker` Edge Function in `vibeverk-control`**, extending the two-client pattern from `broker-ping`/`manage-user`: an anon-key client validates the caller is an active operator; a service-role client then acts on the *target tenant's own project*, using a Vault-decrypted key, never returned to the caller. Four actions, deliberately scoped:

- `get_private_config` / `set_config` — read/write `superconfig`/`superconfig-private` in the tenant's `store` table. `set_config` only accepts these two key names (explicit allowlist), never an arbitrary caller-supplied key.
- `reset_config` — deletes both keys, restoring `config.js` defaults.
- `get_tenant_status` — extends `broker-ping`'s mechanism-proof into something Console can actually show (reachability, user count).

Every action writes to a new `broker_audit_log` table (control plane) before returning, success or failure — readable by any active operator, writable only by the broker's own service-role connection (no `authenticated` INSERT/UPDATE/DELETE policy exists at all). Audit entries never contain secret values, only that an action happened.

**Explicitly deferred, not built here**: inviting/removing a data-plane user via the broker. That overlaps a still-open, not-yet-decided question (should Console give an operator a scoped, audit-logged "support session" into a customer's own admin UI, versus nothing at all) that needs Privacy/Compliance input, not just Security review — building it now would have quietly pre-empted that decision.

## A second real bug found during implementation

Live testing (not just a clean deploy) immediately surfaced that **`service_role` had never been granted `SELECT`/`INSERT`/`UPDATE`/`DELETE` on the production `store` table** — only `REFERENCES`/`TRIGGER`/`TRUNCATE`, confirmed via `information_schema.role_table_grants`. This was harmless until now: nothing had ever needed `service_role` access to `store`, since Console previously wrote via the customer's own OTP-authenticated `authenticated` client. The broker's cross-project write is the first thing that ever exercised this path. A follow-up gap in the same vein: an `UPSERT ... ON CONFLICT` evaluates the `INSERT` branch's `DEFAULT nextval(store_id_seq)` even when the final action is an `UPDATE`, so `service_role` also needed sequence `USAGE`, not just table grants — this only surfaced once the table grant was already fixed and a real write was attempted.

Both fixed via new migrations in `supabase/migrations/` (the **production** project, not `supabase-control/`): `20260708192115_grant_service_role_store_access.sql` and `20260708194415_grant_service_role_store_seq.sql`. Verified directly via `information_schema.role_table_grants`, not just a clean `db push` exit code, per this repo's standing discipline.

**General lesson, worth restating alongside Phase 7's default-ACL gotcha**: `service_role` is not a superuser and does not implicitly have table-level access just because it bypasses RLS — `BYPASSRLS` and ordinary Postgres `GRANT`/`REVOKE` are separate mechanisms. Any new cross-project service-role consumer of an existing table needs its grants checked explicitly, not assumed.

## Consequences

- **This was a bigger single release than it might look**, exactly as the Architect flagged before implementation: new audit table + broker Edge Function + two production grant fixes + a full Console auth/write-path rewrite, all landing together because the auth-move/write-path-move coupling left no smaller shippable unit.
- **Blast-radius concentration, already named in ADR-0008, stops being theoretical here.** `set_config`/`get_tenant_status` are the first real (non-ping) actions behind `vibeverk-control`'s service_role key — a bug in this layer's authorization now has impact multiplied across every tenant behind it, not just one.
- **The audit log's read scope will need revisiting once a second operator exists.** Today any active operator can read the full cross-tenant audit history; fine for a solo operator, not indefinitely.
- **Needs a Security Auditor pass before being relied on for anything beyond the current single customer** — not yet done as of this ADR. Specifically: the enumeration-avoidance login change, audit-log tamper-resistance (confirmed no write policy exists for `authenticated`, but worth independent verification), and the explicit `anon`/`authenticated` REVOKEs on every new function per the Phase 7 default-ACL gotcha.
- `reset_config` was **not** tested live against production (deliberately — it deletes real configuration) and was only verified by code inspection and by sharing its exact code path with the now-proven `set_config`/`get_private_config` actions (same table, same grants, same query shape).
- Nothing in the live product outside Console depends on any of this — the public site, Workspace, and the production project's own auth model are all unaffected.

## Evidence

Architect-agent design consultation (2026-07-08, read-only) preceding implementation, including the JWT-project-scoping finding that determined the whole shape of this change. Live verification against real production data throughout, not clean exit codes: a real OTP login as the operator, `get_tenant_status` returning the real user count, a `get_private_config` → `set_config` → `get_private_config` round-trip proving the write path works and leaves the value unchanged, and negative-path checks (missing Authorization header → 401, unknown action → clean 400, not a crash) against the final, diagnostic-free deployed function. The two service_role grant gaps were each found by a real 500 error during this live testing, root-caused via a temporary error-detail exposure (removed before the final deploy), and confirmed fixed via direct `information_schema.role_table_grants` queries against production.
