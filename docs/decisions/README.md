# Architecture Decision Records (ADR)

This folder records deliberate, long-lived technical and product decisions — not implementation details, not roadmap items, not code patterns that simply happen to exist today. Accepted ADRs are a source of truth for *why* a long-lived direction was chosen; see [`docs/README.md`](../README.md) for how this fits into the overall documentation hierarchy.

## When to create an ADR

Only when:
- the user has explicitly decided something, or
- an accepted decision is already clearly documented elsewhere in the repository, or
- a long-lived architectural, product, data, tenant, security or deployment direction is clearly established.

**Never** create an ADR just because a code pattern currently exists — that's what `docs/architecture/` is for. Never infer a major decision from behavior alone. If a decision looks important but isn't clearly confirmed, mark it `Needs user confirmation` in the relevant document instead of writing an ADR for it. Do not create ADRs for trivial implementation details.

## Format

Each ADR is a single Markdown file named `ADR-NNNN-short-slug.md`, numbered sequentially.

```markdown
# ADR-NNNN: Title

**Status:** Proposed | Accepted | Superseded | Deprecated
**Date:** YYYY-MM-DD

## Context
What situation or problem led to this decision? What alternatives existed?

## Decision
What was decided, stated plainly.

## Consequences
What this means going forward — both benefits and trade-offs/costs accepted.

## Evidence
Relevant files, line references, or conversations that ground this decision in something verifiable, where useful.

## Supersedes / Superseded by
Link to a prior or replacement ADR, if applicable. Omit if not relevant.
```

## Index

| ADR | Title | Status |
|---|---|---|
| [ADR-0001](ADR-0001-documentation-governance.md) | Documentation governance model | Accepted |
| [ADR-0002](ADR-0002-crmfull-email-tiering.md) | `crmFull` flag governs direct email sending, independent of Web/Workspace context | Accepted |
| [ADR-0003](ADR-0003-close-admin-auth-fallback.md) | Close the web-admin password fallback whenever Supabase is configured | Accepted |
| [ADR-0004](ADR-0004-console-access-decoupled-from-tenant-role.md) | Console access is governed solely by the superadmin email allowlist, not by tenant role | Accepted |
| [ADR-0005](ADR-0005-extend-auth-fallback-fix-to-intranet-login.md) | Extend the closed admin-auth fallback (ADR-0003) to the intranet login | Accepted |
| [ADR-0006](ADR-0006-remove-owner-role-references.md) | Remove lingering "owner" role references; admin/editor/member is the complete role model | Accepted |
