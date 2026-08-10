"use strict";

var sendPrompt = require("./local-ai-client").sendPrompt;
var DEFAULT_TEST_PROMPT = "Svar med éi kort setning som stadfestar at den lokale AI-klienten verkar.";

function sanitizeConsoleText(value) {
  return String(value)
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, "");
}

async function testLocalAi(prompt, options) {
  options = options || {};
  var selectedPrompt = typeof prompt === "string" && prompt.trim()
    ? prompt
    : DEFAULT_TEST_PROMPT;
  var answer = await sendPrompt(selectedPrompt, options);
  var log = options.log || console.log;
  log(sanitizeConsoleText(answer));
  return answer;
}

if (require.main === module) {
  testLocalAi().catch(function (error) {
    console.error("[lokal-ai] " + error.message);
    process.exitCode = 1;
  });
}

module.exports = { testLocalAi: testLocalAi };
