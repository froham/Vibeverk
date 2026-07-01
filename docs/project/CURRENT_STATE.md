# Current State — Vibeverk

Concise, factual summary of what is actually implemented right now. Not a wishlist — see [`docs/roadmap/ROADMAP.md`](../roadmap/ROADMAP.md) for planned work. For architectural detail behind any claim here, see [`docs/architecture/`](../architecture/README.md).

## Last verified

2026-07-01, in the course of the email-reply consistency fix (`crmFull`) and this documentation-governance restructuring. Detailed technical claims about the architecture docs listed below were verified as recently maintained/current by inspection during that same session, but were not re-read line-by-line for this document — treat `docs/architecture/*.md` as the primary source if detail beyond this summary is needed.

## Implemented and verified

- **Three delivery surfaces**: public website (`/`), Workspace/intranet (`/intranet/`), Vibeverk Operator Console (`/console/`) — see `docs/architecture/system-overview.md`.
- **Public site modules**: booking, chat (widget + admin), CRM (light), FAQ, mediabank, quote/tilbud, references, scroll banner, contact/kontakt leads, user administration.
- **Workspace modules**: dashboard, announcements, tasks, notes, links, CRM (mirrored), knowledge base, org drift, settings, media bank (internal), booking/quote/contact admin views.
- **Supabase backend**: `store` key/value table with RLS, write-through sync from `App.store`, hydration on login (steg 6a-6c). Row Level Security active on all tables; `is_admin_or_owner()` helper function in use.
- **Auth**: intranet and (in production, when Supabase is configured) web-admin login both use Supabase Auth (email + password) — verified this session (`core.js:1000`, `useSupabase = !!_sb`). A config-password fallback exists only for local/test environments without Supabase configured.
- **Console auth**: Supabase OTP (email → 8-digit code), hardcoded superadmin email allowlist.
- **`manage-user` Edge Function**: invite/remove workspace users, service_role key never exposed to client, max 50 users/tenant enforced.
- **`send-reply` Edge Function**: outbound transactional email via Resend, supports HTML body and attachments. Verified deployed and in active use this session.
- **`features.crmFull` flag** (added 2026-07-01): governs whether direct email sending (via `send-reply`) or Outlook/`mailto:` is used for admin replies — identical behavior in Web-admin and Workspace, gated purely by customer feature flag, never by which surface the admin is using. See `docs/decisions/ADR-0002-crmfull-email-tiering.md`.
- **Testing**: `node test.js` (public site) and `node test-intranet.js` (intranet) jsdom harnesses, both run in CI on every push. As of 2026-07-01: 370/1 and 64/1, with the one failure in each being a known pre-existing issue (see `CLAUDE.md`/`AGENTS.md` for current test names — these two files should agree; a discrepancy was found and corrected during this session).

## Partially implemented

- **Chat delivery**: works via polling (`pollVisitorMsgs()`, ~5s interval), not Supabase Realtime. Realtime upgrade (roadmap steg 6d) not done.
- **Workspace user administration UI**: `module-users.js` and the `manage-user` Edge Function both exist and are listed as built in `docs/architecture/system-overview.md`/root `README.md`, but the archived roadmap (`docs/archive/roadmap-2026-07-01.md`, steg 5b) still lists this as "— neste" (not done). This is an unresolved contradiction between two sources — treat the code as authoritative (the feature exists) but flag for confirmation, don't assume which document is stale without checking `module-users.js` and `manage-user/index.ts` directly.

## Not implemented

- **Inbound email** (receiving replies to admin-sent emails). No webhook, no table, no code — `send-reply` is outbound-only. Fully designed (Message-ID threading via Resend, auto-create Kontakt lead + CRM customer on no match) but explicitly paused by user 2026-07-01 before building. See `docs/roadmap/ROADMAP.md` and `docs/archive/roadmap-2026-07-01.md` (steg 6f).
- **Full i18n / English locale support** — deferred, no `t()`/`STRINGS` infrastructure exists yet.
- **PWA manifest / Service Worker** for Workspace — discussed only, not built.
- **Custom visual theme-editor module** for customer self-service branding — discussed only (`docs/arkitekt-notat-steg2.md`), not built.
- **AI-native chat (RAG, Claude API integration)** — explicit future idea, no code exists.

## External verification required

- Whether `supabase/hotfix_visitor_rpcs.sql` has actually been run in the production Supabase Dashboard SQL Editor for the live project (`clzczbyklgdtdhgjphup`). Cannot be confirmed by reading the repo — SQL execution against Supabase happens outside version control.
- Supabase project data region/residency for the current customer.
- Whether SPF/DKIM/DMARC are configured for the sending domain in Resend (relevant to both current outbound deliverability and any future inbound work).

## Known limitations

- `config.js → admin.password` is still the placeholder value `"test"` — verified in this repo as of 2026-07-01. Must be changed before any real production customer use. This is a known, currently-open item, not an oversight.
- `admin/index.html` (a separate dedicated admin-URL entry point) has significant cache-bust version drift against the root `index.html`: `module-crm.js` v5 vs v7, `module-chat.js` v7 vs v10, `module-users.js` v5 vs v9, and is missing `module-scrollbanner.js` entirely. Discovered 2026-07-01, not yet fixed — logged in `docs/project/CHANGELOG.md` 0.2.0.
- Web-admin password authentication, when Supabase is not configured (test/local environments only), is enforced client-side only — not a production security boundary. See `docs/security/security-baseline.md`.
- `storageKey: "nordpunkt"` cannot be renamed without a full atomic data migration — existing Supabase rows and localStorage entries are keyed to it.
- `AGENTS.md` and `CLAUDE.md` are maintained as two separate, near-duplicate files (one per AI harness) rather than a single generated source — keeping them in sync is a manual, currently unenforced process.
