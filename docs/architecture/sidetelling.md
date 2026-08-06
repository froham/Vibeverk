# Sidetelling / "Innsikt" — arkitektur

Intern, cookiefri trafikkmåling for den offentlege nettsida — eit gratis alternativ til Plausible for kundar som ikkje har eige Plausible-konto. `module-sidetelling.js` (offentleg side + Web-admin sin "Innsikt"-fane, tidlegare "Analyse"), styrt av eit Console-brytar-panel i `console/console-core.js`. Bygd i fleire rundar frå 2026-07-31 til 2026-08-03 — sjå `docs/project/CHANGELOG.md` (0.78.0–0.87.0) for full, datert historie. Dette dokumentet er ei samla arkitekturoversikt, ikkje ein endringslogg.

## Grunnprinsipp (Fase 2, stadfesta av brukar 2026-08-03, gjeld all vidare utvikling)

1. **Native/gratis** — ingen betalt ekstern teneste.
2. **Ingen API-kall** — ingen eksterne HTTP-kall i det heile, verken frå klient eller server.
3. **Cookiefritt** — session-ID lever i `sessionStorage`, forsvinn ved fane-lukking, aldri ein cookie eller anna varig klientside-identifikator.

Eit forslag som bryt eitt av desse prinsippa (t.d. geolokasjon, som krev anten eit eksternt API-kall eller lagring av IP-adresse) skal **ikkje** byggjast som ein del av denne fasen — sjå "Bevisst ikkje bygd" under.

## Datamodell

`analytics_events` (`supabase/migrations/20260731103651_add_analytics_events.sql`, utvida i `20260803140201_add_analytics_device_bot.sql`):

| Kolonne | Kva | Merknad |
|---|---|---|
| `session_id` | Gruppering av rader til same besøk | `sessionStorage`, ikkje ein unik nøkkel |
| `type` | `pageview` \| `cta` | |
| `path` | Hash-verdi ved hendinga | Sjå "Kva tel som ei visning" under |
| `referrer` | Kun vertsnamn | Aldri full URL/querystring |
| `cta_id` | `tel`\|`mailto`\|`kontakt`\|`tilbud`\|`booking` | |
| `device_type` | `mobil`\|`nettbrett`\|`pc` | Utleia klientsida frå skjermbreidde, IKKJE lagra rå User-Agent |
| `is_bot` | boolean | Enkel regex mot kjende bot-signaturar i User-Agent, ingen ekstern deteksjonsteneste |
| `is_test` | boolean | Syntetiske rader, kun frå `seed_test_pageviews()` (staging-only, sjå eige avsnitt) |

`leads`/`bookings` (`supabase/migrations/20260803142700_add_analytics_session_conversion.sql`): nullbar `analytics_session_id text`-kolonne på begge, ingen FOREIGN KEY (same laus-kopling-mønster som `leads.chat_id` — `analytics_events.session_id` er ein grupperingsnøkkel, ikkje unik, så ein ekte FK er ikkje mogleg). **FJERNA frå skrivesida 2026-08-06** (sjå "Ope juridisk spørsmål" under) — kolonna står att i skjemaet (ingen migrasjon køyrd for å droppe henne, berre klientkoden slutta å sende verdien, `DEFAULT NULL` i RPC-en gjer dette trygt), men vert aldri fylt ut for nye rader lenger.

**Personvernsprinsipp for `device_type`/`is_bot`**: begge er førehandsrekna, kategoriske felt — same mønster som `chat_conversations.browser/os` (`module-chat.js` sin `getBrowserInfo()`) alt bruker. Den rå User-Agent-strengen vert ALDRI lagra server-sida (ho er ein fingerprinting-vektor; ein kategorisk verdi som "mobil"/"pc" er det ikkje).

## Kva tel som ei "ny visning" (og kva som bevisst ikkje gjer det)

Vibeverk-nettsider er typisk éi lang side med seksjonar (Hjem, Om oss, Tenester osb.). Nav-klikk mellom desse er **mjuk scroll** internt i `core.js` sin `bindGlobalNav()` (`history.replaceState()`, utløyser ALDRI `hashchange`) — desse tel bevisst IKKJE som eigne visningar (stadfesta av brukar 2026-08-03).

