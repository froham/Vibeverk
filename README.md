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
├── test.js                 # Testsuiten for den offentlige siden
├── test-intranet.js        # Testsuiten for intranettet (rot-kopi)
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
- **LocalStorage** — all data lagres lokalt via `App.store` / `App.media` (Supabase-klar)
- **Hash-ruting** — `#seksjon`, `#sak/<id>`, `#admin` — ingen server-side ruting nødvendig
- **Tabler Icons** (CDN) og **Google Fonts** (fra `config.js`) er eneste eksterne avhengigheter
- **GitHub Pages** — deployment via GitHub Actions

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

---

## Testoppsett

Testene kjøres med Node og krever [jsdom](https://github.com/jsdom/jsdom):

```bash
npm install          # installerer jsdom (eneste avhengighet)
node test.js         # tester den offentlige siden (398 tester)
node test-intranet.js  # tester intranettet (62 tester)
```

Alle tester skal gi **0 FEIL**. Én pre-eksisterende feil (`o3: workspaceship via direkterute`) er kjent og akseptert.

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

// Bilder og filer (skaleres ned, base64 i localStorage)
App.media.put(file)         // → Promise<dataUrl>
App.media.putFile(file)     // → Promise<{ name, type, data }>
App.media.resolveImage(url) // håndterer både eksterne URL-er og lagrede data-URL-er
App.media.free(url)         // sletter et lagret bilde
```

Bytting til Supabase (steg 6 i roadmap) krever kun endringer i `App.store` og `App.media` — all modulkode forblir uendret.

---

## Konfigurasjon (`config.js`)

`config.js` er den **eneste filen som endres per kunde**. Den inneholder:

| Nøkkel | Beskrivelse |
|--------|-------------|
| `company` | Firmanavn, slagord, beskrivelse |
| `colors` | Primær- og sekundærfarger, bakgrunn, tekst |
| `fonts` | Google Fonts-familie for overskrift og brødtekst |
| `contact` | Adresse, telefon, e-post, åpningstider, sosiale lenker |
| `admin.password` | Admin-passord (klient-side, ikke produksjonssikkerhet) |
| `storageKey` | Unik nøkkel for localStorage-namespace (aldri endre etter oppstart) |
| `features` | Feature-flagg (av/på per funksjon) |
| `locale` | Språkinnstilling (`no` / `en`) — separat for nettside og intranett |
| `modules` | Aktiverte moduler og deres konfigurasjon |

Passordet og andre sensitive verdier skal **aldri** committes til et offentlig repo.

---

## Deployering

1. Push til `main`-grenen på GitHub.
2. GitHub Actions bygger og deployer automatisk til **GitHub Pages**.
3. DNS-peker (A-record / CNAME) settes opp via **Domeneshop** mot GitHub Pages sin IP.
4. HTTPS håndteres av GitHub Pages (Let's Encrypt).

Ingen byggsteg eller CI/CD-konfigurasjon utover `.github/workflows/`-filen.

---

## Kjente begrensninger

| Begrensning | Forklaring |
|-------------|------------|
| **LocalStorage ~5 MB** | Bilder skaleres ned automatisk; store filer bør lagres eksternt |
| **Ingen ekte auth** | Admin-passordet er klient-side og gir ikke reell tilgangskontroll |
| **Single-tenant** | Én `config.js` per deployment; ingen felles database ennå |
| **Ingen realtime** | Chat og dashboard poller ikke; siden må lastes på nytt for nye meldinger |
| **Ingen RLS** | Alle brukere med passordet har full lesetilgang til localStorage |

Alle disse begrensningene løses i **steg 6 (Supabase-migrering)**.

---

## Roadmap

| Steg | Status | Innhold |
|------|--------|---------|
| 1 — Kjernefunksjonalitet | ✅ Ferdig | Nettside, intranett, admin, chat, superadmin |
| 2 — Evaluering | ⏳ Pågår | Test på ekte kundesituasjon, friksjonspunkter |
| 3 — Kodeopprydding | 🔄 Pågår | console.log, CSS-duplikater, README, i18n |
| 4 — Backup-gjennomgang | ⏳ | Verifiser alle moduler i backup, kunde-admin-tilgang |
| 5 — Tilgangsstyring | ⏳ | Roller: Eier / Admin / Medlem, tilgangsmatrise |
| 6 — Supabase-migrering | ⏳ | Database, auth, RLS, realtime |
| 7 — Kundedokumentasjon | ⏳ | Kontrakt, DPA (GDPR), brukerguide |
| 8 — Teknisk dokumentasjon | ⏳ | Arkitektur, onboarding, migreringsdokument |
| 9 — Kvalitetssjekkar | ⏳ | Cross-device, WCAG, Lighthouse, sikkerhet |
| 10 — AI-native chat | 🔜 | RAG, Claude API, pgvector, hybrid operator/AI |

Se `VIBEVERK-ROADMAP.MD` for detaljert beskrivelse av hvert steg.
