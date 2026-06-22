/* =============================================================================
   module-crm.js  —  KUNDER / CRM (intranett)
   -----------------------------------------------------------------------------
   Full CRM-funksjonalitet spegla frå offentleg side:
   - Liste over alle kundar med søk og filter
   - Fullstendig kundekort med redigering (namn, e-post, bedrift, notat)
   - Historikk over alle kontaktpunkt (kontakt, tilbud, booking)
   - Opprette nye kundar manuelt
   - Slette kunde (GDPR §17)
   - CSV-eksport
   - Auto-import frå leads og bookingar

   Lagring: same nøklar som offentleg CRM (crm-customers, crm-bedrifter)
   Ruter:   #/crm, #/crm/<id>
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.crm === false) return;

  var CUST_KEY   = "crm-customers";
  var BEDRIFT_KEY = "crm-bedrifter";

  /* =========================================================================
     LAGRING (same som offentleg CRM)
     ====================================================================== */
  function getCustomers() { return App.store.get(CUST_KEY, []) || []; }
  function setCustomers(v) { App.store.set(CUST_KEY, v); }
  function getBedrifter() { return App.store.get(BEDRIFT_KEY, []) || []; }
  function setBedrifter(v) { App.store.set(BEDRIFT_KEY, v); }

  function customerEmails(c) { return [c.email].concat(c.altEmails || []).filter(Boolean); }
  function bedriftFor(c) {
    if (!c || !c.bedriftId) return null;
    return getBedrifter().find(function (b) { return b.id === c.bedriftId; }) || null;
  }
  function findOrCreateBedrift(name) {
    var n = (name || "").trim();
    if (!n) return null;
    var list = getBedrifter();
    var ex = list.find(function (b) { return b.name.toLowerCase() === n.toLowerCase(); });
    if (ex) return ex;
    var nums = list.map(function (b) { return b.customerNumber; }).filter(Boolean);
    var fresh = {
      id: "bed-" + Date.now() + "-" + Math.random().toString(36).slice(2,6),
      name: n,
      customerNumber: App.generateUniqueNumber ? App.generateUniqueNumber(nums) : String(Date.now())
    };
    list.push(fresh);
    setBedrifter(list);
    return fresh;
  }

  function newCustomerId() {
    return "cust-" + Date.now() + "-" + Math.random().toString(36).slice(2,6);
  }

  function autoImport() {
    var leads    = App.getLeads ? App.getLeads() : [];
    var bookings = App.store.get("booking-bookings", []) || [];
    var list     = getCustomers();
    var changed  = false;

    function upsert(email, name) {
      if (!email) return;
      var e = email.toLowerCase();
      var ex = list.find(function (c) { return customerEmails(c).some(function (x) { return x.toLowerCase() === e; }); });
      if (!ex) {
        var nums = list.map(function (c) { return c.customerNumber; }).filter(Boolean);
        list.unshift({
          id: newCustomerId(), email: email, altEmails: [], name: name || "",
          note: "", created: new Date().toISOString(),
          customerNumber: App.generateUniqueNumber ? App.generateUniqueNumber(nums) : String(Date.now()),
          bedriftId: null
        });
        changed = true;
      } else if (name && !ex.name) {
        ex.name = name; changed = true;
      }
    }

    leads.forEach(function (l)    { if (l.email) upsert(l.email, l.name); });
    bookings.forEach(function (b) { if (b.email) upsert(b.email, b.name); });
    if (changed) setCustomers(list);
  }

  /* =========================================================================
     HISTORIKK
     ====================================================================== */
  function getHistory(emails) {
    var es   = emails.map(function (e) { return (e||"").toLowerCase(); });
    var items = [];
    var leads = App.getLeads ? App.getLeads() : [];
    leads.forEach(function (l) {
      if (es.indexOf((l.email||"").toLowerCase()) === -1) return;
      items.push({
        type:   l.message && l.message.indexOf("Tilbudsforesp") === 0 ? "Tilbud" : "Kontakt",
        label:  l.name || l.email,
        status: l.status || "ny",
        time:   l.time || 0,
        text:   (l.message || "").replace(/<[^>]+>/g,"").slice(0,120),
        id:     l.id
      });
    });
    var bookings = App.store.get("booking-bookings", []) || [];
    var assets   = App.store.get("booking-assets",   []) || [];
    bookings.forEach(function (b) {
      if (es.indexOf((b.email||"").toLowerCase()) === -1) return;
      var asset = assets.find(function (a) { return a.id === b.assetId; });
      items.push({
        type:   "Booking",
        label:  (asset ? asset.name + " — " : "") + (b.date || ""),
        status: b.status || "ny",
        time:   b.createdAt || 0,
        text:   b.message || "",
        id:     b.id
      });
    });
    return items.sort(function (a, b) { return b.time - a.time; });
  }

  /* =========================================================================
     HJELPERAR
     ====================================================================== */
  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("nb-NO", { day:"numeric", month:"short", year:"numeric" });
  }

  function statusBadge(status) {
    var map = { ny:"#6A6A73", lest:"var(--color-secondary)", løst:"#2a7a2a" };
    var color = map[status] || "#6A6A73";
    var labels = { ny:"Ny", lest:"Lest", løst:"Løst" };
    return '<span style="display:inline-block;font-size:.7rem;font-weight:700;padding:.15rem .5rem;border-radius:999px;background:' + color + '22;color:' + color + ';text-transform:uppercase">' + C.esc(labels[status]||status) + '</span>';
  }

  /* =========================================================================
     RENDER — LISTE
     ====================================================================== */
  function render() { return '<div id="crm-root"></div>'; }

  function mount(outlet, ctx, sub) {
    var root = outlet.querySelector("#crm-root") || outlet;
    autoImport();
    if (sub) renderDetail(root, sub);
    else     renderList(root);
  }

  function renderList(root) {
    var customers = getCustomers();
    var bedrifter = getBedrifter();

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Kunder <span style="font-size:1rem;font-weight:400;color:var(--color-muted)">(' + customers.length + ')</span></h2>' +
        '<div style="display:flex;gap:.5rem">' +
          '<button class="btn btn--ghost btn--sm" id="crm-new-btn"><i class="ti ti-user-plus"></i> Ny kunde</button>' +
          '<button class="btn btn--ghost btn--sm" id="crm-import-btn"><i class="ti ti-refresh"></i> Importer</button>' +
          '<button class="btn btn--ghost btn--sm" id="crm-export-btn"><i class="ti ti-table-export"></i> CSV</button>' +
        '</div>' +
      '</div>' +

      /* Søk */
      '<div style="position:relative;margin-bottom:1rem">' +
        '<i class="ti ti-search" style="position:absolute;left:.7rem;top:50%;transform:translateY(-50%);color:var(--color-muted)"></i>' +
        '<input id="crm-search" type="search" placeholder="Søk på namn, e-post, bedrift, notat…" ' +
          'style="width:100%;padding:.55rem .8rem .55rem 2.1rem;border:1.5px solid var(--color-border);border-radius:8px;font:inherit;font-size:.88rem;background:var(--color-bg);color:var(--color-text)">' +
      '</div>' +

      '<div id="crm-new-form"></div>' +

      (customers.length === 0
        ? '<p style="color:var(--color-muted);font-size:.9rem">Ingen kunder ennå. Kjem automatisk frå innsendte skjema og bookingar, eller opprett manuelt.</p>'
        : '<ul class="admin-list" id="crm-list">' + customers.map(function (c) { return crmRow(c, bedrifter); }).join("") + '</ul>'
      );

    bindList(root);
  }

  function crmRow(c, bedrifter) {
    var bed      = bedriftFor(c);
    var history  = getHistory(customerEmails(c));
    var openCount = history.filter(function (h) { return h.status !== "løst"; }).length;
    return '<li class="admin-row" style="flex-direction:column;align-items:stretch;gap:.3rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;flex-wrap:wrap">' +
        '<div style="min-width:0;flex:1">' +
          '<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.15rem">' +
            '<strong style="font-size:.92rem">' + C.esc(c.name || "(ukjent namn)") + '</strong>' +
            '<span style="font-size:.72rem;color:var(--color-muted);font-weight:600">#' + C.esc(String(c.customerNumber||"")) + '</span>' +
            (bed ? '<span style="font-size:.72rem;color:var(--color-primary);font-weight:600">' + C.esc(bed.name) + '</span>' : '') +
            (openCount > 0 ? '<span style="font-size:.72rem;font-weight:700;color:var(--color-secondary)">' + openCount + ' open</span>' : '') +
          '</div>' +
          '<a href="mailto:' + C.esc(c.email) + '" style="font-size:.85rem;color:var(--color-primary)">' + C.esc(c.email) + '</a>' +
          (c.note ? '<div style="font-size:.78rem;color:var(--color-muted);margin-top:.15rem">' + C.esc(c.note.slice(0,80)) + (c.note.length>80?"…":"") + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:.4rem;flex-shrink:0">' +
          '<span style="font-size:.75rem;color:var(--color-muted);align-self:center">' + history.length + ' kontaktpunkt</span>' +
          '<a href="#/crm/' + C.esc(c.id) + '" class="btn btn--ghost btn--sm">Opne</a>' +
          '<button class="btn btn--ghost btn--sm" style="color:#c0392b;border-color:#c0392b" data-crm-del="' + C.esc(c.id) + '">Slett</button>' +
        '</div>' +
      '</div>' +
    '</li>';
  }

  function bindList(root) {
    var searchInp = root.querySelector("#crm-search");
    if (searchInp) {
      searchInp.addEventListener("input", function () {
        var q   = searchInp.value.toLowerCase().trim();
        var bed = getBedrifter();
        root.querySelectorAll("#crm-list .admin-row").forEach(function (row) {
          var id   = row.querySelector("[data-crm-del]")?.getAttribute("data-crm-del") || "";
          var c    = getCustomers().find(function (x) { return x.id === id; });
          if (!c) return;
          var b    = bedriftFor(c);
          var text = [c.name, c.email, c.note, b ? b.name : ""].join(" ").toLowerCase();
          row.style.display = (!q || text.indexOf(q) > -1) ? "" : "none";
        });
      });
    }

    var newBtn = root.querySelector("#crm-new-btn");
    if (newBtn) newBtn.addEventListener("click", function () { openNewForm(root); });

    var importBtn = root.querySelector("#crm-import-btn");
    if (importBtn) importBtn.addEventListener("click", function () {
      autoImport(); renderList(root);
    });

    var exportBtn = root.querySelector("#crm-export-btn");
    if (exportBtn) exportBtn.addEventListener("click", function () {
      if (!App.downloadCsv) return;
      App.downloadCsv("kunder.csv",
        ["Namn","E-post","Kundenummer","Bedrift","Notat","Oppretta"],
        getCustomers().map(function (c) {
          var b = bedriftFor(c);
          return [c.name||"", c.email||"", c.customerNumber||"", b?b.name:"", c.note||"", c.created||""];
        })
      );
    });

    root.querySelectorAll("[data-crm-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-crm-del");
        var c  = getCustomers().find(function (x) { return x.id === id; });
        if (!c || !confirm("Slett all data for " + (c.name||c.email) + "? Kan ikkje angrast.")) return;
        setCustomers(getCustomers().filter(function (x) { return x.id !== id; }));
        Intranet.logActivity({ type:"crm_deleted", label:"Kunde slettet: " + (c.name||c.email) });
        renderList(root);
      });
    });
  }

  /* =========================================================================
     NY KUNDE-FORM
     ====================================================================== */
  function openNewForm(root) {
    var wrap = root.querySelector("#crm-new-form");
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="i-card" style="margin-bottom:1rem">' +
        '<h4 style="margin:0 0 .9rem">Ny kunde</h4>' +
        '<div class="i-form">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">' +
            '<div class="i-field"><label for="crm-new-name">Namn</label><input id="crm-new-name" type="text" placeholder="Ola Nordmann"></div>' +
            '<div class="i-field"><label for="crm-new-email">E-post *</label><input id="crm-new-email" type="email" placeholder="ola@bedrift.no"></div>' +
          '</div>' +
          '<div class="i-field"><label for="crm-new-bedrift">Bedrift (valgfritt)</label><input id="crm-new-bedrift" type="text" placeholder="Bedrift AS"></div>' +
          '<div class="i-field"><label for="crm-new-note">Notat (valgfritt)</label><textarea id="crm-new-note" rows="2" placeholder="Intern merknad…"></textarea></div>' +
          '<div style="display:flex;gap:.5rem">' +
            '<button class="btn btn--primary btn--sm" id="crm-new-save">Legg til</button>' +
            '<button class="btn btn--ghost btn--sm" id="crm-new-cancel">Avbryt</button>' +
          '</div>' +
          '<p class="form__status" id="crm-new-status"></p>' +
        '</div>' +
      '</div>';

    wrap.querySelector("#crm-new-cancel").addEventListener("click", function () { wrap.innerHTML = ""; });
    wrap.querySelector("#crm-new-save").addEventListener("click", function () {
      var email = wrap.querySelector("#crm-new-email").value.trim();
      var st    = wrap.querySelector("#crm-new-status");
      if (!email) { st.textContent = "E-post er påkrevd."; st.className = "form__status is-err"; return; }

      var list = getCustomers();
      var existing = list.find(function (c) { return customerEmails(c).some(function (e) { return e.toLowerCase() === email.toLowerCase(); }); });
      if (existing) { st.textContent = "Denne e-posten finst allereie."; st.className = "form__status is-err"; return; }

      var nums     = list.map(function (c) { return c.customerNumber; }).filter(Boolean);
      var bedInput = wrap.querySelector("#crm-new-bedrift").value.trim();
      var bed      = bedInput ? findOrCreateBedrift(bedInput) : null;
      list.unshift({
        id: newCustomerId(),
        email: email,
        altEmails: [],
        name: wrap.querySelector("#crm-new-name").value.trim(),
        note: wrap.querySelector("#crm-new-note").value.trim(),
        created: new Date().toISOString(),
        customerNumber: App.generateUniqueNumber ? App.generateUniqueNumber(nums) : String(Date.now()),
        bedriftId: bed ? bed.id : null
      });
      setCustomers(list);
      Intranet.logActivity({ type:"crm_created", label:"Ny kunde: " + email });
      wrap.innerHTML = "";
      renderList(root);
    });
  }

  /* =========================================================================
     DETALJ-VISNING
     ====================================================================== */
  function renderDetail(root, id) {
    var customers = getCustomers();
    var c = customers.find(function (x) { return x.id === id; });
    if (!c) { renderList(root); return; }

    var bed     = bedriftFor(c);
    var history = getHistory(customerEmails(c));

    root.innerHTML =
      '<div class="i-page-head">' +
        '<button class="i-topbar__back" id="crm-back"><i class="ti ti-arrow-left"></i> Alle kunder</button>' +
      '</div>' +

      /* Kundekort med redigering */
      '<div class="i-card" style="margin-bottom:1rem">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.9rem">' +
          '<div>' +
            '<h3 style="margin:0 0 .2rem">' + C.esc(c.name || c.email) + '</h3>' +
            '<span style="font-size:.78rem;color:var(--color-muted)">Kundenr. #' + C.esc(String(c.customerNumber||"")) + ' · Oppretta ' + formatDate(c.created) + '</span>' +
          '</div>' +
        '</div>' +
        '<form class="i-form" id="crm-detail-form">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">' +
            '<div class="i-field"><label for="crm-d-name">Namn</label><input id="crm-d-name" type="text" value="' + C.esc(c.name||"") + '"></div>' +
            '<div class="i-field"><label for="crm-d-email">E-post (primær)</label><input id="crm-d-email" type="email" value="' + C.esc(c.email||"") + '"></div>' +
          '</div>' +
          '<div class="i-field"><label for="crm-d-bedrift">Bedrift</label><input id="crm-d-bedrift" type="text" value="' + C.esc(bed ? bed.name : "") + '" placeholder="Bedrift AS"></div>' +
          '<div class="i-field"><label for="crm-d-note">Internt notat</label><textarea id="crm-d-note" rows="3">' + C.esc(c.note||"") + '</textarea></div>' +
          (c.altEmails && c.altEmails.length
            ? '<p style="font-size:.78rem;color:var(--color-muted);margin:0">Andre e-postadresser (frå samanslåing): ' + c.altEmails.map(function(e){return C.esc(e);}).join(", ") + '</p>'
            : "") +
          '<div style="display:flex;gap:.5rem;align-items:center">' +
            '<button type="submit" class="btn btn--primary btn--sm">Lagre</button>' +
            '<button type="button" class="btn btn--ghost btn--sm" id="crm-d-del" style="color:#c0392b;border-color:#c0392b;margin-left:auto">Slett kunde</button>' +
            '<span class="form__status" id="crm-d-status"></span>' +
          '</div>' +
        '</form>' +
      '</div>' +

      /* Historikk */
      '<div class="i-card">' +
        '<p class="i-section-label">Historikk (' + history.length + ' kontaktpunkt)</p>' +
        (history.length === 0
          ? '<p style="color:var(--color-muted);font-size:.88rem;margin:0">Ingen registrerte henvendingar.</p>'
          : '<ul style="list-style:none;padding:0;margin:0;display:grid;gap:.5rem">' +
              history.map(function (h) {
                return '<li style="display:flex;align-items:flex-start;gap:.7rem;padding:.6rem 0;border-bottom:1px solid var(--color-border)">' +
                  '<span style="font-size:.72rem;font-weight:700;color:var(--color-muted);min-width:58px;margin-top:.15rem">' + C.esc(h.type) + '</span>' +
                  '<div style="flex:1;min-width:0">' +
                    '<div style="font-size:.88rem;font-weight:600">' + C.esc(h.label) + '</div>' +
                    (h.text ? '<div style="font-size:.78rem;color:var(--color-muted);margin-top:.1rem">' + C.esc(h.text) + (h.text.length>=120?"…":"") + '</div>' : "") +
                  '</div>' +
                  '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:.25rem;flex-shrink:0">' +
                    statusBadge(h.status) +
                    '<span style="font-size:.72rem;color:var(--color-muted)">' + formatDate(h.time) + '</span>' +
                  '</div>' +
                '</li>';
              }).join("") +
            '</ul>'
        ) +
      '</div>';

    root.querySelector("#crm-back").addEventListener("click", function () {
      Intranet.navigate("crm"); renderList(root);
    });

    root.querySelector("#crm-detail-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var idx = customers.findIndex(function (x) { return x.id === id; });
      if (idx < 0) return;
      customers[idx].name  = root.querySelector("#crm-d-name").value.trim();
      customers[idx].email = root.querySelector("#crm-d-email").value.trim();
      customers[idx].note  = root.querySelector("#crm-d-note").value.trim();
      var bedInput = root.querySelector("#crm-d-bedrift").value.trim();
      customers[idx].bedriftId = bedInput ? findOrCreateBedrift(bedInput).id : null;
      setCustomers(customers);
      Intranet.logActivity({ type:"crm_updated", label:"Kunde oppdatert: " + customers[idx].name });
      var st = root.querySelector("#crm-d-status");
      st.textContent = "Lagra."; st.className = "form__status is-ok";
      setTimeout(function () { if (st) st.textContent = ""; }, 1500);
    });

    root.querySelector("#crm-d-del").addEventListener("click", function () {
      if (!confirm("Slett all data for " + (c.name||c.email) + "? Kan ikkje angrast.")) return;
      setCustomers(getCustomers().filter(function (x) { return x.id !== id; }));
      Intranet.navigate("crm"); renderList(root);
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  Intranet.registerModule({
    id:       "crm",
    navLabel: "Kunder",
    icon:     "users",
    order:    35,
    render:   render,
    mount:    mount
  });

})();
