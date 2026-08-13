# Personvern — full argumentasjon og kapittel-for-kapittel-eksport

## FRÅSKRIVING — LES FØRST

**Dette dokumentet er eit sourced, kodegrunna UTKAST til vidare juridisk kvalitetssikring. Det er IKKJE ei juridisk vurdering, IKKJE ei erklæring om GDPR-compliance, og IKKJE eit substitutt for gjennomgang av kvalifisert juridisk rådgivar.** Alt innhald må stadfestast mot faktisk kundeinformasjon før bruk. Ingen vurdering i dette dokumentet — verken statusmerking, lovheimel-tilvising eller tilrådd tiltak — er automatisk godkjent for produksjonsbruk berre fordi ein AI-agent har skrive det.

**Status:** oppdatert 2026-08-13 etter at P0-tekstfiksane (sjå DEL 3) vart bygd, testa og deployt til produksjon (v0.146.0). Dokumentet held berre det som faktisk framleis er ope — lukka punkt er fjerna, ikkje merka som lukka, for å halde det lettlese. Bygd ved å lese faktisk kode på `main` (`console/console-core.js`, `core.js`, migrasjonar i `supabase-control/supabase/migrations/`), supplert med direkte, live verifisering av leverandørane sine eigne DPA-vilkår (`vercel.com/legal/dpa`, `supabase.com/legal/dpa`, `resend.com/legal/dpa`, `plausible.io/dpa`, alle henta 2026-08-13) og ein ekstern (GPT) gjennomgang.

---

# DEL 0 — Rein tekst, komplett (for rask gjennomlesing)

Dette er heile forslagsteksten sett saman som éin samanhengande personvernerklæring — akkurat slik ein kunde med alle moduler aktive (booking, tilbud, chat, Plausible, Vercel på Hobby-plan) faktisk ser ho i dag. Ingen argumentasjon, ingen lovheimel-tilvisingar her — berre teksten, ordrett slik `computeTenantPrivacyBlocks()` genererer ho. Full grunngjeving per avsnitt (og dei to andre cookie-variantane) står i DEL 2. Klammer `[...]` er stader teksten framleis er reelt ope — dei skal ALDRI fyllast med gjettverk.

---

**Om denne personvernerklæringen**
Denne personvernerklæringen forteller deg hvilke personopplysninger vi samler inn, hva vi bruker dem til, hvor lenge vi lagrer dem, og hvilke rettigheter du har. Den gjelder for alle som besøker nettsiden, tar kontakt med oss via skjemaene her, eller er ansatt og bruker våre interne arbeidsverktøy (Workspace).

**Hvem er behandlingsansvarlig?**
[Firmanavn] (org.nr [X]) er behandlingsansvarlig for personopplysningene som er beskrevet i denne personvernerklæringen. Det betyr at det er [Firmanavn] — ikke leverandøren av selve nettsideplattformen — som bestemmer hva opplysningene brukes til og hvordan de behandles. Har du spørsmål om personvern, kan du kontakte oss på [e-post, telefon, adresse].

**Hvor lagres opplysningene?**
Nettsiden driftes hos Vercel. Innsendte opplysninger lagres i en database hos Supabase, med servere i Irland (EU).

**Dine rettigheter**
Du har rett til innsyn i hvilke opplysninger vi har lagret om deg, og rett til å få disse korrigert, slettet eller begrenset, i tråd med personopplysningsloven/GDPR. Du kan også protestere mot behandlingen, og be om å få opplysningene utlevert i et strukturert format (dataportabilitet) der det er relevant. For å be om innsyn, retting, sletting eller andre rettigheter, ta kontakt via kontaktinformasjonen på denne siden og merk henvendelsen «Personvern» — vi behandler slike forespørsler uten ugrunnet opphold og normalt innen én måned. Opplysninger slettes eller begrenses når vilkårene for dette etter personvernregelverket er oppfylt. Du har også rett til å klage til Datatilsynet dersom du mener vi behandler personopplysningene dine i strid med regelverket. Du finner informasjon om hvordan du klager på datatilsynet.no.

**Personopplysninger om ansatte (Workspace)**
Ansatte som bruker vårt interne arbeidsverktøy (Workspace) får en brukerkonto med navn, e-postadresse og rolle. Opplysningene behandles for å administrere arbeidsforholdet og gi nødvendig tilgang til de interne verktøyene, med grunnlag i arbeidsforholdet og vår berettigede interesse i å drifte virksomheten[. **Åpent:** ein jurist bør vurdere KVAR einskild behandling og fastsetje EITT konkret grunnlag per aktivitet i staden for dei to stabla saman, sjå DEL 3]. Kontoen og tilhørende opplysninger fjernes normalt når arbeidsforholdet opphører.

**Brukerstøtte**
Ved behov for direkte brukerstøtte kan vår leverandør av nettsideplattformen generere en tidsavgrenset innloggingslenke for å bistå en administrator i Workspace, uten å få kjennskap til passordet. Dette skjer kun etter avtale, lenken utløper raskt, og hver forespørsel logges.

**Kontaktskjema**
Når du sender oss en henvendelse, lagrer vi opplysningene du selv oppgir — typisk navn, e-postadresse, telefonnummer og innholdet i meldingen. Opplysningene brukes utelukkende til å besvare henvendelsen din, med grunnlag i vår berettigede interesse i å kunne besvare henvendelser rettet til oss, og deles ikke med tredjeparter for markedsføringsformål.

**Tilbudsforespørsel**
Når du ber om tilbud, lagrer vi navn, e-postadresse, telefonnummer, innholdet i forespørselen og eventuelle vedlegg du laster opp, med grunnlag i at behandlingen er nødvendig for å oppfylle en avtale du selv har bedt om, eller for å gjennomføre tiltak på din anmodning før en slik avtale inngås. Opplysningene brukes til å utarbeide og sende deg et tilbud. Vedlegg lagres i en egen, tilgangsbegrenset fillagringstjeneste og slettes sammen med resten av henvendelsen.

