# Copy Style Guide — hvordan Vibeverk skal snakke til brukeren

Stadfesta av bruker 2026-07-13: klarhet i brukerflaten er ikke en finpuss, det er selve forretningsideen — Vibeverk skal hjelpe ikke-tekniske SMB-kunder ta i bruk digitale verktøy de faktisk forstår. Denne fila samler reglene for hvordan tekst i grensesnittet (etiketter, placeholders, hjelpetekster, bekreftelsesdialoger) skal skrives, på tvers av alle tre flatene (offentlig side/Web-admin, Workspace, Console). Utarbeidet med vibeverk-architect 2026-07-13 etter en gjennomgang av eksisterende mønstre — se [`docs/roadmap/ROADMAP.md`](../roadmap/ROADMAP.md) "Next" punkt 0 for bakgrunn og videre plan.

**Dette er en stående regel, ikke en engangssjekkliste å bli ferdig med** (stadfesta av bruker 2026-07-13, sjå `CLAUDE.md` "User-facing text"). Kvar gong du legg til eller endrar eit felt, ei lagre-/slette-/nullstill-handling, ein `confirm()`-dialog, eller anna brukarvend tekst — som del av KVA SOM HELST oppgåve, uansett kor liten — skal reglane under følgjast DER OG DA, ikkje samlast opp til ein seinare opprydningsrunde. UX/Mobile Reviewer (`.claude/agents/vibeverk-ux-mobile-reviewer.md`) sjekkar no dette som ein fast del av kvar gjennomgang.

## Grunnregelen

Skriv som om du forklarer det til noen som aldri har brukt et adminpanel før. Aldri fagsjargong — si hva som faktisk skjer, i vanlige ord.

| I stedet for... | Skriv... |
|---|---|
| "Committing image metadata" | "Dette lagrer bildet ditt" |
| "Synkroniserer med backend" | "Lagrer endringen" |
| "Payload" / "endpoint" / "schema" | Beskriv hva det faktisk betyr for brukeren (f.eks. "innholdet i sikkerhetskopien", "adressen serveren svarer på", "hvilke tabeller databasen har") |
| "Utfør handling" | Si konkret hva handlingen gjør ("Slett kunden", "Send e-post på nytt") |

Kort glossar — unngå disse ordene i brukervendt tekst, bruk det norske alternativet:

| Unngå | Bruk heller |
|---|---|
| commit | lagre |
| sync/synkronisere | oppdatere / hente på nytt |
| payload | innhold |
| schema | (database-)struktur, eller navngi konkret det gjelder (f.eks. "tabellene") |
| endpoint | adresse/tilkobling |
| deploy/deployere | publisere / sette live |
| revoke/grant | fjerne/gi tilgang |

## Hvilket verktøy når — `field({hint, help})` vs. `helpIcon()`

Begge finnes allerede i `components.js` og skal brukes fremfor å håndrulle egne forklaringsavsnitt per modul:

- **`field({ hint: "..." })`** — kort, alltid synlig tekst rett under et felt, for kontekst brukeren typisk trenger med én gang (f.eks. "Vises til besøkende på kontaktsiden"). Bruk når forklaringen er kort og alltid relevant.
- **`field({ help: "..." })`** (nytt 2026-07-13) — rendrer en `helpIcon()` ved siden av selve label-en, for lengre forklaring som ikke trenger å være synlig hele tiden (f.eks. hva et bestemt valg faktisk betyr, hvorfor et felt finnes). Bruk når forklaringen ville gjort layouten rotete om den alltid var synlig.
- Et felt kan trenge begge samtidig — det er derfor `field()` støtter begge parameterne uavhengig av hverandre, i stedet for at hver modul bygger label+hint+helpIcon-markup manuelt (se `imageField()` i `components.js` for et eksempel som gjorde nettopp det før denne utvidelsen).

## Lagre-/slette-kommunikasjon: to nivåer (+ ett Console-spesialtilfelle)

**Nivå A — reversibelt/rutinemessig** (lagre et tekstfelt, endre rekkefølge, skru av/på en funksjon): inline `field__hint`/`helpIcon()` FØR handlingen, `form__status is-ok`/`is-error`-tilbakemelding ETTER. Ingen `confirm()`-dialog — de fleste admin-panel i dag følger allerede dette.

**Nivå B — destruktivt/irreversibelt eller vanskelig å angre** (slett, arkiver, gjenopprett-og-overskriv, nullstill, alt som påvirker en annen persons data): en `confirm()`-dialog som ALLTID sier, i klartekst:
1. Nøyaktig hva som blir påvirket (omfang)
2. Hva som eventuelt IKKE blir påvirket, hvis relevant
3. Om det kan angres

Referanseeksempel (allerede i koden, `core.js`, backup-import): *"Dette overskriver ALT eksisterende innhold på denne siden med innholdet i «{filnavn}» (unntatt chat og personlige notater, se merknad over). Dette kan ikke angres. Er du sikker?"*

**Nivå B-inline (kun Console)** — for en handling som teknisk sett er en vanlig lagring (ikke et diskret slett-klikk), men har uvanlig stor konsekvens (f.eks. å endre domenenavn på en allerede aktiv kunde): samme eksplisitte konsekvens-språk som nivå B, men levert som en synlig advarselstekst ved siden av lagre-knappen, ikke en modal. Referanseeksempel (allerede i koden, Console sin kunde-sjekkliste): *"⚠️ Kunden er aktiv — endring tek effekt UMIDDELBART på det livesida svarer på, utan ny verifisering. Sjekk at DNS/Vercel peikar rett FØR du lagrar."*

## Console spesielt: sjekkliste-mønsteret

Console sin kunde-sjekkliste (registrer → kopling → hemmelig → skjema → ruting → aktiver) er allerede riktig form for enhver Console-handling med reelle konsekvenser — nummerert steg, status (✓/—), inline forklaring, og advarsel der relevant. Nye Console-handlinger med reell konsekvens (arkivere, endre domene, rotere hemmelighet, aktivere) skal følge samme mal, ikke finne opp sin egen form. **Ikke bygget ennå**: `renderKdDetail()` i `console-core.js` bygger i dag hvert `.kd-card`-steg som håndrullet strengkonkatenering — anbefalt (ikke gjort) å trekke dette ut til en delt `kdCard()`-hjelpefunksjon før flere Console-handlinger legges til, se `docs/roadmap/ROADMAP.md` "Next" punkt 0.

## Rekkefølge for den opphavlege innhentingsrunden (fase 1-4, 2026-07-13)

Denne rekkefølgja gjaldt kun den initielle oppryddinga av EKSISTERANDE tekst — ikkje ei framtidig arbeidskø. Nytt/endra arbeid følgjer reglane over løpande, uavhengig av kva fase det tilhøyrer:

1. **Console sine destruktive/høy-konsekvens-handlinger først** (minst filflate, høyest konsekvens per feil) — fullført v0.33.0/0.33.1
2. **Workspace sine destruktive handlinger** — fullført v0.33.2
3. **Web-admin sine paneler** — fullført v0.33.3
4. **Generelle tooltips/hint overalt**, opportunistisk modul for modul — starta v0.33.4 (Console sine 25 funksjonsbrytarar), resten ope-slutta

Se `docs/roadmap/ROADMAP.md` "Next" punkt 0 for status på kor langt den opphavlege innhentingsrunden faktisk har kome (attverande: Console sine andre fanar, og dei ikkje-destruktive felta i Workspace/Web-admin).
