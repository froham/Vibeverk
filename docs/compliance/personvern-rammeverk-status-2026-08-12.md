# Personvern — rammeverk-status og revisjonsliste (2026-08-12)

**Formål:** eitt samla oversyn over kvar einaste tekst-/strukturflate i Vibeverk som gjeld personopplysningar, slik at brukaren kan gå gjennom dei éin og éin saman med Codex/GPT og eiga vurdering, før noko går til ekte juridisk kvalitetssikring. Ikkje eit ferdig utkast, ikkje juridisk rådgjeving — sjå fråskrivinga i `README.md`.

Utarbeidd av Arkitekten (systemkartlegging) og Personvern/Compliance-rådgjevaren (juridisk vurdering), begge køyrde ei fersk, kodegrunna gjennomgang 2026-08-12 — ikkje basert på tidlegare dokument åleine. Kryssjekka mot fire eksterne kjelder brukaren la ved (gdprcontrol.no, adminkit.no, to Legiscope-artiklar).

---

## 0. Kort svar på "når ville du vore tilfredsstilt?"

Dei fire tinga som faktisk ville stoppa meg om dette var mitt eige firma, i prioritert rekkjefølgje:

1. **At kundevendt tekst påstår meir enn vi veit.** Leverandørblokka viser "SCC og/eller DPF" til besøkjande, medan operatørsida sjølv seier "unconfirmed" for Supabase/Vercel/Plausible. Det er den einaste staden i heile utkastet der intern uvisse medvite blir halden unna kunden — og det er nettopp den typen skilnad ein kunde sin eigen jurist ville reagert sterkast på.
2. **At teksten inneheld ein reint faktisk feil.** "Nettsida er bygd som ei statisk side og driftast via GitHub Pages" stemmer ikkje lenger for tenantar på gjeldande Vercel-hosting (ADR-0007). Dette er ikkje ei juridisk vurdering, berre utdatert kode-mot-tekst — billig å fikse, pinleg å la stå.
3. **At noko alt avgjort ikkje er bygd.** Tilsettdata i Workspace vart eksplisitt vedteke 2026-08-06 ("byggjast med standardformulering") — og finst framleis ingen stad i koden, eitt månad seinare. Dette er det billegaste og mest oversitte punktet på heile lista.
4. **At lagringstid-teksten som faktisk går live for 100 % av kundar i dag er den svakaste varianten.** Ikkje ulovleg, men akkurat den generiske fallback-setninga alle fire kjeldene peikar på som utilstrekkeleg i lengda.

Alt anna på lista under (sidetelling sin §3-15-status, Anthropic, inbound-e-post-grunnlaget) er allereie handtert med den varsemda dei fortener — haldt medvite utanfor produksjon til dei er avklarte. Det bekymrar meg mindre enn dei fire punkta over, som anten er feil, stille optimistiske, eller berre ikkje gjort enno sjølv om dei er enkle og alt vedtekne.

---

## 1. Revisjonsliste — éin og éin gjennomgang (svar 1)

Nummerert slik at du kan ta dei i rekkjefølgje. Status: **solid** / **tynn** / **tom (strukturelt til stades, ikkje utfylt)** / **manglar heilt**.

