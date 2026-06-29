# Vibeverk — Produksjonsroadmap

*Sist oppdatert: Juni 2026*

> **OBS:** Dette er planleggingsmateriell. Fullførte punkt beskriv kva som vart planlagt gjort; verifiser faktisk åtferd ved å lese koden. Framtidige punkt er ikkje bindande tidsliner.

---

## Steg 1 — Kundeklarfunksjonalitet ✅
*Fullført*
All kjernefunksjonalitet ferdig og testa:
- Nettside med alle modular (Booking, Tilbud, Kontakt, KB, CRM, Aktuelt, Mediebank, FAQ, Referansar, Banner)
- Arbeidsområde (Intranett) med Dashboard, Oppgåver, Notatar, Aktuelt, KB, OrgDrift, CRM, Mediebank, Lenker
- Admin-panel (web) med Innhald, Henvendelser, Innstillinger
- Native Chat (widget + admin, localStorage-demo)
- Superadmin med funksjonsstyring per kunde

## Steg 2 — Evaluering ✅
- Test på ekte kundesituasjon
- Identifisert friksjonspunkt
- Prioritert og gjennomført rettingar (chat, CRM, Spaceship, status-flyt)

## Steg 3 — Kodeopprydding ✅
*Fullført juni 2026*
- Fjerna alle `console.warn` i `registerModule` (core.js og intranet-core.js)
- Ingen kommentert-ut kode funne
- README.md skrive om frå grunnen — profesjonell og fullstendig dokumentasjon
- 15 nynorske UI-strenger normalisert til bokmål over 7 filer (sjå 3b)
- Testar: 398/0 og 61/1 (1 pre-eksisterande feil) — ingen funksjonalitet endra

## Steg 3b — Språk / i18n (norsk bokmål) ✅
*Fullført juni 2026 — gjort som del av steg 3*

### Gjort
- Kartlagt og normalisert 15 hardkoda nynorsk-strenger til bokmål i alle `module-*.js` og `intranet/module-*.js`
- Berørte filer: `core.js`, `module-chat.js`, `module-crm.js`, `module-scrollbanner.js`, `intranet/module-crm.js`, `intranet/module-tasks.js`, `intranet/module-mediabank-internal.js`

### Framleis ope (seinare steg)
Fullstendig i18n-infrastruktur (engelsk støtte) er utsett til etter Supabase-migrering:
- `t()`-funksjon og `STRINGS`-objekt med norsk/engelsk
- Superadmin-bryter for språk per kunde
- Estimert 1–2 dagars arbeid når kodebasen er stabil på Supabase

---

## Steg 4 — Backup-gjennomgang ✅
*Fullført juni 2026*
- Avdekka og fiksa kritisk gap: `Chat.store` brukte rå localStorage utan NS-prefiks → chat-data var ikkje inkludert i backup. Fiksa ved å innføre `_CHAT_NS`-prefiks slik at alle chat-nøklar ligg under same navnerom som resten av appen
- Verifisert at alle modular (booking, CRM, referansar, FAQ, mediebank, chat) er inkludert i `buildBackupPayload()` — den namespace-baserte tilnærminga fangar automatisk opp alt framtidig
- Backup er tilgjengeleg for kunde-admin (`adminBackupCustomer`) — allereie på plass
- Backup-summaren viser no chat-samtaleantal (både superadmin og kunde-admin)
- Lagt til «Chat (JSON)»-knapp i per-modul-eksport
- Restore-funksjon (`restoreBackupData`) verifisert: slettar eksisterande NS-nøklar og skriv alt tilbake — testar bekreftar full overskriving

## Steg 5 — Tilgangsstyring-planlegging ✅
*Arkitektur avklart og fundament lagt juni 2026*
- Éin Supabase-prosjekt per kunde (full dataisolasjon, enkel onboarding)
- `supabase/migration.sql` — køyrast éin gong per ny kunde, set opp alle tabellar, RLS og Realtime
- `users`-tabell kobla til Supabase Auth via trigger (auto-oppretting ved signup)
- Rolle (`owner`/`admin`/`member`) lagra i `users`-tabell, ikkje user_metadata
- `is_admin_or_owner()` RLS-hjelp-funksjon implementert
- Notatar: RLS `user_id = auth.uid()` — private per brukar
- Oppgåver: alle les, admin/owner skriv/tildeler, tildelt brukar kan oppdatere status
- core.js les rolle frå `users`-tabell etter innlogging

## Steg 5b — Modulmigrering til Supabase ⏳

### Intranett-auth ✅ (juni 2026)
- `window.App.supabase` eksponert frå core.js (delt klient)
- Intranett brukar Supabase Auth (e-post + passord) — ikkje config-passord
- `boot()` sjekkar Supabase-session ved oppstart (persistent login på tvers av sidelaster)
- Logout kallar `_sb.auth.signOut()`
- Brukarnamn og rolle hentast frå `users`-tabellen
- Fallback til config-passord i testmiljø (utan Supabase)

### Modulmigrering ✅ (juni 2026)
Tre roller: Eigar / Admin / Medlem
- [x] Notatar → `notes`-tabell (per-brukar RLS, eingongs-migrering frå localStorage) ✅
- [x] Lenker → `links`-tabell (description, icon, kategori, admin-berre skriv) ✅
- [x] Annonsering → `announcements`-tabell (important, image, attachments jsonb) ✅
- [x] Kunnskapsbase → `kb_articles`-tabell (tags, summary, published, kategori) ✅
- [x] Oppgåver → `tasks`-tabell (assigned_to UUID frå users, status-select, modal) ✅
- [ ] Brukaradministrasjon-UI for Eigar (invitasjon via Edge Function) — neste
- Maks 50 brukarar per kunde

