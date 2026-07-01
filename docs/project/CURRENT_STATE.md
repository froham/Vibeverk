# Current State — Vibeverk

Concise, factual summary of what is actually implemented right now. Not a wishlist — see [`docs/roadmap/ROADMAP.md`](../roadmap/ROADMAP.md) for planned work. For architectural detail behind any claim here, see [`docs/architecture/`](../architecture/README.md).

## Last verified

2026-07-01, in the course of the email-reply consistency fix (`crmFull`), the documentation-governance restructuring, a critical-fixes pass (admin-auth backdoor closure, a corrupted Edge Function restored, `admin/index.html` drift fixed), and a further cleanup pass the same day (chat close/minimize bug, task-assignment permission bug, Console field clarity, intranet-login backdoor parity, owner-role reference removal, CRM email consistency). Detailed technical claims about the architecture docs listed below were verified as recently maintained/current by inspection during that same session, but were not re-read line-by-line for this document — treat `docs/architecture/*.md` as the primary source if detail beyond this summary is needed.

## Implemented and verified

- **Three delivery surfaces**: public website (`/`), Workspace/intranet (`/intranet/`), Vibeverk Operator Console (`/console/`) — see `docs/architecture/system-overview.md`.
- **Public site modules**: booking, chat (widget + admin), CRM (light), FAQ, mediabank, quote/tilbud, references, scroll banner, contact/kontakt leads, user administration.
- **Workspace modules**: dashboard, announcements, tasks, notes, links, CRM, knowledge base, org drift, settings, media bank (internal), booking/quote/contact admin views. Note: several "shared" modules (`module-chat.js`, `module-crm.js`) are a single root-level file that dual-registers for both Web-admin (`App.registerModule`) and Workspace (`window.Intranet.registerModule`) — not two separate per-surface implementations. See "Known limitations" for a discovered dead-code duplicate (`intranet/module-crm.js`).
- **Roles**: `admin`/`editor`/`member` only — the database CHECK constraint on `users.role` does not permit any other value. An earlier `owner` role was removed (commit `2f8a92b`/`hotfix_roles.sql`); lingering references across code, tests and docs were cleaned up 2026-07-01, see `docs/decisions/ADR-0006-remove-owner-role-references.md`. Only `admin` can assign a task to another user (`intranet/module-tasks.js`).
- **Supabase backend**: `store` key/value table with RLS, write-through sync from `App.store`, hydration on login (steg 6a-6c). Row Level Security active on all tables; `is_admin_or_owner()` helper function in use (name is historical, checks `role = 'admin'` only).
- **Auth**: intranet and web-admin login both use Supabase Auth (email + password) whenever `config.js` has `supabase.url`/`anonKey` set — i.e. in every real customer deployment. As of 2026-07-01, `core.js`'s `renderAdminLogin()` explicitly separates "Supabase not configured" (test/local only — password fallback allowed) from "Supabase configured but the SDK failed to load" (shows a retry error, never falls back to the config password). The config-password path is now unreachable in any real, configured deployment, closing a narrow edge-case backdoor. See `docs/decisions/ADR-0003-close-admin-auth-fallback.md`.
- **Console auth**: Supabase OTP (email → 8-digit code), hardcoded superadmin email allowlist (`SUPERADMIN_EMAILS`). As of 2026-07-01, access depends solely on the allowlist + valid OTP — a leftover tenant-role check (`users.role === 'owner'`) was removed after it blocked the Vibeverk operator's own account (which had `role = 'admin'`, not `'owner'`, in the tenant's `users` table). See `docs/decisions/ADR-0004-console-access-decoupled-from-tenant-role.md`.
- **`manage-user` Edge Function**: invite/remove workspace users, service_role key never exposed to client, max 50 users/tenant enforced. Was found corrupted (truncated to 2 bytes) in the working tree on 2026-07-01 — restored from git history (`59b2dbb`) and **redeployed to production the same day**, via the Supabase Dashboard's Edge Function editor (not the CLI — see `docs/project/CHANGELOG.md` 0.3.0 "Driftsnotat" for why). The repo remains the source of truth for this function's code.
- **`send-reply` Edge Function**: outbound transactional email via Resend, supports HTML body and attachments. Verified deployed and in active use this session.
- **`features.crmFull` flag** (added 2026-07-01): governs whether direct email sending (via `send-reply`) or Outlook/`mailto:` is used for admin replies — identical behavior in Web-admin and Workspace, gated purely by customer feature flag, never by which surface the admin is using. See `docs/decisions/ADR-0002-crmfull-email-tiering.md`. As of the same day, this now also covers the CRM customer-card email dialog (previously its own unconnected mock, see Changelog 0.5.0) — `module-crm.js`/`intranet/module-crm.js` call the same shared `App.openReplyModal()` as Kontakt/Booking/Tilbud.
- **Intranet login** (`intranet/intranet-core.js`) now has the same backdoor-closure as web-admin (ADR-0005): the config-password fallback is unreachable whenever Supabase is configured, even if the SDK transiently fails to load.
- **Testing**: `node test.js` (public site) and `node test-intranet.js` (intranet) jsdom harnesses, both run in CI on every push. As of 2026-07-01: 372/1 and 64/1, with the one failure in each being a known pre-existing issue (see `CLAUDE.md`/`AGENTS.md` for current test names — these two files should agree; a discrepancy was found and corrected during this session).

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

- `supabase/hotfix_visitor_rpcs.sql` deploy status: **confirmed by user 2026-07-01 as run** in the production Supabase Dashboard SQL Editor for the live project (`clzczbyklgdtdhgjphup`) — visitor chat RPCs work. Noted here as user-confirmed rather than repo-verified, since SQL execution against Supabase happens outside version control.
- Supabase project data region/residency for the current customer.
- Whether SPF/DKIM/DMARC are configured for the sending domain in Resend (relevant to both current outbound deliverability and any future inbound work).

## Known limitations

- `config.js → admin.password` is still the placeholder value `"test"`. As of 2026-07-01 this is no longer reachable in production (see Auth note above), but should still be changed before any real production customer use — it remains the fallback for local/test environments without Supabase, and a placeholder value there invites confusion.
- Web-admin password authentication, when Supabase is not configured (test/local environments only), is enforced client-side only — not a production security boundary. See `docs/security/security-baseline.md`.
- `storageKey: "nordpunkt"` cannot be renamed without a full atomic data migration — existing Supabase rows and localStorage entries are keyed to it.
- `AGENTS.md` and `CLAUDE.md` are maintained as two separate, near-duplicate files (one per AI harness) rather than a single generated source — keeping them in sync is a manual, currently unenforced process.
- **`intranet/module-crm.js` is dead code.** `intranet/index.html` loads the root `module-crm.js` instead (via `../module-crm.js`), which dual-registers for both Web-admin and Workspace — the separate `intranet/module-crm.js` file is never loaded by any real page. However, `test-intranet.js` (root and `intranet/`) hardcodes evaluation of `intranet/module-crm.js` for its CRM-related assertions — meaning those tests exercise a file that never runs in production, while the Workspace-registration branch of the real, active `module-crm.js` has no dedicated Workspace-specific test coverage. Discovered 2026-07-01, not resolved — needs a decision: delete the dead file and adjust the test harness to load root `module-crm.js`, or something else.
- `is_admin_or_owner()` SQL function name is historical (only checks `role = 'admin'`) — not renamed since it's referenced by many RLS policies; would need a coordinated migration. See `docs/decisions/ADR-0006-remove-owner-role-references.md`.
