# Current State — Vibeverk

Concise, factual summary of what is actually implemented right now. Not a wishlist — see [`docs/roadmap/ROADMAP.md`](../roadmap/ROADMAP.md) for planned work. For architectural detail behind any claim here, see [`docs/architecture/`](../architecture/README.md).

**2026-07-19 rewrite note**: this file had grown into a long, chronological, changelog-style pile of dated entries (back to 2026-07-01), duplicating `docs/project/CHANGELOG.md` and contradicting its own stated goal above. It has been rewritten below into a genuinely concise summary of what's true today. The entire previous body (all dated entries, the full security-findings-status log, etc.) is preserved verbatim, not deleted, in [`docs/archive/current-state-history-2026-07-19.md`](../archive/current-state-history-2026-07-19.md) — consult that file for the detailed reasoning/history behind any summary claim below.

## Last verified

**2026-07-19 (v0.60.0).** This round's focus (user-approved): stop building new features, focus on quality/deployment-debt/testing across exactly two real test-case tenants — Vibeverk itself and Sunnvask-demo. Facts below were checked directly this session (git, code, live `npx supabase` queries against real projects), not assumed — see `docs/roadmap/ROADMAP.md` "Current focus"/"Next" for what this implies for planning.

### Code and test state
- `main` branch, HEAD is **0.62.0** (`console/console-core.js`'s `VIBEVERK_VERSION`).
- `test.js`: **576 OK / 0 FEIL**. `test-workspace.js`: **162 OK / 0 FEIL**. Both suites fully green — the two long-standing known-failing tests (a stale exact-match assertion that never accounted for an unread-count badge span; a test of a route renamed away in the Fase 10 `customModules` work) were both fixed 2026-07-19, same round. See `CLAUDE.md`'s Testing section.
- 20 files in `supabase/migrations/`; the newest three (`20260719124203`, `20260719132533`, `20260719133529`) landed 2026-07-19 as part of the media-upload-quota work.
- **Live browser + Codex testing round (2026-07-19, same day as the above), against Sunnvask-demo and production**: found and fixed a real raw-Storage-error-leak bug on the quote-attachment path (0.61.0); found and removed a permanently-noisy console warning that fired on every page for every real tenant regardless of actual config completeness (0.62.0); confirmed the anon booking-taken-slots RPC (`get_taken_booking_slots()`) works correctly end-to-end (real anon REST call, zero PII, RLS on the raw `bookings` table still blocks anon `SELECT`); confirmed zero `PWTEST-`/`SMOKETEST-` residue anywhere in production; found and cleaned up two leftover `PWTEST-` leads/CRM-customers on Sunnvask-demo from this session's own earlier testing. Full detail: `.claude/skills/smoke-vibeverk/TEST-MATRIX.md` and `docs/project/CHANGELOG.md` 0.61.0/0.62.0. Sunnvask-demo's `booking-assets` is empty (no configured public booking resource) — a content/demo-setup gap, not a code gap, so the visual booking calendar hasn't been walked through end-to-end yet.

### Three delivery surfaces
Public website (`/`), Workspace (`/workspace/`), Vibeverk Operator Console (`/console/`) — unchanged from `docs/architecture/system-overview.md`, no drift found this pass.

### Two real tenants, plus two non-tenant Supabase projects

| Project | Ref | Role |
|---|---|---|
| `vibeverk` (production) | `clzczbyklgdtdhgjphup` | Vibeverk's own real, live production tenant |
| Sunnvask-demo | `nzgibflxodcwuhtaprrs` | The demo customer, onboarded 2026-07-14 via the real Console onboarding flow |
| `vibeverk-staging` | `syqnyfeponexmkdvnsga` | Shared dev/test project — not a tenant either test case runs against directly |
| `vibeverk-control` | `jxoglthrnshabqmdmnui` | Control plane (tenant registry), not a data-plane project |

### Migration / Edge Function matrix (directly queried, latest pass 2026-07-19)

| Project | Migrations (`supabase_migrations.schema_migrations`) | `manage-user` | `send-reply` | `inbound-email` | `anon-media-upload-token` |
|---|---|---|---|---|---|
| Production | 20/20 applied, matches repo exactly | ACTIVE | ACTIVE | ACTIVE | ACTIVE |
| Staging | 20/20 applied, identical to production | ACTIVE | absent | absent | ACTIVE |
| Sunnvask-demo | 20/20 applied — **closed 2026-07-19** (was 11/20, missing 9 migrations back to its 2026-07-14 onboarding date; confirmed by direct query, then closed with `db push` + 3 function deploys, re-verified afterward) | ACTIVE | ACTIVE | ACTIVE | ACTIVE |

All three columns are now directly confirmed fact for all three projects — no outstanding inference. Sunnvask-demo is deployment-current with production/staging as of 2026-07-19.

### A real testing-strategy gap
Staging is missing `send-reply`/`inbound-email`, so outbound/inbound email cannot be end-to-end tested anywhere except production today — conflicting with the general "never destructive-test against production" instinct. Not yet resolved — see `docs/roadmap/ROADMAP.md` "Next".

## Implemented and verified

- **Control-plane/data-plane split**: `vibeverk-control` (tenant registry, operators, audit log) is separate from every customer's own data-plane Supabase project. Per-tenant `service_role` keys via Supabase Vault only. See ADR-0008/0009/0010.
- **Console** authenticates via OTP against the control plane (not a customer project), gated on `operators.status='active'` checked after OTP. All config writes go through the `broker` Edge Function.
- **Hostname→tenant→Supabase-project resolution** (`resolve_tenant_by_hostname()` + `middleware.js` + `api/tenant-config.js`) is the live path for real traffic, including `vibeverk.no` itself since the 2026-07-16 DNS cutover. GitHub Pages remains only as a rollback path (`CNAME` file untouched).
- **Semi-automated tenant onboarding** via Console's "Kundar" section, hard-gated on real schema/routing verification before a tenant can go `active`.
- **Roles**: `admin`/`editor`/`member` only (DB CHECK constraint). See `docs/architecture/roles-and-tenants.md` for the full matrix.
- **Backup/restore** ("Sikkerhetskopi"): nine tables covered via admin-gated `SECURITY DEFINER` RPCs (`export_backup_tables()`/`restore_backup_tables()`), not just a UI-hidden button. `notes` and chat deliberately excluded (documented decision, not a gap).
- **Storage**: a public `media` bucket (images, general attachments) and a private `crm-documents` bucket (signed-URL access, admin/editor only) — see `docs/archive/current-state-history-2026-07-19.md` for the design rationale. A per-visitor daily upload quota (`anon-media-upload-token` Edge Function + `bump_and_check_anon_upload_quota()`) closed an anon-abuse gap in production 2026-07-19 (`supabase/migrations/20260719*`).
- **Inbound email**: live in production since v0.43.0/0.43.1 (2026-07-17) — Message-ID/DKIM/SPF-verified thread matching, auto-creates a Kontakt lead + CRM customer on no match, reuses the existing `crm_comms` timeline pattern. Not deployed to staging or Sunnvask-demo (see matrix above).
- **Mini-CRM timeline**: chat and email both appear as `crm_comms` entries on the customer timeline (not just a "jump to chat" shortcut).
- **Design templates ("sidebygger")**: three site-wide templates (Klassisk, Panorama, Scroll-story), plus customer-editable Tagline/SEO/colours/fonts/logo in a dedicated Web-admin "Design" tab. **`features.sidebygger` is `true` on BOTH real tenants** (directly queried against `store.superconfig` on production and Sunnvask-demo 2026-07-19 — an earlier draft of this file wrongly claimed it was off everywhere, caught and corrected the same day by the user spotting it live in a screenshot of their own admin panel; don't trust this kind of claim without a direct query again). See `docs/roadmap/ROADMAP.md` "Later" for what's still open here.
- **`customModules` manifest**: pipeline built and proven end-to-end (a real per-customer custom module shipped and loaded). No second real customer module exists yet — ordinary future dev work, not an open roadmap item.
- **Support access**: `generate_support_access` mints a time-boxed, audit-logged magic link for an existing real admin at a tenant (impersonation via real identity, no standing/phantom account) — privacy-reviewed, no code changes required by that review.
- **Testing**: `test.js`/`test-workspace.js` jsdom harnesses (counts above), run in CI on every push. A separate Playwright smoke-test suite (`.claude/skills/smoke-vibeverk/`) exists against `vibeverk-staging` for `dashboard-shortcuts` and `user-deletion` (both PASS live) — `backup-restore`, the full login matrix, and Console's onboarding checklist are still not covered by it.

### Modules added since the 2026-07-19 verification pass (not yet covered by the facts above)

- **Karusell** (`module-carousel.js`, v0.66.0, 2026-07-20): image/video carousel, own `App.registerModule()` entry per carousel instance, admin-CRUD under "Innhald". Auto (timed, `prefers-reduced-motion`-aware) or manual (arrows/dots/swipe) advance. Video scope deliberately limited to muted/looped `video/mp4`, 20MB max, own `media-video` Storage bucket. **Corrected in this pass (2026-08-03): there is no separate `carousel` feature flag** — the module gates on `CFG.features.sidebygger === true` (verified directly in `module-carousel.js`), the same paid "Design" flag as the templates/Banner section above. Since this file's own "Design templates" bullet confirms `features.sidebygger` is `true` on both real tenants, Karusell is **not** off-by-default in practice wherever `sidebygger` is already on — it is gated by that flag's state, not a dormant flag of its own. **Not yet production-ready**: the `media-video` bucket migration has not been run against any real Supabase project (needs its own approval, separate from the code merge), and a real-browser upload test with an actual mp4 hasn't been done yet.
- **Nettsidehelse** (v0.76.0–0.77.2, 2026-07-27): rule-based health check of the customer's public site — 4 categories (Synlegheit/Innhald/Tillit/Tilgjenge), 0–100 score + per-category score + traffic-light + top-5 prioritized fixes. Pure function (`computeWebsiteHealth()`), no external API/browser-rendering dependency (Core Web Vitals, sitemap/URL-structure, and keyboard-nav checks were deliberately cut from the original proposal as not meaningful for Vibeverk's single-hash-route architecture). Own tab in both Web-admin (Innstillingar → Nettsidehelse) and Console. See `docs/architecture/website-health-scoring.md`.
- **Intern sidetelling / "Analyse"** (`module-sidetelling.js`, v0.78.0, 2026-07-31, "Fase 1"): cookie-free pageview/CTA-click counting as a free alternative to Plausible — session grouping via `sessionStorage` (never a cookie), public site only (Workspace explicitly out of scope). Feature flag `features.sidetelling`, **off by default**, only runs when `analytics.plausible` is empty. Deployed to production (`clzczbyklgdtdhgjphup`) 2026-07-31 with direct grant/RLS/live-API verification, not just a clean migration exit code. **Console toggle added v0.79.0, 2026-08-03**: operators can now flip `features.sidetelling` per tenant from Console's Modular tab (labelled "Analyse" there, deliberately renamed display-only — internal flag/file names unchanged, same pattern as the Workspace/Intranet rename) instead of a code change + push; Console's own Analyse tab (external tools) shows a warning box when a tenant's internal module is active, since the two are mutually exclusive by design. The mutual exclusion is asymmetric, not reciprocal: `initAnalytics()` in `core.js` loads the Plausible script unconditionally whenever `analytics.plausible` is set, with no check of `features.sidetelling` at all; `module-sidetelling.js` is the one that defers, aborting itself (`if (an.plausible) return;`) when a Plausible domain is present — so if both are configured, **Plausible wins and the internal module goes dormant**. The Project Historian caught an initial draft of the warning-box/help text stating this backwards; fixed same day in `console-core.js` (both `FEAT_HELP.sidetelling` and the `sidetellingWarning` box in `renderAnalyse()`), together with a UX/Mobile Reviewer pass that also changed the box from red/`danger` styling to orange/`warn` (matching the existing `sidebyggerWarning` pattern, since this is an expected interaction, not an error) and made the copy more actionable. A `featureDefaults()` opt-in/opt-out polarity bug (silently defaulted every toggle to "on" for tenants who'd never touched the tab) was fixed as part of this — it also affected the pre-existing `sidebygger` flag. Deliberately deferred out of this pass: a privacy-text reminder next to the toggle (a draft replacement for the `computeDefaultPrivacyText()` sidetelling branch was handed to the user, not implemented — privacy text is getting its own dedicated pass before customer launch), and broker-wide operator role/tenant-scoping enforcement (flagged as a systemic gap, not specific to this toggle). Fase 2 (unique visitors, bot filtering, geolocation, device/browser metadata, rollup table, AI summary, Workspace analytics, CMS per-page widget, conversion linking) explicitly deferred, not started.

