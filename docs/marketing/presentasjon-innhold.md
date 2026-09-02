# Vibeverk-presentasjon — manus

Dette er manuset for kunde-presentasjonen (den sidelengs "kort"-presentasjonen).
Rediger fritt — be Claude regenerere presentasjonen fra det som står her når innholdet er klart.

Publisert versjon (oppdateres fra denne filen, samme lenke hver gang):
https://claude.ai/code/artifact/651b99d8-8a92-40ca-b91a-665886b9d95f

**Dette er ikke produktdokumentasjon** — det følger ikke `docs/README.md` sin kjelde-til-sanning-styring for platformen. Det er et salgs-/pitch-manus, og skal behandles deretter (tall og påstander her må stemme med verkelegheita, men fila sjølv styrer ikkje arkitektur- eller produktavgjerder).

**Manus vs. det som vises på skjermen:** teksten under kan være fyldigere enn det som faktisk står på hver slide — presentasjonen viser kortere utdrag/overskrifter, mens du som presentatør snakker rundt det fulle innholdet her. Ikke anta at hver setning i manuset havner ordrett på skjermen.

---

## Status / åpne punkt

- [x] Portrettet er rettet: sirkelen var for tett/dårlig beskåret — erstattet med et større, avrundet-rektangel-portrett (ansikt+skuldre), plassert til venstre med tekst til høyre
- [x] Sitatet ("oppgjør med dyre og dårlige outsourcede løsninger") er i presentasjonen
- [x] Lyst tema er nå standard, med faktisk Vibeverk-logo brukt i hjørnet og på hero-sliden. Mørkt tema (det forrige designet) er bevart som fallback/alternativ, med manuell av/på-bryter (måneikonet øverst til høyre) — følger også besøkendes systeminnstilling som utgangspunkt
- [x] Ny kort modul-oversikt lagt til rett før siste slide (kapittel 10, se under)
- [x] Vibeverk-logoen vises nå som et lite, dempet vannmerke øverst til høyre på hver eneste slide (i tillegg til den store på hero og det faste hjørnemerket)
- [x] Zoom-kontroll lagt til (desktop): +/− knapper og prosenttall øverst til høyre, pluss piltastene +/−/0 og Ctrl/Cmd+scroll — forstørrer selve kortet (`.plate`), ikke hele siden
- [x] Lyst tema gjort mer dynamisk: myk flerfarget gradient-bakgrunn (varme/kjølige toner fra logoen) + to-tonet animert bakgrunnsbevegelse (blå + korall), i stedet for flat ensfarget bakgrunn
- [x] Modullistene (Muligheter- og Kort oppsummert-sliden) er rettet til den faktiske, fullstendige modul-listen fra kodebasen (se README.md sin mappestruktur) — manglet tidligere bl.a. Scrollbanner/Karusell/Innsikt/Aktuelt/Notater/Lenker/Henvendelser/Intern mediebank/Brukeradministrasjon. Hver tagg har nå en kort hover-forklaring (`title`-attributt)
- [x] "Reelt eierskap" mykere formulert ("det meste", ikke "full" eksport)
- [x] Ny "Personvern inkludert"-punkt lagt til i hovedlisten
- [x] **Arkitekturmodellen er fjernet helt** — etter fire redesign-runder erstattet med en stor, uthevet Innsikt/cookiefri-boks i sidekolonnen (se kapittel 7 for full historikk). Boksen er flyttet opp til å starte i flukt med ingress-avsnittet, ikke lenger enn liste-punktene
- [x] "Ingen cookies" er ikke lenger et eget punkt — bygget inn i Innsikt-boksen med riktig presisering: cookiefritt er standard uansett modul, Innsikt-modulen (tilvalg) er bonusen oppå det
- [x] **Bokmål/nynorsk-språkbryter lagt til** (2026-09-02) — "BM"/"NN"-knapp ved siden av tema-bryteren, oversetter alt synlig tekstinnhold på alle 9 sider (inkludert chip-tooltips og lightbox-bildetekster). Teknisk løsning: `data-i18n`-attributter + én JS-ordbok med berre nynorsk-tekstene (bokmål er allerede den faktiske HTML-en, hentet automatisk ved oppstart — ikke dobbeltført noe sted)
- [ ] Ekte priser mangler fortsatt (kapittel 12) — ikke en del av presentasjonen ennå
- [ ] Vurder om testtallene skal med noe sted, eller droppes som vedlikeholdsbyrde

