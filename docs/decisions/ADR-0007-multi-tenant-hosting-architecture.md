# ADR-0007: Multi-tenant hosting architecture — reject fork-and-sync, migrate to edge-resolved config in phases

**Status:** Accepted
**Date:** 2026-07-06

## Context

Vibeverk's strategy (`docs/STRATEGY.md`) requires that a code change deployed once reaches every customer, and that onboarding customer N+1 not grow more expensive as N grows. The original plan was a single GitHub repo plus a single Supabase project serving all customers as true multi-tenant — this is why the `store` table still carries a vestigial `tenant_id` column (see CLAUDE.md's Supabase rules and `docs/architecture/roles-and-tenants.md`). The user confirmed this was ruled out by a combination of two constraints:

1. GitHub Pages binds only one custom domain per repository. Each customer needs their own real domain, not a subpath under one shared repo.
2. Keeping `tenant_id`-based RLS watertight across many customers in one shared Postgres database, exposed via PostgREST, was judged too risky to guarantee.

The resulting fallback — one repository fork plus one Supabase project per customer — is already the documented plan for the next customer (`docs/roadmap/ROADMAP.md` "Fase 2": new GitHub repo + Pages deploy + Supabase project). It solves the isolation problem but breaks the "deploy once, reach everyone" promise: today there is exactly one deployed instance (`hub/tenants.js` lists a single tenant), and no synchronization tooling exists at all (`.github/workflows/` contains only `test.yml`). A fork-per-customer model means every future shared-file fix — including security fixes — would need manual reapplication per customer fork, which is itself the kind of per-customer special-casing the strategy forbids, just relocated from code into git operations.

An Architect-agent investigation (read-only, no code changed) found supporting evidence: nearly every recent commit touches shared files (`core.js`, `module-*.js`, all four `index.html` entry points) together, and 23 `supabase/hotfix_*.sql` files were created in a single week (2026-07-01 through 2026-07-06), several fixing IDOR/RLS holes discovered during active development of the *current* single-tenant system. At this churn rate, "sync N customer forks after every shared-file commit" is not an occasional chore — it would be closer to a daily operational burden for a solo operator.

## Decision

**Reject fork-and-sync (git subtree/submodule/sync-bot across per-customer repo forks) as the long-term distribution strategy.** It optimizes the wrong layer, doesn't reduce operator burden as customer count grows, and has no tooling or lint today to prevent silent drift once a customer fork diverges (e.g. via bespoke tilbod-3 modules).

**Adopt a phased migration to an edge-hosting platform (e.g. Cloudflare Pages/Workers) that resolves customer configuration at request time from the `Host` header, instead of baking it into a per-repo static file at deploy time:**

- **Phase 0 (cheap, zero architecture risk):** Deploy the current, unmodified repo to Cloudflare Pages as a second host for the existing single tenant — same domain/SSL mechanics, same static `config.js`, same Supabase project. Proves the hosting-provider swap is a safe drop-in replacement for GitHub Pages before any code changes.
- **Phase 1 (separate, dedicated effort — not scoped by this ADR):** Make `config.js` loading asynchronous, resolved by the request's `Host` header via a Cloudflare Pages Function/Worker, instead of a synchronous `<script src="config.js">` baked into each repo. This touches `core.js` (the `window.SITE_CONFIG` read and an `App.ready` gate every module must wait on), every `module-*.js`/`intranet/module-*.js` IIFE, all four HTML entry points, and `console-core.js`'s write path (which currently writes tenant config to that tenant's own Supabase `store` table per repo). Config storage stays a flat file per tenant first — do not combine this with a "move config into Supabase" migration in the same step.
- **Phase 2 gate:** Only once Phase 1 is proven in production for the one real tenant does adding customer #2 become "drop a config file + add a DNS record" instead of "fork a repo." `docs/roadmap/ROADMAP.md`'s "Fase 2" (demo customer) should happen on this architecture, not as a throwaway fork — the demo customer is the cheapest available slot to validate the real target architecture for real, since there is no paying customer and no real stakes yet.
- **Permanent, independent of the above:** one Supabase project per customer is **not** reconsidered, regardless of hosting choice. The RLS risk on a shared database is judged higher today than before, given how many RLS/IDOR issues this session's own security remediation found even in the current single-tenant model (see `supabase/hotfix_*.sql`).

## Consequences

- The four HIGH security findings already tracked in `docs/roadmap/ROADMAP.md` "Current focus" (store anon-SELECT scope, write-policy over-permission, `chat_conversations` IDOR, `migration.sql` drift) still block Fase 2 regardless of which hosting path is chosen — this decision doesn't change that gate, and Phase 0 can start independently and in parallel with fixing them.
- Phase 1 touches `core.js`, the single highest-churn file in the repo, while it is also under active security remediation — it must be sequenced in isolation, not interleaved with unrelated feature work, and `test.js`/`test-intranet.js` must be extended to cover the async bootstrap path before it is relied on.
- The `Host`-header resolution mechanism is a new anon-facing security surface with no precedent in this codebase — resolving the wrong tenant would serve customer A's config (and potentially wire up customer A's Supabase project) to customer B's domain. This requires Security Auditor review before any second real customer depends on it; it is not a hosting detail.
- Migrating the *currently live* production tenant (vibeverk.no) to a new host/DNS is a real operational event (propagation, SSL reprovisioning) and should happen deliberately, only after Phase 0 has been stable for a period, not casually alongside other work.
- Genuinely open and not decided by this ADR: exact config-storage shape once it moves beyond a flat file (KV vs. Supabase vs. something else), and Cloudflare Pages Functions pricing/limits at eventual scale. These are small, deferred decisions to make when Phase 1 actually starts, not now.
- Tilbod-3 (bespoke module) customers are unaffected by this ADR's hosting question — they still require the customer to be on Workspace, and their `customModules` config mechanism (see `docs/STRATEGY.md`) works identically under either hosting model.

## Evidence

Architect-agent investigation (read-only, 2026-07-06): commit churn across `core.js`/`module-*.js`/HTML entry points; `hub/tenants.js` (single tenant registered); `.github/workflows/` (only `test.yml`, no deploy/sync automation); `supabase/hotfix_*.sql` (23 files, 2026-07-01 to 2026-07-06). `docs/roadmap/ROADMAP.md` "Fase 2" (existing fork-per-customer plan this ADR supersedes as the target, not the immediate next step). `docs/architecture/roles-and-tenants.md` (one-Supabase-project-per-customer rationale, unchanged and reaffirmed as permanent by this ADR). CLAUDE.md's Supabase rules section (vestigial `tenant_id` column, confirming the original multi-tenant intent).
