# CLAUDE.md — Vibeverk

## Project overview

Single-tenant white-label website + Workspace (intern arbeidsflate). Vanilla JS, no bundler, no framework. Deployed via GitHub Pages (push to `main`). Supabase (PostgreSQL + PostgREST + Auth + Realtime) as backend.

## Repository layout

```
config.js            Customer identity, colours, fonts, feature flags — only file changed per customer
components.js        Pure functions returning HTML strings — no side effects, never customer-specific
core.js              App bootstrap, theme, section rendering, module registry (App.registerModule)
module-*.js          Self-contained IIFEs: booking, chat, crm, faq, mediabank, quote, references
index.html           Script loading order + cache-bust versions (?v=N)
workspace/           Separate Workspace SPA — workspace-core.js + workspace/module-*.js (renamed 2026-07-07, see docs/project/CHANGELOG.md — internal window.Intranet JS object name and intranettFeatures config key are unchanged, Tier 2, deferred)
supabase/
  migrations/        Real numbered migrations (since 2026-07-07) — deployable via `supabase db push`
  migration.sql      SUPERSEDED — frozen snapshot as of the 2026-07-07 baseline, not updated further
  hotfix_*.sql       Historical targeted fixes, all folded into the baseline migration — new fixes go in migrations/
  chat-tests.js      Browser-based chat integration tests (run in console while admin is logged in)
supabase-control/    SEPARATE Supabase project (control plane, ref jxoglthrnshabqmdmnui) — tenant registry + operators, see ADR-0008. Sibling to supabase/, own supabase/migrations/ history. Never linked via `supabase link` (would collide with supabase/'s link to clzczbyklgdtdhgjphup) — always pass --db-url (pooler connection string) for db push/db query, --project-ref jxoglthrnshabqmdmnui for functions deploy.
test.js              jsdom harness for public site
test-workspace.js    jsdom harness for Workspace (renamed 2026-07-07 from test-intranet.js)
.github/workflows/   CI: node test.js + node test-workspace.js on every push
```

## User-facing text

All labels, hints, tooltips, placeholders and confirm-dialog text must follow `docs/architecture/copy-style-guide.md` — plain, non-technical language, and the Tier A (routine) / Tier B (destructive) convention for save/delete communication. This applies across all three surfaces (public site/Web-admin, Workspace, Console).

**This is a standing, continuous requirement, not a one-off sweep** (the 2026-07-13 four-phase pass that introduced `copy-style-guide.md` was the initial catch-up, not a completed checklist). Whenever you add or change a form field, a save/delete/reset action, a confirm dialog, or any other user-facing string — as part of ANY task, however small — apply the style guide's rules to that text at the point of writing it, the same way cache-busting or test-passing is a standing expectation on every change, not something scheduled separately. A new non-obvious field gets a `hint`/`help`; a new destructive action gets Tier B copy; jargon gets caught before it ships, not in a later retrofit pass.

## Module conventions

- All modules are IIFEs: `(function () { "use strict"; ... })();`
- Read config via `window.SITE_CONFIG` and `window.SITE_CONFIG.features`
- Expose admin UI via `window.VwChatAdmin`, `window.CrmAdmin`, etc., or via `App.registerModule()`
- Workspace modules register via `window.Intranet.registerModule()` — the internal JS object name is still `Intranet` (deliberately not renamed yet, see repository-layout note above), do not "fix" this to `Workspace` without a coordinated pass across all `workspace/module-*.js` files
- Storage: `localStorage` namespaced with `storageKey` prefix (`nordpunkt:<key>`), Supabase as persistent store (write-through)
- **`storageKey: "nordpunkt"` must never be changed** — existing Supabase rows and localStorage data are keyed to it; renaming requires a full atomic data migration

## Cache busting

Bump `?v=N` on the script tag in `index.html` for every file you change. Only bump the files that actually changed.

## Versioning and changelog

- `docs/project/CHANGELOG.md` is the authoritative, repo-visible log of platform changes — one version number for the whole platform (site + Workspace + Console), semver-style `0.MINOR.PATCH` until real production launch (then `1.0.0`).
- Current version lives in `VIBEVERK_VERSION` in `console/console-core.js` and is displayed in Console (sidebar footer).
- **At the start of any non-trivial task**, read the last 2–3 entries in `docs/project/CHANGELOG.md` before making changes — this is how continuity across sessions and agents is maintained.
- **After a meaningful change**, add a new entry at the top of `docs/project/CHANGELOG.md` (date + what/why) and bump `VIBEVERK_VERSION`. Small experiments, pure Q&A, or reverted attempts don't need an entry.

## Documentation workflow

