# Vibeverk

**Business OS for norske småbedrifter** — én kodebase, mange kunder.

Vibeverk er ein modulær plattform som kombinerer ei offentleg bedriftsside med eit internt arbeidsområde (Workspace). Kvar kunde køyrer på sin eigen, isolerte Supabase-database (dataplan), styrt frå eit sentralt operatørverktøy (Vibeverk Console) mot ein separat kontrollplan-database. Fram til 2026-07-07 var dette éin-kunde-per-repo-fork; sidan då er det éin delt kodebase for alle kundar — sjå `docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md` og `ADR-0008-control-plane-data-plane-split.md`.

---

## Mappestruktur

```
Vibeverk/
├── index.html              # Offentleg bedriftsside (skjelett + CSS-variablar)
├── config.js               # Kunde-/lokal-konfigurasjon (farger, tekster, passord, funksjoner)
├── core.js                 # Kjernemotor: ruting, admin, lagring, modulregister
├── components.js           # Gjenbrukbare HTML-komponentar (knappar, felt, kort, ikon)
├── module-booking.js       # Bookingmodul (ressursar, kalender, forespørslar)
├── module-chat.js          # Native chat (widget for besøkjande + admin-panel)
├── module-crm.js           # Mini-CRM (kundekort, tidslinje for e-post/chat/notat, GDPR-sletting)
├── module-faq.js           # FAQ-seksjon
├── module-mediabank.js     # Offentleg mediebank
├── module-quote.js         # Tilbodsførespurnad
├── module-references.js    # Referansar / kundeuttalelser
├── module-scrollbanner.js  # Scrollbanner-seksjon
├── module-users.js         # Brukaradministrasjon (invite/remove/rolle via Edge Function)
├── template-klassisk.js    # Design-mal (standard), template-panorama.js, template-scrollstory.js
│                           #   — sjølvbeteningsdesign bak features.sidebygger, sjå docs/roadmap/ROADMAP.md
├── middleware.js            # Vercel Routing Middleware — løyser hostname → tenant (må heite .js, aldri .mjs)
├── api/
│   └── tenant-config.js     # Vercel-funksjon: genererer /config.js per tenant frå kontrollplanet
├── test.js                  # Testsuite for den offentlege sida
├── test-workspace.js        # Testsuite for Workspace
│
├── workspace/                # Arbeidsområde (Workspace), omdøypt 2026-07-07 frå intranet/
│   ├── index.html
│   ├── workspace-core.js         # Motor: ruting, auth, modulregister, aktivitetslogg
│   ├── module-dashboard.js       # Dashboard med statistikk og aktivitetslogg
│   ├── module-announcements.js   # Aktuelt (intern)
│   ├── module-tasks.js           # Oppgåveliste
│   ├── module-notes.js           # Personlege notat
│   ├── module-kb.js              # Kunnskapsbase
│   ├── module-links.js           # Lenkjesamling
│   ├── module-orgdrift.js        # Organisasjonsdrift (leverandørar, system, HMS)
│   ├── module-contact.js         # Henvendelser / tilbod / leads (intern visning)
│   ├── module-booking.js         # Booking-administrasjon
│   ├── module-quote.js           # Tilbodsbehandling
│   ├── module-mediabank-internal.js  # Intern mediebank
│   ├── module-users.js           # Brukaradministrasjon (Workspace-si utgåve)
│   └── module-settings.js        # Innstillingar (tema, språk, tilbakestilling)
│
├── console/                  # Vibeverk Operator Console — sjå eige avsnitt under
│   ├── index.html
│   └── console-core.js
│
├── intranet/index.html      # Bevisst att-lete omdirigeringssnubbe til /workspace/ (GitHub Pages har
│                             #   ingen server-side redirect) — ikkje ein aktiv del av produktet
│
├── supabase/                 # Kunde-/dataplan-databasen (éin per kunde, same skjema for alle)
│   ├── migrations/            # Ekte, CLI-deployerbare migrasjonar (`npx supabase db push`), sidan 2026-07-07
│   ├── migration.sql          # SUPERSEDERT — frose snapshot pr. 2026-07-07-baseline, ikkje oppdatert vidare
│   ├── hotfix_*.sql            # Historiske målretta fiksar, alle innfelte i baseline-migrasjonen
│   └── functions/
│       ├── manage-user/         # Invite/fjern Workspace-brukar (service_role)
│       ├── send-reply/          # Utgåande transaksjons-e-post (Resend)
│       ├── inbound-email/       # Innkomande e-post → Kontakt-lead/CRM-tidslinje (DKIM/SPF-verifisert)
│       └── anon-media-upload-token/  # Kvotestyrt opplastingstoken for anonyme vedlegg
│
└── supabase-control/          # Kontrollplanet — SEPARAT Supabase-prosjekt (tenant-register, operatørar)
    └── supabase/
        ├── migrations/
        └── functions/
            ├── tenant-admin/     # Onboarding/provisjonering (superadmin-gata)
            ├── broker/           # Console sin daglege konfig-lese/skrive-veg (audit-logga)
            └── broker-ping/      # Reint mekanismebevis, ingen sideeffekt
```

