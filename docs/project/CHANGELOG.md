# Endringslogg — Vibeverk

Eitt versjonsnummer for heile plattformen (nettside + Workspace + Console).
Semantisk-aktig versjonering: `0.MINOR.PATCH` heilt til første reelle produksjonslansering — då hoppar vi til `1.0.0`.

- **MINOR** — ny modul, ny funksjonalitet, eller endring som påverkar åtferd
- **PATCH** — feilretting, mindre justering, tekst/copy, konfig

Gjeldande versjon vert vist i **Console** (sidebar, nedst) — henta frå `VIBEVERK_VERSION` i `console/console-core.js`.

Dette er ein **endringslogg**, ikkje eit avgjerdslogg og ikkje ei erstatning for Git-historikk — sjå `docs/README.md` for kjelde-til-sanning-rekkefølgja. Langvarige avgjerder vert dokumentert som ADR-ar i `docs/decisions/`.

## Kvifor denne fila finst

Kvar ny økt (ny Claude-samtale) startar utan minne om førre økt sine detaljerte kodeendringar.
Denne fila er repo-synleg og lesbar for alle agentar (hovudagent + subagentar), i motsetnad til
det private minnesystemet som berre hovudagenten har tilgang til. Formålet er å unngå at ei ny
økt gjentek arbeid, motseier ei nyleg endring, eller "gjenoppdagar" ein feil som alt er fiksa.

## Rutine

**Ved oppstart av ei ny oppgåve:** les dei siste 2–3 oppføringane under før du gjer endringar.

**Etter ei fullført, meiningsfull endring:**
1. Legg til ei ny oppføring øvst (nyaste fyrst) med dato og kva/kvifor
2. Bump `VIBEVERK_VERSION` i `console/console-core.js`
3. Bump `?v=N` i respektive `index.html` for filene som faktisk endra seg (som vanleg, sjå CLAUDE.md)

Små eksperiment, reine spørsmål/analysar eller reverta forsøk treng ikkje eiga oppføring.

---

## 0.98.0 — 2026-08-05

**Ny funksjonalitet:** «Budsjett»-fane i Console sin Priser-modul — ein 12-månaders inntektsprognose-kalkulator. Brukaren set eit forventa NYSAL PER MÅNAD for kvar pakke (henta med reelle pakketerte prisar frå `_priserData.packages`), og verktøyet syner:
- Ein SVG-graf: MRR-linje som AKKUMULERER månad for månad (kundar frå tidlegare månadar held fram å betale — klassisk lineær SaaS-vekstmodell), pluss stolpar for eingongsinntekt (flatt kvar månad, berre frå den månaden sine nye sal), pluss ei valfri stipla mål-linje (kr/mnd).
- Ein "Når nås målet?"-indikator (`Math.ceil(mål / ny-MRR-per-månad)`, med eksplisitte tilstandar for "aldri med denne salstakta" og "målet er alt nådd").
- Ein tal-tabell under grafen (same 12 månadar, alltid synleg — grafen sin tooltip er eit tillegg, aldri einaste vegen til dataen).

`priceOnRequest`-pakkar ("Skreddersydde moduler") er synlege i salsplan-tabellen (informativt) men ekskluderte frå berekninga, sidan dei ikkje har ein fast pris å multiplisere med eit tal. Reint økt-lokalt state (`_priserBudget`), same mønster som "Bygg tilbud" — ALDRI lagra til `pricing_config`/databasen.

Fargane i grafen (`#2a78d6` MRR-linje, `#008300` eingongs-stolpar) er henta frå `dataviz`-skillen sin validerte standardpalett, stadfesta med `scripts/validate_palette.js` mot Console sin faktiske kvite overflate (`#ffffff`) — alle sjekkar (lysheit, kroma, CVD-skilje, normalsyn-golv, kontrast) PASS.

Fana vart undervegs presisert av brukaren frå ein enklare éin-periode-kalkulator (statisk "hvis bare denne pakken"-nedbryting) til ei ekte 12-månaders vekstprognose med graf, midt i implementeringa — sjå tilhøyrande plan-fil-historikk. `renderPriser` sin fane-dispatch vart samstundes retta frå eit implisitt catch-all (trygt berre ved nøyaktig 4 verdiar) til ei eksplisitt if/else-kjede med dokumentert fallback, no som ei 5. fane finst.

Kjørt gjennom UX/Mobile Reviewer før merge, som fann og fekk retta fleire reelle funn: `role="img"` på sjølve SVG-en kunne skjule dei individuelt merkelappa `.budget-hit`-borna for ein skjermlesar sin virtuell-markør-navigasjon (endra til `role="group"` + ein eigen `<title>`); y-akse-talet sin venstremarg var fast (60px) og kunne klippe av dei fremste sifra på store kr-beløp (no dynamisk, breidde-tilpassa `niceMax`); tooltipen hadde ingen vassrett/loddrett klemming og kunne stikke utanfor kortet ved månad 1/12 (retta); eit mål sett høgt over reell prognose kunne klemme grafen flat utan forklaring (ny åtvaringstekst); "MRR" stod uforklart fem stader (utvida i to `helpIcon()`-tooltipar); og "Målet er 0 kr/mnd eller alt nådd" synte feilaktig FØR brukaren i det heile hadde skrive inn eit mål (delt `priserBudgetMttText()`-funksjon skil no eksplisitt "ikkje sett" frå "nådd", og varslar eksplisitt når svaret ligg utanfor dei synlege 12 månadane).

Console har ingen automatisert testsuite — verifisert med syntakssjekk og eit frittståande Node-skript som stadfestar sjølve kompoundingsmatematikken (MRR/eingongsinntekt/månader-til-mål) mot handrekna forventa verdiar, ikkje ein live login-test. Cache-bust: `console-core.js?v=216`.

## 0.97.0 — 2026-08-05

**Ny funksjonalitet:** «Spar kr X»-merking i Console sin Priser-fane. Når ei pakke sin SETTE pris (`pkg.price`/`setupCost`) er lågare enn den KALKULERTE modulsummen (same tal som alt vart vist i ein `helpIcon()`-tooltip via "Veiledande sum"), vises no ei automatisk utrekna innsparing:
- **Forhåndsvisning** (kundevendt samanlikningskort): ein grøn pille rett under prisen, t.d. "Spar 340 kr/mnd".
- **Rediger pakker** (admin-redigering): ei diskret tekstlinje UNDER (ikkje inni) sjølve pris-boksane — bevisst plassert utanfor boksane, sidan brukaren eksplisitt bad om at desse skulle ha "ikke noe mer" i seg (2026-08-04). Linja punktoppdaterer medan admin skriv, same disiplin som namn/pris-felta elles i fana (aldri eit fullt re-render per tastetrykk).

Berre POSITIVE differansar tel — ei pakke sett HØGARE enn modulsummen (eit medvite prispåslag) syner ingen "spar"-tekst. Ny funksjon `priserSavingsText()` i `console-core.js`, delt mellom begge fanene.

**Prisgjennomgang** (rådgivande, ikkje vedteke): full manuell gjennomgang av alle Nettside- og Workspace-modular sine mnd-/engangsprisar, levert direkte i samtalen (ikkje i ein fil) etter brukaren si eiga screenshot-visning av gjeldande Modulpriser-tal. Viktigaste funnet: "Skreddersydd modul" og "Skreddersydd AI-modul" står på 0/0 sjølv om dei representerer reelt, variabelt utviklingsarbeid (og for AI-varianten: løpande Anthropic-kostnad) — tilrådd anten "Pris etter avtale" (same mekanisme som pakkar alt har) eller eit veiledande golvbeløp. Ingen av tala er endra i koden — dette er berre ei tilråding brukaren kan velje å bruke i Modulpriser-fana.

Console har ingen automatisert testsuite (verken jsdom eller anna) -- verifisert ved kodegjennomgang + syntakssjekk (`node -e "new Function(...)"`), ikkje ein live login-test (Console krev OTP mot kontrollplanet, ikkje mogleg å simulere i denne økta). Cache-bust: `console-core.js?v=215`.

## 0.96.6 — 2026-08-05

**Fiks:** Brukarrapport — Smart årshjul synte feilmelding om at lokal lagring ikkje fungerte, medan Oversikt "verka som han fungerte" (ingen feilmelding) for det som truleg er nøyaktig same underliggjande lagringssvikt — og etter ein hard nettlesar-reload var ei tidlegare generert oversikt borte, medan oppsettskjemaet sin tittel/skildring framleis stod att.

Rotårsak: Oversikt sin `save(show)` synte berre feilmeldinga når `show===true`. Av dei 25 kallstadene til `save()` i modulen brukar berre éin (den eksplisitte "Lagre"-knappen) `show=true` — alle dei andre 24 (avkryssing, statusbyte, godkjenning, **og dei nye felt-for-felt-lagringane frå 0.96.2**) var difor heilt stille ved feil. Smart årshjul sin eigen `save()` har aldri hatt dette `show`-vernet, difor synte han feilboksen for identisk feil. Retta ved at Oversikt no ALLTID varslar ved reell lagringssvikt, uavhengig av `show` — `show` styrer framleis berre om ei VELLUKKA lagring skal stadfestast med ein "lagra lokalt"-toast (uendra, for å ikkje spamme det ved kvar rutinehandling).

Dette forklarer også det observerte "hard reset"-mønsteret: mindre lagringar (t.d. tittel/skildring) hadde truleg lykkast tidlegare (før lagringsplassen vart pressa), medan ei seinare, større lagring (heile den genererte analysen) feila stille — usynleg heilt fram til no. Sjølve den underliggjande årsaka til kvifor lagring feilar (truleg nær kvote for det delte `nordpunkt:*`-namnerommet) er FRAMLEIS ikkje løyst; denne endringa gjer berre feilen synleg i begge modulane likt, som første steg mot å diagnostisera vidare via `console.error`-loggen frå 0.96.4.

Ny regresjonstest i `test-workspace.js` (ad10) som stadfestar ein stille `save()`-feil no varslar — verifisert til å faktisk feile utan fiksen.

Ingen datamodell- eller API-endringar. Alle tre testsuitene er framleis 0 FEIL (210/676/91). Cache-bust: `module-oversikt.js?v=6`, `console-core.js?v=214`.

## 0.96.5 — 2026-08-05

**Fiks:** Oppsettskjemaet i Oversikt hadde ei linje der «Type situasjon» og «Omfang» stod side ved side, men berre «Omfang» hadde ei hjelpetekst under nedtrekksmenyen. Sidan begge felta ligg i same grid-rad, vart heile rada like høg som det høgaste feltet (`Omfang`), og «Type situasjon» fekk eit ubrukt tomrom under seg før neste seksjon — brukarrapport: "Teksten pusher boksen utav posisjon". Retta ved å gje «Type situasjon» ei tilsvarande, reelt nyttig hjelpetekst ("Brukes til å tilpasse forslagene til situasjonen din.") i staden for eit usynleg fyllstoff-hack — same mønster som `Omfang` sin eigen hjelpetekst, så begge felta no har lik naturleg høgde.

Sjekka Smart årshjul for same mønster (to felt side ved side der berre eitt har hjelpetekst) — fann ingen tilsvarande tilfelle der, ingen endring nødvendig i den modulen denne runda.

Ingen datamodell- eller API-endringar. Alle tre testsuitene er framleis 0 FEIL (209/676/91). Cache-bust: `module-oversikt.js?v=5`, `console-core.js?v=213`.

## 0.96.4 — 2026-08-05

**Fiks:** Etter brukarrapport om at (1) Smart årshjul viste ei feilmelding om at lokal lagring ikkje fungerte, og (2) begge modulane falt tilbake til oppsettskjemaet ("steg 1") berre ved å byte fane til eit anna modul og komme attende, sjølv etter ei ekte, vellykka generering — same rotårsak i begge:

- `mount()` i både `module-oversikt.js` og `module-smart-aarshjul.js` kalla `load()` (som les frå `App.store`/localStorage) **ubetinga kvar gong** brukaren navigerte inn i modulen, ikkje berre fyrste gong denne sideøkta. Dersom ei tidlegare `save()` faktisk hadde feila (t.d. fullt localStorage-kvote for dette opphavet, som deler `nordpunkt:*`-namnerommet med alle andre Workspace-modular), var objektet i minnet framleis korrekt, men neste `mount()` overskreiv det ubetinga med den ELDRE (feila) lagra utgåva frå disk — sett utanfrå såg det ut som generert innhald "forsvann" berre ved fanebyte. Retta ved å berre lasta frå lagring éin gong per sideøkt (`_loadedThisSession`-flagg); eit ekte "Nullstill"/"Ny oversikt" set framleis `state` direkte og er upåverka.
- `App.store.set` i `core.js` svelgde tidlegare enhver lagringsfeil heilt utan logging, umogleg å diagnostisera. Lagt til `console.error` med feilnamn/-melding og eit grovt estimat av total localStorage-bruk for opphavet — reint diagnostisk, ingen endring i returverdi eller åtferd for nokon av dei mange kallarane i appen.

To nye regresjonstestar i `test-workspace.js` (ab10, ad9) som simulerer ei feila lagring (ved å midlertidig la `App.store.set` returnera `false`) og stadfestar at state i minnet overlever eit påfølgjande fanebyte — verifisert til å faktisk feile utan fiksen (ikkje berre grøn av tilfelle).

Ingen datamodell- eller API-endringar. Alle tre testsuitene er framleis 0 FEIL (209/676/91). Cache-bust: `core.js?v=87` (alle fire html-filer som lastar han), `module-oversikt.js?v=4`, `module-smart-aarshjul.js?v=5`.

## 0.96.3 — 2026-08-05

**UI-opprydding:** Smart årshjul og Oversikt fekk ein visuell gjennomgang etter brukartilbakemelding om at fleire visningar (dashboard, analyseverksted, kart, modalar) verka "rotete" — nokre tydelege småfeil, ikkje éin stor feil:
- **Dobbel tekst fjerna** (Oversikt): AI-samandraget vart vist to gongar — ein gong i toppen (`ov-shell-head`), og igjen ord for ord i ein eigen boks lenger ned i dashboardet (`ov-summary-strip`). Boksen er fjerna; fråskrivingsteksten flytta opp til toppen som ei mindre, dempa linje under samandraget.
- **Mjukare feit tekst**: alle `<strong>`/`<h1-h3>` i begge modulane arva rå `var(--color-text)` (nesten svart) ved full nettlesar-standardvekt — kort-titlar, listerad-titlar, kart-node-namn, modal-overskrifter, alt saman. Ny `--ov-ink`/`--saa-ink`-token (ei `color-mix` mot den dempa fargen) mjukar dette opp, og ikkje-overskrift `<strong>` gjekk frå vekt 700 til 650. To stader med kvit tekst på farga bakgrunn (`.ov-hero h1`, `.ov-impact-center strong`, `.saa-selection strong`) fekk eksplisitt `color:#fff` att, sidan dei elles ville arva den nye mørke blekk-fargen frå den globale regelen.
- **Luftigare bobler**: `.ov-chip` gjekk frå `.25rem .5rem` til `.32rem .7rem` padding; tilsvarande for `.saa-badge/.saa-origin/.saa-lock/.saa-status`, `.saa-currentq`, `.saa-qlabel` og `.saa-qlegend span` i Smart årshjul.
- Prioritets-markøren i Oversikt sitt dashboard gjekk frå ei full-metta loddrett stolpe til ein liten prikk med mjuk glorie (same åtvaringsfarge, mindre visuell vekt). Glorien brukar `color-mix()` mot `--color-surface` i staden for den faste `--ov-warning-soft`-fargen, sidan UX-gjennomgangen fann at sistnemnde nesten er usynleg mot ei kvit kortoverflate i lyst tema.

Kjørt gjennom UX/Mobile Reviewer før merge (per fast rutine for meiningsfulle UI-endringar): ingen blokkerande funn, kontrastrekning på den nye `--ov-ink`/`--saa-ink`-blekk-fargen ligg godt over WCAG AA (~14.8:1 lyst tema, ~11.6:1 mørkt) mot begge standardtema.

Ingen datamodell- eller API-endringar. `test-workspace.js` (207/207), `test.js` (676/676) og `test-api.js` (91/91) er framleis 0 FEIL. Cache-bust: `module-oversikt.js?v=3`, `module-smart-aarshjul.js?v=4`.

## 0.96.2 — 2026-08-05

**Fiks:** Smart årshjul og Oversikt sine oppsettskjema mista utfylt-men-ikkje-sendt tekst ved fanebyte. Rotårsak: `bindStartEvents()`/`root.addEventListener("input", ...)` i høvesvis `workspace/module-oversikt.js` og `workspace/module-smart-aarshjul.js` skreiv berre skjemaverdiane til `state` ved innsending (`submit`), ikkje undervegs — sjølve lagrings-/gjenopprettingsmekanismen (`App.store` → `localStorage` + batcha Supabase-`upsert`, sjå `core.js`) var alltid korrekt, det var berre feltverdiane som aldri nådde `state` før brukaren trykte «Generer». Retta ved å skriva kvart felt (tittel/skildring/type/omfang/analyseområde for Oversikt; skildring/sesongar/fokus for Smart årshjul) inn i `state` + kalla `save()` fortløpande på `input`/`change`, same mønster som feltet for bransje og søk allereie brukte. To nye regresjonstestar lagt til i `test-workspace.js` (ab8/ab9, ad7/ad8) som simulerer akkurat dette scenarioet (skriv i felt → byt fane → kom attende → sjekk verdien overlevde). Cache-bust: `module-smart-aarshjul.js?v=3`, `module-oversikt.js?v=2`.

## 0.96.1 — 2026-08-05

Oversikt: byta AI-modell frå Haiku 4.5 til Sonnet 5 (`api/_lib/oversikt-ai.js`, `DEFAULT_MODEL`), for å testa om svarkvaliteten betrar seg (brukar opplevde Haiku-outputen som svak, jf. tilsvarande tilbakemelding på Smart årshjul). Kan overstyrast med `ANTHROPIC_MODEL`-miljøvariabelen som før. `test-api.js` er framleis 0 FEIL (91/91) — ingen test låser modellstrengen.

## 0.96.0 — 2026-08-05

### Ny modul: Oversikt (Workspace) — AI-basert behovs-/avhengigheits-/påvirkningsanalyse

Ny skreddarsydd modul, same mønster som Smart årshjul (0.93.0-0.95.2): brukaren skriv ei kort skildring av ein situasjon (flytting, arrangement, oppstart, ny tjeneste, digitalisering osb.), og ekte Anthropic-AI genererer ei strukturert oversikt i fire delar -- Behov, Avhengigheter (med rekkefølgje/flytstatus Klar/Pågår/Ferdig/Blokkert), Påvirkning og Glemte punkter. Alt startar som «Forslag»; berre punkt brukaren eksplisitt "Tar med" tel i dashbord, kart, oppsummering og eksport.

**Utgangspunkt**: brukaren leverte ein stor (~140KB), sjølvstendig HTML-demo (`vibeverk-oversikt-demo-v5-testet.html`). Denne blei først kritisk gjennomgått og feilretta som eit eige steg (sjå commit-historikk same dag) -- fann og retta m.a. ein stale-DOM-etter-modallukking-feil i "Endre flyt", ein ufullstendig JSON-eksport-filter, ein null-tryggleiks-krasj i SVG-linjeteikning, manglande scroll-til-topp ved intern navigering, ein reelt klippa knapp-feil ved 1024px, og fleire nynorsk-restord ("Vel" → "Velg"). Den retta demoen var kjeldegrunnlaget for portinga, ikkje eit nytt utgangspunkt.

**Server** (`api/ai/oversikt.js` + `api/_lib/oversikt-ai.js`): Node.js runtime frå fyrste dag (ikkje Edge -- annual-wheel.js sin eigen 25s-timeout-hendelse frå 0.95.1 er allereie kjend, ingen grunn til å gjenoppdage han her), 90s AbortController-timeout frå fyrste dag (same grunngjeving, ikkje 30s→90s-runden frå 0.95.2). Same auth-mønster som annual-wheel.js: tenant-oppløysing via Host-header, bearer-token + rolle-verifisering mot tenanten sin EIGEN Supabase Auth (admin/editor, ikkje member), og `tenant.custom_modules_manifest["oversikt"].enabled` kontrollplan-sjekk før noko Anthropic-kall skjer. Fordi avhengigheitssteg viser til KVARANDRE (edges), som AI-en ikkje kjenner ekte server-id-ar for på førehand, returnerer modellen stega som ei ordna liste og edges via 0-baserte `fromIndex`/`toIndex` -- serveren løyser desse til ekte id-ar OG køyrer ein full sirkel-deteksjon over heile det returnerte kant-settet (aldri stol på at AI-en faktisk following "ikkje lag ein sirkel"-instruksen), i tillegg til vanleg enum-klemming/lengdeavgrensing/kontrollteikn-fjerning. Ingen curated-kjelde-katalog (som annual-wheel-sources.js) er naudsynt her -- Oversikt sine punkt er strukturelle forslag, ikkje namngjevne kurs/fristar/kjelder.

**Klient** (`workspace/module-oversikt.js`): registrert via `customModules["oversikt"]` (absent-som-standard, aktiverast eksplisitt per kunde via Console sitt "Skreddarsydde modular"-panel -- ingen kodeendring trengst der, panelet er allereie generisk manifest-drive). Fem "skjermar" i éin `Intranet.registerModule()`-modul: eit oppsettskjema (før nokon analyse finst) og fire interne visningar (Samlet oversikt / Analyseverksted / Visuelt kart / Oppsummering) styrte av modulen sin eigen intern tab-navigasjon, sidan Workspace sin eigen sidebar berre har éin oppføring for heile modulen. Lagring: `App.store` (nøkkel `wsp-oversikt`), same write-through-mønster som smart-aarshjul. CSS-en sine strukturelle fargar (bakgrunn/overflate/tekst/kant) er kopla til Workspace sine eksisterande `--color-*`-variablar (lys/mørk/skumring-tema fungerer automatisk), medan status-/kategori-fargane er eigne, prefikserte (`ov-`) verdiar same som smart-aarshjul sine `--saa-*`. Knappar bruker Workspace sine faktiske delte klassar (`btn btn--primary`/`btn--ghost`/`btn--danger`/`btn--sm`), ikkje demoen sine eigne `ov-btn-*`-namn.

**Testdekning**: `test-api.js` fekk ein ny F-seksjon (27 testar, mønster frå E-seksjonen/annual-wheel) som m.a. stadfestar at ein sirkel-kant, ein utanfor-lista-kant og ein sjølv-referanse-kant frå eit simulert AI-svar alle blir fjerna, at alle AI-genererte steg startar som "suggested" (aldri "approved"), og heile auth-/entitlement-/valideringskjeda. `test-workspace.js` fekk nye AD/AE-seksjonar (same mønster som AB/AC for smart-aarshjul) som stadfestar PÅ/AV-stien for `customModules.oversikt`. Alle tre suitane grøne (676/203/90).

**Tryggleiksgjennomgang** (Claude Security Auditor, uavhengig av Codex, sjå CLAUDE.md): ingen utnyttbar tryggleiksfeil funnen -- auth/entitlement/inputvalidering/AI-svar-validering stadfesta korrekte. Fann derimot ein reell korrektheitsfeil: `validateOverviewResponse()` sette aldri `title`/`description`/`scenarioType` på svaret (verktøyskjemaet ber aldri AI-en ekkoe desse tilbake, sidan dei alt er kjende frå førespurnaden) -- klienten sin eigen "Ny oversikt"-fallback vann difor kvar gong, også ved "Oppdater oversikten" (som ville overskrive ein alt eksisterande tittel). Retta ved å sende den ORIGINALE førespurnaden sin profil inn i `validateOverviewResponse(raw, profile)` og hente desse tre felta derifrå. Ny test `f15k` stadfestar fiksen. Også presisert (ikkje ein regresjon, berre dokumentert korrekt): `member`-rolla kan ikkje UTLØYSE ein ny generering (server-sida krev admin/editor), men kan lese ein alt generert analyse via `store`-tabellen sin eksisterande, brei `store_read_authenticated`-policy -- same lesbarheit som alle andre App.store-baserte Workspace-modular.

**UX/mobil-gjennomgang** (UX and Mobile Reviewer): fann og retta ein reell CSS-feil -- `.ov-modal-body`/`.ov-modal` mangla `min-height:0` på flex-borna sine, same "flex-item krympar ikkje under innhaldshøgda som standard"-fallgruve som `module-smart-aarshjul.js` sin eigen `.saa-modalbody` allereie var retta for (`min-height:0` + `max-height` på sjølve modalen) -- utan denne kunne eit langt redigeringsskjema på eit lågt skjermbilete (liggjande mobil) gjere modalen høgare enn skjermen i staden for å scrolle internt. Retta identisk. Fann også `.ov-segment` (dei fire seksjonsknappane Behov/Avhengigheter/Påvirkning/Glemte punkter) mangla `flex-wrap:wrap` (i motsetnad til `.ov-viewnav`, som alt hadde det) -- reell overflow-risiko ved 375-390px. Retta. Tre nynorsk-restord i feilmeldingar/varsel (lagringsfeil, utløpt innlogging, mislykka AI-henting) evna det opphavlege 2026-08-05-språkstellet sidan dei berre utløysast på feilstiar, ikkje i eit vanleg klikk-gjennom -- retta til bokmål. Sletting/nullstilling sine stadfestingsdialogar oppgraderte til å nemne omfang OG irreversibilitet eksplisitt (copy-style-guide sin Tier B-konvensjon). Mindre polering: hjelpetekst lagt til på "Omfang"-feltet, stjerne-markøren for høg prioritet fekk `aria-hidden` + skjermlesar-tekst.

**Ikkje gjort her, gjenstår**: ekte, autentisert klikk-gjennom-test i ein reell nettlesar -- Workspace sin eigen innloggingsport krev ei ekte Supabase Auth-økt (stadfesta: eit `sessionStorage`-hopp åleine held ikkje i den ekte appen, berre i jsdom-testselen), og eg har ingen ekte Workspace-brukarlogg-inn for nokon kunde. Same avgrensing som blei nemnd for smart-aarshjul sin eigen fyrste utrulling. Krev anten ekte testkredensialar eller at brukaren sjølv aktiverer modulen for ein kunde og prøver ho.

## 0.95.2 — 2026-08-05

### Smart årshjul: heva Anthropic-timeout etter framleis feil post-0.95.1

Endepunktet returnerte no det ordentlege, høflege feilsvaret ("Forslaga kunne ikkje genererast akkurat no...") i staden for ein bar 504 — stadfesta at 0.95.1 sin runtime-fiks verka. Men generering feila FRAMLEIS to gonger på rad rett etter. Ekte produksjonslogg synte kvifor: `error: 'This operation was aborted'` -- IKKJE ein plattform-504 denne gongen, men fila sin EIGEN `ANTHROPIC_TIMEOUT_MS`-baserte `AbortController` som kutta kallet ved 30 sekund.

30s var eit trygt val medan endepunktet framleis kjørte på Edge (25s plattformtak uansett), men i praksis for stramt for det ekte kallet -- å generere 18-30 strukturerte tool-use-forslag (`max_tokens: 8000`) frå ei fyldig verksemdskildring (708 teikn i begge feila forsøka) tok konsekvent over 30 sekund hos Anthropic sjølv. Heva til 90 sekund (`api/_lib/annual-wheel-ai.js`) -- rikeleg med rom under Node.js runtime sitt 300s-tak (0.95.1), og framleis ei rimeleg ventetid for brukaren for ei AI-generering av denne storleiken.

Alle tre testsuitane grøne (676/192/63). Ingen testendring naudsynt (ingen test er kopla til den eksakte talverdien).

## 0.95.1 — 2026-08-05

### Smart årshjul: fiks 504 på ekte generering — Edge runtime → Node.js runtime

Brukaren aktiverte Smart årshjul for ein ekte kunde (fyrste ekte, kostnadsberande forsøk etter 0.95.0) og fekk ein bar `504` rett frå nettlesaren, ikkje det venta, høflege norske feilsvaret frå `api/ai/annual-wheel.js` sin eigen `try/catch`. Verifisert direkte mot produksjonslogg (`vercel logs vibeverk.no`): **"Error: Your function was stopped as it did not return an initial response within 25s."**

**Rotårsak, stadfesta mot Vercel sin eigen dokumentasjon** (henta live, ikkje frå minne): Edge runtime har eit HARDKODA, IKKJE-konfigurerbart 25-sekunders tak for å starte svaret (`/docs/functions/limitations#max-duration`) — dette er ein plattformgrense, ikkje noko `maxDuration` kan endre for Edge. Denne fila sin eigen `ANTHROPIC_TIMEOUT_MS = 30000`-basert `AbortController`/graceful-feilmelding fekk difor ALDRI sjansen til å køyre -- Vercel drap funksjonen 5 sekund FØR vår eigen timeout ville trigga, og returnerte sin eigen generiske 504 i staden.

Node.js runtime har 300 sekund standard OG maksimum på Hobby-planen (stadfesta same dokumentasjon) — meir enn nok for eit ekte Anthropic-kall som ber om 18-30 strukturerte tool-use-forslag. Retta ved å byte KUN denne eine endepunktet (ikkje søsknene `tenant-config.js`/`*-manifest.js`, som er raske og har ingen grunn til å flytte) frå Edge til Node.js runtime:
- Fjerna `export const config = { runtime: "edge" }`.
- Eksport endra frå Edge sin bare-funksjon-konvensjon (`export default async function handler(request)`) til Node.js sin Web Standard-form (`export default { fetch: handler }`, stadfesta i Vercel sin eigen dokumentasjon under "Create a Node.js function in /api") — resten av fila (Fetch-API-stilen med `request.headers.get()`, `request.json()`, `new Response(...)`) trong INGEN andre endringar, sidan Node.js runtime sine Request/Response-objekt er dei same standard Web-API-objekta.
- `test-api.js` sin import oppdatert til å hente ut `.fetch` frå default-eksporten før testane kallar han, elles uendra.

Alle tre testsuitane grøne (676/192/63). Deployert til produksjon (`vibeverk`) etter denne fiksen — neste ekte aktiveringsforsøk bør IKKJE lenger treffe 25-sekundstaket.

## 0.95.0 — 2026-08-05

### Smart årshjul: migrert til `customModules` (skreddarsydd modul) + ekte Anthropic-nøkkel sett i produksjon

Smart årshjul vart bygd (0.93.0/PR #177) bak `intranettFeatures.smartAarshjul` — ein vanleg boolsk featureflagg, aldri faktisk lagt til `IFEAT_LABELS`/`IFEAT_HELP` og difor ALDRI synleg/redigerbar i Console sitt "Modular"-panel for nokon kunde. Sidan dette er ein betalt, kunde-for-kunde-aktivert AI-funksjon (spec seksjon 6/14), er `customModules`-mekanismen (bein 3, same mønster som "spaceship", Fase 10) det rette heimen, ikkje ein delt intranettFeatures-brytar.

- **Klient** (`workspace/module-smart-aarshjul.js`): gata no på `CFG.customModules["smart-aarshjul"].enabled === true` (absent = ikkje synleg, same konvensjon som spaceship) i staden for `CFG.intranettFeatures.smartAarshjul === false`. `navLabel` hentar `label` frå manifest-oppføringa (fallback "Smart årshjul"), slik at operatøren kan endre namnet frå Console utan kodeendring.
- **Server** (`api/ai/annual-wheel.js`): entitlement-sjekken (lagt til etter tryggleiksgjennomgang, sjå 0.93.0) sjekkar no `tenant.custom_modules_manifest["smart-aarshjul"].enabled === true` i staden for `tenant.enabled_modules.intranettFeatures.smartAarshjul` — same kontrollplan-autoritative kjelde-prinsipp som før, berre nytt felt.
- **Modul-id er kebab-case** (`smart-aarshjul`, ikkje `smartAarshjul`) — oppdaga FØR push at `tenant-admin`-funksjonen sin `CUSTOM_MODULE_ID_RE` (`/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/`) avviser store bokstavar; camelCase-varianten ville blitt avvist av Console sin eigen validator med det same operatøren prøvde å leggje til modulen.
- `config.js`: fjerna frå `intranettFeatures` (var aldri eksponert i Console uansett), lagt til som utkommentert `customModules`-eksempel (same mønster som spaceship-eksempelet rett over).
- **`ANTHROPIC_API_KEY` sett på Vercel-prosjektet `vibeverk` (produksjon, vibeverk.no)** — fyrste gong denne nokosinne har vore sett i eit ekte miljø. `ANTHROPIC_MODEL` sett IKKJE eksplisitt — koden fell tilbake til `DEFAULT_MODEL = "claude-haiku-4-5-20251001"` (`api/_lib/annual-wheel-ai.js`), som er tilstrekkeleg. Ingen kunde har enno `custom_modules_manifest["smart-aarshjul"]` sett, så endepunktet er framleis 403 for alle -- første ekte, kostnadsberande AI-kall skjer først når ein operatør faktisk aktiverer modulen for éin kunde via Console.
- Testar oppdatert til å matche (`test-workspace.js`: ny eiga DOM-seksjon "AB" for PÅ-stien, speglar "AA" (spaceship) sitt mønster, i staden for å stole på hovud-DOM-en sin no-fjerna intranettFeatures-patch; "AC" (AV-stien) sin føresetnad-assert endra til å sjekke tomt `customModules`; `test-api.js` sin tenant-fixture flytta frå `enabled_modules.intranettFeatures.smartAarshjul` til `custom_modules_manifest["smart-aarshjul"]`). Alle tre suitane grøne (676/192/63).

Gjenstår (ikkje del av denne endringa): faktisk aktivere `custom_modules_manifest["smart-aarshjul"]` for ein konkret kunde via Console og gjere eit ekte, verifisert end-to-end-kall -- ingen ADR er enno skrive for AI-auth-mønsteret (nemnt som anbefalt, men ikkje kravd, i 0.93.0).

## 0.94.3 — 2026-08-05

### Priser: fiks feil rekkjefølgje på modular i Forhåndsvisning og «Bygg tilbud»

Brukaren fann feilen med skjermbilete: «Hosting og vedlikehold av nettside» dukka opp SIST i modul-sjekklista på ei eksisterande pakke (etter FAQ), i staden for FØRST som Modulpriser viser han. Rota: `priserFeatListHtml()` (Forhåndsvisning) og `renderPriserQuote()` («Bygg tilbud») rendra `pkg.features`/`pkg.iFeatures` (og `_priserQuote.f`/`.i`) i RÅ array-orden -- den orden modulane vart huka av i, ikkje Modulpriser sin faste, kanoniske orden. Ein modul huka av SIST (t.d. ein nyleg lagt til, som "Hosting og vedlikehold") hamna difor sist, uansett kor han faktisk står i Modulpriser.

Retta med ein delt `priserOrderedFeatureKeys(rawKeys, labels)`-hjelpefunksjon som sorterer etter posisjon i `labels` (= `PRISER_F_LABELS`/`PRISER_I_LABELS`, Modulpriser sin faste orden) FØR rendring -- verkar på alt eksisterande lagra data, ingen migrering trengst. Pakke-redigeringa sin eigen modul-rutenett (`priserPkgFeatGroup`) hadde IKKJE denne feilen (itererer alltid over `Object.keys(labels)` direkte), berre Forhåndsvisning og Bygg tilbud sine lister.

Verifisert visuelt med akkurat brukaren sitt scenario reprodusert (ein modul huka av sist på ei pakke med individuelt valde modular) -- stadfesta korrekt kanonisk rekkjefølgje etter fiksen.

## 0.94.2 — 2026-08-05

### Priser: fiks "Ugyldig pakke"-lagringsfeil + pil opp/ned for pakke-rekkjefølgje

**Regresjonsfunn og -fiks**: `supabase-control/supabase/functions/tenant-admin/index.ts` sin `set_pricing_config`-validering (`PKG_ALLOWED_KEYS` m.fl.) var ikkje oppdatert til å matche 0.94.0/0.94.1 sine endringar i pakkeform (`allStandard` → `allStandardF`/`allStandardI`, nye `priceOnRequest`/`trafficGBPerMonth`-felt) — kvar lagring i "Rediger pakker" blei difor avvist med "✗ Ugyldig pakke -- forventa nøyaktig ...". Retta til å matche den faktiske, nye forma. **Krev ein separat Edge Function-deploy for å ta effekt** (ikkje ein del av git-pusha kode — gjort etter eksplisitt godkjenning, sjå eige punkt i sesjonen).

**Ny funksjon**: pil opp/ned på hver pakke-rad i "Rediger pakker" (brukarønske 2026-08-05) — flytter pakken i `_priserData.packages`, som "Forhåndsvisning" alltid har rendra i uendra rekkjefølgje frå. Boundary-knappane (fyrste pakke sin opp-pil, siste sin ned-pil) er deaktiverte. Ingen eige "order"-felt trengst.

## 0.94.1 — 2026-08-05

### Priser: retta punkt 4 — "Nettside"/"Workspace"/"Skreddersydd..." skal vere MODULAR, ikkje pakkar

Brukaren las tilbake 0.94.0 sin punkt 4 og retta kursen FØR noko blei endra (per eksplisitt instruks): desse fire skulle vore prisingslinjer i Modulpriser, "akkurat som moduler" — ikkje eigne pakke-rader med eit pakke-nivå "pris etter avtale"-flagg.

- Ny, rein prisings-katalog (`PRICING_ONLY_F_LABELS`/`PRICING_ONLY_I_LABELS` + tilhøyrande hjelpetekst) merga inn FØRST i eit nytt `PRISER_F_LABELS`/`PRISER_I_LABELS`-sett som ALLE Priser sine eigne funksjonar no bruker (Modulpriser-tabellen, pakke-redigering sine modul-rutenett, "Bygg tilbud", Forhåndsvisning sine sjekklister) — fire nye rader:
  - Nettside: **"Hosting og vedlikehold av nettside"** (Standard, først i lista, før "Aktuelt")
  - Workspace: **"Hosting og vedlikehold av Workspace"** (Standard, først), deretter **"Skreddersydd modul"** og **"Skreddersydd AI-modul"** (begge Tillegg, 0 kr til operatøren prisar dei per konkret avtale)
- **Viktig skilje, oppdaga under implementasjonen**: `FEAT_LABELS`/`IFEAT_LABELS` (dei ekte, konfig-baserte featureflagga) blir ATT attbrukt uendra av "Modular"-fana (`renderModular`), som styrer faktiske av/på-brytarar for kunden. Dei fire nye radene har INGEN tilsvarande ekte brytar i `config.js` — dei er rein fakturerings-/prisingskatalog. Difor eit HEILT SEPARAT, merga sett (`PRISER_F_LABELS`/`PRISER_I_LABELS`) berre for Priser sine eigne funksjonar, slik at "Modular"-fana ALDRI viser desse fire som togglar (ville vore ein togglar som ikkje gjer noko når klikka).
- `pkg.priceOnRequest` (pakke-nivå "Pris etter avtale") frå 0.94.0 er FRAMLEIS der, urørt — behalde etter eksplisitt brukarønske, i tilfelle ein heil skreddersydd PAKKE (ikkje berre enkeltmodul) skal seljast utan fast pris ein annan gong.

Verifisert visuelt (same mocka Console-økt-teknikk som 0.94.0): stadfesta at "Modular"-fana ikkje inneheld "Hosting"/"Skreddersydd" i det heile, og at Modulpriser-tabellen viser dei fire nye radene i rett rekkjefølgje og med rette standard/tillegg-forvalte verdiar.

## 0.94.0 — 2026-08-04

### Priser (Console): fem brukarønska rettingar/utvidingar

Alle fem punkta blei lest tilbake til brukaren og klargjort (gap-tolkning, omfang på trafikkgrense, "grunnprodukt"-forma) FØR noko blei endra, per eksplisitt instruks.

1. **CSS-fiks: "gapet mellom Grunnpakke og prisene".** `.field` (Pakkenavn) hadde ingen eigen `margin-bottom`, og `.stat-row` (Pris pr. mnd/Oppstartskostnad) hadde berre `margin-bottom`, ikkje `margin-top` — dei sat difor heilt utan luft mellom seg. Lagt til `margin-top:1rem` på `.stat-row` (`console/index.html`).
2. **Ny, informativ grense: "Datatrafikk" (GB/mnd).** Lagt til i `PRISER_CAP_FIELDS`, same "kun informativt tal, ikkje teknisk handheva"-status som Datalagring/E-postutsendinger/Brukerkontoer. Ekte overvaking/handheving mot faktisk Supabase-forbruk vurdert og eksplisitt avslått som eiga, større oppgåve (ville kravd ny infrastruktur).
3. **Fiks: "Standardmoduler" var ETT delt flagg for BÅDE Nettside og Workspace.** Kunne ikkje ha "alle standardmodular" på nettsida, men eksplisitt valde Workspace-modular, for same pakke — det ene valet styrte alltid det andre óg. Splitta `pkg.allStandard` i `pkg.allStandardF`/`pkg.allStandardI`, med éin uavhengig brytar plassert rett ved sitt eige modul-rutenett. `priserBackfillStandardFlags()` migrerer eksisterande lagra pakkar trygt (gammalt felt vinn for begge nye, til operatøren endrar eitt av dei).
4. **"Pris etter avtale"-pakketype**, for skreddersydde pakkar/modular utan fast pris (t.d. "Skreddersydd modul", "Skreddersydd AI-modul" — desse to konkrete pakkane er IKKJE sjølv oppretta av denne endringa, må lagast av operatøren via "+ Ny pakke" sidan Console-data er ei live, global rad Claude ikkje har credentials til å skrive direkte i). Nytt `pkg.priceOnRequest`-flagg byter ut Pris/Oppstartskostnad med teksten "Pris etter avtale" i redigeringspanelet, pakkelista og Forhåndsvisning — og skjuler den elles noko misvisande "0 GB/0 brukere"-grenselinja i Forhåndsvisning for slike pakkar.
5. **"Hent priser"-knapp** på både Pris pr. mnd og Oppstartskostnad — set feltet til den ferske, kalkulerte modulsummen frå Modulpriser (same tal som alt vart vist som ein "veiledande sum"-hjelpetekst, no eitt klikk i staden for manuell avlesing+utfylling).

Verifisert visuelt via ein mocka Console-økt (Playwright, alle nettverkskall til `vibeverk-control` intercepta lokalt — ingen ekte OTP-innlogging eller skriving mot den verkelege `pricing_config`-rada) sidan Claude ikkje har ekte Console-tilgang: padding-fiksen, uavhengig av/på-bryting av dei to nye Standardmoduler-brytarane, "Hent priser" som fylte inn talfeltet, og "Pris etter avtale" som bytte ut heile prisblokka i både redigering og Forhåndsvisning.

Ingen ny testdekning lagt til her — Console har ingen jsdom-testhøve i dette repoet (kun `test.js`/`test-workspace.js`/`test-api.js` finst, ingen dekker `console/`), same status som før denne endringa.

## 0.93.0 — 2026-08-04

### Ny modul: Smart årshjul (Workspace) — første AI-integrasjon på plattforma

Ny Workspace-modul som foreslår ein 12-månaders aktivitetsplan (marknadsføring,
vedlikehald, offentlege fristar, kurs/messer/arrangement) basert på bransje +
fritekst om verksemda. Konvertert frå ein godkjend, sjølvstendig HTML-demo
(vedlagd av brukar) til ein ekte modul, med den lokale forslagssimuleringa
erstatta av eit ekte serverkall.

**Nye filer:**
- `workspace/module-smart-aarshjul.js` — Workspace-modulen (`Intranet.registerModule`, `App.store` under nøkkelen `wsp-smart-aarshjul`, alle CSS-klassar prefiksa `saa-`). Steg-navigasjon (Vel utgangspunkt → Tilpass forslag → Bruk årshjulet), forslagsverkstad med filter/søk/redigering, årshjul med kvartalsfargar (Q1–Q4, dempa palett frå den godkjende demoen — ingen ekstra kvartaloversikt lagt til), månads-/liste-/balansevisning, CSV/tekst/JSON-eksport, JSON-backup+import med stadfesting, låsing av aktivitetar, gjentakande (månadlege) aktivitetar.
- `api/ai/annual-wheel.js` — Vercel Edge Function. Verifiserer tenant (Host-header, same mønster som `api/tenant-config.js`) og at kallaren har ei gyldig innlogging med rolle admin/editor mot TENANTENS EIGEN Supabase Auth/users-tabell, før eit einaste Anthropic-kall vert gjort. Best-effort per-instans rate-limit (ikkje ein ekte distribuert avgrensar — dokumentert som kjend avgrensing).
- `api/_lib/annual-wheel-sources.js` — kuratert, hand-vedlikehalde kjeldedatasett (Skatteetaten-fristar + bransjespesifikke kurs/messer/arrangement, kvar med namn/URL/kontrollert-dato) og det reine, nettverksfrie oppslagslaget over det (`identifyRelevantSourceQueries`/`searchApprovedSources`/`normalizeSourceResults`). Statisk i repoet, ikkje ein Supabase-tabell — sjå fila sin eigen header for grunngjeving (git-diff er ein sterkare garanti mot oppdikta kjelder enn ein redigerbar tabell).
- `api/_lib/annual-wheel-ai.js` — `analyzeBusinessInput`/`buildAnnualWheelPrompt`/`generateAnnualWheelSuggestions` (det EINE Anthropic-kallet, strukturert via forced tool-use, ikkje tekst-parsing) og `validateAnnualWheelResponse` (klemmer kvart felt til trygge verdiar uansett kva modellen returnerer).

**Endra filer:** `config.js` (ny `intranettFeatures.smartAarshjul: false` — standard AV, som andre nye/uprøvde funksjonar), `workspace/index.html` (nytt skript-tag), `test-workspace.js`/`test-api.js` (nye testseksjonar AB/AC og E).

**Nye miljøvariablar (Vercel):** `ANTHROPIC_API_KEY` (kravd), `ANTHROPIC_MODEL` (valfri, fell tilbake til Claude Haiku 4.5).

**Arkitektur-avgjerder** (sjå `vibeverk-architect`-gjennomgangen som gjekk føre denne endringa): kuraterte, ikkje-live kjelder for v1 (ingen web-søk-infrastruktur finst); auth-gjerdet gjenbrukar tenantens eigen Workspace-innlogging i staden for å vere eit ope endepunkt. **Ein ADR for dette (kjeldemønster + AI-auth-mønster for framtidige AI-endepunkt) er tilrådd, men ikkje skriven enno** — treng eksplisitt stadfesting frå brukar på rammeverket først (governance-regel: ingen ADR utan stadfesta avgjerdsbevis).

**Tryggleiksgjennomgang (Claude Security Auditor, same dag) fann og retta éin HIGH-alvorsgrad-feil før merge:** endepunktet sjekka rolle (admin/editor), men aldri om TENANTEN sjølv faktisk hadde fått Smart årshjul aktivert i control-planet (`tenant.enabled_modules.intranettFeatures.smartAarshjul`) — sidan éin delt Vercel-utrulling/`ANTHROPIC_API_KEY` betener alle tenantar (ADR-0007), kunne ein admin/editor hos EIN KVA SOM HELST tenant kalle endepunktet direkte (forbi den reint klientside-styrte `CFG.intranettFeatures`-sperra) og bruke opp ekte Anthropic-kostnad sjølv utan at eigen tenant hadde fått funksjonen aktivert. Retta med ein eksplisitt entitlement-sjekk (403 utan) rett etter tenant-oppslaget. Same gjennomgang fann og retta ein mindre feil i `annual-wheel-ai.js` (dobbel `resp.json()`-lesing sluka den faktiske Anthropic-feilteksten frå loggen ved HTTP-feil).

**Kjend, akseptert avgrensing (ikkje retta no):** rate-limiteren er eksplisitt best-effort/per-instans, ikkje ein ekte distribuert kostnadstak — sjå fila sin eigen kommentar. Ein persistent per-tenant kostnad-/kvotesperre (t.d. ein rad per tenant+dag i tenanten sin eigen `store`-tabell) er identifisert som ei rimeleg vidareføring, men ikkje bygd i denne runda.

**UX/mobil-gjennomgang (Claude UX/Mobile Reviewer, same dag) fann og retta éin blokkerande feil før merge:** "trygg startside"-knappen som vert vist ved ein render-krasj sa "Ingen data er sletta", men kalla i røynda `state = defaultState()` og sletta alle aktivitetar/forslag — stikk i strid med teksten på same skjerm og med Tier B-regelen i `docs/architecture/copy-style-guide.md`. Retta til berre å byte skjerm (`state.screen = "setup"`), aldri røre aktivitetsdata. Same gjennomgang fann og retta fleire mindre feil: forslagskort sin avkryssingsboks var det einaste klikkbare området for eit heilt kort (no ein `&lt;label&gt;` som dekker heile kortet); kategorifargesystemet frå den godkjende demoen (12 dempa fargar, `--planning`/`--marketing`/osv.) var falle ut under portering til produksjon og vart erstatta med éin hardkoda fargeplaceholder — attoppretta som `--saa-cat-*`-variablar; manglande `min-height:44px` på mobil-månadsbrikkene og aktivitets-redigeringsknappen (touch-mål under WCAG-minimumet); potensielt rå, engelske nettlesarfeiltekstar (t.d. "Failed to fetch") kunne vise seg direkte i eit norsk feilvarsel ved nettverksfeil; modaldialogen sitt Lagre/Avbryt-felt kunne rulle utanfor skjermen på korte/liggjande mobilskjermar (no fast plassert med rullande innhald mellom); to lukk-knappar mangla `aria-label`; kjeda modalopning ved import-stadfesting kunne øydeleggje tastaturfokus-retur; `disclaimer`-feltet frå API-et vart lagra, men aldri vist — no synleg i forslagsverkstaden. Verifisert visuelt (headless nettlesar, kategorifargar stadfesta ulike per kategori, modal-rulling stadfesta fast footer).

**Ikkje retta (mindre alvorsgrad, kan takast seinare):** `.saa-sgrid` sin brotpunkt (720px) tek ikkje omsyn til at Workspace-sidebaren framleis er synleg og statisk ved 768px, som gjer forslagskorta smalare enn nødvendig på nettbrett i ståande format; native HTML5-validering ("required") viser nettlesaren sin eigen (ofte engelske) feilboble før den tilpassa norske teksten for eit heilt tomt skildringsfelt.

**Ikkje testa i denne runda (krev manuell/skarp verifisering før produksjonsbruk):** faktisk levande Anthropic-kall (test-suitene mockar `fetch`), full UX/mobil-gjennomgang (bestilt, ventar på resultat).

## 0.92.1 — 2026-08-04

### Fiks: fargeramma "forsvann" i grått mot grått

Brukar peikte på det direkte: `.stat-box`/`.cap-card` sin bakgrunnsfarge
(`--color-bg`) var identisk med Console sin eigen sidebakgrunn (`.cs-main`)
-- ramma synte seg berre som ein tynn grå kant på grått mot grått, i staden
for å "stå ut" slik ho skulle. Retta, denne gongen med ein ny fargemockup
godkjent FØR koden vart endra (same disiplin som 0.92.0-runda):

- `.stat-box`/`.cap-card`/`.highlight-fieldset` (Fremhev-boksen i
  Innstillinger) fekk alle same behandling -- `background: var(--color-tint)`
  (eit lyst blått slør, skil seg frå BÅDE kvit panelbakgrunn og grå
  sidebakgrunn) + ein synleg blå kant, konsekvent gjennom heile modulen
  ("Det kan gjelde hele den modulen", eksplisitt brukarønske), ikkje berre
  dei to boksane som vart direkte kritisert.
- Tal-verdiane sjølve (Pris/Oppstartskostnad/Grenser) gjekk attende til
  `--color-text` (sort) -- brukarønske: "trenger ikke å være den kvasse
  blåfargen på pris-skriftene." Sjølve ramma (kant/bakgrunn) er framleis
  blå, berre TALET er sort.
- Luft lagt til mellom "Fremhev i forhåndsvisning"-boksen og
  "Standardmoduler"-togglen (`.9rem` → `1.6rem`) -- kjentest for tett saman.

Ingen `?v=N`-bump treng (berre inline CSS i `console/index.html` endra).

## 0.92.0 — 2026-08-04

### Priser: "Grenser" fekk endeleg ei ramme, Pris/Oppstartskostnad forenkla, fargeaksent

Framleis same dag -- brukar sende eit nytt skjermbilete etter 0.91.1: éin
raud ring rundt "kr/mnd"/"kr, engang"-teksten (verka flytande/rotete), éin
stor raud ring rundt heile "Grenser (maks inkludert)"-rada. Denne runda vart
IKKJE patcha blindt ein fjerde gong -- roten vart faktisk funnen fyrst
(sjå under), og ein ny mockup vart bygd og godkjent før koden vart endra
("Les tilbake før du endrer").

**Rotårsak, "Grenser" (reell implementeringsglipp, ikkje berre smak):** den
tidlegare godkjente mockupen synte kvar grense som eit ramma kort -- men
den ramma vart ALDRI implementert i den ekte koden i 0.91.0-runda, berre
seksjoneringa rundt heile Grenser-blokka. `.cap-field-row` sin
`repeat(auto-fit, minmax(150px,1fr))` strekte i tillegg kvart av dei tre
korta til å fylle ein heil 1fr-brei rutenett-kolonne (~300px i eit 900px
breitt panel) -- eit lite tal flytande i eit stort tomt rom, tre gonger på
rad, las ut som broten.

- **Grenser**: `priserCapFieldHtml()` gjev no kvar grense eit ekte,
  ramma `.cap-card` (`border`+`background: var(--color-surface)`), i ei
  `.cap-row` (flex, fast basisbreidde `flex: 0 1 180px` i staden for eit
  rutenett som tvinga korta til å fylle heile radbreidda).
- **Pris/Oppstartskostnad**: forenkla til reine "stat"-kort per eksplisitt
  brukarønske -- berre eit tal, INGEN "kr/mnd"/"kr, engang"-tekst attmed og
  INGEN "Veiledende sum fra modulpriser"-linje under ("Ikke noe mer på de
  to rutene enn tallet"). Det tidlegare hint-et ligg no i ein `helpIcon()`
  ved sida av kvar label i staden for å forsvinne heilt.
- **Fargeaksent** ("bruke litt farger for å skape dynamikk", eksplisitt
  brukarønske): tal-verdiane i Pris/Oppstartskostnad/Grenser er no
  `var(--color-primary)` -- attbruker det same "stat-tal"-mønsteret som
  `.an-card__val` i Analyse-fana alt etablerer, i staden for å finne opp
  ny visuell språkbruk.
- `.price-row`/`.basics-box`/`.basics-grid`/`.cap-field`/
  `.cap-field-row`/`.cap-field__unlimited`/`.price-hint` alle daude,
  fjerna.

`?v=N`: `console-core.js` (203).

## 0.91.1 — 2026-08-04

### Fiks: Pakkenavn/Kort beskrivelse så "plutselig reduserte" ut i .basics-box

Brukar sende skjermbilete av den ferskt deploya 0.91.0: `.basics-box > .field
{ max-width: 30rem }` gjorde at Pakkenavn-feltet og Kort beskrivelse-feltet
vart låst til 480px, medan Pris/Oppstartskostnad-rada rett under/over fylte
HEILE boksbreidda via `.basics-grid` -- éi og same tona/ramma boks fekk
dermed eit smalt felt, éi full-brei rad, så eit smalt felt att, noko som såg
ut som ein rendrings-feil heller enn eit medvite val. Fjerna
30rem-avgrensinga heilt -- alle felt i `.basics-box` fyller no boksen sin
fulle breidde konsekvent, slik boksen sin eigen synlege kant alt lova.

Ingen `?v=N`-bump treng (berre inline CSS i `console/index.html` endra,
ingen skript-fil).

## 0.91.0 — 2026-08-04

### Console: "Rediger pakker" seksjonert, Kundar-lista fekk stilrefresh

Same dag som 0.90.0 -- brukar meldte tilbake at "Rediger pakker" framleis
"ser dølt ut", med "mye kvitt og mye plass som gjør det uoversiktlig", og bad
om ein UI-reviewer-gjennomgang spesifikt av det. Mockup-godkjent etter éi
runde med tilbakemelding (Pris/Oppstartskostnad fylte ikkje breidda i fyrste
forslag -- retta til å dele boksen 50/50 i staden for ein tom fyrste kolonne
+ to smale felt).

**Rotårsak (UX-reviewer):** dei fire øvste felta (Pakkenavn/Pris/Oppstarts-
kostnad/Kort beskrivelse) var låst til 30rem breidde inni eit panel som kan
vere 900px+ breitt (opptil 500-600px daudt kvitrom per felt), OG hadde ingen
ramme i det heile, ulikt "Fremhev i forhåndsvisning"-boksen rett under dei --
denne inkonsekvensen var sjølve årsaka til "uoversiktleg", ikkje mangel på
farge/dekor.

- `priserPkgFieldsHtml()` (`console/console-core.js`) delt inn i fem
  `.rp-section`-blokker (Grunnleggende / Innstillinger / Grenser / Nettside-
  funksjoner / Workspace-funksjoner), kvar med ei tydeleg skiljelinje
  (`border-top`) mot den førre, i staden for berre ein uppercase-mikrolabel.
- Grunnleggande-felta samla i ein ny, tona/ramma `.basics-box`
  (`background: var(--color-bg)`, som `.an-card`-mønsteret alt brukar andre
  stader i fila). Pris og Oppstartskostnad ligg no side om side i ein
  `.basics-grid` (1fr/1fr) i staden for kvar sin fulle rad.
- Bonus-fiks: `.feat-chip.is-checked` fekk endeleg ein CSS-regel -- klassen
  vart alt sett i `priserFeatChip()`, men hadde aldri hatt ei matchande
  regel, så valde modular såg identiske ut som ikkje-valde bortsett frå
  sjølve avkryssingsboksen. Same "valgt"-mønster som `.quote-chip.is-added`.

**Kundar-lista fekk same stilrefresh** som vart vist i mockupen tidlegare
same dag (initial-ikon, status som pille i staden for laus farga tekst,
domene som undertekst) -- pluss ein reell funksjonsgap som synte seg
undervegs: **lista hadde ingen "valgt"-tilstand i det heile**, einaste måten
å sjå kven som var vald var å sjå etter sjekklista lenger nede på sida.
`kdStatusBadge()` gjer no ein pille (`kd-pill--<status>`), ny `kdInitials()`.

**UX/Mobil-reviewer same dag** (etter implementering, ikkje berre mockupen):
éin HIGH + éin MEDIUM, begge retta:

- `.basics-grid` sin `1fr 1fr` mangla `minmax(0,1fr)` -- ein bar 1fr-kolonne
  sitt automatiske minstemål er innhaldet sitt eige min-content (her: eit
  9rem breitt tal-felt + eining-tekst), som kunne tvinge `.basics-box` til å
  flyte utanfor ramma si i eit reelt trongt vindaugebelte (~901-1050px total
  viewport, verre med sidemenyen open) -- retta.
- Kundar-lista sine rader var berre klikkbare med mus/touch (ein einaste
  `click`-lyttar, ingen `tabindex`/rolle/tastatur-handtering) -- retta med
  `tabindex="0" role="button" aria-pressed`, ein `keydown`-handterar for
  Enter/mellomrom, og ein `:focus-visible`-ring, same mønster som
  `.pkg-row` i "Rediger pakker" alt brukar.

`?v=N`: `console-core.js` (202).

## 0.90.0 — 2026-08-04

### Priser: "Rediger pakker" som master/detail, valgbar forhåndsvisning, sidemeny-bugfiks

Ny runde same dag, etter at brukar fekk sjå 0.89.0 live: sidemeny-kollaps-
knappen overlappa det sentrerte merke-ikonet i det minimerte 64px-sidefeltet
(begge delte same rad) -- retta med meir topp-padding på merket i staden
(`console/index.html`, `.cs-sidebar.is-collapsed .cs-brand`).

Hovudinnhaldet: brukar peikte ut at "Rediger pakker" var "rotete og
uoversiktleg" med alle pakkane opne side om side heile tida. Same
mockup-først-arbeidsflyt som tidlegare Priser-/Innsikt-rundar -- ein
interaktiv HTML-mockup vart bygd og godkjent før noko ekte kode vart endra:

- **"Rediger pakker" → master/detail.** Ei kompakt, klikkbar pakke-liste
  (`.pkg-rail`, sticky, 260px) til venstre; berre den valde pakken sitt
  redigeringspanel (`.edit-panel`) til høgre. `priserPkgCardHtml()` delt opp
  i `priserPkgRailRowHtml()` (rad-visning) + `priserPkgFieldsHtml()` (dei
  same felta som før, uendra) + `priserEditPanelHtml()` (ny hovud/kropp/fot-
  struktur). Ny økt-lokal state `_priserEditSelected`. Å skrive i
  "Pakkenavn"/"Pris" oppdaterer rad-teksten og panel-tittelen direkte
  (målretta DOM-patch, ikkje full re-render) -- same "aldri re-render på
  kvart tastetrykk"-disiplin som `priserRefreshQuoteTotals()` frå 0.88.0.
  Full re-render (via den eksisterande `priserRerenderEditPreservingFocus()`)
  skjer framleis berre ved pakkebyte, avkryssing av featured/allStandard/
  ubegrensa-cap, eller fjerning -- alle diskrete klikk, ikkje tastetrykk.
- **Forhåndsvisning → valgbare pakker.** Nye avkryssingsbrikker
  (`.pv-select`/`.pv-chip`) over samanlikningsrutenettet, éin per pakke --
  kva som skal visast for ein gitt kunde/tilbod kan variere (brukarønske).
  Ny økt-lokal state `_priserPreviewVisible` (aldri lagra i
  `pricing_config`). "Last ned som bilde" vert `disabled` når null pakkar er
  valde, i staden for å stille no-oppe på eit tomt mål.
- Fjerna daud CSS (`.pkg-grid`/`.pkg-card*`/`.add-pkg-btn`) etter
  omstruktureringa.

**UX/Mobil-reviewer same dag**: éin BLOCKER-klasse funn (ikkje merka BLOCKER,
men same alvor som fokus-regresjonen 0.88.0 alt hadde fiksa éin gong før) +
tre MEDIUM, alle retta:

- Pakkebyte i "Rediger pakker"-lista og avkryssing i Forhåndsvisning sine
  brikker gjorde begge eit fullt re-render UTAN å ta vare på tastaturfokus --
  nøyaktig same feilklasse som `priserRerenderEditPreservingFocus()` alt
  fiksa éin gong i 0.88.0, no reintrodusert av dei to nye klikk-handterarane.
  Retta ved å eksplisitt re-fokusere den valde rada/brikka etter kvart
  re-render.
- "Lagre alle endringer" sat inni det opne pakke-panelet, rett attmed eit
  pakke-spesifikt "Fjern pakke" -- kunne feillesast som at lagringa berre
  gjaldt den eine, opne pakken. Flytta til sidenivå, utanfor `.edit-layout`,
  same plassering som før denne runda.
- Ingen `.btn:disabled`-styling fanst noko stad i Console frå før (oppdaga
  via den nye disabled-tilstanden på "Last ned som bilde") -- retta éin gong
  globalt, gjeld no alle knappar.
- Fargeveljaren for merkelapp-farge oppdaterte ikkje rad-prikken i pakke-
  lista live (same "punktoppdater i staden for re-render"-mønster som namn/
  pris hadde, men badgeColor-grenen mangla det) -- retta.
- I tillegg: 260px-lista + redigeringspanel vart trongt ved 768px med
  skrivebord-sidemenyen open (som fyrst minimerer/skjuler seg ved 700px) --
  stableringsgrensa for `.edit-layout` heva frå 700px til 900px. Ny pakke
  ("+ Ny pakke") fokuserer no rett i "Pakkenavn"-feltet.

`?v=N`: `console-core.js` (200).

Brukar bad óg om ein generell gjennomgang av dei andre Console-modulane
("fortsatt litt kjedelige") for eit meir heilskapleg utsjåande -- éin
illustrerande stilretning (initial-ikon, statuspille, hover-kant på
Kundar-lista, same fargar/rundingar som resten av Console) vart vist i
mockupen som eit diskusjonseksempel, ikkje implementert. Avventar brukar sitt
val av kva modul(ar) som skal prioriterast for ein ekte runde.

## 0.89.0 — 2026-08-04

### Priser-forbetringar: breiddemodus, minimerbar sidemeny, biletnedlasting, datagrenser

Oppfølgingsrunde rett etter at "Priser" (0.88.0, same dag) vart verifisert
live -- brukar viste eit skjermbilete av det ferdige verktøyet og bad om tre
ting i éin bolk ("Les tilbake før du endrer"):

- **Minimerbar sidemeny + breiare Priser-fane.** Console fekk ein
  minimer-knapp på sidemenyen, porta frå Workspace sitt eksisterande
  `.i-sidebar.is-collapsed`-mønster (CSS-variabel `--cs-sidebar-w`,
  `localStorage`-persistert under `cs-sidebar-collapsed`, sidan Console ikkje
  har noko `App.store`-ekvivalent). Innhaldsbreidda på Priser-fana fekk ein
  eigen `.cs-content--wide`-klasse (`max-width: 1400px`), togga sentralt i
  `renderSection()` berre for `id === "priser"` -- resten av Console (tekst-
  tunge skjema) er uendra på 720px.
- **"Last ned som bilde"-knapp i Forhåndsvisning**, for bruk i presentasjonar.
  Brukar valde eksplisitt ekte éin-klikks PNG-nedlasting (`html2canvas`)
  framfor ei enklare utskrift-til-PDF-løysing, då spurt direkte. Ny pinna
  CDN-avhengigheit `html2canvas@1.4.1` (sjekka via jsdelivr sin
  `resolved`-endepunkt før pinning, som CLAUDE.md krev). Rasterer
  `.compare-grid` klientsida til eit `<canvas>`, 2× skalert for skarpe bilete
  ved projisering. Reint lokalt (`URL.createObjectURL` + `<a download>`),
  ingen serverrundtur, ingen ny CSP-origin (alt dekt av eksisterande
  `cdn.jsdelivr.net`-kvitelisting).
- **Tre nye per-pakke datagrenser**: `storageGB` (datalagring), 
  `emailsPerMonth` (e-postutsendingar), `usersIncluded` (brukarkontoar) --
  reint informative tal vist i kunde-samanlikninga, håndhevast ikkje teknisk
  noko stad enno (forklart via ny `helpIcon()` på feltgruppa, per
  copy-style-guide sin regel om at nye, ikkje-opplagde felt skal ha hint).
  `-1` er ein sentinel-verdi for "Ubegrenset" (eiga avkryssingsboks per felt,
  deaktiverer tal-feltet når kryssa av). Eksisterande pakkar får
  fornuftige standardverdiar attributert etter prisnivå
  (`priserDefaultCapsFor()`, tre buckets etter `pkg.price`) ved innlasting,
  slik at gamle lagra pakkar utan desse felta ikkje bryt valideringa neste
  gong nokon lagrar. Ingen ny migrasjon trengst (`pricing_config.data` er
  allereie fleksibel `jsonb`) -- berre `PKG_ALLOWED_KEYS` utvida frå 12 til 15
  nøklar og ein ny `validateCapField()`-validator (heiltal i [-1, 1 000 000])
  lagt til i `set_pricing_config`-handlinga i
  `supabase-control/supabase/functions/tenant-admin/index.ts`.

`?v=N`: `console-core.js` (198).

**Security Auditor + UX/Mobil-reviewer gjennomført same dag, uavhengig av
kvarandre.** Security Auditor: ingen BLOCKER/HIGH/MEDIUM (to trivielle
LOW-notat, ingen fiks trengst). UX/Mobil-reviewer: éin HIGH, fire MEDIUM,
alle retta:

- **HIGH** -- ein "minimert sidemeny"-preferanse sett på skrivebord bløda inn
  i mobil-hamburgermenyen (`.is-collapsed` var ikkje viewport-skopa), som
  gøymde tenant-veljar/navn/logg-ut der menyen alt er eit eige slide-out-
  panel. Retta med ein overstyrande regel inni `@media (max-width: 700px)`
  som tvingar sidemenyen attende til full breidde/synlegheit uavhengig av
  `localStorage`-verdien.
- Deaktivert tal-felt (ved "Ubegrenset") hadde ingen visuell skilnad frå eit
  aktivt felt -- lagt til `.field input:disabled { opacity:.55;
  cursor:not-allowed }`.
- "Ubegrenset"-avkryssinga sitt klikkbare område var mindre enn den
  etablerte `.cs-checkbox-label`-padding-konvensjonen elles i same fil --
  retta til same padding/hover-mønster.
- Ei feila biletgenerering kunne lekke ei rå, engelsk nettlesar-/
  html2canvas-unnataksmelding rett inn i brukarvend tekst -- retta til fast
  norsk feiltekst, den tekniske detaljen går no berre til
  `console.error()`.

## 0.88.0 — 2026-08-04

### Ny: "Priser" -- internt pris-/pakkeplanleggingsverktøy i Console

Brukar ba om ein "pris/produkt-arkpakke" i Console rett etter Innsikt-
redesignet -- suggesjonar for pris og ulike pakketeringar av løysinga, med
manuell prisredigering. Same mockup-først-arbeidsflyt som Innsikt: ein
interaktiv HTML-mockup vart bygd og iterert over fleire rundar (fremhevet
pakke som manuelt val med eiga farge/merkelapptekst, fritekst-tags per
modul, Workspace-funksjonar på lik linje med Nettside-funksjonar, ein
bakomliggande modul-prisliste med eiga "Bygg tilbud"-kalkulator og
oppstartskostnad, og til slutt ein brukarvalgt "Standard"-merking per modul
som lèt lange modullister kollapsast til "Alle standardmoduler" + berre dei
reelle tillegga) før noko ekte kode vart skriven.

**Arkitektur -- retta undervegs, ikkje fyrste forslag.** Fyrste Arkitekt-
konsultasjon tilrådde direkte RLS-gata CRUD-skriving frå Console (etter
mønster frå den opphavlege `operators_operator_all`-policyen). Før
implementering synte direkte lesing av migrasjonshistorikken at denne
policyen alt var FJERNA to gonger tidlegare (`tenants` i
`20260708204201_restrict_tenants_operator_to_read_only.sql`, `operators` i
`20260708222400_restrict_operators_to_read_only.sql`) -- begge gonger fordi
direkte autentisert CRUD hoppar forbi `broker_audit_log`. Ein ny
Arkitekt-runde med dette funnet gav ei retta løysing:

- **Ny tabell** `pricing_config` (`supabase-control/supabase/migrations/
  20260804120000_add_pricing_config.sql`) -- éin singleton-rad, jsonb-
  dokument `{ prices: {f,i}, packages: [...] }`. RLS: berre SELECT for
  `authenticated`, ingen INSERT/UPDATE/DELETE-policy i det heile. Eksplisitt
  `service_role`-grant lagt til defensivt (ADR-0009-leksjonen: BYPASSRLS er
  ikkje det same som objekt-grantar).
- **Ny, audited handling** `set_pricing_config` i `supabase-control/
  supabase/functions/tenant-admin/index.ts` -- plassert som ein tenant_id-
  uavhengig tidleg-retur-blokk (same mønster som `register_tenant`), difor
  underlagt funksjonen sin eksisterande blanke superadmin-sperre. Ingen
  `get_pricing_config`-handling med vilje -- lesing går direkte mot
  RLS-SELECT-en, sidan å rute lesing gjennom superadmin-sperra ville gjort
  lesing STRENGARE enn skrive-RLS-en treng vere. Fullstendig server-sida
  validering (nøkkel-kvitelister, tal-/streng-/lengd-grenser, strengt
  hex-format på `badgeColor` sidan den vert interpolert inn i eit
  style=-attributt klientsida), auditert til `broker_audit_log` med
  `tenant_id = NULL`.
- **Console** (`console/console-core.js`, ny `renderPriser()` + ~20
  hjelpefunksjonar, ny `NAV_ITEMS`-oppføring mellom "Modular" og "Analyse"):
  fire underfaner (Rediger pakker / Modulpriser / Bygg tilbud /
  Forhåndsvisning), attbruker eksisterande `FEAT_LABELS`/`IFEAT_LABELS`
  direkte i staden for å duplisere dei. All brukarredigerbar tekst går
  gjennom `C.esc()`; `badgeColor` valideres på nytt klientsida
  (`priserSafeHex()`) før interpolering, som eit andre forsvarslag mot
  lagra data som kan vere eldre enn server-valideringa.

`?v=N`: `console-core.js` (196).

**Security Auditor + UX/Mobil-reviewer gjennomført same dag** (begge
subagentane feila fyrste gong på ei mellombels økt-grense, lukkast ved
umiddelbar reprøving):

- **Security Auditor**: ingen BLOCKER/HIGH/MEDIUM-funn. To LOW-funn retta:
  ingen øvre grense på pris-/oppstartskostnad-tal (lagt til, maks 10 000 000
  kr), og ingen kontroll mot duplikate pakke-id-ar server-sida (lagt til --
  klientsida sin `.find()` løyser alltid til fyrste treff, så eit duplikat
  kunne fått "Fjern pakke"/feltredigering til å ramme feil kort).
- **UX/Mobil-reviewer**: to BLOCKER, fire HIGH, fleire MEDIUM. Alle
  BLOCKER/HIGH retta:
  - "Generell oppstartskostnad"-feltet i Bygg tilbud mista tastaturfokus på
    KVART tastetrykk (eit fullt `wrap.innerHTML`-re-render på `input`-
    hendinga) -- retta til ei målretta oppdatering av berre sum-tala.
  - Modulpriser-tabellen klipte oppstartskostnad-kolonna heilt vekk og
    utilgjengeleg på telefonbreidde (`overflow:hidden` i staden for
    `overflow-x:auto`) -- retta.
  - "Fjern pakke" hadde ingen stadfesting i det heile, ulikt kvar annan
    destruktiv handling i same fil -- lagt til ei Tier B-stadfesting.
  - Kvart avkryssa modul-/featured-/allStandard-felt utløyste eit fullt
    pane-re-render som mista tastaturfokus -- lagt til
    `priserRerenderEditPreservingFocus()`, som fangar og gjenopprettar
    fokusert element rundt re-renderinga.
  - "Standardmoduler"-brytaren hadde ingen forklaring sjølv om åtferda
    (dynamisk, ikkje eit augeblinksbilete) er reelt non-obvious -- lagt til
    `helpIcon()`.
  - "Bygg tilbud" sin tomt-state-tekst sa "til venstre" sjølv om plukkeren
    stables OVER handlekurven på alle skjermar ≤800px -- retta ordlyd.
  - Fleire touch-mål under 44px (`.seg button`, `.pkg-card__del`,
    `.quote-chip button`) -- retta med `min-height:44px`. "Standard"-
    avkryssinga i Modulpriser var ikkje pakka i ein `<label>` (lite
    trykkflate) -- retta.
  - "×"-knappane i handlekurven mangla `aria-label` -- lagt til.
  - Modul-chips attbrukte ikkje dei eksisterande `FEAT_HELP`/`IFEAT_HELP`-
    forklaringane Modular-fana alt har for same nøklar -- lagt til.
  - Delt "Lagre endringer"-knapp kunne mistolkast som at han berre lagra
    aktiv underfane -- omdøypt til "Lagre alle endringer".
  - `priserRefreshPkgHints()` var reelt daud kode (aldri kalla, sidan
    enkelt-pane-arkitekturen ikkje treng tverr-pane-oppdatering) -- fjerna.

**Merga til main og fullt deploya (2026-08-04, brukargodkjent steg for
steg):** PR pusha og merga (squash), `tenant-admin`-funksjonen (med den nye
`set_pricing_config`-handlinga) deploya til `vibeverk-control`
(`jxoglthrnshabqmdmnui`) og stadfesta live via CLI. Sjølve migrasjonen
(`20260804120000_add_pricing_config.sql`) vart køyrd MANUELT av brukaren via
Supabase Dashboard sin SQL Editor (ikkje `supabase db push` -- ingen
pooler-connection-string var tilgjengeleg i denne økta) -- **stadfesta med
fire separate, eksplisitte verifiseringsspørringar** i tråd med CLAUDE.md
sitt eige "eit 'Success'-svar frå Dashboard stadfestar ingenting"-prinsipp,
ikkje berre stola på eit grønt SQL-resultat:

- Rad + seed-data: `id=true`, `n_packages=3` -- stadfesta.
- `relrowsecurity=true` -- RLS faktisk PÅ, ikkje berre ein policy definert
  utan handheving.
- Nøyaktig éin policy (`pricing_config_operator_read`, `r`/SELECT, rolle
  `authenticated`) -- stadfesta.
- Grants: **fann eit reelt avvik frå det dokumenterte** -- `service_role`
  hadde full CRUD (DELETE/INSERT/REFERENCES/TRIGGER/TRUNCATE i tillegg til
  den tiltenkte SELECT/UPDATE), ikkje berre dei to migrasjonen eksplisitt
  granta. Stadfesta årsak: Supabase sin eigen plattform-standard-ACL granta
  `service_role` alt på tabellnivå ved oppretting, uavhengig av kva
  migrasjonen sjølv skreiv -- same klasse funn som den alt dokumenterte
  FUNCTION-ACL-fella i CLAUDE.md (ADR-0009), berre no stadfesta å gjelde
  TABELLAR òg i dette prosjektet. Ikkje ein ny sikkerheitsrisiko i praksis
  (`service_role` har uansett full DB-tilgang via BYPASSRLS og er ein
  reint server-sida-nøkkel), men retta likevel til å faktisk matche det
  dokumenterte minste-privilegium-prinsippet: `revoke all ... from
  service_role` + `grant select, update ...` køyrd manuelt, stadfesta
  på nytt til nøyaktig SELECT/UPDATE.

**Kjent, ikkje-blokkerande følgje:** sidan migrasjonen vart køyrd via
Dashboard og ikkje CLI, veit ikkje Supabase sin eigen migrasjonshistorikk
(`supabase_migrations.schema_migrations`) at han er brukt -- ein framtidig
`supabase db push --db-url ... ` mot `vibeverk-control` kan prøve å køyre
han på nytt og feile på "tabellen finst alt". Bør rettast med
`supabase migration repair 20260804120000 --status applied` (krev
pooler-connection-string) neste gong nokon har den tilgjengeleg -- ikkje
gjort i denne økta.

**Status: Priser-fana er no fullt funksjonell i produksjon** (`vibeverk-control`).

### Ny: "Innsikt" -- sidetellings-panelet redesigna som eige dashboard, eigen fane

Brukar bad om ein skikkeleg designrunde på sidetellings-panelet ("gjøre dette
vesentlig bedre og mer 'dashboard'-aktig") -- rett etter at 0.86.1 avslutta
"unike besøkjande"-diskusjonen med "neste fokus: polere/optimalisere
sidetellingsmodulen slik han er i dag". Arkitekten (data-/arkitektursida)
og UX/Mobil-reviewer (visuell/UX-sida) vart konsulterte uavhengig av
kvarandre, deretter bygd ein interaktiv HTML-mockup (fiktive tal) og
iterert saman med brukaren over fleire rundar -- inkludert ein eigen
Arkitekt-gjennomgang av sjølve implementasjonsplanen (periode-slicing,
`MAX_ROWS`, trend-generalisering) før koding starta.

**Eigen "Innsikt"-kategori i adminpanelet.** `ADMIN_CATEGORIES` (`core.js`)
fekk ein ny fjerde kategori: `Design | Innhold | Henvendelser | Innsikt |
Innstillinger | Min konto`. "Analyse"-fana (intern id framleis `"analyse"`)
flytta ut av "Innstillinger" til denne nye kategorien og heiter no
"Innsikt". Halde admin-only, same tilgangsnivå som før.

**Henvendelsestala er no ein alltid-synleg header.** "Denne måneden" og eit
redesigna "Status (åpne/løst)" (opne-talet er hovudtalet i kvart kort, med
ei løyst-framdriftslinje og "X av Y løyst"-note, i staden for to
likestilte tal) vert vist øvst i Innsikt-fana uansett om kunden har
sidetellingsmodulen eller ikkje.

**Periodevalg (7/30/90 dagar), overordna for heile dashboardet.**
`module-sidetelling.js` hentar no alltid det maksimale vindauget (90
dagar, éin spørring) og filtrerer/aggregerer klientside per valt periode
-- ingen ny spørring ved periodebyte. "Trender" er generalisert frå den
faste "siste 7 mot føregåande 7 dagar" til "andre halvdel av valt periode
mot første halvdel". 90-dagarsvisinga viser vekentlege søyler i staden for
90 tynne dagssøyler.

**Sub-faner i staden for éin lang scroll**: Oversikt / Sider / Kilder &
enheter. **To nye KPI-ar** (avvisningsrate, sider per besøk), gratis frå
eksisterande sesjonsgruppering. **Konverteringstopplista** ("Henvendelser
fra disse sidene") er erstatta med ein samla, framleis bevisst tona-ned
trakt (sidevisning → CTA-klikk → henvendelse) -- det opne juridiske
spørsmålet rundt konverteringskoplinga (sjå `docs/roadmap/ROADMAP.md`
punkt 6 og `docs/architecture/sidetelling.md` sitt "Ope juridisk
spørsmål"-avsnitt -- IKKJE ADR-0013, som gjeld eit anna tema, unike
besøkjande) er uendra, berre presentasjonen. **Ikkje-modul-fallback**: manglar kunden
sidetellingsmodulen, vert berre henvendelsestala vist, pluss ein kort
teaser-tekst om oppgradering (same mønster som andre ukjøpte modular).

**Vurdert og bevisst utsett i denne runda**: eit ukedag/tid-på-døgnet-
varmekart vart faktisk bygd i mockup-form, men trekt ut etter
brukartilbakemelding ("ikke helt fornøyd med den") -- ikkje avvist på
prinsipp, berre utsett til visualiseringa er betre gjennomtenkt.

Full teknisk historie og grunngjeving: `docs/architecture/sidetelling.md`
(Fase 3-avsnittet). `?v=N`: `core.js` (86 i alle tre HTML-innganger, sidan
`ADMIN_CATEGORIES`/`allowedCategoriesForRole`/`buildAdminTabs`/
`adminAnalyse` alle endra), `module-sidetelling.js` (8, index.html +
admin/index.html), `console-core.js` (195).

**Oppfølging same dag, etter Security Auditor + UX/Mobil-reviewer (obligatorisk
før produksjon per CLAUDE.md, sidan endringa rører rollebasert fane-synlegheit
og betydelege UI-endringar):**
- **Security Auditor**: ingen BLOCKER/HIGH/MEDIUM-funn. Stadfesta uavhengig at
  `allowedCategoriesForRole()` berre gjev "innsikt" til admin-greina (ikkje
  editor/member), at ingen annan fane arva kategorien ved eit uhell, og at
  server-sida RLS-en (`is_admin_or_owner()`) framleis er den reelle
  sperra uansett klientside-tilstand. Éin LOW-merknad (manglande
  regresjonstest for at editor/member IKKJE ser Innsikt-kategorien) -- notert
  som oppfølgingskandidat, ikkje retta no.
- **UX/Mobil-reviewer**: retta tre reelle funn -- (1) periodevalg-/sub-fane-
  knappane var under 44px berøringsmål (lagt til `min-height:44px`), (2)
  gjentatte klikk på "Oppdater" hopa opp duplikate delegerte klikk-lyttarar
  på søyle-tooltipen (reell lekkasje -- retta ved å binde denne éin gong per
  container, verna med eit flagg, i staden for på nytt ved kvart
  `mountPanel()`-kall), (3) søyle-tooltipen hadde ingen tastatur-/skjermlesar-
  tilgang (lagt til `tabindex`/`role="img"`/`aria-label` + Enter/mellomrom-
  handtering). Retta i tillegg ein ARIA-mangel (sub-fanene hadde
  `role="tablist"` utan matchande `role="tab"`/`aria-selected`/
  `aria-controls` på knappane), ein pre-eksisterande (ikkje innført av denne
  runda) inkonsekvens der `.an-heading` var eit tydeleg eyebrow-nivå på
  `index.html` sitt `#admin`-overlegg, men visuelt uskilt frå widget-titlane
  på `admin/index.html`, og gav minste einingsfordelings-segment ei
  minimumsbreidde (`min-width:3px`) så det ikkje forsvinn heilt ved svært
  skeive fordelingar. Lagt til 12 nye test-assertions som dekkjer sub-fane-
  bytte, periodevalg-filtrering og søyle-tooltip (klikk + tastatur +
  gjentatt-"Oppdater"-regresjon).
- Ikkje retta no (krev live augnemål på ein ekte skjerm, ikkje kodegjennomgang
  åleine): tettleiken på 30 daglege søyler på svært smale mobilskjermar, og
  2-kolonne-grafraden sin klemme ved ~768px (iPad-portrettbreidde) -- begge
  notert som oppfølgingskandidatar i samtalen, ikkje avviste.

**Verifisert:** alle tre testsuiter grøne (676/180/37, 0 FEIL) -- nye/
oppdaterte assertions dekkjer kategoriflyttinga, det redesigna
Status-kortet, periodeavhengig visning (relative testdatoar i staden for
faste, sidan reell klientside periode-slicing no gjer visinga avhengig av
Date.now()), den nye aggregerte henvendelsestrakta, og dei tre nye
interaktive kontrollane (sub-faner, periodevalg, søyle-tooltip).

## 0.86.1 — 2026-08-03

### Avgjerd: "unike besøkjande" AVVIST for sidetellinga, ikkje berre utsett

Ingen kode endra -- rein avgjerds-/dokumentasjonsrunde. Brukar bad Codex
(uavhengig AI-verktøy) om eit sjølvstendig teknisk forslag for korleis
"unike besøkjande siste 30 dagar" kunne reknast ut innanfor sidetellinga
sine tre grunnprinsipp (native/gratis, ingen API-kall, cookiefritt).
Forslaget (ei privat, aggregert HyperLogLog-skisse, HMAC via pgcrypto,
roterande nøkkelgenerasjonar, `pg_cron`-oppdrydding) vart deretter teke
til Vibeverk-arkitekten for ei uavhengig, kritisk vurdering -- same
to-stegs mønster som Nettsidehelse-modulen sitt opphav (Codex-forslag →
Arkitekt-gjennomgang).

**Viktig funn undervegs**: det tidlegare forslaget i
`docs/architecture/sidetelling.md` (Postgres sin `inet_client_addr()` +
dagleg salta hash, notert som "teknisk mogleg" i Fase 2-avslutninga
same dag) var **stadfesta feil** av både Codex og Arkitekten --
`inet_client_addr()` returnerer i Supabase/PostgREST-arkitekturen IP-en
til PostgREST/pooler-laget, ikkje den besøkjande sin eigen IP. Retta i
same runde.

**Konklusjon (Claude + Arkitekt, samstemte, uavhengig utleia)**: teknisk
mogleg innanfor prinsippa, men uforholdsmessig komplisert (eigen HLL i
rein PL/pgSQL, Supabase har inga ferdig utviding) for verdien han gjev
Vibeverk sine faktiske kundar (små SMB-ar, typisk få hundre besøk/
månad) -- identitets-proxy-feilen frå delte IP-ar/nettverk (kontor,
skule, CGNAT) kan gje opptil 400 % feil i begge retningar, langt større
enn sjølve HLL-presisjonen (~1,6 %). Det enklare alternativet (ein
privat token-tabell med 35 dagars levetid) vart òg avvist -- reelt sett
ein server-side cookie-erstattar, i strid med produktposisjoneringa.

**Produktavgjerd (brukar)**: Vibeverk sin eigen sidetellingsmodul held
fram bevisst enkel og ærleg. Kundar som treng ekte unike-besøkjande-tal
vert tilviste til Plausible (alt støtta) eller Google Analytics som
eksternt/"premium" alternativ, i staden for at Vibeverk byggjer ein
eigen, kompleks og usikker versjon. Neste fokus: polere/optimalisere
sidetellingsmodulen slik han er i dag, ikkje utvide omfanget.

**Dokumentasjon oppdatert i same runde**: `docs/architecture/
sidetelling.md` ("Bevisst ikkje bygd"-avsnittet utvida med full
grunngjeving, den feilaktige `inet_client_addr()`-skissa fjerna),
`docs/roadmap/ROADMAP.md` ("Later"-avsnittet), `docs/project/
CURRENT_STATE.md` (den gamle "Fase 2 ... not started"-setninga var
forelda etter at Fase 2 faktisk vart bygd v0.81.0-0.84.0, retta av
Project Historian same runde), og eit nytt
`docs/decisions/ADR-0013-unique-visitors-rejected.md` -- dette er ei
reell, stadfesta produktavgjerd (eksplisitt brukarval, grunngjeve av to
uavhengige kjelder) meint å vare, ikkje berre eit kodemønster, så ho
oppfyller ADR-kriteria i `docs/decisions/README.md`.

## 0.86.0 — 2026-08-03

### Retta: favicon (nettlesar-fana) fell no tilbake til Logo-URL

Brukarfunn: nettlesar-fana viste ingenting for kundar som berre hadde
fylt ut Logo-URL, ikkje det separate Favicon-URL-feltet. Rotårsak:
`apple-touch-icon`-taggen (iOS "Legg til på Heimskjerm") har alt hatt ein
fallback til `logoUrl` når `favicon` er tomt -- sjølve favicon-taggen
(`<link rel="icon">`) hadde det inkonsekvent nok ikkje, og ingen
`favicon.ico` finst som siste utveg ved rota av nettstaden heller.

Retta til å bruke same fallback-logikk begge stader (`applyMeta()` i
`core.js`). Hjelpetekstane ved Favicon-URL-feltet (Web-admin sin
Design → SEO og Console sin tilsvarande fane) oppdaterte til å nemne
dette eksplisitt.

`?v=N`: `core.js` (85 i index.html/admin, 84 i console/workspace),
`console-core.js` (193).

**Verifisert:** alle tre testsuiter grøne (662/180/37, 0 FEIL) -- ny
assertion stadfestar at `<link rel="icon">` no fell tilbake til
`logoUrl`, same mønster som den eksisterande testen for
`apple-touch-icon`.

## 0.85.0 — 2026-08-03

### Ny: modulbasert brukerveiledning i Web-admin

"?"-knapp i admin-modalen sitt hovud, ved sida av fullskjerm-knappen
(same opt-in-mønster i `C.modal()` som `fullscreenToggle` alt bruker --
ny `helpToggle`-parameter, sendt kun frå `renderAdminPanel()`, held
funksjonen avgrensa til Web-admin slik ønska, ingen andre modal-kallarar
i Workspace/Console påverka).

Opnar ei enkel, scrollbar oversikt (gjenbruker same overlegg-mønster som
`openReplyModal()`) med eitt kapittel per modul kunden faktisk har --
Innhald/Aktuelt/Kontakt alltid, resten (Design, Analyse, Booking,
Tilbud, Referanser, Spørsmål og svar, Mediebank, Chat, Kunder) styrt av
nøyaktig same feature-flagg-sjekk (`feat()`/`CFG.features.x === true`)
som `buildAdminTabs()` alt bruker for å byggje fanelista -- ingen ny
"kva modular har kunden"-logikk å vedlikehalde to stader.

Modular kunden IKKJE har, vert IKKJE utelatne heilt: dei vises i ei
eiga "Flere moduler tilgjengelig"-liste nedst, med ei kort, fristande
oppsummering (brukarval -- kan gjere kunden nysgjerrig på oppgradering)
i staden for full bruksrettleiing.

Innhaldet er statisk, skrive av Vibeverk (ikkje kunderedigerbart) --
medvite enkelt for denne runda, per brukarens eige ønske om ein
fungerande, dynamisk fyrsteversjon framfor perfekt innhald. Vert
oppdatert etter kvart.

**Oppfølging same dag, etter brukartilbakemelding ("design-messig veldig
tynn", teksten måtte vere meir fortellande):**
- **Modalen er no vesentleg breiare** (`min(980px,96vw)` mot `640px`
  før) med ein eigen sidebar-navigasjon (kapittelliste med ikon, ved
  sida av innhaldet) i staden for ei enkel rad med lenke-piller over
  teksten.
- **Klikk på "?" mens admin-panelet IKKJE er i fullskjerm, slår no på
  fullskjerm automatisk** (same `adminFullscreen`-tilstand som den
  eksisterande fullskjerm-knappen), FØR sjølve rettleiingsmodalen opnar
  -- gir meir plass til den breiare modalen. Denne omrenderinga er
  pakka i eit `try`/`catch`: skulle noko uventa feile i den aktive fana
  sin eigen render-funksjon undervegs (stadfesta reelt mogleg under
  visuell verifisering med ein forenkla Playwright-mock), skal ikkje
  det hindre sjølve rettleiingsmodalen i å opne.
- **Alle kapiteltekstar omskrivne frå korte stikkord til fortellande
  avsnitt** -- skrivne for ein bedriftseigar utan datakunnskap: kva
  modulen er, kvifor han er nyttig i kvardagsspråk, og korleis han vert
  brukt. Teaser-tekstane for modular kunden ikkje har fekk tilsvarande,
  om enn kortare, utdjuping.
- Kvart kapittel har no eit ikon (gjenbruker `C.icon()`/Tabler-
  ikonsettet, alle namn stadfesta å finnast i den pinna
  `@tabler/icons-webfont@3.0.0`-versjonen før bruk).

`?v=N`: `components.js` (20), `core.js` (84 i index.html/admin, 83 i
console/workspace), `console-core.js` (192).

**Verifisert:** alle tre testsuiter grøne (661/180/37, 0 FEIL) -- inkl.
15 assertions for brukerveiledninga (knapp finst, fullskjerm-utløysing,
modal opnar/lukkar/opnar på nytt, aktive modular viser full tekst,
inaktive viser berre teaser, sidebar listar berre aktive kapittel).
Visuelt stadfesta med Playwright-skjermbilete (topp + botn av
innhaldet, inkl. sidebar og fullskjermtilstand).

## 0.84.0 — 2026-08-03

### Ny: Fase 2 steg 3b — konverteringskobling (leads/bookings ↔ inngangsside)

Tredje og siste steg i denne Fase 2-runda. Ny, nullbar
`analytics_session_id`-kolonne på `leads` og `bookings` (ingen FK, same
laus-kopling-mønster som `leads.chat_id`) -- `insert_anon_lead()`/
`insert_anon_booking()` utvida med `p_analytics_session_id text DEFAULT
NULL`, sett frå klienten via `App.getAnalyticsSessionId()` (steg 3a).
Postgres-fallgruva (ny overlasta funksjon ved parameterutviding) handtert
eksplisitt igjen -- begge gamle signaturar droppa eksplisitt.

Nytt i Analyse-panelet: "Henvendelser fra disse sidene" -- viser KOR
MANGE henvendelser (kontakt/tilbod/booking) som kan sporast til besøk
som starta på kvar side, gruppert på inngangsside. Hentar **berre**
`analytics_session_id`+`created_at` frå leads/bookings (aldri namn/e-
post/melding), koplar mot sidetellinga sine eigne pageview-sesjonar
klientsida. Feilar denne spørringa (t.d. RLS/nettverk), rendrast resten
av panelet framleis normalt -- konverteringsdelen uteblir berre.

**Privacy Advisor-gjennomgang før deploy (obligatorisk, sidan dette
koplar analysedata mot ekte persondata) fann eit ope juridisk spørsmål,
ikkje ein teknisk feil:** implementasjonen sjølv vart vurdert solid
(`analytics_session_id` er stadfesta ALDRI eksponert i Web-admin sitt
UI/CSV/JSON-eksport -- bevisst haldt utanfor `dbLeadToJs`/
`dbBookingToJs` sine kvitelister -- og GDPR-sletting handterer kolonna
korrekt, sidan ho berre er ein del av same rad som vert sletta). MEN:
for DEI sesjonane som faktisk konverterer, skapar koplinga ein indirekte
veg frå elles anonyme pageview-rader til ein namngjeven person (via
lead/booking sine kontaktopplysningar) -- eit spørsmål om dette framleis
er dekt av same unntak sidetellinga sjølv byggjer på (ekomlova §3-1-
typen argumentasjon), eller om det krev eit sterkare/anna rettsleg
grunnlag. **Kan ikkje avgjerast av kodegjennomgang åleine.**

**Brukarval 2026-08-03**: deploy no, likevel, som del av det same
`features.sidetelling`-flagget -- ingen ekte kundar er påverka i dag
(berre Vibeverk sjølv og Sunnvask-demo). Det juridiske spørsmålet, samt
tilrådinga om å skilje ut eit eige feature-flagg og oppdatere
personvernsteksten (utkast levert av Privacy Advisor, IKKJE juridisk
kvalitetssikra), er lagt inn som eit eksplisitt "MÅ AVKLARAST FØR NOKON
EKTE KUNDE"-punkt i `docs/roadmap/ROADMAP.md` "Next" -- skal ikkje
gløymast før dette nokon gong vert slått på for ein reell kunde.

**Verifisert:** alle tre testsuiter grøne (648/180/37, 0 FEIL) -- inkl.
ny dedikert testblokk for sjølve konverteringskoblinga (multi-tabell
falsk Supabase-klient), og ei retting av ein reell testrigg-feil
oppdaga undervegs (`addLead()` sin eigen, interne `_sb`-variabel vert
fanga FØR `App.supabase` kan overstyrast i etterkant -- ulikt
`module-sidetelling.js`, som les `App.supabase` friskt ved eiga, seinare
lasting; retta ved å stubbe `window.supabase.createClient()` sjølv FØR
`core.js` vert evaluert, i staden for å setje `App.supabase` i etterkant).

`?v=N`: `core.js` (83 i index.html/admin, 82 i console/workspace),
`module-booking.js` (18), `module-sidetelling.js` (6), `console-core.js`
(191).

**Fase 2 er no fullført** (bot-filtrering/einingsmetadata, Trendar,
konverteringskobling). Attverande: dokumentasjon
(`docs/architecture/sidetelling.md`), deretter avklaring av Fase 2.5
(unike besøkjande) og Fase 3 (rollup-tabell, CMS-per-side-widget).

## 0.83.0 — 2026-08-03

### Refaktor: Fase 2 steg 3a — delt session-ID (`App.getAnalyticsSessionId()`)

Førebuande steg for konverteringskobling (steg 3b). Session-ID-
generering flytta frå `module-sidetelling.js` sin private `sessionId()`
til ein ny, delt `App.getAnalyticsSessionId()` i `core.js` -- Arkitekt-
tilråding frå konsultasjonen 2026-08-03: heile `module-sidetelling.js`
køyrer inni `App.ready(function (CFG) { if (!CFG.features.sidetelling)
return; ... })`, så ei eksponering INNI modulen ville vore utilgjengeleg
akkurat når Kontakt-/Tilbod-/Booking-skjemaa (som fungerer heilt
uavhengig av om sidetelling er på/av) treng ho i steg 3b.

`getAnalyticsSessionId()` returnerer `null` når `features.sidetelling`
er av (nytt -- gjer det trygt for skjemaa å kalle henne ubetinga, utan
eigne `typeof`-sjekkar mot ein modul dei ikkje skal kjenne til), elles
same åtferd/fallback (`"no-session-storage"` viss sessionStorage kastar)
som den opphavlege funksjonen alltid har hatt. `module-sidetelling.js`
sin eigen `send()` kallar no `App.getAnalyticsSessionId()` i staden --
éin einaste kjelde til sanning for `sessionStorage`-nøkkelen
`vw-sidetelling-session`.

Ingen synleg åtferdsendring for sluttbrukar i dette steget -- reint
internt refaktor, klar grunnmur for steg 3b.

`?v=N`: `core.js` (82 i index.html/admin, 81 i console/workspace),
`module-sidetelling.js` (5), `console-core.js` (190).

**Neste**: Steg 3b (konverteringskobling mot leads/bookings, ny
migrasjon) + Privacy Advisor-gjennomgang før lansering.

## 0.82.0 — 2026-08-03

### Ny: Fase 2 steg 2 — "Trender" i Analyse

Andre steg i Fase 2. Rein periode-mot-periode-samanlikning (siste 7 dagar
mot dei 7 dagane før), same "rule-based, ingen AI"-filosofi som
`computeWebsiteHealth()` (Nettsidehelse) -- ingen ekstern kall, berre
enkel rekning på tal Analyse-panelet alt hentar.

**Ingen ny spørring, ingen migrasjon**: samanlikningsvindauget (14 dagar
totalt) er godt innanfor dei 30 dagane `fetchStats()` alt hentar --
unngår dermed heilt den MAX_ROWS-faren Arkitekten peika på ved
konsultasjonen (å hente to gonger så mykje data mot same tak kunne gjeve
ein systematisk skeiv, ikkje berre unøyaktig, trend).

**Fem funn, vist berre når relevant** (t.d. "endra mest populære side"
vert utelate om ho er uendra): trafikkendring i %, beste dag, endring i
konverteringsrate (prosentpoeng), størst endring i henvisingskjelde,
endra mest populære side. Vises ikkje i det heile før det finst
sidevisningar i den nyaste 7-dagarsperioden (unngår eit tomt/meiningslaust
"0 % endring"-utsagn for ein heilt fersk kunde).

`?v=N`: `module-sidetelling.js` (4), `console-core.js` (189).

**Neste**: Steg 3 (konverteringskobling mot leads/bookings) -- krev
migrasjon + Privacy Advisor-gjennomgang før lansering.

## 0.81.0 — 2026-08-03

### Ny: Fase 2 steg 1 — einingskategori + bot-filtrering i Analyse

Fyrste steg i Fase 2 (sjå `docs/roadmap/ROADMAP.md`). Arkitekt-konsultert
FØR koding (heile Fase 2-bunten -- bot-filtrering/einingsmetadata,
"Trendar", konverteringskobling -- vurdert samla). Fire arkitektoniske
avgjerder følgde direkte av den konsultasjonen:

1. **Førehandsrekna, kategoriske felt (`device_type`, `is_bot`) i staden
   for ein rå `navigator.userAgent`-streng** -- same mønster som
   `chat_conversations.browser/os` (`module-chat.js`) alt bruker i
   produksjon. Ein rå UA-streng er ein fingerprinting-vektor, ein
   kategorisk verdi som "mobil"/"pc" er det ikkje.
2. Bot-filtrering og einingskategorisering vart bygd saman -- delar
   datakjelde (User-Agent), same personvernsrisiko-klasse.
3. `device_type` avgjort klientsida via enkel skjermbreidde-terskel
   (mobil/nettbrett/pc), `is_bot` via ein enkel regex mot kjende
   bot-signaturar -- ingen ekstern bot-deteksjonsteneste (prinsipp 2:
   ingen API-kall), ikkje meint som ei tryggingssperre.
4. Postgres-fallgruve handtert eksplisitt: å utvide
   `insert_analytics_event()` sin parameterliste skapar ein NY, overlasta
   funksjon ved sida av den gamle 5-argument-versjonen -- `CREATE OR
   REPLACE` erstattar berre identiske signaturar. Den gamle signaturen
   vart droppa eksplisitt (`DROP FUNCTION IF EXISTS ...`) i same
   migrasjon, stadfesta direkte etterpå (`pg_proc` viser no nøyaktig éin
   funksjon, 7-argument-signaturen).

**Nytt i Analyse-panelet**: "Enheter"-topplista (Mobil/Nettbrett/PC).
Bot-trafikk vert no filtrert bort **alltid** (uavhengig av staging/
produksjon -- ulikt `is_test`, som berre gjeld staging).

**Deployert rett til produksjon denne runda** (brukarval, ikkje standard
rutine -- staging vart eksplisitt hoppa over). Verifisert direkte, ikkje
berre grøn exit-kode: kolonnane finst (`information_schema.columns`),
nøyaktig éin `insert_analytics_event`-signatur att i `pg_proc` (den gamle
er stadfesta borte), `anon` har EXECUTE/`authenticated` har det ikkje
(`has_function_privilege`), og eit ekte anon-nøkkel-kall mot REST-API-et
lykkast (204) med rett `device_type`/`is_bot` lagra -- verifiseringsrada
sletta att etterpå.

`?v=N`: `module-sidetelling.js` (3), `console-core.js` (188).

**Neste**: Steg 2 ("Trendar", periode-mot-periode-samanlikning -- har ein
reell dataavhengigheit til denne bot-filtreringa, difor bygd etter, ikkje
før), deretter steg 3 (konverteringskobling mot leads/bookings).

## 0.80.0 — 2026-08-03

### Utvida: sidetellings-panelet i Web-admin ("Analyse")

Same dag som 0.79.0 sin Console-brytar, etter fyrste ekte live-testing
(Playwright, lokalt mot produksjons-Supabase, verifisert med `npx supabase
db query --linked`) og oppfølgingsspørsmål frå brukar om sjølve panelet:

**Rett funne under live-testing:** hashchange-fangsten i
`module-sidetelling.js` var utilsikta inkonsekvent -- om ein seksjon
(Referansar/Aktuelt) av ein eller annan grunn ikkje fanst som DOM-element
akkurat då nokon klikka nav-lenka, fall klikket attende til ekte
nettlesar-hashnavigering og VART talt som eiga visning, medan identiske
klikk på synlege seksjonar (Om oss/Tenester) IKKJE vart talt (mjuk-scroll
via `history.replaceState()`, som aldri utløyser `hashchange`). Stadfesta
med brukar at mjuk-scroll ALDRI skal telje som eiga visning -- retta med
ein eksplisitt allow-liste (`isRealPage()`) som kjenner att dei same
unntaka `bindGlobalNav()` i `core.js` sjølv alt bruker (`#booking`,
`#aktuelt/alle`, `#sak/*`), i staden for å stole på det tilfeldige
DOM-eksistens-utfallet. NB: krev vedlikehald viss ein framtidig ny
`page:true`-modul vert lagt til (same kopling som `bindGlobalNav()` sjølv
alt har).

**Nye felt i panelet** (alle bygd på data som alt vart samla -- ingen ny
sporing):
- **Konverteringsrate** (CTA-klikk ÷ sidevisningar, med forklarande
  hjelpetekst) som eige KPI-kort ved sida av det eksisterande
  sidevisnings-talet.
- **CTA-klikk per dag**, same søylegraf-mønster som "Sidevisninger per
  dag", eiga skala (delt skala med sidevisningar ville gjort CTA-søylene
  usynleg små).
- Hjelpetekstar lagt til under "Henvisninger" (kva "Direkte" betyr) og
  "CTA-klikk" (kva som vert talt).
- **"Oppdater"-knapp**, alltid synleg (i tillegg til den eksisterande
  "Prøv igjen" som berre vises ved feil), køyrer same spørring på nytt.

**Lesbare sidenamn:** "Mest besøkte sider"/"Inngangssider"/"Utgangssider"
viste tidlegare rå hash-verdiar (`#tjenester`, `#om-oss`). Ny
`PATH_LABELS`-tabell + generisk fallback (fjern `#`, stor forbokstav) i
`module-sidetelling.js` viser no "Tjenester", "Om oss" osb. Viser
STANDARDNAMNET for kjende innebygde seksjonar, ikkje eit ev. kundetilpassa
seksjonsnamn (t.d. ein tilpassa FAQ-overskrift) -- adminpanelet har ikkje
tilgang til dei tilpassa CMS-tekstane, berre `CFG`.

**Målform avklart med brukar:** kundevendt tekst (Web-admin/offentleg
nettside, dette panelet inkludert) skal vere **bokmål**, konsekvent med ei
tidlegare, aldri stadfesta tilråding (2026-07-02) og ein tidlegare reell
normaliseringsrunde (2026-07-01, 15 nynorske strengar → bokmål). Footer-
teksten vart difor "Analyse fra Vibeverk …" (bokmål "fra", ikkje nynorsk
"frå"), sjølv om Console (internt Vibeverk-verktøy) framleis nyttar
nynorsk andre stader -- uendra, ikkje del av denne runda.

**Vurdert, ikkje bygd:** eit kakediagram for henvisningar/CTA-typar vart
vurdert og medvite avvist -- horisontale søylelister (alt i bruk) er
lettare å lese nøyaktig for dette talet kategoriar.

**Verifisert:** alle tre testsuiter grøne (633/180/37, 0 FEIL -- tre
eksisterande jsdom-assertions i `test.js` oppdatert til å forvente dei nye
lesbare namna i staden for rå hash-verdiar). Visuelt stadfesta med eit
Playwright-skjermbilete av det faktiske panelet (ekte kode, forfalska
Supabase-respons, sidan anon ikkje har SELECT-tilgang på
`analytics_events` -- venta åtferd, ikkje ein feil).

`?v=N`: `module-sidetelling.js` (2), `console-core.js` (187).

**Oppfølging same dag -- staging-verifisering, delvis fullført:**
`20260731103651_add_analytics_events.sql` og `20260725123445_announcement_reads.sql`
(begge tidlegare berre på produksjon) er no køyrde mot `vibeverk-staging`
(24/24, matchar produksjon), og `seed_test_pageviews()` (den staging-only
fila) er deployert med rette grants. **Funne, IKKJE fiksa**: sjølve
fail-closed-sperra i `seed_test_pageviews()` -- `current_setting('app.
settings.is_staging', true)` -- kan ALDRI settast på noko Supabase-hosta
prosjekt, korkje via Dashboard (ingen UI for eigendefinerte GUC-namnerom,
berre eit avgrensa sett ytingsparametrar) eller via SQL (`ALTER DATABASE`/
`ALTER ROLE ... SET` krev superbrukar, som Supabase aldri gjev ut på hosta
prosjekt -- stadfesta direkte via eit reelt `permission denied to set
parameter`-forsøk mot staging). "Generer testdata"-knappen har difor
truleg vore utilgjengeleg sidan han vart bygd i Fase 1 (0.78.0), på KVA
Supabase-prosjekt som helst, ikkje ei staging-spesifikk mangel. Medvite
lagt til side (brukarval 2026-08-03, perifer testbekvemmelegheit, ikkje
kundevendt, blokkerer ikkje anna arbeid) -- attverande skisse til seinare
fiks: byt GUC-sperra ut med ein rad i `store`-tabellen (same mønster som
resten av superconfig) i staden, ingen Postgres-superbrukar-avhengigheit.
Sjå `docs/roadmap/ROADMAP.md` "Later".

## 0.79.0 — 2026-08-03

### Ny: Console-brytar for intern Analyse (Fase 1 av Console-innføringa)

Bakgrunn: `features.sidetelling` (sjå 0.78.0) kunne til no berre skruast av/på
ved å endre `config.js` og pushe til `main`. Etter ei runde med Arkitekt- og
Security Auditor-vurdering (uavhengige, sjå ADR-mønsteret i CLAUDE.md) vart
det klart at det generiske `renderModular`/`FEAT_LABELS`-mønsteret i Console
alt fanst og var rett veg -- MEN featureDefaults() defaulta alle brytarar til
PÅ, uavhengig av om flagget faktisk er opt-in eller opt-out. For eit
opt-in-flagg (`sidebygger` frå før, no òg `sidetelling`) synte det ein
kunde som aldri hadde rørt fana som hukt av, sjølv om lagra verdien var av
-- og lagra operatøren Modular-fana av ein heilt annan grunn (skriv HEILE
features-objektet på nytt kvar gong), vart flagget stille sett til `true`.

Fiksa generelt: ny `OPT_IN_FEATURES`-liste i `console-core.js` som
`featureDefaults()` no respekterer (rettar samstundes det latente,
eksisterande hòlet for `sidebygger`). `sidetelling` lagt til `FEAT_LABELS`/
`FEAT_HELP` under merkelappen **"Analyse"** (ikkje "Sidetelling") -- brukaren
ønskjer å byggje den interne løysinga god nok til å vere eit reelt
alternativ til eksterne verktøy over tid, og "Analyse" er den namnsettinga
som skal vise fram framover. Interne namn (`features.sidetelling`,
`module-sidetelling.js`) er UENDRA -- same mønster som Workspace/Intranett-
omdøypinga (sjå repo-layout-notatet i CLAUDE.md): berre skjermteksten er
endra, ikkje datamodellen.

Console sin eigen Analyse-fane (der eksterne verktøy som Plausible vert sett
opp) fekk ein varselboks: "Kunden har intern analyse aktivert i
Modular-fana" når `features.sidetelling === true` for den aktive tenanten.
Boksen legg ikkje til ny åtferd -- modulen sjekka alt sjølv om Plausible var
sett og hoppa over viss så (`module-sidetelling.js`) -- ho skal berre gjere
den eksisterande anten/eller-logikken synleg for operatøren. "Lagra"-teksten i
Modular-fana oppdatert til å seie "Trer i kraft ved neste sideopplasting"
(matchar Produkt/Web-fanene), i staden for eit upresist "✓ Lagra!" som
kunne lese som augeblikkeleg.

**Retta same dag, etter Project Historian + UX/Mobile Reviewer:** Project
Historian fann at teksten i varselboksen og i `FEAT_HELP.sidetelling` (begge
i `console-core.js`) hevda at det interne analyse-modulen "vinn automatisk"
over eit eksternt verktøy sett opp samtidig -- baklengs. `initAnalytics()` i
`core.js` lastar Plausible-scriptet ubetinga når `analytics.plausible` er
sett, utan å sjekke `features.sidetelling` i det heile; det er
`module-sidetelling.js` som gjev seg (`if (an.plausible) return;`) når
Plausible er sett. I praksis **vinn Plausible, og den interne modulen går i
dvale**, ikkje omvendt -- retta i begge tekstane. UX/Mobile Reviewer fann i
tillegg at varselboksen sin raude `i-notice--danger`-styling (`#c0392b`)
var feil signal for ein normal, tilsikta tilstand (ikkje ein feil) --
bytt til same oransje `i-notice--warn` (`#E8833A`) som den eksisterande
`sidebyggerWarning`-boksen, og teksten vart gjort meir handlingsretta
("lat felta under stå tomme" i staden for berre å skildre konflikten).
Retta òg "CTA-klikk" til "klikk på knappar" i hjelpeteksten
(copy-style-guide, unngå fagsjargong).

Bevisst UTELATE frå denne fasen, etter eksplisitt brukarval: ei påminning
ved sjølve brytaren om å sjekke personvernsteksten (eit forslag til
oppdatert sidetelling-tekst i `computeDefaultPrivacyText()` -- omdøypt til
"Analyse"-språk -- er levert til brukaren som separat utkast, ikkje
implementert, sidan personvernsteksten skal få eigen, større gjennomgang
før kundelansering). Systemiske funn frå sikkerheitsgjennomgangen (ingen
rolle-/tenant-scoping handheva i broker for `set_config`, ingen felt-nivå
audit-detalj) gjeld heile broker-mekanismen, ikkje berre denne brytaren, og
er difor IKKJE del av denne oppgåva -- eigne, seinare saker.

`?v=N`: `console-core.js` (186).

**Avklart same dag, live-testa i produksjon (Vibeverk sjølv):** etter at
brytaren vart slått på og verifisert med ekte nettlesar-trafikk
(Playwright, lokalt mot produksjons-Supabase), vart det stadfesta at
mjuk-scroll-navigering mellom seksjonar på framsida (Om oss/Tenester/osb.)
IKKJE tel som eigne sidevisningar -- berre distinkte hash-ruter
(inngangssida, Booking, Aktuelt-arkivet, enkeltsaker) gjer. Dette er
tilsikta åtferd, stadfesta av brukar, ikkje ein feil å rette. Funne
samstundes: sjølve hashchange-basert fangst er i dag **inkonsistent**
mellom seksjonar -- om ein seksjon (t.d. Referansar/Aktuelt) av ein eller
annan grunn ikkje finst som eit DOM-element i det augeblikket nokon
klikkar nav-lenka, fell klikket tilbake til ekte nettlesar-hashnavigering
og VERT tracka, medan seksjonar som faktisk er synlege (Om oss/Tenester/
Kontakt) vert mjukt-scrolla og IKKJE tracka -- eit utilsikta, tilfeldig
avhengig utfall, ikkje ei medviten regel. Vurdert saman med spørsmålet om
"kva seksjon var kunden på ved avreise" (skrolldjupne/seksjon-synlegheit) --
begge bevisst UTSETT, ikkje bygd no: skrolldjupne-sporing krev anten mange
fleire skriv per visning eller ein sendBeacon/pagehide-mekanisme som alt
vart forkasta ein gong i Fase 1 av kostnad/nytte-grunnar, og nøyaktigheita
ville uansett vore tvilsam på tvers av skjermstorleikar. Sjå
`docs/roadmap/ROADMAP.md` "Later" for same punkt.

**Fase 2** (utsett, ikkje starta): fleire funksjonar i sjølve analyse-
modulen (unike besøkande, bot-filtrering, o.l. -- sjå 0.78.0-innslaget).

## 0.78.0 — 2026-07-31

### Ny modul: intern, cookiefri sidetelling (Fase 1) -- gratis alternativ til Plausible

Bakgrunn: bruker spurte om Vibeverk kunne bygge tilsvarende funksjon som
Plausible native. Etter to runder med Arkitekt-vurdering (inkludert
sammenstilling av et separat ChatGPT-forslag) landet vi på et bevisst
avgrenset scope: kun offentlig nettside (Workspace uttrykkelig utenfor),
ingen betalte/eksterne kall (ingen AI-oppsummering, ingen geolokasjon),
kun sidevisninger, referrer, inngangs-/utgangssider og et lite fast sett
CTA-klikk (telefon/e-post/kontakt/tilbud/booking).

Ny fil `module-sidetelling.js` (IIFE, `features.sidetelling`-flagg,
`false` som standard, kjører kun når `analytics.plausible` er tom --
kunden velger ett av de to). Sender pageview ved sidelast/hash-endring og
CTA-klikk via ny RPC `insert_analytics_event` til ny tabell
`analytics_events` (migrasjon
`20260731103651_add_analytics_events.sql`). Sesjons-ID for å gruppere
treff til samme besøk lagres i `sessionStorage`, IKKE en cookie --
forsvinner ved fane-lukking, sendes aldri automatisk til server.
Inngangs-/utgangssider krever ingen egen fangst-hendelse: de er allerede
første/siste pageview-rad for en sesjon, en ren spørring i adminpanelet
(bevisst forkastet et opprinnelig sendBeacon/pagehide-forslag som eneste
gevinst ville doblet antall skriv per sidevisning for null ny
informasjon).

Adminpanel vises i eksisterende Analyse-fane i Web-admin (`core.js` sin
`adminAnalyse()`), i samme boks Plausible-embeden ellers bruker -- ikke en
egen fane. `computeDefaultPrivacyText()` fikk en ny, presis tredje gren
for sidetelling (IKKE gjenbruk av Plausible-teksten -- sessionStorage er
juridisk sett en annen, svakere påstand enn Plausible sin "ingen lagring i
det hele tatt", forsvarlig via unntaket for ren førsteparts trafikkmåling
med kort levetid, se ekomloven §3-1).

Test-data til utvikling: `supabase/staging-only/seed_test_pageviews.sql`
-- bevisst UTENFOR `supabase/migrations/` (som til slutt kjøres mot ethvert
kundeprosjekt), kjøres manuelt kun mot `vibeverk-staging`. To lag
beskyttelse: (1) filen finnes aldri i delt migrasjonshistorikk i det hele
tatt, (2) funksjonen selv nekter å kjøre med mindre en Postgres-GUC
(`app.settings.is_staging`) er satt manuelt til `'on'` på det spesifikke
prosjektet -- fail-closed selv om filen skulle havne feil sted ved en
feil. Web-admin sin "Generer testdata"-knapp er ren kosmetisk
synlighet (vises kun når `supabase.url` inneholder stagingens
prosjektref) -- den reelle sperren sitter i databasefunksjonen, ikke i
knappen.

Eksplisitt utsatt til senere, egne faser (ikke bygget nå): unike
besøkende, bot-filtrering, geolokasjon, enhet/nettleser/skjerm-metadata,
rollup-tabell, AI-oppsummering, Workspace-analyse, CMS-per-side-widget,
konverteringskobling (lead/booking <-> side).

`?v=N`: `config.js` (13), `core.js` (81), `module-sidetelling.js` (1, ny fil).

**Oppfølging samme dag, etter Security Auditor + UX/Mobile Reviewer:**
Security Auditor fant at `authenticated` manglet et eksplisitt
`GRANT SELECT` på `analytics_events` -- uten det ville RLS-policyen aldri
blitt evaluert i det hele tatt (Postgres avviser på privilegienivå FØR
RLS), så adminpanelet ville feilet i produksjon. Lagt til, sammen med
`REVOKE ALL ... FROM anon` (defense-in-depth, matcher baseline-migrasjonen
sitt eget GRANTS-mønster) og en `CHECK`-constraint på `cta_id`. Lagt til
`.limit(5000)` på adminpanelets spørring, siden `insert_analytics_event`
ikke er ratebegrenset -- uten et tak kunne et stort antall anon-innsendinger
gjort adminpanelet ubrukelig (må hente/iterere hele resultatsettet).

UX/Mobile Reviewer fant at "Generer testdata"-knappen aldri viste dataen
den selv genererte (adminspørringen filtrerte `is_test`-rader ubetinget
bort, også på staging) -- rettet til å vise dem kun når prosjektet faktisk
er staging. Fjernet interne tabell-/kolonnenavn (`analytics_events`,
`is_test=true`, "databasefunksjonen") fra knappens hjelpetekst
(copy-style-guide-brudd). Byttet "sessionStorage" i personvernsteksten mot
vanlig språk (samme juridiske poeng, uten fagterminologi mot
sluttbrukere -- `computeDefaultPrivacyText()` sin sidetelling-gren).
Lagt til «Prøv igjen»-knapp ved lastefeil, kort datoperiode-tekst under
stolpediagrammet (touch-tilgjengelighet, `title`-tooltip virker ikke på
mobil), og en kort hint-tekst under "Inngangssider"/"Utgangssider" for en
ikke-teknisk bruker. CSS-fiks: `.an-toplist li span` manglet
`min-width:0`/`flex:1 1 auto`, kunne klippe telletall på smale skjermer
ved lange sidenavn/henvisninger (fikset i både `index.html` og
`admin/index.html`).

Alle tre testsuiter grønne etter fiksene (633/180/37, 0 FEIL).

**Deployet til produksjon (clzczbyklgdtdhgjphup) samme dag, etter eksplisitt
godkjenning:** `npx supabase db push --linked` -- verifisert direkte (ikke
bare grønn exit-kode): `information_schema.role_table_grants` bekrefter
`anon` har INGEN rader på `analytics_events` og `authenticated` har SELECT;
`pg_policies`/`pg_constraint` bekrefter RLS-policy og de to
CHECK-constraintene; ekte anon-nøkkel-kall mot REST-API-et bekrefter
`insert_analytics_event` lykkes (204) og direkte SELECT nektes (401,
"permission denied"). Verifiseringsraden slettet igjen etterpå. `features.
sidetelling` er fortsatt `false` som standard -- ingen eksisterende kunde
får denne på uten et eksplisitt valg.

## 0.77.2 — 2026-07-27

### Retta: Nettsidehelse i Console hadde annan overskriftstype og feil padding enn systerfanene

Brukar peika på eit nytt skjermbilete rett etter 0.77.1: boksen rundt
Nettsidehelse hadde no ei ramme (0.77.1 sin fiks), men "Nettsidehelse"-
overskrifta var eit vanleg fetstilt `<h4>` inni boksen, medan "Firma"/
"SEO og deling"/"Fargar"/"Fontar" alle brukar ekte `<fieldset><legend>`,
der `<legend>` automatisk sit PÅ sjølve rammelinja (nettlesaren sin eigen
notch-i-kanten-oppførsel for ekte fieldset/legend-par). Ulik
overskriftstype ga også synleg meir luft over "Nettsidehelse" enn over
dei ekte legend-overskriftene.

Fiks: `console-core.js` sin `#cs-nettsidehelse` får no ein ekte
`<legend>Nettsidehelse</legend>` som fyrste barn, akkurat som
systerfanene. Sidan `renderNettsidehelseSection()` sjølv alt rendrar sin
eigen `<h4 class="an-heading">Nettsidehelse</h4>` som fyrste linje --
som ville dobla opp tittelen saman med den nye legenden -- fekk
funksjonen (i `core.js`) eit nytt, valfritt `opts.skipHeading`-flagg som
utelet denne interne overskrifta. Console sender no `skipHeading: true`;
Web-admin sitt eige kall er uendra (framleis ein vanleg `<div>`-boks utan
eigen legend, treng difor framleis den interne overskrifta). Verifisert
med same Playwright-screenshot-teknikk som 0.77.1.

## 0.77.1 — 2026-07-27

### Retta: Nettsidehelse i Console synte seg utan ramme rundt seg (braut det bokserte designet)

Brukar sendte skjermbilete rett etter 0.77.0: Nettsidehelse-seksjonen synte seg
som flytande, uramma tekst/tal direkte på sidebakgrunnen, medan alle andre
seksjonar i Console (Firma/SEO/Fargar/Fontar) ligg i bokser med ramme og
avrunda hjørne (`fieldset.admin-group`).

Rotårsak: `renderNettsidehelseSection()` sitt HTML-utdata brukar CSS-klassane
`.an-heading`/`.an-cards`/`.an-card*` (og `.prose`/`.lead-details`) — klassar
som alt fanst i Web-admin sin `admin/index.html` (der funksjonen først vart
bygd), men som Console si `console/index.html` aldri hadde definert, sidan
Console aldri før hadde rendra dette innhaldet. Korta/tal synte seg difor med
nettlesaren sine standardstilar (ingen ramme, ingen kortbakgrunn, ingen
rutenett-oppsett) i staden for Console sitt eige, konsekvente utsjåande.

Fiks: la til dei manglande CSS-reglane i `console/index.html` (same verdiar
som `admin/index.html` sine, tilpassa Console sine eigne CSS-variablar), og
endra `#cs-nettsidehelse`-behaldaren i `console/console-core.js` frå ein vanleg
`<div>` til ein `<fieldset class="admin-group">` utan `<legend>` (unngår å
doble opp tittelen, sidan `renderNettsidehelseSection()` alt rendrar sin eigen
`<h4>Nettsidehelse</h4>`) — same boks-stil som resten av fana, uendra
rekkjefølgje. Verifisert visuelt via ein Playwright-screenshot av eit
statisk utsnitt (Console sitt eige CSS + ekte `renderNettsidehelseSection()`-
utdata) på både mobil- og skrivebordsbreidde, sidan ein reell innlogga
gjennomgang framleis krev OTP mot kontrollplanet.

**Same sjekk på Web-admin (brukar bad om det direkte etterpå)**: Web-admin sin
`admin/index.html` HAR alt `.an-*`-klassane (der `renderNettsidehelseSection()`
opphavleg vart bygd), så enkeltkorta synte seg korrekt med ramme — men sjølve
seksjonen låg som ein `<div>` med berre ei tynn topp-linje (`border-top`) under
SEO-skjemaet, i staden for i sin eigen boks slik meta-beskrivelse/favicon-felta
over alt ligg (`.admin-group`). Same brot på det bokserte mønsteret, berre
mindre synleg enn i Console sidan korta sjølv var stila. Fiksa i `core.js` sin
`adminDesignSeo()`: `data-nettsidehelse`-behaldaren fekk `class="admin-group"`
i staden for `border-top`-separatoren, uendra elles. Verifisert med same
Playwright-screenshot-teknikk (Web-admin sitt eige CSS + ekte
`renderNettsidehelseSection()`-utdata).

## 0.77.0 — 2026-07-27

### Nytt: Nettsidehelse i Console (operatør kan no køyre helsesjekk for kva tenant som helst)

Følgjer opp 0.76.1: brukar spurde om helsesjekken burde utvidast (fleire sjekkar,
vente på ein KI-motor), og fekk tilrådinga om i staden å fullføre konsulent-modellen
0.76.1 sjølv innførte — ein operatør skal kunne køyre helsesjekken for EIN KVAR
tenant, heilt uavhengig av om DEN tenanten sjølv har `feat("sidebygger")` (sidan
Console ikkje er gata av kunden sin eigen designmodul-status). Brukar godkjente
berre denne konkrete biten («Ja, ordne console-visning») — CWV/JSON-LD-timar/KI
er framleis medvite utsett, ikkje del av denne endringa.

`core.js` sin `computeWebsiteHealth()`/`renderNettsidehelseSection()`/
`wchCollectImages()` vart refaktorert til å ta eit valfritt `opts`-objekt
(`superconfig`, `content`, `enabledModules`, `faqItems`, `refItems`,
`privacyText`) med fallback til det gamle, lukke-baserte oppsettet når `opts`
ikkje er gjeve — null åtferdsendring for Web-admin sitt eige, eksisterande kall.
Begge funksjonane er no eksponert på `window.App` slik at Console kan bruke dei.

`console/console-core.js` sin `renderWeb()` (den kombinerte Firma/SEO/Fargar/
Fontar-fana) hentar no `content`/`faq-items`/`ref-items` for den valde tenanten
via det allereie eksisterande, generiske `getStoreKey()` (direkte mot tenanten
sitt eige Supabase-prosjekt, same mønster som `getSC()`), og rendrar helsesjekken
inn i eit eige `#cs-nettsidehelse`-felt rett under metadata-felta i "SEO og
deling"-seksjonen — same plassering ("under metadatateksten") som Web-admin sin
eigen versjon. Dei tre ekstra, asynkrone kalla er verna av same
`_renderGen`-vaktmønster som resten av Console sin fane-dispatcher, slik at eit
seint svar ikkje skriv inn i eit `#cs-nettsidehelse` som no høyrer til ein heilt
annan tenant/fane (operatøren rakk å byte medan kalla stod ustengt).

Ingen ny automatisert testdekning for sjølve Console-UI-et (Console har ingen
eigen jsdom-testhamn, i motsetnad til `test.js`/`test-workspace.js`, og krev
reell OTP-innlogging mot kontrollplanet som ikkje er tilgjengeleg i denne økta
for ein full nettlesar-gjennomgang). I staden: `node test.js` (610/610 OK) og
`node test-workspace.js` (180/180 OK) stadfestar at core.js sin refaktorering
ikkje endra Web-admin sin eksisterande åtferd, og eit eige smoke-script kalla
`window.App.renderNettsidehelseSection(opts)` direkte med tre case (tom tenant
utan lagra data, godt utfylt tenant, faq/referanser slått av) — inkludert
tilfellet der `content` manglar `hero`/`about`/`contact`/`footer` heilt (den
faktiske forma Console sin `getStoreKey()`-fallback gjev for ein splitter ny
tenant), som ville krasja utan default-samanslåinga i `renderWeb()`. Ein reell
innlogga gjennomgang i nettlesar er ikkje gjort og bør skje før dette vert stole
på i produksjon.

## 0.76.1 — 2026-07-27

### Retta: Nettsidehelse flytta inn i Design → SEO (var feilaktig open for alle)

Brukar peika på ein reell bug rett etter 0.76.0 vart deploya: "Nettsidehelse" låg i
kategorien `innstillinger`, synleg for ALLE admin-kundar heilt uavhengig av om dei
hadde kjøpt designmodulen (`feat("sidebygger")`) — men sjekkane sine eigne tips peika
konkret til "Design → SEO" og "Design → Fargar", faner som BERRE finst med
designmodulen. Ein kunde utan designmodul ville sett fana, men blitt bedt om å gå til
faner dei ikkje hadde tilgang til.

Fiks (brukar sitt eige forslag, stadfesta før implementasjon): fjerna den frittståande
fana heilt. Helsesjekken ligg no INNI Design → SEO-fana, rett under dei eksisterande
meta-beskrivelse/OG-bilde/favicon-felta — arva difor same `feat("sidebygger")`-sperre
automatisk, ingen eigen synleggjeringslogikk å halde synkronisert. Matchar samstundes
den tiltenkte forretningsmodellen: kunde utan designmodul ser han ikkje i det heile
(Vibeverk kan tilby helsesjekken som ei betalt konsulent-teneste i staden), kunde MED
designmodulen får full sjølvbetening, konsekvent med resten av Design. Tekstane som
peika til "Design → SEO" for meta-felta vart samstundes retta til berre "ovanfor",
sidan dei no ville vore sjølvreferensielle. Seksjonen oppdaterer seg sjølv live etter
lagring av SEO-skjemaet, utan å måtte forlate og kome attende til fana.

**Stadfesta bevisst**: `editor`-rolla får no tilgang til Nettsidehelse (via Design-
kategorien), noko rolla ikkje hadde i 0.76.0 (som berre viste han til `admin` via
`innstillinger`-kategorien). Brukar stadfesta dette er ønska, ikkje ein utilsikta
biverknad.

5 nye/endra assertions i `test.js` (nsh0/nsh0b for sjølve sperra, resten flytta til å
navigere via Design → SEO i staden for den no-fjerna eigne fana; ny nsh8 for live-
oppdatering etter lagring). Stadfesta visuelt med Playwright (design-modulen
mellombels aktivert via ei server-sides omskriving av `config.js` for testinga, sidan
den ekte demo-standarden har `sidebygger: false`). 610/610 + 180/180 + 37/37 OK.

---

## 0.76.0 — 2026-07-27

### Ny modul: "Nettsidehelse" — regelbasert helsesjekk av kunden sin nettside

Ny fane i Web-admin (Innstillingar → Nettsidehelse, rett etter Analyse). Brukar delte
eit Codex-generert forslag ("bygg ein modul med 0–100-skår, kategoriar for SEO/ytelse/
mobil/tilgjenge/innhald/tillit"), bad om at det IKKJE vart teke rått, men analysert og
samanstilt med eigne forslag først. Fann fleire premissar i det opphavlege forslaget
som ikkje stemte med korleis Vibeverk faktisk er bygd — kutta desse før implementasjon:

- **"Sitemap"/"URL-struktur"/"interne lenker" kutta heilt** — nettsida er éin einaste
  hash-ruta URL, desse sjekkpunkta ville vore meiningslause eller identiske for alle
  kundar.
- **Ekte Core Web Vitals og faktisk rendra overflow/klikkflate-storleik kutta** — krev
  anten Google PageSpeed Insights API eller ein reell nettlesar-rendering-jobb, ikkje
  "regelbasert" i den forstand forslaget la opp til. Same bug-klasse som vart funne og
  fiksa i denne kodebasen 2026-07-26/27 (CSS Grid-fallgruve, dim-overlay-status-linje-
  bleed) — begge vart berre fanga opp ved faktisk å rendre sida i ein ekte nettlesar.
- **Label/input-kopling, tastaturnavigasjon, generell JS/CSS-praksis kutta** — dette er
  plattform-eigenskapar i delt `core.js`/`components.js`, identiske for alle kundar,
  ikkje noko DEN kunden kan endre. Ville vore anten forvirrande eller permanent likt
  for alle.
- **"Kart" kutta** — ingen kart-innbyggingsfunksjon finst i kodebasen. **"Cookies"
  kutta** — Plausible (einaste analytics-val) er dokumentert cookielaust, truleg
  ingenting å sjekke for.

Send den korrigerte, innsnevra versjonen til Arkitekten for ein eigen sjekk (stadfesta
via Git-historikk/kodelesing, ikkje anteke) — stadfesta at SEO-felta alt vert redigert
TO stader (Web-admin + Console) som må haldast synkroniserte, fann at kontrast-sjekken
kravde direkte stadfesting av `.btn--primary`-fargen sin CSS FØR implementasjon (kunne
ikkje anta kvit knappetekst), og tilrådde Web-admin (ikkje Console) som eigar av
funksjonen. Tre opne avgjerder vart stadfesta med brukar: nedgradert JSON-LD-versjon
no (berre namn/adresse/telefon/logo) i staden for å vente på nye felt, ingen ny
redigerbar canonical-URL-felt (stadfestar berre at rot-URL-en er indekserbar), og
Console-omfattande oversikt eksplisitt utsett til seinare.

**Kva som faktisk vart bygd**: `computeWebsiteHealth()` (rein funksjon, ingen DOM) +
`adminNettsidehelse(body)` i `core.js` — 4 kategoriar (Synlegheit/Innhald/Tillit/
Tilgjenge), kvar med 3-8 vekta sjekkpunkt, 0-100 totalskår + skår per kategori +
🟢/🟡/🔴-trafikklys + "Prioriterte forbetringar" (topp 5 feila sjekkpunkt, sortert
etter vekt). Full rubrikk og grunngjeving for kvart val:
`docs/architecture/website-health-scoring.md`.

UX/Mobile Reviewer fann og retta tre ting etter fyrste implementasjon: kategori-
`<details>`-elementa brukte ikkje den eksisterande `.lead-details`-klassen (synte
nettlesaren sin nakne standard-triangel i staden for den etablerte ▸/▾-chevronen);
kort-rutenettet sette ein overflødig inline `grid-template-columns` som stille
overstyrde (i staden for å utvide) `.an-cards` sin delte `@media(max-width:560px)`-
garanti; "Schema.org" vart introdusert som uforklart fagsjargong, i strid med
`copy-style-guide.md` og det same-fila sin eigen etablerte klarspråk-mønster
(`adminDesignSeo()`). Alle tre retta og stadfesta på nytt med Playwright.

Testa med 11 nye assertions i `test.js` (nsh1-nsh7-serien, inkl. ein ekte før/etter-
flyt: fjern org.nr via Innhald-fana → stadfest raudt i Nettsidehelse → fyll det ut att
→ stadfest grønt). Stadfesta visuelt med Playwright (måtte kombinere blokkering av
Supabase-CDN-skriptet OG omskriving av `config.js` sitt tenarsvar for å nå det lokale
passord-fallback-sporet i ein ekte nettlesar — berre å blokkere CDN-skriptet etter
sideinnlasting var ikkje nok, sidan ein ekte Supabase-klient alt var oppretta frå den
ekte konfigurasjonen).

606/606 + 180/180 + 37/37 OK.

---

## 0.75.3 — 2026-07-27

### `robots.txt` — hindrar Google frå å crawle admin/Workspace/Console/Hub

Brukar spurde om `sitemap.xml` var eit reelt hol etter ein tidlegare "kva manglar"-
samtale. Undersøkte nærare før implementasjon og fann at anbefalinga var bygd på feil
grunnlag: Vibeverk sine offentlege sider bruker hash-navigering (`#tjenester`,
`#om-oss`, ikkje eigne URL-ar), så Google ser uansett berre éi ekte side per kunde —
ei sitemap ville i praksis berre innehalde éin URL, låg reell verdi.

Det faktisk manglande, meir konkret nyttige holet: **`robots.txt` fanst heller ikkje
nokon stad**. Utan han er det ingenting som hindrar t.d. ein kunde sitt
`/admin/`-innloggingsside eller heile `/workspace/`/`/console/`/`/hub/` frå å dukke
opp i Google-søk. Ny statisk `robots.txt` (repo-rot) disallowar `/admin/`,
`/workspace/`, `/console/`, `/hub/`, `/api/` — same for alle tenants (stigane er
identiske uansett kunde), difor ingen dynamisk per-tenant-funksjon nødvendig, ulikt
manifest.json-familien. Utanfor `middleware.js` sin matcher-liste, serverast difor
direkte som statisk fil, ingen site-lock-interaksjon.

595/595 + 180/180 + 37/37 OK (uendra — reint statisk fil, ingen logikk endra).

---

## 0.75.2 — 2026-07-27

### Tre tiltak frå ein ekstern marknads-/tryggleiksbrief (27. juli 2026)

Brukar delte ein tredjeparts brief om bransjeutvikling (Duda "vibe coding", Next.js-
sårbarheiter, Vercel-endringar, Supabase-prising, Microsoft 365-prisauke) og bad om
vurdering + tiltak. Fann at brevet sitt fyrste prioriterte råd ("oppdater Next.js")
**ikkje gjeld Vibeverk i det heile** — stadfesta at det ikkje finst nokon Next.js-
avhengigheit noko stad i kodebasen (vanilla JS/IIFE, ingen rammeverk). Tre andre
tiltak, omsett til den faktiske stacken, vart gjennomførte:

1. **Pinna eksakte CDN-versjonar**: `@supabase/supabase-js@2` → `@2.110.8`,
   `marked@12` → `@12.0.2` (begge tidlegare berre hovudversjon-pinna, altså fritt
   flytande til kva som helst nyare utgåve utan varsel). Stadfesta live med
   Playwright at begge lastar korrekt etter pinning. Ny regel i CLAUDE.md/AGENTS.md:
   CDN-avhengigheiter skal alltid pinnast til eksakt versjon, oppgradering er ei
   medviten handling.
2. **Fylte ut det tomme "Deployment safeguard"-avsnittet** i
   `docs/security/security-baseline.md` (fann under uavhengig gjennomgang av same
   fil — overskrifta fanst, ingen tekst under).
3. **Nytt avsnitt om Supabase-loggovervaking**: brevet sitt poeng om Supabase sin
   målte loggprising (frå 1. juli 2026) er reelt og ikkje dekt nokon stad frå før —
   stadfesta at ingen rutine finst i dag for å sjekke loggvolum/kostnad på tvers av
   dei fire Supabase-prosjekta. Dokumentert som eit ope, manuelt sjekkpunkt inntil
   automatisering finst.

Ingen appkode-logikk endra utover CDN-URL-ane sjølve. 595/595 + 180/180 + 37/37 OK.

---

## 0.75.1 — 2026-07-27

### Status-linje-dim-fiksen (0.74.2) utvida til alle 6 modal-dialogane i Workspace

Etter ein grep-audit av heile kodebasen for same type CSS-fell som Oppgåver-lista
(0.73.0) og hamburgarmenyen (0.74.2): CSS Grid-fallgruva var isolert til
`task-group__list` — alle andre grid-lister (notat-kort, media-galleri, lenkjer) bruker
alt den trygge `grid-template-columns:repeat(auto-fill,minmax(...))`-varianten, ingen
fleire å fikse der. Men det same fullskjerm-mørklagde overlay-mønsteret
(`position:fixed;inset:0;background:rgba(0,0,0,.45)`) som hamburgarmenyen hadde, fanst
identisk i 6 modal-dialogar: oppgåve, kunngjeringslesar, kontakt, booking, notat, tilbod
— alle ville i teorien ha same status-linje-avvik som brukar rapporterte for menyen.

Refaktorerte `setThemeColorMeta()`/`isDarkTheme()` (private til hamburgarmeny-koden i
0.74.2) ut til delte toppnivå-funksjonar i `workspace-core.js`, pluss ein ny
`Intranet.wrapDimmedOverlay(bd)` — kalla rett etter kvar modal sin `bd` vert lagt til i
DOM-et. Han pakkar inn `bd.remove()` sjølv, slik at ALLE dei fleire eksisterande
lukk-vegane per modal (×-knapp, klikk utanfor, Escape-tast, og for nokre modalar
automatisk etter lagra) automatisk hentar statuslinja attende til vanleg farge —
ingen av dei seks modal-filene treng endre sine eigne lukk-funksjonar, berre éin ny
linje kvar rett etter `document.body.appendChild(bd)`.

Stadfesta med 4 nye assertions i `test-workspace.js` (p13-p16-serien, oppgåve-modalen
som representant for mekanismen — identisk kode i alle 6). 595/595 + 180/180 + 37/37 OK.

---

## 0.75.0 — 2026-07-26

### PWA-manifest fullført på dei tre siste flatene (offentleg side, Web-admin, Console)

Fullfører PWA-arbeidet frå 0.74.0 (som berre dekte Workspace). Ekstraherte det delte
to-hopps-mønsteret (kontrollplan → tenanten sitt eige Supabase) frå
`api/workspace-manifest.js` til ny `api/_lib/tenant-manifest.js`, sidan tredje/fjerde
kopi av same logikk var punktet der det var verdt det:

- **`/manifest.json`** (offentleg side, ny `api/site-manifest.js`) og
  **`/admin/manifest.json`** (Web-admin, ny `api/admin-manifest.js`) — begge dynamiske
  per tenant, same trygleiksgrense som Workspace sin (ingen ny grense — les same
  offentleg-lesbare `superconfig` som nettlesaren alt gjer). `theme_color` bruker
  `colors.primary` direkte (IKKJE `workspace.accentColor`, som berre gjeld inni
  Workspace sin eigen `applyWorkspaceTheme()`-overstyring).
- **`console/manifest.json`** — **statisk**, medvite IKKJE bygd på det dynamiske
  mønsteret. Console er Vibeverk sitt eige interne operatørverktøy, aldri
  kunde-merkevarebygd uansett kva hostname han vert nådd via — bruker Vibeverk sin
  eigen faktiske logo/fargar (`#15616D`), ikkje ein generisk fallback, sidan det her
  faktisk ER Vibeverk sjølv som eig sida.
- `middleware.js`: `/manifest.json` og `/admin/manifest.json` lagt til matcher-lista og
  unnateke site-lock-sperra (0.74.3 sin fiks), same grunngjeving — Chrome/Android sin
  bakgrunns-installerbarheits-sjekk ber ikkje med seg fana sine cacha akkreditiv.
  `console/manifest.json` treng ikkje unntaket — han er ei rein statisk fil utanfor
  matcher-lista, når difor aldri middleware i det heile.

Stadfesta med eit sjølvstendig mock-skript (12 assertions): refaktorert
`workspace-manifest.js` uendra åtferd, begge nye funksjonane rett start_url/scope/
theme_color-val, generisk (ikkje Vibeverk-) fallback for ukjende tenants, alle tre
manifest-stiar unnateke site-lock medan vanlege sider framleis krev han. Ingen
jsdom-testdekning mogleg (Vercel Routing Middleware/Functions, same kjende grense som
resten av denne familien funksjonar). 595/595 + 176/176 OK (uendra, ingen
jsdom-testbar kode rørt).

---

## 0.74.3 — 2026-07-26

### Rett rotårsak nummer to: manifest.json bak site-lock-passordet blokkerte heim-skjerm-app-installasjon (Android Chrome)

Brukar stadfesta at 0.74.2 sin diagnose òg var feil for det faktiske problemet: gråfeltet
var KONSTANT på alle sider (ikkje kopla til hamburgarmenyen), og synte seg BERRE i den
installerte heim-skjerm-appen på Android Chrome — ikkje i ei vanleg Chrome-fane til same
adresse. Desse to faktane saman peika mot éin ting: sjølve `/workspace/manifest.json`.

Rotårsak: `middleware.js` sitt mellombelse utviklingsfase-passord (`SITE_LOCK_PASSWORD`,
Basic Auth) sperra `/workspace/manifest.json` saman med alt anna. Ei vanleg fane cachar
Basic Auth-akkreditiv for heile økta etter fyrste interaktive innlogging, så sida sjølv
og alle vanlege sub-ressursar (`<script src="config.js">` osv.) fungerer fint — men
Chrome/Android sin EIGEN, separate bakgrunns-installerbarheits-sjekk (som hentar
`manifest.json` for å byggje "Legg til på Startskjerm"-opplevinga) ber ikkje med seg
fana sine cacha akkreditiv. Manifest-henting feila difor alltid (401) for installerte
app-ar, uansett kva `api/workspace-manifest.js` (0.74.0) faktisk ville ha generert —
Chrome fall tilbake til generisk grå fargelegging, konstant, på kvar einaste side.

Fiks: flytta `/workspace/manifest.json`-omskrivinga i `middleware.js` til å skje FØR
`checkSiteLock()`-sjekken, som eit eksplisitt unntak. Ingen reell tryggleiksrisiko —
manifestet inneheld berre offentleg brukbar merkevarebygging (namn/logo/fargar), ikkje
hemmelegheiter, og skal uansett vere fritt tilgjengeleg for at "Legg til på
Startskjerm" skal fungere i det heile, føre eller etter at sperra vert fjerna.

**Merk til brukar**: ein heim-skjerm-app som alt vart installert MEDAN manifestet var
utilgjengeleg, har truleg cacha den mislykka/generiske tilstanden permanent — fjern og
legg til appen på nytt etter denne fiksen er deployert, for at Chrome skal hente det no
tilgjengelege manifestet på nytt.

Stadfesta med eit sjølvstendig mock-skript: manifest.json sleppast gjennom utan Basic
Auth, medan alle andre sider framleis krev det som før (uendra åtferd der). Ingen
jsdom-testdekning mogleg (Vercel Routing Middleware, same kjende grense som
`api/tenant-config.js`/`api/workspace-manifest.js`). 595/595 + 176/176 OK (uendra,
ingen jsdom-testbar kode endra).

---

## 0.74.2 — 2026-07-26

### Retta (rett rotårsak denne gongen): mørkt felt øvst når mobil-hamburgarmenyen opnar

0.74.1 sin diagnose var feil — brukar viste eit nytt skjermbilete som stadfesta at det
mørke feltet dukkar opp NØYAKTIG når hamburgarmenyen (`#intranet-hamburger`) opnar, ikkje
ved vanleg SPA-navigering. Rotårsak: `.i-sidebar-overlay` dekker heile skjermen
(`position:fixed;inset:0;background:rgba(0,0,0,.45)`) for å mørkleggje resten av sida
medan menyen er open — denne dim-effekten syner gjennom heilt opp i iOS sitt status-
linje-område, men `theme-color`-meta-taggen (lagt til i 0.74.1) vart ALDRI oppdatert til
å reflektere det, så statuslinja vart verande i den vanlege lyse fargen medan resten av
skjermen mørkna — nøyaktig det synlege avviket i skjermbiletet. `#858789`/`#080d17` er
45 % svart matematisk blanda over høvesvis lyst (`#f1f5f9`) og mørkt (`#0f172a`)
`--color-bg` — stemmer nøyaktig med gråtonen i brukaren sitt skjermbilete.

Fiks: `openSidebar()`/`closeSidebar()` i `workspace-core.js` oppdaterer no
`theme-color`-meta-taggen til den blanda fargen når menyen opnar, og attende til vanleg
farge når han lukkar — same enkle mønster som 0.74.1 sin lyst/mørkt-synkronisering.

**Ikkje gjort, flagga for brukar**: same `position:fixed;inset:0;background:rgba(0,0,0,…)`-
mønster finst identisk i 6 andre modalar (`module-tasks.js`, `module-announcements.js`,
`module-contact.js`, `module-booking.js`, `module-notes.js`, `module-quote.js`) — alle
ville i teorien ha same status-linje-avvik når dei opnar på mobil. Ikkje retta denne
runden, sidan berre hamburgarmenyen var rapportert; brukar må stadfeste om dei andre
faktisk syner problemet på ein ekte iOS-eining før ein evt. gjer same fiks der.

Stadfesta med Playwright (meta-verdi programmatisk lesen — sjølve iOS-statuslinja kan
ikkje simulerast i ein vanleg Chromium-nettlesar) og 5 nye assertions i
`test-workspace.js` (p8-p12). 595/595 + 176/176 OK.

---

## 0.74.1 — 2026-07-25

### Retta: gråfelt øvst på Workspace-mobilskjermbilete etter navigering

Brukar viste to skjermbilete der eit felt øvst (bak iOS-statuslinja) skifta til ein
umatchande gråfarge etter eit menyval. Rotårsak: **ingen `theme-color`-meta-tag finst
nokon stad i heile kodebasen**. iOS Safari (16.4+) fargelegg området rundt status-/
adresselinja basert på denne taggen — utan han prøver Safari å GJETTE fargen sjølv ved
å sample sida, ei gjetting som er upåliteleg spesielt ved SPA-navigering (Workspace sin
`#/`-baserte rute-mekanisme, ingen full sideinnlasting).

Fiks: statisk `<meta name="theme-color" content="#f1f5f9">` i `workspace/index.html`
(Workspace sin faste, ikkje-tenant-tilpassa lyse standardbakgrunn), og `applyPrefs()`
i `module-settings.js` utvida til å oppdatere same tag sin `content` til `#0f172a` når
brukaren vel mørkt modus — same stad `data-theme` alt vert sett, held dei i takt.
Avgrensa til Workspace (ingen arkitektur-konsekvens, ingen Arkitekt-konsultasjon
nødvendig denne gongen).

Stadfesta med Playwright: `#f1f5f9` ved lasting, byter til `#0f172a` ved klikk på
«Mørkt», tilbake til `#f1f5f9` ved «Lyst». 4 nye assertions i `test-workspace.js`
(p3-p7-serien). 595/595 + 171/171 OK.

---

## 0.74.0 — 2026-07-25

### Workspace optimalisert som installerbar web-app, per-tenant app-ikon

Brukar spurde om å optimalisere Workspace som web-app og bruke logo-ikonet som app-ikon.
Fann at INGEN av dei fire flatene hadde noko PWA-manifest, favicon eller apple-touch-icon
i det heile — nettlesarfana viste standard blank ikon overalt. Konsulterte Arkitekten
før implementasjon (kryssar multi-tenant hosting-arkitekturen, sjå ADR-0007) sidan
`resolve_tenant_by_hostname()` (kontrollplanet) medvite ikkje ber med seg
firmanamn/logo — det ligg i kvar tenant sitt EIGE Supabase-prosjekt (`store.superconfig`),
og eit dynamisk per-tenant-ikon krev difor eit ekstra nettverkshopp som ikkje fanst
nokon stad i kodebasen frå før.

To delar, begge brukargodkjende eksplisitt før implementasjon:

**Del A — `apple-touch-icon`, delt `core.js`, alle fire flater**: iOS Safari sin
"Legg til på Heimskjerm" ignorerer manifest.json heilt og les BERRE denne taggen.
`applyMeta()` sette alt favicon dynamisk frå `company.favicon` (eit felt ingen reell
tenant har fylt ut enno) — utvida same funksjon til å setje `apple-touch-icon` òg, med
fallback til `company.logoUrl` (som derimot ER sett for alle reelle tenants).

**Del B — dynamisk `/workspace/manifest.json`, ny Vercel-funksjon**: `middleware.js`
skriv om `/workspace/manifest.json` til ny `api/workspace-manifest.js`, som gjer to
nettverkshopp — kontrollplan → tenanten sitt eige `store`-oppslag (`tenant_id=eq.<
storageKey>&key=eq.superconfig`, filtrert nøyaktig som `core.js` sin eigen
`hydrateFromSupabase()` alt gjer client-side for kvar anonym besøkjande — ikkje ei ny
tryggleiksgrense). Returnerer alltid 200 med eit beste-forsøk-manifest, aldri ei
feilside, sjølv om eitt eller begge hopp feilar. **Ingen Vibeverk-logo-fallback for
uinnstilte tenants** (medvite brukarval) — ein tenant utan eige `logoUrl`/`favicon` får
eit installerbart-men-ikonlaust manifest i staden for å utilsikta bere Vibeverk sin
eigen logo. `theme_color` prioriterer `workspace.accentColor` framfor `colors.primary`
sidan Workspace visuelt overstyrer nettsida sin hovudfarge (stadfesta i
`applyWorkspaceTheme()`). Cacha 1t/24t (`Cache-Control`) — manifest.json vert henta
sjeldan (sideinnlasting/installasjon, ikkje polling), og nettlesarar er uansett
notorisk trege til å oppdatere eit alt-installert ikon.

Ekstrahert `api/_lib/resolve-tenant.js` — delt hjelpar for
`resolve_tenant_by_hostname()`-oppslaget, sidan tredje kopi av same fetch-logikk
(etter `middleware.js` og `api/tenant-config.js`) var punktet der det var verdt det.
`api/tenant-config.js` refaktorert til å bruke han — **åtferd verifisert uendra** via
eit sjølvstendig mock-baserte skript (24 assertions, alle statuskodar 200/400/404/500/502
stadfesta identiske før/etter refaktorering), sidan denne funksjonen alt er live i
produksjon og tidlegare sikkerheitsgjennomgått (H2-funnet i ADR-0007).

**Ikkje testbart i jsdom** (Vercel Functions er utanfor begge test-harnessa sitt
omfang, same kjende grense som `api/tenant-config.js` alt hadde) — verifisert i staden
via eit frittståande Node-skript som mockar `fetch()` for begge hopp og dekker
full-suksess, ukjend hostname, og feil i kvart av dei to hoppa (24/24 OK).
`test.js` fekk 2 nye assertions for apple-touch-icon-fallback-logikken (595/595 OK).

595/595 + 166/166 OK. Manifest-funksjonen sjølv må stadfestast med ein ekte `curl` mot
ein reell tenant-hostname etter deploy (same rutine som `api/tenant-config.js` sjølv
kravde ved sin eigen fyrste deploy, ADR-0007) — ikkje anteke å fungere berre fordi
mock-testen går grønt.

---

## 0.73.0 — 2026-07-25

### Retta: mobil-overflow i Oppgaver/banner, og "viktig"-banner no per brukarkonto

Brukar rapporterte eit skjermbilete av Workspace på mobil der «Oppgaver»-lista sine
status-merke ("Å gjøre"/"Pågår") og "viktig"-banneret sin "Les mer"/"1 til" var avskorne
heilt utanfor skjermen — ikkje berre trongt, men fysisk uråkeleg.

**Rotårsak 1 (Oppgaver-lista)**: `.task-group__list` i `workspace/module-tasks.js` er
`display:grid` utan eksplisitt kolonnebreidde. CSS Grid sin standard gjer då at den
implisitte kolonnen (og dermed kvar `.task-row`) breiddebestemmast av det breiaste
UBROTNE tittel/skildring-teksten i heile lista (ein kjend Grid-fallgruve — `white-space:
nowrap`-ellipse-mønsteret på `.task-row__title`/`.task-row__body` aukar min-content-
breidda til heile den ubrotne tekstlengda). Fiks: `min-width:0` på `.task-row` +
`grid-template-columns:1fr` på `.task-group__list` — to eigenskapar, løyser overflowen
på alle breidder utan noko brotpunkt.

**Rotårsak 2 (banneret)**: banner-tittelen (`<strong>`) i `workspace-core.js` har
`flex-shrink:0` og batt ikkje inn moglegheit for line-brot — på ein lang/viktig tittel
tok ho difor all plassen på ein smal skjerm og dytta resten (melding, "1 til", "Les mer",
×) ut av det synlege området, som så vart klipt av `#intranet`/`.i-body` sin
`overflow:hidden` (ikkje ein scrollbar — reint usynleg). Fiks: `flex-wrap:wrap` på
banner-boksen (trygt òg på desktop, endrar ingenting med mindre innhald faktisk ikkje
får plass) + ein ny `@media(max-width:700px)`-regel som gjev meldingsteksten
`flex-basis:100% !important` slik at ho tek eiga line i staden for å verte klemt inn i
ein smal, fleirlinja kolonne ved sida av tittelen.

### Banneret dukka opp igjen sjølv om ein hadde lese saka

Brukar spurde kva som styrer at "viktig"-banneret vert vist på nytt. Fann to separate
årsaker i `workspace/module-announcements.js`: (1) lest-status vart lagra i
`localStorage`, per nettlesar/eining — ikkje kopla til brukarkontoen, så same brukar på
ein annan PC/mobil/nettlesar (eller etter tømt nettlesardata) såg banneret på nytt.
(2) **"Les mer"-knappen kalla aldri lest-markeringa i det heile** — berre eit eksplisitt
klikk på det vesle ×-krysset gjorde det, så sjølv på SAME eining kunne ein lese heile
saka og framleis sjå banneret att neste gong.

Fiks: ny migrasjon `20260725123445_announcement_reads.sql` — `read_by uuid[]`-kolonne
på `announcements`, og ein ny `mark_announcement_read(p_id)`-funksjon
(`SECURITY DEFINER`, brukar `auth.uid()` frå den innlogga si eiga økt, kan ikkje markere
lest for nokon andre; `REVOKE ... FROM PUBLIC, anon` + eksplisitt
`GRANT EXECUTE ... TO authenticated`). Klientkoden i `module-announcements.js` bruker no
`read_by` (kjem gratis med det eksisterande `select("*")`-kallet) i staden for
`localStorage` når Supabase er tilkopla, og kallar den nye funksjonen frå **både** ×
**og** "Les mer" — lest-status følgjer no brukarkontoen, ikkje eininga, og å faktisk lese
saka tel som lest. `localStorage`-sporet er framleis der som fallback for lokal/offline-
modus (same mønster som resten av modulen).

**Ikkje deployert**: migrasjonen er skriven og lagt i `supabase/migrations/`, men
**ikkje køyrd** mot noko Supabase-prosjekt — krev eksplisitt godkjenning per den
standande deployment-safeguarden, og Security Auditor bør sjå på den nye
`SECURITY DEFINER`-funksjonen fyrst.

Testdekning: 6 nye assertions i `test-workspace.js` (l5-l8-serien) for banner-fiksen sin
lokale/offline-fallback-sti (det einaste testbare sporet i jsdom, same grunngjeving som
0.72.0 sin runde) — stadfestar at "Les mer" no faktisk skjuler banneret, ikkje berre ×.
Begge CSS-fiksane stadfesta direkte i nettlesar (Playwright, 390px mobilbreidde, seeda
lokale testdata som reproduserte brukaren sitt eige skjermbilete) — ingen horisontal
overflow att (`scrollWidth === clientWidth` for både Oppgaver-sida og banneret).

593/593 + 166/166 OK, ingen regresjonar.

---

## 0.72.0 — 2026-07-25

### "Vis passord"-knapp på alle passordfelt (innlogging og nytt-passord)

Bygd på brukarforespørsel om ein synleg auge-ikon-veksling på alle stader ein skriv inn eller
lagar eit passord, på tvers av alle overflater. Kartla åtte passordfelt fordelt på fem filer:

- **Skriv inn passord**: `admin-pass` (Web-admin-innlogging, `core.js`), `intranet-pass`
  (Workspace-innlogging, `workspace-core.js`), `h-pass` (Hub-operatørinnlogging, `hub/hub.js`)
- **Lag nytt passord**: `mk-pass1`/`mk-pass2` (Web-admin «Min konto», `core.js`),
  `sp-pass1`/`sp-pass2` (Workspace invitasjon/set-passord, `workspace-core.js`),
  `settings-pass1`/`settings-pass2` (Workspace «Innstillingar», `module-settings.js`)

Arkitektonisk løysing: sidan `core.js`/`components.js` vert lasta av alle fire overflater
(offentleg side, Web-admin, Workspace, Console), fekk den delte `field()`-hjelpefunksjonen i
`components.js` ein ny `C.passwordToggle()`-knapp for `type: "password"`-felt, og éin ny
delegert klikk-handsamar `bindPasswordToggles()` i `core.js` (same mønster som den eksisterande
`bindHelpIcons()`), kalla éin gong frå `boot()`. Dette dekte automatisk `admin-pass`, `mk-pass1/2`,
og — som ein naturleg biverknad av den delte komponenten — Console sine `kd-srvkey`/
`kd-migrate-connstr`-felt (service_role-nøkkel/tilkoplingsstreng, same maskerings-logikk). Dei
resterande rå-HTML-felta i `workspace-core.js`/`module-settings.js` fekk same `.pw-field`-
wrapper-markup manuelt — treng ingen eigen JS, sidan same delegerte handsamar på `document`
fangar dei óg. **Hub** (`hub/hub.js`) er eit heilt fritståande dokument utan Tabler-ikonfont —
fekk sin eigen, enkle tekst-baserte "Vis"/"Skjul"-knapp i staden for ikon.

Testdekning avgrensa av jsdom-miljøet sin eksisterande, dokumenterte grense: berre `admin-pass`
er reelt testbar i `test.js` (via ADR-0003 sitt lokale passord-fallback-spor, sidan
`window.supabase`-SDK-en aldri vert lasta i jsdom) — lagt til ny assertion der (byte
type password↔text + aria-label). Dei sju andre felta krev ekte Supabase-autentisering for å
i det heile rendrast, akkurat som verken innloggingsskjerm, endre-passord eller
sett-passord-skjermane har vore testbare i denne suiten tidlegare. Verifisert i staden direkte
i nettlesar (lokal statisk server + Playwright-skjermbilete) for Web-admin-, Workspace- og
Hub-innloggingsskjermane: auge-ikonet/tekst-knappen byter faktisk `type` og viser passordet
som klartekst, ikonet byter til `ti-eye-off`, aria-label oppdaterer seg.

593/593 + 162/162 OK (test.js fekk 6 nye assertions for vis-passord-veksling på `admin-pass`,
ingen regresjonar).

**To fiksar frå UX/Mobile Reviewer-gjennomgangen, same runde**: (1) nettlesarens eigen native
passord-avslør-ikon (Edge sin `::-ms-reveal`, Chromium sin `::-webkit-credentials-auto-fill-button`)
vart aldri undertrykt, som ville dobla seg opp saman med den nye knappen på akkurat dei felta
denne funksjonen gjeld — no skjult via CSS i alle fem HTML-filene. (2) Hub sin eigenbygde
tekst-knapp («Vis»/«Skjul») mangla minste klikkflate (36×36px, Hub sin eigen eksisterande
konvensjon for `#m-close`) i motsetnad til dei andre fire overflatene sin 40px-konvensjon —
retta i `hub/hub.js`. Stadfesta på nytt med Playwright-skjermbilete og full testkøyring
(593/593 + 162/162, uendra).

---

## 0.71.1 — 2026-07-20

### To buggar frå 0.71.0-runden retta same dag: chat-knapp utanfor skjerm etter zoom, video-beskjering dekte heile skjermen

Begge funne av brukar rett etter å ha teke 0.71.0 i bruk:

1. **Chat-lanseringsknappen kunne hamne utanfor synleg flate etter nettlesar-zoom**: knappen sin dra-og-slepp-avgrensing (`window.innerWidth`/`innerHeight`) vart berre sjekka MEDAN eit drag pågjekk -- viss brukaren zooma inn/ut ETTERPÅ (som endrar CSS-piksel-viewportet og fyrer ei `resize`-hending, akkurat som ei faktisk vindaugsendring), vart knappen sin lagra `left`/`top` aldri på nytt avgrensa til det nye, mindre viewportet. Fiks: ny `resize`-lyttar i `module-chat.js` som klemmer knappen attende innanfor gjeldande vindaugsgrenser viss ho alt er dratt vekk frå standardhjørna.
2. **Video-fokuspunkt-beskjeringsboksen (ny i 0.70.0) dekte heile skjermen for ståande video**: `bindVideoCroppers()` sin `layout()` i `module-carousel.js` sette ALDRI ei eiga storleiksavgrensing på sjølve førehandsvisingsboksen -- ulikt `core.js` sin eksisterande, fungerande `bindImageFields()`, som eksplisitt avgrensar til `maxH=340px` via `aspectRatio`+`width`. Utan denne avgrensinga fall boksen attende til videoen sine RÅ pikseldimensjonar (t.d. 1080×1920 for ein ståande mobilvideo), som i praksis dekte heile skjermen og kravde kraftig nedzooming for å nå heile beskjeringsverktøyet. Fiks: same `maxH=340`-mønster som biletefeltet kopiert inn i video-croppar-en sin eigen `layout()`.

587/587 + 162/162 OK. Begge stadfesta direkte i nettlesar: chat-knapp-avgrensinga testa med simulert zoom (mocka `window.innerWidth`/`innerHeight` + dispatcha `resize`-hending, sidan verktøyet sin eigen vindaugs-endre-funksjon ikkje påverka det rapporterte viewportet i dette miljøet), video-croppar-boksen si nye storleiksavgrensing stadfesta med simulert 1080×1920-video (191×340px i staden for å dekkje skjermen).

---

## 0.71.0 — 2026-07-20

### Karusell sin lyd-knapp flytta+redesigna, chat-boblen er no drabar

To oppfølgingar same dag, begge frå direkte brukartilbakemelding etter 0.70.0:

1. **Lyd-knappen (`module-carousel.js`)**: flytta frå nede-til-høgre til OPPE til høgre på slidet -- kolliderte visuelt med chat-boblen, som ligg fast nede til høgre på sida uavhengig av scroll. Redesigna frå ein rein ikon-sirkel til ei pille med ikon+tekst ("Slå på lyd"/"Skru av lyd") -- ein sirkel åleine drukna lett mot mørkt/rotete videoinnhald.
2. **Chat-lanseringsknappen (`module-chat.js`, `#vw-btn`) er no drabar**: løyser at knappen sjølv kan liggje i vegen for anna innhald. Peikar-basert dra (mus OG touch, via `touch-action:none`), med ein liten terskel (6px) for å skilje eit ekte drag frå eit vanleg klikk -- eit fullført drag undertrykkjer den påfølgjande klikk-hendinga slik at panelet ikkje opnar/lukkar seg utilsikta. **Økt-basert, ikkje lagra mellom besøk** (medvite val, sjå nedanfor) -- posisjonen nullstillast ved sideinnlasting. Sjølve chat-panelet held fram med å opne frå den opphavlege hjørna, ikkje der knappen vart dratt til.

**Ikkje gjort**: persistert (localStorage) posisjon for chat-knappen -- vurdert, men medvite utsett då brukar ba om det enklaste fyrste steget. Mobil/desktop-spesifikke fokuspunkt for karusell-video (frå 0.70.0-runden) er også framleis uløyst av same grunn.

587/587 + 162/162 OK. Verifisert direkte i nettlesar (lokal statisk server): lyd-knappen sin nye pille-stil stadfesta visuelt, chat-drag stadfesta med faktiske peikar-hendingar (flytta knappen, stadfesta at panelet IKKJE opna seg etter draget, stadfesta at eit ekte klikk etterpå framleis opnar det).

---

## 0.70.0 — 2026-07-20

### Karusell: lyd-av/på for video, valfri fyllmodus, fokuspunkt for video

Oppfølging same dag som 0.69.1-fiksen -- brukar ba om tre konkrete forbetringar til video-slides i `module-carousel.js`, etter ein kort utforskande runde om lyd-autoplay og stående-video-på-brei-skjerm-problemet:

1. **Lyd-av/på-knapp**: video-slides autoplayar framleis alltid muted (nettlesarar blokkerer autoplay MED lyd så godt som alltid utan tidlegare brukar-interaksjon på domenet) -- men no med ein liten knapp (nede til høgre på slidet) som let besøkande sjølv skru på lyden med eit ekte klikk. `bindSoundButtons()`, kalla frå `mountCarousel()` uavhengig av slide-tal.
2. **Fyllmodus, valfri per video-slide**: nytt `sl.video.fit` ("cover" standard, uendra åtferd, eller "contain") + `sl.video.fitBg` (bakgrunnsfarge for stolpane i contain-modus). Løyser eit tilbakevendande problem -- ein ståande video ser fin ut på mobil, men vert kraftig beskoren på brei skjerm med cover. IKKJE gjort til ny standard (liggjande video fungerer best med cover på begge flater, stadfesta av brukar).
3. **Fokuspunkt for video** (nytt `sl.video.pos`, berre brukt i cover-modus): ein dra-/piltast-styrt utsnitt-veljar i editoren, visuelt gjenbruk av dei globale `.imgfield__preview`/`.cropper__window`-klassane frå `admin/index.html`, men implementert som ein eigen, enkel `bindVideoCroppers()` i `module-carousel.js` sjølv (rører ikkje `core.js` sin delte `bindImageFields()`) -- video hadde tidlegare ingen beskjeringskontroll i det heile. Mobil/desktop-spesifikke fokuspunkt vart vurdert og medvite utsett (større, cross-module-endring som ville trengt ein Arkitekt-runde) -- brukar ba om det enkle steget først.

587/587 + 162/162 OK.

---

## 0.69.1 — 2026-07-20

### Retting: karusell-bilde synte seg aldri (CSS-høgd-bug)

Brukar rapporterte at ei ny karusell med to bilde-slides synte seg tom -- berre tittel/brødtekst (kviit på kvitt, usynleg) og piler/prikkar, ingen bilde. Stadfesta live på vibeverk.no: begge `<img>`-elementa hadde faktisk gyldig `src` og lasta OK (`complete:true`, verkeleg breidde/høgd), men var usynlege sidan `.crsl-viewport` sin utrekna høgd var `0px`.

**Rotårsak**: `.crsl-viewport{height:100%}` i `module-carousel.js` sin `injectStyles()` var relativ til `.crsl-section`, som berre set `min-height` (via inline stil i `renderCarousel()`), ikkje `height`. Prosentbaserte høgder reknar berre ut frå ein forelder med EKSPLISITT `height` -- `min-height` tel ikkje, så prosenten fell attende til `auto`. Sidan `.crsl-viewport` sitt einaste innhald er absolutt-posisjonerte slides (bidrar ikkje til normal flyt-høgd), vart `auto`-høgda `0`.

**Fiks**: `.crsl-viewport` endra frå `position:relative;width:100%;height:100%` til `position:absolute;inset:0` -- fyller `.crsl-section` (som alt er `position:relative`) direkte, uavhengig av korleis section sin høgd vart utrekna. Ingen endring i sjølve slide-posisjoneringa (framleis `position:absolute;inset:0` relativt til viewport). 587/587 + 162/162 OK.

---

## 0.69.0 — 2026-07-20

### Retting: fjerna Console sin separate "Banner"-brytar frå Modular-fana

Tredje same-dags oppfølging: brukar viste eit skjermbilde av Console sin "Modular"-fane, der "Banner" framleis stod som sin eigen, sjølvstendig checkbox ved sida av "Design" -- misvisande sidan 0.67.0 sin endring alt gjer scrollbanner (og karusell) styrt UTELUKKANDE av `features.sidebygger`. Denne checkboxen gjorde difor ingenting lenger; av/på hadde ingen verknad på om Banner faktisk synte seg.

**Endring**: `scrollbanner` fjerna frå `FEAT_LABELS`/`FEAT_HELP` i `console/console-core.js` (var aldri noka eiga rad for `carousel` her i utgangspunktet). "Design"-checkboxen sin hjelpetekst utvida til å nemne at han no også styrer Banner- og Karusell-seksjonane, ikkje berre sjølve designmal-valet.

Ingen kodeendring i sjølve gaten (0.67.0 sin `features.sidebygger`-sjekk i `module-scrollbanner.js`/`module-carousel.js` er urørt) -- dette er reint ei Console-UI-opprydding for å fjerne ein daud, misvisande brytar.

## 0.68.0 — 2026-07-20

### Retting: Banner og Karusell si admin-CRUD-skjerm ligg no under "Design"-kategorien, ikkje "Innhold"

Oppfølging av 0.67.0 same dag: brukar sjekka produksjon direkte og fann at Banner (`module-scrollbanner.js`) og Karusell (`module-carousel.js`) sine admin-skjermar framleis låg som underfaner av "Innhold"-kategorien i Web-admin, sjølv om aktiverings-*flagget* (`features.sidebygger`) alt var korrekt sett -- feature-gaten frå 0.67.0 fungerte altså som tiltenkt (begge synte seg, sidan sidebygger var sant), men dei synte seg feil STAD.

**Endring**: begge sine `admin.category`-felt endra frå `"innhold"` til `"design"` (same kategori-streng som `design-mal`/`design-firma`/`design-seo`/`design-fargar`/`design-fontar` i core.js). Sidan "Design"-kategorien i seg sjølv berre er synleg når `feat("sidebygger")` er sant (`allowedCategoriesForRole()`, core.js), er dette ei trygg samlokalisering -- same flagg styrer no både om kategorien finst OG om Banner/Karusell-fanene inni han finst.

**Testa**: `node test.js` (587/587 OK) og `node test-workspace.js` (162/162 OK) -- ingen eksisterande test hardkoda kategori-plasseringa, så ingen testendring var naudsynt utover det som alt var gjort i 0.67.0.

## 0.67.0 — 2026-07-20

### Retting: scrollbanner og karusell ligg no under Design-modulen, ikkje bak eigne separate brytarar

Same-dags korrigering av 0.66.0: brukar presiserte at BÅDE scrollbanner (`module-scrollbanner.js`) OG karusell (`module-carousel.js`) skulle liggje under Design-modulen ("sidebygger") og verte aktivert samla når kunden har Design-modulen på i Console — ikkje bak sine eigne separate flagg, slik 0.66.0 sitt utkast bygde det (og slik scrollbanner alltid har fungert, heilt sidan det vart bygd, uavhengig av sidebygger).

**Endring**: begge modulane sin feature-gate er bytt frå sine eigne separate flagg (`features.scrollbanner`/`features.carousel`) til å krevje `features.sidebygger === true` -- same flagg som sjølve Design-modulen. `features.carousel` er fjerna heilt frå `config.js` (var berre i bruk éin dag). `features.scrollbanner`-linja er også fjerna frå `config.js` sidan ho ikkje lenger er lesen av koden.

**Praktisk konsekvens**: scrollbanner, som tidlegare var på som standard for alle kundar (uavhengig av Design-modulen), krev no at kunden har Design-modulen aktivert. For den eine eksisterande kunden (nordpunkt/Vibeverk sjølv) er dette usynleg -- `features.sidebygger` var alt sett til `true` i produksjonens `superconfig`-rad frå tidlegare. For framtidige kundar utan Design-modulen vil scrollbanner no vere av som standard, saman med karusell.

**Produksjon**: `features.carousel`-nøkkelen (sett direkte via SQL tidlegare same dag, før denne retting vart klar) er fjerna att frå produksjonens `superconfig`-rad sidan koden ikkje lenger les han. `features.sidebygger: true` stod alt der frå før -- ingen ny produksjonsverdi trengst for at retting skal virke for denne kunden.

**Testa**: `node test.js` (587/587 OK, karusell-testblokka patcha til å setje `sidebygger: true` i staden for det no fjerna `carousel`-flagget) og `node test-workspace.js` (162/162 OK, uendra).

## 0.66.0 — 2026-07-20

### Ny modul: bilde/film-karusell (`module-carousel.js`), av som standard

Ny, sjølvstendig karusell-komponent — kan setjast inn på sida på same måte som scrollbanner (eiga `App.registerModule()`-oppføring per karusell, admin-CRUD under "Innhald"), men støttar fleire slides som roterer, med bilete- OG videoslides. Bygd som eit eige steg, ikkje inn i Design-modulen/sidebygger enno (brukar sin idé om å flytte begge dit seinare står ved lag som eit separat, seinare steg).

**Viktig kode-funn undervegs**: scrollbanner er IKKJE ein roterande karusell i dag — kvar banner er sin eigen, uavhengige, statiske enkeltbilete-seksjon utan slide-array, auto-rullering, piler eller sveip. Rulle-/karusell-mekanikken i denne modulen er difor heilt ny kode (kryssoverblending mellom slides, ingen ekstern biblioteksavhengnad), ikkje ein kopi av noko eksisterande.

**Framdrift**: kvar karusell vel sjølv `advance.mode` — `"auto"` (tidsstyrt, konfigurerbart intervall i sekund, pausar ved hover/fokus/skjult fane, undertrykt heilt av `prefers-reduced-motion: reduce`) eller `"manual"` (ingen tidsstyring — pil-knappar, klikkbare prikk-indikatorar, sveip via pointer-hendingar med 40px-terskel, pil-tastar når fokusert).

**Video-scope, medvite avgrensa for v1**: berre `video/mp4`, 20 MB per fil, stille/ambient korte produktvideoar (alltid `muted loop playsinline` — ingen lydhandtering). Ny, eigen Storage-bucket `media-video` (`supabase/migrations/20260719224831_carousel_video_bucket.sql`) — ikkje ei utviding av den delte `media`-bucketen, sidan `media` sin `files/`-prefiks også vert brukt av den anonyme, kvote-styrte tilbods-vedlegg-flyten (same grunngjeving som `crm-documents`-bucketen). Ny `Media.putVideo()`/`Media.freeVideo()` i `core.js`.

**CSP-fiks (naudsynt, ikkje valfri)**: verken `index.html` eller `admin/index.html` sin CSP hadde ein `media-src`-direktiv — utan han fell video-avspeling attende til `default-src 'self'`, som ville stille blokkert alle `https://*.supabase.co`-videoar. Lagt til `media-src 'self' https://*.supabase.co;` i begge filene.

**Feature-flag**: ny `carousel`-flagg, **av som standard** (`config.js`: `carousel: false`) — motsett av scrollbanner sitt "på om ikkje eksplisitt av"-mønster, sidan dette er ny, uprøvd rulle-/videokode med ein reell ny lagringskostnad. Skru på per kunde etter kvart som utprøvd.

**Ikkje gjort i denne runden**: ingen integrasjon i Design-modulen/sidebygger, ingen retrofitting av scrollbanner sitt eige orphan-on-delete Storage-hòl (berre den nye karusell-koden sine eigne slides friar opp Storage-objekt ved sletting), ingen Workspace-flate (same fotavtrykk som scrollbanner — berre offentleg side + Web-admin).

**Testa**: `test.js` (nye "— Karusell —"-blokker, jsdom-separat vindauge-mønster henta frå `test-workspace.js` sitt Z/AA-mønster: config-flagg patcha via kjeldetekst-erstatning, `localStorage` førehandssådd, `setInterval`-spion for å telje tidsstyrings-oppretting utan ekte tidsforseinking) — 586/586 OK. `test-workspace.js` uendra (ingen Workspace-flate) — 162/162 OK.

**Attstår før produksjonsklar**: ekte opplasting-test med eit ekte mp4-klipp + bilete i same karusell (stadfeste at CSP-fiksen faktisk let videoen spele i ein ekte nettlesar, ikkje berre at koden ser rett ut), UX/Mobile Reviewer-gjennomgang, `docs/architecture/copy-style-guide.md`-sjekk av nye tekststrengar. Migrasjonen er IKKJE køyrd mot noko Supabase-prosjekt enno (krev eiga godkjenning, åtskilt frå kode-merge).

## 0.65.0 — 2026-07-19

### CRM sin E-post/Svar-dialog sende literal "{dato}"/"{melding}"-tekst til ekte kundar

Funne under sluttverifisering av 0.64.1-fiksen (fjerde ekte send+svar-runde mot produksjon, denne gongen med rett Resend-inngåande-adresse): den mottekne testmeldinga viste literal, ufylt `"Mottatt: {dato}"` og tom `{melding}` i svarteksten.

**Rotårsak**: `module-crm.js` sin `openEmailDialog()` (CRM sin eigen "E-post"/"Svar"-knapp) sende `defaultTemplate: ""` til den delte `App.openReplyModal()` (`core.js`). Der er fallback-logikken `opts.defaultTemplate || DEFAULT_REPLY_TEMPLATE` — sidan `""` er falsy, trigga fallback-en alltid til `DEFAULT_REPLY_TEMPLATE`, som inneheld `{dato}`/`{melding}`-plasshaldarar meint for LEAD-svar-flyten (som faktisk fyller desse frå den opphavlege henvendinga sin dato/tekst). CRM sin eigen `vars`-objekt gjev aldri `dato`/`melding`, og `fillTemplate()` let med vilje ukjende plasshaldarar stå urørt (dokumentert, testa åtferd) — så dei vart sende bokstaveleg til kunden.

- **`module-crm.js`**: ny `CRM_DEFAULT_TEMPLATE` (berre `{navn}`, som CRM sin `vars`-objekt faktisk gjev), sendt eksplisitt i staden for tom streng. Det opphavlege meldingsinnhaldet (ved svar på ei eksisterande henvending) vert alt vist separat via `previewHtml` — malen treng difor ikkje sitere det på nytt.

`test.js`: 576 OK / 0 FEIL. `test-workspace.js`: 162 OK / 0 FEIL.

## 0.64.1 — 2026-07-19

### Retting av 0.64.0: Resend bevarer IKKJE ein sjølvvald Message-ID-header — den ekte verdien må hentast, ikkje mynta

Live-verifikasjon av 0.64.0-fiksen (tre ekte send+svar-rundar mot produksjon, siste med rett inngåande Resend-adresse) synte at rotårsaks-fiksen sitt "Del A" var utilstrekkeleg: Resend (relayen bak, Amazon SES) bevarer IKKJE ein sjølvvald `Message-ID`-header verbatim, sjølv om han vert sendt med i sendekallet. Den faktiske e-posten mottakaren fekk, og som mottakaren sitt ekte svar sin `In-Reply-To` viste til, hadde ein SES-tildelt Message-ID (`<...@eu-west-1.amazonses.com>`), heilt ulik vår eigen genererte `<uuid@vibeverk.no>`-verdi — stadfesta direkte i `inbound_emails`-loggen sin `in_reply_to`-kolonne.

- **`supabase/functions/send-reply/index.ts`**: oppfølgingskallet til Resend sin `GET /emails/{id}` (som 0.64.0 nedgraderte til rein diagnostikk) er no den AUTORITATIVE kjelda for `resendMessageId` att — held vår eigen genererte id som fallback berre om oppfølgingskallet feilar heilt (nettverksfeil e.l.), ikkje som primærkjelde.
- Same feil vart fanga same dag via faktisk levert bevis (ikkje berre kode-lesing) — understrekar kvifor "Del B" i den opphavlege planen (behalde oppfølgingskallet som verifikasjon) var rett kalla, sjølv om den fyrste implementeringa av "Del A" viste seg feil.

Ikkje enno reverifisert med ein fjerde send+svar-runde etter denne retteninga — bør gjerast før dette reknast som endeleg stadfesta.

`test.js`: 576 OK / 0 FEIL. `test-workspace.js`: 162 OK / 0 FEIL (ingen av desse dekker sjølve Deno-funksjonen direkte).

## 0.64.0 — 2026-07-19

### E-post-tråd-matching har aldri fungert i produksjon — fiksa rotårsaka, la til samanslegen samtale-visning i CRM

Brukar testa CRM sin e-post-svar-funksjon manuelt i produksjon i dag (ekte svar til ein reell kunde, kunden svarte tilbake, svaret vart korrekt tråda i kunden sin eigen e-postklient). Den innkomande meldinga vart likevel merkt "Ikkje verifisert" — overraskande, sidan det openbert var eit ekte, autentisert svar.

**Rotårsak, stadfesta direkte mot produksjonsdatabasen**: "Ikkje verifisert" måler *"vart denne oppføringa automatisk oppretta frå ein e-post me ikkje kunne tråd-matche"*, ikkje DKIM/SPF/DMARC-autentisering (dette er alt dokumentert, sjå `docs/compliance/draft-inbound-email-legal-basis-memo.md`). Problemet var at tråd-matchinga i praksis ALLTID feilar: kvar einaste `email_sent`-rad i produksjon (frå 2026-06-30 og fram til i dag) hadde `data.resendMessageId = NULL`. `send-reply/index.ts` sitt oppfølgingskall til Resend (`GET /emails/{id}`) for å hente den ekte Message-ID-en gav aldri eit brukbart resultat — koden sin eigen kommentar hevda dette var "ikkje-kritisk", men i praksis øydela det heile tråd-matching-designet permanent, sidan `process_inbound_email()` er bygd rundt akkurat dette feltet.

- **`supabase/functions/send-reply/index.ts`**: genererer no vår eigen RFC5322 Message-ID FØR sending (`crypto.randomUUID()`) og sender han med som ein eigen header på sjølve sendekallet, i staden for å stole på Resend sitt oppfølgingskall i ettertid. Oppfølgingskallet er behalde, men berre som rein diagnostikk (retry + logging) — det er ikkje lenger load-bearing for returverdien. Ikkje enno stadfesta live om Resend faktisk bevarer ein sjølvvald Message-ID-header uendra (krev ei ekte sending å avgjere — diagnostikken vil vise dette på neste sending).
- **`supabase/migrations/20260719204806_inbound_email_unmatched_thread_id.sql`**: "ukjend avsendar"-greina i `process_inbound_email()` fekk aldri ein `threadId` i det heile (berre den matcha greina gjorde). Fiksa til å gjenbruke kunden sin siste eksisterande tråd (om ein finst), elles mynte ein fersk. Ingen etterfylling av historiske rader (avklart med brukar) — reint framoverretta.
- **`module-crm.js`**: CRM-tidslinja grupperer no e-postar med same `threadId` i éin samanslegen, opne/lukke-bar "samtale" (`buildTimeline()`/ny `tlThreadGroup()`), i staden for å vise kvar e-post som ei separat flat rad. Berre den nyaste samtalen er open som standard. Andre hendingstypar (telefonnotat, oppgåver, dokument) er uendra, framleis enkeltrader.

`test.js`: 576 OK / 0 FEIL. `test-workspace.js`: 162 OK / 0 FEIL.

---

## (ingen kodeendring i repoet, kun ein live Supabase-secret + dokumentasjon) — 2026-07-19

### Sunnvask-demo sin `send-reply` kunne ikkje faktisk sende e-post — RESEND_API_KEY var aldri sett

Fanga under B7.3-live-testing (CRM "Svar"-utsending mot Sunnvask-demo, med brukar sitt eksplisitte samtykke til å sende ein reell test-e-post til si eiga adresse). Funksjonen var deployert (del av section-0-gap-lukkinga tidlegare same dag), men mangla sin påkravde `RESEND_API_KEY`-secret — sendinga feila med "RESEND_API_KEY ikkje satt i secrets". Brukar lokaliserte og oppga ein gyldig Resend-nøkkel frå kontoen sin (stadfesta mot domenet verifisert for `vibeverk.no`); sett via `npx supabase secrets set RESEND_API_KEY=... --project-ref nzgibflxodcwuhtaprrs`. Retesta: sendinga lukkast (`crm_comms`-rad med `type: "email_sent"` oppretta), og brukar stadfesta sjølv reell mottak i eigen innboks — ekte ende-til-ende-prov, ikkje berre eit feilfritt API-svar. Ein mindre, allereie kode-dokumentert biverknad vart observert (`resendMessageId` kom attende `null` — påverkar berre framtidig tråd-matching for akkurat denne e-posten, ikkje sjølve sendinga) men vart ikkje følgt vidare opp denne runda. Alle testrader sletta etterpå.

## 0.63.0 — 2026-07-19

### Chat-heartbeaten skreiv aldri til databasen — admin sin "Online"-knapp har vore ein illusjon

Funne under B5-live-testing (testmatrisa) mot Sunnvask-demo: logga inn som ekte admin, klikka "Online" i chat-panelet (`#vwca-avail-btn`), knappen synte korrekt "Online" i UI-et — men ei uavhengig, direkte SQL-sjekk av `store`-tabellen synte at rada `chat-heartbeat` ALDRI vart oppretta, uansett kor mange gonger knappen vart klikka av/på. Ei ny nettlesarfane som ein anonym besøkjande synte konsekvent den OFFLINE-fallback-skjemaet ("Vi er ikke tilgjengelig akkurat nå"), aldri den levande chat-komponisten.

**Rotårsak, stadfesta empirisk** (`module-chat.js`, `_startHeartbeat()`): `_sb.from("store").upsert(...)` vart kalla utan `.then()`/`await`. supabase-js sin `PostgrestBuilder` er ein "lazy thenable" -- det faktiske HTTP-kallet vert FYRST sendt når `.then()` (eller `await`) vert kalla på resultatet. Utan det køyrer koden utan synleg feil, men ingenting vert nokon gong sendt til Supabase. Stadfesta direkte: identisk kall utan `.then()` skreiv aldri rada (kontrollert via SQL etterpå); identisk kall MED `await` skreiv rada med det same (status 201, ingen feil).

**Reell konsekvens**: sidan `heartbeatFresh` (den delen av koden som avgjer om ein besøkjande skal sjå den levande chat-komponisten eller offline-skjemaet) krev ei fersk `chat-heartbeat`-rad, har ingen admin NOKON gong faktisk vore "online" frå ein besøkjande sitt synspunkt, uansett kor mange gonger dei har trykt knappen — funksjonen har vore stille øydelagd sidan han vart bygd, ikkje berre inaktiv i denne demoen.

**Fiksa**: `_startHeartbeat()` sin `hb()`-funksjon `.then()`-ar no det faktiske resultatet og loggar til konsollen viss det feilar. Same fiks lagt til på eit separat, urelatert stille-kall (`Chat.deleteConv()`, linje 290) — denne funksjonen har for øvrig ingen kallar nokon stad i koden i dag (daud kode, ikkje ein reell buggy live-flyt), men fiksa for konsistens sidan same mønster gjentek seg.

Ikkje enno stadfesta live på nytt etter deploy (krev at fiksen faktisk er live på Sunnvask-demo/produksjon), og ikkje ein full kodebase-brei sveip etter same mønster andre stader (jf. den attverande, medvite utsette Batch 5-punktet i den store gjennomgangsplanen frå tidlegare denne økta) — berre denne konkrete, empirisk stadfesta forekomsten er fiksa no.

`test.js`: 576 OK / 0 FEIL. `test-workspace.js`: 162 OK / 0 FEIL.

## 0.62.0 — 2026-07-19

### Codex sin live-testrunde mot Sunnvask-demo: tre funn, to fiksa, éin klarna som ikkje-bug

Ekstern Codex-økt fekk admin-tilgang og køyrde ei eiga, sjølvstendig gjennomkøyring av testmatrisa mot Sunnvask-demo (kontakt, tilbod med/utan vedlegg, chat-fallback, oppgåver, notat, CRM-dokument, responsivitet 375/768/1280px, alle Workspace-rutene) — alt bestod, ingen kode endra av det. Tre presentasjonsklar-funn vart rapportert:

1. **To PWTEST-kundar synlege i kundelista** — desse var att frå MIN EIGEN live-testing tidlegare same dag (B2/B3.2 i `TEST-MATRIX.md`), ikkje frå Codex sin eigen (som korrekt rapporterte null eigne rester). Sletta: `leads` (2 rader), `crm_customers` (2 rader). Éin liten (68 byte) test-PNG står att i Storage — usynleg i UI, ville kravd ein service_role-nøkkel å fjerne via Storage-API-et (SQL åleine kan ikkje slette `storage.objects`-rader direkte), vurdert som ikkje verdt å jage.
2. **Stort tomrom mellom «Om oss» og footeren, opplevd som underfylt på desktop** — undersøkt direkte: DOM-inspeksjon synte INGEN faktisk gap (kvar seksjon sin topp-piksel er nøyaktig lik føregåande seksjon sin botn-piksel), og alle reveal-på-scroll-klassane hadde alt løyst til `is-visible`/`opacity:1`. Sunnvask-demo sitt `store.content` har faktisk fullt innhald (hero/about/3 tenester/3 nyhende/kontakt). Mest sannsynlege forklaring: «Om oss»-seksjonen manglar eige bilete (`about.image.src` er tom streng) og er berre to setningar tekst, medan KVAR seksjon får same generøse 112–128px topp/botn-padding uavhengig av innhaldsmengd — på ein brei skjerm les dette som «halvferdig», sjølv om det ikkje er ein render-feil. Ikkje fiksa denne runda — krev anten ekte About-bilete (innhald, ikkje kode) eller ei bevisst paddings-justering (påverkar alle tenantar, ikkje berre demoen) — open avgjerd.
3. **Konsollvarsel om manglande SITE_CONFIG-felt på nesten alle sider — FIKSA.** `core.js` sin `applyConfigDefaults()` sjekka `DEFAULT_CFG_SHAPE`-nøklane (company/colors/fonts/privacy/admin/workspace/hero/about/contact/news/services/contactSection) mot det rå `window.SITE_CONFIG` og åtvara viss nokon mangla — men for KVAR Fase-6-tenant (både Sunnvask-demo og Vibeverk sjølv, sidan DNS-flyttinga) er desse nøklane STRUKTURELT alltid fråverande på dette tidspunktet, med vilje (dei kjem frå superconfig/broker seinare, sjå `api/tenant-config.js`). Varselet fyrte difor identisk anten kunden sin faktiske konfigurasjon var fylt ut eller ikkje — reint støy, aldri eit reelt signal i Fase-6-verda. Fjerna heilt (fillConfigDefaults() sjølv er uendra og verkar framleis korrekt). `docs/architecture/tenant-onboarding-runbook.md` retta samtidig — Steg 8 der viste til nettopp dette varselet som eit "innebygd sjekkliste-signal", noko som aldri faktisk stemte (varselet fyrte likt uansett om steget var gjort).
- `test.js`: 576 OK / 0 FEIL. `test-workspace.js`: 162 OK / 0 FEIL. Ingen regresjon.

## 0.61.0 — 2026-07-19

### Rå Supabase Storage-feilmelding lekte til besøkjande på tilbodsskjemaet — funne via live nettlesartesting, no fiksa

Fanga under manuell, verkeleg nettlesarbasert gjennomkøyring av testmatrisa (`.claude/skills/smoke-vibeverk/TEST-MATRIX.md` B3.2) mot Sunnvask-demo — ikkje via kodelesing åleine, som er heile poenget med å faktisk køyre live-testar. Ei fil med feil MIME-type (`.txt`) sendt inn som vedlegg på tilbodsskjemaet synte den rå, tekniske Supabase Storage-feilmeldinga ("mime type text/plain is not supported") direkte til den besøkjande — eit brot på `docs/architecture/copy-style-guide.md` sitt standande krav om at alt brukarvendt innhald skal unngå teknisk sjargong.

- **`core.js`** (`Media.putFileAnon`): fangar no `up.error` frå Storage-opplastinga, loggar den rå detaljen til konsollen for feilsøking, og kastar ein kort, intern feilkode (`"storage-upload-failed"`) i staden for å la det rå feilobjektet forplante seg vidare.
- **`module-quote.js`**: catch-handleren sin denylist for interne feilkodar (`"size"`, `"upload-token"`) er utvida med `"storage-upload-failed"`, slik at brukaren framleis ser den eksisterande, trygge, generiske opplastingsfeil-meldinga i staden for den rå Storage-teksten.
- Stadfesta direkte via SQL at det mislykka forsøket (feil MIME-type) korrekt skapte **null** `leads`-rader — i tråd med den alt kode-dokumenterte `Promise.all()`-åtferda (éin mislykka vedleggsopplasting blokkerer heile innsendinga, ikkje berre vedlegget).
- Retesta same flyt med eit gyldig `.png`-vedlegg: innsendinga lukkast, og den resulterande `leads`-rada sitt `attachments`-felt vart stadfesta å peike på eit ekte, hentbart Storage-objekt (`HEAD` → `200 image/png`), ikkje berre ein filnamn-streng — B3.2 sitt eksakte pass-kriterium i testmatrisa.
- `test.js`: 576 OK / 0 FEIL. `test-workspace.js`: 162 OK / 0 FEIL. Ingen regresjon.

## (ingen kodeendring i repoet, kun dokumentasjon + live Supabase-endringar) — 2026-07-19

### Sunnvask-demo sitt driftsgjeld-gap lukka + ein reell dokumentasjonsfeil retta av brukar

Direkte oppfølging av launch-readiness-runda (0.53.0–0.60.0). Brukar oppga Sunnvask-demo sin pooler-tilkoplingsstreng, som gjorde det mogleg å stadfeste og lukke gapet den same dokumentasjonsrunda berre kunne mistenkje:

- **Stadfesta nøyaktig som mistenkt**: Sunnvask-demo (`nzgibflxodcwuhtaprrs`) sat på migrasjon `20260714133000`, 9 migrasjonar bak. `npx supabase db push` deploya dei attverande 9, deretter vart `send-reply`, `inbound-email` og `anon-media-upload-token` deploya som Edge Functions, pluss ein ny `ANON_UPLOAD_QUOTA_PEPPER`-secret. Alt verifisert direkte etterpå (migrasjonstal, bucket-eksistens, RPC-tilgang) — ikkje berre stolt på ein rein exit-kode. Sunnvask-demo er no fullt deployment-likt med produksjon/staging.
- **Ein reell dokumentasjonsfeil fanga av brukar, ikkje av nokon gjennomgang**: denne same runda sin dokumentasjon (`CURRENT_STATE.md`, `ROADMAP.md`, `TEST-MATRIX.md`) hadde skrive at `features.sidebygger` var av på begge reelle tenantar — ein påstand henta frå gamal prosjektminne, aldri direkte spurt opp mot den faktiske databasen. Brukar viste eit skjermbilete av sitt eige, live Web-admin-panel med Design-fana synleg og spurde "stemmer dette?". Direkte spørring mot `store.superconfig` på begge prosjekt stadfesta: **`features.sidebygger` er faktisk `true` på både produksjon og Sunnvask-demo.** Alle tre dokumenta retta same dag. Same lærdom som fleire gonger tidlegare denne økta: ikkje gjenta ein tidlegare påstand utan å spørje opp den faktiske kjelda på nytt.

## 0.60.0 — 2026-07-19

### Begge kjende, langvarige testunntak fjerna — begge suitene no 0 FEIL

Del av ein bredare launch-readiness/oppryddings-runde (Codex-forslag, justert og godkjent av brukar). Ingen produktkode endra — reint testkode-arbeid, ingen deploy-risiko.

- **`test.js`** (`"henvendelses-fanen heter «Kontakt»"`): rotårsak funnen ved direkte feilsøking (ikkje gjetting) — `setTabBadge()` (`core.js`) legg eit `.tab-badge`-span inn i "Kontakt"-fana når det finst uleste henvendelser, som gjer `textContent` til `"Kontakt1"` i staden for `"Kontakt"`. Ekte, tiltenkt funksjon — ikkje ein bug. Testen sin eksakte array-samanlikning tok aldri høgde for dette. Retta: ein liten hjelpefunksjon strippar badge-teksten før samanlikning.
- **`test-workspace.js`** (`"o3: workspaceship via direkterute"`): testa ei rute (`#/workspaceship`) som ikkje lenger finst — Fase 10 sitt `customModules`-arbeid registrerer spelet under modul-id `"spaceship"` i staden, og berre når `customModules.spaceship.enabled===true`. Fjerna som reelt overflødig: AA-seksjonen sin `aa2`-test dekkjer alt same åtferd korrekt, med rett namn og rett config-oppsett.

**`test.js`: 576 OK / 0 FEIL. `test-workspace.js`: 162 OK / 0 FEIL.** `CLAUDE.md` sin "Testing"-seksjon oppdatert til å ikkje lenger liste nokon aksepterte unntak.

## 0.59.0 — 2026-07-19

### Touch-target-storleik-sveip (Batch 6, resten) + eit mist WCAG-kontrastfunn retta

Held fram Batch 6 sitt "touch-target-storleik-bump"-punkt, som 0.52.0 uttrykkeleg utsette fordi det då kravde visuell nettlesarverifisering. Denne runda vart det gjort likevel, avgrensa til dei ikon-berre lukk-/fjern-knappane som fekk `aria-label` i 0.52.0 (dei tydelegaste, mest brukte tilfella — ikkje eit uttømmande sveip av heile kodebasen):

- Delt CRM-dialog-lukkeknapp (`crm-dlg-close`, brukt av ALLE `openDialog()`-dialogar), e-postsvar-lukk (`data-reply-close`), hub-modal-lukk, Workspace sine kontakt-/booking-/tilbods-/oppgåve-detaljruter, kunngjerings-lesar/redigering, notat-modal, mediebank-lysbilete: alle bumpa frå reelt ustilt/knapt polstra til `min-width/min-height: 36px` (flex-sentrert, ikonet urørt visuelt).
- E-postsvar-editoren sin vedleggs-fjern-knapp (tettare kontekst, mindre bump til 28px).
- CRM-tidslinja sin "Fjern hending"-knapp (`crm-tl-del`) fekk både `aria-label="Fjern"` (mangla heilt frå før) og ein 32px touch-target, i tillegg til touch-target-bump på Workspace og Console sine hamburgerknappar (40px).
- **Eit ekstra WCAG-kontrastfunn frå 0.52.0-sveipen vart oppdaga under dette arbeidet**: den klikkbare "Ikkje verifisert"-VERIFISER-knappen i CRM-tidslinja (`data-verify-comm`, ei anna rendring av same badge enn den alt retta i 0.52.0) brukte framleis rå `#E8833A`-tekstfarge — 0.52.0 sin grep fanga ikkje opp denne fordi verktøyet trunkerte akkurat den linja. Retta til same `#A8551A` som resten.

Nokre knappar (Workspace sin kunngjeringsbanner sin lukk-knapp, og dei tre ikon-knappane i kvart mediebank-filkort) vart medvite IKKJE endra denne runda — dei sit i tettpakka, høgdeavgrensa layoutar (ein tynn banner, eit tett bilete-rutenett) der ein rein kode-basert bump utan visuell stikkprøve kunne bryte det eksisterande utsjånaden. Same avgrensing som Console-punktet i 0.53.0: full stadfesting krev ekte nettlesar-mål, ikkje berre CSS-lesing.

## 0.58.0 — 2026-07-19

### Console-responsivitet — hamburger/overlay-mønster porta frå Workspace

Console hadde ingen responsiv CSS i det heile — sidemenyen (`.cs-sidebar`, fast 224px) var alltid synleg og trengte plass frå hovudinnhaldet uansett skjermbreidde, urørt sidan Console vart bygd. Dette var det største attverande punktet frå Batch 6 (UX/tilgjenge), spora sidan 0.51.0 sin store gjennomgang og eksplisitt utsett då.

Porta Workspace sitt allereie eksisterande hamburger/overlay-mønster (`.i-hamburger`/`.i-sidebar-overlay` i `workspace/index.html` og `workspace-core.js`) til Console:
- Ny `.cs-mobile-bar` (sticky, berre synleg under 700px) med hamburgerknapp og "Console"-tittel, lagt til øvst i `.cs-main`.
- `.cs-sidebar` vert `position: fixed` og skyvd av skjermen (`translateX(-100%)`) under 700px, med ein overlegg (`.cs-sidebar-overlay`) som viser/skjuler saman med menyen.
- `buildShell()` i `console-core.js` bind opne/lukke-logikk identisk med Workspace sitt mønster — overlegg-klikk og val av eit nav-punkt lukkar menyen att.

Verifisert visuelt (ikkje berre kode-lese): `resize_window` gav ikkje reell viewport-endring i dette miljøet sitt nettlesar-sandkasse, så mekanismen (av/på-tilstand, overlegg, auto-lukk ved navigering) vart i staden stadfesta ved mellombels å tvinge `@media`-brytpunktet aktivt i ein eingongs test-kopi (aldri committa) — hamburgeropning, overlegg-lukking og nav-val-lukking fungerte alle som venta.

**Ikkje del av denne runda**: ein grundigare gjennomgang av INNHALDET i kvar Console-fane (skjema/tabellar/rutenett) sin respons på smale skjermar utover sjølve skallet — same avgrensing som touch-target-sveipen i 0.52.0, treng ekte mobil-nettlesar-verifisering.

## 0.57.0 — 2026-07-19

### Media-bucket anon-opplastingskvote — deploya til produksjon, ein reell bug fanga undervegs

Deploya 0.55.0/0.56.0 sin fulle media-opplastingskvote (migrasjonar + Edge Function + secret) til produksjon (`clzczbyklgdtdhgjphup`), etter staging-verifiseringa i 0.56.0.

**Reell, ny bug fanga live under produksjonsdeploy, ikkje berre anteke løyst**: rett etter migrasjonen var pusha, stadfesta ein direkte `has_function_privilege`-sjekk at `service_role` IKKJE hadde `EXECUTE` på `bump_and_check_anon_upload_quota()` på produksjon — sjølv om same sjekk synte `true` på staging rett før. 0.55.0 sin migrasjon hadde (per den etablerte ADR-0008-konvensjonen) stole på at Supabase sin plattform-standard-ACL automatisk gjev `service_role` denne tilgangen — men denne konvensjonen stemmer tydelegvis ikkje likt på tvers av alle prosjekt (truleg avhengig av når kvart prosjekt vart oppretta, jf. `config.toml` sin eigen kommentar om at "auto_expose_new_tables"-standarden er i endring). Utan denne fiksen ville Edge Function-en feila stille kvar gong ein anonym besøkjande faktisk prøvde å laste opp eit Tilbod-vedlegg i produksjon.

`supabase/migrations/20260719133529_grant_service_role_anon_upload_quota.sql`: eksplisitt `GRANT EXECUTE ... TO service_role`, deploya til BÅDE produksjon og staging (for konsistens, sjølv der grant alt fanst via plattform-standard). Stadfesta direkte (`has_function_privilege`) på begge etterpå.

**Full ende-til-ende-test køyrd direkte mot produksjon** (minimal — éin token-førespurnad, éi ekte opplasting, éin offentleg-URL-sjekk, deretter rydda opp — IKKJE ein full kvote-uttømming som på staging, for å ikkje bruke opp ein reell kunde sin dagskvote unødvendig): alt fungerte som venta.

## 0.56.0 — 2026-07-19

### Media-bucket anon-opplastingskvote — FULLFØRT (RLS-hòlet stengt, verifisert på staging)

Fullfører 0.55.0 sin attverande punkt. Deploya migrasjon + Edge Function + secret til `vibeverk-staging`, og køyrde ein ekte, ende-til-ende test direkte mot staging (ikkje berre kode-lesing):

- Kvote-telling akkumulerer korrekt per (hasha) besøkjande over fleire kall.
- Kvote-sperra slår faktisk inn ved grensa (20/dag) — eit ekte 429-svar med den brukarvende norske meldinga vart stadfesta.
- Ein ekte fil vart lasta opp via det signerte tokenet og stadfesta offentleg nåbar (`storage/v1/object/public/media/...`).

**Den kritiske, tidlegare uløyste uvissa vart løyst empirisk før RLS-policyen vart fjerna**: mellombels drop av den gamle, opne `media_insert_anon_attachments`-policyen synte at (1) eit direkte anon `.upload()`-kall no feilar korrekt (RLS-avvist), OG (2) den signerte opplastings-token-flyten *framleis* fungerer heilt normalt. Dette stadfester at Supabase sin signert-URL-mekanisme autoriserer via sjølve tokenet (utferda av ein service_role-klient etter ein godkjent kvotesjekk), ikkje via denne RLS-policyen — nøyaktig det Arkitekten bad om å stadfeste før dette steget vart teke.

`supabase/migrations/20260719132533_remove_open_anon_media_upload_policy.sql`: fjernar `media_insert_anon_attachments` for godt. Etter denne migrasjonen er `anon-media-upload-token`-funksjonen DEN EINASTE vegen inn for anonyme opplastingar til `media`-bucket-en sitt `files/`-prefiks.

**Éin attverande, ikkje fullt løyst uvisse**: om `x-forwarded-for` faktisk gjev éin unik IP per besøkjande i produksjon, eller om alle anonyme besøkjande på tvers av plattforma i praksis deler éi "ukjend"-kvote-bøtte (testa berre frå éin maskin, kunne ikkje simulere fleire ulike besøkjande-IP-ar). Verre fall er framleis betre enn ingen sperre i det heile, men presisjonen er ikkje stadfesta.

**Ikkje enno deploya til produksjon** — ventar på eksplisitt godkjenning per den vanlege deployment-sperra.

## 0.55.0 — 2026-07-19

### Media-bucket anon-opplastingskvote (Batch 2, resten) — Arkitekt-konsultert, bygd, IKKJE fullført utrulla

Den siste attverande posten frå Batch 2 (0.51.0/0.52.0): den offentlege `media`-bucket-en sin anon-opplastingsveg (Tilbod-skjemaet sine vedlegg, `module-quote.js`) hadde ingen grense på talet på filer eller opplastingsfrekvens — berre 20MB per fil. Arkitekten vart konsultert om mekanisme (sjå agent-rapport i økta) og konkluderte at ein rein Postgres-trigger/RLS-sjekk aldri kan sjå den faktiske besøkjande sin IP, sidan Storage-API-et opnar si eiga tilkopling uavhengig av PostgREST — kvoteteljing MÅ skje via ein Edge Function.

**Bygd denne runda:**
- `supabase/migrations/20260719124203_anon_media_upload_quota.sql`: ny `anon_upload_quota`-tabell (nøkkel = hasha IP + dato) + `bump_and_check_anon_upload_quota()`-RPC, `SECURITY DEFINER`, eksplisitt `REVOKE FROM anon, authenticated` (berre kallbar frå ein service_role-klient).
- `supabase/functions/anon-media-upload-token/index.ts`: ny Edge Function — les besøkjande sin IP frå `x-forwarded-for` (**ikkje enno empirisk stadfesta mot ein ekte produksjonsrequest**, same atterhald som DMARC-arbeidet i `inbound-email`), hashar han med ein pepper-secret, sjekkar/aukar dagens kvote (20/dag), og gjev berre ut eit signert opplastings-token dersom under kvote.
- `core.js`: ny `Media.putFileAnon(file)` — separat frå den eksisterande `Media.putFile()` (som framleis brukast ugata av dei autentiserte vegane: Aktuelt-editoren og Workspace sitt mediebibliotek). Fell trygt tilbake til `putFile()` sin lokale `file:`-lagring når Supabase ikkje er konfigurert (jsdom/test).
- `module-quote.js`: Tilbod-skjemaet kallar no `putFileAnon()` i staden for `putFile()`, med eigen feilhandtering for kvote-meldinga (ei ferdig brukarvend setning frå funksjonen, ikkje ein kort feilkode).
- Regresjonstest lagt til i `test.js` (575/1, opp frå 573/1 — 2 nye assertions).

**IKKJE fullført denne runda, per Arkitekten sitt eige, eksplisitte åtvaring**: den gamle, opne `media_insert_anon_attachments`-RLS-policyen (som framleis tillèt anon å laste opp direkte via `.upload()` under `files/%`, heilt utanom det nye kvote-gatet) er MEDVITE ikkje fjerna enno. Å fjerne han no, før den nye signert-token-vegen er stadfesta å fungere ende-til-ende mot ein ekte Supabase-instans, kunne brote heile Tilbod-vedleggsfunksjonen blindt. Kvoten er difor i dag reint eit VEDLEGG til den eksisterande opne vegen, ikkje enno ei reell sperre — ein scripta åtakar kunne framleis kalle `.upload()` direkte og omgå heile mekanismen. **Attverande steg, i rekkefølgje**: (1) deploy migrasjon + funksjon til staging, (2) ein ekte opplastingstest gjennom det faktiske Tilbod-skjemaet for å stadfeste `x-forwarded-for`-antakinga og heile flyten, (3) FØRST DA, i ein eigen, seinare migrasjon: fjern/innsnevr `media_insert_anon_attachments` slik at anon-opplasting til `files/%` krev eit gyldig signert token.
## (dokumentasjon, ingen versjonsbump) — 2026-07-19

### WCAG/Lighthouse-revisjon (ROADMAP Steg 9, andre halvdel) — kjørt, éin ny reell finding dokumentert

Kjørte `npx lighthouse` mot ein lokal statisk kopi av heimesida (ekte produksjons-Supabase-prosjekt bak `config.js`, sidan denne kodebasen ikkje har ein separat "demo-modus"). Resultat: **Accessibility 100**, Best Practices 96, SEO 91, Performance 56.

- **Performance-talet er truleg skeivt av sandkasse-miljøet sin nettverksveg til det ekte, eksterne Supabase-prosjektet** (LCP ~31s, driven av mange små sekvensielle REST-kall) — ikkje nødvendigvis representativt for verkelege besøkjande på ekte produksjonsinfrastruktur. Krev ein ekte køyring frå normale nettverksforhold (t.d. PageSpeed Insights mot den faktiske live-URL-en) for eit truverdig tal.
- **Éin reell, ny funn oppdaga via nettverksloggen**: `module-crm.js` hentar `crm_bedrifter`/`crm_customers`/`crm_comms` ubetinga ved kvar offentleg sidelasting, sjølv for anonyme besøkjande — tre alltid-til-stades `401`-kall (RLS avviser korrekt, men kalla er reint sløseri). Rotårsak og kvifor ein naiv fiks (berre hoppe over lastinga når ikkje innlogga) kunne bryte GDPR-slette-boksen sitt datagrunnlag i ein reell brukssituasjon, er dokumentert i `docs/project/CURRENT_STATE.md` "Known limitations" — IKKJE fiksa denne runda, treng sin eigen, meir gjennomtenkte oppfølgingsrunde.
- **Éin funn synte seg IKKJE vere ein bug**: manglande `<meta name="description">`. Koden (`core.js:938-941`) set han korrekt frå `config.company.metaDescription` når feltet er fylt inn — demo-/lokal-`config.js` ship berre med det tomt. Lagt til som eit nytt punkt i `docs/compliance/customer-go-live-checklist.md` sin "Technical readiness"-seksjon.
- Dei attverande Lighthouse "manual check needed"-kategoriane (fokus-fellar, logisk tab-rekkefølgje, landemerke m.m.) vart IKKJE handverifiserte i denne runda — dei krev ekte skjermlesar-/tastatur-brukartesting, eit større, eige tiltak.

Reint dokumentasjonsarbeid denne runda (funna er logga, ikkje fiksa) — ingen kodeendring, difor ingen versjonsbump.

## 0.52.0 — 2026-07-19

### Full kodebase-gjennomgang — Batch 5 (breiare feilhandtering) og Batch 6 (UX/tilgjenge) fiksa

Held fram frå 0.51.0 sin reconsilierte fiksplan (`docs/project/CHANGELOG.md` 0.51.0-oppføringa, sjå og plan-fila referert der). Console-responsivitet (Batch 6 punkt 21) held fram som eige, seinare spora punkt slik det alt var avklart — ikkje del av denne runda.

**Batch 5**:
- Chat-admin-panelet sin Realtime-kanal (`_rtCh`) vart ALDRI avmeldt når admin forlét "Chat"-fana — berre poll-intervallet vart rydda opp (via ein alt eksisterande `document.body.contains(container)`-sjekk). No vert kanalen fjerna (`_sb.removeChannel(...)`) i same sjekkepunkt, som hindrar ubunden vekst av opne Realtime-abonnement gjennom ein arbeidsdag.
- CRM sin "Slå saman kontakter"-dialog: knappane for merking/samanslåing/bulk-sletting av uverifiserte kontaktar var synlege og klikkbare for rolla "member" sjølv om RPC-en (`merge_crm_customers`) alt avviste kallet server-side — no skjult for member, matchande det eksisterande mønsteret for Slett-knappen. `doMerge()` svelgde og RPC-feil heilt stille (dialogen lukka seg som om alt hadde gått bra) — no vert feilen synt i dialogen, og brukaren kan prøve på nytt.
- Workspace sine oppgåver (`updateTask`/`deleteTask`): begge muterte den lokale cachen FØR nettverkskallet var stadfesta, og sjekka aldri `r.error` — ein RLS-avvist endring/sletting synte som vellukka i UI-et heilt til neste sideoppdatering. No vert lokal tilstand rulla attende ved feil, og feilmeldinga vert synt i oppgåve-dialogen/lista i staden for å late att som suksess.
- `restore_backup_tables()` sitt kjende `UNIQUE`-indeks-kantfall (smal 2026-07-13–07-17-tidslinje) er no eksplisitt dokumentert i `docs/project/CURRENT_STATE.md` sine "Known limitations" som eit medvite ikkje-fiksa avvik, i staden for eit ope spørsmål.

**Batch 6**:
- 11 "nakne" `confirm()`-dialogar (CRM-mal/standardtekst-sletting, CRM-hendingssletting, Workspace-oppføring/kunngjering/KB-artikkel/lenke/fil/notat/oppgåve-sletting) mangla omfangs-/angreforklaring per stilguiden sitt Nivå B-krav — alle no utvida til å seie kva som vert påverka og at det ikkje kan angrast. CRM sin kunde-kjapp-slett-knapp (lista-visning) hadde ei kortare, mindre presis tekst enn kunde-detalj-visninga sin slett-knapp for SAME handling — no identisk. CRM-dokumentsletting (via den delte hendings-slett-knappen) seier no eksplisitt at sjølve den opplasta fila vert fjerna for godt, ikkje berre tidslinje-oppføringa.
- WCAG-kontrastfunn for `#E8833A` (kvit tekst/initialar på oransje bakgrunn, ~2,7:1, stryk AA) retta for dei tre TEKST-bruka (avatar-initialar, "Ikkje verifisert"-merket, "Oppfølging"-merket/tagg-knappen) til ein mørkare `#A8551A` (~5,3:1, går AA) — dei reint dekorative ikon-bruka (dokument-/tilbods-tidslinjeikon) er urørte, som avklart i planen.
- 10 lukk-knappar med berre eit "×"-teiknikon og ingen tilgjengeleg tekst (skjermlesarar fekk ingen forklaring) fekk `aria-label="Lukk"` (eller "Fjern vedlegg" for vedleggs-fjern-knappen i e-postsvar-editoren) — Web-admin/Workspace sine kontakt-/booking-/tilbod-/oppgåve-/kunngjerings-/notat-/mediebank-lysbilete-detaljruter, hub-modalen.
- Web-admin sin brukartabell (`.vwu-table`) mangla sin eigen horisontal-scroll-wrapper — drog heile panelet sidelengs på smale skjermar i staden for berre tabellen. Lagt til `overflow-x:auto`-wrapper.

Touch-target-storleik og resten av UX-agenten sitt funn er ikkje del av denne runda (ville trengt visuell nettlesar-verifisering av faktiske knapp-mål, ikkje berre kodeendring).

## (dokumentasjon, ingen versjonsbump) — 2026-07-19

### B-6/B-7-utkast korrigert etter ekstern Codex-gjennomgang

Codex sin gjennomgang av 2026-07-18-utkasta fann fleire stader der dei overvurderte kva GDPR-sletteflyten faktisk garanterer, og undervurderte kva data Resend/`leads`-tabellen faktisk lagrar. Alle funn stadfesta direkte mot koden før retting (ikkje berre teke Codex sitt ord for det):

- **`draft-inbound-email-legal-basis-memo.md`**: retta "single/komplett sletteflyt"-overdrivinga (leads/bookingar/CRM-kommunikasjonar/chat/Storage-vedlegg er framleis fire-and-forget, berre kunde-rada og `inbound_emails` er feilsjekka); lagt til at `leads.message` lagrar FULL utrimma tekst (ulikt `crm_comms` sin 5000-teikn-avkorting); retta at `rejected_invalid_sig` aldri faktisk vert skriven (401 skjer FØR databaseskriving); retta "ingen match → ny profil" til den faktiske finn-eller-gjenbruk-logikken; presisert dei tre ulike tydingane av "verifisert" (kundeliste-filter / einskild-post-merke / faktisk identitetskontroll — ingen av dei er det siste); utvida spørsmåla til juridisk rådgjevar til å dekkje naudsyn/proporsjonalitet, informasjonsplikt til tredjepersonar, DPIA, og Resend sitt eige overføringsgrunnlag (SCC vs. DPF, ikkje anteke).
- **`customer-go-live-checklist.md`**: same rettingar reflektert i sjekklista; lagt til eit nytt, obligatorisk punkt om at `features.crm.crmFull` IKKJE faktisk slår av inbound e-post-mottak (reint ei UI-innstilling for utgåande sending) — den einaste reelle "av"-brytaren er om Resend sitt mottaksdomene/webhook faktisk er sett opp; presisert at CRM-dokument-tilgang er bucket-vid, ikkje avgrensa til "berre det som er festa".
- **`draft-privacy-policy-thirdparty-section.md`**: Resend-avsnittet utvida til å nemne full e-posttekst/HTML/headera/mottakaradresser/vedlegg og Resend sin eigen separate lagringsperiode; overføringsgrunnlaget presisert som "må stadfestast" (SCC eller DPF) i staden for anteke SCC.

Neste steg: attende til brukar sin eigen siste kvalitetssjekk.

## (dokumentasjon, ingen versjonsbump) — 2026-07-18

### B-6/B-7-utkast: DPA-/go-live-sjekkliste oppdatert + ny rettsgrunnlags-memo for innkomande e-post

Fyrste Claude-utkast (per avtalt rekkjefølgje: Claude → ekstern Codex-gjennomgang → brukar sin siste kvalitetssjekk), no som "den store gjennomgangen" (0.51.0) er gjennomført. Reint dokumentasjonsarbeid — ingen kodeendring, difor ingen versjonsbump.

- `docs/compliance/customer-go-live-checklist.md`: nye seksjonar for innkomande e-post (inkl. peikar til den nye rettsgrunnlags-memoen) og CRM-dokument-vedlegg (den nye private bucket-en frå 0.50.0); fjerna forelda Tidio-referansar (stadfesta aldri bygd), lagt til Resend (var alt i bruk, men mangla frå lista).
- `docs/compliance/draft-privacy-policy-thirdparty-section.md`: Resend-avsnittet utvida til å nemne innkomande e-post, ikkje berre utgåande.
- **Ny fil** `docs/compliance/draft-inbound-email-legal-basis-memo.md`: samlar fakta + alt bygde mitigeringar (uverifisert-merking, bulk-slett, GDPR-konsolidering) + attverande opne spørsmål (rettsgrunnlag, inbound_emails-retensjon) for den ULØYSTE juridiske avklaringa frå 2026-07-17-gjennomgangen. Løyser IKKJE spørsmålet — førebur det for ekte juridisk rådgjeving.

## 0.51.0 — 2026-07-18

### Full kodebase-gjennomgang (Claude 4 agentar + ekstern Codex) — 4 batchar fiksa og deploya

Etter at `/code-review ultra` synte seg vere diff-basert (ingen diff mot rein `main`), vart den "store gjennomgangen" i staden køyrd som fire parallelle Claude-bakgrunnsagentar (sikkerheit/QA/UX/personvern) pluss ein tilsvarande prompt til ein ekstern Codex-økt. Begge sett funn vart reconsiliert (sjå plan-fila for full detalj) — Codex fann sjølvstendig fleire reelle hol Claude sin eigen tryggingsagent hadde missa i same filer (DMARC-alignment, footer-XSS), som stadfestar verdien av to uavhengige gjennomgangar.

**Batch 1 (tryggleik, deploya)**: (1) `reference_number` rendra RÅTT i Henvendelser-/Booking-listene — ein uinnlogga aktør kunne planta eit skript som køyrde i ein innlogga admin sin nettlesar (CRITICAL). (2) `footer.copyright` rendra RÅTT, redigerbart av rolla "editor", synleg for ALLE besøkjande (Codex-funn, HIGH). (3) DMARC-alignment vart aldri sjekka i inbound-e-post-verifiseringa — SPF+DKIM kunne begge vere ekte "pass" for eit anna domene enn den synlege avsendaren (Codex-funn, HIGH). Edge Function `inbound-email` deploya på nytt.

**Batch 2 (tryggleik, kontrollplan)**: tenant-hostname-endring synkroniserte aldri Auth sin `site_url`/allow-list — nye invitasjons-/support-lenker kunne falle stille tilbake til eit forelda domene (Codex-funn, HIGH; Arkitekt-konsultert før fiks). Edge Function `tenant-admin` deploya til supabase-control. Media-bucket-kvote/rate-limit (Codex sitt andre HIGH-funn) er MEDVITE IKKJE løyst denne runda — treng eiga, djupare arkitekt-designrunde, spora som eige oppfølgingspunkt.

**Batch 3 (GDPR/datatryggleik)**: den einaste boksen merka "GDPR §17" var det MINST komplette av to sletteflytar (matcha berre primær-e-post, fria aldri Storage-vedlegg/inbound_emails, rapporterte suksess synkront utan feilsjekk) — konsolidert til éin komplett funksjon (`CrmAdmin.deleteEverythingForEmail`). Tilbod-vedlegg vart aldri fria ved sletting. Avbrote dokumentbytte i CRM sletta permanent den eksisterande fila sjølv ved Avbryt.

**Batch 4 (kundevendte tillits-/logikkbuggar)**: Kontakt-/booking-/tilbodsskjema synte suksess og tømde seg sjølv om innsendinga faktisk feila. Bookingkalenderen synte ALLE tider som ledige for besøkjande (anon har aldri hatt SELECT på bookings) — ny PII-fri `get_taken_booking_slots()`-RPC. Bookingkalenderen fekk tastaturtilgang (var reine klikk-berre `<div>`-ar). Offline-chat-skjemaet slutta å skape ein fantomsamtale + duplikat-lead for kvar melding. Eitt femte funn ("uverifisert"-status ved tilsett-svar) vart eksplisitt stadfesta av brukar som RETT åtferd, ikkje ein bug — urørt.

Batch 5 (breiare fire-and-forget-sveip) og Batch 6 (UX/tilgjenge, inkl. Console-responsivitet) er medvite utsett til ei seinare runde.

## 0.50.0 — 2026-07-18

### C-8 sitt private CRM-dokument-bucket verifisert end-to-end (ny `crm-documents`-smoketest)

Etter at 0.49.0 sin `pg-safeupdate`-BLOCKER synte at "migrasjonen køyrde reint" IKKJE er prov på at ein funksjon faktisk fungerer, vart same disiplin brukt på C-8: ny `crm-documents`-flyt i `.claude/skills/smoke-vibeverk/runner.js` som driv den EKTE UI-en heilt gjennom — opprettar ein kasteand-kunde, lastar opp ei ekte fil via "Dokument"-hurtighandlinga, stadfestar `crmdoc:`-prefikset (ikkje fall attende til gamal offentleg media-bucket), og klikkar den lagra vedleggs-chip-en i kunden sin tidslinje. **Stadfesta PASS live mot `vibeverk-staging`** — både backend/RLS (direkte `getCrmDocumentUrl()`-kall gir ein ekte signert URL med korrekt bucket/sti/token) og sjølve klikk-for-å-opne-vegen (etiketten løyser seg korrekt, aldri "Kunne ikkje opne").

Undervegs vart eit Playwright/Chromium-eigenskap avdekt og dokumentert (IKKJE ein app-bug): ein `window.open("","_blank")`-popup som seinare vert omdirigert via `win.location.href` til ein ekte `application/pdf`-signert-URL, vert handsama av Chromium sin innebygde PDF-visar på ein måte som gjer at Playwright sin `popup.url()` aldri viser den faktiske URL-en (står verande "about:blank" sjølv om omdirigeringa faktisk skjedde) — stadfesta ved at eit direkte `getCrmDocumentUrl()`-kall returnerte ein heilt gyldig, token'a URL medan `popup.url()` stod fast i 15+ sekund. Løyst ved å verifisere suksess via etiketten sin eigen tilstand i staden for popup-en sin URL.

## 0.49.0 — 2026-07-18

### CRM-dokument: privat Storage-bucket (C-8) + backup-restore-smoketest (C-9), og ein reell BLOCKER funne+fiksa i restore_backup_tables()

Del av launch-readiness-kartlegginga (sjå ROADMAP.md) — arbeid mot "kva må på plass før første ekte kunde".

- **C-8**: Nytt `App.crmDocs`-objekt i `core.js`, separat frå `Media` (privat `crm-documents`-Storage-bucket, 20MB-tak, MIME-allowlist, signerte URL-ar med 5 min utløp). RLS: INSERT/DELETE krev `can_edit_content()` (admin/editor), SELECT ope for alle autentiserte roller inkl. member (stadfesta brukarval — member skal kunne opne/sjå dokument, sjølv om dei ikkje kan laste opp). Eksisterande dokument i den gamle offentlege `media`-bucket-en vert medvite verande liggande som legacy — berre nye opplastingar går gjennom `crm-documents`. `module-crm.js` sine vedleggs-chips/dokumentdialog oppdaterte til å bruke `CrmDocs` for nye opplastingar. Arkitekt-konsultert, Security- og UX-gjennomgått, alle HIGH-funn retta (m.a. `window.open("", "_blank")` synkront i klikk-handteraren for å unngå iOS Safari sin popup-blokkerar). Migrasjon `20260718113648_crm_documents_bucket.sql` — no køyrd mot `vibeverk-staging`, IKKJE enno mot produksjon.
- **C-9**: Ny `backup-restore`-Playwright-smoketest-flyt i `.claude/skills/smoke-vibeverk/runner.js` (QA-designa testdekning). Ny `loginWebAdmin()`-hjelpar, gjort idempotent saman med `loginWorkspaceAdmin()` (begge deler éi Supabase Auth-økt — eit fyrste feil forsøk synte at eit andre, ubetinga innloggingskall timar ut når skjemaet aldri dukkar opp fordi økta alt er gyldig).
- **REELL BLOCKER funne og fiksa** (fyrste nokosinne live-køyring av `restore_backup_tables()`, verken i staging eller produksjon tidlegare): funksjonen sine ni `DELETE FROM <tabell>;`-setningar manglar WHERE-klausul, og vart avviste av Supabase sin `pg-safeupdate`-utviding (lasta via `session_preload_libraries` for PostgREST/RPC-rolla — gjeld óg INNI ein `SECURITY DEFINER`-funksjon kalla via RPC, ikkje berre direkte klient-spørjingar). Sikkerhetskopi-gjenoppretting via den ekte "Sikkerhetskopi"-fana har truleg ALDRI fungert sidan funksjonen vart laga 2026-07-13. Fiksa i `20260718175406_fix_restore_backup_tables_safeupdate.sql` (legg til `WHERE true` på alle ni — funksjonelt identisk, tilfredsstiller berre utvidinga sitt syntaktiske krav). Køyrd mot `vibeverk-staging`, `backup-restore`-testen PASSERTE deretter fullstendig live (eksport, FK-forfattar-nullstilling, OG sjølve transaksjons-rollback-regresjonstesten for 2026-07-06-BLOCKER-en). **IKKJE enno køyrd mot produksjon** — same fiks bør prioriterast dit snart, sidan funksjonen sannsynlegvis er like broten der.

## 0.48.0 — 2026-07-18

### Design-modulen: Mal 3 — "Scroll-story" (scrollytelling)

Tredje designmal i det veksande mal-galleriet (etter Klassisk og Panorama). Brukar ønska å "meistre ein mal" til med eit scrollytelling-uttrykk: heile sida les som ein sekvens av store, biletdominerte "augeblikk" som opnar seg progressivt idet kunden scrollar.

- Ny fil `template-scrollstory.js` — same isolasjonsmønster som Klassisk/Panorama (eigen fil, `.story-*`-prefiksa CSS, registrerer `window.SiteTemplates.scrollstory`). MEDVITE ingen scroll-jacking/pinning — bygd i staden på den EKSISTERANDE `.reveal`/IntersectionObserver-mekanismen (respekterer alt `prefers-reduced-motion`), der kvart "augeblikk" (hero, about, KVART tenestekort) får si eiga `.reveal`-klasse sidan `bindScrollReveal()` observerer alle `.reveal`-element flatt, ikkje éin per seksjon.
- **Forsidetopp**: sentrert (ikkje botnforankra som Panorama) tittel/undertittel/CTA over eit fullbreidde 100vh-bilete, med ein liten animert "scroll for å utforske"-indikator (respekterer reduced motion, skjult på korte/liggande mobilskjermar).
- **Om oss / Tenester**: fullbreidde biletbakgrunn med sentrert tekst overlagt, i staden for Panorama sin bilete-så-tekst-under-kvarandre-oppbygging — dette er hovudskiljet frå Panorama. Kvart tenestekort vert sitt eige nær-full-viewport "augeblikk" i sekvens i staden for eit rutenett; fungerer best med eit moderat tal kort (om lag 3–6).
- **Isolasjonstest-runde** (eksplisitt bede om av brukar no som det finst tre malar): sykla gjennom Klassisk → Panorama → Scroll-story → Klassisk, både via friske sideinnlastingar og via byte i admin utan omlasting (det realistiske "kunde lagrar nytt malval"-forløpet) — stadfesta null CSS-/klasse-lekkasje mellom malane i begge scenario.
- Éin reell bug funne under eiga live-testing (ikkje av reviewaren): Forsidetoppen sin fallback utan bilete arva `color:#fff` frå bilete-varianten, som gjorde tittelen usynleg mot ein lys standardbakgrunn — retta med ein eigen `.story-hero--noimg`-variant (same prinsipp som Panorama og Klassisk sine eigne biletlause fallback-ar).

**UX/Mobile Reviewer-pass** (påkravd, genuint ny markup/struktur): ingen blokkerande funn. Tre HIGH-funn retta før merge — Om oss/tenestekort brukte rå CSS-`background-image` (kopiert frå Forsidetoppen sin teknikk) i staden for delte `C.coverImg()`, som gjorde at dei mista BÅDE alt-tekst OG lazy-loading som Klassisk/Panorama sine tilsvarande bilete alt har — omskrive til å bruke `C.coverImg()` inni ein absolutt-posisjonert bakgrunnsboks (behelder den visuelle "bilete bak sentrert tekst"-kjensla, men no som eit ekte `&lt;img alt loading="lazy"&gt;`); det flate mørkleggingslaget (.45–.48 opasitet) var svakare enn kontrastnivået Panorama sin eigen gjennomgang kravde for tekst i normal storleik — styrka til .55–.58 i alle tre seksjonstypar. Forsidetoppen sjølv held fram med rå `background-image` (same konvensjon som Klassisk/Panorama, og lazy-loading ville skada LCP på det fyrste, alltid synlege biletet) — fekk i staden ein `aria-label` bygd frå biletet sin alt-tekst. Éin MEDIUM-funn retta: `min-height:100vh` åleine er utsett for iOS Safari sin dynamiske adresselinje-feil på stabla fullskjerm-seksjonar — lagt til `100svh` som progressiv forbetring (fell trygt tilbake til `100vh` i eldre nettlesarar).

Testa: `node test.js` (535/536, kjend feil uendra), `node test-workspace.js` (162/163, kjend feil uendra). Live nettlesar-stadfesta (alt-tekst/lazy-loading/objekt-tilpassing stadfesta med ekte testbilete, isolasjonstest-runde over). Cache-bust: `core.js?v=62`, ny `template-scrollstory.js?v=1` i alle fire HTML-inngangar. `VIBEVERK_VERSION` 0.47.0 → 0.48.0.

## 0.47.0 — 2026-07-18

### Design-fana delt i 5 underfaner + Tagline/SEO kundevendt + visuell opprydding

Brukar såg det live panelet frå v0.46.0 og gav konkret tilbakemelding (skjermbilete av "Fargar") pluss eit spørsmål om kor mykje av "Firma"/SEO-felta kunden sjølv bør styre.

- **Design-fana delt i 5 underfaner** (Mal | Firma | SEO | Fargar | Fontar), etter brukar sitt forslag om at panelet vart for tett — same underfane-mønster som "Innhold"-kategorien alt bruker (Innhold/Tjenester/Aktuelt). `buildAdminTabs()` fekk 5 nye tab-oppføringar (alle `category:"design"`) i staden for éin; den gamle, eine `adminDesign()`-funksjonen er delt i `adminDesignMal()`/`adminDesignFirma()`/`adminDesignSeo()`/`adminDesignFargar()`/`adminDesignFontar()`, kvar med sitt eige skjema og «Lagre»-steg (skriv berre til sin eigen del av `superconfig`/`content`, ingen krasj mellom faner). "Nullstill"-knappen er delt i to, scoped til kvar sin fane (fargar/fontar).
- **Tagline vert kundevendt redigerbar** (ny "Firma"-fane), etter diskusjon om kva av "Firma"/SEO-felta kunden bør styre sjølv. **Firmanavn held fram Console-only**, medvite — brukar sin eigen vurdering: kan endre kundeidentiteten, ikkje noko som skal vere eit enkelt sjølvbeteningsval.
- **Heile "SEO og deling"-seksjonen vert kundevendt redigerbar** (ny "SEO"-fane): meta-beskrivelse, delingsbilde (OG-bilde), favicon — porta frå Console sitt identiske panel, reine URL/tekstfelt (ingen opplasting-UI denne runden, stadfesta med brukar — vurderast seinare berre om ein kunde faktisk etterspør det).
- **Visuell opprydding i "Fargar"**, etter brukar sitt skjermbilete-baserte innspel: meir luft rundt "🎨 Generer fargepalett" (delelinje + auka avstand før fargeboksane), fargeboksane redesigna til større (56×56px), kort-baserte rader (heile raden klikkbar, ikkje berre sjølve fargefeltet), og "Hjørne-radius" bytt frå ein plain nettlesar-`<select>` til ein visuell kort-veljar som VISER den faktiske avrundinga (og pill-vs-firkanta-knappåtferda) for kvart alternativ i staden for berre tekst.

**UX/Mobile Reviewer-pass** (meiningsfull visuell endring + ny fane-struktur): ingen blokkerande funn. Tre MEDIUM-funn retta: fargeboks-korta hadde ingen `max-width` og strekte seg ubehageleg breitt ut på desktop/fullskjerm (sett `max-width:420px`); SEO-fana sitt delingsbilde-felt hadde ingen biletførehandsvising (i motsetnad til Logo-feltet rett ved sida av, same mønster) — lagt til; "Nullstill"-knappane sa ikkje at berre skjemaet vert nullstilt, ikkje sjølve lagringa — lagt til ei kort hint-linje ved begge. Nokre polish-funn (5-fane-raden sin bretjepunkt ved 375px, korta sin `:focus-within`-stil) vurdert som ikkje-blokkerande, ikkje fiksa denne runden.

Testa: `node test.js` (535/536, kjend feil uendra), `node test-workspace.js` (162/163, kjend feil uendra). Live nettlesar-stadfesta (alle 5 faner, Tagline/meta-beskrivelse lagrar og oppdaterer `document.title`/`<meta name="description">` live via `applyTheme()`→`applyMeta()`, nullstill-knappane går korrekt til denne kunden sin eigen `config.js`). Cache-bust: `core.js?v=61`, `console-core.js?v=143`. `VIBEVERK_VERSION` 0.46.0 → 0.47.0.

## 0.46.0 — 2026-07-18

### Design-modulen: farge/font på full djupne + sjølvbetent logo-opplasting

Oppfølging av tre av dei fire utvidingsønska brukar bad om å logge etter Panorama-malen (v0.45.0). Det fjerde ("kva anna bør kunden få gjere?") står framleis ope, ikkje spekulert vidare her.

- **Farge/font på same djupne som Console sitt "Web"-panel**: `adminDesign()` (core.js) fekk WCAG-kontrastvalidator (live tekst/bakgrunn- og primærfarge/bakgrunn-forhold, kvar med ein "Generer forslag"-knapp som justerer nett den fargen til AA-terskelen), ein "🎨 Generer fargepalett"-knapp (set saman eit heilt tema som garantert oppfyller AA), det same kuraterte 11-par skriftutvalet som Console (med live Google Fonts-førehandsvising), og ein "↺ Nullstill fargar og fontar til standard"-knapp (går tilbake til denne kunden sin EIGEN `config.js`, ikkje eit generisk standardsett). All matte er PORTA ordrett frå `console-core.js` (same grunngjeving som Console sin eigen kommentar om fontførehandsvisinga si duplisering: dei to filene deler aldri JS-kontekst).
- **Google Fonts-rettleiing**: ny hint-tekst med lenke til fonts.google.com og instruks om at fritekst-fontnamnet må stemme nøyaktig med namnet der.
- **Sjølvbetent logo-opplasting**: ny `Media.putLogo()` (core.js) — klientside nedskalering (maks 800px) + PNG/JPEG/WebP-berre (MEDVITE ingen SVG, sjå under), lastar rett opp mot KUNDEN sitt eige, alt autentiserte Supabase Storage-prosjekt. Skil seg frå Console sin `upload_logo`-broker (som har ei server-side SVG-saneringsallowlist via kontrollplanet) ved at denne stien ALDRI tillet SVG i det heile — trygg SVG-sanering krev ein server-funksjon, og denne koden har ingen. Krev òg ei ekte Supabase-tilkopling (ingen `localStorage`-fallback som `Media.put()` elles har), sidan `company.logoUrl` vert brukt direkte som `<img src>` i sidehovudet utan noko `Media.resolve()`-steg — ein lokal `media:`-referanse der ville vist eit knust bilete.
- **Tryggingsgjennomgang** (fil-opplasting/lagring, per CLAUDE.md sin standardregel): eitt reelt MEDIUM-funn retta før merge — `Media.putLogo()` hadde ingen pikseldimensjons-sikringsnett, same feilklasse som vart funnen og fiksa éin gong før i Console sin `upload_logo`-broker (CHANGELOG 0.39.0): ei lita, sterkt komprimerbar fil (t.d. ein 30000×30000 low-entropy PNG) kunne passere 6MB-grensa, men tvinge nettlesarfana til å handtere fleire hundre megapiksel. Retta med eit `MAX_PIXELS`-sjekk (40 megapiksel) rett etter bilete-dekoding, FØR canvas/re-koding startar. Eitt LOW-funn (SVG-utelating på `putLogo()`-nivå gjev ikkje full containment sidan sjølve `media`-bucket-en sin eigen allowlist framleis tillet `image/svg+xml` for alle admin/editor-økter uavhengig av denne funksjonen) er ein pre-eksisterande tilstand (deler same eksponering som `Media.put()`/`Media.putFile()` alt hadde), ikkje noko denne endringa innfører — logga, ikkje fiksa i denne runden.
- **UX/Mobile Reviewer-pass** (meiningsfull UI-utviding av eksisterande fane): to HIGH-funn retta — WCAG-sjargong ("WCAG AA-krav på 4.5:1") var kopiert ordrett frå Console (eit internt operatørverktøy) inn i ei kundevendt sjølvbeteningsflate utan omsetjing til klarspråk, i strid med `copy-style-guide.md`; omskrive til vanleg språk ("Teksten kan vere vanskeleg å lese mot bakgrunnen") med kontrasttalet framleis synleg som detalj. "Generer forslag"-knappane sin trykkflate var under 44px-minimumet; auka til `.btn--sm`-storleik. Fire MEDIUM-funn retta: `colorRow()` sine `<label>`-element mangla `for`-attributt (skjermlesar-kopling); dei fem fargeveljarane mangla forklarande hint-tekst (Console sitt panel HAR dette, Web-admin-porteringa hadde mista det) — lagt til att; logo-opplasting hadde ingen visuell stadfesting av det faktiske biletet — ny miniatyrbilete-førehandsvising lagt til (oppdaterer både ved opplasting og ved manuell URL-inntasting); dei 11 skriftpar-knappane var under 44px på mobil — auka polstring (berre i `index.html`/`admin/index.html`, ikkje i Console sin eigen desktop-only kopi av same CSS-klasse).

Testa: `node test.js` (535/536, kjend feil uendra), `node test-workspace.js` (162/163, kjend feil uendra). Live nettlesar-stadfesta (kontrastvalidator, fargepalett-generator, skriftpar-val, logo-opplasting + miniatyrbilete-førehandsvising, nullstill-knapp) — same mellombels-blanke-Supabase-lokalt-teknikk som Panorama-verifiseringa. Cache-bust: `core.js?v=60`, `console-core.js?v=142`. `VIBEVERK_VERSION` 0.45.0 → 0.46.0.

## 0.45.0 — 2026-07-18

### Design-modulen: Fase 1 — "Panorama", den fyrste faktisk nye malen

Andre mal i det veksande mal-galleriet (etter "Klassisk" = Fase 0-nullstillingspunktet). Motsett av dagens statiske, tekst-ved-sida-av-bilete-oppsett: store, dominerande bilete er sjølve hovudelementet, minimal tekst.

- Ny fil `template-panorama.js` — sjølvstendig IIFE, registrerer `window.SiteTemplates.panorama` (same register-mønster som `template-klassisk.js`, ingen endring i eksisterande malar). Eiga, isolert `.pano-*`-prefiksa CSS injisert via ein `<style>`-tag i `document.head`, ingen kollisjon med Klassisk sine `.hero`/`.about__media`/`.card`-klassar.
  - **Forsidetopp**: fullbreidde bakgrunnsbilete (`min-height:100vh`), botnforankra tittel/undertittel/CTA, mørk gradient-overlegg for lesbar tekst uansett biletinnhald.
  - **Om oss**: stort, breitt bilete (21:9) etterfølgt av sentrert, smalare tekstblokk.
  - **Tenester**: rutenett av biletkort (4:5-format) med botn-overlegg-tittel; kort utan bilete fell trygt tilbake til eit avgrensa kort med ikon+tekst i staden for å bryte rutenettet.
  - Stabile anker-id-ar (`hjem`/`om-oss`/`tjenester`) og delt `sanitizeRichHtml()` er begge følgde, per Arkitekten sine faste reglar for nye mal-forfattarar.
- `adminDesign()` sin `templates`-liste (core.js) utvida med Panorama-oppføringa.
- Live nettlesar-stadfesta (lokal statisk server, `config.js` sin Supabase-tilkopling mellombels blanka lokalt for å unngå at `hydrateFromSupabase()` overskreiv test-verdien frå den ekte produksjonsdatabasen — reversert att før commit, ingen reell kode-feil): hero/om-oss/tenester viser alle korrekte `.pano-*`-klassar, biletlaus korttilbakefall fungerer, sanering stadfesta (bevarer trygge taggar som `<b>`).
- UX/Mobile Reviewer-gjennomgang av den nye malen (påkravd for Fase 1 per planen, ikkje Fase 0). Ingen blokkerande funn. Tre HIGH-funn retta før merge: (1) biletkredittbadgen låg inni den smale `.pano-hero__inner`-kolonnen og ville flyte laust midt på sida på skjermar breiare enn ~900px i staden for å ankre til biletkanten — flytta til å vere syskenelement direkte i `.pano-hero`, same mønster som Klassisk; (2) mørkleggingsgradienten i Forsidetopp hadde ingen sikkerheitsmargin mot lyse/kvite bilete — styrka botn-opasiteten og utvida overgangen; (3) Om-oss-biletet sitt 21:9-format hadde ingen mobiloverstyring, noko som ville gjeve eit svært tynt utsnitt på smale skjermar — lagt til ei 4:3-overstyring under 700px. Éin MEDIUM-funn (biletkort-rutenett sin sidemarg matcha ikkje `.container` sin) retta i same runde. Resterande MEDIUM/polish-funn (fast botn-gradient på korttittel-overlegget kan under-mørkleggje ved lange, brytande titlar; bilete-/ikkje-bilete-kort er visuelt ulike språk i same rutenett) vurdert som akseptable for denne runden, ikkje blokkerande.

Testa: `node test.js` (535/536, kjend feil uendra), `node test-workspace.js` (162/163, kjend feil uendra) — begge testfilene sine skriptlaste-lister utvida med `template-panorama.js`. Cache-bust: `core.js?v=59`, `console-core.js?v=141`, ny `template-panorama.js?v=1` i alle fire HTML-inngangar. `VIBEVERK_VERSION` 0.44.2 → 0.45.0.

## 0.44.2 — 2026-07-18

### Design-modulen: åtvaringsbanner i Console når kunden kan redigere farge/font sjølv

Oppfølging av spørsmålet om Web-admin sin nye farge/font-editor og Console sitt "Web"-tema-panel faktisk er synkroniserte. Stadfesta: dei skriv til DEN SAME `superconfig`-nøkkelen, men Console sin `saveSC()` sender heile det gjeldande superconfig-objektet frå operatøren sitt eige, potensielt eldre nettlesarminne — ikkje ein fersk refetch rett før lagring. Lagrar operatøren i Console etter at kunden alt har endra farge/font sjølv i Web-admin, vinn operatøren sin eldre kopi (full overskriving, ikkje ein felt-for-felt-flettling).

Brukar vurderte den faktiske kollisjonsrisikoen (operatør og kunde redigerer samstundes) som lita i praksis, og valde ei enkel åtvaring i staden for å byggje om alle seks lagre-handterarane i Console til å refetche ferskt før kvar lagring:

- Ny åtvaringsbanner øvst i `renderWeb()` (Console sitt "Web"-tema-panel), synleg berre når den valde kunden har `features.sidebygger` aktivert: «Denne kunden har Design-modulen aktivert. Kunden kan sjølv endre farge/font direkte i Web-admin. Ver varsam med å lagre endringar her…»

Testa: `node test.js` (535/536, kjend feil uendra), `node test-workspace.js` (162/163, kjend feil uendra) — Console har ingen eigen automatisk testdekning frå før. `VIBEVERK_VERSION` 0.44.1 → 0.44.2, `console-core.js?v=140`.

## 0.44.1 — 2026-07-18

### Design-modulen: Console-toggle + grunnleggjande farge/font i Web-admin

Brukar peika på to reelle hol rett etter at Fase 0 vart merga: (1) `sidebygger`-flagget hadde ingen faktisk Console-UI for å skru det på/av, (2) farge/font (planen sitt "Tier 1", diskutert tidlegare same dag) vart aldri lagt inn i sjølve Design-fana, berre malveljaren.

- **Console** (`console-core.js`): `sidebygger` lagt til i `FEAT_LABELS`/`FEAT_HELP` (vises som "Design" i "Modular"-fana sin funksjonssjekkliste, same stad som `crmFull`/`chat`/osv.) — no faktisk av/på-styrbart per kunde.
- **Web-admin sin `adminDesign()`**: utvida med eit grunnleggjande farge- og font-panel (5 fargeveljarar, hjørne-radius, display-/brødtekst-font), i tillegg til mal-veljaren. Skriv til DEN SAME `superconfig`-Store-nøkkelen Console sitt "Web"-tema-panel alt bruker (`applySuperConfig()`/`applyTheme()` les nøkkelen likt uansett kven som skreiv) — ingen ny synk-mekanisme, berre ein ny, enklare skrivar. Medvite utan WCAG-kontrastvalidator/palett-generator/logo-opplasting enno (Console sitt fulle panel har framleis desse) — dekker berre dei grunnleggjande vala brukar bad om.

Testa: `node test.js` (535/536, kjend feil uendra), `node test-workspace.js` (162/163, kjend feil uendra). Cache-bust: `core.js?v=58`, `console-core.js?v=139`. `VIBEVERK_VERSION` 0.44.0 → 0.44.1.

## 0.44.0 — 2026-07-18

### Design-modul ("sidebygger") — Fase 0: infrastruktur + "Klassisk"-mal portert inn

Fyrste implementasjon av eit nytt, betalt tillegg: ein "Design"-fane i Web-admin (heilt fyrst i fanerekkjefølgja: Design | Innhold | Henvendelser | Innstillinger | Min konto) der kunden framover skal kunne velje mellom fleire heile designmalar for nettsida — ikkje per-seksjon-val, ikkje eit fritt drag-and-drop-verktøy. Sjå `docs/roadmap/ROADMAP.md` for full bakgrunn (konsoliderer tre tidlegare, spreidde roadmap-punkt) og planfila for detaljert teknisk grunngjeving (to Arkitekt-konsultasjonar).

- **Ny fil `template-klassisk.js`**: dagens eksisterande `hero()`/`about()`/`services()`-implementasjon, ordrett flytta hit frå `components.js` (reint flyttesteg, ingen visuell endring). Registrerer seg i eit nytt `window.SiteTemplates`-register.
- **`components.js`** sine `hero()`/`about()`/`services()` er no tynne, uendra vidaresendarar til `window.SiteTemplates.klassisk` — held funksjonane "pure" (ingen kobling til `content`/kva mal som er aktiv for ein gjeven kunde, per CLAUDE.md sitt prinsipp for denne fila).
- **`core.js`**: ny `activeTemplate()`/`resolveTemplate()`-logikk (les `content.designTemplate`, defaultar til `"klassisk"`), `registerBuiltinSections()` kallar no det oppløyste malobjektet direkte. Ny `adminDesign()`-fane (viser berre "Klassisk" enno). `ADMIN_CATEGORIES`/`allowedCategoriesForRole()`/`buildAdminTabs()`/`renderAdminTab()` utvida for den nye "design"-kategorien, gata bak `feat("sidebygger")` (Console-only entitlement, same mønster som `crmFull` — kunden kan IKKJE skru dette på sjølv).
- **`config.js`**: nytt `features.sidebygger: false`-felt (MÅ vere eksplisitt `false` som standard, sidan `feat()` sitt "sant med mindre eksplisitt false"-mønster elles ville vist fana for alle).
- **Reell bug funne og retta undervegs**: `loadContent()` bygger `content`-objektet frå eit fast sett namngjevne felt kvar gong sida lastar — eit nytt `content.designTemplate`-felt sett via admin-lagring ville stille forsvunne att ved neste sideinnlasting utan ein eksplisitt `designTemplate: overrides.designTemplate || "klassisk"`-linje, som no er lagt til.
- **Testinfrastruktur**: `test.js`/`test-workspace.js` sine skriptlaste-lister mangla `template-klassisk.js` — utan det braut heile forsidesida sin rendering i testmiljøet (hero/about/services returnerte tom streng, sidan komponent-forwarderane ikkje fann noko mal å vidaresende til). Retta i alle tre stadene testfilene laster skript.

**Visuelt stadfesta** via lokal statisk server + ekte nettlesar (DOM-inspeksjon av `#om-oss`/`#tjenester`-innhald direkte, ikkje berre skjermbilete — desse seksjonane har ein `.reveal`-scroll-animasjon som kan gjere eit programmatisk-scrolla skjermbilete misvisande tomt sjølv om innhaldet faktisk ligg der).

**Ikkje bygd i denne fasen**: sjølve "mal 2" (den fyrste faktisk NYE malen) — eige, seinare steg. `features.sidebygger` står som `false` for alle, inkludert Vibeverk sin eigen produksjon — ingen synleg endring for nokon kunde før dette flagget eksplisitt vert skrudd på.

Testa: `node test.js` (534/535, kjend feil uendra), `node test-workspace.js` (162/163, kjend feil uendra). `VIBEVERK_VERSION` 0.43.5 → 0.44.0 (ny funksjonalitet, MINOR). Cache-bust: `components.js?v=17`, `core.js?v=57`, `template-klassisk.js?v=1` (ny), `console-core.js?v=138`.

## 0.43.5 — 2026-07-18

### Reverterte 0.43.4 sin sentrerte skjema-CSS — kaskaderande innsnevringsbug

Brukar live-testa 0.43.4 same dag og fann ein reell visuell bug: `max-width:760px;margin:auto` på `.admin-form`/`.admin-group` gav IKKJE ei fin, sentrert side — kvar `<fieldset class="admin-group">` (Tjenester-seksjon, Aktuelt-seksjon, Kontaktinfo, Sosiale medier, Footer, alle SIBLINGS i det ekte markupet, stadfesta ved lesing av `adminContent()` i core.js) synte seg gradvis SMALARE og meir innrykt enn den førre — det stikk motsette av kva som var tilsikta. Eit isolert reproduksjonsforsøk synte IKKJE denne kaskaderande åtferda (alle tre testfelta vart likt sentrerte), så den eksakte rendringsmekanismen i det ekte, brede vindauget er ikkje fullt forklart — men brukar sitt ønske var uansett klart og vart følgt direkte: **reverter til venstrestilt, full breidde som standard** (identisk med korleis "Henvendelser" alt fungerer), IKKJE tving inn ei fast sentrert breidde-avgrensing.

- Fjerna `.modal.is-fullscreen .admin-form/.admin-group/.bk-wrap { max-width:760px; margin:auto }` heilt frå både `index.html` og `admin/index.html`.
- Ei eventuell smalare/dynamisk løysing for spesifikke enkeltsider (brukar nemnte "Brukarar" som mogleg eksempel) er eit medvite utsett, separat framtidig steg — IKKJE noko å byggje som ein generell CSS-klasse-regel utan grundigare vurdering, gitt at dette er andre gongen ei rask breidde-endring i fullskjerm-modus har gått feil.
- Stadfesta samstundes at resize-handtaket (0.43.4) FUNGERER godt og alt gjeld gjennomgåande for vanlege `<textarea>`-felt òg (`.field textarea` har hatt `resize:vertical` frå før) — berre dei rike tekstfelta (`.rtfield__editor`) mangla det, no retta.

Testa: `node test.js` (534/535, kjend feil uendra), `node test-workspace.js` (162/163, kjend feil uendra). `VIBEVERK_VERSION` 0.43.4 → 0.43.5.

## 0.43.4 — 2026-07-18

### Fullskjerm-adminpanel: sentrert skjemainnhald + rulle-handtak på rike tekstfelt

Brukar sitt eige live-testfunn av 0.43.3, same dag: skjema-forma innhald ("Innhold"-fana, modulane sine admin-skjema, "Sikkerhetskopi") strakk seg urimeleg breitt i fullskjerm sidan enkeltkolonne `width:100%`-felt ikkje hadde nokon breidde-avgrensing. Lister/kort ("Henvendelser") var alt fine, sidan dei ikkje har den same breiddereglen.

- **UX/Mobile Reviewer-gjennomgang gjennomført**, stadfesta brukar sin observasjon i kode: `.admin-form`/`.admin-group` (Innhold + alle modulane sine admin-skjema) og `.bk-wrap` (Sikkerhetskopi spesifikt, ikkje Analyse/Navigasjon som alt var greie) manglar ei breidde-avgrensing. Retta med `.modal.is-fullscreen .admin-form/.admin-group/.bk-wrap { max-width:760px; margin:auto }` i BÅDE `index.html` og `admin/index.html` (dei to filene som faktisk rendrar adminpanelet — Console/Workspace bruker det aldri).
- **Ny rulle-funksjon på rike tekstfelt** (`.rtfield__editor`): `resize:vertical; overflow:auto` lagt til i alle fire HTML-filer (fann og retta ein tredje pre-eksisterande drift: Workspace sin kopi hadde eigne fargar/storleikar, no også med resize). Brukaren kan no dra i eit standard nettlesar-handtak nede til høgre for å gjere tekstboksen høgare — særleg nyttig no som fullskjerm gjev meir plass. UX-gjennomgangen fann ingen konflikt med verktøylinja over eller teiknteljaren under.
- **Visuelt stadfesta** via ein isolert nettlesar-test (same metode som 0.43.3): skjemafelt sentrerer seg korrekt ved 760px i fullskjerm, medan ei simulert Henvendelser-liste framleis bruker full bredde uendra.

Testa: `node test.js` (534/535, kjend feil uendra), `node test-workspace.js` (162/163, kjend feil uendra). `VIBEVERK_VERSION` 0.43.3 → 0.43.4, `console-core.js?v=136`.

## 0.43.3 — 2026-07-18

### Fullskjerm-knapp faktisk synleg i adminpanelet (rettar misforståing frå 0.43.2)

Brukar peika ut at 0.43.2 berre bygde eit ubrukt `opts.fullscreen`-primitiv — ingen faktisk knapp synte seg nokon stad i det ekte adminpanelet. Retta: adminpanelet sin eigen `C.modal()`-basert modal (`renderAdminPanel()` i core.js, delt `modal()`-komponent i components.js) har no ein faktisk fullskjerm-knapp i `modal__head` (ved sida av lukk-knappen), synleg med det same admin loggar inn.

- `components.js` sin `modal()` godtek no `opts.fullscreenToggle`/`opts.isFullscreen` og rendrar knappen (Tabler-ikon `arrows-maximize`/`arrows-minimize`, byter ikon etter tilstand). `modal()` vert BERRE brukt av dei tre admin-relaterte modalane i core.js (innloggingsskjerma to av dei, hovudpanelet den tredje) — dei to innloggingsmodalane sender ikkje flagget, uendra åtferd for dei.
- `core.js` sin `renderAdminPanel()` held tilstanden i ein ny modul-variabel `adminFullscreen` (persistert via `Store` under `admin-panel-fullscreen`, same mønster som Workspace sin sidemeny-kollaps) — naudsynt sidan panelet re-rendrar heile `innerHTML`-en sin på nesten kvart faneskift.
- Ny CSS (`index.html` OG `admin/index.html` — fann og retta ein pre-eksisterande drift mellom dei to: `admin/index.html` sin kopi av `.modal__panel--admin`-CSS-en mangla flex-kolonne-fiksen `index.html` alt hadde): `.modal.is-fullscreen` fjernar den vanlege 1rem-paddinga, `.modal.is-fullscreen .modal__panel--admin` fyller heile viewporten kant til kant.
- **Faktisk visuelt stadfesta denne gongen** — ekte nettlesar-test via ein lokal statisk server (login-skjermaet krev ekte Supabase-legitimasjon som ikkje var tilgjengeleg lokalt, så testen brukte `components.js` sin ekte `modal()`-funksjon direkte, ikkje det fulle adminpanelet): knappen synest korrekt i headeren, klikk ekspanderer panelet kant-til-kant, ikonet byter til "minimer"-varianten, header held seg fast medan innhaldet skrollar.

Testa: `node test.js` (534/535, kjend feil uendra — talet 534 var alt gjeldande FØR denne endringa, stadfesta via `git stash`-samanlikning, ikkje ein ny regresjon), `node test-workspace.js` (162/163, kjend feil uendra). Cache-bust: `components.js?v=16`, `core.js?v=56`, `console-core.js?v=135`. `VIBEVERK_VERSION` 0.43.2 → 0.43.3.

## 0.43.2 — 2026-07-17

### Fullskjerm-variant for `openDialog()`/`openReplyModal()` (grunnlag for framtidig kundeadmin-design-verktøy)

Bygd som fyrste konkrete steg for ROADMAP.md sitt "Custom design-modul (kundeadmin-sida)"-punkt — brukar valde ein utvida fullskjerm-modal-variant framfor ein full SPA-refaktorering av Web-admin (vurdert som eit for stort, fleire-økter-arbeid for akkurat dette behovet).

- `module-crm.js` sin `openDialog()` og `core.js` sin `openReplyModal()` godtek no eit `opts.fullscreen`-flagg — reint additivt/opt-in, INGEN eksisterande kallar er endra til å bruke det enno. Fullskjerm-varianten bruker flex-kolonne-layout (header/footer faste, innhaldsområdet fyller/skrollar resten) i staden for ein hardkoda vh-verdi.
- **Ikkje visuelt verifisert enno** — ingen kallar bruker `fullscreen:true` enno, sidan sjølve design-verktøyet som skal konsumere dette ikkje er bygd/scopa enno. Bør UX-gjennomgåast når ein ekte forbrukar av flagget finst, ikkje no (inert kode inntil då).

Testa: `node test.js` (535/536), `node test-workspace.js` (162/163) — begge kjende, pre-eksisterande feil uendra (ingen eksisterande dialog-åtferd er endra). Cache-bust: `core.js?v=55`, `module-crm.js?v=27`, `console-core.js?v=134`. `VIBEVERK_VERSION` 0.43.1 → 0.43.2.

## 0.43.1 — 2026-07-17

### Oppfølging etter fyrste live-test av inbound e-post: verifiser-knapp, chat-kategorisering, duplikat-fiks

Brukar live-testa 0.43.0 (ekte testepost via Resend, produksjon) og fann tre ting å rette same runde:

- **«Ikkje verifisert»-badgen vart klikkbar**: opna verken tidlegare eit tydeleg «Vil du verifisere denne avsendaren?»-val — no ein knapp (`data-verify-comm` i `module-crm.js`) som viser ei Ja/Nei-stadfesting og set `data.autoCreated=false` på den spesifikke comm-en ved Ja. Merk: dette er PER MELDING, ikkje ei automatisk statusendring — badgen forsvinn ikkje berre av å svare/løyse ei henvending, sidan han skildrar KORLEIS akkurat den meldinga kom inn, ikkje ein live kunde-status.
- **Chat-element synte som «Kontakt» i tidslinja sitt filter**: ein lukka chat vert alt konvertert til ein «Kontakt»-lead (`saveConvAsLead()`), men `tlCategoryId()` kategoriserte etter rå `type`, ikkje opphav — retta til å sjekke `item.chatId` FØRST (både opne OG lukka/konverterte chatar hamnar no under «Chat»-filteret, ikkje blanda med ekte kontaktskjema-innsendingar). Filterknappane sine TELJINGAR brukte tidlegare ei duplisert, ukonsistent sjekk — retta til å bruke same `tlCategoryId()`.
- **Ekte, stadfesta duplikat-bug i produksjon**: ein chat lukka BÅDE av admin OG av den besøkjande sjølv (kunden sin eigen "lukk chatvindauge"-hending) kunne lage TO separate `leads`-rader for SAME `chat_id`. Rotårsak: den besøkjande sin klientside-dedup-sjekk (`getLeadByChatId()`) kan ALDRI sjå ein lead ein admin alt oppretta (RLS gjev anon null lesetilgang til `leads`), så `insert_anon_lead()` (einaste anon-vegen inn) gjorde alltid ein blind INSERT. Ny migrasjon `20260717140000_dedup_anon_lead_chat_id.sql`: ryddar opp det stadfesta EKSISTERANDE duplikatet i produksjonsdata (behald nyaste per `chat_id`), legg til ein partiell unik indeks (`chat_id IS NOT NULL`), og gjer `insert_anon_lead()` om til `INSERT ... ON CONFLICT (chat_id) ... DO UPDATE` i staden for ein rein INSERT. Tryggingsgjennomgått før merge (anon-facing SECURITY DEFINER-endring).

Testa: `node test.js` (535/536), `node test-workspace.js` (162/163) — begge kjende, pre-eksisterande feil uendra. Cache-bust: `module-crm.js?v=26`, `console-core.js?v=133`. `VIBEVERK_VERSION` 0.43.0 → 0.43.1.

## 0.43.0 — 2026-07-17

### Motta e-post (inbound) — fyrste implementasjon (steg 6f, ROADMAP.md punkt 6)

Bygd etter tre les-berre gjennomgangar tidlegare same dag (Arkitekt, Security Auditor, Privacy/Compliance Advisor — sjå ROADMAP.md punkt 6 for full grunngjeving) og brukar sitt eksplisitte "Bygg no, inkl. lettvekts-tryggingsventilen"-val.

- **Design, retta av ein fjerde Arkitekt-konsultasjon rett før koding**: i staden for ein ny, parallell `outbound_emails`/`lead_messages`-tabellpar, gjenbruker løysinga `crm_comms` sitt ALT fungerande utgåande e-post-mønster (`type:"email_sent"`, klient-generert `threadId`) direkte — `send-reply` (`supabase/functions/send-reply/index.ts`) gjer no eit oppfølgingskall til Resend sin `GET /emails/{id}` for å hente den EKTE RFC5322 Message-ID-headeren (sendekallet sjølv gjev berre ein ugjennomsiktig Resend-id, stadfesta via dokumentasjon 2026-07-17), lagra som `data.resendMessageId` på `email_sent`-raden.
- **Ny migrasjon** `supabase/migrations/20260717120000_inbound_email.sql`: `inbound_emails`-tabell (idempotens + revisjonsspor, EIGE tryggingslogg-formål skilt frå CRM-historikk, admin/editor-only SELECT/DELETE), `find_or_create_crm_customer_by_email()` (serialisert via `pg_advisory_xact_lock`, retta Arkitekten sin funne dedup-race), `process_inbound_email()` (service_role-only, VOLATILE — matchar In-Reply-To/References mot `crm_comms.data.resendMessageId`, krev SPF+DKIM-pass for BÅDE matcha tråd og ny-oppretting, umatcha avsendarar lagar ny Kontakt-lead + CRM-kunde merkt `data.autoCreated=true`).
- **Ny Edge Function** `supabase/functions/inbound-email/index.ts`: fail-closed webhook-handsamar — svix-signaturverifisering (offisielt `svix`-bibliotek) FØRST, før noko som helst anna (inkl. Resend-hentekallet). SPF/DKIM parsast frå den rå `authentication-results`-e-postheaderen (Resend dokumenterer ikkje eit eige felt for dette) — eit fråverande headerfelt tel IKKJE som pass.
- **CRM-UI** (`module-crm.js`): «Ikkje verifisert»-badge på auto-oppretta e-post-hendingar/kontaktar (Privacy-tilrådd lettvekts-tryggingsventil), ein «Uverifiserte»-filterknapp + bulk-slett-handling i kontaktlista (skilt frå `merge_crm_customers()`), og bakgrunnspolling (`startCrmPoll`/`pollRefresh`, 8s-intervall, merge-ved-id) som rettar Arkitekten sitt funne admin-cache-staleness-problem (leads/CRM-kundar mangla Realtime-abonnement, i motsetnad til chat — ein rad ein Edge Function skreiv medan panelet var ope synte seg aldri før reload).
- `deleteAllForEmail()` (GDPR §17-sletteflyten) utvida til å også slette matchande `inbound_emails`-rader.
- `workspace/module-settings.js` sin e-post-statuskort oppdatert til å reflektere at inbound no er støtta for `crmFull`-kundar (var eksplisitt "ikkje støtta enno").

**Kode-nivå Privacy Advisor-gjennomgang (2026-07-17) fann og retta to data-minimeringshol før merge**: `inbound_emails.headers` lagra fyrst HEILE det rå Resend-headerobjektet uendra (Received-kjeder med IP-ar til mellomliggande e-postserverar, m.m.) — no avgrensa til ei eksplisitt allow-list (message-id/from/to/subject/date/authentication-results/in-reply-to/references) i Edge Function-en FØR RPC-kallet. `crm_comms.data.html` var IKKJE trunkert (i motsetnad til `body`, som alt var avgrensa til 5000 teikn) — no trunkert likt, i begge greiner (matcha og uverifisert).

**Kode-nivå Security Auditor-gjennomgang (2026-07-17) fann éin CRITICAL og fleire lågare funn, alle retta før merge unntatt éin disclosa restrisiko**:
- **CRITICAL, retta**: den matcha-tråd-greina i `process_inbound_email()` godtok eit In-Reply-To/References-treff UTAN å stadfeste at DENNE avsendaren faktisk er kunden tråden høyrer til. SPF+DKIM stadfestar berre at avsendaren eig sitt eige domene — ikkje kven dei er. Utan denne sjekken kunne kven som helst med gyldig SPF/DKIM og ein tidlegare observert Message-ID (synleg for cc/bcc-mottakarar, vidaresendarar) forfalske eit svar inn i EIN ANNAN kunde sin CRM-tidslinje. Retta: krev no at avsendaren si e-postadresse faktisk høyrer til den matcha kunden (email/alt_emails) FØR treffet vert godteke — elles fell det heilt igjennom til umatcha-greina.
- **MEDIUM, retta**: bulk-slett-sikringsventilen re-sjekka ikkje `isUnverifiedCustomer()` i augeblikket knappen vart klikka — berre kva som var sant då lista sist vart rendra. Bakgrunnspollinga (8s) eller ei samstundes endring kunne i teorien la ein no-verifisert kunde bli sletta. Retta: re-filtrerer utvalet mot `isUnverifiedCustomer()` rett før sjølve slettinga.
- **LOW, retta**: `from_name` lagra heile den rå "Namn <adresse>"-headeren, ikkje berre visingsnamnet (datakvalitet, ikkje ein trygleikssårbarheit — verdien var alltid `esc()`-a ved vising). Ny `parseDisplayName()`-hjelpar i webhooken.
- **HIGH, IKKJE løyst — disclosa restrisiko**: `Authentication-Results`-headeren vert stola på som Resend sitt eige SPF/DKIM-verdikt, men ingenting stadfestar at Resend faktisk strippar/overskriv ein FORFALSKA versjon av same header sendt av avsendaren sjølv (RFC 8601 krev at mottakande MTA gjer dette, men Resend sin faktiske åtferd er ikkje stadfesta via dokumentasjon). Krev ein ekte test med ein bevisst forfalska Authentication-Results-header sendt til ei ekte Resend-inbound-adresse FØR dette kan stolast på i produksjon — same kategori disclosa-men-ikkje-verifisert risiko som svix-Deno-lastinga.

**Kjende, opne restrisikoar** (disclosa, ikkje løyste — sjå ROADMAP.md punkt 6 for full detalj): (1) svix@1.97.0-Deno-lasting, (2) Authentication-Results-tillitsgrensa over, (3) ingen automatisk retensjon/opprydding for `inbound_emails` enno. **Ikkje deploya enno** — krev eksplisitt brukargodkjenning per den vanlege deployment-sperra.

Testa: `node test.js` (535/536, kjend feil uendra), `node test-workspace.js` (162/163, kjend feil uendra) — ingen nye regresjonar. Cache-bust: `core.js?v=54`, `module-crm.js?v=25`, `module-settings.js?v=12`, `console-core.js?v=132`. `VIBEVERK_VERSION` 0.42.2 → 0.43.0 (ny funksjonalitet, MINOR).

## 0.42.2 — 2026-07-17

### Retta: status-badgen (Ny/Lest/Løst) synte seg urestylt i Workspace sin CRM-tidslinje

Brukar spurde kvifor "Løst"-taggen ikkje såg ut som ei pille i skjermbiletet frå førre retting. Rotårsak: `.stat-badge`/`.stat-badge--ny/--lest/--løst`-CSS-en (`module-crm.js` sin `tlItem()` set klassen `stat-badge stat-badge--<status>`) fanst alt i `index.html` og `admin/index.html`, men var ALDRI lagt til i `workspace/index.html` — sjølve HTML-strukturen var korrekt heile tida, berre stilarket for denne eine klassen mangla i den eine av dei tre flatene som deler `module-crm.js`. Lagt til, ordrett kopiert frå dei to andre shell-a.

Testa: `node test-workspace.js` (162/163), same kjende feil, ingen nye regresjonar.

## 0.42.1 — 2026-07-17

### Retta CRM-tidslinja: chat/lead-duplikat + auto-"løst" på berre-vising

Brukar fann live (skjermbilete av eigen «Kunder»-tidslinje): to av dei nyaste hendingane såg ut som chat, men synte seg vere «Kontaktmelding»-oppføringar med heile chat-transkriptet limt inn som tekst, og fleire nyleg viste oppføringar var alt merkt «Løst» sjølv om ingen faktisk hadde svart på dei.

- **Rotårsak, IKKJE noko nytt denne runda**: å lukke ein chat-samtale konverterer han alt (pre-eksisterande, sjå `saveConvAsLead()`/`setLeadResolved()` i `module-chat.js`) til ein "Kontakt"-lead med heile samtalen flata ut som `message`, automatisk sett "Løst". `getTimeline()` i `module-crm.js` viste denne lead-en OG den rå chat-samtalen som to separate hendingar for same interaksjon — alltid slik, men lite synleg før chat fekk sin eigen rike historikk-modal (v0.42.0) og gjorde duplikatet openbert.
- **Retta**: `getTimeline()` dedupar no — ein lead med `chatId` (chat-opphav) skjuler den tilsvarande rå chat-oppføringa. Den attverande lead-oppføringa (som ber ny/lest/løst-statusen Henvendelser-arbeidsflyten treng) opnar no den rike chat-historikk-modalen (transkript + Svar via e-post med sitert kontekst) i staden for den generiske e-post-svar-modalen sin enkle "Svar i chat"-snarveg. Framleis-opne samtalar (ingen lead enno) er heilt uendra.
- **Retta, stadfesta av brukar**: å opne/vise ei henvending i CRM-tidslinja sette før ALLTID status til "Løst", same om admin faktisk svara eller berre kika. No: berre "ny" → "lest" ved vising (same mønster som core.js sin eigen, allereie-korrekte Web-admin-leadsliste sitt "vis detaljar"-steg), aldri automatisk "løst" lenger frå denne tidslinja. Manuell "løst"-markering skjer framleis via Web-admin sin eigen leads-status-nedtrekksmeny (delt `leads`-tabell, uendra).

Testa: `node test.js` (535/536) og `node test-workspace.js` (162/163), same kjende feil, ingen nye regresjonar.

## 0.42.0 — 2026-07-17

### CRM: chat-historikk-modal + «Svar via e-post», Workspace: minimerbar sidemeny

To brukarønska, uavhengige mindre funksjonar, bygde og UX-gjennomgått same runde.

- **CRM-tidslinja sitt chat-punkt** opnar no ein les-berre historikk-modal (gjenbruker den eksisterande `openDialog()`-mekanismen, same mønster som telefon-/notat-dialogane) i staden for å navigere heilt vekk til Chat-fana. Motivasjon (stadfesta av brukar): kunden skreiv noko i chatten, forlot han, og admin vil ta opp tråden via e-post — chat krev registrering med e-post for å starte, så den finst alltid. Modalen har «Svar via e-post» (opnar det eksisterande e-post-svar-vindauget, `openEmailDialog()`, uendra mekanisme — men no med emne OG siste kunde-melding sitert med, ikkje ein tom komponist) og «Opne i Chat» (den gamle åtferda, framleis tilgjengeleg for ei samtale som enno er open).
- **Merk**: `getChatHistory()`/`getTimeline()` i `module-crm.js` synte seg alt å kombinere chat inn i tidslinja saman med e-post/notat/oppgåve/dokument-typane — denne økta sin tidlegare påstand om at "chat berre er ein hopp-til-snarveg" var feil, retta undervegs.
- **UX-gjennomgang gjennomført FØR merge**: fann og retta 4 HIGH-funn — (1) «Svar via e-post» opna før ein heilt tom komponist, mista konteksten admin nettopp hadde lese, no sitert med emne + siste kundemelding; (2) chat-transkriptet vart lese frå ein lokal cache som kunne vere forelda/tom om admin opna CRM utan å ha vore innom Chat-fana denne økta — no hentar dialogen på nytt i bakgrunnen (`Chat.hydrateFromSupabase()`) og oppdaterer innhaldet in-place; (3) tidsstempel per melding brukte relativ "for X sidan"-tid, upraktisk inni éin samtale — retta til absolutt klokkeslett; (4) sjå Workspace-punktet under for det fjerde funnet (CSS-arv).
- **Workspace-sidemenyen** kan no minimerast til ein rein ikon-rad via ei lita «←»-pil øvst til høgre i sidemenyen (roterer til «→» når minimert). Persistert per nettlesar. Skjult på mobil (der hamburger-meny-mønsteret alt handterer heilt av/på). UX-gjennomgang fann og retta 2 HIGH-funn: CSS-en for å skjule nav-tekstlabelen trefte for breitt og skjulte varsel-tal-merka (nye henvendelser) i tillegg — no skilt til ein eigen `.i-nav__link-label`-klasse som ikkje rører merka; av/på-knappen overlappa det fyrste nav-ikonet når sidemenyen vart minimert (brand-blokka som normalt gav rom for knappen forsvann) — retta med topp-avstand på navigasjonslista i minimert tilstand. Pluss eit mindre tilgjengelegheit-funn: nav-lenker mangla `title`/`aria-label` (viktig når berre ikonet er synleg, minimert) — lagt til.

Testa: `node test.js` (535/536) og `node test-workspace.js` (162/163), same kjende feil, ingen nye regresjonar.

## 0.41.2 — 2026-07-17

### Retta 0.41.1: Spaceship som ein EIGEN modul i Workspace-menyen (ikkje av/på-styring av easter-egget)

Brukar presiserte at 0.41.1 sin tilnærming (customModules styrer om det eksisterande trippel-klikk-easter-egget er aktivt) IKKJE var det som vart ønska — poenget var å faktisk SJÅ Spaceship dukke opp som eit eige, klikkbart menypunkt i Workspace, slik ein ekte kunde-spesifikk modul ville gjort.

- **Reverta** 0.41.1 sin gating av det eksisterande trippel-klikk-easter-egget (`autoAttach()`) — det er no urørt og alltid aktivt, akkurat som det var før heile denne øvinga.
- **Lagt til**: ei ny, separat `Intranet.registerModule()`-registrering i same fil (`workspace/module-workspaceship.js`), gata bak `App.ready(CFG)` og standard customModules-konvensjonen (ABSENT manifest-oppføring = IKKJE synleg i menyen — motsett konvensjon enn easter-egget sin eigen "framleis på"-standard, men konsistent med resten av customModules-systemet). Ei eksplisitt `{ enabled: true }`-oppføring i Console får «Spaceship» til å dukke opp som eit vanleg menypunkt, med spelet rendra INLINE i innhaldsområdet (gjenbruker det eksisterande `mountGame()`).
- **Reell teknisk fallgruve unngått undervegs**: Workspace sin ruter bruker EIN persistent `#intranet-main`-container som aldri vert fjerna frå DOM-et, berre tømt for innhald ved kvar navigering. Spelet sin eksisterande opprydding (avbryt animasjonsløkke, fjern globale tastatur-/vindaugelyttarar) er ein `MutationObserver` som sjekkar om ROTA framleis er i DOM-et — viss modulet sitt `mount()` hadde gjeve spelet `#intranet-main` sjølv som rot, ville denne sjekken ALDRI blitt sann, og animasjonsløkka ville køyrt i det uendelege i bakgrunnen etter kvar navigering vekk frå sida. Løyst ved å eksplisitt opprette eit ekte barne-element (`#workspaceship-root`) inni containeren FØR spelet vert montert, akkurat slik den eksisterande modal-varianten (`launch()`) alt gjorde det riktig.
- **Testdekning lagt til i `test-workspace.js`** (ny "AA"-seksjon, eigen separat DOM per den etablerte Z-seksjon-mønsteret sidan `App.ready()`-gata vert avgjort éin gong ved skriptlasting): stadfestar at modulen er skjult utan manifest-oppføring (b7), synleg og rendrar korrekt med `enabled:true` (aa1-aa2), at easter-egget framleis fungerer parallelt og urørt (aa3), og at opprydding-elementet faktisk vert fjerna frå DOM-et ved bortnavigering (aa4) — 5 nye, grøne testar.

Testa: `node test.js` (535/536) og `node test-workspace.js` (162/163, alle 5 nye grøne), same eine kjende feil som før.

## 0.41.1 — 2026-07-17

### customModules i praksis: Spaceship som fyrste, ekte testcase

Brukar ønska å faktisk SJÅ heile customModules-pipelinen (Console → tenant-config → ein ekte modul-fil) fungere, utan å finne opp ein ny, spekulativ forretningsmodul (ROADMAP sitt eige punkt om at det fyrste ekte spesialmodulet skal vente på ein reell kunde). Løysing: gjenbrukte det alt-eksisterande `workspace/module-workspaceship.js` (Spaceship, eit skjult trippel-klikk-easter-egg på Workspace-logoen) som testcase — det er allereie ein sjølvstendig, isolert, harmlaus modul-fil, berre aldri kopla til nokon av/på-brytar før no.

- `autoAttach()` sjekkar no `window.SITE_CONFIG.customModules.spaceship.enabled` før han bind trippel-klikk-lyttaren. **Stadfesta åtferd (brukar sitt val)**: absent manifest-oppføring = heilt uendra åtferd (framleis eit skjult easter egg for alle, som i dag) — berre ei EKSPLISITT oppføring med `enabled: false` slår han av, per kunde, via Console sin no-fungerande Modular-fane.
- Verifisert med eit standalone jsdom-script (3 case: tomt manifest → opnar framleis, `enabled:false` → sperra, `enabled:true` → opnar) — alle PASS.
- Fann og retta ein reell, urelatert liten gap medan fila likevel vart endra: `module-workspaceship.js` hadde ALDRI hatt eit `?v=N`-cache-bust-nummer i det heile (no `?v=1`), og `test-workspace.js` sin sti-omskrivings-regex for same fil kravde eksakt `.js"` (ingen suffiks) — retta til same `[^"]*`-mønster som `module-users.js` alt brukte, elles ville testen ha brote stille frå no av.

Testa: `node test.js` (535/536) og `node test-workspace.js` (157/158), same kjende feil — pluss den nye jsdom-standalone-verifiseringa av gatinga, som ikkje er ein del av dei to hovudtestpakkane (reint eingongsverktøy for denne endringa).

## 0.41.0 — 2026-07-17

### Fase 10 slice 2: Console-redigering av customModules-manifest

Utvidar Fase 10 (`customModules`-manifest, bein 3) sitt slice 1 (v0.38.0, les-berre) til faktisk redigering i Console, per Arkitekt-konsultasjon 2026-07-17 (les-berre design-runde, sjå kommentarane i koden for fullt resonnement).

- **Ny action `set_custom_modules_manifest`** i `supabase-control/supabase/functions/tenant-admin/index.ts` — same mønster som `update_tenant_hostnames` (heile-blob-erstatning, ikkje per-nøkkel samanslåing). Streng strukturvalidering (modul-id-format, at kvar oppføring er nøyaktig `{label, enabled, params}`), men `params` sitt INNHALD er med vilje ikkje validert (kan ikkje vite kva eit ikkje-bygd spesialmodul treng). 100KB storleikstak (målt i faktiske UTF-8-byte, ikkje UTF-16-lengd). Audit-logg skriv berre ei kompakt teljing, aldri rå `params`-innhald.
- **Console «Modular»-fana**: «Skreddarsydde modular» gjekk frå rein visning til fullt redigerbare kort — namn (tekstfelt), aktivert (avkryssingsboks), innstillingar (fritt JSON-tekstfelt, sidan kvart framtidig spesialmodul har sin eigen, ukjende form). Eige "Legg til ny modul"-skjema. Fjerning av ei oppføring har eigen `confirm()`-dialog (Tier B, utvida med ei eiga åtvaring når kunden er aktiv OG modulen er PÅ — fjerning har då same synlege konsekvens som å slå han av). Vanleg lagring/aktivering-endring viser i staden ei Tier B-inline-åtvaring når kunden er aktiv, ingen `confirm()` (matchar det etablerte mønsteret frå kundesjekklista sitt domene-felt).
- **Tryggingsgjennomgang** (ny API-handling til delt control-plane-tabell, per CLAUDE.md sin standardregel): eitt MEDIUM-funn (inkonsekvent HTML-attributt-escaping av modul-id i tre stader i Console-koden — retta, alle no via `C.esc()`) og eitt LOW-funn verdt å rette (storleikstaket målte UTF-16-lengd, ikkje faktiske byte — retta til `TextEncoder`). Prototype-pollution vurdert og funne IKKJE mogleg (modul-id-regexen tillèt ikkje understrek, så `__proto__` kan aldri bli ein modul-id).
- **UX-gjennomgang**: retta manglande `label for=`-kopling på JSON-tekstfeltet (skjermlesar-/klikkbarheit-regresjon mot `C.field()` sitt eige mønster), inkonsekvent `alert()` på feil ved fjerning (no `statusMsg()` som resten av skjemaet), lagt til «Lagrar…/Fjernar…/Legg til…»-mellomtilstand før nettverkskall, og retta valideringsrekkefølgja (namn sjekkast før JSON, så begge feil ikkje krev to forsøk å oppdage).
- **Ikkje bygd enno, med vilje**: sjølve det fyrste ekte `module-custom-<kunde>-<funksjon>.js`-eksempelet — ventar framleis på ein reell kundeførespurnad, per ROADMAP.

Testa: `node test.js` (535/536) og `node test-workspace.js` (157/158), same kjende feil — merk at Console sjølv ikkje har automatisert testdekning (stadfesta av Arkitekten), så manuell gjennomgang/QA er den faktiske test-planen her.

**Deploya til `vibeverk-control` 2026-07-17** (same dag, etter merge): `npx supabase functions deploy tenant-admin --project-ref jxoglthrnshabqmdmnui --workdir supabase-control`. Boot-verifisert (eit `set_custom_modules_manifest`-kall med gyldig-formatert men ikkje-operatør JWT gav reint funksjonsnivå-svar, ikkje ein boot-feil) — lågare risiko enn broker-deployen tidlegare same dag sidan denne endringa ikkje la til nokon ny ekstern Deno-importavhengigheit. Ikkje enno stadfesta med ein ekte operatørøkt i Console sjølv.

## 0.40.2 — 2026-07-17

### Smoke-test: user-deletion stadfesta PASS live

Brukar heva Supabase sin auth-e-post-rate-limit til 100 (Dashboard → Authentication → Rate Limits) — den einaste attverande blokkeringa frå 0.40.1. `user-deletion`-flyten køyrde deretter reint mot ekte `vibeverk-staging`: inviterte eit testmedlem, gav dei ei forfatta oppgåve, fjerna dei via den ekte "Fjern brukar"-UI-en, stadfesta at oppgåva overlevde med `created_by` nulla ut. Ingen attverande testdata i staging-databasen etterpå, `config.js` uendra. Begge dei to bygde smoke-test-flytene (`dashboard-shortcuts`, `user-deletion`) er no stadfesta PASS live.

## 0.40.1 — 2026-07-17

### Dokumentasjonsopprydding + smoke-test: user-deletion-flyt bygd

- **Brukar stadfesta**: logo-autokomprimeringa (0.39.0) er no testa ende-til-ende med ein ekte, for stor logofil via ein ekte operatørøkt — den einaste attverande usikre biten frå den runda er no lukka.
- **`docs/roadmap/ROADMAP.md` retta**: linje som feilaktig framleis sa "krev deploy av broker" for logo-arbeidet (deploya to gongar sidan) er oppdatert, og v0.38.2–v0.40.0 sine funksjonar (knapp-radius-fiks, autokomprimering, kontrast-forslag, fargepalett-generator) er no nemnde der dei høyrer heime.
- **ROADMAP "Next" punkt 5 (smoke-test-automatisering)**: ny `user-deletion`-flyt bygd i `.claude/skills/smoke-vibeverk/runner.js` — regresjonsdekning for `20260712203346_fix_user_delete_fk_restrict.sql` (brukarsletting feila før med "Feil: {}" for alle som hadde forfatta noko). Driv den ekte inviter-/fjern-UI-en i `module-users.js`; bruker eit nytt `runStagingSql()`-hjelpefunksjon (skal til `npx supabase db query --file --output-format json`) berre for å gje den nyinviterte, aldri-innlogga medlemmen ei forfatta oppgåve å teste sletting mot — noko ingen UI-flyt dekkjer i denne test-pakken. Krev éin ny legitimasjon, `VW_STAGING_DB_URL` (staging sin pooler-tilkoplingsstreng), utover dei fire skill-en alt lista.

  **Køyrd live mot ekte `vibeverk-staging` same dag** (brukar sette opp SMTP, admin-testkonto og delte legitimasjon). Fyrste ekte køyring avdekte og retta fleire reelle hol i sjølve test-verktøyet (ikkje i produktkoden):
  - **Staging var ikkje fullt oppdatert**: 11 av 12 migreringar var applikerte, `20260715140000_export_backup_tables_rpc.sql` mangla. Pusha (`npx supabase db push --db-url ...`), stadfesta etterpå.
  - **`runStagingSql()` sin JSON-parsing var reelt sett aldri testa** — CLI-en returnerer eit pretty-printa (fleire linjer) JSON-objekt forma `{ boundary, rows, warning }`, ikkje éin JSON-blob per linje som den opphavlege (gjetta) koden føresette. Retta til å skjere frå fyrste `{` til siste `}` i heile output.
  - **`dashboard-shortcuts` sin KB-halvdel feila** fordi `config.js` sin standard har `intranettFeatures.kb: false` — konfig-ombyttinga tvingar no dette flagget `true` berre for testkøyringa (einaste unntaket frå "alle andre felt urørte"-prinsippet), retta og verifisert til **PASS**.
  - **Manglande opprydding-sikringsnett**: ein tidlegare feila køyring (før SQL-arrangeringssteget vart retta) etterlot eit ekte, urydda testmedlem i staging-databasen. Rydda manuelt, og lagt til eit automatisk sikringsnett i `finally`-blokka som fjernar eit slikt medlem direkte om den ekte UI-fjerninga aldri fullførte.
  - **`user-deletion` sjølv trefte ein ekte ekstern grense, ikkje ein kodefeil**: Supabase sin eigen auth-e-post-rate-limit ("email rate limit exceeded") etter nokre få invitasjonar på kort tid — ei prosjektinnstilling (Dashboard → Authentication → Rate Limits), heilt uavhengig av SMTP-leverandør. Feilteksten vart før berre ein uinformativ timeout; retta til å lese og kaste den faktiske statusteksten med ein gong. `dashboard-shortcuts` er no stadfesta **PASS** live; `user-deletion` står klar til å køyrast på nytt når rate-limiten er heva eller nok tid har gått.
  - `.gitignore` mangla ei oppføring for `.claude/skills/smoke-vibeverk/screenshots/` (hadde det alt for `run-vibeverk`) — retta.

## 0.40.0 — 2026-07-17

### Console «Fargar»: heil fargepalett-generator

Oppfølging same dag av tilbakemelding på 0.39.0 sin «Generer forslag»-knapp: brukar ønska ein variant som set saman eit HEILT tema, ikkje berre rettar éin feilande farge om gongen. Ny knapp «🎨 Generer fargepalett» øvst i Fargar-fieldset (Web-fana): vel ein tilfeldig basis-fargetone, byggjer primær/sekundær/bakgrunn/tekst/overflate rundt han (`generateThemePalette()`), og bruker den eksisterande `suggestAccessibleColor()`-funksjonen som sikringsnett på kvart resultat — garanterer at forslaget faktisk oppfyller WCAG AA (4.5:1 tekst, 3:1 primær/sekundær) FØR det vert vist, ikkje berre eit visuelt gjett. Kan klikkast fleire gongar for nye forslag; ingenting vert lagra før «Lagre og bruk». Verifisert mot 24 faste fargetonar (kvar 15°) + 5 tilfeldige køyringar i Node — alle bestod AA-kravet.

## 0.39.0 — 2026-07-17

### Live-test-oppfølging: Workspace-tema, References-kort, Læring, Personvern-forslag, Trafikk-tekst, WCAG-forslag, logo-autokomprimering

Direkte oppfølging av live-test-tilbakemelding på v0.38.1/0.38.2:

- **Console «Workspace»-fana**: ny «⇄ Speil nettside»-knapp i Fargar-fieldset — kopierer dei lagra fargane/fontane frå «Web»-fana inn i Workspace-felta (ingenting lagra før eige «Lagre»-klikk). Fontpar-knappane (både Web og Workspace) markerer no visuelt (`.is-active`, blå kant/bakgrunn) kva par som faktisk matchar dei noverande display-/body-verdiane, i staden for ei rad identiske, blanke knappar.
- **Referansar** (`module-references.js`): kort som har BÅDE vanleg tekst OG sitat viste tidlegare begge, uavhengig 4-lines-kutta av CSS åleine — kunne kutte midt i ei setning/eit ord utan synleg «…». Retta: sitatet vert no prioritert og vist ÅLEINE på sjølve kortet når det finst (full tekst framleis tilgjengeleg på detaljsida), og all kort-tekst/sitat vert no eksplisitt kutta med «…» ved ordgrense (`truncateForCard()`) i staden for å stole åleine på CSS sin `-webkit-line-clamp`.
- **Læring**: `docs/architecture/customer-delivery-checklist.md` omsett frå engelsk til norsk (nynorsk, matchar dei andre onboarding-dokumenta) — same struktur/lenker, berre språket endra.
- **Personvern**: knappen «Hent Vibeverk sin standardtekst» omdøypt til «Bygg basert på gjeldande modular» — funksjonen (`computeTenantPrivacyDefault()`) var alt modul-medviten (kontaktskjema/tilbod/booking/Plausible) sidan tidlegare, berre namnet var missvisande. Hjelpeteksten utvida med eksplisitt fråskriving: dette er eit utgangspunkt frå oss, kunden må sjølv leggje til tekst for andre tredjepartsløysingar, og kunden er juridisk ansvarleg for at teksten stemmer.
- **Trafikk (Web-admin)**: tom-tilstand-teksten når ingen analyse er sett opp endra frå ei generisk oppmoding til å kontakte "din leverandør" til ei konkret tilvising til Plausible.io og Vibeverk sin eigen hjelp med oppsett.
- **WCAG-kontrastvalidator**: ny «Generer forslag»-knapp per feila kontrastsjekk (tekst/bakgrunn, primærfarge/bakgrunn) — justerer automatisk lysstyrken (HSL) på den feilande fargen til AA-terskelen er nådd, behelder fargetone/metning. Verifisert mot 5 handskrivne testcase (låg-kontrast grå/gul, allereie-OK primærfarge, nesten-kvit-på-nesten-svart, raud-på-mørkraud) lokalt i Node før innlemming.
- **Console «System»-fana**: fjerna «Nettside-admin (for kunden)»-boksen (redigering av `superconfig-private.adminPassword`) — brukar stadfesta at han ikkje har nokon praktisk funksjon for nokon ekte, Supabase-konfigurert kunde (verkar berre for eit reint lokalt/ikkje-konfigurert testoppsett, sjå ADR-0003). Fjerna berre Console sitt redigerings-UI og dei no ubrukte `getSCPrivate()`/`saveSCPrivate()`-hjelpefunksjonane i `console-core.js` — broker sine `get_private_config`/`set_config`-actions og RLS-oppsettet server-side er urørt, og core.js sin eigen fallback-passordlogikk (ein heilt annan kodesti) er òg urørt.
- **Logo-opplasting: automatisk komprimering** (`upload_logo` i `supabase-control/supabase/functions/broker/index.ts`): PNG/JPEG-opplastingar over 300KB vert no automatisk skalerte ned og (for JPEG) kvalitetsjusterte via `imagescript` (`https://deno.land/x/imagescript@1.3.0/mod.ts`) heilt til dei er under 300KB, i staden for å berre verte avvist. Rå klient-/server-tak heva til 6MB for desse to filtypane. SVG (tekst/sanering, uendra) og WebP (imagescript kan IKKJE dekode WebP, berre kode det) er MEDVITE utelatne frå komprimering og held fram med 300KB som absolutt tak. API-signaturane (`Image.decode`/`.clone()`/`.resize()`/`.encode()`/`.encodeJPEG()`) er stadfesta via imagescript sin publiserte `.d.ts` (ikkje gjetta), og importstien er stadfesta til faktisk å løyse seg (henta direkte, ikkje berre dokumentasjon som hevdar det) — MEN, same kategori atterhald som `@xmldom/xmldom` tidlegare: **ingen lokal Deno-runtime finst for å køyre denne koden i praksis før deploy**, og broker-funksjonen er **ikkje deploya enno** for denne endringa (krev eiga, eksplisitt godkjenning, same som sist).
  - **Tryggingsgjennomgang gjennomført FØR merge**: eitt HIGH-funn — det nye 6MB-taket på rå (koda) filstorleik avgrensar IKKJE kor mange PIKSLAR ei PNG kan dekodast til; ei vesle, låg-entropi 30000×30000-PNG kan koda på under 300KB, men dekodert som RGBA er det ~3.6GB minnebruk i éin einaste Edge Function-kalling ("dekomprimeringsbombe"). Retta med ein ny `readImageDimensions()` som les BREIDD/HØGD direkte frå PNG-IHDR/JPEG-SOF-headeren UTAN å dekode heile biletet, og avviser (returnerer `null` frå `compressRasterImage()`, same som eit anna komprimeringsfeil) alt over ~25 megapiksel eller 10000px i éin dimensjon FØR `Image.decode()` nokon gong køyrer. Dimensjonsparsaren er verifisert mot 6 handskrivne testcase (normalstorleik PNG/JPEG, den faktiske 30000×30000-bomba, ugyldige byte, JPEG med eit APP0-segment før SOF0) lokalt i Node før innlemming.
  - **Deploya til `vibeverk-control` 2026-07-17** (same dag, etter merge): `npx supabase functions deploy broker --project-ref jxoglthrnshabqmdmnui --workdir supabase-control`. Boot-verifisert same måte som sist (eit `upload_logo`-kall med gyldig-formatert men ikkje-operatør JWT gav reint funksjonsnivå-svar, ikkje boot/import-feil) — stadfester at `imagescript`-importen faktisk løyser seg i produksjon. Framleis ikkje stadfesta: sjølve komprimeringsvegen gjennom ein ekte operatør-økt med eit ekte, for stort bilete.

Testa: `node test.js` (535/536, same kjende feil) og `node test-workspace.js` (157/158, same kjende feil) — ingen nye regresjonar.

## 0.38.2 — 2026-07-17

### Hjørne-radius: knappar var ikkje påverka (funne av brukar under live-test av v0.38.1)

Live-test av v0.38.1 sitt hjørne-radius-val avdekte at knappar (`.btn` i `index.html`/`admin/index.html`/`workspace/index.html`) heldt fram med hardkoda `border-radius: 999px` (pill-form) uavhengig av valet — dei var aldri kopla til `--radius`-variabelen, berre kort/bilete/modalar var det.

Retta med ein eigen `--btn-radius`-CSS-variabel (default `999px`, uendra standardutsjånad): `core.js` sin `applyTheme()` set no `--btn-radius` til den faktiske radius-verdien når han er **under** 14px (Skarpe hjørner/Litt runde), men held han på `999px` (pill) på Standard/Runde — brukar valde denne varianten uttrykkeleg for å unngå at standard-utsjånaden endra seg synleg for eksisterande kundar. Console sin eigen hint-tekst for feltet oppdatert til å skildre dette presist (var før feilaktig og sa at valet styrte knappar fullt ut). Console sin eigen UI-chrome (ikkje kundens tema) er urørt.

## 0.38.1 — 2026-07-16

### Console Web-tema: logo-opplasting (SVG-sanering), hjørne-radius, WCAG-kontrastvalidator

Fullfører dei tre attverande hola frå `docs/arkitekt-notat-steg2.md` sitt "Custom design-modul"-konsept (sjå same dags ROADMAP-retting), no som det stadfesta at Console sitt Web/Workspace-tema-panel alt dekkjer resten av konseptet.

- **Logo-fil-opplasting** (`renderWeb()` i `console/console-core.js`): nytt filfelt ved sida av det eksisterande Logo-URL-feltet. Går via ein ny `upload_logo`-action i `supabase-control/supabase/functions/broker/index.ts`, same to-klient-mønster (control-plane-autentisering + Vault-dekryptert `service_role`-nøkkel inn i KUNDEN sitt eige `media`-Storage-bøtte) som `set_config`/`reset_config` alt brukar. SVG-filer vert sanert med ein allowlist-basert sanitizer (eigne funksjonar `sanitizeSvg*`/`isSafeHrefValue`/`looksLikeXml`) — berre trygge element/attributt (geometri/presentasjon) får bli med, `<script>`/`<foreignObject>`/`<style>`/SMIL-animasjonar er utelatt berre ved IKKJE å stå i lista, `href`/`xlink:href` avgrensa til interne fragment-referansar eller `data:image/...;base64`-URI-ar (aldri eksterne URL-ar).
  - **Tryggingsgjennomgang gjennomført FØR merge** (per CLAUDE.md sin standardregel for fil-opplasting/lagring): to MEDIUM-funn retta same runde — (1) sanering var opphavleg gata på det klient-oppgjevne `content_type`-feltet åleine (ei SVG sendt med `content_type: "image/png"` hoppa over saneringa); no avgjer eit reelt bytesniff (`looksLikeXml()`) om ei fil vert handsama som SVG, uavhengig av kva klienten hevda. (2) Saneringa rensa berre `<svg>`-rota sitt undertre, ikkje sjølve dokumentet — ein syskje-processing-instruction FØR rot-elementet (t.d. ein ekstern `<?xml-stylesheet?>`) overlevde urørt; no strippa via ny `sanitizeSvgDocument()`. To LOW-funn retta i tillegg: 300KB-grensa handhevast no FØR base64-dekoding (ikkje berre etter), og ein sekundær DOCTYPE/ENTITY-reject-sjekk etter regex-strippinga (forsvar i djupn mot at regex-en ikkje kan provast fullstendig mot DTD-grammatikken). Sanitizer-logikken stadfesta med 13 handskrivne testcase (skript-injeksjon, `onload`/`onclick`, `foreignObject`-HTML, `javascript:`-href, ekstern biletreferanse, syskje-PI, innhaldssniff) via det tilsvarande npm-paketet lokalt.

**Deploya til `vibeverk-control` 2026-07-17**: `npx supabase functions deploy broker --project-ref jxoglthrnshabqmdmnui --workdir supabase-control` — deploy-kommandoen returnerte OK, men stadfesta i tillegg med eit reelt HTTP-kall: eit `upload_logo`-kall med ein gyldig-formatert (men ikkje-operatør) JWT gav eit reint funksjonsnivå-JSON-svar (`{"error":"Ugyldig token"}`), IKKJE ein platform boot/import-feil — dette stadfester at `@xmldom/xmldom`-importen via esm.sh faktisk løyser seg i den ekte Deno-runtimen. **Framleis ikkje stadfesta**: sjølve saneringslogikken sin faktiske veg gjennom ein ekte operatør-økt (OTP-innlogging) — krev at nokon faktisk lastar opp ein logo via Console for full ende-til-ende-stadfesting.
  - Gamal logo vert rydda opp (best-effort) ved ny opplasting via eit nytt `old_logo_url`-felt klienten sender med.
- **Hjørne-radius**: ny `<select>` (skarpe/litt runde/standard/runde) skriv `sc.colors.radius` (heiltal px), lese av `core.js` sin `applyTheme()` inn i CSS-variabelen `--radius`.
- **WCAG AA-kontrastvalidator**: reint klientside (ingen lagring) — viser live kontrastforhold tekst/bakgrunn (4.5:1-krav) og primærfarge/bakgrunn (3:1-krav for grensesnittelement) mens operatøren vel fargar.

`docs/roadmap/ROADMAP.md` sitt "Custom design-modul"-punkt oppdatert til å seie desse tre hola no er lukka. Testar grøne (535 OK / 1 kjend FEIL i test.js, 157/158 i test-workspace.js, uendra — Console har som før ingen jsdom-dekning, ikkje automatisk testa der).

**Krev deploy av `broker`-funksjonen til `vibeverk-control` (`--project-ref jxoglthrnshabqmdmnui`) før logo-opplasting fungerer i praksis** — ikkje deploya enno, krev eksplisitt godkjenning per CLAUDE.md sin deployment-safeguard.

## 0.38.0 — 2026-07-16

### Fase 10 (slice 1) — customModules-manifest: skjelett/lesing på plass

Fyrste konkrete steg mot "bein 3" (skreddarsydde kundemodular, sjå `docs/STRATEGY.md`). Arkitekten konsultert (per CLAUDE.md sin standardregel for arkitektur-sensitive endringar) — designet stadfesta at `tenants.custom_modules_manifest` (jsonb-kolonne i `vibeverk-control`, oppretta alt i Fase 6-baseline-migrasjonen, aldri kopla til noko) er den einaste kjelda: ikkje del av superconfig/broker-laget (som styrer kunde-redigerbar `features`/`theme`), sidan dette er operatør-forfatta, ikkje kunde-redigerbart, innhald.

Denne runda (slice 1, reint lese-nivå, ingen redigering enno):
- `api/tenant-config.js`: `tenant.custom_modules_manifest` vert no vidareført inn i det genererte `window.SITE_CONFIG.customModules` (var stille droppa før).
- `config.js`: ny `customModules: {}`-nøkkel lagt til (parallelt skjema for statisk/lokal config, kommentert med eksempel).
- Console: `renderModular()` ("Modular"-fana) viser no ei tredje, lese-berre liste "Skreddarsydde modular" henta frå `_activeTenant.custom_modules_manifest` (`loadTenants()` sitt `select` utvida til å hente feltet) — viser "Ingen skreddarsydde modular for denne kunden" når tomt, elles `label (id) — PÅ/AV` per oppføring.
- Kvart manifest-element sitt skjema: `{ label, enabled, params }` — `enabled` **default AV** når fråverande (medvite motsett av den delte `features`/`intranettFeatures`-katalogen sin "manglar flagg = på"-konvensjon, sidan dette er sjeldan, ad hoc, per-kunde-innhald der ein ufullstendig/foreldra manifest-oppføring aldri skal aktivere seg sjølv).

**Ikkje bygd enno, med vilje (neste slice)**: redigering i Console (ny `tenant-admin`-action `set_custom_modules_manifest`), og sjølve det fyrste ekte `module-custom-<kunde>-<funksjon>.js`-fil-eksempelet — begge ventar til slice 1 er stadfesta og/eller ein reell kunde-førespurnad finst. Ny test lagt til i `test.js` (`SITE_CONFIG.customModules` er tomt objekt i standardkonfig). Testar grøne (535 OK / 1 kjend FEIL i test.js, 157/158 i test-workspace.js, uendra).

## 0.37.5 — 2026-07-16

### Console: ny "Læring"-fane viser docs/onboarding/*.md direkte i grensesnittet

Følgje opp same dags nye onboarding-dokumentasjon (`docs/onboarding/new-team-member-onboarding.md` m.fl.) — i staden for at nokon må opne rå Markdown-filer i repoet, viser Console no innhaldet direkte, pent formatert. Ny "Læring"-fane i sidebaren (`NAV_ITEMS`), med fire faneknappar (Læringsdokument/Trygge endringar/Hendingsguide/Kundeleveranse) som hentar tilhøyrande `.md`-fil via `fetch()` (same opphav — dokumenta er alt del av det statiske repoet som blir servert) og konverterer til HTML med `marked` (nytt CDN-avhengig, pinna til major versjon `@12`, same mønster som Tabler Icons — `script-src` i CSP-en tillet alt `cdn.jsdelivr.net`, ingen CSP-endring naudsynt).

Ikkje tenant-spesifikt — same innhald uansett kva kunde er vald i kundeveljaren, sidan dette er interne Vibeverk-dokument. Stadfesta empirisk (Playwright, isolert testside): `marked` lastar korrekt frå CDN, `fetch()` hentar dokumentet, HTML-et inneheld korrekt struktur (overskrifter, tre tabellar, lenker), ingen konsollfeil. Console sjølv har ingen jsdom-testdekning frå før (kjend, dokumentert avgrensing) — full grensesnitt-gjennomklikking (inkl. den faktiske OTP-innlogginga) er difor ikkje stadfesta, berre den underliggande hente-og-rendre-mekanismen.

Lagt til ein tom `.nojekyll`-fil i repo-rota — ein billig, trygg sikring for at `fetch()`-mekanismen over også fungerer korrekt om GitHub Pages-rollback-vegen (jf. ADR-0007) nokon gong faktisk blir teken i bruk att; utan denne kunne Jekyll (GitHub Pages sin standard prosesseringsmotor, ikkje aktiv på det noverande Vercel-baserte hovudsporet) i teorien handsame `.md`-filer annleis enn ei rein statisk fil-tening. Påverkar ikkje Vercel i det heile.

Alle testar grøne (534 OK / 157 OK, den eine kjende feilen uendra — ingen av desse dekker Console). Cache-bust: `console-core.js?v=115→116`. `VIBEVERK_VERSION` 0.37.4 → 0.37.5.

## 0.37.4 — 2026-07-16

### Ny `smoke-vibeverk`-skill — start på ROADMAP punkt 5 (automatisert livetest-agent)

Design gjennomgått av QA-agenten FØR koding (per ROADMAP sitt eige krav for dette arbeidsstykket): tilrådde `vibeverk-staging` (ref `syqnyfeponexmkdvnsga`) som mål via ein lokal `config.js`-ombytting (aldri ein Vercel-nåbar staging-vert eller ein ny `vibeverk-control`-tenant-rad — verken Workspace eller Web-admin løyser tenant via hostnamn lokalt, kun Console gjer det, og Console sin onboarding-sjekkliste er difor sist i byggerekkefølgja). Stadfesta sjølv mot faktisk kode: same mønster som ein alt-dokumentert manuell test 2026-07-13 (`docs/project/CURRENT_STATE.md`).

Ny, **separat** skill `smoke-vibeverk` (bevisst ikkje ein utviding av `run-vibeverk`, som er hardkoda mot produksjon — blanda saman kunne du enda opp med å køyre eit skrivande flow mot feil miljø). Inneheld ein `config.js`-ombyttingsmekanisme med ein hard tryggingssperre (les attende fila etter skriving, stadfesta bort frå produksjonsref FØR nokon flyt køyrer, gjenopprettar alltid original-fila i ein `finally`-blokk).

Første flyt bygd og kodeverifisert (selektorar stadfesta direkte mot `module-dashboard.js`/`module-kb.js`/`module-announcements.js`, to feil retta undervegs — venta gjetta selektorar var feil): **`dashboard-shortcuts`**, regresjonsdekning for ein reell, tidlegare send bug (0.32.x) der "Ny kunngjøring"/"Ny artikkel"-snarvegane på dashbordet kunne kappløpe mot ein asynkron listelasting.

**Ikkje verifisert live enno** — krev ein ekte admin-testkonto på `vibeverk-staging` (ikkje stadfesta å finnast, sidan den siste kjende staging-testbrukaren vart bevisst oppretta-og-sletta som del av ein tidlegare eingongstest) og staging sin faktiske anon-nøkkel, som denne økta ikkje henta (fanga av harnesset sin eigen legitimasjons-eksponeringsgrense — krev eksplisitt brukarhandling, ikkje ein agent som hentar det sjølv). Sjå `.claude/skills/smoke-vibeverk/SKILL.md` for konkrete neste steg.

**Ikkje bygd enno** (neste i QA sin tilrådde rekkjefølgje): `user-deletion` (høgast regresjonsverdi), `backup-restore` (snapshot-restore-self-mønster), full innloggingsmatrise, og Console sin onboarding-sjekkliste (sist, krev eiga engangs-kontrollplan-tenant-rad + ein måte å omgå ekte OTP-e-post på).

`VIBEVERK_VERSION` 0.37.3 → 0.37.4. Cache-bust: `console-core.js?v=114→115`.

## 0.37.3 — 2026-07-16

### Tryggleiksfiks: `fetch_tenant_project_keys` manglar kryss-tenant-sjekk (HIGH)

Sikkerheitsgjennomgang (general-purpose-agent, standing in for Security Auditor per den kjende harness-avgrensinga — sjå `docs/project/CURRENT_STATE.md`) av `fetch_tenant_project_keys` (0.34.6) og dei to onboarding-migrasjonane frå 0.34.4/0.34.5, aldri tidlegare uavhengig gjennomgått. Verdikt: CAUTION, eitt HIGH-funn, stadfesta sjølv (lese koden direkte) før fiks:

`fetch_tenant_project_keys` sin einaste guard sjekka berre om `data_plane_url` peika på kontrollplanet sjølv (`CONTROL_PLANE_PROJECT_REF`) — ingenting stoppa eit kall frå å målrette ein ANNAN, alt-registrert tenant sin `data_plane_url` (ingen `UNIQUE`-constraint finst på denne kolonnen). Ein superadmin kunne difor (ved feil eller ondsinna) hente ein heilt annan kunde sin ekte `service_role`-nøkkel via Management API-et og lagre han på ein urelatert, provisjonerande tenant-rad. `supabase-control/supabase/functions/tenant-admin/index.ts` sin `fetch_tenant_project_keys`-handling sjekkar no eksplisitt om `data_plane_url` alt er i bruk av ein ANNAN tenant-rad FØR Management API-kallet, og avviser med 409 om så er tilfelle. Suksess-utfallet i `broker_audit_log` inkluderer no òg kva prosjekt-ref som faktisk vart henta (var før tomt på suksess, svekka sporbarheita nettopp for dette funnet).

To mindre funn (MEDIUM/LOW) er dokumenterte, ikkje fiksa denne runda — vurdert trygt i dagens skjema, men verdt å hugse: sjølve `pg_trigger_depth()`-baserte unnataket i `prevent_self_role_escalation()` er ein generisk stack-djupn-sjekk, ikkje ein identitetssjekk (kan i teorien opnast av ein framtidig, urelatert trigger-kjede); `CONTROL_PLANE_PROJECT_REF` er dupliserte som ein magisk streng to stader.

**Deploya til `vibeverk-control` same dag** (`npx supabase functions deploy tenant-admin --project-ref jxoglthrnshabqmdmnui --workdir supabase-control`, eksplisitt godkjent av brukar). Stadfesta live at funksjonen svarer (401 på uautentisert kall, som forventa). **Ikkje stadfesta ende-til-ende** at sjølve kryss-tenant-avvisinga faktisk fungerer i praksis — det krev ein ekte superadmin-Console-økt, ikkje tilgjengeleg i denne sesjonen. Sjå Security Auditor sin "MANUAL TESTS REQUIRED"-seksjon for korleis dette bør testast (mot `vibeverk-staging`, aldri produksjon).

`VIBEVERK_VERSION` 0.37.2 → 0.37.3. Cache-bust: `console-core.js?v=113→114` (versjonsnummeret vises der).

## 0.37.2 — 2026-07-16

### Google Fonts sjølv-hosta for Poppins/Nunito Sans — fjernar tredjeparts-overføring for Vibeverk sine eigne to fontar

Følgje opp same dags Privacy/Compliance-gjennomgang (`docs/compliance/data-map-vibeverk.md` seksjon 8): dynamisk lasting av Google Fonts sender besøkjande sin IP-adresse til Google (USA) ved kvar sideopplasting — det einaste av dei fire tredjepartane der "ingen overføring i det heile tatt" faktisk var ei reell teknisk moglegheit, ikkje berre eit juridisk spørsmål om overføringsgrunnlag (i motsetnad til Vercel/Resend, som begge krev SCC uansett sidan dei alltid prosesserer i USA).

Nye `fonts/self-hosted-fonts.css` + fire `.woff2`-filer (latin/latin-ext-delmengder — dekker norsk/nordisk/europeisk tekst, IKKJE cyrillisk/devanagari/vietnamesisk som sida uansett ikkje treng), lasta ned direkte frå Google sitt eige CSS2-API 2026-07-16. `core.js` sin `injectGoogleFonts()` og `workspace-core.js` sin `_loadWspFonts()` sjekkar no om kvart fontnamn er eitt av dei to lokalt sjølv-hosta ("Poppins"/"Nunito Sans") — då vert lokal stilark brukt, ELLERS fell mekanismen tilbake til Google sin CDN heilt uendra. **Andre kundar som vel eit anna Google Font-namn via Console er difor upåverka** — dette er reint eit unnatak for akkurat desse to fontnamna, ikkje ei generell arkitekturendring.

Stadfesta empirisk (Playwright, lokal server): **null nettverksførespurnadar til `fonts.googleapis.com`/`fonts.gstatic.com`** for Vibeverk sin standardkonfigurasjon, korrekt berekna `font-family`, korrekt visuell rendering (skjermbilete samanlikna mot før — identisk utsjånad, ingen fallback-/tofu-visning). `test.js` sin eksisterande fontsjekk oppdatert til å reflektere det nye, korrekte resultatet (venta no `#app-fonts-local`, IKKJE `#app-fonts`, for standardkonfigurasjonen).

Alle testar grøne (534 OK / 157 OK, den eine kjende, pre-eksisterande feilen uendra — talet auka med éin sidan éin gammal assert vart delt i to meir presise). Cache-bust: `core.js?v=50→51` (alle fire HTML-inngangspunkt), `workspace-core.js?v=19→20`, `console-core.js?v=112→113`. `VIBEVERK_VERSION` 0.37.1 → 0.37.2.

## 0.37.1 — 2026-07-16

### vibeverk.no DNS-cutover fullført + enkel utviklingsfase-passordsperre

**DNS-cutover**: `vibeverk.no` sin apex-A-post er endra frå GitHub Pages (4 IP-ar) til Vercel (`76.76.21.21`), stadfesta live (`Server: Vercel`-header, korrekt dynamisk `/config.js`, ekte hydrert produksjonsinnhald). Forarbeid (tenant-rad-verifisering + accept-path-smoke-test) gjort og stadfesta OK same dag, sjå `docs/roadmap/ROADMAP.md` punkt 2 for full detalj. `CNAME`-fila i repoet er urørt (rask GitHub Pages-rollback framleis mogleg).

**Fire nye videresendingar** sett opp av brukar hos registraren (`console.vibeverk.no`, `staging.vibeverk.no`, `sunnvask.vibeverk.no`, `workspace.vibeverk.no`) — alle stadfesta fungerande via curl. `workspace.vibeverk.no` peikar førebels via den gamle `/intranet`-omdirigeringssnubben (fungerer, men éin unødvendig ekstra hopp — bør oppdaterast til å peike direkte på `/workspace/` hos registraren).

**Ny enkel passordsperre** (`middleware.js`): sidan heile plattforma (inkl. Vibeverk sjølv) framleis er i utviklingsfase og ingenting er meint å vere reelt offentleg enno, er det lagt til ein HTTP Basic Auth-sjekk FØRST i middlewaren, styrt av `SITE_LOCK_PASSWORD`-miljøvariabelen (sett på begge Vercel-prosjekt — `vibeverk` og `vibeverk-j1yg` — Production+Preview). Gjeld samstundes alle fem domena/aliasa over, sidan dei deler same middleware-fil. IKKJE ei sikkerheitsgrense — reint ei hindring mot tilfeldige besøkjande, fail-open viss variabelen manglar. Kjem i TILLEGG til, ikkje i staden for, dei eksisterande admin-/Workspace-/Console-innloggingane. Verifisert live med curl (401 utan/med feil passord, 200 med rett passord) på tvers av alle domena.

Cache-bust: `console-core.js?v=111→112`. `VIBEVERK_VERSION` 0.37.0 → 0.37.1.

**Sluttstatus same dag, etter fullstendig live-verifisering av alt over** (hovudside, `/config.js`, `/console`, `/workspace`, alle fire videresendingane inkl. `workspace.vibeverk.no` — brukar oppdaterte sjølv denne til å peike direkte på `/workspace/` i staden for via `/intranet`-snubben — og passordsperra, på tvers av begge Vercel-prosjekt): **heile migreringa er stadfesta fullført og fungerande, ingenting attståande.**

To punkt vart eksplisitt vurdert og medvite VALT å ikkje gjere noko med no, stadfesta av brukar — **ingen av dei to er eit tryggleiksavvik**:
- `SITE_LOCK_PASSWORD` står framleis som placeholder-verdien `vibeverk2026`. Dette er ein bevisst, informert veke frå brukar (stadfesta "ekstremt usannsynleg at nokon skal besøkje sida" i dag) — ikkje ei gløymt oppgåve. Sjølve mekanismen er uansett eksplisitt designa som ei hindring, IKKJE ei sikkerheitsgrense (sjå over) — alle faktiske tilgangskontrollar (Supabase RLS, admin-/Workspace-passord, Console sin OTP) ligg urørt bak denne sperra uansett kva passordverdi som er sett her.
- `CNAME`-fila i repoet er framleis urørt (rask GitHub Pages-rollback). Ho inneheld berre den offentlege domenestrengen `vibeverk.no` — ingen hemmelegheit, ingen tilgang, null risiko ved å liggje att i eit offentleg repo. Reint ein bevisst utsett oppryddingsdetalj, ikkje eit hol.

## 0.37.0 — 2026-07-16

### Console: live fontforhandsvising i Fontar-seksjonane (Nettside + Workspace)

Brukarønske: gjer det lettare å sjå for seg valt font FØR ein lagrar, i staden for å måtte hugse korleis han ser ut eller lagre og sjekke live-sida etterpå. Ny delt `bindFontPreview()`/`refreshFontPreview()`-infrastruktur i `console-core.js` — same Google Fonts CSS2-mønster som `core.js` sin eksisterande `injectGoogleFonts()` (ikkje delt kode, sidan Console aldri lastar `core.js`), men EIN delt `<link>`-node som byggjast på nytt frå alle aktive forhandsvisingar samstundes (nettside display/body + Workspace display/body kan alle vere synlege parallelt).

Kvart Display-font/Brødtekst-font-felt i både "Nettside"- og "Workspace"-fanen fekk eit nytt `<p>`-forhandsvisingselement rett under, styrt av feltet sin faktiske verdi — oppdaterer live på tasting, og etter at fontpar-snarvegsknappane eller "Nullstill"-knappen set verdiar programmatisk (desse kallar ein rein oppdateringsfunksjon, ikkje bind-funksjonen, slik at gjentekne klikk ikkje stablar opp fleire hendingslyttarar på same felt). Ingen automatisert testdekning finst for Console frå før (kjend, dokumentert avgrensing) — verifisert med `node --check` + manuell kodegjennomgang, ikkje ein live nettlesarrunde (krev ekte superadmin-OTP-innlogging).

Cache-bust: `console-core.js?v=110→111`. `VIBEVERK_VERSION` 0.36.6 → 0.37.0 (ny funksjonalitet, MINOR).

## 0.36.6 — 2026-07-16

### Workspace: fjerna "Del data mellom enheter"-knappen frå Innstillinger (reell overskrivingsrisiko, ikkje berre eit copy-problem)

Brukar rapporterte at knappen (retta til plain-språk i 0.36.4) var forvirrande — trudde ho måtte klikkast — og spurde om ho kunne overskrive nyare data frå andre einingar. Stadfesta mot faktisk kode (`core.js`): svaret er JA, reell risiko, ikkje berre ei kjensle:

- Normal drift skjer HEILT automatisk: kvar endring vert skriven til Supabase innan 300ms medan innlogga (`_flushSync`), og siste versjon vert henta frå Supabase ved kvar innlogging (`hydrateFromSupabase`). Ein vanleg admin treng ALDRI trykke denne knappen.
- Knappen sjølv gjorde ingen samanlikning mot kva som faktisk ligg i Supabase no — ho tok berre det som alt låg i DENNE nettlesaren sitt lokale mellomlager og skreiv det rått over, ingen tidsstempel-sjekk, ingen `confirm()`-åtvaring. Om ei anna eining/admin hadde gjort endringar medan denne fana var open, ville eit klikk stille overskrive dei nyare endringane med den eldre, lokale kopien.
- Det eine legitime bruksområdet (data strandar lokalt viss auth-sesjonen mista kontakt med Supabase midlertidig) er eit sjeldan, teknisk unntakstilstand ein vanleg admin uansett ikkje kan vite om dei er i — feil grensesnitt for sjølvbetjening uansett.

**Avgjort av brukar: fjern heilt, ikkje berre legg til ei åtvaring.** Kortet, knappen og click-handler'en er fjerna frå `module-settings.js` (var berre nokre linjer — ingen andre modular/testar refererte elementa).

Alle testar grøne (533 OK / 157 OK, dei to kjende, pre-eksisterande feila uendra). Cache-bust: `module-settings.js?v=10→11`. `VIBEVERK_VERSION` 0.36.5 → 0.36.6, `console-core.js?v=109→110`.

## 0.36.5 — 2026-07-16

### Workspace: breiare sveip etter intern fagsjargong + eit reelt modulnamn-avvik

Brukar ba om eit breiare sveip etter interne produktnamn (Supabase/Resend/Console/o.l.) i brukarvend tekst på tvers av alle tre flatene, etter 0.36.4-funnet. Ein Explore-agent søkte gjennom alle `module-*.js`, `core.js`, `components.js`, `workspace/*` og `console/*` — stadfesta at Console/Web-admin sine offentlege sider er reine (ingen treff utanom kodekommentarar og interne variabelnamn), og at Console sjølv sitt Supabase/RLS/broker-språk er OK sidan målgruppa der er Vibeverk-operatørar, ikkje sluttkundar.

To reelle attverande jargong-treff, begge stadfesta og retta:
- `module-settings.js` sin "Del data mellom enheter"-knapp viste framleis "Synkroniserer N nøklar…" ved klikk (0.36.4 retta berre den alltid-synlege hint-teksten, ikkje denne klikk-tidsstatusen) — forenkla til "Laster opp data…", fjerna den no-ubrukte nøkkel-teljinga.
- `workspace-core.js` sin innloggingsflyt viste "Synkroniserer data…" medan data vart henta frå Supabase etter innlogging — endra til "Henter dataene dine…".

**Eige funn frå brukar sitt spørsmål 2 (er "E-postsvar"-kortet gøymt om modulen er av?)**: kortet sjølv forsvinn ALDRI (viser alltid for admin, uavhengig av `crmFull`), men var stadfesta å ha eit ekte innhaldsavvik — teksten sa alltid "Kontakt, Booking og Tilbud" sjølv om `intranettFeatures.booking`/`.quote` er av som standard (kun `.contact` er på som standard) for den einskilde kunden. `emailProviderCard()` bygger no lista dynamisk frå faktisk aktiverte `intranettFeatures`-flagg i staden for å hardkode alle tre modulnamna.

Alle testar grøne (533 OK / 157 OK, dei to kjende, pre-eksisterande feila uendra). Cache-bust: `module-settings.js?v=9→10`, `workspace-core.js?v=18→19`. `VIBEVERK_VERSION` 0.36.4 → 0.36.5, `console-core.js?v=108→109`.

## 0.36.4 — 2026-07-16

### Workspace: `module-settings.js` — fjerna intern fagsjargong sluttkunden ikkje kan forstå

Brukar sjekka 0.36.3 sine hint-tekstar live og oppdaga eit anna, meir alvorleg funn same stad: to KORT lenger nede på Innstillinger-sida ("E-postsvar" og "Synkronisering") brukte internt tekniske namn ein sluttkunde-admin ikkje har nokon føresetnad for å forstå:

- **"Synkronisering"-kortet**: nemnde "Supabase" (backend-databasen) direkte i både brødtekst og knappetekst — brotsverk mot `copy-style-guide.md` sin uttrykkelege "sync/synkronisere → oppdatere/hente på nytt"-regel. Omdøypt heile kortet til "Del data mellom enheter", brødteksten skildrar no verknaden ("blir synlig når dere logger inn fra en annen enhet") i staden for mekanismen, knappen heiter no berre "Last opp data".
- **"E-postsvar"-kortet**: nemnde "(Vibeverk/Resend)" — ein tredjeparts e-post-API-leverandør sluttkunden aldri har høyrt om — og omtalte kunden i tredjeperson ("denne kunden") i staden for direkte tiltale ("dere"). Begge retta.
- **Eige, sjølvfunne følgjefunn under fiksen**: 0.36.3 sin eigen nye hint for "Bedriftsnavn" nemnde "Console" — Vibeverk sitt interne superadmin-verktøy, som sluttkunden aldri har tilgang til eller kjennskap til. Same feilklasse, retta i same slag ("Kan bli overstyrt hvis Vibeverk har satt et eget arbeidsområdenavn for dere").

Alle testar grøne (533 OK / 157 OK, dei to kjende, pre-eksisterande feila uendra). Cache-bust: `module-settings.js?v=8→9`. `VIBEVERK_VERSION` 0.36.3 → 0.36.4, `console-core.js?v=107→108`.

## 0.36.3 — 2026-07-16

### Workspace: forklaringstekst-runden held fram (Punkt 0, vidareføring) — `module-settings.js`

Neste steg etter 0.36.2 (som dekte module-users/kb/notes/orgdrift). Ein Explore-agent kartla dei resterande, ikkje-gjennomgåtte Workspace-modulane (workspaceship, tasks, contact, booking, links, quote, mediabank-internal, dashboard, settings, announcements) og fann to reelle hol, begge i `module-settings.js` sitt "Workspace"-kort — stadfesta mot faktisk kode før fiks:

- **"Bedriftsnavn"**: hadde ingen forklaring av at verdien vert vist i sidepanelet for ALLE brukarar i Workspace (`workspace-core.js` sin `buildShell()`), og at han vert stille overstyrt av eit arbeidsområdenamn sett i Console dersom det finst — ein admin kunne endre feltet og ikkje forstå kvifor ingenting synleg skjedde.
- **"Kontakt-e-post"**: same feilklasse som tidlegare funne "AI-samandrag"-felt — stadfesta via full repo-grep at `contactEmail` KUN vert lagra og aldri lese nokon annan stad i kodebasen (ikkje reply-malar, ikkje offentleg side, ikkje noka anna admin-vising). Feltet såg ut som ei fungerande innstilling, men gjorde reelt sett ingenting.

Resten av dei kartlagde modulane vart funne allereie tilstrekkeleg forklarte (`module-mediabank-internal.js` har alt ei eiga "Om mediebanken"-forklaringsboks, `module-announcements.js` sitt "viktig"-flagg seier alt kva det gjer) eller har ingen skjemafelt med skjult konsekvens (workspaceship, tasks, contact, booking, links, quote, dashboard).

`module-settings.js` sin lokale `field()`-hjelpar fekk same valfrie `hint`-parameter (attgjenbrukar `.i-hint`-CSS-klassen frå 0.36.2) som orgdrift-modulen fekk førre runde.

Alle testar grøne (533 OK / 157 OK, dei to kjende, pre-eksisterande feila uendra). Cache-bust: `module-settings.js?v=7→8`. `VIBEVERK_VERSION` 0.36.2 → 0.36.3, `console-core.js?v=106→107`.

## 0.36.2 — 2026-07-15

### Workspace: forklaringstekst-runden held fram (Punkt 0, vidareføring)

Neste steg etter Web-admin (0.36.1) — Workspace, kartlagt av same Explore-agent-runde. Viktig strukturell skilnad frå Web-admin/Console: Workspace-modulane byggjer stort sett rå HTML for skjemafelt sjølv (lokale `field()`/`input()`/`select()`/`combo()`-hjelparar per modul), ikkje `C.field({hint,help})` frå components.js — så denne runden kravde å leggje til ein ny, valfri `hint`-parameter på dei lokale hjelparane i `module-orgdrift.js`, pluss ein ny delt `.i-hint`-CSS-klasse i `workspace/index.html`, før sjølve tekstane kunne leggjast til.

- **`module-users.js`**: "Rolle"-feltet i inviter-skjemaet hadde ingen forklaring av kva Admin/Redaktør/Medlem faktisk kan gjere — ny hint stadfesta mot den faktiske rettigheitsmatrisa i `docs/architecture/roles-and-tenants.md`.
- **`module-kb.js`**: **reelt feilaktig, ikkje berre uklart** — samandrag-feltet var merkt "(valgfritt · AI-kontekst)", men det finst ingen AI-funksjon i heile kodebasen (stadfesta i `docs/project/CURRENT_STATE.md` "Not implemented"). Samandraget er i røynda ei vanleg, synleg uthevd boks øvst i artikkelen OG del av søkjematchinga — retta label og lagt til ein hint som skildrar det faktiske, verifiserte biletet.
- **`module-notes.js`**: same "AI-sammendrag"-påstand i eit notat-felt — men her er feltet stadfesta HEILT ubrukt (lagra, aldri vist, aldri del av søk noko stad i fila). Fjerna den feilaktige AI-påstanden frå placeholderen; feltet sjølv står urørt (ikkje fjerna denne runden, sidan det er ei separat avgjerd om ein ubrukt, lagra verdi skal fjernast heilt).
- **`module-orgdrift.js`**: fire felt — "Backup" i Ansvar-editoren (kunne lesast som datasikkerhetskopi, betyr faktisk vikarperson), "Kritikalitet" (konsekvens usynleg frå feltet — brukast til Dashboard-teljing og søkjefilter), "Beløpsgrense" (uklart om handheva eller berre ei hugseregel — no eksplisitt sagt at han ikkje er handheva noko stad), "Integrert med" (brukast til søkjefilterchips, ikkje sagt før).

Alle testar grøne (533 OK / 157 OK, dei to kjende, pre-eksisterande feila uendra). Cache-bust: `module-users.js?v=4→5`, `module-kb.js?v=6→7`, `module-notes.js?v=1→2`, `module-orgdrift.js?v=2→3`. `VIBEVERK_VERSION` 0.36.1 → 0.36.2, `console-core.js?v=105→106`.

## 0.36.1 — 2026-07-15

### Web-admin: forklaringstekst-runden held fram (Punkt 0, vidareføring)

Starta neste steg i ROADMAP punkt 0 ("generelle tooltips overalt", opportunistisk modul for modul) — no Web-admin (redigeringspanelet), ikkje sjølve den offentlege nettsida. Kartla fyrst kva som faktisk manglar via ein Explore-agent på tvers av alle `module-*.js` og `core.js` sine admin-seksjonar, retta dei to reelt uklare felta som kom fram:

- **`module-chat.js`**: chat-innstillingane sitt fargefelt "Bakgrunn (admin)" fortalde ikkje KVA UI-element det faktisk fargelegg (samtalevisinga i Web-admin sin eigen Chat-fane, `#vwca-msg-list`) — omdøypt til "Bakgrunn (samtale i admin)".
- **`core.js`**: footer sitt "Copyright-tekst"-felt hadde "tomt = genereres automatisk" berre som placeholder-tekst, som forsvinn med det same nokon skriv eller ein verdi alt finst — flytta til ein varig `hint`, stadfesta mot faktisk fallback-logikk (`components.js:626`: tomt felt → «© [år] [firmanavn]»).

Resten av Web-admin (booking/tilbud/referanser/faq/mediebank/crm) vart kartlagt og funne allereie tilstrekkeleg dekka frå tidlegare rundar. Workspace sine tilsvarande funn (brukarrolle-forklaring, KB/notat sine "AI-samandrag"-felt, orgdrift sine fleire uklare felt) står att som neste steg — Workspace bruker i stor grad EIGNE, enklare feltbyggjarar utan hint/help-støtte (ikkje `C.field()`), så den runden krev meir enn berre å leggje til ein parameter.

Alle testar grøne (533 OK, dei to kjende, pre-eksisterande feila uendra). Cache-bust: `module-chat.js?v=16→17`, `core.js?v=49→50`. `VIBEVERK_VERSION` 0.36.0 → 0.36.1, `console-core.js?v=104→105`.

## 0.36.0 — 2026-07-15

### Fokuspunkt-editor: sekundær-førehandsvisingar for bilete brukt fleire stader (Aktuelt, Referanser)

Løyser det opne "aspect-ratio-mismatch"-funnet frå same dags UX-review (sjå 0.35.0): redigeringsverktøyet for fokuspunkt lova før eitt fast forhold (16:9) som ikkje matcha nokon av dei verkelege visingane for to bilete som faktisk vert vist fleire stader med ulikt forhold.

**Design, gjennomgått av Arkitekt-agenten**: behald éin lagra fokuspunkt-posisjon per bilete (ingen datamodell-endring) — men vis no BÅDE hovudboksen (drabar, det strengaste/tettaste forholdet) OG éin eller fleire ikkje-redigerbare sekundærboksar som speglar SAME posisjon live i den andre verkelege visinga, slik at admin ser konsekvensen for begge før dei lagrar. Reint additivt: `imageField()`/`imgField()` fekk to nye valfrie parameter (`aspectLabel`, `previews`) — alle 8 andre biletfelt på sida (hero, om oss, tjenester, booking, FAQ, scrollbanner, mediebank, kunngjeringar) er urørte, framleis éin boks, byte-identisk med før.

- **Aktuelt-bilete**: hovudboks = forsidekort (220/180 ≈ 1,22), sekundær = artikkelside (16/7). Mobil-kortet sitt kontinuerleg flytande forhold er bevisst IKKJE med som ein eigen boks — eit "representativt" tal ville vore misvisande presist for noko som ikkje har éin fast verdi.
- **Referanser-bilete**: hovudboks = rutenett-kort (210/140 = 1,5, basert på grid sin smalaste kolonnebreidde), sekundær = detaljside (16/9).
- **Reell bug retta undervegs**: Referanser sin detaljside kalla `coverImg(img, "")` med TOM CSS-klasse, så fokuspunktet gjorde bokstaveleg tala ingenting der. Ny klasse `rf-detail__photo` følgjer same `has-credit`-samansettingsmønster som `nfc__photo`/`article__media` alt bruker.

**UX/Mobile Reviewer-gjennomgang** av heile endringa: ingen blokkerande funn. Fire billige polish-fiksar gjort same runde: forklarande hint-tekst når sekundærboksar finst (elles kunne admin tru dei er eit ekstra bilete å laste opp, eller prøve å dra dei), `aria-label` på hovudboksen nemner no kva samanheng ho gjeld, border-radius retta til å matche hovudboksen (var 8px vs. 10px), og sekundærboksane viser no same "Ingen bilde"-melding som hovudboksen i tomt-tilstand i staden for ei uforklart tom ramme.

Testar utvida (`test.js`): sekundærboks-wrapper + rett `data-aspect` for Aktuelt/Referanser, live object-position-synkronisering ved piltast-styring, regresjonsvakt for at eit vanleg biletfelt (hero) IKKJE får nokon ekstra wrapper, og at Referanser-detaljsida sitt bilete no faktisk har ein verkande CSS-klasse. Alle testar grøne (533 OK, dei to kjende, pre-eksisterande feila uendra).

Cache-bust: `components.js?v=14→15`, `core.js?v=48→49`, `module-references.js?v=7→8`. `VIBEVERK_VERSION` 0.35.1 → 0.36.0, `console-core.js?v=103→104`.

## 0.35.1 — 2026-07-15

### RLS-gap lukka: full backup-eksport er no admin-gjerda i databasen, ikkje berre i UI

Oppfølging av same dags Privacy/Compliance-funn (sjå 0.35.0-oppføringa og CURRENT_STATE.md): `buildBackupPayload()` i `core.js` var nåbar frå kva som helst innlogga rolle sin nettlesarkonsoll, sidan RLS SELECT på dei ni backup-tabellane med vilje er `USING(true)` for `authenticated` (naudsynt for vanleg CRM/oppgåve/kunngjerings-blaing — urørt). "Sikkerhetskopi"-fana er berre synleg for admin i UI-et, men ingenting i databasen handheva det for sjølve eksporten, i motsetnad til restore-sida som alt hadde eit `is_admin_or_owner()`-gjerde.

**Avklart med brukar før bygging**: dette lukkar inkonsistensen (funksjonen *utgjev seg for* admin-only, no faktisk handheva), men kan IKKJE hindre ein teknisk kyndig member/editor frå å spørje kvar av dei ni tabellane direkte sjølv og setje saman same resultat for hand — det krev at RLS held fram med å vere ope for normal blaing, eit alt stadfesta rollevalg. Snevrare, men reelt scope.

**Nytt**: `export_backup_tables()` (`supabase/migrations/20260715140000_export_backup_tables_rpc.sql`) — same `is_admin_or_owner()`-gjerde og REVOKE/GRANT-mønster som `restore_backup_tables`, `SECURITY DEFINER STABLE`. `core.js` sin `fetchAllRows()`/9-separate-kall-tilnærming bytt ut med éin `fetchAllTables()` som kallar RPC-en via `_sb.rpc("export_backup_tables")` når Supabase er konfigurert (uendra fallback til tomme tabellar elles, som i testmiljø).

**Gjennomgått** av ein general-purpose-agent som stand-in for Security Auditor (same, alt kjende avgrensing som for `verify_tenant_routing`/`configure_tenant_smtp` — `.claude/agents/vibeverk-security-auditor.md` finst ikkje i Claude-harnesset) — ingen funn, godkjent for deploy. **Deploya til produksjon** (`npx supabase db push --linked`) og stadfesta direkte (ikkje berre "Success"-meldinga): `has_function_privilege('authenticated', ..., 'EXECUTE')` = true, same for `anon` = false, `SECURITY DEFINER` + `STABLE` bekrefta via `pg_proc`.

Alle testar grøne (dei to kjende, pre-eksisterande feila uendra). `core.js?v=46→47` (alle fire flater).

## 0.35.0 — 2026-07-15

### Fiksar frå UX/Mobile Reviewer- og Privacy/Compliance-gjennomgangane (bildefokuspunkt + backup/restore)

Handsama dei trygge, sjølvstendige funna frå dei to reviewa som vart køyrde tidlegare same dag. Dei to funna som treng ei eiga arkitektur-/tryggingsavgjerd (aspect-ratio-mismatch mellom editor og faktisk visning; RLS-gapet som lèt `member` lese heile backup-datasettet via konsoll) er **ikkje** rørt her — dei krev høvesvis ei layout-avgjerd og ei eigen migrasjon gjennom Security Auditor + eksplisitt godkjenning, og står att.

**Bildefokuspunkt (`core.js`, `components.js`, `test.js`):**
- **Inert akse nullstilte stille den lagra posisjonen.** Når utsnittvindauget alt fyller 100 % av breidda ELLER høgda (typisk breie 3:1/21:9-mål som FAQ/Booking mot eit vanleg liggjande foto), kunne den aksen ikkje flytte seg synleg — men både drag og piltastar skreiv likevel ein ny verdi til lagringa for den aksen (tvang han til midten, sjølv om eit tidlegare lagra, ikkje-sentrert punkt fanst). Retta til å behalde eksisterande verdi på ein inert akse i staden for å overskrive han. Piltastane hadde i tillegg ei anna åtferd enn draging (kunne endre lagra verdi der draging ikkje kunne) — no konsistente.
- **`role="slider"` mangla `aria-valuenow`/`aria-valuemin`/`aria-valuemax`.** Kravd av WAI-ARIA for denne rolla; nokre skjermlesarar melder kontrollen som verdilaus utan han sjølv med `aria-valuetext` til stades. Lagt til (x-aksen som formell verdi, `aria-valuetext` ber framleis den fulle skildringa av begge aksane).
- **Alt-tekst vart kasta bort i tre av fire kontekstar.** `App.media.resolveImage()` returnerer `.alt` frå biletfeltet sitt eige alt-tekst-felt, men `module-booking.js`, `module-faq.js` og `workspace/module-announcements.js` (to stader) hardkoda `alt=""` uansett. Skjermlesarbrukarar fekk difor ingen skildring av desse bileta trass i at admin hadde fylt ut alt-teksten. `components.js` sin eigen `coverImg()`-hjelpar (brukt av Referanser/Aktuelt) gjorde det alt riktig — retta dei fire manglande stadene til å matche.
- **`.imgfield__preview` sin tomme-bilde-bakgrunn var ein hardkoda hex-verdi** (`#15171a`) i staden for `var(--color-alt)`, i strid med prosjektet sin eigen fargevariabel-konvensjon — retta i `index.html`, `admin/index.html` og `workspace/index.html`.
- **Fjerna reelt daud kode**: `adminBackupCustomer()` (den "enklare" Sikkerhetskopi-fana for ikkje-admin-roller) var uoppnåeleg via noverande fane-/kategori-routing (`allowedCategoriesForRole()` gjev aldri kategorien "innstillinger" til editor/member, som var den einaste vegen inn til denne fana) — stadfesta ved å følgje heile kjeda, ikkje anteke. Sjølve funksjonen, fane-pushet og rute-oppslaget er fjerna.
- Testar oppdaterte (`test.js`): éin eksisterande test kodifiserte den gamle, feilaktige åtferda (venta at ArrowDown endra lagra posisjon sjølv når vindauget var vertikalt inert) — retta til å vente den no korrekte, inerte åtferda, pluss ein ny test som stadfester det same for musedrag.

**Backup/restore (`core.js`) — låg-risiko copy-tillegg, ikkje RLS-endringa:**
- Info-teksten over "Last ned sikkerhetskopi" nemner no eksplisitt at fila inneheld personopplysningar i rein tekst, og bør oppbevarast trygt/slettast etter bruk.
- Import-`confirm()`-teksten (full Sikkerhetskopi-fana) nemner no eksplisitt at gjenoppretting kan bringe attende data som seinare er sletta (t.d. etter ein GDPR-sletteførespurnad) — det var det einaste reelt manglande Tier B-punktet reviewen fann.

**Console (`console-core.js`):** `VIBEVERK_VERSION` 0.34.9 → 0.35.0.

Alle testar grøne (dei to kjende, pre-eksisterande feila uendra). Cache-bust: `core.js?v=45→46`, `components.js?v=12→13`, `module-booking.js?v=14→15`, `module-faq.js?v=7→8`, `module-scrollbanner.js?v=7→8`, `module-announcements.js?v=8→9`, `console-core.js?v=101→102`.

## 0.34.9 — 2026-07-15

### Tre brukarrapporterte fiksar: fleire fontpar, Tjenester-kortstorleik, eige sitatfelt i Referanser

**1. Console: fleire fontkombinasjonar.** `FONT_PAIRS` i `console-core.js` utvida frå 5 til 11 par (nye: Bricolage Grotesque+Inter, DM Serif Display+DM Sans, Libre Baskerville+Lato, Archivo+Roboto, Outfit+Plus Jakarta Sans, Cormorant Garamond+Mulish) — brukt i både Web- og Workspace-fanen sine fontpar-snarvegar. Alle fontnamn lastast dynamisk via Google Fonts (ingen statisk fontliste å halde synkronisert), så nye par er trygt å leggje til.

**2. Tjenester-kort var for små til å vise maks tillate tekst.** `SERVICE_CARD_TEXT_MAX = 200` (`core.js`, innført 2026-07-12 nettopp for at heile teksten alltid skal få plass synleg) var likevel for stor for `.card__text` sitt visuelle klipp (`index.html`) — 5 linjer/7.5em var for lite til å vise 200 teikn i dei smalaste kortbreiddene, som motsa heile poenget med tegngrensa. Dobla til 10 linjer/15em.

**3. Referanser: sitatfunksjonen var éin-eller-anna, ikkje kombinerbar.** Gammal modell: éitt tekstfelt + eit «Vis som sitat»-avkryssingsboks som styrte HEILE visningsmodusen — kunne ikkje ha vanleg tekst OG eit sitat samstundes, og brukaren opplevde det som at sitatet «bare la «» over teksten». Ny modell (`module-references.js`): eige `quote`-felt (rik-tekst, som `text`) som vises i eiga sitatboks UNDER tekstboksen, kan brukast åleine eller saman med vanleg tekst. Navn/tittel-felta for den som uttaler seg er no alltid synlege (med hint om at dei berre vises saman med sitatet), i staden for skjult bak avkryssingsboksen. **Legacy-migrering**: gamle referansar med `isQuote:true` normaliserast ved lesing (`text` → `quote`, aldri skrive attende) slik at dei framleis viser korrekt utan at nokon må redigere dei på nytt.

Testar oppdatert (`test.js`: `#rf-isquote` → `#rf-quote`-felt, assertion endra frå eit `isQuote`-flagg til faktisk sitat-innhald). Alle testar grøne (dei to kjende, pre-eksisterande feila uendra). `module-references.js?v=6→7` (index.html + admin/index.html), `console-core.js?v=100→101`.

## 0.34.8 — 2026-07-15

### Console: forklaringstekster for "Web" og "Analyse"-fanene (Punkt 0, vidareføring)

Held fram opne-slutta gjennomgangen frå 0.33.4/ROADMAP "Next" punkt 0 — no dei to attverande Console-fanene (Web, Analyse) som mangla enkelte forklaringar. Bevisst lett handsama, ikkje ein full ny audit-runde: Console er superadmin-verktøy, ikkje kundevendt, så berre dei genuint sjargong-tunge felta fekk noko lagt til.

- **Web-fana**: "Meta-beskrivelse", "Delingsbilde (OG-bilde)" og "Favicon-URL" fekk kvar ein `help`-ikon som forklarer kva feltet faktisk gjer (Google-søk-tekst, deling-på-sosiale-medium-bilde, nettlesar-fane-ikon) — desse tre var reint tekniske SEO-omgrep utan noka forklaring før.
- **Analyse-fana**: ny intro-tekst i fieldsetet ("koblar kunden sitt nettsted til Plausible Analytics …") pluss `help` på domenenamn-feltet — før var det ingenting som forklarte kva "Plausible"-felta i det heile gjorde.
- **Workspace-fana**: to `weights`-felt for font mangla dei same "For overskrifter"/"For brødtekst"-hint-teksta som allereie fanst på det tilsvarande Web-fana sitt par — retta for konsistens.

Web-admin og Personvern-fana vart sjekka og funne allereie tilstrekkeleg forklarte frå tidlegare rundar — ikkje endra. Console sine andre attverande stykke (generelle Workspace/Web-admin-tooltips utover destruktive handlingar) er framleis opent, sjå ROADMAP.

## 0.34.7 — 2026-07-14

### Console: renumbered onboarding checklist as one flat, linear sequence

Found live while onboarding the Sunnvask demo: the old `1, 2, 3, 3b, 3c, 4, 4b, 5, 6` lettered-substep scheme was confusing to follow in practice, and two real gaps discovered live during that same onboarding had no card at all — deploying the customer's own Edge Functions (`manage-user`/`send-reply`, easy to miss since `db push` never deploys these) and setting up the customer's actual site/branding configuration (company name, colors, text, modules) before inviting the real admin.

New flat sequence (1–11): register → create Supabase project → connection+keys (merged former 3/3b) → run migrations → verify schema → **deploy Edge Functions (new)** → set up SMTP → **set up customer configuration (new, points to the "Produkt"/"Web"/"Workspace"/"Modular"/"Analyse"/"Personvern" tabs)** → point hostname at Vercel + verify routing (merged) → invite admin → activate. All existing preconditions/gates are unchanged (schema verification is still required before routing verification and before the invite, exactly as before) — this is a display/ordering and content change only, not a change to any actual gate logic. Server-side error messages in `tenant-admin/index.ts` updated to reference the new step numbers.

`docs/architecture/tenant-onboarding-runbook.md` rewritten to match the same 1–11 numbering exactly.

## 0.34.6 — 2026-07-14

### Console: auto-fetch project keys, client-side migration-command generator

Two quality-of-life additions to the onboarding checklist, discussed with the user as "how much of this could Console do for me" — scoped deliberately narrow (see below for what was explicitly rejected).

- **New action `fetch_tenant_project_keys`**: merges "3. Kopling" + "3b. Service_role-nøkkel" into one step. The operator still creates the Supabase project and pastes in its URL by hand (unchanged — still deliberately not automated, see ADR-0010), but no longer has to separately copy the `anon` and `service_role` keys out of the Dashboard. Uses the same platform-level Management API token `configure_tenant_smtp` already holds — this doesn't expand that token's reach, it's still a read-only fetch of a project's own key set. Same `CONTROL_PLANE_PROJECT_REF` self-target guard as `configure_tenant_smtp`. Console's manual paste-in forms remain available (collapsed under "…eller lim inn nøklane manuelt") as a fallback.
- **Migration-command generator**: a client-side-only helper under step "4" — paste the full connection string Supabase's own Dashboard shows (with the plain password in it), and it renders the exact, correctly URL-encoded `npx supabase db push --db-url "..."` command. Never sent anywhere — pure string transformation in the browser. Directly addresses real confusion hit this session (unencoded special characters in a password breaking the connection string, uncertainty about which parts were placeholders).

**Explicitly not built, and why**: actually *running* the migrations from Console (via the Management API's SQL-execution endpoint) was considered and deliberately deferred — it would need to bundle migration SQL into the Edge Function itself (no repo access at runtime), replicate `supabase db push`'s own migration-history tracking, and introduces a qualitatively new capability (arbitrary SQL execution against any customer project via a platform-wide credential) that the rest of this file avoids. Automating Supabase project *creation* itself remains rejected per ADR-0010 (would need an org-wide, billing-capable token).

## 0.34.5 — 2026-07-14

### Fix: 0.34.4 broke every invite outright ("Berre admin kan endre rolle")

Regression introduced by 0.34.4's own fix, caught immediately during live re-testing: making `handle_new_user()` also fire `UPDATE public.users SET role=...` from inside a trigger meant that update now hit `prevent_self_role_escalation()` (the guard that stops a user from self-promoting their own role) — which unconditionally rejects any role change with no authenticated admin session, and GoTrue's internal update has no session at all. Every `inviteUserByEmail()` call started failing outright with HTTP 500 `{"code":"P0001","message":"Berre admin kan endre rolle"}` as soon as GoTrue tried to set `invited_at`, rolling back the whole transaction (surfaced in Console as the unhelpfully empty `Invitasjon feila: {}`).

Fixed by letting the guard skip only when the update is nested inside another trigger (`pg_trigger_depth() > 1` at the point it fires) — a direct client update via PostgREST always fires this trigger at depth 1, so the original self-escalation protection stays fully intact; only the system-internal role-sync now gets through.

New migration: `supabase/migrations/20260714133000_fix_role_escalation_guard_for_system_trigger.sql`. Applied to production and staging, verified end-to-end directly against production's real Auth API (fresh invite → HTTP 200 → `public.users.role` correctly `'admin'` with no manual patch needed) — test user cleaned up afterward.

## 0.34.4 — 2026-07-14

### Fix: invited admins landed as `role='member'` instead of `'admin'`

Found while live-testing 0.34.3's fixed invite flow — a fresh invite's `auth.users.raw_user_meta_data.role` was correctly `"admin"`, but the resulting `public.users.role` was stored as `'member'`. Two real, pre-existing gaps in the baseline customer schema (`supabase/migrations/`), not introduced this session, just never surfaced until a fully-automated invite flow existed with nobody manually correcting roles afterward:

1. **`handle_new_user()` timing bug**: the trigger fired `AFTER INSERT ON auth.users` and only trusted `raw_user_meta_data->>'role'` when `NEW.invited_at IS NOT NULL` (a deliberate anti-self-registration-to-admin guard). But GoTrue's `admin.inviteUserByEmail()` creates the row first and sets `invited_at` in a *separate* follow-up update — so at insert-time `invited_at` was still `NULL` even for a genuine invite, and role always fell through to `'member'`. Fixed by also firing the trigger `OR UPDATE OF invited_at` and updating role at that point instead — same security invariant (`invited_at` still never client-settable), just catching the right moment.
2. **Missing `service_role` grant on `public.users`**: same class of gap as ADR-0009's `store` fix — `service_role` had only `REFERENCES`/`TRIGGER`/`TRUNCATE`, no `SELECT`/`INSERT`/`UPDATE`/`DELETE`. This silently broke `generate_support_access`'s existence check (`tenantSrvSb.from("users").select(...)`, using the tenant's own service_role key), making it indistinguishable from "no admin user exists" — always a misleading 404 even when a real admin was present.

New migration: `supabase/migrations/20260714131500_fix_invited_role_timing_and_service_role_users_grant.sql`. Applied to both production (`clzczbyklgdtdhgjphup`) and staging (`syqnyfeponexmkdvnsga`) and verified directly (grant + trigger definition). Every future customer project picks this up automatically via the normal migration history.

Also did a one-time data repair (trigger briefly disabled, then re-enabled and confirmed) for the one real user this bug affected in production: `frode@hammerseth.com`'s `role` corrected from `'member'` to `'admin'`, matching their genuine invite metadata.

## 0.34.3 — 2026-07-14

### Fix: invite link skipped straight to Workspace instead of "set your password"

User-reported after 0.34.2's redirect fix landed: clicking the invite link now landed on the right domain, but went straight into Workspace with no chance to set a password — meaning the invited admin had a live session but no password, so they couldn't log in again later without another magic link.

Root cause: `workspace-core.js`'s `boot()` detected an invite/recovery flow by checking `window.location.hash` for `type=invite`/`type=recovery`. But `core.js` constructs the Supabase client with the (default) `detectSessionInUrl: true`, which reads and clears `location.hash` itself as soon as the client is built — and `core.js` loads and runs *before* `workspace-core.js` in `workspace/index.html`. By the time `boot()` checked the hash, it was already gone, so the flow silently fell through to the plain "has a session → go straight in" branch.

Fixed with a tiny inline script at the very top of `workspace/index.html`'s `<head>` (before the Supabase library and `core.js` even load) that captures the raw hash into `window.__vwAuthHash` if it looks like an invite/recovery redirect, untouched. `boot()` now reads that captured value instead of the live (possibly already-stripped) `location.hash`. `core.js`'s own session detection is unaffected — only our own "was this an invite?" check needed the earlier snapshot.

## 0.34.2 — 2026-07-14

### `configure_tenant_smtp` fixes found during live testing

Two real bugs found while testing 0.34.1 end-to-end against the `Test-vercel` dry-run tenant:

1. **PATCH failed outright (HTTP 400)**: Supabase Management API's `config/auth` endpoint expects `smtp_port` as a **string** (`"587"`), not a number — the initial implementation sent a number and every call failed. Also improved the error path to capture and log the actual response body instead of just the HTTP status, since the generic status alone cost a manual `curl` round-trip to diagnose.
2. **Invite email arrived but its link redirected to `localhost`**: a freshly provisioned tenant project defaults to `site_url: http://localhost:3000` and an empty `uri_allow_list`. GoTrue does not error when `redirectTo` (the tenant's real hostname, passed by `invite_tenant_admin`/`generate_support_access`) isn't in the allow-list — it silently substitutes `site_url` instead. `configure_tenant_smtp` now also sets `site_url` and `uri_allow_list` from the tenant's own `hostnames`, confirmed via the same follow-up GET pattern already used for the SMTP fields. This is exactly what the button's existing hint text already promised ("invitasjon/support-lenker faktisk kjem fram") — no Console copy change needed.

Both fixed and verified directly against the Management API before redeploying `tenant-admin`.

---

## 0.34.1 — 2026-07-13

### Automated shared-SMTP setup for tenant projects (`configure_tenant_smtp`)

Found immediately after shipping 0.34.0: every fresh tenant project defaults to Supabase Auth's built-in mailer (2 emails/hour, per `supabase/config.toml`'s `[auth.rate_limit]`), so `invite_tenant_admin`'s invite emails weren't reliably delivering. User asked whether this could be automated rather than requiring a manual per-tenant Supabase Dashboard step — confirmed yes, via Supabase's Management API (`PATCH /v1/projects/{ref}/config/auth`), documented specifically for the "one owner operating many customer sub-projects" case Vibeverk is in.

Designed by the Architect, reviewed by a general-purpose agent standing in for Security Auditor (4 findings, all fixed before deploy — none were blocking-severe, but all were real):
- Added an explicit guard rejecting `data_plane_url` pointing at `vibeverk-control`'s own project ref — this is the one action using a platform-wide credential rather than a per-tenant Vault key, so nothing else in the file would have stopped a mistaken/malicious tenant row from reconfiguring the control plane's own Auth SMTP.
- Added the `status !== "archived"` guard this action was missing (present on every comparable sibling action).
- Added `auditReject` calls on two precondition-failure paths that previously left no audit trail.
- Made the final `smtp_configured_at` bookkeeping write check its own error before claiming unconditional success (the identical gap already exists in `invite_tenant_admin`, not fixed there — noted as a known, non-blocking follow-up).

New action **`configure_tenant_smtp`** (Console step "3c", between the service_role key and schema verification — must run before `invite_tenant_admin`, or the invite "succeeds" without reliably delivering). Uses one shared, Vibeverk-branded sender (e.g. `noreply@vibeverk.no`) across every tenant for these operational emails (invite/reset/support-access) — deliberate: these go to the customer's own staff, not their customers, so there's no branding reason to require a per-tenant verified sending domain, which would reintroduce the exact onboarding friction this automates away. Always confirms the config actually landed via a follow-up GET, never trusts the PATCH response alone. `activate_tenant` gained a 5th precondition: `smtp_configured_at`.

**New credential shape for this codebase**: unlike every other cross-project action (which use a per-tenant Vault-stored `service_role` key), this uses a single **platform-level** Supabase Management API token plus a shared Resend API key, both as Edge Function secrets on `vibeverk-control`. User explicitly chose, with the tradeoff explained, a plain Personal Access Token from their own admin account for now (full org access, not scoped to tenant projects only) rather than a separate restricted service-account member — a deliberate "fast now, tighten later" call, not an oversight.

New migration: `supabase-control/supabase/migrations/20260713184846_add_smtp_configured_at.sql`.

**Follow-ups, not yet done**: scope the Management API token down to tenant-projects-only via a dedicated restricted Supabase org member (deferred by explicit user choice); fix the same unchecked-bookkeeping-write pattern in `invite_tenant_admin`; the still-open Privacy/Compliance pass on `broker_audit_log` email-as-PII (noted in 0.34.0) now also covers this action's audit entries.

**Deployed 2026-07-14**: migration applied to `vibeverk-control`, secrets stored, `tenant-admin` function deployed. One gotcha found while wiring secrets: `npx supabase secrets set` silently rejects (skips, no error) any env name starting with `SUPABASE_` — reserved for the platform's own injected vars. The Management API token secret is therefore `TENANT_MGMT_API_TOKEN`, not `SUPABASE_MANAGEMENT_API_TOKEN` as originally drafted; the code and this entry were updated to match.

## 0.34.0 — 2026-07-13

### Tenant admin-user bootstrap + operator support access

Found while dry-run testing the vibeverk-as-tenant migration: a freshly-provisioned tenant's own Supabase project has zero Auth users — nobody could log into Workspace/Admin for it until someone manually created a user via the Supabase dashboard. User asked for a real fix, plus a way for an operator to help a customer remotely without knowing their password. Explicitly considered and rejected: a standing/shared default-admin account — a persistent, undisclosed credential sitting inside a customer's *own* database is a real trust/compliance problem the moment anyone inspects their own `auth.users` table, and is a classic never-rotated-shared-secret risk besides.

Designed by the Architect, reviewed by a general-purpose agent standing in for the Security Auditor role (no blocking findings; two low-effort fixes applied — email case-normalization before lookups — and two "before a real paying customer" follow-ups noted below). Implemented:

- **`invite_tenant_admin`** (new `tenant-admin` action, Console step "4b"): sends a real Supabase invite to the customer's actual first-admin email, using the tenant's own Vault-stored service_role key (same cross-project pattern as `verify_tenant_schema`). Reuses the existing `handle_new_user()` trigger to create the `role='admin'` row — no hand-written insert. Sets `tenants.first_admin_invited_at` (new column, `supabase-control` migration `20260713175909`).
- **`activate_tenant`** now also requires `first_admin_invited_at` to be set — a tenant can no longer go live with literally no path for anyone to log in.
- **`generate_support_access`** (new action, Console "Support-tilgang" card): mints a genuinely time-limited Supabase magic-link for an *existing* real admin user, so an operator can help directly without a password and without any standing credential. Requires an admin user to already exist (points at `invite_tenant_admin` otherwise). Never persists the link/token itself — only that an operator requested access, for whom, and when, in `broker_audit_log`.
- **Workspace support-session banner**: when a magic-link redirect includes `?support=1` and a real session is confirmed, `workspace-core.js` renders a persistent banner ("Ein Vibeverk-supportøkt er aktiv på denne kontoen no.") — the only signal available to the customer, since the underlying Auth session is otherwise indistinguishable from a genuine login by that same user.

**Known follow-ups, not yet done** (per the security review, non-blocking for the current dry-run/staging tenant): (1) the support banner relies on an unmodified redirect URL surviving the trip through the operator's own hands — a server-recorded, authenticated-check signal would be more robust than a URL parameter alone; (2) no rate/anomaly alerting on repeated `generate_support_access` calls by one operator across many tenants; (3) email-as-PII in `broker_audit_log` still needs a Privacy/Compliance Advisor pass before a real paying customer, same open item as noted for `invite_tenant_admin`'s audit entries.

## 0.33.7 — 2026-07-13

### `verify_tenant_routing` can now re-verify already-active tenants

Follow-up to the schema-fingerprint grant fix above: the `vibeverk.no` tenant row is `status='active'` but has never had its routing verified (`routing_verified_at` was null, and `verify_tenant_routing` refused to run for anything but `status='provisioning'`). User asked whether it'd be reasonable to also allow this for active tenants, since a real customer will eventually need routing re-verified post-go-live too (DNS provider migration, hostname change) — the only alternative (temporarily reverting an already-live tenant back to `'provisioning'` just to run a diagnostic) is itself risky, since `resolve_tenant_by_hostname()` treats the two statuses differently.

Design by the Architect (read-only advisory pass), then implemented in `supabase-control/supabase/functions/tenant-admin/index.ts`:
- Status guard widened to `!== "provisioning" && !== "active"` (rejects only `archived`), mirroring the existing dual-status pattern already used by `update_tenant_hostnames` in the same file.
- Fixed a real bug the Architect caught before it shipped: the final `.update(...).eq("status", "provisioning")` would have silently written 0 rows for an active tenant once the top guard was loosened — now `.eq("status", tenant.status)`.
- On a **failed** re-verification, `routing_verified_at` is now only nulled for a still-`provisioning` tenant (unchanged, still gates `activate_tenant`) — for an active tenant it's left untouched, so a transient DNS hiccup doesn't wipe "last known good" history for a customer who is, in fact, still being served correctly. The audit log records every outcome regardless.
- Console copy (Tier A): step 5's hint now clarifies it's safe to re-run post-activation; step 6 no longer shows the misleading "sperra" framing for a tenant that's already active.

Reviewed by a general-purpose agent standing in for the "Vibeverk Security Auditor" role — `vibeverk-security-auditor`/`vibeverk-reviewer` have no `.claude/agents/*.md` file (only `.codex/agents/*.toml` equivalents), a standing, already-documented Claude-vs-Codex gap (see `CURRENT_STATE.md`, dated back to 2026-07-04), not something newly discovered this session. No HIGH/MEDIUM findings. One LOW finding fixed here: the final UPDATE had no row-count check (unlike every sibling action in this file), so a status change mid-flight (e.g. another operator archiving the tenant while the routing check's per-hostname fetch loop was still running) could have persisted nothing while the audit log still said "success" — now mirrors the sibling pattern (`update_tenant_hostnames`/`archive_tenant`), checking the row count and recording a distinct audit outcome + a 409 to the caller if the status moved out from under the call. A second LOW finding (an active tenant's routing re-verification is blocked by `schema_verified_at`, which `resolve_tenant_by_hostname()` doesn't actually require for active tenants) was left as a known, non-urgent quirk — not fixed.

**Follow-up needed, not yet done:** decide what to do about the missing `vibeverk-security-auditor`/`vibeverk-reviewer` agent definitions — either author them for real, or stop referencing them in CLAUDE.md/the handoff skill as if they exist. (See `docs/project/CURRENT_STATE.md` "Known limitations" — these exist as Codex-only `.codex/agents/*.toml` configs, a standing fact already documented as far back as 2026-07-04, not a fresh discovery.)

Tests unaffected (no application code touched — Edge Function + doc/console-copy change only). `?v=N` bumped: `console-core.js` (90→91). `VIBEVERK_VERSION` 0.33.6 → 0.33.7.

## 0.33.6 — 2026-07-13

### Fixed: `service_role` couldn't call `verify_schema_fingerprint()` on production

Part of the vibeverk-as-tenant migration work: set up `VIBEVERK_CONTROL_URL`/`VIBEVERK_CONTROL_ANON_KEY` env vars on the "vibeverk" Vercel project (the one at `vibeverk.vercel.app`, distinct from the local repo's linked `vibeverk-j1yg` canary project) and redeployed — confirmed the middleware + `api/tenant-config.js` tenant-resolution mechanism now works correctly (a real lookup against `vibeverk-control`, correctly rejecting the unregistered `vibeverk.vercel.app` hostname with a proper 404 instead of the earlier broken 500). Also added `vibeverk.no` as an (unverified, no real traffic yet — DNS still points at GitHub Pages) domain alias on that project, ahead of any future DNS cutover decision.

While re-verifying the existing (historically unverified, `status='active'`) `vibeverk.no` tenant row via Console's checklist, "Verifiser skjema" failed with "manglar verify_schema_fingerprint()?" even though the function existed on production. Root cause: both migrations that created it (`20260708212124_add_schema_fingerprint_rpc.sql`, `20260709193227_add_rls_check_to_schema_fingerprint.sql`) `REVOKE ALL ... FROM PUBLIC, anon, authenticated` but never explicitly `GRANT EXECUTE ... TO service_role` — same class of gap ADR-0008/ADR-0009 already documented (never assume `service_role` has a grant). Confirmed via `has_function_privilege('service_role', ..., 'EXECUTE')` = `false` on production. Fixed with `20260713162850_grant_service_role_schema_fingerprint.sql`, applied to production, re-verified `= true`. Console's "Verifiser skjema" now passes (`schema_ok`) for the `vibeverk.no` tenant row.

Still open: `routing_verified_at` remains unverified for this tenant row — `verify_tenant_routing` requires `status = 'provisioning'`, but this row is already `'active'` (set outside the normal checklist flow, historically). Deciding how to handle that (temporarily revert to provisioning, or add a new action variant for already-active tenants) is deferred — no DNS cutover should happen without resolving this first. **Resolved same day, see 0.33.7 above.**

No application code touched by this entry's SQL-only fix beyond the migration itself. `VIBEVERK_VERSION` 0.33.5 → 0.33.6 (no `console-core.js` cache-bust needed — no JS file changed in this round).

## 0.33.5 — 2026-07-13

### Copy-clarity is now a standing rule, not a one-off sweep

User asked (2026-07-13) for the copy-clarity discipline from phases 1–4 to be made continuous going forward, applied at the point of writing any new/changed user-facing text rather than swept up later. Doc/process-only change, no application code touched:

- `CLAUDE.md`'s "User-facing text" section now states explicitly this is a standing requirement on every task, however small — same expectation as cache-busting or keeping tests green.
- `.claude/agents/vibeverk-ux-mobile-reviewer.md` gained a new "Copy clarity" checklist section, checking new/changed text against `docs/architecture/copy-style-guide.md`, Tier A/B/B-inline usage, and whether a surface is missing shared CSS a new copy element depends on — so future UX/Mobile Reviewer passes catch this automatically, not just visual/responsive issues.
- `docs/architecture/copy-style-guide.md` itself reworded to distinguish the original four-phase catch-up sweep (now historical context) from the ongoing, standing rule — the rollout order section is relabeled accordingly.

`VIBEVERK_VERSION` 0.33.4 → 0.33.5, `console-core.js?v=89→90` (version-display only, no functional change).

## 0.33.4 — 2026-07-13

### Copy-clarity initiative (punkt 0) — phase 4, slice 1: Console's feature-toggle tooltips

Fourth (and, per the style guide, open-ended/opportunistic) step of the rollout: general inline tooltips for non-obvious fields, not just destructive actions. This round's bounded slice: Console's "Modular" section, where 25 feature-flag checkboxes (`FEAT_LABELS`/`IFEAT_LABELS` — controlling everything from Booking/Chat/CRM to internal Workspace features) had short, sometimes cryptic labels (e.g. "Native e-post" for `crmFull`) with **zero explanation of what any of them actually did**.

- New `FEAT_HELP`/`IFEAT_HELP` maps in `console/console-core.js` — a plain-language, one-sentence description per flag.
- `checkboxGrid()` gained an optional fourth `help` parameter, rendering `C.helpIcon(help[k])` next to each checkbox label when a description exists — reuses the existing `helpIcon()`/`field({help})` primitives from phase 1, no new component.

**Real gap found and fixed while implementing this**: `console/index.html` had **no `.help-icon`/`.help-icon__pop` CSS at all** — unlike `index.html`/`admin/index.html`/`workspace/index.html`, which all already have it. Without this, the new tooltip buttons would have rendered completely unstyled, with the explanation text always visible inline instead of hidden until clicked (the popover has no default `display:none` without the CSS). Added the identical CSS block Console was missing. `bindHelpIcons()`'s click-toggle behavior itself did not need any new wiring — confirmed in phase 1 that `core.js`'s shared, unconditional bootstrap already covers Console.

**Verified empirically** (no automated test harness exists for Console): a jsdom script rendering the exact `checkboxGrid()`+`helpIcon()` output confirmed the popover is `display:none` before a click, `display:block` after, with the correct 18×18px icon sizing — not just a code-reading assumption.

**Scope note**: this is the first slice of an open-ended phase — Console's other sections (Web/Workspace theme fields, Analyse, Personvern) and the other two surfaces' non-destructive fields have not been reviewed yet. Continuing incrementally in future rounds rather than attempting the whole product surface at once.

Tests: `test.js` 524/1, `test-workspace.js` 157/1 unaffected (no automated Console coverage exists). `?v=N` bumped: `console-core.js` (88→89). `VIBEVERK_VERSION` 0.33.3 → 0.33.4.

## 0.33.3 — 2026-07-13

### Copy-clarity initiative (punkt 0) — phase 3: Web-admin's panels

Third step of the rollout order from `docs/architecture/copy-style-guide.md` (Console → Workspace → Web-admin → general tooltips).

- **`module-crm.js`'s "Slett kunde" confirm (two identical call sites — the customer-list row delete and the customer-detail-view delete)** was verified against its actual implementation first: `deleteAllForEmail()` + `deleteCustomer()` genuinely does cover leads/tilbud, bookings, CRM communication history and chat conversations matched by email — the old terse "Slett ALL data for {email}?" was *not* misleading in scope (unlike the Workspace settings-reset fixed in phase 2), but it never stated irreversibility or what specifically gets removed. Reworded to name the actual scope and state it cannot be undone.
- **`module-users.js`'s (Web-admin's own, root-level file) remove-user confirm** — same clarification as the equivalent `workspace/module-users.js` fix in phase 2: authored tasks/announcements/KB articles are orphaned, not deleted.
- **The GDPR erasure form's confirm (`core.js`, "Slett ALL data knyttet til «email»")** was checked against `deleteByEmail()`'s actual implementation and found to be already accurate (covers leads/tilbud, bookings, CRM customers, and chat) — left unchanged, no fix needed.

**Not touched this round**: the simpler single-item deletes already reviewed as adequate in earlier phases (templates, snippets, single comm-history entries, scrollbanner sections) — same reasoning as phases 1–2, these already name the specific item being removed.

Tests: `test.js` 524/1, `test-workspace.js` 157/1 unchanged. `?v=N` bumped: `module-crm.js` (21→22, all three HTML entry points that load it), `module-users.js` (13→14, `index.html`/`admin/index.html`), `console-core.js` (87→88, version-display only). `VIBEVERK_VERSION` 0.33.2 → 0.33.3.

## 0.33.2 — 2026-07-13

### Copy-clarity initiative (punkt 0) — phase 2: Workspace's destructive actions

Second step of the rollout order from `docs/architecture/copy-style-guide.md` (Console → Workspace → Web-admin → general tooltips).

- **`module-settings.js`'s "Nullstill intranett-data" `confirm()` was actively misleading** — it said "All intranett-data slettes permanent", but `resetWspData()` only ever clears four specific Store keys (`wsp-settings`, `wsp-tasks`, `wsp-notes`, `wsp-activity`) — announcements, KB, links, CRM etc. are untouched. The danger-zone hint text *above* the button already stated this correctly ("Nullstiller kun intranett-data (oppgaver, notater, aktivitetslogg, innstillinger)"), so the confirm dialog directly contradicted its own neighboring hint. Reworded to match the accurate scope.
- **`workspace/module-users.js`'s remove-user confirm** now states that the removed user's authored tasks/announcements/KB articles are NOT deleted (only the author reference is cleared, per the 20260712203346 FK fix) — directly relevant given that's recently-changed behavior worth surfacing at the point of the action, not just documented in a migration comment.
- **Fixed a real CSS bug found during the Architect consultation** (2026-07-13, phase 1 review): `workspace/index.html` only defined `.form__status.is-err`, but three Workspace modules (`module-tasks.js`, `module-links.js`, `module-kb.js`) use that class while two others (`module-announcements.js`, `module-settings.js`) use `.is-error` instead — an inconsistency within Workspace's own code, not just vs. other surfaces. Error messages using `is-error` rendered uncolored/unstyled. Fixed by making the CSS rule match both class names, rather than picking one and rewriting five files' worth of JS.

**Not touched this round** (per the established rollout order): the simpler single-item delete confirms (announcements/notes/mediabank/tasks/links/kb/orgdrift) already name the specific item being deleted and were judged adequate as-is; Web-admin's panels and the general inline-tooltip pass remain for later phases.

Tests: `test.js` 524/1, `test-workspace.js` 157/1 unchanged. `?v=N` bumped: `module-settings.js` (6→7), `module-users.js` (3→4), both in `workspace/index.html`. `VIBEVERK_VERSION` 0.33.1 → 0.33.2.

## 0.33.1 — 2026-07-13

### `tasks` RLS tightening deployed to production

0.33.0's `supabase/migrations/20260713130659_tighten_tasks_read_rls.sql` (staging-tested and merged via PR #26) applied to production (`clzczbyklgdtdhgjphup`) and confirmed live via a direct `pg_policies` query (`tasks_read`'s `qual` now `(assigned_to = auth.uid()) OR (created_by = auth.uid())`). No code change, doc-only + version bump.

`VIBEVERK_VERSION` 0.33.0 → 0.33.1, `console-core.js?v=85→86`.

## 0.33.0 — 2026-07-13

### Copy-clarity initiative (punkt 0) — phase 1: Console's destructive actions, plus the shared foundation

Kicked off the "forklaringstekster og brukarvennlegheit" initiative from `docs/roadmap/ROADMAP.md` "Next" punkt 0 (user-prioritized above the Sunnvask showcase-customer work), designed with the vibeverk-architect agent same day. Two small, concrete decisions also actioned: `tasks` RLS tightened (see below) and a tenant RLS-read decision recorded (no code change needed there — see CURRENT_STATE.md).

**Foundation** (per Architect recommendation — extend existing patterns, don't invent new ones):
- New `docs/architecture/copy-style-guide.md`: the plain-language rule (with a jargon → Norwegian-plain glossary), when to use `field({hint})` vs the new `field({help})` vs a full explanatory paragraph, and a two-tier convention for save/destructive-action communication (Tier A — routine/reversible, inline hint only; Tier B — destructive/irreversible, a `confirm()` stating scope/exclusions/reversibility; Tier B-inline — Console-specific, for a routine save whose blast radius is unusually large). Cross-linked from `docs/architecture/README.md` and a new "User-facing text" section in `CLAUDE.md`.
- `components.js`'s `field()` gained an optional `help` param (renders the existing `helpIcon()` next to the label) — extends the existing primitive rather than adding a competing component, per the Architect's explicit recommendation. Backward-compatible (optional, no behavior change for existing callers).
- A short pointer comment added above `helpIcon()` in `components.js`, linking to the new style guide.

**Console copy fixes (Tier B / Tier B-inline applied to the highest-consequence gaps found)**:
- **"Set aktiv" (activate a tenant) had ZERO explanatory text before** — the single biggest gap found: this makes a customer's site/Workspace actually live and publicly reachable, with no warning at all. Added an inline Tier B-inline warning explaining the real consequence in plain terms.
- **"Arkiver kunde"**: the `confirm()` and the danger-zone hint above it both upgraded to full Tier B (states what's affected, what's explicitly NOT affected — the customer's own Supabase project is untouched — and, honestly, that there is currently no way to reverse archiving in Console at all, rather than silently implying otherwise). The old hint text also named an internal function (`resolve_tenant_by_hostname`) directly in user-facing copy — removed, replaced with a plain description of the actual effect.
- **"Nullstill all konfig"**: both the danger-zone hint and the `confirm()` reworded to drop the jargon term "superconfig", replaced with a plain description of what's actually reset (colors, fonts, text, enabled features, privacy text).

**Scope note**: per the Architect's recommended sequencing (Console's destructive actions first, since it's the smallest file surface with the highest consequence per mistake), this round deliberately did NOT yet: generalize Console's `.kd-card` checklist markup into a shared helper function (recommended, but deferred — Console has no automated test coverage at all, and this is a larger internal refactor better done as its own verified step rather than blended in here), touch Workspace's destructive-action copy, Web-admin's panels, or the wider inline-tooltip pass. See `docs/roadmap/ROADMAP.md` "Next" punkt 0 for the full remaining plan and rollout order.

**Testing**: no automated test harness exists for Console (`test.js`/`test-workspace.js` don't cover it — a pre-existing, documented gap). Verified via `node --check` (syntax), careful manual review of the edited strings for balanced quotes, and confirming `test.js`/`test-workspace.js` are unaffected by the shared `components.js` change (524/1, 157/1, both unchanged).

**UX/Mobile Reviewer pass run same day (per CLAUDE.md's rule for meaningful UI changes). Verdict: ship with one noted fix — applied.** Live-browser login to Console wasn't possible for the reviewer either (real OTP auth), so this was a code-reading review. Confirmed one real gap: the "Nullstill all konfig" hint/confirm text (unlike its "Arkiver"/"Set aktiv" siblings) never stated the reset takes effect *immediately, live, on the customer's actual site* — fixed, both texts now say so explicitly. The reviewer also flagged that Console never wires up `bindHelpIcons()`, so a future `field({help})` call there would render an inert "?" button — **checked empirically (not just via code-reading) and found to be a false positive**: `core.js`'s own unconditional `boot()` (which every surface including Console loads) already calls `bindHelpIcons()` once globally, confirmed via a live jsdom test (a simulated `[data-help-toggle]` click inside `#console-app` correctly toggled `is-open`) — no fix needed, and none applied (adding a second call would have broken the toggle, per the already-documented `workspace/workspace-core.js` double-binding landmine). Also fixed: `docs/architecture/copy-style-guide.md` referenced a `kdCard()` helper as if it already existed — corrected to state it's a recommended future extraction, not yet built.

`?v=N` bumped: `components.js` (11→12, all four HTML entry points), `console-core.js` (84→85, `console/index.html`). `VIBEVERK_VERSION` 0.32.3 → 0.33.0.

## 0.32.3 — 2026-07-13

### Real fix for the backup/restore BLOCKER: transactional `restore_backup_tables()` RPC

Replaces the v0.32.1 stopgap (which fully disabled Supabase-table restore) with the actual designed fix, worked out with the vibeverk-architect agent and tested against `vibeverk-staging` with real data before touching production.

**New**: `supabase/migrations/20260713104738_restore_backup_tables_rpc.sql` — a single `SECURITY DEFINER` Postgres function, `restore_backup_tables(p_tables jsonb)`, admin-only (`is_admin_or_owner()`, stricter than the per-table RLS's `can_edit_content()` — a full nine-table wipe-and-replace is categorically more destructive than any single row-level write those policies were written for). One function call = one transaction, so any failure (bad row shape, FK violation, missing table) rolls back everything automatically — this alone fixes the BLOCKER's core problem (no more partial-failure data loss, no more illusory "one table at a time" isolation given the real crm_bedrifter→crm_customers/crm_customers→crm_comms FK cascades). Validates the full manifest (all nine expected keys present as JSON arrays) before any deletion — a truncated/malformed payload is rejected outright, never silently treated as "restore this table to empty." A practical size guard rejects payloads over ~20,000 total rows with a clear error rather than risking an uncontrolled platform-level cutoff mid-transaction.

**Real bug found via actual testing against staging, not obvious from design alone**: the first draft inserted rows with a dangling author reference (e.g. a task whose `created_by` no longer exists in `users`) and then tried to null the reference via an `UPDATE` afterward — this failed immediately with a foreign-key violation, since `tasks_created_by_fkey`/etc. are not `DEFERRABLE` and are checked at `INSERT` time, never reaching the `UPDATE` at all. Fixed by sanitizing the incoming JSONB rows (replacing dangling `created_by`/`assigned_to`/`author_id` values with JSON `null` via `jsonb_set`) *before* `jsonb_populate_recordset`/`INSERT`, for all five affected columns across `tasks`/`announcements`/`kb_articles`/`links` — matching the intent of `20260712203346_fix_user_delete_fk_restrict.sql` (preserve content, never drop the row), which the original v0.32.0 client-side logic had contradicted.

**Verified live against `vibeverk-staging`** (all nine tables were empty there beforehand, confirmed and restored to empty afterward — no residual test data left): (1) happy-path restore of real rows across all nine tables including one task with a dangling `created_by` — confirmed restored with `created_by` nulled, not dropped, via a direct row query; (2) a payload missing one table key — confirmed rejected with no data touched (row counts unchanged); (3) a deliberately-induced FK violation partway through (a `crm_comms` row referencing a nonexistent customer) — confirmed the **entire transaction rolled back**, verified by checking that the specific pre-existing row IDs from an earlier successful restore were still present afterward (not just that counts matched, which could coincidentally align); (4) a call simulated as a non-admin user — confirmed rejected with "Berre admin kan gjenopprette sikkerhetskopi". Grants verified via `information_schema.routine_privileges`: only `authenticated`/`postgres`/`service_role` have EXECUTE, `anon` does not.

**`core.js` changes**: `restoreTable()`, `BACKUP_USER_FK_RULES`, `BACKUP_TABLE_RESTORE_ORDER` removed entirely — `restoreBackupData()` now makes a single `_sb.rpc("restore_backup_tables", { p_tables: data.tables })` call instead of the old per-table client-orchestrated loop. `importBackup()` gained a client-side manifest pre-check (all nine tables present as arrays, `vibeverk_backup === true`) for a fast, friendly rejection before even reaching the network — the RPC itself re-validates the same thing server-side as the real boundary, since `window.App.buildBackupPayload`/`restoreBackupData` are reachable from any authenticated browser console session regardless of which UI tab is showing. Both admin "Sikkerhetskopi" panels' import UI (file picker, warning text) restored to their normal enabled state — the v0.32.1 "midlertidig deaktivert" notice and disabled file input are gone. Result field renamed `skipped` → `orphaned` throughout (client message text updated to match: "X fikk forfatter fjernet" instead of "X hoppet over").

**Security Auditor pass (emulated, `.codex/agents/vibeverk-security-auditor.toml`'s brief via general-purpose agent) run against the new RPC + its `core.js` integration same day. Verdict: CAUTION → all findings fixed same round, re-verified against staging.** No BLOCKER. One HIGH, confirmed: `restoreBackupData()`'s original draft wiped and rewrote `Store`/localStorage (which also queues an async write-through sync to Supabase's `store` table) *unconditionally before* calling the RPC — so a failed RPC call left `Store` already overwritten while the error message claimed "ingen endringer ble gjort", directly contradicting this whole redesign's safety guarantee. Fixed: `restoreBackupData()` now only touches `Store` *after* the RPC call has succeeded (the legacy no-`data.tables` branch is unaffected, since there's nothing after it to fail). Two MEDIUM findings, both fixed: `jsonb_set()` returns SQL NULL for the whole row (not just the column) when its `new_value` argument is itself NULL — which happens when an author/assignee key is entirely *absent* from a row (as opposed to explicitly `null`) — so a hand-edited/corrupted backup missing e.g. `created_by` outright could have silently nulled that entire row's content instead of just the reference; fixed with `COALESCE(elem->'col', 'null'::jsonb)` in all four sanitization blocks, so a missing key is always treated identically to an explicit `null`. Also added `pg_advisory_xact_lock(hashtext('restore_backup_tables'))` as the first statement after the admin check, closing a concurrency gap where two simultaneous restores (two admin sessions/tabs) could interleave under READ COMMITTED semantics into a silent merge of two different backups rather than a clean "last one wins" overwrite. **All three fixes re-verified against `vibeverk-staging`**: re-ran the full happy-path/missing-table/induced-failure/non-admin test battery (staging wiped to empty again afterward, zero residual data), plus a new specific case — a task with its `created_by` key entirely omitted (not `null`) — confirmed its title and other content survived intact with `created_by` correctly `NULL`, proving the M1 fix. `test.js` 524/1, `test-workspace.js` 157/1 unchanged throughout.

**Not yet done**: this migration has NOT been applied to production (`clzczbyklgdtdhgjphup`) yet, and none of this round has been pushed to `origin/main` — both need their own separate explicit approval, per usual.

Tests: `test.js` 524/1, `test-workspace.js` 157/1 — both unchanged (the jsdom harness never configures `_sb`, so it never reaches the RPC call path; this is a documented limitation, see `docs/project/CURRENT_STATE.md` — real verification happened against staging as described above, not via the jsdom suite). `?v=N`: `console-core.js` (83→84, `console/index.html`) — `core.js` stays at its existing `?v=45` (same uncommitted changeset as the earlier stopgap/UX/privacy-text rounds today, nothing pushed yet). `VIBEVERK_VERSION` 0.32.2 → 0.32.3.

## 0.32.2 — 2026-07-13

### Low-risk follow-ups from the Privacy/Compliance and UX/Mobile reviews (bildefokuspunkt + backup-tekst)

Same-day follow-up, actioning the smaller, low-risk findings from the two agent reviews of 0.32.0 (the deeper RLS/chat-backup/legacy-store-key findings from Privacy, and the deeper "horizontal focus axis often inert for wide crops"/ARIA-role findings from UX, are intentionally left open — bigger, separate discussions).

**UX/Mobile (bildefokuspunkt)**:
- Fikset ein reell tilgjengelegheitsfeil: den nye tastaturstyrde fokuspunkt-veljaren hadde ingen synleg fokusring i det heile (målt live av reviewaren — nesten svart mot nesten svart bakgrunn). La til `.imgfield__preview:focus-visible { outline: 3px solid var(--color-primary); outline-offset: 2px }` i `index.html`/`admin/index.html`/`workspace/index.html` (delt CSS-blokk, tre stader).
- `aria-valuetext` var hardkoda til "Midten" heilt til første piltast-trykk, sjølv om biletet alt hadde eit ikkje-sentrert lagra fokuspunkt — ein skjermlesar ville melde feil posisjon ved opning. Ny delt `updateValueText()`-hjelpar i `bindImageFields()` (`core.js`) set korrekt verdi både ved `render()` og etter kvar piltast-flytting (erstattar den tidlegare dupliserte inline-logikken i keydown-handsamaren).
- La til ein kort tekstleg keyboard-hint ("...eller bruk piltastene når feltet er fokusert") i `imgfield__hint`, sidan det tidlegare kun stod i `aria-label` (usynleg for ein sjåande tastaturbrukar).
- Workspace Aktuelt (kort + lesemodal) var lista som fiksa i 0.32.0 saman med Booking/FAQ, men fekk aldri ein tilsvarande `aspect-ratio` (kun `object-position`) — same lagra fokuspunkt kunne difor bli synleg ulikt beskjert avhengig av kortbreidde. La til `aspect-ratio:16/9` (matchar editoren) på begge biletvisingane i `workspace/module-announcements.js`.
- Ikkje fiksa no (flagga av reviewaren, treng ei eiga layout-avgjerd, ikkje ei enkel tal-justering): horisontal fokusjustering er i praksis daud for dei fleste bilete i FAQ/Booking sine breie format (3:1/21:9), manglande `aria-valuenow`, References-grid og Aktuelt-forsidekortet har same faste-høgd/variabel-breidd-mønster ufiksa.

**Privacy/Compliance (backup/restore-tekst)**:
- Begge "Sikkerhetskopi"-panela (full og forenkla) nemnde tidlegare ikkje at `tasks`/`announcements`/`kb_articles`/`links`/`crm_comms` faktisk er med i den nedlasta fila — oppdatert introduksjonsteksten i begge til å nemne kunder (inkl. kommunikasjonshistorikk), oppgåver, kunngjeringar, kunnskapsbase og lenker eksplisitt.
- Presisert at chat-samtaler IKKJE er med i "full" sikkerhetskopi når Supabase er konfigurert (same hol som 0.32.0 elles fiksa for dei ni andre tabellane, framleis ope) — og at det separate "Chat (JSON)"-modulknappen berre dekker chat lagra lokalt i nettlesaren, ikkje Supabase-baserte samtaler på tvers av einingar (ein tidlegare udokumentert, misvisande detalj).
- Retta `confirm()`-teksten og åtvaringsteksten før import til faktisk å reflektere kva som skjer no (tabell-gjenoppretting er mellombels deaktivert, sjå 0.32.1) i staden for den generiske, no unøyaktige "overskriver ALT"-påstanden.
- Ikkje fiksa no (større, arkitektur-/rolledesign-spørsmål, ikkje ein tekstfiks): at alle ni tabellane sine `SELECT`-policyar er `USING (true)` for enhver autentisert rolle, at gamle CRM-nøklar kan skrivast attende til `store` utan sletterett, og at chat faktisk manglar frå den ekte Supabase-baserte backupen (berre teksten om dette er retta no, ikkje sjølve hòlet).

Testa: `test.js` 524/1, `test-workspace.js` 157/1 — begge uendra (ingen av endringane råka noko testa åtferd). `?v=N` bumpa: `core.js` (uendra frå 0.32.1 sin bump til 45, alt attverande i same ikkje-pusha endringssett), `module-announcements.js` (7→8, `workspace/index.html`). `VIBEVERK_VERSION` 0.32.1 → 0.32.2.

## 0.32.1 — 2026-07-13

### BLOCKER stoppgap: Supabase-tabell-restore i "Sikkerhetskopi" deaktivert

Ekstern tredjeparts-tryggingsgjennomgang (Codex, brukar sjølv, av 0.32.0-diffen) fann eit reelt BLOCKER-nivå problem i restore-delen av 0.32.0 sin backup/restore-kritisk-fiks — denne funksjonen var alt live i produksjon. Verifisert direkte mot koden før noko vart endra:

- `restoreTable()` (`core.js`) gjer `delete()` og deretter ein separat `insert()` med ingen database-transaksjon. Feiler INSERT-en, er dei sletta radene borte utan veg tilbake.
- "Éin tabell om gongen"-isolasjonen kommentaren hevda, held ikkje: `crm_customers.bedrift_id` har `ON DELETE SET NULL` mot `crm_bedrifter`, og `crm_comms.customer_id` har `ON DELETE CASCADE` mot `crm_customers` (`supabase/migrations/20260707000001_baseline_schema.sql`). Å tømme `crm_bedrifter` muterer difor allereie-eksisterande kundekoblingar, og å tømme `crm_customers` slettar `crm_comms` — før desse tabellane i det heile er "under restaurering" i loopen.
- `importBackup()` validerte berre at `parsed.data` var eit objekt — ingen sjekk på `vibeverk_backup`-merke, versjon, eller at alle ni tabellar faktisk fanst. Ei avkorta/handmodifisert/framtidig delvis fil ville stille tømt manglande tabellar utan varsel.
- Brukaroppslaget (`_sb.from("users").select("id")`) sjekka aldri `r.error` — ein nettverksfeil gav ein tom `Set`, og alt forfattarbunde innhald vart då handsama som om forfattaren var sletta.
- Sjølvmotseiing i same PR: `BACKUP_USER_FK_RULES` droppar heile rada når ein NOT NULL-forfattar manglar, medan 0.32.0 sin eigen `20260712203346`-migrasjon nettopp gjorde desse kolonnane nullbare + `ON DELETE SET NULL` for å BEVARE innhald ved brukarsletting.

**Fiks (stoppgap, ikkje den endelege løysinga)**: `restoreBackupData()` avviser no eksplisitt (med ei forklarande feilmelding) så snart han når Supabase-tabell-delen (`data.tables`, når `_sb` faktisk er konfigurert) — plassert presist slik at den reint lokale (Store/localStorage) gjenopprettinga og heile eksport-sida er heilt upåverka, og ingen eksisterande test (som alltid køyrer utan `_sb` konfigurert) endra åtferd (`test.js` 524/1, `test-workspace.js` 157/1, uendra). Begge admin-panela ("Sikkerhetskopi" og "admin-backup") viser no tydeleg i UI-teksten at import er mellombels deaktivert, med fil-knappen visuelt og funksjonelt deaktivert, i staden for å late administratoren oppdage det først etter å ha valt ei fil.

**Ikkje fiksa enno, krev ein ordentleg omdesign** (venta neste steg, truleg via Arkitekt-agenten sidan det er ei datamodell-sensitiv endring, med Security Auditor-gjennomgang før produksjonsdeploy): éin database-transaksjon (truleg ein admin-only `SECURITY DEFINER`-RPC) som validerer heile manifestet FØR første sletting, stoppar heilt på eit brukaroppslag-feil i staden for å halde fram, og nullar forfattarfelt i staden for å droppe rader (i tråd med 0.32.0 sin eigen FK-migrasjon).

Same runde stadfesta òg (verifisert direkte, ikkje berre stolt på dokumentasjon) at 0.32.0 sine to produksjonssteg for brukarslettingsfiksen (SQL-migrasjon + `manage-user`-redeploy) faktisk alt var utført mot produksjon — 0.32.0-oppføringa under sin "ingen produksjonssteg utført"-påstand var forelda/feil, retta i `docs/project/CURRENT_STATE.md`.

`?v=N` bumpa: `core.js` (44→45, alle fire HTML-inngangar), `console-core.js` (82→83). `VIBEVERK_VERSION` 0.32.0 → 0.32.1.

## 0.32.0 — 2026-07-12

### ⏳ PENDING REVIEW — les før du gjer meir arbeid på desse to felta
Brukar valde å pushe/deploye/migrere denne runda FØR dei to attverande, framleis ikkje-utførte gjennomgangane under — eksplisitt "vi tar review seinare", ikkje gløymt. **Ikkje anta desse er OK berre fordi koden er live:**
- **Privacy/Compliance Advisor** — ikkje køyrd på backup/restore-utvidinga (item 3 under). `core.js` les/skriv no `crm_customers`/`crm_bedrifter`/`crm_comms`/`leads`/`bookings`/`tasks`/`announcements`/`kb_articles`/`links` direkte, ei ny kryssande modulgrense Arkitekt-konsultasjonen eksplisitt flagga. `notes` vart MED VILJE utelate av personvernomsyn (sjå item 3) — den avgjerda er teken av Builder-agenten, ikkje stadfesta av Privacy Advisor enno.
- **UX/Mobile Reviewer** — ikkje køyrd på bildefokuspunkt-endringane (item 4 under), særleg dei nye CSS-endringane (`aspect-ratio:3` på `.faq-img`, `object-position` lagt til fleire stader) og tastaturtilgjenge-tillegget. Ikkje stadfesta i ekte nettlesar på mobil/skildskjerm.
- **Security Auditor** — KØYRD og PROCEED for brukarsletting-fiksen (item 5) spesifikt, sjå eiga oppføring lenger nede. IKKJE køyrd på dei andre fire endringane.

### Workspace: five reported bugs investigated and fixed (startside-snarveier, KB-status, kritisk backup/import, bildefokuspunkt, brukarsletting)

**Startside-snarveier (Dashboard → "Ny KB-artikkel"/"Ny kunngjering")**: begge opna berre lista, ikkje sjølve opprettingsvisninga, medan "Nytt notat"/"Ny oppgave" fungerte. Rotårsak: `module-kb.js`/`module-announcements.js` sine `mount()`-funksjonar viser eit "Lastar…"-steg og byggjer `#kb-new-btn`/`#ann-new-btn` FØRST etter at eit asynkront Supabase-kall er ferdig — Dashboard sin gamle `setTimeout(100ms)` + `querySelector(...).click()`-fallback var eit kappløp mot det ekte nettverkskallet og trefte ofte for tidleg. `module-tasks.js`/`module-notes.js` unngår dette heilt via ein synkront-registrert `window._tasksOpenModal`/`window._notesOpenModal` som opnar ein ekte, alltid-tilgjengeleg modal. Fiksa med tilsvarande `window._kbOpenNew()`/`window._annOpenNew()` — desse set berre eit flagg (`_openNewOnLoad`) som `mount()` sjekkar når det asynkrone lastinga faktisk er ferdig, heilt utan gjetting på tid. `module-dashboard.js` sine to handlarar forenkla til å berre kalle desse + navigere, ingen `setTimeout` att.

**Intern kunnskapsbase — "fungerer, men tekst hevdar deaktivert"**: grundig søk fann ingen misvisande tekst i UI eller docs (config.js sin `kb: false`-kommentar er ein ærleg, korrekt per-kunde-standard). Brukar presiserte at det faktiske spørsmålet var: stadfest at `intranettFeatures.kb = false` (dagens standard) faktisk SKJULER KB-en trygt, ikkje at det krasjar — eit hol utan automatisert dekning sidan test-harnesset alltid tvingar `kb: true` for å kunne teste sjølve funksjonaliteten. Spora koden (ingen registrering skjer i det heile når flagget er av → nav/dashboard/`window._kbOpenNew` fell trygt bort, direkte `#/kb`-navigering fell tilbake til ei rein "Modul ikke funnet"-melding) og la til 6 nye regresjonstestar (`test-workspace.js`, ny seksjon Z) i eit eige, separat DOM-oppsett (kan ikkje testast i det delte hovud-DOM-et, sidan modulregistrering skjer éin gong ved skriptlasting). **Konklusjon: ikkje ein feil, stadfesta trygt.**

**Import/eksport — KRITISK, stadfesta rotårsak**: `crm_customers`/`crm_bedrifter`/`crm_comms`/`leads`/`bookings`/`tasks`/`announcements`/`kb_articles`/`links` flytta ut av den generiske `store`-tabellen 2026-07-03/06 (sjå eldre oppføringar), men `core.js` sin "Sikkerhetskopi"-funksjon (`buildBackupPayload()`/`restoreBackupData()`) vart ALDRI oppdatert til å følgje etter — han opererer reint gjennom `Store`/localStorage, som desse ni tabellane ikkje lenger skriv til når Supabase er konfigurert. Eksporten fanga difor berre ein krympande delmengd av det faktiske innhaldet (config/superconfig/media-indeks/e-postmalar m.m.), aldri dei ni tabellane — difor kom ikkje sletta data attende ved import, sidan dei aldri var i eksporten i utgangspunktet. Konsulterte Arkitekt-agenten før implementering (kryssande modulgrenser, ni tabellar, FK-omsyn). Fiksa:
- Nytt `BACKUP_TABLES` (ni tabellar; `notes` MED VILJE UTELATE — RLS gjev kvar brukar berre tilgang til sine eigne notat, ingen admin-unntak, så ein "full" kopi ville stille berre fanga éin admin sine eigne notat).
- `buildBackupPayload()` er no async, hentar alle ni tabellane paginert (`.range()`-løkke, PostgREST cappar elles på 1000 rader), `version: 2`, `data.tables = {...}`.
- `restoreBackupData()` tømer-og-set-inn-att éin tabell om gongen (ikkje eit globalt tøm-alt-steg) i FK-trygg rekkefølgje (bedrifter→kundar→comms), med FK-reparasjon mot sletta brukarar: NOT NULL-forfattarfelt (`tasks.created_by`, `announcements.author_id`, `kb_articles.author_id`) droppar rada, nullbare felt (`tasks.assigned_to`, `links.created_by`) vert nullstilte og rada behalden. Kastar (stoggar kjeden) på ein reell Supabase-feil, slik at attverande tabellar står urørt i sin FØR-tilstand i staden for å bli tomme.
- Bakoverkompatibelt: gamle kopiar utan `data.tables` (frå før denne fiksen) gjenopprettar akkurat det dei alltid har gjort (`legacyBackup: true` i resultatet, forklarande melding til admin).
- 12 nye regresjonstestar i `test.js` (nytt `tables`-felt, alle ni tabellnamn, `notes` fråverande, legacy- vs ny-forma gjenoppretting).
- Framleis ope, akseptert risiko (flagga av Arkitekt): eitt nettverksfeil midtvegs i restore skil mellom REST-kall, ikkje éin atomisk DB-transaksjon — ikkje fiksa her, dokumentert som eit mogleg framtidig SQL-basert hardingssteg.

**Bildefokuspunkt**: kartla alle opplastingsstader (delt `bindImageFields()`/`imageField()` i `core.js`/`components.js`, kalla frå hero, Om oss, tjenestekort, Aktuelt, Mediebank, Booking-ressursar, FAQ, Referansar, Scrollbanner, Workspace Aktuelt). Fann og fiksa:
- **Daud `pos`-verdi** (fokuspunkt lagra, men aldri brukt på visning — ingen `object-position` i det heile): Booking-ressursbilete, FAQ-toppbilete, Workspace Aktuelt (kort + lesemodal). Alle fire fekk `object-position` lagt til.
- **Sideforhold-mismatch mellom editor og verkeleg visning**: Booking sin editor lova 16/10, men `.bk-asset__img` sin CSS er 21/9 — retta editoren til 21/9 (matchar den ekte CSS-en, ikkje omvendt). FAQ sin editor lova 3:1, men `.faq-img` hadde ingen `aspect-ratio` i det heile (object-fit:cover var difor ofte verknadslaust) — la til `aspect-ratio:3` (matchar det editoren alt lova). Hero/Aktuelt-artikkel/Referansar er ikkje fiksa i denne runda — fleire ulike, sjølvmotseiande visningskontekstar (t.d. Aktuelt-biletet vises i minst 3 stader med 3 ulike faktiske forhold) krev ei brei layout-avgjerd, ikkje ei enkel tal-justering, og er flagga for UX/Mobile Reviewer heller enn gjetta blindt her.
- **Ekte interaksjonsfeil**: `module-scrollbanner.js` sin statisk/parallax-modusbyte oppdaterte DOM-en manuelt (vindaugestorleik) utan å nå `bindImageFields()` sin private `crop`/`outAspect`-tilstand (fastfrosen ved bindetidspunktet) — eit drag RETT ETTER eit modusbyte brukte difor feil utsnittsmål. Fiksa ved å gjere `bindImageFields()` reaktiv (les `data-aspect` på nytt ved kvart `layout()`-kall, ny `imgfield:relayout`-hending for eksterne triggarar) og fjerna scrollbanner sin duplikate/avvikande utrekning heilt — no finst berre éin stad som reknar ut utsnittsmål.
- **Tastaturtilgjenge lagt til**: biletfeltet hadde ingen måte å styre fokuspunktet på utan mus/touch. Piltastar flytter no punktet i steg på 5 %, `tabindex="0"`/`role="slider"`/`aria-valuetext` lagt til.
- Standardverdi ved manglande fokuspunkt (`"50% 50%"`) og koordinatsystem er alt konsistente overalt — ikkje kjelda til problemet.
- 5 nye regresjonstestar i `test.js` (tastaturstyring, `imgfield:relayout`-reaktivitet).

**Sletting av brukarar — "Feil: {}"**: stadfesta rotårsak via skjemaet, ikkje berre feilmeldinga. `tasks.created_by`/`announcements.author_id`/`kb_articles.author_id` refererer `users(id)` UTAN nokon `ON DELETE`-klausul (implisitt RESTRICT) — i motsetnad til dei allereie korrekte `tasks.assigned_to`/`links.created_by` (`ON DELETE SET NULL`). Sidan `users.id` har `ON DELETE CASCADE` frå `auth.users`, kaskaderer `auth.admin.deleteUser()` naturleg vidare inn i `public.users` — men stoggar der FK-en frå tasks/announcements/kb_articles blokkerer, altså for kvar einaste brukar som nokon gong har oppretta ei oppgåve, skrive ei kunngjering eller ein KB-artikkel (dvs. praktisk talt alle admin/editor-kontoar, ikkje eit kantilfelle). Fiksa tre stader:
1. **SQL** (`supabase/migrations/20260712203346_fix_user_delete_fk_restrict.sql`): dei tre kolonnane vert nullbare + `ON DELETE SET NULL`, same mønster som dei to som alt var korrekte. Innhald vert behalde (orphana frå forfattaren), ikkje kaskade-sletta. **Køyrd mot `vibeverk-staging` (ref `syqnyfeponexmkdvnsga`) 2026-07-13 og stadfesta via direkte `information_schema`-spørjing** (ikkje berre eit "Success"-meldingstillit, per CLAUDE.md sin regel om Dashboard SQL Editor) — alle tre constraints viser `delete_rule = SET NULL`, `is_nullable = YES`. **IKKJE KØYRD mot produksjon (`clzczbyklgdtdhgjphup`) enno — treng eiga, separat godkjenning.**
2. **Edge Function** (`supabase/functions/manage-user/index.ts`): `deleteUser()`-kallet var ubeskytta av try/catch — ein reell DB-feil kunne difor forlate uhandtert til Deno sin generiske feilhandsamar og returnere eit ugjennomsiktig/tomt svar (den truleg reelle mekanismen bak "{}"), i staden for eit forklarande `error`-felt. **Deploya til `vibeverk-staging` 2026-07-13** (`npx supabase functions deploy manage-user --project-ref syqnyfeponexmkdvnsga`), stadfesta live via eit negativt-veg-kall (manglande Authorization → 401 `UNAUTHORIZED_NO_AUTH_HEADER`), ikkje berre ei rein deploy-melding. **IKKJE DEPLOYA til produksjon enno — treng eiga, separat godkjenning.**
3. **Klient** (`module-users.js` OG `workspace/module-users.js` — to separate filer, same feilmønster i begge): `alert("Feil: " + res.error)` handterte ikkje at `res.error` kunne vere anna enn ein streng (objekt/undefined) — no eit eksplisitt `typeof`-sjekk med ei forklarande standardmelding i staden for `"[object Object]"`/tomme meldingar.

**Security Auditor-runde 2026-07-13 (brukarslettingsfiksen spesifikt)**: PROCEED, ingen BLOCKER/HIGH. Stadfesta at `ON DELETE SET NULL` ikkje kan utvide nokon RLS-policy (alle sjekkar mot `created_by` er direkte `= auth.uid()`-likskap, og `NULL = x` er aldri `TRUE` i SQL), og at try/catch-en i Edge Function-en ikkje rører autorisasjonssjekkane over han. To MEDIUM-hardingsnotat (ikkje blokkerande): feilmeldinga kan i prinsippet lekke rå Postgres/FK-skjemadetalj (tabell/constraint-namn) til den alt-autoriserte admin-en; migrasjonen manglar `NOTIFY pgrst, 'reload schema'` (rører berre constraints, ikkje funksjonar, men flagga per CLAUDE.md sin faste regel). Éin LOW UX-merknad: ei orphana oppgåve (forfattar sletta) vert usynleg for vanlege `member`-brukarar i `workspace/module-tasks.js` si gruppering (framleis synleg/redigerbar for admin) — feiler lukka, ikkje eit tryggingsproblem. Sjå `docs/project/CURRENT_STATE.md` "Last verified" for full oppsummering.

**Live ende-til-ende-test mot `vibeverk-staging` 2026-07-13, utført av brukaren sjølv**: oppretta ein testbrukar, testbrukaren skreiv innhald, og sletting via Workspace-brukargrensesnittet (den fiksa `workspace/module-users.js`-klienten, mellombels peika mot staging via `config.js` — reversert att umiddelbart etterpå, aldri commita) lukkast — ingen "Feil: {}", brukaren forsvann frå lista. Dette er den sterkaste stadfestinga så langt: heile kjeda (klient → Edge Function → SQL) fungerer i praksis, ikkje berre kvar del isolert.

⚠️ **Korrigering 2026-07-13**: oppføringa over sa "ingen produksjonssteg utført". Verifisert på nytt same dag, direkte mot produksjon (`clzczbyklgdtdhgjphup`), FØR nokon ny kommando vart køyrd: `npx supabase migration list --linked` synte migrasjonen alt registrert, og ei direkte `information_schema`-spørjing stadfesta alle tre FK-constraints (`tasks.created_by`, `announcements.author_id`, `kb_articles.author_id`) alt har `delete_rule = SET NULL`/`is_nullable = YES` i produksjon. `npx supabase functions download manage-user --project-ref clzczbyklgdtdhgjphup` henta den faktisk deployerte koden — null diff mot repoet, inkl. try/catch-fiksen. Konklusjon: **begge produksjonsstega var alt utført** (av brukar, utanfor denne økta) då dette vart sjekka — teksten under er historisk kontekst for kvifor fiksen finst, ikkje ein gjenverande TODO.

## 0.31.2 — 2026-07-12

### Console: tenant-picker kontrast + "Hent Vibeverk sin standardtekst" for personvern
To brukarmelde forbetringar i Console:
- `.cs-tenant-picker select` sin nedtrekksliste (`<option>`) arva mørk sidebar-tekstfarge utan eigen bakgrunnsfarge — nettlesaren (Chrome/Windows) rendrar sjølve opne lista med OS-native lys bakgrunn, så alternativa vart nesten usynlege (lys tekst på lys bakgrunn). La til eksplisitt `color`/`background` på `option`.
- Personvern-fana fekk ein ny "↺ Hent Vibeverk sin standardtekst"-knapp som fyller rik-tekst-feltet med det same modul-medvitne GDPR-forslaget som `computeDefaultPrivacyText()` i core.js alt brukar som stille fallback før noko er lagra (sjå kommentaren der: "Kan kallast frå Konsollen for å generere eit nytt forslag" — no faktisk kalt derfrå). Duplikatlogikk med eige namn (`computeTenantPrivacyDefault`) i staden for å kalle core.js-versjonen direkte: CFG/modules/Store der er alltid Console sin EIGEN primærtenant (same feilklasse som Produkt/Web/Workspace/Modular-fana sine tidlegare CFG-fallback-bugs), så funksjonen tek `sc`/`an` (henta via `getStoreKey("analytics", …)`) som argument i staden. Spør om stadfesting før overskriving viss feltet alt har innhald.

### Console: archived tenants also removed from the sidebar tenant picker
0.31.0 hid archived tenants from the "Registrerte kundar" list but missed the *other* place `_tenants` is rendered as a list: the sidebar's `<select id="cs-tenant-select">`, which picks `_activeTenant` for the whole Console (web/produkt/personvern/analyse tabs). Filtered the same way. Also fixed `loadTenants()`'s default: it picked `_tenants[0]` unconditionally, so if the alphabetically-first tenant happened to be archived, `_activeTenant` would point at a tenant no longer present among the dropdown's own options — now defaults to the first non-archived tenant, falling back to any tenant only if every tenant is archived.

**⚠️ `tenant-admin` still needs redeploying** — 0.31.0's `update_tenant_slug` merged into `main` but the running Edge Function in `vibeverk-control` wasn't redeployed yet, so it's still returning "Ukjend handling: update_tenant_slug" live. Redeploy with `npx supabase functions deploy tenant-admin --project-ref jxoglthrnshabqmdmnui` before considering this done.

## 0.31.0 — 2026-07-12

**⚠️ Requires an `npx supabase functions deploy tenant-admin --project-ref jxoglthrnshabqmdmnui` after merge** — same as 0.30.0/0.30.1, a `git merge` alone does not update the running Edge Function. (Confirmed the hard way this round: 0.30.0's `archive_tenant`/active-status hostname edit sat merged on `main` but undeployed for a while — user hit the old "Denne handlinga er berre tillate mens kunden er i status 'provisioning'" and "Ukjend handling: archive_tenant" errors from the stale deployed function before this was caught and redeployed.)

### Console: edit a tenant's slug regardless of status
User wanted to rename a tenant's slug after it was already deployed/active — turned out `slug` was never editable at all (`register_tenant` set it once, no update path existed). Added `update_tenant_slug` to `tenant-admin/index.ts`. Unlike `update_tenant_hostnames`, this is **not** restricted to `'provisioning'`: traced every use of `slug` and confirmed it's purely a human-readable identifier (Console display + the label baked into the Vault secret name string) with zero connection to `resolve_tenant_by_hostname()` or any public routing/exposure — so there's no exposure-window reasoning that would justify a status restriction the way there was for hostnames. Allowed for any status except `'archived'` (a frozen, soft-deleted tenant has no reason to be renamed), same superadmin-gating/audit-logging/atomic-status-recheck pattern as every other action in this file. Console's "1. Registrert" card now has an editable slug field alongside the domain-name field.

### Console: archived tenants hidden from the list by default
User feedback: archived tenants cluttered the same list as active/provisioning ones with no way to tell them apart at a glance beyond the status badge. `renderKundar()` now filters `status = 'archived'` tenants out of the list unless a new "Vis arkiverte (N)" checkbox (only shown at all when at least one archived tenant exists) is checked. Selecting/viewing an archived tenant's detail checklist directly is unaffected — the filter only applies to the list view.

## 0.30.3 — 2026-07-12

### Fix: service card text could be silently truncated with no way to read the rest
Follow-up to the 0.30.0 `.card__text` CSS clamp (added so one long customer-entered card wouldn't force the whole "Tjenester" grid row to its height). User pointed out the clamp had no "read more"/modal escape hatch — any text past the visual cap was just gone, invisible, unrecoverable from the front end. Discussed a `.card__text` max-height clamp + a "read more" modal against a hard input-time character limit; user chose the character limit (keeps the image option, avoids building a second detail-page pattern just for this one card type).

Added a reusable `maxChars` option to `richTextField()` in `components.js`: renders a live "x/N tegn" counter (turns red past the limit) under the editor, counted from `editor.textContent` (visible text only, not HTML markup) so formatting doesn't eat into the budget. `bindRichTextFields()` in `core.js` wires the live update. Service cards' description field now sets `maxChars: 200` (roughly what the existing CSS clamp can actually show) and **enforces it at save time** in `openServiceEditor()` — blocks the save with an inline error naming the actual character count, rather than silently letting it through and clipping on the live site. Chosen over a "read more" modal: the CSS clamp stays as a defensive fallback for older content saved before this limit existed, but new/edited cards can no longer hit it in the first place.

`?v=N` bumped on `core.js`/`components.js`'s four script tags and `console/console-core.js` (shares `richTextField`/`bindRichTextFields` via `core.js`, no direct code change but kept in step for the platform version display).

## 0.30.2 — 2026-07-12

### "Om oss" now has an ingress field too, matching Tjenester/Aktuelt/Kontakt
User request: bring "Om oss" in line with the other three sections, which all got a heading + optional ingress field in 0.30.0. Added `about.intro` (empty by default, same as the other sections' ingress fields — not a structural default like `heading`, since this is closer to actual marketing-style copy). `components.js`'s `about()` now does `eyebrow(d.intro || d.heading)`, the same fallback pattern already used by `services()`/`news()`/`contact()`. New admin field under "Om oss" in `adminContent()`; `content.about.intro` seeded/saved the same way as `content.about.heading`.

## 0.30.1 — 2026-07-12

### Fix: Console showed a useless generic error for every failed Edge Function call
User report: archiving a tenant and editing its domain names both failed with "Edge Function returned a non-2xx status code" — no indication of the real reason. Root cause: `supabase-js`'s `functions.invoke()` sets that exact generic string on `error.message` for **every** non-2xx response, regardless of what the function actually returned — our own `json({ error: "..." }, 4xx/5xx)` response bodies (e.g. "Tenanten er alt arkivert", "Berre superadmin kan utføre kundeadministrasjon") were only ever reachable via `error.context` (the raw `Response` object), which `brokerCall()`/`tenantAdminCall()` in `console/console-core.js` never read. This wasn't specific to the two new actions from 0.30.0 — every single Console action that goes through either of these two helpers has been silently swallowing its real error message the same way, for as long as they've existed; it just took a failing call for someone to notice. Fixed with a shared `extractFunctionErrorMessage()` helper that awaits `error.context.json()` and falls back to the generic message only if that itself fails (e.g. a network-level error with no response body at all).

## 0.30.0 — 2026-07-12

**⚠️ Security review not yet run for this version.** `tenant-admin/index.ts` changed twice in this round (`archive_tenant`, and `update_tenant_hostnames` extended to `status = 'active'`, both below) without a `/security-review` pass afterward — deliberately deferred at the user's request, to be run before merge. **Whoever picks this up next: run `/security-review` against this branch's diff before merging or deploying**, per CLAUDE.md's "security-sensitive changes" rule (this touches tenant status transitions and public hostname resolution). Specifically worth the reviewer's attention: whether `archive_tenant`'s lack of a "from which status" allowlist (it accepts archiving from any non-archived status, including mid-provisioning) is intended, and whether the new active-tenant hostname edit's "immediate effect, no re-verification" behavior (explicit user choice, documented inline in that function) still holds up given `archive_tenant` now exists alongside it.

### Console: archive a tenant ("soft delete")
User asked for a way to remove a customer. Added `archive_tenant` to `tenant-admin/index.ts`: sets `status = 'archived'`, superadmin-gated and audit-logged like every other action in this file, refuses if already archived, atomic `.eq("status", tenant.status)` guard against a concurrent status change. Deliberately never a hard `DELETE` — the `tenants` row is the only thing this ever touches (the customer's actual data-plane Supabase project is untouched either way, so deleting the row wouldn't remove any customer data, only the audit trail via `broker_audit_log`'s `tenant_id` reference). Archiving is sufficient to fully stop public exposure with no extra code: `resolve_tenant_by_hostname()` only resolves `status = 'active'` unconditionally or `'provisioning'` with `schema_verified_at` set — `'archived'` matches neither branch. Console's tenant checklist now shows a red "Fareområde" card with a confirm-gated "Arkiver kunde" button (hidden once already archived).

### Fix: Phase 6 tenants had no way to set several "structural" content fields at all — not a per-tenant bug, a missing admin surface
Following up on the hero-CTA fix above, investigated why the gap existed at all. Root cause: `hero.ctaLabel`/`ctaTarget`, `about.heading`, `services.heading`/`intro`, `news.heading`/`intro`, and `contactSection.heading`/`intro`/`successMessage` are all real fields (added to `DEFAULT_CFG_SHAPE` in 0.27.4) that were designed, in the original single-tenant world, to be hand-set once in `config.js` by whoever builds the site — never exposed in any admin UI because they never needed to be. Phase 6 tenants have no `config.js` step at all (everything comes from the superconfig row, set via Console + the customer's own on-site admin), and neither Console's "web" tab (company/colors/fonts) nor the customer's own admin "Innhold" tab covered these fields — traced every `CFG.*` read site in `core.js`/`components.js` against every existing admin/Console tab to confirm this is the **complete, bounded list**: everything else (company, colors, fonts, privacy, features, contact info, about text, individual service cards/news posts) already has working admin/Console coverage, confirmed by the `Sunnvask` tenant's own superconfig row having real values for exactly those fields and empty/default values for exactly the ones listed above.

Two-part fix:
1. `DEFAULT_CFG_SHAPE` now seeds neutral **structural** defaults for these fields (`hero.ctaLabel: "Ta kontakt"`, `ctaTarget: "#kontakt"`, `about.heading: "Om oss"`, `services.heading: "Tjenester"`, `news.heading: "Aktuelt"`, `contactSection.heading: "Kontakt"`, `contactSection.successMessage: "Takk! Vi tar kontakt så snart vi kan."`) — these are generic section labels any business site would use, not Vibeverk's own marketing copy, so this doesn't reintroduce the 0.27.4 leak concern (title/subtitle/text/intro fields, the actual prose, stay empty).
2. Added the missing fields to the customer's own admin "Innhold" tab (`adminContent()` in `core.js`): CTA label/target under "Forsidetopp", a heading field under "Om oss", and two new fieldsets ("Tjenester-seksjon", "Aktuelt-seksjon") plus three new fields under "Kontaktinfo" (heading/intro/success message) — so these are no longer permanently stuck at whatever the default is. New `content.about.heading`, `content.servicesSection`, `content.newsSection`, `content.contactSection` keys added to the admin-editable `content` state (`loadContent()`/`registerBuiltinSections()`), following the same seed-from-CFG-then-allow-override pattern already used for `content.hero`/`content.about`.

`?v=N` bumped on `core.js`'s four script tags (defaults + admin fields) and `console/console-core.js` (archive action + UI).

### Fix: Tjenester cards on `Sunnvask` looked visually inconsistent vs. the reference site
User noticed the "Tjenester" section looked different from vibeverk.no's own demo cards. Root cause: `.cards` uses CSS Grid with `grid-auto-rows: 1fr` + `align-items: stretch` (intended to keep same-row cards equal height) — but `.card__text` itself had no cap, so a customer entering one long rich-text card (e.g. `Sunnvask`'s "Husvask" card: several paragraphs + a bullet list) alongside near-empty cards (two of `Sunnvask`'s three cards have no body text at all yet) forced the *entire row's* height to match the longest card, with nothing bounding how tall that could get. vibeverk.no's own reference cards all happen to be similar-length one-liners, so this never showed up there. Fixed with a visual clamp on `.card__text` in `index.html` (`max-height: 7.5em` + `-webkit-line-clamp: 5` for modern browsers) — caps displayed height regardless of how much text is entered; the full text is unaffected in storage/admin, only the front-end display is capped. No admin-side character-limit added (a display clamp handles the "must have a max size" ask without losing any of the customer's actual stored content).

## 0.29.0 — 2026-07-12

### Fix: hero CTA button rendered as an empty circle for tenants without hero content
User-reported bug on the `Sunnvask` tenant (`vibeverk-j1yg.vercel.app`): the hero section's "Kontakt oss"-style CTA button showed as a text-less round shape. Root cause: this tenant has a real superconfig row in its own Supabase `store` table (company/colors/fonts/privacy/features all set), but it predates the `hero`/`about`/`contact`/`news`/`services`/`contactSection` keys added by `DEFAULT_CFG_SHAPE` in 0.27.4 — so `hero.ctaLabel`/`hero.ctaTarget` fall back to the deliberately-empty defaults (see 0.27.4's entry: seeding real placeholder copy there would leak Vibeverk's own marketing text as if it were the customer's). `components.js`'s `hero()` rendered `button({label: d.ctaLabel, ...})` unconditionally, so an empty label produced a real but invisible/round `<button>`. Fixed by only rendering the CTA at all when both `ctaLabel` and `ctaTarget` are set. Verified against the tenant's actual live config + superconfig via a jsdom eval (no browser available in this sandbox).

### Console: allow editing a tenant's domain names after activation too
Follow-up to 0.28.0's `update_tenant_hostnames` action, which was gated to `status = 'provisioning'` only. User wants to be able to fix a hostname typo on an already-live customer, not just during onboarding. Extended the same action in `tenant-admin/index.ts` to also allow `status = 'active'`, atomic status re-check on the `UPDATE` itself unchanged (now `.eq("status", tenant.status)` instead of a hardcoded `'provisioning'`). Deliberately the **simple, immediate-effect** variant (explicit user choice over a safer re-verification-gated flow): `resolve_tenant_by_hostname()` already resolves an `'active'` tenant unconditionally regardless of `schema_verified_at`/`routing_verified_at` (see 0.28.0's security-finding fix), so there is no new exposure window here — the new hostname just starts resolving immediately, same as any other hostname on an active tenant. `schema_verified_at`/`routing_verified_at` are only reset to `NULL` when the tenant is still `'provisioning'` (unchanged from 0.28.0); for an active tenant they no longer gate anything, so clearing them would only misleadingly un-tick Console's steps 4/5 badges. Console's "1. Registrert" card now shows the editable field for both `provisioning` and `active` tenants, with a distinct "⚠️ takes effect immediately" hint for the active case instead of the provisioning-only re-verification hint.

## 0.28.0 — 2026-07-12

### Console: edit domain names for a tenant before activation
Testing the `phase6-canary` fix surfaced a real gap: Console's "Kundar" onboarding checklist had no way to edit a tenant's registered domain name(s) after step 1 ("Registrert") — `register_tenant` only ever creates a row once, and `tenant-admin`'s other actions only covered the connection (step 3), the service-role key (3b), schema verification (4), routing verification (5), and activation (6). A typo in a hostname, or moving from a temporary test domain to the real production domain right before go-live, had no fix short of registering a brand-new tenant.

Added `update_tenant_hostnames` to `supabase-control/supabase/functions/tenant-admin/index.ts`, following the exact same conventions as `update_tenant_connection`: gated on `status = 'provisioning'` (checked both before the write and atomically in the `UPDATE` itself, closing the same TOCTOU window the 2026-07-09 Security Auditor round fixed elsewhere in this file), same hostname-shape validation and hostname-uniqueness-trigger error mapping as `register_tenant`, and the same audit-log-before-mutate pattern. Console's "1. Registrert" card now shows an editable domain-name field while a tenant is still provisioning, and a plain read-only list once it's active (mirroring the backend gate, not just relying on it). No new migration needed — the existing hostname-overlap trigger already covers `UPDATE OF hostnames`, not just `INSERT`.

### Security review finding, fixed before merge: stale `schema_verified_at` reopened the provisioning-tenant exposure window
A security review of the above change (before deployment) found that `update_tenant_hostnames` reset `routing_verified_at` to `NULL` on every hostname change (correctly — a routing check against the *old* hostnames says nothing about the *new* ones) but left `schema_verified_at` untouched. `resolve_tenant_by_hostname()` (anon-callable, see `20260709224325_close_provisioning_tenant_exposure_window.sql`) gates whether a `provisioning` tenant's `data_plane_url`/`data_plane_anon_key`/etc. are publicly resolvable **solely** on `schema_verified_at IS NOT NULL` — it never checks `routing_verified_at`. Since this is the first-ever post-registration hostname-mutation path, switching a tenant's hostname after schema verification (an expected part of this feature's own use case — moving from a test domain to the real one before go-live) would have immediately exposed the *new* hostname's connection info via that anon RPC, before routing was ever verified for it, defeating the specific protection that migration was written to add. Fixed by also resetting `schema_verified_at: null` in the same `UPDATE` — any hostname change now requires both step 4 (schema) and step 5 (routing) to be re-verified before activation, not just step 5. Console's hint text updated to match.

**Not yet deployed**: this Edge Function change needs `npx supabase functions deploy tenant-admin --project-ref jxoglthrnshabqmdmnui` against `vibeverk-control` before it's live — pending explicit approval per the deployment safeguard.

---

## 0.27.4 — 2026-07-12

### Extend `DEFAULT_CFG_SHAPE` to content fields (`hero`/`about`/`contact`/`news`/`services`/`contactSection`)
Verified 0.27.3's fix live against the real `phase6-canary` tenant (production deploy of `vibeverk-j1yg.vercel.app`, fetched and executed its actual served `config.js`/`core.js`): the `applySuperConfig()` crash was confirmed gone, but a *different* crash immediately surfaced in `loadContent()` — `Cannot read properties of undefined (reading 'title')` on `CFG.hero.title` (`core.js:419`). Same root cause as 0.27.3, one tier further down: `api/tenant-config.js`'s skeleton never seeds `hero`/`about`/`contact`/`news`/`services`/`contactSection` at all, and `loadContent()`'s direct reads (`CFG.hero.title/subtitle/image`, `CFG.about.text/imageUrl`, `CFG.contact.email/phone/address/extra/social`, `CFG.news.posts`, `CFG.services.cards`, `CFG.contactSection.successMessage`) assumed — like the 0.27.3 fields — that a static `config.js` fork always populated them.

Fixed by extending the same `DEFAULT_CFG_SHAPE`/`fillConfigDefaults()` mechanism from 0.27.3 to cover these six keys. Deliberately seeded with **empty** values (`title: ""`, `cards: []`, etc.), not `config.js`'s own demo/placeholder copy ("Klare råd. Konkrete resultater.", the sample service cards, the seed blog posts) — copying that in would have silently shown Vibeverk's own marketing/demo content on a real customer's freshly-provisioned site as if it were their content, the same class of bug as the CFG-fallback leak fixed in 0.27.2 (see that entry, point 2). Re-verified against the exact live config fetched from `vibeverk-j1yg.vercel.app`: `App.init()` now completes with no throw. `?v=N` bumped on `core.js`'s four script tags.

---

## 0.27.3 — 2026-07-12

### Fix white-screen/crash-loop on new Phase 6 tenants: missing nested `CFG` objects
A new tenant onboarded through the Phase 6 dynamic-config path (`api/tenant-config.js`, resolved via `middleware.js`/`resolve_tenant_by_hostname`) got a white page: first an uncaught `TypeError: Cannot read properties of undefined (reading 'name')` at `core.js` `applyTheme()` (`CFG.company` undefined), then — after that fix — `Cannot set properties of undefined (setting 'text')` at `applySuperConfig()` (`CFG.privacy` undefined). Root cause in both cases: `api/tenant-config.js` deliberately generates a minimal `window.SITE_CONFIG` skeleton (`supabase`/`storageKey`/`productMode`/`features`/`intranettFeatures`/`theme` only — full branding/privacy/admin is meant to come later from the superconfig/broker layer, applied inside `boot()`). `core.js` was written before Phase 6 existed, when `CFG` always came from a static per-customer `config.js` fork guaranteeing every nested object (`company`, `colors`, `fonts`, `privacy`, `admin`, `workspace`) — several read/write sites (`applyTheme()`'s title line, `applySuperConfig()`'s `Object.assign(CFG.company, ...)`/`Object.assign(CFG.privacy, ...)`/`CFG.privacy.text = ...`/`CFG.admin.password = ...`) never got updated to tolerate that gap.

Fixed centrally instead of patching each site: a `DEFAULT_CFG_SHAPE` constant plus `fillConfigDefaults()`, a recursive "fill missing nested keys, never overwrite existing ones" merge (not a naive top-level `{...DEFAULT, ...config}` spread, which would fail to backfill a *partially* nested object, e.g. `privacy: { heading: "x" }` missing `text`). Runs once, right where `CFG` is captured at the top of `core.js`, mutating `window.SITE_CONFIG` in place (kept as the same object reference, since `module-chat.js`/`console-core.js`/workspace modules read `window.SITE_CONFIG` directly and must see the same filled-in fields). Logs a `console.warn` listing any missing top-level fields instead of crashing. `?v=N` bumped on `core.js`'s four script tags (`index.html`, `admin/index.html`, `workspace/index.html`, `console/index.html`).

---

## 0.27.2 — 2026-07-10

### Five-source parallel review (Codex + 4 read-only Claude reviewers) — top 4 findings fixed
After Phase 6 shipped and H2 was closed, ran a genuine independent second-opinion review: an external Codex security-review pass (run by the user directly in their own Codex chat, prompt written to match the earlier Claude-based Security Auditor's structure) plus 4 parallel read-only Claude subagents (`vibeverk-privacy-compliance`, `vibeverk-architect`, `vibeverk-qa`, `vibeverk-ux-mobile-reviewer`, explicitly instructed with no code changes). Synthesized all five into one report; user approved fixing the four highest-confidence findings ("Fiks alle fire nå").
1. **Console write-race** (found independently by Codex and the QA agent): switching the active tenant mid-save could write config to the wrong tenant, because save handlers re-read `_activeTenant.id` at write time instead of capturing it when the form was opened. Fixed in `console/console-core.js` — `saveSC`/`resetSC`/`saveSCPrivate` now accept an explicit `tenant_id` and every submit handler (Produkt, Web, Workspace, Modular, Analyse, Personvern, System/admin-password) captures `_activeTenant.id` up front, before any async gap, and passes it through explicitly.
2. **CFG-fallback leak** (found by the UX-mobile reviewer, verified in code): several Console settings tabs merged a brand-new tenant's empty config against `CFG.*` — Console's own boot config, i.e. the real *primary* tenant's live values — so a new tenant's forms silently showed (and could save) the primary tenant's actual branding/colours/fonts/features/privacy text instead of blank/neutral defaults. Fixed across `renderProdukt`, `renderWeb` (incl. its colour/font reset button), `renderWorkspace`, `renderModular` (features/intranettFeatures — base key-set now comes from the existing `FEAT_LABELS`/`IFEAT_LABELS` label maps so the checkbox grid still renders all known features, just unchecked-by-default-true rather than leaking real flags), `renderPersonvern` (privacy text/heading), and `renderSystem` (the "Supabase-prosjekt" display now shows `_activeTenant.data_plane_url`/`data_plane_anon_key` — the *selected* tenant's own project — instead of Console's own boot config, which was always the primary tenant's real project URL/anon key mislabeled as if it were whichever tenant was selected).
3. **Redirect-following gap** (found by Codex, verified in code): `verify_tenant_routing`'s outbound `fetch()` in `tenant-admin/index.ts` had no `redirect` option, so a hostname that passed `assertHostnameSafeToFetch` could still 30x-redirect to an unvalidated/private target, and the function would fetch and trust that response. Fixed with `redirect: "manual"` plus explicit rejection of any 3xx/`opaqueredirect` result.
4. **IPv6/AAAA gap** (found by Codex, verified in code): `isPrivateOrReservedIp()` already had IPv6 patterns (`::1`, `fe80::/10`, `fc00::/7`) but they were unreachable — only `"A"` records were ever resolved in `assertHostnameSafeToFetch`, so a hostname resolving solely to a private `AAAA` target slipped through unchecked. Fixed by also resolving `"AAAA"` and checking those results too; a normal "no AAAA record" lookup failure is not treated as blocking (unlike an `"A"` lookup failure, which still is).

`node test.js`/`node test-workspace.js` re-run clean (503/1, 151/1 — the `test.js` baseline shifted from 504 to 503 earlier this session due to an unrelated pre-existing fluctuation, confirmed via `git stash` to reproduce with none of this session's changes applied). Cache-bust: `console-core.js` 71 → 72.

## 0.27.1 — 2026-07-09

### H2 fix deployed and verified live
Migration applied to `vibeverk-control` via Dashboard SQL Editor, confirmed via `pg_get_functiondef()` showing the exact new `WHERE` clause (not just "Success"). `tenant-admin` redeployed with the `verify_tenant_routing` precondition check, confirmed via negative-path check (401, no auth). A real anon-key REST call to `resolve_tenant_by_hostname` confirmed both grant preservation and that the already-active `phase6-canary` tenant still resolves correctly, unaffected by the new precondition. Docs-only otherwise (ADR-0007 updated). Cache-bust: `console-core.js` 70 → 71 (version string only).

## 0.27.0 — 2026-07-09

### Security Auditor finding H2 fully closed (provisioning-tenant exposure window)
Closes the one accepted-for-now risk item left over from the Phase 6 Security Auditor review — the user explicitly asked to close this before running a fresh security review and doing version bookkeeping on the rest of the session's work.
- **Before**: a `'provisioning'` tenant (real hostname, real Supabase credentials) was fully publicly servable from the moment steps 1–3 of onboarding were done (register + connection + secret) — well before schema/RLS verification (step 4) ever ran.
- **Fix**: new migration `supabase-control/supabase/migrations/20260709224325_close_provisioning_tenant_exposure_window.sql` — `resolve_tenant_by_hostname()` now only resolves a `'provisioning'` tenant once `schema_verified_at` is set. No circularity introduced: `verify_tenant_schema` never depended on hostname resolution, and the checklist's own step order already guarantees schema-verify (step 4) runs before routing-verify (step 5) needs the tenant to resolve.
- `verify_tenant_routing` also now checks this precondition explicitly for a clear error message, instead of a confusing per-hostname "HTTP 404" if ever called out of order via direct API access.
- **Security Auditor pass on this fix: verdict PROCEED**, no BLOCKER/HIGH. One MEDIUM accepted and documented in the ADR (not fixed): `schema_verified_at` is a point-in-time flag with nothing re-validating it before `activate_tenant` — pre-existing, out of scope for this patch, narrow practical exposure today.
- Full detail in `docs/decisions/ADR-0007`'s Phase 6 addendum. `node test.js`/`node test-workspace.js` re-run clean (504/1, 151/1). **Migration written, not yet deployed** — pending explicit approval, same as the standing safeguard for every remote Supabase action. Cache-bust: `console-core.js` 69 → 70 (version string only).

## 0.26.2 — 2026-07-09

### `broker` redeployed with the `analytics` config-key fix
`broker` Edge Function redeployed to `vibeverk-control` (`analytics` added to `ALLOWED_CONFIG_KEYS`, see 0.26.1). Verified live via a negative-path check (no `Authorization` header → 401), not just a clean deploy message. Docs-only otherwise (ADR-0009 updated). Cache-bust: `console-core.js` 68 → 69 (version string only).

## 0.26.1 — 2026-07-09

### Console's tenant picker was never actually tenant-aware for config reads — fixed
Found directly by the canary test: picking the new tenant in Console's sidebar and editing its settings silently showed and saved the *real* `vibeverk` tenant's values instead. Architect-consulted before fixing (cross-cutting change).
- **Root cause**: `getSC()` read a local cache populated once at page load from whichever project Console's own `config.js` pointed at (always the real tenant) — completely independent of `_activeTenant`. `saveSC()` *did* correctly route the actual write through `broker` (respecting the picked tenant), but also polluted that same local cache as a side effect.
- **Fix**: `getSC()`/new `getStoreKey()` now read `superconfig` directly from the browser via a plain anon-key REST call against whichever tenant is picked — `superconfig` is intentionally anon-readable by RLS design (same pattern `core.js` itself already uses), so no broker/backend change was needed for this part. `renderSection()`'s dispatcher and 5 submit handlers converted from sync to async reads, with a generation-token guard against a stale callback writing into a reused DOM element. `saveSC()`/`resetSC()`'s local-cache side effects removed.
- **Second, more serious bug found while scoping this**: `renderAnalyse` (Plausible settings) used `App.store` directly and **never actually reached Supabase for any tenant, including the real one** — edits were silently lost on reload. Fixed the same way: `"analytics"` added to `broker`'s `ALLOWED_CONFIG_KEYS`, routed through the same tenant-scoped read + broker write.
- **Not fixed, flagged as follow-up**: `resetSC()` silently switches the operator to a different (alphabetically-first) tenant after reload, with no indication that happened.
- `broker` Edge Function changed (`analytics` key) — **not yet redeployed**, pending explicit approval.
- Full detail in `docs/decisions/ADR-0009`'s new addendum. `node test.js`/`node test-workspace.js` re-run clean (504/1, 151/1) — neither harness loads `console-core.js`. Cache-bust: `console-core.js` 67 → 68.

## 0.26.0 — 2026-07-09

### Phase 6 fully proven: positive-path canary tenant live end-to-end
The user ran the complete onboarding checklist live through Console against a real canary tenant (`phase6-canary`, hostname `vibeverk-j1yg.vercel.app`, data-plane `vibeverk-staging`): register → connection → secret → schema-verify (RLS confirmed on) → routing-verify (a real HTTPS call from `vibeverk-control` to the public hostname) → activate — all succeeded for the first time via real code, not a manual `UPDATE`.
- **Confirmed via an actual browser visit**: `https://vibeverk-j1yg.vercel.app/` now renders a real Vibeverk page (not the earlier 404); `curl /config.js` shows the generated config correctly pointing at `vibeverk-staging` with `storageKey: "canary"` — this tenant's own values.
- Page appears visually "empty" (default tagline, active chat widget, no real content) — **expected**, not a bug: no `superconfig`/content rows exist yet for this tenant, and full branding parity was always deliberately out of scope for `api/tenant-config.js` (see ADR-0007's Phase 6 addendum). That layer works the same way it already does for the one real customer, via Console's normal config editor.
- **This closes every item on Phase 6's "explicitly NOT done" list.** The actual blocker for onboarding customer #2 (identified back in Fase 9/ADR-0010) no longer exists as a technical gap — remaining before a *real* (non-canary) customer: the accepted-for-now Security Auditor risk items (H2's exposure window, DNS-rebinding) and a decision on cleaning up/repurposing the canary tenant and Vercel project.
- Docs-only otherwise (ADR-0007 updated). Cache-bust: `console-core.js` 66 → 67 (version string only).

## 0.25.4 — 2026-07-09

### Live Vercel deployment test: `middleware.js` + `api/tenant-config.js` confirmed working
Resolves the "no live deployment test yet" gap from the Phase 6 ADR. Reused the existing `vibeverk-j1yg` Vercel project (the earlier `.js`-vs-`.mjs` isolation-test project, already `Framework Preset: Other`) — its own `vibeverk-j1yg.vercel.app` address is a real, free, DNS-free hostname, no new domain purchase needed.
- `VIBEVERK_CONTROL_URL`/`VIBEVERK_CONTROL_ANON_KEY` env vars set and deployed via `vercel --prod`.
- **Real bug found and fixed**: Vercel CLI's `vercel env add` with a piped-stdin value silently saved an empty string despite a clean "✓ Added" confirmation — traced via a live 502 (`TypeError: Invalid URL string`) in `api/tenant-config.js`. Fixed using the explicit `--value "..." --no-sensitive` flag instead, verified by actually pulling the value back down before redeploying. New memory saved on this CLI gotcha for future sessions.
- Verified against the real deployment (negative-path, unregistered hostname): `curl -i https://vibeverk-j1yg.vercel.app/` → real 404 with middleware's own message (not `index.html`); `curl -i https://vibeverk-j1yg.vercel.app/config.js` → 404 with `window.SITE_CONFIG = null;`.
- **Still not done**: the positive-path end-to-end test (register a canary tenant, full checklist, confirm a real page renders) — needs either a live Console session or a directly-authenticated API call as the superadmin operator.
- Docs-only otherwise (ADR-0007 updated). Cache-bust: `console-core.js` 65 → 66 (version string only).

## 0.25.3 — 2026-07-09

### `tenant-admin`/`broker` Edge Functions redeployed to `vibeverk-control`
Both functions redeployed (`npx supabase functions deploy ... --workdir supabase-control`), bringing them up to date with this session's work: both Security Auditor rounds' fixes and the new `verify_tenant_routing` action. Verified live via a real negative-path check (no `Authorization` header → 401 on both endpoints), not just a clean deploy message.
- **`middleware.js` and `api/tenant-config.js` still not deployed anywhere** — no Vercel project has either file yet. No real hostname's servability changes as a result of this deploy.
- Docs-only otherwise (ADR-0007 updated). Cache-bust: `console-core.js` 64 → 65 (version string only).

## 0.25.2 — 2026-07-09

### Phase 6 SQL migrations deployed and verified live (Edge Functions still not deployed)
Both Phase 6 SQL migrations applied for real, each followed by a direct verification query — not just a clean "Success" message, per this repo's own standing rule.
- `supabase/migrations/20260709193227_add_rls_check_to_schema_fingerprint.sql` → `vibeverk-staging`: confirmed `verify_schema_fingerprint()`'s new `rls_enabled` column, and a real call returned `rls_enabled = true` for all 5 expected tables.
- `supabase-control/supabase/migrations/20260709170108_phase6_hostname_resolver_hardening.sql` (plus the still-pending `20260709160626` from the prior security round) → the real `vibeverk-control` project, since it has no staging replica of its own. Pre-check confirmed zero `tenants` rows would violate the new `data_plane_url` CHECK constraint before running. Confirmed live: widened `resolve_tenant_by_hostname()` (now returns `data_plane_storage_key`), the hostname-overlap trigger, `schema_verified_at` column, atomic `store_tenant_service_role_key()`. The one real tenant's `hostnames` (`vibeverk.no`) present and lowercase.
- **Still not deployed anywhere**: the `tenant-admin`/`broker` Edge Functions, `middleware.js`, `api/tenant-config.js`. This round is SQL-only — no real hostname is any more or less servable than before.
- Docs-only change otherwise (ADR-0007/ADR-0010 updated with deployment confirmation). Cache-bust: `console-core.js` 63 → 64 (version string only).

## 0.25.1 — 2026-07-09

### Pre-merge Security Auditor review of Phase 6: 2 HIGH + 1 MEDIUM + 2 LOW fixed
A Security Auditor pass over the 0.25.0 diff, before merging to `main`, returned verdict **CAUTION** (not the clean PROCEED of the two prior control-plane rounds). Full detail in `docs/decisions/ADR-0007`'s Phase 6 addendum.
- **H1**: `HOSTNAME_RE`'s own comment claimed it rejected bare IP literals — it didn't (`127.0.0.1`/`169.254.169.254` matched the domain shape fine), handing `verify_tenant_routing`'s real outbound fetch an SSRF-adjacent target. Fixed: new `IPV4_LITERAL_RE` rejection plus a real server-side DNS resolution + private/reserved-range check (`assertHostnameSafeToFetch`) before any fetch. DNS-rebinding is not fully closed — accepted residual risk given the superadmin gate and audit logging.
- **H2**: widening `resolve_tenant_by_hostname()` to `'provisioning'` tenants means a tenant's real hostname/credentials go publicly live before RLS is meaningfully checked — `verify_tenant_schema` only confirmed tables *exist*, not that RLS was enabled. Fixed: `verify_schema_fingerprint()` (new migration `supabase/migrations/20260709193227_add_rls_check_to_schema_fingerprint.sql`) now also reports `rls_enabled` per table; `verify_tenant_schema` requires it. Narrows but doesn't eliminate the exposure window — tracked for before any real customer's hostname goes live.
- **M1**: the new hostname-uniqueness trigger was a real TOCTOU race under READ COMMITTED. Fixed with a fixed-key `pg_advisory_xact_lock` serializing hostname-mutating transactions.
- **L1/L2**: missing `NOTIFY pgrst, 'reload schema'` after the `resolve_tenant_by_hostname` DROP+CREATE; no timeout/size-cap on `verify_tenant_routing`'s outbound fetch. Both fixed (5s timeout, 64KB cap).
- `node test.js`/`node test-workspace.js` re-run clean (504/1, 151/1). Still not deployed anywhere — code + migrations only. Cache-bust: `console-core.js` 62 → 63 (schema-verify result display now also shows RLS gaps).

## 0.25.0 — 2026-07-09

### Phase 6: real hostname→tenant resolver (code only, not yet deployed)
Architect-designed (second consult, read-only) implementation of the real hostname→tenant resolver that Phase 9's `activate_tenant` has been hard-gated on since it was built. Full design rationale in `docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md`'s new Phase 6 addendum.
- **Found and fixed a real circular dependency before it could block anything**: `resolve_tenant_by_hostname()` only resolved `status='active'` tenants, but the only way to *set* `routing_verified_at` (required for activation) is a live HTTP check through the tenant's hostname — which needs the RPC to resolve a `'provisioning'` tenant. Widened the RPC's status filter, added case-insensitive hostname matching, and added `data_plane_storage_key` to its output (new migration `20260709170108_phase6_hostname_resolver_hardening.sql`).
- **New hostname-uniqueness trigger**: no constraint previously stopped two tenants from claiming the same hostname (only `slug` is `UNIQUE`) — a real cross-tenant config leak risk via this same RPC. Enforced via a `BEFORE INSERT OR UPDATE` trigger using Postgres's array-overlap operator, since `hostnames` is an array column.
- **New `tenant-admin` action `verify_tenant_routing`**: real server-side HTTP checks (never a client-supplied claim) against every registered hostname, confirming both a 200 and that the response actually names this tenant's own project — sets `routing_verified_at` on a full pass, clears it on any failure. Hostnames are validated against a domain-shape regex before any outbound fetch (same SSRF-adjacent discipline as the earlier `data_plane_url` finding).
- **New `api/tenant-config.js`** (Vercel Function) generates `window.SITE_CONFIG=...` per request from the control plane instead of a static per-customer `config.js` fork — deliberately minimal (no full branding parity; the existing superconfig/broker layer still supplies that after activation).
- **`middleware.js` rewritten** from the Host-echo mechanism-proof to the real implementation: rewrites `/config.js` to the new function, and resolves the tenant for page requests so an unknown hostname gets a real 404. Still named `middleware.js`, never `.mjs` (see the 2026-07-08 ADR-0007 addendum).
- **Console**: the "5. DNS / gå-live" checklist card is no longer permanently greyed out — it calls `verify_tenant_routing` and shows per-hostname results; "6. Set aktiv" unlocks from the real result instead of an always-false placeholder. `loadTenants()`'s SELECT extended with `data_plane_service_role_secret_id`/`schema_verified_at` to match.
- **Deliberately NOT done**: no live deployment, no DNS/domain test, no fresh Security Auditor pass on the new outbound-fetch action yet — all explicitly called out in the ADR addendum as required before any real (non-canary) tenant depends on this. Nothing here touches `vibeverk.no`, which stays on GitHub Pages untouched.
- `node test.js`/`node test-workspace.js` re-run clean (504/1, 151/1) — none of the new files are exercised by the jsdom harnesses; correctness here rests on code inspection plus the still-pending live verification. Cache-bust: `console-core.js` 61 → 62.

## 0.24.1 — 2026-07-09

### Pre-merge Security Auditor review of 0.24.0: 2 MEDIUM fixes (TOCTOU, unaudited auth failures)
A fresh Security Auditor pass over the 0.24.0 diff before merging to `main` found no BLOCKER/HIGH code findings (verdict: PROCEED WITH NOTED RISKS) but two MEDIUM gaps, fixed on the same branch. Full detail in `docs/decisions/ADR-0010-phase9-semi-automated-onboarding.md`'s second addendum.
- **M1 (TOCTOU)**: the 0.24.0 status guards were check-then-act in application code, not atomic. `update_tenant_connection`/`activate_tenant`'s own `UPDATE`s now repeat `.eq("status", "provisioning")`; `store_tenant_service_role_key()` (the one write via RPC) got the equivalent fix inside the SQL function via `GET DIAGNOSTICS`/`RAISE EXCEPTION`. A zero-row result now returns 409, not a false "success."
- **M2**: authorization failures (inactive operator, wrong role) weren't audit-logged in either function. Body parsing moved earlier in both so the rejected `action`/`tenant_id` can be logged even on a 403.
- Flagged but not code — an **operational pre-deploy check**: nothing in this repo's migrations ever sets `operators.role = 'superadmin'`, so before `tenant-admin` (which now requires it for every action) is deployed, the live `vibeverk-control` operator row must be confirmed as `superadmin` first, or every action 403s for the only real operator. Added to ADR-0010's pre-deploy checklist.
- `node test.js`/`node test-workspace.js` re-run clean (504/1, 151/1). Still not deployed anywhere — code + migration only. Cache-bust: `console-core.js` 60 → 61 (version string only).

## 0.24.0 — 2026-07-09

### Security Auditor follow-up round 2: 5 fixes on `tenant-admin`/`broker` (control plane)
A deeper Security Auditor pass against `supabase-control/supabase/functions/tenant-admin/index.ts` and `broker/index.ts`, prompted by the user, found and fixed five issues beyond the 0.22.2 follow-up. Full detail in `docs/decisions/ADR-0010-phase9-semi-automated-onboarding.md`'s new addendum. Summary:
- **HIGH**: `update_tenant_connection`/`set_tenant_service_role_key` had no status guard — a compromised active operator could repoint or re-key an already-**live** tenant, not just one mid-onboarding. Now refuse unless `tenant.status = 'provisioning'`.
- **MEDIUM/HIGH-future**: `activate_tenant` only checked `routing_verified_at`. New `tenants.schema_verified_at` column (set by `verify_tenant_schema` on pass, cleared on fail); `activate_tenant` now also requires `status = 'provisioning'`, a non-empty connection, a stored service key, and `schema_verified_at` — `routing_verified_at` remains the unconditional hard gate (Phase 6 still doesn't exist).
- **MEDIUM**: `operators.role` was never checked on this function (only `status`). `tenant-admin` now requires `role = 'superadmin'` for every action, uniformly. `broker` left unchanged (lower-risk, day-to-day config surface).
- **MEDIUM**: audit logging was fail-open — a failed insert only logged to console and the mutating action proceeded anyway. New `auditStart`/`auditFinish` pair writes the row (`result = 'pending'`) **before** mutating actions run in both functions and aborts with 500 if that insert fails.
- **LOW**: `data_plane_url` validation existed only in the Edge Function. New DB-level `tenants_data_plane_url_format` CHECK constraint as a defense-in-depth backstop.
- Console: `update_tenant_connection`'s submit handler silently swallowed errors (no status message shown, unlike the other checklist forms) — now shows `r.error` via a new `#kd-conn-status` element, since the new status-guard above gives this path a real failure mode to surface.
- New migration `supabase-control/supabase/migrations/20260709160626_security_auditor_followup2_tenant_admin_hardening.sql` — **written but NOT deployed**, per the standing deployment safeguard. Needs to run against `vibeverk-staging` first and be verified there before `vibeverk-control`.
- `node test.js`/`node test-workspace.js` re-run clean against the known baseline (504/1, 151/1) — these Edge Functions and this migration aren't covered by the jsdom harnesses; correctness here rests on code inspection plus the eventual staging verification.
- No changes to the public site, Workspace, or production Supabase project. Cache-bust: `console-core.js` 59 → 60.

## 0.23.1 — 2026-07-09

### CI: also trigger on `pull_request`, not just `push`
Discovered while setting up GitHub branch protection (Steg 1 of the dev-workflow prep): `test.yml` only triggered `on: [push]`, so its status check wasn't reliably showing up for selection as a required check in the branch protection UI, and wouldn't robustly attach to a PR going forward. Changed to `on: [push, pull_request]`. Note: a push to a branch with an open PR will now run CI twice (once per event) — harmless (public repo, free Actions minutes), not worth adding concurrency-cancellation complexity for right now.

## 0.23.0 — 2026-07-09

### Dev-flow prep before Phase 6: dedicated staging Supabase project
- New `vibeverk-staging` Supabase project (ref `syqnyfeponexmkdvnsga`), created as part of the dev-workflow review's top-priority recommendation: give migrations somewhere safe to land before they touch production. `supabase db push --linked` today points straight at the production project with no separate environment in between.
- All 4 existing `supabase/migrations/` files (baseline schema + the two `service_role` grant fixes + the schema-fingerprint RPC) applied and verified against it directly (`information_schema.tables`/`routines`/`role_table_grants`), not just a clean CLI exit code — confirms staging's schema now matches production exactly.
- The local `supabase/` working copy stays linked to production (`clzczbyklgdtdhgjphup`); staging is reached only via explicit `--db-url` (pooler connection string), same pattern already used for `supabase-control/`. No CLI relink performed — deliberately left as an open decision, not assumed.
- Deliberately not done yet: seeding a fixed demo-tenant/config row into staging (depends on an undecided question — whether/how this project should be registered in `vibeverk-control`'s tenant table, which in turn depends on Phase 6 existing). Not yet wired into any CI/Preview-deploy flow.
- No changes to production, the public site, Workspace, or Console's behavior. `CLAUDE.md`'s Supabase rules section and `docs/project/CURRENT_STATE.md` updated to record the new project. Cache-bust: `console-core.js` 57 → 58 (version bump only, no functional change).

## 0.22.2 — 2026-07-09

### Phase 9 Security Auditor follow-up: 3 fixes (URL validation, missing field, operator self-escalation)
- **M1**: `update_tenant_connection` (`tenant-admin` Edge Function) now validates `data_plane_url` matches a real Supabase project URL shape (`https://xxxx.supabase.co`) before storing it — previously accepted any string, which `verify_tenant_schema` then used as an outbound request target with an operator-supplied key, an SSRF-adjacent relay primitive once more than one operator exists.
- **M2**: `loadTenants()` was still missing `data_plane_anon_key` from its SELECT (a follow-up gap in the same fix as 0.22.1) — the connection form rendered the anon-key field blank and would silently overwrite a previously saved key with an empty string on resubmission.
- **M3 (pre-existing, not from Phase 9 itself, surfaced during the follow-up review)**: `operators_operator_all` RLS policy let any active operator write to *any* operator's row directly, including self-escalating role to `superadmin` — same class of gap as the `tenants_operator_all` fix from Phase 8, just missed for the sibling table. Narrowed to read-only (new migration `20260708222400_restrict_operators_to_read_only.sql`).
- All three verified live: a fake connection URL is now rejected (400) while a real one succeeds; a direct PATCH attempt against an operator's own row now returns zero affected rows.
- Also set up Resend custom SMTP for `vibeverk-control`'s Auth emails (Dashboard-only config, not tracked in repo) — removes the very low default rate limit on Supabase's built-in email sender, and copied the production Magic Link email template (code-only, no clickable link) so Console's OTP login screen actually receives a code to type.
- Cache-bust: `console-core.js` 56 → 57.

## 0.22.1 — 2026-07-08

### Fix: Kundar-sjekklista viste alltid tom status/tilkopling
`loadTenants()` henta berre `id, slug, hostnames` — nok for tenant-veljaren, men Kundar-sjekklista (status-merke, "kopla"/"ikkje kopla", aktiverings-sperra) treng òg `status`/`data_plane_url`/`data_plane_storage_key`/`routing_verified_at`. Funne under gjennomtenking av kva som bør manuelt testast etter Fase 9, før nokon faktisk merka det som ein synleg feil. Utvida SELECT-lista. Ingen SQL- eller Edge Function-endring. `test.js`/`test-workspace.js` uendra (504/1, 152/151/1).

## 0.22.0 — 2026-07-08

### Phase 9: semi-automated onboarding v1 (checklist bookkeeping, hard-gated from go-live)
- New "Kundar" section in Console: tenant list, "+ Ny kunde" registration form, and a per-tenant onboarding checklist (register → manual Supabase project creation → connection info → service_role secret → schema verification → DNS/go-live (hard-blocked) → activate (disabled)).
- New `tenant-admin` Edge Function in `vibeverk-control` (kept separate from `broker` so this newer write surface doesn't touch that already-reviewed code path): `register_tenant`, `update_tenant_connection`, `set_tenant_service_role_key` (writes via Vault, never a plain column), `verify_tenant_schema` (cross-project check against a new `verify_schema_fingerprint()` RPC added to the production baseline), `activate_tenant`.
- **Hard structural gate, per the Architect's explicit recommendation**: new `tenants.routing_verified_at` column, nullable, set by nothing in this codebase — `activate_tenant` refuses unconditionally until a future Phase 6 resolver sets it. This is deliberate: Phase 6's real hostname→tenant resolver still doesn't exist (only a mechanism-proof), so no tenant onboarded through this checklist can be treated as actually servable yet.
- **Deliberately not automated**: creating the actual new Supabase project — would need an org-scoped Management API token with power over every project, a bigger secret class than anything else in this architecture, and can't carry the same per-step human confirmation a chat-confirmed CLI command gets. Stays manual: operator creates it themselves, pastes results into Console.
- **Real bug found via live testing**: the `vibeverk-control` migration was initially reported as run but hadn't actually applied — every action except `register_tenant` failed with "unknown tenant" until this was caught by directly querying `pg_proc`/`information_schema.columns` rather than trusting the Dashboard's "Success" message (which only means no syntax error, not that a specific object exists).
- New `docs/decisions/ADR-0010-phase9-semi-automated-onboarding.md`.
- Verified live end-to-end with a disposable test tenant: registration, connection info, secret storage, and the activation gate all confirmed working via a real browser session (Supabase Auth token injected into a real Playwright-driven page, not a mock) — schema verification correctly failed against the fake test project, activation correctly refused. All test data (tenant rows, audit log entries, the fake Vault secret) removed afterward and confirmed via re-query.
- No changes to the public site, Workspace, or the existing broker/broker-ping functions. Cache-bust: `console-core.js` 53 → 55.

## 0.21.0 — 2026-07-08

### Phase 8: Console now authenticates against the control plane; first real broker actions
- Console's OTP login now goes against `vibeverk-control` instead of the customer's own Supabase project — the client-side `SUPERADMIN_EMAILS` pre-check (run before the code was even sent, an unauthenticated "does this email exist" oracle) is removed; the real access check (`operators.status = 'active'`) now happens after OTP verification. A tenant picker was added to the sidebar (only one tenant exists today, but built now to avoid a second rewrite at customer #2). A real, previously-documented bug is fixed in the same pass: the old 48h `localStorage` timestamp could say "authenticated" long after the underlying session had actually expired — `isAuthed()` now reflects a real, live Supabase session.
- New `broker` Edge Function in `vibeverk-control`: `get_private_config`/`set_config`/`reset_config` (keeps Console's settings read/write working now that auth moved) and `get_tenant_status` (extends Phase 7's `broker-ping` mechanism-proof into something useful — reachability, user count). Every action writes to a new `broker_audit_log` table before returning (success or failure, never secret values) — readable by any active operator, writable only by the broker's own service-role connection.
- Deliberately not built: inviting/removing a data-plane user via the broker — overlaps a still-undecided "support access" question that needs Privacy/Compliance input, not pre-empted here.
- **Second real bug found via live testing (not just a clean deploy)**: production's `service_role` had never been granted `SELECT`/`INSERT`/`UPDATE`/`DELETE` on the `store` table (only `REFERENCES`/`TRIGGER`/`TRUNCATE`) — harmless until the broker's cross-project write became the first thing to ever need it. A related gap surfaced right after: an `UPSERT ON CONFLICT` needs sequence `USAGE` on `store_id_seq` even when the final action is an `UPDATE`. Both fixed via new **production** migrations (`20260708192115_grant_service_role_store_access.sql`, `20260708194415_grant_service_role_store_seq.sql`), verified directly via `information_schema.role_table_grants`.
- `CLAUDE.md` updated with the general lesson: `service_role` bypasses RLS but is not a superuser — it still needs ordinary table/sequence grants checked explicitly for any new consumer, same class of gotcha as Phase 7's default-ACL discovery.
- New `docs/decisions/ADR-0009-console-control-plane-auth-and-broker-actions.md` records the full design and both bugs.
- Verified live end-to-end against production (not clean exit codes): real OTP login, `get_tenant_status` returning the real user count, a `get_private_config` → `set_config` → `get_private_config` round-trip proving the write path leaves values unchanged, and negative-path checks (missing auth → 401, unknown action → clean 400). `reset_config` was **not** tested live (it deletes real configuration) — verified by code inspection and shared code path only.
- **Not yet done**: Security Auditor pass (required per ADR-0008/ADR-0009 before relying on this beyond the current single customer), and the `git push` of this work (local commit only, pending explicit approval).
- No SQL changes to `vibeverk-control`'s schema beyond what Phase 7 already had except the new `broker_audit_log` table and `tenants.data_plane_storage_key` column (separate small migration, already applied). Public site and Workspace unaffected. Cache-bust: `console-core.js` 51 → 53.

## 0.20.2 — 2026-07-08

### Phase 7 mechanism-proof completed: control-plane/data-plane split, `vibeverk-control` Supabase project
- New dedicated Supabase project `vibeverk-control` (ref `jxoglthrnshabqmdmnui`) standing in as the control plane — `tenants`/`operators` tables, RLS, `resolve_tenant_by_hostname()` anon-safe RPC (explicit column list), `get_tenant_service_role_key()` Vault accessor (executable only by `service_role`/`postgres`), and a `broker-ping` Edge Function proving the full cross-project broker chain: operator auth → tenant lookup → Vault secret decrypt → cross-project `service_role` call against the real production project (`clzczbyklgdtdhgjphup`), verified end to end via a real operator login and a real HTTP call returning `success: true`, plus a negative-path check (no Authorization header → 401).
- New `docs/decisions/ADR-0008-control-plane-data-plane-split.md` records the design rationale and consequences (Architect-consulted before implementation, per CLAUDE.md).
- **Real bug found and fixed along the way**: Supabase's platform default ACLs (`pg_default_acl`) grant `EXECUTE` on new functions directly to `anon`/`authenticated`/`service_role`, independent of `PUBLIC` — a migration that only revokes from `PUBLIC` does not actually block `anon`. Fixed via an explicit follow-up migration revoking from `anon` directly; `CLAUDE.md`'s Supabase rules section now states this as a standing rule.
- Per-tenant `service_role` keys are never stored as plain columns — stored via Supabase Vault, decrypted only inside the `SECURITY DEFINER` accessor function, never returned to any caller.
- Repo layout: `supabase-control/` added as a sibling to `supabase/` (the existing directory, still linked to production, untouched) — its own `supabase/migrations/` history, deployed via explicit `--db-url` (pooler connection string) rather than `supabase link`, since this CLI version's `db push`/`db query` don't support `--project-ref` (only `functions deploy` does) and the two projects' local link state must not collide. `CLAUDE.md`'s repository-layout section updated accordingly.
- **Scope note**: this is a mechanism-proof only — `broker-ping` is read-only and nothing in the live product (public site, Workspace, Console) reads from or writes to `vibeverk-control` yet. Phase 8 (rebuilding Console to authenticate against the control plane, real broker actions beyond the ping) is separate, not-yet-started work. Needs a Security Auditor pass before any real (non-ping) broker action is added.
- No changes to the public site, Workspace, or the production data-plane project (`clzczbyklgdtdhgjphup`) — read-only against it throughout (one `auth.admin.listUsers` call for the mechanism-proof).

## 0.20.1 — 2026-07-08

### Phase 6 mechanism-proof completed: Vercel Routing Middleware confirmed viable (`.js`, not `.mjs`)
- `middleware.mjs` renamed to `middleware.js` (repo root, Vercel Routing Middleware, disposable test project only — never deployed to `vibeverk.no`). This was a real, confirmed bug: Vercel's `Framework Preset: Other` build pipeline silently fails to compile a root-level `middleware.mjs` into an actual middleware function (no build error, no warning, no dashboard indication) — contradicting Vercel's own docs, which present `.mjs` as a documented equivalent to `"type": "module"` in `package.json`. `middleware.js` (no `"type": "module"` needed) works immediately, verified via a real HTTP request returning the `x-vibeverk-host-seen` response header.
- Found via an extensive elimination process (11 variables ruled out: code correctness, lockfile state, every dashboard build/install/output setting, a completely fresh Vercel project, Deployment Protection, Fluid Compute, GitHub-integration vs. CLI deploy, explicit `"framework": null`), then an initial Next.js-isolation test that appeared to confirm a "framework-less architecture" root cause — until an independent second review (Codex) correctly identified that test as confounding two variables at once (framework change AND filename change). A controlled single-variable retest confirmed the filename, not the framework, was the actual cause.
- **No architectural change needed** — Vibeverk's no-framework, no-bundler convention stands, no hosting vendor reconsideration was warranted. Phase 6's real hostname→tenant→Supabase-project resolver proceeds as originally planned, built as Vercel Routing Middleware.
- Also fixed along the way: `package-lock.json` regenerated (was stale, predated `@vercel/functions` being added to `package.json`, causing `npm ci` to fail on Vercel).
- Guardrail added: `CLAUDE.md` "Known configuration" now states the `.js`-not-`.mjs` requirement explicitly, so a future session doesn't "fix" this back to `.mjs` per Vercel's own (misleading) docs. `middleware.js`'s header comment updated to match.
- Documented as a new dated addendum to `docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md` (2026-07-08), not a rewrite of the existing accepted text.
- Still open, unaffected by this fix: the actual tenant-registry shape, unknown-Host fallback behavior, and Security Auditor review — all deferred to when Phase 6's real resolver logic is designed.

## 0.20.0 — 2026-07-07

### intranet renamed to Workspace — Phase 5 of the SaaS-scaling plan
- Architect-designed, staged rename (consulted first per CLAUDE.md's rule requiring Architect review before major cross-module changes). Split into two tiers: **Tier 1 (this pass)** — everything a human ever sees (directory name, URL path, doc prose, UI copy, hrefs); **Tier 2 (explicitly deferred to a separate future step)** — `window.Intranet` (the JS global object name), `#intranet`/`#intranet-nav`/`#intranet-main` DOM ids, and the `intranettFeatures` config/persisted-store key. Reasoning: Tier 2 items are invisible to every user and the customer, and every `workspace/module-*.js` file was already touched once today (Phase 4) — renaming them a second time same day for a purely internal, invisible identifier maximizes regression risk for zero externally visible benefit. Same precedent this repo already has for `is_admin_or_owner()` (kept post owner-role-removal, see ADR-0006).
- **File/directory moves** (`git mv`, history preserved): `intranet/` → `workspace/`; `intranet/intranet-core.js` → `workspace/workspace-core.js`; `test-intranet.js` → `test-workspace.js`. The 14 `module-*.js` basenames inside the directory are unchanged — only their directory moved.
- **Live-URL migration**: a new, minimal `intranet/index.html` left behind as a client-side redirect shim (`location.replace("/workspace/" + location.hash)`, preserving deep links like `#/dashboard`, plus a `<noscript>` fallback). GitHub Pages has no server-side redirect mechanism (no `_redirects` support, that's Netlify-only), so this is the only zero-infrastructure option. Verified live via Playwright: navigating to `/intranet/` correctly lands on `/workspace/`.
- **Functional link fixes**: `core.js`'s "Åpne i arbeidsområde" href (`../intranet/#/` → `../workspace/#/`) and the `productMode: "web"`-blocked page's link (`intranet/` → `workspace/`); `console-core.js`'s `productMode` option description text (operator-facing Console UI copy).
- **CI/tooling**: `.github/workflows/test.yml` updated to run `test-workspace.js`. `CLAUDE.md`/`AGENTS.md` repo-layout, testing sections, and known-failing-test descriptions updated — also caught and fixed a stale gap in `AGENTS.md` from Phase 3 (still described `supabase/migration.sql` as the live source, never updated when Phase 3 converted to `supabase/migrations/`).
- **Docs updated**: `docs/architecture/{module-conventions,roles-and-tenants,system-overview,storage-and-data-flow}.md`, `docs/STRATEGY.md`, `docs/compliance/data-map-template.md`, `docs/security/release-security-checklist.md`. Historical narrative describing what was true at a past date (e.g. specific bug-fix writeups in `roles-and-tenants.md`, the 2026-07-01 archive) left unchanged, per this repo's existing ADR/archive non-rewrite convention — only current-state structural descriptions were updated.
- **Explicitly not touched, per the Architect's plan**: `docs/decisions/ADR-0005-extend-auth-fallback-fix-to-intranet-login.md` (filename and body, historical record); `docs/archive/roadmap-2026-07-01.md` (point-in-time archive); `hub/tenants.js`'s `workspaceUrl` value (still points at `/intranet/` — deliberately left until the actual deploy/cutover step, since updating it earlier would point at a path not yet live); `module-workspaceship.js`/`WorkspaceshipEasterEgg` (unrelated pun feature, already named "workspace" coincidentally).
- **Verified**: both test suites re-run after every stage (directory rename, link fixes, redirect shim) — zero regressions throughout, exact same baseline as pre-rename (504/1, 152 tests 151/1). Live Playwright checks: `/workspace/` renders identically to the old `/intranet/` (screenshot-compared), and `/intranet/` now redirects to `/workspace/` correctly.
- **Not yet done — separate, explicitly-approved step**: the actual `git push`/deploy, and the one-line `hub/tenants.js` `workspaceUrl` fix riding along in that same deploy commit, per `CLAUDE.md`'s deployment safeguard.
- CHANGELOG 0.20.0, VIBEVERK_VERSION bumped, cache-bust bumped for `core.js`, `console-core.js`, `module-crm.js` (comment-only changes), and `workspace-core.js` (renamed, comment changes) across all four HTML entry points.

## 0.19.0 — 2026-07-07

### Async config bootstrap plumbing — Phase 4 of the SaaS-scaling plan (ADR-0007's own "Phase 1")
- Architect-designed, 8-stage implementation (consulted first, per CLAUDE.md's rule requiring Architect review before major cross-module changes — this touches `core.js`, the highest-churn file in the repo, plus ~17 module files across all four surfaces).
- **`core.js`**: new `App.ready(fn)`/internal `markConfigReady()` — a callback queue that lets any module defer config-dependent code until config is confirmed available, instead of assuming `window.SITE_CONFIG` is already populated at script-parse time. In this phase `config.js` stays a synchronous `<script>` tag and `markConfigReady()` fires immediately, so `App.ready(fn)` always resolves synchronously right away — a deliberate, verified behavioral no-op. `init()` itself now goes through the gate (renamed internally to `actualInit()`) since it reads `CFG` (via `applyTheme()`) and is triggered by `DOMContentLoaded`, which does **not** guarantee running after a future async config load.
- **7 root + 8 intranet module files** (`module-booking.js`, `module-faq.js`, `module-crm.js`, `module-mediabank.js`, `module-quote.js`, `module-references.js`, `module-scrollbanner.js`, and the 8 `intranet/module-*.js` equivalents) mechanically rewrapped: the old `var CFG = window.SITE_CONFIG || {}` + top-level feature-flag bail-out is now `App.ready(function (CFG) { ... })`, with the callback parameter shadowing the removed variable so every existing internal reference works unchanged.
- **`intranet-core.js` and `console-core.js` needed a different fix, not the module pattern** — both are one large persistent IIFE (`window.Intranet`/`window.VwConsole`) where `CFG` is captured once via closure and shared by many functions (`applyWorkspaceTheme`, `renderLogin`, `renderSystem`, etc.), not re-passed as a parameter per function. Wrapping the entire body (as originally suggested) would have broken both files outright — `console-core.js` would have returned `undefined` instead of its API object, since `App.ready()` doesn't propagate a callback's return value. Fixed instead by reassigning the same outer `CFG` variable inside an `App.ready` callback, and separately gating each file's `boot()`/`DOMContentLoaded` handler. `console-core.js`'s Supabase client construction (previously synchronous, reading `CFG.supabase` at parse time) moved into the same gate.
- **`module-chat.js`** (bespoke, handled last, alone, given this session's chat-IDOR history): supports standalone deployment without `core.js`/`App` present at all, so it can't unconditionally require `App.ready`. The entire body is now wrapped in `initChatModule()`, invoked via `App.ready` when available or immediately otherwise (preserving standalone behavior exactly).
- **Real gap found during verification, beyond the Architect's original file list**: `module-users.js`'s own `_sb` (`window.App.supabase`) was captured synchronously at parse time — the same risk class as the CFG captures, just one layer removed. Fixed with the same reassignment pattern. Also found and fixed: `core.js`'s own `App.supabase` construction (lines ~97-103) is itself synchronous and CFG-dependent, predating this phase — left as a documented, not-yet-fixed gap (fixing it properly requires restructuring `core.js`'s ~80-property return object, out of scope for a "plumbing only" phase) rather than expanding scope mid-phase. A second `intranet/module-users.js` (distinct file, same name) was checked and confirmed already safe — it reads `window.App.supabase`/`window.SITE_CONFIG` live inside functions, never captured at top-level.
- **Tests**: 4 new assertions in `test.js`, 3 in `test-intranet.js` — `App.ready` exists, invokes synchronously exactly once when config is already ready, and reads live state rather than a stale snapshot (mutate a feature flag between two `App.ready` calls, confirm the second sees the change). Explicitly documented as **not** testing genuinely deferred/asynchronous resolution — both harnesses run fully synchronously today; that requires the harness itself to change, which belongs to the future phase that actually swaps in a `fetch()`-based config source, not this one.
- **Verification**: each of the 8 stages tested incrementally (`node test.js`/`node test-intranet.js` after every file or small batch, not all at once) — zero regressions throughout, baseline unchanged except the new assertions (500→504, 149→152, same one pre-existing known failure each). Live Playwright smoke tests of all four entry points plus the chat widget confirmed visually identical rendering throughout.
- **No entry-point HTML changes** — `config.js` stays exactly `<script src="config.js">` in all four HTML files, per the ADR's own phase boundary. Cache-bust bumped for every file actually edited, across all four HTML entry points as applicable.
- Intermittent CORS errors observed during live smoke tests (varying endpoints each run) are most likely Supabase rate-limiting from this session's heavy automated-testing volume, not a regression — verified by re-running and seeing different endpoints fail inconsistently, with no plausible mechanism by which a client-side timing change could cause a server-side CORS policy violation.
- CHANGELOG 0.19.0, VIBEVERK_VERSION bumped, cache-bust bumped for `core.js` and every touched module file.

## 0.18.0 — 2026-07-07

### SQL workflow converted to real, deployable Supabase migrations (Phase 3 of the SaaS-scaling plan)
- `supabase/migration.sql` (the single, hand-maintained, Dashboard-copy-paste schema file) and 23 `hotfix_*.sql` files were the only SQL workflow — CLAUDE.md explicitly forbade claiming `supabase db push` would deploy them, since they weren't timestamped files under `supabase/migrations/`. This blocked any future semi-automated customer onboarding (Phase 9 of the SaaS-scaling plan needs `supabase db push` to actually work against a fresh project).
- `supabase/migrations/20260707000001_baseline_schema.sql` created as a byte-for-byte copy of `migration.sql` (verified via SHA-256 hash before adding any header), establishing it as migration #1 in a real, CLI-trackable history.
- **Production (already has this schema) was baselined, not re-applied**: `npx supabase migration repair 20260707000001 --status applied --linked` marks the migration as already-in-effect in the remote history table, without re-running any of the 1070 lines of DDL against the live database. Verified via `supabase migration list --linked` (local and remote both show `20260707000001`) and `supabase db push --linked --dry-run` ("Remote database is up to date").
- For a **new** customer project going forward, `supabase db push --linked` (after linking to that project) now genuinely deploys the full schema from scratch — the actual point of this conversion.
- `supabase/migration.sql` marked superseded via a header comment (frozen snapshot as of this baseline, not updated further) rather than deleted — still useful for a quick manual Dashboard read, but no longer the place new changes go. `hotfix_*.sql` files kept as historical record (already folded into the baseline, valuable context, referenced throughout this changelog and `CURRENT_STATE.md`).
- **Real tooling lesson, now written into `CLAUDE.md`**: multi-statement/multi-line SQL passed inline to `npx supabase db query` can silently skip statements or drop clauses with no error (hit twice this session, 0.17.9's write-policy rollout) — always use `--file` and verify the actual result afterward, never trust a clean exit code alone.
- `CLAUDE.md`'s Supabase rules section rewritten to describe the new workflow (`supabase migration new <name>` for future changes, `supabase db push` for deployment, the `--file`-not-inline lesson).
- No app code changed, no test-suite impact. This is Phase 3 of the SaaS-scaling faseplan — Phase 1 (security debt) and Phase 2 (hosting vendor evaluation/Vercel Phase 0) were completed earlier the same day.

## 0.17.11 — 2026-07-07

### Console session re-checked on navigation, not just at page load
- Last open MEDIUM item from the security reconciliation pass (see 0.17.8). `navigate()` (`console/console-core.js`) is called on every Console nav-item click but never checked `isAuthed()` — only the `DOMContentLoaded` handler did, once. A 48-hour session that expired while an operator had Console open in a background tab kept rendering sections normally after the expiry, contradicting the documented intent in `docs/architecture/roles-and-tenants.md`. RLS (`is_platform_operator()`, which checks the JWT's own expiry) still blocked actual writes, so this was a UI-consistency gap, not a data-access bypass.
- Fixed: `navigate()` now checks `isAuthed()` first and calls the existing `logout()` (clears the session, signs out of Supabase Auth, reloads) if expired, bouncing back to the login screen instead of continuing to render.
- No automated test coverage (Console has no test harness — confirmed neither `test.js` nor `test-intranet.js` reference `console-core.js`). Both suites re-run to confirm no regression (500/1, 148/149 — unchanged).
- Cache-bust: `console-core.js` 46→47.

## 0.17.10 — 2026-07-07

### Hosting vendor evaluated for SaaS-scaling: Vercel, not Cloudflare (ADR-0007 addendum)
- `ADR-0007` named "Cloudflare Pages/Workers" only as an example, not a locked-in choice. User required a real comparison (Cloudflare Pages/Workers vs. Vercel vs. Netlify) before treating any vendor as decided. Compared on: multi-tenant custom domains, apex-domain (`kunde.no`) support without the customer migrating nameservers/DNS provider, request-time hostname resolution, zero-build static hosting, GitHub integration/previews, pricing at 10/50/100-customer scale, vendor lock-in, and domain-onboarding-from-API automatability.
- **Vercel recommended.** Decisive factor: apex-domain handling. Cloudflare's apex-without-nameserver-migration path ("Apex Proxying") is Enterprise-only (real contracts $5K–15K/month) — unaffordable at our target scale. Netlify's own docs recommend against apex-as-primary with external DNS. Vercel supports apex via a plain A record with any external DNS provider, no nameserver migration, plus "Vercel for Platforms" — a purpose-built multi-tenant domain API. Edge-middleware maturity, GitHub integration and pricing at this scale were roughly equivalent across all three, not decisive.
- **Phase 0 (ADR-0007's, re-run against Vercel) completed and verified**: current, unmodified repo deployed to Vercel (Hobby plan, this test only) as a second host. User visually confirmed all four entry points (`/`, `/admin/`, `/intranet/`, `/console/`) match the live GitHub Pages site exactly. `vibeverk.no` untouched, still on GitHub Pages. Vercel's own deployment-protection gate (Vercel Authentication) blocked automated Playwright verification — confirmed manually by the user instead.
- New `parity` flow added to `.claude/skills/run-vibeverk/driver.js` — read-only check of all four entry points against an arbitrary `VIBEVERK_URL`, reusable for future host comparisons.
- **Deliberately deferred, not skipped**: an apex-domain-via-A-record test against a real throwaway domain (the actual decisive claim, so far backed only by Vercel's documentation) and a minimal edge-middleware Host-header echo test. Both should happen before Phase 1 (async config bootstrap) commits to Vercel-specific middleware syntax.
- `docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md` updated with a dated addendum (original Decision/Consequences text left unchanged, per this repo's ADR convention). `docs/roadmap/ROADMAP.md` "Next" updated to match.
- No DNS, custom domain, or Supabase changes. No test-suite changes (this doesn't touch app code).

## 0.17.9 — 2026-07-07

### superconfig split — adminPassword no longer sits in plaintext in an anon-readable key
- Second security item from the SaaS-scaling reconciliation pass (see 0.17.8). `superconfig.adminPassword` (Console's "Nettside-admin (for kunden)" password-override field) was live-confirmed as a real, currently-exposed plaintext secret: `GET .../rest/v1/store?key=eq.superconfig` with the public anon key returned it verbatim (live value found: a real password, since rotated is recommended). ADR-0003 already made this value unreachable for actual login on any Supabase-configured customer deployment, but the value itself was still exposed regardless of whether the app ever used it.
- **Fix (design agreed with user: split public/private superconfig)**: new `superconfig-private` `store` key, excluded from `store_anon_read`'s denylist and, unlike every other key, also excluded from the previously-blanket `store_read_authenticated USING (true)` — now `CASE WHEN key = 'superconfig-private' THEN is_platform_operator() ELSE true END`. Write policies (`store_insert_auth`/`store_update_auth`/`store_delete_auth`) gate it the same as `superconfig` (`is_platform_operator()`). The public `superconfig` key is unchanged and still anon-readable by design (theme/feature-flags/privacy text need to reach an unauthenticated visitor's first page load).
- `console-core.js`: new `getSCPrivate()`/`saveSCPrivate()`, both going through Console's own OTP-verified `_sb` client (same reasoning as the existing `saveSC()` — `App.store`'s hydration is the wrong identity for a platform-operator-only key). `renderSystem()`'s password field now loads asynchronously (shows "Laster…" placeholder, then the real value once `getSCPrivate()` resolves) instead of reading a value baked into the initial synchronous render. `resetSC()` now also clears the private key, matching its "reset ALL config" label. Cache-bust: `console-core.js` 45→46.
- **Real regression caught and fixed during rollout, not shipped**: applying the three write-policy SQL statements (`store_insert_auth`/`update_auth`/`delete_auth`) via `npx supabase db query --linked` with a multi-line inline argument silently dropped the `WITH CHECK`/`USING` clauses entirely — verified via `pg_policy` showing `null` for both `polqual`/`polwithcheck` on all three, meaning (briefly, before being caught and corrected) any authenticated user could have written to any `store` key including `superconfig`/`superconfig-private`. Root cause: the CLI's inline-argument path doesn't reliably handle multi-line SQL; switched to `--file` for all three policies, which produced the correct `CASE`-expression ACLs on verification. This is the same class of "verify, don't trust the exit code" lesson as 0.17.8's chat-IDOR rollout, now specific to multi-line (not just multi-statement) SQL passed inline.
- **One-time production data migration** (`supabase/hotfix_superconfig_split_2026-07-07.sql`, folded into `migration.sql`): moved the existing plaintext `adminPassword` value out of `superconfig` into the new `superconfig-private` key, stripped it from the public blob. Verified two ways: `pg_policy`/direct `SELECT` (service-role-equivalent CLI access), and — the actual attack vector — a real unauthenticated HTTP request to the Supabase REST endpoint with the public anon key, confirming `superconfig-private` now returns `[]` and `superconfig` no longer contains the field.
- **Not live-tested end-to-end in the browser** (Console's OTP goes to the real Vibeverk-operator email, not available in this session) — code reviewed and the underlying RLS/data changes are live-verified, but the actual Console UI round-trip (load password field, edit, save, reload, confirm persistence) needs a manual check by the user.
- No test-suite changes (same documented limitation as 0.17.8 — no automated coverage of real Supabase network calls).

## 0.17.8 — 2026-07-07

### Chat anon IDOR closed for real (Section 3 of hotfix_chat_visitor_rpcs_2026-07-06.sql finally run) — first security step of the SaaS-scaling effort
- Context: a broader SaaS-scaling architecture pass (control plane/data plane split, see the new architecture plan discussed with the user) requires closing the roadmap's outstanding security debt first. Reconciling `ROADMAP.md`'s stale "Current focus" (dated 2026-07-01) against actual code/SQL found that 3 of its 4 listed HIGH findings were already closed and confirmed in production, but the chat IDOR was not — the safe RPC path (`update_visitor_presence()`/`insert_visitor_message()`) existed and was live and client-integrated since 0.17.5, but the *old* insecure direct anon grants on `chat_conversations`/`chat_messages` (`USING(true)`, no row-ownership check) had deliberately not been revoked, pending a live test that had never actually been done.
- **Live-verified end-to-end via a new Playwright driver flow** (`chat-e2e` in `.claude/skills/run-vibeverk/driver.js`, added this session): a real anonymous visitor sends a chat message, a real authenticated account opens the admin chat panel, sees the message, replies, closes and reopens the conversation — all in one process so both sides share a tag for reliable matching. Required temporarily flipping the production `chat-availability` `store` key online for the live-chat path to trigger, restored to its exact original value (`{"online":false,"since":0}`) after each run, each confirmed via `SELECT`.
- **Real bug found via this test, distinct from the IDOR itself**: the test account's `editor` role could not see any chat conversations at all — `chat_conv_auth`'s policy (`migration.sql`) is `is_admin_or_owner()`-gated, i.e. chat admin access is `admin`-only, not `editor`/`member`, unlike CRM/tasks/media's editor-inclusive pattern. This is correct-as-coded (not a bug we introduced or fixed) but was previously undocumented in `docs/architecture/roles-and-tenants.md`'s permission matrix, which covers every other module's role breakdown but not chat's. User temporarily promoted the test account to `admin` to complete the live test.
- **After the live test confirmed the admin side works correctly on the new RPC path**, ran Section 3 of `hotfix_chat_visitor_rpcs_2026-07-06.sql` against production: `DROP POLICY chat_conv_anon_update`/`chat_msg_anon_insert`, `REVOKE UPDATE (...) ON chat_conversations FROM anon`, `REVOKE INSERT ON chat_messages FROM anon`. **Found and worked around a real tooling gotcha**: running all statements as one multi-statement batch via `npx supabase db query --linked` silently executed only some of them (one `DROP POLICY` and one `REVOKE` were skipped with no error surfaced) — caught by verifying `pg_policy`/`pg_class.relacl`/`information_schema.column_privileges` directly rather than trusting the query's exit code, then re-ran each remaining statement individually and re-verified. Lesson for future sessions: verify multi-statement `supabase db query` batches statement-by-statement, don't assume a clean exit means every statement ran.
- **Re-verified the full visitor+admin flow end-to-end once more after the grants were tightened** (per the hotfix file's own closing instruction) — confirmed working identically to before. All test chat conversations (6 total, including one leftover from 2026-07-06 testing previously flagged for cleanup) deleted from production afterward.
- `supabase/migration.sql` updated so a **fresh customer project gets the secure end-state directly**: the two RPC functions (previously live in production but never folded into `migration.sql` — a real "fresh customer inherits the vulnerability" gap) are now defined in section "5b. VISITOR-SCOPED RPCs"; the old `chat_conv_anon_update`/`chat_msg_anon_insert` policies are no longer created at all (existing `DROP POLICY IF EXISTS` lines handle cleanup on re-run for already-provisioned projects); explicit `REVOKE`s added alongside the narrowed `GRANT INSERT ON chat_conversations TO anon` so re-running `migration.sql` against an old install converges to the same secure state.
- Original ROADMAP.md 4-item list reconciled: `store` anon-SELECT scoping, `store`/`media` write policies, and `migration.sql` drift are confirmed closed (with one narrow exception each, tracked separately — see below). Chat IDOR (this entry) was the only one still fully open.
- **New, previously undocumented finding surfaced during reconciliation, not yet fixed**: `superconfig.adminPassword` (Console's per-customer web-admin password override) is stored in plaintext inside the `superconfig` `store` key, which remains unconditionally anon-readable (`store_anon_read`'s denylist excludes only the CRM/leads/bookings keys, not `superconfig`) — a direct anon REST call exposes it. Fix design agreed with user (split into public/private `superconfig` keys) but not yet implemented — tracked as the next item in this security pass.
- No test-suite changes (`test.js`/`test-intranet.js` don't exercise live Supabase network calls, per the existing documented limitation). Cache-bust: none (no client-side files changed — `migration.sql` isn't loaded by any HTML entry point, `.claude/skills/` isn't part of the deployed app).

## 0.17.7 — 2026-07-06

### Chat: usynleg feilmelding ved mislykka sending retta (funne via live produksjonstest)
- Brukaren testa chat-widgeten på den faktiske live-produksjonssida (ingenting frå i dag var pusha enno) og fann at ei mislykka melding-sending synte INGEN feilmelding — meldinga «berre forsvann».
- Rotårsak funne: `doSend()` i `module-chat.js` bygde ein raud feilmelding-`<div>` ved mislykka sending, men forsøkte å setje han inn i `document.getElementById("vw-reply")` — ein element-ID som ikkje finst NOKON stad i widgeten sin markup (stadfesta: null andre referansar til `vw-reply` i heile fila). `if (replyEl) ...`-vakta gjorde at elementet stille aldri vart sett inn i DOM-et — feilen var reelt synleg berre via `console.warn`, aldri for den faktiske besøkande.
- **Viktig kontekst**: denne buggen fanst FØR i dag sitt arbeid — han er ikkje introdusert av chat-IDOR-fiksen (som ikkje er deployert enno). Retta ved å setje feilmeldinga inn i `bottom` (den faktiske meldingsboks-containeren, som alltid finst) i staden for det ikkje-eksisterande `vw-reply`.
- **Ikkje løyst enno**: kvifor sjølve sendinga faktisk feiler i produksjon i utgangspunktet — denne fiksen gjer berre feilen synleg. Treng ein ny live-test etter deploy, helst med nettlesarkonsollen open, for å sjå den faktiske underliggande feilteksten.
- Tester: uendra (`test.js` 500/1, `test-intranet.js` 148/149).
- Cache-bust: `module-chat.js` 14→15. `VIBEVERK_VERSION` 0.17.6 → 0.17.7.

## 0.17.6 — 2026-07-06

### Tilbud-vedlegg: Storage RLS-fiksen køyrt og stadfesta live end-to-end
- Køyrt `hotfix_tilbud_attachment_storage_2026-07-06.sql` mot produksjon etter godkjenning. Ny `media_insert_anon_attachments`-policy stadfesta live via `pg_policies`.
- **Live-verifisert med ein ekte Playwright-driven anonym nettlesarsesjon** (via den nye `/run-vibeverk`-skillen sin `tilbud`-flyt): fyrste forsøk brukte ein `.txt`-testfil og trefte ein ANNA, legitim feil ("mime type text/plain is not supported" — bucketen sin eigen MIME-allowlist, ikkje ein bug); retta driver-scriptet til å bruke ein gyldig 1×1 PNG i staden, og køyrde på nytt.
- Etter fiksen: heile Tilbud-flyten fungerer no end-to-end for ein ekte anonym besøkande — kvitteringssida vart vist, og leaden vart stadfesta direkte i databasen med eit ekte, fungerande vedlegg (ekte Supabase Storage-URL, rett namn/type/storleik).
- `docs/project/CURRENT_STATE.md` oppdatert — dette lukkar heile Tilbud-vedlegg-funnet frå i dag (klientkode + skjema + Storage RLS), no fullstendig live-testa.
- Cache-bust: ingen (ingen aktive filer endra utover console-core.js sin versjonsstreng). `VIBEVERK_VERSION` 0.17.5 → 0.17.6.

## 0.17.5 — 2026-07-06

### Storage RLS-fiks for Tilbud-vedlegg drafta; chat-RPC-ane oppretta og live-stadfesta
- `hotfix_tilbud_attachment_storage_2026-07-06.sql` (folda inn i `migration.sql`) drafta som svar på gårsdagens live-funn: ny, smalt avgrensa anon-INSERT-policy på `storage.objects`, berre for `files/`-prefikset. **IKKJE køyrt enno, ventar godkjenning.**
- Etter brukargodkjenning: oppretta `update_visitor_presence()`/`insert_visitor_message()` (kun sjølve funksjonane + anon-grants, IKKJE seksjon 3 som trekker tilbake dei gamle direkte anon-rettane). **Ekte feil fanga med det same**: `update_visitor_presence()` sin `REVOKE`/`GRANT`-signatur i hotfix-fila mangla éin `text`-parameter (lista 9 i staden for dei faktiske 10) — synte seg umiddelbart som "function does not exist" ved fyrste køyring, retta før ny køyring.
- **Live-stadfesta med ein ekte Playwright-driven anonym nettlesarsesjon**: opna chat-widgeten, sende ei melding som anonym besøkande, og stadfesta direkte i databasen (ikkje berre UI-et) at både presence-felta (`page_url`/`visitor_active`/`last_seen_at`) og meldingsteksten landa korrekt via dei to nye RPC-ane. Kravde ei mellombels oppdatering av `chat-availability` sin tidsstempel (den live verdien var utgått per klienten sin eigen 8-timarsregel) — gjenoppretta til nøyaktig opphavleg verdi umiddelbart etter testen.
- Seksjon 3 (tilbaketrekking av dei gamle direkte anon-rettane) framleis IKKJE køyrt — admin-sida av chatpanelet (svar, marker lest, avslutt samtale) er ikkje live-testa enno med ein ekte autentisert sesjon.
- `docs/project/CURRENT_STATE.md` oppdatert.
- Cache-bust: ingen (ingen aktive filer endra utover console-core.js sin versjonsstreng). `VIBEVERK_VERSION` 0.17.4 → 0.17.5.

## 0.17.4 — 2026-07-06

### Live nettlesartest av anon-innsendingar: 2 av 3 stadfesta, éin ny SQL-feil funnen og retta
- Sett opp Playwright + Chromium lokalt (nytt, `playwright` lagt til som devDependency) og køyrt ein ekte anonym nettlesarsesjon mot produksjon (lokal statisk server, men `config.js` peikar på ekte Supabase-prosjektet `clzczbyklgdtdhgjphup`).
- Køyrt (etter brukargodkjenning) og stadfesta live: `hotfix_tilbud_attachments_2026-07-06.sql` (`leads.attachments`-kolonna finst) og `hotfix_anon_leads_bookings_rpc_2026-07-06.sql` (`insert_anon_lead()`/`insert_anon_booking()`-funksjonane og `bookings_asset_date_time_key`-constrainten finst, `anon` har EXECUTE på begge).
- **Kontakt-innsending stadfesta fungerande end-to-end**: ekte anonym lead landa i produksjonstabellen `leads`, verifisert direkte i databasen (ikkje berre stole på UI-et).
- **Booking-innsending stadfesta fungerande end-to-end, inkludert sjølve kjernefiksen**: ekte anonym sanntidsbooking landa i `bookings` med nøyaktig same ressurs/dato/tid/referansenummer som UI-et synte — stadfestar at den opphavlege "falsk Reservert!"-buggen faktisk er retta, ikkje berre tilsynelatande.
- **Ny feil funnen via live-testen, IKKJE retta enno**: ekte anonym Tilbud-innsending MED vedlegg feilar i produksjon — `storage.objects` sin `media_insert`-policy krev `TO authenticated` + `can_edit_content()` (admin/editor), som ein anonym besøkande aldri kan tilfredsstille. Sjølve lead-oppretting fall trygt (ingen halvferdig lead vart oppretta), men vedlegget kan aldri lastast opp for ein reell anonym Tilbud-førespurnad i dag. `hotfix_tilbud_attachment_storage_2026-07-06.sql` (folda inn i `migration.sql`) legg til ein ny, smalt avgrensa anon-INSERT-policy for berre `files/`-prefikset (same sti `App.media.putFile()` sin generiske vedleggsopplasting brukar) — biletopplasting (mediebank/Aktuelt) er IKKJE dekt, krev framleis admin/editor. **IKKJE KØYRT ENNO, ventar godkjenning.**
- Chat-RPC-live-test ikkje gjennomført enno — ventar på eiga godkjenning for å opprette RPC-funksjonane (`update_visitor_presence`/`insert_visitor_message`) før den testen kan køyrast.
- **Testdata oppretta i produksjon under verifiseringa, ikkje sletta automatisk**: éi `leads`-rad (Kontakt-test) og éi `bookings`-rad (opptek ein ekte kalenderslot, ressurs "Rådgiver" 2026-07-06 kl. 09:00) — flagga for manuell opprydding.
- `docs/project/CURRENT_STATE.md` oppdatert med stadfesta SQL-status og live-testresultat.
- Cache-bust: ingen (ingen aktive filer endra utover console-core.js sin versjonsstreng). `VIBEVERK_VERSION` 0.17.3 → 0.17.4.

## 0.17.3 — 2026-07-06

### Sletta det andre stykket daud kode: intranet/test-intranet.js
- `intranet/test-intranet.js` — den separate, aldri-køyrde testfila oppdaga under sletting av `intranet/module-crm.js` same dag — er no òg sletta, etter eksplisitt brukargodkjenning. Stadfesta trygt på same vis: verken CI (`.github/workflows/test.yml`) eller nokon dokumentert kommando i `CLAUDE.md` refererer denne fila; full testsuite køyrt på nytt viser ingen endring (`test.js` 500/1, `test-intranet.js` 148/149, same to kjende feil).
- `docs/project/CURRENT_STATE.md` oppdatert.
- Cache-bust: ingen (ingen aktive filer endra). `VIBEVERK_VERSION` 0.17.2 → 0.17.3.

## 0.17.2 — 2026-07-06

### Sletta stadfesta daud kode: intranet/module-crm.js ("Bolk D", siste punkt)
- `intranet/module-crm.js` (aldri lasta av nokon reell side sidan 2026-07-01, `intranet/index.html` brukar rot-fila `../module-crm.js` som dual-registrerer for Web-admin OG Workspace sjølv) er no sletta, etter eksplisitt brukargodkjenning. Stadfesta trygt: rot-fila si eiga registreringslogikk (`App.registerModule()` alltid, `window.Intranet.registerModule()` berre viss `window.Intranet` finst) er det som faktisk styrer om ein kunde kan tilbys Web+CRM åleine eller Workspace+CRM åleine — heilt uavhengig av den no sletta fila, som aldri køyrde uansett.
- Full testsuite køyrt på nytt etter sletting, ingen endring i resultat (`test.js` 500/1, `test-intranet.js` 148/149, same to kjende feil) — stadfestar at ingenting refererte fila.
- **Ny, relatert oppdaging under denne sletteprosessen, ikkje handsama enno**: `intranet/test-intranet.js` (ei EIGA, separat testfil som ligg inni `intranet/`-mappa, ulik rot-fila sin faktisk brukte `test-intranet.js`) skriv framleis om `module-crm.js`-skripttaggen til å peike på den no sletta `intranet/module-crm.js` (linje 17). Stadfesta at denne fila aldri vert køyrt av CI eller nokon dokumentert kommando i CLAUDE.md (`.github/workflows/test.yml` køyrer berre dei to rot-nivå-testfilene) — dette er difor eit andre, tidlegare udokumentert stykke daud kode, ikkje eit reelt brot. Flagga for eiga avgjerd.
- `docs/project/CURRENT_STATE.md` og `docs/roadmap/ROADMAP.md` oppdatert til å reflektere sletting.
- Cache-bust: ingen (ingen aktive filer endra utover console-core.js sin eigen versjonsstreng). `VIBEVERK_VERSION` 0.17.1 → 0.17.2.

## 0.17.1 — 2026-07-06

### Chat-IDOR: klientkode no lagt om til å bruke visitor-RPC-ane ("Bolk D")
- `module-chat.js` sine delte `Chat.updateConv()`/`Chat.addMsg()`-funksjonar (brukt av BÅDE den anonyme besøkande-widgeten OG det autentiserte admin-chatpanelet) tek no ein valfri, siste `vid`-parameter. Kvart av dei sju anon-widget-kallstadene (samtale-start sin presence-oppdatering, besøkande sitt sendeknapp, presence-sporing ved `visibilitychange`/`pagehide`/30s-intervall/`openPanel()`, og "Kunden lukket chatvinduet"-systemmeldinga) sender no `Chat.getVid()` og går via `update_visitor_presence()`/`insert_visitor_message()` (RPC-ane drafta i `hotfix_chat_visitor_rpcs_2026-07-06.sql` sist same dag) i staden for direkte tabelltilgang.
- Admin-/operatør-kallstadene (`markRead`, `setStatus`, operatøren sin sendeknapp, admin sin "test-samtale"-knapp, `saveConvAsLead()` sin `leadSaved`-flagg) er bevisst IKKJE endra — dei sender ikkje `vid` og held difor fram med direkte tabelltilgang via dei eksisterande `chat_conv_auth`/`chat_msg_auth`-policyane, akkurat som før.
- **Ikkje ei regresjon, stadfesta ved gjennomgang**: `leadSaved`-flagget og widgeten sin eigen "gjenopne omtala samtale"-knapp (`status`-felt) var ALLEREIE utanfor anon sin kolonne-GRANT-liste før denne endringa — dei feila stille for anon også før dette, ei separat, ikkje-relatert, kjend avgrensing, ikkje noko nytt.
- **Ikkje køyrt enno, og ikkje trygt å køyre enno**: SQL-en sin siste seksjon (tilbaketrekking av dei gamle direkte anon-rettane) krev ein faktisk live nettlesartest av både besøkande-widgeten og admin-panelet FØR han kan køyrast — sjekklista står i `hotfix_chat_visitor_rpcs_2026-07-06.sql`.
- Tester: uendra (`test.js` 500/1, `test-intranet.js` 148/149) — `_sb` er aldri konfigurert i jsdom-miljøet (dokumentert, eksisterande avgrensing), så ingen av dei nye RPC-grenene køyrer under eit testløp; berre full-suite-køyring stadfesta ingen regresjon.
- Cache-bust: `module-chat.js` 13→14. `VIBEVERK_VERSION` 0.17.0 → 0.17.1.

## 0.17.0 — 2026-07-06

### Anonyme Kontakt-/Tilbud-/booking-innsendingar når no faktisk Supabase ("Bolk D")
- Konsultert Architect-agenten, som verifiserte funnet direkte mot koden og fann ein tilleggsfeil ikkje i det opphavlege oppdraget: `loadBookings()` har ingen auth-sperre og har difor alltid vore "blind" for anon (anon kunne aldri SELECT bookings), så den klientsida dobbeltbooking-sjekken (`isBooked()`/`isBlocked()`) fungerte aldri for anonyme besøkande i utgangspunktet.
- Funn: `addLead()` (core.js) og `createBooking()` (module-booking.js) skreiv berre til den eine besøkande sin eigen `localStorage` for uinnlogga besøkande — verken Kontakt, Tilbud eller booking-førespurnadar/sanntidsbookingar nådde nokon gong Supabase, sjølv om UI-en synte "mottatt"/"Reservert!".
- **Retta**: nye SECURITY DEFINER-RPC-ar `insert_anon_lead()` (dekker Kontakt+Tilbud, inkl. det nye `attachments`-feltet frå same dag) og `insert_anon_booking()` (`supabase/hotfix_anon_leads_bookings_rpc_2026-07-06.sql`, folda inn i `migration.sql`, **IKKJE KØYRT ENNO**, ventar godkjenning) — same mønster som dei eksisterande chat-visitor-RPC-ane, men utan eigarskapstoken sidan dette er reine one-shot-innsettingar.
- Ny `UNIQUE (asset_id, date, time)`-constraint på `bookings` + atomisk konfliktfangst inne i `insert_anon_booking()` — løyser tilleggsfunnet over: sidan anon uansett ikkje kunne sjekke ledige tider på klientsida, må sjølve databasen no vere den som atomisk avviser kollisjonar.
- `core.js` sin `addLead()`: den eine `if (!_sb || !_isAuthed)`-greina er delt i to — `!_sb` (uendra lokal fallback) og `!_isAuthed` (kallar no RPC-en, ingen lokal skriving lenger — leads skal leve i Supabase, ikkje berre i éin nettlesar).
- `module-booking.js`: ny `submitAnonBooking()` (Promise-returnerande) brukast no av den anonyme sanntidsbooking-bekreftinga (`openConfirm()`), som ventar på eit ekte utfall og viser «Reserverer…»/feilmelding i staden for å anta suksess med det same. `createBooking()` er forenkla attende til å berre tene det autentiserte admin-skjemaet (alltid innlogga der).
- Tester: `test.js` uendra i tal (500/1) — same dokumenterte avgrensing som resten av desse skrivefunksjonane: jsdom konfigurerer aldri ein ekte Supabase-klient, så RPC-kallet sjølv kan ikkje testast automatisk, berre feltmappinga (alt dekt av eksisterande testar) og at UI-flyten framleis fungerer synkront/asynkront som forventa (ny `await`-runde lagt til i sanntidsbooking-testen). `test-intranet.js` uendra (148/149, urørt sidan `intranet/module-booking.js` er ei eiga fil).
- **Ikkje køyrt enno**: `hotfix_anon_leads_bookings_rpc_2026-07-06.sql` — må køyrast ETTER `hotfix_tilbud_attachments_2026-07-06.sql` (skriv til `attachments`-kolonna den legg til). Krev live-test som ekte anonym besøkande (privat vindauge) FØR dette reknast som stadfesta, inkludert eit bevisst dobbeltbooking-forsøk frå to faner samstundes.
- Cache-bust: `core.js` 34→35, `module-booking.js` (rot) 11→12. `VIBEVERK_VERSION` 0.16.1 → 0.17.0 (MINOR — ny funksjonalitet, ikkje berre feilretting).

## 0.16.1 — 2026-07-06

### Sikkerheit + UX: CRM attachmentChip-XSS lukka, opprydding-på-sletting, touch-mål/tastatur-tilgang for tidslinja ("Bolk D")
- Konsultert Architect-agenten for media/lagring-arkitektur og UX/Mobile Reviewer-agenten for CRM-tidslinja sine touch-mål — begge agentane verifiserte funna direkte mot koden før dei ga tilrådingar. Full plan for Fase 2 (privat `crm-documents`-bucket + signerte URL-ar) er dokumentert, men ikkje starta — treng eigen SQL-godkjenning og live nettlesarverifisering.
- **Fase 1 (gjort no)**: `attachmentChip()` i `module-crm.js` avviser no `javascript:`-URI (same regex som `components.js` sin `sanitizeRichHtml()` brukar), sidan `crm_comms` sin lause UPDATE-policy i praksis let ein member PATCHe `att.ref` via REST. Ny `isSafeAttachmentUrl()`-hjelpar eksponert via `window.CrmAdmin._test` for testing. Same sperre lagt til proaktivt i `module-quote.js` sin nye Tilbud-vedleggsvisning (same fareklasse, ny kolonne).
- **Opprydding-på-sletting/erstatning (mangla heilt før)**: `deleteComm()` frigjer no eit dokumentvedlegg (`App.media.freeFile()`) før raden fjernast. `openDocDialog()` sin filbyte-handsamar frigjer no det GAMLE vedlegget berre etter at det NYE er lasta opp vellykka (unngår å miste fila viss ny opplasting feiler).
- **UX/tastatur-tilgang for CRM-tidslinja**: touch-mål for «Fullfør»/«Svar»-knappane og slett-ikonet utvida med usynleg treffflate (`::before`-pseudoelement, ikkje ein større synleg knapp — ville øydelagt tettleiken). «Merk»-knappen i slå-saman-dialogen fekk auka padding for å matche «Opne»/«Slett»-knappane sin storleik i same rad. Tidslinje-rada fekk hover-bakgrunn, fokus-ring, ein chevron-ikon (viser klikkbarheit FØR eit tastetrykk, ikkje berre etter), og — funne av UX-agenten som ein reell, ikkje berre kosmetisk, mangel — `tabindex="0" role="button"` pluss ein `keydown`-handsamar (Enter/mellomrom), sidan rada tidlegare ikkje var tilgjengeleg med tastatur i det heile.
- Tester: 6 nye i `test.js` (`isSafeAttachmentUrl()`-sperra) — 494 → 500 OK, same eine kjende feil. `test-intranet.js` uendra (148/149).
- **Krev live nettlesarverifisering før dette reknast som fullstendig stadfesta** (CSS/interaksjonsendring, ikkje dekt av jsdom-testar): touch-mål på faktisk mobil/tablett-storleik, tastaturnavigasjon gjennom tidslinja, at chevron/hover ikkje bryt eksisterande layout ved 375px.
- Cache-bust: `module-crm.js` 17→19 (to rundar denne dagen). `VIBEVERK_VERSION` 0.16.0 → 0.16.1.

## 0.16.0 — 2026-07-06

### Tilbud-vedlegg lastar no faktisk opp filbytes ("Bolk D", fyrste steg)
- Funn (2026-07-04/06-gjennomgangen): `module-quote.js` sin steg 2-innsendingshandsamar tok berre med filnamn+storleik som TEKST i leaden si meldingsfelt — dei faktiske `File`-objekta (`st.files`, plukka i steg 1) vart aldri sendt til `App.media.putFile()` eller nokon opplastingsfunksjon, for alle Tilbud-innsendingar, innlogga eller ikkje.
- **Retta**: innsendingshandsamaren ventar no på `Promise.all()` over `App.media.putFile()`-kall for kvart vedlegg FØR henvendinga vert oppretta — feiler heile innsendinga (ingen henvending oppretta, tydeleg feilmelding) viss eitt vedlegg ikkje kan lastast opp, i staden for å stille droppe det.
- Ny `attachments jsonb`-kolonne på `leads`-tabellen (`supabase/hotfix_tilbud_attachments_2026-07-06.sql`, folda inn i `migration.sql`) — same `{name,ref,type,size}`-form som CRM sitt dokumentvedlegg-felt allereie brukar. `addLead()`/`jsLeadToDb()`/`dbLeadToJs()` (`core.js`) oppdatert til å mappe feltet.
- Admin-visinga for tilbudsforespørslar (`module-quote.js` sin `renderAdminInfo()`) viser no faktiske nedlastbare vedleggslenker, med same URL-skjema-sperre (avvis `javascript:`) som CRM sin `attachmentChip()` bør ha — lagt til proaktivt her sidan `leads` har same authenticated INSERT/UPDATE-tilgang (member kan i praksis PATCHe feltet via REST) som gjorde CRM sitt tilsvarande felt sårbart.
- Tester: 6 nye i `test.js` (feltmapping-rundtur for `attachments`, faktisk filvalg+opplasting gjennom heile Tilbud-flyten, verifiserer ekte `file:`-referanse på leaden) — 488 → 494 OK, same eine kjende feil. `test-intranet.js` uendra (148/149).
- **Ikkje køyrt enno**: `hotfix_tilbud_attachments_2026-07-06.sql` ventar eksplisitt godkjenning før den køyrer mot `clzczbyklgdtdhgjphup`, per CLAUDE.md sitt deployment-safeguard.
- Cache-bust: `core.js` 33→34, `module-quote.js` (rot) 9→10, `console-core.js` 35→36. `VIBEVERK_VERSION` 0.15.3 → 0.16.0 (MINOR — reell ny funksjonalitet, ikkje berre feilretting).

## 0.15.3 — 2026-07-06

### Sikkerheit: gamle store-blobbar sletta (crm-*/leads/booking-bookings)
- Etter at radetal-sjekken i 0.15.2 stadfesta at alle fem nye tabellane er supersett av dei gamle store-blobene, godkjende brukaren opprydningssteget som var kommentert ut i `hotfix_store_anon_tighten_2026-07-06.sql`. Køyrt mot `clzczbyklgdtdhgjphup`: `DELETE FROM store WHERE key IN ('crm-bedrifter', 'crm-customers', 'crm-comms', 'leads', 'booking-bookings')`. Stadfesta live rett etterpå — spørring mot `store` for desse fem nøklane returnerer no null rader.
- Dette lukkar det siste attverande hòlet frå det opphavlege Fase 1-funnet om ubetinga anon-lesetilgang til `store`: dei gamle radene finst ikkje lenger, og `store_anon_read` sin denylist frå 0.15.2 er no rein defense-in-depth i staden for den einaste sperra.
- `docs/project/CURRENT_STATE.md` sin "Still open"-post for dette funnet er markert RESOLVED.
- Ingen JS-kodeendring utover versjonsbump. Tester uendra. Cache-bust: `console-core.js` 34→35. `VIBEVERK_VERSION` 0.15.2 → 0.15.3.

## 0.15.2 — 2026-07-06

### Sikkerheit: fire av dei fem "Bolk C"-SQL-utkasta køyrt mot produksjon og stadfesta
- Etter brukargodkjenning vart fire av dei fem `hotfix_*.sql`-filene frå 0.15.1 køyrt mot `clzczbyklgdtdhgjphup` via `npx supabase db query --linked --file ...`, og kvar enkelt stadfesta direkte etterpå ved å lese `pg_proc.prosrc`/`pg_policies` frå produksjonsdatabasen (ikkje berre stole på at kommandoen returnerte utan feil):
  1. `hotfix_signup_role_hardening_2026-07-06.sql` — `handle_new_user()` sin nye `invited_at`-sjekk stadfesta live.
  2. `hotfix_task_created_by_lock_2026-07-06.sql` — `restrict_assignee_task_columns()` sin nye `created_by`-sperre stadfesta live.
  3. `hotfix_console_operator_rls_2026-07-06.sql` — `is_platform_operator()` og den delte `superconfig`/`wsp-orgdrift`-CASE-en i alle tre `store_*_auth`-policyane stadfesta live.
  4. `hotfix_store_anon_tighten_2026-07-06.sql` — `store_anon_read` sin nye denylist stadfesta live. Radetal-verifisering køyrt rett etterpå: nye tabellar er supersett av dei gamle blobene for alle fem nøklane (bedrifter 3→4, kundar 23→24, comms 8→14, leads 2→3, bookingar 0→2) — ingen datatap, differansen er nye rader skrivne etter den opphavlege migreringa.
- **Ikkje køyrt**: den kommenterte `DELETE`-opprydningen av dei gamle store-radene (eiga, seinare godkjenning per `hotfix_store_anon_tighten_2026-07-06.sql` sin eigen instruks) og `hotfix_chat_visitor_rpcs_2026-07-06.sql` (krev `module-chat.js`-klientendring først, sjå 0.15.1).
- `docs/project/CURRENT_STATE.md` sin "Pending"-seksjon oppdatert til å reflektere at desse fire funna no er RETTA (ikkje lenger "SQL DRAFTED, NOT YET RUN").
- Ingen JS-kodeendring i denne runda utover versjonsbump. Tester uendra (`test.js` 488/1, `test-intranet.js` 148/149). Cache-bust: `console-core.js` 33→34. `VIBEVERK_VERSION` 0.15.1 → 0.15.2.

## 0.15.1 — 2026-07-06

### Sikkerheit: SQL-utkast for andre fikse-bolk ("Bolk C") frå 2026-07-04/06-gjennomgangen — INGEN SQL køyrt
- Fem `supabase/hotfix_*.sql`-filer forberedt (og der trygt, folda inn i `migration.sql`) for dei attverande funna frå den kombinerte 2026-07-04/06-gjennomgangen som krev SQL/RLS-endring. **Ingen av dei er køyrt mot Supabase** — alle ventar på eksplisitt godkjenning per fil, per CLAUDE.md sitt deployment-safeguard.
- `hotfix_signup_role_hardening_2026-07-06.sql`: `handle_new_user()` stolar no berre på klient-levert `role`-metadata når `auth.users.invited_at IS NOT NULL` (sett åleine av den ekte `manage-user`-invitasjonsflyten, aldri av eit vanleg signup) — elles alltid `role='member'`. Ingen endring i `manage-user/index.ts` naudsynt.
- `hotfix_store_anon_tighten_2026-07-06.sql`: `store_anon_read` nektar no anon SELECT på nøyaktig dei fem allereie-migrerte private nøklane (`crm-customers`/`crm-bedrifter`/`crm-comms`/`leads`/`booking-bookings`) i staden for ei full allowlist-omskriving — vesentleg lågare risiko for å bryte offentleg sidevising. Inkluderer verifiseringsspørringar og eit separat godkjent, kommentert opprydningssteg.
- `hotfix_task_created_by_lock_2026-07-06.sql`: `restrict_assignee_task_columns()` blokkerer no at ein member kan forfalske `created_by` på ei sjølv-oppretta oppgåve.
- `NOTIFY pgrst, 'reload schema';` lagt til på slutten av `migration.sql` (mangla heilt trass i fleire `CREATE OR REPLACE FUNCTION`-setningar).
- `hotfix_chat_visitor_rpcs_2026-07-06.sql`: nye `update_visitor_presence()`/`insert_visitor_message()` SECURITY DEFINER-RPC-ar, same mønster som dei eksisterande `get_visitor_conv()`/`get_visitor_msgs()`-lesRPC-ane, for å lukke chat-IDOR-en (anon kan i dag oppdatere/skrive til ein kjend samtale-ID utan eigarskapssjekk). **Bevisst IKKJE folda inn i migration.sql og IKKJE køyrbar som han står** — krev ein `module-chat.js`-klientendring i tillegg (full sjekkliste i fila).
- `hotfix_console_operator_rls_2026-07-06.sql` + ny `is_platform_operator()`-hjelpefunksjon: `superconfig`-skriving krev no operatør-e-post (spegel av `SUPERADMIN_EMAILS`) via faktisk JWT, ikkje `is_admin_or_owner()` (tenant-rolle) — eksplisitt vurdert mot skalering til mange kundar saman med brukaren (sjå `docs/decisions/ADR-0004-console-access-decoupled-from-tenant-role.md`, som denne fila spegler prinsippet frå). `wsp-orgdrift` (Workspace sin heilt ulike, kunde-eigne "org drift"-funksjon) er uendra, framleis `is_admin_or_owner()`.
- **Faktisk kodeendring gjort no (trygt uavhengig av om SQL-en over er køyrt eller ikkje)**: `console-core.js` sine `saveSC()`/`resetSC()` skriv no direkte via Console sin eigen OTP-verifiserte Supabase-klient i staden for `App.store.set()`/`.remove()` (som køar skrivinga for `core.js` sin heilt separate, sesjonspersisterande klient — ein annan identitet enn den som nettopp verifiserte OTP-koden). Bakoverkompatibelt: verkar uendra før SQL-en er køyrt (operatøren har i dag også `role='admin'` i denne eine kunden sin `users`-tabell, som framleis tilfredsstiller den gamle policyen).
- Tester: uendra (`test.js` 488/1, `test-intranet.js` 148/149, same to kjende feil — ingen av desse endringane er JS-logikk testane dekker). Cache-bust: `console-core.js` 32→33. `VIBEVERK_VERSION` 0.15.0 → 0.15.1.

## 0.15.0 — 2026-07-06

### Sikkerheit/QA: fyrste fikse-bolk frå 2026-07-04/06-gjennomgangen (klientkode, ingen SQL)
- Runde av «trygge, lokale» rettingar frå den kombinerte 2026-07-04 (UX/QA/Privacy/Security) + 2026-07-06 (Codex Security+Reviewer) gjennomgangen — sjå `docs/project/CURRENT_STATE.md` sin «Pending»-seksjon for full detalj. Ingen SQL endra, ingen deploy/push gjort.
- **BLOCKER — sanitizer-bypass i `sanitizeRichHtml()` (`components.js`)**: `walk()` sin unwrap-gren for ukjende tagger (t.d. `<x>...</x>`) flytta barn ut til foreldre-noden, men re-traverserte dei aldri (forEach itererte ei snapshot-liste tatt før mutasjonen) — eit `<img onerror=...>` verka inni ein ukjend wrapper-tag overlevde difor usanert. Delt ut `processNode()` som ein eigen funksjon slik at promoterte born vert sanert på nytt, uansett kor djupt nesta. `module-crm.js` sin `tlItem()` saner no også `bodyHtml` på nytt ved visning (var berre sanert ved lagring før), som ekstra sikkerheit mot data skrive direkte via REST. 3 nye regresjonstestar i `test.js`.
- **Eldre "store"-blob-funn — ingen kodeendring, berre presisering**: heading i CURRENT_STATE.md som feilaktig sa "RESOLVED" for anon-lekkasjen av gamle CRM-/lead-/booking-rader er retta til å reflektere at berre den *nye* skrivevegen er lukka — dei gamle radene i `store` er framleis anon-lesbare til dei vert eksplisitt godkjent sletta (ikkje gjort denne runda).
- **CSV-formelinjeksjon**: `toCsvValue()` (`core.js`) nøytraliserer no ein leiande `=`/`+`/`-`/`@` med eit apostrof-prefiks (standard Excel/Sheets-mønster), for både leads-, CRM- og booking-eksport (delt funksjon). 5 nye testar.
- **Legacy `"employee"`-rolle**: `getAuthRole()` (`core.js`) normaliserer no `"employee"` til `"member"` ved kjelda, i staden for at kvar enkelt kallstad (CSV-eksport/slett-knappar i `module-crm.js`/`module-booking.js`/`core.js`) trong eit eige unntak — lukkar eit UI-inkonsistens-hol der ein `employee`-rolle synte att CSV-eksport/slett-knappar. 1 ny test.
- **CSV-eksport for leads og bookinger fekk same rollesperre som CRM**: `member` ser no ikkje lenger «Eksporter henvendelser (CSV)» (`core.js`) eller «Eksporter bookinger (CSV)» (`module-booking.js`) — begge var upass forbigått i `b5fd15d`. Kosmetisk (RLS gav uansett `member` lesetilgang), men no konsistent med CRM-eksporten.
- **Fire-and-forget Supabase-skriving logga ikkje feil**: alle CRM- (`module-crm.js`), lead- (`core.js`) og booking- (`module-booking.js`) skrivefunksjonar har no eit `.catch()` som loggar feilen til konsollen — sjølve skrivinga er framleis fire-and-forget (uendra arkitektur), men ein mislykka skriving synest no i konsollen i staden for å forsvinne heilt stille, slik `3e841e1`-produksjonsbuggen gjorde.
- **Anonym sanntidsbooking synte falsk «Reservert!»**: `createBooking()` (`module-booking.js`) forsøkte alltid eit Supabase-innsett når `_sb` var konfigurert, sjølv for uinnlogga besøkande — men `bookings` har ingen anon-GRANT, så innsettet vart alltid avvist stille medan UI synte «Reservert!» uansett. Retta til å følgje same mønster som `addLead()`: uinnlogga besøkande sin booking lagrast lokalt (`App.store`) i staden for å forsøke eit innsett me veit vert avvist — same kjende avgrensing som leads/tilbod (sjå "Still open" i CURRENT_STATE.md), men ikkje lenger ei falsk stadfesting som forsvinn att.
- **CI tolererer no dei to kjende, dokumenterte testfeila** (`.github/workflows/test.yml`) — bygget kan gå grønt ved den forventa 488/1- og 148/149-tilstanden, men stoppar framleis ved uventa nye feil eller eit ufullstendig testkøyring (krasj før oppsummeringslinja).
- **LOW/UX**: dokumentopplastingsfeil (`module-crm.js`, `core.js`, `intranet/module-mediabank-internal.js`) viste alltid 4MB-grensa sjølv når Supabase Storage sin reelle grense (20MB) var det som faktisk avviste fila — retta til å vise rett grense avhengig av om Supabase er konfigurert. CRM-dialogen sin lukk-knapp fekk `aria-label="Lukk"` (app-konvensjonen elles). «Viktig»-notat-taggen sin farge er no `var(--color-primary,#2980B9)` i staden for hardkoda hex, så han følgjer kundens merkevarefarge.
- **Ikkje gjort denne runda (treng levande nettlesarverifisering/UX-vurdering, ikkje ein blind CSS-endring)**: touch-mål under 44px for CRM sine små inline-knappar (`data-task-toggle`, `data-reply-email`, `data-del-comm`, `.crm-merge-check`) og manglande visuell klikkbar-affordance på tidslinje-rader — venstrar til ein UX/Mobile Reviewer-runde.
- Tester: `test.js` 479 → 488 OK (11 nye assertions: 3 sanitizer, 5 CSV-injeksjon, 1 employee-rolle, pluss eksisterande dekning uendra), same eine kjende feil. `test-intranet.js` uendra (148/149, same kjende feil). Cache-bust: `components.js` 6→7, `core.js` 32→33, `module-crm.js` 16→17, `module-booking.js` (rot) 10→11, `intranet/module-mediabank-internal.js` 1→2. `VIBEVERK_VERSION` 0.14.0 → 0.15.0.

## 0.14.0 — 2026-07-03

### CRM: filtrering på tidslinja + klikk-på-rad opnar relevant handling (uavhengig av type)
- To brukarønske same dag som 0.13.0: (1) filtrering av tidslinja på kategori, og (2) i staden for berre ein liten blyant-knapp for redigerbare postar, skal klikk på **sjølve tidslinje-rada** opne den relevante handlinga — for ALLE typar, ikkje berre dei redigerbare.
- **Filtrering**: nye toggle-filterknappar (same mønster som `data-stat-chip` elles i appen) over tidslinja, éin per kategori som faktisk finst hos kunden. Grupperer dei 10 rå `type`-verdiane til 8 kategoriar etter eksplisitt brukarval: e-post sendt/mottatt OG gamle Kontakt-leads vert vist under éin «Kontakt»-knapp (Tilbud/Booking/Telefonnotat/Internt notat/Dokument/Oppgave/Chat har kvar sin eigen). Filterstoda held seg i ein ny `_tlFilter`-variabel nøkla på kunde-id (ikkje ein closure-variabel i `renderCustomer()`, som ville nullstilt seg kvar gong `refresh()` køyrer heile funksjonen på nytt etter ei redigering).
- **Klikk-på-rad**: den vesle blyant-("Rediger")-knappen frå 0.13.0 er fjerna — heile tidslinje-rada er no klikkbar, gjenbrukar eksisterande dialogar/navigasjon der dei finst (ingen nye visningsmodalar bygd):
  - Telefonnotat/Internt notat/Oppgåve/Dokument → opnar redigeringsdialogen (same som blyanten gjorde)
  - E-post sendt/mottatt → opnar den eksisterande svar-komponisten (same som «Svar»-knappen)
  - Gamle Kontakt/Tilbud-leads → gjenbruker `App.openReplyModal()` (same modal som hovud-admin-fanene for Kontakt/Tilbud brukar), førehandsutfylt for den leaden
  - Gamle bookingar → naviger til Booking-fana (ingen eksisterande per-rad-modal å gjenbruke der)
  - Chat → gjenbruker `openChatForCustomer()` sin navigasjonslogikk, men peikar på den spesifikke tidlegare samtalen (`chatId`) i staden for å finne-eller-opprette ei ny
- **Ekte bug funne og retta undervegs, ikkje ein regresjon frå i dag**: `dl.close()` vart kalla direkte (usikra) i alle fire redigeringsdialogane sine Lagre/Avbryt-knappar, i staden for å gå via det trygge try/catch-mønsteret `openDialog()` sin eigen lukk-knapp alt brukar. I ekte nettlesarar kastar aldri `<dialog>.close()`, så dette har aldri vore ein synleg produksjonsfeil — men det gjorde det umogleg å skrive ein jsdom-test som klikkar Lagre på nokon av dei fire dialogane (jsdom manglar reell `<dialog>`-støtte). Ny delt `closeDialog(dl)`-hjelpar, brukt konsekvent på alle 12 stadene i fila som før kalla `dl.close()` direkte.
- Testar: 7 nye i `test.js` (filterknappar vises berre når ≥2 kategoriar finst, filtrering skjuler/viser rette radene, klikk på ei legacy Kontakt-rad opnar `App.openReplyModal`, klikk på ei redigerbar telefonnotat-rad opnar redigeringsdialogen). 472 → 479 OK (framleis 1 kjend feil). `test-intranet.js` uendra (149/148/1).
- Ingen SQL-endring. Cache-bust: module-crm.js 15→16, console-core.js 30→31. `VIBEVERK_VERSION` 0.13.0 → 0.14.0.

## 0.13.0 — 2026-07-03

### CRM: tidslinjehendingar kan no opnast/redigerast att, pluss ekte filopplasting for dokument
- Ønske frå brukaren same sluttest-runde: telefonnotat (Ring), interne notat, oppgåver og dokument på ein kunde sin tidslinje kunne berre opprettast — aldri opnast/redigerast att. Løyst med eit nytt blyant-("Rediger")-ikon i `tlItem()` som dispatchar til dei alt eksisterande `openPhoneDialog()`/`openNoteDialog()`/`openTaskDialog()`/`openDocDialog()`, no alle med ein valfri `existing`-parameter — når han er sett, førehandsutfyller dialogen og kallar `updateComm(existing.id, patch)` i staden for `addComm()` ved lagring.
- Dokument-dialogen fekk i tillegg ekte filopplasting, som erstattar placeholderen «Filopplasting kjem i neste versjon» — brukar den alt eksisterande `App.media.putFile()` (same Supabase Storage-/base64-lokal-fallback-veg som mediebank-modulen), og lagrar resultatet (`{name, ref, type, size}`) som eit `attachment`-felt. Ingen skjemaendring naudsynt — hamnar i `crm_comms.data` jsonb via den alt eksisterande polymorfe comm-mappinga (same mønster som `callDate`/`subject`/osv.). Ny `attachmentChip()`-hjelpar viser den vedlagde fila som ei lenke (med storleik) både i dialogen og i sjølve tidslinje-oppføringa.
- Testar: 2 nye feltmappings-testar i `test.js` for `attachment`-feltet sin round-trip gjennom `jsCommToDb`/`dbCommToJs` (470 → 472 OK, framleis 1 kjend feil). `test-intranet.js` uendra (149/148/1).
- Ingen SQL-endring. Cache-bust: module-crm.js 14→15, console-core.js 29→30. `VIBEVERK_VERSION` 0.12.2 → 0.13.0.

## 0.12.2 — 2026-07-03

### Fann via sluttest: member fekk sjå slett-knappar på Web-admin (ikkje berre Workspace), pluss to ubeslekta UI-feil i CRM
- **Rotårsak**: `isWorkspaceMember()` i `module-crm.js` sjekka BERRE `window.Intranet.getContext().role` — som ikkje finst i det heile på Web-admin-sida. Funksjonen sin eigen kommentar hevda «Web-admin har ikkje member-omgrepet (eitt delt passord)», men det stemmer ikkje i denne (eller nokon reell) konfigurert kundeinstallasjon: `renderAdminLogin()` i `core.js` autentiserer OGSÅ Web-admin mot ekte Supabase Auth (`_sb.auth.signInWithPassword` + oppslag i `users.role`) når Supabase er konfigurert — det delte passordet er berre eit fallback for lokalt/test-miljø. Funnet via brukaren sin manuelle sluttest: ein `member`-brukar kunne laste ned CSV-eksporten (skal vere admin/editor-only) og klikke Slett på kundar/bookingar/leads via Web-admin, ikkje berre Workspace.
- **Retta**: `getAuthRole()` (les rolla frå sessionStorage, alt brukt internt i `core.js`) er no eksponert som `App.getAuthRole`. `isWorkspaceMember()` brukar han no som primærkjelde (fungerer likt på begge flater), med det gamle `window.Intranet`-sjekket som reserve.
- **Utvida sletting-vern**: slett-knappar for leads (`core.js`), bookingar (`module-booking.js` rot) og CRM-kundar/bedrifter/kommunikasjonshendingar (`module-crm.js`) er no SKJULT for member, ikkje berre RLS-blokkert server-side — brukaren peika på nøyaktig dette biletet: «KAN slette, men når man oppdaterer, så detter de tilbake igjen. Bedre om selve slett-knappen er skjult.» (den optimistiske lokale sletting-UI-en gjorde det såg ut som det virka, heilt til ein refresh henta ferskt frå Supabase og viste at RLS korrekt hadde avvist den ekte DELETE-en).
- **To ubeslekta UI-feil funne og retta same runde**:
  - "Åpne"-knappen på ei bedrift i CRM (`bedriftRow()` i `module-crm.js`) mangla heilt `data-bed-open`-attributtet og fekk difor aldri ein klikk-handsamar — pluss at den innhaldande `<div onclick="event.stopPropagation()">` stoppa klikket frå i det heile å nå raden sin eigen handsamar. Berre eit klikk på sjølve rada/kortet opna bedrifta. Retta ved å leggje til attributtet (same mønster som kunde-rada sin «Åpne»-knapp, som alt hadde det rette mønsteret) og utvide klikk-handsamar-filteret til å matche både `li` og `button[data-bed-open]`.
  - Merka som IKKJE retta enno (pre-eksisterande, uavhengig av dagens migrering): telefonnotat/interne notat lagt til på ein kundes tidslinje kan ikkje opnast/redigerast att etter at dei er oppretta (berre slettast, eller — for oppgåve-typen — merkast ferdig). Flagga til brukaren for eit separat avgjerd om dette skal byggjast no eller seinare.
- Testar: `test.js` 470/1 og `test-intranet.js` 149/148/1 uendra (desse er UI-role-/knappe-synlegheitsendringar som automatiserte testar ikkje dekker, sjå den kjende avgrensinga om manglande Supabase-nettverkstest-dekning).
- Ingen SQL-endring denne runda. Cache-bust: core.js 31→32, module-crm.js 13→14, module-booking.js(rot) 9→10, console-core.js 28→29. `VIBEVERK_VERSION` 0.12.1 → 0.12.2.

## 0.12.1 — 2026-07-03

### KRITISK produksjonsfeil retta: `authenticated` mangla GRANT på leads/bookings/CRM-tabellane
- Oppdaga via manuell sluttest same dag: innlogga admin sendte inn Kontakt-skjemaet på nettsida → dukka opp i Web-admin (optimistisk lokal oppdatering), men ALDRI i Workspace, og forsvann frå Web-admin ved refresh.
- Rotårsak: `leads`/`bookings`/`crm_customers`/`crm_bedrifter`/`crm_comms` (frå 0.10.0/0.11.0/0.12.0) fekk RLS-policiar, men vart ALDRI lagt til `migration.sql` sitt grunnleggande `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`-steg — det same steget `store`/`tasks`/`announcements`/`kb_articles`/`links` alt har. Utan tabellnivå-GRANT avviser Postgres alle operasjonar frå `authenticated` med «permission denied for table X» FØR RLS i det heile vert evaluert, uansett kor open RLS-policyen er. Stadfesta direkte via `information_schema.role_table_grants`: `authenticated` hadde null rettar på alle fem tabellane.
- Praktisk konsekvens: sidan `_sb.from("leads").insert(…).then(function(){})` er fire-and-forget utan feilhandtering, feila den ekte INSERT-en stille, mens den optimistiske lokale cache-oppdateringa i `core.js` gjorde det SÅG ut som det virka — heilt til neste `loadLeads()` (t.d. ved refresh) henta ferskt frå Supabase og fann ingenting. Truleg har CRM/leads/bookings vore stille øydelagt for all autentisert lesing/skriving i produksjon sidan kvar tabell sin migrasjon først vart køyrd — uoppdaga fordi ingen levande UI-sluttest vart gjort for CRM (0.10.0) eller leads (0.11.0) tidlegare, berre `pg_tables`/`pg_policies`-sjekkar på skjemanivå. Dette er første gong nokon av dei tre tabellane faktisk vart øvd gjennom den ekte app-UI-en.
- Retta: la til dei fem tabellane i `migration.sql` sitt GRANT-steg. Ny `supabase/hotfix_missing_table_grants_2026-07-03.sql` (rein GRANT, ingen datarisiko, RLS uendra/ikkje svekt — GRANT er det SQL-standard "kan denne rolla i det heile teke på tabellen"-gjerdet, RLS smalnar vidare inn per-rad/per-kommando oppå, same tolags-mønster som `store`/`tasks` alt brukar).
- **SQL køyrt mot produksjon og stadfesta 2026-07-03**: `information_schema.role_table_grants` viser no SELECT/INSERT/UPDATE/DELETE for `authenticated` på alle fem tabellane. Stadfesta at `anon` framleis er fullt blokkert (401 på alle fem via direkte REST-kall med anon-nøkkelen) — fiksen påverkar berre `authenticated`.
- Ingen kodeendring, berre SQL. `VIBEVERK_VERSION` 0.12.0 → 0.12.1 (cache-bust: console-core.js 27 → 28).

## 0.12.0 — 2026-07-03

### Bookingar flytta ut av `store` — tredje og siste steg, CRITICAL-funnet no FULLT LØYST
- Siste steg av flyttinga (sjå 0.10.0 for CRM, 0.11.0 for leads): `booking-bookings`-nøkkelen i `store` flytta til ein ekte `bookings`-tabell, med same RLS-mønster (ingen anon-tilgang, admin/editor full tilgang, member SELECT+INSERT+UPDATE ikkje DELETE). `booking-assets` (ressursane sjølve — bilar/møterom/timar) er **ikkje** del av flyttinga, vert verande i `store` (lav sensitivitet, admin-config, ikkje kundedata). Med dette er alle tre private datasetta identifisert i Fase 1-auditen (2026-07-01) ute av `store` — det opphavlege CRITICAL-funnet om ubetinga anon-SELECT på heile `store`-tabellen er no fullt løyst for kundedata.
- `module-booking.js` og `intranet/module-booking.js` sitt datalag omskrive med same async-cache-mønster som CRM/leads (`_bookings`, `loadBookings()`, `getBookings()`). Arkitektonisk forskjell frå CRM handtert eksplisitt: bookingar vert lesne/skrivne frå TO uavhengige filer (rot-fila for offentleg Web-admin, `intranet/`-fila for Workspace) som aldri lastar samstundes — kvar fil har difor sin eigen uavhengige cache, ikkje ein delt koordineringslag (same vurdering som i arkitekt-planen frå 0.10.0).
- Nytt `window.BookingAdmin` (`getBookings()`/`deleteBookingsByEmail()`), same tilgjengeleggjeringsmønster som `window.CrmAdmin`. Alle attverande direkte `Store.get("booking-bookings")`-lesingar utanfor `module-booking.js` sjølv (5 stader i `core.js`: dashboard-kort, GDPR-sletting, søk/analyse-aggregator, CSV/JSON-eksport; 3 stader i `module-crm.js`: `autoImport()`, `getLegacyHistory()`, `deleteAllForEmail()`; 1 stad i `intranet/intranet-core.js` sine faneskilt-tal; 1 stad i `intranet/module-dashboard.js`) omdirigert via `window.BookingAdmin`/ein ny `bookingBookings()`-hjelpar i kvar fil.
- **Ny regresjon oppdaga og retta undervegs (fanst ikkje i 0.11.0-sveipet)**: `module-crm.js` sin `deleteAllForEmail()` (kalla ved GDPR-sletting av ein CRM-kunde) skreiv leads-slettinga direkte via `App.store.set("leads", …)`, som omgjekk heile den nye Supabase-medvitne `getLeads()`/`deleteLead()`-API-en frå 0.11.0 — sidan `deleteLead` heller ikkje var eksponert på `App`-objektet i det heile. Konsekvens: når Supabase er aktiv, ville denne GDPR-slettinga stille ha late leads-rader stå att i den nye `leads`-tabellen i produksjon (localStorage-skrivinga påverkar ikkje Supabase, og cachen i `core.js` vart heller ikkje oppdatert). Retta: `deleteLead` no eksponert på `App`, og `deleteAllForEmail()` kallar `App.deleteLead(id)` per treff (same rettingsmønster brukt for bookingar i same funksjon).
- Ny produksjons-datamigrering `supabase/hotfix_bookings_data_migration_2026-07-03.sql` — idempotent, slettar ikkje gamle `store`-rader.
- Testar: 4 nye feltmappings-testar i `test.js` (`dbBookingToJs`/`jsBookingToDb`, inkl. standardverdiar når valfrie felt manglar). `test.js`: 466 → 470 OK (framleis 1 kjend feil). `test-intranet.js` uendra (149/148/1).
- **SQL køyrt mot produksjon og stadfesta 2026-07-03** via `npx supabase db query --linked`: både `migration.sql` (bookings-tabell/RLS — stadfesta via `pg_tables`/`pg_policies`: 4 policyar, alle avgrensa til `authenticated`, ingen `anon`) og `hotfix_bookings_data_migration_2026-07-03.sql` (radetal verifisert: 1/1). **Same runde vart den attverande 0.11.0-leads-SQL-en (aldri tidlegare køyrt) også køyrd og stadfesta** (radetal 2/2, fordelt 1 `kontakt`/1 `tilbud`) — brukaren bad eksplisitt om å lukke alt kritisk før sluttesten. Med dette er alle tre private datasetta frå Fase 1-auditen ute av `store` BÅDE i kode/skjema OG i produksjon. Dei gamle `store`-radene for `crm-*`/`leads`/`booking-bookings` er ikkje sletta enno — krev eit separat, eksplisitt godkjent opprydningssteg.

## 0.11.0 — 2026-07-03

### Leads (Kontakt+Tilbud) flytta ut av `store` — del to av CRITICAL-funnet
- Andre steg av flyttinga (sjå 0.10.0 for CRM): `leads`-nøkkelen i `store` (Kontakt-henvendingar OG Tilbud-førespurnadar) flytta til ein ekte `leads`-tabell, med RLS som gir **ingen anon-tilgang i det heile**. Member fekk same tilgang som til CRM (SELECT+INSERT+UPDATE, ikkje DELETE) — brukarval frå planleggingsrunda i 0.10.0, no gjennomført her óg.
- **Ny oppdaging under kartlegginga (ikkje tidlegare dokumentert)**: Tilbud og Kontakt vart ALDRI skilde av eit eige felt — begge brukte `App.addLead()` og vart lagra i same liste, skilt berre ved at meldingsteksten byrja med «Tilbudsforespørsel» (tekst-sniffing, ikkje ein ekte kolonne). Denne sniffinga fanst dupliserte 15+ stader på tvers av `core.js`, `module-quote.js`, `module-crm.js`, `intranet/intranet-core.js`, `intranet/module-dashboard.js`, `intranet/module-contact.js` og `intranet/module-quote.js`. Lagt til eit ekte `kind`-felt (`'kontakt'`/`'tilbud'`) på den nye tabellen, og éin delt hjelpar `App.isTilbud(lead)` (stolar på `kind` når det finst, fell tilbake til tekst-sniffing for eldre/ikkje-migrert data) — erstattar all den spreidde sniffing-logikken.
- `core.js` sitt leads-datalag omskrive med same async-cache-mønster som CRM (`_leads`, `loadLeads()`), MEN med ei viktig justering funne undervegs: I MOTSETNAD til CRM (der modulen sjølv eig all skriving), kan `leads`-nøkkelen bli skriven direkte via `App.store.set("leads", …)` frå andre kodestader (t.d. testoppsett) — ein rein cache-alltid-tilnærming ville då gjort `getLeads()` blind for slike endringar. `getLeads()`/`addLead()`/`updateLead()`/`deleteLead()` les difor alltid FERSKT direkte frå `Store` når Supabase ikkje er konfigurert eller brukaren ikkje er innlogga (akkurat som før 2026-07-03), og brukar berre den asynkrone cachen når Supabase-skriving faktisk er aktiv. **Fanga av eigne testar før commit**: den første versjonen brukte cache ubetinga, og braut ein Workspace Kontakt-test som seier `App.store.set("leads", […])` direkte.
- RLS for anon-INSERT (kontaktskjema/tilbudsskjema for ikkje-innlogga besøkande) er **ikkje** del av denne runda — det er eit separat, alt-dokumentert ope funn (anonyme innsendingar når i dag aldri Supabase, berre localStorage, sjå `docs/project/CURRENT_STATE.md` "Still open").
- Ny produksjons-datamigrering `supabase/hotfix_leads_data_migration_2026-07-03.sql` — set `kind` for eksisterande data basert på den gamle tekst-sniffinga (nye leads etter migreringa får `kind` sett eksplisitt av klienten). Idempotent, slettar ikkje gamle `store`-rader.
- Testar: 9 nye i `test.js` (feltmapping `dbLeadToJs`/`jsLeadToDb`, `isTilbud()`-klassifisering inkl. at `kind` alltid vinn over tekst-sniffing når det finst, og at både Kontakt- og Tilbud-innsending faktisk set rett `kind` gjennom heile den ekte innsendingsflyten, ikkje berre i isolerte mappingtestar). `test.js`: 457 → 466 OK (framleis 1 kjend feil). `test-intranet.js` uendra (149/148/1) etter at cache-alltid-regresjonen vart fanga og retta.
- **Ikkje del av denne runda**: `booking-bookings` er framleis i `store` — same CRITICAL-funn gjeld framleis for denne eine attverande nøkkelen. Ingen SQL er køyrt mot produksjon enno for nokon del av denne runda.

## 0.10.0 — 2026-07-03

### CRM-data (kundar/bedrifter/kommunikasjon) flytta ut av `store` — retta CRITICAL-funnet om ubetinga anon-lesetilgang
- Første steg mot å gjere plattforma klar for ein eksempelkunde (Fase 2 i `docs/roadmap/ROADMAP.md`): eit av dei fire opphavlege HIGH-tryggingsfunna frå Fase 1-auditen (2026-07-01) var at `store`-tabellen sin `store_anon_read`-policy gjev **ubetinga lesetilgang til HEILE tabellen** via den offentlege anon-nøkkelen — inkludert CRM-kundar, bedrifter og kommunikasjonshistorikk, sidan `store` blandar legitimt offentleg config med privat kundedata i same tabell, skilt berre på `key`-verdien (som RLS ikkje kan filtrere trygt på for eitt bruksområde utan å øydelegge eit anna).
- Kalla inn Vibeverk-arkitekten for eit konkret design/plan før implementering (per CLAUDE.md sitt krav for store arkitekturendringar). Brukaren stadfesta to opne spørsmål frå planen: (1) nytt ekte `kind`-felt for Tilbud/Kontakt-leads (kjem i neste runde, leads er ikkje del av denne runda), og (2) member skal ha SAME tilgang til dei nye CRM-tabellane som til dei gamle `store`-nøklane (SELECT+INSERT+UPDATE, ikkje DELETE).
- Tre nye tabellar i `supabase/migration.sql`: `crm_bedrifter`, `crm_customers`, `crm_comms` — med `text` (ikkje `uuid`) som primærnøkkel, sidan mykje av `module-crm.js` sin eksisterande kode (t.d. `findOrCreateBedrift()`) forventar IDen synkront med éin gong, same mønster som `chat_conversations`/`chat_messages` alt brukar i denne fila. `crm_comms` er polymorf (telefonnotat/internt notat/oppgåve/dokument/e-post har heilt ulike tilleggsfelt) — kjende felt (id/customer_id/type/title/created_at) er ekte kolonnar, resten ligg i ein `data` jsonb-kolonne, same mønster som `announcements.attachments jsonb` elles i fila.
- RLS: **ingen anon-tilgang i det heile** til dei tre nye tabellane (sjølve fiksen). Admin/editor: full tilgang. Member: SELECT+INSERT+UPDATE ope, DELETE krev `can_edit_content()` — same regel som CRM-nøklane hadde i `store` før, no utvida til å faktisk gjelde tabellane sjølv, per brukarval.
- Ny atomisk RPC `merge_crm_customers(p_ids, p_primary_id)` for «Slå sammen»-funksjonen i `module-crm.js`, med brukarvald primærkunde (ikkje automatisk eldste-vinn). Flyttar kommunikasjonshistorikken til den overlevande kunden FØR sletting av dei andre — den gamle store-baserte versjonen gjorde ALDRI dette (historikken vart verande orfanert, men ikkje sletta, sidan `store` ikkje har FOREIGN KEY-tvang); med ekte FOREIGN KEY + `ON DELETE CASCADE` ville same åtferd vorte reelt datatap i staden for berre uoppdageleg data.
- `module-crm.js` sitt datalag omskrive: async-lasting med synkron lokal cache (`_customers`/`_bedrifter`/`_comms`, fylt av `loadCrmData()`), same mønster som `intranet/module-tasks.js` sin `_tasks`/`loadTasks()` alt brukar — slik at dei ~60 eksisterande kallstadene på tvers av 1200+ linjer heldt fram uendra. `createCustomer()`/`createBedrift()`/`addComm()` returnerer synkront (klienten genererer IDen, fire-and-forget Supabase-skriving i bakgrunnen — same filosofi som `App.store.set()` alt brukar).
- **Fann og retta tre uventa avhengnadar utanfor `module-crm.js` sjølv**, som elles ville lese frose/forelda data etter denne flyttinga: `core.js` sitt dashboard (kundetal-kort), GDPR-sletting («slett alt for e-post»), søk/analyse-aggregator og ein separat CSV-eksport i sikkerheitskopi-panelet las alle `crm-customers`/`crm-bedrifter` direkte frå `store`; `module-chat.js` las endåtil rått frå `localStorage` direkte, forbi `App.store`. Alle omdirigert via ein ny `window.CrmAdmin`-tilgjengeleggjering (`getCustomers()`/`getBedrifter()`/`deleteCustomersByEmail()`).
- Ny produksjons-datamigrering `supabase/hotfix_crm_data_migration_2026-07-03.sql` — idempotent, slettar IKKJE dei gamle `store`-radene (venter på eksplisitt stadfesting av radetal før eit separat, eksplisitt godkjent opprydningssteg). Ingen ID-mapping naudsynt sidan dei nye tabellane brukar same `text`-ID-format som dei gamle klient-genererte IDane.
- Testar: 11 nye feltmappings-testar i `test.js` (dbCustomerToJs/jsCustomerToDb/dbBedriftToJs/jsBedriftToDb/dbCommToJs/jsCommToDb — inkludert ein test som fangar ein reell bug funne undervegs, der id/created ved eit uhell hamna dobbelt både som ekte kolonne og inni `data` jsonb). **Viktig avgrensing dokumentert**: `_sb` (Supabase-klienten) vert fanga éin gong ved modul-oppstart (same mønster som `module-tasks.js`), så det finst ingen automatisert test av det faktiske Supabase-nettverkskallet i nokon modul i kodebasen (heller ikkje tasks) — berre av felt-mappinga og av fallback-stien (som alt var testa og framleis er det). `test.js`: 446 → 457 OK (framleis 1 kjend feil). `test-intranet.js` uendra (149/148/1).
- **Ikkje del av denne runda**: `leads` (Kontakt+Tilbud) og `booking-bookings` er framleis i `store` — same CRITICAL-funn gjeld framleis for desse to nøklane. Planlagt som neste to steg (sjå arkitekt-planen), med Tilbud/Kontakt-leads sitt nye `kind`-felt som del av steget.
- **SQL køyrt mot produksjon og stadfesta 2026-07-03** via `npx supabase db query --linked`: både `migration.sql` (tabellar/RLS/RPC — stadfesta via `pg_tables`/`pg_policies`/`pg_proc`) og `hotfix_crm_data_migration_2026-07-03.sql` (datamigrering — radetal verifisert: bedrifter 3/3, comms 8/8, kundar 22/23). Kunde-differansen skuldast ein alt-eksisterande dobbel-ID-kollisjon i den gamle test-/dema-dataen (to gamle rader delte same id, `ON CONFLICT DO NOTHING` behaldt den fyrste) — **ikkje** ein migreringsbug. Brukaren stadfesta dette var greitt å miste (test-/dema-data, ikkje ekte kundedata). Dei gamle `store`-radene er ikkje sletta enno — krev eit separat, eksplisitt godkjent opprydningssteg.

## 0.9.5 — 2026-07-03

### Mal-bytte-fiksen frå 0.9.4 — retta til å matche standardmalen sitt format
- Brukaren presiserte at 0.9.4-fiksen sin eigen «Opprinnelig melding fra {navn}: …»-formattering ikkje såg fint ut, og at ALLE malar skal vise innsendinga med SAME format som `DEFAULT_REPLY_TEMPLATE` sin eksisterande avsendar-blokk (`─── / Fra: {navn} <{epost}> / Mottatt: {dato} / ───`), ikkje ei eiga, annleis linje. Brukaren presiserte vidare at dei faktisk innsendte felta varierer per skjema (Kontakt vs. Tilbud, med/utan valfrie felt som telefon/adresse) og må vere fullstendig med, uansett kva som faktisk vart sendt inn.
- `core.js`: mal-bytte-fallbacken bygger no nøyaktig same avsendar-blokk-format som standardmalen (same strek-linjer, same «Fra:»/«Mottatt:»-oppsett), med kundens fullstendige, allereie-formaterte melding (`vars.melding` — som for Tilbud alt inneheld «Jobbeskrivelse»/«Kontaktopplysninger»-strukturen med kun dei faktisk utfylte felta, jf. `module-quote.js`) sett inn uendra under.
- Nye testar i `test.js`: Kontakt-testen frå 0.9.4 utvida til å sjekke «Fra:»/«Mottatt:»-formatet. Ny test for Tilbud: byter til den delte CRM-malen utan `{melding}`, stadfestar at «Jobbeskrivelse», den faktiske jobbeskrivinga kunden skreiv, «Kontaktopplysninger» og kundens namn alle er med — ikkje berre ei generisk melding. `test.js`: 438 → 446 OK (framleis 1 kjend feil). `test-intranet.js` uendra (149/148/1).

## 0.9.4 — 2026-07-03 (sjå 0.9.5 — formatet vart korrigert dagen etter/same dag)

### Mal-bytte i svar-editoren fjerna kundens opphavlege melding — retta
- Brukaren rapporterte: å velje ein ny e-postmal i svar-editoren fjerna kundens innkomande melding frå det som faktisk skulle sendast. Rotårsak: `DEFAULT_REPLY_TEMPLATE` (og dei andre kontekst-standardmalane) inkluderer kundens melding via `{melding}`-plassholdaren, men mal-byttet i `openReplyModal()` (`core.js`) bytte ut heile redigeringsfeltet sitt innhald med den nyvalde malen sin tekst — viss DENNE malen ikkje sjølv inneheldt `{melding}` (t.d. ein kortare, sjølvskriven CRM-mal), forsvann kundens melding heilt frå e-posten.
- Løysing (etter brukarval mellom tre alternativ — «alltid behald automatisk» vart valt): mal-byttet sjekkar no om den ferdig-fylte malteksten allereie inneheld kundens melding-tekst; viss ikkje, vert ho lagt til automatisk nedanfor malteksten. **Formatet på denne tilleggsteksten vart korrigert i 0.9.5 over** — fyrste forsøket brukte ei eiga «Opprinnelig melding fra {navn}:»-linje som ikkje matcha stilen på dei andre malane. Ingen ny knapp/innstilling — gjeld alle e-postdialogar som går via `openReplyModal()` (Kontakt/Booking/Tilbud/Kunder), sidan fiksen sit i den delte funksjonen, ikkje i kvar enkelt kallstad.
- Ny test i `test.js`: legg til ein delt CRM-mal utan `{melding}` i teststubben, vel han frå malvelgaren for Kontakt, stadfestar at både malteksten OG kundens opphavlege melding er med i resultatet. `test.js`: 435 → 438 OK (framleis 1 kjend feil). `test-intranet.js` uendra (149/148/1) — fiksen sit i delt kode allereie dekt av eksisterande kallstad-testar.

## 0.9.3 — 2026-07-03

### Tasks tildelt av admin til member — modalen opnar no att, med skildring + status redigerbart
- Brukaren rapporterte at «member skal kunne opne tildelte oppgåver» framleis ikkje fungerte etter 0.9.1-reverteringa. Undersøking synte at reverteringa attende til 0.8.0-åtferda hadde ein utilsikta konsekvens: `openTaskModal()` sin tidlege `return` for member på oppgåver tildelt av nokon annan gjorde at klikk på rada ikkje synte NOKO som helst — ikkje eingong ei lesevisning. Status kunne framleis endrast via nedtrekket direkte på rada, men det var ingen måte å opne/sjå full skildring i ein modal.
- Brukaren presiserte det endelege kravet: modalen SKAL opne for slike oppgåver. Inni modalen er **skildring og status redigerbart**, **tittel og tildelt er låst** (disabled inputfelt, ikkje skjult).
- `intranet/module-tasks.js`: fjerna den tidlege `return`-en i `openTaskModal()`, erstatta med ein `restrictedMember`-flagg som styrer kva felt som er redigerbare. Tittelfeltet vert rendra som eit disabled inputfelt (same visuelle stil som det eksisterande read-only tildelt-feltet) i staden for eit vanleg tekstfelt. Slett-knappen er skjult for denne saka (ingen eksisterande RLS-policy gjev member DELETE-rett på tasks i det heile, heller ikkje på eigne oppretta oppgåver — usett her, utanfor denne rundas scope). Lagre-handsamaren sender uttrykkeleg den opphavlege tittelen (ikkje verdien lest frå det disabled feltet) for å ikkje stole på nettlesar-åtferd for disabled inputs.
- Server-side: `restrict_assignee_task_columns()`-triggeren i `supabase/migration.sql` utvida til å tillate `description`-endringar i tillegg til `status` for «tildelt av nokon annan»-tilfellet (var berre status før). Ny `supabase/hotfix_tasks_description_editable_2026-07-03.sql` — **køyrt mot produksjon og stadfesta 2026-07-03** via `npx supabase db query --linked`, verifisert mot `pg_proc.prosrc`. Ingen RLS-policy-endring naudsynt (`tasks_assignee` sin `USING`/`WITH CHECK` er uendra).
- Testar: `u7`-blokka i `test-intranet.js` skriven om frå «ingen modal opnar seg» til å dekke heile det nye forløpet — modal opnar, tittel disabled men syner rett verdi, skildring og status redigerbart, tildelt-feltet framleis read-only, ingen slett-knapp, og eit fullt lagre-forløp som stadfestar tittel er uendra medan skildring og status faktisk vart lagra. `test-intranet.js`: 140 → 149 tester (148 OK, framleis berre den kjende `o3`-feilen). `test.js` uendra (435/1).

## 0.9.2 — 2026-07-03

### Fiksa: korrupt bildedata kunne feile med 400 for ALLE roller på Aktuelt
- Brukaren rapporterte at Workspace ikkje let seg opne som member, med ein konsollfeil om ein 400-respons på ein URL som var den JSON-serialiserte teksten til eit tomt bilde-objekt (`{"src":"","pos":"50% 50%","caption":"","creditType":"","alt":""}`), relativt til `intranet/`.
- Rotårsak: `annCard()` i `intranet/module-announcements.js` viser bilete for Aktuelt-saker til **alle roller** (ikkje admin/editor-gata — berre «Ny sak»-knappen og slett-knappen er det), via `App.media.resolveImage(a.image)` → `Media.norm(a.image)` i `core.js`. `norm()` sin fallback for strengverdiar antok at ein kvar streng var ein ferdig biletURL. Éi Aktuelt-sak sitt `image`-felt var (truleg frå ein tidlegare dobbel-serialiseringsfeil) lagra som ein STRENG som ER JSON-teksten sjølv, ikkje eit objekt — `norm()` sette derfor heile JSON-teksten som `img.src`, og `<img src="...">` prøvde å hente ein ugyldig relativ URL, som feila med 400 for kven som helst (admin/editor/member) som opna sida med denne saka synleg.
- Fiksa i `Media.norm()` (`core.js`): ein streng som startar med `{` blir no forsøkt tolka som JSON og re-normalisert som objekt før han elles ville blitt behandla som ein rå URL. Fell trygt tilbake til rå streng-handsaming viss teksten ikkje er gyldig JSON. Vanlege URL-strengar (som aldri startar med `{`) er heilt uendra.
- Nye testar i `test.js` («Media.norm(): dobbelt-serialisert bildedata», 4 assertions) dekker: tom korrupt JSON-streng → tomt objekt, korrupt JSON-streng med faktiske feltverdiar → korrekt uthenta objekt, vanleg URL-streng → uendra åtferd, ugyldig `{`-prefiksa tekst → trygg fallback til rå streng. `test.js`: 431 → 435 OK (framleis 1 kjend feil).
- **Ikkje adressert i denne runda**: kva for éi Aktuelt-sak i produksjonsdatabasen som faktisk har det korrupte `image`-feltet, og korleis det oppstod, er ikkje identifisert eller retta ved kjelda — denne fiksen gjer visninga trygg uansett kva som ligg lagra, men den underliggande datarada er framleis korrupt inntil nokon finn og rettar/nullstiller ho direkte i `store`-tabellen.

### Signaturknappar i alle e-postdialogar (fullfører 0.9.0-sentraliseringa)
- Brukaren presiserte at «Sett inn bedriftssignatur»/«Sett inn personlig signatur» (alt tilgjengeleg i CRM sin svar-editor) også skal finnast i Kontakt/Booking/Tilbud sine svar-editorar, i både Web og Workspace — same mønster som mal-/snippet-sentraliseringa i 0.9.0.
- Ny delt hjelpar `App.buildSignatureOptions()` i `core.js` les `crm-settings.signatureCompany`/`signaturePersonal` (same lagringsnøkkel/datakjelde som CRM sin signatur-editor, ingen duplikat). Kalla frå alle 11 gjenverande `openReplyModal()`-kallstader: Kontakt (`core.js`, `intranet/module-contact.js`), Booking avbook+svar (`module-booking.js` ×2, `intranet/module-booking.js` ×4), Tilbud (`module-quote.js`, `intranet/module-quote.js` ×2).
- `openReplyModal()` sjølv treng ingen endring — `opts.signatureOptions`-støtta fanst alt frå CRM-implementasjonen, berre dei andre kallstadene mangla å sende ho med.
- Nye testar: `test.js` («Malar + #-snippets for Kontakt/Booking/Tilbud»-blokka utvida med 4 signaturknapp-assertions) og `test-intranet.js` (x4b/x9b/x13b, 3 nye assertions). `test.js`: 427 → 431 OK (før 0.9.2-biletfiksen over), `test-intranet.js`: 137 → 140 (139 OK, framleis 1 kjend feil).

---

## 0.9.1 — 2026-07-03

### Tasks tildelt av admin til member — reverterte gårsdagens "heilt read-only"-innstramming
- Brukaren presiserte i dag at 0.9.0-innstramminga («member skal ikkje kunne endre status heller, berre sjå») var feil — å endre status på ei oppgåve tildelt av nokon annan er sjølvsagt normal, kvardagsleg åtferd og skal fungere. Reverterte til regelen frå 0.8.0: status-nedtrekket er redigerbart for tildelte oppgåver, alle andre felt (tittel/skildring/frist/tildelt) er låst, og rad-klikk opnar ikkje redigeringsmodalen for det tilfellet.
- Kode: `intranet/module-tasks.js` reverta til før-0.9.0-versjonen (fjerna `openTaskReadOnlyModal()` og den tilhøyrande grenen i `bindList()`). Testar: `test-intranet.js` sine u7b–u7h-assertions (spesifikke for lesedetalj-modalen) fjerna att, u7 reverta til «ingen modal opnar seg». `test.js` uendra.
- Server-side: ny `supabase/hotfix_tasks_status_editable_revert_2026-07-03.sql` reverterer `hotfix_tasks_readonly_for_assigned_2026-07-02.sql` — `tasks_assignee` er attende til `assigned_to = auth.uid() OR created_by = auth.uid()`, og `restrict_assignee_task_columns()` har att «tildelt av andre: berre status»-greina. Folda inn i `supabase/migration.sql`. **Køyrt mot produksjon og stadfesta 2026-07-03** via `npx supabase db query --linked`, verifisert mot `pg_policies` (`tasks_assignee` sin `qual` viser begge vilkåra att).
- Testar etter revert: `test.js` 427/1 (uendra), `test-intranet.js` 137/136/1 (ned frå 144/143/1 — dei 7 no-irrelevante read-only-modal-testane fjerna).

### Oppdaga same dag: 2026-07-02-runda hadde ikkje faktisk nådd produksjon
- Brukaren rapporterte at «dei fire endringane» ikkje synte seg ved testing. Undersøking synte at live-sida (`vibeverk.no`) framleis serverte fil-versjonar frå FØR heile 0.9.0-runda (`core.js?v=24` i staden for `v=25`, `module-tasks.js?v=6` i staden for den då gjeldande `v=7`, osv.) — stadfesta ved å hente `index.html`/`intranet/index.html` direkte og samanlikne `Last-Modified`-headeren (som var frå FØR den første av dei to relevante push-ane) mot det som faktisk står i `main` på GitHub. Dette er ikkje eit kodeproblem — koden på GitHub er korrekt — men eit GitHub Pages-publiseringsproblem som ikkje er rotårsaksdiagnostisert enno (ingen `gh`/API-tilgang frå dette miljøet). Sjå `docs/project/CURRENT_STATE.md` "Known limitations".
- **Viktig**: dette betyr at 0.9.0-rettingane (Aktuelt-tooltip, CRM-tilgang for member, oppgåve-lesevisning, mal/snippet-sentralisering) enno ikkje var synlege for brukaren då tilbakemeldinga kom — det som blei observert som «status-endring funkar fint» var truleg den daverande LIVE (før-0.9.0) åtferda, ikkje eit avvik frå den nye (no reverterte) koden.
- **Løyst same dag**: eit tomt commit (`git commit --allow-empty`, `928bc9d`) trigga ei ny GitHub Pages-publisering i løpet av rundt eit minutt — stadfesta ved at `Last-Modified` hoppa til push-tidspunktet og at `?v=`-nummera på både `index.html` og `intranet/index.html` no matcha `main` nøyaktig. Rotårsaka til kvifor dei to opphavlege push-ane ikkje trigga ei publisering er framleis ikkje diagnostisert (ingen `gh`/API-tilgang frå dette miljøet) — sjå `docs/project/CURRENT_STATE.md` "Known limitations" for arbeidsrutina inntil rotårsaka er funnen.

---

## 0.9.0 — 2026-07-02

Fire brukarpresiserte korreksjonar til rollemodell/CRM/tasks/e-post-flyten frå tidlegare same dag, implementert som éin samla runde ("avklarte krav — uten ny produktutredning"). Begge SQL-hotfixane er no køyrt mot produksjon og stadfesta via `pg_policies` (sjå eigne avsnitt nedanfor); endringane er committa (`77ce93f`) og pusha til `origin/main` etter uttrykkeleg brukargodkjenning ("kjør").

### Aktuelt-tooltip i Workspace — retta feil diagnose frå same økt
- «Merking»-hjelpeteksten (`C.helpIcon()`) i biletfeltet i Workspace sin Aktuelt-editor (`intranet/module-announcements.js`, delt `imageField()`-komponent) synte rått/uklikkbart. Ein tidlegare fiks same økt la til eit eksplisitt `App.ui.bindHelpIcons()`-kall i `intranet/intranet-core.js` sin `init()`, ut frå ei anslag om at Workspace aldri batt denne. **Feil diagnose**: `core.js` sin eigen `document`-nivå `DOMContentLoaded→App.init()`-bootstrap køyrer alltid, på alle sider (inkl. Workspace), og når `#app` manglar der no-opar `buildShell()`/`renderMain()` trygt før koden uansett når fram til `bindHelpIcons()`. Det eksplisitte kallet batt difor TO klikk-lyttarar på `document`, som kansellerte kvarandre for kvart klikk — tooltipen vart heilt umogleg å opne (verre enn det opphavlege problemet). Retta ved å fjerne det ekstra kallet att; det einaste faktisk manglande stykket var CSS-en (`.help-icon`/`.help-icon__pop`) i `intranet/index.html`, som vart porta inn same økt og står ved lag.

### Kunder (CRM) for member — fjerna agent-inferert rollesperre
- Ei tidlegare fiks same dag la til `roles:["admin","editor"]` på `module-crm.js` sin `Intranet.registerModule()`-registrering, utleia av ein Privacy/Compliance-subagent-vurdering. **Dette var aldri eit uttrykkeleg brukarkrav** — brukaren presiserte at member skal ha normal CRM-tilgang: opprette/redigere kundar og bedrifter, kundehandlingar, malar, snippets/standardtekstar og signaturar. roles-sperra er fjerna att.
- Det einaste attverande CRM-unntaket for member er CSV-eksport av heile kundelista: eksportknappen er skjult for member (`isWorkspaceMember()` i `module-crm.js`), og klikk-handlaren har i tillegg ei eiga rollesjekk som forsvar i djupna. **Dokumentert ærleg**: dette hindrar berre UI-knappen — ein teknisk kompetent member-brukar kan uansett hente identisk kundedata direkte via Supabase REST-API, sidan member alt har legitim lese-/skrivetilgang til `crm-customers`/`crm-bedrifter` (naudsynt for å kunne opprette/redigere kundar i det heile). Det er ikkje presentert som reell datasikring nokon stad.
- Server-side er skrivetilgang for member til CRM-nøklane (`crm-customers`, `crm-bedrifter`, `crm-comms`, `crm-settings`) handheva via ei nøkkel-spesifikk utviding av `store`-policyane i `supabase/migration.sql` — ikkje generell store-skrivetilgang. **Fanga av security-review før nokon av desse vart køyrt**: første utkastet brukte éin `FOR ALL`-policy for utvidinga, som og dekker `DELETE` — sidan `store` er éi JSON-blob per nøkkel, ville det gjeve member ubetinga rett til å slette HEILE kunde-/bedrift-/kommunikasjons-/CRM-innstillingsdatasettet i eitt REST-kall, langt breiare enn det faktiske kravet («opprette/redigere»). Retta ved å dele `store_auth` i kommandospesifikke policyar (`store_insert_auth`/`store_update_auth`/`store_delete_auth`); `DELETE` krev framleis `can_edit_content()` (admin/editor) for alle nøklar, inkludert CRM-nøklane. SQL i `supabase/hotfix_crm_member_access_2026-07-02.sql` er **køyrt mot produksjon og stadfesta**: `pg_policies` for `store`-tabellen viser `store_insert_auth` (INSERT), `store_update_auth` (UPDATE) og `store_delete_auth` (DELETE) som separate policyar, ingen `FOR ALL`-variant attende.

### Tasks tildelt av admin til member — heilt read-only, ikkje status-only
- Innstramming frå ein tidlegare regel same dag («member kan endre status på oppgåver tildelt av andre, resten er låst»). Brukaren presiserte: member skal IKKJE kunne endre noko som helst, inkludert status, på ei oppgåve tildelt av nokon annan — berre sjå ho. Rad-klikk på slike oppgåver opnar no ein rein lesedetalj (`openTaskReadOnlyModal()` i `intranet/module-tasks.js`) med tittel, skildring, status-merke, tildelt-felt og dato — berre lukk/tilbake, ingen redigerbare felt. Member sine eigne, sjølvoppretta oppgåver er framleis fullt redigerbare (uendra).
- Server-side: `tasks_assignee`-policyen i `supabase/migration.sql` er nå berre `created_by = auth.uid()` (fjerna det tidlegare `assigned_to = auth.uid()`-alternativet), og `restrict_assignee_task_columns()`-triggeren er forenkla tilsvarande (den no-uoppnåelege «status-only for tildelt av andre»-greina er fjerna). SQL i `supabase/hotfix_tasks_readonly_for_assigned_2026-07-02.sql` er **køyrt mot produksjon og stadfesta**: `pg_policies` viser `tasks_assignee` som ein enkelt UPDATE-policy att.

### Malar + #-snippets i alle e-postdialogar (sentralisert i `App.openReplyModal()`)
- Kartla alle faktiske e-postinngangar i Web og Workspace: Kontakt (`core.js` / `intranet/module-contact.js`), Booking avbook+svar (`module-booking.js` ×2 / `intranet/module-booking.js` ×4), Tilbud (`module-quote.js` / `intranet/module-quote.js` ×2), i tillegg til Kunder/CRM (`module-crm.js`, hadde alt malvelgar frå før).
- Ny delt hjelpar `App.buildTemplateOptions(entries)` i `core.js` kombinerer kontekstspesifikke malar (t.d. Booking-avbook/-svar, kvar med eiga `email-template-<key>`-lagring) med heile den delte CRM-mallista (`crm-settings.templates`) i éin malvelgar, i same visuelle stil som den eksisterande CRM-malvelgaren. Ingen duplikat datamodell.
- `openReplyModal()` sin rike svar-editor (`canSendDirect`-grenen — krev `crmFull` + konfigurert Supabase) har no ein `#`-snippet-knapp i verktøylinja: skriv `#nøkkelord` i meldingsteksten (eller klikk knappen for full liste) for å velje ein delt standardtekst frå `crm-settings.snippets` — same datakjelde som CRM sine standardtekstar og chat sin tilsvarande `#`-autocomplete i `module-chat.js`. Innsetting via `execCommand("insertText",...)`, støttar klikk, tastatur (pil opp/ned + Enter) og eksplisitt knapp (mobilvenleg).
- `crmFull`-styringa og sjølve e-postsendinga er uendra — dette gjeld berre mal-/snippet-UI-et rundt komponeringa.
- **UX-review-funn retta før merge**: `#`-snippet-lista sin `positionDd()` klemmer no posisjonen innanfor viewporten (var uklemt — kunne rendre delvis/heilt utanfor skjermen på smale mobilskjermar) og bruker berre markør-rektangelet når markøren faktisk står inni editoren (elles trygt fallback til editoren sitt eige rektangel, unngår ein potensiell krasj ved `#`-knapp-klikk utan fokus). `#`-knappen viser no ei tydeleg tomtilstand («Ingen standardtekster ennå…») i staden for å ikkje reagere synleg når ingen standardtekstar finst. Den nye lesedetalj-modalen for tildelte oppgåver (`openTaskReadOnlyModal()`) har fått `max-height:90vh;overflow-y:auto` slik at «Tilbake»-knappen ikkje kan skuvast utanfor skjermen ved lange skildringar. Ei fjerde funn (Merking-hjelpebobla kan klippast av ein `overflow:hidden`-forelder på smale skjermar) er i delt, alt-eksisterande CSS/HTML-struktur brukt identisk på alle tre flater — utanfor denne rundas avgrensa omfang, notert i `docs/project/CURRENT_STATE.md` "Known limitations" for seinare oppfølging.

### Testar
- `test.js`: 405 → 427 OK (framleis 1 kjend feil, uendra). Nye testar for malvelgar+`#`-snippet-knapp på Kontakt/Booking/Tilbud i den rike editoren (inkl. tastaturnavigasjon og klikk-innsetting via stubba `execCommand`).
- `test-intranet.js`: 111 → 144 testar (143 OK, framleis berre den kjende `o3`-feilen). Retta to no-utdaterte testar frå tidlegare rundar same dag (`r3`: forventa at member IKKJE kunne montere CRM-ruta; `u7`: forventa ingen modal ved klikk på tildelt oppgåve) til å reflektere dei nye, presiserte krava, samt nye testar for tooltip-toggle, CSV-eksport skjult+avvist ved direkte handlarkall (stale-DOM-forsvar), og malvelgar/snippet-lista på Kontakt/Booking/Tilbud i Workspace.

## 0.8.0 — 2026-07-02

Samla regresjons- og kvalitetsretting (rollemodell, booking/CRM e-postmalar, bildefelt, chat-polling, kontaktskjema-flagg, personvern-rich-text). Sjå `docs/project/CURRENT_STATE.md` for full status, `docs/architecture/roles-and-tenants.md` for den endelege rollematrisa.

### Console → Modular: fjerna hjelpetekstar (brukarpresisering, etter push)
- `FEAT_HINTS`-hjelpetekstane lagt til under `crmFull`/`contactForm` i avkryssingsgridet øydela formateringa av boksen (gridet er kolonnebasert med fast minstebreidde, ikkje bygd for lengre setningar). Brukaren presiserte at forklaring uansett ikkje trengst, sidan det er operatøren sjølv som styrer desse flagga. Fjerna `FEAT_HINTS`, `.cs-checkbox-hint`-CSS og `.cs-checkbox-item`-wrapperen; `checkboxGrid()` er attende til den enkle, opphavlege forma. Etikett-endringa `crmFull` → «Native e-post» og `contactForm` → «Kontaktskjema» er UENDRA (kun sjølve hjelpeteksten er fjerna).

### Supabase CLI — prosjektbunde oppsett
- Installert `supabase@2.109.0` som lokal dev-avhengnad, køyrbar som `npx supabase`, og oppretta `supabase/config.toml` + CLI-generert `.gitignore` for lokale mellombelse data.
- Brukaren fullførte nettlesarinnlogginga; lokal prosjektref og skrivebeskytta funksjonslisting stadfesta kopling til produksjonsprosjektet `clzczbyklgdtdhgjphup` (`manage-user` og `send-reply` aktive). Ingen SQL eller Edge Function vart deploya under oppsettet.
- Edge Functions kan no deployast direkte frå repoet etter uttrykkeleg brukargodkjenning. Eksisterande `migration.sql`/`hotfix_*.sql` er framleis manuelle Dashboard-script, ikkje CLI-migrasjonar som `db push` oppdagar.
- Oppdaterte både `CLAUDE.md` og `AGENTS.md` med den faktiske CLI-flyten, prosjektrefen og godkjenningssperra, slik at nye agentøkter ikkje fell tilbake til den utdaterte påstanden om at repoet manglar CLI.

### Backdraft-bevis (git-verifisert)
- **Booking-e-postmalar i Workspace var ein reell tilbakerulling, ikkje ein manglande funksjon.** `.admin-form--card`/`.email-tpl-card`-CSS-en vart lagt til `intranet/index.html` i commit `7923ee4` ("Endret i VS", 2026-06-24 01:09), men fjerna att same dag i commit `f34bc67` ("Add files via upload", 12:56) — eit opplastings-overskriv-redigering-mønster. CSS-en er no porta tilbake.
- CRM-signaturvalet som fanst før commit `9165782` var kobla til ein aldri-fungerande e-post-mock (`EmailProvider`) — reell funksjonsregresjon i signaturvalg-UI, men ingen reell e-postleveranse gjekk tapt (den var aldri ekte). Lukka no ved å utvide `openReplyModal` i staden for å attreise den gamle, ikkje-fungerande dialogen.
- Bildefeltet sin tomme-tilstand og chat-adminpollinga sin if/else-if-feil har inga git-bevis for tidlegare fungerande åtferd — klassifisert som ufullstendig opprinneleg implementasjon/designfeil, ikkje revert.

### Rollemodell — funn under Privacy/Compliance-review, retta same økt
- **`module-crm.js` hadde ingen rollegating i det heile** for Workspace (`Intranet.registerModule`) — i motsetnad til `module-users.js` sin `roles:["admin"]`. Enhver innlogga rolle, inkludert member, kunne både sjå «Kunder»-fana og opne kundekort med namn/e-post/telefon/notat/kommunikasjonslogg. Kombinert med `store_read_authenticated`-SQL-en over (som gjev alle autentiserte direkte API-lesetilgang til `store`, inkl. `crm-customers`/`leads`), ville dette gjeve member både UI- og API-tilgang til kundedata. Retta ved å leggje til `roles:["admin","editor"]` på CRM-modulen sin Workspace-registrering, same mønster som `module-users.js`. Handhevast av den eksisterande `intranet-core.js` sin `roles`-sperre (nav-skjuling + rute-nivå-blokkering, ikkje berre UI).
- **Merk:** `store_anon_read` (uendra, ikkje del av denne økta) gjev allereie **anonyme** besøkjande full SELECT på heile `store`-tabellen — eit separat, allereie dokumentert CRITICAL-funn (`docs/project/CURRENT_STATE.md` "Still open"). CRM-rollefiksen over løyser IKKJE dette — den hindrar berre at ein innlogga member-brukar via appen sitt UI/rute-nivå får tilgang dei ikkje skal ha. Ein fullstendig fiks krev den allereie planlagde arkitekturendringa (skilje offentleg config frå privat kundedata i eigne tabellar/nøklar).

### Rollemodell — presisert av brukar i to steg etter første leveranse same dag
- **Steg 1 — member skal kunne opprette oppgåver til seg sjølv, berre ikkje tildele andre.** Første versjon av rollematrisa blokkerte member frå å opprette oppgåver heilt (matcha opphavleg spesifikasjon). Brukaren presiserte at member sjølvsagt skal kunne lage oppgåver til seg sjølv.
- **Steg 2 — member skal og kunne REDIGERE eigne oppgåver fullt ut, ikkje berre opprette.** Første retting (steg 1) blokkerte framleis all redigering av eksisterande oppgåver for member, inkludert deira eigne — for strengt. Brukaren presiserte: «de kan redigere egne oppgåver såklart». Endeleg regel, implementert i `intranet/module-tasks.js`:
  - Oppgåve **member sjølv har oppretta** (`created_by = seg sjølv`): full redigering (tittel/beskriving/frist/status) via redigeringsmodalen — rad-klikk og blyant er no synleg/tillate for eigne oppgåver.
  - Oppgåve **tildelt av nokon annan** (ikkje sjølv oppretta): uendra frå 2026-07-01-tryggleiksfiksen — berre status via rad-nedtrekket, `openTaskModal()` avviser å opne redigeringsmodalen.
  - **Ingen ikkje-admin/editor kan nokon gong tildele ei oppgåve til NOKON ANNAN enn seg sjølv** — handheva i triggeren uavhengig av kven som oppretta oppgåva. Tildelt-feltet er alltid read-only for member (`canAssignTasks()`), same om oppgåva er sjølv oppretta eller ikkje.
  - `intranet/module-dashboard.js` sin «Ny oppgave»-hurtighandling er vist for alle roller att.
- **SQL-policyar køyrde mot produksjon, stadfesta av brukar 2026-07-02** (`supabase/hotfix_tasks_member_self_create_2026-07-02.sql`, folda inn i `migration.sql`): ny `tasks_self_create` INSERT-policy, ei utvida `tasks_assignee` UPDATE-policy (matchar no `created_by = auth.uid()` i tillegg til `assigned_to`), og ein omskriven `restrict_assignee_task_columns()`-trigger som handhevar dei tre reglane over. Køyrd via `npx supabase db query --linked --file ...` (fyrste gong CLI-en er brukt til å køyre SQL i dette prosjektet, etter eksplisitt brukargodkjenning), og verifisert direkte mot `pg_policies`/`pg_proc` i produksjon same økt — alle tre endringane stadfesta korrekt til stades.

### Rollemodell (admin/editor/member) i Workspace
- `intranet/module-dashboard.js`: member ser ikkje hurtighandlingane «Ny kunngjering»/«Ny KB-artikkel» (behelder «Ny oppgave» — sjå presisering over — «Nytt notat» og «Innstillinger»).
- `intranet/module-tasks.js`: member kan opprette OG fullt ut redigere oppgåver dei sjølv har oppretta, men berre endre status (via rad-nedtrekket) på oppgåver tildelt dei av nokon annan — sjå presisering over.
- `intranet/module-mediabank-internal.js`: member får rein lesevisning (ingen kategori-input/dropzone/filinput/slett-knapp); handlarane (`startUpload`, slett) avviser direkte kall for member i tillegg.
- `intranet/module-orgdrift.js`: «Ny» skjult for editor+member (ikkje berre editor, sjå arkitekturgrunngjeving under). `openEditor()` verifiserer admin ved direkte kall.
- **Arkitekturavgjerd (Arkitekten):** heile `wsp-orgdrift`-nøkkelen ligg som éin JSON-blob i `store` — RLS kan ikkje skilje "opprett kort" frå "rediger eksisterande kort" inni blobben. Difor er ALL skriving (ny/rediger/slett), ikkje berre oppretting, gjort admin-only server-side (same mønster som `superconfig`). Editor er dermed read-only for orgdrift, strengare enn den opphavlege "«Ny» skjules for editor"-teksten i oppdraget — grunngjeve fordi UI-skjuling åleine ikkje er ei reell avgrensing når backend uansett ikkje kan skilje dei to handlingane.
- **Oppdaga under arbeidet, ikkje del av opphavleg oppdrag:** `store_auth`-policyen i `supabase/migration.sql` er ein `FOR ALL`-policy, så USING-klausulen styrte òg SELECT — med berre `can_edit_content()` i USING kunne ein "member" ikkje lese SINE EIGNE `store`-rader i det heile (t.d. eigne dashboard-snarvegar), truleg ein utilsikta biverknad av 2026-07-01-tryggleiksfiksen. Retta med ein ny, brei `store_read_authenticated`-SELECT-policy (sjå SQL under).

### SQL — køyrd mot produksjon, stadfesta av brukar 2026-07-02
Samla i `supabase/hotfix_role_enforcement_2026-07-02.sql` og folda inn i `supabase/migration.sql`. Køyrd manuelt av brukaren i Supabase Dashboard → SQL Editor mot `clzczbyklgdtdhgjphup`, stadfesta same dag:
- `store_auth`: la til `wsp-orgdrift` i den admin-only nøkkel-avgrensinga (same mønster som `superconfig`).
- `store_read_authenticated`: ny SELECT-policy som gjev alle autentiserte lesetilgang til `store` (rettar det oppdaga latente lesetilgang-hòlet over, utan å svekke skrive-avgrensinga).
- `media_insert` (Supabase Storage): kravde tidlegare berre `authenticated`, ingen rollesjekk — no krev `can_edit_content()` (admin/editor), i tråd med `media_delete` som alt var korrekt.

### Booking e-postmalar i Workspace
- Porta `.admin-form--card`/`.email-tpl-card`/`.imgfield__*`-CSS til `intranet/index.html` (fanst berre i `index.html`).
- La til «Avbook»-knapp og -handlar i `intranet/module-booking.js` (både bookingrad og detaljmodal) — Workspace speilar no Web-admin sin Avbook/Svar-todeling. Avbookingsmalen kunne før ikkje brukast frå Workspace i det heile.
- La til kort forklaring ved kvar mal (Kontakt/Booking) om kva knapp/handling som brukar han.

### CRM-maler, signatur og variablar i openReplyModal
- Utvida den delte `App.openReplyModal()` (`core.js`) med valgfrie, bakoverkompatible parametre: `templateOptions` (malvelgar) og `signatureOptions` (signatur-innsetjingsknappar). Kontakt/Booking/Tilbud sender ingen av delane og er difor 100 % uendra.
- `module-crm.js` sin `openEmailDialog()` sender no CRM-malar og signaturar (frå `Kunder → CRM-innstillingar`) inn i den same dialogen — malar kan no faktisk gjenbrukast slik teksten i UI-et alt hevda.
- Malinnhald og signatur saneres (`C.sanitizeRichHtml`) før innsetjing i tillegg til før sending.
- CRM-signaturtekst retta frå «vises automatisk» til å skildre den faktiske, eksplisitte «Sett inn»-knapp-åtferda.
- Retta `test-intranet.js` til å laste den aktive `module-crm.js` (rot-fila) i staden for den daude `intranet/module-crm.js` — CRM har no fyrste gong dedikert Workspace-testdekning.
- Retta variabel-mismatch: `intranet/module-quote.js` sende ikkje `{melding}` (Web-sida gjorde det) — no identisk mellom Web og Workspace.

### Bilderamme / Aktuelt-bug
- Root cause: `bindImageFields()` (`core.js`) tvang tomt bildefelt til `width:100%`/`aspect-ratio:16/9` uansett kontekst. Retta til ei kompakt tom-tilstand (`clamp(96px, 20vw, 140px)` høgd via CSS), som ekspanderer når eit bilde faktisk er valt. Delt kode — verkar likt i Web-admin og Workspace (som i tillegg mangla heile `.imgfield__*`-CSS-blokka, no porta inn).

### Chat: meldingar utan at mottakaren må sende noko
- `module-chat.js` sin admin-pollingsløkke bygde samtalelista OG henta nye meldingar for aktiv samtale i eit if/else-if — ei ny melding (som óg oppdaterer `chat_conversations.last_at`) kunne difor bli fanga av metadata-grenen og aldri hente sjølve meldinga same pollrunde. Omstrukturert til to uavhengige sjekkar. Realtime-abonnementet (ueendra) dekkjer normalt dette live; pollinga er no ein reell fallback-garanti.
- La til umiddelbar avstemming ved montering (ventar ikkje på første intervall).
- La til ein regresjonstest i `supabase/chat-tests.js` som reproduserer race-scenarioet på dataflyt-nivå.

### features.contactForm (nytt, bakoverkompatibelt flagg)
- Nytt flagg i `config.js → features.contactForm` (standard `true` — uendra åtferd for eksisterande kundar). Når `false`: kontaktskjema, samtykkeboks og send-knapp vert ikkje rendra, men Kontakt-seksjonen og all kontaktinformasjon (e-post/telefon/adresse/ekstrafelt/sosiale lenker) vert framleis vist. `bindContactForm()` no-oper trygt når skjemaet ikkje finst.
- `computeDefaultPrivacyText()` tek no omsyn til flagget — påstår ikkje lenger innsamling via kontaktskjema når det er avslått.
- Synleg i Console → Modular som «Kontaktskjema».

### Console
- `features.crmFull` sin brukarretta etikett endra frå «Kunder — direkte e-post (Resend)» til «Native e-post», med kort hjelpetekst. Sjølve konfignøkkelen `crmFull` er UENDRA (ADR-0002).
- Personverneditoren bruker no det delte rik-tekst-mønsteret (`C.richTextField`/`App.ui.bindRichTextFields`/`readRichTextField`) i staden for eit vanleg textarea. Gammal rein-tekst-personverntekst vert migrert éin gong, idempotent, til HTML (avsnitt/linjeskift bevart) via ein ny delt hjelpefunksjon `App.ui.textToRichHtml`.

### Testar
- 33 nye assertions i `test.js` (405 OK/1 kjend FEIL, opp frå 372/1), 41 nye i `test-intranet.js` (106 tester, 105 OK/1 kjend FEIL, opp frå 65/64/1) — talet steig undervegs (99/98/1 → 101/100/1 etter CRM-rollefiksen → 106/105/1 etter member-oppretter-eigne-oppgåver-presiseringa). Dei to kjende feila er dei same som før (uendra).

### Ikkje gjort (dokumentert, krev eiga avgjerd)
- Workspace sin Tilbud-modul (`intranet/module-quote.js`) manglar framleis ein eigen «E-postmalar»-fane (i motsetnad til Booking, som no har ein) — malen kan i dag berre redigerast frå Web-admin. Ikkje bygd, då det ikkje var eksplisitt bede om i dette oppdraget.
- Språkstrategi (nb/nn-blanding, ingen i18n-infrastruktur) er dokumentert i `docs/project/CURRENT_STATE.md`, men ingen avgjerd er teken — krev brukarstadfesting før vidare arbeid.

## 0.7.0 — 2026-07-01

Oppfølging av 0.6.0-sikkerheitsaudit, sammenstilt mot ein uavhengig Codex/GPT-review. Codex sine funn stemte i hovudsak overeins med Claude sin eigen audit (same BLOCKER-funn, same HIGH-funn); dei fann i tillegg to reelle gap Claude sin audit ikkje hadde fanga opp (sjå under). Delt i (a) trygge kodefiksar gjort no, og (b) SQL-endringar samla i eiga fil for eksplisitt godkjenning før noko køyrast mot Supabase, per `CLAUDE.md`.

### Retta (kode, lokalt testa — ingen Supabase-endring)
- **Stored XSS i e-postsvar-modalen.** `openReplyModal` (`core.js`) sin eigen rich-text-editor sende raw `innerHTML` til `send-reply` og til CRM sin `addComm()`-historikk, utanom appen sin faktiske sanitizer (`C.sanitizeRichHtml`) som elles brukast overalt (`bindRichTextFields`/`readRichTextField`). Ein admin som limte inn eller skreiv `<script>`/`onerror=`-innhald i eit e-postsvar fekk det lagra usanert og seinare rendra raw i kundehistorikken. Retta ved å sanere før sending.
- **Hardkoda CSP blokkerte framtidige kundeprosjekt.** `connect-src` i alle fire HTML-innganger (`index.html`, `intranet/index.html`, `console/index.html`, `admin/index.html`) peika på éin spesifikk Supabase-hostnamn (`clzczbyklgdtdhgjphup.supabase.co`). Endra til `https://*.supabase.co`/`wss://*.supabase.co` slik at ein fork med eit anna Supabase-prosjekt ikkje vert blokkert av CSP.
- **`send-reply`-funksjonen (Edge Function) mangla grunnleggande inndata-avgrensingar.** Lagt til e-postformat-validering, lengdegrenser på emne/tekst/HTML, og talls-/storleiksgrenser på vedlegg — hindrar openbre feilinntastingar og uforholdsmessig store/mange nyttelaster frå ein autorisert konto. Retta i koden og **redeploya til produksjon same dag** via Supabase Dashboard sin Edge Function-editor (fyrste forsøk feila med ein bundler-parsefeil frå eit lime-inn-artefakt i editoren — same feilmønster som den tidlegare `manage-user`-korrupsjonen; løyst ved å tømme editoren heilt før nytt lime-inn).
- **CI-testane kunne henge (og — verre — vart tidlegare kutta stille).** Undersøkte Codex sin påstand om at Node-testprosessen kunne henge på grunn av `setInterval` (admin-badge-refresh m.fl.) som aldri vert cleara. Eit første forsøk (tvungen `process.exit()` på slutten av testfilene) viste seg å ha ein alvorleg biverknad: `test.js` sin asynkrone testblokk (`(async () => {...})()`, ca. 90 % av alle testar) var ikkje `await`a, så `process.exit()` avslutta prosessen FØR den asynkrone blokken faktisk var ferdig — output vart stille kutta etter berre ca. 25 av 372 testar, utan feilmelding. Retta ordentleg: fanga opp IIFE-en sitt promise og ventar på at han er ferdig (`.catch().then(...)`) før ein flusher stdout og avsluttar prosessen. Verifisert: `test.js` køyrer no alle 372 testar til slutt (371 OK/1 FEIL, ~2 sek), `test-intranet.js` uendra (64 OK/1 FEIL, <1 sek).
- **`hub/tenants.js` sitt plaintext-passord** vart vurdert, men **ikkje fiksa** — fila er reelt offentleg deployert (`hub/index.html` finst, ingen deploy-ekskludering), så ei ny passordstreng ville berre vore ein skinnfiks. Står open for ei reell brukaravgjerd (ekte auth vs. fjerne Hub frå offentleg deploy).

### SQL-fiksar — køyrde mot produksjon, stadfesta av brukar 2026-07-01
Samla i `supabase/hotfix_security_audit_2026-07-01.sql`, køyrd manuelt av brukaren i Supabase Dashboard → SQL Editor mot `clzczbyklgdtdhgjphup` ("Success. No rows returned"), og lagt inn i `supabase/migration.sql` for framtidige/friske kundeprosjekt:
- **Sjølv-eskalering til admin via `users`-tabellen.** `users_self_update`-policyen sjekka berre at raden var din eigen, ikkje at `role`-kolonnen forblei uendra (RLS er rad-nivå, ikkje kolonne-nivå) — ein "member" kunne PATCH-e seg sjølv til admin. Lagt til ein `BEFORE UPDATE`-trigger som blokkerer rolleendring med mindre kallaren alt er admin.
- **`store`- og `media`-skrive-policyar opne for alle autentiserte, ikkje berre admin/editor.** `store_auth` tillet kva som helst innlogga brukar å overskrive `superconfig` (feature-flagg, tema, personverntekst); `media_delete` sjekka berre `bucket_id`, ikkje eigarskap. Retta med nøkkel-avgrensa policy (`superconfig` krev admin, resten krev `can_edit_content()`) og eigarskaps-sjekk på media-sletting.
- **Oppgåve-tildelt brukar kunne endre alt, ikkje berre status.** `tasks_assignee` sin `WITH CHECK` avgrensa ikkje kolonnar. Lagt til ein trigger som blokkerer endring av tittel/beskrivelse/tildeling/frist for ikkje-admin/editor-brukarar som berre er tildelt oppgåva.
- **Fold inn drifta hotfixar.** `hotfix_chat_system_msg.sql` (tillèt anon `sender='system'`) er no del av `migration.sql` sjølv. `hotfix_tasks_rls.sql` sitt framlegg om `WITH CHECK(true)` på `tasks_assignee` vart eksplisitt **forkasta** (farleg — ville tillate omtildeling til kven som helst) og fila er markert som overstyrt av dei trygge trigger-baserte fiksane over.

### Ikkje del av denne runden (eigne, større arkitektur-oppgåver)
- Chat anon IDOR (`chat_conversations`/`chat_messages`) — krev SECURITY DEFINER RPC-ar + `module-chat.js`-klientendring, ikkje ei isolert SQL-endring.
- Kontakt/Tilbud/Booking-leads når ikkje Supabase for anonyme besøkjande (`_flushSync()` krev autentisert sesjon) — krev ein ekte tabell + anon-RPC, ikkje ei RLS-justering.

Sjå `docs/project/CURRENT_STATE.md` for oppdatert status på alle opne funn.

## 0.6.0 — 2026-07-01

### Retta (brukarrapportert etter 0.5.0)
- **Manglande emnefelt i e-postsvar.** `openReplyModal` (`core.js`) hadde ingen synleg emnefelt — CRM sitt nye kall (0.5.0) sende `subject:""` for nye e-postar, som gjorde at `send-reply` avviste alt med "Manglande felt: to_email, subject, body". Lagt til eige emnefelt i modalen med klientside-validering.
- **Arbeidsområdenavn i Console vart alltid overstyrt.** Kunden si eiga "Bedriftsnavn"-innstilling i Workspace vann alltid over Console sitt eksplisitte val. Snudd prioriteten i `intranet-core.js`: Console sitt val vinn no først.

### Retta (kritisk, frå full sikkerheitsaudit — Fase 1)
Full sikkerheitsaudit og personvernvurdering vart gjennomført denne dagen (sjå `.codex/agents/vibeverk-security-auditor.toml` for metodikk). To funn kravde umiddelbar retting:
- **BLOCKER — sjølv-eskalering til admin.** `core.js` sin `renderAdminLogin()`-innloggingshandlar (linje 1028) hadde ei attverande fail-open standardverdi til `"admin"` ved feila rolleoppslag — ein separat, ufiksa kopi av same feilklasse ADR-0005 lukka i `onAuthStateChange`. Enhver innlogga medlem/redaktør kunne trivielt få full admin-tilgang ved å blokkere éin nettverksførespurnad i DevTools. Retta til `"member"`, saman med to urelaterte defensive fallbackar (linje 891, 1054).
- **REGRESJON (introdusert same dag i 0.5.0).** `module-users.js` sin ADR-0006-opprydding fjerna `visibleUsers`-variabelen, men éin bruk (linje 164) vart ståande igjen — kasta ein `ReferenceError` og gjorde Brukar-panelet i web-admin heilt ubrukeleg. Retta.
- `supabase/functions/send-reply/index.ts` sin rollesjekk hadde framleis `"owner"` i lista (daud verdi sidan ADR-0006) — fjerna for konsistens, ingen åtferdsendring i produksjon før eventuell redeploy.

### Avdekte, IKKJE retta enno (krev brukargodkjenning — Supabase-endringar)
- **KRITISK: `store`-tabellen sin `anon`-SELECT-policy har ingen nøkkel-avgrensing** (`GRANT SELECT ON store TO anon` + `USING (true)`). Sidan CRM-kundar, leads, tilbod og bookingar no lagrast i same tabell, kan kven som helst med den offentlege anon-nøkkelen lese ut all denne dataen direkte via Supabase sitt REST-API. Står i motstrid til `docs/architecture/storage-and-data-flow.md` sin (feilaktige) påstand om at anon ikkje har tilgang.
- `store`- og `media`-tabellane sine skrive-policyar krev berre `authenticated`, ikkje `admin` — kva som helst innlogga medlem/redaktør kan overskrive `superconfig` (feature-flagg, tema, personverntekst) eller slette andre sine opplasta filer.
- `chat_conversations` sin anon UPDATE-policy manglar visitor-eigarskap-sjekk (IDOR), kombinert med svake, gjettbare chat/visitor-ID-ar (`Date.now()` + 4 teikn, ingen kryptografisk tilfeldigheit).
- `supabase/migration.sql` har drifta frå deployerte hotfixar (`hotfix_tasks_rls.sql`, `hotfix_chat_system_msg.sql`) — ein fersk kundeoppsett (Fase 2, demo-kunde) vil i dag arve alt-fiksa feil.
- Personvernvurderinga fann i tillegg: uklart om anonyme Kontakt/Tilbod/Booking-innsendingar faktisk når Supabase (krev manuell test), og at den autogenererte personvernteksten (`computeDefaultPrivacyText()`) hevdar ustadfesta ting (EU-servere, automatisk sletting) og ikkje nemner Chat som datakjelde.

Sjå `docs/project/CURRENT_STATE.md` for full status. Desse krev Supabase SQL-endringar og skal diskuterast/godkjennast eksplisitt før dei vert gjennomførte, per `CLAUDE.md`.

## 0.5.0 — 2026-07-01

### Retta
- **Chat: feil melding ved minimering.** "Kunden lukket chatvinduet." vart tidlegare sendt når kunden berre minimerte chat-vindauget (bobla eller "Minimer"-knappen), ikkje berre ved faktisk avslutning. Flytta til `#vw-end-btn`-handlaren (`module-chat.js`), der samtalen faktisk vert avslutta (`Chat.setStatus(convId,"closed")`).
- **Oppgåve-tildeling opna for alle roller.** Tildelar-feltet i oppgåve-modalen (`intranet/module-tasks.js`) hadde ingen rollesjekk. No gata til admin-rolla; andre roller ser noverande tildeling read-only og kan ikkje endre henne (bevarer eksisterande tildeling ved lagring i staden for å nullstille).
- **CRM-kundekort brukte ei eldre, parallell e-postløysing** (`EmailProvider`-mock, `openEmailDialog()`/`openEmailDrawer()`) som aldri respekterte `crmFull` (ADR-0002) — synte alltid eit "Send e-post"-skjema som i praksis ikkje sende noko ekte. Fjerna, erstatta med delte `App.openReplyModal()` i både `module-crm.js` (deler seg dobbelt inn i Web-admin og Workspace, sjå funn under) og `intranet/module-crm.js`.
- **ADR-0005**: Same passord-bakveg-lukking som ADR-0003 (web-admin) porta til intranett-innlogginga (`intranet/intranet-core.js`), som hadde nøyaktig same hòl uendra. Samstundes retta fail-open rolle-fallbackar (`|| "owner"`/`|| "admin"` ved feila rolleoppslag) til fail-closed (`|| "member"`) i `core.js` og `intranet-core.js`.
- **ADR-0006**: Fjerna alle attverande "owner"-rollereferansar (`module-users.js` sin faktiske bug — tilbaud `owner` som veljbar rolle sjølv om databasen forkastar han; forenkla redundante `role==="owner"||role==="admin"`-sjekkar; oppdatert docs/agent-prompts som framleis skildra owner som gyldig).

### Forbetra
- **Console:** "Arbeidsområdenavn" er no ein eksplisitt avkrysningsboks ("Bruk eige namn...") i staden for ei stille, uforklart fallback-kjede. Admin-passord-hjelpeteksten oppdatert til å forklare at feltet berre har effekt i reint lokalt/test-miljø (ADR-0003).
- Fjerna heilt ubrukt `config.js → workspace.logoUrl` (ingen Console-felt, aldri lese av `intranet-core.js`).

### Oppdaga (eiga sak, IKKJE retta no)
- **`intranet/module-crm.js` er reelt ubrukt i produksjon.** `intranet/index.html` lastar `../module-crm.js` (rot-fila), som dual-registrerer seg for både Web-admin (`App.registerModule`) og Workspace (`window.Intranet.registerModule`) — akkurat som `module-chat.js`. Den separate `intranet/module-crm.js`-fila vert aldri lasta av nokon faktisk side. MEN `test-intranet.js` (linje 17, 53) hardkodar evaluering av nettopp `intranet/module-crm.js` for CRM-testar — testsuiten dekkjer altså ei fil som aldri køyrer i nettlesaren, medan rot-`module-crm.js` sin Workspace-spesifikke registreringsgrein (den som faktisk køyrer) ikkje har eiga Workspace-retta testdekning utover det `test.js` (offentleg side) tilfeldigvis dekkjer. Krev ei eiga avgjerd: slett `intranet/module-crm.js` (dødt) og fjern spesialbehandlinga i `test-intranet.js`, eller noko anna — ikkje gjort i denne økta.

## 0.4.0 — 2026-07-01

### Retta (kritisk)
- **Console-innlogging brukt fungerte ikkje for Vibeverk-operatøren sjølv.** `console-core.js` sin OTP-verifisering kravde i tillegg at den innloggande kontoen hadde `role = 'owner'` i kundens `users`-tabell — ein leivning frå før `SUPERADMIN_EMAILS`-allowlista fanst. Brukaren sin eigen konto hadde `role = 'admin'` i produksjonsprosjektet, så tilgang vart nekta ("Tilgang nekta — ikkje owner-konto") sjølv om e-post-allowlista og OTP-en var heilt gyldige. Fjerna heile `users.role`-oppslaget frå Console — `SUPERADMIN_EMAILS` + gyldig OTP er no den fulle og einaste tilgangssjekken. Sjå `docs/decisions/ADR-0004-console-access-decoupled-from-tenant-role.md`.

## 0.3.0 — 2026-07-01

### Retta (kritisk)
- **Web-admin passord-bakveg lukka.** `renderAdminLogin()` (`core.js`) skilde ikkje mellom "Supabase er ikkje konfigurert" (lokalt/test — passord-fallback OK) og "Supabase ER konfigurert men SDK-en feila å laste" (produksjon — skulle ALDRI falle tilbake til passord). No viser sistnemnde ei "prøv igjen"-feilmelding i staden. Sjå `docs/decisions/ADR-0003-close-admin-auth-fallback.md`. Brukarkrav: *"Det skal ikke være bakveier eller risikofaktorerer. Man skal kun kunne autorisere seg via bruker/supabase."*
- **`supabase/functions/manage-user/index.ts` gjenoppretta.** Fila var trunkert til 2 teikn (`"Be"`) i arbeidskopien/HEAD, stadfesta via `git show` at dette skjedde i commit `a943d59` ("ok") — truleg eit uhell, ikkje fanga opp av testsuitene sidan Edge Functions ikkje er dekte av `test.js`/`test-intranet.js`. Gjenoppretta frå siste kjende gode commit (`59b2dbb`), og **redeploya til produksjon 2026-07-01** (manuelt via Supabase Dashboard → Edge Functions-editor, ikkje CLI — sjå eige punkt under).
- **`admin/index.html` cache-versjon-etterslep retta.** La til manglande `module-scrollbanner.js`, bumpa `module-crm.js` (v5→v7), `module-chat.js` (v7→v10), `module-users.js` (v5→v9) til å matche `index.html`.

### Driftsnotat
- Forsøk på å deploye `manage-user` via Supabase CLI (`supabase functions deploy`) frå denne økta feila på miljø-/token-handtering (persistente miljøvariablar propagerer ikkje pålitelig mellom terminal-instansar i dette oppsettet). Løyst ved å deploye direkte via Supabase Dashboard sin innebygde Edge Function-editor i staden — fungerer utan CLI, men har inga versjonskontroll i dashbordet sjølv. Repoet (denne fila) er framleis kjeldekode-sanninga; hugs å halde dei synkroniserte om nokon redigerer direkte i dashbordet seinare.

### Avklart
- `hotfix_visitor_rpcs.sql` **stadfesta køyrt** i produksjons-Supabase av brukar — visitor-chat fungerer. Fjerna frå "External verification required" i `docs/project/CURRENT_STATE.md`.

## 0.2.0 — 2026-07-01

### Retta
- **Inkonsistent e-postsvar mellom Web og Workspace.** `openReplyModal` (`core.js`) avgjorde tidlegare direktesending (Resend) vs. Outlook (mailto) ut frå `window.Intranet` — altså kor koden køyrde, ikkje kva kunden faktisk har kjøpt. Web-admin fekk difor alltid berre mailto, Workspace fekk alltid direktesending, uavhengig av funksjonspakke
- Nytt flagg **`features.crmFull`** i `config.js` (krev `features.crm`) styrer no dette identisk i Web og Workspace. IKKJE default `true` for nye kundar — eksplisitt val per kunde, lagt til i Console → Modular (`FEAT_LABELS`). Sjå `docs/decisions/ADR-0002-crmfull-email-tiering.md` for grunngjevinga.
- `intranet/module-settings.js`: `emailProviderCard()` bytta frå eit M365/Gmail/IMAP/"Vibeverk Mail"-val merka "Mockup" (lova sending OG mottak, ingen backend) til ei ærleg statuslinje som viser faktisk tilstand basert på `crmFull`, pluss eksplisitt "Mottak av e-post er ikkje støtta enno"

### Avklart (ikkje bygd enno)
- Motta e-post (inbound): konsept avklart — svar på ein sendt e-post skal kome inn att som ny melding på same `lead` i den delte `leads`-lista og setje status til `"ny"`. Sett på vent av brukar 2026-07-01. Sjå `docs/roadmap/ROADMAP.md` og `docs/archive/roadmap-2026-07-01.md` (steg 6f) for full design

### Oppdaga (ikkje retta no, eiga sak)
- `admin/index.html` (dedikert admin-URL) har store cache-versjon-etterslep mot `index.html`: `module-crm.js` v5 vs v7, `module-chat.js` v7 vs v10, `module-users.js` v5 vs v9, og manglar `module-scrollbanner.js` heilt. `core.js` retta til v18 no sidan det var del av denne endringa, resten står ope

## 0.1.0 — 2026-07-01

### Lagt til
- Versjons- og endringslogg innført (denne fila) for å sikre kontinuitet på tvers av økter og agentar
- Versjonsnummer vist i Console (sidebar-footer, under «Logg ut»)

### Kontekst / verifisert i denne økta
- `send-reply` Edge Function (Resend-integrasjon for e-postsvar frå admin, med vedlegg og HTML-støtte) er koda og i bruk frå `core.js` (rundt linje 2958)
- Avsendaradresse: `noreply@vibeverk.no` (`RESEND_FROM_EMAIL`, standardverdi). Reply-to: `hei@vibeverk.no` (`RESEND_REPLY_TO`, standardverdi) — dette er svaradressa kunden ser, ikkje avsendaradressa
- For fullstendig historikk fram til no: sjå `docs/project/CURRENT_STATE.md` og `docs/archive/roadmap-2026-07-01.md`
