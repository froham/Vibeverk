# Juridisk kompleksitet vs. verdi — vurderingsgrunnlag før vidare bygging (2026-08-06)

> Utarbeidd av Privacy and Compliance Advisor (Claude) og Vibeverk Architect (Claude), 2026-08-06, etter oppdrag frå brukaren om å videreutvikle Console sin personvern-handtering til eit heilskapleg system. **Dette er ikkje juridisk godkjenning** — sjå `docs/compliance/README.md`. Formålet med dette dokumentet er å gi eit konkret grunnlag for eit internt beslutningsmøte FØR bygginga startar: for kvart punkt som er juridisk krevande å avklare, bør ein bevisst vurdere om verdien i det store biletet faktisk forsvarar kompleksiteten — eller om det er enklare (og betre) å forenkle/fjerne funksjonaliteten i staden for å byggje avansert samtykke-/dokumentasjonsinfrastruktur rundt henne.

Full kjeldegrunngjeving (Datatilsynet, Lovdata, leverandørdokumentasjon) ligg i sjølve agent-rapportane frå denne økta og er delvis innarbeidd i `data-map-vibeverk.md` og `docs/architecture/sidetelling.md`. Dette dokumentet samlar konklusjonane i eitt oversynleg beslutningsgrunnlag.

---

## 1. Vurderingstabell

| # | Punkt | Juridisk kompleksitet | Verdi i det store biletet | Tilråding |
|---|---|---|---|---|
| 1 | Sidetelling — sjølve `sessionStorage`-lagringa (grunnleggjande trafikkmåling) | **Høg** — §3-15 (ny ekomlov) krev truleg samtykke uansett anonymitet, med berre eit smalt "strengt nødvendig"-unntak som er usikkert om passar | Middels — eit gratis Plausible-alternativ for kundar utan eige analyseverktøy, ikkje ein kjernefunksjon i produktet | **Vurder om unntaket faktisk kan forsvarast juridisk FØR meir vert bygd; om ikkje, vurder eit enkelt samtykke-banner (bryt "cookiefritt"-prinsippet, men løyser problemet) eller å leggje funksjonen heilt på is** |
| 2 | Sidetelling — konverteringskobling (sesjon → namngjeven lead/booking) | **Høg** — eige, sjølvstendig GDPR-grunnlagsspørsmål utover §3-15 | **Låg-middels** — alt bevisst dempa i UI (stipla trakt, ikkje ein hovudmetrikk), ikkje noko kundane har etterspurt | **Sterk kandidat for å fjernast eller gjerast fullstendig opt-in per kunde** — verdien står ikkje i forhold til den juridiske eksponeringa |
| 3 | Automatisk retensjon/sletting per datatype | Låg-middels — mest eit byggjearbeid, ikkje eit ope rettsspørsmål | **Høg** — lagringstid er eit påkravd element i sjølve informasjonsplikta, og det finst i dag ingen automatikk i det heile | **Bygg** — dette er infrastruktur som må finnast uansett kva som skjer med punkt 1/2 |
| 4 | Anthropic som femte tredjepart (Oversikt/Smart årshjul) | Middels — treng eiga DPA-/underdatabehandlar-vurdering, US-basert leverandør | **Høg** — kjernefunksjonalitet i to Workspace-modular, ikkje noko som lett kan fjernast utan å fjerne modulane sjølve | **Behold, ta med til jurist** — hent Anthropic sin DPA/underdatabehandlarliste, informer brukarane om at fritekst kan sendast til ein US-leverandør |
| 5 | Rett behandlingsgrunnlag per skjematype (kontakt/tilbod/booking/nyheitsbrev) | Middels — krev separat vurdering per skjema, ikkje eitt felles svar | Høg — gjeld alle kundar, alle skjema | **Bygg strukturen** (per-skjema `legalBasis`-felt i datamodellen), **la juristen fylle inn riktige verdiar** |
| 6 | Ansattdata i Workspace (`users`, `tasks`, `notes` m.m.) | Låg — velkjent grunnlag (arbeidsforhold/legitim interesse) | Høg — må uansett dokumenterast for Vibeverk sjølv som arbeidsgjevar | **Bygg, bruk standardformulering** |
| 7 | Domeneshop si rolle per kunde (domene/DNS vs. webhotell/e-post) | Låg — reint eit spørsmål om faktisk konfigurasjon | Middels | **Bygg som eit konfigurasjonsval i leverandørregisteret** (avheng av kunde), ikkje ein fast påstand |
| 8 | Supabase-region per kunde-prosjekt | Låg — reint eit oppslag, ikkje eit rettsspørsmål | Høg — påkravd informasjon i personvernerklæringa | **Bygg som eit felt Vibeverk fyller inn per kunde-onboarding**, ikkje noko som kan hardkodast globalt |

---

## 2. Konkret tilråding om sidetelling (punkt 1 og 2)

Dette er det klart mest kritiske punktet, og det som mest openbert kvalifiserer for "er dette verdt kompleksiteten"-vurderinga brukaren bad om:

- **Steg 3b (konverteringskoblinga) bør etter alt å døme fjernast eller gjerast eksplisitt opt-in per kunde**, uavhengig av kva som skjer med resten av sidetellinga. Ho er allereie bevisst dempa i UI-et (ikkje ein hovudmetrikk), og verdien ho gir står ikkje i forhold til at ho skapar eit eige, sjølvstendig GDPR-spørsmål. Å fjerne henne krev truleg berre å ikkje skrive `analytics_session_id` ved skjemainnsending — ei lita kodeendring samanlikna med å byggje eit fullverdig samtykkesystem rundt henne.
- **Sjølve grunnfunksjonen (anonym sesjonsteljing) er vanskelegare** — han er meir sentral i produktverdien (eit gratis Plausible-alternativ), men §3-15-spørsmålet gjeld han direkte, ikkje berre koblinga. Tre reelle vegar finst:
  1. Få juridisk stadfesta at "strengt nødvendig for tenesta brukaren sjølv bad om" faktisk dekker denne bruken (usikkert, kjeldene avgjer det ikkje).
  2. Leggje til eit enkelt samtykke-steg (banner/knapp) før første `sessionStorage`-skriving — løyser §3-15, men bryt det uttalte "cookiefritt, ingen banner"-prinsippet produktet er bygd rundt (`docs/architecture/sidetelling.md` grunnprinsipp 3).
  3. Leggje funksjonen heilt på is for reelle kundar til spørsmålet er avklart, og i staden vise til Plausible (som allereie er det anbefalte alternativet for kundar som treng ekte unike-besøkjande-tal, jf. ADR-0013).

**Dette er ikkje ei avgjerd Claude kan ta åleine** — det er nøyaktig den typen produktavveging brukaren sjølv bad om å få presentert eksplisitt. Tilrådinga er å ta stilling til punkt 1 og 2 i eit eige beslutningsmøte før noko personvern-system vert bygd rundt sidetelling i det heile, sidan svaret her direkte påverkar kor mykje av samtykke-infrastrukturen (fase 2 i Arkitekt-planen) som faktisk trengst.

---

## 3. Spørsmål til jurist (konsolidert, prioritert)

**Kritisk, blokkerer sidetelling for reelle kundar:**
1. Kan cookiefri, sessionStorage-basert publikumsmåling drivast utan samtykke under ekomlova (LOV-2024-12-13-76) §3-15 sitt unntak b) "strengt nødvendig … etter brukarens uttrykkelege førespurnad"? Eller krev sjølve lagringa eit eige samtykke-steg før første skriving?
2. Dersom konverteringskoblinga (sesjon → namngjeven lead/booking) skal behaldast i noka form: er eit spesifikt, uavhuka samtykke ved skjemainnsending eit tilstrekkeleg og gyldig GDPR-grunnlag for nettopp den koblinga?

**Høg prioritet, gjeld alle kundar:**
3. Kva behandlingsgrunnlag er rett for eit vanleg kontakt-/tilbods-/bookingskjema — avtale/før-avtale, eller legitim interesse (med dokumentert interesseavveging)? Datatilsynet si eiga rettleiing peikar mot avtale/før-avtale framfor samtykke for denne typen skjema, men den endelege vurderinga må gjerast per skjema/felt.
4. Skal ei "eg har lest personvernerklæringa"-avkryssing brukast i det heile, gitt at informasjonsplikta er oppfylt ved å GI informasjonen tilgjengeleg, ikkje ved å krevje ei kvittering?
5. Er Anthropic akseptabelt som databehandlar for Oversikt/Smart årshjul (US-basert, DPA/underdatabehandlarliste ikkje henta enno), og kva må brukarane informerast om?

**Middels prioritet, må dokumenterast men er mindre juridisk usikkert:**
6. Kva retensjonstider bør setjast per datatype (chat, CRM, leads, bookingar, tilsettdata) — det finst ingen automatisk sletting i dag, alt er reint driftsavgjerder.
7. Rolla mellom kunde (behandlingsansvarleg) og Vibeverk (databehandlar) per funksjon, og Vibeverk sitt eige, sjølvstendige behandlingsansvar for eigne avtale-/faktura-/kontaktopplysningar — må stemme overeins med den faktiske kundeavtalen.
8. Rettsleg grunnlag for tilsettdata i Workspace (venteleg arbeidsforhold/legitim interesse, men bør stadfestast eksplisitt).

**Låg prioritet, meir eit avklaringsspørsmål enn eit rettsspørsmål:**
9. Er DPA-ane med Supabase/Vercel/Resend/Anthropic faktisk i kraft (ikkje berre tilbodne) for Vibeverk sine eigne kontoar? (Sjå `data-map-vibeverk.md` punkt 4a — allereie delvis avklart for Supabase/Vercel/Resend, ikkje for Anthropic.)

---

## 4. Korleis dette dokumentet skal brukast vidare

- Går til beslutningsmøtet brukaren bad om (sjå denne økta sin samtale). Konklusjonen frå møtet (behald/forenkle/fjern per punkt i tabellen over) bør skrivast inn her som eit eige avsnitt, datert, før byggjearbeidet på Console-systemet (Arkitekt-fasane) startar.
- Når byggjearbeidet startar, scopa fase 2 (samtykke-revisjonsspor) til det som faktisk overlever beslutningsmøtet — ikkje bygg samtykkelogging for noko som vert bestemt fjerna.
- Spørsmåla i del 3 er det som faktisk skal sendast til ein kvalifisert juridisk rådgivar — i prioritert rekkjefølgje, ikkje alle på éin gong nødvendigvis.

---

*Ingen personvernerklærings-tekst er utforma i dette dokumentet. Ikkje juridisk godkjenning eller samsvarsgaranti.*
