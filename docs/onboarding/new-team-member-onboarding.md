# Vibeverk forklart — for nye medarbeidarar (og for deg sjølv)

> Skrive på enkelt norsk, med vekt på å forklare KVA og KVIFOR, ikkje HAU (koden sjølv er fasiten på det). Alt som ikkje kan stadfestast direkte er merka **UVERIFISERT**. Dette dokumentet peikar vidare til dei tekniske dokumenta (`docs/architecture/`, `docs/security/`, `docs/decisions/`) i staden for å gjenta innhaldet deira — dei er framleis fasiten, dette er inngangsdøra.
>
> Fyller `docs/roadmap/ROADMAP.md` sitt "Next"-punkt 4 ("Læringsdokument til brukaren sjølv") — stadfesta av brukar 2026-07-16 at denne dokumentasjonsrunden oppfyller det punktet.

---

## Kva er Vibeverk?

Vibeverk hjelper små og mellomstore bedrifter (SMB) med å ta i bruk digitale verktøy og etter kvart KI — frå ei enkel nettside til eit fullt internt arbeidsverktøy, og heilt skreddarsydde løysingar for éin kunde. Sjå `docs/STRATEGY.md` for den fulle forretningsstrategien (dei tre "forretningsbeina") — dette dokumentet forklarer korleis TEKNIKKEN bak dette fungerer, ikkje sjølve forretningsideen.

**Éin kodebase, mange kundar.** Det finst ikkje éin kopi av koden per kunde. Alle kundar køyrer nøyaktig same programkode — det som skil éin kunde frå ein annan er KONFIGURASJON (fargar, tekst, kva funksjonar som er skrudd på) og KVAR dataen deira ligg lagra (kvar kunde har sin eigen, heilt separate database). Dette er eit medvite, ufråvikeleg prinsipp (`docs/STRATEGY.md` punkt 1) — det er difor éin rettinga i koden hjelper ALLE kundar samtidig, i staden for at kvar kunde må rettast opp separat.

## Dei fire flatene

Vibeverk består av fire ting som ser heilt forskjellige ut, men deler mesteparten av koden sin under panseret:

| Flate | Kven brukar ho | Kva ho er |
|---|---|---|
| **Offentleg nettside** (rot-adressa, t.d. `kunde.no`) | Besøkjande, potensielle kundar | Marknadsføringsside, kontaktskjema, booking, chat — det alle utanfor bedrifta ser |
| **Web-admin** (`/#admin`, trippelklikk i botnen av sida) | Kunden sin eigen tilsette | Redigere innhald på nettsida — tekst, bilete, opne/lukke henvendingar |
| **Workspace** (`/workspace/`) | Kunden sine tilsette, innlogga | Internt arbeidsverktøy — oppgåver, kunngjeringar, kunnskapsbase, CRM, brukaradministrasjon |
| **Console** (`/console/`) | KUN Vibeverk sjølv (superadmin) | Verktøyet Vibeverk brukar for å setje opp og administrere ALLE kundar |

Sjå `docs/architecture/system-overview.md` for den tekniske skildringa av alle fire.

### Teknisk oversikt (illustrasjon)

Forenkla — sjå `docs/architecture/system-overview.md` og ADR-0007/ADR-0008 for full detalj, inkludert unntak (t.d. at Console sjølv er tenant-uavhengig fram til ein kunde er vald i kundeveljaren).

