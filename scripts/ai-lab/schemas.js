"use strict";

var LEVELS = ["grunnleggende", "avansert", "teknisk"];
var REVIEW_DECISIONS = ["GODKJENT", "MÅ RETTES", "MANGLER KILDE"];
var REVIEW_FINDING_STATUSES = REVIEW_DECISIONS.slice();

function schemaError(message) {
  var error = new Error(message);
  error.statusCode = 422;
  error.code = "AI_LAB_SCHEMA_ERROR";
  return error;
}

function exactObject(value, allowed, required, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw schemaError(label + " må vere eit objekt.");
  var keys = Object.keys(value);
  keys.forEach(function (key) {
    if (allowed.indexOf(key) === -1) throw schemaError(label + " har ukjent felt: " + key + ".");
  });
  required.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw schemaError(label + " manglar feltet " + key + ".");
  });
  return value;
}

function text(value, maxLength, label) {
  if (typeof value !== "string" || !value.trim()) throw schemaError(label + " må vere tekst.");
  var clean = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim();
  if (!clean || clean.length > maxLength) throw schemaError(label + " har ugyldig lengd.");
  return clean;
}

function array(value, min, max, label) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw schemaError(label + " må ha mellom " + min + " og " + max + " element.");
  }
  return value;
}

function validateSourceRefs(rawRefs, snapshot, label, allowEmpty) {
  var refs = array(rawRefs, allowEmpty ? 0 : 1, 12, label + ".sourceRefs");
  var sources = Object.create(null);
  snapshot.sources.forEach(function (source) { sources[source.id] = source; });
  return refs.map(function (raw, index) {
    exactObject(raw, ["sourceId", "startLine", "endLine"], ["sourceId", "startLine", "endLine"], label + ".sourceRefs[" + index + "]");
    var source = sources[raw.sourceId];
    if (!source) throw schemaError(label + " viser til ei kjelde som ikkje finst i snapshotet.");
    if (!Number.isInteger(raw.startLine) || !Number.isInteger(raw.endLine) || raw.startLine < 1 || raw.endLine < raw.startLine || raw.endLine > source.lineCount) {
      throw schemaError(label + " har ugyldig linjeintervall.");
    }
    return { sourceId: raw.sourceId, startLine: raw.startLine, endLine: raw.endLine };
  });
}

function validateDocumentedSection(raw, snapshot, label, maxLength) {
  exactObject(raw, ["text", "sourceRefs"], ["text", "sourceRefs"], label);
  return {
    text: text(raw.text, maxLength, label + ".text"),
    sourceRefs: validateSourceRefs(raw.sourceRefs, snapshot, label, false),
  };
}

function validateQuestion(raw, snapshot, label, answerField) {
  exactObject(raw, ["question", answerField, "sourceRefs"], ["question", answerField, "sourceRefs"], label);
  var result = {
    question: text(raw.question, 500, label + ".question"),
    sourceRefs: validateSourceRefs(raw.sourceRefs, snapshot, label, false),
  };
  result[answerField] = text(raw[answerField], 1000, label + "." + answerField);
  return result;
}