## Steg 6 — Supabase-migrering 🔑
*Nøkkelen som låser opp alt vidare*

### 6a — Grunnoppsett ✅
*Fullført juni 2026*
- Supabase-prosjekt oppretta (clzczbyklgdtdhgjphup)
- `store`-tabell oppretta med RLS og open anon-policy (tettast i 6c)
- Write-through sync: `Store.set/remove` skriv til Supabase (300ms debounced) samstundes som localStorage
- `hydrateFromSupabase()` klar til bruk ved innlogging (6b)
- CSP oppdatert for Supabase CDN og API-endepunkt
- Testar: 398/0 — ingen regression

### 6b — Auth ✅
*Fullført juni 2026*
- Admin-innlogging bruker no Supabase Auth (e-post + passord per brukar)
- Rolle hentast frå `user_metadata.role` — defaultar til "owner" om ikkje sett
- `onAuthStateChange` held sessionStorage synkronisert med Supabase-session
- Utlogging kallar `_sb.auth.signOut()` og ryddar session
- `hydrateFromSupabase()` vert kalla etter vellykka innlogging
- Fallback til config-passord i testmiljø (utan Supabase) — testar: 398/0

### 6c — RLS ✅
*Fullført juni 2026*
- Open `anon_all`-policy fjerna frå `store`-tabellen
- Ny `auth_only`-policy: berre `authenticated`-rolla kan lese/skrive
- Offentlege besøkande har null tilgang til databasen
- Skriving til Supabase skjer berre når admin er innlogga (Bearer JWT i alle requests)
- Tenant-isolasjon (per kunde) kjem ved fleire kundar

### 6d — Realtime
- Bytte polling i Chat med Supabase Realtime
- Oppdatere Dashboard med live-teljing

## Steg 7 — Kundedokumentasjon / Kontrakt / DPA ⏳
- Standardkontrakt for Vibeverk-kundar
- Databehandlaravtale (DPA) — GDPR-krav
- Informere om localStorage-avgrensingar i demo-fase
- Brukarrettleiing for admin-panel og arbeidsområde

## Steg 8 — Intern teknisk dokumentasjon ⏳
- Arkitekturdokument (modulsystem, lagringsabstraksjon, deploy-flyt)
- Onboarding-guide for nye Vibeverk-kundar (kva config.js-verdiar som skal endrast)
- Supabase-migreringsdokument per modul

## Steg 9 — Kvalitetssjekkar ⏳
- Full gjennomgang av alle modular
- Cross-device testing (desktop, mobil, nettbrett)
- Tilgjengelegheit (WCAG)
- Ytingstest (Lighthouse)
- Sikkerheitsgjennomgang

---

## Steg 10 — AI-native Chat 🤖
*Mogleg etter Supabase er på plass (steg 6)*

### Kva det er
Ein AI-assistent bygd inn i den native chat-løysinga. Kundar får automatiske,
relevante svar basert på verksemda sitt eige innhald. Menneske kan gripe inn.

### Arkitektur
```
Kunde skriv → Supabase Edge Function → Claude API → Svar til kunde
                      ↑
        Kunnskapsbase + FAQ + CRM + Booking (RAG)
```

### Funksjonar
- **RAG (Retrieval-Augmented Generation)** — AI-en finn relevante KB-artiklar
  via pgvector (innebygd i Supabase) og svarar basert på desse
- **CRM-kontekst** — AI-en veit kven kunden er og kva historikk dei har
- **Booking-integrasjon** — kan foreslå ledige tider direkte i samtalen
- **Hybrid-modus** — AI svarar fyrst, admin kan overta når som helst
- **Usikker-flagging** — AI markerer saker den ikkje er sikker på
  → admin prioriterer desse

### Forretningsmodell
```
Basis:   Manuell chat (allereie bygd ✅)
Pro:     AI-assistent basert på KB og FAQ
Premium: Full AI-agent med CRM + Booking-integrasjon
```

### Kvifor Vibeverk har eit fortrinn
Alle datakjeldene ligg på same stad: KB, CRM, FAQ, Booking.
Dei fleste konkurrentar har ikkje denne integrasjonen.

### Teknisk status
| Komponent | Status |
|-----------|--------|
| Chat-widget og admin | ✅ Bygd |
| KB-modul | ✅ Bygd |
| CRM | ✅ Bygd |
| FAQ | ✅ Bygd |
| Supabase | ⏳ Steg 6 |
| Edge Functions (proxy) | ⏳ Steg 6 |
| Claude API-integrasjon | 🔜 Etter steg 6 |
| pgvector/embeddings | 🔜 Etter steg 6 |

*Estimert arbeid etter Supabase: 3–5 dagar*

---

## Avhengigheitskjede

```
Steg 6 (Supabase)
    ├── Steg 5 (Tilgangsstyring — implementering)
    ├── Native Chat cross-device
    └── Steg 10 (AI-chat)
            ├── RAG / pgvector
            ├── Claude API-integrasjon
            └── Hybrid operator/AI-modus
```

---

*Vibeverk er per juni 2026 ~70% av vegen mot ein fullstack AI-driven SaaS-plattform for norske småbedrifter.*
