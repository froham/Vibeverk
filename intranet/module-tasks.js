/* =============================================================================
   module-tasks.js  —  OPPGAVER (intranett)
   -----------------------------------------------------------------------------
   Enkel intern oppgavestyring. Ikke prosjektstyring — kun det som trengs for å
   validere context → Store → shell → routing ende til ende.

   Funksjoner:
   - Liste over oppgaver med status (todo / in_progress / done)
   - Opprett ny oppgave
   - Rediger/slett via drawer
   - Statusendring direkte fra listen
   - Aktivitetslogging til wsp-activity (for Dashboard)

   Lagring:  App.store ("wsp-tasks")
   Ruter:    #/tasks, #/tasks/<id>
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  if (!Intranet || !App || !C) return;

  var STORE_KEY = "wsp-tasks";

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getTasks() { return App.store.get(STORE_KEY, []) || []; }
  function setTasks(v) { App.store.set(STORE_KEY, v); }

  function newId() {
    return "wsp-t-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  }

  function createTask(title) {
    var now = Date.now();
    var task = { id: newId(), title: title, status: "todo", createdAt: now, updatedAt: now };
    var list = getTasks();
    list.unshift(task);
    setTasks(list);
    Intranet.logActivity({ type: "task_created", label: "Ny oppgave: " + title });
    return task;
  }

  function updateTask(id, changes) {
    var list = getTasks();
    var idx  = list.findIndex(function (t) { return t.id === id; });
    if (idx < 0) return null;
    Object.assign(list[idx], changes, { updatedAt: Date.now() });
    setTasks(list);
    return list[idx];
  }

  function deleteTask(id) {
    var list  = getTasks();
    var task  = list.find(function (t) { return t.id === id; });
    setTasks(list.filter(function (t) { return t.id !== id; }));
    if (task) Intranet.logActivity({ type: "task_deleted", label: "Slettet oppgave: " + task.title });
  }

  /* =========================================================================
     STATUS-HJELPERE
     ====================================================================== */
  var STATUS_LABELS = { todo: "Å gjøre", in_progress: "Pågår", done: "Ferdig" };
  var STATUS_CYCLE  = { todo: "in_progress", in_progress: "done", done: "todo" };
  var STATUS_BADGE  = { todo: "i-badge--todo", in_progress: "i-badge--progress", done: "i-badge--done" };

  function badgeHtml(status) {
    var cls = STATUS_BADGE[status] || "i-badge--todo";
    var lbl = STATUS_LABELS[status] || status;
    return '<span class="i-badge ' + cls + '">' + C.esc(lbl) + '</span>';
  }

  function formatDate(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
  }

  /* =========================================================================
     RENDER (liste)
     ====================================================================== */
  function render() {
    return '<div id="tasks-root"></div>';
  }

  function mount(outlet, ctx, sub) {
    var root = outlet.querySelector("#tasks-root") || outlet;
    // Sub-rute: #/tasks/<id> åpner drawer direkte
    renderList(root);
    if (sub) openTaskDrawer(sub, root);
  }

  function renderList(root) {
    var tasks = getTasks();

    // Grupper etter status
    var groups = [
      { status: "todo",        tasks: [] },
      { status: "in_progress", tasks: [] },
      { status: "done",        tasks: [] }
    ];
    tasks.forEach(function (t) {
      var g = groups.find(function (g) { return g.status === t.status; });
      if (g) g.tasks.push(t); else groups[0].tasks.push(t);
    });

    var listHtml = groups.map(function (g) {
      if (!g.tasks.length) return "";
      return '<div style="margin-bottom:1.2rem">' +
        '<p class="i-section-label">' + C.esc(STATUS_LABELS[g.status]) +
          ' <span style="font-weight:400;opacity:.6">(' + g.tasks.length + ')</span>' +
        '</p>' +
        '<ul class="admin-list">' +
          g.tasks.map(function (t) { return taskRow(t); }).join("") +
        '</ul>' +
      '</div>';
    }).join("");

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Oppgaver</h2>' +
        '<button class="btn btn--primary btn--sm" id="tasks-new-btn">' +
          '<i class="ti ti-plus"></i> Ny oppgave' +
        '</button>' +
      '</div>' +

      /* Hurtig-opprett form */
      '<form class="i-form" id="tasks-quick-form" style="margin-bottom:1.4rem">' +
        '<div style="display:flex;gap:.6rem;align-items:flex-end">' +
          '<div class="i-field" style="flex:1;margin:0">' +
            '<label for="tasks-quick-input">Legg til oppgave</label>' +
            '<input id="tasks-quick-input" type="text" placeholder="Hva skal gjøres?" autocomplete="off">' +
          '</div>' +
          '<button type="submit" class="btn btn--primary btn--sm" style="margin-bottom:.05rem">Legg til</button>' +
        '</div>' +
        '<p class="form__status" id="tasks-quick-status"></p>' +
      '</form>' +

      (tasks.length ? listHtml : '<p style="color:var(--color-muted);font-size:.9rem">Ingen oppgaver ennå. Legg til en over.</p>');

    bindList(root);
  }

  function taskRow(t) {
    return '<li class="admin-row" data-task-id="' + C.esc(t.id) + '">' +
      '<div class="admin-row__main">' +
        '<strong style="font-size:.92rem">' + C.esc(t.title) + '</strong>' +
        '<span class="admin-row__meta">' + formatDate(t.createdAt) + '</span>' +
      '</div>' +
      '<div class="admin-row__actions">' +
        '<button class="btn btn--ghost btn--sm" data-task-status="' + C.esc(t.id) + '" title="Endre status">' +
          badgeHtml(t.status) +
        '</button>' +
        '<button class="btn btn--ghost btn--sm" data-task-edit="' + C.esc(t.id) + '">' +
          '<i class="ti ti-pencil"></i>' +
        '</button>' +
      '</div>' +
    '</li>';
  }

  function bindList(root) {
    /* Hurtig-opprett */
    root.querySelector("#tasks-quick-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var inp = root.querySelector("#tasks-quick-input");
      var title = inp.value.trim();
      if (!title) return;
      createTask(title);
      inp.value = "";
      renderList(root);
    });

    /* Delegert: endre status */
    root.addEventListener("click", function (e) {
      var statusBtn = e.target.closest("[data-task-status]");
      if (statusBtn) {
        var id = statusBtn.getAttribute("data-task-status");
        var task = getTasks().find(function (t) { return t.id === id; });
        if (!task) return;
        var next = STATUS_CYCLE[task.status] || "todo";
        updateTask(id, { status: next });
        Intranet.logActivity({ type: "task_status", label: task.title + " → " + STATUS_LABELS[next] });
        renderList(root);
        return;
      }

      /* Delegert: åpne popup */
      var editBtn = e.target.closest("[data-task-edit]");
      if (editBtn) {
        var taskId = editBtn.getAttribute("data-task-edit");
        openTaskDrawer(taskId, root);
        Intranet.navigate("tasks", taskId);
      }
    });
  }

  /* =========================================================================
     DRAWER (rediger / slett oppgave)
     ====================================================================== */
  function openTaskDrawer(id, root) {
    var task = getTasks().find(function (t) { return t.id === id; });
    if (!task) return;

    var statusOptions = Object.keys(STATUS_LABELS).map(function (s) {
      return '<option value="' + s + '"' + (task.status === s ? " selected" : "") + '>' +
        STATUS_LABELS[s] + '</option>';
    }).join("");

    // Bruk eigen sentrert popup i staden for sidebar-drawer
    var existing = document.getElementById("task-modal-backdrop");
    if (existing) existing.remove();
    var bd = document.createElement("div");
    bd.id = "task-modal-backdrop";
    bd.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;display:flex;align-items:center;justify-content:center;padding:1rem";
    var modal = document.createElement("div");
    modal.style.cssText = "background:var(--color-bg);border-radius:var(--radius);width:min(480px,100%);box-shadow:0 30px 80px rgba(0,0,0,.3)";
    var _unused = { title: "Oppgave",
      bodyHtml:
        '<div class="i-field">' +
          '<label for="drawer-task-title">Tittel</label>' +
          '<input id="drawer-task-title" type="text" value="' + C.esc(task.title) + '">' +
        '</div>' +
        '<div class="i-field">' +
          '<label for="drawer-task-status">Status</label>' +
          '<select id="drawer-task-status">' + statusOptions + '</select>' +
        '</div>' +
        '<div style="font-size:.8rem;color:var(--color-muted)">' +
          'Opprettet: ' + formatDate(task.createdAt) + '<br>' +
          'Sist oppdatert: ' + formatDate(task.updatedAt) +
        '</div>',
    };
    modal.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.2rem;border-bottom:1px solid var(--color-border)">' +
        '<strong>Oppgave</strong>' +
        '<button id="task-modal-x" style="background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);line-height:1">&times;</button>' +
      '</div>' +
      '<div style="padding:1.2rem;display:grid;gap:.9rem">' +
        _unused.bodyHtml +
        '<div style="display:flex;gap:.5rem;padding-top:.4rem">' +
          '<button class="btn btn--primary btn--sm" id="drawer-save">Lagre</button>' +
          '<button class="btn btn--ghost btn--sm" id="drawer-cancel">Avbryt</button>' +
          '<button class="btn btn--danger btn--sm" id="drawer-delete" style="margin-left:auto">Slett</button>' +
        '</div>' +
      '</div>';
    bd.appendChild(modal);
    document.body.appendChild(bd);
    modal.querySelector("#task-modal-x").addEventListener("click", function () { bd.remove(); });
    bd.addEventListener("click", function (e) { if (e.target === bd) bd.remove(); });
    document.addEventListener("keydown", function escH(e) { if (e.key === "Escape") { bd.remove(); document.removeEventListener("keydown", escH); } });
    (function (dr) {
        dr.querySelector("#drawer-save").addEventListener("click", function () {
          var newTitle  = dr.querySelector("#drawer-task-title").value.trim();
          var newStatus = dr.querySelector("#drawer-task-status").value;
          if (!newTitle) return;
          updateTask(id, { title: newTitle, status: newStatus });
          Intranet.logActivity({ type: "task_updated", label: "Oppdatert: " + newTitle });
          bd.remove();
          Intranet.navigate("tasks");
          if (root) renderList(root);
        });

        dr.querySelector("#drawer-cancel").addEventListener("click", function () {
          bd.remove();
          Intranet.navigate("tasks");
        });

        dr.querySelector("#drawer-delete").addEventListener("click", function () {
          if (!confirm('Slett oppgaven "' + task.title + '"?')) return;
          deleteTask(id);
          bd.remove();
          Intranet.navigate("tasks");
          if (root) renderList(root);
        });
    })(modal);
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  Intranet.registerModule({
    id:       "tasks",
    navLabel: "Oppgaver",
    icon:     "checklist",
    order:    20,
    render:   render,
    mount:    mount
  });

})();
