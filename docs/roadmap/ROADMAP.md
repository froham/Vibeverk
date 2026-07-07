# Vibeverk — Roadmap

Roadmap content is planning material. It is not proof of current functionality, architecture, security posture or customer commitments. For verified current state, see [`docs/project/CURRENT_STATE.md`](../project/CURRENT_STATE.md). For historical detail behind completed and paused work, see [`docs/archive/roadmap-2026-07-01.md`](../archive/roadmap-2026-07-01.md).

Sist oppdatert: 2026-07-07.

## Overordna mål

**Retning stadfesta 2026-07-07** (Arkitekt-godkjent, sjå ny control-plane/data-plane-ADR under utarbeiding): Vibeverk skal skalere frå éin kunde til 10-100 SMB-kundar via éin sentral Console (`console.vibeverk.no`, control plane) og eitt Supabase-prosjekt per kunde (data plane, uendra prinsipp) — IKKJE via repo-fork-per-kunde. Full faseplan (tryggleiksgjeld → hosting/edge → async config-bootstrap → hostname-tenant-oppløysing → sentral Console/tenant-register → semi-automatisert kundeoppretting) er avtalt med brukaren; sjå den nye ADR-en og `docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md` (Fase 0/1 av denne planen). Første steg (tryggleiksgjeld, under) er i gang. Dette supersederer den eldre "eksempel-/demokunde via eigen repo-fork"-planen (`hub/tenants.js`-basert) som eit mellombels stillas, ikkje målarkitekturen — sjå ADR-0007.

## Current focus

**Tryggleiksgjeld før SaaS-skalering held fram — reell status reknska ut 2026-07-07** (den gamle "fire HIGH-funn"-lista under var uendra sidan 2026-07-01 og hadde vorte misvisande — tre av fire var alt lukka). Verifisert direkte mot `supabase/migration.sql`/`docs/project/CHANGELOG.md`/`docs/project/CURRENT_STATE.md`:
1. ~~`store`-tabellen sin anon-SELECT-policy~~ — **lukka og stadfesta i produksjon** (CRM/leads/booking flytta til eigne tabellar med RLS, gamle blob-rader sletta 2026-07-06).
2. ~~`store`/`media` sine skrive-policyar~~ — **lukka og stadfesta i produksjon** (rolle-avgrensa via `can_edit_content()`/`is_platform_operator()`).
3. ~~`chat_conversations` anon UPDATE-IDOR~~ — **lukka og stadfesta i produksjon 2026-07-07** (live-testa via ny Playwright-flyt, gamle anon-rettar tilbaketrekt, sjå `docs/project/CHANGELOG.md` 0.17.8).
4. ~~`migration.sql`-drift~~ — **lukka** for alle spot-sjekka hotfixar; chat-RPC-ane som mangla er no folda inn (same runde som punkt 3).

**Nye funn (surfaced under 2026-07-07-reknskapen, ikkje del av den opphavlege lista):**
- ~~`superconfig.adminPassword`~~ — **lukka og stadfesta i produksjon 2026-07-07** (`superconfig` delt i offentleg/privat nøkkel, verifisert både via `pg_policy` og eit ekte anon REST-kall, sjå `docs/project/CHANGELOG.md` 0.17.9). **Berre den faktiske Console-nettlesarflyten (last/lagre passordfeltet) står att å stadfeste manuelt** — ikkje gjort i denne økta sidan det krev OTP til operatøren sin eigen e-post.
- Console sin 48-timars sesjon vert berre sjekka ved `DOMContentLoaded`, ikkje ved intern navigering (`console/console-core.js`) — framleis ope, MEDIUM.
- Udokumentert til no oppdaga: chat-adminpanelet er admin-only (ikkje editor/member), no dokumentert i `docs/architecture/roles-and-tenants.md`.

Sjå `docs/project/CURRENT_STATE.md` "Pending"/"Still open" for full detalj. **Console-sesjonssjekken bør rettast før SaaS-skaleringsarbeidet held fram til kontrollplan-steget**, sidan kontrollplanen vil forsterke Console sin tryggleiksrolle monaleg.

Fase 0 (kritiske fiksar — passord-bakveg lukka, korrupt `manage-user`-fil gjenoppretta, `admin/index.html`-drift retta) og ei brukartesta oppfølgingsrunde same dag (chat-bug, oppgåve-tildeling-bug, Console-feltklarheit, intranett-login-bakveg lukka, owner-rolle-opprydding, CRM e-post-konsistens) vart fullført 2026-07-01, sjå `docs/project/CHANGELOG.md` 0.3.0/0.5.0/0.6.0 og ADR-0003 til ADR-0006. Éin funn frå denne runda: `intranet/module-crm.js` vart oppdaga som daud kode — **sletta 2026-07-06**, sjå `docs/project/CURRENT_STATE.md` "Known limitations".

## Next