## Not implemented

- **Full i18n / English locale support** — no `t()`/`STRINGS` infrastructure. Last directly re-confirmed 2026-07-02; not re-checked this pass, but no evidence anything has changed.
- **PWA manifest / Service Worker** for Workspace — discussed only.
- **AI-native chat** (RAG, Claude API integration) — explicit future idea, no code exists.

## External verification required

- Sunnvask-demo's actual applied-migration list (see above) — needs a DB pooler connection string or a live `db push` run.
- Live DNS/HTTP state of `vibeverk.no` and its registrar-level URL-forwardings — repo-side evidence (`middleware.js`, ADR-0007's addendum) is confirmed; the live network state itself was not independently re-curled this pass.
- `SITE_LOCK_PASSWORD`'s actual current value on Vercel — project environment-variable configuration, not visible in this repository.
- Any Supabase Dashboard-only configuration (Auth settings, SMTP, storage bucket flags) for any of the three data-plane projects, beyond what a `functions list`/migrations query can confirm.

## Known limitations

Full detail (dead-code history, the `is-err`/`is-error` CSS-class drift precedent, the `.help-icon__pop` viewport-clamping gap, the `vibeverk-security-auditor`/`vibeverk-reviewer` Codex-only-agent gap, and others) lives in `docs/archive/current-state-history-2026-07-19.md`. Still true today, not superseded:
- **`vibeverk-security-auditor` and `vibeverk-reviewer` exist only as Codex-only configs** (`.codex/agents/*.toml`), not as Claude-invokable agents — `CLAUDE.md`'s "AI agent workflow" section names them as if directly invocable via the Agent tool, symmetrical with the five real `.claude/agents/*.md` entries. The working workaround is a `general-purpose` agent given the equivalent brief. Needs a user decision (author real `.claude/agents/` files, or reword `CLAUDE.md`), not resolved this pass.
- `AGENTS.md` and `CLAUDE.md` are maintained as two separate, near-duplicate files rather than a single generated source.
- `storageKey: "nordpunkt"` cannot be renamed without a full atomic data migration.
