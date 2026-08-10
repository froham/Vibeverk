# AI Lab — lokal utvikling og kvalitetssikring

AI Lab er et internt testverktøy i Vibeverk Console. Det sammenligner AI-utkast på identisk kildemateriale og kan la Haiku reviewe et Gemma-utkast. Første scenario er forslag til **Læringsmodulen**.

AI Lab og Læringsmodulen er separate konsepter. Eksisterende eller menneskelig godkjent læringsinnhold er statiske dokumenter og vises uten AI Lab, Ollama eller Anthropic. AI Lab skriver aldri til disse dokumentene, Supabase, `App.store`, `localStorage` eller en database.

## Sikkerhetsgrenser

- Serveren nekter å starte uten `NODE_ENV=development` og `AI_LAB_ENABLED=true`, og nekter CI/Vercel.
- Server og Ollama bruker bokstavelig `127.0.0.1`; de skal ikke eksponeres via port forwarding, reverse proxy eller offentlig DNS.
- Nettleser-UI-et vises bare på `http://127.0.0.1` eller `http://localhost`, og først etter en vellykket lokal API-probe.
- API-et krever korrekt `Host`, samme `Origin` og en prosessunik CSRF-token på alle POST-kall.
- Alle handlinger krever i tillegg en separat lokal Bearer-token (`AI_LAB_ACCESS_TOKEN`, minst 32 tegn). Den returneres ikke av config-endepunktet, lagres ikke i nettleseren og må limes inn i AI Lab etter hver sideinnlasting.
- Bare eksplisitt allowlistede prosjektfiler kan velges. Filene leses uten symlinker og med størrelses-/linjegrenser.
- Valgte kilder og den frie instruksjonen sendes til Anthropic når du trykker **Kjør Haiku** eller **Gemma + review**. Review-flyten sender i tillegg det validerte Gemma-utkastet. Ikke legg hemmeligheter eller personopplysninger i allowlisten eller instruksjonen.
- Modelltekst behandles som utrygg tekst i UI-et. Struktur, felt, kilde-ID-er og linjeintervaller valideres før visning.
- Resultater har alltid status `UTKAST` og publiseres aldri automatisk.

## Konfigurasjon

Kopier eksempelet og fyll inn lokale verdier:

```bash
cp scripts/ai-lab.env.example scripts/ai-lab.env.local
chmod 600 scripts/ai-lab.env.local
openssl rand -hex 32
```

Lim den tilfeldige verdien fra siste kommando inn som `AI_LAB_ACCESS_TOKEN`. Eksempelfilen lar både denne tokenen og Anthropic-nøkkelen stå tomme med vilje, slik at en ukonfigurert eller offentlig kjent placeholder aldri blir godtatt.

Filen `scripts/ai-lab.env.local` er ignorert av Git. Ikke skriv API-nøkler i README, kode, testdata eller logger.

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
| `AI_LAB_TIMEOUT_MS` | Timeout per providerkall, 1–300 sekunder |
| `AI_LAB_ANTHROPIC_CALLS_PER_HOUR` | Enkel prosesslokal kostnadsgrense, standard 10 kall/time |
| `AI_LAB_MAX_PROMPT_CHARS` | Øvre promptgrense for lokal modell; standard 200 000 tegn |
| `AI_LAB_SNAPSHOT_TTL_MS` | Levetid for kildesnapshot i minnet, standard 30 minutter |

Modellnavn, base-URL-er og hemmeligheter leses fra miljøet og er ikke hardkodet i runtime-koden. Av sikkerhetshensyn godtar valideringen likevel bare Anthropic sitt offisielle API-opphav.

## Starte lokalt

Ollama må allerede kjøre på loopback og den valgte modellen må være installert. Last så miljøfilen i det aktuelle skallet og start utviklingsserveren:

```bash
set -a
source scripts/ai-lab.env.local
set +a
npm run ai-lab
```

Åpne deretter:

```text
http://127.0.0.1:8080/console/
```

Logg inn i Console som vanlig. Console bruker fortsatt sin eksisterende Supabase control-plane-sesjon, aktive operatorrad og tenantlisting; «uten database» betyr at AI Lab-data ikke lagres i en database. Fanen **AI Lab** vises bare når den lokale serveren svarer. En manglende `ANTHROPIC_API_KEY` deaktiverer Haiku-knappene, men Gemma kan fortsatt brukes.

