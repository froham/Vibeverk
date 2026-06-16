/* =============================================================================
   components.js  —  GJENBRUKBARE HTML-KOMPONENTER
   -----------------------------------------------------------------------------
   Rene funksjoner som tar inn data og returnerer HTML-strenger.
   Ingen kundespesifikke verdier her — alt mates inn fra core.js (som leser
   config.js). Denne filen skal aldri endres per kunde.
   ========================================================================== */

window.Components = (function () {

  /* --- Hjelpere ------------------------------------------------------------- */

  // Escape brukergenerert/lagret tekst før den settes inn i DOM (mot XSS).
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Bilde (returnerer tom streng hvis ingen src) — brukes på offentlig side.
  function image(src, opts) {
    const o = opts || {};
    if (!src) return "";
    return `<img src="${esc(src)}" alt="${esc(o.alt || "")}" class="${o.class || ""}" loading="lazy">`;
  }

  // Cover-bilde med fokuspunkt. `img` = { src, pos } der pos styrer beskjæringen
  // (object-position). Returnerer tom streng uten src.
  function coverImg(img, cls) {
    if (!img || !img.src) return "";
    const pos = `object-position:${esc(img.pos || "50% 50%")}`;
    if (img.caption) {
      return `<span class="${esc(cls || "")} has-credit">` +
               `<img src="${esc(img.src)}" alt="" loading="lazy" style="${pos}">` +
               `<span class="img-credit">${esc(img.caption)}</span>` +
             `</span>`;
    }
    return `<img class="${esc(cls || "")}" src="${esc(img.src)}" alt="" loading="lazy" style="${pos}">`;
  }

  // Bildefelt for admin: opplasting ELLER URL, med forhåndsvisning og
  // fokuspunkt-velger (klikk/dra på bildet for å bestemme beskjæring).
  // value      = JSON av { src, pos } (kanonisk verdi som skjemaet leser)
  // previewSrc = ferdig oppløst src til <img> (core kaller Media.resolve)
  // pos        = object-position for forhåndsvisningen
  // urlValue   = tekst i URL-feltet (tomt hvis verdien er en opplasting)
  // Bildefelt for admin: opplasting ELLER URL, med en beskjærings-forhåndsvisning
  // (hele bildet + et flyttbart utsnitt-vindu) som bygges av core.js.
  // value    = JSON av { src, pos }  | urlValue = tekst i URL-feltet
  // aspect   = forholdstall for utsnittet (matcher hvordan seksjonen viser bildet)
  function imageField(opts) {
    const o = opts || {};
    const id = esc(o.id);
    const aspect = o.aspect || (16 / 9);
    return `
      <div class="field imgfield" data-imgfield>
        <label>${esc(o.label)}</label>
        <div class="imgfield__preview" data-imgfield-preview data-aspect="${aspect}"></div>
        <p class="imgfield__hint" data-imgfield-hint></p>
        <div class="imgfield__controls">
          <label class="btn btn--ghost imgfield__btn">
            ${icon("upload")} Last opp
            <input type="file" accept="image/*" hidden data-imgfield-file>
          </label>
          <input type="text" class="imgfield__url" placeholder="…eller lim inn bilde-URL"
                 data-imgfield-url value="${esc(o.urlValue || "")}">
          <button type="button" class="btn btn--ghost imgfield__clear" data-imgfield-clear
                  aria-label="Fjern bilde">${icon("trash")}</button>
        </div>
        <input type="hidden" id="${id}" value="${esc(o.value || "")}">
        <div class="imgfield__credit">
          <label class="imgfield__creditrow">
            <input type="checkbox" data-imgfield-credit ${o.caption ? "checked" : ""}>
            <span>Merk bildet med tekst (f.eks. KI-opplysning)</span>
          </label>
          <input type="text" class="imgfield__creditinput" data-imgfield-credit-text
                 placeholder="${esc(o.creditPlaceholder || "")}" value="${esc(o.caption || "")}" ${o.caption ? "" : "disabled"}>
        </div>
      </div>`;
  }

  // Tabler-ikon. `name` er ikonnavnet uten "ti-" (f.eks. "rocket").
  function icon(name, cls) {
    return `<i class="ti ti-${esc(name)} ${cls || ""}" aria-hidden="true"></i>`;
  }

  // Knapp eller lenke-knapp. variant: "primary" | "secondary" | "ghost"
  function button(opts) {
    const o = opts || {};
    const variant = o.variant || "primary";
    const cls = `btn btn--${variant} ${o.class || ""}`.trim();
    const inner = `${o.icon ? icon(o.icon) + " " : ""}${esc(o.label)}`;
    if (o.href) {
      return `<a class="${cls}" href="${esc(o.href)}" ${o.attrs || ""}>${inner}</a>`;
    }
    return `<button type="${o.type || "button"}" class="${cls}" ${o.attrs || ""}>${inner}</button>`;
  }

  // Seksjonsetikett ("eyebrow") med signatur-markøren foran.
  function eyebrow(text) {
    return `<p class="eyebrow"><span class="eyebrow__mark"></span>${esc(text)}</p>`;
  }

  // Generelt skjemafelt (brukes både på kontaktskjema og i admin).
  function field(opts) {
    const o = opts || {};
    const id = esc(o.id);
    const control = o.multiline
      ? `<textarea id="${id}" name="${id}" rows="${o.rows || 5}" ${o.required ? "required" : ""} placeholder="${esc(o.placeholder || "")}">${esc(o.value || "")}</textarea>`
      : `<input id="${id}" name="${id}" type="${o.type || "text"}" ${o.required ? "required" : ""} placeholder="${esc(o.placeholder || "")}" value="${esc(o.value || "")}">`;
    return `<div class="field">
      <label for="${id}">${esc(o.label)}</label>
      ${control}
    </div>`;
  }

  /* --- Topp-navigasjon ------------------------------------------------------ */
  // items: [{ id, label }]  — kommer fra modulregisteret i core.js
  function nav(opts) {
    const o = opts || {};
    const brand = o.logoUrl
      ? `<img src="${esc(o.logoUrl)}" alt="${esc(o.name)}" class="brand__logo">`
      : `<span class="brand__name">${esc(o.name)}</span>`;
    const links = (o.items || []).map(function (it) {
      return `<a href="#${esc(it.id)}" class="nav__link" data-nav="${esc(it.id)}">${esc(it.label)}</a>`;
    }).join("");
    return `
      <header class="site-header">
        <div class="container site-header__inner">
          <a href="#hjem" class="brand">${brand}</a>
          <nav class="nav" aria-label="Hovedmeny">
            <div class="nav__links">${links}</div>
          </nav>
          ${o.showSearch ? `<button class="nav__search" data-open-search aria-label="Søk">${icon("search")}</button>` : ""}
          <button class="nav__toggle" aria-label="Åpne meny" aria-expanded="false">
            ${icon("menu-2")}
          </button>
        </div>
      </header>`;
  }

  /* --- Seksjonene ----------------------------------------------------------- */

  // Hjem / hero. Med bilde: fullbredde banner med mørk overlegg for lesbarhet.
  // Fokuspunktet (d.image.pos) styrer background-position.
  function hero(d) {
    const img = d.image && d.image.src ? d.image : null;
    const style = img
      ? ` style="background-image:linear-gradient(180deg,rgba(0,0,0,.5),rgba(0,0,0,.4)),url('${esc(img.src)}');background-position:${esc(img.pos || "50% 50%")}"`
      : "";
    return `
      <section id="hjem" class="section section--hero reveal ${img ? "has-image" : ""}"${style}>
        <div class="container hero">
          <h1 class="hero__title">${esc(d.title)}</h1>
          <p class="hero__subtitle">${esc(d.subtitle)}</p>
          <div class="hero__actions">
            ${button({ label: d.ctaLabel, href: d.ctaTarget, variant: "primary" })}
          </div>
        </div>
        ${img && img.caption ? `<span class="hero__credit">${esc(img.caption)}</span>` : ""}
      </section>`;
  }

  // Om oss
  function about(d) {
    const hasImg = d.image && d.image.src;
    const media = hasImg
      ? `<div class="about__media">${coverImg(d.image, "about__img")}</div>`
      : "";
    return `
      <section id="om-oss" class="section reveal">
        <div class="container about ${hasImg ? "about--with-media" : ""}">
          <div class="about__body">
            ${eyebrow(d.heading)}
            <h2 class="section__title">${esc(d.heading)}</h2>
            <p class="prose">${esc(d.text)}</p>
          </div>
          ${media}
        </div>
      </section>`;
  }

  // Tjenester. Hvert kort har samme struktur: valgfri full-bredde media på topp,
  // deretter en padded kropp. Like høyde sikres i CSS.
  function services(d) {
    const cards = (d.cards || []).map(function (c) {
      const hasImg = c.image && c.image.src;
      // Bilde har forrang over ikon når det er lastet opp/limt inn.
      const media = hasImg
        ? coverImg(c.image, "card__media")
        : `<span class="card__icon">${icon(c.icon)}</span>`;
      return `
        <article class="card ${hasImg ? "card--media" : ""}">
          ${hasImg ? media : ""}
          <div class="card__body">
            ${hasImg ? "" : media}
            <h3 class="card__title">${esc(c.title)}</h3>
            <p class="card__text">${esc(c.text)}</p>
          </div>
        </article>`;
    }).join("");
    return `
      <section id="tjenester" class="section reveal">
        <div class="container">
          ${eyebrow(d.intro || d.heading)}
          <h2 class="section__title">${esc(d.heading)}</h2>
          <div class="cards">${cards}</div>
        </div>
      </section>`;
  }

  // Kort utdrag på ordgrense
  function truncate(s, n) {
    s = String(s || "").trim();
    if (s.length <= n) return s;
    const cut = s.slice(0, n);
    const sp = cut.lastIndexOf(" ");
    return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[.,;:!?-]+$/, "") + "…";
  }

  // Vedleggsliste (nedlastingslenker) — delt mellom innlegg og artikkelvisning
  function attachmentsHtml(attachments) {
    const atts = (attachments || []).filter(function (a) { return a && a.href; });
    if (!atts.length) return "";
    return `<ul class="post__attachments">
      ${atts.map(function (a) {
        return `<li><a href="${esc(a.href)}" download="${esc(a.name)}" rel="noopener">
          ${icon(fileIcon(a))}<span>${esc(a.name)}</span>
          ${a.size ? `<span class="post__att-size">${formatBytes(a.size)}</span>` : ""}
        </a></li>`;
      }).join("")}
    </ul>`;
  }

  // Ett aktuelt-innlegg. opts.teaser = forkortet visning på forsiden.
  function newsPost(p, opts) {
    opts = opts || {};
    const hasImg = p.image && p.image.src;
    const teaser = !!opts.teaser;
    const text = teaser ? truncate(p.text, 150) : esc(p.text);
    const titleHtml = teaser
      ? `<a href="#sak/${esc(p.id)}">${esc(p.title)}</a>`
      : esc(p.title);
    return `
      <article class="post ${hasImg ? "post--media" : ""}">
        ${hasImg ? coverImg(p.image, "post__media") : ""}
        <time class="post__date" datetime="${esc(p.date)}">${formatDate(p.date)}</time>
        <h3 class="post__title">${titleHtml}</h3>
        <p class="post__text">${teaser ? esc(text) : text}</p>
        ${teaser ? `<a class="post__more" href="#sak/${esc(p.id)}">Les mer ${icon("arrow-right")}</a>` : attachmentsHtml(p.attachments)}
      </article>`;
  }

  // Aktuelt-seksjon på forsiden. opts: { teaser, total, frontCount }
  function news(d, posts, opts) {
    opts = opts || {};
    const list = (posts && posts.length)
      ? posts.map(function (p) { return newsFrontCard(p, opts.teaser); }).join("")
      : `<p class="prose prose--muted">Ingen innlegg ennå.</p>`;
    const seeAll = (opts.teaser && opts.total > (opts.frontCount || 0))
      ? `<div class="news__more">${button({ label: "Se alle saker (" + opts.total + ")", href: "#aktuelt/alle", variant: "ghost" })}</div>`
      : "";
    return `
      <section id="aktuelt" class="section reveal">
        <div class="container">
          ${eyebrow(d.intro || d.heading)}
          <h2 class="section__title">${esc(d.heading)}</h2>
          <div class="news-front">${list}</div>
          ${seeAll}
        </div>
      </section>`;
  }

  // Liggende kort for forsiden — full bredde, bilde til venstre
  function newsFrontCard(p, isTeaser) {
    const img = p.image && p.image.src;
    const txt = isTeaser ? truncate(p.text, 140) : p.text;
    return `
      <a class="nfc" href="#sak/${esc(p.id)}">
        ${img ? `<span class="nfc__img">${coverImg(p.image, "nfc__photo")}</span>` : `<span class="nfc__img nfc__img--empty"></span>`}
        <span class="nfc__body">
          <time class="post__date" datetime="${esc(p.date)}">${formatDate(p.date)}</time>
          <span class="nfc__title">${esc(p.title)}</span>
          <span class="nfc__text">${esc(txt)}</span>
          <span class="nfc__more">Les mer ${icon("arrow-right")}</span>
        </span>
      </a>`;
  }

  // Enkelt aktuelt-innlegg som egen visning (full tekst)
  function articleView(p) {
    const hasImg = p.image && p.image.src;
    return `
      <section class="section reveal">
        <div class="container article">
          <a class="article__back" href="#aktuelt/alle">${icon("arrow-left")} Alle saker</a>
          ${hasImg ? coverImg(p.image, "article__media") : ""}
          <time class="post__date" datetime="${esc(p.date)}">${formatDate(p.date)}</time>
          <h1 class="article__title">${esc(p.title)}</h1>
          <div class="article__body prose">${paragraphs(p.text)}</div>
          ${attachmentsHtml(p.attachments)}
        </div>
      </section>`;
  }

  // Arkiv: alle saker som liste, med valgfritt søk
  function archiveView(d, posts, opts) {
    opts = opts || {};
    const searchBox = opts.search
      ? `<div class="archive__search">${icon("search")}<input type="search" data-archive-search placeholder="Søk i saker…" aria-label="Søk i saker"></div>`
      : "";
    const items = (posts || []).map(archiveRow).join("");
    return `
      <section class="section reveal">
        <div class="container">
          <a class="article__back" href="#aktuelt">${icon("arrow-left")} Forsiden</a>
          ${eyebrow(d.intro || d.heading)}
          <h1 class="section__title">Alle saker</h1>
          ${searchBox}
          <ul class="archive" data-archive-list>${items || ""}</ul>
          <p class="archive__empty prose prose--muted" data-archive-empty ${posts && posts.length ? "hidden" : ""}>Ingen saker passet søket.</p>
        </div>
      </section>`;
  }
  function archiveRow(p) {
    const hasImg = p.image && p.image.src;
    const thumb = hasImg
      ? coverImg(p.image, "archive__thumb")
      : `<span class="archive__thumb archive__thumb--blank">${icon("news")}</span>`;
    return `<li class="archive__item" data-search="${esc((p.title + " " + p.text).toLowerCase())}">
      <a class="archive__link" href="#sak/${esc(p.id)}">
        ${thumb}
        <span class="archive__meta">
          <time class="post__date" datetime="${esc(p.date)}">${formatDate(p.date)}</time>
          <span class="archive__title">${esc(p.title)}</span>
          <span class="archive__teaser">${esc(truncate(p.text, 120))}</span>
        </span>
      </a></li>`;
  }

  // Enkel meldingsvisning (f.eks. når en sak ikke finnes)
  function simpleView(title, text, href, linkLabel) {
    return `
      <section class="section reveal">
        <div class="container article">
          <h1 class="article__title">${esc(title)}</h1>
          <p class="prose prose--muted">${esc(text)}</p>
          ${href ? `<a class="article__back" href="${esc(href)}">${icon("arrow-left")} ${esc(linkLabel || "Tilbake")}</a>` : ""}
        </div>
      </section>`;
  }

  // Tekst → avsnitt (dobbelt linjeskift = nytt avsnitt, enkelt = <br>)
  function paragraphs(text) {
    return String(text || "").split(/\n{2,}/).map(function (block) {
      return "<p>" + esc(block).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }

  // Kontakt (skjema + info)
  function contact(d, info) {
    const social = [];
    if (info.social && info.social.linkedin) social.push(`<a href="${esc(info.social.linkedin)}" target="_blank" rel="noopener">${icon("brand-linkedin")} LinkedIn</a>`);
    if (info.social && info.social.instagram) social.push(`<a href="${esc(info.social.instagram)}" target="_blank" rel="noopener">${icon("brand-instagram")} Instagram</a>`);
    // Egendefinerte felter (overskrift + innhold), f.eks. fakturainfo, styremedlemmer
    const extra = (info.extra || []).map(function (f) {
      if (!f || (!f.label && !f.value)) return "";
      return `<div class="contact__extra">
        ${f.label ? `<h3 class="contact__extra-title">${esc(f.label)}</h3>` : ""}
        ${f.value ? `<p class="contact__extra-text">${esc(f.value)}</p>` : ""}
      </div>`;
    }).join("");
    return `
      <section id="kontakt" class="section reveal">
        <div class="container contact">
          <div class="contact__info">
            ${eyebrow(d.intro || d.heading)}
            <h2 class="section__title">${esc(d.heading)}</h2>
            <ul class="contact__list">
              ${info.email   ? `<li>${icon("mail")}<a href="mailto:${esc(info.email)}">${esc(info.email)}</a></li>` : ""}
              ${info.phone   ? `<li>${icon("phone")}<a href="tel:${esc(info.phone.replace(/\s/g, ""))}">${esc(info.phone)}</a></li>` : ""}
              ${info.address ? `<li>${icon("map-pin")}<span>${esc(info.address)}</span></li>` : ""}
            </ul>
            ${extra}
            ${social.length ? `<div class="contact__social">${social.join("")}</div>` : ""}
          </div>
          <form class="contact__form" data-contact-form novalidate>
            ${field({ id: "lead-name",    label: "Navn",    required: true,  placeholder: "Ditt navn" })}
            ${field({ id: "lead-email",   label: "E-post",  required: true,  type: "email", placeholder: "deg@eksempel.no" })}
            ${field({ id: "lead-message", label: "Melding", required: true,  multiline: true, placeholder: "Hva kan vi hjelpe med?" })}
            <div class="contact__actions">
              ${button({ label: "Send melding", type: "submit", variant: "primary" })}
              ${(window.SITE_CONFIG && window.SITE_CONFIG.features && window.SITE_CONFIG.features.quote !== false)
                ? button({ label: "Be om tilbud", href: "#tilbud", variant: "ghost" })
                : ""}
            </div>
            <p class="form__status" data-form-status role="status" aria-live="polite"></p>
          </form>
        </div>
      </section>`;
  }

  // Footer (trippelklikk her åpner admin når aktivert i config)
  function footer(opts) {
    const o = opts || {};
    const f = o.footer || {};
    const year = o.year || new Date().getFullYear();
    const copyright = (f.copyright || ("© " + year + " " + esc(o.name || "")));

    const infoLines = [
      f.orgNr          ? esc(f.orgNr) : "",
      f.invoiceAddress ? esc(f.invoiceAddress) : "",
      f.invoiceEmail   ? `<a href="mailto:${esc(f.invoiceEmail)}">${esc(f.invoiceEmail)}</a>` : "",
      ...((f.extraLines || []).map(function (l) { return esc(l); }))
    ].filter(Boolean);

    const infoHtml = infoLines.length
      ? `<ul class="site-footer__info">${infoLines.map(function (l) { return `<li>${l}</li>`; }).join("")}</ul>`
      : "";

    const links = (o.links || []);
    const linksHtml = links.length
      ? `<nav class="site-footer__nav"><ul>${links.map(function (l) {
          const href = l.page ? "#" + l.id : "#" + l.id;
          return `<li><a href="${esc(href)}" class="site-footer__navlink">${esc(l.label)}</a></li>`;
        }).join("")}</ul></nav>`
      : "";

    return `
      <footer class="site-footer" data-footer>
        <div class="container site-footer__inner">
          <div class="site-footer__left">
            <span class="site-footer__brand">${esc(o.name || "")}</span>
            ${infoHtml}
          </div>
          ${linksHtml}
          <span class="site-footer__copy">${copyright}</span>
        </div>
      </footer>`;
  }

  /* --- Admin: generiske byggeklosser --------------------------------------- */
  // Selve sammensetningen og logikken ligger i core.js. Her er kun markup.

  function modal(opts) {
    const o = opts || {};
    return `
      <div class="modal" data-modal role="dialog" aria-modal="true" aria-label="${esc(o.label || "Dialog")}">
        <div class="modal__backdrop" data-modal-close></div>
        <div class="modal__panel modal__panel--admin">
          <div class="modal__head">
            <h2 class="modal__title">${esc(o.title)}</h2>
            <button class="modal__close" data-modal-close aria-label="Lukk">${icon("x")}</button>
          </div>
          <div class="modal__body" data-modal-body>${o.body || ""}</div>
        </div>
      </div>`;
  }

  function tabbar(tabs, activeId) {
    return `<div class="tabs" role="tablist">` + tabs.map(function (t) {
      const active = t.id === activeId ? "is-active" : "";
      return `<button class="tab ${active}" role="tab" data-tab="${esc(t.id)}">${esc(t.label)}</button>`;
    }).join("") + `</div>`;
  }

  /* --- Dato-formattering ---------------------------------------------------- */
  function formatDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      if (isNaN(d)) return esc(iso);
      return d.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) { return esc(iso); }
  }

  /* --- Fil-hjelpere (vedlegg) ----------------------------------------------- */
  function fileIcon(att) {
    const t = ((att && att.type) || "") + " " + ((att && att.name) || "");
    if (/pdf/i.test(t)) return "file-type-pdf";
    if (/(word|\.docx?)/i.test(t)) return "file-type-doc";
    if (/(sheet|excel|\.xlsx?|\.csv)/i.test(t)) return "file-type-xls";
    if (/(zip|rar|\.7z)/i.test(t)) return "file-zip";
    if (/image\//i.test(t)) return "photo";
    return "paperclip";
  }
  function formatBytes(n) {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  /* --- Eksport -------------------------------------------------------------- */
  return {
    esc, icon, button, eyebrow, field, formatDate, image, coverImg, imageField,
    fileIcon, formatBytes, truncate, paragraphs,
    nav, hero, about, services, news, newsPost, articleView, archiveView, simpleView,
    contact, footer, modal, tabbar
  };
})();