`module-sidetelling.js` sin `isRealPage()` bruker ei eksplisitt allow-liste (`#booking`, `#aktuelt/alle`, `#sak/*`) i staden for å stole på om nettlesaren tilfeldigvis fell tilbake til ekte hash-navigering (eit reelt, funne og retta inkonsekvens-hòl — sjå 0.80.0-innslaget i CHANGELOG). **Vedlikehaldskopling**: ei ny `page:true`-modul (i dag berre `module-booking.js`) må leggjast til her óg, same kopling som `bindGlobalNav()` sjølv har.

Inngangs-/utgangssider krev ingen eigen fangst-hending — dei er berre fyrste/siste pageview-rad for ein sesjon, ei rein spørring i adminpanelet.

## Fasar

### Fase 1 (0.78.0, 2026-07-31)
Grunnmodul: pageview/CTA-fangst, `insert_analytics_event()` (SECURITY DEFINER, anon EXECUTE), admin-panel i eksisterande Analyse-fane i Web-admin. Køyrer kun når `analytics.plausible` er tom (kunden vel eitt av dei to).

### Console-brytar (0.79.0, 2026-08-03)
`features.sidetelling` av/på per tenant frå Console sin Modular-fane (merkelappen "Analyse" — internt namn/fil uendra, same mønster som Workspace/Intranett-omdøypinga). Fiksa samstundes ein latent `featureDefaults()`-polaritetsbug for opt-in-flagg.

### Panel-utviding (0.80.0, 2026-08-03)
"Oppdater"-knapp, lesbare sidenamn (`PATH_LABELS` + generisk fallback), konsekvent visningsteljing (`isRealPage()`, sjå over), konverteringsrate-KPI, CTA-klikk-per-dag-graf. Bokmål-standardisert kundevendt tekst.

### Fase 2 (0.81.0–0.84.0, 2026-08-03) — Arkitekt-konsultert samla før koding
1. **Steg 1**: `device_type`/`is_bot` (sjå datamodell over).
2. **Steg 2 — "Trender"**: rein periode-mot-periode-samanlikning (siste 7 dagar mot dei 7 før), same "rule-based, ingen AI"-filosofi som `computeWebsiteHealth()` (`docs/architecture/website-health-scoring.md`). Ingen ny spørring — samanlikningsvindauget (14 dagar) er innanfor dei 30 dagane panelet alt hentar. **Sjå Fase 3 under — dette faste 7-dagars-vindauget er sidan generalisert til å skalere med periodevalet.**
3. **Steg 3a**: `App.getAnalyticsSessionId()` i `core.js` — session-ID-generering flytta ut av `module-sidetelling.js` sjølv, sidan Kontakt-/Tilbod-/Booking-skjemaa fungerer heilt uavhengig av om `features.sidetelling` er på/av, og treng tilgang til same ID for steg 3b. Returnerer `null` når funksjonen er av.
4. **Steg 3b — konverteringskobling (FJERNA 2026-08-06)**: `leads`/`bookings.analytics_session_id`, kopla mot inngangsside i adminpanelet ("Henvendelser fra disse sidene"). Vart sidan erstatta med ein samla trakt (`.an-funnel` i `renderSiderPane()`) — og denne trakten sjølv er no fjerna att, saman med heile skrivesida av koplinga, etter beslutningsmøtet 2026-08-06 (sjå "Ope juridisk spørsmål" under). `App.getAnalyticsSessionId()` (steg 3a) står framleis att, brukt kun til sidetellinga sin eigen pageview-/CTA-sporing.

### Fase 3 — Innsikt-redesign (0.87.0, 2026-08-03)

Ein fullstendig omdesign av admin-panelet, driven av eit eksplisitt brukarønske om noko "vesentlig bedre og mer dashboard-aktig". Prosessen følgde same to-stegs mønster som tidlegare (Codex/Arkitekt-vurdering før koding), men denne gongen supplert med ein interaktiv HTML-mockup (fiktive tal) iterert saman med brukaren over fleire rundar før noko kode vart skriven — sjå samtalen 2026-08-03 for full historikk, inkludert ei UX/Mobil-gjennomgang og ei Arkitekt-gjennomgang av implementasjonsplanen (køyrekostnad, `MAX_ROWS`, periode-slicing) før koding starta.