function validateLearningDraft(raw, snapshot) {
  exactObject(raw,
    ["schemaVersion", "draftStatus", "title", "suggestedLevel", "moduleDescription", "howItWorks", "onboardingText", "quizQuestions", "controlQuestions", "notDocumented"],
    ["schemaVersion", "draftStatus", "title", "suggestedLevel", "moduleDescription", "howItWorks", "onboardingText", "quizQuestions", "controlQuestions", "notDocumented"],
    "utkastet"
  );
  if (raw.schemaVersion !== "learning-draft-v1") throw schemaError("Utkastet har feil schemaVersion.");
  if (raw.draftStatus !== "UTKAST") throw schemaError("AI-innhald skal alltid ha status UTKAST.");
  if (LEVELS.indexOf(raw.suggestedLevel) === -1) throw schemaError("Ugyldig læringsnivå.");
  return {
    schemaVersion: raw.schemaVersion,
    draftStatus: raw.draftStatus,
    title: text(raw.title, 200, "title"),
    suggestedLevel: raw.suggestedLevel,
    moduleDescription: validateDocumentedSection(raw.moduleDescription, snapshot, "moduleDescription", 1200),
    howItWorks: validateDocumentedSection(raw.howItWorks, snapshot, "howItWorks", 5000),
    onboardingText: validateDocumentedSection(raw.onboardingText, snapshot, "onboardingText", 5000),
    quizQuestions: array(raw.quizQuestions, 2, 10, "quizQuestions").map(function (item, index) {
      return validateQuestion(item, snapshot, "quizQuestions[" + index + "]", "answer");
    }),
    controlQuestions: array(raw.controlQuestions, 2, 10, "controlQuestions").map(function (item, index) {
      return validateQuestion(item, snapshot, "controlQuestions[" + index + "]", "expectedAnswer");
    }),
    notDocumented: array(raw.notDocumented, 0, 20, "notDocumented").map(function (item, index) {
      exactObject(item, ["status", "claim", "reason"], ["status", "claim", "reason"], "notDocumented[" + index + "]");
      if (item.status !== "IKKE DOKUMENTERT") throw schemaError("Udokumenterte punkt må merkast IKKE DOKUMENTERT.");
      return {
        status: "IKKE DOKUMENTERT",
        claim: text(item.claim, 800, "notDocumented[" + index + "].claim"),
        reason: text(item.reason, 800, "notDocumented[" + index + "].reason"),
      };
    }),
  };
}

function validateReviewFinding(raw, snapshot, label) {
  exactObject(raw, ["status", "message", "sourceRefs"], ["status", "message", "sourceRefs"], label);
  if (REVIEW_FINDING_STATUSES.indexOf(raw.status) === -1) throw schemaError(label + " har ugyldig status.");
  return {
    status: raw.status,
    message: text(raw.message, 1200, label + ".message"),
    sourceRefs: validateSourceRefs(raw.sourceRefs, snapshot, label, raw.status === "MÅ RETTES"),
  };
}

function validateVerdictBody(raw, snapshot, label) {
  exactObject(raw, ["verdict", "findings"], ["verdict", "findings"], label);
  if (REVIEW_DECISIONS.indexOf(raw.verdict) === -1) throw schemaError(label + " har ugyldig verdict.");
  var isApproved = raw.verdict === "GODKJENT";
  var findings = array(raw.findings, isApproved ? 0 : 1, isApproved ? 0 : 8, label + ".findings")
    .map(function (item, index) { return validateReviewFinding(item, snapshot, label + ".findings[" + index + "]"); });
  return { verdict: raw.verdict, findings: findings };
}

function validateVerdictArray(rawArray, snapshot, label, expectedCount) {
  var items = array(rawArray, expectedCount, expectedCount, label);
  var byIndex = new Array(expectedCount).fill(null);
  items.forEach(function (raw, position) {
    var itemLabel = label + "[" + position + "]";
    exactObject(raw, ["index", "verdict", "findings"], ["index", "verdict", "findings"], itemLabel);
    if (!Number.isInteger(raw.index) || raw.index < 0 || raw.index >= expectedCount) {
      throw schemaError(itemLabel + " har index utanfor gyldig område.");
    }
    if (byIndex[raw.index] !== null) throw schemaError(label + " har dupliserte verdiar for index " + raw.index + ".");
    var body = validateVerdictBody({ verdict: raw.verdict, findings: raw.findings }, snapshot, label + "[" + raw.index + "]");
    byIndex[raw.index] = { index: raw.index, verdict: body.verdict, findings: body.findings };
  });
  for (var i = 0; i < expectedCount; i++) {
    if (byIndex[i] === null) throw schemaError(label + " manglar verdict for index " + i + ".");
  }
  return byIndex;
}

