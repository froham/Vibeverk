// api/_lib/annual-wheel-sources.js — curated, hand-maintained source data for
// Smart årshjul (Workspace's AI-backed annual-wheel suggestions), and the
// lookup layer over it. Deliberately NOT a live web-search integration: this
// project has no browsing/search infra, and "never invent a source" is a
// hard product requirement (see the Smart årshjul spec, section 12-14).
// Instead, every course/messe/arrangement/frist below is a pre-vetted,
// git-reviewed entry with a real name, URL and last-verified date. The
// Anthropic call in annual-wheel-ai.js is only ever allowed to pick from and
// summarize THESE entries — it never gets to fabricate a new source.
//
// Extending this list is a normal PR: add an entry, note today's date in
// verifiedAt, and — since sourceUrl is federally validated as https-only
// downstream anyway — double-check the link still resolves before merging.
// This intentionally lives in the repo, not a Supabase table: it isn't
// tenant data (no RLS/tenant_id needed), and a git diff is a stronger
// no-hallucination guarantee than a table any admin UI could later let
// someone edit without review.

// Same 12 categories module-smart-aarshjul.js uses client-side — keep in sync.
export const CATEGORIES = [
  "planning", "marketing", "seasonal", "maintenance", "purchasing", "digital",
  "professional", "events", "administration", "deadlines", "evaluation", "custom",
];

export const INDUSTRIES = [
  "carpenter", "hairdresser", "photographer", "cleaning", "restaurant", "office", "other",
];

// Fristar som normalt er relevante for dei fleste norske verksemder med
// rapporteringsplikt, uavhengig av bransje. verificationRequired er alltid
// true — AI-en/kjeldeoppslaget kan seie AT ein frist kan vere relevant, men
// kan aldri stadfeste at plikta faktisk gjeld denne konkrete verksemda.
const COMMON_SOURCES = [
  {
    title: "Send inn årsrekneskap til Regnskapsregisteret",
    description: "Fristen er 31. juli for verksemder med innsendingsplikt. Kontroller at plikta gjeld organisasjonsforma di.",
    reason: "Ein konkret årleg frist er meir nyttig enn eit generelt forslag om administrasjon.",
    month: 7, day: 31, recurrence: "none", category: "deadlines", itemType: "deadline",
    exactDate: "31. juli (årleg)", sourceName: "Brønnøysundregistera",
    sourceUrl: "https://www.brreg.no/innsending-av-arsregnskap/", sourceVerifiedAt: "2026-08-04",
    applicability: "Berre for verksemder med innsendingsplikt til Regnskapsregisteret.",
    tags: ["rekneskap", "årsrekneskap", "innsending"],
  },
  {
    title: "Kontroller fristen for skattemelding for næringsdrivande",
    description: "Normalfristen er 31. mai. Dersom datoen fell på helg eller heilagdag, kan praktisk frist bli første arbeidsdag etter.",
    reason: "Fristen bør liggje i planen med offisiell kjelde og kontroll for aktuelt år.",
    month: 5, day: 31, recurrence: "none", category: "deadlines", itemType: "deadline",
    exactDate: "31. mai (normal årleg frist)", sourceName: "Skatteetaten",
    sourceUrl: "https://www.skatteetaten.no/bedrift-og-organisasjon/skatt/skattemelding-naringsdrivende/", sourceVerifiedAt: "2026-08-04",
    applicability: "Gjeld næringsdrivande og selskap som skal levere skattemelding.",
    tags: ["skatt", "skattemelding"],
  },
  {
    title: "A-melding – legg inn månadleg kontrollpunkt",
    description: "A-meldinga har normalt frist den 5. kvar månad, eller første virkedag etter dersom den 5. fell på helg eller heilagdag.",
    reason: "Ein fast månadleg markør kan hindre at rapporteringa blir oversett.",
    month: 1, day: 5, recurrence: "monthly", category: "deadlines", itemType: "deadline",
    exactDate: "Den 5. kvar månad", sourceName: "Skatteetaten",
    sourceUrl: "https://www.skatteetaten.no/bedrift-og-organisasjon/arbeidsgiver/a-meldingen/levere/levering-fra-system/", sourceVerifiedAt: "2026-08-04",
    applicability: "Berre dersom verksemda har plikt til å levere a-melding.",
    tags: ["a-melding", "arbeidsgivar", "tilsette", "lønn"],
  },
  {
    title: "Mva-melding – tredje termin 2026",
    description: "Skatteetaten si fristoversikt viser 31. august 2026 som frist for levering og betaling for tredje termin.",
    reason: "Terminfristar bør visast med eksakt dato og kjelde.",
    month: 8, day: 31, recurrence: "none", category: "deadlines", itemType: "deadline",
    exactDate: "31. august 2026", sourceName: "Skatteetaten",
    sourceUrl: "https://www.skatteetaten.no/bedrift-og-organisasjon/starte-og-drive/frister-gebyrer-og-tilleggsskatt/frister-og-oppgaver/", sourceVerifiedAt: "2026-08-04",
    applicability: "Berre for verksemder som rapporterer denne mva-terminen.",
    tags: ["mva", "termin"],
  },
  {
    title: "Mva-melding – fjerde termin 2026",
    description: "Skatteetaten si fristoversikt viser 12. oktober 2026 som frist for levering og betaling for fjerde termin.",
    reason: "Den konkrete kalenderdatoen kan avvike frå ein enkel standardregel.",
    month: 10, day: 12, recurrence: "none", category: "deadlines", itemType: "deadline",
    exactDate: "12. oktober 2026", sourceName: "Skatteetaten",
    sourceUrl: "https://www.skatteetaten.no/bedrift-og-organisasjon/starte-og-drive/frister-gebyrer-og-tilleggsskatt/frister-og-oppgaver/", sourceVerifiedAt: "2026-08-04",
    applicability: "Berre for verksemder som rapporterer denne mva-terminen.",
    tags: ["mva", "termin"],
  },
  {
    title: "Mva-melding – femte termin 2026",
    description: "Skatteetaten si fristoversikt viser 10. desember 2026 som frist for levering og betaling for femte termin.",
    reason: "Årshjulet kan samle fristen saman med resten av driftsplanen.",
    month: 12, day: 10, recurrence: "none", category: "deadlines", itemType: "deadline",
    exactDate: "10. desember 2026", sourceName: "Skatteetaten",
    sourceUrl: "https://www.skatteetaten.no/bedrift-og-organisasjon/starte-og-drive/frister-gebyrer-og-tilleggsskatt/frister-og-oppgaver/", sourceVerifiedAt: "2026-08-04",
    applicability: "Berre for verksemder som rapporterer denne mva-terminen.",
    tags: ["mva", "termin"],
  },
];

