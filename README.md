# Bedriftsside — modulær basekodebase

Én kodebase, mange kunder. Alt kundespesifikt bor i `config.js`.
`core.js` og `components.js` skal aldri endres per kunde.

## Filer
| Fil | Ansvar | Endres per kunde? |
|-----|--------|-------------------|
| `index.html` | Skjelett + strukturell CSS (kun CSS-variabler) | Nei |
| `config.js` | Firmanavn, farger, fonter, tekster, kontaktinfo, admin-passord, funksjoner | **Ja — kun her** |
| `core.js` | All logikk: tema, ruting, skjema, admin, modulregister, media | Nei |
| `components.js` | Gjenbrukbare HTML-komponenter | Nei |

## Sette opp en ny kunde
1. Kopier mappa.
2. Åpne `config.js` og bytt verdiene (firmanavn, `colors`, `fonts`, tekster, `contact`, `admin.password`, `storageKey`).
3. Skru funksjoner av/på i `config.features`.
4. Ferdig.

## Funksjoner (ja/nei-brytere)
I `config.features` slår du funksjoner av/på. Mangler et flagg, regnes det som på.

```js
features: {
  newsArchive: true,  // «Les mer» + «Se alle saker» + arkivside
  search:      true,  // søkefelt i arkivet (krever newsArchive)
  attachments: true,  // vedlegg på aktuelt-innlegg
  social:      true   // sosiale lenker i kontakt
}
```

Settes en til `false`, skjules funksjonen både på siden og i admin. `news.frontCount`
styrer hvor mange saker som vises på forsiden (resten havner i arkivet).

## Ruting (fortsatt én fil)
Hash-ruting gir delbare adresser og fungerende tilbake-knapp uten flere HTML-filer:

| Adresse | Visning |
|---------|---------|
| `…` / `…#kontakt` | Forsiden (one-pager), scroller til seksjonen |
| `…#sak/<id>` | Ett aktuelt-innlegg i full lengde |
| `…#aktuelt/alle` | Arkiv: alle saker + søk |
| `…#admin` | Adminpanel |

## Admin
- Åpne: trippelklikk på footeren, eller gå til `…#admin`.
- Logg inn med passordet i `config.admin.password`.
- Rediger hero/om-oss/kontaktinfo (inkl. egendefinerte kontaktfelt og bilder),
  CRUD på tjenestekort og aktuelt-innlegg (med bilde + vedlegg), se innsendte leads.
- Bilder: dra det lyse utsnittet i forhåndsvisningen for å velge beskjæring.
- Alt lagres i `localStorage` (byttes til Supabase senere — kun `Store`/`Media`-laget endres).

> Merk (demo): admin-passordet er klient-side og ikke ekte sikkerhet. Bilder/vedlegg
> lagres lokalt; `localStorage` er ~5 MB, så bilder skaleres ned og filer har en
> størrelsesgrense. For kunder med mye innhold er dette argumentet for Supabase.

## Legge til en ny modul (uten å røre basekoden)
Lag en egen fil og last den inn etter `core.js` i `index.html`:

```html
<script src="module-booking.js"></script>
```

```js
App.registerModule({
  id: "booking", label: "Booking", order: 45,
  page: true,                          // egen side på #booking (utelat for inline-seksjon)
  render: () => `<section id="booking" class="section reveal">…</section>`,
  mount: (root) => {},                 // valgfri, kjøres etter innsetting
  admin: { label: "Booking", render: () => `…`, mount: (b) => {} }  // valgfri admin-fane
});
```

`page: true` gir modulen egen toppmeny-lenke og en rutet visning (`#<id>`) i stedet
for å vises som en seksjon på forsiden. Standardseksjonene er registrert på samme måte.

### Verktøy moduler kan gjenbruke (via `window.App`)
- `App.store` — namespacet localStorage (`get/set/remove`)
- `App.media` — bilder/filer (`resolveImage`, `put`, `putFile`, `free`)
- `App.feature(name)` — les feature-flagg
- `App.prefillContact(msg)` — forhåndsutfyll kontaktskjemaet og hopp dit
- `App.ui.imageField / bindImageFields / readImageField` — bildefelt med beskjæring
- `window.Components` — alle HTML-komponenter (knapper, felt, kort, ikoner …)

### Eksempel: `module-booking.js`
En komplett booking-modul som egen side. Admin oppretter «ressurser» (bil, frisørtime,
møterom, artist) med bilde, åpningstider/ukedager og en bryter **intern/offentlig**.
Offentlige ressurser vises med ledige/opptatte tider; besøkende sender en **forespørsel**
(kontaktskjemaet forhåndsutfylles), og admin legger inn selve bookingen — som markerer
tiden opptatt. Slås av/på med `features.booking`. Modulen tar med seg sine egne stiler
og rører ikke basekoden.

## Avhengigheter
Kun Google Fonts (fra `config.fonts`) og Tabler Icons (CDN). Ingen byggesteg.
Må serveres via webserver (ikke `file://`) for at `localStorage` skal virke.
