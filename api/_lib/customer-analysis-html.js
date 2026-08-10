import { parse } from "parse5";
import { equivalentWebHost } from "./customer-analysis-secure-fetch.js";

function clampText(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

function attr(node, name) {
  var found = (node.attrs || []).find(function (item) { return item.name.toLowerCase() === name; });
  return found ? found.value : "";
}

function hasAttr(node, name) {
  return (node.attrs || []).some(function (item) { return item.name.toLowerCase() === name; });
}

function textContent(node) {
  if (!node) return "";
  if (node.nodeName === "#text") return node.value || "";
  return (node.childNodes || []).map(textContent).join(" ");
}

var WALK_MAX_DEPTH = 400;

// Sikkerhetsfunn (LOW, 2026-08-10): utan eit djupnetak kan tilstrekkeleg
// nøsta (men framleis innanfor den vanlege 1 MiB responsgrensa) HTML frå eit
// analysert nettstad få denne rekursjonen til å nå Node sin stabelgrense og
// kaste RangeError. Feilen vart uansett alt fanga trygt (køyringa markerast
// feila, ingen prosesskrasj) -- dette gjer berre den einskilde feilen
// unødvendig i det heile, i staden for berre å avgrense skaden.
function walk(node, visitor, ancestors, depth) {
  var parents = ancestors || [];
  var level = depth || 0;
  visitor(node, parents);
  if (level >= WALK_MAX_DEPTH) return;
  (node.childNodes || []).forEach(function (child) { walk(child, visitor, parents.concat([node]), level + 1); });
}

function resolveLink(href, pageUrl) {
  if (!href || /^\s*(#|mailto:|tel:|javascript:|data:)/i.test(href)) return null;
  try {
    var url = new URL(href, pageUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url;
  } catch (e) { return null; }
}

function finding(category, title, observation, pageUrl, priority, affected, significance, recommendation) {
  return {
    category: category,
    title: title,
    observation: observation,
    sourceUrl: pageUrl,
    affectedElement: affected || "",
    significance: significance || "",
    recommendation: recommendation || "",
    priority: priority || "medium",
    findingType: "automatic",
    confidence: "high",
    evidence: {}
  };
}

export function analyzeHtml(html, pageUrl) {
  var document = parse(String(html || ""));
  var info = {
    title: "", descriptions: [], canonicals: [], viewports: [], robots: [], language: "",
    h1: [], headings: [], imageCount: 0, imagesWithoutAlt: [], formControlCount: 0,
    unlabeledControls: [], unnamedActions: [], genericLinks: [], openGraphCount: 0,
    structuredDataCount: 0, invalidStructuredDataCount: 0, favicon: false,
    mixedResources: [], internalLinks: [], externalScripts: [], privacyLinks: [],
    contactLinks: [], cookieSignals: [], wordCount: 0, textExcerpt: ""
  };
  var labelsFor = {};
  var controls = [];
  var actions = [];
  var visibleTextParts = [];
  var scriptTextDepth = 0;

  walk(document, function (node, ancestors) {
    var tag = String(node.tagName || "").toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "svg") scriptTextDepth += 1;
    if (node.nodeName === "#text") {
      var hiddenByTag = ancestors.some(function (parent) { return ["script", "style", "noscript", "svg"].indexOf(parent.tagName) !== -1; });
      if (!hiddenByTag) visibleTextParts.push(node.value || "");
      return;
    }
    if (tag === "html") info.language = clampText(attr(node, "lang"), 30);
    if (tag === "title" && !info.title) info.title = clampText(textContent(node), 300);
    if (tag === "meta") {
      var name = attr(node, "name").toLowerCase();
      var property = attr(node, "property").toLowerCase();
      if (name === "description") info.descriptions.push(clampText(attr(node, "content"), 500));
      if (name === "viewport") info.viewports.push(clampText(attr(node, "content"), 300));
      if (name === "robots") info.robots.push(clampText(attr(node, "content"), 300).toLowerCase());
      if (property.indexOf("og:") === 0) info.openGraphCount += 1;
    }
    if (tag === "link") {
      var rel = attr(node, "rel").toLowerCase().split(/\s+/);
      var href = resolveLink(attr(node, "href"), pageUrl);
      if (rel.indexOf("canonical") !== -1 && href) info.canonicals.push(href.toString());
      if (rel.indexOf("icon") !== -1 || rel.indexOf("shortcut") !== -1 && rel.indexOf("icon") !== -1) info.favicon = true;
    }
    if (/^h[1-6]$/.test(tag)) {
      var heading = { level: Number(tag.slice(1)), text: clampText(textContent(node), 300) };
      info.headings.push(heading);
      if (tag === "h1") info.h1.push(heading.text);
    }
    if (tag === "img") {
      info.imageCount += 1;
      if (!hasAttr(node, "alt")) info.imagesWithoutAlt.push(clampText(attr(node, "src"), 500) || "img");
    }
    if (tag === "label") {
      var labelFor = attr(node, "for");
      if (labelFor) labelsFor[labelFor] = true;
    }
    if (["input", "select", "textarea"].indexOf(tag) !== -1) controls.push({ node: node, ancestors: ancestors });
    if (tag === "a" || tag === "button") actions.push(node);
    if (tag === "a") {
      var target = resolveLink(attr(node, "href"), pageUrl);
      var linkText = clampText(textContent(node), 240);
      if (target) {
        if (equivalentWebHost(target.hostname, new URL(pageUrl).hostname)) info.internalLinks.push(target.toString());
        if (/personvern|privacy|cookies?/i.test(target.pathname + " " + linkText)) info.privacyLinks.push(target.toString());
        if (/kontakt|contact/i.test(target.pathname + " " + linkText)) info.contactLinks.push(target.toString());
      }
      if (/^(les mer|klikk her|her|mer|link|lenke)$/i.test(linkText)) info.genericLinks.push(linkText);
    }
    if (tag === "script") {
      var src = resolveLink(attr(node, "src"), pageUrl);
      if (src && !equivalentWebHost(src.hostname, new URL(pageUrl).hostname)) info.externalScripts.push(src.hostname);
      if (attr(node, "type").toLowerCase() === "application/ld+json") {
        info.structuredDataCount += 1;
        try { JSON.parse(textContent(node)); } catch (e) { info.invalidStructuredDataCount += 1; }
      }
    }
    if (pageUrl.indexOf("https:") === 0) {
      ["src", "href", "action"].forEach(function (name) {
        if (/^http:\/\//i.test(attr(node, name))) info.mixedResources.push(clampText(attr(node, name), 500));
      });
    }
  });

  controls.forEach(function (entry) {
    var node = entry.node;
    var type = attr(node, "type").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].indexOf(type) !== -1) return;
    info.formControlCount += 1;
    var wrapped = entry.ancestors.some(function (parent) { return parent.tagName === "label"; });
    var named = wrapped || labelsFor[attr(node, "id")] || attr(node, "aria-label") || attr(node, "aria-labelledby") || attr(node, "title");
    if (!named) info.unlabeledControls.push(attr(node, "name") || attr(node, "id") || node.tagName);
  });

  actions.forEach(function (node) {
    var name = clampText(textContent(node), 200) || attr(node, "aria-label") || attr(node, "aria-labelledby") || attr(node, "title");
    var image = (node.childNodes || []).find(function (child) { return child.tagName === "img" && attr(child, "alt"); });
    if (!name && image) name = attr(image, "alt");
    if (!clampText(name, 200)) info.unnamedActions.push(node.tagName);
  });

  var visibleText = clampText(visibleTextParts.join(" "), 20000);
  info.wordCount = visibleText ? visibleText.split(/\s+/).length : 0;
  info.textExcerpt = visibleText.slice(0, 1800);
  if (/cookie|informasjonskaps/i.test(visibleText)) info.cookieSignals.push("Synlig tekst omtaler cookies eller informasjonskapsler.");
  info.internalLinks = Array.from(new Set(info.internalLinks)).slice(0, 100);
  info.externalScripts = Array.from(new Set(info.externalScripts)).slice(0, 30);
  info.privacyLinks = Array.from(new Set(info.privacyLinks));
  info.contactLinks = Array.from(new Set(info.contactLinks));
  return info;
}

export function findingsFromHtml(info, pageUrl, responseMeta) {
  var out = [];
  if (new URL(pageUrl).protocol !== "https:") out.push(finding("technical", "Siden bruker ikke HTTPS", "Siden ble hentet over HTTP.", pageUrl, "high", "URL", "Ukryptert trafikk gir svakere beskyttelse og tillit.", "Vurder HTTPS for hele nettstedet."));
  if (!info.viewports.length) out.push(finding("technical", "Viewport er ikke angitt", "Fant ikke en viewport-meta på siden.", pageUrl, "medium", "<meta name=\"viewport\">", "Mobilvisning kan bli vanskeligere å styre.", "Kontroller mobiltilpasningen og legg inn korrekt viewport ved behov."));
  if (!info.favicon) out.push(finding("technical", "Fant ikke favicon-lenke i HTML", "Fant ingen eksplisitt favicon-lenke i HTML-koden.", pageUrl, "low", "<link rel=\"icon\">", "Et favicon gjør nettstedet lettere å kjenne igjen i faner og bokmerker.", "Kontroller først om /favicon.ico brukes uten lenke, og legg inn en eksplisitt lenke ved behov."));
  if (info.mixedResources.length) out.push(finding("technical", "Mulige usikre tredjepartsressurser", "Fant " + info.mixedResources.length + " ressurs(er) med HTTP på en HTTPS-side.", pageUrl, "high", info.mixedResources[0], "Slike ressurser kan bli blokkert eller svekke sikkerheten.", "Bytt ressursene til HTTPS eller fjern dem."));
  if (!info.title) out.push(finding("seo", "Sidetittel mangler", "Fant ikke en sidetittel.", pageUrl, "high", "<title>", "Sidetittelen brukes av nettlesere og søkemotorer.", "Legg inn en presis og beskrivende sidetittel."));
  if (!info.descriptions.some(Boolean)) out.push(finding("seo", "Metabeskrivelse mangler", "Fant ikke en metabeskrivelse.", pageUrl, "medium", "<meta name=\"description\">", "Søkemotorer kan bruke beskrivelsen i søkeresultatet.", "Skriv en kort, relevant metabeskrivelse."));
  if (!info.canonicals.length) out.push(finding("seo", "Canonical er ikke angitt", "Fant ingen canonical-lenke på siden.", pageUrl, "low", "<link rel=\"canonical\">", "Canonical kan tydeliggjøre foretrukket URL for søkemotorer.", "Vurder canonical dersom samme innhold kan nås på flere URL-er."));
  if (!info.h1.length) out.push(finding("seo", "H1-overskrift mangler", "Fant ingen H1-overskrift på siden.", pageUrl, "medium", "<h1>", "En tydelig hovedoverskrift hjelper både lesere og struktur.", "Legg inn én beskrivende hovedoverskrift."));
  if (info.h1.length > 1) out.push(finding("seo", "Flere H1-overskrifter", "Fant " + info.h1.length + " H1-overskrifter.", pageUrl, "low", "<h1>", "Flere hovedoverskrifter kan gjøre strukturen mindre tydelig.", "Kontroller at overskriftshierarkiet er bevisst."));
  if (!info.openGraphCount) out.push(finding("seo", "Open Graph-data ble ikke funnet", "Fant ingen Open Graph-meta i HTML-koden.", pageUrl, "low", "meta[property^=\"og:\"]", "Delinger i sosiale medier kan få mindre forutsigbar forhåndsvisning.", "Vurder Open Graph-tittel, beskrivelse og bilde."));
  if (!info.language) out.push(finding("accessibility", "Språk er ikke angitt", "Fant ikke lang-attributt på HTML-elementet.", pageUrl, "high", "<html lang>", "Hjelpemidler trenger språkangivelsen for korrekt opplesing.", "Angi hovedspråket på html-elementet."));
  if (info.imagesWithoutAlt.length) out.push(finding("accessibility", "Bilder uten alt-attributt", "Fant " + info.imagesWithoutAlt.length + " bilde(r) uten alt-attributt.", pageUrl, "high", info.imagesWithoutAlt[0], "Skjermlesere får ikke et tekstalternativ. Dekorative bilder bør ha tom alt-attributt.", "Vurder hvert bilde og legg inn beskrivende eller tom alt-tekst."));
  if (info.unlabeledControls.length) out.push(finding("accessibility", "Skjemafelt uten tydelig maskinlesbar etikett", "Fant " + info.unlabeledControls.length + " skjemafelt uten label eller tilgjengelig navn.", pageUrl, "high", info.unlabeledControls[0], "Feltet kan være vanskelig å forstå med hjelpemidler.", "Koble synlige etiketter til feltene."));
  if (info.unnamedActions.length) out.push(finding("accessibility", "Lenker eller knapper uten tilgjengelig navn", "Fant " + info.unnamedActions.length + " handling(er) uten tilgjengelig navn.", pageUrl, "high", info.unnamedActions[0], "Hjelpemidler kan ikke forklare hva handlingen gjør.", "Legg inn synlig tekst eller et presist tilgjengelig navn."));
  if (info.genericLinks.length) out.push(finding("accessibility", "Lite beskrivende lenketekst", "Fant generell lenketekst som «" + info.genericLinks[0] + "».", pageUrl, "medium", "<a>", "Lenken er mindre forståelig uten omkringliggende kontekst.", "Bruk lenketekst som beskriver målet."));
  for (var i = 1; i < info.headings.length; i++) {
    if (info.headings[i].level > info.headings[i - 1].level + 1) {
      out.push(finding("accessibility", "Mulig hopp i overskriftshierarkiet", "Overskriftsnivået hopper fra H" + info.headings[i - 1].level + " til H" + info.headings[i].level + ".", pageUrl, "medium", info.headings[i].text, "Et uventet hopp kan gjøre dokumentstrukturen mindre tydelig.", "Kontroller overskriftsrekkefølgen manuelt."));
      break;
    }
  }
  if (info.invalidStructuredDataCount) out.push(finding("seo", "Ugyldig strukturert data", "Fant strukturert JSON-LD som ikke kunne parses.", pageUrl, "medium", "script[type=\"application/ld+json\"]", "Ugyldig strukturert data kan bli ignorert.", "Valider JSON-LD mot aktuell spesifikasjon."));
  if (info.wordCount < 80) out.push(finding("content", "Svært lite synlig tekst", "Fant omtrent " + info.wordCount + " ord med synlig tekst på siden.", pageUrl, "medium", "sideinnhold", "Lite innhold kan gjøre tilbudet og neste steg uklart.", "Vurder manuelt om siden svarer godt nok på brukerens behov."));
  if (responseMeta && responseMeta.durationMs > 4000) {
    var slow = finding("technical", "Lang responstid i denne kontrollen", "Siden brukte omtrent " + (responseMeta.durationMs / 1000).toFixed(1) + " sekunder i denne enkeltmålingen.", pageUrl, "medium", "HTTP-respons", "Dette er bare én servermåling og ikke en full ytelsestest.", "Gjenta målingen og bruk et egnet ytelsesverktøy før konklusjon.");
    slow.confidence = "low";
    out.push(slow);
  }
  return out;
}

export function calculateScore(findings) {
  var penalty = { high: 12, medium: 6, low: 2 };
  var score = 100;
  (findings || []).forEach(function (item) { if (item.category !== "strength") score -= penalty[item.priority] || 4; });
  return Math.max(0, Math.min(100, score));
}

export { clampText };
