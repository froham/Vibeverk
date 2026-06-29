/* =============================================================================
   hub/hub.js  —  Vibeverk Operator Hub (multi-tenant dashboard)
   ============================================================================= */
(function () {
  "use strict";

  var CFG = window.HUB_CONFIG || { password: "changeme", tenants: [] };
  var NS  = "vw-hub";

  var PLAN_LABELS   = { web: "Web", workspace: "Workspace", full: "Full pakke" };
  var PLAN_COLORS   = { web: "#0ea5e9", workspace: "#8b5cf6", full: "#10b981" };
  var STATUS_LABELS = { active: "Aktiv", pilot: "Pilot", inactive: "Inaktiv" };
  var STATUS_COLORS = { active: "#10b981", pilot: "#f59e0b", inactive: "#64748b" };

  /* ── AUTH ──────────────────────────────────────────────────────────────────── */
  function isAuthed()   { return sessionStorage.getItem(NS + ":auth") === "1"; }
  function setAuthed()  { sessionStorage.setItem(NS + ":auth", "1"); }
  function clearAuth()  { sessionStorage.removeItem(NS + ":auth"); }

  /* ── OVERLAY ── status/notat redigert i UI, lagrast i localStorage ─────────── */
  function getOverlay()    { try { return JSON.parse(localStorage.getItem(NS + ":overlay") || "{}"); } catch(e) { return {}; } }
  function saveOverlay(o)  { localStorage.setItem(NS + ":overlay", JSON.stringify(o)); }

  /* ── LOKALE KUNDAR ── lagt til via UI, ikkje i tenants.js ──────────────────── */
  function getLocalTenants()   { try { return JSON.parse(localStorage.getItem(NS + ":locals") || "[]"); } catch(e) { return []; } }
  function saveLocalTenants(a) { localStorage.setItem(NS + ":locals", JSON.stringify(a)); }

  /* ── HJELPAR ───────────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function $(id) { return document.getElementById(id); }

  function allTenants() {
    var overlay = getOverlay();
    var locals  = getLocalTenants().map(function(t) { return Object.assign({}, t, { _local: true }); });
    return (CFG.tenants || []).concat(locals).map(function(t) {
      return Object.assign({}, t, overlay[t.id] || {});
    });
  }

  /* ── STYLEDFIELD ─────────────────────────────────────────────────────────── */
  var IS = "width:100%;padding:.6rem .85rem;background:#0f172a;border:1.5px solid #334155;border-radius:8px;color:#f8fafc;font:inherit;font-size:.88rem;box-sizing:border-box;outline:none";

  function field(id, label, type, val, opts) {
    var inp;
    if (type === "select") {
      inp = '<select id="' + id + '" style="' + IS + ';cursor:pointer">' +
        (opts || []).map(function(o) {
          var l = STATUS_LABELS[o] || PLAN_LABELS[o] || o;
          return '<option value="' + o + '"' + (o === val ? " selected" : "") + '>' + l + '</option>';
        }).join("") + '</select>';
    } else if (type === "textarea") {
      inp = '<textarea id="' + id + '" rows="3" style="' + IS + ';resize:vertical">' + esc(val) + '</textarea>';
    } else {
      inp = '<input id="' + id + '" type="' + type + '" value="' + esc(val || "") + '" style="' + IS + '">';
    }
    return '<div><label for="' + id + '" style="font-size:.76rem;font-weight:600;color:#94a3b8;display:block;margin-bottom:.35rem">' + esc(label) + '</label>' + inp + '</div>';
  }

  function linkBtn(label, href) {
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener" ' +
      'style="display:inline-flex;align-items:center;padding:.32rem .65rem;border:1.5px solid #334155;border-radius:6px;font-size:.76rem;font-weight:600;color:#94a3b8;text-decoration:none" ' +
      'onmouseover="this.style.borderColor=\'#6366f1\';this.style.color=\'#a5b4fc\'" ' +
      'onmouseout="this.style.borderColor=\'#334155\';this.style.color=\'#94a3b8\'">' + esc(label) + ' ↗</a>';
  }

  /* ── TENANTCARD ─────────────────────────────────────────────────────────── */
  function tenantCard(t) {
    var sc = STATUS_COLORS[t.status] || "#64748b";
    var sl = STATUS_LABELS[t.status] || t.status;
    var pc = PLAN_COLORS[t.plan]     || "#6366f1";
    var pl = PLAN_LABELS[t.plan]     || t.plan;

    var links = [];
    if (t.webUrl)          links.push(linkBtn("Nettside",   t.webUrl + "#admin"));
    if (t.workspaceUrl)    links.push(linkBtn("Workspace",  t.workspaceUrl));
    if (t.consoleUrl)      links.push(linkBtn("Konsoll",    t.consoleUrl));
    if (t.supabaseProject) links.push(linkBtn("Supabase",   "https://supabase.com/dashboard/project/" + t.supabaseProject));

    return '<div style="background:#1e293b;border:1.5px solid ' + (t._local ? "#4f46e5" : "#334155") + ';border-radius:12px;padding:1.2rem;display:flex;flex-direction:column;gap:.8rem">' +
      '<div style="display:flex;align-items:flex-start;gap:.5rem">' +
        '<div style="flex:1">' +
          '<div style="font-size:.98rem;font-weight:700;color:#f8fafc">' + esc(t.name) + '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.3rem">' +
            '<span style="display:inline-flex;align-items:center;gap:.28rem;font-size:.7rem;font-weight:700;color:' + sc + '"><span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>' + esc(sl) + '</span>' +
            '<span style="font-size:.68rem;font-weight:700;padding:.1rem .45rem;border-radius:999px;background:color-mix(in srgb,' + pc + ' 14%,transparent);color:' + pc + '">' + esc(pl) + '</span>' +
            (t._local ? '<span style="font-size:.68rem;font-weight:700;padding:.1rem .45rem;border-radius:999px;background:color-mix(in srgb,#6366f1 14%,transparent);color:#a5b4fc">Lokal</span>' : '') +
          '</div>' +
        '</div>' +
        '<button data-edit="' + esc(t.id) + '" style="background:none;border:1.5px solid #334155;border-radius:6px;padding:.2rem .5rem;font:inherit;font-size:.75rem;color:#64748b;cursor:pointer;flex-shrink:0">✎</button>' +
      '</div>' +
      (t.contact && (t.contact.name || t.contact.email)
        ? '<div style="font-size:.78rem;color:#64748b">' +
            esc(t.contact.name || "") +
            (t.contact.name && t.contact.email ? " · " : "") +
            (t.contact.email ? '<a href="mailto:' + esc(t.contact.email) + '" style="color:#6366f1;text-decoration:none">' + esc(t.contact.email) + '</a>' : "") +
          '</div>'
        : '') +
      (t.since ? '<div style="font-size:.72rem;color:#475569">Sidan ' + esc(t.since) + '</div>' : '') +
      (t.notes ? '<div style="font-size:.76rem;color:#64748b;font-style:italic;line-height:1.4">' + esc(t.notes) + '</div>' : '') +
      (links.length ? '<div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-top:auto">' + links.join("") + '</div>' : '') +
    '</div>';
  }

  /* ── STAT BOX ───────────────────────────────────────────────────────────── */
  function statBox(val, label, color) {
    return '<div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:.9rem 1.2rem;min-width:90px">' +
      '<div style="font-size:1.9rem;font-weight:800;color:' + color + ';line-height:1">' + esc(val) + '</div>' +
      '<div style="font-size:.75rem;color:#64748b;margin-top:.2rem">' + esc(label) + '</div>' +
    '</div>';
  }

  /* ── MODAL ──────────────────────────────────────────────────────────────── */
  function createModal(title, body) {
    var m = document.createElement("div");
    m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:100;padding:1rem";
    m.innerHTML =
      '<div style="background:#1e293b;border:1px solid #334155;border-radius:16px;padding:1.75rem;width:min(500px,100%);max-height:90vh;overflow-y:auto">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">' +
          '<div style="font-size:1rem;font-weight:700;color:#f8fafc">' + title + '</div>' +
          '<button id="m-close" style="background:none;border:0;color:#64748b;font-size:1.4rem;cursor:pointer;line-height:1">&times;</button>' +
        '</div>' +
        '<div style="display:grid;gap:.85rem">' + body + '</div>' +
        '<div style="display:flex;gap:.6rem;margin-top:1.4rem">' +
          '<button id="m-save" style="flex:1;padding:.65rem;background:#6366f1;color:#fff;border:0;border-radius:8px;font:inherit;font-size:.9rem;font-weight:600;cursor:pointer">Lagre</button>' +
          '<button id="m-cancel" style="padding:.65rem 1rem;background:none;border:1.5px solid #334155;color:#94a3b8;border-radius:8px;font:inherit;cursor:pointer">Avbryt</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    function close() { if (m.parentNode) m.remove(); }
    m.addEventListener("click", function(e) { if (e.target === m) close(); });
    $("m-close").addEventListener("click",  close);
    $("m-cancel").addEventListener("click", close);
    return { el: m, close: close };
  }

  /* ── DASHBOARD ─────────────────────────────────────────────────────────── */
  function renderDashboard() {
    var tenants     = allTenants();
    var activeCount = tenants.filter(function(t) { return t.status === "active"; }).length;
    var pilotCount  = tenants.filter(function(t) { return t.status === "pilot";  }).length;
    var hasLocals   = tenants.some(function(t)   { return t._local; });

    $("app").innerHTML =
      '<div style="min-height:100vh;background:#0f172a;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif">' +
      '<header style="position:sticky;top:0;z-index:10;background:#0f172a;border-bottom:1px solid #1e293b;padding:.85rem 1.5rem;display:flex;align-items:center;gap:1rem">' +
        '<div style="flex:1;font-size:1rem;font-weight:800;letter-spacing:-.01em">Vibeverk <span style="color:#6366f1">Hub</span></div>' +
        '<span style="font-size:.75rem;color:#475569">operator</span>' +
        '<button id="h-logout" style="background:none;border:1.5px solid #334155;border-radius:6px;padding:.25rem .65rem;font:inherit;font-size:.76rem;color:#64748b;cursor:pointer">Logg ut</button>' +
      '</header>' +
      '<div style="padding:1.5rem;max-width:1200px;margin:0 auto">' +
        '<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1.75rem">' +
          statBox(String(tenants.length), "Kundar",    "#f8fafc") +
          statBox(String(activeCount),    "Aktive",    "#10b981") +
          statBox(String(pilotCount),     "Pilotkundar", "#f59e0b") +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.6rem">' +
          '<div style="font-size:.8rem;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.07em">Kundeliste</div>' +
          '<button id="h-add" style="display:inline-flex;align-items:center;gap:.4rem;padding:.4rem .85rem;background:#6366f1;color:#fff;border:0;border-radius:8px;font:inherit;font-size:.82rem;font-weight:600;cursor:pointer">+ Ny kunde</button>' +
        '</div>' +
        '<div id="h-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:1rem">' +
          (tenants.length ? tenants.map(tenantCard).join("") : '<p style="color:#475569;grid-column:1/-1">Ingen kundar registrert. Legg til i hub/tenants.js eller trykk «Ny kunde».</p>') +
        '</div>' +
        (hasLocals
          ? '<div style="margin-top:1.5rem;padding:1rem 1.25rem;background:#1e293b;border:1.5px solid #4f46e5;border-radius:10px;font-size:.8rem;color:#94a3b8;line-height:1.6">' +
              '<strong style="color:#a5b4fc">Lokale kundar</strong> er lagra berre i nettlesaren. ' +
              'For å gjere dei permanente, kopier objektet inn i <code style="background:#0f172a;padding:.1rem .35rem;border-radius:4px;color:#a5b4fc">hub/tenants.js</code> og commit.' +
            '</div>'
          : '') +
      '</div></div>';

    $("h-logout").addEventListener("click", function() { clearAuth(); renderLogin(); });
    $("h-add").addEventListener("click",    function() { renderAddModal(); });
    document.querySelectorAll("[data-edit]").forEach(function(btn) {
      var id = btn.getAttribute("data-edit");
      var t  = tenants.find(function(x) { return x.id === id; });
      if (t) btn.addEventListener("click", function() { renderEditModal(t); });
    });
  }

  /* ── REDIGER ─────────────────────────────────────────────────────────────── */
  function renderEditModal(t) {
    var modal = createModal(
      'Rediger: ' + esc(t.name),
      field("ed-status", "Status", "select", t.status || "active", ["active","pilot","inactive"]) +
      field("ed-notes",  "Notat",  "textarea", t.notes || "")
    );
    $("m-save").addEventListener("click", function() {
      var ov = getOverlay();
      ov[t.id] = Object.assign(ov[t.id] || {}, {
        status: $("ed-status").value,
        notes:  $("ed-notes").value.trim()
      });
      saveOverlay(ov);
      if (t._local) {
        var lt = getLocalTenants().map(function(x) {
          return x.id === t.id ? Object.assign({}, x, ov[t.id]) : x;
        });
        saveLocalTenants(lt);
      }
      modal.close();
      renderDashboard();
    });
  }

  /* ── NY KUNDE ────────────────────────────────────────────────────────────── */
  function renderAddModal() {
    var modal = createModal(
      'Legg til ny kunde',
      field("a-name",    "Kundenamn *",          "text",     "") +
      field("a-plan",    "Plan",                  "select",   "full",   ["web","workspace","full"]) +
      field("a-status",  "Status",                "select",   "pilot",  ["active","pilot","inactive"]) +
      field("a-web",     "Nettside-URL",          "url",      "") +
      field("a-ws",      "Workspace-URL",         "url",      "") +
      field("a-console", "Konsoll-URL",           "url",      "") +
      field("a-sb",      "Supabase project-ID",   "text",     "") +
      field("a-contact", "Kontaktperson",         "text",     "") +
      field("a-email",   "Kontakt-e-post",        "email",    "") +
      field("a-since",   "Sidan (YYYY-MM)",       "text",     new Date().toISOString().slice(0,7)) +
      field("a-notes",   "Notat",                 "textarea", "")
    );
    $("m-save").addEventListener("click", function() {
      var name = ($("a-name").value || "").trim();
      if (!name) { $("a-name").style.borderColor = "#ef4444"; $("a-name").focus(); return; }
      var id = name.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,"").replace(/^-+|-+$/g,"") || ("k" + Date.now());
      var lt = getLocalTenants();
      lt.push({
        id:              id,
        name:            name,
        plan:            $("a-plan").value,
        status:          $("a-status").value,
        webUrl:          $("a-web").value.trim()     || null,
        workspaceUrl:    $("a-ws").value.trim()      || null,
        consoleUrl:      $("a-console").value.trim() || null,
        supabaseProject: $("a-sb").value.trim()      || null,
        contact: {
          name:  $("a-contact").value.trim() || null,
          email: $("a-email").value.trim()   || null
        },
        since: $("a-since").value.trim() || null,
        notes: $("a-notes").value.trim() || null
      });
      saveLocalTenants(lt);
      modal.close();
      renderDashboard();
    });
  }

  /* ── LOGIN ──────────────────────────────────────────────────────────────── */
  function renderLogin() {
    $("app").innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;padding:1rem">' +
        '<div style="background:#1e293b;border:1px solid #334155;border-radius:16px;padding:2.5rem;width:min(380px,100%)">' +
          '<div style="margin-bottom:2rem">' +
            '<div style="font-size:1.35rem;font-weight:800;color:#f8fafc;letter-spacing:-.02em">Vibeverk <span style="color:#6366f1">Hub</span></div>' +
            '<div style="font-size:.76rem;color:#475569;margin-top:.25rem;text-transform:uppercase;letter-spacing:.1em">Operator-tilgang</div>' +
          '</div>' +
          '<div style="display:grid;gap:.85rem">' +
            field("h-pass", "Passord", "password", "") +
            '<button id="h-login" style="padding:.7rem;background:#6366f1;color:#fff;border:0;border-radius:8px;font:inherit;font-size:.95rem;font-weight:600;cursor:pointer">Logg inn</button>' +
            '<p id="h-err" style="margin:0;font-size:.82rem;color:#ef4444;min-height:1rem"></p>' +
          '</div>' +
        '</div>' +
      '</div>';

    $("h-pass").addEventListener("keydown", function(e) { if (e.key === "Enter") $("h-login").click(); });
    $("h-login").addEventListener("click", function() {
      if ($("h-pass").value === CFG.password) {
        setAuthed();
        renderDashboard();
      } else {
        $("h-err").textContent = "Feil passord.";
        $("h-pass").focus();
      }
    });
    setTimeout(function() { var i = $("h-pass"); if (i) i.focus(); }, 50);
  }

  /* ── BOOT ───────────────────────────────────────────────────────────────── */
  if (isAuthed()) renderDashboard();
  else            renderLogin();

})();
