# Data Map — Vibeverk (produksjonstenant "vibeverk.no")

> Første reelle, kodegrunngjevne utfylling av `data-map-template.md`, gjort 2026-07-16 av Privacy and Compliance Advisor. Dette er **framleis ikkje ei juridisk godkjenning** — sjå README.md i denne mappa. Felt merka **[ÅPENT]** krev stadfesting utanfor repoet (Supabase Dashboard, avtaledokument, DNS/e-postoppsett). Felt utan merking er verifisert direkte mot koden på tidspunktet dette dokumentet vart skrive.
>
> Sjå òg `docs/compliance/data-map-sunnvask-notes.md` for kva som er ulikt/ope for showcase-tenanten Sunnvask.

---

## 1. Kundeidentitet

| Felt | Verdi |
|---|---|
| Firmanavn | Vibeverk (dette er både plattformleverandøren og — sidan 2026-07-16-cutover — sin eigen produksjonstenant) |
| Domene | vibeverk.no (apex A-record → Vercel sidan 2026-07-16, sjå ADR-0007) |
| Supabase-prosjekt | `clzczbyklgdtdhgjphup` (verifisert: `config.js` → `supabase.url`, og stadfesta som tenanten sin `data_plane_url` i `vibeverk-control` sitt `tenants`-register, ADR-0007 2026-07-16-tillegg) |
| Supabase datasenter-region | **[ÅPENT — MÅ STADFESTAST]** — sjekk Supabase Dashboard → Project Settings → Infrastructure for `clzczbyklgdtdhgjphup`. Dette er lista opphøgd som ope spørsmål i `docs/project/CURRENT_STATE.md` sjølv, ikkje noko denne gjennomgangen kan slå fast frå repoet. |
| Vercel-region/plan | **[ÅPENT]** — same grunngjeving, Vercel-prosjektkonfigurasjon er ikkje synleg frå repoet. |
| Organisasjonsnummer / adresse | **[ÅPENT]** — ikkje eit repo-spørsmål; hent frå faktisk firmaregistrering. |

---

## 2. Vibeverk si rolle

Same struktur som malen sitt punkt 2, men no konkretisert for denne eine tenanten:

- For funksjonar der **Vibeverk sjølv** er kunden (t.d. eiga chat, eige kontaktskjema, eige CRM) er Vibeverk sannsynlegvis **behandlingsansvarleg** for dei besøkjande sine data — det er Vibeverk som bestemmer formål og middel for eiga nettside.
- For den tekniske drifta av plattforma (Supabase, e-postutsending via Resend, hosting via Vercel) opptrer Vibeverk sannsynlegvis som **databehandlar for seg sjølv** i praksis er dette eit spesialtilfelle utan ein ekstern kunde — det finst ingen ekstern "kunde" å inngå ei DPA med for denne eine tenanten, sidan Vibeverk er både plattformleverandør og datainnsamlar her.
- Dette skil seg frå ein vanleg kundeinstallasjon (der Vibeverk er databehandlar og kunden er behandlingsansvarleg) — **denne rolletolkinga må stadfestast med kvalifisert juridisk rådgjeving**, sidan "leverandør er sin eigen kunde" ikkje er eit standardoppsett malen dekker eksplisitt.
- For Vibeverk sine eigne tilsette/operatørar (Console-brukarar i `vibeverk-control`) er Vibeverk **arbeidsgjevar/behandlingsansvarleg** i vanleg forstand.

---

## 3. Datakategoriar per funksjon (kun det som faktisk er aktivt for denne tenanten)

Verifisert mot `config.js` (repoet sin base-versjon — merk punkt 3a under om produksjon vs. repo): `features.chat=true`, `features.crm=true`, `features.crmFull=true`, `features.contactForm=true`, `features.booking=true`, `features.quote=true`, `intranettFeatures.crm=true`, `.contact=true`, `.booking=false`, `.quote=false`.

### 3a. Viktig strukturell merknad — to konfigurasjonslag