<div class="cs-md-svg-wrap">
<svg viewBox="0 0 920 400" role="img" aria-labelledby="arch-illustration-title">
  <title id="arch-illustration-title">Vibeverk — dei fire flatene, ruting og kontrollplan/dataplan-oppdelinga</title>
  <defs>
    <marker id="arch-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--color-primary)"></path>
    </marker>
  </defs>
  <style>
    .arch-box { fill: var(--color-alt); stroke: var(--color-border); stroke-width: 1.5; rx: 8; }
    .arch-label { fill: var(--color-text); font-size: 16px; }
    .arch-label tspan { fill: var(--color-text); }
    .arch-edge { fill: none; stroke: var(--color-primary); stroke-width: 1.5; marker-end: url(#arch-arrow); }
    .arch-edge--dashed { stroke-dasharray: 4 3; }
    .arch-edge-label { fill: var(--color-muted); font-size: 14px; }
  </style>
  <rect class="arch-box" x="20" y="18" width="180" height="42"></rect>
  <text class="arch-label" x="110" y="44" text-anchor="middle">Besøkjande (anonym)</text>
  <rect class="arch-box" x="370" y="18" width="180" height="42"></rect>
  <text class="arch-label" x="460" y="44" text-anchor="middle">Tilsette (innlogga)</text>
  <rect class="arch-box" x="720" y="18" width="180" height="42"></rect>
  <text class="arch-label" x="810" y="44" text-anchor="middle">Vibeverk (superadmin)</text>
  <path class="arch-edge" d="M110,60 L110,100"></path>
  <path class="arch-edge" d="M460,60 L460,100"></path>
  <path class="arch-edge" d="M810,60 L810,100"></path>
  <rect class="arch-box" x="20" y="102" width="180" height="46"></rect>
  <text class="arch-label" x="110" y="129" text-anchor="middle">Offentleg nettside (/)</text>
  <rect class="arch-box" x="370" y="102" width="180" height="46"></rect>
  <text class="arch-label" x="460" y="129" text-anchor="middle">Workspace (/workspace/)</text>
  <rect class="arch-box" x="720" y="102" width="180" height="46"></rect>
  <text class="arch-label" x="810" y="129" text-anchor="middle">Console (/console/)</text>
  <path class="arch-edge" d="M110,148 L110,185"></path>
  <path class="arch-edge" d="M460,148 L460,185"></path>
  <rect class="arch-box" x="20" y="188" width="530" height="42"></rect>
  <text class="arch-label" x="285" y="212" text-anchor="middle" font-size="14">middleware.js — hostname → tenant</text>
  <path class="arch-edge" d="M285,230 L285,270"></path>
  <path class="arch-edge" d="M810,148 C 810,240 640,255 545,270" fill="none"></path>
  <text class="arch-edge-label" x="700" y="200">OTP + broker (audit-logga)</text>
  <rect class="arch-box" x="20" y="272" width="430" height="108"></rect>
  <text class="arch-label" x="235" y="296" text-anchor="middle" font-weight="700">Dataplan</text>
  <text class="arch-label" x="235" y="316" text-anchor="middle" font-size="14"><tspan x="235" dy="0">Éin isolert Supabase</tspan><tspan x="235" dy="18">per kunde — RLS,</tspan><tspan x="235" dy="18">anon/auth-nøklar</tspan></text>
  <rect class="arch-box" x="470" y="272" width="430" height="108"></rect>
  <text class="arch-label" x="685" y="296" text-anchor="middle" font-weight="700">Kontrollplan</text>
  <text class="arch-label" x="685" y="316" text-anchor="middle" font-size="14"><tspan x="685" dy="0">vibeverk-control —</tspan><tspan x="685" dy="18">tenant-register, operatørar,</tspan><tspan x="685" dy="18">Vault-hemmelege nøklar</tspan></text>
  <path class="arch-edge arch-edge--dashed" d="M685,272 C 685,240 450,240 450,272"></path>
  <text class="arch-edge-label" x="500" y="248" text-anchor="middle">service_role via Vault, per tenant</text>
</svg>
</div>

**Slik les du illustrasjonen**: dei tre øvste flatene snakkar med sitt eige inngangspunkt (offentleg sida, Workspace, Console). `middleware.js` løyser kva kunde ein førespurnad til nettsida/Workspace gjeld ut frå domenet, og peikar vidare til den kunden sin eigen, isolerte database (dataplanet). Console autentiserer i staden mot eit heilt separat, felles kontrollplan (`vibeverk-control`) og hentar/skriv kunde-konfigurasjon gjennom den audit-logga `broker`-funksjonen der — han er også den som held (via Supabase Vault) nøkkelen kontrollplanet treng for å nå inn i kvar kunde sitt eige dataplan. Sjå «Kontrollplan vs. dataplan» i `README.md` og ADR-0008 for full detalj.

## Kvar data blir lagra (kort versjon)

- **Supabase** er databasen — éin heilt separat database per kunde (aldri delt mellom kundar). Alt som skal vare (kundeforhold, henvendingar, brukarkontoar, chat) hamnar her til slutt.
- **Nettlesaren sin `localStorage`** er ei mellombels arbeidskopi — rask å lese frå, men blir automatisk kopiert opp til Supabase i bakgrunnen. IKKJE ein trygg, permanent stad å stole på åleine.
- Full detalj: `docs/architecture/storage-and-data-flow.md`.

## Roller — kven kan gjere kva

| Rolle | Kan |
|---|---|
| `member` | Lese det meste, redigere sine eigne notat/oppgåver, vanleg CRM-tilgang (ikkje slette/eksportere) |
| `editor` | Alt `member` kan, pluss redigere innhald (kunngjeringar, kunnskapsbase, oppgåveadministrasjon) |
| `admin` | Alt, inkludert brukaradministrasjon og innstillingar |
| **Vibeverk-superadmin** (Console) | Ikkje ein kunderolle i det heile — eit HEILT separat, eige innloggingssystem, kun for Vibeverk sjølv |

Full detalj, inkludert kva som faktisk er teknisk handheva vs. berre skjult i grensesnittet: `docs/architecture/roles-and-tenants.md`.

**Viktig prinsipp du bør forstå tidleg**: "knappen er skjult" og "handlinga er teknisk blokkert" er IKKJE det same. Nokre stader i Vibeverk er begge på plass, andre stader er berre grensesnittet skjult (og databasen ville i teorien tillate handlinga om nokon fann ein annan veg inn). `docs/architecture/roles-and-tenants.md` seier eksplisitt frå kvar dette gjeld — spør om du er usikker, ikkje anta.

## Kva er kritisk og farleg å endre?

Sjå [`safe-changes-guide.md`](safe-changes-guide.md) for ei konkret oversikt over kva du kan gjere sjølv, kva som treng testing, og kva som alltid må eskalerast. Kort oppsummert: **tekst, bilete og innstillingar i eit admin-panel er trygt** — **roller, tilgangar, databasestruktur, miljøvariablar og deploy krev alltid teknisk godkjenning.**

## Testing, deploy og tilbakerulling

- Vibeverk har tre automatiske testpakkar (`node test.js`, `node test-workspace.js`, `node test-api.js`) som køyrer ved kvar endring i koden (sjå `CLAUDE.md` sin "Testing"-seksjon for kva dei faktisk dekker og kva dei IKKJE dekker).
- All ekte utrulling skjer via Git — ein `git push` til `main`-greina. **Ingen utrulling skjer utan eksplisitt godkjenning frå systemeigar**, uansett kven som ber om det (`CLAUDE.md` sin "Deployment safeguard").
- Tilbakerulling er alltid mogleg via Git (finn siste fungerande commit, revert til han) — sjå [`docs/security/incident-and-escalation-guide.md`](../security/incident-and-escalation-guide.md) for korleis dette skal gjerast i praksis om noko går gale.

## Korleis levere ei løysing til ein kunde

Sjå [`docs/architecture/customer-delivery-checklist.md`](../architecture/customer-delivery-checklist.md) (produkt/innhald/kvalitet) og `docs/compliance/customer-go-live-checklist.md` (personvern/juridisk) — dette er TO ulike sjekklister med ulikt formål, begge må gjennom før ein kunde blir sett aktiv.

## Kva ein ny person kan bidra med utan risiko

Sjå rolletrappa under [`safe-changes-guide.md`](safe-changes-guide.md) — nivå 1 (innhald/kundedialog/testing) kan gjerast av nokon utan kodekunnskap i det heile, med den rette opplæringa.

---

## Lesing- og opplæringsrekkefølgje

**Dag 1:**
1. Les dette dokumentet i sin heilskap.
2. Les `docs/README.md` (kartet over all dokumentasjon — kva som er sant no vs. kva som berre er planlagt).
3. Sjå gjennom ordlista nedst i dette dokumentet.

**Første veke:**
1. Les [`safe-changes-guide.md`](safe-changes-guide.md) i sin heilskap.
2. Les `docs/architecture/system-overview.md` og `docs/architecture/roles-and-tenants.md`.
3. Gjer éin trygg, dokumentert øving saman med systemeigar — t.d. redigere ein tekst i Web-admin, følgje han gjennom testing, og sjå han faktisk publisert.

## Rollenivå (kva som er trygt for kven)

**Nivå 1 — Kundekoordinator / innhald og oppsett**
Kan arbeide med innhald, bilete, testing, kundedialog og dokumenterte innstillingar i admin-panela. Kan IKKJE endre roller, tilgangar, database eller deploy-oppsett.

**Nivå 2 — Produkt og kvalitet**
Kan i tillegg teste modular, kontrollere kundeleveransar mot sjekklistene over, samle og rapportere feil, og halde dokumentasjon oppdatert. Framleis ikkje kodeendringar eller databasetilgang.

**Nivå 3 — Teknisk ansvarleg**
Kan arbeide med kode, Git, deploy, Supabase/database, miljøvariablar, roller og integrasjonar — med dei godkjenningsstega `CLAUDE.md` krev (aldri push/deploy/Supabase-endring utan eksplisitt godkjenning frå systemeigar).

Nivå 1 og 2 skal **aldri** endre tekniske sikkerheitsområde (roller, RLS, miljøvariablar, deploy) på eiga hand — sjå [`safe-changes-guide.md`](safe-changes-guide.md) sin eskaleringsliste.

---

## Ordliste — vanlege ord du vil møte

| Ord | Kva det betyr her |
|---|---|
| **Frontend** | Det som køyrer i nettlesaren din — det du faktisk ser og klikkar på |
| **Backend** | Det som køyrer på ein server, usynleg for besøkjande — her: Supabase |
| **Database** | Der data blir lagra permanent (kven er kunde, kva har dei sagt, osv.) |
| **API** | Ein fastsett måte for to system å snakke saman på (t.d. nettsida ↔ Supabase) |
| **localStorage** | Nettlesaren sitt eige, mellombelse lager — sjå "Kvar data blir lagra" over |
| **Supabase** | Systemet Vibeverk brukar som database, innlogging og sanntidsoppdateringar |
| **Tenant** | Éin kunde sin heilt separate installasjon (eiga database, eiga config) |
| **RLS (Row Level Security)** | Reglar i sjølve databasen som avgjer kven som får lese/skrive kva rad — den EKTE sikkerheitsgrensa, ikkje berre kva som er synleg i grensesnittet |
| **Autentisering** | "Er du den du seier du er?" — innlogging |
| **Autorisasjon** | "Har du lov til å gjere DETTE, gitt kven du er?" — rolle/tilgang |
| **Modul** | Éin sjølvstendig, avgrensa funksjonsdel (t.d. chat, CRM, booking) som kan skruast av/på |
| **Deploy** | Å faktisk publisere ei kodeendring så ho blir levande for ekte besøkjande |
| **Repository (repo)** | Heile kodebasen, med si fulle historie, lagra i Git/GitHub |
| **Commit** | Éi lagra endring i koden, med ei melding om kva/kvifor |
| **Branch** | Ein sidespor-kopi av koden du kan endre utan å påverke hovudversjonen med éin gong |
| **Rollback** | Å gå tilbake til ein tidlegare, fungerande versjon av koden |
| **Miljøvariabel** | Ei innstilling (t.d. ein URL eller nøkkel) som blir sett UTANFOR sjølve koden, ulikt per miljø |
| **Secret** | Ein hemmeleg verdi (passord, nøkkel) som ALDRI skal stå synleg i kode eller dokumentasjon |
| **State** | "Kva er sant akkurat no" i eit program — t.d. kva fane som er open |
| **Cache** | Ei mellombels lagra kopi, for å sleppe å hente same data på nytt kvar gong |
| **Testmiljø** | Ein stad å prøve endringar TRYGT, utan å påverke ekte kundedata (t.d. `vibeverk-staging`) |
| **Produksjonsmiljø** | Der ekte kundar og ekte data faktisk er — feil her påverkar ekte folk |
| **Feilrapport** | Ei skildring av noko som ikkje fungerer som forventa, med nok detalj til at nokon kan finne det att |
| **Regresjon** | Ein feil som kjem TILBAKE etter å ha vore fiksa éin gong før |
| **Console** | Vibeverk sitt eige, interne verktøy for å administrere alle kundar — IKKJE noko kunden sjølv har tilgang til |
| **Control plane / data plane** | Control plane = Vibeverk sitt eige register over alle kundar. Data plane = kvar enkelt kunde sin eigen, separate database |

---

**Kva dette dokumentet ikkje gjer**: det gjer deg ikkje i stand til å gjere ALT sjølv. Det gjer deg trygg på (1) kva du kan gjere sjølv, (2) kva du må teste, (3) kva du må få godkjent, og (4) kva du alltid må eskalere — nøyaktig slik [`safe-changes-guide.md`](safe-changes-guide.md) skildrar det i detalj.
