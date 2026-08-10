// Authenticated Node.js Vercel Function for Vibeverk Console's Kundeanalyse.
// All external-site fetching happens server-side through the DNS-pinned
// client. The browser never contacts a prospect site directly.

import { validateAnalysisUrl } from "./_lib/customer-analysis-secure-fetch.js";
import { crawlWebsite } from "./_lib/customer-analysis-crawler.js";
import { generateCustomerAnalysis, generateMeetingBriefDraft, resolveRequestedModel } from "./_lib/customer-analysis-ai.js";
import { verifyConsoleOperator, rest, auditEvent, getAnalysis, getCatalog, claimRun } from "./_lib/customer-analysis-store.js";
import { clampText } from "./_lib/customer-analysis-html.js";
import { canTransition, buildMeetingBrief } from "./_lib/customer-analysis-domain.js";

export const maxDuration = 300;

var STATUS = ["draft", "pending", "analyzing", "review_ready", "reviewed", "failed", "archived"];
var REVIEW = ["unreviewed", "approved", "edited", "removed"];
var PRIORITY = ["low", "medium", "high"];
var CATEGORIES = ["technical", "seo", "accessibility", "privacy", "content", "strength"];
var recentRuns = new Map();

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function error(status, message, code) { return json({ error: message, code: code || "request_failed" }, status); }

function bearer(request) {
  var match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "");
  return match && match[1];
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function rateLimited(userId) {
  var now = Date.now();
  var hits = (recentRuns.get(userId) || []).filter(function (time) { return now - time < 10 * 60 * 1000; });
  hits.push(now);
  recentRuns.set(userId, hits);
  return hits.length > 3;
}

async function requireAudit(event) {
  var written = await auditEvent(event);
  if (!written) throw Object.assign(new Error("Hendelsesloggen er utilgjengelig. Handlingen ble avbrutt."), { publicStatus:503, publicCode:"audit_unavailable" });
}

function snakeFinding(item, analysisId, runId, operatorId) {
  return {
    analysis_id: analysisId, run_id: runId || null, category: item.category,
    title: clampText(item.title, 240), observation: clampText(item.observation, 2000),
    source_url: item.sourceUrl ? clampText(item.sourceUrl, 2048) : null,
    affected_element: clampText(item.affectedElement, 500), significance: clampText(item.significance, 1600),
    recommendation: clampText(item.recommendation, 1600), priority: item.priority,
    finding_type: item.findingType, confidence: item.confidence, review_status: "unreviewed",
    internal_notes: "", evidence: item.evidence || {}, created_by: operatorId, updated_by: operatorId
  };
}

async function insertFindings(items, analysisId, runId, operatorId, catalog) {
  if (!items.length) return [];
  var rows = await rest("/rest/v1/customer_analysis_findings", {
    method: "POST", prefer: "return=representation", body: items.map(function (item) { return snakeFinding(item, analysisId, runId, operatorId); })
  });
  var catalogByCode = {};
  catalog.forEach(function (service) { catalogByCode[service.code] = service; });
  var links = [];
  rows.forEach(function (row, index) {
    var original = items[index];
    (original.serviceCodes || []).forEach(function (code) {
      if (!catalogByCode[code]) return;
      links.push({ finding_id: row.id, service_id: catalogByCode[code].id, rationale: clampText(original.serviceRationale, 1200), confidence: original.confidence });
    });
  });
  if (links.length) await rest("/rest/v1/customer_analysis_finding_services", { method: "POST", prefer: "return=minimal", body: links });
  return rows;
}