Sidan Phase 6/cutover (ADR-0007) blir **basis-`config.js` generert dynamisk per request** av `api/tenant-config.js` ut frå `vibeverk-control` sitt tenant-register — ikkje lenger lest statisk frå repoets `config.js`. Repoets `config.js` (lesen i denne gjennomgangen) er malen/lokal-dev-versjonen, IKKJE nødvendigvis byte-for-byte det som faktisk blir servert til ein nettlesar på `vibeverk.no` i dag. Feature-flagg og `admin.password` for den *faktiske* live-tenanten ligg i superconfig/broker-laget (Console-styrt), som denne gjennomgangen ikkje har lese direkte (krev tilgang til `vibeverk-control`/produksjons-`store`, utanfor kva eit repo-lesande pass kan stadfeste). **Denne data-kartet sine funksjonsflagg er difor eit sannsynleg, ikkje eit stadfesta, bilete av den live tenanten** — stadfest faktisk aktive modular via Console → Modular-fana før bruk i eit ekte personvernnotat.

### Chat (module-chat.js)

| Felt | Detalj |
|---|---|
| Data samla inn | Besøkjande sitt namn (valgfritt), e-post (påkravd for å starte samtale), sjølve meldingsteksten, og nettlesarmetadata: `page_url`, `referrer`, `language`, `browser`, `os`, `screen` (oppløysing). `visitor_id` er ein tilfeldig streng generert i nettlesaren (`Chat.newId()`), ikkje verifisert identitet. |
| Samtykke i praksis | Ei avkryssingsboks (`vw-terms-cb`) må huka av FØR "Start samtale" er klikkbar — teksten er `chat.termsText` frå config (standard: "Eg godtek at denne samtalen lagrast"), med valfri lenke (`chat.termsUrl`) til personvernside. Dette er verifisert kode, ikkje berre eit dokumentert forslag. |
| Kor lagra | Supabase-tabellane `chat_conversations` og `chat_messages`. `visitor_id` + siste samtale-ID ligg òg i nettlesaren sin `localStorage` (nøkkel `nordpunkt:chat:vid` osv.). |
| Kven kan lese | Web-admin (passordbeskytta eller Supabase Auth-rolle admin/editor, sjå `isWorkspaceMember()`-kommentaren i `module-crm.js` — same autentiseringsmodell gjeld chat-admin). Anon (besøkjande) har **ikkje** direkte `SELECT` på nokon av dei to tabellane (stadfesta: `supabase/migrations/20260707000001_baseline_schema.sql` gir anon berre `INSERT` på `chat_conversations` og `EXECUTE` på fire visitor-scoped RPC-ar — `get_visitor_conv`, `get_visitor_msgs`, `update_visitor_presence`, `insert_visitor_message` — alle validerer `visitor_id` server-sida). |
| Sletting | **Delvis automatisert, ikkje berre manuell** — Web-admin sin CRM-fane har ein "Slett alle data for en person" (GDPR §17)-funksjon (`core.js` linje ~2719, `deleteAllForEmail()` i `module-crm.js`) som slettar leads, bookingar, CRM-kommunikasjon OG chat-samtalar knytt til ei e-postadresse, i éin operasjon. Dette er ei reell, kodeverifisert sletteflyt — malen sin påstand om "ingen automatisk sletting" er difor for pessimistisk for DENNE plattforma. Merk avgrensinga: sletting skjer per e-postadresse oppgitt av admin, ikkje sjølvbetjent for den besøkjande sjølv. |
| Retensjon (kor lenge før nokon slettar) | **[ÅPENT]** — ingen automatisk tidsbasert sletting/anonymisering finst i koden; sletting er alltid ein admin-utløyst handling via funksjonen over. Retensjonsperiode må difor vere ein driftsrutine, ikkje ein teknisk garanti. |
| Rettsleg grunnlag | **[ÅPENT — krev juridisk vurdering]** — sannsynlegvis samtykke (avkryssingsboksen) og/eller legitim interesse for sjølve kundeservice-formålet. |

### CRM (module-crm.js) — kundar/bedrifter/kommunikasjon

