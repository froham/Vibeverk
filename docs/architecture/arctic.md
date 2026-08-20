# Arctic — intern driftsflate og modellverksted

Arctic er en global, tenant-uavhengig seksjon i Vibeverk Console. Første vertikal samler avgrenset driftsstatus, det eksisterende lokale AI Lab-et, arbeidsøkt-adaptere, en fast tjenesteliste og et eksplisitt kommandoregister. Arctic leser ikke valgt kundes `App.store`, kundedata eller private Supabase-prosjekt.

Dette dokumentet beskriver v0.159.2-releasekandidaten (etter at `arctic-ai-lab-rc` vart slått saman med `main` sin QR-modul og personvern-rettingar 2026-08-20; sjølve Arctic/AI Lab-innhaldet er identisk med det tidlegare omtala som v0.158.1, berre omnummerert for å unngå ein versjonskollisjon med `main`, sjå `docs/project/CHANGELOG.md` 0.159.2). Det er ikke gjort noen databasemigrasjon eller produksjonsutrulling. Produksjonsgrensesnittet returnerer fortsatt bevisst `not_configured`/`gateway_not_configured` for drift og kommandoer; den eneste nye forbindelsen er en eksplisitt, lokal browser-bro til AI Lab/Gemma. Vercel-opplasting har i tillegg en eksplisitt `.vercelignore`-grense for lokale miljø- og runtimefiler.

## Flater og forbindelser

| Miljø | Nettleser-API | Serveradapter | Faktisk tilgang |
|---|---|---|---|
| Lokal utvikling | `/__arctic/v1/*` og eksisterende `/__ai-lab/v1/*` på samme origin | `scripts/ai-lab-server.js` + `scripts/arctic/*` | Node-målinger fra lokal maskin, en fast lokal tjeneste-allowlist og den konfigurerte loopback-Ollama-instansen |
| Produksjonskode | `/api/arctic?resource=bootstrap|overview|services|sessions|commands` | `api/arctic.js` + `api/_lib/arctic-*` | Ingen privat nettverkstrafikk eller kommandoeksekvering; stabile, typede utilgjengelig-svar |
| Produksjons-Console + lokal AI Lab-bro | Fast `http://127.0.0.1:8081/__ai-lab/v1/*` etter eksplisitt HMAC-/superadmin-kontroll | Samme lokale `scripts/ai-lab-server.js`, normalt nådd via operatørens SSH-/VS Code-portforward | Bare eksisterende AI Lab/Gemma-operasjoner; ingen lokal Arctic-status, kommandoer, privat agent eller generell gateway |
| Fremtidig tilkoblet produksjon | Samme Console-kontrakt | Ny, separat outbound gateway kreves | Ikke implementert eller konfigurert |

Console viser Arctic bare til en operatør som klienten har lest som `active` og `superadmin`. Dette er kun forsvar i dybden. Den autoritative kontrollen skjer på serveren:

1. Console sender den eksisterende control-plane JWT-en som `Authorization: Bearer …`.
2. Serveren validerer JWT-en mot control-plane `/auth/v1/user` med den offentlige anon-nøkkelen.
3. Serveren leser operatørraden med samme JWT og krever både `status='active'` og `role='superadmin'`.
4. Kontrollen gjentas for hvert Arctic-kall, AI Lab-config-proben (`GET /__ai-lab/v1/config`) og alle AI Lab-POST-er som lager snapshot eller utfører modellarbeid.

Arctic-autentisering trenger ingen `service_role`-nøkkel. AI Lab-config-kallet er fortsatt en loopback-only probe som ikke utfører modellarbeid eller returnerer hemmeligheter/den lokale handlingstokenen, men det krever nå likevel en gyldig superadmin-JWT før konfigurasjonen returneres.