**Booking**
Når du reserverer en time/booking, lagrer vi navn, e-postadresse, telefonnummer, valgt tidspunkt og en eventuell melding, med grunnlag i at behandlingen er nødvendig for å gjennomføre avtalen. Opplysningene brukes til å gjennomføre avtalen.

**Hvor lenge lagrer vi opplysningene?**
Vi lagrer opplysningene dine så lenge det er nødvendig for formålet de ble samlet inn for, og sletter dem deretter uten ugrunnet opphold, med mindre vi har en lovpålagt plikt til å lagre dem lenger. *(Dette er fallback-varianten som framleis vises for 100 % av kundane, sjå DEL 2 blokk 8 og DEL 3 — konkrete forslag finst no som plasshaldar i Console, men ingen kunde har fylt inn eit konkret tal enno.)*

**Chat**
Når du bruker chat-funksjonen på nettsiden, lagrer vi det du skriver, samt navn og e-postadresse dersom du oppgir dette, med grunnlag i vår berettigede interesse i å kunne besvare henvendelser sendt via chat. Vi lagrer også tekniske opplysninger som hvilken side du chattet fra, hvor du kom fra, og grunnleggende informasjon om nettleseren din. Opplysningene brukes til å besvare henvendelsen din.

**Bruker vi cookies?**
Ja, vi bruker Plausible Analytics for trafikkstatistikk — et personvernvennlig analyseverktøy som ikke bruker informasjonskapsler eller vedvarende identifikatorer, og som ikke lagrer besøkendes IP-adresser.

**Hvilke leverandører behandler opplysningene dine?**
Supabase — Database, autentisering og fillagring — all persondata plattformen lagrer. Data er plassert i EU.
Vercel — Hosting og tenant-ruting. Leverandøren er etablert i USA.
Resend — Utsending og mottak av e-post. Leverandøren er etablert i USA.
Plausible Analytics — Cookiefri trafikkstatistikk. Leverandøren er etablert i EU/EØS.

**Overføring av opplysninger utenfor EU/EØS**
Noen av leverandørene våre er etablert utenfor EU/EØS. Vi sørger for at slike overføringer skjer i tråd med personvernregelverket:
Resend: overføringen er dekket av Resends databehandleravtale, som gjelder automatisk ved bruk av tjenesten.
Vercel: vi arbeider med å sikre at overføringen skjer i tråd med personvernregelverket. *(Ærleg, ikkje-alarmerande formulering — sjå DEL 3 for kvifor Vercel ikkje kan få same setning som Resend enno.)*

**Melding ved brudd på personopplysningssikkerheten**
Dersom det skulle oppstå et brudd på personopplysningssikkerheten — for eksempel uautorisert tilgang til eller tap av opplysninger — som medfører risiko for dine rettigheter og friheter, vil vi varsle Datatilsynet uten unødig opphold og senest innen 72 timer etter at vi ble kjent med bruddet, i tråd med personvernforordningen (GDPR) artikkel 33. Dersom bruddet innebærer høy risiko for deg, vil vi også varsle deg direkte.

---

**Dei to andre cookie/analyse-variantane** (vises i staden for Plausible-avsnittet over, avhengig av kva kunden faktisk har aktivt):

*Intern sidetelling aktiv (kun om Plausible ikkje er aktiv) — status: open juridisk vurdering, sjå DEL 2 blokk 10:*
> Den interne sidetellingen bruker ingen cookies og verken leser fra eller skriver til nettleserlagring for analysegruppering. [...] På serveren lager vi en kode av datoen, nettstedsadressen, IP-adressen og informasjon nettleseren automatisk sender. [...] Av IP-adressen, nettstedsadressen og den detaljerte nettleserinformasjonen lagres bare dagskoden, ikke de rå verdiene, og koden endres automatisk hver dag.

*Ingen analyse:*
> Nei. Denne siden bruker ingen cookies eller analyseverktøy som samler inn personopplysninger.

---

# DEL 1 — Full argumentasjon for heile compliance-arbeidet

## 1. Den kundevendte personvernerklæringa

`computeTenantPrivacyBlocks(sc, an)` i `console/console-core.js` genererer eit **modul-delt** dokument — 12 sjølvstendige blokker (intro/controller/baseline/employees/kontakt/tilbud/booking/retention/chat/analytics/suppliers/breach), kvar med ein `moduleId` som styrer om blokka er "alltid aktiv" eller `features.*`-styrt (`privacyModuleActive()`). Ein operatør kan redigere kvar blokk for seg (`edited: true` fryser ho mot framtidige "Standardforslag"-regenereringar via `mergePrivacyBlocks()`), publisere ein versjonert snapshot (`versions[]`/`activeVersionId`, lagra i den **private** `superconfig-private`-nøkkelen, ikkje den anon-lesbare `superconfig`), registrere ei intern "godkjenning" (kanal/notat/dato, aldri ei sperre for publisering) og eksportere heile dokumentet som sjølvstendig HTML (`privacyExportPublishedHtml()`). Eit driftvarslingssystem (`privacyPublishedDrift()`) flaggar når ein publisert versjon sitt uendra (`edited:false`) innhald har "drive" bort frå det generatoren no ville produsert — reint informativt, aldri ei sperre.

Leverandørblokka (`computeSupplierBlock()`) les frå `sc._vendorRegistry` (cacha frå kontrollplanets `vendor_registry`-tabell), med den hardkoda `VIBEVERK_VENDORS`-konstanten som synkron bootstrap-fallback for aller fyrste rendering.