---

## Tre leveringsflater

### 1. Offentleg nettside (`/`)
Kundevendt marknadsførings- og verktøyside — booking, tilbod, FAQ, referansar, chat-widget. Alle besøkjande er anonyme. Web-admin (`/#admin`) legg seg over denne flata.

### 2. Workspace (`/workspace/`)
Autentisert internt arbeidsområde for kunden sine tilsette — dashboard, oppgåver, notat, kunngjeringar, kunnskapsbase, CRM, booking, lenkjer, organisasjonsdrift, innstillingar, brukaradministrasjon.

### 3. Vibeverk Operator Console (`/console/`)
Internt superadmin-verktøy for Vibeverk sjølv — ikkje ein del av kunden sin app. Brukt til å registrere/onboarde kundar, redigere konfigurasjon/tema/design per kunde, og overvake status. Sjå «Kontrollplan vs. dataplan» under.

---

## Teknisk stack

- **Vanilla JS** — ingen rammeverk, ingen byggsteg, ingen pakkehandtering på klientsida
- **IIFE-modular** — kvar `module-*.js` er ein sjølvforsynt IIFE
- **Supabase** — database (PostgreSQL), auth (e-post + passord), Realtime (chat/admin), Storage (media)
- **LocalStorage** — write-through-cache; synkroniserast mot Supabase ved innlogging
- **Hash-ruting** — `#seksjon`, `#sak/<id>`, `#admin` — ingen server-side ruting nødvendig for sjølve appen
- **Vercel** — hosting + Routing Middleware (`middleware.js`) for hostname→tenant-oppløysing (sjå «Deployering»)
- **Tabler Icons** (CDN) og **Google Fonts** (frå config/tema) er dei einaste eksterne klient-avhengigheitene
- **Resend** — transaksjons-e-post (utgåande via `send-reply`, innkomande via `inbound-email`)

---

## Kontrollplan vs. dataplan

Sidan Fase 7–9 (2026-07-07 til 2026-07-09) er arkitekturen delt i to:

- **Dataplan** — eitt Supabase-prosjekt per kunde (`supabase/`-skjemaet over), fullstendig databaseisolert. Produksjonskunden (Vibeverk sjølv) køyrer på `clzczbyklgdtdhgjphup`.
- **Kontrollplan** — eitt felles Supabase-prosjekt, `vibeverk-control` (`supabase-control/`), som held tenant-registeret (hostnamn, tilkoplingsinfo, ein Vault-referanse til kvar tenant sin `service_role`-nøkkel — aldri nøkkelen sjølv i ein vanleg kolonne) og operatørlista.

Console autentiserer OTP mot kontrollplanet (ikkje mot nokon kunde sitt eige prosjekt), og alle konfig-endringar for ein valt kunde går via `broker`-funksjonen der (audit-logga). Sjå `docs/decisions/ADR-0008-control-plane-data-plane-split.md`, `ADR-0009-console-control-plane-auth-and-broker-actions.md`, `ADR-0010-phase9-semi-automated-onboarding.md`, og `docs/architecture/roles-and-tenants.md` for full detalj.

---

## Brukarstruktur og roller

Sjå `docs/architecture/roles-and-tenants.md` for full detalj.

### Vibeverk Console (`/console/`) — kun for Vibeverk-operatøren
Separat produkt frå kunde-adminen. OTP-innlogging mot kontrollplanet (`vibeverk-control`); den reelle tilgangssjekken (`operators.status = 'active'`) skjer *etter* verifisert OTP, ikkje mot noka kunde-tabell.

