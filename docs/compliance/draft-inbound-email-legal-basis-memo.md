# Utkast — rettsgrunnlag for automatisk CRM-profiloppretting frå ukjend e-postavsendar

> **UTKAST — ikkje juridisk godkjenning.** Skrive 2026-07-18 (Claude, fyrste utkast), fakta-korrigert 2026-07-19 etter ein ekstern Codex-gjennomgang som fann fleire stader der fyrsteutkastet overvurderte kva sletteflyten faktisk garanterer og undervurderte kva data Resend/leads-tabellen faktisk lagrar — alle retta under, kvart mot direkte kode-verifikasjon, ikkje berre teke Codex sitt ord for det. Per avtalt rekkjefølgje: Claude → ekstern Codex-gjennomgang (ferdig) → brukar sin siste kvalitetssjekk, eventuelt med advokat/kunde. Løyser IKKJE sjølve rettsgrunnlagsspørsmålet — det kan ingen kodegjennomgang gjere.

## 1. Kva funksjonen faktisk gjer (stadfesta i kode)

Når nokon sender e-post til ein kunde sin dedikerte innkomande-adresse (`supabase/functions/inbound-email/index.ts`, handsama av `process_inbound_email()`-RPC-en i `supabase/migrations/20260717120000_inbound_email.sql`):

1. **Autentisering sjekkast fyrst, fail-closed.** Svix-signaturverifisering av sjølve Resend-webhooken skjer FØR noko anna — ein ugyldig/manglande signatur returnerer 401 med det same (`inbound-email/index.ts` linje ~98), **FØR noka `inbound_emails`-rad i det heile vert skriven**. Statusverdien `rejected_invalid_sig` finst i databaseskjemaet sin CHECK-constraint, men vert i praksis ALDRI skriven av noverande kode — retta frå fyrsteutkastet, som feilaktig hevda han vart brukt (Codex-funn). Deretter krevst eit ekte SPF+DKIM(+DMARC, etter 2026-07-18-fiksen)-pass for at meldinga i det heile skal handsamast vidare; manglar desse, vert meldinga avvist med `status='rejected_spoofed'` (denne statusen VERT skriven).
2. **Matcha mot EKSISTERANDE tråd fyrst.** Via `In-Reply-To`/`References`-headera, MEN berre om avsendaren si e-postadresse faktisk matchar den kunden den påståtte tråden tilhøyrer (hindrar at nokon forfalskar ein tråd-referanse for å injisere seg inn i ein annan sin samtale).
3. **Ingen trådmatch → finn-eller-opprett kunde, deretter alltid ny lead+comm.** Retta frå fyrsteutkastet (Codex-funn): dette er IKKJE "ny profil kvar gong". `find_or_create_crm_customer_by_email()` (`20260717120000_inbound_email.sql` linje ~99) slår fyrst opp om avsendaren sin e-post matchar ein EKSISTERANDE kunde sin primær- ELLER alt-e-post — finn han det, vert den eksisterande kunden gjenbrukt (ny `crm_comms`-rad lagt til på han), ikkje ein ny profil. Berre om absolutt ingen match finst (verken tråd- eller e-postmatch) vert ein HEILT ny kunde oppretta. I begge tilfelle (gjenbrukt ELLER ny) vert ei ny Kontakt-lead OG ein `crm_comms`-rad oppretta, merkt `autoCreated=true`, utan at nokon tilsett har sett på det først.

## 2. Kvifor "berre eit teknisk spørsmål" ikkje held

`autoImport()` i `module-crm.js` er alt eit eksisterande presedens for automatisk profiloppretting UTAN menneskeleg gjennomgang, frå web-leads/bookingar — så automatisk oppretting i seg sjølv er ikkje noko nytt prinsipp i produktet. **Skilnaden som gjer inbound-e-post kvalitativt annleis**: eit web-skjema/ei booking krev at personen SJØLV, aktivt, valde å oppgje informasjon til akkurat denne nettsida — dei visste dei kontakta denne konkrete verksemda. Ein e-post til ei catch-all-adresse kan komme frå kven som helst av mange grunnar personen aldri hadde tenkt gjennom at ville føre til ein lagra kundeprofil hos akkurat denne mottakaren: feilsendt post, vidaresendt frå tredjepart, spam, eller ei sak som eigentleg gjaldt noko heilt anna. Personen har ikkje nødvendigvis noko informert forventing om at Vibeverk sin kunde no lagrar ein kundeprofil om dei.

