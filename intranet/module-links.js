/* =============================================================================
   module-links.js  —  EKSTERNE LENKER (intranett)  v2
   -----------------------------------------------------------------------------
   Lagring: Supabase links-tabell. Fallback til App.store (localStorage).
   Eingongs-migrering frå localStorage ved fyrste innlogging.
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.links === false) return;

  var _sb       = App.supabase;
  var STORE_KEY = "wsp-links";
  var _links    = [];

  /* =========================================================================
     TILGANG
     ====================================================================== */
  function uid() { return Intranet.getContext().userId; }

  function isAdmin(ctx) {
    var role = (ctx && ctx.role) || Intranet.getContext().role;
    return role === "owner" || role === "admin";
  }

  function getCategories() {
    var cats = {};
    _links.forEach(function (l) { cats[l.category || "Generelt"] = 1; });
    return Object.keys(cats).sort();
  }

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function loadLinks(cb) {
    if (!_sb) {
      _links = App.store.get(STORE_KEY, []) || [];
      cb && cb();
      return;
    }
    _sb.from("links").select("*").order("sort_order", { ascending: true }).then(function (r) {
      if (r.error) { cb && cb(); return; }
      _links = r.data || [];
      if (_links.length === 0) {
        var local = App.store.get(STORE_KEY, []) || [];
        if (local.length > 0) { migrateLocal(local, cb); return; }
      }
      cb && cb();
    });
  }

  function migrateLocal(local, cb) {
    var rows = local.map(function (l, i) {
      return {
        title: l.title || "Lenke", url: l.url || "#",
        description: l.description || "",
        category: l.category || "Generelt",
        icon: l.icon || "link",
        created_by: uid(), sort_order: i
      };
    }).filter(function (r) { return !!uid(); });
    if (!rows.length) { cb && cb(); return; }
    _sb.from("links").insert(rows).select().then(function (r) {
      if (!r.error) { _links = r.data || []; App.store.remove(STORE_KEY); }
      cb && cb();
    });
  }

  function saveLink(item, data, cb) {
    var row = {
      title: data.title, url: data.url,
      description: data.description || "",
      category: data.category || "Generelt",
      icon: data.icon || "link"
    };
    if (!_sb) {
      if (item) {
        var idx = _links.findIndex(function (l) { return l.id === item.id; });
        if (idx >= 0) _links[idx] = Object.assign({}, _links[idx], row);
      } else {
        _links.push(Object.assign({ id: "wsp-l-" + Date.now() }, row));
      }
      App.store.set(STORE_KEY, _links);
      cb && cb();
      return;
    }
    if (item) {
      _sb.from("links").update(row).eq("id", item.id).select().single().then(function (r) {
        if (!r.error && r.data) {
          var idx = _links.findIndex(function (l) { return l.id === item.id; });
          if (idx >= 0) _links[idx] = r.data;
        }
        Intranet.logActivity({ type: "link_updated", label: "Lenke oppdatert: " + row.title });
        cb && cb();
      });
    } else {
      var insert = Object.assign({ created_by: uid(), sort_order: _links.length }, row);
      _sb.from("links").insert(insert).select().single().then(function (r) {
        if (!r.error && r.data) _links.push(r.data);
        Intranet.logActivity({ type: "link_created", label: "Ny lenke: " + row.title });
        cb && cb();
      });
    }
  }

  function deleteLink(id, cb) {
    var link = _links.find(function (l) { return l.id === id; });
    _links = _links.filter(function (l) { return l.id !== id; });
    Intranet.logActivity({ type: "link_deleted", label: "Lenke slettet: " + (link ? link.title : "") });
    if (!_sb) { App.store.set(STORE_KEY, _links); cb && cb(); return; }
    _sb.from("links").delete().eq("id", id).then(function () { cb && cb(); });
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  function render() { return '<div id="links-root"></div>'; }

  function mount(outlet, ctx) {
    var root = outlet.querySelector("#links-root") || outlet;
    root.innerHTML = '<p style="color:var(--color-muted);padding:1rem">Lastar…</p>';
    loadLinks(function () { renderPage(root, ctx); });
  }

  function renderPage(root, ctx) {
    var cats  = getCategories();
    var admin = isAdmin(ctx);

    var grouped = {};
    _links.forEach(function (l) {
      var c = l.category || "Generelt";
      if (!grouped[c]) grouped[c] = [];
      grouped[c].push(l);
    });

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Lenker</h2>' +
        (admin ? '<button class="btn btn--primary btn--sm" id="links-new-btn"><i class="ti ti-plus"></i> Legg til</button>' : '') +
      '</div>' +
      '<div id="links-editor"></div>' +
      (_links.length === 0
        ? '<div style="text-align:center;padding:2.5rem;color:var(--color-muted)">' +
            '<i class="ti ti-link" style="font-size:2.5rem;display:block;margin-bottom:.5rem;opacity:.3"></i>' +
            '<p style="font-size:.9rem">' + (admin ? 'Ingen lenker ennå. Klikk «Legg til».' : 'Ingen lenker er lagt til ennå.') + '</p>' +
          '</div>'
        : (cats.length > 1
            ? cats.map(function (cat) {
                return '<div style="margin-bottom:1.4rem">' +
                  '<p class="i-section-label">' + C.esc(cat) + '</p>' +
                  '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.6rem">' +
                    (grouped[cat] || []).map(function (l) { return linkCard(l, admin); }).join("") +
                  '</div>' +
                '</div>';
              }).join("")
            : '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.6rem">' +
                _links.map(function (l) { return linkCard(l, admin); }).join("") +
              '</div>'
          )
      );

    if (admin) {
      var newBtn = root.querySelector("#links-new-btn");
      if (newBtn) newBtn.addEventListener("click", function () { openEditor(root, null, ctx); });

      root.querySelectorAll("[data-link-edit]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          var link = _links.find(function (l) { return l.id === btn.getAttribute("data-link-edit"); });
          if (link) openEditor(root, link, ctx);
        });
      });

      root.querySelectorAll("[data-link-del]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          var id   = btn.getAttribute("data-link-del");
          var link = _links.find(function (l) { return l.id === id; });
          if (!confirm('Slett "' + (link ? link.title : "") + '"?')) return;
          deleteLink(id, function () { renderPage(root, ctx); });
        });
      });
    }
  }

  function linkCard(l, admin) {
    return '<a href="' + C.esc(l.url || "#") + '" target="_blank" rel="noopener" ' +
      'style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;' +
      'padding:.8rem 1rem;display:flex;align-items:flex-start;gap:.7rem;text-decoration:none;' +
      'transition:border-color .15s,box-shadow .15s;position:relative" ' +
      'onmouseover="this.style.borderColor=\'var(--color-primary)\';this.style.boxShadow=\'0 4px 14px color-mix(in srgb,var(--color-primary) 12%,transparent)\'" ' +
      'onmouseout="this.style.borderColor=\'\';this.style.boxShadow=\'\'">' +
      '<i class="ti ti-' + C.esc(l.icon || "link") + '" style="font-size:1.3rem;color:var(--color-primary);flex-shrink:0;margin-top:.1rem"></i>' +
      '<div style="min-width:0;flex:1">' +
        '<div style="font-weight:700;font-size:.9rem;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + C.esc(l.title) + '</div>' +
        (l.description ? '<div style="font-size:.78rem;color:var(--color-muted);margin-top:.15rem;line-height:1.4">' + C.esc(l.description) + '</div>' : '') +
      '</div>' +
      (admin
        ? '<div style="display:flex;flex-direction:column;gap:.2rem;flex-shrink:0">' +
            '<button data-link-edit="' + C.esc(l.id) + '" style="background:none;border:0;cursor:pointer;color:var(--color-muted);font-size:.85rem;padding:.15rem;line-height:1" title="Rediger"><i class="ti ti-pencil"></i></button>' +
            '<button data-link-del="' + C.esc(l.id) + '"  style="background:none;border:0;cursor:pointer;color:#c0392b;font-size:.85rem;padding:.15rem;line-height:1" title="Slett"><i class="ti ti-trash"></i></button>' +
          '</div>'
        : '') +
    '</a>';
  }

  /* =========================================================================
     EDITOR
     ====================================================================== */
  var COMMON_ICONS = [
    "brand-teams", "brand-slack", "brand-office", "brand-google-drive",
    "mail", "calendar", "file-text", "chart-bar", "users", "settings",
    "link", "world", "building", "device-laptop", "headset", "cash"
  ];

  function openEditor(root, item, ctx) {
    var ed   = root.querySelector("#links-editor");
    var cats = getCategories();
    if (!ed) return;

    ed.innerHTML =
      '<div class="i-card" style="margin-bottom:1rem">' +
        '<h4 style="margin:0 0 1rem">' + (item ? "Rediger lenke" : "Ny lenke") + '</h4>' +
        '<div class="i-form">' +
          '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
            '<div class="i-field" style="flex:2;min-width:160px">' +
              '<label for="link-title">Tittel *</label>' +
              '<input id="link-title" type="text" value="' + C.esc(item ? item.title : "") + '" placeholder="SharePoint, Slack, CRM…">' +
            '</div>' +
            '<div class="i-field" style="flex:1;min-width:130px">' +
              '<label for="link-category">Kategori</label>' +
              '<input id="link-category" type="text" list="link-cat-opts" value="' + C.esc(item ? (item.category || "") : "") + '" placeholder="Generelt">' +
              '<datalist id="link-cat-opts">' + cats.map(function(c){ return '<option value="' + C.esc(c) + '">'; }).join("") + '</datalist>' +
            '</div>' +
          '</div>' +
          '<div class="i-field">' +
            '<label for="link-url">URL *</label>' +
            '<input id="link-url" type="url" value="' + C.esc(item ? item.url : "") + '" placeholder="https://…">' +
          '</div>' +
          '<div class="i-field">' +
            '<label for="link-desc">Beskriving (valgfritt)</label>' +
            '<input id="link-desc" type="text" value="' + C.esc(item ? (item.description || "") : "") + '" placeholder="Kort forklaring av kva verktøyet er">' +
          '</div>' +
          '<div class="i-field">' +
            '<label for="link-icon">Tabler-ikon (valgfritt) — <a href="https://tabler.io/icons" target="_blank" rel="noopener" style="font-size:.78rem;color:var(--color-primary)">Finn alle ikon →</a></label>' +
            '<input id="link-icon" type="text" value="' + C.esc(item ? (item.icon || "") : "") + '" placeholder="link, brand-slack, mail…">' +
            '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.4rem">' +
              COMMON_ICONS.map(function (ic) {
                return '<button type="button" data-pick-icon="' + C.esc(ic) + '" title="' + C.esc(ic) + '" ' +
                  'style="background:var(--color-bg);border:1px solid var(--color-border);border-radius:6px;padding:.35rem .45rem;cursor:pointer;font-size:1rem;color:var(--color-muted)">' +
                  '<i class="ti ti-' + C.esc(ic) + '"></i></button>';
              }).join("") +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:.5rem">' +
            '<button type="button" class="btn btn--primary btn--sm" id="link-save">Lagre</button>' +
            '<button type="button" class="btn btn--ghost btn--sm" id="link-cancel">Avbryt</button>' +
          '</div>' +
          '<p class="form__status" id="link-status"></p>' +
        '</div>' +
      '</div>';

    ed.querySelectorAll("[data-pick-icon]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        ed.querySelector("#link-icon").value = btn.getAttribute("data-pick-icon");
        ed.querySelectorAll("[data-pick-icon]").forEach(function (b) { b.style.borderColor = ""; b.style.color = ""; });
        btn.style.borderColor = "var(--color-primary)";
        btn.style.color       = "var(--color-primary)";
      });
    });

    ed.querySelector("#link-cancel").addEventListener("click", function () { ed.innerHTML = ""; });

    ed.querySelector("#link-save").addEventListener("click", function () {
      var title = ed.querySelector("#link-title").value.trim();
      var url   = ed.querySelector("#link-url").value.trim();
      var st    = ed.querySelector("#link-status");
      if (!title || !url) { st.textContent = "Tittel og URL er påkrevd."; st.className = "form__status is-err"; return; }
      if (url && !url.startsWith("http") && !url.startsWith("#") && !url.startsWith("mailto:") && !url.startsWith("/")) {
        url = "https://" + url;
      }
      var data = {
        title:       title,
        url:         url,
        description: ed.querySelector("#link-desc").value.trim(),
        category:    ed.querySelector("#link-category").value.trim() || "Generelt",
        icon:        ed.querySelector("#link-icon").value.trim() || "link"
      };
      st.textContent = "Lagrar…";
      saveLink(item || null, data, function () {
        ed.innerHTML = "";
        renderPage(root, ctx);
      });
    });
  }

  /* =========================================================================
     EKSPONERT API  (brukt av module-dashboard.js sin snarvei-picker)
     ====================================================================== */
  window._linksLoad = function (cb) {
    loadLinks(function () { cb(_links.slice()); });
  };

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  Intranet.registerModule({
    id:       "links",
    navLabel: "Lenker",
    icon:     "link",
    order:    65,
    render:   render,
    mount:    mount
  });

})();
