# Vibeverk — Roadmap

Roadmap content is planning material. It is not proof of current functionality, architecture, security posture or customer commitments. For verified current state, see [`docs/project/CURRENT_STATE.md`](../project/CURRENT_STATE.md). For historical detail behind completed and paused work, see [`docs/archive/roadmap-2026-07-01.md`](../archive/roadmap-2026-07-01.md) and [`docs/archive/roadmap-history-2026-07-19.md`](../archive/roadmap-history-2026-07-19.md).

Sist oppdatert: 2026-07-19.

**2026-07-19 omskriving**: denne fila hadde vakse til ein andre endringslogg — lange, fleire-avsnitts "Status YYYY-MM-DD"-oppdateringar nesta inne i "Next"-punkt heilt attende til 2026-07-07 — i staden for å faktisk vise Current focus/Next/Later. Heile den gamle teksten er bevart uendra i `docs/archive/roadmap-history-2026-07-19.md`; denne fila er no omskriven til å vere kort og fokusert på det som faktisk gjeld no. Ingen roadmap-prioritetar er endra utover det brukaren eksplisitt har sagt for denne runda (sjå "Current focus").

## Overordna mål

**Retning stadfesta 2026-07-07** (Arkitekt-godkjent, sjå `docs/decisions/ADR-0008-control-plane-data-plane-split.md`): Vibeverk skal skalere frå éin kunde til 10–100 SMB-kundar via éin sentral Console (kontrollplan) og eitt Supabase-prosjekt per kunde (dataplan, uendra prinsipp) — ikkje via repo-fork-per-kunde.

## Fullført

Den tekniske SaaS-skaleringsplanen (Fase 1–9, kontrollplan/dataplan-splitt, hostname→tenant-oppløysing, semi-automatisert onboarding) er fullført og deployert sidan 2026-07-10. Vibeverk sjølv vart teke inn som ekte tenant og `vibeverk.no` sin DNS vart faktisk flytta til Vercel 2026-07-16. Sunnvask vart onboarda som demo-/showcase-kunde via den ekte Console-onboardingsflyten 2026-07-14. Ein første, brei "forklaringstekster og brukarvennlegheit"-runde (Console → Workspace → Web-admin → generelle tooltips) vart gjennomført 2026-07-13 til 2026-07-17, og held fram som eit standande krav (sjå `CLAUDE.md`), ikkje eit ope roadmap-punkt lenger. Innkomande e-post (motta svar på utsendt e-post) er bygd og live i produksjon sidan v0.43.0/0.43.1 (2026-07-17). Full detalj og datering for alt dette: `docs/archive/roadmap-history-2026-07-19.md`, `docs/project/CHANGELOG.md`, `docs/project/CURRENT_STATE.md`.

## Current focus

**Stadfesta av brukar 2026-07-19, gjeld heile denne fila**: slutt å byggje nye funksjonar for no. Fokus er kvalitet, lukking av driftsgjeld, og reell testing — avgrensa til nøyaktig dei to reelle tenantane som finst i dag (Vibeverk sjølv, og Sunnvask-demo). Ikkje finn opp nye hypotetiske kundescenario.

## Next

