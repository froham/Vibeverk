---
name: smoke-vibeverk
description: Repeatable Playwright smoke-test suite for Vibeverk's AUTHENTICATED flows (Workspace/Web-admin login, dashboard shortcuts, user deletion, backup/restore, CRM, Console onboarding), run against vibeverk-staging — NEVER production. Use when asked to smoke-test the platform, verify a regression didn't reappear, or re-validate core flows after a customer onboarding. Distinct from `run-vibeverk` (anonymous flows only, always points at production).
---

**⚠️ NEVER point this at production.** This suite logs in as a real admin/editor and performs real writes (dashboard shortcuts, user deletion, backup/restore round-trips) — the blast radius of a mistake here is much larger than `run-vibeverk`'s tagged anonymous leads. Every run swaps the repo-root `config.js` for a version pointed at `vibeverk-staging` (ref `syqnyfeponexmkdvnsga`), runs, then restores the original file — see "Safety guard" below for the code-level check that refuses to proceed if that swap didn't work.

ROADMAP.md "Next" item 5. Design reviewed by the QA agent 2026-07-16 before any code was written (see `docs/project/CHANGELOG.md` for that session). Companion to `.claude/skills/run-vibeverk/` (anonymous flows, hardcoded to production) — kept as a **separate** skill directory specifically so a staging-only, config-swapping suite is never confused with the "always production" one.

## Prerequisites

- Everything `run-vibeverk`'s SKILL.md prerequisites list (Node, Playwright browser binary).
- Two env vars, **never committed anywhere**:
  ```
  VW_STAGING_SUPABASE_URL=https://syqnyfeponexmkdvnsga.supabase.co
  VW_STAGING_SUPABASE_ANON_KEY=<the real anon key for vibeverk-staging>
  ```
  Get the anon key from Supabase Dashboard → `vibeverk-staging` project → Project Settings → API (or `npx supabase projects api-keys --project-ref syqnyfeponexmkdvnsga` — **only run that yourself**, an agent fetching/printing this key without you explicitly asking for it in-session will be blocked by the harness's own credential-exposure guard, by design).
- A real admin test account on `vibeverk-staging`. **Not confirmed to exist yet as of 2026-07-16** — the last known staging test user (2026-07-13) was deliberately created-then-deleted as part of a one-off manual test, not left in place. Check first:
  ```
  npx supabase db query --db-url "<staging pooler connection string>" --file <check-users>.sql
  ```
  If none exists, create one via Supabase Dashboard → Authentication → Users → Invite (or the Admin API), set its `public.users.role = 'admin'` directly, and set:
  ```
  VW_STAGING_ADMIN_EMAIL=...
  VW_STAGING_ADMIN_PASSWORD=...
  ```

## How the config-swap works

`runner.js` never edits `config.js` in place and leaves it changed — it:
1. Reads the real `config.js`, keeps an in-memory copy of the original text.
2. Writes a modified copy to disk: only `supabase.url`, `supabase.anonKey`, and `storageKey` are replaced (with `VW_STAGING_SUPABASE_URL`/`VW_STAGING_SUPABASE_ANON_KEY`/`"nordpunkt-smoketest"` respectively) — every other field (company name, colors, features, etc.) stays whatever's in the repo, since the point is testing Vibeverk's own code against a different backend, not a different brand.
3. **Safety guard**: immediately re-reads the file it just wrote and asserts it does NOT contain the production ref (`clzczbyklgdtdhgjphup`) and DOES contain the expected staging ref — refuses to run any flow otherwise (`process.exit(1)`), rather than trusting the swap silently succeeded.
4. Runs the requested flow(s).
5. **Always** restores the original `config.js` content in a `finally` block, even if a flow throws — verified by comparing the restored file's content back to the in-memory original before exiting.

If a previous run crashed hard enough to skip step 5 (shouldn't happen given the `finally`, but check first): `git diff config.js` — if it shows the staging URL instead of production, `git checkout -- config.js` before doing anything else.

## Run

```powershell
# Terminal 1 (repo root) — same static server run-vibeverk uses
npx --yes http-server -p 8080 -c-1

# Terminal 2
$env:VW_STAGING_SUPABASE_URL="https://syqnyfeponexmkdvnsga.supabase.co"
$env:VW_STAGING_SUPABASE_ANON_KEY="..."
$env:VW_STAGING_ADMIN_EMAIL="..."
$env:VW_STAGING_ADMIN_PASSWORD="..."
node .claude/skills/smoke-vibeverk/runner.js dashboard-shortcuts
```

| flow | status | what it proves |
|---|---|---|
| `dashboard-shortcuts` | **implemented** | Dashboard's "Ny kunngjøring"/"Ny artikkel" shortcuts open the editor immediately on navigation (the `_annOpenNew()`/`_kbOpenNew()` flag pattern), not just eventually — this was a real, previously-shipped race-condition bug (see `docs/project/CHANGELOG.md` 0.32.x) |
| `user-deletion` | not yet built | Next in the QA-recommended build order — create a throwaway member via Admin API, assign them a task as the admin driver account, delete them via the real Workspace UI, assert authored content survives (author reference nulled, not the row dropped) |
| `backup-restore` | not yet built | Snapshot-restore-self pattern: `export_backup_tables()` at start, mutate, `restore_backup_tables()` with the original snapshot at the end — self-healing, never leaves staging in a different state than it started |

Exit code is non-zero on any flow failure (unlike `run-vibeverk`'s driver, which always exits 0) — this is deliberate, so a future cron/`schedule` wrapper can detect failure without a redesign.

## Cleanup convention

Any row this suite creates is tagged `SMOKETEST-<timestamp>` (deliberately a different prefix than `run-vibeverk`'s `PWTEST-`, so the two are never confused if both leave residue in the same project). Every flow that creates something tears it down in the same run's `finally` block — this suite should never require a manual cleanup query the way `run-vibeverk` documents for its anonymous flows.

## What this does NOT cover yet

Console's onboarding checklist (needs its own disposable control-plane tenant row + a way to bypass real email OTP delivery — recommended approach: Supabase Admin API's `generateLink` from a Node-side helper, never exposed to the browser) is explicitly last in the QA-recommended build order, given it's categorically more invasive than everything else here. Not started.