| Felt | Detalj |
|---|---|
| Data samla inn | `crm_customers`: e-post, alternative e-postar, namn, telefon, adresse, fritekstnotat, kundenummer. `crm_bedrifter`: bedriftsnamn, org.nr, nettstad, telefon, adresse, fakturainfo. `crm_comms`: polymorf logg (e-post sendt/motteke, telefonnotat, internt notat, dokument, oppgåve) — kjente felt er kolonnar, resten ligg i ein `data jsonb`-kolonne. |
| Kven collector | Vibeverk sine eigne tilsette/admin/editor-brukarar (via Web-admin/Workspace), pluss auto-import frå leads/bookingar (`autoImport()`). |
| Kor lagra | Supabase: `crm_customers`, `crm_bedrifter`, `crm_comms` (flytta ut av `store`-tabellen 2026-07-03 av tryggingsgrunnar, sjå migrasjonskommentar). |
| Kven kan lese | Admin/editor: full tilgang. Member: full lese/skrive-tilgang til kundar/bedrifter (sjå `isWorkspaceMember()`), men **ikkje** CSV-eksport eller sletting av kundar/bedrifter/kommunikasjon (server-sida handheva via `can_edit_content()`-sjekk i respektive RLS-policyar). Kodekommentaren i `module-crm.js` (linje ~590) peikar sjølv på at UI-sperra for CSV-eksport IKKJE er reell datatryggleik, sidan ein teknisk member uansett har legitim REST-API-tilgang til dei same dataa. |
| E-postutsending frå CRM (crmFull) | `send-reply` Edge Function sender via Resend (`noreply@vibeverk.no`, reply-to `hei@vibeverk.no`), krev rolle admin/editor server-sida, har storleiks-/vedleggsgrenser. |
| Sletting | `deleteAllForEmail()` (sjå Chat-seksjonen over) dekker CRM-kommunikasjon; enkeltkundar/-bedrifter kan slettast manuelt av admin/editor via UI. |
| Retensjon | **[ÅPENT]** |
| Rettsleg grunnlag | **[ÅPENT — krev juridisk vurdering, sannsynlegvis kontraktsoppfylling/legitim interesse for kunderelasjonshandtering]** |

### Kontaktskjema og Tilbud (leads-tabellen, delt av begge)

| Felt | Detalj |
|---|---|
| Data samla inn | Namn, e-post, meldingstekst, valfrie vedlegg (`attachments jsonb`), `kind` (kontakt/tilbud), referansenummer. |
| Kor lagra | Supabase `leads`-tabellen. Anon skriv via `insert_anon_lead()`-RPC (ikkje direkte `INSERT`), ingen anon `SELECT`. |
| Kven kan lese | Admin/editor (Web-admin "Henvendelser"), Workspace-modulane `module-contact.js`/`module-quote.js` (viser same data, filtrert på `kind`). |
| Sletting | Manuell via admin (`App.deleteLead`), eller via GDPR-sletting-funksjonen over. |
| Retensjon | **[ÅPENT]** |

### Booking (bookings-tabellen)

| Felt | Detalj |
|---|---|
| Data samla inn | Namn, e-post, telefon, meldingstekst, valt tidspunkt/ressurs (`asset_id`), referansenummer. |
| Kor lagra | Supabase `bookings`-tabellen. Anon skriv via `insert_anon_booking()`-RPC. |
| Sletting | Manuell via admin, eller GDPR-sletting-funksjonen (dekker booking via e-post). |
| Retensjon | **[ÅPENT]** |

### Workspace-brukarar (users-tabellen) — Vibeverk sine eigne tilsette/operatørar

