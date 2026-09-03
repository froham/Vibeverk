# Sidebygger (Console "Sider")

**Navnemerknad:** «Sidebygger» er navnet brukt i commit-meldingar og `CHANGELOG.md` for denne funksjonen. I Console sjølve heiter fana **«Sider»** (`sidebygger-sider`-id i `console/console-core.js`). Dette er **ikkje** same funksjon som `features.sidebygger` (det betalte flagget for dei tre nettsidedesignmalane Klassisk/Panorama/Scroll-story, sjå `docs/project/CURRENT_STATE.md`) -- to ulike funksjonar deler diverre same namn. «Sider»/side-seksjonsbyggaren er tilgjengeleg for ALLE tenantar, uavhengig av `features.sidebygger`-flagget.

Status per v0.159.13 (2026-09-03): 9 seksjonstypar implementert og testa (`test.js`, `test-page-builder-console.js`), Console-only redigering (ingen kundesjølvbetening enno). Hero-typen fekk valfrie høgde-/fullbredde-felt same dato, sjå eigen seksjon under.

## Komponentar

- `components.js`: `pageSection(s)` er einaste offentlege inngangspunkt -- dispatcher på `s.type`, returnerer `""` (stille utelating) for ukjend type. Dette gjev versjonsskeivskap-tryggleik: ein besøkjande med gamal cacha `components.js` krasjar aldri på ein seksjonstype lagt til etter deira siste cache-bust.
- `module-page-builder.js`: les `"custom-pages"`-nøkkelen (same `store`-mønster som `module-scrollbanner.js`), registrerer éin `page:true`-modul per lagra side via `App.registerModule()`.
- `console/console-core.js`: Sider-fana -- sideliste, seksjonsredigering (`PB_SECTION_TYPES`), live iframe-førehandsvisning (sandboksa, `allow-same-origin` men ALDRI `allow-scripts`), bileteopplasting via broker sine `upload_section_image`/`upload_logo`-handlingar.

## Dei 9 seksjonstypane

8 faste typar (Fase 1, v0.133.0): `hero`, `text`, `image-text`, `big-image`, `quote`, `grid`, `cta`, `spacer` -- kvar med eigen fast datamodell, ingen fri HTML/CSS/JS, ingen pikselplassering.

Den 9., `blocks` (v0.134.0), er **sidestilt, ikkje ei erstatning** -- ei eksplisitt stadfesta avgjerd frå denne økta (Architect-konsultasjon + Plan-agent-runde før implementering): blokker kan ikkje nøstast inn i nokon av dei 8 andre typane, og dei 8 er heilt urørte av innføringa.

### `blocks`-datamodell

```
section.data = {
  layout: "1col" | "2col" | "2col-2-1" | "2col-1-2" | "3col" | "4col",
  blocks: [{ id, type, slot, data }],
  colFrame: [bool, ...]   // valfritt, indeksert per kolonne/slot (v0.135.0)
}
```

- `layout` er eit **lukka enum** (fast CSS `grid-template-columns`-forhåndsval via `pbBlocksLayout()`), ikkje frie breiddeverdiar -- held fast på "ingen fri pikselplassering"-grensa frå Fase 1.
- Kvar blokk har `slot` (0-indeksert kolonne). Ein ugyldig/for høg `slot`-verdi (t.d. lagra då layonten hadde fleire kolonnar enn no) vert klemt til siste gyldige kolonne av `pbBlocks()`, aldri forkasta.
- Ukjend blokktype, eller ein renderer som gjev tom streng, vert stille utelaten -- same prinsipp som `pageSection()` sjølv.
- `colFrame[i]` (valfritt) rammar inn HEILE kolonne `i` som éin samanhengande boks (`.pb-blocks__slot--framed`), uavhengig av kvar blokk sin eigen `data.frame`-ramme -- dei to kan kombinerast (nesta boksar).

### 6 blokktypar (v1)

`heading`, `richtext`, `image`, `button`, `contact-item`, `spacer`. Fleire (biletkarusell, statistikk-tal, badge, anmeldelse, logo-rad, kart/video-embed) er eksplisitt utsett.

## Sikkerheitsmønster (medvitne, ikkje berre kodemønster som tilfeldigvis finst)

