/* =============================================================================
   module-tasks.js  —  OPPGÅVER (intranett)  v2
   -----------------------------------------------------------------------------
   Lagring: Supabase tasks-tabell. Fallback til App.store.
   Feltmapping: body → description, assignee (string) → assigned_to (uuid).
   Brukarar hentast frå users-tabellen (erstattar wsp-people).
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App      = window.App;
  var C        = window.Components;
  var CFG      = window.SITE_CONFIG || {};
  if (!Intranet || !App || !C) return;

  var _sb    = App.supabase;
  var STORE_KEY = "wsp-tasks";
  var _tasks = [];
  var _users = [];   // brukarar frå users-tabellen

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function uid() { return Intranet.getContext().userId; }

  // Kun admin kan tildele oppgåver til andre. Hierarki/avdelingsstyrt utviding kjem seinare.
  function canAssignTasks() {
    var ctx = Intranet.getContext();
    return !!ctx && ctx.role === "admin";
  }

  function loadTasks(cb) {
    if (!_sb) {
      _tasks = App.store.get(STORE_KEY, []) || [];
      _users = [];
      cb && cb();
      return;
    }
    var pending = 2;
    function done() { if (--pending === 0) cb && cb(); }

    _sb.from("users").select("id, display_name, role").then(function (r) {
      if (!r.error) _users = r.data || [];
      done();
    });

    _sb.from("tasks").select("*").order("updated_at", { ascending: false }).then(function (r) {
      if (r.error) { done(); return; }
      _tasks = r.data || [];
      if (_tasks.length === 0) {
        var local = App.store.get(STORE_KEY, []) || [];
        if (local.length > 0) {
          migrateLocal(local, done);
          return;
        }
      }
      done();
    });
  }

  function migrateLocal(local, cb) {
    if (!uid()) { cb && cb(); return; }
    var rows = local.map(function (t) {
      return {
        title:       t.title  || "Oppgave",
        description: t.body   || t.description || "",
        status:      t.status || "todo",
        assigned_to: null,
        created_by:  uid()
      };
    });
    _sb.from("tasks").insert(rows).select().then(function (r) {
      if (!r.error) { _tasks = r.data || []; App.store.remove(STORE_KEY); }
      cb && cb();
    });
  }

  function createTask(data, cb) {
    var row = {
      title:       data.title       || "Ny oppgave",
      description: data.body        || "",
      status:      data.status      || "todo",
      assigned_to: data.assigned_to || null,
      created_by:  uid()
    };
    if (!_sb || !uid()) {
      var ls = Object.assign({ id: "wsp-t-" + Date.now(), updated_at: new Date().toISOString(), created_at: new Date().toISOString() }, row);
      _tasks.unshift(ls);
      App.store.set(STORE_KEY, _tasks);
      Intranet.logActivity({ type: "task_created", label: "Ny oppgave: " + row.title });
      cb && cb(ls);
      return;
    }
    _sb.from("tasks").insert(row).select().single().then(function (r) {
      if (!r.error && r.data) {
        _tasks.unshift(r.data);
        Intranet.logActivity({ type: "task_created", label: "Ny oppgave: " + r.data.title });
      }
      cb && cb(r.data);
    });
  }

  function updateTask(id, changes, cb) {
    var row = {};
    if (changes.title       !== undefined) row.title       = changes.title;
    if (changes.body        !== undefined) row.description = changes.body;
    if (changes.description !== undefined) row.description = changes.description;
    if (changes.status      !== undefined) row.status      = changes.status;
    if (changes.assigned_to !== undefined) row.assigned_to = changes.assigned_to;

    var idx = _tasks.findIndex(function (t) { return t.id === id; });
    if (idx >= 0) Object.assign(_tasks[idx], row, { updated_at: new Date().toISOString() });

    if (!_sb) {
      App.store.set(STORE_KEY, _tasks);
      cb && cb();
      return;
    }
    _sb.from("tasks").update(row).eq("id", id).then(function () { cb && cb(); });
  }

  function deleteTask(id, cb) {
    var task = _tasks.find(function (t) { return t.id === id; });
    _tasks = _tasks.filter(function (t) { return t.id !== id; });
    Intranet.logActivity({ type: "task_deleted", label: "Slettet oppgave: " + (task ? task.title : "") });
    if (!_sb) { App.store.set(STORE_KEY, _tasks); cb && cb(); return; }
    _sb.from("tasks").delete().eq("id", id).then(function () { cb && cb(); });
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

  function userDisplayName(userId) {
    if (!userId) return "";
    var u = _users.find(function (u) { return u.id === userId; });
    return u ? (u.display_name || u.id) : userId;
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
      ".task-row{background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;padding:.7rem 1rem;display:flex;align-items:flex-start;gap:.75rem;cursor:pointer}",
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
    root.innerHTML = '<p style="color:var(--color-muted);padding:1rem">Lastar…</p>';
    loadTasks(function () {
      renderList(root);
      if (sub) openTaskModal(sub, root);
    });
  }

  function renderList(root) {
    var me   = uid();
    var ctx  = Intranet.getContext();
    var isAdminRole = ctx && ctx.role === "admin";

    // Mine: tildelt meg, eller opprettet av meg utan tildeling
    function isMine(t) {
      if (t.status === "done") return false;
      return t.assigned_to === me || (t.created_by === me && !t.assigned_to);
    }
    // Tildelt til andre: opprettet av meg, tildelt ein annan
    function isAssignedByMe(t) {
      if (t.status === "done") return false;
      return t.created_by === me && t.assigned_to && t.assigned_to !== me;
    }
    // Andre sine (berre synleg for admin/owner)
    function isOther(t) {
      if (t.status === "done") return false;
      return !isMine(t) && !isAssignedByMe(t);
    }

    var mine        = _tasks.filter(isMine);
    var assignedOut = _tasks.filter(isAssignedByMe);
    var others      = isAdminRole ? _tasks.filter(isOther) : [];
    var done        = _tasks.filter(function (t) { return t.status === "done"; });

    function groupHtml(label, list, id) {
      if (!list.length) return "";
      return '<div class="task-group">' +
        '<p class="i-section-label">' + C.esc(label) +
          ' <span style="font-weight:400;opacity:.6">(' + list.length + ')</span></p>' +
        '<div class="task-group__list" ' + (id ? 'id="' + id + '"' : '') + '>' +
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
            '<div class="task-group__list">' + done.map(taskRow).join("") + '</div>' +
          '</div>' +
        '</div>'
      : "";

    var hasAny = mine.length || assignedOut.length || others.length || done.length;

    root.innerHTML =
      '<div class="i-page-head">' +
        '<h2>Oppgaver</h2>' +
        '<button class="btn btn--primary btn--sm" id="tasks-new-btn"><i class="ti ti-plus"></i> Ny oppgave</button>' +
      '</div>' +
      (hasAny
        ? groupHtml("Mine oppgaver", mine) +
          groupHtml("Tildelt til andre", assignedOut) +
          (isAdminRole && others.length ? groupHtml("Andre sine oppgaver", others) : "") +
          doneHtml
        : '<p style="color:var(--color-muted);font-size:.9rem">Ingen oppgaver ennå.</p>'
      );

    bindList(root);
  }

  function taskRow(t) {
    var assigneeName = userDisplayName(t.assigned_to);
    return '<div class="task-row" data-task-id="' + C.esc(t.id) + '">' +
      '<div class="task-row__main">' +
        '<div class="task-row__title">' + C.esc(t.title) + '</div>' +
        (t.description ? '<div class="task-row__body">' + C.esc(t.description.slice(0, 100)) + '</div>' : '') +
        '<div class="task-row__meta">' +
          formatDate(t.created_at) +
          (assigneeName ? '<span><i class="ti ti-user" style="font-size:.75rem"></i> ' + C.esc(assigneeName) + '</span>' : '') +
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
    var newBtn = root.querySelector("#tasks-new-btn");
    if (newBtn) newBtn.addEventListener("click", function () { openTaskModal(null, root); });

    root.addEventListener("change", function (e) {
      var sel = e.target.closest("[data-task-status-select]");
      if (!sel) return;
      var id     = sel.getAttribute("data-task-status-select");
      var status = sel.value;
      var task   = _tasks.find(function (t) { return t.id === id; });
      if (!task) return;
      updateTask(id, { status: status }, function () {});
      Intranet.logActivity({ type: "task_status", label: task.title + " → " + STATUS_LABELS[status] });
      renderList(root);
    });

    root.addEventListener("click", function (e) {
      var editBtn = e.target.closest("[data-task-edit]");
      if (editBtn) {
        var id = editBtn.getAttribute("data-task-edit");
        openTaskModal(id, root);
        Intranet.navigate("tasks", id);
        return;
      }
      if (e.target.closest("button,select,a")) return;
      var row = e.target.closest("[data-task-id]");
      if (row) {
        var id = row.getAttribute("data-task-id");
        openTaskModal(id, root);
        Intranet.navigate("tasks", id);
      }
    });

    var toggle   = root.querySelector("#task-done-toggle");
    var doneList = root.querySelector("#task-done-list");
    var chevron  = root.querySelector("#task-done-chevron");
    if (toggle && doneList) {
      toggle.addEventListener("click", function () {
        var open = doneList.style.display !== "none";
        doneList.style.display = open ? "none" : "";
        if (chevron) chevron.style.transform = open ? "" : "rotate(90deg)";
      });
    }
  }

  /* =========================================================================
     MODAL
     ====================================================================== */
  function openTaskModal(id, root) {
    var task  = id ? _tasks.find(function (t) { return t.id === id; }) : null;
    var isNew = !task;

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

    // Kun admin kan tildele/endre tildeling. Andre roller ser noverande tildeling read-only.
    var canAssign = canAssignTasks();
    var assigneeField;
    if (!canAssign) {
      var currentAssignee = task && task.assigned_to
        ? _users.find(function (u) { return u.id === task.assigned_to; })
        : null;
      assigneeField = '<input type="text" value="' + C.esc(currentAssignee ? (currentAssignee.display_name || currentAssignee.id) : "— Ingen —") + '" disabled data-readonly-assignee ' +
        'style="font:inherit;font-size:.9rem;padding:.55rem .8rem;border-radius:8px;border:1.5px solid var(--color-border);background:var(--color-alt);color:var(--color-muted);width:100%">';
    } else if (_users.length > 0) {
      assigneeField = '<select id="tm-assignee" style="font:inherit;font-size:.9rem;padding:.55rem .8rem;border-radius:8px;border:1.5px solid var(--color-border);background:var(--color-surface);color:var(--color-text);width:100%">' +
        '<option value="">— Ingen —</option>' +
        _users.map(function (u) {
          return '<option value="' + C.esc(u.id) + '"' + (task && task.assigned_to === u.id ? " selected" : "") + '>' +
            C.esc(u.display_name || u.id) + '</option>';
        }).join("") +
      '</select>';
    } else {
      assigneeField = '<input id="tm-assignee" type="text" value="" placeholder="Ingen brukarar funne" disabled ' +
        'style="font:inherit;font-size:.9rem;padding:.55rem .8rem;border-radius:8px;border:1.5px solid var(--color-border);background:var(--color-surface);color:var(--color-text);width:100%">';
    }

    modal.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.2rem;border-bottom:1px solid var(--color-border)">' +
        '<strong>' + (isNew ? "Ny oppgave" : "Rediger oppgave") + '</strong>' +
        '<button id="tm-close" style="background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);line-height:1">&times;</button>' +
      '</div>' +
      '<div style="padding:1.2rem;display:grid;gap:.9rem">' +
        '<div class="i-field">' +
          '<label for="tm-title">Tittel *</label>' +
          '<input id="tm-title" type="text" value="' + C.esc(task ? task.title : "") + '" placeholder="Hva skal gjøres?" autocomplete="off">' +
        '</div>' +
        '<div class="i-field">' +
          '<label for="tm-body">Beskriving</label>' +
          '<textarea id="tm-body" rows="3" placeholder="Utfyllande info (valgfritt)…" style="resize:vertical">' + C.esc(task ? task.description || "" : "") + '</textarea>' +
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

    function closeModal() { bd.remove(); Intranet.navigate("tasks"); }

    modal.querySelector("#tm-close").addEventListener("click", closeModal);
    modal.querySelector("#tm-cancel").addEventListener("click", closeModal);
    bd.addEventListener("click", function (e) { if (e.target === bd) closeModal(); });
    document.addEventListener("keydown", function escH(e) {
      if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", escH); }
    });

    modal.querySelector("#tm-save").addEventListener("click", function () {
      var title       = modal.querySelector("#tm-title").value.trim();
      var body        = modal.querySelector("#tm-body").value.trim();
      var status      = modal.querySelector("#tm-status").value;
      var assigneeEl  = modal.querySelector("#tm-assignee");
      var assigned_to = canAssign
        ? (assigneeEl && !assigneeEl.disabled ? (assigneeEl.value || null) : null)
        : (task ? task.assigned_to : null);
      var msg         = modal.querySelector("#tm-status-msg");

      if (!title) { msg.textContent = "Tittel er påkrevd."; msg.className = "form__status is-err"; return; }

      msg.textContent = "Lagrar…";
      if (isNew) {
        createTask({ title: title, body: body, status: status, assigned_to: assigned_to }, function () {
          closeModal();
          if (root) renderList(root);
        });
      } else {
        updateTask(id, { title: title, body: body, status: status, assigned_to: assigned_to }, function () {
          Intranet.logActivity({ type: "task_updated", label: "Oppdatert: " + title });
          closeModal();
          if (root) renderList(root);
        });
      }
    });

    var delBtn = modal.querySelector("#tm-delete");
    if (delBtn) {
      delBtn.addEventListener("click", function () {
        if (!confirm('Slett oppgaven "' + (task ? task.title : "") + '"?')) return;
        deleteTask(id, function () {
          closeModal();
          if (root) renderList(root);
        });
      });
    }

    modal.querySelector("#tm-title").focus();
  }

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
