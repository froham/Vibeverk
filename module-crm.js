/* =============================================================================
   module-crm.js  —  KUNDER / CRM  v4
   -----------------------------------------------------------------------------
   Selvstendig IIFE. Fungerer fullt utan intranett.
   Deler datalag med intranet/module-crm.js (same localStorage-nøklar):
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

  var App = window.App, C = window.Components, CFG = window.SITE_CONFIG || {};
  if (!App || !C) return;
  if (CFG.features && CFG.features.crm === false) return;

  var esc = C.esc;

  /* =========================================================================
     NØKLAR + TILSTAND
     ====================================================================== */
  var CUST_KEY     = "crm-customers";
  var BEDRIFT_KEY  = "crm-bedrifter";
  var COMMS_KEY    = "crm-comms";
  var SETTINGS_KEY = "crm-settings";

  var crmSubView = "kontaktar"; // "kontaktar" | "bedrifter"
  var _pendingCrmOpen = null; // sett frå chat-modul via window.CrmAdmin

  window.CrmAdmin = {
    openCustomer: function (id) { _pendingCrmOpen = id; }
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
     KUNDAR
     ====================================================================== */
  function getCustomers() { return App.store.get(CUST_KEY, []) || []; }
  function setCustomers(v) { App.store.set(CUST_KEY, v); }
  function customerEmails(c) { return [c.email].concat(c.altEmails || []).filter(Boolean); }

  function mergeCustomers(ids) {
    var list = getCustomers();
    var toMerge = list.filter(function (c) { return ids.indexOf(c.id) > -1; });
    if (toMerge.length < 2) return;
    toMerge.sort(function (a, b) { return (a.created||"").localeCompare(b.created||""); });
    var primary = toMerge[0], allEmails = [];
    toMerge.forEach(function (c) {
      customerEmails(c).forEach(function (e) { if (allEmails.indexOf(e) === -1) allEmails.push(e); });
    });
    primary.email = allEmails[0]; primary.altEmails = allEmails.slice(1);
    primary.note = toMerge.map(function (c) { return (c.note||"").trim(); }).filter(Boolean).join(" / ");
    if (!primary.name) { var wn = toMerge.find(function (c) { return c.name; }); if (wn) primary.name = wn.name; }
    if (!primary.bedriftId) { var wb = toMerge.find(function (c) { return c.bedriftId; }); if (wb) primary.bedriftId = wb.bedriftId; }
    setCustomers(list.filter(function (c) { return ids.indexOf(c.id) === -1 || c.id === primary.id; }));
  }

  /* =========================================================================
     BEDRIFTER
     ====================================================================== */
  function getBedrifter() { return App.store.get(BEDRIFT_KEY, []) || []; }
  function setBedrifter(v) { App.store.set(BEDRIFT_KEY, v); }
  function bedriftFor(c) {
    if (!c || !c.bedriftId) return null;
    return getBedrifter().find(function (b) { return b.id === c.bedriftId; }) || null;
  }
  function contactsFor(bedriftId) {
    return getCustomers().filter(function (c) { return c.bedriftId === bedriftId; });
  }
  function findOrCreateBedrift(name, extra) {
    var n = (name||"").trim(); if (!n) return null;
    var list = getBedrifter();
    var ex = list.find(function (b) { return b.name.toLowerCase() === n.toLowerCase(); });
    if (ex) { if (extra) { Object.assign(ex, extra); setBedrifter(list); } return ex; }
    var nums = list.map(function (b) { return b.customerNumber; }).filter(Boolean);
    var fresh = Object.assign({
      id: "bed-"+Date.now()+"-"+Math.random().toString(36).slice(2,6),
      name: n, customerNumber: App.generateUniqueNumber(nums),
      created: new Date().toISOString(),
      orgNr:"", website:"", phone:"", address:"",
      invoiceEmail:"", invoiceAddress:"", note:""
    }, extra||{});
    list.push(fresh); setBedrifter(list); return fresh;
  }
  function updateBedrift(id, patch) {
    var list = getBedrifter(), idx = list.findIndex(function (b) { return b.id === id; });
    if (idx >= 0) { Object.assign(list[idx], patch); setBedrifter(list); }
  }
  function deleteBedrift(id) { setBedrifter(getBedrifter().filter(function (b) { return b.id !== id; })); }

  /* =========================================================================
     KOMMUNIKASJON
     ====================================================================== */
  function getComms() { return App.store.get(COMMS_KEY, []) || []; }
  function setComms(v) { App.store.set(COMMS_KEY, v); }
  function getCommsFor(cid) { return getComms().filter(function (c) { return c.customerId === cid; }); }
  function addComm(data) {
    var list = getComms();
    var item = Object.assign({ id:"cm-"+Date.now()+"-"+Math.random().toString(36).slice(2,5),
      created: new Date().toISOString() }, data);
    list.unshift(item); setComms(list); return item;
  }
  function deleteComm(id) { setComms(getComms().filter(function (c) { return c.id !== id; })); }
  function updateComm(id, patch) {
    var list = getComms(), idx = list.findIndex(function (c) { return c.id === id; });
    if (idx >= 0) { list[idx] = Object.assign({}, list[idx], patch); setComms(list); }
  }
  function newThreadId() { return "th-"+Date.now()+"-"+Math.random().toString(36).slice(2,5); }

  /* =========================================================================
     E-POST ABSTRAKSJON
     ====================================================================== */
  var EmailProvider = {
    name:"mock", label:"Demo (ikke koblet)",
    sendEmail: function (opts, cb) { setTimeout(function () { cb(null, {id:"mock-"+Date.now()}); }, 600); }
  };

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
  function parseQuoteForBedrift(lead) {
    var msg = lead.message||"";
    if (!msg || msg.indexOf("Tilbudsforesp") !== 0) return null;
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
    var bookings = App.store.get("booking-bookings",[]) || [];
    var list     = getCustomers(); var changed = false;
    function upsert(email, name, bedInfo) {
      if (!email) return;
      var e   = email.toLowerCase();
      var bed = bedInfo ? findOrCreateBedrift(bedInfo.name, bedInfo) : null;
      var ex  = list.find(function (c) { return customerEmails(c).some(function (x) { return x.toLowerCase()===e; }); });
      if (!ex) {
        var nums = list.map(function (c) { return c.customerNumber; }).filter(Boolean);
        list.unshift({ id:"cust-"+Date.now()+"-"+Math.random().toString(36).slice(2,6),
          email:email, altEmails:[], name:name||"", phone:"", address:"", note:"",
          created:new Date().toISOString(), customerNumber:App.generateUniqueNumber(nums),
          bedriftId: bed ? bed.id : null });
        changed = true;
      } else {
        if (name&&!ex.name)             { ex.name=name;           changed=true; }
        if (bed&&!ex.bedriftId)         { ex.bedriftId=bed.id;    changed=true; }
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
    if (changed) setCustomers(list);
  }

  /* =========================================================================
     LEGACY + CHAT HISTORIKK
     ====================================================================== */
  function getLegacyHistory(emails) {
    var es = emails.map(function (e) { return (e||"").toLowerCase(); }), items = [];
    (App.getLeads ? App.getLeads() : []).forEach(function (l) {
      if (es.indexOf((l.email||"").toLowerCase())===-1) return;
      var isQ = l.message&&l.message.indexOf("Tilbudsforesp")===0;
      items.push({ id:l.id, type:isQ?"quote":"contact", source:"legacy",
        created:new Date(l.time||0).toISOString(),
        title:(isQ?"Tilbudsforespørsel":"Kontaktmelding")+(l.name?" fra "+l.name:""),
        body:(l.message||"").replace(/<[^>]+>/g,"").slice(0,120), status:l.status||"ny" });
    });
    (App.store.get("booking-bookings",[])||[]).forEach(function (b) {
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
    if (App.getLeads) App.store.set("leads",(App.getLeads()||[]).filter(function(l){return es.indexOf((l.email||"").toLowerCase())===-1;}));
    var bk = App.store.get("booking-bookings",[])||[];
    App.store.set("booking-bookings",bk.filter(function(b){return es.indexOf((b.email||"").toLowerCase())===-1;}));
    setComms(getComms().filter(function(c){
      var cu=getCustomers().find(function(x){return x.id===c.customerId;}); if(!cu) return true;
      return !customerEmails(cu).some(function(e){return es.indexOf(e.toLowerCase())>-1;});
    }));
    if (window.VwChat&&window.VwChat.deleteConv&&window.VwChat.getConvs)
      window.VwChat.getConvs().filter(function(cv){return es.indexOf((cv.email||"").toLowerCase())>-1;}).forEach(function(cv){window.VwChat.deleteConv(cv.id);});
  }

  /* =========================================================================
     DIALOG (native <dialog>)
     ====================================================================== */
  function openDialog(opts) {
    var dl = document.createElement("dialog");
    dl.className = "crm-dlg";
    dl.style.cssText = "border:0;border-radius:14px;padding:0;max-width:"+(opts.wide?"700px":"540px")+";width:calc(100vw - 2rem);box-shadow:0 20px 60px rgba(0,0,0,.25);background:var(--color-surface,#fff)";
    dl.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.2rem .8rem;border-bottom:1px solid var(--color-border,#e5e7eb)">' +
        '<strong style="font-size:1rem">'+esc(opts.title||"")+'</strong>' +
        '<button class="crm-dlg-close" style="background:none;border:0;cursor:pointer;font-size:1.3rem;color:var(--color-muted,#6b7280);padding:.2rem;line-height:1">&times;</button>' +
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
              C.button({label:"CSV",variant:"ghost",attrs:'data-crm-export style="font-size:.82rem"'})
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
    if (expBtn) expBtn.addEventListener("click",function(){
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
        '<button type="button" class="crm-merge-check" data-merge-id="'+esc(c.id)+'" style="padding:.25rem .55rem;border:1.5px solid var(--color-border,#d1d5db);border-radius:6px;background:transparent;font:inherit;font-size:.72rem;font-weight:600;color:var(--color-muted);cursor:pointer">Merk</button>' +
        C.button({label:"Åpne",variant:"ghost",attrs:'data-crm-open="'+esc(c.id)+'" style="font-size:.78rem"'}) +
        C.button({label:"Slett",variant:"ghost",attrs:'data-crm-del="'+esc(c.id)+'" style="font-size:.78rem;border-color:#c0392b;color:#c0392b"'}) +
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
        var id=btn.getAttribute("data-crm-del"), c=getCustomers().find(function(x){return x.id===id;});
        if (!c||!confirm("Slett ALL data for "+c.email+"?")) return;
        deleteAllForEmail(customerEmails(c)); setCustomers(getCustomers().filter(function(x){return x.id!==id;}));
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
        var b=getBedrifter().find(function(x){return x.id===li.getAttribute("data-bed-open");}); if(!b) return;
        li.style.display=(!q||[b.name,b.orgNr,b.note].join(" ").toLowerCase().indexOf(q)>-1)?"":"none";
      });
    });
    container.querySelectorAll("[data-bed-open]").forEach(function(el){
      el.addEventListener("click",function(e){
        if (e.target.closest("[data-bed-del]")) return;
        renderBedrift(body, el.getAttribute("data-bed-open"));
      });
    });
    container.querySelectorAll("[data-bed-del]").forEach(function(btn){
      btn.addEventListener("click",function(e){
        e.stopPropagation();
        var id=btn.getAttribute("data-bed-del"), b=getBedrifter().find(function(x){return x.id===id;});
        if (!b||!confirm("Slett bedriften «"+b.name+"»? Kontakter blir ikke slettet, bare frakoblet.")) return;
        var cu=getCustomers(); cu.forEach(function(c){if(c.bedriftId===id)c.bedriftId=null;}); setCustomers(cu);
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
        C.button({label:"Åpne",variant:"ghost",attrs:'style="font-size:.78rem"'}) +
        C.button({label:"Slett",variant:"ghost",attrs:'data-bed-del="'+esc(b.id)+'" style="font-size:.78rem;border-color:#c0392b;color:#c0392b"'}) +
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
        dl.querySelector("#dlg-nc-cancel").addEventListener("click",function(){dl.close();dl.remove();});
        dl.querySelector("#dlg-nc-save").addEventListener("click",function(){
          var email=dl.querySelector("#dlg-nc-email").value.trim(), st=dl.querySelector("#dlg-nc-status");
          if (!email){st.textContent="E-post er påkrevd.";st.className="form__status is-err";return;}
          var list=getCustomers();
          if (list.find(function(c){return customerEmails(c).some(function(e){return e.toLowerCase()===email.toLowerCase();});})){st.textContent="E-post finst allereie.";st.className="form__status is-err";return;}
          var bedInput=dl.querySelector("#dlg-nc-bedrift").value.trim();
          var bed=bedInput?findOrCreateBedrift(bedInput):(preBed||null);
          var nums=list.map(function(c){return c.customerNumber;}).filter(Boolean);
          list.unshift({id:"cust-"+Date.now()+"-"+Math.random().toString(36).slice(2,6),email:email,altEmails:[],name:dl.querySelector("#dlg-nc-name").value.trim(),phone:dl.querySelector("#dlg-nc-phone").value.trim(),address:"",note:dl.querySelector("#dlg-nc-note").value.trim(),created:new Date().toISOString(),customerNumber:App.generateUniqueNumber(nums),bedriftId:bed?bed.id:null});
          setCustomers(list); dl.close(); dl.remove(); renderAdmin(body);
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
        dl.querySelector("#dlg-nb-cancel").addEventListener("click",function(){dl.close();dl.remove();});
        dl.querySelector("#dlg-nb-save").addEventListener("click",function(){
          var name=dl.querySelector("#dlg-nb-name").value.trim(), st=dl.querySelector("#dlg-nb-status");
          if (!name){st.textContent="Navn er påkrevd.";st.className="form__status is-err";return;}
          findOrCreateBedrift(name,{orgNr:dl.querySelector("#dlg-nb-orgnr").value.trim(),phone:dl.querySelector("#dlg-nb-phone").value.trim(),website:dl.querySelector("#dlg-nb-website").value.trim(),invoiceEmail:dl.querySelector("#dlg-nb-invemail").value.trim()});
          dl.close(); dl.remove(); renderAdmin(body);
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
          '<div style="display:flex;gap:.4rem;align-items:center">'+C.button({label:"Lagre",variant:"primary",type:"submit",attrs:'style="font-size:.82rem"'})+C.button({label:"Slett kontakt",variant:"ghost",attrs:'data-crm-del-cust style="font-size:.82rem;border-color:#c0392b;color:#c0392b;margin-left:auto"'})+'<span data-ce-status class="form__status" style="font-size:.82rem"></span></div>' +
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
          : '<div data-tl-section>'+buildTimeline(tl,5)+'</div>') +
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
      customers[idx]=Object.assign({},customers[idx],{name:body.querySelector("#ce-name").value.trim(),email:body.querySelector("#ce-email").value.trim(),phone:body.querySelector("#ce-phone").value.trim(),address:body.querySelector("#ce-address").value.trim(),note:body.querySelector("#ce-note").value.trim(),bedriftId:bi?findOrCreateBedrift(bi).id:null});
      setCustomers(customers);
      var st=body.querySelector("[data-ce-status]"); st.textContent="Lagret."; st.className="form__status is-ok";
      setTimeout(function(){if(st)st.textContent="";refresh();},800);
    });
    var delBtn=body.querySelector("[data-crm-del-cust]");
    if (delBtn) delBtn.addEventListener("click",function(){
      if (!confirm("Slett ALL data for "+c.email+"?")) return;
      deleteAllForEmail(customerEmails(c)); setCustomers(getCustomers().filter(function(x){return x.id!==id;}));
      if (opts.fromBedrift) renderBedrift(body,opts.fromBedrift); else renderAdmin(body);
    });
    function qa(attr,fn){var b=body.querySelector("[data-qa='"+attr+"']");if(b)b.addEventListener("click",fn);}
    qa("crm-qa-email",function(){openEmailDialog(c,refresh);});
    qa("crm-qa-phone",function(){openPhoneDialog(c,refresh);});
    qa("crm-qa-note", function(){openNoteDialog(c,refresh);});
    qa("crm-qa-doc",  function(){openDocDialog(c,refresh);});
    qa("crm-qa-task", function(){openTaskDialog(c,refresh);});
    qa("crm-qa-chat", function(){openChatForCustomer(c);});
    var tlSection=body.querySelector("[data-tl-section]");
    if (tlSection) bindTimelineActions(tlSection,body,c,tl,refresh);
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
    scope.querySelectorAll("[data-del-comm]").forEach(function(btn){btn.addEventListener("click",function(e){e.stopPropagation();if(!confirm("Fjern hendelse?"))return;deleteComm(btn.getAttribute("data-del-comm"));refresh();});});
    scope.querySelectorAll("[data-task-toggle]").forEach(function(btn){btn.addEventListener("click",function(e){e.stopPropagation();updateComm(btn.getAttribute("data-task-toggle"),{done:true});refresh();});});
    scope.querySelectorAll("[data-reply-email]").forEach(function(btn){btn.addEventListener("click",function(e){e.stopPropagation();var orig=getComms().find(function(x){return x.id===btn.getAttribute("data-reply-email");});openEmailDialog(c,refresh,orig);});});
    var exp=scope.querySelector("[data-tl-expand]");
    if (exp) exp.addEventListener("click",function(){
      scope.innerHTML=buildTimeline(tl);
      bindTimelineActions(scope,body,c,tl,refresh);
    });
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
    var bodyHtml=item.html||item.noteHtml||"";
    var tagBadge="";
    if (item.type==="internal_note"&&item.tag&&item.tag!=="normal"){var tc={important:"#2980B9",followup:"#E8833A"},tl2={important:"Viktig",followup:"Oppfølging"};tagBadge=' <span style="font-size:.67rem;font-weight:700;padding:.1rem .38rem;border-radius:999px;background:color-mix(in srgb,'+(tc[item.tag]||"#999")+' 13%,transparent);color:'+(tc[item.tag]||"#999")+'">'+esc(tl2[item.tag]||item.tag)+'</span>';}
    if (item.type==="task"&&item.done) tagBadge=' <span style="font-size:.67rem;font-weight:700;padding:.1rem .38rem;border-radius:999px;background:color-mix(in srgb,#27AE60 12%,transparent);color:#27AE60">Ferdig ✓</span>';
    if (threadCount>1) tagBadge+=' <span style="font-size:.67rem;font-weight:700;padding:.1rem .38rem;border-radius:999px;background:color-mix(in srgb,#2980B9 12%,transparent);color:#2980B9">'+threadCount+' i tråd</span>';
    if (item.source==="legacy"&&item.status) tagBadge+=' <span class="stat-badge stat-badge--'+esc(item.status)+'">'+({"ny":"Ny","lest":"Lest","løst":"Løst"}[item.status]||esc(item.status))+'</span>';
    return '<div style="display:flex;gap:.65rem;padding:.65rem 0;border-bottom:1px solid var(--color-border,#e5e7eb)">' +
      '<div style="flex-shrink:0;margin-top:.1rem"><div style="width:28px;height:28px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,'+conf.color+' 13%,white);border:1.5px solid color-mix(in srgb,'+conf.color+' 28%,transparent)"><i class="ti ti-'+conf.icon+'" style="font-size:.78rem;color:'+conf.color+'"></i></div></div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.4rem">' +
          '<div style="min-width:0"><span style="font-size:.86rem;font-weight:600">'+esc(item.title||conf.label)+'</span>'+tagBadge+'</div>' +
          '<div style="display:flex;align-items:center;gap:.25rem;flex-shrink:0">' +
            (item.type==="task"&&!item.done&&isComm?'<button data-task-toggle="'+esc(item.id)+'" style="font-size:.7rem;padding:.08rem .35rem;border:1.5px solid var(--color-border);border-radius:6px;background:none;cursor:pointer;color:var(--color-muted)">Fullfør</button>':'') +
            (isEmail&&isComm?'<button data-reply-email="'+esc(item.id)+'" style="font-size:.7rem;padding:.08rem .35rem;border:1.5px solid var(--color-border);border-radius:6px;background:none;cursor:pointer;color:var(--color-muted)">Svar</button>':'') +
            (isComm?'<button data-del-comm="'+esc(item.id)+'" style="background:none;border:0;cursor:pointer;color:var(--color-muted);padding:.1rem;line-height:1;opacity:.4;font-size:.85rem" title="Fjern"><i class="ti ti-x"></i></button>':'') +
            '<span style="font-size:.7rem;color:var(--color-muted);white-space:nowrap">'+esc(time)+'</span>' +
          '</div>' +
        '</div>' +
        (bodyText||bodyHtml?'<div style="font-size:.78rem;color:var(--color-muted);margin-top:.18rem;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical">'+(bodyHtml||esc(bodyText))+'</div>':"") +
        '<span style="display:inline-block;margin-top:.25rem;font-size:.67rem;font-weight:600;padding:.08rem .38rem;border-radius:999px;background:var(--color-alt,#f3f4f6);color:var(--color-muted)">'+esc(conf.label)+'</span>' +
      '</div></div>';
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
          doMerge(toMerge,sel.value);
          closeDlg(); renderAdmin(body);
        });
      }
    });
  }

  function doMerge(toMerge, primaryId) {
    var list=getCustomers(), primary=list.find(function(c){return c.id===primaryId;}); if(!primary) return;
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
    var drop=toMerge.map(function(c){return c.id;}).filter(function(id){return id!==primaryId;});
    setCustomers(list.filter(function(c){return drop.indexOf(c.id)===-1;}));
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
        dl.querySelector("#crms-close").addEventListener("click",function(){dl.close();dl.remove();});
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
      '<p style="font-size:.85rem;color:var(--color-muted);margin:0 0 .7rem">Signaturer vises automatisk under meldingen når du sender e-post.</p>' +
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
        '<span style="font-size:.82rem;color:var(--color-muted)">Skriv <strong>#nøkkelord</strong> i chat-svarruten for å sette inn tekst raskt</span>' +
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
     E-POST DIALOG (signatur + tråd)
     ====================================================================== */
  function openEmailDialog(c, refresh, replyToComm) {
    var isReply  = !!replyToComm;
    var threadId = isReply?(replyToComm.threadId||newThreadId()):newThreadId();
    var subject  = isReply?"Re: "+(replyToComm.subject||""):"";
    var s        = getCrmSettings();
    var hasSigs  = s.signatureCompany||s.signaturePersonal;
    openDialog({
      title: isReply?"Svar på e-post":"Ny e-post til "+(c.name||c.email),
      bodyHtml:
        dlgField("dlg-em-to","Til","email",c.email,"")+dlgField("dlg-em-subject","Emne","text",subject,"Skriv emne") +
        rtField("dlg-em-body","Melding","") +
        (hasSigs
          ? '<div style="display:grid;gap:.3rem"><label style="font-size:.85rem;font-weight:600">Signatur</label>' +
            '<div style="display:flex;gap:.4rem">'+
              [["none","Ingen"],["company","Bedrift"],["personal","Personleg"]].filter(function(t){return t[0]==="none"||s["signature"+t[0].charAt(0).toUpperCase()+t[0].slice(1)];}).map(function(t,i){var a=i===0;return'<button type="button" data-sig-sel="'+t[0]+'" style="padding:.28rem .65rem;border-radius:999px;font:inherit;font-size:.78rem;font-weight:600;cursor:pointer;border:1.5px solid '+(a?"var(--color-primary)":"var(--color-border)")+';background:'+(a?"var(--color-primary)":"transparent")+';color:'+(a?"#fff":"var(--color-text)")+'">'+esc(t[1])+'</button>';}).join("") +
            '</div>' +
            '<div data-sig-preview style="font-size:.82rem;color:var(--color-muted);padding:.5rem .7rem;background:var(--color-alt,#f9fafb);border-radius:8px;min-height:1.2rem;white-space:pre-wrap">'+(s.signatureCompany?"—\n"+C.stripHtml(s.signatureCompany):"")+'</div></div>'
          : "") +
        '<p style="font-size:.75rem;color:var(--color-muted);margin:0"><i class="ti ti-info-circle"></i> Via: <strong>'+esc(EmailProvider.label)+'</strong></p>',
      footHtml: C.button({label:"Send",variant:"primary",attrs:'id="dlg-em-send"'})+C.button({label:"Avbryt",variant:"ghost",attrs:'id="dlg-em-cancel"'}),
      onMount:function(dl){
        bindRt(dl);
        var selSig="none";
        dl.querySelectorAll("[data-sig-sel]").forEach(function(btn){
          btn.addEventListener("click",function(){
            selSig=btn.getAttribute("data-sig-sel");
            dl.querySelectorAll("[data-sig-sel]").forEach(function(b){var a=b===btn;b.style.borderColor=a?"var(--color-primary)":"var(--color-border)";b.style.background=a?"var(--color-primary)":"transparent";b.style.color=a?"#fff":"var(--color-text)";});
            var prev=dl.querySelector("[data-sig-preview]"); if(!prev) return;
            var sigKey="signature"+selSig.charAt(0).toUpperCase()+selSig.slice(1);
            var html=selSig!=="none"?(s[sigKey]||""):"";
            prev.textContent=html?"—\n"+C.stripHtml(html):"";
          });
        });
        dl.querySelector("#dlg-em-cancel").addEventListener("click",function(){dl.close();dl.remove();});
        dl.querySelector("#dlg-em-send").addEventListener("click",function(){
          var subject2=dl.querySelector("#dlg-em-subject").value.trim();
          var html=readRt(dl,"dlg-em-body"), plain=plainRt(html);
          if (!subject2){dl.querySelector("#dlg-em-subject").focus();return;}
          var sendBtn=dl.querySelector("#dlg-em-send"); sendBtn.disabled=true; sendBtn.textContent="Sender…";
          var sigKey="signature"+selSig.charAt(0).toUpperCase()+selSig.slice(1);
          var sigHtml=selSig!=="none"?(s[sigKey]||""):"";
          var fullHtml=html+(sigHtml?"<hr style='margin:1rem 0;border:0;border-top:1px solid #eee'>"+sigHtml:"");
          EmailProvider.sendEmail({to:c.email,subject:subject2,body:fullHtml},function(){
            addComm({customerId:c.id,type:"email_sent",title:subject2,subject:subject2,body:plain.slice(0,200),html:fullHtml,to:c.email,threadId:threadId});
            dl.close(); dl.remove(); refresh();
          });
        });
      }
    });
  }

  /* =========================================================================
     TELEFON-DIALOG
     ====================================================================== */
  function openPhoneDialog(c, refresh) {
    openDialog({
      title:"Registrer telefonsamtale",
      bodyHtml:
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.5rem">'+dlgField("dlg-ph-date","Dato","date",todayISO(),"")+dlgField("dlg-ph-time","Klokkeslett","time",nowTime(),"")+dlgField("dlg-ph-dur","Varighet","text","","10 min")+'</div>' +
        dlgField("dlg-ph-contact","Kontaktperson","text",c.name||"",c.email||"")+
        rtField("dlg-ph-note","Notat","")+rtField("dlg-ph-followup","Oppfølging",""),
      footHtml: C.button({label:"Lagre",variant:"primary",attrs:'id="dlg-ph-save"'})+C.button({label:"Avbryt",variant:"ghost",attrs:'id="dlg-ph-cancel"'}),
      onMount:function(dl){
        bindRt(dl);
        dl.querySelector("#dlg-ph-cancel").addEventListener("click",function(){dl.close();dl.remove();});
        dl.querySelector("#dlg-ph-save").addEventListener("click",function(){
          var contact=dl.querySelector("#dlg-ph-contact").value.trim();
          var nh=readRt(dl,"dlg-ph-note"), fh=readRt(dl,"dlg-ph-followup");
          addComm({customerId:c.id,type:"phone_note",title:"Telefonsamtale"+(contact?" med "+contact:""),callDate:dl.querySelector("#dlg-ph-date").value,callTime:dl.querySelector("#dlg-ph-time").value,duration:dl.querySelector("#dlg-ph-dur").value.trim(),contact:contact,note:plainRt(nh),noteHtml:nh,followup:plainRt(fh),followupHtml:fh});
          dl.close(); dl.remove(); refresh();
        });
      }
    });
  }

  /* =========================================================================
     NOTAT-DIALOG
     ====================================================================== */
  function openNoteDialog(c, refresh) {
    var TAGS=[{id:"normal",label:"Normal",color:"var(--color-primary,#2980B9)"},{id:"important",label:"Viktig",color:"#2980B9"},{id:"followup",label:"Oppfølging",color:"#E8833A"}];
    openDialog({
      title:"Internt notat",
      bodyHtml:
        rtField("dlg-nt-text","Notat","") +
        '<div style="display:grid;gap:.25rem"><label style="font-size:.85rem;font-weight:600">Type</label><div style="display:flex;gap:.35rem">'+TAGS.map(function(t){var a=t.id==="normal";return'<button type="button" data-note-tag="'+t.id+'" style="padding:.3rem .7rem;border-radius:999px;font:inherit;font-size:.8rem;font-weight:600;cursor:pointer;border:1.5px solid '+(a?t.color:"var(--color-border,#d1d5db)")+';background:'+(a?t.color:"transparent")+';color:'+(a?"#fff":"var(--color-text)")+'">'+esc(t.label)+'</button>';}).join("")+'</div></div>',
      footHtml: C.button({label:"Lagre",variant:"primary",attrs:'id="dlg-nt-save"'})+C.button({label:"Avbryt",variant:"ghost",attrs:'id="dlg-nt-cancel"'}),
      onMount:function(dl){
        bindRt(dl); var selTag="normal";
        dl.querySelectorAll("[data-note-tag]").forEach(function(btn){btn.addEventListener("click",function(){selTag=btn.getAttribute("data-note-tag");var tc=TAGS.find(function(t){return t.id===selTag;})||{};var col=tc.color||"var(--color-primary)";dl.querySelectorAll("[data-note-tag]").forEach(function(b){var a=b===btn;b.style.borderColor=a?col:"var(--color-border,#d1d5db)";b.style.background=a?col:"transparent";b.style.color=a?"#fff":"var(--color-text)";});});});
        dl.querySelector("#dlg-nt-cancel").addEventListener("click",function(){dl.close();dl.remove();});
        dl.querySelector("#dlg-nt-save").addEventListener("click",function(){
          var html=readRt(dl,"dlg-nt-text"), text=plainRt(html);
          if (!text) return;
          addComm({customerId:c.id,type:"internal_note",title:text.slice(0,70)+(text.length>70?"…":""),text:text,html:html,tag:selTag});
          dl.close(); dl.remove(); refresh();
        });
      }
    });
  }

  /* =========================================================================
     DOKUMENT-DIALOG
     ====================================================================== */
  function openDocDialog(c, refresh) {
    openDialog({
      title:"Legg til dokument",
      bodyHtml:
        dlgField("dlg-dc-name","Navn *","text","","f.eks. Kontrakt 2025")+
        dlgSelect("dlg-dc-type","Type",["Kontrakt","Tilbud","Ordrebekreftelse","Tegning","PDF","Bilde","Annet"],"Kontrakt")+
        rtField("dlg-dc-note","Notat","")+
        '<p style="font-size:.75rem;color:var(--color-muted);margin:0"><i class="ti ti-info-circle"></i> Filopplasting kjem i neste versjon.</p>',
      footHtml: C.button({label:"Lagre",variant:"primary",attrs:'id="dlg-dc-save"'})+C.button({label:"Avbryt",variant:"ghost",attrs:'id="dlg-dc-cancel"'}),
      onMount:function(dl){
        bindRt(dl);
        dl.querySelector("#dlg-dc-cancel").addEventListener("click",function(){dl.close();dl.remove();});
        dl.querySelector("#dlg-dc-save").addEventListener("click",function(){
          var name=dl.querySelector("#dlg-dc-name").value.trim(); if(!name){dl.querySelector("#dlg-dc-name").focus();return;}
          var nh=readRt(dl,"dlg-dc-note");
          addComm({customerId:c.id,type:"document",title:name,docType:dl.querySelector("#dlg-dc-type").value,note:plainRt(nh),noteHtml:nh});
          dl.close(); dl.remove(); refresh();
        });
      }
    });
  }

  /* =========================================================================
     OPPGAVE-DIALOG
     ====================================================================== */
  function openTaskDialog(c, refresh) {
    openDialog({
      title:"Ny oppgave for "+(c.name||c.email),
      bodyHtml:
        dlgField("dlg-tk-title","Oppgave *","text","","f.eks. Ring kunden fredag")+
        dlgField("dlg-tk-due","Frist","date","","")+
        rtField("dlg-tk-note","Notat",""),
      footHtml: C.button({label:"Lagre",variant:"primary",attrs:'id="dlg-tk-save"'})+C.button({label:"Avbryt",variant:"ghost",attrs:'id="dlg-tk-cancel"'}),
      onMount:function(dl){
        bindRt(dl);
        dl.querySelector("#dlg-tk-cancel").addEventListener("click",function(){dl.close();dl.remove();});
        dl.querySelector("#dlg-tk-save").addEventListener("click",function(){
          var title=dl.querySelector("#dlg-tk-title").value.trim(); if(!title){dl.querySelector("#dlg-tk-title").focus();return;}
          var nh=readRt(dl,"dlg-tk-note");
          addComm({customerId:c.id,type:"task",title:title,dueDate:dl.querySelector("#dlg-tk-due").value,note:plainRt(nh),noteHtml:nh,done:false});
          dl.close(); dl.remove(); refresh();
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
        renderAdmin(root);
        if (_pendingCrmOpen) {
          var pid = _pendingCrmOpen; _pendingCrmOpen = null;
          renderCustomer(root, pid);
        }
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
      render: function () { return '<div data-crm-root></div>'; },
      mount:  function (outlet, ctx, sub) {
        var root = outlet.querySelector("[data-crm-root]") || outlet;
        renderAdmin(root);
        if (_pendingCrmOpen) {
          var pid = _pendingCrmOpen; _pendingCrmOpen = null;
          renderCustomer(root, pid);
        } else if (sub) {
          renderCustomer(root, sub);
        }
      }
    });
  }

})();