---

## Rekkefølge i selve presentasjonen

1. Hero (nå med Vibeverk-logoen øverst)
2. Om Vibeverk
3. Eksempler (isbryter)
4. *(Behovskartlegging skjer her — live samtale, ikke en slide, se kapittel 4 under)*
5. Muligheter (kort bro inn i demo)
6. **Løsningen i praksis** — tre skjermbilder (Frontend/Backend/Workspace) fra vår demo-kunde (Sunnvask er oppdiktet, ikke en reell bedrift), klikkbare for forstørring, pluss en "Vis demo"-lenke til https://sunnvask-demo.vercel.app/ for å hoppe rett til den levende demoen
7. Sikkerhet
8. Bak Vibeverk (stort portrett til venstre, sitat)
9. **Moduloversikt** — kompakt liste over alle moduler (nettside/workspace/tilvalg), rett før avslutningen
10. **Veien til oppstart** (avslutning — tre steg, ingen priser ennå)

Kapittel 12 (pris) er **ikke** med i presentasjonen ennå — dere lander konkret pris muntlig, menneske til menneske.

**Bilder brukt i presentasjonen** ligger i `docs/marketing/assets/`: `fh-portrait-720.jpg` (portrett ansikt+skuldre, generert fra `Bilde FH.jpg`), `vibeverk-logo.png` / `vibeverk-logo-320.png` (hentet fra `config.js` sin `logoUrl`, samme fil som brukes på selve Vibeverk-nettsiden), `Sunnvask - framside.png` (Frontend), `Sunnvask - på baksiden.png` (Backend/adminpanel), `Sunnvask - Workspace.png` (Workspace). Alle er skalert ned og bygget inn direkte i presentasjonen (base64), ikke lenket eksternt.

**Fargesystem:** presentasjonen bruker CSS-variabler (`--bg`, `--panel`, `--ink`, `--accent` osv.) som er identiske på tvers av lyst/mørkt tema — bare verdiene endres. Lyst tema henter aksentfargen fra logoens blå/cyan-krom (`#2f6fe0`); mørkt tema beholder den forrige asurblå paletten uendret.

---

## 1 — Hero

**Overskrift:**
> En nettside er ikke bare et førsteinntrykk, men et verktøy for bedre samhandling med kundene dine.

**Ingress:**
> Vi tilbyr et kraftfullt og brukervennlig verktøy som forenkler driften og forbedrer kommunikasjonen med kundene. Målet vårt er å gjøre moderne teknologi enkelt og tilgjengelig for små bedrifter.

---

## 2 — Om Vibeverk

Vibeverk er en modulbasert og tilpasset SaaS-plattform, levert som en personlig forvaltet tjeneste. Vi tror på at våre kunder er unike og har stolthet for sitt produkt og varemerke, ikke et samlebåndsprodukt.

Ved å bygge på en felles plattform med gjennomprøvde moduler kan vi levere profesjonelle løsninger som samtidig tilpasses den enkelte virksomheten – til en fornuftig pris. Løsningene har et enkelt og brukervennlig publiseringsverktøy, slik at du kan håndtere det daglige innholdet selv. Målet vårt er å gi deg kontroll, ikke å gjøre deg avhengig av kostbare konsulenttimer.

Vi tar personvern, informasjonssikkerhet og ansvarlig datalagring på alvor. Derfor prioriterer vi datalagring innenfor EU og separate databaser for hver kunde, kombinert med tydelig tilgangsstyring og relevante sikkerhetstiltak.

*(På skjermen: tre korte stikklinjer, én per avsnitt over — se presentasjonen for ordlyden. Personvern-poenget her overlapper bevisst med kapittel 7 (Sikkerhet) — vurder om det ene stedet holder etter hvert.)*

---

## 3 — Eksempler (isbryter)