const INDUSTRY_SOURCES = {
  carpenter: [
    {
      title: "Byggesøknad – ein introduksjon", description: "Fysisk dagskurs i Haugesund, publisert i kursoversikta til Byggmesterforbundet.",
      reason: "Eit konkret bransjekurs kan vurderast opp mot behov, reiseveg og kapasitet.",
      month: 8, day: null, recurrence: "none", category: "professional", itemType: "course",
      exactDate: "12. august 2026 · Haugesund", sourceName: "Byggmesterforbundet",
      sourceUrl: "https://byggmesterforbundet.no/", sourceVerifiedAt: "2026-08-04",
      applicability: "Kontroller pris, ledige plassar og om innhaldet er relevant.",
      tags: ["byggesøknad", "rehabilitering", "tømrar", "handverkar"],
    },
    {
      title: "Kurs i NS 3456 FDVU-dokumentasjon", description: "Digitalt kurs i Standard Norge sin kalender for bygg, anlegg og eigedom.",
      reason: "Kurset kan vere relevant for verksemder som leverer FDVU-dokumentasjon i byggjeprosjekt.",
      month: 8, day: null, recurrence: "none", category: "professional", itemType: "course",
      exactDate: "20. august 2026 · digitalt", sourceName: "Standard Norge",
      sourceUrl: "https://standard.no/kurs-og-radgiving/alle-kurs-og-arrangementer/?Tagg=BYGG%2C+ANLEGG+OG+EIENDOM+%28BAE%29", sourceVerifiedAt: "2026-08-04",
      applicability: "Kontroller nivå, pris og fagleg relevans.",
      tags: ["fdvu", "byggeprosjekt", "dokumentasjon", "tømrar"],
    },
  ],
  hairdresser: [
    {
      title: "NFVB Verneombodskurs – kursstart", description: "NFVB opplyser om kursstart 8.–9. september 2026 som medlemstilbod etter sommaren.",
      reason: "Dette er eit konkret bransjetilbod med oppgitt tidspunkt, ikkje berre eit generelt kursforslag.",
      month: 9, day: null, recurrence: "none", category: "professional", itemType: "course",
      exactDate: "Oppstart 8.–9. september 2026", sourceName: "Norske frisør- og velværebedrifter",
      sourceUrl: "https://nfvb.no/content/2026/08/ha-en-riktig-god-sommer", sourceVerifiedAt: "2026-08-04",
      applicability: "Kontroller målgruppe, lovkrav, medlemspris og ledige plassar hos NFVB.",
      tags: ["verneombod", "frisør", "salong"],
    },
    {
      title: "NFVB Lederprogram – nytt kull", description: "NFVB opplyser at neste kull i leiarprogrammet startar 19.–20. januar 2027.",
      reason: "Eit namngjeve program med konkret dato gir eit reelt val i årshjulet.",
      month: 1, day: null, recurrence: "none", category: "professional", itemType: "course",
      exactDate: "19.–20. januar 2027", sourceName: "Norske frisør- og velværebedrifter",
      sourceUrl: "https://nfvb.no/content/2026/08/ha-en-riktig-god-sommer", sourceVerifiedAt: "2026-08-04",
      applicability: "Kontroller program, pris, opptak og om tidspunktet passar.",
      tags: ["leiing", "frisør", "salong"],
    },
  ],
  photographer: [
    {
      title: "NFF Landskonkurransen 2027 – innleveringsfrist", description: "Landskonkurransen oppgir innleveringsfrist 18. januar 2027 klokka 23.59.",
      reason: "Ein konkret innleveringsfrist gir tid til utval, kvalitetssikring og ferdigstilling.",
      month: 1, day: 18, recurrence: "none", category: "events", itemType: "event",
      exactDate: "18. januar 2027 kl. 23.59", sourceName: "Norges Fotografforbund – Landskonkurransen",
      sourceUrl: "https://www.landskonkurransen.no/", sourceVerifiedAt: "2026-08-04",
      applicability: "Kontroller deltakarvilkår og om konkurransen passar verksemda.",
      tags: ["fotokonkurranse", "fotograf", "portefølje"],
    },
  ],
  cleaning: [
    {
      title: "Kompetansestandard for reinhaldsbransjen", description: "Digital, bransjeretta opplæring via mobil, nettbrett eller PC.",
      reason: "Eit konkret opplæringstilbod er meir handlingsretta enn eit generelt forslag om fagleg utvikling.",
      month: 10, day: null, recurrence: "none", category: "professional", itemType: "course",
      exactDate: "Løpande digital gjennomføring", sourceName: "NHO Service og Handel",
      sourceUrl: "https://www.nhosh.no/bransjer/renhold/kompetansestandard/kompetansestandard-for-renholdsbransjen/", sourceVerifiedAt: "2026-08-04",
      applicability: "Kontroller tilgang, pris, medlemsvilkår og eigna gjennomføringsperiode.",
      tags: ["reinhald", "kompetanse", "opplæring"],
    },
  ],
  restaurant: [
    {
      title: "Restaurant Revenue Management – nettkurs", description: "Digitalt kurs med løpande påmelding for serveringsverksemder.",
      reason: "Kurset kan leggjast til ein rolegare periode for arbeid med kapasitet, pris og etterspurnad.",
      month: 9, day: null, recurrence: "none", category: "professional", itemType: "course",
      exactDate: "Løpande påmelding · digitalt", sourceName: "NHO Reiseliv Akademiet",
      sourceUrl: "https://www.nhoreiseliv.no/akademiet/kurskalender/2025/okonomi/restaurant-revenue-management/", sourceVerifiedAt: "2026-08-04",
      applicability: "Kontroller pris, innhald og om kurset passar driftsforma.",
      tags: ["restaurant", "kapasitet", "pris"],
    },
    {
      title: "HMS-kurs for overnattings- og serveringsbransjen", description: "Kursperioden er oppført frå 24. mars til 14. oktober 2026.",
      reason: "Eit bransjeretta kurs med konkret periode kan vurderast opp mot kapasitet og behov.",
      month: 10, day: null, recurrence: "none", category: "professional", itemType: "course",
      exactDate: "24. mars–14. oktober 2026", sourceName: "NHO Reiseliv Akademiet",
      sourceUrl: "https://www.nhoreiseliv.no/akademiet/kurskalender/", sourceVerifiedAt: "2026-08-04",
      applicability: "Dette er ikkje HMS-rådgiving. Kontroller målgruppe, krav og ledige kursdatoar hos tilbydaren.",
      tags: ["hms", "restaurant", "servering"],
    },
  ],
  office: [
    {
      title: "Inkluderingskonferansen 2026", description: "Konferanse om rekruttering, kompetanse og inkludering, oppført i NHO sin arrangementskalender.",
      reason: "Kan vere relevant for små kontorverksemder som arbeider med rekruttering eller kompetanse.",
      month: 9, day: 16, recurrence: "none", category: "events", itemType: "event",
      exactDate: "16. september 2026 · Bergen", sourceName: "NHO",
      sourceUrl: "https://www.nho.no/arrangementer/Filter", sourceVerifiedAt: "2026-08-04",
      applicability: "Kontroller program, målgruppe, pris og påmeldingsstatus.",
      tags: ["rekruttering", "kompetanse", "kontor"],
    },
    {
      title: "Anskaffelseskonferansen 2026", description: "Årleg konferanse for innkjøparar, leverandørar og andre som arbeider med offentlege anskaffingar.",
      reason: "Kan vere relevant for verksemder som leverer til offentleg sektor.",
      month: 11, day: 3, recurrence: "none", category: "events", itemType: "event",
      exactDate: "3. november 2026 · Oslo", sourceName: "Direktoratet for forvaltning og økonomistyring",
      sourceUrl: "https://www.dfo.no/kurs-og-seminarer/konferanser-i-dfo/anskaffelseskonferansen-2026", sourceVerifiedAt: "2026-08-04",
      applicability: "Kontroller program, pris og om offentlege anskaffingar er relevant for verksemda.",
      tags: ["anskaffingar", "offentleg sektor", "kontor"],
    },
  ],
  other: [
    {
      title: "Søk etter relevante kurs og arrangement hos Innovasjon Norge", description: "Bruk bransje, region og utviklingsbehov for å finne konkrete arrangement i den oppdaterte kalenderen.",
      reason: "Eit kjeldeoppslag kan gi betre forslag enn ein fast standardaktivitet.",
      month: 9, day: null, recurrence: "none", category: "events", itemType: "event",
      exactDate: "Aktuell dato må hentast ved oppslag", sourceName: "Innovasjon Norge",
      sourceUrl: "https://www.innovasjonnorge.no/kurs-og-arrangementer", sourceVerifiedAt: "2026-08-04",
      applicability: "Vel berre arrangement med tydeleg relevans for verksemda.",
      tags: ["generelt"],
    },
  ],
};