Lokale POST-kall krever i tillegg korrekt `Host`, tillatt eksakt origin, den prosessgenererte CSRF-tokenen og `X-Arctic-Access-Token`. `Authorization` er reservert for Console-JWT-en. Nettleseren lagrer ikke den lokale tokenen i `localStorage` eller `sessionStorage`. Ved browser-bro får bare `ARCTIC_BRIDGE_ALLOWED_ORIGIN` CORS; før JWT sendes må serveren bevise kjennskap til den lokale tokenen med HMAC over origin + fersk browser-nonce. Den rå tokenen og JWT-en inngår ikke i identitetsproben. Console-responsen får `Permissions-Policy: loopback-network=(self)`, og fetch-kallene deklarerer `targetAddressSpace:'loopback'`, slik at støttede nettlesere kan vise sin eksplisitte tillatelsesdialog i stedet for å omgå den.

## Lokal status og tjeneste-allowlist

`scripts/arctic/status.js` leser reelle, avgrensede Node-målinger:

- systemoppetid;
- CPU-bruk fra to korte `os.cpus()`-målinger;
- minnebruk fra `os.totalmem()`/`os.freemem()`;
- diskbruk for repoets filsystem via `statfsSync()`.

CPU- og NVMe-temperatur er ikke implementert og returneres som `unavailable`. Backup returneres som `not_configured`. Manglende målinger eller tjenestekontakt vises som delvis/utilgjengelig, aldri som oppdiktet grønn status.

Tjenestelisten er servereid og fast: `arctic-local-api` og `gemma`. Klienten kan ikke sende inn tjenestenavn, containernavn, porter eller adresser. Gemma-proben går bare til den allerede validerte, bokstavelige loopback-adressen for Ollama og bruker `/api/tags`; responsen reduseres til status, responstid og en sanitert melding. Docker, systemd, SSH, private nettverksadresser, prosesslister og den eksisterende private/root-agenten blir verken lest, proxiet eller eksponert.

Oversikten oppdateres hvert 60. sekund mens fanen er synlig og stanser når dokumentet er skjult. Klienten klassifiserer data som ferske inntil 90 sekunder, utdaterte inntil 5 minutter og frakoblet etter det. Manuell oppdatering bruker samme API og samme autorisasjonskontroll.

Alle sikkerhetskritiske JSON-lesere håndhever grensen mens responsstrømmen leses, ikke bare etter at hele kroppen ligger i minnet. Control-plane auth-svar er begrenset til 64 KiB, Ollama sin `/api/tags`-respons til 256 KiB og Anthropic-responsen til 1 MiB. For stor deklarert `Content-Length` avvises tidlig der den finnes; ellers avbrytes/cancelleres strømmen når bytegrensen passeres. Den lokale Gemma-adapteren støtter i tillegg en egen, bounded SSE→NDJSON-strøm for AI Lab-samtale og analyse; Arctic-statusresponsene og læringsflyten er fortsatt vanlige ferdige JSON-responser.

## Kommandoer og audit

Arctic har ikke fri terminal. Parseren aksepterer bare et eksakt treff i det servereide registeret og avviser blant annet kontrolltegn, shelloperatorer, substitusjon, quoting, pipes og redirigering før oppslag. Ingen kode bruker shell for å utføre kommandoene. Gyldige lokale kommandoer har i tillegg en best-effort, prosesslokal grense på 30 kall per operatør per minutt; den er misbruksdemping, ikke en distribuert eller varig kvote.

| Kommando | Lokal status nå | Effekt |
|---|---|---|
| `health` | Tilgjengelig | Leser samme avgrensede oversikt |
| `services` | Tilgjengelig | Leser den faste tjeneste-allowlisten |
| `gemma status` | Tilgjengelig | Leser den sanitiserte Gemma-statusen |
| `sessions` | Tilgjengelig | Leser arbeidsøkt-kontrakten |
| `logs errors --last 24h` | Ikke konfigurert | Ingen filtrert loggkilde finnes |
| `backup status` | Ikke konfigurert | Ingen avgrenset Vibeverk-backupkilde finnes |
| `vibeverk test` | Ikke konfigurert | Krever egen godkjennings- og sandboxflyt |
| `deploy status` | Ikke konfigurert | Ingen avgrenset publiseringskilde finnes |

