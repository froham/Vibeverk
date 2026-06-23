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
    // Les alltid live frå sessionStorage
    context.role = getRole();
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
                     || "Arbeidsområde";

    root.innerHTML =
      '<aside class="i-sidebar" id="intranet-sidebar">' +
        '<div class="i-sidebar__brand">' +
          '<span class="i-sidebar__name">' + C.esc(tenantName) + '</span>' +
          '<span class="i-sidebar__label">Workspace</span>' +
        '</div>' +
        '<nav class="i-nav" id="intranet-nav"></nav>' +
        '<div class="i-sidebar__footer">' +
          '<div class="i-sidebar__user">' + C.esc(ctx.userId === "local" ? "Lokal bruker" : ctx.userId) + '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between">' +
            '<span style="font-size:.78rem;color:var(--color-muted)">' + C.esc(ctx.role) + '</span>' +
            '<button id="intranet-logout" style="background:none;border:0;cursor:pointer;font-size:.75rem;color:var(--color-muted);padding:.2rem .4rem;border-radius:4px" title="Logg ut">Logg ut</button>' +
          '</div>' +
        '</div>' +
      '</aside>' +
      '<div class="i-sidebar-overlay" id="intranet-overlay"></div>' +
      '<div class="i-body">' +
        '<div class="i-topbar">' +
          '<button class="i-hamburger" id="intranet-hamburger" aria-label="Meny">' +
            '<i class="ti ti-menu-2"></i>' +
          '</button>' +
          '<span class="i-topbar__title" id="intranet-topbar-title">Arbeidsområde</span>' +
        '</div>' +
        '<div id="wsp-ann-banner" style="display:none;background:var(--color-primary);color:#fff;padding:.65rem 1.4rem;align-items:center;gap:.8rem;font-size:.88rem;line-height:1.4;flex-shrink:0"></div>' +
        '<main class="i-main" id="intranet-main"></main>' +
      '</div>';

    renderNav();

    // Hamburgermeny (mobil)
    var sidebar  = document.getElementById("intranet-sidebar");
    var overlay  = document.getElementById("intranet-overlay");
    var hamburger = document.getElementById("intranet-hamburger");

    function openSidebar() {
      if (sidebar)  sidebar.classList.add("is-open");
      if (overlay)  overlay.classList.add("is-open");
    }
    function closeSidebar() {
      if (sidebar)  sidebar.classList.remove("is-open");
      if (overlay)  overlay.classList.remove("is-open");
    }
    if (hamburger) hamburger.addEventListener("click", openSidebar);
    if (overlay)   overlay.addEventListener("click", closeSidebar);

    // Lukk sidebar ved navigasjon på mobil
    document.querySelectorAll(".i-nav__link").forEach(function(a) {
      a.addEventListener("click", function() {
        if (window.innerWidth <= 700) closeSidebar();
      });
    });

    // Logg ut
    var logoutBtn = document.getElementById("intranet-logout");
    if (logoutBtn) logoutBtn.addEventListener("click", function() {
      try { sessionStorage.removeItem(NS + ":intranet-auth"); } catch(e) {}
      started = false;
      context.role = "guest";
      renderLogin();
    });
  }

  var HENVENDELSER_IDS = ["contact", "quote", "booking"];

  function countNewHenvendelser() {
    var leads = App.getLeads ? App.getLeads() : [];
    var contactNew = leads.filter(function (l) {
      return (!l.message || l.message.indexOf("Tilbudsforesp") !== 0) && (l.status || "ny") === "ny";
    }).length;
    var quoteNew = leads.filter(function (l) {
      return l.message && l.message.indexOf("Tilbudsforesp") === 0 && (l.status || "ny") === "ny";
    }).length;
    var bookingNew = (App.store.get("booking-bookings", []) || []).filter(function (b) {
      return (b.status || "ny") === "ny";
    }).length;
    return { contact: contactNew, quote: quoteNew, booking: bookingNew,
             total: contactNew + quoteNew + bookingNew };
  }

  function renderNav() {
    var nav = document.getElementById("intranet-nav");
    if (!nav) return;
    var r = parseRoute();
    var mods = orderedModules().filter(function (m) { return !m.hideFromNav; });
    var counts = countNewHenvendelser();

    // Del moduler i to: hoved-nav og henvendelser
    var mainMods = mods.filter(function (m) { return HENVENDELSER_IDS.indexOf(m.id) === -1; });
    var henvMods = HENVENDELSER_IDS.map(function (id) {
      return mods.find(function (m) { return m.id === id; });
    }).filter(Boolean);

    function navLink(m, badge) {
      var active = m.id === r.id ? " is-active" : "";
      var icon = m.icon ? '<i class="ti ti-' + C.esc(m.icon) + ' i-nav__icon"></i>' : "";
      var badgeHtml = (badge && badge > 0)
        ? '<span style="margin-left:auto;background:var(--color-primary);color:#fff;border-radius:999px;' +
          'font-size:.68rem;font-weight:700;padding:.1rem .42rem;min-width:18px;text-align:center">' + badge + '</span>'
        : "";
      return '<a class="i-nav__link' + active + '" data-inav="' + C.esc(m.id) + '" href="#/' + C.esc(m.id) + '">' +
        icon + '<span style="flex:1">' + C.esc(m.navLabel || m.id) + '</span>' + badgeHtml +
      '</a>';
    }

    var html = mainMods.map(function (m) { return navLink(m, 0); }).join("");

    if (henvMods.length) {
      var totalNew = counts.total;
      html += '<div class="i-nav__section">' +
        '<span class="i-nav__section-label">Henvendelser' +
          (totalNew > 0
            ? ' <span style="background:var(--color-primary);color:#fff;border-radius:999px;' +
              'font-size:.65rem;font-weight:700;padding:.05rem .38rem">' + totalNew + '</span>'
            : '') +
        '</span>' +
        henvMods.map(function (m) { return navLink(m, counts[m.id] || 0); }).join("") +
      '</div>';
    }

    nav.innerHTML = html;
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
    // Re-render viktig-banner etter kvar ruteskifte
    if (typeof window._annRenderBanner === "function") window._annRenderBanner();
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
                 || (CFG.company && CFG.company.name) || "Arbeidsområde";
      brand.textContent = name;
    }
  }

  /* =========================================================================
     10) INIT
     ====================================================================== */
  /* =========================================================================
     INNLOGGING (midlertidig — erstattes av Supabase-auth)
     ====================================================================== */
  function isAuthed() {
    try { return !!sessionStorage.getItem(NS + ":intranet-auth"); } catch(e) { return false; }
  }

  function setAuthed(role) {
    try { sessionStorage.setItem(NS + ":intranet-auth", role); } catch(e) {}
  }

  function renderLogin() {
    var root = document.getElementById("intranet");
    if (!root) return;
    root.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--color-bg);padding:1rem">' +
        '<div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);padding:2rem;width:min(380px,100%);box-shadow:0 8px 32px rgba(0,0,0,.1)">' +
          '<div style="margin-bottom:1.6rem">' +
            '<div style="font-family:var(--font-display);font-weight:700;font-size:1.15rem;margin-bottom:.2rem">' +
              C.esc((CFG.company && CFG.company.name) || "Arbeidsområde") +
            '</div>' +
            '<div style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--color-muted)">Workspace</div>' +
          '</div>' +
          '<div style="display:grid;gap:.8rem" id="login-form">' +
            '<div style="display:grid;gap:.3rem">' +
              '<label for="intranet-pass" style="font-size:.85rem;font-weight:600">Passord</label>' +
              '<input id="intranet-pass" type="password" style="width:100%;font:inherit;padding:.6rem .8rem;border:1.5px solid var(--color-border);border-radius:8px;background:var(--color-bg);color:var(--color-text)" placeholder="Admin-passord" autocomplete="current-password">' +
            '</div>' +
            '<button id="intranet-login-btn" class="btn btn--primary" style="width:100%">Logg inn</button>' +
            '<p id="intranet-login-err" style="font-size:.85rem;color:#c0392b;margin:0;min-height:1.2rem"></p>' +
            (CFG.admin && (CFG.admin.password === "test" || CFG.admin.employeePassword === "gjest")
              ? '<div style="border-top:1px dashed var(--color-border);margin-top:.4rem;padding-top:.8rem;display:grid;gap:.4rem">' +
                  '<p style="font-size:.72rem;color:var(--color-muted);margin:0;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Testinnlogging</p>' +
                  (CFG.admin.password ? '<button class="btn btn--ghost btn--sm" data-test-login="admin" style="width:100%;font-size:.82rem">Logg inn som admin</button>' : '') +
                  (CFG.admin.employeePassword ? '<button class="btn btn--ghost btn--sm" data-test-login="gjest" style="width:100%;font-size:.82rem">Logg inn som gjest</button>' : '') +
                '</div>'
              : '') +
          '</div>' +
        '</div>' +
      '</div>';

    function attempt() {
      var pass = root.querySelector("#intranet-pass").value;
      var err  = root.querySelector("#intranet-login-err");
      var adminPass = CFG.admin && CFG.admin.password;
      var empPass   = CFG.admin && CFG.admin.employeePassword;
      if (pass === adminPass) {
        setAuthed("owner"); init();
      } else if (empPass && pass === empPass) {
        setAuthed("employee"); init();
      } else {
        err.textContent = "Feil passord.";
        root.querySelector("#intranet-pass").value = "";
        root.querySelector("#intranet-pass").focus();
      }
    }

    root.querySelector("#intranet-login-btn").addEventListener("click", attempt);
    root.querySelectorAll("[data-test-login]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var role = btn.getAttribute("data-test-login");
        if (role === "admin") { setAuthed("owner"); init(); }
        else                  { setAuthed("employee"); init(); }
      });
    });
    root.querySelector("#intranet-pass").addEventListener("keydown", function(e) {
      if (e.key === "Enter") attempt();
    });
    setTimeout(function() {
      var inp = root.querySelector("#intranet-pass");
      if (inp) inp.focus();
    }, 50);
  }

  function init() {
    if (started) return;
    // Oppdater context med faktisk rolle (les live)
    context.role = getRole();

    buildShell();
    started = true;
    window.addEventListener("hashchange", handleRoute);
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
