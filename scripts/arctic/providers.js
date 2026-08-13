"use strict";

function capabilities(values) {
  return Object.assign({
    chat: false,
    streaming: false,
    documentAnalysis: false,
    codeAnalysis: false,
    fileAccess: false,
    codeChanges: false,
    tools: false,
  }, values || {});
}

function providerDescriptors(aiConfig) {
  aiConfig = aiConfig || { providers: [] };
  var byId = {};
  (aiConfig.providers || []).forEach(function (provider) { byId[provider.id] = provider; });
  var ollama = byId.ollama || {};
  var anthropic = byId.anthropic || {};
  return [
    {
      id: "ollama",
      label: "Gemma / lokal modell",
      model: ollama.model || null,
      configured: !!ollama.configured,
      processing: "local",
      capabilities: capabilities({ chat: true, streaming: true, documentAnalysis: true, codeAnalysis: true }),
      operations: ollama.configured ? ["chat", "analyze-text", "summarize", "rewrite", "learning-draft"] : [],
      reasonCode: ollama.configured ? null : "local_model_not_configured",
    },
    {
      id: "anthropic",
      label: "Claude",
      model: anthropic.model || null,
      configured: !!anthropic.configured,
      processing: "external",
      capabilities: capabilities({ documentAnalysis: true, codeAnalysis: true }),
      operations: anthropic.configured ? ["learning-draft", "learning-review"] : [],
      reasonCode: anthropic.configured ? null : anthropic.reasonCode || "credentials_not_configured",
    },
    {
      id: "codex",
      label: "Codex",
      model: null,
      configured: false,
      processing: "external",
      capabilities: capabilities(),
      operations: [],
      reasonCode: "gateway_required",
    },
  ];
}

module.exports = { capabilities: capabilities, providerDescriptors: providerDescriptors };