**Overskrift:** Noen eksempler.
**Ingress:** Ingen bedrifter jobber likt. Noen eksempler på hva som faktisk løses underveis:

**Rengjøringsfirmaet**
Telefonen ringte midt i en jobb, og bestillingsboka lå som en notatblokk i bilen. Nå ser kundene ledige tider selv, og hver avtale følger med i egen kundehistorikk — nøkkelkoder, faste rutiner, forrige besøk.

**Håndverksbedriften**
Tilbud tok for lang tid å sende ut, og konkurrenten svarte først. Nå kommer forespørselen rett inn med bilder vedlagt, og de ansatte ser hvem som gjør hva i egen arbeidsflate.

**Fotografen**
Når du bruker store deler av dagen på oppdrag, må kundedialogen fungere uten at du sitter på kontoret. La kundene se ledige tider og booke direkte, hold kommunikasjonen samlet og publiser nye bilder enkelt på nettsiden.

> Disse tre er oppdiktede, generiske arketyper (ikke navngitte, ekte kunder) — bytt ut med reelle kundehistorier etter hvert som dere har dem, med kundens godkjenning.

**Funksjon i møtet:** dette er en isbryter, ikke en påstand om hva *denne* kunden trenger. Bruk den til å åpne for gjenkjenning ("kjenner du deg igjen i noe av dette?") — ikke som bevis.

---

## 4 — Behovskartlegging (presenter-notater, IKKE en slide)

Dette kapittelet vises **aldri** på skjermen. Det er spørsmålene du stiller live, rett etter eksemplene, før du går videre til Muligheter/demo.

- **Bli funnet, og bli valgt** → "Hvordan får dere i dag nye henvendelser eller bestillinger?"
- **Ha oversikt internt** → "Hvordan holder dere oversikt internt i dag — regneark, tekstmeldinger, hukommelse?"
- **Løse det som er unikt for akkurat dere** → "Er det noe i hvordan dere jobber som en standardløsning typisk ikke fanger opp?"

Bruk svarene til å styre hvilke deler av Muligheter/demo du bruker mest tid på — ikke kjør alt likt hver gang.

---

## 5 — Muligheter (kort bro inn i demo)

**Overskrift:** Alt henger sammen.

**Avsnitt 1 — Nettside**
Den offentlige nettsiden er stedet kundene møter dere først — der de bestiller en time, ber om et tilbud, eller får svar på et spørsmål uten å måtte ringe, uten at noen sitter og svarer manuelt på hver eneste henvendelse.

**Avsnitt 2 — Internt**
Internt får de ansatte ett sted å holde oversikt — oppgaver, kunder og rutiner samlet, i stedet for regneark og tekstmeldinger spredt mellom flere apper.

**Avsnitt 3 — Skreddersydde moduler**
For dem som vil enda lenger, kan vi utvikle skreddersydde løsninger tilpasset deres arbeidsoppgaver — også med støtte fra de mest avanserte KI-modellene.

**Overgang til demo:** avslutt med noe i retning "la oss vise hvordan, direkte i løsningen" — så bytter du til det virkelige produktet. Ingen egen "demo"-slide trengs for dette.

*(Rettet 2026-09-01, runde 2: droppet modul-chipsene helt fra denne sliden. Etter forrige runde (hvor listen ble gjort fullstendig) ble denne og "Kort oppsummert" (kapittel 9) opplevd som nesten identiske. Løsningen: denne sliden er nå rendyrket fortellende tekst om verdien — den fullstendige, korrekte modul-listen med hover-forklaringer finnes kun i "Kort oppsummert". Ingen overlapp lenger.)*

---

## 6 — Løsningen i praksis

**Overskrift:** Tre flater, én løsning.
**Ingress:** Skjermbilder fra vår demo-kunde — klikk for å forstørre, eller åpne den levende demoen direkte.

Tre klikkbare skjermbilder, merket:
- **Frontend** — den offentlige nettsiden (`Sunnvask - framside.png`)
- **Backend** — adminpanelet (`Sunnvask - på baksiden.png`)
- **Workspace** — den interne arbeidsflaten (`Sunnvask - Workspace.png`)

Knapp: **«Vis demo ↗»** → åpner https://sunnvask-demo.vercel.app/ i ny fane.