| Felt | Detalj |
|---|---|
| Data samla inn | `id` (uuid, delt med `auth.users`), `display_name`, `email`, `role` (admin/editor/member), `created_at`/`updated_at`. Invitasjon skjer via `manage-user` Edge Function (Supabase Auth `inviteUserByEmail`). |
| Kven kan lese/skrive | Admin kan administrere alle brukarar (invitere/fjerne via `manage-user`, krev rolle admin server-sida). |
| Sletting | `manage-user`-funksjonen sin `remove`-handling kallar `auth.admin.deleteUser()`, som kaskaderer til `public.users` (ON DELETE CASCADE) og vidare til `tasks`/`announcements`/`kb_articles` sine forfattar-/tildelings-FK-ar (handtert eksplisitt, sjå migrasjon `20260712203346_fix_user_delete_fk_restrict.sql`). Dette er ei reell, fungerande slettefunksjon for tilsettdata. |
| Retensjon | **[ÅPENT — kva skjer med ein tidlegare tilsett sine notatar/oppgåver/publiserte artiklar er delvis avgjort av FK-oppførselen (SET NULL/CASCADE per tabell), men SJØLVE retensjonsperioden (kor lenge etter avslutta arbeidsforhold) er ei driftsavgjerd, ikkje kode]** |

### Notatar, Oppgåver, Aktuelt, Kunnskapsbase (Workspace-interne)

Same struktur som malen (uendra frå malen sin generelle skildring) — verifisert mot skjema: `notes` (RLS: `user_id = auth.uid()`, reint privat), `tasks` (nyleg innstramma lese-RLS, sjå `20260713130659_tighten_tasks_read_rls.sql`), `announcements`/`kb_articles` (forfattar-ID, ope for alle innlogga Workspace-brukarar). Ingen ny finn utover det malen alt dekker.

### Analyse — Plausible

**Ope for Vibeverk sjølv i repoets `config.js`**: `analytics.plausible: ""` (tom streng) — Plausible er altså **ikkje konfigurert/aktiv** for denne tenanten i den lesne konfigurasjonen. Dersom Console/superconfig har sett ein verdi for den live tenanten (jf. punkt 3a over om dei to konfigurasjonslaga), er dette **[ÅPENT — stadfest via Console → Analyse-fana for den faktiske `vibeverk.no`-tenanten]**. Koden (`core.js`) viser at når Plausible ER konfigurert, genererer plattforma automatisk eit personvernforslag som nemner Plausible eksplisitt (verifisert i `test.js` linje 1528-1530) — mekanismen fungerer, men om den er PÅSLÅTT for denne tenanten er ikkje stadfesta av dette passet.

### Tidio

**Finst ikkje i kodebasen.** Grundig søk (`grep -i tidio` over heile repoet utanom `node_modules`) fann **ingen treff** i faktisk kode (`.js`, `.ts`, `.html`) — berre i malen sjølv (`data-map-template.md`, `customer-go-live-checklist.md`) og i denne rådgjevaragenten sin eigen instruksjonsfil. **Dette er ein reell avdekt feil i malverket**, ikkje eit ope spørsmål: Tidio er IKKJE ei reell, verdifri integrasjon som "kan vere PÅ eller AV" — det finst rett og slett ingen kode som lastar Tidio noko stad i repoet i dag. Sjå punkt 4/5 under handling.

### Google Fonts

**LØYST 2026-07-16, same dag som dette datakartet vart skrive.** Var stadfesta reell og aktiv (dynamisk `<link>` til `fonts.googleapis.com` for kvar sidevising, IP-adresse send til Google). No sjølv-hosta for Vibeverk sine to eigne fontar (`Poppins`/`Nunito Sans`, latin/latin-ext-delmengder — sjå `fonts/self-hosted-fonts.css`): `core.js` sin `injectGoogleFonts()` og `workspace-core.js` sin `_loadWspFonts()` sjekkar no fontnamnet og brukar lokal fil i staden for Google sin CDN for desse to. Stadfesta empirisk (Playwright): **null nettverksførespurnadar til `fonts.googleapis.com`/`fonts.gstatic.com`** for Vibeverk sin standardkonfigurasjon. Google er difor IKKJE lenger ein reell tredjepartsoverføring for DENNE tenanten. **Merk**: mekanismen fell framleis tilbake til Google sin CDN for andre kundar som via Console vel eit anna Google Font-namn enn desse to — Google står difor framleis i tredjepartslista under som eit generelt plattform-unnatak, ikkje fjerna heilt, men er løyst for Vibeverk sin eigen live konfigurasjon spesifikt.
Console sitt eige font-forhandsvisingsverktøy (lagt til 2026-07-16, `console-core.js`) kallar framleis Google sin CDN direkte for VILKÅRLEGE fontnamn under konfigurering — dette er eit internt Vibeverk-operatørverktøy, ikkje synleg for/brukt av sluttkundar/besøkjande, og difor utanfor denne tenanten sin eigen personvernerklæring sitt scope (operatøren sin eigen IP, ikkje ein besøkjande sin).