**Eigen "Innsikt"-kategori i adminpanelet.** `ADMIN_CATEGORIES` (`core.js`) fekk ein ny fjerde kategori mellom "Henvendelser" og "Innstillinger": `Design | Innhold | Henvendelser | Innsikt | Innstillinger | Min konto`. "Analyse"-fana (intern id framleis `"analyse"`, kun *label* og *category* endra) flytta ut av "Innstillinger" til denne nye kategorien og fekk namnet "Innsikt". Halde admin-only (same tilgangsnivå "Analyse" hadde før, ikkje utvida til editor-rolla).

**Henvendelsestala er no ein alltid-synleg header, uavhengig av modulen.** "Denne måneden" og eit redesigna "Status (åpne/løst)" (opne-talet er no hovudtalet i kvart kort, med ei løyst-framdriftslinje og ei "X av Y løyst"-note, i staden for to likestilte tal) vert vist øvst i Innsikt-fana **uansett** om kunden har `features.sidetelling` eller ikkje -- dette var faktisk alt tilfelle før (aldri gata på sidetelling-flagget), berre no eksplisitt forklart som eit design-val i UI-en, ikkje ein tilfeldigheit.

**Periodevalg (7/30/90 dagar), overordna for heile dashboardet.** `module-sidetelling.js` hentar no alltid det maksimale vindauget (`MAX_LOOKBACK_DAYS = 90`, éin spørring, `MAX_ROWS` uendra på 5000) og filtrerer/aggregerer klientside per valt periode (`sliceRowsToPeriod()`) -- ingen ny spørring ved periodebyte, same "unngå ekstra spørring innanfor alt henta data"-mønster som Fase 2 sitt Trender-steg alt etablerte. "Trender" er generalisert frå den faste "siste 7 mot føregåande 7 dagar" til "andre halvdel av valt periode mot første halvdel" (`TREND_PERIOD_HALF = {7:3, 30:15, 90:45}`, ein fast oppslagstabell sidan periodane er eit lukka sett på tre val). 90-dagarsvisinga viser vekentlege søyler i staden for 90 tynne dagssøyler (`BUCKET_MODE`).

**Sub-faner i staden for éin lang scroll.** "Oversikt" (KPI-ar, Trender, dagsgrafar) / "Sider" (topplister, CTA-typar, henvendelsestrakt) / "Kilder & enheter" (henvisningar, einingsfordeling) -- eigne `.an-subtabs`/`.an-subtab`-klassar (IKKJE `C.tabbar()`/`.tab`, som ville kollidert med `test.js` sine top-nivå fane-spørringar og vore eit ARIA tablist-i-tablist-antimønster).

**Nye KPI-ar, gratis frå eksisterande gruppering:** avvisningsrate og sider per besøk, begge utleia frå `bySession`-grupperinga panelet alt bygde for inngangs-/utgangssider.

**Konverteringstopplista er erstatta med ein samla, tona-ned trakt.** "Henvendelser fra disse sidene" (per inngangsside) vart bytt ut med éin aggregert sidevisning → CTA-klikk → henvendelse-trakt. Framleis bevisst dempa (stipla kant, dempa farge, ikkje ein hovudmetrikk) -- konverteringskoplinga sitt opne juridiske spørsmål (sjå under) endra seg ikkje, berre presentasjonen.

**Ikkje-modul-fallback.** Har kunden ikkje `features.sidetelling` (og ingen Plausible), vert berre henvendelsestala vist, pluss ein kort, fristande tekst ("Med Innsikt kan du se sidevisninger, kilder, enheter og mer... Spør oss om oppgradering") -- same mønster som andre ukjøpte modular sin teaser (sjå `openManualModal()` i `core.js`).

**Vurdert og bevisst utsett i denne runda:** eit ukedag/tid-på-døgnet-varmekart vart faktisk bygd i mockup-forma og vist til brukaren, men trekt ut etter tilbakemelding ("ikke helt fornøyd med den") -- ikkje avvist på prinsipp, berre utsett til visualiseringa er betre gjennomtenkt. Sjå "Utsett, ikkje avvist" under.

