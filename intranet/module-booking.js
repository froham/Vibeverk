/* =============================================================================
   module-booking.js  —  BOOKING (intranett)
   -----------------------------------------------------------------------------
   Intern behandling av bookingforespørsler. Leser booking-bookings og
   booking-assets fra App.store — samme data som admin på offentlig side.

   Slås av/på med config.intranettFeatures.booking.
   Ruter: #/booking
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.booking === false) return;

  /* =========================================================================
     DATA
     ====================================================================== */
  function getBookings() { return App.store.get("booking-bookings", []) || []; }
  function getAssets()   { return App.store.get("booking-assets",   []) || []; }

  function setBookings(v) { App.store.set("booking-bookings", v); }

  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
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

  function updateStatus(id, newStatus) {
    var list = getBookings();
    var idx  = list.findIndex(function (b) { return b.id === id; });
    if (idx < 0) return;
    list[idx].status = newStatus;
    setBookings(list);
    Intranet.logActivity({ type: "booking_status", label: "Booking → " + (STATUS_LABELS[newStatus] || newStatus) });
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  function render() { return '<div id="booking-root"></div>'; }

  function mount(outlet) {
    var root = outlet.querySelector("#booking-root") || outlet;
    renderList(root);
  }

  function renderList(root) {
    var bookings = getBookings();
    var assets   = getAssets();

    // Grupper etter status
    var groups = [
      { status: "ny",   label: "Nye",    items: [] },
      { status: "lest", label: "Lest",   items: [] },
      { status: "løst", label: "Løst",   items: [] }
    ];
    bookings.forEach(function (b) {
      var g = groups.find(function (g) { return g.status === (b.status || "ny"); });
      if (g) g.items.push(b);
    });

    var activeGroups = groups.filter(function (g) { return g.status !== "løst" || g.items.length; });

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Booking <span style="font-size:1rem;font-weight:400;color:var(--color-muted)">(' + bookings.length + ')</span></h2>' +
      '</div>' +
      (bookings.length === 0
        ? '<p style="color:var(--color-muted);font-size:.9rem">Ingen bookingforespørsler ennå.</p>'
        : activeGroups.map(function (g) {
            if (!g.items.length) return "";
            return '<div style="margin-bottom:1.2rem">' +
              '<p class="i-section-label">' + C.esc(g.label) + ' (' + g.items.length + ')</p>' +
              '<ul class="admin-list">' + g.items.map(function (b) {
                var asset = assets.find(function (a) { return a.id === b.assetId; });
                return '<li class="admin-row">' +
                  '<div class="admin-row__main">' +
                    '<strong>' + C.esc(b.name || "(ukjent)") + '</strong>' +
                    '<span class="admin-row__meta">' +
                      C.esc(b.email || "") +
                      (asset ? ' · ' + C.esc(asset.name) : "") +
                      (b.date ? ' · ' + C.esc(b.date) : "") +
                    '</span>' +
                    (b.message ? '<span class="admin-row__meta">' + C.esc(b.message.slice(0, 80)) + (b.message.length > 80 ? "…" : "") + '</span>' : "") +
                    '<span class="admin-row__meta">' + formatDate(b.createdAt) + '</span>' +
                  '</div>' +
                  '<div class="admin-row__actions" style="flex-direction:column;align-items:flex-end;gap:.3rem">' +
                    statusBadge(b.status || "ny") +
                    '<select class="i-field select" data-bk-status="' + C.esc(b.id) + '" style="font-size:.8rem;padding:.3rem .5rem;border:1px solid var(--color-border);border-radius:6px;background:var(--color-bg)">' +
                      STATUS_ORDER.map(function (s) {
                        return '<option value="' + C.esc(s) + '"' + ((b.status || "ny") === s ? " selected" : "") + '>' + C.esc(STATUS_LABELS[s] || s) + '</option>';
                      }).join("") +
                    '</select>' +
                  '</div>' +
                '</li>';
              }).join("") + '</ul>' +
            '</div>';
          }).join("")
      );

    // Statusendring
    root.querySelectorAll("[data-bk-status]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        updateStatus(sel.getAttribute("data-bk-status"), sel.value);
        renderList(root);
      });
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  Intranet.registerModule({
    id:       "booking",
    navLabel: "Booking",
    icon:     "calendar",
    order:    40,
    render:   render,
    mount:    mount
  });

})();
