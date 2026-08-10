import { clampText } from "./customer-analysis-html.js";

var DEFAULT_MODEL = "claude-haiku-4-5-20251001";
var TIMEOUT_MS = 90000;
var CATEGORIES = ["content", "privacy", "seo", "accessibility", "strength"];
var PRIORITIES = ["low", "medium", "high"];
var CONFIDENCE = ["low", "medium", "high"];

function buildTool(serviceCodes) {
  var serviceCodeItems = { type: "string" };
  if (serviceCodes.length) serviceCodeItems.enum = serviceCodes;
  return {
    name: "return_customer_analysis",
    description: "Returner en forsiktig, kildeforankret innholdsvurdering.",
    input_schema: {
      type: "object",
      properties: {
        businessSummary: { type: "string" },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: CATEGORIES },
              title: { type: "string" },
              observation: { type: "string" },
              sourceUrl: { type: "string" },
              evidenceQuote: { type: "string" },
              significance: { type: "string" },
              recommendation: { type: "string" },
              priority: { type: "string", enum: PRIORITIES },
              confidence: { type: "string", enum: CONFIDENCE },
              serviceCodes: { type: "array", items: serviceCodeItems },
              serviceRationale: { type: "string" }
            },
            required: ["category", "title", "observation", "sourceUrl", "evidenceQuote", "significance", "recommendation", "priority", "confidence", "serviceCodes", "serviceRationale"]
          }
        },
        meetingQuestions: { type: "array", items: { type: "string" } }
      },
      required: ["businessSummary", "findings", "meetingQuestions"]
    }
  };
}

export function buildCustomerAnalysisPrompt(profile, pages, automaticFindings, catalog) {
  var sourceText = pages.slice(0, 5).map(function (page, index) {
    return [
      "KILDE " + (index + 1),
      "URL: " + page.finalUrl,
      "Tittel: " + (page.title || "(mangler)"),
      "Renset tekstutdrag: " + (page.textExcerpt || "(tomt)")
    ].join("\n");
  }).join("\n\n");
  var findingText = automaticFindings.slice(0, 60).map(function (item) {
    return "- [" + item.category + "] " + item.title + " — " + item.observation + " (" + item.sourceUrl + ")";
  }).join("\n");
  var catalogText = catalog.filter(function (item) { return item.active; }).map(function (item) {
    return "- " + item.code + ": " + item.title + " [" + item.delivery_status + "] — " + item.description;
  }).join("\n");

  return {
    system: [
      "Du bistår et internt, norsk salgsverktøy for Vibeverk. Vurder bare det begrensede kildematerialet som følger.",
      "Skill dokumenterbar observasjon fra forslag. Ikke anta at en tjeneste eller opplysning mangler bare fordi den ikke finnes i utvalget.",
      "Hvert funn må ha en kort evidenceQuote som finnes ordrett i tekstutdraget for nøyaktig samme sourceUrl. Hvis du ikke har et slikt belegg, skal du ikke returnere funnet.",
      "Ikke trekk juridiske konklusjoner, ikke dikt opp lover, krav, leverandører, priser eller egenskaper ved virksomheten.",
      "Bruk forsiktige formuleringer som «bør undersøkes manuelt» ved svakt grunnlag, og sett confidence=low.",
      "Koble bare til serviceCodes fra katalogen. delivery_status=adaptation skal omtales som mulig tilpasning, ikke ferdig funksjon.",
      "Automatiske funn er kontekst, ikke en invitasjon til å gjenta dem. Lag bare supplerende innholds-, brukerreise- eller styrkefunn som kildeteksten støtter.",
      "Skriv nøkternt norsk bokmål. Alt er internt utkast og skal gjennom menneskelig kontroll."
    ].join(" "),
    user: [
      "VIRKSOMHET: " + clampText(profile.companyName, 200),
      "BRANSJE OPPGITT AV OPERATØR: " + (clampText(profile.industry, 160) || "Ikke oppgitt"),
      "NETTSTED: " + clampText(profile.websiteUrl, 2048),
      "",
      "VIBEVERK-KATALOG:", catalogText || "Ingen aktive tjenester.",
      "",
      "AUTOMATISKE FUNN:", findingText || "Ingen.",
      "",
      "KILDER:", sourceText || "Ingen lesbare kilder."
    ].join("\n")
  };
}

