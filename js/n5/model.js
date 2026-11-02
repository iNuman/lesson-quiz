/* N5 track — learner model (pure; persistence goes through an injected storage). Window.N5.Model.
   One record per kanji. The key design rule: RECOGNITION IS NOT MASTERY.
     - a correct answer with a hint earns half credit and never advances the review schedule;
     - a self-assessed "knew it" earns 3/4 credit and can never, on its own, make a kanji "mastered";
     - "mastered" needs strong meaning AND reading AND context AND recall, at least one VERIFIED unhinted typed recall,
       and successful unaided answers on two or more different days.                                                    */
(function (root) {
  "use strict";
  const N5 = (root.N5 = root.N5 || {});
  const S = () => N5.Scheduler;

  const KEY = "jpquiz.n5.v1";
  const SKILLS = ["meaning", "reading", "vocab", "context", "recall"];
  const LOG_CAP = 600;
  // What a skill must reach before it counts toward "mastered". Two clean (unhinted) successes in a row give ~0.70.
  const MASTERY = { meaning: 0.65, reading: 0.65, context: 0.6, recall: 0.6 };
  const clamp = (n, lo, hi, d) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d);

  /** Credit for one answer. `kind`: "choice" | "typed" (checked by the app) | "self" (the learner's own rating). */
  function creditFor(ev) {
    if (ev.kind === "self") return ev.rating === "good" ? 0.75 : ev.rating === "hard" ? 0.4 : 0;
    if (!ev.correct) return 0;
    return ev.hinted ? 0.5 : 1;
  }

  const blankSkills = () => ({ meaning: 0, reading: 0, vocab: 0, context: 0, recall: 0 });
  const blankRec = (today) => ({
    firstSeen: today, attempts: 0, correct: 0, wrong: 0, hinted: 0,
    skills: blankSkills(), verifiedRecall: 0, box: 0, interval: 1, next: today + 1, boxDay: null,
    lastReview: null, lastOutcome: null, lapses: 0, reviewDays: [],
  });

  function createState() {
    return {
      v: 1,
      settings: { newPerDay: 6, reviewCap: 10, showReadings: true },
      introduced: [], kanji: {}, units: {}, days: {}, log: [], seen: {},
    };
  }

  /** Repairs/upgrades whatever was stored, so a corrupt or old save can never crash the app. */
  function sanitize(raw) {
    const s = createState();
    if (!raw || typeof raw !== "object") return s;
    const st = raw.settings || {};
    s.settings.newPerDay = clamp(st.newPerDay, 3, 10, 6);
    s.settings.reviewCap = clamp(st.reviewCap, 5, 30, 10);
    s.settings.showReadings = st.showReadings !== false;
    if (Array.isArray(raw.introduced)) s.introduced = [...new Set(raw.introduced.filter((k) => typeof k === "string"))];
    for (const k of s.introduced) {
      const r = (raw.kanji || {})[k] || {};
      const b = blankRec(Number.isFinite(r.firstSeen) ? r.firstSeen : 0);
      const rec = Object.assign(b, r);
      rec.skills = Object.assign(blankSkills(), r.skills);
      for (const sk of SKILLS) rec.skills[sk] = Math.min(1, Math.max(0, Number(rec.skills[sk]) || 0));
      rec.reviewDays = Array.isArray(r.reviewDays) ? r.reviewDays.filter(Number.isFinite).slice(-60) : [];
      rec.box = clamp(rec.box, 0, S().MAX_BOX, 0);
      s.kanji[k] = rec;
    }
    if (raw.units && typeof raw.units === "object") s.units = raw.units;
    if (raw.days && typeof raw.days === "object") s.days = raw.days;
    if (Array.isArray(raw.log)) s.log = raw.log.slice(-LOG_CAP);
    if (raw.seen && typeof raw.seen === "object") s.seen = raw.seen;
    return s;
  }

  /* ---------- persistence ---------- */
  function load(storage) {
    try { return sanitize(JSON.parse(storage.getItem(KEY) || "null")); } catch (e) { return createState(); }
  }
  function save(storage, state) {
    try { storage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }
  const exportJson = (state) => JSON.stringify(state);
  const importJson = (text) => sanitize(JSON.parse(text));

  /* ---------- progress ---------- */
  const introducedSet = (state) => new Set(state.introduced);

  function introduce(state, kanji, today) {
    for (const k of kanji) {
      if (state.kanji[k]) continue;
      state.introduced.push(k);
      state.kanji[k] = blankRec(today);
    }
    return state;
  }

  /**
   * Records one answer for every kanji it tests.
   * ev = { kanji:[…], skill, area, kind, correct, hinted, rating?, qid, type }
   * Returns { credit, outcome, fresh }.
   */
  function record(state, ev, today) {
    const credit = creditFor(ev);
    const outcome = credit >= 0.75 ? "pass" : credit > 0 ? "partial" : "fail";
    const fresh = !state.seen[ev.qid];
    state.seen[ev.qid] = (state.seen[ev.qid] || 0) + 1;
    for (const k of ev.kanji) {
      const r = state.kanji[k];
      if (!r) continue;
      r.attempts += 1;
      if (credit >= 0.75) r.correct += 1; else if (credit === 0) r.wrong += 1;
      if (ev.hinted && credit > 0) r.hinted += 1;
      // Skills move toward the credit earned. A weak/hinted answer can never push a skill above what it earned,
      // and a correct answer never lowers a skill; a wrong one halves it.
      const cur = r.skills[ev.skill] || 0;
      if (credit === 0) r.skills[ev.skill] = cur * 0.5;
      else if (credit > cur) r.skills[ev.skill] = cur + 0.45 * (credit - cur);
      if (ev.skill === "recall" && ev.kind === "typed" && credit === 1) r.verifiedRecall += 1;
      const patch = S().schedule(r, outcome, today);
      Object.assign(r, patch);
      r.lastReview = today;
      r.lastOutcome = outcome;
      if (outcome === "pass" && !r.reviewDays.includes(today)) r.reviewDays.push(today);
    }
    state.log.push({ d: today, k: ev.kanji, q: ev.qid, t: ev.type, a: ev.area, c: credit, h: !!ev.hinted, f: fresh });
    if (state.log.length > LOG_CAP) state.log.splice(0, state.log.length - LOG_CAP);
    return { credit, outcome, fresh };
  }

  /** The required skill that is furthest below its mastery bar (null if all are met) — what to practise next. */
  function weakestNeeded(r) {
    let best = null, gap = 0;
    for (const x of Object.keys(MASTERY)) {
      const g = MASTERY[x] - r.skills[x];
      if (g > gap) { gap = g; best = x; }
    }
    if (!best && r.verifiedRecall < 1) return "recall";
    return best;
  }

  const skillMean = (r) => SKILLS.reduce((a, s) => a + r.skills[s], 0) / SKILLS.length;

  /**
   * new → seen → learning → review → mastered, plus "fading" for something that was solid but is long overdue.
   * Derived from the record every time (nothing to keep in sync), so a later failure demotes automatically.
   */
  function stateOf(state, k, today) {
    const r = state.kanji[k];
    if (!r) return "new";
    if (r.attempts === 0) return "seen";
    const sk = r.skills;
    const solid = Object.keys(MASTERY).every((x) => sk[x] >= MASTERY[x]) &&
      r.verifiedRecall >= 1 && r.reviewDays.length >= 2 && r.box >= 3 && r.lastOutcome !== "fail";
    if (solid) return S().overdueDays(r, today) > Math.max(7, r.interval) ? "fading" : "mastered";
    if (sk.meaning >= 0.6 && sk.reading >= 0.6 && r.box >= 2) return "review";
    return "learning";
  }

  /** Higher = needs attention sooner. Used to pick which due kanji make today's capped review. */
  function priority(state, k, today) {
    const r = state.kanji[k];
    return S().overdueDays(r, today) + (1 - skillMean(r)) * 3 + r.lapses * 0.5 + (stateOf(state, k, today) === "fading" ? 2 : 0);
  }
  const dueKanji = (state, today) => state.introduced.filter((k) => state.kanji[k].attempts > 0 && S().isDue(state.kanji[k], today))
    .sort((a, b) => priority(state, b, today) - priority(state, a, today));

  function stateCounts(state, curriculum, today) {
    const c = { new: 0, seen: 0, learning: 0, review: 0, fading: 0, mastered: 0 };
    for (const k of curriculum) c[stateOf(state, k, today)] += 1;
    return c;
  }

  /* ---------- per-day bookkeeping ---------- */
  function dayRec(state, today) {
    if (!state.days[today]) state.days[today] = { newKanji: [], stepsDone: [], answered: 0, correct: 0, xp: 0, done: false };
    return state.days[today];
  }

  N5.Model = {
    KEY, SKILLS, MASTERY, weakestNeeded, creditFor, createState, sanitize, load, save, exportJson, importJson, introducedSet, introduce, record,
    stateOf, priority, dueKanji, stateCounts, skillMean, dayRec,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = N5.Model;
})(typeof window !== "undefined" ? window : globalThis);
