# AI Lab — lokal utvikling og kvalitetssikring

AI Lab er det lokale modellverkstedet under den interne **Arctic**-seksjonen i Vibeverk Console. Assistenten i Samtale og Analyse heter **Viba** og drives av den lokale **Gemma**-modellen. Modellkort, teknisk status og den eksisterende sammenligningen/reviewen av strukturerte forslag til **Læringsmodulen** bruker fortsatt modellnavnet Gemma. Navnet gir ingen voice-, mikrofon- eller wake-word-funksjon.

AI Lab og Læringsmodulen er separate konsepter. Eksisterende eller menneskelig godkjent læringsinnhold er statiske dokumenter og vises uten AI Lab, Ollama eller Anthropic. AI Lab skriver aldri til disse dokumentene, Supabase, `App.store`, `localStorage` eller en database.

## Sikkerhetsgrenser

- Serveren nekter å starte uten `NODE_ENV=development` og `AI_LAB_ENABLED=true`, og nekter CI/Vercel.
- Server og Ollama bruker bokstavelig `127.0.0.1`; de skal ikke eksponeres via port forwarding, reverse proxy eller offentlig DNS.
- Nettleser-UI-et vises bare på `http://127.0.0.1` eller `http://localhost`, og først etter en vellykket lokal API-probe.
- API-et krever korrekt `Host`, samme `Origin` og en prosessunik CSRF-token på alle POST-kall.
- Alle POST-handlinger krever en gyldig Console control-plane JWT som serveren verifiserer mot en aktiv `superadmin`, i tillegg til en separat lokal handlingstoken (`AI_LAB_ACCESS_TOKEN`, minst 32 tegn). JWT-en sendes som `Authorization: Bearer …`; den lokale tokenen sendes som `X-Arctic-Access-Token`.
- Den lokale handlingstokenen returneres ikke av config-endepunktet, lagres ikke i nettleseren og må limes inn etter hver sideinnlasting.
- Bare eksplisitt allowlistede prosjektfiler kan velges. Filene leses uten symlinker og med størrelses-/linjegrenser.
- Valgte kilder og den frie instruksjonen sendes til Anthropic når du trykker **Kjør Haiku** eller **Gemma + review**. Review-flyten sender i tillegg det validerte Gemma-utkastet. Ikke legg hemmeligheter eller personopplysninger i allowlisten eller instruksjonen.
- Før Anthropic-kallet blokkerer serveren kjente private-key/API-key/token-formater i instruksjon og kildeinnhold; review skanner også Gemma-utkastet. Dette er en best-effort tripwire, ikke anonymisering: et pass betyr ikke at materialet er fritt for personopplysninger, hemmeligheter eller konfidensielt innhold.
- Modelltekst behandles som utrygg tekst i UI-et. Struktur, felt, kilde-ID-er og linjeintervaller valideres før visning.
- Strukturerte læringsresultater har alltid status `UTKAST` og publiseres aldri automatisk. Generelle samtale-/analysesvar er fritekst, ikke godkjent læringsinnhold.

## Konfigurasjon

Kopier eksempelet og fyll inn lokale verdier:

```bash
cp scripts/ai-lab.env.example scripts/ai-lab.env.local
chmod 600 scripts/ai-lab.env.local
openssl rand -hex 32
```

Lim den tilfeldige verdien fra siste kommando inn som `AI_LAB_ACCESS_TOKEN`. Eksempelfilen lar både denne tokenen og Anthropic-nøkkelen stå tomme med vilje, slik at en ukonfigurert eller offentlig kjent placeholder aldri blir godtatt.

Filen `scripts/ai-lab.env.local` er ignorert av både Git og den sporede `.vercelignore`. Begge grensene er nødvendige: Vercel CLI pakker arbeidskopien og Git-ignore alene er ikke en deploysperre. Ikke skriv API-nøkler i README, kode, testdata eller logger.

