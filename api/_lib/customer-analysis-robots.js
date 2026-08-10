import { secureFetch } from "./customer-analysis-secure-fetch.js";

var ROBOT_NAME = "vibeverkkundeanalyse";

function rulePattern(path) {
  var end = path.endsWith("$");
  var raw = end ? path.slice(0, -1) : path;
  var escaped = raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped + (end ? "$" : ""));
}

export function parseRobots(text) {
  var groups = [];
  var current = null;
  var acceptingAgents = false;
  String(text || "").split(/\r?\n/).forEach(function (rawLine) {
    var line = rawLine.replace(/#.*$/, "").trim();
    if (!line) return;
    var colon = line.indexOf(":");
    if (colon < 0) return;
    var field = line.slice(0, colon).trim().toLowerCase();
    var value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || !acceptingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      acceptingAgents = true;
      return;
    }
    if (!current) return;
    acceptingAgents = false;
    if ((field === "allow" || field === "disallow") && value) {
      current.rules.push({ type: field, path: value });
    }
  });
  return groups;
}

export function isRobotsAllowed(groups, url, robotName) {
  var name = String(robotName || ROBOT_NAME).toLowerCase();
  var specific = groups.filter(function (group) {
    return group.agents.some(function (agent) { return agent !== "*" && name.indexOf(agent) !== -1; });
  });
  var selected = specific.length ? specific : groups.filter(function (group) { return group.agents.indexOf("*") !== -1; });
  var path = new URL(url).pathname + new URL(url).search;
  var matches = [];
  selected.forEach(function (group) {
    group.rules.forEach(function (rule) {
      try {
        if (rulePattern(rule.path).test(path)) matches.push(rule);
      } catch (e) {}
    });
  });
  if (!matches.length) return { allowed: true, rule: null };
  matches.sort(function (a, b) {
    return b.path.length - a.path.length || (a.type === "allow" ? -1 : 1);
  });
  return { allowed: matches[0].type === "allow", rule: matches[0] };
}

export async function loadRobots(siteUrl, options) {
  var origin = new URL(siteUrl).origin;
  var robotsUrl = origin + "/robots.txt";
  var result = await secureFetch(robotsUrl, Object.assign({}, options || {}, { maxBytes: 256 * 1024 }));
  if (result.status === 404 || result.status === 410) {
    return { url: robotsUrl, status: result.status, groups: [], missing: true };
  }
  if (result.status === 401 || result.status === 403) {
    return { url: robotsUrl, status: result.status, groups: [{ agents: ["*"], rules: [{ type: "disallow", path: "/" }] }], missing: false };
  }
  if (result.status < 200 || result.status >= 300) {
    var error = new Error("robots.txt kunne ikke leses sikkert (HTTP " + result.status + ").");
    error.code = "robots_unavailable";
    throw error;
  }
  return { url: result.url, status: result.status, groups: parseRobots(result.body.toString("utf8")), missing: false };
}

export { ROBOT_NAME };