async function listAnalyses(url) {
  var query = new URL(url).searchParams;
  var search = clampText(query.get("search"), 100);
  var status = query.get("status");
  var path = "/rest/v1/customer_analyses?select=*&order=updated_at.desc&limit=100";
  if (search) path += "&or=(company_name.ilike.*" + encodeURIComponent(search.replace(/[,*()]/g, "")) + "*,target_host.ilike.*" + encodeURIComponent(search.replace(/[,*()]/g, "")) + "*)";
  if (STATUS.indexOf(status) !== -1) path += "&status=eq." + status;
  else path += "&status=neq.archived";
  var analyses = await rest(path);
  var runs = analyses.length ? await rest("/rest/v1/customer_analysis_runs?analysis_id=in.(" + analyses.map(function (item) { return item.id; }).join(",") + ")&select=id,analysis_id,started_at&order=started_at.desc") : [];
  var latestRunByAnalysis = {};
  runs.forEach(function (run) { if (!latestRunByAnalysis[run.analysis_id]) latestRunByAnalysis[run.analysis_id] = run.id; });
  var findings = analyses.length ? await rest("/rest/v1/customer_analysis_findings?analysis_id=in.(" + analyses.map(function (item) { return item.id; }).join(",") + ")&review_status=eq.approved&select=analysis_id,run_id") : [];
  return analyses.map(function (analysis) {
    return Object.assign({}, analysis, { approved_findings: findings.filter(function (item) {
      return item.analysis_id === analysis.id && (item.run_id === null || item.run_id === latestRunByAnalysis[analysis.id]);
    }).length });
  });
}

async function detail(id) {
  var analysis = await getAnalysis(id);
  if (!analysis) return null;
  var runs = await rest("/rest/v1/customer_analysis_runs?analysis_id=eq." + id + "&select=*&order=started_at.desc&limit=20");
  var latestRun = runs[0] || null;
  var pages = latestRun ? await rest("/rest/v1/customer_analysis_pages?run_id=eq." + latestRun.id + "&select=*&order=created_at.asc") : [];
  var findingsPath = "/rest/v1/customer_analysis_findings?analysis_id=eq." + id + "&select=*&order=created_at.asc";
  if (latestRun) findingsPath += "&or=(run_id.eq." + latestRun.id + ",run_id.is.null)";
  var findings = await rest(findingsPath);
  var links = findings.length ? await rest("/rest/v1/customer_analysis_finding_services?finding_id=in.(" + findings.map(function (item) { return item.id; }).join(",") + ")&select=*") : [];
  var briefs = await rest("/rest/v1/customer_analysis_meeting_briefs?analysis_id=eq." + id + "&select=*&order=created_at.desc&limit=10");
  return { analysis: analysis, runs: runs, latestRun: latestRun, pages: pages, findings: findings, findingServices: links, catalog: await getCatalog(), briefs: briefs };
}

async function createAnalysis(body, operatorId) {
  var company = clampText(body.companyName, 200);
  if (!company) throw Object.assign(new Error("Virksomhetsnavn er påkrevd."), { publicStatus: 400, publicCode: "invalid_company" });
  var parsed;
  try { parsed = validateAnalysisUrl(body.websiteUrl); }
  catch (e) { throw Object.assign(new Error(e.message), { publicStatus:400, publicCode:e.code || "invalid_url" }); }
  var maxPages = Number(body.maxPages);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 5) throw Object.assign(new Error("Velg mellom 1 og 5 sider."), { publicStatus: 400, publicCode: "invalid_page_limit" });
  if (!isUuid(body.requestKey)) throw Object.assign(new Error("Ugyldig forespørselsnøkkel."), { publicStatus: 400, publicCode: "invalid_request_key" });
  try {
    await requireAudit({ operatorId:operatorId, action:"analysis_create_attempt", result:"success" });
    var rows = await rest("/rest/v1/customer_analyses", {
      method: "POST", prefer: "return=representation", body: {
        request_key: body.requestKey, company_name: company, website_url: parsed.toString(), target_host: parsed.hostname,
        industry: clampText(body.industry, 160), internal_notes: clampText(body.internalNotes, 4000), max_pages: maxPages,
        status: "draft", created_by: operatorId, updated_by: operatorId
      }
    });
    return rows[0];
  } catch (e) {
    if (e.dbCode === "23505") {
      var existing = await rest("/rest/v1/customer_analyses?request_key=eq." + body.requestKey + "&select=*");
      if (existing[0]) return existing[0];
    }
    throw e;
  }
}

