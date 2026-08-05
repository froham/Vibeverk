// api/_lib/oversikt-ai.js — the AI-facing half of Oversikt's server pipeline:
// analyzeSituationInput() → buildOverviewPrompt() → generateOverviewAnalysis()
// (the ONE Anthropic call) → validateOverviewResponse(). Mirrors
// api/_lib/annual-wheel-ai.js's shape/reasoning exactly (see that file's own
// header) — same "structured output via forced tool-use, never free-text
// parsing" requirement, same "server re-clamps every field regardless of
// what the model returns" requirement.
//
// Unlike annual-wheel, Oversikt's items reference EACH OTHER (dependencyEdges
// link two dependencyNodes) -- the model can't know real server-generated ids
// in advance, so dependencyNodes are returned as an ordered array and edges
// reference nodes by 0-based array position (fromIndex/toIndex), resolved to
// real ids server-side in validateOverviewResponse(). The model is NEVER
// trusted to return an acyclic graph on its own -- validateOverviewResponse()
// re-runs real cycle detection and drops any edge that would create one,
// exactly as the reviewed demo's own wouldCreateCycle() does for
// user-edited flows.

var CATEGORIES = ["premises", "equipment", "digital", "operations", "communication", "logistics", "suppliers", "documentation", "visibility", "purchasing", "planning", "workflow", "event", "custom"];
var PRIORITIES = ["low", "normal", "high"];
var IMPACT_LEVELS = ["low", "medium", "high"];
var EDGE_TYPES = ["required-before", "recommended-before"];

var CATEGORY_LABELS = {
  premises: "Lokaler og områder", equipment: "Utstyr", digital: "Digitale tjenester", operations: "Drift",
  communication: "Informasjon og kommunikasjon", logistics: "Logistikk", suppliers: "Leverandører og avtaler",
  documentation: "Dokumentasjon", visibility: "Synlighet", purchasing: "Innkjøp", planning: "Planlegging",
  workflow: "Arbeidsflyt", event: "Arrangement", custom: "Annet",
};

function clampText(v, max) {
  return String(v == null ? "" : v).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, max);
}

// Reine sanering/skalering — sjølve forståinga av teksten skjer inne i
// Anthropic-kallet, ikkje her (spec-krav om ekte forståing, ikkje eit
// nøkkelords-triks, same grunngjeving som annual-wheel-ai.js sin eigen
// analyzeBusinessInput()).
export function analyzeSituationInput(input) {
  return {
    title: clampText(input.title, 90) || "Ny oversikt",
    description: clampText(input.description, 1500),
    scenarioType: clampText(input.scenarioType, 40) || "custom",
    depth: ["simple", "normal", "thorough"].indexOf(input.depth) !== -1 ? input.depth : "normal",
    requestedSections: Array.isArray(input.requestedSections)
      ? input.requestedSections.filter(function (s) { return ["needs", "dependencies", "impacts", "blindSpots"].indexOf(s) !== -1; })
      : ["needs", "dependencies", "impacts", "blindSpots"],
    // Berre TITLAR + kategori av eksisterande punkt, ikkje heile analysen --
    // sjølve samanslåinga (merge-by-normalized-title, lås/eigne punkt-vern)
    // er ein rein, allereie godkjend klient-side algoritme (same som
    // markDuplicates() i module-smart-aarshjul.js er klient-side sjølv om
    // generering er server-side) og treng ingen AI-vurdering. Å ikkje sende
    // heile eksisterande-analysen unngår at ein stor, potensielt sensitiv
    // datamengd sendast på nytt kvar gong brukaren ber om fleire forslag.
    existingItemTitles: Array.isArray(input.existingItemTitles)
      ? input.existingItemTitles.slice(0, 300).map(function (x) {
          return { title: clampText(x && x.title, 160), section: ["needs", "dependencies", "impacts", "blindSpots"].indexOf(x && x.section) !== -1 ? x.section : "needs" };
        })
      : [],
  };
}

