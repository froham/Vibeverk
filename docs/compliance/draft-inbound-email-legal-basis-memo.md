# Utkast — rettsgrunnlag for automatisk CRM-profiloppretting frå ukjend e-postavsendar

> **UTKAST — ikkje juridisk godkjenning.** Skrive 2026-07-18 (Claude, fyrste utkast per avtalt rekkjefølgje: Claude → ekstern Codex-gjennomgang → brukar sin siste kvalitetssjekk, eventuelt med advokat/kunde). Grunngjeve i verifiserte fakta frå koden (sjå kjeldetilvisingar per punkt), ikkje oppdikta. Løyser IKKJE sjølve rettsgrunnlagsspørsmålet — det kan ingen kodegjennomgang gjere. Formålet er å samle fakta, alt bygde mitigeringar, og dei attverande opne spørsmåla på éin stad, slik at ei faktisk juridisk vurdering har eit presist grunnlag å ta stilling til.

## 1. Kva funksjonen faktisk gjer (stadfesta i kode)

Når nokon sender e-post til ein kunde sin dedikerte innkomande-adresse (`supabase/functions/inbound-email/index.ts`, handsama av `process_inbound_email()`-RPC-en i `supabase/migrations/20260717120000_inbound_email.sql`):

1. **Autentisering sjekkast fyrst, fail-closed.** Svix-signaturverifisering av sjølve Resend-webhooken skjer FØR noko anna. Deretter krevst eit ekte SPF+DKIM-pass (og, etter 2026-07-18-fiksen, no også DMARC-alignment — sjå `docs/project/CHANGELOG.md` 0.51.0) for at meldinga i det heile skal handsamast vidare. Manglar desse signala, vert meldinga avvist (`status='rejected_spoofed'`/`'rejected_invalid_sig'`), ingen CRM-profil vert oppretta.
2. **Matcha mot EKSISTERANDE tråd fyrst.** Via `In-Reply-To`/`References`-headera, MEN berre om avsendaren si e-postadresse faktisk matchar den kunden den påståtte tråden tilhøyrer (hindrar at nokon forfalskar ein tråd-referanse for å injisere seg inn i ein annan sin samtale).
3. **Ingen match funne → ny profil oppretta automatisk, UTAN menneskeleg gjennomgang.** Dette er kjernen i spørsmålet: ein heilt ukjend, uverifisert avsendar sin e-postadresse, visingsnamn, og emnefelt (pluss sjølve meldingsteksten, lagra i den tilhøyrande `crm_comms`-posten) vert lagra og knytt til ein ny CRM-kundeprofil — automatisk, same augeblink e-posten kjem inn, ingen tilsett har sett på det først.

## 2. Kvifor "berre eit teknisk spørsmål" ikkje held

`autoImport()` i `module-crm.js` er alt eit eksisterande presedens for automatisk profiloppretting UTAN menneskeleg gjennomgang, frå web-leads/bookingar — så automatisk oppretting i seg sjølv er ikkje noko nytt prinsipp i produktet. **Skilnaden som gjer inbound-e-post kvalitativt annleis**: eit web-skjema/ei booking krev at personen SJØLV, aktivt, valde å oppgje informasjon til akkurat denne nettsida — dei visste dei kontakta denne konkrete verksemda. Ein e-post til ei catch-all-adresse kan komme frå kven som helst av mange grunnar personen aldri hadde tenkt gjennom at ville føre til ein lagra kundeprofil hos akkurat denne mottakaren: feilsendt post, vidaresendt frå tredjepart, spam, eller ei sak som eigentleg gjaldt noko heilt anna. Personen har ikkje nødvendigvis noko informert forventing om at Vibeverk sin kunde no lagrar ein kundeprofil om dei.

Dette er presist grunngjevinga Privacy/Compliance Advisor-gjennomgangen (2026-07-17, sjå `docs/roadmap/ROADMAP.md` linje ~140) brukte for å tilrå at "legitim interesse" (GDPR art. 6(1)(f)) truleg er det rette rettsgrunnlaget å vurdere — MEN at akkurat DEN vurderinga (er interessa til Vibeverk sin kunde reelt større enn den registrerte sin forventing om ikkje å verte registrert?) er ei juridisk avveging, ikkje eit kodespørsmål.

## 3. Mitigeringar ALT BYGDE i produktet (stadfesta i kode, ikkje planlagt)

Desse reduserer den faktiske risikoen ved automatisk oppretting, sjølv om dei ikkje løyser sjølve rettsgrunnlagsspørsmålet:

- **Synleg "Ikkje verifisert"-merking i CRM-UI-et** (`module-crm.js` linje ~820) — kvar automatisk oppretta, ikkje-stadfesta profil syner eit tydeleg oransje merke med forklarande tooltip ("Automatisk oppretta frå ein e-post me ikkje kunne matche mot ein eksisterande tråd — ikkje stadfesta av eit menneske enno"), synleg for alle tilsette som ser kundelista.
- **Eigen filtreringsfane "Uverifiserte (N)"** — tilsette kan sjå BERRE dei automatisk oppretta, ikkje-stadfesta profilane, ikkje blanda med ekte, kjende kundar.
- **Eksplisitt bulk-slett-funksjon for uverifiserte profilar** — skilt frå `merge_crm_customers()` (som er for ekte duplikatar). Ein tilsett kan raskt fjerne spam/feilsendt-post-profilar utan å måtte handtere kvar for seg.
- **Ein eksplisitt "Verifiser"-handling** (`data-verify-comm`, `module-crm.js` linje ~1235) — set profilen sin status til stadfesta via eit uttrykkeleg klikk, med eiga stadfestingstekst ("Vil du verifisere denne avsendaren? Dette fjernar «Ikkje verifisert»-merkinga."). **Merk (stadfesta av brukar 2026-07-18, sjå CHANGELOG 0.51.0)**: profilen sluttar ALSO å reknast som uverifisert dersom ein tilsett svarar på han direkte (utan å bruke denne knappen) — dette er eit MEDVITE designval («éin ekte kontakthandling er nok»), ikkje ein bug, stadfesta av brukar denne runda. Verdt å nemne for ein jurist sidan det påverkar KOR LENGE ein profil realistisk står synleg-flagga som uverifisert.
- **GDPR-sletteflyten (konsolidert 2026-07-18) friar no korrekt Storage-vedlegg og slettar `inbound_emails`-rader** når ein person sin data vert sletta — sjå Batch 3 i CHANGELOG 0.51.0.

## 4. Kva som FRAMLEIS er ope (ikkje kode, treng avgjerd)

1. **Sjølve rettsgrunnlagsspørsmålet** — er "legitim interesse" tilstrekkeleg for automatisk oppretting frå ein heilt ukjend, uverifisert avsendar? Dette er hovudspørsmålet denne memoen finst for å førebu, ikkje svare på.
2. **`inbound_emails`-retensjon** — denne tabellen (sjå skjema i `20260717120000_inbound_email.sql`) loggar metadata (avsendaradresse/-namn, emnefelt, tekniske autentiserings-/trådheadera) for **absolutt alle** e-postar som når adressa, INKLUDERT avvist/forfalska post og post frå folk som aldri vert ein kunde. Ingen sjølve meldingsteksten er lagra her (den ligg berre i `crm_comms`, for faktisk matcha/oppretta profilar) — men metadataen sjølv har truleg eit anna, kortare naturleg oppbevaringsformål (tryggingslogg) enn kunderelasjonsdata, og bør få si eiga, kortare retensjonstid. Ikkje avgjort enno.
3. **Kva mitigering(ar) er nok, gitt punkt 3 over er alt bygd** — brukar sitt eige forslag (økt 2026-07-18) var anten (a) kategorisere som uverifisert (ALT bygd, sjå over), eller (b) sende ein automatisk e-post attende til avsendaren som informerer dei om at ein profil vart oppretta. **(b) er IKKJE bygd** — om dette vert vurdert som naudsynt i tillegg til (a), er det eit konkret, avgrensa utviklingsstykke (ein ny e-post-mal + eit utsendingssteg i `process_inbound_email()`-flyten), ikkje eit stort løft.

## 5. Konkret spørsmål til juridisk rådgjevar

> Gitt at [Vibeverk sin kunde] automatisk oppretter ein kontaktprofil (namn, e-postadresse, emnefelt, meldingstekst) frå ein e-post sendt til verksemda si eiga kontaktadresse, frå ein avsendar verksemda ikkje har hatt kontakt med tidlegare, og UTAN at nokon tilsett har sett på/godkjent opprettinga først:
> 1. Er "legitim interesse" (GDPR art. 6(1)(f)) eit forsvarleg rettsgrunnlag for dette, gitt at profilen tydeleg vert merka "ikkje verifisert" i det interne systemet og kan slettast i bulk?
> 2. Om ikkje åleine — er det tilstrekkeleg i kombinasjon med eit automatisk svar til avsendaren som informerer dei om at ein profil vart oppretta (jf. punkt 4.3b over, ikkje bygd enno)?
> 3. Kva retensjonstid er forsvarleg for `inbound_emails` sine metadata-rader for avvist/aldri-matcha post (jf. punkt 4.2)?

## 6. Status og neste steg

**Ikkje ei blokkering for vidare bygging/prototyping no** — Vibeverk er ikkje eit registrert føretak enno, og ingen ekte, betalande `crmFull`-kunde eksisterer (stadfesta av brukar 2026-07-17). Dette MÅ derimot avklarast med kvalifisert juridisk rådgjeving før ein reell kunde med denne funksjonen aktivert går live i produksjon — det er nettopp difor dette utkastet finst no, i førekant, ikkje som brannsløkking seinare.

**Neste steg per avtalt rekkjefølgje**: dette utkastet går no til ein ekstern Codex-gjennomgang (uavhengig andre augepar), deretter brukar sin eigen siste kvalitetssjekk — eventuelt med advokat og/eller kunde involvert, dersom det vert vurdert naudsynt på det tidspunktet.