**Retta etter Security Auditor + UX/Mobil-reviewer (same dag, før produksjon):** periodevalg-/sub-fane-knappane fekk `min-height:44px` (var under berøringsmål-minimumet), ein reell lekkasje der `bindPanel()` batt ein ny delegert klikk-lyttar for søyle-tooltipen for KVART "Oppdater"-klikk vart retta (`bindBarTooltips()` bunde éin gong per container, verna av eit flagg), søylene fekk `tabindex`/`role="img"`/`aria-label` + Enter/mellomrom-tastaturstøtte (var berre mus-/touch-tilgjengelege), sub-fanene fekk fullstendige ARIA-roller (`role="tab"`/`aria-selected`/`aria-controls`, matcha av `role="tabpanel"` på panela), `admin/index.html` sin `.an-heading` vart retta til same eyebrow-stil som `index.html` (var uskilt frå widget-titlane på denne PWA-flata), og einingsfordelinga fekk ei minimumsbreidde per segment. 12 nye test-assertions dekkjer sub-fane/periodevalg/tooltip-mekanismane. Sjå `docs/project/CHANGELOG.md` (0.87.0) for full liste.

## Ope juridisk spørsmål (må avklarast før nokon reell kunde, sjå ROADMAP.md)

**RETTA 2026-08-06 (Privacy and Compliance Advisor-pass, sjå `docs/compliance/`)**: denne seksjonen viste tidlegare til "ekomlova §3-1-typen argumentasjon" som det juridiske grunnlaget for at anonym, cookiefri trafikkmåling ikkje treng samtykke. Det var **feil paragraf og utdatert lov**:

- Den gamle cookie-heimelen, **ekomloven (2003) §2-7b**, er **oppheva** frå 1. januar 2025 (Lovdata, stadfesta 2026-08-06).
- Gjeldande heimel er **§3-15 i den nye ekomlova** (LOV-2024-12-13-76), i kraft frå same dato. Kjelde: [Lovdata](https://lovdata.no/lov/2024-12-13-76/§3-15) (sjekka 2026-08-06 av KI, ikkje eit menneske).

**Dette svekker grunnprinsipp 3 sitt "cookiefritt ⇒ treng ikkje samtykke"-argument monaleg meir enn tidlegare anteke:** §3-15 krev GDPR-gyldig samtykke for å lagre eller få tilgang til opplysningar i ein brukar sitt utstyr, **teknologinøytralt og uavhengig av om opplysninga er ein personopplysning** — regelen gjeld eksplisitt "lagring og tilgang til alle slags opplysninger", som dekker `sessionStorage` like mykje som ein tradisjonell cookie. Det finst berre to snevre unntak (rein overføring av kommunikasjon; eller "strengt nødvendig" for ei teneste brukaren sjølv uttrykkeleg har bede om). Datatilsynet si eiga cookie-rettleiing nemner **ikkje** noko generelt unntak for anonym/aggregert trafikkstatistikk (stadfesta 2026-08-06, ikkje berre anteke).

Konsekvens: dette er **ikkje lenger berre eit spørsmål om steg 3b (konverteringskoblinga)** — sjølve den grunnleggjande `session_id`-lagringa i `sessionStorage` (grunnprinsipp 3 over) kviler no på eit svakare juridisk fundament enn opphavleg lagt til grunn, uavhengig av at han er anonym. Den einaste plausible vegen til å drive sidetelling heilt utan samtykke er unntak b) ("strengt nødvendig… etter brukaren sin eigen uttrykkelege førespurnad") — om intern, cookiefri publikumsmåling kvalifiserer til det, er ei juridisk skjønnsvurdering kjeldene ikkje avgjer, og som **ikkje** er avklart enno.

For sesjonar som faktisk konverterer (steg 3b, sender eit skjema), kjem eit **andre, sjølvstendig** spørsmål i tillegg: koplinga skapar ein indirekte veg frå elles anonyme pageview-rader til ein namngjeven person (via lead/booking sine kontaktopplysningar) — dette er sitt eige GDPR-behandlingsgrunnlag-spørsmål, ikkje berre ein §3-15-variant. Eit spesifikt, uavhuka samtykke ved sjølve skjemainnsendinga kan vere ein plausibel veg til eit gyldig grunnlag for NETTOPP koplinga (sjå `docs/compliance/` sitt oppdaterte notat), men eit slikt samtykke kjem for seint til å dekkje §3-15-spørsmålet om sjølve `sessionStorage`-lagringa, som uansett skjer FØR nokon skjemainnsending. Dei to laga må ikkje blandast saman.

