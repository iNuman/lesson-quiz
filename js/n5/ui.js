/* N5 track — UI. Routes: #/n5 (home), #/n5/session (today's lesson), #/n5/about (sources & scope).
   Everything N5 renders into #n5-root; the vocabulary lessons are untouched. Logic lives in the pure modules
   (kana, markup, scheduler, model, questions, composer, readiness) — this file only draws and wires events. */
(function () {
  "use strict";

  // The track switch must always work, even if the N5 files failed to load.
  const lastLesson = () => {
    try { const n = Number(localStorage.getItem("jpquiz.lastLesson")); if (window.LESSON_DATA && window.LESSON_DATA[n]) return n; } catch (e) { /* ignore */ }
    return Object.keys(window.LESSON_DATA || {}).map(Number).sort((a, b) => a - b)[0] || 16;
  };
  const btnV = document.getElementById("mode-vocab"), btnN = document.getElementById("mode-n5");
  if (btnV) btnV.addEventListener("click", () => { location.hash = "#/lesson/" + lastLesson(); });
  if (btnN) btnN.addEventListener("click", () => { location.hash = "#/n5"; });

  const N5 = window.N5, D = window.N5_DATA, G = window.Game;
  const root = document.getElementById("n5-root");
  if (!N5 || !D || !N5.Composer || !root || !G) { window.N5UI = { handles: () => false, show() {}, hide() {} }; return; }
  const { Kana, Markup: MK, Model: M, Scheduler: S, Questions: Q, Composer: C, Readiness: R } = N5;

  const store = {
    getItem(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable: progress lasts for this visit only */ } },
  };
  let state = M.load(store);
  const save = () => M.save(store, state);
  const esc = MK.esc;
  const today = () => S.dayNumber();
  const LETTERS = ["A", "B", "C", "D"];
  const STATE_LABEL = { new: "Not met yet", seen: "Just met", learning: "Learning", review: "Reviewing", fading: "Fading", mastered: "Mastered" };
  const SKILL_LABEL = { meaning: "Meaning", reading: "Reading", vocab: "Words", context: "Context", recall: "Recall" };
  const rand = Math.random;

  let view = "home", run = null, selected = null;

  /* ---------- small helpers ---------- */
  const known = () => new Set([...state.introduced, ...(run && run.learnSeen ? run.plan.newKanji : [])]);
  const rb = (markup, noRt) => MK.toHtml(markup, { known: known(), noRt });
  const kunDisp = (k) => k.kun.map(Kana.displayReading);
  const unitOfKanji = (k) => D.units.find((u) => u.kanji.includes(k));
  const plural = (n, w, pl) => `${n} ${n === 1 ? w : pl || w + "s"}`;
  const setPressed = (on) => { if (btnN) btnN.setAttribute("aria-pressed", String(on)); if (btnV) btnV.setAttribute("aria-pressed", String(!on)); };
  const hud = () => G.renderHud(run ? run.sess : null);
  const go = (h) => { if (location.hash === h) show(h); else location.hash = h; };
  const focusFirst = () => { const el = root.querySelector("[data-autofocus]"); if (el) setTimeout(() => el.focus({ preventScroll: true }), 30); };

  /* ---------- entry points used by app.js ---------- */
  function handles(hash) { return /^#\/n5(\/|$)/.test(hash || ""); }
  function show(hash) {
    root.hidden = false;
    setPressed(true);
    const sub = (hash || "").replace(/^#\/n5\/?/, "");
    document.title = "N5 Kanji · Japanese Vocabulary Quiz";
    if (sub === "session") {
      if (!run && !startRun("day")) { view = "home"; if (location.hash !== "#/n5") location.hash = "#/n5"; }
      else view = "session";
    } else view = sub === "about" ? "about" : "home";
    hud();
    render();
    window.scrollTo(0, 0);
  }
  function hide() { root.hidden = true; setPressed(false); }

  function render() {
    root.classList.toggle("rt-off", !state.settings.showReadings);
    if (view === "about") renderAbout();
    else if (view === "session" && run) renderRun();
    else renderHome();
    focusFirst();
  }

  /* =====================================================================================================
     HOME
     ===================================================================================================== */
  function detailHtml(k, o) {
    o = o || {};
    const me = D.kanji[k], rec = state.kanji[k], t = today();
    const isKnown = known().has(k);
    if (!isKnown) return `<p class="n5-muted">${esc(k)} is in Unit ${me.unit} (${esc(unitOfKanji(k).title)}). You will meet it in a future lesson.</p>`;
    const kn = new Set([...known()]);
    const words = Object.values(D.vocab).filter((v) => v.kanji.includes(k) && v.kanji.every((x) => kn.has(x))).slice(0, 5);
    const sent = Object.values(D.sentences).find((s) => s.requires.includes(k) && s.requires.every((x) => kn.has(x)) && s.focus.length);
    const st = rec ? M.stateOf(state, k, t) : "seen";
    const tileRt = run && run.tileRt && run.tileRt[k] ? ` data-rt="${run.tileRt[k]}"` : "";
    return `<div class="n5-detail"${tileRt}>
      <div class="top">
        <div class="n5-bigk jp" lang="ja"><ruby class="kn">${esc(k)}<rt>${esc(Kana.primaryReading(me))}</rt></ruby></div>
        <div>
          <div class="mean">${esc(me.meaning)}</div>
          <div class="kchips">
            ${me.on.map((r) => `<span class="kchip jp" lang="ja"><small>音</small>${esc(r)}</span>`).join("")}
            ${kunDisp(me).map((r) => `<span class="kchip jp" lang="ja"><small>訓</small>${esc(r)}</span>`).join("")}
          </div>
        </div>
      </div>
      ${me.note ? `<p class="n5-muted n5-small" style="margin:0">${esc(me.note)}</p>` : ""}
      <ul class="n5-words">${words.map((v) => `<li><span class="w jp" lang="ja">${rb(v.ruby)}</span><span class="en">${esc(v.en)}</span></li>`).join("")}</ul>
      ${sent ? `<div class="n5-sent"><div class="n5-ja jp" lang="ja">${rb(sent.ja)}</div><p class="n5-en">${esc(sent.en)}</p></div>` : ""}
      ${o.stats && rec ? statsHtml(k, rec, st, t) : ""}
    </div>`;
  }
  function statsHtml(k, rec, st, t) {
    const due = S.isDue(rec, t);
    return `<div><p style="margin:0 0 6px"><span class="n5-badge ${st === "mastered" ? "ok" : ""}">${STATE_LABEL[st]}</span>
      <span class="n5-muted n5-small"> · ${rec.attempts ? `${rec.correct} of ${rec.attempts} answers solid, ${rec.hinted} with hints` : "not practised yet"}${rec.attempts ? ` · next review ${due ? "now" : "in " + plural(rec.next - t, "day")}` : ""}</span></p>
      <div class="n5-skills">${M.SKILLS.map((s) => `<div><i><b style="--w:${Math.round(rec.skills[s] * 100)}%"></b></i>${SKILL_LABEL[s]}</div>`).join("")}</div></div>`;
  }

  function stepper(key, label, sub, min, max) {
    const v = state.settings[key];
    return `<div class="n5-set"><div class="lbl">${label}<small>${sub}</small></div>
      <div class="stepper"><button type="button" data-act="step" data-key="${key}" data-d="-1" aria-label="Fewer: ${label}" ${v <= min ? "disabled" : ""}>−</button><output aria-live="polite">${v}</output><button type="button" data-act="step" data-key="${key}" data-d="1" aria-label="More: ${label}" ${v >= max ? "disabled" : ""}>+</button></div></div>`;
  }

  function renderHome() {
    const t = today();
    const rec = state.days[t];
    const plan = C.compose({ data: D, state, today: t });
    const counts = M.stateCounts(state, D.curriculum, t);
    const started = rec && rec.stepsDone && rec.stepsDone.length > 0 && !rec.done;
    const doneToday = !!(rec && rec.done);
    const unit = plan.hasNew ? unitOfKanji(plan.newKanji[0]) : null;
    const reviewN = plan.review.kanji.length;
    const meta = (arr) => `<div class="n5-meta">${arr.map((x) => `<span>${x}</span>`).join("")}</div>`;
    let hero;
    if (plan.finished) {
      hero = `<p class="n5-eyebrow">All caught up</p><h1>Nothing to study right now</h1>
        <p>You have met every kanji in this release and no reviews are due. Come back tomorrow — reviews return exactly when they are due.</p>`;
    } else if (doneToday) {
      hero = `<p class="n5-eyebrow">Today's lesson</p><h1>Today's lesson is complete ✓</h1>
        <p>Nice work. ${reviewN ? `You can do ${plural(reviewN, "extra review")} now.` : "Nothing else is due today."} New kanji arrive tomorrow.</p>
        ${reviewN ? `<div style="margin-top:14px"><button type="button" class="btn" data-act="begin" data-mode="review" data-autofocus>Review now (${reviewN})</button></div>` : ""}
        ${plan.hasNew ? `<div style="margin-top:10px"><button type="button" class="btn ghost" data-act="begin" data-mode="extra">Learn the next set today as well</button></div>` : ""}`;
    } else {
      const label = started ? "Continue today's lesson" : plan.hasNew ? "Start today's lesson" : "Start today's review";
      hero = `<p class="n5-eyebrow">${unit ? `Unit ${unit.id} · ${esc(unit.title)}` : "Review"}</p>
        <h1>${plan.hasNew ? `${plural(plan.newKanji.length, "new kanji", "new kanji")} today` : "Time to review"}</h1>
        ${plan.hasNew ? `<div class="n5-glyphs jp" lang="ja" aria-hidden="true">${plan.newKanji.map((k) => `<span>${esc(k)}</span>`).join("")}</div>` : ""}
        ${meta([`⏱ about ${plan.estimateMinutes} min`, reviewN ? `🔁 ${plural(reviewN, "review")}` : "🔁 no reviews yet", plan.hasNew ? "📖 passage + questions" : ""].filter(Boolean))}
        ${plan.review.overflow ? `<p class="n5-small">${plan.review.overflow} more ${plan.review.overflow === 1 ? "kanji is" : "kanji are"} due — kept for another day so today stays manageable.</p>` : ""}
        <button type="button" class="btn" data-act="begin" data-mode="${plan.hasNew ? "day" : "review"}" data-autofocus>${label}</button>`;
    }

    const mapTiles = D.curriculum.map((k) => {
      const st = M.stateOf(state, k, t), r = state.kanji[k];
      const w = r ? Math.round(M.skillMean(r) * 100) : 0;
      return `<button type="button" class="mtile jp s-${st}" lang="ja" data-act="sel-k" data-k="${esc(k)}" aria-pressed="${selected === k}" aria-label="${esc(k)}: ${STATE_LABEL[st]}${r ? `, ${w}% skill` : ""}">${esc(k)}<span class="mbar"><i style="--w:${w}%"></i></span></button>`;
    }).join("");

    const ready = R.compute(state, D.meta.capabilities);
    const readyRows = ready.areas.map((a) => {
      if (a.status === "unavailable") return `<div class="row off"><span class="name">${a.label}</span><span class="val">not in this release yet</span><span class="meter"><i></i></span></div>`;
      if (a.status === "building") return `<div class="row"><span class="name">${a.label}</span><span class="val">building evidence · ${a.items}/${a.needs} different questions</span><span class="meter"><i style="--w:${Math.round((a.items / a.needs) * 100)}%;opacity:.35"></i></span></div>`;
      return `<div class="row"><span class="name">${a.label}</span><span class="val">${Math.round(a.score * 100)}%</span><span class="meter"><i style="--w:${Math.round(a.score * 100)}%"></i></span></div>`;
    }).join("");

    root.innerHTML = `
      <section class="n5-hero" aria-labelledby="n5-h">${hero.replace("<h1>", '<h1 id="n5-h">')}</section>

      <section class="n5-block" aria-label="Mastery">
        <h2 class="n5-h2">Your kanji</h2>
        <div class="n5-stats" role="list">
          <div role="listitem" style="--c:var(--st-mastered)"><b>${counts.mastered}</b><span>Mastered</span></div>
          <div role="listitem" style="--c:var(--st-review)"><b>${counts.review + counts.fading}</b><span>Reviewing</span></div>
          <div role="listitem" style="--c:var(--st-learning)"><b>${counts.learning + counts.seen}</b><span>Learning</span></div>
          <div role="listitem" style="--c:var(--st-new)"><b>${counts.new}</b><span>Not met</span></div>
        </div>
        <div class="n5-map" style="margin-top:12px" role="group" aria-label="All kanji in this release">${mapTiles}</div>
        <div class="n5-legend" aria-hidden="true">${["new", "seen", "learning", "review", "fading", "mastered"].map((s) => `<span><i class="s-${s}"></i>${STATE_LABEL[s]}</span>`).join("")}</div>
        ${selected ? `<div class="card" style="margin-top:12px">${detailHtml(selected, { stats: true })}</div>` : ""}
        <p class="n5-small n5-muted" style="margin:10px 0 0">“Mastered” means correct without hints for meaning, reading and context, plus typed recall, on several different days. A correct answer with a hint counts half.</p>
      </section>

      <section class="n5-block" aria-labelledby="n5-set-h">
        <h2 class="n5-h2" id="n5-set-h">Settings</h2>
        <div class="n5-panel">
          ${stepper("newPerDay", "New kanji per day", doneToday || started ? "applies from the next set" : "default 6", 3, 10)}
          ${stepper("reviewCap", "Most reviews per day", "keeps a busy day manageable", 5, 30)}
          <div class="n5-set"><div class="lbl">Show readings<small>furigana over kanji you know. Unfamiliar kanji always keep theirs.</small></div>
            <button type="button" class="switch" data-act="toggle-rt" aria-pressed="${state.settings.showReadings}">${state.settings.showReadings ? "On" : "Off"}</button></div>
        </div>
      </section>

      <section class="n5-block" aria-labelledby="n5-ready-h">
        <h2 class="n5-h2" id="n5-ready-h">Exam readiness</h2>
        <div class="n5-panel">
          <div class="n5-ready">${readyRows}</div>
          <p class="n5-note">${esc(ready.note)} Each figure comes from answers to different questions and counts hinted answers at half. It does not depend on how many lessons you have finished.</p>
        </div>
      </section>

      <p class="n5-small n5-muted">Progress is saved in this browser only. <button type="button" class="n5-link" data-act="about">Sources, review status and scope</button> ·
        <button type="button" class="n5-link" data-act="reset">Reset N5 progress</button></p>`;
  }

  /* =====================================================================================================
     SESSION
     ===================================================================================================== */
  function startRun(mode) {
    const t = today();
    const rec = M.dayRec(state, t);
    if (mode === "extra") {
      const have = new Set(state.introduced);
      const next = D.curriculum.filter((k) => !have.has(k)).slice(0, state.settings.newPerDay);
      if (!next.length) return false;
      rec.sets = (rec.sets || []).concat(rec.newKanji || []);
      rec.newKanji = next; rec.stepsDone = []; rec.done = false;
      save();
    }
    let plan;
    if (mode === "review") {
      const review = C.reviewFor(D, state, t, []);
      if (!review.kanji.length) return false;
      plan = { today: t, newKanji: [], hasNew: false, review, steps: [{ id: "review", kind: "questions", title: C.STEP_TITLES.review, count: review.kanji.length }, { id: "finish", kind: "finish", title: C.STEP_TITLES.finish }] };
    } else {
      plan = C.compose({ data: D, state, today: t });
      if (plan.finished) return false;
    }
    const skip = mode === "review" ? [] : (rec.stepsDone || []);
    const steps = plan.steps.filter((s) => s.id === "finish" || !skip.includes(s.id));
    run = {
      mode, plan, steps, i: 0, t, sess: { combo: 0 }, q: null, learnSeen: false, sel: null, viewed: new Set(), tileRt: {},
      stats: { answered: 0, solid: 0, hinted: 0, xp: 0 }, retried: new Set(), sentences: null, pEn: false, pRt: null, sEn: {}, sRt: {},
      startCounts: M.stateCounts(state, D.curriculum, t), finished: false,
    };
    return true;
  }

  const step = () => run.steps[run.i];
  function finishStep() {
    const s = step();
    if (run.mode !== "review" && s.id !== "finish") { const rec = M.dayRec(state, run.t); if (!rec.stepsDone.includes(s.id)) rec.stepsDone.push(s.id); }
    if (s.id === "comprehension") for (const u of s.units) state.units[u] = Object.assign(state.units[u] || {}, { passageRead: true, readOn: run.t });
    save();
    run.i = Math.min(run.i + 1, run.steps.length - 1);
    run.q = null;
    render();
    window.scrollTo(0, 0);
  }
  const award = (n, o) => {
    const info = G.awardXp(n, o);
    run.stats.xp += n;
    hud();
    return info;
  };

  function header() {
    const bar = run.steps.map((s, i) => `<i class="${i < run.i ? "done" : i === run.i ? "now" : ""}"></i>`).join("");
    return `<div class="n5-steps" aria-hidden="true">${bar}</div>
      <div class="n5-crumb"><span>Step ${run.i + 1} of ${run.steps.length} · <b>${esc(step().title)}</b></span>
        <button type="button" class="n5-link" data-act="quit">Leave</button></div>`;
  }
  function renderRun() {
    const s = step();
    const body = s.kind === "learn" ? renderLearn(s) : s.kind === "sentences" ? renderSentences() : s.kind === "passage" ? renderPassage(s)
      : s.kind === "questions" ? renderQuestionStep(s) : renderFinish();
    if (body == null) return;   // the step skipped itself
    root.innerHTML = header() + body;
  }

  /* ---- learn: the horizontal kanji row ---- */
  function renderLearn(s) {
    run.learnSeen = true;
    const ks = s.kanji;
    if (!run.sel) { run.sel = ks[0]; run.viewed.add(ks[0]); }
    const all = ks.every((k) => run.viewed.has(k));
    const tiles = ks.map((k) => {
      const me = D.kanji[k];
      const rt = run.tileRt[k] ? ` data-rt="${run.tileRt[k]}"` : "";
      return `<button type="button" class="ktile ${run.viewed.has(k) ? "seen" : ""}" data-act="tile" data-k="${esc(k)}" aria-current="${run.sel === k}"${rt} aria-label="${esc(k)}, ${esc(me.meaning)}">
        <span class="kg jp" lang="ja"><ruby class="kn">${esc(k)}<rt>${esc(Kana.primaryReading(me))}</rt></ruby></span><span class="mean">${esc(me.meaning.split(";")[0])}</span></button>`;
    }).join("");
    const rtOn = run.tileRt[run.sel] === "on" || (run.tileRt[run.sel] !== "off" && state.settings.showReadings);
    return `<div class="krow-bar"><h2 class="n5-h2" style="margin:0">Meet today's kanji</h2>
        <button type="button" class="rt-btn" data-act="toggle-rt" aria-pressed="${state.settings.showReadings}" title="Show or hide the hiragana over every kanji you know">あ All readings</button></div>
      <p class="n5-muted n5-small" style="margin:0 0 4px">Scroll sideways and tap each kanji. The hiragana above each character is its main reading.</p>
      <div class="krow" role="list">${tiles}</div>
      <section class="card" aria-live="polite">
        <div class="tools" style="display:flex;justify-content:flex-end;margin-bottom:6px"><button type="button" class="rt-btn" data-act="tile-rt" aria-pressed="${rtOn}">あ Reading on this kanji</button></div>
        ${detailHtml(run.sel)}
      </section>
      <div style="margin-top:14px"><button type="button" class="btn" data-act="learn-next" ${all ? "data-autofocus" : "disabled"}>${all ? "Continue — I've met these kanji" : `Look at every kanji to continue (${ks.filter((k) => run.viewed.has(k)).length}/${ks.length})`}</button></div>`;
  }
  function learnDone() {
    const s = step();
    M.introduce(state, s.kanji, run.t);
    M.dayRec(state, run.t).newKanji = s.kanji.slice();
    award(2 * s.kanji.length);
    finishStep();
  }

  /* ---- sentences ---- */
  function renderSentences() {
    if (!run.sentences) run.sentences = C.sentencesFor(run.plan, { data: D, state, rng: rand });
    const list = run.sentences;
    if (!list.length) { setTimeout(finishStep, 0); return null; }
    return `<section class="card n5-block">
      <h2 class="n5-h2">Kanji in real sentences</h2>
      <p class="n5-muted n5-small" style="margin:-4px 0 12px">Tap あ to show or hide readings on one sentence, and EN for the English.</p>
      <div class="n5-sents">${list.map((s) => `<article class="n5-sent" data-sid="${s.id}"${run.sRt[s.id] ? ` data-rt="${run.sRt[s.id]}"` : ""}>
        <div class="n5-ja jp" lang="ja">${rb(s.ja)}</div>
        <p class="n5-en" ${run.sEn[s.id] ? "" : "hidden"}>${esc(s.en)}</p>
        <div class="n5-tools"><button type="button" class="rt-btn" data-act="sent-rt" data-sid="${s.id}" aria-pressed="${run.sRt[s.id] === "on" || (run.sRt[s.id] !== "off" && state.settings.showReadings)}">あ Readings</button>
        <button type="button" class="rt-btn" data-act="sent-en" data-sid="${s.id}" aria-pressed="${!!run.sEn[s.id]}">EN English</button></div></article>`).join("")}</div>
      <p class="n5-source">Original sentences written for this app. Readings are checked against KANJIDIC2 and JMdict; the naturalness of the Japanese still needs review by a proficient speaker.</p>
    </section>
    <div style="margin-top:14px"><button type="button" class="btn" data-act="sent-next" data-autofocus>Continue to the reading</button></div>`;
  }

  /* ---- passage ---- */
  function passageHtml(p, o) {
    o = o || {};
    return `<article class="n5-passage" ${run && run.pRt ? `data-rt="${run.pRt}"` : ""}>
      <h2 class="jp" lang="ja">${rb(p.title)}</h2>
      ${p.paragraphs.map((x, i) => `<p class="para"><span class="n5-ja jp" lang="ja">${rb(x)}</span><span class="n5-en" ${o.en ? "" : "hidden"}>${esc(p.paragraphsEn[i])}</span></p>`).join("")}</article>`;
  }
  function renderPassage(s) {
    const ps = s.units.map((u) => D.passages[u]);
    const rtOn = run.pRt === "on" || (run.pRt !== "off" && state.settings.showReadings);
    return `<section class="card">
      <div class="krow-bar"><span class="n5-badge">Original passage</span>
        <span style="display:flex;gap:8px"><button type="button" class="rt-btn" data-act="p-rt" aria-pressed="${rtOn}">あ Readings</button>
        <button type="button" class="rt-btn" data-act="p-en" aria-pressed="${run.pEn}">EN English</button></span></div>
      ${ps.map((p) => passageHtml(p, { en: run.pEn })).join("")}
      <p class="n5-source">Written for this app using today's kanji. Kanji you have not met yet always show their reading. This text needs review by a proficient Japanese speaker.</p>
    </section>
    <div style="margin-top:14px"><button type="button" class="btn" data-act="p-next" data-autofocus>I've read it — ask me about it</button></div>`;
  }

  /* ---- questions ---- */
  function renderQuestionStep(s) {
    if (!run.q || run.q.stepId !== s.id) {
      const list = C.buildStep(s, run.plan, { data: D, state, rng: rand });
      if (!list.length) { setTimeout(finishStep, 0); return null; }
      run.q = { stepId: s.id, list, i: 0, hinted: false, shown: {}, gone: new Set(), res: null, flipped: false };
    }
    return questionHtml();
  }
  const cur = () => run.q.list[run.q.i];

  function promptHtml(q) {
    const p = q.prompt, o = run.q;
    if (p.kind === "kanji") return `<p class="q-glyph jp" lang="ja">${esc(p.glyph)}</p><p class="q-ask">${esc(p.ask)}</p>`;
    if (p.kind === "vocab") return `<p class="q-word jp" lang="ja">${rb(p.markup)}</p><p class="q-ask">${esc(p.ask)}</p>`;
    if (p.kind === "recall-vocab") return `<p class="q-word jp" lang="ja">${esc(p.ja)}</p><p class="q-gloss">${esc(p.en)}</p><p class="q-ask">${esc(p.ask)}</p>`;
    if (p.kind === "sentence") {
      const mark = p.markAs === "underline" ? `<u class="focus">${MK.toHtml(p.mark, { noRt: true })}</u>`
        : p.markAs === "kana" ? `<u class="focus">${esc(p.kana)}</u>` : `<span class="blank">＿＿＿＿</span>`;
      return `<p class="q-sentence jp" lang="ja">${MK.replaceMark(p.markup, p.mark, mark, { known: known() })}</p><p class="q-ask">${esc(p.ask)}</p>`;
    }
    if (p.kind === "text") {
      const peek = p.passage ? `<details class="n5-peek" ${o.stepId === "comprehension" ? "open" : ""}><summary>${o.stepId === "comprehension" ? "The passage" : "Show the passage"}</summary>${passageHtml(D.passages[p.passage], { en: false })}</details>` : "";
      return `${peek}<p class="q-sentence jp" lang="ja">${rb(p.markup)}</p>`;
    }
    return "";
  }
  function hintBtns(q) {
    const o = run.q;
    return (q.hints || []).map((h) => {
      const on = !!o.shown[h.id];
      return `<button type="button" class="rt-btn" data-act="hint" data-h="${h.id}" aria-pressed="${on}" ${o.res ? "disabled" : ""}>💡 ${esc(h.label)}</button>`;
    }).join("");
  }
  function hintOut(q) {
    const o = run.q, out = [];
    const h = (id) => (q.hints || []).find((x) => x.id === id);
    if (o.shown.english && h("english")) out.push(`<div class="q-extra">${esc(h("english").text)}</div>`);
    if (o.shown.example && h("example")) out.push(`<div class="q-extra"><span class="jp" lang="ja">${rb(h("example").markup)}</span> · ${esc(h("example").en)}</div>`);
    if (o["shown"]["first-kana"] && h("first-kana")) out.push(`<div class="q-extra jp" lang="ja">${esc(h("first-kana").text)}</div>`);
    if (o.shown.reveal && h("reveal")) out.push(`<div class="q-extra jp" lang="ja">${esc(h("reveal").text)}</div>`);
    return out.join("");
  }

  function questionHtml() {
    const o = run.q, q = cur(), n = o.list.length;
    const done = o.i + (o.res ? 1 : 0);
    const segs = o.list.map((x, i) => `<i class="${i < o.i || (i === o.i && o.res) ? (o.marks && o.marks[i] === 0 ? "bad" : "ok") : i === o.i ? "now" : ""}"></i>`).join("");
    const showRt = (o.shown.readings ? " show-rt" : "") + (q.type === "passage" ? " q-open" : "");
    let answer = "";
    if (q.answerKind === "choice") {
      answer = `<div class="options" role="group" aria-label="Choices">${q.options.map((opt, i) => {
        let cls = "opt";
        if (o.gone.has(i)) cls += " is-gone";
        if (o.res) cls += opt === q.answer ? " is-correct" : i === o.res.pick ? " is-wrong" : " is-dim";
        const label = q.optionsAreMarkup ? rb(opt) : esc(opt);
        return `<button type="button" class="${cls}" data-act="opt" data-i="${i}" ${o.res || o.gone.has(i) ? "disabled" : ""}><span class="key" aria-hidden="true">${LETTERS[i]}</span><span class="lab jp" lang="ja">${label}</span></button>`;
      }).join("")}</div>`;
    } else if (q.answerKind === "typed") {
      answer = `<div class="typed">
        <input id="n5-type" type="text" lang="ja" inputmode="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="Reading in hiragana" placeholder="ひらがな (romaji works too)" value="${o.res ? esc(o.res.typed) : ""}" class="${o.res ? (o.res.credit > 0 ? "good" : "bad") : ""}" ${o.res ? "readonly" : ""} data-autofocus>
        <div class="preview jp" id="n5-preview" lang="ja" aria-live="polite"></div>
        <div class="msg" id="n5-msg" role="alert"></div>
        ${o.res ? "" : `<div class="row"><button type="button" class="btn" data-act="check">Check</button><button type="button" class="btn ghost" data-act="giveup">I don't know</button></div>`}</div>`;
    } else {
      const b = q.back;
      answer = o.flipped ? `<div class="flip-back">
          <div><div class="mean" style="font-size:1.3rem;font-weight:800">${esc(b.meaning)}</div>
          <div class="kchips">${b.on.map((r) => `<span class="kchip jp" lang="ja"><small>音</small>${esc(r)}</span>`).join("")}${b.kun.map((r) => `<span class="kchip jp" lang="ja"><small>訓</small>${esc(r)}</span>`).join("")}</div></div>
          <ul class="n5-words">${b.words.map((w) => `<li><span class="w jp" lang="ja">${rb(w.markup)}</span><span class="en">${esc(w.en)}</span></li>`).join("")}</ul>
          ${o.res ? "" : `<p class="q-ask" style="margin:0">How well did you remember it?</p><div class="rate"><button type="button" data-act="rate" data-r="again">Missed it</button><button type="button" data-act="rate" data-r="hard">Almost</button><button type="button" data-act="rate" data-r="good" data-autofocus>Knew it</button></div>
          <p class="credit-note" style="margin:0">Self-checks count for less than checked answers, because only you can judge them.</p>`}
        </div>` : `<button type="button" class="btn" data-act="reveal" data-autofocus>Show the answer</button>`;
    }
    const hintsOn = q.answerKind !== "self" && !o.res;
    return `<div class="progress-label"><span>Question ${o.i + 1} of ${n}</span><span>${Math.round((done / n) * 100)}%</span></div>
      <div class="track" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${done}">${segs}</div>
      <div class="card q-card${showRt}" id="qcard">
        ${promptHtml(q)}
        ${hintOut(q)}
        ${o.hinted && q.answerKind !== "self" ? `<p class="hint-note">Hint used — a correct answer now counts for half.</p>` : ""}
        ${hintsOn && q.hints.length ? `<div class="q-hints">${hintBtns(q)}</div>` : ""}
        ${answer}
        ${feedbackHtml(q)}
      </div>`;
  }

  function feedbackHtml(q) {
    const o = run.q;
    if (!o.res) return "";
    const last = o.i === o.list.length - 1 && !o.pendingRetry;
    const next = `<button type="button" class="btn" data-act="next" data-autofocus>${last ? "Finish this step" : "Next"}</button>`;
    const why = q.explain ? `<p class="why">${esc(q.explain)}</p>` : "";
    const r = o.res;
    if (q.answerKind === "self") return `<div class="feedback"><p class="credit-note" style="margin:0 0 10px">${r.credit >= 0.75 ? "Good — it will come back later to confirm." : r.credit > 0 ? "Almost there — it will come back sooner." : "No problem — we'll practise it again tomorrow."}</p>${next}</div>`;
    if (r.credit > 0) {
      return `<div class="fb-ok" role="status">✓ Correct${r.hinted ? " — half credit, because you used a hint" : ""}${why}</div><div style="margin-top:12px">${next}</div>`;
    }
    const yours = q.answerKind === "typed" ? esc(r.typed || "—") : q.optionsAreMarkup ? rb(q.options[r.pick]) : esc(q.options[r.pick]);
    const right = q.answerKind === "typed" ? esc(q.accepted.join(" / ")) : q.optionsAreMarkup ? rb(q.answer) : esc(q.answer);
    return `<section class="feedback" aria-live="assertive"><dl><dt>Your answer</dt><dd class="yours jp" lang="ja">${r.pick === -1 && q.answerKind !== "typed" ? "—" : yours}</dd><dt>Correct answer</dt><dd class="right jp" lang="ja">${right}</dd></dl>${why}${r.retry ? `<p class="credit-note">We'll ask about this kanji again before the end of this step.</p>` : ""}${next}</section>`;
  }

  /** Records one answer: model, XP, combo, stats, retry queue. */
  function commit(q, ev) {
    const o = run.q;
    const hinted = o.hinted;
    const full = Object.assign({ kanji: q.kanji, skill: q.skill, area: q.area, qid: q.id, type: q.type, hinted }, ev);
    const r = M.record(state, full, run.t);
    const dayRec = M.dayRec(state, run.t);
    dayRec.answered += 1; if (r.credit >= 0.75) dayRec.correct += 1;
    run.stats.answered += 1; if (r.credit >= 0.75) run.stats.solid += 1; if (hinted && r.credit > 0) run.stats.hinted += 1;
    const base = ev.kind === "typed" ? 14 : ev.kind === "self" ? 6 : 10;
    const xp = ev.kind === "self" ? (r.credit >= 0.75 ? 6 : r.credit > 0 ? 3 : 0) : r.credit >= 1 ? base : r.credit > 0 ? Math.round(base / 2) : 0;
    if (r.credit >= 1 && ev.kind !== "self") run.sess.combo += 1; else if (r.credit === 0) run.sess.combo = 0;
    const info = award(xp, { correct: r.credit > 0 && ev.kind !== "self" });
    let retry = false;
    if (r.credit === 0 && ["review", "practice"].includes(o.stepId) && !run.retried.has(q.target)) {
      const again = C.retryFor(q, run.plan, { data: D, state, rng: rand });
      if (again) { o.list.push(again); run.retried.add(q.target); retry = true; }
    }
    save();
    o.marks = o.marks || {};
    o.marks[o.i] = r.credit > 0 ? 1 : 0;
    o.res = Object.assign({ credit: r.credit, hinted, xp, retry }, ev.res || {});
    return { r, xp, info };
  }
  function fx(q, c) {
    requestAnimationFrame(() => {
      const card = document.getElementById("qcard");
      if (c.r.credit > 0) {
        G.cue("correct", run.sess.combo || 1);
        const el = card && card.querySelector(".opt.is-correct, .typed input, .rate");
        const p = el ? G.center(el) : { x: innerWidth / 2, y: innerHeight / 2 };
        if (c.xp) G.pop(`+${c.xp} XP`, p.x, p.y - 10, c.r.credit < 1 ? "lost" : "");
      } else if (c.r.credit === 0 && q.answerKind !== "self") {
        G.cue("wrong");
        if (card) card.classList.add("shake");
      }
    });
  }

  function answerChoice(i) {
    const o = run.q, q = cur();
    if (o.res || o.gone.has(i) || !(i in q.options)) return;
    const correct = q.options[i] === q.answer;
    const c = commit(q, { kind: "choice", correct, res: { pick: i } });
    render(); fx(q, c);
  }
  function checkTyped(giveUp) {
    const o = run.q, q = cur();
    if (o.res) return;
    const input = document.getElementById("n5-type"), msg = document.getElementById("n5-msg");
    const raw = input ? input.value : "";
    if (giveUp) {
      const c = commit(q, { kind: "typed", correct: false, res: { typed: raw || "", pick: -1 } });
      render(); fx(q, c); return;
    }
    const res = Kana.checkTyped(raw, q.accepted);
    if (!res.valid) {   // nothing to judge: do not count it as an attempt
      if (msg) msg.textContent = res.reason === "empty" ? "Type the reading first." : "Please type the reading in hiragana (or romaji, e.g. nihon).";
      if (input) input.focus();
      return;
    }
    const c = commit(q, { kind: "typed", correct: res.ok, res: { typed: res.normalized, pick: -1 } });
    render(); fx(q, c);
  }
  function useHint(id) {
    const o = run.q, q = cur();
    if (o.res || o.shown[id]) return;
    o.shown[id] = true; o.hinted = true;
    if (id === "eliminate") {
      const wrong = q.options.map((x, i) => i).filter((i) => q.options[i] !== q.answer && !o.gone.has(i));
      if (wrong.length) o.gone.add(wrong[Math.floor(rand() * wrong.length)]);
    }
    const typed = document.getElementById("n5-type") ? document.getElementById("n5-type").value : null;
    render();
    const input = document.getElementById("n5-type");
    if (input && typed != null) { input.value = typed; input.focus(); updatePreview(); }
  }
  function nextQuestion() {
    const o = run.q;
    if (!o.res) return;
    if (o.i >= o.list.length - 1) { finishStep(); return; }
    o.i += 1; o.hinted = false; o.shown = {}; o.gone = new Set(); o.res = null; o.flipped = false;
    render();
    window.scrollTo(0, 0);
  }
  function updatePreview() {
    const input = document.getElementById("n5-type"), pv = document.getElementById("n5-preview");
    if (!input || !pv) return;
    const v = input.value;
    pv.textContent = /[A-Za-z]/.test(v) ? "→ " + Kana.normalize(v) : "";
  }

  /* ---- finish ---- */
  function renderFinish() {
    const t = run.t, st = run.stats;
    if (!run.finished) {
      run.finished = true;
      if (run.mode !== "review") {
        const rec = M.dayRec(state, t);
        if (!rec.done) { rec.done = true; award(30); }
      }
      save();
      G.cue("done", 3);
      G.burst(innerWidth / 2, innerHeight / 3, 70, 12);
    }
    const after = M.stateCounts(state, D.curriculum, t), before = run.startCounts;
    const gained = (k) => Math.max(0, after[k] - before[k]);
    const tomorrow = C.compose({ data: D, state, today: t + 1 });
    const acc = st.answered ? Math.round((st.solid / st.answered) * 100) : 0;
    const chips = [
      gained("mastered") ? `<span class="n5-badge ok">+${gained("mastered")} mastered</span>` : "",
      gained("review") ? `<span class="n5-badge ok">+${gained("review")} reviewing</span>` : "",
      run.plan.newKanji.length ? `<span class="n5-badge">${plural(run.plan.newKanji.length, "new kanji", "new kanji")} met</span>` : "",
    ].join("");
    return `<section class="card n5-sum">
      <p class="n5-eyebrow n5-muted">${run.mode === "review" ? "Review complete" : "Lesson complete"}</p>
      <div class="big">${st.solid} / ${st.answered}</div>
      <div class="n5-muted">answers correct without help · ${acc}%</div>
      <div class="reward"><div><b>+${st.xp}</b><span>XP earned</span></div><div><b>${st.hinted}</b><span>with a hint</span></div><div><b>Lv ${G.level()}</b><span>Your level</span></div></div>
      <div class="n5-trans">${chips}</div>
      ${st.hinted ? `<p class="n5-small n5-muted">${plural(st.hinted, "answer")} used a hint, so ${st.hinted === 1 ? "it counts" : "they count"} for half and ${st.hinted === 1 ? "does" : "do"} not move you toward mastery.</p>` : ""}
      <p class="n5-small" style="margin:12px 0 0"><b>Tomorrow:</b> ${tomorrow.hasNew ? `${plural(tomorrow.newKanji.length, "new kanji", "new kanji")} (${esc(unitOfKanji(tomorrow.newKanji[0]).title)})` : "no new kanji in this release"}${tomorrow.review.kanji.length ? ` and ${plural(tomorrow.review.kanji.length, "review")}` : ""}.</p>
      <div style="margin-top:16px"><button type="button" class="btn" data-act="home" data-autofocus>Back to N5 home</button></div>
    </section>`;
  }

  /* =====================================================================================================
     ABOUT
     ===================================================================================================== */
  function renderAbout() {
    const v = D.verification, meta = D.meta;
    const sum = v && v.summary ? v.summary : null;
    root.innerHTML = `<p class="n5-crumb"><button type="button" class="n5-link" data-act="home">← N5 home</button></p>
      <section class="card n5-block">
        <h1 style="font-size:1.4rem;margin-bottom:6px">Sources, review status and scope</h1>
        <p class="n5-muted">Readings, meanings and vocabulary are checked against dictionaries. The sentences, passages and questions are original text and still need a proficient Japanese speaker to review them.</p>
        <h2 class="n5-h2" style="margin-top:16px">Sources</h2>
        <ul class="n5-src">${meta.sources.map((s) => `<li><b>${esc(s.name)}</b><span class="n5-muted n5-small">${esc(s.publisher)} · ${esc(s.licence)}</span><br>${esc(s.use)}${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">link</a>` : ""}</li>`).join("")}</ul>
        <h2 class="n5-h2" style="margin-top:16px">Automatic checks ${v ? (v.current ? '<span class="n5-badge ok">current</span>' : '<span class="n5-badge">out of date</span>') : ""}</h2>
        ${sum ? `<table class="n5-table"><tbody>
          <tr><td>Kanji (readings, meanings) matched to KANJIDIC2</td><td>${esc(sum.kanji)}</td></tr>
          <tr><td>Vocabulary spellings and readings matched to JMdict</td><td>${esc(sum.vocabulary)}</td></tr>
          <tr><td>Readings used in sentences, passages and questions</td><td>${esc(sum.readingRuns)}</td></tr>
          <tr><td>Look-alike spellings that are not a second correct answer</td><td>${esc(sum.lookalikes)}</td></tr></tbody></table>
          <p class="n5-small n5-muted">KANJIDIC2 ${esc(v.sources.kanjidic2.databaseVersion)} · JMdict via Jisho, checked ${esc(v.sources.jmdict.queriedOn)}.</p>` : `<p class="n5-muted">No verification report is bundled.</p>`}
        <h2 class="n5-h2" style="margin-top:16px">Review status</h2>
        <ul class="n5-src">${["kanji", "vocabulary", "sentences", "passages", "questions"].map((k) => `<li><b style="text-transform:capitalize">${k}</b>${esc(meta.review[k])}</li>`).join("")}</ul>
        <h2 class="n5-h2" style="margin-top:16px">About “N5”</h2>
        <p class="n5-small n5-muted">${esc(meta.jlptNote)}</p>
        <h2 class="n5-h2" style="margin-top:16px">What this release does not do</h2>
        <ul class="n5-small n5-muted"><li>No listening exercises or timed mock exams yet, so no claim of overall JLPT N5 readiness is made.</li>
        <li>No grammar lessons and no unfamiliar-passage tests yet. The readiness figures that need them are marked “not in this release yet”.</li>
        <li>Three days of kanji (18 characters). More are planned.</li></ul>
      </section>`;
  }

  /* =====================================================================================================
     EVENTS
     ===================================================================================================== */
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === "begin") { if (startRun(b.dataset.mode)) go("#/n5/session"); else render(); return; }
    if (a === "home") { if (run && run.finished) run = null; go("#/n5"); return; }
    if (a === "about") { go("#/n5/about"); return; }
    if (a === "quit") { go("#/n5"); return; }
    if (a === "sel-k") { selected = selected === b.dataset.k ? null : b.dataset.k; render(); return; }
    if (a === "step") {
      const key = b.dataset.key, lim = key === "newPerDay" ? [3, 10] : [5, 30];
      state.settings[key] = Math.min(lim[1], Math.max(lim[0], state.settings[key] + Number(b.dataset.d)));
      save(); render();
      const again = root.querySelector(`[data-act="step"][data-key="${key}"][data-d="${b.dataset.d}"]`); if (again) again.focus();
      return;
    }
    if (a === "toggle-rt") { state.settings.showReadings = !state.settings.showReadings; save(); render(); return; }
    if (a === "reset") {
      if (window.confirm("Erase all N5 progress in this browser? Your vocabulary progress is not affected.")) { state = M.createState(); save(); run = null; selected = null; render(); }
      return;
    }
    if (!run) return;
    if (a === "tile") { run.sel = b.dataset.k; run.viewed.add(run.sel); render(); const t = root.querySelector(`.ktile[data-k="${b.dataset.k}"]`); if (t) t.scrollIntoView({ inline: "center", block: "nearest" }); return; }
    if (a === "tile-rt") {
      const k = run.sel, on = run.tileRt[k] === "on" || (run.tileRt[k] !== "off" && state.settings.showReadings);
      run.tileRt[k] = on ? "off" : "on"; render(); return;
    }
    if (a === "learn-next") { learnDone(); return; }
    if (a === "sent-rt") { const id = b.dataset.sid, on = run.sRt[id] === "on" || (run.sRt[id] !== "off" && state.settings.showReadings); run.sRt[id] = on ? "off" : "on"; render(); return; }
    if (a === "sent-en") { run.sEn[b.dataset.sid] = !run.sEn[b.dataset.sid]; render(); return; }
    if (a === "sent-next") { finishStep(); return; }
    if (a === "p-rt") { const on = run.pRt === "on" || (run.pRt !== "off" && state.settings.showReadings); run.pRt = on ? "off" : "on"; render(); return; }
    if (a === "p-en") { run.pEn = !run.pEn; render(); return; }
    if (a === "p-next") { award(10); finishStep(); return; }
    if (a === "opt") { answerChoice(Number(b.dataset.i)); return; }
    if (a === "hint") { useHint(b.dataset.h); return; }
    if (a === "check") { checkTyped(false); return; }
    if (a === "giveup") { checkTyped(true); return; }
    if (a === "reveal") { run.q.flipped = true; render(); return; }
    if (a === "rate") {
      const q = cur(), rating = b.dataset.r;
      const c = commit(q, { kind: "self", rating, correct: rating !== "again", res: { pick: -1 } });
      render(); fx(q, c); return;
    }
    if (a === "next") { nextQuestion(); return; }
  });
  root.addEventListener("input", (e) => { if (e.target.id === "n5-type") { updatePreview(); const m = document.getElementById("n5-msg"); if (m) m.textContent = ""; } });
  root.addEventListener("keydown", (e) => {
    if (e.target.id === "n5-type" && e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); checkTyped(false); }
  });
  // 1–4 / A–D answer, H = hint is deliberately NOT bound (a hint should be a conscious choice), Enter = next.
  document.addEventListener("keydown", (e) => {
    if (root.hidden || view !== "session" || !run || !run.q || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ""))) return;
    const q = cur();
    if (!q) return;
    if (run.q.res) { if (e.key === "Enter" && e.target.tagName !== "BUTTON") { e.preventDefault(); nextQuestion(); } return; }
    if (q.answerKind !== "choice") return;
    const k = e.key.toUpperCase();
    const i = "1234".includes(k) && k.length === 1 ? Number(k) - 1 : LETTERS.indexOf(k);
    if (i >= 0 && i < 4) { e.preventDefault(); answerChoice(i); }
  });

  window.N5UI = { handles, show, hide, _debug: () => ({ state, run, view }) };
  if (/[?&]debug\b/.test(location.search)) window.__n5Debug = { get state() { return state; }, get run() { return run; }, N5, D };
})();
