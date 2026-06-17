/* =============================================================================
   module-booking.js  —  BOOKING (eksempel på en EKSTERN modul)
   -----------------------------------------------------------------------------
   Demonstrerer modulkontrakten: denne filen lastes ETTER core.js og registrerer
   seg selv via App.registerModule(...). Den rører ALDRI basekoden (core/components/
   index/config utover ett feature-flagg). Den:
     • blir en egen SIDE i toppmenyen (page: true) på #booking
     • injiserer sine egne stiler (selvstendig)
     • bruker gjenbrukbare verktøy fra App (bildefelt, lagring, media, prefyll)
     • legger til en egen admin-fane

   Funksjon: Admin oppretter «ressurser» (bil, frisørtime, møterom, artist …) med
   bilde, åpningstider og en bryter intern/offentlig. Offentlige ressurser vises
   med ledige/opptatte tider. Besøkende sender en FORESPØRSEL (kontaktskjemaet
   forhåndsutfylles), og admin legger inn selve bookingen — som markerer tiden opptatt.

   Slås av/på med config.features.booking.
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App, C = window.Components, CFG = window.SITE_CONFIG || {};
  if (!App || !C) return;
  // Global bryter: hopp ut hvis booking er avslått i config.
  if (CFG.features && CFG.features.booking === false) return;

  var esc = C.esc;
  var WD = [ {n:1,l:"Man"},{n:2,l:"Tir"},{n:3,l:"Ons"},{n:4,l:"Tor"},{n:5,l:"Fre"},{n:6,l:"Lør"},{n:0,l:"Søn"} ];

  /* --- Lagring (namespacet via App.store) ---------------------------------- */
  function getAssets()   { return App.store.get("booking-assets", []) || []; }
  function setAssets(v)  { App.store.set("booking-assets", v); }
  function getBookings() { return App.store.get("booking-bookings", []) || []; }
  function setBookings(v){ App.store.set("booking-bookings", v); }

  /* --- Tids-/dato-hjelpere -------------------------------------------------- */
  function timeToMin(t) { var m = String(t || "").split(":"); return (parseInt(m[0],10)||0)*60 + (parseInt(m[1],10)||0); }
  function minToTime(n) { var h = Math.floor(n/60), m = n%60; return (h<10?"0":"")+h+":"+(m<10?"0":"")+m; }
  function isoDate(d)   { return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2); }
  function slotsFor(a) {
    var res = [], step = a.slotMinutes||60, s = timeToMin(a.openFrom), end = timeToMin(a.openTo);
    if (!(step>0) || s>=end) return res;
    for (; s+step<=end; s+=step) res.push(minToTime(s));
    return res;
  }
  function upcomingDays(a, count) {
    var out = [], d = new Date(); d.setHours(0,0,0,0);
    var wd = a.weekdays || [];
    for (var i=0; i<60 && out.length<count; i++) {
      if (wd.indexOf(d.getDay()) > -1 && (a.blockedDays || []).indexOf(isoDate(d)) === -1) out.push(new Date(d));
      d.setDate(d.getDate()+1);
    }
    return out;
  }
  function dayLabel(d) {
    try { return d.toLocaleDateString("nb-NO", { weekday:"short", day:"numeric", month:"short" }); }
    catch (e) { return isoDate(d); }
  }
  function weekdaysLabel(wd) {
    return WD.filter(function (x) { return (wd||[]).indexOf(x.n) > -1; }).map(function (x) { return x.l; }).join(", ") || "ingen dager";
  }
  function isBooked(assetId, date, time) {
    return getBookings().some(function (b) { return b.assetId===assetId && b.date===date && b.time===time; });
  }
  // Stengt/blokkert: hel dag (blockedDays) eller enkelt-time (blockedSlots: "YYYY-MM-DD HH:MM")
  function isBlocked(a, date, time) {
    if ((a.blockedDays || []).indexOf(date) > -1) return true;
    if (time && (a.blockedSlots || []).indexOf(date + " " + time) > -1) return true;
    return false;
  }

  /* =========================================================================
     OFFENTLIG SIDE
     ====================================================================== */
  function renderPage() {
    var b = CFG.booking || {};
    var assets = getAssets().filter(function (a) { return a.visibility === "public"; });
    var body = assets.length
      ? assets.map(renderPublicAsset).join("")
      : '<p class="prose prose--muted">Ingen ressurser er publisert ennå.</p>';
    // Forespørsels-skjema nederst på SAMME side (slipper å hoppe til kontakt)
    var formHtml = assets.length ? (
      '<div class="bk-contact" data-bk-contact-wrap>' +
        '<h3 class="bk-contact__title">Send en forespørsel</h3>' +
        '<form class="admin-form" data-bk-contact-form novalidate>' +
          C.field({ id:"bk-c-name", label:"Navn", required:true, placeholder:"Ditt navn" }) +
          C.field({ id:"bk-c-email", label:"E-post", required:true, type:"email", placeholder:"deg@eksempel.no" }) +
          C.field({ id:"bk-c-msg", label:"Melding", required:true, multiline:true, rows:4, placeholder:"Hva ønsker du å booke?" }) +
          C.termsField({ idPrefix: "bk-c" }) +
          C.button({ label:"Send forespørsel", type:"submit", variant:"primary" }) +
          '<p class="form__status" data-bk-c-status role="status" aria-live="polite"></p>' +
        '</form>' +
      '</div>'
    ) : '';
    return '' +
      '<section id="booking" class="section reveal"><div class="container">' +
        C.eyebrow(b.intro || b.heading || "Booking") +
        '<h2 class="section__title">' + esc(b.heading || "Booking") + '</h2>' +
        '<div class="bk-assets">' + body + '</div>' +
        formHtml +
      '</div></section>';
  }

  function renderTimes(a, dateISO) {
    var slots = slotsFor(a);
    if (!slots.length) return '<p class="prose prose--muted">Ingen tider satt opp.</p>';
    return '<div class="bk-times">' + slots.map(function (t) {
      if (isBooked(a.id, dateISO, t) || isBlocked(a, dateISO, t)) return '<span class="bk-slot is-booked" aria-disabled="true">' + t + '</span>';
      return '<button type="button" class="bk-slot" data-book="' + esc(a.id) + '" data-date="' + dateISO + '" data-time="' + t + '">' + t + '</button>';
    }).join("") + '</div>';
  }

  function renderPublicAsset(a) {
    var img = App.media.resolveImage(a.image);
    var days = upcomingDays(a, 14);
    var picker;
    if (!slotsFor(a).length || !days.length) {
      picker = '<p class="prose prose--muted">Ingen ledige tider er satt opp.</p>';
    } else {
      var firstISO = isoDate(days[0]);
      var pills = days.map(function (d, i) {
        return '<button type="button" class="bk-datepill' + (i === 0 ? " is-active" : "") + '" data-date="' + isoDate(d) + '">' + dayLabel(d) + '</button>';
      }).join("");
      picker = '<div class="bk-picker" data-asset="' + esc(a.id) + '">' +
                 '<div class="bk-dates">' + pills + '</div>' +
                 '<div class="bk-times-wrap" data-times>' + renderTimes(a, firstISO) + '</div>' +
               '</div>';
    }
    return '' +
      '<article class="bk-asset" data-asset="' + esc(a.id) + '">' +
        (img.src ? C.coverImg(img, "bk-asset__img") : '') +
        '<div class="bk-asset__body">' +
          '<h3 class="bk-asset__title">' + esc(a.name) + '</h3>' +
          (a.description ? '<p class="bk-asset__desc">' + esc(a.description) + '</p>' : '') +
          picker +
          '<div class="bk-confirm" data-confirm></div>' +
          '<button type="button" class="btn btn--ghost bk-request" data-book="' + esc(a.id) + '">Forespør annet tidspunkt</button>' +
        '</div>' +
      '</article>';
  }

  // Klikk-håndtering. Festes på det FERSKE #booking-elementet (ikke #main),
  // så lytteren forsvinner med visningen og ikke hoper seg opp mellom besøk.
  function mountPage(container) {
    var root = container.querySelector("#booking") || container;

    // Fyll forespørsels-skjemaet NEDERST på siden (ingen hopp til kontaktseksjonen)
    function fillRequest(msg) {
      var form = root.querySelector("[data-bk-contact-form]");
      if (!form) return;
      form.querySelector("#bk-c-msg").value = msg;
      var status = form.querySelector("[data-bk-c-status]");
      if (status) { status.textContent = ""; status.className = "form__status"; }
      var wrap = root.querySelector("[data-bk-contact-wrap]");
      if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ behavior: "smooth", block: "start" });
      var n = form.querySelector("#bk-c-name");
      if (n) n.focus();
    }

    root.addEventListener("click", function (e) {
      // Bytt dato → vis klokkeslett for den datoen
      var pill = e.target.closest(".bk-datepill");
      if (pill) {
        var picker = pill.closest(".bk-picker");
        picker.querySelectorAll(".bk-datepill").forEach(function (p) { p.classList.toggle("is-active", p === pill); });
        var pa = getAssets().find(function (x) { return x.id === picker.getAttribute("data-asset"); });
        picker.querySelector("[data-times]").innerHTML = renderTimes(pa, pill.getAttribute("data-date"));
        return;
      }
      // Klikk på en tid / «forespør»
      var el = e.target.closest("[data-book]");
      if (!el) return;
      var a = getAssets().find(function (x) { return x.id === el.getAttribute("data-book"); });
      if (!a) return;
      var date = el.getAttribute("data-date"), time = el.getAttribute("data-time");
      if (a.instant && date && time) {
        openConfirm(el.closest(".bk-asset"), a, date, time);   // sanntid: reserver direkte
      } else {
        var msg = "Booking-forespørsel\nRessurs: " + a.name +
          ((date && time) ? "\nØnsket tidspunkt: " + C.formatDate(date) + " kl. " + time
                          : "\nØnsket tidspunkt: (fyll inn ønsket dato/tid)");
        fillRequest(msg);   // forespørsel: fyll skjemaet på siden
      }
    });

    // Send forespørsel → lagre som lead (admin ser det under Leads)
    var cform = root.querySelector("[data-bk-contact-form]");
    if (cform) {
      App.ui.bindTerms(cform, "bk-c");
      cform.addEventListener("submit", function (e) {
        e.preventDefault();
        var st = cform.querySelector("[data-bk-c-status]");
        var name = cform.querySelector("#bk-c-name").value.trim();
        var email = cform.querySelector("#bk-c-email").value.trim();
        var message = cform.querySelector("#bk-c-msg").value.trim();
        if (!name || !email || !message) { st.textContent = "Fyll inn navn, e-post og melding."; st.className = "form__status is-error"; return; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { st.textContent = "Sjekk e-postadressen."; st.className = "form__status is-error"; return; }
        if (!App.ui.termsAccepted(cform, "bk-c")) { st.textContent = "Du må godta personvernerklæringen for å sende inn."; st.className = "form__status is-error"; return; }
        App.addLead({ name: name, email: email, message: message });
        cform.reset();
        st.textContent = (CFG.contactSection && CFG.contactSection.successMessage) || "Takk! Vi tar kontakt så snart vi kan.";
        st.className = "form__status is-ok";
      });
    }
  }

  // Inline bekreftelse for sanntidsbooking (kunden reserverer direkte)
  function openConfirm(assetEl, a, date, time) {
    var box = assetEl.querySelector("[data-confirm]");
    var nameId  = "bkc-name-"  + a.id;
    var emailId = "bkc-email-" + a.id;
    var phoneId = "bkc-phone-" + a.id;
    var msgId   = "bkc-msg-"   + a.id;
    box.innerHTML = '' +
      '<form class="bk-confirm__form" data-confirm-form>' +
        '<p class="bk-confirm__head">Reserver <strong>' + esc(a.name) + '</strong> · ' + C.formatDate(date) + ' kl. ' + time + '</p>' +
        '<div class="bk-2col">' +
          C.field({ id: nameId,  label: "Fullt navn", required: true }) +
          C.field({ id: emailId, label: "E-post",     required: true, type: "email" }) +
        '</div>' +
        '<div class="bk-2col">' +
          C.field({ id: phoneId, label: "Telefonnummer", placeholder: "+47 000 00 000" }) +
          C.field({ id: msgId,   label: "Melding",       placeholder: "Evt. kommentar til bookingen" }) +
        '</div>' +
        C.termsField({ idPrefix: "bkc-" + a.id }) +
        '<div class="admin-row__actions">' +
          C.button({ label: "Bekreft reservasjon", type: "submit", variant: "primary" }) +
          C.button({ label: "Avbryt", variant: "ghost", attrs: "data-cancel" }) +
        '</div>' +
        '<p class="form__status" data-cstatus></p>' +
      '</form>';
    var form = box.querySelector("[data-confirm-form]");
    var st = form.querySelector("[data-cstatus]");
    var termsId = "bkc-" + a.id;
    App.ui.bindTerms(form, termsId);
    form.querySelector("[data-cancel]").addEventListener("click", function () { box.innerHTML = ""; });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name  = form.querySelector("#" + nameId).value.trim();
      var email = form.querySelector("#" + emailId).value.trim();
      var phone = form.querySelector("#" + phoneId).value.trim();
      var msg   = form.querySelector("#" + msgId).value.trim();
      if (!name || !email) { st.textContent = "Fyll inn navn og e-post."; st.className = "form__status is-error"; return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { st.textContent = "Sjekk e-postadressen."; st.className = "form__status is-error"; return; }
      if (!App.ui.termsAccepted(form, termsId)) { st.textContent = "Du må godta personvernerklæringen for å reservere."; st.className = "form__status is-error"; return; }
      if (isBooked(a.id, date, time) || isBlocked(a, date, time)) { st.textContent = "Beklager, tiden er ikke tilgjengelig."; st.className = "form__status is-error"; return; }
      var list = getBookings();
      list.push({ id: "bk-" + Date.now(), assetId: a.id, date: date, time: time,
                  name: name, email: email, phone: phone, message: msg, instant: true, status: "ny" });
      setBookings(list);
      var picker = assetEl.querySelector(".bk-picker");
      var active = picker && picker.querySelector(".bk-datepill.is-active");
      if (picker && active) picker.querySelector("[data-times]").innerHTML = renderTimes(a, active.getAttribute("data-date"));
      box.innerHTML = '<p class="bk-confirm__ok">' + C.icon("circle-check") + ' Reservert! ' + C.formatDate(date) + ' kl. ' + time + '.</p>';
    });
  }

  /* =========================================================================
     ADMIN-FANE
     ====================================================================== */
  function renderAdmin(root) {
    if (!root) return;
    var assets = getAssets();
    root.innerHTML = '' +
      '<div class="bk-adm">' +
        '<div class="bk-adm__head"><h4>Ressurser</h4>' +
          C.button({ label:"Nytt asset", icon:"plus", variant:"primary", attrs:"data-asset-new" }) +
        '</div>' +
        '<ul class="admin-list" data-asset-list>' +
          (assets.length ? assets.map(adminAssetRow).join("") : '<li class="prose prose--muted">Ingen ressurser ennå.</li>') +
        '</ul>' +
        '<div data-asset-editor></div>' +
        '<hr class="bk-hr">' +
        '<div class="bk-adm__head"><h4>Bookinger</h4></div>' +
        '<div data-booking-area></div>' +
      '</div>';

    var nb = root.querySelector("[data-asset-new]");
    if (nb) nb.addEventListener("click", function () { openAssetEditor(root, null); });
    root.querySelectorAll("[data-asset-edit]").forEach(function (b) {
      b.addEventListener("click", function () { openAssetEditor(root, b.getAttribute("data-asset-edit")); });
    });
    root.querySelectorAll("[data-asset-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-asset-del");
        var a = getAssets().find(function (x) { return x.id === id; });
        if (a && a.image) App.media.free(a.image);
        setAssets(getAssets().filter(function (x) { return x.id !== id; }));
        setBookings(getBookings().filter(function (x) { return x.assetId !== id; })); // rydd bookinger
        renderAdmin(root);
      });
    });

    renderBookingArea(root);
  }

  function adminAssetRow(a) {
    var badge = a.visibility === "public" ? "Offentlig" : "Intern";
    return '' +
      '<li class="admin-row" data-id="' + esc(a.id) + '">' +
        '<div class="admin-row__main">' +
          '<strong>' + esc(a.name) + ' <span class="bk-badge bk-badge--' + esc(a.visibility) + '">' + badge + '</span></strong>' +
          '<span class="admin-row__meta">' + weekdaysLabel(a.weekdays) + ' · ' + esc(a.openFrom) + '–' + esc(a.openTo) + ' · ' + (a.slotMinutes||60) + ' min · ' + (a.instant ? "sanntid" : "forespørsel") + '</span>' +
        '</div>' +
        '<div class="admin-row__actions">' +
          C.button({ label:"Rediger", variant:"ghost", attrs:'data-asset-edit="'+esc(a.id)+'"' }) +
          C.button({ label:"Slett", variant:"ghost", attrs:'data-asset-del="'+esc(a.id)+'"' }) +
        '</div>' +
      '</li>';
  }

  function openAssetEditor(root, id) {
    var assets = getAssets();
    var a = id ? assets.find(function (x) { return x.id === id; }) : null;
    var ed = root.querySelector("[data-asset-editor]");
    var wd = (a && a.weekdays) || [1,2,3,4,5];
    var dayChecks = WD.map(function (d) {
      return '<label class="bk-wd"><input type="checkbox" value="'+d.n+'" '+(wd.indexOf(d.n)>-1?"checked":"")+'> '+d.l+'</label>';
    }).join("");
    var slotOpts = [30,45,60,90,120].map(function (m) {
      return '<option value="'+m+'" '+(((a?a.slotMinutes:60)===m)?"selected":"")+'>'+m+' min</option>';
    }).join("");

    ed.innerHTML = '' +
      '<form class="admin-form admin-form--card" data-asset-form>' +
        '<h4>' + (a ? "Rediger ressurs" : "Ny ressurs") + '</h4>' +
        C.field({ id:"as-name", label:"Navn", required:true, value:a?a.name:"" }) +
        C.field({ id:"as-desc", label:"Beskrivelse", multiline:true, rows:2, value:a?a.description:"" }) +
        App.ui.imageField("as-image", "Bilde", a?a.image:"", 16/10) +
        '<div class="field"><label for="as-vis">Synlighet</label>' +
          '<select id="as-vis">' +
            '<option value="public" '+(!a||a.visibility==="public"?"selected":"")+'>Offentlig (vises med kalender)</option>' +
            '<option value="internal" '+(a&&a.visibility==="internal"?"selected":"")+'>Intern (kun admin)</option>' +
          '</select></div>' +
        '<div class="field"><label for="as-mode">Booking-modus</label>' +
          '<select id="as-mode">' +
            '<option value="request" '+(!a||!a.instant?"selected":"")+'>Forespørsel (admin bekrefter)</option>' +
            '<option value="instant" '+(a&&a.instant?"selected":"")+'>Sanntid (kunden reserverer direkte)</option>' +
          '</select></div>' +
        '<div class="field"><label>Tilgjengelige dager</label><div class="bk-wds">'+dayChecks+'</div></div>' +
        '<div class="bk-2col">' +
          '<div class="field"><label for="as-from">Åpner</label><input type="time" id="as-from" value="'+esc(a?a.openFrom:"09:00")+'"></div>' +
          '<div class="field"><label for="as-to">Stenger</label><input type="time" id="as-to" value="'+esc(a?a.openTo:"16:00")+'"></div>' +
        '</div>' +
        '<div class="field"><label for="as-slot">Lengde pr. tid</label><select id="as-slot">'+slotOpts+'</select></div>' +
        '<div class="field"><label>Steng tider (gjør utilgjengelig)</label>' +
          '<div class="bk-block">' +
            '<div class="bk-blockrow">' +
              '<input type="date" data-block-date>' +
              '<select data-block-time></select>' +
              '<button type="button" class="btn btn--ghost" data-block-add>Steng</button>' +
            '</div>' +
            '<ul class="bk-blocklist" data-block-list></ul>' +
          '</div>' +
        '</div>' +
        '<div class="admin-row__actions">' +
          C.button({ label:a?"Oppdater":"Opprett", type:"submit", variant:"primary" }) +
          C.button({ label:"Avbryt", variant:"ghost", attrs:"data-asset-cancel" }) +
        '</div>' +
      '</form>';

    App.ui.bindImageFields(ed);

    // --- Steng tider: hel dag eller enkelt-time, lagres med asset ---
    var blockedDays = (a && a.blockedDays ? a.blockedDays.slice() : []);
    var blockedSlots = (a && a.blockedSlots ? a.blockedSlots.slice() : []);
    var btime = ed.querySelector("[data-block-time]");
    function refreshBlockTimes() {
      var tmp = { openFrom: ed.querySelector("#as-from").value || "09:00", openTo: ed.querySelector("#as-to").value || "16:00", slotMinutes: parseInt(ed.querySelector("#as-slot").value,10) || 60 };
      btime.innerHTML = '<option value="">Hele dagen</option>' + slotsFor(tmp).map(function (t) { return '<option>'+t+'</option>'; }).join("");
    }
    function renderBlockList() {
      var list = ed.querySelector("[data-block-list]");
      var items = blockedDays.map(function (d) { return { key:"d|"+d, label:C.formatDate(d)+" — hele dagen" }; })
        .concat(blockedSlots.map(function (s) { var p=s.split(" "); return { key:"s|"+s, label:C.formatDate(p[0])+" kl. "+p[1] }; }));
      list.innerHTML = items.length ? items.map(function (it) {
        return '<li class="bk-blockitem">' + esc(it.label) + '<button type="button" class="bk-blockx" data-block-del="'+esc(it.key)+'" aria-label="Fjern">×</button></li>';
      }).join("") : '<li class="prose prose--muted" style="padding:.2rem 0">Ingen stengte tider.</li>';
      list.querySelectorAll("[data-block-del]").forEach(function (b) {
        b.addEventListener("click", function () {
          var k = b.getAttribute("data-block-del");
          if (k.indexOf("d|")===0) blockedDays = blockedDays.filter(function (x) { return x !== k.slice(2); });
          else blockedSlots = blockedSlots.filter(function (x) { return x !== k.slice(2); });
          renderBlockList();
        });
      });
    }
    refreshBlockTimes();
    renderBlockList();
    ["#as-from","#as-to","#as-slot"].forEach(function (sel) { ed.querySelector(sel).addEventListener("change", refreshBlockTimes); });
    ed.querySelector("[data-block-add]").addEventListener("click", function () {
      var date = ed.querySelector("[data-block-date]").value;
      if (!date) return;
      var time = btime.value;
      if (time) { var key = date + " " + time; if (blockedSlots.indexOf(key) === -1) blockedSlots.push(key); }
      else { if (blockedDays.indexOf(date) === -1) blockedDays.push(date); }
      renderBlockList();
    });

    ed.querySelector("[data-asset-cancel]").addEventListener("click", function () { ed.innerHTML = ""; });
    ed.querySelector("[data-asset-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = ed.querySelector("#as-name").value.trim();
      if (!name) return;
      var weekdays = Array.prototype.slice.call(ed.querySelectorAll(".bk-wds input:checked")).map(function (c) { return parseInt(c.value,10); });
      var obj = {
        id: a ? a.id : ("as-" + Date.now()),
        name: name,
        description: ed.querySelector("#as-desc").value.trim(),
        image: App.ui.readImageField(ed, "as-image"),
        visibility: ed.querySelector("#as-vis").value,
        instant: ed.querySelector("#as-mode").value === "instant",
        weekdays: weekdays,
        openFrom: ed.querySelector("#as-from").value || "09:00",
        openTo: ed.querySelector("#as-to").value || "16:00",
        slotMinutes: parseInt(ed.querySelector("#as-slot").value,10) || 60,
        blockedDays: blockedDays,
        blockedSlots: blockedSlots
      };
      var list = getAssets();
      if (a) { var i = list.findIndex(function (x) { return x.id === a.id; }); list[i] = obj; }
      else list.push(obj);
      setAssets(list);
      renderAdmin(root);
    });
  }

  function renderBookingArea(root) {
    var area = root.querySelector("[data-booking-area]");
    var assets = getAssets();
    if (!assets.length) { area.innerHTML = '<p class="prose prose--muted">Opprett en ressurs først.</p>'; return; }
    var allBookings = getBookings();
    var active = App.getActiveStatuses("booking");
    var bookings = allBookings.filter(function (b) { return active.indexOf(b.status || "ny") > -1; });
    var counts = { ny: 0, lest: 0, løst: 0 };
    allBookings.forEach(function (b) { counts[b.status || "ny"]++; });

    var assetOpts = assets.map(function (a) { return '<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>'; }).join("");
    var rows = bookings.slice().sort(function (x,y) { return (x.date+x.time).localeCompare(y.date+y.time); }).map(function (b) {
      var a = assets.find(function (z) { return z.id === b.assetId; });
      var hasEmail = !!b.email;
      var st = b.status || "ny";

      // Avbook: e-post med avbooking + spørsmål om nytt tidspunkt
      var avbookBody = "Hei " + (b.name || "") + ",\n\nVi viser til din booking:\n" +
        "Ressurs: " + (a ? a.name : "") + "\nDato: " + C.formatDate(b.date) + " kl. " + b.time + "\n\n" +
        "Vi ønsker å avbooke denne timen.\n\n" +
        "Ønsker du å bestille et nytt tidspunkt? Ta gjerne kontakt, så finner vi en tid som passer.\n\n" +
        "Med vennlig hilsen";
      var avbookMailto = hasEmail
        ? "mailto:" + encodeURIComponent(b.email) +
          "?subject=" + encodeURIComponent("Avbooking – " + (a ? a.name : "") + " " + C.formatDate(b.date) + " kl. " + b.time) +
          "&body=" + encodeURIComponent(avbookBody)
        : "";

      // Svar: tom e-post med navn forhåndsutfylt i emnefeltet
      var svarMailto = hasEmail
        ? "mailto:" + encodeURIComponent(b.email) +
          "?subject=" + encodeURIComponent("Angående din reservasjon – " + (a ? a.name : "")) +
          "&body=" + encodeURIComponent("Hei " + (b.name || "") + ",\n\n")
        : "";

      return '<li class="admin-row" style="flex-direction:column;align-items:stretch;gap:.4rem" data-bk-row="' + esc(b.id) + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;flex-wrap:wrap">' +
          '<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">' +
            '<strong>' + esc(a?a.name:"(slettet)") + '</strong>' +
            '<span class="admin-row__meta">' + C.formatDate(b.date) + ' kl. ' + esc(b.time) + '</span>' +
            App.statusBadge(st) +
          '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:.4rem">' +
            '<div style="display:flex;gap:.4rem">' +
              (hasEmail ? C.button({ label:"Avbook", icon:"calendar-x", variant:"ghost", href:avbookMailto, attrs:'data-bk-resolve="' + esc(b.id) + '"' }) : '') +
              (hasEmail ? C.button({ label:"Svar",   icon:"mail",       variant:"ghost", href:svarMailto,   attrs:'data-bk-resolve="' + esc(b.id) + '"' }) : '') +
              C.button({ label:"Slett", variant:"ghost", attrs:'data-booking-del="'+esc(b.id)+'"' }) +
            '</div>' +
            '<select class="stat-select" data-bk-status="' + esc(b.id) + '">' +
              App.STATUS_ORDER.map(function (s) { return '<option value="' + s + '" ' + (s===st?"selected":"") + '>' + App.STATUS_LABELS[s] + '</option>'; }).join("") +
            '</select>' +
          '</div>' +
        '</div>' +
        '<details class="lead-details" data-bk-details="' + esc(b.id) + '">' +
          '<summary>Vis detaljer</summary>' +
          '<div class="admin-lead-msg">' +
            (b.name?'Navn: '+esc(b.name)+'<br>':'') + (b.email?'E-post: '+esc(b.email)+'<br>':'') +
            (b.phone?'Telefon: '+esc(b.phone)+'<br>':'') + (b.instant?'Sanntidsbooking<br>':'Forespørsel<br>') +
            (b.message?'<br><em>'+esc(b.message)+'</em>':'') +
          '</div>' +
        '</details>' +
      '</li>';
    }).join("");

    area.innerHTML = '' +
      '<form class="admin-form admin-form--card" data-booking-form>' +
        '<div class="field"><label for="bk-asset">Ressurs</label><select id="bk-asset" data-bk-asset>'+assetOpts+'</select></div>' +
        '<div class="bk-2col">' +
          '<div class="field"><label for="bk-date">Dato</label><input type="date" id="bk-date" data-bk-date></div>' +
          '<div class="field"><label for="bk-time">Tid</label><select id="bk-time" data-bk-time></select></div>' +
        '</div>' +
        C.field({ id:"bk-bname", label:"Navn (hvem booker)" }) +
        C.button({ label:"Legg til booking", type:"submit", variant:"primary" }) +
      '</form>' +
      App.statusFilterBar("booking", counts) +
      '<ul class="admin-list">' + (rows || '<li class="prose prose--muted">Ingen bookingar med valgt status.</li>') + '</ul>';

    App.bindStatusFilterBar(area, "booking", function () { renderBookingArea(root); });

    // Variant B: eksplisitt klikk på «Vis detaljer» → Lest
    area.querySelectorAll("[data-bk-details]").forEach(function (det) {
      det.addEventListener("toggle", function () {
        if (!det.open) return;
        var id = det.getAttribute("data-bk-details");
        var bk = getBookings().find(function (x) { return x.id === id; });
        if (bk && (bk.status || "ny") === "ny") {
          bk.status = "lest"; setBookings(getBookings().map(function (x) { return x.id === id ? bk : x; }));
          renderBookingArea(root);
        }
      });
    });
    // Avbook/Svar → Løst (begge typer "saka er handtert")
    area.querySelectorAll("[data-bk-resolve]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-bk-resolve");
        var list = getBookings();
        var bk = list.find(function (x) { return x.id === id; });
        if (bk) { bk.status = "løst"; setBookings(list); }
      });
    });
    area.querySelectorAll("[data-bk-status]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var id = sel.getAttribute("data-bk-status");
        var list = getBookings();
        var bk = list.find(function (x) { return x.id === id; });
        if (bk) { bk.status = sel.value; setBookings(list); renderBookingArea(root); }
      });
    });

    var assetSel = area.querySelector("[data-bk-asset]");
    var timeSel  = area.querySelector("[data-bk-time]");
    function fillTimes() {
      var a = assets.find(function (z) { return z.id === assetSel.value; });
      timeSel.innerHTML = slotsFor(a || {}).map(function (t) { return '<option>'+t+'</option>'; }).join("");
    }
    fillTimes();
    assetSel.addEventListener("change", fillTimes);

    area.querySelector("[data-booking-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      var assetId = assetSel.value, date = area.querySelector("[data-bk-date]").value, time = timeSel.value;
      var name = area.querySelector("#bk-bname").value.trim();
      if (!assetId || !date || !time) return;
      if (isBooked(assetId, date, time)) { alert("Denne tiden er allerede booket."); return; }
      var list = getBookings();
      list.push({ id:"bk-"+Date.now(), assetId:assetId, date:date, time:time, name:name, status:"ny" });
      setBookings(list);
      renderAdmin(root);
    });
    area.querySelectorAll("[data-booking-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        setBookings(getBookings().filter(function (x) { return x.id !== b.getAttribute("data-booking-del"); }));
        renderAdmin(root);
      });
    });
  }

  /* =========================================================================
     STILER (modulen tar med seg sine egne)
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("bk-styles")) return;
    var s = document.createElement("style");
    s.id = "bk-styles";
    s.textContent = [
      ".bk-assets{display:grid;gap:1.6rem;margin-top:.5rem}",
      ".bk-asset{border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden;background:var(--color-surface)}",
      ".bk-asset__img{width:100%;aspect-ratio:21/9;object-fit:cover;display:block}",
      ".bk-asset__body{padding:1.2rem 1.4rem 1.4rem}",
      ".bk-asset__title{font-size:1.3rem;margin:.1rem 0 .3rem}",
      ".bk-asset__desc{color:var(--color-muted);margin:0 0 1rem}",
      ".bk-dates{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.9rem}",
      ".bk-datepill{font:inherit;font-size:.84rem;padding:.4rem .7rem;border-radius:999px;border:1.5px solid var(--color-border);background:transparent;color:var(--color-text);cursor:pointer;text-transform:capitalize;white-space:nowrap}",
      ".bk-datepill:hover{border-color:var(--color-primary)}",
      ".bk-datepill.is-active{background:var(--color-primary);border-color:var(--color-primary);color:#fff}",
      ".bk-times{display:flex;flex-wrap:wrap;gap:.45rem}",
      ".bk-slot{font:inherit;font-size:.88rem;padding:.45rem .7rem;border-radius:8px;border:1.5px solid var(--color-primary);background:transparent;color:var(--color-primary);cursor:pointer;min-width:64px;text-align:center}",
      ".bk-slot:hover{background:var(--color-tint)}",
      ".bk-slot.is-booked{border-color:var(--color-border);color:var(--color-muted);background:color-mix(in srgb,var(--color-text) 6%,transparent);cursor:not-allowed;text-decoration:line-through}",
      ".bk-request{margin-top:1.1rem}",
      ".bk-contact{margin-top:2.4rem;border:1px solid var(--color-border);border-radius:var(--radius);padding:1.4rem 1.6rem 1.6rem;background:var(--color-surface);max-width:600px}",
      ".bk-contact__title{margin:0 0 1rem;font-size:1.25rem}",
      ".bk-confirm:empty{display:none}",
      ".bk-confirm{margin-top:1rem;border:1px solid var(--color-border);border-radius:10px;padding:1rem;background:var(--color-bg)}",
      ".bk-confirm__head{margin:0 0 .8rem}",
      ".bk-confirm__form{display:grid;gap:1rem}",
      ".bk-confirm__form .admin-row__actions{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:.2rem}",
      ".bk-confirm__ok{margin:0;display:flex;align-items:center;gap:.5rem;color:var(--color-primary);font-weight:600}",
      ".bk-confirm__ok .ti{font-size:1.3rem}",
      /* admin */
      ".bk-adm__head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin:.2rem 0 .4rem}",
      ".bk-adm__head h4{margin:0}",
      ".bk-hr{border:0;border-top:1px solid var(--color-border);margin:1.6rem 0 1rem}",
      ".bk-2col{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}",
      ".bk-wds{display:flex;flex-wrap:wrap;gap:.5rem}",
      ".bk-wd{display:inline-flex;align-items:center;gap:.3rem;font-size:.9rem;border:1px solid var(--color-border);border-radius:999px;padding:.3rem .7rem}",
      ".bk-blockrow{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}",
      ".bk-blocklist{list-style:none;margin:.7rem 0 0;padding:0;display:flex;flex-wrap:wrap;gap:.4rem}",
      ".bk-blockitem{display:inline-flex;align-items:center;gap:.4rem;font-size:.84rem;border:1px solid var(--color-border);border-radius:999px;padding:.25rem .3rem .25rem .7rem;background:var(--color-bg)}",
      ".bk-blockx{border:0;background:color-mix(in srgb,var(--color-text) 10%,transparent);color:var(--color-text);border-radius:999px;width:20px;height:20px;line-height:1;cursor:pointer;font-size:.9rem}",
      ".bk-badge{font-size:.7rem;font-weight:600;padding:.1rem .5rem;border-radius:999px;vertical-align:middle}",
      ".bk-badge--public{background:var(--color-tint);color:var(--color-primary)}",
      ".bk-badge--internal{background:color-mix(in srgb,var(--color-text) 8%,transparent);color:var(--color-muted)}",
      ".bk-badge--instant{background:var(--color-secondary);color:#fff}",
      ".bk-adm select,.bk-adm input[type=time],.bk-adm input[type=date]{font:inherit;padding:.6rem .7rem;border-radius:8px;border:1.5px solid var(--color-border);background:var(--color-bg);color:var(--color-text);width:100%}",
      "@media(max-width:560px){.bk-2col{grid-template-columns:1fr}}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     REGISTRERING  (selve modulkontrakten)
     ====================================================================== */
  injectStyles();
  App.registerModule({
    id: "booking",
    label: (CFG.booking && CFG.booking.heading) || "Booking",
    order: 45,                 // mellom Aktuelt (40) og Kontakt (50)
    page: true,                // egen side på #booking (ikke inline-seksjon)
    render: renderPage,
    mount: mountPage,
    admin: {
      label: "Booking",
      render: function () { return '<div data-bk-root></div>'; },
      mount: function (body) { renderAdmin(body.querySelector("[data-bk-root]")); }
    }
  });
})();