export function buildOverviewPrompt(profile) {
  var categoryList = CATEGORIES.map(function (c) { return c + " (" + CATEGORY_LABELS[c] + ")"; }).join(", ");
  var depthGuide = profile.depth === "simple" ? "Hald deg til eit lite, konkret utval (kring 5-7 punkt per seksjon)."
    : profile.depth === "thorough" ? "Ver grundig og dekk breidt (kring 10-14 punkt per seksjon der det er naturleg)."
    : "Bruk eit moderat utval (kring 7-10 punkt per seksjon).";
  var sectionList = profile.requestedSections.length ? profile.requestedSections.join(", ") : "needs, dependencies, impacts, blindSpots";
  var existingText = profile.existingItemTitles.length
    ? profile.existingItemTitles.map(function (x) { return "- " + x.title + " (" + x.section + ")"; }).join("\n")
    : "Ingen frå før.";

  var system = [
    "Du er ein motor bak funksjonen «Oversikt» i Vibeverk Workspace, eit verktøy for norske små og mellomstore verksemder som skal planlegge ei endring, ei flytting, eit arrangement, ei oppstart eller liknande.",
    "Oppgåva di er å gjere ei kort fritekstskildring om til ei strukturert oversikt med FIRE moglege delar: behov (needs), avhengigheiter/rekkefølgje (dependencies), påverknad (impacts) og gløymde punkt (blindSpots).",
    "Analyser skildringa grundig: identifiser kva slags situasjon dette faktisk er, kva som må skje, i kva rekkefølgje, kven/kva som blir påverka, og kva som lett kan bli gløymt.",
    "Generer BERRE dei seksjonane som er bedne om: " + sectionList + ". Andre seksjonar skal vere tomme lister.",
    depthGuide,
    "For \"dependencies\": returner stega som ei ORDNA liste (indeks 0, 1, 2, ...), og bruk SEPARATE kantar (edges) til å uttrykke rekkefølgje via fromIndex/toIndex (0-baserte indeksar inn i den lista). \"required-before\" tyder at steget må vere ferdig før neste kan starte. \"recommended-before\" tyder berre ei tilrådd rekkefølgje, ikkje ei sperre. IKKJE lag ein sirkel (t.d. A før B og B før A).",
    "IKKJE finn opp namngjevne kurs, leverandørar, fristar eller kjelder — dette verktøyet siterer ikkje eksterne kjelder, berre generelle, strukturelle forslag.",
    "Ikkje gi juridisk rådgiving, skatterådgiving eller bindande tolking av plikter.",
    "Ikkje foreslå punkt som allereie finst i lista over eksisterande punkt (samanlikn på tittel/tema, ikkje berre eksakt tekst).",
    "Gyldige kategoriar: " + categoryList + ".",
    "Skriv all tekst på norsk bokmål, i eit roleg og profesjonelt språk (same tone som resten av Vibeverk Workspace) — ikkje chatbot-aktig, ikkje overivrig.",
  ].join(" ");

  var user = [
    "TITTEL: " + profile.title,
    "",
    "TYPE SITUASJON: " + profile.scenarioType,
    "",
    "SKILDRING:",
    profile.description || "(ikkje oppgitt)",
    "",
    "EKSISTERANDE PUNKT (skal ikkje foreslåast på nytt):",
    existingText,
  ].join("\n");

  return { system: system, user: user };
}