- `docs/README.md` is the map — start there when documentation context is needed; it defines the source-of-truth order (code/config/schema/tests → Git history → accepted ADRs → `docs/project/CURRENT_STATE.md` → architecture docs → changelog → roadmap-as-planning-only).
- Documentation is helpful context, not a substitute for inspecting actual code and configuration.
- For non-trivial tasks, inspect relevant `docs/architecture/` files, `docs/project/CURRENT_STATE.md` and accepted ADRs in `docs/decisions/` before implementation — and inspect the actual code before relying on what the docs claim.
- Keep implementation changes small and aligned with existing conventions.
- The Builder (this session) owns first-pass documentation updates: for meaningful completed changes, update the relevant docs and include a "Documentation impact" section in the completion summary.
- Never update roadmap priorities (`docs/roadmap/ROADMAP.md`) unless explicitly instructed. Never record an ADR without confirmed decision evidence — a code pattern existing is not, by itself, evidence of a decision.
- The **Project Historian** (`.claude/agents/vibeverk-project-historian.md`) is the documentation-consistency and change-history gate — invoke it after meaningful changes to verify docs actually match code/decisions, not just to have "something" updated.
- Auditors and reviewers (Codex Reviewer, Security Auditor, Privacy/Compliance Advisor, UX/Mobile Reviewer) must always inspect the Git diff and actual code first — never accept a documentation claim as proof that code or remote configuration is secure, correct, or compliant.
- Invoke the **Architect** (`.claude/agents/vibeverk-architect.md`) before major architecture, data-model or cross-module changes, in addition to the existing "before any medium or large feature" trigger.
- Use the reusable `vibeverk-handoff` skill after meaningful completed work (not after every tiny CSS or text tweak) to classify the change, confirm docs were updated, and route to the right review path.

## Testing

```
npm install        # installs jsdom (dev dep only)
node test.js       # public site — must pass
node test-workspace.js  # Workspace — must pass
```

CI runs both on every push. Both suites must be fully green (0 FEIL) — the two long-standing known-failing tests (`"henvendelses-fanen heter «Kontakt»"` in `test.js`, `"o3: workspaceship via direkterute"` in `test-workspace.js`) were fixed 2026-07-19: the first was a stale exact-match assertion that never accounted for the `.tab-badge` unread-count span `setTabBadge()` injects into the same button (a real feature, not a bug — the assertion now strips the badge text before comparing); the second tested a route (`#/workspaceship`) that no longer exists after the Fase 10 `customModules` rename to `spaceship` — removed as genuinely redundant, since the AA section's `aa2` already covers the same behavior correctly under the current name/config. Do not silently remove or skip failing tests going forward — if a new one appears, fix it or get explicit sign-off before treating it as an accepted baseline.

## Supabase rules

- SQL changes go to a new timestamped file in `supabase/migrations/` (create with `npx supabase migration new <name>`) — this is a real, deployable migration history since 2026-07-07 (baseline: `20260707000001_baseline_schema.sql`). `supabase/migration.sql` is superseded — a frozen snapshot, no longer updated; don't add new changes there.
- Supabase CLI is installed locally (`supabase` dev dependency); always invoke it as `npx supabase`. The local working copy is linked to project ref `clzczbyklgdtdhgjphup`
- **When passing multi-statement or multi-line SQL to `npx supabase db query`, always use `--file <path>` (write the SQL to a temp file first), never an inline string/heredoc argument.** Confirmed twice in practice (2026-07-07): inline multi-statement batches silently skip some statements, and inline multi-line single statements can silently drop clauses (e.g. `WITH CHECK`/`USING`) — both with no error surfaced. Always verify the actual result afterward (`pg_policy`, `pg_class.relacl`, a real `SELECT`) rather than trusting a clean exit code.
- **A Dashboard SQL Editor "Success" message only means the SQL had no syntax error — it does NOT confirm a specific migration actually ran, or ran against the intended project.** Confirmed 2026-07-08 (Phase 9, ADR-0010): a migration was reported as run and produced "Success," but had not actually applied — every dependent action failed until a direct `SELECT`/`pg_proc`/`information_schema.columns` check caught it. Whenever a user runs SQL manually via the Dashboard on your behalf, always follow up with an explicit, targeted verification query for the specific object created (function name, column name), not just "did it say Success."
- `npx supabase db push --linked` deploys pending migrations to the linked project (still requires explicit approval per the deployment safeguard below, same as any other remote Supabase action). For a **new** customer project, this is now the intended path to apply the full schema from scratch. For the **existing** production project (schema already matches the baseline), the baseline migration was marked applied via `npx supabase migration repair 20260707000001 --status applied --linked` rather than re-run — don't re-apply it.
- **`vibeverk-staging`** (ref `syqnyfeponexmkdvnsga`, created 2026-07-09): a dedicated staging Supabase project, mirroring production's schema (all 4 `supabase/migrations/` files applied and verified against it). Use this to test a new migration before it ever runs against a real customer project — same `--db-url` (pooler connection string) pattern as `supabase-control/`, since the local `supabase/` working copy stays linked to production (`clzczbyklgdtdhgjphup`) and `supabase link` is not repointed to staging. Always pass `--db-url` explicitly for staging, `--project-ref`/`--linked` for production — never assume which one a bare command targets.
- Edge Functions may be deployed from `supabase/functions/` with `npx supabase functions deploy <name> --project-ref clzczbyklgdtdhgjphup`, but only after the explicit approval required below
- After adding or replacing any function: `NOTIFY pgrst, 'reload schema';`
- All anon-facing functions must be `SECURITY DEFINER STABLE SET search_path = public`
- Use explicit function signatures in `REVOKE`/`GRANT`: `REVOKE EXECUTE ON FUNCTION f(text, text) FROM PUBLIC`
- **Supabase's platform default ACLs (`pg_default_acl`) grant `EXECUTE` on every newly created function directly to `anon`/`authenticated`/`service_role`, independent of `PUBLIC`.** `REVOKE ALL ... FROM PUBLIC` alone does NOT strip this — confirmed 2026-07-08 (see ADR-0008) via a real function that stayed anon-executable despite that revoke. Always explicitly `REVOKE ALL ON FUNCTION f(...) FROM anon, authenticated` (or whichever roles must not call it) as its own statement, and verify via `pg_default_acl`/a real anon-key call, not just a clean migration exit code. **This default is NOT consistent across projects** — confirmed 2026-07-19: a function relying on this default for `service_role` EXECUTE worked on `vibeverk-staging` but the identical migration left `service_role` WITHOUT execute on production (`clzczbyklgdtdhgjphup`), caught live via `has_function_privilege('service_role', ...)` immediately after deploy, not assumed. Likely tied to when each project was created (see this file's own note above about `auto_expose_new_tables` being a deprecated, changing default). **Never rely on this default for `service_role` — always add an explicit `GRANT EXECUTE ON FUNCTION f(...) TO service_role;`** alongside the `REVOKE ... FROM anon, authenticated`, and verify on the SPECIFIC target project, not just "it worked on staging."
- Anon must never get direct `SELECT` on `chat_messages` or `chat_conversations`
- The `store` table keeps `tenant_id` for backward compatibility — all other chat tables are single-tenant
- Per-tenant `service_role` keys (control-plane `tenants.data_plane_service_role_secret_id`, see ADR-0008) are never stored as plain columns — always via `vault.create_secret`, decrypted only inside a `SECURITY DEFINER` function callable solely by `service_role`/`postgres`
- **`service_role` bypasses RLS (`BYPASSRLS`) but is NOT a superuser and gets NO automatic table/sequence grants beyond that.** Confirmed 2026-07-08 (see ADR-0009): production's `store` table had never granted `service_role` `SELECT`/`INSERT`/`UPDATE`/`DELETE` (only `REFERENCES`/`TRIGGER`/`TRUNCATE`) because nothing had ever needed it before — the new control-plane broker's cross-project write was the first consumer to hit this. Also: an `UPSERT ... ON CONFLICT` needs sequence `USAGE` (e.g. `store_id_seq`) even when the final action is an `UPDATE`, since the `INSERT` branch's `DEFAULT nextval(...)` is still evaluated. Before any new `service_role` consumer (an Edge Function, a cross-project broker) touches an existing table, check its actual grants via `information_schema.role_table_grants` — don't assume `service_role` already has access.

