/* =============================================================================
   module-notes.js  —  NOTATER (intranett)  v2
   -----------------------------------------------------------------------------
   - Kort-/listevisning med toggle (à la OrgDrift)
   - Redigering i popup-modal, ikkje inline
   - Autosave i popup (debounce 800ms)
   - Søk, kategori-filter, tags
   Lagring:  App.store("wsp-notes")
   Ruter:    #/notes, #/notes/<id>
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.notes === false) return;

  var STORE_KEY  = "wsp-notes";
  var VIEW_KEY   = "wsp-notes-view"; // "card" | "list"

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getNotes()  { return App.store.get(STORE_KEY, []) || []; }
  function setNotes(v) { App.store.set(STORE_KEY, v); }

  function newId() {
    return "wsp-n-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }

  function createNote(data) {
    var now  = Date.now();
    var note = {
      id:        newId(),
      title:     data.title    || "Uten tittel",
      body:      data.body     || "",
      category:  data.category || "",
      tags:      data.tags     || [],
      summary:   data.summary  || "",
      createdAt: now,
      updatedAt: now,
      createdBy: Intranet.getContext ? Intranet.getContext().userId : "local"
    };
    var list = getNotes();
    list.unshift(note);
    setNotes(list);
    Intranet.logActivity({ type: "note_created", label: "Nytt notat: " + note.title });
    return note;
  }

  function updateNote(id, changes) {
    var list = getNotes();
    var idx  = list.findIndex(function (n) { return n.id === id; });
    if (idx < 0) return null;
    Object.assign(list[idx], changes, { updatedAt: Date.now() });
    setNotes(list);
    return list[idx];
  }

  function deleteNote(id) {
    var list = getNotes();
    var note = list.find(function (n) { return n.id === id; });
    setNotes(list.filter(function (n) { return n.id !== id; }));
    if (note) Intranet.logActivity({ type: "note_deleted", label: "Notat slettet: " + note.title });
  }

  function getCategories() {
    var cats = {};
    getNotes().forEach(function (n) {
      if (n.category) cats[n.category] = (cats[n.category] || 0) + 1;
    });
    return Object.keys(cats).sort();
  }

  /* =========================================================================
     SØK
     ====================================================================== */
  function searchNotes(query, category) {
    var q     = (query || "").toLowerCase().trim();
    var notes = getNotes();
    if (category) notes = notes.filter(function (n) { return n.category === category; });
    if (!q) return notes;
    return notes.filter(function (n) {
      return (n.title    || "").toLowerCase().indexOf(q) > -1 ||
             (n.body     || "").toLowerCase().indexOf(q) > -1 ||
             (n.category || "").toLowerCase().indexOf(q) > -1 ||
             (n.tags     || []).some(function (t) { return t.toLowerCase().indexOf(q) > -1; });
    });
  }

  /* =========================================================================
     HJELPERAR
     ====================================================================== */
  function formatDate(ts) {
    if (!ts) return "";
    var d    = new Date(ts);
    var now  = new Date();
    var diff = Math.round((now - d) / 60000);
    if (diff < 1)  return "akkurat nå";
    if (diff < 60) return diff + " min siden";
    var h = Math.round(diff / 60);
    if (h < 24) return h + " t siden";
    return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
  }

  function parseTags(str) {
    return (str || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
  }

  function tagsHtml(tags) {
    if (!tags || !tags.length) return "";
    return tags.slice(0, 3).map(function (t) {
      return '<span style="font-size:.7rem;font-weight:600;padding:.1rem .4rem;border-radius:999px;' +
        'background:color-mix(in srgb,var(--color-primary) 12%,transparent);color:var(--color-primary)">' +
        C.esc(t) + '</span>';
    }).join(" ");
  }

  function bodyPreview(body) {
    return C.stripHtml(body || "").slice(0, 120);
  }

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("notes-styles")) return;
    var s = document.createElement("style");
    s.id  = "notes-styles";
    s.textContent = [
      ".notes-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.75rem}",
      ".notes-card{background:var(--color-surface);border:1.5px solid var(--color-border);border-radius:var(--radius);padding:1rem 1.1rem;cursor:pointer;transition:border-color .15s,box-shadow .15s;text-align:left;width:100%;font:inherit}",
      ".notes-card:hover{border-color:var(--color-primary);box-shadow:0 4px 14px color-mix(in srgb,var(--color-primary) 12%,transparent)}",
      ".notes-card__title{font-weight:700;font-size:.92rem;margin-bottom:.3rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--color-text)}",
      ".notes-card__preview{font-size:.8rem;color:var(--color-muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:.5rem}",
      ".notes-card__meta{font-size:.72rem;color:var(--color-muted);display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap}",
      ".notes-card__cat{font-size:.72rem;color:var(--color-primary);font-weight:600;margin-bottom:.25rem}",
      ".notes-list-row{background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;padding:.65rem 1rem;cursor:pointer;transition:border-color .15s;display:flex;align-items:center;gap:.75rem;width:100%;text-align:left;font:inherit}",
      ".notes-list-row:hover{border-color:var(--color-primary)}",
      ".notes-list-row__main{flex:1;min-width:0}",
      ".notes-list-row__title{font-weight:600;font-size:.9rem;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".notes-list-row__meta{font-size:.75rem;color:var(--color-muted);margin-top:.1rem}",
      ".notes-view-btn{background:none;border:1.5px solid var(--color-border);border-radius:8px;padding:.35rem .6rem;cursor:pointer;color:var(--color-muted);font-size:.85rem;transition:background .12s,border-color .12s}",
      ".notes-view-btn.is-active{background:var(--color-primary);border-color:var(--color-primary);color:#fff}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  function render() { return '<div id="notes-root"></div>'; }

  function mount(outlet, ctx, sub) {
    var root = outlet.querySelector("#notes-root") || outlet;
    injectStyles();
    renderPage(root);
    if (sub) openNoteModal(sub, root);
  }

  function getView() { return App.store.get(VIEW_KEY, "card") || "card"; }
  function setView(v) { App.store.set(VIEW_KEY, v); }

  function renderPage(root) {
    var cats = getCategories();
    var view = getView();

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Notater</h2>' +
        '<button class="btn btn--primary btn--sm" id="notes-new-btn"><i class="ti ti-plus"></i> Nytt notat</button>' +
      '</div>' +

      /* Søk + filter + visning-toggle */
      '<div style="display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap;align-items:center">' +
        '<div style="flex:1;min-width:160px;position:relative">' +
          '<i class="ti ti-search" style="position:absolute;left:.7rem;top:50%;transform:translateY(-50%);color:var(--color-muted);font-size:.9rem"></i>' +
          '<input id="notes-search" type="search" placeholder="Søk i notater…" ' +
            'style="width:100%;padding:.5rem .8rem .5rem 2rem;border:1.5px solid var(--color-border);border-radius:8px;font:inherit;font-size:.88rem;background:var(--color-bg);color:var(--color-text)">' +
        '</div>' +
        (cats.length
          ? '<select id="notes-cat-filter" style="padding:.5rem .8rem;border:1.5px solid var(--color-border);border-radius:8px;font:inherit;font-size:.88rem;background:var(--color-bg);color:var(--color-text)">' +
              '<option value="">Alle kategorier</option>' +
              cats.map(function (c) { return '<option value="' + C.esc(c) + '">' + C.esc(c) + '</option>'; }).join("") +
            '</select>'
          : '') +
        '<div style="display:flex;gap:.3rem">' +
          '<button class="notes-view-btn' + (view === "card" ? " is-active" : "") + '" id="notes-view-card" title="Kortvisning"><i class="ti ti-layout-grid"></i></button>' +
          '<button class="notes-view-btn' + (view === "list" ? " is-active" : "") + '" id="notes-view-list" title="Listevisning"><i class="ti ti-list"></i></button>' +
        '</div>' +
      '</div>' +

      '<div id="notes-grid"></div>';

    renderGrid(root);
    bindPage(root);
  }

  function renderGrid(root) {
    var view     = getView();
    var searchEl = root.querySelector("#notes-search");
    var catEl    = root.querySelector("#notes-cat-filter");
    var query    = searchEl ? searchEl.value : null;
    var category = catEl    ? catEl.value    : null;
    var notes    = searchNotes(query, category);
    var grid     = root.querySelector("#notes-grid");
    if (!grid) return;

    if (!notes.length) {
      grid.innerHTML = '<p style="color:var(--color-muted);font-size:.9rem">' +
        (query || category ? "Ingen treff." : "Ingen notater ennå. Klikk «Nytt notat».") + '</p>';
      return;
    }

    if (view === "list") {
      grid.innerHTML = '<div style="display:grid;gap:.4rem">' +
        notes.map(function (n) {
          return '<button class="notes-list-row" data-note-open="' + C.esc(n.id) + '">' +
            '<div class="notes-list-row__main">' +
              '<div class="notes-list-row__title">' + C.esc(n.title || "Uten tittel") + '</div>' +
              '<div class="notes-list-row__meta">' +
                (n.category ? '<span style="color:var(--color-primary)">' + C.esc(n.category) + '</span> · ' : '') +
                formatDate(n.updatedAt) +
              '</div>' +
            '</div>' +
            (n.tags && n.tags.length ? '<div style="display:flex;gap:.3rem">' + tagsHtml(n.tags) + '</div>' : '') +
          '</button>';
        }).join("") +
      '</div>';
    } else {
      grid.innerHTML = '<div class="notes-card-grid">' +
        notes.map(function (n) {
          var preview = bodyPreview(n.body);
          return '<button class="notes-card" data-note-open="' + C.esc(n.id) + '">' +
            (n.category ? '<div class="notes-card__cat">' + C.esc(n.category) + '</div>' : '') +
            '<div class="notes-card__title">' + C.esc(n.title || "Uten tittel") + '</div>' +
            (preview ? '<div class="notes-card__preview">' + C.esc(preview) + '</div>' : '') +
            '<div class="notes-card__meta">' +
              '<span>' + formatDate(n.updatedAt) + '</span>' +
              '<span>' + tagsHtml(n.tags) + '</span>' +
            '</div>' +
          '</button>';
        }).join("") +
      '</div>';
    }

    /* Bind note-open på ferske element */
    grid.querySelectorAll("[data-note-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openNoteModal(btn.getAttribute("data-note-open"), root);
      });
    });
  }

  function bindPage(root) {
    root.querySelector("#notes-new-btn").addEventListener("click", function () {
      openNoteModal(null, root);
    });

    var searchEl = root.querySelector("#notes-search");
    var catEl    = root.querySelector("#notes-cat-filter");
    if (searchEl) searchEl.addEventListener("input",  function () { renderGrid(root); });
    if (catEl)    catEl.addEventListener("change",    function () { renderGrid(root); });

    root.querySelector("#notes-view-card").addEventListener("click", function () {
      setView("card");
      root.querySelector("#notes-view-card").classList.add("is-active");
      root.querySelector("#notes-view-list").classList.remove("is-active");
      renderGrid(root);
    });
    root.querySelector("#notes-view-list").addEventListener("click", function () {
      setView("list");
      root.querySelector("#notes-view-list").classList.add("is-active");
      root.querySelector("#notes-view-card").classList.remove("is-active");
      renderGrid(root);
    });
  }

  /* =========================================================================
     POPUP-MODAL (opprett / rediger)
     ====================================================================== */
  function openNoteModal(id, root) {
    var note  = id ? getNotes().find(function (n) { return n.id === id; }) : null;
    var isNew = !note;

    var existing = document.getElementById("note-modal-bd");
    if (existing) existing.remove();

    var bd = document.createElement("div");
    bd.id  = "note-modal-bd";
    bd.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto";

    var modal = document.createElement("div");
    modal.style.cssText = "background:var(--color-bg);border-radius:var(--radius);width:min(680px,100%);max-height:90vh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.3);display:flex;flex-direction:column";

    var cats = getCategories();

    modal.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.2rem;border-bottom:1px solid var(--color-border);position:sticky;top:0;background:var(--color-bg);z-index:1">' +
        '<div style="display:flex;align-items:center;gap:.7rem;flex:1;min-width:0">' +
          '<input id="nm-title" type="text" value="' + C.esc(note ? note.title || "" : "") + '" ' +
            'placeholder="Tittelaus…" ' +
            'style="flex:1;font:inherit;font-family:var(--font-display);font-size:1.1rem;font-weight:700;border:0;background:transparent;color:var(--color-text);outline:none;min-width:0">' +
          '<span id="nm-save-status" style="font-size:.72rem;color:var(--color-muted);white-space:nowrap"></span>' +
        '</div>' +
        '<button id="nm-close" style="background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);line-height:1;margin-left:.5rem">&times;</button>' +
      '</div>' +

      '<div style="padding:1rem 1.2rem;display:grid;gap:.7rem;flex:1">' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
          '<input id="nm-category" type="text" list="nm-cat-list" value="' + C.esc(note ? note.category || "" : "") + '" ' +
            'placeholder="Kategori…" ' +
            'style="flex:1;min-width:120px;font:inherit;font-size:.85rem;padding:.4rem .7rem;border:1.5px solid var(--color-border);border-radius:8px;background:var(--color-surface);color:var(--color-text)">' +
          '<datalist id="nm-cat-list">' + cats.map(function(c){ return '<option value="' + C.esc(c) + '">'; }).join("") + '</datalist>' +
          '<input id="nm-tags" type="text" value="' + C.esc(note ? (note.tags || []).join(", ") : "") + '" ' +
            'placeholder="Tags (kommaseparert)…" ' +
            'style="flex:2;min-width:160px;font:inherit;font-size:.85rem;padding:.4rem .7rem;border:1.5px solid var(--color-border);border-radius:8px;background:var(--color-surface);color:var(--color-text)">' +
        '</div>' +
        C.richTextField({ id: "nm-body", label: "", value: note ? note.body || "" : "" }) +
        '<input id="nm-summary" type="text" value="' + C.esc(note ? note.summary || "" : "") + '" ' +
          'placeholder="Kort AI-sammendrag (valgfritt)…" ' +
          'style="font:inherit;font-size:.78rem;padding:.35rem .7rem;border:1.5px solid var(--color-border);border-radius:8px;background:var(--color-surface);color:var(--color-muted)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:.2rem">' +
          '<p style="font-size:.72rem;color:var(--color-muted);margin:0">Sist endret: ' + (note ? formatDate(note.updatedAt) : "akkurat nå") + '</p>' +
          (!isNew ? '<button id="nm-delete" style="background:none;border:0;cursor:pointer;font-size:.8rem;color:#c0392b;font:inherit">Slett notat</button>' : '') +
        '</div>' +
      '</div>';

    bd.appendChild(modal);
    document.body.appendChild(bd);
    App.ui.bindRichTextFields(modal);

    var titleInp   = modal.querySelector("#nm-title");
    var catInp     = modal.querySelector("#nm-category");
    var tagsInp    = modal.querySelector("#nm-tags");
    var summaryInp = modal.querySelector("#nm-summary");
    var statusEl   = modal.querySelector("#nm-save-status");

    /* Fokus på tittel om nytt, på body om eksisterande */
    if (isNew) {
      titleInp.focus();
    } else {
      var rtEd = modal.querySelector(".rtfield__editor");
      if (rtEd) rtEd.focus();
    }

    /* Autosave */
    var currentId  = note ? note.id : null;
    var saveTimer;

    function scheduleAutosave() {
      clearTimeout(saveTimer);
      if (statusEl) statusEl.textContent = "Lagrer…";
      saveTimer = setTimeout(function () {
        var title = titleInp.value.trim() || "Uten tittel";
        var data  = {
          title:    title,
          body:     App.ui.readRichTextField(modal, "nm-body"),
          category: catInp    ? catInp.value.trim()      : "",
          tags:     tagsInp   ? parseTags(tagsInp.value) : [],
          summary:  summaryInp ? summaryInp.value.trim() : ""
        };
        if (!currentId) {
          var created = createNote(data);
          currentId = created.id;
        } else {
          updateNote(currentId, data);
        }
        if (statusEl) {
          statusEl.textContent = "Lagret";
          setTimeout(function () { if (statusEl) statusEl.textContent = ""; }, 1500);
        }
        if (root) renderGrid(root);
      }, 800);
    }

    [titleInp, catInp, tagsInp, summaryInp].forEach(function (el) {
      if (el) el.addEventListener("input", scheduleAutosave);
    });
    var rtEditor = modal.querySelector(".rtfield__editor");
    if (rtEditor) rtEditor.addEventListener("input", scheduleAutosave);

    /* Lukk */
    function closeModal() {
      clearTimeout(saveTimer);
      bd.remove();
      if (currentId) Intranet.navigate("notes", currentId);
      else           Intranet.navigate("notes");
      if (root) { renderGrid(root); }
    }

    modal.querySelector("#nm-close").addEventListener("click", closeModal);
    bd.addEventListener("click", function (e) { if (e.target === bd) closeModal(); });
    document.addEventListener("keydown", function escH(e) {
      if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", escH); }
    });

    /* Slett */
    var delBtn = modal.querySelector("#nm-delete");
    if (delBtn) {
      delBtn.addEventListener("click", function () {
        if (!confirm('Slett "' + (note ? note.title : "notat") + '"?')) return;
        clearTimeout(saveTimer);
        if (currentId) deleteNote(currentId);
        bd.remove();
        Intranet.navigate("notes");
        if (root) renderPage(root);
      });
    }
  }

  /* Eksporter for Dashboard-snarveg */
  window._notesOpenModal = function (root) {
    openNoteModal(null, root || document.getElementById("intranet-main"));
  };

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  Intranet.registerModule({
    id:       "notes",
    navLabel: "Notater",
    icon:     "notes",
    order:    25,
    render:   render,
    mount:    mount
  });

})();