function buildToolSchema() {
  var needSchema = {
    type: "object",
    properties: {
      title: { type: "string" }, description: { type: "string" }, reason: { type: "string" },
      category: { type: "string", enum: CATEGORIES }, priority: { type: "string", enum: PRIORITIES },
    },
    required: ["title", "description", "reason", "category", "priority"],
  };
  var nodeSchema = {
    type: "object",
    properties: {
      title: { type: "string" }, description: { type: "string" }, category: { type: "string", enum: CATEGORIES },
      priority: { type: "string", enum: PRIORITIES }, milestone: { type: "boolean" },
    },
    required: ["title", "description", "category"],
  };
  var edgeSchema = {
    type: "object",
    properties: {
      fromIndex: { type: "integer", minimum: 0 }, toIndex: { type: "integer", minimum: 0 },
      type: { type: "string", enum: EDGE_TYPES },
    },
    required: ["fromIndex", "toIndex", "type"],
  };
  var impactSchema = {
    type: "object",
    properties: {
      title: { type: "string" }, description: { type: "string" }, reason: { type: "string" },
      category: { type: "string", enum: CATEGORIES }, impactLevel: { type: "string", enum: IMPACT_LEVELS },
      consequences: { type: "array", items: { type: "string" } },
    },
    required: ["title", "description", "reason", "category", "impactLevel"],
  };
  var blindSchema = {
    type: "object",
    properties: {
      title: { type: "string" }, description: { type: "string" }, reason: { type: "string" },
      category: { type: "string", enum: CATEGORIES }, priority: { type: "string", enum: PRIORITIES },
      suggestedDestination: { type: "string", enum: ["needs", "dependencies", "impacts"] },
    },
    required: ["title", "description", "reason", "category"],
  };
  return {
    name: "return_overview",
    description: "Returner den strukturerte oversikta.",
    input_schema: {
      type: "object",
      properties: {
        detectedSituationProfile: {
          type: "object",
          properties: {
            situationType: { type: "string" }, scale: { type: "string" }, keyThemes: { type: "array", items: { type: "string" } },
          },
          required: ["situationType"],
        },
        summary: { type: "string" },
        needs: { type: "array", items: needSchema },
        dependencyNodes: { type: "array", items: nodeSchema },
        dependencyEdges: { type: "array", items: edgeSchema },
        impacts: { type: "array", items: impactSchema },
        blindSpots: { type: "array", items: blindSchema },
        nextSteps: { type: "array", items: { type: "object", properties: { title: { type: "string" }, description: { type: "string" } }, required: ["title", "description"] } },
      },
      required: ["summary", "needs", "dependencyNodes", "dependencyEdges", "impacts", "blindSpots", "nextSteps"],
    },
  };
}

var DEFAULT_MODEL = "claude-sonnet-5";
// 90s frå fyrste dag -- IKKJE 30s, som var det opphavlege (feilaktige) valet
// for annual-wheel.js sin eigen AbortController og førte til ein reell
// produksjonsfeil (sjå docs/project/CHANGELOG.md 0.95.2). Denne endepunktet
// køyrer alt frå fyrste dag på Node.js runtime (300s tak), så det er
// rikeleg med rom.
var ANTHROPIC_TIMEOUT_MS = 90000;

export async function generateOverviewAnalysis(profile, opts) {
  var apiKey = (opts && opts.apiKey) || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("mangler ANTHROPIC_API_KEY");
  var model = (opts && opts.model) || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  var prompt = buildOverviewPrompt(profile);
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
    // éin gong, sjå annual-wheel-ai.js sin eigen kommentar om denne
    // stadfesta feilen i ei tidlegare utgåve av den fila.
    try { var errBody = await resp.json(); errText = errBody && errBody.error && errBody.error.message; } catch (e) {}
    throw new Error("Anthropic API-feil (HTTP " + resp.status + ")" + (errText ? ": " + errText : ""));
  }
  var data = await resp.json();
  var block = Array.isArray(data.content) && data.content.find(function (b) { return b.type === "tool_use" && b.name === tool.name; });
  if (!block || !block.input) throw new Error("Uventa svarformat frå AI-modellen (mangla tool_use)");
  return block.input;
}

function clampCategory(v) { return CATEGORIES.indexOf(v) !== -1 ? v : "custom"; }
function clampPriority(v) { return PRIORITIES.indexOf(v) !== -1 ? v : "normal"; }
function clampImpact(v) { return IMPACT_LEVELS.indexOf(v) !== -1 ? v : "medium"; }

// Cyklus-sjekk over HEILE kant-lista på éin gong (ikkje inkrementelt som
// demoen sin eigen wouldCreateCycle(), sidan vi her validerer eit heilt
// AI-generert sett samla, ikkje éi kant lagt til om gongen). DFS med
// stack-spor for å oppdage attendekantar, same algoritme.
function stripCyclicEdges(nodeIds, rawEdges) {
  var adj = {};
  nodeIds.forEach(function (id) { adj[id] = []; });
  var kept = [];
  rawEdges.forEach(function (e) {
    adj[e.from].push(e.to);
    var seen = {}, stack = {};
    var hasCycle = false;
    var visit = function (id) {
      if (stack[id]) { hasCycle = true; return; }
      if (seen[id] || hasCycle) return;
      seen[id] = true; stack[id] = true;
      (adj[id] || []).forEach(visit);
      stack[id] = false;
    };
    nodeIds.forEach(function (id) { if (!hasCycle) visit(id); });
    if (hasCycle) {
      adj[e.from].pop();
    } else {
      kept.push(e);
    }
  });
  return kept;
}

