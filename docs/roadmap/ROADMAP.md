# Vibeverk — Roadmap

Roadmap content is planning material. It is not proof of current functionality, architecture, security posture or customer commitments. For verified current state, see [`docs/project/CURRENT_STATE.md`](../project/CURRENT_STATE.md). For historical detail behind completed and paused work, see [`docs/archive/roadmap-2026-07-01.md`](../archive/roadmap-2026-07-01.md).

Sist oppdatert: 2026-07-10.

## Overordna mål

**Retning stadfesta 2026-07-07** (Arkitekt-godkjent, sjå `docs/decisions/ADR-0008-control-plane-data-plane-split.md`): Vibeverk skal skalere frå éin kunde til 10-100 SMB-kundar via éin sentral Console (`console.vibeverk.no`, control plane) og eitt Supabase-prosjekt per kunde (data plane, uendra prinsipp) — IKKJE via repo-fork-per-kunde.

**Den tekniske sida av denne planen (Fase 1–9) er no fullført, pusha og deployert** — sjå "Fullført" under. Dette supersederer den eldre "eksempel-/demokunde via eigen repo-fork"-planen (`hub/tenants.js`-basert), som var eit mellombels stillas, ikkje målarkitekturen.

**Retningsavklaring 2026-07-10 (brukar)**: no som den tekniske blokkeringa er borte, flyttar fokus seg frå å *byggje* tenant-systemet til å faktisk *bruke* det — ein reell showcase-kunde, Vibeverk sjølv som ekte tenant, og sterkare personvernarbeid. Sjå "Current focus" og "Next" under.

## Fullført

**SaaS-skaleringsplanen, Fase 1–9 (2026-07-07 til 2026-07-10), alle pusha til `main`:**

1. **Fase 1 — Tryggleiksgjeld.** Full sikkerheitsaudit + personvernvurdering av éin-kunde-koden, alle HIGH/BLOCKER-funn lukka og stadfesta i produksjon. Fullført 2026-07-07.
2. **Fase 2 — Hostingarkitektur.** Vercel valt over Cloudflare/Netlify (apex-domene utan nameserver-migrering var avgjerande). Mekanismebevis (Vercel Routing Middleware) stadfesta.
3. **Fase 3 — Ekte SQL-migrasjonar.** `supabase/migrations/` er den CLI-deployerbare kjelda (baseline `20260707000001`); `migration.sql` er frose.
4. **Fase 4 — Asynkron config-bootstrap.** `App.ready(fn)`-gate i alle modular, plumbing for at config kan hentast dynamisk (føresetnad for Fase 6).
5. **Fase 5 — Namnebyte intranet → Workspace (Tier 1).** Katalog, filnamn, testnamn, URL-stiar oppdaterte. Tier 2 (`window.Intranet`, `intranettFeatures`-nøkkelen) bevisst utsett, sjå `CLAUDE.md`.
6. **Fase 6 — Reell hostname→tenant-oppløysing.** Den siste faktiske blokkeringa for kunde nr. 2. Bygd, Security Auditor-gjennomgått (2 rundar), deployert til Vercel, og **stadfesta live ende-til-ende 2026-07-09** med ein kanarikunde (`phase6-canary`): registrering → tilkopling → hemmeleg-lagring → skjema/RLS-verifisering → reell DNS/HTTP-rutingverifisering → aktivering, alt via ekte kode. Ein akseptert-for-no eksponeringsperiode (H2, provisioning-tenantar publikt oppløyselege før RLS-verifisering) vart **lukka heilt 2026-07-09**.
7. **Fase 7 — Control plane.** Eige Supabase-prosjekt `vibeverk-control` (tenant-register, operatørar, RLS, `resolve_tenant_by_hostname()`, Vault-basert hemmeleg-lagring). Sjå `docs/decisions/ADR-0008`.
8. **Fase 8 — Console mot control plane.** Console autentiserer no mot `vibeverk-control` (OTP), ikkje mot kunden sitt eige prosjekt. Alle kundehandlingar går via ein audit-logga `broker`. Sjå `docs/decisions/ADR-0009`.
9. **Fase 9 — Semi-automatisert onboarding v1.** Ny "Kundar"-seksjon i Console (liste, registreringsskjema, per-kunde sjekkliste), `tenant-admin` Edge Function. Hard-gata frå aktivering til Fase 6 fanst. Sjå `docs/decisions/ADR-0010`.

**Etter dette, 2026-07-09/10: fem-kjelde parallell tryggingsgjennomgang** — ein ekstern Codex-tryggingsrunde (køyrd av brukar sjølv) pluss fire parallelle, skrivebeskytta Claude-agentar (privacy-compliance, arkitekt, QA, ux-mobile). Synteserte til éin rapport; dei fire høgast-prioriterte funna (Console write-race, CFG-fallback-lekkasje i Console, redirect-hol og IPv6-hol i SSRF-sjekken) er fiksa, testa og deployerte (`v0.27.2`). Full detalj: `docs/project/CHANGELOG.md` og `docs/decisions/ADR-0007`.

**Konklusjon: det finst i dag ingen teknisk blokkering for å onboarde ein ekte kunde nr. 2.** Attverande punkt er akseptert-for-no restrisikoar (DNS-rebinding, at `schema_verified_at` ikkje vert revalidert før aktivering) — dokumenterte i ADR-0007, ikkje kritiske.

## Current focus