| Variabel | Formål |
|---|---|
| `NODE_ENV` | Må være `development` |
| `AI_LAB_ENABLED` | Må være `true` |
| `AI_LAB_PORT` | Lokal Console/server-port, standard `8080` |
| `AI_LAB_ACCESS_TOKEN` | Tilfeldig lokal handlingstoken på minst 32 tegn; aldri commit eller logg den |
| `AI_LAB_OLLAMA_BASE_URL` | Lokal Ollama-adresse; må være bokstavelig loopback |
| `AI_LAB_OLLAMA_MODEL` | Lokal modell, eksempelverdien er `gemma4:26b` |
| `AI_LAB_ANTHROPIC_BASE_URL` | Anthropic API-base; valideres til ren `https://api.anthropic.com` |
| `AI_LAB_ANTHROPIC_MODEL` | Anthropic-modell som eksisterende konto har tilgang til |
| `ANTHROPIC_API_KEY` | Lokal hemmelighet; utelat for Gemma-only |
| `AI_LAB_ANTHROPIC_PROCESSING_APPROVED` | Må være eksplisitt `true` i tillegg til API-nøkkel før ekstern Anthropic-behandling aktiveres; standard/eksempelfil er `false` |
| `AI_LAB_TIMEOUT_MS` | Timeout per providerkall, 1–300 sekunder |
| `AI_LAB_ANTHROPIC_CALLS_PER_HOUR` | Enkel prosesslokal kostnadsgrense, standard 10 kall/time |
| `AI_LAB_MAX_PROMPT_CHARS` | Øvre promptgrense for lokal modell; standard 200 000 tegn |
| `AI_LAB_SNAPSHOT_TTL_MS` | Levetid for kildesnapshot i minnet, standard 30 minutter |
| `ARCTIC_CONTROL_URL` | Supabase control-plane-opphav brukt til serververifisering; standard peker på Vibeverks offentlige control plane |
| `ARCTIC_CONTROL_ANON_KEY` | Offentlig anon-nøkkel brukt sammen med operatørens JWT; standardverdien kan normalt brukes og er ikke en `service_role`-nøkkel |
| `ARCTIC_RUNTIME_DIR` | Gitignorert katalog for metadata-only Arctic-audit; må ligge under repoets `.runtime/`, standard `.runtime/arctic` |

Modellnavn, base-URL-er og hemmeligheter leses fra miljøet og er ikke hardkodet i runtime-koden. Av sikkerhetshensyn godtar valideringen likevel bare Anthropic sitt offisielle API-opphav.

## Starte lokalt

Ollama må allerede kjøre på loopback og den valgte modellen må være installert. Last så miljøfilen i det aktuelle skallet og start utviklingsserveren:

```bash
set -a
source scripts/ai-lab.env.local
set +a
npm run ai-lab
```

Åpne deretter porten som står i `AI_LAB_PORT` (eksempelfilen bruker `8080`):

```text
http://127.0.0.1:<AI_LAB_PORT>/console/
```

Logg inn i Console som en aktiv `superadmin`. Console bruker fortsatt sin eksisterende Supabase control-plane-sesjon, aktive operatorrad og tenantlisting; «uten database» betyr at AI Lab-data ikke lagres i en database. **Arctic** vises bare til superadmin, og underfanen **AI Lab** får arbeidsflaten når den lokale serveren svarer. En manglende `ANTHROPIC_API_KEY`, eller at `AI_LAB_ANTHROPIC_PROCESSING_APPROVED` ikke er satt til `true`, deaktiverer Haiku-knappene; Gemma kan fortsatt brukes.

Lim verdien fra `AI_LAB_ACCESS_TOKEN` inn i tokenfeltet før første kjøring. Tokenen beholdes bare i sidens minne og sendes i `X-Arctic-Access-Token`, mens Console-JWT-en ligger i den ordinære `Authorization`-headeren. Tokenen beskytter mot andre lokale OS-brukere/prosesser som ikke kjenner den; prosesser under samme OS-bruker er fortsatt innenfor den lokale tillitsgrensen og kan i noen miljøer lese prosessmiljøet.

Ollama-adapteren håndhever utkastsskjemaet med strukturert output (`response_format`), temperatur 0 og `reasoning_effort=none`. Intern tenking er slått av fordi denne arbeidsflyten trenger det validerte sluttobjektet og ellers kan bruke opp hele kontekstvinduet før JSON-svaret er ferdig. Start likevel med én liten kilde. Den installerte modellens kontekstvindu kan være mindre enn AI Labs tekniske tegngrense.

## Samtale og analyse