function normalizeComparable(value) {
  return clampText(value, 5000).toLocaleLowerCase("nb-NO");
}

export function validateCustomerAnalysisAi(raw, pages, catalog) {
  if (!raw || typeof raw !== "object") throw new Error("Tomt eller ugyldig AI-svar");
  var pageByUrl = {};
  pages.forEach(function (page) { pageByUrl[page.finalUrl] = page; });
  var catalogByCode = {};
  catalog.forEach(function (item) { if (item.active) catalogByCode[item.code] = item; });

  var findings = (Array.isArray(raw.findings) ? raw.findings : []).slice(0, 30).map(function (item) {
    if (!item || typeof item !== "object") return null;
    var sourceUrl = clampText(item.sourceUrl, 2048);
    var page = pageByUrl[sourceUrl];
    var quote = clampText(item.evidenceQuote, 500);
    if (!page || !quote || normalizeComparable(page.textExcerpt).indexOf(normalizeComparable(quote)) === -1) return null;
    var title = clampText(item.title, 240);
    var observation = clampText(item.observation, 2000);
    if (!title || !observation) return null;
    var codes = Array.isArray(item.serviceCodes)
      ? Array.from(new Set(item.serviceCodes.filter(function (code) { return !!catalogByCode[code]; }))).slice(0, 4)
      : [];
    return {
      category: CATEGORIES.indexOf(item.category) !== -1 ? item.category : "content",
      title: title,
      observation: observation,
      sourceUrl: sourceUrl,
      affectedElement: quote,
      significance: clampText(item.significance, 1600),
      recommendation: clampText(item.recommendation, 1600),
      priority: PRIORITIES.indexOf(item.priority) !== -1 ? item.priority : "medium",
      findingType: "ai",
      confidence: CONFIDENCE.indexOf(item.confidence) !== -1 ? item.confidence : "low",
      evidence: { quote: quote },
      serviceCodes: codes,
      serviceRationale: clampText(item.serviceRationale, 1200)
    };
  }).filter(Boolean);

  return {
    businessSummary: clampText(raw.businessSummary, 1200),
    findings: findings,
    meetingQuestions: (Array.isArray(raw.meetingQuestions) ? raw.meetingQuestions : [])
      .map(function (value) { return clampText(value, 300); }).filter(Boolean).slice(0, 12)
  };
}

export async function generateCustomerAnalysis(profile, pages, automaticFindings, catalog, options) {
  var apiKey = options && options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { status: "not_configured", result: null };
  var model = options && options.model || process.env.CUSTOMER_ANALYSIS_ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  var fetchImpl = options && options.fetch || fetch;
  var prompt = buildCustomerAnalysisPrompt(profile, pages, automaticFindings, catalog);
  var tool = buildTool(catalog.filter(function (item) { return item.active; }).map(function (item) { return item.code; }));
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, options && options.timeoutMs || TIMEOUT_MS);
  var response;
  try {
    response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: model, max_tokens: 5000, system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        tools: [tool], tool_choice: { type: "tool", name: tool.name }
      }),
      signal: controller.signal
    });
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error("Anthropic API-feil (HTTP " + response.status + ")");
  var data = await response.json();
  var block = Array.isArray(data.content) && data.content.find(function (item) { return item.type === "tool_use" && item.name === tool.name; });
  if (!block || !block.input) throw new Error("Uventet svarformat fra AI-modellen");
  return { status: "completed", result: validateCustomerAnalysisAi(block.input, pages, catalog), model: model };
}