Fokus har flytta seg frå å byggje tenant-systemet til å faktisk *bruke* det — sjå "Next" under, stadfesta av brukar 2026-07-10.

## Next

1. **Eksempelkunde som reell, gyldig kundecase (showcase).** Onboarde ein ekte demo-/eksempel-tenant via Console sin no-ferdige onboardingsflyt — meint å kunne visast fram som ein reell produktdemonstrasjon, ikkje berre ein kanari-testrad som vert sletta etterpå. **Ope spørsmål, ikkje avgjort enno**: byggje vidare på det eksisterande `phase6-canary`/`vibeverk-j1yg`-oppsettet (rydde det opp til presentabel stand), eller setje opp eit heilt nytt, reint oppsett spesielt for showcase-formål? Avklarast før arbeidet startar.
2. **Vibeverk sjølv som reell tenant i systemet.** I dag køyrer Vibeverk sin eigen produksjon (`vibeverk.no`) UTANFOR tenant-modellen — statisk `config.js`, direkte mot sitt eige Supabase-prosjekt (`clzczbyklgdtdhgjphup`), ikkje registrert i `vibeverk-control` sitt tenant-register. Brukar ønskjer at Vibeverk sjølv («den reelle aktøren») også skal nytte plattforma gjennom same tenant-system som andre kundar, ikkje som eit særtilfelle. Dette er ei **arkitektur-sensitiv endring som rører reell produksjonstrafikk** — skal gå via Arkitekt-agenten FØR gjennomføring (jf. CLAUDE.md sin regel om arkitekturendringar), og kvart steg som rører produksjon krev eksplisitt godkjenning som vanleg. Heng saman med punkt 1 (same mekanisme, ulikt formål).
3. **Personvern — sterkare dokumentasjon og gjennomgang.** Løftar opp i prioritet det som tidlegare stod som eit seinare steg (standardkontrakt, databehandlaravtale/DPA, personvernerklæring). Skal ha ein eigen, grundig gjennomgang av **Privacy/Compliance Advisor**, ikkje berre ei rask utfylling av malar — gjeld både den eksisterande produksjonskunden og den nye eksempelkunden frå punkt 1. Fylt ut frå malane i `docs/compliance/` med stadfesta fakta, aldri oppdikta funksjonalitet.
4. **Læringsdokument til brukaren sjølv.** Eit fullstendig dokument som forklarar plattforma/arkitekturen for brukaren si eiga forståing (ikkje kundedokumentasjon). Brukar kjem med ein eigen, tydeleg prompt for dette seinare — **parkert her som eit kjent, ventande behov, ikkje scopa vidare før den prompten kjem.**

## Later

- **Fase 10 — `customModules`-manifest.** Ikkje starta.
- **Avgjerd om kanarikunde-oppsettet** (`phase6-canary`/`vibeverk-j1yg`) — kan falle saman med "Next" punkt 1 over, eller handterast separat om showcase-kunden vert eit heilt nytt oppsett.
- **Support-tilgang for Console-operatørar inn i kunden sin eigen CRM/leads/bookings.** Tilrådd retning (2026-07-07, ikkje bygd): avgrensa/audit-logga, tidsavgrensa "support-økt" inn i kunden sitt eige UI — IKKJE full embed (for stor samla PII-risikoauke). Personvern-/samsvarsrelevant, må gjennom Privacy/Compliance Advisor før bygging.
- **Web-admin (`/admin/`) som reint separat SPA**, i staden for dagens hybrid (dedikert URL + hash-triggra overlegg + modal-tunge enkelthandlingar). Vurdert som ei rimeleg, men arkitektonisk uavhengig oppryddingsoppgåve — via Arkitekt-agenten separat, konkurrerer ikkje med punkta over.
- **Steg 6f — Motta e-post (inbound).** Design ferdig (Message-ID-tråding via Resend, automatisk ny Kontakt-lead + CRM-kunde ved manglande treff). Sett på vent av brukar 2026-07-01, uendra sidan. Må gjennom Security Auditor + Privacy Advisor før bygging.
- **Full i18n / engelsk språkstøtte** — ingen infrastruktur finst enno, større arkitekturoppgåve.
- **Steg 6d — Realtime.** Bytte polling i Chat med Supabase Realtime fullt ut (delvis alt på plass, sjå `docs/project/CURRENT_STATE.md`).
- **Steg 9 — Kvalitetssjekkar.** Full gjennomgang av alle modular, cross-device testing, tilgjengelegheit (WCAG), ytingstest (Lighthouse).

## Ideas / Parking lot

- **`hub/tenants.js` — reell autentisering + flytte kundedata til Supabase.** Parkert 2026-07-01, framleis eksplisitt utanfor scope — Hub vert ikkje brukt for kundar no. Må takast opp att FØR ein reell (ikkje-eigen) kunde vert lagt inn i Hub, om Hub i det heile framleis er den tiltenkte vegen no som Console/tenant-registeret finst.
- **Steg 10 — AI-native Chat.** Ein AI-assistent bygd inn i den native chat-løysinga (RAG via pgvector, KB/FAQ/CRM/Booking-kontekst, hybrid AI/operatør-modus). Eksplisitt spekulativ forretningsmodell-utforsking, ikkje eit forplikta steg.
- Custom design-modul (visuell tema-editor for kunde-sjølvbetjening) — nemnd i tidlegare arkitektnotat, ikkje prioritert.
- PWA-manifest / Service Worker for Workspace — nemnd i tidlegare arkitektnotat, låg prioritet.
