/* =============================================================================
   module-notes.js  —  NOTATER (intranett)  v4
   -----------------------------------------------------------------------------
   - Lagring: Supabase notes-tabell (per brukar, RLS: user_id = auth.uid())
   - Fallback til App.store (localStorage) utan Supabase
   - Eingongs-migrering: lokale notatar lastast opp til Supabase ved fyrste login
   - Kort-/listevisning med toggle
   - Popup-modal: X / Lagre og lukk / Escape
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.notes === false) return;

  var _sb       = App.supabase;
  var STORE_KEY = "wsp-notes";
  var VIEW_KEY  = "wsp-notes-view";
  var _notes    = [];   // in-memory cache, populert av loadNotes()

  var NOTE_COLORS = [
    { id: "none",   label: "Ingen",    bg: "var(--color-surface)",  border: "var(--color-border)" },
    { id: "yellow", label: "Gul",      bg: "#fffbe6",               border: "#f5d000" },
    { id: "green",  label: "Grøn",     bg: "#f0faf0",               border: "#7ec87e" },
    { id: "blue",   label: "Blå",      bg: "#eef4ff",               border: "#7baef5" },
    { id: "pink",   label: "Rosa",     bg: "#fff0f5",               border: "#f59bba" },
    { id: "orange", label: "Oransje",  bg: "#fff5ec",               border: "#f5a862" },
    { id: "purple", label: "Lilla",    bg: "#f5f0ff",               border: "#b08af5" },
    { id: "teal",   label: "Turkis",   bg: "#edfafa",               border: "#5bc4c4" }
  ];

  function colorById(id) {
    return NOTE_COLORS.find(function (c) { return c.id === id; }) || NOTE_COLORS[0];
  }

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function uid() { return Intranet.getContext().userId; }

  function loadNotes(cb) {
    if (!_sb || !uid()) {
      _notes = App.store.get(STORE_KEY, []) || [];
      cb && cb();
      return;
    }
    _sb.from("notes")
      .select("*")
      .eq("user_id", uid())
      .order("updated_at", { ascending: false })
      .then(function (r) {
        if (r.error) { cb && cb(); return; }
        _notes = r.data || [];
        // Eingongs-migrering: lokale notatar → Supabase
        if (_notes.length === 0) {
          var local = App.store.get(STORE_KEY, []) || [];
          if (local.length > 0) { migrateLocal(local, cb); return; }
        }
        cb && cb();
      });
  }

  function migrateLocal(local, cb) {
    var rows = local.map(function (n) {
      return {
        user_id:  uid(),
        title:    n.title    || "Uten tittel",
        content:  n.body     || n.content || "",
        category: n.category || "",
        tags:     n.tags     || [],
        color:    n.color    || "none",
        summary:  n.summary  || ""
      };
    });
    _sb.from("notes").insert(rows).select().then(function (r) {
      if (!r.error) {
        _notes = r.data || [];
        App.store.remove(STORE_KEY);
      }
      cb && cb();
    });
  }

  function createNote(data, cb) {
    var row = {
      user_id:  uid(),
      title:    data.title    || "Uten tittel",
      content:  data.body     || "",
      category: data.category || "",
      tags:     data.tags     || [],
      color:    data.color    || "none",
      summary:  data.summary  || ""
    };
    if (!_sb || !uid()) {
      var ls = Object.assign({}, row, { id: "wsp-n-" + Date.now(), updated_at: new Date().toISOString(), created_at: new Date().toISOString() });
      _notes.unshift(ls);
      App.store.set(STORE_KEY, _notes);
      Intranet.logActivity({ type: "note_created", label: "Nytt notat: " + row.title });
      cb && cb(ls);
      return;
    }
    _sb.from("notes").insert(row).select().single().then(function (r) {
      if (!r.error && r.data) {
        _notes.unshift(r.data);
        Intranet.logActivity({ type: "note_created", label: "Nytt notat: " + r.data.title });
      }
      cb && cb(r.data);
    });
  }

  function updateNote(id, data, cb) {
    var changes = {
      title:    data.title    || "Uten tittel",
      content:  data.body     || "",
      category: data.category || "",
      tags:     data.tags     || [],
      color:    data.color    || "none",
      summary:  data.summary  || ""
    };
    var idx = _notes.findIndex(function (n) { return n.id === id; });
    if (idx >= 0) Object.assign(_notes[idx], changes, { updated_at: new Date().toISOString() });
    if (!_sb || !uid()) {
      App.store.set(STORE_KEY, _notes);
      cb && cb();
      return;
    }
    _sb.from("notes").update(changes).eq("id", id).eq("user_id", uid()).then(function () {
      cb && cb();
    });
  }

  function deleteNote(id, cb) {
    var note = _notes.find(function (n) { return n.id === id; });
    _notes = _notes.filter(function (n) { return n.id !== id; });
    if (note) Intranet.logActivity({ type: "note_deleted", label: "Notat slettet: " + note.title });
    if (!_sb || !uid()) {
      App.store.set(STORE_KEY, _notes);
      cb && cb();
      return;
    }
    _sb.from("notes").delete().eq("id", id).eq("user_id", uid()).then(function () {
      cb && cb();
    });
  }

  function getCategories() {
    var cats = {};
    _notes.forEach(function (n) { if (n.category) cats[n.category] = 1; });
    return Object.keys(cats).sort();
  }

  /* =========================================================================
     SØK
     ====================================================================== */
  function searchNotes(query, category) {
    var q = (query || "").toLowerCase().trim();
    var notes = _notes;
    if (category) notes = notes.filter(function (n) { return n.category === category; });
    if (!q) return notes;
    return notes.filter(function (n) {
      return (n.title    || "").toLowerCase().indexOf(q) > -1 ||
             (n.content  || "").toLowerCase().indexOf(q) > -1 ||
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

  function bodyPreview(content) {
    return C.stripHtml(content || "").slice(0, 100);
  }

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("notes-styles")) return;
    var s = document.createElement("style");
    s.id  = "notes-styles";
    s.textContent = [
      ".notes-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.75rem}",
      ".notes-card{border-radius:var(--radius);padding:1rem;cursor:pointer;transition:border-color .15s,box-shadow .15s;",
        "text-align:left;width:100%;font:inherit;border-width:1.5px;border-style:solid;",
        "height:180px;display:flex;flex-direction:column;position:relative;overflow:hidden}",
      ".notes-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.1)}",
      ".notes-card__cat{font-size:.7rem;font-weight:700;color:var(--color-primary);margin-bottom:.2rem;",
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".notes-card__title{font-weight:700;font-size:.9rem;margin-bottom:.3rem;",
        "overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:var(--color-text)}",
      ".notes-card__preview{font-size:.78rem;color:var(--color-muted);line-height:1.45;flex:1;",
        "overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}",
      ".notes-card__foot{display:flex;align-items:center;justify-content:space-between;margin-top:.4rem}",
      ".notes-card__date{font-size:.7rem;color:var(--color-muted)}",
      ".notes-card__del{position:absolute;bottom:.5rem;right:.5rem;background:none;border:0;",
        "cursor:pointer;color:var(--color-muted);font-size:.95rem;padding:.2rem;border-radius:6px;",
        "opacity:0;transition:opacity .15s,color .15s;line-height:1}",
      ".notes-card:hover .notes-card__del{opacity:1}",
      ".notes-card__del:hover{color:#c0392b}",
      ".notes-list-row{background:var(--color-surface);border:1px solid var(--color-border);",
        "border-radius:10px;padding:.6rem 1rem;cursor:pointer;transition:border-color .15s;",
        "display:flex;align-items:center;gap:.75rem;width:100%;text-align:left;font:inherit;position:relative}",
      ".notes-list-row:hover{border-color:var(--color-primary)}",
      ".notes-list-row__accent{width:4px;border-radius:4px;align-self:stretch;flex-shrink:0}",
      ".notes-list-row__main{flex:1;min-width:0}",
      ".notes-list-row__title{font-weight:600;font-size:.9rem;color:var(--color-text);",
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".notes-list-row__meta{font-size:.75rem;color:var(--color-muted);margin-top:.1rem}",
      ".notes-list-row__del{background:none;border:0;cursor:pointer;color:var(--color-muted);",
        "font-size:.95rem;padding:.2rem;opacity:0;transition:opacity .15s,color .15s;line-height:1;flex-shrink:0}",
      ".notes-list-row:hover .notes-list-row__del{opacity:1}",
      ".notes-list-row__del:hover{color:#c0392b}",
      ".notes-view-btn{background:none;border:1.5px solid var(--color-border);border-radius:8px;",
        "padding:.35rem .6rem;cursor:pointer;color:var(--color-muted);font-size:.85rem;",
        "transition:background .12s,border-color .12s}",
      ".notes-view-btn.is-active{background:var(--color-primary);border-color:var(--color-primary);color:#fff}",
      ".note-color-picker{display:flex;gap:.4rem;flex-wrap:wrap}",
      ".note-color-swatch{width:24px;height:24px;border-radius:50%;border:2px solid transparent;",
        "cursor:pointer;transition:transform .12s,border-color .12s;flex-shrink:0}",
      ".note-color-swatch.is-active{border-color:var(--color-text);transform:scale(1.2)}",
      "[data-theme='dark'] .notes-card__title{color:var(--color-text)}",
      "[data-theme='dark'] .notes-card__preview{color:var(--color-muted)}"
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
    root.innerHTML = '<p style="color:var(--color-muted);font-size:.9rem;padding:1rem">Lastar notatar…</p>';
    loadNotes(function () {
      renderPage(root);
      if (sub) openNoteModal(sub, root);
    });
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
    var notes    = searchNotes(searchEl ? searchEl.value : null, catEl ? catEl.value : null);
    var grid     = root.querySelector("#notes-grid");
    if (!grid) return;

    if (!notes.length) {
      grid.innerHTML = '<p style="color:var(--color-muted);font-size:.9rem">' +
        ((searchEl && searchEl.value) || (catEl && catEl.value) ? "Ingen treff." : "Ingen notatar ennå. Klikk «Nytt notat».") + '</p>';
      return;
    }

    if (view === "list") {
      grid.innerHTML = '<div style="display:grid;gap:.4rem">' +
        notes.map(function (n) {
          var col = colorById(n.color);
          return '<div style="display:flex;align-items:stretch;gap:0;position:relative">' +
            '<button class="notes-list-row" data-note-open="' + C.esc(n.id) + '">' +
              '<div class="notes-list-row__accent" style="background:' + col.border + '"></div>' +
              '<div class="notes-list-row__main">' +
                '<div class="notes-list-row__title">' + C.esc(n.title || "Uten tittel") + '</div>' +
                '<div class="notes-list-row__meta">' +
                  (n.category ? '<span style="color:var(--color-primary)">' + C.esc(n.category) + '</span> · ' : '') +
                  formatDate(n.updated_at) +
                  (n.tags && n.tags.length ? ' · ' + tagsHtml(n.tags) : '') +
                '</div>' +
              '</div>' +
              '<button class="notes-list-row__del" data-note-del="' + C.esc(n.id) + '" title="Slett notat" onclick="event.stopPropagation()">' +
                '<i class="ti ti-trash"></i>' +
              '</button>' +
            '</button>' +
          '</div>';
        }).join("") +
      '</div>';
    } else {
      grid.innerHTML = '<div class="notes-card-grid">' +
        notes.map(function (n) {
          var col     = colorById(n.color);
          var preview = bodyPreview(n.content);
          return '<div class="notes-card" data-note-open="' + C.esc(n.id) + '" role="button" tabindex="0" ' +
            'style="background:' + col.bg + ';border-color:' + col.border + ';cursor:pointer">' +
            (n.category ? '<div class="notes-card__cat">' + C.esc(n.category) + '</div>' : '') +
            '<div class="notes-card__title">' + C.esc(n.title || "Uten tittel") + '</div>' +
            (preview ? '<div class="notes-card__preview">' + C.esc(preview) + '</div>' : '') +
            '<div class="notes-card__foot">' +
              '<span class="notes-card__date">' + formatDate(n.updated_at) + '</span>' +
              '<span>' + tagsHtml(n.tags) + '</span>' +
            '</div>' +
            '<button class="notes-card__del" data-note-del="' + C.esc(n.id) + '" title="Slett notat">' +
              '<i class="ti ti-trash"></i>' +
            '</button>' +
          '</div>';
        }).join("") +
      '</div>';
    }

    bindGrid(root, grid);
  }

  function bindGrid(root, grid) {
    grid.querySelectorAll("[data-note-open]").forEach(function (card) {
      card.addEventListener("click", function (e) {
        if (e.target.closest("[data-note-del]")) return;
        openNoteModal(card.getAttribute("data-note-open"), root);
      });
      if (card.tagName !== "BUTTON") {
        card.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); card.click(); }
        });
      }
    });
    grid.querySelectorAll("[data-note-del]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var id   = btn.getAttribute("data-note-del");
        var note = _notes.find(function (n) { return n.id === id; });
        if (!confirm('Slett "' + (note ? note.title : "notat") + '"?')) return;
        deleteNote(id, function () { renderPage(root); });
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
     POPUP-MODAL
     ====================================================================== */
  var _activeEscHandler = null;

  function openNoteModal(id, root) {
    var note  = id ? _notes.find(function (n) { return n.id === id; }) : null;
    var isNew = !note;

    if (_activeEscHandler) {
      document.removeEventListener("keydown", _activeEscHandler);
      _activeEscHandler = null;
    }

    var existing = document.getElementById("note-modal-bd");
    if (existing) existing.remove();

    var bd = document.createElement("div");
    bd.id  = "note-modal-bd";
    bd.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto";

    var modal = document.createElement("div");
    modal.style.cssText = "background:var(--color-bg);border-radius:var(--radius);width:min(680px,100%);max-height:90vh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.3);display:flex;flex-direction:column";

    var cats        = getCategories();
    var activeColor = note ? (note.color || "none") : "none";

    var colorSwatches = NOTE_COLORS.map(function (col) {
      return '<button class="note-color-swatch' + (activeColor === col.id ? " is-active" : "") + '" ' +
        'data-color-id="' + col.id + '" title="' + col.label + '" ' +
        'style="background:' + col.bg + ';border-color:' + col.border + '" ' +
        'onclick="event.preventDefault()"></button>';
    }).join("");

    modal.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.2rem;border-bottom:1px solid var(--color-border);position:sticky;top:0;background:var(--color-bg);z-index:1">' +
        '<div style="display:flex;align-items:center;gap:.7rem;flex:1;min-width:0">' +
          '<input id="nm-title" type="text" value="' + C.esc(note ? note.title || "" : "") + '" ' +
            'placeholder="Tittelaus…" ' +
            'style="flex:1;font:inherit;font-family:var(--font-display);font-size:1.05rem;font-weight:700;border:0;background:transparent;color:var(--color-text);outline:none;min-width:0">' +
        '</div>' +
        '<button id="nm-close" style="background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);line-height:1;margin-left:.5rem" title="Lukk">&times;</button>' +
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

        '<div>' +
          '<p style="font-size:.78rem;font-weight:600;color:var(--color-muted);margin:0 0 .4rem">Farge</p>' +
          '<div class="note-color-picker">' + colorSwatches + '</div>' +
        '</div>' +

        C.richTextField({ id: "nm-body", label: "", value: note ? note.content || "" : "" }) +

        '<input id="nm-summary" type="text" value="' + C.esc(note ? note.summary || "" : "") + '" ' +
          'placeholder="Kort AI-sammendrag (valgfritt)…" ' +
          'style="font:inherit;font-size:.78rem;padding:.35rem .7rem;border:1.5px solid var(--color-border);border-radius:8px;background:var(--color-surface);color:var(--color-muted)">' +

        '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:.3rem;border-top:1px solid var(--color-border)">' +
          (!isNew
            ? '<button id="nm-delete" style="background:none;border:0;cursor:pointer;font-size:.82rem;color:#c0392b;font:inherit;padding:0">Slett notat</button>'
            : '<span></span>') +
          '<button id="nm-save-close" class="btn btn--primary btn--sm">Lagre og lukk</button>' +
        '</div>' +
      '</div>';

    bd.appendChild(modal);
    document.body.appendChild(bd);
    App.ui.bindRichTextFields(modal);

    var selectedColor = activeColor;
    modal.querySelectorAll("[data-color-id]").forEach(function (sw) {
      sw.addEventListener("click", function (e) {
        e.preventDefault();
        selectedColor = sw.getAttribute("data-color-id");
        modal.querySelectorAll("[data-color-id]").forEach(function (s) { s.classList.remove("is-active"); });
        sw.classList.add("is-active");
      });
    });

    var titleInp   = modal.querySelector("#nm-title");
    var catInp     = modal.querySelector("#nm-category");
    var tagsInp    = modal.querySelector("#nm-tags");
    var summaryInp = modal.querySelector("#nm-summary");

    if (isNew) { titleInp.focus(); }
    else {
      var rtEd = modal.querySelector(".rtfield__editor");
      if (rtEd) rtEd.focus();
    }

    var currentId = note ? note.id : null;

    function readData() {
      return {
        title:    titleInp.value.trim() || "Uten tittel",
        body:     App.ui.readRichTextField(modal, "nm-body"),
        category: catInp     ? catInp.value.trim()      : "",
        tags:     tagsInp    ? parseTags(tagsInp.value) : [],
        summary:  summaryInp ? summaryInp.value.trim()  : "",
        color:    selectedColor
      };
    }

    function closeModal(save, cb) {
      if (_activeEscHandler) {
        document.removeEventListener("keydown", _activeEscHandler);
        _activeEscHandler = null;
      }
      if (!save) { bd.remove(); Intranet.navigate("notes"); if (root) renderGrid(root); cb && cb(); return; }
      var data = readData();
      if (!currentId) {
        createNote(data, function (created) {
          if (created) currentId = created.id;
          bd.remove();
          Intranet.navigate("notes");
          if (root) renderGrid(root);
          cb && cb();
        });
      } else {
        updateNote(currentId, data, function () {
          bd.remove();
          Intranet.navigate("notes");
          if (root) renderGrid(root);
          cb && cb();
        });
      }
    }

    modal.querySelector("#nm-save-close").addEventListener("click", function () { closeModal(true); });
    modal.querySelector("#nm-close").addEventListener("click", function () { closeModal(false); });

    _activeEscHandler = function (e) { if (e.key === "Escape") { closeModal(false); } };
    document.addEventListener("keydown", _activeEscHandler);

    var delBtn = modal.querySelector("#nm-delete");
    if (delBtn) {
      delBtn.addEventListener("click", function () {
        if (!confirm('Slett "' + (note ? note.title : "notat") + '"?')) return;
        if (currentId) {
          deleteNote(currentId, function () {
            if (_activeEscHandler) {
              document.removeEventListener("keydown", _activeEscHandler);
              _activeEscHandler = null;
            }
            bd.remove();
            Intranet.navigate("notes");
            if (root) renderPage(root);
          });
        }
      });
    }
  }

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
