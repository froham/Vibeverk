# Nettsidehelse — scoring rubric

`renderNettsidehelseSection()`/`computeWebsiteHealth()` in `core.js` is a rule-based (no AI in v1) health check for a customer's own public site. It reads data already loaded in the admin session (`superconfig`, `content`, module state) — no new Supabase table, no new RPC, no external API call.

Built 2026-07-27, originating from a Codex-generated proposal that a Claude Code session reviewed critically (not applied raw) and then had the Vibeverk Architect sanity-check before implementation. See `docs/project/CHANGELOG.md`'s 2026-07-27 entry for the full history.

**Placement, corrected same day**: the first version shipped as its own standalone Web-admin tab (category `innstillinger`), visible to every admin customer regardless of whether they'd bought the design module ("sidebygger") — but its own tips referenced `Design → SEO`/`Design → Fargar`, tabs that only exist behind `feat("sidebygger")`. A customer without the design module would see the tab but be told to go to tabs they didn't have. Fixed the same day: the section now renders *inside* `adminDesignSeo()` (Design → SEO), below the existing meta-description/OG-image/favicon form, so it automatically inherits the same `feat("sidebygger")` gate as the rest of Design — no separate tab, no separate gating logic to keep in sync. This also matches the intended business model: a customer without the design module doesn't see it at all (Vibeverk can offer the health check as a paid consulting service instead); a customer with the design module gets full self-service access, consistent with the rest of Design. The section re-renders in place immediately after the SEO form is saved, without requiring the customer to leave and re-enter the tab.

## Why several of the originally-proposed checks are absent

- **Sitemap, "URL-struktur", "interne lenker"** — dropped entirely. Vibeverk public sites are a single hash-routed page (`#tjenester`, `#om-oss`, no `history.pushState`) — there is exactly one real, indexable URL per site. A sitemap or "internal linking" score would be either meaningless or permanently identical across every tenant.
- **Real Core Web Vitals (LCP/CLS/INP)** — not computable by static/rule-based analysis. Would require either the Google PageSpeed Insights API (external call, rate-limited) or an actual headless-browser rendering pass (Playwright/Lighthouse-style — asynchronous, not a fit for a synchronous admin-panel click). Deferred as a separate Phase 2 decision, not part of this module.
- **Rendered-page checks (real overflow, real touch-target size)** — same reason as above; these were the exact bug class found and fixed in this codebase on 2026-07-26/27 (a CSS Grid track-sizing gap in the Workspace tasks list, and a dim-overlay bleeding into the iOS/Android status bar), and both were only catchable by actually rendering the page in a real browser (Playwright), not by reading CSS. Deferred to Phase 2.
- **Label/input pairing, keyboard navigation, general JS/CSS practice** — these are platform-level properties baked into shared `core.js`/`components.js`, identical for every tenant regardless of what that tenant's own admin does. Showing them as a per-customer red/yellow/green would be misleading (the customer can't change them) or permanently uniform across every tenant (no differentiating value). Kept out of the per-tenant score; this is Vibeverk's own ongoing QA responsibility instead (see `.claude/agents/vibeverk-security-auditor.md` and the UX/Mobile Reviewer for the platform-level equivalent).
- **"Kart" (map embed)** — dropped; no map-embed feature exists anywhere in the codebase to check.
- **"Cookies" consent** — dropped; Plausible Analytics (the only analytics option) is documented as cookieless by design, so there may be nothing to check for on a typical tenant. Revisit only if a cookie-setting integration is ever added.

## What's actually checked, by category

Each check is a boolean (`pass`/`fail`) with a `weight` (relative importance within its category) and a `tip` (shown only when failing, in "Prioriterte forbedringer"). A category's score is the weighted percentage of its checks that pass. The total score is the unweighted average of the four category scores.

### Synlegheit (SEO)
| Check | Data source | Weight |
|---|---|---|
| Sidetittel har fornuftig lengd (10–60 teikn) | `superconfig.company.name` + `.tagline` | 2 |
| Meta-beskrivelse utfylt og i rett lengd (50–160 teikn) | `superconfig.company.metaDescription` | 3 |
| H1 (hovudoverskrift) er fylt ut | `content.hero.title` | 3 |
| Open Graph-bilde er sett | `superconfig.company.ogImage` | 2 |
| Strukturert data (Schema.org) kan genererast | `company.name` + `contact.address` + `contact.phone` all present | 2 |
| Alt-tekst på alle bilete | `Media.norm()` over hero/about/services/news images | 2 |
| robots.txt hindrar Google frå å crawle interne sider | always true (platform-provided, see `robots.txt` at repo root) | 1 |

### Innhald
| Check | Data source | Weight |
|---|---|---|
| Nok tekstinnhald (≥100 ord) | `content.about.text` + `content.hero.subtitle` + all `content.services[].text`, HTML-stripped and word-counted | 2 |
| Tydeleg CTA på forsida | `content.hero.ctaLabel` + `.ctaTarget` both non-empty | 3 |
| Kontaktinformasjon er komplett | `content.contact.{email,phone,address}` all non-empty | 3 |
| FAQ har minst eitt spørsmål | `Store.get("faq-items")`, only checked if `features.faq` is on | 1 |

