# ADR-0002: `crmFull` flag governs direct email sending, independent of Web/Workspace context

**Status:** Accepted
**Date:** 2026-07-01

## Context

Admin replies to customer inquiries could be sent two ways: directly via the `send-reply` Edge Function (Resend), or via the customer's own email client (`mailto:`, effectively Outlook/Gmail). The shared reply modal (`openReplyModal` in `core.js`) decided which mode to show using `const canSendDirect = !!(window.Intranet && window.App && window.App.supabase)` — i.e. whether the code happened to be running inside the Workspace/intranet context (`window.Intranet` only exists there). This meant Web-admin (the public-site admin panel) always got `mailto:` only, and Workspace always got direct sending — regardless of what a given customer had actually purchased or been configured for. No feature-tier flag for this existed at all; the only related flag, `features.crm`, governs the "light CRM" customer-list module and has nothing to do with email delivery method.

The user identified this as a real inconsistency ("Det virker som at e-post-svar og funksjoner ligger forskjellig på veldig mange plasser") and required a single consistent rule that does not depend on which surface (Web vs. Workspace) the admin happens to be using — only on what the customer's feature package actually includes.

## Decision

Introduce `features.crmFull` in `config.js` (requires `features.crm`). `openReplyModal`'s `canSendDirect` check now reads `CFG.features.crm && CFG.features.crmFull` instead of `window.Intranet` — identical behavior in Web-admin and Workspace. The flag is surfaced in Console → Modular (`FEAT_LABELS` in `console-core.js`) so a Vibeverk operator can toggle it per customer. It is **not** on by default for new customers — each customer's package determines it explicitly, confirmed by the user: *"Altså dersom kunden har aktivert funksjonen, så skal de få ha den. Men det er ikke default for ALLE kunder... Det er hva kunden har kjøpt som skiller."*

When `crmFull` is off, the customer's admin (in both Web and Workspace) uses Outlook/`mailto:` exclusively — this is the sole determinant of which path is used, never the surface context.

`intranet/module-settings.js`'s email-configuration UI card was rewritten to match: it previously offered a fake, non-functional M365/Gmail/IMAP/"Vibeverk Mail" provider picker (marked "Mockup") that implied both sending *and receiving* were configurable, when in fact nothing there was wired to any backend. It now shows an honest, read-only status line reflecting the actual `crmFull` state, plus an explicit "Mottak av e-post er ikke støttet ennå" (inbound not supported yet) statement.

## Consequences

- One flag, one check, one behavior — Web and Workspace can no longer silently diverge on this.
- Existing customer(s) already relying on direct sending in Workspace needed the flag set to `true` explicitly to avoid a silent regression; this was done for the current config.js as part of this change (not a new default for future customers).
- Inbound email (receiving replies) remains entirely separate and unbuilt — this decision only governs the outbound path. See `docs/roadmap/ROADMAP.md` (steg 6f) for the (currently paused) inbound design, which is scoped to apply only to `crmFull` customers when/if it is built.
- A related, smaller cache-bust drift was discovered while touching this code path: `admin/index.html` (a separate legacy admin entry point) is far behind `index.html` in script versions. Left unfixed, logged as a known limitation (`docs/project/CURRENT_STATE.md`).

## Evidence

`core.js` (`openReplyModal`, `canSendDirect` check), `config.js` (`features.crmFull`), `console/console-core.js` (`FEAT_LABELS`), `intranet/module-settings.js` (`emailProviderCard()`), `docs/project/CHANGELOG.md` (0.2.0 entry).
