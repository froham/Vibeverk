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
    logoUrl: "",
    // SEO/deling — settes i super-admin, ikke i vanlig admin. Vises i søkeresultater
    // og som forhåndsvisning når en lenke til siden deles (Facebook/LinkedIn/Slack m.fl).
    metaDescription: "",   // ← kort beskrivelse, ca. 1–2 setninger
    // MERK: ogImage/favicon må være ekte, offentlig tilgjengelige URL-er (f.eks. fra
    // GitHub Pages) — IKKE last opp via bildefeltet, siden opplastede bilder lagres
    // som data-URL i nettleserens localStorage og er usynlige for eksterne crawlere.
    ogImage: "",            // ← delingsbilde, anbefalt ca. 1200×630px
    favicon: ""              // ← fane-ikon i nettleseren
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
    // Sosiale lenker er valgfrie og redigeres i admin (Innhold-fanen) — verdiene
    // her er kun standard ved første oppstart.
    social: {
      facebook:  "",
      instagram: "",
      linkedin:  "https://www.linkedin.com/",
      tiktok:    "",
      youtube:   "",
      x:         ""
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

    // Valgfritt andre passord med begrenset adgang (kun Kontakt/Tilbud/Booking/Kunder).
    // Tomt = ingen ansatt-tilgang. Settes via super-admin.
    employeePassword: "gjest",                 // ← TESTFASE: gjestepassord. Tomt = ingen ansatt-tilgang. Settes via super-admin.

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
    crm:         true,   // ← Kunder-modul (lett CRM). Krever module-crm.js
    mediabank:     true,  // ← Mediebank (bildegalleri + grafisk profil). Krever module-mediabank.js
    scrollbanner:  true,  // ← Scrollbanner-seksjonar. Krever module-scrollbanner.js
    chat:          true   // ← Native chat-boble. Krever module-chat.js
  },

  /* --- Native Chat -----------------------------------------------------------
     Krever module-chat.js. Legg til <script src="module-chat.js"> i index.html.
     Alle verdiar kan overstyres frå admin-panelet (Innstillinger → Chat). */
  chat: {
    enabled:      true,
    position:     "right",          // "right" | "left"
    welcomeMsg:   "Hei! Korleis kan vi hjelpe deg?",
    operatorName: "Oss",
    askName:      true
  },


  /* --- Intranett-funksjoner (skru av/på) ------------------------------------
     Styrer hvilke gjenspeilde moduler som vises i intranettet.
     Native intranett-moduler (Dashboard, Oppgaver, Innstillinger) er alltid på.
     Settes via super-admin → Funksjoner → Intranett. */
  intranettFeatures: {
    /* --- Låste (alltid på, ikkje i superadmin): dashboard, tasks, settings --- */

    /* --- Standard PÅ (grunnpakke for alle kundar) --- */
    announcements: true,  // ← Aktuelt (intern)
    notes:         true,  // ← Mine notatar
    orgdrift:      true,  // ← Organisasjon & drift
    links:         true,  // ← Lenker

    /* --- Standard AV (aktiverast per kunde) --- */
    crm:           true,  // ← Kunder (frå nettsida)
    booking:       false, // ← Booking (frå nettsida)
    quote:         false, // ← Tilbud (frå nettsida)
    contact:       false, // ← Kontakthenvendingar (frå nettsida)
    kb:            false, // ← Kunnskapsbase
    mediaInternal: false  // ← Mediebank (intern)
  },


  /* --- Chat (modul) --------------------------------------------------------- */
  chat: {
    enabled:      true,
    position:     "right",
    welcomeMsg:   "Hei! Korleis kan vi hjelpe deg?",
    operatorName: "Oss",
    askName:      true,
    termsText:    "Eg godtek at denne samtalen lagrast",
    termsUrl:     ""
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

  /* --- Mediebank (modul) ------------------------------------------------------
     Bildegalleri + fritekst om grafisk profil. Heading/ingress og bilder er
     redigerbare i admin under fanen «Mediebank» — verdiene under er kun standard
     ved første oppstart. */
  mediabank: {
    heading: "Mediebank",
    intro:   "Her finner du bilder og vår grafiske profil til fri bruk."
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
     Tomt felt = kjernen genererer et forslag basert på hvilke moduler/funksjoner
     som faktisk er aktive (se computeDefaultPrivacyText i core.js), slik at en
     kunde uten f.eks. Booking eller analyse ikke får tekst som nevner det.
     Rediger fritt i super-admin når siden er satt opp — teksten er et
     utgangspunkt, ikke juridisk rådgivning. */
  privacy: {
    heading: "Personvern og databehandling",
    text: ""
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
  // Fyll inn domenenavn når det er oppe. Tomt felt = ingenting lastes.
  analytics: {
    plausible: ""   // domenenavn, f.eks. "nordpunkt.no"
  },

  /* --- Supabase ------------------------------------------------------------- */
  // anon-nøkkelen er trygg å eksponere i klienten — sikkerhet kjem frå RLS.
  supabase: {
    url:     "https://clzczbyklgdtdhgjphup.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsemN6YnlrbGdkdGRoZ2pwaHVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMTQ0NDUsImV4cCI6MjA5Nzg5MDQ0NX0.3LA63yD_Dshpw4FgM40kkSALA0mBbFomT3L_TeC_nnw"
  },

  /* --- Lagring -------------------------------------------------------------- */
  storageKey: "nordpunkt"
};