function validateLearningReview(raw, snapshot, draft) {
  if (!draft || !Array.isArray(draft.quizQuestions) || !Array.isArray(draft.controlQuestions)) {
    throw schemaError("Reviewet kan ikkje validerast utan det tilhøyrande utkastet.");
  }
  exactObject(raw,
    ["schemaVersion", "decision", "rationale", "sectionVerdicts", "quizQuestionVerdicts", "controlQuestionVerdicts"],
    ["schemaVersion", "decision", "rationale", "sectionVerdicts", "quizQuestionVerdicts", "controlQuestionVerdicts"],
    "reviewet");
  if (raw.schemaVersion !== "learning-review-v2") throw schemaError("Reviewet har feil schemaVersion.");
  if (REVIEW_DECISIONS.indexOf(raw.decision) === -1) throw schemaError("Reviewet har ugyldig avgjerd.");

  exactObject(raw.sectionVerdicts,
    ["moduleDescription", "howItWorks", "onboardingText", "notDocumented"],
    ["moduleDescription", "howItWorks", "onboardingText", "notDocumented"],
    "sectionVerdicts");
  var sectionVerdicts = {
    moduleDescription: validateVerdictBody(raw.sectionVerdicts.moduleDescription, snapshot, "sectionVerdicts.moduleDescription"),
    howItWorks: validateVerdictBody(raw.sectionVerdicts.howItWorks, snapshot, "sectionVerdicts.howItWorks"),
    onboardingText: validateVerdictBody(raw.sectionVerdicts.onboardingText, snapshot, "sectionVerdicts.onboardingText"),
    notDocumented: validateVerdictBody(raw.sectionVerdicts.notDocumented, snapshot, "sectionVerdicts.notDocumented"),
  };
  var quizQuestionVerdicts = validateVerdictArray(raw.quizQuestionVerdicts, snapshot, "quizQuestionVerdicts", draft.quizQuestions.length);
  var controlQuestionVerdicts = validateVerdictArray(raw.controlQuestionVerdicts, snapshot, "controlQuestionVerdicts", draft.controlQuestions.length);

  var allVerdicts = [sectionVerdicts.moduleDescription, sectionVerdicts.howItWorks, sectionVerdicts.onboardingText, sectionVerdicts.notDocumented]
    .concat(quizQuestionVerdicts, controlQuestionVerdicts)
    .map(function (v) { return v.verdict; });
  var allApproved = allVerdicts.every(function (v) { return v === "GODKJENT"; });

  if (raw.decision === "GODKJENT" && !allApproved) {
    throw schemaError("Samla avgjerd kan ikkje vere GODKJENT når ikkje alle delvurderingar er GODKJENT.");
  }
  if (raw.decision !== "GODKJENT" && allApproved) {
    throw schemaError("Samla avgjerd " + raw.decision + " krev minst éi delvurdering som ikkje er GODKJENT.");
  }

  return {
    schemaVersion: raw.schemaVersion,
    decision: raw.decision,
    rationale: text(raw.rationale, 1600, "rationale"),
    sectionVerdicts: sectionVerdicts,
    quizQuestionVerdicts: quizQuestionVerdicts,
    controlQuestionVerdicts: controlQuestionVerdicts,
  };
}

function sourceIdsFromSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.sources) || !snapshot.sources.length) return null;
  return snapshot.sources.map(function (source) { return source.id; });
}

function sourceRefSchema(sourceIds) {
  var sourceIdSchema = { type: "string" };
  if (Array.isArray(sourceIds) && sourceIds.length) sourceIdSchema.enum = sourceIds.slice();
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      sourceId: sourceIdSchema,
      startLine: { type: "integer", minimum: 1 },
      endLine: { type: "integer", minimum: 1 },
    },
    required: ["sourceId", "startLine", "endLine"],
  };
}

