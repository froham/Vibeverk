# Vibeverk

**Business OS for norske småbedrifter** — én kodebase, mange kunder.

Vibeverk er en modulær webplattform som kombinerer en offentlig bedriftsside med et internt arbeidsområde (intranett). All kundespesifikk konfigurasjon bor i `config.js`; selve plattformen røres ikke per kunde.

---

## Mappestruktur

```
Vibeverk/
├── index.html              # Offentlig bedriftsside (skjelett + CSS-variabler)
├── config.js               # Kundekonfigurasjon (farger, tekster, passord, funksjoner)
├── core.js                 # Kjernemotor: ruting, admin, lagring, modulregister
├── components.js           # Gjenbrukbare HTML-komponenter (knapper, felt, kort, ikoner)
├── module-booking.js       # Bookingmodul (ressurser, kalender, forespørsler)
├── module-chat.js          # Native chat (widget for besøkende + admin-panel)
├── module-crm.js           # CRM (kundekort, historikk, GDPR-sletting)
├── module-faq.js           # FAQ-seksjon
├── module-mediabank.js     # Offentlig mediebank
├── module-quote.js         # Tilbudsforespørsel
├── module-references.js    # Referanser / kundeuttalelser
├── module-scrollbanner.js  # Scrollbanner-seksjon
├── module-users.js         # Brukeradministrasjon (invite/remove/rolle via Edge Function)
├── test.js                 # Testsuiten for den offentlige siden
├── test-intranet.js        # Testsuiten for intranettet (rot-kopi)
│
├── supabase/
│   ├── migration.sql               # Idempotent migrering — kjøres i Supabase SQL Editor
│   └── functions/manage-user/
│       └── index.ts                # Edge Function: invite + remove bruker (service_role)
│
└── intranet/
    ├── index.html              # Arbeidsområde (intranett)
    ├── intranet-core.js        # Intranett-motor: ruting, auth, modulregister, aktivitetslogg
    ├── module-announcements.js # Aktuelt (intern)
    ├── module-booking.js       # Booking-administrasjon
    ├── module-contact.js       # Henvendelser / tilbud / leads (intern visning)
    ├── module-crm.js           # CRM (intern)
    ├── module-dashboard.js     # Dashboard med statistikk og aktivitetslogg
    ├── module-kb.js            # Kunnskapsbase
    ├── module-links.js         # Lenkesamling med Tabler-ikoner
    ├── module-mediabank-internal.js  # Intern mediebank
    ├── module-notes.js         # Personlige notater
    ├── module-orgdrift.js      # Organisasjonsdrift (leverandører, systemer, HMS)
    ├── module-quote.js         # Tilbudsbehandling
    ├── module-settings.js      # Innstillinger (tema, språk, tilbakestilling)
    ├── module-tasks.js         # Oppgaveliste
    └── test-intranet.js        # Testsuiten for intranettet
```

---

## Teknisk stack

- **Vanilla JS** — ingen rammeverk, ingen byggsteg, ingen pakkebehandler
- **IIFE-moduler** — hvert `module-*.js` er en selvforsynt IIFE; ingen ES-moduler
- **Supabase** — database (PostgreSQL), auth (e-post + passord), Realtime (chat), Storage (media)
- **LocalStorage** — brukes som write-through cache; synkroniseres mot Supabase ved innlogging
- **Hash-ruting** — `#seksjon`, `#sak/<id>`, `#admin` — ingen server-side ruting nødvendig
- **Tabler Icons** (CDN) og **Google Fonts** (fra `config.js`) er eneste eksterne avhengigheter
- **GitHub Pages** — deployment via GitHub Actions

---

## Brukerstruktur og roller

Vibeverk opererer med to separate brukerlag:

### Superadmin (Vibeverk-plattform)
Kun for Vibeverk-operatøren. Tilgang via OTP-innlogging (8-sifret kode sendt på e-post) fra Supabase Magic Link. Åpnes via skjult trippelklikk-meny på nettsiden (`#admin`-panelet). Brukerens e-post verifiseres mot `owner`-rollen i `users`-tabellen.

### Kundebrukere (intranett)
Alle kundeansatte logger inn med e-post + passord via Supabase. Rollen hentes fra `public.users`-tabellen etter autentisering.

| Rolle | Hvem | Tilgang |
|-------|------|---------|
| `owner` | Bedriftseier (én per tenant) | Full tilgang: alt inkl. backup, brukeradmin, innstillinger |
| `admin` | Utpekt ansattadmin | Nær full tilgang; kan ikke endre owner eller slette seg selv |
| `editor` | Redaktør | Kan opprette og redigere innhold (artikler, KB, lenker, oppgaver) |
| `member` | Vanlig ansatt | Les alt, egne notater, kan oppdatere tildelte oppgaver |

