# Vibeverk launch-readiness test matrix

Status: planning document, written 2026-07-19. Not code. Design-only — no
Playwright scripts were written or changed as part of producing this.

**Same-day corrections (2026-07-19)**: two facts this document originally
carried forward as still-open have since been closed/corrected, both noted
inline at the relevant section rather than silently rewritten:
- Section 0 (Sunnvask-demo's migration/function gap) — confirmed exactly as
  inferred, then closed (9 migrations + 3 Edge Functions deployed).
- Section B6/B6.2 (`features.sidebygger`) — the claim that it was off
  everywhere was never directly queried and was wrong; it's actually `true`
  on both real tenants, caught by the user spotting the module live in
  their own admin panel.

## Purpose and scope

A single, reusable test matrix for the quality/launch-readiness round
covering **exactly two real tenants** — no hypothetical customers:

1. **Vibeverk itself** — production, `clzczbyklgdtdhgjphup`.
2. **Sunnvask-demo** — the demo tenant, `nzgibflxodcwuhtaprrs`, onboarded
   2026-07-14.

Ground truth for every fact this matrix relies on (migration/function state,
code paths, the two accepted `test.js`/`test-workspace.js` failures) was
verified earlier this session and is recorded in the scratchpad file
`launch-readiness-verified-facts.md` — this document does not re-derive those
facts, it builds the test plan on top of them.

This document is the **plan**. It does not implement new Playwright flows —
it says, for every cell, whether an existing flow already covers it, whether
`test.js`/`test-workspace.js` (jsdom, logic-level) already covers it, or
whether a new flow would be needed, with a one-line sketch of what that flow
would have to do.

## How to read a row

Every test specifies **what "pass" means at the level of a real
database/Storage check**, not a UI success message — the codebase has a
documented history of the UI reporting success while the underlying write
silently failed or the underlying migration was broken:

- `docs/project/CHANGELOG.md` line ~1638: fire-and-forget CRM/lead/booking
  writes in `module-crm.js`/`core.js`/`module-booking.js` had no `.catch()`
  at all until fixed — a failed write disappeared silently, UI included.
- `.claude/skills/smoke-vibeverk/SKILL.md`'s `backup-restore` row: the
  2026-07-18 live run found `restore_backup_tables()` had never actually
  worked in staging or production since 2026-07-13 (`pg-safeupdate` rejected
  the bare `DELETE`s) — the migration applied cleanly and looked fine on
  paper the whole time.

So every row below ends with a **Pass =** line naming the actual row/table/
Storage object/console log to check, not "form shows a green tick."

## Coverage legend

- **Existing flow: `<name>`** — already implemented in
  `.claude/skills/smoke-vibeverk/runner.js` (`FLOWS` object, currently
  `dashboard-shortcuts`, `user-deletion`, `backup-restore`, `crm-documents`).
  Runs only against `vibeverk-staging`, never production, never
  Sunnvask-demo (no config-swap target for it exists today — see "Open
  decisions" below for what that would take).
- **jsdom: `test.js`/`test-workspace.js`** — logic-level, no real Supabase
  call, no browser. Good for validation/rendering/state-machine behavior,
  useless for anything that needs a real network round-trip, RLS, or Storage.
- **New flow needed** — flagged with a one-line sketch of the arrange/act/
  assert shape it would need. Not built as part of this document.
- **Manual only** — inherently needs a human (visual judgement, a real
  inbox, a real phone, Console OTP email) and isn't a good Playwright
  candidate even later.

---

## 0. Prerequisite gate — Sunnvask-demo's actual state — CLEARED 2026-07-19

**Closed.** The inferred migration gap was confirmed exactly as predicted
(Sunnvask-demo was stuck at `20260714133000`, missing all 9 later
migrations) via a direct query once its DB pooler connection string was
obtained, then closed: `npx supabase db push` applied the 9 missing
migrations, and the 3 missing Edge Functions (`send-reply`, `inbound-email`,
`anon-media-upload-token`) were deployed. Re-verified directly afterward —
Sunnvask-demo now matches production/staging's schema and Edge Function set
exactly. Section D testing is no longer blocked.

---

## A. Tenant isolation / hostname-to-config resolution

This is the part of the platform that is categorically new since single-
tenant days (`middleware.js`, Phase 6) and has no jsdom coverage at all —
`middleware.js` is Vercel Routing Middleware, never loaded by `test.js`'s
jsdom harness (which only evals `config.js`, `components.js`, `core.js`, the
three templates, and the public modules — see `test.js` lines 20–24).

| # | Test | Tenant(s) | Coverage | Pass = |
|---|---|---|---|---|
| A.1 | Vibeverk's own hostname(s) resolve to the production tenant's config (colours `#005cff`/`#ff7a00`/`#f7fbff`, correct company name/features) | Vibeverk | Manual only today (real HTTP request against the live hostname) — the Console's own `[data-kd-routing-btn]` → `verify_tenant_routing` (`console-core.js` ~line 2076) does a **real HTTP call per hostname** and is the closest existing tool, but it's a Console button, not a Playwright flow | The Console routing-check result is `routing_ok: true` for every configured hostname, AND a direct curl/browser hit to the hostname serves Vibeverk's own branding, not Sunnvask-demo's or a 404 |
| A.2 | Sunnvask-demo's hostname resolves to Sunnvask-demo's config, not Vibeverk's or any other tenant's | Sunnvask-demo | Same as A.1 — `verify_tenant_routing` in Console, run against the Sunnvask-demo tenant row | Same routing_ok check; additionally confirm the served page's `config.js`-driven branding (company name, theme colours) matches Sunnvask-demo's actual Console config, not a fallback/default |
| A.3 | An unknown/unmapped hostname gets a real "not a customer" response, not a silent fallback to any real tenant's data (`middleware.js` header comment: "too, so an unknown hostname gets a real 'not a customer' response") | Platform-level, no tenant | Manual only — hit a hostname that's deliberately not registered and inspect the response | The response is an explicit not-found/not-configured page, never any tenant's real `config.js`/data |
| A.4 | `resolve_tenant_by_hostname` RPC (`middleware.js` line ~101, called against the control-plane project) returns the correct single row for each of the two tenants' hostnames — no cross-tenant leakage if two hostnames briefly overlap during a config change | Both | New flow needed — sketch: call the control-plane RPC directly (service context, not through a browser) for both known hostnames and assert the returned `tenant_id`/project ref pairs are correct and mutually exclusive | RPC returns exactly one row per hostname, correct `tenant_id`, no row returned for a hostname belonging to the other tenant |
| A.5 | Data isolation at the Supabase layer: Sunnvask-demo's `service_role`/anon key can never read/write Vibeverk production data and vice versa (this is structurally true today since they're separate Supabase projects with separate keys, not a shared-table `tenant_id` filter) | Both | jsdom: not applicable (no cross-project call exists in client code to test) — this is an infra-separation fact, not app logic | Confirm by inspecting `config.js`'s Console-managed `supabase.url`/`anonKey` per tenant are in fact different project refs (already structurally guaranteed by "separate Supabase project per tenant" — verify no code path anywhere hardcodes the production ref outside of `smoke-vibeverk`'s own `PROD_REF` safety guard) |

