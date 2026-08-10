import { secureFetch, validateAnalysisUrl, equivalentWebHost } from "./customer-analysis-secure-fetch.js";
import { loadRobots, isRobotsAllowed } from "./customer-analysis-robots.js";
import { analyzeHtml, findingsFromHtml, calculateScore, clampText } from "./customer-analysis-html.js";

var HTML_TYPES = ["text/html", "application/xhtml+xml"];
var SAFE_PATH_EXT = /\.(?:html?|php|asp|aspx)?$/i;
var SKIP_PATH = /\/(?:admin|login|logg-?inn|logout|logg-?ut|delete|remove|cart|checkout|konto|account|api|wp-json|feed|export|download)(?:\/|$)/i;

function autoFinding(category, title, observation, sourceUrl, priority, significance, recommendation, confidence) {
  return {
    category: category, title: title, observation: observation, sourceUrl: sourceUrl,
    affectedElement: "", significance: significance || "", recommendation: recommendation || "",
    priority: priority || "medium", findingType: "automatic", confidence: confidence || "high", evidence: {}
  };
}

function attachServiceSuggestion(item) {
  var codes = [];
  if (item.category === "seo") codes.push("seo-health-check");
  if (item.category === "accessibility") codes.push("accessibility-review");
  if (item.category === "privacy") codes.push("privacy-module");
  if (item.category === "content") codes.push("content-structure");
  if (item.category === "technical" && /viewport|mobil|favicon|HTTPS|ressurs/i.test(item.title)) codes.push("modern-website");
  if (/kontakt/i.test(item.title)) codes.push("contact-form");
  if (/FAQ/i.test(item.title)) codes.push("faq");
  item.serviceCodes = Array.from(new Set(codes)).slice(0, 3);
  item.serviceRationale = item.serviceCodes.length
    ? "Tjenesten kan være relevant for å følge opp dette dokumenterte funnet. Omfang og behov må avklares manuelt."
    : "";
  return item;
}

function normalizedPageUrl(input) {
  var url = new URL(input);
  url.hash = "";
  url.search = "";
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function isSafeCandidate(url, siteHost) {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!equivalentWebHost(url.hostname, siteHost)) return false;
  if (url.username || url.password || url.search || SKIP_PATH.test(url.pathname)) return false;
  var last = url.pathname.split("/").pop() || "";
  if (last.indexOf(".") !== -1 && !SAFE_PATH_EXT.test(last)) return false;
  return true;
}

function candidateScore(url) {
  var path = url.pathname.toLowerCase();
  var order = [
    /kontakt|contact/, /tjenest|produkt|service|tilbud/, /om-oss|om\/|about/,
    /personvern|privacy|cookie/, /referans|case|prosjekt/, /aktuelt|nyhet|blogg/
  ];
  for (var i = 0; i < order.length; i++) if (order[i].test(path)) return i;
  return 100 + path.split("/").length;
}

function contentType(headers) {
  return String(headers["content-type"] || "").split(";")[0].trim().toLowerCase();
}

function publicError(error) {
  var code = clampText(error && error.code || "fetch_failed", 80);
  var allowed = {
    invalid_url: "Nettadressen er ugyldig.", blocked_protocol: "Protokollen er ikke tillatt.",
    credentials_not_allowed: "Nettadressen inneholder innloggingsinformasjon.", blocked_port: "Porten er ikke tillatt.",
    blocked_hostname: "Vertsnavnet er ikke tillatt.", blocked_address: "Vertsnavnet peker til en blokkert nettadresse.",
    dns_failed: "DNS-oppslaget mislyktes.", dns_empty: "DNS-oppslaget ga ingen adresse.", dns_timeout: "DNS-oppslaget tok for lang tid.",
    timeout: "Siden brukte for lang tid på å svare.", total_timeout: "Analysen overskred tidsgrensen.",
    response_too_large: "Siden var større enn analysegrensen.", compressed_response: "Siden svarte med et format som ikke kunne leses sikkert.",
    peer_mismatch: "Tilkoblingen kunne ikke verifiseres.", cross_site_redirect: "Siden omdirigerte til et annet domene.",
    too_many_redirects: "Siden hadde for mange omdirigeringer.", robots_unavailable: "robots.txt kunne ikke leses sikkert."
  };
  return { code: code, message: allowed[code] || "Siden kunne ikke hentes sikkert." };
}

