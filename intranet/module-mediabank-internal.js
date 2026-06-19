/* =============================================================================
   module-mediabank-internal.js  —  INTERN MEDIEBANK (intranett)
   -----------------------------------------------------------------------------
   Separat frå offentleg mediebank. Interne filer og bilete for bedriftsbruk.

   Funksjonar:
   - Bulkopplasting (drag-and-drop + klikk, fleire filer samstundes)
   - Kategoriar/mapper for organisering
   - Forhåndsvisning av bilete inline
   - Kopier-lenke til utklippstavla
   - Slett enkeltfil eller heile kategoriar
   - Lagringsstatus (brukt / tilgjengeleg)
   - Søk på filnamn og kategori

   Lagring:
   - App.store("wsp-media-index")   ← filindeks
   - App.media.putFile() / App.media.put()  ← sjølve filbytane

   Ruter: #/media-internal
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  if (!Intranet || !App || !C) return;

  var INDEX_KEY = "wsp-media-index";

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getIndex()  { return App.store.get(INDEX_KEY, []) || []; }
  function setIndex(v) { App.store.set(INDEX_KEY, v); }

  function newId() {
    return "wsp-m-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }

  function addFile(entry) {
    var list = getIndex();
    list.unshift(entry);
    setIndex(list);
  }

  function deleteFile(id) {
    var list  = getIndex();
    var entry = list.find(function (f) { return f.id === id; });
    if (entry) {
      App.media.freeFile(entry.ref);
      setIndex(list.filter(function (f) { return f.id !== id; }));
      Intranet.logActivity({ type: "media_deleted", label: "Fil slettet: " + entry.name });
    }
  }

  function getCategories() {
    var cats = {};
    getIndex().forEach(function (f) {
      var c = f.category || "Generelt";
      cats[c] = (cats[c] || 0) + 1;
    });
    return Object.keys(cats).sort();
  }

  function isImage(entry) {
    return /^image\//i.test(entry.type || "");
  }

  function formatBytes(n) {
    if (!n) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
  }

  /* =========================================================================
     LAGRINGSSTATUS
     ====================================================================== */
  function storageStatus() {
    try {
      var used = 0;
      var ns   = (window.SITE_CONFIG && window.SITE_CONFIG.storageKey) || "site";
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf(ns + ":wsp-m") > -1) {
          var val = localStorage.getItem(key) || "";
          used += val.length * 2; // UTF-16
        }
      }
      var usedKB = Math.round(used / 1024);
      var totalKB = 5120; // ~5MB
      var pct = Math.min(100, Math.round(usedKB / totalKB * 100));
      return { usedKB: usedKB, totalKB: totalKB, pct: pct };
    } catch (e) { return { usedKB: 0, totalKB: 5120, pct: 0 }; }
  }

  /* =========================================================================
     SØK
     ====================================================================== */
  function filterFiles(query, category) {
    var q     = (query || "").toLowerCase().trim();
    var files = getIndex();
    if (category) files = files.filter(function (f) { return (f.category || "Generelt") === category; });
    if (!q) return files;
    return files.filter(function (f) {
      return (f.name     || "").toLowerCase().indexOf(q) > -1 ||
             (f.category || "").toLowerCase().indexOf(q) > -1;
    });
  }

  /* =========================================================================
     OPPLASTING
     ====================================================================== */
  function uploadFiles(files, category, onProgress, onDone) {
    var arr      = Array.prototype.slice.call(files || []);
    var total    = arr.length;
    var done     = 0;
    var errors   = [];

    if (!total) { onDone(errors); return; }

    (function next(idx) {
      if (idx >= arr.length) { onDone(errors); return; }
      var file = arr[idx];

      function proceed(ref, name, type, size) {
        addFile({
          id:        newId(),
          ref:       ref,
          name:      name,
          type:      type,
          size:      size,
          category:  category || "Generelt",
          uploadedAt: Date.now(),
          uploadedBy: Intranet.getContext ? Intranet.getContext().userId : "local"
        });
        done++;
        if (onProgress) onProgress(done, total);
        next(idx + 1);
      }

      if (isImage({ type: file.type })) {
        // Bilete: bruk App.media.put() (skalerast ned)
        App.media.put(file).then(function (ref) {
          proceed(ref, file.name, file.type, file.size);
        }).catch(function (err) {
          errors.push({ name: file.name, err: err && err.message });
          done++;
          if (onProgress) onProgress(done, total);
          next(idx + 1);
        });
      } else {
        // Andre filer: bruk putFile()
        App.media.putFile(file).then(function (att) {
          proceed(att.ref, att.name, att.type, att.size);
        }).catch(function (err) {
          errors.push({ name: file.name, err: err && err.message });
          done++;
          if (onProgress) onProgress(done, total);
          next(idx + 1);
        });
      }
    })(0);
  }

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("wsp-media-styles")) return;
    var s = document.createElement("style");
    s.id = "wsp-media-styles";
    s.textContent = [
      ".wsp-dropzone{border:2px dashed var(--color-border);border-radius:var(--radius);padding:2rem;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;background:var(--color-bg)}",
      ".wsp-dropzone.is-over{border-color:var(--color-primary);background:var(--color-tint)}",
      ".wsp-dropzone__icon{font-size:2rem;color:var(--color-muted);margin-bottom:.5rem}",
      ".wsp-dropzone__text{color:var(--color-muted);font-size:.88rem}",
      ".wsp-dropzone__text strong{color:var(--color-primary);cursor:pointer}",
      ".wsp-progress{height:4px;background:var(--color-border);border-radius:2px;margin:.6rem 0;overflow:hidden}",
      ".wsp-progress__bar{height:100%;background:var(--color-primary);border-radius:2px;transition:width .2s}",
      ".wsp-media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.75rem;margin-top:.8rem}",
      ".wsp-media-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}",
      ".wsp-media-card__thumb{height:110px;background:var(--color-alt);display:flex;align-items:center;justify-content:center;overflow:hidden}",
      ".wsp-media-card__thumb img{width:100%;height:100%;object-fit:cover}",
      ".wsp-media-card__thumb .wsp-file-icon{font-size:2.2rem;color:var(--color-muted)}",
      ".wsp-media-card__body{padding:.55rem .65rem;flex:1;display:flex;flex-direction:column;gap:.2rem}",
      ".wsp-media-card__name{font-size:.78rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--color-text)}",
      ".wsp-media-card__meta{font-size:.7rem;color:var(--color-muted)}",
      ".wsp-media-card__actions{display:flex;gap:.3rem;margin-top:.3rem}",
      ".wsp-media-card__btn{background:none;border:0;cursor:pointer;font-size:.85rem;color:var(--color-muted);padding:.2rem .35rem;border-radius:4px;line-height:1}",
      ".wsp-media-card__btn:hover{background:var(--color-tint);color:var(--color-primary)}",
      ".wsp-storage-bar{height:6px;background:var(--color-border);border-radius:3px;overflow:hidden;margin:.3rem 0}",
      ".wsp-storage-bar__fill{height:100%;border-radius:3px;transition:width .3s}",
      "@media(max-width:700px){.wsp-media-grid{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  function render() { return '<div id="wsp-media-root"></div>'; }

  function mount(outlet) {
    var root = outlet.querySelector("#wsp-media-root") || outlet;
    injectStyles();
    renderPage(root);
  }

  function renderPage(root) {
    var cats  = getCategories();
    var st    = storageStatus();
    var files = getIndex();
    var warn  = st.pct >= 80;

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Mediebank <span style="font-size:1rem;font-weight:400;color:var(--color-muted)">(' + files.length + ' filer)</span></h2>' +
      '</div>' +

      /* Lagringsstatus */
      '<div class="i-card" style="margin-bottom:1rem">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.3rem">' +
          '<span style="font-size:.78rem;font-weight:600;color:' + (warn ? "#c0392b" : "var(--color-muted)") + '">' +
            (warn ? '⚠ ' : '') + 'Lagring: ' + st.usedKB + ' KB / ' + st.totalKB + ' KB brukt' +
          '</span>' +
          '<span style="font-size:.78rem;color:var(--color-muted)">' + st.pct + '%</span>' +
        '</div>' +
        '<div class="wsp-storage-bar">' +
          '<div class="wsp-storage-bar__fill" style="width:' + st.pct + '%;background:' + (warn ? "#c0392b" : "var(--color-primary)") + '"></div>' +
        '</div>' +
        (warn ? '<p style="font-size:.75rem;color:#c0392b;margin:.2rem 0 0">Lagringen er nesten full. Slett filer for å frigjøre plass.</p>' : '') +
      '</div>' +

      /* Opplasting */
      '<div class="i-card" style="margin-bottom:1rem">' +
        '<p class="i-section-label">Last opp</p>' +
        '<div style="display:flex;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">' +
          '<input id="wsp-upload-category" type="text" list="wsp-cat-list" placeholder="Kategori (f.eks. Logoer, Bilder)…" ' +
            'style="flex:1;min-width:160px;font:inherit;font-size:.85rem;padding:.45rem .7rem;border:1.5px solid var(--color-border);border-radius:7px;background:var(--color-bg);color:var(--color-text)">' +
          '<datalist id="wsp-cat-list">' + cats.map(function(c){ return '<option value="' + C.esc(c) + '">'; }).join("") + '</datalist>' +
        '</div>' +
        '<div class="wsp-dropzone" id="wsp-dropzone">' +
          '<div class="wsp-dropzone__icon"><i class="ti ti-cloud-upload"></i></div>' +
          '<div class="wsp-dropzone__text"><strong>Klikk for å velge</strong> eller dra filer hit</div>' +
          '<div class="wsp-dropzone__text" style="margin-top:.2rem;font-size:.78rem">Bilete, PDF, Word, Excel og meir · Maks ' + (App.media.MAX_FILE_MB || 4) + ' MB per fil</div>' +
          '<input type="file" id="wsp-file-input" multiple style="display:none">' +
        '</div>' +
        '<div id="wsp-progress-wrap" style="display:none">' +
          '<div class="wsp-progress"><div class="wsp-progress__bar" id="wsp-progress-bar" style="width:0%"></div></div>' +
          '<p id="wsp-progress-text" style="font-size:.78rem;color:var(--color-muted);margin:0"></p>' +
        '</div>' +
      '</div>' +

      /* Filter + søk */
      '<div style="display:flex;gap:.5rem;margin-bottom:.8rem;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:140px;position:relative">' +
          '<i class="ti ti-search" style="position:absolute;left:.65rem;top:50%;transform:translateY(-50%);color:var(--color-muted);font-size:.9rem"></i>' +
          '<input id="wsp-media-search" type="search" placeholder="Søk filer…" ' +
            'style="width:100%;padding:.5rem .7rem .5rem 2rem;border:1.5px solid var(--color-border);border-radius:7px;font:inherit;font-size:.85rem;background:var(--color-bg);color:var(--color-text)">' +
        '</div>' +
        '<select id="wsp-cat-select" style="padding:.5rem .7rem;border:1.5px solid var(--color-border);border-radius:7px;font:inherit;font-size:.85rem;background:var(--color-bg);color:var(--color-text)">' +
          '<option value="">Alle kategorier</option>' +
          cats.map(function(c) { return '<option value="' + C.esc(c) + '">' + C.esc(c) + ' (' + (getIndex().filter(function(f){ return (f.category||"Generelt")===c; }).length) + ')</option>'; }).join("") +
        '</select>' +
      '</div>' +

      /* Filgrid */
      '<div id="wsp-media-grid-wrap">' + renderGrid(null, null) + '</div>';

    bindPage(root);
  }

  function renderGrid(query, category) {
    var files = filterFiles(query, category);
    if (!files.length) {
      return '<p style="color:var(--color-muted);font-size:.88rem">' +
        (query || category ? 'Ingen treff.' : 'Ingen filer lastet opp ennå.') + '</p>';
    }
    return '<div class="wsp-media-grid">' +
      files.map(function (f) {
        var img     = isImage(f) ? App.media.resolveFile(f.ref) : null;
        var thumb   = img
          ? '<img src="' + C.esc(img) + '" alt="' + C.esc(f.name) + '" loading="lazy">'
          : '<i class="ti ti-' + fileIcon(f) + ' wsp-file-icon"></i>';

        return '<div class="wsp-media-card">' +
          '<div class="wsp-media-card__thumb">' + thumb + '</div>' +
          '<div class="wsp-media-card__body">' +
            '<div class="wsp-media-card__name" title="' + C.esc(f.name) + '">' + C.esc(f.name) + '</div>' +
            '<div class="wsp-media-card__meta">' + formatBytes(f.size) + ' · ' + formatDate(f.uploadedAt) + '</div>' +
            (f.category ? '<div class="wsp-media-card__meta" style="color:var(--color-primary)">' + C.esc(f.category) + '</div>' : '') +
            '<div class="wsp-media-card__actions">' +
              '<button class="wsp-media-card__btn" data-wsp-copy="' + C.esc(f.id) + '" title="Kopier referanse"><i class="ti ti-copy"></i></button>' +
              (img ? '<a class="wsp-media-card__btn" href="' + C.esc(img) + '" download="' + C.esc(f.name) + '" title="Last ned"><i class="ti ti-download"></i></a>' : '') +
              '<button class="wsp-media-card__btn" data-wsp-del="' + C.esc(f.id) + '" title="Slett" style="margin-left:auto;color:#c0392b"><i class="ti ti-trash"></i></button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join("") +
    '</div>';
  }

  function fileIcon(f) {
    var t = (f.type || "") + " " + (f.name || "");
    if (/pdf/i.test(t))               return "file-type-pdf";
    if (/(word|docx?)/i.test(t))      return "file-type-doc";
    if (/(excel|xlsx?|csv)/i.test(t)) return "file-type-xls";
    if (/(zip|rar|7z)/i.test(t))      return "file-zip";
    if (/image/i.test(t))             return "photo";
    return "file";
  }

  /* =========================================================================
     BINDING
     ====================================================================== */
  function bindPage(root) {
    var dropzone   = root.querySelector("#wsp-dropzone");
    var fileInput  = root.querySelector("#wsp-file-input");
    var catInput   = root.querySelector("#wsp-upload-category");
    var progWrap   = root.querySelector("#wsp-progress-wrap");
    var progBar    = root.querySelector("#wsp-progress-bar");
    var progText   = root.querySelector("#wsp-progress-text");
    var searchInp  = root.querySelector("#wsp-media-search");
    var catSelect  = root.querySelector("#wsp-cat-select");
    var gridWrap   = root.querySelector("#wsp-media-grid-wrap");

    function refreshGrid() {
      if (gridWrap) gridWrap.innerHTML = renderGrid(
        searchInp ? searchInp.value : null,
        catSelect ? catSelect.value : null
      );
      bindGrid(root, gridWrap);
    }

    function startUpload(files) {
      if (!files || !files.length) return;
      var cat = (catInput && catInput.value.trim()) || "Generelt";
      progWrap.style.display = "";
      progBar.style.width = "0%";
      progText.textContent = "Laster opp…";

      uploadFiles(files, cat,
        function onProgress(done, total) {
          var pct = Math.round(done / total * 100);
          progBar.style.width = pct + "%";
          progText.textContent = done + " av " + total + " filer lastet opp…";
        },
        function onDone(errors) {
          progText.textContent = errors.length
            ? (errors.length + " feil. Sjekk filstørrelse (maks ' + (App.media.MAX_FILE_MB||4) + ' MB).")
            : "Ferdig!";
          setTimeout(function () {
            progWrap.style.display = "none";
            renderPage(root); // full re-render for å oppdatere kategoriliste
          }, 1200);
          Intranet.logActivity({ type: "media_upload", label: "Lastet opp filer til " + cat });
        }
      );
    }

    /* Klikk på dropzone */
    dropzone.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () { startUpload(fileInput.files); fileInput.value = ""; });

    /* Drag-and-drop */
    dropzone.addEventListener("dragover", function (e) {
      e.preventDefault();
      dropzone.classList.add("is-over");
    });
    dropzone.addEventListener("dragleave", function () {
      dropzone.classList.remove("is-over");
    });
    dropzone.addEventListener("drop", function (e) {
      e.preventDefault();
      dropzone.classList.remove("is-over");
      startUpload(e.dataTransfer && e.dataTransfer.files);
    });

    /* Søk + filter */
    if (searchInp) searchInp.addEventListener("input", refreshGrid);
    if (catSelect) catSelect.addEventListener("change", refreshGrid);

    /* Grid-handlingar */
    bindGrid(root, gridWrap);
  }

  function bindGrid(root, gridWrap) {
    if (!gridWrap) return;

    /* Kopier referanse */
    gridWrap.querySelectorAll("[data-wsp-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id    = btn.getAttribute("data-wsp-copy");
        var entry = getIndex().find(function (f) { return f.id === id; });
        if (!entry) return;
        var url = isImage(entry)
          ? App.media.resolve(entry.ref)
          : App.media.resolveFile(entry.ref);
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url || entry.ref).then(function () {
            btn.innerHTML = '<i class="ti ti-check"></i>';
            setTimeout(function () { btn.innerHTML = '<i class="ti ti-copy"></i>'; }, 1500);
          });
        }
      });
    });

    /* Slett */
    gridWrap.querySelectorAll("[data-wsp-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id    = btn.getAttribute("data-wsp-del");
        var entry = getIndex().find(function (f) { return f.id === id; });
        if (!confirm('Slett "' + (entry ? entry.name : "filen") + '"?')) return;
        deleteFile(id);
        var card = btn.closest(".wsp-media-card");
        if (card) card.remove();
      });
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  Intranet.registerModule({
    id:       "media-internal",
    navLabel: "Mediebank",
    icon:     "photo-library",
    order:    60,
    render:   render,
    mount:    mount
  });

})();
