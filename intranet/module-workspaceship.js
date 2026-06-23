/* =============================================================================
   module-workspaceship.js — WORKSPACESHIP
   Triple-click Easter egg for the intranet logo. Vanilla JS, no dependencies.
   Usage: add data-workspaceship-trigger to the intranet logo, then load this file.
   ============================================================================= */
(function () {
  "use strict";

  var App = window.App;
  if (!App || !App.store) return;

  var activeHost = null;
  var activeRoot = null;
  var triggerElement = null;
  var triggerHandler = null;
  var delegatedClickHandler = null;
  var tripleClickTimes = [];
  var configuredSelector = null;

  var STORE_KEY = "wsp-workspaceship";
  var STYLE_ID = "workspaceship-module-styles";

  function getState() {
    return App.store.get(STORE_KEY, {}) || {};
  }

  function setState(patch) {
    var state = getState();
    var key;
    for (key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) state[key] = patch[key];
    }
    App.store.set(STORE_KEY, state);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".wsp-easter-egg-host{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:clamp(.75rem,3vw,2rem);background:rgba(2,8,20,.72);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);overflow:hidden}",
      ".wsp-root{--wsp-space-0:#061528;--wsp-space-1:#101827;--wsp-space-2:#1e1b4b;--wsp-cyan:#7dd3fc;--wsp-ink:#e5e7eb;--wsp-muted:#94a3b8;--wsp-line:rgba(125,211,252,.22);--wsp-hud:ui-monospace,SFMono-Regular,Menlo,'Cascadia Mono','Roboto Mono',monospace;--wsp-sans:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;position:relative;width:min(1120px,100%);height:min(780px,calc(100dvh - 3rem));min-height:0;color:var(--wsp-ink);font-family:var(--wsp-sans);background:linear-gradient(180deg,var(--wsp-space-0),var(--wsp-space-1) 55%,var(--wsp-space-2));border:1px solid rgba(125,211,252,.30);border-radius:18px;box-shadow:0 28px 100px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.18);overscroll-behavior:contain;touch-action:none;isolation:isolate;overflow:hidden}",
      ".wsp-root,.wsp-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;user-select:none}",
      ".wsp-root .wsp-bar{height:64px;display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.65rem max(.75rem,env(safe-area-inset-left)) .65rem max(.75rem,env(safe-area-inset-right));border-bottom:1px solid var(--wsp-line);background:rgba(6,21,40,.92)}",
      ".wsp-root .wsp-left{display:flex;align-items:center;gap:.75rem;min-width:0}.wsp-root .wsp-wordmark{font-family:var(--wsp-hud);font-weight:700;letter-spacing:.24em;text-transform:uppercase;white-space:nowrap}.wsp-root .wsp-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--wsp-cyan);box-shadow:0 0 12px var(--wsp-cyan),0 0 4px #fff;margin-right:.55rem}.wsp-root .wsp-mode{display:flex;gap:.35rem}",
      ".wsp-root .wsp-ctl,.wsp-root .wsp-mode button{appearance:none;cursor:pointer;font-family:var(--wsp-hud);font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--wsp-ink);background:rgba(125,211,252,.08);border:1px solid var(--wsp-line);border-radius:999px;padding:.48rem .68rem;display:inline-flex;align-items:center;justify-content:center;gap:.35rem}.wsp-root .wsp-mode button[aria-pressed='true']{background:rgba(125,211,252,.22);border-color:rgba(125,211,252,.7);color:#fff}.wsp-root .wsp-controls{display:flex;gap:.4rem}.wsp-root .wsp-ctl svg{width:15px;height:15px;display:block}",
      ".wsp-root .wsp-stage{height:calc(100% - 64px);min-height:0;display:flex;align-items:center;justify-content:center;padding:.6rem;touch-action:none}.wsp-root .wsp-game-shell{height:100%;width:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:.45rem;align-items:center;justify-items:center}.wsp-root .wsp-scorebar{width:min(100%,920px);display:flex;justify-content:space-between;gap:.75rem;font-family:var(--wsp-hud);font-size:.8rem;color:var(--wsp-muted);padding:0 .15rem}.wsp-root .wsp-scorebar b{color:var(--wsp-cyan)}",
      ".wsp-root .wsp-canvas-wrap{position:relative;max-width:100%;max-height:100%;border:1px solid var(--wsp-line);border-radius:14px;background:#07111f;overflow:hidden;box-shadow:0 18px 60px rgba(2,8,20,.55),inset 0 0 60px rgba(125,211,252,.05)}.wsp-root .wsp-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:pointer}.wsp-root .wsp-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:rgba(0,0,0,.35);color:#fff;gap:.35rem;pointer-events:none;padding:1rem}.wsp-root .wsp-overlay.is-hidden{display:none}.wsp-root .wsp-overlay strong{font-size:clamp(1.45rem,5vw,2.2rem)}.wsp-root .wsp-overlay span{font-size:clamp(.9rem,3vw,1.05rem);opacity:.92}.wsp-root .wsp-hint{font-family:var(--wsp-hud);font-size:.75rem;color:var(--wsp-muted);text-align:center;min-height:1em}",
      ".wsp-root .wsp-toast{position:fixed;left:50%;bottom:1rem;transform:translateX(-50%) translateY(16px);background:rgba(6,21,40,.95);border:1px solid var(--wsp-line);color:var(--wsp-ink);font-family:var(--wsp-hud);font-size:.78rem;padding:.55rem .9rem;border-radius:999px;z-index:10002;opacity:0;transition:.18s;pointer-events:none;max-width:90vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wsp-root .wsp-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}",
      ".wsp-root.ws-immersive{position:fixed!important;inset:0!important;z-index:10000!important;min-height:100dvh!important;height:100dvh!important;width:100vw!important}.wsp-root.ws-immersive .wsp-bar{position:absolute;inset:0 0 auto 0;height:56px;z-index:3;justify-content:flex-end;padding:calc(.45rem + env(safe-area-inset-top)) max(.55rem,env(safe-area-inset-right)) .45rem max(.55rem,env(safe-area-inset-left));border-bottom:1px solid rgba(125,211,252,.16);background:rgba(6,21,40,.94)}.wsp-root.ws-immersive .wsp-left,.wsp-root.ws-immersive .wsp-share{display:none}.wsp-root.ws-immersive .wsp-ctl{min-width:42px;min-height:38px;background:rgba(125,211,252,.13);border-color:rgba(125,211,252,.45)}.wsp-root.ws-immersive .wsp-stage{position:absolute;inset:56px 0 0 0;height:auto;padding:max(.45rem,env(safe-area-inset-top)) max(.45rem,env(safe-area-inset-right)) max(.45rem,env(safe-area-inset-bottom)) max(.45rem,env(safe-area-inset-left))}",
      "@media(max-width:640px){.wsp-root{min-height:calc(100dvh - 1rem)}.wsp-root .wsp-bar{height:56px}.wsp-root .wsp-stage{height:calc(100% - 56px)}.wsp-root .wsp-wordmark{font-size:.78rem;letter-spacing:.16em}.wsp-root .wsp-mode button,.wsp-root .wsp-ctl{font-size:.64rem;padding:.45rem .52rem}.wsp-root .wsp-ctl .wsp-label{display:none}.wsp-root.ws-immersive .wsp-ctl .wsp-label{display:none}}",
      ".wsp-root .wsp-fullscreen-score{display:none}",
      ".wsp-root.ws-immersive .wsp-fullscreen-score{display:flex;position:fixed;left:max(.55rem,env(safe-area-inset-left));top:0;z-index:10004;height:56px;align-items:center;gap:.8rem;padding:0 .38rem;font-family:var(--wsp-hud);font-size:.82rem;font-weight:800;letter-spacing:.01em;color:#f8fafc;text-shadow:0 1px 2px rgba(0,0,0,.95);pointer-events:none}.wsp-root.ws-immersive .wsp-fullscreen-score b{color:var(--wsp-cyan);font-size:.98rem}",
      "@media (pointer:coarse) and (orientation:landscape) and (max-height:540px){.wsp-root .wsp-bar{height:46px;padding:.25rem max(.45rem,env(safe-area-inset-right)) .25rem max(.45rem,env(safe-area-inset-left));gap:.35rem}.wsp-root .wsp-left{gap:.4rem}.wsp-root .wsp-wordmark{font-size:.72rem;letter-spacing:.13em}.wsp-root .wsp-dot{width:7px;height:7px;margin-right:.35rem}.wsp-root .wsp-mode{gap:.24rem}.wsp-root .wsp-mode button,.wsp-root .wsp-ctl{font-size:.61rem;padding:.34rem .46rem;min-height:32px}.wsp-root .wsp-stage{padding:3px}.wsp-root .wsp-game-shell{grid-template-rows:auto minmax(0,1fr);gap:3px}.wsp-root .wsp-scorebar{width:100%;min-height:17px;align-items:center;padding:0 .2rem;font-size:.7rem;line-height:1}.wsp-root .wsp-hint{display:none}.wsp-root .wsp-canvas-wrap{border-radius:7px;box-shadow:none}.wsp-root.ws-immersive .wsp-bar{height:44px;padding:calc(.18rem + env(safe-area-inset-top)) max(.45rem,env(safe-area-inset-right)) .18rem max(.45rem,env(safe-area-inset-left))}.wsp-root.ws-immersive .wsp-stage{inset:44px 0 0 0;padding:2px max(2px,env(safe-area-inset-right)) max(2px,env(safe-area-inset-bottom)) max(2px,env(safe-area-inset-left))}.wsp-root.ws-immersive .wsp-game-shell{display:flex;position:relative;align-items:center;justify-content:center;width:100%;height:100%}.wsp-root.ws-immersive .wsp-scorebar{display:none}.wsp-root.ws-immersive .wsp-fullscreen-score{height:44px;font-size:.78rem;gap:.78rem;color:#fff}.wsp-root.ws-immersive .wsp-fullscreen-score b{font-size:1rem;color:var(--wsp-cyan)}.wsp-root.ws-immersive .wsp-canvas-wrap{border-radius:4px;box-shadow:none;flex:0 0 auto;margin:auto}}",
      "@media(max-width:640px){.wsp-easter-egg-host{padding:0;background:#061528}.wsp-root{width:100%;height:100dvh;border:0;border-radius:0;box-shadow:none}}",
      "@media(prefers-reduced-motion:reduce){.wsp-root .wsp-toast{transition:none}}"
    ].join("");
    document.head.appendChild(style);
  }

  function mountGame(outlet, onClose) {
    var root = outlet.querySelector("#workspaceship-root") || outlet;
    injectStyles();

    root.innerHTML = [
      '<div class="wsp-bar">',
        '<div class="wsp-left">',
          '<div class="wsp-wordmark"><span class="wsp-dot"></span>Spaceship</div>',
          '<div class="wsp-mode" aria-label="Velg spillmodus">',
            '<button type="button" data-wsp-mode="classic">Vanlig</button>',
            '<button type="button" data-wsp-mode="portrait">Stående</button>',
          '</div>',
        '</div>',
        '<div class="wsp-controls">',
          '<button class="wsp-ctl wsp-close" data-wsp-close type="button" aria-label="Lukk spillet" title="Lukk spillet">×</button>',
          '<button class="wsp-ctl wsp-share" data-wsp-share type="button" aria-label="Del">Del</button>',
          '<button class="wsp-ctl" data-wsp-fullscreen type="button" aria-label="Fullskjerm" aria-pressed="false">',
            '<svg data-wsp-fs-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
            '<span class="wsp-label" data-wsp-fs-label>Fullskjerm</span>',
          '</button>',
        '</div>',
      '</div>',
      '<div class="wsp-fullscreen-score" data-wsp-fullscreen-score aria-live="polite"><span>Poeng: <b data-wsp-fs-score>0</b></span><span>Beste: <b data-wsp-fs-best>0</b></span></div>',
      '<div class="wsp-stage">',
        '<div class="wsp-game-shell">',
          '<div class="wsp-scorebar"><span>Poeng: <b data-wsp-score>0</b></span><span>Beste: <b data-wsp-best>0</b></span></div>',
          '<div class="wsp-canvas-wrap" data-wsp-wrap>',
            '<canvas class="wsp-canvas" data-wsp-canvas aria-label="Spaceship-spill" tabindex="0"></canvas>',
            '<div class="wsp-overlay" data-wsp-overlay><strong data-wsp-overlay-title>Spaceship</strong><span data-wsp-overlay-text>Velg modus og start</span></div>',
          '</div>',
          '<div class="wsp-hint" data-wsp-hint></div>',
        '</div>',
      '</div>',
      '<div class="wsp-toast" data-wsp-toast role="status" aria-live="polite"></div>'
    ].join("");

    startGame(root);
  }

  function startGame(root) {
    var canvas = root.querySelector("[data-wsp-canvas]");
    var ctx = canvas.getContext("2d");
    var wrap = root.querySelector("[data-wsp-wrap]");
    var overlay = root.querySelector("[data-wsp-overlay]");
    var overlayTitle = root.querySelector("[data-wsp-overlay-title]");
    var overlayText = root.querySelector("[data-wsp-overlay-text]");
    var scoreEl = root.querySelector("[data-wsp-score]");
    var bestEl = root.querySelector("[data-wsp-best]");
    var fullscreenScoreEl = root.querySelector("[data-wsp-fs-score]");
    var fullscreenBestEl = root.querySelector("[data-wsp-fs-best]");
    var hint = root.querySelector("[data-wsp-hint]");
    var classicBtn = root.querySelector('[data-wsp-mode="classic"]');
    var portraitBtn = root.querySelector('[data-wsp-mode="portrait"]');
    var fullscreenBtn = root.querySelector("[data-wsp-fullscreen]");
    var fullscreenLabel = root.querySelector("[data-wsp-fs-label]");
    var fullscreenIcon = root.querySelector("[data-wsp-fs-icon]");
    var shareBtn = root.querySelector("[data-wsp-share]");
    var closeBtn = root.querySelector("[data-wsp-close]");
    var toastEl = root.querySelector("[data-wsp-toast]");

    var initial = getState();
    var mode = initial.mode === "portrait" ? "portrait" : "classic";
    var W = 720;
    var H = 420;
    var ship;
    var obstacles = [];
    var stars = [];
    var particles = [];
    var score = 0;
    var best = 0;
    var running = false;
    var dead = false;
    var frame = 0;
    var thrusting = false;
    var lastInput = 0;
    var nextAt = 70;
    var pointerDown = false;
    var targetX = 210;
    var keys = { left: false, right: false };
    var raf = 0;
    var destroyed = false;

    function modeKey() {
      return mode === "portrait" ? "bestPortrait" : "bestClassic";
    }

    function getBest() {
      var saved = getState();
      if (saved[modeKey()] != null) return Number(saved[modeKey()]) || 0;
      return mode === "classic" ? (Number(saved.best) || 0) : 0;
    }

    function setBest(value) {
      var patch = {};
      patch[modeKey()] = value;
      if (mode === "classic") patch.best = value;
      setState(patch);
    }

    function setMode(nextMode) {
      mode = nextMode === "portrait" ? "portrait" : "classic";
      setState({ mode: mode });
      classicBtn.setAttribute("aria-pressed", mode === "classic" ? "true" : "false");
      portraitBtn.setAttribute("aria-pressed", mode === "portrait" ? "true" : "false");
      reset(true);
      fit();
    }

    function reset(waiting) {
      W = mode === "portrait" ? 420 : 720;
      H = mode === "portrait" ? 720 : 420;
      canvas.width = W;
      canvas.height = H;
      ship = mode === "portrait"
        ? { x: W / 2, y: H - 88, vy: 0, r: 15, rot: 0 }
        : { x: 120, y: H / 2, vy: 0, r: 15, rot: 0 };
      targetX = ship.x;
      obstacles = [];
      particles = [];
      stars = makeStars();
      score = 0;
      frame = 0;
      running = !waiting;
      dead = false;
      thrusting = false;
      pointerDown = false;
      keys.left = false;
      keys.right = false;
      nextAt = mode === "portrait" ? 38 : 70;
      best = getBest();
      scoreEl.textContent = "0";
      bestEl.textContent = String(best);
      fullscreenScoreEl.textContent = "0";
      fullscreenBestEl.textContent = String(best);
      overlay.classList.toggle("is-hidden", !waiting);
      overlayTitle.textContent = mode === "portrait" ? "Stående modus" : "Spaceship";
      overlayText.textContent = mode === "portrait" ? "Swipe sidelengs for å starte" : "Hold inne for thrust";
      hint.textContent = mode === "portrait"
        ? "Mobil: swipe/drag sidelengs. PC: piltaster eller mus."
        : "Mobil/PC: hold inne for thrust. Space fungerer på PC.";
    }

    function compactLandscape() {
      if (window.matchMedia) return window.matchMedia("(pointer: coarse) and (orientation: landscape) and (max-height: 540px)").matches;
      return window.innerWidth > window.innerHeight && Math.min(window.innerWidth, window.innerHeight) <= 540;
    }

    function fit() {
      var shell = wrap.parentElement;
      var availableWidth = shell.clientWidth;
      var availableHeight = shell.clientHeight;
      if (compactLandscape() && !root.classList.contains("ws-immersive")) {
        var gap = parseFloat(window.getComputedStyle(shell).rowGap) || 0;
        availableHeight -= scoreEl.parentElement.offsetHeight + gap;
      }
      var ratio = W / H;
      var width = Math.min(availableWidth, availableHeight * ratio);
      var height = width / ratio;
      if (height > availableHeight) { height = availableHeight; width = height * ratio; }
      wrap.style.width = Math.max(1, Math.floor(width)) + "px";
      wrap.style.height = Math.max(1, Math.floor(height)) + "px";
    }

    function makeStars() {
      var list = [];
      var i;
      for (i = 0; i < 110; i++) {
        list.push({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 1.8 + 0.4, v: Math.random() * 0.8 + 0.2, a: Math.random() * 0.5 + 0.35 });
      }
      return list;
    }

    function begin() {
      if (dead) {
        reset(false);
        return;
      }
      if (!running) {
        running = true;
        overlay.classList.add("is-hidden");
      }
      if (mode === "classic") {
        var now = Date.now();
        thrusting = true;
        if (now - lastInput > 140) {
          ship.vy = Math.min(ship.vy, -2.45);
          addThrust();
        }
        lastInput = now;
      }
    }

    function end() {
      thrusting = false;
      pointerDown = false;
    }

    function canvasPosition(event) {
      var rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height };
    }

    function addThrust() {
      var i;
      for (i = 0; i < 7; i++) {
        particles.push({ x: ship.x - 23, y: ship.y + (Math.random() * 10 - 5), vx: -1.5 - Math.random() * 2.4, vy: Math.random() * 1.8 - 0.9, life: 18 + Math.random() * 8, size: 2 + Math.random() * 3 });
      }
    }

    function availableLanes(count, used) {
      var lanes = [];
      var i;
      for (i = 0; i < count; i++) if (!used[i]) lanes.push(i);
      return lanes;
    }

    function takeLane(count, used) {
      var lanes = availableLanes(count, used);
      if (!lanes.length) return null;
      var lane = lanes[Math.floor(Math.random() * lanes.length)];
      used[lane] = true;
      return lane;
    }

    function randomPlanetColor() {
      var colors = ["#8b5cf6", "#22c55e", "#06b6d4", "#f97316", "#ec4899", "#64748b", "#f59e0b"];
      return colors[Math.floor(Math.random() * colors.length)];
    }

    function hazardBudget() {
      return score < 8 ? 2 : 1 + Math.floor(Math.random() * (2 + Math.min(1, Math.floor((score - 8) / 12))));
    }

    function shouldSpawnComet() {
      return Math.random() < Math.min(0.46, 0.24 + score * 0.007);
    }

    function spawnClassic() {
      var laneCount = 5;
      var laneH = H / laneCount;
      var safe = Math.floor(Math.random() * laneCount);
      var used = {};
      var amount = hazardBudget();
      var comet = shouldSpawnComet();
      var planets = amount - (comet ? 1 : 0);
      var i;
      used[safe] = true;
      if (safe > 0 && Math.random() < 0.55) used[safe - 1] = true;
      if (safe < laneCount - 1 && Math.random() < 0.55) used[safe + 1] = true;
      for (i = 0; i < planets; i++) {
        var lane = takeLane(laneCount, used);
        if (lane === null) break;
        obstacles.push({ type: "planet", x: W + 70 + Math.random() * 150, y: lane * laneH + 24 + Math.random() * (laneH - 48), r: 10 + Math.random() * 11, vr: -0.022 + Math.random() * 0.044, rot: Math.random() * Math.PI, color: randomPlanetColor(), passed: false });
      }
      if (comet) {
        var cometLane = takeLane(laneCount, used);
        if (cometLane !== null) obstacles.push({ type: "comet", x: W + 145 + Math.random() * 115, y: cometLane * laneH + 26 + Math.random() * (laneH - 52), r: 12 + Math.random() * 9, vr: -0.018 + Math.random() * 0.036, rot: Math.random() * Math.PI, passed: false });
      }
      nextAt = frame + Math.max(62, 94 - Math.min(score, 30) * 0.85);
    }

    function spawnPortrait() {
      var cols = 5;
      var colW = W / cols;
      var safe = Math.floor(Math.random() * cols);
      var used = {};
      var amount = hazardBudget();
      var comet = shouldSpawnComet();
      var planets = amount - (comet ? 1 : 0);
      var i;
      used[safe] = true;
      if (safe > 0 && Math.random() < 0.45) used[safe - 1] = true;
      if (safe < cols - 1 && Math.random() < 0.45) used[safe + 1] = true;
      for (i = 0; i < planets; i++) {
        var col = takeLane(cols, used);
        if (col === null) break;
        obstacles.push({ type: "planet", x: col * colW + colW * 0.25 + Math.random() * colW * 0.5, y: -45 - Math.random() * 85, r: 11 + Math.random() * 12, vr: -0.022 + Math.random() * 0.044, rot: Math.random() * Math.PI, color: randomPlanetColor(), passed: false });
      }
      if (comet) {
        var cometCol = takeLane(cols, used);
        if (cometCol !== null) obstacles.push({ type: "comet", x: cometCol * colW + colW * 0.25 + Math.random() * colW * 0.5, y: -150 - Math.random() * 75, r: 12 + Math.random() * 9, vr: -0.018 + Math.random() * 0.036, rot: Math.random() * Math.PI, passed: false });
      }
      nextAt = frame + Math.max(42, 68 - Math.min(score, 35) * 0.6);
    }

    function update() {
      frame++;
      stars.forEach(function (star) {
        if (mode === "portrait") {
          star.y += star.v;
          if (star.y > H) { star.y = 0; star.x = Math.random() * W; }
        } else {
          star.x -= star.v;
          if (star.x < 0) { star.x = W; star.y = Math.random() * H; }
        }
      });
      particles.forEach(function (particle) { particle.x += particle.vx; particle.y += particle.vy; particle.life--; particle.size *= 0.97; });
      particles = particles.filter(function (particle) { return particle.life > 0; });
      if (!running || dead) return;
      if (mode === "classic") updateClassic(); else updatePortrait();
    }

    function updateClassic() {
      ship.vy = Math.min(6.1, ship.vy + 0.235);
      if (thrusting) {
        ship.vy -= 0.34;
        ship.vy = Math.max(ship.vy, -4.9);
        if (frame % 3 === 0) addThrust();
      }
      ship.y += ship.vy;
      ship.rot = Math.max(-0.45, Math.min(0.74, ship.vy / 11));
      if (frame >= nextAt) spawnClassic();
      obstacles.forEach(function (obstacle) {
        obstacle.x -= 2.55 + Math.min(score * 0.010, 0.34) + (obstacle.type === "comet" ? 0.48 : 0);
        obstacle.rot += obstacle.vr;
        if (!obstacle.passed && obstacle.x + obstacle.r < ship.x) {
          obstacle.passed = true;
          score++;
          scoreEl.textContent = String(score);
          fullscreenScoreEl.textContent = String(score);
        }
        if (circleHit(ship.x, ship.y, ship.r, obstacle.x, obstacle.y, obstacle.r - 1.5)) gameOver();
      });
      obstacles = obstacles.filter(function (obstacle) { return obstacle.x > -70; });
      if (ship.y < -20 || ship.y > H + 20) gameOver();
    }

    function updatePortrait() {
      if (keys.left) targetX -= 8;
      if (keys.right) targetX += 8;
      targetX = Math.max(28, Math.min(W - 28, targetX));
      ship.x += (targetX - ship.x) * 0.22;
      ship.rot = (targetX - ship.x) / 80;
      if (frame % 5 === 0) particles.push({ x: ship.x + (Math.random() * 10 - 5), y: ship.y + 20, vx: Math.random() * 1.2 - 0.6, vy: 1 + Math.random() * 2, life: 18, size: 2 + Math.random() * 3 });
      if (frame >= nextAt) spawnPortrait();
      obstacles.forEach(function (obstacle) {
        obstacle.y += 3.0 + Math.min(score * 0.018, 0.72) + (obstacle.type === "comet" ? 0.65 : 0);
        obstacle.rot += obstacle.vr;
        if (!obstacle.passed && obstacle.y - obstacle.r > ship.y) {
          obstacle.passed = true;
          score++;
          scoreEl.textContent = String(score);
          fullscreenScoreEl.textContent = String(score);
        }
        if (circleHit(ship.x, ship.y, ship.r, obstacle.x, obstacle.y, obstacle.r - 1.5)) gameOver();
      });
      obstacles = obstacles.filter(function (obstacle) { return obstacle.y < H + 80; });
    }

    function circleHit(x1, y1, r1, x2, y2, r2) {
      var dx = x1 - x2;
      var dy = y1 - y2;
      var radius = r1 + r2;
      return dx * dx + dy * dy < radius * radius;
    }

    function gameOver() {
      if (dead) return;
      dead = true;
      running = false;
      if (score > best) {
        best = score;
        setBest(best);
        bestEl.textContent = String(best);
        fullscreenBestEl.textContent = String(best);
        if (Intranet.logActivity) Intranet.logActivity({ type: "workspaceship_best", label: "Ny Spaceship-rekord: " + best });
      }
      overlayTitle.textContent = "Game over";
      overlayText.textContent = "Poeng: " + score + " — trykk for ny runde";
      overlay.classList.remove("is-hidden");
    }

    function drawBackground() {
      var gradient = ctx.createLinearGradient(0, 0, 0, H);
      gradient.addColorStop(0, "#061528");
      gradient.addColorStop(0.55, "#101827");
      gradient.addColorStop(1, "#1e1b4b");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);
    }

    function drawStars() {
      stars.forEach(function (star) {
        ctx.fillStyle = "rgba(255,255,255," + star.a + ")";
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.s, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    function drawParticles() {
      particles.forEach(function (particle) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, particle.life / 26);
        ctx.fillStyle = particle.life % 2 > 1 ? "#f97316" : "#facc15";
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    function drawPlanet(obstacle) {
      var gradient = ctx.createRadialGradient(obstacle.x - obstacle.r * 0.25, obstacle.y - obstacle.r * 0.25, obstacle.r * 0.08, obstacle.x, obstacle.y, obstacle.r);
      gradient.addColorStop(0, "#fff");
      gradient.addColorStop(0.25, obstacle.color);
      gradient.addColorStop(1, "#111827");
      ctx.save();
      ctx.beginPath();
      ctx.arc(obstacle.x, obstacle.y, obstacle.r, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(2, obstacle.r * 0.14);
      ctx.beginPath();
      ctx.ellipse(obstacle.x, obstacle.y, obstacle.r * 1.12, obstacle.r * 0.32, -0.25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function drawComet(obstacle) {
      var vertical = mode === "portrait";
      var glow;
      var tail;
      ctx.save();
      glow = ctx.createRadialGradient(obstacle.x, obstacle.y, 0, obstacle.x, obstacle.y, obstacle.r * 2.5);
      glow.addColorStop(0, "rgba(255,255,255,.3)");
      glow.addColorStop(0.45, "rgba(125,211,252,.18)");
      glow.addColorStop(1, "rgba(125,211,252,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(obstacle.x, obstacle.y, obstacle.r * 2.5, 0, Math.PI * 2);
      ctx.fill();
      tail = vertical ? ctx.createLinearGradient(obstacle.x, obstacle.y - obstacle.r * 5.5, obstacle.x, obstacle.y) : ctx.createLinearGradient(obstacle.x + obstacle.r * 5.5, obstacle.y, obstacle.x, obstacle.y);
      tail.addColorStop(0, "rgba(125,211,252,0)");
      tail.addColorStop(0.58, "rgba(125,211,252,.24)");
      tail.addColorStop(1, "rgba(255,255,255,.68)");
      ctx.fillStyle = tail;
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(obstacle.x - obstacle.r * 0.72, obstacle.y - obstacle.r * 5.5);
        ctx.lineTo(obstacle.x, obstacle.y - obstacle.r * 4.2);
        ctx.lineTo(obstacle.x + obstacle.r * 0.72, obstacle.y - obstacle.r * 5.5);
        ctx.lineTo(obstacle.x + obstacle.r * 0.28, obstacle.y + obstacle.r * 0.15);
        ctx.lineTo(obstacle.x - obstacle.r * 0.28, obstacle.y + obstacle.r * 0.15);
      } else {
        ctx.moveTo(obstacle.x + obstacle.r * 5.5, obstacle.y - obstacle.r * 0.72);
        ctx.lineTo(obstacle.x + obstacle.r * 4.2, obstacle.y);
        ctx.lineTo(obstacle.x + obstacle.r * 5.5, obstacle.y + obstacle.r * 0.72);
        ctx.lineTo(obstacle.x - obstacle.r * 0.15, obstacle.y + obstacle.r * 0.28);
        ctx.lineTo(obstacle.x - obstacle.r * 0.15, obstacle.y - obstacle.r * 0.28);
      }
      ctx.closePath();
      ctx.fill();
      ctx.translate(obstacle.x, obstacle.y);
      ctx.rotate(obstacle.rot);
      var body = ctx.createRadialGradient(-obstacle.r * 0.35, -obstacle.r * 0.35, obstacle.r * 0.1, 0, 0, obstacle.r * 1.15);
      body.addColorStop(0, "#f8fafc");
      body.addColorStop(0.35, "#cbd5e1");
      body.addColorStop(1, "#64748b");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(obstacle.r, -obstacle.r * 0.12);
      ctx.lineTo(obstacle.r * 0.55, obstacle.r * 0.72);
      ctx.lineTo(-obstacle.r * 0.25, obstacle.r * 0.95);
      ctx.lineTo(-obstacle.r * 0.95, obstacle.r * 0.28);
      ctx.lineTo(-obstacle.r * 0.7, -obstacle.r * 0.62);
      ctx.lineTo(obstacle.r * 0.25, -obstacle.r * 0.92);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
    }

    function drawShip() {
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.rot);
      if (mode === "classic" && running && (thrusting || ship.vy < 1)) {
        var flame = ctx.createLinearGradient(-18, 0, -38, 0);
        flame.addColorStop(0, "#facc15");
        flame.addColorStop(1, "#ef4444");
        ctx.fillStyle = flame;
        ctx.beginPath();
        ctx.moveTo(-15, -7);
        ctx.lineTo(-37 - Math.random() * 6, 0);
        ctx.lineTo(-15, 7);
        ctx.closePath();
        ctx.fill();
      }
      if (mode === "portrait") ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "#ef4444";
      ctx.beginPath(); ctx.moveTo(-6, 9); ctx.lineTo(-19, 20); ctx.lineTo(-14, 4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6, -9); ctx.lineTo(-19, -20); ctx.lineTo(-14, -4); ctx.closePath(); ctx.fill();
      var body = ctx.createLinearGradient(-18, 0, 22, 0);
      body.addColorStop(0, "#cbd5e1"); body.addColorStop(0.45, "#fff"); body.addColorStop(1, "#e5e7eb");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(25, 0); ctx.bezierCurveTo(15, -18, -9, -16, -21, -8); ctx.bezierCurveTo(-16, -3, -16, 3, -21, 8); ctx.bezierCurveTo(-9, 16, 15, 18, 25, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(15,23,42,.25)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#ef4444";
      ctx.beginPath(); ctx.moveTo(25, 0); ctx.bezierCurveTo(19, -8, 15, -10, 11, -11); ctx.bezierCurveTo(14, -4, 14, 4, 11, 11); ctx.bezierCurveTo(15, 10, 19, 8, 25, 0); ctx.fill();
      ctx.fillStyle = "#38bdf8"; ctx.beginPath(); ctx.arc(2, -2, 5.8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      drawBackground();
      drawStars();
      drawParticles();
      obstacles.forEach(function (obstacle) { if (obstacle.type === "comet") drawComet(obstacle); else drawPlanet(obstacle); });
      drawShip();
    }

    function loop() {
      if (destroyed) return;
      update();
      draw();
      raf = requestAnimationFrame(loop);
    }

    function setFullscreenIcon(on) {
      fullscreenIcon.innerHTML = on
        ? '<path d="M9 3v6H3M15 3v6h6M21 15h-6v6M3 15h6v6"/>'
        : '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/>';
    }

    function syncFullscreen() {
      var on = root.classList.contains("ws-immersive");
      fullscreenBtn.setAttribute("aria-pressed", on ? "true" : "false");
      fullscreenBtn.setAttribute("aria-label", on ? "Avslutt fullskjerm" : "Fullskjerm");
      fullscreenLabel.textContent = on ? "Avslutt" : "Fullskjerm";
      setFullscreenIcon(on);
      setTimeout(fit, 60);
    }

    function enterFullscreen() {
      root.classList.add("ws-immersive");
      var request = root.requestFullscreen || root.webkitRequestFullscreen;
      if (request) {
        try {
          var promise = request.call(root);
          if (promise && promise.catch) promise.catch(function () {});
        } catch (error) {}
      }
      syncFullscreen();
    }

    function leaveFullscreen() {
      root.classList.remove("ws-immersive");
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) {
          try { exit.call(document); } catch (error) {}
        }
      }
      syncFullscreen();
    }

    function toggleFullscreen() {
      if (root.classList.contains("ws-immersive")) leaveFullscreen(); else enterFullscreen();
    }

    function onFullscreenChange() {
      if (!document.fullscreenElement && !document.webkitFullscreenElement && root.classList.contains("ws-immersive")) root.classList.remove("ws-immersive");
      syncFullscreen();
    }

    function closeGame() {
      if (root.classList.contains("ws-immersive")) leaveFullscreen();
      if (typeof onClose === "function") onClose();
    }

    function toast(message) {
      toastEl.textContent = message;
      toastEl.classList.add("show");
      clearTimeout(toast._timer);
      toast._timer = setTimeout(function () { toastEl.classList.remove("show"); }, 2000);
    }

    function share() {
      var data = { title: "Spaceship", text: "Klarer du å slå rekorden?", url: location.href };
      if (navigator.share) {
        navigator.share(data).catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(location.href).then(function () { toast("Lenke kopiert"); }).catch(function () { toast(location.href); });
      } else {
        toast(location.href);
      }
    }

    function clearSelection() {
      var selection = window.getSelection && window.getSelection();
      if (selection && selection.removeAllRanges) selection.removeAllRanges();
    }

    function stagePosition(event) {
      var rect = canvas.getBoundingClientRect();
      var x = (event.clientX - rect.left) * W / rect.width;
      return { x: Math.max(0, Math.min(W, x)), y: 0 };
    }

    function stagePointerDown(event) {
      if (event.target && event.target.closest && event.target.closest("button,a,input,select,textarea")) return;
      if (event.cancelable) event.preventDefault();
      clearSelection();
      pointerDown = true;
      if (stage.setPointerCapture) { try { stage.setPointerCapture(event.pointerId); } catch (error) {} }
      if (mode === "portrait") targetX = stagePosition(event).x;
      begin();
    }

    function stagePointerMove(event) {
      if (!pointerDown) return;
      if (event.cancelable) event.preventDefault();
      clearSelection();
      if (mode === "portrait") { targetX = stagePosition(event).x; begin(); }
    }

    function stagePointerUp(event) {
      if (event && event.cancelable) event.preventDefault();
      end();
    }

    function blockNative(event) {
      if (root.contains(event.target)) { if (event.cancelable) event.preventDefault(); clearSelection(); }
    }

    function onTouchMove(event) { blockNative(event); }

    function onKeyDown(event) {
      if (!root.contains(document.activeElement) && !root.classList.contains("ws-immersive")) return;
      if (event.code === "Space" && mode === "classic") { event.preventDefault(); begin(); }
      if (event.code === "ArrowLeft") { event.preventDefault(); keys.left = true; begin(); }
      if (event.code === "ArrowRight") { event.preventDefault(); keys.right = true; begin(); }
      if (event.key === "Escape") {
        if (root.classList.contains("ws-immersive")) leaveFullscreen();
        else closeGame();
      }
    }

    function onKeyUp(event) {
      if (event.code === "Space") { event.preventDefault(); end(); }
      if (event.code === "ArrowLeft") keys.left = false;
      if (event.code === "ArrowRight") keys.right = false;
    }

    function onResize() { fit(); }
    function onOrientationChange() { setTimeout(fit, 160); }

    stage.addEventListener("pointerdown", stagePointerDown, { passive: false });
    stage.addEventListener("pointermove", stagePointerMove, { passive: false });
    stage.addEventListener("pointerup", stagePointerUp, { passive: false });
    stage.addEventListener("pointercancel", stagePointerUp, { passive: false });
    stage.addEventListener("lostpointercapture", end);
    stage.addEventListener("pointerleave", function () { if (mode === "classic") end(); });
    window.addEventListener("pointerup", end, { passive: true });
    window.addEventListener("pointercancel", end, { passive: true });
    window.addEventListener("blur", end);
    document.addEventListener("visibilitychange", function () { if (document.hidden) end(); });
    root.addEventListener("contextmenu", blockNative, { passive: false });
    root.addEventListener("selectstart", blockNative, { passive: false });
    root.addEventListener("dragstart", blockNative, { passive: false });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientationChange);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);
    classicBtn.addEventListener("click", function () { setMode("classic"); });
    portraitBtn.addEventListener("click", function () { setMode("portrait"); });
    fullscreenBtn.addEventListener("click", toggleFullscreen);
    shareBtn.addEventListener("click", share);
    closeBtn.addEventListener("click", closeGame);

    setMode(mode);
    syncFullscreen();
    raf = requestAnimationFrame(loop);

    var observer = new MutationObserver(function () {
      if (!document.body.contains(root)) {
        destroyed = true;
        cancelAnimationFrame(raf);
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
        document.removeEventListener("fullscreenchange", onFullscreenChange);
        document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onOrientationChange);
        if (window.visualViewport) window.visualViewport.removeEventListener("resize", onResize);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function close() {
    if (!activeHost) return;
    var host = activeHost;
    activeHost = null;
    activeRoot = null;
    document.body.style.overflow = "";
    document.body.removeChild(host);
  }

  function launch() {
    if (activeHost) return;
    injectStyles();
    activeHost = document.createElement("div");
    activeHost.className = "wsp-easter-egg-host";
    activeHost.setAttribute("role", "dialog");
    activeHost.setAttribute("aria-modal", "true");
    activeHost.setAttribute("aria-label", "Spaceship-spill");
    activeHost.innerHTML = '<div id="workspaceship-root" class="wsp-root"></div>';
    document.body.appendChild(activeHost);
    activeRoot = activeHost.querySelector("#workspaceship-root");
    document.body.style.overflow = "hidden";
    mountGame(activeHost, close);
    /* Fokus på selve dialogen gjør tastaturstyring forutsigbar uten å flytte visningen. */
    activeRoot.setAttribute("tabindex", "-1");
    activeRoot.focus({ preventScroll: true });
  }

  function findLogoCandidate(node) {
    var el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    var candidate;
    var depth = 0;

    if (!el) return null;

    candidate = el.closest && el.closest("[data-workspaceship-trigger]");
    if (candidate) return candidate;

    if (configuredSelector) {
      try {
        candidate = el.closest && el.closest(configuredSelector);
        if (candidate) return candidate;
      } catch (ignore) {}
    }

    /* Fallback for the existing Vibeverk brand. This survives sidebar re-renders
       because the listener is delegated from document rather than bound once to
       a logo node that may later be replaced. */
    while (el && el !== document.body && depth < 7) {
      var label = (el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title"))) || "";
      var text = (el.textContent || "").replace(/\s+/g, " ").trim();
      var classes = typeof el.className === "string" ? el.className : "";
      if (/vibeverk/i.test(label) || (/vibeverk/i.test(text) && /(?:logo|brand|workspace|sidebar|header|identity)/i.test(classes + " " + (el.id || "")))) {
        return el;
      }
      /* The current logo has visible text 'Vibeverk' above 'Workspace'. */
      if (/^vibeverk\s*workspace$/i.test(text) || /^vibeverk$/i.test(text)) return el;
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function registerLogoClick(event) {
    var candidate = findLogoCandidate(event.target);
    var now;
    if (!candidate) return;

    now = Date.now();
    tripleClickTimes = tripleClickTimes.filter(function (t) { return now - t < 780; });
    tripleClickTimes.push(now);

    if (tripleClickTimes.length >= 3) {
      tripleClickTimes = [];
      event.preventDefault();
      event.stopPropagation();
      launch();
    }
  }

  function attach(selector) {
    var target;
    configuredSelector = typeof selector === "string" ? selector : null;

    if (triggerElement && triggerHandler) triggerElement.removeEventListener("click", triggerHandler);
    triggerElement = null;
    triggerHandler = null;

    if (typeof selector === "string") {
      try { target = document.querySelector(selector); } catch (ignore) { target = null; }
    } else if (selector && selector.nodeType === 1) {
      target = selector;
    } else {
      target = document.querySelector("[data-workspaceship-trigger]");
    }

    /* Keep an explicit binding where possible, but rely on the delegated handler
       as well so it still works after the intranet replaces the sidebar/logo DOM. */
    if (target) {
      triggerElement = target;
      triggerHandler = registerLogoClick;
      target.addEventListener("click", triggerHandler);
    }

    if (!delegatedClickHandler) {
      delegatedClickHandler = registerLogoClick;
      document.addEventListener("click", delegatedClickHandler, true);
    }

    return !!target;
  }

  window.WorkspaceshipEasterEgg = {
    attach: attach,
    launch: launch,
    close: close
  };

  function autoAttach() {
    var config = window.WORKSPACESHIP_EASTER_EGG_CONFIG || {};
    if (config.autoAttach === false) return;
    attach(config.logoSelector || "[data-workspaceship-trigger]");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoAttach);
  else autoAttach();
})();