function learningDraftSchema(snapshot) {
  var sourceIds = sourceIdsFromSnapshot(snapshot);
  var documented = {
    type: "object", additionalProperties: false,
    properties: { text: { type: "string" }, sourceRefs: { type: "array", items: sourceRefSchema(sourceIds), minItems: 1 } },
    required: ["text", "sourceRefs"],
  };
  var question = function (answerField) {
    var properties = { question: { type: "string" }, sourceRefs: { type: "array", items: sourceRefSchema(sourceIds), minItems: 1 } };
    properties[answerField] = { type: "string" };
    return { type: "object", additionalProperties: false, properties: properties, required: ["question", answerField, "sourceRefs"] };
  };
  return {
    type: "object", additionalProperties: false,
    properties: {
      schemaVersion: { type: "string", enum: ["learning-draft-v1"] },
      draftStatus: { type: "string", enum: ["UTKAST"] },
      title: { type: "string" },
      suggestedLevel: { type: "string", enum: LEVELS },
      moduleDescription: documented,
      howItWorks: documented,
      onboardingText: documented,
      quizQuestions: { type: "array", minItems: 2, maxItems: 10, items: question("answer") },
      controlQuestions: { type: "array", minItems: 2, maxItems: 10, items: question("expectedAnswer") },
      notDocumented: {
        type: "array", maxItems: 20,
        items: {
          type: "object", additionalProperties: false,
          properties: { status: { type: "string", enum: ["IKKE DOKUMENTERT"] }, claim: { type: "string" }, reason: { type: "string" } },
          required: ["status", "claim", "reason"],
        },
      },
    },
    required: ["schemaVersion", "draftStatus", "title", "suggestedLevel", "moduleDescription", "howItWorks", "onboardingText", "quizQuestions", "controlQuestions", "notDocumented"],
  };
}

function reviewFindingSchema(sourceIds) {
  return {
    type: "object", additionalProperties: false,
    properties: {
      status: { type: "string", enum: REVIEW_FINDING_STATUSES },
      message: { type: "string" },
      sourceRefs: { type: "array", maxItems: 12, items: sourceRefSchema(sourceIds) },
    },
    required: ["status", "message", "sourceRefs"],
  };
}

function verdictBodySchema(sourceIds, maxFindings) {
  return {
    type: "object", additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: REVIEW_DECISIONS },
      findings: { type: "array", maxItems: maxFindings, items: reviewFindingSchema(sourceIds) },
    },
    required: ["verdict", "findings"],
  };
}

function indexedVerdictSchema(sourceIds, maxIndex) {
  var schema = verdictBodySchema(sourceIds, 8);
  schema.properties.index = { type: "integer", minimum: 0, maximum: maxIndex };
  schema.required = ["index"].concat(schema.required);
  return schema;
}

function learningReviewSchema(snapshot, draft) {
  if (!draft || !Array.isArray(draft.quizQuestions) || !Array.isArray(draft.controlQuestions)) {
    throw schemaError("learningReviewSchema krev det tilhøyrande utkastet.");
  }
  var sourceIds = sourceIdsFromSnapshot(snapshot);
  var quizCount = draft.quizQuestions.length;
  var controlCount = draft.controlQuestions.length;
  return {
    type: "object", additionalProperties: false,
    properties: {
      schemaVersion: { type: "string", enum: ["learning-review-v2"] },
      decision: { type: "string", enum: REVIEW_DECISIONS },
      rationale: { type: "string" },
      sectionVerdicts: {
        type: "object", additionalProperties: false,
        properties: {
          moduleDescription: verdictBodySchema(sourceIds, 8),
          howItWorks: verdictBodySchema(sourceIds, 8),
          onboardingText: verdictBodySchema(sourceIds, 8),
          notDocumented: verdictBodySchema(sourceIds, 8),
        },
        required: ["moduleDescription", "howItWorks", "onboardingText", "notDocumented"],
      },
      quizQuestionVerdicts: {
        type: "array", minItems: quizCount, maxItems: quizCount,
        items: indexedVerdictSchema(sourceIds, Math.max(quizCount - 1, 0)),
      },
      controlQuestionVerdicts: {
        type: "array", minItems: controlCount, maxItems: controlCount,
        items: indexedVerdictSchema(sourceIds, Math.max(controlCount - 1, 0)),
      },
    },
    required: ["schemaVersion", "decision", "rationale", "sectionVerdicts", "quizQuestionVerdicts", "controlQuestionVerdicts"],
  };
}

module.exports = {
  learningDraftSchema: learningDraftSchema,
  learningReviewSchema: learningReviewSchema,
  validateLearningDraft: validateLearningDraft,
  validateLearningReview: validateLearningReview,
};