- **`contact-item` har aldri eit fritt href-felt.** `tel:`/`mailto:` er alltid ein hardkoda prefiks (`pbBlockContactItem()` i `components.js`) framfor operatøren sin `value`; sjølv ein `javascript:...`-verdi vert berre `tel:javascript:...`, aldri eit eksekverbart skjema.
- **`button`-blokk sin `variant` er ei kvit-liste** (`["primary","secondary","ghost"]`, fell attende til `"primary"`) -- `pbBlockButton()` i `components.js`. Grunngjeving: `button()` sin `cls`-streng vert ALDRI `esc()`-a (alle andre kallarar sender ein hardkoda bokstaveleg variant), og broker sin `set_config` validerer aldri forma på `custom-pages` server-side, så eit vondsinna JSON-kall utanom UI-et kunne elles injisert eit attributtbrot på den ekte, USANDBOKSA offentlege sida. Retta som Security Auditor-BLOCKER før v0.134.0 vart merga.
- **`heading`-blokk sin `level`** er tilsvarande kvit-lista (`h2`/`h3`).
- **`image`-blokk gjenbruker heile den eksisterande opplastings-/komprimerings-/SVG-saneringspipelina uendra** (same broker-handlingar som dei 8 andre seksjonstypane sine biletfelt) -- inga ny opplastingsflate innført for blokker.
- **`richtext`-blokk går uendra via `sanitizeRichHtml()`** -- same sanering som resten av plattforma sine rikttekstfelt.
- **Knapplenkjer i dei 8 faste typane** (hero/CTA/grid) går gjennom `button()` sin felles `javascript:`-URL-vern (retta i sjølve `button()`, Fase 1 Security Auditor-funn).

## Biletform (v0.136.0)

Valfri `imageShape` (`rounded` (standard) | `square` | `circle`) på biletfelt i `image-text`, `big-image`, `grid` (eitt val for HEILE rutenettet, ikkje per rute) og blokk-typen `image`. **Medvite utelate frå `hero`**: hero sitt bilete er ein full-bleed absolutt-posisjonert bakgrunn, eit strukturelt anna bruksmønster -- heile hero-boksen sitt eige `border-radius` styrer klippinga, ikkje biletet sjølv. Delt CSS-modifikatorpar (`.pb-img-shape--square`/`--circle`) på tvers av alle fire kontekstane. Manglande `imageShape` (alt eksisterande lagra innhald) fell trygt attende til `rounded`, ingen visuell endring for uendra innhald.

## Hero: høgde og fullbredde (v0.159.13, 2026-09-03)

Fyrste steg i den avtalte editorial-design-utviklinga (fotograf-/portefølje-bruk, sjå brukarønske same dag) -- ei UTVIDING av eksisterande hero-datamodell, ikkje ein ny seksjonstype. Nye, valfrie felt på `hero` sin `data`:

```
data.height:    "auto" (standard, uendra åtferd) | "tall" | "full"
data.fullBleed: boolean (standard false)
```

- **`height`** styrer `min-height` (ALDRI `height`, for å aldri klippe innhald) via ein `pb-hero--h-*`-klasse på sjølve `.pb-hero`. `tall` = `max(70dvh,420px)`, `full` = `100dvh`. `dvh`, ikkje `vh`, for adressefelt-trygg mobilhandsaming.
- **`fullBleed`** er hero-spesifikt, IKKJE ein tredje verdi på den delte `variant.width`-enumen (Arkitekt-vurdering: `width` vert tilbydd identisk for KVAR seksjonstype, "full" gjev berre meining for biletberande typar). Handsamast i `pageSection()` (`components.js`), som legg til `pb-sect--bleed` på den ytre `<section>` når `s.type === "hero" && s.data.fullBleed` -- nullstiller `.pb-sect` sin padding og `.pb-sect__inner` sin `max-width`.
- **To hand-vedlikehaldne CSS-kopiar** (`module-page-builder.js` -- den ekte offentlege sida, og `console-core.js` sin `pbPreviewCss()` -- Console sin førehandsvisings-iframe) må halde dei same fire reglane synkroniserte manuelt. Same, alt-eksisterande dupliseringsmønster som resten av page-builder-CSS-en -- ikkje noko nytt strukturelt problem denne runda innfører, berre fire fleire reglar i den same, kjende risikoen.
- **Console-skjemaet deaktiverer** (viser, men gjer inerte -- ikkje skjuler) «Bredde»/«Luft»-nedtrekkslistene når Fullbredde er kryssa av, både ved opning og i sanntid (UX/Mobile Reviewer-funn, retta same runde).
- **Kjend, medvite avgrensing**: Console sin førehandsvisings-iframe kan ikkje simulere ei ekte mobileining sin skjermhøgde eller adressefelt-kollaps nøyaktig (`dvh` løyser seg mot iframen sin eigen boks) -- mobil-etiketten i førehandsvisinga seier dette rett ut i staden for å late som visinga er eit presist mål. Ekte mobilverifisering krev framleis eit ekte nettlesar-/einingstest.

## Kva som IKKJE er implementert enno

Ingen kundesjølvbetening (Console-only redigering, sjølv om `locked`-feltet per side alt finst klart for det), ingen kladd/publisert-flyt (alt ein operatør lagrar er umiddelbart synleg for besøkjande -- forklart med ei Nivå B-inline-åtvaring i Sider-fana), ingen "dynamisk liste"-seksjonstype for eit framtidig strukturert register (ansatte/stillingar), ingen dra-og-slipp inni sjølve førehandsvisinga (kun i seksjonslista).

## Kjelder

Fullstendig endringshistorikk, inkludert alle Security Auditor-/UX Reviewer-funn per versjon: `docs/project/CHANGELOG.md` 0.133.0-0.136.0. Denne fila dokumenterer implementasjonsverkelegheita, ikkje endringshistorikken.