| # | Tekstflate | Kjelde i kode | Status | Kva trengst |
|---|---|---|---|---|
| 1 | Innleiing ("Om denne personvernerklæringen") | `console-core.js:5056` | Solid | Ingenting |
| 2 | Behandlingsansvarleg | `console-core.js:5059` | Tynn | Manglar org.nr-felt heilt; fell attende til "Vi" utan namn om `sc.company`/`sc.contact` ikkje er fylt ut |
| 3a | Lagringsstad ("GitHub Pages") | `console-core.js:5064` | **Feil/utdatert** | Oppdater til faktisk Vercel+middleware-hosting (ADR-0007) |
| 3b | "servere i EU" (Supabase) | `console-core.js:5064` | Ustadfesta påstand | Stadfest faktisk Supabase-region per prosjekt (Dashboard → Infrastructure), eller mjuk opp ordlyden |
| 3c | Rettar / klagerett | `console-core.js:5065` | Solid | Ingenting |
| 4 | Kontaktskjema | `console-core.js:5067` | Tynn | Manglar eksplisitt behandlingsgrunnlag (kun formål) |
| 5 | Tilbudsforespørsel | `console-core.js:5070` | Tynn | Same som 4, pluss manglar omtale av at vedlegg lagrast i Storage (offentleg/privat bucket-skiljet) |
| 6 | Booking | `console-core.js:5073` | Tynn | Same behandlingsgrunnlag-gap som 4-5 |
| 7 | Lagringstid | `computeRetentionBlock()` `console-core.js:5000` | **Svakaste blokk i drift i dag** | Konkrete lagringstider per skjematype (sjå tabell i del 2) |
| 8a | Cookies — Plausible | `console-core.js:5078` | Solid | Ingenting |
| 8b | Cookies — sidetelling | `console-core.js:5079` | Reell, blokkerande opne spørsmål (ekomlov §3-15) | Juridisk vurdering før dette går live for ein reell kunde (alt medvite pausa) |
| 8c | Cookies — ingen | `console-core.js:5081` | Solid | Ingenting |
| 9 | Leverandørar + overføring | `computeSupplierBlock()` `console-core.js:5104` | Solid liste, men **DPA-uvisse er medvite skjult for kunden** | Avklar faktisk Vercel Pro/DPA-status og Resend SCC/DPF, ELLER la kundeteksten reflektere same uvisse som operatørteksten |
| 10 | Avviksvarsling (Art. 33) | `console-core.js:5084` | Solid, meir enn strengt kravd | Ingenting |
| 11 | **Chat-widget — manglar heilt eiga blokk** | `module-chat.js` samlar namn/e-post/melding/nettlesarmetadata | **Manglar** | Ny blokk (sjå del 3, `mod-chat`) |
| 12 | Chat sitt eige samtykke-checkbox | `module-chat.js:17-18,675-679` | Tynn/frikopla | Bruker eigen tekst ("Eg godtek at denne samtalen lagrast"), **ikkje** knytt til `CFG.privacy.text` slik `quote.termsText` er; `termsUrl` er tom som standard → ingen lenke til personvernteksten vises |
| 13 | Per-skjema `legalBasis`-felt | `sc.privacy.forms{}` | Tom (alle kundar) | Avgjer behandlingsgrunnlag per skjematype (Datatilsynet-rettleiing eller jurist) |
| 14 | Per-skjema `retention`-felt | `sc.privacy.forms{}` | Tom (alle kundar) | Lagringstid-vedtak (del 2) |
| 15 | Per-skjema `recipients`-felt | `sc.privacy.forms{}` | Ustadfesta om det faktisk blir vist nokon stad | Verifiser at feltet blir brukt i publisert dokument, elles fjern det |
| 16 | Per-skjema `blurbHtml`-felt | `sc.privacy.forms{}` | Ustadfesta innhald | Sjekk kva som faktisk er fylt inn per kunde |
| 17 | **Tilsett-/Workspace-data — manglar heilt** | Ingen kode nokon stad | **Manglar, sjølv om vedteke 2026-08-06** | Det billegaste, mest oversitte punktet på lista — standardformulering (arbeidsforhold/legitim interesse) er alt bestemt, berre ikkje skriven |
| 18 | `termsField()` — hovudsjekkboks Kontakt/Tilbud/Booking | `components.js:174` | Solid og provably samanhengande med publisert tekst | Ope spørsmål om sjekkboksen i det heile er juridisk naudsynt (Datatilsynet sitt informasjonskrav ≠ avkrysningskrav) — avgjerd, ikkje feil |
| 19 | Støttetilgang-disclosure (`generate_support_access`) | Ingen kode | Manglar (kjend frå før, ROADMAP.md) | Kundevendt tekst om tidsavgrensa support-impersonering |
| 20 | Dobbel generator: `computeDefaultPrivacyText()` (core.js) vs. `computeTenantPrivacyBlocks()` (console-core.js) | `core.js:5443` vs `console-core.js:5033` | Driftrisiko | Den tynnare (core.js) er bokstaveleg tala fyrste-gongs-standard for ein heilt ny kunde før Console er opna — vurder å fjerne/samkøyre |
| 21 | Daud `nyhetsbrev`-felt i `PRIVACY_FORM_TYPES` | `console-core.js:4648` | Ufarleg, men villeiande | Ingen `module-newsletter.js` finst — fjern feltet eller dokumenter kvifor det står |
| 22 | **Behandlingsprotokoll (Art. 30)** | Finst ikkje | **Manglar heilt, ikkje del av dei 10 blokkene** | Sjå del 3 — separat, intern, ikkje-publisert plikt |

