/* =============================================================================
   module-quote.js  —  TILBUD (intranett)
   -----------------------------------------------------------------------------
   Intern behandling av tilbudsforespørsler. Leser leads fra App.getLeads()
   og filtrerer på "Tilbudsforesp"-prefix — samme data som admin på offentlig side.

   Slås av/på med config.intranettFeatures.quote.
   Ruter: #/quote
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.quote === false) return;

  /* =========================================================================
     DATA
     ====================================================================== */
  function getQuotes() {
    var leads = App.getLeads ? App.getLeads() : [];
    return leads.filter(function (l) {
      return l.message && l.message.indexOf("Tilbudsforesp") === 0;
    });
  }

  function setLeadStatus(id, status) {
    if (App.setLeadStatus) {
      App.setLeadStatus(id, status);
      Intranet.logActivity({ type: "quote_status", label: "Tilbud → " + status });
    }
  }

  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  /* =========================================================================
     STATUS
     ====================================================================== */
  var STATUS_LABELS = App.STATUS_LABELS || { ny: "Ny", lest: "Lest", løst: "Løst" };
  var STATUS_ORDER  = App.STATUS_ORDER  || ["ny", "lest", "løst"];

  function statusBadge(status) {
    var map = { ny: "#6A6A73", lest: "var(--color-secondary)", løst: "#2a7a2a" };
    var color = map[status] || "#6A6A73";
    return '<span style="display:inline-block;font-size:.7rem;font-weight:700;padding:.15rem .5rem;border-radius:999px;background:' + color + '22;color:' + color + ';text-transform:uppercase">' + C.esc(STATUS_LABELS[status] || status) + '</span>';
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  function render() { return '<div id="quote-root"></div>'; }

  function mount(outlet) {
    var root = outlet.querySelector("#quote-root") || outlet;
    renderList(root);
  }

  function renderList(root) {
    var quotes = getQuotes();

    var groups = [
      { status: "ny",   label: "Nye",  items: [] },
      { status: "lest", label: "Lest", items: [] },
      { status: "løst", label: "Løst", items: [] }
    ];
    quotes.forEach(function (q) {
      var g = groups.find(function (g) { return g.status === (q.status || "ny"); });
      if (g) g.items.push(q);
    });

    var activeGroups = groups.filter(function (g) { return g.status !== "løst" || g.items.length; });

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Tilbud <span style="font-size:1rem;font-weight:400;color:var(--color-muted)">(' + quotes.length + ')</span></h2>' +
      '</div>' +
      (quotes.length === 0
        ? '<p style="color:var(--color-muted);font-size:.9rem">Ingen tilbudsforespørsler ennå.</p>'
        : activeGroups.map(function (g) {
            if (!g.items.length) return "";
            return '<div style="margin-bottom:1.2rem">' +
              '<p class="i-section-label">' + C.esc(g.label) + ' (' + g.items.length + ')</p>' +
              '<ul class="admin-list">' + g.items.map(function (q) {
                var preview = (q.message || "").split("\n")
                  .filter(function (ln) { return ln.trim() && ln.indexOf("===") === -1 && ln !== "Tilbudsforespørsel"; })
                  .slice(0, 2).join(" · ").slice(0, 120);
                return '<li class="admin-row">' +
                  '<div class="admin-row__main">' +
                    '<strong>' + C.esc(q.name || "(ukjent)") + '</strong>' +
                    '<span class="admin-row__meta">' +
                      '<a href="mailto:' + C.esc(q.email) + '" style="color:var(--color-primary)">' + C.esc(q.email) + '</a>' +
                    '</span>' +
                    (preview ? '<span class="admin-row__meta">' + C.esc(preview) + (preview.length >= 120 ? "…" : "") + '</span>' : "") +
                    '<span class="admin-row__meta">' + formatDate(q.time) + '</span>' +
                  '</div>' +
                  '<div class="admin-row__actions" style="flex-direction:column;align-items:flex-end;gap:.3rem">' +
                    statusBadge(q.status || "ny") +
                    '<select data-qt-status="' + C.esc(q.id) + '" style="font-size:.8rem;padding:.3rem .5rem;border:1px solid var(--color-border);border-radius:6px;background:var(--color-bg)">' +
                      STATUS_ORDER.map(function (s) {
                        return '<option value="' + C.esc(s) + '"' + ((q.status || "ny") === s ? " selected" : "") + '>' + C.esc(STATUS_LABELS[s] || s) + '</option>';
                      }).join("") +
                    '</select>' +
                    '<a href="mailto:' + C.esc(q.email) + '" class="btn btn--ghost btn--sm"><i class="ti ti-mail"></i> Svar</a>' +
                  '</div>' +
                '</li>';
              }).join("") + '</ul>' +
            '</div>';
          }).join("")
      );

    // Statusendring
    root.querySelectorAll("[data-qt-status]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        setLeadStatus(sel.getAttribute("data-qt-status"), sel.value);
        renderList(root);
      });
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  Intranet.registerModule({
    id:       "quote",
    navLabel: "Tilbud",
    icon:     "file-invoice",
    order:    50,
    render:   render,
    mount:    mount
  });

})();
