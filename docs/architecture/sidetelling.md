# Sidetelling / "Analyse" — arkitektur

Intern, cookiefri trafikkmåling for den offentlege nettsida — eit gratis alternativ til Plausible for kundar som ikkje har eige Plausible-konto. `module-sidetelling.js` (offentleg side + Web-admin), styrt av eit Console-brytar-panel i `console/console-core.js`. Bygd i fleire rundar frå 2026-07-31 til 2026-08-03 — sjå `docs/project/CHANGELOG.md` (0.78.0–0.84.0) for full, datert historie. Dette dokumentet er ei samla arkitekturoversikt, ikkje ein endringslogg.

## Grunnprinsipp (Fase 2, stadfesta av brukar 2026-08-03, gjeld all vidare utvikling)

1. **Native/gratis** — ingen betalt ekstern teneste.
2. **Ingen API-kall** — ingen eksterne HTTP-kall i det heile, verken frå klient eller server.
3. **Cookiefritt** — session-ID lever i `sessionStorage`, forsvinn ved fane-lukking, aldri ein cookie eller anna varig klientside-identifikator.

Eit forslag som bryt eitt av desse prinsippa (t.d. geolokasjon, som krev anten eit eksternt API-kall eller lagring av IP-adresse) skal **ikkje** byggjast som ein del av denne fasen — sjå "Bevisst ikkje bygd" under.

## Datamodell

`analytics_events` (`supabase/migrations/20260731103651_add_analytics_events.sql`, utvida i `20260803140201_add_analytics_device_bot.sql`):

| Kolonne | Kva | Merknad |
|---|---|---|
| `session_id` | Gruppering av rader til same besøk | `sessionStorage`, ikkje ein unik nøkkel |
| `type` | `pageview` \| `cta` | |
| `path` | Hash-verdi ved hendinga | Sjå "Kva tel som ei visning" under |
| `referrer` | Kun vertsnamn | Aldri full URL/querystring |
| `cta_id` | `tel`\|`mailto`\|`kontakt`\|`tilbud`\|`booking` | |
| `device_type` | `mobil`\|`nettbrett`\|`pc` | Utleia klientsida frå skjermbreidde, IKKJE lagra rå User-Agent |
| `is_bot` | boolean | Enkel regex mot kjende bot-signaturar i User-Agent, ingen ekstern deteksjonsteneste |
| `is_test` | boolean | Syntetiske rader, kun frå `seed_test_pageviews()` (staging-only, sjå eige avsnitt) |

`leads`/`bookings` (`supabase/migrations/20260803142700_add_analytics_session_conversion.sql`): nullbar `analytics_session_id text`-kolonne på begge, ingen FOREIGN KEY (same laus-kopling-mønster som `leads.chat_id` — `analytics_events.session_id` er ein grupperingsnøkkel, ikkje unik, så ein ekte FK er ikkje mogleg).

**Personvernsprinsipp for `device_type`/`is_bot`**: begge er førehandsrekna, kategoriske felt — same mønster som `chat_conversations.browser/os` (`module-chat.js` sin `getBrowserInfo()`) alt bruker. Den rå User-Agent-strengen vert ALDRI lagra server-sida (ho er ein fingerprinting-vektor; ein kategorisk verdi som "mobil"/"pc" er det ikkje).

## Kva tel som ei "ny visning" (og kva som bevisst ikkje gjer det)

Vibeverk-nettsider er typisk éi lang side med seksjonar (Hjem, Om oss, Tenester osb.). Nav-klikk mellom desse er **mjuk scroll** internt i `core.js` sin `bindGlobalNav()` (`history.replaceState()`, utløyser ALDRI `hashchange`) — desse tel bevisst IKKJE som eigne visningar (stadfesta av brukar 2026-08-03).

`module-sidetelling.js` sin `isRealPage()` bruker ei eksplisitt allow-liste (`#booking`, `#aktuelt/alle`, `#sak/*`) i staden for å stole på om nettlesaren tilfeldigvis fell tilbake til ekte hash-navigering (eit reelt, funne og retta inkonsekvens-hòl — sjå 0.80.0-innslaget i CHANGELOG). **Vedlikehaldskopling**: ei ny `page:true`-modul (i dag berre `module-booking.js`) må leggjast til her óg, same kopling som `bindGlobalNav()` sjølv har.

Inngangs-/utgangssider krev ingen eigen fangst-hending — dei er berre fyrste/siste pageview-rad for ein sesjon, ei rein spørring i adminpanelet.

## Fasar

### Fase 1 (0.78.0, 2026-07-31)
Grunnmodul: pageview/CTA-fangst, `insert_analytics_event()` (SECURITY DEFINER, anon EXECUTE), admin-panel i eksisterande Analyse-fane i Web-admin. Køyrer kun når `analytics.plausible` er tom (kunden vel eitt av dei to).

### Console-brytar (0.79.0, 2026-08-03)
`features.sidetelling` av/på per tenant frå Console sin Modular-fane (merkelappen "Analyse" — internt namn/fil uendra, same mønster som Workspace/Intranett-omdøypinga). Fiksa samstundes ein latent `featureDefaults()`-polaritetsbug for opt-in-flagg.

### Panel-utviding (0.80.0, 2026-08-03)
"Oppdater"-knapp, lesbare sidenamn (`PATH_LABELS` + generisk fallback), konsekvent visningsteljing (`isRealPage()`, sjå over), konverteringsrate-KPI, CTA-klikk-per-dag-graf. Bokmål-standardisert kundevendt tekst.

