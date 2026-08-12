# ADR-0014: Sidebygger's "blocks" section type is a sibling to the 8 fixed types, not a replacement — and cannot be embedded inside them

**Status:** Accepted
**Date:** 2026-08-12

## Context

Sidebygger (Console "Sider" tab) shipped in Fase 1 (v0.133.0) with 8 fixed section types (`hero`, `text`, `image-text`, `big-image`, `quote`, `grid`, `cta`, `spacer`), each with its own fixed data model — deliberately no free HTML/CSS/JS, no pixel placement. A concrete limitation surfaced during real use: a customer wanted phone/email contact info inside a section, which none of the 8 fixed types supported, showing that a fixed-type-per-need model does not scale to "100 different customer needs."

Two real directions existed: (a) keep adding narrow fixed section types one at a time as new needs surface (e.g. a dedicated "contact section" type), or (b) introduce one general-purpose composable section type built from smaller, reusable mini-blocks (heading/richtext/image/button/contact-item/spacer) that can be laid out in 1-4 columns, covering the contact-info need generally rather than as a special case, and absorbing future similar requests without a new fixed type each time.

This was reviewed in two rounds before implementation, per this project's standing "before major architecture/data-model changes" rule (`docs/README.md`/`CLAUDE.md`): a Vibeverk Architect consultation, followed by a Plan-agent design pass, both grounded in the actual code (`components.js`'s `pageSection()` dispatcher, `PB_RENDERERS` registry, broker's `set_config`/`custom-pages` validation-free write path). The resulting plan was approved via a formal plan-mode session before any code was written.

## Decision

Add `blocks` as a 9th, **sidestilt (sibling)** section type in `PB_RENDERERS` (`components.js`) — not a replacement for, and not a superset of, the 8 existing fixed types. The 8 existing types are left completely unmodified; no migration of existing saved pages is needed (`pageSection()`'s dispatcher already silently skips unknown types/blocks, and the broker's `set_config` never validated the shape of `custom-pages` server-side, so no existing data could reference the new type).

**A `blocks` section cannot contain any of the 8 other section types, and none of the 8 other section types can contain a `blocks` section or individual blocks.** The two systems are structurally separate: a page is a flat list of sections, each section is either one of the 8 fixed types (rendered by its own dedicated `pb*` function) or a `blocks` section (rendered by `pbBlocks()`, itself dispatching to one of 6 `PB_BLOCK_RENDERERS`). There is no nesting in either direction.

The `blocks` layout itself stays within the existing "no free pixel placement" constraint from Fase 1: `layout` is a closed enum (`1col`/`2col`/`2col-2-1`/`2col-1-2`/`3col`/`4col`), each mapping to one fixed `grid-template-columns` preset — not a free width value.

## Consequences

- Existing pages, the 8 fixed types' data models, and every existing `PB_RENDERERS` entry are byte-identical before and after this change — zero migration risk.
- Future section-type additions have two clear paths to choose between: a new fixed type (for something that needs its own bespoke layout/behavior, like `hero`) or a new block type inside `blocks` (for something composable that fits the heading/richtext/image/button/contact-item/spacer-style building-block model). This ADR is the record of why that fork exists and why it was chosen over "just keep adding fixed types."
- Because nesting is disallowed, a future need for e.g. "a hero-style section built from blocks" or "a grid of block-based cards" is out of scope for the current `blocks` type and would require its own design decision (a new fixed type, a new block type, or revisiting this ADR's no-nesting boundary) — not assumed to already be supported.
- The security patterns this decision made necessary (contact-item's hardcoded `tel:`/`mailto:` prefix instead of a free href field, button's variant allowlist, image reusing the existing upload pipeline unchanged) are documented as implementation reality in `docs/architecture/page-builder.md`, not repeated here.

## Evidence

`components.js` (`PB_RENDERERS`, `PB_BLOCK_RENDERERS`, `pbBlocks()`, `pageSection()` dispatcher), `docs/project/CHANGELOG.md` 0.134.0 ("Gjennomgått i to rundar (ein Architect-konsultasjon + ein Plan-agent-runde, begge kodeforankra) før implementering" / "Ny, sidestilt seksjonstype ... dei 8 eksisterande typane er heilt urørte"), `docs/architecture/page-builder.md`.
