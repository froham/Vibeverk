/* =============================================================================
   module-kb.js  —  KUNNSKAPSBASE (intranett)  v2
   -----------------------------------------------------------------------------
   Lagring: Supabase kb_articles-tabell. Fallback til App.store.
   Feltmapping: body → content, official → published, updatedAt → updated_at.
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.kb === false) return;

  var _sb       = App.supabase;
  var STORE_KEY = "wsp-kb";
  var _articles = [];

  /* =========================================================================
     TILGANG
     ====================================================================== */
  function uid() { return Intranet.getContext().userId; }

  function isAdmin(ctx) {
    var role = (ctx && ctx.role) || Intranet.getContext().role;
    return role === "owner" || role === "admin";
  }

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function loadArticles(cb) {
    if (!_sb) {
      _articles = App.store.get(STORE_KEY, []) || [];
      cb && cb();
      return;
    }
    _sb.from("kb_articles").select("*").order("updated_at", { ascending: false }).then(function (r) {
      if (r.error) { cb && cb(); return; }
      _articles = r.data || [];
      if (_articles.length === 0) {
        var local = App.store.get(STORE_KEY, []) || [];
        if (local.length > 0) { migrateLocal(local, cb); return; }
      }
      cb && cb();
    });
  }

  function migrateLocal(local, cb) {
    if (!uid()) { cb && cb(); return; }
    var rows = local.map(function (a) {
      return {
        title:     a.title    || "Artikkel",
        content:   a.body     || a.content || "",
        category:  a.category || "Generelt",
        tags:      a.tags     || [],
        summary:   a.summary  || "",
        published: !!a.official || !!a.published,
        author_id: uid()
      };
    });
    _sb.from("kb_articles").insert(rows).select().then(function (r) {
      if (!r.error) { _articles = r.data || []; App.store.remove(STORE_KEY); }
      cb && cb();
    });
  }

  function saveArticle(item, data, cb) {
    var row = {
      title:     data.title    || "Ny artikkel",
      content:   data.body     || "",
      category:  data.category || "Generelt",
      tags:      data.tags     || [],
      summary:   data.summary  || "",
      published: !!data.official
    };
    if (!_sb) {
      if (item && item.id) {
        var idx = _articles.findIndex(function (a) { return a.id === item.id; });
        if (idx >= 0) _articles[idx] = Object.assign({}, _articles[idx], row, { updated_at: new Date().toISOString() });
        Intranet.logActivity({ type: "kb_updated", label: "KB oppdatert: " + row.title });
      } else {
        _articles.unshift(Object.assign({ id: "wsp-kb-" + Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, row));
        Intranet.logActivity({ type: "kb_created", label: "Ny KB-artikkel: " + row.title });
      }
      App.store.set(STORE_KEY, _articles);
      cb && cb(item && item.id ? item.id : _articles[0].id);
      return;
    }
    if (item && item.id) {
      _sb.from("kb_articles").update(row).eq("id", item.id).select().single().then(function (r) {
        if (!r.error && r.data) {
          var idx = _articles.findIndex(function (a) { return a.id === item.id; });
          if (idx >= 0) _articles[idx] = r.data;
        }
        Intranet.logActivity({ type: "kb_updated", label: "KB oppdatert: " + row.title });
        cb && cb(item.id);
      });
    } else {
      var insert = Object.assign({ author_id: uid() }, row);
      _sb.from("kb_articles").insert(insert).select().single().then(function (r) {
        if (!r.error && r.data) _articles.unshift(r.data);
        Intranet.logActivity({ type: "kb_created", label: "Ny KB-artikkel: " + row.title });
        cb && cb(r.data ? r.data.id : null);
      });
    }
  }

  function deleteArticle(id, cb) {
    var art = _articles.find(function (a) { return a.id === id; });
    _articles = _articles.filter(function (a) { return a.id !== id; });
    Intranet.logActivity({ type: "kb_deleted", label: "KB-artikkel slettet: " + (art ? art.title : "") });
    if (!_sb) { App.store.set(STORE_KEY, _articles); cb && cb(); return; }
    _sb.from("kb_articles").delete().eq("id", id).then(function () { cb && cb(); });
  }

  function getCategories() {
    var cats = {};
    _articles.forEach(function (a) { var c = a.category || "Generelt"; cats[c] = (cats[c] || 0) + 1; });
    return Object.keys(cats).sort();
  }

  function searchArticles(query, category, officialOnly) {
    var q    = (query || "").toLowerCase().trim();
    var list = _articles;
    if (category)    list = list.filter(function (a) { return (a.category || "Generelt") === category; });
    if (officialOnly) list = list.filter(function (a) { return a.published; });
    if (!q) return list;
    return list.filter(function (a) {
      return (a.title    || "").toLowerCase().indexOf(q) > -1 ||
             (a.content  || "").toLowerCase().indexOf(q) > -1 ||
             (a.category || "").toLowerCase().indexOf(q) > -1 ||
             (a.tags     || []).some(function (t) { return t.toLowerCase().indexOf(q) > -1; }) ||
             (a.summary  || "").toLowerCase().indexOf(q) > -1;
    });
  }

  /* =========================================================================
     HJELPERAR
     ====================================================================== */
  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
  }

  function parseTags(str) {
    return (str || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
  }

  function tagsHtml(tags) {
    if (!tags || !tags.length) return "";
    return tags.map(function (t) {
      return '<span style="font-size:.7rem;font-weight:600;padding:.12rem .45rem;border-radius:999px;' +
        'background:color-mix(in srgb,var(--color-primary) 10%,transparent);color:var(--color-primary)">' +
        C.esc(t) + '</span>';
    }).join(" ");
  }

  function officialBadge() {
    return '<span style="display:inline-flex;align-items:center;gap:.25rem;font-size:.7rem;font-weight:700;' +
      'padding:.12rem .5rem;border-radius:999px;background:color-mix(in srgb,#2a7a2a 12%,transparent);color:#2a7a2a">' +
      '<i class="ti ti-circle-check"></i> Offisiell</span>';
  }

  function debounce(fn, ms) {
    var t;
    return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); };
  }

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("kb-styles")) return;
    var s = document.createElement("style");
    s.id  = "kb-styles";
    s.textContent = [
      ".kb-cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.7rem;margin-bottom:1.4rem}",
      ".kb-cat-card{background:var(--color-surface);border:1.5px solid var(--color-border);border-radius:var(--radius);padding:1rem 1.1rem;cursor:pointer;transition:border-color .15s,box-shadow .15s;text-decoration:none;display:block}",
      ".kb-cat-card:hover{border-color:var(--color-primary);box-shadow:0 4px 16px color-mix(in srgb,var(--color-primary) 15%,transparent)}",
      ".kb-cat-card__icon{font-size:1.6rem;margin-bottom:.4rem;color:var(--color-primary)}",
      ".kb-cat-card__name{font-weight:700;font-size:.95rem;margin-bottom:.15rem}",
      ".kb-cat-card__count{font-size:.78rem;color:var(--color-muted)}",
      ".kb-article-list{display:grid;gap:.5rem}",
      ".kb-article-row{background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;padding:.75rem 1rem;cursor:pointer;transition:border-color .15s}",
      ".kb-article-row:hover{border-color:var(--color-primary)}",
      ".kb-article-row__title{font-weight:600;font-size:.92rem;margin-bottom:.15rem}",
      ".kb-article-row__meta{font-size:.75rem;color:var(--color-muted);display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}",
      ".kb-editor{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);padding:1.2rem}",
      ".kb-article-view{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);padding:1.4rem}",
      ".kb-article-view__body{line-height:1.8;font-size:.95rem;white-space:pre-wrap;margin-top:1rem}",
      "@media(max-width:700px){.kb-cat-grid{grid-template-columns:1fr 1fr}}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  function render() { return '<div id="kb-root"></div>'; }

  function mount(outlet, ctx, sub) {
    var root = outlet.querySelector("#kb-root") || outlet;
    injectStyles();
    root.innerHTML = '<p style="color:var(--color-muted);padding:1rem">Lastar…</p>';
    loadArticles(function () {
      if (sub) renderArticleView(root, sub, ctx);
      else     renderHome(root, ctx);
    });
  }

  function renderHome(root, ctx) {
    var articles = _articles;
    var cats     = getCategories();
    var admin    = isAdmin(ctx);

    var catIcons = {
      "Generelt": "book", "Rutinar": "checklist", "Onboarding": "user-plus",
      "Produkt": "box", "HR": "users", "IT": "device-laptop",
      "Økonomi": "cash", "Sal": "chart-line", "Support": "headset"
    };

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Kunnskapsbase</h2>' +
        (admin ? '<button class="btn btn--primary btn--sm" id="kb-new-btn"><i class="ti ti-plus"></i> Ny artikkel</button>' : '') +
      '</div>' +
      '<div style="position:relative;margin-bottom:1.2rem">' +
        '<i class="ti ti-search" style="position:absolute;left:.75rem;top:50%;transform:translateY(-50%);color:var(--color-muted)"></i>' +
        '<input id="kb-search" type="search" placeholder="Søk i kunnskapsbasen…" ' +
          'style="width:100%;padding:.6rem .9rem .6rem 2.3rem;border:1.5px solid var(--color-border);border-radius:9px;font:inherit;font-size:.9rem;background:var(--color-bg);color:var(--color-text)">' +
      '</div>' +
      '<div id="kb-search-results" style="display:none;margin-bottom:1.2rem"></div>' +
      (cats.length
        ? '<p class="i-section-label">Kategoriar</p>' +
          '<div class="kb-cat-grid">' +
            cats.map(function (cat) {
              var count = articles.filter(function (a) { return (a.category || "Generelt") === cat; }).length;
              var icon  = catIcons[cat] || "folder";
              return '<a href="#/kb" class="kb-cat-card" data-kb-cat="' + C.esc(cat) + '">' +
                '<div class="kb-cat-card__icon"><i class="ti ti-' + icon + '"></i></div>' +
                '<div class="kb-cat-card__name">' + C.esc(cat) + '</div>' +
                '<div class="kb-cat-card__count">' + count + ' artikkel' + (count === 1 ? '' : 'ar') + '</div>' +
              '</a>';
            }).join("") +
          '</div>'
        : '') +
      (articles.length
        ? '<p class="i-section-label">Siste artiklar</p>' +
          '<div class="kb-article-list">' +
            articles.slice(0, 8).map(function (a) { return articleRow(a); }).join("") +
          '</div>'
        : '<div style="text-align:center;padding:2rem;color:var(--color-muted)">' +
            '<i class="ti ti-book-off" style="font-size:2.5rem;display:block;margin-bottom:.5rem;opacity:.3"></i>' +
            '<p style="font-size:.9rem">Ingen artiklar ennå.' + (admin ? ' Klikk «Ny artikkel» for å starte.' : '') + '</p>' +
          '</div>') +
      '<div id="kb-editor-area"></div>';

    bindHome(root, ctx);
  }

  function articleRow(a) {
    return '<div class="kb-article-row" data-kb-open="' + C.esc(a.id) + '">' +
      '<div class="kb-article-row__title">' +
        (a.published ? officialBadge() + ' ' : '') +
        C.esc(a.title) +
      '</div>' +
      '<div class="kb-article-row__meta">' +
        '<span>' + C.esc(a.category || "Generelt") + '</span>' +
        '<span>·</span>' +
        '<span>Oppdatert ' + formatDate(a.updated_at) + '</span>' +
        (a.tags && a.tags.length ? '<span>· ' + tagsHtml(a.tags) + '</span>' : '') +
      '</div>' +
    '</div>';
  }

  function bindHome(root, ctx) {
    var admin = isAdmin(ctx);

    var searchInp = root.querySelector("#kb-search");
    var searchRes = root.querySelector("#kb-search-results");
    if (searchInp) {
      var doSearch = debounce(function () {
        var q = searchInp.value.trim();
        if (!q) { searchRes.style.display = "none"; searchRes.innerHTML = ""; return; }
        var results = searchArticles(q, null, false);
        searchRes.style.display = "";
        searchRes.innerHTML = results.length
          ? '<p class="i-section-label">Søkeresultat (' + results.length + ')</p>' +
            '<div class="kb-article-list">' + results.map(articleRow).join("") + '</div>'
          : '<p style="color:var(--color-muted);font-size:.88rem">Ingen treff på «' + C.esc(q) + '».</p>';
        bindArticleRows(root, ctx);
      }, 300);
      searchInp.addEventListener("input", doSearch);
    }

    root.querySelectorAll("[data-kb-cat]").forEach(function (card) {
      card.addEventListener("click", function (e) {
        e.preventDefault();
        renderCategory(root, card.getAttribute("data-kb-cat"), ctx);
      });
    });

    var newBtn = root.querySelector("#kb-new-btn");
    if (newBtn) newBtn.addEventListener("click", function () { openEditor(root, null, ctx); });

    bindArticleRows(root, ctx);
  }

  function renderCategory(root, category, ctx) {
    var articles = searchArticles(null, category, false);
    var admin    = isAdmin(ctx);

    root.innerHTML =
      '<div class="i-page-head">' +
        '<button class="i-topbar__back" id="kb-back"><i class="ti ti-arrow-left"></i> Alle kategoriar</button>' +
        (admin ? '<button class="btn btn--primary btn--sm" id="kb-new-btn"><i class="ti ti-plus"></i> Ny artikkel</button>' : '') +
      '</div>' +
      '<h3 style="margin:0 0 1rem">' + C.esc(category) + ' <span style="font-size:1rem;font-weight:400;color:var(--color-muted)">(' + articles.length + ')</span></h3>' +
      (articles.length
        ? '<div class="kb-article-list">' + articles.map(articleRow).join("") + '</div>'
        : '<p style="color:var(--color-muted);font-size:.9rem">Ingen artiklar i denne kategorien.</p>') +
      '<div id="kb-editor-area"></div>';

    root.querySelector("#kb-back").addEventListener("click", function () { renderHome(root, ctx); });
    var newBtn = root.querySelector("#kb-new-btn");
    if (newBtn) newBtn.addEventListener("click", function () { openEditor(root, { category: category }, ctx); });
    bindArticleRows(root, ctx);
  }

  function renderArticleView(root, id, ctx) {
    var art   = _articles.find(function (a) { return a.id === id; });
    var admin = isAdmin(ctx);
    if (!art) { renderHome(root, ctx); return; }

    root.innerHTML =
      '<div class="i-page-head" style="margin-bottom:.8rem">' +
        '<button class="i-topbar__back" id="kb-back"><i class="ti ti-arrow-left"></i> Tilbake</button>' +
        (admin
          ? '<div style="display:flex;gap:.4rem">' +
              '<button class="btn btn--ghost btn--sm" id="kb-edit-btn">Rediger</button>' +
              '<button class="btn btn--ghost btn--sm" style="color:#c0392b;border-color:#c0392b" id="kb-del-btn">Slett</button>' +
            '</div>'
          : '') +
      '</div>' +
      '<div class="kb-article-view">' +
        '<div style="display:flex;align-items:flex-start;gap:.6rem;flex-wrap:wrap;margin-bottom:.8rem">' +
          (art.published ? officialBadge() : '') +
          '<span style="font-size:.78rem;color:var(--color-primary);font-weight:600">' + C.esc(art.category || "Generelt") + '</span>' +
        '</div>' +
        '<h2 style="margin:0 0 .5rem;font-size:1.5rem">' + C.esc(art.title) + '</h2>' +
        '<div style="font-size:.78rem;color:var(--color-muted);margin-bottom:.8rem">Sist oppdatert ' + formatDate(art.updated_at) + '</div>' +
        (art.tags && art.tags.length
          ? '<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:1rem">' + tagsHtml(art.tags) + '</div>'
          : '') +
        (art.summary
          ? '<div style="background:var(--color-alt);border-left:3px solid var(--color-primary);padding:.7rem 1rem;border-radius:0 6px 6px 0;margin-bottom:1rem;font-size:.85rem;color:var(--color-muted)">' +
              '<strong style="display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.2rem">Samandrag</strong>' +
              C.esc(art.summary) +
            '</div>'
          : '') +
        '<div class="kb-article-view__body">' + (C.sanitizeRichHtml ? C.sanitizeRichHtml(art.content || "") : C.esc(art.content || "")) + '</div>' +
      '</div>' +
      '<div id="kb-editor-area"></div>';

    root.querySelector("#kb-back").addEventListener("click", function () {
      Intranet.navigate("kb");
      renderHome(root, ctx);
    });

    if (admin) {
      root.querySelector("#kb-edit-btn").addEventListener("click", function () { openEditor(root, art, ctx); });
      root.querySelector("#kb-del-btn").addEventListener("click", function () {
        if (!confirm('Slett "' + art.title + '"?')) return;
        deleteArticle(id, function () { Intranet.navigate("kb"); renderHome(root, ctx); });
      });
    }
  }

  /* =========================================================================
     EDITOR
     ====================================================================== */
  function openEditor(root, item, ctx) {
    var cats = getCategories();
    var ed   = root.querySelector("#kb-editor-area");
    if (!ed) return;

    ed.innerHTML = '<div class="i-card" style="margin-top:1rem">' +
      '<h4 style="margin:0 0 1rem">' + (item && item.id ? "Rediger artikkel" : "Ny artikkel") + '</h4>' +
      '<div class="i-form">' +
        '<div class="i-form">' +
          '<div class="i-field">' +
            '<label for="kb-title">Tittel *</label>' +
            '<input id="kb-title" type="text" value="' + C.esc(item && item.id ? item.title : "") + '" placeholder="Artikkeltittel">' +
          '</div>' +
          '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
            '<div class="i-field" style="flex:1;min-width:140px">' +
              '<label for="kb-category">Kategori</label>' +
              '<input id="kb-category" type="text" list="kb-cat-opts" value="' + C.esc(item ? (item.category || "") : "") + '" placeholder="F.eks. Rutinar, Onboarding…">' +
              '<datalist id="kb-cat-opts">' + cats.map(function(c) { return '<option value="' + C.esc(c) + '">'; }).join("") + '</datalist>' +
            '</div>' +
            '<div class="i-field" style="flex:2;min-width:180px">' +
              '<label for="kb-tags">Tags (kommaseparert)</label>' +
              '<input id="kb-tags" type="text" value="' + C.esc(item && item.id ? (item.tags || []).join(", ") : "") + '" placeholder="f.eks. gdpr, økonomi, onboarding">' +
            '</div>' +
          '</div>' +
          '<div class="i-field">' +
            '<label for="kb-summary">Samandrag (valgfritt · AI-kontekst)</label>' +
            '<input id="kb-summary" type="text" value="' + C.esc(item && item.id ? (item.summary || "") : "") + '" placeholder="Kort beskriving av artikkelen…">' +
          '</div>' +
          C.richTextField({ id: "kb-body", label: "Innhald", value: item && item.id ? (item.content || "") : "" }) +
          '<div class="i-field">' +
            '<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:500">' +
              '<input type="checkbox" id="kb-official"' + (item && item.published ? " checked" : "") + '>' +
              '<i class="ti ti-circle-check" style="color:#2a7a2a"></i>' +
              'Merk som offisiell (godkjend av admin)' +
            '</label>' +
          '</div>' +
          '<div style="display:flex;gap:.5rem">' +
            '<button type="button" class="btn btn--primary btn--sm" id="kb-save-btn">Lagre</button>' +
            '<button type="button" class="btn btn--ghost btn--sm" id="kb-cancel-btn">Avbryt</button>' +
          '</div>' +
          '<p class="form__status" id="kb-save-status"></p>' +
        '</div>' +
      '</div>';

    ed.scrollIntoView({ behavior: "smooth", block: "start" });
    App.ui.bindRichTextFields(ed);

    ed.querySelector("#kb-cancel-btn").addEventListener("click", function () { ed.innerHTML = ""; });

    ed.querySelector("#kb-save-btn").addEventListener("click", function () {
      var title = ed.querySelector("#kb-title").value.trim();
      var st    = ed.querySelector("#kb-save-status");
      if (!title) { st.textContent = "Tittel er påkrevd."; st.className = "form__status is-err"; return; }
      st.textContent = "Lagrar…";

      var data = {
        title:    title,
        category: ed.querySelector("#kb-category").value.trim() || "Generelt",
        tags:     parseTags(ed.querySelector("#kb-tags").value),
        summary:  ed.querySelector("#kb-summary").value.trim(),
        body:     App.ui.readRichTextField(ed, "kb-body"),
        official: ed.querySelector("#kb-official").checked
      };

      saveArticle(item && item.id ? item : null, data, function (savedId) {
        ed.innerHTML = "";
        if (savedId) {
          Intranet.navigate("kb", savedId);
          renderArticleView(root, savedId, ctx);
        } else {
          renderHome(root, ctx);
        }
      });
    });
  }

  /* =========================================================================
     BINDING
     ====================================================================== */
  function bindArticleRows(root, ctx) {
    root.querySelectorAll("[data-kb-open]").forEach(function (row) {
      row.addEventListener("click", function () {
        var id = row.getAttribute("data-kb-open");
        Intranet.navigate("kb", id);
        renderArticleView(root, id, ctx);
      });
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  Intranet.registerModule({
    id:       "kb",
    navLabel: "Kunnskapsbase",
    icon:     "book",
    order:    55,
    render:   render,
    mount:    mount
  });

})();