**Ope:**
- Per-skjema `legalBasis`/`retention`/`recipients`/`blurbHtml`-felta i `sc.privacy.forms{}` er framleis tomme for alle kundar (Skjematekster-fana viser no konkrete forslag som plasshaldar, men ingen operatør har godkjent/lagra noko enno) — retensjonsblokka fell difor framleis tilbake til éi generisk setning i praksis.
- `Anthropic` (AI-modular i Workspace) er medvite utelaten frå `VIBEVERK_VENDORS`/kundevendt leverandørtekst ("framleis trial-fase, ikkje tilbydd nokon reell kunde enno") — men er ført opp internt i `COMPLIANCE_STANDARD_SUGGESTIONS.ai.mottakere`. Om/når AI-modular vert tilbydd ein reell kunde, må leverandørblokka utvidast FØR lansering.
- Ingen stad i Workspace lenkjer i dag til det publiserte personvernvedtaket for tilsett-blokka — teksten finst, men ein tilsett oppdagar ho ikkje utan at nokon fysisk deler lenkja.
- `sidetelling`-cookievarianten sin ekomlov §3-15-status er framleis ikkje avklart (sjå punkt 6).

## 2. Behandlingsprotokoll (Art. 30-register, `compliance_record`)

Global (ikkje tenant-skopa) tabell `compliance_record` i `vibeverk-control`, éi rad per **Vibeverk sin eigen** behandlingsaktivitet — 8 rader: `kontakt`, `tilbud`, `booking`, `chat`, `crm`, `ansatte`, `sidetelling`, `ai`. Sju felt per rad (formål/kategori registrerte/kategori data/behandlingsgrunnlag/mottakarar/lagringstid/sikkerheitstiltak), rein direkte redigering — ingen versjonering, ingen godkjenning-ceremoni, ulikt det kundevendte dokumentet. `reviewed_at`/`reviewed_by`-stempel er ei eiga, medviten "Merk som vurdert"-handling, aldri implisitt sett av eit Lagre-klikk. Standardforslag er lagt inn i produksjonstabellen for alle 8 aktivitetar, ikkje berre koda som eit ubrukt forslag.

**Kvifor «kun Vibeverk», ikkje per kunde:** eksplisitt, stadfesta brukarvedtak — behandlingsprotokollen er KUN for Vibeverk AS sjølv, aldri ein per-kunde-funksjon. GDPR art. 30 pålegg BÅDE den behandlingsansvarlege OG databehandlaren å føre eit register. Vibeverk opptrer som databehandlar for dei fleste av desse 8 aktivitetane sett frå EIN KUNDE sitt perspektiv, men registeret er bygd for Vibeverk sitt EIGE forhold til sine EIGNE kontaktar/tilsette/AI-bruk — ikkje eit register over Vibeverk sine plikter som databehandlar for kvar kunde sine data. Det spørsmålet er i staden dokumentert INDIREKTE, via kundeavtale-malen og leverandørregisteret (sjå DEL 3, P1).

**Ope:**
- Ingen automatisert kryssjekk mellom `compliance_record` og den kundevendte teksten — to sjølvstendige tekstkjelder som kan drive frå kvarandre utan varsel.
- `sidetelling`-rada sitt `behandlingsgrunnlag`-felt seier eksplisitt "endelig vurdering under arbeid" — eit ærleg, ikkje ferdig standpunkt.
- `ai`-rada dokumenterer Anthropic internt med status "ikkje avklart" — om AI-modular vert reelt kundetilbydd, må BÅDE dette registeret OG leverandørblokka oppdaterast saman.

## 3. Leverandør-/DPA-register (`vendor_registry`, `VIBEVERK_VENDORS`)

`vendor_registry`-tabellen inneheld dei fire leverandørane (Supabase/Vercel/Resend/Plausible), redigerbar via Console → Compliance → Leverandørar, med `VIBEVERK_VENDORS` som bootstrap-fallback. Kvar rad har `dpaStatus` (`confirmed`/`likely_confirmed`/`unconfirmed`/`tba`/`blocked`).

**Stadfesta direkte 2026-08-13**, ved å hente kvar leverandør sin eigen, publiserte DPA-side live:

| Leverandør | Kjelde | Funn |
|---|---|---|
| **Supabase** | `supabase.com/legal/dpa` | *"The Parties agree that acceptance of the Agreement shall have the same effect as signing the SCCs."* DPA-en trer i kraft automatisk ved aksept av Vilkåra for tenesta — inga eiga signering, inga plan-avgrensing funnen. |
| **Resend** | `resend.com/legal/dpa` | *"...by accepting Resend's Terms of Service, customers automatically enter into this DPA — no separate signing event is required."* |
| **Plausible** | `plausible.io/dpa` | *"Use of the service constitutes acceptance of this DPA. No separate signature is required."* Gjeld alle kundar, uavhengig av plan. |
| **Vercel** | `vercel.com/legal/dpa` | *"This Addendum applies to Vercel's Processing of Personal Data as a Processor under the Agreement for Customers who are on **Enterprise and Pro plans**."* Vibeverk sin konto er stadfesta Hobby (`data-map-vibeverk.md`, 2026-07-16, via faktisk `VERCEL_OIDC_TOKEN`-JWT). |

Vibeverk har difor sannsynlegvis alt ein gjeldande databehandleravtale med Supabase, Resend og Plausible gjennom vanleg bruk av tenestene — heilt uavhengig av om Vibeverk AS er formelt stifta (å akseptere eit tenestevilkår krev ikkje eit stifta aksjeselskap). **Vercel er eit reelt, stadfesta gap** — ikkje fordi selskapet ikkje er stifta, men fordi kontoen som faktisk er i bruk ikkje har tilgang til DPA-en i det heile på noverande plan. Kundevendt tekst skal aldri ha høgare epistemisk sikkerheit enn den interne, stadfesta statusen (regel: `kundeviss <= intern stadfesta viss`, alltid) — `computeSupplierBlock()` gatar difor no den kundevendte overføringsteksten på `dpaStatus`, ikkje berre `transferMechanism`.

