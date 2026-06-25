/* =============================================================================
   module-announcements.js  —  AKTUELT (intranett)  v2
   -----------------------------------------------------------------------------
   Lagring: Supabase announcements-tabell. Fallback til App.store.
   Feltmapping: body → content, createdAt → created_at.
   Bilete og vedlegg lagrast som tekst/jsonb (App.media-referansar).
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;
  if (CFG.intranettFeatures && CFG.intranettFeatures.announcements === false) return;

  var _sb       = App.supabase;
  var STORE_KEY = "wsp-announcements";
  var _items    = [];

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
  function loadItems(cb) {
    if (!_sb) {
      _items = App.store.get(STORE_KEY, []) || [];
      cb && cb();
      return;
    }
    _sb.from("announcements").select("*").order("created_at", { ascending: false }).then(function (r) {
      if (r.error) { cb && cb(); return; }
      _items = r.data || [];
      if (_items.length === 0) {
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
        title:       a.title || "Sak",
        content:     a.body  || a.content || "",
        important:   !!a.important,
        image:       a.image || "",
        attachments: a.attachments || [],
        author_id:   uid(),
        published_at: a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString()
      };
    });
    _sb.from("announcements").insert(rows).select().then(function (r) {
      if (!r.error) { _items = r.data || []; App.store.remove(STORE_KEY); }
      cb && cb();
    });
  }

  function saveItem(item, data, cb) {
    var row = {
      title:       data.title,
      content:     data.body || "",
      important:   !!data.important,
      image:       data.image || "",
      attachments: data.attachments || []
    };
    if (!_sb) {
      if (item) {
        var idx = _items.findIndex(function (a) { return a.id === item.id; });
        if (idx >= 0) _items[idx] = Object.assign({}, _items[idx], row);
        Intranet.logActivity({ type: "ann_updated", label: "Sak oppdatert: " + row.title });
      } else {
        _items.unshift(Object.assign({ id: "wsp-ann-" + Date.now(), created_at: new Date().toISOString() }, row));
        Intranet.logActivity({ type: "ann_created", label: "Ny sak: " + row.title });
      }
      App.store.set(STORE_KEY, _items);
      cb && cb();
      return;
    }
    if (item) {
      _sb.from("announcements").update(row).eq("id", item.id).select().single().then(function (r) {
        if (!r.error && r.data) {
          var idx = _items.findIndex(function (a) { return a.id === item.id; });
          if (idx >= 0) _items[idx] = r.data;
        }
        Intranet.logActivity({ type: "ann_updated", label: "Sak oppdatert: " + row.title });
        cb && cb();
      });
    } else {
      var insert = Object.assign({ author_id: uid(), published_at: new Date().toISOString() }, row);
      _sb.from("announcements").insert(insert).select().single().then(function (r) {
        if (!r.error && r.data) _items.unshift(r.data);
        Intranet.logActivity({ type: "ann_created", label: "Ny sak: " + row.title });
        cb && cb();
      });
    }
  }

  function deleteItem(id, cb) {
    var item = _items.find(function (a) { return a.id === id; });
    if (item && item.attachments) item.attachments.forEach(function (a) { App.media.freeFile(a.ref); });
    _items = _items.filter(function (a) { return a.id !== id; });
    Intranet.logActivity({ type: "ann_deleted", label: "Sak slettet" });
    if (!_sb) { App.store.set(STORE_KEY, _items); cb && cb(); return; }
    _sb.from("announcements").delete().eq("id", id).then(function () { cb && cb(); });
  }

  /* =========================================================================
     HJELPERAR
     ====================================================================== */
  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
  }

  /* =========================================================================
     BANNER  —  dismissed-IDar lagrast i localStorage per namespace
     ====================================================================== */
  var DISMISSED_KEY = (CFG.storageKey || "site") + ":ann-dismissed";

  function getDismissed() {
    try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]") || []; }
    catch (e) { return []; }
  }

  function dismissBanner(id) {
    var list = getDismissed();
    var sid  = String(id);
    if (list.indexOf(sid) === -1) list.push(sid);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function renderBanner() {
    var banner = document.getElementById("wsp-ann-banner");
    if (!banner) return;
    var dismissed = getDismissed();
    var unread = _items.filter(function (a) {
      return a.important && dismissed.indexOf(String(a.id)) === -1;
    });
    if (!unread.length) { banner.style.display = "none"; return; }
    var ann = unread[0];
    banner.style.display = "flex";
    banner.innerHTML =
      '<i class="ti ti-speakerphone" style="font-size:1.1rem;flex-shrink:0"></i>' +
      '<strong style="flex-shrink:0">' + C.esc(ann.title) + '</strong>' +
      '<span style="flex:1;opacity:.92">' + (function () {
        var plain = C.stripHtml(ann.content || "");
        return C.esc(plain.slice(0, 120) + (plain.length > 120 ? "…" : ""));
      })() + '</span>' +
      (unread.length > 1
        ? '<span style="opacity:.7;font-size:.78rem">' + (unread.length - 1) + ' til</span>'
        : '') +
      '<button id="wsp-ann-lesmer" style="background:none;border:0;color:#fff;font-weight:700;text-decoration:underline;white-space:nowrap;font-size:.82rem;cursor:pointer;padding:0">Les mer</button>' +
      '<button id="wsp-ann-close" style="background:none;border:0;color:#fff;cursor:pointer;font-size:1.2rem;line-height:1;padding:.2rem .3rem;opacity:.8" aria-label="Lukk">&times;</button>';

    var lesMer = banner.querySelector("#wsp-ann-lesmer");
    if (lesMer) lesMer.addEventListener("click", function () { openReaderModal(ann); });
    var closeBtn = banner.querySelector("#wsp-ann-close");
    if (closeBtn) closeBtn.addEventListener("click", function () {
      dismissBanner(ann.id);
      renderBanner();
    });
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  function render() { return '<div id="ann-root"></div>'; }

  function mount(outlet, ctx) {
    var root = outlet.querySelector("#ann-root") || outlet;
    root.innerHTML = '<p style="color:var(--color-muted);padding:1rem">Lastar…</p>';
    loadItems(function () {
      renderList(root, ctx);
      renderBanner();
    });
  }

  function renderList(root, ctx) {
    var admin = isAdmin(ctx);

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Aktuelt <span style="font-size:1rem;font-weight:400;color:var(--color-muted)">(' + _items.length + ')</span></h2>' +
        (admin ? '<button class="btn btn--primary btn--sm" id="ann-new-btn"><i class="ti ti-plus"></i> Ny sak</button>' : '') +
      '</div>' +
      '<div id="ann-editor"></div>' +
      (_items.length === 0
        ? '<p style="color:var(--color-muted);font-size:.9rem">Ingen saker ennå.</p>'
        : '<div class="i-card-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;align-items:stretch">' +
            _items.map(function (a) { return annCard(a, admin); }).join("") +
          '</div>'
      );

    root.querySelectorAll("[data-ann-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = _items.find(function (a) { return a.id === btn.getAttribute("data-ann-open"); });
        if (item) openReaderModal(item);
      });
    });

    if (admin) {
      var newBtn = root.querySelector("#ann-new-btn");
      if (newBtn) newBtn.addEventListener("click", function () { openEditor(root, null, ctx); });

      root.querySelectorAll("[data-ann-edit]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var item = _items.find(function (a) { return a.id === btn.getAttribute("data-ann-edit"); });
          if (item) openEditor(root, item, ctx);
        });
      });

      root.querySelectorAll("[data-ann-del]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var id   = btn.getAttribute("data-ann-del");
          var item = _items.find(function (a) { return a.id === id; });
          if (!confirm('Slett "' + (item ? item.title : "") + '"?')) return;
          deleteItem(id, function () { renderList(root, ctx); renderBanner(); });
        });
      });
    }
  }

  function annCard(a, admin) {
    var img     = a.image ? App.media.resolveImage(a.image) : null;
    var preview = C.stripHtml(a.content || "").slice(0, 160);
    return '<div class="i-card ann-card" style="cursor:pointer;display:flex;flex-direction:column" data-ann-open="' + C.esc(a.id) + '">' +
      (a.important
        ? '<span style="display:inline-flex;align-items:center;gap:.3rem;font-size:.72rem;font-weight:700;' +
          'text-transform:uppercase;letter-spacing:.06em;color:var(--color-primary);margin-bottom:.5rem">' +
          '<i class="ti ti-speakerphone"></i> Viktig</span>'
        : '') +
      (img && img.src
        ? '<img src="' + C.esc(img.src) + '" alt="" style="width:100%;max-height:180px;object-fit:cover;border-radius:8px;margin-bottom:.8rem;display:block">'
        : '') +
      '<strong style="font-size:1rem;display:block;margin-bottom:.2rem">' + C.esc(a.title) + '</strong>' +
      '<div style="font-size:.78rem;color:var(--color-muted);margin-bottom:.5rem">' + formatDate(a.created_at || a.published_at) + '</div>' +
      (preview
        ? '<div style="font-size:.88rem;color:var(--color-muted);line-height:1.55;margin-bottom:.5rem;flex:1;overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical">' +
            C.esc(preview + (C.stripHtml(a.content || "").length > 160 ? "…" : "")) +
          '</div>'
        : '<div style="flex:1"></div>') +
      (a.attachments && a.attachments.length
        ? '<div style="font-size:.78rem;color:var(--color-muted);margin-bottom:.5rem"><i class="ti ti-paperclip"></i> ' +
            a.attachments.length + ' vedlegg</div>'
        : '') +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:.6rem;border-top:1px solid var(--color-border)">' +
        (admin
          ? '<div style="display:flex;gap:.4rem">' +
              '<button class="btn btn--ghost btn--sm" data-ann-edit="' + C.esc(a.id) + '">Rediger</button>' +
              '<button class="btn btn--ghost btn--sm" style="color:#c0392b;border-color:#c0392b" data-ann-del="' + C.esc(a.id) + '">Slett</button>' +
            '</div>'
          : '<span></span>') +
        '<span style="font-size:.78rem;font-weight:600;color:var(--color-primary);display:inline-flex;align-items:center;gap:.25rem">Les mer <i class="ti ti-arrow-right" style="font-size:.78rem"></i></span>' +
      '</div>' +
    '</div>';
  }

  /* =========================================================================
     LESE-POPUP
     ====================================================================== */
  function openReaderModal(item) {
    var existing = document.getElementById("ann-reader-bd");
    if (existing) existing.remove();

    var img = item.image ? App.media.resolveImage(item.image) : null;

    var bd = document.createElement("div");
    bd.id  = "ann-reader-bd";
    bd.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto";

    var modal = document.createElement("div");
    modal.style.cssText = "background:var(--color-bg);border-radius:var(--radius);width:min(680px,100%);max-height:90vh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.3)";

    var attachHtml = "";
    if (item.attachments && item.attachments.length) {
      attachHtml = '<div style="margin-top:1.2rem;padding-top:1rem;border-top:1px solid var(--color-border)">' +
        '<p style="font-size:.82rem;font-weight:600;color:var(--color-muted);margin:0 0 .5rem">Vedlegg</p>' +
        '<ul style="list-style:none;padding:0;margin:0;display:grid;gap:.35rem">' +
          item.attachments.map(function (att) {
            var url = App.media.resolveFile(att.ref);
            return '<li><a href="' + C.esc(url) + '" download="' + C.esc(att.name) + '" ' +
              'style="display:inline-flex;align-items:center;gap:.4rem;font-size:.85rem;color:var(--color-primary)">' +
              '<i class="ti ti-paperclip"></i>' + C.esc(att.name) + '</a></li>';
          }).join("") +
        '</ul>' +
      '</div>';
    }

    modal.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.2rem;border-bottom:1px solid var(--color-border);position:sticky;top:0;background:var(--color-bg);z-index:1">' +
        '<div>' +
          (item.important
            ? '<span style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-primary)"><i class="ti ti-speakerphone"></i> Viktig · </span>'
            : '') +
          '<strong style="font-size:1rem">' + C.esc(item.title) + '</strong>' +
          '<span style="font-size:.78rem;color:var(--color-muted);margin-left:.6rem">' + formatDate(item.created_at || item.published_at) + '</span>' +
        '</div>' +
        '<button id="ann-reader-close" style="background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);line-height:1">&times;</button>' +
      '</div>' +
      '<div style="padding:1.2rem 1.4rem">' +
        (img && img.src
          ? '<img src="' + C.esc(img.src) + '" alt="" style="width:100%;max-height:320px;object-fit:cover;border-radius:8px;margin-bottom:1.1rem;display:block">'
          : '') +
        (item.content
          ? '<div style="font-size:.95rem;line-height:1.75;color:var(--color-text)">' + C.sanitizeRichHtml(item.content) + '</div>'
          : '') +
        attachHtml +
      '</div>';

    bd.appendChild(modal);
    document.body.appendChild(bd);

    function close() { bd.remove(); document.removeEventListener("keydown", escH); }
    function escH(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", escH);
    modal.querySelector("#ann-reader-close").addEventListener("click", close);
    bd.addEventListener("click", function (e) { if (e.target === bd) close(); });
  }

  /* =========================================================================
     EDITOR
     ====================================================================== */
  function openEditor(root, item, ctx) {
    var ed = root.querySelector("#ann-editor");
    if (!ed) return;

    var imgHtml = App.ui ? App.ui.imageField("ann-image", "Bilete (valgfritt)", item ? item.image : "", 16 / 9) : "";
    var attHtml = App.ui ? App.ui.attachField("ann-attachments", item ? (item.attachments || []) : []) : "";

    ed.innerHTML =
      '<div class="i-card" style="margin-bottom:1rem">' +
        '<h4 style="margin:0 0 1rem">' + (item ? "Rediger sak" : "Ny sak") + '</h4>' +
        '<div class="i-form" id="ann-form">' +
          '<div class="i-field">' +
            '<label for="ann-title">Tittel *</label>' +
            '<input id="ann-title" type="text" value="' + C.esc(item ? item.title : "") + '" placeholder="Overskrift på saka" required>' +
          '</div>' +
          C.richTextField({ id: "ann-body", label: "Innhald", value: item ? (item.content || "") : "" }) +
          imgHtml +
          attHtml +
          '<div class="i-field" style="margin-top:.2rem">' +
            '<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:500">' +
              '<input type="checkbox" id="ann-important"' + (item && item.important ? " checked" : "") + '>' +
              '<i class="ti ti-speakerphone" style="color:var(--color-primary)"></i>' +
              'Merk som viktig (vises som banner øvst)' +
            '</label>' +
          '</div>' +
          '<div style="display:flex;gap:.6rem;margin-top:.4rem">' +
            '<button type="button" class="btn btn--primary btn--sm" id="ann-save">Lagre</button>' +
            '<button type="button" class="btn btn--ghost btn--sm" id="ann-cancel">Avbryt</button>' +
          '</div>' +
          '<p class="form__status" id="ann-status"></p>' +
        '</div>' +
      '</div>';

    App.ui.bindImageFields(ed);
    App.ui.bindRichTextFields(ed);
    App.ui.bindAttachField(ed);

    ed.querySelector("#ann-cancel").addEventListener("click", function () { ed.innerHTML = ""; });

    ed.querySelector("#ann-save").addEventListener("click", function () {
      var title = ed.querySelector("#ann-title").value.trim();
      var st    = ed.querySelector("#ann-status");
      if (!title) { st.textContent = "Tittel er påkrevd."; st.className = "form__status is-err"; return; }
      st.textContent = "Lagrar…";
      var data = {
        title:       title,
        body:        App.ui.readRichTextField(ed, "ann-body"),
        important:   ed.querySelector("#ann-important").checked,
        image:       App.ui.readImageField(ed, "ann-image"),
        attachments: App.ui.readAttachments(ed, "ann-attachments")
      };
      saveItem(item || null, data, function () {
        ed.innerHTML = "";
        renderList(root, ctx);
        renderBanner();
      });
    });
  }

  /* =========================================================================
     OPPSTART
     ====================================================================== */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(renderBanner, 50); });
  } else {
    setTimeout(renderBanner, 50);
  }
  window._annRenderBanner = renderBanner;

  Intranet.registerModule({
    id:       "announcements",
    navLabel: "Aktuelt",
    icon:     "speakerphone",
    order:    15,
    render:   render,
    mount:    mount
  });

})();