> Sunnvask er en oppdiktet demo-kunde, ikke en reell bedrift — ikke omtal den som "ekte" noe sted.

---

## 7 — Sikkerhet

**Overskrift:** Egen database. Ikke en delt rad i andres.

> De fleste abonnementstjenester legger alle kundene sine i én stor, felles database og skiller dem fra hverandre med regler i koden. Vibeverk gjør det motsatt — hver kunde får sin egen, fullstendig separate database fra første dag.

**Hva det faktisk betyr for dere:**
- **Full oversikt** — dere kan alltid få vist nøyaktig hvilke data som finnes og hvor de ligger, ikke bare stole på en generell forsikring fra leverandøren
- **Lagring i EU** — databasen ligger hos Supabase, driftet fra Irland (bekreftet, ikke en uspesifisert «sky et sted»)
- **Uavhengig drift** — en feil, en trafikktopp eller en endring hos én kunde påvirker aldri oppetiden eller ytelsen til en annen
- **Reelt eierskap** — det meste av deres data kan eksporteres når som helst, ikke låst i et proprietært format
- **Personvern inkludert** (lagt til 2026-09-02) — dere får ferdig personvernstekst tilpasset nøyaktig de modulene dere bruker, ikke en generisk mal

*(Rettet 2026-09-02: "Reelt eierskap" sa tidligere "full eksport av egne data er alltid mulig" — for bastant. Backup/eksport dekker ni spesifikke tabeller; notater og chat er bevisst holdt utenfor (dokumentert avgjørelse, ikke en mangel), så det er ikke bokstavelig talt full eksport av alt. Myket opp til "det meste av deres data".)*

> Presist: det er *databasen* (Supabase) sin EU-lagring som er bekreftet (`docs/compliance/data-map-vibeverk.md`, eu-west-1/Irland). Selve nettside-hostingen/rutingen (Vercel) sin region er ikke dokumentert noe sted — ikke si "alt er i EU", bare vær presis på hva som faktisk er bekreftet.

**Innsikt/cookiefri-kort (lagt til 2026-09-02, erstatter arkitekturmodellen — se historikk nederst):** en egen, uthevet boks i sidekolonnen (der diagrammet lå før), med et lite stolpediagram-ikon:
- Liten fane: "Ingen cookies, aldri"
- Fet ingress: "Vibeverk bruker aldri cookies — helt uavhengig av hvilke moduler dere har."
- Brødtekst: "Vil dere likevel ha besøksstatistikk? **Innsikt-modulen** (tilvalg) gir dere tall på besøk og klikk — fortsatt uten å spore enkeltpersoner."

*(Viktig presisering fra bruker 2026-09-02: cookiefritt er IKKE noe man må kjøpe Innsikt-modulen for å få — hele plattformen er cookiefri som standard, uansett moduler. Innsikt-modulen er bonusen oppå det (statistikk uten å bryte cookiefri-løftet), ikke forutsetningen for det. Dette er en sterkere sak enn den opprinnelige "PS:"-formuleringen ga inntrykk av, og korrekt gjengitt i kortet over.)*

**Historikk — arkitekturmodellen som ble fjernet:** modellen gikk gjennom fire redesign-runder 2026-09-01/02 (fra en 3-kolonners kunde-sammenligning, via et Vibeverk-plattform-arkitekturdiagram, til et sluttkunde-dataflyt-diagram med "Besøkende → Nettside → Database → Varsel"). Til slutt vurderte brukeren at et helt annet virkemiddel — en stor, uthevet Innsikt/cookiefri-boks — organiserte sliden bedre og fikk frem fordelen tydeligere enn nok et diagram. Modellen er fjernet fra presentasjonen (ikke arkivert i detalj her, siden den uansett var på vei mot noe annet); prinsippene den viste (isolert database, EU-lagring, Vercel/domene, Resend/Outlook e-post) dekkes fortsatt av tekstpunktene over.

*(Samtidig ryddet: en reell HTML-strukturfeil ble funnet og rettet — 3 manglende `</div>`-lukketagger i filen (bl.a. `.plate` i både "Muligheter"- og "Sikkerhet"-sliden), som nettlesere skjuler automatisk men som er skjørt å bygge videre på. Fikset som del av denne runden.)*

