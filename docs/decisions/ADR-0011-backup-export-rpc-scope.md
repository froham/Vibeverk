# ADR-0011: `export_backup_tables()` closes the admin-enforcement gap, not the underlying broad-read model

**Status:** Accepted
**Date:** 2026-07-15

## Context

A Privacy/Compliance Advisor review of the Web-admin "Sikkerhetskopi" (backup/restore) feature found that `buildBackupPayload()` in `core.js` — which assembles a full export across nine tables (`crm_bedrifter`, `crm_customers`, `crm_comms`, `leads`, `bookings`, `tasks`, `announcements`, `kb_articles`, `links`) — was reachable from any authenticated browser console session (`window.App.buildBackupPayload()`), regardless of role. The "Sikkerhetskopi" UI tab is only ever shown to `admin`, but nothing in the database enforced that: SELECT RLS on all nine tables is `USING(true)` for `authenticated`, a pre-existing and deliberate design choice (confirmed 2026-07-13) so that `editor`/`member` can browse CRM, tasks, announcements, etc. normally. The restore/write side already had a real admin gate (`restore_backup_tables()`, `is_admin_or_owner()`), but the export/read side had none.

When this was raised with the user, they initially asked for clarification: doesn't `member` need to see customer history etc.? The distinction that resolved this: normal UI browsing (a member opening the CRM tab, scrolling a customer list) is intended and unchanged. What was ungated was the ability to pull the *entire* dataset across *all nine tables* in a single operation via the console — a fundamentally different action from browsing, even though both ultimately rest on the same underlying `SELECT` grant.

A further, harder constraint surfaced during design: because RLS SELECT must stay open on these tables for legitimate browsing to keep working, no database-level change can prevent a technically able `member`/`editor` from manually querying each of the nine tables directly (nine separate calls) and reassembling the same full dataset by hand. This is a structural property of the already-confirmed "member reads everything" role model (see `docs/architecture/roles-and-tenants.md`), not something a single RPC can close without revisiting that model — which was explicitly not on the table for this change.

## Decision

Add `export_backup_tables()`, a `SECURITY DEFINER STABLE` Postgres function gated by `is_admin_or_owner()` — the same access-boundary pattern already used by `restore_backup_tables()`. `core.js`'s `buildBackupPayload()` now calls this RPC (`_sb.rpc("export_backup_tables")`) instead of issuing nine separate per-table `.select("*")` calls.

Explicitly scoped as: this closes the inconsistency where the backup *feature* claims (via its UI) to be admin-only but had no matching database enforcement — brought to parity with its own restore counterpart. It does **not** attempt to prevent a `member`/`editor` from manually querying the nine tables directly and reassembling the same data — that would require tightening the underlying per-table RLS, which would break normal CRM/task/announcement browsing for those roles and was a deliberate, separate, already-settled decision this ADR does not reopen.

## Consequences

- The one-call, whole-dataset export is now genuinely admin-only, verified live in production (`has_function_privilege('authenticated', 'export_backup_tables()', 'EXECUTE')` = true, same for `anon` = false; `SECURITY DEFINER`/`STABLE` confirmed via `pg_proc`).
- A `member`/`editor` can still reconstruct the same dataset via nine direct table queries — this is a known, accepted limitation, not an oversight, and should not be re-flagged as a fresh finding by a future review without first checking this ADR.
- If broader data-minimization for `member`/`editor` is wanted later (i.e., restricting what they can read at all, not just how conveniently), that is a new, deliberate product decision requiring its own ADR and Architect consultation — it would mean revisiting the 2026-07-13 role model, not extending this one.
- Reviewed by a general-purpose agent standing in for Security Auditor (the real persona is Codex-only in this repo, `.codex/agents/vibeverk-security-auditor.toml`) — no findings.

## Evidence

`supabase/migrations/20260715140000_export_backup_tables_rpc.sql`, `supabase/migrations/20260713104738_restore_backup_tables_rpc.sql` (the sibling pattern this mirrors), `core.js` (`fetchAllTables()`, `buildBackupPayload()`), `docs/architecture/roles-and-tenants.md` (the underlying role model this decision deliberately does not change), `docs/project/CHANGELOG.md` 0.35.1.