### Kunde-admin (`/#admin`) og Workspace (`/workspace/`)
Tilsette hos kunden loggar inn med e-post + passord via Supabase Auth. Rolla hentast frå kunden sin eigen `public.users`-tabell. Databasen tillèt berre tre rollar (CHECK-constraint på `users.role`):

| Rolle | Tilgang |
|-------|---------|
| `admin` | Full tilgang: alt inkl. backup, brukaradmin, innstillingar |
| `editor` | Kan opprette og redigere innhald (artiklar, KB, lenkjer, oppgåver) |
| `member` | Les det meste, eigne notat, kan oppdatere tildelte oppgåver |

Maks **50 brukarar per tenant** (handheva av Edge Function). Invitasjon/fjerning skjer via Edge Function `manage-user`, som verifiserer at kallaren har rolle `admin` før handling utførast.

---

## Sikkerheit

Full detalj i `docs/security/security-baseline.md`. Kort oppsummert:

- **Row Level Security** er aktivert på alle kundetabellar. `is_admin_or_owner()` (namn er historisk, sjekkar berre `role='admin'`) og `can_edit_content()` (admin+editor) styrer dei fleste policyane.
- **Edge Functions** (`manage-user`, `send-reply`, `inbound-email`, `anon-media-upload-token`, kontrollplanet sin `tenant-admin`/`broker`) køyrer server-side med `service_role`-nøklar som aldri eksponerast til klienten.
- **Console-tilgang**: allowlist-fri OTP mot kontrollplanet, `operators.status='active'`-sjekk etter verifisert OTP (sjå over).
- **Klientsideadmin** (`config.js → admin.password`): berre for lokal/test-bruk utan Supabase konfigurert — **ikkje** ei produksjonssikring. Reell tilgangskontroll er alltid Supabase Auth (Workspace/kunde-admin) eller Console sin OTP.
- **anon-nøkkelen** i konfigurasjonen er trygg å eksponere (RLS beskyttar data) — `service_role`-nøkkelen er det aldri.

---

## Kjøre lokalt

Sjå `.claude/skills/run-vibeverk/` for ein automatisert lokal server + skjermbilete-/klikk-flyt. Manuelt:

```bash
# Python (innebygd)
python -m http.server 8080

# Node (npx)
npx serve .
```

Gå til `http://localhost:8080`. Workspace er tilgjengeleg på `http://localhost:8080/workspace/`. Utan Supabase-konfigurasjon i `config.js` fell systemet tilbake til passordet i `config.js` og localStorage.

---

## Testoppsett

```bash
npm install              # installerer jsdom (einaste avhengigheit)
node test.js              # tester den offentlege sida
node test-workspace.js    # tester Workspace
```

CI (`.github/workflows/`) køyrer begge på kvar push. To testar er kjende, aksepterte, pre-eksisterande feil — sjå `CLAUDE.md` for dei nøyaktige, gjeldande testnamna (dei endrar seg av og til når testfiler blir omorganiserte). Alle andre testar skal vere grøne.

---

## Modularkitektur

### Offentleg side

```js
App.registerModule({
  id:         "booking",
  label:      "Booking",
  order:      45,            // plassering i toppmeny og admin
  page:       true,          // eiga side på #booking (utelat for inline-seksjon)
  inline:     false,         // vis også på forsida (kombinerast med page: true)
  render:     () => `<section>…</section>`,   // forsida
  renderPage: (root) => {},  // køyrast når #booking er aktiv
  mount:      (root) => {},  // køyrast etter innsetting
  admin: {
    label:  "Booking",
    render: () => `…`,
    mount:  (body) => {}
  }
});
```

### Workspace

```js
Intranet.registerModule({    // internt JS-objektnamn framleis "Intranet", sjå CLAUDE.md
  id:     "tasks",
  label:  "Oppgåver",
  icon:   "checklist",
  order:  20,
  render: (root) => {}   // kalla med container-elementet
});
```

---

## Lagringslag

```js
// Lese og skrive (namespacet per kunde via config.storageKey — aldri endre denne verdien etter oppstart)
App.store.get("nøkkel", standardverdi)
App.store.set("nøkkel", verdi)
App.store.remove("nøkkel")

// Bilete og filer
App.media.put(file)           // → Promise<publicUrl> — offentleg "media"-bucket (bilete, generelle vedlegg)
App.media.putFile(file)       // → Promise<{ name, type, data }>
App.media.putFileAnon(file)   // anonym opplasting (t.d. Tilbod-vedlegg) — kvotestyrt via anon-media-upload-token
App.media.resolveImage(url)   // handterer både eksterne URL-ar og Supabase-URL-ar
App.media.free(url)           // slettar eit lagra bilete
```