Ingen av desse spørsmåla kunne avgjerast av kodegjennomgang åleine — krevde kvalifisert vurdering. Sjå `docs/compliance/legal-complexity-vs-value-2026-08-06.md` for full kjeldegrunngjeving og verdi-vs-kompleksitet-vurderinga som låg til grunn for beslutningane under.

**Beslutningsmøte 2026-08-06 — begge spørsmåla avgjorde (sjå `docs/compliance/legal-complexity-vs-value-2026-08-06.md` del 5 for full grunngjeving):**
1. **Konverteringskoblinga (steg 3b) er FJERNA i kode** — `core.js` sin `addLead()`/`module-booking.js` sin booking-innsending sluttar å sende `p_analytics_session_id`, og `module-sidetelling.js` sin `.an-funnel`-trakt (som viste koplinga) er fjerna att saman med henne. Opning for å byggje ein ordentleg, juridisk gjennomtenkt versjon seinare som eiga, bevisst funksjon.
2. **Sjølve `sessionStorage`-lagringa (grunnprinsipp 3) er pausa for reelle kundar** (held fram for Vibeverk sjølv/Sunnvask-demo). Langsiktig plan: byt mekanismen ut med ein server-side, dagleg-roterande salta hash av IP+User-Agent (stadfesta 2026-08-06 at dette er nøyaktig metoden Plausible sjølv nyttar, `plausible.io/data-policy`: "We do not use cookies, browser cache or local storage") — fjernar heile §3-15-spørsmålet strukturelt i staden for å stole på eit usikkert unntak eller bryte "ingen banner"-prinsippet. **Ikkje bygd enno**, eit framtidig prosjekt.

**Verifisert trygt i implementasjonen sjølv (historisk, gjeld dei gamle radene)**: `analytics_session_id` var bevisst haldt utanfor `dbLeadToJs`/`dbBookingToJs` sine kvitelister — vart ALDRI vist i Web-admin sitt UI, CSV- eller JSON-eksport. GDPR-sletting av ein lead/booking slettar heile rada, inkludert kolonna, automatisk. Kolonna finst framleis i skjemaet (ingen migrasjon køyrd), men vert ikkje lenger fylt ut for nye rader.

## Bevisst ikkje bygd (bryt eitt av dei tre grunnprinsippa, eller vurdert og avvist av andre grunnar)

