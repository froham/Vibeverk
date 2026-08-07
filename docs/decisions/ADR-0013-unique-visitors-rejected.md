# ADR-0013: "Unike besøkjande" rejected for the sidetelling module — customers needing it are referred to Plausible/Google Analytics

**Status:** Accepted
**Date:** 2026-08-03

## Context

The internal, cookie-free pageview module (`module-sidetelling.js`, see `docs/architecture/sidetelling.md`) reached the end of its planned "Fase 2" build (v0.81.0–0.84.0, 2026-08-03): device/browser metadata, bot filtering, a rule-based "Trendar" period comparison, and conversion linking. A natural next question came up the same day: could the module also report "unique visitors over the last 30 days" — the one metric Plausible/Google Analytics provide that Vibeverk's own module does not?

The module's three founding principles (`docs/architecture/sidetelling.md` "Grunnprinsipp"): native/free (no paid external service), no external API calls, and cookie-free (session ID lives only in `sessionStorage`, never a persistent client-side identifier). Any unique-visitor count needs some way to deduplicate a person across page loads without a durable identifier — the hard part of the problem.

Two independent technical assessments were obtained, following the same two-step pattern already used for the Nettsidehelse module's own scope decisions:
1. **Codex** (an independent AI tool) was asked for a self-contained technical proposal for how unique-visitor counting could work within the three principles.
2. **The Vibeverk Architect** (`.claude/agents/vibeverk-architect.md`) then reviewed that proposal independently and critically, without being told to reach any particular conclusion.

Codex's proposal: a private, aggregated HyperLogLog (HLL) sketch, built from an HMAC (via `pgcrypto`) of a rotating daily salt plus a fingerprint value, stored only in aggregate — no raw IP, user agent, or per-visitor ID ever persisted. A significant error surfaced during this work: `docs/architecture/sidetelling.md` had previously floated Postgres's `inet_client_addr()` as a plausible source for that fingerprint. Both Codex and the Architect independently confirmed this was **wrong** — in the Supabase/PostgREST architecture, `inet_client_addr()` returns the IP of the PostgREST/pooler layer, not the actual visitor's IP. A PostgREST-based proposal could instead have investigated the transaction-local `request.headers` context, but that path was not pursued for HLL. The much simpler daily grouping described in the clarification below later reads the incoming `Request.headers` in a Supabase Edge Function; it does not use PostgREST's transaction context and does not reopen this decision.

The Architect's review concluded the HLL approach was technically achievable within the three principles, but flagged two decisive problems:
- **Accuracy floor set by identity, not algorithm.** HLL's own estimation error is small (~1.6%), but Vibeverk's actual customers are small Norwegian SMBs with typically a few hundred visits/month, where shared-IP/network effects (office, school, CGNAT) dominate: up to ~99% undercount for a group sharing one network, or up to ~400% overcount for one person moving across several networks. The algorithm's precision is irrelevant when the input identity signal itself is this unreliable at this traffic scale.
- **Implementation cost out of proportion to the codebase's style.** A hand-rolled HLL in pure PL/pgSQL (Supabase has no ready-made extension for it), plus key rotation, `pg_cron` cleanup jobs, Vault key handling, and a new reporting RPC, is a large step up in mechanism for a number that would still only be an estimate, not a definitive count.

A simpler alternative — a stable HMAC signature in a private token table with a ~35-day lifetime, avoiding HLL's algorithmic complexity — was also considered and rejected: functionally, that is a server-side cookie substitute, and would contradict the module's own "cookiefritt, ingen varig identifikator" claim stated verbatim in the privacy-text generator (`computeDefaultPrivacyText()`, `core.js`).

## Decision

Vibeverk's own sidetelling module will **not** build unique-visitor counting. This is a rejection, not a deferral — see "Consequences" below for what would be needed to reopen it. Customers who need a real unique-visitor count (or other advanced analytics) are referred to Plausible (already supported as an external/"premium" option via the `analytics.plausible` config field) or Google Analytics, rather than Vibeverk building its own complex, accuracy-limited version of the same thing.

## Consequences

- `module-sidetelling.js`'s scope stays bounded to pageview/CTA counts, device/bot breakdown, trend comparison and approximate daily-group metrics. Conversion linking was removed on 2026-08-06 — the module remains deliberately simple and honest about its own limits, not a Plausible/GA replacement.
- The `inet_client_addr()` mistake in `docs/architecture/sidetelling.md` is corrected in place (see that file's "Bevisst ikkje bygd" section) — the implemented daily grouping reads server-received Edge `Request.headers`, never `inet_client_addr()`.
- If a genuine high-volume customer need resurfaces later, of the two approaches evaluated here only the HLL sketch remains worth reopening — and only with a real Postgres HLL extension, not a hand-rolled algorithm. The token-table/HMAC approach is closed, not just deferred — reopening it would require explicitly revisiting the "cookiefritt, ingen varig identifikator" claim in the privacy text first, not just adding a table.
- This ADR exists specifically so a future session does not rediscover "what about unique visitors" from scratch and re-propose the same rejected paths without the accuracy/complexity context above.

### Clarification after the 2026-08-06 browser-storage decision

Vibeverk later replaced the pageview module's `sessionStorage` ID with an Edge-computed, UTC-daily SHA-256 group derived from site + request IP + User-Agent (`supabase/functions/sidetelling-event` + `20260806170936_server_side_daily_analytics_hash.sql`). This does **not** supersede the decision above: no unique-visitors KPI, HLL sketch, persistent token, secret-rotation system or cross-day identity was introduced. The daily group only preserves the existing visit-based dashboard calculations without reading/writing browser storage; it is deliberately approximate and resets at UTC midnight. A separate global quota row stores only UTC date + event count for abuse control, never a visitor/hash/token.

## Evidence

`docs/architecture/sidetelling.md` "Bevisst ikkje bygd" section (full write-up, both technical findings), `docs/project/CHANGELOG.md` 0.86.1 entry, `docs/roadmap/ROADMAP.md` "Later" section, `core.js` `computeDefaultPrivacyText()` (the "cookiefritt, ingen varig identifikator" claim the token-table alternative would have contradicted).