Maks **50 brukere per tenant** (håndhevet av Edge Function).

Rollen lagres i `sessionStorage` etter innlogging og synkroniseres av `onAuthStateChange` i `core.js`. `getAuthRole()` leses derfra av admin-panelet for å styre hvilke faner og funksjoner som vises.

### Invitasjonsflyt
1. Owner/admin fyller inn e-post og rolle i *Innstillinger → Brukere*
2. `module-users.js` kaller Edge Function `manage-user` med `action: "invite"`
3. Edge Function verifiserer kallerens rolle mot `users`-tabellen (service_role-nøkkel)
4. Supabase sender invitasjonslenke til den nye brukeren
5. Brukeren setter passord via lenken og får tilgang

Fjerning skjer tilsvarende med `action: "remove"`.

---

## Sikkerhet

### Database (Supabase RLS)
Row Level Security er aktivert på alle tabeller. To hjelpefunksjoner i databasen:

```sql
is_admin_or_owner()   -- owner og admin
can_edit_content()    -- owner, admin og editor
```

| Tabell | Lese | Skrive |
|--------|------|--------|
| `store` | Alle innloggede | Alle innloggede |
| `users` | Alle innloggede | Selv (eget profil), admin/owner (alle) |
| `notes` | Kun egen bruker | Kun egen bruker |
| `tasks` | Alle innloggede | editor+ (opprette/slette), tildelt bruker (oppdatere status) |
| `announcements` | Alle innloggede | editor+ |
| `kb_articles` | Alle innloggede | editor+ |
| `links` | Alle innloggede | editor+ |
| `chat_conversations` | Alle (inkl. anon) | Anon: INSERT, autentisert: ALL |
| `chat_messages` | Alle (inkl. anon) | Anon: INSERT, autentisert: ALL |

### Edge Function (`manage-user`)
- Kjøres server-side i Deno med Supabase service_role-nøkkel — aldri eksponert til klient
- Verifiserer at kalleren har gyldig JWT og er `owner` eller `admin` før handling utføres
- Blokkerer selvsletting
- Håndhever maks 50 brukere per tenant

### Superadmin OTP
- Krever gyldig Supabase-konto med `role = 'owner'` i `users`-tabellen
- 8-sifret OTP sendes per e-post; verifiseres av `_sb.auth.verifyOtp()`
- Etter verifisering sjekkes rollen på nytt mot databasen — et gyldig token uten riktig rolle gir ikke tilgang

### Klientsideadmin (`config.js`)
Admin-panelet på nettsiden er beskyttet av passord fra `config.js`. Dette er **ikke** produksjonssikkerhet — passordet er synlig i kildekoden. Det er ment som en enkel skranke, ikke tilgangskontroll. For reell tilgangskontroll brukes Supabase-autentisering (intranettet).

### Anbefalinger for produksjon
- `config.js` skal **ikke** inneholde sensitive verdier i offentlig repo
- Supabase `anon`-nøkkel er trygg å eksponere (RLS beskytter data)
- Service_role-nøkkel eksponeres **aldri** til klient — kun i Edge Function via miljøvariabel
- Chat-tabellene tillater anonym skriving — dette er bevisst for besøkende-chat, men bør overvåkes

---

## Kjøre lokalt

Åpne `index.html` direkte i nettleseren — **ikke** via `file://` (localStorage krever HTTP-kontekst). Bruk en enkel lokal server:

```bash
# Python (innebygd)
python -m http.server 8080

# Node (npx)
npx serve .
```

Gå til `http://localhost:8080`. Intranettet er tilgjengelig på `http://localhost:8080/intranet/`.

Uten Supabase-konfigurasjon i `config.js` faller systemet tilbake til passord fra `config.js` og localStorage.

---

## Testoppsett

