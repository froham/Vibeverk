"use strict";

var assert = require("node:assert/strict");
var EventEmitter = require("node:events");
var PassThrough = require("node:stream").PassThrough;
var test = require("node:test");

function fakeRequestFactory(routes, observed) {
  return function (parsed, options) {
    var req = new EventEmitter();
    req.setTimeout = function (_ms, callback) { req.timeoutCallback = callback; };
    req.destroy = function (error) { if (error) setImmediate(function () { req.emit("error", error); }); };
    req.end = function () {
      var socket = new EventEmitter();
      socket.remoteAddress = observed.peerOverride || observed.pinned;
      req.emit("socket", socket);
      setImmediate(function () { socket.emit("connect"); });
      var route = routes[parsed.toString()] || routes.default;
      if (route && route.timeout) { setImmediate(function () { req.timeoutCallback(); }); return; }
      var response = new PassThrough();
      response.statusCode = route.status;
      response.headers = route.headers || { "content-type": "text/html" };
      setImmediate(function () {
        req.emit("response", response);
        response.end(route.body || "");
      });
    };
    options.lookup(parsed.hostname, {}, function (_error, address) {
      observed.pinned = address;
      observed.lookupCalls = (observed.lookupCalls || 0) + 1;
    });
    return req;
  };
}

test("URL-validering blokkerer interne mål, legitimasjon og uvanlige porter", async function () {
  var secure = await import("./api/_lib/customer-analysis-secure-fetch.js");
  [
    "http://127.0.0.1/", "http://localhost/", "https://server.internal/",
    "file:///etc/passwd", "https://user:pass@example.no/", "https://example.no:8443/"
  ].forEach(function (url) {
    assert.throws(function () { secure.validateAnalysisUrl(url); }, secure.AnalysisFetchError, url);
  });
  assert.equal(secure.validateAnalysisUrl("HTTPS://WWW.Example.NO/a#b").toString(), "https://www.example.no/a");
});

test("alle private og reserverte adresseklasser blokkeres", async function () {
  var secure = await import("./api/_lib/customer-analysis-secure-fetch.js");
  ["0.0.0.1", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.20.1.1", "192.168.1.1", "198.51.100.2", "224.0.0.1", "::1", "fc00::1", "fe80::1", "2001:db8::1"].forEach(function (ip) {
    assert.equal(secure.isBlockedAddress(ip), true, ip);
  });
  assert.equal(secure.isBlockedAddress("93.184.216.34"), false);
  assert.equal(secure.isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946"), false);
});

test("DNS-adressen pinnes og resolver kjøres ikke på nytt av HTTP-klienten", async function () {
  var secure = await import("./api/_lib/customer-analysis-secure-fetch.js");
  var resolutions = 0;
  var observed = {};
  var result = await secure.secureFetch("https://example.no/", {
    resolve: async function () {
      resolutions += 1;
      return resolutions === 1 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }];
    },
    request: fakeRequestFactory({ default: { status: 200, body: "ok" } }, observed)
  });
  assert.equal(result.status, 200);
  assert.equal(resolutions, 1, "ingen ny DNS-oppløsning under tilkobling");
  assert.equal(observed.pinned, "93.184.216.34");
});

test("omdirigering til blokkert adresse stoppes før neste request", async function () {
  var secure = await import("./api/_lib/customer-analysis-secure-fetch.js");
  var requests = 0;
  await assert.rejects(function () {
    return secure.secureFetch("https://example.no/", {
      resolve: async function () { return [{ address: "93.184.216.34", family: 4 }]; },
      request: function (parsed, options) {
        requests += 1;
        return fakeRequestFactory({ default: { status: 302, headers: { location: "http://127.0.0.1/private" } } }, {})(parsed, options);
      }
    });
  }, function (error) { return error.code === "blocked_hostname"; });
  assert.equal(requests, 1);
});

test("hvert omdirigeringsmål får nytt DNS-oppslag og privat DNS-mål blokkeres", async function () {
  var secure = await import("./api/_lib/customer-analysis-secure-fetch.js");
  var requests = 0;
  await assert.rejects(function () {
    return secure.secureFetch("https://example.no/", {
      resolve: async function (hostname) {
        return hostname === "example.no" ? [{ address:"93.184.216.34", family:4 }] : [{ address:"10.0.0.8", family:4 }];
      },
      request: function (parsed, options) {
        requests += 1;
        return fakeRequestFactory({ default:{ status:302, headers:{ location:"https://www.example.no/ny" } } }, {})(parsed, options);
      }
    });
  }, function (error) { return error.code === "blocked_address"; });
  assert.equal(requests, 1);
});