1. Velg **Samtale** for en naturlig, lokal flertrinnssamtale uten dokumentkontekst. En melding som «HEI» skal derfor behandles som vanlig samtale, ikke som bestilling på et læringsutkast.
2. Velg **Analyse**, og velg enten innlimt tekst (maks 20 000 tegn) eller én til seks filer fra den faste kildelisten. Ingen vilkårlig filsti eller mappe kan sendes.
3. Gemma-svaret strømmes til Console og kan avbrytes. Serveren proxyer aldri rå Ollama-rammer, og en avbrutt nettleserrequest avbryter oppstrømslesingen. Etter «Stopp» holdes kjøreknappen låst til providerjobben faktisk er frigitt.
4. Samtaleøkter, meldinger og innlimt tekst lever bare i nettleserminnet (maks ti økter). Økter slettes eksplisitt; en ellevte økt blokkeres og evikterer aldri en eldre økt. Eksport er eksplisitt og kan inneholde samtale-/kontekstinnhold; kontroller filen før deling.
5. Samtale/Analyse kan legge ved eller lime inn med Ctrl/⌘+V ett PNG-, JPEG- eller WebP-bilde på opptil 12 MB i neste melding. Bilder over 2 MB komprimeres lokalt til JPEG på maks 2 MB før sending; både klient og server avviser over 40 megapiksler. Originalen sendes ikke når komprimering skjer. Bildet går bare til lokal Gemma; rå bildebytes lagres ikke i økteksport eller audit. Vanlig tekstinnliming påvirkes ikke.
6. Velg **Rask** (`reasoning_effort=none`) for korte oppgaver og **Grundig** (`low`) når modellen bør bruke mer intern bearbeiding. Samtale starter i Rask; Analyse starter i Grundig.
7. Ferdige svar kan kopieres eller lastes ned som tekst. Kodegjerder får egne kopierings- og nedlastingsknapper; HTML lastes ned som `.html`, men kjøres eller forhåndsvises aldri i Console. Kontroller alltid modellgenerert kode før du åpner eller kjører filen.
8. Modellkonteksten viser løpende bruk mot grensen på 20 meldinger. Skriv `/compact` for å la lokal Gemma oppsummere eldre kontekst uten å fjerne den synlige/eksporterte historikken, `/clear` for å tømme aktiv økt, `/new` for ny økt eller `/help` for kommandooversikten. Komprimer før telleren er full; over 20 000 tegn kan ikke kompakteres uten mulig informasjonstap og avvises derfor.

## Læringsarbeidsflyt

1. Velg **Læringsutkast**, skriv instruksjonen i den store promptflaten og legg ved én til seks kilder. Kilder kan være godkjente prosjektfiler eller én innlimt/opplastet tekst på maks 20 000 tegn.
2. Innlimt/opplastet tekst blir en flyktig, linjenummerert kilde for lokal Gemma. Den kan ikke sendes til Haiku. Bilder er ikke tillatt som læringskilde fordi dagens validering krever tekstlinjer for alle faktapåstander.
3. Kjør Gemma og Haiku separat for sammenligning mot samme snapshot.
4. Bruk **Gemma + review** for en atomisk totrinnsflyt: Gemma-utkast, deretter Haiku-review mot nøyaktig samme kilder.
5. Review (`learning-review-v2`) returnerer eit eige verdict (`GODKJENT`, `MÅ RETTES` eller `MANGLER KILDE`) for kvar av `moduleDescription`, `howItWorks`, `onboardingText` og `notDocumented`, pluss éin indeksert verdict per quiz- og kontrollspørsmål i det faktiske utkastet -- ikkje berre éin samla beslutning. Kvart verdict har eiga grunngjeving og konkrete funn der det trengst.
   Servervalidatoren gjer det strukturelt umogleg å returnere ei samla `GODKJENT`-beslutning med mindre ALLE delvurderingane over sjølv er `GODKJENT`; motsett krev ei ikkje-godkjend samla beslutning minst éi delvurdering som ikkje er `GODKJENT`.
6. Velg foretrukket svar, skriv kommentar og eksporter JSON. Eksporten inneholder kildereferanser og snapshot-hash, men ikke kildefilenes innhold eller API-nøkler automatisk. Den inneholder likevel instruksjon, kommentar og modelloutput og må kontrolleres før deling.
7. Flytt eventuelt godkjent innhold manuelt til Læringsmodulen etter menneskelig kontroll. Det finnes ingen automatisk publiseringsvei.

Hvis en påstand ikke støttes av de valgte kildene, skal utkastet bruke `IKKE DOKUMENTERT`. Alle dokumenterte avsnitt og svar må ha validerte referanser på formen `kilde-ID Lstart–slutt`.
Provider-skjemaet begrenser `sourceId` dynamisk til kilde-ID-ene i det aktuelle snapshotet. Modellen kan derfor ikke velge en filsti, et visningsnavn eller en kilde fra en tidligere kjøring som referanse.

## Tester

Testene bruker mockede providere og gjør ingen ekte Ollama- eller betalte Anthropic-kall:

```bash
npm run test:ai-lab
npm run test:arctic
```

De dekker blant annet miljøsperrer, kilde- og kommando-allowlister, kjente secret-formater før ekstern behandling, symlink-/størrelsesgrenser, typede og disponible kontekster, alternerende historikkgrenser, SSE/NDJSON-strømming, avbrudd, naturlig chat uten kontekst, struktur- og kildevalidering, identisk læringssnapshot, én lokal jobb om gangen, timeout, tomt/ufullstendig/ugyldig/for stort svar, providerfeil, Host/Origin/CSRF, superadmin-kontroll og at AI Lab ikke blir proba på produksjonsorigin.

### Ekte lokal Gemma-smoke