Alle produksjonskommandoer er utilgjengelige inntil gatewayen finnes. Et gyldig, registrert POST-kall gir et typet `gateway_not_configured`-resultat; et ukjent eller shell-lignende kall avvises.

Lokale kommandoforsøk skriver metadata-only NDJSON til `ARCTIC_RUNTIME_DIR`. Kommandooppføringen inneholder skjema-/request-ID, tidspunkt, operatør-ID, registrert action-ID, resultatkode, feilklasse og varighet. AI Lab-kjøringer bruker et eget metadata-skjema med operatør, action, provider-/modell-ID, lokal/ekstern behandling, valgte kilde-ID-er, resultat/feilklasse og varighet. `requested` logges før modellkallet; deretter logges `completed`, `cancelled` eller `failed`. Verken innholdshash, kommandofelt, kildeinnhold, instruksjon, prompt, modelloutput, kommentar, tokens eller secrets inngår i audit.

Audit er lokal fillagring, ikke «ingen lagring»: runtime-katalogen opprettes med modus `0700`, filene med `0600` og no-follow. Aktiv `audit.ndjson` roteres ved UTC-døgnskifte eller før den overskrider 1 MiB; samlet tak for aktive og roterte auditfiler er 10 MiB, og kjøringen feiler lukket når audit ikke kan skrives trygt. Filer med `mtime` eldre enn 30 dager slettes ved runtime-oppstart og før hver skriving. Døgnrotasjonen gjør at en aktiv lavvolumfil ikke kan beholde gamle poster ved å få ny `mtime` hver dag. Det er ingen separat bakgrunnsjobb mens prosessen står helt inaktiv. `.runtime/` er gitignorert. Operatør-ID er personopplysning om Vibeverks egen operatør; behandlingsgrunnlag, informasjon til operatører og om 30 dager er forholdsmessig er åpne organisatoriske/juridiske fakta, se `docs/compliance/data-map-vibeverk.md`.

## Providerkapabiliteter og arbeidsøkter

Bootstrap-kontrakten skiller mellom `capabilities` og faktisk tillatte `operations`:

- Gemma/Ollama behandles lokalt. Når den er konfigurert, er `chat`, `analyze-text`, `summarize`, `rewrite` og `learning-draft` implementert. Strømming gjelder bare de fire generelle AI Lab-operasjonene.
- Claude/Anthropic behandles eksternt. Adapteren regnes bare som konfigurert når både API-nøkkel og `AI_LAB_ANTHROPIC_PROCESSING_APPROVED=true` finnes. Da er de implementerte operasjonene `learning-draft` og `learning-review`; en nøkkel alene gir `external_processing_not_approved`.
- Codex har ingen runtimeadapter i denne vertikalen og står som `not_configured`/`gateway_required`.

Ingen provider annonserer fri filtilgang, kodeendringer eller verktøykjøring. Claude/Codex annonserer heller ikke generell chat eller streaming. UI-et styres av de servereide operasjonslistene og skal ikke vise en knapp som om en manglende adapter virker.

Arbeidsøkter returnerer foreløpig en tom `items`-liste. Claude- og Codex-adapterne beskrives eksplisitt som `not_configured`; start, fortsett/gjenoppta, streaming, repo-lesing/-skriving, diff, tester og godkjenninger er `false`. Det finnes derfor ingen skjult arbeidsøktmotor bak fanen.

## AI Lab-dataflyt og personvern

AI Lab ligger nå som en underfane i Arctic, men beholder sitt localhost-only API og sin strukturerte Læringsmodul-flyt:

1. Operatøren velger én til seks ID-er fra serverens fil-allowlist og skriver en instruksjon; ingen fri filsti sendes. Hver Anthropic-godkjent kilde har en eksplisitt SHA-256 i registeret. Hvis filbytene endres, blir kilden automatisk lokal-only inntil innholdet er klassifisert på nytt og den nye hashen bevisst godkjennes i kode.
2. Serveren åpner filene defensivt, bygger et tidsbegrenset snapshot i prosessminnet og hasher kildeidentitet og rå bytes. Snapshotet får en aktiv utløpstimer (standard 30 minutter, konfigurerbar 1 minutt–24 timer). Ved utløp nulles kildebufferne, byte-/tekstreferanser tømmes, instruksjonen blankes og snapshotet fjernes fra registeret. Samme opprydding skjer ved kapasitetsutkastelse.
3. Gemma-kjøring sender snapshotet bare til lokal Ollama. Før ekstern behandling søker serveren i instruksjon og valgte kildebytes etter en konservativ liste med kjente secret-formater (blant annet private nøkler og vanlige API-/access-tokenmønstre). `Gemma + review` skanner også det validerte Gemma-utkastet før Anthropic-kallet. Treff blokkerer hele kallet med en sanitert feil; innholdet redigeres ikke, fordi byteendring ville ugyldiggjøre snapshot-hash og linjereferanser.
4. Når kontrollene passerer, sender Haiku og `Gemma + review` eksplisitt valgte kildeutdrag og instruksjon til Anthropic; review sender også det validerte Gemma-utkastet. Dette krever tre separate porter: API-nøkkel, server-side `AI_LAB_ANTHROPIC_PROCESSING_APPROVED=true` og en ny bekreftelsesdialog i Console for hvert eksterne knappetrykk. Dialogen er en UI-port; den erstatter ikke serverflagget eller juridisk/organisatorisk godkjenning.
5. Serveren validerer skjema, kilde-ID-er og linjeintervaller før resultatet returneres. Console renderer modelltekst som tekst, ikke HTML.
6. Resultatet lever i nettleserminnet og eventuell manuell JSON-eksport. Det lagres ikke i Supabase og publiseres ikke til Læring, men metadata om kjøringen lagres lokalt i auditloggen som beskrevet over.

Operatøren må derfor behandle instruksjon og valgte filer som en aktiv delingsbeslutning ved ekstern kjøring. Secret-skanneren er en ekstra tripwire for kjente formater; et pass betyr **ikke** at innholdet er anonymt, fritt for personopplysninger eller ukonfidensielt. Personopplysninger, kundehemmeligheter, API-nøkler og andre secrets skal ikke legges i kilderegister eller fritekst. En eksport inneholder instruksjon, kommentar og modelloutput og må kontrolleres før deling. Leverandørvilkår, DPA, retensjon, region/dataoverføring og intern behandlingsgrunn må avklares før eksterne modeller brukes på materiale som ikke allerede er godkjent for slik behandling.

Minne- og leverandørretensjon må beskrives presist: aktiv utløpstimer og nulling reduserer hvor lenge serverens primære snapshotreferanse lever, men JavaScript kan ha midlertidige strengkopier i prompt, in-flight providerkall eller runtime/GC som ikke kan garanteres fysisk nullstilt. Nettleseren beholder instruksjon, token, resultater, vurdering og kommentar i sidens JS-minne frem til reload eller «Tøm arbeidsflaten». Tømmeknappen starter eksplisitt disponering av det aktive læringssnapshotet og en eventuell aktiv generell kontekst før tokenen nullstilles; en ressurs med pågående kall merkes utløpt og fjernes når kallet slipper den. Tømming kan fortsatt ikke slette en eksportert fil eller trekke tilbake data som allerede er sendt til en provider. Anthropic sin egen behandlings-/logg-/retensjonspraksis styres av faktisk konto og avtale og er **ikke verifisert i repoet**.

Det er ingen database for AI Lab-innhold. Generell samtale/analyse med lokal Gemma strømmer til UI-et og beholdes bare i nettleserminne; den strukturerte læringsflyten er fortsatt separat, og menneskelig faglig review er obligatorisk.

Ekstern Anthropic-bruk er en lanseringsport, ikke aktivert bare fordi koden finnes. Før `AI_LAB_ANTHROPIC_PROCESSING_APPROVED` settes til `true`, må konto/avtale og DPA, providerretensjon, underdatabehandlere/region og overføringsgrunnlag, konkrete tillatte datakategorier, intern behandlingsgrunn og informasjon til berørte være bekreftet av ansvarlig person. Kildehash, secret-tripwire, serverflagget og per-kall-dialogen er tekniske kontroller; ingen av dem beviser personvernrettslig etterlevelse.