test("omdirigering kan ikke nedgradere HTTPS til ukryptert HTTP", async function () {
  var secure = await import("./api/_lib/customer-analysis-secure-fetch.js");
  var requests = 0;
  await assert.rejects(function () {
    return secure.secureFetch("https://example.no/", {
      resolve:async function () { return [{ address:"93.184.216.34", family:4 }]; },
      request:function (parsed, options) {
        requests += 1;
        return fakeRequestFactory({ default:{ status:301, headers:{ location:"http://www.example.no/" } } }, {})(parsed, options);
      }
    });
  }, function (error) { return error.code === "redirect_downgrade"; });
  assert.equal(requests, 1);
});

test("for stor respons og timeout returnerer tydelige feilkoder", async function () {
  var secure = await import("./api/_lib/customer-analysis-secure-fetch.js");
  var common = { resolve: async function () { return [{ address: "93.184.216.34", family: 4 }]; } };
  await assert.rejects(function () {
    return secure.secureFetch("https://example.no/", Object.assign({}, common, {
      maxBytes: 5, request: fakeRequestFactory({ default: { status: 200, body: "123456" } }, {})
    }));
  }, function (error) { return error.code === "response_too_large"; });
  await assert.rejects(function () {
    return secure.secureFetch("https://example.no/", Object.assign({}, common, {
      request: fakeRequestFactory({ default: { timeout: true } }, {})
    }));
  }, function (error) { return error.code === "timeout"; });
});

test("robots.txt bruker spesifikk gruppe, lengste regel og allow ved lik lengde", async function () {
  var robots = await import("./api/_lib/customer-analysis-robots.js");
  var groups = robots.parseRobots([
    "User-agent: *", "Disallow: /", "", "User-agent: VibeverkKundeanalyse",
    "Disallow: /privat", "Allow: /privat/offentlig", "Disallow: /tmp/*", "Allow: /tmp/public$"
  ].join("\n"));
  assert.equal(robots.isRobotsAllowed(groups, "https://example.no/").allowed, true);
  assert.equal(robots.isRobotsAllowed(groups, "https://example.no/privat/a").allowed, false);
  assert.equal(robots.isRobotsAllowed(groups, "https://example.no/privat/offentlig").allowed, true);
  assert.equal(robots.isRobotsAllowed(groups, "https://example.no/tmp/public").allowed, true);
});

test("HTML-parsing finner SEO-, UU- og interne lenkeforhold", async function () {
  var html = await import("./api/_lib/customer-analysis-html.js");
  var result = html.analyzeHtml('<html><head><meta name="viewport" content="width=device-width"></head><body><h1>Hei</h1><h3>Hopp</h3><img src="x.jpg"><form><input name="email"></form><a href="/kontakt">Kontakt</a><button></button></body></html>', "https://example.no/");
  assert.equal(result.h1.length, 1);
  assert.equal(result.imagesWithoutAlt.length, 1);
  assert.equal(result.unlabeledControls.length, 1);
  assert.equal(result.unnamedActions.length, 1);
  assert.deepEqual(result.internalLinks, ["https://example.no/kontakt"]);
  var findings = html.findingsFromHtml(result, "https://example.no/", { durationMs: 10 });
  assert(findings.some(function (item) { return item.title === "Språk er ikke angitt"; }));
  assert(findings.some(function (item) { return item.title === "Mulig hopp i overskriftshierarkiet"; }));
});

test("crawleren respekterer maks antall sider og lagrer ikke full HTML", async function () {
  var crawler = await import("./api/_lib/customer-analysis-crawler.js");
  var observed = {};
  var routes = {
    "https://example.no/robots.txt": { status:200, headers:{ "content-type":"text/plain" }, body:"User-agent: *\nAllow: /" },
    "https://example.no/": { status:200, headers:{ "content-type":"text/html" }, body:'<html lang="nb"><head><title>Forside</title><meta name="description" content="Test"><meta name="viewport" content="width=device-width"></head><body><h1>Hei</h1><a href="/kontakt">Kontakt</a><a href="/tjenester">Tjenester</a></body></html>' },
    "https://example.no/kontakt": { status:200, headers:{ "content-type":"text/html" }, body:'<html lang="nb"><head><title>Kontakt</title></head><body><h1>Kontakt</h1><p>Ta kontakt med oss for hjelp og informasjon.</p></body></html>' },
    "https://example.no/sitemap.xml": { status:404, headers:{ "content-type":"text/plain" }, body:"" }
  };
  var result = await crawler.crawlWebsite("https://example.no/", 2, {
    resolve:async function () { return [{ address:"93.184.216.34", family:4 }]; },
    request:fakeRequestFactory(routes, observed)
  });
  assert.equal(result.pages.length, 2);
  assert.equal(result.fetchedPages, 2);
  assert(result.pages.every(function (page) { return page.textExcerpt.length <= 1800 && !Object.prototype.hasOwnProperty.call(page, "html"); }));
  assert(result.findings.some(function (item) { return item.category === "seo" && item.serviceCodes.indexOf("seo-health-check") !== -1; }));
});

