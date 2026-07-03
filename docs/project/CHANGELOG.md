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
- **Ikkje del av denne runda**: `leads` (Kontakt+Tilbud) og `booking-bookings` er framleis i `store` — same CRITICAL-funn gjeld framleis for desse to nøklane. Planlagt som neste to steg (sjå arkitekt-planen), med Tilbud/Kontakt-leads sitt nye `kind`-felt som del av steget. Ingen SQL er køyrt mot produksjon enno for nokon del av denne runda.

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