1. **Lukk Sunnvask-demo sin driftsgjeld.** Sunnvask-demo (`nzgibflxodcwuhtaprrs`) vart onboarda 2026-07-14 og manglar i dag alle Edge Functions lagt til etterpå (`send-reply`, `inbound-email`, `anon-media-upload-token`) — stadfesta direkte via `npx supabase functions list`. Basert på det er det ein sterk, men **ikkje stadfesta**, mistanke om at prosjektet sitt skjema framleis sit rundt migrasjon `20260714133000` og manglar minst 9 seinare migrasjonar (sjå `docs/project/CURRENT_STATE.md` for den fulle, kodeverifiserte konsekvenslista — mellom anna at bookingkalenderen sin anon-gren då ville vise fullbooka dagar som ledige, ein stille regresjon). Treng eit databasepassord/pooler-tilkoplingsstreng for Sunnvask-demo (eller at brukar sjølv køyrer `npx supabase db push` mot prosjektet) for å stadfeste presist og lukke gapet — **eit prerequisite-steg før vidare demo-tenant-testing**, ikkje noko som skal blandast saman med den testinga sjølv.
2. **Hald fram den automatiserte Playwright-smoke-testpakken** mot `vibeverk-staging` (`.claude/skills/smoke-vibeverk/`). `dashboard-shortcuts` og `user-deletion` er stadfesta PASS live. Attståande i QA sin tilrådde rekkjefølgje: `backup-restore`, full innloggingsmatrise, Console sin onboarding-sjekkliste.
3. **Løys e-post-testingsgapet.** `vibeverk-staging` manglar `send-reply`/`inbound-email`, så utgåande/innkomande e-post kan i dag berre ende-til-ende-testast mot produksjon — i konflikt med den generelle "aldri destruktiv-test mot produksjon"-instinktet. Treng ei avgjerd: deploy dei to funksjonane til staging, aksepter at e-post-testing berre skjer forsiktig mot produksjon, eller bruk Sunnvask-demo når han er oppdatert (sjå punkt 1).
4. **Personvern — dokumentasjon og forslag** (uendra prioritet frå 2026-07-13/17, ikkje reprioritert denne runda): DPA-mal, standardkontrakt-mal, personvernerklærings-utkast i `docs/compliance/` — planleggingsmateriale, ikkje eit hastesteg sidan Vibeverk ikkje er eit registrert juridisk selskap i dag og ingen ekte kundar/data er i bruk.
5. **Attverande, medvite utsette kvalitets-/tilgjengelegheitsfunn** frå Batch 5–6-gjennomgangen (t.d. touch-target-storleik på nokre tettpakka layoutar, Console-fane-innhald sin respons utover sjølve skallet) — treng ekte nettlesar-/mobil-verifisering, ikkje kode-lesing åleine. Sjå `docs/archive/roadmap-history-2026-07-19.md` for den fulle lista.

## Later

Uendra i substans frå før denne omskrivinga (berre gjort kortare) — ingen av desse er reprioriterte denne runda:

- **Full i18n / engelsk språkstøtte.** Ingen `t()`/`STRINGS`-infrastruktur finst; ei større arkitekturoppgåve (sentral strengkatalog, per-kunde/per-brukar språkval), ikkje ein enkel oversetjingspass.
- **Chat inn i CRM-tidslinja** (utvidar den alt-bygde e-post/mini-CRM-tidslinja med chat som sin eigen `crm_comms`-oppføringstype). Krev ingen ekstern input, men er ei ny funksjonalitets-utviding — **medvite sett på pause i tråd med "Current focus" over**, ikkje avvist.
- **Design-modul ("sidebygger") — ope spørsmål frå 2026-07-18 attstår**: kva anna (utover mal/farge/font/logo/tagline/SEO) bør kunden sjølv kunne styre i Design-fana. Sjølve funksjonen (tre malar, kunde-sjølvbeteningsfelt) er bygd, men `features.sidebygger` er av i alle reelle oppsett i dag.
- **`hub/tenants.js` — reell autentisering + flytte kundedata til Supabase.** Parkert sidan 2026-07-01, Hub vert ikkje brukt for kundar no. Må takast opp att før ein reell (ikkje-eigen) kunde vert lagt inn i Hub, om Hub i det heile framleis er tiltenkt no som Console/tenant-registeret finst.
- **Support-tilgang-disclosure**: `generate_support_access` (tidsavgrensa magic-link-impersonering for support) manglar framleis ein kundevendt disclosure-tekst i personvernerklæringa. Ikkje-urgent, før ein reell kunde.
- **AI-native Chat.** Ein AI-assistent bygd inn i den native chat-løysinga (RAG via pgvector). Eksplisitt spekulativ forretningsmodell-utforsking, ikkje eit forplikta steg.
- **PWA-manifest / Service Worker for Workspace.** Låg prioritet, ingen konkret plan.
- **Steg 9 — brei kvalitetsgjennomgang.** Full gjennomgang av alle modular, cross-device testing, tilgjengelegheit (WCAG), ytingstest (Lighthouse) — breiare enn punkt 5 i "Next" over.