**Ope:**
- Vercel-kontoen må anten oppgraderast til Pro/Enterprise, eller forholdet elles avklarast (sjå DEL 3).
- Resend sin konkrete overføringsmekanisme (SCC vs. DPF) er ikkje sjølvstendig verifisert utover at ein DPA finst.
- `dpa_document_path`-kolonna i `vendor_registry` er framleis uwired — sjølve DPA-dokumentet (ikkje berre statusen) bør lastast opp og lenkjast når det er henta ned frå leverandørane sine portalar.
- Datamodellen (éin blanda `dpa_status` i staden for separate `dpa_status`/`transfer_status`-felt + "sist kontrollert"-dato) bør byggjast om, sjå DEL 3.
- Same overføringsformulering står i `COMPLIANCE_DOCUMENT_STANDARD_SUGGESTIONS.kundeavtale` sitt punkt 8 — MALEN kunden faktisk skal signere.

## 4. DPA-signeringssporing per kunde (manuell Word→PDF utanfor systemet)

`tenants`-tabellen (kontrollplanet) har tre kolonner (`dpa_sent_at`/`dpa_signed_at`/`dpa_document_path`). Fire `tenant-admin`-handlingar: `mark_tenant_dpa_sent` (stempel dato), `upload_tenant_dpa_signed` (base64, `%PDF-`-magic-byte-sjekk, storleikstak FØR dekoding, TOCTOU-verna), `get_tenant_dpa_document_url` (300-sekunders signert URL, aldri direkte offentleg lenke), `clear_tenant_dpa_signed` (reversibel angring). Vises som eit kort i Console → Kundar → kundedetalj. Malen operatøren eksporterer og sender manuelt finst som eit av tre frie dokument i Compliance-fana.

Sjølve signeringa skjer heilt utanfor systemet (Word→PDF, manuelt sendt/signert/returnert) — eksplisitt brukarvedtak, ingen e-signeringsintegrasjon. Sporing i kontrollplanet/Console, aldri i nokon Workspace.

**Ope:**
- Det finst i dag ingen faktisk signert DPA for noka kunde — funksjonaliteten for å *spore* signering er bygd, men sjølve malen er eit Standardforslag som ikkje er juridisk kvalitetssikra.
- Malen sitt punkt 8 (overføring til tredjeland) har same Vercel/Resend-formulering som punkt 3 over.
- DPA-opplasting/sletting har same opne tilgangsnivå som resten (kvar aktiv operatør, ikkje superadmin-avgrensa) — verdt å vurdere om det bør vere superadmin-gata som Compliance-skriving elles er.

## 5. Retensjon-sweep (automatisert dry-run-teljing, ingen sletting)

Edge Function `retention-sweep` i `vibeverk-control`, utløyst av `pg_cron` dagleg kl. 03:17 UTC. For kvar `status='active'`-tenant med `retention_policy->leads->enabled = true` (default `false` for ALLE kundar), tel funksjonen leads i kundens EIGE Supabase-prosjekt med `created_at` eldre enn `retention_policy->leads->months` (default 12), og skriv talet til `retention_runs` (alltid `dry_run: true`, `rows_deleted: 0`). Console → Kundar har ei av/på-brytar + månadstal-felt per kunde, og viser siste kjøring.

Fase-delinga (1 = teljing, 2 = synleggjering, 3 = faktisk sletting) er medvite — Fase 3 krev ein eigen Security Auditor-pass før han rullast ut for **nokon** kunde, ikkje berre eit policy-flip. Funksjonelt testa live mot ekte data: 7 kandidatar funne for Vibeverk sitt eige prosjekt, 0 for Sunnvask (begge sidan sett attende til trygge standardverdiar).

**Ope:**
- Ingen kode i heile systemet kan i dag slette éi einaste rad basert på retensjon.
- Kandidat-teljinga brukar `created_at` (lead-opprettinga), ikkje siste aktivitet — `leads`-tabellen manglar ein `updated_at`-kolonne, så "12 md. etter siste aktivitet" (formuleringa i retensjonsblokka og `COMPLIANCE_STANDARD_SUGGESTIONS`) stemmer strengt tatt ikkje overeins med korleis sweep-en faktisk måler alder i dag.

## 6. Kjende, framleis opne gap

1. **AI-modular/Anthropic som 5. leverandør, ikkje avklart.** `VIBEVERK_VENDORS`/`vendor_registry` inneheld ikkje Anthropic (medvite). Om/når AI-modular blir tilbydd ein reell kunde, manglar den kundevendte leverandørteksten éin reell mottakar.
2. **Sidetelling — to separate spørsmål.** (A) Ekomlova §3-15: skjer lagring av eller tilgang til informasjon PÅ SJØLVE UTSTYRET til den besøkjande? Designet (ingen cookie, ingen nettlesarlagring lese/skrive) er eit godt argument for at dette er avgrensa. (B) GDPR sjølvstendig: sjølv om (A) er avklart gunstig, inneber serverbehandlinga av IP-adresse/User-Agent/dagleg rotert hash framleis behandling av personopplysningar/pseudonyme opplysningar under GDPR, med eige krav om formål/grunnlag/minimering/lagringstid. Begge medvite pausa, ikkje gløymde.
3. **Per-skjema `retention`-felt tomt for alle kundar.** Feltet finst i datastrukturen og har no konkrete forslag som plasshaldar i UI-et, men er ikkje automatisk utfylt eller lagra for nokon kunde.
4. **Dobbel personvern-tekst-generator:** `computeDefaultPrivacyText()` (`core.js`, synkron fallback FØR Personvern-fana nokon gong er opna) og `computeTenantPrivacyBlocks()` (`console-core.js`, hovudgenerator). Begge har no korrekt innhald (same rettar/behandlingsgrunnlag/Plausible-ordlyd), men er framleis to SEPARATE funksjonar som må haldast manuelt i synk — ei full samanslåing er eit større, seinare arkitekturarbeid (sjå DEL 3).
5. **Ingen kryssjekk mellom `compliance_record` (internt Art. 30-register) og den kundevendte teksten** — to sjølvstendige tekstkjelder som kan drive frå kvarandre utan varsel.

