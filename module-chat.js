/* =============================================================================
   module-chat.js  —  Native Vibeverk Chat  v1.0 (demo / localStorage)
   -----------------------------------------------------------------------------
   To delar i éin fil:
   A) WIDGET  — chat-boble nede i hjørnet på kundesida
   B) ADMIN   — samtale-administrasjon i admin-panelet (Henvendelser → Chat)

   STORAGE-NØKLAR:
   "chat:convs"          → [{ id, name, email, status, unread, lastMsg, lastAt, createdAt }]
   "chat:msgs:{id}"      → [{ id, convId, text, sender, at }]   sender: "visitor"|"operator"
   "chat:vid"            → string  (besøkande sin sessions-id)
   "chat:vname"          → string  (besøkande sitt namn)

   SUPABASE-MIGRERING (seinare):
   Byt ut Chat.store.get/set med Supabase-kall. Alt anna er urørt.
   Polling (setInterval) → Supabase Realtime. Éin funksjon kvar.
   ========================================================================== */

(function () {
  "use strict";

  /* ──────────────────────────────────────────────────────────────────────────
     KONFIGURASJON  (hentast frå config.js / admin — CFG.chat)
  ────────────────────────────────────────────────────────────────────────── */
  var CFG_CHAT = (window.SITE_CONFIG && window.SITE_CONFIG.chat) || {};

  var DEFAULTS = {
    enabled:         true,
    position:        "right",          // "right" | "left"
    color:           null,             // null = bruk --color-primary
    welcomeMsg:      "Hei! Korleis kan vi hjelpe deg?",
    operatorName:    "Oss",
    askName:         true,
    pollInterval:    5000              // ms mellom admin-poll
  };

  var OPT = Object.assign({}, DEFAULTS, CFG_CHAT);
  if (!OPT.enabled) return;

  /* ──────────────────────────────────────────────────────────────────────────
     STORAGE-LAG  (swappast til Supabase seinare)
  ────────────────────────────────────────────────────────────────────────── */
  var Chat = {
    store: {
      get: function (k, def) {
        try { var v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : def; }
        catch (e) { return def; }
      },
      set: function (k, v) {
        try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
      }
    },
    newId: function () {
      return "c" + Date.now() + Math.random().toString(36).slice(2, 6);
    },
    esc: function (s) {
      return String(s || "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    },
    ts: function (ms) {
      if (!ms) return "";
      var d = new Date(ms);
      return d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
    },
    tsDate: function (ms) {
      if (!ms) return "";
      var d = new Date(ms);
      var now = new Date();
      if (d.toDateString() === now.toDateString()) return Chat.ts(ms);
      return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" }) + " " + Chat.ts(ms);
    },

    /* Samtalar */
    getConvs: function () { return Chat.store.get("chat:convs", []); },
    setConvs: function (v) { Chat.store.set("chat:convs", v); },

    getConv: function (id) {
      return Chat.getConvs().find(function (c) { return c.id === id; }) || null;
    },

    createConv: function (name, email) {
      var conv = {
        id: Chat.newId(), name: name || "Gjest", email: email || "",
        status: "open", unread: 0, lastMsg: "", lastAt: Date.now(), createdAt: Date.now()
      };
      var convs = Chat.getConvs();
      convs.unshift(conv);
      Chat.setConvs(convs);
      return conv;
    },

    updateConv: function (id, changes) {
      var convs = Chat.getConvs();
      var idx = convs.findIndex(function (c) { return c.id === id; });
      if (idx > -1) { Object.assign(convs[idx], changes); Chat.setConvs(convs); }
    },

    /* Meldingar */
    getMsgs: function (convId) { return Chat.store.get("chat:msgs:" + convId, []); },
    setMsgs: function (convId, msgs) { Chat.store.set("chat:msgs:" + convId, msgs); },

    addMsg: function (convId, text, sender) {
      var msg = { id: Chat.newId(), convId: convId, text: text, sender: sender, at: Date.now() };
      var msgs = Chat.getMsgs(convId);
      msgs.push(msg);
      Chat.setMsgs(convId, msgs);
      Chat.updateConv(convId, {
        lastMsg: text.slice(0, 60),
        lastAt: msg.at,
        unread: sender === "visitor"
          ? (Chat.getConv(convId) ? Chat.getConv(convId).unread + 1 : 1)
          : Chat.getConv(convId) ? Chat.getConv(convId).unread : 0
      });
      return msg;
    },

    markRead: function (convId) {
      Chat.updateConv(convId, { unread: 0 });
    },

    /* Besøkande sin session */
    getVid: function () {
      var vid = Chat.store.get("chat:vid", null);
      if (!vid) { vid = Chat.newId(); Chat.store.set("chat:vid", vid); }
      return vid;
    },
    getVname: function () { return Chat.store.get("chat:vname", ""); },
    setVname: function (n) { Chat.store.set("chat:vname", n); },

    /* Finn aktiv samtale for besøkande */
    getMyConv: function () {
      var vid = Chat.getVid();
      return Chat.store.get("chat:myconv:" + vid, null);
    },
    setMyConv: function (convId) {
      Chat.store.set("chat:myconv:" + Chat.getVid(), convId);
    },

    /* Totalt ulest for admin */
    totalUnread: function () {
      return Chat.getConvs().reduce(function (n, c) { return n + (c.unread || 0); }, 0);
    }
  };

  /* ══════════════════════════════════════════════════════════════════════════
     A)  WIDGET  —  berre på kundesida (ikkje i admin-panel)
  ══════════════════════════════════════════════════════════════════════════ */
  function initWidget() {
    /* Ikkje vis widget inne i admin-panel eller intranett */
    if (document.getElementById("admin-modal-root")) return;
    if (document.getElementById("intranet")) return;
    if (window._vibeverkAdminOpen) return;

    var color = OPT.color || getComputedStyle(document.documentElement)
      .getPropertyValue("--color-primary").trim() || "#1a6e5a";

    var pos = OPT.position === "left"
      ? "left:1.2rem;right:auto"
      : "right:1.2rem;left:auto";

    /* Stiler */
    var style = document.createElement("style");
    style.textContent = [
      "#vw-chat-btn{position:fixed;bottom:1.4rem;" + pos + ";z-index:9990;",
        "width:52px;height:52px;border-radius:50%;background:" + color + ";",
        "border:0;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.22);",
        "display:flex;align-items:center;justify-content:center;",
        "transition:transform .18s,box-shadow .18s;color:#fff;font-size:1.4rem}",
      "#vw-chat-btn:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(0,0,0,.28)}",
      "#vw-chat-badge{position:absolute;top:-2px;right:-2px;background:#e74c3c;color:#fff;",
        "border-radius:999px;font-size:.68rem;font-weight:700;padding:.1rem .38rem;",
        "min-width:18px;text-align:center;display:none}",
      "#vw-chat-panel{position:fixed;bottom:5.2rem;" + pos + ";z-index:9989;",
        "width:340px;max-width:calc(100vw - 2rem);height:480px;max-height:calc(100vh - 7rem);",
        "background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);",
        "display:none;flex-direction:column;overflow:hidden;",
        "border:1px solid rgba(0,0,0,.08)}",
      "#vw-chat-panel.open{display:flex}",
      ".vw-chat-head{background:" + color + ";color:#fff;padding:.85rem 1rem;",
        "display:flex;align-items:center;gap:.6rem}",
      ".vw-chat-head-info{flex:1}",
      ".vw-chat-head-name{font-weight:700;font-size:.95rem}",
      ".vw-chat-head-sub{font-size:.75rem;opacity:.85}",
      ".vw-chat-close{background:none;border:0;color:#fff;cursor:pointer;font-size:1.3rem;line-height:1;padding:.1rem .2rem;opacity:.8}",
      ".vw-chat-close:hover{opacity:1}",
      ".vw-chat-msgs{flex:1;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.5rem;background:#f8f9fa}",
      ".vw-msg{max-width:80%;padding:.55rem .75rem;border-radius:14px;font-size:.87rem;line-height:1.5;word-break:break-word}",
      ".vw-msg--op{background:" + color + ";color:#fff;align-self:flex-start;border-bottom-left-radius:4px}",
      ".vw-msg--vis{background:#fff;color:#222;align-self:flex-end;border-bottom-right-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.08)}",
      ".vw-msg-ts{font-size:.68rem;opacity:.6;margin-top:.2rem;text-align:right}",
      ".vw-msg--op .vw-msg-ts{text-align:left}",
      ".vw-chat-input-area{padding:.7rem;border-top:1px solid #e9ecef;background:#fff;display:flex;gap:.5rem;align-items:flex-end}",
      ".vw-chat-input{flex:1;border:1.5px solid #ddd;border-radius:10px;padding:.5rem .75rem;font:inherit;font-size:.87rem;resize:none;max-height:80px;outline:none;transition:border-color .15s}",
      ".vw-chat-input:focus{border-color:" + color + "}",
      ".vw-chat-send{background:" + color + ";color:#fff;border:0;border-radius:10px;",
        "padding:.5rem .85rem;cursor:pointer;font-size:.9rem;font-weight:600;",
        "flex-shrink:0;transition:opacity .15s}",
      ".vw-chat-send:hover{opacity:.88}",
      ".vw-name-form{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.5rem;gap:.8rem}",
      ".vw-name-form p{font-size:.88rem;color:#555;text-align:center;margin:0}",
      ".vw-name-input{width:100%;border:1.5px solid #ddd;border-radius:10px;padding:.55rem .8rem;font:inherit;font-size:.9rem;outline:none;transition:border-color .15s}",
      ".vw-name-input:focus{border-color:" + color + "}",
      ".vw-name-btn{width:100%;background:" + color + ";color:#fff;border:0;border-radius:10px;padding:.65rem;font:inherit;font-size:.9rem;font-weight:700;cursor:pointer}"
    ].join("");
    document.head.appendChild(style);

    /* Bygg HTML */
    var btn = document.createElement("button");
    btn.id = "vw-chat-btn";
    btn.setAttribute("aria-label", "Chat med oss");
    btn.innerHTML = '<i class="ti ti-message-circle"></i><span id="vw-chat-badge"></span>';

    var panel = document.createElement("div");
    panel.id = "vw-chat-panel";
    panel.innerHTML =
      '<div class="vw-chat-head">' +
        '<i class="ti ti-message-circle" style="font-size:1.3rem;flex-shrink:0"></i>' +
        '<div class="vw-chat-head-info">' +
          '<div class="vw-chat-head-name">' + Chat.esc(OPT.operatorName) + '</div>' +
          '<div class="vw-chat-head-sub">Svar vanlegvis innan kort tid</div>' +
        '</div>' +
        '<button class="vw-chat-close" aria-label="Lukk">&times;</button>' +
      '</div>' +
      '<div class="vw-chat-msgs" id="vw-chat-msgs"></div>' +
      '<div id="vw-chat-bottom"></div>';

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    var badge    = document.getElementById("vw-chat-badge");
    var msgsEl   = document.getElementById("vw-chat-msgs");
    var bottomEl = document.getElementById("vw-chat-bottom");
    var isOpen   = false;

    /* Aktiv samtale */
    var convId = Chat.getMyConv();
    var vname  = Chat.getVname();

    function renderWidget() {
      msgsEl.innerHTML = "";

      if (!convId || !Chat.getConv(convId)) {
        /* Velkomst + namneform */
        var welcome = document.createElement("div");
        welcome.style.cssText = "display:flex;flex-direction:column;height:100%";
        welcome.innerHTML =
          '<div style="flex:1;display:flex;align-items:flex-end;padding:.9rem">' +
            '<div class="vw-msg vw-msg--op">' + Chat.esc(OPT.welcomeMsg) +
              '<div class="vw-msg-ts">' + Chat.ts(Date.now()) + '</div>' +
            '</div>' +
          '</div>';
        msgsEl.appendChild(welcome);
        renderInputArea(true);
        return;
      }

      /* Vis meldingar */
      var msgs = Chat.getMsgs(convId);
      if (!msgs.length) {
        msgsEl.innerHTML = '<p style="text-align:center;font-size:.82rem;color:#aaa;margin:auto">Ingen meldingar endå.</p>';
      } else {
        msgs.forEach(function (m) {
          var cls = m.sender === "operator" ? "vw-msg--op" : "vw-msg--vis";
          var div = document.createElement("div");
          div.className = "vw-msg " + cls;
          div.innerHTML = Chat.esc(m.text) + '<div class="vw-msg-ts">' + Chat.ts(m.at) + '</div>';
          msgsEl.appendChild(div);
        });
      }
      msgsEl.scrollTop = msgsEl.scrollHeight;
      renderInputArea(false);
    }

    function renderInputArea(showNameForm) {
      if (showNameForm && OPT.askName && !vname) {
        bottomEl.innerHTML =
          '<div class="vw-name-form">' +
            '<p>Kva heiter du? (valgfritt)</p>' +
            '<input class="vw-name-input" id="vw-name-inp" type="text" placeholder="Ditt namn…" maxlength="60">' +
            '<button class="vw-name-btn" id="vw-name-btn">Start samtale</button>' +
          '</div>';
        var inp = bottomEl.querySelector("#vw-name-inp");
        var startBtn = bottomEl.querySelector("#vw-name-btn");
        if (inp) inp.focus();
        startBtn.addEventListener("click", function () {
          var n = inp.value.trim();
          vname = n || "Gjest";
          Chat.setVname(vname);
          startConv(vname, "");
        });
        if (inp) inp.addEventListener("keydown", function (e) {
          if (e.key === "Enter") startBtn.click();
        });
      } else {
        bottomEl.innerHTML =
          '<div class="vw-chat-input-area">' +
            '<textarea class="vw-chat-input" id="vw-vis-inp" rows="1" placeholder="Skriv ei melding…" maxlength="1000"></textarea>' +
            '<button class="vw-chat-send" id="vw-send-btn"><i class="ti ti-send"></i></button>' +
          '</div>';
        var textarea = bottomEl.querySelector("#vw-vis-inp");
        var sendBtn  = bottomEl.querySelector("#vw-send-btn");
        textarea.addEventListener("input", function () {
          this.style.height = "auto";
          this.style.height = Math.min(this.scrollHeight, 80) + "px";
        });
        function sendMsg() {
          var txt = textarea.value.trim();
          if (!txt) return;
          if (!convId) startConv(vname || "Gjest", "");
          textarea.value = "";
          textarea.style.height = "auto";
          Chat.addMsg(convId, txt, "visitor");
          renderWidget();
        }
        sendBtn.addEventListener("click", sendMsg);
        textarea.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); }
        });
        if (textarea) setTimeout(function () { textarea.focus(); }, 50);
      }
    }

    function startConv(name, email) {
      var conv = Chat.createConv(name, email);
      convId = conv.id;
      Chat.setMyConv(convId);
      renderWidget();
    }

    /* Poll for operator-svar */
    var lastMsgCount = 0;
    function pollOperator() {
      if (!convId || !isOpen) return;
      var msgs = Chat.getMsgs(convId);
      if (msgs.length !== lastMsgCount) {
        lastMsgCount = msgs.length;
        renderWidget();
      }
    }

    function updateBadge() {
      /* Sjekk om operator har svart på mi samtale */
      if (!convId) return;
      var msgs = Chat.getMsgs(convId);
      var hasNewOp = msgs.filter(function (m) { return m.sender === "operator"; }).length > 0;
      if (hasNewOp && !isOpen) {
        badge.textContent = "1";
        badge.style.display = "";
      }
    }

    setInterval(function () { pollOperator(); updateBadge(); }, OPT.pollInterval);

    /* Toggle */
    btn.addEventListener("click", function () {
      isOpen = !isOpen;
      panel.classList.toggle("open", isOpen);
      if (isOpen) {
        badge.style.display = "none";
        renderWidget();
        btn.innerHTML = '<i class="ti ti-x"></i>';
      } else {
        btn.innerHTML = '<i class="ti ti-message-circle"></i><span id="vw-chat-badge"></span>';
      }
    });

    panel.querySelector(".vw-chat-close").addEventListener("click", function () {
      isOpen = false;
      panel.classList.remove("open");
      btn.innerHTML = '<i class="ti ti-message-circle"></i><span id="vw-chat-badge"></span>';
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     B)  ADMIN-PANEL  —  Chat-fane under Henvendelser
  ══════════════════════════════════════════════════════════════════════════ */
  function initAdminChat() {
    /* Eksponér Chat-objektet og admin-renderer på window
       slik at core.js kan kalle det */
    window.VwChat        = Chat;
    window.VwChatAdmin   = { render: renderAdminChat };
  }

  function renderAdminChat(container) {
    var convs   = Chat.getConvs();
    var activeId = container._activeConvId || (convs[0] && convs[0].id) || null;

    /* CSS */
    if (!document.getElementById("vw-chat-admin-css")) {
      var s = document.createElement("style");
      s.id  = "vw-chat-admin-css";
      s.textContent = [
        ".vwca{display:grid;grid-template-columns:280px 1fr;gap:0;border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden;height:560px}",
        ".vwca-list{border-right:1px solid var(--color-border);overflow-y:auto;background:var(--color-bg)}",
        ".vwca-list-head{padding:.7rem 1rem;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between}",
        ".vwca-list-head h4{margin:0;font-size:.9rem}",
        ".vwca-conv{padding:.7rem 1rem;cursor:pointer;border-bottom:1px solid var(--color-border);transition:background .1s;display:flex;flex-direction:column;gap:.15rem}",
        ".vwca-conv:hover{background:color-mix(in srgb,var(--color-primary) 5%,transparent)}",
        ".vwca-conv.is-active{background:color-mix(in srgb,var(--color-primary) 10%,transparent)}",
        ".vwca-conv__name{font-weight:600;font-size:.87rem;display:flex;align-items:center;gap:.4rem}",
        ".vwca-conv__preview{font-size:.78rem;color:var(--color-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".vwca-conv__ts{font-size:.7rem;color:var(--color-muted)}",
        ".vwca-unread{background:var(--color-primary);color:#fff;border-radius:999px;font-size:.65rem;font-weight:700;padding:.1rem .38rem;min-width:18px;text-align:center}",
        ".vwca-view{display:flex;flex-direction:column;background:var(--color-bg)}",
        ".vwca-view-head{padding:.75rem 1.1rem;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between}",
        ".vwca-view-head-info strong{font-size:.92rem}",
        ".vwca-view-head-info span{font-size:.78rem;color:var(--color-muted);margin-left:.5rem}",
        ".vwca-msgs{flex:1;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.5rem;background:#f8f9fa}",
        ".vwca-msg{max-width:75%;padding:.55rem .8rem;border-radius:14px;font-size:.87rem;line-height:1.5;word-break:break-word}",
        ".vwca-msg--op{background:var(--color-primary);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}",
        ".vwca-msg--vis{background:#fff;color:#222;align-self:flex-start;border-bottom-left-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.07)}",
        ".vwca-msg-ts{font-size:.68rem;opacity:.6;margin-top:.2rem}",
        ".vwca-msg--op .vwca-msg-ts{text-align:right}",
        ".vwca-reply{padding:.7rem 1rem;border-top:1px solid var(--color-border);background:var(--color-surface);display:flex;gap:.5rem;align-items:flex-end}",
        ".vwca-reply-inp{flex:1;border:1.5px solid var(--color-border);border-radius:10px;padding:.5rem .75rem;font:inherit;font-size:.87rem;resize:none;max-height:90px;outline:none;background:var(--color-bg);color:var(--color-text);transition:border-color .15s}",
        ".vwca-reply-inp:focus{border-color:var(--color-primary)}",
        ".vwca-reply-btn{background:var(--color-primary);color:#fff;border:0;border-radius:10px;padding:.5rem .9rem;cursor:pointer;font:inherit;font-size:.88rem;font-weight:600;flex-shrink:0;display:flex;align-items:center;gap:.35rem;transition:opacity .15s}",
        ".vwca-reply-btn:hover{opacity:.88}",
        ".vwca-reply-btn:disabled{opacity:.5;cursor:not-allowed}",
        ".vwca-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--color-muted);font-size:.9rem}",
        ".vwca-status-btn{font-size:.75rem;padding:.2rem .6rem;border-radius:999px;border:1px solid var(--color-border);background:none;cursor:pointer;color:var(--color-muted)}",
        "[data-theme='dark'] .vwca-msgs{background:#1a1d2e}",
        "[data-theme='dark'] .vwca-msg--vis{background:#252840;color:var(--color-text)}"
      ].join("");
      document.head.appendChild(s);
    }

    function convStatusLabel(s) {
      return s === "closed" ? "Lukka" : "Open";
    }

    function buildUI() {
      convs = Chat.getConvs();
      var totalUnread = Chat.totalUnread();

      /* Oppdater badge i admin-navigasjon */
      var navBadge = document.querySelector("[data-chat-admin-badge]");
      if (navBadge) {
        navBadge.textContent = totalUnread > 0 ? totalUnread : "";
        navBadge.style.display = totalUnread > 0 ? "" : "none";
      }

      container.innerHTML =
        '<div class="vwca">' +
          /* Samtaleliste */
          '<div class="vwca-list">' +
            '<div class="vwca-list-head">' +
              '<h4>Samtalar ' + (convs.length ? '<span style="font-weight:400;color:var(--color-muted)">(' + convs.length + ')</span>' : '') + '</h4>' +
              (totalUnread ? '<span class="vwca-unread">' + totalUnread + ' ulest</span>' : '') +
            '</div>' +
            (convs.length
              ? convs.map(function (c) {
                  return '<div class="vwca-conv' + (c.id === activeId ? ' is-active' : '') + '" data-conv-id="' + Chat.esc(c.id) + '">' +
                    '<div class="vwca-conv__name">' +
                      Chat.esc(c.name) +
                      (c.unread ? '<span class="vwca-unread">' + c.unread + '</span>' : '') +
                    '</div>' +
                    (c.lastMsg ? '<div class="vwca-conv__preview">' + Chat.esc(c.lastMsg) + '</div>' : '') +
                    '<div class="vwca-conv__ts">' + Chat.tsDate(c.lastAt) + '</div>' +
                  '</div>';
                }).join("")
              : '<div style="padding:1.2rem;font-size:.85rem;color:var(--color-muted);text-align:center">Ingen samtalar ennå.<br>Prøv chat-widgeten på kundesida.</div>'
            ) +
          '</div>' +

          /* Samtalevisning */
          '<div class="vwca-view" id="vwca-view">' +
          '</div>' +
        '</div>';

      /* Klikk på samtale */
      container.querySelectorAll("[data-conv-id]").forEach(function (el) {
        el.addEventListener("click", function () {
          activeId = el.getAttribute("data-conv-id");
          container._activeConvId = activeId;
          Chat.markRead(activeId);
          buildUI();
        });
      });

      renderConvView();
    }

    function renderConvView() {
      var view = container.querySelector("#vwca-view");
      if (!view) return;

      if (!activeId || !Chat.getConv(activeId)) {
        view.innerHTML = '<div class="vwca-empty">Vel ein samtale til venstre</div>';
        return;
      }

      var conv = Chat.getConv(activeId);
      var msgs = Chat.getMsgs(activeId);

      view.innerHTML =
        '<div class="vwca-view-head">' +
          '<div class="vwca-view-head-info">' +
            '<strong>' + Chat.esc(conv.name) + '</strong>' +
            (conv.email ? '<span>' + Chat.esc(conv.email) + '</span>' : '') +
          '</div>' +
          '<button class="vwca-status-btn" data-toggle-status>' +
            convStatusLabel(conv.status) +
          '</button>' +
        '</div>' +
        '<div class="vwca-msgs" id="vwca-msg-list">' +
          (msgs.length
            ? msgs.map(function (m) {
                var cls = m.sender === "operator" ? "vwca-msg--op" : "vwca-msg--vis";
                return '<div class="vwca-msg ' + cls + '">' +
                  Chat.esc(m.text) +
                  '<div class="vwca-msg-ts">' + Chat.tsDate(m.at) + '</div>' +
                '</div>';
              }).join("")
            : '<div style="text-align:center;font-size:.82rem;color:var(--color-muted);margin:auto">Ingen meldingar endå.</div>'
          ) +
        '</div>' +
        '<div class="vwca-reply">' +
          '<textarea class="vwca-reply-inp" id="vwca-inp" rows="1" placeholder="Skriv svar…" maxlength="2000"></textarea>' +
          '<button class="vwca-reply-btn" id="vwca-send"><i class="ti ti-send"></i> Send</button>' +
        '</div>';

      /* Scroll til botnen */
      var msgList = view.querySelector("#vwca-msg-list");
      if (msgList) msgList.scrollTop = msgList.scrollHeight;

      /* Send */
      var inp     = view.querySelector("#vwca-inp");
      var sendBtn = view.querySelector("#vwca-send");

      inp.addEventListener("input", function () {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight, 90) + "px";
      });

      function doSend() {
        var txt = inp.value.trim();
        if (!txt) return;
        sendBtn.disabled = true;
        inp.value = "";
        inp.style.height = "auto";
        Chat.addMsg(activeId, txt, "operator");
        Chat.markRead(activeId);
        renderConvView();
        sendBtn.disabled = false;
        if (inp) inp.focus();
      }

      sendBtn.addEventListener("click", doSend);
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
      });

      /* Toggle status */
      var statusBtn = view.querySelector("[data-toggle-status]");
      if (statusBtn) {
        statusBtn.addEventListener("click", function () {
          var newStatus = conv.status === "closed" ? "open" : "closed";
          Chat.updateConv(activeId, { status: newStatus });
          buildUI();
        });
      }
    }

    /* Poll for nye visitor-meldingar */
    if (!container._chatPollId) {
      container._chatPollId = setInterval(function () {
        var newConvs = Chat.getConvs();
        var changed  = JSON.stringify(newConvs) !== JSON.stringify(convs);
        if (changed) { convs = newConvs; buildUI(); }
        /* Oppdater aktiv samtalevisning */
        else if (activeId) {
          var msgs = Chat.getMsgs(activeId);
          var msgList = container.querySelector("#vwca-msg-list");
          if (msgList && msgList.children.length !== msgs.length) {
            renderConvView();
          }
        }
      }, OPT.pollInterval);
    }

    buildUI();
  }

  /* ──────────────────────────────────────────────────────────────────────────
     OPPSTART
  ────────────────────────────────────────────────────────────────────────── */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initWidget();
      initAdminChat();
    });
  } else {
    initWidget();
    initAdminChat();
  }

})();