Testene kjøres med Node og krever [jsdom](https://github.com/jsdom/jsdom):

```bash
npm install          # installerer jsdom (eneste avhengighet)
node test.js         # tester den offentlige siden
node test-intranet.js  # tester intranettet
```

Alle tester skal gi **0 FEIL**.

---

## Modularkitektur

### Offentlig side

```js
App.registerModule({
  id:         "booking",
  label:      "Booking",
  order:      45,            // plassering i toppmeny og admin
  page:       true,          // egen side på #booking (utelat for inline-seksjon)
  inline:     false,         // vis også på forsiden (kombineres med page: true)
  render:     () => `<section>…</section>`,   // forsiden
  renderPage: (root) => {},  // kjøres når #booking er aktiv
  mount:      (root) => {},  // kjøres etter innsetting
  admin: {
    label:  "Booking",
    render: () => `…`,
    mount:  (body) => {}
  }
});
```

### Intranett

```js
Intranet.registerModule({
  id:     "tasks",
  label:  "Oppgaver",
  icon:   "checklist",
  order:  20,
  render: (root) => {}   // kalt med container-elementet
});
```

---

## Lagringslag

```js
// Lese og skrive (namespacet per kunde via config.storageKey)
App.store.get("nøkkel", standardverdi)
App.store.set("nøkkel", verdi)
App.store.remove("nøkkel")

// Bilder og filer — Supabase Storage (public bucket "media", maks 20 MB/fil)
App.media.put(file)         // → Promise<publicUrl>
App.media.putFile(file)     // → Promise<{ name, type, data }>
App.media.resolveImage(url) // håndterer både eksterne URL-er og Supabase-URL-er
App.media.free(url)         // sletter et lagret bilde
```

Skrive-gjennom til Supabase skjer automatisk. Hydratering (`hydrateFromSupabase()`) kjøres ved innlogging.

---

## Konfigurasjon (`config.js`)

`config.js` er den **eneste filen som endres per kunde**. Den inneholder:

| Nøkkel | Beskrivelse |
|--------|-------------|
| `company` | Firmanavn, slagord, beskrivelse |
| `colors` | Primær- og sekundærfarger, bakgrunn, tekst |
| `fonts` | Google Fonts-familie for overskrift og brødtekst |
| `contact` | Adresse, telefon, e-post, åpningstider, sosiale lenker |
| `admin.password` | Admin-passord for nettsiden (klient-side, ikke produksjonssikkerhet) |
| `storageKey` | Unik nøkkel for localStorage-namespace (aldri endre etter oppstart) |
| `supabase.url` | Supabase-prosjekt-URL |
| `supabase.anonKey` | Supabase anon-nøkkel (trygg å eksponere; RLS beskytter data) |
| `features` | Feature-flagg (av/på per funksjon) |
| `locale` | Språkinnstilling (`no` / `en`) |
| `modules` | Aktiverte moduler og deres konfigurasjon |

---

## Deployering

### Nettside
1. Push til `main`-grenen på GitHub.
2. GitHub Actions deployer automatisk til **GitHub Pages**.
3. DNS-peker (A-record / CNAME) settes via **Domeneshop** mot GitHub Pages.
4. HTTPS håndteres av GitHub Pages (Let's Encrypt).

### Supabase (én gang per kunde)
1. Opprett nytt Supabase-prosjekt (én per kunde).
2. Kjør `supabase/migration.sql` i **SQL Editor** — idempotent, trygt å kjøre på nytt.
3. Deploy Edge Function: `supabase functions deploy manage-user`
4. Sett `supabase.url` og `supabase.anonKey` i `config.js`.
5. Opprett første `owner`-bruker manuelt i Supabase Authentication, og sett `role = 'owner'` i `users`-tabellen.

---

## Roadmap

| Steg | Status | Innhold |
|------|--------|---------|
| 1 — Kjernefunksjonalitet | ✅ | Nettside, intranett, admin, chat, superadmin |
| 2 — Evaluering | ✅ | Test på ekte kundesituasjon |
| 3 — Kodeopprydding | ✅ | CSS-duplikater, i18n, README |
| 4 — Backup-gjennomgang | ✅ | Alle moduler i backup, per-modul-eksport |
| 5a — Tilgangsstyring (RLS) | ✅ | Roller: owner/admin/editor/member, RLS-policiar |
| 5b — Brukeradministrasjon UI | ✅ | `module-users.js`, Edge Function invite/remove |
| 6a — Supabase store | ✅ | Write-through, hydratering ved innlogging |
| 6b — Intranett-moduler | ✅ | Notes, tasks, announcements, KB, links i Supabase |
| 6c — Store write-through | ✅ | Alle store-metodar skriv til Supabase |
| 6d — Chat Realtime | ✅ | Supabase Realtime for besøkende og admin |
| 7 — Kundedokumentasjon | ⏳ | Kontrakt, DPA (GDPR), brukerguide |
| 8 — Betalingsintegrasjon | ⏳ | Stripe eller tilsvarende |
| 9 — Statistikk / rapportar | ⏳ | Dashboard-rapportar, eksport |
| 10 — AI-native chat | 🔜 | RAG, Claude API, pgvector (ad hoc seinare) |
