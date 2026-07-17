/* =============================================================================
   module-crm.js  —  KUNDER / CRM  v4
   -----------------------------------------------------------------------------
   Selvstendig IIFE. Fungerer fullt utan Workspace.
   Dual-registrerer for både Web-admin (App.registerModule) og Workspace
   (window.Intranet.registerModule) — den tidlegare intranet/module-crm.js
   var ein separat, daud kopi, sletta 2026-07-06 (sjå docs/project/CURRENT_STATE.md).
   Nøklane under er felles for begge overflatene via same tabellar:
     crm-customers · crm-bedrifter · crm-comms · crm-settings

   Nytt i v4:
   - Teksteditor = C.richTextField + App.ui (identisk med Aktuelt)
   - Bedrifter som eigen fane med fullt bedriftskort
   - Auto-import av bedrift frå tilbudsforespørslar
   - E-postsignatur (bedrift + personleg)
   - E-posttråd (threadId, "Svar"-knapp)
   - Tab-badges for chat og nye henvendingar (core.js)
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App, C = window.Components;
  if (!App || !C) return;

  App.ready(function (CFG) {
  if (CFG.features && CFG.features.crm === false) return;

  var esc = C.esc;

  /* =========================================================================
     NØKLAR + TILSTAND
     ====================================================================== */
  var CUST_KEY     = "crm-customers"; // FØR 2026-07-03: no berre brukt som localStorage-fallback-nøkkel når Supabase ikkje er konfigurert, og som éin-gongs migreringskjelde. Ekte data ligg i crm_customers-tabellen.
  var BEDRIFT_KEY  = "crm-bedrifter"; // same som over, for crm_bedrifter
  var COMMS_KEY    = "crm-comms";     // same som over, for crm_comms
  var SETTINGS_KEY = "crm-settings";  // uendra — malar/snippets/signaturar, ingen PII, vert verande i store

  var _sb = App.supabase;
  var _customers = [];
  var _bedrifter = [];
  var _comms     = [];

  var crmSubView = "kontaktar"; // "kontaktar" | "bedrifter"
  var _pendingCrmOpen = null; // sett frå chat-modul via window.CrmAdmin

  // Member har full CRM-tilgang (opprette/redigere kundar, bedrifter, malar,
  // snippets, signaturar) — unntaka er CSV-eksport av heile kundelista og
  // sletting av kundar/bedrifter/kommunikasjon (server-sida krev
  // can_edit_content(), sjå crm_customers_delete/crm_bedrifter_delete/
  // crm_comms_delete i migration.sql).
  //
  // VIKTIG (retta 2026-07-03, funne via live sluttest): Web-admin autentiserer
  // OGSÅ mot ekte Supabase Auth (same users.role-oppslag som Workspace) i
  // alle konfigurerte kundeinstallasjonar — det "delte admin-passordet" er
  // berre ein fallback for lokalt/test-miljø utan Supabase (sjå
  // renderAdminLogin() i core.js). Den forrige versjonen av denne
  // funksjonen sjekka BERRE window.Intranet (som ikkje finst på Web-admin-
  // sida i det heile), og trudde difor feilaktig at Web-admin aldri kunne
  // ha ein innlogga "member" — som gjorde at CSV-eksport og slett-knappar
  // synte for member også på Web-admin, sjølv om server-sida (RLS) korrekt
  // avviste dei faktiske skrive-/slettekalla. App.getAuthRole() les rolla
  // frå sessionStorage, som er sett likt på begge flatene.
  function isWorkspaceMember() {
    if (window.App && typeof window.App.getAuthRole === "function") {
      var role = window.App.getAuthRole();
      if (role) return role === "member";
    }
    return !!(window.Intranet && window.Intranet.getContext && window.Intranet.getContext().role === "member");
  }

  window.CrmAdmin = {
    openCustomer: function (id) { _pendingCrmOpen = id; },
    logEmailSent: function (opts) {
      var email = (opts.email || "").toLowerCase();
      var customer = getCustomers().find(function (c) { return (c.email || "").toLowerCase() === email; });
      if (!customer) return;
      addComm({ customerId: customer.id, type: "email_sent", title: opts.subject || "E-post sendt", subject: opts.subject || "", body: (opts.plain || "").slice(0, 200), to: opts.email });
    },
    // Synkrone lesarar av den lokale cachen (fylt av loadCrmData(), kalla
    // proaktivt ved modul-oppstart under, ikkje berre når Kunder-fana opnast)
    // — brukt av core.js sitt dashboard, GDPR-sletting, søk/analyse og CSV-
    // eksport, som elles las crm-customers/crm-bedrifter direkte frå store,
    // og difor ville fått frose/forelda data etter at desse nøklane vart
    // flytta ut av store 2026-07-03.
    getCustomers: function () { return getCustomers(); },
    getBedrifter: function () { return getBedrifter(); },
    // Brukt av core.js sin GDPR-sletting ("slett alt for e-post"). Returnerer
    // talet på sletta kundar (same kontrakt som den gamle Store.get/set-baserte
    // koden i core.js hadde, som rekna differansen sjølv).
    deleteCustomersByEmail: function (email) {
      var e = (email || "").toLowerCase();
      var matches = getCustomers().filter(function (c) { return (c.email || "").toLowerCase() === e; });
      matches.forEach(function (c) { deleteCustomer(c.id); });
      return matches.length;
    },
    // Eksponerer dei reine JS<->DB-feltmappingsfunksjonane for testing (sjå
    // test.js "CRM: feltmapping Supabase<->JS"). Desse vert ALDRI kalla via
    // ekte nettverkskall i testmiljøet (App.supabase er ikkje konfigurert i
    // jsdom, og _sb vert uansett berre fanga éin gong ved modul-oppstart —
    // sjå kommentaren over loadCrmData()) — testane over verifiserer difor
    // berre at mappinga sjølv er korrekt og round-trip-trygg, ikkje at det
    // faktiske nettverkskallet fungerer.
    _test: {
      dbCustomerToJs: dbCustomerToJs, jsCustomerToDb: jsCustomerToDb,
      dbBedriftToJs:  dbBedriftToJs,  jsBedriftToDb:  jsBedriftToDb,
      dbCommToJs:     dbCommToJs,     jsCommToDb:     jsCommToDb,
      isSafeAttachmentUrl: isSafeAttachmentUrl
    }
  };

  /* =========================================================================
     INNSTILLINGAR
     ====================================================================== */
  function getCrmSettings() {
    return Object.assign({ signatureCompany:"", signaturePersonal:"", templates:[], snippets:[] },
      App.store.get(SETTINGS_KEY, {}) || {});
  }
  function saveCrmSettings(v) { App.store.set(SETTINGS_KEY, v); }

  function saveTemplate(t) {
    var s=getCrmSettings(), arr=s.templates||[];
    var i=arr.findIndex(function(x){return x.id===t.id;}); if(i>=0) arr[i]=t; else arr.push(t);
    saveCrmSettings(Object.assign(s,{templates:arr}));
  }
  function deleteTemplate(id) { var s=getCrmSettings(); saveCrmSettings(Object.assign(s,{templates:(s.templates||[]).filter(function(t){return t.id!==id;})})); }
  function saveSnippet(sn) {
    var s=getCrmSettings(), arr=s.snippets||[];
    var i=arr.findIndex(function(x){return x.id===sn.id;}); if(i>=0) arr[i]=sn; else arr.push(sn);
    saveCrmSettings(Object.assign(s,{snippets:arr}));
  }
  function deleteSnippet(id) { var s=getCrmSettings(); saveCrmSettings(Object.assign(s,{snippets:(s.snippets||[]).filter(function(x){return x.id!==id;})})); }

  /* =========================================================================
     DATALAG — crm_bedrifter/crm_customers/crm_comms i Supabase, med
     localStorage-fallback (CUST_KEY/BEDRIFT_KEY/COMMS_KEY) når Supabase ikkje
     er konfigurert. _customers/_bedrifter/_comms er synkrone lokale cache-
     array fylt éin gong av loadCrmData() ved oppstart — same mønster som
     _tasks i workspace/module-tasks.js. getX()-funksjonane under les berre frå
     cachen og gjer ALDRI eit nettverkskall sjølv, så all eksisterande
     rendering-kode som kallar getCustomers()/getBedrifter()/getComms()
     synkront held fram uendra. Flytta ut av store 2026-07-03 (retta CRITICAL-
     funnet om ubetinga anon-SELECT på heile store-tabellen).
     ====================================================================== */
  function dbCustomerToJs(row) {
    return { id: row.id, email: row.email || "", altEmails: row.alt_emails || [], name: row.name || "",
      phone: row.phone || "", address: row.address || "", note: row.note || "",
      created: row.created_at, customerNumber: row.customer_number, bedriftId: row.bedrift_id };
  }
  function jsCustomerToDb(c) {
    return { email: c.email || "", alt_emails: c.altEmails || [], name: c.name || "", phone: c.phone || "",
      address: c.address || "", note: c.note || "", customer_number: c.customerNumber || null,
      bedrift_id: c.bedriftId || null };
  }
  function dbBedriftToJs(row) {
    return { id: row.id, name: row.name || "", customerNumber: row.customer_number, orgNr: row.org_nr || "",
      website: row.website || "", phone: row.phone || "", address: row.address || "",
      invoiceEmail: row.invoice_email || "", invoiceAddress: row.invoice_address || "", note: row.note || "",
      created: row.created_at };
  }
  function jsBedriftToDb(b) {
    return { name: b.name || "", customer_number: b.customerNumber || null, org_nr: b.orgNr || "",
      website: b.website || "", phone: b.phone || "", address: b.address || "",
      invoice_email: b.invoiceEmail || "", invoice_address: b.invoiceAddress || "", note: b.note || "" };
  }
  // crm_comms er polymorf (sjå migration.sql) — kjende kolonnar (customerId/
  // type/title) er ekte felt, resten (subject/body/to/threadId/callDate/...)
  // ligg samla i `data` jsonb. Framtidige nye comm-typar/felt treng ingen
  // endring her, dei hamnar automatisk i `data`.
  function dbCommToJs(row) {
    return Object.assign({ id: row.id, customerId: row.customer_id, type: row.type, title: row.title,
      created: row.created_at }, row.data || {});
  }
  function jsCommToDb(data) {
    // id/created er handsama separat (som id/created_at-kolonnar) av kallaren
    // (addComm/updateComm) — må ekskluderast her óg, elles hamnar dei
    // DUPLISERT inni `data` jsonb-en i tillegg til dei ekte kolonnane.
    var known = { id: 1, created: 1, customerId: 1, type: 1, title: 1 };
    var extra = {};
    Object.keys(data).forEach(function (k) { if (!known[k]) extra[k] = data[k]; });
    return { customer_id: data.customerId, type: data.type, title: data.title || null, data: extra };
  }

  // Skriving er write-through/fire-and-forget (sjå kommentar ved createCustomer
  // under) — .catch() her endrar ikkje den åtferda, det gjer berre at ein
  // mislykka skriving synest i konsollen i staden for å forsvinne heilt stille
  // (tidlegare symptom: optimistisk lokal endring ser ut til å fungere, men
  // forsvinn att ved neste refresh, jf. produksjonsbuggen 3e841e1).
  function logWriteError(action, err) { console.error("[CRM] " + action + " feilet:", err); }

  function loadCrmData(cb) {
    if (!_sb) {
      _bedrifter = App.store.get(BEDRIFT_KEY, []) || [];
      _customers = App.store.get(CUST_KEY, []) || [];
      _comms     = App.store.get(COMMS_KEY, []) || [];
      cb && cb();
      return;
    }
    var pending = 3;
    function done() { if (--pending === 0) cb && cb(); }
    _sb.from("crm_bedrifter").select("*").then(function (r) { _bedrifter = (r.data || []).map(dbBedriftToJs); done(); });
    _sb.from("crm_customers").select("*").then(function (r) { _customers = (r.data || []).map(dbCustomerToJs); done(); });
    _sb.from("crm_comms").select("*").order("created_at", { ascending: false }).then(function (r) { _comms = (r.data || []).map(dbCommToJs); done(); });
  }

  /* =========================================================================
     KUNDAR
     ====================================================================== */
  function getCustomers() { return _customers; }

  // Synkron retur + fire-and-forget Supabase-skriving i bakgrunnen — same
  // filosofi som App.store.set() (write-through, ikkje ventа på), berre for
  // eit einskild rad i staden for ein heil JSON-blob. Klienten genererer IDen
  // (text, ikkje uuid — sjå migration.sql), så me treng ikkje ein tur-retur
  // for å få ho, og all eksisterande synkron kallar-kode (t.d.
  // findOrCreateBedrift() sin bruk av det tilsvarande bedrift-mønsteret)
  // held fram uendra.
  function createCustomer(data) {
    var c = Object.assign({ id: "cust-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), created: new Date().toISOString() }, data);
    _customers.unshift(c);
    if (_sb) _sb.from("crm_customers").insert(Object.assign(jsCustomerToDb(c), { id: c.id, created_at: c.created })).then(function () {}).catch(function (err) { logWriteError("opprette kunde", err); });
    else App.store.set(CUST_KEY, _customers);
    return c;
  }
  function updateCustomer(id, patch) {
    var idx = _customers.findIndex(function (c) { return c.id === id; });
    if (idx >= 0) Object.assign(_customers[idx], patch);
    if (_sb) _sb.from("crm_customers").update(jsCustomerToDb(idx >= 0 ? _customers[idx] : patch)).eq("id", id).then(function () {}).catch(function (err) { logWriteError("oppdatere kunde", err); });
    else App.store.set(CUST_KEY, _customers);
  }
  function deleteCustomer(id) {
    _customers = _customers.filter(function (c) { return c.id !== id; });
    if (_sb) _sb.from("crm_customers").delete().eq("id", id).then(function () {}).catch(function (err) { logWriteError("slette kunde", err); });
    else App.store.set(CUST_KEY, _customers);
  }
  function customerEmails(c) { return [c.email].concat(c.altEmails || []).filter(Boolean); }

  /* =========================================================================
     BEDRIFTER
     ====================================================================== */
  function getBedrifter() { return _bedrifter; }
  function bedriftFor(c) {
    if (!c || !c.bedriftId) return null;
    return _bedrifter.find(function (b) { return b.id === c.bedriftId; }) || null;
  }
  function contactsFor(bedriftId) {
    return _customers.filter(function (c) { return c.bedriftId === bedriftId; });
  }
  function createBedrift(data) {
    var b = Object.assign({ id: "bed-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), created: new Date().toISOString() }, data);
    _bedrifter.push(b);
    if (_sb) _sb.from("crm_bedrifter").insert(Object.assign(jsBedriftToDb(b), { id: b.id, created_at: b.created })).then(function () {}).catch(function (err) { logWriteError("opprette bedrift", err); });
    else App.store.set(BEDRIFT_KEY, _bedrifter);
    return b;
  }
  function updateBedrift(id, patch) {
    var idx = _bedrifter.findIndex(function (b) { return b.id === id; });
    if (idx >= 0) Object.assign(_bedrifter[idx], patch);
    if (_sb) _sb.from("crm_bedrifter").update(jsBedriftToDb(idx >= 0 ? _bedrifter[idx] : patch)).eq("id", id).then(function () {}).catch(function (err) { logWriteError("oppdatere bedrift", err); });
    else App.store.set(BEDRIFT_KEY, _bedrifter);
  }
  function deleteBedrift(id) {
    _bedrifter = _bedrifter.filter(function (b) { return b.id !== id; });
    if (_sb) _sb.from("crm_bedrifter").delete().eq("id", id).then(function () {}).catch(function (err) { logWriteError("slette bedrift", err); });
    else App.store.set(BEDRIFT_KEY, _bedrifter);
  }
  function findOrCreateBedrift(name, extra) {
    var n = (name||"").trim(); if (!n) return null;
    var ex = _bedrifter.find(function (b) { return b.name.toLowerCase() === n.toLowerCase(); });
    if (ex) { if (extra) updateBedrift(ex.id, extra); return ex; }
    var nums = _bedrifter.map(function (b) { return b.customerNumber; }).filter(Boolean);
    return createBedrift(Object.assign({
      customerNumber: App.generateUniqueNumber(nums),
      orgNr:"", website:"", phone:"", address:"",
      invoiceEmail:"", invoiceAddress:"", note:"", name: n
    }, extra||{}, { name: n }));
  }

  /* =========================================================================
     KOMMUNIKASJON
     ====================================================================== */
  function getComms() { return _comms; }
  function getCommsFor(cid) { return _comms.filter(function (c) { return c.customerId === cid; }); }
  function addComm(data) {
    var item = Object.assign({ id:"cm-"+Date.now()+"-"+Math.random().toString(36).slice(2,5),
      created: new Date().toISOString() }, data);
    _comms.unshift(item);
    if (_sb) _sb.from("crm_comms").insert(Object.assign(jsCommToDb(item), { id: item.id, created_at: item.created })).then(function () {}).catch(function (err) { logWriteError("legge til hendelse", err); });
    else App.store.set(COMMS_KEY, _comms);
    return item;
  }
  function deleteComm(id) {
    // Frigjer eit ev. dokumentvedlegg FØR raden fjernast frå _comms, elles
    // finn me ikkje att attachment-referansen — ingen andre comms kan i dag
    // dele same opplasta fil (kvart putFile()-kall får ein fersk, unik sti),
    // så ubetinga frigjering her er trygt (2026-07-06-funn: dette mangla heilt).
    var toDelete = _comms.find(function (c) { return c.id === id; });
    if (toDelete && toDelete.type === "document" && toDelete.attachment && toDelete.attachment.ref) {
      App.media.freeFile(toDelete.attachment.ref);
    }
    _comms = _comms.filter(function (c) { return c.id !== id; });
    if (_sb) _sb.from("crm_comms").delete().eq("id", id).then(function () {}).catch(function (err) { logWriteError("slette hendelse", err); });
    else App.store.set(COMMS_KEY, _comms);
  }
  function updateComm(id, patch) {
    var idx = _comms.findIndex(function (c) { return c.id === id; });
    if (idx >= 0) _comms[idx] = Object.assign({}, _comms[idx], patch);
    if (_sb) _sb.from("crm_comms").update(jsCommToDb(idx >= 0 ? _comms[idx] : patch)).eq("id", id).then(function () {}).catch(function (err) { logWriteError("oppdatere hendelse", err); });
    else App.store.set(COMMS_KEY, _comms);
  }
  function newThreadId() { return "th-"+Date.now()+"-"+Math.random().toString(36).slice(2,5); }

  /* =========================================================================
     TIDSLINJE-KONFIG
     ====================================================================== */
  var TL_CONF = {
    phone_note:     {icon:"phone",          color:"#27AE60", label:"Telefonnotat"},
    internal_note:  {icon:"notes",          color:"#F39C12", label:"Internt notat"},
    email_sent:     {icon:"send",           color:"#2980B9", label:"E-post sendt"},
    email_received: {icon:"mail-opened",    color:"#2980B9", label:"E-post mottatt"},
    document:       {icon:"paperclip",      color:"#E8833A", label:"Dokument"},
    task:           {icon:"circle-check",   color:"#7B5EA7", label:"Oppgave"},
    chat:           {icon:"message-circle", color:"#15616D", label:"Chat"},
    contact:        {icon:"message",        color:"#2980B9", label:"Kontakt"},
    quote:          {icon:"file-invoice",   color:"#E8833A", label:"Tilbud"},
    booking:        {icon:"calendar",       color:"#27AE60", label:"Booking"},
    "default":      {icon:"point",          color:"#999",    label:"Hendelse"}
  };

  // Filtreringskategoriar for tidslinja — e-post sendt/mottatt og gamle
  // Kontakt-leads er ulike `type`-verdiar, men slås saman under éin
  // "Kontakt"-filterknapp (brukarvalgt gruppering); Tilbud/Booking/dei fire
  // redigerbare comm-typane/Chat har kvar sin eigen knapp.
  var TL_CATEGORIES = [
    { id: "kontakt",       label: "Kontakt",       types: ["contact", "email_sent", "email_received"] },
    { id: "quote",         label: "Tilbud",        types: ["quote"] },
    { id: "booking",       label: "Booking",       types: ["booking"] },
    { id: "phone_note",    label: "Telefonnotat",  types: ["phone_note"] },
    { id: "internal_note", label: "Internt notat", types: ["internal_note"] },
    { id: "document",      label: "Dokument",      types: ["document"] },
    { id: "task",          label: "Oppgave",       types: ["task"] },
    { id: "chat",          label: "Chat",          types: ["chat"] }
  ];
  function tlCategoryId(item) {
    var cat = TL_CATEGORIES.find(function (c) { return c.types.indexOf(item.type) > -1; });
    return cat ? cat.id : "other";
  }
  // Aktive filterkategoriar per kunde-id — held seg gjennom refresh() (som
  // køyrer heile renderCustomer() på nytt for kvar handling), sidan filteret
  // elles ville nullstilt seg kvar gong ein redigerer/slettar noko.
  var _tlFilter = {};

  /* =========================================================================
     HJELPARAR
     ====================================================================== */
  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("nb-NO", {day:"numeric", month:"short", year:"numeric"});
  }
  function formatAgo(ts) {
    if (!ts) return "";
    var diff = Math.round((Date.now()-new Date(ts))/60000);
    if (diff<1) return "nå";
    if (diff<60) return diff+" min";
    var h = Math.round(diff/60);
    if (h<24) return h+" t";
    if (h<48) return "i går";
    return new Date(ts).toLocaleDateString("nb-NO", {day:"numeric", month:"short"});
  }
  function todayISO() { return new Date().toISOString().slice(0,10); }
  function nowTime()  { return new Date().toTimeString().slice(0,5); }
  function initials(name) {
    if (!name) return "?";
    var w = name.trim().split(/\s+/);
    return w.length===1 ? w[0].charAt(0).toUpperCase() : (w[0].charAt(0)+w[w.length-1].charAt(0)).toUpperCase();
  }
  function avatarColor(name) {
    var cols = ["#15616D","#E8833A","#7B5EA7","#2A7A2A","#C0392B","#2980B9","#8E6B3E"];
    var sum = 0; for (var i=0; i<(name||"").length; i++) sum += (name||"").charCodeAt(i);
    return cols[sum%cols.length];
  }
  function commStats(customerId) {
    var comms = getCommsFor(customerId);
    return {
      emails:  comms.filter(function (c) { return c.type==="email_sent"||c.type==="email_received"; }).length,
      phones:  comms.filter(function (c) { return c.type==="phone_note"; }).length,
      notes:   comms.filter(function (c) { return c.type==="internal_note"; }).length,
      overdue: comms.filter(function (c) { return c.type==="task"; })
                    .some(function (t) { return !t.done&&t.dueDate&&t.dueDate<todayISO(); })
    };
  }

  /* =========================================================================
     TEKSTEDITOR (brukar same C.richTextField som Aktuelt)
     ====================================================================== */
  function rtField(id, label, value) { return C.richTextField({id:id, label:label, value:value||""}); }
  function bindRt(scope)       { App.ui.bindRichTextFields(scope); }
  function readRt(scope, id)   { return App.ui.readRichTextField(scope, id); }
  function plainRt(html)       { return C.stripHtml(html).trim(); }

  /* =========================================================================
     AUTO-IMPORT (kundar + bedrifter frå leads og bookingar)
     ====================================================================== */
  function bookingBookings() {
    return (window.BookingAdmin && window.BookingAdmin.getBookings) ? window.BookingAdmin.getBookings() : (App.store.get("booking-bookings",[]) || []);
  }
  function parseQuoteForBedrift(lead) {
    var msg = lead.message||"";
    if (!msg || !(App.isTilbud ? App.isTilbud(lead) : msg.indexOf("Tilbudsforesp") === 0)) return null;
    var m, orgName = (m=msg.match(/^Bedrift:\s*(.+)$/m)) ? m[1].trim() : null;
    if (!orgName) return null;
    return {
      name:         orgName,
      orgNr:        (m=msg.match(/^Org\.nr:\s*(.+)$/m))        ? m[1].trim() : "",
      invoiceEmail: (m=msg.match(/^Faktura e-post:\s*(.+)$/m)) ? m[1].trim() : "",
      invoiceAddress:(m=msg.match(/^Fakturaadresse:\s*(.+)$/m))? m[1].trim() : ""
    };
  }

  function autoImport() {
    var leads    = App.getLeads ? App.getLeads() : [];
    var bookings = bookingBookings();
    function upsert(email, name, bedInfo) {
      if (!email) return;
      var e   = email.toLowerCase();
      var bed = bedInfo ? findOrCreateBedrift(bedInfo.name, bedInfo) : null;
      var ex  = _customers.find(function (c) { return customerEmails(c).some(function (x) { return x.toLowerCase()===e; }); });
      if (!ex) {
        var nums = _customers.map(function (c) { return c.customerNumber; }).filter(Boolean);
        createCustomer({ email:email, altEmails:[], name:name||"", phone:"", address:"", note:"",
          customerNumber:App.generateUniqueNumber(nums), bedriftId: bed ? bed.id : null });
      } else {
        var patch = {};
        if (name && !ex.name)     patch.name = name;
        if (bed  && !ex.bedriftId) patch.bedriftId = bed.id;
        if (Object.keys(patch).length) updateCustomer(ex.id, patch);
      }
    }
    leads.forEach(function (l) {
      if (!l.email) return;
      var bedInfo = parseQuoteForBedrift(l);
      var msg     = l.message||"";
      var nm      = msg.match(/^Navn:\s*(.+)$/m);
      upsert(l.email, nm ? nm[1].trim() : l.name, bedInfo);
    });
    bookings.forEach(function (b) { if (b.email) upsert(b.email, b.name, null); });
  }

  /* =========================================================================
     LEGACY + CHAT HISTORIKK
     ====================================================================== */
  function getLegacyHistory(emails) {
    var es = emails.map(function (e) { return (e||"").toLowerCase(); }), items = [];
    (App.getLeads ? App.getLeads() : []).forEach(function (l) {
      if (es.indexOf((l.email||"").toLowerCase())===-1) return;
      var isQ = App.isTilbud ? App.isTilbud(l) : (l.message&&l.message.indexOf("Tilbudsforesp")===0);
      items.push({ id:l.id, type:isQ?"quote":"contact", source:"legacy",
        created:new Date(l.time||0).toISOString(),
        title:(isQ?"Tilbudsforespørsel":"Kontaktmelding")+(l.name?" fra "+l.name:""),
        body:(l.message||"").replace(/<[^>]+>/g,"").slice(0,120), status:l.status||"ny" });
    });
    bookingBookings().forEach(function (b) {
      if (es.indexOf((b.email||"").toLowerCase())===-1) return;
      var aa = App.store.get("booking-assets",[])||[];
      var a  = aa.find(function (x) { return x.id===b.assetId; });
      items.push({ id:b.id, type:"booking", source:"legacy",
        created:new Date(b.createdAt||0).toISOString(),
        title:"Booking"+(a?": "+a.name:"")+(b.date?" · "+b.date:""),
        body:b.message||"", status:b.status||"ny" });
    });
    return items;
  }
  function getChatHistory(emails) {
    var items = [];
    if (!window.VwChat||!window.VwChat.getConvs) return items;
    var es = emails.map(function (e) { return (e||"").toLowerCase(); });
    window.VwChat.getConvs().forEach(function (cv) {
      if (es.indexOf((cv.email||"").toLowerCase())===-1) return;
      items.push({ id:"chat-"+cv.id, type:"chat", source:"chat",
        created:cv.lastAt?new Date(cv.lastAt).toISOString():new Date().toISOString(),
        title:"Chat-samtale"+(cv.name?" med "+cv.name:""),
        body:cv.lastMsg||"", chatId:cv.id });
    });
    return items;
  }
  function getTimeline(cid, emails) {
    var items = getLegacyHistory(emails).concat(getChatHistory(emails));
    getCommsFor(cid).forEach(function (c) { items.push(Object.assign({},c,{source:"comm"})); });
    return items.sort(function (a,b) { return new Date(b.created)-new Date(a.created); });
  }

  /* =========================================================================
     SLETT ALT FOR PERSON (GDPR)
     ====================================================================== */
  function deleteAllForEmail(emails) {
    var es = emails.map(function (e) { return (e||"").toLowerCase(); });
    if (App.getLeads && App.deleteLead) {
      (App.getLeads()||[]).filter(function(l){return es.indexOf((l.email||"").toLowerCase())>-1;})
        .forEach(function(l){ App.deleteLead(l.id); });
    }
    if (window.BookingAdmin && window.BookingAdmin.deleteBookingsByEmail) {
      es.forEach(function (e) { window.BookingAdmin.deleteBookingsByEmail(e); });
    } else {
      var bk = App.store.get("booking-bookings",[])||[];
      App.store.set("booking-bookings",bk.filter(function(b){return es.indexOf((b.email||"").toLowerCase())===-1;}));
    }
    _comms.filter(function(c){
      var cu=_customers.find(function(x){return x.id===c.customerId;}); if(!cu) return false;
      return customerEmails(cu).some(function(e){return es.indexOf(e.toLowerCase())>-1;});
    }).forEach(function(c){ deleteComm(c.id); });
    if (window.VwChat&&window.VwChat.deleteConv&&window.VwChat.getConvs)
      window.VwChat.getConvs().filter(function(cv){return es.indexOf((cv.email||"").toLowerCase())>-1;}).forEach(function(cv){window.VwChat.deleteConv(cv.id);});
  }

  /* =========================================================================
     DIALOG (native <dialog>)
     ====================================================================== */
  // dl.close() kastar i miljø utan reell <dialog>-støtte (t.d. jsdom sitt
  // testoppsett) — openDialog() sin eigen lukk-knapp har alt try/catch rundt
  // dette (sjå closeDl() under), men kvar dialog sin eigen Lagre/Avbryt-
  // handsamar kalla dl.close() direkte, usikra. Delt hjelpar for alle.
  function closeDialog(dl) { try { dl.close(); } catch (e) {} if (dl.parentNode) dl.remove(); }
  function openDialog(opts) {
    var dl = document.createElement("dialog");
    dl.className = "crm-dlg";
    dl.style.cssText = "border:0;border-radius:14px;padding:0;max-width:"+(opts.wide?"700px":"540px")+";width:calc(100vw - 2rem);box-shadow:0 20px 60px rgba(0,0,0,.25);background:var(--color-surface,#fff)";
    dl.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.2rem .8rem;border-bottom:1px solid var(--color-border,#e5e7eb)">' +
        '<strong style="font-size:1rem">'+esc(opts.title||"")+'</strong>' +
        '<button class="crm-dlg-close" aria-label="Lukk" style="background:none;border:0;cursor:pointer;font-size:1.3rem;color:var(--color-muted,#6b7280);padding:.2rem;line-height:1">&times;</button>' +
      '</div>' +
      '<div style="padding:1rem 1.2rem;display:grid;gap:.7rem;max-height:75vh;overflow-y:auto">'+(opts.bodyHtml||"")+'</div>' +
      (opts.footHtml?'<div style="padding:.8rem 1.2rem 1rem;display:flex;gap:.5rem;border-top:1px solid var(--color-border,#e5e7eb)">'+opts.footHtml+'</div>':"");
    document.body.appendChild(dl);
    try { dl.showModal(); } catch(e) { dl.setAttribute("open",""); }
    function closeDl() { try { dl.close(); } catch(e) {} if (dl.parentNode) dl.remove(); }
    dl.querySelector(".crm-dlg-close").addEventListener("click", closeDl);
    dl.addEventListener("close",function(){if(dl.parentNode)dl.remove();});
    if (opts.onMount) opts.onMount(dl);
    return dl;
  }

  function dlgField(id, label, type, value, placeholder, extra) {
    var isTA = type==="textarea";
    var inp = isTA
      ? '<textarea id="'+id+'" rows="3" placeholder="'+esc(placeholder||"")+'" '+(extra||"")+' style="width:100%;font:inherit;font-size:.9rem;padding:.55rem .7rem;border:1.5px solid var(--color-border,#d1d5db);border-radius:8px;resize:vertical;background:var(--color-bg,#fff);color:var(--color-text,#111)">'+esc(value||"")+'</textarea>'
      : '<input id="'+id+'" type="'+type+'" value="'+esc(value||"")+'" placeholder="'+esc(placeholder||"")+'" '+(extra||"")+' style="width:100%;font:inherit;font-size:.9rem;padding:.55rem .7rem;border:1.5px solid var(--color-border,#d1d5db);border-radius:8px;background:var(--color-bg,#fff);color:var(--color-text,#111)">';
    return '<div style="display:grid;gap:.25rem"><label for="'+id+'" style="font-size:.85rem;font-weight:600">'+esc(label)+'</label>'+inp+'</div>';
  }
  function dlgSelect(id, label, options, selected) {
    return '<div style="display:grid;gap:.25rem"><label for="'+id+'" style="font-size:.85rem;font-weight:600">'+esc(label)+'</label>' +
      '<select id="'+id+'" style="font:inherit;font-size:.9rem;padding:.55rem .7rem;border:1.5px solid var(--color-border,#d1d5db);border-radius:8px;background:var(--color-bg,#fff);color:var(--color-text)">' +
        options.map(function(o){var v=typeof o==="object"?o.value:o,l=typeof o==="object"?o.label:o;return'<option value="'+esc(v)+'"'+(v===selected?" selected":"")+'>'+esc(l)+'</option>';}).join("") +
      '</select></div>';
  }

  /* =========================================================================
     RENDER — ADMIN ROOT (med sub-faner)
     ====================================================================== */
  function renderAdmin(body) {
    autoImport();
    var customers = getCustomers(), bedrifter = getBedrifter();
    var canExport = !isWorkspaceMember();
    body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:.9rem;flex-wrap:wrap">' +
        '<div style="display:flex;gap:.3rem">' +
          subTabBtn("kontaktar","Kontakter ("+customers.length+")", crmSubView==="kontaktar") +
          subTabBtn("bedrifter","Bedrifter ("+bedrifter.length+")", crmSubView==="bedrifter") +
        '</div>' +
        '<div style="display:flex;gap:.35rem;align-items:center">' +
          (crmSubView==="kontaktar"
            ? C.button({label:"Ny kontakt",variant:"primary",attrs:'data-crm-new style="font-size:.82rem"'})+
              C.button({label:"Importer",variant:"ghost",attrs:'data-crm-import style="font-size:.82rem"'})+
              (canExport ? C.button({label:"CSV",variant:"ghost",attrs:'data-crm-export style="font-size:.82rem"'}) : '')
            : C.button({label:"Ny bedrift",variant:"primary",attrs:'data-crm-new-bed style="font-size:.82rem"'})) +
          '<button data-crm-sig title="CRM-innstillinger" style="background:none;border:1.5px solid var(--color-border,#d1d5db);border-radius:8px;padding:.35rem .5rem;cursor:pointer;color:var(--color-muted);font-size:.85rem;line-height:1"><i class="ti ti-settings"></i></button>' +
        '</div>' +
      '</div>' +
      '<div data-crm-subview></div>';

    body.querySelectorAll("[data-crm-sub]").forEach(function (btn) {
      btn.addEventListener("click", function () { crmSubView=btn.getAttribute("data-crm-sub"); renderAdmin(body); });
    });
    var sv = body.querySelector("[data-crm-subview]");
    if (crmSubView==="kontaktar") renderKontaktList(sv, body);
    else renderBedriftList(sv, body);

    var impBtn = body.querySelector("[data-crm-import]");
    if (impBtn) impBtn.addEventListener("click",function(){autoImport();renderAdmin(body);});
    var expBtn = body.querySelector("[data-crm-export]");
    // Handler-sperre i tillegg til skjult knapp: CSV-eksport av heile kundelista
    // er det einaste CRM-unntaket for member. MERK (dokumentert ærleg, ikkje
    // selt inn som reell datasikring): denne sperra hindrar berre EKSPORT-KNAPPEN
    // i UI-et. Ein teknisk member-brukar kan uansett hente identisk (eller meir
    // oppdatert) kundedata direkte via Supabase REST-API, sidan member alt har
    // legitim SELECT+skrivetilgang til crm-customers/crm-bedrifter (naudsynt for
    // å kunne opprette/redigere kundar i det heile). Sjå docs/security/security-baseline.md.
    if (expBtn) expBtn.addEventListener("click",function(){
      if (isWorkspaceMember()) return;
      App.downloadCsv("kunder.csv",
        ["Navn","E-post","Kundenummer","Bedrift","Tlf","Adresse","Notat","Opprettet"],
        getCustomers().map(function(c){var b=bedriftFor(c);return[c.name||"",c.email||"",c.customerNumber||"",b?b.name:"",c.phone||"",c.address||"",c.note||"",c.created||""];}));
    });
    var newBtn = body.querySelector("[data-crm-new]");
    if (newBtn) newBtn.addEventListener("click",function(){openNewCustomerDialog(body);});
    var newBedBtn = body.querySelector("[data-crm-new-bed]");
    if (newBedBtn) newBedBtn.addEventListener("click",function(){openNewBedriftDialog(body);});
    body.querySelector("[data-crm-sig]").addEventListener("click",function(){openCrmSettingsDialog();});
  }

  function subTabBtn(id, label, active) {
    return '<button data-crm-sub="'+id+'" style="padding:.35rem .75rem;border:1.5px solid '+(active?"var(--color-primary,#2980B9)":"var(--color-border,#d1d5db)")+';border-radius:8px;background:'+(active?"var(--color-primary,#2980B9)":"transparent")+';color:'+(active?"#fff":"var(--color-text)")+';font:inherit;font-size:.82rem;font-weight:600;cursor:pointer">'+esc(label)+'</button>';
  }

  /* =========================================================================
     KONTAKTLISTE
     ====================================================================== */
  function renderKontaktList(container, body) {
    container.innerHTML =
      '<div style="position:relative;margin-bottom:.9rem">' +
        '<i class="ti ti-search" style="position:absolute;left:.65rem;top:50%;transform:translateY(-50%);color:var(--color-muted,#9ca3af);font-size:.9rem"></i>' +
        '<input data-crm-search type="search" placeholder="Søk namn, e-post, bedrift…" style="width:100%;padding:.55rem .7rem .55rem 2rem;border:1.5px solid var(--color-border,#d1d5db);border-radius:8px;font:inherit;font-size:.88rem;background:var(--color-bg,#fff);color:var(--color-text)">' +
      '</div>' +
      '<div data-crm-merge-bar style="display:none;align-items:center;gap:.6rem;margin-bottom:.7rem">' +
        C.button({label:"Slå sammen valgte",icon:"git-merge",variant:"primary",attrs:'data-crm-merge-btn style="font-size:.82rem"'}) +
      '</div>' +
      (getCustomers().length
        ? '<ul class="admin-list" style="display:grid;gap:.45rem;list-style:none;padding:0;margin:0">'+getCustomers().map(custRow).join("")+'</ul>'
        : '<p style="color:var(--color-muted);font-size:.88rem;text-align:center;padding:2rem 0">Ingen kunder ennå. Klikk Importer for å hente fra skjema.</p>');
    bindKontaktList(container, body);
  }

  function custRow(c) {
    var bed = bedriftFor(c), stats = commStats(c.id);
    var total = getLegacyHistory(customerEmails(c)).length+stats.emails+stats.phones+stats.notes;
    var col = avatarColor(c.name||c.email), ini = initials(c.name||c.email);
    var pills = [];
    if (stats.emails>0) pills.push('<span style="font-size:.7rem;color:var(--color-muted)"><i class="ti ti-mail"></i> '+stats.emails+'</span>');
    if (stats.phones>0) pills.push('<span style="font-size:.7rem;color:var(--color-muted)"><i class="ti ti-phone"></i> '+stats.phones+'</span>');
    if (stats.notes>0)  pills.push('<span style="font-size:.7rem;color:var(--color-muted)"><i class="ti ti-notes"></i> '+stats.notes+'</span>');
    if (stats.overdue)  pills.push('<span style="font-size:.7rem;font-weight:700;color:#c0392b"><i class="ti ti-alarm"></i> Forfalt</span>');
    return '<li class="admin-row" style="gap:.65rem;align-items:center;cursor:pointer" data-crm-open="'+esc(c.id)+'">' +
      '<div style="width:36px;height:36px;border-radius:999px;background:'+col+';flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:700;color:#fff">'+esc(ini)+'</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin-bottom:.1rem">' +
          '<strong style="font-size:.9rem">'+esc(c.name||"(ukjent)")+'</strong>' +
          (bed?'<span style="font-size:.72rem;color:var(--color-primary);font-weight:600">'+esc(bed.name)+'</span>':'') +
          (pills.length?pills.join('<span style="opacity:.3;margin:0 .1rem">·</span>'):'') +
        '</div>' +
        '<div style="font-size:.78rem;color:var(--color-muted)">'+esc(c.email||"")+(c.phone?" · "+esc(c.phone):"")+(total?" · "+total+" aktivitet":"")+'</div>' +
      '</div>' +
      '<div style="display:flex;gap:.3rem;flex-shrink:0" onclick="event.stopPropagation()">' +
        '<button type="button" class="crm-merge-check" data-merge-id="'+esc(c.id)+'" style="padding:.55rem .7rem;border:1.5px solid var(--color-border,#d1d5db);border-radius:6px;background:transparent;font:inherit;font-size:.72rem;font-weight:600;color:var(--color-muted);cursor:pointer">Merk</button>' +
        C.button({label:"Åpne",variant:"ghost",attrs:'data-crm-open="'+esc(c.id)+'" style="font-size:.78rem"'}) +
        (isWorkspaceMember()?'':C.button({label:"Slett",variant:"ghost",attrs:'data-crm-del="'+esc(c.id)+'" style="font-size:.78rem;border-color:#c0392b;color:#c0392b"'})) +
      '</div>' +
    '</li>';
  }

  function bindKontaktList(container, body) {
    var search = container.querySelector("[data-crm-search]");
    if (search) search.addEventListener("input",function(){
      var q = search.value.toLowerCase();
      container.querySelectorAll("[data-crm-open]").forEach(function(li){
        if (!li.matches("li")) return;
        var c=getCustomers().find(function(x){return x.id===li.getAttribute("data-crm-open");}); if(!c) return;
        var b=bedriftFor(c);
        li.style.display=(!q||[c.name,c.email,c.phone,c.note,b?b.name:""].join(" ").toLowerCase().indexOf(q)>-1)?"":"none";
      });
    });
    container.querySelectorAll("[data-crm-open]").forEach(function(el){
      if (!el.matches("li,button[data-crm-open]")) return;
      el.addEventListener("click",function(e){
        if (e.target.closest("[data-crm-del],.crm-merge-check")) return;
        renderCustomer(body, el.getAttribute("data-crm-open"));
      });
    });
    container.querySelectorAll("[data-crm-del]").forEach(function(btn){
      btn.addEventListener("click",function(e){
        e.stopPropagation();
        if (isWorkspaceMember()) return;
        var id=btn.getAttribute("data-crm-del"), c=getCustomers().find(function(x){return x.id===id;});
        if (!c||!confirm("Slett ALL data for "+c.email+"?")) return;
        deleteAllForEmail(customerEmails(c)); deleteCustomer(id);
        renderAdmin(body);
      });
    });
    container.querySelectorAll(".crm-merge-check").forEach(function(btn){
      btn.addEventListener("click",function(){
        var active=btn.getAttribute("data-active")==="1";
        btn.setAttribute("data-active",active?"0":"1");
        btn.style.borderColor=active?"var(--color-border,#d1d5db)":"var(--color-primary,#2980B9)";
        btn.style.background=active?"transparent":"color-mix(in srgb,var(--color-primary,#2980B9) 10%,transparent)";
        btn.style.color=active?"var(--color-muted)":"var(--color-primary,#2980B9)";
        var n=container.querySelectorAll(".crm-merge-check[data-active='1']").length;
        var bar=body.querySelector("[data-crm-merge-bar]"); if(bar) bar.style.display=n>=2?"flex":"none";
      });
    });
    var mb=container.querySelector("[data-crm-merge-btn]");
    if (mb) mb.addEventListener("click",function(){
      var ids=[].slice.call(container.querySelectorAll(".crm-merge-check[data-active='1']")).map(function(btn){return btn.getAttribute("data-merge-id");});
      if (ids.length<2) return;
      var toMerge=getCustomers().filter(function(c){return ids.indexOf(c.id)>-1;});
      openMergeDialog(toMerge,body);
    });
  }

  /* =========================================================================
     BEDRIFTLISTE
     ====================================================================== */
  function renderBedriftList(container, body) {
    var bedrifter = getBedrifter();
    container.innerHTML =
      '<div style="position:relative;margin-bottom:.9rem">' +
        '<i class="ti ti-search" style="position:absolute;left:.65rem;top:50%;transform:translateY(-50%);color:var(--color-muted);font-size:.9rem"></i>' +
        '<input data-bed-search type="search" placeholder="Søk bedriftsnamn, org.nr…" style="width:100%;padding:.55rem .7rem .55rem 2rem;border:1.5px solid var(--color-border,#d1d5db);border-radius:8px;font:inherit;font-size:.88rem;background:var(--color-bg,#fff);color:var(--color-text)">' +
      '</div>' +
      (bedrifter.length
        ? '<ul class="admin-list" style="display:grid;gap:.45rem;list-style:none;padding:0;margin:0">'+bedrifter.map(bedriftRow).join("")+'</ul>'
        : '<p style="color:var(--color-muted);font-size:.88rem;text-align:center;padding:2rem 0">Ingen bedrifter ennå. Opprettes automatisk fra tilbud/kontakt eller manuelt.</p>');
    var s=container.querySelector("[data-bed-search]");
    if (s) s.addEventListener("input",function(){
      var q=s.value.toLowerCase();
      container.querySelectorAll("[data-bed-open]").forEach(function(li){
        if (!li.matches("li")) return;
        var b=getBedrifter().find(function(x){return x.id===li.getAttribute("data-bed-open");}); if(!b) return;
        li.style.display=(!q||[b.name,b.orgNr,b.note].join(" ").toLowerCase().indexOf(q)>-1)?"":"none";
      });
    });
    container.querySelectorAll("[data-bed-open]").forEach(function(el){
      if (!el.matches("li,button[data-bed-open]")) return;
      el.addEventListener("click",function(e){
        if (e.target.closest("[data-bed-del]")) return;
        renderBedrift(body, el.getAttribute("data-bed-open"));
      });
    });
    container.querySelectorAll("[data-bed-del]").forEach(function(btn){
      btn.addEventListener("click",function(e){
        e.stopPropagation();
        if (isWorkspaceMember()) return;
        var id=btn.getAttribute("data-bed-del"), b=getBedrifter().find(function(x){return x.id===id;});
        if (!b||!confirm("Slett bedriften «"+b.name+"»? Kontakter blir ikke slettet, bare frakoblet.")) return;
        getCustomers().filter(function(c){return c.bedriftId===id;}).forEach(function(c){updateCustomer(c.id,{bedriftId:null});});
        deleteBedrift(id); renderAdmin(body);
      });
    });
  }

  function bedriftRow(b) {
    var contacts = contactsFor(b.id), col = avatarColor(b.name);
    return '<li class="admin-row" style="gap:.65rem;align-items:center;cursor:pointer" data-bed-open="'+esc(b.id)+'">' +
      '<div style="width:36px;height:36px;border-radius:8px;background:'+col+';flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:700;color:#fff">'+(b.name||"B").charAt(0).toUpperCase()+'</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.1rem">' +
          '<strong style="font-size:.9rem">'+esc(b.name)+'</strong>' +
          (b.orgNr?'<span style="font-size:.72rem;color:var(--color-muted)">Org: '+esc(b.orgNr)+'</span>':'') +
        '</div>' +
        '<div style="font-size:.78rem;color:var(--color-muted)">'+contacts.length+' kontakt'+(contacts.length!==1?"ar":"")+(b.website?" · "+esc(b.website):"")+(b.phone?" · "+esc(b.phone):"")+'</div>' +
      '</div>' +
      '<div onclick="event.stopPropagation()" style="display:flex;gap:.3rem;flex-shrink:0">' +
        C.button({label:"Åpne",variant:"ghost",attrs:'data-bed-open="'+esc(b.id)+'" style="font-size:.78rem"'}) +
        (isWorkspaceMember()?'':C.button({label:"Slett",variant:"ghost",attrs:'data-bed-del="'+esc(b.id)+'" style="font-size:.78rem;border-color:#c0392b;color:#c0392b"'})) +
      '</div>' +
    '</li>';
  }

  /* =========================================================================
     BEDRIFTSKORT
     ====================================================================== */
  function renderBedrift(body, bedriftId) {
    var bed = getBedrifter().find(function(b){return b.id===bedriftId;});
    if (!bed) { crmSubView="bedrifter"; renderAdmin(body); return; }
    var contacts = contactsFor(bedriftId);
    var tot = {emails:0,phones:0,notes:0,overdue:false};
    contacts.forEach(function(c){ var s=commStats(c.id); tot.emails+=s.emails; tot.phones+=s.phones; tot.notes+=s.notes; if(s.overdue) tot.overdue=true; });
    var legCnt=0; contacts.forEach(function(c){legCnt+=getLegacyHistory(customerEmails(c)).length;});
    var col = avatarColor(bed.name);

    body.innerHTML =
      '<button data-bed-back style="display:inline-flex;align-items:center;gap:.4rem;background:none;border:0;cursor:pointer;font:inherit;font-size:.85rem;color:var(--color-muted);padding:.2rem 0;margin-bottom:.75rem"><i class="ti ti-arrow-left"></i> Alle bedrifter</button>' +

      '<div style="background:var(--color-surface,#fff);border:1px solid var(--color-border);border-radius:12px;padding:1rem;margin-bottom:.7rem">' +
        '<div style="display:flex;align-items:flex-start;gap:.9rem">' +
          '<div style="width:48px;height:48px;border-radius:10px;background:'+col+';flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:700;color:#fff">'+(bed.name||"B").charAt(0).toUpperCase()+'</div>' +
          '<div style="flex:1;min-width:0">' +
            '<h4 style="margin:0 0 .15rem;font-size:1.05rem">'+esc(bed.name)+'</h4>' +
            '<div style="font-size:.8rem;color:var(--color-muted);display:flex;flex-wrap:wrap;gap:.15rem .45rem">' +
              (bed.orgNr?'<span>Org.nr: '+esc(bed.orgNr)+'</span>':'') +
              (bed.website?'<a href="'+esc(bed.website)+'" target="_blank" style="color:var(--color-muted)">'+esc(bed.website)+'</a>':'') +
              (bed.phone?'<span>'+esc(bed.phone)+'</span>':'') +
            '</div>' +
            '<div style="font-size:.72rem;color:var(--color-muted);margin-top:.1rem">Kundenr. #'+esc(String(bed.customerNumber||""))+' · Opprettet '+formatDate(bed.created)+'</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:1.2rem;flex-wrap:wrap;padding:.65rem 0 0;margin-top:.65rem;border-top:1px solid var(--color-border)">' +
          statPill("mail",  tot.emails+"",   "e-postar") +
          statPill("phone", tot.phones+"",   "telefoner") +
          statPill("notes", tot.notes+"",    "notater") +
          statPill("users", contacts.length+"","kontakter") +
          statPill("history",(legCnt+tot.emails+tot.phones+tot.notes)+"","total aktivitet") +
          (tot.overdue?'<span style="font-size:.75rem;font-weight:700;color:#c0392b"><i class="ti ti-alarm"></i> Forfalt oppgave</span>':'') +
        '</div>' +
      '</div>' +

      '<details style="background:var(--color-surface,#fff);border:1px solid var(--color-border);border-radius:12px;padding:.85rem 1rem;margin-bottom:.7rem">' +
        '<summary style="list-style:none;cursor:pointer;display:flex;align-items:center;gap:.45rem;font-size:.88rem;font-weight:700"><i class="ti ti-building" style="color:var(--color-primary,#2980B9)"></i> Bedriftsinformasjon</summary>' +
        '<form data-bed-edit style="display:grid;gap:.55rem;margin-top:.8rem">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.55rem">' +
            dlgField("be-name","Bedriftsnavn","text",bed.name||"","")+dlgField("be-orgnr","Org.nr","text",bed.orgNr||"","123 456 789") +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.55rem">' +
            dlgField("be-phone","Telefon","tel",bed.phone||"","")+dlgField("be-website","Nettside","url",bed.website||"","https://") +
          '</div>' +
          dlgField("be-address","Adresse","text",bed.address||"","") +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.55rem">' +
            dlgField("be-invemail","Fakturamail","email",bed.invoiceEmail||"","faktura@bedrift.no")+dlgField("be-invaddr","Fakturaadresse","text",bed.invoiceAddress||"","") +
          '</div>' +
          dlgField("be-note","Merknad","textarea",bed.note||"","") +
          '<div style="display:flex;gap:.4rem;align-items:center">'+C.button({label:"Lagre",variant:"primary",type:"submit",attrs:'style="font-size:.82rem"'})+'<span data-be-status class="form__status" style="font-size:.82rem"></span></div>' +
        '</form>' +
      '</details>' +

      '<div style="background:var(--color-surface,#fff);border:1px solid var(--color-border);border-radius:12px;padding:.85rem 1rem;margin-bottom:.7rem">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.7rem">' +
          '<span style="font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-muted)">Kontaktpersoner</span>' +
          C.button({label:"Ny kontakt",icon:"user-plus",variant:"ghost",attrs:'data-new-contact-for-bed style="font-size:.78rem"'}) +
        '</div>' +
        (contacts.length===0
          ? '<p style="font-size:.85rem;color:var(--color-muted);margin:0">Ingen kontaktpersonar endå.</p>'
          : contacts.map(function(c){
              var ini2=initials(c.name||c.email), col2=avatarColor(c.name||c.email), s=commStats(c.id), act=s.emails+s.phones+s.notes;
              return '<div data-open-contact="'+esc(c.id)+'" style="display:flex;align-items:center;gap:.65rem;padding:.5rem;border-radius:8px;cursor:pointer;transition:background .12s" onmouseover="this.style.background=\'var(--color-alt,#f3f4f6)\'" onmouseout="this.style.background=\'transparent\'">' +
                '<div style="width:32px;height:32px;border-radius:999px;background:'+col2+';flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;color:#fff">'+esc(ini2)+'</div>' +
                '<div style="flex:1;min-width:0"><div style="font-size:.88rem;font-weight:600">'+esc(c.name||"(ukjent)")+'</div><div style="font-size:.75rem;color:var(--color-muted)">'+esc(c.email||"")+(act?" · "+act+" aktivitet":"")+'</div></div>' +
                '<i class="ti ti-chevron-right" style="color:var(--color-muted);font-size:.8rem"></i>' +
              '</div>';
            }).join("")) +
      '</div>';

    body.querySelector("[data-bed-back]").addEventListener("click",function(){crmSubView="bedrifter";renderAdmin(body);});
    var ef=body.querySelector("[data-bed-edit]");
    if (ef) ef.addEventListener("submit",function(e){
      e.preventDefault();
      updateBedrift(bedriftId,{name:body.querySelector("#be-name").value.trim(),orgNr:body.querySelector("#be-orgnr").value.trim(),phone:body.querySelector("#be-phone").value.trim(),website:body.querySelector("#be-website").value.trim(),address:body.querySelector("#be-address").value.trim(),invoiceEmail:body.querySelector("#be-invemail").value.trim(),invoiceAddress:body.querySelector("#be-invaddr").value.trim(),note:body.querySelector("#be-note").value.trim()});
      var st=body.querySelector("[data-be-status]"); st.textContent="Lagret."; st.className="form__status is-ok";
      setTimeout(function(){if(st)st.textContent="";},1500);
    });
    body.querySelectorAll("[data-open-contact]").forEach(function(el){
      el.addEventListener("click",function(){renderCustomer(body,el.getAttribute("data-open-contact"),{fromBedrift:bedriftId});});
    });
    var ncb=body.querySelector("[data-new-contact-for-bed]");
    if (ncb) ncb.addEventListener("click",function(){openNewCustomerDialog(body,bedriftId);});
  }

  function statPill(icon, value, label) {
    return '<div style="display:flex;align-items:center;gap:.3rem;font-size:.75rem;color:var(--color-muted)">' +
      '<i class="ti ti-'+icon+'" style="font-size:.85rem"></i>' +
      '<strong style="color:var(--color-text,#111)">'+esc(value)+'</strong><span>'+esc(label)+'</span></div>';
  }

  /* =========================================================================
     NY KONTAKT + NY BEDRIFT
     ====================================================================== */
  function openNewCustomerDialog(body, preBedriftId) {
    var preBed = preBedriftId ? getBedrifter().find(function(b){return b.id===preBedriftId;}) : null;
    openDialog({
      title:"Ny kontakt",
      bodyHtml:
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">'+dlgField("dlg-nc-name","Navn","text","","Ola Nordmann")+dlgField("dlg-nc-email","E-post *","email","","ola@bedrift.no")+'</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">'+dlgField("dlg-nc-bedrift","Bedrift","text",preBed?preBed.name:"","Bedrift AS")+dlgField("dlg-nc-phone","Telefon","tel","","")+'</div>' +
        dlgField("dlg-nc-note","Merknad","textarea","","") +
        '<p class="form__status" id="dlg-nc-status" style="margin:0;font-size:.85rem"></p>',
      footHtml: C.button({label:"Legg til",variant:"primary",attrs:'id="dlg-nc-save"'})+C.button({label:"Avbryt",variant:"ghost",attrs:'id="dlg-nc-cancel"'}),
      onMount:function(dl){
        dl.querySelector("#dlg-nc-cancel").addEventListener("click",function(){closeDialog(dl);});
        dl.querySelector("#dlg-nc-save").addEventListener("click",function(){
          var email=dl.querySelector("#dlg-nc-email").value.trim(), st=dl.querySelector("#dlg-nc-status");
          if (!email){st.textContent="E-post er påkrevd.";st.className="form__status is-err";return;}
          var list=getCustomers();
          if (list.find(function(c){return customerEmails(c).some(function(e){return e.toLowerCase()===email.toLowerCase();});})){st.textContent="E-post finst allereie.";st.className="form__status is-err";return;}
          var bedInput=dl.querySelector("#dlg-nc-bedrift").value.trim();
          var bed=bedInput?findOrCreateBedrift(bedInput):(preBed||null);
          var nums=list.map(function(c){return c.customerNumber;}).filter(Boolean);
          createCustomer({email:email,altEmails:[],name:dl.querySelector("#dlg-nc-name").value.trim(),phone:dl.querySelector("#dlg-nc-phone").value.trim(),address:"",note:dl.querySelector("#dlg-nc-note").value.trim(),customerNumber:App.generateUniqueNumber(nums),bedriftId:bed?bed.id:null});
          closeDialog(dl); renderAdmin(body);
        });
      }
    });
  }

  function openNewBedriftDialog(body) {
    openDialog({
      title:"Ny bedrift",
      bodyHtml:
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">'+dlgField("dlg-nb-name","Bedriftsnavn *","text","","Bedrift AS")+dlgField("dlg-nb-orgnr","Org.nr","text","","123 456 789")+'</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">'+dlgField("dlg-nb-phone","Telefon","tel","","")+dlgField("dlg-nb-website","Nettside","url","","https://")+'</div>' +
        dlgField("dlg-nb-invemail","Fakturamail","email","","faktura@bedrift.no") +
        '<p class="form__status" id="dlg-nb-status" style="margin:0;font-size:.85rem"></p>',
      footHtml: C.button({label:"Opprett",variant:"primary",attrs:'id="dlg-nb-save"'})+C.button({label:"Avbryt",variant:"ghost",attrs:'id="dlg-nb-cancel"'}),
      onMount:function(dl){
        dl.querySelector("#dlg-nb-cancel").addEventListener("click",function(){closeDialog(dl);});
        dl.querySelector("#dlg-nb-save").addEventListener("click",function(){
          var name=dl.querySelector("#dlg-nb-name").value.trim(), st=dl.querySelector("#dlg-nb-status");
          if (!name){st.textContent="Navn er påkrevd.";st.className="form__status is-err";return;}
          findOrCreateBedrift(name,{orgNr:dl.querySelector("#dlg-nb-orgnr").value.trim(),phone:dl.querySelector("#dlg-nb-phone").value.trim(),website:dl.querySelector("#dlg-nb-website").value.trim(),invoiceEmail:dl.querySelector("#dlg-nb-invemail").value.trim()});
          closeDialog(dl); renderAdmin(body);
        });
      }
    });
  }

  /* =========================================================================
     KUNDEKORT
     ====================================================================== */
  function renderCustomer(body, id, opts) {
    opts = opts||{};
    var customers = getCustomers(), c = customers.find(function(x){return x.id===id;});
    if (!c) { renderAdmin(body); return; }
    var bed=bedriftFor(c), emails=customerEmails(c), tl=getTimeline(id,emails), col=avatarColor(c.name||c.email), ini=initials(c.name||c.email);
    function refresh() { renderCustomer(body,id,opts); }

    body.innerHTML =
      '<button data-crm-back style="display:inline-flex;align-items:center;gap:.4rem;background:none;border:0;cursor:pointer;font:inherit;font-size:.85rem;color:var(--color-muted);padding:.2rem 0;margin-bottom:.75rem"><i class="ti ti-arrow-left"></i> '+(opts.fromBedrift?"Tilbake til "+(bed?esc(bed.name):"bedrift"):"Alle kunder")+'</button>' +

      '<div style="background:var(--color-surface,#fff);border:1px solid var(--color-border);border-radius:12px;padding:1rem;margin-bottom:.7rem">' +
        '<div style="display:flex;align-items:flex-start;gap:.9rem;margin-bottom:.9rem">' +
          '<div style="width:48px;height:48px;border-radius:999px;background:'+col+';flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:700;color:#fff">'+esc(ini)+'</div>' +
          '<div style="flex:1;min-width:0">' +
            '<h4 style="margin:0 0 .15rem;font-size:1.05rem">'+esc(c.name||c.email)+'</h4>' +
            '<div style="font-size:.8rem;color:var(--color-muted);display:flex;flex-wrap:wrap;gap:.15rem .45rem">' +
              (bed?'<span data-open-bed="'+esc(bed.id)+'" style="color:var(--color-primary);font-weight:600;cursor:pointer;text-decoration:underline;text-decoration-style:dotted">'+esc(bed.name)+'</span><span style="opacity:.4">·</span>':'') +
              (c.phone?'<a href="tel:'+esc(c.phone)+'" style="color:var(--color-muted)">'+esc(c.phone)+'</a><span style="opacity:.4">·</span>':'') +
              '<a href="mailto:'+esc(c.email)+'" style="color:var(--color-muted)">'+esc(c.email)+'</a>' +
            '</div>' +
            '<div style="font-size:.72rem;color:var(--color-muted);margin-top:.15rem">Kundenr. #'+esc(String(c.customerNumber||""))+' · Opprettet '+formatDate(c.created)+'</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:.35rem;flex-wrap:wrap;padding-top:.75rem;border-top:1px solid var(--color-border)">' +
          qaBtn("mail","E-post","crm-qa-email")+qaBtn("phone","Ring","crm-qa-phone")+
          qaBtn("notes","Notat","crm-qa-note")+qaBtn("paperclip","Dokument","crm-qa-doc")+
          qaBtn("circle-plus","Oppgave","crm-qa-task")+(window.VwChat?qaBtn("message-circle","Chat","crm-qa-chat"):"") +
        '</div>' +
      '</div>' +

      '<details style="background:var(--color-surface,#fff);border:1px solid var(--color-border);border-radius:12px;padding:.85rem 1rem;margin-bottom:.7rem">' +
        '<summary style="list-style:none;cursor:pointer;display:flex;align-items:center;gap:.45rem;font-size:.88rem;font-weight:700"><i class="ti ti-user" style="color:var(--color-primary,#2980B9)"></i> Kontaktinformasjon</summary>' +
        '<form data-crm-edit style="display:grid;gap:.55rem;margin-top:.8rem">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.55rem">'+dlgField("ce-name","Navn","text",c.name||"","")+dlgField("ce-email","E-post","email",c.email||"","")+'</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.55rem">'+dlgField("ce-bedrift","Bedrift","text",bed?bed.name:"","Bedrift AS")+dlgField("ce-phone","Telefon","tel",c.phone||"","")+'</div>' +
          dlgField("ce-address","Adresse","text",c.address||"","")+dlgField("ce-note","Merknad","textarea",c.note||"","") +
          '<div style="display:flex;gap:.4rem;align-items:center">'+C.button({label:"Lagre",variant:"primary",type:"submit",attrs:'style="font-size:.82rem"'})+(isWorkspaceMember()?'':C.button({label:"Slett kontakt",variant:"ghost",attrs:'data-crm-del-cust style="font-size:.82rem;border-color:#c0392b;color:#c0392b;margin-left:auto"'}))+'<span data-ce-status class="form__status" style="font-size:.82rem"></span></div>' +
        '</form>' +
      '</details>' +

      (bed?(function(){
        var others=contactsFor(bed.id).filter(function(x){return x.id!==id;});
        if (!others.length) return "";
        return '<div style="background:var(--color-surface,#fff);border:1px solid var(--color-border);border-radius:12px;padding:.85rem 1rem;margin-bottom:.7rem">' +
          '<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.65rem"><i class="ti ti-building" style="color:var(--color-primary)"></i><span style="font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-muted)">Andre hos '+esc(bed.name)+'</span></div>' +
          others.map(function(o){var oc=avatarColor(o.name||o.email),oi=initials(o.name||o.email);return'<div data-open-related="'+esc(o.id)+'" style="display:flex;align-items:center;gap:.6rem;padding:.4rem .5rem;border-radius:8px;cursor:pointer" onmouseover="this.style.background=\'var(--color-alt,#f3f4f6)\'" onmouseout="this.style.background=\'transparent\'"><div style="width:28px;height:28px;border-radius:999px;background:'+oc+';flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;color:#fff">'+esc(oi)+'</div><div><div style="font-size:.86rem;font-weight:600">'+esc(o.name||"(ukjent)")+'</div><div style="font-size:.75rem;color:var(--color-muted)">'+esc(o.email)+'</div></div></div>';}).join("") +
        '</div>';
      })():"") +

      '<div style="background:var(--color-surface,#fff);border:1px solid var(--color-border);border-radius:12px;padding:.85rem 1rem;margin-bottom:.7rem">' +
        '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.8rem">' +
          '<span style="font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-muted)">Tidslinje</span>' +
          (tl.length?'<span style="background:var(--color-primary);color:#fff;border-radius:999px;font-size:.65rem;padding:.1rem .4rem;font-weight:700">'+tl.length+'</span>':"") +
        '</div>' +
        (tl.length===0
          ? '<p style="font-size:.85rem;color:var(--color-muted);text-align:center;padding:1.2rem 0;margin:0">Ingen aktivitet ennå.</p>'
          : '<div data-tl-wrap></div>') +
      '</div>' +

      '<div style="background:var(--color-surface,#fff);border:1px solid var(--color-border);border-radius:12px;padding:.85rem 1rem;margin-bottom:.7rem">' +
        '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.7rem"><div style="width:20px;height:20px;border-radius:5px;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ti-sparkles" style="font-size:.7rem;color:#fff"></i></div><span style="font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-muted)">AI-assistent</span><span style="font-size:.65rem;font-weight:700;padding:.1rem .35rem;border-radius:999px;background:var(--color-alt,#f3f4f6);color:var(--color-muted)">Kommer snart</span></div>' +
        '<div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.6rem">'+["Oppsummer kunde","Lag svarutkast"].map(function(l){return'<button disabled style="display:inline-flex;align-items:center;gap:.3rem;padding:.35rem .7rem;border:1.5px solid var(--color-border);border-radius:999px;background:transparent;cursor:not-allowed;font:inherit;font-size:.78rem;font-weight:600;color:var(--color-muted);opacity:.55"><i class="ti ti-sparkles"></i> '+esc(l)+'</button>';}).join("")+'</div>' +
        '<div style="background:var(--color-alt,#f9fafb);border-radius:8px;padding:.6rem .8rem;font-size:.8rem;color:var(--color-muted)">Koble til Claude API under Innstillinger for å aktivere.</div>' +
      '</div>';

    body.querySelector("[data-crm-back]").addEventListener("click",function(){
      if (opts.fromBedrift) renderBedrift(body,opts.fromBedrift); else renderAdmin(body);
    });
    var obBtn=body.querySelector("[data-open-bed]");
    if (obBtn) obBtn.addEventListener("click",function(){renderBedrift(body,obBtn.getAttribute("data-open-bed"));});
    var form=body.querySelector("[data-crm-edit]");
    if (form) form.addEventListener("submit",function(e){
      e.preventDefault();
      var idx=customers.findIndex(function(x){return x.id===id;}); if(idx<0) return;
      var bi=body.querySelector("#ce-bedrift").value.trim();
      updateCustomer(id,{name:body.querySelector("#ce-name").value.trim(),email:body.querySelector("#ce-email").value.trim(),phone:body.querySelector("#ce-phone").value.trim(),address:body.querySelector("#ce-address").value.trim(),note:body.querySelector("#ce-note").value.trim(),bedriftId:bi?findOrCreateBedrift(bi).id:null});
      var st=body.querySelector("[data-ce-status]"); st.textContent="Lagret."; st.className="form__status is-ok";
      setTimeout(function(){if(st)st.textContent="";refresh();},800);
    });
    var delBtn=body.querySelector("[data-crm-del-cust]");
    if (delBtn) delBtn.addEventListener("click",function(){
      if (isWorkspaceMember()) return;
      if (!confirm("Slett kunden "+c.email+", inkludert alle henvendelser/tilbod, bookingar, kommunikasjonshistorikk og chatsamtalar knytt til e-postadressa? Kan ikkje angrast.")) return;
      deleteAllForEmail(customerEmails(c)); deleteCustomer(id);
      if (opts.fromBedrift) renderBedrift(body,opts.fromBedrift); else renderAdmin(body);
    });
    function qa(attr,fn){var b=body.querySelector("[data-qa='"+attr+"']");if(b)b.addEventListener("click",fn);}
    qa("crm-qa-email",function(){openEmailDialog(c,refresh);});
    qa("crm-qa-phone",function(){openPhoneDialog(c,refresh);});
    qa("crm-qa-note", function(){openNoteDialog(c,refresh);});
    qa("crm-qa-doc",  function(){openDocDialog(c,refresh);});
    qa("crm-qa-task", function(){openTaskDialog(c,refresh);});
    qa("crm-qa-chat", function(){openChatForCustomer(c);});
    var tlWrap=body.querySelector("[data-tl-wrap]");
    if (tlWrap) renderTlWrap(tlWrap,body,c,tl,refresh);
    body.querySelectorAll("[data-open-related]").forEach(function(el){el.addEventListener("click",function(){renderCustomer(body,el.getAttribute("data-open-related"),opts);});});
  }

  function qaBtn(icon,label,qaId){
    return '<button data-qa="'+qaId+'" style="display:inline-flex;align-items:center;gap:.3rem;padding:.38rem .72rem;border:1.5px solid var(--color-border,#d1d5db);border-radius:999px;background:transparent;cursor:pointer;font:inherit;font-size:.8rem;font-weight:600;color:var(--color-text,#111)" onmouseover="this.style.borderColor=\'var(--color-primary,#2980B9)\';this.style.background=\'color-mix(in srgb,var(--color-primary,#2980B9) 8%,transparent)\'" onmouseout="this.style.borderColor=\'var(--color-border,#d1d5db)\';this.style.background=\'transparent\'"><i class="ti ti-'+icon+'" style="font-size:.88rem;color:var(--color-primary,#2980B9)"></i> '+esc(label)+'</button>';
  }

  /* =========================================================================
     TIDSLINJE (med e-post-tråd-merking og sammenfall)
     ====================================================================== */
  var TL_COLLAPSED_LIMIT = 5;

  function buildTimeline(items, limit) {
    var threads={};
    items.forEach(function(it){if((it.type==="email_sent"||it.type==="email_received")&&it.threadId){threads[it.threadId]=(threads[it.threadId]||0)+1;}});
    var show = (limit && items.length > limit) ? items.slice(0, limit) : items;
    var html = show.map(function(it){return tlItem(it,threads);}).join("");
    if (limit && items.length > limit) {
      var hidden = items.length - limit;
      html += '<button data-tl-expand style="display:flex;align-items:center;gap:.35rem;margin:.65rem auto 0;padding:.38rem .9rem;border:1.5px dashed var(--color-border,#d1d5db);border-radius:999px;background:transparent;font:inherit;font-size:.8rem;font-weight:600;color:var(--color-muted);cursor:pointer;width:100%;justify-content:center">'+
        '<i class="ti ti-chevron-down" style="font-size:.85rem"></i> Vis '+hidden+' eldre hendelse'+(hidden!==1?"r":"")+'</button>';
    }
    return html;
  }

  function bindTimelineActions(scope, body, c, tl, refresh) {
    scope.querySelectorAll("[data-del-comm]").forEach(function(btn){btn.addEventListener("click",function(e){e.stopPropagation();if(isWorkspaceMember())return;if(!confirm("Fjern hendelse?"))return;deleteComm(btn.getAttribute("data-del-comm"));refresh();});});
    scope.querySelectorAll("[data-task-toggle]").forEach(function(btn){btn.addEventListener("click",function(e){e.stopPropagation();updateComm(btn.getAttribute("data-task-toggle"),{done:true});refresh();});});
    scope.querySelectorAll("[data-reply-email]").forEach(function(btn){btn.addEventListener("click",function(e){e.stopPropagation();var orig=getComms().find(function(x){return x.id===btn.getAttribute("data-reply-email");});openEmailDialog(c,refresh,orig);});});
    scope.querySelectorAll("[data-tl-item]").forEach(function(row){
      function openRow(){
        var item=tl.find(function(x){return x.id===row.getAttribute("data-tl-item");});
        if (item) openTlItem(item,c,refresh,body);
      }
      row.addEventListener("click",openRow);
      // Rada er tabindex="0" role="button" (klikkbar heile tidslinje-posten),
      // treng difor eit tastatur-ekvivalent — Enter/mellomrom, same konvensjon
      // som ekte <button>-element (2026-07-06, UX-gjennomgang).
      row.addEventListener("keydown",function(e){
        if (e.target !== row) return; // ikkje trigge når fokus er på ein knapp INNI rada
        if (e.key==="Enter"||e.key===" "||e.key==="Spacebar"){ e.preventDefault(); openRow(); }
      });
    });
    var exp=scope.querySelector("[data-tl-expand]");
    if (exp) exp.addEventListener("click",function(){
      scope.innerHTML=buildTimeline(tl);
      bindTimelineActions(scope,body,c,tl,refresh);
    });
  }

  // Klikk på sjølve tidslinje-rada (ikkje berre ein liten redigerings-knapp)
  // opnar den relevante handlinga, uavhengig av om posten er redigerbar eller
  // ikkje — gjenbruker eksisterande dialogar/navigasjon der dei finst, bygger
  // ikkje nye visningsmodalar.
  function openTlItem(item, c, refresh, body) {
    if (item.source === "comm") {
      if      (item.type==="phone_note")    return openPhoneDialog(c,refresh,item);
      else if (item.type==="internal_note") return openNoteDialog(c,refresh,item);
      else if (item.type==="task")          return openTaskDialog(c,refresh,item);
      else if (item.type==="document")      return openDocDialog(c,refresh,item);
      else if (item.type==="email_sent"||item.type==="email_received") return openEmailDialog(c,refresh,item);
      return;
    }
    if (item.source === "legacy") {
      if (item.type === "booking") {
        if (document.getElementById("intranet") && window.Intranet) window.Intranet.navigate("booking");
        else { var tab=document.querySelector("[data-tab='mod-booking']"); if (tab) tab.click(); }
        return;
      }
      var lead = App.getLeads ? App.getLeads().find(function (l) { return l.id===item.id; }) : null;
      if (!lead || !App.openReplyModal) return;
      var isQ = item.type === "quote";
      App.setLeadStatus(item.id, "løst");
      var dato = lead.time ? new Date(lead.time).toLocaleString("nb-NO",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "";
      App.openReplyModal({
        name: lead.name, email: lead.email,
        subject: (isQ?"Re: Tilbudsforespørsel – ":"Re: Henvendelse fra ")+(lead.name||""),
        templateKey: isQ?"tilbud":"kontakt", defaultTemplate: App.DEFAULT_REPLY_TEMPLATE,
        templateOptions: App.buildTemplateOptions([{ key: isQ?"tilbud":"kontakt", label: isQ?"Standardmal for tilbud":"Standardmal for kontakt", defaultTemplate: App.DEFAULT_REPLY_TEMPLATE }]),
        signatureOptions: App.buildSignatureOptions(),
        vars: { navn: lead.name||"", epost: lead.email||"", dato: dato, melding: lead.message||"", referanse: lead.referenceNumber||"" },
        previewHtml: '<div class="admin-lead-msg">'+esc(lead.message||"").replace(/\n/g,"<br>")+'</div>',
        chatId: (lead.source==="chat"&&lead.chatId) ? lead.chatId : null
      });
      refresh();
      return;
    }
    if (item.source === "chat") return openChatHistoryDialog(item, c, refresh);
  }

  // Les-berre historikk for éin chat-samtale, opna frå Kunder-tidslinja i
  // staden for å navigere heilt vekk til Chat-fana (ønska av brukar
  // 2026-07-17: kunden skreiv noko i chatten, forlot han, og admin tek opp
  // tråden via e-post — dei har alltid e-posten sidan chat krev registrering
  // med e-post for å starte). "Svar via e-post" gjenbruker den eksisterande
  // openEmailDialog()-mekanismen uendra (same mønster som e-post-comm-svar),
  // IKKJE ein ny e-post-veg. "Opne i Chat" er framleis tilgjengeleg for ein
  // samtale som enno er open og treng eit ekte, live svar der og då.
  function chatMsgTimestamp(at) {
    var d = new Date(at || 0);
    return isNaN(d.getTime()) ? "" : d.toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function chatMsgsHtml(msgs) {
    return msgs.length
      ? msgs.filter(function (m) { return m.sender !== "system"; }).map(function (m) {
          var isOp = m.sender === "operator";
          return '<div style="display:flex;' + (isOp ? "justify-content:flex-end" : "justify-content:flex-start") + '">' +
            '<div style="max-width:75%;padding:.55rem .75rem;border-radius:12px;font-size:.85rem;line-height:1.4;' +
              (isOp
                ? "background:var(--color-primary,#2980B9);color:#fff;border-bottom-right-radius:3px"
                : "background:var(--color-alt,#f3f4f6);color:var(--color-text);border-bottom-left-radius:3px") +
            '">' + esc(m.text || "") +
              '<div style="font-size:.68rem;opacity:.7;margin-top:.2rem">' + esc(chatMsgTimestamp(m.at)) + '</div>' +
            '</div>' +
          '</div>';
        }).join("")
      : '<p style="text-align:center;font-size:.85rem;color:var(--color-muted);padding:1.5rem 0;margin:0">Ingen meldinger i denne samtalen.</p>';
  }

  function openChatHistoryDialog(item, c, refresh) {
    var Chat = window.VwChat;
    var conv = Chat && Chat.getConv ? Chat.getConv(item.chatId) : null;
    var msgs = Chat && Chat.getMsgs ? Chat.getMsgs(item.chatId) : [];
    var isClosed = !conv || conv.status === "closed";
    function statusText() {
      return isClosed
        ? "Samtalen er lukket — kunden er ikke lenger til stede. Bruk «Svar via e-post» for å følge opp."
        : "Samtalen er fortsatt åpen.";
    }
    var dl = openDialog({
      title: "Chat-samtale" + (conv && conv.name ? " med " + conv.name : ""),
      wide: true,
      bodyHtml:
        '<p class="crm-chat-status" style="font-size:.78rem;color:var(--color-muted);margin:0">' + esc(statusText()) + '</p>' +
        '<div class="crm-chat-msgs" style="display:grid;gap:.5rem">' + chatMsgsHtml(msgs) + '</div>',
      footHtml:
        C.button({ label: "Svar via e-post", variant: "primary", attrs: 'id="dlg-chat-email"' }) +
        (conv ? C.button({ label: "Åpne i Chat", variant: "ghost", attrs: 'id="dlg-chat-open"' }) : ""),
      onMount: function (dialogEl) {
        dialogEl.querySelector("#dlg-chat-email").addEventListener("click", function () {
          closeDialog(dialogEl);
          var lastVisitorMsg = msgs.filter(function (m) { return m.sender === "visitor"; }).slice(-1)[0];
          openEmailDialog(c, refresh, {
            subject: "Chat-samtale" + (conv && conv.name ? " med " + conv.name : ""),
            html: lastVisitorMsg ? '<div class="admin-lead-msg">' + esc(lastVisitorMsg.text || "") + '</div>' : ""
          });
        });
        var openBtn = dialogEl.querySelector("#dlg-chat-open");
        if (openBtn) openBtn.addEventListener("click", function () {
          closeDialog(dialogEl);
          var CAdmin = window.VwChatAdmin;
          if (CAdmin && CAdmin.openConv) CAdmin.openConv(item.chatId);
          if (document.getElementById("intranet") && window.Intranet) window.Intranet.navigate("chat");
          else { var tab2 = document.querySelector("[data-tab='chat-admin']"); if (tab2) tab2.click(); }
        });
      }
    });

    // Lokal cache kan vere forelda/tom viss admin opnar CRM utan å ha vore
    // innom Chat-fana denne økta (det er det som elles utløyser fyrste
    // hydrering, sjå module-chat.js sin _adminHydrated-gate). Hent på nytt i
    // bakgrunnen og oppdater dialogen i staden for å stole blindt på det som
    // alt måtte liggje i localStorage -- UX-gjennomgang 2026-07-17.
    if (Chat && Chat.hydrateFromSupabase) {
      Chat.hydrateFromSupabase(function () {
        if (!dl.parentNode) return; // brukar lukka dialogen før hydreringa vart ferdig
        conv = Chat.getConv ? Chat.getConv(item.chatId) : conv;
        msgs = Chat.getMsgs ? Chat.getMsgs(item.chatId) : msgs;
        isClosed = !conv || conv.status === "closed";
        var statusEl = dl.querySelector(".crm-chat-status");
        var msgsEl = dl.querySelector(".crm-chat-msgs");
        if (statusEl) statusEl.textContent = statusText();
        if (msgsEl) msgsEl.innerHTML = chatMsgsHtml(msgs);
      });
    }
  }

  function tlFilterBar(activeCats, presentCats) {
    if (presentCats.length < 2) return "";
    return '<div data-tl-filters style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.7rem">' +
      presentCats.map(function (cat) {
        var active = activeCats.indexOf(cat.id) > -1;
        return '<button type="button" data-tl-filter="'+cat.id+'" style="padding:.22rem .62rem;border-radius:999px;font:inherit;font-size:.72rem;font-weight:600;cursor:pointer;border:1.5px solid '+(active?"var(--color-primary,#2980B9)":"var(--color-border,#d1d5db)")+';background:'+(active?"var(--color-primary,#2980B9)":"transparent")+';color:'+(active?"#fff":"var(--color-muted)")+'">'+esc(cat.label)+' ('+cat.count+')</button>';
      }).join("") +
    '</div>';
  }

  // Renderer filterknappar + sjølve tidslinja saman, og kan kallast på nytt
  // åleine (ved filterklikk) utan å måtte re-rendre heile kundekortet — held
  // difor filterstoda i _tlFilter i staden for ein lokal closure-variabel som
  // ville vorte nullstilt kvar gong refresh() køyrer renderCustomer() på nytt.
  function renderTlWrap(wrap, body, c, tl, refresh) {
    var presentCats = TL_CATEGORIES.map(function (cat) {
      var count = tl.filter(function (it) { return cat.types.indexOf(it.type) > -1; }).length;
      return { id: cat.id, label: cat.label, count: count };
    }).filter(function (cat) { return cat.count > 0; });
    var allIds = presentCats.map(function (cat) { return cat.id; });
    var activeCats = _tlFilter[c.id] || allIds;
    var filteredTl = tl.filter(function (it) { return activeCats.indexOf(tlCategoryId(it)) > -1; });
    wrap.innerHTML = tlFilterBar(activeCats, presentCats) +
      '<div data-tl-section>' +
        (filteredTl.length
          ? buildTimeline(filteredTl, TL_COLLAPSED_LIMIT)
          : '<p style="font-size:.85rem;color:var(--color-muted);text-align:center;padding:1rem 0;margin:0">Ingen hendelser i valgt filter.</p>') +
      '</div>';
    wrap.querySelectorAll("[data-tl-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var catId = btn.getAttribute("data-tl-filter");
        var cur = _tlFilter[c.id] || allIds;
        _tlFilter[c.id] = cur.indexOf(catId) > -1 ? cur.filter(function (x) { return x !== catId; }) : cur.concat([catId]);
        renderTlWrap(wrap, body, c, tl, refresh);
      });
    });
    var tlSection = wrap.querySelector("[data-tl-section]");
    if (tlSection) bindTimelineActions(tlSection, body, c, filteredTl, refresh);
  }

  function tlItem(item, threads) {
    var conf=TL_CONF[item.type]||TL_CONF["default"], time=formatAgo(item.created), isComm=item.source==="comm";
    var isEmail=item.type==="email_sent"||item.type==="email_received";
    var threadCount=(isEmail&&item.threadId&&threads)?threads[item.threadId]||0:0;
    var bodyText="";
    if      (item.type==="phone_note")  bodyText=[item.duration?"Varighet: "+item.duration:"",item.note].filter(Boolean).join(" · ");
    else if (item.type==="internal_note") bodyText=item.text||"";
    else if (isEmail)                   bodyText=item.subject?"Emne: "+item.subject:"";
    else if (item.type==="document")    bodyText=item.docType||"";
    else if (item.type==="task")        bodyText=item.dueDate?"Frist: "+item.dueDate:item.note||"";
    else                                bodyText=item.body||"";
    // Re-sanitize at display time, not just at save — a member could otherwise
    // write crm_comms.data.html directly via REST (RLS allows it) and skip
    // client-side sanitization entirely; this is the "extra safety at display"
    // backstop C.sanitizeRichHtml's own design comment describes.
    var bodyHtml=C.sanitizeRichHtml(item.html||item.noteHtml||"");
    var tagBadge="";
    if (item.type==="internal_note"&&item.tag&&item.tag!=="normal"){var tc={important:"var(--color-primary,#2980B9)",followup:"#E8833A"},tl2={important:"Viktig",followup:"Oppfølging"};tagBadge=' <span style="font-size:.67rem;font-weight:700;padding:.1rem .38rem;border-radius:999px;background:color-mix(in srgb,'+(tc[item.tag]||"#999")+' 13%,transparent);color:'+(tc[item.tag]||"#999")+'">'+esc(tl2[item.tag]||item.tag)+'</span>';}
    if (item.type==="task"&&item.done) tagBadge=' <span style="font-size:.67rem;font-weight:700;padding:.1rem .38rem;border-radius:999px;background:color-mix(in srgb,#27AE60 12%,transparent);color:#27AE60">Ferdig ✓</span>';
    if (threadCount>1) tagBadge+=' <span style="font-size:.67rem;font-weight:700;padding:.1rem .38rem;border-radius:999px;background:color-mix(in srgb,#2980B9 12%,transparent);color:#2980B9">'+threadCount+' i tråd</span>';
    if (item.source==="legacy"&&item.status) tagBadge+=' <span class="stat-badge stat-badge--'+esc(item.status)+'">'+({"ny":"Ny","lest":"Lest","løst":"Løst"}[item.status]||esc(item.status))+'</span>';
    return '<div data-tl-item="'+esc(item.id)+'" class="crm-tl-row" tabindex="0" role="button" style="display:flex;gap:.65rem;padding:.65rem 0;border-bottom:1px solid var(--color-border,#e5e7eb);cursor:pointer">' +
      '<div style="flex-shrink:0;margin-top:.1rem"><div style="width:28px;height:28px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,'+conf.color+' 13%,white);border:1.5px solid color-mix(in srgb,'+conf.color+' 28%,transparent)"><i class="ti ti-'+conf.icon+'" style="font-size:.78rem;color:'+conf.color+'"></i></div></div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.4rem">' +
          '<div style="min-width:0"><span style="font-size:.86rem;font-weight:600">'+esc(item.title||conf.label)+'</span>'+tagBadge+'</div>' +
          '<div style="display:flex;align-items:center;gap:.4rem;flex-shrink:0">' +
            (item.type==="task"&&!item.done&&isComm?'<button data-task-toggle="'+esc(item.id)+'" class="crm-tl-btn" style="font-size:.72rem;padding:.32rem .6rem;border:1.5px solid var(--color-border);border-radius:6px;background:none;cursor:pointer;color:var(--color-muted)">Fullfør</button>':'') +
            (isEmail&&isComm?'<button data-reply-email="'+esc(item.id)+'" class="crm-tl-btn" style="font-size:.72rem;padding:.32rem .6rem;border:1.5px solid var(--color-border);border-radius:6px;background:none;cursor:pointer;color:var(--color-muted)">Svar</button>':'') +
            (isComm&&!isWorkspaceMember()?'<button data-del-comm="'+esc(item.id)+'" class="crm-tl-del" style="background:none;border:0;cursor:pointer;color:var(--color-muted);padding:.1rem;line-height:1;font-size:.85rem" title="Fjern"><i class="ti ti-x"></i></button>':'') +
            '<span style="font-size:.7rem;color:var(--color-muted);white-space:nowrap">'+esc(time)+'</span>' +
          '</div>' +
        '</div>' +
        (bodyText||bodyHtml?'<div style="font-size:.78rem;color:var(--color-muted);margin-top:.18rem;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical">'+(bodyHtml||esc(bodyText))+'</div>':"") +
        (item.type==="document"&&item.attachment?'<div style="margin-top:.35rem">'+attachmentChip(item.attachment)+'</div>':"") +
        '<span style="display:inline-block;margin-top:.25rem;font-size:.67rem;font-weight:600;padding:.08rem .38rem;border-radius:999px;background:var(--color-alt,#f3f4f6);color:var(--color-muted)">'+esc(conf.label)+'</span>' +
      '</div>' +
      '<i class="ti ti-chevron-right" style="align-self:center;flex-shrink:0;color:var(--color-muted);opacity:.4;font-size:.85rem"></i>' +
      '</div>';
  }

  /* =========================================================================
     SLÅ SAMAN KONTAKTER — VELG PRIMÆR
     ====================================================================== */
  function openMergeDialog(toMerge, body) {
    openDialog({
      title: "Slå sammen kontakter",
      bodyHtml:
        '<p style="font-size:.85rem;color:var(--color-muted);margin:0 0 .8rem">Velg hvilken kontakt som er primær. Den primære beholder sin e-postadresse. De andre e-postadressene legges til som alternative adresser.</p>' +
        '<div style="display:grid;gap:.45rem">' +
          toMerge.map(function(c,idx){
            var bed=bedriftFor(c), col=avatarColor(c.name||c.email), ini=initials(c.name||c.email);
            return '<label style="display:flex;align-items:flex-start;gap:.75rem;padding:.75rem;border:1.5px solid var(--color-border,#d1d5db);border-radius:10px;cursor:pointer;transition:border-color .12s">' +
              '<input type="radio" name="merge-primary" value="'+esc(c.id)+'" '+(idx===0?"checked":"")+' style="margin-top:.2rem;accent-color:var(--color-primary,#2980B9)">' +
              '<div style="display:flex;align-items:center;gap:.65rem;flex:1;min-width:0">' +
                '<div style="width:36px;height:36px;border-radius:999px;background:'+col+';flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:700;color:#fff">'+esc(ini)+'</div>' +
                '<div style="min-width:0">' +
                  '<div style="font-size:.92rem;font-weight:600">'+esc(c.name||"(ukjent)")+'</div>' +
                  '<div style="font-size:.82rem;color:var(--color-muted)">'+esc(c.email)+(bed?" · "+esc(bed.name):"")+'</div>' +
                  (c.altEmails&&c.altEmails.length?'<div style="font-size:.75rem;color:var(--color-muted)">Alt: '+c.altEmails.map(esc).join(", ")+'</div>':'')+
                  '<div style="font-size:.72rem;color:var(--color-muted)">Opprettet '+formatDate(c.created)+'</div>' +
                '</div>' +
              '</div>' +
            '</label>';
          }).join("") +
        '</div>',
      footHtml: C.button({label:"Slå sammen",variant:"primary",attrs:'id="dlg-merge-ok"'})+C.button({label:"Avbryt",variant:"ghost",attrs:'id="dlg-merge-cancel"'}),
      onMount:function(dl){
        function closeDlg() { try{dl.close();}catch(e){} if(dl.parentNode)dl.remove(); }
        dl.querySelector("#dlg-merge-cancel").addEventListener("click", closeDlg);
        dl.querySelectorAll("input[name='merge-primary']").forEach(function(radio){
          radio.closest("label").addEventListener("change",function(){
            dl.querySelectorAll("label").forEach(function(l){l.style.borderColor="var(--color-border,#d1d5db)";});
            var checked=dl.querySelector("input[name='merge-primary']:checked");
            if (checked) checked.closest("label").style.borderColor="var(--color-primary,#2980B9)";
          });
        });
        var first=dl.querySelector("input[name='merge-primary']:checked");
        if (first) first.closest("label").style.borderColor="var(--color-primary,#2980B9)";

        dl.querySelector("#dlg-merge-ok").addEventListener("click",function(){
          var sel=dl.querySelector("input[name='merge-primary']:checked");
          if (!sel) return;
          doMerge(toMerge,sel.value,function(){ closeDlg(); renderAdmin(body); });
        });
      }
    });
  }

  // cb() kalt når sammenslåinga er ferdig lagra. Bruker atomisk RPC server-side
  // (merge_crm_customers() i migration.sql, med brukarvald primærkunde) når
  // Supabase er konfigurert — eit fleir-steg klient-orkestrert merge (N-1
  // delete + 1 update) kunne elles skilje dupliserte/foreldrelause rader att
  // viss nettverket feila midtvegs. RPC-en flyttar òg kommunikasjonshistorikken
  // (crm_comms) til den overlevande kunden FØR sletting av dei andre — den
  // gamle store-baserte versjonen av denne funksjonen gjorde ALDRI dette
  // (historikken vart verande i comms-arrayen, men ikkje lenger nåbar, sidan
  // ingen kunde-rad lenger peika på ho). Med ekte FOREIGN KEY + ON DELETE
  // CASCADE ville same åtferd blitt reell datatap i staden for berre
  // uoppdageleg data.
  function doMerge(toMerge, primaryId, cb) {
    var ids = toMerge.map(function (c) { return c.id; });
    if (!_sb) {
      var list=getCustomers(), primary=list.find(function(c){return c.id===primaryId;}); if(!primary) { cb && cb(); return; }
      var allEmails=[], allNotes=[], bedriftId=primary.bedriftId;
      toMerge.forEach(function(c){
        customerEmails(c).forEach(function(e){if(allEmails.indexOf(e)===-1)allEmails.push(e);});
        if(c.note&&c.note.trim()) allNotes.push(c.note.trim());
        if(!bedriftId&&c.bedriftId) bedriftId=c.bedriftId;
      });
      var primEmail=primary.email;
      allEmails=[primEmail].concat(allEmails.filter(function(e){return e!==primEmail;}));
      primary.email=allEmails[0]; primary.altEmails=allEmails.slice(1);
      primary.note=allNotes.join(" / "); primary.bedriftId=bedriftId;
      if (!primary.name) { var wn=toMerge.find(function(c){return c.id!==primaryId&&c.name;}); if(wn) primary.name=wn.name; }
      var drop=ids.filter(function(id){return id!==primaryId;});
      _customers = list.filter(function(c){return drop.indexOf(c.id)===-1;});
      App.store.set(CUST_KEY, _customers);
      cb && cb();
      return;
    }
    _sb.rpc("merge_crm_customers", { p_ids: ids, p_primary_id: primaryId }).then(function (r) {
      if (r.error || !r.data) { cb && cb(); return; }
      var merged = dbCustomerToJs(r.data);
      _customers = _customers.filter(function (c) { return ids.indexOf(c.id) === -1 || c.id === merged.id; });
      var idx = _customers.findIndex(function (c) { return c.id === merged.id; });
      if (idx >= 0) _customers[idx] = merged;
      // Historikken vart flytta server-side (sjå RPC) — oppdater lokal cache
      // sin customerId-referanse for dei sammenslegne kundane sine comms.
      _comms.forEach(function (c) { if (ids.indexOf(c.customerId) > -1) c.customerId = merged.id; });
      cb && cb();
    });
  }

  /* =========================================================================
     CRM-INNSTILLINGER (signaturer · maler · standardtekster)
     ====================================================================== */
  function openCrmSettingsDialog() {
    openDialog({
      title: "CRM-innstillinger", wide: true,
      bodyHtml:
        '<div id="crms-tabbar" style="display:flex;gap:0;border-bottom:1px solid var(--color-border,#e5e7eb);margin-bottom:.9rem">' +
          crmStab("sig","Signaturer")+crmStab("maler","E-postmaler")+crmStab("tekster","Standardtekster") +
        '</div>' +
        '<div id="crms-content"></div>',
      footHtml: C.button({label:"Lukk",variant:"ghost",attrs:'id="crms-close"'}),
      onMount: function(dl) {
        dl.querySelector("#crms-close").addEventListener("click",function(){closeDialog(dl);});
        function activate(id) {
          dl.querySelectorAll("[data-crms-tab]").forEach(function(b){
            var on=b.getAttribute("data-crms-tab")===id;
            b.style.borderBottom=on?"2.5px solid var(--color-primary,#2980B9)":"2.5px solid transparent";
            b.style.color=on?"var(--color-primary,#2980B9)":"var(--color-muted)";
            b.style.fontWeight=on?"700":"500";
          });
          var c=dl.querySelector("#crms-content");
          if (id==="sig") crmsRenderSig(c);
          else if (id==="maler") crmsRenderMaler(c);
          else crmsRenderTekster(c);
        }
        dl.querySelectorAll("[data-crms-tab]").forEach(function(b){
          b.addEventListener("click",function(){activate(b.getAttribute("data-crms-tab"));});
        });
        activate("sig");
      }
    });
  }

  function crmStab(id,label) {
    return '<button type="button" data-crms-tab="'+id+'" style="padding:.45rem .9rem;background:none;border:0;border-bottom:2.5px solid transparent;font:inherit;font-size:.88rem;font-weight:500;color:var(--color-muted);cursor:pointer">'+esc(label)+'</button>';
  }

  function crmsRenderSig(c) {
    var s=getCrmSettings();
    c.innerHTML=
      '<p style="font-size:.85rem;color:var(--color-muted);margin:0 0 .7rem">Signaturene blir tilgjengelige som «Sett inn»-knapper i e-postdialogen — de settes ikke inn automatisk, slik at du velger bevisst hvilken (eller ingen) som skal med.</p>' +
      rtField("crms-sig-co","Bedriftssignatur (felles)",s.signatureCompany||"")+
      rtField("crms-sig-pe","Min personlige signatur",s.signaturePersonal||"")+
      '<div style="display:flex;gap:.4rem;align-items:center;margin-top:.5rem">'+
        C.button({label:"Lagre",variant:"primary",attrs:'id="crms-sig-save" style="font-size:.82rem"'})+
        '<span id="crms-sig-st" class="form__status" style="font-size:.82rem"></span>'+
      '</div>';
    bindRt(c);
    c.querySelector("#crms-sig-save").addEventListener("click",function(){
      saveCrmSettings(Object.assign(getCrmSettings(),{signatureCompany:readRt(c,"crms-sig-co"),signaturePersonal:readRt(c,"crms-sig-pe")}));
      var st=c.querySelector("#crms-sig-st");st.textContent="Lagret.";st.className="form__status is-ok";
      setTimeout(function(){if(st)st.textContent="";},2000);
    });
  }

  function crmsRenderMaler(c, editId) {
    var templates=getCrmSettings().templates||[];
    var editing=editId?(editId==="new"?{}:templates.find(function(t){return t.id===editId;})||null):null;
    c.innerHTML=
      '<div style="display:flex;justify-content:flex-end;margin-bottom:.65rem">'+
        (editing===null?C.button({label:"Ny mal",icon:"plus",variant:"primary",attrs:'id="crms-ny-mal" style="font-size:.82rem"'}):'') +
      '</div>' +
      (templates.length===0&&editing===null
        ? '<p style="font-size:.85rem;color:var(--color-muted);text-align:center;padding:1.2rem 0;margin:0">Ingen maler ennå. Opprett en mal for gjenbruk i e-postdialogen.</p>'
        : '<div style="display:grid;gap:.4rem">'+templates.map(function(t){
            return '<div style="display:flex;align-items:center;gap:.55rem;padding:.55rem .75rem;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface)">' +
              '<div style="flex:1;min-width:0"><div style="font-size:.88rem;font-weight:600">'+esc(t.name)+'</div>'+(t.subject?'<div style="font-size:.75rem;color:var(--color-muted)">'+esc(t.subject)+'</div>':'')+
              '</div>' +
              '<button type="button" data-edit-mal="'+esc(t.id)+'" style="font-size:.78rem;padding:.22rem .5rem;border:1.5px solid var(--color-border);border-radius:6px;background:none;cursor:pointer">Rediger</button>' +
              '<button type="button" data-del-mal="'+esc(t.id)+'" style="font-size:.78rem;padding:.22rem .5rem;border:1.5px solid #c0392b;border-radius:6px;background:none;cursor:pointer;color:#c0392b">Slett</button>' +
            '</div>';
          }).join("")+'</div>') +
      (editing!==null
        ? '<div style="border-top:1px solid var(--color-border);padding-top:.9rem;margin-top:.9rem;display:grid;gap:.55rem">' +
            '<h5 style="margin:0 0 .2rem;font-size:.88rem">'+(editId==="new"?"Ny mal":"Rediger mal")+'</h5>' +
            '<p style="font-size:.78rem;color:var(--color-muted);margin:0">Kan brukast i emne og innhald — fyllast inn automatisk når malen vert valgt i e-postdialogen: {navn}, {epost}, {bedrift}, {kundenummer}. Ukjende plassholdarar vert ikkje erstatta.</p>' +
            dlgField("crms-mal-name","Navn *","text",editing.name||"","Tilbudssvar") +
            dlgField("crms-mal-subj","Emne","text",editing.subject||"","Svar på din forespørsel") +
            rtField("crms-mal-body","Innhold",editing.body||"") +
            '<div style="display:flex;gap:.4rem;align-items:center">'+
              C.button({label:"Lagre mal",variant:"primary",attrs:'id="crms-mal-save" style="font-size:.82rem"'})+
              C.button({label:"Avbryt",variant:"ghost",attrs:'id="crms-mal-cancel" style="font-size:.82rem"'})+
              '<span id="crms-mal-st" class="form__status" style="font-size:.82rem"></span>'+
            '</div>'+
          '</div>'
        :'');
    if (editing!==null) bindRt(c);
    var nyBtn=c.querySelector("#crms-ny-mal");
    if (nyBtn) nyBtn.addEventListener("click",function(){crmsRenderMaler(c,"new");});
    c.querySelectorAll("[data-edit-mal]").forEach(function(b){b.addEventListener("click",function(){crmsRenderMaler(c,b.getAttribute("data-edit-mal"));});});
    c.querySelectorAll("[data-del-mal]").forEach(function(b){b.addEventListener("click",function(){if(!confirm("Slett denne malen?"))return;deleteTemplate(b.getAttribute("data-del-mal"));crmsRenderMaler(c);});});
    if (editing!==null) {
      c.querySelector("#crms-mal-cancel").addEventListener("click",function(){crmsRenderMaler(c);});
      c.querySelector("#crms-mal-save").addEventListener("click",function(){
        var name=c.querySelector("#crms-mal-name").value.trim(), st=c.querySelector("#crms-mal-st");
        if (!name){st.textContent="Navn er påkrevd.";st.className="form__status is-err";return;}
        saveTemplate({id:editId==="new"?"mal-"+Date.now():editId,name:name,subject:c.querySelector("#crms-mal-subj").value.trim(),body:readRt(c,"crms-mal-body")});
        crmsRenderMaler(c);
      });
    }
  }

  function crmsRenderTekster(c, editId) {
    var snippets=getCrmSettings().snippets||[];
    var editing=editId?(editId==="new"?{}:snippets.find(function(s){return s.id===editId;})||null):null;
    c.innerHTML=
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.65rem">' +
        '<span style="font-size:.82rem;color:var(--color-muted)">Skriv <strong>#nøkkelord</strong> i chat-svarruten for å sette inn tekst raskt. Støtter {namn} og {epost} — fylles inn fra samtalen. Ukjende plassholdarar vert ikkje erstatta.</span>' +
        (editing===null?C.button({label:"Nytt svar",icon:"plus",variant:"primary",attrs:'id="crms-ny-sn" style="font-size:.82rem"'}):'') +
      '</div>' +
      (snippets.length===0&&editing===null
        ? '<p style="font-size:.85rem;color:var(--color-muted);text-align:center;padding:1.2rem 0;margin:0">Ingen standardtekster ennå.</p>'
        : '<div style="display:grid;gap:.4rem">'+snippets.map(function(s){
            return '<div style="display:flex;align-items:center;gap:.55rem;padding:.55rem .75rem;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface)">' +
              '<div style="flex:1;min-width:0">' +
                '<span style="font-size:.8rem;font-weight:700;color:var(--color-primary)">#'+esc(s.shortcode)+'</span>' +
                '<span style="font-size:.85rem;font-weight:600;margin-left:.35rem">'+esc(s.title)+'</span>' +
                '<div style="font-size:.75rem;color:var(--color-muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">'+esc((s.body||"").slice(0,60))+'</div>' +
              '</div>' +
              '<button type="button" data-edit-sn="'+esc(s.id)+'" style="font-size:.78rem;padding:.22rem .5rem;border:1.5px solid var(--color-border);border-radius:6px;background:none;cursor:pointer">Rediger</button>' +
              '<button type="button" data-del-sn="'+esc(s.id)+'" style="font-size:.78rem;padding:.22rem .5rem;border:1.5px solid #c0392b;border-radius:6px;background:none;cursor:pointer;color:#c0392b">Slett</button>' +
            '</div>';
          }).join("")+'</div>') +
      (editing!==null
        ? '<div style="border-top:1px solid var(--color-border);padding-top:.9rem;margin-top:.9rem;display:grid;gap:.55rem">' +
            '<h5 style="margin:0 0 .2rem;font-size:.88rem">'+(editId==="new"?"Nytt svar":"Rediger svar")+'</h5>' +
            dlgField("crms-sn-code","Nøkkelord (uten #) *","text",editing.shortcode||"","tilbud") +
            dlgField("crms-sn-title","Tittel (vises i listen) *","text",editing.title||"","Vår tilbudsprosess") +
            dlgField("crms-sn-body","Tekst *","textarea",editing.body||"","Takk for din henvendelse...") +
            '<div style="display:flex;gap:.4rem;align-items:center">'+
              C.button({label:"Lagre",variant:"primary",attrs:'id="crms-sn-save" style="font-size:.82rem"'})+
              C.button({label:"Avbryt",variant:"ghost",attrs:'id="crms-sn-cancel" style="font-size:.82rem"'})+
              '<span id="crms-sn-st" class="form__status" style="font-size:.82rem"></span>'+
            '</div>'+
          '</div>'
        :'');
    var nyBtn=c.querySelector("#crms-ny-sn");
    if (nyBtn) nyBtn.addEventListener("click",function(){crmsRenderTekster(c,"new");});
    c.querySelectorAll("[data-edit-sn]").forEach(function(b){b.addEventListener("click",function(){crmsRenderTekster(c,b.getAttribute("data-edit-sn"));});});
    c.querySelectorAll("[data-del-sn]").forEach(function(b){b.addEventListener("click",function(){if(!confirm("Slett denne standardteksten?"))return;deleteSnippet(b.getAttribute("data-del-sn"));crmsRenderTekster(c);});});
    if (editing!==null) {
      c.querySelector("#crms-sn-cancel").addEventListener("click",function(){crmsRenderTekster(c);});
      c.querySelector("#crms-sn-save").addEventListener("click",function(){
        var code=c.querySelector("#crms-sn-code").value.trim().replace(/\s+/g,"").replace(/^#+/,"");
        var title=c.querySelector("#crms-sn-title").value.trim();
        var body2=c.querySelector("#crms-sn-body").value.trim();
        var st=c.querySelector("#crms-sn-st");
        if (!code){st.textContent="Nøkkelord er påkrevd.";st.className="form__status is-err";return;}
        if (!title){st.textContent="Tittel er påkrevd.";st.className="form__status is-err";return;}
        if (!body2){st.textContent="Tekst er påkrevd.";st.className="form__status is-err";return;}
        saveSnippet({id:editId==="new"?"sn-"+Date.now():editId,shortcode:code,title:title,body:body2});
        crmsRenderTekster(c);
      });
    }
  }

  /* =========================================================================
     E-POST (delt openReplyModal — respekterer crmFull identisk med
     Kontakt/Booking/Tilbud, sjå docs/decisions/ADR-0002 og arkitektnotat 2026-07-01)
     ====================================================================== */
  function openEmailDialog(c, refresh, replyToComm) {
    var isReply  = !!replyToComm;
    var threadId = isReply ? (replyToComm.threadId || newThreadId()) : newThreadId();
    var subject  = isReply ? "Re: " + (replyToComm.subject || "") : "";
    var s        = getCrmSettings();
    var bedrift  = bedriftFor(c);
    App.openReplyModal({
      name: c.name, email: c.email,
      subject: subject,
      templateKey: "crm",
      defaultTemplate: "",
      previewHtml: isReply ? (replyToComm.html || (replyToComm.body ? esc(replyToComm.body) : "")) : "",
      templateOptions: s.templates || [],
      signatureOptions: { company: s.signatureCompany || "", personal: s.signaturePersonal || "" },
      vars: { navn: c.name || "", epost: c.email || "", bedrift: bedrift ? (bedrift.name || "") : "", kundenummer: c.customerNumber || "" },
      onSent: function (payload) {
        addComm({
          customerId: c.id, type: "email_sent",
          title: payload.subject, subject: payload.subject,
          body: (payload.plain || "").slice(0, 200), html: payload.html || "",
          to: payload.to_email, threadId: threadId
        });
        refresh();
      }
    });
  }

  /* =========================================================================
     TELEFON-DIALOG
     ====================================================================== */
  function openPhoneDialog(c, refresh, existing) {
    openDialog({
      title:existing?"Rediger telefonsamtale":"Registrer telefonsamtale",
      bodyHtml:
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.5rem">'+dlgField("dlg-ph-date","Dato","date",existing?existing.callDate:todayISO(),"")+dlgField("dlg-ph-time","Klokkeslett","time",existing?existing.callTime:nowTime(),"")+dlgField("dlg-ph-dur","Varighet","text",existing?existing.duration:"","10 min")+'</div>' +
        dlgField("dlg-ph-contact","Kontaktperson","text",existing?existing.contact:(c.name||""),c.email||"")+
        rtField("dlg-ph-note","Notat",existing?existing.noteHtml:"")+rtField("dlg-ph-followup","Oppfølging",existing?existing.followupHtml:""),
      footHtml: C.button({label:"Lagre",variant:"primary",attrs:'id="dlg-ph-save"'})+C.button({label:"Avbryt",variant:"ghost",attrs:'id="dlg-ph-cancel"'}),
      onMount:function(dl){
        bindRt(dl);
        dl.querySelector("#dlg-ph-cancel").addEventListener("click",function(){closeDialog(dl);});
        dl.querySelector("#dlg-ph-save").addEventListener("click",function(){
          var contact=dl.querySelector("#dlg-ph-contact").value.trim();
          var nh=readRt(dl,"dlg-ph-note"), fh=readRt(dl,"dlg-ph-followup");
          var patch={title:"Telefonsamtale"+(contact?" med "+contact:""),callDate:dl.querySelector("#dlg-ph-date").value,callTime:dl.querySelector("#dlg-ph-time").value,duration:dl.querySelector("#dlg-ph-dur").value.trim(),contact:contact,note:plainRt(nh),noteHtml:nh,followup:plainRt(fh),followupHtml:fh};
          if (existing) updateComm(existing.id, patch); else addComm(Object.assign({customerId:c.id,type:"phone_note"}, patch));
          closeDialog(dl); refresh();
        });
      }
    });
  }

  /* =========================================================================
     NOTAT-DIALOG
     ====================================================================== */
  function openNoteDialog(c, refresh, existing) {
    var TAGS=[{id:"normal",label:"Normal",color:"var(--color-primary,#2980B9)"},{id:"important",label:"Viktig",color:"var(--color-primary,#2980B9)"},{id:"followup",label:"Oppfølging",color:"#E8833A"}];
    openDialog({
      title:existing?"Rediger internt notat":"Internt notat",
      bodyHtml:
        rtField("dlg-nt-text","Notat",existing?existing.html:"") +
        '<div style="display:grid;gap:.25rem"><label style="font-size:.85rem;font-weight:600">Type</label><div style="display:flex;gap:.35rem">'+TAGS.map(function(t){var a=t.id===(existing?existing.tag||"normal":"normal");return'<button type="button" data-note-tag="'+t.id+'" style="padding:.3rem .7rem;border-radius:999px;font:inherit;font-size:.8rem;font-weight:600;cursor:pointer;border:1.5px solid '+(a?t.color:"var(--color-border,#d1d5db)")+';background:'+(a?t.color:"transparent")+';color:'+(a?"#fff":"var(--color-text)")+'">'+esc(t.label)+'</button>';}).join("")+'</div></div>',
      footHtml: C.button({label:"Lagre",variant:"primary",attrs:'id="dlg-nt-save"'})+C.button({label:"Avbryt",variant:"ghost",attrs:'id="dlg-nt-cancel"'}),
      onMount:function(dl){
        bindRt(dl); var selTag=existing?(existing.tag||"normal"):"normal";
        dl.querySelectorAll("[data-note-tag]").forEach(function(btn){btn.addEventListener("click",function(){selTag=btn.getAttribute("data-note-tag");var tc=TAGS.find(function(t){return t.id===selTag;})||{};var col=tc.color||"var(--color-primary)";dl.querySelectorAll("[data-note-tag]").forEach(function(b){var a=b===btn;b.style.borderColor=a?col:"var(--color-border,#d1d5db)";b.style.background=a?col:"transparent";b.style.color=a?"#fff":"var(--color-text)";});});});
        dl.querySelector("#dlg-nt-cancel").addEventListener("click",function(){closeDialog(dl);});
        dl.querySelector("#dlg-nt-save").addEventListener("click",function(){
          var html=readRt(dl,"dlg-nt-text"), text=plainRt(html);
          if (!text) return;
          var patch={title:text.slice(0,70)+(text.length>70?"…":""),text:text,html:html,tag:selTag};
          if (existing) updateComm(existing.id, patch); else addComm(Object.assign({customerId:c.id,type:"internal_note"}, patch));
          closeDialog(dl); refresh();
        });
      }
    });
  }

  /* =========================================================================
     DOKUMENT-DIALOG
     ====================================================================== */
  // crm_comms har ein laus UPDATE-policy (member kan skrive heile raden via
  // REST) — att.ref er difor ikkje til å stole på som eit trygt URL-skjema
  // utan å sjekke det sjølv, uansett kva App.media.putFile() normalt returnerer.
  // Same sperre/regex som components.js sin sanitizeRichHtml() brukar for <a href>.
  function isSafeAttachmentUrl(ref) { return !!ref && !/^\s*javascript:/i.test(ref); }
  function attachmentChip(att) {
    if (!att) return "";
    var kb = att.size ? Math.round(att.size/1024) + " KB" : "";
    if (!isSafeAttachmentUrl(att.ref)) {
      return '<span style="display:inline-flex;align-items:center;gap:.35rem;padding:.3rem .6rem;border:1.5px solid var(--color-border,#d1d5db);border-radius:8px;font-size:.8rem;color:var(--color-muted)"><i class="ti ti-paperclip"></i> '+esc(att.name)+' (ugyldig lenke)</span>';
    }
    return '<a href="'+esc(att.ref)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:.35rem;padding:.3rem .6rem;border:1.5px solid var(--color-border,#d1d5db);border-radius:8px;font-size:.8rem;color:var(--color-text);text-decoration:none"><i class="ti ti-paperclip" style="color:var(--color-primary,#2980B9)"></i> '+esc(att.name)+(kb?' <span style="color:var(--color-muted)">('+kb+')</span>':'')+'</a>';
  }

  function openDocDialog(c, refresh, existing) {
    var attachment = existing ? (existing.attachment || null) : null;
    openDialog({
      title:existing?"Rediger dokument":"Legg til dokument",
      bodyHtml:
        dlgField("dlg-dc-name","Navn *","text",existing?existing.title:"","f.eks. Kontrakt 2025")+
        dlgSelect("dlg-dc-type","Type",["Kontrakt","Tilbud","Ordrebekreftelse","Tegning","PDF","Bilde","Annet"],existing?existing.docType:"Kontrakt")+
        rtField("dlg-dc-note","Notat",existing?existing.noteHtml:"")+
        '<div style="display:grid;gap:.35rem">' +
          '<label style="font-size:.85rem;font-weight:600">Vedlegg</label>' +
          '<div data-dc-att-current>'+(attachment?attachmentChip(attachment):'<p style="font-size:.78rem;color:var(--color-muted);margin:0">Ingen fil lastet opp.</p>')+'</div>' +
          '<input type="file" id="dlg-dc-file" style="font-size:.82rem">' +
          '<p data-dc-file-status style="font-size:.75rem;color:var(--color-muted);margin:0"></p>' +
        '</div>',
      footHtml: C.button({label:"Lagre",variant:"primary",attrs:'id="dlg-dc-save"'})+C.button({label:"Avbryt",variant:"ghost",attrs:'id="dlg-dc-cancel"'}),
      onMount:function(dl){
        bindRt(dl);
        var statusEl=dl.querySelector("[data-dc-file-status]"), currentEl=dl.querySelector("[data-dc-att-current]");
        dl.querySelector("#dlg-dc-file").addEventListener("change",function(e){
          var file=e.target.files[0]; if (!file) return;
          statusEl.textContent="Laster opp «"+file.name+"»…";
          var prevAttachment=attachment; // frigjer FØRST etter at det nye opplastet vellykka — sjå notat under
          App.media.putFile(file).then(function(att){
            attachment=att;
            statusEl.textContent="";
            currentEl.innerHTML=attachmentChip(attachment);
            // Frigjer det GAMLE vedlegget berre no, etter at det nye faktisk er
            // lasta opp — friar det FØR ville mista fila viss opplastinga hadde
            // feila, og late brukaren utan noko å falle tilbake til (2026-07-06-funn).
            if (prevAttachment && prevAttachment.ref && prevAttachment.ref !== attachment.ref) {
              App.media.freeFile(prevAttachment.ref);
            }
          }).catch(function(err){
            if (err && err.message==="size") statusEl.textContent="Filen er for stor (maks "+(App.supabase?App.media.MAX_FILE_MB_REMOTE:App.media.MAX_FILE_MB)+" MB).";
            else statusEl.textContent="Kunne ikke laste opp filen. Prøv en mindre fil.";
          });
        });
        dl.querySelector("#dlg-dc-cancel").addEventListener("click",function(){closeDialog(dl);});
        dl.querySelector("#dlg-dc-save").addEventListener("click",function(){
          var name=dl.querySelector("#dlg-dc-name").value.trim(); if(!name){dl.querySelector("#dlg-dc-name").focus();return;}
          var nh=readRt(dl,"dlg-dc-note");
          var patch={title:name,docType:dl.querySelector("#dlg-dc-type").value,note:plainRt(nh),noteHtml:nh,attachment:attachment};
          if (existing) updateComm(existing.id, patch); else addComm(Object.assign({customerId:c.id,type:"document"}, patch));
          closeDialog(dl); refresh();
        });
      }
    });
  }

  /* =========================================================================
     OPPGAVE-DIALOG
     ====================================================================== */
  function openTaskDialog(c, refresh, existing) {
    openDialog({
      title:existing?"Rediger oppgave":"Ny oppgave for "+(c.name||c.email),
      bodyHtml:
        dlgField("dlg-tk-title","Oppgave *","text",existing?existing.title:"","f.eks. Ring kunden fredag")+
        dlgField("dlg-tk-due","Frist","date",existing?existing.dueDate:"","")+
        rtField("dlg-tk-note","Notat",existing?existing.noteHtml:""),
      footHtml: C.button({label:"Lagre",variant:"primary",attrs:'id="dlg-tk-save"'})+C.button({label:"Avbryt",variant:"ghost",attrs:'id="dlg-tk-cancel"'}),
      onMount:function(dl){
        bindRt(dl);
        dl.querySelector("#dlg-tk-cancel").addEventListener("click",function(){closeDialog(dl);});
        dl.querySelector("#dlg-tk-save").addEventListener("click",function(){
          var title=dl.querySelector("#dlg-tk-title").value.trim(); if(!title){dl.querySelector("#dlg-tk-title").focus();return;}
          var nh=readRt(dl,"dlg-tk-note");
          var patch={title:title,dueDate:dl.querySelector("#dlg-tk-due").value,note:plainRt(nh),noteHtml:nh};
          if (existing) updateComm(existing.id, patch); else addComm(Object.assign({customerId:c.id,type:"task",done:false}, patch));
          closeDialog(dl); refresh();
        });
      }
    });
  }

  /* =========================================================================
     CHAT
     ====================================================================== */
  function openChatForCustomer(c) {
    var Chat=window.VwChat, CAdmin=window.VwChatAdmin;
    if (!Chat||!CAdmin) return;
    var conv=Chat.getConvs().find(function(cv){return(cv.email||"").toLowerCase()===(c.email||"").toLowerCase()&&cv.status!=="closed";});
    if (!conv) conv=Chat.createConv(c.name||c.email,c.email);
    CAdmin.openConv(conv.id);
    if (document.getElementById("intranet") && window.Intranet) {
      window.Intranet.navigate("chat");
    } else {
      var tab=document.querySelector("[data-tab='chat-admin']"); if(tab) tab.click();
    }
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  App.registerModule({
    id:"crm", label:"Kunder", order:999, adminOnly:true,
    render:function(){return"";},
    admin:{
      label:"Kunder", category:"henvendelser",
      render:function(){return'<div data-crm-root></div>';},
      mount:function(body){
        var root = body.querySelector("[data-crm-root]") || body;
        loadCrmData(function () {
          renderAdmin(root);
          if (_pendingCrmOpen) {
            var pid = _pendingCrmOpen; _pendingCrmOpen = null;
            renderCustomer(root, pid);
          }
        });
      }
    }
  });

  /* Intranet-registrering — same kode, delt datanøklar */
  if (window.Intranet && typeof window.Intranet.registerModule === "function") {
    window.Intranet.registerModule({
      id:       "crm",
      navLabel: "Kunder",
      icon:     "users",
      order:    35,
      // MERK (rettinghistorikk): 2026-07-02 vart CRM mellombels avgrensa til
      // roles:["admin","editor"] etter ei Privacy/Compliance-subagent-vurdering
      // — det var ei agent-inferert forsiktigheitsavgjerd, ALDRI eit uttrykkeleg
      // brukarkrav. Brukaren presiserte same dag at member skal ha normal
      // CRM-tilgang (opprette/redigere kundar, bedrifter, kundehandlingar, malar,
      // snippets, signaturar) — det einaste unntaket er CSV-eksport av heile
      // kundelista (sjå isWorkspaceMember()/data-crm-export over). roles-avgrensinga
      // er difor fjerna att. Skrivetilgang til crm-*-nøklane for member er
      // handheva server-side via ei nøkkel-spesifikk store_auth-utviding (ikkje
      // generell store-tilgang) — sjå supabase/hotfix_crm_member_access_2026-07-02.sql.
      render: function () { return '<div data-crm-root></div>'; },
      mount:  function (outlet, ctx, sub) {
        var root = outlet.querySelector("[data-crm-root]") || outlet;
        loadCrmData(function () {
          renderAdmin(root);
          if (_pendingCrmOpen) {
            var pid = _pendingCrmOpen; _pendingCrmOpen = null;
            renderCustomer(root, pid);
          } else if (sub) {
            renderCustomer(root, sub);
          }
        });
      }
    });
  }

  // Lastar CRM-cachen proaktivt ved modul-oppstart — ikkje berre når Kunder-
  // fana faktisk opnast (mount() over gjer det òg, men no-oper viss cachen
  // alt er fylt). Naudsynt sidan core.js sitt dashboard/GDPR-sletting/søk/
  // CSV-eksport (via window.CrmAdmin over) kan trengast før nokon nokon gong
  // opnar Kunder-fana i det heile.
  loadCrmData(function () {});

  });
})();
