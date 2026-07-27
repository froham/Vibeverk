# Nettsidehelse — scoring rubric

`adminNettsidehelse()`/`computeWebsiteHealth()` in `core.js` (Web-admin, category `innstillinger`, tab id `nettsidehelse`) is a rule-based (no AI in v1) health check for a customer's own public site. It reads data already loaded in the admin session (`superconfig`, `content`, module state) — no new Supabase table, no new RPC, no external API call.

Built 2026-07-27, originating from a Codex-generated proposal that a Claude Code session reviewed critically (not applied raw) and then had the Vibeverk Architect sanity-check before implementation. See `docs/project/CHANGELOG.md`'s 2026-07-27 entry for the full history.

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
- **Console-wide overview**: out of scope for this version. Web-admin owns the score (it's the customer's own tool, for the customer's own site); Console does not duplicate the scoring logic. An operator-facing cross-tenant view, if wanted later, should call the same scoring function rather than reimplement it — avoiding the same two-places-to-edit problem that already exists for `metaDescription`/`ogImage`/`favicon` between `core.js`'s `adminDesignSeo()` and Console's own SEO tab.

## Extensibility for AI (later, not v1)

The scoring function returns fully structured data (`{ totalScore, categories: [{ id, label, score, items: [{ category, label, pass, tip, weight }] }], topFixes }`) rather than pre-rendered text — so a future AI layer could consume this structure to explain findings in natural language or auto-draft fixes, without needing to re-derive what was checked. No such integration exists yet; this is a design note, not a built feature.
