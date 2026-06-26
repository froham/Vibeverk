/* =============================================================================
   module-mediabank.js  —  MEDIEBANK
   -----------------------------------------------------------------------------
   Selvstendig IIFE. Lastes etter core.js. Slås av/på med features.mediabank.

   Egen side (#mediabank) med:
     - Redigerbar overskrift + ingress (her skriver kunden om sin grafiske profil)
     - Rent bilde-rutenett (ingen tekst synlig i rutenettet)
     - Søk + tagg-filter over rutenettet
     - Klikk på bilde åpner en lightbox med rik-tekst-beskrivelse, evt.
       merketekst (KI/©), nedlasting og dimensjoner

   Admin: dra-og-slipp-omsortering, tagger/kategorier, bildedimensjoner og
   filstørrelse vist per bilde.

   Tenkt brukt både eksternt (nå) og internt (senere, som felles ressursside).
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App, C = window.Components, CFG = window.SITE_CONFIG || {};
  if (!App || !C) return;
  if (CFG.features && CFG.features.mediabank === false) return;

  var esc = C.esc;
  var MCF = CFG.mediabank || {};

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getSettings() {
    return App.store.get("mediabank-settings", null) || { heading: MCF.heading || "Mediebank", intro: MCF.intro || "" };
  }
  function saveSettings(v) { App.store.set("mediabank-settings", v); }
  function getImages()  { return App.store.get("mediabank-images", []) || []; }
  function saveImages(v) { App.store.set("mediabank-images", v); }

  function styleTag() {
    return "<style>" + [
      ".mb-intro{max-width:680px;margin:0 0 2rem;color:var(--color-muted);white-space:pre-wrap}",
      ".mb-controls{display:flex;flex-wrap:wrap;align-items:center;gap:.8rem;margin-bottom:1.2rem}",
      ".mb-search{position:relative;flex:0 1 280px}",
      ".mb-search input{width:100%;padding:.55rem .8rem .55rem 2.1rem;border-radius:999px;border:1.5px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font:inherit}",
      ".mb-search svg,.mb-search i{position:absolute;left:.7rem;top:50%;transform:translateY(-50%);color:var(--color-muted);font-size:1rem}",
      ".mb-tagfilters{display:flex;flex-wrap:wrap;gap:.45rem}",
      ".mb-tag{font:inherit;font-size:.84rem;padding:.38rem .8rem;border-radius:999px;border:1.5px solid var(--color-border);background:transparent;color:var(--color-text);cursor:pointer}",
      ".mb-tag:hover{border-color:var(--color-primary)}",
      ".mb-tag.is-active{background:var(--color-primary);border-color:var(--color-primary);color:#fff}",
      ".mb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:1rem}",
      ".mb-thumb{position:relative;display:block;width:100%;aspect-ratio:1;border-radius:var(--radius);overflow:hidden;border:1px solid var(--color-border);background:var(--color-alt);cursor:pointer;padding:0}",
      ".mb-thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s}",
      ".mb-thumb:hover img{transform:scale(1.05)}",
      ".mb-empty,.mb-noresults{color:var(--color-muted)}",
      ".mb-lightbox-back{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:950;display:flex;align-items:center;justify-content:center;padding:1.2rem}",
      ".mb-lightbox{background:var(--color-surface);border-radius:var(--radius);max-width:760px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)}",
      ".mb-lightbox__img{width:100%;max-height:58vh;object-fit:contain;background:var(--color-alt);display:block}",
      ".mb-lightbox__body{padding:1.3rem 1.5rem}",
      ".mb-lightbox__desc{margin:0 0 .7rem;line-height:1.6}",
      ".mb-lightbox__credit{font-size:.8rem;color:var(--color-muted);font-style:italic;margin:0 0 .5rem}",
      ".mb-lightbox__meta{font-size:.78rem;color:var(--color-muted);margin:0 0 1.1rem}",
      ".mb-row{display:flex;align-items:center;gap:.7rem}",
      ".mb-draghandle{cursor:grab;color:var(--color-muted);font-size:1.1rem;flex-shrink:0;touch-action:none}",
      ".mb-draghandle:active{cursor:grabbing}",
      "li[data-mb-row].is-dragging{opacity:.4}",
      ".mb-dims{font-size:.78rem;color:var(--color-muted)}"
    ].join("") + "</style>";
  }

  /* =========================================================================
     OFFENTLIG SIDE
     ====================================================================== */
  function renderPage() {
    var s = getSettings();
    var items = getImages().slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    var allTags = [];
    items.forEach(function (it) { (it.tags || []).forEach(function (t) { if (allTags.indexOf(t) === -1) allTags.push(t); }); });
    var tagFilterHtml = allTags.length
      ? '<div class="mb-tagfilters" data-mb-tagfilters>' +
          '<button type="button" class="mb-tag is-active" data-tag="">Alle</button>' +
          allTags.map(function (t) { return '<button type="button" class="mb-tag" data-tag="' + esc(t) + '">' + esc(t) + '</button>'; }).join("") +
        '</div>'
      : "";
    var searchHtml = items.length
      ? '<div class="mb-search">' + C.icon("search") + '<input type="search" data-mb-search placeholder="Søk i bilder…" aria-label="Søk i bilder"></div>'
      : "";
    var controlsHtml = (searchHtml || tagFilterHtml) ? '<div class="mb-controls">' + searchHtml + tagFilterHtml + '</div>' : "";

    var grid = items.length
      ? '<div class="mb-grid" data-mb-grid>' + items.map(function (it) {
          var img = App.media.resolveImage(it.image);
          if (!img.src) return "";
          var searchText = esc((C.stripHtml(it.description || "") + " " + (it.tags || []).join(" ")).toLowerCase());
          var tagsAttr = esc((it.tags || []).join(","));
          return '<button type="button" class="mb-thumb" data-mb-open="' + esc(it.id) + '" data-mb-item ' +
            'data-search="' + searchText + '" data-tags="' + tagsAttr + '" aria-label="Åpne bilde">' +
            '<img src="' + esc(img.src) + '" alt="" loading="lazy" style="object-position:' + esc(img.pos || "50% 50%") + '">' +
            (C.creditBadge(img)) +
          '</button>';
        }).join("") + '</div>' +
        '<p class="mb-noresults" data-mb-noresults style="display:none">Ingen bilder samsvarer med søket.</p>'
      : '<p class="mb-empty">Ingen bilder lagt til ennå.</p>';

    return styleTag() +
      '<section class="section" id="mediabank">' +
        '<div class="container">' +
          C.eyebrow(s.heading || "Mediebank") +
          '<h2 class="section__title">' + esc(s.heading || "Mediebank") + '</h2>' +
          (s.intro ? '<p class="mb-intro">' + esc(s.intro) + '</p>' : '') +
          controlsHtml +
          grid +
        '</div>' +
      '</section>';
  }

  function mountPage(root) {
    var items = getImages();

    function applyFilters() {
      var search = root.querySelector("[data-mb-search]");
      var activeTagBtn = root.querySelector(".mb-tag.is-active");
      var q = search ? search.value.trim().toLowerCase() : "";
      var activeTag = activeTagBtn ? activeTagBtn.getAttribute("data-tag") : "";
      var visibleCount = 0;
      root.querySelectorAll("[data-mb-item]").forEach(function (el) {
        var matchesSearch = !q || (el.getAttribute("data-search") || "").indexOf(q) > -1;
        var tags = (el.getAttribute("data-tags") || "").split(",");
        var matchesTag = !activeTag || tags.indexOf(activeTag) > -1;
        var show = matchesSearch && matchesTag;
        el.style.display = show ? "" : "none";
        if (show) visibleCount++;
      });
      var noResults = root.querySelector("[data-mb-noresults]");
      if (noResults) noResults.style.display = visibleCount === 0 ? "" : "none";
    }

    var searchInput = root.querySelector("[data-mb-search]");
    if (searchInput) searchInput.addEventListener("input", applyFilters);
    root.querySelectorAll("[data-mb-tagfilters] [data-tag]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        root.querySelectorAll(".mb-tag").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        applyFilters();
      });
    });

    function openLightbox(id) {
      var it = items.find(function (x) { return x.id === id; });
      if (!it) return;
      var img = App.media.resolveImage(it.image);
      var back = document.createElement("div");
      back.className = "mb-lightbox-back";
      back.innerHTML =
        '<div class="mb-lightbox">' +
          (img.src ? '<img class="mb-lightbox__img" src="' + esc(img.src) + '" alt="">' : '') +
          '<div class="mb-lightbox__body">' +
            (it.description ? '<div class="mb-lightbox__desc">' + C.sanitizeRichHtml(it.description) + '</div>' : '') +
            (img.caption    ? '<p class="mb-lightbox__credit">' + esc(img.caption) + '</p>' : '') +
            '<p class="mb-lightbox__meta" data-mb-dims></p>' +
            '<div style="display:flex;gap:.6rem;flex-wrap:wrap">' +
              (img.src && img.creditType !== "copyright" ? C.button({ label:"Last ned", icon:"download", variant:"primary", attrs:'data-mb-download="' + esc(img.src) + '"' }) : '') +
              C.button({ label: "Lukk", variant: "ghost", attrs: "data-mb-close" }) +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(back);
      back.addEventListener("click", function (e) { if (e.target === back) back.remove(); });
      back.querySelector("[data-mb-close]").addEventListener("click", function () { back.remove(); });
      var dlBtn = back.querySelector("[data-mb-download]");
      if (dlBtn) dlBtn.addEventListener("click", function () {
        var a = document.createElement("a");
        a.href = dlBtn.getAttribute("data-mb-download");
        a.download = "bilde-" + id + (it.description ? "-" + C.stripHtml(it.description).slice(0, 20).replace(/[^a-zA-Z0-9æøåÆØÅ]+/g, "-") : "");
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
      document.addEventListener("keydown", function esc1(e) { if (e.key === "Escape") { back.remove(); document.removeEventListener("keydown", esc1); } });

      // Dimensjoner (asynkront — kjenner ikke pikselstørrelse før bildet er lastet)
      if (img.src) {
        var probe = new Image();
        probe.onload = function () {
          var dimsEl = back.querySelector("[data-mb-dims]");
          if (dimsEl) dimsEl.textContent = probe.naturalWidth + " × " + probe.naturalHeight + " px";
        };
        probe.src = img.src;
      }
    }

    root.querySelectorAll("[data-mb-open]").forEach(function (b) {
      b.addEventListener("click", function () { openLightbox(b.getAttribute("data-mb-open")); });
    });
  }

  /* =========================================================================
     ADMIN
     ====================================================================== */
  function renderAdmin(root) {
    var s = getSettings();
    var items = getImages().slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    root.innerHTML =
      '<form class="admin-form admin-form--card" data-mb-settings>' +
        '<h4 style="margin:0 0 .8rem">Side-innstillinger</h4>' +
        C.field({ id: "mb-heading", label: "Overskrift", value: s.heading || "" }) +
        C.field({ id: "mb-intro", label: "Ingress (skriv f.eks. om grafisk profil)", multiline: true, rows: 4, value: s.intro || "",
                  hint: "Vises øverst på Mediebank-siden, før bilderutenettet." }) +
        C.button({ label: "Lagre", type: "submit", variant: "primary" }) +
        ' <span class="form__status" data-mb-settings-status style="margin-left:.6rem"></span>' +
      '</form>' +
      '<div class="rf-adm__head" style="margin-top:1.6rem"><h4>Bilder</h4>' +
        '<div style="display:flex;gap:.6rem;flex-wrap:wrap">' +
          C.button({ label: "Legg til bilde", icon: "plus", variant: "primary", attrs: "data-mb-new" }) +
          '<label class="btn btn--ghost" style="cursor:pointer">' + C.icon("upload") + ' Last opp flere bilder' +
            '<input type="file" accept="image/*" multiple hidden data-mb-bulk-file>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<p class="form__status" data-mb-bulk-status style="margin:.3rem 0 .8rem"></p>' +
      '<ul class="admin-list" data-mb-list>' +
        (items.length ? items.map(adminRow).join("") : '<li class="prose prose--muted">Ingen bilder lagt til ennå.</li>') +
      '</ul>' +
      '<div data-mb-editor></div>';

    root.querySelector("[data-mb-settings]").addEventListener("submit", function (e) {
      e.preventDefault();
      saveSettings({
        heading: root.querySelector("#mb-heading").value.trim(),
        intro:   root.querySelector("#mb-intro").value.trim()
      });
      var st = root.querySelector("[data-mb-settings-status]");
      st.textContent = "Lagret."; st.className = "form__status is-ok";
      setTimeout(function () { if (st) st.textContent = ""; }, 1500);
    });

    root.querySelector("[data-mb-new]").addEventListener("click", function () { openEditor(root, null); });

    var bulkInput = root.querySelector("[data-mb-bulk-file]");
    var bulkStatus = root.querySelector("[data-mb-bulk-status]");
    bulkInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(bulkInput.files || []);
      if (!files.length) return;
      bulkStatus.textContent = "Laster opp " + files.length + " bilde" + (files.length > 1 ? "r" : "") + " …";
      var list = getImages();
      var nextOrder = list.length;
      var done = 0, failed = 0, quotaFailed = false;
      Promise.all(files.map(function (file) {
        return App.media.put(file).then(function (ref) {
          list.push({
            id: "mb-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
            image: { src: ref, pos: "50% 50%", caption: "" },
            description: "", tags: [], order: nextOrder++
          });
          done++;
        }).catch(function (err) { failed++; if (err && err.message === "quota") quotaFailed = true; });
      })).then(function () {
        saveImages(list);
        bulkStatus.textContent = done + " bilde" + (done === 1 ? "" : "r") + " lagt til" +
          (failed ? ", " + failed + " feilet" + (quotaFailed ? " (lagringen er full — se Sikkerhetskopi-fanen)" : " (for stort eller ugyldig format)") : ".");
        bulkInput.value = "";
        setTimeout(function () { renderAdmin(root); }, 1200);
      });
    });
    root.querySelectorAll("[data-mb-edit]").forEach(function (b) {
      b.addEventListener("click", function () { openEditor(root, b.getAttribute("data-mb-edit")); });
    });
    root.querySelectorAll("[data-mb-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-mb-del");
        var item = getImages().find(function (x) { return x.id === id; });
        if (item && item.image) App.media.free(item.image);
        saveImages(getImages().filter(function (x) { return x.id !== id; }));
        renderAdmin(root);
      });
    });

    // Dra-og-slipp-omsortering. Rekkefølgen i DOM-en blir den nye "order"-
    // verdien for hvert bilde, lagret idet et drag-and-drop slippes.
    var listEl = root.querySelector("[data-mb-list]");
    var dragSrc = null;
    listEl.querySelectorAll("[data-mb-row]").forEach(function (row) {
      row.addEventListener("dragstart", function (e) {
        dragSrc = row;
        row.classList.add("is-dragging");
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", function () { row.classList.remove("is-dragging"); });
      row.addEventListener("dragover", function (e) { e.preventDefault(); });
      row.addEventListener("drop", function (e) {
        e.preventDefault();
        if (!dragSrc || dragSrc === row) return;
        var rows = Array.prototype.slice.call(listEl.querySelectorAll("[data-mb-row]"));
        var srcIdx = rows.indexOf(dragSrc), dstIdx = rows.indexOf(row);
        if (srcIdx < dstIdx) listEl.insertBefore(dragSrc, row.nextSibling);
        else listEl.insertBefore(dragSrc, row);
        var newOrderIds = Array.prototype.slice.call(listEl.querySelectorAll("[data-mb-row]")).map(function (el) { return el.getAttribute("data-mb-row"); });
        var imgs = getImages();
        newOrderIds.forEach(function (id, idx) {
          var it = imgs.find(function (x) { return x.id === id; });
          if (it) it.order = idx;
        });
        saveImages(imgs);
      });
    });

    // Bildedimensjoner (asynkront — vises når bildet er ferdig lastet)
    items.forEach(function (it) {
      var img = App.media.resolveImage(it.image);
      if (!img.src) return;
      var probe = new Image();
      probe.onload = function () {
        var dimsEl = root.querySelector('[data-mb-dims-for="' + (window.CSS && window.CSS.escape ? window.CSS.escape(it.id) : it.id) + '"]');
        if (!dimsEl) return;
        var dims = probe.naturalWidth + "×" + probe.naturalHeight + " px";
        dimsEl.textContent = dimsEl.textContent ? dims + " · " + dimsEl.textContent : dims;
      };
      probe.src = img.src;
    });
  }

  // Filstørrelse for opplastede bilder (data:-URL) — beregnes synkront fra
  // base64-lengden. For eksterne URL-bilder kan vi ikke vite størrelsen uten
  // en nettverksforespørsel (og CORS kan blokkere dette), så vises ikke da.
  function dataUrlSizeLabel(src) {
    if (!src || src.indexOf("data:") !== 0) return "";
    var b64 = src.split(",")[1] || "";
    var bytes = Math.round(b64.length * 3 / 4);
    return bytes > 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + " MB" : Math.round(bytes / 1024) + " KB";
  }

  function adminRow(item) {
    var img = App.media.resolveImage(item.image);
    var thumb = img.src
      ? '<img src="' + esc(img.src) + '" alt="" style="width:46px;height:46px;object-fit:cover;border-radius:6px;object-position:' + esc(img.pos || "50% 50%") + '">'
      : '<span style="width:46px;height:46px;display:inline-flex;align-items:center;justify-content:center;background:var(--color-alt);border-radius:6px;color:var(--color-muted)">' + C.icon("photo") + '</span>';
    var plainDesc = C.stripHtml(item.description || "");
    var sizeLabel = dataUrlSizeLabel(img.src);
    return '<li class="admin-row" draggable="true" data-mb-row="' + esc(item.id) + '">' +
      '<div class="admin-row__main mb-row">' +
        '<span class="mb-draghandle" title="Dra for å endre rekkefølge">' + C.icon("grip-vertical") + '</span>' +
        thumb +
        '<div>' +
          '<strong>' + (plainDesc ? esc(plainDesc.slice(0, 50)) + (plainDesc.length > 50 ? "…" : "") : '<span class="prose prose--muted">(ingen beskrivelse)</span>') + '</strong>' +
          (img.creditType ? '<br><span class="admin-row__meta">' + (img.creditType === "copyright" ? "©" : "KI") + ': ' + esc(img.caption.slice(0, 60)) + '</span>' : '') +
          ((item.tags && item.tags.length) ? '<br><span class="admin-row__meta">Tagger: ' + esc(item.tags.join(", ")) + '</span>' : '') +
          '<br><span class="mb-dims" data-mb-dims-for="' + esc(item.id) + '">' + (sizeLabel ? sizeLabel : "") + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="admin-row__actions">' +
        C.button({ label: "Rediger", variant: "ghost", attrs: 'data-mb-edit="' + esc(item.id) + '"' }) +
        C.button({ label: "Slett",   variant: "ghost", attrs: 'data-mb-del="'  + esc(item.id) + '"' }) +
      '</div>' +
    '</li>';
  }

  function openEditor(root, id) {
    var items = getImages();
    var item = id ? items.find(function (x) { return x.id === id; }) : null;
    var ed = root.querySelector("[data-mb-editor]");
    ed.innerHTML =
      '<form class="admin-form admin-form--card" data-mb-form>' +
        '<h4>' + (item ? "Rediger bilde" : "Nytt bilde") + '</h4>' +
        App.ui.imageField("mb-image", "Bilde", item ? item.image : "", 1) +
        C.richTextField({ id: "mb-desc", label: "Beskrivelse / informasjon", value: item ? (item.description || "") : "" }) +
        C.field({ id: "mb-tags", label: "Tagger / kategorier (kommaseparert)", value: item ? ((item.tags || []).join(", ")) : "",
                  placeholder: "f.eks. team, kontor, produkt", hint: "Brukes til filtrering på Mediebank-siden." }) +
        '<div class="admin-row__actions">' +
          C.button({ label: item ? "Oppdater" : "Legg til", type: "submit", variant: "primary" }) +
          C.button({ label: "Avbryt", variant: "ghost", attrs: "data-mb-cancel" }) +
        '</div>' +
      '</form>';

    App.ui.bindImageFields(ed);
    App.ui.bindRichTextFields(ed);
    ed.querySelector("[data-mb-cancel]").addEventListener("click", function () { ed.innerHTML = ""; });
    ed.querySelector("[data-mb-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      var tags = ed.querySelector("#mb-tags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
      var obj = {
        id:          item ? item.id : ("mb-" + Date.now()),
        image:       App.ui.readImageField(ed, "mb-image"),
        description: App.ui.readRichTextField(ed, "mb-desc"),
        tags:        tags,
        order:       item ? (item.order || 0) : items.length
      };
      var list = getImages();
      if (item) {
        list = list.map(function (x) { return x.id === item.id ? obj : x; });
      } else {
        list.push(obj);
      }
      saveImages(list);
      ed.innerHTML = "";
      renderAdmin(root);
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  App.registerModule({
    id:         "mediabank",
    label:      getSettings().heading || "Mediebank",
    order:      44,             // mellom FAQ (42) og Booking (45)
    page:       true,           // kun egen side (#mediabank), aldri inline på forsiden
    renderPage: renderPage,
    mountPage:  mountPage,
    admin: {
      label:  "Mediebank",
      category: "innhold",
      render: function () { return '<div data-mb-root></div>'; },
      mount:  function (body) { renderAdmin(body.querySelector("[data-mb-root]") || body); }
    }
  });
})();
