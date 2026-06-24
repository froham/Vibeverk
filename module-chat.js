/* =============================================================================
   module-chat.js  —  Native Vibeverk Chat  v1.2
   -----------------------------------------------------------------------------
   A) WIDGET  — chat-boble på kundesida (nedre hjørne)
   B) ADMIN   — Chat-fane under Henvendelser i admin-panelet

   SUPABASE-MIGRERING: Byt Chat.store.get/set → Supabase. Polling → Realtime.

   STANDALONE DEPLOYMENT (VS Code):
   1. Kopier denne fila til rot-mappa i repoet
   2. Legg til i index.html: <script src="module-chat.js"></script>
   3. Legg til i config.js:
      chat: {
        enabled: true, position: "right",
        welcomeMsg: "Hei! Korleis kan vi hjelpe deg?",
        operatorName: "Oss", askName: true,
        termsText: "Eg godtek at denne samtalen lagrast",
        termsUrl: ""   // valgfri lenke til personvernsside
      }
   4. Deploy som vanleg — ingen andre avhengigheiter
   ========================================================================== */
(function () {
  "use strict";

  var CFG_CHAT = (window.SITE_CONFIG && window.SITE_CONFIG.chat) || {};
  var CFG_FEAT = (window.SITE_CONFIG && window.SITE_CONFIG.features) || {};
  var OPT = Object.assign({
    enabled:      true,
    position:     "right",
    color:        null,
    welcomeMsg:   "Hei! Korleis kan vi hjelpe deg?",
    operatorName: "Oss",
    askName:      true,
    termsText:    "Eg godtek at denne samtalen lagrast",
    termsUrl:     "",
    pollInterval: 5000
  }, CFG_CHAT);

  if (!OPT.enabled || CFG_FEAT.chat === false) return;

  /* ── EMOJI-SETT ─────────────────────────────────────────────────────────── */
  var EMOJIS = [
    "😀","😊","😂","🤣","😍","😎","🤔","😅","👍","👎",
    "❤️","🔥","✅","⭐","🎉","🙏","😢","😡","👋","🤝",
    "💡","📋","📞","📧","⏰","🔔","💬","✍️","📌","🚀"
  ];

  /* ── STORAGE ────────────────────────────────────────────────────────────── */
  var Chat = {
    store: {
      get: function (k, d) {
        try { var v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : d; }
        catch (e) { return d; }
      },
      set: function (k, v) {
        try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
      }
    },
    newId: function () { return "c" + Date.now() + Math.random().toString(36).slice(2,6); },
    esc: function (s) {
      return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
        .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    },
    ts: function (ms) {
      if (!ms) return "";
      return new Date(ms).toLocaleTimeString("nb-NO",{hour:"2-digit",minute:"2-digit"});
    },
    tsDate: function (ms) {
      if (!ms) return "";
      var d = new Date(ms), now = new Date();
      if (d.toDateString() === now.toDateString()) return Chat.ts(ms);
      return d.toLocaleDateString("nb-NO",{day:"numeric",month:"short"}) + " " + Chat.ts(ms);
    },

    getConvs: function ()    { return Chat.store.get("chat:convs",[]); },
    setConvs: function (v)   { Chat.store.set("chat:convs",v); },
    getConv:  function (id)  { return Chat.getConvs().find(function(c){return c.id===id;})||null; },

    createConv: function (name, email) {
      var conv = {
        id: Chat.newId(), name: name||"Gjest", email: email||"",
        status: "open", unread: 0, lastMsg: "", lastAt: Date.now(), createdAt: Date.now()
      };
      var convs = Chat.getConvs(); convs.unshift(conv); Chat.setConvs(convs);
      return conv;
    },

    updateConv: function (id, changes) {
      var convs = Chat.getConvs();
      var idx = convs.findIndex(function(c){return c.id===id;});
      if (idx > -1) { Object.assign(convs[idx], changes); Chat.setConvs(convs); }
    },

    getMsgs:  function (id)    { return Chat.store.get("chat:msgs:"+id,[]); },
    setMsgs:  function (id, v) { Chat.store.set("chat:msgs:"+id,v); },

    addMsg: function (convId, text, sender) {
      var msg = {id:Chat.newId(),convId:convId,text:text,sender:sender,at:Date.now()};
      var msgs = Chat.getMsgs(convId); msgs.push(msg); Chat.setMsgs(convId,msgs);
      var conv = Chat.getConv(convId);
      Chat.updateConv(convId, {
        lastMsg: text.slice(0,60), lastAt: msg.at,
        unread: sender==="visitor" ? ((conv?conv.unread:0)+1) : (conv?conv.unread:0)
      });
      return msg;
    },

    markRead:   function (id) { Chat.updateConv(id,{unread:0}); },
    setStatus:  function (id, s) { Chat.updateConv(id,{status:s}); },

    getVid:    function () {
      var v = Chat.store.get("chat:vid",null);
      if (!v) { v = Chat.newId(); Chat.store.set("chat:vid",v); } return v;
    },
    getVname:  function () { return Chat.store.get("chat:vname",""); },
    setVname:  function (n) { Chat.store.set("chat:vname",n); },
    getVemail: function () { return Chat.store.get("chat:vemail",""); },
    setVemail: function (e) { Chat.store.set("chat:vemail",e); },
    getMyConv: function () { return Chat.store.get("chat:myconv:"+Chat.getVid(),null); },
    setMyConv: function (id) { Chat.store.set("chat:myconv:"+Chat.getVid(),id); },
    totalUnread: function () {
      return Chat.getConvs().filter(function(c){return c.status==="open";})
        .reduce(function(n,c){return n+(c.unread||0);},0);
    }
  };

  /* ══════════════════════════════════════════════════════════════════════════
     A)  WIDGET
  ══════════════════════════════════════════════════════════════════════════ */
  function initWidget() {
    if (document.getElementById("admin-modal-root")) return;
    if (document.getElementById("intranet")) return;

    var color = OPT.color ||
      getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim() || "#1a6e5a";
    var pos   = OPT.position === "left" ? "left:1.2rem;right:auto" : "right:1.2rem;left:auto";

    var style = document.createElement("style");
    style.textContent = [
      "#vw-btn{position:fixed;bottom:1.4rem;"+pos+";z-index:9990;width:54px;height:54px;",
        "border-radius:50%;background:"+color+";border:0;cursor:pointer;",
        "box-shadow:0 4px 18px rgba(0,0,0,.25);display:flex;align-items:center;",
        "justify-content:center;transition:transform .18s,box-shadow .18s;color:#fff;font-size:1.5rem}",
      "#vw-btn:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(0,0,0,.3)}",
      "#vw-badge{position:absolute;top:-2px;right:-2px;background:#e74c3c;color:#fff;",
        "border-radius:999px;font-size:.68rem;font-weight:700;padding:.1rem .38rem;",
        "min-width:18px;text-align:center;display:none}",
      "#vw-panel{position:fixed;bottom:5.4rem;"+pos+";z-index:9989;width:340px;",
        "max-width:calc(100vw - 2rem);height:500px;max-height:calc(100vh - 7rem);",
        "background:#fff;border-radius:16px;",
        "box-shadow:0 8px 40px rgba(0,0,0,.18);display:none;flex-direction:column;",
        "overflow:hidden;border:1px solid rgba(0,0,0,.08)}",
      "#vw-panel.is-open{display:flex}",
      ".vw-head{background:"+color+";color:#fff;padding:.85rem 1rem;",
        "display:flex;align-items:center;gap:.6rem}",
      ".vw-head-info{flex:1}",
      ".vw-head-name{font-weight:700;font-size:.95rem}",
      ".vw-head-sub{font-size:.75rem;opacity:.85}",
      ".vw-head-actions{display:flex;align-items:center;gap:.3rem}",
      ".vw-head-btn{background:rgba(255,255,255,.18);border:0;color:#fff;cursor:pointer;",
        "border-radius:6px;width:28px;height:28px;display:flex;align-items:center;",
        "justify-content:center;font-size:1rem;transition:background .12s}",
      ".vw-head-btn:hover{background:rgba(255,255,255,.3)}",
      ".vw-msgs{flex:1;overflow-y:auto;padding:.9rem;display:flex;",
        "flex-direction:column;gap:.5rem;background:#f8f9fa}",
      ".vw-msg{max-width:82%;padding:.55rem .75rem;border-radius:14px;",
        "font-size:.87rem;line-height:1.5;word-break:break-word}",
      ".vw-msg--op{background:"+color+";color:#fff;align-self:flex-start;border-bottom-left-radius:4px}",
      ".vw-msg--vis{background:#fff;color:#222;align-self:flex-end;border-bottom-right-radius:4px;",
        "box-shadow:0 1px 4px rgba(0,0,0,.08)}",
      ".vw-msg-ts{font-size:.68rem;opacity:.6;margin-top:.2rem;text-align:right}",
      ".vw-msg--op .vw-msg-ts{text-align:left}",
      ".vw-input-area{padding:.6rem;border-top:1px solid #e9ecef;background:#fff;",
        "display:flex;gap:.4rem;align-items:flex-end;position:relative}",
      ".vw-inp{flex:1;border:1.5px solid #ddd;border-radius:10px;padding:.5rem .7rem;",
        "font:inherit;font-size:.87rem;resize:none;max-height:80px;outline:none;",
        "transition:border-color .15s}",
      ".vw-inp:focus{border-color:"+color+"}",
      ".vw-icon-btn{background:none;border:0;cursor:pointer;font-size:1.2rem;",
        "padding:.3rem;border-radius:6px;transition:background .12s;flex-shrink:0;",
        "color:#888;line-height:1}",
      ".vw-icon-btn:hover{background:#f0f0f0}",
      ".vw-send-btn{background:"+color+";color:#fff;border:0;border-radius:10px;",
        "padding:.5rem .8rem;cursor:pointer;font-size:.9rem;font-weight:600;",
        "flex-shrink:0;transition:opacity .15s;display:flex;align-items:center}",
      ".vw-send-btn:hover{opacity:.88}",
      /* Emoji picker */
      ".vw-emoji-picker{position:absolute;bottom:3.4rem;left:.5rem;",
        "background:#fff;border:1px solid #e0e0e0;border-radius:12px;",
        "padding:.5rem;display:grid;grid-template-columns:repeat(6,1fr);gap:2px;",
        "box-shadow:0 4px 20px rgba(0,0,0,.15);z-index:10;display:none}",
      ".vw-emoji-picker.is-open{display:grid}",
      ".vw-emoji-btn{background:none;border:0;cursor:pointer;font-size:1.3rem;",
        "padding:.2rem;border-radius:6px;line-height:1;transition:background .1s}",
      ".vw-emoji-btn:hover{background:#f5f5f5}",
      /* Startskjema */
      ".vw-start-form{flex:1;display:flex;flex-direction:column;padding:1.2rem;gap:.7rem}",
      ".vw-start-form p{font-size:.85rem;color:#555;margin:0}",
      ".vw-field{display:flex;flex-direction:column;gap:.3rem}",
      ".vw-field label{font-size:.78rem;font-weight:600;color:#555}",
      ".vw-field input{border:1.5px solid #ddd;border-radius:10px;padding:.55rem .8rem;",
        "font:inherit;font-size:.88rem;outline:none;transition:border-color .15s}",
      ".vw-field input:focus{border-color:"+color+"}",
      ".vw-terms{display:flex;align-items:flex-start;gap:.5rem;font-size:.78rem;color:#666}",
      ".vw-terms input[type=checkbox]{margin-top:.15rem;flex-shrink:0;accent-color:"+color+"}",
      ".vw-start-btn{background:"+color+";color:#fff;border:0;border-radius:10px;",
        "padding:.7rem;font:inherit;font-size:.9rem;font-weight:700;cursor:pointer;",
        "transition:opacity .15s;margin-top:.2rem}",
      ".vw-start-btn:hover{opacity:.9}",
      ".vw-start-btn:disabled{opacity:.45;cursor:not-allowed}",
      /* Lukka-banner */
      ".vw-closed-banner{background:#f8f9fa;border-top:1px solid #e9ecef;",
        "padding:.8rem 1rem;font-size:.82rem;color:#888;text-align:center}"
    ].join("");
    document.head.appendChild(style);

    /* DOM */
    var btn   = document.createElement("button");
    btn.id    = "vw-btn";
    btn.setAttribute("aria-label","Opne chat");
    btn.innerHTML = "💬<span id=\"vw-badge\"></span>";

    var panel = document.createElement("div");
    panel.id  = "vw-panel";
    panel.innerHTML =
      '<div class="vw-head">' +
        '<i class="ti ti-message-circle" style="font-size:1.3rem;flex-shrink:0"></i>' +
        '<div class="vw-head-info">' +
          '<div class="vw-head-name">' + Chat.esc(OPT.operatorName) + '</div>' +
          '<div class="vw-head-sub">Svar vanlegvis snart</div>' +
        '</div>' +
        '<div class="vw-head-actions">' +
          '<button class="vw-head-btn" id="vw-min-btn" title="Minimer">—</button>' +
        '</div>' +
      '</div>' +
      '<div class="vw-msgs" id="vw-msgs"></div>' +
      '<div id="vw-bottom"></div>';

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    var badge  = document.getElementById("vw-badge");
    var msgsEl = document.getElementById("vw-msgs");
    var bottom = document.getElementById("vw-bottom");
    var isOpen = false;

    var convId  = Chat.getMyConv();
    var vname   = Chat.getVname();
    var vemail  = Chat.getVemail();

    /* ── RENDER ── */
    function render() {
      var conv = convId ? Chat.getConv(convId) : null;
      msgsEl.innerHTML = "";
      bottom.innerHTML = "";

      if (!convId || !conv) {
        renderStartForm();
        return;
      }

      var msgs = Chat.getMsgs(convId);
      if (!msgs.length) {
        var welcome = document.createElement("div");
        welcome.className = "vw-msg vw-msg--op";
        welcome.innerHTML = Chat.esc(OPT.welcomeMsg) +
          '<div class="vw-msg-ts">' + Chat.ts(Date.now()) + '</div>';
        msgsEl.appendChild(welcome);
      } else {
        msgs.forEach(function (m) {
          var d = document.createElement("div");
          d.className = "vw-msg " + (m.sender==="operator" ? "vw-msg--op" : "vw-msg--vis");
          d.innerHTML = Chat.esc(m.text) + '<div class="vw-msg-ts">' + Chat.ts(m.at) + '</div>';
          msgsEl.appendChild(d);
        });
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }

      if (conv.status === "closed") {
        bottom.innerHTML = '<div class="vw-closed-banner">Samtalen er avslutta. <a href="#" id="vw-reopen" style="color:'+color+'">Start ny samtale</a></div>';
        var reopen = bottom.querySelector("#vw-reopen");
        if (reopen) reopen.addEventListener("click", function (e) {
          e.preventDefault();
          Chat.setStatus(convId, "open");
          render();
        });
      } else {
        renderInputArea();
      }
    }

    function renderStartForm() {
      msgsEl.innerHTML =
        '<div class="vw-msg vw-msg--op">' + Chat.esc(OPT.welcomeMsg) +
          '<div class="vw-msg-ts">' + Chat.ts(Date.now()) + '</div>' +
        '</div>';

      var termsHtml = OPT.termsUrl
        ? '<a href="' + Chat.esc(OPT.termsUrl) + '" target="_blank" style="color:'+color+'">' + Chat.esc(OPT.termsText) + '</a>'
        : Chat.esc(OPT.termsText);

      bottom.innerHTML =
        '<div class="vw-start-form">' +
          (OPT.askName
            ? '<div class="vw-field"><label>Namn (valgfritt)</label>' +
              '<input id="vw-name-inp" type="text" placeholder="Ditt namn…" maxlength="60" value="'+Chat.esc(vname)+'"></div>'
            : '') +
          '<div class="vw-field"><label>E-postadresse *</label>' +
            '<input id="vw-email-inp" type="email" placeholder="din@epost.no" maxlength="120" value="'+Chat.esc(vemail)+'"></div>' +
          '<label class="vw-terms">' +
            '<input type="checkbox" id="vw-terms-cb">' +
            '<span>' + termsHtml + '</span>' +
          '</label>' +
          '<button class="vw-start-btn" id="vw-start-btn" disabled>Start samtale</button>' +
        '</div>';

      var emailInp = bottom.querySelector("#vw-email-inp");
      var termsCb  = bottom.querySelector("#vw-terms-cb");
      var startBtn = bottom.querySelector("#vw-start-btn");
      var nameInp  = bottom.querySelector("#vw-name-inp");

      function checkReady() {
        var emailOk = emailInp && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInp.value.trim());
        startBtn.disabled = !(emailOk && termsCb.checked);
      }
      if (emailInp) emailInp.addEventListener("input", checkReady);
      termsCb.addEventListener("change", checkReady);

      startBtn.addEventListener("click", function () {
        var name  = nameInp  ? nameInp.value.trim()  : "";
        var email = emailInp ? emailInp.value.trim()  : "";
        vname  = name  || "Gjest";
        vemail = email;
        Chat.setVname(vname);
        Chat.setVemail(vemail);
        var conv = Chat.createConv(vname, vemail);
        convId = conv.id;
        Chat.setMyConv(convId);
        render();
      });
    }

    function renderInputArea() {
      bottom.innerHTML =
        '<div class="vw-input-area">' +
          '<div class="vw-emoji-picker" id="vw-emoji"></div>' +
          '<button class="vw-icon-btn" id="vw-emoji-btn" title="Emoji">😊</button>' +
          '<textarea class="vw-inp" id="vw-inp" rows="1" placeholder="Skriv ei melding…" maxlength="1000"></textarea>' +
          '<button class="vw-send-btn" id="vw-send"><i class="ti ti-send"></i></button>' +
        '</div>';

      var emojiPicker = bottom.querySelector("#vw-emoji");
      var emojiBtn    = bottom.querySelector("#vw-emoji-btn");
      var inp         = bottom.querySelector("#vw-inp");
      var sendBtn     = bottom.querySelector("#vw-send");

      /* Emoji-picker */
      emojiPicker.innerHTML = EMOJIS.map(function (e) {
        return '<button class="vw-emoji-btn" data-emoji="'+e+'">'+e+'</button>';
      }).join("");
      emojiPicker.querySelectorAll("[data-emoji]").forEach(function (b) {
        b.addEventListener("click", function () {
          inp.value += b.getAttribute("data-emoji");
          emojiPicker.classList.remove("is-open");
          inp.focus();
        });
      });
      emojiBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        emojiPicker.classList.toggle("is-open");
      });
      document.addEventListener("click", function () { emojiPicker.classList.remove("is-open"); }, {once:false});

      inp.addEventListener("input", function () {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight,80) + "px";
      });

      function doSend() {
        var txt = inp.value.trim();
        if (!txt || !convId) return;
        inp.value = ""; inp.style.height = "auto";
        Chat.addMsg(convId, txt, "visitor");
        render();
      }
      sendBtn.addEventListener("click", doSend);
      inp.addEventListener("keydown", function (e) {
        if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
      });
      setTimeout(function () { if (inp) inp.focus(); }, 50);
    }

    /* ── BADGE / POLL ── */
    var lastMsgCount = 0;
    setInterval(function () {
      if (!convId) return;
      var msgs = Chat.getMsgs(convId);
      if (msgs.length !== lastMsgCount) {
        lastMsgCount = msgs.length;
        if (isOpen) render();
        else { badge.textContent = "1"; badge.style.display = ""; }
      }
    }, OPT.pollInterval);

    /* ── TOGGLE ── */
    function openPanel() {
      isOpen = true;
      panel.classList.add("is-open");
      badge.style.display = "none";
      btn.innerHTML = "✕<span id=\"vw-badge\"></span>";
      render();
    }
    function closePanel() {
      isOpen = false;
      panel.classList.remove("is-open");
      btn.innerHTML = "💬<span id=\"vw-badge\"></span>";
    }

    btn.addEventListener("click", function () { isOpen ? closePanel() : openPanel(); });
    panel.querySelector("#vw-min-btn").addEventListener("click", closePanel);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     B)  ADMIN
  ══════════════════════════════════════════════════════════════════════════ */
  function initAdmin() {
    window.VwChat      = Chat;
    window.VwChatAdmin = { render: renderAdmin };
  }

  function renderAdmin(container) {
    var convs    = Chat.getConvs();
    var activeId = container._activeConvId || (convs.filter(function(c){return c.status==="open";})[0]||convs[0]||{}).id || null;

    if (!document.getElementById("vwca-css")) {
      var s = document.createElement("style");
      s.id  = "vwca-css";
      s.textContent = [
        ".vwca{display:grid;grid-template-columns:290px 1fr;height:580px;border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden}",
        ".vwca-sidebar{border-right:1px solid var(--color-border);display:flex;flex-direction:column;background:var(--color-bg)}",
        ".vwca-sidebar-head{padding:.7rem 1rem;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:.5rem}",
        ".vwca-sidebar-head h4{margin:0;font-size:.9rem;flex:1}",
        ".vwca-test-btn{font-size:.72rem;padding:.15rem .45rem;border:1px solid var(--color-border);border-radius:6px;background:none;cursor:pointer;color:var(--color-muted)}",
        ".vwca-test-btn:hover{background:var(--color-surface)}",
        ".vwca-section-label{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-muted);padding:.5rem 1rem .25rem}",
        ".vwca-conv{padding:.6rem 1rem;cursor:pointer;border-bottom:1px solid var(--color-border);transition:background .1s}",
        ".vwca-conv:hover{background:color-mix(in srgb,var(--color-primary) 6%,transparent)}",
        ".vwca-conv.is-active{background:color-mix(in srgb,var(--color-primary) 11%,transparent)}",
        ".vwca-conv.is-closed{opacity:.55}",
        ".vwca-conv__row{display:flex;align-items:center;gap:.4rem}",
        ".vwca-conv__name{font-weight:600;font-size:.86rem;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".vwca-unread{background:var(--color-primary);color:#fff;border-radius:999px;font-size:.65rem;font-weight:700;padding:.1rem .38rem;min-width:16px;text-align:center}",
        ".vwca-conv__preview{font-size:.76rem;color:var(--color-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:.1rem}",
        ".vwca-conv__ts{font-size:.68rem;color:var(--color-muted);margin-top:.1rem}",
        ".vwca-view{display:flex;flex-direction:column;background:var(--color-bg);overflow:hidden}",
        ".vwca-view-head{padding:.7rem 1rem;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:.6rem}",
        ".vwca-view-head-info{flex:1}",
        ".vwca-view-head-info strong{font-size:.9rem}",
        ".vwca-view-head-info span{font-size:.76rem;color:var(--color-muted);margin-left:.4rem}",
        ".vwca-msgs{flex:1;overflow-y:auto;min-height:0;padding:.9rem;display:flex;flex-direction:column;gap:.5rem;background:#f8f9fa}",
        ".vwca-msg{max-width:75%;padding:.55rem .8rem;border-radius:14px;font-size:.87rem;line-height:1.5;word-break:break-word}",
        ".vwca-msg--op{background:var(--color-primary);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}",
        ".vwca-msg--vis{background:#fff;color:#222;align-self:flex-start;border-bottom-left-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.07)}",
        ".vwca-msg-ts{font-size:.68rem;opacity:.6;margin-top:.2rem}",
        ".vwca-msg--op .vwca-msg-ts{text-align:right}",
        ".vwca-reply{padding:.65rem 1rem;border-top:1px solid var(--color-border);background:var(--color-surface);display:flex;gap:.4rem;align-items:flex-end;position:relative}",
        ".vwca-reply-inp{flex:1;border:1.5px solid var(--color-border);border-radius:10px;padding:.5rem .75rem;font:inherit;font-size:.87rem;resize:none;max-height:90px;outline:none;background:var(--color-bg);color:var(--color-text);transition:border-color .15s}",
        ".vwca-reply-inp:focus{border-color:var(--color-primary)}",
        ".vwca-reply-btn{background:var(--color-primary);color:#fff;border:0;border-radius:10px;padding:.5rem .9rem;cursor:pointer;font:inherit;font-size:.88rem;font-weight:600;flex-shrink:0;display:flex;align-items:center;gap:.35rem;transition:opacity .15s}",
        ".vwca-reply-btn:hover{opacity:.88}",
        ".vwca-reply-btn:disabled{opacity:.45;cursor:not-allowed}",
        ".vwca-emoji-picker{position:absolute;bottom:3.2rem;left:1rem;background:#fff;border:1px solid var(--color-border);border-radius:12px;padding:.5rem;display:none;grid-template-columns:repeat(6,1fr);gap:2px;box-shadow:0 4px 20px rgba(0,0,0,.15);z-index:10}",
        ".vwca-emoji-picker.is-open{display:grid}",
        ".vwca-emoji-btn{background:none;border:0;cursor:pointer;font-size:1.2rem;padding:.2rem;border-radius:6px;transition:background .1s}",
        ".vwca-emoji-btn:hover{background:var(--color-surface)}",
        ".vwca-status-btn{font-size:.75rem;padding:.25rem .65rem;border-radius:999px;border:1.5px solid var(--color-border);background:none;cursor:pointer;color:var(--color-muted);transition:background .12s,border-color .12s;white-space:nowrap}",
        ".vwca-status-btn:hover{background:var(--color-surface)}",
        ".vwca-status-btn.is-open{border-color:#2a7a2a;color:#2a7a2a}",
        ".vwca-status-btn.is-closed{border-color:var(--color-muted);color:var(--color-muted)}",
        ".vwca-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--color-muted);font-size:.9rem}",
        ".vwca-closed-notice{padding:.7rem 1rem;font-size:.82rem;color:var(--color-muted);background:color-mix(in srgb,var(--color-muted) 8%,transparent);border-top:1px solid var(--color-border);text-align:center}",
        "[data-theme='dark'] .vwca-msgs{background:#1a1d2e}",
        "[data-theme='dark'] .vwca-msg--vis{background:#252840;color:var(--color-text)}"
      ].join("");
      document.head.appendChild(s);
    }

    function buildUI() {
      convs = Chat.getConvs();
      var open   = convs.filter(function(c){return c.status==="open";});
      var closed = convs.filter(function(c){return c.status==="closed";});
      var totalUnread = Chat.totalUnread();

      var openHtml = open.map(function(c){ return convRow(c); }).join("") ||
        '<div style="padding:.8rem 1rem;font-size:.82rem;color:var(--color-muted)">Ingen opne samtalar.</div>';

      var closedHtml = closed.length
        ? '<div class="vwca-section-label">Lukka (' + closed.length + ')</div>' +
          closed.map(function(c){ return convRow(c, true); }).join("")
        : "";

      container.innerHTML =
        '<div class="vwca">' +
          '<div class="vwca-sidebar">' +
            '<div class="vwca-sidebar-head">' +
              '<h4>Samtalar' + (totalUnread ? ' <span style="font-weight:400;color:var(--color-muted)">(' + totalUnread + ' ulest)</span>' : '') + '</h4>' +
              '<button class="vwca-test-btn" id="vwca-test-btn">+ Test</button>' +
            '</div>' +
            '<div style="flex:1;overflow-y:auto">' +
              (open.length ? '<div class="vwca-section-label">Opne (' + open.length + ')</div>' : '') +
              openHtml + closedHtml +
            '</div>' +
          '</div>' +
          '<div class="vwca-view" id="vwca-view"></div>' +
        '</div>';

      /* Bind samtale-klikk */
      container.querySelectorAll("[data-conv]").forEach(function (el) {
        el.addEventListener("click", function () {
          activeId = el.getAttribute("data-conv");
          container._activeConvId = activeId;
          Chat.markRead(activeId);
          buildUI();
        });
      });

      /* Test-knapp */
      var testBtn = container.querySelector("#vwca-test-btn");
      if (testBtn) testBtn.addEventListener("click", function () {
        var names = ["Kari Nordmann","Ola Hansen","Per Olsen","Anna Berg","Lars Dahl","Mette Vik"];
        var msgs  = [
          "Hei! Eg lurer på prisane dykkar.",
          "Kan eg bestille time hos dykk?",
          "Har de ledig kapasitet neste veke?",
          "Korleis fungerer det å bestille via nettsida?",
          "Er de opne i helgane?",
          "Kva kostar det å kome i gang?"
        ];
        var n    = names[Math.floor(Math.random()*names.length)];
        var m    = msgs[Math.floor(Math.random()*msgs.length)];
        var conv = Chat.createConv(n, n.toLowerCase().replace(" ",".") + "@eksempel.no");
        Chat.addMsg(conv.id, m, "visitor");
        activeId = conv.id;
        container._activeConvId = activeId;
        buildUI();
      });

      renderView();
    }

    function convRow(c, isClosed) {
      return '<div class="vwca-conv' +
        (c.id === activeId ? " is-active" : "") +
        (isClosed ? " is-closed" : "") +
        '" data-conv="' + Chat.esc(c.id) + '">' +
        '<div class="vwca-conv__row">' +
          '<span class="vwca-conv__name">' + Chat.esc(c.name) + '</span>' +
          (c.unread && !isClosed ? '<span class="vwca-unread">'+c.unread+'</span>' : '') +
        '</div>' +
        (c.lastMsg ? '<div class="vwca-conv__preview">'+Chat.esc(c.lastMsg)+'</div>' : '') +
        '<div class="vwca-conv__ts">'+Chat.tsDate(c.lastAt)+'</div>' +
      '</div>';
    }

    function renderView() {
      var view = container.querySelector("#vwca-view");
      if (!view) return;

      if (!activeId || !Chat.getConv(activeId)) {
        view.innerHTML = '<div class="vwca-empty">Vel ein samtale til venstre</div>';
        return;
      }

      var conv = Chat.getConv(activeId);
      var msgs = Chat.getMsgs(activeId);
      var isClosed = conv.status === "closed";

      view.innerHTML =
        '<div class="vwca-view-head">' +
          '<div class="vwca-view-head-info">' +
            '<strong>' + Chat.esc(conv.name) + '</strong>' +
            (conv.email ? '<span>' + Chat.esc(conv.email) + '</span>' : '') +
          '</div>' +
          '<button class="vwca-status-btn ' + (isClosed ? 'is-closed' : 'is-open') + '" id="vwca-toggle-status">' +
            (isClosed ? '🔴 Lukka — Opne att' : '🟢 Open — Lukk samtale') +
          '</button>' +
        '</div>' +
        '<div class="vwca-msgs" id="vwca-msg-list">' +
          (msgs.length
            ? msgs.map(function(m){
                var cls = m.sender==="operator" ? "vwca-msg--op" : "vwca-msg--vis";
                return '<div class="vwca-msg '+cls+'">'+Chat.esc(m.text)+
                  '<div class="vwca-msg-ts">'+Chat.tsDate(m.at)+'</div></div>';
              }).join("")
            : '<div style="text-align:center;font-size:.82rem;color:var(--color-muted);margin:auto;padding:2rem">Ingen meldingar endå.</div>'
          ) +
        '</div>' +
        (isClosed
          ? '<div class="vwca-closed-notice">Samtalen er lukka — opne att for å svare.</div>'
          : '<div class="vwca-reply" id="vwca-reply">' +
              '<div class="vwca-emoji-picker" id="vwca-emoji"></div>' +
              '<button class="vw-icon-btn" id="vwca-emoji-btn" style="color:var(--color-muted);font-size:1.1rem">😊</button>' +
              '<textarea class="vwca-reply-inp" id="vwca-inp" rows="1" placeholder="Skriv svar…" maxlength="2000"></textarea>' +
              '<button class="vwca-reply-btn" id="vwca-send"><i class="ti ti-send"></i> Send</button>' +
            '</div>'
        );

      /* Scroll */
      var msgList = view.querySelector("#vwca-msg-list");
      if (msgList) msgList.scrollTop = msgList.scrollHeight;

      /* Toggle open/lukk */
      var toggleBtn = view.querySelector("#vwca-toggle-status");
      if (toggleBtn) toggleBtn.addEventListener("click", function () {
        var newStatus = conv.status === "closed" ? "open" : "closed";
        Chat.setStatus(activeId, newStatus);
        buildUI();
      });

      if (isClosed) return;

      /* Emoji */
      var emojiPicker = view.querySelector("#vwca-emoji");
      var emojiBtn    = view.querySelector("#vwca-emoji-btn");
      var inp         = view.querySelector("#vwca-inp");
      var sendBtn     = view.querySelector("#vwca-send");

      emojiPicker.innerHTML = EMOJIS.map(function(e){
        return '<button class="vwca-emoji-btn" data-e="'+e+'">'+e+'</button>';
      }).join("");
      emojiPicker.querySelectorAll("[data-e]").forEach(function(b){
        b.addEventListener("click",function(){
          inp.value += b.getAttribute("data-e");
          emojiPicker.classList.remove("is-open");
          inp.focus();
        });
      });
      emojiBtn.addEventListener("click", function(e){
        e.stopPropagation();
        emojiPicker.classList.toggle("is-open");
      });

      inp.addEventListener("input", function(){
        this.style.height="auto";
        this.style.height = Math.min(this.scrollHeight,90)+"px";
      });

      function doSend() {
        var txt = inp.value.trim();
        if (!txt) return;
        sendBtn.disabled = true;
        inp.value = ""; inp.style.height = "auto";
        Chat.addMsg(activeId, txt, "operator");
        Chat.markRead(activeId);
        renderView();
        sendBtn.disabled = false;
        if (inp) inp.focus();
      }
      sendBtn.addEventListener("click", doSend);
      inp.addEventListener("keydown", function(e){
        if (e.key==="Enter" && !e.shiftKey){ e.preventDefault(); doSend(); }
      });

      setTimeout(function(){ if(inp) inp.focus(); }, 50);
    }

    /* Poll */
    if (!container._pollId) {
      container._pollId = setInterval(function () {
        var fresh = Chat.getConvs();
        if (JSON.stringify(fresh) !== JSON.stringify(convs)) {
          convs = fresh;
          buildUI();
        } else if (activeId) {
          var msgs = Chat.getMsgs(activeId);
          var msgList = container.querySelector("#vwca-msg-list");
          if (msgList && msgList.children.length !== msgs.length) renderView();
        }
      }, OPT.pollInterval);
    }

    buildUI();
  }

  /* ── OPPSTART ── */
  function boot() { initWidget(); initAdmin(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }

})();
