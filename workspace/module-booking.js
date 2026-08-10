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
  if (!Intranet || !App || !C) return;

  App.ready(function (CFG) {
  if (CFG.intranettFeatures && CFG.intranettFeatures.booking === false) return;

  /* =========================================================================
     DATA — bookingar flytta ut av store til ein eigen bookings-tabell
     2026-07-03 (siste av dei tre private datasetta, sjå crm_customers/leads
     — fullfører CRITICAL-funnet). Denne fila er HEILT UAVHENGIG av rot-fila
     sin module-booking.js (to separate filer som begge las/skreiv same
     store-nøkkel før — no same tabell, kvar med sin eigen lokale cache, sidan
     Web-admin og Workspace aldri er lasta samstundes i same fane). Same
     _sb-berre-sjekk (ikkje auth-sjekk) som module-crm.js/root-fila, sidan
     modulen her uansett berre er nåbar for innlogga Workspace-brukarar.
     ====================================================================== */
  var _sb = App.supabase;
  var _bookings = [];

  function dbBookingToJs(row) {
    return { id: row.id, assetId: row.asset_id, date: row.date, time: row.time,
      name: row.name || "", email: row.email || "", phone: row.phone || "", message: row.message || "",
      instant: !!row.instant, status: row.status || "ny", referenceNumber: row.reference_number,
      createdAt: row.created_at };
  }
  function jsBookingToDb(b) {
    return { asset_id: b.assetId, date: b.date, time: b.time, name: b.name || "", email: b.email || "",
      phone: b.phone || "", message: b.message || "", instant: !!b.instant, status: b.status || "ny",
      reference_number: b.referenceNumber || null };
  }

  function loadBookings(cb) {
    if (!_sb) { _bookings = App.store.get("booking-bookings", []) || []; cb && cb(); return; }
    _sb.from("bookings").select("*").order("created_at", { ascending: false }).then(function (r) {
      _bookings = (r.data || []).map(dbBookingToJs);
      cb && cb();
    });
  }

  function getBookings() {
    if (!_sb) return App.store.get("booking-bookings", []) || [];
    return _bookings;
  }
  function getAssets() { return App.store.get("booking-assets", []) || []; }

  function updateBooking(id, patch) {
    if (!_sb) {
      var list = App.store.get("booking-bookings", []) || [];
      var bk = list.find(function (x) { return x.id === id; });
      if (bk) { Object.assign(bk, patch); App.store.set("booking-bookings", list); }
      return;
    }
    var cached = _bookings.find(function (x) { return x.id === id; });
    if (cached) Object.assign(cached, patch);
    _sb.from("bookings").update(jsBookingToDb(cached || patch)).eq("id", id).then(function () {});
  }

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
    if (!getBookings().some(function (b) { return b.id === id; })) return;
    updateBooking(id, { status: newStatus });
    Intranet.logActivity({ type: "booking_status", label: "Booking → " + (STATUS_LABELS[newStatus] || newStatus) });
  }


  /* =========================================================================
     POPUP — vis full henvendingsdetalj
     ====================================================================== */
  // Migrert 2026-08-10 til det delte Intranet.openModal() (Fase 4, sjå
  // docs/project/CHANGELOG.md) -- nesten identisk kopi av same funksjon i
  // module-contact.js/module-quote.js, migrert samla same fase.
  function openLeadDetail(lead, type, onStatusChange) {
    var statusOptions = STATUS_ORDER.map(function (s) {
      return '<option value="' + C.esc(s) + '"' + ((lead.status || "ny") === s ? " selected" : "") + '>' + C.esc(STATUS_LABELS[s] || s) + '</option>';
    }).join("");
    var fields = [
      infoRow("Namn",    lead.name  || "—"),
      infoRow("E-post",  lead.email || "—"),
      infoRow("Telefon", lead.phone || "—"),
      infoRow("Tid",     formatDate(lead.time || lead.createdAt))
    ];
    if (lead.referenceNumber) fields.push(infoRow("Referanse", "#" + lead.referenceNumber));
    var bodyHtml =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">' + fields.join("") + '</div>' +
      (lead.message ? '<div style="background:var(--color-alt);border-radius:8px;padding:.9rem"><p style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-muted);margin:0 0 .5rem">Melding</p><div style="font-size:.92rem;line-height:1.7;white-space:pre-wrap">' + C.esc((lead.message||"").replace(/<[^>]+>/g,"")) + '</div></div>' : "") +
      '<div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap">' +
        '<label style="font-size:.85rem;font-weight:600">Status:</label>' +
        '<select id="lead-detail-status" style="font-size:.88rem;padding:.4rem .7rem;border:1.5px solid var(--color-border);border-radius:7px;background:var(--color-bg);color:var(--color-text)">' + statusOptions + '</select>' +
        '<button id="lead-detail-avbook-btn" class="btn btn--ghost btn--sm"><i class="ti ti-calendar-x"></i> Avbook</button>' +
        '<button id="lead-detail-svar-btn" class="btn btn--primary btn--sm"><i class="ti ti-mail-forward"></i> Svar</button>' +
      '</div>';

    Intranet.openModal({
      title: type + " — " + (lead.name || lead.email || ""),
      bodyHtml: bodyHtml,
      size: "md",
      rootId: "lead-detail-backdrop",
      onMount: function (modal) {
        modal.querySelector("#lead-detail-status").addEventListener("change", function () {
          if (typeof onStatusChange === "function") onStatusChange(modal.querySelector("#lead-detail-status").value);
        });
        modal.querySelector("#lead-detail-avbook-btn").addEventListener("click", function () {
          Intranet.closeModal();
          if (!App.openReplyModal) { window.location.href = "mailto:" + lead.email; return; }
          var asset = getAssets().find(function (a) { return a.id === lead.assetId; });
          updateStatus(lead.id, "løst");
          App.openReplyModal({
            name: lead.name, email: lead.email,
            subject: "Avbooking – " + (asset ? asset.name : "") + " " + formatDate(lead.date) + (lead.time ? " kl. " + lead.time : "") + (lead.referenceNumber ? " (#" + lead.referenceNumber + ")" : ""),
            templateKey: "booking-avbook",
            defaultTemplate: DEFAULT_AVBOOK_TEMPLATE,
            templateOptions: App.buildTemplateOptions([
              { key: "booking-avbook", label: "Avbookingsmal", defaultTemplate: DEFAULT_AVBOOK_TEMPLATE },
              { key: "booking-svar", label: "Svarmal", defaultTemplate: DEFAULT_SVAR_TEMPLATE }
            ]),
            signatureOptions: App.buildSignatureOptions(),
            vars: { navn: lead.name || "", epost: lead.email || "", dato: lead.date || "", klokkeslett: lead.time || "", ressurs: asset ? asset.name : "", referanse: lead.referenceNumber || "" },
            onSent: function (info) {
              if (window.CrmAdmin && window.CrmAdmin.logEmailSent) {
                window.CrmAdmin.logEmailSent({ email: lead.email, name: lead.name, subject: info.subject, plain: info.plain });
              }
            }
          });
        });
        modal.querySelector("#lead-detail-svar-btn").addEventListener("click", function () {
          Intranet.closeModal();
          if (!App.openReplyModal) { window.location.href = "mailto:" + lead.email; return; }
          var asset = getAssets().find(function (a) { return a.id === lead.assetId; });
          updateStatus(lead.id, "løst");
          App.openReplyModal({
            name: lead.name, email: lead.email,
            subject: "Re: Bookingforespørsel fra " + (lead.name || ""),
            templateKey: "booking-svar",
            defaultTemplate: DEFAULT_SVAR_TEMPLATE,
            templateOptions: App.buildTemplateOptions([
              { key: "booking-avbook", label: "Avbookingsmal", defaultTemplate: DEFAULT_AVBOOK_TEMPLATE },
              { key: "booking-svar", label: "Svarmal", defaultTemplate: DEFAULT_SVAR_TEMPLATE }
            ]),
            signatureOptions: App.buildSignatureOptions(),
            vars: { navn: lead.name || "", epost: lead.email || "", dato: lead.date || "", klokkeslett: lead.time || "", ressurs: asset ? asset.name : "", referanse: lead.referenceNumber || "" },
            onSent: function (info) {
              if (window.CrmAdmin && window.CrmAdmin.logEmailSent) {
                window.CrmAdmin.logEmailSent({ email: lead.email, name: lead.name, subject: info.subject, plain: info.plain });
              }
            }
          });
        });
      }
    });
  }
  function infoRow(label, value) {
    return '<div style="background:var(--color-surface);border-radius:8px;padding:.6rem .8rem"><p style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-muted);margin:0 0 .15rem">' + C.esc(label) + '</p><p style="font-size:.9rem;margin:0">' + C.esc(value) + '</p></div>';
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  var DEFAULT_AVBOOK_TEMPLATE = "Hei {navn},\n\nDin booking (referanse #{referanse}) for {ressurs} den {dato} kl. {klokkeslett} er dessverre avbooket.\n\nTa kontakt om du har spørsmål.\n\nMed vennlig hilsen";
  var DEFAULT_SVAR_TEMPLATE   = "Hei {navn},\n\nDette gjelder din booking (referanse #{referanse}) — {ressurs}, {dato} kl. {klokkeslett}.\n\n";

  function render() { return '<div id="booking-root"></div>'; }

  var _activeFane = "bookingar";

  function mount(outlet) {
    var root = outlet.querySelector("#booking-root") || outlet;
    renderPage(root);
  }

  function renderPage(root) {
    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Booking</h2>' +
      '</div>' +
      '<div style="display:flex;gap:.35rem;margin-bottom:1.2rem;border-bottom:1px solid var(--color-border);padding-bottom:.75rem">' +
        '<button class="btn btn--' + (_activeFane === "bookingar" ? "primary" : "ghost") + ' btn--sm" data-bk-fane="bookingar">Bookingar</button>' +
        '<button class="btn btn--' + (_activeFane === "malar" ? "primary" : "ghost") + ' btn--sm" data-bk-fane="malar">E-postmalar</button>' +
      '</div>' +
      '<div id="bk-fane-content"></div>';

    root.querySelectorAll("[data-bk-fane]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        _activeFane = btn.getAttribute("data-bk-fane");
        renderPage(root);
      });
    });

    var fc = root.querySelector("#bk-fane-content");
    if (_activeFane === "malar") {
      fc.innerHTML =
        App.emailTemplateCard("booking-avbook", "E-postmal for avbooking", DEFAULT_AVBOOK_TEMPLATE,
          "Vert brukt av «Avbook»-knappen på ein booking. Variablar: {navn}, {epost}, {referanse}, {ressurs}, {dato}, {klokkeslett}") +
        App.emailTemplateCard("booking-svar", "E-postmal for svar", DEFAULT_SVAR_TEMPLATE,
          "Vert brukt av «Svar»-knappen på ein booking. Variablar: {navn}, {epost}, {referanse}, {ressurs}, {dato}, {klokkeslett}");
      App.bindEmailTemplateCard(fc, "booking-avbook", DEFAULT_AVBOOK_TEMPLATE);
      App.bindEmailTemplateCard(fc, "booking-svar", DEFAULT_SVAR_TEMPLATE);
    } else {
      renderList(fc);
    }
  }

  function renderList(root) {
    var bookings = getBookings();
    var assets   = getAssets();

    var groups = [
      { status: "ny",   label: "Nye",  items: [] },
      { status: "lest", label: "Lest", items: [] },
      { status: "løst", label: "Løst", items: [] }
    ];
    bookings.forEach(function (b) {
      var g = groups.find(function (g) { return g.status === (b.status || "ny"); });
      if (g) g.items.push(b);
    });

    var activeGroups = groups.filter(function (g) {
      return g.status !== "løst" || g.items.length;
    });

    root.innerHTML =
      (bookings.length === 0
        ? '<p style="color:var(--color-muted);font-size:.9rem">Ingen bookingforespørsler ennå.</p>'
        : activeGroups.map(function (g) {
            if (!g.items.length) return "";
            return '<div style="margin-bottom:1.2rem">' +
              '<p class="i-section-label">' + C.esc(g.label) + ' (' + g.items.length + ')</p>' +
              '<ul class="admin-list">' + g.items.map(function (b) {
                var asset   = assets.find(function (a) { return a.id === b.assetId; });
                var dateStr = b.date
                  ? new Date(b.date + "T00:00:00").toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })
                  : "";
                var preview = [
                  asset ? asset.name : "",
                  dateStr,
                  b.time || "",
                  b.message ? b.message.slice(0, 80) : ""
                ].filter(Boolean).join(" · ");

                return '<li class="admin-row" data-bk-open="' + C.esc(b.id) + '" style="cursor:pointer">' +
                  '<div class="admin-row__main">' +
                    '<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">' +
                      '<strong>' + C.esc(b.name || "(ukjent)") + '</strong>' +
                      (b.email ? '<a href="mailto:' + C.esc(b.email) + '" style="color:var(--color-primary);font-size:.88rem">' + C.esc(b.email) + '</a>' : '') +
                      statusBadge(b.status || "ny") +
                      (b.referenceNumber ? '<span style="font-size:.75rem;color:var(--color-muted)">#' + C.esc(String(b.referenceNumber)) + '</span>' : '') +
                    '</div>' +
                    (preview ? '<span class="admin-row__meta">' + C.esc(preview) + '</span>' : '') +
                    '<span class="admin-row__meta">' + formatDate(b.createdAt) + '</span>' +
                  '</div>' +
                  '<div class="admin-row__actions" style="flex-direction:column;align-items:flex-end;gap:.3rem">' +
                    (b.email
                      ? '<div style="display:flex;gap:.3rem">' +
                        '<button class="btn btn--ghost btn--sm" data-bk-avbook="' + C.esc(b.id) + '" title="Send avbookingsmal"><i class="ti ti-calendar-x"></i> Avbook</button>' +
                        '<button class="btn btn--primary btn--sm" data-bk-reply="' + C.esc(b.id) + '" title="Send svarmal"><i class="ti ti-mail-forward"></i> Svar</button>' +
                        '</div>'
                      : '') +
                    '<select data-bk-status="' + C.esc(b.id) + '" style="font-size:.8rem;padding:.3rem .5rem;border:1px solid var(--color-border);border-radius:6px;background:var(--color-bg)">' +
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

    /* Klikk på rad — opne popup */
    root.querySelectorAll("[data-bk-open]").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest("button,select,a")) return;
        var id = row.getAttribute("data-bk-open");
        var bk = getBookings().find(function (b) { return b.id === id; });
        if (!bk) return;
        var asset = getAssets().find(function (a) { return a.id === bk.assetId; });
        openLeadDetail(
          Object.assign({}, bk, {
            message: [
              asset ? ("Ressurs: " + asset.name) : "",
              bk.date ? ("Dato: " + bk.date) : "",
              bk.time ? ("Tid: " + bk.time) : "",
              bk.message || ""
            ].filter(Boolean).join("\n")
          }),
          "Booking",
          function (newStatus) { updateStatus(id, newStatus); renderList(root); }
        );
      });
    });

    /* Avbook-knapp */
    root.querySelectorAll("[data-bk-avbook]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-bk-avbook");
        var bk = getBookings().find(function (b) { return b.id === id; });
        if (!bk) return;
        updateStatus(id, "løst");
        if (App.openReplyModal) {
          var asset = getAssets().find(function (a) { return a.id === bk.assetId; });
          App.openReplyModal({
            name: bk.name, email: bk.email,
            subject: "Avbooking – " + (asset ? asset.name : "") + " " + formatDate(bk.date) + (bk.time ? " kl. " + bk.time : "") + (bk.referenceNumber ? " (#" + bk.referenceNumber + ")" : ""),
            templateKey: "booking-avbook",
            defaultTemplate: DEFAULT_AVBOOK_TEMPLATE,
            templateOptions: App.buildTemplateOptions([
              { key: "booking-avbook", label: "Avbookingsmal", defaultTemplate: DEFAULT_AVBOOK_TEMPLATE },
              { key: "booking-svar", label: "Svarmal", defaultTemplate: DEFAULT_SVAR_TEMPLATE }
            ]),
            signatureOptions: App.buildSignatureOptions(),
            vars: { navn: bk.name || "", epost: bk.email || "", dato: bk.date || "", klokkeslett: bk.time || "", ressurs: asset ? asset.name : "", referanse: bk.referenceNumber || "" },
            onSent: function (info) {
              if (window.CrmAdmin && window.CrmAdmin.logEmailSent) {
                window.CrmAdmin.logEmailSent({ email: bk.email, name: bk.name, subject: info.subject, plain: info.plain });
              }
            }
          });
        } else {
          window.location.href = "mailto:" + bk.email;
        }
        renderList(root);
      });
    });

    /* Svar-knapp */
    root.querySelectorAll("[data-bk-reply]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-bk-reply");
        var bk = getBookings().find(function (b) { return b.id === id; });
        if (!bk) return;
        updateStatus(id, "løst");
        if (App.openReplyModal) {
          var asset = getAssets().find(function (a) { return a.id === bk.assetId; });
          App.openReplyModal({
            name: bk.name, email: bk.email,
            subject: "Re: Bookingforespørsel fra " + (bk.name || ""),
            templateKey: "booking-svar",
            defaultTemplate: DEFAULT_SVAR_TEMPLATE,
            templateOptions: App.buildTemplateOptions([
              { key: "booking-avbook", label: "Avbookingsmal", defaultTemplate: DEFAULT_AVBOOK_TEMPLATE },
              { key: "booking-svar", label: "Svarmal", defaultTemplate: DEFAULT_SVAR_TEMPLATE }
            ]),
            signatureOptions: App.buildSignatureOptions(),
            vars: { navn: bk.name || "", epost: bk.email || "", dato: bk.date || "", klokkeslett: bk.time || "", ressurs: asset ? asset.name : "", referanse: bk.referenceNumber || "" },
            onSent: function (info) {
              if (window.CrmAdmin && window.CrmAdmin.logEmailSent) {
                window.CrmAdmin.logEmailSent({ email: bk.email, name: bk.name, subject: info.subject, plain: info.plain });
              }
            }
          });
        } else {
          window.location.href = "mailto:" + bk.email;
        }
        renderList(root);
      });
    });

    /* Status-nedtrekk */
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

  // Lastar bookingar-cachen proaktivt ved modul-oppstart — same grunngjeving
  // som module-crm.js (treng vere klar før andre Workspace-modular, t.d.
  // dashboard/intranet-core.js sine tab-badges, som les via denne).
  loadBookings(function () {});

  });
})();
