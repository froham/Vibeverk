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

## 0.7.0 — 2026-07-01

Oppfølging av 0.6.0-sikkerheitsaudit, sammenstilt mot ein uavhengig Codex/GPT-review. Codex sine funn stemte i hovudsak overeins med Claude sin eigen audit (same BLOCKER-funn, same HIGH-funn); dei fann i tillegg to reelle gap Claude sin audit ikkje hadde fanga opp (sjå under). Delt i (a) trygge kodefiksar gjort no, og (b) SQL-endringar samla i eiga fil for eksplisitt godkjenning før noko køyrast mot Supabase, per `CLAUDE.md`.

### Retta (kode, lokalt testa — ingen Supabase-endring)
- **Stored XSS i e-postsvar-modalen.** `openReplyModal` (`core.js`) sin eigen rich-text-editor sende raw `innerHTML` til `send-reply` og til CRM sin `addComm()`-historikk, utanom appen sin faktiske sanitizer (`C.sanitizeRichHtml`) som elles brukast overalt (`bindRichTextFields`/`readRichTextField`). Ein admin som limte inn eller skreiv `<script>`/`onerror=`-innhald i eit e-postsvar fekk det lagra usanert og seinare rendra raw i kundehistorikken. Retta ved å sanere før sending.
- **Hardkoda CSP blokkerte framtidige kundeprosjekt.** `connect-src` i alle fire HTML-innganger (`index.html`, `intranet/index.html`, `console/index.html`, `admin/index.html`) peika på éin spesifikk Supabase-hostnamn (`clzczbyklgdtdhgjphup.supabase.co`). Endra til `https://*.supabase.co`/`wss://*.supabase.co` slik at ein fork med eit anna Supabase-prosjekt ikkje vert blokkert av CSP.
- **`send-reply`-funksjonen (Edge Function) mangla grunnleggande inndata-avgrensingar.** Lagt til e-postformat-validering, lengdegrenser på emne/tekst/HTML, og talls-/storleiksgrenser på vedlegg — hindrar openbre feilinntastingar og uforholdsmessig store/mange nyttelaster frå ein autorisert konto. Retta i koden (`supabase/functions/send-reply/index.ts`); **ikkje redeploya til produksjon enno**.
- **CI-testane kunne henge (og — verre — vart tidlegare kutta stille).** Undersøkte Codex sin påstand om at Node-testprosessen kunne henge på grunn av `setInterval` (admin-badge-refresh m.fl.) som aldri vert cleara. Eit første forsøk (tvungen `process.exit()` på slutten av testfilene) viste seg å ha ein alvorleg biverknad: `test.js` sin asynkrone testblokk (`(async () => {...})()`, ca. 90 % av alle testar) var ikkje `await`a, så `process.exit()` avslutta prosessen FØR den asynkrone blokken faktisk var ferdig — output vart stille kutta etter berre ca. 25 av 372 testar, utan feilmelding. Retta ordentleg: fanga opp IIFE-en sitt promise og ventar på at han er ferdig (`.catch().then(...)`) før ein flusher stdout og avsluttar prosessen. Verifisert: `test.js` køyrer no alle 372 testar til slutt (371 OK/1 FEIL, ~2 sek), `test-intranet.js` uendra (64 OK/1 FEIL, <1 sek).
- **`hub/tenants.js` sitt plaintext-passord** vart vurdert, men **ikkje fiksa** — fila er reelt offentleg deployert (`hub/index.html` finst, ingen deploy-ekskludering), så ei ny passordstreng ville berre vore ein skinnfiks. Står open for ei reell brukaravgjerd (ekte auth vs. fjerne Hub frå offentleg deploy).

### Førebudde SQL-fiksar (IKKJE køyrde — krev eksplisitt godkjenning)
Samla i `supabase/hotfix_security_audit_2026-07-01.sql` (køyrast manuelt i Supabase Dashboard → SQL Editor når godkjent) og lagt inn i `supabase/migration.sql` for framtidige/friske kundeprosjekt:
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