### Plausible — stadfesta EU-lagra og cookiefri (2026-07-16)

Brukar har stadfesta eit aktivt val om å bruke Plausible, grunngjeve med EU-lagring og at det ikkje krev cookie-banner. Verifisert direkte mot Plausible sine eigne offentlege sider same dag: "All visitor data is securely processed and stored in the EU on infrastructure owned by European companies" (selskapet er registrert i Estland). Ingen cookies vert sett (bruker eit rotert daglig hash i staden for identifikatorar); Plausible sin eigen påstand er at "you do not need cookie banners for analytics" nettopp difor. Dette er ekstern, offentleg informasjon frå Plausible sjølv, ikkje uavhengig juridisk stadfesta av dette passet — men gjev eit solid faktagrunnlag for påstanden i personvernerklæringa.

---

## 4. Tredjepartsbehandlarar — stadfesta reelt wired opp i kode (ikkje berre malen sin generiske liste)

| Behandlar | Rolle | Data delt | Wired i kode? | Overføring utanfor EØS? | DPA/vilkår? |
|---|---|---|---|---|---|
| Supabase Inc. | Database/Auth/Realtime-hosting | All personopplysning i plattforma | JA — kjerneinfrastruktur | **NEI — stadfesta `eu-west-1` (Irland) for ALLE prosjekt (produksjon, kontrollplan, staging, Sunnvask), verifisert 2026-07-16 via `supabase projects list`** | **[ÅPENT — sjekk faktisk avtaledokument, men Supabase tilbyr ei standard DPA]** |
| Vercel Inc. | Statisk hosting + `middleware.js` request-tids hostnamn→tenant-oppløysing, sidan 2026-07-16-cutover | Servererte filer inneheld ikkje personopplysningar; `middleware.js` sender `Host`-headeren (hostnamn, ikkje personopplysning) til `vibeverk-control` sin `resolve_tenant_by_hostname()`-RPC — **verifisert i kode**: berre hostnamnet blir sendt i requestkroppen (`{p_hostname: host}`), ikkje IP eller andre besøkjande-data. Vercel sin eigen infrastruktur ser sjølvsagt besøkjande sin IP på vanleg HTTP-nivå (same eksponering som alle edge-/CDN-leverandørar) — dette er hendeleg/infrastrukturelt, ikkje noko applikasjonskoden vidaresender bevisst. | JA — kode stadfesta | **JA — stadfesta 2026-07-16 via Vercel sin eigen DPA-side: "primary processing facilities are in the United States", inga EU-only-garanti. SCC (2021, Modul 1-3) tilbydd for EØS/UK/Sveits-overføring. (Ein reell EU-edge, t.d. Stockholm `arn1`, vart likevel observert å handtere ein del av trafikken — men ikkje kontraktsfesta.)** | **JA — DPA med SCC tilgjengeleg, sjå `vercel.com/legal/dpa`** |
| GitHub Pages | Rollback-hosting, IKKJE lenger live trafikk for `vibeverk.no` sidan 2026-07-16 (repo sin `CNAME`-fil urørt) | Same statiske filer, ingen personopplysning i dei sjølve | Historisk aktiv, no i standby | USA | **[ÅPENT]** |
| Resend | Transaksjonell e-post: chat/kontakt/tilbud-svar (`send-reply`) OG Supabase Auth SMTP (Console sin "Set opp e-post"-steg, per onboarding-runbooken) | Mottakars e-postadresse, namn, emne, meldingstekst, ev. vedlegg (`send-reply`); og invitasjons-/passord-reset-e-postar (Auth SMTP) | JA — to ulike bruksområde, stadfesta i kode/runbook | **JA — stadfesta 2026-07-16 via Resend sin eigen DPA/underleverandør-side: "primary processing operations take place in the United States", alle 21 oppgitte underleverandørar (inkl. AWS, Google, Supabase sjølv) merka USA. SCC (EU/UK/Sveits-variantar) eksplisitt tilbydd.** | **JA — DPA med SCC tilgjengeleg, sjå `resend.com/legal/dpa`** |
| Google LLC | Google Fonts-levering | **LØYST 2026-07-16 for Vibeverk sine to eigne fontar** (Poppins/Nunito Sans) — no sjølv-hosta, ingen førespurnad til Google i det heile, sjå punkt 3. Framleis relevant berre om ein KUNDE via Console vel eit anna Google Font-namn (då: besøkjande sin IP, hendeleg, ved fontførespurnad) | Delvis — sjå merknad | USA (for framleis-dynamiske fontval hos andre kundar) | **[ÅPENT, sannsynlegvis Google sine standardvilkår]** |
| Plausible Analytics | Web-analyse | Sidevisingar, ikkje-cookiebasert | **[ÅPENT for DENNE tenanten om PÅSLÅTT — sjå punkt 3a, ikkje konfigurert i repoets `config.js`, men brukar har stadfesta eit AKTIVT VAL om å bruke Plausible]** | **NEI — stadfesta 2026-07-16 via Plausible sine eigne offentlege sider: "Visitor data does not leave the EU", selskap registrert i Estland** | **[ÅPENT — sjekk faktisk avtale, men Plausible tilbyr normalt standardvilkår]** |
| Tidio | Live chat SaaS | — | **NEI — inga kode finst, sjå punkt 3 over** | Ikkje relevant | Ikkje relevant |

