# Sidetelling / "Innsikt" — arkitektur

Intern, cookiefri trafikkmåling for den offentlege nettsida — eit gratis alternativ til Plausible for kundar som ikkje har eige Plausible-konto. `module-sidetelling.js` (offentleg side + Web-admin sin "Innsikt"-fane, tidlegare "Analyse"), styrt av eit Console-brytar-panel i `console/console-core.js`. Bygd i fleire rundar frå 2026-07-31 til 2026-08-06 — sjå `docs/project/CHANGELOG.md` (0.78.0–0.87.0 og 0.106.0) for full, datert historie. Dette dokumentet er ei samla arkitekturoversikt, ikkje ein endringslogg.

## Grunnprinsipp (Fase 2, stadfesta av brukar 2026-08-03, gjeld all vidare utvikling)

1. **Native/gratis** — ingen betalt ekstern teneste.
2. **Ingen API-kall** — ingen eksterne HTTP-kall i det heile, verken frå klient eller server.
3. **Ingen nettlesarlagring for sidetelling** — ingen cookie, browser-cache, `localStorage` eller `sessionStorage`. Klienten sender ingen sesjons-ID. Grupperingskoden vert rekna heilt server-side på kvar hending og endrar seg automatisk kvar UTC-dag.

Eit forslag som bryt eitt av desse prinsippa (t.d. geolokasjon, som krev anten eit eksternt API-kall eller lagring av IP-adresse) skal **ikkje** byggjast som ein del av denne fasen — sjå "Bevisst ikkje bygd" under.

## Datamodell

`analytics_events` (`supabase/migrations/20260731103651_add_analytics_events.sql`, utvida i `20260803140201_add_analytics_device_bot.sql`; skrivemekanismen bygd om i `20260806170936_server_side_daily_analytics_hash.sql`):

| Kolonne | Kva | Merknad |
|---|---|---|
| `session_id` | Gruppering av rader innan same UTC-dag | 64-teikns SHA-256 rekna i `sidetelling-event` av versjon + UTC-dag + nettstadsdomene + request-IP + User-Agent. Historiske rader har den gamle klient-ID-en. Ikkje ein unik-besøkjande-KPI. |
| `type` | `pageview` \| `cta` | |
| `path` | Hash-verdi ved hendinga | Sjå "Kva tel som ei visning" under |
| `referrer` | Kun vertsnamn | Aldri full URL/querystring |
| `cta_id` | `tel`\|`mailto`\|`kontakt`\|`tilbud`\|`booking` | |
| `device_type` | `mobil`\|`nettbrett`\|`pc` | Utleia klientsida frå skjermbreidde, IKKJE lagra rå User-Agent |
| `is_bot` | boolean | Enkel regex mot kjende bot-signaturar i User-Agent, ingen ekstern deteksjonsteneste |
| `is_test` | boolean | Syntetiske rader, kun frå `seed_test_pageviews()` (staging-only, sjå eige avsnitt) |

`leads`/`bookings` (`supabase/migrations/20260803142700_add_analytics_session_conversion.sql`): nullbar `analytics_session_id text`-kolonne på begge, ingen FOREIGN KEY (same laus-kopling-mønster som `leads.chat_id` — `analytics_events.session_id` er ein grupperingsnøkkel, ikkje unik, så ein ekte FK er ikkje mogleg). **FJERNA frå skrivesida 2026-08-06** (sjå "Juridisk historikk og teknisk avgjerd" under) — kolonna står att i skjemaet (ingen migrasjon køyrd for å droppe henne, berre klientkoden slutta å sende verdien, `DEFAULT NULL` i RPC-en gjer dette trygt), men vert aldri fylt ut for nye rader lenger.

