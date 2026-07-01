# ADR-0001: Documentation governance model

**Status:** Accepted
**Date:** 2026-07-01

## Context

Vibeverk's documentation had grown organically: a good, actively-maintained `docs/architecture/`, `docs/security/` and `docs/compliance/` structure existed, but there was no single place explaining which document is authoritative for which kind of fact. A roadmap document (`docs/roadmap/README.md`) mixed completed work and future plans in one file, risking future work being justified by reference to a "done" item that was actually only planned, or vice versa. There was no decision-record system at all — the closest analog was a single freeform dated note (`docs/arkitekt-notat-steg2.md`). Two AI-facing instruction files (`CLAUDE.md`, `AGENTS.md`) had already drifted slightly out of sync with each other (different known-failing-test names). Across multiple sessions, the same class of problem kept recurring: a new session or a subagent had no reliable way to know what was current reality, what was a settled decision, what was history, and what was just an idea.

The user requested (via a structured brief) a durable governance model to fix this, explicitly scoped to documentation and agent configuration only — no application code, schema, secrets or production changes.

## Decision

Adopt a strict source-of-truth hierarchy, documented centrally in `docs/README.md`:

1. Runtime behavior, application code, configuration, database schema and tests are the primary source of truth for what the system actually does.
2. Git history is the source of truth for historical code changes.
3. Accepted ADRs (this folder) are the source of truth for deliberate, long-lived technical/product decisions.
4. `docs/project/CURRENT_STATE.md` is the concise, verified summary of current implemented capability — not a wishlist.
5. `docs/architecture/*.md` explains current implementation and must be updated when reality changes.
6. `docs/project/CHANGELOG.md` summarizes meaningful changes but never replaces Git history.
7. `docs/roadmap/ROADMAP.md` is planning material only — never proof of implemented functionality.
8. Any fact not verifiable from the repository must be explicitly marked `External verification required`, `Assumption`, `TBD`, or `Not implemented`.
9. `docs/archive/` holds superseded/migrated documents and is never authoritative.

Introduce a matching agent team with an explicit division of labor: the main Builder session owns first-pass documentation updates; a new read-write, docs-only **Project Historian** agent (`.claude/agents/vibeverk-project-historian.md`) verifies documentation against actual code/diff after meaningful changes and flags contradictions rather than silently "fixing" them by inference; existing read-only auditors (Codex Reviewer, Security Auditor, Privacy/Compliance Advisor, UX/Mobile Reviewer) are preserved and, where needed, tightened to require inspecting actual code/diff before accepting any documentation claim as proof.

## Consequences

- Future sessions and subagents have one place (`docs/README.md`) to orient from, rather than needing full conversation history or private memory.
- Completed work and future plans are now structurally separated (`CURRENT_STATE.md` vs. `ROADMAP.md`), reducing the risk of treating a plan as a fact or vice versa.
- This is a real, one-time migration cost: `docs/roadmap/README.md` (which mixed done/planned content) was archived after extracting its content, and `docs/CHANGELOG.md` was relocated to `docs/project/CHANGELOG.md`. A stray code comment in `console/console-core.js` still references the old changelog path — intentionally left unchanged since fixing it would require touching application code, which was out of scope for this task. Flagged here so it isn't forgotten.
- `CLAUDE.md` and `AGENTS.md` remain two manually-synced files rather than one generated source — this ADR does not solve that duplication, only documents it as a known limitation (see `docs/project/CURRENT_STATE.md`).
- No automation (hooks, CI checks, automatic agent invocation) was introduced — this governance model is manual-first by design for its initial version (see the `vibeverk-handoff` skill). A lightweight future safeguard (e.g. a check that warns when meaningful code changes ship without an accompanying documentation review) was recommended but not implemented.

## Evidence

`docs/README.md`, `docs/project/CURRENT_STATE.md`, `docs/project/CHANGELOG.md`, `docs/roadmap/ROADMAP.md`, `docs/archive/`, `.claude/agents/vibeverk-project-historian.md`, `.claude/skills/vibeverk-handoff/SKILL.md`, `CLAUDE.md` / `AGENTS.md` ("Versioning and changelog" / documentation-workflow sections).
