// api/_lib/annual-wheel-ai.js — the AI-facing half of Smart årshjul's server
// pipeline: analyzeBusinessInput() → buildAnnualWheelPrompt() →
// generateAnnualWheelSuggestions() (the ONE Anthropic call) →
// validateAnnualWheelResponse(). Deliberately separate from
// annual-wheel-sources.js's pure, network-free lookup layer (spec section 14).
//
// Structured output via Anthropic tool-use (forced tool_choice), not text
// parsing — spec section 10 explicitly forbids parsing a plain-text reply.
// The model can only ever pick/adapt entries from the sourceResults it's
// given (never invent a course/messe/frist), and validateAnnualWheelResponse()
// re-clamps every field server-side regardless of what the model returns, so
// a misbehaving completion can't smuggle bad data past this endpoint.

import { CATEGORIES } from "./annual-wheel-sources.js";

var ITEM_TYPES = ["", "deadline", "course", "event"];
var RECURRENCE = ["none", "monthly"];

var CATEGORY_LABELS = {
  planning: "Planlegging", marketing: "Synlegheit og marknadsføring", seasonal: "Sesong og kampanjar",
  maintenance: "Drift og vedlikehald", purchasing: "Innkjøp og leverandørar", digital: "Nettside og digital synlegheit",
  professional: "Fagleg utvikling", events: "Messer og arrangement", administration: "Administrasjon",
  deadlines: "Offentlege fristar", evaluation: "Evaluering og årsavslutning", custom: "Eigendefinert",
};

function clampText(v, max) {
  // Fjern C0-kontrollteikn (unntatt linjeskift/tab) -- reint tekstnivå-vern,
  // HTML-escaping skjer klient-side ved rendring (esc()).
  return String(v == null ? "" : v).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, max);
}

// Reine sanering/skalering — den faktiske forståinga av teksten (bransje,
// underbransje, behov osv.) skjer inne i sjølve Anthropic-kallet, ikkje her
// via lokal NLP-gjetting (spec seksjon 7 krev ekte forståing, ikkje eit
// nøkkelords-triks som later som det er analyse).
export function analyzeBusinessInput(input) {
  var existing = Array.isArray(input.existingActivities) ? input.existingActivities.slice(0, 500) : [];
  return {
    industry: clampText(input.industry, 40) || "other",
    businessDescription: clampText(input.businessDescription, 1200),
    importantSeasons: clampText(input.importantSeasons, 700),
    focusAreasText: clampText(input.focusAreasText, 700),
    existingActivities: existing.map(function (a) {
      return {
        title: clampText(a && a.title, 160),
        month: a && Number.isInteger(a.month) ? a.month : null,
        category: a && CATEGORIES.indexOf(a.category) !== -1 ? a.category : "custom",
        recurrence: a && a.recurrence === "monthly" ? "monthly" : "none",
        locked: !!(a && a.locked),
      };
    }),
  };
}

