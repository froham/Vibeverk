# Current State — Vibeverk

Concise, factual summary of what is actually implemented right now. Not a wishlist — see [`docs/roadmap/ROADMAP.md`](../roadmap/ROADMAP.md) for planned work. For architectural detail behind any claim here, see [`docs/architecture/`](../architecture/README.md).

**2026-07-19 rewrite note**: this file had grown into a long, chronological, changelog-style pile of dated entries (back to 2026-07-01), duplicating `docs/project/CHANGELOG.md` and contradicting its own stated goal above. It has been rewritten below into a genuinely concise summary of what's true today. The entire previous body (all dated entries, the full security-findings-status log, etc.) is preserved verbatim, not deleted, in [`docs/archive/current-state-history-2026-07-19.md`](../archive/current-state-history-2026-07-19.md) — consult that file for the detailed reasoning/history behind any summary claim below.

## Last verified

**2026-07-19 (v0.60.0).** This round's focus (user-approved): stop building new features, focus on quality/deployment-debt/testing across exactly two real test-case tenants — Vibeverk itself and Sunnvask-demo. Facts below were checked directly this session (git, code, live `npx supabase` queries against real projects), not assumed — see `docs/roadmap/ROADMAP.md` "Current focus"/"Next" for what this implies for planning.

### Code and test state
- `main` branch, HEAD is **0.60.0** (`console/console-core.js`'s `VIBEVERK_VERSION`).
- `test.js`: **576 OK / 0 FEIL**. `test-workspace.js`: **162 OK / 0 FEIL**. Both suites fully green — the two long-standing known-failing tests (a stale exact-match assertion that never accounted for an unread-count badge span; a test of a route renamed away in the Fase 10 `customModules` work) were both fixed 2026-07-19, same round. See `CLAUDE.md`'s Testing section.
- 19 files in `supabase/migrations/`; the newest three (`20260719124203`, `20260719132533`, `20260719133529`) landed 2026-07-19 as part of the media-upload-quota work.

### Three delivery surfaces
Public website (`/`), Workspace (`/workspace/`), Vibeverk Operator Console (`/console/`) — unchanged from `docs/architecture/system-overview.md`, no drift found this pass.

### Two real tenants, plus two non-tenant Supabase projects

| Project | Ref | Role |
|---|---|---|
| `vibeverk` (production) | `clzczbyklgdtdhgjphup` | Vibeverk's own real, live production tenant |
| Sunnvask-demo | `nzgibflxodcwuhtaprrs` | The demo customer, onboarded 2026-07-14 via the real Console onboarding flow |
| `vibeverk-staging` | `syqnyfeponexmkdvnsga` | Shared dev/test project — not a tenant either test case runs against directly |
| `vibeverk-control` | `jxoglthrnshabqmdmnui` | Control plane (tenant registry), not a data-plane project |

### Migration / Edge Function matrix (directly queried 2026-07-19, not inferred)

| Project | Migrations (`supabase_migrations.schema_migrations`) | `manage-user` | `send-reply` | `inbound-email` | `anon-media-upload-token` |
|---|---|---|---|---|---|
| Production | 19/19 applied, matches repo exactly | ACTIVE | ACTIVE | ACTIVE | ACTIVE |
| Staging | 19/19 applied, identical to production | ACTIVE | absent | absent | ACTIVE |
| Sunnvask-demo | **not directly queried — no DB password available** | ACTIVE | absent | absent | absent |

The Edge Function column is a directly confirmed fact for all three projects (`npx supabase functions list` needs only API auth, not a DB password).

**Sunnvask-demo's migration state is an inference, not a confirmed fact.** It was onboarded 2026-07-14 via Console's real onboarding flow, which applies whatever migrations exist in the repo at onboarding time; since it's missing every Edge Function added after that date, it likely still sits around migration `20260714133000`, meaning it's likely missing 9 later migrations (the 2026-07-15 export-backup RPC, the two 2026-07-17 inbound-email/dedup migrations, the 2026-07-18 crm-documents-bucket and restore-fix and anon-booking-slots migrations, and all three of 2026-07-19's media-quota migrations). **This needs external DB verification** (Sunnvask-demo's pooler connection string, or running `npx supabase db push` against it) before being treated as fact — see `docs/roadmap/ROADMAP.md` "Next". If the inference holds, the concrete, code-verified consequences today would be: the booking calendar's anon branch would silently show fully-booked days as available (the exact regression `get_taken_booking_slots()`, added 2026-07-18, was built to fix — the single highest-impact possible gap here, since it's silent, not an error); CRM document uploads and Tilbud attachment uploads would fail gracefully (a shown error message, not a crash or silent regression).

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
- **Design templates ("sidebygger")**: three site-wide templates (Klassisk, Panorama, Scroll-story) behind `features.sidebygger` (off by default everywhere today), plus customer-editable Tagline/SEO/colours/fonts/logo in a dedicated Web-admin "Design" tab. See `docs/roadmap/ROADMAP.md` "Later" for what's still open here.
- **`customModules` manifest**: pipeline built and proven end-to-end (a real per-customer custom module shipped and loaded). No second real customer module exists yet — ordinary future dev work, not an open roadmap item.
- **Support access**: `generate_support_access` mints a time-boxed, audit-logged magic link for an existing real admin at a tenant (impersonation via real identity, no standing/phantom account) — privacy-reviewed, no code changes required by that review.
- **Testing**: `test.js`/`test-workspace.js` jsdom harnesses (counts above), run in CI on every push. A separate Playwright smoke-test suite (`.claude/skills/smoke-vibeverk/`) exists against `vibeverk-staging` for `dashboard-shortcuts` and `user-deletion` (both PASS live) — `backup-restore`, the full login matrix, and Console's onboarding checklist are still not covered by it.

## Partially implemented

- **Design-modul ("sidebygger")**: built (see above) but `features.sidebygger` is off in every real config today — no customer is actually using it live.
- **Sunnvask-demo's deployment currency**: see "Migration / Edge Function matrix" above — a likely-real gap, not yet closed.

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
