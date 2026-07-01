---
name: vibeverk-handoff
description: Reusable handoff workflow for Vibeverk after meaningful completed work. Inspects the Git diff, classifies the change, requires documentation updates, recommends the Project Historian and the correct review path (Reviewer / Architect / Security Auditor / Privacy Advisor / UX-Mobile Reviewer), and produces a compact handoff summary. Use after meaningful completed changes — not after every tiny CSS or text tweak.
---

# Vibeverk Handoff

A manual, repeatable close-out workflow for the end of a meaningful chunk of work in the Vibeverk repository. It does not run automatically after every edit — invoke it deliberately once a change is functionally complete, before moving on or reporting back to the user.

## When to use this

Use after: a completed feature, a bug fix that changes behavior, a data-model or storage change, an auth/role/tenant change, a security-sensitive change, or a meaningful UI/module/layout change.

Do **not** use after: a typo fix, a copy tweak, a single CSS value adjustment, or other cosmetic micro-edits with no behavioral effect.

## Workflow

### 1. Inspect the Git diff

Run `git status` and `git diff` (or review the specific files changed in this session) to get the actual, concrete set of changes — not a summary from memory.

### 2. Classify the change

For each area below, decide yes/no based on the diff, not assumption:

- **Current functionality** — does user-visible behavior change?
- **Architecture** — does this change module boundaries, data flow, or how surfaces (Web/Workspace/Console) interact?
- **Data/storage** — new/changed localStorage keys, Supabase tables/columns, or data shape?
- **Roles/tenant behavior** — anything touching `owner`/`admin`/`editor`/`member`, tenant isolation, or per-customer feature flags?
- **Security** — auth, RLS, secrets, APIs, webhooks, file storage/sharing, third-party integrations, payments?
- **Privacy/compliance** — collection, storage, sharing, analysis or exposure of personal data?
- **Roadmap** — does this resolve, invalidate, or otherwise affect something in `docs/roadmap/ROADMAP.md`? (Note: do not change roadmap priorities yourself unless the user explicitly asked — flag it instead.)

### 3. Require documentation updates (Builder's job, first-pass)

Before calling this done, update the relevant `docs/` files yourself for anything classified "yes" in step 2 — typically `docs/architecture/*.md`, `docs/project/CURRENT_STATE.md`, and `docs/project/CHANGELOG.md` (with a version bump per `CLAUDE.md`/`AGENTS.md`'s versioning rules). Do not touch `docs/roadmap/ROADMAP.md` priorities without explicit instruction. Do not write an ADR unless a real, confirmed decision was made (see `docs/decisions/README.md` criteria) — if unsure, leave it for the Project Historian to flag rather than fabricate one.

### 4. Recommend or invoke the Project Historian

For any change classified "yes" on functionality, architecture, data/storage, roles/tenant, security, or privacy — recommend (or directly invoke) the **Project Historian** (`.claude/agents/vibeverk-project-historian.md`) to verify your first-pass documentation updates actually match the code and flag anything you missed or got wrong.

### 5. Recommend the correct review path

Based on the classification in step 2:

| Classification | Review path |
|---|---|
| Ordinary change (bug fix, small feature, no flags above) | Codex Reviewer (`vibeverk-reviewer`) |
| Major architecture / data-model change | Architect (`vibeverk-architect`) **then** Codex Reviewer |
| Security-sensitive (auth, roles, RLS, storage, APIs, webhooks, integrations, payments, customer data) | Security Auditor (`vibeverk-security-auditor`) **and** Privacy/Compliance Advisor (`vibeverk-privacy-compliance`) **and** Codex Reviewer |
| Meaningful UI/module/modal/layout/responsive change | UX and Mobile Reviewer (`vibeverk-ux-mobile-reviewer`) |

A change can hit more than one row — recommend all that apply.

### 6. Produce a compact handoff summary

End with a short, structured summary:

```
## Handoff summary

**Changed files:** <list>
**Documentation updated:** <list, or "none needed">
**Reviews/audits recommended:** <list, or "none — ordinary low-risk change">
**Manual tests required:** <list, or "none beyond automated test suite">
**Open decisions:** <anything still needing user input, or "none">
**External verification required:** <anything needing checking against a live system, or "none">
**Status:** Ready to test | Ready after fixes | Blocked
```

Keep it compact — this is a handoff note, not a full report. If a full report already exists (e.g. from a security audit that was run), link to it rather than repeating it.

## What this workflow deliberately does not do

It does not run automatically. There is no hook, no CI job, and no automatic invocation of any agent after every edit — this is a manual step you take at natural completion points. See `docs/decisions/ADR-0001-documentation-governance.md` for why (a lightweight automated safeguard was considered but intentionally deferred).
