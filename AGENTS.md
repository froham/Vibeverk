# AGENTS.md — Vibeverk

## Project overview

Single-tenant white-label website + intranet. Vanilla JS IIFEs, no bundler, no framework. GitHub Pages for hosting. Supabase (PostgreSQL + PostgREST + Auth + Realtime) as backend.

## Before proposing any change

Read the relevant module file first. Check how similar functionality is already implemented. Match existing patterns — do not introduce new patterns, abstractions or dependencies without a specific reason.

## Repository layout

```
config.js            Customer config only — only file changed per customer
components.js        Pure HTML-string helpers, no side effects
core.js              Bootstrap, App.registerModule(), theme application
module-*.js          IIFEs: booking, chat, crm, faq, mediabank, quote, references
index.html           Script load order + cache-bust ?v=N on every changed file
intranet/            Separate intranet SPA — intranet-core.js + intranet/module-*.js
supabase/migration.sql   Full schema — idempotent, run in Supabase Dashboard SQL Editor
test.js              jsdom harness: node test.js
test-intranet.js     jsdom harness: node test-intranet.js
```

## Coding conventions

- Modules: IIFE, `"use strict"`, `var` declarations, named functions — no class syntax, no arrow functions in module code
- Read config: `window.SITE_CONFIG`, `window.SITE_CONFIG.features`
- localStorage namespace: `window.SITE_CONFIG.storageKey` prefix — currently `"nordpunkt"`
- Supabase client: `window.App.supabase` (authenticated) or the module-level `_sb` variable
- Cache busting: bump `?v=N` in `index.html` for every changed module — only bump files that changed

## Hard constraints

| Constraint | Reason |
|---|---|
| `storageKey: "nordpunkt"` must not be renamed | Existing Supabase rows and localStorage entries are keyed to it |
| Anon must never get direct SELECT on `chat_messages` or `chat_conversations` | RLS / security boundary |
| No `git push` or Supabase SQL without explicit user confirmation | Deployment safeguard |
| Do not remove or skip existing tests | CI enforces both test files |

## Risk warnings — required before proposing

Flag these explicitly before proposing any change that touches:

- **Auth / session handling** — risk of locking users out or exposing privileged routes
- **RLS policies or Supabase functions** — risk of data leakage across visitors or tenants; always verify `is_admin_or_owner()` is used for authenticated paths and visitor-scoped RPCs use `SECURITY DEFINER` with `visitor_id` validation
- **`storageKey` or localStorage structure** — risk of data loss or broken hydration for existing sessions
- **`store` table `tenant_id` column** — kept for backward compatibility; removing or ignoring it corrupts multi-tenant deployments
- **Customer data (leads, CRM, chat)** — any schema or query change must be reviewed for data exposure
- **Shared storage keys** — a key collision between modules silently corrupts data

## Supabase SQL rules

- Functions must be `SECURITY DEFINER STABLE SET search_path = public`
- Explicit signatures in `REVOKE`/`GRANT`: `GRANT EXECUTE ON FUNCTION f(text, text) TO anon`
- After any function create/replace: `NOTIFY pgrst, 'reload schema';`
- SQL files must be idempotent (`CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP ... IF EXISTS`)

## Testing

```
npm install
node test.js          # must pass (two known pre-existing failures are acceptable)
node test-intranet.js # must pass
```

Do not propose changes that cause new test failures. The two known-failing tests are:
- `"henvendelses-fanen heter «Kontakt»"` (test.js)
- `"o3: workspaceship via direkterute"` (test-intranet.js)

## Documentation workflow

- `docs/README.md` is the map — start there when documentation context is needed; it defines the source-of-truth order (code/config/schema/tests → Git history → accepted ADRs in `docs/decisions/` → `docs/project/CURRENT_STATE.md` → `docs/architecture/` → `docs/project/CHANGELOG.md` → `docs/roadmap/ROADMAP.md` as planning-only).
- Documentation is helpful context, not a substitute for inspecting actual code and configuration.
- For non-trivial tasks, inspect relevant architecture docs, `docs/project/CURRENT_STATE.md` and accepted ADRs before implementation.
- The Builder owns first-pass documentation updates for meaningful completed changes; include a "Documentation impact" note in the completion summary.
- Never update roadmap priorities unless explicitly instructed. Never record an ADR without confirmed decision evidence.
- The **Project Historian** (`.claude/agents/vibeverk-project-historian.md`) is the documentation-consistency gate — invoke after meaningful changes.
- Reviewers/auditors (`vibeverk-reviewer`, `vibeverk-security-auditor`) must inspect the Git diff and actual code first — never accept a documentation claim as proof of correctness or security.
- Use the `vibeverk-handoff` skill after meaningful completed work to classify the change and route to the right review path.

## AI agent workflow

- Run **Vibeverk Security Auditor** before considering security-sensitive changes ready for merge or deployment.
- Run **Privacy and Compliance Advisor** before launch of any feature that collects, stores, shares, analyses or exposes personal data.
- Run **UX and Mobile Reviewer** after meaningful UI, module, modal, layout or responsive changes.
- Invoke the **Architect** before major architecture, data-model or cross-module changes.
- Security-sensitive changes: authentication, roles, permissions, superadmin access, Supabase RLS, storage, file sharing, APIs, webhooks, third-party integrations, payment-related integrations and customer data.
- Privacy drafts must match verified functionality and confirmed customer facts.
- No agent may claim legal compliance or security assurance solely based on AI review.
- No `git push`, Supabase SQL, deployment or production changes without explicit user approval.
