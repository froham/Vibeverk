# Utkast — «Tredjeparter og databehandlere»-seksjonen for vibeverk.no sin personvernerklæring

> **UTKAST — ikke godkjent for bruk.** Skrevet 2026-07-16 av Privacy and Compliance Advisor, grunngjeve i verifiserte fakta (kode + eksterne leverandørers egne DPA-/subprocessor-sider, se `docs/compliance/data-map-vibeverk.md` seksjon 3-4 for kildehenvisning per linje). Krever gjennomlesing/godkjenning av deg, og en juridisk sanity-sjekk anbefales én gang før publisering — spesielt av vurderingen "SCC er tilstrekkelig overføringsgrunnlag" for Vercel/Resend, som er et område med pågående juridisk debatt (post-Schrems II).
>
> **Oppdatert 2026-07-18 (draft, ikke juridisk gjennomgått)**: Resend-avsnittet nedenfor er utvidet til å nevne innkommende e-post (v0.43.x, bygd etter at denne seksjonen først ble skrevet 2026-07-16) — se `docs/compliance/draft-inbound-email-legal-basis-memo.md` for den fulle juridiske vurderingen av selve rettsgrunnlaget for automatisk profiloppretting fra ukjente avsendere, som er et separat, uløst spørsmål denne personvernerklærings-seksjonen alene ikke løser.

---

## Tredjeparter vi bruker, og hvor dataene dine lagres

Vi bruker et lite antall utvalgte tjenesteleverandører for å drive denne nettsiden. Her er en fullstendig oversikt over hvem de er, hva de gjør, og hvor dine opplysninger faktisk lagres eller behandles.

**Database og lagring — Supabase (EU)**
All informasjon vi lagrer om deg — henvendelser, chat-samtaler, bookinger, kundeforhold — lagres hos Supabase, med data plassert i Irland (EU). Ingen av dine opplysninger lagres utenfor EU/EØS av denne leverandøren.

**Analyse — Plausible (EU, uten cookies)**
Vi bruker Plausible for å telle besøk på nettsiden. Plausible samler ikke inn personopplysninger, bruker ikke cookies, og kan derfor ikke spore deg mellom besøk eller nettsteder. All databehandling skjer i EU (leverandøren er registrert i Estland). Fordi dette ikke er sporing i lovens forstand, krever det ikke samtykke via et cookie-banner.

**Skrifttyper — selvhostet**
Skrifttypene på denne siden lastes fra vår egen server, ikke fra en ekstern leverandør. Nettleseren din sender derfor ingen forespørsel til tredjepart bare for å vise siden riktig.

**E-postutsendelse og -mottak — Resend (USA)**
Når vi svarer på en henvendelse fra deg, sender deg en pålogging-/invitasjons-e-post, eller mottar en e-post du sender til oss, går denne gjennom Resend, som er et amerikansk selskap. Resend har inngått EUs standardavtaler for personvern (Standard Contractual Clauses) som lovlig grunnlag for denne overføringen. Dette er den av våre leverandører som håndterer mest av selve innholdet i dine henvendelser (e-postadresse, navn, emnefelt, og — for e-post du sender oss direkte — selve meldingsteksten).
Vi lagrer et begrenset utvalg tekniske identifikasjonsdata for e-post vi mottar (avsenderadresse, emnefelt, tekniske e-postheadere for autentisering og trådsammenheng) uavhengig av om avsenderen har noe eksisterende kundeforhold til oss. Hvis en e-post kommer fra en du ikke tidligere har hatt kontakt med, kan dette opprette en ny kontaktprofil hos oss automatisk.

**Hosting og trafikkstyring — Vercel (USA, med europeiske driftspunkter)**
Selve nettsiden vises via Vercel. Vercel er et amerikansk selskap og har, som Resend, inngått EUs standardavtaler som lovlig overføringsgrunnlag. Vercel ser kun hvilket domene du besøker (ikke navnet ditt, e-posten din eller innholdet du sender inn) for å vise riktig side — denne behandlingen er svært begrenset i omfang sammenlignet med den faktiske informasjonen du gir oss i skjemaer eller chat.

---

## Kort oppsummert

| Leverandør | Hva de gjør | Hvor | Overføringsgrunnlag |
|---|---|---|---|
| Supabase | All lagring | EU (Irland) | Ikke relevant — ingen overføring ut av EU |
| Plausible | Besøksstatistikk | EU (Estland) | Ikke relevant — ingen overføring ut av EU |
| Resend | E-postutsendelse | USA | EUs standardavtaler (SCC) |
| Vercel | Hosting/trafikkstyring | USA | EUs standardavtaler (SCC) |

---

## Ting som gjenstår før dette kan brukes reelt

1. **Juridisk sanity-sjekk** av hele seksjonen, spesielt SCC-vurderingen for Resend/Vercel (én gang, ikke løpende).
2. **Bekreft faktiske DPA-er er signert/akseptert** med Supabase, Resend og Vercel (sjekk dashboards/avtaledokument — ikke bare at de *tilbyr* SCC, men at *dere* faktisk har inngått dem).
3. **Avklar Vibeverk sin rolle for denne tenanten** (behandlingsansvarlig for besøkende, jf. tidligere avklaring i økta) reflekteres korrekt andre steder i personvernerklæringen (hvem som er "behandlingsansvarlig" må stå tydelig et annet sted i dokumentet, ikke bare i denne seksjonen).
4. **Bekreft om Plausible faktisk er aktivert** for den live `vibeverk.no`-konfigurasjonen (Console → Analyse-fanen) — denne teksten forutsetter at den er det, siden du bekreftet et aktivt valg.
5. **Rettsgrunnlaget for automatisk profiloppretting fra ukjente e-postavsendere er IKKE avklart** — se `docs/compliance/draft-inbound-email-legal-basis-memo.md`. Denne seksjonen beskriver bare AT dette skjer og HVEM som behandler dataene (Resend), ikke om det faktiske rettsgrunnlaget («berettiget interesse») er tilstrekkelig — det er et eget, ikke-teknisk spørsmål som krever juridisk rådgivning før en reell kunde med denne funksjonen går live.
