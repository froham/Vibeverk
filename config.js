/* =============================================================================
   config.js  —  ALT KUNDESPESIFIKT BOR HER
   -----------------------------------------------------------------------------
   Dette er den ENESTE filen du trenger å endre for en ny kunde.
   core.js og components.js skal aldri røres per kunde.

   Bytt verdiene under, så endres farger, fonter, tekster og innhold automatisk.
   ========================================================================== */

window.SITE_CONFIG = {

  /* --- Identitet ------------------------------------------------------------ */
  // Brukes i logo, footer, <title>, e-poster osv.
  company: {
    name: "Nordpunkt",                       // ← Firmanavn
    tagline: "Rådgivning som flytter ting framover", // ← Slagord
    // Valgfri logo-URL. La stå tom ("") for å bruke firmanavn som tekstlogo.
    logoUrl: ""
  },

  /* --- Fargepalett ---------------------------------------------------------- */
  // Kun disse tre styrer hele uttrykket. Resten utledes automatisk i CSS
  // (overflater, kantlinjer, dempet tekst) via color-mix() — du trenger ikke
  // definere flere farger med mindre du vil overstyre.
  colors: {
    primary:    "#15616D",   // ← Primærfarge (knapper, lenker, aksent)
    secondary:  "#E8833A",   // ← Sekundærfarge (CTA, highlights)
    background: "#FBFAF8"    // ← Bakgrunnsfarge
    // Valgfritt å overstyre: text, muted, surface, border (se core.js for default)
  },

  /* --- Fonter --------------------------------------------------------------- */
  // Hentes automatisk fra Google Fonts av core.js. Skriv navnet slik Google
  // Fonts staver det. Vekter du vil ha må listes i `weights`.
  fonts: {
    display: "Space Grotesk",                // ← Overskrifter
    body:    "Inter",                        // ← Brødtekst
    weights: { display: [500, 700], body: [400, 500, 600] }
  },

  /* --- Kontaktinfo ---------------------------------------------------------- */
  // Vises i Kontakt-seksjonen og footer. Kan redigeres i admin-panelet.
  contact: {
    email:   "post@nordpunkt.no",            // ← E-post
    phone:   "+47 21 00 00 00",              // ← Telefon
    address: "Storgata 1, 0001 Oslo",        // ← Adresse
    // Egendefinerte felter (overskrift + innhold) — kan også legges til i admin.
    // F.eks. fakturainformasjon, org.nr, styremedlemmer. La stå [] for ingen.
    extra: [
      // { label: "Organisasjonsnummer", value: "123 456 789" },
      // { label: "Fakturainformasjon", value: "EHF: 123456789\nMerk faktura med ordrenr." }
    ],
    // Sosiale lenker er valgfrie. Fjern linjer du ikke trenger.
    social: {
      linkedin: "https://www.linkedin.com/",
      instagram: ""
    }
  },

  /* --- Hjem / Hero ---------------------------------------------------------- */
  // Tittel og undertittel kan redigeres i admin-panelet.
  hero: {
    title:    "Klare råd. Konkrete resultater.",   // ← Hero-tittel
    subtitle: "Vi hjelper virksomheter med å ta gode beslutninger og " +
              "gjennomføre dem — uten støy.",       // ← Hero-undertittel
    ctaLabel: "Ta kontakt",                         // ← Tekst på CTA-knapp
    ctaTarget: "#kontakt",                          // ← Hvor CTA peker (seksjons-id)
    image:    ""                                    // ← Valgfritt fullbredde bakgrunnsbilde (URL). Kan også lastes opp i admin.
  },

  /* --- Om oss --------------------------------------------------------------- */
  // Teksten kan redigeres i admin-panelet. Bilde er valgfritt (la stå "" for å skjule).
  about: {
    heading: "Om oss",
    text: "Vi er et lite, erfarent team som jobber tett på kundene våre. " +
          "I stedet for tykke rapporter leverer vi beslutninger som lar seg " +
          "gjennomføre, og blir værende til jobben er gjort.",
    imageUrl: ""                              // ← Valgfritt bilde-URL
  },

  /* --- Tjenester ------------------------------------------------------------ */
  // 3–4 kort. `icon` bruker Tabler Icons-navn (uten "ti-" prefiks),
  // se https://tabler.io/icons for alle navn. Hvert kort kan også ha et
  // valgfritt `image` (URL) som da vises i stedet for ikonet — eller lastes
  // opp i admin.
  services: {
    heading: "Tjenester",
    intro: "Det vi er best på.",
    cards: [
      { icon: "compass",       title: "Strategi",     text: "Retning, prioritering og en plan folk faktisk forstår." },
      { icon: "chart-arcs",    title: "Analyse",      text: "Tall og innsikt gjort om til noe du kan handle på." },
      { icon: "rocket",        title: "Gjennomføring", text: "Vi blir med fra idé til levert resultat." },
      { icon: "users",         title: "Rådgivning",   text: "En sparringpartner når avgjørelsene betyr noe." }
    ]
  },

  /* --- Aktuelt -------------------------------------------------------------- */
  // Standard-innlegg som vises før noen er opprettet i admin. Når admin lager,
  // redigerer eller sletter innlegg, lagres det i localStorage og overstyrer dette.
  news: {
    heading: "Aktuelt",
    intro: "Nytt fra oss.",
    frontCount: 3,                           // ← Antall saker på forsiden (resten i arkivet)
    posts: [
      { id: "seed-1", title: "Vi utvider teamet", date: "2026-05-12",
        text: "To nye rådgivere er på plass for å møte økt etterspørsel." },
      { id: "seed-2", title: "Ny rapport om bærekraft", date: "2026-04-03",
        text: "Vår gjennomgang av tiltak som faktisk monner er nå tilgjengelig." }
    ]
  },

  /* --- Kontakt -------------------------------------------------------------- */
  contactSection: {
    heading: "Kontakt",
    intro: "Send oss et par ord, så svarer vi raskt.",
    // Etter innsending vises denne meldingen.
    successMessage: "Takk! Vi tar kontakt så snart vi kan."
  },

  /* --- Admin ---------------------------------------------------------------- */
  admin: {
    // Felles passord for redigeringspanelet.
    // MERK: Dette er klient-side beskyttelse (passordet ligger i denne filen og
    // kan ses av tekniske brukere). Det holder skjult innhold unna vanlige
    // besøkende, men er ikke ekte sikkerhet. Ekte autentisering kommer med
    // Supabase-backenden senere.
    password: "test",                          // ← Admin-passord (TESTFASE — bytt via super-admin)

    // Hvordan man åpner panelet:
    //   1) Trippelklikk på footeren, eller
    //   2) Gå til  ...#admin  i adresselinja
    tripleClickFooter: true
  },

  /* --- Funksjoner (skru av/på) --------------------------------------------- */
  // Enkle ja/nei-brytere. Sett til false for å skjule funksjonen helt (både på
  // siden og i admin). Mangler et flagg, regnes det som på.
  features: {
    newsArchive: true,   // ← «Les mer» + «Se alle saker» + arkivside
    search:      true,   // ← Søkefelt i arkivet (krever newsArchive)
    attachments: true,   // ← Vedlegg på aktuelt-innlegg
    social:      true,   // ← Sosiale lenker i kontaktseksjonen
    booking:     true,   // ← Booking-modul. Krever module-booking.js
    quote:       true,   // ← Tilbud-modul.  Krever module-quote.js
    references:  true,   // ← Referanser-modul. Krever module-references.js
    faq:         true,   // ← FAQ-modul.         Krever module-faq.js
    siteSearch:  true,   // ← Søk på heile sida (søkikon i toppmenyen)
    crm:         true    // ← Kunder-modul (lett CRM). Krever module-crm.js
  },

  /* --- FAQ (modul) ---------------------------------------------------------- */
  faq: {
    heading: "Ofte stilte spørsmål",
    intro:   ""          // valgfri ingress — tomt = vises ikke
  },

  /* --- Referanser (modul) --------------------------------------------------- */
  references: {
    heading:      "Referanser",
    intro:        "Her er noen av kundene vi har hatt gleden av å jobbe med.",
    previewCount: 3        // antall kort som vises inline på forsiden
  },

  /* --- Booking (modul) ------------------------------------------------------ */
  booking: {
    heading: "Booking",
    intro:   "Se ledige tider og send en forespørsel."
  },

  /* --- Tilbud (modul) ------------------------------------------------------- */
  quote: {
    heading:      "Be om tilbud",
    intro:        "Beskriv jobben og send inn – vi gir deg et uforpliktende tilbud.",
    termsHeading: "",   // tom = bruker CFG.privacy.heading
    termsText:    ""    // tom = bruker CFG.privacy.text (delt personvernerklæring)
  },

  /* --- Personvern / GDPR ------------------------------------------------------
     Delt vilkårstekst som vises i popup på kontaktskjema, booking og tilbud.
     Rediger fritt — teksten under er et utgangspunkt, ikke juridisk rådgivning. */
  privacy: {
    heading: "Personvern og databehandling",
    text:
      "Når du sender oss en henvendelse, ber om tilbud eller reserverer en booking, lagrer vi opplysningene du selv oppgir — typisk navn, e-postadresse, telefonnummer og innholdet i meldingen eller bestillingen din. Opplysningene brukes utelukkende til å besvare henvendelsen din eller behandle bestillingen, og deles ikke med tredjeparter for markedsføringsformål.\n\n" +
      "Hvor lagres opplysningene?\n" +
      "Nettsiden er bygget som en statisk side og driftes via GitHub Pages. Innsendte opplysninger lagres i en database hos Supabase, med servere i EU.\n\n" +
      "Bruker vi cookies?\n" +
      "Nei, ikke som standard. Dersom denne siden bruker trafikkanalyse, skjer det via Plausible Analytics — et personvernvennlig analyseverktøy uten sporingscookies, som ikke samler inn personidentifiserbar informasjon om besøkende.\n\n" +
      "Hvor lenge lagres opplysningene?\n" +
      "Vi oppbevarer henvendelser, tilbud og bookinger så lenge det er nødvendig for å følge opp saken din. Du kan når som helst be om at opplysningene dine slettes.\n\n" +
      "Dine rettigheter\n" +
      "Du har rett til innsyn i hvilke opplysninger vi har lagret om deg, samt rett til å få disse korrigert eller slettet, i tråd med personopplysningsloven/GDPR. For å be om innsyn eller sletting, ta kontakt via kontaktinformasjonen på denne siden og merk henvendelsen «Personvern». Vi sletter opplysningene dine uten ugrunnet opphold.\n\n" +
      "Samtykke\n" +
      "Ved å sende inn dette skjemaet samtykker du til at vi behandler opplysningene dine slik beskrevet over."
  },

  /* --- Footer --------------------------------------------------------------- */
  // Vises nederst på siden. Tomme felt utelates automatisk.
  footer: {
    orgNr:        "",          // f.eks. "Org.nr: 123 456 789"
    invoiceEmail: "",          // f.eks. "faktura@nordpunkt.no"
    invoiceAddress: "",        // f.eks. "Fakturaadresse: Storgata 1, 0001 Oslo"
    extraLines:   [],          // valgfrie fritekstlinjer, f.eks. ["MVA-registrert"]
    copyright:    ""           // f.eks. "© 2026 Nordpunkt AS" — tomt = genereres auto
  },

  /* --- Analyse -------------------------------------------------------------- */
  // Fyll inn ID når domenet er oppe. Tomme felt = ingenting lastes.
  analytics: {
    googleAnalytics: "",   // GA4 målings-ID, f.eks. "G-XXXXXXXXXX"
    plausible:       "",   // domenenavn, f.eks. "nordpunkt.no"
    fathom:          ""    // Fathom site-ID, f.eks. "ABCDEFGH"
  },

  /* --- Lagring -------------------------------------------------------------- */
  storageKey: "nordpunkt"
};