**Oppsummert kritikalitet (brukar spurde eksplisitt om dette 2026-07-16):** **Resend er den mest kritiske av dei to attverande ikkje-EU-prosessorane**, sidan han faktisk handterer INNHALDET i personopplysningar (e-postadresser, meldingstekst i utgåande e-postar) — ikkje berre metadata. Vercel handterer til samanlikning berre `Host`-headeren (hostnamnet) ved ruting, aldri besøkjande sitt faktiske namn/e-post/meldingsinnhald — ein monaleg mindre eksponering, sjølv om begge er amerikanske selskap med SCC som overføringsgrunnlag. Supabase (all lagring) og Plausible (analyse) er begge stadfesta reint EU-baserte. Google Fonts er løyst for Vibeverk sjølv, framleis eit ope, men lite kritisk, punkt for andre kundar sitt frie fontval.

### 4a. Er DPA-ane faktisk SIGNERTE (ikkje berre TILBODNE)? — stadfesta 2026-07-16

Brukar spurde direkte om desse tre DPA-ane faktisk er signerte, ikkje berre teoretisk tilgjengelege. Sjekka kvar leverandør sin eigen dokumentasjon for KORLEIS ei DPA faktisk trer i kraft:

| Leverandør | Korleis DPA-en faktisk trer i kraft | Status for Vibeverk |
|---|---|---|
| **Resend** | Automatisk innlemma for ALLE kundar, uansett plan-nivå — ingen eiga signering, gjeld berre ved å akseptere Resend sine standardvilkår (deira eigen DPA-tekst nemner ingen plan-avgrensing) | **Truleg alt i kraft** — ingen ytterlegare handling truleg naudsynt, sidan ein ikkje kan opprette konto utan å akseptere standardvilkåra |
| **Supabase** | KREV ei aktiv handling: bestillast via dashbordet sin "Legal documents"-side, signerast via eit eige PandaDoc-dokument — IKKJE automatisk, uavhengig av plan | **[ÅPENT — kan ikkje stadfestast av eit repo-lesande/CLI-lesande pass, må sjekkast direkte i Supabase-dashbordet for organisasjonen "Hammerz"]** |
| **Vercel** | Deira eigen DPA-side seier eksplisitt at automatisk innlemming berre gjeld "Enterprise and Pro plan customers" | **⚠️ REELT FUNN: Vibeverk sin Vercel-konto er stadfesta på Hobby-planen** (lese direkte frå eit gyldig `VERCEL_OIDC_TOKEN` sin JWT-payload, feltet `"plan":"hobby"` — IKKJE gjetting). Dette betyr DPA-en truleg IKKJE er automatisk i kraft slik kontoen står i dag. Krev anten (a) oppgradering til Pro, eller (b) direkte kontakt med Vercel support for å avklare/be om DPA-dekning på Hobby-plan. |

