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

## 0.8.0 — 2026-07-02

Samla regresjons- og kvalitetsretting (rollemodell, booking/CRM e-postmalar, bildefelt, chat-polling, kontaktskjema-flagg, personvern-rich-text). Sjå `docs/project/CURRENT_STATE.md` for full status, `docs/architecture/roles-and-tenants.md` for den endelege rollematrisa.

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