async function inspectSupportingFile(url, robots, options) {
  var rule = isRobotsAllowed(robots.groups, url);
  if (!rule.allowed) return { status: "blocked", url: url };
  try {
    var response = await secureFetch(url, Object.assign({}, options, { maxBytes: 256 * 1024 }));
    return { status: response.status >= 200 && response.status < 300 ? "found" : "missing", url: response.url, httpStatus: response.status };
  } catch (e) {
    return { status: "failed", url: url, error: publicError(e) };
  }
}

export async function crawlWebsite(inputUrl, maxPages, options) {
  var opts = Object.assign({ totalTimeoutMs: 60000 }, options || {});
  var initial = validateAnalysisUrl(inputUrl);
  var limit = Math.max(1, Math.min(5, Number(maxPages) || 5));
  var started = Date.now();
  function budgetedOptions(extra) {
    var remaining = opts.totalTimeoutMs - (Date.now() - started);
    if (remaining <= 0) {
      var exhausted = new Error("Analysen overskred samlet tidsgrense.");
      exhausted.code = "analysis_timeout";
      throw exhausted;
    }
    return Object.assign({}, opts, extra || {}, {
      totalTimeoutMs: remaining,
      timeoutMs: Math.max(250, Math.min(opts.timeoutMs || 8000, remaining))
    });
  }
  var robots = await loadRobots(initial.toString(), budgetedOptions());
  var rootRule = isRobotsAllowed(robots.groups, initial.toString());
  if (!rootRule.allowed) {
    var blocked = new Error("robots.txt tillater ikke analyse av startsiden.");
    blocked.code = "robots_disallowed_site";
    throw blocked;
  }

  var queue = [normalizedPageUrl(initial.toString())];
  var seen = {};
  var pages = [];
  var findings = [];
  var allInternalLinks = {};

  while (queue.length && pages.length < limit) {
    if (Date.now() - started > opts.totalTimeoutMs) {
      var timeout = new Error("Analysen overskred samlet tidsgrense.");
      timeout.code = "analysis_timeout";
      throw timeout;
    }
    var requestedUrl = queue.shift();
    if (seen[requestedUrl]) continue;
    seen[requestedUrl] = true;
    var robotsRule = isRobotsAllowed(robots.groups, requestedUrl);
    if (!robotsRule.allowed) {
      pages.push({
        requestedUrl: requestedUrl, finalUrl: null, fetchStatus: "skipped", robotsAllowed: false,
        httpStatus: null, contentType: null, durationMs: null, sizeBytes: null, title: "", textExcerpt: "",
        redirectChain: [], technicalResult: {}, errorCode: "robots_disallowed", errorMessage: "Stien ble utelatt fordi robots.txt ikke tillater innhenting."
      });
      continue;
    }

    var response;
    try {
      response = await secureFetch(requestedUrl, budgetedOptions({ maxBytes: 1024 * 1024 }));
    } catch (e) {
      var safeError = publicError(e);
      pages.push({
        requestedUrl: requestedUrl, finalUrl: null, fetchStatus: "failed", robotsAllowed: true,
        httpStatus: e.status || null, contentType: null, durationMs: null, sizeBytes: null, title: "", textExcerpt: "",
        redirectChain: [], technicalResult: {}, errorCode: safeError.code, errorMessage: safeError.message
      });
      findings.push(autoFinding("technical", "Siden kunne ikke leses", safeError.message, requestedUrl, "medium", "En intern lenke i utvalget svarte ikke på en måte analysen kunne bruke.", "Kontroller lenken manuelt.", "high"));
      continue;
    }

    var type = contentType(response.headers);
    if (response.status < 200 || response.status >= 400) {
      pages.push({
        requestedUrl: requestedUrl, finalUrl: response.url, fetchStatus: "failed", robotsAllowed: true,
        httpStatus: response.status, contentType: type, durationMs: response.durationMs, sizeBytes: response.bytes,
        title: "", textExcerpt: "", redirectChain: response.redirectChain, technicalResult: {},
        errorCode: "http_status", errorMessage: "Siden svarte med HTTP " + response.status + "."
      });
      findings.push(autoFinding("technical", "Feilstatus fra intern side", "Siden svarte med HTTP " + response.status + ".", response.url, response.status >= 500 ? "high" : "medium", "Besøkende kan møte en side som ikke virker.", "Kontroller eller oppdater lenken."));
      continue;
    }
    if (HTML_TYPES.indexOf(type) === -1) {
      pages.push({
        requestedUrl: requestedUrl, finalUrl: response.url, fetchStatus: "skipped", robotsAllowed: true,
        httpStatus: response.status, contentType: type, durationMs: response.durationMs, sizeBytes: response.bytes,
        title: "", textExcerpt: "", redirectChain: response.redirectChain, technicalResult: {},
        errorCode: "unsupported_content_type", errorMessage: "Innholdstypen ble ikke analysert."
      });
      continue;
    }

    var html = response.body.toString("utf8");
    var info = analyzeHtml(html, response.url);
    findings = findings.concat(findingsFromHtml(info, response.url, response));
    info.internalLinks.forEach(function (link) { allInternalLinks[normalizedPageUrl(link)] = true; });
    var candidates = info.internalLinks.map(function (link) { return new URL(link); })
      .filter(function (url) { return isSafeCandidate(url, initial.hostname); })
      .map(function (url) { return normalizedPageUrl(url.toString()); })
      .filter(function (url) { return !seen[url] && queue.indexOf(url) === -1; })
      .sort(function (a, b) { return candidateScore(new URL(a)) - candidateScore(new URL(b)); });
    queue = queue.concat(candidates);

    pages.push({
      requestedUrl: requestedUrl, finalUrl: response.url, fetchStatus: "fetched", robotsAllowed: true,
      httpStatus: response.status, contentType: type, durationMs: response.durationMs, sizeBytes: response.bytes,
      title: info.title, textExcerpt: info.textExcerpt, redirectChain: response.redirectChain,
      technicalResult: {
        language: info.language, h1Count: info.h1.length, headingCount: info.headings.length,
        imageCount: info.imageCount, imagesWithoutAlt: info.imagesWithoutAlt.length,
        formControlCount: info.formControlCount, unlabeledControls: info.unlabeledControls.length,
        internalLinkCount: info.internalLinks.length, externalScriptHosts: info.externalScripts,
        hasMetaDescription: info.descriptions.some(Boolean), hasCanonical: info.canonicals.length > 0,
        hasViewport: info.viewports.length > 0, hasFavicon: info.favicon,
        hasStructuredData: info.structuredDataCount > 0, hasNoIndex: info.robots.some(function (value) { return value.indexOf("noindex") !== -1; }),
        privacyLinkCount: info.privacyLinks.length, contactLinkCount: info.contactLinks.length,
        cookieSignalCount: info.cookieSignals.length, wordCount: info.wordCount
      }
    });
  }

  var fetched = pages.filter(function (page) { return page.fetchStatus === "fetched"; });
  var homepage = fetched[0];
  var baseOrigin = homepage && homepage.finalUrl ? new URL(homepage.finalUrl).origin : initial.origin;
  var sitemap;
  try { sitemap = await inspectSupportingFile(baseOrigin + "/sitemap.xml", robots, budgetedOptions()); }
  catch (e) { sitemap = { status:"failed", url:baseOrigin + "/sitemap.xml", error:publicError(e) }; }

  if (robots.missing) findings.push(autoFinding("seo", "robots.txt ble ikke funnet", "Nettstedet svarte med HTTP " + robots.status + " for robots.txt.", robots.url, "low", "Dette er ikke nødvendigvis en feil, men filen kan styre søkemotorers innhenting.", "Vurder om nettstedet trenger en tydelig robots.txt."));
  if (sitemap.status !== "found") findings.push(autoFinding("seo", "Sitemap ble ikke funnet i standardplasseringen", sitemap.status === "blocked" ? "robots.txt tillot ikke kontroll av /sitemap.xml." : "Fant ikke en lesbar sitemap.xml i standardplasseringen.", baseOrigin + "/sitemap.xml", "low", "Et sitemap kan hjelpe søkemotorer med å oppdage sider.", "Kontroller manuelt om sitemap finnes på en annen URL."));

  var hasPrivacy = fetched.some(function (page) { return page.technicalResult.privacyLinkCount > 0 || /personvern|privacy|cookie/i.test(page.finalUrl || ""); });
  var hasContact = fetched.some(function (page) { return page.technicalResult.contactLinkCount > 0 || /kontakt|contact/i.test(page.finalUrl || ""); });
  var hasCookieSignal = fetched.some(function (page) { return page.technicalResult.cookieSignalCount > 0; });
  var trackerHosts = Array.from(new Set(fetched.flatMap(function (page) { return page.technicalResult.externalScriptHosts || []; })))
    .filter(function (host) { return /google-analytics|googletagmanager|facebook|hotjar|clarity|matomo|plausible/i.test(host); });
  if (!hasPrivacy) findings.push(autoFinding("privacy", "Fant ikke tydelig lenke til personverninformasjon", "Ingen tydelig personvernlenke ble funnet på sidene i det avgrensede utvalget.", initial.toString(), "medium", "Dette er ikke en juridisk konklusjon. Informasjonen kan finnes andre steder.", "Undersøk manuelt om personverninformasjonen er tilgjengelig og dekkende.", "medium"));
  if (!hasContact) findings.push(autoFinding("content", "Fant ikke tydelig kontaktvei", "Ingen tydelig kontaktlenke ble funnet på sidene i det avgrensede utvalget.", initial.toString(), "medium", "Kontaktmuligheten kan være vanskelig å finne, men kan ligge utenfor utvalget.", "Kontroller brukerreisen manuelt og gjør neste steg tydelig ved behov.", "medium"));
  if (trackerHosts.length && !hasCookieSignal) findings.push(autoFinding("privacy", "Eksterne analyse- eller markedsføringsskript bør undersøkes", "Fant eksterne skript fra " + trackerHosts.join(", ") + ", men ingen tydelig cookie-tekst i det undersøkte utvalget.", initial.toString(), "medium", "Dette sier ikke om samtykkeløsningen eller behandlingen er lovlig.", "Undersøk skriptene, formålet og samtykkeflyten manuelt.", "medium"));

  if (initial.protocol === "https:") findings.push(autoFinding("strength", "Nettstedet bruker HTTPS", "Startsiden bruker HTTPS.", initial.toString(), "low", "Kryptert transport er et positivt teknisk grunnlag.", "Behold HTTPS på alle sider og ressurser."));
  if (homepage && homepage.title && homepage.technicalResult.hasMetaDescription) findings.push(autoFinding("strength", "Grunnleggende søkemetadata er på plass", "Startsiden har både sidetittel og metabeskrivelse.", homepage.finalUrl, "low", "Dette gir et bedre grunnlag for tydelige søkeresultater.", "Hold metadata oppdatert og relevant."));

  return {
    pages: pages,
    findings: findings.slice(0, 120).map(attachServiceSuggestion),
    score: calculateScore(findings),
    summary: fetched.length + " av " + pages.length + " valgte sider kunne analyseres. Automatiske kontroller er ikke en full WCAG-, SEO-, personvern- eller ytelsesvurdering.",
    robots: { url: robots.url, status: robots.status, missing: robots.missing },
    sitemap: sitemap,
    fetchedPages: fetched.length,
    durationMs: Date.now() - started
  };
}

export { normalizedPageUrl, isSafeCandidate, publicError };
