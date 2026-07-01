/* =============================================================================
   module-crm.js  —  KUNDER / CRM (intranett)  v3
   -----------------------------------------------------------------------------
   Arkitektur:
   – Basis: kundeoversikt, kundekort, kontaktinfo, historikk (alltid)
   – Med CRM: kommunikasjon, tidslinje, oppgåver, dokument, AI-panel
   – Kommunikasjon er IKKJE ein eigen modul — det er ein del av kundekortet
   – E-post: delt App.openReplyModal (same som Kontakt/Booking/Tilbud, styrt av crmFull)

   Nye lagrings-nøklar:
   – crm-comms   : alle kommunikasjons-hendingar per kunde

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
     NØKLAR
     ====================================================================== */
  var CUST_KEY    = "crm-customers";
  var BEDRIFT_KEY = "crm-bedrifter";
  var COMMS_KEY   = "crm-comms";

  /* =========================================================================
     LAGRING — KUNDAR
     ====================================================================== */
  function getCustomers() { return App.store.get(CUST_KEY, []) || []; }
  function setCustomers(v) { App.store.set(CUST_KEY, v); }
  function getBedrifter() { return App.store.get(BEDRIFT_KEY, []) || []; }
  function setBedrifter(v) { App.store.set(BEDRIFT_KEY, v); }

  /* =========================================================================
     LAGRING — KOMMUNIKASJON
     ====================================================================== */
  function getComms() { return App.store.get(COMMS_KEY, []) || []; }
  function setComms(v) { App.store.set(COMMS_KEY, v); }
  function getCommsFor(cid) {
    return getComms().filter(function (c) { return c.customerId === cid; });
  }
  function addComm(data) {
    var list = getComms();
    var item = Object.assign(
      { id: "cm-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5),
        created: new Date().toISOString() },
      data
    );
    list.unshift(item);
    setComms(list);
    return item;
  }
  function deleteComm(id) {
    setComms(getComms().filter(function (c) { return c.id !== id; }));
  }
  function updateComm(id, patch) {
    var list = getComms();
    var idx  = list.findIndex(function (c) { return c.id === id; });
    if (idx >= 0) { list[idx] = Object.assign({}, list[idx], patch); setComms(list); }
  }
  function newThreadId() { return "th-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5); }

  /* =========================================================================
     TIDSLINJE-KONFIGURASJON
     ====================================================================== */
  var TL_CONF = {
    phone_note:     { icon: "phone",          color: "#27AE60", label: "Telefonnotat" },
    internal_note:  { icon: "notes",          color: "#F39C12", label: "Internt notat" },
    email_sent:     { icon: "send",           color: "var(--color-primary)", label: "E-post sendt" },
    email_received: { icon: "mail-opened",    color: "var(--color-primary)", label: "E-post mottatt" },
    document:       { icon: "paperclip",      color: "#E8833A", label: "Dokument" },
    task:           { icon: "circle-check",   color: "#7B5EA7", label: "Oppgave" },
    contact:        { icon: "message-circle", color: "var(--color-primary)", label: "Kontakt" },
    quote:          { icon: "file-invoice",   color: "#E8833A", label: "Tilbud" },
    booking:        { icon: "calendar",       color: "#27AE60", label: "Booking" },
    "default":      { icon: "point",          color: "var(--color-muted)", label: "Hendelse" }
  };

  /* =========================================================================
     HJELPERAR
     ====================================================================== */
  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
  }
  function formatTimeAgo(ts) {
    if (!ts) return "";
    var d    = new Date(ts);
    var diff = Math.round((Date.now() - d) / 60000);
    if (diff < 1)   return "nå";
    if (diff < 60)  return diff + " min";
    var h = Math.round(diff / 60);
    if (h < 24)     return h + " t";
    if (h < 48)     return "i går";
    return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function nowTime()  { return new Date().toTimeString().slice(0, 5); }

  function initials(name) {
    if (!name) return "?";
    var w = name.trim().split(/\s+/);
    if (w.length === 1) return w[0].charAt(0).toUpperCase();
    return (w[0].charAt(0) + w[w.length - 1].charAt(0)).toUpperCase();
  }
  function avatarColor(name) {
    var cols = ["#15616D","#E8833A","#7B5EA7","#2A7A2A","#C0392B","#2980B9","#8E6B3E"];
    var sum  = 0;
    for (var i = 0; i < (name||"").length; i++) sum += (name||"").charCodeAt(i);
    return cols[sum % cols.length];
  }

  function customerEmails(c) { return [c.email].concat(c.altEmails || []).filter(Boolean); }
  function bedriftFor(c) {
    if (!c || !c.bedriftId) return null;
    return getBedrifter().find(function (b) { return b.id === c.bedriftId; }) || null;
  }
  function findOrCreateBedrift(name) {
    var n = (name || "").trim();
    if (!n) return null;
    var list = getBedrifter();
    var ex   = list.find(function (b) { return b.name.toLowerCase() === n.toLowerCase(); });
    if (ex) return ex;
    var nums  = list.map(function (b) { return b.customerNumber; }).filter(Boolean);
    var fresh = {
      id: "bed-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      name: n,
      customerNumber: App.generateUniqueNumber ? App.generateUniqueNumber(nums) : String(Date.now())
    };
    list.push(fresh);
    setBedrifter(list);
    return fresh;
  }
  function newCustomerId() {
    return "cust-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }

  /* =========================================================================
     AUTO-IMPORT
     ====================================================================== */
  function autoImport() {
    var leads    = App.getLeads ? App.getLeads() : [];
    var bookings = App.store.get("booking-bookings", []) || [];
    var list     = getCustomers();
    var changed  = false;
    function upsert(email, name) {
      if (!email) return;
      var e  = email.toLowerCase();
      var ex = list.find(function (c) {
        return customerEmails(c).some(function (x) { return x.toLowerCase() === e; });
      });
      if (!ex) {
        var nums = list.map(function (c) { return c.customerNumber; }).filter(Boolean);
        list.unshift({
          id: newCustomerId(), email: email, altEmails: [], name: name || "",
          phone: "", address: "", note: "", created: new Date().toISOString(),
          customerNumber: App.generateUniqueNumber ? App.generateUniqueNumber(nums) : String(Date.now()),
          bedriftId: null
        });
        changed = true;
      } else if (name && !ex.name) { ex.name = name; changed = true; }
    }
    leads.forEach(function (l)    { if (l.email) upsert(l.email, l.name); });
    bookings.forEach(function (b) { if (b.email) upsert(b.email, b.name); });
    if (changed) setCustomers(list);
  }

  /* =========================================================================
     LEGACY HISTORIKK (leads + bookingar)
     ====================================================================== */
  function getLegacyHistory(emails) {
    var es    = emails.map(function (e) { return (e||"").toLowerCase(); });
    var items = [];
    var leads = App.getLeads ? App.getLeads() : [];
    leads.forEach(function (l) {
      if (es.indexOf((l.email||"").toLowerCase()) === -1) return;
      var isQuote = l.message && l.message.indexOf("Tilbudsforesp") === 0;
      items.push({
        id:      l.id,
        type:    isQuote ? "quote" : "contact",
        created: new Date(l.time || 0).toISOString(),
        title:   isQuote ? "Tilbudsforespørsel" + (l.name ? " fra " + l.name : "")
                         : "Kontaktmelding"     + (l.name ? " fra " + l.name : ""),
        body:    (l.message || "").replace(/<[^>]+>/g, "").slice(0, 120),
        status:  l.status || "ny",
        source:  "legacy"
      });
    });
    var bookings = App.store.get("booking-bookings", []) || [];
    var assets   = App.store.get("booking-assets",   []) || [];
    bookings.forEach(function (b) {
      if (es.indexOf((b.email||"").toLowerCase()) === -1) return;
      var asset = assets.find(function (a) { return a.id === b.assetId; });
      items.push({
        id:      b.id,
        type:    "booking",
        created: new Date(b.createdAt || 0).toISOString(),
        title:   "Booking" + (asset ? ": " + asset.name : "") + (b.date ? " · " + b.date : ""),
        body:    b.message || "",
        status:  b.status || "ny",
        source:  "legacy"
      });
    });
    return items;
  }

  /* =========================================================================
     FELLES TIDSLINJE
     ====================================================================== */
  function getTimeline(customerId, emails) {
    var items = getLegacyHistory(emails).map(function (h) {
      return Object.assign({}, h, { source: "legacy" });
    });
    getCommsFor(customerId).forEach(function (c) {
      items.push(Object.assign({}, c, { source: "comm" }));
    });
    return items.sort(function (a, b) { return new Date(b.created) - new Date(a.created); });
  }

  /* =========================================================================
     STATUS-INDIKATORAR (for liste)
     ====================================================================== */
  function commStats(customerId) {
    var comms   = getCommsFor(customerId);
    var emails  = comms.filter(function (c) { return c.type === "email_sent" || c.type === "email_received"; }).length;
    var phones  = comms.filter(function (c) { return c.type === "phone_note"; }).length;
    var notes   = comms.filter(function (c) { return c.type === "internal_note"; }).length;
    var tasks   = comms.filter(function (c) { return c.type === "task"; });
    var overdue = tasks.some(function (t) { return !t.done && t.dueDate && t.dueDate < todayISO(); });
    return { emails: emails, phones: phones, notes: notes, overdue: overdue };
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
    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Kunder <span style="font-size:1rem;font-weight:400;color:var(--color-muted)">(' + customers.length + ')</span></h2>' +
        '<div style="display:flex;gap:.5rem">' +
          '<button class="btn btn--primary btn--sm" id="crm-new-btn"><i class="ti ti-user-plus"></i> Ny kunde</button>' +
          '<button class="btn btn--ghost btn--sm" id="crm-import-btn" title="Importer fra skjema og bookinger"><i class="ti ti-refresh"></i></button>' +
          '<button class="btn btn--ghost btn--sm" id="crm-export-btn" title="Eksporter CSV"><i class="ti ti-table-export"></i></button>' +
        '</div>' +
      '</div>' +
      '<div style="position:relative;margin-bottom:1rem">' +
        '<i class="ti ti-search" style="position:absolute;left:.75rem;top:50%;transform:translateY(-50%);color:var(--color-muted);font-size:.9rem"></i>' +
        '<input id="crm-search" type="search" placeholder="Søk på navn, e-post, bedrift…" ' +
          'style="width:100%;padding:.6rem .8rem .6rem 2.2rem;border:1.5px solid var(--color-border);border-radius:8px;font:inherit;font-size:.88rem;background:var(--color-bg);color:var(--color-text)">' +
      '</div>' +
      '<div id="crm-new-form"></div>' +
      (customers.length === 0
        ? '<div style="text-align:center;padding:3rem 1rem">' +
            '<i class="ti ti-users" style="font-size:2.5rem;display:block;margin-bottom:.5rem;color:var(--color-muted);opacity:.3"></i>' +
            '<p style="color:var(--color-muted);font-size:.9rem;margin:0">Ingen kunder ennå. Importeres automatisk fra skjema og bookinger.</p>' +
          '</div>'
        : '<div id="crm-list" style="display:grid;gap:.5rem">' +
            customers.map(crmRow).join("") +
          '</div>'
      );
    bindList(root);
  }

  function crmRow(c) {
    var bed    = bedriftFor(c);
    var stats  = commStats(c.id);
    var legacy = getLegacyHistory(customerEmails(c));
    var total  = legacy.length + stats.emails + stats.phones + stats.notes;
    var col    = avatarColor(c.name || c.email);
    var ini    = initials(c.name || c.email);

    var pills = [];
    if (stats.emails > 0) pills.push(pill("mail",  stats.emails + " e-post"));
    if (stats.phones > 0) pills.push(pill("phone", stats.phones + " tlf"));
    if (stats.notes  > 0) pills.push(pill("notes", stats.notes  + " notat"));
    if (stats.overdue) pills.push(
      '<span style="font-size:.7rem;font-weight:700;color:#c0392b;background:color-mix(in srgb,#c0392b 10%,transparent);' +
      'padding:.1rem .45rem;border-radius:999px;display:inline-flex;align-items:center;gap:.2rem">' +
      '<i class="ti ti-alarm"></i> Forfalt</span>'
    );

    return '<div class="admin-row" data-crm-open="' + C.esc(c.id) + '" style="cursor:pointer;gap:.75rem;align-items:center">' +
      '<div style="width:38px;height:38px;border-radius:999px;background:' + col + ';flex-shrink:0;' +
           'display:flex;align-items:center;justify-content:center;font-size:.88rem;font-weight:700;color:#fff">' +
        C.esc(ini) +
      '</div>' +
      '<div class="admin-row__main" style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;margin-bottom:.1rem">' +
          '<strong style="font-size:.92rem">' + C.esc(c.name || "(ukjent)") + '</strong>' +
          (bed ? '<span style="font-size:.72rem;color:var(--color-primary);font-weight:600">' + C.esc(bed.name) + '</span>' : '') +
          (pills.length ? '<span style="color:var(--color-border);font-size:.7rem">·</span>' + pills.join('<span style="color:var(--color-border);font-size:.7rem">·</span>') : '') +
        '</div>' +
        '<div style="font-size:.8rem;color:var(--color-muted)">' +
          C.esc(c.email || "") +
          (c.phone ? ' · ' + C.esc(c.phone) : '') +
          (total ? ' · <span>' + total + ' kontaktpunkt</span>' : '') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:.4rem;flex-shrink:0">' +
        '<a href="#/crm/' + C.esc(c.id) + '" class="btn btn--ghost btn--sm" style="font-size:.8rem" onclick="event.stopPropagation()">Åpne</a>' +
        '<button class="btn btn--ghost btn--sm" style="color:#c0392b;border-color:#c0392b;font-size:.8rem" data-crm-del="' + C.esc(c.id) + '">Slett</button>' +
      '</div>' +
    '</div>';
  }

  function pill(icon, text) {
    return '<span style="font-size:.7rem;color:var(--color-muted);display:inline-flex;align-items:center;gap:.2rem">' +
      '<i class="ti ti-' + icon + '"></i> ' + C.esc(text) + '</span>';
  }

  function bindList(root) {
    var searchInp = root.querySelector("#crm-search");
    if (searchInp) {
      searchInp.addEventListener("input", function () {
        var q = searchInp.value.toLowerCase().trim();
        root.querySelectorAll("#crm-list [data-crm-open]").forEach(function (row) {
          var id = row.getAttribute("data-crm-open");
          var c  = getCustomers().find(function (x) { return x.id === id; });
          if (!c) return;
          var b  = bedriftFor(c);
          var t  = [c.name, c.email, c.phone, c.note, b ? b.name : ""].join(" ").toLowerCase();
          row.style.display = (!q || t.indexOf(q) > -1) ? "" : "none";
        });
      });
    }
    root.querySelector("#crm-new-btn").addEventListener("click", function () { openNewForm(root); });
    root.querySelector("#crm-import-btn").addEventListener("click", function () { autoImport(); renderList(root); });
    root.querySelector("#crm-export-btn").addEventListener("click", function () {
      if (!App.downloadCsv) return;
      App.downloadCsv("kunder.csv",
        ["Navn","E-post","Kundenummer","Bedrift","Telefon","Adresse","Notat","Opprettet"],
        getCustomers().map(function (c) {
          var b = bedriftFor(c);
          return [c.name||"",c.email||"",c.customerNumber||"",b?b.name:"",c.phone||"",c.address||"",c.note||"",c.created||""];
        }));
    });
    root.querySelectorAll("[data-crm-open]").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest("[data-crm-del], a.btn")) return;
        var id = row.getAttribute("data-crm-open");
        Intranet.navigate("crm", id);
        renderDetail(root, id);
      });
    });
    root.querySelectorAll("[data-crm-del]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var id = btn.getAttribute("data-crm-del");
        var c  = getCustomers().find(function (x) { return x.id === id; });
        if (!c || !confirm("Slett all data for " + (c.name||c.email) + "? Kan ikke angres.")) return;
        setCustomers(getCustomers().filter(function (x) { return x.id !== id; }));
        Intranet.logActivity({ type: "crm_deleted", label: "Kunde slettet: " + (c.name||c.email) });
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
        '<h4 style="margin:0 0 .9rem;font-size:.95rem">Ny kunde</h4>' +
        '<div class="i-form">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">' +
            iField("crm-n-name",   "Navn",       "text",  "", "Ola Nordmann") +
            iField("crm-n-email",  "E-post *",   "email", "", "ola@bedrift.no") +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">' +
            iField("crm-n-bedrift","Bedrift",    "text",  "", "Bedrift AS") +
            iField("crm-n-phone",  "Telefon",    "tel",   "", "+47 000 00 000") +
          '</div>' +
          iField("crm-n-note", "Intern merknad", "textarea", "", "…") +
          '<div style="display:flex;gap:.5rem">' +
            '<button class="btn btn--primary btn--sm" id="crm-n-save">Legg til</button>' +
            '<button class="btn btn--ghost btn--sm" id="crm-n-cancel">Avbryt</button>' +
          '</div>' +
          '<p class="form__status" id="crm-n-status"></p>' +
        '</div>' +
      '</div>';
    wrap.querySelector("#crm-n-cancel").addEventListener("click", function () { wrap.innerHTML = ""; });
    wrap.querySelector("#crm-n-save").addEventListener("click", function () {
      var email = wrap.querySelector("#crm-n-email").value.trim();
      var st    = wrap.querySelector("#crm-n-status");
      if (!email) { st.textContent = "E-post er påkrevd."; st.className = "form__status is-err"; return; }
      var list = getCustomers();
      if (list.find(function (c) { return customerEmails(c).some(function (e) { return e.toLowerCase() === email.toLowerCase(); }); })) {
        st.textContent = "E-posten finnes allerede."; st.className = "form__status is-err"; return;
      }
      var bedInput = wrap.querySelector("#crm-n-bedrift").value.trim();
      var bed      = bedInput ? findOrCreateBedrift(bedInput) : null;
      var nums     = list.map(function (c) { return c.customerNumber; }).filter(Boolean);
      list.unshift({
        id: newCustomerId(), email: email, altEmails: [],
        name:    wrap.querySelector("#crm-n-name").value.trim(),
        phone:   wrap.querySelector("#crm-n-phone").value.trim(),
        address: "",
        note:    wrap.querySelector("#crm-n-note").value.trim(),
        created: new Date().toISOString(),
        customerNumber: App.generateUniqueNumber ? App.generateUniqueNumber(nums) : String(Date.now()),
        bedriftId: bed ? bed.id : null
      });
      setCustomers(list);
      Intranet.logActivity({ type: "crm_created", label: "Ny kunde: " + email });
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

    var bed      = bedriftFor(c);
    var emails   = customerEmails(c);
    var timeline = getTimeline(id, emails);
    var col      = avatarColor(c.name || c.email);
    var ini      = initials(c.name || c.email);

    function refresh() { renderDetail(root, id); }

    root.innerHTML =
      /* Tilbakeknapp */
      '<button class="i-topbar__back" id="crm-back" style="margin-bottom:.8rem">' +
        '<i class="ti ti-arrow-left"></i> Alle kunder' +
      '</button>' +

      /* ─── HEADER ─────────────────────────────────────────── */
      '<div class="i-card" style="margin-bottom:.75rem">' +
        '<div style="display:flex;align-items:flex-start;gap:1rem;margin-bottom:1rem">' +
          /* Avatar */
          '<div style="width:52px;height:52px;border-radius:999px;background:' + col + ';flex-shrink:0;' +
               'display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:700;color:#fff">' +
            C.esc(ini) +
          '</div>' +
          /* Info */
          '<div style="flex:1;min-width:0">' +
            '<h3 style="margin:0 0 .15rem;font-size:1.15rem;line-height:1.2">' + C.esc(c.name || c.email) + '</h3>' +
            '<div style="font-size:.82rem;color:var(--color-muted);display:flex;flex-wrap:wrap;gap:.25rem .5rem;align-items:center">' +
              (bed ? '<span>' + C.esc(bed.name) + '</span><span style="opacity:.4">·</span>' : '') +
              (c.phone ? '<a href="tel:' + C.esc(c.phone) + '" style="color:var(--color-muted)">' + C.esc(c.phone) + '</a><span style="opacity:.4">·</span>' : '') +
              '<a href="mailto:' + C.esc(c.email) + '" style="color:var(--color-muted)">' + C.esc(c.email) + '</a>' +
            '</div>' +
            '<div style="font-size:.72rem;color:var(--color-muted);margin-top:.2rem">' +
              'Kundenr. #' + C.esc(String(c.customerNumber||"")) + ' · Opprettet ' + formatDate(c.created) +
            '</div>' +
          '</div>' +
        '</div>' +
        /* Hurtighandlinger */
        '<div style="display:flex;gap:.4rem;flex-wrap:wrap;padding-top:.85rem;border-top:1px solid var(--color-border)">' +
          qaBtn("mail",        "E-post",     "crm-qa-email") +
          qaBtn("phone",       "Ring",        "crm-qa-phone") +
          qaBtn("notes",       "Notat",       "crm-qa-note") +
          qaBtn("paperclip",   "Dokument",    "crm-qa-doc") +
          qaBtn("circle-plus", "Oppgave",     "crm-qa-task") +
        '</div>' +
      '</div>' +

      /* ─── KONTAKTINFORMASJON (collapsible) ───────────────── */
      collapsible("Kontaktinformasjon", "ti-user",
        '<form class="i-form" id="crm-contact-form">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">' +
            iField("crm-d-name",   "Navn",    "text",  c.name||"",    "") +
            iField("crm-d-email",  "E-post",  "email", c.email||"",   "") +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">' +
            iField("crm-d-bedrift","Bedrift", "text",  bed?bed.name:"","Bedrift AS") +
            iField("crm-d-phone",  "Telefon", "tel",   c.phone||"",   "+47 000 00 000") +
          '</div>' +
          iField("crm-d-address","Adresse",   "text",  c.address||"", "Gateveien 1, 0001 Oslo") +
          iField("crm-d-note",   "Intern merknad","textarea",c.note||"","…") +
          (c.altEmails && c.altEmails.length
            ? '<p style="font-size:.78rem;color:var(--color-muted);margin:.2rem 0 0">Andre e-post: ' +
                c.altEmails.map(function(e){return C.esc(e);}).join(", ") + '</p>'
            : "") +
          '<div style="display:flex;gap:.5rem;align-items:center;margin-top:.3rem">' +
            '<button type="submit" class="btn btn--primary btn--sm">Lagre endringer</button>' +
            '<button type="button" class="btn btn--danger btn--sm" id="crm-d-del" style="margin-left:auto">Slett kunde</button>' +
            '<span class="form__status" id="crm-d-status" style="font-size:.85rem"></span>' +
          '</div>' +
        '</form>'
      ) +

      /* ─── TIDSLINJE ──────────────────────────────────────── */
      '<div class="i-card" style="margin-bottom:.75rem">' +
        '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.85rem">' +
          '<p class="i-section-label" style="margin:0;flex:1">Tidslinje</p>' +
          (timeline.length
            ? '<span style="background:var(--color-primary);color:#fff;border-radius:999px;font-size:.65rem;' +
              'padding:.1rem .42rem;font-weight:700">' + timeline.length + '</span>'
            : '') +
        '</div>' +
        (timeline.length === 0
          ? '<p style="font-size:.85rem;color:var(--color-muted);text-align:center;padding:1.5rem 0;margin:0">' +
              'Ingen aktivitet ennå — bruk hurtighandlingene over for å logge første kontakt.' +
            '</p>'
          : '<div>' + timeline.map(tlItem).join("") + '</div>'
        ) +
      '</div>' +

      /* ─── AI (mockup) ────────────────────────────────────── */
      aiPanel();

    /* ─── EVENT-BINDING ──────────────────────────────────── */
    root.querySelector("#crm-back").addEventListener("click", function () {
      Intranet.navigate("crm"); renderList(root);
    });

    /* Hurtighandlinger */
    function qa(id, fn) {
      var btn = root.querySelector("[data-qa='" + id + "']");
      if (btn) btn.addEventListener("click", fn);
    }
    qa("crm-qa-email", function () { openEmailDrawer(c, refresh); });
    qa("crm-qa-phone", function () { openPhoneNoteDrawer(c, refresh); });
    qa("crm-qa-note",  function () { openInternalNoteDrawer(c, refresh); });
    qa("crm-qa-doc",   function () { openDocumentDrawer(c, refresh); });
    qa("crm-qa-task",  function () { openTaskDrawer(c, refresh); });

    /* Kontaktinfo-lagre */
    var form = root.querySelector("#crm-contact-form");
    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      var idx = customers.findIndex(function (x) { return x.id === id; });
      if (idx < 0) return;
      var bedInput = root.querySelector("#crm-d-bedrift").value.trim();
      customers[idx] = Object.assign({}, customers[idx], {
        name:     root.querySelector("#crm-d-name").value.trim(),
        email:    root.querySelector("#crm-d-email").value.trim(),
        phone:    root.querySelector("#crm-d-phone").value.trim(),
        address:  root.querySelector("#crm-d-address").value.trim(),
        note:     root.querySelector("#crm-d-note").value.trim(),
        bedriftId: bedInput ? findOrCreateBedrift(bedInput).id : null
      });
      setCustomers(customers);
      Intranet.logActivity({ type: "crm_updated", label: "Kunde oppdatert: " + customers[idx].name });
      var st = root.querySelector("#crm-d-status");
      st.textContent = "Lagret."; st.className = "form__status is-ok";
      setTimeout(function () { if (st) st.textContent = ""; refresh(); }, 900);
    });

    /* Slett kunde */
    var delBtn = root.querySelector("#crm-d-del");
    if (delBtn) delBtn.addEventListener("click", function () {
      if (!confirm("Slett all data for " + (c.name||c.email) + "? Kan ikke angres.")) return;
      setCustomers(getCustomers().filter(function (x) { return x.id !== id; }));
      Intranet.navigate("crm"); renderList(root);
    });

    /* Slett comm-hendelse */
    root.querySelectorAll("[data-del-comm]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!confirm("Fjern denne hendelsen?")) return;
        deleteComm(btn.getAttribute("data-del-comm"));
        refresh();
      });
    });

    /* Oppgave — fullfør */
    root.querySelectorAll("[data-task-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var cid = btn.getAttribute("data-task-toggle");
        updateComm(cid, { done: true });
        refresh();
      });
    });
  }

  /* =========================================================================
     HJELPERAR FOR DETALJ-RENDERING
     ====================================================================== */
  function iField(id, label, type, value, placeholder) {
    var isTA = type === "textarea";
    var inp  = isTA
      ? '<textarea id="' + id + '" rows="2" placeholder="' + C.esc(placeholder||"") + '" ' +
          'style="width:100%;font:inherit;font-size:.9rem;padding:.6rem .8rem;border:1.5px solid var(--color-border);' +
                 'border-radius:8px;background:var(--color-bg);color:var(--color-text);resize:vertical">' + C.esc(value||"") + '</textarea>'
      : '<input id="' + id + '" type="' + type + '" value="' + C.esc(value||"") + '" placeholder="' + C.esc(placeholder||"") + '" ' +
          'style="width:100%;font:inherit;font-size:.9rem;padding:.6rem .8rem;border:1.5px solid var(--color-border);' +
                 'border-radius:8px;background:var(--color-bg);color:var(--color-text)">';
    return '<div class="i-field"><label for="' + id + '">' + C.esc(label) + '</label>' + inp + '</div>';
  }

  function qaBtn(icon, label, qaId) {
    return '<button data-qa="' + qaId + '" ' +
      'style="display:inline-flex;align-items:center;gap:.35rem;padding:.45rem .85rem;' +
             'border:1.5px solid var(--color-border);border-radius:999px;background:transparent;' +
             'cursor:pointer;font:inherit;font-size:.82rem;font-weight:600;color:var(--color-text);' +
             'transition:all .15s" ' +
      'onmouseover="this.style.background=\'var(--color-tint)\';this.style.borderColor=\'var(--color-primary)\'" ' +
      'onmouseout="this.style.background=\'transparent\';this.style.borderColor=\'var(--color-border)\'">' +
      '<i class="ti ti-' + icon + '" style="font-size:.9rem;color:var(--color-primary)"></i> ' + C.esc(label) +
    '</button>';
  }

  function collapsible(title, iconClass, bodyHtml) {
    return '<div class="i-card" style="margin-bottom:.75rem">' +
      '<details>' +
        '<summary style="list-style:none;cursor:pointer;display:flex;align-items:center;gap:.5rem;' +
                        'outline:none;-webkit-tap-highlight-color:transparent" ' +
                 'onfocus="this.style.outline=\'none\'">' +
          '<i class="ti ' + iconClass + '" style="color:var(--color-primary);font-size:.95rem"></i>' +
          '<span class="i-section-label" style="margin:0;flex:1">' + C.esc(title) + '</span>' +
          '<i class="ti ti-chevron-right" style="font-size:.85rem;color:var(--color-muted);transition:transform .2s"></i>' +
        '</summary>' +
        '<div style="margin-top:.9rem">' + bodyHtml + '</div>' +
      '</details>' +
    '</div>';
  }

  function tlItem(item) {
    var conf   = TL_CONF[item.type] || TL_CONF["default"];
    var time   = formatTimeAgo(item.created);
    var isComm = item.source === "comm";

    /* Bygg preview-tekst basert på type */
    var body = "";
    if      (item.type === "phone_note")    body = [item.duration ? "Varighet: " + item.duration : "", item.note].filter(Boolean).join(" · ");
    else if (item.type === "internal_note") body = item.text || "";
    else if (item.type === "email_sent" || item.type === "email_received") body = item.subject ? "Emne: " + item.subject : "";
    else if (item.type === "document")      body = item.docType ? item.docType : "";
    else if (item.type === "task")          body = item.dueDate ? "Frist: " + item.dueDate : item.note || "";
    else                                    body = item.body || "";

    /* Tagg-badge (interne notat / oppgave-status) */
    var tagBadge = "";
    if (item.type === "internal_note" && item.tag && item.tag !== "normal") {
      var tc = { important: "var(--color-primary)", followup: "#E8833A" };
      var tl = { important: "Viktig", followup: "Oppfølging" };
      tagBadge = ' <span style="font-size:.68rem;font-weight:700;padding:.1rem .4rem;border-radius:999px;' +
        'background:color-mix(in srgb,' + (tc[item.tag]||"var(--color-muted)") + ' 14%,transparent);' +
        'color:' + (tc[item.tag]||"var(--color-muted)") + '">' + C.esc(tl[item.tag]||item.tag) + '</span>';
    }
    if (item.type === "task" && item.done) {
      tagBadge = ' <span style="font-size:.68rem;font-weight:700;padding:.1rem .4rem;border-radius:999px;' +
        'background:color-mix(in srgb,#27AE60 12%,transparent);color:#27AE60">Ferdig ✓</span>';
    }

    /* Statuskort for legacy (leads/bookings) */
    var statusBadge = "";
    if (item.source === "legacy" && item.status) {
      var sc = { ny:"var(--color-muted)", lest:"var(--color-secondary)", løst:"#2a7a2a" };
      var sl = { ny:"Ny", lest:"Lest", løst:"Løst" };
      statusBadge = ' <span style="font-size:.68rem;font-weight:700;padding:.1rem .4rem;border-radius:999px;' +
        'background:color-mix(in srgb,' + (sc[item.status]||"var(--color-muted)") + ' 14%,transparent);' +
        'color:' + (sc[item.status]||"var(--color-muted)") + '">' + C.esc(sl[item.status]||item.status) + '</span>';
    }

    return '<div style="display:flex;gap:.7rem;padding:.75rem 0;border-bottom:1px solid var(--color-border)">' +
      /* Ikon-sirkel */
      '<div style="flex-shrink:0;margin-top:.1rem">' +
        '<div style="width:30px;height:30px;border-radius:999px;display:flex;align-items:center;justify-content:center;' +
             'background:color-mix(in srgb,' + conf.color + ' 14%,var(--color-bg));' +
             'border:1.5px solid color-mix(in srgb,' + conf.color + ' 30%,transparent)">' +
          '<i class="ti ti-' + conf.icon + '" style="font-size:.8rem;color:' + conf.color + '"></i>' +
        '</div>' +
      '</div>' +
      /* Innhald */
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">' +
          '<div style="min-width:0;line-height:1.4">' +
            '<span style="font-size:.88rem;font-weight:600">' + C.esc(item.title || conf.label) + '</span>' +
            tagBadge + statusBadge +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:.3rem;flex-shrink:0;margin-top:.05rem">' +
            (item.type === "task" && !item.done && isComm
              ? '<button data-task-toggle="' + C.esc(item.id) + '" ' +
                  'style="font-size:.72rem;padding:.1rem .4rem;border:1.5px solid var(--color-border);' +
                         'border-radius:6px;background:none;cursor:pointer;color:var(--color-muted)">Fullfør</button>'
              : '') +
            (isComm
              ? '<button data-del-comm="' + C.esc(item.id) + '" ' +
                  'style="background:none;border:0;cursor:pointer;color:var(--color-muted);padding:.1rem;' +
                         'line-height:1;opacity:.4;font-size:.9rem" title="Fjern hendelse">' +
                  '<i class="ti ti-x"></i></button>'
              : '') +
            '<span style="font-size:.72rem;color:var(--color-muted);white-space:nowrap">' + C.esc(time) + '</span>' +
          '</div>' +
        '</div>' +
        (body
          ? '<div style="font-size:.8rem;color:var(--color-muted);margin-top:.2rem;line-height:1.5;' +
              'overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">' +
              C.esc(body) + '</div>'
          : '') +
        '<span style="display:inline-block;margin-top:.3rem;font-size:.68rem;font-weight:600;padding:.1rem .4rem;' +
             'border-radius:999px;background:var(--color-alt);color:var(--color-muted)">' + C.esc(conf.label) + '</span>' +
      '</div>' +
    '</div>';
  }

  function aiPanel() {
    return '<div class="i-card" style="margin-bottom:.75rem">' +
      '<div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.85rem">' +
        '<div style="width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#6366f1,#8b5cf6);' +
             'display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<i class="ti ti-sparkles" style="font-size:.75rem;color:#fff"></i>' +
        '</div>' +
        '<p class="i-section-label" style="margin:0;flex:1">AI-assistent</p>' +
        '<span style="font-size:.68rem;font-weight:700;padding:.1rem .4rem;border-radius:999px;' +
             'background:var(--color-alt);color:var(--color-muted)">Kommer snart</span>' +
      '</div>' +
      '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.75rem">' +
        ['Oppsummer kunden','Lag svarutkast','Hva er status?','Neste anbefaling'].map(function (l) {
          return '<button disabled style="display:inline-flex;align-items:center;gap:.3rem;padding:.4rem .8rem;' +
            'border:1.5px solid var(--color-border);border-radius:999px;background:transparent;' +
            'cursor:not-allowed;font:inherit;font-size:.8rem;font-weight:600;color:var(--color-muted);opacity:.55">' +
            '<i class="ti ti-sparkles" style="font-size:.78rem"></i> ' + C.esc(l) + '</button>';
        }).join("") +
      '</div>' +
      '<div style="background:var(--color-alt);border-radius:8px;padding:.7rem .9rem;font-size:.82rem;' +
           'color:var(--color-muted);line-height:1.5">' +
        'AI-assistenten aktiveres når du kobler til en AI-leverandør under Innstillinger.' +
      '</div>' +
    '</div>';
  }

  /* =========================================================================
     DRAWER-FORMS
     ====================================================================== */
  function drwField(id, label, type, value, placeholder, extra) {
    var isTA = type === "textarea";
    var inp  = isTA
      ? '<textarea id="' + id + '" rows="3" placeholder="' + C.esc(placeholder||"") + '" ' + (extra||"") + ' ' +
          'style="width:100%;font:inherit;font-size:.9rem;padding:.6rem .8rem;' +
                 'border:1.5px solid var(--color-border);border-radius:8px;' +
                 'background:var(--color-bg);color:var(--color-text);resize:vertical">' + C.esc(value||"") + '</textarea>'
      : '<input id="' + id + '" type="' + type + '" value="' + C.esc(value||"") + '" ' +
          'placeholder="' + C.esc(placeholder||"") + '" ' + (extra||"") + ' ' +
          'style="width:100%;font:inherit;font-size:.9rem;padding:.6rem .8rem;' +
                 'border:1.5px solid var(--color-border);border-radius:8px;background:var(--color-bg);color:var(--color-text)">';
    return '<div style="display:grid;gap:.3rem"><label for="' + id + '" style="font-size:.85rem;font-weight:600">' +
      C.esc(label) + '</label>' + inp + '</div>';
  }

  // Delt openReplyModal — respekterer crmFull identisk med Web-admin og med
  // Kontakt/Booking/Tilbud (docs/decisions/ADR-0002, arkitektnotat 2026-07-01).
  function openEmailDrawer(c, refresh) {
    var threadId = newThreadId();
    App.openReplyModal({
      name: c.name, email: c.email,
      subject: "",
      templateKey: "crm",
      defaultTemplate: "",
      onSent: function (payload) {
        addComm({ customerId: c.id, type: "email_sent", title: payload.subject,
          subject: payload.subject, body: (payload.plain || "").slice(0, 200), html: payload.html || "",
          to: payload.to_email, threadId: threadId });
        Intranet.logActivity({ type: "crm_email", label: "E-post sendt: " + (c.name || c.email) });
        refresh();
      }
    });
  }

  function openPhoneNoteDrawer(c, refresh) {
    Intranet.openDrawer({
      title:    "Registrer telefonsamtale",
      bodyHtml:
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.6rem">' +
          drwField("drw-ph-date",     "Dato",        "date", todayISO(), "") +
          drwField("drw-ph-time",     "Klokkeslett", "time", nowTime(),  "") +
          drwField("drw-ph-duration", "Varighet",    "text", "",         "f.eks. 10 min") +
        '</div>' +
        drwField("drw-ph-contact", "Kontaktperson", "text",     c.name||"", c.email||"") +
        drwField("drw-ph-note",    "Notat",          "textarea", "",         "Hva ble diskutert?") +
        drwField("drw-ph-followup","Oppfølging (valgfritt)", "textarea", "", "Notér oppfølging…"),
      footHtml:
        '<button class="btn btn--primary" id="drw-ph-save">Lagre</button>' +
        '<button class="btn btn--ghost"   id="drw-ph-cancel">Avbryt</button>',
      onMount: function (dr) {
        dr.querySelector("#drw-ph-cancel").addEventListener("click", Intranet.closeDrawer);
        dr.querySelector("#drw-ph-save").addEventListener("click", function () {
          var contact  = dr.querySelector("#drw-ph-contact").value.trim();
          var duration = dr.querySelector("#drw-ph-duration").value.trim();
          addComm({
            customerId: c.id,
            type:       "phone_note",
            title:      "Telefonsamtale" + (contact ? " med " + contact : ""),
            callDate:   dr.querySelector("#drw-ph-date").value,
            callTime:   dr.querySelector("#drw-ph-time").value,
            duration:   duration,
            contact:    contact,
            note:       dr.querySelector("#drw-ph-note").value.trim(),
            followup:   dr.querySelector("#drw-ph-followup").value.trim()
          });
          Intranet.logActivity({ type: "crm_phone", label: "Telefonnotat: " + (c.name||c.email) });
          Intranet.closeDrawer(); refresh();
        });
      }
    });
  }

  function openInternalNoteDrawer(c, refresh) {
    var TAGS = [
      { id: "normal",    label: "Normal",     color: "var(--color-border)", active: true },
      { id: "important", label: "Viktig",     color: "var(--color-primary)", active: false },
      { id: "followup",  label: "Oppfølging", color: "#E8833A", active: false }
    ];

    function tagBtnHtml(t) {
      return '<button type="button" data-note-tag="' + t.id + '" ' +
        'style="padding:.35rem .85rem;border-radius:999px;font:inherit;font-size:.82rem;font-weight:600;cursor:pointer;' +
               'border:1.5px solid ' + (t.active ? t.color : "var(--color-border)") + ';' +
               'background:' + (t.active ? "color-mix(in srgb," + t.color + " 12%,transparent)" : "transparent") + ';' +
               'color:' + (t.active ? t.color : "var(--color-muted)") + '">' + C.esc(t.label) + '</button>';
    }

    Intranet.openDrawer({
      title:    "Internt notat",
      bodyHtml:
        drwField("drw-note-text", "Notat", "textarea", "", "Skriv notatet her…") +
        '<div style="display:grid;gap:.3rem;margin-top:.6rem">' +
          '<label style="font-size:.85rem;font-weight:600">Type</label>' +
          '<div style="display:flex;gap:.4rem;flex-wrap:wrap">' + TAGS.map(tagBtnHtml).join("") + '</div>' +
        '</div>',
      footHtml:
        '<button class="btn btn--primary" id="drw-note-save">Lagre</button>' +
        '<button class="btn btn--ghost"   id="drw-note-cancel">Avbryt</button>',
      onMount: function (dr) {
        var selectedTag = "normal";
        dr.querySelectorAll("[data-note-tag]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            selectedTag = btn.getAttribute("data-note-tag");
            var tagConf = TAGS.find(function (t) { return t.id === selectedTag; });
            var col     = tagConf ? tagConf.color : "var(--color-border)";
            dr.querySelectorAll("[data-note-tag]").forEach(function (b) {
              var active = b === btn;
              b.style.borderColor = active ? col : "var(--color-border)";
              b.style.background  = active ? "color-mix(in srgb," + col + " 12%,transparent)" : "transparent";
              b.style.color       = active ? col : "var(--color-muted)";
            });
          });
        });
        dr.querySelector("#drw-note-cancel").addEventListener("click", Intranet.closeDrawer);
        dr.querySelector("#drw-note-save").addEventListener("click", function () {
          var text = dr.querySelector("#drw-note-text").value.trim();
          if (!text) { dr.querySelector("#drw-note-text").focus(); return; }
          addComm({
            customerId: c.id, type: "internal_note",
            title: text.slice(0, 70) + (text.length > 70 ? "…" : ""),
            text: text, tag: selectedTag
          });
          Intranet.logActivity({ type: "crm_note", label: "Notat: " + (c.name||c.email) });
          Intranet.closeDrawer(); refresh();
        });
      }
    });
  }

  function openDocumentDrawer(c, refresh) {
    var DOC_TYPES = ["Kontrakt","Tilbud","Ordrebekreftelse","Tegning","PDF","Bilde","Annet"];
    Intranet.openDrawer({
      title:    "Legg til dokument",
      bodyHtml:
        drwField("drw-doc-name", "Navn *", "text", "", "f.eks. Kontrakt Q1 2025") +
        '<div style="display:grid;gap:.3rem;margin-top:.6rem">' +
          '<label for="drw-doc-type" style="font-size:.85rem;font-weight:600">Type</label>' +
          '<select id="drw-doc-type" style="font:inherit;font-size:.9rem;padding:.6rem .8rem;' +
            'border:1.5px solid var(--color-border);border-radius:8px;background:var(--color-bg);color:var(--color-text)">' +
            DOC_TYPES.map(function (t) { return '<option>' + C.esc(t) + '</option>'; }).join("") +
          '</select>' +
        '</div>' +
        drwField("drw-doc-note", "Notat (valgfritt)", "textarea", "", "…") +
        '<p style="font-size:.75rem;color:var(--color-muted);margin:.6rem 0 0">' +
          '<i class="ti ti-info-circle"></i> Filopplasting via mediebank kommer i neste versjon.</p>',
      footHtml:
        '<button class="btn btn--primary" id="drw-doc-save">Lagre</button>' +
        '<button class="btn btn--ghost"   id="drw-doc-cancel">Avbryt</button>',
      onMount: function (dr) {
        dr.querySelector("#drw-doc-cancel").addEventListener("click", Intranet.closeDrawer);
        dr.querySelector("#drw-doc-save").addEventListener("click", function () {
          var name = dr.querySelector("#drw-doc-name").value.trim();
          if (!name) { dr.querySelector("#drw-doc-name").focus(); return; }
          var docType = dr.querySelector("#drw-doc-type").value;
          addComm({
            customerId: c.id, type: "document", title: name,
            docType: docType, note: dr.querySelector("#drw-doc-note").value.trim()
          });
          Intranet.logActivity({ type: "crm_doc", label: "Dokument: " + (c.name||c.email) });
          Intranet.closeDrawer(); refresh();
        });
      }
    });
  }

  function openTaskDrawer(c, refresh) {
    Intranet.openDrawer({
      title:    "Ny oppgave for " + (c.name || c.email),
      bodyHtml:
        drwField("drw-task-title", "Oppgave *", "text",     "", "f.eks. Ring kunden fredag") +
        drwField("drw-task-due",   "Frist",     "date",     "", "") +
        drwField("drw-task-note",  "Notat",     "textarea", "", "…"),
      footHtml:
        '<button class="btn btn--primary" id="drw-task-save">Lagre oppgave</button>' +
        '<button class="btn btn--ghost"   id="drw-task-cancel">Avbryt</button>',
      onMount: function (dr) {
        dr.querySelector("#drw-task-cancel").addEventListener("click", Intranet.closeDrawer);
        dr.querySelector("#drw-task-save").addEventListener("click", function () {
          var title = dr.querySelector("#drw-task-title").value.trim();
          if (!title) { dr.querySelector("#drw-task-title").focus(); return; }
          addComm({
            customerId: c.id, type: "task", title: title,
            dueDate: dr.querySelector("#drw-task-due").value,
            note:    dr.querySelector("#drw-task-note").value.trim(),
            done:    false
          });
          Intranet.logActivity({ type: "crm_task", label: "Oppgave: " + (c.name||c.email) });
          Intranet.closeDrawer(); refresh();
        });
      }
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
