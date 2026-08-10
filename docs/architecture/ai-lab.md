# AI Lab — lokal arkitektur

AI Lab er en separat, lokal utviklings- og kvalitetssikringsflate i Vibeverk Console. Den lager forslag **til** Læringsmodulen, men er ikke runtime eller lagringslag for læringsinnhold. Læring fortsetter å lese eksisterende statiske Markdown-dokumenter uavhengig av AI Lab og AI-providerne. AI Lab har ingen egen database eller persistens; ordinær Console-oppstart krever fortsatt den eksisterende Supabase control-plane-sesjonen, en aktiv operatorrad og tenantlisting.

## Komponenter og dataflyt

1. `scripts/ai-lab-server.js` serverer repoets vanlige statiske Console fra `127.0.0.1` og et lokalt API under `/__ai-lab/v1/`.
2. Console sonderer config-endepunktet bare på lokal HTTP-origin. Først etter vellykket respons legges den separate AI Lab-fanen til.
3. Klienten sender scenario-ID, allowlistede kilde-ID-er og redigerbar instruksjon. Den sender aldri en vilkårlig filsti.
4. Serveren leser filene defensivt og lager et tidsbegrenset snapshot i minnet. Hashen dekker prompt-/skjemaversjon, scenario, instruksjon, filidentitet og rå filbytes.
5. Provideradapteren kaller lokal Ollama eller Anthropic. Haiku mottar valgte kilder og fri instruksjon; Gemma + review sender i tillegg det validerte Gemma-utkastet og bruker ett snapshot gjennom begge trinn.
6. Providerens JSON-/tool-schema bygges fra det samme snapshotet og begrenser `sourceId` til nøyaktig de valgte kilde-ID-ene. Servervalidatoren kontrollerer i tillegg at linjeintervallene finnes i filen.
7. Reviewet (`learning-review-v2`) gir egen verdict (`GODKJENT`, `MÅ RETTES`, `MANGLER KILDE`) med tilhørende funn per seksjon — modulbeskrivelse, forklaring, onboarding, `IKKE DOKUMENTERT` — og indeksert per quiz- og kontrollspørsmål, ikke bare én samlet vurdering. Servervalidatoren gjør det strukturelt umulig å returnere samlet `GODKJENT` med mindre alle delvurderinger er `GODKJENT`, og krever minst ett korrigerende eller kildemanglende funn på enhver delvurdering som ikke er `GODKJENT`.
6. Streng validering av output og kildereferanser skjer før resultatet returneres. Console setter AI-tekst med `textContent`, ikke som HTML.
7. Testerens valg og kommentar lever bare i nettleserminne og blir med i en eksplisitt JSON-eksport. Det finnes ingen serverlagring eller publiseringshandling.

## Providerlag

- Ollama-adapteren gjenbruker `scripts/local-ai-client.js`, krever bokstavelig loopback-adresse, håndhever maksimalt ett aktivt lokalt kall og sender utkastsskjemaet som OpenAI-kompatibelt `response_format` med temperatur 0 og `reasoning_effort=none`. Avkorting på grunn av fullt kontekstvindu returneres som en egen sanitert feil.
- Anthropic-adapteren følger eksisterende Vibeverk-mønster med tvunget tool-use for strukturert output. Modell og nøkkel kommer fra miljøet. Responskroppen har en fast bytegrense.
- Begge adapterne har timeout og returnerer sanitiserte feil uten rå providerrespons eller hemmeligheter.

## Sikkerhetsmodell

AI Lab er defense-in-depth-sperret: development-flagg, CI/Vercel-/miljøproxy-nekt, fast loopback-bind, Host-validering, same-origin POST, prosessunik CSRF-token, separat lokal Bearer-token, JSON-only og begrenset requeststørrelse. Bearer-tokenen returneres ikke av API-et eller lagres i nettleseren. Prosesser under samme OS-bruker er likevel en eksplisitt lokal tillitsgrense fordi de i noen miljøer kan lese prosessmiljøet. Den statiske serveren blokkerer blant annet `scripts/`, skjulte filer og Supabase-katalogene.

Kilderegisteret i `scripts/ai-lab/sources.js` er eneste sted som kan åpne nye filer for scenariet. En kilde merket for Anthropic kan forlate maskinen når testeren eksplisitt starter Haiku eller review. Hemmeligheter og personopplysninger skal aldri legges til som kilder eller fritekst. Kildeklassifisering må reviewes ved innholdsendringer og hver allowlist-utvidelse; leverandørvilkår/DPA, retensjon og dataoverføring er en prosessport som ikke kan verifiseres fra kodebasen.

AI Lab skal ikke deployeres til Vercel, GitHub Pages eller annen produksjonsruntime. Ollama skal ikke eksponeres mot internett.

## Outputkontrakter

Læringsutkastet har fast skjema for modulbeskrivelse, forklaring, onboarding, quiz, kontrollspørsmål, læringsnivå og `IKKE DOKUMENTERT`. Hvert faktabærende felt krever kilde-ID og gyldig linjeintervall.

Reviewet har en samlet beslutning (`GODKJENT`, `MÅ RETTES` eller `MANGLER KILDE`) pluss egne delvurderinger med samme statusliste for hver seksjon og hvert enkelt quiz-/kontrollspørsmål (schemaVersion `learning-review-v2`). Samlet `GODKJENT` er strukturelt umulig med mindre alle delvurderinger er `GODKJENT`. Ikke-godkjente delvurderinger må ha konkrete funn. Strukturvalidering reduserer feilflater, men erstatter ikke menneskelig faglig kontroll.
