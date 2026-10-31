/* UI layer: lesson header, routing (#/lesson/N), rendering. Logic lives in quiz-engine.js. */
(function () {
  "use strict";

  const E = window.QuizEngine;
  const G = window.Game;
  const DATA = window.LESSON_DATA;
  const LESSON_NUMS = Object.keys(DATA).map(Number).sort((a, b) => a - b);
  const LETTERS = ["A", "B", "C", "D"];
  const TYPE_LABELS = { n: "Noun", v: "Verb", adj: "Adjective", adv: "Adverb", exp: "Expression", suf: "Suffix", conj: "Conjunction", q: "Question word", "question-words": "Question word", fam: "Family", transport: "Transport", research: "Research", time: "Time", space: "Space", places: "Places", office: "Office", directions: "Directions", daily: "Daily life" };
  const typeLabel = (g) => TYPE_LABELS[g] || (g ? g[0].toUpperCase() + g.slice(1) : "Word");
  const CORRECT_PAUSE_MS = 380;   // a short beat to see "Correct", then the transition plays
  const STORE_KEY = "jpquiz.lastLesson";

  const app = document.getElementById("app");
  const scoreEl = document.getElementById("score");
  const titleEl = document.getElementById("lesson-title");
  const navEl = document.getElementById("lesson-nav");
  const pickBtn = document.getElementById("pick-btn");
  const pickLabel = document.getElementById("pick-label");
  const timerBtn = document.getElementById("timer-btn");
  const timerLabel = document.getElementById("timer-label");
  const timerPop = document.getElementById("timer-pop");
  let shown = { lesson: 0, index: -1, bar: 0 };   // what is on screen, so we only animate real changes

  const sessions = new Map();   // lesson number -> session (switching tabs keeps progress)
  let current = null;           // the session being shown
  let timer = null;
  const TIMER_OPTIONS = [0, 5, 10, 15, 20, 30];   // seconds per question; 0 = off
  const TIMER_KEY = "jpquiz.timer";
  let timerSec = 0;
  try { const v = Number(localStorage.getItem(TIMER_KEY)); if (TIMER_OPTIONS.includes(v)) timerSec = v; } catch (e) { /* storage unavailable */ }
  let clockTimeout = 0, clockTick = 0;

  // Japanese text with hiragana readings above kanji (uses the word's `ruby` segments when it has kanji).
  const jaHtml = (w) => w.ruby
    ? w.ruby.map(([t, r]) => (r ? `<ruby>${esc(t)}<rt>${esc(r)}</rt></ruby>` : esc(t))).join("")
    : esc(w.ja);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get() { try { return Number(localStorage.getItem(STORE_KEY)); } catch (e) { return NaN; } },
    set(v) { try { localStorage.setItem(STORE_KEY, String(v)); } catch (e) { /* storage unavailable */ } },
  };

  /* ---------- header ---------- */
  function buildNav() {
    navEl.innerHTML = LESSON_NUMS.map((n, i) => `<button type="button" data-lesson="${n}" aria-label="Lesson ${n}" style="--h:${(i * 23 + 8) % 360};--i:${i}"><span class="lbl">Lesson</span><b class="num">${n}</b><span class="sts" aria-hidden="true"><i>★</i><i>★</i><i>★</i></span></button>`).join("");
    navEl.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-lesson]");
      if (b) { closeSheets(); location.hash = `#/lesson/${b.dataset.lesson}`; }
    });
    pickBtn.addEventListener("click", () => toggle(pickBtn, navEl));
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".topbar, .head-tools")) closeSheets();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });
    buildTimerPop();
    timerBtn.addEventListener("click", () => {
      const open = timerPop.hidden;
      closeSheets();
      if (open) { timerPop.hidden = false; timerBtn.setAttribute("aria-expanded", "true"); }
    });
    timerPop.addEventListener("click", (e) => {
      if (e.target.closest("#tp-fancy")) {
        fancy = !fancy;
        try { localStorage.setItem(FANCY_KEY, fancy ? "1" : "0"); } catch (err) { /* ignore */ }
        buildTimerPop();
        return;
      }
      const b = e.target.closest("button[data-sec]");
      if (b) setTimer(Number(b.dataset.sec));
    });
    window.addEventListener("scroll", () => { if (navEl.classList.contains("open")) closeSheets(); }, { passive: true });
  }
  function toggle(btn, panel) {
    const open = btn.getAttribute("aria-expanded") !== "true";
    closeSheets();
    if (!open) return;
    btn.setAttribute("aria-expanded", "true");
    panel.style.top = `${document.querySelector(".topbar").getBoundingClientRect().bottom}px`;
    panel.classList.add("open");
  }
  function closeSheets() {
    pickBtn.setAttribute("aria-expanded", "false"); navEl.classList.remove("open");
    timerPop.hidden = true; timerBtn.setAttribute("aria-expanded", "false");
  }
  function markActive(n) {
    navEl.querySelectorAll("button").forEach((b) => {
      const on = Number(b.dataset.lesson) === n;
      if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
  }

  /* ---------- routing ---------- */
  function lessonFromHash() {
    const m = location.hash.match(/^#\/lesson\/(\d+)$/);
    const n = m ? Number(m[1]) : NaN;
    return DATA[n] ? n : NaN;
  }
  function route() {
    let n = lessonFromHash();
    if (!n) { const saved = store.get(); n = DATA[saved] ? saved : LESSON_NUMS[0]; }
    showLesson(n);
  }
  function showLesson(n) {
    leaveCurrent();
    if (!sessions.has(n)) sessions.set(n, E.createSession(DATA[n]));
    current = sessions.get(n);
    store.set(n);
    markActive(n);
    pickLabel.textContent = `Lesson ${n}`;
    document.title = `Lesson ${n} · Japanese Vocabulary Quiz`;
    render();
    window.scrollTo(0, 0);
  }
  // Leaving mid-"Correct!" flash: settle it so the learner resumes on the next question.
  function leaveCurrent() {
    clearTimeout(timer);
    clearTimeout(goTimer);
    clearClock();
    if (current && current.status === "correct_feedback") E.advance(current);
  }

  /* ---------- fun question-to-question transitions (see transitions.js) ---------- */
  const FANCY_KEY = "jpquiz.fancy";
  let fancy = true;
  try { if (localStorage.getItem(FANCY_KEY) === "0") fancy = false; } catch (e) { /* storage unavailable */ }
  let swapping = false, settleMs = 0, goTimer = 0;
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Plays an exit/arrival show around `update`. The effect decides when to commit (render the next state)
  // and tells us how long the arrival still takes, so the quiz clock only starts once the card has landed.
  function swapQuestion(update) {
    const card = app.querySelector(".card");
    if (!card || !card.animate || reduceMotion()) { update(); return; }
    window.Transitions.run(card, (settle) => {
      settleMs = settle || 0;
      swapping = true;
      update();
      swapping = false;
    }, { fancy, burst: G.burst, whoosh: G.whoosh });
  }

  /* ---------- actions ---------- */
  function onChoose(option) {
    const s = current;
    const r = E.choose(s, option);
    if (r === "ignored") return;
    finishAnswer(s, r);
  }
  // Shared by a tapped answer and by the countdown running out.
  function finishAnswer(s, r) {
    clearClock();
    const info = G.answered(s, r);
    if (paintAnswer(s)) { scoreEl.innerHTML = `Score <b>${s.score}</b>`; G.renderHud(s); } else render();
    requestAnimationFrame(() => G.fx(info));   // let the tap paint first, then sound/particles
    if (r === "correct") {
      const at = s.index;
      timer = setTimeout(() => {
        if (current === s && s.index === at && s.status === "correct_feedback") {
          swapQuestion(() => { if (current === s && s.index === at && s.status === "correct_feedback") { E.advance(s); render(); } });
        }
      }, CORRECT_PAUSE_MS);
    }
  }
  /* ---------- timer mode ---------- */
  function clearClock() { clearTimeout(clockTimeout); clearInterval(clockTick); }
  // Starts the countdown for the question on screen; at zero it counts as a wrong answer.
  function startClock(s) {
    clearClock();
    s.timerSec = timerSec;
    if (!timerSec) return;
    const end = Date.now() + timerSec * 1000, at = s.index;
    const num = document.querySelector(".countdown em");
    clockTick = setInterval(() => { if (num) num.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000)); }, 200);
    clockTimeout = setTimeout(() => {
      clearClock();
      if (current === s && s.index === at && s.status === "question") finishAnswer(s, E.expire(s));
    }, timerSec * 1000);
  }
  function buildTimerPop() {
    timerPop.innerHTML = `<p class="tp-title">Beat the clock ⏱</p>
      <p class="tp-sub">Answer before time runs out. A shorter clock pays more XP.</p>
      <div class="tp-grid" role="group" aria-label="Seconds per question">${TIMER_OPTIONS.map((n) =>
        `<button type="button" data-sec="${n}" aria-pressed="${n === timerSec}">${n ? `${n}s<small>×${G.TIMER_MULT[n]} XP</small>` : "Off"}</button>`).join("")}</div>`;
    timerPop.insertAdjacentHTML("beforeend", `<button type="button" class="tp-toggle" id="tp-fancy" aria-pressed="${fancy}"><span aria-hidden="true">✨</span> Fancy transitions <b>${fancy ? "On" : "Quick"}</b></button>`);
    timerLabel.textContent = timerSec ? `${timerSec}s` : "Timer";
    timerBtn.setAttribute("aria-pressed", String(!!timerSec));
  }
  function setTimer(sec) {
    timerSec = sec;
    try { localStorage.setItem(TIMER_KEY, String(sec)); } catch (e) { /* ignore */ }
    buildTimerPop();
    closeSheets();
    if (current && current.status === "question") render();   // restart this question with the new clock
  }

  // Per-question UI state for the two helpers. It is keyed by the question index, so it resets by itself
  // on the next word. "used" records that the romaji was ever shown (that costs XP, hiding it again does not refund).
  const ui = (s) => {
    if (!s._ui || s._ui.i !== s.index) s._ui = { i: s.index, romaji: false, hint: false, used: false };
    return s._ui;
  };
  const setPressed = (id, on) => { const b = document.getElementById(id); if (b) b.setAttribute("aria-pressed", String(on)); };
  // Romaji button: toggles the reading under the word (costs half the base XP).
  function onRomaji() {
    const s = current;
    if (!s || s.status !== "question") return;
    const u = ui(s);
    u.romaji = !u.romaji;
    if (u.romaji) {
      u.used = true;
      const prompt = document.getElementById("prompt");
      if (prompt && !document.getElementById("romaji")) prompt.insertAdjacentHTML("afterend", romajiHtml(E.currentWord(s)));
    } else {
      const r = document.getElementById("romaji");
      if (r) r.remove();
    }
    setPressed("btn-romaji", u.romaji);
  }
  // Hint button: toggles the word-type label (Noun, Verb …) in the top-left corner. Free.
  function onHint() {
    const s = current;
    if (!s || s.status !== "question") return;
    const u = ui(s);
    u.hint = !u.hint;
    const slot = document.getElementById("tag-slot");
    if (slot) slot.innerHTML = u.hint ? tagHtml(E.currentWord(s)) : "";
    setPressed("btn-hint", u.hint);
  }
  function onNext() {
    const s = current;
    swapQuestion(() => { if (current === s && E.advance(s)) render(); });
  }
  function onRestart() {
    clearTimeout(timer);
    const n = current.lesson;
    current = E.createSession(DATA[n]);
    sessions.set(n, current);
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- rendering ---------- */
  function render() {
    const s = current;
    titleEl.textContent = `Lesson ${s.lesson}`;
    scoreEl.innerHTML = `Score <b>${s.score}</b>`;
    G.renderHud(s);
    clearClock();
    navEl.querySelectorAll("button").forEach((b) => { b.dataset.stars = G.lessonStars(Number(b.dataset.lesson)); });
    if (s.status === "completed") renderComplete(s); else renderQuestion(s);
  }

  // The area under the options: "✓ Correct" toast or the wrong-answer feedback with the Next button.
  function belowHtml(s, q, w, total) {
    if (s.status === "wrong_answer_feedback") {
      return `<section class="feedback" aria-live="assertive">
        <dl>
          <dt>Word</dt><dd class="jp" lang="ja">${jaHtml(w)}</dd>
          <dt>Romaji</dt><dd>${esc(w.romaji)}</dd>
          <dt>Your answer</dt><dd class="yours">${s.lastSelected === null ? "Time's up ⏱" : esc(s.lastSelected)}</dd>
          <dt>Correct answer</dt><dd class="right">${esc(q.correct)}</dd>
        </dl>
        <button type="button" class="btn" id="next">${s.index === total - 1 ? "See Results" : "Next Question"}</button>
      </section>`;
    }
    return `<div class="toast" aria-live="polite">${s.status === "correct_feedback" ? `✓ Correct<span class="rom"> · ${esc(w.romaji)}</span>` : ""}</div>`;
  }
  // The word-type label (Noun, Verb …) is a hint: hidden until the learner asks, always shown after answering.
  const romajiHtml = (w) => `<div class="romaji" id="romaji">${esc(w.romaji)}</div>`;
  const tagHtml = (w) => `<span class="tag">${esc(w.pos || typeLabel(w.group))}</span>${w.sub ? `<span class="tag sub">${esc(w.sub)}</span>` : ""}`;
  const showTag = (w) => { const slot = document.getElementById("tag-slot"); if (slot && !slot.firstChild) slot.innerHTML = tagHtml(w); };
  function bindNext() {
    const n = document.getElementById("next");
    if (!n) return;
    n.addEventListener("click", () => { n.disabled = true; onNext(); });
    n.focus({ preventScroll: true });
    n.scrollIntoView({ block: "nearest" });   // keep "Next" reachable under the sticky bar
  }

  // Answering only touches what changed (option classes, toast/feedback, progress) instead of
  // rebuilding the whole card, which keeps the tap response instant. Returns false if it can't.
  function paintAnswer(s) {
    const card = app.querySelector(".card");
    const opts = app.querySelectorAll(".opt");
    if (!card || opts.length !== 4 || s.status === "question" || s.status === "completed") return false;
    const q = s.questions[s.index], total = s.words.length, done = s.index + 1;
    opts.forEach((b) => {
      b.disabled = true;
      b.classList.add(b.dataset.opt === q.correct ? "is-correct" : b.dataset.opt === s.lastSelected ? "is-wrong" : "is-dim");
    });
    const slot = card.querySelector(".toast, .feedback");
    if (!slot) return false;
    slot.outerHTML = belowHtml(s, q, E.currentWord(s), total);
    app.querySelector(".progress-label span:last-child").textContent = `${Math.round((done / total) * 100)}%`;
    app.querySelector(".track").setAttribute("aria-valuenow", done);
    const seg = app.querySelector(".track").children[s.index];
    if (seg) { seg.className = (s.status === "correct_feedback" ? "ok" : "bad") + " pop"; }
    const speed = card.querySelector(".speed, .countdown");
    if (speed) speed.remove();
    card.querySelectorAll(".hint-btn").forEach((b) => b.remove());
    showTag(E.currentWord(s));
    if (s.status === "wrong_answer_feedback") bindNext();
    return true;
  }

  function renderQuestion(s) {
    const total = s.words.length;
    const q = s.questions[s.index];
    const w = E.currentWord(s);
    const locked = s.status !== "question";
    const done = s.index + (locked ? 1 : 0);

    const opts = q.options.map((o, i) => {
      let cls = "opt";
      if (locked) cls += o === q.correct ? " is-correct" : o === s.lastSelected ? " is-wrong" : " is-dim";
      return `<button type="button" class="${cls}" data-opt="${esc(o)}" ${locked ? "disabled" : ""}>
        <span class="key" aria-hidden="true">${LETTERS[i]}</span><span>${esc(o)}</span></button>`;
    }).join("");

    const below = belowHtml(s, q, w, total);
    const u = ui(s);   // helper state belongs to this one question only
    const wrongIds = new Set(s.wrong.map((x) => x.id));
    const segs = s.questions.map((x, i) => `<i class="${i < s.index || (i === s.index && locked) ? (wrongIds.has(x.wordId) ? "bad" : "ok") : i === s.index ? "now" : ""}"></i>`).join("");

    const long = w.ja.length > 12 ? " long" : "";
    const isNewQuestion = shown.lesson !== s.lesson || shown.index !== s.index;
    app.innerHTML = `
      <div class="progress-label"><span>Question ${s.index + 1} of ${total}</span><span>${Math.round((done / total) * 100)}%</span></div>
      <div class="track" role="progressbar" aria-label="Lesson progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}">${segs}</div>
      <div class="card${isNewQuestion ? " enter" : ""}${swapping ? " swap" : ""}">
        <div class="qmeta"><span id="tag-slot">${u.hint || locked ? tagHtml(w) : ""}</span>${locked ? "" : `<span class="qtools">${timerSec ? `<span class="countdown" role="timer" aria-label="Time left" style="--t:${timerSec}s"><b aria-hidden="true">⏱</b><span class="speed-bar"><i></i></span><em>${timerSec}</em></span>` : '<span class="speed" aria-hidden="true" title="Answer fast for bonus XP"><b>⚡</b><span class="speed-bar"><i></i></span></span>'}<button type="button" class="hint-btn" id="btn-hint" aria-pressed="${u.hint}" title="Show or hide the grammar: verb group, i-/na-adjective, and so on (free). Shortcut: H"><span aria-hidden="true">💡</span> Hint</button><button type="button" class="hint-btn" id="btn-romaji" aria-pressed="${u.romaji}" title="Show or hide the romaji (costs bonus XP). Shortcut: R"><span aria-hidden="true">あ</span> Romaji</button></span>`}</div>
        <div class="prompt jp${long}" lang="ja" id="prompt">${jaHtml(w)}</div>
        ${u.romaji ? romajiHtml(w) : ""}
        <div class="options" role="group" aria-labelledby="prompt">${opts}</div>
        ${below}
      </div>`;

    shown = { lesson: s.lesson, index: s.index };

    if (s.status === "question") {
      const at = s.index;
      const go = () => {
        if (current !== s || s.index !== at || s.status !== "question") return;
        G.questionShown(s);
        startClock(s);
        const cd = app.querySelector(".card");
        if (cd) cd.classList.add("go");
      };
      clearTimeout(goTimer);
      if (settleMs > 0) goTimer = setTimeout(go, settleMs); else go();
      settleMs = 0;
      document.getElementById("btn-hint").addEventListener("click", onHint);
      document.getElementById("btn-romaji").addEventListener("click", onRomaji);
      app.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => onChoose(b.dataset.opt)));
    } else if (s.status === "wrong_answer_feedback") {
      bindNext();
    }
  }

  function renderComplete(s) {
    const total = s.words.length;
    const correct = s.score;
    const pct = Math.round((correct / total) * 100);
    const review = s.wrong.length === 0
      ? `<div class="perfect">Perfect! You answered every question correctly.</div>`
      : `<h2>Wrong Answers Review</h2>
         <ul class="review">${s.wrong.map((w) => `
           <li>
             <div class="w jp" lang="ja">${jaHtml(s.words.find((x) => x.id === w.id))}</div>
             <div class="r">${esc(w.romaji)}</div>
             <div class="row"><span>Correct meaning</span><span class="c">${esc(w.correct)}</span></div>
             <div class="row"><span>Your answer</span><span class="y">${esc(w.selected)}</span></div>
           </li>`).join("")}</ul>`;

    const sum = G.finish(s);
    const nextN = LESSON_NUMS[LESSON_NUMS.indexOf(s.lesson) + 1];
    const verdict = sum.perfect ? "Flawless!" : sum.stars === 3 ? "Excellent!" : sum.stars === 2 ? "Nice work!" : "Keep going — you'll get 3★ next time";
    const starRow = [1, 2, 3].map((i) => `<span class="star${i <= sum.stars ? " on" : ""}" style="--i:${i}" aria-hidden="true">★</span>`).join("");
    app.innerHTML = `
      <div class="card">
        <div class="result-head">
          <div style="color:var(--muted)">Lesson ${s.lesson} complete</div>
          <div class="stars" role="img" aria-label="${sum.stars} of 3 stars">${starRow}</div>
          <div class="verdict">${verdict}${sum.newBest ? ' <span class="new-best">New best!</span>' : ""}</div>
          <div class="big" id="final-score">${correct} / ${total}</div>
          <div id="final-pct">${pct}% accuracy</div>
        </div>
        <div class="reward">
          <div><b>+${sum.xp}</b><span>XP earned</span></div>
          <div><b>x${sum.maxCombo}</b><span>Best combo</span></div>
          <div><b>Lv ${G.level()}</b><span>${sum.levelUp ? "Level up!" : "Your level"}</span></div>
        </div>
        <div class="stats">
          <div class="stat"><div class="n" id="n-correct">${correct}</div><div class="l">Correct</div></div>
          <div class="stat"><div class="n" id="n-wrong">${total - correct}</div><div class="l">Incorrect</div></div>
          <div class="stat"><div class="n">${pct}%</div><div class="l">Accuracy</div></div>
        </div>
        ${review}
        <button type="button" class="btn" id="restart">Restart Quiz</button>
        ${nextN ? `<button type="button" class="btn ghost" id="next-lesson">Next: Lesson ${nextN} →</button>` : ""}
        <div class="credit-card">
          <p><strong>Enjoying it?</strong> Thank you for practising with me! A ⭐ on GitHub or a 👍 on LinkedIn would mean a lot.</p>
          <div class="footer-links">
            <a href="https://github.com/iNuman/lesson-quiz" target="_blank" rel="noopener noreferrer">⭐ Star on GitHub</a>
            <a href="https://www.linkedin.com/in/-inuman/" target="_blank" rel="noopener noreferrer">👍 Like on LinkedIn</a>
          </div>
        </div>
      </div>`;
    document.getElementById("restart").addEventListener("click", onRestart);
    const nl = document.getElementById("next-lesson");
    if (nl) nl.addEventListener("click", () => { location.hash = `#/lesson/${nextN}`; });
    G.finishFx(sum);
  }

  /* Keyboard: 1–4 or A–D choose an answer. */
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !current || current.status !== "question") return;
    const k = e.key.toUpperCase();
    if (k === "H") { e.preventDefault(); onHint(); return; }
    if (k === "R") { e.preventDefault(); onRomaji(); return; }
    const i = "1234".includes(k) && k.length === 1 ? Number(k) - 1 : LETTERS.indexOf(k);
    if (i >= 0 && i < 4) { e.preventDefault(); onChoose(current.questions[current.index].options[i]); }
  });

  /* "Suggest an idea": phones follow the mailto link (opens the Gmail app / default mail app);
     desktop browsers open a Gmail compose tab instead of needing a mail client set up. */
  {
    document.addEventListener("click", (e) => {
      if (!e.target.closest("a[data-suggest]")) return;
      if (/Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent)) return;
      e.preventDefault();
      const q = new URLSearchParams({ view: "cm", fs: "1", to: "inuumaan@gmail.com", su: "Suggestion for lesson-quiz", body: "Hi Ali,\n\nMy suggestion:\n\n" });
      window.open(`https://mail.google.com/mail/?${q}`, "_blank", "noopener");
    });
  }

  window.addEventListener("hashchange", route);
  if (/[?&]debug\b/.test(location.search)) window.__quizDebug = { DATA, getState: () => current, sessions };
  buildNav();
  G.bindHud();
  route();
})();