Den separate smoke-porten bruker den faktisk konfigurerte Ollama-modellen. Den kjører ingen Anthropic-kall, leser ingen prosjektfiler og bruker bare innebygd syntetisk tekst:

```bash
set -a
source scripts/ai-lab.env.local
set +a
npm run smoke:ai-lab
```

Kommandoen tester naturlig chat, analyse, oppsummering, omskriving og reell avbrytelse. Den krever konkrete fakta i svarene og avslutter med exit-kode `1` dersom ett krav feiler. Dette er en repeterbar integrasjons-/kvalitetssmoke, ikke bevis på at alle modellbesvarelser er faglig gode.

### Produksjons-Console med lokal Gemma

AI Lab-serveren og Ollama skal fortsatt bare lytte på loopback. For å bruke den deployede Console-flaten mot lokal Gemma:

1. Sett `AI_LAB_PORT=8081` og `ARCTIC_BRIDGE_ALLOWED_ORIGIN=https://vibeverk.no` i den gitignorerte `scripts/ai-lab.env.local`.
2. Start serveren som vanlig med miljøfilen lastet og `npm run ai-lab`.
3. Forward `127.0.0.1:8081` gjennom SSH eller VS Code til port 8081 på maskinen der nettleseren kjører. Ikke bruk offentlig port eller reverse proxy.
4. Åpne produksjons-Console → Arctic → AI Lab. Chrome 142+ kan be om tilgang til lokalt nettverk; godkjenn bare for Vibeverk-origin.
5. Lim inn `AI_LAB_ACCESS_TOKEN` og trykk **Koble til lokal Arctic**.

Identitetsproben sender verken Console-JWT eller rå lokal token. Serveren må først bevise kjennskap til tokenen med en nonce-bundet HMAC. Etterpå gjelder de vanlige superadmin-, CSRF-, token-, størrelses- og auditgrensene. Broen omfatter bare AI Lab; Arctic-kommandoer og privat drift forblir frakoblet i produksjon.

### Manuell nettlesersjekk

Etter grønn smoke bør følgende gås gjennom i Console før commit/PR:

1. Send `HEI` i **Samtale** uten kontekst og kontroller et kort, naturlig svar.
2. Lim inn samme syntetiske tekst som smoke-skriptet bruker, og kjør **Analyser**, **Oppsummer** og **Skriv om**.
3. Start et langt svar, trykk **Stopp**, og kontroller at delvis svar merkes som avbrutt, knappen viser opprydding, og at neste melding først kan sendes når Gemma er ledig.
4. Bytt mellom minst to økter, slett én eksplisitt og kontroller at låst kontekst og analysehandling følger riktig økt. Ved ti økter skal «Ny økt» blokkeres uten automatisk sletting.
5. Kontroller desktopbredden: bare valgt arbeidsmåte er synlig; Læringsutkast har oppsett til venstre og resultat til høyre uten duplisert skjema.
6. Eksporter én økt og kontroller at riktig melding/kontekst/operasjon finnes, men at lokal tilgangstoken og rå bytes fra valgte filer mangler.
7. Kjør Læringsutkast med Gemma og bekreft at den eksisterende strukturerte flyten fortsatt er separat fra samtale/analyse.

## Kjente begrensninger

- Ingen database eller innholdshistorikk mellom serverstarter; snapshot, kontekster og resultater lever bare i prosess-/nettleserminne og i eventuell manuell JSON-eksport. Metadata-only Arctic-audit er det avgrensede unntaket og ligger på lokal disk med rotasjon og 30-dagers filsletting.
- Bare Læringsmodulen er implementert som scenario.
- Kun én Ollama-jobb kan kjøre om gangen. En samtidig forespørsel får `429`.
- Store eller mange kilder kan overskride Ollama-modellens kontekstvindu. Første kildevalg er derfor én liten fil; større kontekst krever en separat modellkonfigurasjon og er ikke satt opp av AI Lab.
- AI Lab gjør strukturell og referansemessig validering, men kan ikke bevise at modellens tolkning av en referert linje er faglig riktig. Menneskelig review er obligatorisk.
- Ingen automatisk publisering, godkjenningsdatabase eller integrasjon tilbake til de statiske læringsdokumentene.
- Generell chat/analyse er bare implementert for lokal Gemma. Ingen fri filtilgang, kodeendringer, verktøykjøring eller Claude-/Codex-arbeidsøktadapter finnes. Disse kapabilitetene vises ærlig som utilgjengelige i Arctic.
- Allowlistede Anthropic-kilder må klassifiseres og reviewes på nytt når innholdet eller kilderegisteret endres. Leverandørvilkår, DPA, retensjon, region/overføring og intern godkjenning må avklares før reell intern bruk med materiale som kan inneholde personopplysninger eller konfidensiell informasjon.
