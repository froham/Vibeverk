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

## Addendum (2026-07-09): tenant picker's read path was never actually tenant-aware — found via the Phase 6 canary tenant

The sidebar tenant picker mentioned in the Decision section ("cheap now, avoids a second Console rewrite at customer #2") turned out to only be half-wired. Customer #2 arriving for real (the Phase 6 canary tenant, `phase6-canary`) surfaced it immediately: picking that tenant in the sidebar and editing its settings silently showed and appeared to save the *real* `vibeverk` tenant's values instead.

**Root cause, confirmed by reading the code (Architect-consulted before fixing, given the cross-cutting nature)**: `getSC()` never went through `broker` at all — it read `App.store`, a local cache populated once at page load by `core.js`'s own hydration of whichever project *Console's own* `config.js` pointed at (always the real `vibeverk` tenant, since Console is served at `vibeverk.no/console/`). This had nothing to do with `_activeTenant`. `saveSC()` *did* correctly route the actual write through `brokerCall("set_config", ...)` (respecting `_activeTenant`), but also kept writing to that same local cache as a side effect — polluting the real tenant's cached display with whatever was just edited for a different tenant. This was a reasonable simplification when Phase 8 shipped (only one tenant existed, so "the cache's tenant" and "the picked tenant" were always the same project) — it just was never revisited once a second tenant became real.

**Fix (Architect-designed, Option B of two considered)**: read `superconfig` directly from the browser via a plain anon-key REST call against whichever tenant is picked (`_activeTenant.data_plane_url`/`data_plane_anon_key`), bypassing `broker` entirely for this read. `superconfig` is *intentionally* anon-readable via `store_anon_read` RLS (so an anonymous site visitor's page still renders the right theme) — routing a read that's meant to be public through `broker`'s privileged cross-project/audit-logged path would misuse a control built for elevated access, and require a backend redeploy for no isolation benefit. This mirrors the exact pattern `core.js` itself already uses to read its own tenant's config. New `getStoreKey(key, cb)` helper (tenant-scoped, cached client per tenant id) backs both `getSC()` and the fix below; `renderSection()`'s dispatcher and 5 submit handlers converted from a synchronous to an async read (a generation-token guards against a stale callback writing into a `#cs-section-wrap` that now belongs to a different section/tenant). `saveSC()`'s and `resetSC()`'s local-cache side effects removed — they no longer serve any purpose and were part of the same confusion.

**A second, more serious bug found while scoping this fix, not part of the original ADR**: `renderAnalyse` (Plausible analytics settings) used `App.store.get/set("analytics", ...)` directly — not just non-tenant-aware like `getSC()`, but **never actually reaching Supabase for any tenant, including the real one**. `App.store`'s write-through is gated on `_isAuthed`, which is only ever set by a `signInWithPassword` against a tenant's own project — something Console never does (it only authenticates against `vibeverk-control`). Every analytics edit from Console was silently lost on reload, for the one real customer, since this mechanism existed. Fixed the same way as `superconfig`: `"analytics"` added to `broker`'s `ALLOWED_CONFIG_KEYS`, reads via the new `getStoreKey`, writes via `brokerCall("set_config", ...)`.

**Not fixed in this pass, flagged as a follow-up**: `resetSC()` calls `location.reload()` after a successful reset, and `loadTenants()`'s completion resets `_activeTenant` to the alphabetically-first tenant — so resetting a non-primary tenant's config silently switches the operator back to viewing a different tenant with no indication that happened. Needs the picked tenant id persisted (e.g. `sessionStorage`) and restored on reload; small, separate, not required for the fix above.

No backend/Supabase changes needed for the `superconfig` fix itself (`store_anon_read` already permits the new read pattern). The `analytics` fix requires a `broker` redeploy (new allowed key) — not yet deployed as of this addendum, pending explicit approval per the standing deployment safeguard.
