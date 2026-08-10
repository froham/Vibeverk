# Kundeanalyse

Kundeanalyse er et internt arbeidsverktøy i Vibeverk Console for avgrenset analyse av offentlig tilgjengelige nettsteder til mulige kunder. Det ligger ikke i kundens Workspace, gjør ingen automatisk utsending og produserer bare internt materiale som må gjennom menneskelig kontroll.

Status per 2026-08-10: kode og migrasjon er implementert lokalt i v0.126.0, men migrasjonen er ikke kjørt og funksjonen er ikke deployet. Denne teksten beskriver kodekontrakten; live status må bekreftes separat etter en godkjent stagingutrulling.

## Dataflyt og tilgang

```text
aktiv Console-operatør
        │ control-plane JWT
        ▼
/api/customer-analysis (Vercel Node.js)
        ├── kontroll av auth.users + operators.status = active
        ├── service-role-skriving + hendelseslogg i vibeverk-control
        ├── sikker, DNS-pinnet innhenting av offentlig nettsted
        └── valgfritt, strukturert Anthropic-kall på korte tekstutdrag
```

Data lagres bare i `vibeverk-control` gjennom tabellene med prefiks `customer_analysis_`. Nettleseren har RLS-beskyttet lesetilgang som aktiv operatør, men ingen direkte INSERT/UPDATE/DELETE-grants. API-et verifiserer først operatørens eksisterende control-plane-token og bruker deretter service role til mutasjoner. Kunder sine separate data-plane-prosjekter berøres ikke.

Migrasjonen er [20260810190000_add_customer_analysis.sql](../../supabase-control/supabase/migrations/20260810190000_add_customer_analysis.sql). Den oppretter analyser, kjøringer/leaser, sideobservasjoner, funn, tjenestekoblinger, møtegrunnlag og append-only hendelseslogg. `claim_customer_analysis_run()` bruker en transaksjonslås for å håndheve maksimalt tre samtidige kjøringer globalt og én per måldomene. Leasen utløper etter fire minutter, slik at en avbrutt kjøring kan prøves på nytt.

## Sikker nettverksinnhenting

Innhentingen bruker ikke vanlig `fetch()` mot operatørstyrte URL-er. `customer-analysis-secure-fetch.js`:

- tillater bare HTTP/HTTPS på port 80/443 og avviser legitimasjon i URL;
- avviser IP-litteraler, interne vertsnavn og private, link-local, loopback, dokumentasjons-, multicast- og reserverte IPv4/IPv6-områder;
- resolver alle adressene for vertsnavnet og stopper dersom ett svar er blokkert;
- velger én validert adresse og tvinger Node-socketen til akkurat denne via en egen `lookup`-funksjon;
- kontrollerer `socket.remoteAddress` mot den validerte adressen;
- behandler omdirigeringer manuelt, tillater bare samme domene eller `www`-varianten, blokkerer nedgradering fra HTTPS til HTTP og gjentar full DNS-validering/pinning for hvert hopp;
- bruker identifiserbar User-Agent, korte tidsgrenser, maksimum fem redirects og én MiB responsgrense;
- ber om ukomprimert innhold og avviser uventet komprimering, slik at den lagrede bytegrensen ikke kan omgås ved dekomprimering.

`robots.txt` hentes før startsiden. En eksplisitt `Disallow` blir respektert per sti. Dersom hele nettstedet er blokkert, stoppes kjøringen før en side hentes. HTTP 404/410 betyr at filen ikke er publisert; 401/403 behandles som full blokkering; andre lesefeil stopper konservativt. Ingen innlogging, skjemainnsending, CAPTCHA-omgåelse, portskanning eller nedlasting av vilkårlige filer utføres.

## Analyse og lagring

Startsiden og inntil fire prioriterte, interne sider analyseres. URL-er med innloggings-, administrasjons-, slettings-, checkout-, API-, eksport- eller nedlastingsstier velges ikke. Spørringsstrenger fjernes fra crawl-kandidater.

Deterministiske kontroller dekker blant annet HTTPS, HTTP-status, redirects, responstid som enkeltmåling, responsstørrelse, viewport, favicon, title, metabeskrivelse, canonical, H1/overskriftshierarki, Open Graph, JSON-LD, alt-attributter, skjemalabels, tilgjengelige navn, lenketekst, personvern-/kontaktlenker, eksterne analyseskript, `robots.txt` og standardplasseringen til `sitemap.xml`.

Automatiske kontroller er uttrykkelig ikke en full WCAG-, SEO-, personvern-, juridisk eller ytelsesvurdering. Hele HTML-sider lagres ikke. Per side lagres tekniske tellere, URL, status, korte feiltekster og maksimalt 1800 tegn renset tekstutdrag.