To Supabase Storage-bøtter finst: den offentlege **`media`**-bøtta (bilete/generelle vedlegg, ingen signerte URL-ar nødvendig) og den private **`crm-documents`**-bøtta (CRM-dokumentvedlegg — signerte URL-ar med kort levetid, kun admin/editor). Skrive-gjennom til Supabase skjer automatisk. Hydrering (`hydrateFromSupabase()`) køyrast ved innlogging.

---

## Konfigurasjon

`config.js` held identitet/farger/skrift/kontaktinfo/passord/feature-flagg for eit lokalt/test-oppsett. For ein registrert tenant (produksjon) genererast den tilsvarande konfigurasjonen i staden **per request** av `api/tenant-config.js`, ut frå kontrollplanet sitt tenant-register (sjå «Kontrollplan vs. dataplan» over) — `config.js` sjølv vert då ikkje brukt direkte, sidan `middleware.js` uvilkårleg omdirigerer `/config.js`-førespurnadar dit.

| Nøkkel | Skildring |
|--------|-------------|
| `company` | Firmanamn, slagord, skildring |
| `colors` / `fonts` | Tema — kan setjast av Console (alle kundar) eller kunden sjølv (design-fana, bak `features.sidebygger`) |
| `contact` | Adresse, telefon, e-post, opningstider, sosiale lenkjer |
| `admin.password` | Admin-passord for nettsida (klientside, ikkje produksjonssikring) |
| `storageKey` | Unik nøkkel for localStorage-namespace (**aldri** endre etter oppstart) |
| `supabase.url` / `supabase.anonKey` | Dataplan-prosjektet sine tilkoplingsverdiar |
| `features` | Feature-flagg (av/på per funksjon, m.a. `crmFull`, `sidebygger`, `contactForm`) |
| `modules` | Aktiverte modular og deira konfigurasjon |

---

## Deployering

### Nettside og Vercel-funksjonar
1. Push til `main`-grenen — Vercel auto-deployer prosjektet (produksjonstrafikk går her sidan 2026-07-16-DNS-cutoveren for `vibeverk.no`).
2. `middleware.js` (Vercel Routing Middleware, må heite akkurat `.js`, aldri `.mjs` — sjå `CLAUDE.md`) løyser kvar førespurnad sin hostname mot ein tenant via kontrollplanet, og omdirigerer `/config.js` til `api/tenant-config.js`.
3. GitHub Actions deployer framleis parallelt til **GitHub Pages** (same push, `CNAME`-fila er urørt) — dette er i dag berre ein rask rollback-veg, ikkje den levande vegen.

### Supabase-skjema (kundeprosjekt)
1. SQL-endringar går i ei ny tidsstempla fil i `supabase/migrations/` (`npx supabase migration new <namn>`) — dette er den ekte, CLI-deployerbare kjelda sidan 2026-07-07 (`npx supabase db push --linked` for eit lenka prosjekt, `--db-url` for eit anna). `supabase/migration.sql` er eit supersedert, fryst snapshot — ikkje ei aktiv kjelde lenger.
2. Deploy Edge Functions frå `supabase/functions/` (`npx supabase functions deploy <namn> --project-ref <ref>`), etter eksplisitt godkjenning — sjå CLAUDE.md sin deployeringsregel.
3. Etter enhver `CREATE OR REPLACE FUNCTION`: `NOTIFY pgrst, 'reload schema';`.

### Ein ny kunde (tenant)
Handterast i dag via Vibeverk Console sin "Kundar"-seksjon (registrering → tilkoplingsinfo → hemmeleg-lagring via Vault → skjema-/rutingverifisering → aktivering), ikkje manuelt — sjå `docs/architecture/tenant-onboarding-runbook.md`.

---

## Dokumentasjon og roadmap

Full dokumentasjonsstruktur (arkitektur, sikkerheit, personvern, avgjerder, status og roadmap) ligg i [`docs/`](docs/README.md). For gjeldande, verifisert status: [`docs/project/CURRENT_STATE.md`](docs/project/CURRENT_STATE.md). For planlagt (ikkje bygd) arbeid: [`docs/roadmap/ROADMAP.md`](docs/roadmap/ROADMAP.md).
