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
    var fields = [
      infoRow("Namn",    lead.name  || "—"),
      infoRow("E-post",  lead.email || "—"),
      infoRow("Telefon", lead.phone || "—"),
      infoRow("Tid",     formatDate(lead.time || lead.createdAt))
    ];
    if (lead.referenceNumber) fields.push(infoRow("Referanse", "#" + lead.referenceNumber));
    modal.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.2rem;border-bottom:1px solid var(--color-border);position:sticky;top:0;background:var(--color-bg)">' +
        '<strong style="font-size:1rem">' + C.esc(type) + ' — ' + C.esc(lead.name || lead.email || "") + '</strong>' +
        '<button id="lead-detail-close" style="background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);line-height:1;padding:.2rem .4rem">&times;</button>' +
      '</div>' +
      '<div style="padding:1.2rem;display:grid;gap:1rem">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">' + fields.join("") + '</div>' +
        (lead.message ? '<div style="background:var(--color-alt);border-radius:8px;padding:.9rem"><p style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-muted);margin:0 0 .5rem">Melding</p><div style="font-size:.92rem;line-height:1.7;white-space:pre-wrap">' + C.esc((lead.message||"").replace(/<[^>]+>/g,"")) + '</div></div>' : "") +
        '<div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap">' +
          '<label style="font-size:.85rem;font-weight:600">Status:</label>' +
          '<select id="lead-detail-status" style="font-size:.88rem;padding:.4rem .7rem;border:1.5px solid var(--color-border);border-radius:7px;background:var(--color-bg);color:var(--color-text)">' + statusOptions + '</select>' +
          (lead.email ? '<button id="lead-detail-svar-btn" class="btn btn--primary btn--sm"><i class="ti ti-mail-forward"></i> Svar</button>' : '') +
        '</div>' +
      '</div>';
    bd.appendChild(modal);
    document.body.appendChild(bd);
    modal.querySelector("#lead-detail-close").addEventListener("click", function () { bd.remove(); });
    bd.addEventListener("click", function (e) { if (e.target === bd) bd.remove(); });
    document.addEventListener("keydown", function escH(e) { if (e.key === "Escape") { bd.remove(); document.removeEventListener("keydown", escH); } });
    modal.querySelector("#lead-detail-status").addEventListener("change", function () {
      if (typeof onStatusChange === "function") onStatusChange(modal.querySelector("#lead-detail-status").value);
    });
    var svarBtn = modal.querySelector("#lead-detail-svar-btn");
    if (svarBtn) svarBtn.addEventListener("click", function () {
      bd.remove();
      if (!App.openReplyModal) { window.location.href = "mailto:" + lead.email; return; }
      setLeadStatus(lead.id, "løst");
      App.openReplyModal({
        name: lead.name, email: lead.email,
        subject: "Re: Tilbudsforespørsel fra " + (lead.name || ""),
        templateKey: "tilbud",
        defaultTemplate: App.DEFAULT_REPLY_TEMPLATE,
        vars: { navn: lead.name || "", epost: lead.email || "", dato: formatDate(lead.time), referanse: lead.referenceNumber || "" },
        onSent: function (info) {
          if (window.CrmAdmin && window.CrmAdmin.logEmailSent) {
            window.CrmAdmin.logEmailSent({ email: lead.email, name: lead.name, subject: info.subject, plain: info.plain });
          }
        }
      });
    });
  }
  function infoRow(label, value) {
    return '<div style="background:var(--color-surface);border-radius:8px;padding:.6rem .8rem"><p style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-muted);margin:0 0 .15rem">' + C.esc(label) + '</p><p style="font-size:.9rem;margin:0">' + C.esc(value) + '</p></div>';
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

    var activeGroups = groups.filter(function (g) {
      return g.status !== "løst" || g.items.length;
    });

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
                // Bygg forhåndsvisning frå meldinga (strip "Tilbudsforesp..."-prefix og hent jobbeskrivelse)
                var raw = (q.message || "").replace(/^Tilbudsforesp[^\n]*\n?/i, "");
                var preview = raw.replace(/<[^>]+>/g, "")
                  .split("\n").filter(function (ln) { return ln.trim(); })
                  .slice(0, 2).join(" · ").slice(0, 120);

                return '<li class="admin-row" data-quote-open="' + C.esc(q.id) + '" style="cursor:pointer">' +
                  '<div class="admin-row__main">' +
                    '<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">' +
                      '<strong>' + C.esc(q.name || "(ukjent)") + '</strong>' +
                      (q.email ? '<a href="mailto:' + C.esc(q.email) + '" style="color:var(--color-primary);font-size:.88rem">' + C.esc(q.email) + '</a>' : '') +
                      statusBadge(q.status || "ny") +
                      (q.referenceNumber ? '<span style="font-size:.75rem;color:var(--color-muted)">#' + C.esc(String(q.referenceNumber)) + '</span>' : '') +
                    '</div>' +
                    (preview ? '<span class="admin-row__meta">' + C.esc(preview) + (preview.length >= 120 ? "…" : "") + '</span>' : '') +
                    '<span class="admin-row__meta">' + formatDate(q.time || q.createdAt) + '</span>' +
                  '</div>' +
                  '<div class="admin-row__actions" style="flex-direction:column;align-items:flex-end;gap:.3rem">' +
                    (q.email
                      ? '<button class="btn btn--primary btn--sm" data-quote-reply="' + C.esc(q.id) + '"><i class="ti ti-mail-forward"></i> Svar</button>'
                      : '') +
                    '<select data-quote-status="' + C.esc(q.id) + '" style="font-size:.8rem;padding:.3rem .5rem;border:1px solid var(--color-border);border-radius:6px;background:var(--color-bg)">' +
                      STATUS_ORDER.map(function (s) {
                        return '<option value="' + C.esc(s) + '"' + ((q.status || "ny") === s ? " selected" : "") + '>' + C.esc(STATUS_LABELS[s] || s) + '</option>';
                      }).join("") +
                    '</select>' +
                  '</div>' +
                '</li>';
              }).join("") + '</ul>' +
            '</div>';
          }).join("")
      );

    /* Klikk på rad — opne popup */
    root.querySelectorAll("[data-quote-open]").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest("button,select,a")) return;
        var id    = row.getAttribute("data-quote-open");
        var quote = getQuotes().find(function (q) { return q.id === id; });
        if (quote) openLeadDetail(quote, "Tilbud", function (newStatus) {
          setLeadStatus(id, newStatus);
          renderList(root);
        });
      });
    });

    /* Svar-knapp */
    root.querySelectorAll("[data-quote-reply]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id    = btn.getAttribute("data-quote-reply");
        var quote = getQuotes().find(function (q) { return q.id === id; });
        if (!quote) return;
        setLeadStatus(id, "løst");
        if (App.openReplyModal) {
          App.openReplyModal({
            name: quote.name, email: quote.email,
            subject: "Re: Tilbudsforespørsel fra " + (quote.name || ""),
            templateKey: "tilbud",
            defaultTemplate: App.DEFAULT_REPLY_TEMPLATE,
            vars: { navn: quote.name || "", epost: quote.email || "", dato: formatDate(quote.time), referanse: quote.referenceNumber || "" },
            onSent: function (info) {
              if (window.CrmAdmin && window.CrmAdmin.logEmailSent) {
                window.CrmAdmin.logEmailSent({ email: quote.email, name: quote.name, subject: info.subject, plain: info.plain });
              }
            }
          });
        } else {
          window.location.href = "mailto:" + quote.email;
        }
        renderList(root);
      });
    });

    /* Status-nedtrekk */
    root.querySelectorAll("[data-quote-status]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        setLeadStatus(sel.getAttribute("data-quote-status"), sel.value);
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