Fortsatt bevisst forenklet: ingen kontrollplan/broker/Vault-detaljer (det er Vibeverk sin egen interne drift, ikke noe en kunde trenger å forholde seg til i en pitch).

---

## 8 — Bak Vibeverk

**Overskrift:** Kort vei fra ønske til endring.

> Når dere velger Vibeverk, velger dere også hvem dere jobber videre med — ikke en support-kø, ikke et ledd i en større organisasjon, men en kort, direkte linje til den som faktisk gjør endringene. Ønsker dere noe justert eller lagt til, er veien fra forslag til løsning kort. Det er den nærheten som gjør at plattformen faktisk kan tilpasses dere, ikke bare selges til dere.

> «Gjennom flere år som systemansvarlig er det på tide å ta et oppgjør med dyre og dårlige outsourcede løsninger — derfor bygger jeg Vibeverk som en motvekt til det.»
> — Frode Hammerseth, Vibeverk

*(Rettet tilbake inn etter tilbakemelding 2026-09-01: sitatet ble feilaktig tatt helt ut i forrige runde — det ble forvekslet med "stort solo-fokus", men et personlig sitat med et ekte standpunkt styrker nærhets-poenget snarere enn å svekke det. Navnet introduseres nå naturlig via attribueringen, i stedet for en egen "I dag: ..."-linje.)*

**Bilde:** ligger i `docs/marketing/assets/` når filen er lagt til der — bruk foto FH.

**Funksjon i møtet:** dette er broen videre til den muntlige samtalen om pris/neste steg — ikke en biografisk pause. Poenget er "dette er hvem dere fortsetter å jobbe med", ikke "her er litt bakgrunn om meg".

---

## 9 — Moduloversikt

**Overskrift:** Alt vi tilbyr, samlet.

*(Omdøpt 2026-09-01 fra "Kort oppsummert" — du foreslo "Moduloversikt", "Våre moduler" eller "Vi tilbyr" og lot meg velge. Landet på "Moduloversikt" som fane-merkelapp (presist, matcher innholdet) og "Alt vi tilbyr, samlet." som overskrift (fanger opp "vi tilbyr"-vinklingen).)*

To tagg-grupper og én ren tekstlinje (ikke enkeltbeskrevet i løpende tekst):
- **Nettside**: Booking · Tilbud · Chat · CRM · Referanser · FAQ · Mediebank · Karusell · QR-koder · Innsikt
- **Workspace**: Dashbord · Aktuelt · Oppgaver · Notater · Kunnskapsbase · Lenker · Org & Drift · Henvendelser · Intern mediebank · Brukeradministrasjon
- **Skreddersøm** (ikke tagger, én setning): "Vi kan skreddersy moduler spesifikt til deres behov — inkludert egne KI-drevne løsninger, om det er relevant for dere."

*(Rettet 2026-09-01: "Oversikt" og "Smart årshjul" sto tidligere som navngitte tagger under "Tilvalg", side om side med de andre etablerte modulene — det ga et feil inntrykk av at dette er ferdige, salgsklare produkter på linje med Booking/CRM/etc. Reelt er disse mer interne tester/eksperimenter, ikke noe som skal presenteres som konkrete kjøpbare tilvalg i en kundepitch. Erstattet med én ren tekstlinje om skreddersøm-kapasitet generelt, uten å navngi spesifikke AI-produkter.)*

**Funksjon i møtet:** et raskt, visuelt "alt dette fikk dere se" rett før avslutningen — ikke ment å leses høyt punkt for punkt.

---

## 10 — Veien til oppstart (avslutning)

**Overskrift:** Veien til oppstart.
**Ingress:** Enkelt å komme i gang — ingen binding til mer enn dere faktisk trenger.

1. **Samtale** — Vi kartlegger sammen hva som faktisk løser mest for dere akkurat nå.
2. **Oppsett** — Løsningen tilpasses og settes opp spesifikt for deres bedrift.
3. **Lansering og oppfølging** — Dere er live, med videre justering etter behov underveis.