---

# DEL 2 — Kapittel-for-kapittel-eksport av forslagsteksten, ordrett

Alle 12 blokker er henta direkte frå `computeTenantPrivacyBlocks(sc, an)` i `console/console-core.js`, i den rekkjefølgja koden faktisk pusher dei til `blocks[]`-arrayet. Der teksten er dynamisk (retensjon, cookies, leverandørar), er dette markert eksplisitt. Status: **solid** / **tynn** / **open juridisk vurdering** / **stadfesta gap**.

---

### 1. `intro` — «Om denne personvernerklæringen»

> Denne personvernerklæringen forteller deg hvilke personopplysninger vi samler inn, hva vi bruker dem til, hvor lenge vi lagrer dem, og hvilke rettigheter du har. Den gjelder for alle som besøker nettsiden, tar kontakt med oss via skjemaene her, eller er ansatt og bruker våre interne arbeidsverktøy (Workspace).

**Lovheimel:** Ingen direkte artikkel — understøttar den generelle openheitsplikta i GDPR art. 12.
**Status: Solid.** Ingen påstandar om fakta som kan vere feil.

---

### 2. `controller` — «Hvem er behandlingsansvarlig?»

> [Firmanavn] (org.nr [X]) er behandlingsansvarlig for personopplysningene som er beskrevet i denne personvernerklæringen. Det betyr at det er [Firmanavn] — ikke leverandøren av selve nettsideplattformen — som bestemmer hva opplysningene brukes til og hvordan de behandles. Har du spørsmål om personvern, kan du kontakte oss på [e-post, telefon, adresse].

(Fell tilbake til "Vi"/"vi" om `company.name` er tom; org.nr-setninga fell heilt bort om `sc.footer.orgNr` er tom; kontaktsetninga fell heilt bort om `sc.contact` er tomt.)

**Lovheimel:** GDPR art. 13(1)(a) — identiteten og kontaktopplysningane til den behandlingsansvarlege skal opplysast ved innsamling.
**Status: Tynn.** Sjølve strukturen er rett, men innhaldet er heilt avhengig av at kunden faktisk har fylt ut `company.name`/`sc.footer.orgNr`/`sc.contact`. Ingen kodemessig sperre hindrar publisering av ei ufullstendig utgåve utan namn/kontakt.

---

### 3. `baseline` — «Hvor lagres opplysningene?» + «Dine rettigheter»

> **Hvor lagres opplysningene?**
> Nettsiden driftes hos Vercel. Innsendte opplysninger lagres i en database hos Supabase, med servere i Irland (EU).
>
> **Dine rettigheter**
> Du har rett til innsyn i hvilke opplysninger vi har lagret om deg, og rett til å få disse korrigert, slettet eller begrenset, i tråd med personopplysningsloven/GDPR. Du kan også protestere mot behandlingen, og be om å få opplysningene utlevert i et strukturert format (dataportabilitet) der det er relevant. For å be om innsyn, retting, sletting eller andre rettigheter, ta kontakt via kontaktinformasjonen på denne siden og merk henvendelsen «Personvern» — vi behandler slike forespørsler uten ugrunnet opphold og normalt innen én måned. Opplysninger slettes eller begrenses når vilkårene for dette etter personvernregelverket er oppfylt. Du har også rett til å klage til Datatilsynet dersom du mener vi behandler personopplysningene dine i strid med regelverket. Du finner informasjon om hvordan du klager på datatilsynet.no.

**Argumentasjon:** "Irland (EU)"-påstanden er verifisert — `docs/compliance/data-map-vibeverk.md` stadfestar `eu-west-1` for alle prosjekt.

**Lovheimel:** "Hvor lagres" understøttar art. 13(1)(f). "Dine rettigheter" dekker art. 15 (innsyn), 16 (retting), 17 (sletting), 18 (begrensning), 20 (dataportabilitet), 21 (protest), og 77 (klagerett). Svarfrist-tilvisinga følgjer EDPB sin eigen praksis (normalt éin månad).

**Status: Solid** for rettar-lista (alle sentrale rettar dekt, konkret klageveg, realistisk svarfrist). "Hvor lagres"-halvdelen sin implisitte føresetnad om at Vercel-forholdet er i orden heng saman med det opne Vercel-DPA-gapet (sjå DEL 1.3).

---

### 4. `employees` — «Personopplysninger om ansatte (Workspace)» + «Brukerstøtte»

> **Personopplysninger om ansatte (Workspace)**
> Ansatte som bruker vårt interne arbeidsverktøy (Workspace) får en brukerkonto med navn, e-postadresse og rolle. Opplysningene behandles for å administrere arbeidsforholdet og gi nødvendig tilgang til de interne verktøyene, med grunnlag i arbeidsforholdet og vår berettigede interesse i å drifte virksomheten. Kontoen og tilhørende opplysninger fjernes normalt når arbeidsforholdet opphører.
>
> **Brukerstøtte**
> Ved behov for direkte brukerstøtte kan vår leverandør av nettsideplattformen generere en tidsavgrenset innloggingslenke for å bistå en administrator i Workspace, uten å få kjennskap til passordet. Dette skjer kun etter avtale, lenken utløper raskt, og hver forespørsel logges.