### Tillit
| Check | Data source | Weight |
|---|---|---|
| Organisasjonsnummer er fylt ut | `content.footer.orgNr` | 2 |
| Personvernerklæring er skriven | `CFG.privacy.text` | 2 |
| Kundeanmeldingar/referansar lagt til | `Store.get("ref-items")`, only checked if `features.referanser` is on | 2 |

### Tilgjenge
Deliberately narrow — only the one check that's both real per-tenant-variable data and computable without rendering:

| Check | Data source | Weight |
|---|---|---|
| God kontrast: brødtekst mot bakgrunn (WCAG ≥4.5:1) | `superconfig.colors.text` vs `.background`, standard WCAG relative-luminance formula (`wchContrastRatio()`) | 3 |
| God kontrast: knappetekst mot primærfarge (WCAG ≥4.5:1) | `#ffffff` vs `superconfig.colors.primary` — confirmed via direct CSS read (`.btn--primary { color: #fff }` in `index.html`/`admin/index.html`) that button text really is hardcoded white, not derived, before writing this check | 3 |

## Traffic-light thresholds

🟢 ≥80 · 🟡 50–79 · 🔴 <50 — applied per-category and to the total score.

## "Prioriterte forbedringer"

The top 5 *failing* checks with a `tip`, sorted by `weight` descending. Since this is v1 with no real "expected effect" data, weight is the priority proxy — checks judged more consequential (meta description length, CTA presence, contact completeness, contrast) are weighted higher than minor ones (favicon-adjacent fields, FAQ population).

## Deliberately deferred decisions (confirmed with the user, 2026-07-27)

- **JSON-LD/LocalBusiness schema**: ships in a degraded form using only fields that already exist (name/address/phone/logo) rather than blocking on adding business-hours/category/geo-coordinate fields first. The health check itself can later recommend adding hours as a content improvement, once/if that becomes a real field.
- **Canonical URL**: no new customer-editable field — the check only confirms the site's one real root URL is indexable, since a manual override has little meaning for a single-URL site.

## Console support (added 2026-07-27)

The user later asked whether the customer/consultant model this feature is built around ("a customer without the design module doesn't see this; Vibeverk can offer it as a paid consulting service instead") should be completed with an operator-facing view — approved narrowly ("Ja, ordne console-visning"), with CWV/JSON-LD-hours/AI extensions explicitly still deferred.

`computeWebsiteHealth()`, `renderNettsidehelseSection()` and `wchCollectImages()`/`wchCollectImagesFrom()` were refactored to accept an optional `opts` object (`superconfig`, `content`, `enabledModules`, `faqItems`, `refItems`, `privacyText`), falling back to the existing closure-based Web-admin state when `opts` is omitted — zero behavior change for the existing no-args call site. Both functions are exposed on `window.App`.

Console's `renderWeb()` (the combined Firma/SEO/Fargar/Fontar tab) now fetches `content`/`faq-items`/`ref-items` for whichever tenant is currently selected via the existing generic `getStoreKey()` (a direct, anon-key read against that tenant's own Supabase project — the same mechanism `getSC()` already used for `superconfig`), and renders the health section into the "SEO og deling" fieldset, in the same "right below the metadata fields" position used in Web-admin. This works **regardless of whether that tenant has `feat("sidebygger")`** — Console is not gated by the customer's own paid-module status, which is the entire point (an operator can run this as a consulting deliverable for a customer who hasn't bought the design module).

The three extra async reads are guarded by the same `_renderGen` generation-counter pattern Console's own tab dispatcher already uses, captured fresh at the top of `renderWeb()` and checked before the result is written into `#cs-nettsidehelse` — so a stale response can't land in a DOM node that now belongs to a different tenant/tab (the operator switched away while the reads were in flight).

`enabledModules.faq`/`.referanser` are derived from `sc.features.faq`/`sc.features.references` directly (module registration itself — `App.registerModule()` — only happens in a real page render, which Console doesn't do), matching the same opt-out-by-default semantics as `module-faq.js`/`module-references.js` (enabled unless explicitly `=== false`).

Console has no jsdom test harness (unlike `test.js`/`test-workspace.js`), and a real logged-in browser walkthrough wasn't performed (Console requires OTP auth against the control plane). Verified instead via `node test.js`/`node test-workspace.js` (no regressions in the refactored `core.js` functions) plus a standalone smoke script calling `renderNettsidehelseSection(opts)` directly with a brand-new-tenant-shaped `content` object (the actual shape `getStoreKey()`'s `{}` fallback produces) to confirm no crash on the empty case.

## Extensibility for AI (later, not v1)

The scoring function returns fully structured data (`{ totalScore, categories: [{ id, label, score, items: [{ category, label, pass, tip, weight }] }], topFixes }`) rather than pre-rendered text — so a future AI layer could consume this structure to explain findings in natural language or auto-draft fixes, without needing to re-derive what was checked. No such integration exists yet; this is a design note, not a built feature.