export function buildAnnualWheelPrompt(profile, sourceResults) {
  var categoryList = CATEGORIES.map(function (c) { return c + " (" + CATEGORY_LABELS[c] + ")"; }).join(", ");
  var sourcesText = sourceResults.length
    ? sourceResults.map(function (s, i) {
        return (i + 1) + ". " + s.title + " — " + s.sourceName + (s.exactDate ? ", " + s.exactDate : "") +
          (s.sourceUrl ? " (" + s.sourceUrl + ")" : "") + ". " + s.description;
      }).join("\n")
    : "Ingen kuraterte kjelder trefte godt på denne verksemda.";
  var existingText = profile.existingActivities.length
    ? profile.existingActivities.map(function (a) {
        return "- " + a.title + " (kategori: " + a.category + ", " + (a.recurrence === "monthly" ? "kvar månad" : "månad " + a.month) + (a.locked ? ", låst" : "") + ")";
      }).join("\n")
    : "Ingen frå før.";

  var system = [
    "Du er ein motor bak funksjonen «Smart årshjul» i Vibeverk Workspace, eit verktøy for norske små og mellomstore verksemder.",
    "Oppgåva di er å foreslå aktivitetar til eit årshjul (12 månader), basert på bransje og fritekst om verksemda brukaren har skrive.",
    "Du skal analysere teksten grundig: identifiser hovudbransje, eventuell underbransje/spesialisering, om verksemda har tilsette og omtrent kor mange, sesongmønster, og konkrete uttrykte behov.",
    "Bruk desse funna til å prioritere og tilpasse forslaga — presis fritekst skal kunne overstyre generelle bransjeforslag.",
    "Du skal IKKJE dikte opp kursnamn, datoar, prisar, arrangørar, messer, arrangement eller kjeldelenkjer.",
    "For konkrete kurs/messer/arrangement/offentlege fristar: bruk BERRE dei kuraterte kjeldene som er lista opp under. Du kan velje, tilpasse teksten og forklare relevansen, men aldri leggje til eit nytt namn, ein ny dato eller ein ny lenkje som ikkje finst i lista.",
    "Dersom ingen kurert kjelde passar godt til eit behov du har identifisert, kan du likevel foreslå eit generelt søkeforslag (t.d. «Sjå etter eit kurs om ...») — då MÅ verificationRequired vere true og sourceUrl/sourceName stå tomme.",
    "Ikkje gi juridisk rådgiving, skatterådgiving, rekneskapsrådgiving eller bindande tolking av plikter eller fristar. Offentlege fristar skal alltid ha verificationRequired: true.",
    "Ikkje foreslå aktivitetar som allereie finst i lista over eksisterande aktivitetar (samanlikn på tittel/tema, ikkje berre eksakt tekst).",
    "Gyldige kategoriar: " + categoryList + ".",
    "Skriv all tekst i forslaga på norsk nynorsk, i eit roleg og profesjonelt språk (same tone som resten av Vibeverk Workspace) — ikkje chatbot-aktig, ikkje overivrig.",
    "Foreslå mellom 18 og 30 aktivitetar totalt, spreidde fornuftig gjennom året, med minst nokre frå dei kuraterte kjeldene dersom relevante finst.",
  ].join(" ");

  var user = [
    "BRANSJE (utgangspunkt, kan presiserast av friteksten): " + profile.industry,
    "",
    "SKILDRING AV VERKSEMDA:",
    profile.businessDescription || "(ikkje oppgitt)",
    "",
    "VIKTIGE SESONGAR:",
    profile.importantSeasons || "(ikkje oppgitt)",
    "",
    "ØNSKTE FOKUSOMRÅDE:",
    profile.focusAreasText || "(ikkje oppgitt)",
    "",
    "EKSISTERANDE AKTIVITETAR (skal ikkje foreslåast på nytt):",
    existingText,
    "",
    "KURATERTE KJELDER DU KAN VELJE FRÅ (bruk berre desse for konkrete kurs/messer/arrangement/fristar):",
    sourcesText,
  ].join("\n");

  return { system: system, user: user };
}

function buildToolSchema() {
  var suggestionSchema = {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      reason: { type: "string" },
      month: { type: "integer", minimum: 1, maximum: 12 },
      day: { type: ["integer", "null"] },
      recurrence: { type: "string", enum: RECURRENCE },
      category: { type: "string", enum: CATEGORIES },
      itemType: { type: "string", enum: ITEM_TYPES },
      verificationRequired: { type: "boolean" },
      sourceName: { type: "string" },
      sourceUrl: { type: "string" },
      sourceVerifiedAt: { type: "string" },
      exactDate: { type: "string" },
      applicability: { type: "string" },
    },
    required: ["title", "description", "reason", "month", "recurrence", "category"],
  };
  return {
    name: "return_annual_wheel_plan",
    description: "Returner det strukturerte årshjul-forslaget.",
    input_schema: {
      type: "object",
      properties: {
        detectedBusinessProfile: {
          type: "object",
          properties: {
            primaryIndustry: { type: "string" },
            specialization: { type: "string" },
            hasEmployees: { type: "boolean" },
            employeeCountApproximation: { type: ["integer", "null"] },
            seasonalPattern: { type: "string" },
            identifiedNeeds: { type: "array", items: { type: "string" } },
          },
          required: ["primaryIndustry"],
        },
        summary: { type: "string" },
        suggestions: { type: "array", items: suggestionSchema },
      },
      required: ["detectedBusinessProfile", "summary", "suggestions"],
    },
  };
}

var DEFAULT_MODEL = "claude-haiku-4-5-20251001";
// 30000 var trygt nok under Edge sitt gamle 25s-plattformtak, men var i
// praksis for stramt for det ekte kallet: generering av 18-30 strukturerte
// tool-use-forslag (max_tokens 8000) med ei fyldig verksemdskildring tok i
// praksis over 30s og vart avbrote av VÅR EIGEN AbortController (stadfesta
// mot ekte produksjonslogg 2026-08-05: "error: 'This operation was aborted'",
// ikkje ein plattform-504) -- no som endepunktet køyrer på Node.js runtime
// (300s tak, sjå annual-wheel.js sin eigen kommentar), er det rikeleg med
// rom til å gje det ekte kallet meir tid i staden for å kutte det kunstig.
var ANTHROPIC_TIMEOUT_MS = 90000;