---

## 2. Kapittel-for-kapittel-forsvar + konkrete sletteregler (svar 2)

### Kapittel-for-kapittel (samandrag — full grunngjeving per blokk med GDPR-artikkelreferansar i Personvern/Compliance-rådgjevaren si fulle utgreiing, be om ho i sesjonen om du vil ha alt ordrett)

- **Solid utan atterhald:** innleiing (1), rettar/klagerett (3c), kontaktskjema/tilbud/booking-formål (4-6, som *formål*-tekst, ikkje som fullstendig Art. 13), cookies (Plausible/ingen), avviksvarsling.
- **Tynn, men forsvarleg som mellombels tekst:** behandlingsansvarleg, lagringstid-fallback (fordi Datatilsynet sin eigen standard faktisk er vag), leverandørliste som *liste* (sjølve overføringsmekanisme-hedginga er derimot ikkje forsvarleg, sjå punkt 9 over).
- **Reelle hol som treng handling før ein ekte kunde publiserer:** GitHub Pages/EU-påstandane (feil), DPA-hedginga som forsvinn mot kunden (uærleg-ved-utelating), sidetelling sin §3-15-status (alt korrekt pausa), tilsettdata (manglar heilt), chat-blokk (manglar heilt).
- **Kjeldene brukaren la ved:** GDPRControl og Adminkit er begge leverandør-skriven marknadsføringstekst, ikkje juridisk forfatta — deira "10 påkravde element"-lister er beste praksis, ikkje ein bokstaveleg Art. 13-sjekkliste, og skil ikkje Art. 13 (direkte innsamling) frå Art. 14 (indirekte, relevant for inbound-e-post-flyten). Legiscope sin Art. 30-artikkel er den mest juridisk grunngjevne av dei fire, og peikar rett på at **Vibeverk sjølv manglar eit ekte Art. 30-register** — eit poeng heilt utanfor dei 10 blokkene over.

### Konkrete sletteregler (forslag til diskusjon — ikkje stadfesta juridisk minimum, sidan det ikkje finst noko norsk lovfesta minstetid for desse kategoriane)

| Kategori | Forslag til lagringstid | Grunngjeving | Automatisering i dag |
|---|---|---|---|
| Kontaktskjema-leads | 12 md. etter siste aktivitet, deretter slett | Formålet (svare på henvendelsen) er raskt oppfylt | Manuelt (`App.deleteLead`) — ingen tidsstyrt jobb finst |
| Tilbud/vedlegg | 12 md. etter avslutta/utgått tilbod | Same grunngjeving. `deleteLead()` frigjer alt vedlegget i Storage korrekt ved manuell sletting — det manglar berre eit tidstriggerpunkt | Manuelt, men slettemekanikken er alt riktig |
| Booking | 12–24 md. etter bestilt dato | Lengre pga. mogleg tvist/no-show-oppfølging — reint forretningsskjønn, ikkje juridisk fasit | Manuelt |
| Chat-meldingar | 6–12 md. etter siste melding | Lågare verdi etter avslutta samtale, kortare standard reduserer nettlesarmetadata-fotavtrykket | Delvis (e-postbasert sletting finst, ikkje aldersbasert) |
| CRM (kunde/bedrift/kommunikasjon) | Ingen fast dato — inaktivitetsbasert (t.d. 24 md. utan aktivitet), ikkje ein blanke aldersgrense | CRM tener eit ope kunderelasjonsformål utan naturleg utløp | Manuelt |
| Tilsette (Workspace) etter avslutta forhold | Tilgang: umiddelbar revokering. Underliggande data: kunden sin eigen HR-policy, ikkje ein Vibeverk-standard | Arbeidsgivar sitt ansvar, ikkje plattforma sitt | Sletting fungerer (`auth.admin.deleteUser()`), men er full sletting — vurder om ekte behov for "behald forfattarskap, fjern tilgang" i staden |
| Sikkerhetskopi-eksport (`export_backup_tables()`) | Kortare enn levande data, men **kan ikkje handhevast teknisk** — dette er ein fil kunden lastar ned og eig sjølv | Rå raddump forbi kviteliste-mapparane, inneheld `consent`-JSON råtekst | Ingen automatisering mogleg — dette er ei prosessåtvaring til kunden, ikkje ein kodefiks |

