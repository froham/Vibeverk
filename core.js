/* =============================================================================
   core.js  —  ALL LOGIKK (motoren)
   -----------------------------------------------------------------------------
   Leser config.js, bygger siden av komponentene i components.js, håndterer
   tema, ruting, kontaktskjema og admin-panel.

   VIKTIG: Denne filen skal aldri endres per kunde. Alt kundespesifikt leses
   fra window.SITE_CONFIG. Nye seksjoner/moduler legges til UTENFOR denne filen
   via App.registerModule(...) — se bunnen for hvordan standardseksjonene gjøres.
   ========================================================================== */

window.App = (function () {

  const CFG = window.SITE_CONFIG;   // ← all kundekonfig
  const C   = window.Components;    // ← gjenbrukbare komponenter
  const NS  = CFG.storageKey || "site";   // ← localStorage-prefiks fra config

  // ─── TIDLEG SUPERCONFIG-OVERRIDE ──────────────────────────────────────────
  // Må køyre HER, før modulane lèser CFG.features i sine eigne IIFE-ar.
  // Store-abstraksjonen er ikkje klar enno, so vi les direkte frå localStorage.
  (function earlyApplySuperConfig() {
    try {
      const raw = localStorage.getItem(NS + ":superconfig");
      if (!raw) return;
      const sc = JSON.parse(raw);
      if (sc.features && CFG.features) Object.assign(CFG.features, sc.features);
      if (sc.intranettFeatures && CFG.intranettFeatures) Object.assign(CFG.intranettFeatures, sc.intranettFeatures);
      if (sc.company  && CFG.company)  Object.assign(CFG.company,  sc.company);
      if (sc.colors   && CFG.colors)   Object.assign(CFG.colors,   sc.colors);
      if (sc.fonts    && CFG.fonts)    Object.assign(CFG.fonts,     sc.fonts);
      if (sc.adminPassword && CFG.admin) CFG.admin.password = sc.adminPassword;
    } catch (e) { /* localStorage utilgjengeleg */ }
  })();
  // ──────────────────────────────────────────────────────────────────────────

  /* ===========================================================================
     1) LAGRINGSLAG
     ---------------------------------------------------------------------------
     Abstraksjon over localStorage. Når Supabase kommer, byttes kun innmaten i
     disse fire metodene — resten av koden rører man ikke.
     ======================================================================== */
  const Store = {
    _key: function (name) { return NS + ":" + name; },
    get: function (name, fallback) {
      try {
        const raw = localStorage.getItem(this._key(name));
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (name, value) {
      try { localStorage.setItem(this._key(name), JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    remove: function (name) { try { localStorage.removeItem(this._key(name)); } catch (e) {} }
  };

  /* ===========================================================================
     1b) MEDIA-LAG  (bilder)
     ---------------------------------------------------------------------------
     I demo lagres opplastede bilder som nedskalerte data-URL-er i localStorage,
     under egne nøkler ("media:..."), slik at innholdet bare bærer en REFERANSE
     og ikke selve bytene. Et bildefelt holder enten en slik referanse eller en
     vanlig URL — begge ender som en src-streng via Media.resolve().

     Når Supabase kommer byttes kun Media.put() (last opp → få URL tilbake);
     resten av koden rører man ikke. localStorage er ~5 MB, så vi krymper bilder
     før lagring for å holde oss innenfor.
     ======================================================================== */
  const Media = {
    MAX_DIM: 1400,        // største kant i piksler etter nedskalering
    QUALITY: 0.82,        // JPEG-kvalitet

    // file (File) → Promise<string ref "media:...">
    put: function (file) {
      const self = this;
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onerror = function () { reject(new Error("read")); };
        reader.onload = function () {
          const img = new Image();
          img.onerror = function () { reject(new Error("decode")); };
          img.onload = function () {
            let w = img.width, h = img.height;
            const m = self.MAX_DIM;
            if (w > m || h > m) { const s = m / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL("image/jpeg", self.QUALITY);
            const ref = "media:" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
            if (!Store.set(ref, dataUrl)) { reject(new Error("quota")); return; }  // localStorage full
            resolve(ref);
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    },

    // Gjør en lagret verdi om til noe <img src> forstår.
    resolve: function (value) {
      if (!value) return "";
      if (value.indexOf("media:") === 0) return Store.get(value, "") || "";
      return value;   // vanlig URL
    },

    // Frigjør plass når et opplastet bilde fjernes/erstattes. Tåler både
    // { src, pos }-objekt og ren streng.
    free: function (value) {
      const src = (value && typeof value === "object") ? value.src : value;
      if (src && src.indexOf("media:") === 0) Store.remove(src);
    },

    // Et bilde lagres som { src, pos, caption, creditType, alt } der pos er
    // object-position/background-position (fokuspunkt for beskjæring), caption
    // er selve merketeksten, creditType er "ai" | "copyright" | "" (enten/eller —
    // styrer hvilken liten badge som vises), og alt er bildebeskrivelse for
    // skjermlesere/SEO. Eldre data normaliseres her: en streng blir et tomt
    // bilde-objekt, og gammel data med kun caption (fra tiden det bare fantes
    // én KI-avhuking) regnes som creditType "ai".
    norm: function (v) {
      if (!v) return { src: "", pos: "50% 50%", caption: "", creditType: "", alt: "" };
      if (typeof v === "string") return { src: v, pos: "50% 50%", caption: "", creditType: "", alt: "" };
      const creditType = v.creditType || (v.caption ? "ai" : "");
      return { src: v.src || "", pos: v.pos || "50% 50%", caption: v.caption || "", creditType: creditType, alt: v.alt || "" };
    },

    // Som norm(), men med src oppløst til noe <img>/background forstår.
    resolveImage: function (v) {
      const n = this.norm(v);
      return { src: this.resolve(n.src), pos: n.pos, caption: n.caption, creditType: n.creditType, alt: n.alt };
    },

    /* --- Vedlegg (vilkårlige filer) ---------------------------------------
       I demo lagres opplastede filer som data-URL under "file:"-nøkler, med
       navn/type. Innlegget bærer bare en referanse { name, ref, type, size }.
       Kan ikke krympes som bilder, så vi setter en størrelsesgrense for demo.
       Byttes til Supabase Storage senere — kun putFile() endres.            */
    MAX_FILE_MB: 4,
    putFile: function (file) {
      const self = this;
      return new Promise(function (resolve, reject) {
        if (file.size > self.MAX_FILE_MB * 1024 * 1024) { reject(new Error("size")); return; }
        const reader = new FileReader();
        reader.onerror = function () { reject(new Error("read")); };
        reader.onload = function () {
          const ref = "file:" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
          if (!Store.set(ref, { name: file.name, type: file.type, dataUrl: reader.result })) {
            reject(new Error("quota")); return;
          }
          resolve({ name: file.name, ref: ref, type: file.type, size: file.size });
        };
        reader.readAsDataURL(file);
      });
    },
    // Referanse → nedlastbar href (data-URL for opplastet fil, ellers URL-en selv).
    resolveFile: function (ref) {
      if (!ref) return "";
      if (ref.indexOf("file:") === 0) { const r = Store.get(ref, null); return r ? r.dataUrl : ""; }
      return ref;
    },
    freeFile: function (ref) { if (ref && ref.indexOf("file:") === 0) Store.remove(ref); }
  };

  /* ===========================================================================
     2) INNHOLDS-TILSTAND
     ---------------------------------------------------------------------------
     Redigerbart innhold seedes fra config og overstyres av det admin har lagret.
     ======================================================================== */
  let content = {};
  function loadContent() {
    const overrides = Store.get("content", {}) || {};
    content = {
      // ← seedet fra config.hero, kan overstyres i admin (inkl. bilde + fokuspunkt)
      hero: Object.assign({
        title: CFG.hero.title, subtitle: CFG.hero.subtitle, image: CFG.hero.image || ""
      }, overrides.hero || {}),
      // ← seedet fra config.about (tekst + valgfritt bilde)
      about: Object.assign({
        text: CFG.about.text, image: CFG.about.imageUrl || ""
      }, overrides.about || {}),
      // ← seedet fra config.contact (+ egendefinerte felter, redigerbart i admin)
      contact: Object.assign({
        email: CFG.contact.email, phone: CFG.contact.phone, address: CFG.contact.address,
        extra: (CFG.contact.extra || []).slice(),
        social: Object.assign({}, CFG.contact.social || {})
      }, overrides.contact || {}),
      // ← seedet fra config.news.posts første gang, deretter fullt admin-styrt
      news: overrides.news || (CFG.news.posts || []).slice(),
      // ← seedet fra config.services.cards første gang, deretter fullt admin-styrt.
      //    Tildeler stabil id slik at rediger/slett fungerer trygt.
      services: (overrides.services || (CFG.services.cards || [])).map(function (c, i) {
        return { id: c.id || ("svc-" + i), icon: c.icon, title: c.title, text: c.text, image: c.image || "" };
      }),
      // ← seedet fra config.footer, redigerbart i admin
      footer: Object.assign({
        orgNr: "", invoiceAddress: "", invoiceEmail: "", copyright: "", extraLines: []
      }, CFG.footer || {}, overrides.footer || {})
    };
    // Normaliser alle bilder til { src, pos } (også eldre strengverdier)
    content.hero.image = Media.norm(content.hero.image);
    content.about.image = Media.norm(content.about.image);
    content.services.forEach(function (c) { c.image = Media.norm(c.image); });
    content.news.forEach(function (p) { p.image = Media.norm(p.image); p.attachments = p.attachments || []; });
  }
  function saveContent() { Store.set("content", content); }

  // Leads (innsendte kontaktskjema)
  function getLeads() { return Store.get("leads", []) || []; }
  function saveLeads(list) { Store.set("leads", list); }
  // Lagre en innsendt henvendelse (brukes av kontaktskjemaet og av moduler).
  function addLead(lead) {
    lead = lead || {};
    const leads = getLeads();
    const refNums = leads.map(function (l) { return l.referenceNumber; }).filter(Boolean);
    leads.unshift({
      id: "lead-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      name: lead.name || "", email: lead.email || "", message: lead.message || "",
      time: new Date().toISOString(),
      status: "ny",   // ny → lest → løst
      referenceNumber: generateUniqueNumber(refNums)
    });
    saveLeads(leads);
  }

  /* ===========================================================================
     3) MODULREGISTER
     ---------------------------------------------------------------------------
     Hver seksjon — også standardseksjonene — registreres som en modul.
     En ny modul (booking, kalkulator, ...) legges til i en EGEN js-fil som
     lastes etter core.js og kaller App.registerModule({...}). Da dukker den
     opp i menyen og på siden uten at denne filen røres.

       App.registerModule({
         id:    "booking",            // seksjons-id (#booking) og nav-anker
         label: "Booking",            // menytekst (utelat for å skjule fra meny)
         order: 45,                   // plassering i meny/side (kontakt = 50)
         render: function () { return "<section id='booking'>…</section>"; },
         mount:  function (root) {},  // valgfri: kjøres etter at HTML er satt inn
         admin:  {                    // valgfri: egen fane i admin-panelet
           label: "Booking",
           render: function () { return "…skjema…"; },
           mount: function (body) {}
         }
       });
     ======================================================================== */
  const modules = [];
  let started = false;

  function registerModule(def) {
    if (!def || !def.id || (typeof def.render !== "function" && typeof def.renderPage !== "function")) {
      console.warn("[App] Ugyldig modul ignorert:", def);
      return;
    }
    if (modules.some(function (m) { return m.id === def.id; })) {
      console.warn("[App] Modul med id finnes allerede:", def.id);
      return;
    }
    def.order = (typeof def.order === "number") ? def.order : 60; // nye moduler etter kontakt som standard
    modules.push(def);
    if (started) render();   // last inn på nytt hvis siden allerede er bygget
  }

  function orderedModules() {
    return modules.slice().sort(function (a, b) { return a.order - b.order; });
  }

  /* ===========================================================================
     4) TEMA  (farger + fonter fra config)
     ======================================================================== */
  function applyTheme() {
    const root = document.documentElement.style;
    const col = CFG.colors || {};
    // ← Fargepalett fra config.colors. Øvrige nyanser utledes i CSS via color-mix.
    if (col.primary)    root.setProperty("--color-primary", col.primary);
    if (col.secondary)  root.setProperty("--color-secondary", col.secondary);
    if (col.background) root.setProperty("--color-bg", col.background);
    // Valgfrie overstyringer
    if (col.text)    root.setProperty("--color-text", col.text);
    if (col.muted)   root.setProperty("--color-muted", col.muted);
    if (col.surface) root.setProperty("--color-surface", col.surface);
    if (col.border)  root.setProperty("--color-border", col.border);

    // ← Fonter fra config.fonts
    const f = CFG.fonts || {};
    if (f.display) root.setProperty("--font-display", `"${f.display}", system-ui, sans-serif`);
    if (f.body)    root.setProperty("--font-body", `"${f.body}", system-ui, sans-serif`);
    injectGoogleFonts(f);

    // Sidetittel
    document.title = CFG.company.name + (CFG.company.tagline ? " — " + CFG.company.tagline : "");
    applyMeta();
  }

  // Finn-eller-lag ein <meta>-tag identifisert av attrName="attrValue", og sett content.
  function setMetaTag(attrName, attrValue, contentValue) {
    if (!contentValue) return;
    let el = document.querySelector('meta[' + attrName + '="' + attrValue + '"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attrName, attrValue);
      document.head.appendChild(el);
    }
    el.setAttribute("content", contentValue);
  }

  // Meta-beskrivelse, Open Graph/Twitter-card-tagger og favicon — alt satt fra
  // config.company (kun redigerbart i super-admin, siden dette er oppsett Vibeverk
  // gjør, ikke noe kunden trenger å tenke på i den enkle admin-en).
  function applyMeta() {
    const com = CFG.company || {};
    const title = com.name + (com.tagline ? " — " + com.tagline : "");
    setMetaTag("property", "og:title", title);
    setMetaTag("name", "twitter:title", title);
    if (com.metaDescription) {
      setMetaTag("name", "description", com.metaDescription);
      setMetaTag("property", "og:description", com.metaDescription);
      setMetaTag("name", "twitter:description", com.metaDescription);
    }
    if (com.ogImage) {
      setMetaTag("property", "og:image", com.ogImage);
      setMetaTag("name", "twitter:image", com.ogImage);
      setMetaTag("name", "twitter:card", "summary_large_image");
    }
    setMetaTag("property", "og:type", "website");
    if (com.favicon) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) { link = document.createElement("link"); link.setAttribute("rel", "icon"); document.head.appendChild(link); }
      link.setAttribute("href", com.favicon);
    }
  }

  function injectGoogleFonts(f) {
    if (!f || (!f.display && !f.body)) return;
    const families = [];
    const weights = f.weights || {};
    if (f.display) families.push(fontFamilyParam(f.display, weights.display || [400, 700]));
    if (f.body && f.body !== f.display) families.push(fontFamilyParam(f.body, weights.body || [400, 600]));
    const href = "https://fonts.googleapis.com/css2?" + families.join("&") + "&display=swap";
    let link = document.getElementById("app-fonts");
    if (!link) {
      link = document.createElement("link");
      link.id = "app-fonts";
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = href;
  }
  function fontFamilyParam(name, weights) {
    return "family=" + encodeURIComponent(name).replace(/%20/g, "+") +
           ":wght@" + (weights || [400]).join(";");
  }

  /* ===========================================================================
     5) RENDERING
     ======================================================================== */
  // Feature-flagg fra config. Mangler flagget → på som standard.
  function feat(name) { return !(CFG.features && CFG.features[name] === false); }

  // Innlegg med bilder/vedlegg oppløst for visning (vedlegg kun hvis aktivert).
  function resolvedPosts() {
    return content.news.map(function (p) {
      return Object.assign({}, p, {
        image: Media.resolveImage(p.image),
        attachments: feat("attachments")
          ? (p.attachments || []).map(function (a) {
              return { name: a.name, type: a.type, size: a.size, href: Media.resolveFile(a.ref) };
            })
          : []
      });
    });
  }

  /* ===========================================================================
     5) RENDERING & RUTING
     ---------------------------------------------------------------------------
     Hash-ruting holder siden som én fil, men gir delbare adresser og fungerende
     tilbake-knapp for artikkel-/arkivvisning:
       (ingen / #seksjon) → forsiden (one-pager), scroller til seksjonen
       #sak/<id>          → ett aktuelt-innlegg (full tekst)
       #aktuelt/alle      → arkiv (alle saker + søk)
       #admin             → adminpanel
     ======================================================================== */
  let currentView = "home";
  let pendingContact = null;   // melding som forhåndsutfylles i kontaktskjemaet

  // Gjenbrukbar krok: forhåndsutfyll kontaktskjemaet og hopp til kontaktseksjonen.
  // Brukes av moduler (f.eks. booking) uten at de rører basekoden.
  function prefillContact(message) {
    pendingContact = message || "";
    if (location.hash === "#kontakt") { renderMain(); }
    else { location.hash = "#kontakt"; }   // hashchange → forsiden + scroll + utfylling
  }

  function route() {
    const h = (location.hash || "").replace(/^#/, "");
    if (h.indexOf("sak/") === 0) return { view: "sak", id: h.slice(4) };
    if (h === "aktuelt/alle")     return { view: "arkiv" };
    if (h === "admin")            return { view: "home", admin: true };
    // Sub-rute: #moduleid/sub (f.eks. #referanser/rf-123)
    const slash = h.indexOf("/");
    if (slash > 0) {
      const modId = h.slice(0, slash);
      if (modules.some(function (m) { return m.id === modId && m.page; })) {
        return { view: "page", id: modId, sub: h.slice(slash + 1) };
      }
    }
    if (h && modules.some(function (m) { return m.id === h && m.page; })) return { view: "page", id: h };
    return { view: "home", section: h };
  }

  function render() { buildShell(); renderMain(); }

  // Det faste skjelettet (nav + tom main + footer)
  function buildShell() {
    const app = document.getElementById("app");
    if (!app) return;
    const mods = orderedModules();
    const navMods = getNavOrderedMods();
    const navItems = navMods
      .filter(function (m) { return modNavVisible(m); })
      .map(function (m) { return { id: m.id, label: modLabel(m) }; });
    const footerLinks = navMods
      .filter(function (m) { return modFooterVisible(m); })
      .map(function (m) { return { id: m.id, label: modLabel(m), page: !!m.page }; });
    const navHtml = C.nav({
      name:       CFG.company.name,
      logoUrl:    CFG.company.logoUrl,
      items:      navItems,
      showSearch: feat("siteSearch")
    });
    const footerHtml = C.footer({
      name:    CFG.company.name,
      year:    new Date().getFullYear(),
      footer:  Object.assign({}, CFG.footer, content.footer || {}),
      links:   footerLinks,
      privacy: CFG.privacy
    });
    app.innerHTML = navHtml + '<main id="main"></main>' + footerHtml;
    bindMobileNav();
    bindAdminAccess();
    bindTerms(app, "footer-privacy");
    // Søkeknapp
    const searchBtn = app.querySelector("[data-open-search]");
    if (searchBtn) searchBtn.addEventListener("click", openSearch);
  }

  // Fyller <main> ut fra gjeldende rute
  function renderMain() {
    const main = document.getElementById("main");
    if (!main) return;
    const r = route();
    if (r.view === "sak") {
      const post = resolvedPosts().find(function (p) { return p.id === r.id; });
      main.innerHTML = post
        ? C.articleView(post)
        : C.simpleView("Fant ikke saken", "Saken finnes ikke lenger.", "#aktuelt/alle", "Til alle saker");
      setActiveNav("aktuelt");
    } else if (r.view === "arkiv") {
      main.innerHTML = C.archiveView(CFG.news, resolvedPosts(), { search: feat("search") });
      setActiveNav("aktuelt");
    } else if (r.view === "page") {
      const m = modules.find(function (x) { return x.id === r.id; });
      // Støtter dual-mode: renderPage/mountPage for fullside, render/mount for inline
      const pageRender = m && (m.renderPage || m.render);
      const pageMount  = m && (m.mountPage  || m.mount);
      main.innerHTML = pageRender ? pageRender() : "";
      if (typeof pageMount === "function") pageMount(main);
      setActiveNav(r.id);
    } else {
      // Forsiden: alle moduler med render/renderPage, styrt av admin-innstillingar
      const mods = getPageVisibleMods();
      main.innerHTML = mods.map(function (m) { return (m.render || m.renderPage)(); }).join("");
      mods.forEach(function (m) {
        const mount = m.mount || m.mountPage;
        if (typeof mount === "function") mount(main);
      });
    }
    bindMainBehaviors();
  }

  function setActiveNav(id) {
    document.querySelectorAll(".nav__link").forEach(function (l) {
      l.classList.toggle("is-active", l.getAttribute("data-nav") === id);
    });
  }

  /* ===========================================================================
     6) ATFERD  (meny, scroll, reveal, skjema, admin-tilgang)
     ======================================================================== */
  function bindMainBehaviors() {
    bindScrollReveal();
    bindActiveNav();
    bindContactForm();
    bindArchiveSearch();
  }

  // Global klikk-håndtering for ankerlenker (bundet ÉN gang i init).
  // Seksjonsankre på forsiden → myk scroll. Visnings-/admin-ruter → la hash endres
  // (hashchange bygger riktig visning).
  function bindGlobalNav() {
    document.addEventListener("click", function (e) {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute("href").slice(1);
      if (id === "admin" || id.indexOf("sak/") === 0 || id === "aktuelt/alle") return;
      // Module-sider (page:true) og sub-ruter navigerer alltid via hash — ikke scroll
      const baseId = id.indexOf("/") > 0 ? id.slice(0, id.indexOf("/")) : id;
      if (modules.some(function (m) { return m.id === baseId && m.page; })) return;
      const el = document.getElementById(id);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
        history.replaceState(null, "", id ? "#" + id : location.pathname);
      }
    });
  }

  // Mobilmeny av/på
  function bindMobileNav() {
    const header = document.querySelector(".site-header");
    const toggle = document.querySelector(".nav__toggle");
    if (!toggle || !header) return;
    toggle.addEventListener("click", function () {
      const open = header.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
    });
    header.querySelectorAll(".nav__link").forEach(function (a) {
      a.addEventListener("click", function () {
        header.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
      });
    });
  }

  // Søk i arkivet (klient-side filter over titler + tekst)
  function bindArchiveSearch() {
    const input = document.querySelector("[data-archive-search]");
    if (!input) return;
    const list = document.querySelector("[data-archive-list]");
    const empty = document.querySelector("[data-archive-empty]");
    input.addEventListener("input", function () {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      list.querySelectorAll(".archive__item").forEach(function (li) {
        const match = !q || (li.getAttribute("data-search") || "").indexOf(q) > -1;
        li.hidden = !match; if (match) shown++;
      });
      if (empty) empty.hidden = shown > 0;
    });
  }

  // Fade-up når seksjoner kommer til syne (signaturgrep, respekterer reduced motion)
  function bindScrollReveal() {
    const items = document.querySelectorAll(".reveal");
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-visible"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    items.forEach(function (el) { io.observe(el); });
  }

  // Marker aktiv menylenke basert på synlig seksjon
  function bindActiveNav() {
    const sections = document.querySelectorAll("main section[id]");
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          const id = en.target.id;
          document.querySelectorAll(".nav__link").forEach(function (l) {
            l.classList.toggle("is-active", l.getAttribute("data-nav") === id);
          });
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach(function (s) { io.observe(s); });
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* --- Delt vilkår/personvern-popup (kontakt, booking, tilbud) ------------- */
  function bindTerms(container, idPrefix) {
    const openBtn  = container.querySelector(`[data-terms-open="${idPrefix}"]`);
    const closeBtn = container.querySelector(`[data-terms-close="${idPrefix}"]`);
    const modal    = container.querySelector(`[data-terms-modal="${idPrefix}"]`);
    if (!openBtn || !modal) return;
    openBtn.addEventListener("click", function () { modal.style.display = ""; });
    if (closeBtn) closeBtn.addEventListener("click", function () { modal.style.display = "none"; });
    modal.addEventListener("click", function (e) { if (e.target === modal) modal.style.display = "none"; });
  }
  function termsAccepted(container, idPrefix) {
    const cb = container.querySelector(`#${idPrefix}-terms`);
    return !!(cb && cb.checked);
  }

  /* --- Kontaktskjema → lagre lead ------------------------------------------ */
  function bindContactForm() {
    const form = document.querySelector("[data-contact-form]");
    if (!form) return;
    bindTerms(form, "lead");
    // Forhåndsutfylt melding satt av f.eks. booking-modulen (App.prefillContact)
    if (pendingContact) {
      const msg = form.querySelector("#lead-message");
      if (msg) msg.value = pendingContact;
      pendingContact = null;
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const status = form.querySelector("[data-form-status]");
      const name = form.querySelector("#lead-name").value.trim();
      const email = form.querySelector("#lead-email").value.trim();
      const message = form.querySelector("#lead-message").value.trim();

      if (!name || !email || !message) {
        setStatus(status, "Fyll inn navn, e-post og melding.", "error");
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setStatus(status, "Sjekk e-postadressen.", "error");
        return;
      }
      if (!termsAccepted(form, "lead")) {
        setStatus(status, "Du må godta personvernerklæringen for å sende inn.", "error");
        return;
      }

      addLead({ name: name, email: email, message: message });

      form.reset();
      setStatus(status, CFG.contactSection.successMessage, "ok"); // ← config-tekst
    });
  }
  function setStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg;
    el.className = "form__status is-" + (kind || "ok");
  }

  /* ===========================================================================
     7) RUTING  (åpner admin på #admin)
     ======================================================================== */
  function bindAdminAccess() {
    // Trippelklikk på footer (hvis aktivert i config)
    if (CFG.admin && CFG.admin.tripleClickFooter) {
      const footer = document.querySelector("[data-footer]");
      if (footer) {
        let clicks = 0, timer = null;
        footer.addEventListener("click", function () {
          clicks++;
          clearTimeout(timer);
          timer = setTimeout(function () { clicks = 0; }, 600);
          if (clicks >= 3) { clicks = 0; openAdmin(); }
        });
      }
    }
  }
  function handleRoute() {
    if (location.hash === "#admin") { openAdmin(); return; }
    const r = route();
    // Sub-ruter teller som separate visninger
    const vKey = r.view === "page" ? "page:" + r.id + (r.sub ? "/" + r.sub : "") : r.view;
    if (vKey !== currentView) {
      currentView = vKey;
      renderMain();
      if (r.view !== "home" && window.scrollTo) window.scrollTo(0, 0);
    }
    if (r.view === "home" && r.section) {
      const el = document.getElementById(r.section);
      if (el) el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    }
  }

  /* ===========================================================================
     8) ADMIN-PANEL
     ---------------------------------------------------------------------------
     Skjult, passordbeskyttet (felles passord fra config). Redigerer hero/om-oss/
     kontaktinfo, CRUD på aktuelt-innlegg og viser innsendte leads.
     ======================================================================== */
  function getAuthRole() {
    const v = sessionStorage.getItem(NS + ":admin");
    return (v === "owner" || v === "employee") ? v : null;
  }
  function isAuthed() { return !!getAuthRole(); }
  function setAuthed(role) {
    // role: "owner" | "employee" | falsy (logg ut)
    if (role) sessionStorage.setItem(NS + ":admin", role);
    else sessionStorage.removeItem(NS + ":admin");
  }

  // Admin-faner gruppert i tre kategorier, slik at panelet ikke blir uoversiktlig
  // når mange moduler er aktive. Hver modul kan selv si hvilken kategori den
  // hører til via admin.category — default "innhold" hvis ikke angitt.
  const ADMIN_CATEGORIES = [
    { id: "innhold",       label: "Innhold" },
    { id: "henvendelser",  label: "Henvendelser" },
    { id: "innstillinger", label: "Innstillinger" }
  ];
  // «Ansatt»-rolle (valgfritt andre passord) ser kun Henvendelser — det er
  // driftsfanene (Kontakt/Tilbud/Booking/Kunder), ikke innhold eller innstillinger.
  function allowedCategoriesForRole(role) {
    return role === "employee" ? ["henvendelser"] : ["innhold", "henvendelser", "innstillinger"];
  }
  function buildAdminTabs() {
    const tabs = [
      { id: "analyse",    label: "Analyse",    category: "innstillinger" },
      { id: "navigasjon", label: "Navigasjon", category: "innstillinger" },
      { id: "innhold",    label: "Innhold",    category: "innhold" },
      { id: "tjenester",  label: "Tjenester",  category: "innhold" },
      { id: "aktuelt",    label: "Aktuelt",    category: "innhold" }
    ];
    // Innholds-moduler (ikkje henvendelser)
    orderedModules().forEach(function (m) {
      if (m.admin && typeof m.admin.render === "function" && m.admin.category !== "henvendelser") {
        tabs.push({ id: "mod-" + m.id, label: modLabel(m), category: m.admin.category || "innhold" });
      }
    });
    // Henvendelser i fast rekkefølge: Kunder → Booking → Tilbud → Kontakt
    ["crm", "booking", "tilbud"].forEach(function (modId) {
      const m = orderedModules().find(function (m) { return m.id === modId && m.admin && typeof m.admin.render === "function"; });
      if (m) tabs.push({ id: "mod-" + m.id, label: modLabel(m), category: "henvendelser" });
    });
    tabs.push({ id: "leads", label: "Kontakt", category: "henvendelser" });
    tabs.push({ id: "sikkerhetskopi", label: "Sikkerhetskopi", category: "innstillinger" });
    return tabs;
  }

  let activeTab = "innhold";
  let activeCategory = "innhold";

  function openAdmin() {
    closeAdmin(); // unngå dobbel
    const root = document.createElement("div");
    root.id = "admin-root";
    document.body.appendChild(root);
    if (isAuthed()) renderAdminPanel(root);
    else renderAdminLogin(root);
  }
  function closeAdmin() {
    const root = document.getElementById("admin-root");
    if (root) root.remove();
    if (location.hash === "#admin") history.replaceState(null, "", location.pathname + location.search);
  }

  // Innlogging
  function renderAdminLogin(root) {
    root.innerHTML = C.modal({
      title: "Logg inn",
      label: "Admin innlogging",
      body: `
        <form data-login class="admin-form">
          <p class="prose prose--muted">Skriv inn admin-passordet for å redigere innhold.</p>
          ${C.field({ id: "admin-pass", label: "Passord", type: "password", required: true })}
          ${C.button({ label: "Logg inn", type: "submit", variant: "primary" })}
          <p class="form__status" data-login-status role="status" aria-live="polite"></p>
        </form>`
    });
    bindModalClose(root);
    const form = root.querySelector("[data-login]");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const pass = root.querySelector("#admin-pass").value;
      const empPass = CFG.admin && CFG.admin.employeePassword;
      // ← felles passord fra config.admin.password (eller valgfritt ansattpassord, med begrenset adgang)
      if (pass === (CFG.admin && CFG.admin.password)) {
        setAuthed("owner");
        renderAdminPanel(root);
      } else if (empPass && pass === empPass) {
        setAuthed("employee");
        activeCategory = "henvendelser";
        renderAdminPanel(root);
      } else {
        setStatus(root.querySelector("[data-login-status]"), "Feil passord.", "error");
      }
    });
    setTimeout(function () { const i = root.querySelector("#admin-pass"); if (i) i.focus(); }, 50);
  }

  // Selve panelet
  function renderAdminPanel(root) {
    const role = getAuthRole() || "owner";
    const allowedCats = allowedCategoriesForRole(role);
    const allTabs = buildAdminTabs();
    const visibleTabs = allTabs.filter(function (t) { return allowedCats.indexOf(t.category) > -1; });

    if (allowedCats.indexOf(activeCategory) === -1) activeCategory = allowedCats[0];
    let tabsInCat = visibleTabs.filter(function (t) { return t.category === activeCategory; });
    if (!tabsInCat.some(function (t) { return t.id === activeTab; })) {
      activeTab = tabsInCat.length ? tabsInCat[0].id : "";
    }

    const catBarHtml = allowedCats.length > 1
      ? '<div class="admin-catbar" role="tablist">' +
          ADMIN_CATEGORIES.filter(function (c) { return allowedCats.indexOf(c.id) > -1; }).map(function (c) {
            return '<button class="admin-cat ' + (c.id === activeCategory ? "is-active" : "") + '" data-admin-cat="' + c.id + '">' + C.esc(c.label) + '</button>';
          }).join("") +
        '</div>'
      : "";

    root.innerHTML = C.modal({
      title: "Adminpanel — " + CFG.company.name,   // ← config.company.name
      label: "Adminpanel",
      wide: true,
      body: catBarHtml +
            C.tabbar(tabsInCat, activeTab) +
            `<div class="admin-tabbody" data-tabbody></div>
             <div class="admin-foot">
               ${role === "owner" ? '<span class="admin-vibeverk" data-vibeverk-click>Levert av Vibeverk</span>' : '<span class="admin-vibeverk">Levert av Vibeverk</span>'}
               ${C.button({ label: "Logg ut", variant: "ghost", attrs: 'data-logout' })}
             </div>`
    });
    bindModalClose(root);

    // Kategoriveksling — hopper til første fane i kategorien
    root.querySelectorAll("[data-admin-cat]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        activeCategory = btn.getAttribute("data-admin-cat");
        const first = visibleTabs.find(function (t) { return t.category === activeCategory; });
        activeTab = first ? first.id : activeTab;
        renderAdminPanel(root);
      });
    });

    // Faneveksling
    root.querySelectorAll("[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        activeTab = btn.getAttribute("data-tab");
        renderAdminPanel(root);
      });
    });
    root.querySelector("[data-logout]").addEventListener("click", function () {
      setAuthed(false); closeAdmin();
    });

    // Trippelklikk på «Levert av Vibeverk» → super-admin (kun eigaren, ikke ansattrolle)
    if (role === "owner") {
      let vClicks = 0, vTimer;
      root.querySelector("[data-vibeverk-click]").addEventListener("click", function () {
        vClicks++;
        clearTimeout(vTimer);
        vTimer = setTimeout(function () { vClicks = 0; }, 600);
        if (vClicks >= 3) { vClicks = 0; openSuperAdmin(root); }
      });
    }

    renderAdminTab(root.querySelector("[data-tabbody]"));
  }

  function renderAdminTab(body) {
    if (!body) return;
    if (activeTab === "innhold")    return adminContent(body);
    if (activeTab === "tjenester")  return adminServices(body);
    if (activeTab === "aktuelt")    return adminNews(body);
    if (activeTab === "navigasjon") return adminNavigation(body);
    if (activeTab === "analyse")    return adminAnalyse(body);
    if (activeTab === "leads")      return adminLeads(body);
    if (activeTab === "sikkerhetskopi") return adminBackup(body);
    if (activeTab.indexOf("mod-") === 0) {
      const id = activeTab.slice(4);
      const mod = modules.find(function (m) { return m.id === id; });
      if (mod && mod.admin) {
        body.innerHTML = mod.admin.render();
        if (typeof mod.admin.mount === "function") mod.admin.mount(body);
      }
    }
  }

  /* --- Admin: rik-tekst-felt-hjelpere ---------------------------------------
     Kobler opp verktøylinjen (fra C.richTextField) til document.execCommand.
     Verdien lagres sanert (C.sanitizeRichHtml) i et skjult felt ved hver
     endring, slik at det alltid er trygt å sette inn direkte som HTML. */
  function bindRichTextFields(scope) {
    scope.querySelectorAll("[data-rtfield]").forEach(function (wrap) {
      const editor = wrap.querySelector("[data-rt-editor]");
      const hidden = wrap.querySelector('input[type="hidden"]');
      editor.innerHTML = hidden.value || "";

      function sync() { hidden.value = C.sanitizeRichHtml(editor.innerHTML); }
      editor.addEventListener("input", sync);
      editor.addEventListener("blur", sync);

      wrap.querySelectorAll("[data-rt-cmd]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          editor.focus();
          document.execCommand(btn.getAttribute("data-rt-cmd"), false, null);
          sync();
        });
      });
      const linkBtn = wrap.querySelector("[data-rt-link]");
      if (linkBtn) linkBtn.addEventListener("click", function (e) {
        e.preventDefault();
        editor.focus();
        const url = prompt("Lenke (https://...)");
        if (!url) return;
        document.execCommand("createLink", false, url);
        sync();
      });
      const colorInput = wrap.querySelector("[data-rt-color]");
      if (colorInput) colorInput.addEventListener("input", function () {
        editor.focus();
        document.execCommand("styleWithCSS", false, true);
        document.execCommand("foreColor", false, colorInput.value);
        sync();
      });
      const clearBtn = wrap.querySelector("[data-rt-clear]");
      if (clearBtn) clearBtn.addEventListener("click", function (e) {
        e.preventDefault();
        editor.focus();
        document.execCommand("removeFormat", false, null);
        sync();
      });
    });
  }
  function readRichTextField(scope, id) {
    const el = scope.querySelector("#" + id);
    return el ? C.sanitizeRichHtml(el.value) : "";
  }
  // Plain text (med \n\n for avsnitt) → trygg HTML for å fylle en rik-tekst-editor
  // programmatisk, f.eks. fra et generert forslag.
  function textToRichHtml(text) {
    return String(text || "").split(/\n\n+/).map(function (para) {
      return "<p>" + C.esc(para).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }

  /* --- Admin: bildefelt-hjelpere ------------------------------------------- */
  // Bygger et bildefelt fra et bilde-objekt { src, pos }. `aspect` er forholdet
  // utsnittet skal ha (matcher hvordan seksjonen viser bildet på siden).
  // Standard merketekster. Kan overstyres pr. bilde i fritekstfeltet.
  const DEFAULT_CREDIT_AI        = "Bildet er generert eller redigert av kunstig intelligens";
  const DEFAULT_CREDIT_COPYRIGHT = "© " + (CFG.company && CFG.company.name ? CFG.company.name + " " : "") + "— alle rettigheter forbeholdt";

  function imgField(id, label, img, aspect) {
    const n = Media.norm(img);
    const isUrl = n.src && n.src.indexOf("media:") !== 0;
    return C.imageField({
      id: id, label: label,
      value: JSON.stringify(n),
      urlValue: isUrl ? n.src : "",
      aspect: aspect || (16 / 9),
      caption: n.caption,
      creditType: n.creditType,
      alt: n.alt,
      creditPlaceholder: n.creditType === "copyright" ? DEFAULT_CREDIT_COPYRIGHT : DEFAULT_CREDIT_AI
    });
  }

  // Leser et bildefelt tilbake til et { src, pos }-objekt ved innsending.
  function readImageField(scope, id) {
    const el = scope.querySelector("#" + id);
    if (!el) return { src: "", pos: "50% 50%" };
    try { return Media.norm(JSON.parse(el.value)); } catch (e) { return Media.norm(el.value); }
  }

  // Kobler opp opplasting / URL / fjern / beskjæring for alle bildefelt i et område.
  // Forhåndsvisningen viser HELE bildet med et lyst utsnitt-vindu (samme forhold
  // som på siden) som dras. Det som er innenfor vinduet er det som vises på siden.
  // Verdien lagres som { src, pos } (JSON) i en skjult input.
  function bindImageFields(scope) {
    scope.querySelectorAll("[data-imgfield]").forEach(function (wrap) {
      const hidden  = wrap.querySelector('input[type="hidden"]');
      const preview = wrap.querySelector("[data-imgfield-preview]");
      const hint    = wrap.querySelector("[data-imgfield-hint]");
      const file    = wrap.querySelector("[data-imgfield-file]");
      const url     = wrap.querySelector("[data-imgfield-url]");
      const clear   = wrap.querySelector("[data-imgfield-clear]");
      const credRadios = wrap.querySelectorAll("[data-imgfield-credit-type]");
      const credTx  = wrap.querySelector("[data-imgfield-credit-text]");
      const altInput = wrap.querySelector("[data-imgfield-alt]");
      const outAspect = parseFloat(preview.getAttribute("data-aspect")) || (16 / 9);

      let state, crop = null;   // crop = { ww, wh } i prosent av forhåndsvisningen
      try { state = Media.norm(JSON.parse(hidden.value)); } catch (e) { state = Media.norm(hidden.value); }

      function parsePos(p) { const m = String(p).split(/\s+/); return [parseFloat(m[0]) || 50, parseFloat(m[1]) || 50]; }
      function sync() { hidden.value = JSON.stringify(state); }

      function placeWindow() {
        const win = preview.querySelector("[data-crop-window]");
        if (!win || !crop) return;
        const p = parsePos(state.pos);
        win.style.left = (p[0] * (100 - crop.ww) / 100) + "%";
        win.style.top  = (p[1] * (100 - crop.wh) / 100) + "%";
      }
      function layout(natW, natH) {
        const imgAspect = (natW && natH) ? (natW / natH) : outAspect;
        const maxH = 340;
        preview.style.aspectRatio = String(imgAspect);
        preview.style.width = "min(100%, " + Math.round(maxH * imgAspect) + "px)";
        let ww = 100, wh = 100;
        if (imgAspect > outAspect) { wh = 100; ww = (outAspect / imgAspect) * 100; }
        else { ww = 100; wh = (imgAspect / outAspect) * 100; }
        crop = { ww: ww, wh: wh };
        const win = preview.querySelector("[data-crop-window]");
        if (win) { win.style.width = ww + "%"; win.style.height = wh + "%"; }
        placeWindow();
      }
      function render() {
        const src = Media.resolve(state.src);
        if (!src) {
          preview.classList.remove("is-set");
          preview.style.aspectRatio = "16 / 9"; preview.style.width = "100%";
          preview.innerHTML = '<span class="imgfield__empty">' + C.icon("photo") + ' Ingen bilde</span>';
          if (hint) hint.textContent = "Last opp en fil eller lim inn en bilde-URL.";
          crop = null; return;
        }
        preview.classList.add("is-set");
        preview.innerHTML = '<img class="cropper__img" draggable="false" alt="" src="' + src + '">' +
                            '<div class="cropper__window" data-crop-window></div>';
        if (hint) hint.textContent = "Dra det lyse utsnittet for å velge hva som vises på siden.";
        const img = preview.querySelector("img");
        if (img.complete && img.naturalWidth) layout(img.naturalWidth, img.naturalHeight);
        else { img.onload = function () { layout(img.naturalWidth, img.naturalHeight); }; img.onerror = function () { layout(0, 0); }; }
      }
      function setSrc(src) { Media.free(state.src); state = { src: src, pos: "50% 50%", caption: state.caption || "", creditType: state.creditType || "", alt: state.alt || "" }; sync(); render(); }

      // Merking (enten/eller): radioknapper for type + fritekst-overstyring
      function activeCreditType() {
        const checked = wrap.querySelector("[data-imgfield-credit-type]:checked");
        return checked ? checked.value : "";
      }
      function defaultTextFor(type) {
        return type === "copyright" ? DEFAULT_CREDIT_COPYRIGHT : (type === "ai" ? DEFAULT_CREDIT_AI : "");
      }
      function syncCredit() {
        const type = activeCreditType();
        state.creditType = type;
        state.caption = type ? (credTx.value.trim() || defaultTextFor(type)) : "";
        if (credTx) credTx.disabled = !type;
        sync();
      }
      credRadios.forEach(function (r) {
        r.addEventListener("change", function () {
          if (r.checked && credTx && !credTx.value.trim()) credTx.value = defaultTextFor(r.value);
          syncCredit();
        });
      });
      if (credTx) credTx.addEventListener("input", syncCredit);
      if (altInput) altInput.addEventListener("input", function () { state.alt = altInput.value; sync(); });

      file.addEventListener("change", function () {
        const f = file.files && file.files[0];
        if (!f) return;
        Media.put(f).then(function (ref) { url.value = ""; setSrc(ref); }).catch(function (err) {
          if (err && err.message === "quota") {
            alert("Lagringen er full og kan ikke ta flere bilder. Se Sikkerhetskopi-fanen i admin for å sjekke hvor mye plass som er brukt, og slett gamle bilder i Mediebank for å frigjøre plass.");
          } else {
            alert("Kunne ikke lagre bildet. Prøv et mindre bilde, eller lim inn en URL i stedet.");
          }
        });
        file.value = "";
      });
      url.addEventListener("input", function () { setSrc(url.value.trim()); });
      clear.addEventListener("click", function () {
        Media.free(state.src);
        state = { src: "", pos: "50% 50%", caption: "", creditType: "", alt: "" };
        url.value = "";
        wrap.querySelectorAll("[data-imgfield-credit-type]").forEach(function (r) { r.checked = (r.value === ""); });
        if (credTx) { credTx.value = ""; credTx.disabled = true; }
        if (altInput) altInput.value = "";
        sync(); render();
      });

      // Dra utsnittet → object-position i prosent
      let dragging = false, sx = 0, sy = 0, swl = 0, swt = 0;
      preview.addEventListener("pointerdown", function (e) {
        if (!state.src || !crop) return;
        e.preventDefault();
        dragging = true; sx = e.clientX; sy = e.clientY;
        const p = parsePos(state.pos);
        swl = p[0] * (100 - crop.ww) / 100; swt = p[1] * (100 - crop.wh) / 100;
        preview.classList.add("is-grabbing");
        if (preview.setPointerCapture && e.pointerId != null) { try { preview.setPointerCapture(e.pointerId); } catch (_) {} }
      });
      preview.addEventListener("pointermove", function (e) {
        if (!dragging || !crop) return;
        const r = preview.getBoundingClientRect();
        const maxL = 100 - crop.ww, maxT = 100 - crop.wh;
        const nl = Math.max(0, Math.min(maxL, swl + (e.clientX - sx) / (r.width || 1) * 100));
        const nt = Math.max(0, Math.min(maxT, swt + (e.clientY - sy) / (r.height || 1) * 100));
        state.pos = Math.round(maxL > 0 ? nl / maxL * 100 : 50) + "% " + Math.round(maxT > 0 ? nt / maxT * 100 : 50) + "%";
        sync();
        const win = preview.querySelector("[data-crop-window]");
        if (win) { win.style.left = nl + "%"; win.style.top = nt + "%"; }
      });
      window.addEventListener("pointerup", function () { if (dragging) { dragging = false; preview.classList.remove("is-grabbing"); } });

      render();
    });
  }

  // Leser et vedleggsfelt tilbake til en liste ved innsending.
  function readAttachments(scope, id) {
    const el = scope.querySelector("#" + id);
    if (!el) return [];
    try { return JSON.parse(el.value) || []; } catch (e) { return []; }
  }

  function formatBytes(n) {
    if (!n && n !== 0) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  // Kobler opp opplasting/fjerning av vedlegg. Skjult input (#id) holder lista som JSON.
  function bindAttachField(scope) {
    const wrap = scope.querySelector("[data-attach]");
    if (!wrap) return;
    const hidden = wrap.querySelector('input[type="hidden"]');
    const list   = wrap.querySelector("[data-attach-list]");
    const file   = wrap.querySelector("[data-attach-file]");

    let state;
    try { state = JSON.parse(hidden.value) || []; } catch (e) { state = []; }

    function sync() { hidden.value = JSON.stringify(state); }
    function render() {
      list.innerHTML = state.length ? state.map(function (a, i) {
        return `<li class="attach-item">
          ${C.icon(fileIconName(a))} <span class="attach-name">${C.esc(a.name)}</span>
          <span class="attach-size">${formatBytes(a.size)}</span>
          ${C.button({ label: "", icon: "x", variant: "ghost", attrs: 'data-attach-remove="' + i + '"' })}
        </li>`;
      }).join("") : "";
    }
    function fileIconName(a) {
      const t = (a.type || "") + " " + (a.name || "");
      if (/pdf/i.test(t)) return "file-type-pdf";
      if (/(word|\.docx?)/i.test(t)) return "file-type-doc";
      if (/(sheet|excel|\.xlsx?|\.csv)/i.test(t)) return "file-type-xls";
      if (/(zip|rar|\.7z)/i.test(t)) return "file-zip";
      if (/image\//i.test(t)) return "photo";
      return "paperclip";
    }

    file.addEventListener("change", function () {
      const files = Array.prototype.slice.call(file.files || []);
      file.value = "";
      (function next(idx) {
        if (idx >= files.length) return;
        Media.putFile(files[idx]).then(function (att) {
          state.push(att); sync(); render(); next(idx + 1);
        }).catch(function (err) {
          if (err && err.message === "size") {
            alert('"' + files[idx].name + '" er for stor for demo-lagringen (maks ' + Media.MAX_FILE_MB + ' MB per fil).');
          } else if (err && err.message === "quota") {
            alert("Lagringen er full og kan ikke ta flere filer. Se Sikkerhetskopi-fanen i admin for å sjekke hvor mye plass som er brukt, og rydd opp for å frigjøre plass.");
          } else {
            alert("Kunne ikke lagre vedlegget. Prøv en mindre fil.");
          }
          next(idx + 1);
        });
      })(0);
    });

    list.addEventListener("click", function (e) {
      const rm = e.target.closest("[data-attach-remove]");
      if (!rm) return;
      const i = parseInt(rm.getAttribute("data-attach-remove"), 10);
      if (state[i]) { Media.freeFile(state[i].ref); state.splice(i, 1); sync(); render(); }
    });

    render();
  }


  /* --- Admin: Innhold (hero / om oss / kontakt) ----------------------------- */
  // Én rad for et egendefinert kontaktfelt (overskrift + innhold).
  function extraRow(f) {
    f = f || { label: "", value: "" };
    return `
      <div class="extra-row" data-extra-row>
        <input type="text" class="extra-label" value="${C.esc(f.label)}" placeholder="Overskrift, f.eks. Fakturainformasjon">
        <textarea class="extra-value" rows="2" placeholder="Innhold (kan ha flere linjer)">${C.esc(f.value)}</textarea>
        <div class="extra-row__foot">
          ${C.button({ label: "Fjern felt", icon: "trash", variant: "ghost", attrs: 'data-extra-remove' })}
        </div>
      </div>`;
  }

  function adminContent(body) {
    const cf = content.footer || {};
    body.innerHTML = `
      <form data-content class="admin-form">
        <fieldset class="admin-group">
          <legend>Hero</legend>
          ${C.field({ id: "f-hero-title", label: "Tittel", value: content.hero.title })}
          ${C.field({ id: "f-hero-sub", label: "Undertittel", multiline: true, rows: 2, value: content.hero.subtitle })}
          ${imgField("f-hero-image", "Bakgrunnsbilde (vises i full bredde)", content.hero.image, 2.4)}
        </fieldset>
        <fieldset class="admin-group">
          <legend>Om oss</legend>
          ${C.richTextField({ id: "f-about", label: "Tekst", value: content.about.text })}
          ${imgField("f-about-image", "Bilde", content.about.image, 4/3)}
        </fieldset>
        <fieldset class="admin-group">
          <legend>Kontaktinfo</legend>
          ${C.field({ id: "f-c-email", label: "E-post", value: content.contact.email })}
          ${C.field({ id: "f-c-phone", label: "Telefon", value: content.contact.phone })}
          ${C.field({ id: "f-c-address", label: "Adresse", value: content.contact.address })}
          <div class="extra-fields">
            <p class="extra-fields__label">Flere felter (valgfritt)</p>
            <div data-extra-list>${(content.contact.extra || []).map(extraRow).join("")}</div>
            ${C.button({ label: "Legg til felt", icon: "plus", variant: "ghost", attrs: 'data-extra-add' })}
          </div>
        </fieldset>
        <fieldset class="admin-group">
          <legend>Sosiale medier</legend>
          <p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Fyll inn lenke for de du bruker — tomme felt vises ikke.</p>
          ${C.SOCIAL_PLATFORMS.map(function (p) {
            return C.field({ id: "f-soc-" + p.key, label: p.label, value: (content.contact.social || {})[p.key] || "", placeholder: "https://…" });
          }).join("")}
        </fieldset>
        <fieldset class="admin-group">
          <legend>Footer</legend>
          ${C.field({ id: "f-ft-orgnr",    label: "Org.nr",            value: cf.orgNr || "",          placeholder: "Org.nr: 123 456 789" })}
          ${C.field({ id: "f-ft-invaddr",  label: "Fakturaadresse",    value: cf.invoiceAddress || "", placeholder: "Fakturaadresse: Storgata 1, 0001 Oslo" })}
          ${C.field({ id: "f-ft-invemail", label: "Faktura e-post",    value: cf.invoiceEmail || "",   placeholder: "faktura@nordpunkt.no", type: "email" })}
          ${C.field({ id: "f-ft-copy",     label: "Copyright-tekst",   value: cf.copyright || "",      placeholder: "© 2026 Nordpunkt AS — tomt = genereres automatisk" })}
          ${C.field({ id: "f-ft-extra",    label: "Ekstralinjer (én per linje)", multiline: true, rows: 3,
                      value: (cf.extraLines || []).join("\n"),
                      hint: "F.eks. «MVA-registrert» eller annen fast informasjon" })}
        </fieldset>
        ${C.button({ label: "Lagre endringer", type: "submit", variant: "primary" })}
        <p class="form__status" data-content-status role="status" aria-live="polite"></p>
      </form>`;
    bindImageFields(body);
    bindRichTextFields(body);

    const extraList = body.querySelector("[data-extra-list]");
    body.querySelector("[data-extra-add]").addEventListener("click", function () {
      extraList.insertAdjacentHTML("beforeend", extraRow(null));
    });
    extraList.addEventListener("click", function (e) {
      const rm = e.target.closest("[data-extra-remove]");
      if (rm) { const row = rm.closest("[data-extra-row]"); if (row) row.remove(); }
    });

    body.querySelector("[data-content]").addEventListener("submit", function (e) {
      e.preventDefault();
      content.hero.title    = body.querySelector("#f-hero-title").value;
      content.hero.subtitle = body.querySelector("#f-hero-sub").value;
      content.hero.image    = readImageField(body, "f-hero-image");
      content.about.text    = readRichTextField(body, "f-about");
      content.about.image   = readImageField(body, "f-about-image");
      content.contact.email = body.querySelector("#f-c-email").value;
      content.contact.phone = body.querySelector("#f-c-phone").value;
      content.contact.address = body.querySelector("#f-c-address").value;
      const extra = [];
      body.querySelectorAll("[data-extra-row]").forEach(function (row) {
        const label = row.querySelector(".extra-label").value.trim();
        const value = row.querySelector(".extra-value").value.trim();
        if (label || value) extra.push({ label: label, value: value });
      });
      content.contact.extra = extra;
      const social = {};
      C.SOCIAL_PLATFORMS.forEach(function (p) {
        social[p.key] = body.querySelector("#f-soc-" + p.key).value.trim();
      });
      content.contact.social = social;
      // Footer
      content.footer = {
        orgNr:          body.querySelector("#f-ft-orgnr").value.trim(),
        invoiceAddress: body.querySelector("#f-ft-invaddr").value.trim(),
        invoiceEmail:   body.querySelector("#f-ft-invemail").value.trim(),
        copyright:      body.querySelector("#f-ft-copy").value.trim(),
        extraLines:     body.querySelector("#f-ft-extra").value.split("\n").map(function (l) { return l.trim(); }).filter(Boolean)
      };
      saveContent();
      render();
      setStatus(body.querySelector("[data-content-status]"), "Lagret.", "ok");
    });
  }

  /* --- Admin: Aktuelt (opprett / rediger / slett) --------------------------- */
  function adminNews(body) {
    const posts = content.news;
    const rows = posts.length ? posts.map(function (p) {
      return `
        <li class="admin-row" data-id="${C.esc(p.id)}">
          <div class="admin-row__main">
            <strong>${C.esc(p.title)}</strong>
            <span class="admin-row__meta">${C.formatDate(p.date)}</span>
          </div>
          <div class="admin-row__actions">
            ${C.button({ label: "Rediger", variant: "ghost", attrs: 'data-edit="' + C.esc(p.id) + '"' })}
            ${C.button({ label: "Slett", variant: "ghost", attrs: 'data-del="' + C.esc(p.id) + '"' })}
          </div>
        </li>`;
    }).join("") : `<li class="prose prose--muted">Ingen innlegg ennå.</li>`;

    body.innerHTML = `
      <div class="admin-news">
        ${C.button({ label: "Nytt innlegg", icon: "plus", variant: "primary", attrs: 'data-new' })}
        <ul class="admin-list">${rows}</ul>
        <div data-news-editor></div>
      </div>`;

    body.querySelector("[data-new]").addEventListener("click", function () {
      openNewsEditor(body, null);
    });
    body.querySelectorAll("[data-edit]").forEach(function (b) {
      b.addEventListener("click", function () { openNewsEditor(body, b.getAttribute("data-edit")); });
    });
    body.querySelectorAll("[data-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        const id = b.getAttribute("data-del");
        const post = content.news.find(function (p) { return p.id === id; });
        if (post) {
          Media.free(post.image);
          (post.attachments || []).forEach(function (a) { Media.freeFile(a.ref); });
        }
        content.news = content.news.filter(function (p) { return p.id !== id; });
        saveContent(); render(); adminNews(body);
      });
    });
  }

  function openNewsEditor(body, id) {
    const editing = id ? content.news.find(function (p) { return p.id === id; }) : null;
    const today = new Date().toISOString().slice(0, 10);
    const editor = body.querySelector("[data-news-editor]");
    editor.innerHTML = `
      <form data-post class="admin-form admin-form--card">
        <h4>${editing ? "Rediger innlegg" : "Nytt innlegg"}</h4>
        ${C.field({ id: "p-title", label: "Tittel", required: true, value: editing ? editing.title : "" })}
        ${C.field({ id: "p-date", label: "Dato", type: "date", value: editing ? editing.date : today })}
        ${C.richTextField({ id: "p-text", label: "Tekst", value: editing ? editing.text : "" })}
        ${imgField("p-image", "Bilde (valgfritt)", editing ? editing.image : "", 16/9)}
        ${feat("attachments") ? `
        <div class="field attach-field" data-attach>
          <label>Vedlegg (valgfritt)</label>
          <ul class="attach-list" data-attach-list></ul>
          <label class="btn btn--ghost attach-add">
            ${C.icon("upload")} Last opp vedlegg
            <input type="file" multiple hidden data-attach-file>
          </label>
          <p class="imgfield__hint">Maks ${Media.MAX_FILE_MB} MB per fil i demo (lagres lokalt).</p>
          <input type="hidden" id="p-attachments" value="${C.esc(JSON.stringify(editing ? (editing.attachments || []) : []))}">
        </div>` : ""}
        <div class="admin-row__actions">
          ${C.button({ label: editing ? "Oppdater" : "Opprett", type: "submit", variant: "primary" })}
          ${C.button({ label: "Avbryt", variant: "ghost", attrs: 'data-cancel' })}
        </div>
      </form>`;
    bindImageFields(editor);
    bindAttachField(editor);
    bindRichTextFields(editor);
    editor.querySelector("[data-cancel]").addEventListener("click", function () { editor.innerHTML = ""; });
    editor.querySelector("[data-post]").addEventListener("submit", function (e) {
      e.preventDefault();
      const title = editor.querySelector("#p-title").value.trim();
      const date = editor.querySelector("#p-date").value || today;
      const text = readRichTextField(editor, "p-text");
      const image = readImageField(editor, "p-image");
      // Bevar lagrede vedlegg når funksjonen er avslått (feltet vises ikke da)
      const attachments = feat("attachments")
        ? readAttachments(editor, "p-attachments")
        : (editing ? (editing.attachments || []) : []);
      if (!title) return;
      if (editing) {
        editing.title = title; editing.date = date; editing.text = text; editing.image = image; editing.attachments = attachments;
      } else {
        content.news.unshift({ id: "post-" + Date.now(), title: title, date: date, text: text, image: image, attachments: attachments });
      }
      saveContent(); render(); adminNews(body);
    });
  }

  /* --- Admin: Tjenester (opprett / rediger / slett kort) -------------------- */
  function adminServices(body) {
    const cards = content.services;
    const rows = cards.length ? cards.map(function (c) {
      return `
        <li class="admin-row" data-id="${C.esc(c.id)}">
          <div class="admin-row__main">
            <strong>${C.icon(c.icon)} ${C.esc(c.title)}</strong>
            <span class="admin-row__meta">${C.esc(C.stripHtml(c.text))}</span>
          </div>
          <div class="admin-row__actions">
            ${C.button({ label: "Rediger", variant: "ghost", attrs: 'data-edit="' + C.esc(c.id) + '"' })}
            ${C.button({ label: "Slett", variant: "ghost", attrs: 'data-del="' + C.esc(c.id) + '"' })}
          </div>
        </li>`;
    }).join("") : `<li class="prose prose--muted">Ingen tjenestekort ennå.</li>`;

    body.innerHTML = `
      <div class="admin-news">
        ${C.button({ label: "Nytt kort", icon: "plus", variant: "primary", attrs: 'data-new' })}
        <ul class="admin-list">${rows}</ul>
        <div data-svc-editor></div>
      </div>`;

    body.querySelector("[data-new]").addEventListener("click", function () {
      openServiceEditor(body, null);
    });
    body.querySelectorAll("[data-edit]").forEach(function (b) {
      b.addEventListener("click", function () { openServiceEditor(body, b.getAttribute("data-edit")); });
    });
    body.querySelectorAll("[data-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        const id = b.getAttribute("data-del");
        const card = content.services.find(function (c) { return c.id === id; });
        if (card) Media.free(card.image);
        content.services = content.services.filter(function (c) { return c.id !== id; });
        saveContent(); render(); adminServices(body);
      });
    });
  }

  // Tabler-ikonnavn består av små bokstaver, tall og bindestrek — saner input.
  function cleanIcon(v) { return String(v || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, ""); }

  function openServiceEditor(body, id) {
    const editing = id ? content.services.find(function (c) { return c.id === id; }) : null;
    const editor = body.querySelector("[data-svc-editor]");
    editor.innerHTML = `
      <form data-svc class="admin-form admin-form--card">
        <h4>${editing ? "Rediger kort" : "Nytt kort"}</h4>
        <div class="field">
          <label for="s-icon">Ikon <span class="field__hint">(Tabler-navn, f.eks. «rocket» — se tabler.io/icons)</span></label>
          <div class="icon-field">
            <span class="icon-field__preview" data-icon-preview>${C.icon(editing ? editing.icon : "point")}</span>
            <input id="s-icon" type="text" value="${C.esc(editing ? editing.icon : "")}" placeholder="rocket">
          </div>
        </div>
        ${C.field({ id: "s-title", label: "Tittel", required: true, value: editing ? editing.title : "" })}
        ${C.richTextField({ id: "s-text", label: "Beskrivelse", value: editing ? editing.text : "" })}
        ${imgField("s-image", "Bilde (valgfritt — erstatter ikonet)", editing ? editing.image : "", 16/10)}
        <div class="admin-row__actions">
          ${C.button({ label: editing ? "Oppdater" : "Opprett", type: "submit", variant: "primary" })}
          ${C.button({ label: "Avbryt", variant: "ghost", attrs: 'data-cancel' })}
        </div>
      </form>`;

    bindImageFields(editor);
    bindRichTextFields(editor);
    // Live forhåndsvisning av ikonet mens man skriver
    const iconInput = editor.querySelector("#s-icon");
    const preview = editor.querySelector("[data-icon-preview]");
    iconInput.addEventListener("input", function () {
      preview.innerHTML = C.icon(cleanIcon(iconInput.value) || "point");
    });

    editor.querySelector("[data-cancel]").addEventListener("click", function () { editor.innerHTML = ""; });
    editor.querySelector("[data-svc]").addEventListener("submit", function (e) {
      e.preventDefault();
      const icon = cleanIcon(iconInput.value) || "point";
      const title = editor.querySelector("#s-title").value.trim();
      const text = readRichTextField(editor, "s-text");
      const image = readImageField(editor, "s-image");
      if (!title) return;
      if (editing) {
        editing.icon = icon; editing.title = title; editing.text = text; editing.image = image;
      } else {
        content.services.push({ id: "svc-" + Date.now(), icon: icon, title: title, text: text, image: image });
      }
      saveContent(); render(); adminServices(body);
    });
  }

  /* --- Admin: Leads --------------------------------------------------------- */
  /* --- Navigasjons-innstillinger ------------------------------------------- */
  // Lagrer { moduleId: { nav: bool, footer: bool } }
  function getNavSettings() { return Store.get("nav-settings", {}) || {}; }
  function saveNavSettings(v) { Store.set("nav-settings", v); }

  // Henter moduler i custom nav-rekkefølge (felles for toppmeny og footer)
  function getNavOrderedMods() {
    const all = orderedModules().filter(function (m) { return m.label && !m.adminOnly; });
    const order = (getNavSettings().navOrder || []);
    if (!order.length) return all;
    const indexed = {};
    all.forEach(function (m) { indexed[m.id] = m; });
    const sorted = [];
    order.forEach(function (id) { if (indexed[id]) { sorted.push(indexed[id]); delete indexed[id]; } });
    Object.values(indexed).forEach(function (m) { sorted.push(m); });
    return sorted;
  }

  // Henter moduler som skal visast på framsida, i riktig rekkefølge.
  // Inline-moduler vises som standard; page-only moduler berre om dei er i pageShown.
  function getPageVisibleMods() {
    const ns     = getNavSettings();
    const hidden = ns.pageHidden || [];
    const shown  = ns.pageShown  || [];
    const order  = ns.pageOrder  || [];
    let all = orderedModules().filter(function (m) {
      if (m.adminOnly) return false;
      if (!m.render && !m.renderPage) return false;
      if (hidden.indexOf(m.id) > -1) return false;
      if (m.page && !m.inline) return shown.indexOf(m.id) > -1;  // page-only: krev eksplisitt vis
      return true;   // inline: vis som standard
    });
    if (order.length) {
      const idx = {};
      all.forEach(function (m) { idx[m.id] = m; });
      const sorted = [];
      order.forEach(function (id) { if (idx[id]) { sorted.push(idx[id]); delete idx[id]; } });
      Object.values(idx).forEach(function (m) { sorted.push(m); });
      all = sorted;
    }
    return all;
  }

  // Hent visningsnavn for en modul — overstyrt navn (satt i Navigasjon-fanen) har forrang
  function modLabel(mod) {
    const s = getNavSettings()[mod.id];
    if (s && s.label) return s.label;
    return (mod.admin && mod.admin.label) || mod.label || mod.id;
  }

  // Hent nav/footer-synlighet for en modul
  function modNavVisible(mod) {
    if (mod.adminOnly) return false;
    if (mod.navHidden)  return false;  // ← scrollbanner og liknande grafiske seksjonar
    const s = getNavSettings()[mod.id];
    if (s && typeof s.nav === "boolean") return s.nav;
    return true; // default: vis
  }
  function modFooterVisible(mod) {
    if (mod.adminOnly) return false;
    const s = getNavSettings()[mod.id];
    if (s && typeof s.footer === "boolean") return s.footer;
    return false; // default: ikke i footer
  }

  function adminNavigation(body) {
    const allMods = getNavOrderedMods();
    const settings = getNavSettings();

    function renderNavTable() {
      const mods = getNavOrderedMods();
      const currentSettings = getNavSettings();
      const rows = mods.filter(function (m) { return m.label; }).map(function (m, i, arr) {
        const s = currentSettings[m.id] || {};
        const inNav    = typeof s.nav    === "boolean" ? s.nav    : true;
        const inFooter = typeof s.footer === "boolean" ? s.footer : false;
        const isFirst  = i === 0;
        const isLast   = i === arr.length - 1;
        return `<tr>
          <td style="padding:.4rem .5rem">
            <input type="text" class="nav-label-input" data-nav-label="${C.esc(m.id)}" value="${C.esc(modLabel(m))}" placeholder="${C.esc(m.label)}" title="Visningsnavn — vises i meny, footer og admin-fane">
          </td>
          <td style="padding:.4rem .5rem;text-align:center">
            <input type="checkbox" data-nav-mod="${C.esc(m.id)}" data-nav-type="nav" ${inNav ? "checked" : ""}>
          </td>
          <td style="padding:.4rem .5rem;text-align:center">
            <input type="checkbox" data-nav-mod="${C.esc(m.id)}" data-nav-type="footer" ${inFooter ? "checked" : ""}>
          </td>
          <td style="padding:.4rem .3rem;white-space:nowrap">
            <button type="button" class="btn btn--ghost" style="padding:.2rem .5rem;font-size:.9rem" data-nav-up="${C.esc(m.id)}" ${isFirst ? "disabled" : ""} title="Flytt opp">↑</button>
            <button type="button" class="btn btn--ghost" style="padding:.2rem .5rem;font-size:.9rem" data-nav-dn="${C.esc(m.id)}" ${isLast  ? "disabled" : ""} title="Flytt ned">↓</button>
          </td>
        </tr>`;
      }).join("");

      const tbl = body.querySelector("tbody");
      if (tbl) {
        tbl.innerHTML = rows;
        bindNavTableEvents();
      }
    }

    function bindNavTableEvents() {
      body.querySelectorAll("[data-nav-label]").forEach(function (inp) {
        inp.addEventListener("change", function () {
          const id  = inp.getAttribute("data-nav-label");
          const val = inp.value.trim();
          const cur = getNavSettings();
          if (!cur[id]) cur[id] = {};
          if (val) { cur[id].label = val; } else { delete cur[id].label; }
          saveNavSettings(cur);
          render();
          const st = body.querySelector("[data-nav-status]");
          if (st) { st.textContent = "Visningsnavn lagret. Admin-fanen oppdaterer seg neste gang panelet åpnes."; st.className = "form__status is-ok"; setTimeout(function () { if (st) st.textContent = ""; }, 2500); }
        });
      });
      body.querySelectorAll("[data-nav-mod]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          const id   = cb.getAttribute("data-nav-mod");
          const type = cb.getAttribute("data-nav-type");
          const cur  = getNavSettings();
          if (!cur[id]) cur[id] = {};
          cur[id][type] = cb.checked;
          saveNavSettings(cur);
          render();
          const st = body.querySelector("[data-nav-status]");
          if (st) { st.textContent = "Lagret."; st.className = "form__status is-ok"; setTimeout(function () { if (st) st.textContent = ""; }, 1500); }
        });
      });

      body.querySelectorAll("[data-nav-up],[data-nav-dn]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          const isUp = btn.hasAttribute("data-nav-up");
          const id   = btn.getAttribute(isUp ? "data-nav-up" : "data-nav-dn");
          const cur  = getNavSettings();
          const mods = getNavOrderedMods().filter(function (m) { return m.label; });
          const ids  = mods.map(function (m) { return m.id; });
          const idx  = ids.indexOf(id);
          if (idx < 0) return;
          const swap = isUp ? idx - 1 : idx + 1;
          if (swap < 0 || swap >= ids.length) return;
          const tmp = ids[idx]; ids[idx] = ids[swap]; ids[swap] = tmp;
          cur.navOrder = ids;
          saveNavSettings(cur);
          render();
          renderNavTable();
          const st = body.querySelector("[data-nav-status]");
          if (st) { st.textContent = "Rekkefølge oppdatert."; st.className = "form__status is-ok"; setTimeout(function () { if (st) st.textContent = ""; }, 1500); }
        });
      });
    }

    body.innerHTML = `
      <div style="max-width:640px">
        <h4 style="margin:0 0 .4rem">Meny og footer</h4>
        <p class="prose prose--muted" style="margin-bottom:.9rem">Velg synlighet og rekkefølge. Rekkefølgen er felles for toppmeny og footer.</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden">
          <thead>
            <tr style="background:var(--color-alt)">
              <th style="padding:.5rem .5rem;text-align:left;font-size:.85rem">Visningsnavn</th>
              <th style="padding:.5rem .5rem;text-align:center;font-size:.85rem">Toppmeny</th>
              <th style="padding:.5rem .5rem;text-align:center;font-size:.85rem">Footer</th>
              <th style="padding:.5rem .5rem;text-align:center;font-size:.85rem">Rekkefølge</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
        <p class="form__status" data-nav-status style="margin-top:.8rem"></p>

        <h4 style="margin:1.8rem 0 .4rem">Framsida</h4>
        <p class="prose prose--muted" style="margin-bottom:.9rem">Styr kva seksjoner som vises på framsida og i kva rekkefølge. Side-moduler (Booking, Tilbud, FAQ) er eigne sider og kan ikkje leggjast inn her.</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden">
          <thead>
            <tr style="background:var(--color-alt)">
              <th style="padding:.5rem .5rem;text-align:left;font-size:.85rem">Seksjon</th>
              <th style="padding:.5rem .5rem;text-align:center;font-size:.85rem">Vis på framsida</th>
              <th style="padding:.5rem .5rem;text-align:center;font-size:.85rem">Rekkefølge</th>
            </tr>
          </thead>
          <tbody data-page-tbody></tbody>
        </table>
        <p class="form__status" data-page-status style="margin-top:.8rem"></p>
      </div>`;

    renderNavTable();
    renderPageTable();

    function renderPageTable() {
      const ns      = getNavSettings();
      const hidden  = ns.pageHidden || [];
      const shown   = ns.pageShown  || [];
      // Alle moduler med render eller renderPage
      const allMods = orderedModules().filter(function (m) { return m.label && !m.adminOnly && (m.render || m.renderPage); });
      const custOrder = ns.pageOrder || [];
      let mods;
      if (custOrder.length) {
        const indexed = {}; allMods.forEach(function (m) { indexed[m.id] = m; });
        mods = [];
        custOrder.forEach(function (id) { if (indexed[id]) { mods.push(indexed[id]); delete indexed[id]; } });
        Object.values(indexed).forEach(function (m) { mods.push(m); });
      } else { mods = allMods.slice(); }

      const tbody = body.querySelector("[data-page-tbody]");
      tbody.innerHTML = mods.map(function (m, i) {
        const isPageOnly = !!(m.page && !m.inline);
        // Default: inline-moduler vist, page-only skjult
        const vis = isPageOnly ? shown.indexOf(m.id) > -1 : hidden.indexOf(m.id) === -1;
        const badge = isPageOnly ? ' <span style="font-size:.72rem;color:var(--color-muted)">(eigen side)</span>' : '';
        return `<tr>
          <td style="padding:.4rem .5rem;font-weight:600">${C.esc(modLabel(m))}${badge}</td>
          <td style="padding:.4rem .5rem;text-align:center">
            <input type="checkbox" data-page-vis="${C.esc(m.id)}" data-page-only="${isPageOnly?'1':'0'}" ${vis ? "checked" : ""}>
          </td>
          <td style="padding:.4rem .3rem;white-space:nowrap">
            <button type="button" class="btn btn--ghost" style="padding:.2rem .5rem;font-size:.9rem" data-page-up="${C.esc(m.id)}" ${i===0?"disabled":""}>↑</button>
            <button type="button" class="btn btn--ghost" style="padding:.2rem .5rem;font-size:.9rem" data-page-dn="${C.esc(m.id)}" ${i===mods.length-1?"disabled":""}>↓</button>
          </td>
        </tr>`;
      }).join("");

      tbody.querySelectorAll("[data-page-vis]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          const id = cb.getAttribute("data-page-vis");
          const isPageOnly = cb.getAttribute("data-page-only") === "1";
          const cur = getNavSettings();
          if (isPageOnly) {
            // page-only: legg i/fjern frå pageShown
            cur.pageShown = (cur.pageShown || []).filter(function (x) { return x !== id; });
            if (cb.checked) cur.pageShown.push(id);
          } else {
            // inline: legg i/fjern frå pageHidden
            cur.pageHidden = (cur.pageHidden || []).filter(function (x) { return x !== id; });
            if (!cb.checked) cur.pageHidden.push(id);
          }
          saveNavSettings(cur);
          render();
          const st = body.querySelector("[data-page-status]");
          if (st) { st.textContent = "Lagret."; st.className = "form__status is-ok"; setTimeout(function () { if (st) st.textContent = ""; }, 1500); }
        });
      });

      tbody.querySelectorAll("[data-page-up],[data-page-dn]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          const isUp = btn.hasAttribute("data-page-up");
          const id   = btn.getAttribute(isUp ? "data-page-up" : "data-page-dn");
          const ids  = mods.map(function (m) { return m.id; });
          const idx  = ids.indexOf(id);
          const swap = isUp ? idx - 1 : idx + 1;
          if (swap < 0 || swap >= ids.length) return;
          const tmp = ids[idx]; ids[idx] = ids[swap]; ids[swap] = tmp;
          const cur = getNavSettings();
          cur.pageOrder = ids;
          saveNavSettings(cur);
          render();
          renderPageTable();
          const st = body.querySelector("[data-page-status]");
          if (st) { st.textContent = "Rekkefølge oppdatert."; st.className = "form__status is-ok"; setTimeout(function () { if (st) st.textContent = ""; }, 1500); }
        });
      });
    }
  }

  /* --- Analyse-fane --------------------------------------------------------- */
  function adminAnalyse(body) {
    const now   = new Date();
    const thisM = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevM = prevD.getFullYear() + "-" + String(prevD.getMonth() + 1).padStart(2, "0");

    function countByMonth(items, month) {
      return items.filter(function (x) { return (x.time || "").startsWith(month); }).length;
    }
    function statCard(label, thisVal, prevVal) {
      const diff = thisVal - prevVal;
      const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "–";
      const color = diff > 0 ? "var(--color-primary)" : diff < 0 ? "#c0392b" : "var(--color-muted)";
      return `<div class="an-card">
        <div class="an-card__val">${thisVal}</div>
        <div class="an-card__label">${C.esc(label)}</div>
        <div class="an-card__diff" style="color:${color}">${arrow} ${Math.abs(diff)} vs. forrige måned (${prevVal})</div>
      </div>`;
    }
    // Åpne = ny + lest, Løst = løst. Samme status-system som brukes i Kontakt/Tilbud/Booking.
    function openCount(items)     { return items.filter(function (x) { return (x.status || "ny") !== "løst"; }).length; }
    function resolvedCount(items) { return items.filter(function (x) { return (x.status || "ny") === "løst"; }).length; }
    function statusCard(label, items) {
      return `<div class="an-card">
        <div class="an-card__split">
          <div><div class="an-card__val">${openCount(items)}</div><div class="an-card__label">Åpne</div></div>
          <div><div class="an-card__val">${resolvedCount(items)}</div><div class="an-card__label">Løst</div></div>
        </div>
        <div class="an-card__label" style="margin:.5rem 0 0;font-weight:600">${C.esc(label)}</div>
      </div>`;
    }
    function countCard(label, val) {
      return `<div class="an-card">
        <div class="an-card__val">${val}</div>
        <div class="an-card__label">${C.esc(label)}</div>
      </div>`;
    }
    // Vis kun tal for moduler kunden faktisk har — basismalen skal aldri vise tomme/feil kort.
    function hasModule(id) { return modules.some(function (m) { return m.id === id; }); }

    const leads    = getLeads().filter(function (l) { return !l.message || l.message.indexOf("Tilbudsforesp") !== 0; });
    const quotes   = getLeads().filter(function (l) { return l.message && l.message.indexOf("Tilbudsforesp") === 0; });
    const bookings = Store.get("booking-bookings", []) || [];

    const monthCards = [statCard("Kontaktskjema", countByMonth(leads, thisM), countByMonth(leads, prevM))];
    if (hasModule("tilbud"))  monthCards.push(statCard("Tilbud", countByMonth(quotes, thisM), countByMonth(quotes, prevM)));
    if (hasModule("booking")) monthCards.push(statCard("Bookinger", countByMonth(bookings, thisM), countByMonth(bookings, prevM)));

    const statusCards = [statusCard("Kontaktskjema", leads)];
    if (hasModule("tilbud"))  statusCards.push(statusCard("Tilbud", quotes));
    if (hasModule("booking")) statusCards.push(statusCard("Bookinger", bookings));

    const contentCards = [];
    let refCatHtml = "";
    if (hasModule("booking")) {
      const instantN = bookings.filter(function (b) { return b.instant; }).length;
      contentCards.push(countCard("Sanntidsbooking", instantN));
      contentCards.push(countCard("Forespørsel (booking)", bookings.length - instantN));
    }
    if (hasModule("referanser")) {
      const refs = Store.get("ref-items", []) || [];
      contentCards.push(countCard("Referanser", refs.length));
      const cats = {};
      refs.forEach(function (r) { const c = r.category || "Ukategorisert"; cats[c] = (cats[c] || 0) + 1; });
      const catKeys = Object.keys(cats);
      if (catKeys.length) {
        refCatHtml = `<div class="an-cat-list">` + catKeys.map(function (c) {
          return `<span class="an-cat-chip">${C.esc(c)} (${cats[c]})</span>`;
        }).join("") + `</div>`;
      }
    }
    if (hasModule("faq"))       contentCards.push(countCard("FAQ-spørsmål", (Store.get("faq-items", []) || []).length));
    if (hasModule("mediabank")) contentCards.push(countCard("Bilder i Mediebank", (Store.get("mediabank-images", []) || []).length));
    if (hasModule("crm"))       contentCards.push(countCard("Kunder", (Store.get("crm-customers", []) || []).length));

    // Innstillingene konfigureres kun av Vibeverk i super-admin — kunden ser bare resultatet.
    const a = Store.get("analytics", null) || (CFG.analytics || {});
    const plVal    = (a.plausible        || "");
    const embedVal = (a.plausibleEmbed   || "");

    const plLink = plVal ? `<a class="an-ext-link" href="https://plausible.io/${C.esc(plVal)}" target="_blank" rel="noopener">Åpne Plausible ${C.icon("external-link")}</a>` : "";

    const bits = [];
    if (embedVal) {
      const sep = embedVal.indexOf("?") > -1 ? "&" : "?";
      const src = embedVal + sep + "embed=true&theme=light";
      bits.push(`<iframe plausible-embed src="${C.esc(src)}" scrolling="no" frameborder="0" loading="lazy" style="width:1px;min-width:100%;height:1400px;border:0;border-radius:var(--radius)"></iframe>`);
      bits.push(`<p style="font-size:.78rem;color:var(--color-muted);margin-top:.5rem">Drevet av <a href="https://plausible.io" target="_blank" rel="noopener">Plausible Analytics</a></p>`);
    }
    if (plVal && !embedVal) bits.push(plLink);
    const trafficHtml = bits.length ? bits.join("") : `<p class="an-hint">Ingen analyse er satt opp ennå. Ta kontakt med din leverandør for oppsett.</p>`;

    body.innerHTML = `
      <div class="an-wrap">
        <h4 class="an-heading">Denne måneden</h4>
        <div class="an-cards">${monthCards.join("")}</div>

        <h4 class="an-heading">Status (åpne/løst)</h4>
        <div class="an-cards">${statusCards.join("")}</div>

        ${contentCards.length ? `<h4 class="an-heading">Innhold</h4><div class="an-cards">${contentCards.join("")}</div>${refCatHtml}` : ""}

        <div class="an-traffic">
          <h4 class="an-heading">Trafikk</h4>
          ${trafficHtml}
        </div>
      </div>`;

    // embed.host.js styrer auto-høgde på iframen — injiseres én gang globalt
    if (embedVal && !document.getElementById("_pl-embed-script")) {
      const s = document.createElement("script");
      s.id = "_pl-embed-script";
      s.async = true;
      s.src = "https://plausible.io/js/embed.host.js";
      document.body.appendChild(s);
    }
  }

  /* ===========================================================================
     STATUS-SYSTEM (Ny / Lest / Løst) — delt mellom Kontakt, Tilbud og Booking
     ======================================================================== */
  const STATUS_LABELS = { ny: "Ny", lest: "Lest", løst: "Løst" };
  const STATUS_ORDER  = ["ny", "lest", "løst"];

  function statusBadge(status) {
    const s = status || "ny";
    return `<span class="stat-badge stat-badge--${C.esc(s)}">${C.esc(STATUS_LABELS[s] || s)}</span>`;
  }

  // Bygg filter-chip-rad. key brukes til localStorage (eige filter pr. fane).
  function statusFilterBar(key, counts) {
    const stored = Store.get("statusfilter-" + key, null);
    const active = stored || STATUS_ORDER.slice();
    return `<div class="stat-filters" data-stat-filters="${C.esc(key)}">` +
      STATUS_ORDER.map(function (s) {
        const on = active.indexOf(s) > -1;
        return `<button type="button" class="stat-chip stat-chip--${s} ${on ? "is-on" : ""}" data-stat-chip="${s}">` +
          `${STATUS_LABELS[s]} (${counts[s] || 0})</button>`;
      }).join("") + `</div>`;
  }

  function getActiveStatuses(key) {
    return Store.get("statusfilter-" + key, null) || STATUS_ORDER.slice();
  }

  function bindStatusFilterBar(body, key, onChange) {
    const bar = body.querySelector(`[data-stat-filters="${key}"]`);
    if (!bar) return;
    bar.querySelectorAll("[data-stat-chip]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        const s = chip.getAttribute("data-stat-chip");
        let active = getActiveStatuses(key);
        if (active.indexOf(s) > -1) {
          // Ikkje lov å fjerne siste aktive filter (ville vist ingenting)
          if (active.length === 1) return;
          active = active.filter(function (x) { return x !== s; });
        } else {
          active = active.concat([s]);
        }
        Store.set("statusfilter-" + key, active);
        onChange();
      });
    });
  }

  function setLeadStatus(id, status) {
    const leads = getLeads();
    const lead = leads.find(function (l) { return l.id === id; });
    if (lead) { lead.status = status; saveLeads(leads); }
  }
  function deleteByEmail(email) {
    email = (email || "").trim().toLowerCase();
    if (!email) return 0;
    let count = 0;
    // Leads og tilbod
    const before = getLeads().length;
    saveLeads(getLeads().filter(function (l) { return (l.email || "").toLowerCase() !== email; }));
    count += before - getLeads().length;
    // Bookingar (via App.store — same namespace)
    const bk = Store.get("booking-bookings", []) || [];
    const bkAfter = bk.filter(function (b) { return (b.email || "").toLowerCase() !== email; });
    Store.set("booking-bookings", bkAfter);
    count += bk.length - bkAfter.length;
    // CRM-kundar (om modulen er aktiv)
    const customers = Store.get("crm-customers", []) || [];
    const custAfter = customers.filter(function (c) { return (c.email || "").toLowerCase() !== email; });
    Store.set("crm-customers", custAfter);
    count += customers.length - custAfter.length;
    return count;
  }

  function adminLeads(body) {
    const allLeads = getLeads().filter(function (l) {
      return !l.message || l.message.indexOf("Tilbudsforesp") !== 0;
    });
    const active = getActiveStatuses("kontakt");
    const leads = allLeads.filter(function (l) { return active.indexOf(l.status || "ny") > -1; });
    const counts = { ny: 0, lest: 0, løst: 0 };
    allLeads.forEach(function (l) { counts[l.status || "ny"]++; });

    const rows = leads.length ? leads.map(function (l) {
      const st = l.status || "ny";
      const preview = (l.message || "").split("\n").filter(function (ln) { return ln.trim(); }).slice(0, 1).join("").slice(0, 90);
      return `
        <li class="admin-row admin-row--lead" data-id="${C.esc(l.id)}">
          <div class="admin-row__main">
            <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
              <strong>${C.esc(l.name)}</strong>
              <a href="mailto:${C.esc(l.email)}">${C.esc(l.email)}</a>
              ${statusBadge(st)}
              ${l.referenceNumber ? '<span class="crm-custnum">#' + l.referenceNumber + '</span>' : ""}
            </div>
            <details class="lead-details" data-lead-details="${C.esc(l.id)}">
              <summary>${C.esc(preview)}${preview.length === 90 ? "…" : ""}</summary>
              <div class="admin-lead-msg">${messageToHtml(l.message)}</div>
            </details>
            <span class="admin-row__meta">${formatDateTime(l.time)}</span>
          </div>
          <div class="admin-row__actions" style="flex-direction:column;align-items:flex-end;gap:.4rem">
            <div style="display:flex;gap:.4rem">
              ${C.button({ label: "Svar i e-post", icon: "mail-forward", variant: "primary", attrs: 'data-reply-lead="' + C.esc(l.id) + '"' })}
              ${C.button({ label: "Slett", variant: "ghost", attrs: 'data-del-lead="' + C.esc(l.id) + '"' })}
            </div>
            <select class="stat-select" data-status-select="${C.esc(l.id)}">
              ${STATUS_ORDER.map(function (s) { return `<option value="${s}" ${s===st?"selected":""}>${STATUS_LABELS[s]}</option>`; }).join("")}
            </select>
          </div>
        </li>`;
    }).join("") : '<li class="prose prose--muted" style="padding:.5rem 0">Ingen henvendingar med valgt status.</li>';

    body.innerHTML =
      `${emailTemplateCard("kontakt", "E-postmal for svar", DEFAULT_REPLY_TEMPLATE)}
       <div style="margin-bottom:1rem">${C.button({ label: "Eksporter henvendelser (CSV)", icon: "table-export", variant: "ghost", attrs: 'data-export-leads' })}</div>
       ${statusFilterBar("kontakt", counts)}
       <ul class="admin-list">${rows}</ul>
       <div class="crm-gdpr-box">
         <h4 class="crm-gdpr-title">${C.icon("shield")} Slett alle data på ein person</h4>
         <p class="crm-gdpr-desc">Skriv inn e-postadresse for å slette alle henvendingar, tilbod og bookingar knytt til denne personen (GDPR §17).</p>
         <form data-gdpr-form style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end">
           <div class="field" style="flex:1;min-width:220px;margin:0">
             <label for="gdpr-email">E-postadresse</label>
             <input type="email" id="gdpr-email" placeholder="person@eksempel.no" required>
           </div>
           ${C.button({ label: "Slett all data", icon: "trash", variant: "ghost", type: "submit", attrs: 'style="border-color:#c0392b;color:#c0392b"' })}
         </form>
         <p class="form__status" data-gdpr-status style="margin-top:.5rem"></p>
       </div>`;

    bindEmailTemplateCard(body, "kontakt", DEFAULT_REPLY_TEMPLATE);
    bindStatusFilterBar(body, "kontakt", function () { adminLeads(body); });

    // Variant B: eksplisitt klikk på «Vis hele meldingen» (details/summary) → Lest
    body.querySelectorAll("[data-lead-details]").forEach(function (det) {
      det.addEventListener("toggle", function () {
        if (!det.open) return;
        const id = det.getAttribute("data-lead-details");
        const lead = getLeads().find(function (l) { return l.id === id; });
        if (lead && (lead.status || "ny") === "ny") { setLeadStatus(id, "lest"); adminLeads(body); }
      });
    });

    const exportLeadsBtn = body.querySelector("[data-export-leads]");
    if (exportLeadsBtn) exportLeadsBtn.addEventListener("click", function () {
      downloadCsv(
        "kontakthenvendelser.csv",
        ["Referanse", "Navn", "E-post", "Melding", "Tidspunkt", "Status"],
        allLeads.map(function (l) { return [l.referenceNumber || "", l.name || "", l.email || "", cleanMessageText(l.message), formatDateTime(l.time), STATUS_LABELS[l.status || "ny"]]; })
      );
    });

    body.querySelectorAll("[data-reply-lead]").forEach(function (b) {
      b.addEventListener("click", function () {
        const id   = b.getAttribute("data-reply-lead");
        const lead = getLeads().find(function (l) { return l.id === id; });
        if (lead) {
          setLeadStatus(id, "løst");
          openReplyModal({
            name: lead.name, email: lead.email,
            subject: "Re: Henvendelse fra " + (lead.name || ""),
            templateKey: "kontakt", defaultTemplate: DEFAULT_REPLY_TEMPLATE,
            vars: { navn: lead.name || "", epost: lead.email || "", dato: formatDateTime(lead.time), melding: cleanMessageText(lead.message), referanse: lead.referenceNumber || "" },
            previewHtml: messageToHtml(lead.message)
          });
          adminLeads(body);
        }
      });
    });
    body.querySelectorAll("[data-status-select]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        setLeadStatus(sel.getAttribute("data-status-select"), sel.value);
        adminLeads(body);
      });
    });
    body.querySelectorAll("[data-del-lead]").forEach(function (b) {
      b.addEventListener("click", function () {
        const id = b.getAttribute("data-del-lead");
        saveLeads(getLeads().filter(function (l) { return l.id !== id; }));
        adminLeads(body);
      });
    });
    body.querySelector("[data-gdpr-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      const email = body.querySelector("#gdpr-email").value.trim();
      const st    = body.querySelector("[data-gdpr-status]");
      if (!confirm("Slett ALL data knytt til «" + email + "»? Dette kan ikkje angrast.")) return;
      const n = deleteByEmail(email);
      body.querySelector("#gdpr-email").value = "";
      if (n > 0) {
        st.textContent = "✓ Sletta " + n + " oppføring(ar) for " + email + ".";
        st.className = "form__status is-ok";
        adminLeads(body);
      } else {
        st.textContent = "Ingen data funne for " + email + ".";
        st.className = "form__status is-error";
      }
    });
  }

  /* --- Sikkerhetskopi: full eksport/import av ALT under sidens navnerom ----
     Alt (innhold, henvendelser, bookinger, kunder, bilder, innstillinger) ligger
     under samme localStorage-prefiks (NS + ":"), så en full kopi er bare å liste
     opp og dumpe alle disse nøklene — ingen spesialhåndtering pr. datatype. */
  function allStoreKeys() {
    const prefix = NS + ":";
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(prefix) === 0) keys.push(k.slice(prefix.length));
    }
    return keys;
  }
  function exportBackup() {
    const payload = buildBackupPayload();
    const stamp = new Date().toISOString().slice(0, 10);
    const slug  = ((CFG.company && CFG.company.name) || "side").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "side";
    downloadBlob("sikkerhetskopi-" + slug + "-" + stamp + ".json", JSON.stringify(payload, null, 2), "application/json");
  }
  function buildBackupPayload() {
    const keys = allStoreKeys();
    const data = {};
    keys.forEach(function (k) { data[k] = Store.get(k, null); });
    return {
      vibeverk_backup: true,
      version: 1,
      site: (CFG.company && CFG.company.name) || "",
      exportedAt: new Date().toISOString(),
      data: data
    };
  }
  // Skriver ALT fra et parset backup-objekt tilbake (full overskriving — fjerner
  // først alt eksisterende under navnerommet, slik at gjenoppretting blir et
  // eksakt speil av kopien, ikke en sammenslåing).
  function restoreBackupData(data) {
    allStoreKeys().forEach(function (k) { Store.remove(k); });
    Object.keys(data).forEach(function (k) { Store.set(k, data[k]); });
  }
  function importBackup(file, onDone) {
    const reader = new FileReader();
    reader.onerror = function () { onDone(false, "Kunne ikke lese filen."); };
    reader.onload = function () {
      let parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (e) { onDone(false, "Fila kunne ikke leses som JSON — er det en sikkerhetskopi fra denne siden?"); return; }
      if (!parsed || typeof parsed.data !== "object" || !parsed.data) {
        onDone(false, "Dette ser ikke ut som en gyldig sikkerhetskopi.");
        return;
      }
      restoreBackupData(parsed.data);
      onDone(true, "Sikkerhetskopi importert.");
    };
    reader.readAsText(file);
  }

  // Anslag på localStorage-kvote — konservativt (Safari er strammest med ~5 MB).
  const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;
  function storageUsageBytes() {
    let total = 0;
    const prefix = NS + ":";
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(prefix) === 0) total += k.length + (localStorage.getItem(k) || "").length;
    }
    return total;
  }

  function adminBackup(body) {
    function hasModule(id) { return modules.some(function (m) { return m.id === id; }); }
    const leads     = getLeads().filter(function (l) { return !l.message || l.message.indexOf("Tilbudsforesp") !== 0; });
    const quotes    = getLeads().filter(function (l) { return l.message && l.message.indexOf("Tilbudsforesp") === 0; });
    const bookings  = Store.get("booking-bookings",  []) || [];
    const customers = Store.get("crm-customers",     []) || [];
    const refs      = Store.get("ref-items",         []) || [];
    const faqs      = Store.get("faq-items",         []) || [];
    const images    = Store.get("mediabank-images",  []) || [];
    const mediaCount = allStoreKeys().filter(function (k) { return k.indexOf("media:") === 0 || k.indexOf("file:") === 0; }).length;

    const usedBytes = storageUsageBytes();
    const pct = Math.min(100, Math.round((usedBytes / STORAGE_QUOTA_BYTES) * 100));
    const usedMb = (usedBytes / (1024 * 1024)).toFixed(1);
    const level = pct >= 90 ? "high" : pct >= 70 ? "mid" : "low";
    const levelText = level === "high"
      ? "Lagringen er nesten full. Slett gamle bilder i Mediebank, eller eksporter en sikkerhetskopi og rydd opp i gamle henvendelser/bookinger."
      : level === "mid"
      ? "Lagringen begynner å fylles opp — verdt å holde et øye med, særlig om Mediebank vokser."
      : "God plass igjen.";

    const rows = [["Kontakthenvendelser", leads.length]];
    if (hasModule("tilbud"))     rows.push(["Tilbudsforespørsler", quotes.length]);
    if (hasModule("booking"))    rows.push(["Bookinger", bookings.length]);
    if (hasModule("crm"))        rows.push(["Kunder", customers.length]);
    if (hasModule("referanser")) rows.push(["Referanser", refs.length]);
    if (hasModule("faq"))        rows.push(["FAQ-spørsmål", faqs.length]);
    if (hasModule("mediabank"))  rows.push(["Bilder i Mediebank", images.length]);
    rows.push(["Opplastede bilder/filer totalt", mediaCount]);

    body.innerHTML = `
      <div class="bk-wrap">
        <h4 class="an-heading">Lagringsplass</h4>
        <div class="storage-meter" data-storage-level="${level}">
          <div class="storage-meter__bar"><div class="storage-meter__fill" style="width:${pct}%"></div></div>
          <p class="storage-meter__label">${usedMb} MB av ~5 MB brukt (${pct} %)</p>
        </div>
        <p class="prose prose--muted" style="margin:0 0 1.6rem">${levelText}</p>

        <h4 class="an-heading">Last ned sikkerhetskopi</h4>
        <p class="prose prose--muted" style="margin:0 0 .8rem">Laster ned ALT innhold på denne siden — tekst, bilder, henvendelser, bookinger, kunder og innstillinger — som én fil. Bruk denne jevnlig, og alltid før du gjør store endringer.</p>
        <ul class="backup-summary">
          ${rows.map(function (r) { return '<li><span>' + C.esc(r[0]) + '</span><strong>' + r[1] + '</strong></li>'; }).join("")}
        </ul>
        ${C.button({ label: "Last ned sikkerhetskopi", icon: "download", variant: "primary", attrs: 'data-backup-export' })}

        <h4 class="an-heading" style="margin-top:2rem">Importer sikkerhetskopi</h4>
        <p class="prose prose--muted" style="margin:0 0 .8rem">${C.icon("alert-triangle")} Dette overskriver ALT eksisterende innhold på denne siden med innholdet i fila. Kan ikke angres. Last ned en fersk sikkerhetskopi av nåværende innhold først hvis du er usikker.</p>
        <label class="btn btn--ghost backup-filebtn">
          ${C.icon("upload")} Velg sikkerhetskopi-fil
          <input type="file" accept="application/json" hidden data-backup-import>
        </label>
        <p class="form__status" data-backup-status style="margin-top:.6rem" role="status" aria-live="polite"></p>
      </div>`;

    body.querySelector("[data-backup-export]").addEventListener("click", exportBackup);
    body.querySelector("[data-backup-import]").addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const st = body.querySelector("[data-backup-status]");
      if (!confirm("Dette overskriver ALT eksisterende innhold på denne siden med innholdet i «" + file.name + "». Dette kan ikke angres. Er du sikker?")) {
        e.target.value = "";
        return;
      }
      importBackup(file, function (ok, msg) {
        if (ok) {
          st.textContent = msg + " Laster siden på nytt …";
          st.className = "form__status is-ok";
          setTimeout(function () { location.reload(); }, 700);
        } else {
          st.textContent = msg;
          st.className = "form__status is-error";
          e.target.value = "";
        }
      });
    });
  }

  /* --- Modal-hjelpere ------------------------------------------------------- */
  function bindModalClose(root) {
    root.querySelectorAll("[data-modal-close]").forEach(function (el) {
      el.addEventListener("click", closeAdmin);
    });
    document.addEventListener("keydown", escClose);
  }
  function escClose(e) {
    if (e.key === "Escape") { closeAdmin(); document.removeEventListener("keydown", escClose); }
  }

  function formatDateTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString("nb-NO", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return iso; }
  }

  // Formater meldingstekst til ren, lesbar e-posttekst (ingen === markeringer)
  function cleanMessageText(raw) {
    return (raw || "")
      .replace(/===\s*(.+?)\s*===/g, function (_, h) { return h; })
      .replace(/^Tilbudsforespørsel\n+/, "")
      // Legg strek under kjente overskrifter for betre lesbarheit i e-post
      .replace(/^(Jobbeskrivelse|Kontaktopplysninger|Vedlegg|JOBBESKRIVELSE|KONTAKTOPPLYSNINGER)$/gm,
        function (h) {
          var label = h.charAt(0).toUpperCase() + h.slice(1).toLowerCase();
          return label + "\n" + "─".repeat(label.length);
        })
      .trim();
  }

  // Kjente seksjonsoverskrifter (setningskasus, matcher begge formater)
  const KNOWN_HEADERS = ["Jobbeskrivelse", "Kontaktopplysninger", "Vedlegg",
    "JOBBESKRIVELSE", "KONTAKTOPPLYSNINGER"]; // bakoverkompatibilitet

  function messageToHtml(raw) {
    const cleaned = cleanMessageText(raw);
    const lines = cleaned.split("\n");
    let html = "";
    lines.forEach(function (line) {
      const t = line.trim();
      if (!t) { html += '<div style="height:.4rem"></div>'; return; }
      // Kjent seksjonsoverskrift
      if (KNOWN_HEADERS.indexOf(t) > -1) {
        const label = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
        html += '<p style="margin:1rem 0 .25rem;font-size:.88rem;font-weight:700;color:var(--color-primary)">' + C.esc(label) + '</p>';
        html += '<hr style="border:0;border-top:1px solid var(--color-border);margin:0 0 .4rem">';
        return;
      }
      // «Label: verdi» — bold label
      const colon = t.indexOf(": ");
      if (colon > 0 && colon <= 22 && !/\s/.test(t.slice(0, colon))) {
        html += '<p style="margin:.18rem 0;font-size:.88rem"><strong style="color:var(--color-text)">' +
          C.esc(t.slice(0, colon)) + ':</strong> ' + C.esc(t.slice(colon + 2)) + '</p>';
        return;
      }
      html += '<p style="margin:.2rem 0;font-size:.88rem;color:var(--color-muted)">' + C.esc(t) + '</p>';
    });
    return html;
  }

  /* --- E-postmaler (delt mellom Kontakt, Tilbud og Booking) -----------------
     Hver kontekst har sin egen redigerbare mal (lagret separat under
     "email-template-<key>"), med plassholdere som fylles inn automatisk.
     mailto støtter kun ren tekst, så malen er alltid en vanlig textarea —
     ikke rik-tekst-editoren. */
  function getEmailTemplate(key, fallback) {
    const v = Store.get("email-template-" + key, null);
    return (v === null || v === undefined) ? fallback : v;
  }
  function setEmailTemplate(key, value) { Store.set("email-template-" + key, value); }

  function fillTemplate(tpl, vars) {
    return String(tpl || "").replace(/\{(\w+)\}/g, function (m, key) {
      return (vars && vars[key] !== undefined) ? (vars[key] || "") : m;
    });
  }

  function buildMailtoUrl(email, subject, body) {
    let url = "mailto:" + encodeURIComponent(email || "") + "?subject=" + encodeURIComponent(subject || "");
    if (body) url += "&body=" + encodeURIComponent(body);
    return url;
  }

  /* --- Nedlasting / CSV-eksport (delt mellom Kontakt/CRM/Booking/Tilbud) -----
     CSV med UTF-8 BOM åpnes rett opp i Excel med riktige æøå, helt uten
     biblioteker. rows er en array av arrays (header + datarader). */
  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function toCsvValue(v) {
    const s = String(v == null ? "" : v).replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? '"' + s + '"' : s;
  }
  function downloadCsv(filename, headers, rows) {
    const lines = [headers.map(toCsvValue).join(",")].concat(
      rows.map(function (r) { return r.map(toCsvValue).join(","); })
    );
    downloadBlob(filename, "\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8");
  }

  // Genererer et unikt sekssifret tilfeldig nummer (100000–999999), med
  // kollisjonssjekk mot eksisterende nummer. Delt mellom CRM (kundenummer) og
  // Booking/Tilbud (referansenummer) — hver kontekst har sin egen pool, så det
  // holder å sjekke mot nummer av samme type.
  function generateUniqueNumber(existingNumbers) {
    const existing = new Set(existingNumbers || []);
    let n, attempts = 0;
    do {
      n = Math.floor(100000 + Math.random() * 900000);
      attempts++;
    } while (existing.has(n) && attempts < 50);
    return n;
  }

  const DEFAULT_REPLY_TEMPLATE =
    "Hei {navn},\n\n\n\n" +
    "─────────────────────────────────────\n" +
    "Fra: {navn} <{epost}>\n" +
    "Mottatt: {dato}\n" +
    "─────────────────────────────────────\n\n" +
    "{melding}";

  // Redigeringskort for en e-postmal — brukes i Kontakt/Tilbud/Booking sine
  // admin-faner. Kollapset (<details>) som standard, siden dette er noe man
  // setter opp én gang og sjelden går tilbake til.
  function emailTemplateCard(key, label, defaultTpl, hint) {
    const tpl = getEmailTemplate(key, defaultTpl);
    return `
      <details class="admin-form admin-form--card email-tpl-card">
        <summary>${C.icon("mail")} ${C.esc(label)}</summary>
        <div class="email-tpl-card__body">
          <p class="email-tpl-card__hint">${C.esc(hint || "Plassholdere fylles inn automatisk når e-posten åpnes. Mailto støtter kun ren tekst, ingen formatering.")}</p>
          <textarea data-email-tpl="${C.esc(key)}" rows="8">${C.esc(tpl)}</textarea>
          <div class="email-tpl-card__actions">
            ${C.button({ label: "Lagre mal", variant: "ghost", attrs: 'data-email-tpl-save="' + C.esc(key) + '"' })}
            ${C.button({ label: "Tilbakestill til standard", variant: "ghost", attrs: 'data-email-tpl-reset="' + C.esc(key) + '"' })}
            <span class="form__status" data-email-tpl-status="${C.esc(key)}"></span>
          </div>
        </div>
      </details>`;
  }
  function bindEmailTemplateCard(scope, key, defaultTpl) {
    const ta = scope.querySelector('[data-email-tpl="' + key + '"]');
    if (!ta) return;
    const saveBtn  = scope.querySelector('[data-email-tpl-save="' + key + '"]');
    const resetBtn = scope.querySelector('[data-email-tpl-reset="' + key + '"]');
    const status   = scope.querySelector('[data-email-tpl-status="' + key + '"]');
    function flash(msg) {
      if (!status) return;
      status.textContent = msg; status.className = "form__status is-ok";
      setTimeout(function () { if (status) status.textContent = ""; }, 1500);
    }
    if (saveBtn) saveBtn.addEventListener("click", function () { setEmailTemplate(key, ta.value); flash("Lagret."); });
    if (resetBtn) resetBtn.addEventListener("click", function () { ta.value = defaultTpl; setEmailTemplate(key, defaultTpl); flash("Tilbakestilt."); });
  }

  // Generisk svar-modal, brukt av Kontakt, Tilbud og Booking.
  // opts = { name, email, subject, templateKey, defaultTemplate, vars, previewHtml }
  function openReplyModal(opts) {
    const existing = document.getElementById("reply-modal-root");
    if (existing) existing.remove();

    const tpl      = getEmailTemplate(opts.templateKey, opts.defaultTemplate || DEFAULT_REPLY_TEMPLATE);
    const bodyText = fillTemplate(tpl, opts.vars || {}).slice(0, 1800);
    const mailtoFull  = buildMailtoUrl(opts.email, opts.subject, bodyText);
    const mailtoBlank = buildMailtoUrl(opts.email, opts.subject, "");

    const root = document.createElement("div");
    root.id = "reply-modal-root";
    root.innerHTML =
      '<div style="position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:1rem" data-reply-back>' +
        '<div style="background:var(--color-bg);border-radius:var(--radius);width:min(620px,100%);max-height:88vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.3rem;border-bottom:1px solid var(--color-border);position:sticky;top:0;background:var(--color-bg);z-index:1">' +
            '<strong style="font-size:1rem">Svar til ' + C.esc(opts.name || opts.email) + '</strong>' +
            '<button data-reply-close style="background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);line-height:1">&times;</button>' +
          '</div>' +
          '<div style="padding:1.1rem 1.3rem;border-bottom:1px solid var(--color-border)">' +
            '<p style="margin:0;font-size:.88rem"><strong>Til:</strong> &lt;<a href="mailto:' + C.esc(opts.email) + '" style="color:var(--color-primary)">' + C.esc(opts.email) + '</a>&gt;</p>' +
          '</div>' +
          (opts.previewHtml ? '<div style="padding:1.1rem 1.3rem;border-bottom:1px solid var(--color-border)">' + opts.previewHtml + '</div>' : '') +
          '<div style="padding:1rem 1.3rem;border-bottom:1px solid var(--color-border)">' +
            '<p style="margin:0;font-size:.8rem;color:var(--color-muted)">' +
              C.icon("info-circle") + ' E-posten åpnes som ren tekst.' +
            '</p>' +
          '</div>' +
          '<div style="padding:1rem 1.3rem;display:flex;gap:.7rem;flex-wrap:wrap;align-items:center">' +
            C.button({ label: "Åpne i Outlook", icon: "mail-forward", variant: "primary", href: mailtoFull }) +
            C.button({ label: "Åpne uten mal", variant: "ghost", href: mailtoBlank }) +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    root.querySelector("[data-reply-close]").addEventListener("click", function () { root.remove(); });
    root.querySelector("[data-reply-back]").addEventListener("click", function (e) { if (e.target === e.currentTarget) root.remove(); });
    document.addEventListener("keydown", function escClose(e) {
      if (e.key === "Escape") { root.remove(); document.removeEventListener("keydown", escClose); }
    });
  }

  /* ===========================================================================
     9) OPPSTART
     ======================================================================== */
  function init() {
    if (started) return;
    applySuperConfig();   // superconfig overstyrer CFG før alt anna
    loadContent();
    applyTheme();
    initAnalytics();              // injiser analytics-script hvis ID er satt
    registerBuiltinSections();
    currentView = route().view;
    render();
    started = true;
    bindGlobalNav();
    bindHelpIcons();
    window.addEventListener("hashchange", handleRoute);
    handleRoute();
  }

  // Delegert klikk-handtering for alle hjelpebobler (C.helpIcon) — bindes én gang
  // globalt, fungerer uansett hvor mange/hvilke admin-paneler som åpnes senere.
  function bindHelpIcons() {
    document.addEventListener("click", function (e) {
      const btn = e.target && e.target.closest ? e.target.closest("[data-help-toggle]") : null;
      document.querySelectorAll(".help-icon.is-open").forEach(function (h) {
        if (h !== btn) h.classList.remove("is-open");
      });
      if (btn) btn.classList.toggle("is-open");
    });
  }

  // Laster analytics-script basert på config.analytics.
  // Kjøres ved oppstart og kan kalles på nytt etter at admin lagrer ny ID.
  /* ===========================================================================
     SØK (site-wide, klient-side)
     ======================================================================== */
  function gatherSearchData() {
    const items = [];
    // Aktuelt
    resolvedPosts().forEach(function (p) {
      items.push({ type: "Aktuelt", title: p.title, text: C.stripHtml(p.text || ""), href: "#sak/" + p.id, meta: C.formatDate(p.date) });
    });
    // Tjenester
    (content.services || []).forEach(function (s) {
      items.push({ type: "Tjenester", title: s.title || "", text: C.stripHtml(s.text || ""), href: "#tjenester" });
    });
    // Om oss
    if (content.about && content.about.text) {
      items.push({ type: "Om oss", title: "Om oss", text: C.stripHtml(content.about.text), href: "#om-oss" });
    }
    // FAQ
    const faqItems = Store.get("faq-items", []) || [];
    faqItems.forEach(function (f) {
      items.push({ type: "FAQ", title: f.question || "", text: C.stripHtml(f.answer || ""), href: "#faq" });
    });
    // Referanser
    const refs = Store.get("ref-items", []) || [];
    refs.forEach(function (r) {
      items.push({ type: "Referanser", title: r.name || "", text: C.stripHtml(r.text || "") + " " + (r.category || ""), href: "#referanser/" + r.id });
    });
    // Mediebank
    const mbImages = Store.get("mediabank-images", []) || [];
    mbImages.forEach(function (m) {
      items.push({ type: "Mediebank", title: C.stripHtml(m.description || "").slice(0, 60) || "Bilde", text: C.stripHtml(m.description || "") + " " + (m.tags || []).join(" "), href: "#mediabank" });
    });
    return items;
  }

  function openSearch() {
    const existing = document.getElementById("search-overlay");
    if (existing) { existing.querySelector("[data-search-input]").focus(); return; }

    const overlay = document.createElement("div");
    overlay.id = "search-overlay";
    overlay.innerHTML =
      '<div class="srch-back" data-srch-close></div>' +
      '<div class="srch-panel">' +
        '<div class="srch-head">' +
          '<span class="srch-icon">' + C.icon("search") + '</span>' +
          '<input type="search" class="srch-input" data-search-input placeholder="Søk på hele siden…" autocomplete="off" spellcheck="false">' +
          '<button class="srch-x" data-srch-close aria-label="Lukk">' + C.icon("x") + '</button>' +
        '</div>' +
        '<div class="srch-results" data-srch-results></div>' +
      '</div>';
    document.body.appendChild(overlay);

    const input   = overlay.querySelector("[data-search-input]");
    const results = overlay.querySelector("[data-srch-results]");
    const data    = gatherSearchData();

    function close() { overlay.remove(); }
    overlay.querySelectorAll("[data-srch-close]").forEach(function (b) { b.addEventListener("click", close); });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
    });

    function search(q) {
      q = q.trim().toLowerCase();
      if (!q) { results.innerHTML = ""; return; }
      const hits = data.filter(function (d) {
        return (d.title + " " + d.text).toLowerCase().includes(q);
      });
      if (!hits.length) {
        results.innerHTML = '<p class="srch-empty">Ingen treff på «' + C.esc(q) + '».</p>';
        return;
      }
      // Grupper etter type
      const groups = {};
      hits.forEach(function (h) {
        if (!groups[h.type]) groups[h.type] = [];
        groups[h.type].push(h);
      });
      results.innerHTML = Object.keys(groups).map(function (type) {
        const rows = groups[type].map(function (h) {
          // Uthev treffet i teksten
          const preview = h.text.replace(
            new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi"),
            "<mark>$1</mark>"
          ).slice(0, 120);
          return '<a class="srch-hit" href="' + C.esc(h.href) + '" data-srch-hit>' +
            '<span class="srch-hit__title">' + C.esc(h.title) + (h.meta ? ' <span class="srch-hit__meta">' + C.esc(h.meta) + '</span>' : '') + '</span>' +
            (preview ? '<span class="srch-hit__text">' + preview + '…</span>' : '') +
          '</a>';
        }).join("");
        return '<div class="srch-group"><p class="srch-group__label">' + C.esc(type) + '</p>' + rows + '</div>';
      }).join("");

      // Klikk: navigér og lukk
      results.querySelectorAll("[data-srch-hit]").forEach(function (a) {
        a.addEventListener("click", function () { close(); });
      });
    }

    input.addEventListener("input", function () { search(input.value); });
    setTimeout(function () { input.focus(); }, 50);
  }

  /* ===========================================================================
     SUPER-ADMIN  (berre for Vibeverk — trippelklikk «Levert av Vibeverk»)
     ======================================================================== */
  const SUPER_PASS = "Superadmin";
  const SUPER_KEY  = "superconfig";

  // Sett sammen et forslag til personvernerklæring basert på hvilke moduler/
  // funksjoner som faktisk er aktive — så en kunde uten Tilbud/Booking ikke får
  // tekst som nevner ting de ikke har. Brukes som startpunkt (kun ved første
  // oppstart, før noe er lagret) og av «Generer forslag på nytt»-knappen i
  // super-admin. Når noe er lagret, er det den lagra teksten som gjelder —
  // dette skriver aldri over en allerede lagra (også tom) personvernstekst.
  function computeDefaultPrivacyText() {
    const hasTilbud  = modules.some(function (m) { return m.id === "tilbud"; });
    const hasBooking = modules.some(function (m) { return m.id === "booking"; });
    const an = Store.get("analytics", null) || (CFG.analytics || {});
    const hasAnalytics = !!(an.plausible || an.plausibleEmbed);

    const collectBits = ["en henvendelse"];
    if (hasTilbud)  collectBits.push("ber om tilbud");
    if (hasBooking) collectBits.push("reserverer en booking");
    const collectPhrase = collectBits.length > 1
      ? collectBits.slice(0, -1).join(", ") + " eller " + collectBits[collectBits.length - 1]
      : collectBits[0];

    const storedBits = ["henvendelser"];
    if (hasTilbud)  storedBits.push("tilbud");
    if (hasBooking) storedBits.push("bookinger");
    const storedPhrase = storedBits.length > 1
      ? storedBits.slice(0, -1).join(", ") + " og " + storedBits[storedBits.length - 1]
      : storedBits[0];

    const cookieText = hasAnalytics
      ? "Ja, vi bruker Plausible Analytics for trafikkstatistikk — et personvernvennlig analyseverktøy uten sporingscookies, som ikke samler inn personidentifiserbar informasjon om besøkende."
      : "Nei. Denne siden bruker ingen cookies eller analyseverktøy som samler inn personopplysninger.";

    return "Når du sender oss " + collectPhrase + ", lagrer vi opplysningene du selv oppgir — typisk navn, e-postadresse, telefonnummer og innholdet i meldingen eller bestillingen din. Opplysningene brukes utelukkende til å besvare henvendelsen din eller behandle bestillingen, og deles ikke med tredjeparter for markedsføringsformål.\n\n" +
      "Hvor lagres opplysningene?\n" +
      "Nettsiden er bygget som en statisk side og driftes via GitHub Pages. Innsendte opplysninger lagres i en database hos Supabase, med servere i EU.\n\n" +
      "Bruker vi cookies?\n" + cookieText + "\n\n" +
      "Hvor lenge lagres opplysningene?\n" +
      "Vi oppbevarer " + storedPhrase + " så lenge det er nødvendig for å følge opp saken din. Du kan når som helst be om at opplysningene dine slettes.\n\n" +
      "Dine rettigheter\n" +
      "Du har rett til innsyn i hvilke opplysninger vi har lagret om deg, samt rett til å få disse korrigert eller slettet, i tråd med personopplysningsloven/GDPR. For å be om innsyn eller sletting, ta kontakt via kontaktinformasjonen på denne siden og merk henvendelsen «Personvern». Vi sletter opplysningene dine uten ugrunnet opphold.\n\n" +
      "Samtykke\n" +
      "Ved å sende inn dette skjemaet samtykker du til at vi behandler opplysningene dine slik beskrevet over.";
  }

  function getSuperConfig() { return Store.get(SUPER_KEY, {}) || {}; }
  function saveSuperConfig(v) {
    Store.set(SUPER_KEY, v);
    // Slå saman med CFG og oppdater sida
    const sc = v || {};
    if (sc.company)  Object.assign(CFG.company,  sc.company);
    if (sc.colors)   Object.assign(CFG.colors,   sc.colors);
    if (sc.fonts)    Object.assign(CFG.fonts,     sc.fonts);
    if (sc.features) Object.assign(CFG.features,  sc.features);
    if (sc.intranettFeatures && CFG.intranettFeatures) Object.assign(CFG.intranettFeatures, sc.intranettFeatures);
    if (sc.privacy)  Object.assign(CFG.privacy,   sc.privacy);
    if (sc.adminPassword) CFG.admin.password = sc.adminPassword;
    if (sc.employeePassword !== undefined) CFG.admin.employeePassword = sc.employeePassword;
    applyTheme(); render();
  }

  // Bruk lagra super-config ved oppstart
  function applySuperConfig() {
    const sc = getSuperConfig();
    if (sc.company)  Object.assign(CFG.company,  sc.company);
    if (sc.colors)   Object.assign(CFG.colors,   sc.colors);
    if (sc.fonts)    Object.assign(CFG.fonts,     sc.fonts);
    if (sc.features) Object.assign(CFG.features,  sc.features);
    if (sc.privacy)  Object.assign(CFG.privacy,   sc.privacy);
    else             CFG.privacy.text = computeDefaultPrivacyText();   // aldri lagra → modul-bevisst forslag
    if (sc.adminPassword) CFG.admin.password = sc.adminPassword;
    if (sc.employeePassword !== undefined) CFG.admin.employeePassword = sc.employeePassword;
  }

  function openSuperAdmin(adminRoot) {
    const existing = document.getElementById("super-admin-root");
    if (existing) { existing.remove(); return; }

    const wrap = document.createElement("div");
    wrap.id = "super-admin-root";
    wrap.style.cssText = "position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:1rem";
    wrap.innerHTML =
      '<div style="background:var(--color-bg);border-radius:var(--radius);width:min(720px,97vw);max-height:92vh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.4)">' +
        '<div style="padding:1.1rem 1.4rem;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:var(--color-bg);z-index:1">' +
          '<strong>⚙ Super-admin — Vibeverk</strong>' +
          '<button data-sa-close style="background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);padding:.2rem .5rem;border-radius:6px" title="Lukk">&times;</button>' +
        '</div>' +
        '<div data-sa-body style="padding:1.3rem"></div>' +
      '</div>';
    document.body.appendChild(wrap);

    let saHasUnsaved = false;

    function closeSuperAdmin() {
      if (saHasUnsaved) {
        const choice = confirm("Du har ulagra endringar. Lagre før du lukkar?");
        if (choice) {
          const form = wrap.querySelector("[data-sa-form]");
          if (form) form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        }
      }
      wrap.remove();
    }

    const body = wrap.querySelector("[data-sa-body]");
    wrap.querySelector("[data-sa-close]").addEventListener("click", closeSuperAdmin);
    // IKKJE lukk ved klikk utanfor — brukar MÅ bruke krysset
    document.addEventListener("keydown", function saEsc(e) {
      if (e.key === "Escape") { closeSuperAdmin(); document.removeEventListener("keydown", saEsc); }
    });

    // Passordsjekk
    body.innerHTML =
      '<form data-sa-login>' +
        '<p style="margin:0 0 1rem;color:var(--color-muted);font-size:.92rem">Skriv inn super-admin-passord for å redigere konfigurasjon.</p>' +
        C.field({ id:"sa-pass", label:"Passord", type:"password", required:true }) +
        '<div style="margin-top:.8rem">' + C.button({ label:"Logg inn", type:"submit", variant:"primary" }) + '</div>' +
        '<p class="form__status" data-sa-status style="margin-top:.6rem"></p>' +
      '</form>';
    body.querySelector("[data-sa-login]").addEventListener("submit", function (e) {
      e.preventDefault();
      if (body.querySelector("#sa-pass").value !== SUPER_PASS) {
        const st = body.querySelector("[data-sa-status]");
        st.textContent = "Feil passord."; st.className = "form__status is-error"; return;
      }
      renderSuperAdminForm(body);
    });
    setTimeout(function () { const i = body.querySelector("#sa-pass"); if (i) i.focus(); }, 50);
  }

  let saActiveTab = "utseende";

  // Kuratert utvalg fontpar — rask-velg som fyller inn fritekstfelta under.
  // Fritekstfelta er framleis kilden til sanninga; dette er berre ein snarvei.
  const FONT_PAIRS = [
    { label: "Syne + Inter",                     display: "Syne",              body: "Inter" },
    { label: "Playfair Display + Source Sans 3", display: "Playfair Display",  body: "Source Sans 3" },
    { label: "Space Grotesk + Work Sans",        display: "Space Grotesk",     body: "Work Sans" },
    { label: "Fraunces + Karla",                 display: "Fraunces",          body: "Karla" },
    { label: "Poppins + Nunito Sans",             display: "Poppins",          body: "Nunito Sans" }
  ];

  function renderSuperAdminForm(body) {
    const sc   = getSuperConfig();
    const col  = Object.assign({}, CFG.colors,   sc.colors   || {});
    const com  = Object.assign({}, CFG.company,  sc.company  || {});
    const fnt  = Object.assign({}, CFG.fonts,    sc.fonts    || {});
    const ft   = Object.assign({}, CFG.features, sc.features || {});
    const meta = sc.meta || {};
    const an   = Store.get("analytics", null) || (CFG.analytics || {});
    const priv = Object.assign({}, CFG.privacy, sc.privacy || {});

    const featFields = Object.keys(CFG.features || {}).map(function (k) {
      const on = (ft[k] !== false);
      return `<label style="display:flex;align-items:center;gap:.5rem;font-size:.9rem;cursor:pointer">
        <input type="checkbox" data-sa-feat="${C.esc(k)}" ${on?"checked":""}> ${C.esc(k)}
      </label>`;
    }).join("");
    const ift = Object.assign({}, CFG.intranettFeatures, sc.intranettFeatures || {});
    const intranettFeatFields = Object.keys(CFG.intranettFeatures || {}).map(function (k) {
      const on = (ift[k] !== false);
      return `<label style="display:flex;align-items:center;gap:.5rem;font-size:.9rem;cursor:pointer">
        <input type="checkbox" data-sa-ifeat="${C.esc(k)}" ${on?"checked":""}> ${C.esc(k)}
      </label>`;
    }).join("");

    const saTabs = [
      { id: "utseende",   label: "Utseende" },
      { id: "analyse",    label: "Analyse" },
      { id: "personvern", label: "Personvern" },
      { id: "funksjoner", label: "Funksjoner" },
      { id: "system",     label: "System" }
    ];
    const saTabsHtml = `<div class="tabs" role="tablist">` + saTabs.map(function (t) {
      return `<button type="button" class="tab ${t.id === saActiveTab ? "is-active" : ""}" data-sa-tab="${t.id}">${C.esc(t.label)}</button>`;
    }).join("") + `</div>`;

    function pane(id, html) {
      return `<div class="sa-pane" data-sa-pane="${id}" style="${id === saActiveTab ? "" : "display:none"}">${html}</div>`;
    }

    body.innerHTML =
      saTabsHtml +
      '<form data-sa-form>' +
        pane("utseende",
          '<fieldset class="admin-group"><legend>Firma</legend>' +
            C.field({ id:"sa-name",    label:"Firmanavn",  value: com.name    || "" }) +
            C.field({ id:"sa-tagline", label:"Tagline",    value: com.tagline || "" }) +
            C.field({ id:"sa-logo",    label:"Logo-URL",   value: com.logoUrl || "", placeholder:"https://…" }) +
          '</fieldset>' +
          '<fieldset class="admin-group"><legend>SEO og deling</legend>' +
            '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Vises i søkeresultater og som forhåndsvisning når en lenke til siden deles. Bilde/favicon må være ekte, offentlig tilgjengelige URL-er (f.eks. fra GitHub Pages) — IKKE data-URL fra bildefeltet, eksterne crawlere kan ikke lese localStorage.</p>' +
            C.field({ id:"sa-metadesc", label:"Meta-beskrivelse", multiline:true, rows:2, value: com.metaDescription || "", placeholder:"Kort beskrivelse, 1–2 setninger" }) +
            C.field({ id:"sa-ogimage", label:"Delingsbilde (OG-bilde)", value: com.ogImage || "", placeholder:"https://… (anbefalt ca. 1200×630px)" }) +
            C.field({ id:"sa-favicon", label:"Favicon-URL", value: com.favicon || "", placeholder:"https://…" }) +
          '</fieldset>' +
          '<fieldset class="admin-group"><legend>Fargar</legend>' +
            '<div class="bk-2col">' +
              `<div class="field"><label>Primærfarge</label><input type="color" id="sa-primary" value="${C.esc(col.primary||"#1a7a6e")}"></div>` +
              `<div class="field"><label>Sekundærfarge</label><input type="color" id="sa-secondary" value="${C.esc(col.secondary||"#c17f3e")}"></div>` +
            '</div>' +
            `<div class="field"><label>Bakgrunnsfarge</label><input type="color" id="sa-bg" value="${C.esc(col.background||"#fbfaf8")}"></div>` +
            '<div class="bk-2col">' +
              `<div class="field"><label>Tekstfarge</label><input type="color" id="sa-text" value="${C.esc(col.text||"#1B1B1F")}"></div>` +
              `<div class="field"><label>Overflate-farge (kort, paneler)</label><input type="color" id="sa-surface" value="${C.esc(col.surface||"#ffffff")}"></div>` +
            '</div>' +
          '</fieldset>' +
          '<fieldset class="admin-group"><legend>Fontar</legend>' +
            '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Skriv inn Google Fonts-namn og dei weights du treng. Sida brukar: display <strong>600, 700, 800</strong> · brødtekst <strong>400, 500, 600</strong>.</p>' +
            '<div class="fontpair-row">' +
              FONT_PAIRS.map(function (p, i) {
                return `<button type="button" class="fontpair-btn" data-fontpair="${i}">${C.esc(p.label)}</button>`;
              }).join("") +
            '</div>' +
            '<div class="bk-2col">' +
              C.field({ id:"sa-dfont", label:"Display-font", value: fnt.display || "", placeholder:"Syne" }) +
              C.field({ id:"sa-dweights", label:"Weights (komma)", value: (fnt.weights && fnt.weights.display ? fnt.weights.display.join(",") : "600,700,800"), placeholder:"600,700,800", hint:"Typisk for overskrifter" }) +
            '</div>' +
            '<div class="bk-2col">' +
              C.field({ id:"sa-bfont", label:"Brødtekst-font", value: fnt.body || "", placeholder:"Inter" }) +
              C.field({ id:"sa-bweights", label:"Weights (komma)", value: (fnt.weights && fnt.weights.body ? fnt.weights.body.join(",") : "400,500,600"), placeholder:"400,500,600", hint:"Typisk for brødtekst" }) +
            '</div>' +
          '</fieldset>'
        ) +
        pane("analyse",
          '<fieldset class="admin-group"><legend>Analyse og integrasjoner</legend>' +
            '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Berre synleg her. Kunden ser kun resultatet i Analyse-fanen i sin admin.</p>' +
            C.field({ id:"sa-an-tawk", label:"Tidio – Public Key", value: an.tawkto || "", placeholder:"abc123defg456",
              hint:"Finn Public Key under Settings → General i Tidio. Berre nøkkelen, ikkje heile URL-en. Ingen cookies — EU/EEA-serverar." }) +
            C.field({ id:"sa-an-pl",      label:"Plausible – domenenavn", value: an.plausible || "", placeholder:"nordpunkt.no" }) +
            C.field({ id:"sa-an-plembed", label:"Plausible – delt lenke for innebygd dashboard", value: an.plausibleEmbed || "", placeholder:"https://plausible.io/share/nordpunkt.no?auth=xxxxx",
                        hint:"Plausible → Site Settings → Visibility → Embed dashboard. Vises direkte i kundens Analyse-fane." }) +
          '</fieldset>'
        ) +
        pane("personvern",
          '<fieldset class="admin-group"><legend>Personvernerklæring</legend>' +
            '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Vises i popup på kontaktskjema, booking og tilbud, samt via «Personvern»-lenken i footer.</p>' +
            C.field({ id:"sa-priv-heading", label:"Overskrift", value: priv.heading || "" }) +
            C.richTextField({ id:"sa-priv-text", label:"Tekst", value: priv.text || "" }) +
            '<div style="margin-top:.6rem">' +
              C.button({ label:"Generer forslag på nytt", variant:"ghost", attrs:'data-priv-regen' }) +
              '<p style="font-size:.78rem;color:var(--color-muted);margin:.4rem 0 0">Lager et nytt forslag basert på modulene som er aktive nå (Tilbud/Booking/analyse). Overskriver kun feltet over — lagres ikke før du selv trykker «Lagre og bruk».</p>' +
            '</div>' +
          '</fieldset>'
        ) +
        pane("funksjoner",
          '<fieldset class="admin-group"><legend>Nettside</legend>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem">' + featFields + '</div>' +
          '</fieldset>' +
          '<fieldset class="admin-group" style="margin-top:.8rem"><legend>Intranett</legend>' +
            '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Låste modular (Dashboard, Oppgåver, Innstillingar) er alltid på og visast ikkje her. Skrur du av alle, kan kunden framleis logge inn men ser berre tomme modular.</p>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem">' + intranettFeatFields + '</div>' +
          '</fieldset>'
        ) +
        pane("system",
          '<fieldset class="admin-group"><legend>Admin-passord (for kunden)</legend>' +
            C.field({ id:"sa-apass", label:"Passord (full adgang)", value: CFG.admin && CFG.admin.password || "" }) +
            C.field({ id:"sa-emp-pass", label:"Ansattpassord (valgfritt)", value: (CFG.admin && CFG.admin.employeePassword) || "", hint:"Gir adgang til kun Kontakt/Tilbud/Booking/Kunder — ikke innhold eller innstillinger. La stå tomt for å skru av." }) +
          '</fieldset>' +
          '<fieldset class="admin-group"><legend>Vibeverk-referanse</legend>' +
            '<p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Berre for internt bruk — ikkje synleg for kunden noko sted.</p>' +
            C.field({ id:"sa-github", label:"GitHub-repo URL", value: meta.githubUrl || "", placeholder:"https://github.com/brukernavn/repo" }) +
          '</fieldset>' +
          '<fieldset class="admin-group"><legend>Faresone</legend>' +
            C.button({ label:"Nullstill alt", variant:"ghost", attrs:'data-sa-reset style="border-color:#c0392b;color:#c0392b"' }) +
          '</fieldset>'
        ) +
        '<div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-top:1.2rem">' +
          C.button({ label:"Lagre og bruk", type:"submit", variant:"primary" }) +
        '</div>' +
        '<p class="form__status" data-sa-status style="margin-top:.6rem"></p>' +
      '</form>';

    body.querySelectorAll("[data-sa-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        saActiveTab = btn.getAttribute("data-sa-tab");
        body.querySelectorAll("[data-sa-tab]").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        body.querySelectorAll("[data-sa-pane]").forEach(function (p) {
          p.style.display = (p.getAttribute("data-sa-pane") === saActiveTab) ? "" : "none";
        });
      });
    });
    bindRichTextFields(body);

    // Fontpar rask-velg: fyller inn fritekstfelta (som framleis er kilden til sanninga)
    body.querySelectorAll("[data-fontpair]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const p = FONT_PAIRS[parseInt(btn.getAttribute("data-fontpair"), 10)];
        if (!p) return;
        body.querySelector("#sa-dfont").value = p.display;
        body.querySelector("#sa-bfont").value = p.body;
        body.querySelector("#sa-dweights").value = "600,700,800";
        body.querySelector("#sa-bweights").value = "400,500,600";
        saHasUnsaved = true;
      });
    });

    // Personvernerklæring: regenerer forslag basert på moduler/analyse som er aktive NÅ
    const privRegenBtn = body.querySelector("[data-priv-regen]");
    if (privRegenBtn) privRegenBtn.addEventListener("click", function () {
      const wrap = body.querySelector("#sa-priv-text").closest("[data-rtfield]");
      const editor = wrap.querySelector("[data-rt-editor]");
      editor.innerHTML = textToRichHtml(computeDefaultPrivacyText());
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      saHasUnsaved = true;
    });

    body.querySelector("[data-sa-reset]").addEventListener("click", function () {
      if (!confirm("Nullstill all super-admin-konfig og gå tilbake til config.js-verdiane?")) return;
      Store.remove(SUPER_KEY);
      location.reload();
    });

    // Marker som endra ved kvar inputendring
    body.querySelectorAll("input, textarea").forEach(function (el) {
      el.addEventListener("input", function () { saHasUnsaved = true; });
      el.addEventListener("change", function () { saHasUnsaved = true; });
    });

    body.querySelector("[data-sa-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      const feats = {};
      body.querySelectorAll("[data-sa-feat]").forEach(function (cb) {
        feats[cb.getAttribute("data-sa-feat")] = cb.checked;
      });
      const ifeats = {};
      body.querySelectorAll("[data-sa-ifeat]").forEach(function (cb) {
        ifeats[cb.getAttribute("data-sa-ifeat")] = cb.checked;
      });
      const newSC = {
        company:  { name: body.querySelector("#sa-name").value.trim(),
                    tagline: body.querySelector("#sa-tagline").value.trim(),
                    logoUrl: body.querySelector("#sa-logo").value.trim(),
                    metaDescription: body.querySelector("#sa-metadesc").value.trim(),
                    ogImage: body.querySelector("#sa-ogimage").value.trim(),
                    favicon: body.querySelector("#sa-favicon").value.trim() },
        colors:   { primary:    body.querySelector("#sa-primary").value,
                    secondary:  body.querySelector("#sa-secondary").value,
                    background: body.querySelector("#sa-bg").value,
                    text:       body.querySelector("#sa-text").value,
                    surface:    body.querySelector("#sa-surface").value },
        fonts: {
          display:  body.querySelector("#sa-dfont").value.trim(),
          body:     body.querySelector("#sa-bfont").value.trim(),
          weights: {
            display: body.querySelector("#sa-dweights").value.split(",").map(function (w) { return parseInt(w.trim(), 10); }).filter(Boolean),
            body:    body.querySelector("#sa-bweights").value.split(",").map(function (w) { return parseInt(w.trim(), 10); }).filter(Boolean)
          }
        },
        adminPassword: body.querySelector("#sa-apass").value,
        employeePassword: body.querySelector("#sa-emp-pass").value,
        features: feats,
        intranettFeatures: ifeats,
        meta: { githubUrl: body.querySelector("#sa-github").value.trim() },
        privacy: {
          heading: body.querySelector("#sa-priv-heading").value.trim(),
          text:    readRichTextField(body, "sa-priv-text")
        }
      };
      saveSuperConfig(newSC);

      // Analyse-innstillingar lagres separat (samme nøkkel som adminAnalyse/initAnalytics leser)
      Store.set("analytics", {
        tawkto:          body.querySelector("#sa-an-tawk")    ? body.querySelector("#sa-an-tawk").value.trim()    : (an.tawkto    || ""),
        plausible:       body.querySelector("#sa-an-pl").value.trim(),
        plausibleEmbed:  body.querySelector("#sa-an-plembed").value.trim()
      });
      initAnalytics();

      saHasUnsaved = false;
      const st = body.querySelector("[data-sa-status]");
      st.textContent = "✓ Lagra! Endringar er aktivert."; st.className = "form__status is-ok";
      setTimeout(function () { if (st) st.textContent = ""; }, 3000);
    });
  }

  function initAnalytics() {
    const a  = Store.get("analytics", null) || (CFG.analytics || {});
    const pl = (a.plausible || "").trim();
    const tw = (a.tawkto    || "").trim();

    if (pl && !document.getElementById("_pl-script")) {
      const s2 = document.createElement("script");
      s2.id            = "_pl-script";
      s2.src           = "https://plausible.io/js/script.js";
      s2.defer         = true;
      s2.setAttribute("data-domain", pl);
      document.head.appendChild(s2);
    }

    // Tidio live chat — lastast berre på offentleg side (ikkje i intranettet)
    // Tidio brukar ikkje cookies, lagrar i localStorage, EU/EEA-serverar
    if (tw && !document.getElementById("_tidio-script") && !document.getElementById("intranet")) {
      var s3   = document.createElement("script");
      s3.id    = "_tidio-script";
      s3.async = true;
      s3.src   = "//code.tidio.co/" + tw.trim() + ".js";
      document.head.appendChild(s3);
    }
  }

  // Standardseksjonene registreres på nøyaktig samme måte som en framtidig
  // modul ville gjort — det er det som gjør arkitekturen utvidbar.
  function registerBuiltinSections() {
    registerModule({ id: "hjem",     label: "Hjem",     order: 10,
      render: function () {
        return C.hero(Object.assign({}, CFG.hero, content.hero, { image: Media.resolveImage(content.hero.image) }));
      } });

    registerModule({ id: "om-oss",   label: "Om oss",   order: 20,
      render: function () {
        return C.about(Object.assign({}, CFG.about, {
          text: content.about.text, image: Media.resolveImage(content.about.image)
        }));
      } });

    registerModule({ id: "tjenester", label: "Tjenester", order: 30,
      render: function () {
        const cards = content.services.map(function (c) {
          return Object.assign({}, c, { image: Media.resolveImage(c.image) });
        });
        return C.services(Object.assign({}, CFG.services, { cards: cards }));
      } });

    registerModule({ id: "aktuelt",  label: "Aktuelt",  order: 40,
      render: function () {
        const all = resolvedPosts();
        if (feat("newsArchive")) {
          const n = CFG.news.frontCount || 3;
          return C.news(CFG.news, all.slice(0, n), { teaser: true, total: all.length, frontCount: n });
        }
        return C.news(CFG.news, all, {});   // ingen arkiv: vis alle i full lengde
      } });

    registerModule({ id: "kontakt",  label: "Kontakt",  order: 50,
      render: function () {
        // extra og sosiale lenker fra redigerbar tilstand (kan slås av med feature-flagg)
        return C.contact(CFG.contactSection, Object.assign({}, content.contact, {
          social: feat("social") ? content.contact.social : null
        }));
      } });
  }

  /* --- Offentlig API -------------------------------------------------------- */
  return {
    init: init,
    registerModule: registerModule,   // ← brukes av modulfiler
    // Praktiske kroker for moduler/integrasjoner:
    store: Store,                      // namespacet localStorage (get/set/remove)
    media: Media,                      // bilde-/filhåndtering (put, resolveImage, putFile, ...)
    feature: feat,                     // les feature-flagg
    getContent: function () { return content; },
    getLeads: getLeads,
    addLead: addLead,                  // lagre en henvendelse (lead)
    openAdmin: openAdmin,
    prefillContact: prefillContact,
    openReplyModal: openReplyModal,
    // E-postmaler (delt mellom Kontakt/Tilbud/Booking)
    getEmailTemplate:    getEmailTemplate,
    setEmailTemplate:    setEmailTemplate,
    fillTemplate:        fillTemplate,
    buildMailtoUrl:      buildMailtoUrl,
    emailTemplateCard:   emailTemplateCard,
    bindEmailTemplateCard: bindEmailTemplateCard,
    DEFAULT_REPLY_TEMPLATE: DEFAULT_REPLY_TEMPLATE,
    computeDefaultPrivacyText: computeDefaultPrivacyText,
    downloadBlob: downloadBlob,
    toCsvValue:   toCsvValue,
    downloadCsv:  downloadCsv,
    generateUniqueNumber: generateUniqueNumber,
    // Sikkerhetskopi (full eksport/import av alt under sidens navnerom)
    buildBackupPayload: buildBackupPayload,
    restoreBackupData:  restoreBackupData,
    importBackup:       importBackup,
    allStoreKeys:        allStoreKeys,
    storageUsageBytes:   storageUsageBytes,
    // Status-system (Ny/Lest/Løst) — for bruk i moduler (Tilbud, Booking)
    statusBadge:          statusBadge,
    statusFilterBar:      statusFilterBar,
    getActiveStatuses:    getActiveStatuses,
    bindStatusFilterBar:  bindStatusFilterBar,
    setLeadStatus:        setLeadStatus,
    STATUS_LABELS:        STATUS_LABELS,
    STATUS_ORDER:         STATUS_ORDER,
    // Gjenbrukbare UI-verktøy (bildefelt med beskjæring) for moduler:
    ui: {
      imageField:      imgField,
      bindImageFields: bindImageFields,
      readImageField:  readImageField,
      attachField:     function (id, existing) {   // vedleggsfelt-HTML
        return C.attachField({ id: id, value: JSON.stringify(existing || []) });
      },
      bindAttachField:  bindAttachField,            // kobler opp vedleggsfelt
      readAttachments:  readAttachments,            // (scope, id) → []
      bindTerms:        bindTerms,                  // (container, idPrefix) — kobler opp vilkår-popup
      termsAccepted:    termsAccepted,               // (container, idPrefix) → bool
      bindRichTextFields: bindRichTextFields,        // kobler opp verktøylinje for alle rik-tekst-felt i et område
      readRichTextField: readRichTextField           // (scope, id) → sanert HTML-streng
    }
  };
})();

// Start når DOM er klar (etter at config.js og components.js er lastet)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { window.App.init(); });
} else {
  window.App.init();
}
