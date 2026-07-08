# ADR-0008: Control-plane/data-plane split — dedicated Supabase project for the tenant registry

**Status:** Accepted (mechanism-proof completed)
**Date:** 2026-07-08

## Context

ADR-0007 settled the hosting/routing question (Vercel Routing Middleware resolves a request's `Host` header to the right tenant) and reaffirmed that each customer keeps their own Supabase project (data plane) — a shared multi-tenant database was already rejected on RLS-risk grounds. That still leaves an open question ADR-0007 explicitly deferred: **where does the hostname→tenant mapping itself live, and how does any future Console/onboarding automation act on a specific customer's data-plane project** (e.g. to invite a user, check status) without holding every customer's `service_role` key in one place unprotected?

Storing per-tenant `service_role` keys as plain columns in any table readable by the app's normal Postgres roles would defeat the entire point of per-customer project isolation — a single leaked row or misconfigured RLS policy would compromise every customer's data plane at once.

## Decision

**Stand up a dedicated Supabase project, `vibeverk-control` (ref `jxoglthrnshabqmdmnui`), as the control plane — separate from every customer's own data-plane project.** It holds only two tables:

- `tenants` — hostname(s), slug, public config mirror (colors/fonts/feature flags), `data_plane_url`, and a **reference** to a Vault secret (`data_plane_service_role_secret_id`), never the key itself.
- `operators` — Vibeverk staff/operator accounts (not customer users), gating who can act through the control plane.

**Secrets never live in a plain column.** Each tenant's data-plane `service_role` key is stored via Supabase Vault (`vault.create_secret`); the `tenants` row only holds the secret's UUID. A single `SECURITY DEFINER` function, `get_tenant_service_role_key(p_tenant_id)`, is the only way to decrypt it — and it is `REVOKE`d from `anon`/`authenticated`/`PUBLIC` explicitly (not just `PUBLIC` — see "Consequences" below), executable only by `service_role`/`postgres`.

**Cross-project actions go through a broker Edge Function**, mirroring the existing `supabase/functions/manage-user` two-client pattern (anon-key client validates the caller's identity/role; a service-role client performs the privileged action) — extended here so the "privileged action" crosses into *another* Supabase project's `service_role`, decrypted from Vault only inside the function, never returned to the caller. `broker-ping` is the first such function: a read-only mechanism-proof (operator auth → tenant lookup → Vault decrypt → cross-project `auth.admin.listUsers` call), not a real customer-management action.

**Anon-safe hostname resolution** is a separate, narrow RPC — `resolve_tenant_by_hostname(hostname)` — returning only the public fields a Vercel Routing Middleware request needs (explicit column list, never `SELECT *`, never the Vault reference or any operator data).

Repo layout: `supabase-control/` is a sibling directory to the existing `supabase/` (which stays linked to the production data-plane project, `clzczbyklgdtdhgjphup`, untouched by this work). Each has its own `supabase/migrations/` history. Because this CLI version's `db push`/`db query` don't support `--project-ref` (only `functions deploy` does), commands against `vibeverk-control` use an explicit `--db-url` pooler connection string rather than `supabase link`, so the two projects' local CLI link state never collide.

## Consequences

- **Real bug found and fixed during implementation, worth restating as a standing rule**: Supabase's platform sets default ACLs (`pg_default_acl`) granting `EXECUTE` on newly created functions directly to `anon`/`authenticated`/`service_role`, independent of `PUBLIC` — a migration that only runs `REVOKE ALL ... FROM PUBLIC` does **not** actually block `anon`. Every function in `vibeverk-control` (and any future control-plane function) must explicitly `REVOKE ALL ... FROM anon, authenticated` as well. This is the same underlying class of gotcha as CLAUDE.md's existing "explicit function signatures in REVOKE/GRANT" rule, just a different angle (default ACLs vs. ambiguous overload signatures) — CLAUDE.md's Supabase rules section has been updated to call this out directly.
- **This is a mechanism-proof, not a production dependency yet.** `broker-ping` is read-only and nothing in the live product (public site, Workspace, Console) reads from or writes to `vibeverk-control` today. Phase 8 (rebuilding Console to authenticate against the control plane and adding real broker actions beyond the ping) is a separate, not-yet-started effort.
- **Blast radius of a control-plane compromise is now different, not eliminated.** A leaked `vibeverk-control` `service_role` key would still expose every tenant's Vault-decrypted data-plane key via `get_tenant_service_role_key()` — Vault moves the secret out of a plain, broadly-readable column, but does not remove the control plane's own service_role key as a high-value target. Standard Supabase project-secret hygiene (never expose `SUPABASE_SERVICE_ROLE_KEY` to any client, rotate on suspected exposure) applies to `vibeverk-control` at least as strictly as to any customer data-plane project.
- **Operator accounts are a new, separate identity space from tenant `users` rows.** `operators.status = 'active'` gates `broker-ping` (and will gate future broker actions), independent of any customer's own `admin`/`editor`/`member` role model — deliberately, so control-plane access isn't accidentally tied to a specific customer's user table the way an earlier Console design mistake once was (see ADR-0004).
- **Needs a Security Auditor pass before any real (non-ping) broker action is added** — this ADR covers the mechanism-proof only. A real action (e.g. "invite a user into customer X's data plane from Console") multiplies the impact of any authorization bug at this layer across every customer at once, which is exactly the concentration-of-risk trade this architecture accepts in exchange for not storing keys in a shared table.
- Free-tier project-slot pressure: standing up `vibeverk-control` required pausing an unrelated pre-existing project (`campaign-studio`) to stay under the org's 2-free-project limit — not a design constraint of this architecture, just a today-constraint worth remembering if `campaign-studio` needs to resume later.

## Evidence

Architect-agent consultation (2026-07-08, read-only design review) preceding implementation. Live verification, not just clean CLI exit codes: `pg_policies`/`pg_default_acl`/`information_schema` checks confirming RLS, grants, and the anon-EXECUTE default-ACL bug; a real anon-key REST call against `resolve_tenant_by_hostname` (positive case + unknown-hostname negative case); a real operator login + `broker-ping` call against the live `clzczbyklgdtdhgjphup` project confirming `success: true` end-to-end, plus a negative-path check (missing Authorization header → 401) against the final, diagnostic-free deployed function.
