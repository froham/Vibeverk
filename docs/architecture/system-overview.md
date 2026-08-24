# System Overview

## What it is

Vibeverk is a single-tenant white-label website and Workspace platform for Norwegian small businesses. A single codebase is deployed per customer. The only file that changes between customers is `config.js`. All other code is shared.

## Three delivery surfaces

### 1. Public website (`/`)
Customer-facing marketing and tools site. Contains the customer's public content, booking form, FAQ, references, chat widget, and related modules. All visitors are unauthenticated (anon). The web admin panel (`/#admin`) overlays this surface. **Hosting, as of the 2026-07-16 `vibeverk.no` DNS cutover**: Vercel, with `middleware.js` resolving the request's hostname to a tenant via the control plane (see "Hosting" in the Stack table below and `docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md`'s 2026-07-16 addendum) — not a per-repo static deploy. GitHub Pages is retained (the repo's `CNAME` file is untouched) as a fast-rollback path only, not receiving live traffic today.

### 2. Workspace (`/workspace/`, renamed 2026-07-07 from `/intranet/`)
Authenticated employee workspace. A separate single-page application with its own bootstrap (`workspace-core.js`, renamed from `intranet-core.js`). Contains dashboard, tasks, notes, announcements, knowledge base, CRM, bookings, links, org drift, settings, and user management.

### 3. Vibeverk Operator Console (`/console/`)
Internal superadmin surface for Vibeverk operators. Used to manage customer configurations, override feature flags, set productMode, and inspect deployments. Two-step OTP authentication (email → 8-digit code via Supabase).

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript (ES5 patterns: IIFE, `var`, named functions) |
| Bundler | None |
| Framework | None |
| Hosting | Vercel (push to `main` → auto-deploy), with `middleware.js` (Vercel Routing Middleware) resolving each request's hostname to a tenant via the `vibeverk-control` control plane and generating `/config.js` per-request. GitHub Pages retained only as a rollback path (repo `CNAME` file untouched) — see ADR-0007's Phase 6 and 2026-07-16 addenda. |
| Backend | Supabase (PostgreSQL + PostgREST + Auth + Realtime) |
| Fonts | Google Fonts (loaded dynamically from config.js) |
| Analytics | Plausible or internal `module-sidetelling.js` (optional, mutually exclusive feature/config choices) |

## Deployment

**Frontend:** `git push main` triggers Vercel to auto-deploy (both the `vibeverk` production project and the `vibeverk-j1yg` canary/staging project, which auto-build from the same GitHub repo). No build step. Files are served as-is, except `/config.js`, which `middleware.js` unconditionally rewrites to `/api/tenant-config` (a Vercel Function that generates a per-tenant config from the control plane's tenant registry at request time — see ADR-0007). GitHub Pages still auto-deploys from the same push (unchanged historical mechanism, `CNAME` file present) but is not the live path for `vibeverk.no` since the 2026-07-16 DNS cutover — kept only as a fast-rollback option.

**Supabase CLI / Edge Functions:** Supabase CLI is installed locally as a development dependency and invoked with `npx supabase`. The working copy can be linked to the customer project and deploy version-controlled Edge Functions from `supabase/functions/`, but every remote deploy still requires explicit user approval.

**SQL / schema:** `supabase/migrations/` is the real, CLI-deployable source of schema truth, since 2026-07-07 (baseline `20260707000001_baseline_schema.sql`; 28 migration files as of 2026-08-06). New changes go in a new timestamped file there (`npx supabase migration new <name>`), deployed via `npx supabase db push --linked` (or `--db-url` for a non-linked project such as `vibeverk-staging` or `supabase-control/`). `supabase/migration.sql` and the standalone `supabase/hotfix_*.sql` files are a **superseded, frozen snapshot** as of that same baseline — historical only, not updated further and not the deploy path. After any `CREATE OR REPLACE FUNCTION`, run `NOTIFY pgrst, 'reload schema';`.

**No automated deployment:** No `git push`, Supabase SQL, or production action may happen without explicit user approval.

## Tenant isolation

One Supabase project per customer. Complete database-level isolation — each customer's data is in a separate PostgreSQL database. There is no shared multi-tenant database. The `store` table retains a `tenant_id` column for backward compatibility, but all other tables are single-tenant by design.

`vibeverk-staging` (ref `syqnyfeponexmkdvnsga`) is a dedicated, non-tenant Supabase project mirroring production's schema, used to test new migrations before they touch a real customer project — not itself a tenant.

## Storage

Two Supabase Storage buckets: the public **`media`** bucket (images, general public-facing attachments, no signed URLs needed) and the private **`crm-documents`** bucket (CRM document attachments — short-lived signed URLs, admin/editor only). A per-visitor daily quota on anonymous uploads is enforced via the `anon-media-upload-token` Edge Function.

## Edge Functions beyond `manage-user`

The data-plane project (`supabase/functions/`) also has `send-reply` (outbound transactional email via Resend), `inbound-email` (inbound email → Kontakt lead / CRM timeline entry, DKIM/SPF-verified), `anon-media-upload-token` (anonymous upload quota token), and the deploy-pending `sidetelling-event` (server-side daily analytics grouping). The control-plane project (`supabase-control/supabase/functions/`) has its own separate set: `tenant-admin` (onboarding/provisioning), `broker` (Console's day-to-day config read/write), and `broker-ping` (mechanism-proof only).

## Four key files

| File | Purpose |
|---|---|
| `config.js` | Customer identity, colors, fonts, contact info, feature flags, Supabase credentials, admin password, storageKey, workspace settings, productMode. Only file changed per customer. |
| `components.js` | Pure functions returning HTML strings. No state, no side effects, no DOM access. Provides `C.esc()` for HTML escaping. |
| `core.js` | App bootstrap for the public site. Applies theme (`applyTheme()`), renders sections, manages module registry (`App.registerModule()`), exposes `App.store` and `App.supabase`. |
| `index.html` | Controls script load order and cache-bust versions (`?v=N` on each script tag). |

## productMode

`"web"` / `"workspace"` / `"full"`. Determines which surfaces are enabled for a given deployment.

- `"web"` — public website only; Workspace boot is blocked
- `"workspace"` — Workspace only; public site boot is blocked
- `"full"` — both surfaces active

productMode is read exclusively from the `superconfig` key in the Supabase `store` table (written by the Vibeverk Console). It is never read from `config.js` defaults, to avoid blocking tests in environments without Supabase.

## CI

GitHub Actions runs `node test.js` (jsdom harness for public site), `node test-workspace.js` (jsdom harness for Workspace, renamed 2026-07-07 from `test-intranet.js`), and `node test-api.js` (plain-Node harness for API functions and middleware) on every push to any branch. All three suites were fully green in the local 2026-08-24 verification (after the `traceparent` request-tracing addition, see `docs/architecture/tracing.md`): **778 OK / 0 FEIL**, **303 OK / 0 FEIL**, and **132 OK / 0 FEIL**, respectively. See `CLAUDE.md`'s Testing section for detail.

## Known limitations

- **No bundler:** No tree-shaking, no TypeScript, no module imports. All code is global scope managed by load order in `index.html`.
- **localStorage is not a security boundary:** It is a working copy. All security enforcement happens server-side via Supabase RLS and SECURITY DEFINER functions.
- **anonKey is in config.js:** This is intentional (PostgREST pattern). The anonKey is not a secret — security depends on RLS, not key secrecy.
- **Web admin password is in config.js:** Static password, committed to git, served publicly. This is a known design constraint. Authentication is purely client-side for the web admin surface.