Lim verdien fra `AI_LAB_ACCESS_TOKEN` inn i tokenfeltet før første kjøring. Tokenen beholdes bare i sidens minne. Den beskytter mot andre lokale OS-brukere/prosesser som ikke kjenner tokenen; prosesser under samme OS-bruker er fortsatt innenfor den lokale tillitsgrensen og kan i noen miljøer lese prosessmiljøet.

Ollama-adapteren håndhever utkastsskjemaet med strukturert output (`response_format`), temperatur 0 og `reasoning_effort=none`. Intern tenking er slått av fordi denne arbeidsflyten trenger det validerte sluttobjektet og ellers kan bruke opp hele kontekstvinduet før JSON-svaret er ferdig. Start likevel med én liten kilde. Den installerte modellens kontekstvindu kan være mindre enn AI Labs tekniske tegngrense.

## Arbeidsflyt

1. Velg scenarioet Læringsmodulen, én til seks godkjente kilder og en instruksjon.
2. Kjør Gemma og Haiku separat for sammenligning mot samme snapshot.
3. Bruk **Gemma + review** for en atomisk totrinnsflyt: Gemma-utkast, deretter Haiku-review mot nøyaktig samme kilder.
4. Review (`learning-review-v2`) returnerer eit eige verdict (`GODKJENT`, `MÅ RETTES` eller `MANGLER KILDE`) for kvar av `moduleDescription`, `howItWorks`, `onboardingText` og `notDocumented`, pluss éin indeksert verdict per quiz- og kontrollspørsmål i det faktiske utkastet -- ikkje berre éin samla beslutning. Kvart verdict har eiga grunngjeving og konkrete funn der det trengst.
   Servervalidatoren gjer det strukturelt umogleg å returnere ei samla `GODKJENT`-beslutning med mindre ALLE delvurderingane over sjølv er `GODKJENT`; motsett krev ei ikkje-godkjend samla beslutning minst éi delvurdering som ikkje er `GODKJENT`.
5. Velg foretrukket svar, skriv kommentar og eksporter JSON. Eksporten inneholder kildereferanser og snapshot-hash, men ikke kildefilenes innhold eller API-nøkler automatisk. Den inneholder likevel instruksjon, kommentar og modelloutput og må kontrolleres før deling.
6. Flytt eventuelt godkjent innhold manuelt til Læringsmodulen etter menneskelig kontroll. Det finnes ingen automatisk publiseringsvei.

Hvis en påstand ikke støttes av de valgte kildene, skal utkastet bruke `IKKE DOKUMENTERT`. Alle dokumenterte avsnitt og svar må ha validerte referanser på formen `kilde-ID Lstart–slutt`.
Provider-skjemaet begrenser `sourceId` dynamisk til kilde-ID-ene i det aktuelle snapshotet. Modellen kan derfor ikke velge en filsti, et visningsnavn eller en kilde fra en tidligere kjøring som referanse.

## Tester

Testene bruker mockede providere og gjør ingen ekte Ollama- eller betalte Anthropic-kall:

```bash
npm run test:ai-lab
```

De dekker blant annet miljøsperrer, kilde-allowlist, symlink-/størrelsesgrenser, struktur- og kildevalidering, identisk snapshot, én lokal jobb om gangen, timeout, tomt/ufullstendig/ugyldig/for stort svar, providerfeil, Host/Origin/CSRF og at fanen ikke finnes på produksjonsorigin.

## Kjente begrensninger

- Ingen database eller historikk mellom serverstarter; snapshot og resultater lever bare i prosess/minne og i eventuell manuell JSON-eksport.
- Bare Læringsmodulen er implementert som scenario.
- Kun én Ollama-jobb kan kjøre om gangen. En samtidig forespørsel får `429`.
- Store eller mange kilder kan overskride Ollama-modellens kontekstvindu. Første kildevalg er derfor én liten fil; større kontekst krever en separat modellkonfigurasjon og er ikke satt opp av AI Lab.
- AI Lab gjør strukturell og referansemessig validering, men kan ikke bevise at modellens tolkning av en referert linje er faglig riktig. Menneskelig review er obligatorisk.
- Ingen automatisk publisering, godkjenningsdatabase eller integrasjon tilbake til de statiske læringsdokumentene.
- Allowlistede Anthropic-kilder må klassifiseres og reviewes på nytt når innholdet eller kilderegisteret endres. Leverandørvilkår, DPA, retensjon, region/overføring og intern godkjenning må avklares før reell intern bruk med materiale som kan inneholde personopplysninger eller konfidensiell informasjon.
