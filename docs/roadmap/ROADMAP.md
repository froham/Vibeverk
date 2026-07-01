# Vibeverk — Roadmap

Roadmap content is planning material. It is not proof of current functionality, architecture, security posture or customer commitments. For verified current state, see [`docs/project/CURRENT_STATE.md`](../project/CURRENT_STATE.md). For historical detail behind completed and paused work, see [`docs/archive/roadmap-2026-07-01.md`](../archive/roadmap-2026-07-01.md).

Sist oppdatert: 2026-07-01.

## Overordna mål

Brukaren har uttalt eit konkret mål: kome dit at Vibeverk kan **deploye ein eksempel-/demokunde** — ein separat instans (eigen repo, eigen Pages-deploy, eige Supabase-prosjekt, jf. `hub/tenants.js`) brukt til å vise fram, teste og selje produktet, IKKJE den live vibeverk.no-instansen sjølv. Før det: ein full sikkerheitsaudit og personvern-gjennomgang.

## Current focus

**Fase 1 — Full sikkerheitsaudit og personvern-gjennomgang: gjennomført 2026-07-01, funn IKKJE alle retta enno.** Security Auditor og Privacy/Compliance Advisor køyrde full gjennomgang av heile kodebasen. To BLOCKER/regresjonar vart retta same dag (sjølv-eskalering-til-admin-hòl i `core.js`, broten Brukar-panel). **Fire HIGH-funn står att, krev Supabase RLS-endringar og eksplisitt brukargodkjenning før Fase 2 kan starte:**
1. `store`-tabellen sin anon-SELECT-policy manglar nøkkel-avgrensing — CRM/leads/tilbod/booking er i praksis offentleg lesbart via REST-API
2. `store`/`media` sine skrive-policyar tillet alle autentiserte (ikkje berre admin) å skrive/slette
3. `chat_conversations` anon UPDATE manglar visitor-eigarskap-sjekk (IDOR) + svake chat/visitor-ID-ar
4. `migration.sql` har drifta frå deployerte hotfixar — ein fersk kundeoppsett vil arve alt-fiksa feil

Sjå `docs/project/CURRENT_STATE.md` "Open security findings" for full detalj. **Desse bør rettast før Fase 2 (demo-kunde) startar**, sidan fleire av dei direkte påverkar kva ein fersk kundeinstans arvar.

Fase 0 (kritiske fiksar — passord-bakveg lukka, korrupt `manage-user`-fil gjenoppretta, `admin/index.html`-drift retta) og ei brukartesta oppfølgingsrunde same dag (chat-bug, oppgåve-tildeling-bug, Console-feltklarheit, intranett-login-bakveg lukka, owner-rolle-opprydding, CRM e-post-konsistens) vart fullført 2026-07-01, sjå `docs/project/CHANGELOG.md` 0.3.0/0.5.0/0.6.0 og ADR-0003 til ADR-0006. Éin uløyst funn frå denne runda: `intranet/module-crm.js` er oppdaga som daud kode testa av `test-intranet.js` men aldri lasta i produksjon — treng eiga avgjerd.

## Next

- **Løys dei fire HIGH-tryggingsfunna over** (Supabase RLS-endringar) — føresetnad før Fase 2.
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