**Personvernsprinsipp for `device_type`/`is_bot`**: begge er førehandsrekna, kategoriske felt — same mønster som `chat_conversations.browser/os` (`module-chat.js` sin `getBrowserInfo()`) alt bruker. User-Agent-headeren vert brukt mellombels som hash-input i Edge Function-en, men den rå strengen vert ALDRI send vidare til eller lagra i `analytics_events` (ho er ein fingerprinting-vektor; ein kategorisk verdi som "mobil"/"pc" er det ikkje). Det same gjeld rå IP og Origin. Supabase-infrastrukturen kan ha eigne request-loggar; påstanden gjeld Vibeverk si funksjonskode/hendingstabell.

## Server-side dagsgruppering (0.106.0, 2026-08-06)

`module-sidetelling.js` sender berre sjølve hendinga (`type`, `path`, avgrensa referrer, CTA-type, einingskategori og bot-flagg). Modulen og `core.js` har ingen analyse-ID og les/skriv aldri cookie, `localStorage` eller `sessionStorage` for denne grupperinga.

Klienten kallar den interne Supabase Edge Function-en `sidetelling-event` med hendingsfelta via direkte `window.fetch`, den offentlege anon-JWT-en frå `SITE_CONFIG`, `credentials: "omit"` og `cache: "no-store"`. Han brukar medvite ikkje Supabase SDK-en sin auth-medvitne `functions.invoke()`-veg, fordi den les den persisterte auth-sesjonen frå nettlesarlagring før funksjonskallet. Dette legg ikkje til nokon CDN-/tredjepartsavhengigheit. Edge-funksjonen les Origin (Referer som reserve), berre fyrste `x-forwarded-for`-hop dersom han er gyldig (`cf-connecting-ip`/`x-real-ip` som reservar), og User-Agent frå requesten. IP-kandidatane vert syntaktisk validerte og normaliserte; manglar gyldig IP, UA eller site, vert hendinga avvist i staden for å lage ei felles «ukjend»-gruppe. **Headerrekkjefølgja er empirisk stadfesta trygg (2026-08-07)** — sjå eige avsnitt under. Origin er hashinput, aldri autorisasjon. Funksjonen reknar:

`SHA-256(["vibeverk-sidetelling-v1", UTC-dato, normalisert domene, IP, trim(User-Agent)[0:1000]])`

Berre hex-hashen + hendinga går vidare til `insert_analytics_event_service()`. Denne skrivande RPC-en er `SECURITY DEFINER VOLATILE SET search_path=public`, men er **ikkje anon-vend**: `PUBLIC`/`anon`/`authenticated` er eksplisitt revoka, og berre Edge sitt `service_role` får `EXECUTE`. Dette løyser repo-regelen om at anon-vende RPC-ar skal vere `STABLE`; browseren får aldri direkte skrivefunksjonstilgang. `verify_jwt=true` er eksplisitt sett for Edge-endepunktet.

UTC-datoen fungerer som ei deterministisk dagsverdi; ho vert ikkje lagra i ei salttabell, og det finst ingen nøkkel-/tokenrotasjon, Vault-secret eller HLL. Ressursvernet har tre nivå: eit tak på 200 hendingar per dagsgruppe (dags-hash), eit tak på 60 hendingar per UTC-minutt (`analytics_event_minute_quota`, berre minutt-bøtte + tal), og eit globalt tak på 10 000 hendingar per installasjon/dag (`analytics_event_daily_quota`, berre dato + tal) — ingen av dei to kvotetabellane inneheld IP, UA, hash eller besøksidentitet. **Minutt-taket er ei direkte retting av eit Security Auditor-funn (2026-08-06, HIGH)**: utan det kunne eit skript som kalla Edge-endepunktet direkte (ingen nettlesar, ingen CORS-vern) med mange ulike forfalska `X-Forwarded-For`-verdiar generert nok ulike dags-hashar til å tømme HEILE dagsbudsjettet på nokre få sekund, sidan kvar forfalska hash har sin eigen separate 200-grense. Minutt-taket gjer at eit slikt skript stoppar etter 60 forsøk det fyrste minuttet, uavhengig av kor mange ulike hash-ar det klarer å generere — ekte trafikk for ein vanleg kundenettstad spreier seg naturleg utover dagen og råkar aldri denne grensa. Nådd tak vert handtert stille; det vernar lagringsvekst/statistikk mot enkel flooding, men erstattar ikkje plattform-/WAF-vern mot volum-DoS. Headerrekkjefølgja er no empirisk stadfesta (sjå eige avsnitt under) — minutt-taket står likevel ved lag som forsvar i djupna mot ei ANNA trusselklasse (ekte, distribuerte IP-ar i eit reelt volum-åtak), ikkje fordi header-spoofing via desse tre faktisk synte seg mogleg.

