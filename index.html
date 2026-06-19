/* =============================================================================
   module-crm.js  —  KUNDER / CRM (intranett)
   -----------------------------------------------------------------------------
   Intern visning av eksisterende CRM-data. Leser de samme Store-nøklene som
   offentlig side skriver til — ingen ny datastruktur, ingen synkronisering.

   Datakilder (alle via App.store / App.getLeads):
   - crm-customers     → kundeliste
   - crm-bedrifter     → bedriftsoversikt
   - leads (getLeads)  → kontaktskjema + tilbudsforespørsler
   - booking-bookings  → bookinghistorikk

   Slås av/på med config.intranettFeatures.crm (via superadmin).
   Ruter: #/crm, #/crm/<id>
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.crm === false) return;

  /* =========================================================================
     DATAHJELPERE (leser offentlig side sine nøkler)
     ====================================================================== */
  function getCustomers() { return App.store.get("crm-customers", []) || []; }
  function getBedrifter() { return App.store.get("crm-bedrifter", []) || []; }

  function getHistoryForEmail(email) {
    if (!email) return [];
    var items = [];
    var leads = App.getLeads ? App.getLeads() : [];
    leads.forEach(function (l) {
      if ((l.email || "").toLowerCase() === email.toLowerCase()) {
        items.push({
          type:   l.message && l.message.indexOf("Tilbudsforesp") === 0 ? "Tilbud" : "Kontakt",
          label:  l.name || l.email,
          status: l.status || "ny",
          ts:     l.time || 0,
          leadId: l.id,
          email:  l.email,
          name:   l.name,
          preview: (l.message || "").replace(/<[^>]+>/g, "").slice(0, 200)
        });
      }
    });
    var bookings = App.store.get("booking-bookings", []) || [];
    var assets   = App.store.get("booking-assets",   []) || [];
    bookings.forEach(function (b) {
      if ((b.email || "").toLowerCase() === email.toLowerCase()) {
        var asset = assets.find(function (a) { return a.id === b.assetId; });
        items.push({
          type:   "Booking",
          label:  (asset ? asset.name + " — " : "") + (b.date || ""),
          status: b.status || "ny",
          ts:     b.createdAt || 0
        });
      }
    });
    return items.sort(function (a, b) { return b.ts - a.ts; });
  }

  /* =========================================================================
     HJELPERE
     ====================================================================== */
  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
  }

  function statusBadge(status) {
    var map = { ny: "#6A6A73", lest: "var(--color-secondary)", løst: "#2a7a2a" };
    var color = map[status] || "#6A6A73";
    return '<span style="display:inline-block;font-size:.7rem;font-weight:700;padding:.15rem .5rem;border-radius:999px;background:' + color + '22;color:' + color + ';text-transform:uppercase">' + C.esc(status || "ny") + '</span>';
  }

  function openReply(lead) {
    if (!App.openReplyModal) return;
    if (App.setLeadStatus) App.setLeadStatus(lead.id, "løst");
    App.openReplyModal({
      name:            lead.name,
      email:           lead.email || lead.label,
      subject:         "Re: " + (lead.type || "Henvendelse") + " fra " + (lead.name || ""),
      templateKey:     "kontakt",
      defaultTemplate: App.DEFAULT_REPLY_TEMPLATE,
      vars: {
        navn:      lead.name  || "",
        epost:     lead.email || lead.label || "",
        dato:      formatDate(lead.ts),
        melding:   lead.preview || "",
        referanse: lead.referenceNumber || ""
      }
    });
  }

  /* =========================================================================
     RENDER — LISTE
     ====================================================================== */
  function render() { return '<div id="crm-root"></div>'; }

  function mount(outlet, ctx, sub) {
    var root = outlet.querySelector("#crm-root") || outlet;
    if (sub) {
      renderDetail(root, sub);
    } else {
      renderList(root);
    }
  }

  function renderList(root) {
    var customers = getCustomers();
    var bedrifter = getBedrifter();

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Kunder <span style="font-size:1rem;font-weight:400;color:var(--color-muted)">(' + customers.length + ')</span></h2>' +
      '</div>' +
      (customers.length === 0
        ? '<p style="color:var(--color-muted);font-size:.9rem">Ingen kunder ennå. De kommer automatisk fra innsendte skjema og bookinger på nettsiden.</p>'
        : '<ul class="admin-list">' + customers.map(function (c) {
            var bed = c.bedriftId && bedrifter.find(function (b) { return b.id === c.bedriftId; });
            var history = getHistoryForEmail(c.email);
            var openCount = history.filter(function (h) { return h.status !== "løst"; }).length;
            return '<li class="admin-row">' +
              '<div class="admin-row__main">' +
                '<strong>' + C.esc(c.name || c.email) + '</strong>' +
                '<span class="admin-row__meta">' + C.esc(c.email) +
                  (bed ? ' · ' + C.esc(bed.name) : "") + '</span>' +
                (c.note ? '<span class="admin-row__meta">' + C.esc(c.note.slice(0, 60)) + (c.note.length > 60 ? "…" : "") + '</span>' : "") +
              '</div>' +
              '<div class="admin-row__actions" style="align-items:center">' +
                (openCount > 0 ? '<span class="i-badge i-badge--progress" style="margin-right:.3rem">' + openCount + ' åpen</span>' : "") +
                '<a href="#/crm/' + C.esc(c.id) + '" class="btn btn--ghost btn--sm">Se historikk</a>' +
              '</div>' +
            '</li>';
          }).join("") + '</ul>'
      );
  }

  /* =========================================================================
     RENDER — DETALJ
     ====================================================================== */
  function renderDetail(root, id) {
    var customers = getCustomers();
    var bedrifter = getBedrifter();
    var c = customers.find(function (x) { return x.id === id; });
    if (!c) {
      root.innerHTML = '<p style="color:var(--color-muted)">Kunde ikke funnet.</p>';
      return;
    }
    var bed     = c.bedriftId && bedrifter.find(function (b) { return b.id === c.bedriftId; });
    var history = getHistoryForEmail(c.email);

    root.innerHTML =
      '<div class="i-page-head">' +
        '<button class="i-topbar__back" id="crm-back"><i class="ti ti-arrow-left"></i> Alle kunder</button>' +
      '</div>' +

      '<div class="i-card" style="margin-bottom:1rem">' +
        '<p class="i-section-label">Kundeinformasjon</p>' +
        '<div style="display:grid;gap:.4rem">' +
          '<div><strong>' + C.esc(c.name || "(ukjent navn)") + '</strong></div>' +
          '<div><a href="mailto:' + C.esc(c.email) + '" style="color:var(--color-primary)">' + C.esc(c.email) + '</a></div>' +
          (bed ? '<div style="color:var(--color-muted);font-size:.88rem">' + C.esc(bed.name) + ' #' + C.esc(String(bed.customerNumber || "")) + '</div>' : '') +
          (c.note ? '<div style="margin-top:.4rem;padding-top:.4rem;border-top:1px solid var(--color-border);font-size:.88rem;color:var(--color-muted)">' + C.esc(c.note) + '</div>' : '') +
        '</div>' +
      '</div>' +

      '<div class="i-card">' +
        '<p class="i-section-label">Historikk (' + history.length + ')</p>' +
        (history.length === 0
          ? '<p style="color:var(--color-muted);font-size:.88rem">Ingen registrerte henvendelser.</p>'
          : '<ul style="list-style:none;padding:0;margin:0;display:grid;gap:.5rem">' +
              history.map(function (h) {
                var canReply = h.leadId && (h.type === "Kontakt" || h.type === "Tilbud");
                return '<li style="display:flex;align-items:center;gap:.65rem;padding:.5rem 0;border-bottom:1px solid var(--color-border)">' +
                  '<span style="font-size:.78rem;font-weight:700;color:var(--color-muted);min-width:60px">' + C.esc(h.type) + '</span>' +
                  '<span style="flex:1;font-size:.88rem">' + C.esc(h.label) + '</span>' +
                  statusBadge(h.status) +
                  '<span style="font-size:.75rem;color:var(--color-muted)">' + formatDate(h.ts) + '</span>' +
                  (canReply
                    ? '<button class="btn btn--ghost btn--sm" data-crm-reply="' + C.esc(h.leadId) + '" style="padding:.3rem .6rem;font-size:.78rem"><i class="ti ti-mail-forward"></i></button>'
                    : '') +
                '</li>';
              }).join("") +
            '</ul>'
        ) +
      '</div>';

    root.querySelector("#crm-back").addEventListener("click", function () {
      Intranet.navigate("crm");
    });

    root.querySelectorAll("[data-crm-reply]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var leadId = btn.getAttribute("data-crm-reply");
        var allLeads = App.getLeads ? App.getLeads() : [];
        var lead = allLeads.find(function (l) { return l.id === leadId; });
        if (lead) {
          openReply({
            id: lead.id, name: lead.name, email: lead.email,
            type: lead.message && lead.message.indexOf("Tilbudsforesp") === 0 ? "Tilbud" : "Kontakt",
            ts: lead.time, preview: (lead.message || "").replace(/<[^>]+>/g, "")
          });
          renderDetail(root, id);
        }
      });
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  Intranet.registerModule({
    id:       "crm",
    navLabel: "Kunder",
    icon:     "users",
    order:    30,
    render:   render,
    mount:    mount
  });

})();