**Lovheimel:** GDPR art. 13, art. 6(1)(b) og 6(1)(f) — i dag stabla som dobbelt grunnlag.

**Status: Tynn.** Ingen stad i Workspace lenkjer faktisk til det publiserte personvernvedtaket — ein tilsett oppdagar difor ikkje denne teksten utan at nokon fysisk deler lenkja. Å stable art. 6(1)(b) OG 6(1)(f) samstundes bør erstattast med EITT konkret grunnlag per aktivitet, vurdert av jurist.

---

### 5. `mod-kontakt` — «Kontaktskjema» *(vist kun om `features.contactForm !== false`)*

> Når du sender oss en henvendelse, lagrer vi opplysningene du selv oppgir — typisk navn, e-postadresse, telefonnummer og innholdet i meldingen. Opplysningene brukes utelukkende til å besvare henvendelsen din, med grunnlag i vår berettigede interesse i å kunne besvare henvendelser rettet til oss, og deles ikke med tredjeparter for markedsføringsformål.

**Lovheimel:** GDPR art. 13(1)(c) — formål og behandlingsgrunnlag dekt.
**Status: Tynn → forbetra.** Behandlingsgrunnlaget er ei rimeleg standardvurdering (berettiga interesse), ikkje eit ferdig juridisk svar — sjå DEL 3, P2.

---

### 6. `mod-tilbud` — «Tilbudsforespørsel» *(vist kun om `features.quote` er sant)*

> Når du ber om tilbud, lagrer vi navn, e-postadresse, telefonnummer, innholdet i forespørselen og eventuelle vedlegg du laster opp, med grunnlag i at behandlingen er nødvendig for å oppfylle en avtale du selv har bedt om, eller for å gjennomføre tiltak på din anmodning før en slik avtale inngås. Opplysningene brukes til å utarbeide og sende deg et tilbud. Vedlegg lagres i en egen, tilgangsbegrenset fillagringstjeneste og slettes sammen med resten av henvendelsen.

**Lovheimel:** GDPR art. 13(1)(c) — formål og behandlingsgrunnlag dekt (art. 6(1)(b), avtale-før-avtale).
**Status: Tynn → forbetra.** Same «rimeleg standardvurdering, ikkje ferdig svar»-atterhald som over.

---

### 7. `mod-booking` — «Booking» *(vist kun om `features.booking` er sant)*

> Når du reserverer en time/booking, lagrer vi navn, e-postadresse, telefonnummer, valgt tidspunkt og en eventuell melding, med grunnlag i at behandlingen er nødvendig for å gjennomføre avtalen. Opplysningene brukes til å gjennomføre avtalen.

**Lovheimel:** GDPR art. 13(1)(c), art. 6(1)(b).
**Status: Tynn → forbetra.** Same atterhald.

---

### 8. `retention` — «Hvor lenge lagrer vi opplysningene?» *(dynamisk, frå `computeRetentionBlock()`)*

**Fallback-varianten (vist for ALLE kundar i dag):**
> Vi lagrer opplysningene dine så lenge det er nødvendig for formålet de ble samlet inn for, og sletter dem deretter uten ugrunnet opphold, med mindre vi har en lovpålagt plikt til å lagre dem lenger.

**Den ALTERNATIVE (per-skjema) varianten som VILLE blitt generert dersom ein operatør fylte ut `forms.*.retention`:**
> Kontaktskjema: [operatørens tekst]
> Tilbudsskjema: [operatørens tekst]
> Booking: [operatørens tekst]

Skjematekster-fana viser no `PRIVACY_FORM_RETENTION_SUGGESTION`-plasshaldarar (t.d. «Inntil 12 måneder etter siste aktivitet» for kontakt) — ein operatør må framleis sjølv godkjenne/skrive inn per kunde, aldri auto-fylt stille.

**Lovheimel:** GDPR art. 13(2)(a) — lagringsperioden, eller kriteria brukt for å fastsetje ho. Den vage "så lenge det er nødvendig"-formuleringa er IKKJE ulovleg (art. 13(2)(a) opnar for "kriteria" som alternativ til eit konkret tal), men er den svakaste akseptable varianten.

**Status: Stadfesta gap — den svakaste blokka som faktisk går live i produksjon i dag, for 100 % av kundane.** Dei konkrete lagringstidene (12 md./12-24 md./6-12 md.) finst i det interne Art. 30-registeret, men er ikkje kopla til denne blokka for nokon kunde.

---

### 9. `mod-chat` — «Chat» *(vist kun om `features.chat !== false`)*

> Når du bruker chat-funksjonen på nettsiden, lagrer vi det du skriver, samt navn og e-postadresse dersom du oppgir dette, med grunnlag i vår berettigede interesse i å kunne besvare henvendelser sendt via chat. Vi lagrer også tekniske opplysninger som hvilken side du chattet fra, hvor du kom fra, og grunnleggende informasjon om nettleseren din. Opplysningene brukes til å besvare henvendelsen din.

Chat-widgeten sitt eige samtykke-checkbox opnar den delte popup-en (footer/Workspace) i staden for eit fritt, ofte-tomt `termsUrl`-felt.

**Lovheimel:** GDPR art. 13(1)(c).
**Status: Tynn → forbetra.** Same «rimeleg standardvurdering»-atterhald som skjema-blokkene.

---

### 10. `mod-analytics` — «Bruker vi cookies?» *(dynamisk, tre-vegs)*

**Variant A — Plausible aktiv:**
> Ja, vi bruker Plausible Analytics for trafikkstatistikk — et personvernvennlig analyseverktøy som ikke bruker informasjonskapsler eller vedvarende identifikatorer, og som ikke lagrer besøkendes IP-adresser.