- **Geolokasjon**: krev anten eit eksternt API-kall eller lagring av IP-adresse — bryt prinsipp 2 (og den eksisterande "vi lagrar ikkje IP"-lovnaden) uansett vinkling. Målgruppa (lokale SMB-kundar) har heller ikkje eit reelt behov.
- **Workspace-analyse**: anna bruksområde (intern bruksstatistikk for tilsette), ikkje prioritert.
- **Seksjon/skrolldjupne ved avreise**: vurdert og avvist 2026-08-03 — krev anten mange fleire skriv per visning eller ein sendBeacon/pagehide-mekanisme (alt forkasta éin gong i Fase 1 av kostnad/nytte-grunnar), og nøyaktigheita er tvilsam på tvers av skjermstorleikar.
- **"AI-oppsummering"**: bygd som rule-based "Trendar" i staden (sjå Fase 2 steg 2) — ingen ekte AI/eksternt kall, i tråd med prinsipp 2.
- **"Fase 2.5" — unike besøkjande**: vurdert grundig 2026-08-03 (uavhengig teknisk forslag frå Codex, deretter kritisk gjennomgått av Vibeverk-arkitekten -- same to-stegs mønster som Nettsidehelse-modulen sitt opphav) og **avvist, ikkje berre utsett**. Konklusjon frå begge: teknisk mogleg innanfor dei tre prinsippa (ei privat, aggregert HyperLogLog-skisse, ingen rå IP/UA/besøks-ID lagra), men **uforholdsmessig komplisert for verdien han faktisk gjev Vibeverk sine kundar**. To vesentlege funn:
  1. Det tidlegare forslaget i denne fila (Postgres sin `inet_client_addr()` + dagleg salta hash) var **stadfesta feil** -- i Supabase/PostgREST-arkitekturen returnerer den funksjonen IP-en til PostgREST/pooler-laget, ikkje den besøkjande sin eigen IP. Rett mønster ville vore `current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'`, men det spørsmålet vart aldri forfølgt vidare -- sjå punkt 2.
  2. Sjølve verdien av "unike besøkjande" er tvilsam for Vibeverk sine faktiske kundar (små norske SMB-ar, typisk få hundre besøk/månad): identitets-proxy-feilen (kontor-/skule-/CGNAT-nettverk kan gje opptil 99 % undertelling for ei gruppe, éin person på fleire nettverk kan gje opptil 400 % overtelling) er langt større enn sjølve HLL-algoritmens presisjon (~1,6 %), og kompleksiteten (eigen HLL-implementasjon i rein PL/pgSQL -- Supabase har inga ferdig utviding -- nøkkelrotasjon, `pg_cron`-oppryddingsjobbar, Vault-nøkkelhandtering, ny rapport-RPC) er eit stort steg opp frå resten av kodebasen sin bevisst enkle stil, for eit tal som uansett ville vore eit usikkert estimat, ikkje eit fasitsvar.

  Det enklare alternativet (ein stabil HMAC-signatur i ein privat token-tabell, ~35 dagars levetid) vart òg vurdert og avvist -- det er reelt sett ein server-side cookie-erstattar, og ville undergrave sjølve produktposisjoneringa ("cookiefritt, ingen varig identifikator") som står ordrett i personvernsteksten (`computeDefaultPrivacyText()`, `core.js`).

  **Produktavgjerd (brukar, 2026-08-03)**: Vibeverk sin eigen sidetellingsmodul held fram bevisst enkel og ærleg -- kundar som treng ekte unike-besøkjande-tal (eller anna avansert analyse) vert tilviste til Plausible (alt støtta som eit "premium"/ekstern alternativ, sjå `analytics.plausible`-feltet) eller Google Analytics, i staden for at Vibeverk byggjer ein eigen, kompleks og usikker versjon av same ting. Om reelt høgvolum-behov skulle dukke opp igjen seinare, er HLL framleis den einaste av dei to vurderte tilnærmingane verdt å ta opp att -- men berre med ei ekte Postgres HLL-utviding, ikkje ein eigenskriven algoritme.

  Full avgjerd med grunngjeving: `docs/decisions/ADR-0013-unique-visitors-rejected.md`.

## Utsett, ikkje avvist

- **Rollup-tabell** (reint teknisk optimalisering, ingen prinsipp-konflikt, berre ikkje urgent med dagens datamengde), **CMS-per-side-widget** (ingen ny datainnsamling, berre ei anna visning av data som alt finst).
- **Ukedag/tid-på-døgnet-varmekart**: bygd i mockup-form og vist til brukaren i Innsikt-redesignrunden (Fase 3, 2026-08-03), men trekt ut etter tilbakemelding ("ikke helt fornøyd med den"). Ikkje eit prinsipp-problem (dagen ligg alt i `created_at`) -- berre visualiseringa som ikkje trefte enno. God kandidat for ei seinare, isolert forbedring med ein annan visuell approach, ikkje eit avvist konsept.

## `seed_test_pageviews()` — kjent, ikkje-fungerande mekanisme

Den staging-only testdata-generatoren (`supabase/staging-only/seed_test_pageviews.sql`) har eit fail-closed-gjerde via ein eigendefinert Postgres-GUC (`app.settings.is_staging`). Stadfesta 2026-08-03: denne GUC-en **kan ikkje settast på noko Supabase-hosta prosjekt** — krev superbrukar-rettar Supabase aldri gjev ut (`ALTER DATABASE`/`ALTER ROLE ... SET` for ein eigendefinert parameter krev superuser i vanleg PostgreSQL). Knappen har difor truleg aldri fungert, uansett prosjekt. Sjå `docs/roadmap/ROADMAP.md` "Later" for skisse til fiks (byt GUC-sjekken ut med ein rad i `store`-tabellen i staden).
