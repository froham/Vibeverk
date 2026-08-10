var TRANSITIONS = {
  draft: ["analyzing", "archived"],
  pending: ["analyzing", "archived"],
  analyzing: ["review_ready", "failed"],
  review_ready: ["analyzing", "reviewed", "archived"],
  reviewed: ["analyzing", "reviewed", "archived"],
  failed: ["analyzing", "archived"],
  archived: []
};

export function canTransition(from, to) {
  return !!TRANSITIONS[from] && TRANSITIONS[from].indexOf(to) !== -1;
}

export function buildMeetingBrief(data) {
  var priority = ["low", "medium", "high"];
  var approved = data.findings.filter(function (item) {
    return item.review_status === "approved";
  });
  var serviceById = {};
  data.catalog.forEach(function (service) { serviceById[service.id] = service; });
  var findingById = {};
  approved.forEach(function (item) { findingById[item.id] = item; });
  var linked = data.findingServices.filter(function (link) {
    return findingById[link.finding_id] && serviceById[link.service_id];
  });
  var services = Array.from(new Set(linked.map(function (link) { return link.service_id; }))).map(function (id) {
    var service = serviceById[id];
    return { title: service.title, deliveryStatus: service.delivery_status };
  });
  var opportunities = approved.filter(function (item) { return item.category !== "strength"; })
    .sort(function (a, b) { return priority.indexOf(b.priority) - priority.indexOf(a.priority); })
    .slice(0, 7)
    .map(function (item) {
      return { title: item.title, observation: item.observation, recommendation: item.recommendation, priority: item.priority };
    });
  return {
    approved: approved,
    content: {
      title: "Møtegrunnlag: " + data.analysis.company_name,
      website: data.analysis.website_url,
      companyDescription: data.analysis.overall_summary || "Automatisk beskrivelse er ikke tilgjengelig.",
      strengths: approved.filter(function (item) { return item.category === "strength"; }).map(function (item) { return item.observation; }).slice(0, 5),
      opportunities: opportunities,
      questions: opportunities.map(function (item) { return "Hvordan opplever dere " + item.title.toLocaleLowerCase("nb-NO") + " i dag?"; }).slice(0, 7),
      possibleDeliveries: services,
      recommendedNextStep: "Avklar hvilke funn kunden kjenner seg igjen i, og avtal deretter omfang for en konkret oppfølging.",
      internalNotes: data.analysis.internal_notes,
      disclaimer: "Internt utkast basert på godkjente funn. Kontroller alle påstander før eventuell kundedialog."
    }
  };
}