Dette er presist grunngjevinga Privacy/Compliance Advisor-gjennomgangen (2026-07-17, sjå `docs/roadmap/ROADMAP.md` linje ~140) brukte for å tilrå at "legitim interesse" (GDPR art. 6(1)(f)) truleg er det rette rettsgrunnlaget å vurdere — MEN at akkurat DEN vurderinga (er interessa til Vibeverk sin kunde reelt større enn den registrerte sin forventing om ikkje å verte registrert?) er ei juridisk avveging, ikkje eit kodespørsmål.

## 3. Det fullstendige datakartet (utvida 2026-07-19 etter Codex-funn — fyrsteutkastet var ufullstendig)

Ein einaste innkomande e-post kan hamne i FLEIRE lagringsstader samstundes, kvar med eigne eigenskapar:

| Stad | Kva vert lagra | Avgrensing | Retensjon i dag |
|---|---|---|---|
| **Resend (USA)** | Full e-posttekst + HTML, fullstendige rå headera, mottakar-/CC-adresser, **eventuelle vedlegg** — Resend sin eigen DPA omtalar eksplisitt mottak og lagring av meldingsinnhald og vedlegg | Ingen frå Vibeverk si side — dette er Resend sin EIGEN, separate kopi, uavhengig av kva Vibeverk-koden hentar vidare | Ukjend/ikkje kontrollert av Vibeverk — Resend sin eigen retensjonspolicy gjeld, IKKJE noko i denne kodebasen |
| `inbound_emails` | Avsendaradresse/-namn, mottakaradresse, emnefelt, melding-ID/tråd-headera, SPF/DKIM/DMARC-resultat | **Ikkje** sjølve meldingsteksten | Ingen automatisk sletting — gjeld ALLE e-postar som når adressa, inkl. avvist/forfalska post |
| `leads.message` | **Full, IKKJE-avkorta råtekst** av heile e-posten (`process_inbound_email()`, `20260717120000_inbound_email.sql` linje ~238) — retta frå fyrsteutkastet, som feilaktig hevda all tekst var avkorta til 5000 teikn. Denne avkortinga gjeld BERRE `crm_comms`, ikkje `leads` | Ingen avkorting | Del av vanleg lead-livssyklus, ryddast via vanleg lead-sletting |
| `crm_comms.data.body`/`.html` | E-postteksten, avkorta til 5000 teikn kvar (`left(..., 5000)`) | 5000-teikn-avkorting | Del av CRM-kunden sin historikk |
| `crm_comms.title`/`.data.subject` | Emnefeltet, lagra FLEIRE stader (både som eigen kolonne og inni `data`-jsonb-en) | Ingen | Del av CRM-historikk |

**Personopplysningar om TREDJEPERSONAR** kan finnast i sjølve meldingsteksten (t.d. ein e-post som omtalar eller er sendt på vegner av nokon andre enn avsendaren), inkludert potensielt særlege kategoriar (helse, osv.) eller opplysningar om lovbrot — verken `inbound_emails`, `leads` eller `crm_comms` skil dette ut eller handterer det annleis enn vanleg fritekst.

## 4. Mitigeringar ALT BYGDE i produktet (stadfesta i kode, ikkje planlagt) — men presisert 2026-07-19

Desse reduserer den faktiske risikoen ved automatisk oppretting, sjølv om dei ikkje løyser sjølve rettsgrunnlagsspørsmålet:

- **Synleg "Ikkje verifisert"-merking i CRM-UI-et** (`module-crm.js` linje ~1471) — kvar automatisk oppretta `crm_comms`-post syner eit tydeleg oransje merke med forklarande tooltip, klikkbart for eksplisitt å verifisere (`data-verify-comm` → `updateComm(id,{autoCreated:false})`).
- **Eigen filtreringsfane "Uverifiserte (N)"** på KUNDE-nivå (`isUnverifiedCustomer()`, `module-crm.js` linje ~340) — men **presisert 2026-07-19 (Codex-funn, viktig nyanse)**: dette er TRE ulike ting, ikkje éin status:
  1. **Kunde-lista sitt filter** krev at ALLE kommunikasjonar for kunden har `autoCreated===true` OG at telefon/merknad er tomme. Legg ein tilsett til EIN einaste vanleg hending (utgåande e-post, dokument, oppgåve, internt notat, telefonnotat) — kunden forsvinn frå "Uverifiserte"-lista, sjølv om identiteten ALDRI vart eksplisitt stadfesta.
  2. **Den einskilde e-postposten sitt eige merke** (punktet over) vert IKKJE påverka av dette — det held fram å vise "Ikkje verifisert" heilt til nokon eksplisitt klikkar "Verifiser" på AKKURAT den posten.
  3. **Ekte identitetsverifisering** (t.d. stadfesta telefonnummer, signatur, eller anna faktisk kontroll av kven avsendaren er) — systemet utfører IKKJE dette i det heile, verken automatisk eller ved det eksplisitte "Verifiser"-klikket. "Verifisert" i UI-et tyder "eit menneske har sett på/interagert med denne", ikkje "identiteten er stadfesta".
  - Ein jurist bør få denne tredelinga presist, sidan "kunden er ikkje lenger i Uverifiserte-lista" er eit MYKJE svakare faktum enn "identiteten er verifisert".
- **Eksplisitt bulk-slett-funksjon for uverifiserte profilar** (kunde-nivå) — skilt frå `merge_crm_customers()` (ekte duplikatar). Fjernar spam/feilsendt-post-profilar raskt.
- **Den konsoliderte app-side-sletteflyten** (`CrmAdmin.deleteEverythingForEmail()`, bygd 2026-07-18) — **presisert 2026-07-19, fyrsteutkastet kalla dette feilaktig "komplett" (Codex-funn, HIGH)**: matching på primær+alt-e-post og feilsjekking er stadfesta korrekt implementert for KUNDE-raden og `inbound_emails`-slettinga. MEN sletting av leads, bookingar, CRM-kommunikasjonar, chat-samtalar og Storage-vedlegg er FRAMLEIS reint fire-and-forget (ingen feil frå desse operasjonane inngår i resultatet brukargrensesnittet viser). **Konkret konsekvens**: UI-et kan vise "✓ Sletta alle data" sjølv om t.d. ei Storage-fil eller ein lead faktisk ikkje vart sletta — kunden trur førespurnaden er fullført, men opplysningar kan stå att. Denne breiare feilsjekkinga er identifisert som eige oppfølgingsarbeid ("Batch 5"), ikkje gjort enno. **Denne flyten rører heller ikkje Resend sin eigen, separat lagra kopi av den mottatte e-posten i det heile** (sjå tabellen i del 3) — ei sletting hos Vibeverk sin kunde slettar ikkje automatisk noko hos Resend.

## 5. Kva som FRAMLEIS er ope (ikkje kode, treng avgjerd)