**Note**: A.1–A.4 have zero existing Playwright coverage. This is the single
largest gap in the current smoke suite relative to what "multi-tenant
platform" now means for this codebase — worth flagging on its own, separate
from the two named open decisions below.

---

## B. Common platform tests (apply to both tenants)

### B1. Public site + mobile responsiveness

| # | Test | Coverage | Pass = |
|---|---|---|---|
| B1.1 | All standard sections render in order, correct nav order | jsdom: `test.js` lines 31–38 (`navrekkefølge korrekt`) — **already covered**, no new work needed | Existing assertion passes |
| B1.2 | Theme colours applied from `config.js` (`--color-primary` etc.) | jsdom: `test.js` line 40–42 — **already covered** for the default config; NOT covered per-tenant against a tenant's actual Console-set colours | For A.1/A.2's live check, additionally confirm computed CSS custom properties on the real page match that tenant's Console config, not defaults |
| B1.3 | Self-hosted Poppins/Nunito Sans, no direct Google Fonts request | jsdom: `test.js` line 44–48 — **already covered** | Existing assertion passes |
| B1.4 | Mobile layout (nav collapse, card stacking, touch targets) at real viewport widths | Manual only, or `run-vibeverk` skill (screenshot-based) — not in `smoke-vibeverk`'s scope (that skill is for authenticated flows) | Screenshot at 375px/768px/1280px shows no horizontal overflow, nav is usable, no overlapping text — human visual judgement, `vibeverk-ux-mobile-reviewer` agent is the right reviewer, not a new Playwright assertion |
| B1.5 | Browser tab shows "Vibeverk" (or the tenant's own name) immediately, before JS runs | jsdom: `test.js` line 51 (`doc.title.includes(...)`) checks post-JS state only; the "before any JS runs" half needs the static `<title>` in `index.html` itself | Read `index.html`'s literal `<title>` tag per tenant — for Sunnvask-demo this needs its actual served HTML, not the shared repo `index.html`, since Console-driven branding is applied at a different layer; needs A.1/A.2 to actually confirm which |

### B2. Contact form

| # | Test | Coverage | Pass = |
|---|---|---|---|
| B2.1 | Contact form validation (required fields, email format) | jsdom-coverable in principle (same pattern as `module-quote.js`'s validation, lines 294–299) — check whether `test.js` already asserts this for the contact module specifically; if not, **new jsdom assertions needed**, not a new Playwright flow | Existing/new jsdom assertion on validation error text and blocked submit |
| B2.2 | A real contact-form submission creates a real lead row | New flow needed — sketch: submit the real anonymous form via `run-vibeverk`-style anonymous flow (tagged `PWTEST-`, per that skill's convention, cleaned up after), then a service-role/staging SQL check that a `leads` row with `kind` for contact exists with the right tag | A `leads` row exists with the submitted content, `kind` correct, and it disappears after the test's own cleanup |
| B2.3 | Fire-and-forget write failure would be silently swallowed pre-fix, now logs to console (`CHANGELOG.md` ~line 1638) | jsdom: not directly (needs a real network failure to trigger); Manual/new flow — force a failure (e.g. bad anon key) and confirm a console.error fires, not silence | A `console.error` appears when the write fails; UI does not falsely show a success message |

### B3. Quote request with attachments — **treat as two separate tests, not one**

This is the section flagged explicitly in the task brief: quote attachments
depend on `anon-media-upload-token`, confirmed **absent** on Sunnvask-demo.
Reading `module-quote.js` lines 305–354 resolves the open question directly:
`Promise.all(st.files.map(f => App.media.putFileAnon(f)))` — if **any**
attachment upload rejects, the whole `.then()` chain never runs and
`App.addLead()` is never called. The code comment at lines 305–310 confirms
this is deliberate ("Promise.all() feiler heilt... i staden for å stille
droppe det"). So on a tenant missing `anon-media-upload-token`, **a quote
request WITH an attachment cannot be submitted at all** — not "submitted
without the attachment." This is a real, code-verified behavior difference
worth testing as its own case, exactly as the task brief requested.

| # | Test | Tenant(s) | Coverage | Pass = |
|---|---|---|---|---|
| B3.1 | Quote request with NO attachment submits successfully | Both | New flow needed — sketch: anonymous flow, fill steps 1–2, no file, submit, assert step-3 receipt renders | A `leads` row exists with `kind: "tilbud"`, no `attachments` |
| B3.2 | Quote request WITH an attachment succeeds end-to-end (upload + lead + attachment reference) | Sunnvask-demo | **Manually executed live 2026-07-19, via real browser automation, not just designed.** First attempt used a deliberately-wrong MIME type (`.txt`) and surfaced a real bug (see below); retried with a valid `.png`, submitted successfully, and the resulting `leads` row (`lead-1784481407317-b4qs`, `pwtest-quote@example.test`) was confirmed directly via SQL to have `attachments: [{ref: ".../media/files/1784481406877-klpwp.png", ...}]`, and that URL was confirmed independently retrievable (`HEAD` → `200 image/png`, 68 bytes). | **PASS**, confirmed both via DB row and live HTTP fetch of the referenced object — not just a filename string. |
| — | *(bug found during B3.2, already fixed)* `Media.putFileAnon()` (`core.js`) previously propagated a raw Supabase Storage error message (e.g. "mime type text/plain is not supported") straight to the visitor when an unsupported attachment type was submitted — a `docs/architecture/copy-style-guide.md` violation. Fixed same day: `core.js` now catches `up.error`, logs the raw detail to console, and rejects with a short internal code (`"storage-upload-failed"`); `module-quote.js`'s catch-handler denylist extended to recognize this new code and show the existing generic upload-failure message instead. Confirmed via SQL that the failed attempt correctly created **zero** `leads` rows (matches B3.3/Promise.all behavior below). **Not yet committed/branched/tested/versioned — still pending as of this writing.** | | | |
| B3.3 | Quote request WITH an attachment on a tenant missing `anon-media-upload-token` fails the WHOLE submission (not just the attachment), and shows the specific user-facing error from `module-quote.js` line 345–351 | N/A today — Sunnvask-demo's gap (missing `anon-media-upload-token`) was closed 2026-07-19 (see Section 0), so no real tenant currently lacks the function. The `Promise.all()`-blocks-whole-submission behavior this test targets was independently confirmed live via the B3.2 MIME-rejection failure above (zero `leads` rows created), so the core mechanism is verified even without a tenant in the missing-function state. | Superseded by direct observation during B3.2 | Confirmed: zero `leads` rows for a rejected attachment upload |

### B4. Booking

The verified-facts file calls this **the single highest-impact possible gap
for the demo tenant** — a silent regression (calendar shows fully-booked
days as available), not an error message, if `get_taken_booking_slots()`
(added in migration `20260718210552`) is missing.

| # | Test | Tenant(s) | Coverage | Pass = |
|---|---|---|---|---|
| B4.1 | Anon booking calendar correctly excludes already-taken slots | Vibeverk | New flow needed — sketch: create a real booking for a known slot (SQL arrange on staging-equivalent, or a real UI booking + cleanup on Vibeverk itself only with extreme care given the no-production-writes-without-approval rule), then load the public booking calendar anonymously and assert that slot is NOT offered | The taken slot does not appear as bookable; `get_taken_booking_slots()` RPC call in Network tab succeeds (200, not a caught/logged error) |
| B4.2 | Same test against Sunnvask-demo | Sunnvask-demo | New flow needed (same sketch as B4.1) — section 0's migration gap (which would have caused this exact silent-regression bug) was confirmed and closed 2026-07-19, so this should now behave identically to B4.1, not demonstrate the old bug | Same pass condition as B4.1 — taken slot correctly excluded, no RPC error logged |
| B4.4 | Booking form validation, date/time picker basic rendering | jsdom-coverable — check `test.js` for existing `module-booking.js` assertions; extend if thin | Existing/extended jsdom assertions |

### B5. Chat widget

The QA agent's own standing checklist (in this repo's `vibeverk-qa` agent
definition) already has a detailed visitor-widget checklist (welcome
message, admin-reply polling via `get_visitor_msgs`, offline-heartbeat
fallback, localStorage resume). This matrix doesn't repeat that in full —
it maps it onto the two real tenants:

| # | Test | Tenant(s) | Coverage | Pass = |
|---|---|---|---|---|
| B5.1 | Full visitor-widget checklist (per `vibeverk-qa` agent's own template) | Both | Manual only (browser-based, `supabase/chat-tests.js` per CLAUDE.md — paste in console while logged in as admin); no existing Playwright flow | Visitor message appears in admin panel within 5s; admin reply appears in widget within 5s via polling, not manual refresh |
| B5.2 | `send-reply` (admin → visitor) exercised for real | Vibeverk only (confirmed present); NOT testable on Sunnvask-demo or staging (confirmed absent both places) | Manual only, production — see "Open decisions" below, this is the named testing-strategy tension | A real reply sent from Web-admin arrives in a real visitor session |
| B5.3 | Offline form shown when admin heartbeat stale (>5 min) | Both | Manual only — needs a real 5-minute wait or a DB-level heartbeat backdate | Offline form renders instead of the live composer after heartbeat goes stale |

### B6. Web-admin and the design-editing module ("sidebygger")

**Correction 2026-07-19**: an earlier version of this matrix (and of
`docs/project/CURRENT_STATE.md`) claimed `features.sidebygger` was `false`
everywhere — that claim was never directly queried, only carried forward
from stale project memory, and was wrong. Directly queried against
`store.superconfig` on both real tenants: **`features.sidebygger` is `true`
on both Vibeverk production and Sunnvask-demo.** The module is live and in
active use, not dormant — B6.2 below is fully testable live today, not
blocked on a scope decision.

| # | Test | Tenant(s) | Coverage | Pass = |
|---|---|---|---|---|
| B6.1 | Web-admin login (`#admin`, `loginWebAdmin()` pattern already in `runner.js` lines 198–211) | Both (existing flow logs into staging only today) | Existing flow: `backup-restore` already exercises `loginWebAdmin()` — reusable as a building block for any new Web-admin flow, not a standalone new flow | Lands on `.admin-catbar`/`.tabs`, no login-form fallback |
| B6.2 | Design/sidebygger module (template switch, tagline/SEO/colours/fonts/logo editing) — live on both real tenants | Both | New flow needed — sketch: log into Web-admin, open Design tab, switch template sub-tab, save, confirm the public site reflects the change | Correct template renders on the public page after save; `store.superconfig.design`/template fields match what was selected in the UI |
| B6.3 | Backup export button + real download (existing) | Both (existing flow: staging only) | **Existing flow: `backup-restore`**, part A of that flow (SKILL.md row, `runner.js` lines 401–422) | Already verified live PASS 2026-07-18; re-run is regression coverage, not new design work |

### B7. CRM and CRM documents (private bucket)

| # | Test | Tenant(s) | Coverage | Pass = |
|---|---|---|---|---|
| B7.1 | CRM customer create/edit via Workspace UI, real Supabase write | Both | Partially covered as a byproduct of the existing `crm-documents` flow (creates a throwaway customer as setup, `runner.js` lines 533–547) — not a standalone assertion of CRM write correctness beyond that | A `crm_customers` row exists with the submitted fields, matches what the UI displayed |
| B7.2 | CRM document upload to the private `crm-documents` bucket, `crmdoc:`-prefixed reference, signed-URL resolve-on-click | Both — bucket migration `20260718113648` now present on all three of production/staging/Sunnvask-demo since the section-0 gap closed 2026-07-19 | **Existing flow: `crm-documents`** (SKILL.md row, `runner.js` lines 530–641) — currently only runs against staging via the config-swap; a Sunnvask-demo-targeted config-swap variant would be needed to run it there directly | Already verified live PASS 2026-07-18 on staging; Sunnvask-demo now has the bucket too, so a run there should pass the same way, not fail for a known-gap reason anymore |
| B7.3 | CRM "Svar" reply (outbound email via `send-reply`) | Vibeverk and Sunnvask-demo now both have `send-reply` (staging still doesn't, since 2026-07-19's gap closure) | Manual only — same named tension as B5.2, though Sunnvask-demo now lowers the blast radius vs. testing only against Vibeverk's real business | A real outbound email is sent and received at a real inbox |

### B8. Workspace: roles (admin/editor/member), tasks, user administration

| # | Test | Tenant(s) | Coverage | Pass = |
|---|---|---|---|---|
| B8.1 | Invite member → member gets correct default role, admin-only UI (e.g. user-admin panel itself) hidden from non-admins | Both | Partially covered: **existing flows `user-deletion` and `backup-restore`** both invite a throwaway member via the real UI, but neither logs in AS that member (SKILL.md explicitly notes: "this suite never completes a real login for an invited member — no password/magic-link step exists here") — so role-gated UI visibility is **not** actually exercised yet | New flow needed to close this gap — sketch: after inviting, use Supabase Admin API `generateLink`/magic link (same technique the skill notes as the right approach for Console OTP bypass) to obtain a real session as that member, then assert admin-only nav items are absent |
| B8.2 | Editor role: correct subset of permissions (can edit but not manage users, e.g.) | Both | New flow needed — same login-as-a-real-non-admin gap as B8.1, applied to `role='editor'` | Same technique as B8.1; assert editor-appropriate UI is visible, admin-only UI is not |
| B8.3 | Task creation/completion, real Supabase write | Both | Byproduct-covered by `user-deletion`/`backup-restore` (both create a real task row via SQL arrange, not via the UI's own task-creation form) — the **UI's own task-create form** is not directly exercised by an existing flow | New flow needed (small) — sketch: real UI task creation, assert `tasks` row appears with correct `status`/`created_by` |
| B8.4 | User deletion FK-nulling regression (`20260712203346`) | Both (currently staging only) | **Existing flow: `user-deletion`** — already implemented and verified live PASS 2026-07-17 | Task survives with `created_by` NULL after real UI removal — already proven, re-run is regression coverage |
| B8.5 | Dashboard shortcuts (announcement/KB editor opens immediately, no race) | Both (currently staging only, requires `intranettFeatures.kb: true` which the flow force-enables for its own run) | **Existing flow: `dashboard-shortcuts`** — already implemented and verified live PASS 2026-07-17 | Editor selector appears immediately post-navigation, no manual retry — already proven |

---

## C. Vibeverk-specific tests (production-only concerns)

These only matter because Vibeverk is the real, live business — not
applicable to a demo tenant.

| # | Test | Coverage | Pass = |
|---|---|---|---|
| C.1 | A real customer inquiry (contact/quote/chat) reaches a real human via the real notification path, with no delay or silent drop | Manual only, production — cannot safely be automated (real customer-facing inbox, real timing) | A real test inquiry, clearly marked as a test in its content, is received by the actual configured recipient within the expected window |
| C.2 | Real inbound email (`inbound-email` function, confirmed present in production only) processes correctly into the CRM/lead flow | Manual only, production — **this is the named testing-strategy tension** (see "Open decisions" below); cannot be exercised on staging or Sunnvask-demo today | A real inbound email creates the correct CRM comm/lead entry, correctly associated, with the message body/attachments intact |
| C.3 | Real outbound reply (`send-reply`) delivers to a real external inbox, correct sender identity/DMARC (per CHANGELOG's DMARC fix, Batch 1-4 review) | Manual only, production — same tension as C.2/B5.2/B7.3 | Email arrives at a real external inbox, passes DMARC, correct From/Reply-To |
| C.4 | Production migration/function set matches the repo exactly (already directly confirmed this session — 19/19 migrations, all 4 functions ACTIVE) | Already verified — no new test needed, just keep re-confirming after each future migration lands | `schema_migrations` row count and Edge Functions list match repo state, per the same query pattern used this session |
| C.5 | No leftover `PWTEST-`/`SMOKETEST-` tagged rows exist in **production** (this suite's own tagging convention exists specifically so staging residue is identifiable — production should have zero, since neither suite is meant to touch it) | New flow needed (or a one-off manual query) — sketch: a read-only SQL check for any row across the tagged tables matching either prefix | Zero rows match `PWTEST-%` or `SMOKETEST-%` in any production table |

---

## D. Sunnvask-demo-specific tests (presentable-demo concerns)

Section 0's migration+function gap is closed (2026-07-19) — these tests are
now meaningful as genuine demo-readiness checks, not just "confirming known
debt."

| # | Test | Coverage | Pass = |
|---|---|---|---|
| D.1 | No leftover test/dev data visible anywhere a prospective customer would see during a live demo (CRM customer list, bookings calendar, chat history, references section) | Manual only — inherently a presentability/visual judgement call | A walkthrough of every customer-facing and admin-facing list shows only intentionally-curated demo content, nothing that reads as "test123" or an abandoned experiment |
| D.2 | Demo content (services, references, FAQ, media) is coherent and complete, not placeholder text | Manual only | Same as D.1 — human judgement, good candidate for `vibeverk-ux-mobile-reviewer` |
| D.3 | Stability: no console errors on a full click-through of the public site + Workspace login (the specific silent-failure paths a migration gap would have triggered — booking RPC, CRM-doc upload, quote-attachment submission — should no longer reproduce now that section 0 is closed; if any of them DO still appear, that's now a genuine new finding, not known debt) | Combination of the flows above (B3.3, B4.2, B7.2) once pointed at Sunnvask-demo, plus a `run-vibeverk`-style anonymous click-through for the rest | Zero unexpected console errors |
| D.4 | Sunnvask-demo hostname resolves correctly (see A.2) — a demo is worthless if it accidentally serves the wrong tenant's data to a prospect watching over someone's shoulder | Same as A.2 | Same pass condition as A.2 |

---

## E. Console: onboarding checklist and support-access generation

| # | Test | Coverage | Pass = |
|---|---|---|---|
| E.1 | Onboarding checklist flow end-to-end for a **new, disposable** control-plane tenant row (not Sunnvask-demo itself — Sunnvask-demo is already onboarded; re-running onboarding against it would be destructive/confusing) | Explicitly flagged in SKILL.md's own "What this does NOT cover yet" section — not started, and rightly called "categorically more invasive than everything else here" | A disposable tenant reaches `status: active` only after `routing_verified_at` is genuinely set (per `console-core.js`'s own comment, lines 1704–1711, `activate_tenant` unconditionally rejects until then) |
| E.2 | Console OTP login gate (`operators.status = 'active'` checked post-verification, per CLAUDE.md) | Manual only, or a new flow using Admin API `generateLink` to bypass real OTP email delivery (same technique SKILL.md recommends for E.1) | A deactivated operator is rejected post-OTP, not pre-OTP (i.e., the OTP itself must still succeed before the gate is checked) |
| E.3 | `generate_support_access` (`console-core.js` line 2069) produces a working, time-limited support-session link for a real tenant | New flow needed — sketch: call `tenantAdminCall("generate_support_access", ...)` via the real Console UI for one of the two real tenants, follow the returned `action_link`, confirm it lands in an authenticated support session scoped to that tenant only | The link authenticates into the correct tenant's data, expires per its stated lifetime, and does not grant access to any other tenant |
| E.4 | `verify_tenant_routing` button (used above for A.1/A.2) | Already usable as-is via the Console UI — no new flow needed, just use it as the mechanism for A.1/A.2 | See A.1/A.2 |

---

## F. Backup export and safe restore (staging only, never production)

Already substantially covered — this section is mostly "keep doing what
exists," not "build something new."

| # | Test | Coverage | Pass = |
|---|---|---|---|
| F.1 | Export completeness (all 9 tables as arrays, including empty) | **Existing flow: `backup-restore`**, part A | Already verified live PASS 2026-07-18 |
| F.2 | Real export button + real browser download, correct file shape (`vibeverk_backup`, `version: 2`) | **Existing flow: `backup-restore`**, part A | Already verified live PASS 2026-07-18 |
| F.3 | Restore with a since-deleted author reference correctly nulls `created_by`, no FK violation | **Existing flow: `backup-restore`**, part D | Already verified live PASS 2026-07-18 |
| F.4 | Corrupted-mid-insert payload is fully rolled back (the 2026-07-06 BLOCKER regression) | **Existing flow: `backup-restore`**, part C — described in SKILL.md/runner.js as "the centerpiece regression test" | Already verified live PASS 2026-07-18; this is the row-count-unchanged-after-rejected-restore assertion (`runner.js` lines 474–488) |
| F.5 | Never run against production — standing rule | Enforced structurally by `swapConfigToStaging()`'s hard safety guard (`runner.js` lines 94–138: refuses to proceed unless the written `config.js` contains the staging ref and does NOT contain `PROD_REF`) | The guard's own `process.exit(1)` paths are themselves worth an occasional dry-run confirmation (deliberately break the swap once in a throwaway branch and confirm it refuses to proceed) — not a live-tenant test, a tooling self-test |

Note: F.1–F.4 exist today only against `vibeverk-staging`. They are NOT
run-able against Sunnvask-demo without either (a) building a Sunnvask-demo
config-swap variant of `runner.js` (its own blast-radius warning in SKILL.md
applies equally there — restore mirror-overwrites all nine tables for the
whole project), or (b) accepting staging as a structurally-equivalent proxy
since both share the same schema. Given backup/restore is inherently
destructive-by-design and Sunnvask-demo is a live, presentable demo tenant
(per section D), **staging-as-proxy is the recommended default** — actually
restoring over Sunnvask-demo's curated demo data would defeat section D's
own purpose. This isn't listed as an open decision needing a user call
because the "never destructive on a presentable tenant" reasoning is
unambiguous; flagged here only so it isn't silently assumed.

---

## Open decisions needing a user call

These are surfaced explicitly, per the task brief, not silently routed
around:

1. **RESOLVED 2026-07-19**: Sunnvask-demo now also has `send-reply` and
   `inbound-email` deployed (see item 2 below), so email flows can be
   exercised there instead of only on production — a real tenant but not
   the live business, lowering the blast radius of a testing mistake.
   `vibeverk-staging` still lacks both functions. Still an open call: deploy
   them to staging too (mirrors production exactly, lets B5.2/B7.3/C.2/C.3
   move into the normal staging-safe suite), or treat Sunnvask-demo as the
   standing answer to this tension and leave staging as-is.

2. **RESOLVED 2026-07-19**: Sunnvask-demo's migration state was confirmed
   directly (pooler connection string obtained) — it was genuinely 9
   migrations behind, exactly as inferred (stuck at `20260714133000`). Both
   the migrations and the 3 missing Edge Functions have been deployed and
   re-verified; Sunnvask-demo now matches production/staging exactly.
   Section 0's prerequisite gate is cleared — section D testing is no
   longer blocked.

3. **RESOLVED 2026-07-19 — was based on a stale, never-directly-queried
   claim.** `features.sidebygger` is actually `true` on both real tenants
   (confirmed by direct query against `store.superconfig`, after the user
   spotted the module live in their own admin panel and questioned the
   earlier claim). B6.2 is fully testable live today — no scope decision
   needed, it was simply a documentation error, not an actual gap. See the
   correction note under section B6 above.

4. **B8.1/B8.2 (role-gated UI for a real non-admin session)** — no flow in
   `smoke-vibeverk` today ever completes a real login as an invited member;
   every existing flow only arranges data via direct SQL for that member,
   never authenticates as them. Closing this requires the same
   `generateLink`-style Admin API technique SKILL.md already recommends for
   Console OTP bypass (E.1/E.2) — flagging the reuse opportunity, not
   proposing new tooling here.

---

## Summary of what's genuinely new vs. already covered

- **Fully covered by existing flows, just needs re-running per tenant
  status**: F.1–F.4 (backup-restore), B8.4 (user-deletion), B8.5
  (dashboard-shortcuts), B7.2 for Vibeverk/staging (crm-documents).
- **Biggest real gap**: section A (tenant isolation/hostname resolution) —
  zero existing Playwright coverage, and it's the one category of test that
  didn't exist at all in the single-tenant era, so there's no old flow to
  extend.
- **Second biggest gap**: logging in AS a real non-admin/non-owner session
  (B8.1/B8.2, E.1/E.2) — every existing flow only ever authenticates as an
  admin/editor and arranges other users' data via direct SQL, never actually
  becomes them.
- **Correctly un-automatable**: C.1–C.3 (real customer/human-facing
  outcomes), D.1/D.2 (presentability judgement), B1.4 (visual mobile
  review), B5.1/B5.3 (real-time/timing-dependent chat behavior).