**Variant B — intern sidetelling aktiv (kun om Plausible IKKJE er aktiv):**
> Den interne sidetellingen bruker ingen cookies og verken leser fra eller skriver til nettleserlagring for analysegruppering. Vi bruker sidetellingen til trafikkstatistikk (sidevisninger, henvisninger, klikk på kontaktknapper, en grov enhetskategori, enkel filtrering av automatisert trafikk, hvilke sider besøkende kommer fra/går til, og hvilken kampanje en lenke er merket med hvis du selv har lagt til dette i lenken, ofte kalt UTM). På serveren lager vi en kode av datoen, nettstedsadressen, IP-adressen og informasjon nettleseren automatisk sender. Selve hendelsen og dagskoden lagres. Av IP-adressen, nettstedsadressen og den detaljerte nettleserinformasjonen lagres bare dagskoden, ikke de rå verdiene, og koden endres automatisk hver dag. Vi bruker ingen separat analyseleverandør; hendelsene og dagskoden lagres i nettsidens Supabase-database hos driftsleverandøren.

**Variant C — ingen analyse:**
> Nei. Denne siden bruker ingen cookies eller analyseverktøy som samler inn personopplysninger.

**Lovheimel:** Ekomlova § 3-15 (eiga norsk lovheimel, separat frå GDPR). Plausible er godt dokumentert cookiefritt og vert generelt rekna utanfor § 3-15 sitt samtykkekrav.

**Status:**
- **Variant A: Solid.**
- **Variant B: Open juridisk vurdering — eksplisitt, medvite pausa.** `docs/architecture/sidetelling.md` stadfestar at spørsmålet IKKJE er avklart med jurist. Skal ikkje gå live for nokon reell, betalande kunde før den vurderinga er gjort.
- **Variant C: Solid.**

---

### 11. `mod-suppliers` — «Hvilke leverandører behandler opplysningene dine?» + «Overføring av opplysninger utenfor EU/EØS» *(dynamisk, frå `computeSupplierBlock()`, lest frå `vendor_registry`)*

> **Hvilke leverandører behandler opplysningene dine?**
> Supabase — Database, autentisering og fillagring — all persondata plattformen lagrer. Data er plassert i EU.
> Vercel — Hosting og tenant-ruting. Leverandøren er etablert i USA.
> Resend — Utsending og mottak av e-post. Leverandøren er etablert i USA.
> Plausible Analytics — Cookiefri trafikkstatistikk. Leverandøren er etablert i EU/EØS. *(kun om Plausible faktisk er aktiv)*
>
> **Overføring av opplysninger utenfor EU/EØS**
> Noen av leverandørene våre er etablert utenfor EU/EØS. Vi sørger for at slike overføringer skjer i tråd med personvernregelverket:
> Resend: overføringen er dekket av Resends databehandleravtale, som gjelder automatisk ved bruk av tjenesten.
> Vercel: vi arbeider med å sikre at overføringen skjer i tråd med personvernregelverket.

**Lovheimel:** GDPR art. 13(1)(e) for fyrste avsnitt; GDPR kapittel V (art. 44–49) for andre avsnitt.

**Status:**
- **Leverandørlista: Solid.** Nøyaktig, oppdatert automatisk frå éin sanningskjelde.
- **Overføringsgrunnlag: Resend no truverdig** (DPA stadfesta i kraft, sjå DEL 1.3) — konkret mekanisme (SCC/DPF) ikkje sjølvstendig verifisert. **Vercel: ærleg formulert, men det underliggande gapet (ingen DPA på noverande plan) står framleis ope** til plan-oppgradering eller anna avklaring, sjå DEL 3.

---

### 12. `breach` — «Melding ved brudd på personopplysningssikkerheten»

> Dersom det skulle oppstå et brudd på personopplysningssikkerheten — for eksempel uautorisert tilgang til eller tap av opplysninger — som medfører risiko for dine rettigheter og friheter, vil vi varsle Datatilsynet uten unødig opphold og senest innen 72 timer etter at vi ble kjent med bruddet, i tråd med personvernforordningen (GDPR) artikkel 33. Dersom bruddet innebærer høy risiko for deg, vil vi også varsle deg direkte.

**Lovheimel:** GDPR art. 33 og 34 — teksten siterer korrekt tidsfrist og terskel for begge.
**Status: Solid.**

---

## Oppsummerande statustabell (Del 2)

| # | Blokk | Status |
|---|---|---|
| 1 | Intro | Solid |
| 2 | Behandlingsansvarleg | Tynn (avhengig av utfylt company/org.nr/kontakt) |
| 3 | Lagringsstad + Rettar | Solid rettar-liste / heng saman med Vercel-gapet |
| 4 | Tilsette (Workspace) | Tynn (ikkje reelt oppdaga av tilsette, dobbelt grunnlag bør avklarast) |
| 5 | Kontaktskjema | Tynn → forbetra (grunnlag lagt til, treng jurist-stadfesting) |
| 6 | Tilbudsforespørsel | Tynn → forbetra |
| 7 | Booking | Tynn → forbetra |
| 8 | Lagringstid | **Stadfesta gap** — svakaste blokk i produksjon for alle kundar |
| 9 | Chat | Tynn → forbetra |
| 10a | Cookies — Plausible | Solid |
| 10b | Cookies — sidetelling | **Open juridisk vurdering** — medvite pausa (ekomlov §3-15 + GDPR) |
| 10c | Cookies — ingen | Solid |
| 11a | Leverandørliste | Solid |
| 11b | Overføringsgrunnlag | Resend forbetra / **Vercel framleis ope** — høgast prioritet i dokumentet |
| 12 | Avviksvarsling | Solid |

---

# DEL 3 — Konkret sjekkliste: kva står mellom no og reell, betalande produksjonskunde

