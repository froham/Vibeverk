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
  var BEDRIFT_KEY = "crm-bedrifter";

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getCustomers() { return App.store.get(CUST_KEY, []) || []; }
  function setCustomers(v) { App.store.set(CUST_KEY, v); }
  function getBedrifter() { return App.store.get(BEDRIFT_KEY, []) || []; }
  function setBedrifter(v) { App.store.set(BEDRIFT_KEY, v); }

  // En kunde kan ha flere kjente e-postadresser (etter sammenslåing) — primær
  // (c.email) + altEmails. customerEmails() gir alle, til bruk i historikk/sletting.
  function customerEmails(c) { return [c.email].concat(c.altEmails || []).filter(Boolean); }
  function customerMatchesEmail(c, email) {
    var e = (email || "").toLowerCase();
    return customerEmails(c).some(function (x) { return x.toLowerCase() === e; });
  }
  function findCustomerByEmail(list, email) {
    return list.find(function (c) { return customerMatchesEmail(c, email); });
  }
  function bedriftFor(c) {
    if (!c.bedriftId) return null;
    return getBedrifter().find(function (b) { return b.id === c.bedriftId; }) || null;
  }
  // Finn bedrift med samme navn (case-insensitive), eller opprett ny med eget kundenummer.
  function findOrCreateBedrift(name) {
    var n = (name || "").trim();
    if (!n) return null;
    var list = getBedrifter();
    var existing = list.find(function (b) { return b.name.toLowerCase() === n.toLowerCase(); });
    if (existing) return existing;
    var nums = list.map(function (b) { return b.customerNumber; }).filter(Boolean);
    var fresh = { id: "bed-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), name: n, customerNumber: App.generateUniqueNumber(nums) };
    list.push(fresh);
    setBedrifter(list);
    return fresh;
  }

  function upsertCustomer(email, name) {
    if (!email) return;
    var list = getCustomers();
    var existing = findCustomerByEmail(list, email);
    if (!existing) {
      var nums = list.map(function (c) { return c.customerNumber; }).filter(Boolean);
      list.unshift({
        id: "cust-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), email: email, altEmails: [], name: name || "", note: "",
        created: new Date().toISOString(), customerNumber: App.generateUniqueNumber(nums), bedriftId: null
      });
      setCustomers(list);
    } else if (name && !existing.name) {
      existing.name = name;
      setCustomers(list);
    }
  }

  // Slår sammen to eller flere kundeposter til én. Eldste post (først opprettet)
  // beholdes som primær og holder sitt kundenummer; e-postene fra de andre legges
  // til som altEmails, notat og navn kombineres, og de andre postene slettes.
  function mergeCustomers(ids) {
    var list = getCustomers();
    var toMerge = list.filter(function (c) { return ids.indexOf(c.id) > -1; });
    if (toMerge.length < 2) return null;
    toMerge.sort(function (a, b) { return (a.created || "").localeCompare(b.created || ""); });
    var primary = toMerge[0];
    var allEmails = [];
    toMerge.forEach(function (c) { customerEmails(c).forEach(function (e) { if (allEmails.indexOf(e) === -1) allEmails.push(e); }); });
    primary.email = allEmails[0];
    primary.altEmails = allEmails.slice(1);
    var notes = toMerge.map(function (c) { return (c.note || "").trim(); }).filter(Boolean);
    primary.note = notes.join(" / ");
    if (!primary.name) {
      var withName = toMerge.find(function (c) { return c.name; });
      if (withName) primary.name = withName.name;
    }
    if (!primary.bedriftId) {
      var withBedrift = toMerge.find(function (c) { return c.bedriftId; });
      if (withBedrift) primary.bedriftId = withBedrift.bedriftId;
    }
    var rest = ids.filter(function (id) { return id !== primary.id; });
    setCustomers(list.filter(function (c) { return rest.indexOf(c.id) === -1; }));
    return primary;
  }

  /* =========================================================================
     HISTORIKK — samlar data frå alle modular per e-post, med reell status
     ====================================================================== */
  function getHistory(emails) {
    var es = (Array.isArray(emails) ? emails : [emails]).map(function (e) { return (e || "").toLowerCase(); });
    var items = [];

    // Kontaktskjema og tilbod (leads) — status lest direkte frå objektet
    var leads = App.getLeads ? App.getLeads() : [];
    leads.forEach(function (l) {
      if (es.indexOf((l.email || "").toLowerCase()) === -1) return;
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
      if (es.indexOf((b.email || "").toLowerCase()) === -1) return;
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

    var intraLink = (CFG.intranettFeatures && CFG.intranettFeatures.crm !== false)
      ? '<a href="../intranet/#/crm" target="_blank" class="btn btn--ghost" style="font-size:.82rem;padding:.4rem .8rem"><i class="ti ti-external-link"></i> Åpne i intranett</a>'
      : "";

    root.innerHTML =
      (intraLink ? '<div style="margin-bottom:.8rem">' + intraLink + '</div>' : '') +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.8rem;flex-wrap:wrap">' +
        '<h4 style="margin:0">Kunder (' + customers.length + ')</h4>' +
        '<div style="display:flex;gap:.5rem">' +
          C.button({ label: "Eksporter kunder (CSV)", icon: "table-export", variant: "ghost", attrs: "data-crm-export" }) +
          C.button({ label: "Importer nye", icon: "refresh", variant: "ghost", attrs: "data-crm-import" }) +
        '</div>' +
      '</div>' +
      '<div data-crm-merge-bar style="display:none;margin-bottom:.8rem;align-items:center;gap:.6rem">' +
        C.button({ label: "Slå sammen valgte kunder", icon: "git-merge", variant: "primary", attrs: "data-crm-merge-btn" }) +
        '<span style="font-size:.82rem;color:var(--color-muted)">Beholder alle e-postadresser, slår sammen notat og historikk.</span>' +
      '</div>' +
      (customers.length
        ? '<ul class="admin-list" data-crm-list>' + customers.map(customerRow).join("") + '</ul>'
        : '<p class="prose prose--muted">Ingen kunder enno. Kjem automatisk frå innsendte skjema og bookingar.</p>') +
      '<div data-crm-detail></div>';

    root.querySelector("[data-crm-export]").addEventListener("click", function () {
      App.downloadCsv(
        "kunder.csv",
        ["Navn", "E-post", "Andre e-postadresser", "Kundenummer", "Bedrift", "Notat", "Opprettet"],
        getCustomers().map(function (c) {
          var bed = bedriftFor(c);
          return [c.name || "", c.email || "", (c.altEmails || []).join("; "), c.customerNumber || "", bed ? bed.name : "", c.note || "", c.created || ""];
        })
      );
    });
    root.querySelector("[data-crm-import]").addEventListener("click", function () {
      autoImportContacts();
      renderAdmin(root);
    });

    function updateMergeBar() {
      var checked = root.querySelectorAll(".crm-merge-check:checked");
      root.querySelector("[data-crm-merge-bar]").style.display = checked.length >= 2 ? "flex" : "none";
    }
    root.querySelectorAll(".crm-merge-check").forEach(function (cb) {
      cb.addEventListener("change", updateMergeBar);
    });
    var mergeBtn = root.querySelector("[data-crm-merge-btn]");
    if (mergeBtn) mergeBtn.addEventListener("click", function () {
      var ids = Array.prototype.slice.call(root.querySelectorAll(".crm-merge-check:checked")).map(function (cb) { return cb.value; });
      if (ids.length < 2) return;
      if (!confirm("Slå sammen " + ids.length + " kundeposter til én? Alle e-postadresser, notat og historikk bevares — dette kan ikke angres.")) return;
      mergeCustomers(ids);
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
        deleteAllForEmail(customerEmails(cust));
        setCustomers(getCustomers().filter(function (c) { return c.id !== id; }));
        renderAdmin(root);
      });
    });
  }

  function customerRow(c) {
    var history = getHistory(customerEmails(c));
    var openCount = history.filter(function (h) { return h.status !== "løst"; }).length;
    var bed = bedriftFor(c);
    return '<li class="admin-row" style="flex-direction:column;align-items:stretch;gap:.3rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;flex-wrap:wrap">' +
        '<div style="display:flex;gap:.6rem;align-items:flex-start">' +
          '<input type="checkbox" class="crm-merge-check" value="' + esc(c.id) + '" style="margin-top:.3rem" title="Velg for sammenslåing">' +
          '<div>' +
            '<strong>' + esc(c.name || "(ukjent namn)") + '</strong>' +
            ' <span class="crm-custnum">#' + (c.customerNumber || "—") + '</span>' +
            (bed ? ' <span class="crm-custnum crm-custnum--bedrift">' + esc(bed.name) + ' #' + bed.customerNumber + '</span>' : "") +
            (openCount > 0 ? ' <span class="crm-stat crm-stat--active">' + openCount + ' ulest/uløst</span>' : '') +
            '<br><a href="mailto:' + esc(c.email) + '" style="font-size:.85rem;color:var(--color-primary)">' + esc(c.email) + '</a>' +
            (c.altEmails && c.altEmails.length ? '<span style="font-size:.78rem;color:var(--color-muted)"> + ' + c.altEmails.length + ' annen e-post</span>' : '') +
            (c.note ? '<p class="crm-note">' + esc(c.note.slice(0, 80)) + (c.note.length > 80 ? "…" : "") + '</p>' : '') +
          '</div>' +
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
    var history = getHistory(customerEmails(c));
    var bed = bedriftFor(c);

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
          '<strong style="font-size:1.05rem">' + esc(c.name || c.email) + ' <span class="crm-custnum">#' + (c.customerNumber || "—") + '</span></strong>' +
          C.button({ label: "Lukk", variant: "ghost", attrs: "data-crm-close" }) +
        '</div>' +
        (c.altEmails && c.altEmails.length
          ? '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Andre kjente e-postadresser (etter sammenslåing): ' + c.altEmails.map(esc).join(", ") + '</p>'
          : "") +
        '<form data-crm-form>' +
          '<div class="bk-2col">' +
            C.field({ id:"crm-name",  label:"Namn",   value: c.name  || "" }) +
            C.field({ id:"crm-email", label:"E-post (primær)",  value: c.email || "", type:"email" }) +
          '</div>' +
          C.field({ id:"crm-bedrift", label:"Bedrift (valgfritt)", value: bed ? bed.name : "", placeholder:"F.eks. Acme AS — flere kontaktpersoner kan dele samme bedrift" }) +
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
      var bedriftInput = detail.querySelector("#crm-bedrift").value.trim();
      customers[idx].bedriftId = bedriftInput ? findOrCreateBedrift(bedriftInput).id : null;
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

  function deleteAllForEmail(emails) {
    var es = (Array.isArray(emails) ? emails : [emails]).map(function (e) { return (e || "").toLowerCase(); });
    if (App.getLeads) {
      var leads = App.getLeads().filter(function (l) { return es.indexOf((l.email || "").toLowerCase()) === -1; });
      App.store.set("leads", leads);
    }
    var bk = App.store.get("booking-bookings", []) || [];
    App.store.set("booking-bookings", bk.filter(function (b) { return es.indexOf((b.email || "").toLowerCase()) === -1; }));
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
      category: "henvendelser",
      render: function () { return '<div data-crm-root></div>'; },
      mount:  function (body) { renderAdmin(body.querySelector("[data-crm-root]") || body); }
    }
  });
})();