### Empirisk stadfesta: header-tillit (2026-08-07)

Før noko vart deploya til produksjon vart det verifisert direkte mot vibeverk-staging, via eit mellombels, throwaway diagnostikk-endepunkt (ekkoa rå request-headerar attende, sletta att same dag) at Cloudflare-edgen framfor Supabase faktisk gjer det Security Auditor sitt HIGH-funn (sjå CHANGELOG 2026-08-06) uttrykkeleg bad om å stadfeste FØR ein stolar på det:

- `x-forwarded-for` vert HEILT OMSKRIVE til den ekte proxy-kjeda av Cloudflare/Supabase sjølve — eit forfalska klient-verdi (testa med `X-Forwarded-For: 1.2.3.4`) vart aldri bevart, korkje som fyrste eller seinare ledd.
- `cf-connecting-ip` er ikkje reelt klient-forfalskbar i det heile: eit forsøk på å setje han sjølv (`CF-Connecting-IP: 9.10.11.12`) resulterte i at HEILE requesten vart avvist av Cloudflare (`403`, Cloudflare-feilkode 1000) -- ikkje berre ignorert, aktivt blokkert.
- `x-real-ip` vert strippa heilt vekk uansett kva klienten sender.

Konklusjon: den opphavlege koden sin trust-modell (fyrste gyldige av `x-forwarded-for`/`cf-connecting-ip`/`x-real-ip`) var faktisk trygg heile tida på denne infrastrukturen -- Security Auditor sitt HIGH-funn var ei korrekt, forsiktig føre-var-vurdering (ingen kode-nivå garanti fanst FØR verifiseringa vart gjort), ikkje ein reell, utnytta sårbarheit. Minutt-kvota vart bygd og vert verande som eit uavhengig, framleis nyttig forsvar mot eit anna scenario (eit ekte volum-åtak frå mange faktiske IP-ar), ikkje fordi header-spoofing synte seg vere den faktiske trusselen.

Den gamle sju-parameter-RPC-en står mellombels att for database-fyrst-utrulling som ein `STABLE` kompatibilitets-no-op. Gamle cachelagra klientar får ikkje PostgREST-feil, men den innkomande klient-ID-en og hendinga vert kasta; ny klient kallar berre Edge. Gamle opne faner kan framleis røre den gamle `sessionStorage`-nøkkelen fram til reload, så ekte kundar skal vere pausa gjennom utrullings-/cachevindauget. No-op-en kan droppast seinare.

**Semantisk avgrensing:** hashen er ei dagleg pseudonym gruppe, ikkje ei presis faneøkt. Fleire besøk frå same IP+User-Agent same dag kan bli slått saman; fleire personar på same nettverk med lik User-Agent kan òg bli slått saman; eit besøk over UTC-midnatt vert delt. Avvisningsrate, sider per besøk og inn-/utgangssider er difor merkte som daglege anslag i UI-et. Dette byggjer ikkje den avviste HLL-/tokenbaserte "unike besøkjande"-funksjonen frå ADR-0013.