Vedtaket "byggjast" (automatisk retensjon/sletting) frå 2026-08-06-møtet står ved lag — ingenting av dette er bygd enno.

---

## 3. Andre tiltak + Console som verktøy (svar 3)

### Behandlingsprotokoll (Art. 30) — arkitekturforslag

**Anbefaling: hybrid — automatisk avleidd faktagrunnlag + eit nytt felt for det som ikkje finst nokon stad i dag**, same mønster som `computeTenantPrivacyBlocks()` alt brukar (frisk utrekning + bevar operatør-redigering + drift-varsling).

- Gjenbruk `sc.privacy.forms{}` (formål/grunnlag/lagringstid) og `VIBEVERK_VENDORS` (mottakarar/overføring) — ikkje skriv dei inn på nytt i ein separat struktur, det ville berre skape same driftrisiko som `data-map-vibeverk.md` alt viser i praksis (hand-vedlikehalden, alt utdatert mot sidetelling-ombygginga).
- Nytt felt som trengst: `sc.privacy.activities{}`, éin rad per reell behandlingsaktivitet (kontakt, tilbod, booking, chat, CRM, Workspace-tilsette, sidetelling, AI-modular), med `dataSubjects`/`dataCategories`/`securityMeasures` — dette finst ikkje i `forms{}` i dag, sidan `forms{}` er skjema-sentrert, ikkje aktivitets-sentrert.
- Eksport: gjenbruk `privacyExportPublishedHtml()`-mønsteret (sjølvstendig HTML-fil) for eit nedlastbart Art. 30-dokument.

### Leverandør-/DPA-avtale-register med opplasting

**Anbefaling: ny, privat Storage-bucket i kontrollplan-prosjektet (`vibeverk-control`, ref `jxoglthrnshabqmdmnui`) — ikkje i noko enkelt-kunde-prosjekt.**

- Grunngjeving: DPA-dokument gjeld Vibeverk sitt EIGE forhold til Supabase/Vercel/Resend/Plausible — identisk for alle kundar, akkurat same logikk som gjer at `VIBEVERK_VENDORS` alt er ein delt konstant, ikkje per-tenant-data. Å lagre dette per kunde-prosjekt ville dupliserert same PDF overalt OG eksponert Vibeverk sine eigne avtalevilkår til feil RLS-rolle.
- Ny tabell `vendor_dpa_documents` (vendor_id, storage_path, uploaded_by, uploaded_at, note), RLS-gata med det eksisterande `is_control_plane_operator()`-mønsteret — **berre operatørar**, aldri kunde-admin, aldri kunde sjølv.
- DPA-status-pillen i Console → Leverandørar kan då lenke direkte til eit filnedlasta dokument i staden for berre fritekst-`dpaNote`.

### Foreslått fasering (ingen kode skrive enno)

1. **Fase A** — berre datamodell (`sc.privacy.activities{}`)
2. **Fase B** — ny "Behandlingsprotokoll"-fane i Console, gjenbruk av eksisterande merge/drift-maskineri
3. **Fase C** — kontrollplan-bucket + tabell for DPA-opplasting (einaste fasen som treng Security Auditor-gjennomgang per CLAUDE.md, sidan ho rører RLS/Storage)
4. **Fase D** — kryssvising: manglande DPA-dokument flagga direkte i Art. 30-registerets mottakarrader

Kvar fase er sjølvstendig leveleg, same "små, arkitekt-planlagde steg"-konvensjon som resten av personvern-arbeidet har følgt.

---

## Neste steg

Ingenting i dette dokumentet er bygd eller vedteke — det er berre kartlegginga brukaren bad om. Naturleg rekkjefølgje for vidare arbeid, ikkje bindande:

1. Dei tre billege/reine feila (punkt 3a/3b, punkt 17) kan rettast raskt utan ny arkitektur.
2. Punkt 9 (DPA-hedging som forsvinn mot kunden) og punkt 11-12 (chat-blokk/-samtykke) er innhaldsspørsmål, ikkje arkitektur — kan takast saman med revisjonslista i del 1.
3. Fase A/B (Art. 30) og Fase C (DPA-opplasting) er nye, avgrensa funksjonar — treng eksplisitt igangsetjing kvar for seg.
