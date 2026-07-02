# System Overview

## What it is

Vibeverk is a single-tenant white-label website and intranet platform for Norwegian small businesses. A single codebase is deployed per customer. The only file that changes between customers is `config.js`. All other code is shared.

## Three delivery surfaces

### 1. Public website (`/`)
Customer-facing marketing and tools site. Served via GitHub Pages. Contains the customer's public content, booking form, FAQ, references, chat widget, and related modules. All visitors are unauthenticated (anon). The web admin panel (`/#admin`) overlays this surface.

### 2. Workspace / Intranet (`/intranet/`)
Authenticated employee workspace. A separate single-page application with its own bootstrap (`intranet-core.js`). Contains dashboard, tasks, notes, announcements, knowledge base, CRM, bookings, links, org drift, settings, and user management.

### 3. Vibeverk Operator Console (`/console/`)
Internal superadmin surface for Vibeverk operators. Used to manage customer configurations, override feature flags, set productMode, and inspect deployments. Two-step OTP authentication (email → 8-digit code via Supabase).

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript (ES5 patterns: IIFE, `var`, named functions) |
| Bundler | None |
| Framework | None |
| Hosting | GitHub Pages (push to `main` → auto-deploy) |
| Backend | Supabase (PostgreSQL + PostgREST + Auth + Realtime) |
| Fonts | Google Fonts (loaded dynamically from config.js) |
| Analytics | Plausible (optional, feature flag) |
| Live chat SaaS | Tidio (optional, feature flag) |

## Deployment

**Frontend:** `git push main` triggers GitHub Pages to deploy. No build step. Files are served as-is.

**Supabase CLI / Edge Functions:** Supabase CLI is installed locally as a development dependency and invoked with `npx supabase`. The working copy can be linked to the customer project and deploy version-controlled Edge Functions from `supabase/functions/`, but every remote deploy still requires explicit user approval.

**SQL / schema:** `supabase/migration.sql` and the standalone `supabase/hotfix_*.sql` files are not timestamped files under `supabase/migrations/`, so `supabase db push` does not discover or deploy them. Until the SQL workflow is deliberately converted to standard CLI migrations, these files must still be run manually in the Supabase Dashboard SQL Editor. After any `CREATE OR REPLACE FUNCTION`, run `NOTIFY pgrst, 'reload schema';`.

**No automated deployment:** No `git push`, Supabase SQL, or production action may happen without explicit user approval.

## Tenant isolation

One Supabase project per customer. Complete database-level isolation — each customer's data is in a separate PostgreSQL database. There is no shared multi-tenant database. The `store` table retains a `tenant_id` column for backward compatibility, but all other tables are single-tenant by design.

## Four key files

| File | Purpose |
|---|---|
| `config.js` | Customer identity, colors, fonts, contact info, feature flags, Supabase credentials, admin password, storageKey, workspace settings, productMode. Only file changed per customer. |
| `components.js` | Pure functions returning HTML strings. No state, no side effects, no DOM access. Provides `C.esc()` for HTML escaping. |
| `core.js` | App bootstrap for the public site. Applies theme (`applyTheme()`), renders sections, manages module registry (`App.registerModule()`), exposes `App.store` and `App.supabase`. |
| `index.html` | Controls script load order and cache-bust versions (`?v=N` on each script tag). |

## productMode

`"web"` / `"workspace"` / `"full"`. Determines which surfaces are enabled for a given deployment.

- `"web"` — public website only; intranet boot is blocked
- `"workspace"` — intranet only; public site boot is blocked
- `"full"` — both surfaces active

productMode is read exclusively from the `superconfig` key in the Supabase `store` table (written by the Vibeverk Console). It is never read from `config.js` defaults, to avoid blocking tests in environments without Supabase.

## CI

GitHub Actions runs `node test.js` (jsdom harness for public site) and `node test-intranet.js` (jsdom harness for intranet) on every push to any branch. Both must pass before merge. Two tests are currently known-failing (pre-existing, unrelated to active development):
- `"henvendelses-fanen heter «Kontakt»"`
- `"sammenslåings-avhukingsbokser finst på kunderadene"`

## Known limitations

- **No bundler:** No tree-shaking, no TypeScript, no module imports. All code is global scope managed by load order in `index.html`.
- **localStorage is not a security boundary:** It is a working copy. All security enforcement happens server-side via Supabase RLS and SECURITY DEFINER functions.
- **anonKey is in config.js:** This is intentional (PostgREST pattern). The anonKey is not a secret — security depends on RLS, not key secrecy.
- **Web admin password is in config.js:** Static password, committed to git, served publicly. This is a known design constraint. Authentication is purely client-side for the web admin surface.
- **No automated SQL migration:** All schema changes are applied manually.
