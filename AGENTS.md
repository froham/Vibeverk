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
- `"henvendelses-fanen heter «Kontakt»"`
- `"sammenslåings-avhukingsbokser finst på kunderadene"`
