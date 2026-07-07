/* =============================================================================
   intranet/module-users.js  —  Brukarstyring (berre admin)
   Viser liste over alle brukarar, let admin invitere, byte rolle og fjerne.
   Krev Supabase + manage-user Edge Function.
============================================================================= */
(function () {
  "use strict";
  if (!window.Intranet) return;

  var C = window.Components;
  var ROLE_LABELS = { admin: "Admin", editor: "Redaktør", member: "Medlem" };

  function getSb() { return window.App && window.App.supabase; }

  function callManageUser(action, payload) {
    var CFG = window.SITE_CONFIG || {};
    var url = (CFG.supabase && CFG.supabase.url) || "";
    if (!url) return Promise.reject(new Error("Ingen Supabase-URL"));
    return getSb().auth.getSession().then(function (r) {
      var token = r.data && r.data.session && r.data.session.access_token;
      if (!token) throw new Error("Ikkje innlogga");
      return fetch(url + "/functions/v1/manage-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify(Object.assign({ action: action }, payload))
      }).then(function (res) { return res.json(); });
    });
  }

  function setStatus(statusEl, msg, type) {
    statusEl.textContent = msg;
    statusEl.style.color = type === "error" ? "#c0392b"
                         : type === "ok"    ? "#16a34a"
                         : "var(--color-muted)";
  }

  Intranet.registerModule({
    id:       "users",
    navLabel: "Brukere",
    icon:     "users",
    roles:    ["admin"],

    mount: function (el, ctx) {
      el.innerHTML = '<div id="users-root"></div>';
      var root = document.getElementById("users-root");
      var sb = getSb();
      if (!sb) {
        root.innerHTML = '<p style="color:var(--color-muted);padding:1rem 0">Brukarstyring krev Supabase-tilkopling.</p>';
        return;
      }
      loadAndRender(root, ctx, sb);
    }
  });

  function loadAndRender(root, ctx, sb) {
    root.innerHTML = '<p style="color:var(--color-muted);padding:.5rem 0">Laster brukarar…</p>';
    sb.from("users")
      .select("id, display_name, email, role, created_at")
      .order("created_at")
      .then(function (r) {
        if (r.error) {
          root.innerHTML = '<p style="color:#c0392b">Kunne ikkje laste brukarar: ' + C.esc(r.error.message) + '</p>';
          return;
        }
        render(root, ctx, sb, r.data || []);
      });
  }

  function render(root, ctx, sb, users) {
    var roleOpts = Object.keys(ROLE_LABELS).map(function (r) {
      return '<option value="' + r + '">' + ROLE_LABELS[r] + '</option>';
    }).join("");

    var inviteHtml =
      '<div class="i-card" style="margin-bottom:1.2rem">' +
        '<p class="i-section-label">Inviter ny brukar</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:.6rem">' +
          '<div class="i-field"><label>E-post</label>' +
            '<input id="u-email" type="email" placeholder="brukar@firma.no"></div>' +
          '<div class="i-field"><label>Namn (valfritt)</label>' +
            '<input id="u-name" type="text" placeholder="Ola Nordmann"></div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">' +
          '<div class="i-field" style="flex-shrink:0"><label>Rolle</label>' +
            '<select id="u-role">' + roleOpts + '</select></div>' +
          '<button id="u-invite-btn" class="btn btn--primary btn--sm" style="align-self:flex-end">Send invitasjon</button>' +
          '<span id="u-invite-status" style="font-size:.85rem;color:var(--color-muted)"></span>' +
        '</div>' +
      '</div>';

    var listHtml =
      '<div class="i-card">' +
        '<p class="i-section-label">Brukarar (' + users.length + '/50)</p>' +
        '<ul class="admin-list">' +
          users.map(function (u) {
            var isSelf = u.id === ctx.userId;
            var roleSelectOpts = Object.keys(ROLE_LABELS).map(function (r) {
              return '<option value="' + r + '"' + (u.role === r ? " selected" : "") + '>' + ROLE_LABELS[r] + '</option>';
            }).join("");
            return '<li class="admin-row">' +
              '<div class="admin-row__main">' +
                '<div style="font-weight:600">' + C.esc(u.display_name || u.email || "Ukjend") + '</div>' +
                '<div class="admin-row__meta">' + C.esc(u.email || "") + '</div>' +
              '</div>' +
              '<div class="admin-row__actions">' +
                (isSelf
                  ? '<span style="font-size:.8rem;padding:.3rem .7rem;border-radius:999px;' +
                    'background:var(--color-tint);color:var(--color-primary);font-weight:600">' +
                    (ROLE_LABELS[u.role] || u.role) + ' (deg)</span>'
                  : '<div class="i-field" style="margin:0"><select class="u-role-sel" data-uid="' + C.esc(u.id) + '">' +
                    roleSelectOpts + '</select></div>' +
                    '<button class="btn btn--danger btn--sm u-remove-btn" ' +
                    'data-uid="' + C.esc(u.id) + '" ' +
                    'data-name="' + C.esc(u.display_name || u.email || "Ukjend") + '">' +
                    'Fjern</button>') +
              '</div>' +
            '</li>';
          }).join("") +
        '</ul>' +
      '</div>';

    root.innerHTML = inviteHtml + listHtml;

    var statusEl = document.getElementById("u-invite-status");

    // Invitasjon
    document.getElementById("u-invite-btn").addEventListener("click", function () {
      var email = (document.getElementById("u-email").value || "").trim();
      var name  = (document.getElementById("u-name").value  || "").trim();
      var role  = document.getElementById("u-role").value;
      if (!email) { setStatus(statusEl, "E-post er påkrevd.", "error"); return; }
      setStatus(statusEl, "Sender…", "");
      var redirectTo = window.location.href.split("#")[0].replace(/\/$/, "") + "/";
      callManageUser("invite", { email: email, display_name: name, role: role, redirect_to: redirectTo })
        .then(function (res) {
          if (res.error) { setStatus(statusEl, res.error, "error"); return; }
          setStatus(statusEl, "Invitasjon sendt til " + email + "!", "ok");
          document.getElementById("u-email").value = "";
          document.getElementById("u-name").value  = "";
          setTimeout(function () { loadAndRender(root, ctx, sb); }, 1500);
        })
        .catch(function (e) { setStatus(statusEl, e.message || "Nettverksfeil.", "error"); });
    });

    // Byte rolle
    root.querySelectorAll(".u-role-sel").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var uid  = sel.getAttribute("data-uid");
        var role = sel.value;
        sb.from("users").update({ role: role }).eq("id", uid).then(function (r) {
          if (r.error) { alert("Kunne ikkje oppdatere rolle."); sel.value = sel.getAttribute("data-prev") || role; return; }
          sel.style.outline = "2px solid var(--color-primary)";
          setTimeout(function () { sel.style.outline = ""; }, 1200);
        });
        sel.setAttribute("data-prev", role);
      });
      sel.setAttribute("data-prev", sel.value);
    });

    // Fjern brukar
    root.querySelectorAll(".u-remove-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var uid  = btn.getAttribute("data-uid");
        var name = btn.getAttribute("data-name");
        if (!confirm("Fjerne brukar «" + name + "»? Dette kan ikkje angras.")) return;
        callManageUser("remove", { user_id: uid })
          .then(function (res) {
            if (res.error) { alert("Feil: " + res.error); return; }
            loadAndRender(root, ctx, sb);
          })
          .catch(function () { alert("Nettverksfeil."); });
      });
    });
  }

}());