function norm(v) {
  return String(v == null ? "" : v).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// Reine oppslagsfunksjonar, skilt frå AI-promten (sjå spec seksjon 14) --
// desse gjer ALDRI eit nettverkskall, dei filtrerer berre den statiske,
// kuraterte lista over.

export function identifyRelevantSourceQueries(profile) {
  var industry = INDUSTRIES.indexOf(profile.industry) !== -1 ? profile.industry : "other";
  var text = norm([profile.businessDescription, profile.importantSeasons, profile.focusAreasText].join(" "));
  var words = text.split(" ").filter(function (w) { return w.length >= 4; });
  return { industry: industry, keywords: words.slice(0, 40) };
}

export function searchApprovedSources(queries) {
  var pool = COMMON_SOURCES.concat(INDUSTRY_SOURCES[queries.industry] || INDUSTRY_SOURCES.other);
  var keywordSet = queries.keywords;
  var scored = pool.map(function (entry) {
    var tagText = norm((entry.tags || []).join(" ") + " " + entry.title + " " + entry.description);
    var hits = keywordSet.reduce(function (n, w) { return tagText.indexOf(w) !== -1 ? n + 1 : n; }, 0);
    return { entry: entry, score: hits };
  });
  // Alltid ta med heile COMMON_SOURCES-settet (offentlege fristar er relevante
  // uavhengig av kor godt friteksten matchar), pluss bransjekjeldene sortert
  // etter treff — kappa til eit rimeleg tal for å halde AI-kontekst liten.
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, 16).map(function (s) { return s.entry; });
}

export function normalizeSourceResults(entries) {
  return entries.map(function (e) {
    var url = String(e.sourceUrl || "");
    return {
      title: String(e.title || "").slice(0, 160),
      description: String(e.description || "").slice(0, 500),
      reason: String(e.reason || "").slice(0, 400),
      month: e.month,
      day: e.day,
      recurrence: e.recurrence === "monthly" ? "monthly" : "none",
      category: CATEGORIES.indexOf(e.category) !== -1 ? e.category : "custom",
      itemType: ["deadline", "course", "event"].indexOf(e.itemType) !== -1 ? e.itemType : "",
      exactDate: String(e.exactDate || "").slice(0, 180),
      sourceName: String(e.sourceName || "").slice(0, 180),
      sourceUrl: /^https:\/\//.test(url) ? url : "",
      sourceVerifiedAt: String(e.sourceVerifiedAt || "").slice(0, 40),
      applicability: String(e.applicability || "").slice(0, 500),
    };
  });
}
