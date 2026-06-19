/* =============================================================================
   module-announcements.js  —  INTERN AKTUELT (intranett)
   -----------------------------------------------------------------------------
   Intern meldingsflate for bedriften. Admin oppretter meldinger med tittel,
   rik tekst, vedlegg og valgfritt "viktig"-flagg.

   Viktige meldinger vises som en ikkje-forstyrrande banner øverst i intranettet
   til brukaren aktivt lukkar den. Lest-tilstand lagras per userId.

   Lagring:
   - App.store("wsp-announcements")   ← meldingsliste
   - App.store("wsp-ann-read")        ← liste av leste id-ar per brukar

   Vedlegg: App.media.putFile() — same mønster som offentleg aktuelt.
   Ruter:   #/announcements
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  if (!Intranet || !App || !C) return;

  var STORE_KEY    = "wsp-announcements";
  var READ_KEY     = "wsp-ann-read";
  var BANNER_ID    = "wsp-ann-banner";

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getItems()    { return App.store.get(STORE_KEY, []) || []; }
  function setItems(v)   { App.store.set(STORE_KEY, v); }
  function getRead()     { return App.store.get(READ_KEY, []) || []; }
  function markRead(id)  {
    var read = getRead();
    if (read.indexOf(id) === -1) { read.push(id); App.store.set(READ_KEY, read); }
  }

  function newId() {
    return "wsp-ann-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }

  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("nb-NO", {
      day: "numeric", month: "long", year: "numeric"
    });
  }

  /* =========================================================================
     BANNER (viktige meldingar øverst i shell)
     ====================================================================== */
  function renderBanner() {
    var existing = document.getElementById(BANNER_ID);
    if (existing) existing.remove();

    var items = getItems();
    var read  = getRead();
    var unread = items.filter(function (a) {
      return a.important && read.indexOf(a.id) === -1;
    });
    if (!unread.length) return;

    // Vis éin om gongen — nyaste viktige melding
    var ann = unread[0];

    var banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.cssText = [
      "position:sticky", "top:0", "z-index:90",
      "background:color-mix(in srgb,var(--color-primary) 92%,#000)",
      "color:#fff", "padding:.65rem 1.2rem",
      "display:flex", "align-items:center", "gap:.8rem",
      "font-size:.88rem", "border-bottom:2px solid var(--color-primary)"
    ].join(";");

    banner.innerHTML =
      '<i class="ti ti-speakerphone" style="font-size:1.1rem;flex-shrink:0"></i>' +
      '<strong style="flex-shrink:0">' + C.esc(ann.title) + '</strong>' +
      '<span style="flex:1;opacity:.92">' + C.esc(
        (ann.body || "").replace(/<[^>]+>/g, "").slice(0, 120) +
        ((ann.body || "").replace(/<[^>]+>/g, "").length > 120 ? "…" : "")
      ) + '</span>' +
      (unread.length > 1
        ? '<span style="opacity:.7;font-size:.78rem">' + (unread.length - 1) + ' til</span>'
        : '') +
      '<a href="#/announcements" style="color:#fff;font-weight:700;text-decoration:underline;white-space:nowrap;font-size:.82rem">Les mer</a>' +
      '<button id="wsp-ann-close" style="background:none;border:0;color:#fff;cursor:pointer;font-size:1.2rem;line-height:1;padding:.2rem .3rem;opacity:.8" aria-label="Lukk">&times;</button>';

    // Sett inn etter topbar
    var topbar = document.querySelector(".i-topbar");
    if (topbar && topbar.parentNode) {
      topbar.parentNode.insertBefore(banner, topbar.nextSibling);
    } else {
      var body = document.querySelector(".i-body");
      if (body) body.prepend(banner);
    }

    banner.querySelector("#wsp-ann-close").addEventListener("click", function () {
      markRead(ann.id);
      banner.remove();
      // Vis neste viktige om det finnes
      renderBanner();
    });
  }

  /* =========================================================================
     VEDLEGG-HJELPERAR (gjenbruker App.media)
     ====================================================================== */
  function attachFieldHtml(id, existing) {
    return '<div class="i-field" style="margin-top:.4rem">' +
      '<label>Vedlegg (valgfritt)</label>' +
      '<ul class="attach-list" data-attach-list style="list-style:none;padding:0;margin:0 0 .4rem;display:grid;gap:.3rem"></ul>' +
      '<label class="btn btn--ghost btn--sm" style="cursor:pointer">' +
        '<i class="ti ti-upload"></i> Last opp vedlegg' +
        '<input type="file" multiple style="display:none" data-attach-file>' +
      '</label>' +
      '<p style="font-size:.78rem;color:var(--color-muted);margin:.3rem 0 0">Maks ' + App.media.MAX_FILE_MB + ' MB per fil.</p>' +
      '<input type="hidden" id="' + C.esc(id) + '" value="' + C.esc(JSON.stringify(existing || [])) + '">' +
    '</div>';
  }

  function bindAttachField(scope, hiddenId) {
    var wrap   = scope.querySelector('[data-attach-list]') ? scope : scope.querySelector('[data-attach-list]');
    var hidden = scope.querySelector('#' + hiddenId);
    var list   = scope.querySelector('[data-attach-list]');
    var file   = scope.querySelector('[data-attach-file]');
    if (!hidden || !list || !file) return;

    var state;
    try { state = JSON.parse(hidden.value) || []; } catch (e) { state = []; }

    function sync() { hidden.value = JSON.stringify(state); }
    function renderList() {
      list.innerHTML = state.map(function (a, i) {
        return '<li style="display:flex;align-items:center;gap:.5rem;font-size:.85rem">' +
          '<i class="ti ti-paperclip" style="color:var(--color-muted)"></i>' +
          '<span style="flex:1">' + C.esc(a.name) + '</span>' +
          '<span style="color:var(--color-muted);font-size:.75rem">' + (a.size ? Math.round(a.size/1024) + ' KB' : '') + '</span>' +
          '<button type="button" data-rm="' + i + '" style="background:none;border:0;cursor:pointer;color:var(--color-muted);font-size:1rem;line-height:1">&times;</button>' +
        '</li>';
      }).join("");
    }

    file.addEventListener("change", function () {
      var files = Array.prototype.slice.call(file.files || []);
      file.value = "";
      (function next(idx) {
        if (idx >= files.length) return;
        App.media.putFile(files[idx]).then(function (att) {
          state.push(att); sync(); renderList(); next(idx + 1);
        }).catch(function () { next(idx + 1); });
      })(0);
    });

    list.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-rm]");
      if (!btn) return;
      var i = parseInt(btn.getAttribute("data-rm"), 10);
      if (state[i]) { App.media.freeFile(state[i].ref); state.splice(i, 1); sync(); renderList(); }
    });

    renderList();
  }

  function readAttachments(scope, hiddenId) {
    var el = scope.querySelector('#' + hiddenId);
    if (!el) return [];
    try { return JSON.parse(el.value) || []; } catch (e) { return []; }
  }

  function attachmentsHtml(attachments) {
    if (!attachments || !attachments.length) return "";
    return '<ul style="list-style:none;padding:0;margin:.8rem 0 0;display:grid;gap:.3rem">' +
      attachments.map(function (a) {
        var href = App.media.resolveFile ? App.media.resolveFile(a.ref) : "#";
        return '<li><a href="' + C.esc(href) + '" download="' + C.esc(a.name) + '" ' +
          'style="display:inline-flex;align-items:center;gap:.4rem;font-size:.85rem;color:var(--color-primary)">' +
          '<i class="ti ti-paperclip"></i>' + C.esc(a.name) +
          '<span style="color:var(--color-muted);font-size:.75rem">(' + Math.round((a.size||0)/1024) + ' KB)</span>' +
          '</a></li>';
      }).join("") +
    '</ul>';
  }

  /* =========================================================================
     RENDER — LISTE
     ====================================================================== */
  function render() { return '<div id="ann-root"></div>'; }

  function mount(outlet, ctx) {
    var root = outlet.querySelector("#ann-root") || outlet;
    renderList(root, ctx);
  }

  function isAdmin(ctx) {
    return !ctx || ctx.role === "owner" || ctx.role === "admin";
  }

  function renderList(root, ctx) {
    var items = getItems();
    var admin = isAdmin(ctx);

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Aktuelt <span style="font-size:1rem;font-weight:400;color:var(--color-muted)">(' + items.length + ')</span></h2>' +
        (admin
          ? '<button class="btn btn--primary btn--sm" id="ann-new-btn"><i class="ti ti-plus"></i> Ny melding</button>'
          : '') +
      '</div>' +

      '<div id="ann-editor"></div>' +

      (items.length === 0
        ? '<p style="color:var(--color-muted);font-size:.9rem">Ingen meldinger ennå.</p>'
        : '<div style="display:grid;gap:.8rem">' +
            items.map(function (a) {
              return '<div class="i-card" style="position:relative">' +
                (a.important
                  ? '<span style="display:inline-flex;align-items:center;gap:.3rem;font-size:.72rem;font-weight:700;text-transform:uppercase;' +
                    'letter-spacing:.06em;color:var(--color-primary);margin-bottom:.4rem">' +
                    '<i class="ti ti-speakerphone"></i> Viktig</span><br>'
                  : '') +
                '<strong style="font-size:1rem">' + C.esc(a.title) + '</strong>' +
                '<div style="font-size:.78rem;color:var(--color-muted);margin:.2rem 0 .7rem">' + formatDate(a.createdAt) + '</div>' +
                (a.body
                  ? '<div style="font-size:.9rem;line-height:1.6;color:var(--color-text)">' + C.sanitizeRichHtml(a.body) + '</div>'
                  : '') +
                attachmentsHtml(a.attachments) +
                (admin
                  ? '<div style="display:flex;gap:.4rem;margin-top:.8rem;padding-top:.6rem;border-top:1px solid var(--color-border)">' +
                      '<button class="btn btn--ghost btn--sm" data-ann-edit="' + C.esc(a.id) + '">Rediger</button>' +
                      '<button class="btn btn--ghost btn--sm" style="color:#c0392b;border-color:#c0392b" data-ann-del="' + C.esc(a.id) + '">Slett</button>' +
                    '</div>'
                  : '') +
              '</div>';
            }).join("") +
          '</div>'
      );

    if (admin) {
      var newBtn = root.querySelector("#ann-new-btn");
      if (newBtn) newBtn.addEventListener("click", function () {
        openEditor(root, null, ctx);
      });

      root.querySelectorAll("[data-ann-edit]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-ann-edit");
          var item = getItems().find(function (a) { return a.id === id; });
          if (item) openEditor(root, item, ctx);
        });
      });

      root.querySelectorAll("[data-ann-del]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-ann-del");
          var item = getItems().find(function (a) { return a.id === id; });
          if (!confirm('Slett "' + (item ? item.title : "") + '"?')) return;
          if (item && item.attachments) {
            item.attachments.forEach(function (a) { App.media.freeFile(a.ref); });
          }
          setItems(getItems().filter(function (a) { return a.id !== id; }));
          Intranet.logActivity({ type: "ann_deleted", label: "Melding slettet" });
          renderList(root, ctx);
          renderBanner();
        });
      });
    }
  }

  /* =========================================================================
     EDITOR (opprett / rediger)
     ====================================================================== */
  function openEditor(root, item, ctx) {
    var ed = root.querySelector("#ann-editor");
    if (!ed) return;

    // Enkel rik-tekst via contenteditable
    ed.innerHTML =
      '<div class="i-card" style="margin-bottom:1rem">' +
        '<h4 style="margin:0 0 1rem">' + (item ? "Rediger melding" : "Ny melding") + '</h4>' +
        '<div class="i-form" id="ann-form">' +
          '<div class="i-field">' +
            '<label for="ann-title">Tittel *</label>' +
            '<input id="ann-title" type="text" value="' + C.esc(item ? item.title : "") + '" placeholder="Meldingstittel" required>' +
          '</div>' +
          '<div class="i-field">' +
            '<label for="ann-body">Innhold</label>' +
            '<textarea id="ann-body" rows="5" style="resize:vertical">' + C.esc(item ? (item.body || "").replace(/<[^>]+>/g, "") : "") + '</textarea>' +
          '</div>' +
          attachFieldHtml("ann-attachments", item ? (item.attachments || []) : []) +
          '<div class="i-field" style="margin-top:.2rem">' +
            '<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:500">' +
              '<input type="checkbox" id="ann-important"' + (item && item.important ? " checked" : "") + '>' +
              '<i class="ti ti-speakerphone" style="color:var(--color-primary)"></i>' +
              'Merk som viktig (vises som banner øverst)' +
            '</label>' +
          '</div>' +
          '<div style="display:flex;gap:.6rem;margin-top:.4rem">' +
            '<button type="button" class="btn btn--primary btn--sm" id="ann-save">Lagre</button>' +
            '<button type="button" class="btn btn--ghost btn--sm" id="ann-cancel">Avbryt</button>' +
          '</div>' +
          '<p class="form__status" id="ann-status"></p>' +
        '</div>' +
      '</div>';

    bindAttachField(ed, "ann-attachments");

    ed.querySelector("#ann-cancel").addEventListener("click", function () {
      ed.innerHTML = "";
    });

    ed.querySelector("#ann-save").addEventListener("click", function () {
      var title = ed.querySelector("#ann-title").value.trim();
      if (!title) {
        var st = ed.querySelector("#ann-status");
        st.textContent = "Tittel er påkrevd."; st.className = "form__status is-err";
        return;
      }
      var body        = ed.querySelector("#ann-body").value.trim();
      var important   = ed.querySelector("#ann-important").checked;
      var attachments = readAttachments(ed, "ann-attachments");

      var list = getItems();
      if (item) {
        var idx = list.findIndex(function (a) { return a.id === item.id; });
        // Frigjør gamle vedlegg som er fjernet
        var oldAtts = item.attachments || [];
        var newRefs = attachments.map(function (a) { return a.ref; });
        oldAtts.forEach(function (a) {
          if (newRefs.indexOf(a.ref) === -1) App.media.freeFile(a.ref);
        });
        list[idx] = Object.assign({}, item, {
          title: title, body: body, important: important,
          attachments: attachments, updatedAt: Date.now()
        });
        Intranet.logActivity({ type: "ann_updated", label: "Melding oppdatert: " + title });
      } else {
        list.unshift({
          id: newId(), title: title, body: body, important: important,
          attachments: attachments, createdAt: Date.now(), updatedAt: Date.now(),
          createdBy: Intranet.getContext ? Intranet.getContext().userId : "local"
        });
        Intranet.logActivity({ type: "ann_created", label: "Ny melding: " + title });
      }
      setItems(list);
      ed.innerHTML = "";
      renderList(root, ctx);
      renderBanner();
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  // Render banner ved oppstart
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(renderBanner, 50);
    });
  } else {
    setTimeout(renderBanner, 50);
  }

  // Eksponér renderBanner for intranet-core (re-render ved rute-endring)
  window._annRenderBanner = renderBanner;

  Intranet.registerModule({
    id:       "announcements",
    navLabel: "Aktuelt",
    icon:     "news",
    order:    15,
    render:   render,
    mount:    mount
  });

})();
