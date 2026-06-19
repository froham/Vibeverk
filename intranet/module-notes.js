/* =============================================================================
   module-notes.js  —  NOTATER (intranett)
   -----------------------------------------------------------------------------
   Intern notatflate. Enkel, rask og AI-klar datastruktur.

   Funksjonar:
   - Opprett / rediger / slett notatar
   - Autosave medan ein skriv (debounce 800ms)
   - Kategoriar og tags for organisering
   - Fritekstsøk på tvers av tittel, innhald og tags
   - Datastruktur klar for AI-kontekst (summary + tags-array)

   Lagring:  App.store("wsp-notes")
   Ruter:    #/notes, #/notes/<id>
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  if (!Intranet || !App || !C) return;

  var STORE_KEY = "wsp-notes";

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getNotes()    { return App.store.get(STORE_KEY, []) || []; }
  function setNotes(v)   { App.store.set(STORE_KEY, v); }

  function newId() {
    return "wsp-n-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }

  function createNote(data) {
    var now  = Date.now();
    var note = {
      id:        newId(),
      title:     data.title     || "Uten tittel",
      body:      data.body      || "",
      category:  data.category  || "",
      tags:      data.tags      || [],
      summary:   data.summary   || "",   // AI-kontekst: kort oppsummering
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
    var q    = (query || "").toLowerCase().trim();
    var notes = getNotes();
    if (category) notes = notes.filter(function (n) { return n.category === category; });
    if (!q) return notes;
    return notes.filter(function (n) {
      return (n.title  || "").toLowerCase().indexOf(q) > -1 ||
             (n.body   || "").toLowerCase().indexOf(q) > -1 ||
             (n.tags   || []).some(function (t) { return t.toLowerCase().indexOf(q) > -1; }) ||
             (n.category || "").toLowerCase().indexOf(q) > -1;
    });
  }

  /* =========================================================================
     HJELPERAR
     ====================================================================== */
  function formatDate(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    var now = new Date();
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
    return '<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.4rem">' +
      tags.map(function (t) {
        return '<span style="font-size:.72rem;font-weight:600;padding:.15rem .5rem;border-radius:999px;' +
          'background:color-mix(in srgb,var(--color-primary) 12%,transparent);color:var(--color-primary)">' +
          C.esc(t) + '</span>';
      }).join("") +
    '</div>';
  }

  function debounce(fn, ms) {
    var timer;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  /* =========================================================================
     RENDER — TOKOLONNE-LAYOUT (liste + editor side om side)
     ====================================================================== */
  function render() { return '<div id="notes-root"></div>'; }

  function mount(outlet, ctx, sub) {
    var root = outlet.querySelector("#notes-root") || outlet;
    renderShell(root, sub);
  }

  function renderShell(root, activeId) {
    var cats = getCategories();

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Notater</h2>' +
        '<button class="btn btn--primary btn--sm" id="notes-new-btn"><i class="ti ti-plus"></i> Nytt notat</button>' +
      '</div>' +

      /* Søk + kategorifilter */
      '<div style="display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:160px;position:relative">' +
          '<i class="ti ti-search" style="position:absolute;left:.7rem;top:50%;transform:translateY(-50%);color:var(--color-muted);font-size:.95rem"></i>' +
          '<input id="notes-search" type="search" placeholder="Søk i notater…" ' +
            'style="width:100%;padding:.55rem .8rem .55rem 2.1rem;border:1.5px solid var(--color-border);border-radius:8px;font:inherit;font-size:.88rem;background:var(--color-bg);color:var(--color-text)">' +
        '</div>' +
        (cats.length
          ? '<select id="notes-cat-filter" style="padding:.55rem .8rem;border:1.5px solid var(--color-border);border-radius:8px;font:inherit;font-size:.88rem;background:var(--color-bg);color:var(--color-text)">' +
              '<option value="">Alle kategorier</option>' +
              cats.map(function (c) { return '<option value="' + C.esc(c) + '">' + C.esc(c) + '</option>'; }).join("") +
            '</select>'
          : '') +
      '</div>' +

      /* Tokolonne */
      '<div style="display:grid;grid-template-columns:280px 1fr;gap:1rem;min-height:400px" id="notes-cols">' +
        '<div id="notes-list-col" style="overflow-y:auto;max-height:calc(100vh - 220px)">' +
          renderNotesList(null, null, activeId) +
        '</div>' +
        '<div id="notes-editor-col">' +
          (activeId ? renderEditor(activeId) : renderEditorEmpty()) +
        '</div>' +
      '</div>';

    bindShell(root, activeId);
  }

  function renderNotesList(query, category, activeId) {
    var notes = searchNotes(query, category);
    if (!notes.length) {
      return '<p style="color:var(--color-muted);font-size:.88rem;padding:.5rem 0">' +
        (query || category ? 'Ingen treff.' : 'Ingen notater ennå. Klikk «Nytt notat».') +
        '</p>';
    }
    return '<ul style="list-style:none;padding:0;margin:0;display:grid;gap:.4rem">' +
      notes.map(function (n) {
        var active = n.id === activeId;
        return '<li>' +
          '<button data-note-open="' + C.esc(n.id) + '" style="width:100%;text-align:left;background:' +
            (active ? 'var(--color-tint)' : 'var(--color-surface)') +
            ';border:1.5px solid ' + (active ? 'var(--color-primary)' : 'var(--color-border)') +
            ';border-radius:10px;padding:.65rem .8rem;cursor:pointer;transition:border-color .15s">' +
            '<div style="font-weight:600;font-size:.9rem;color:var(--color-text);margin-bottom:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + C.esc(n.title || "Uten tittel") + '</div>' +
            (n.category ? '<div style="font-size:.72rem;color:var(--color-primary);font-weight:600;margin-bottom:.1rem">' + C.esc(n.category) + '</div>' : '') +
            '<div style="font-size:.75rem;color:var(--color-muted)">' + formatDate(n.updatedAt) + '</div>' +
            tagsHtml(n.tags) +
          '</button>' +
        '</li>';
      }).join("") +
    '</ul>';
  }

  function renderEditorEmpty() {
    return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;color:var(--color-muted);gap:.5rem">' +
      '<i class="ti ti-notes" style="font-size:2.5rem;opacity:.3"></i>' +
      '<span style="font-size:.9rem">Velg et notat eller opprett nytt</span>' +
    '</div>';
  }

  function renderEditor(id) {
    var note = getNotes().find(function (n) { return n.id === id; });
    if (!note) return renderEditorEmpty();

    return '<div id="notes-editor" data-note-id="' + C.esc(id) + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.8rem;gap:.5rem">' +
        '<span id="notes-autosave-status" style="font-size:.75rem;color:var(--color-muted)"></span>' +
        '<button class="btn btn--ghost btn--sm" style="color:#c0392b;border-color:#c0392b" id="notes-delete-btn">Slett</button>' +
      '</div>' +
      '<input id="notes-title" type="text" value="' + C.esc(note.title) + '" placeholder="Tittel…" ' +
        'style="width:100%;font:inherit;font-family:var(--font-display);font-size:1.3rem;font-weight:700;' +
        'border:0;border-bottom:2px solid var(--color-border);padding:.4rem 0;margin-bottom:.8rem;' +
        'background:transparent;color:var(--color-text);outline:none">' +
      '<div style="display:flex;gap:.5rem;margin-bottom:.8rem;flex-wrap:wrap">' +
        '<input id="notes-category" type="text" value="' + C.esc(note.category || "") + '" placeholder="Kategori…" ' +
          'list="notes-cat-suggestions" ' +
          'style="flex:1;min-width:120px;font:inherit;font-size:.82rem;padding:.35rem .6rem;border:1.5px solid var(--color-border);border-radius:6px;background:var(--color-bg);color:var(--color-text)">' +
        '<datalist id="notes-cat-suggestions">' +
          getCategories().map(function(c) { return '<option value="' + C.esc(c) + '">'; }).join("") +
        '</datalist>' +
        '<input id="notes-tags" type="text" value="' + C.esc((note.tags || []).join(", ")) + '" placeholder="Tags (kommaseparert)…" ' +
          'style="flex:2;min-width:160px;font:inherit;font-size:.82rem;padding:.35rem .6rem;border:1.5px solid var(--color-border);border-radius:6px;background:var(--color-bg);color:var(--color-text)">' +
      '</div>' +
      '<textarea id="notes-body" placeholder="Skriv notat her…" ' +
        'style="width:100%;min-height:320px;font:inherit;font-size:.92rem;line-height:1.7;' +
        'border:1.5px solid var(--color-border);border-radius:8px;padding:.8rem;resize:vertical;' +
        'background:var(--color-bg);color:var(--color-text)">' +
        C.esc(note.body || "") +
      '</textarea>' +
      '<div style="display:flex;gap:.5rem;margin-top:.6rem;flex-wrap:wrap">' +
        '<input id="notes-summary" type="text" value="' + C.esc(note.summary || "") + '" ' +
          'placeholder="Kort AI-sammendrag (valgfritt)…" ' +
          'style="flex:1;font:inherit;font-size:.78rem;padding:.35rem .6rem;border:1.5px solid var(--color-border);border-radius:6px;background:var(--color-bg);color:var(--color-muted)">' +
      '</div>' +
      '<p style="font-size:.72rem;color:var(--color-muted);margin:.3rem 0 0">Sist endret: ' + formatDate(note.updatedAt) + '</p>' +
    '</div>';
  }

  /* =========================================================================
     BINDING
     ====================================================================== */
  function bindShell(root, activeId) {
    var currentId = activeId || null;

    function refreshList() {
      var q    = root.querySelector("#notes-search");
      var cat  = root.querySelector("#notes-cat-filter");
      var col  = root.querySelector("#notes-list-col");
      if (col) col.innerHTML = renderNotesList(
        q ? q.value : null,
        cat ? cat.value : null,
        currentId
      );
      bindListItems(root);
    }

    function openNote(id) {
      currentId = id;
      var edCol = root.querySelector("#notes-editor-col");
      if (edCol) {
        edCol.innerHTML = renderEditor(id);
        bindEditor(root, id, refreshList);
      }
      Intranet.navigate("notes", id);
      refreshList();
    }

    /* Nytt notat */
    root.querySelector("#notes-new-btn").addEventListener("click", function () {
      var note = createNote({ title: "Nytt notat" });
      renderShell(root, note.id);
      bindShell(root, note.id);
    });

    /* Søk */
    var searchInp = root.querySelector("#notes-search");
    if (searchInp) {
      searchInp.addEventListener("input", refreshList);
    }

    /* Kategorifilter */
    var catFilter = root.querySelector("#notes-cat-filter");
    if (catFilter) {
      catFilter.addEventListener("change", refreshList);
    }

    bindListItems(root);

    function bindListItems(root) {
      root.querySelectorAll("[data-note-open]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          openNote(btn.getAttribute("data-note-open"));
        });
      });
    }

    /* Bind editor hvis activeId */
    if (activeId) bindEditor(root, activeId, refreshList);
  }

  function bindEditor(root, id, refreshList) {
    var titleInp  = root.querySelector("#notes-title");
    var bodyInp   = root.querySelector("#notes-body");
    var catInp    = root.querySelector("#notes-category");
    var tagsInp   = root.querySelector("#notes-tags");
    var summaryInp= root.querySelector("#notes-summary");
    var statusEl  = root.querySelector("#notes-autosave-status");
    var deleteBtn = root.querySelector("#notes-delete-btn");

    if (!titleInp || !bodyInp) return;

    var saveTimer;
    function scheduleAutosave() {
      clearTimeout(saveTimer);
      if (statusEl) { statusEl.textContent = "Lagrer…"; }
      saveTimer = setTimeout(function () {
        updateNote(id, {
          title:    titleInp.value.trim() || "Uten tittel",
          body:     bodyInp.value,
          category: catInp    ? catInp.value.trim()          : "",
          tags:     tagsInp   ? parseTags(tagsInp.value)     : [],
          summary:  summaryInp ? summaryInp.value.trim()     : ""
        });
        if (statusEl) {
          statusEl.textContent = "Lagret";
          setTimeout(function () { if (statusEl) statusEl.textContent = ""; }, 1500);
        }
        if (refreshList) refreshList();
      }, 800);
    }

    [titleInp, bodyInp, catInp, tagsInp, summaryInp].forEach(function (el) {
      if (el) el.addEventListener("input", scheduleAutosave);
    });

    /* Fokus i body */
    bodyInp.focus();

    /* Slett */
    if (deleteBtn) {
      deleteBtn.addEventListener("click", function () {
        var note = getNotes().find(function (n) { return n.id === id; });
        if (!confirm('Slett "' + (note ? note.title : "notat") + '"?')) return;
        clearTimeout(saveTimer);
        deleteNote(id);
        Intranet.navigate("notes");
        var edCol = root.querySelector("#notes-editor-col");
        if (edCol) edCol.innerHTML = renderEditorEmpty();
        if (refreshList) refreshList();
      });
    }
  }

  /* =========================================================================
     RESPONSIV: kollapser til enkeltkolonne på smal skjerm
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("notes-styles")) return;
    var s = document.createElement("style");
    s.id = "notes-styles";
    s.textContent = [
      "@media (max-width:700px) {",
      "  #notes-cols { grid-template-columns:1fr !important; }",
      "  #notes-list-col { max-height:220px !important; border-bottom:1px solid var(--color-border); padding-bottom:.8rem; }",
      "}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  injectStyles();

  Intranet.registerModule({
    id:       "notes",
    navLabel: "Notater",
    icon:     "notes",
    order:    25,
    render:   render,
    mount:    mount
  });

})();
