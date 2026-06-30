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
  var _CHAT_NS = (window.SITE_CONFIG && window.SITE_CONFIG.storageKey) || "";

  /* Runtime config stored in localStorage — overstyrer config.js-verdiar */
  var _storedCfg = {};
  try {
    var _cfgKey = (_CHAT_NS ? _CHAT_NS + ":" : "") + "chat-config";
    _storedCfg = JSON.parse(localStorage.getItem(_cfgKey) || "{}") || {};
  } catch(e) {}

  var OPT = Object.assign({
    enabled:      true,
    position:     "right",
    color:        null,
    icon:         "💬",
    welcomeMsg:   "Hei! Korleis kan vi hjelpe deg?",
    offlineMsg:   "Vi er ikke tilgjengelig akkurat nå. Legg igjen en melding, så svarer vi så snart vi kan.",
    operatorName: "Oss",
    askName:      true,
    termsText:    "Eg godtek at denne samtalen lagrast",
    termsUrl:     "",
    pollInterval: 5000
  }, CFG_CHAT, _storedCfg);

  if (CFG_FEAT.chat === false) return; // heile modulen av — ingenting lastar

  function saveWidgetConfig(cfg) {
    try { localStorage.setItem(_cfgKey, JSON.stringify(Object.assign(_storedCfg, cfg))); } catch(e) {}
  }

  /* ── SUPABASE KLIENT ────────────────────────────────────────────────────── */
  var _sb            = (window.App && window.App.supabase) || null;
  var _adminHydrated = false;
  var _adminConvs    = [];
  var _heartbeatIv   = null; // setInterval handle for admin heartbeat
  var _wStarted      = false; // prevent double widget init

  function _startHeartbeat() {
    if (_heartbeatIv || !_sb) return;
    function hb() {
      _sb.from("store").upsert(
        {tenant_id: _CHAT_NS || "site", key: "chat-heartbeat", value: {ts: Date.now()}},
        {onConflict: "tenant_id,key"}
      );
    }
    hb();
    _heartbeatIv = setInterval(hb, 60000);
    window.addEventListener("beforeunload", _stopHeartbeat);
  }
  function _stopHeartbeat() {
    if (_heartbeatIv) { clearInterval(_heartbeatIv); _heartbeatIv = null; }
  }

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
        var key = _CHAT_NS ? _CHAT_NS + ":" + k : k;
        try { var v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : d; }
        catch (e) { return d; }
      },
      set: function (k, v) {
        var key = _CHAT_NS ? _CHAT_NS + ":" + k : k;
        try {
          if (v === null) { localStorage.removeItem(key); }
          else { localStorage.setItem(key, JSON.stringify(v)); }
        } catch (e) {}
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
      var vid  = Chat.getVid(); // generate/retrieve stable visitor token before any async
      var conv = {
        id: Chat.newId(), name: name||"Gjest", email: email||"",
        status: "open", unread: 0, lastMsg: "", lastAt: Date.now(), createdAt: Date.now()
      };
      if (!_sb) {
        // No Supabase: write to localStorage immediately and resolve
        var lc = Chat.getConvs(); lc.unshift(conv); Chat.setConvs(lc);
        return Promise.resolve(conv);
      }
      // Optimistic write so updateConv calls during the same tick work against local cache
      var lc2 = Chat.getConvs(); lc2.unshift(conv); Chat.setConvs(lc2);
      return _sb.from("chat_conversations").insert({
        id: conv.id, visitor_name: conv.name, visitor_email: conv.email,
        visitor_id: vid,
        status: "open", unread: 0, last_msg: "", last_at: conv.lastAt
      }).then(function(r) {
        if (r.error) {
          // Roll back optimistic write
          Chat.setConvs(Chat.getConvs().filter(function(c){return c.id!==conv.id;}));
          console.error("[chat] conv insert failed:", r.error.message, r.error);
          return Promise.reject(new Error(r.error.message));
        }
        return conv;
      });
    },

    updateConv: function (id, changes) {
      var convs = Chat.getConvs();
      var idx = convs.findIndex(function(c){return c.id===id;});
      if (idx > -1) { Object.assign(convs[idx], changes); Chat.setConvs(convs); }
      if (_sb) {
        var sb = {};
        if (changes.name !== undefined)          sb.visitor_name    = changes.name;
        if (changes.email !== undefined)         sb.visitor_email   = changes.email;
        if (changes.status !== undefined)        sb.status          = changes.status;
        // unread=0 er mark-as-read (admin-handling) — inkrement vert gjort av DB-triggaren
        if (changes.unread === 0)                sb.unread          = 0;
        // last_msg og last_at vert sett automatisk av triggaren _chat_conv_update_on_msg
        if (changes.pageUrl !== undefined)       sb.page_url        = changes.pageUrl;
        if (changes.referrer !== undefined)      sb.referrer        = changes.referrer;
        if (changes.language !== undefined)      sb.language        = changes.language;
        if (changes.browser !== undefined)       sb.browser         = changes.browser;
        if (changes.os !== undefined)            sb.os              = changes.os;
        if (changes.screen !== undefined)        sb.screen          = changes.screen;
        if (changes.visitorActive !== undefined) sb.visitor_active  = changes.visitorActive;
        if (changes.lastSeenAt !== undefined)    sb.last_seen_at    = changes.lastSeenAt;
        if (changes.visitorReadAt !== undefined) sb.visitor_read_at = changes.visitorReadAt;
        if (Object.keys(sb).length) _sb.from("chat_conversations").update(sb).eq("id", id);
      }
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
      if (!_sb) return Promise.resolve(msg);
      var _row = { id: msg.id, conversation_id: convId, text: msg.text, sender: msg.sender, at: msg.at };
      return _sb.from("chat_messages").insert(_row).then(function(r) {
        if (r.error) {
          // Roll back the optimistic message on failure
          var cur = Chat.getMsgs(convId).filter(function(m){return m.id!==msg.id;});
          Chat.setMsgs(convId, cur);
          console.error("[chat] msg insert failed:", r.error.message, r.error);
          return Promise.reject(new Error(r.error.message));
        }
        return msg;
      });
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
    },

    deleteConv: function (id) {
      Chat.store.set("chat:msgs:" + id, null);
      Chat.setConvs(Chat.getConvs().filter(function (c) { return c.id !== id; }));
      if (_sb) _sb.from("chat_conversations").delete().eq("id", id);
    },

    hydrateFromSupabase: function (cb) {
      if (!_sb) { if (cb) cb([]); return; }
      _sb.from("chat_conversations").select("*").order("last_at", { ascending: false })
        .then(function (r) {
          if (r.error || !r.data) { if (cb) cb(); return; }
          var convs = r.data.map(function (c) {
            return {
              id: c.id, name: c.visitor_name || "Gjest", email: c.visitor_email || "",
              status: c.status || "open", unread: c.unread || 0,
              lastMsg: c.last_msg || "",
              lastAt: c.last_at || new Date(c.created_at).getTime(),
              createdAt: new Date(c.created_at).getTime(),
              pageUrl: c.page_url || null, referrer: c.referrer || null,
              language: c.language || null, browser: c.browser || null,
              os: c.os || null, screen: c.screen || null,
              visitorActive: c.visitor_active || false,
              lastSeenAt: c.last_seen_at || null, visitorReadAt: c.visitor_read_at || null
            };
          });
          if (!r.data.length) { if (cb) cb(convs); return; }
          var ids = r.data.map(function (c) { return c.id; });
          _sb.from("chat_messages").select("*").in("conversation_id", ids)
            .order("at", { ascending: true })
            .then(function (mr) {
              if (!mr.error && mr.data) {
                var byConv = {};
                mr.data.forEach(function (m) {
                  var cid = m.conversation_id;
                  if (!byConv[cid]) byConv[cid] = [];
                  byConv[cid].push({
                    id: m.id, convId: cid, text: m.text, sender: m.sender,
                    at: m.at || new Date(m.created_at).getTime()
                  });
                });
                Object.keys(byConv).forEach(function (cid) { Chat.setMsgs(cid, byConv[cid]); });
              }
              if (cb) cb(convs);
            });
        });
    },

    resetVisitor: function () {
      var vid = Chat.store.get("chat:vid", null);
      if (vid) Chat.store.set("chat:myconv:" + vid, null);
      Chat.store.set("chat:vid",    null);
      Chat.store.set("chat:vname",  null);
      Chat.store.set("chat:vemail", null);
    },

    getAvailability: function () {
      var d = Chat.store.get("chat-availability", {online:false,since:0}) || {online:false,since:0};
      if (d.online && d.since && (Date.now()-d.since) > 8*3600*1000) {
        d.online = false; Chat.store.set("chat-availability", d);
      }
      return d;
    },
    setAvailability: function (online) {
      var val = {online:!!online, since:online?Date.now():0};
      if (!_sb) {
        Chat.store.set("chat-availability", val);
        return Promise.resolve(val);
      }
      return _sb.from("store").upsert(
        {tenant_id: _CHAT_NS || "site", key: "chat-availability", value: val},
        {onConflict: "tenant_id,key"}
      ).then(function(r) {
        if (r.error) return Promise.reject(new Error(r.error.message));
        Chat.store.set("chat-availability", val);
        return val;
      });
    }
  };

  /* ── CHAT → LEAD / STATUS-KOPLING ──────────────────────────────────────── */
  var _pendingConvId = null;

  function getLeadByChatId(convId) {
    var AppRef = window.App;
    if (!AppRef || !AppRef.getLeads) return null;
    return AppRef.getLeads().find(function (l) { return l.chatId === convId; }) || null;
  }

  function markLeadAsRead(convId) {
    var lead = getLeadByChatId(convId);
    if (lead && (lead.status || "ny") === "ny" && window.App && window.App.setLeadStatus) {
      window.App.setLeadStatus(lead.id, "lest");
    }
  }

  function markLeadAsNew(convId) {
    var lead = getLeadByChatId(convId);
    if (lead && window.App && window.App.setLeadStatus) {
      window.App.setLeadStatus(lead.id, "ny");
    }
  }

  function setLeadResolved(convId) {
    var lead = getLeadByChatId(convId);
    if (lead && window.App && window.App.setLeadStatus) {
      window.App.setLeadStatus(lead.id, "løst");
    }
  }

  function saveConvAsLead(convId) {
    // Fall back to in-memory _adminConvs when localStorage doesn't have this conv
    var conv = Chat.getConv(convId) || _adminConvs.find(function(c){return c.id===convId;});
    if (!conv) return;
    var AppRef = window.App;
    if (!AppRef || !AppRef.addLead) return;
    var msgs = Chat.getMsgs(convId);
    var lines = msgs.map(function (m) {
      var who = m.sender === "operator" ? (OPT.operatorName || "Oss") : (conv.name || "Gjest");
      return who + " kl." + Chat.ts(m.at) + ": " + m.text;
    });
    var transcript = "Chat-samtale\n\n" + (lines.length ? lines.join("\n") : "(ingen meldingar)");
    var existing = getLeadByChatId(convId);
    if (existing) {
      if (AppRef.updateLead) AppRef.updateLead(existing.id, { message: transcript });
    } else {
      AppRef.addLead({
        name:    conv.name  || "",
        email:   conv.email || "",
        message: transcript,
        source:  "chat",
        chatId:  convId
      });
      Chat.updateConv(convId, { leadSaved: true });
    }
  }

  function getBrowserInfo() {
    var ua = navigator.userAgent;
    var b = "Ukjent", os = "Ukjent";
    if (/Edg\//.test(ua)) b = "Edge";
    else if (/OPR\//.test(ua)) b = "Opera";
    else if (/Chrome\/[0-9]/.test(ua)) b = "Chrome";
    else if (/Firefox\//.test(ua)) b = "Firefox";
    else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) b = "Safari";
    if (/iPhone/.test(ua)) os = "iPhone";
    else if (/iPad/.test(ua)) os = "iPad";
    else if (/Android/.test(ua)) os = "Android";
    else if (/Windows/.test(ua)) os = "Windows";
    else if (/Mac OS X/.test(ua)) os = "macOS";
    else if (/Linux/.test(ua)) os = "Linux";
    return { browser: b, os: os };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     A)  WIDGET
  ══════════════════════════════════════════════════════════════════════════ */
  function initWidget() {
    if (_wStarted) return;
    if (!OPT.enabled) return;
    if (document.getElementById("admin-modal-root")) return;
    if (document.getElementById("intranet")) return;
    _wStarted = true;

    var color    = OPT.color ||
      getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim() || "#1a6e5a";
    var btnColor = OPT.btnColor || color;
    var pos      = OPT.position === "left" ? "left:1.2rem;right:auto" : "right:1.2rem;left:auto";

    var style = document.createElement("style");
    style.textContent = [
      "#vw-btn{position:fixed;bottom:1.4rem;"+pos+";z-index:9990;width:54px;height:54px;",
        "border-radius:50%;background:"+btnColor+";border:0;cursor:pointer;",
        "box-shadow:0 4px 18px rgba(0,0,0,.25);display:flex;align-items:center;",
        "justify-content:center;transition:transform .18s,box-shadow .18s;color:#fff;font-size:1.5rem}",
      "#vw-btn:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(0,0,0,.3)}",
      "#vw-btn.is-online::after{content:'';position:absolute;bottom:3px;right:3px;width:11px;height:11px;background:#22c55e;border-radius:50%;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25)}",
      "#vw-badge{position:absolute;top:-2px;right:-2px;background:#e74c3c;color:#fff;",
        "border-radius:999px;font-size:.68rem;font-weight:700;padding:.1rem .38rem;",
        "min-width:18px;text-align:center;display:none}",
      "@keyframes vw-pulse{0%,100%{transform:scale(1);box-shadow:0 4px 16px rgba(0,0,0,.22)}50%{transform:scale(1.08);box-shadow:0 6px 28px rgba(0,0,0,.38)}}",
      "#vw-btn.has-unread{animation:vw-pulse 1.8s ease-in-out infinite}",
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
    btn.innerHTML = vwBtnIcon(); // vwBtnIcon er function declaration — vert hoist

    var panel = document.createElement("div");
    panel.id  = "vw-panel";
    panel.innerHTML =
      '<div class="vw-head">' +
        '<button class="vw-head-btn" id="vw-min-btn" title="Minimer">—</button>' +
        '<i class="ti ti-message-circle" style="font-size:1.3rem;flex-shrink:0"></i>' +
        '<div class="vw-head-info">' +
          '<div class="vw-head-name">' + Chat.esc(OPT.operatorName) + '</div>' +
          '<div class="vw-head-sub">Svar vanlegvis snart</div>' +
        '</div>' +
        '<button class="vw-head-btn" id="vw-end-btn" title="Avslutt samtale" style="display:none">✕</button>' +
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
    var lastReadAt = convId ? ((Chat.getConv(convId) || {}).visitorReadAt || 0) : 0;
    var vname   = Chat.getVname();
    var vemail  = Chat.getVemail();

    /* ── RENDER ── */
    function render() {
      var avail = Chat.getAvailability();
      btn.classList.toggle("is-online", avail.online);
      var headSub = panel.querySelector(".vw-head-sub");
      if (headSub) headSub.textContent = avail.online ? "Vi er tilgjengelig nå" : "Legg igjen en melding";

      var conv = convId ? Chat.getConv(convId) : null;
      var endBtn = document.getElementById("vw-end-btn");
      if (endBtn) endBtn.style.display = (conv && conv.status === "open" && avail.online) ? "" : "none";
      /* Reset flex-overrides from renderStartForm / renderOfflineForm */
      msgsEl.style.flex = "";
      msgsEl.style.overflowY = "";
      msgsEl.style.display = "";
      bottom.style.flex = "";
      bottom.style.overflowY = "";
      msgsEl.innerHTML = "";
      bottom.innerHTML = "";

      if (!avail.online && (!convId || !conv || conv.status !== "open")) {
        renderOfflineForm();
        return;
      }

      if (!convId || !conv) {
        renderStartForm();
        return;
      }

      var msgs = Chat.getMsgs(convId);
      var welcome = document.createElement("div");
      welcome.className = "vw-msg vw-msg--op";
      welcome.innerHTML = Chat.esc(OPT.welcomeMsg) +
        '<div class="vw-msg-ts">' + Chat.ts(conv.createdAt || Date.now()) + '</div>';
      msgsEl.appendChild(welcome);
      msgs.forEach(function (m) {
        if (m.sender === "system") return;
        var d = document.createElement("div");
        d.className = "vw-msg " + (m.sender==="operator" ? "vw-msg--op" : "vw-msg--vis");
        d.innerHTML = Chat.esc(m.text) + '<div class="vw-msg-ts">' + Chat.ts(m.at) + '</div>';
        msgsEl.appendChild(d);
      });
      if (msgs.length) msgsEl.scrollTop = msgsEl.scrollHeight;

      if (conv.status === "closed") {
        bottom.innerHTML =
          '<div class="vw-closed-banner">Samtalen er avslutta.' +
          ' <a href="#" id="vw-reopen" style="color:'+color+'">Opne att</a>' +
          ' &nbsp;·&nbsp; <a href="#" id="vw-reset" style="font-size:.85em;color:#aaa">Nullstill</a>' +
          '</div>';
        bottom.querySelector("#vw-reopen").addEventListener("click", function (e) {
          e.preventDefault();
          Chat.setStatus(convId, "open");
          markLeadAsNew(convId);
          render();
        });
        bottom.querySelector("#vw-reset").addEventListener("click", function (e) {
          e.preventDefault();
          if (!confirm("Slett lokal samtalehistorikk og start på nytt?\nSamtalen er allereie lagra hjå oss.")) return;
          Chat.resetVisitor();
          convId = null;
          vname  = "";
          vemail = "";
          render();
        });
      } else {
        renderInputArea();
      }
    }

    function renderStartForm() {
      /* La forma ta all tilgjengeleg plass — velkomstboble vert liten */
      msgsEl.style.flex = "0 0 auto";
      msgsEl.style.overflowY = "hidden";
      bottom.style.flex = "1";
      bottom.style.overflowY = "auto";
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

        startBtn.disabled = true;
        startBtn.textContent = "Kobler til…";

        Chat.createConv(vname, vemail).then(function(conv) {
          convId = conv.id;
          Chat.setMyConv(convId);
          var _bi = getBrowserInfo();
          Chat.updateConv(convId, {
            pageUrl:       location.href,
            referrer:      document.referrer || null,
            language:      navigator.language || null,
            browser:       _bi.browser,
            os:            _bi.os,
            screen:        screen.width + "×" + screen.height,
            visitorActive: true,
            lastSeenAt:    Date.now()
          });
          render();
        }, function(err) {
          console.error("[chat] createConv failed:", err.message);
          startBtn.textContent = "Start samtale";
          checkReady(); // restores disabled state based on field validity
          var form = bottom.querySelector(".vw-start-form");
          var errEl = bottom.querySelector("#vw-start-err");
          if (!errEl && form) {
            errEl = document.createElement("div");
            errEl.id = "vw-start-err";
            errEl.style.cssText = "color:#ef4444;font-size:.78rem;text-align:center;margin:.3rem 0";
            form.insertBefore(errEl, startBtn);
          }
          if (errEl) {
            errEl.textContent = "Klarte ikkje å starte samtalen. Prøv igjen.";
            setTimeout(function(){ if(errEl) errEl.textContent = ""; }, 6000);
          }
        });
      });
    }

    function renderOfflineForm() {
      msgsEl.style.display = "none";
      bottom.style.flex = "1";
      bottom.style.overflowY = "auto";
      bottom.innerHTML =
        '<div class="vw-start-form">' +
          '<p style="font-size:.82rem;color:#555;margin:0 0 .3rem">'+Chat.esc(OPT.offlineMsg)+'</p>' +
          (OPT.askName
            ? '<div class="vw-field"><label>Navn (valgfritt)</label><input id="vw-off-name" type="text" placeholder="Ditt navn…" maxlength="60"></div>'
            : '') +
          '<div class="vw-field"><label>E-post *</label><input id="vw-off-email" type="email" placeholder="din@epost.no" maxlength="120"></div>' +
          '<div class="vw-field"><label>Melding *</label><textarea id="vw-off-msg" rows="3" placeholder="Skriv din melding…" maxlength="1000" style="width:100%;font:inherit;font-size:.88rem;border:1.5px solid #ddd;border-radius:8px;padding:.5rem .65rem;resize:vertical;box-sizing:border-box;outline:none"></textarea></div>' +
          '<button id="vw-off-send" class="vw-start-btn" disabled>Send melding</button>' +
        '</div>';

      var nameInp  = bottom.querySelector("#vw-off-name");
      var emailInp = bottom.querySelector("#vw-off-email");
      var msgInp   = bottom.querySelector("#vw-off-msg");
      var sendBtn  = bottom.querySelector("#vw-off-send");

      function checkReady() {
        var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((emailInp.value||"").trim());
        sendBtn.disabled = !(emailOk && (msgInp.value||"").trim().length > 0);
      }
      emailInp.addEventListener("input", checkReady);
      msgInp.addEventListener("input", checkReady);

      sendBtn.addEventListener("click", function () {
        var name  = nameInp ? nameInp.value.trim() : "";
        var email = emailInp.value.trim();
        var msg   = msgInp.value.trim();
        sendBtn.disabled = true; sendBtn.textContent = "Sender…";
        function showSuccess() {
          msgsEl.style.display = "";
          msgsEl.innerHTML =
            '<div class="vw-msg vw-msg--op">Takk! Vi har mottatt meldingen din og svarer så snart vi kan.' +
              '<div class="vw-msg-ts">'+Chat.ts(Date.now())+'</div>' +
            '</div>';
          bottom.innerHTML = "";
          bottom.style.flex = ""; bottom.style.overflowY = "";
        }
        function fallback() {
          var AppRef = window.App;
          if (AppRef && AppRef.addLead) AppRef.addLead({ name:name||email, email:email, message:msg, source:"chat-offline" });
          showSuccess();
        }
        if (_sb) {
          Chat.createConv(name||email, email).then(function(conv) {
            return _sb.from("chat_messages").insert({
              id: Chat.newId(), conversation_id: conv.id,
              text: msg, sender: "visitor", at: Date.now()
            });
          }).then(function(r) {
            if (r && r.error) {
              console.error("[chat] offline msg insert failed:", r.error.message, r.error);
              fallback();
            } else {
              showSuccess();
            }
          }).catch(function(err) {
            console.error("[chat] offline form failed:", err.message);
            fallback();
          });
        } else {
          fallback();
        }
      });
    }

    function renderInputArea() {
      bottom.innerHTML =
        '<div class="vw-input-area">' +
          '<div class="vw-emoji-picker" id="vw-emoji"></div>' +
          '<button class="vw-icon-btn" id="vw-emoji-btn" title="Emoji">😊</button>' +
          '<textarea class="vw-inp" id="vw-inp" rows="1" placeholder="Skriv en melding…" maxlength="1000"></textarea>' +
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
        sendBtn.disabled = true;
        inp.value = ""; inp.style.height = "auto";
        Chat.addMsg(convId, txt, "visitor").then(function() {
          render();
        }, function(err) {
          console.warn("[chat] visitor send failed:", err.message);
          var errEl = document.getElementById("vw-send-err");
          if (!errEl) {
            errEl = document.createElement("div");
            errEl.id = "vw-send-err";
            errEl.style.cssText = "color:#ef4444;font-size:.75rem;text-align:center;padding:.2rem 0";
            var replyEl = document.getElementById("vw-reply");
            if (replyEl) replyEl.insertBefore(errEl, replyEl.firstChild);
          }
          errEl.textContent = "Sending mislyktes. Prøv igjen.";
          inp.value = txt; // restore for retry
          setTimeout(function(){if(errEl)errEl.textContent="";},4000);
        }).finally(function() {
          sendBtn.disabled = false;
          if (inp) inp.focus();
        });
      }
      sendBtn.addEventListener("click", doSend);
      inp.addEventListener("keydown", function (e) {
        if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
      });
      setTimeout(function () { if (inp) inp.focus(); }, 50);
    }

    /* ── TAB-TITTEL VARSLING ── */
    var _origTitle = document.title;
    var _titleBlink = null;
    function startTitleNotify() {
      if (_titleBlink) return;
      var alt = false;
      var msg = (OPT.operatorName || "Oss") + " har svart…";
      _titleBlink = setInterval(function () {
        document.title = alt ? _origTitle : "● " + msg;
        alt = !alt;
      }, 1400);
    }
    function stopTitleNotify() {
      if (_titleBlink) { clearInterval(_titleBlink); _titleBlink = null; }
      document.title = _origTitle;
    }
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) stopTitleNotify();
    });

    /* ── BADGE / POLL ── */
    var lastMsgCount = 0;

    function showUnreadBadge(unread) {
      badge = document.getElementById("vw-badge");
      if (badge) { badge.textContent = String(unread); badge.style.display = ""; }
      btn.classList.add("has-unread");
      startTitleNotify();
    }

    // Realtime requires anon SELECT on chat_messages which we intentionally don't grant.
    // Visitor message delivery is handled by the poll below using get_visitor_msgs RPC.

    /* Hent admin-tilgjengelegheit og heartbeat frå Supabase.
       Heartbeat > 5 min gammalt betyr at admin-fana er stengd — vis offline. */
    if (_sb) {
      var ns = _CHAT_NS || "site";
      Promise.all([
        _sb.from("store").select("value").eq("tenant_id", ns).eq("key", "chat-availability").maybeSingle(),
        _sb.from("store").select("value").eq("tenant_id", ns).eq("key", "chat-heartbeat").maybeSingle()
      ]).then(function(results) {
        var rAvail = results[0], rHb = results[1];
        var val = (rAvail.data && !rAvail.error) ? rAvail.data.value : null;
        var hb  = (rHb.data   && !rHb.error)    ? rHb.data.value   : null;
        var heartbeatFresh = hb && hb.ts && (Date.now() - hb.ts < 5 * 60 * 1000);
        var online = !!(val && val.online && heartbeatFresh);
        if (val && val.online) val = { online: online, since: Date.now() };
        if (val) Chat.store.set("chat-availability", val);
        btn.classList.toggle("is-online", online);
        if (isOpen) render();
      });
    }

    function pollVisitorMsgs() {
      if (!convId) return;
      if (_sb) {
        var local = Chat.getMsgs(convId);
        // Always fetch all messages (p_after_at=0) and deduplicate by id client-side.
        // This avoids clock-skew between visitor and admin producing a cursor (client at)
        // that permanently hides messages the server has already stored.
        _sb.rpc("get_visitor_msgs", {
          p_visitor_id: Chat.getVid(),
          p_conv_id:    convId,
          p_after_at:   0
        }).then(function (res) {
          if (res.error) {
            console.error("[chat] get_visitor_msgs RPC failed:", res.error.message, res.error);
            return;
          }
          if (!res.data || !res.data.length) return;
          var knownIds = {};
          local.forEach(function(m){ knownIds[m.id] = true; });
          var changed = false;
          res.data.forEach(function (m) {
            if (!knownIds[m.id]) {
              local.push({ id: m.id, convId: convId, text: m.text, sender: m.sender,
                          at: m.at || new Date(m.created_at).getTime() });
              changed = true;
            }
          });
          if (!changed) return;
          Chat.setMsgs(convId, local);
          lastMsgCount = local.length;
          if (isOpen) { render(); }
          else {
            var unread = local.filter(function (m) { return m.sender === "operator" && m.at > lastReadAt; }).length;
            if (unread > 0) showUnreadBadge(unread);
          }
        });
      } else {
        var msgs = Chat.getMsgs(convId);
        if (msgs.length !== lastMsgCount) {
          lastMsgCount = msgs.length;
          if (isOpen) { render(); }
          else {
            var unread = msgs.filter(function (m) { return m.sender === "operator" && m.at > lastReadAt; }).length;
            if (unread > 0) showUnreadBadge(unread);
          }
        }
      }
    }
    pollVisitorMsgs();
    setInterval(pollVisitorMsgs, OPT.pollInterval);

    /* ── PRESENCE TRACKING ── */
    document.addEventListener("visibilitychange", function () {
      if (!convId) return;
      Chat.updateConv(convId, { lastSeenAt: Date.now(), visitorActive: !document.hidden });
    });
    window.addEventListener("pagehide", function () {
      if (convId) Chat.updateConv(convId, { lastSeenAt: Date.now(), visitorActive: false });
    });
    setInterval(function () {
      if (convId && !document.hidden) Chat.updateConv(convId, { lastSeenAt: Date.now(), visitorActive: true });
    }, 30000);

    function vwBtnIcon() {
      return OPT.iconUrl
        ? '<img src="'+OPT.iconUrl+'" style="width:46px;height:46px;border-radius:50%;object-fit:cover;display:block;pointer-events:none"><span id="vw-badge"></span>'
        : Chat.esc(OPT.icon || "💬") + "<span id=\"vw-badge\"></span>";
    }

    /* ── TOGGLE ── */
    function openPanel() {
      isOpen = true;
      lastReadAt = Date.now();
      panel.classList.add("is-open");
      btn.innerHTML = "✕<span id=\"vw-badge\"></span>";
      badge = document.getElementById("vw-badge");
      badge.style.display = "none";
      btn.classList.remove("has-unread");
      stopTitleNotify();
      if (convId) Chat.updateConv(convId, { lastSeenAt: Date.now(), visitorActive: true, visitorReadAt: lastReadAt });
      render();
    }
    function closePanel() {
      isOpen = false;
      panel.classList.remove("is-open");
      btn.innerHTML = vwBtnIcon();
      badge = document.getElementById("vw-badge");
      if (convId && Chat.getMsgs(convId).length > 0) {
        Chat.addMsg(convId, "Kunden lukket chatvinduet.", "system");
      }
    }

    btn.addEventListener("click", function () { isOpen ? closePanel() : openPanel(); });
    panel.querySelector("#vw-min-btn").addEventListener("click", closePanel);
    panel.querySelector("#vw-end-btn").addEventListener("click", function () {
      if (!convId || !Chat.getConv(convId)) return;
      saveConvAsLead(convId);
      setLeadResolved(convId);
      Chat.setStatus(convId, "closed");
      render();
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     B)  ADMIN
  ══════════════════════════════════════════════════════════════════════════ */
  function initAdmin() {
    window.VwChat      = Chat;
    window.VwChatAdmin = {
      render:   renderAdmin,
      openConv: function (chatId) { _pendingConvId = chatId; }
    };

    if (window.Intranet && typeof window.Intranet.registerModule === "function") {
      window.Intranet.registerModule({
        id:       "chat",
        navLabel: "Chat",
        icon:     "message-circle",
        order:    43,
        render:   function () { return '<div data-chat-adm-root></div>'; },
        mount:    function (outlet) {
          var root = outlet.querySelector("[data-chat-adm-root]") || outlet;
          renderAdmin(root);
        }
      });
    }
  }

  function visitorStatusHtml(conv) {
    if (!conv || !conv.lastSeenAt) return '<span class="vwca-vis-away">Ukjent</span>';
    if (conv.visitorActive) return '<span class="vwca-vis-active">● Aktiv nå</span>';
    var mins = Math.round((Date.now() - conv.lastSeenAt) / 60000);
    if (mins < 1) return '<span class="vwca-vis-away">Nettopp aktiv</span>';
    if (mins < 60) return '<span class="vwca-vis-away">Forlot for ' + mins + ' min siden</span>';
    return '<span class="vwca-vis-away">Forlot for ' + Math.round(mins / 60) + ' t siden</span>';
  }

  function findCrmCustomer(email) {
    if (!email) return null;
    var key = _CHAT_NS ? _CHAT_NS + ":crm-customers" : "crm-customers";
    try { return (JSON.parse(localStorage.getItem(key) || "[]") || []).find(function(c){ return (c.email||"").toLowerCase() === email.toLowerCase(); }) || null; }
    catch(e) { return null; }
  }

  function buildInfoPanelHtml(conv) {
    var crmC = findCrmCustomer(conv.email);
    var shortUrl = conv.pageUrl ? conv.pageUrl.replace(/^https?:\/\/[^/]+/, "").slice(0, 45) || "/" : null;
    var rows = [
      ["Status",   visitorStatusHtml(conv)],
      ["Startet",  Chat.tsDate(conv.createdAt)]
    ];
    if (conv.browser || conv.os) rows.push(["Enhet", Chat.esc([conv.browser, conv.os].filter(Boolean).join(" / "))]);
    if (conv.screen) rows.push(["Skjerm", Chat.esc(conv.screen)]);
    if (conv.language) rows.push(["Språk", Chat.esc(conv.language)]);
    if (shortUrl) rows.push(["Side", '<a href="'+Chat.esc(conv.pageUrl)+'" target="_blank" rel="noopener" title="'+Chat.esc(conv.pageUrl)+'" style="color:var(--color-primary)">'+Chat.esc(shortUrl)+'</a>']);
    if (conv.referrer) {
      var shortRef = conv.referrer.replace(/^https?:\/\//, "").slice(0, 40);
      rows.push(["Kom fra", '<span title="'+Chat.esc(conv.referrer)+'">'+Chat.esc(shortRef)+'</span>']);
    }
    var crmHtml = crmC
      ? '<button class="vwca-crm-open-btn" data-crm-open="'+Chat.esc(crmC.id)+'" style="margin-top:.5rem;width:100%;padding:.3rem;border:1.5px solid var(--color-primary);border-radius:8px;background:color-mix(in srgb,var(--color-primary) 8%,transparent);color:var(--color-primary);font:inherit;font-size:.78rem;font-weight:600;cursor:pointer">Åpne Kundekort</button>'
      : '';
    return '<div style="margin-bottom:.45rem"><strong style="font-size:.85rem">'+Chat.esc(conv.name)+'</strong>' +
      (conv.email ? ' <span style="font-size:.75rem;color:var(--color-muted)">'+Chat.esc(conv.email)+'</span>' : '') + '</div>' +
      rows.map(function(r){ return '<div class="vwca-info-row"><span class="vwca-info-key">'+r[0]+'</span><span class="vwca-info-val">'+r[1]+'</span></div>'; }).join("") +
      crmHtml;
  }

  function getCrmSnippets() {
    var key = _CHAT_NS ? _CHAT_NS + ":crm-settings" : "crm-settings";
    try { var raw=localStorage.getItem(key); return (raw?JSON.parse(raw):{}).snippets||[]; } catch(e){ return []; }
  }

  function insertAtCursor(inp, text) {
    var s = inp.selectionStart != null ? inp.selectionStart : inp.value.length;
    var e = inp.selectionEnd   != null ? inp.selectionEnd   : inp.value.length;
    inp.value = inp.value.slice(0, s) + text + inp.value.slice(e);
    inp.selectionStart = inp.selectionEnd = s + text.length;
  }

  function expandSnippetVars(text, vars) {
    if (!vars || !text) return text;
    return text.replace(/\{(\w+)\}/g, function (_, key) {
      return vars[key] !== undefined ? vars[key] : "{" + key + "}";
    });
  }

  // getVars: optional fn → {namn, epost, firma, …} for variabelsubstitusjon i snippet-body
  function bindSnippetAutocomplete(inp, replyEl, doSend, getVars) {
    var dd = null;

    function closeDd() { if(dd&&dd.parentNode){dd.parentNode.removeChild(dd);} dd=null; }

    function openDd(matches) {
      closeDd();
      if (!matches.length) return;
      dd = document.createElement("div");
      dd.className = "vwca-snippet-dd";
      matches.forEach(function(s){
        var item = document.createElement("div");
        item.className = "vwca-snippet-item";
        item.innerHTML = '<span class="vwca-snippet-code">#'+Chat.esc(s.shortcode)+'</span>'+Chat.esc(s.title);
        item.addEventListener("mousedown",function(e){
          e.preventDefault();
          insertSnippet(s);
        });
        dd.appendChild(item);
      });
      replyEl.appendChild(dd);
    }

    function insertSnippet(s) {
      var body = expandSnippetVars(s.body, getVars ? getVars() : null);
      var val=inp.value, hashIdx=val.lastIndexOf("#");
      if (hashIdx !== -1) {
        inp.value = val.slice(0, hashIdx) + body;
        inp.selectionStart = inp.selectionEnd = hashIdx + body.length;
      } else {
        insertAtCursor(inp, body);
      }
      closeDd(); inp.focus();
      inp.style.height="auto"; inp.style.height=Math.min(inp.scrollHeight,90)+"px";
    }

    function getMatches() {
      var val=inp.value, hashIdx=val.lastIndexOf("#"); if(hashIdx===-1) return [];
      var after=val.slice(hashIdx+1);
      if (after.indexOf(" ")!==-1||after.indexOf("\n")!==-1) return [];
      var q=after.toLowerCase(), snps=getCrmSnippets();
      return snps.filter(function(s){ return !q||s.shortcode.toLowerCase().indexOf(q)===0; });
    }

    inp.addEventListener("input",function(){
      var m=getMatches(); if(m.length) openDd(m); else closeDd();
    });

    inp.addEventListener("blur",function(){ setTimeout(closeDd,160); });

    inp.addEventListener("keydown",function(e){
      if (dd) {
        var items=dd.querySelectorAll(".vwca-snippet-item");
        var focused=dd.querySelector(".vwca-snippet-item.is-focused");
        var idx=focused?[].indexOf.call(items,focused):-1;
        if (e.key==="ArrowDown"){e.preventDefault();if(focused)focused.classList.remove("is-focused");var n2=items[idx+1]||items[0];if(n2)n2.classList.add("is-focused");return;}
        if (e.key==="ArrowUp"){e.preventDefault();if(focused)focused.classList.remove("is-focused");var p2=items[idx-1]||items[items.length-1];if(p2)p2.classList.add("is-focused");return;}
        if (e.key==="Enter"&&focused){e.preventDefault();var m2=getMatches();if(m2[idx])insertSnippet(m2[idx]);return;}
        if (e.key==="Escape"){closeDd();return;}
      }
      if (e.key==="Enter"&&!e.shiftKey){e.preventDefault();closeDd();doSend();}
    });

    return {
      trigger: function () { openDd(getCrmSnippets()); inp.focus(); }
    };
  }

  function renderAdmin(container) {
    var convs    = _adminConvs.slice();
    var activeId;
    if (_pendingConvId) {
      activeId = _pendingConvId;
      container._activeConvId = _pendingConvId;
      _pendingConvId = null;
      Chat.markRead(activeId);
      markLeadAsRead(activeId);
    } else {
      activeId = container._activeConvId || (convs.filter(function(c){return c.status==="open";})[0]||{}).id || null;
    }

    if (!document.getElementById("vwca-css")) {
      var s = document.createElement("style");
      s.id  = "vwca-css";
      var _h = document.getElementById("intranet") ? "clamp(520px,calc(100vh - 130px),860px)" : "580px";
      s.textContent = [
        ".vwca{display:grid;grid-template-columns:290px 1fr;height:"+_h+";border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden}",
        ".vwca-sidebar{border-right:1px solid var(--color-border);display:flex;flex-direction:column;background:color-mix(in srgb,var(--color-primary) 3%,var(--color-bg));overflow:hidden}",
        ".vwca-sidebar-head{padding:.7rem 1rem;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:.5rem;background:color-mix(in srgb,var(--color-primary) 5%,var(--color-bg))}",
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
        ".vwca-view-head{padding:.7rem 1rem;border-bottom:2px solid color-mix(in srgb,var(--color-primary) 30%,var(--color-border));display:flex;align-items:center;gap:.6rem;background:color-mix(in srgb,var(--color-primary) 4%,var(--color-bg))}",
        ".vwca-view-head-info{flex:1}",
        ".vwca-view-head-info strong{font-size:.9rem}",
        ".vwca-view-head-info span{font-size:.76rem;color:var(--color-muted);margin-left:.4rem}",
        ".vwca-msgs{flex:1;overflow-y:auto;min-height:0;padding:.9rem;display:flex;flex-direction:column;gap:.5rem;background:color-mix(in srgb,var(--color-primary) 4%,#f8f9fa)}",
        ".vwca-msg{max-width:75%;padding:.55rem .8rem;border-radius:14px;font-size:.87rem;line-height:1.5;word-break:break-word}",
        ".vwca-msg--op{background:var(--color-primary);color:#fff;align-self:flex-end;border-bottom-right-radius:4px;box-shadow:0 2px 8px color-mix(in srgb,var(--color-primary) 35%,transparent)}",
        ".vwca-msg--vis{background:#fff;color:#222;align-self:flex-start;border-bottom-left-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.09),0 0 0 1px rgba(0,0,0,.04)}",
        ".vwca-msg--sys{background:none;color:var(--color-muted);align-self:stretch;text-align:center;font-size:.72rem;font-style:italic;box-shadow:none;padding:.2rem;max-width:100%;border-radius:0}",
        ".vwca-msg-ts{font-size:.68rem;opacity:.6;margin-top:.2rem}",
        ".vwca-msg--op .vwca-msg-ts{text-align:right}",
        ".vwca-reply{padding:.65rem 1rem;border-top:1px solid var(--color-border);background:var(--color-surface);display:flex;gap:.4rem;align-items:flex-end;position:relative}",
        ".vwca-reply-inp{flex:1;border:1.5px solid var(--color-border);border-radius:10px;padding:.5rem .75rem;font:inherit;font-size:.87rem;resize:none;min-height:68px;max-height:160px;outline:none;background:var(--color-bg);color:var(--color-text);transition:border-color .15s}",
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
        ".vwca-avail-btn{font-size:.75rem;padding:.25rem .65rem;border-radius:999px;border:1.5px solid;background:none;cursor:pointer;font:inherit;font-weight:600;transition:all .15s;white-space:nowrap;display:flex;align-items:center;gap:.3rem}",
        ".vwca-avail-btn.is-online{border-color:#2a7a2a;color:#2a7a2a;background:color-mix(in srgb,#2a7a2a 7%,transparent)}",
        ".vwca-avail-btn.is-online:hover{background:color-mix(in srgb,#2a7a2a 13%,transparent)}",
        ".vwca-avail-btn:not(.is-online){border-color:var(--color-muted);color:var(--color-muted)}",
        ".vwca-avail-btn:not(.is-online):hover{background:var(--color-surface)}",
        ".vwca-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--color-muted);font-size:.9rem}",
        ".vwca-closed-notice{padding:.7rem 1rem;font-size:.82rem;color:var(--color-muted);background:color-mix(in srgb,var(--color-muted) 8%,transparent);border-top:1px solid var(--color-border);text-align:center}",
        ".vwca-info-btn{background:none;border:1.5px solid var(--color-border);border-radius:6px;padding:.2rem .55rem;cursor:pointer;font-size:.75rem;color:var(--color-muted);transition:all .12s;white-space:nowrap}",
        ".vwca-info-btn.is-active{border-color:var(--color-primary);color:var(--color-primary);background:color-mix(in srgb,var(--color-primary) 8%,transparent)}",
        ".vwca-info-panel{border-bottom:1px solid var(--color-border);padding:.6rem 1rem;background:color-mix(in srgb,var(--color-primary) 3%,var(--color-bg));font-size:.82rem}",
        ".vwca-info-row{display:flex;justify-content:space-between;align-items:center;padding:.18rem 0;gap:.5rem;border-bottom:1px solid color-mix(in srgb,var(--color-border) 50%,transparent)}",
        ".vwca-info-row:last-child{border-bottom:0}",
        ".vwca-info-key{color:var(--color-muted);font-size:.74rem;flex-shrink:0}",
        ".vwca-info-val{font-size:.8rem;font-weight:500;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%}",
        ".vwca-vis-active{color:#22c55e;font-weight:600}",
        ".vwca-vis-away{color:var(--color-muted)}",
        ".vwca-closed-group{border-top:1px solid var(--color-border)}",
        ".vwca-closed-group>summary{list-style:none;cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;padding:.45rem 1rem .3rem;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-muted)}",
        ".vwca-closed-group>summary::-webkit-details-marker{display:none}",
        ".vwca-closed-group>summary::after{content:'▶';font-size:.6rem;transition:transform .18s}",
        ".vwca-closed-group[open]>summary::after{transform:rotate(90deg)}",
        ".vwca-closed-group>summary:hover{color:var(--color-text)}",
        "[data-theme='dark'] .vwca-msgs{background:#1a1d2e}",
        "[data-theme='dark'] .vwca-msg--vis{background:#252840;color:var(--color-text)}",
        ".vwca-snippet-dd{position:absolute;bottom:calc(100% + 6px);left:0;right:0;background:var(--color-surface,#fff);border:1px solid var(--color-border);border-radius:10px;max-height:180px;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,.13);z-index:30}",
        ".vwca-snippet-item{padding:.5rem .8rem;cursor:pointer;border-bottom:1px solid var(--color-border);font-size:.85rem;line-height:1.35}",
        ".vwca-snippet-item:last-child{border-bottom:0}",
        ".vwca-snippet-item:hover,.vwca-snippet-item.is-focused{background:color-mix(in srgb,var(--color-primary,#2980B9) 8%,transparent)}",
        ".vwca-snippet-code{font-weight:700;color:var(--color-primary,#2980B9);margin-right:.3rem}",
        /* Innstillingar: CSS-toggle */
        ".cfg-toggle{position:relative;display:inline-block;width:50px;height:28px;cursor:pointer;flex-shrink:0}",
        ".cfg-toggle input{opacity:0;width:0;height:0;position:absolute}",
        ".cfg-toggle-track{position:absolute;inset:0;background:var(--color-border);border-radius:999px;transition:.25s}",
        ".cfg-toggle-track::before{content:'';position:absolute;width:22px;height:22px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.25s;box-shadow:0 1px 3px rgba(0,0,0,.3)}",
        ".cfg-toggle input:checked + .cfg-toggle-track{background:var(--color-primary)}",
        ".cfg-toggle input:checked + .cfg-toggle-track::before{transform:translateX(22px)}",
        /* Innstillingar: ikon-picker */
        ".cfg-icon-pick{background:none;border:2px solid var(--color-border);border-radius:8px;cursor:pointer;font-size:1.3rem;padding:.15rem .3rem;line-height:1;transition:border-color .12s,background .12s}",
        ".cfg-icon-pick:hover{border-color:var(--color-primary)}",
        ".cfg-icon-pick.is-sel{border-color:var(--color-primary);background:color-mix(in srgb,var(--color-primary) 10%,transparent)}"
      ].join("");
      document.head.appendChild(s);
    }

    var showSettings = false;

    var CFG_ICON_PICKS = ["💬","💭","🤝","📞","⭐","💡","🔔","✅","🚀","❤️","😊","👋","🎯","🏢","⚡","🌟"];

    function cfgField(id, label, value, type, placeholder) {
      var isColor = type === "color";
      return '<div><div style="font-size:.78rem;font-weight:600;margin-bottom:.3rem">'+Chat.esc(label)+'</div>' +
        '<input id="'+id+'" type="'+(type||"text")+'" value="'+Chat.esc(value||"")+'"' +
        (placeholder ? ' placeholder="'+Chat.esc(placeholder)+'"' : '') +
        ' style="border:1.5px solid var(--color-border);border-radius:8px;padding:.4rem .65rem;font:inherit;font-size:.87rem;outline:none;background:var(--color-bg);'+(isColor?'width:60px;height:36px;padding:.1rem;cursor:pointer':'')+'">' +
        '</div>';
    }

    function cfgArea(id, label, value) {
      return '<div><div style="font-size:.78rem;font-weight:600;margin-bottom:.3rem">'+Chat.esc(label)+'</div>' +
        '<textarea id="'+id+'" rows="2" style="width:100%;border:1.5px solid var(--color-border);border-radius:8px;padding:.4rem .65rem;font:inherit;font-size:.87rem;outline:none;background:var(--color-bg);resize:vertical;box-sizing:border-box">'+Chat.esc(value||"")+'</textarea></div>';
    }

    function cfgToggle(id, label, desc, checked) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:.7rem .9rem;border:1.5px solid var(--color-border);border-radius:10px;gap:.8rem">' +
        '<div><div style="font-size:.87rem;font-weight:600">'+Chat.esc(label)+'</div>' +
        '<div style="font-size:.76rem;color:var(--color-muted)">'+Chat.esc(desc)+'</div></div>' +
        '<label class="cfg-toggle">' +
          '<input type="checkbox" id="'+id+'"'+(checked?" checked":"")+' aria-label="'+Chat.esc(label)+'">' +
          '<span class="cfg-toggle-track"></span>' +
        '</label></div>';
    }

    function cfgIconSection(currentIcon, currentUrl) {
      return '<div>' +
        '<div style="font-size:.78rem;font-weight:600;margin-bottom:.4rem">Widget-ikon</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.7rem">' +
          CFG_ICON_PICKS.map(function(ic){
            return '<button type="button" class="cfg-icon-pick'+(ic===currentIcon&&!currentUrl?' is-sel':'')+'" data-pick-icon="'+Chat.esc(ic)+'">'+ic+'</button>';
          }).join("") +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:.65rem;flex-wrap:wrap">' +
          '<span style="font-size:.78rem;color:var(--color-muted)">Eget bilde:</span>' +
          '<label style="cursor:pointer;font-size:.79rem;border:1.5px solid var(--color-border);border-radius:8px;padding:.28rem .65rem;display:inline-flex;align-items:center;gap:.35rem">' +
            '<i class="ti ti-upload" style="font-size:.85rem"></i>Last opp' +
            '<input type="file" id="cfg-icon-upload" accept="image/*" style="display:none">' +
          '</label>' +
          (currentUrl
            ? '<img id="cfg-iconurl-preview" src="'+Chat.esc(currentUrl)+'" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--color-primary)">'
            : '<span id="cfg-iconurl-preview" style="width:40px;height:40px;border-radius:50%;border:2px dashed var(--color-border);display:inline-flex;align-items:center;justify-content:center;color:var(--color-muted);font-size:.65rem;flex-shrink:0">Tom</span>') +
          (currentUrl ? '<button type="button" id="cfg-iconurl-clear" style="font-size:.76rem;color:#c0392b;background:none;border:0;cursor:pointer">Fjern bilde</button>' : '') +
        '</div>' +
        '<input type="hidden" id="cfg-icon-val" value="'+Chat.esc(currentIcon||"💬")+'">' +
        '<input type="hidden" id="cfg-iconurl-val" value="'+Chat.esc(currentUrl||"")+'"></div>';
    }

    function renderSettingsPanel() {
      var cur = Object.assign({ enabled:true, operatorName:"Oss", welcomeMsg:"", offlineMsg:"", icon:"💬", iconUrl:"", color:"", btnColor:"", adminMsgsBg:"", position:"right" }, OPT);
      container.innerHTML =
        '<div class="vwca" style="grid-template-columns:1fr">' +
          '<div style="padding:1.3rem 1.6rem;overflow-y:auto;height:580px;box-sizing:border-box">' +
            '<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1.2rem">' +
              '<button id="vwca-cfg-back" style="background:none;border:1.5px solid var(--color-border);border-radius:8px;padding:.25rem .7rem;cursor:pointer;font:inherit;font-size:.82rem;color:var(--color-muted)">← Tilbake</button>' +
              '<h4 style="margin:0;font-size:1rem">Chat-innstillinger</h4>' +
            '</div>' +
            '<div style="display:grid;gap:1rem;max-width:520px">' +
              cfgToggle("cfg-enabled", "Chat aktiv", "Vis chat-boble på nettsiden", cur.enabled) +
              cfgField("cfg-opname", "Operatørnavn", cur.operatorName, "text", "Oss") +
              cfgIconSection(cur.icon, cur.iconUrl) +
              '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.8rem">' +
                cfgField("cfg-color", "Primærfarge", cur.color || "", "color") +
                cfgField("cfg-btn-color", "Boble-farge", cur.btnColor || "", "color") +
                cfgField("cfg-admin-bg", "Bakgrunn (admin)", cur.adminMsgsBg || "", "color") +
              '</div>' +
              cfgArea("cfg-welcome", "Velkomstmelding", cur.welcomeMsg) +
              cfgArea("cfg-offline", "Offline-melding", cur.offlineMsg) +
              '<div>' +
                '<div style="font-size:.78rem;font-weight:600;margin-bottom:.35rem">Posisjon på siden</div>' +
                '<label style="display:inline-flex;align-items:center;gap:.35rem;margin-right:1.2rem;font-size:.87rem;cursor:pointer"><input type="radio" name="cfg-pos" value="right" '+(cur.position==="right"?"checked":"")+' style="accent-color:var(--color-primary)"> Høyre</label>' +
                '<label style="display:inline-flex;align-items:center;gap:.35rem;font-size:.87rem;cursor:pointer"><input type="radio" name="cfg-pos" value="left" '+(cur.position==="left"?"checked":"")+' style="accent-color:var(--color-primary)"> Venstre</label>' +
              '</div>' +
            '</div>' +
            '<div style="margin-top:1.2rem;display:flex;align-items:center;gap:1rem">' +
              '<button id="vwca-cfg-save" style="background:var(--color-primary);color:#fff;border:0;border-radius:9px;padding:.5rem 1.3rem;font:inherit;font-size:.88rem;font-weight:600;cursor:pointer">Lagre innstillinger</button>' +
              '<span id="vwca-cfg-status" style="font-size:.8rem"></span>' +
            '</div>' +
            '<p style="font-size:.72rem;color:var(--color-muted);margin:.75rem 0 0">Ikon, farge og posisjon trer i kraft ved neste sidelast for besøkende. Bakgrunns- og admin-endringer er umiddelbare.</p>' +
          '</div>' +
        '</div>';

      /* Ikon-picks */
      container.querySelectorAll("[data-pick-icon]").forEach(function(b) {
        b.addEventListener("click", function() {
          container.querySelectorAll("[data-pick-icon]").forEach(function(x){x.classList.remove("is-sel");});
          b.classList.add("is-sel");
          container.querySelector("#cfg-icon-val").value = b.getAttribute("data-pick-icon");
          container.querySelector("#cfg-iconurl-val").value = "";
          var prev = container.querySelector("#cfg-iconurl-preview");
          if (prev && prev.tagName === "IMG") {
            prev.outerHTML = '<span id="cfg-iconurl-preview" style="width:40px;height:40px;border-radius:50%;border:2px dashed var(--color-border);display:inline-flex;align-items:center;justify-content:center;color:var(--color-muted);font-size:.65rem;flex-shrink:0">Tom</span>';
          }
        });
      });

      /* Biletopplasting */
      var uploadInp = container.querySelector("#cfg-icon-upload");
      if (uploadInp) uploadInp.addEventListener("change", function() {
        var file = uploadInp.files[0];
        if (!file) return;
        if (file.size > 300 * 1024) { alert("Bildet er for stort. Maks 300 kB."); return; }
        var reader = new FileReader();
        reader.onload = function(e) {
          var dataUrl = e.target.result;
          container.querySelector("#cfg-iconurl-val").value = dataUrl;
          var prev = container.querySelector("#cfg-iconurl-preview");
          if (prev) prev.outerHTML = '<img id="cfg-iconurl-preview" src="'+dataUrl+'" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--color-primary)">';
          container.querySelectorAll("[data-pick-icon]").forEach(function(x){x.classList.remove("is-sel");});
        };
        reader.readAsDataURL(file);
      });

      /* Fjern bilde */
      var clearBtn = container.querySelector("#cfg-iconurl-clear");
      if (clearBtn) clearBtn.addEventListener("click", function() {
        container.querySelector("#cfg-iconurl-val").value = "";
        var prev = container.querySelector("#cfg-iconurl-preview");
        if (prev) prev.outerHTML = '<span id="cfg-iconurl-preview" style="width:40px;height:40px;border-radius:50%;border:2px dashed var(--color-border);display:inline-flex;align-items:center;justify-content:center;color:var(--color-muted);font-size:.65rem;flex-shrink:0">Tom</span>';
      });

      container.querySelector("#vwca-cfg-back").addEventListener("click", function () {
        showSettings = false; buildUI();
      });

      container.querySelector("#vwca-cfg-save").addEventListener("click", function () {
        var cfg = {
          enabled:      !!container.querySelector("#cfg-enabled").checked,
          operatorName: container.querySelector("#cfg-opname").value.trim() || "Oss",
          icon:         container.querySelector("#cfg-icon-val").value || "💬",
          iconUrl:      container.querySelector("#cfg-iconurl-val").value || "",
          color:        container.querySelector("#cfg-color").value || "",
          btnColor:     container.querySelector("#cfg-btn-color").value || "",
          adminMsgsBg:  container.querySelector("#cfg-admin-bg").value || "",
          welcomeMsg:   container.querySelector("#cfg-welcome").value.trim(),
          offlineMsg:   container.querySelector("#cfg-offline").value.trim(),
          position:     (container.querySelector("input[name='cfg-pos']:checked") || {value:"right"}).value
        };
        saveWidgetConfig(cfg);
        Object.assign(OPT, cfg);
        var st = container.querySelector("#vwca-cfg-status");
        st.style.color = "var(--color-primary)"; st.textContent = "✓ Lagret!";
        setTimeout(function () { if (st) st.textContent = ""; }, 2500);
      });
    }

    function buildUI() {
      if (showSettings) { renderSettingsPanel(); return; }
      var open   = convs.filter(function(c){return c.status==="open";});
      var closed = convs.filter(function(c){return c.status==="closed";});
      var totalUnread = convs.reduce(function(s,c){return s+(c.unread||0);},0);

      var isOnline = Chat.getAvailability().online;

      var openHtml = open.map(function(c){ return convRow(c); }).join("") ||
        '<div style="padding:.8rem 1rem;font-size:.82rem;color:var(--color-muted)">Ingen åpne samtaler.</div>';

      var activeIsInClosed = closed.some(function(c){ return c.id === activeId; });
      var closedHtml = closed.length
        ? '<details class="vwca-closed-group"' + (activeIsInClosed ? ' open' : '') + '>' +
            '<summary>Lukket (' + closed.length + ')</summary>' +
            closed.map(function(c){ return convRow(c, true); }).join("") +
          '</details>'
        : "";

      container.innerHTML =
        '<div class="vwca">' +
          '<div class="vwca-sidebar">' +
            '<div class="vwca-sidebar-head">' +
              '<button class="vwca-avail-btn'+(isOnline?' is-online':'')+'" id="vwca-avail-btn">' +
                (isOnline ? '<span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;flex-shrink:0"></span> Online' : '<span style="width:8px;height:8px;border-radius:50%;background:#9ca3af;display:inline-block;flex-shrink:0"></span> Offline') +
              '</button>' +
              '<h4 style="flex:1;margin:0 .3rem">Chat' + (totalUnread ? ' <span style="font-weight:400;color:var(--color-muted)">(' + totalUnread + ')</span>' : '') + '</h4>' +
              '<button class="vwca-test-btn" id="vwca-test-btn">+ Test</button>' +
              '<button class="vwca-test-btn" id="vwca-cfg-btn" title="Chat-innstillinger" style="font-size:.85rem">⚙</button>' +
            '</div>' +
            '<div style="flex:1;overflow-y:auto;min-height:0">' +
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
          // Update in-memory convs so renderView reads correct data
          var idx = convs.findIndex(function(c){return c.id===activeId;});
          if (idx>-1) convs[idx].unread = 0;
          _adminConvs = convs;
          buildUI();
        });
      });

      /* Tilgjengelegheit-toggle */
      var availBtn = container.querySelector("#vwca-avail-btn");
      if (availBtn) availBtn.addEventListener("click", function () {
        var btn = this;
        btn.disabled = true;
        var goOnline = !Chat.getAvailability().online;
        Chat.setAvailability(goOnline).then(function() {
          if (goOnline) _startHeartbeat(); else _stopHeartbeat();
          buildUI();
        }, function(err) {
          console.warn("[chat] setAvailability failed:", err.message);
          btn.disabled = false;
        });
      });

      /* Innstillingar-knapp */
      var cfgBtn = container.querySelector("#vwca-cfg-btn");
      if (cfgBtn) cfgBtn.addEventListener("click", function () { showSettings = true; buildUI(); });

      /* Test-knapp */
      var testBtn = container.querySelector("#vwca-test-btn");
      if (testBtn) testBtn.addEventListener("click", function () {
        var names = ["Kari Nordmann","Ola Hansen","Per Olsen","Anna Berg","Lars Dahl","Mette Vik"];
        var msgs  = [
          "Hei! Jeg lurer på prisene deres.",
          "Kan jeg bestille time hos dere?",
          "Har dere ledig kapasitet neste uke?",
          "Hvordan fungerer det å bestille via nettsiden?",
          "Er dere åpne i helgene?",
          "Hva koster det å komme i gang?"
        ];
        var n = names[Math.floor(Math.random()*names.length)];
        var m = msgs[Math.floor(Math.random()*msgs.length)];
        Chat.createConv(n, n.toLowerCase().replace(" ",".") + "@eksempel.no").then(function(conv) {
          Chat.addMsg(conv.id, m, "visitor");
          activeId = conv.id;
          container._activeConvId = activeId;
          convs.unshift(conv);
          _adminConvs = convs;
          buildUI();
        }, function(err) {
          console.error("[chat] test conv failed:", err.message);
        });
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

      // Use in-memory convs (not localStorage) — admin convs may not be in localStorage
      var conv = convs.find(function(c){return c.id===activeId;});
      if (!activeId || !conv) {
        view.innerHTML = '<div class="vwca-empty">Velg en samtale til venstre</div>';
        return;
      }
      var msgs = Chat.getMsgs(activeId);
      var isClosed = conv.status === "closed";

      markLeadAsRead(activeId);

      view.innerHTML =
        '<div class="vwca-view-head">' +
          '<div class="vwca-view-head-info">' +
            '<strong>' + Chat.esc(conv.name) + '</strong>' +
            (conv.email ? '<span>' + Chat.esc(conv.email) + '</span>' : '') +
            (conv.lastSeenAt ? '<span style="font-size:.72rem;color:' + (conv.visitorActive ? '#22c55e' : 'var(--color-muted)') + '">' + (conv.visitorActive ? '● Aktiv nå' : '○ Fraværende') + '</span>' : '') +
          '</div>' +
          '<button class="vwca-info-btn" id="vwca-info-btn">ℹ Info</button>' +
          '<button class="vwca-status-btn ' + (isClosed ? 'is-closed' : 'is-open') + '" id="vwca-toggle-status">' +
            (isClosed ? '🔴 Lukket — Åpne igjen' : '🟢 Åpen — Lukk') +
          '</button>' +
        '</div>' +
        '<div class="vwca-info-panel" id="vwca-ip" style="display:none">' + buildInfoPanelHtml(conv) + '</div>' +
        '<div class="vwca-msgs" id="vwca-msg-list">' +
          (msgs.length
            ? msgs.map(function(m){
                var cls = m.sender==="operator" ? "vwca-msg--op" : m.sender==="system" ? "vwca-msg--sys" : "vwca-msg--vis";
                return '<div class="vwca-msg '+cls+'">' + (m.sender==="system" ? '— '+Chat.esc(m.text)+' —' : Chat.esc(m.text)+
                  '<div class="vwca-msg-ts">'+Chat.tsDate(m.at)+'</div>') + '</div>';
              }).join("")
            : '<div style="text-align:center;font-size:.82rem;color:var(--color-muted);margin:auto;padding:2rem">Ingen meldingar endå.</div>'
          ) +
        '</div>' +
        (isClosed
          ? '<div class="vwca-closed-notice">Samtalen er lukka — opne att for å svare.</div>'
          : '<div class="vwca-reply" id="vwca-reply">' +
              '<div class="vwca-emoji-picker" id="vwca-emoji"></div>' +
              '<div style="display:flex;flex-direction:column;gap:2px;align-self:flex-end;flex-shrink:0">' +
                '<button class="vw-icon-btn" id="vwca-snip-btn" title="Standardtekster — skriv # i svarfeltet" style="color:var(--color-muted);font-size:.82rem;font-weight:700;padding:.2rem .35rem">#</button>' +
                '<button class="vw-icon-btn" id="vwca-emoji-btn" style="color:var(--color-muted);font-size:1rem;padding:.2rem .35rem">😊</button>' +
              '</div>' +
              '<textarea class="vwca-reply-inp" id="vwca-inp" rows="3" placeholder="Skriv svar… (# for standardtekster)" maxlength="2000"></textarea>' +
              '<button class="vwca-reply-btn" id="vwca-send"><i class="ti ti-send"></i> Send</button>' +
            '</div>'
        );

      /* Scroll + evt. custom bakgrunn */
      var msgList = view.querySelector("#vwca-msg-list");
      if (msgList) {
        msgList.scrollTop = msgList.scrollHeight;
        if (OPT.adminMsgsBg) msgList.style.background = OPT.adminMsgsBg;
      }

      /* Toggle open/lukk */
      var toggleBtn = view.querySelector("#vwca-toggle-status");
      if (toggleBtn) toggleBtn.addEventListener("click", function () {
        var newStatus = conv.status === "closed" ? "open" : "closed";
        if (newStatus === "closed") {
          saveConvAsLead(activeId);
          setLeadResolved(activeId);
        } else {
          var reopenLead = getLeadByChatId(activeId);
          if (reopenLead && window.App && window.App.setLeadStatus) {
            window.App.setLeadStatus(reopenLead.id, "lest");
          }
        }
        Chat.setStatus(activeId, newStatus);
        // Keep in-memory convs in sync so buildUI shows updated status
        var sidx = convs.findIndex(function(c){return c.id===activeId;});
        if (sidx>-1) convs[sidx].status = newStatus;
        _adminConvs = convs;
        buildUI();
      });

      /* Info-panel toggle */
      var infoBtn = view.querySelector("#vwca-info-btn");
      var infoPanel = view.querySelector("#vwca-ip");
      if (infoBtn && infoPanel) infoBtn.addEventListener("click", function () {
        var open = infoPanel.style.display !== "none";
        infoPanel.style.display = open ? "none" : "";
        infoBtn.classList.toggle("is-active", !open);
      });
      /* CRM-navigasjon frå info-panel */
      view.querySelectorAll("[data-crm-open]").forEach(function (b) {
        b.addEventListener("click", function () {
          var cid = b.getAttribute("data-crm-open");
          if (window.CrmAdmin) window.CrmAdmin.openCustomer(cid);
          if (document.getElementById("intranet") && window.Intranet) {
            window.Intranet.navigate("crm");
          } else {
            var crmTab = document.querySelector('[data-tab="mod-crm"]');
            if (crmTab) crmTab.click();
          }
        });
      });

      if (isClosed) return;

      /* Emoji */
      var emojiPicker = view.querySelector("#vwca-emoji");
      var emojiBtn    = view.querySelector("#vwca-emoji-btn");
      var inp         = view.querySelector("#vwca-inp");
      var sendBtn     = view.querySelector("#vwca-send");

      var snippetAC = bindSnippetAutocomplete(inp, view.querySelector("#vwca-reply"), doSend, function () {
        var conv = convs.find(function (c) { return c.id === activeId; });
        return { namn: (conv && conv.name) || "", epost: (conv && conv.email) || "" };
      });

      /* # Snippet trigger — opnar meny utan å skrive # i textarea */
      var snippetTriggerBtn = view.querySelector("#vwca-snip-btn");
      if (snippetTriggerBtn) snippetTriggerBtn.addEventListener("mousedown", function (e) {
        e.preventDefault();
        snippetAC.trigger();
      });

      emojiPicker.innerHTML = EMOJIS.map(function(e){
        return '<button class="vwca-emoji-btn" data-e="'+e+'">'+e+'</button>';
      }).join("");
      emojiPicker.querySelectorAll("[data-e]").forEach(function(b){
        b.addEventListener("mousedown",function(e){
          e.preventDefault();
          insertAtCursor(inp, b.getAttribute("data-e"));
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
        this.style.height = Math.min(this.scrollHeight,160)+"px";
        // :: trigger — opnar emoji-picker og fjernar :: frå tekstfeltet
        if (this.value.slice(-2) === "::") {
          this.value = this.value.slice(0, -2);
          emojiPicker.classList.add("is-open");
          this.focus();
        }
      });

      function doSend() {
        var txt = inp.value.trim();
        if (!txt) return;
        sendBtn.disabled = true;
        inp.value = ""; inp.style.height = "auto";
        Chat.addMsg(activeId, txt, "operator").then(function() {
          Chat.markRead(activeId);
          // Update in-memory conv's lastMsg/lastAt
          var midx = convs.findIndex(function(c){return c.id===activeId;});
          if (midx>-1) { convs[midx].lastMsg=txt.slice(0,60); convs[midx].lastAt=Date.now(); }
          renderView();
        }, function(err) {
          console.warn("[chat] send failed:", err.message);
          var errEl = view.querySelector("#vwca-send-err");
          if (!errEl) {
            errEl = document.createElement("div");
            errEl.id = "vwca-send-err";
            errEl.style.cssText = "color:#ef4444;font-size:.78rem;margin-top:.25rem;padding:0 .5rem";
            var replyDiv = view.querySelector(".vwca-reply");
            if (replyDiv) replyDiv.appendChild(errEl);
          }
          errEl.textContent = "Sending mislyktes. Prøv igjen.";
          setTimeout(function(){if(errEl&&errEl.parentNode)errEl.textContent="";},4000);
          inp.value = txt; // restore text so admin can retry
        }).finally(function() {
          sendBtn.disabled = false;
          if (inp) inp.focus();
        });
      }
      sendBtn.addEventListener("click", doSend);

      setTimeout(function(){ if(inp) inp.focus(); }, 50);
    }

    /* Poll — hentar frå Supabase (eller localStorage som fallback) */
    if (!container._pollId) {
      container._pollId = setInterval(function () {
        if (!document.body.contains(container)) { clearInterval(container._pollId); return; }
        if (showSettings) return;
        if (_sb) {
          _sb.from("chat_conversations").select("*").order("last_at", { ascending: false, nullsFirst: false })
            .then(function (res) {
              if (!res.data) return;
              var mapped = res.data.map(function (c) {
                return { id: c.id, name: c.visitor_name || "Gjest", email: c.visitor_email || "",
                         status: c.status || "open", unread: c.unread || 0,
                         lastMsg: c.last_msg || "", lastAt: c.last_at || new Date(c.created_at).getTime(),
                         createdAt: new Date(c.created_at).getTime(),
                         pageUrl: c.page_url || null, referrer: c.referrer || null,
                         language: c.language || null, browser: c.browser || null,
                         os: c.os || null, screen: c.screen || null,
                         visitorActive: c.visitor_active || false,
                         lastSeenAt: c.last_seen_at || null, visitorReadAt: c.visitor_read_at || null };
              });
              var latestLocal = convs.reduce(function (t, c) { return Math.max(t, c.lastAt || 0); }, 0);
              var latestSb    = mapped.reduce(function (t, c) { return Math.max(t, c.lastAt || 0); }, 0);
              if (mapped.length !== convs.length || latestSb > latestLocal) {
                convs = mapped; _adminConvs = mapped; buildUI();
              } else if (activeId) {
                var localMsgs = Chat.getMsgs(activeId);
                var lastAt = localMsgs.reduce(function (t, m) { return Math.max(t, m.at || 0); }, 0);
                _sb.from("chat_messages").select("id,text,sender,at,created_at")
                  .eq("conversation_id", activeId).gt("at", lastAt || 0)
                  .then(function (mres) {
                    if (!mres.data || !mres.data.length) return;
                    var changed = false;
                    mres.data.forEach(function (m) {
                      if (!localMsgs.find(function (x) { return x.id === m.id; })) {
                        localMsgs.push({ id: m.id, convId: activeId, text: m.text, sender: m.sender,
                                        at: m.at || new Date(m.created_at).getTime() });
                        changed = true;
                      }
                    });
                    if (changed) {
                      Chat.setMsgs(activeId, localMsgs);
                      var msgList = container.querySelector("#vwca-msg-list");
                      if (msgList) renderView();
                    }
                  });
              }
            });
        } else {
          var fresh = Chat.getConvs();
          if (JSON.stringify(fresh) !== JSON.stringify(convs)) {
            convs = fresh; _adminConvs = fresh; buildUI();
          } else if (activeId) {
            var msgs = Chat.getMsgs(activeId);
            var msgList = container.querySelector("#vwca-msg-list");
            if (msgList && msgList.children.length !== msgs.length) renderView();
          }
        }
      }, OPT.pollInterval);
    }

    /* Realtime — abonner éin gong per container på nye samtalar og meldingar */
    if (_sb && !container._rtCh) {
      container._rtCh = _sb.channel("adm-chat-" + (container._pollId || Date.now()))
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversations" },
          function (payload) {
            if (payload.eventType === "DELETE") {
              convs = convs.filter(function (x) { return x.id !== payload.old.id; });
              _adminConvs = convs;
            } else {
              var c = payload.new;
              var conv = {
                id: c.id, name: c.visitor_name || "Gjest", email: c.visitor_email || "",
                status: c.status || "open", unread: c.unread || 0,
                lastMsg: c.last_msg || "", lastAt: c.last_at || new Date(c.created_at).getTime(),
                createdAt: new Date(c.created_at).getTime(),
                pageUrl: c.page_url || null, referrer: c.referrer || null,
                language: c.language || null, browser: c.browser || null,
                os: c.os || null, screen: c.screen || null,
                visitorActive: c.visitor_active || false,
                lastSeenAt: c.last_seen_at || null, visitorReadAt: c.visitor_read_at || null
              };
              var convs2 = convs.slice();
              var idx = convs2.findIndex(function (x) { return x.id === c.id; });
              if (idx > -1) { Object.assign(convs2[idx], conv); } else { convs2.unshift(conv); }
              convs = convs2; _adminConvs = convs;
            }
            if (!showSettings) buildUI();
          })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" },
          function (payload) {
            var m = payload.new;
            var cid = m.conversation_id;
            var msgs = Chat.getMsgs(cid);
            if (!msgs.find(function (x) { return x.id === m.id; })) {
              msgs.push({ id: m.id, convId: cid, text: m.text, sender: m.sender,
                          at: m.at || new Date(m.created_at).getTime() });
              Chat.setMsgs(cid, msgs);
            }
            if (!showSettings) {
              if (cid === activeId) { var _ml = container.querySelector("#vwca-msg-list"); if (_ml) renderView(); }
              else { buildUI(); }
            }
          })
        .subscribe();
    }

    /* Hydrer frå Supabase første gong admin-panelet opnast */
    if (!_adminHydrated && _sb) {
      _adminHydrated = true;
      Chat.hydrateFromSupabase(function (hc) { if (hc && hc.length) { convs = hc; _adminConvs = hc; } buildUI(); });
    } else {
      buildUI();
    }
    // Start heartbeat if admin is already online (e.g., refreshed the page)
    if (Chat.getAvailability().online) _startHeartbeat();
  }

  /* ── OPPSTART ── */
  function boot() {
    // If localStorage lacks chat-config and Supabase is available, fetch it first so
    // initWidget gets the correct admin-saved settings (colors, messages, enabled flag).
    var ns = _CHAT_NS || "site";
    var cfgKey = (_CHAT_NS ? _CHAT_NS + ":" : "") + "chat-config";
    var needsFetch = _sb && !localStorage.getItem(cfgKey);
    if (needsFetch) {
      _sb.from("store").select("value").eq("tenant_id", ns).eq("key", "chat-config").maybeSingle()
        .then(function(r) {
          if (r.data && !r.error && r.data.value) {
            try { localStorage.setItem(cfgKey, JSON.stringify(r.data.value)); } catch(e) {}
            Object.assign(OPT, r.data.value);
          }
          initWidget();
          initAdmin();
        }, function() {
          initWidget();
          initAdmin();
        });
    } else {
      initWidget();
      initAdmin();
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }

})();