Datoen er heller ikkje ein hemmeleg kryptografisk salt: målretta gjenutrekning er prinsipielt mogleg for nokon som kjenner dato, domene og kan gjette IP/UA. Å hindre det ville kravd ein persistert hemmeleg HMAC-nøkkel, som er utanfor og i konflikt med den eksplisitt valde løysinga utan nøkkelpersistens. Hashen skal difor omtalast som pseudonym, ikkje anonym eller irreversibel. Supabase sitt infrastrukturlag kan dessutan ha eigne request-loggar; påstanden er avgrensa til at rå IP/UA ikkje vert lagra i Vibeverk si `analytics_events`-rad.

## Kva tel som ei "ny visning" (og kva som bevisst ikkje gjer det)

Vibeverk-nettsider er typisk éi lang side med seksjonar (Hjem, Om oss, Tenester osb.). Nav-klikk mellom desse er **mjuk scroll** internt i `core.js` sin `bindGlobalNav()` (`history.replaceState()`, utløyser ALDRI `hashchange`) — desse tel bevisst IKKJE som eigne visningar (stadfesta av brukar 2026-08-03).

`module-sidetelling.js` sin `isRealPage()` bruker ei eksplisitt allow-liste (`#booking`, `#aktuelt/alle`, `#sak/*`) i staden for å stole på om nettlesaren tilfeldigvis fell tilbake til ekte hash-navigering (eit reelt, funne og retta inkonsekvens-hòl — sjå 0.80.0-innslaget i CHANGELOG). **Vedlikehaldskopling**: ei ny `page:true`-modul (i dag berre `module-booking.js`) må leggjast til her óg, same kopling som `bindGlobalNav()` sjølv har.

Inngangs-/utgangssider krev ingen eigen fangst-hending — dei er berre fyrste/siste pageview-rad for ei dagsgruppe, ei rein spørring i adminpanelet.

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
3. **Steg 3a (historisk, FJERNA 2026-08-06)**: `App.getAnalyticsSessionId()` i `core.js` samla den gamle `sessionStorage`-ID-en. Heile funksjonen og nøkkelen er no fjerna; Edge Function-en lagar dagsgruppa server-side.
4. **Steg 3b — konverteringskobling (FJERNA 2026-08-06)**: `leads`/`bookings.analytics_session_id`, kopla mot inngangsside i adminpanelet ("Henvendelser fra disse sidene"). Vart sidan erstatta med ein samla trakt (`.an-funnel` i `renderSiderPane()`) — og denne trakten sjølv er no fjerna att saman med heile skrivesida av koplinga, etter beslutningsmøtet 2026-08-06 (sjå den juridiske historikken under).

### Fase 3 — Innsikt-redesign (0.87.0, 2026-08-03)

Ein fullstendig omdesign av admin-panelet, driven av eit eksplisitt brukarønske om noko "vesentlig bedre og mer dashboard-aktig". Prosessen følgde same to-stegs mønster som tidlegare (Codex/Arkitekt-vurdering før koding), men denne gongen supplert med ein interaktiv HTML-mockup (fiktive tal) iterert saman med brukaren over fleire rundar før noko kode vart skriven — sjå samtalen 2026-08-03 for full historikk, inkludert ei UX/Mobil-gjennomgang og ei Arkitekt-gjennomgang av implementasjonsplanen (køyrekostnad, `MAX_ROWS`, periode-slicing) før koding starta.

**Eigen "Innsikt"-kategori i adminpanelet.** `ADMIN_CATEGORIES` (`core.js`) fekk ein ny fjerde kategori mellom "Henvendelser" og "Innstillinger": `Design | Innhold | Henvendelser | Innsikt | Innstillinger | Min konto`. "Analyse"-fana (intern id framleis `"analyse"`, kun *label* og *category* endra) flytta ut av "Innstillinger" til denne nye kategorien og fekk namnet "Innsikt". Halde admin-only (same tilgangsnivå "Analyse" hadde før, ikkje utvida til editor-rolla).

