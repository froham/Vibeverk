"use strict";

var fs = require("node:fs");
var configModule = require("./ai-lab/config");
var workflowModule = require("./ai-lab/workflow");

var SYNTHETIC_CONTEXT = [
  "Prosjekt Fjord har lanseringsdato 18. september 2026.",
  "Pilotkontoret er Bergen.",
  "Ansvarlig rolle er prosjektleder; ingen person er navngitt.",
  "Budsjettet er 240 000 kroner.",
  "Status 12. august: Design er godkjent, mens datamigrering gjenstår.",
  "Kundedata og personopplysninger er ikke del av denne syntetiske testen.",
].join(" ");

function normalize(value) {
  return String(value || "").toLocaleLowerCase("nb-NO").replace(/\s+/g, " ").trim();
}

function requireTerms(output, terms) {
  var normalized = normalize(output);
  var missing = terms.filter(function (term) { return normalized.indexOf(normalize(term)) === -1; });
  if (missing.length) throw new Error("Svaret manglet forventede fakta: " + missing.join(", "));
}

function requireUsefulOutput(output, maxChars) {
  var text = String(output || "").trim();
  if (!text) throw new Error("Modellen returnerte tom tekst.");
  if (text.length > maxChars) throw new Error("Svaret var uventet langt (" + text.length + " tegn, maks " + maxChars + ").");
}

function sanitizeConsoleText(value) {
  return String(value)
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, "");
}

function printResult(label, durationMs, output) {
  var safeOutput = sanitizeConsoleText(output);
  var preview = safeOutput.replace(/\s+/g, " ").trim().slice(0, 180);
  process.stdout.write("PASS  " + label + " · " + durationMs + " ms\n");
  process.stdout.write("      " + preview + (safeOutput.length > preview.length ? " …" : "") + "\n");
}

async function runTextCase(workflow, ownerId, definition) {
  var context = workflow.createContext(definition.context, ownerId);
  var output = "";
  try {
    var result = await workflow.runOperation(context.id, definition.operation, [
      { role: "user", content: definition.prompt },
    ], {
      onDelta: function (text) { output += text; },
    }, ownerId);
    definition.verify(output);
    printResult(definition.label, result.provider.durationMs, output);
  } finally {
    workflow.disposeContext(context.id, ownerId);
  }
}

async function runCancellationCase(workflow, ownerId) {
  var context = workflow.createContext({ kind: "none" }, ownerId);
  var controller = new AbortController();
  var sawDelta = false;
  var startedAt = Date.now();
  try {
    await workflow.runOperation(context.id, "chat", [{
      role: "user",
      content: "Skriv en svært lang norsk gjennomgang på minst 2000 ord om hvorfor syntetiske testdata er nyttige.",
    }], {
      signal: controller.signal,
      onDelta: function () {
        if (!sawDelta) {
          sawDelta = true;
          controller.abort();
        }
      },
    }, ownerId);
    throw new Error("Kjøringen fullførte selv om den ble avbrutt etter første tekstbit.");
  } catch (error) {
    if (!sawDelta) throw new Error("Avbrytelsestesten mottok ingen tekstbit før feil: " + error.message);
    if (!error || error.code !== "AI_LAB_CANCELLED") throw error;
    process.stdout.write("PASS  Avbrytelse · " + (Date.now() - startedAt) + " ms · oppstrømskallet ble kansellert\n");
  } finally {
    workflow.disposeContext(context.id, ownerId);
  }
}

async function runVisionCase(workflow, ownerId) {
  var context = workflow.createContext({ kind: "none" }, ownerId);
  var output = "";
  try {
    var result = await workflow.runOperation(context.id, "chat", [{
      role: "user", content: "Beskriv kort hva som er synlig i dette bildet. Ikke gjett på informasjon som ikke kan ses.",
    }], { onDelta: function (text) { output += text; } }, ownerId, {
      mimeType: "image/png",
      data: fs.readFileSync("asset/Logo Icon.png").toString("base64"),
    });
    requireUsefulOutput(output, 1200);
    printResult("Lokalt bildevedlegg", result.provider.durationMs, output);
  } finally { workflow.disposeContext(context.id, ownerId); }
}

async function main() {
  var config = configModule.readConfig(process.env);
  var workflow = workflowModule.createWorkflow(config);
  var ownerId = "local-smoke-operator";
  var cases = [
    {
      label: "Naturlig samtale",
      operation: "chat",
      context: { kind: "none" },
      prompt: "HEI",
      verify: function (output) {
        requireUsefulOutput(output, 600);
        requireTerms(output, ["hei"]);
        if (/læringsutkast|kildemateriale|sourceRefs/i.test(output)) throw new Error("Et enkelt hei ble feilaktig behandlet som læringsutkast.");
      },
    },
    {
      label: "Analyse",
      operation: "analyze-text",
      context: { kind: "pasted-text", text: SYNTHETIC_CONTEXT },
      prompt: "Nevn lanseringsdato, pilotby og arbeidet som gjenstår. Skill fakta fra eventuell tolkning, og ikke legg til opplysninger.",
      verify: function (output) {
        requireUsefulOutput(output, 2200);
        requireTerms(output, ["18. september 2026", "Bergen", "datamigrering"]);
      },
    },
    {
      label: "Oppsummering",
      operation: "summarize",
      context: { kind: "pasted-text", text: SYNTHETIC_CONTEXT },
      prompt: "Oppsummer teksten i maksimalt tre korte punkter. Ta med dato, budsjett og gjenstående arbeid.",
      verify: function (output) {
        requireUsefulOutput(output, 1200);
        requireTerms(output, ["18. september 2026", "240 000", "datamigrering"]);
      },
    },
    {
      label: "Omskriving",
      operation: "rewrite",
      context: { kind: "pasted-text", text: SYNTHETIC_CONTEXT },
      prompt: "Skriv om innholdet til en kort, profesjonell statusoppdatering. Behold nøyaktig lanseringsdato, budsjett og gjenstående arbeid.",
      verify: function (output) {
        requireUsefulOutput(output, 1600);
        requireTerms(output, ["18. september 2026", "240 000", "datamigrering"]);
        if (normalize(output) === normalize(SYNTHETIC_CONTEXT)) throw new Error("Omskrivingen var identisk med kildeteksten.");
      },
    },
  ];

  process.stdout.write("AI Lab ekte lokal smoke\n");
  process.stdout.write("Modell: " + config.ollamaModel + " · provider: loopback Ollama\n");
  process.stdout.write("Data: kun innebygd syntetisk testtekst · Anthropic brukes ikke\n\n");
  for (var index = 0; index < cases.length; index += 1) {
    await runTextCase(workflow, ownerId, cases[index]);
  }
  await runVisionCase(workflow, ownerId);
  await runCancellationCase(workflow, ownerId);
  process.stdout.write("\nRESULTAT: 6/6 PASS\n");
}

main().catch(function (error) {
  process.stderr.write("\nFAIL  " + (error && error.message || "Ukjent feil") + "\n");
  if (error && error.code) process.stderr.write("Kode: " + error.code + "\n");
  process.exitCode = 1;
});
