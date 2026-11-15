/* Vocabulary study — the two dialogs ("Vocabulary" book and "Speak practice"). The only study file that touches the DOM.
   All judging, queueing and speech handling is delegated to Forms / Matcher / Practice / Speech (each unit-tested).

   Integration (see app.js): the quiz card renders buttons with data-study="vocab" | "speak"; this file listens for them.
     StudyUI.init({ lesson: () => lessonData | null, onOpen: () => void, onClose: () => void })
   onOpen runs just before a dialog opens, onClose after the last one has closed.                                   */
(function (root) {
  "use strict";
  const Study = root.Study;
  const F = Study.Forms, M = Study.Matcher, P = Study.Practice;
  const doc = root.document;

  const SETTINGS_KEY = "jpquiz.study";
  const LANG = { ja: "ja-JP", en: "en-US" };
  const JAPANESE_RATE = 0.9;                 // slightly slower than normal: this is for learners
  const CORRECT_PAUSE_MS = 1100;
  // `say` is what the learner speaks, `hear` is what the assistant speaks.
  const DIRECTIONS = {
    "en-ja": { say: "ja", hear: "en", icon: "🇬🇧 → 🇯🇵", title: "Hear English, say Japanese", hint: "The assistant says the meaning. You say the Japanese word." },
    "ja-en": { say: "en", hear: "ja", icon: "🇯🇵 → 🇬🇧", title: "Hear Japanese, say English", hint: "The assistant says the Japanese word. You say what it means." },
  };
  const NOTICES = {
    "no-speech": "I didn't hear anything. Tap the microphone and try again.",
    denied: "The microphone is blocked for this page. Allow it in the browser's address bar, or type your answers.",
    "no-microphone": "No microphone was found. You can type your answers instead.",
    unsupported: "This browser cannot listen to speech. You can type your answers instead.",
    network: "The speech service could not be reached. Check your connection, or type your answers.",
    error: "Listening failed. Tap the microphone to try again, or type your answers.",
  };

  const speech = Study.Speech.create(root);
  let hooks = null;
  let vocabDlg = null, practiceDlg = null;
  let run = null;                            // the speaking practice in progress; null when none

  /* ---------- small helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rubyHtml = (segments) => segments.map(([t, r]) => (r ? `<ruby>${esc(t)}<rt>${esc(r)}</rt></ruby>` : esc(t))).join("");
  const wordHtml = (w) => (w.ruby ? rubyHtml(w.ruby) : esc(w.ja));
  const markup = () => root.N5.Markup;
  const sentenceHtml = (m) => markup().parse(m).map((t) => (t.t === "ruby" ? `<ruby>${esc(t.base)}<rt>${esc(t.rt)}</rt></ruby>` : esc(t.s))).join("");

  const settings = {
    get() { try { return JSON.parse(root.localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } },
    set(patch) { try { root.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings.get(), ...patch })); } catch (e) { /* storage unavailable */ } },
  };

  function makeDialog(id, label, cls) {
    const d = doc.createElement("dialog");
    d.className = `st-dialog ${cls}`;
    d.id = id;
    d.setAttribute("aria-label", label);
    doc.body.appendChild(d);
    d.addEventListener("close", onDialogClosed);
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });   // a click on the backdrop
    return d;
  }
  function openDialog(d) {
    if (!hooks || !hooks.lesson()) return;
    if (!d.open) { hooks.onOpen(); d.showModal(); }
  }
  // The "close" event arrives asynchronously, so a dialog may report after another one has already opened:
  // each dialog clears only its own state.
  function onDialogClosed(e) {
    speech.cancel();
    if (e.target === practiceDlg) run = null;  // any pending answer belongs to a screen that is gone
    else reg = null;
    if (!doc.querySelector("dialog.st-dialog[open]")) hooks.onClose();
  }
  const closeAll = () => doc.querySelectorAll("dialog.st-dialog[open]").forEach((d) => d.close());
  const closeBtn = `<button type="button" class="st-close" data-act="close" aria-label="Close">✕</button>`;

  /* =====================================================================================================
     Vocabulary: a full-page study register. Every word of the lesson in two columns, so one scroll covers the lesson.
     To memorise without leaving the page: cover the meaning (or the Japanese) with a "red sheet", tap a card to peek,
     tick the words you know, hide the ticked ones. Ticks are remembered per lesson.
     ===================================================================================================== */
  const MODES = { all: "Show all", en: "Cover meaning", ja: "Cover Japanese" };
  const SCALES = [0.9, 1, 1.15];             // text size steps
  let reg = null;                            // the register on screen: { lesson, order, mode, hideKnown, known, scale, voice }

  const lengthClass = (w) => { const n = w.ja.length; return n <= 4 ? "s" : n <= 9 ? "m" : n <= 14 ? "l" : "xl"; };   // long words get smaller type
  function loadKnown(lesson) {
    const saved = ((settings.get().known || {})[lesson.lesson]) || [];
    const ids = new Set(lesson.words.map((w) => w.id));
    return new Set(saved.filter((id) => ids.has(id)));
  }
  function saveKnown() {
    const all = settings.get().known || {};
    all[reg.lesson.lesson] = [...reg.known];
    settings.set({ known: all });
  }

  function openVocabulary() {
    const lesson = hooks.lesson();
    if (!lesson) return;
    const prefs = settings.get();
    reg = { lesson, order: lesson.words.map((_, i) => i), shuffled: false, mode: MODES[prefs.mode] ? prefs.mode : "all", hideKnown: false,
      known: loadKnown(lesson), scale: SCALES.includes(prefs.scale) ? prefs.scale : 1, voice: false };
    vocabDlg.innerHTML = `<div class="st-sheet">
      <header class="st-head">
        <div class="st-title"><b>Lesson ${lesson.lesson}</b><span>Study register · <span id="st-count"></span></span></div>
        ${closeBtn}
      </header>
      <div class="st-tools" role="toolbar" aria-label="Study aids">
        <div class="st-seg" role="group" aria-label="Red sheet">${Object.entries(MODES).map(([k, label]) => `<button type="button" data-mode="${k}">${label}</button>`).join("")}</div>
        <button type="button" class="st-chip" data-act="hide-known" aria-pressed="false">Hide ✓ known</button>
        <button type="button" class="st-chip" data-act="shuffle" aria-pressed="false">🔀 Shuffle</button>
        <button type="button" class="st-chip" data-act="size" aria-label="Text size">Aa</button>
      </div>
      <div class="st-meter" aria-hidden="true"><i></i></div>
      <div class="st-scroll" tabindex="0" aria-label="Words of lesson ${lesson.lesson}"><ol class="st-grid"></ol><p class="st-empty-note" hidden>Nothing left to show. Every word is ticked.</p></div>
      <footer class="st-foot">
        <button type="button" class="btn st-go" data-act="close"></button>
        <p class="st-note">Examples are original and not yet checked by a Japanese teacher.</p>
      </footer></div>`;
    renderGrid();
    applyRegister();
    openDialog(vocabDlg);
    vocabDlg.querySelector(".st-scroll").scrollTop = 0;
    // The hear-it buttons appear only when a Japanese voice is installed.
    if (speech.canSpeak()) speech.hasVoice(LANG.ja).then((has) => { if (has && reg && vocabDlg.open) { reg.voice = true; vocabDlg.querySelectorAll(".st-say").forEach((b) => { b.hidden = false; }); } });
  }

  function renderGrid() {
    const words = reg.lesson.words;
    vocabDlg.querySelector(".st-grid").innerHTML = reg.order.map((i) => vocabCard(words[i], i)).join("");
  }
  function vocabCard(w, i) {
    const say = (what, label) => `<button type="button" class="st-say" data-say="${what}:${i}" aria-label="${esc(label)}"${reg.voice ? "" : " hidden"}>🔊</button>`;
    const known = reg.known.has(w.id);
    const tag = w.pos ? `<span class="st-tag">${esc(w.pos)}</span>` : "";
    const ex = w.example
      ? `<div class="st-ex"><div class="st-ex-ja"><span class="st-ex-text st-cv-ja jp" lang="ja">${sentenceHtml(w.example.ja)}</span>${say("s", "Hear the example sentence")}</div>
           <div class="st-ex-en st-cv-en">${esc(w.example.en)}</div></div>`
      : "";
    return `<li class="st-word${known ? " is-known" : ""}" data-len="${lengthClass(w)}" data-i="${i}">
      <div class="st-top"><span class="st-num" aria-hidden="true">${i + 1}</span>${tag}
        <button type="button" class="st-tick" data-tick="${i}" aria-pressed="${known}" aria-label="I know this word">✓</button></div>
      <div class="st-line"><span class="st-ja st-cv-ja jp" lang="ja">${wordHtml(w).replace(/・/g, "・<wbr>")}</span>${say("w", "Hear the word")}</div>
      <div class="st-rom st-cv-ja">${esc(w.romaji)}</div>
      <div class="st-en st-cv-en">${esc(w.en)}</div>${ex}</li>`;
  }

  // Brings the toolbar, counters and classes in line with the register's state (no re-render of the cards).
  function applyRegister() {
    const n = reg.lesson.words.length, k = reg.known.size;
    vocabDlg.classList.toggle("st-cover-en", reg.mode === "en");
    vocabDlg.classList.toggle("st-cover-ja", reg.mode === "ja");
    vocabDlg.classList.toggle("st-hide-known", reg.hideKnown);
    vocabDlg.style.setProperty("--st-scale", reg.scale);
    vocabDlg.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === reg.mode)));
    vocabDlg.querySelector("[data-act=hide-known]").setAttribute("aria-pressed", String(reg.hideKnown));
    vocabDlg.querySelector("[data-act=shuffle]").setAttribute("aria-pressed", String(reg.shuffled));
    vocabDlg.querySelector("#st-count").textContent = `${k} of ${n} known`;
    vocabDlg.querySelector(".st-meter i").style.width = `${n ? (k / n) * 100 : 0}%`;
    vocabDlg.querySelector(".st-empty-note").hidden = !(reg.hideKnown && k === n);
    vocabDlg.querySelector(".st-go").textContent = k === n ? "You know them all. Start the quiz" : "Start the quiz";
  }

  function onVocabClick(e) {
    if (!reg) return;
    const say = e.target.closest("[data-say]");
    if (say) {
      const [kind, i] = say.dataset.say.split(":");
      const w = reg.lesson.words[Number(i)];
      speech.speak(kind === "s" ? markup().reading(w.example.ja) : F.spokenJapanese(w), LANG.ja, { rate: JAPANESE_RATE });
      return;
    }
    const tick = e.target.closest("[data-tick]");
    if (tick) {
      const w = reg.lesson.words[Number(tick.dataset.tick)];
      const on = !reg.known.has(w.id);
      if (on) reg.known.add(w.id); else reg.known.delete(w.id);
      tick.setAttribute("aria-pressed", String(on));
      tick.closest(".st-word").classList.toggle("is-known", on);
      saveKnown();
      applyRegister();
      return;
    }
    const mode = e.target.closest("[data-mode]");
    if (mode) { reg.mode = mode.dataset.mode; settings.set({ mode: reg.mode }); vocabDlg.querySelectorAll(".st-word.is-open").forEach((c) => c.classList.remove("is-open")); applyRegister(); return; }
    const act = e.target.closest("[data-act]");
    if (act) {
      switch (act.dataset.act) {
        case "close": vocabDlg.close(); break;
        case "hide-known": reg.hideKnown = !reg.hideKnown; applyRegister(); break;
        case "shuffle": reg.shuffled = !reg.shuffled; reg.order = reg.shuffled ? root.QuizEngine.shuffle(reg.order) : reg.lesson.words.map((_, i) => i); renderGrid(); applyRegister(); break;
        case "size": reg.scale = SCALES[(SCALES.indexOf(reg.scale) + 1) % SCALES.length]; settings.set({ scale: reg.scale }); applyRegister(); break;
        default: break;
      }
      return;
    }
    // A tap on a card peeks at it while a red sheet is on.
    const card = e.target.closest(".st-word");
    if (card && reg.mode !== "all") card.classList.toggle("is-open");
  }

  /* =====================================================================================================
     Speak practice
     ===================================================================================================== */
  function openPractice() {
    if (!hooks.lesson()) return;
    showSetup();
    openDialog(practiceDlg);
  }

  function showSetup() {
    const lesson = hooks.lesson();
    const chosen = DIRECTIONS[settings.get().direction] ? settings.get().direction : "en-ja";
    const options = Object.entries(DIRECTIONS).map(([key, d]) => `
      <label class="st-choice"><input type="radio" name="st-dir" value="${key}"${key === chosen ? " checked" : ""}>
        <span class="st-choice-icon" aria-hidden="true">${d.icon}</span>
        <span class="st-choice-text"><b>${d.title}</b><small>${d.hint}</small></span></label>`).join("");
    const mic = speech.canListen()
      ? "Allow the microphone when your browser asks."
      : "This browser can't listen, so you'll type your answers.";
    practiceDlg.innerHTML = practiceSheet(
      `<h2>Speak practice</h2><span class="st-sub">Lesson ${lesson.lesson} · ${lesson.words.length} words</span>`,
      `<fieldset class="st-choices"><legend>Pick your challenge</legend>${options}</fieldset>
       <ul class="st-points">
         <li><b>Miss a word?</b> It comes back until you nail it.</li>
         <li><b>${mic}</b></li>
         <li>Just for practice: no XP, no score.</li>
       </ul>`,
      `<button type="button" class="btn st-go" data-act="start">Start</button>`);
  }
  const practiceSheet = (head, body, foot) => `<div class="st-sheet"><header class="st-head"><div class="st-title">${head}</div>${closeBtn}</header><div class="st-body">${body}</div>${foot ? `<footer class="st-foot">${foot}</footer>` : ""}</div>`;

  async function startRun() {
    const lesson = hooks.lesson();
    const checked = practiceDlg.querySelector("input[name=st-dir]:checked");
    const dir = checked ? checked.value : "en-ja";
    settings.set({ direction: dir });
    const pool = dir === "ja-en" ? lesson.words.filter(F.canAnswerInEnglish) : lesson.words;
    const mine = (run = {
      dir, lessonWords: lesson.words, session: P.create(pool), total: pool.length, skippedLong: lesson.words.length - pool.length,
      typed: !speech.canListen(), cardId: 0, phase: "ask", verdict: null, notice: "", reveal: false, overrides: 0, timer: 0, japaneseVoice: true,
      streak: 0, bestStreak: 0,
    });
    if (dir === "ja-en") {
      const has = await speech.hasVoice(LANG.ja);
      if (run !== mine) return;
      mine.japaneseVoice = has;
      mine.reveal = !has;                       // no voice to hear: the word is shown instead
    }
    showCard();
  }

  const currentWord = () => P.current(run.session).word;

  function showCard() {
    clearTimeout(run.timer);
    if (P.isDone(run.session)) { showSummary(); return; }
    run.cardId += 1;
    run.phase = "ask"; run.verdict = null; run.notice = ""; run.empties = 0;
    if (run.dir === "ja-en") run.reveal = !run.japaneseVoice;
    renderCard();
    speakPrompt();
  }

  async function speakPrompt() {
    const id = run.cardId;
    const w = currentWord();
    const d = DIRECTIONS[run.dir];
    const text = d.hear === "ja" ? F.spokenJapanese(w) : F.spokenEnglish(w);
    const result = await speech.speak(text, LANG[d.hear], { rate: d.hear === "ja" ? JAPANESE_RATE : 1 });
    if (!run || run.cardId !== id || result !== "unavailable") return;
    run.reveal = true;                          // the assistant cannot speak here: show the prompt as text
    run.notice = "This browser cannot speak the prompt, so it is shown on screen.";
    if (run.phase === "ask") renderCard();
  }

  function renderCard() {
    const w = currentWord();
    const d = DIRECTIONS[run.dir];
    const s = P.summary(run.session);
    const judged = run.phase === "judged";
    const showJa = d.hear === "ja" && (run.reveal || judged);
    const prompt = d.hear === "en"
      ? `<p class="st-label">Say it in Japanese</p><p class="st-prompt">${esc(F.spokenEnglish(w))}</p>`
      : `<p class="st-label">Say the meaning in English</p>${showJa
          ? `<p class="st-prompt jp" lang="ja">${wordHtml(w)}</p>`
          : `<p class="st-prompt st-hidden" aria-hidden="true"><span class="st-wave"><i></i><i></i><i></i><i></i><i></i></span></p><button type="button" class="st-link" data-act="reveal">Show the word</button>`}`;
    const chip = run.streak >= 2 ? `<span class="st-streak" title="Correct answers in a row">🔥 ${run.streak}</span>` : "";
    const stateClass = judged ? (run.verdict.skipped ? " is-skip" : run.verdict.ok ? " is-yes" : " is-no") : "";
    practiceDlg.innerHTML = practiceSheet(
      `<h2>Speak practice</h2><span class="st-sub">${d.icon}</span>`,
      `<div class="st-progress" role="progressbar" aria-label="Words cleared" aria-valuemin="0" aria-valuemax="${run.total}" aria-valuenow="${s.cleared}">
         <span>${s.cleared} / ${run.total} cleared</span>${chip}<i style="--p:${run.total ? (s.cleared / run.total) * 100 : 0}%"></i></div>
       <section class="st-card${stateClass}">${prompt}
         <button type="button" class="st-link" data-act="replay">🔊 Say it again</button>
         ${judged ? verdictHtml(w) : answerHtml()}
       </section>`,
      judged
        ? `<button type="button" class="btn st-go" data-act="next">${run.verdict.ok ? "Next" : "Got it, next"}</button>${run.verdict.ok ? "" : overrideHtml()}`
        : `<button type="button" class="st-link" data-act="skip">I don't know</button><button type="button" class="st-link" data-act="end">End practice</button>`);
    const focus = practiceDlg.querySelector(judged ? "[data-act=next]" : run.typed ? "#st-type" : "#st-mic");
    if (focus) focus.focus({ preventScroll: true });
    if (judged && run.verdict.ok) run.timer = setTimeout(() => commit(true), CORRECT_PAUSE_MS);
  }
  const overrideHtml = () => (run.verdict.how === "voice" && !run.verdict.skipped
    ? `<button type="button" class="st-link" data-act="override">I said it right</button>` : "");

  function answerHtml() {
    const listening = run.phase === "listening";
    const d = DIRECTIONS[run.dir];
    const note = run.notice ? `<p class="st-notice" role="status">${esc(run.notice)}</p>` : "";
    if (run.typed) {
      const label = d.say === "ja" ? "Type the Japanese word (kana, kanji or romaji)" : "Type the meaning in English";
      const canTry = speech.canListen();
      return `${note}<form class="st-type" data-form="type" autocomplete="off">
          <label for="st-type">${label}</label>
          <div class="st-type-row"><input id="st-type" type="text" lang="${d.say === "ja" ? "ja" : "en"}" autocapitalize="off" autocorrect="off" spellcheck="false"><button type="submit" class="btn">Check</button></div>
        </form>
        ${canTry ? `<button type="button" class="st-link" data-act="use-mic">🎙 Use the microphone</button>` : `<button type="button" class="st-link" data-act="retry-mic">Try the microphone again</button>`}`;
    }
    return `${note}<button type="button" class="st-mic${listening ? " is-live" : ""}" id="st-mic" data-act="mic" aria-pressed="${listening}">
        <span class="st-mic-icon" aria-hidden="true">🎙</span></button>
      <p class="st-mic-label">${listening ? "Listening… speak now" : "Tap and speak"}</p>
      <button type="button" class="st-link" data-act="use-typing">Type instead</button>`;
  }

  function verdictHtml(w) {
    const v = run.verdict;
    const heard = v.heard ? `<p class="st-heard">${v.how === "typed" ? "You typed" : "I heard"}: <q>${esc(v.heard)}</q></p>` : "";
    const head = v.skipped ? `<p class="st-verdict skip" role="status"><span class="st-badge" aria-hidden="true">?</span> No problem, here it is.</p>`
      : v.ok ? `<p class="st-verdict yes" role="status"><span class="st-badge" aria-hidden="true">✓</span> Correct!</p>`
        : `<p class="st-verdict no" role="status"><span class="st-badge" aria-hidden="true">✗</span> Not quite</p>`;
    return `${head}${heard}
      <div class="st-reveal"><span class="st-ja jp" lang="ja">${wordHtml(w)}</span><span class="st-rom">${esc(w.romaji)}</span><span class="st-en">${esc(w.en)}</span></div>
      ${v.ok ? "" : `<p class="st-again">This word will come back soon.</p>`}`;
  }

  /* ---------- answering ---------- */
  async function onMic() {
    if (run.phase !== "ask") return;
    const id = run.cardId;
    run.phase = "listening"; run.notice = "";
    renderCard();
    const result = await speech.listen(LANG[DIRECTIONS[run.dir].say]);
    if (!run || run.cardId !== id || run.phase !== "listening") return;       // skipped, ended or closed meanwhile
    if (result.ok) { judge(result.alternatives, "voice"); return; }
    run.phase = "ask";
    if (result.reason === "no-speech") run.empties += 1;
    if (result.reason !== "aborted") run.notice = NOTICES[result.reason] || NOTICES.error;
    if (result.reason === "no-speech" && run.empties >= 2) run.notice += " Having trouble? You can type instead.";
    if (["denied", "no-microphone", "unsupported", "network"].includes(result.reason)) run.typed = true;
    renderCard();
  }

  function judge(candidates, how) {
    const w = currentWord();
    const r = DIRECTIONS[run.dir].say === "ja"
      ? M.judgeJapanese(M.sameMeaning(w, run.lessonWords), candidates)
      : M.judgeEnglish(w, candidates);
    run.phase = "judged";
    run.verdict = { ok: r.ok, heard: r.heard, how, skipped: false };
    renderCard();
  }

  // Records the result for the word on screen and moves to the next one.
  function commit(ok) {
    if (!run || run.phase !== "judged") return;
    clearTimeout(run.timer);
    run.streak = ok ? run.streak + 1 : 0;
    run.bestStreak = Math.max(run.bestStreak, run.streak);
    P.answer(run.session, ok);
    showCard();
  }

  function onClick(e) {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    if (act === "close") { practiceDlg.close(); return; }
    if (act === "start") { startRun(); return; }
    if (!run) { if (act === "again") showSetup(); return; }
    switch (act) {
      case "mic": onMic(); break;
      case "replay": speech.cancel(); if (run.phase === "listening") { run.phase = "ask"; renderCard(); } speakPrompt(); break;
      case "reveal": run.reveal = true; renderCard(); break;
      case "skip":
        speech.cancel();
        run.phase = "judged"; run.verdict = { ok: false, heard: "", how: "skip", skipped: true };
        renderCard();
        break;
      case "next": commit(run.verdict.ok); break;
      case "override": run.overrides += 1; commit(true); break;
      case "end": speech.cancel(); P.end(run.session); showSummary(); break;
      case "use-typing": speech.cancel(); run.typed = true; run.phase = "ask"; renderCard(); break;
      case "use-mic": run.typed = false; renderCard(); break;
      case "retry-mic": speech.resetMicrophone(); if (speech.canListen()) { run.typed = false; run.notice = ""; } renderCard(); break;
      case "again": showSetup(); run = null; break;
      default: break;
    }
  }
  function onSubmit(e) {
    if (!e.target.matches("[data-form=type]")) return;
    e.preventDefault();
    if (!run || run.phase !== "ask") return;
    const value = practiceDlg.querySelector("#st-type").value.trim();
    if (!value) { run.notice = "Type your answer first."; renderCard(); return; }
    judge([value], "typed");
  }

  /* ---------- summary ---------- */
  function showSummary() {
    const s = P.summary(run.session);
    const started = s.attempted > 0;
    const finished = started && s.remaining === 0;
    const pct = s.total ? Math.round((s.firstTry / s.total) * 100) : 0;
    const stars = finished ? (pct >= 90 ? 3 : pct >= 60 ? 2 : 1) : 0;
    const title = !started ? "Nothing practised yet" : finished ? "All words cleared!" : "Practice ended";
    const hardest = s.hardest.slice(0, 8).map((h) => `<li><span class="st-ja jp" lang="ja">${wordHtml(h.word)}</span><span class="st-en">${esc(h.word.en)}</span><b>${h.misses}×</b></li>`).join("");
    const extra = [
      started && s.remaining ? `${s.remaining} word${s.remaining === 1 ? "" : "s"} not cleared yet.` : "",
      run.skippedLong ? `${run.skippedLong} long entr${run.skippedLong === 1 ? "y was" : "ies were"} left out because they are hard to say aloud.` : "",
      run.overrides ? `You marked ${run.overrides} answer${run.overrides === 1 ? "" : "s"} as correct yourself.` : "",
    ].filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join("");
    const body = !started
      ? `<div class="st-empty"><span aria-hidden="true">🌱</span><p>You ended before answering any word.<br>Start again whenever you're ready.</p></div>${extra ? `<ul class="st-points">${extra}</ul>` : ""}`
      : `<div class="st-grade${finished ? " is-done" : ""}" style="--p:${pct}">
           <div class="st-ring"><b>${pct}%</b><span>first try</span></div>
           ${finished ? `<div class="st-stars" role="img" aria-label="${stars} of 3 stars">${[1, 2, 3].map((i) => `<span class="${i <= stars ? "on" : ""}">★</span>`).join("")}</div>` : ""}
         </div>
         <div class="st-stats">
           <div><b>${s.cleared}/${s.total}</b><span>cleared</span></div>
           <div><b>${s.answers}</b><span>answers</span></div>
           <div><b>${run.bestStreak}</b><span>best streak</span></div></div>
         ${extra ? `<ul class="st-points">${extra}</ul>` : ""}
         ${hardest ? `<h3>Needed the most practice</h3><ol class="st-hard">${hardest}</ol>` : finished ? `<p class="st-verdict yes st-flawless">Every word was right the first time!</p>` : ""}`;
    practiceDlg.innerHTML = practiceSheet(`<h2>${title}</h2>`, body,
      `<button type="button" class="btn st-go" data-act="again">${started ? "Practise again" : "Back"}</button><button type="button" class="st-link" data-act="close">Close</button>`);
    speech.cancel();
    const again = practiceDlg.querySelector("[data-act=again]");
    if (again) again.focus({ preventScroll: true });
  }

  /* ---------- start-up ---------- */
  function init(h) {
    hooks = h;
    vocabDlg = makeDialog("st-vocab", "Lesson vocabulary", "st-register");
    practiceDlg = makeDialog("st-practice", "Speak practice", "st-speak");
    vocabDlg.addEventListener("click", onVocabClick);
    practiceDlg.addEventListener("click", onClick);
    practiceDlg.addEventListener("submit", onSubmit);
    // The quiz card draws the opening buttons (next to Hint and Romaji) on every question, so listen for them anywhere.
    doc.addEventListener("click", (e) => {
      const b = e.target.closest("[data-study]");
      if (b) (b.dataset.study === "vocab" ? openVocabulary : openPractice)();
    });
    root.addEventListener("hashchange", closeAll);                // another lesson or track: nothing here applies any more
    doc.addEventListener("visibilitychange", () => { if (doc.hidden) speech.cancel(); });
  }

  Study.UI = { init };
  root.StudyUI = Study.UI;
})(window);