// Klemmer/validerer AI-svaret til NØYAKTIG same form klienten sin eigen
// validateState()/cleanItem() forventar (module-oversikt.js) -- uventa/ekstra
// felt frå modellen slepp ALDRI gjennom, og alle id-ar er server-genererte
// (stolar aldri på modellen sin eigen indeksering utover fromIndex/toIndex,
// som berre brukast internt her for å byggje ekte id-baserte kantar).
export function validateOverviewResponse(raw, inputProfile) {
  if (!raw || typeof raw !== "object") throw new Error("Tomt eller ugyldig AI-svar");
  var detectedProfile = raw.detectedSituationProfile && typeof raw.detectedSituationProfile === "object" ? raw.detectedSituationProfile : {};
  var input = inputProfile && typeof inputProfile === "object" ? inputProfile : {};
  var stamp = Date.now().toString(36);

  var needs = (Array.isArray(raw.needs) ? raw.needs : []).slice(0, 60).map(function (x, i) {
    if (!x || typeof x !== "object" || !clampText(x.title, 160)) return null;
    return {
      id: "need-" + (i + 1) + "-" + stamp, title: clampText(x.title, 160), description: clampText(x.description, 900),
      reason: clampText(x.reason, 700) || "Kan være relevant å vurdere.", category: clampCategory(x.category), priority: clampPriority(x.priority),
      status: "suggested", source: "smart-analysis", selected: true, approvalStatus: "suggested",
      locked: false, important: x.priority === "high", relatedIds: [], isNew: false, duplicateOf: null,
    };
  }).filter(Boolean);

  var dependencyNodes = (Array.isArray(raw.dependencyNodes) ? raw.dependencyNodes : []).slice(0, 60).map(function (x, i) {
    if (!x || typeof x !== "object" || !clampText(x.title, 160)) return null;
    return {
      id: "step-" + (i + 1) + "-" + stamp, title: clampText(x.title, 160), description: clampText(x.description, 900),
      category: clampCategory(x.category), priority: clampPriority(x.priority), status: "not-started", source: "smart-analysis",
      selected: true, approvalStatus: "suggested", locked: false, important: x.priority === "high", relatedIds: [],
      isNew: false, duplicateOf: null, dependsOn: [], blocks: [], milestone: !!x.milestone,
      reason: "Steget er foreslått som en del av den praktiske rekkefølgen.",
    };
  });
  var validNodeSlots = dependencyNodes.map(function (n, i) { return n ? i : -1; });

  var rawEdges = (Array.isArray(raw.dependencyEdges) ? raw.dependencyEdges : []).map(function (e) {
    var fromIdx = +(e && e.fromIndex), toIdx = +(e && e.toIndex);
    if (!Number.isInteger(fromIdx) || !Number.isInteger(toIdx)) return null;
    if (fromIdx === toIdx || validNodeSlots.indexOf(fromIdx) === -1 || validNodeSlots.indexOf(toIdx) === -1) return null;
    var from = dependencyNodes[fromIdx], to = dependencyNodes[toIdx];
    if (!from || !to) return null;
    return { from: from.id, to: to.id, type: EDGE_TYPES.indexOf(e.type) !== -1 ? e.type : "required-before" };
  }).filter(Boolean);

  var cleanNodes = dependencyNodes.filter(Boolean);
  var cleanNodeIds = cleanNodes.map(function (n) { return n.id; });
  var safeEdges = stripCyclicEdges(cleanNodeIds, rawEdges);
  safeEdges.forEach(function (e, i) { e.id = "edge-" + (i + 1) + "-" + stamp; });
  var byId = {};
  cleanNodes.forEach(function (n) { byId[n.id] = n; });
  safeEdges.forEach(function (e) { byId[e.from].blocks.push(e.to); byId[e.to].dependsOn.push(e.from); });

  var impacts = (Array.isArray(raw.impacts) ? raw.impacts : []).slice(0, 60).map(function (x, i) {
    if (!x || typeof x !== "object" || !clampText(x.title, 160)) return null;
    return {
      id: "impact-" + (i + 1) + "-" + stamp, title: clampText(x.title, 160), description: clampText(x.description, 900),
      reason: clampText(x.reason, 700) || "Kan være relevant å vurdere.", category: clampCategory(x.category), impactLevel: clampImpact(x.impactLevel),
      status: "suggested", source: "smart-analysis", selected: true, approvalStatus: "suggested", locked: false,
      important: x.impactLevel === "high", relatedIds: [], isNew: false, duplicateOf: null,
      consequences: (Array.isArray(x.consequences) ? x.consequences : []).slice(0, 6).map(function (c) { return clampText(c, 400); }).filter(Boolean),
    };
  }).filter(Boolean);

  var blindSpots = (Array.isArray(raw.blindSpots) ? raw.blindSpots : []).slice(0, 60).map(function (x, i) {
    if (!x || typeof x !== "object" || !clampText(x.title, 160)) return null;
    return {
      id: "blind-" + (i + 1) + "-" + stamp, title: clampText(x.title, 160), description: clampText(x.description, 900),
      reason: clampText(x.reason, 700) || "Kan være relevant å vurdere.", category: clampCategory(x.category), priority: clampPriority(x.priority),
      status: "suggested", source: "smart-analysis", selected: true, approvalStatus: "suggested", locked: false,
      important: x.priority === "high", relatedIds: [], isNew: false, duplicateOf: null,
      suggestedDestination: ["needs", "dependencies", "impacts"].indexOf(x.suggestedDestination) !== -1 ? x.suggestedDestination : "needs",
    };
  }).filter(Boolean);

  var nextSteps = (Array.isArray(raw.nextSteps) ? raw.nextSteps : []).slice(0, 6).map(function (x, i) {
    if (!x || typeof x !== "object" || !clampText(x.title, 160)) return null;
    return { id: "next-" + (i + 1) + "-" + stamp, title: clampText(x.title, 160), description: clampText(x.description, 400) };
  }).filter(Boolean);

  return {
    analysisId: "overview-" + stamp,
    // title/description/scenarioType kjem frå den ORIGINALE førespurnaden
    // (input), ALDRI frå AI-svaret -- verktøyskjemaet ber aldri modellen om
    // å ekkoe desse tilbake (dei er alt kjende), så dei må hentast herifrå.
    // Retta 2026-08-05 etter tryggleiksgjennomgang: tidlegare versjon sette
    // aldri desse feltet i det heile, så klienten sin eigen fallback
    // ("Ny oversikt") vann kvar einaste gong -- brukaren sin faktiske tittel
    // gjekk tapt både ved fyrste generering OG ved "Oppdater oversikten"
    // (som då ville overskrive ein alt eksisterande tittel med det generiske
    // fallback-namnet via mergeAnalysis()).
    title: clampText(input.title, 90) || "Ny oversikt",
    description: clampText(input.description, 1500),
    scenarioType: clampText(input.scenarioType, 40) || "custom",
    detectedSituationProfile: {
      situationType: clampText(detectedProfile.situationType, 160), scale: clampText(detectedProfile.scale, 160),
      keyThemes: Array.isArray(detectedProfile.keyThemes) ? detectedProfile.keyThemes.map(function (t) { return clampText(t, 100); }).filter(Boolean).slice(0, 12) : [],
    },
    summary: clampText(raw.summary, 800) || "Oversikten samler forslag til behov, rekkefølge og påvirkede områder.",
    disclaimer: "Dette er forslag til struktur og vurderingspunkter, ikke en fullstendig faglig vurdering.",
    needs: needs, dependencyNodes: cleanNodes, dependencyEdges: safeEdges, impacts: impacts, blindSpots: blindSpots, nextSteps: nextSteps,
  };
}
