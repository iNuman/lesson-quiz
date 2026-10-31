/* UI layer: lesson header, routing (#/lesson/N), rendering. Logic lives in quiz-engine.js. */
(function () {
  "use strict";

  const E = window.QuizEngine;
  const G = window.Game;
  const DATA = window.LESSON_DATA;
  const LESSON_NUMS = Object.keys(DATA).map(Number).sort((a, b) => a - b);
  const LETTERS = ["A", "B", "C", "D"];
  const CORRECT_PAUSE_MS = 450;
  const STORE_KEY = "jpquiz.lastLesson";

  const app = document.getElementById("app");
  const scoreEl = document.getElementById("score");
  const titleEl = document.getElementById("lesson-title");
  const navEl = document.getElementById("lesson-nav");
  const pickBtn = document.getElementById("pick-btn");
  const pickLabel = document.getElementById("pick-label");
  let shown = { lesson: 0, index: -1, bar: 0 };   // what is on screen, so we only animate real changes

  const sessions = new Map();   // lesson number -> session (switching tabs keeps progress)
  let current = null;           // the session being shown
  let timer = null;

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
    navEl.innerHTML = LESSON_NUMS.map((n) => `<button type="button" data-lesson="${n}" aria-label="Lesson ${n}"><span class="lbl">Lesson </span>${n}</button>`).join("");
    navEl.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-lesson]");
      if (b) { closeSheets(); location.hash = `#/lesson/${b.dataset.lesson}`; }
    });
    pickBtn.addEventListener("click", () => toggle(pickBtn, navEl));
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".topbar")) closeSheets();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });
  }
  function toggle(btn, panel) {
    const open = btn.getAttribute("aria-expanded") !== "true";
    closeSheets();
    if (!open) return;
    btn.setAttribute("aria-expanded", "true");
    panel.classList.add("open");
  }
  function closeSheets() {
    pickBtn.setAttribute("aria-expanded", "false"); navEl.classList.remove("open");
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
    if (current && current.status === "correct_feedback") E.advance(current);
  }

  /* ---------- actions ---------- */
  function onChoose(option) {
    const s = current;
    const r = E.choose(s, option);
    if (r === "ignored") return;
    const info = G.answered(s, r);
    render();
    G.fx(info);
    if (r === "correct") {
      const at = s.index;
      timer = setTimeout(() => {
        if (current === s && s.index === at && s.status === "correct_feedback") { E.advance(s); render(); }
      }, CORRECT_PAUSE_MS);
    }
  }
  function onNext() { if (E.advance(current)) render(); }
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
    navEl.querySelectorAll("button").forEach((b) => { b.dataset.stars = G.lessonStars(Number(b.dataset.lesson)); });
    if (s.status === "completed") renderComplete(s); else renderQuestion(s);
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

    let below = `<div class="toast" aria-live="polite">${s.status === "correct_feedback" ? "✓ Correct" : ""}</div>`;
    if (s.status === "wrong_answer_feedback") {
      below = `<section class="feedback" aria-live="assertive">
        <dl>
          <dt>Word</dt><dd class="jp" lang="ja">${jaHtml(w)}</dd>
          <dt>Romaji</dt><dd>${esc(w.romaji)}</dd>
          <dt>Your answer</dt><dd class="yours">${esc(s.lastSelected)}</dd>
          <dt>Correct answer</dt><dd class="right">${esc(q.correct)}</dd>
        </dl>
        <button type="button" class="btn" id="next">${s.index === total - 1 ? "See Results" : "Next Question"}</button>
      </section>`;
    }

    const long = w.ja.length > 12 ? " long" : "";
    const isNewQuestion = shown.lesson !== s.lesson || shown.index !== s.index;
    app.innerHTML = `
      <div class="progress-label"><span>Question ${s.index + 1} of ${total}</span><span>${Math.round((done / total) * 100)}%</span></div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span></span></div>
      <div class="card${isNewQuestion ? " enter" : ""}">
        <div class="prompt jp${long}" lang="ja" id="prompt">${jaHtml(w)}</div>
        <div class="options" role="group" aria-labelledby="prompt">${opts}</div>
        ${below}
      </div>`;

    const barEl = app.querySelector(".bar > span");
    const target = done / total;
    G.glide(barEl, shown.lesson === s.lesson ? Math.min(shown.bar, target) : target, target);
    shown = { lesson: s.lesson, index: s.index, bar: target };

    if (s.status === "question") {
      G.questionShown(s);
      app.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => onChoose(b.dataset.opt)));
    } else if (s.status === "wrong_answer_feedback") {
      const n = document.getElementById("next");
      n.addEventListener("click", () => { n.disabled = true; onNext(); });
      n.focus({ preventScroll: true });
      n.scrollIntoView({ block: "nearest" });   // keep "Next" reachable under the sticky bar
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
        <div class="credit-card" id="credit-card">
          <p>Enjoying it? Made with <span class="heart">♥</span> by <strong>Ali Noman</strong> — ideas and contributions welcome.</p>
        </div>
      </div>`;
    const links = document.querySelector(".footer-links").cloneNode(true);
    links.classList.remove("hero-links");   // the banner copy is icon-only and single-row; this one wraps with labels
    document.getElementById("credit-card").appendChild(links);
    document.getElementById("restart").addEventListener("click", onRestart);
    const nl = document.getElementById("next-lesson");
    if (nl) nl.addEventListener("click", () => { location.hash = `#/lesson/${nextN}`; });
    G.finishFx(sum);
  }

  /* Keyboard: 1–4 or A–D choose an answer. */
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !current || current.status !== "question") return;
    const k = e.key.toUpperCase();
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