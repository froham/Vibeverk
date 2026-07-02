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
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.contact === false) return;

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
     POPUP — vis full henvendingsdetalj
     ====================================================================== */
  function openLeadDetail(lead, type, onStatusChange) {
    var existing = document.getElementById("lead-detail-backdrop");
    if (existing) existing.remove();

    var statusOptions = STATUS_ORDER.map(function (s) {
      return '<option value="' + C.esc(s) + '"' + ((lead.status || "ny") === s ? " selected" : "") + '>' + C.esc(STATUS_LABELS[s] || s) + '</option>';
    }).join("");

    var bd = document.createElement("div");
    bd.id = "lead-detail-backdrop";
    bd.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;display:flex;align-items:center;justify-content:center;padding:1rem";

    var modal = document.createElement("div");
    modal.style.cssText = "background:var(--color-bg);border-radius:var(--radius);width:min(580px,100%);max-height:88vh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.3);display:flex;flex-direction:column";
    modal.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.2rem;border-bottom:1px solid var(--color-border);position:sticky;top:0;background:var(--color-bg);z-index:1">' +
        '<strong style="font-size:1rem">' + C.esc(type) + ' — ' + C.esc(lead.name || lead.email || "") + '</strong>' +
        '<button id="lead-detail-close" style="background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);line-height:1;padding:.2rem .4rem">&times;</button>' +
      '</div>' +
      '<div style="padding:1.2rem;display:grid;gap:1rem">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">' +
          infoRow("Namn",     lead.name     || "—") +
          infoRow("E-post",   lead.email    || "—") +
          infoRow("Telefon",  lead.phone    || "—") +
          infoRow("Tid",      formatDate(lead.time || lead.createdAt)) +
          (lead.referenceNumber ? infoRow("Referanse", "#" + lead.referenceNumber) : "") +
        '</div>' +
        (lead.message
          ? '<div style="background:var(--color-alt);border-radius:8px;padding:.9rem">' +
              '<p style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-muted);margin:0 0 .5rem">Melding</p>' +
              '<div style="font-size:.92rem;line-height:1.7;white-space:pre-wrap;color:var(--color-text)">' + C.esc((lead.message || "").replace(/<[^>]+>/g, "")) + '</div>' +
            '</div>'
          : "") +
        '<div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap">' +
          '<label style="font-size:.85rem;font-weight:600">Status:</label>' +
          '<select id="lead-detail-status" style="font-size:.88rem;padding:.4rem .7rem;border:1.5px solid var(--color-border);border-radius:7px;background:var(--color-bg);color:var(--color-text)">' + statusOptions + '</select>' +
          '<button id="lead-detail-svar-btn" class="btn btn--primary btn--sm"><i class="ti ti-mail-forward"></i> Svar</button>' +
        '</div>' +
      '</div>';

    bd.appendChild(modal);
    document.body.appendChild(bd);

    modal.querySelector("#lead-detail-close").addEventListener("click", function () { bd.remove(); });
    bd.addEventListener("click", function (e) { if (e.target === bd) bd.remove(); });
    document.addEventListener("keydown", function escH(e) {
      if (e.key === "Escape") { bd.remove(); document.removeEventListener("keydown", escH); }
    });

    modal.querySelector("#lead-detail-status").addEventListener("change", function () {
      var newStatus = modal.querySelector("#lead-detail-status").value;
      if (typeof onStatusChange === "function") onStatusChange(newStatus);
    });

    modal.querySelector("#lead-detail-svar-btn").addEventListener("click", function () {
      bd.remove();
      openReply(lead);
    });
  }

  function infoRow(label, value) {
    return '<div style="background:var(--color-surface);border-radius:8px;padding:.6rem .8rem">' +
      '<p style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-muted);margin:0 0 .15rem">' + C.esc(label) + '</p>' +
      '<p style="font-size:.9rem;margin:0;color:var(--color-text)">' + C.esc(value) + '</p>' +
    '</div>';
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
      templateOptions: App.buildTemplateOptions([{ key: "kontakt", label: "Standardmal for kontakt", defaultTemplate: App.DEFAULT_REPLY_TEMPLATE }]),
      vars: {
        navn:      lead.name  || "",
        epost:     lead.email || "",
        dato:      formatDate(lead.time),
        melding:   (lead.message || "").replace(/<[^>]+>/g, ""),
        referanse: lead.referenceNumber || ""
      },
      previewHtml: lead.message
        ? '<div style="font-size:.88rem;color:var(--color-muted);white-space:pre-wrap">' + C.esc(lead.message) + '</div>'
        : "",
      onSent: function (info) {
        if (window.CrmAdmin && window.CrmAdmin.logEmailSent) {
          window.CrmAdmin.logEmailSent({ email: lead.email, name: lead.name, subject: info.subject, plain: info.plain });
        }
      }
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
                return '<li class="admin-row" data-lead-open="' + C.esc(l.id) + '" style="cursor:pointer">' +
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

    /* Klikk på rad — opne popup */
    root.querySelectorAll("[data-lead-open]").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest("button,select,a")) return;
        var id   = row.getAttribute("data-lead-open");
        var lead = (App.getLeads ? App.getLeads() : []).find(function (l) { return l.id === id; });
        if (lead) openLeadDetail(lead, "Kontakt", function (newStatus) {
          setStatus(id, newStatus);
          renderList(root);
        });
      });
    });

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
