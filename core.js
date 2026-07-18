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

  // ─── STANDARDSKJEMA FOR NESTA CFG-FELT ─────────────────────────────────────
  // Fase 6-tenantar (api/tenant-config.js) genererer eit minimalt SITE_CONFIG-
  // skjelett (berre supabase/storageKey/productMode/features/intranettFeatures/
  // theme) — resten av core.js (applyTheme, applySuperConfig, loadContent, m.m.)
  // føreset at company/colors/fonts/features/intranettFeatures/privacy/admin/
  // workspace/hero/about/contact/news/services/contactSection alltid finst som
  // objekt, sidan dei historisk alltid kom frå ein fullstendig statisk config.js-
  // fork (sjå config.js sine tilsvarande nøklar for kva shape kvar av desse skal
  // ha). fillConfigDefaults() fyller berre inn manglande nøklar/nivå — ho
  // overskriv ALDRI ein verdi som alt finst, så lagra/lasta config vinn alltid
  // over defaults, rekursivt for kvart nesta nivå (ein enkel toppnivå-spread ville
  // ikkje fylt inn manglande under-nøklar i eit delvis nesta objekt, t.d.
  // privacy:{heading:"x"} utan «text»).
  //
  // Innhaldsfelta (hero/about/contact/news/services/contactSection) får TOMME
  // standardverdiar her, IKKJE config.js sitt eige demo-/eksempelinnhald —
  // elles ville ein fersk tenant utan seeda innhald synt fram Vibeverk sin eigen
  // placeholder-tekst/produktkort/blogginnlegg som om det var ekte kundeinnhald
  // (same klasse feil som CFG-fallback-lekkasjen i Console, sjå
  // docs/project/CHANGELOG.md 0.27.2, punkt 2).
  //
  // Mutasjon skjer i objektet CFG *peikar på* (same referanse som
  // window.SITE_CONFIG), ikkje eit nytt objekt — fleire filer (module-chat.js,
  // console-core.js, workspace/*) les window.SITE_CONFIG direkte og må sjå dei
  // same felta som core.js sjølv muterer via superconfig-laget.
  const DEFAULT_CFG_SHAPE = {
    company:  { name: "", tagline: "", logoUrl: "", metaDescription: "", ogImage: "", favicon: "" },
    colors:   {},
    fonts:    {},
    features: {},
    intranettFeatures: {},
    privacy:  { heading: "Personvern og databehandling", text: "" },
    admin:    { password: "", tripleClickFooter: true },
    workspace: {},
    // NB: dette er nøytrale STRUKTURELLE standardar (seksjonsnamn, CTA-mål,
    // kvitteringstekst) -- generiske ord som "Om oss"/"Tjenester" som ei
    // kvar bedrift ville bruke, IKKJE Vibeverk sitt eige salstekst-innhald
    // (title/subtitle/text/intro er framleis tomme av same grunn som før:
    // sjå 0.27.4-oppføringa i CHANGELOG.md). Ei tom overskrift render som eit
    // synleg tomt <h2> i components.js -- difor treng nettopp desse eit
    // standardverdi, medan fritekst-felta ikkje skal gjette kundens innhald.
    hero:     { title: "", subtitle: "", ctaLabel: "Ta kontakt", ctaTarget: "#kontakt", image: "" },
    about:    { heading: "Om oss", intro: "", text: "", imageUrl: "" },
    contact:  { email: "", phone: "", address: "", extra: [], social: {} },
    news:     { heading: "Aktuelt", intro: "", frontCount: 3, posts: [] },
    services: { heading: "Tjenester", intro: "", cards: [] },
    contactSection: { heading: "Kontakt", intro: "", successMessage: "Takk! Vi tar kontakt så snart vi kan." }
  };

  function fillConfigDefaults(target, defaults) {
    Object.keys(defaults).forEach(function (key) {
      const defVal = defaults[key];
      const isPlainObjectDefault = defVal !== null && typeof defVal === "object" && !Array.isArray(defVal);
      if (isPlainObjectDefault) {
        const hasUsableValue = target[key] !== null && typeof target[key] === "object" && !Array.isArray(target[key]);
        if (!hasUsableValue) target[key] = {};
        fillConfigDefaults(target[key], defVal);
      } else if (!(key in target) || target[key] === undefined) {
        target[key] = defVal;
      }
    });
    return target;
  }

  (function applyConfigDefaults() {
    const missingTopLevel = Object.keys(DEFAULT_CFG_SHAPE).filter(function (key) {
      return !(key in CFG) || CFG[key] === undefined;
    });
    if (missingTopLevel.length) {
      console.warn(
        "[vibeverk] SITE_CONFIG manglar felt: " + missingTopLevel.join(", ") +
        " — brukar standardverdiar til tenanten sin eigen konfigurasjon (superconfig/broker) er sett opp."
      );
    }
    fillConfigDefaults(CFG, DEFAULT_CFG_SHAPE);
  })();
  // ──────────────────────────────────────────────────────────────────────────

  const OPT_CHAT = Object.assign({ enabled: true }, (CFG && CFG.chat) || {});
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
      if (sc.workspace) { if (!CFG.workspace) CFG.workspace = {}; Object.assign(CFG.workspace, sc.workspace); }
      if (sc.adminPassword && CFG.admin) CFG.admin.password = sc.adminPassword;
    } catch (e) { /* localStorage utilgjengeleg */ }
  })();
  // ──────────────────────────────────────────────────────────────────────────

  // ─── APP.READY — config-tilgjengelegheit-gate (ADR-0007 Fase 1 / SaaS-
  // skaleringsplanen sin Fase 4) ──────────────────────────────────────────────
  // I DAG (denne fasen): config.js er framleis ein vanleg synkron <script>-tag,
  // så markConfigReady() køyrer med det same og ready(fn) løyser synkront —
  // rein oppførsel-nøytral plumbing, ingen faktisk asynkron lasting enno.
  // SEINARE (når config-kjelda vert bytt til hostname-oppløyst fetch()): berre
  // earlyApplySuperConfig()-kallet over og markConfigReady()-kallet under flyttar
  // inn i fetch() sin .then(), opererande på det ferske CFG-objektet, rett før
  // køen tømmast. Alt anna (modular, init()) held fram uendra sidan dei alt
  // går via denne gaten. Sjå ADR-0007 og docs/roadmap/ROADMAP.md Fase 4-notatet.
  var _configReady = false;
  var _readyQueue = [];

  function ready(fn) {
    if (typeof fn !== "function") return;
    if (_configReady) { fn(CFG); }
    else { _readyQueue.push(fn); }
  }

  function markConfigReady() {
    if (_configReady) return; // idempotent
    _configReady = true;
    var q = _readyQueue;
    _readyQueue = [];
    q.forEach(function (fn) {
      try { fn(CFG); } catch (e) { console.error("[App.ready] callback feila:", e); }
    });
  }

  markConfigReady();
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

  /* ── SUPABASE SYNC ─────────────────────────────────────────────────────────
     Write-through cache: localStorage er arbeidskopi, Supabase er persistent
     lager. Lesing: alltid frå localStorage (synkron, rask). Skriving: til
     localStorage + batcha upsert til Supabase kvart 300 ms. Oppstart: hent
     alle nøklar for dette tenant-ID-et frå Supabase → skriv til localStorage
     → start appen. Ved offline / feil: fall tilbake til localStorage.         */
  // KJENT OPE PUNKT for ein framtidig ekte async config-fase (ikkje bygd
  // enno, sjå App.ready-notatet lenger oppe): _sb vert konstruert synkront
  // her, FØR App.ready/markConfigReady vert kalla — trygt i dag sidan CFG.supabase
  // alt er korrekt utfylt på dette tidspunktet (config.js er ein synkron
  // <script>-tag). Men `supabase: _sb` i return-objektet nedanfor er ein
  // VERDI-SNAPSHOT, ikkje ei live binding — om denne konstruksjonen nokon
  // gong vert utsett til inni ein ready()-callback (t.d. når CFG.supabase
  // fyrst er tilgjengeleg via ein framtidig fetch()), må returnert `App`-
  // objekt sin `supabase`-eigenskap eksplisitt OPPDATERAST ETTERPÅ óg
  // (App.supabase = _sb;), elles fryser han på null for alltid. Same
  // gotcha vart funne og fiksa i module-users.js sin eigen `_sb`-snapshot
  // denne runda — ikkje gjort her no, sidan det krev å omstrukturere heile
  // det store return-objektet, utanfor denne fasen sitt "rein plumbing"-omfang.
  var _sb = null;
  (function () {
    var cfg = CFG.supabase;
    if (!cfg || !cfg.url || !cfg.anonKey) return;
    if (typeof window.supabase === "undefined") return;
    try { _sb = window.supabase.createClient(cfg.url, cfg.anonKey); } catch (e) {}
  })();

  // Auth-status — oppdaterast av onAuthStateChange, brukast av _flushSync
  var _isAuthed = false;

  // Synk Supabase-session til sessionStorage slik at getAuthRole() alltid er oppdatert
  if (_sb) {
    _sb.auth.onAuthStateChange(function (event, session) {
      _isAuthed = !!session;
      if (session && session.user) {
        _sb.from("users").select("role").eq("id", session.user.id).single().then(function (r) {
          var role = (r.data && r.data.role) || "member"; // fail-closed: lågaste tillit viss rolleoppslag feilar
          sessionStorage.setItem(NS + ":admin", role);
        });
        // Lastar leads-cachen proaktivt så snart me veit brukaren er innlogga
        // (dekker både fersk innlogging og ein alt-innlogga sesjon ved
        // sidelasting) — same grunngjeving som loadCrmData() i module-crm.js.
        loadLeads(function () {});
      } else if (event === "SIGNED_OUT") {
        sessionStorage.removeItem(NS + ":admin");
      }
    });
  }

  var _syncQueue = {};
  var _syncTimer = null;

  function _flushSync() {
    if (!_sb || !_isAuthed) return;
    var queue = _syncQueue;
    _syncQueue = {};
    var upserts = [];
    var delKeys = [];
    Object.keys(queue).forEach(function (k) {
      if (queue[k] === null) { delKeys.push(k); }
      else { upserts.push({ tenant_id: NS, key: k, value: queue[k] }); }
    });
    if (upserts.length) _sb.from("store").upsert(upserts, { onConflict: "tenant_id,key" }).then(function(r) { if (r.error) console.error("[sync] upsert feil:", r.status, r.error); });
    if (delKeys.length) _sb.from("store").delete().eq("tenant_id", NS).in("key", delKeys).then(function(r) { if (r.error) console.error("[sync] delete feil:", r.status, r.error); });
  }

  function _queueSync(key, value) {
    _syncQueue[key] = value !== undefined ? value : null;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_flushSync, 300);
  }

  const _lsSet    = Store.set.bind(Store);
  const _lsRemove = Store.remove.bind(Store);

  Store.set = function (name, value) {
    var ok = _lsSet(name, value);
    _queueSync(name, value);
    return ok;
  };

  Store.remove = function (name) {
    _lsRemove(name);
    _queueSync(name, null);
  };

  function hydrateFromSupabase(done) {
    if (!_sb) { done(); return; }
    _sb.from("store").select("key, value").eq("tenant_id", NS)
      .then(function (result) {
        if (result.data) {
          result.data.forEach(function (row) {
            var lsKey = NS + ":" + row.key;
            if (row.value === null) {
              localStorage.removeItem(lsKey);
            } else {
              try { localStorage.setItem(lsKey, JSON.stringify(row.value)); } catch (e) {}
            }
          });
        }
        done();
      })
      .catch(function () { done(); });
  }

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

    // file (File) → Promise<URL (Supabase Storage) | "media:"-ref (localStorage fallback)>
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
            if (_sb) {
              canvas.toBlob(function (blob) {
                if (!blob) { reject(new Error("decode")); return; }
                const path = Date.now() + "-" + Math.random().toString(36).slice(2, 7) + ".jpg";
                _sb.storage.from("media").upload(path, blob, { contentType: "image/jpeg", upsert: false })
                  .then(function (r) {
                    if (r.error) { reject(r.error); return; }
                    resolve(_sb.storage.from("media").getPublicUrl(path).data.publicUrl);
                  });
              }, "image/jpeg", self.QUALITY);
            } else {
              const dataUrl = canvas.toDataURL("image/jpeg", self.QUALITY);
              const ref = "media:" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
              if (!Store.set(ref, dataUrl)) { reject(new Error("quota")); return; }
              resolve(ref);
            }
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    },

    // Logo-opplasting frå Web-admin sin Design-fane (kunden sin EIGEN,
    // allereie autentiserte økt -- ingen kontrollplan/service_role
    // tilgjengeleg her, i motsetnad til Console sin upload_logo-broker-
    // handling). Difor MEDVITE berre raster (PNG/JPEG/WebP) -- SVG er
    // eksplisitt IKKJE støtta i denne sjølvbetenings-stien, sidan trygg
    // SVG-sanering krev ei serversside-funksjon (som broker-en har via
    // ei allowlist), og denne koden har ingen tilsvarande server å sanere
    // gjennom. Uendra SVG-opplasting frå klienten ville opna ei reell
    // lagra-XSS-flate. Behelder gjennomsiktigheit (PNG-utdata for PNG/WebP-
    // kjelder) i staden for å tvinge JPEG slik put() gjer for innhaldsbilete.
    //
    // MEDVITE INGEN "media:"-localStorage-fallback her (i motsetnad til
    // put()/putFile()): CFG.company.logoUrl vert brukt direkte som <img src>
    // i sidehovudet (C.nav() sitt logoUrl-felt) UTAN eit Media.resolve()-
    // steg, sidan feltet historisk alltid har vore ein ekte URL-streng
    // (Console sin upload_logo-broker skriv aldri noko anna). Ein
    // "media:"-referanse der ville vist eit knust bilete i sidehovudet
    // heilt til neste ekte opplasting. Krev difor ei ekte Supabase-tilkopling
    // (alltid til stades for kvar reelt utplassert kunde) i staden for å
    // opne ein ny verdiform inn i eit felt som resten av koden ikkje veit
    // korleis det skal løysast.
    LOGO_MAX_DIM: 800,
    // Sikringsnett mot dekomprimeringsbombe (t.d. ein 30000×30000 low-entropy
    // PNG som komprimerer godt under 6MB-grensa, men dekodar til fleire GB
    // pikseldata) -- SAME feilklasse som vart funnen og fiksa éin gong før i
    // Console sin upload_logo-broker (sjå CHANGELOG 0.39.0), der ein
    // pre-dekode header-parse stogga han FØR faktisk biletdekoding. Reint
    // klientside JS kan ikkje unngå at nettlesaren dekodar biletet FØR
    // img.onload fyrer (ingen måte å lese dimensjonar utan det, med mindre
    // ein handrullar PNG/JPEG/WebP-header-parsing), så dette stoggar i staden
    // FØR denne koden lagar eit like stort/dyrt canvas OG re-kodar det --
    // reduserer risiko, garanterer det ikkje (sjå ADR/tryggingsgjennomgang).
    MAX_PIXELS: 40 * 1000 * 1000,
    putLogo: function (file) {
      const self = this;
      const ALLOWED = { "image/png": 1, "image/jpeg": 1, "image/webp": 1 };
      return new Promise(function (resolve, reject) {
        if (!_sb) { reject(new Error("nosupabase")); return; }
        if (!ALLOWED[file.type]) { reject(new Error("type")); return; }
        if (file.size > 6 * 1024 * 1024) { reject(new Error("size")); return; }
        const reader = new FileReader();
        reader.onerror = function () { reject(new Error("read")); };
        reader.onload = function () {
          const img = new Image();
          img.onerror = function () { reject(new Error("decode")); };
          img.onload = function () {
            if (img.width * img.height > self.MAX_PIXELS) { reject(new Error("dims")); return; }
            let w = img.width, h = img.height;
            const m = self.LOGO_MAX_DIM;
            if (w > m || h > m) { const s = m / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            const outType = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
            const quality = outType === "image/jpeg" ? 0.9 : undefined;
            canvas.toBlob(function (blob) {
              if (!blob) { reject(new Error("decode")); return; }
              const ext = outType === "image/jpeg" ? "jpg" : "png";
              const path = "logo-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7) + "." + ext;
              _sb.storage.from("media").upload(path, blob, { contentType: outType, upsert: false })
                .then(function (r) {
                  if (r.error) { reject(r.error); return; }
                  resolve(_sb.storage.from("media").getPublicUrl(path).data.publicUrl);
                });
            }, outType, quality);
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
      if (!src) return;
      if (src.indexOf("media:") === 0) { Store.remove(src); return; }
      if (_sb && src.indexOf("/storage/v1/object/public/media/") > -1) {
        const path = src.split("/storage/v1/object/public/media/")[1];
        if (path) _sb.storage.from("media").remove([decodeURIComponent(path)]);
      }
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
      // Vaktar mot dobbelt-serialisert data: viss ein streng ser ut som eit
      // JSON-objekt (feilaktig lagra som tekst ein stad), tolk han som eit
      // objekt i staden for å bruke heile JSON-teksten som bilde-URL (som
      // elles ville prøvd å hente t.d. "{"src":"","pos":"50% 50%",...}" som
      // ein faktisk <img src>, og feila med 400 for alle roller/brukarar).
      if (typeof v === "string") {
        if (v.charAt(0) === "{") {
          try { return this.norm(JSON.parse(v)); } catch (e) { /* ikkje gyldig JSON — behandle som vanleg URL under */ }
        }
        return { src: v, pos: "50% 50%", caption: "", creditType: "", alt: "" };
      }
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
    MAX_FILE_MB_REMOTE: 20, // reell grense når Supabase Storage er konfigurert (sjå putFile under)
    putFile: function (file) {
      const self = this;
      return new Promise(function (resolve, reject) {
        if (_sb) {
          if (file.size > self.MAX_FILE_MB_REMOTE * 1024 * 1024) { reject(new Error("size")); return; }
          const ext = (file.name.split(".").pop() || "bin").toLowerCase();
          const path = "files/" + Date.now() + "-" + Math.random().toString(36).slice(2, 7) + "." + ext;
          _sb.storage.from("media").upload(path, file, { contentType: file.type, upsert: false })
            .then(function (r) {
              if (r.error) { reject(r.error); return; }
              resolve({ name: file.name, ref: _sb.storage.from("media").getPublicUrl(path).data.publicUrl, type: file.type, size: file.size });
            });
        } else {
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
        }
      });
    },
    // Referanse → nedlastbar href (data-URL for opplastet fil, ellers URL-en selv).
    resolveFile: function (ref) {
      if (!ref) return "";
      if (ref.indexOf("file:") === 0) { const r = Store.get(ref, null); return r ? r.dataUrl : ""; }
      return ref;
    },
    freeFile: function (ref) {
      if (!ref) return;
      if (ref.indexOf("file:") === 0) { Store.remove(ref); return; }
      if (_sb && ref.indexOf("/storage/v1/object/public/media/files/") > -1) {
        const path = ref.split("/storage/v1/object/public/media/")[1];
        if (path) _sb.storage.from("media").remove([decodeURIComponent(path)]);
      }
    }
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
        title: CFG.hero.title, subtitle: CFG.hero.subtitle,
        ctaLabel: CFG.hero.ctaLabel, ctaTarget: CFG.hero.ctaTarget, image: CFG.hero.image || ""
      }, overrides.hero || {}),
      // ← seedet fra config.about (tekst + valgfritt bilde)
      about: Object.assign({
        heading: CFG.about.heading, intro: CFG.about.intro, text: CFG.about.text, image: CFG.about.imageUrl || ""
      }, overrides.about || {}),
      // ← seedet fra config.services/news/contactSection sine seksjonsnivå-felt
      // (overskrift/ingress/kvitteringstekst) -- ikkje å forveksle med
      // content.services/content.news, som er lista over enkeltkort/innlegg.
      servicesSection: Object.assign({
        heading: CFG.services.heading, intro: CFG.services.intro
      }, overrides.servicesSection || {}),
      newsSection: Object.assign({
        heading: CFG.news.heading, intro: CFG.news.intro
      }, overrides.newsSection || {}),
      contactSection: Object.assign({
        heading: CFG.contactSection.heading, intro: CFG.contactSection.intro,
        successMessage: CFG.contactSection.successMessage
      }, overrides.contactSection || {}),
      // ← seedet fra config.contact (+ egendefinerte felter, redigerbart i admin)
      contact: (function () {
        var c = Object.assign({
          email: CFG.contact.email, phone: CFG.contact.phone, address: CFG.contact.address,
          extra: (CFG.contact.extra || []).slice(),
          social: Object.assign({}, CFG.contact.social || {})
        }, overrides.contact || {});
        // Ryd alltid opp gammal twitter-nøkkel frå localStorage
        if (c.social && c.social.twitter) {
          if (!c.social.x) { c.social.x = c.social.twitter; }
          delete c.social.twitter;
        }
        return c;
      })(),
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
      }, CFG.footer || {}, overrides.footer || {}),
      // Design-modul ("sidebygger", Fase 0) -- kva designmal denne kunden
      // har valt. "klassisk" (dagens design) er standard for alle som ikkje
      // eksplisitt har valt noko anna -- sjå adminDesign()/activeTemplate().
      designTemplate: overrides.designTemplate || "klassisk"
    };
    // Normaliser alle bilder til { src, pos } (også eldre strengverdier)
    content.hero.image = Media.norm(content.hero.image);
    content.about.image = Media.norm(content.about.image);
    content.services.forEach(function (c) { c.image = Media.norm(c.image); });
    content.news.forEach(function (p) { p.image = Media.norm(p.image); p.attachments = p.attachments || []; });
  }
  function saveContent() { Store.set("content", content); }

  // Leads (innsendte kontaktskjema + tilbudsforespurnadar). Flytta ut av
  // store 2026-07-03 (del to av CRITICAL-funnet om ubetinga anon-SELECT, sjå
  // crm_customers). Synkron lokal cache (_leads, fylt av loadLeads()) BERRE
  // brukt når Supabase er konfigurert og brukaren er innlogga — elles les
  // getLeads()/addLead()/updateLead()/deleteLead() alltid FERSKT direkte frå
  // Store (localStorage), akkurat som før 2026-07-03. Dette er naudsynt (ikkje
  // berre ei stilval): utan det ville ein kode-stad som skriv direkte til
  // Store.set("leads", …) — t.d. testoppsett, eller framtidig kode — usynleg
  // forbi den lokale cachen, sidan cachen då aldri veit om endringa. Caching
  // gjev berre meining for å unngå gjentekne nettverkskall til Supabase; når
  // Supabase ikkje er i bruk er eit Store.get()-kall uansett like billig som
  // å lese ein cache. Skriving til Supabase krev innlogga sesjon (_isAuthed)
  // — akkurat som _flushSync() alt krev for store — sidan anonyme besøkande
  // sine innsendingar framleis berre hamnar i localStorage (kjend, separat
  // ope funn, sjå docs/project/CURRENT_STATE.md "Still open").
  var _leads = [];

  function dbLeadToJs(row) {
    return { id: row.id, kind: row.kind || "kontakt", name: row.name || "", email: row.email || "",
      message: row.message || "", time: row.created_at, status: row.status || "ny",
      referenceNumber: row.reference_number, source: row.source, chatId: row.chat_id,
      attachments: row.attachments || [] };
  }
  function jsLeadToDb(l) {
    return { kind: l.kind || "kontakt", name: l.name || "", email: l.email || "", message: l.message || "",
      status: l.status || "ny", reference_number: l.referenceNumber || null, source: l.source || null, chat_id: l.chatId || null,
      attachments: l.attachments || [] };
  }

  function loadLeads(cb) {
    if (!_sb || !_isAuthed) { cb && cb(); return; } // getLeads() les ferskt uansett i dette tilfellet
    _sb.from("leads").select("*").order("created_at", { ascending: false }).then(function (r) {
      _leads = (r.data || []).map(dbLeadToJs);
      cb && cb();
    });
  }

  function getLeads() {
    if (!_sb || !_isAuthed) return Store.get("leads", []) || [];
    return _leads;
  }

  // Bakgrunns-refresh (Arkitekt-konsultasjon 2026-07-17, del av inbound-e-post-
  // arbeidet) — _leads vert elles berre lasta ÉIN gong ved innlogging/mount,
  // aldri på nytt, sidan leads ikkje er i supabase_realtime-publikasjonen
  // (i motsetnad til chat). Ein rad ein Edge Function (t.d. den nye
  // inbound-email-webhooken) skriv medan eit admin-panel er ope ville elles
  // ALDRI dukke opp før reload. MERGE-ved-id (aldri erstatt _leads heilt) for
  // å ikkje overskrive ein admin sin eigen, nyleg optimistiske endring —
  // slettingar server-side vert ikkje fanga opp her (sjeldan, uskadeleg,
  // neste fulle innlogging/reload rettar opp), berre nye/endra rader.
  function refreshLeadsFromSupabase(cb) {
    if (!_sb || !_isAuthed) { cb && cb(); return; }
    _sb.from("leads").select("*").order("created_at", { ascending: false }).then(function (r) {
      var rows = (r.data || []).map(dbLeadToJs);
      var byId = {}; _leads.forEach(function (l) { byId[l.id] = l; });
      rows.forEach(function (row) {
        var ex = byId[row.id];
        if (ex) Object.assign(ex, row); else _leads.unshift(row);
      });
      cb && cb();
    });
  }

  // Skil Tilbud-førespurnadar frå vanlege Kontakt-leads. Det ekte `kind`-
  // feltet (lagt til 2026-07-03) er kjelda når det finst; fell tilbake til
  // den gamle tekst-sniffinga på meldinga for eldre data som endå ikkje har
  // fått kind sett (før migrering, eller cacha lokalt frå før).
  function isTilbud(lead) {
    if (lead && lead.kind) return lead.kind === "tilbud";
    return !!(lead && lead.message && lead.message.indexOf("Tilbudsforesp") === 0);
  }

  // crm-customers/crm-bedrifter flytta ut av store til eigne tabellar
  // (crm_customers/crm_bedrifter) 2026-07-03 — module-crm.js si lokale cache
  // (fylt proaktivt ved modul-oppstart) er no den einaste sanninga, eksponert
  // via window.CrmAdmin. Store.get("crm-customers"/"crm-bedrifter") er berre
  // ein historisk/forelda blob som ikkje lenger vert oppdatert når Supabase
  // er konfigurert — desse hjelparane brukar CrmAdmin når han finst, og fell
  // tilbake til det gamle direkte Store.get-kallet berre viss CRM-modulen
  // ikkje er lasta i det heile (feature avslått, eller ikkje lasta enno).
  function crmCustomers() {
    return (window.CrmAdmin && window.CrmAdmin.getCustomers) ? window.CrmAdmin.getCustomers() : (Store.get("crm-customers", []) || []);
  }
  function crmBedrifter() {
    return (window.CrmAdmin && window.CrmAdmin.getBedrifter) ? window.CrmAdmin.getBedrifter() : (Store.get("crm-bedrifter", []) || []);
  }
  function bookingBookings() {
    return (window.BookingAdmin && window.BookingAdmin.getBookings) ? window.BookingAdmin.getBookings() : (Store.get("booking-bookings", []) || []);
  }
  // Lagre en innsendt henvendelse (brukes av kontaktskjemaet og av moduler,
  // t.d. module-quote.js for Tilbud med kind:"tilbud" eksplisitt sett).
  // Synkron retur + fire-and-forget Supabase-skriving i bakgrunnen — same
  // filosofi som App.store.set() og module-crm.js sine createX()-funksjonar.
  // Sjå tilsvarande kommentar i module-crm.js sin logWriteError() — skrivinga
  // sjølv er framleis fire-and-forget, .catch() her gjer berre at ein mislykka
  // skriving synest i konsollen i staden for å forsvinne heilt stille.
  function logWriteError(action, err) { console.error("[Leads] " + action + " feilet:", err); }

  function addLead(lead) {
    lead = lead || {};
    const existing = getLeads();
    const refNums = existing.map(function (l) { return l.referenceNumber; }).filter(Boolean);
    const newLead = {
      id: "lead-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      kind: lead.kind || "kontakt",
      name: lead.name || "", email: lead.email || "", message: lead.message || "",
      time: new Date().toISOString(),
      status: "ny",   // ny → lest → løst
      referenceNumber: generateUniqueNumber(refNums),
      source: lead.source || null,
      chatId: lead.chatId || null,
      attachments: lead.attachments || []
    };
    if (!_sb) {
      existing.unshift(newLead);
      Store.set("leads", existing);
      return newLead;
    }
    if (!_isAuthed) {
      // Anonym besøkande: leads har ingen anon-GRANT i det heile (RLS kan
      // ikkje verifisere ein anon-identitet), så insert_anon_lead() (SECURITY
      // DEFINER-RPC) er den einaste vegen inn. Ingen lokal Store-skriving
      // lenger (2026-07-06) — ei anonym innsending skal leve i Supabase, ikkje
      // berre i den eine besøkande sin eigen nettlesar, som var det
      // opphavlege "når aldri admin"-funnet.
      _sb.rpc("insert_anon_lead", {
        p_id: newLead.id, p_kind: newLead.kind, p_name: newLead.name, p_email: newLead.email,
        p_message: newLead.message, p_reference_number: newLead.referenceNumber,
        p_source: newLead.source, p_chat_id: newLead.chatId, p_attachments: newLead.attachments,
        // Eigarskaps-token for chat-opphavne leads (sjå
        // supabase/migrations/20260717140000_dedup_anon_lead_chat_id.sql) --
        // null for vanlege Kontakt/Tilbud-leads utan chatId, uendra åtferd.
        p_visitor_id: lead.visitorId || null
      }).then(function (r) { if (r.error) logWriteError("opprette anonym henvendelse", r.error); });
      return newLead;
    }
    _leads.unshift(newLead);
    _sb.from("leads").insert(Object.assign(jsLeadToDb(newLead), { id: newLead.id, created_at: newLead.time })).then(function () {}).catch(function (err) { logWriteError("opprette henvendelse", err); });
    return newLead;
  }

  function updateLead(id, changes) {
    if (!_sb || !_isAuthed) {
      const leads = getLeads();
      const lead = leads.find(function (l) { return l.id === id; });
      if (lead) { Object.assign(lead, changes); Store.set("leads", leads); }
      return;
    }
    const lead = _leads.find(function (l) { return l.id === id; });
    if (lead) Object.assign(lead, changes);
    _sb.from("leads").update(jsLeadToDb(lead || changes)).eq("id", id).then(function () {}).catch(function (err) { logWriteError("oppdatere henvendelse", err); });
  }

  function deleteLead(id) {
    if (!_sb || !_isAuthed) {
      Store.set("leads", getLeads().filter(function (l) { return l.id !== id; }));
      return;
    }
    _leads = _leads.filter(function (l) { return l.id !== id; });
    _sb.from("leads").delete().eq("id", id).then(function () {}).catch(function (err) { logWriteError("slette henvendelse", err); });
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
      return;
    }
    if (modules.some(function (m) { return m.id === def.id; })) {
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
    // Hjørne-radius -- valfritt Console-felt (Fargar-fana), sjå
    // docs/roadmap/ROADMAP.md "Later" (custom design-modul-punktet).
    // Knappar held seg pill-forma (--btn-radius) på Standard/Runde (>=14px),
    // slik dagens standardutsjånad ikkje endrar seg -- men får synleg mindre
    // avrunding på Skarpe hjørner/Litt runde (<14px), etter tilbakemelding
    // om at knappar elles ikkje vart påverka av valet i det heile.
    if (col.radius !== undefined && col.radius !== null && col.radius !== "") {
      const r = parseInt(col.radius, 10);
      if (!isNaN(r)) {
        root.setProperty("--radius", r + "px");
        root.setProperty("--btn-radius", r < 14 ? r + "px" : "999px");
      }
    }

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

  // Fontar som er sjølv-hosta lokalt (sjå fonts/self-hosted-fonts.css) --
  // unngår ein direkte nettlesar->Google-førespurnad for Vibeverk sine eigne
  // to fontar (sjå docs/compliance/data-map-vibeverk.md seksjon 8). Andre
  // kundar som vel eit anna Google Font-namn via Console fell framleis
  // tilbake til Google sin CDN under, heilt uendra.
  const LOCAL_FONTS = { poppins: true, "nunito sans": true };
  function isLocalFont(name) { return !!name && !!LOCAL_FONTS[name.toLowerCase()]; }

  function injectGoogleFonts(f) {
    if (!f || (!f.display && !f.body)) return;
    const weights = f.weights || {};
    const remoteFamilies = [];
    let needLocal = false;

    if (f.display) {
      if (isLocalFont(f.display)) needLocal = true;
      else remoteFamilies.push(fontFamilyParam(f.display, weights.display || [400, 700]));
    }
    if (f.body && f.body !== f.display) {
      if (isLocalFont(f.body)) needLocal = true;
      else remoteFamilies.push(fontFamilyParam(f.body, weights.body || [400, 600]));
    }

    if (needLocal) {
      let localLink = document.getElementById("app-fonts-local");
      if (!localLink) {
        localLink = document.createElement("link");
        localLink.id = "app-fonts-local";
        localLink.rel = "stylesheet";
        localLink.href = "/fonts/self-hosted-fonts.css";
        document.head.appendChild(localLink);
      }
    }

    let link = document.getElementById("app-fonts");
    if (remoteFamilies.length) {
      const href = "https://fonts.googleapis.com/css2?" + remoteFamilies.join("&") + "&display=swap";
      if (!link) {
        link = document.createElement("link");
        link.id = "app-fonts";
        link.rel = "stylesheet";
        document.head.appendChild(link);
      }
      link.href = href;
    } else if (link) {
      link.remove();
    }
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
      setStatus(status, content.contactSection.successMessage || CFG.contactSection.successMessage, "ok");
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
    // Supabase-roller: admin | editor | member
    // Eldre fallback-rolleverdi "employee" normaliserast her til "member" (éin
    // stad) — alle kallstadar (App.getAuthRole()) samanliknar mot "member"
    // direkte, så normalisering ved kjelda held dei konsekvente utan at kvar
    // enkelt guard treng eit eige "|| role === 'employee'"-unntak.
    if (v === "employee") return "member";
    if (v === "admin" || v === "editor" || v === "member") return v;
    return null;
  }
  function isAuthed() { return !!getAuthRole(); }
  function setAuthed(role) {
    if (role) {
      sessionStorage.setItem(NS + ":admin", role);
    } else {
      sessionStorage.removeItem(NS + ":admin");
      if (_sb) _sb.auth.signOut().then(function () {});
    }
  }

  // Admin-faner gruppert i tre kategorier, slik at panelet ikke blir uoversiktlig
  // når mange moduler er aktive. Hver modul kan selv si hvilken kategori den
  // hører til via admin.category — default "innhold" hvis ikke angitt.
  // "design" står FYRST med vilje (Design-modul/"sidebygger", ROADMAP.md) --
  // gjev fanerekkjefølgja Design | Innhold | Henvendelser | Innstillinger |
  // Min konto direkte via ADMIN_CATEGORIES si eiga rekkjefølgje, ingen eigen
  // sorteringslogikk treng byggjast. Synleg berre når feat("sidebygger") er
  // sant (sjå allowedCategoriesForRole under) -- eit betalt tillegg, ikkje
  // noko alle kundar skal sjå som standard.
  const ADMIN_CATEGORIES = [
    { id: "design",        label: "Design" },
    { id: "innhold",       label: "Innhold" },
    { id: "henvendelser",  label: "Henvendelser" },
    { id: "innstillinger", label: "Innstillinger" },
    { id: "konto",         label: "Min konto" }
  ];
  // Kva faner kvar rolle ser i web-adminen:
  //   admin       → alt (design* + innhold + henvendelser + innstillinger)
  //   editor      → design* + innhald og henvendelser (ikkje innstillinger)
  //   member → berre henvendelser (getAuthRole() normaliserer eldre "employee" til "member")
  //   *design berre dersom feat("sidebygger") er sant -- Console-only
  //   betalingsflagg, IKKJE noko kunden sjølv kan skru på (feat() les
  //   CFG.features, som berre Console/superconfig kan skrive til).
  function allowedCategoriesForRole(role) {
    var cats;
    if (role === "member") cats = ["henvendelser"];
    else if (role === "editor") cats = feat("sidebygger") ? ["design", "innhold", "henvendelser"] : ["innhold", "henvendelser"];
    else cats = feat("sidebygger") ? ["design", "innhold", "henvendelser", "innstillinger"] : ["innhold", "henvendelser", "innstillinger"];
    if (_sb) cats = cats.concat(["konto"]);
    return cats;
  }
  function buildAdminTabs() {
    const tabs = [
      { id: "design",     label: "Design",     category: "design" },
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
    if (window.VwChatAdmin && feat("chat") && OPT_CHAT.enabled !== false) {
      tabs.push({ id: "chat-admin", label: "Chat", category: "henvendelser" });
    }
    // Sikkerhetskopi har kategori "innstillinger", som allowedCategoriesForRole()
    // berre gjev til rolla admin (sjå ovanfor) -- difor berre relevant å leggje
    // til fana i det heile for admin. Fjerna 2026-07-15 (UX-gjennomgang): den
    // tidlegare else-greina la til ei "admin-backup"-fane for andre roller,
    // men sidan dei rollene aldri får sjå kategorien "innstillinger", var fana
    // -- og heile adminBackupCustomer()-funksjonen ho ruta til -- reelt sett
    // uoppnåeleg, stadfesta ved å følgje heile fane-/kategorifilter-kjeda.
    const _backupRole = typeof getAuthRole === "function" ? (getAuthRole() || "member") : "member";
    if (_backupRole === "admin") {
      tabs.push({ id: "sikkerhetskopi", label: "Sikkerhetskopi", category: "innstillinger" });
    }
    if (_sb) {
      tabs.push({ id: "min-konto", label: "Min konto", category: "konto" });
    }
    if (_sb && (_backupRole === "admin")) {
      tabs.push({ id: "brukarar",  label: "Brukarar",  category: "innstillinger" });
    }
    return tabs;
  }

  let activeTab = "innhold";
  let activeCategory = "innhold";
  // Persistert på tvers av sesjonar (same mønster som Workspace sin
  // sidemeny-kollaps, sjå "wsp-sidebar-collapsed") -- adminpanelet
  // re-rendrar seg sjølv (root.innerHTML = C.modal(...)) på nesten kvart
  // faneskift, så denne må vere ein modul-variabel, ikkje ein lokal
  // closure-verdi inni renderAdminPanel() sjølv, elles ville han nullstilt
  // seg ved neste faneklikk.
  let adminFullscreen = Store.get("admin-panel-fullscreen", false);

  function openAdmin() {
    closeAdmin(); // unngå dobbel
    const root = document.createElement("div");
    root.id = "admin-root";
    document.body.appendChild(root);
    if (isAuthed()) renderAdminPanel(root);
    else renderAdminLogin(root);
  }
  function closeAdmin() {
    stopAdminBadgeRefresh();
    const root = document.getElementById("admin-root");
    if (root) root.remove();
    if (location.hash === "#admin") history.replaceState(null, "", location.pathname + location.search);
  }

  /* ── Tab-badge-system ────────────────────────────────────────────────────
     Polls every 4 s while the admin panel is open.
     Any module can call App.setTabBadge(tabId, count) directly.           */
  let _adminBadgeTimer = null;

  function startAdminBadgeRefresh(root) {
    stopAdminBadgeRefresh();
    injectTabBadgeCss();
    doAdminBadgeRefresh(root);
    _adminBadgeTimer = setInterval(function () {
      const r = document.getElementById("admin-root");
      if (!r) { stopAdminBadgeRefresh(); return; }
      doAdminBadgeRefresh(r);
    }, 4000);
  }
  function stopAdminBadgeRefresh() {
    if (_adminBadgeTimer) { clearInterval(_adminBadgeTimer); _adminBadgeTimer = null; }
  }
  function doAdminBadgeRefresh(root) {
    if (!root) return;
    // Chat unread (VwChat.totalUnread() is always safe to call)
    const chatCount = window.VwChat ? window.VwChat.totalUnread() : 0;
    setTabBadge(root, "chat-admin", chatCount);
    // New contact submissions
    const leads = getLeads();
    const newContacts = leads.filter(function (l) {
      return !isTilbud(l) && (l.status || "ny") === "ny";
    }).length;
    setTabBadge(root, "leads", newContacts);
    // New quotes
    const newQuotes = leads.filter(function (l) {
      return isTilbud(l) && (l.status || "ny") === "ny";
    }).length;
    setTabBadge(root, "quotes", newQuotes);
  }
  function setTabBadge(root, tabId, count) {
    const btn = root && root.querySelector("[data-tab='" + tabId + "']");
    if (!btn) return;
    let badge = btn.querySelector(".tab-badge");
    if (count > 0) {
      if (!badge) { badge = document.createElement("span"); badge.className = "tab-badge"; btn.appendChild(badge); }
      badge.textContent = count > 99 ? "99+" : String(count);
    } else {
      if (badge) badge.remove();
    }
  }
  function injectTabBadgeCss() {
    if (document.getElementById("tab-badge-css")) return;
    const s = document.createElement("style"); s.id = "tab-badge-css";
    s.textContent = ".tab-badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 .25rem;margin-left:.3rem;background:#c0392b;color:#fff;border-radius:999px;font-size:.6rem;font-weight:700;line-height:1;vertical-align:middle}";
    document.head.appendChild(s);
  }

  // Innlogging — Supabase for nivå 1–3, OTP for superadmin (nivå 4, sjå openSuperAdmin).
  function renderAdminLogin(root) {
    // Skil "Supabase er ikkje konfigurert" (lokalt/testmiljø — passord-fallback OK) frå
    // "Supabase ER konfigurert men SDK-en feila å laste" (produksjon — skal ALDRI falle
    // tilbake til passordet, berre Supabase-autentisering er tillate).
    const supabaseConfigured = !!(CFG.supabase && CFG.supabase.url && CFG.supabase.anonKey);
    const useSupabase = !!_sb;

    if (supabaseConfigured && !useSupabase) {
      root.innerHTML = C.modal({
        title: "Logg inn",
        label: "Admin innlogging",
        body:
          '<p class="prose prose--muted">Kunne ikkje laste innloggingstenesta. Sjekk internettforbindelsen og prøv igjen.</p>' +
          C.button({ label: "Prøv igjen", type: "button", variant: "primary", attrs: "data-login-retry" })
      });
      bindModalClose(root);
      const retryBtn = root.querySelector("[data-login-retry]");
      if (retryBtn) retryBtn.addEventListener("click", function () { location.reload(); });
      return;
    }

    root.innerHTML = C.modal({
      title: "Logg inn",
      label: "Admin innlogging",
      body:
        '<form data-login class="admin-form">' +
          '<p class="prose prose--muted">' + (useSupabase ? "Logg inn med e-post og passord." : "Skriv inn admin-passordet for å redigere innhold.") + '</p>' +
          (useSupabase ? C.field({ id: "admin-email", label: "E-post", type: "email", required: true }) : "") +
          C.field({ id: "admin-pass", label: "Passord", type: "password", required: true }) +
          C.button({ label: "Logg inn", type: "submit", variant: "primary" }) +
          '<p class="form__status" data-login-status role="status" aria-live="polite"></p>' +
        '</form>'
    });
    bindModalClose(root);
    const form = root.querySelector("[data-login]");
    const statusEl = root.querySelector("[data-login-status]");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const pass = root.querySelector("#admin-pass").value;

      if (useSupabase) {
        const email = root.querySelector("#admin-email").value;
        setStatus(statusEl, "Logger inn…", "");
        _sb.auth.signInWithPassword({ email: email, password: pass }).then(function (result) {
          if (result.error) {
            setStatus(statusEl, "Feil e-post eller passord.", "error");
            return;
          }
          _sb.from("users").select("role").eq("id", result.data.user.id).single().then(function (r) {
            const role = (r.data && r.data.role) || "member"; // fail-closed: lågaste tillit viss rolleoppslag feilar
            setAuthed(role);
            hydrateFromSupabase(function () {
              if (role === "member") activeCategory = "henvendelser";
              renderAdminPanel(root);
            });
          });
        });
      } else {
        // Fallback: config-passord (testmiljø / lokal køyring utan Supabase)
        if (pass === (CFG.admin && CFG.admin.password)) {
          setAuthed("admin");
          renderAdminPanel(root);
        } else {
          setStatus(statusEl, "Feil passord.", "error");
        }
      }
    });
    setTimeout(function () {
      const i = root.querySelector("#admin-email") || root.querySelector("#admin-pass");
      if (i) i.focus();
    }, 50);
  }

  // Selve panelet
  function renderAdminPanel(root) {
    const role = getAuthRole() || "member";
    const allowedCats = allowedCategoriesForRole(role);
    const allTabs = buildAdminTabs();
    const visibleTabs = allTabs.filter(function (t) {
      return allowedCats.indexOf(t.category) > -1;
    });

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
      fullscreenToggle: true,
      isFullscreen: adminFullscreen,
      body: catBarHtml +
            (function () {
              var hasWs = activeCategory === "henvendelser" && CFG.intranettFeatures && Object.keys(CFG.intranettFeatures).length > 0;
              if (!hasWs) return C.tabbar(tabsInCat, activeTab);
              // Tab-rad med «Åpne i arbeidsområde» som siste element, høgrejustert
              return '<div class="tabs" role="tablist" style="display:flex;align-items:center">' +
                tabsInCat.map(function (t) {
                  var active = t.id === activeTab ? "is-active" : "";
                  return '<button class="tab ' + active + '" role="tab" data-tab="' + C.esc(t.id) + '">' + C.esc(t.label) + '</button>';
                }).join("") +
                '<a href="../workspace/#/" target="_blank" class="btn btn--ghost btn--sm" style="margin-left:auto;font-size:.8rem;padding:.35rem .7rem;display:inline-flex;gap:.35rem;align-items:center;white-space:nowrap"><i class="ti ti-external-link"></i> Åpne i arbeidsområde</a>' +
              '</div>';
            })() +
            `<div class="admin-tabbody" data-tabbody></div>
             <div class="admin-foot">
               <span class="admin-vibeverk">Levert av Vibeverk</span>
               ${C.button({ label: "Logg ut", variant: "ghost", attrs: 'data-logout' })}
             </div>`
    });
    bindModalClose(root);
    var fsToggle = root.querySelector("[data-modal-fullscreen-toggle]");
    if (fsToggle) fsToggle.addEventListener("click", function () {
      adminFullscreen = !adminFullscreen;
      Store.set("admin-panel-fullscreen", adminFullscreen);
      renderAdminPanel(root);
    });

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

    renderAdminTab(root.querySelector("[data-tabbody]"));
    startAdminBadgeRefresh(root);
  }

  function renderAdminTab(body) {
    if (!body) return;
    if (activeTab === "design")     return adminDesign(body);
    if (activeTab === "innhold")    return adminContent(body);
    if (activeTab === "tjenester")  return adminServices(body);
    if (activeTab === "aktuelt")    return adminNews(body);
    if (activeTab === "navigasjon") return adminNavigation(body);
    if (activeTab === "analyse")    return adminAnalyse(body);
    if (activeTab === "leads")      return adminLeads(body);
    if (activeTab === "chat-admin" && window.VwChatAdmin) {
      body.innerHTML = "";
      window.VwChatAdmin.render(body);
      return;
    }
    if (activeTab === "sikkerhetskopi") return adminBackup(body);
    if (activeTab === "brukarar") {
      if (window.VwUsersAdmin) window.VwUsersAdmin.render(body);
      return;
    }
    if (activeTab === "min-konto")      return adminMinKonto(body);
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

      // textContent (ikkje innerHTML) tel berre synleg tekst, akkurat som
      // stripHtml() ville gjort — men utan å måtte regex-parse HTML-en sjølv.
      const counter = wrap.querySelector("[data-rtfield-counter]");
      function updateCounter() {
        if (!counter) return;
        const max = parseInt(counter.getAttribute("data-max"), 10) || 0;
        const len = editor.textContent.length;
        counter.textContent = len + "/" + max + " tegn";
        counter.classList.toggle("is-over", len > max);
      }
      function sync() { hidden.value = C.sanitizeRichHtml(editor.innerHTML); updateCounter(); }
      editor.addEventListener("input", sync);
      editor.addEventListener("blur", sync);
      updateCounter();

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

  // aspect: eit tal (som før), ELLER { aspect, label } når kallaren også vil
  // merke hovudboksen (berre meiningsfullt saman med previews).
  // previews (valgfritt): [{ aspect, label }, ...] -- sjå notatet ved
  // C.imageField() i components.js.
  function imgField(id, label, img, aspect, previews) {
    const n = Media.norm(img);
    const isUrl = n.src && n.src.indexOf("media:") !== 0;
    const a = (aspect && typeof aspect === "object") ? aspect : { aspect: aspect };
    return C.imageField({
      id: id, label: label,
      value: JSON.stringify(n),
      urlValue: isUrl ? n.src : "",
      aspect: a.aspect || (16 / 9),
      aspectLabel: a.label || "",
      previews: previews || [],
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
      // Sekundære, ikkje-redigerbare "slik ser det faktisk ut her òg"-bokser
      // (t.d. Aktuelt-kort + artikkelside) -- tom liste for dei aller fleste
      // biletfelt, som då gjer alle funksjonane under til reine no-op.
      const secondaryBoxes = Array.prototype.slice.call(wrap.querySelectorAll("[data-imgfield-secondary]"));
      const altInput = wrap.querySelector("[data-imgfield-alt]");
      // Lesast på nytt kvar gong layout() køyrer (ikkje ein éin-gongs const) --
      // module-scrollbanner.js sin modus-veksling (statisk/parallax) endrar
      // data-aspect etter at feltet alt er bunde, og treng at eit nytt
      // layout()-kall faktisk brukar den NYE verdien, ikkje ein fastfrosen
      // snapshot frå bindetidspunktet.
      function currentAspect() { return parseFloat(preview.getAttribute("data-aspect")) || (16 / 9); }

      let state, crop = null;   // crop = { ww, wh } i prosent av forhåndsvisningen
      try { state = Media.norm(JSON.parse(hidden.value)); } catch (e) { state = Media.norm(hidden.value); }

      function parsePos(p) { const m = String(p).split(/\s+/); return [parseFloat(m[0]) || 50, parseFloat(m[1]) || 50]; }
      function sync() { hidden.value = JSON.stringify(state); }
      // Oppdaterer aria-valuetext frå faktisk state.pos -- kalla både ved
      // opning (render()) og etter kvar piltast-flytting, slik at ein
      // skjermlesar aldri får høyre den hardkoda "Midten"-startverdien for
      // eit bilete som alt har eit ikkje-sentrert fokuspunkt lagra.
      function updateValueText() {
        const p = parsePos(state.pos);
        // role="slider" krev aria-valuenow -- ein del skjermlesarar melder
        // kontrollen som verdilaus/ugyldig utan han, sjølv med aria-valuetext
        // til stades. Kontrollen er eigentleg 2-dimensjonal (x OG y); vel
        // x-aksen som den formelle "verdien" og lèt aria-valuetext (under)
        // bere den fulle skildringa av begge aksane.
        preview.setAttribute("aria-valuenow", Math.round(p[0]));
        preview.setAttribute("aria-valuetext", Math.round(p[0]) + "% frå venstre, " + Math.round(p[1]) + "% frå toppen");
      }

      function placeWindow() {
        const win = preview.querySelector("[data-crop-window]");
        if (!win || !crop) return;
        const p = parsePos(state.pos);
        win.style.left = (p[0] * (100 - crop.ww) / 100) + "%";
        win.style.top  = (p[1] * (100 - crop.wh) / 100) + "%";
      }
      function layout(natW, natH) {
        const outAspect = currentAspect();
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
      // Kalla utanfrå (t.d. module-scrollbanner.js sin modus-veksling) etter
      // at data-aspect på preview-elementet har endra seg -- re-kjører layout()
      // med det biletet som alt er lasta, i staden for at kallaren prøver å
      // replikere layout() sin matte sjølv utanfrå (som var rotårsaka til at
      // draging vart feil rett etter ein modusbyte: crop/outAspect var
      // fastfrosne frå bindetidspunktet og vart aldri oppdaterte, sjølv om
      // vindauget sin synlege storleik vart det).
      // Sekundærboksane speglar KVA SOM HELST framhaldande "slik ser det
      // faktisk ut her òg"-kontekst, med same lagra state.pos som hovudboksen
      // -- reint object-position/CSS-basert (object-fit:cover gjer sjølve
      // skjeringa), ingen eiga ww/wh-vindaugerekning slik hovudboksen har.
      function renderSecondaries() {
        if (!secondaryBoxes.length) return;
        const src = Media.resolve(state.src);
        secondaryBoxes.forEach(function (box) {
          const asp = parseFloat(box.getAttribute("data-aspect")) || (16 / 9);
          box.style.aspectRatio = String(asp);
          // Same tomt-bilete-melding som hovudboksen (imgfield__empty) --
          // elles vart sekundærboksen berre ein tom, uforklart ramme mens
          // hovudboksen sa "Ingen bilde" rett attmed (UX-gjennomgang 2026-07-15).
          box.innerHTML = src
            ? '<img alt="" src="' + src + '" style="object-position:' + state.pos + '">'
            : '<span class="imgfield__empty">' + C.icon("photo") + ' Ingen bilde</span>';
        });
      }
      // Billeg per-drag-frame-oppdatering -- rører berre object-position, ingen
      // ny reflow-tung geometri, så denne kan trygt kallast på kvart
      // pointermove/piltast-steg utan ytingskostnad.
      function updateSecondaryPositions() {
        if (!secondaryBoxes.length) return;
        secondaryBoxes.forEach(function (box) {
          const img = box.querySelector("img");
          if (img) img.style.objectPosition = state.pos;
        });
      }
      wrap.addEventListener("imgfield:relayout", function () {
        const img = preview.querySelector("img");
        if (img && img.naturalWidth) layout(img.naturalWidth, img.naturalHeight);
        renderSecondaries();
      });
      // Forklarer sekundærboksane -- utan denne teksten kan ein admin lett tru
      // dei er eit ekstra bilete å laste opp, eller prøve å dra dei sjølv
      // (dei svarar ikkje) -- UX-gjennomgang 2026-07-15.
      const secondaryHintSuffix = secondaryBoxes.length
        ? " De andre boksene viser hvordan det samme utsnittet ser ut de andre stedene bildet brukes — du styrer kun boksen øverst til venstre."
        : "";
      function render() {
        const src = Media.resolve(state.src);
        if (!src) {
          preview.classList.remove("is-set");
          preview.style.aspectRatio = ""; preview.style.width = "100%";
          preview.innerHTML = '<span class="imgfield__empty">' + C.icon("photo") + ' Ingen bilde</span>';
          if (hint) hint.textContent = "Last opp en fil eller lim inn en bilde-URL." + secondaryHintSuffix;
          crop = null; renderSecondaries(); return;
        }
        preview.classList.add("is-set");
        preview.style.aspectRatio = ""; preview.style.width = "";
        preview.innerHTML = '<img class="cropper__img" draggable="false" alt="" src="' + src + '">' +
                            '<div class="cropper__window" data-crop-window></div>';
        if (hint) hint.textContent = "Dra det lyse utsnittet for å velge hva som vises på siden, eller bruk piltastene når feltet er fokusert." + secondaryHintSuffix;
        updateValueText();
        renderSecondaries();
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
        // Når utsnittvindauget alt fyller heile bredda/høgda (t.d. eit 21:9-
        // banner med eit vanleg liggjande foto) er den aksen inert -- vindauget
        // kan ikkje flytte seg, uansett kor mykje du drar. Behald den lagra
        // posisjonen for den aksen i staden for å tvinge han til 50 (midten)
        // ved kvar drag, som før stille overskreiv ein alt lagra, ikkje-sentrert
        // verdi -- funne under UX-gjennomgang 2026-07-15.
        const cur = parsePos(state.pos);
        const nx = maxL > 0 ? Math.round(nl / maxL * 100) : cur[0];
        const ny = maxT > 0 ? Math.round(nt / maxT * 100) : cur[1];
        state.pos = nx + "% " + ny + "%";
        sync();
        updateSecondaryPositions();
        const win = preview.querySelector("[data-crop-window]");
        if (win) { win.style.left = nl + "%"; win.style.top = nt + "%"; }
      });
      window.addEventListener("pointerup", function () { if (dragging) { dragging = false; preview.classList.remove("is-grabbing"); } });

      // Tastaturstyring (piltastar) — biletfeltet hadde ingen tilgjengeleg
      // måte å flytte fokuspunktet på utan mus/touch før dette.
      preview.addEventListener("keydown", function (e) {
        if (!state.src || !crop) return;
        var STEP = 5;
        // Same inert-akse-sperre som pointermove over -- utan denne kunne
        // piltastane endre den lagra posisjonen på ein akse der det synlege
        // vindauget likevel aldri flytta seg, eit misforhold mellom mus/
        // tastatur som UX-gjennomgangen 2026-07-15 fann.
        var maxL = 100 - crop.ww, maxT = 100 - crop.wh;
        var dx = (maxL > 0 && e.key === "ArrowLeft") ? -STEP : (maxL > 0 && e.key === "ArrowRight") ? STEP : 0;
        var dy = (maxT > 0 && e.key === "ArrowUp")   ? -STEP : (maxT > 0 && e.key === "ArrowDown")  ? STEP : 0;
        if (!dx && !dy) return;
        e.preventDefault();
        var p = parsePos(state.pos);
        var nx = Math.max(0, Math.min(100, p[0] + dx));
        var ny = Math.max(0, Math.min(100, p[1] + dy));
        state.pos = Math.round(nx) + "% " + Math.round(ny) + "%";
        sync();
        placeWindow();
        updateValueText();
        updateSecondaryPositions();
      });

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
            alert('"' + files[idx].name + '" er for stor (maks ' + (_sb ? Media.MAX_FILE_MB_REMOTE : Media.MAX_FILE_MB) + ' MB per fil' + (_sb ? '' : ' for demo-lagringen') + ').');
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

  /* --- WCAG-kontrastrekning + fargeforslag + fargepalett-generator, PORTA
     ordrett frå Console sin console-core.js (renderWeb()/contrastRatio()/
     suggestAccessibleColor()/generateThemePalette()) -- IKKJE delt kode,
     sidan Web-admin (core.js) og Console (console-core.js) aldri deler
     JS-kontekst (same grunngjeving som Console sin eigen kommentar om
     fontforhandsvisinga si duplisering). Rein klientside-matte, ingen
     lagring før faktisk "Lagre". */
  function designHexToRgb(hex) {
    var h = (hex || "").replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var num = parseInt(h, 16) || 0;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  function designRelLuminance(hex) {
    var rgb = designHexToRgb(hex);
    var chans = [rgb.r, rgb.g, rgb.b].map(function (c) {
      var s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * chans[0] + 0.7152 * chans[1] + 0.0722 * chans[2];
  }
  function designContrastRatio(hex1, hex2) {
    var l1 = designRelLuminance(hex1), l2 = designRelLuminance(hex2);
    var lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }
  function designHexToHsl(hex) {
    var rgb = designHexToRgb(hex);
    var r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }
  function designHslToHex(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      var hue2rgb = function (p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    function toHex(x) { var v = Math.round(x * 255).toString(16); return v.length === 1 ? "0" + v : v; }
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }
  function designSuggestAccessibleColor(fgHex, bgHex, targetRatio) {
    var hsl = designHexToHsl(fgHex);
    var darker  = designHslToHex(hsl.h, hsl.s, Math.max(0, hsl.l - 10));
    var lighter = designHslToHex(hsl.h, hsl.s, Math.min(100, hsl.l + 10));
    var goDarker = designContrastRatio(darker, bgHex) >= designContrastRatio(lighter, bgHex);
    var l = hsl.l, hex = fgHex;
    for (var i = 0; i < 40 && designContrastRatio(hex, bgHex) < targetRatio; i++) {
      l = goDarker ? Math.max(0, l - 2.5) : Math.min(100, l + 2.5);
      hex = designHslToHex(hsl.h, hsl.s, l);
      if (l <= 0 || l >= 100) break;
    }
    return hex;
  }
  function designGenerateThemePalette() {
    var hue = Math.floor(Math.random() * 360);
    var secondaryHue = (hue + 150 + Math.floor(Math.random() * 60)) % 360;
    var background = designHslToHex(hue, 12, 97);
    var surface = "#ffffff";
    var text      = designSuggestAccessibleColor(designHslToHex(hue, 15, 15), background, 4.5);
    var primary   = designSuggestAccessibleColor(designHslToHex(hue, 70, 45), background, 3);
    var secondary = designSuggestAccessibleColor(designHslToHex(secondaryHue, 65, 48), background, 3);
    return { primary: primary, secondary: secondary, background: background, text: text, surface: surface };
  }
  function designRefreshContrastInfo(body) {
    var el = body.querySelector("#cs-d-contrast-info");
    if (!el) return;
    var text = body.querySelector("#cs-d-text").value;
    var bg = body.querySelector("#cs-d-bg").value;
    var primary = body.querySelector("#cs-d-primary").value;
    var textRatio = designContrastRatio(text, bg);
    var primaryRatio = designContrastRatio(primary, bg);
    var textOk = textRatio >= 4.5;
    var primaryOk = primaryRatio >= 3;
    el.innerHTML =
      '<p style="margin:.4rem 0 0;font-size:.82rem">' +
        (textOk ? "✓ Teksten er lett å lese mot bakgrunnen" : "⚠ Teksten kan vere vanskeleg å lese mot bakgrunnen") +
        " (kontrast " + textRatio.toFixed(1) + ":1, bør vere minst 4.5:1)" +
        (textOk ? "" : ' <button type="button" class="btn btn--ghost btn--sm" data-design-suggest="cs-d-text" data-design-suggest-target="4.5" style="padding:.5rem .8rem;font-size:.82rem">Generer forslag</button>') +
      "</p>" +
      '<p style="margin:.2rem 0 0;font-size:.82rem">' +
        (primaryOk ? "✓ Primærfargen skil seg godt frå bakgrunnen" : "⚠ Primærfargen kan vere vanskeleg å sjå mot bakgrunnen") +
        " (kontrast " + primaryRatio.toFixed(1) + ":1, bør vere minst 3:1 — gjeld t.d. knappekantar)" +
        (primaryOk ? "" : ' <button type="button" class="btn btn--ghost btn--sm" data-design-suggest="cs-d-primary" data-design-suggest-target="3" style="padding:.5rem .8rem;font-size:.82rem">Generer forslag</button>') +
      "</p>";
  }

  /* --- Kuratert skriftpar-liste, PORTA ordrett frå Console (FONT_PAIRS i
     console-core.js) -- same 11 par, slik at kunden vel mellom nøyaktig dei
     same, alt nedlasta/kjende skriftane operatøren har tilgjengeleg. Live
     forhandsvisning hentar Google Fonts sitt CSS2-API, same mønster som
     Console (ikkje delt kode, sjå notatet over). */
  var DESIGN_FONT_PAIRS = [
    { label: "Syne + Inter",                    display: "Syne",               body: "Inter" },
    { label: "Playfair + Source Sans 3",         display: "Playfair Display",   body: "Source Sans 3" },
    { label: "Space Grotesk + Work Sans",        display: "Space Grotesk",      body: "Work Sans" },
    { label: "Fraunces + Karla",                 display: "Fraunces",           body: "Karla" },
    { label: "Poppins + Nunito Sans",            display: "Poppins",            body: "Nunito Sans" },
    { label: "Bricolage Grotesque + Inter",      display: "Bricolage Grotesque",body: "Inter" },
    { label: "DM Serif Display + DM Sans",       display: "DM Serif Display",   body: "DM Sans" },
    { label: "Libre Baskerville + Lato",         display: "Libre Baskerville",  body: "Lato" },
    { label: "Archivo + Roboto",                 display: "Archivo",            body: "Roboto" },
    { label: "Outfit + Plus Jakarta Sans",       display: "Outfit",             body: "Plus Jakarta Sans" },
    { label: "Cormorant Garamond + Mulish",      display: "Cormorant Garamond", body: "Mulish" }
  ];
  var _designFontPreviewState = {};
  function designRebuildPreviewFontLink() {
    var families = [];
    var seen = {};
    Object.keys(_designFontPreviewState).forEach(function (k) {
      var f = _designFontPreviewState[k];
      var key = f.name + "|" + f.weights.join(",");
      if (seen[key]) return;
      seen[key] = true;
      families.push("family=" + encodeURIComponent(f.name).replace(/%20/g, "+") + ":wght@" + f.weights.join(";"));
    });
    var linkEl = document.getElementById("design-preview-fonts");
    if (!families.length) return;
    if (!linkEl) {
      linkEl = document.createElement("link");
      linkEl.id = "design-preview-fonts";
      linkEl.rel = "stylesheet";
      document.head.appendChild(linkEl);
    }
    linkEl.href = "https://fonts.googleapis.com/css2?" + families.join("&") + "&display=swap";
  }
  function designFontPreviewMarkup(id) {
    return '<p id="' + id + '" style="margin:.4rem 0 0;padding:.55rem .75rem;' +
      'border:1px solid var(--color-border);border-radius:8px;font-size:1.15rem;' +
      'opacity:.45;transition:opacity .15s" aria-hidden="true">Aa Bb Cc — Eksempeltekst 123</p>';
  }
  function designRefreshFontPreview(nameId, previewId, body) {
    var nameEl = body.querySelector("#" + nameId);
    var prevEl = body.querySelector("#" + previewId);
    if (!nameEl || !prevEl) return;
    var name = nameEl.value.trim();
    if (!name) {
      prevEl.style.fontFamily = "inherit";
      prevEl.style.opacity = ".45";
      delete _designFontPreviewState[previewId];
      designRebuildPreviewFontLink();
      return;
    }
    prevEl.style.fontFamily = "'" + name.replace(/'/g, "") + "', sans-serif";
    prevEl.style.opacity = "1";
    _designFontPreviewState[previewId] = { name: name, weights: [400, 700] };
    designRebuildPreviewFontLink();
  }
  function designRefreshFontPairActive(body) {
    var d = body.querySelector("#cs-d-dfont").value.trim().toLowerCase();
    var b = body.querySelector("#cs-d-bfont").value.trim().toLowerCase();
    body.querySelectorAll("[data-design-pair]").forEach(function (btn) {
      var p = DESIGN_FONT_PAIRS[parseInt(btn.getAttribute("data-design-pair"), 10)];
      var isMatch = !!p && p.display.toLowerCase() === d && p.body.toLowerCase() === b;
      btn.classList.toggle("is-active", isMatch);
    });
  }

  /* --- Admin: Design (designmal-val + farge/font/logo, "Design-modul"/
     sidebygger). Berre synleg når feat("sidebygger") er sant (sjå
     allowedCategoriesForRole). Malar vert lagt til i `templates`-lista under
     etter kvart som dei vert bygde (kvar sin eigen fil, sjå
     template-klassisk.js sin kommentar).

     Farge/font/logo-delen skriv til DEN SAME "superconfig"-Store-nøkkelen
     som Console sitt "Web"-tema-panel (renderWeb() i console-core.js) alt
     brukar (applySuperConfig()/applyTheme() les nøyaktig same nøkkel,
     uansett kven som skreiv sist) -- ingen ny synk-mekanisme, berre ein ny
     skrivar til det som alt finst. No på full djupne med Console sitt panel
     for farge/font (WCAG-kontrastvalidator, fargepalett-generator, kuratert
     skriftpar-liste, nullstill-til-standard) og eit avgrensa logo-opplasting
     (raster-berre, sjå Media.putLogo() sin kommentar for kvifor SVG er
     eksplisitt utelaten her). */
  function adminDesign(body) {
    var templates = [
      { id: "klassisk", label: "Klassisk", desc: "Dagens design — bilete i full breidde bak tittel i Forsidetopp, tekst ved sida av bilete i Om oss." },
      { id: "panorama", label: "Panorama", desc: "Store bilete er hovudelementet — minimal tekst, ei meir visuell/redaksjonell kjensle enn Klassisk." }
    ];
    var current = activeTemplate();
    var sc = getSuperConfig();
    var col = Object.assign({ primary: "#1a7a6e", secondary: "#c17f3e", background: "#fbfaf8", text: "#1B1B1F", surface: "#ffffff", radius: 14 }, sc.colors || {});
    var fnt = Object.assign({ display: "", body: "" }, sc.fonts || {});
    var com = Object.assign({ logoUrl: "" }, sc.company || {});
    function colorRow(id, label, value, hint) {
      return '<div style="display:grid;gap:.15rem">' +
        '<div style="display:flex;align-items:center;gap:.6rem;justify-content:space-between">' +
          '<label for="' + id + '" style="font-size:.85rem;font-weight:600">' + C.esc(label) + '</label>' +
          '<input type="color" id="' + id + '" value="' + C.esc(value) + '" style="width:44px;height:32px;padding:0;border:1.5px solid var(--color-border);border-radius:6px;cursor:pointer">' +
        '</div>' +
        (hint ? '<p class="field__hint" style="margin:0">' + C.esc(hint) + '</p>' : '') +
      '</div>';
    }
    body.innerHTML =
      '<p class="prose prose--muted">Vel design-mal for nettsida, og set fargar/fontar/logo. Kvar mal gjev heile sida eit anna visuelt uttrykk.</p>' +
      '<form data-design class="admin-form">' +
        '<div class="admin-group" style="display:grid;gap:.6rem">' +
          '<legend style="font-weight:700">Designmal</legend>' +
          templates.map(function (t) {
            var checked = t.id === current ? " checked" : "";
            return '<label style="display:flex;align-items:flex-start;gap:.6rem;padding:.7rem;border:1.5px solid var(--color-border);border-radius:10px;cursor:pointer">' +
              '<input type="radio" name="design-template" value="' + C.esc(t.id) + '"' + checked + ' style="margin-top:.2rem">' +
              '<span><strong style="display:block">' + C.esc(t.label) + '</strong><span style="font-size:.85rem;color:var(--color-muted)">' + C.esc(t.desc) + '</span></span>' +
            '</label>';
          }).join("") +
        '</div>' +
        '<div class="admin-group" style="display:grid;gap:.6rem">' +
          '<legend style="font-weight:700">Logo</legend>' +
          '<div id="cs-d-logo-preview-wrap" style="display:' + (com.logoUrl ? "flex" : "none") + ';align-items:center;justify-content:center;width:120px;height:64px;border:1.5px solid var(--color-border);border-radius:8px;background:var(--color-tint);overflow:hidden">' +
            '<img id="cs-d-logo-preview" src="' + C.esc(Media.resolve(com.logoUrl || "")) + '" alt="" style="max-width:100%;max-height:100%;object-fit:contain">' +
          '</div>' +
          C.field({ id: "cs-d-logo", label: "Logo-URL", value: com.logoUrl || "", placeholder: "https://…",
            help: "Lim inn ei lenke til ein logo som alt er hosta ein annan stad, ELLER last opp ei fil under." }) +
          '<div class="field" style="margin-top:-.4rem">' +
            '<label>Last opp logo (PNG, JPEG eller WebP, maks 6MB — vert automatisk skalert ned)</label>' +
            '<input type="file" id="cs-d-logo-file" accept="image/png,image/jpeg,image/webp">' +
            '<p class="field__hint" id="cs-d-logo-status"></p>' +
          '</div>' +
        '</div>' +
        '<div class="admin-group" style="display:grid;gap:.6rem">' +
          '<legend style="font-weight:700">Fargar</legend>' +
          '<div>' +
            '<button type="button" class="btn btn--ghost btn--sm" id="cs-d-palette-generate">🎨 Generer fargepalett</button>' +
            '<p class="field__hint">Set saman eit heilt fargeforslag (primær, sekundær, bakgrunn, tekst, overflate) som er lett å lese. Klikk gjerne fleire gongar for ulike forslag. Berre teksten og primærfargen sjekkast (sjå under) — dei andre vert ikkje validerte. Ingenting vert lagra før du trykkjer «Lagre».</p>' +
          '</div>' +
          colorRow("cs-d-primary", "Primærfarge", col.primary, "Knappar, lenker og aktive element") +
          colorRow("cs-d-secondary", "Sekundærfarge", col.secondary, "CTA-knappar og uthevingar") +
          colorRow("cs-d-bg", "Bakgrunnsfarge", col.background, "Sideflata bak alt innhald") +
          colorRow("cs-d-text", "Tekstfarge", col.text, "Hovudtekst og overskrifter") +
          colorRow("cs-d-surface", "Overflate (kort/panel)", col.surface, "Kort, modalar og paneler") +
          '<div id="cs-d-contrast-info"></div>' +
          '<div class="field" style="margin-top:.3rem">' +
            '<label>Hjørne-radius</label>' +
            '<select id="cs-d-radius">' +
              '<option value="0"' + (col.radius == 0 ? " selected" : "") + '>Skarpe hjørner</option>' +
              '<option value="8"' + (col.radius == 8 ? " selected" : "") + '>Litt runde</option>' +
              '<option value="14"' + (col.radius == 14 ? " selected" : "") + '>Standard</option>' +
              '<option value="24"' + (col.radius == 24 ? " selected" : "") + '>Runde</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="admin-group" style="display:grid;gap:.6rem">' +
          '<legend style="font-weight:700">Fontar</legend>' +
          '<div class="fontpair-row">' +
            DESIGN_FONT_PAIRS.map(function (p, i) {
              return '<button type="button" class="fontpair-btn" data-design-pair="' + i + '">' + C.esc(p.label) + '</button>';
            }).join("") +
          '</div>' +
          C.field({ id: "cs-d-dfont", label: "Display-font (overskrifter)", value: fnt.display, placeholder: "Syne" }) +
          designFontPreviewMarkup("cs-d-dfont-preview") +
          C.field({ id: "cs-d-bfont", label: "Brødtekst-font", value: fnt.body, placeholder: "Inter" }) +
          designFontPreviewMarkup("cs-d-bfont-preview") +
          '<p class="field__hint">Vel eit av dei ferdige skriftparane over, eller skriv inn eit eige. Fritekst-namnet må stemme NØYAKTIG med namnet på <a href="https://fonts.google.com" target="_blank" rel="noopener">Google Fonts</a> (t.d. «Poppins») — bla deg fram der for å finne fleire, kopier namnet nøyaktig som det står øvst på skrifta si eiga side.</p>' +
          '<div style="margin-top:.3rem">' +
            '<button type="button" class="btn btn--ghost btn--sm" id="cs-d-reset">↺ Nullstill fargar og fontar til standard</button>' +
          '</div>' +
        '</div>' +
        C.button({ label: "Lagre", type: "submit", variant: "primary" }) +
        '<p class="form__status" data-design-status role="status" aria-live="polite"></p>' +
      '</form>';

    designRefreshFontPreview("cs-d-dfont", "cs-d-dfont-preview", body);
    designRefreshFontPreview("cs-d-bfont", "cs-d-bfont-preview", body);
    designRefreshFontPairActive(body);
    ["cs-d-dfont", "cs-d-bfont"].forEach(function (id) {
      body.querySelector("#" + id).addEventListener("input", function () {
        designRefreshFontPreview(id, id === "cs-d-dfont" ? "cs-d-dfont-preview" : "cs-d-bfont-preview", body);
        designRefreshFontPairActive(body);
      });
    });
    body.querySelectorAll("[data-design-pair]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = DESIGN_FONT_PAIRS[parseInt(btn.getAttribute("data-design-pair"), 10)];
        if (!p) return;
        body.querySelector("#cs-d-dfont").value = p.display;
        body.querySelector("#cs-d-bfont").value = p.body;
        designRefreshFontPreview("cs-d-dfont", "cs-d-dfont-preview", body);
        designRefreshFontPreview("cs-d-bfont", "cs-d-bfont-preview", body);
        designRefreshFontPairActive(body);
      });
    });

    designRefreshContrastInfo(body);
    ["cs-d-text", "cs-d-bg", "cs-d-primary"].forEach(function (id) {
      body.querySelector("#" + id).addEventListener("input", function () { designRefreshContrastInfo(body); });
    });
    body.querySelector("#cs-d-palette-generate").addEventListener("click", function () {
      var palette = designGenerateThemePalette();
      body.querySelector("#cs-d-primary").value   = palette.primary;
      body.querySelector("#cs-d-secondary").value = palette.secondary;
      body.querySelector("#cs-d-bg").value        = palette.background;
      body.querySelector("#cs-d-text").value      = palette.text;
      body.querySelector("#cs-d-surface").value   = palette.surface;
      designRefreshContrastInfo(body);
    });
    // Delegert lyttar -- overlever at designRefreshContrastInfo() byggjer
    // #cs-d-contrast-info sitt innhald (inkl. "Generer forslag"-knappane)
    // på nytt kvar gong.
    body.querySelector("#cs-d-contrast-info").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-design-suggest]");
      if (!btn) return;
      var fieldId = btn.getAttribute("data-design-suggest");
      var target  = parseFloat(btn.getAttribute("data-design-suggest-target"));
      var bg = body.querySelector("#cs-d-bg").value;
      var fg = body.querySelector("#" + fieldId).value;
      body.querySelector("#" + fieldId).value = designSuggestAccessibleColor(fg, bg, target);
      designRefreshContrastInfo(body);
    });
    body.querySelector("#cs-d-reset").addEventListener("click", function () {
      body.querySelector("#cs-d-primary").value = CFG.colors.primary;
      body.querySelector("#cs-d-secondary").value = CFG.colors.secondary;
      body.querySelector("#cs-d-bg").value = CFG.colors.background;
      body.querySelector("#cs-d-text").value = CFG.colors.text;
      body.querySelector("#cs-d-surface").value = CFG.colors.surface;
      body.querySelector("#cs-d-radius").value = "14";
      body.querySelector("#cs-d-dfont").value = CFG.fonts.display || "";
      body.querySelector("#cs-d-bfont").value = CFG.fonts.body || "";
      designRefreshFontPreview("cs-d-dfont", "cs-d-dfont-preview", body);
      designRefreshFontPreview("cs-d-bfont", "cs-d-bfont-preview", body);
      designRefreshFontPairActive(body);
      designRefreshContrastInfo(body);
    });

    // Logo-filopplasting -- går direkte mot KUNDEN sitt eige, allereie
    // autentiserte Supabase-Storage-prosjekt via Media.putLogo() (raster-
    // berre, sjå den funksjonen sin kommentar for kvifor SVG er utelaten).
    (function () {
      var fileInput = body.querySelector("#cs-d-logo-file");
      var statusEl  = body.querySelector("#cs-d-logo-status");
      var urlField  = body.querySelector("#cs-d-logo");
      var previewWrap = body.querySelector("#cs-d-logo-preview-wrap");
      var previewImg  = body.querySelector("#cs-d-logo-preview");
      function updatePreview() {
        var src = Media.resolve(urlField.value.trim());
        if (src) { previewImg.src = src; previewWrap.style.display = "flex"; }
        else { previewWrap.style.display = "none"; }
      }
      urlField.addEventListener("input", updatePreview);
      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        statusEl.textContent = "Lastar opp …";
        Media.putLogo(file).then(function (url) {
          urlField.value = url;
          updatePreview();
          statusEl.textContent = "✓ Lasta opp! Hugs å trykkje «Lagre» for å ta han i bruk.";
          fileInput.value = "";
        }).catch(function (err) {
          if (err && err.message === "type") {
            statusEl.textContent = "Filtypen er ikkje støtta her. Bruk PNG, JPEG eller WebP (SVG-logo kan Vibeverk laste opp for deg via Console).";
          } else if (err && err.message === "size") {
            statusEl.textContent = "Fila er for stor (maks 6MB).";
          } else if (err && err.message === "dims") {
            statusEl.textContent = "Biletet har for høg oppløysing. Prøv eit mindre/enklare bilete.";
          } else if (err && err.message === "nosupabase") {
            statusEl.textContent = "Logo-opplasting krev ei aktiv tilkopling. Lim inn ei lenke i staden, eller ta kontakt med Vibeverk.";
          } else {
            statusEl.textContent = "Opplasting feila. Prøv igjen, eller lim inn ei lenke i staden.";
          }
          fileInput.value = "";
        });
      });
    })();

    body.querySelector("[data-design]").addEventListener("submit", function (e) {
      e.preventDefault();
      var picked = body.querySelector('input[name="design-template"]:checked');
      content.designTemplate = picked ? picked.value : "klassisk";
      saveContent();

      var scNow = getSuperConfig();
      scNow.colors = Object.assign({}, scNow.colors || {}, {
        primary: body.querySelector("#cs-d-primary").value,
        secondary: body.querySelector("#cs-d-secondary").value,
        background: body.querySelector("#cs-d-bg").value,
        text: body.querySelector("#cs-d-text").value,
        surface: body.querySelector("#cs-d-surface").value,
        radius: parseInt(body.querySelector("#cs-d-radius").value, 10)
      });
      scNow.fonts = Object.assign({}, scNow.fonts || {}, {
        display: body.querySelector("#cs-d-dfont").value.trim(),
        body: body.querySelector("#cs-d-bfont").value.trim()
      });
      scNow.company = Object.assign({}, scNow.company || {}, {
        logoUrl: body.querySelector("#cs-d-logo").value.trim()
      });
      Store.set(SUPER_KEY, scNow);
      applySuperConfig();
      applyTheme();
      render();
      setStatus(body.querySelector("[data-design-status]"), "Lagret.", "ok");
    });
  }

  function adminContent(body) {
    const cf = content.footer || {};
    body.innerHTML = `
      <form data-content class="admin-form">
        <fieldset class="admin-group">
          <legend>Forsidetopp</legend>
          ${C.field({ id: "f-hero-title", label: "Tittel", value: content.hero.title })}
          ${C.field({ id: "f-hero-sub", label: "Undertittel", multiline: true, rows: 2, value: content.hero.subtitle })}
          ${imgField("f-hero-image", "Bakgrunnsbilde (vises i full bredde)", content.hero.image, 2.4)}
          ${C.field({ id: "f-hero-cta-label", label: "Knappetekst", value: content.hero.ctaLabel, placeholder: "Ta kontakt" })}
          ${C.field({ id: "f-hero-cta-target", label: "Knappen peker til (seksjon-id)", value: content.hero.ctaTarget, placeholder: "#kontakt", hint: "Tomt = knappen vises ikke" })}
        </fieldset>
        <fieldset class="admin-group">
          <legend>Om oss</legend>
          ${C.field({ id: "f-about-heading", label: "Overskrift", value: content.about.heading, placeholder: "Om oss" })}
          ${C.field({ id: "f-about-intro", label: "Ingress (valgfri)", value: content.about.intro, placeholder: "" })}
          ${C.richTextField({ id: "f-about", label: "Tekst", value: content.about.text })}
          ${imgField("f-about-image", "Bilde", content.about.image, 4/3)}
        </fieldset>
        <fieldset class="admin-group">
          <legend>Tjenester-seksjon</legend>
          <p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Selve tjenestekortene redigeres i egen fane («Tjenester») — her styres kun overskriften over dem.</p>
          ${C.field({ id: "f-svc-heading", label: "Overskrift", value: content.servicesSection.heading, placeholder: "Tjenester" })}
          ${C.field({ id: "f-svc-intro", label: "Ingress (valgfri)", value: content.servicesSection.intro, placeholder: "" })}
        </fieldset>
        <fieldset class="admin-group">
          <legend>Aktuelt-seksjon</legend>
          <p style="font-size:.82rem;color:var(--color-muted);margin:0 0 .8rem">Selve sakene redigeres i egen fane («Aktuelt») — her styres kun overskriften over dem.</p>
          ${C.field({ id: "f-news-heading", label: "Overskrift", value: content.newsSection.heading, placeholder: "Aktuelt" })}
          ${C.field({ id: "f-news-intro", label: "Ingress (valgfri)", value: content.newsSection.intro, placeholder: "" })}
        </fieldset>
        <fieldset class="admin-group">
          <legend>Kontaktinfo</legend>
          ${C.field({ id: "f-cs-heading", label: "Overskrift", value: content.contactSection.heading, placeholder: "Kontakt" })}
          ${C.field({ id: "f-cs-intro", label: "Ingress (valgfri)", value: content.contactSection.intro, placeholder: "" })}
          ${C.field({ id: "f-c-email", label: "E-post", value: content.contact.email })}
          ${C.field({ id: "f-c-phone", label: "Telefon", value: content.contact.phone })}
          ${C.field({ id: "f-c-address", label: "Adresse", value: content.contact.address })}
          <div class="extra-fields">
            <p class="extra-fields__label">Flere felter (valgfritt)</p>
            <div data-extra-list>${(content.contact.extra || []).map(extraRow).join("")}</div>
            ${C.button({ label: "Legg til felt", icon: "plus", variant: "ghost", attrs: 'data-extra-add' })}
          </div>
          ${C.field({ id: "f-cs-success", label: "Bekreftelsesmelding etter innsending", value: content.contactSection.successMessage, placeholder: "Takk! Vi tar kontakt så snart vi kan." })}
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
          ${C.field({ id: "f-ft-copy",     label: "Copyright-tekst",   value: cf.copyright || "",      placeholder: "© 2026 Nordpunkt AS",
                      hint: "Tomt felt genererer automatisk «© [år] [firmanavn]»." })}
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
      content.hero.title     = body.querySelector("#f-hero-title").value;
      content.hero.subtitle  = body.querySelector("#f-hero-sub").value;
      content.hero.image     = readImageField(body, "f-hero-image");
      content.hero.ctaLabel  = body.querySelector("#f-hero-cta-label").value.trim();
      content.hero.ctaTarget = body.querySelector("#f-hero-cta-target").value.trim();
      content.about.heading = body.querySelector("#f-about-heading").value.trim();
      content.about.intro   = body.querySelector("#f-about-intro").value.trim();
      content.about.text    = readRichTextField(body, "f-about");
      content.about.image   = readImageField(body, "f-about-image");
      content.servicesSection.heading = body.querySelector("#f-svc-heading").value.trim();
      content.servicesSection.intro   = body.querySelector("#f-svc-intro").value.trim();
      content.newsSection.heading = body.querySelector("#f-news-heading").value.trim();
      content.newsSection.intro   = body.querySelector("#f-news-intro").value.trim();
      content.contactSection.heading        = body.querySelector("#f-cs-heading").value.trim();
      content.contactSection.intro          = body.querySelector("#f-cs-intro").value.trim();
      content.contactSection.successMessage = body.querySelector("#f-cs-success").value.trim();
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
      // Fjern gammal twitter-nøkkel
      delete social.twitter;
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
        ${imgField("p-image", "Bilde (valgfritt)", editing ? editing.image : "",
          { aspect: 220 / 180, label: "Kort (forside)" },
          [{ aspect: 16 / 7, label: "Artikkelside" }])}
        ${feat("attachments") ? `
        <div class="field attach-field" data-attach>
          <label>Vedlegg (valgfritt)</label>
          <ul class="attach-list" data-attach-list></ul>
          <label class="btn btn--ghost attach-add">
            ${C.icon("upload")} Last opp vedlegg
            <input type="file" multiple hidden data-attach-file>
          </label>
          <p class="imgfield__hint">Maks ${_sb ? Media.MAX_FILE_MB_REMOTE : Media.MAX_FILE_MB} MB per fil${_sb ? "" : " i demo (lagres lokalt)"}.</p>
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

  // Matchar ca. den visuelle klippa (.card__text sin CSS max-height/line-clamp
  // i index.html) -- håndhevet her ved lagring, slik at teksten aldri stille
  // forsvinn ved visning uten at noen kan se/rette det (2026-07-12, brukarrapport).
  const SERVICE_CARD_TEXT_MAX = 200;

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
        ${C.richTextField({ id: "s-text", label: "Beskrivelse", value: editing ? editing.text : "", maxChars: SERVICE_CARD_TEXT_MAX })}
        ${imgField("s-image", "Bilde (valgfritt — erstatter ikonet)", editing ? editing.image : "", 16/10)}
        <div class="admin-row__actions">
          ${C.button({ label: editing ? "Oppdater" : "Opprett", type: "submit", variant: "primary" })}
          ${C.button({ label: "Avbryt", variant: "ghost", attrs: 'data-cancel' })}
        </div>
        <p class="form__status" data-svc-status role="status" aria-live="polite"></p>
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
      // Handhevet ved lagring (ikkje berre visuelt klipt ved framvisning, sjå
      // .card__text sin CSS-cap) -- så teksten som faktisk vart skrive inn
      // alltid får plass, i staden for å stille forsvinne på den ferdige sida.
      const plainLen = C.stripHtml(text).length;
      if (plainLen > SERVICE_CARD_TEXT_MAX) {
        setStatus(editor.querySelector("[data-svc-status]"),
          "Beskrivelsen er " + plainLen + " tegn — maks " + SERVICE_CARD_TEXT_MAX + " for at kortet skal holde seg innenfor vanlig størrelse. Kort ned og prøv igjen.", "error");
        return;
      }
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
      const mods = getNavOrderedMods().filter(function (m) { return !m.navHidden; });
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
        <p class="prose prose--muted" style="margin-bottom:.9rem">Styr hvilke seksjoner som vises på forsiden og i hvilken rekkefølge. Side-moduler (Booking, Tilbud, FAQ) er egne sider og kan ikke legges inn her.</p>
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
      const color = diff > 0 ? "#16a34a" : diff < 0 ? "#c0392b" : "var(--color-muted)";
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

    const leads    = getLeads().filter(function (l) { return !isTilbud(l); });
    const quotes   = getLeads().filter(isTilbud);
    const bookings = bookingBookings();

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
    if (hasModule("crm"))       contentCards.push(countCard("Kunder", crmCustomers().length));

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
    const trafficHtml = bits.length ? bits.join("") : `<p class="an-hint">Ingen analyse er satt opp ennå. Vibeverk anbefaler Plausible.io for en enkel, sikker og cookie-free løsning. Ta kontakt med oss, så hjelper vi å sette dette opp.</p>`;

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
    updateLead(id, { status: status });
  }
  function deleteByEmail(email) {
    email = (email || "").trim().toLowerCase();
    if (!email) return 0;
    let count = 0;
    // Leads og tilbod
    const matchingLeads = getLeads().filter(function (l) { return (l.email || "").toLowerCase() === email; });
    matchingLeads.forEach(function (l) { deleteLead(l.id); });
    count += matchingLeads.length;
    // Bookingar (via window.BookingAdmin når modulen er lasta, elles direkte Store)
    if (window.BookingAdmin && window.BookingAdmin.deleteBookingsByEmail) {
      count += window.BookingAdmin.deleteBookingsByEmail(email);
    } else {
      const bk = Store.get("booking-bookings", []) || [];
      const bkAfter = bk.filter(function (b) { return (b.email || "").toLowerCase() !== email; });
      Store.set("booking-bookings", bkAfter);
      count += bk.length - bkAfter.length;
    }
    // CRM-kundar (om modulen er aktiv) — via window.CrmAdmin, sidan crm-customers
    // ikkje lenger er ein store-blob (flytta til crm_customers-tabellen 2026-07-03).
    if (window.CrmAdmin && window.CrmAdmin.deleteCustomersByEmail) {
      count += window.CrmAdmin.deleteCustomersByEmail(email);
    } else {
      const customers = Store.get("crm-customers", []) || [];
      const custAfter = customers.filter(function (c) { return (c.email || "").toLowerCase() !== email; });
      Store.set("crm-customers", custAfter);
      count += customers.length - custAfter.length;
    }
    // Chat-samtalar
    if (window.VwChat && window.VwChat.getConvs && window.VwChat.deleteConv) {
      const chats = window.VwChat.getConvs()
        .filter(function (c) { return (c.email || "").toLowerCase() === email; });
      chats.forEach(function (c) { window.VwChat.deleteConv(c.id); });
      count += chats.length;
    }
    return count;
  }

  function adminLeads(body) {
    const allLeads = getLeads().filter(function (l) {
      return !isTilbud(l);
    });
    const active = getActiveStatuses("kontakt");
    const leads = allLeads.filter(function (l) { return active.indexOf(l.status || "ny") > -1; });
    const counts = { ny: 0, lest: 0, løst: 0 };
    allLeads.forEach(function (l) { counts[l.status || "ny"]++; });

    const VwChat = window.VwChat;
    const rows = leads.length ? leads.map(function (l) {
      const st = l.status || "ny";
      const preview = (l.message || "").split("\n").filter(function (ln) { return ln.trim(); }).slice(0, 1).join("").slice(0, 90);
      const chatConv = (l.source === "chat" && l.chatId && VwChat) ? VwChat.getConv(l.chatId) : null;
      const unread   = chatConv ? (chatConv.unread || 0) : 0;
      const chatLabel = "Svar i chat" + (unread > 0 ? " (" + unread + ")" : (st === "ny" ? " ●" : ""));
      const chatVariant = (unread > 0 || st === "ny") ? "secondary" : "ghost";
      const chatBtn = chatConv
        ? C.button({ label: chatLabel, icon: "message-circle", variant: chatVariant, attrs: 'data-chat-lead="' + C.esc(l.chatId) + '"' })
        : "";
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
            <div style="display:flex;gap:.4rem;flex-wrap:wrap">
              ${C.button({ label: "Svar i e-post", icon: "mail-forward", variant: "primary", attrs: 'data-reply-lead="' + C.esc(l.id) + '"' })}
              ${chatBtn}
              ${getAuthRole() === "member" ? "" : C.button({ label: "Slett", variant: "ghost", attrs: 'data-del-lead="' + C.esc(l.id) + '"' })}
            </div>
            <select class="stat-select" data-status-select="${C.esc(l.id)}">
              ${STATUS_ORDER.map(function (s) { return `<option value="${s}" ${s===st?"selected":""}>${STATUS_LABELS[s]}</option>`; }).join("")}
            </select>
          </div>
        </li>`;
    }).join("") : '<li class="prose prose--muted" style="padding:.5rem 0">Ingen henvendingar med valgt status.</li>';

    body.innerHTML =
      `${emailTemplateCard("kontakt", "E-postmal for svar", DEFAULT_REPLY_TEMPLATE,
        "Brukes av «Svar»-knappen på en henvendelse. Plassholdere fylles inn automatisk når e-posten åpnes: {navn}, {epost}, {dato}, {melding}, {referanse}")}
       ${getAuthRole() === "member" ? "" : '<div style="margin-bottom:1rem">' + C.button({ label: "Eksporter henvendelser (CSV)", icon: "table-export", variant: "ghost", attrs: 'data-export-leads' }) + '</div>'}
       ${statusFilterBar("kontakt", counts)}
       <ul class="admin-list">${rows}</ul>
       <div class="crm-gdpr-box">
         <h4 class="crm-gdpr-title">${C.icon("shield")} Slett alle data for en person</h4>
         <p class="crm-gdpr-desc">Skriv inn e-postadresse for å slette alle henvendelser, tilbud og bookinger knyttet til denne personen (GDPR §17).</p>
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
      if (getAuthRole() === "member") return;
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
            templateOptions: buildTemplateOptions([{ key: "kontakt", label: "Standardmal for kontakt", defaultTemplate: DEFAULT_REPLY_TEMPLATE }]),
            signatureOptions: buildSignatureOptions(),
            vars: { navn: lead.name || "", epost: lead.email || "", dato: formatDateTime(lead.time), melding: cleanMessageText(lead.message), referanse: lead.referenceNumber || "" },
            previewHtml: messageToHtml(lead.message),
            chatId: (lead.source === "chat" && lead.chatId) ? lead.chatId : null
          });
          adminLeads(body);
        }
      });
    });
    body.querySelectorAll("[data-chat-lead]").forEach(function (b) {
      b.addEventListener("click", function () {
        const chatId = b.getAttribute("data-chat-lead");
        if (window.VwChatAdmin && window.VwChatAdmin.openConv) window.VwChatAdmin.openConv(chatId);
        activeTab = "chat-admin";
        activeCategory = "henvendelser";
        const root = document.getElementById("admin-root");
        if (root) renderAdminPanel(root);
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
        if (getAuthRole() === "member") return;
        const id = b.getAttribute("data-del-lead");
        deleteLead(id);
        adminLeads(body);
      });
    });
    body.querySelector("[data-gdpr-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      const email = body.querySelector("#gdpr-email").value.trim();
      const st    = body.querySelector("[data-gdpr-status]");
      if (!confirm("Slett ALL data knyttet til «" + email + "»? Dette kan ikke angres.")) return;
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
  // Tabellar flytta ut av den generiske store-tabellen 2026-07-03/06 (sjå
  // docs/project/CHANGELOG.md/CURRENT_STATE.md) -- desse har ALDRI vore ein
  // del av allStoreKeys()/Store, sidan dei eigande modulane skriv direkte
  // til Supabase når _sb finst og berre fell tilbake til Store når Supabase
  // IKKJE er konfigurert. Sikkerhetskopien fanga difor berre ein krympande
  // delmengd av det faktiske innhaldet på sida -- den bekrefta rotårsaka til
  // at sletta data ikkje kom tilbake ved import (dei var aldri i eksporten).
  // `notes` er MED VILJE UTELATE: notes_own-RLS-policyen
  // (supabase/migrations/20260707000001_baseline_schema.sql) gjev kvar
  // brukar berre tilgang til sine EIGNE notat, ingen admin-unntak -- ein
  // "full sikkerhetskopi" som stille berre fangar den eksporterande admin
  // sine eigne notat (og ingen andre sine) ville vore misvisande. Å leggje
  // til eit admin-unntak i RLS er ei eiga personvernavgjerd, ikkje ein del
  // av denne feilrettinga -- sjå Privacy/Compliance Advisor før det evt.
  // vert bygd.
  const BACKUP_TABLES = [
    "crm_bedrifter", "crm_customers", "crm_comms",
    "leads", "bookings",
    "tasks", "announcements", "kb_articles", "links"
  ];

  // Admin-gjerda RPC (supabase/migrations/20260715140000_export_backup_tables_rpc.sql)
  // -- IKKJE lenger ni separate per-tabell .select("*")-kall. Den gamle
  // tilnærminga stolte berre på at Web-adminen sin "Sikkerhetskopi"-fane var
  // skjult for ikkje-admin-roller i UI-et, men RLS SELECT på desse ni
  // tabellane er ope for alle autentiserte roller (naudsynt for vanleg CRM/
  // oppgåve-blaing) -- så INGENTING i databasen hindra ein innlogga member/
  // editor frå å kalle window.App.buildBackupPayload() sjølv, og få heile
  // datasettet. Funnet av Privacy/Compliance Advisor-gjennomgangen 2026-07-15
  // (sjå CHANGELOG.md). RPC-en handhevar no det same is_admin_or_owner()-
  // gjerdet restore_backup_tables alt hadde, for eksport-sida.
  function fetchAllTables() {
    if (!_sb) {
      const empty = {};
      BACKUP_TABLES.forEach(function (t) { empty[t] = []; });
      return Promise.resolve(empty);
    }
    return _sb.rpc("export_backup_tables").then(function (r) {
      if (r.error) return Promise.reject(new Error("Henting av sikkerhetskopi-data feila: " + r.error.message));
      return r.data || {};
    });
  }

  function exportBackup() {
    return buildBackupPayload().then(function (payload) {
      const stamp = new Date().toISOString().slice(0, 10);
      const slug  = ((CFG.company && CFG.company.name) || "side").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "side";
      downloadBlob("sikkerhetskopi-" + slug + "-" + stamp + ".json", JSON.stringify(payload, null, 2), "application/json");
      return payload;
    });
  }
  function buildBackupPayload() {
    const keys = allStoreKeys();
    const data = {};
    keys.forEach(function (k) { data[k] = Store.get(k, null); });
    return fetchAllTables().then(function (tables) {
      data.tables = tables;
      return {
        vibeverk_backup: true,
        version: 2,
        site: (CFG.company && CFG.company.name) || "",
        exportedAt: new Date().toISOString(),
        data: data
      };
    });
  }

  // Tøm-så-set-inn-att for éin tabell, med FK-reparasjon mot brukarar som
  // ikkje lenger finst. Kastar (avviser Promise-en) viss sjølve tømminga
  // Skriver ALT fra et parset backup-objekt tilbake (full overskriving — fjerner
  // først alt eksisterende under navnerommet, slik at gjenoppretting blir et
  // eksakt speil av kopien, ikke en sammenslåing).
  //
  // Dei ni Supabase-tabellane vert gjenoppretta via restore_backup_tables()
  // (sjå supabase/migrations/20260713104738_restore_backup_tables_rpc.sql) --
  // éin RPC-transaksjon som tøm-og-set-inn-att ALT NI tabellane atomisk,
  // ikkje den tidlegare klient-orkestrerte tøm-så-set-inn-PER-TABELL logikken
  // (restoreTable(), fjerna 2026-07-13). Den logikken var ein reell BLOCKER
  // (ekstern tryggingsgjennomgang, sjå docs/project/CURRENT_STATE.md): ingen
  // transaksjon (ein feila INSERT etter ein vellukka DELETE mista data utan
  // veg tilbake), og FK-kaskadar (crm_bedrifter -> crm_customers ON DELETE
  // SET NULL, crm_customers -> crm_comms ON DELETE CASCADE) gjorde "éin
  // tabell om gongen"-isolasjonen kommentaren hevda illusorisk. Sjølve
  // forfattar-FK-reparasjonen (nullstill created_by/author_id/assigned_to
  // for sletta brukarar, aldri drop rada -- sjå
  // 20260712203346_fix_user_delete_fk_restrict.sql) skjer no inni RPC-en,
  // ikkje her.
  //
  // Gammal-forma sikkerhetskopiar (utan data.tables, frå før 2026-07-12)
  // held fram med å gjenopprette akkurat det dei alltid har gjort (reint
  // Store/localStorage, aldri via RPC-en).
  function restoreBackupData(data) {
    // Skriv Store/localStorage FØRST berre viss det ikkje finst noka RPC-
    // gjenoppretting å vente på -- elles må RPC-en faktisk lukkast FØR Store
    // vert rørt (sjå under). Ein tidlegare versjon skreiv Store uvilkårleg
    // aller først, uansett -- viss RPC-en då feila, var Store/localStorage
    // (og den asynkrone write-through-synken mot Supabase sin store-tabell)
    // alt overskrive, sjølv om feilmeldinga sa "ingen endringar vart gjort".
    // Fanga av Security Auditor 2026-07-13 (HIGH), retta same dag.
    function restoreStore() {
      allStoreKeys().forEach(function (k) { Store.remove(k); });
      Object.keys(data).forEach(function (k) { if (k !== "tables") Store.set(k, data[k]); });
    }

    if (!data.tables || !_sb) {
      restoreStore();
      return Promise.resolve({ legacyBackup: !data.tables, tableResults: [] });
    }

    return _sb.rpc("restore_backup_tables", { p_tables: data.tables }).then(function (r) {
      if (r.error) return Promise.reject(new Error("Gjenoppretting feila: " + r.error.message));
      restoreStore();
      return { legacyBackup: false, tableResults: r.data || [] };
    });
  }
  function importBackup(file, onDone) {
    const reader = new FileReader();
    reader.onerror = function () { onDone(false, "Kunne ikke lese filen."); };
    reader.onload = function () {
      let parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (e) { onDone(false, "Fila kunne ikke leses som JSON — er det en sikkerhetskopi fra denne siden?"); return; }
      if (!parsed || parsed.vibeverk_backup !== true || typeof parsed.data !== "object" || !parsed.data) {
        onDone(false, "Dette ser ikke ut som en gyldig sikkerhetskopi fra denne siden.");
        return;
      }
      // Manifest-validering FØR noko vert sletta: ei avkorta/handmodifisert
      // fil skal avvisast, ikkje stille tømme dei manglande tabellane (same
      // BLOCKER-funn som over — RPC-en validerer det same på nytt server-
      // side, dette er berre ein rask, venleg klient-side sjekk).
      if (parsed.data.tables) {
        if (typeof parsed.data.tables !== "object" || Array.isArray(parsed.data.tables)) {
          onDone(false, "Sikkerhetskopien har et ugyldig «tables»-felt.");
          return;
        }
        const missing = BACKUP_TABLES.filter(function (t) { return !Array.isArray(parsed.data.tables[t]); });
        if (missing.length) {
          onDone(false, "Sikkerhetskopien mangler eller har skadet data for: " + missing.join(", ") + ". Import avbrutt.");
          return;
        }
      }
      restoreBackupData(parsed.data).then(function (result) {
        let msg = "Sikkerhetskopi importert.";
        if (result.legacyBackup) {
          msg += " Denne sikkerhetskopien er fra før tabell-migreringen — CRM/oppgaver/kunnskapsbase/aktuelt/lenker/henvendelser/bookinger er ikke inkludert i den.";
        } else if (result.tableResults.length) {
          const totalRestored = result.tableResults.reduce(function (s, r) { return s + r.restored; }, 0);
          const totalOrphaned = result.tableResults.reduce(function (s, r) { return s + (r.orphaned || 0); }, 0);
          msg += " " + totalRestored + " rader gjenopprettet" +
            (totalOrphaned ? ", " + totalOrphaned + " fikk forfatter fjernet (personen finnes ikke lenger)" : "") + "." +
            " Hvis Workspace er åpen i en annen fane, last den siden på nytt også.";
        }
        onDone(true, msg);
      }).catch(function (e) {
        console.error("[backup] import feila:", e);
        onDone(false, "Import feilet: " + ((e && e.message) || "ukjent feil.") + " Ingen endringer ble gjort (hele gjenopprettingen skjer i én transaksjon, som enten fullføres helt eller ikke i det hele tatt).");
      });
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
    const leads     = getLeads().filter(function (l) { return !isTilbud(l); });
    const quotes    = getLeads().filter(isTilbud);
    const bookings  = bookingBookings();
    const customers = crmCustomers();
    const refs      = Store.get("ref-items",         []) || [];
    const faqs      = Store.get("faq-items",         []) || [];
    const images    = Store.get("mediabank-images",  []) || [];
    const convs     = Store.get("chat:convs",        []) || [];
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
    if (window.VwChat)           rows.push(["Chat-samtaler", convs.length]);
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
        <p class="prose prose--muted" style="margin:0 0 .8rem">Laster ned ALT innhold på denne siden — tekst, bilder, henvendelser, bookinger, kunder (inkl. kommunikasjonshistorikk), oppgaver, kunngjøringer, kunnskapsbase, lenker og innstillinger — som én fil. Bruk denne jevnlig, og alltid før du gjør store endringer.${window.VwChat ? " Merk: chat-samtaler er ikke med i denne fila — bruk «Chat (JSON)» under (dekker kun chat lagret lokalt i denne nettleseren, ikke chat på tvers av enheter)." : ""} Filen inneholder personopplysninger (navn, e-post, telefon, kommunikasjonshistorikk) i ren, ulåst tekst — oppbevar den trygt og slett den når du ikke lenger trenger den.</p>
        <ul class="backup-summary">
          ${rows.map(function (r) { return '<li><span>' + C.esc(r[0]) + '</span><strong>' + r[1] + '</strong></li>'; }).join("")}
        </ul>
        ${C.button({ label: "Last ned sikkerhetskopi", icon: "download", variant: "primary", attrs: 'data-backup-export' })}

        <h4 class="an-heading" style="margin-top:2rem">Eksporter per modul</h4>
        <p class="prose prose--muted" style="margin:0 0 .8rem">Last ned data frå enkeltmodular som JSON eller CSV.</p>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${hasModule("crm")     ? C.button({ label:"Kunder (CSV)",        icon:"table-export", variant:"ghost", attrs:'data-mod-export="crm-csv"'      }) : ""}
          ${hasModule("tilbud")  ? C.button({ label:"Tilbud (JSON)",       icon:"download",     variant:"ghost", attrs:'data-mod-export="quotes-json"'   }) : ""}
          ${hasModule("booking") ? C.button({ label:"Bookinger (JSON)",    icon:"download",     variant:"ghost", attrs:'data-mod-export="bookings-json"' }) : ""}
          ${C.button({ label:"Henvendelser (JSON)", icon:"download", variant:"ghost", attrs:'data-mod-export="leads-json"' })}
          ${window.VwChat        ? C.button({ label:"Chat (JSON)",          icon:"download",     variant:"ghost", attrs:'data-mod-export="chat-json"'      }) : ""}
        </div>

        <h4 class="an-heading" style="margin-top:2rem">Importer sikkerhetskopi</h4>
        <p class="prose prose--muted" style="margin:0 0 .8rem">${C.icon("alert-triangle")} Dette overskriver kunder/henvendelser/bookinger/oppgaver/kunngjøringer/kunnskapsbase/lenker/innstillinger på denne siden med innholdet i fila (chat-samtaler og personlige notater er ikke berørt). Kan ikke angres. Last ned en fersk sikkerhetskopi av nåværende innhold først hvis du er usikker.</p>
        <label class="btn btn--ghost backup-filebtn">
          ${C.icon("upload")} Velg sikkerhetskopi-fil
          <input type="file" accept="application/json" hidden data-backup-import>
        </label>
        <p class="form__status" data-backup-status style="margin-top:.6rem" role="status" aria-live="polite"></p>
      </div>`;

    body.querySelector("[data-backup-export]").addEventListener("click", function (e) {
      const btn = e.currentTarget;
      const st  = body.querySelector("[data-backup-status]");
      btn.disabled = true;
      if (st) { st.textContent = "Henter data …"; st.className = "form__status"; }
      exportBackup()
        .then(function () { if (st) st.textContent = ""; })
        .catch(function (err) {
          console.error("[backup] eksport feila:", err);
          if (st) { st.textContent = "Eksport feilet: " + ((err && err.message) || "ukjent feil."); st.className = "form__status is-error"; }
        })
        .then(function () { btn.disabled = false; });
    });

    body.querySelectorAll("[data-mod-export]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const type = btn.getAttribute("data-mod-export");
        const stamp = new Date().toISOString().slice(0,10);
        if (type === "crm-csv") {
          if (!App.downloadCsv) return;
          App.downloadCsv("kunder-" + stamp + ".csv",
            ["Navn","E-post","Kundenummer","Bedrift","Notat","Opprettet"],
            crmCustomers().map(function(c){
              var bed = crmBedrifter().find(function(b){return b.id===c.bedriftId;});
              return [c.name||"",c.email||"",c.customerNumber||"",bed?bed.name:"",c.note||"",c.created||""];
            })
          );
        } else if (type === "quotes-json") {
          const data = getLeads().filter(isTilbud);
          downloadBlob("tilbud-" + stamp + ".json", JSON.stringify(data, null, 2), "application/json");
        } else if (type === "bookings-json") {
          downloadBlob("bookinger-" + stamp + ".json", JSON.stringify(bookingBookings(), null, 2), "application/json");
        } else if (type === "leads-json") {
          const data = getLeads().filter(function(l){return !isTilbud(l);});
          downloadBlob("henvendelser-" + stamp + ".json", JSON.stringify(data, null, 2), "application/json");
        } else if (type === "chat-json") {
          const chatConvs = Store.get("chat:convs", []) || [];
          const chatMsgs = {};
          chatConvs.forEach(function(c) { chatMsgs[c.id] = Store.get("chat:msgs:" + c.id, []) || []; });
          downloadBlob("chat-" + stamp + ".json", JSON.stringify({ convs: chatConvs, msgs: chatMsgs }, null, 2), "application/json");
        }
      });
    });
    body.querySelector("[data-backup-import]").addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const st = body.querySelector("[data-backup-status]");
      if (!confirm("Dette overskriver ALT eksisterende innhold på denne siden med innholdet i «" + file.name + "» (unntatt chat og personlige notater, se merknad over). Dette gjelder også data du har slettet etter at denne sikkerhetskopien ble tatt — for eksempel kunder eller henvendelser du senere har slettet etter en sletteforespørsel. Dette kan ikke angres. Er du sikker?")) {
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

  function adminMinKonto(body) {
    if (!_sb) { body.innerHTML = '<p style="color:var(--color-muted)">Krev Supabase-tilkopling.</p>'; return; }

    function passStrength(pw) {
      return [
        { key: "len",     label: "Minst 8 teikn",          ok: pw.length >= 8 },
        { key: "upper",   label: "Stor bokstav (A–Z)",      ok: /[A-Z]/.test(pw) },
        { key: "lower",   label: "Liten bokstav (a–z)",     ok: /[a-z]/.test(pw) },
        { key: "num",     label: "Tal (0–9)",                ok: /[0-9]/.test(pw) },
        { key: "special", label: "Spesialtegn (!@#$…)",     ok: /[^A-Za-z0-9]/.test(pw) }
      ];
    }

    body.innerHTML =
      '<div class="bk-wrap">' +
        '<h4 class="an-heading">Endre passord</h4>' +
        '<div style="max-width:380px;display:grid;gap:1rem">' +
          '<div class="field">' +
            '<label for="mk-pass1">Nytt passord</label>' +
            '<input id="mk-pass1" type="password" class="admin-input" placeholder="Minst 8 teikn" autocomplete="new-password" style="font:inherit;padding:.65rem .9rem;border-radius:10px;border:1.5px solid var(--color-border);background:var(--color-bg);color:var(--color-text);width:100%;font-size:.95rem">' +
          '</div>' +
          '<div id="mk-strength" style="display:grid;gap:.3rem;padding:.7rem 1rem;background:var(--color-alt);border-radius:10px;font-size:.82rem"></div>' +
          '<div class="field">' +
            '<label for="mk-pass2">Gjenta passord</label>' +
            '<input id="mk-pass2" type="password" class="admin-input" placeholder="" autocomplete="new-password" style="font:inherit;padding:.65rem .9rem;border-radius:10px;border:1.5px solid var(--color-border);background:var(--color-bg);color:var(--color-text);width:100%;font-size:.95rem">' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:.8rem">' +
            C.button({ label: "Endre passord", variant: "primary", size: "sm", attrs: 'id="mk-save"' }) +
            '<span class="form__status" id="mk-status"></span>' +
          '</div>' +
        '</div>' +
      '</div>';

    function renderStrength(pw) {
      var rules = passStrength(pw);
      body.querySelector("#mk-strength").innerHTML = rules.map(function (r) {
        return '<div style="display:flex;align-items:center;gap:.4rem;color:' + (r.ok ? '#16a34a' : 'var(--color-muted)') + '">' +
          '<i class="ti ti-' + (r.ok ? 'circle-check' : 'circle') + '" style="font-size:.9rem"></i>' +
          r.label + '</div>';
      }).join("");
    }
    renderStrength("");

    body.querySelector("#mk-pass1").addEventListener("input", function () {
      renderStrength(this.value);
    });

    body.querySelector("#mk-save").addEventListener("click", function() {
      const p1   = body.querySelector("#mk-pass1").value;
      const p2   = body.querySelector("#mk-pass2").value;
      const st   = body.querySelector("#mk-status");
      const rules = passStrength(p1);
      const failed = rules.find(function (r) { return !r.ok; });
      if (failed) { st.className = "form__status is-error"; st.textContent = failed.label + " manglar."; return; }
      if (p1 !== p2) { st.className = "form__status is-error"; st.textContent = "Passorda er ikkje like."; return; }
      st.className = "form__status"; st.textContent = "Lagrar…";
      _sb.auth.updateUser({ password: p1 }).then(function(r) {
        if (r.error) { st.className = "form__status is-error"; st.textContent = r.error.message; return; }
        st.className = "form__status is-ok"; st.textContent = "Passord endra.";
        body.querySelector("#mk-pass1").value = "";
        body.querySelector("#mk-pass2").value = "";
        renderStrength("");
        setTimeout(function() { if (st) st.textContent = ""; }, 3000);
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

  // Deler datakjelde med module-crm.js sine CRM-innstillingar (opprettast/
  // redigerast der: Kunder → CRM-innstillingar). Ingen duplikat lagringsnøkkel.
  var CRM_SETTINGS_KEY = "crm-settings";
  function getSharedCrmSettings() { return Store.get(CRM_SETTINGS_KEY, {}) || {}; }
  function getSharedSnippets()    { return getSharedCrmSettings().snippets || []; }

  // Bygg ein kombinert malvelgar-liste: kontekstspesifikke maler (t.d. Kontakt
  // sin eine standardmal, eller Booking sine to: avbook/svar) pluss alle CRM-
  // malar (Kunder → CRM-innstillingar → E-postmaler) — same malvelgar-stil og
  // datakjelde overalt, ingen parallelle løysingar. entries: [{ key, label,
  // defaultTemplate }]. Kontekst-malane sin "subject" er tomt med vilje, slik at
  // dei ikkje overskriv den dynamisk bygde emnelinja når dei blir valgt.
  function buildTemplateOptions(entries) {
    const ctxOpts = (entries || []).map(function (e) {
      const body = getEmailTemplate(e.key, e.defaultTemplate || "");
      return { id: "ctx-" + e.key, name: e.label, subject: "", body: body ? C.esc(body).replace(/\n/g, "<br>") : "" };
    });
    return ctxOpts.concat(getSharedCrmSettings().templates || []);
  }

  // Same delte signaturar (Kunder → CRM-innstillingar → Signaturer) som
  // «Sett inn»-knappane i openReplyModal() sin opts.signatureOptions — no
  // tilgjengeleg for alle e-postdialogar, ikkje berre CRM.
  function buildSignatureOptions() {
    const s = getSharedCrmSettings();
    return { company: s.signatureCompany || "", personal: s.signaturePersonal || "" };
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
    let s = String(v == null ? "" : v);
    // Formel-injeksjon: eit felt som startar med =, +, - eller @ blir tolka som
    // ein formel av Excel/Sheets når CSV-en opnast — prefiks med ' (apostrof)
    // for å tvinge cella til tekst, slik Excel/Sheets sjølv brukar for å unngå dette.
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    s = s.replace(/"/g, '""');
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
  // opts = { name, email, subject, templateKey, defaultTemplate, vars, previewHtml, onSent }
  function openReplyModal(opts) {
    const existing = document.getElementById("reply-modal-root");
    if (existing) existing.remove();

    const tpl      = getEmailTemplate(opts.templateKey, opts.defaultTemplate || DEFAULT_REPLY_TEMPLATE);
    const bodyText = fillTemplate(tpl, opts.vars || {}).slice(0, 1800);
    const mailtoFull  = buildMailtoUrl(opts.email, opts.subject, bodyText);
    const mailtoBlank = buildMailtoUrl(opts.email, opts.subject, "");
    // Styrt av kundens funksjonspakke, ikkje av kor koden køyrer (Web/Workspace skal vera likt).
    const canSendDirect = !!(CFG.features && CFG.features.crm && CFG.features.crmFull && window.App && window.App.supabase);
    const initHtml = bodyText ? C.esc(bodyText).replace(/\n/g, '<br>') : '';

    const root = document.createElement("div");
    root.id = "reply-modal-root";
    // opts.fullscreen: valfri fullskjerm-variant (ROADMAP.md "Custom design-
    // modul (kundeadmin-sida)" -- bygd som eit reint additivt, opt-in steg,
    // ingen eksisterande kallar er endra til å bruke han enno). Same
    // overlegg-mønster som elles, berre utan breidde-/høgde-avgrensinga.
    var replyBoxStyle = opts.fullscreen
      ? "background:var(--color-bg);border-radius:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;overflow-y:auto;box-shadow:none"
      : "background:var(--color-bg);border-radius:var(--radius);width:min(640px,100%);max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)";
    root.innerHTML =
      '<div style="position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;'+(opts.fullscreen?'padding:0':'padding:1rem')+'" data-reply-back>' +
        '<div style="'+replyBoxStyle+'">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.3rem;border-bottom:1px solid var(--color-border);position:sticky;top:0;background:var(--color-bg);z-index:1">' +
            '<strong style="font-size:1rem">Svar til ' + C.esc(opts.name || opts.email) + '</strong>' +
            '<button data-reply-close style="background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);line-height:1">&times;</button>' +
          '</div>' +
          '<div style="padding:.9rem 1.3rem;border-bottom:1px solid var(--color-border)">' +
            '<p style="margin:0;font-size:.88rem"><strong>Til:</strong> &lt;<a href="mailto:' + C.esc(opts.email) + '" style="color:var(--color-primary)">' + C.esc(opts.email) + '</a>&gt;</p>' +
          '</div>' +
          (opts.previewHtml ? '<div style="padding:1rem 1.3rem;border-bottom:1px solid var(--color-border)">' + opts.previewHtml + '</div>' : '') +
          (canSendDirect
            ? '<div style="padding:1rem 1.3rem;display:flex;flex-direction:column;gap:.8rem">' +
                '<div>' +
                  '<label style="font-size:.78rem;font-weight:600;color:var(--color-muted);display:block;margin-bottom:.3rem">Svar-til (kunden svarar tilbake hit)</label>' +
                  '<input id="reply-replyto" type="email" placeholder="hei@vibeverk.no" autocomplete="email" style="font:inherit;font-size:.88rem;padding:.55rem .8rem;border-radius:9px;border:1.5px solid var(--color-border);background:var(--color-bg);color:var(--color-text);width:100%">' +
                '</div>' +
                '<div>' +
                  '<label style="font-size:.78rem;font-weight:600;color:var(--color-muted);display:block;margin-bottom:.3rem">Emne</label>' +
                  '<input id="reply-subject" type="text" value="' + C.esc(opts.subject || "") + '" placeholder="Skriv emne" style="font:inherit;font-size:.88rem;padding:.55rem .8rem;border-radius:9px;border:1.5px solid var(--color-border);background:var(--color-bg);color:var(--color-text);width:100%">' +
                '</div>' +
                (opts.templateOptions && opts.templateOptions.length
                  ? '<div>' +
                      '<label style="font-size:.78rem;font-weight:600;color:var(--color-muted);display:block;margin-bottom:.3rem">Mal</label>' +
                      '<select id="reply-tpl-pick" style="font:inherit;font-size:.88rem;padding:.55rem .8rem;border-radius:9px;border:1.5px solid var(--color-border);background:var(--color-bg);color:var(--color-text);width:100%">' +
                        '<option value="">— Velg mal (valgfritt) —</option>' +
                        opts.templateOptions.map(function (t, i) { return '<option value="' + i + '">' + C.esc(t.name || "Uten navn") + '</option>'; }).join("") +
                      '</select>' +
                    '</div>'
                  : '') +
                '<div>' +
                  '<label style="font-size:.78rem;font-weight:600;color:var(--color-muted);display:block;margin-bottom:.3rem">Melding</label>' +
                  '<div style="border:1.5px solid var(--color-border);border-radius:9px;overflow:hidden">' +
                    '<div id="reply-editor-toolbar" style="display:flex;gap:.15rem;padding:.35rem .5rem;border-bottom:1px solid var(--color-border);background:var(--color-alt);flex-wrap:wrap">' +
                      '<button type="button" data-cmd="bold"                title="Fet"        style="background:none;border:1.5px solid transparent;border-radius:5px;padding:.2rem .5rem;cursor:pointer;font-weight:700;font-size:.85rem;color:var(--color-text)">B</button>' +
                      '<button type="button" data-cmd="italic"              title="Kursiv"     style="background:none;border:1.5px solid transparent;border-radius:5px;padding:.2rem .5rem;cursor:pointer;font-style:italic;font-size:.85rem;color:var(--color-text)">I</button>' +
                      '<button type="button" data-cmd="underline"           title="Understrek" style="background:none;border:1.5px solid transparent;border-radius:5px;padding:.2rem .5rem;cursor:pointer;text-decoration:underline;font-size:.85rem;color:var(--color-text)">U</button>' +
                      '<span style="display:inline-block;width:1px;background:var(--color-border);margin:.1rem .2rem;align-self:stretch"></span>' +
                      '<button type="button" data-cmd="insertUnorderedList" title="Punktliste" style="background:none;border:1.5px solid transparent;border-radius:5px;padding:.2rem .5rem;cursor:pointer;font-size:.88rem;color:var(--color-text)"><i class="ti ti-list"></i></button>' +
                      '<span style="display:inline-block;width:1px;background:var(--color-border);margin:.1rem .2rem;align-self:stretch"></span>' +
                      '<button type="button" id="reply-snippet-btn" title="Sett inn standardtekst (#nøkkelord)" style="background:none;border:1.5px solid transparent;border-radius:5px;padding:.2rem .5rem;cursor:pointer;font-size:.85rem;font-weight:700;color:var(--color-text)">#</button>' +
                    '</div>' +
                    '<div id="reply-direct-body" contenteditable="true" style="position:relative;min-height:180px;max-height:320px;overflow-y:auto;padding:.65rem .85rem;font-size:.87rem;line-height:1.6;outline:none;color:var(--color-text)">' + initHtml + '</div>' +
                  '</div>' +
                  '<p style="font-size:.76rem;color:var(--color-muted);margin:.3rem 0 0">Skriv <strong>#</strong> for å sette inn en lagret standardtekst.</p>' +
                '</div>' +
                (opts.signatureOptions && (opts.signatureOptions.company || opts.signatureOptions.personal)
                  ? '<div style="display:flex;gap:.4rem;flex-wrap:wrap">' +
                      (opts.signatureOptions.company ? C.button({ label: "Sett inn bedriftssignatur", variant: "ghost", attrs: 'type="button" id="reply-sig-company" style="font-size:.78rem"' }) : '') +
                      (opts.signatureOptions.personal ? C.button({ label: "Sett inn personlig signatur", variant: "ghost", attrs: 'type="button" id="reply-sig-personal" style="font-size:.78rem"' }) : '') +
                    '</div>'
                  : '') +
                '<div>' +
                  '<label style="cursor:pointer;font-size:.82rem;color:var(--color-primary);font-weight:600;display:inline-flex;align-items:center;gap:.3rem">' +
                    '<i class="ti ti-paperclip"></i> Legg til vedlegg' +
                    '<input id="reply-attachments" type="file" multiple style="display:none">' +
                  '</label>' +
                  '<div id="reply-attachment-list" style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.35rem"></div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap">' +
                  '<button class="btn btn--primary" id="reply-send-now"><i class="ti ti-send"></i> Send nå</button>' +
                  '<span id="reply-direct-status" style="font-size:.87rem"></span>' +
                  '<div style="margin-left:auto;display:flex;gap:.6rem;align-items:center">' +
                    '<a href="' + mailtoFull + '" style="font-size:.78rem;color:var(--color-muted);text-decoration:none;white-space:nowrap"><i class="ti ti-mail-forward"></i> E-postklient</a>' +
                    (opts.chatId ? ' ' + C.button({ label: "Svar i chat", icon: "message-circle", variant: "secondary", attrs: 'data-goto-chat="' + C.esc(opts.chatId) + '"' }) : "") +
                  '</div>' +
                '</div>' +
              '</div>'
            : '<div style="padding:.9rem 1.3rem;border-bottom:1px solid var(--color-border)">' +
                '<p style="margin:0;font-size:.8rem;color:var(--color-muted)">' + C.icon("info-circle") + ' E-posten åpnes som ren tekst i e-postklienten din.</p>' +
              '</div>' +
              '<div style="padding:1rem 1.3rem;display:flex;gap:.7rem;flex-wrap:wrap;align-items:center">' +
                C.button({ label: "Åpne i Outlook", icon: "mail-forward", variant: "primary", href: mailtoFull }) +
                C.button({ label: "Åpne uten mal", variant: "ghost", href: mailtoBlank }) +
                (opts.chatId ? C.button({ label: "Svar i chat", icon: "message-circle", variant: "secondary", attrs: 'data-goto-chat="' + C.esc(opts.chatId) + '"' }) : "") +
              '</div>'
          ) +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    // Forhåndsutfyll reply-to
    var replyToEl = root.querySelector("#reply-replyto");
    if (replyToEl) replyToEl.value = "hei@vibeverk.no";

    // Tekstformatering — toolbar
    var toolbar = root.querySelector("#reply-editor-toolbar");
    if (toolbar) toolbar.querySelectorAll("[data-cmd]").forEach(function (btn) {
      btn.addEventListener("mousedown", function (e) {
        e.preventDefault();
        document.execCommand(btn.getAttribute("data-cmd"), false, null);
      });
    });

    // Malvelger (valgfritt — kun når opts.templateOptions er gitt).
    var tplPick = root.querySelector("#reply-tpl-pick");
    if (tplPick && opts.templateOptions) {
      tplPick.addEventListener("change", function () {
        if (tplPick.value === "") return;
        var tpl = opts.templateOptions[parseInt(tplPick.value, 10)];
        if (!tpl) return;
        var vars = opts.vars || {};
        var editorEl = root.querySelector("#reply-direct-body");
        if (editorEl) {
          var filledBody = fillTemplate(tpl.body || "", vars);
          // Behald automatisk kundens opphavlege melding: viss den valde malen
          // ikkje sjølv refererer {melding} (dvs. den ferdig-fylte teksten ikkje
          // allereie inneheld kundens melding), legg ho til nedanfor malteksten
          // i staden for å la mal-byttet stille fjerne henne. Presisert av
          // brukar 2026-07-03 — sjå CHANGELOG.
          // Same avsendar-blokk-format som DEFAULT_REPLY_TEMPLATE sin hale
          // (─── / Fra: {navn} <{epost}> / Mottatt: {dato} / ─── / {melding}),
          // slik at ALLE malar viser innsendinga likt — ikkje ei eiga,
          // annleis-formatert linje berre for denne fallback-casen. Presisert
          // av brukar 2026-07-03 etter at fyrste forsøket ikkje matcha stilen
          // på dei andre malane.
          var meldingVar = vars.melding;
          if (meldingVar && filledBody.indexOf(meldingVar) === -1) {
            var quoteBlockText = "─────────────────────────────────────\n" +
              "Fra: " + (vars.navn || "") + " <" + (vars.epost || "") + ">\n" +
              "Mottatt: " + (vars.dato || "") + "\n" +
              "─────────────────────────────────────\n\n" +
              meldingVar;
            filledBody += (filledBody ? "<br><br>" : "") + C.esc(quoteBlockText).replace(/\n/g, "<br>");
          }
          editorEl.innerHTML = C.sanitizeRichHtml(filledBody);
        }
        var subjEl = root.querySelector("#reply-subject");
        if (subjEl && tpl.subject) subjEl.value = fillTemplate(tpl.subject, vars);
      });
    }

    // Signaturinnsetting (valgfritt — kun når opts.signatureOptions er gitt).
    function insertSignature(html) {
      var editorEl = root.querySelector("#reply-direct-body");
      if (!editorEl || !html) return;
      editorEl.focus();
      document.execCommand("insertHTML", false, C.sanitizeRichHtml(html));
    }
    var sigCoBtn = root.querySelector("#reply-sig-company");
    if (sigCoBtn) sigCoBtn.addEventListener("click", function () { insertSignature(opts.signatureOptions.company); });
    var sigPeBtn = root.querySelector("#reply-sig-personal");
    if (sigPeBtn) sigPeBtn.addEventListener("click", function () { insertSignature(opts.signatureOptions.personal); });

    // Snippets/standardtekster (#nøkkelord) — tilgjengelig i ALLE e-postdialogar
    // som går via openReplyModal (Kontakt/Booking/Tilbud/Kunder), ikke bare CRM.
    // Deler datakjelde med CRM sine standardtekster (crm-settings.snippets) og
    // chat sin tilsvarende #-autocomplete i module-chat.js — ingen duplikat
    // datamodell. Innsetting via execCommand("insertText",...) sidan snippet-
    // tekst er ren tekst, ikke HTML — trygt inni ein contenteditable, øydelegg
    // ikke eksisterende formatering rundt.
    (function bindReplySnippets() {
      var editorEl = root.querySelector("#reply-direct-body");
      var snipBtn  = root.querySelector("#reply-snippet-btn");
      if (!editorEl) return;
      var dd = null;

      function closeDd() { if (dd && dd.parentNode) dd.parentNode.removeChild(dd); dd = null; }

      function caretTextBefore() {
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount) return null;
        var range = sel.getRangeAt(0);
        if (!editorEl.contains(range.startContainer)) return null;
        var pre = range.cloneRange();
        pre.selectNodeContents(editorEl);
        pre.setEnd(range.startContainer, range.startOffset);
        return pre.toString();
      }

      function getMatches(forceAll) {
        var snippets = getSharedSnippets();
        if (forceAll) return snippets;
        var before = caretTextBefore();
        if (before == null) return [];
        var hashIdx = before.lastIndexOf("#");
        if (hashIdx === -1) return [];
        var after = before.slice(hashIdx + 1);
        if (/\s/.test(after)) return [];
        var q = after.toLowerCase();
        return snippets.filter(function (s) { return !q || s.shortcode.toLowerCase().indexOf(q) === 0; });
      }

      function positionDd(ddEl) {
        var sel = window.getSelection();
        var rect = null;
        // Same vakt som caretTextBefore(): bruk berre markør-rektangelet når
        // markøren faktisk står inni editoren. Elles (t.d. #-knappen klikka
        // utan at editoren har fokus, med ei att-verande markering ein annan
        // stad på sida) fall trygt tilbake til editoren sitt eige rektangel i
        // staden for å risikere å lese eit ugyldig/utanfor-kontekst Range.
        if (sel && sel.rangeCount && editorEl.contains(sel.getRangeAt(0).startContainer)) {
          var r = sel.getRangeAt(0).cloneRange();
          rect = (r.getClientRects && r.getClientRects()[0]) || r.getBoundingClientRect();
        }
        if (!rect || (!rect.top && !rect.left)) rect = editorEl.getBoundingClientRect();
        ddEl.style.position = "fixed";
        // Klemmer posisjonen innanfor viewporten — utan dette kunne lista
        // rendre delvis/heilt utanfor skjermen på smale mobilskjermar når
        // markøren står nær høgre kant, eller under det synlege området når
        // det virtuelle tastaturet dekker nedre del av skjermen.
        var ddW = ddEl.offsetWidth || 260, ddH = ddEl.offsetHeight || 160;
        var vw = window.innerWidth || document.documentElement.clientWidth;
        var vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || document.documentElement.clientHeight;
        var left = Math.min(Math.round(rect.left), Math.max(4, vw - ddW - 4));
        left = Math.max(4, left);
        var top = Math.round(rect.bottom + 4);
        if (top + ddH > vh - 4) top = Math.max(4, Math.round(rect.top - ddH - 4));
        ddEl.style.left = left + "px";
        ddEl.style.top = top + "px";
      }

      function openDd(matches, isExplicit) {
        closeDd();
        // Ved eksplisitt #-knapp-klikk (isExplicit) med tomme standardtekster:
        // vis ei tydeleg tomtilstand i staden for å ikkje reagere synleg i det
        // heile — ein fyrstegongsbrukar kan elles tru knappen er øydelagd.
        // Ved skriving av "#..." med ingen treff (ikkje eksplisitt) held vi
        // fram med å ikkje vise noko, sidan brukaren kanskje berre skriv ein
        // vanleg #-hashtag/kommentar, ikkje eit forsøk på autocomplete.
        if (!matches.length) {
          if (!isExplicit) return;
          dd = document.createElement("div");
          dd.className = "reply-snippet-dd";
          var empty = document.createElement("div");
          empty.className = "reply-snippet-item";
          empty.style.cursor = "default";
          empty.style.color = "var(--color-muted)";
          empty.textContent = "Ingen standardtekster ennå — legg til i Kunder → CRM-innstillinger.";
          dd.appendChild(empty);
          document.body.appendChild(dd);
          positionDd(dd);
          return;
        }
        dd = document.createElement("div");
        dd.className = "reply-snippet-dd";
        matches.forEach(function (s) {
          var item = document.createElement("div");
          item.className = "reply-snippet-item";
          item.innerHTML = '<span class="reply-snippet-code">#' + C.esc(s.shortcode) + '</span>' + C.esc(s.title);
          item.addEventListener("mousedown", function (e) { e.preventDefault(); insertSnippet(s); });
          dd.appendChild(item);
        });
        document.body.appendChild(dd);
        positionDd(dd);
      }

      function insertSnippet(s) {
        var vars = opts.vars || {};
        var body = fillTemplate(s.body || "", vars);
        var sel = window.getSelection();
        if (sel && sel.rangeCount) {
          var range = sel.getRangeAt(0);
          var before = caretTextBefore();
          var hashIdx = before != null ? before.lastIndexOf("#") : -1;
          if (hashIdx !== -1) {
            var removeLen = before.length - hashIdx;
            var node = range.startContainer, offset = range.startOffset - removeLen;
            if (node.nodeType === 3 && offset >= 0) {
              range.setStart(node, offset);
              range.deleteContents();
            }
          }
        }
        editorEl.focus();
        document.execCommand("insertText", false, body);
        closeDd();
      }

      editorEl.addEventListener("input", function () {
        var m = getMatches(false);
        if (m.length) openDd(m); else closeDd();
      });
      editorEl.addEventListener("blur", function () { setTimeout(closeDd, 160); });
      editorEl.addEventListener("keydown", function (e) {
        if (dd) {
          var items = dd.querySelectorAll(".reply-snippet-item");
          var focused = dd.querySelector(".reply-snippet-item.is-focused");
          var idx = focused ? [].indexOf.call(items, focused) : -1;
          if (e.key === "ArrowDown") { e.preventDefault(); if (focused) focused.classList.remove("is-focused"); var n = items[idx + 1] || items[0]; if (n) n.classList.add("is-focused"); return; }
          if (e.key === "ArrowUp")   { e.preventDefault(); if (focused) focused.classList.remove("is-focused"); var p = items[idx - 1] || items[items.length - 1]; if (p) p.classList.add("is-focused"); return; }
          if (e.key === "Enter" && focused) { e.preventDefault(); var mm = getMatches(false); if (mm[idx]) insertSnippet(mm[idx]); return; }
          if (e.key === "Escape") { closeDd(); return; }
        }
      });
      if (snipBtn) snipBtn.addEventListener("mousedown", function (e) {
        e.preventDefault();
        openDd(getMatches(true), true);
        editorEl.focus();
      });
    })();

    // Vedlegg
    var attachInput = root.querySelector("#reply-attachments");
    var attachList  = root.querySelector("#reply-attachment-list");
    var _attachments = [];
    function renderAttachList() {
      if (!attachList) return;
      attachList.innerHTML = _attachments.map(function (a, i) {
        return '<span style="display:inline-flex;align-items:center;gap:.25rem;background:var(--color-alt);border:1px solid var(--color-border);border-radius:6px;padding:.2rem .5rem;font-size:.78rem">' +
          C.esc(a.filename) +
          ' <button type="button" data-rm="' + i + '" style="background:none;border:0;cursor:pointer;color:var(--color-muted);font-size:1rem;line-height:1;padding:0">&times;</button>' +
          '</span>';
      }).join("");
      attachList.querySelectorAll("[data-rm]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          _attachments.splice(parseInt(btn.getAttribute("data-rm")), 1);
          renderAttachList();
        });
      });
    }
    if (attachInput) attachInput.addEventListener("change", function () {
      var files = Array.from(this.files);
      var pending = files.length;
      if (!pending) return;
      files.forEach(function (file) {
        var reader = new FileReader();
        reader.onload = function (e) {
          _attachments.push({ filename: file.name, content: e.target.result.split(",")[1] });
          if (--pending === 0) renderAttachList();
        };
        reader.readAsDataURL(file);
      });
      this.value = "";
    });

    // Send via Vibeverk
    var sendNowBtn = root.querySelector("#reply-send-now");
    if (sendNowBtn) {
      sendNowBtn.addEventListener("click", async function () {
        var editor  = root.querySelector("#reply-direct-body");
        var html    = editor ? C.sanitizeRichHtml(editor.innerHTML) : "";
        var plain   = editor ? (editor.innerText || editor.textContent || "").trim() : "";
        var replyTo = (root.querySelector("#reply-replyto") || {}).value || "";
        var subject = ((root.querySelector("#reply-subject") || {}).value || "").trim();
        var st      = root.querySelector("#reply-direct-status");
        if (!subject) { st.innerHTML = '<span style="color:#c0392b">Emnefeltet er tomt.</span>'; return; }
        if (!plain) { st.innerHTML = '<span style="color:#c0392b">Meldingen er tom.</span>'; return; }
        sendNowBtn.disabled = true;
        st.innerHTML = '<span style="color:var(--color-muted)">Sender…</span>';
        try {
          var sb = window.App.supabase;
          var session = (await sb.auth.getSession()).data.session;
          if (!session) throw new Error("Ikkje innlogga");
          var fnUrl = (window.SITE_CONFIG && window.SITE_CONFIG.supabase && window.SITE_CONFIG.supabase.url) + "/functions/v1/send-reply";
          var payload = { to_email: opts.email, to_name: opts.name || "", subject: subject, body: plain, html: html, reply_to: replyTo };
          if (_attachments.length) payload.attachments = _attachments;
          var resp = await fetch(fnUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.access_token },
            body: JSON.stringify(payload)
          });
          var result = await resp.json();
          if (result.error) throw new Error(result.error);
          st.innerHTML = '<span style="color:#16a34a"><i class="ti ti-circle-check"></i> E-post sendt!</span>';
          if (opts.onSent) opts.onSent({ subject: subject, plain: plain, html: html, to_email: opts.email, to_name: opts.name || "", resendMessageId: result.message_id || null });
          setTimeout(function () { root.remove(); }, 2000);
        } catch (e) {
          sendNowBtn.disabled = false;
          st.innerHTML = '<span style="color:#c0392b">Feil: ' + C.esc(e.message) + '</span>';
        }
      });
    }

    root.querySelector("[data-reply-close]").addEventListener("click", function () { root.remove(); });
    root.querySelector("[data-reply-back]").addEventListener("click", function (e) { if (e.target === e.currentTarget) root.remove(); });
    document.addEventListener("keydown", function escClose(e) {
      if (e.key === "Escape") { root.remove(); document.removeEventListener("keydown", escClose); }
    });
    const gotoChat = root.querySelector("[data-goto-chat]");
    if (gotoChat) {
      gotoChat.addEventListener("click", function () {
        const chatId = gotoChat.getAttribute("data-goto-chat");
        root.remove();
        if (window.VwChatAdmin && window.VwChatAdmin.openConv) window.VwChatAdmin.openConv(chatId);
        activeTab = "chat-admin";
        activeCategory = "henvendelser";
        const adminRoot = document.getElementById("admin-root");
        if (adminRoot) renderAdminPanel(adminRoot);
      });
    }
  }

  /* ===========================================================================
     9) OPPSTART
     ======================================================================== */
  // Gatekjeper: init() sjølv les CFG (applyTheme, m.m.) og køyrer via
  // DOMContentLoaded, som IKKJE garanterer å skje etter ei framtidig async
  // config-lasting — difor må heile actualInit() gå via App.ready, ikkje
  // berre modulfilene sine eigne feature-flagg-sjekkar. Sjå notatet ved
  // App.ready sin definisjon lenger oppe.
  function init() { ready(actualInit); }

  function actualInit() {
    if (started) return;
    applyTheme();           // tidleg: set --color-primary før chat-bobla initialiserer seg
    registerBuiltinSections();

    function boot() {
      applySuperConfig();

      // productMode-blokkering: berre aktiv når operatøren HAR satt dette via Console.
      // config.js-standarden blokkerer ikkje — kun eksplisitt superconfig-override gjer det.
      var _pm = (Store.get(SUPER_KEY, {}) || {}).productMode;
      if (_pm === "workspace") {
        const appEl = document.getElementById("app");
        if (appEl) appEl.innerHTML =
          '<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
          'font-family:var(--font-body,sans-serif);text-align:center;padding:2rem;background:var(--color-bg,#f1f5f9);color:var(--color-text,#0f172a)">' +
          '<div style="max-width:380px">' +
          '<span class="ti ti-briefcase" style="font-size:3rem;color:var(--color-primary,#2563eb)"></span>' +
          '<h1 style="font-size:1.6rem;margin:.7rem 0 .5rem">Workspace</h1>' +
          '<p style="color:var(--color-muted,#64748b);margin:0 0 1.4rem">Denne løysinga har berre Workspace aktivert. Nettsida er ikkje tilgjengeleg.</p>' +
          '<a href="workspace/" style="display:inline-flex;align-items:center;gap:.4rem;padding:.75rem 1.6rem;' +
          'background:var(--color-primary,#2563eb);color:#fff;border-radius:999px;text-decoration:none;font-weight:600">' +
          'Gå til Workspace <span class="ti ti-arrow-right"></span></a>' +
          '</div></div>';
        started = true;
        return;
      }

      loadContent();
      applyTheme();         // på nytt etter hydration: plukk opp Supabase-lagra fargar/fontar
      initAnalytics();
      currentView = route().view;
      render();
      started = true;
      bindGlobalNav();
      bindHelpIcons();
      window.addEventListener("hashchange", handleRoute);
      handleRoute();
    }

    // Last innhald frå Supabase før første render — sikrar at besøkande
    // utan localStorage (inkognito, ny device) ser riktig innhald.
    if (_sb) {
      hydrateFromSupabase(boot);
    } else {
      boot();
    }
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

  const SUPER_KEY  = "superconfig";

  // Sett saman eit forslag til personvernerklæring basert på kva modular/
  // funksjonar som faktisk er aktive. Brukes som startpunkt ved første oppstart
  // (før noe er lagra). Kan kallast frå Konsollen for å generere eit nytt forslag.
  function computeDefaultPrivacyText() {
    const hasContactForm = !(CFG.features && CFG.features.contactForm === false);
    const hasTilbud  = modules.some(function (m) { return m.id === "tilbud"; });
    const hasBooking = modules.some(function (m) { return m.id === "booking"; });
    const an = Store.get("analytics", null) || (CFG.analytics || {});
    const hasAnalytics = !!(an.plausible || an.plausibleEmbed);

    const collectBits = [];
    if (hasContactForm) collectBits.push("en henvendelse");
    if (hasTilbud)  collectBits.push("ber om tilbud");
    if (hasBooking) collectBits.push("reserverer en booking");
    if (!collectBits.length) collectBits.push("tar kontakt med oss");
    const collectPhrase = collectBits.length > 1
      ? collectBits.slice(0, -1).join(", ") + " eller " + collectBits[collectBits.length - 1]
      : collectBits[0];

    const storedBits = [];
    if (hasContactForm) storedBits.push("henvendelser");
    if (hasTilbud)  storedBits.push("tilbud");
    if (hasBooking) storedBits.push("bookinger");
    if (!storedBits.length) storedBits.push("kontaktopplysninger");
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

  // Bruk lagra super-config ved oppstart
  function applySuperConfig() {
    const sc = getSuperConfig();
    if (sc.company)  Object.assign(CFG.company,  sc.company);
    if (sc.colors)   Object.assign(CFG.colors,   sc.colors);
    if (sc.fonts)    Object.assign(CFG.fonts,     sc.fonts);
    if (sc.features) Object.assign(CFG.features,  sc.features);
    if (sc.privacy)  Object.assign(CFG.privacy,   sc.privacy);
    else             CFG.privacy.text = computeDefaultPrivacyText();   // aldri lagra → modul-bevisst forslag
    if (sc.workspace) { if (!CFG.workspace) CFG.workspace = {}; Object.assign(CFG.workspace, sc.workspace); }
    if (sc.adminPassword) CFG.admin.password = sc.adminPassword;
  }

  function initAnalytics() {
    const a  = Store.get("analytics", null) || (CFG.analytics || {});
    const pl = (a.plausible || "").trim();

    if (pl && !document.getElementById("_pl-script")) {
      const s2 = document.createElement("script");
      s2.id            = "_pl-script";
      s2.src           = "https://plausible.io/js/script.js";
      s2.defer         = true;
      s2.setAttribute("data-domain", pl);
      document.head.appendChild(s2);
    }
  }

  // Standardseksjonene registreres på nøyaktig samme måte som en framtidig
  // modul ville gjort — det er det som gjør arkitekturen utvidbar.
  // Design-modul ("sidebygger", Fase 0, sjå ROADMAP.md) -- kva designmal
  // som faktisk skal rendre kvar innebygd seksjon for DENNE kunden.
  // content.designTemplate er berre eitt felt til i den alt eksisterande
  // content-blob-en (same Store/Supabase-synk som alt anna der), defaultar
  // til "klassisk" (dagens design, uendra) for alle kundar som ikkje
  // eksplisitt har valt noko anna. Fell trygt tilbake til components.js
  // sine eigne forwarder-funksjonar (C.hero/C.about/C.services) dersom
  // window.SiteTemplates av ein eller annan grunn ikkje er lasta i det heile.
  function activeTemplate() { return (content && content.designTemplate) || "klassisk"; }
  function resolveTemplate() {
    var reg = window.SiteTemplates || {};
    return reg[activeTemplate()] || reg.klassisk || C;
  }

  function registerBuiltinSections() {
    registerModule({ id: "hjem",     label: "Hjem",     order: 10,
      render: function () {
        return resolveTemplate().hero(Object.assign({}, CFG.hero, content.hero, { image: Media.resolveImage(content.hero.image) }));
      } });

    registerModule({ id: "om-oss",   label: "Om oss",   order: 20,
      render: function () {
        return resolveTemplate().about(Object.assign({}, CFG.about, {
          heading: content.about.heading, intro: content.about.intro, text: content.about.text, image: Media.resolveImage(content.about.image)
        }));
      } });

    registerModule({ id: "tjenester", label: "Tjenester", order: 30,
      render: function () {
        const cards = content.services.map(function (c) {
          return Object.assign({}, c, { image: Media.resolveImage(c.image) });
        });
        return resolveTemplate().services(Object.assign({}, CFG.services, content.servicesSection, { cards: cards }));
      } });

    registerModule({ id: "aktuelt",  label: "Aktuelt",  order: 40,
      render: function () {
        const all = resolvedPosts();
        const newsCfg = Object.assign({}, CFG.news, content.newsSection);
        if (feat("newsArchive")) {
          const n = CFG.news.frontCount || 3;
          return C.news(newsCfg, all.slice(0, n), { teaser: true, total: all.length, frontCount: n });
        }
        return C.news(newsCfg, all, {});   // ingen arkiv: vis alle i full lengde
      } });

    registerModule({ id: "kontakt",  label: "Kontakt",  order: 50,
      render: function () {
        // extra og sosiale lenker fra redigerbar tilstand (kan slås av med feature-flagg)
        return C.contact(Object.assign({}, CFG.contactSection, content.contactSection), Object.assign({}, content.contact, {
          social: feat("social") ? content.contact.social : null
        }));
      } });
  }

  /* --- Offentlig API -------------------------------------------------------- */
  return {
    init: init,
    ready: ready,                      // ← config-tilgjengelegheit-gate, sjå notatet ved definisjonen
    registerModule: registerModule,   // ← brukes av modulfiler
    // Praktiske kroker for moduler/integrasjoner:
    store: Store,                      // namespacet localStorage (get/set/remove)
    media: Media,                      // bilde-/filhåndtering (put, resolveImage, putFile, ...)
    feature: feat,                     // les feature-flagg
    getContent: function () { return content; },
    getLeads: getLeads,
    refreshLeads: refreshLeadsFromSupabase, // bakgrunns-merge-ved-id-refresh, sjå kommentar ved definisjonen
    addLead: addLead,                  // lagre en henvendelse (lead)
    updateLead: updateLead,            // oppdater felt på eksisterande lead
    deleteLead: deleteLead,            // slett ein lead (t.d. GDPR-sletting)
    isTilbud: isTilbud,                 // skil Tilbud frå Kontakt via kind (fell tilbake til tekst-sniffing for eldre data)
    _test: { dbLeadToJs: dbLeadToJs, jsLeadToDb: jsLeadToDb }, // eksponerer reine JS<->DB-feltmappingsfunksjonar for testing, sjå test.js "leads: feltmapping Supabase<->JS"
    openAdmin: openAdmin,
    setTabBadge: function (tabId, count) { setTabBadge(document.getElementById("admin-root"), tabId, count); },
    // Faktisk innlogga rolle (admin/editor/member) — same kjelde på Web-admin OG
    // Workspace, sidan begge autentiserer mot same Supabase Auth-brukar når
    // Supabase er konfigurert (Web-admin sitt "delte passord" er berre eit
    // fallback for ukonfigurerte/test-miljø, sjå renderAdminLogin()).
    getAuthRole: getAuthRole,
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
    buildTemplateOptions: buildTemplateOptions,   // kombinerer kontekstmalar + CRM-malar for openReplyModal sin malvelgar
    buildSignatureOptions: buildSignatureOptions, // delte signaturar (Kunder → CRM-innstillingar) for openReplyModal sine «Sett inn»-knappar
    computeDefaultPrivacyText: computeDefaultPrivacyText,
    applySuperConfig: applySuperConfig,
    reloadConfig: function () { applySuperConfig(); applyTheme(); render(); },
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
        return '<div class="field attach-field" data-attach>' +
          '<label>Vedlegg (valgfritt)</label>' +
          '<ul class="attach-list" data-attach-list></ul>' +
          '<label class="btn btn--ghost attach-add">' +
            C.icon("upload") + ' Last opp vedlegg' +
            '<input type="file" multiple hidden data-attach-file>' +
          '</label>' +
          '<p class="imgfield__hint">Maks ' + (_sb ? Media.MAX_FILE_MB_REMOTE : Media.MAX_FILE_MB) + ' MB per fil' + (_sb ? "" : " i demo (lagres lokalt)") + '.</p>' +
          '<input type="hidden" id="' + C.esc(id) + '" value="' + C.esc(JSON.stringify(existing || [])) + '">' +
        '</div>';
      },
      bindAttachField:  bindAttachField,            // kobler opp vedleggsfelt
      readAttachments:  readAttachments,            // (scope, id) → []
      bindTerms:        bindTerms,                  // (container, idPrefix) — kobler opp vilkår-popup
      termsAccepted:    termsAccepted,               // (container, idPrefix) → bool
      bindRichTextFields: bindRichTextFields,        // kobler opp verktøylinje for alle rik-tekst-felt i et område
      readRichTextField: readRichTextField,           // (scope, id) → sanert HTML-streng
      textToRichHtml: textToRichHtml,                 // ren tekst (\n\n avsnitt) → trygg HTML, for migrering av gammel plain-text inn i rik-tekst-felt
      bindHelpIcons: bindHelpIcons,                   // C.helpIcon()-klikk-toggle — kall ÉIN gong per side (delegert på document), Web-admin gjer dette sjølv via init()
      hydrateFromSupabase: hydrateFromSupabase        // kall ved innlogging (6b) for cross-device sync
    },
    supabase: _sb                                     // delt Supabase-klient (Workspace brukar same instans)
  };
})();

// Start når DOM er klar (etter at config.js og components.js er lastet)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { window.App.init(); });
} else {
  window.App.init();
}