export async function generateAnnualWheelSuggestions(profile, sourceResults, opts) {
  var apiKey = (opts && opts.apiKey) || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("mangler ANTHROPIC_API_KEY");
  var model = (opts && opts.model) || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  var prompt = buildAnnualWheelPrompt(profile, sourceResults);
  var tool = buildToolSchema();

  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, ANTHROPIC_TIMEOUT_MS);
  var resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 8000,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    var errText = "";
    // Berre éin resp.json()-lesing -- ein Response-kropp kan berre lesast
    // éin gong ("body stream already read"), så eit andre kall her ville
    // kasta og gjeve tomt errText for kvar einaste HTTP-feil, uansett kva
    // Anthropic faktisk svarte (stadfesta feil i tidlegare versjon av denne fila).
    try { var errBody = await resp.json(); errText = errBody && errBody.error && errBody.error.message; } catch (e) {}
    throw new Error("Anthropic API-feil (HTTP " + resp.status + ")" + (errText ? ": " + errText : ""));
  }
  var data = await resp.json();
  var block = Array.isArray(data.content) && data.content.find(function (b) { return b.type === "tool_use" && b.name === tool.name; });
  if (!block || !block.input) throw new Error("Uventa svarformat frå AI-modellen (mangla tool_use)");
  return block.input;
}

function clampMonth(v) {
  var n = +v;
  return Number.isInteger(n) && n > 0 && n < 13 ? n : 1;
}
function clampDay(v) {
  if (v === "" || v === null || v === undefined) return null;
  var n = +v;
  return Number.isInteger(n) && n > 0 && n < 32 ? n : null;
}

// Klemmer/valider AI-svaret til NØYAKTIG same form klienten sin egen
// cleanActivity()/validate() forventar (module-smart-aarshjul.js) —
// uventa/ekstra felt frå modellen blir aldri sleppte gjennom.
export function validateAnnualWheelResponse(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Tomt eller ugyldig AI-svar");
  var profile = raw.detectedBusinessProfile && typeof raw.detectedBusinessProfile === "object" ? raw.detectedBusinessProfile : {};
  var suggestionsIn = Array.isArray(raw.suggestions) ? raw.suggestions.slice(0, 60) : [];

  var suggestions = suggestionsIn.map(function (x, i) {
    if (!x || typeof x !== "object" || !clampText(x.title, 160)) return null;
    var url = String(x.sourceUrl || "");
    return {
      id: "suggestion-" + (i + 1) + "-" + Date.now().toString(36),
      title: clampText(x.title, 160),
      description: clampText(x.description, 900),
      reason: clampText(x.reason, 700),
      month: clampMonth(x.month),
      day: clampDay(x.day),
      recurrence: RECURRENCE.indexOf(x.recurrence) !== -1 ? x.recurrence : "none",
      category: CATEGORIES.indexOf(x.category) !== -1 ? x.category : "custom",
      source: "smart-suggestion",
      itemType: ITEM_TYPES.indexOf(x.itemType) !== -1 ? x.itemType : "",
      verificationRequired: !!x.verificationRequired,
      selected: !x.verificationRequired,
      locked: false,
      duplicateOf: null,
      sourceName: clampText(x.sourceName, 180),
      sourceUrl: /^https:\/\//.test(url) ? url : "",
      sourceVerifiedAt: clampText(x.sourceVerifiedAt, 80),
      exactDate: clampText(x.exactDate, 180),
      applicability: clampText(x.applicability, 500),
    };
  }).filter(Boolean);

  return {
    analysisId: "annual-wheel-" + Date.now().toString(36),
    detectedBusinessProfile: {
      primaryIndustry: clampText(profile.primaryIndustry, 160),
      specialization: clampText(profile.specialization, 200),
      hasEmployees: !!profile.hasEmployees,
      employeeCountApproximation: Number.isInteger(profile.employeeCountApproximation) ? profile.employeeCountApproximation : null,
      seasonalPattern: clampText(profile.seasonalPattern, 300),
      identifiedNeeds: Array.isArray(profile.identifiedNeeds) ? profile.identifiedNeeds.map(function (n) { return clampText(n, 100); }).filter(Boolean).slice(0, 12) : [],
    },
    summary: clampText(raw.summary, 800),
    disclaimer: "Kjeldebaserte forslag må alltid kontrollerast mot originalkjelda før bruk. Dette er ikkje juridisk rådgiving, skatterådgiving eller rekneskapsrådgiving.",
    suggestions: suggestions,
  };
}