**Henvendelsestala er no ein alltid-synleg header, uavhengig av modulen.** "Denne måneden" og eit redesigna "Status (åpne/løst)" (opne-talet er no hovudtalet i kvart kort, med ei løyst-framdriftslinje og ei "X av Y løyst"-note, i staden for to likestilte tal) vert vist øvst i Innsikt-fana **uansett** om kunden har `features.sidetelling` eller ikkje -- dette var faktisk alt tilfelle før (aldri gata på sidetelling-flagget), berre no eksplisitt forklart som eit design-val i UI-en, ikkje ein tilfeldigheit.

**Periodevalg (7/30/90 dagar), overordna for heile dashboardet.** `module-sidetelling.js` hentar no alltid det maksimale vindauget (`MAX_LOOKBACK_DAYS = 90`, éin spørring, `MAX_ROWS` uendra på 5000) og filtrerer/aggregerer klientside per valt periode (`sliceRowsToPeriod()`) -- ingen ny spørring ved periodebyte, same "unngå ekstra spørring innanfor alt henta data"-mønster som Fase 2 sitt Trender-steg alt etablerte. "Trender" er generalisert frå den faste "siste 7 mot føregåande 7 dagar" til "andre halvdel av valt periode mot første halvdel" (`TREND_PERIOD_HALF = {7:3, 30:15, 90:45}`, ein fast oppslagstabell sidan periodane er eit lukka sett på tre val). 90-dagarsvisinga viser vekentlege søyler i staden for 90 tynne dagssøyler (`BUCKET_MODE`).

**Sub-faner i staden for éin lang scroll.** "Oversikt" (KPI-ar, Trender, dagsgrafar) / "Sider" (topplister og CTA-typar) / "Kilder & enheter" (henvisningar, einingsfordeling) -- eigne `.an-subtabs`/`.an-subtab`-klassar (IKKJE `C.tabbar()`/`.tab`, som ville kollidert med `test.js` sine top-nivå fane-spørringar og vore eit ARIA tablist-i-tablist-antimønster).

**Nye KPI-ar, gratis frå eksisterande gruppering:** avvisningsrate og sider per besøk, begge utleia frå `bySession`-grupperinga panelet alt bygde for inngangs-/utgangssider.

**Historisk konverteringstrakt, no fjerna.** I Fase 3 vart "Henvendelser fra disse sidene" (per inngangsside) fyrst bytt ut med éin aggregert sidevisning → CTA-klikk → henvendelse-trakt. Både denne trakta og skrivesida for konverteringskoplinga vart fjerna 2026-08-06; dagens Sider-fane viser berre topplister og CTA-typar.

**Ikkje-modul-fallback.** Har kunden ikkje `features.sidetelling` (og ingen Plausible), vert berre henvendelsestala vist, pluss ein kort, fristande tekst ("Med Innsikt kan du se sidevisninger, kilder, enheter og mer... Spør oss om oppgradering") -- same mønster som andre ukjøpte modular sin teaser (sjå `openManualModal()` i `core.js`).

**Vurdert og bevisst utsett i denne runda:** eit ukedag/tid-på-døgnet-varmekart vart faktisk bygd i mockup-forma og vist til brukaren, men trekt ut etter tilbakemelding ("ikke helt fornøyd med den") -- ikkje avvist på prinsipp, berre utsett til visualiseringa er betre gjennomtenkt. Sjå "Utsett, ikkje avvist" under.

**Retta etter Security Auditor + UX/Mobil-reviewer (same dag, før produksjon):** periodevalg-/sub-fane-knappane fekk `min-height:44px` (var under berøringsmål-minimumet), ein reell lekkasje der `bindPanel()` batt ein ny delegert klikk-lyttar for søyle-tooltipen for KVART "Oppdater"-klikk vart retta (`bindBarTooltips()` bunde éin gong per container, verna av eit flagg), søylene fekk `tabindex`/`role="img"`/`aria-label` + Enter/mellomrom-tastaturstøtte (var berre mus-/touch-tilgjengelege), sub-fanene fekk fullstendige ARIA-roller (`role="tab"`/`aria-selected`/`aria-controls`, matcha av `role="tabpanel"` på panela), `admin/index.html` sin `.an-heading` vart retta til same eyebrow-stil som `index.html` (var uskilt frå widget-titlane på denne PWA-flata), og einingsfordelinga fekk ei minimumsbreidde per segment. 12 nye test-assertions dekkjer sub-fane/periodevalg/tooltip-mekanismane. Sjå `docs/project/CHANGELOG.md` (0.87.0) for full liste.

