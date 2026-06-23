/* =============================================================================
   module-workspaceship.js — WORKSPACESHIP (intranett easter egg)
   -----------------------------------------------------------------------------
   Flappy Bird-inspirert fokusspill for intranett, men med asteroidefelt i stedet
   for store "rør". Hindringer kommer hulter til bulter som små planeter/kometer.

   Styring: Hold inne Space / venstre museknapp / touch
   Lagring: App.store ("wsp-workspaceship")
   Avhengigheter: Intranet, App, Components. Ingen eksterne biblioteker.

   v7:
   - Ingen store planet-rammer
   - Små planeter/kometer som direkte hindringer
   - Fair spawning: hindringer fordeles i tidsvinduer og lanes
   - Minst én trygg passasje gjennom hvert felt
   - Hold inne Space/mus/touch for jevn thrust
   - Nedjustert og mer fair stigende vanskelighetsgrad
   - Penere kometer med krater og glød, men roligere spawn/fart
   ========================================================================== */
(function () {
  "use strict";

  var Intranet = window.Intranet;
  var App = window.App;
  var C = window.Components;
  if (!Intranet || !App || !C) return;

  var STORE_KEY = "wsp-workspaceship";

  function getState() {
    return App.store.get(STORE_KEY, { best: 0 }) || { best: 0 };
  }

  function setState(v) {
    App.store.set(STORE_KEY, v);
  }

  function render() {
    return '<div id="workspaceship-root"></div>';
  }

  function mount(outlet) {
    var root = outlet.querySelector("#workspaceship-root") || outlet;
    injectStyles();

    var saved = getState();

    root.innerHTML =
      '<div class="ws-game">' +
        '<div class="ws-game__head">' +
          '<div>' +
            '<p class="i-section-label">Easter egg</p>' +
            '<h2>Workspaceship</h2>' +
            '<p class="ws-game__hint">Hold inne <strong>Space</strong>, venstre museknapp eller touch for jevn thrust. Fly gjennom asteroidefeltet.</p>' +
          '</div>' +
          '<div class="ws-game__score">' +
            '<span>Beste</span>' +
            '<strong data-ws-best>' + C.esc(String(saved.best || 0)) + '</strong>' +
          '</div>' +
        '</div>' +
        '<div class="ws-canvas-wrap">' +
          '<canvas id="ws-canvas" width="720" height="420" aria-label="Workspaceship minigame"></canvas>' +
          '<div class="ws-overlay" data-ws-overlay>' +
            '<strong data-ws-title>Workspaceship</strong>' +
            '<span data-ws-text>Hold Space eller museknapp for å starte</span>' +
          '</div>' +
        '</div>' +
        '<div class="ws-game__foot">' +
          '<button class="btn btn--primary btn--sm" data-ws-restart>Start på nytt</button>' +
          '<span data-ws-status>Poeng: 0</span>' +
        '</div>' +
      '</div>';

    startGame(root);
  }

  function injectStyles() {
    if (document.getElementById("workspaceship-styles")) return;

    var s = document.createElement("style");
    s.id = "workspaceship-styles";
    s.textContent = [
      ".ws-game{max-width:820px;margin:0 auto}",
      ".ws-game__head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:1rem}",
      ".ws-game__head h2{margin:.1rem 0 .35rem}",
      ".ws-game__hint{margin:0;color:var(--color-muted);font-size:.92rem}",
      ".ws-game__score{min-width:84px;text-align:center;border:1px solid var(--color-border);border-radius:var(--radius);padding:.55rem .7rem;background:var(--color-surface)}",
      ".ws-game__score span{display:block;font-size:.72rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:.05em}",
      ".ws-game__score strong{font-size:1.4rem}",
      ".ws-canvas-wrap{position:relative;border-radius:var(--radius);overflow:hidden;border:1px solid var(--color-border);background:#07111f}",
      "#ws-canvas{display:block;width:100%;height:auto;touch-action:none;cursor:pointer}",
      ".ws-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:rgba(0,0,0,.35);color:white;gap:.3rem;pointer-events:none}",
      ".ws-overlay.is-hidden{display:none}",
      ".ws-overlay strong{font-size:1.6rem}",
      ".ws-overlay span{font-size:.95rem;opacity:.9}",
      ".ws-game__foot{display:flex;justify-content:space-between;align-items:center;margin-top:.8rem;color:var(--color-muted);font-size:.9rem}"
    ].join("");
    document.head.appendChild(s);
  }

  function startGame(root) {
    var canvas = root.querySelector("#ws-canvas");
    if (!canvas || !canvas.getContext) return;

    var ctx = canvas.getContext("2d");
    var overlay = root.querySelector("[data-ws-overlay]");
    var title = root.querySelector("[data-ws-title]");
    var text = root.querySelector("[data-ws-text]");
    var status = root.querySelector("[data-ws-status]");
    var bestEl = root.querySelector("[data-ws-best]");

    var W = canvas.width;
    var H = canvas.height;

    var ship;
    var obstacles;
    var stars;
    var particles;
    var score;
    var best;
    var running;
    var dead;
    var frame;
    var raf;
    var observer;
    var lastInput = 0;
    var thrusting = false;
    var nextFieldAt = 70;

    var GRAVITY = 0.235;
    var THRUST = -4.45;
    var MAX_FALL = 6.1;
    var SPEED = 2.55;
    var HOLD_THRUST = -0.34;

    function reset(waiting) {
      var saved = getState();
      best = saved.best || 0;
      bestEl.textContent = String(best);

      ship = { x: 120, y: H / 2, vy: 0, r: 15, rot: 0 };
      obstacles = [];
      stars = makeStars();
      particles = [];
      score = 0;
      frame = 0;
      running = !waiting;
      dead = false;
      lastInput = 0;
      thrusting = false;
      nextFieldAt = 70;

      overlay.classList.toggle("is-hidden", !waiting);
      title.textContent = "Workspaceship";
      text.textContent = "Hold Space eller museknapp for å starte";
      status.textContent = "Poeng: 0";
    }

    function makeStars() {
      var arr = [];
      var i;
      for (i = 0; i < 95; i++) {
        arr.push({
          x: Math.random() * W,
          y: Math.random() * H,
          s: Math.random() * 1.8 + 0.4,
          v: Math.random() * 0.8 + 0.2,
          a: Math.random() * 0.5 + 0.35
        });
      }
      return arr;
    }

    function beginThrust() {
      var now = Date.now();

      if (dead) {
        reset(false);
        thrusting = true;
        return;
      }

      if (!running) {
        running = true;
        overlay.classList.add("is-hidden");
      }

      thrusting = true;

      // Litt startløft, men ikke "hopp". Resten er jevn motor så lenge knappen holdes.
      if (now - lastInput > 140) {
        ship.vy = Math.min(ship.vy, THRUST * 0.55);
        addThrustParticles();
      }
      lastInput = now;
    }

    function endThrust() {
      thrusting = false;
    }

    function addThrustParticles() {
      var i;
      for (i = 0; i < 7; i++) {
        particles.push({
          x: ship.x - 23,
          y: ship.y + (Math.random() * 10 - 5),
          vx: -1.5 - Math.random() * 2.4,
          vy: Math.random() * 1.8 - 0.9,
          life: 18 + Math.random() * 8,
          size: 2 + Math.random() * 3
        });
      }
    }

    function spawnField() {
      /*
        I stedet for store rør lager vi et lite "felt" med 2–4 hindringer.
        For at det skal være fair:
        - Vi deler høyden i fem lanes.
        - Én lane + nabo-lane holdes alltid fri.
        - Hindringer får litt ulik x-posisjon så det føles hulter til bulter.
      */
      var laneCount = 5;
      var laneH = H / laneCount;
      var safeLane = Math.floor(Math.random() * laneCount);
      var amount = 2 + Math.floor(Math.random() * Math.min(3, 1 + Math.floor(score / 7)));
      var used = {};
      var i;

      used[safeLane] = true;
      if (safeLane > 0 && Math.random() < 0.55) used[safeLane - 1] = true;
      if (safeLane < laneCount - 1 && Math.random() < 0.55) used[safeLane + 1] = true;

      for (i = 0; i < amount; i++) {
        var lane = pickBlockedLane(laneCount, used);
        if (lane === null) break;

        used[lane] = true;

        var minY = lane * laneH + 24;
        var maxY = (lane + 1) * laneH - 24;
        var y = minY + Math.random() * Math.max(1, maxY - minY);

        var r = 9 + Math.random() * 10;
        if (score > 14) r += Math.random() * 1.6;
        if (score > 30) r += Math.random() * 1.4;

        obstacles.push({
          x: W + 70 + Math.random() * 150,
          y: y,
          r: r,
          rot: Math.random() * Math.PI,
          vr: -0.022 + Math.random() * 0.044,
          color: randomPlanetColor(),
          comet: Math.random() < Math.min(0.48, 0.28 + score * 0.007),
          passed: false
        });
      }

      nextFieldAt = frame + Math.max(62, 94 - Math.min(score, 30) * 0.85);
    }

    function pickBlockedLane(laneCount, used) {
      var candidates = [];
      var i;
      for (i = 0; i < laneCount; i++) {
        if (!used[i]) candidates.push(i);
      }
      if (!candidates.length) return null;
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    function randomPlanetColor() {
      var colors = ["#8b5cf6", "#22c55e", "#06b6d4", "#f97316", "#ec4899", "#64748b", "#f59e0b"];
      return colors[Math.floor(Math.random() * colors.length)];
    }

    function update() {
      frame++;

      stars.forEach(function (st) {
        st.x -= st.v;
        if (st.x < 0) {
          st.x = W;
          st.y = Math.random() * H;
        }
      });

      particles.forEach(function (p) {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
        p.size *= 0.97;
      });
      particles = particles.filter(function (p) { return p.life > 0; });

      if (!running || dead) return;

      ship.vy = Math.min(MAX_FALL, ship.vy + GRAVITY);

      if (thrusting) {
        ship.vy += HOLD_THRUST;
        ship.vy = Math.max(ship.vy, -4.9);
        if (frame % 3 === 0) addThrustParticles();
      }

      ship.y += ship.vy;
      ship.rot = Math.max(-0.45, Math.min(0.74, ship.vy / 11));

      if (frame >= nextFieldAt) spawnField();

      obstacles.forEach(function (o) {
        o.x -= SPEED + Math.min(score * 0.010, 0.34) + (o.comet ? 0.48 : 0);
        o.rot += o.vr;

        if (!o.passed && o.x + o.r < ship.x) {
          o.passed = true;
          score++;
          status.textContent = "Poeng: " + score;
        }

        if (circleHit(ship.x, ship.y, ship.r, o.x, o.y, o.r - 1.5)) {
          gameOver();
        }
      });

      obstacles = obstacles.filter(function (o) {
        return o.x > -60;
      });

      if (ship.y < -20 || ship.y > H + 20) gameOver();
    }

    function circleHit(x1, y1, r1, x2, y2, r2) {
      var dx = x1 - x2;
      var dy = y1 - y2;
      var rr = r1 + r2;
      return dx * dx + dy * dy < rr * rr;
    }

    function gameOver() {
      if (dead) return;

      dead = true;
      running = false;

      if (score > best) {
        best = score;
        setState({ best: best });
        bestEl.textContent = String(best);

        if (Intranet.logActivity) {
          Intranet.logActivity({
            type: "workspaceship_best",
            label: "Ny Workspaceship-rekord: " + best
          });
        }
      }

      title.textContent = "Game over";
      text.textContent = "Poeng: " + score + " — Space/klikk for ny runde";
      overlay.classList.remove("is-hidden");
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      drawBackground();
      drawStars();
      drawParticles();

      obstacles.forEach(drawObstacle);

      drawShip();

      raf = requestAnimationFrame(loop);
    }

    function drawBackground() {
      var grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#061528");
      grad.addColorStop(0.55, "#101827");
      grad.addColorStop(1, "#1e1b4b");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      ctx.globalAlpha = 0.14;
      ctx.fillStyle = "#7dd3fc";
      ctx.beginPath();
      ctx.arc(W * 0.78, H * 0.20, 110, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    function drawStars() {
      stars.forEach(function (st) {
        ctx.fillStyle = "rgba(255,255,255," + st.a + ")";
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.s, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    function drawParticles() {
      particles.forEach(function (p) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life / 26);
        ctx.fillStyle = p.life % 2 > 1 ? "#f97316" : "#facc15";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    function drawObstacle(o) {
      if (o.comet) drawComet(o);
      else drawMiniPlanet(o);
    }

    function drawComet(o) {
      ctx.save();

      // Ytre glød
      var glow = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r * 2.4);
      glow.addColorStop(0, "rgba(255,255,255,.28)");
      glow.addColorStop(0.45, "rgba(125,211,252,.16)");
      glow.addColorStop(1, "rgba(125,211,252,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r * 2.4, 0, Math.PI * 2);
      ctx.fill();

      // Dobbel hale
      var tail = ctx.createLinearGradient(o.x + o.r * 5.2, o.y, o.x, o.y);
      tail.addColorStop(0, "rgba(125,211,252,0)");
      tail.addColorStop(0.55, "rgba(125,211,252,.22)");
      tail.addColorStop(1, "rgba(255,255,255,.62)");
      ctx.fillStyle = tail;
      ctx.beginPath();
      ctx.moveTo(o.x + o.r * 5.2, o.y - o.r * 0.72);
      ctx.lineTo(o.x + o.r * 4.2, o.y);
      ctx.lineTo(o.x + o.r * 5.2, o.y + o.r * 0.72);
      ctx.lineTo(o.x - o.r * 0.15, o.y + o.r * 0.28);
      ctx.lineTo(o.x - o.r * 0.15, o.y - o.r * 0.28);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 0.36;
      ctx.fillStyle = "#fef3c7";
      ctx.beginPath();
      ctx.moveTo(o.x + o.r * 3.4, o.y - o.r * 0.28);
      ctx.lineTo(o.x + o.r * 1.1, o.y);
      ctx.lineTo(o.x + o.r * 3.4, o.y + o.r * 0.28);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.translate(o.x, o.y);
      ctx.rotate(o.rot);

      // Steinform
      var body = ctx.createRadialGradient(-o.r * 0.35, -o.r * 0.35, o.r * 0.1, 0, 0, o.r * 1.15);
      body.addColorStop(0, "#f8fafc");
      body.addColorStop(0.35, "#cbd5e1");
      body.addColorStop(1, "#64748b");
      ctx.fillStyle = body;

      ctx.beginPath();
      ctx.moveTo(o.r, -o.r * 0.12);
      ctx.lineTo(o.r * 0.55, o.r * 0.72);
      ctx.lineTo(-o.r * 0.25, o.r * 0.95);
      ctx.lineTo(-o.r * 0.95, o.r * 0.28);
      ctx.lineTo(-o.r * 0.70, -o.r * 0.62);
      ctx.lineTo(o.r * 0.25, -o.r * 0.92);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Krater
      drawCrater(-o.r * 0.22, -o.r * 0.15, o.r * 0.23);
      drawCrater(o.r * 0.25, o.r * 0.18, o.r * 0.16);
      drawCrater(o.r * 0.12, -o.r * 0.42, o.r * 0.12);

      ctx.restore();
    }

    function drawCrater(x, y, r) {
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1, r * 0.25);
      ctx.beginPath();
      ctx.arc(x - r * 0.12, y - r * 0.12, r * 0.82, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function drawMiniPlanet(o) {
      var grad = ctx.createRadialGradient(o.x - o.r * 0.25, o.y - o.r * 0.25, o.r * 0.08, o.x, o.y, o.r);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.22, o.color);
      grad.addColorStop(1, "#111827");

      ctx.save();

      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(2, o.r * 0.16);
      ctx.beginPath();
      ctx.ellipse(o.x, o.y, o.r * 1.15, o.r * 0.32, -0.25, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      ctx.arc(o.x - o.r * 0.20, o.y - o.r * 0.12, o.r * 0.18, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    function drawShip() {
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.rot);

      if (running && (thrusting || ship.vy < 1.0)) {
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

      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(-6, 9);
      ctx.lineTo(-19, 20);
      ctx.lineTo(-14, 4);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-6, -9);
      ctx.lineTo(-19, -20);
      ctx.lineTo(-14, -4);
      ctx.closePath();
      ctx.fill();

      var body = ctx.createLinearGradient(-18, 0, 22, 0);
      body.addColorStop(0, "#cbd5e1");
      body.addColorStop(0.45, "#ffffff");
      body.addColorStop(1, "#e5e7eb");

      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(25, 0);
      ctx.bezierCurveTo(15, -18, -9, -16, -21, -8);
      ctx.bezierCurveTo(-16, -3, -16, 3, -21, 8);
      ctx.bezierCurveTo(-9, 16, 15, 18, 25, 0);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(15,23,42,.25)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(25, 0);
      ctx.bezierCurveTo(19, -8, 15, -10, 11, -11);
      ctx.bezierCurveTo(14, -4, 14, 4, 11, 11);
      ctx.bezierCurveTo(15, 10, 19, 8, 25, 0);
      ctx.fill();

      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc(2, -2, 5.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, -4, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.restore();
    }

    function loop() {
      update();
      draw();
    }

    function keyDownHandler(e) {
      if (e.code === "Space") {
        e.preventDefault();
        beginThrust();
      }
    }

    function keyUpHandler(e) {
      if (e.code === "Space") {
        e.preventDefault();
        endThrust();
      }
    }

    canvas.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      beginThrust();
    });
    canvas.addEventListener("pointerup", endThrust);
    canvas.addEventListener("pointerleave", endThrust);
    canvas.addEventListener("pointercancel", endThrust);

    root.querySelector("[data-ws-restart]").addEventListener("click", function () {
      reset(false);
    });

    document.addEventListener("keydown", keyDownHandler);
    document.addEventListener("keyup", keyUpHandler);

    reset(true);
    if (typeof requestAnimationFrame === "function") loop();

    // Cleanup: avregistrer listeners og stopp loop når root fjernes fra DOM
    function cleanup() {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", keyDownHandler);
      document.removeEventListener("keyup", keyUpHandler);
      if (observer) observer.disconnect();
    }

    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(function () {
        if (!document.body.contains(root)) cleanup();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    // Eksponér cleanup for modal-lukking
    root._wsCleanup = cleanup;
  }


  /* =========================================================================
     EASTER EGG — trippelklikk på logo åpner spillet som overlay
     ====================================================================== */
  function injectEasterEggStyles() {
    if (document.getElementById("ws-egg-styles")) return;
    var s = document.createElement("style");
    s.id = "ws-egg-styles";
    s.textContent = [
      "#ws-egg-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:500;display:flex;align-items:center;justify-content:center;padding:1rem}",
      "#ws-egg-modal{background:var(--color-bg);border-radius:var(--radius);width:min(860px,100%);max-height:92vh;overflow-y:auto;box-shadow:0 30px 80px rgba(0,0,0,.4);display:flex;flex-direction:column}",
      "#ws-egg-head{display:flex;align-items:center;justify-content:space-between;padding:.8rem 1.1rem;border-bottom:1px solid var(--color-border);flex-shrink:0}",
      "#ws-egg-head span{font-size:.78rem;color:var(--color-muted);font-style:italic}",
      "#ws-egg-close{background:none;border:0;font-size:1.4rem;cursor:pointer;color:var(--color-muted);line-height:1;padding:.2rem .4rem}",
      "#ws-egg-body{padding:1.1rem;flex:1}"
    ].join("");
    document.head.appendChild(s);
  }

  function openEasterEgg() {
    if (document.getElementById("ws-egg-backdrop")) return;
    injectEasterEggStyles();

    var bd = document.createElement("div");
    bd.id = "ws-egg-backdrop";

    var modal = document.createElement("div");
    modal.id = "ws-egg-modal";
    modal.innerHTML =
      '<div id="ws-egg-head">' +
        '<span>🚀 Workspaceship v7</span>' +
        '<button id="ws-egg-close" aria-label="Lukk">&#x2715;</button>' +
      '</div>' +
      '<div id="ws-egg-body"></div>';

    bd.appendChild(modal);
    document.body.appendChild(bd);

    // Mount spillet i modal-body
    var body = modal.querySelector("#ws-egg-body");
    body.innerHTML = render();
    mount(body);

    function close() {
      var root = body.querySelector("#workspaceship-root") || body;
      if (root._wsCleanup) root._wsCleanup();
      bd.remove();
      document.removeEventListener("keydown", escHandler);
    }

    function escHandler(e) {
      if (e.key === "Escape") close();
    }

    modal.querySelector("#ws-egg-close").addEventListener("click", close);
    bd.addEventListener("click", function (e) { if (e.target === bd) close(); });
    document.addEventListener("keydown", escHandler);
  }

  function bindEasterEggTrigger() {
    // Trippelklikk på sidebar-brand (logo/navn-området)
    var brand = document.querySelector(".i-sidebar__brand");
    if (!brand) return;

    var clicks = 0;
    var timer = null;
    brand.addEventListener("click", function () {
      clicks++;
      clearTimeout(timer);
      timer = setTimeout(function () { clicks = 0; }, 600);
      if (clicks >= 3) {
        clicks = 0;
        openEasterEgg();
      }
    });
  }

  /* =========================================================================
     REGISTRERING — skjult (vises ikke i nav)
     ====================================================================== */
  // Bind trigger når DOM er klar (shell er allerede rendret av intranet-core.js)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindEasterEggTrigger);
  } else {
    // Shell er allerede oppe — bind med liten delay så nav er i DOM
    setTimeout(bindEasterEggTrigger, 0);
  }

  // Ikke registrer i nav — easter egg er kun tilgjengelig via trippelklikk.
  // Beholder registerModule for direktenavigasjon (#/workspaceship) om ønskelig
  // men setter hideFromNav: true slik at intranet-core kan filtrere det ut.
  Intranet.registerModule({
    id:          "workspaceship",
    navLabel:    "Workspaceship",
    icon:        "rocket",
    order:       999,
    hideFromNav: true,   // intranett-shell viser ikke denne i sidebar
    render:      render,
    mount:       mount
  });

})();