test("crawleren stopper før startsiden når robots.txt avviser hele nettstedet", async function () {
  var crawler = await import("./api/_lib/customer-analysis-crawler.js");
  var requests = 0;
  await assert.rejects(function () {
    return crawler.crawlWebsite("https://example.no/", 5, {
      resolve:async function () { return [{ address:"93.184.216.34", family:4 }]; },
      request:function (parsed, options) {
        requests += 1;
        return fakeRequestFactory({ default:{ status:200, headers:{ "content-type":"text/plain" }, body:"User-agent: *\nDisallow: /" } }, {})(parsed, options);
      }
    });
  }, function (error) { return error.code === "robots_disallowed_site"; });
  assert.equal(requests, 1, "bare robots.txt ble hentet");
});

test("AI-validering forkaster ukjent URL, sitat uten kilde og ukjent tjeneste", async function () {
  var ai = await import("./api/_lib/customer-analysis-ai.js");
  var pages = [{ finalUrl: "https://example.no/", textExcerpt: "Vi reparerer sykler i Bergen." }];
  var catalog = [{ code: "contact-form", active: true }];
  var result = ai.validateCustomerAnalysisAi({
    businessSummary: "Sykkelverksted.", meetingQuestions: ["Hva er viktig?"], findings: [
      { category: "content", title: "Tydelig tjeneste", observation: "Reparasjon er omtalt.", sourceUrl: "https://example.no/", evidenceQuote: "reparerer sykler", significance: "Bra", recommendation: "Behold", priority: "low", confidence: "high", serviceCodes: ["contact-form", "fantasi"], serviceRationale: "Relevant" },
      { category: "content", title: "Oppdiktet", observation: "Uten belegg", sourceUrl: "https://example.no/", evidenceQuote: "finnes ikke", significance: "", recommendation: "", priority: "high", confidence: "high", serviceCodes: [], serviceRationale: "" },
      { category: "content", title: "Feil URL", observation: "Utenfor snapshot", sourceUrl: "https://other.no/", evidenceQuote: "tekst", significance: "", recommendation: "", priority: "high", confidence: "high", serviceCodes: [], serviceRationale: "" }
    ]
  }, pages, catalog);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0].serviceCodes, ["contact-form"]);
});

test("AI er valgfri, og provider-feil eller ugyldig tool-output håndteres tydelig", async function () {
  var ai = await import("./api/_lib/customer-analysis-ai.js");
  var input = [{ finalUrl:"https://example.no/", title:"Test", textExcerpt:"Dokumentert tekst" }];
  var catalog = [{ code:"faq", title:"FAQ", description:"Spørsmål", delivery_status:"available", active:true }];
  var missing = await ai.generateCustomerAnalysis({ companyName:"Test", websiteUrl:"https://example.no", industry:"" }, input, [], catalog, { apiKey:"" });
  assert.equal(missing.status, "not_configured");
  await assert.rejects(function () {
    return ai.generateCustomerAnalysis({ companyName:"Test", websiteUrl:"https://example.no", industry:"" }, input, [], catalog, {
      apiKey:"key", fetch:async function () { return new Response("{}", { status:503 }); }
    });
  }, /HTTP 503/);
  await assert.rejects(function () {
    return ai.generateCustomerAnalysis({ companyName:"Test", websiteUrl:"https://example.no", industry:"" }, input, [], catalog, {
      apiKey:"key", fetch:async function () { return new Response(JSON.stringify({ content:[{ type:"text", text:"ufullstendig" }] }), { status:200 }); }
    });
  }, /Uventet svarformat/);
});

test("AI-møteutkast kan bare referere til uttrykkelig godkjente funn", async function () {
  var ai = await import("./api/_lib/customer-analysis-ai.js");
  var approved = [
    { id:"f-approved", category:"content", title:"Kontakt", observation:"Kontakt er vanskelig å finne.", significance:"Brukerreise", recommendation:"Gjør kontakt tydelig." },
    { id:"f-strength", category:"strength", title:"HTTPS", observation:"HTTPS er på plass.", significance:"Tillit", recommendation:"Behold." }
  ];
  var result = ai.validateMeetingDraft({
    strengths:[{ findingId:"f-strength", text:"HTTPS er på plass." }, { findingId:"f-approved", text:"Feil kategori" }],
    opportunities:[{ findingId:"f-approved", title:"Tydeligere kontakt", text:"Kontaktveien kan gjøres tydeligere.", recommendation:"Avklar behovet." }, { findingId:"f-unknown", title:"Oppdiktet", text:"Nei", recommendation:"Nei" }],
    questions:[{ findingId:"f-approved", text:"Hvordan ønsker dere at kunder tar kontakt?" }, { findingId:"f-unknown", text:"Uten kilde" }],
    nextStep:"Avklar behovet i møtet."
  }, approved);
  assert.equal(result.strengths.length, 1);
  assert.equal(result.opportunities.length, 1);
  assert.equal(result.questions.length, 1);
  assert.equal(result.opportunities[0].findingId, "f-approved");
});