## Juridisk historikk og teknisk avgjerd

**RETTA 2026-08-06 (Privacy and Compliance Advisor-pass, sjå `docs/compliance/`)**: denne seksjonen viste tidlegare til "ekomlova §3-1-typen argumentasjon" som det juridiske grunnlaget for at anonym, cookiefri trafikkmåling ikkje treng samtykke. Det var **feil paragraf og utdatert lov**:

- Den gamle cookie-heimelen, **ekomloven (2003) §2-7b**, er **oppheva** frå 1. januar 2025 (Lovdata, stadfesta 2026-08-06).
- Gjeldande heimel er **§3-15 i den nye ekomlova** (LOV-2024-12-13-76), i kraft frå same dato. Kjelde: [Lovdata](https://lovdata.no/lov/2024-12-13-76/§3-15) (sjekka 2026-08-06 av KI, ikkje eit menneske).

**Dette svekka den gamle løysinga sitt "cookiefritt ⇒ treng ikkje samtykke"-argument monaleg meir enn tidlegare anteke:** §3-15 krev GDPR-gyldig samtykke for å lagre eller få tilgang til opplysningar i ein brukar sitt utstyr, **teknologinøytralt og uavhengig av om opplysninga er ein personopplysning** — regelen gjeld eksplisitt "lagring og tilgang til alle slags opplysninger", som dekte den dåverande `sessionStorage`-bruken like mykje som ein tradisjonell cookie. Det finst berre to snevre unntak (rein overføring av kommunikasjon; eller "strengt nødvendig" for ei teneste brukaren sjølv uttrykkeleg har bede om). Datatilsynet si eiga cookie-rettleiing nemner **ikkje** noko generelt unntak for anonym/aggregert trafikkstatistikk (stadfesta 2026-08-06, ikkje berre anteke).

Konsekvensen var at dette ikkje berre var eit steg 3b-spørsmål: den grunnleggjande `sessionStorage`-lagringa måtte òg bort eller ha eige grunnlag. I 0.106.0 vart ho fjerna strukturelt frå sidetellinga; den nye klienten gjer ingen lagrings-/leseoperasjon på brukarutstyret for analysegruppering. Dette er ei teknisk avgrensing av dataflyten, ikkje ei juridisk samsvarsgaranti for resten av behandlinga.

For sesjonar som faktisk konverterer (steg 3b, sender eit skjema), kjem eit **andre, sjølvstendig** spørsmål i tillegg: koplinga skapar ein indirekte veg frå elles anonyme pageview-rader til ein namngjeven person (via lead/booking sine kontaktopplysningar) — dette er sitt eige GDPR-behandlingsgrunnlag-spørsmål, ikkje berre ein §3-15-variant. Eit spesifikt, uavhuka samtykke ved sjølve skjemainnsendinga kan vere ein plausibel veg til eit gyldig grunnlag for NETTOPP koplinga (sjå `docs/compliance/` sitt oppdaterte notat), men eit slikt samtykke kjem for seint til å dekkje §3-15-spørsmålet om sjølve `sessionStorage`-lagringa, som uansett skjer FØR nokon skjemainnsending. Dei to laga må ikkje blandast saman.

Ingen av desse spørsmåla kunne avgjerast av kodegjennomgang åleine — krevde kvalifisert vurdering. Sjå `docs/compliance/legal-complexity-vs-value-2026-08-06.md` for full kjeldegrunngjeving og verdi-vs-kompleksitet-vurderinga som låg til grunn for beslutningane under.

**Beslutningsmøte 2026-08-06 — begge spørsmåla avgjorde (sjå `docs/compliance/legal-complexity-vs-value-2026-08-06.md` del 5 for full grunngjeving):**
1. **Konverteringskoblinga (steg 3b) er FJERNA i kode** — `core.js` sin `addLead()`/`module-booking.js` sin booking-innsending sluttar å sende `p_analytics_session_id`, og `module-sidetelling.js` sin `.an-funnel`-trakt (som viste koplinga) er fjerna att saman med henne. Opning for å byggje ein ordentleg, juridisk gjennomtenkt versjon seinare som eiga, bevisst funksjon.
2. **Den gamle `sessionStorage`-lagringa er FJERNA i ny klientkode (0.106.0)** og erstatta med Edge-basert dagsgruppering skildra over (same overordna mønster som Plausible offentleg dokumenterer). Edge-kode og migrasjon er klare, men ingen Edge Function er deploya og ingen staging-/produksjonsdatabase er endra utan brukaren si eksplisitte godkjenning. Før reelle kundar vert aktiverte må request-headerane, dagsskiftet, kvotane og faktiske funksjonsprivilegium verifiserast på staging; gamle faner må få cacheovergangen/reload.

**Verifisert trygt i implementasjonen sjølv (historisk, gjeld dei gamle radene)**: `analytics_session_id` var bevisst haldt utanfor `dbLeadToJs`/`dbBookingToJs` sine kvitelister — vart ALDRI vist i Web-admin sitt UI, CSV- eller JSON-eksport. GDPR-sletting av ein lead/booking slettar heile rada, inkludert kolonna, automatisk. Kolonna finst framleis i skjemaet (ingen migrasjon køyrd), men vert ikkje lenger fylt ut for nye rader.

## Bevisst ikkje bygd (bryt eitt av dei tre grunnprinsippa, eller vurdert og avvist av andre grunnar)

- **Geolokasjon**: krev anten eit eksternt API-kall eller lagring av IP-adresse — bryt prinsipp 2 (og den eksisterande "vi lagrar ikkje IP"-lovnaden) uansett vinkling. Målgruppa (lokale SMB-kundar) har heller ikkje eit reelt behov.
- **Workspace-analyse**: anna bruksområde (intern bruksstatistikk for tilsette), ikkje prioritert.
- **Seksjon/skrolldjupne ved avreise**: vurdert og avvist 2026-08-03 — krev anten mange fleire skriv per visning eller ein sendBeacon/pagehide-mekanisme (alt forkasta éin gong i Fase 1 av kostnad/nytte-grunnar), og nøyaktigheita er tvilsam på tvers av skjermstorleikar.
- **"AI-oppsummering"**: bygd som rule-based "Trendar" i staden (sjå Fase 2 steg 2) — ingen ekte AI/eksternt kall, i tråd med prinsipp 2.
- **"Fase 2.5" — unike besøkjande**: vurdert grundig 2026-08-03 (uavhengig teknisk forslag frå Codex, deretter kritisk gjennomgått av Vibeverk-arkitekten -- same to-stegs mønster som Nettsidehelse-modulen sitt opphav) og **avvist, ikkje berre utsett**. Konklusjon frå begge: teknisk mogleg innanfor dei tre prinsippa (ei privat, aggregert HyperLogLog-skisse, ingen rå IP/UA/besøks-ID lagra), men **uforholdsmessig komplisert for verdien han faktisk gjev Vibeverk sine kundar**. To vesentlege funn:
  1. Det tidlegare forslaget i denne fila (Postgres sin `inet_client_addr()` + dagleg salta hash) var **stadfesta feil** -- i Supabase/PostgREST-arkitekturen returnerer den funksjonen IP-en til PostgREST/pooler-laget, ikkje den besøkjande sin eigen IP. Den vart ikkje forfølgt vidare for HLL-/unik-besøkjande-forslaget på dette tidspunktet; 0.106.0 brukar seinare request-headerane i Edge Function-en til den mykje enklare dagsgrupperinga skildra over, utan HLL, nøkkelrotasjon eller unik-KPI.
  2. Sjølve verdien av "unike besøkjande" er tvilsam for Vibeverk sine faktiske kundar (små norske SMB-ar, typisk få hundre besøk/månad): identitets-proxy-feilen (kontor-/skule-/CGNAT-nettverk kan gje opptil 99 % undertelling for ei gruppe, éin person på fleire nettverk kan gje opptil 400 % overtelling) er langt større enn sjølve HLL-algoritmens presisjon (~1,6 %), og kompleksiteten (eigen HLL-implementasjon i rein PL/pgSQL -- Supabase har inga ferdig utviding -- nøkkelrotasjon, `pg_cron`-oppryddingsjobbar, Vault-nøkkelhandtering, ny rapport-RPC) er eit stort steg opp frå resten av kodebasen sin bevisst enkle stil, for eit tal som uansett ville vore eit usikkert estimat, ikkje eit fasitsvar.

  Det enklare alternativet (ein stabil HMAC-signatur i ein privat token-tabell, ~35 dagars levetid) vart òg vurdert og avvist -- det er reelt sett ein server-side cookie-erstattar, og ville undergrave sjølve produktposisjoneringa ("cookiefritt, ingen varig identifikator"). Den seinare 0.106.0-dagsgruppa er ikkje denne løysinga: ho har ingen token-tabell, ingen 35-dagars signatur og vert aldri brukt til ein unik-besøkjande-KPI.

  **Produktavgjerd (brukar, 2026-08-03)**: Vibeverk sin eigen sidetellingsmodul held fram bevisst enkel og ærleg -- kundar som treng ekte unike-besøkjande-tal (eller anna avansert analyse) vert tilviste til Plausible (alt støtta som eit "premium"/ekstern alternativ, sjå `analytics.plausible`-feltet) eller Google Analytics, i staden for at Vibeverk byggjer ein eigen, kompleks og usikker versjon av same ting. Om reelt høgvolum-behov skulle dukke opp igjen seinare, er HLL framleis den einaste av dei to vurderte tilnærmingane verdt å ta opp att -- men berre med ei ekte Postgres HLL-utviding, ikkje ein eigenskriven algoritme.

  Full avgjerd med grunngjeving: `docs/decisions/ADR-0013-unique-visitors-rejected.md`.

## Utsett, ikkje avvist

- **Rollup-tabell** (reint teknisk optimalisering, ingen prinsipp-konflikt, berre ikkje urgent med dagens datamengde), **CMS-per-side-widget** (ingen ny datainnsamling, berre ei anna visning av data som alt finst).
- **Ukedag/tid-på-døgnet-varmekart**: bygd i mockup-form og vist til brukaren i Innsikt-redesignrunden (Fase 3, 2026-08-03), men trekt ut etter tilbakemelding ("ikke helt fornøyd med den"). Ikkje eit prinsipp-problem (dagen ligg alt i `created_at`) -- berre visualiseringa som ikkje trefte enno. God kandidat for ei seinare, isolert forbedring med ein annan visuell approach, ikkje eit avvist konsept.

## `seed_test_pageviews()` — kjent, ikkje-fungerande mekanisme

Den staging-only testdata-generatoren (`supabase/staging-only/seed_test_pageviews.sql`) har eit fail-closed-gjerde via ein eigendefinert Postgres-GUC (`app.settings.is_staging`). Stadfesta 2026-08-03: denne GUC-en **kan ikkje settast på noko Supabase-hosta prosjekt** — krev superbrukar-rettar Supabase aldri gjev ut (`ALTER DATABASE`/`ALTER ROLE ... SET` for ein eigendefinert parameter krev superuser i vanleg PostgreSQL). Knappen har difor truleg aldri fungert, uansett prosjekt. Sjå `docs/roadmap/ROADMAP.md` "Later" for skisse til fiks (byt GUC-sjekken ut med ein rad i `store`-tabellen i staden).
