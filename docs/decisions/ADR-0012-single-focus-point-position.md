# ADR-0012: Image focus-point stays a single stored position, with multi-context live previews instead of multiple stored positions

**Status:** Accepted
**Date:** 2026-07-15

## Context

A UX/Mobile Reviewer pass on the image-focus-point picker (`imageField()`/`bindImageFields()`, `components.js`/`core.js`) found that for two image fields — the "Aktuelt" (News) post image and the References item image — the editor's crop preview promised a single, fixed aspect ratio (16:9) that didn't match any of the real places the image actually renders: the Aktuelt front-page card (~1.22:1 on desktop, a continuously variable ratio on narrow mobile widths), the article detail page (`16:7`, viewport-independent), the References grid (variable, since column width changes with `auto-fill`/viewport), and the References detail page (which additionally had a real bug — `coverImg(img, "")` was called with an empty CSS class, so the focus point had zero visible effect there at all).

The user asked directly whether mobile/desktop responsiveness was the core difficulty, and whether it would be possible to get separate focus-point choices for each context. Clarified: yes, viewport-dependent reflow (News mobile card, References grid) is part of it, but not all of it — the article-detail mismatch (`16:7` vs. the editor's `16:9`) is a fixed, wrong constant unrelated to any breakpoint.

Two real options existed: (a) store a separate focus-point position per rendering context (e.g. one for the card, one for the detail page), or (b) keep one stored position and instead show the admin how that one position looks in each context before they save. Option (a) is a genuine data-model change — every image field call site with multiple contexts would need multiple stored positions, and the editor UI would need per-context controls throughout the whole site, in real tension with this project's stated "keep it simple for non-technical SMB customers" principle (`docs/architecture/copy-style-guide.md`, `docs/roadmap/ROADMAP.md` "Next" point 0). The user was walked through this trade-off and chose (b).

The Architect was consulted (required for this kind of cross-module UI change touching shared `components.js`/`core.js` code) to design the concrete mechanism before implementation.

## Decision

Keep exactly one stored focus-point position (`{ src, pos, ... }`) per image — no new data-model field, no per-context storage. Extend the shared image-field editor to optionally render one draggable/keyboard-controllable **primary** crop preview (using the tightest/most representative real aspect ratio for that image) plus one or more read-only **secondary** preview boxes that live-mirror the *same* stored position at other real aspect ratios, so the admin sees the actual consequence in every context before saving, without needing to guess or check the live site afterward.

Applied to:
- **Aktuelt/News image**: primary = front-card ratio (`220/180`), secondary = article-detail ratio (`16/7`). The mobile card's continuously-variable ratio deliberately does **not** get its own preview box — a "representative" number for something with no fixed value would misrepresent precision that doesn't exist.
- **References image**: primary = grid-card ratio (`210/140`, the grid's narrowest column width), secondary = detail-page ratio (`16/9`) — after first fixing the detail page's `coverImg(img, "")` bug (empty class → no `object-fit`/sizing ever applied) so the secondary preview and the live page would actually agree.

`imageField()`/`imgField()` gained two new optional parameters (`aspectLabel`, `previews`) — purely additive; the eight other single-context image fields on the site (hero, about, tjenester, booking, FAQ, scrollbanner, mediabank, workspace-announcements) are unaffected and render byte-identical output.

## Consequences

- No data-model migration, no new field on any stored image object.
- The admin now sees, live, how their one chosen focus point looks in every context that image actually appears in (for the two fields where this mattered) — closing the "editor promises something the live site doesn't deliver" trust gap the review found.
- A single position still cannot be simultaneously perfect for very different aspect ratios (e.g. a subject near an edge may look fine at `1.22:1` but tight at `16:7`) — this is an inherent limitation of the chosen approach, not a bug; the primary aspect is deliberately the tightest/most-constraining ratio precisely so a position chosen against it tends to degrade gracefully in the more forgiving secondary context.
- The mobile-card and References-grid continuously-variable ratios remain unpreviewed best-effort approximations — a residual, accepted gap, not a regression from before this change (which had no accurate preview for any context).
- If a future need genuinely requires per-context precision (not just approximation), that would mean revisiting this ADR and the "one position" decision specifically — a new data-model change, its own Architect consultation, and explicit user sign-off, not an incremental extension of the preview mechanism.

## Evidence

`components.js` (`imageField()` — `aspectLabel`/`previews` params), `core.js` (`imgField()`, `bindImageFields()` — `secondaryBoxes`/`renderSecondaries()`/`updateSecondaryPositions()`, the `p-image` call site), `module-references.js` (`rf-image` call site, `rf-detail__photo` bug fix), `docs/project/CHANGELOG.md` 0.36.0, `docs/roadmap/ROADMAP.md` "Next" point 0 (the simplicity principle this decision weighed against option (a)).