## Deployment safeguard

**No `git push`, production deployment, or remote Supabase action may happen without explicit user approval.** Propose the command, wait for the user to confirm, then run it.

## AI agent workflow

- Run **Vibeverk Security Auditor** before considering security-sensitive changes ready for merge or deployment.
- Run **Privacy and Compliance Advisor** before launch of any feature that collects, stores, shares, analyses or exposes personal data.
- Run **UX and Mobile Reviewer** after meaningful UI, module, modal, layout or responsive changes — its checklist includes checking new/changed user-facing text against `docs/architecture/copy-style-guide.md`, not just visual/responsive quality.
- Security-sensitive changes include: authentication, roles, permissions, superadmin access, Supabase RLS, storage, file sharing, APIs, webhooks, third-party integrations, payment-related integrations and customer data.
- Privacy drafts must match verified functionality and confirmed customer facts — never invent data flows.
- No agent may claim legal compliance or security assurance solely based on AI review.
- **No `git push`, deployment, remote Supabase changes or production changes without explicit user approval.**

## Known configuration

- Production Supabase project: `clzczbyklgdtdhgjphup`
- Admin access: triple-click footer or `#admin` in URL, password in `config.js → admin.password`
- Workspace login: Supabase Auth (email + password); role (`admin`/`editor`/`member`) governs what's visible after login, not whether login succeeds. Admin/editor/member management UI requires role `admin`.
- Console login (as of Fase 8, 2026-07-08): OTP against `vibeverk-control` (the control plane, ref `jxoglthrnshabqmdmnui`), not the customer's own project — see ADR-0009. Access is gated by `operators.status = 'active'` in that project, checked *after* OTP verification (not a client-side email-list pre-check). All config reads/writes go through the `broker` Edge Function there, never a direct client write to the customer's own `store` table.
- Vercel Routing Middleware (`middleware.js`, repo root, Phase 6 mechanism-proof) must be named `middleware.js`, never `middleware.mjs` — confirmed empirically 2026-07-08 that Vercel's `Framework Preset: Other` build pipeline silently fails to compile `.mjs` into an actual middleware function (no build error, no warning), contradicting Vercel's own docs, which present `.mjs` as a documented equivalent to `"type": "module"`. Do not "fix" this back to `.mjs` because the docs say it should work — see `docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md`'s 2026-07-08 addendum.
