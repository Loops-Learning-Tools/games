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
 *
 * MASTERY / WEAK SPOTS
 * Every question is answered correctly at least MASTERY_TARGET (10) times
 * before it's considered learned. The first time a question is missed —
 * anywhere, in any loop — it starts being tracked in save.mastery as a
 * running correct-count. It never resets on a further miss, it just sits at
 * whatever count it's at until it reaches 10. Any tracked-but-not-mastered
 * question is a "weak spot" and stays pullable into review regardless of
 * which loop it originally came from — mistakes follow you across the whole
 * game, not just within the loop you made them in.
 */
(function () {
  "use strict";

  var MASTERY_TARGET = 10;

  var GAME = null;
  var save = null;
  var QUESTION_INDEX = []; // flat list of { key, q, loopIdx } across all loops
  var G = { mode: "loop", loopIdx: 0, queue: [], qi: 0, correct: 0, wrongs: 0, requeued: null, seenKeys: null, firstTryCorrect: 0, answered: false, timer: null, t: 0, startMs: 0 };

  // ── STORAGE ──
  function saveKey() { return "loops_save_" + GAME.slug; }
  function loadSave() {
    try { save = JSON.parse(localStorage.getItem(saveKey())) || {}; }
    catch (e) { save = {}; }
    if (typeof save.unlocked !== "number") save.unlocked = 0;
    if (!save.best) save.best = {};
    if (!save.bestScore) save.bestScore = {};
    if (typeof save.lives !== "number") save.lives = 5;
    if (!save.mastery) save.mastery = {}; // { questionKey: correctCount }
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
  function questionKey(q) { return normalise(q.q) + "|" + normalise(q.a); }

  var CORRECT_PHRASES = ["✔ Nice one!", "✔ Got it!", "✔ Sharp!", "✔ Yes!", "✔ Correct!", "✔ Nailed it!"];
  var WRONG_PHRASES = ["Not quite", "So close", "Almost", "Not this time"];
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function buildQuestionIndex() {
    QUESTION_INDEX = [];
    GAME.loops.forEach(function (loop, loopIdx) {
      loop.qs.forEach(function (q) {
        QUESTION_INDEX.push({ key: questionKey(q), q: q, loopIdx: loopIdx });
      });
    });
  }

  function weakSpots() {
    var seen = {};
    var out = [];
    QUESTION_INDEX.forEach(function (item) {
      var count = save.mastery[item.key];
      if (count !== undefined && count < MASTERY_TARGET && !seen[item.key]) {
        seen[item.key] = true;
        out.push(item);
      }
    });
    return out;
  }

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
  function toneMastered() { beep(784, 0.09, "triangle", 0.035); setTimeout(function () { beep(988, 0.09, "triangle", 0.035); }, 90); setTimeout(function () { beep(1175, 0.14, "triangle", 0.04); }, 180); }

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
      ".loops-tile.weak{border-color:var(--gold);background:#fffbea;}" +
      ".loops-tile.halfway{border-color:var(--teal);background:#e6faf7;}" +
      ".loops-tile-top{display:flex;align-items:center;gap:10px;font-weight:800;font-size:1.05rem;}" +
      ".loops-tile-meta{font-size:.82rem;opacity:.7;margin-top:6px;}" +
      ".loops-badge{display:inline-block;background:var(--gold);color:#3d2c00;font-size:.72rem;font-weight:800;padding:2px 8px;border-radius:10px;margin-left:6px;}" +
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
      ".loops-fb.mastered{background:#fef9c3;color:#854d0e;}" +
      ".loops-result{text-align:center;padding:10px 0;}" +
      ".loops-result .big{font-size:2rem;font-weight:900;color:var(--navy);}" +
      ".loops-stack{display:flex;flex-direction:column;gap:10px;margin-top:16px;}" +
      ".loops-section-label{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;opacity:.55;font-weight:800;margin:18px 0 8px;}";
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
      '<img class="loops-logo-mark" src="' + (GAME.logoPath || "../Loops_triskel_mark.png") + '" alt="Loops" onerror="this.style.display=&#39;none&#39;">' +
      '<div style="font-size:2rem;">' + (GAME.emoji || "🎮") + '</div>' +
      "<h1>" + GAME.name + "</h1><div class=&#39;sub&#39;>Loops Learning Tools · Dublin</div></div>" +
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
      '<div style="opacity:.7;font-size:.85rem;margin-top:4px;" id="loopsResultScore"></div>' +
      '<div class="loops-stack"><button class="loops-btn" id="loopsAgainBtn">Play again</button>' +
      '<button class="loops-btn ghost" id="loopsBackBtn">Back to loops</button></div>' +
      "</div></div>";

    el("loopsResetBtn").addEventListener("click", function () {
      if (!confirm("Reset all progress for this game?")) return;
      save = { unlocked: 0, best: {}, bestScore: {}, lives: 5, mastery: {} };
      persist();
      renderHome();
    });
  }

  // ── HOME ──
  function renderHome() {
    show("loopsHome");
    var grid = el("loopsGrid");
    grid.innerHTML = "";

    var ws = weakSpots();
    if (ws.length > 0) {
      var wsTile = document.createElement("div");
      wsTile.className = "loops-tile weak";
      wsTile.innerHTML =
        '<div class="loops-tile-top"><span>🎯</span><span>Weak Spots</span><span class="loops-badge">' + ws.length + '</span></div>' +
        '<div class="loops-tile-meta">You&#39;re closer than you think — ' + MASTERY_TARGET + ' correct and any question is yours for good.</div>' +
        '<div class="loops-tile-meta">Tap to level up →</div>';
      wsTile.addEventListener("click", function () { openReview(ws, "Weak Spots"); });
      grid.appendChild(wsTile);
    }

    GAME.loops.forEach(function (loop, idx) {
      var unlocked = idx <= save.unlocked;
      var best = save.best[idx];
      var bestScore = save.bestScore[idx];

      var tile = document.createElement("div");
      tile.className = "loops-tile " + (unlocked ? "" : "locked");
      tile.innerHTML =
        '<div class="loops-tile-top"><span>' + (loop.emoji || "🔹") + "</span><span>" + loop.name + "</span></div>" +
        '<div class="loops-tile-meta">' + loop.qs.length + " questions · Best time: " + (best ? fmtTime(best) : "—") + "</div>" +
        '<div class="loops-tile-meta">High score: ' + (bestScore !== undefined ? (bestScore + "/" + loop.qs.length) : "—") + "</div>" +
        '<div class="loops-tile-meta">' + (unlocked ? "Tap to play →" : "🔒 Locked") + "</div>";
      if (unlocked) tile.addEventListener("click", function () { openLoop(idx); });
      grid.appendChild(tile);

      // Halfway Check: appears once loop index 4 (the 5th loop) is complete
      if (idx === 4 && save.unlocked > 4) {
        var halfwaySpots = weakSpots().filter(function (item) { return item.loopIdx <= 4; });
        var hwTile = document.createElement("div");
        hwTile.className = "loops-tile halfway";
        hwTile.innerHTML =
          '<div class="loops-tile-top"><span>⭐</span><span>Halfway Check</span></div>' +
          '<div class="loops-tile-meta">' + (halfwaySpots.length > 0
            ? "Halfway there already! Lock in a few from Loops 1–5 before the back half."
            : "Halfway there and everything from Loops 1–5 is rock solid. Great start.") + '</div>' +
          '<div class="loops-tile-meta">' + (halfwaySpots.length > 0 ? "Tap to review →" : "✓ All clear") + '</div>';
        if (halfwaySpots.length > 0) {
          hwTile.addEventListener("click", function () { openReview(halfwaySpots, "Halfway Check"); });
        } else {
          hwTile.style.cursor = "default";
        }
        grid.appendChild(hwTile);
      }
    });
  }

  function show(id) {
    document.querySelectorAll("#loopsApp .loops-screen").forEach(function (s) { s.classList.remove("active"); });
    el(id).classList.add("active");
  }

  // ── LOOP PLAY ──
  function openLoop(idx) {
    G.mode = "loop";
    G.loopIdx = idx;
    var loop = GAME.loops[idx];
    G.queue = shuffle(loop.qs);
    G.qi = 0; G.correct = 0; G.wrongs = 0; G.requeued = {}; G.seenKeys = {}; G.firstTryCorrect = 0;
    G.startMs = performance.now();
    show("loopsPlay");
    toneStart();
    renderQuestion();
  }

  function openReview(items, label) {
    G.mode = "review";
    G.reviewLabel = label;
    G.queue = shuffle(items.map(function (item) { return item.q; }));
    G.qi = 0; G.correct = 0; G.wrongs = 0; G.requeued = {}; G.seenKeys = {}; G.firstTryCorrect = 0;
    G.startMs = performance.now();
    show("loopsPlay");
    toneStart();
    renderQuestion();
  }

  function renderQuestion() {
    var q = G.queue[G.qi];
    G.answered = false;
    var timeLimit = G.mode === "loop" ? (GAME.loops[G.loopIdx].timeLimit || 15) : 15;
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

    startTimer(timeLimit);
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
    handleResult(false, q, "⏱ Time's up");
  }

  function requeue(q) {
    var key = questionKey(q);
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

  function handleResult(ok, q, correctAnswerLabel) {
    var key = questionKey(q);
    var isFirstAttempt = !G.seenKeys[key];
    if (isFirstAttempt) G.seenKeys[key] = true;

    var justMastered = false;

    if (ok) {
      G.correct++;
      if (isFirstAttempt) G.firstTryCorrect++;
      toneGood();
      if (save.mastery[key] !== undefined && save.mastery[key] < MASTERY_TARGET) {
        save.mastery[key] = Math.min(MASTERY_TARGET, save.mastery[key] + 1);
        if (save.mastery[key] === MASTERY_TARGET) justMastered = true;
        persist();
      }
    } else {
      G.wrongs++;
      toneBad();
      if (save.mastery[key] === undefined) {
        save.mastery[key] = 0; // starts haunting from the first miss
        persist();
      }
      requeue(q);
    }

    if (justMastered) {
      toneMastered();
      showFeedback(true, q, "🌟 Mastered! That's " + MASTERY_TARGET + " for " + MASTERY_TARGET + " — it's yours now.", true);
    } else {
      showFeedback(ok, q, ok ? pick(CORRECT_PHRASES) : (pick(WRONG_PHRASES) + " — " + q.a + ". You'll get it."));
    }
  }

  function showFeedback(ok, q, msg, mastered) {
    var fb = el("loopsFb");
    fb.className = "loops-fb " + (mastered ? "mastered" : (ok ? "good" : "bad"));
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
    var hintText = q.hint ? q.hint : ('Starts with "' + (q.a || "").charAt(0).toUpperCase() + '"');
    var box = document.createElement("div");
    box.className = "loops-hint";
    box.textContent = "💡 " + hintText;
    el("loopsHintBtn").replaceWith(box);
  }

  function nextQuestion() {
    G.qi++;
    if (G.qi >= G.queue.length) { finishRound(); }
    else { renderQuestion(); }
  }

  function finishRound() {
    clearInterval(G.timer);
    var elapsed = (performance.now() - G.startMs) / 1000;

    if (G.mode === "review") {
      show("loopsResult");
      el("loopsResultTitle").textContent = "✓ Review complete — great effort";
      el("loopsResultTime").textContent = fmtTime(elapsed);
      var remaining = weakSpots().length;
      el("loopsResultScore").textContent = remaining > 0
        ? "You're chipping away at it — " + remaining + " question" + (remaining === 1 ? "" : "s") + " left to master."
        : "🌟 Everything's mastered. That's the whole pool cleared — brilliant work.";
      toneWin();
      if (remaining === 0) confetti();
      el("loopsAgainBtn").onclick = function () { openReview(weakSpots(), G.reviewLabel); };
      el("loopsAgainBtn").style.display = weakSpots().length > 0 ? "block" : "none";
      el("loopsBackBtn").onclick = renderHome;
      return;
    }

    // mode === "loop"
    var totalQs = GAME.loops[G.loopIdx].qs.length;
    var oldBest = save.best[G.loopIdx];
    var isNewBestTime = !oldBest || elapsed < oldBest;
    if (isNewBestTime) save.best[G.loopIdx] = elapsed;

    var oldScore = save.bestScore[G.loopIdx];
    var isNewBestScore = oldScore === undefined || G.firstTryCorrect > oldScore;
    if (isNewBestScore) save.bestScore[G.loopIdx] = G.firstTryCorrect;

    if (save.unlocked === G.loopIdx && G.loopIdx < GAME.loops.length - 1) {
      save.unlocked = G.loopIdx + 1; // finishing unlocks the next loop regardless of mistakes
    }
    persist();

    show("loopsResult");
    el("loopsResultTitle").textContent = isNewBestTime ? "🏆 New best time! Brilliant." : "🎉 Loop complete — well done!";
    el("loopsResultTime").textContent = fmtTime(elapsed);
    el("loopsResultScore").textContent = "Score: " + G.firstTryCorrect + "/" + totalQs + (isNewBestScore ? " — new high score!" : "") +
      (G.wrongs === 0 ? " — clean run, nice." : "");
    toneWin();
    if (isNewBestTime || isNewBestScore) confetti();

    el("loopsAgainBtn").style.display = "block";
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
      try {
        GAME = gameData;
        if (!GAME || !GAME.loops || !GAME.loops.length) throw new Error("This game has no playable content.");
        loadSave();
        buildQuestionIndex();
        injectStyles();
        buildSkeleton();
        renderHome();
      } catch (err) {
        var root = document.getElementById("loopsApp");
        if (root) {
          root.innerHTML =
            '<div style="max-width:420px;margin:40px auto;text-align:center;font-family:system-ui,sans-serif;padding:24px;">' +
            '<div style="font-size:2rem;margin-bottom:10px;">⚠️</div>' +
            '<div style="font-weight:800;font-size:1.1rem;margin-bottom:8px;">This game hit a snag loading</div>' +
            '<div style="opacity:.7;font-size:.9rem;">Try refreshing the page. If it keeps happening, this game may need to be republished.</div>' +
            "</div>";
        }
        if (window.console) console.error("LoopsEngine failed to init:", err);
      }
    }
  };
})();