Kvart punkt merka etter KVEM som må gjere noko: kode/tekst (kan byggjast av Claude), forretning (krev ei avgjerd eller handling frå deg), eller jurist (treng ekte juridisk vurdering).

## Prioritert, framleis ope

| # | Punkt | Kven |
|---|---|---|
| 1 | **Vercel-DPA:** oppgrader Vercel-kontoen til Pro/Enterprise, eller avklar forholdet på anna vis — teksten er alt ærleg formulert, men det underliggande gapet (ingen DPA på Hobby-plan) står att | **Forretning** |
| 2 | Bygg éin samla "aktivitet → formål → datakategoriar → behandlingsgrunnlag → mottakarar → retensjon"-datamodell (`sc.privacy.activities{}`) som både `compliance_record` og kundeteksten kan generere frå — fjernar drift-risikoen mellom dei to | Kode (større arbeidsstykke, bør Arkitekt-planleggjast) |
| 3 | Fullfør `vendor_registry.dpa_status` → to separate felt (`dpa_status` + `transfer_status`), pluss "sist kontrollert"-dato og kjelde-URL per leverandør | Kode |
| 4 | Skriv om Art. 30-formuleringa: Vibeverk manglar ein eksplisitt protokoll for si eiga rolle som DATABEHANDLAR (kvar kunde + kategoriar behandla på deira vegne) | Kode/tekst |
| 5 | Gjer firmanamn + reell kontaktinfo til ein hard publiserings-sperre (kan i dag publiserast tomt) | Kode |
| 6 | Innfør `updated_at`/`last_activity_at` på `leads`, ELLER endre retensjonsteksten frå "siste aktivitet" til "opprettinga" slik at teksten matchar det retention-sweep faktisk måler | Kode — låg kostnad |
| 7 | Lag reell tilgang til tilsett-personvernteksten frå Workspace | Kode |
| 8 | Hent og legg ved dei FAKTISKE, fullstendige DPA-dokumenta (ikkje berre skildringar) frå Supabase/Resend/Plausible sine kundeportalar, slik at juristen kan lese dei direkte | Deg |
| 9 | Vurder full samanslåing av `core.js` sin fallback-generator og `console-core.js` sin hovudgenerator til éin delt funksjon | Kode (arkitekturarbeid) |

## Spørsmål som må TIL juristen

1. Kva konkret behandlingsgrunnlag passar for kvar av kontakt/tilbud/booking/chat — art. 6(1)(b) (avtale) eller 6(1)(f) (berettiga interesse)? Dagens tekst er eit forslag, ikkje eit svar.
2. Bør tilsett-/Workspace-personvern vere eit HEILT separat dokument frå kunde-/besøkjande-personvern?
3. Er den serverbaserte sidetellinga korrekt vurdert etter BÅDE ekomlova §3-15 OG GDPR sjølvstendig?
4. Er Vibeverk sin kundedatabehandleravtale (13-punkts-malen) fullstendig etter art. 28 — juristen må lese sjølve avtaleteksten.
5. Er dei foreslåtte retensjonsperiodane (12 md./12-24 md./6-12 md.) forsvarlege for kvar datakategori?
6. Treng nokon av dei planlagde AI-modulane (Oversikt/Smart årshjul) ei DPIA eller ytterlegare tiltak før dei kan tilbydast ein reell kunde?
7. Er Resend sin konkrete overføringsmekanisme (SCC/DPF/anna) tilstrekkeleg dokumentert for kundeteksten sitt formål?
8. Bør art. 6(1)(b)/6(1)(f) stablast for tilsettdata, eller bør EITT konkret grunnlag veljast per aktivitet?

## Arkitekturarbeid, ikkje blokkerande

- Retention-sweep Fase 3 (faktisk sletting) sin eigen sjekkliste før han nokon gong byggjast: konsistent sletting av vedlegg saman med raden, oppdagbare feil, idempotens, strukturert audit-resultat per kjøring, ein "legal hold"-unntaksmekanisme, og ei sperre mot at ein kunde sin retensjonspolicy kan motseie den publiserte personvernteksten utan varsel.
- Vurder om avviksvarslingsblokka (#12) i det heile bør stå i sjølve personvernerklæringa, eller om ho høyrer betre heime som ein separat, intern beredskapsprosedyre.

---

## Vedlegg — kjelder

- `console/console-core.js`, `core.js` (main) — `computeTenantPrivacyBlocks()`, `computeRetentionBlock()`, `computeSupplierBlock()`, `VIBEVERK_VENDORS`, `COMPLIANCE_STANDARD_SUGGESTIONS`, `computeDefaultPrivacyText()`.
- `module-chat.js` (main) — samtykketekst, popup-integrasjon.
- `supabase-control/supabase/migrations/` — compliance-, DPA- og retensjon-migrasjonane (20260812170000 → 20260813120000).
- `supabase-control/supabase/functions/retention-sweep/index.ts`, `tenant-admin/index.ts`.
- `docs/project/CHANGELOG.md` — versjonar 0.136.0–0.146.0.
- `docs/compliance/personvern-rammeverk-status-2026-08-12.md` — tidlegare samandragsdokument, samanlikningsgrunnlag.
- `vercel.com/legal/dpa`, `supabase.com/legal/dpa`, `resend.com/legal/dpa`, `plausible.io/dpa` — leverandørane sine eigne DPA-vilkår, henta live 2026-08-13. Tredjeparts nettsider som kan endre seg — bør re-verifiserast periodisk.

**Sluttmerknad:** Dette dokumentet er eit sourced utgangspunkt for vidare arbeid saman med kvalifisert juridisk rådgivar, ikkje eit ferdig svar. Statusane/tilrådingane kan sjølv innehalde feil.
