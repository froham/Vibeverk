# Vibeverk Documentation Map

This is the central index for Vibeverk's documentation. It exists so any person, agent or subagent — in this session or a future one — can quickly answer: *what is verified current reality, what has been deliberately decided, what changed over time, what is only planned, and what is unknown?*

## Source-of-truth order

When documentation and something else disagree, resolve in this order:

1. **Runtime behavior, application code, configuration, database schema and tests** are the primary source of truth for what the system actually does. When in doubt, read the code.
2. **Git history** is the source of truth for historical code changes (`git log`, `git blame`) — not this documentation.
3. **Accepted ADRs** (`docs/decisions/`) are the source of truth for deliberate, long-lived technical and product decisions.
4. **[`docs/project/CURRENT_STATE.md`](project/CURRENT_STATE.md)** is the concise, verified summary of current implemented capability.
5. **[`docs/architecture/`](architecture/README.md)** explains current implementation — it must be updated when reality changes, and should never describe desired future behavior as if it were current.
6. **[`docs/project/CHANGELOG.md`](project/CHANGELOG.md)** summarizes meaningful changes but is not a replacement for Git history.
7. **[`docs/roadmap/ROADMAP.md`](roadmap/ROADMAP.md)** is planning material only — it must never be treated as proof of implemented functionality, architecture, security posture or customer commitments.
8. Any fact that cannot be verified from this repository must be marked clearly as one of:
   - `External verification required` — needs checking against a live system (Supabase Dashboard, DNS, a signed contract, etc.)
   - `Assumption` — plausible but not confirmed
   - `TBD` — genuinely undecided
   - `Not implemented` — explicitly does not exist yet, regardless of what may be planned or discussed

**[`docs/archive/`](archive/README.md) is never authoritative.** It holds superseded or migrated documents, kept for historical context only. If a link from an old conversation, commit message or memory file points into `archive/`, follow the pointer at the top of that file to the current canonical document instead.

## Folder guide

| Folder | Purpose |
|---|---|
| [`architecture/`](architecture/README.md) | How Vibeverk is actually built today (system overview, module conventions, storage/data flow, roles/tenancy) |
| [`decisions/`](decisions/README.md) | ADRs — deliberate, long-lived decisions, with context and consequences |
| [`project/`](project/CURRENT_STATE.md) | `CURRENT_STATE.md` (verified status) and `CHANGELOG.md` (dated log of meaningful changes) |
| [`roadmap/`](roadmap/ROADMAP.md) | Planning material only — Current focus / Next / Later / Ideas |
| [`security/`](security/security-baseline.md) | Verified security posture, known risks, and a pre-release checklist |
| [`compliance/`](compliance/README.md) | GDPR/privacy workflow templates — not legal advice, not a substitute for qualified legal review |
| [`archive/`](archive/README.md) | Superseded/migrated documents — never authoritative |

## Documentation migration summary

Performed 2026-07-01 as part of introducing this governance model (see `docs/decisions/ADR-0001-documentation-governance.md`). Application code, Supabase configuration, deployment settings and production resources were **not** touched — this was a documentation- and agent-configuration-only change.

| Old document | New canonical location | Outcome |
|---|---|---|
| `docs/roadmap/README.md` (mixed done + planned content) | `docs/project/CURRENT_STATE.md` (done) + `docs/roadmap/ROADMAP.md` (planned) | Content extracted into both; original moved to `docs/archive/roadmap-2026-07-01.md` with a supersession note |
| `docs/CHANGELOG.md` (untracked, created earlier the same day) | `docs/project/CHANGELOG.md` | Moved, content preserved 1:1, routine text updated for the new path |
| Root `README.md`'s inline roadmap table | `docs/roadmap/ROADMAP.md` + `docs/project/CURRENT_STATE.md` | Retained as an active project README (required by tooling/convention), but the table was replaced with a short pointer to avoid two roadmap tables drifting apart (the old table's step numbering had already drifted from `docs/roadmap/README.md`'s) |
| `docs/architecture/storage-and-data-flow.md` + `docs/architecture/roles-and-tenants.md` | Retained as-is, jointly | The requested `data-and-tenancy.md` file was **not** created — these two existing, well-maintained documents already cover that scope, split by topic. Merging them into one new file would have lost that separation for no benefit. `docs/architecture/README.md` now states this mapping explicitly. |
| `docs/arkitekt-notat-steg2.md` | Retained as-is | Still a useful point-in-time design discussion note (analytics page design, theme-editor concept, PWA evaluation — none yet decided). Not archived: it isn't superseded, it's simply informal and pre-dates the ADR system. Its one *accepted and implemented* sub-decision (Resend + Edge Function for outbound email) is now separately recorded as `docs/decisions/ADR-0002-crmfull-email-tiering.md`. |
| `CLAUDE.md`, `AGENTS.md` | Retained, both updated in parallel | These remain two separate, manually-synced files (one per AI harness) — this restructuring did not merge them, only kept their content aligned and added the new documentation-governance workflow rules to both. Recorded as a known limitation in `docs/project/CURRENT_STATE.md`. |

### Documents inspected and left unclassified/unchanged

None. Everything found during the inventory (`docs/security/`, `docs/compliance/`, `docs/architecture/system-overview.md`, `docs/architecture/module-conventions.md`) was already current, non-duplicative, and did not overlap with the new structure — no action needed.
