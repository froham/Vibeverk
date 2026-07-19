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

1. **Køyr testmatrisa** (`.claude/skills/smoke-vibeverk/TEST-MATRIX.md`) mot dei to reelle tenantane. Sunnvask-demo sin driftsgjeld (9 manglande migrasjonar + 3 manglande Edge Functions) vart stadfesta OG lukka 2026-07-19 — begge tenantar er no fullt oppdaterte og deployment-like, så seksjon D (demo-spesifikke testar) i matrisa er ikkje lenger blokkert av eit prerequisite-gap.
2. **Hald fram den automatiserte Playwright-smoke-testpakken** mot `vibeverk-staging` (`.claude/skills/smoke-vibeverk/`). `dashboard-shortcuts` og `user-deletion` er stadfesta PASS live. Attståande i QA sin tilrådde rekkjefølgje: `backup-restore`, full innloggingsmatrise, Console sin onboarding-sjekkliste.
3. **E-post-testingsgapet er delvis løyst**: Sunnvask-demo har no `send-reply`/`inbound-email` deploya (2026-07-19), så e-post-flytar kan testast der i staden for berre mot produksjon. `vibeverk-staging` manglar framleis begge funksjonane — framleis ei ope avgjerd om dei skal deployast dit òg, eller om Sunnvask-demo held som testmål for dette.
4. **Personvern — dokumentasjon og forslag** (uendra prioritet frå 2026-07-13/17, ikkje reprioritert denne runda): DPA-mal, standardkontrakt-mal, personvernerklærings-utkast i `docs/compliance/` — planleggingsmateriale, ikkje eit hastesteg sidan Vibeverk ikkje er eit registrert juridisk selskap i dag og ingen ekte kundar/data er i bruk.
5. **Attverande, medvite utsette kvalitets-/tilgjengelegheitsfunn** frå Batch 5–6-gjennomgangen (t.d. touch-target-storleik på nokre tettpakka layoutar, Console-fane-innhald sin respons utover sjølve skallet) — treng ekte nettlesar-/mobil-verifisering, ikkje kode-lesing åleine. Sjå `docs/archive/roadmap-history-2026-07-19.md` for den fulle lista.

## Later

Uendra i substans frå før denne omskrivinga (berre gjort kortare) — ingen av desse er reprioriterte denne runda:

- **Full i18n / engelsk språkstøtte.** Ingen `t()`/`STRINGS`-infrastruktur finst; ei større arkitekturoppgåve (sentral strengkatalog, per-kunde/per-brukar språkval), ikkje ein enkel oversetjingspass.
- **Chat inn i CRM-tidslinja** (utvidar den alt-bygde e-post/mini-CRM-tidslinja med chat som sin eigen `crm_comms`-oppføringstype). Krev ingen ekstern input, men er ei ny funksjonalitets-utviding — **medvite sett på pause i tråd med "Current focus" over**, ikkje avvist.
- **Design-modul ("sidebygger") — ope spørsmål frå 2026-07-18 attstår**: kva anna (utover mal/farge/font/logo/tagline/SEO) bør kunden sjølv kunne styre i Design-fana. **`features.sidebygger` er faktisk `true` på BÅDE Vibeverk sjølv og Sunnvask-demo** (stadfesta direkte 2026-07-19 — ei tidlegare utgåve av denne fila hevda feilaktig at han var av overalt, fanga opp av brukar same dag via eit skjermbilete av sitt eige adminpanel). Funksjonen er altså i aktiv bruk, ikkje dormant — det opne spørsmålet gjeld berre kva meir kunden bør kunne styre sjølv, ikkje om funksjonen skal skruast på.
- **`hub/tenants.js` — reell autentisering + flytte kundedata til Supabase.** Parkert sidan 2026-07-01, Hub vert ikkje brukt for kundar no. Må takast opp att før ein reell (ikkje-eigen) kunde vert lagt inn i Hub, om Hub i det heile framleis er tiltenkt no som Console/tenant-registeret finst.
- **Support-tilgang-disclosure**: `generate_support_access` (tidsavgrensa magic-link-impersonering for support) manglar framleis ein kundevendt disclosure-tekst i personvernerklæringa. Ikkje-urgent, før ein reell kunde.
- **AI-native Chat.** Ein AI-assistent bygd inn i den native chat-løysinga (RAG via pgvector). Eksplisitt spekulativ forretningsmodell-utforsking, ikkje eit forplikta steg.
- **PWA-manifest / Service Worker for Workspace.** Låg prioritet, ingen konkret plan.
- **Steg 9 — brei kvalitetsgjennomgang.** Full gjennomgang av alle modular, cross-device testing, tilgjengelegheit (WCAG), ytingstest (Lighthouse) — breiare enn punkt 5 i "Next" over.
- **`vibeverk.no` manglar ekte inbound-parse-ruting hos Resend, pluss avsendar-adressa bør endrast frå `noreply@`** (logga 2026-07-19, avklart med brukar — eksplisitt utsett til Resend Pro er kjøpt). Stadfesta live under ende-til-ende-verifisering av 0.64.1-fiksen: eit ekte svar til `hei@vibeverk.no` (standard "Svar-til" i CRM sin E-post-dialog) nådde ALDRI `inbound-email`-webhooken — berre eit Resend-konto-nivå sandkasse-testadresse (`test@lexaubeleu.resend.app`) gjorde det. Sjølve tråd-matching-koden er stadfesta rett (sjå 0.64.1-endringsloggoppføringa), men den faktiske e-postinfrastrukturen for `vibeverk.no` sitt eige domene er ikkje ferdig kopla opp. Treng, når Resend Pro er på plass: (1) verifisere `vibeverk.no` som eit ekte inbound-parse-domene i Resend (MX/DNS-oppsett), (2) byte standard-avsendar bort frå `noreply@vibeverk.no` til ei meir personleg/svar-venleg adresse, (3) stadfeste at CRM sin "Svar-til"-standardverdi (i dag hardkoda `"hei@vibeverk.no"` client-side i `core.js` sin `openReplyModal`, ikkje lesen frå nokon config) faktisk peikar på den rette, verifiserte adressa.
- **Ingen bekreftelses-e-post ved skjemainnsending** (kontakt/tilbod/booking) — stadfesta 2026-07-19 at dette er korrekt, med vilje utsett funksjonalitet (ikkje ein feil), ikkje bygd enno. Ingen kode/trigger for dette finst i dag (`insert_anon_lead()`/`insert_anon_booking()` er reine innsettingar, ingen e-postlogikk). Ingen prioritet sett — berre stadfesta status, ikkje eit nytt forplikta steg.
