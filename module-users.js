/* =============================================================================
   module-users.js  —  Brukaradministrasjon for Eigar/Admin
   -----------------------------------------------------------------------------
   Registrerer seg som admin-modul under kategorien "Innstillingar".
   Berre eigar og admin ser fana.

   Krev: Supabase Edge Function supabase/functions/manage-user/index.ts
   ========================================================================== */
(function () {
  "use strict";

  var _sb = (window.App && window.App.supabase) || null;

  /* ── HJELPEFUNKSJONAR ────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function uid() {
    if (!_sb) return null;
    return _sb.auth.getUser().then(function (r) { return r.data.user ? r.data.user.id : null; });
  }

  function getFnUrl() {
    var base = (window.SITE_CONFIG && window.SITE_CONFIG.supabase && window.SITE_CONFIG.supabase.url)
      || (_sb && _sb.supabaseUrl)
      || null;
    return base ? base + "/functions/v1/manage-user" : null;
  }

  async function callFn(body) {
    if (!_sb) return { error: "Supabase ikkje konfigurert" };
    var session = (await _sb.auth.getSession()).data.session;
    if (!session) return { error: "Ikkje innlogga" };
    var fnUrl = getFnUrl();
    if (!fnUrl) return { error: "Fann ikkje Edge Function URL" };
    try {
      var resp = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + session.access_token,
        },
        body: JSON.stringify(body),
      });
      return await resp.json();
    } catch (e) {
      return { error: String(e) };
    }
  }

  /* ── RENDER ──────────────────────────────────────────────────────────────── */
  function renderAdmin(container) {
    if (!document.getElementById("vwu-css")) {
      var s = document.createElement("style");
      s.id = "vwu-css";
      s.textContent = [
        ".vwu{max-width:680px}",
        ".vwu-table{width:100%;border-collapse:collapse;font-size:.87rem}",
        ".vwu-table th{text-align:left;padding:.5rem .7rem;font-size:.75rem;font-weight:700;",
          "text-transform:uppercase;letter-spacing:.06em;color:var(--color-muted);",
          "border-bottom:2px solid var(--color-border)}",
        ".vwu-table td{padding:.55rem .7rem;border-bottom:1px solid var(--color-border);vertical-align:middle}",
        ".vwu-role{font-size:.75rem;padding:.15rem .5rem;border-radius:999px;font-weight:600;border:1.5px solid}",
        ".vwu-role--owner{border-color:#7c3aed;color:#7c3aed;background:color-mix(in srgb,#7c3aed 8%,transparent)}",
        ".vwu-role--admin{border-color:var(--color-primary);color:var(--color-primary);background:color-mix(in srgb,var(--color-primary) 8%,transparent)}",
        ".vwu-role--member{border-color:var(--color-border);color:var(--color-muted);background:transparent}",
        ".vwu-role-sel{font-size:.82rem;border:1.5px solid var(--color-border);border-radius:8px;",
          "padding:.25rem .5rem;background:var(--color-bg);color:var(--color-text);cursor:pointer}",
        ".vwu-del-btn{background:none;border:1.5px solid var(--color-border);border-radius:6px;",
          "padding:.2rem .55rem;font-size:.75rem;color:#e74c3c;cursor:pointer;transition:all .12s}",
        ".vwu-del-btn:hover{background:color-mix(in srgb,#e74c3c 10%,transparent);border-color:#e74c3c}",
        ".vwu-invite{margin-top:1.5rem;padding:1.2rem;border:1.5px solid var(--color-border);",
          "border-radius:12px;background:var(--color-surface)}",
        ".vwu-invite h4{margin:0 0 .8rem;font-size:.9rem}",
        ".vwu-row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end}",
        ".vwu-field{display:flex;flex-direction:column;gap:.3rem;flex:1;min-width:180px}",
        ".vwu-field label{font-size:.76rem;font-weight:600;color:var(--color-muted)}",
        ".vwu-field input,.vwu-field select{border:1.5px solid var(--color-border);border-radius:8px;",
          "padding:.45rem .65rem;font:inherit;font-size:.87rem;background:var(--color-bg);",
          "color:var(--color-text);outline:none;transition:border-color .15s}",
        ".vwu-field input:focus,.vwu-field select:focus{border-color:var(--color-primary)}",
        ".vwu-invite-btn{background:var(--color-primary);color:#fff;border:0;border-radius:8px;",
          "padding:.5rem 1rem;font:inherit;font-size:.87rem;font-weight:600;cursor:pointer;",
          "white-space:nowrap;transition:opacity .15s;align-self:flex-end}",
        ".vwu-invite-btn:hover{opacity:.88}",
        ".vwu-invite-btn:disabled{opacity:.45;cursor:not-allowed}",
        ".vwu-msg{font-size:.82rem;margin-top:.6rem;padding:.4rem .7rem;border-radius:7px}",
        ".vwu-msg--ok{background:color-mix(in srgb,#22c55e 12%,transparent);color:#166534}",
        ".vwu-msg--err{background:color-mix(in srgb,#e74c3c 10%,transparent);color:#991b1b}",
      ].join("");
      document.head.appendChild(s);
    }

    container.innerHTML = '<div class="vwu"><p style="color:var(--color-muted);font-size:.82rem">Lastar brukarar…</p></div>';

    if (!_sb) {
      container.innerHTML = '<div class="vwu"><p style="color:var(--color-muted)">Supabase ikkje konfigurert.</p></div>';
      return;
    }

    _sb.auth.getUser().then(function (r) {
      var me = r.data.user;
      if (!me) { container.innerHTML = '<div class="vwu"><p>Ikkje innlogga.</p></div>'; return; }

      _sb.from("users").select("id, display_name, role, email, avatar_url, created_at")
        .order("created_at", { ascending: true })
        .then(function (res) {
          if (res.error) {
            container.innerHTML = '<div class="vwu"><p style="color:#e74c3c">Feil: ' + esc(res.error.message) + '</p></div>';
            return;
          }
          var users = res.data || [];
          var me_user = users.find(function (u) { return u.id === me.id; }) || {};
          var isOwnerAdmin = ["owner", "admin"].includes(me_user.role);

          function roleTag(role) {
            return '<span class="vwu-role vwu-role--' + esc(role) + '">' + esc(role) + '</span>';
          }

          var rows = users.map(function (u) {
            var isSelf = u.id === me.id;
            var canEdit = isOwnerAdmin && !isSelf;
            var roleHtml = canEdit
              ? '<select class="vwu-role-sel" data-uid="' + esc(u.id) + '" data-cur-role="' + esc(u.role) + '">' +
                  ['member', 'admin', 'owner'].map(function (r) {
                    return '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' + r + '</option>';
                  }).join("") +
                '</select>'
              : roleTag(u.role);
            var delHtml = canEdit
              ? '<button class="vwu-del-btn" data-del="' + esc(u.id) + '" data-del-name="' + esc(u.display_name || u.email || u.id) + '">Fjern</button>'
              : '';
            return '<tr>' +
              '<td style="font-weight:500">' + esc(u.display_name || "(ingen namn)") +
                (isSelf ? ' <span style="font-size:.72rem;color:var(--color-muted)">(deg)</span>' : '') + '</td>' +
              '<td style="color:var(--color-muted)">' + esc(u.email || "—") + '</td>' +
              '<td>' + roleHtml + '</td>' +
              '<td>' + delHtml + '</td>' +
            '</tr>';
          }).join("");

          var inviteHtml = isOwnerAdmin
            ? '<div class="vwu-invite">' +
                '<h4>Inviter ny brukar</h4>' +
                '<div class="vwu-row">' +
                  '<div class="vwu-field"><label>E-postadresse</label><input id="vwu-email" type="email" placeholder="namn@bedrift.no" maxlength="120"></div>' +
                  '<div class="vwu-field" style="flex:0 0 auto"><label>Namn (valgfritt)</label><input id="vwu-dname" type="text" placeholder="Ola Nordmann" maxlength="80"></div>' +
                  '<div class="vwu-field" style="flex:0 0 auto"><label>Rolle</label>' +
                    '<select id="vwu-role">' +
                      '<option value="member">member</option>' +
                      '<option value="admin">admin</option>' +
                      (me_user.role === "owner" ? '<option value="owner">owner</option>' : '') +
                    '</select>' +
                  '</div>' +
                  '<button class="vwu-invite-btn" id="vwu-invite-btn">Send invitasjon</button>' +
                '</div>' +
                '<div id="vwu-msg"></div>' +
              '</div>'
            : '<p style="font-size:.82rem;color:var(--color-muted);margin-top:.8rem">Berre eigar/admin kan invitere brukarar.</p>';

          container.innerHTML =
            '<div class="vwu">' +
              '<h3 style="margin:0 0 .9rem;font-size:1rem">Brukarar (' + users.length + '/50)</h3>' +
              '<table class="vwu-table"><thead><tr>' +
                '<th>Namn</th><th>E-post</th><th>Rolle</th><th></th>' +
              '</tr></thead><tbody>' + rows + '</tbody></table>' +
              inviteHtml +
            '</div>';

          /* Bind rolle-endring */
          container.querySelectorAll(".vwu-role-sel").forEach(function (sel) {
            sel.addEventListener("change", function () {
              var uid = sel.getAttribute("data-uid");
              var newRole = sel.value;
              _sb.from("users").update({ role: newRole }).eq("id", uid)
                .then(function (r) {
                  if (r.error) { alert("Feil: " + r.error.message); sel.value = sel.getAttribute("data-cur-role"); return; }
                  sel.setAttribute("data-cur-role", newRole);
                });
            });
          });

          /* Bind fjern-knapp */
          container.querySelectorAll("[data-del]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var uid = btn.getAttribute("data-del");
              var name = btn.getAttribute("data-del-name");
              if (!confirm('Fjerne "' + name + '"? Brukaren mister tilgang umiddelbart.')) return;
              btn.disabled = true;
              callFn({ action: "remove", user_id: uid }).then(function (r) {
                if (r.error) { alert("Feil: " + r.error); btn.disabled = false; return; }
                renderAdmin(container); // reload list
              });
            });
          });

          /* Bind invitasjon */
          var invBtn = container.querySelector("#vwu-invite-btn");
          var msgEl  = container.querySelector("#vwu-msg");
          if (invBtn) {
            invBtn.addEventListener("click", async function () {
              var email = (container.querySelector("#vwu-email").value || "").trim();
              var dname = (container.querySelector("#vwu-dname").value || "").trim();
              var role  = container.querySelector("#vwu-role").value;
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                msgEl.className = "vwu-msg vwu-msg--err"; msgEl.textContent = "Ugyldig e-postadresse."; return;
              }
              invBtn.disabled = true;
              msgEl.className = "vwu-msg"; msgEl.textContent = "Sender…";
              var result = await callFn({ action: "invite", email: email, role: role, display_name: dname });
              invBtn.disabled = false;
              if (result.error) {
                msgEl.className = "vwu-msg vwu-msg--err"; msgEl.textContent = "Feil: " + result.error;
              } else {
                msgEl.className = "vwu-msg vwu-msg--ok";
                msgEl.textContent = "Invitasjon sendt til " + email + "!";
                container.querySelector("#vwu-email").value = "";
                container.querySelector("#vwu-dname").value = "";
                setTimeout(function () { renderAdmin(container); }, 1500);
              }
            });
          }
        });
    });
  }

  /* ── REGISTRERING ────────────────────────────────────────────────────────── */
  if (window.App && typeof window.App.registerModule === "function") {
    window.App.registerModule({
      id:        "users",
      label:     "Brukarar",
      order:     999,
      adminOnly: true,
      render:    function () { return ""; },
      admin: {
        label:    "Brukarar",
        category: "innstillinger",
        render:   function () { return '<div data-users-root></div>'; },
        mount:    function (body) {
          var root = body.querySelector("[data-users-root]") || body;
          renderAdmin(root);
        }
      }
    });
  }

  if (window.Intranet && typeof window.Intranet.registerModule === "function") {
    window.Intranet.registerModule({
      id:       "users",
      navLabel: "Brukarar",
      icon:     "users",
      order:    90,
      render:   function () { return '<div data-users-root></div>'; },
      mount:    function (outlet) {
        var root = outlet.querySelector("[data-users-root]") || outlet;
        renderAdmin(root);
      }
    });
  }

})();