## AI-grense

Når `ANTHROPIC_API_KEY` er konfigurert, kan én strukturert vurdering supplere de tekniske funnene. Prompten mottar maksimalt fem korte tekstutdrag, automatiske funn og den redigerbare tjenestekatalogen. Et separat, strukturert AI-kall kan formulere møtegrunnlaget etter at operatøren har godkjent funn; dette kallet mottar bare de uttrykkelig godkjente funnene og aldri interne notater. Modellen må bruke tvunget tool-output. Serveren forkaster:

- funn med en URL som ikke finnes i gjeldende kildesnapshot;
- funn uten et ordrett kildeutdrag i samme side;
- ukjente tjenestekoder;
- ugyldige kategorier, prioriteringer eller sikkerhetsnivåer.

AI-feil endrer ikke de tekniske resultatene. `ai_status` viser `not_configured` eller `failed`, og Console forklarer dette. AI-funn starter alltid som `unreviewed`.

## Menneskelig review og møtegrunnlag

Operatøren kan godkjenne, redigere, fjerne eller legge til funn. En redigering setter status til `edited`; funnet må deretter godkjennes eksplisitt. Møtegrunnlaget bruker bare funn med status `approved`, med maksimum sju forbedringsmuligheter. Interne notater er et eget felt, og ingen e-post eller kundevendt publisering finnes.

## Miljøvariabler

Sett verdiene i Vercel-miljøet eller en lokal, gitignorert `.env.local`. Ikke commit reelle nøkler.

```dotenv
VIBEVERK_CONTROL_URL=https://<control-project-ref>.supabase.co
VIBEVERK_CONTROL_ANON_KEY=<control-plane-anon-key>
VIBEVERK_CONTROL_SERVICE_ROLE_KEY=<control-plane-service-role-key>
ANTHROPIC_API_KEY=<valgfri; utelat for tekniske kontroller uten AI>
CUSTOMER_ANALYSIS_ANTHROPIC_MODEL=<valgfri modelloverstyring>
CUSTOMER_ANALYSIS_USER_AGENT=VibeverkKundeanalyse/1.0 (+https://vibeverk.no/kontakt)
```

Service-role-nøkkelen er en ny, sensitiv serverhemmelighet. Den skal aldri eksponeres i Console, nettleserkode eller logger. `CUSTOMER_ANALYSIS_USER_AGENT` må fortsatt identifisere Vibeverk og ha reell kontaktinformasjon dersom standarden over endres.

## Lokal kjøring og test

En lokal ende-til-ende-kjøring krever et kontrollert control-plane-testprosjekt der migrasjonen er anvendt, samt miljøvariablene over. Start Vercel sin lokale utviklingsserver fra repo-roten og åpne `/console/`:

```bash
vercel dev
```

Automatiske tester bruker mocks og gjør ingen ekte nettsted- eller Anthropic-kall:

```bash
npm run test:customer-analysis
node test.js
node test-workspace.js
node test-api.js
```

## Kjente MVP-begrensninger

- Kjøringen skjer innenfor ett avgrenset Vercel-kall, ikke i en varig jobbkø. Lukkes klienten eller avbrytes plattformen, kan status være `analyzing` til fireminuttersleasen utløper.
- HTML analyseres som servermottatt markup; JavaScript-renderte elementer kjøres ikke.
- Kontrast og dynamisk tastaturnavigasjon testes ikke automatisk. Disse krever et egnet nettleserverktøy og manuell kontroll.
- Sitemap kontrolleres bare på `/sitemap.xml`; alternative plasseringer må undersøkes manuelt.
- Det finnes ingen automatisk retensjon eller sletting ennå. Retensjonsregel og personvern-/compliance-godkjenning er lanseringsporter.
- Ingen offentlig gratisanalyse, masseanalyse, kontaktpersoninnhenting, prisforslag, sikkerhetsskanning eller automatisk utsending er implementert.

## Før staging og produksjon

1. Kjør migrasjonen først i et godkjent control-plane-stagingmiljø og verifiser tabeller, RLS, grants, funksjon og seed-katalog eksplisitt.
2. Sett serverhemmeligheter i staging og bekreft at service-role aldri leveres til nettleseren.
3. Kjør en kontrollert analyse mot et nettsted Vibeverk har rett til å teste, og kontroller User-Agent/robots/resultater.
4. Gjennomfør uavhengig sikkerhetsrevisjon, privacy/compliance-vurdering og UX/mobil-review. Ingen AI-review alene er sikkerhets- eller juridisk godkjenning.
5. Produksjonsmigrasjon og deploy krever en ny, eksplisitt godkjenning.
