# CLAUDE.md — Vibeverk

## Project overview

Single-tenant white-label website + intranet. Vanilla JS, no bundler, no framework. Deployed via GitHub Pages (push to `main`). Supabase (PostgreSQL + PostgREST + Auth + Realtime) as backend.

## Repository layout

```
config.js            Customer identity, colours, fonts, feature flags — only file changed per customer
components.js        Pure functions returning HTML strings — no side effects, never customer-specific
core.js              App bootstrap, theme, section rendering, module registry (App.registerModule)
module-*.js          Self-contained IIFEs: booking, chat, crm, faq, mediabank, quote, references
index.html           Script loading order + cache-bust versions (?v=N)
intranet/            Separate intranet SPA — intranet-core.js + intranet/module-*.js
supabase/
  migration.sql      Full schema (idempotent) — run manually in Supabase Dashboard SQL Editor
  hotfix_*.sql       Targeted fixes — also run manually
  chat-tests.js      Browser-based chat integration tests (run in console while admin is logged in)
test.js              jsdom harness for public site
test-intranet.js     jsdom harness for intranet
.github/workflows/   CI: node test.js + node test-intranet.js on every push
```

## Module conventions

- All modules are IIFEs: `(function () { "use strict"; ... })();`
- Read config via `window.SITE_CONFIG` and `window.SITE_CONFIG.features`
- Expose admin UI via `window.VwChatAdmin`, `window.CrmAdmin`, etc., or via `App.registerModule()`
- Intranet modules register via `window.Intranet.registerModule()`
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
node test-intranet.js  # intranet — must pass
```

CI runs both on every push. Known-failing tests (pre-existing, unrelated to current work):
- `"henvendelses-fanen heter «Kontakt»"` (test.js — tab label mismatch)
- `"o3: workspaceship via direkterute"` (test-intranet.js — workspace redirect test)

All other tests must remain green. Do not silently remove or skip failing tests.

## Supabase rules

- SQL changes go to `supabase/migration.sql` (idempotent) and, if urgent, to a `hotfix_*.sql`
- Supabase CLI is installed locally (`supabase` dev dependency); always invoke it as `npx supabase`. The local working copy is linked to project ref `clzczbyklgdtdhgjphup`
- Existing `migration.sql`/`hotfix_*.sql` files are standalone Dashboard scripts, not timestamped files under `supabase/migrations/`; do not claim `supabase db push` will deploy them. Run them manually in Dashboard until a migration conversion is explicitly approved
- Edge Functions may be deployed from `supabase/functions/` with `npx supabase functions deploy <name> --project-ref clzczbyklgdtdhgjphup`, but only after the explicit approval required below
- After adding or replacing any function: `NOTIFY pgrst, 'reload schema';`
- All anon-facing functions must be `SECURITY DEFINER STABLE SET search_path = public`
- Use explicit function signatures in `REVOKE`/`GRANT`: `REVOKE EXECUTE ON FUNCTION f(text, text) FROM PUBLIC`
- Anon must never get direct `SELECT` on `chat_messages` or `chat_conversations`
- The `store` table keeps `tenant_id` for backward compatibility — all other chat tables are single-tenant

## Deployment safeguard

**No `git push`, production deployment, or remote Supabase action may happen without explicit user approval.** Propose the command, wait for the user to confirm, then run it.

## AI agent workflow

- Run **Vibeverk Security Auditor** before considering security-sensitive changes ready for merge or deployment.
- Run **Privacy and Compliance Advisor** before launch of any feature that collects, stores, shares, analyses or exposes personal data.
- Run **UX and Mobile Reviewer** after meaningful UI, module, modal, layout or responsive changes.
- Security-sensitive changes include: authentication, roles, permissions, superadmin access, Supabase RLS, storage, file sharing, APIs, webhooks, third-party integrations, payment-related integrations and customer data.
- Privacy drafts must match verified functionality and confirmed customer facts — never invent data flows.
- No agent may claim legal compliance or security assurance solely based on AI review.
- **No `git push`, deployment, remote Supabase changes or production changes without explicit user approval.**

## Known configuration

- Production Supabase project: `clzczbyklgdtdhgjphup`
- Admin access: triple-click footer or `#admin` in URL, password in `config.js → admin.password`
- Intranet login: Supabase Auth (email + password); role (`admin`/`editor`/`member`) governs what's visible after login, not whether login succeeds. Admin/editor/member management UI requires role `admin`.
