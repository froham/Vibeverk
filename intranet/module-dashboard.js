/* =============================================================================
   module-dashboard.js  —  DASHBOARD (intranett)
   -----------------------------------------------------------------------------
   Tre seksjonar:
   1) Henvendelser — tre separate kort (Kontakt / Tilbud / Booking) med tal
   2) Oppgåver     — statuskort (Å gjøre / Pågår / Ferdig)
   3) Hurtighandlingar — dynamiske basert på aktive modular
   4) Siste aktivitet — minimert gardin, kan opnast/lukkast

   Lagring: berre lesing. Rute: #/dashboard
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;

  /* =========================================================================
     HJELPERAR
     ====================================================================== */
  function formatTs(ts) {
    if (!ts) return "";
    var d    = new Date(ts);
    var diff = Math.round((Date.now() - d) / 60000);
    if (diff < 1)  return "akkurat nå";
    if (diff < 60) return diff + " min siden";
    var h = Math.round(diff / 60);
    if (h < 24)   return h + " t siden";
    return d.toLocaleDateString("nb-NO", { day:"numeric", month:"short" });
  }

  var ACT_ICONS = {
    task_created:"circle-plus", task_updated:"pencil",
    task_deleted:"trash",       task_status:"circle-check",
    note_created:"notes",       note_updated:"pencil",
    kb_created:"book",          ann_created:"speakerphone",
    link_created:"link",        media_upload:"photo",
    contact_status:"mail",      quote_status:"file-invoice",
    booking_status:"calendar",  settings:"settings",
    orgdrift_updated:"building"
  };

  function feat(key) {
    var ift = CFG.intranettFeatures || {};
    return ift[key] !== false;
  }

  /* =========================================================================
     HENVENDELINGSDATA
     ====================================================================== */
  function getHenvendelser() {
    var leads    = App.getLeads ? App.getLeads() : [];
    var bookings = App.store.get("booking-bookings", []) || [];

    var contact = leads.filter(function (l) {
      return (!l.message || l.message.indexOf("Tilbudsforesp") !== 0);
    });
    var quote = leads.filter(function (l) {
      return l.message && l.message.indexOf("Tilbudsforesp") === 0;
    });

    function count(arr, status) {
      return arr.filter(function (x) { return (x.status || "ny") === status; }).length;
    }

    return {
      contact: { total: contact.length, ny: count(contact,"ny"), lest: count(contact,"lest"), løst: count(contact,"løst") },
      quote:   { total: quote.length,   ny: count(quote,"ny"),   lest: count(quote,"lest"),   løst: count(quote,"løst") },
      booking: { total: bookings.length, ny: count(bookings,"ny"), lest: count(bookings,"lest"), løst: count(bookings,"løst") }
    };
  }

  /* =========================================================================
     SNARVEIER
     ====================================================================== */
  function scKey() {
    var ctx = Intranet.getContext();
    return "wsp-shortcuts" + (ctx.userId ? "-" + ctx.userId : "");
  }

  function getShortcuts() { return App.store.get(scKey(), []) || []; }
  function saveShortcuts(list) { App.store.set(scKey(), list); }

  var SC_ICONS = [
    "link","external-link","home","mail","file-text","folder-open",
    "calendar","clock","chart-bar","users","building","settings",
    "tool","code","database","cloud","phone","message-circle",
    "search","star","bookmark","key","shield-check","rocket",
    "brand-google-drive","brand-slack","brand-github","globe",
    "currency-dollar","truck","checklist","notes"
  ];

  function iconPickerHtml(selected) {
    var sel = selected || "link";
    var btnStyle = "border-radius:7px;padding:.3rem .4rem;cursor:pointer;font-size:1.05rem;" +
                   "line-height:1;display:inline-flex;align-items:center;justify-content:center;" +
                   "transition:border-color .1s,color .1s,background .1s";
    return '<div style="display:grid;gap:.3rem">' +
      '<label style="font-size:.8rem;font-weight:600">Ikon</label>' +
      '<div id="dash-sc-icon-grid" style="display:flex;flex-wrap:wrap;gap:.3rem">' +
        SC_ICONS.map(function (ic) {
          var active = ic === sel;
          return '<button type="button" data-pick-sc-icon="' + C.esc(ic) + '" title="' + C.esc(ic) + '" ' +
            'style="background:' + (active ? 'var(--color-tint)' : 'transparent') + ';' +
                   'border:1.5px solid ' + (active ? 'var(--color-primary)' : 'var(--color-border)') + ';' +
                   'color:' + (active ? 'var(--color-primary)' : 'var(--color-muted)') + ';' + btnStyle + '">' +
            '<i class="ti ti-' + C.esc(ic) + '"></i>' +
          '</button>';
        }).join("") +
      '</div>' +
      '<input type="hidden" id="dash-sc-icon" value="' + C.esc(sel) + '">' +
    '</div>';
  }

  function renderShortcutBtn(sc) {
    var isInternal = sc.url && sc.url.charAt(0) === "#";
    return '<div style="display:inline-flex;align-items:center;gap:.1rem">' +
      '<a href="' + C.esc(sc.url) + '"' + (isInternal ? "" : ' target="_blank" rel="noopener"') +
        ' class="btn btn--ghost btn--sm" style="gap:.4rem;text-decoration:none">' +
        '<i class="ti ti-' + C.esc(sc.icon || "link") + '"></i>' +
        C.esc(sc.label) +
      '</a>' +
      '<button data-sc-del="' + C.esc(sc.id) + '" ' +
        'style="background:none;border:0;cursor:pointer;color:var(--color-muted);padding:.25rem;line-height:1;' +
               'border-radius:4px;display:inline-flex;align-items:center" title="Fjern snarvei">' +
        '<i class="ti ti-x" style="font-size:.75rem"></i>' +
      '</button>' +
    '</div>';
  }

  function renderShortcutForm(links) {
    var pickHtml = links.length
      ? '<div style="display:grid;gap:.25rem">' +
          '<label style="font-size:.8rem;font-weight:600;color:var(--color-muted)">Velg fra lenker (valgfritt)</label>' +
          '<select id="dash-sc-pick" style="font:inherit;font-size:.85rem;padding:.5rem .65rem;' +
            'border:1.5px solid var(--color-border);border-radius:8px;background:var(--color-bg);color:var(--color-text)">' +
            '<option value="">— Egendefinert —</option>' +
            links.map(function (l) {
              return '<option value="' + C.esc(l.id || l.url) + '" ' +
                'data-url="' + C.esc(l.url) + '" ' +
                'data-label="' + C.esc(l.title || l.url) + '" ' +
                'data-icon="' + C.esc(l.icon || "link") + '">' +
                C.esc(l.title || l.url) + '</option>';
            }).join("") +
          '</select>' +
        '</div>'
      : "";
    return '<div style="display:grid;gap:.65rem">' +
      pickHtml +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">' +
        '<div style="display:grid;gap:.25rem">' +
          '<label for="dash-sc-label" style="font-size:.8rem;font-weight:600">Navn</label>' +
          '<input id="dash-sc-label" type="text" placeholder="Min snarvei" ' +
            'style="font:inherit;font-size:.88rem;padding:.5rem .7rem;border:1.5px solid var(--color-border);border-radius:8px;background:var(--color-bg);color:var(--color-text)">' +
        '</div>' +
        '<div style="display:grid;gap:.25rem">' +
          '<label for="dash-sc-url" style="font-size:.8rem;font-weight:600">URL</label>' +
          '<input id="dash-sc-url" type="text" placeholder="https://…" ' +
            'style="font:inherit;font-size:.88rem;padding:.5rem .7rem;border:1.5px solid var(--color-border);border-radius:8px;background:var(--color-bg);color:var(--color-text)">' +
        '</div>' +
      '</div>' +
      iconPickerHtml("link") +
      '<div style="display:flex;gap:.5rem">' +
        '<button id="dash-sc-save" class="btn btn--primary btn--sm">Lagre snarvei</button>' +
        '<button id="dash-sc-cancel" class="btn btn--ghost btn--sm">Avbryt</button>' +
      '</div>' +
    '</div>';
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  function render() { return '<div id="dashboard-root"></div>'; }

  function mount(outlet) {
    var root = outlet.querySelector("#dashboard-root") || outlet;
    renderDashboard(root);
  }

  function renderDashboard(root) {
    var tasks     = App.store.get("wsp-tasks", []) || [];
    var activity  = Intranet.getActivity ? Intranet.getActivity() : [];
    var henv      = getHenvendelser();
    var shortcuts = getShortcuts();

    var taskCounts = { todo:0, in_progress:0, done:0 };
    tasks.forEach(function (t) { if (taskCounts[t.status] !== undefined) taskCounts[t.status]++; });

    var hasHenv = feat("contact") || feat("quote") || feat("booking");

    root.innerHTML =
      '<div class="i-page-head"><h2>Dashboard</h2></div>' +

      /* --- Henvendelser: tre separate kort --------------------------------- */
      (hasHenv
        ? '<p class="i-section-label" style="margin-bottom:.6rem">Henvendelser</p>' +
          '<div class="i-card-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1.4rem">' +
            (feat("contact") ? henvCard("Kontakt",  henv.contact, "#/contact", "mail")          : "") +
            (feat("quote")   ? henvCard("Tilbud",   henv.quote,   "#/quote",   "file-invoice")  : "") +
            (feat("booking") ? henvCard("Booking",  henv.booking, "#/booking", "calendar")      : "") +
          '</div>'
        : '') +

      /* --- Oppgåver: statuskort ------------------------------------------- */
      '<p class="i-section-label" style="margin-bottom:.6rem">Oppgåver</p>' +
      '<div class="i-card-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1.4rem">' +
        statCard("Å gjøre", taskCounts.todo,        "#/tasks", "ti-checklist") +
        statCard("Pågår",   taskCounts.in_progress, "#/tasks", "ti-loader") +
        statCard("Ferdig",  taskCounts.done,         "#/tasks", "ti-circle-check") +
      '</div>' +

      /* --- Hurtighandlingar ----------------------------------------------- */
      '<div class="i-card" style="margin-bottom:1rem">' +
        '<p class="i-section-label">Hurtighandlinger</p>' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
          quickAction("#/tasks",         "ti-plus",         "Ny oppgave",      "data-dash-new-task") +
          (feat("notes")         ? quickAction("#/notes",         "ti-notes",        "Nytt notat",          "data-dash-new-note")   : "") +
          (feat("announcements") ? quickAction("#/announcements", "ti-speakerphone", "Ny kunngjering",      "data-dash-new-ann")    : "") +
          (feat("kb")            ? quickAction("#/kb",            "ti-book",         "Ny KB-artikkel",      "data-dash-new-kb")     : "") +
          quickAction("#/settings",      "ti-settings",     "Innstillinger") +
        '</div>' +
      '</div>' +

      /* --- Snarveier ------------------------------------------------------- */
      '<div class="i-card" style="margin-bottom:1rem">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;' +
             (shortcuts.length > 0 ? 'margin-bottom:.65rem' : '') + '">' +
          '<p class="i-section-label" style="margin:0">Snarveier</p>' +
          '<button id="dash-add-shortcut" class="btn btn--ghost btn--sm" style="gap:.35rem">' +
            '<i class="ti ti-plus"></i> Legg til' +
          '</button>' +
        '</div>' +
        (shortcuts.length > 0
          ? '<div id="dash-shortcuts-list" style="display:flex;gap:.4rem;flex-wrap:wrap">' +
              shortcuts.map(renderShortcutBtn).join("") +
            '</div>'
          : '<p id="dash-shortcuts-empty" style="font-size:.82rem;color:var(--color-muted);margin:.4rem 0 0">' +
              'Ingen snarveier ennå — klikk «Legg til» for å legge til.' +
            '</p>') +
        '<div id="dash-shortcut-form" style="display:none;margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--color-border)">' +
        '</div>' +
      '</div>' +

      /* --- Aktivitetslogg: gardin (minimert som standard) ----------------- */
      '<div class="i-card" id="dash-act-card">' +
        '<button id="dash-act-toggle" style="width:100%;background:none;border:0;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:0;font:inherit">' +
          '<p class="i-section-label" style="margin:0">Siste aktivitet' +
            (activity.length ? ' <span style="background:var(--color-primary);color:#fff;border-radius:999px;font-size:.68rem;padding:.1rem .4rem;font-weight:700">' + activity.length + '</span>' : '') +
          '</p>' +
          '<i class="ti ti-chevron-down" id="dash-act-chevron" style="color:var(--color-muted);font-size:1rem;transition:transform .2s"></i>' +
        '</button>' +
        '<div id="dash-act-body" style="display:none;margin-top:.8rem">' +
          (activity.length
            ? '<ul style="list-style:none;padding:0;margin:0;display:grid;gap:0">' +
                activity.slice(0, 20).map(function (a) {
                  var icon = ACT_ICONS[a.type] || "point";
                  return '<li style="display:flex;align-items:center;gap:.65rem;padding:.5rem 0;border-bottom:1px solid var(--color-border)">' +
                    '<i class="ti ti-' + C.esc(icon) + '" style="color:var(--color-primary);font-size:.95rem;flex-shrink:0"></i>' +
                    '<span style="flex:1;font-size:.86rem">' + C.esc(a.label) + '</span>' +
                    '<span style="font-size:.75rem;color:var(--color-muted);flex-shrink:0">' + formatTs(a.ts) + '</span>' +
                  '</li>';
                }).join("") +
              '</ul>'
            : '<p style="color:var(--color-muted);font-size:.88rem;margin:0">Ingen aktivitet ennå.</p>'
          ) +
        '</div>' +
      '</div>';

    /* --- Snarveier: event-binding --------------------------------------- */
    var addBtn = root.querySelector("#dash-add-shortcut");
    var form   = root.querySelector("#dash-shortcut-form");

    if (addBtn && form) {
      addBtn.addEventListener("click", function () {
        if (form.style.display !== "none") {
          form.style.display = "none";
          return;
        }
        form.innerHTML = '<p style="font-size:.85rem;color:var(--color-muted)">Laster lenker…</p>';
        form.style.display = "";

        function populateForm(links) {
          form.innerHTML = renderShortcutForm(links);

          /* Velg eksisterende lenke → fyll inn felt + oppdater ikon */
          var pick = form.querySelector("#dash-sc-pick");
          var iconInput = form.querySelector("#dash-sc-icon");
          var iconGrid  = form.querySelector("#dash-sc-icon-grid");

          function highlightIcon(ic) {
            if (!iconGrid) return;
            iconGrid.querySelectorAll("[data-pick-sc-icon]").forEach(function (b) {
              var active = b.getAttribute("data-pick-sc-icon") === ic;
              b.style.background  = active ? "var(--color-tint)"    : "transparent";
              b.style.borderColor = active ? "var(--color-primary)"  : "var(--color-border)";
              b.style.color       = active ? "var(--color-primary)"  : "var(--color-muted)";
            });
          }

          if (pick) {
            pick.addEventListener("change", function () {
              var opt = pick.options[pick.selectedIndex];
              if (!opt || !opt.value) return;
              var labelEl = form.querySelector("#dash-sc-label");
              var urlEl   = form.querySelector("#dash-sc-url");
              if (labelEl) labelEl.value = opt.dataset.label || "";
              if (urlEl)   urlEl.value   = opt.dataset.url   || "";
              var ic = opt.dataset.icon || "link";
              if (iconInput) iconInput.value = ic;
              highlightIcon(ic);
            });
          }

          if (iconGrid) {
            iconGrid.addEventListener("click", function (e) {
              var btn = e.target.closest("[data-pick-sc-icon]");
              if (!btn) return;
              var ic = btn.getAttribute("data-pick-sc-icon");
              if (iconInput) iconInput.value = ic;
              highlightIcon(ic);
            });
          }

          form.querySelector("#dash-sc-save").addEventListener("click", function () {
            var label = (form.querySelector("#dash-sc-label") || {}).value;
            var url   = (form.querySelector("#dash-sc-url")   || {}).value;
            if (!label || !label.trim() || !url || !url.trim()) return;
            var icon  = (form.querySelector("#dash-sc-icon")  || {}).value || "link";
            var list  = getShortcuts();
            list.push({ id: "sc-" + Date.now(), label: label.trim(), url: url.trim(), icon: icon });
            saveShortcuts(list);
            renderDashboard(root);
          });

          form.querySelector("#dash-sc-cancel").addEventListener("click", function () {
            form.style.display = "none";
          });
        }

        if (typeof window._linksLoad === "function") {
          window._linksLoad(populateForm);
        } else {
          populateForm([]);
        }
      });
    }

    root.querySelectorAll("[data-sc-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id   = this.getAttribute("data-sc-del");
        var list = getShortcuts().filter(function (s) { return s.id !== id; });
        saveShortcuts(list);
        renderDashboard(root);
      });
    });

    /* --- Hurtighandlingar: event-binding ------------------------------- */
    var newTaskBtn = root.querySelector("[data-dash-new-task]");
    if (newTaskBtn) newTaskBtn.addEventListener("click", function (e) {
      e.preventDefault();
      Intranet.navigate("tasks");
      setTimeout(function () {
        if (typeof window._tasksOpenModal === "function") {
          window._tasksOpenModal();
        } else {
          var btn = document.querySelector("#tasks-new-btn");
          if (btn) btn.click();
        }
      }, 100);
    });
    var newNoteBtn = root.querySelector("[data-dash-new-note]");
    if (newNoteBtn) newNoteBtn.addEventListener("click", function (e) {
      e.preventDefault();
      Intranet.navigate("notes");
      setTimeout(function () {
        if (typeof window._notesOpenModal === "function") {
          window._notesOpenModal();
        } else {
          var btn = document.querySelector("#notes-new-btn");
          if (btn) btn.click();
        }
      }, 100);
    });
    var newAnnBtn = root.querySelector("[data-dash-new-ann]");
    if (newAnnBtn) newAnnBtn.addEventListener("click", function (e) {
      e.preventDefault();
      Intranet.navigate("announcements");
      setTimeout(function () {
        var annBtn = document.querySelector("#ann-new-btn");
        if (annBtn) annBtn.click();
      }, 100);
    });
    var newKbBtn = root.querySelector("[data-dash-new-kb]");
    if (newKbBtn) newKbBtn.addEventListener("click", function (e) {
      e.preventDefault();
      Intranet.navigate("kb");
      setTimeout(function () {
        var kbBtn = document.querySelector("#kb-new-btn");
        if (kbBtn) kbBtn.click();
      }, 100);
    });

    /* --- Aktivitetslogg: gardin-toggle --------------------------------- */
    var toggle  = root.querySelector("#dash-act-toggle");
    var body    = root.querySelector("#dash-act-body");
    var chevron = root.querySelector("#dash-act-chevron");
    if (toggle && body) {
      toggle.addEventListener("click", function () {
        var open = body.style.display !== "none";
        body.style.display    = open ? "none" : "";
        if (chevron) chevron.style.transform = open ? "" : "rotate(180deg)";
      });
    }
  }

  /* =========================================================================
     KORT-HJELPERAR
     ====================================================================== */
  function henvCard(label, data, href, icon) {
    var hasNew = data.ny > 0;
    var accentColor = hasNew ? "var(--color-primary)" : "var(--color-muted)";
    return '<a href="' + href + '" class="i-card" style="text-decoration:none;display:flex;flex-direction:column;gap:.5rem;align-self:stretch;' +
      (hasNew ? 'border-color:color-mix(in srgb,var(--color-primary) 40%,transparent)' : '') + '">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<span style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-muted)">' + C.esc(label) + '</span>' +
        '<i class="ti ti-' + C.esc(icon) + '" style="color:' + accentColor + ';font-size:1rem"></i>' +
      '</div>' +
      '<div style="display:flex;align-items:baseline;gap:.5rem">' +
        '<span style="font-size:1.7rem;font-weight:700;font-family:var(--font-display);color:var(--color-text)">' + data.total + '</span>' +
        '<span style="font-size:.78rem;color:var(--color-muted)">totalt</span>' +
      '</div>' +
      (hasNew
        ? '<div style="display:inline-flex;align-items:center;gap:.3rem;font-size:.75rem;font-weight:700;color:#fff;background:var(--color-primary);border-radius:999px;padding:.15rem .6rem;align-self:flex-start">' +
            '<i class="ti ti-circle-dot" style="font-size:.7rem"></i> ' + data.ny + ' ny' + (data.ny > 1 ? 'e' : '') +
          '</div>'
        : '<span style="font-size:.75rem;color:var(--color-muted)">' +
            (data.lest > 0 ? data.lest + ' lest · ' : '') + data.løst + ' løst' +
          '</span>'
      ) +
    '</a>';
  }

  function statCard(label, count, href, iconClass) {
    return '<a href="' + href + '" class="i-card" style="text-decoration:none;display:flex;flex-direction:column;gap:.3rem;align-self:stretch">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<span style="font-size:.78rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--color-muted)">' + C.esc(label) + '</span>' +
        '<i class="ti ' + C.esc(iconClass) + '" style="color:var(--color-muted);font-size:1rem"></i>' +
      '</div>' +
      '<span style="font-size:1.7rem;font-weight:700;font-family:var(--font-display);color:var(--color-text)">' + count + '</span>' +
    '</a>';
  }

  function quickAction(href, icon, label, dataAttr) {
    return '<a href="' + href + '" class="btn btn--ghost btn--sm"' + (dataAttr ? ' ' + dataAttr : '') + '>' +
      '<i class="ti ' + C.esc(icon) + '"></i> ' + C.esc(label) +
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
