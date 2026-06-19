/* =============================================================================
   intranet-core.js  —  INTRANETT-MOTOR (window.Intranet)
   -----------------------------------------------------------------------------
   Eget register, router og shell for intranettet. Gjenbruker primitivene
   App.store, App.media og window.Components fra core.js, men har sin EGNE
   modul-liste, routing og DOM-shell — slik at core.js forblir uendret.

   Alle ruter bruker #/-prefiks (f.eks. #/dashboard, #/tasks/t-001) slik at
   de aldri matcher core.js sin route()-funksjon.

   MØNSTER: Speiler core.js sitt registerModule/orderedModules-mønster.
   ========================================================================== */

window.Intranet = (function () {
  "use strict";

  /* =========================================================================
     1) AVHENGIGHETER
     ====================================================================== */
  var App = window.App;
  var C   = window.Components;
  // App og C må være klare (core.js laster dem). Sikkerhetsnett:
  if (!App || !C) {
    console.error("[Intranet] Mangler App/Components — sørg for at core.js og components.js laster FØR intranet-core.js");
    return {};
  }

  /* =========================================================================
     2) CONTEXT (tenant/bruker — stubbet i local-fasen, riktig form for Supabase)
     ====================================================================== */
  var CFG = window.SITE_CONFIG || {};
  var NS  = CFG.storageKey || "site";

  // Henter sesjon-rolle fra samme nøkkel som core.js bruker.
  // Utvides til Supabase-sesjon uten endring her.
  function getRole() {
    try { return sessionStorage.getItem(NS + ":admin") || "guest"; }
    catch (e) { return "guest"; }
  }

  var context = {
    tenantId: NS,          // i dag = storageKey = én deploy; senere: org-claim i Supabase
    userId:   "local",     // stub; senere: auth.uid()
    role:     getRole()    // "owner" | "employee" | "guest"
  };

  function getContext() {
    context.role = getRole(); // refresh ved kall
    return context;
  }

  /* =========================================================================
     3) MODUL-REGISTER (eget — rører ikke window.App)
     ====================================================================== */
  var modules = [];
  var started = false;

  function registerModule(def) {
    if (!def || !def.id) {
      console.warn("[Intranet] Ugyldig modul ignorert:", def);
      return;
    }
    if (modules.some(function (m) { return m.id === def.id; })) {
      console.warn("[Intranet] Modul finnes allerede:", def.id);
      return;
    }
    def.order = (typeof def.order === "number") ? def.order : 60;
    modules.push(def);
    if (started) renderNav();
  }

  function orderedModules() {
    return modules.slice().sort(function (a, b) { return a.order - b.order; });
  }

  /* =========================================================================
     4) AKTIVITETSSTRØM — deles mellom moduler og Dashboard
     ====================================================================== */
  var ACT_KEY = "wsp-activity";

  function logActivity(entry) {
    // entry: { type, label, ts }
    try {
      var log = App.store.get(ACT_KEY, []) || [];
      log.unshift({ type: entry.type, label: entry.label, ts: entry.ts || Date.now() });
      if (log.length > 50) log = log.slice(0, 50); // maks 50 poster
      App.store.set(ACT_KEY, log);
    } catch (e) {}
  }

  function getActivity() {
    return App.store.get(ACT_KEY, []) || [];
  }

  /* =========================================================================
     5) ROUTER  (#/-prefiks)
     ====================================================================== */
  function parseRoute() {
    var h = (location.hash || "").replace(/^#\//, "");
    if (!h || h === "/") return { id: "dashboard", sub: null };
    var slash = h.indexOf("/");
    if (slash > 0) return { id: h.slice(0, slash), sub: h.slice(slash + 1) };
    return { id: h, sub: null };
  }

  function navigate(id, sub) {
    location.hash = "#/" + id + (sub ? "/" + sub : "");
  }

  var currentRouteKey = null;

  function handleRoute() {
    var r = parseRoute();
    var key = r.id + (r.sub ? "/" + r.sub : "");
    if (key === currentRouteKey) return;
    currentRouteKey = key;
    mountModule(r);
    updateActiveNav(r.id);
    updateTopbar(r);
    if (window.scrollTo) {
      var main = document.getElementById("intranet-main");
      if (main) main.scrollTop = 0;
    }
  }

  /* =========================================================================
     6) SHELL (sidebar + topbar + outlet)
     ====================================================================== */
  function buildShell() {
    var root = document.getElementById("intranet");
    if (!root) return;

    var ctx = getContext();
    var tenantName = App.store.get("wsp-settings", {}).tenantName
                     || CFG.company && CFG.company.name
                     || "Intranett";

    root.innerHTML =
      '<aside class="i-sidebar">' +
        '<div class="i-sidebar__brand">' +
          '<span class="i-sidebar__name">' + C.esc(tenantName) + '</span>' +
          '<span class="i-sidebar__label">Business OS</span>' +
        '</div>' +
        '<nav class="i-nav" id="intranet-nav"></nav>' +
        '<div class="i-sidebar__footer">' +
          '<div class="i-sidebar__user">' + C.esc(ctx.userId === "local" ? "Lokal bruker" : ctx.userId) + '</div>' +
          '<div>' + C.esc(ctx.role) + '</div>' +
        '</div>' +
      '</aside>' +
      '<div class="i-body">' +
        '<div class="i-topbar">' +
          '<span class="i-topbar__title" id="intranet-topbar-title">Intranett</span>' +
        '</div>' +
        '<main class="i-main" id="intranet-main"></main>' +
      '</div>';

    renderNav();
  }

  function renderNav() {
    var nav = document.getElementById("intranet-nav");
    if (!nav) return;
    var r = parseRoute();
    nav.innerHTML = orderedModules().map(function (m) {
      var active = m.id === r.id ? " is-active" : "";
      var icon = m.icon ? '<i class="ti ti-' + C.esc(m.icon) + ' i-nav__icon"></i>' : "";
      return '<a class="i-nav__link' + active + '" data-inav="' + C.esc(m.id) + '" href="#/' + C.esc(m.id) + '">' +
        icon + C.esc(m.navLabel || m.id) +
      '</a>';
    }).join("");
  }

  function updateActiveNav(activeId) {
    document.querySelectorAll(".i-nav__link").forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-inav") === activeId);
    });
  }

  function updateTopbar(r) {
    var title = document.getElementById("intranet-topbar-title");
    if (!title) return;
    var m = modules.find(function (x) { return x.id === r.id; });
    var label = m ? (m.navLabel || m.id) : r.id;
    title.textContent = label;
  }

  /* =========================================================================
     7) MODULE-MOUNT
     ====================================================================== */
  function mountModule(r) {
    var outlet = document.getElementById("intranet-main");
    if (!outlet) return;

    var m = modules.find(function (x) { return x.id === r.id; });
    if (!m) {
      outlet.innerHTML = '<p style="color:var(--color-muted)">Modul ikke funnet: ' + C.esc(r.id) + '</p>';
      return;
    }

    var ctx = getContext();
    outlet.innerHTML = typeof m.render === "function" ? m.render(ctx, r.sub) : "";
    if (typeof m.mount === "function") m.mount(outlet, ctx, r.sub);
  }

  /* =========================================================================
     8) DRAWER-HJELPER (tilgjengelig for alle moduler)
     ====================================================================== */
  function openDrawer(opts) {
    // opts: { title, bodyHtml, onMount(drawerEl) }
    closeDrawer();

    var bd = document.createElement("div");
    bd.className = "i-drawer-backdrop";
    bd.id = "i-drawer-backdrop";
    bd.addEventListener("click", closeDrawer);

    var dr = document.createElement("div");
    dr.className = "i-drawer";
    dr.id = "i-drawer";
    dr.innerHTML =
      '<div class="i-drawer__head">' +
        '<span class="i-drawer__title">' + C.esc(opts.title || "") + '</span>' +
        '<button class="i-drawer__close" id="i-drawer-close" aria-label="Lukk">&times;</button>' +
      '</div>' +
      '<div class="i-drawer__body">' + (opts.bodyHtml || "") + '</div>' +
      (opts.footHtml ? '<div class="i-drawer__foot">' + opts.footHtml + '</div>' : "");

    document.body.appendChild(bd);
    document.body.appendChild(dr);

    document.getElementById("i-drawer-close").addEventListener("click", closeDrawer);
    if (typeof opts.onMount === "function") opts.onMount(dr);
  }

  function closeDrawer() {
    var bd = document.getElementById("i-drawer-backdrop");
    var dr = document.getElementById("i-drawer");
    if (bd) bd.remove();
    if (dr) dr.remove();
  }

  /* =========================================================================
     9) REFRESH-HJELPER (moduler kaller denne etter data-endring for re-render)
     ====================================================================== */
  function refresh() {
    var r = parseRoute();
    currentRouteKey = null; // tving re-mount
    handleRoute();
    // Oppdater sidebar-brand (kan ha endret tenant-navn)
    var brand = document.querySelector(".i-sidebar__name");
    if (brand) {
      var name = App.store.get("wsp-settings", {}).tenantName
                 || (CFG.company && CFG.company.name) || "Intranett";
      brand.textContent = name;
    }
  }

  /* =========================================================================
     10) INIT
     ====================================================================== */
  function init() {
    if (started) return;
    buildShell();
    started = true;
    window.addEventListener("hashchange", handleRoute);
    // Standardrute: #/dashboard hvis ingen hash er satt
    if (!location.hash || location.hash === "#" || location.hash === "#/") {
      location.hash = "#/dashboard";
    } else {
      handleRoute();
    }
  }

  // Start når DOM er klar
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    // core.js sin DOMContentLoaded har allerede kjørt — vi starter direkte
    init();
  }

  /* =========================================================================
     11) OFFENTLIG API
     ====================================================================== */
  return {
    registerModule: registerModule,
    navigate:       navigate,
    openDrawer:     openDrawer,
    closeDrawer:    closeDrawer,
    logActivity:    logActivity,
    getActivity:    getActivity,
    getContext:     getContext,
    refresh:        refresh
  };

})();