**Viktig rolleavklaring (brukar spurde eksplisitt 2026-07-16): dette er Vibeverk sitt eige ansvar, IKKJE sluttkunden sitt.** Supabase/Vercel/Resend har Vibeverk (kontoeigar for Vercel-teamet "Vibeverk", Supabase-organisasjonen "Hammerz", og Resend-kontoen) som einaste avtalepart — INGEN sluttkunde (verken Sunnvask eller ein framtidig betalande kunde) har nokon eigen, direkte avtale med desse tre leverandørane. Dette er ein ANNAN, oppstraums DPA-relasjon enn den Vibeverk sjølv skal tilby KVAR ENKELT sluttkunde (der Vibeverk er databehandlar og kunden er behandlingsansvarleg, og der nettopp desse tre — pluss Google/Plausible — skal listast opp som Vibeverk sine eigne underleverandørar). Vibeverk må ha orden i eigne leverandøravtalar FØR dette kan lovast pålitileg vidare til nokon kunde.

---

## 5. Ny post — edge-/ruting-mekanismen (Vercel `middleware.js` + `vibeverk-control`)

Dette er noko malen ikkje dekker i det heile, sidan det ikkje eksisterte då malen vart skriven. Fakta stadfesta ved lesing av `middleware.js` og ADR-0007:

- For kvar sideførespurnad (matcher: `/`, `/config.js`, `/workspace(/)`, `/console(/)`, `/admin(/)`) gjer `middleware.js` eit server-til-server-kall frå Vercel til `vibeverk-control` (`resolve_tenant_by_hostname`), og sender berre `Host`-headeren (hostnamn) i kroppen.
- Ei mellombels HTTP Basic Auth-sperre (`SITE_LOCK_PASSWORD`) er lagt til 2026-07-16 medan heile plattforma er under utvikling. Denne gjeld ALLE hostnamn bak same middleware (`vibeverk.no`, `console.vibeverk.no`, `sunnvask.vibeverk.no`, osv.) og er eksplisitt dokumentert som IKKJE ein tryggingsgrense, berre eit mellombels hinder mot tilfeldige besøkjande. Passordet er delt på tvers av alle tenantar bak same Vercel-prosjekt — det er difor ikkje ein tenant-spesifikk tilgangskontroll.
- Ingen personopplysning om nettsidebesøkjande (namn, e-post, chatinnhald) passerer gjennom denne ruting-mekanismen i det heile — han løyser berre KVA konfigurasjon som skal servast, ikkje noko av det faktiske innhaldet i chat/CRM/lead-flytene over.
- `broker_audit_log` (i `vibeverk-control`) loggar Vibeverk-**operatørane** sine handlingar (kven, kva handling, kva tenant, suksess/feil) — dette er personopplysning om Vibeverk sine EIGNE tilsette/operatørar (identifiserbare via `operator_id` → `operators.email`), ikkje om nokon kunde sine sluttbrukarar. Lesetilgang er avgrensa til aktive operatørar (`is_control_plane_operator()`), ingen skrivetilgang for innlogga brukarar i det heile (kun `service_role`).

---

## 6. Tilgangsoppsummering (stadfesta mot RLS/GRANT i migrasjonane)

