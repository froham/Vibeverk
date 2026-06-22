/* =============================================================================
   module-kb.js  —  INTERN KUNNSKAPSBASE (intranett)
   -----------------------------------------------------------------------------
   Bedriftens interne kunnskap: prosedyrar, rutinar, onboarding, produktinfo.
   Skilt frå Notes ved at KB-artiklar er "offisielle" og godkjende av admin.

   Funksjonar:
   - Opprett / rediger / slett artiklar
   - Kategoriar med eige landingsside
   - Offisiell-flagg (admin-godkjend kunnskap vs. utkast)
   - Fritekstsøk på tvers av tittel, innhald, kategori og tags
   - Sist oppdatert / av kven
   - AI-klar struktur (summary + tags)

   Lagring:  App.store("wsp-kb")
   Ruter:    #/kb, #/kb/<id>
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.kb === false) return;

  var STORE_KEY = "wsp-kb";

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getArticles()  { return App.store.get(STORE_KEY, []) || []; }
  function setArticles(v) { App.store.set(STORE_KEY, v); }

  function newId() {
    return "wsp-kb-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }

  function createArticle(data) {
    var now = Date.now();
    var ctx = Intranet.getContext ? Intranet.getContext() : { userId: "local" };
    var art = {
      id:         newId(),
      title:      data.title    || "Ny artikkel",
      body:       data.body     || "",
      category:   data.category || "Generelt",
      tags:       data.tags     || [],
      summary:    data.summary  || "",
      official:   data.official !== undefined ? data.official : false,
      createdAt:  now,
      updatedAt:  now,
      updatedBy:  ctx.userId || "local"
    };
    var list = getArticles();
    list.unshift(art);
    setArticles(list);
    Intranet.logActivity({ type: "kb_created", label: "Ny KB-artikkel: " + art.title });
    return art;
  }

  function updateArticle(id, changes) {
    var list = getArticles();
    var idx  = list.findIndex(function (a) { return a.id === id; });
    if (idx < 0) return null;
    var ctx = Intranet.getContext ? Intranet.getContext() : { userId: "local" };
    Object.assign(list[idx], changes, { updatedAt: Date.now(), updatedBy: ctx.userId || "local" });
    setArticles(list);
    return list[idx];
  }

  function deleteArticle(id) {
    var list = getArticles();
    var art  = list.find(function (a) { return a.id === id; });
    setArticles(list.filter(function (a) { return a.id !== id; }));
    if (art) Intranet.logActivity({ type: "kb_deleted", label: "KB-artikkel slettet: " + art.title });
  }

  function getCategories() {
    var cats = {};
    getArticles().forEach(function (a) {
      var c = a.category || "Generelt";
      cats[c] = (cats[c] || 0) + 1;
    });
    return Object.keys(cats).sort();
  }

  /* =========================================================================
     SØK
     ====================================================================== */
  function searchArticles(query, category, officialOnly) {
    var q    = (query || "").toLowerCase().trim();
    var list = getArticles();
    if (category)    list = list.filter(function (a) { return (a.category || "Generelt") === category; });
    if (officialOnly) list = list.filter(function (a) { return a.official; });
    if (!q) return list;
    return list.filter(function (a) {
      return (a.title    || "").toLowerCase().indexOf(q) > -1 ||
             (a.body     || "").toLowerCase().indexOf(q) > -1 ||
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
     RENDER — HOVUDSIDE (kategorioversikt)
     ====================================================================== */
  function render() { return '<div id="kb-root"></div>'; }

  function mount(outlet, ctx, sub) {
    var root = outlet.querySelector("#kb-root") || outlet;
    injectStyles();
    if (sub) renderArticleView(root, sub, ctx);
    else     renderHome(root, ctx);
  }

  function isAdmin(ctx) {
    // Sjekk både ctx og sessionStorage (ctx kan vere stale)
    if (ctx && (ctx.role === "owner" || ctx.role === "admin")) return true;
    try {
      var ns   = (window.SITE_CONFIG && window.SITE_CONFIG.storageKey) || "site";
      var role = sessionStorage.getItem(ns + ":intranet-auth");
      return role === "owner" || role === "admin";
    } catch (e) { return false; }
  }

  function renderHome(root, ctx) {
    var articles = getArticles();
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

      /* Søk */
      '<div style="position:relative;margin-bottom:1.2rem">' +
        '<i class="ti ti-search" style="position:absolute;left:.75rem;top:50%;transform:translateY(-50%);color:var(--color-muted)"></i>' +
        '<input id="kb-search" type="search" placeholder="Søk i kunnskapsbasen…" ' +
          'style="width:100%;padding:.6rem .9rem .6rem 2.3rem;border:1.5px solid var(--color-border);border-radius:9px;font:inherit;font-size:.9rem;background:var(--color-bg);color:var(--color-text)">' +
      '</div>' +

      '<div id="kb-search-results" style="display:none;margin-bottom:1.2rem"></div>' +

      /* Kategorikort */
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
        : ''
      ) +

      /* Siste artiklar */
      (articles.length
        ? '<p class="i-section-label">Siste artiklar</p>' +
          '<div class="kb-article-list">' +
            articles.slice(0, 8).map(function (a) { return articleRow(a); }).join("") +
          '</div>'
        : '<div style="text-align:center;padding:2rem;color:var(--color-muted)">' +
            '<i class="ti ti-book-off" style="font-size:2.5rem;display:block;margin-bottom:.5rem;opacity:.3"></i>' +
            '<p style="font-size:.9rem">Ingen artiklar ennå.' + (admin ? ' Klikk «Ny artikkel» for å starte.' : '') + '</p>' +
          '</div>'
      ) +

      '<div id="kb-editor-area"></div>';

    bindHome(root, ctx);
  }

  function articleRow(a) {
    return '<div class="kb-article-row" data-kb-open="' + C.esc(a.id) + '">' +
      '<div class="kb-article-row__title">' +
        (a.official ? officialBadge() + ' ' : '') +
        C.esc(a.title) +
      '</div>' +
      '<div class="kb-article-row__meta">' +
        '<span>' + C.esc(a.category || "Generelt") + '</span>' +
        '<span>·</span>' +
        '<span>Oppdatert ' + formatDate(a.updatedAt) + '</span>' +
        (a.tags && a.tags.length ? '<span>· ' + tagsHtml(a.tags) + '</span>' : '') +
      '</div>' +
    '</div>';
  }

  function bindHome(root, ctx) {
    var admin = isAdmin(ctx);

    /* Søk */
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

    /* Kategorikort */
    root.querySelectorAll("[data-kb-cat]").forEach(function (card) {
      card.addEventListener("click", function (e) {
        e.preventDefault();
        var cat = card.getAttribute("data-kb-cat");
        renderCategory(root, cat, ctx);
      });
    });

    /* Ny artikkel */
    var newBtn = root.querySelector("#kb-new-btn");
    if (newBtn) newBtn.addEventListener("click", function () {
      openEditor(root, null, ctx);
    });

    bindArticleRows(root, ctx);
  }

  /* =========================================================================
     KATEGORISIDE
     ====================================================================== */
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
        : '<p style="color:var(--color-muted);font-size:.9rem">Ingen artiklar i denne kategorien.</p>'
      ) +
      '<div id="kb-editor-area"></div>';

    root.querySelector("#kb-back").addEventListener("click", function () {
      renderHome(root, ctx);
    });
    var newBtn = root.querySelector("#kb-new-btn");
    if (newBtn) newBtn.addEventListener("click", function () {
      openEditor(root, { category: category }, ctx);
    });
    bindArticleRows(root, ctx);
  }

  /* =========================================================================
     ARTIKKELVISNING
     ====================================================================== */
  function renderArticleView(root, id, ctx) {
    var art   = getArticles().find(function (a) { return a.id === id; });
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
          (art.official ? officialBadge() : '') +
          '<span style="font-size:.78rem;color:var(--color-primary);font-weight:600">' + C.esc(art.category || "Generelt") + '</span>' +
        '</div>' +
        '<h2 style="margin:0 0 .5rem;font-size:1.5rem">' + C.esc(art.title) + '</h2>' +
        '<div style="font-size:.78rem;color:var(--color-muted);margin-bottom:.8rem">' +
          'Sist oppdatert ' + formatDate(art.updatedAt) +
          (art.updatedBy && art.updatedBy !== "local" ? ' av ' + C.esc(art.updatedBy) : '') +
        '</div>' +
        (art.tags && art.tags.length
          ? '<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:1rem">' + tagsHtml(art.tags) + '</div>'
          : '') +
        (art.summary
          ? '<div style="background:var(--color-alt);border-left:3px solid var(--color-primary);padding:.7rem 1rem;border-radius:0 6px 6px 0;margin-bottom:1rem;font-size:.85rem;color:var(--color-muted)">' +
              '<strong style="display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.2rem">Samandrag</strong>' +
              C.esc(art.summary) +
            '</div>'
          : '') +
        '<div class="kb-article-view__body">' + (C.sanitizeRichHtml ? C.sanitizeRichHtml(art.body || "") : C.esc(art.body || "")) + '</div>' +
      '</div>' +
      '<div id="kb-editor-area"></div>';

    root.querySelector("#kb-back").addEventListener("click", function () {
      Intranet.navigate("kb");
      renderHome(root, ctx);
    });

    if (admin) {
      root.querySelector("#kb-edit-btn").addEventListener("click", function () {
        openEditor(root, art, ctx);
      });
      root.querySelector("#kb-del-btn").addEventListener("click", function () {
        if (!confirm('Slett "' + art.title + '"?')) return;
        deleteArticle(id);
        Intranet.navigate("kb");
        renderHome(root, ctx);
      });
    }
  }

  /* =========================================================================
     EDITOR
     ====================================================================== */
  function openEditor(root, item, ctx) {
    // Bruk eigen sentrert modal i staden for inline editor-area
    var existing = document.getElementById("kb-edit-modal-bd");
    if (existing) existing.remove();

    var cats = getCategories();
    var bd   = document.createElement("div");
    bd.id    = "kb-edit-modal-bd";
    bd.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto";
    var modal = document.createElement("div");
    modal.style.cssText = "background:var(--color-bg);border-radius:var(--radius);width:min(720px,100%);max-height:88vh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.3)";
    bd.appendChild(modal);
    document.body.appendChild(bd);
    bd.addEventListener("click", function(e) { if (e.target === bd) bd.remove(); });
    document.addEventListener("keydown", function escH(e) { if (e.key==="Escape") { bd.remove(); document.removeEventListener("keydown",escH); } });
    var ed = modal;

    ed.innerHTML = '<div class="kb-editor" style="padding:1.4rem">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">' +
        '<h4 style="margin:0">' + (item && item.id ? "Rediger artikkel" : "Ny artikkel") + '</h4>' +
        '<button id="kb-modal-close" style="background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);line-height:1">&times;</button>' +
      '</div>' +
      '<div class="kb-editor" style="margin-top:1rem">' +
        '<h4 style="margin:0 0 1rem">' + (item && item.id ? "Rediger artikkel" : "Ny artikkel") + '</h4>' +
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
          C.richTextField({ id: "kb-body", label: "Innhald", value: item && item.id ? (item.body || "") : "" }) +
          '<div class="i-field">' +
            '<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:500">' +
              '<input type="checkbox" id="kb-official"' + (item && item.official ? " checked" : "") + '>' +
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

    ed.querySelector("#kb-modal-close") && ed.querySelector("#kb-modal-close").addEventListener("click", function () { bd.remove(); });
    App.ui.bindRichTextFields(ed);
    ed.querySelector("#kb-cancel-btn").addEventListener("click", function () {
      bd.remove();
    });

    ed.querySelector("#kb-save-btn").addEventListener("click", function () {
      var title    = ed.querySelector("#kb-title").value.trim();
      var st       = ed.querySelector("#kb-save-status");
      if (!title) { st.textContent = "Tittel er påkrevd."; st.className = "form__status is-err"; return; }

      var data = {
        title:    title,
        category: ed.querySelector("#kb-category").value.trim() || "Generelt",
        tags:     parseTags(ed.querySelector("#kb-tags").value),
        summary:  ed.querySelector("#kb-summary").value.trim(),
        body:     App.ui.readRichTextField(ed, "kb-body"),
        official: ed.querySelector("#kb-official").checked
      };

      if (item && item.id) {
        updateArticle(item.id, data);
        bd.remove();
        Intranet.navigate("kb", item.id);
        renderArticleView(root, item.id, ctx);
      } else {
        var art = createArticle(data);
        bd.remove();
        Intranet.navigate("kb", art.id);
        renderArticleView(root, art.id, ctx);
      }
    });
  }

  /* =========================================================================
     BINDING (artikkelrader)
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