async function runAnalysis(id, operatorId, requestedModel) {
  var analysis = await getAnalysis(id);
  if (!analysis) throw Object.assign(new Error("Analysen finnes ikke."), { publicStatus: 404, publicCode: "not_found" });
  if (!canTransition(analysis.status, "analyzing")) throw Object.assign(new Error("Analysen kan ikke startes fra denne statusen."), { publicStatus: 409, publicCode: "invalid_status" });
  var runId;
  try { runId = await claimRun(analysis, operatorId); }
  catch (e) {
    var msg = String(e.dbMessage || "");
    if (msg.indexOf("target already analyzing") !== -1) throw Object.assign(new Error("Dette domenet analyseres allerede."), { publicStatus: 409, publicCode: "target_busy" });
    if (msg.indexOf("global analysis limit") !== -1) throw Object.assign(new Error("Analysekapasiteten er opptatt. Prøv igjen om litt."), { publicStatus: 429, publicCode: "globally_busy" });
    throw e;
  }
  try {
    var crawl = await crawlWebsite(analysis.website_url, analysis.max_pages);
    var catalog = await getCatalog();
    var readablePages = crawl.pages.filter(function (page) { return page.fetchStatus === "fetched"; });
    var ai = { status: "skipped", result: null };
    try {
      ai = await generateCustomerAnalysis({
        companyName: analysis.company_name, websiteUrl: analysis.website_url, industry: analysis.industry
      }, readablePages.map(function (page) {
        return { finalUrl: page.finalUrl, title: page.title, textExcerpt: page.textExcerpt };
      }), crawl.findings, catalog, { model: resolveRequestedModel(requestedModel) });
    } catch (aiError) {
      ai = { status: "failed", result: null };
      console.error("[customer-analysis] AI-vurdering feilet", { analysisId: id, runId: runId, error: String(aiError && aiError.message || aiError) });
    }

    if (crawl.pages.length) await rest("/rest/v1/customer_analysis_pages", {
      method: "POST", prefer: "return=minimal", body: crawl.pages.map(function (page) {
        return {
          analysis_id: id, run_id: runId, requested_url: page.requestedUrl, final_url: page.finalUrl,
          fetch_status: page.fetchStatus, robots_allowed: page.robotsAllowed, http_status: page.httpStatus,
          content_type: page.contentType, duration_ms: page.durationMs, size_bytes: page.sizeBytes,
          title: page.title, text_excerpt: page.textExcerpt, redirect_chain: page.redirectChain,
          technical_result: page.technicalResult, error_code: page.errorCode, error_message: page.errorMessage
        };
      })
    });
    await insertFindings(crawl.findings.concat(ai.result ? ai.result.findings : []), id, runId, operatorId, catalog);
    var summary = ai.result && ai.result.businessSummary ? ai.result.businessSummary + " " + crawl.summary : crawl.summary;
    var metrics = {
      durationMs: crawl.durationMs, robots: crawl.robots, sitemap: crawl.sitemap,
      aiModel: ai.model || null, meetingQuestions: ai.result ? ai.result.meetingQuestions : []
    };
    await rest("/rest/v1/customer_analysis_runs?id=eq." + runId, {
      method: "PATCH", prefer: "return=minimal", body: {
        status: "completed", fetched_pages: crawl.fetchedPages, ai_status: ai.status,
        finished_at: new Date().toISOString(), metrics: metrics
      }
    });
    await rest("/rest/v1/customer_analyses?id=eq." + id, {
      method: "PATCH", prefer: "return=minimal", body: {
        status: "review_ready", overall_score: crawl.score, overall_summary: clampText(summary, 2000),
        last_run_at: new Date().toISOString(), updated_by: operatorId, updated_at: new Date().toISOString()
      }
    });
    await auditEvent({ analysisId: id, runId: runId, operatorId: operatorId, action: "run_completed", result: "success", detail: "pages=" + crawl.fetchedPages + ";ai=" + ai.status + ";model=" + (ai.model || "-") });
    return await detail(id);
  } catch (runError) {
    var code = clampText(runError && runError.code || "analysis_failed", 80);
    var safeMessage = code === "robots_disallowed_site" ? "robots.txt tillater ikke analyse av nettstedet." : code === "analysis_timeout" ? "Analysen overskred tidsgrensen." : "Analysen kunne ikke fullføres sikkert.";
    await rest("/rest/v1/customer_analysis_runs?id=eq." + runId, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", finished_at: new Date().toISOString(), error_code: code, error_message: safeMessage } }).catch(function () {});
    await rest("/rest/v1/customer_analyses?id=eq." + id, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", updated_by: operatorId, updated_at: new Date().toISOString() } }).catch(function () {});
    await auditEvent({ analysisId: id, runId: runId, operatorId: operatorId, action: "run_failed", result: "error", detail: code });
    throw Object.assign(new Error(safeMessage), { publicStatus: 502, publicCode: code });
  }
}

async function updateFinding(body, operatorId) {
  if (!isUuid(body.id)) throw Object.assign(new Error("Ugyldig funn-ID."), { publicStatus: 400 });
  var rows = await rest("/rest/v1/customer_analysis_findings?id=eq." + body.id + "&select=*");
  var existing = rows[0];
  if (!existing) throw Object.assign(new Error("Funnet finnes ikke."), { publicStatus: 404 });
  var analysis = await getAnalysis(existing.analysis_id);
  if (!analysis || analysis.status === "archived") throw Object.assign(new Error("Funn i en arkivert analyse kan ikke endres."), { publicStatus: 409 });
  await requireAudit({ analysisId:existing.analysis_id, runId:existing.run_id, operatorId:operatorId, action:"finding_update_attempt", result:"success" });
  var changesText = ["title", "observation", "affectedElement", "significance", "recommendation", "priority", "internalNotes", "serviceIds"].some(function (key) { return body[key] !== undefined; });
  var reviewStatus = REVIEW.indexOf(body.reviewStatus) !== -1 ? body.reviewStatus : existing.review_status;
  if (changesText && reviewStatus === "approved") reviewStatus = "edited";
  var priority = PRIORITY.indexOf(body.priority) !== -1 ? body.priority : existing.priority;
  var patch = {
    title: clampText(body.title === undefined ? existing.title : body.title, 240),
    observation: clampText(body.observation === undefined ? existing.observation : body.observation, 2000),
    affected_element: clampText(body.affectedElement === undefined ? existing.affected_element : body.affectedElement, 500),
    significance: clampText(body.significance === undefined ? existing.significance : body.significance, 1600),
    recommendation: clampText(body.recommendation === undefined ? existing.recommendation : body.recommendation, 1600),
    priority: priority, review_status: reviewStatus,
    internal_notes: clampText(body.internalNotes === undefined ? existing.internal_notes : body.internalNotes, 3000),
    updated_by: operatorId, updated_at: new Date().toISOString()
  };
  if (!patch.title || !patch.observation) throw Object.assign(new Error("Tittel og observasjon kan ikke være tomme."), { publicStatus: 400 });
  await rest("/rest/v1/customer_analysis_findings?id=eq." + body.id, { method: "PATCH", prefer: "return=minimal", body: patch });
  if (Array.isArray(body.serviceIds)) {
    var catalog = await getCatalog();
    var activeServiceIds = catalog.filter(function (service) { return service.active; }).map(function (service) { return service.id; });
    var serviceIds = Array.from(new Set(body.serviceIds.filter(function (id) { return isUuid(id) && activeServiceIds.indexOf(id) !== -1; }))).slice(0, 4);
    await rest("/rest/v1/customer_analysis_finding_services?finding_id=eq." + body.id, { method: "DELETE", prefer: "return=minimal" });
    if (serviceIds.length) await rest("/rest/v1/customer_analysis_finding_services", {
      method: "POST", prefer: "return=minimal", body: serviceIds.map(function (serviceId) {
        return { finding_id: body.id, service_id: serviceId, rationale: "Koblet av operatør.", confidence: existing.confidence };
      })
    });
  }
  await auditEvent({ analysisId: existing.analysis_id, runId: existing.run_id, operatorId: operatorId, action: "finding_updated", result: "success", detail: reviewStatus });
  return { success: true };
}

async function addManualFinding(body, operatorId) {
  if (!isUuid(body.analysisId) || CATEGORIES.indexOf(body.category) === -1) throw Object.assign(new Error("Ugyldig manuelt funn."), { publicStatus: 400 });
  var analysis = await getAnalysis(body.analysisId);
  if (!analysis) throw Object.assign(new Error("Analysen finnes ikke."), { publicStatus: 404 });
  var sourceUrl = null;
  if (body.sourceUrl) {
    try { sourceUrl = validateAnalysisUrl(body.sourceUrl).toString(); }
    catch (e) { throw Object.assign(new Error(e.message), { publicStatus:400, publicCode:e.code || "invalid_url" }); }
  }
  var item = {
    category: body.category, title: clampText(body.title, 240), observation: clampText(body.observation, 2000),
    sourceUrl: sourceUrl,
    affectedElement: clampText(body.affectedElement, 500), significance: clampText(body.significance, 1600),
    recommendation: clampText(body.recommendation, 1600), priority: PRIORITY.indexOf(body.priority) !== -1 ? body.priority : "medium",
    findingType: "manual", confidence: "high", evidence: {}
  };
  if (!item.title || !item.observation) throw Object.assign(new Error("Tittel og observasjon er påkrevd."), { publicStatus: 400 });
  await requireAudit({ analysisId:analysis.id, operatorId:operatorId, action:"finding_add_attempt", result:"success" });
  var catalog = await getCatalog();
  item.serviceCodes = catalog.filter(function (service) { return (body.serviceIds || []).indexOf(service.id) !== -1; }).map(function (service) { return service.code; });
  var rows = await insertFindings([item], analysis.id, null, operatorId, catalog);
  await auditEvent({ analysisId: analysis.id, operatorId: operatorId, action: "finding_added", result: "success" });
  return rows[0];
}

async function archiveAnalysis(id, operatorId) {
  var analysis = await getAnalysis(id);
  if (!analysis) throw Object.assign(new Error("Analysen finnes ikke."), { publicStatus: 404 });
  if (!canTransition(analysis.status, "archived")) throw Object.assign(new Error("Analysen kan ikke arkiveres fra denne statusen."), { publicStatus: 409 });
  await requireAudit({ analysisId:id, operatorId:operatorId, action:"analysis_archive_attempt", result:"success" });
  await rest("/rest/v1/customer_analyses?id=eq." + id, { method: "PATCH", prefer: "return=minimal", body: { status: "archived", updated_by: operatorId, updated_at: new Date().toISOString() } });
  await auditEvent({ analysisId: id, operatorId: operatorId, action: "analysis_archived", result: "success" });
  return { success: true };
}

// Brukarønske (2026-08-10): arkivering endrar berre status, sletter ingenting
// -- før ekte, ikkje-mocka bruk mot eit reelt nettstad krev brukaren ein
// faktisk sletteveg for ALT data knytt til søket, ikkje berre å skjule det.
// service_role har alt DELETE på customer_analyses frå migrasjonen sin
// per-tabell-løkke; kaskaden (on delete cascade) fjernar runs/pages/findings/
// finding_services/meeting_briefs. customer_analysis_events er med vilje
// append-only (UPDATE/DELETE er revoka frå service_role i migrasjonen) og
// inneheld ikkje verksemdsnamn/URL/tekstutdrag -- den overlever med
// analysis_id/run_id sett til null, som ein innhaldslaus hendelsesrest.
async function deleteAnalysisPermanently(id, operatorId) {
  var analysis = await getAnalysis(id);
  if (!analysis) throw Object.assign(new Error("Analysen finnes ikke."), { publicStatus: 404 });
  if (analysis.status === "analyzing") throw Object.assign(new Error("En analyse som kjører kan ikke slettes. Vent til kjøringen er ferdig eller feilet."), { publicStatus: 409, publicCode: "analysis_running" });
  await requireAudit({ analysisId:id, operatorId:operatorId, action:"analysis_delete_attempt", result:"success" });
  await rest("/rest/v1/customer_analyses?id=eq." + id, { method: "DELETE", prefer: "return=minimal" });
  // analysisId er med vilje null her -- rada finst ikkje lenger, og ein ny
  // hendelse som viser til ein sletta id ville brote framandnøkkelen.
  // Den sletta id-en er sjølv ikkje sensitiv og tas vare på i detail for sporbarheit.
  await auditEvent({ analysisId: null, operatorId: operatorId, action: "analysis_deleted", result: "success", detail: id });
  return { success: true };
}

async function generateBrief(id, operatorId, requestedModel) {
  var data = await detail(id);
  if (!data) throw Object.assign(new Error("Analysen finnes ikke."), { publicStatus: 404 });
  if (!canTransition(data.analysis.status, "reviewed")) throw Object.assign(new Error("Møtegrunnlag kan ikke lages fra denne statusen."), { publicStatus: 409, publicCode: "invalid_status" });
  var built = buildMeetingBrief(data);
  var approved = built.approved;
  if (!approved.length) throw Object.assign(new Error("Godkjenn minst ett funn før du lager møtegrunnlag."), { publicStatus: 409, publicCode: "no_approved_findings" });
  var content = built.content;
  await requireAudit({ analysisId:id, runId:data.latestRun && data.latestRun.id, operatorId:operatorId, action:"brief_generate_attempt", result:"success" });
  var aiBrief = { status:"not_configured", result:null };
  try { aiBrief = await generateMeetingBriefDraft(data.analysis, approved, content.possibleDeliveries, { model: resolveRequestedModel(requestedModel) }); }
  catch (aiError) {
    aiBrief = { status:"failed", result:null };
    console.error("[customer-analysis] AI-møteutkast feilet", { analysisId:id, error:String(aiError && aiError.message || aiError) });
  }
  if (aiBrief.result) {
    if (aiBrief.result.strengths.length) content.strengths = aiBrief.result.strengths.map(function (item) { return item.text; });
    if (aiBrief.result.opportunities.length) content.opportunities = aiBrief.result.opportunities.map(function (item) {
      var original = approved.find(function (finding) { return finding.id === item.findingId; });
      return { title:item.title, observation:item.text, recommendation:item.recommendation, priority:original ? original.priority : "medium" };
    });
    if (aiBrief.result.questions.length) content.questions = aiBrief.result.questions.map(function (item) { return item.text; });
    if (aiBrief.result.nextStep) content.recommendedNextStep = aiBrief.result.nextStep;
  }
  content.aiStatus = aiBrief.status;
  content.aiModel = aiBrief.model || null;
  var rows = await rest("/rest/v1/customer_analysis_meeting_briefs", {
    method: "POST", prefer: "return=representation", body: {
      analysis_id: id, run_id: data.latestRun && data.latestRun.id, content: content,
      approved_finding_ids: approved.map(function (item) { return item.id; }), created_by: operatorId
    }
  });
  await rest("/rest/v1/customer_analyses?id=eq." + id, { method: "PATCH", prefer: "return=minimal", body: { status: "reviewed", updated_by: operatorId, updated_at: new Date().toISOString() } });
  await auditEvent({ analysisId: id, runId: data.latestRun && data.latestRun.id, operatorId: operatorId, action: "brief_generated", result: "success", detail: "approved=" + approved.length });
  return rows[0];
}

async function saveService(body, operatorId) {
  var service = body.service || {};
  if (!isUuid(service.id)) throw Object.assign(new Error("Ugyldig tjeneste-ID."), { publicStatus: 400 });
  var delivery = service.deliveryStatus === "adaptation" ? "adaptation" : "available";
  var title = clampText(service.title, 200);
  if (!title) throw Object.assign(new Error("Tjenesten må ha et navn."), { publicStatus:400 });
  await requireAudit({ operatorId:operatorId, action:"service_catalog_update_attempt", result:"success", detail:service.id });
  await rest("/rest/v1/customer_analysis_service_catalog?id=eq." + service.id, {
    method: "PATCH", prefer: "return=minimal", body: {
      title: title, description: clampText(service.description, 1200),
      delivery_status: delivery, active: service.active !== false, updated_by: operatorId, updated_at: new Date().toISOString()
    }
  });
  await auditEvent({ operatorId: operatorId, action: "service_catalog_updated", result: "success", detail: service.id });
  return { success: true };
}

async function handler(request) {
  var token = bearer(request);
  if (!token) return error(401, "Du må være innlogget.", "unauthorized");
  var caller;
  try { caller = await verifyConsoleOperator(token); }
  catch (e) {
    console.error("[customer-analysis] operatørkontroll feilet", { error: String(e && e.message || e) });
    return error(502, "Kunne ikke kontrollere Console-tilgangen.", "auth_unavailable");
  }
  if (!caller.ok) return error(caller.status, caller.reason, "forbidden");

  try {
    if (request.method === "GET") {
      var params = new URL(request.url).searchParams;
      var view = params.get("view") || "list";
      if (view === "list") return json({ analyses: await listAnalyses(request.url) });
      if (view === "detail" && isUuid(params.get("id"))) {
        var result = await detail(params.get("id"));
        return result ? json(result) : error(404, "Analysen finnes ikke.", "not_found");
      }
      if (view === "catalog") return json({ catalog: await getCatalog() });
      return error(400, "Ugyldig visning.", "invalid_view");
    }
    if (request.method !== "POST") return error(405, "Bare GET og POST er støttet.", "method_not_allowed");
    var body;
    try { body = await request.json(); } catch (e) { return error(400, "Ugyldig JSON i forespørselen.", "invalid_json"); }
    var action = body && body.action;
    if (action === "create") {
      var created = await createAnalysis(body, caller.userId);
      await auditEvent({ analysisId: created.id, operatorId: caller.userId, action: "analysis_created", result: "success" });
      return json({ analysis: created }, 201);
    }
    if (action === "run" && isUuid(body.id)) {
      if (rateLimited(caller.userId)) return error(429, "For mange analyser på kort tid. Prøv igjen senere.", "rate_limited");
      return json(await runAnalysis(body.id, caller.userId, body.aiModel));
    }
    if (action === "update_finding") return json(await updateFinding(body, caller.userId));
    if (action === "add_finding") return json({ finding: await addManualFinding(body, caller.userId) }, 201);
    if (action === "archive" && isUuid(body.id)) return json(await archiveAnalysis(body.id, caller.userId));
    if (action === "delete" && isUuid(body.id)) return json(await deleteAnalysisPermanently(body.id, caller.userId));
    if (action === "generate_brief" && isUuid(body.id)) {
      if (rateLimited(caller.userId)) return error(429, "For mange AI-kall på kort tid. Prøv igjen senere.", "rate_limited");
      return json({ brief: await generateBrief(body.id, caller.userId, body.aiModel) }, 201);
    }
    if (action === "save_service") return json(await saveService(body, caller.userId));
    return error(400, "Ukjent handling.", "invalid_action");
  } catch (e) {
    var status = e.publicStatus || (e.status >= 400 && e.status < 500 ? e.status : 500);
    var message = e.publicStatus ? e.message : "Kundeanalyse kunne ikke fullføre handlingen.";
    console.error("[customer-analysis] handling feilet", { status: status, code: e.publicCode || e.dbCode || "internal" });
    return error(status, message, e.publicCode || "operation_failed");
  }
}

export default { fetch: handler };