### Fase 2 (0.81.0–0.84.0, 2026-08-03) — Arkitekt-konsultert samla før koding
1. **Steg 1**: `device_type`/`is_bot` (sjå datamodell over).
2. **Steg 2 — "Trender"**: rein periode-mot-periode-samanlikning (siste 7 dagar mot dei 7 før), same "rule-based, ingen AI"-filosofi som `computeWebsiteHealth()` (`docs/architecture/website-health-scoring.md`). Ingen ny spørring — samanlikningsvindauget (14 dagar) er innanfor dei 30 dagane panelet alt hentar.
3. **Steg 3a**: `App.getAnalyticsSessionId()` i `core.js` — session-ID-generering flytta ut av `module-sidetelling.js` sjølv, sidan Kontakt-/Tilbod-/Booking-skjemaa fungerer heilt uavhengig av om `features.sidetelling` er på/av, og treng tilgang til same ID for steg 3b. Returnerer `null` når funksjonen er av.
4. **Steg 3b — konverteringskobling**: `leads`/`bookings.analytics_session_id`, kopla mot inngangsside i adminpanelet ("Henvendelser fra disse sidene"). Sjå "Ope juridisk spørsmål" under.

## Ope juridisk spørsmål (må avklarast før nokon reell kunde, sjå ROADMAP.md)

Privacy Advisor-gjennomgangen av steg 3b (2026-08-03, obligatorisk før deploy sidan dette koplar analysedata mot ekte persondata) fann **ikkje ein teknisk feil, men eit ope juridisk spørsmål**: for sesjonar som faktisk konverterer (sender eit skjema), skapar koplinga ein indirekte veg frå elles anonyme pageview-rader til ein namngjeven person (via lead/booking sine kontaktopplysningar). Om dette framleis er dekt av same unntak sidetellinga sjølv byggjer på (ekomlova §3-1-typen argumentasjon for anonym, ikkje-sporande trafikkmåling), eller om det krev eit sterkare/anna rettsleg grunnlag, kan ikkje avgjerast av kodegjennomgang åleine — krev kvalifisert juridisk rådgivar.

Deployert til produksjon 2026-08-03 likevel (brukarval) sidan ingen ekte kundar er påverka i dag (kun Vibeverk sjølv og Sunnvask-demo). Sjå `docs/roadmap/ROADMAP.md` "Next" for det fulle, eksplisitte "MÅ AVKLARAST FØR NOKON EKTE KUNDE"-punktet, inkludert tilrådinga om å skilje konverteringskoblinga ut i sitt eige feature-flagg og oppdatere personvernsteksten (utkast finst, ikkje juridisk kvalitetssikra).

**Verifisert trygt i implementasjonen sjølv**: `analytics_session_id` er bevisst haldt utanfor `dbLeadToJs`/`dbBookingToJs` sine kvitelister — vert ALDRI vist i Web-admin sitt UI, CSV- eller JSON-eksport. GDPR-sletting av ein lead/booking slettar heile rada, inkludert kolonna, automatisk.

## Bevisst ikkje bygd (bryt eitt av dei tre grunnprinsippa, eller vurdert og avvist av andre grunnar)

- **Geolokasjon**: krev anten eit eksternt API-kall eller lagring av IP-adresse — bryt prinsipp 2 (og den eksisterande "vi lagrar ikkje IP"-lovnaden) uansett vinkling. Målgruppa (lokale SMB-kundar) har heller ikkje eit reelt behov.
- **Workspace-analyse**: anna bruksområde (intern bruksstatistikk for tilsette), ikkje prioritert.
- **Seksjon/skrolldjupne ved avreise**: vurdert og avvist 2026-08-03 — krev anten mange fleire skriv per visning eller ein sendBeacon/pagehide-mekanisme (alt forkasta éin gong i Fase 1 av kostnad/nytte-grunnar), og nøyaktigheita er tvilsam på tvers av skjermstorleikar.
- **"AI-oppsummering"**: bygd som rule-based "Trendar" i staden (sjå Fase 2 steg 2) — ingen ekte AI/eksternt kall, i tråd med prinsipp 2.

## Utsett, ikkje avvist

- **Fase 2.5 — unike besøkjande**: teknisk mogleg utan å bryte prinsippa (Postgres sin eigen `inet_client_addr()` + ein dagleg roterande salta hash, aldri lagra rå IP — same metode Plausible sjølv brukar), men krev skjemaendring + justering av personvernsteksten. Eige, seinare delprosjekt, ikkje del av denne Fase 2-runda.
- **Fase 3**: rollup-tabell (reint teknisk optimalisering, ingen prinsipp-konflikt, berre ikkje urgent med dagens datamengde), CMS-per-side-widget (ingen ny datainnsamling, berre ei anna visning av data som alt finst).

## `seed_test_pageviews()` — kjent, ikkje-fungerande mekanisme

Den staging-only testdata-generatoren (`supabase/staging-only/seed_test_pageviews.sql`) har eit fail-closed-gjerde via ein eigendefinert Postgres-GUC (`app.settings.is_staging`). Stadfesta 2026-08-03: denne GUC-en **kan ikkje settast på noko Supabase-hosta prosjekt** — krev superbrukar-rettar Supabase aldri gjev ut (`ALTER DATABASE`/`ALTER ROLE ... SET` for ein eigendefinert parameter krev superuser i vanleg PostgreSQL). Knappen har difor truleg aldri fungert, uansett prosjekt. Sjå `docs/roadmap/ROADMAP.md` "Later" for skisse til fiks (byt GUC-sjekken ut med ein rad i `store`-tabellen i staden).
