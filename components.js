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
  // previews (valgfritt): [{ aspect, label }, ...] -- for bilder som faktisk
  // vises med ulikt forhold fleire stader (t.d. Aktuelt-kort vs. artikkelside).
  // Same lagra fokuspunkt vert brukt overalt (éin posisjon, ikkje éin per
  // visning -- eit medvite forenkla val, sjå ROADMAP/CHANGELOG 2026-07-15) --
  // sekundærboksane er reine, ikkje-redigerbare "slik ser det faktisk ut her
  // òg"-spegelbilete av den same posisjonen, ikkje eigne drabare vindauge.
  // Når previews er tom (standard, dei aller fleste biletfelt) er utdataet
  // BYTE-IDENTISK med før denne utvidinga -- ingen ekstra wrapper-div.
  function imageField(opts) {
    const o = opts || {};
    const id = esc(o.id);
    const aspect = o.aspect || (16 / 9);
    const ct = o.creditType || "";
    const previews = Array.isArray(o.previews) ? o.previews : [];
    const hasExtra = previews.length > 0 || !!o.aspectLabel;
    // Merk kva samanheng hovudboksen faktisk gjeld i aria-label når fleire
    // visingar finst -- utan dette høyrer ein skjermlesarbrukar berre ein
    // generisk "flytt fokuspunktet"-etikett, ikkje at det finst ei relatert
    // sekundær-førehandsvising rett under (UX-gjennomgang 2026-07-15).
    const ariaLabel = "Fokuspunkt for utsnitt" + (o.aspectLabel ? " (" + o.aspectLabel + ")" : "") + " — bruk piltastene for å flytte";
    const primaryPreview = `<div class="imgfield__preview" data-imgfield-preview data-aspect="${aspect}" tabindex="0" role="slider" aria-label="${esc(ariaLabel)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-valuetext="Midten"></div>`;
    const previewsBlock = !hasExtra ? primaryPreview : `
        <div class="imgfield__previews" data-imgfield-previews>
          <div class="imgfield__previewbox imgfield__previewbox--primary">
            ${primaryPreview}
            ${o.aspectLabel ? `<p class="imgfield__preview-label">${esc(o.aspectLabel)}</p>` : ""}
          </div>
          ${previews.map(function (p) {
            return `
          <div class="imgfield__previewbox imgfield__previewbox--secondary">
            <div class="imgfield__secondary" data-imgfield-secondary data-aspect="${p.aspect}" aria-hidden="true"></div>
            <p class="imgfield__preview-label">${esc(p.label || "")}</p>
          </div>`;
          }).join("")}
        </div>`;
    return `
      <div class="field imgfield" data-imgfield>
        <label>${esc(o.label)}</label>
        ${previewsBlock}
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
  // Bruk helpIcon()/field({hint,help}) fremfor å håndrulle egne forklarings-
  // avsnitt — se docs/architecture/copy-style-guide.md for når man bruker
  // hvilken, og hvordan man skriver selve teksten (tone, unngå fagsjargong).
  function helpIcon(text) {
    return `<button type="button" class="help-icon" data-help-toggle aria-label="Hjelp">?<span class="help-icon__pop">${esc(text)}</span></button>`;
  }

  // Knapp eller lenke-knapp. variant: "primary" | "secondary" | "ghost"
  //
  // Security Auditor-funn (MEDIUM, 2026-08-11, sidebygger-runda): dei nye
  // seksjonstypane (pbHero/pbCta/pbGrid) tek imot ei fritt-skriven
  // knapplenke frå ein Console-operatør og sender henne uendra hit som
  // o.href -- esc() åleine hindrar IKKJE ein javascript:-URL, berre HTML-
  // spesialteikn. Same fareklasse som sanitizeRichHtml() sin eigen <a href>-
  // sanering og module-quote.js/module-crm.js sin isSafeAttachmentUrl()
  // (begge bruker nøyaktig same regex) -- retta HER, éin gong, i staden for
  // i kvar einskild kallar, sidan button() er den einaste staden ein href
  // faktisk vert til eit <a>-element.
  function button(opts) {
    const o = opts || {};
    const variant = o.variant || "primary";
    const cls = `btn btn--${variant} ${o.class || ""}`.trim();
    const inner = `${o.icon ? icon(o.icon) + " " : ""}${esc(o.label)}`;
    const safeHref = o.href && !/^\s*javascript:/i.test(o.href);
    if (safeHref) {
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

  // Fase 2 (2026-08-06, sjå docs/compliance/): valfrie, SPESIFIKKE samtykke-
  // avkryssingsboksar for EKTE valfrie formål (t.d. nyhetsbrev/marknadsføring)
  // -- definert av operatøren i Console sin Samtykker-fane. Aldri for den
  // grunnleggjande informasjonsplikta (det dekker termsField() over åleine).
  // Kvart formål er si EIGA boks, ALDRI forhandsavhuka, ALDRI obligatorisk
  // for å sende inn skjemaet (sjå App.ui.buildConsentSnapshot() i core.js,
  // som berre LES svara -- håndhevar ingenting). Returnerer tom streng
  // (ingen boks, ingen visuell støy) dersom ingen aktive formål er
  // konfigurert for denne konkrete skjematypen.
  function consentPurposesField(opts) {
    const o = opts || {};
    const idPrefix = esc(o.idPrefix || "cp");
    const formType = o.formType || "";
    const priv = (window.SITE_CONFIG && window.SITE_CONFIG.privacy) || {};
    const purposes = (priv.consentPurposes || []).filter(function (p) {
      return p && p.active !== false && Array.isArray(p.forms) && p.forms.indexOf(formType) !== -1 && String(p.label || "").trim();
    });
    if (!purposes.length) return "";
    return `<div class="consent-purposes" data-consent-purposes="${idPrefix}">` +
      purposes.map(function (p) {
        const cbId = idPrefix + "-cp-" + esc(p.id);
        return `<div class="consent-purpose-row">
          <input type="checkbox" id="${cbId}" data-consent-purpose-id="${esc(p.id)}" data-consent-purpose-label="${esc(p.label)}">
          <label for="${cbId}">${esc(p.label)} <span class="consent-purpose-tag">(valgfritt)</span></label>
        </div>`;
      }).join("") +
    `</div>`;
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
    // processNode/walk are split so that children promoted out of an unwrapped
    // disallowed tag (e.g. <x><img onerror=...></x>) get re-checked themselves
    // instead of surviving unsanitized — walk()'s forEach snapshot is taken
    // before the promotion, so it never re-visits newly promoted nodes itself.
    function processNode(node, child) {
      if (child.nodeType === 1) {
        const tag = child.tagName;
        if (RICH_STRIP_ENTIRELY[tag]) {
          node.removeChild(child);
          return;
        }
        if (!RICH_ALLOWED_TAGS[tag]) {
          const promoted = Array.prototype.slice.call(child.childNodes);
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          promoted.forEach(function (grandchild) { processNode(node, grandchild); });
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
    }
    function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        processNode(node, child);
      });
    }
    walk(tmp);
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
    // maxChars: valgfri, håndhevet tegngrense på SYNLEG tekst (ikkje HTML-
    // markup) — brukt for kort tekst som skal halde seg innanfor ei fast
    // visuell høgd (t.d. tjenestekort), i staden for å klippe stille ved
    // visning utan at nokon kan sjå/rette det att. Telljar oppdaterast live
    // av bindRichTextFields() i core.js.
    const counter = o.maxChars
      ? `<p class="rtfield__counter field__hint" data-rtfield-counter data-max="${esc(o.maxChars)}">0/${esc(o.maxChars)} tegn</p>`
      : "";
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
        ${counter}
        <input type="hidden" id="${id}" value="${esc(sanitizeRichHtml(o.value || ""))}">
      </div>`;
  }

  // Knapp som veksler eit passordfelt mellom skjult og vist tekst. Bindes
  // delegert, ein gong globalt, i core.js sin bindPasswordToggles().
  function passwordToggle() {
    return `<button type="button" class="pw-toggle" data-pw-toggle aria-label="Vis passord" aria-pressed="false">
      <i class="ti ti-eye" aria-hidden="true"></i>
    </button>`;
  }

  // Generelt skjemafelt (brukes både på kontaktskjema og i admin).
  function field(opts) {
    const o = opts || {};
    const id = esc(o.id);
    const isPassword = !o.multiline && o.type === "password";
    const input = `<input id="${id}" name="${id}" type="${o.type || "text"}" ${o.required ? "required" : ""} placeholder="${esc(o.placeholder || "")}" value="${esc(o.value || "")}">`;
    const control = o.multiline
      ? `<textarea id="${id}" name="${id}" rows="${o.rows || 5}" ${o.required ? "required" : ""} placeholder="${esc(o.placeholder || "")}">${esc(o.value || "")}</textarea>`
      : (isPassword ? `<div class="pw-field">${input}${passwordToggle()}</div>` : input);
    return `<div class="field">
      <label for="${id}">${esc(o.label)}${o.help ? " " + helpIcon(o.help) : ""}</label>
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

  // Hjem/Om oss/Tjenester — flytta til template-klassisk.js (Design-modul/
  // "sidebygger", Fase 0, sjå ROADMAP.md). Desse tre held fram som tynne
  // vidaresendarar til "klassisk"-malen sitt register, IKKJE fordi dei
  // vel kva mal som er aktiv for ein gjeven kunde (den avgjerda skal
  // components.js ALDRI ta — sjå CLAUDE.md sitt "components.js: pure
  // functions... never customer-specific"-prinsipp), men reint for
  // bakoverkompatibilitet dersom noko framleis kallar C.hero()/C.about()/
  // C.services() direkte. Sjølve mal-valet (content.designTemplate) vert
  // løyst i core.js sin registerBuiltinSections(), som kallar det valde
  // malobjektet sine hero/about/services-funksjonar direkte i staden for
  // desse tre når ein annan mal enn "klassisk" er aktiv.
  function hero(d) {
    var t = window.SiteTemplates && window.SiteTemplates.klassisk;
    return t ? t.hero(d) : "";
  }
  function about(d) {
    var t = window.SiteTemplates && window.SiteTemplates.klassisk;
    return t ? t.about(d) : "";
  }
  function services(d) {
    var t = window.SiteTemplates && window.SiteTemplates.klassisk;
    return t ? t.services(d) : "";
  }

  /* --- Sidebygger-seksjonar (Fase 1, Console-only) --------------------------
     Reine funksjonar, prefiks pb* -- skil klårt frå hero()/about()/services()
     sine CFG/content-drivne datastrukturar for dei faste forsideseksjonane
     over. Kvar seksjon har forma { id, type, variant:{background,width,
     spacing,align}, data } -- sjå module-page-builder.js for lagringsskjemaet.
     pageSection() er einaste offentlege inngangspunkt; dei typespesifikke
     pb*-funksjonane under er interne detaljar, ikkje meint kalla direkte. */

  function pbVariantClass(variant) {
    var v = variant || {};
    var bg = ["light", "dark", "branded"].indexOf(v.background) !== -1 ? v.background : "light";
    var width = v.width === "narrow" ? "narrow" : "wide";
    var spacing = ["small", "normal", "large"].indexOf(v.spacing) !== -1 ? v.spacing : "normal";
    var align = v.align === "center" ? "center" : "left";
    return "pb-sect--bg-" + bg + " pb-sect--w-" + width + " pb-sect--sp-" + spacing + " pb-sect--al-" + align;
  }

  function pbHero(d) {
    var img = d.image && d.image.src ? d.image : null;
    return (
      '<div class="pb-hero' + (img ? " has-image" : "") + '">' +
        (img ? coverImg(img, "pb-hero__img") : "") +
        '<div class="pb-hero__body">' +
          (d.heading ? '<h2 class="pb-hero__title">' + esc(d.heading) + '</h2>' : "") +
          (d.text ? '<p class="pb-hero__text">' + esc(d.text) + '</p>' : "") +
          (d.button && d.button.label && d.button.url ? button({ label: d.button.label, href: d.button.url, variant: "primary" }) : "") +
        '</div>' +
      '</div>'
    );
  }

  function pbText(d) {
    return (
      '<div class="pb-text">' +
        (d.heading ? '<h2 class="pb-text__title">' + esc(d.heading) + '</h2>' : "") +
        '<div class="prose">' + sanitizeRichHtml(d.text || "") + '</div>' +
      '</div>'
    );
  }

  function pbImageText(d) {
    var img = d.image && d.image.src ? d.image : null;
    var pos = d.imagePosition === "right" ? "right" : "left";
    return (
      '<div class="pb-imgtext pb-imgtext--' + pos + '">' +
        (img ? coverImg(img, "pb-imgtext__img") : "") +
        '<div class="pb-imgtext__body">' +
          (d.heading ? '<h2 class="pb-imgtext__title">' + esc(d.heading) + '</h2>' : "") +
          '<div class="prose">' + sanitizeRichHtml(d.text || "") + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function pbBigImage(d) {
    if (!d.image || !d.image.src) return "";
    return (
      '<div class="pb-bigimage">' +
        coverImg(d.image, "pb-bigimage__img") +
        (d.caption ? '<p class="pb-bigimage__caption">' + esc(d.caption) + '</p>' : "") +
      '</div>'
    );
  }

  function pbQuote(d) {
    if (!d.text) return "";
    return (
      '<blockquote class="pb-quote">' +
        '<p class="pb-quote__text">' + esc(d.text) + '</p>' +
        (d.author ? '<footer class="pb-quote__author">' + esc(d.author) + (d.role ? ' <span class="pb-quote__role">' + esc(d.role) + '</span>' : "") + '</footer>' : "") +
      '</blockquote>'
    );
  }

  // Den generaliserte arbeidshesten: 1-4 kolonnar, kvar rute har UAVHENGIG
  // valfritt bilete/overskrift/tekst/knapp. Ingen tilsett-/stillings-
  // spesifikke felt her med vilje -- same mekanisme dekker tilsattkort,
  // tenestekort, biletgalleri, referansar, sertifiseringar, "kvifor oss"-
  // punkt osv., berre med ulikt innhald og kolonnetal.
  function pbGrid(d) {
    var cols = [1, 2, 3, 4].indexOf(d.columns) !== -1 ? d.columns : 3;
    var items = (d.items || []).map(function (item) {
      var img = item.image && item.image.src ? item.image : null;
      return (
        '<article class="pb-grid__item">' +
          (img ? coverImg(img, "pb-grid__img") : "") +
          '<div class="pb-grid__body">' +
            (item.heading ? '<h3 class="pb-grid__title">' + esc(item.heading) + '</h3>' : "") +
            (item.text ? '<p class="pb-grid__text">' + esc(item.text) + '</p>' : "") +
            (item.button && item.button.label && item.button.url ? button({ label: item.button.label, href: item.button.url, variant: "ghost" }) : "") +
          '</div>' +
        '</article>'
      );
    }).join("");
    return '<div class="pb-grid pb-grid--cols-' + cols + '">' + items + '</div>';
  }

  function pbCta(d) {
    return (
      '<div class="pb-cta">' +
        (d.heading ? '<h2 class="pb-cta__title">' + esc(d.heading) + '</h2>' : "") +
        (d.text ? '<p class="pb-cta__text">' + esc(d.text) + '</p>' : "") +
        (d.button && d.button.label && d.button.url ? button({ label: d.button.label, href: d.button.url, variant: "primary" }) : "") +
      '</div>'
    );
  }

  function pbSpacer() {
    return '<div class="pb-spacer"></div>';
  }

  // --- Blokker (9. seksjonstype, 2026-08-12) ---------------------------------
  // Dei 8 seksjonstypane over har kvar sin FASTE datamodell. "blocks" er ein
  // sidestilt, ny type -- ein fri container av små, uavhengig komponerbare
  // mini-blokker (overskrift/tekst/bilete/knapp/kontaktinfo/mellomrom) i eit
  // fast (ikkje fritt) kolonneoppsett. Dei 8 andre typane er UENDRA av dette.

  // Layout-enum -> kolonnetal + CSS-klasse. Lukka enum (ikkje fri breidde) --
  // held fast på "ingen fri pikselplassering"-grensa frå Fase 1. Eksportert
  // (sjå return-lista nedst i fila) slik at console-core.js sin "Kolonne"-
  // veljar bruker NØYAKTIG same kolonnetal-tabell, ikkje ein tredje,
  // sjølvstendig duplisert versjon.
  var PB_BLOCKS_LAYOUTS = {
    "1col":     { cols: 1, cls: "pb-blocks--1col" },
    "2col":     { cols: 2, cls: "pb-blocks--2col" },
    "2col-2-1": { cols: 2, cls: "pb-blocks--2col-2-1" },
    "2col-1-2": { cols: 2, cls: "pb-blocks--2col-1-2" },
    "3col":     { cols: 3, cls: "pb-blocks--3col" },
    "4col":     { cols: 4, cls: "pb-blocks--4col" }
  };
  function pbBlocksLayout(layout) {
    return PB_BLOCKS_LAYOUTS[layout] || PB_BLOCKS_LAYOUTS["1col"];
  }

  function pbBlockHeading(d) {
    if (!d.text) return "";
    var level = d.level === "h3" ? "h3" : "h2";
    return `<${level} class="pb-block-heading pb-block-heading--${level}">${esc(d.text)}</${level}>`;
  }
  function pbBlockRichtext(d) {
    if (!d.text) return "";
    return `<div class="pb-block-richtext prose">${sanitizeRichHtml(d.text)}</div>`;
  }
  function pbBlockImage(d) {
    const img = d.image && d.image.src ? d.image : null;
    if (!img) return "";
    return `<div class="pb-block-image">${coverImg(img, "pb-block-image__img")}</div>`;
  }
  // Security Auditor-funn (BLOCKER, 2026-08-12): button() sin `cls`-streng
  // (bygd av `variant`) vert ALDRI esc()-a -- kvar ANNAN eksisterande
  // button()-kallar i denne fila sender ein hardkoda bokstaveleg variant, så
  // dette var aldri eit problem før. d.variant her er derimot lagra
  // operatør-data (og broker sin set_config validerer ALDRI forma på
  // custom-pages server-side, så eit vondsinna JSON-kall utanom sjølve UI-en
  // kunne setje `variant` til kva som helst) -- eit `variant`-attributtbrot-
  // forsøk ville brote ut av class-attributtet på det ekte, USANDBOKSA
  // offentlege sida (til skilnad frå Console sin sandboksa iframe-
  // førehandsvisning). Same kvite-liste-mønster som d.kind (pbBlockContactItem)
  // og d.level (pbBlockHeading) alt bruker over.
  function pbBlockButton(d) {
    if (!d.label || !d.url) return "";
    const variant = ["primary", "secondary", "ghost"].indexOf(d.variant) !== -1 ? d.variant : "primary";
    return `<div class="pb-block-button">${button({ label: d.label, href: d.url, variant: variant })}</div>`;
  }
  // kind: "phone"|"email"|"address"|"custom". Href for phone/email er ALLTID
  // utleia frå `kind`, ALDRI eit fritt href-felt frå operatøren -- verdien
  // vert limt inn ETTER den harde skjema-prefiksen ("tel:"/"mailto:"), så
  // heile URI-en sitt FAKTISKE skjema er alltid tel/mailto, same kva
  // operatøren skriv i `value` (t.d. ein "javascript:..."-verdi vert berre
  // "tel:javascript:...", eit ugyldig/ufarleg telefonnummer, aldri eit
  // eksekverbart skjema). Ingen ny href-saneringsflate ved sida av button().
  var PB_CONTACT_ICONS = { phone: "phone", email: "mail", address: "map-pin", custom: "user" };
  function pbBlockContactItem(d) {
    if (!d.value) return "";
    const kind = ["phone", "email", "address", "custom"].indexOf(d.kind) !== -1 ? d.kind : "custom";
    const labelHtml = d.label ? `<strong class="pb-block-contact__label">${esc(d.label)}</strong> ` : "";
    const valueHtml = kind === "phone"
      ? `<a href="tel:${esc(d.value)}">${esc(d.value)}</a>`
      : kind === "email"
      ? `<a href="mailto:${esc(d.value)}">${esc(d.value)}</a>`
      : `<span>${esc(d.value)}</span>`;
    return `<div class="pb-block-contact">${icon(PB_CONTACT_ICONS[kind])}${labelHtml}${valueHtml}</div>`;
  }
  function pbBlockSpacer() {
    return '<div class="pb-block-spacer"></div>';
  }

  var PB_BLOCK_RENDERERS = {
    heading: pbBlockHeading, richtext: pbBlockRichtext, image: pbBlockImage,
    button: pbBlockButton, "contact-item": pbBlockContactItem, spacer: pbBlockSpacer
  };

  // Generalisert blokk-container -- 1-4 kolonnar ("slots"), kvar slot kan
  // stable FLEIRE, ulikt-typa blokker (stabla vertikalt i array-rekkjefølgje).
  // Ukjend blokktype (eller ein renderer som gjev tom streng) vert stille
  // utelaten -- same versjonsskeivskap-prinsipp som pageSection() sjølv nedst
  // i fila. Ein ugyldig/for høg `slot`-verdi (t.d. lagra då layout hadde
  // fleire kolonnar enn no) vert klemt til siste gyldige kolonne, ikkje
  // forkasta -- ei innhaldsblokk skal aldri forsvinne stille pga. eit seinare
  // layout-val.
  function pbBlocks(d) {
    const layout = pbBlocksLayout(d.layout);
    const slots = [];
    for (let i = 0; i < layout.cols; i++) slots.push([]);
    (d.blocks || []).forEach(function (b) {
      if (!b || !b.type || !PB_BLOCK_RENDERERS[b.type]) return;
      let html = PB_BLOCK_RENDERERS[b.type](b.data || {});
      if (!html) return;
      // Brukarønske 2026-08-12: valfri ramme (bakgrunn+kant) rundt kvar
      // blokk -- same visuelle handsaming som .pb-grid__item, sentralisert
      // her (éin stad) i staden for at kvar einskild pbBlock*-funksjon må
      // implementere ramme-innpakking sjølv.
      if (b.data && b.data.frame) html = `<div class="pb-block--framed">${html}</div>`;
      const slotIdx = Math.min(Math.max(0, parseInt(b.slot, 10) || 0), layout.cols - 1);
      slots[slotIdx].push(html);
    });
    const slotsHtml = slots.map(function (s) { return `<div class="pb-blocks__slot">${s.join("")}</div>`; }).join("");
    return `<div class="pb-blocks ${layout.cls}">${slotsHtml}</div>`;
  }

  var PB_RENDERERS = {
    hero: pbHero, text: pbText, "image-text": pbImageText, "big-image": pbBigImage,
    quote: pbQuote, grid: pbGrid, cta: pbCta, spacer: pbSpacer, blocks: pbBlocks
  };

  // Dispatcher -- einaste offentlege inngangspunkt for sidebygger-seksjonar.
  // Returnerer "" for ein ukjend type (versjonsskeivskap-tryggleik: ein
  // besøkjande med gamal cacha components.js skal aldri krasje eller vise
  // rå/uforklart innhald for ein seksjonstype lagt til etter deira siste
  // cache-bust -- berre stille utelate den eine seksjonen).
  function pageSection(s) {
    if (!s || !s.type || !PB_RENDERERS[s.type]) return "";
    var body = PB_RENDERERS[s.type](s.data || {});
    if (!body) return "";
    return '<section id="' + esc(s.id || "") + '" class="pb-sect ' + pbVariantClass(s.variant) + '">' +
      '<div class="pb-sect__inner">' + body + '</div>' +
    '</section>';
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
    { key: "x",         label: "X",         icon: "brand-x" }
  ];

  // Kontakt (skjema + info)
  function contact(d, info) {
    // Normaliser social: migrer gammal "twitter"-nøkkel til "x", fjern alltid twitter
    const socialData = Object.assign({}, info.social || {});
    if (socialData.twitter && !socialData.x) { socialData.x = socialData.twitter; }
    delete socialData.twitter;
    const social = SOCIAL_PLATFORMS
      .filter(function (p) { return socialData[p.key]; })
      .map(function (p) { return `<a href="${esc(socialData[p.key])}" target="_blank" rel="noopener" title="${esc(p.label)}" aria-label="${esc(p.label)}" class="contact__social-link">${icon(p.icon)}</a>`; });
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
          ${(window.SITE_CONFIG && window.SITE_CONFIG.features && window.SITE_CONFIG.features.contactForm === false) ? "" : `
          <form class="contact__form" data-contact-form novalidate>
            ${field({ id: "lead-name",    label: "Navn",    required: true,  placeholder: "Ditt navn" })}
            ${field({ id: "lead-email",   label: "E-post",  required: true,  type: "email", placeholder: "deg@eksempel.no" })}
            ${field({ id: "lead-message", label: "Melding", required: true,  multiline: true, placeholder: "Hva kan vi hjelpe med?" })}
            ${termsField({ idPrefix: "lead" })}
            ${consentPurposesField({ idPrefix: "lead", formType: "kontakt" })}
            <div class="contact__actions">
              ${button({ label: "Send melding", type: "submit", variant: "primary" })}
              ${(window.SITE_CONFIG && window.SITE_CONFIG.features && window.SITE_CONFIG.features.quote !== false)
                ? button({ label: "Be om tilbud", href: "#tilbud", variant: "ghost" })
                : ""}
            </div>
            <p class="form__status" data-form-status role="status" aria-live="polite"></p>
          </form>`}
        </div>
      </section>`;
  }

  // Footer (trippelklikk her åpner admin når aktivert i config)
  function footer(opts) {
    const o = opts || {};
    const f = o.footer || {};
    const year = o.year || new Date().getFullYear();
    // f.copyright er eit fritekstfelt redigerbart av rolla "editor" (core.js
    // allowedCategoriesForRole) og vart tidlegare sett inn RÅTT i innerHTML --
    // ein lagra XSS synleg for ALLE besøkjande på det offentlege nettstaden,
    // ikkje berre i eit admin-panel. Funne av Codex-gjennomgangen 2026-07-18.
    const copyright = f.copyright ? esc(f.copyright) : ("© " + year + " " + esc(o.name || ""));

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

  // o.fullscreenToggle: valfri fullskjerm-knapp i modal__head (brukt av
  // adminpanelet, sjå core.js sin renderAdminPanel() -- IKKJE av dei to
  // innloggingsmodalane som deler same modal()-funksjon, sidan dei ikkje
  // treng/sender dette flagget). o.isFullscreen styrer kva ikon/tittel
  // knappen syner (staten sjølv held til i core.js, ikkje her).
  function modal(opts) {
    const o = opts || {};
    const fsBtn = o.fullscreenToggle
      ? `<button class="modal__fullscreen-toggle" data-modal-fullscreen-toggle aria-label="${o.isFullscreen ? "Gå ut av fullskjerm" : "Vis i fullskjerm"}" title="${o.isFullscreen ? "Gå ut av fullskjerm" : "Vis i fullskjerm"}">${icon(o.isFullscreen ? "arrows-minimize" : "arrows-maximize")}</button>`
      : "";
    // o.helpToggle: valfri "?"-knapp i modal__head, ved sida av fullskjerm-
    // knappen (brukt av admin-panelet sin modulbaserte brukarrettleiing,
    // 2026-08-03) -- same opt-in-mønster som fullscreenToggle, ingen andre
    // kallarar sender han i dag.
    const helpBtn = o.helpToggle
      ? `<button class="modal__help-toggle" data-modal-help-toggle aria-label="Brukerveiledning" title="Brukerveiledning">${icon("help")}</button>`
      : "";
    return `
      <div class="modal${o.isFullscreen ? " is-fullscreen" : ""}" data-modal role="dialog" aria-modal="true" aria-label="${esc(o.label || "Dialog")}">
        <div class="modal__backdrop" data-modal-close></div>
        <div class="modal__panel modal__panel--admin">
          <div class="modal__head">
            <h2 class="modal__title">${esc(o.title)}</h2>
            <div style="display:flex;align-items:center">
              ${helpBtn}
              ${fsBtn}
              <button class="modal__close" data-modal-close aria-label="Lukk">${icon("x")}</button>
            </div>
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
    esc, icon, button, eyebrow, field, passwordToggle, termsField, consentPurposesField, richTextField, sanitizeRichHtml, stripHtml, formatDate, image, coverImg, imageField, creditBadge, helpIcon, SOCIAL_PLATFORMS,
    fileIcon, formatBytes, truncate, paragraphs,
    nav, hero, about, services, news, newsPost, articleView, archiveView, simpleView,
    contact, footer, modal, tabbar,
    pageSection, pbBlocksLayout
  };
})();