1. **Sjølve rettsgrunnlagsspørsmålet** — er "legitim interesse" tilstrekkeleg for automatisk oppretting frå ein heilt ukjend, uverifisert avsendar? Sjå del 6 for det utvida spørsmålssettet.
2. **`inbound_emails`-retensjon** — loggar metadata for ALLE e-postar som når adressa, inkl. avvist/forfalska post og post frå folk som aldri vert ein kunde. Truleg eit anna, kortare naturleg oppbevaringsformål (tryggingslogg) enn kunderelasjonsdata. Ikkje avgjort.
3. **Retensjon hos Resend sjølv** — heilt separat spørsmål frå punkt 2, ikkje tidlegare vurdert i det heile (Codex-funn). Kva slettar/anonymiserer Resend, og etter kor lang tid?
4. **Faktisk overføringsgrunnlag for Resend må stadfestast, ikkje berre antakast** — Resend sin eigen DPA omtalar BÅDE SCC og EU–US Data Privacy Framework som moglege grunnlag. `draft-privacy-policy-thirdparty-section.md` har til no berre nemnt SCC — kva som faktisk gjeld må sjekkast mot den konkrete avtalen, ikkje antakast (Codex-funn).
5. **Kva mitigering(ar) er nok** — brukar sitt eige forslag (økt 2026-07-18) var anten (a) kategorisere som uverifisert (ALT bygd, sjå del 4), eller (b) sende ein automatisk e-post attende til avsendaren som informerer dei om at ein profil vart oppretta. **(b) er IKKJE bygd.**
6. **Er automatisk profiloppretting i det heile NAUDSYNT**, eller finst mindre inngripande alternativ (kortvarig kø, menneskeleg godkjenning før lagring, eller lagring av færre felt enn i dag)? Ikkje vurdert i tidlegare rundar (Codex-funn) — nødvendigheit/proporsjonalitet er eit eige, obligatorisk steg i ei interesseavveging etter art. 6(1)(f), ikkje noko "legitim interesse finst" åleine dekkjer.
7. **Formell DPIA eller dokumentert DPIA-screening?** Alt identifisert som tilrådd i ROADMAP.md (2026-07-17), men aldri følgt opp med eit konkret svar.

## 6. Spørsmål til juridisk rådgjevar (utvida 2026-07-19 — fyrsteutkastet var for smalt, Codex-funn HIGH)

> Gitt at [Vibeverk sin kunde] automatisk oppretter/gjenbrukar ein kontaktprofil (namn, e-postadresse, emnefelt, full meldingstekst) frå ein e-post sendt til verksemda si eiga kontaktadresse, frå ein avsendar verksemda ikkje nødvendigvis har hatt kontakt med tidlegare, og UTAN at nokon tilsett har sett på/godkjent opprettinga først:

1. **Rettsgrunnlag og formål**: Gjeld same rettsgrunnlag for MOTTAK hos Resend, tryggingslogginga i `inbound_emails`, den automatiske lead-/profiloppretting, og den vidare CRM-oppfølginga — eller krev dei kvar for seg eiga vurdering?
2. **Nødvendigheit og proporsjonalitet**: Er automatisk profiloppretting naudsynt for føremålet, eller kan det oppnåast med eit mindre inngripande alternativ (kortvarig kø, menneskeleg godkjenning, færre lagra felt)?
3. **Er "legitim interesse" (art. 6(1)(f)) forsvarleg** for dette, gitt dei bygde mitigeringane (sjå del 4) — og kva om dei IKKJE er nok åleine?
4. **Informasjonsplikt**: Kva informasjon må gjevast, til kven (direkte avsendar OG eventuelle tredjepersonar omtala i meldinga), og NÅR — før eller etter lagring?
5. **Protest/avgrensing/retting/sletting** under eit 6(1)(f)-grunnlag — korleis skal dette handterast i praksis, gitt at sletteflyten i dag har kjende avgrensingar (del 4)?
6. **Særlege kategoriar/tredjepersonar i fritekst** — kva skal skje om ein e-post inneheld helseopplysningar, opplysningar om barn, eller om andre enn avsendaren?
7. **DPIA** — er ei formell DPIA naudsynt, eller er ei dokumentert DPIA-screening tilstrekkeleg?
8. **Retensjon** — kva er forsvarleg for `inbound_emails` (avvist/aldri-matcha post), OG separat, kva krevst/er mogleg å avtale med Resend for deira eiga lagra kopi?
9. **Overføringsgrunnlag** — stadfest det faktisk avtalte grunnlaget med Resend (SCC eller DPF), ikkje anta ut frå kva som er generelt tilgjengeleg.

## 7. Status og neste steg

**Ikkje ei blokkering for vidare bygging/prototyping no** — Vibeverk er ikkje eit registrert føretak enno, og ingen ekte, betalande `crmFull`-kunde eksisterer (stadfesta av brukar 2026-07-17). Dette MÅ derimot avklarast med kvalifisert juridisk rådgjeving før ein reell kunde med denne funksjonen aktivert går live i produksjon.

**Neste steg**: dette reviderte utkastet går attende til brukar sin eigen siste kvalitetssjekk — eventuelt med advokat og/eller kunde involvert.
