/* =============================================================================
   module-contact.js  —  KONTAKTHENVENDELSER (intranett)
   -----------------------------------------------------------------------------
   Intern visning av kontaktskjema-henvendelser. Leser leads frå App.getLeads()
   og filtrerer bort tilbudsforespørsler (som ligg i module-quote.js).

   Funksjonar:
   - Liste over henvendingar gruppert etter status
   - Svar med e-postmal via App.openReplyModal (same infrastruktur som admin)
   - Statusendring (Ny / Lest / Løst)
   - Aktivitetslogging

   Lagring:  App.getLeads() / App.setLeadStatus() — same som admin
   Ruter:    #/contact
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  if (!Intranet || !App || !C) return;

  /* =========================================================================
     DATA
     ====================================================================== */
  function getContacts() {
    var leads = App.getLeads ? App.getLeads() : [];
    return leads.filter(function (l) {
      return !l.message || l.message.indexOf("Tilbudsforesp") !== 0;
    });
  }

  function setStatus(id, status) {
    if (App.setLeadStatus) {
      App.setLeadStatus(id, status);
      Intranet.logActivity({ type: "contact_status", label: "Henvendelse → " + status });
    }
  }

  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("nb-NO", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }

  /* =========================================================================
     STATUS
     ====================================================================== */
  var STATUS_LABELS = App.STATUS_LABELS || { ny: "Ny", lest: "Lest", løst: "Løst" };
  var STATUS_ORDER  = App.STATUS_ORDER  || ["ny", "lest", "løst"];

  function statusBadge(status) {
    var map = { ny: "#6A6A73", lest: "var(--color-secondary)", løst: "#2a7a2a" };
    var color = map[status] || "#6A6A73";
    return '<span style="display:inline-block;font-size:.7rem;font-weight:700;padding:.15rem .5rem;' +
      'border-radius:999px;background:' + color + '22;color:' + color + ';text-transform:uppercase">' +
      C.esc(STATUS_LABELS[status] || status) + '</span>';
  }

  /* =========================================================================
     SVAR MED MAL
     ====================================================================== */
  function openReply(lead) {
    if (!App.openReplyModal) return;
    setStatus(lead.id, "løst");
    App.openReplyModal({
      name:            lead.name,
      email:           lead.email,
      subject:         "Re: Henvendelse fra " + (lead.name || ""),
      templateKey:     "kontakt",
      defaultTemplate: App.DEFAULT_REPLY_TEMPLATE,
      vars: {
        navn:      lead.name  || "",
        epost:     lead.email || "",
        dato:      formatDate(lead.time),
        melding:   (lead.message || "").replace(/<[^>]+>/g, ""),
        referanse: lead.referenceNumber || ""
      },
      previewHtml: lead.message
        ? '<div style="font-size:.88rem;color:var(--color-muted);white-space:pre-wrap">' + C.esc(lead.message) + '</div>'
        : ""
    });
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  function render() { return '<div id="contact-root"></div>'; }

  function mount(outlet) {
    var root = outlet.querySelector("#contact-root") || outlet;
    renderList(root);
  }

  function renderList(root) {
    var contacts = getContacts();

    var groups = [
      { status: "ny",   label: "Nye",  items: [] },
      { status: "lest", label: "Lest", items: [] },
      { status: "løst", label: "Løst", items: [] }
    ];
    contacts.forEach(function (l) {
      var g = groups.find(function (g) { return g.status === (l.status || "ny"); });
      if (g) g.items.push(l);
    });

    var activeGroups = groups.filter(function (g) {
      return g.status !== "løst" || g.items.length;
    });

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Kontakt <span style="font-size:1rem;font-weight:400;color:var(--color-muted)">(' + contacts.length + ')</span></h2>' +
      '</div>' +
      (contacts.length === 0
        ? '<p style="color:var(--color-muted);font-size:.9rem">Ingen kontakthenvendelser ennå.</p>'
        : activeGroups.map(function (g) {
            if (!g.items.length) return "";
            return '<div style="margin-bottom:1.2rem">' +
              '<p class="i-section-label">' + C.esc(g.label) + ' (' + g.items.length + ')</p>' +
              '<ul class="admin-list">' + g.items.map(function (l) {
                var preview = (l.message || "")
                  .replace(/<[^>]+>/g, "")
                  .split("\n").filter(function (ln) { return ln.trim(); })
                  .slice(0, 2).join(" · ").slice(0, 120);
                return '<li class="admin-row">' +
                  '<div class="admin-row__main">' +
                    '<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">' +
                      '<strong>' + C.esc(l.name || "(ukjent)") + '</strong>' +
                      '<a href="mailto:' + C.esc(l.email) + '" style="color:var(--color-primary);font-size:.88rem">' + C.esc(l.email) + '</a>' +
                      statusBadge(l.status || "ny") +
                      (l.referenceNumber ? '<span style="font-size:.75rem;color:var(--color-muted)">#' + C.esc(String(l.referenceNumber)) + '</span>' : "") +
                    '</div>' +
                    (preview ? '<span class="admin-row__meta">' + C.esc(preview) + (preview.length >= 120 ? "…" : "") + '</span>' : "") +
                    '<span class="admin-row__meta">' + formatDate(l.time) + '</span>' +
                  '</div>' +
                  '<div class="admin-row__actions" style="flex-direction:column;align-items:flex-end;gap:.3rem">' +
                    '<button class="btn btn--primary btn--sm" data-contact-reply="' + C.esc(l.id) + '">' +
                      '<i class="ti ti-mail-forward"></i> Svar' +
                    '</button>' +
                    '<select data-contact-status="' + C.esc(l.id) + '" style="font-size:.8rem;padding:.3rem .5rem;border:1px solid var(--color-border);border-radius:6px;background:var(--color-bg)">' +
                      STATUS_ORDER.map(function (s) {
                        return '<option value="' + C.esc(s) + '"' + ((l.status || "ny") === s ? " selected" : "") + '>' +
                          C.esc(STATUS_LABELS[s] || s) + '</option>';
                      }).join("") +
                    '</select>' +
                  '</div>' +
                '</li>';
              }).join("") + '</ul>' +
            '</div>';
          }).join("")
      );

    /* Bind svar-knapper */
    root.querySelectorAll("[data-contact-reply]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id   = btn.getAttribute("data-contact-reply");
        var lead = (App.getLeads ? App.getLeads() : []).find(function (l) { return l.id === id; });
        if (lead) { openReply(lead); renderList(root); }
      });
    });

    /* Bind statusvalg */
    root.querySelectorAll("[data-contact-status]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        setStatus(sel.getAttribute("data-contact-status"), sel.value);
        renderList(root);
      });
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  Intranet.registerModule({
    id:       "contact",
    navLabel: "Kontakt",
    icon:     "mail",
    order:    35,
    render:   render,
    mount:    mount
  });

})();
