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

  // Liten merke-badge ("KI" eller "©") i stedet for fullbredde-banner. Full
  // merketekst vises som hover-tooltip (title-attributt).
  function creditBadge(img) {
    if (!img || !img.creditType) return "";
    const label = img.creditType === "copyright" ? "©" : "KI";
    return `<span class="img-credit-badge" title="${esc(img.caption || "")}">${label}</span>`;
  }

  // Cover-bilde med fokuspunkt. `img` = { src, pos } der pos styrer beskjæringen
  // (object-position). Returnerer tom streng uten src.
  function coverImg(img, cls) {
    if (!img || !img.src) return "";
    const pos = `object-position:${esc(img.pos || "50% 50%")}`;
    const altAttr = esc(img.alt || "");
    const badge = creditBadge(img);
    if (badge) {
      return `<span class="${esc(cls || "")} has-credit">` +
               `<img src="${esc(img.src)}" alt="${altAttr}" loading="lazy" style="${pos}">` +
               badge +
             `</span>`;
    }
    return `<img class="${esc(cls || "")}" src="${esc(img.src)}" alt="${altAttr}" loading="lazy" style="${pos}">`;
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
    const ct = o.creditType || "";
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
        <div class="imgfield__alt">
          <label class="imgfield__altlabel">Alt-tekst (beskriv hva bildet viser — for skjermlesere/SEO)</label>
          <input type="text" class="imgfield__altinput" data-imgfield-alt value="${esc(o.alt || "")}" placeholder="F.eks. «Tre ansatte ved skrivebord»">
        </div>
        <div class="imgfield__credit">
          <p class="imgfield__creditlabel">Merking${helpIcon("Velg ett av valgene under — de utelukker hverandre. «Ingen» viser ingen badge på siden. «KI-generert/redigert» eller «Eget bilde» viser en liten KI- eller ©-badge i hjørnet av bildet på den offentlige siden.")}</p>
          <div class="imgfield__creditradios">
            <label><input type="radio" name="${id}-credit" value="" data-imgfield-credit-type ${!ct ? "checked" : ""}> Ingen</label>
            <label><input type="radio" name="${id}-credit" value="ai" data-imgfield-credit-type ${ct === "ai" ? "checked" : ""}> KI-generert/redigert</label>
            <label><input type="radio" name="${id}-credit" value="copyright" data-imgfield-credit-type ${ct === "copyright" ? "checked" : ""}> Eget bilde (©)</label>
          </div>
          <input type="text" class="imgfield__creditinput" data-imgfield-credit-text
                 placeholder="${esc(o.creditPlaceholder || "")}" value="${esc(o.caption || "")}" ${ct ? "" : "disabled"}>
        </div>
      </div>`;
  }

  // Tabler-ikon. `name` er ikonnavnet uten "ti-" (f.eks. "rocket").
  function icon(name, cls) {
    return `<i class="ti ti-${esc(name)} ${cls || ""}" aria-hidden="true"></i>`;
  }

  // Liten klikkbar hjelpeboble for ikke-selvforklarende admin-funksjoner.
  // Klikk i stedet for hover, så den fungerer likt på mobil og desktop.
  // Bindes globalt én gang (se bindHelpIcons i core.js) — krever ingen egen binding her.
  function helpIcon(text) {
    return `<button type="button" class="help-icon" data-help-toggle aria-label="Hjelp">?<span class="help-icon__pop">${esc(text)}</span></button>`;
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

  // Delt vilkår/personvern-rad: avhukingsboks + lenke som åpner popup med fulltekst.
  // Brukes på kontaktskjema, booking-skjema og tilbud — samme mønster, ulik idPrefix.
  function termsField(opts) {
    const o = opts || {};
    const id = esc(o.idPrefix || "terms");
    const cfg = (window.SITE_CONFIG && window.SITE_CONFIG.privacy) || {};
    const heading = esc(o.heading || cfg.heading || "Personvern og databehandling");
    const text    = sanitizeRichHtml(o.text || cfg.text || "");
    return `
      <div class="terms-row">
        <input type="checkbox" id="${id}-terms">
        <label for="${id}-terms">Jeg har lest og godtar</label>
        <button type="button" class="terms-link" data-terms-open="${id}">${heading}</button>
      </div>
      <div class="terms-modal-back" data-terms-modal="${id}" style="display:none">
        <div class="terms-modal">
          <h3>${heading}</h3>
          <div class="terms-modal-text">${text}</div>
          ${button({ label: "Lukk", variant: "ghost", class: "terms-modal-close", attrs: `data-terms-close="${id}"` })}
        </div>
      </div>`;
  }

  // =========================================================================
  // RIK TEKST — delt mellom Aktuelt, FAQ, Referanser og Mediebank.
  // Lagres som sanert HTML (ikke ren tekst). Verktøylinjen bruker
  // document.execCommand, som er eldre API men fortsatt universelt støttet
  // og det enkleste alternativet uten byggesteg/avhengigheter.
  // =========================================================================

  // Renser HTML til et trygt undersett (allowlist). Kjøres ved lagring OG
  // som ekstra sikkerhet ved visning, slik at korrupt/gammel data aldri
  // kan inneholde script, event-handlere eller andre farlige elementer.
  const RICH_ALLOWED_TAGS = { B:1, STRONG:1, I:1, EM:1, U:1, S:1, STRIKE:1, UL:1, OL:1, LI:1, BR:1, P:1, DIV:1, SPAN:1, A:1 };
  // Disse skal fjernes HELT (tag + innhold) — aldri "unwrappes" til synlig tekst,
  // siden innholdet deres ikke er ment som lesbar tekst (script/style-kode osv).
  const RICH_STRIP_ENTIRELY = { SCRIPT:1, STYLE:1, IFRAME:1, OBJECT:1, EMBED:1, NOSCRIPT:1 };
  function sanitizeRichHtml(html) {
    if (typeof document === "undefined") return "";
    const tmp = document.createElement("div");
    tmp.innerHTML = String(html || "");
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 1) {
          const tag = child.tagName;
          if (RICH_STRIP_ENTIRELY[tag]) {
            node.removeChild(child);
            return;
          }
          if (!RICH_ALLOWED_TAGS[tag]) {
            while (child.firstChild) node.insertBefore(child.firstChild, child);
            node.removeChild(child);
            return;
          }
          Array.prototype.slice.call(child.attributes).forEach(function (attr) {
            const name = attr.name.toLowerCase();
            if (tag === "SPAN" && name === "style") {
              const m = /color\s*:\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]*\)|[a-zA-Z]+)/.exec(attr.value);
              if (m) child.setAttribute("style", "color:" + m[1]); else child.removeAttribute("style");
            } else if (tag === "A" && name === "href") {
              const href = attr.value.trim();
              if (/^\s*javascript:/i.test(href)) child.removeAttribute("href");
              else { child.setAttribute("target", "_blank"); child.setAttribute("rel", "noopener noreferrer"); }
            } else if (!(tag === "A" && name === "target") && !(tag === "A" && name === "rel")) {
              child.removeAttribute(attr.name);
            }
          });
          walk(child);
        } else if (child.nodeType !== 3) {
          node.removeChild(child);
        }
      });
    })(tmp);
    return tmp.innerHTML;
  }

  // Fjerner all HTML — brukes i korte forhåndsvisninger/utdrag og søkeindeks,
  // der formatert tekst ikke skal vises (kun selve sammendraget).
  function stripHtml(html) {
    return String(html || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
      .replace(/\s+/g, " ")
      .trim();
  }

  // Skjemafelt med verktøylinje (fet/kursiv/understrek/gjennomstrek, lister,
  // lenke, tekstfarge, fjern formatering). Verdien lagres som HTML i et
  // skjult felt. App.ui.bindRichTextFields() kobler opp interaktiviteten.
  function richTextField(opts) {
    const o = opts || {};
    const id = esc(o.id);
    return `
      <div class="field rtfield" data-rtfield>
        <label>${esc(o.label)}</label>
        <div class="rtfield__toolbar" role="toolbar" aria-label="Tekstformatering">
          <button type="button" data-rt-cmd="bold" title="Fet"><strong>F</strong></button>
          <button type="button" data-rt-cmd="italic" title="Kursiv"><em>K</em></button>
          <button type="button" data-rt-cmd="underline" title="Understrek"><u>U</u></button>
          <button type="button" data-rt-cmd="strikeThrough" title="Gjennomstrek"><s>G</s></button>
          <span class="rtfield__sep"></span>
          <button type="button" data-rt-cmd="insertUnorderedList" title="Punktliste">${icon("list")}</button>
          <button type="button" data-rt-cmd="insertOrderedList" title="Nummerert liste">${icon("list-numbers")}</button>
          <span class="rtfield__sep"></span>
          <button type="button" data-rt-link title="Lenke">${icon("link")}</button>
          <label class="rtfield__colorlabel" title="Tekstfarge">${icon("palette")}<input type="color" data-rt-color value="#15616d"></label>
          <button type="button" data-rt-clear title="Fjern formatering">${icon("clear-formatting")}</button>
        </div>
        <div class="rtfield__editor" contenteditable="true" data-rt-editor aria-label="${esc(o.label)}"></div>
        <input type="hidden" id="${id}" value="${esc(sanitizeRichHtml(o.value || ""))}">
      </div>`;
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
      ${o.hint ? `<p class="field__hint">${esc(o.hint)}</p>` : ""}
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
        ${img ? creditBadge(img) : ""}
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
            <div class="prose">${sanitizeRichHtml(d.text)}</div>
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
            <div class="card__text">${sanitizeRichHtml(c.text)}</div>
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
  // NB: ikke i aktiv bruk lenger (news() bruker newsFrontCard), men holdt
  // konsistent med rik-tekst-modellen i tilfelle den tas i bruk igjen.
  function newsPost(p, opts) {
    opts = opts || {};
    const hasImg = p.image && p.image.src;
    const teaser = !!opts.teaser;
    const plain = stripHtml(p.text);
    const text = teaser ? esc(truncate(plain, 150)) : sanitizeRichHtml(p.text);
    const titleHtml = teaser
      ? `<a href="#sak/${esc(p.id)}">${esc(p.title)}</a>`
      : esc(p.title);
    return `
      <article class="post ${hasImg ? "post--media" : ""}">
        ${hasImg ? coverImg(p.image, "post__media") : ""}
        <time class="post__date" datetime="${esc(p.date)}">${formatDate(p.date)}</time>
        <h3 class="post__title">${titleHtml}</h3>
        <p class="post__text">${text}</p>
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
    const plain = stripHtml(p.text);
    const txt = isTeaser ? truncate(plain, 140) : plain;
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
          <div class="article__body prose">${sanitizeRichHtml(p.text)}</div>
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
    const plain = stripHtml(p.text);
    const thumb = hasImg
      ? coverImg(p.image, "archive__thumb")
      : `<span class="archive__thumb archive__thumb--blank">${icon("news")}</span>`;
    return `<li class="archive__item" data-search="${esc((p.title + " " + plain).toLowerCase())}">
      <a class="archive__link" href="#sak/${esc(p.id)}">
        ${thumb}
        <span class="archive__meta">
          <time class="post__date" datetime="${esc(p.date)}">${formatDate(p.date)}</time>
          <span class="archive__title">${esc(p.title)}</span>
          <span class="archive__teaser">${esc(truncate(plain, 120))}</span>
        </span>
      </a>
    </li>`;
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

  // Sosiale plattformer kontakt-seksjonen støtter. Delt mellom offentlig
  // rendering (her) og admin-skjemaet (core.js), slik at begge alltid er i sync.
  const SOCIAL_PLATFORMS = [
    { key: "facebook",  label: "Facebook",  icon: "brand-facebook" },
    { key: "instagram", label: "Instagram", icon: "brand-instagram" },
    { key: "linkedin",  label: "LinkedIn",  icon: "brand-linkedin" },
    { key: "tiktok",    label: "TikTok",    icon: "brand-tiktok" },
    { key: "youtube",   label: "YouTube",   icon: "brand-youtube" },
    { key: "x",         label: "X.com",     icon: "brand-x" }
  ];

  // Kontakt (skjema + info)
  function contact(d, info) {
    // Normaliser social: migrer gammal "twitter"-nøkkel til "x", fjern alltid twitter
    const socialData = Object.assign({}, info.social || {});
    if (socialData.twitter && !socialData.x) { socialData.x = socialData.twitter; }
    delete socialData.twitter;
    const social = SOCIAL_PLATFORMS
      .filter(function (p) { return socialData[p.key]; })
      .map(function (p) { return `<a href="${esc(socialData[p.key])}" target="_blank" rel="noopener">${icon(p.icon)} ${esc(p.label)}</a>`; });
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
            ${termsField({ idPrefix: "lead" })}
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

    // Personvern-lenke + read-only info-popup (ingen avhukingsboks — kun visning)
    const pcfg = (o.privacy || (window.SITE_CONFIG && window.SITE_CONFIG.privacy)) || {};
    const pHeading = esc(pcfg.heading || "Personvern og databehandling");
    const hasPrivacy = !!(pcfg.text || "");
    const pText    = sanitizeRichHtml(pcfg.text || "");

    // Fire seksjoner: Navn/informasjon | Meny 1 | Meny 2 | Copyright.
    // De vanlige lenkene deles jevnt på Meny 1/Meny 2 — Personvern legges alltid
    // til SIST i Meny 2, slik at begge kolonnene blir like lange selv om personvern
    // teller med. Er Meny 2 alene (ingen andre lenker), står den øverst der.
    const links = (o.links || []);
    function linkLi(l) {
      return `<li><a href="#${esc(l.id)}" class="site-footer__navlink">${esc(l.label)}</a></li>`;
    }
    const half = Math.ceil(links.length / 2);
    const col1Items = links.slice(0, half).map(linkLi).join("");
    const privacyLi = hasPrivacy
      ? `<li><button type="button" class="site-footer__navlink terms-link" style="text-decoration:none;text-align:left;background:none;border:0;padding:0;font:inherit;cursor:pointer" data-terms-open="footer-privacy">Personvern</button></li>`
      : "";
    const col2Items = links.slice(half).map(linkLi).join("") + privacyLi;

    const menu1Html = col1Items ? `<nav class="site-footer__col site-footer__nav"><ul>${col1Items}</ul></nav>` : "";
    const menu2Html = col2Items ? `<nav class="site-footer__col site-footer__nav"><ul>${col2Items}</ul></nav>` : "";

    const privacyModal = hasPrivacy
      ? `<div class="terms-modal-back" data-terms-modal="footer-privacy" style="display:none">
           <div class="terms-modal">
             <h3>${pHeading}</h3>
             <div class="terms-modal-text">${pText}</div>
             ${button({ label: "Lukk", variant: "ghost", class: "terms-modal-close", attrs: 'data-terms-close="footer-privacy"' })}
           </div>
         </div>`
      : "";

    return `
      <footer class="site-footer" data-footer>
        <div class="container site-footer__inner">
          <div class="site-footer__col site-footer__left">
            <span class="site-footer__brand">${esc(o.name || "")}</span>
            ${infoHtml}
          </div>
          ${menu1Html}
          ${menu2Html}
          <div class="site-footer__col site-footer__copy-col">
            <span class="site-footer__copy">${copyright}</span>
          </div>
        </div>
        ${privacyModal}
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
    esc, icon, button, eyebrow, field, termsField, richTextField, sanitizeRichHtml, stripHtml, formatDate, image, coverImg, imageField, creditBadge, helpIcon, SOCIAL_PLATFORMS,
    fileIcon, formatBytes, truncate, paragraphs,
    nav, hero, about, services, news, newsPost, articleView, archiveView, simpleView,
    contact, footer, modal, tabbar
  };
})();