Ingen priser på denne sliden ennå (se kapittel 12) — bevisst, ikke en forglemmelse.

---

## 11 — Tidligere utkast til "Bak Vibeverk" (arkivert, ikke i bruk)

> Vibeverk er først og fremst ikke et IT-drevet selskap. Men et selskap med fokus på forretningsutvikling og tilgjengeliggjøring av ny teknologi, særlig innen kunstig intelligens, i stedet for å skjule denne bak dyre konsulenter drevet av et inntjeningsfokus.
>
> "Gjennom flere år som systemansvarlig er det på tide å ta et oppgjør med dyre og dårlige outsourcede løsninger, derfor vil jeg skape en motvekt til dette gjennom Vibeverk." (QUOTE)

Tonet ned i kapittel 8 fordi dere var enige om å ikke ha et stort solo-fokus i presentasjonen — vekten skulle heller ligge på nærhet og kort vei til utvikling, ikke en enkeltpersons opprinnelseshistorie. Sitatet er beholdt her i tilfelle dere vil gjenbruke en mildere variant et annet sted (f.eks. i en "om oss"-tekst på selve nettsiden, hvor en tydeligere personlig stemme passer bedre enn i en kundepitch).

---

## 12 — Kom i gang / pris (UTSATT — ikke i presentasjonen)

Stått utenfor presentasjonen fordi dette er en reell samtale menneske til menneske — dere lander pris og neste steg muntlig, ikke via en CTA-knapp på en skjerm.

**Grunnpakke** — `— kr/mnd` + `— kr` i oppstart
Kontaktskjema · Referanser · FAQ · Mediebank

**Standard** — `— kr/mnd` + `— kr` i oppstart
Alt i Grunnpakke · Booking & Tilbud · CRM & Chat

**Komplett** — `— kr/mnd` + `— kr` i oppstart
Alt i Standard · Full arbeidsflate · Valgfrie tilvalg

**Personvern-fotnote (til bruk muntlig eller i oppfølging, ikke i selve presentasjonen):**
> Vi har arbeidsdokumenter klare for hver kunde — databehandlingsprotokoll, leverandørregister, forslag til databehandleravtale. Et godt utgangspunkt, men aldri i seg selv en juridisk godkjenning.

---

## Beslutninger tatt underveis (ikke gjenta uten grunn)

