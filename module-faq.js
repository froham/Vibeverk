/* =============================================================================
   module-faq.js  —  OFTE STILTE SPØRSMÅL (FAQ)
   -----------------------------------------------------------------------------
   Selvstendig IIFE. Lastes etter core.js. Slås av/på med features.faq.

   Vises som en inline-seksjon på forsiden (order 42, mellom Aktuelt og Booking).
   Kan ha et valgfritt bilde øverst — kollapser automatisk hvis tomt.
   Spørsmål/svar vises som en accordion (klikk spørsmål → svar vises/skjules).

   Admin: CRUD for Q&A-par under «FAQ»-fanen. Bilde og intro-tekst er redigerbart.
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App, C = window.Components, CFG = window.SITE_CONFIG || {};
  if (!App || !C) return;
  if (CFG.features && CFG.features.faq === false) return;

  var esc = C.esc;
  var FCF = CFG.faq || {};
  var STORE_KEY = "faq-items";
  var CONTENT_KEY = "faq-content";

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getItems() { return App.store.get(STORE_KEY, []) || []; }
  function setItems(v) { App.store.set(STORE_KEY, v); }
  function getFaqContent() {
    return Object.assign(
      { heading: FCF.heading || "Ofte stilte spørsmål", intro: FCF.intro || "", image: "" },
      App.store.get(CONTENT_KEY, {}) || {}
    );
  }
  function setFaqContent(v) { App.store.set(CONTENT_KEY, v); }

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("faq-styles")) return;
    var s = document.createElement("style");
    s.id = "faq-styles";
    s.textContent = [
      ".faq-img{width:100%;max-height:320px;object-fit:cover;border-radius:var(--radius);margin-bottom:1.6rem;display:block}",
      ".faq-intro{color:var(--color-muted);margin:0 0 1.6rem;max-width:680px}",
      ".faq-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--color-border)}",
      ".faq-item{border-bottom:1px solid var(--color-border)}",
      ".faq-q{width:100%;text-align:left;background:none;border:0;padding:1rem 0;display:flex;align-items:center;justify-content:space-between;gap:1rem;cursor:pointer;font:inherit;font-size:1rem;font-weight:600;color:var(--color-text);line-height:1.4}",
      ".faq-q:hover{color:var(--color-primary)}",
      ".faq-chevron{flex-shrink:0;font-size:1.1rem;transition:transform .2s;color:var(--color-muted)}",
      ".faq-item.is-open .faq-chevron{transform:rotate(180deg);color:var(--color-primary)}",
      ".faq-a{max-height:0;overflow:hidden;transition:max-height .3s ease}",
      ".faq-item.is-open .faq-a{max-height:800px}",
      ".faq-a__inner{padding:0 0 1rem;color:var(--color-muted);line-height:1.7;white-space:pre-wrap}",
      /* Admin */
      ".faq-adm__head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.6rem}",
      ".faq-adm__head h4{margin:0}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     OFFENTLIG SEKSJON
     ====================================================================== */
  function renderSection() {
    var items = getItems();
    var fc = getFaqContent();
    if (!items.length && !fc.intro && !fc.image) return "";   // ingen innhold → skjul

    var img = App.media.resolveImage(fc.image);
    var imgHtml = img.src ? '<img class="faq-img" src="' + esc(img.src) + '" alt="" loading="lazy">' : "";
    var introHtml = fc.intro ? '<p class="faq-intro">' + esc(fc.intro) + '</p>' : "";

    var listHtml = items.length
      ? '<ul class="faq-list">' + items.map(function (item, i) {
          return '<li class="faq-item">' +
            '<button type="button" class="faq-q" data-faq-toggle="' + i + '" aria-expanded="false">' +
              '<span>' + esc(item.question) + '</span>' +
              '<span class="faq-chevron">' + C.icon("chevron-down") + '</span>' +
            '</button>' +
            '<div class="faq-a" role="region"><div class="faq-a__inner">' + esc(item.answer) + '</div></div>' +
          '</li>';
        }).join("") + '</ul>'
      : '<p class="prose prose--muted">Ingen spørsmål lagt til ennå.</p>';

    return '<section id="faq" class="section reveal"><div class="container">' +
      imgHtml +
      C.eyebrow("Spørsmål og svar") +
      '<h2 class="section__title">' + esc(fc.heading) + '</h2>' +
      introHtml +
      listHtml +
    '</div></section>';
  }

  function mountSection(container) {
    container.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-faq-toggle]");
      if (!btn) return;
      var item = btn.closest(".faq-item");
      var isOpen = item.classList.contains("is-open");
      // Lukk alle andre
      container.querySelectorAll(".faq-item.is-open").forEach(function (el) {
        el.classList.remove("is-open");
        el.querySelector("[data-faq-toggle]").setAttribute("aria-expanded", "false");
      });
      if (!isOpen) {
        item.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  }

  /* =========================================================================
     ADMIN
     ====================================================================== */
  function renderAdmin(root) {
    var items = getItems();
    var fc = getFaqContent();

    root.innerHTML =
      '<form class="admin-form admin-form--card" data-faq-content-form style="margin-bottom:1.2rem">' +
        '<h4 style="margin:0 0 .8rem">Innstillinger</h4>' +
        C.field({ id:"faq-heading", label:"Overskrift", value:fc.heading }) +
        C.field({ id:"faq-intro",   label:"Ingress (valgfritt)", multiline:true, rows:2, value:fc.intro }) +
        App.ui.imageField("faq-image", "Bilde øverst (valgfritt)", fc.image, 3) +
        C.button({ label:"Lagre innstillinger", type:"submit", variant:"primary" }) +
        '<p class="form__status" data-faq-cs></p>' +
      '</form>' +
      '<div class="faq-adm__head"><h4>Spørsmål og svar</h4>' +
        C.button({ label:"Nytt spørsmål", icon:"plus", variant:"primary", attrs:"data-faq-new" }) +
      '</div>' +
      '<ul class="admin-list" data-faq-list>' +
        (items.length ? items.map(faqAdminRow).join("") : '<li class="prose prose--muted">Ingen spørsmål ennå.</li>') +
      '</ul>' +
      '<div data-faq-editor></div>';

    App.ui.bindImageFields(root);

    root.querySelector("[data-faq-content-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      setFaqContent({
        heading: root.querySelector("#faq-heading").value.trim() || FCF.heading,
        intro:   root.querySelector("#faq-intro").value.trim(),
        image:   App.ui.readImageField(root, "faq-image")
      });
      var st = root.querySelector("[data-faq-cs]");
      st.textContent = "Lagret."; st.className = "form__status is-ok";
    });

    root.querySelector("[data-faq-new]").addEventListener("click", function () {
      openEditor(root, null);
    });
    root.querySelectorAll("[data-faq-edit]").forEach(function (b) {
      b.addEventListener("click", function () { openEditor(root, b.getAttribute("data-faq-edit")); });
    });
    root.querySelectorAll("[data-faq-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        setItems(getItems().filter(function (x) { return x.id !== b.getAttribute("data-faq-del"); }));
        renderAdmin(root);
      });
    });
  }

  function faqAdminRow(item) {
    return '<li class="admin-row">' +
      '<div class="admin-row__main"><strong>' + esc(item.question) + '</strong>' +
        (item.answer ? '<span class="admin-row__meta">' + esc(item.answer.slice(0,80)) + '…</span>' : '') +
      '</div>' +
      '<div class="admin-row__actions">' +
        C.button({ label:"Rediger", variant:"ghost", attrs:'data-faq-edit="' + esc(item.id) + '"' }) +
        C.button({ label:"Slett",   variant:"ghost", attrs:'data-faq-del="'  + esc(item.id) + '"' }) +
      '</div>' +
    '</li>';
  }

  function openEditor(root, id) {
    var items = getItems();
    var item = id ? items.find(function (x) { return x.id === id; }) : null;
    var ed = root.querySelector("[data-faq-editor]");
    ed.innerHTML =
      '<form class="admin-form admin-form--card" data-faq-form>' +
        '<h4>' + (item ? "Rediger spørsmål" : "Nytt spørsmål") + '</h4>' +
        C.field({ id:"faq-q", label:"Spørsmål", required:true, value:item ? item.question : "" }) +
        C.field({ id:"faq-a", label:"Svar",      required:true, multiline:true, rows:4, value:item ? item.answer : "" }) +
        '<div class="admin-row__actions">' +
          C.button({ label:item ? "Oppdater" : "Legg til", type:"submit", variant:"primary" }) +
          C.button({ label:"Avbryt", variant:"ghost", attrs:"data-faq-cancel" }) +
        '</div>' +
      '</form>';
    ed.querySelector("[data-faq-cancel]").addEventListener("click", function () { ed.innerHTML = ""; });
    ed.querySelector("[data-faq-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      var q = ed.querySelector("#faq-q").value.trim();
      var a = ed.querySelector("#faq-a").value.trim();
      if (!q || !a) return;
      var list = getItems();
      var obj = { id: item ? item.id : ("faq-" + Date.now()), question: q, answer: a };
      if (item) { var idx = list.findIndex(function (x) { return x.id === item.id; }); list[idx] = obj; }
      else list.push(obj);
      setItems(list);
      renderAdmin(root);
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  injectStyles();
  App.registerModule({
    id:         "faq",
    label:      getFaqContent().heading || "Spørsmål og svar",
    order:      42,
    page:       true,          // kun eigen side (#faq), aldri inline på forsiden
    renderPage: renderSection, // brukes når hash = #faq
    mountPage:  mountSection,
    admin: {
      label:  "FAQ",
      render: function () { return '<div data-faq-root></div>'; },
      mount:  function (body) { renderAdmin(body.querySelector("[data-faq-root]") || body); }
    }
  });
})();
