/**
 * LOOPS ENGINE — shared game engine for all Loops Learning Tools games.
 * One file, used by every published game (linked, not copy-pasted), so a fix
 * here fixes every game in the library at once.
 *
 * Usage in a published game file:
 *   <div id="loopsApp"></div>
 *   <script src="../engine.js"></script>
 *   <script>
 *     const GAME_DATA = { slug, name, emoji, category, background, loops: [...] };
 *     LoopsEngine.init(GAME_DATA);
 *   </script>
 *
 * GAME_DATA shape:
 *   {
 *     slug: "world-capitals",
 *     name: "World Capitals",
 *     emoji: "🌍",
 *     category: "Language",
 *     background: null,            // optional base64/url
 *     loops: [
 *       { name: "Loop 1", emoji: "🟦", timeLimit: 15, qs: [
 *           { type:"mc", q:"...", a:"Paris", opts:["Paris","Berlin","Rome","Madrid"] },
 *           { type:"typed", q:"...", a:"paris", hint:"Starts with P" }
 *       ]}
 *     ]
 *   }
 */
(function () {
  "use strict";

  var GAME = null;
  var save = null;
  var G = { loopIdx: 0, queue: [], qi: 0, correct: 0, wrongs: 0, requeued: null, answered: false, timer: null, t: 0, startMs: 0 };

  // ── STORAGE ──
  function saveKey() { return "loops_save_" + GAME.slug; }
  function loadSave() {
    try { save = JSON.parse(localStorage.getItem(saveKey())) || { unlocked: 0, best: {}, lives: 5 }; }
    catch (e) { save = { unlocked: 0, best: {}, lives: 5 }; }
    if (typeof save.unlocked !== "number") save.unlocked = 0;
    if (!save.best) save.best = {};
    if (typeof save.lives !== "number") save.lives = 5;
  }
  function persist() { try { localStorage.setItem(saveKey(), JSON.stringify(save)); } catch (e) {} }

  // ── HELPERS ──
  function el(id) { return document.getElementById(id); }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }
  function normalise(s) {
    return (s || "").toString().trim().toLowerCase().replace(/[^\w\sáéíóúüñàèìòùâêîôûäëïöüçãõ]/gi, "");
  }
  function fmtTime(sec) { return sec ? sec.toFixed(1) + "s" : "—"; }

  // ── SOUND ──
  var _ctx = null;
  function beep(freq, dur, type, vol) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!_ctx) _ctx = new Ctx();
      if (_ctx.state === "suspended") _ctx.resume();
      var now = _ctx.currentTime;
      var osc = _ctx.createOscillator();
      var gain = _ctx.createGain();
      osc.type = type || "triangle";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(vol || 0.03, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.12));
      osc.connect(gain); gain.connect(_ctx.destination);
      osc.start(now); osc.stop(now + (dur || 0.12) + 0.02);
    } catch (e) {}
  }
  function toneGood() { beep(660, 0.08, "triangle", 0.03); setTimeout(function () { beep(880, 0.1, "triangle", 0.03); }, 80); }
  function toneBad() { beep(220, 0.12, "sawtooth", 0.025); }
  function toneStart() { beep(392, 0.1, "triangle", 0.025); setTimeout(function () { beep(523, 0.12, "triangle", 0.03); }, 80); }
  function toneWin() { beep(523, 0.08, "triangle", 0.03); setTimeout(function () { beep(659, 0.08, "triangle", 0.03); }, 80); setTimeout(function () { beep(784, 0.12, "triangle", 0.035); }, 160); }

  function confetti() {
    for (var i = 0; i < 24; i++) {
      (function (i) {
        var p = document.createElement("div");
        p.style.cssText = "position:fixed;left:" + (Math.random() * 100) + "vw;top:-20px;width:10px;height:14px;border-radius:3px;" +
          "background:" + (i % 2 === 0 ? "#ffd43b" : "#00c2b3") + ";z-index:9999;pointer-events:none;opacity:.95;" +
          "transform:rotate(" + (Math.random() * 360) + "deg);transition:transform 1.5s ease-out, top 1.5s ease-out, opacity 1.5s ease-out;";
        document.body.appendChild(p);
        requestAnimationFrame(function () {
          p.style.top = "105vh";
          p.style.transform = "translateX(" + ((Math.random() - 0.5) * 160) + "px) rotate(" + (Math.random() * 720) + "deg)";
          p.style.opacity = "0.08";
        });
        setTimeout(function () { p.remove(); }, 1600);
      })(i);
    }
  }

  // ── STYLES ──
  function injectStyles() {
    if (document.getElementById("loopsEngineStyles")) return;
    var css = "" +
      "#loopsApp{--navy:#0b2d5c;--blue:#2b6cff;--teal:#00c2b3;--gold:#ffd43b;--ink:#0f172a;--light:#f4f7fb;--red:#c94c4c;" +
      "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);max-width:520px;margin:0 auto;padding:16px;}" +
      ".loops-screen{display:none;} .loops-screen.active{display:block;}" +
      ".loops-header{text-align:center;margin-bottom:18px;} .loops-header h1{font-size:1.5rem;margin:6px 0 2px;}" +
      ".loops-header .sub{opacity:.7;font-size:.9rem;}" +
      ".loops-header .loops-logo-mark{height:36px;width:auto;border-radius:5px;margin-bottom:4px;}" +
      ".loops-grid{display:grid;gap:12px;}" +
      ".loops-tile{background:var(--light);border:2px solid #e2e8f0;border-radius:14px;padding:16px;cursor:pointer;transition:.15s;}" +
      ".loops-tile.locked{opacity:.55;cursor:not-allowed;}" +
      ".loops-tile:not(.locked):hover{border-color:var(--blue);transform:translateY(-2px);}" +
      ".loops-tile-top{display:flex;align-items:center;gap:10px;font-weight:800;font-size:1.05rem;}" +
      ".loops-tile-meta{font-size:.82rem;opacity:.7;margin-top:6px;}" +
      ".loops-timerwrap{width:100%;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-bottom:14px;}" +
      "#loopsTimerBar{height:100%;background:var(--teal);transition:width .1s linear,background .3s;}" +
      ".loops-q{font-size:1.2rem;font-weight:800;margin-bottom:18px;line-height:1.4;}" +
      ".loops-opts{display:flex;flex-direction:column;gap:10px;}" +
      ".loops-opt{padding:13px;border:2px solid #e2e8f0;border-radius:10px;background:#fff;text-align:left;font-weight:600;cursor:pointer;font-size:1rem;}" +
      ".loops-opt:hover:not(:disabled){border-color:var(--blue);}" +
      ".loops-opt.correct{background:#dcfce7;border-color:#86efac;color:#166534;}" +
      ".loops-opt.wrong{background:#fee2e2;border-color:#fca5a5;color:#991b1b;}" +
      ".loops-opt.faded{opacity:.45;}" +
      ".loops-input{width:100%;padding:13px;border:2px solid #e2e8f0;border-radius:10px;font-size:1rem;margin-bottom:10px;}" +
      ".loops-btn{padding:12px 20px;border-radius:20px;border:none;font-size:1rem;cursor:pointer;color:#fff;font-weight:700;" +
      "background:linear-gradient(135deg,var(--navy),#134a97);width:100%;}" +
      ".loops-btn.ghost{background:transparent;color:var(--navy);border:2px solid #e2e8f0;}" +
      ".loops-btn:disabled{opacity:.5;cursor:not-allowed;}" +
      ".loops-hint{background:#fffbea;border:1px solid var(--gold);border-radius:10px;padding:10px;font-size:.85rem;margin-bottom:10px;}" +
      ".loops-meta-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:.85rem;}" +
      ".loops-fb{margin-top:14px;padding:12px;border-radius:10px;font-weight:700;text-align:center;}" +
      ".loops-fb.good{background:#dcfce7;color:#166534;} .loops-fb.bad{background:#fee2e2;color:#991b1b;}" +
      ".loops-result{text-align:center;padding:10px 0;}" +
      ".loops-result .big{font-size:2rem;font-weight:900;color:var(--navy);}" +
      ".loops-stack{display:flex;flex-direction:column;gap:10px;margin-top:16px;}";
    var style = document.createElement("style");
    style.id = "loopsEngineStyles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── SKELETON ──
  function buildSkeleton() {
    var root = el("loopsApp");
    root.innerHTML =
      '<div class="loops-header">' +
      '<img class="loops-logo-mark" src="' + (GAME.logoPath || "../Loops_logo.webp") + '" alt="Loops" onerror="this.style.display=\'none\'">' +
      '<div style="font-size:2rem;">' + (GAME.emoji || "🎮") + '</div>' +
      "<h1>" + GAME.name + "</h1><div class=\"sub\">Loops Learning Tools · Dublin</div></div>" +
      '<div id="loopsHome" class="loops-screen active">' +
      '<div id="loopsGrid" class="loops-grid"></div>' +
      '<div class="loops-stack"><button class="loops-btn ghost" id="loopsResetBtn">Reset progress</button></div>' +
      "</div>" +
      '<div id="loopsPlay" class="loops-screen">' +
      '<div class="loops-meta-row"><span id="loopsQProg"></span><span id="loopsTimerLabel"></span></div>' +
      '<div class="loops-timerwrap"><div id="loopsTimerBar"></div></div>' +
      '<div class="loops-q" id="loopsQText"></div>' +
      '<div id="loopsOptsWrap" class="loops-opts"></div>' +
      '<div id="loopsTypedWrap" style="display:none;">' +
      '<input class="loops-input" id="loopsTypedInput" placeholder="Type your answer..." autocomplete="off" />' +
      '<button class="loops-btn" id="loopsSubmitBtn">Submit</button></div>' +
      '<button class="loops-btn ghost" id="loopsHintBtn" style="margin-top:10px;">💡 Hint (costs 1 life · ' +
      '<span id="loopsLivesLeft"></span> left)</button>' +
      '<div id="loopsFb" class="loops-fb" style="display:none;"></div>' +
      '<button class="loops-btn" id="loopsNextBtn" style="display:none;margin-top:10px;">Next →</button>' +
      "</div>" +
      '<div id="loopsResult" class="loops-screen"><div class="loops-result">' +
      '<div id="loopsResultTitle" style="font-size:1.2rem;font-weight:800;margin-bottom:8px;"></div>' +
      '<div class="big" id="loopsResultTime"></div>' +
      '<div style="opacity:.7;font-size:.85rem;margin-top:4px;">Score: <span id="loopsResultScore"></span></div>' +
      '<div class="loops-stack"><button class="loops-btn" id="loopsAgainBtn">Play again</button>' +
      '<button class="loops-btn ghost" id="loopsBackBtn">Back to loops</button></div>' +
      "</div></div>";

    el("loopsResetBtn").addEventListener("click", function () {
      if (!confirm("Reset all progress for this game?")) return;
      save = { unlocked: 0, best: {}, lives: 5 };
      persist();
      renderHome();
    });
  }

  // ── HOME ──
  function renderHome() {
    show("loopsHome");
    var grid = el("loopsGrid");
    grid.innerHTML = "";
    GAME.loops.forEach(function (loop, idx) {
      var unlocked = idx <= save.unlocked;
      var best = save.best[idx];
      var tile = document.createElement("div");
      tile.className = "loops-tile " + (unlocked ? "" : "locked");
      tile.innerHTML =
        '<div class="loops-tile-top"><span>' + (loop.emoji || "🔹") + "</span><span>" + loop.name + "</span></div>" +
        '<div class="loops-tile-meta">' + loop.qs.length + " questions · Best: " + (best ? fmtTime(best) : "—") + "</div>" +
        '<div class="loops-tile-meta">' + (unlocked ? "Tap to play →" : "🔒 Locked") + "</div>";
      if (unlocked) tile.addEventListener("click", function () { openLoop(idx); });
      grid.appendChild(tile);
    });
  }

  function show(id) {
    document.querySelectorAll("#loopsApp .loops-screen").forEach(function (s) { s.classList.remove("active"); });
    el(id).classList.add("active");
  }

  // ── LOOP PLAY ──
  function openLoop(idx) {
    G.loopIdx = idx;
    var loop = GAME.loops[idx];
    G.queue = shuffle(loop.qs);
    G.qi = 0; G.correct = 0; G.wrongs = 0; G.requeued = {};
    G.startMs = performance.now();
    show("loopsPlay");
    toneStart();
    renderQuestion();
  }

  function renderQuestion() {
    var loop = GAME.loops[G.loopIdx];
    var q = G.queue[G.qi];
    G.answered = false;
    el("loopsQProg").textContent = (G.qi + 1) + " / " + G.queue.length;
    el("loopsQText").textContent = q.q;
    el("loopsLivesLeft").textContent = save.lives;
    el("loopsFb").style.display = "none";
    el("loopsNextBtn").style.display = "none";
    el("loopsHintBtn").style.display = save.lives > 0 ? "block" : "none";

    if (q.type === "mc") {
      el("loopsOptsWrap").style.display = "flex";
      el("loopsTypedWrap").style.display = "none";
      var wrap = el("loopsOptsWrap");
      wrap.innerHTML = "";
      shuffle(q.opts || [q.a]).forEach(function (opt) {
        var b = document.createElement("button");
        b.className = "loops-opt";
        b.textContent = opt;
        b.addEventListener("click", function () { submitMC(opt, b); });
        wrap.appendChild(b);
      });
    } else {
      el("loopsOptsWrap").style.display = "none";
      el("loopsTypedWrap").style.display = "block";
      var inp = el("loopsTypedInput");
      inp.value = ""; inp.disabled = false;
      el("loopsSubmitBtn").onclick = submitTyped;
      inp.onkeydown = function (e) { if (e.key === "Enter") submitTyped(); };
      setTimeout(function () { inp.focus(); }, 50);
    }

    startTimer((GAME.loops[G.loopIdx].timeLimit) || 15);
  }

  function startTimer(limit) {
    clearInterval(G.timer);
    G.t = limit;
    updateBar(limit, limit);
    el("loopsTimerLabel").textContent = limit.toFixed(0) + "s";
    G.timer = setInterval(function () {
      G.t -= 0.1;
      updateBar(G.t, limit);
      el("loopsTimerLabel").textContent = Math.max(0, G.t).toFixed(1) + "s";
      if (G.t <= 0) { clearInterval(G.timer); timeUp(); }
    }, 100);
  }
  function updateBar(t, limit) {
    var pct = Math.max(0, (t / limit) * 100);
    var bar = el("loopsTimerBar");
    bar.style.width = pct + "%";
    bar.style.background = pct < 25 ? "#c94c4c" : pct < 50 ? "#c9a84c" : "#00c2b3";
  }

  function timeUp() {
    if (G.answered) return;
    G.answered = true;
    toneBad();
    var q = G.queue[G.qi];
    if (q.type === "mc") {
      document.querySelectorAll(".loops-opt").forEach(function (b) {
        if (b.textContent === q.a) b.classList.add("correct"); else b.classList.add("faded");
        b.disabled = true;
      });
    } else {
      el("loopsTypedInput").disabled = true;
    }
    requeue(q);
    showFeedback(false, q, "⏱ Time's up");
  }

  function requeue(q) {
    var key = q.q;
    if (!G.requeued[key]) {
      G.requeued[key] = true;
      G.queue.push(q);
    }
  }

  function submitMC(choice, btn) {
    if (G.answered) return;
    G.answered = true;
    clearInterval(G.timer);
    var q = G.queue[G.qi];
    var ok = choice === q.a;
    document.querySelectorAll(".loops-opt").forEach(function (b) {
      b.disabled = true;
      if (b.textContent === q.a) b.classList.add("correct");
      else if (b === btn && !ok) b.classList.add("wrong");
      else b.classList.add("faded");
    });
    handleResult(ok, q);
  }

  function submitTyped() {
    if (G.answered) return;
    G.answered = true;
    clearInterval(G.timer);
    var q = G.queue[G.qi];
    var inp = el("loopsTypedInput");
    inp.disabled = true;
    var ok = normalise(inp.value) === normalise(q.a);
    handleResult(ok, q, q.a);
  }

  function handleResult(ok, q, correctAnswer) {
    if (ok) { G.correct++; toneGood(); } else { G.wrongs++; toneBad(); requeue(q); }
    showFeedback(ok, q, ok ? "✔ Correct" : ("✖ Not quite — " + (correctAnswer || q.a)));
  }

  function showFeedback(ok, q, msg) {
    var fb = el("loopsFb");
    fb.className = "loops-fb " + (ok ? "good" : "bad");
    fb.textContent = msg;
    fb.style.display = "block";
    el("loopsHintBtn").style.display = "none";
    var nextBtn = el("loopsNextBtn");
    nextBtn.style.display = "block";
    nextBtn.onclick = nextQuestion;
  }

  function useHint() {
    if (save.lives <= 0) return;
    save.lives--;
    persist();
    var q = G.queue[G.qi];
    var hintText = q.hint ? q.hint : ("Starts with \"" + (q.a || "").charAt(0).toUpperCase() + "\"");
    var box = document.createElement("div");
    box.className = "loops-hint";
    box.textContent = "💡 " + hintText;
    el("loopsHintBtn").replaceWith(box);
    el("loopsLivesLeft") && (el("loopsLivesLeft").textContent = save.lives);
  }

  function nextQuestion() {
    G.qi++;
    if (G.qi >= G.queue.length) { finishLoop(); }
    else { renderQuestion(); }
  }

  function finishLoop() {
    clearInterval(G.timer);
    var elapsed = (performance.now() - G.startMs) / 1000;
    var oldBest = save.best[G.loopIdx];
    var isNewBest = !oldBest || elapsed < oldBest;
    if (isNewBest) save.best[G.loopIdx] = elapsed;

    var cleanPass = G.wrongs === 0;
    if (cleanPass && save.unlocked === G.loopIdx && G.loopIdx < GAME.loops.length - 1) {
      save.unlocked = G.loopIdx + 1;
    } else if (save.unlocked === G.loopIdx && G.loopIdx < GAME.loops.length - 1) {
      // still unlock next even with mistakes — practice shouldn't punish progress
      save.unlocked = G.loopIdx + 1;
    }
    persist();

    show("loopsResult");
    el("loopsResultTitle").textContent = isNewBest ? "🏆 New best time!" : "Loop complete";
    el("loopsResultTime").textContent = fmtTime(elapsed);
    el("loopsResultScore").textContent = G.correct + " correct, " + G.wrongs + " missed";
    toneWin();
    if (isNewBest) confetti();

    el("loopsAgainBtn").onclick = function () { openLoop(G.loopIdx); };
    el("loopsBackBtn").onclick = renderHome;
  }

  // Delegate hint button clicks (element gets replaced on use, so bind at play-render time too)
  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "loopsHintBtn") useHint();
  });

  // ── INIT ──
  window.LoopsEngine = {
    init: function (gameData) {
      GAME = gameData;
      loadSave();
      injectStyles();
      buildSkeleton();
      renderHome();
    }
  };
})();