test("control-plane-tilgang krever gyldig token og aktiv operator", async function () {
  var store = await import("./api/_lib/customer-analysis-store.js");
  var previous = {
    url:process.env.VIBEVERK_CONTROL_URL, anon:process.env.VIBEVERK_CONTROL_ANON_KEY,
    service:process.env.VIBEVERK_CONTROL_SERVICE_ROLE_KEY
  };
  process.env.VIBEVERK_CONTROL_URL = "https://control.example";
  process.env.VIBEVERK_CONTROL_ANON_KEY = "anon";
  process.env.VIBEVERK_CONTROL_SERVICE_ROLE_KEY = "service";
  try {
    var active = await store.verifyConsoleOperator("token", { fetch:async function (url) {
      if (String(url).includes("/auth/v1/user")) return new Response(JSON.stringify({ id:"op-1" }), { status:200 });
      return new Response(JSON.stringify([{ id:"op-1", status:"active" }]), { status:200 });
    } });
    assert.equal(active.ok, true);
    var inactive = await store.verifyConsoleOperator("token", { fetch:async function (url) {
      if (String(url).includes("/auth/v1/user")) return new Response(JSON.stringify({ id:"op-1" }), { status:200 });
      return new Response(JSON.stringify([{ id:"op-1", status:"disabled" }]), { status:200 });
    } });
    assert.equal(inactive.ok, false);
    assert.equal(inactive.status, 403);
    var invalid = await store.verifyConsoleOperator("token", { fetch:async function () { return new Response("{}", { status:401 }); } });
    assert.equal(invalid.status, 401);
  } finally {
    if (previous.url === undefined) delete process.env.VIBEVERK_CONTROL_URL; else process.env.VIBEVERK_CONTROL_URL = previous.url;
    if (previous.anon === undefined) delete process.env.VIBEVERK_CONTROL_ANON_KEY; else process.env.VIBEVERK_CONTROL_ANON_KEY = previous.anon;
    if (previous.service === undefined) delete process.env.VIBEVERK_CONTROL_SERVICE_ROLE_KEY; else process.env.VIBEVERK_CONTROL_SERVICE_ROLE_KEY = previous.service;
  }
});

test("statusmaskinen avviser farlige overganger", async function () {
  var domain = await import("./api/_lib/customer-analysis-domain.js");
  assert.equal(domain.canTransition("draft", "analyzing"), true);
  assert.equal(domain.canTransition("analyzing", "archived"), false);
  assert.equal(domain.canTransition("archived", "analyzing"), false);
  assert.equal(domain.canTransition("review_ready", "reviewed"), true);
});

test("møtegrunnlaget bruker bare uttrykkelig godkjente funn", async function () {
  var domain = await import("./api/_lib/customer-analysis-domain.js");
  var data = {
    analysis: { company_name: "Test AS", website_url: "https://example.no", overall_summary: "Kort.", internal_notes: "Internt." },
    catalog: [{ id: "s1", title: "FAQ", delivery_status: "available" }],
    findingServices: [{ finding_id: "f1", service_id: "s1" }, { finding_id: "f2", service_id: "s1" }],
    findings: [
      { id: "f1", review_status: "approved", category: "content", title: "Godkjent", observation: "Ja", recommendation: "Gjør", priority: "high" },
      { id: "f2", review_status: "unreviewed", category: "content", title: "Ikke vurdert", observation: "Nei", recommendation: "Ikke bruk", priority: "high" },
      { id: "f3", review_status: "removed", category: "strength", title: "Fjernet", observation: "Nei", recommendation: "", priority: "low" },
      { id: "f4", review_status: "edited", category: "content", title: "Redigert, ikke godkjent", observation: "Nei", recommendation: "", priority: "low" }
    ]
  };
  var result = domain.buildMeetingBrief(data);
  assert.equal(result.approved.length, 1);
  assert.equal(result.content.opportunities.length, 1);
  assert.equal(result.content.opportunities[0].title, "Godkjent");
  assert.equal(result.content.possibleDeliveries.length, 1);
});

test("API avviser kall uten Console-token før database eller crawl", async function () {
  var api = await import("./api/customer-analysis.js");
  var response = await api.default.fetch(new Request("https://vibeverk.no/api/customer-analysis", { method: "GET" }));
  assert.equal(response.status, 401);
});