- Sjøfarts-/maritimt ordforråd i **teksten** er bevisst fjernet (var for påtrengende) — men den blå/kjølige fargepaletten og et dempet konturmønster i bakgrunnen er beholdt.
- Sikkerhets-/dataisolasjon-fokus ("kunde A kan ikke se kunde B sine data") er bevisst tatt ut — feil vinkling for en pitch. Kapittel 7 (Sikkerhet) er i stedet skrevet som eierskap/kontroll/driftsuavhengighet, ikke trussel/lekkasje.
- Modulene beskrives ikke enkeltvis med egen boks hver — flytende løpende tekst, moduler nevnt som stikkord.
- Ikke overforklar produktet. Fokus på kundens behov og hva som faktisk dekkes.
- **Behovskartlegging skjer live i møtet, ikke som en påstått-behov-slide.** Tidligere "Behov"-slide er omgjort til presenter-spørsmål (kapittel 4) — å presentere ferdige antatte behov motsa selve skreddersøm-løftet.
- **Eksempler flyttet tidlig**, som isbryter før behovskartleggingen — ikke som bevis for påståtte behov.
- **Pris/CTA er fortsatt tatt ut av selve presentasjonen** (kapittel 12), men beholdt i manuset. Pris/neste steg tas muntlig, menneske til menneske — ingen CTA-knapp på skjerm.
- **"Bak Vibeverk" er reformulert**: ikke et stort solo-fokus / opprinnelseshistorie, men "dere velger også hvem dere jobber videre med" — nærhet og kort vei til utvikling er poenget, ikke at det er én person.
- **Rettelse 2026-09-01: sitatet er tilbake.** Det ble feilaktig tatt helt ut i en tidligere runde — forvekslet "sitat med et ekte standpunkt" med "stort solo-fokus". Et personlig sitat styrker nærhets-poenget, det svekker det ikke. Navnet introduseres nå via naturlig attribuering under sitatet, ikke en egen "I dag: ..."-linje.
- **Ny slide 6, "Løsningen i praksis"**: tre klikkbare skjermbilder (Frontend/Backend/Workspace) fra demo-kunden, med lightbox-forstørring og en "Vis demo"-knapp til den faktiske, levende demoen (`sunnvask-demo.vercel.app`). Sunnvask er eksplisitt en oppdiktet demo-kunde, ikke en reell bedrift — aldri kall den "ekte" i tekst.
- **Ny avslutningsslide, "Veien til oppstart"**: tre nummererte steg (Samtale → Oppsett → Lansering/oppfølging), bevisst uten priser ennå.
- **Rettelse 2026-09-01, portrett-runde 2: sirkelen var feil løsning.** Det sirkulære, tett beskårne portrettet (150px) ble opplevd som "veldig dårlig" — erstattet med et betydelig større, avrundet-rektangulært portrett (720×900, ansikt+skuldre) i `.person-wrap`, fortsatt plassert til venstre med tekst til høyre. Fil: `fh-portrait-720.jpg` (`fh-circle-600.jpg` er slettet).
- **Ny slide 9, "Kort oppsummert"**: en kompakt, taggbasert oversikt over alle moduler (nettside/workspace/tilvalg) rett før "Veien til oppstart" — et samlet overblikk før avslutningen, ikke en gjentakelse av "Muligheter"-slidens flytende tekst.
- **Full temaomlegging: lyst tema er nå standard, mørkt er fallback.** Alle farger er bygget om til delte CSS-variabler (`--bg`, `--panel`, `--panel-tint`, `--line`, `--ink`, `--ink-soft`, `--accent`, `--accent-bright`, `--shadow`) med identiske navn i begge temaer — kun verdiene endres via en `.theme-dark`-klasse på `<html>`. Lyst tema henter aksentblåfargen fra den faktiske Vibeverk-logoens krom (`#2f6fe0`), hentet direkte fra `config.js` sin `logoUrl` (samme fil som selve nettsiden bruker). Mørkt tema er den forrige asurblå paletten, uendret i verdi. Temaet initieres fra besøkendes `prefers-color-scheme`, men en manuell av/på-bryter (måne-/sol-ikon øverst til høyre) lar presentatøren overstyre dette uavhengig av maskinens systeminnstilling — viktig for en presentasjon der driftssikker, forutsigbar kontroll betyr mer enn å følge en tilfeldig OS-innstilling.
- **Fant og fikset en reell (men usynlig i sluttresultatet) kode-rekkefølgefeil**: skriptet kalte temafunksjonen før canvas-bakgrunnen var initialisert, noe som kastet en JavaScript-feil og stoppet HELE resten av skriptet — inkludert slide-navigasjonen. Ble oppdaget fordi automatisert testing (ikke visuell inspeksjon alene) fanget at "neste side"-knappen ikke lenger fungerte etter temaomleggingen.
- Rekkefølge i presentasjonen nå: Hero → Om Vibeverk → Eksempler → (behovssamtale, ingen slide) → Muligheter → Løsningen i praksis → (live demo via lenke) → Sikkerhet → Bak Vibeverk → Kort oppsummert → Veien til oppstart (avslutning).
- **Vibeverk-logoen brukes nå på alle slides**, ikke bare hero — et lite (26px), dempet (55% opacity) vannmerke øverst til høyre på hvert kort, i tillegg til det faste, litt større hjørnemerket i selve navigasjonskromet.
- **Ny zoom-funksjon for desktop-presentasjon**: +/− knapper og prosenttall i toppen, samt tastatursnarveier (+/−/0) og Ctrl/Cmd+scrollhjul. Skalerer kun `.plate` (selve kortet) via CSS `transform: scale()`, ikke hele siden eller navigasjonen — nyttig når man presenterer på prosjektor og vil forstørre innholdet uten å endre nettleserens eget zoom-nivå. Begrenset til 85–160 % for å unngå at kortet blir bredere enn skjermen.
- **Lyst tema gjort mer dynamisk etter tilbakemelding om at det var "hakket fargeløst"**: lagt til en myk, flerfarget gradient-bakgrunn (varm fersken/rosa øverst, kjølig blå nederst — begge hentet fra logoens fargeskala) og gjort de animerte bakgrunnslinjene to-tonet (annenhver linje blå/korall) i lyst tema, med høyere synlighet enn før (var util­sik­tet dempet til 55 % opacity, nå 85 %). Mørkt tema er uendret — der fungerte den rene blåtonen godt fra før.
- **Modul-listene rettet til faktisk, fullstendig innhold** — både "Muligheter" og "Kort oppsummert" brukte tidligere en ufullstendig/forenklet liste. Retter seg nå etter den faktiske modul-listen i `README.md` sin mappestruktur-seksjon (lest direkte, ikke antatt). Hver tagg har fått en kort `title`-hover-forklaring (3–6 ord) — løser ønsket om at modulene "eventuelt kort forklares" uten å måtte gå tilbake til enkeltbokser per modul (som var eksplisitt uønsket fra en tidligere runde).
- **Ny arkitekturmodell på Sikkerhet-sliden**, redesignet samme dag (se kapittel 7 for full historikk): fra et tre-kolonners "dere vs. andre kunder"-sammenligningsdiagram til et vertikalt tre-nivås "Vibeverk-plattformen → deres nettside+Workspace → deres database"-diagram som faktisk viser arkitekturen, ikke et konkurranseargument.
- **Fjernet dupliseringen mellom "Muligheter" og "Kort oppsummert"**: begge viste til slutt samme fullstendige modul-liste og ble opplevd som nesten identiske. "Muligheter" er nå rendyrket fortellende tekst (ingen chips); den fullstendige listen med hover-forklaringer finnes kun i "Kort oppsummert".
- **Logo-vannmerket på hvert kort gjort tydelig større og mer synlig**: fra 26px/55% opacity (for diffust i lyst tema) til 40px/100% opacity med en svak skyggeeffekt for kontrast mot lyse kort.
- **Arkitekturmodellen på Sikkerhet-sliden er til slutt fjernet helt** (2026-09-02) og erstattet med en stor Innsikt/cookiefri-boks — se kapittel 7 for full historikk (fire redesign-runder før den ble kuttet).
- **Innsikt-boksen flyttet opp** (2026-09-02): lede-avsnittet ble flyttet inn i samme grid-kolonne som listepunktene (`.sec-text`-wrapper), slik at boksen i sidekolonnen starter i flukt med ingressen i stedet for et godt stykke lenger ned — løste en reell visuell "boksen henger for lavt"-følelse, ikke bare kosmetikk på selve boksen.
- **To ekte HTML-strukturfeil funnet og rettet i samme runde**: (1) 3 manglende `</div>`-lukketagger totalt i filen — nettlesere reparerer dette stille, men det er skjørt. (2) én duplisert `</section>`-tagg. Begge fra tidligere redigeringsrunder som ikke ble fullstendig verifisert med en ekte HTML-parser (bare visuell augnemål). Lærdom: kjør `content.count('<div') == content.count('</div>')`-sjekk etter enhver strukturell endring, ikke bare `html.parser` (som ikke validerer nøsting).
- **Bokmål/nynorsk-språkbryter lagt til** (2026-09-02): en "BM"/"NN"-pilleknapp ved siden av tema-bryteren i toppen. Teknisk løsning: hvert oversettbart element fikk et `data-i18n="nøkkel"`-attributt (eller `data-i18n-title`/`data-i18n-label`/`data-i18n-aria` for attributter). Ved oppstart cacher scriptet den eksisterende bokmål-HTML-en fra hvert element (`el.dataset.nbCache = el.innerHTML`), så bokmål-teksten trengte **ikke** skrives inn på nytt noe sted — kun nynorsk-oversettelsen er lagret i en egen JS-ordbok (113 nøkler: alle overskrifter, avsnitt, chip-etiketter, chip-tooltips, sitatet, stegene, og navigasjons-aria-labels). Verifisert med faktisk rendering av flere sider i begge retninger (bokmål→nynorsk→bokmål) før publisering.
