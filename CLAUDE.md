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
- Run SQL manually in Supabase Dashboard → SQL Editor — there is no Supabase CLI in this project
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
- Intranet login: Supabase Auth (email + password), role must be `owner` or `admin` in `users` table