function meetingTool() {
  var referencedText = {
    type: "object",
    properties: { findingId: { type:"string" }, text: { type:"string" } },
    required: ["findingId", "text"]
  };
  return {
    name:"return_meeting_brief",
    description:"Returner et respektfullt møteutkast basert bare på godkjente funn.",
    input_schema:{
      type:"object",
      properties:{
        strengths:{ type:"array", items:referencedText },
        opportunities:{ type:"array", items:{ type:"object", properties:{ findingId:{type:"string"}, title:{type:"string"}, text:{type:"string"}, recommendation:{type:"string"} }, required:["findingId","title","text","recommendation"] } },
        questions:{ type:"array", items:referencedText },
        nextStep:{ type:"string" }
      },
      required:["strengths","opportunities","questions","nextStep"]
    }
  };
}

function validateMeetingDraft(raw, approvedFindings) {
  if (!raw || typeof raw !== "object") throw new Error("Tomt eller ugyldig møteutkast");
  var byId = {};
  approvedFindings.forEach(function (item) { byId[item.id] = item; });
  function referenced(items, category) {
    return (Array.isArray(items) ? items : []).map(function (item) {
      if (!item || !byId[item.findingId] || category && byId[item.findingId].category !== category) return null;
      var text = clampText(item.text, 700);
      return text ? { findingId:item.findingId, text:text } : null;
    }).filter(Boolean);
  }
  var opportunities = (Array.isArray(raw.opportunities) ? raw.opportunities : []).map(function (item) {
    if (!item || !byId[item.findingId] || byId[item.findingId].category === "strength") return null;
    var title = clampText(item.title, 240);
    var text = clampText(item.text, 1000);
    if (!title || !text) return null;
    return { findingId:item.findingId, title:title, text:text, recommendation:clampText(item.recommendation, 900) };
  }).filter(Boolean).slice(0, 7);
  return {
    strengths:referenced(raw.strengths, "strength").slice(0, 5),
    opportunities:opportunities,
    questions:referenced(raw.questions).slice(0, 7),
    nextStep:clampText(raw.nextStep, 700)
  };
}

export async function generateMeetingBriefDraft(analysis, approvedFindings, services, options) {
  var apiKey = options && options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { status:"not_configured", result:null };
  var model = options && options.model || process.env.CUSTOMER_ANALYSIS_ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  var fetchImpl = options && options.fetch || fetch;
  var tool = meetingTool();
  var source = approvedFindings.map(function (item) {
    return ["ID: " + item.id, "Kategori: " + item.category, "Tittel: " + item.title, "Observasjon: " + item.observation, "Betydning: " + item.significance, "Godkjent tiltak: " + item.recommendation].join("\n");
  }).join("\n\n");
  var serviceText = services.map(function (item) { return item.title + " [" + item.deliveryStatus + "]"; }).join(", ");
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, options && options.timeoutMs || TIMEOUT_MS);
  var response;
  try {
    response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01" },
      body:JSON.stringify({
        model:model, max_tokens:3000,
        system:"Lag et respektfullt, nøkternt møteutkast på norsk bokmål. Bruk bare funnene med oppgitte ID-er. Hvert punkt og spørsmål må referere til ett av disse. Ikke legg til juridiske konklusjoner, mangler, fakta, priser eller tjenester. Et redigert eller ikke-vurdert funn er ikke med i kilden. Internnotater er bevisst utelatt.",
        messages:[{ role:"user", content:"VIRKSOMHET: " + clampText(analysis.company_name, 200) + "\nNETTSTED: " + clampText(analysis.website_url, 2048) + "\nMULIGE LEVERANSER: " + serviceText + "\n\nUTTRYKKELIG GODKJENTE FUNN:\n" + source }],
        tools:[tool], tool_choice:{ type:"tool", name:tool.name }
      }), signal:controller.signal
    });
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error("Anthropic API-feil (HTTP " + response.status + ")");
  var data = await response.json();
  var block = Array.isArray(data.content) && data.content.find(function (item) { return item.type === "tool_use" && item.name === tool.name; });
  if (!block || !block.input) throw new Error("Uventet svarformat fra AI-modellen");
  return { status:"completed", result:validateMeetingDraft(block.input, approvedFindings), model:model };
}

export { validateMeetingDraft };