- **Hosting-arkitektur (`docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md`):** Fase 2 (demo-kunde) bør skje på ny edge-hosting-arkitektur (kjøretids-oppløyst config per domene), ikkje som repo-fork — repo-fork-modellen løyser dataisolasjon, men bryt "éin push når alle kundar"-prinsippet i `docs/STRATEGY.md`. **Vendor evaluert og endra 2026-07-07 (sjå ADR-0007 sitt addendum): Vercel, ikkje Cloudflare** — Cloudflare sin apex-domene-støtte utan nameserver-flytting er Enterprise-only, Netlify fråråder apex+ekstern-DNS som primær. Fase 0 (uendra repo deployert til Vercel som andre vert, null kodeendring) er **gjennomført og stadfesta 2026-07-07** — `vibeverk.no` sjølv er ikkje rørt, framleis på GitHub Pages. Attståande før Fase 1 kan starte: apex-domene-via-A-record-test på eit ekte kastedomene, og ein minimal edge-middleware Host-header-test. Fase 1 (asynkron config-bootstrap i `core.js`) er eige, seinare, dedikert arbeid.
- **Rett Console sin sesjonssjekk-ved-navigering-svakheit over** (`console/console-core.js`) — bør skje før kontrollplan-Console-arbeidet i SaaS-skaleringsplanen, sidan kontrollplanen forsterkar Console si tryggleiksrolle monaleg.
- **Fase 2 — Sett opp demo-/eksempelkunde-instans.** Ny GitHub-repo + Pages-deploy + Supabase-prosjekt (stadfesta arkitektur, sjå `docs/archive/roadmap-2026-07-01.md` sitt vedlagde arkitektnotat-grunnlag). Opne avgjerder: domenenamn (subdomene vs. `github.io`), om `crmFull`/Resend skal demonstrerast, ny `hub/tenants.js`-oppføring.
- **Fase 3 / Steg 7 — Kundedokumentasjon / Kontrakt / DPA.** Standardkontrakt, databehandlaravtale (DPA), personvernerklæring — fylt ut frå malane i `docs/compliance/` med stadfesta fakta, ikkje oppdikta. Gjeld både demo-instansen og framtidige ekte kundar.
- **Steg 6f — Motta e-post (inbound), viss/når det vert teke opp att.** Design er ferdig (Message-ID-tråding via Resend, automatisk ny Kontakt-lead + CRM-kunde ved manglande treff). Sett på vent av brukar 2026-07-01: *"Vi avventer litt, det blir veldig edgy-CRM-messig."* Éin uløyst byggbarheitsdetalj før koding: overgang frå blob-basert til normalisert lagring for inbound-skrivne rader. Må gjennom Security Auditor + Privacy Advisor før bygging.

## Later

- **Steg 8 — Intern teknisk dokumentasjon.** Store delar av dette vart dekt av dokumentasjonsstyrings-arbeidet 2026-07-01 (denne `docs/`-strukturen, ADR-ar, agent-team). Attståande: onboarding-guide for nye Vibeverk-kundar (kva `config.js`-verdiar som skal endrast per kunde), Supabase-migreringsdokument per modul.
- **Steg 9 — Kvalitetssjekkar.** Full gjennomgang av alle modular, cross-device testing (desktop/mobil/nettbrett), tilgjengelegheit (WCAG), ytingstest (Lighthouse) — delvis overlappande med Fase 1-audit, gjer resten etterpå.
- **Steg 6d — Realtime.** Bytte polling i Chat med Supabase Realtime; oppdatere Dashboard med live-teljing.

## Ideas / Parking lot

- **`hub/tenants.js` — reell autentisering + flytte kundedata til Supabase.** Plaintext-passordet i Hub-innlogginga er trivielt omgåeleg, og sidan repoet (`froham/Vibeverk`) er offentleg, ligg kundedata i `tenants.js` (namn/e-post/Supabase-prosjekt-ID) lesbart i git-historikken uansett kva slags innlogging som står framfor sjølve sida. **Brukar avgjorde 2026-07-01: Hub vert ikkje brukt for kundar no, eksplisitt utanfor scope — parkert her, ingen kodeendring gjort.** Berre relevant den dagen ein reell (ikkje-eigen) kunde skal leggjast inn i Hub; sjå `docs/project/CURRENT_STATE.md` for dei tre alternativa som vart vurdert (Supabase-tabell + Console-stil auth / eige privat repo / status quo).
- **Steg 10 — AI-native Chat.** Ein AI-assistent bygd inn i den native chat-løysinga (RAG via pgvector, KB/FAQ/CRM/Booking-kontekst, hybrid AI/operatør-modus). Eksplisitt spekulativ forretningsmodell-utforsking (Basis/Pro/Premium-tier), ikkje eit forplikta steg. Føresetnad: Supabase (steg 6) er på plass, som no er tilfellet.
- Custom design-modul (visuell tema-editor for kunde-sjølvbetjening) — nemnd i tidlegare arkitektnotat, ikkje prioritert.
- PWA-manifest / Service Worker for Workspace — nemnd i tidlegare arkitektnotat, låg prioritet.
