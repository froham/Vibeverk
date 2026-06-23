/* =============================================================================
   module-tasks.js  —  OPPGAVER (intranett)  v2
   -----------------------------------------------------------------------------
   - Opprett / rediger / slett oppgaver
   - Tittel + beskriving + status + tildelt person
   - Status som nedtrekksmeny direkte i rada
   - Aktive oppgåver (Å gjøre / Pågår) synlege; Ferdige i kollapsbar seksjon
   - Lagring: App.store("wsp-tasks")
   - Ruter: #/tasks, #/tasks/<id>
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

  function createTask(data) {
    var now  = Date.now();
    var task = {
      id:         newId(),
      title:      data.title      || "Ny oppgave",
      body:       data.body       || "",
      status:     data.status     || "todo",
      assignee:   data.assignee   || "",
      createdAt:  now,
      updatedAt:  now
    };
    var list = getTasks();
    list.unshift(task);
    setTasks(list);
    Intranet.logActivity({ type: "task_created", label: "Ny oppgave: " + task.title });
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
    var list = getTasks();
    var task = list.find(function (t) { return t.id === id; });
    setTasks(list.filter(function (t) { return t.id !== id; }));
    if (task) Intranet.logActivity({ type: "task_deleted", label: "Slettet oppgave: " + task.title });
  }

  /* =========================================================================
     HJELPERAR
     ====================================================================== */
  var STATUS_LABELS = { todo: "Å gjøre", in_progress: "Pågår", done: "Ferdig" };
  var STATUS_BADGE  = { todo: "i-badge--todo", in_progress: "i-badge--progress", done: "i-badge--done" };

  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
  }

  function getPeople() {
    var people = App.store.get("wsp-people", []) || [];
    return people.map(function (p) { return p.name || ""; }).filter(Boolean);
  }

  function statusSelect(currentStatus, taskId) {
    return '<select class="task-status-select" data-task-status-select="' + C.esc(taskId) + '" ' +
      'style="font:inherit;font-size:.78rem;font-weight:600;padding:.2rem .5rem;border-radius:999px;' +
      'border:1.5px solid var(--color-border);background:var(--color-surface);color:var(--color-text);cursor:pointer">' +
      Object.keys(STATUS_LABELS).map(function (s) {
        return '<option value="' + s + '"' + (currentStatus === s ? " selected" : "") + '>' +
          STATUS_LABELS[s] + '</option>';
      }).join("") +
    '</select>';
  }

  function injectStyles() {
    if (document.getElementById("tasks-styles")) return;
    var s = document.createElement("style");
    s.id = "tasks-styles";
    s.textContent = [
      ".task-row{background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;padding:.7rem 1rem;display:flex;align-items:flex-start;gap:.75rem}",
      ".task-row__main{flex:1;min-width:0}",
      ".task-row__title{font-weight:600;font-size:.92rem;margin-bottom:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".task-row__body{font-size:.8rem;color:var(--color-muted);margin-bottom:.25rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".task-row__meta{font-size:.75rem;color:var(--color-muted);display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}",
      ".task-row__actions{display:flex;align-items:center;gap:.4rem;flex-shrink:0}",
      ".task-group{margin-bottom:1.2rem}",
      ".task-group__list{display:grid;gap:.5rem}",
      ".task-done-toggle{background:none;border:0;cursor:pointer;font:inherit;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--color-muted);display:flex;align-items:center;gap:.4rem;padding:.3rem 0;margin-bottom:.5rem}",
      ".i-badge--todo{background:color-mix(in srgb,var(--color-text) 10%,transparent);color:var(--color-text)}",
      ".i-badge--progress{background:color-mix(in srgb,#e67e22 15%,transparent);color:#e67e22}",
      ".i-badge--done{background:color-mix(in srgb,#2a7a2a 12%,transparent);color:#2a7a2a}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     RENDER
     ====================================================================== */
  function render() { return '<div id="tasks-root"></div>'; }

  function mount(outlet, ctx, sub) {
    var root = outlet.querySelector("#tasks-root") || outlet;
    injectStyles();
    renderList(root);
    if (sub) openTaskModal(sub, root);
  }

  function renderList(root) {
    var tasks = getTasks();
    var active = tasks.filter(function (t) { return t.status !== "done"; });
    var done   = tasks.filter(function (t) { return t.status === "done"; });

    var todoTasks = active.filter(function (t) { return t.status === "todo"; });
    var inpTasks  = active.filter(function (t) { return t.status === "in_progress"; });

    function groupHtml(label, list) {
      if (!list.length) return "";
      return '<div class="task-group">' +
        '<p class="i-section-label">' + C.esc(label) +
          ' <span style="font-weight:400;opacity:.6">(' + list.length + ')</span></p>' +
        '<div class="task-group__list">' +
          list.map(taskRow).join("") +
        '</div>' +
      '</div>';
    }

    var doneHtml = done.length
      ? '<div class="task-group" id="task-done-group">' +
          '<button class="task-done-toggle" id="task-done-toggle">' +
            '<i class="ti ti-chevron-right" id="task-done-chevron"></i>' +
            'Ferdig <span style="font-weight:400;opacity:.6">(' + done.length + ')</span>' +
          '</button>' +
          '<div id="task-done-list" style="display:none">' +
            '<div class="task-group__list">' +
              done.map(taskRow).join("") +
            '</div>' +
          '</div>' +
        '</div>'
      : "";

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Oppgaver</h2>' +
        '<button class="btn btn--primary btn--sm" id="tasks-new-btn">' +
          '<i class="ti ti-plus"></i> Ny oppgave' +
        '</button>' +
      '</div>' +
      (tasks.length
        ? groupHtml("Å gjøre",  todoTasks) +
          groupHtml("Pågår",    inpTasks)  +
          doneHtml
        : '<p style="color:var(--color-muted);font-size:.9rem">Ingen oppgaver ennå.</p>'
      );

    bindList(root);
  }

  function taskRow(t) {
    return '<div class="task-row" data-task-id="' + C.esc(t.id) + '">' +
      '<div class="task-row__main">' +
        '<div class="task-row__title">' + C.esc(t.title) + '</div>' +
        (t.body ? '<div class="task-row__body">' + C.esc(t.body.slice(0, 100)) + '</div>' : '') +
        '<div class="task-row__meta">' +
          formatDate(t.createdAt) +
          (t.assignee ? '<span><i class="ti ti-user" style="font-size:.75rem"></i> ' + C.esc(t.assignee) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="task-row__actions">' +
        statusSelect(t.status, t.id) +
        '<button class="btn btn--ghost btn--sm" data-task-edit="' + C.esc(t.id) + '" style="padding:.3rem .5rem">' +
          '<i class="ti ti-pencil"></i>' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  function bindList(root) {
    /* Ny oppgave */
    var newBtn = root.querySelector("#tasks-new-btn");
    if (newBtn) newBtn.addEventListener("click", function () { openTaskModal(null, root); });

    /* Status-dropdown direkte i rada */
    root.addEventListener("change", function (e) {
      var sel = e.target.closest("[data-task-status-select]");
      if (!sel) return;
      var id     = sel.getAttribute("data-task-status-select");
      var status = sel.value;
      var task   = getTasks().find(function (t) { return t.id === id; });
      if (!task) return;
      updateTask(id, { status: status });
      Intranet.logActivity({ type: "task_status", label: task.title + " → " + STATUS_LABELS[status] });
      renderList(root);
    });

    /* Rediger-knapp */
    root.addEventListener("click", function (e) {
      var editBtn = e.target.closest("[data-task-edit]");
      if (editBtn) {
        var id = editBtn.getAttribute("data-task-edit");
        openTaskModal(id, root);
        Intranet.navigate("tasks", id);
      }
    });

    /* Kollapsbar ferdig-seksjon */
    var toggle  = root.querySelector("#task-done-toggle");
    var doneList = root.querySelector("#task-done-list");
    var chevron = root.querySelector("#task-done-chevron");
    if (toggle && doneList) {
      toggle.addEventListener("click", function () {
        var open = doneList.style.display !== "none";
        doneList.style.display = open ? "none" : "";
        if (chevron) chevron.style.transform = open ? "" : "rotate(90deg)";
      });
    }
  }

  /* =========================================================================
     MODAL (opprett / rediger)
     ====================================================================== */
  function openTaskModal(id, root) {
    var task     = id ? getTasks().find(function (t) { return t.id === id; }) : null;
    var isNew    = !task;
    var people   = getPeople();

    var existing = document.getElementById("task-modal-bd");
    if (existing) existing.remove();

    var bd = document.createElement("div");
    bd.id = "task-modal-bd";
    bd.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;display:flex;align-items:center;justify-content:center;padding:1rem";

    var modal = document.createElement("div");
    modal.style.cssText = "background:var(--color-bg);border-radius:var(--radius);width:min(500px,100%);box-shadow:0 30px 80px rgba(0,0,0,.3)";

    var statusOpts = Object.keys(STATUS_LABELS).map(function (s) {
      return '<option value="' + s + '"' + ((task ? task.status : "todo") === s ? " selected" : "") + '>' +
        STATUS_LABELS[s] + '</option>';
    }).join("");

    var assigneeField = people.length
      ? '<select id="tm-assignee" style="font:inherit;font-size:.9rem;padding:.55rem .8rem;border-radius:8px;border:1.5px solid var(--color-border);background:var(--color-surface);color:var(--color-text);width:100%">' +
          '<option value="">— Ingen —</option>' +
          people.map(function (p) {
            return '<option value="' + C.esc(p) + '"' + (task && task.assignee === p ? " selected" : "") + '>' + C.esc(p) + '</option>';
          }).join("") +
        '</select>'
      : '<input id="tm-assignee" type="text" value="' + C.esc(task ? task.assignee || "" : "") +
          '" placeholder="Namn på person…" style="font:inherit;font-size:.9rem;padding:.55rem .8rem;border-radius:8px;border:1.5px solid var(--color-border);background:var(--color-surface);color:var(--color-text);width:100%">';

    modal.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.2rem;border-bottom:1px solid var(--color-border)">' +
        '<strong>' + (isNew ? "Ny oppgave" : "Rediger oppgave") + '</strong>' +
        '<button id="tm-close" style="background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);line-height:1">&times;</button>' +
      '</div>' +
      '<div style="padding:1.2rem;display:grid;gap:.9rem">' +
        '<div class="i-field">' +
          '<label for="tm-title">Tittel *</label>' +
          '<input id="tm-title" type="text" value="' + C.esc(task ? task.title : "") + '" placeholder="Kva skal gjerast?" autocomplete="off">' +
        '</div>' +
        '<div class="i-field">' +
          '<label for="tm-body">Beskriving</label>' +
          '<textarea id="tm-body" rows="3" placeholder="Utfyllande info (valgfritt)…" style="resize:vertical">' + C.esc(task ? task.body || "" : "") + '</textarea>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">' +
          '<div class="i-field">' +
            '<label for="tm-status">Status</label>' +
            '<select id="tm-status">' + statusOpts + '</select>' +
          '</div>' +
          '<div class="i-field">' +
            '<label for="tm-assignee">Tildelt</label>' +
            assigneeField +
          '</div>' +
        '</div>' +
        '<p class="form__status" id="tm-status-msg"></p>' +
        '<div style="display:flex;gap:.5rem;padding-top:.2rem">' +
          '<button class="btn btn--primary btn--sm" id="tm-save">Lagre</button>' +
          '<button class="btn btn--ghost btn--sm" id="tm-cancel">Avbryt</button>' +
          (!isNew ? '<button class="btn btn--ghost btn--sm" id="tm-delete" style="margin-left:auto;color:#c0392b;border-color:#c0392b">Slett</button>' : '') +
        '</div>' +
      '</div>';

    bd.appendChild(modal);
    document.body.appendChild(bd);

    function closeModal() {
      bd.remove();
      Intranet.navigate("tasks");
    }

    modal.querySelector("#tm-close").addEventListener("click", closeModal);
    modal.querySelector("#tm-cancel").addEventListener("click", closeModal);
    bd.addEventListener("click", function (e) { if (e.target === bd) closeModal(); });
    document.addEventListener("keydown", function escH(e) {
      if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", escH); }
    });

    modal.querySelector("#tm-save").addEventListener("click", function () {
      var title    = modal.querySelector("#tm-title").value.trim();
      var body     = modal.querySelector("#tm-body").value.trim();
      var status   = modal.querySelector("#tm-status").value;
      var assignee = modal.querySelector("#tm-assignee").value.trim();
      var msg      = modal.querySelector("#tm-status-msg");

      if (!title) {
        msg.textContent = "Tittel er påkrevd.";
        msg.className   = "form__status is-err";
        return;
      }

      if (isNew) {
        createTask({ title: title, body: body, status: status, assignee: assignee });
      } else {
        updateTask(id, { title: title, body: body, status: status, assignee: assignee });
        Intranet.logActivity({ type: "task_updated", label: "Oppdatert: " + title });
      }

      closeModal();
      if (root) renderList(root);
    });

    var delBtn = modal.querySelector("#tm-delete");
    if (delBtn) {
      delBtn.addEventListener("click", function () {
        if (!confirm('Slett oppgaven "' + (task ? task.title : "") + '"?')) return;
        deleteTask(id);
        closeModal();
        if (root) renderList(root);
      });
    }

    modal.querySelector("#tm-title").focus();
  }

  /* Eksporter openTaskModal så Dashboard kan kalle den direkte */
  window._tasksOpenModal = function (root) {
    openTaskModal(null, root || document.getElementById("intranet-main"));
  };

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
