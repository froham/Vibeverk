/* =============================================================================
   module-dashboard.js  —  DASHBOARD (intranett)
   -----------------------------------------------------------------------------
   Aggregator-stub for steg 1. Viser:
   - Aktivitetsstrøm fra wsp-activity (Tasks, Settings)
   - Hurtighandlinger til aktive moduler
   - Oversiktstall (antall oppgaver per status)

   Er bevisst enkel — Dashboard fyller seg naturlig når flere moduler legges til.
   Lagring:  leser App.store — skriver ingenting selv.
   Ruter:    #/dashboard (standard)
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  if (!Intranet || !App || !C) return;

  /* =========================================================================
     HJELPERE
     ====================================================================== */
  function formatTs(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    var now = new Date();
    var diff = Math.round((now - d) / 60000); // minutter
    if (diff < 1)  return "akkurat nå";
    if (diff < 60) return diff + " min siden";
    var h = Math.round(diff / 60);
    if (h < 24) return h + " t siden";
    return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
  }

  var ACT_ICONS = {
    task_created: "circle-plus",
    task_updated: "pencil",
    task_deleted: "trash",
    task_status:  "circle-check",
    settings:     "settings"
  };

  /* =========================================================================
     RENDER
     ====================================================================== */
  function render() {
    return '<div id="dashboard-root"></div>';
  }

  function mount(outlet) {
    var root = outlet.querySelector("#dashboard-root") || outlet;
    renderDashboard(root);
  }

  function renderDashboard(root) {
    var tasks    = App.store.get("wsp-tasks", []) || [];
    var activity = Intranet.getActivity();

    // Telledata
    var counts = { todo: 0, in_progress: 0, done: 0 };
    tasks.forEach(function (t) { if (counts[t.status] !== undefined) counts[t.status]++; });

    // Tel opp uleste henvendelser frå alle kjelder
    var allLeads = App.getLeads ? App.getLeads() : [];
    var contactNew = allLeads.filter(function (l) {
      return (!l.message || l.message.indexOf("Tilbudsforesp") !== 0) && (l.status || "ny") === "ny";
    }).length;
    var quoteNew = allLeads.filter(function (l) {
      return l.message && l.message.indexOf("Tilbudsforesp") === 0 && (l.status || "ny") === "ny";
    }).length;
    var bookingNew = (App.store.get("booking-bookings", []) || []).filter(function (b) {
      return (b.status || "ny") === "ny";
    }).length;
    var totalNew = contactNew + quoteNew + bookingNew;

    function henvendelseChip(label, count, href) {
      var hasNew = count > 0;
      var style = hasNew
        ? "background:color-mix(in srgb,var(--color-primary) 12%,transparent);color:var(--color-primary);border-color:var(--color-primary)"
        : "background:var(--color-surface);color:var(--color-muted)";
      return '<a href="' + href + '" style="display:inline-flex;align-items:center;gap:.4rem;padding:.35rem .75rem;border-radius:999px;border:1.5px solid var(--color-border);font-size:.82rem;font-weight:600;text-decoration:none;' + style + '">' +
        C.esc(label) + (hasNew ? ' <span style="background:var(--color-primary);color:#fff;border-radius:999px;padding:.05rem .4rem;font-size:.72rem">' + count + '</span>' : '') +
      '</a>';
    }

    root.innerHTML =
      '<div class="i-page-head"><h2>Dashboard</h2></div>' +

      /* --- Henvendelsesrad ------------------------------------------------ */
      '<div class="i-card" style="margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">' +
        '<span style="font-size:.82rem;font-weight:600;color:var(--color-muted);text-transform:uppercase;letter-spacing:.08em">Henvendelser</span>' +
        '<div style="display:flex;gap:.4rem;flex-wrap:wrap">' +
          henvendelseChip("Kontakt", contactNew, "#/contact") +
          henvendelseChip("Tilbud",  quoteNew,   "#/quote") +
          henvendelseChip("Booking", bookingNew, "#/booking") +
        '</div>' +
        (totalNew > 0
          ? '<span style="font-size:.82rem;color:var(--color-primary);font-weight:600">' + totalNew + ' nye</span>'
          : '<span style="font-size:.82rem;color:var(--color-muted)">Ingen nye</span>'
        ) +
      '</div>' +

      /* --- Oversiktstall -------------------------------------------------- */
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.6rem;margin-bottom:1.4rem;align-items:stretch">' +
        statCard("Å gjøre",  counts.todo,        "#/tasks", "ti-checklist") +
        statCard("Pågår",    counts.in_progress,  "#/tasks", "ti-loader") +
        statCard("Ferdig",   counts.done,          "#/tasks", "ti-circle-check") +
      '</div>' +

      /* --- Hurtighandlinger ----------------------------------------------- */
      '<div class="i-card" style="margin-bottom:1rem">' +
        '<p class="i-section-label">Hurtighandlinger</p>' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
          '<a href="#/tasks" class="btn btn--ghost btn--sm"><i class="ti ti-plus"></i> Ny oppgave</a>' +
          '<a href="#/settings" class="btn btn--ghost btn--sm"><i class="ti ti-settings"></i> Innstillinger</a>' +
        '</div>' +
      '</div>' +

      /* --- Aktivitetsstrøm ----------------------------------------------- */
      '<div class="i-card">' +
        '<p class="i-section-label">Siste aktivitet</p>' +
        (activity.length
          ? '<ul class="admin-list">' + activity.slice(0, 15).map(function (a) {
              var icon = ACT_ICONS[a.type] || "point";
              return '<li style="display:flex;align-items:center;gap:.65rem;padding:.55rem 0;border-bottom:1px solid var(--color-border)">' +
                '<i class="ti ti-' + C.esc(icon) + '" style="color:var(--color-primary);font-size:1rem;flex-shrink:0"></i>' +
                '<span style="flex:1;font-size:.88rem">' + C.esc(a.label) + '</span>' +
                '<span style="font-size:.78rem;color:var(--color-muted);flex-shrink:0">' + formatTs(a.ts) + '</span>' +
              '</li>';
            }).join("") + '</ul>'
          : '<p style="color:var(--color-muted);font-size:.88rem">Ingen aktivitet ennå. Start med å legge til en oppgave.</p>'
        ) +
      '</div>';
  }

  function statCard(label, count, href, iconClass) {
    return '<a href="' + href + '" class="i-card" style="text-decoration:none;display:flex;flex-direction:column;gap:.3rem;align-self:stretch">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<span style="font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--color-muted)">' + C.esc(label) + '</span>' +
        '<i class="ti ' + C.esc(iconClass) + '" style="color:var(--color-muted);font-size:1rem"></i>' +
      '</div>' +
      '<span style="font-size:1.8rem;font-weight:700;font-family:var(--font-display);color:var(--color-text)">' + count + '</span>' +
    '</a>';
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  Intranet.registerModule({
    id:       "dashboard",
    navLabel: "Dashboard",
    icon:     "layout-dashboard",
    order:    10,
    render:   render,
    mount:    mount
  });

})();