| Rolle | Kva dei faktisk kan, verifisert i migrasjon |
|---|---|
| Anon (nettsidebesøkjande) | `SELECT` på `store` (offentleg config), `INSERT` på `chat_conversations`, `EXECUTE` på 4 visitor-scoped RPC-ar (chat), `EXECUTE` på `insert_anon_lead`/`insert_anon_booking`. INGEN direkte `SELECT` på `leads`, `bookings`, `chat_conversations`, `chat_messages`, `crm_*`. |
| Workspace member | Full CRM-lese/skrivetilgang (unntatt CSV-eksport/sletting av kundar-bedrifter-kommunikasjon, server-handheva via `can_edit_content()`), eigne notatar, oppgåver (nyleg innstramma), kan sjå kontakt/tilbud-fanene. |
| Workspace admin/editor | Alt member har, pluss brukaradministrasjon (admin), e-postutsending via `send-reply` (admin/editor). |
| Vibeverk-operatør (Console) | Superconfig, produktmodus, funksjonsflagg for den enkelte tenanten, via `broker`-funksjonen. Ingen direkte tilgang til kunden sin `store`-tabell utanom broker-vegen (per CLAUDE.md sin regel). |

---

## 7. Opne spørsmål som MÅ stadfestast før noko personvernnotat for `vibeverk.no` kan publiserast som endeleg

- [ ] Supabase-prosjektet (`clzczbyklgdtdhgjphup`) sin faktiske datasenter-region.
- [ ] Vercel-prosjektet (`vibeverk`) sin faktiske region/databehandlingsplassering.
- [ ] Er det signert DPA/vilkår med Supabase, Vercel, Resend, Google som dekker denne bruken?
- [ ] Er Plausible faktisk PÅSLÅTT for `vibeverk.no` sin live-tenant (via Console/superconfig), sidan repoets statiske `config.js` viser tom verdi?
- [ ] SPF/DKIM/DMARC-oppsett for `vibeverk.no` sin sending via Resend — ikkje stadfesta av dette passet, og allereie lista som ope i `docs/project/CURRENT_STATE.md`.
- [ ] Retensjonsperiodar for chat/CRM/leads/bookingar/tilsettdata — ingen er koda inn, alt er driftsavgjerder som må dokumenterast.
- [ ] `admin.password`-verdien for den faktiske live-tenanten (repoets `config.js` har placeholder `"test"` — dette er malen/lokal-dev, IKKJE nødvendigvis kva som faktisk er sett i superconfig for `vibeverk.no` i dag, men bør stadfestast at eit sterkt, unikt passord faktisk er sett før dette blir brukt som eit reelt personvern-/tryggingsgrunnlag).
- [ ] `SITE_LOCK_PASSWORD` sin faktiske noverande verdi (uansett historisk placeholder nemnt i `CURRENT_STATE.md`) — irrelevant for GDPR-vurdering direkte, men bør ikkje forvekslast med ein reell tilgangskontroll i noko kundevendt dokument.

---

## 8. Retting av éin feil i det eksisterande malverket

`docs/compliance/data-map-template.md` og `customer-go-live-checklist.md` listar Tidio som ei reell, valfri tredjepartsintegrasjon ("dersom Tidio er PÅSLÅTT..."). Etter grundig kodesøk (`grep -ri tidio` over heile repoet, ekskl. `node_modules`) er konklusjonen: **det finst ingen Tidio-integrasjon i kodebasen i det heile** — verken eit script-tag, ein feature-flag, eller nokon anna wiring. Malen sitt punkt om Tidio bør difor handterast som "ikkje relevant med mindre/før Tidio faktisk blir bygd inn," ikkje som eit "sjekk om det er PÅ"-punkt slik det står i dag. Dette er ikkje retta i sjølve malfilene i dette passet (dei er bevisst generiske reusable maler, sjå `docs/compliance/README.md`) — flagga her i staden, slik at kven som helst som fyller ut malen for ein ny kunde ikkje trur Tidio er eit reelt valg utan først å sjekke om det faktisk er bygd.

---

*Utarbeidd av Privacy and Compliance Advisor (Claude), 2026-07-16. Ikkje juridisk godkjenning. Krev gjennomgang av kvalifisert juridisk rådgjevar før bruk i faktisk kundevendt personvernnotat, DPA eller regulatorisk samanheng.*
