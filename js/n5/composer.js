/* N5 track — daily session composer (pure). Window.N5.Composer.
   compose() decides WHAT today contains; buildStep() generates the questions for a step at the moment the learner
   reaches it (so it always reflects the latest answers). Neither touches the DOM or the clock. */
(function (root) {
  "use strict";
  const N5 = (root.N5 = root.N5 || {});
  const Q = () => N5.Questions, M = () => N5.Model;

  const STEP_TITLES = {
    review: "Warm-up review", learn: "New kanji", sentences: "Sentences", passage: "Reading", comprehension: "Check understanding",
    practice: "Practice", recall: "Recall", finish: "Summary",
  };

  /** The next unintroduced kanji in curriculum order — or today's set again if it was already chosen. */
  function newKanjiFor(data, state, today) {
    const rec = state.days[today];
    if (rec && rec.newKanji && rec.newKanji.length) return rec.newKanji.slice();
    const have = new Set(state.introduced);
    return data.curriculum.filter((k) => !have.has(k)).slice(0, state.settings.newPerDay);
  }

  /** Units whose kanji are all introduced but whose passage the learner has not read yet. */
  function unreadUnits(data, state, extraIntroduced) {
    const have = new Set([...state.introduced, ...(extraIntroduced || [])]);
    return data.units.filter((u) => u.kanji.every((k) => have.has(k)) && !(state.units[u.id] && state.units[u.id].passageRead)).map((u) => u.id);
  }

  /**
   * Reviews for today, kept manageable: due kanji ordered by need, capped at settings.reviewCap. If very little is
   * due, the weakest not-yet-solid kanji top it up (to a small floor) so early sessions still consolidate.
   */
  function reviewFor(data, state, today, exclude) {
    const skip = new Set(exclude || []);
    const due = M().dueKanji(state, today).filter((k) => !skip.has(k));
    const cap = state.settings.reviewCap;
    const picked = due.slice(0, cap);
    const overflow = Math.max(0, due.length - picked.length);
    // Light days are topped up with the weakest not-yet-mastered kanji, so a kanji that has not shown every skill is
    // never left alone for weeks just because its interval grew. Never more than the cap, never more than half of it.
    const FLOOR = Math.min(cap, Math.max(3, Math.ceil(cap / 2)));
    const extra = [];
    if (picked.length < FLOOR) {
      const weak = state.introduced
        .filter((k) => !skip.has(k) && !picked.includes(k) && state.kanji[k].attempts > 0 && M().stateOf(state, k, today) !== "mastered")
        .sort((a, b) => M().skillMean(state.kanji[a]) - M().skillMean(state.kanji[b]));
      for (const k of weak.slice(0, FLOOR - picked.length)) { picked.push(k); extra.push(k); }
    }
    return { kanji: picked, overflow, due: due.length, extra };
  }

  function compose(o) {
    const { data, state, today } = o;
    const rec = state.days[today];
    const newKanji = newKanjiFor(data, state, today);
    const introducedToday = !!(rec && rec.newKanji && rec.newKanji.length);
    const review = reviewFor(data, state, today, newKanji);
    const pendingUnits = unreadUnits(data, state, newKanji);   // the passage unlocks the moment its kanji are met
    const hasNew = newKanji.length > 0;
    const steps = [];
    if (review.kanji.length) steps.push({ id: "review", kind: "questions", title: STEP_TITLES.review, count: review.kanji.length });
    if (hasNew) {
      steps.push({ id: "learn", kind: "learn", title: STEP_TITLES.learn, kanji: newKanji });
      steps.push({ id: "sentences", kind: "sentences", title: STEP_TITLES.sentences });
    }
    if (hasNew && pendingUnits.length) {
      steps.push({ id: "passage", kind: "passage", title: STEP_TITLES.passage, units: pendingUnits });
      steps.push({ id: "comprehension", kind: "questions", title: STEP_TITLES.comprehension, units: pendingUnits });
    }
    if (hasNew) {
      steps.push({ id: "practice", kind: "questions", title: STEP_TITLES.practice, count: newKanji.length * 2 });
      steps.push({ id: "recall", kind: "questions", title: STEP_TITLES.recall, count: newKanji.length + Math.ceil(newKanji.length / 2) });
    }
    steps.push({ id: "finish", kind: "finish", title: STEP_TITLES.finish });
    const questionCount = steps.reduce((a, s) => a + (s.count || 0), 0) + (hasNew && pendingUnits.length ? 4 : 0);
    return {
      today, newKanji, introducedToday, review, steps, hasNew,
      finished: !hasNew && !review.kanji.length,
      estimateMinutes: Math.max(2, Math.round(questionCount * 0.45 + (hasNew ? 6 : 0))),
    };
  }

  const ctxFor = (data, state, rng, extraIntro) => ({
    data, rng, introduced: new Set([...state.introduced, ...(extraIntro || [])]), seen: state.seen,
  });

  /** Orders a list so the same kanji does not appear twice in a row when avoidable. */
  function spread(items, rng) {
    const pool = Q().shuffle(items, rng), out = [];
    const tgt = (q) => q.target || q.kanji[0];
    while (pool.length) {
      const last = out.length ? tgt(out[out.length - 1]) : null;
      const left = {};
      for (const q of pool) left[tgt(q)] = (left[tgt(q)] || 0) + 1;
      // take from the kanji with the most questions left so no run of one kanji is forced at the end
      let best = -1;
      pool.forEach((q, i) => { if (tgt(q) !== last && (best < 0 || left[tgt(q)] > left[tgt(pool[best])])) best = i; });
      out.push(pool.splice(best < 0 ? 0 : best, 1)[0]);
    }
    return out;
  }

  /**
   * Generates the questions of one question step.
   * review: one adaptive question per due kanji   comprehension: the authored passage questions
   * practice: two differently-typed questions per new kanji   recall: a flip card per new kanji + typed readings
   */
  function buildStep(step, plan, o) {
    const { data, state, rng } = o;
    const out = [];
    const used = new Set(), types = new Set();
    const ctx = ctxFor(data, state, rng, plan.newKanji);
    const push = (q) => { if (q) { used.add(q.id); out.push(q); } return q; };

    if (step.id === "comprehension") {
      for (const uid of step.units) {
        const p = data.passages[uid];
        Q().shuffle(p.questions, rng).forEach((q) => push(Q().passageQuestion(p, q, ctx)));
      }
      return out;
    }
    if (step.id === "review") {
      const recent = new Set();
      for (const k of plan.review.kanji) {
        const r = state.kanji[k];
        // Aim at the required skill that is furthest below its mastery bar. Typed recall is offered once the basics are there.
        const need = M().weakestNeeded(r);
        const basics = r.skills.meaning >= 0.4 && r.skills.reading >= 0.4;
        const general = ["kanji-meaning", "vocab-meaning", "reading-in-context", "orthography", "cloze", "passage"].concat(basics ? ["recall-type"] : []);
        const aimed = need ? general.filter((t) => Q().TYPES[t].skill === need) : [];
        let q = aimed.length && ctx.rng() < 0.75 ? Q().choose(k, ctx, { allow: aimed, skills: r.skills, avoid: recent, exclude: used }) : null;
        if (!q) q = Q().choose(k, ctx, { allow: general, skills: r.skills, avoid: recent, exclude: used });
        if (push(q)) { recent.add(q.type); if (recent.size > 3) recent.delete(recent.values().next().value); }
      }
      return spread(out, rng);
    }
    if (step.id === "practice") {
      // Round one: recognise the kanji. Round two: a context question of a type that has not just been used.
      for (const k of plan.newKanji) push(Q().build("kanji-meaning", k, ctx, used));
      const recent = new Set(["kanji-meaning"]);
      for (const k of plan.newKanji) {
        const q = Q().choose(k, ctx, { allow: ["reading-in-context", "vocab-meaning", "orthography", "cloze", "passage"], skills: state.kanji[k] ? state.kanji[k].skills : {}, avoid: recent, exclude: used });
        if (push(q)) { recent.add(q.type); if (recent.size > 3) recent.delete(recent.values().next().value); }
      }
      return spread(out, rng);
    }
    if (step.id === "recall") {
      const weakFirst = plan.newKanji.slice().sort((a, b) => (state.kanji[a] ? M().skillMean(state.kanji[a]) : 0) - (state.kanji[b] ? M().skillMean(state.kanji[b]) : 0));
      weakFirst.slice(0, Math.ceil(plan.newKanji.length / 2)).forEach((k) => push(Q().build("recall-type", k, ctx, used)));
      plan.newKanji.forEach((k) => push(Q().build("recall-flip", k, ctx, used)));
      // typed first (retrieval without any options), then the self-checks
      return out.sort((a, b) => (a.type === "recall-type" ? 0 : 1) - (b.type === "recall-type" ? 0 : 1));
    }
    return out;
  }

  /** A follow-up for something just answered wrong: another question on the same kanji, never the identical item. */
  function retryFor(q, plan, o) {
    const { data, state, rng } = o;
    const ctx = ctxFor(data, state, rng, plan.newKanji);
    const k = q.target || q.kanji[0];
    const r = state.kanji[k];
    return Q().choose(k, ctx, { allow: ["kanji-meaning", "vocab-meaning", "reading-in-context", "orthography", "cloze"], skills: r ? r.skills : {}, avoid: new Set([q.type]), exclude: new Set([q.id]) });
  }

  /** Sentences to read in the "Sentences" step: 1–2 per new kanji, all usable with the kanji met so far. */
  function sentencesFor(plan, o) {
    const { data, rng } = o;
    const have = new Set([...o.state.introduced, ...plan.newKanji]);
    const usable = Object.values(data.sentences).filter((s) => s.requires.every((k) => have.has(k)));
    const chosen = new Map();
    for (const k of plan.newKanji) {
      const mine = Q().shuffle(usable.filter((s) => s.requires.includes(k) && !chosen.has(s.id)), rng);
      // prefer sentences that use the new kanji and few others (clearer for a first meeting)
      mine.sort((a, b) => a.requires.length - b.requires.length);
      mine.slice(0, 2).forEach((s) => chosen.set(s.id, s));
    }
    return [...chosen.values()];
  }

  N5.Composer = { STEP_TITLES, newKanjiFor, unreadUnits, reviewFor, compose, buildStep, retryFor, sentencesFor, spread, ctxFor };
  if (typeof module !== "undefined" && module.exports) module.exports = N5.Composer;
})(typeof window !== "undefined" ? window : globalThis);