## Miljøvariabler

De eksisterende `AI_LAB_*`-variablene er dokumentert i `scripts/ai-lab/README.md`. Arctic legger til:

| Variabel | Formål |
|---|---|
| `ARCTIC_CONTROL_URL` | Ren HTTPS-adresse til Supabase control plane. Standard peker på Vibeverks offentlige control-plane-opphav. |
| `ARCTIC_CONTROL_ANON_KEY` | Offentlig anon-nøkkel brukt sammen med brukerens JWT ved serververifisering. Standardverdien kan brukes; dette er ikke en `service_role`-hemmelighet. |
| `ARCTIC_BRIDGE_ALLOWED_ORIGIN` | Valgfri, eksakt HTTPS-origin som får bruke browser-broen, normalt `https://vibeverk.no`. Tom verdi deaktiverer broen. Ingen wildcard, sti eller port. |
| `ARCTIC_RUNTIME_DIR` | Lokal katalog for metadata-only audit. Relative stier løses fra reporoten og verdien må ligge under repoets `.runtime/`; standard er `.runtime/arctic`. |

`scripts/ai-lab.env.local` skal fortsatt ha modus `0600`, være gitignorert og aldri inneholde verdier som kopieres til logger, dokumentasjon eller testdata.

## Krav til en fremtidig outbound gateway

`api/arctic.js` er en bevisst lukket produksjonsseam, ikke en halvferdig proxy. En ny gateway må oppfylle minst følgende før noen `gateway_not_configured`-status kan endres:

- være en separat, smal serverkomponent som kun tar imot autentiserte, kortlivede maskin-til-maskin-kall fra produksjons-API-et; nettleseren skal aldri nå private mål direkte;
- ha et versjonert skjema og faste adaptere for hver metrikk, tjeneste og kommando; ingen URL, host, port, filsti, containernavn eller argv fra klienten;
- bruke en egen uprivilegert systembruker eller isolert container, read-only rotfilsystem, droppede Linux capabilities, ressursgrenser og et minimalt skrivbart runtimeområde;
- ikke ha `docker.sock`, SSH-nøkler, systemd/DBus-admin, Supabase `service_role`, hjemmekataloger, produksjonsrepo-skrivetilgang eller tokens til den eksisterende private/root-agenten;
- begrense nettverks-egress til eksplisitt nødvendige mål og aldri fungere som generell HTTP-, SSH- eller shell-proxy;
- kjøre forhåndsdefinerte programmer med eksakt argv og `shell:false` dersom en fremtidig adapter virkelig trenger en prosess; muterende drift, tester og deploy krever separat menneskelig godkjenning og avgrenset sandbox;
- filtrere og størrelsesbegrense alle svar, redigere secrets/persondata og føre metadata-only audit med rotasjon og overvåking.

Hvis hostmålinger krever mer enn det en uprivilegert prosess kan lese, skal det bygges en spesifikk read-only collector for akkurat målingen. Å gi gatewayen root eller proxy-tilgang til en eksisterende privilegert agent er ikke en akseptabel snarvei.

## Lokal verifisering

Testene bruker mockede provider-/auth-/gateway-svar og gjør ingen betalte modellkall eller produksjonsendringer:

```bash
npm run test:arctic
npm run test:ai-lab
node test.js
node test-workspace.js
node test-api.js
```

For browser-bro fra produksjons-Console: sett `AI_LAB_PORT=8081` og `ARCTIC_BRIDGE_ALLOWED_ORIGIN=https://vibeverk.no` lokalt, start `npm run ai-lab`, og forward bare `127.0.0.1:8081` til samme lokale port via SSH/VS Code. Åpne Arctic → AI Lab i produksjons-Console, godkjenn eventuell Chrome Local Network Access-dialog, lim inn lokal token og velg «Koble til lokal Arctic». Verifiser `HEI`, avbrytelse og frakobling. Ikke bruk offentlig reverse proxy, lyttende ekstern adresse eller ekte person-/kundedata.
