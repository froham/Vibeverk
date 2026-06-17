/* =============================================================================
   module-crm.js  —  KUNDER (lett CRM)
   -----------------------------------------------------------------------------
   Selvstendig IIFE. Lastes etter core.js. Slås av/på med features.crm.

   Samlar alle kontaktpunkt per e-postadresse:
     - Kontaktskjema (leads)
     - Tilbudsforespørslar
     - Bookingar (frå booking-modulen)

   Kvart kundekort har:
     - Namn + e-post
     - Internt notat
     - Full historikk over alle kontaktpunkt, med status (Ny/Lest/Løst) per punkt
     - Slett alt-knapp (GDPR §17)

   Vises som eigen admin-fane. Ingen offentleg side.
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App, C = window.Components, CFG = window.SITE_CONFIG || {};
  if (!App || !C) return;
  if (CFG.features && CFG.features.crm === false) return;

  var esc = C.esc;
  var CUST_KEY = "crm-customers";

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getCustomers() { return App.store.get(CUST_KEY, []) || []; }
  function setCustomers(v) { App.store.set(CUST_KEY, v); }

  function upsertCustomer(email, name) {
    if (!email) return;
    var list = getCustomers();
    var existing = list.find(function (c) { return c.email.toLowerCase() === email.toLowerCase(); });
    if (!existing) {
      list.unshift({ id: "cust-" + Date.now(), email: email, name: name || "", note: "", created: new Date().toISOString() });
      setCustomers(list);
    } else if (name && !existing.name) {
      existing.name = name;
      setCustomers(list);
    }
  }

  /* =========================================================================
     HISTORIKK — samlar data frå alle modular per e-post, med reell status
     ====================================================================== */
  function getHistory(email) {
    var e = email.toLowerCase();
    var items = [];

    // Kontaktskjema og tilbod (leads) — status lest direkte frå objektet
    var leads = App.getLeads ? App.getLeads() : [];
    leads.forEach(function (l) {
      if ((l.email || "").toLowerCase() !== e) return;
      var isQuote = l.message && l.message.indexOf("Tilbudsforesp") === 0;
      items.push({
        type:   isQuote ? "Tilbud" : "Kontakt",
        label:  isQuote ? "Tilbudsforespørsel" : "Kontaktskjema",
        time:   l.time,
        status: l.status || "ny",
        text:   (l.message || "").split("\n").filter(function (ln) {
          return ln.trim() && ln !== "Tilbudsforespørsel";
        }).slice(0, 2).join(" · ").slice(0, 100)
      });
    });

    // Bookingar — same status-felt
    var bookings = App.store.get("booking-bookings", []) || [];
    var assets   = App.store.get("booking-assets",   []) || [];
    bookings.forEach(function (b) {
      if ((b.email || "").toLowerCase() !== e) return;
      var a = assets.find(function (x) { return x.id === b.assetId; });
      items.push({
        type:   "Booking",
        label:  (a ? a.name : "Booking") + " · " + C.formatDate(b.date) + " kl. " + b.time,
        time:   b.date + "T" + b.time + ":00",
        status: b.status || "ny",
        text:   b.instant ? "Sanntidsbooking" : "Forespørsel"
      });
    });

    // Sorter nyast fyrst
    items.sort(function (a, b) { return (b.time || "").localeCompare(a.time || ""); });
    return items;
  }

  /* =========================================================================
     ADMIN
     ====================================================================== */
  function renderAdmin(root) {
    // Autoimporter nye e-postadressar frå leads/bookingar
    autoImportContacts();

    var customers = getCustomers();

    root.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.8rem">' +
        '<h4 style="margin:0">Kunder (' + customers.length + ')</h4>' +
        C.button({ label: "Importer nye", icon: "refresh", variant: "ghost", attrs: "data-crm-import" }) +
      '</div>' +
      (customers.length
        ? '<ul class="admin-list" data-crm-list>' + customers.map(customerRow).join("") + '</ul>'
        : '<p class="prose prose--muted">Ingen kunder enno. Kjem automatisk frå innsendte skjema og bookingar.</p>') +
      '<div data-crm-detail></div>';

    root.querySelector("[data-crm-import]").addEventListener("click", function () {
      autoImportContacts();
      renderAdmin(root);
    });

    root.querySelectorAll("[data-crm-open]").forEach(function (b) {
      b.addEventListener("click", function () {
        openCustomer(root, b.getAttribute("data-crm-open"));
      });
    });
    root.querySelectorAll("[data-crm-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id    = b.getAttribute("data-crm-del");
        var cust  = getCustomers().find(function (c) { return c.id === id; });
        if (!cust) return;
        if (!confirm("Slett ALT knytt til " + cust.email + "? Dette kan ikkje angrast.")) return;
        deleteAllForEmail(cust.email);
        setCustomers(getCustomers().filter(function (c) { return c.id !== id; }));
        renderAdmin(root);
      });
    });
  }

  function customerRow(c) {
    var history = getHistory(c.email);
    var openCount = history.filter(function (h) { return h.status !== "løst"; }).length;
    return '<li class="admin-row" style="flex-direction:column;align-items:stretch;gap:.3rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;flex-wrap:wrap">' +
        '<div>' +
          '<strong>' + esc(c.name || "(ukjent namn)") + '</strong>' +
          (openCount > 0 ? ' <span class="crm-stat crm-stat--active">' + openCount + ' ulest/uløst</span>' : '') +
          '<br><a href="mailto:' + esc(c.email) + '" style="font-size:.85rem;color:var(--color-primary)">' + esc(c.email) + '</a>' +
          (c.note ? '<p class="crm-note">' + esc(c.note.slice(0, 80)) + (c.note.length > 80 ? "…" : "") + '</p>' : '') +
        '</div>' +
        '<div style="display:flex;gap:.4rem;align-items:center">' +
          '<span style="font-size:.78rem;color:var(--color-muted)">' + history.length + ' kontaktpunkt</span>' +
          C.button({ label: "Opne", variant: "ghost", attrs: 'data-crm-open="' + esc(c.id) + '"' }) +
          C.button({ label: "Slett alt", variant: "ghost", attrs: 'data-crm-del="' + esc(c.id) + '" style="border-color:#c0392b;color:#c0392b"' }) +
        '</div>' +
      '</div>' +
    '</li>';
  }

  function openCustomer(root, id) {
    var customers = getCustomers();
    var c = customers.find(function (x) { return x.id === id; });
    if (!c) return;
    var detail = root.querySelector("[data-crm-detail]");
    var history = getHistory(c.email);

    var histHtml = history.length
      ? '<div class="crm-history">' + history.map(function (h) {
          return '<div class="crm-history__item">' +
            '<span style="font-weight:600">' + esc(h.label) + '</span>' +
            ' <span style="font-size:.7rem;color:var(--color-muted)">' + esc(h.type) + '</span>' +
            ' ' + App.statusBadge(h.status) +
            (h.time ? ' <span style="color:var(--color-muted);font-size:.78rem">· ' + new Date(h.time).toLocaleDateString("nb-NO", {day:"numeric",month:"short",year:"numeric"}) + '</span>' : '') +
            (h.text ? '<br><span style="color:var(--color-muted);font-size:.8rem">' + esc(h.text) + '</span>' : '') +
          '</div>';
        }).join("") + '</div>'
      : '<p class="prose prose--muted" style="font-size:.85rem">Ingen historikk funne.</p>';

    detail.innerHTML =
      '<div class="admin-form--card" style="margin-top:1rem">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.9rem">' +
          '<strong style="font-size:1.05rem">' + esc(c.name || c.email) + '</strong>' +
          C.button({ label: "Lukk", variant: "ghost", attrs: "data-crm-close" }) +
        '</div>' +
        '<form data-crm-form>' +
          '<div class="bk-2col">' +
            C.field({ id:"crm-name",  label:"Namn",   value: c.name  || "" }) +
            C.field({ id:"crm-email", label:"E-post",  value: c.email || "", type:"email" }) +
          '</div>' +
          C.field({ id:"crm-note", label:"Internt notat", multiline:true, rows:3, value:c.note || "", placeholder:"Notatar berre synlege for deg..." }) +
          '<div style="margin-top:.8rem">' +
            C.button({ label:"Lagre", type:"submit", variant:"primary" }) +
            ' <span class="form__status" data-crm-status style="margin-left:.6rem"></span>' +
          '</div>' +
        '</form>' +
        '<hr style="border:0;border-top:1px solid var(--color-border);margin:1.2rem 0">' +
        '<h4 style="margin:0 0 .6rem;font-size:.9rem">Historikk</h4>' +
        histHtml +
      '</div>';

    detail.querySelector("[data-crm-close]").addEventListener("click", function () { detail.innerHTML = ""; });
    detail.querySelector("[data-crm-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      var idx = customers.findIndex(function (x) { return x.id === id; });
      customers[idx].name  = detail.querySelector("#crm-name").value.trim();
      customers[idx].email = detail.querySelector("#crm-email").value.trim();
      customers[idx].note  = detail.querySelector("#crm-note").value.trim();
      setCustomers(customers);
      var st = detail.querySelector("[data-crm-status]");
      st.textContent = "Lagra."; st.className = "form__status is-ok";
      setTimeout(function () { st.textContent = ""; }, 1500);
      renderAdmin(root);
    });
  }

  /* =========================================================================
     AUTO-IMPORT og SLETT
     ====================================================================== */
  function autoImportContacts() {
    var leads = App.getLeads ? App.getLeads() : [];
    leads.forEach(function (l) { if (l.email) upsertCustomer(l.email, l.name); });
    var bookings = App.store.get("booking-bookings", []) || [];
    bookings.forEach(function (b) { if (b.email) upsertCustomer(b.email, b.name); });
  }

  function deleteAllForEmail(email) {
    var e = email.toLowerCase();
    if (App.getLeads) {
      var leads = App.getLeads().filter(function (l) { return (l.email || "").toLowerCase() !== e; });
      App.store.set("leads", leads);
    }
    var bk = App.store.get("booking-bookings", []) || [];
    App.store.set("booking-bookings", bk.filter(function (b) { return (b.email || "").toLowerCase() !== e; }));
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  App.registerModule({
    id:      "crm",
    label:   "Kunder",
    order:   999,
    adminOnly: true,   // ikkje i nav, ikkje på framsida
    render:  function () { return ""; },
    admin: {
      label:  "Kunder",
      render: function () { return '<div data-crm-root></div>'; },
      mount:  function (body) { renderAdmin(body.querySelector("[data-crm-root]") || body); }
    }
  });
})();
