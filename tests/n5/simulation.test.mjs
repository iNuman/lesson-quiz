import test from "node:test";
import assert from "node:assert";
import { loadN5 } from "./load.mjs";

const { N5, data } = loadN5();
const C = N5.Composer, M = N5.Model, Q = N5.Questions;
const T0 = 20000;

/**
 * A headless learner that follows the same rules as the UI: it walks the steps of the day's plan, answers every
 * question (right with probability `acc`, never using hints unless told to) and records the result.
 */
function playDay(state, day, o) {
  const rng = Q.makeRng(o.seed * 1000 + day);
  const learner = Q.makeRng(o.seed * 77 + day);
  const plan = C.compose({ data, state, today: day });
  const stat = { day, plan, answered: 0, reviewQs: 0, byStep: {}, wrong: 0 };
  const answerQ = (q) => {
    const right = learner() < o.acc;
    const hinted = !!o.hinted && right;
    const ev = { kanji: q.kanji, skill: q.skill, area: q.area, kind: q.kind === "self" ? "self" : q.kind, correct: right, hinted, rating: right ? "good" : "again", qid: q.id, type: q.type };
    M.record(state, ev, day);
    stat.answered++;
    if (!right) stat.wrong++;
    return right;
  };
  for (const step of plan.steps) {
    if (step.kind === "learn") {
      M.introduce(state, plan.newKanji, day);
      M.dayRec(state, day).newKanji = plan.newKanji.slice();
    } else if (step.kind === "passage") {
      for (const u of step.units) state.units[u] = { passageRead: true };
    } else if (step.kind === "questions") {
      const qs = C.buildStep(step, plan, { data, state, rng });
      assert.ok(qs.length > 0, `day ${day}: step ${step.id} produced no questions`);
      stat.byStep[step.id] = qs.length;
      if (step.id === "review") stat.reviewQs = qs.length;
      for (const q of qs) {
        const ok = answerQ(q);
        if (!ok && ["practice", "review"].includes(step.id)) {
          const retry = C.retryFor(q, plan, { data, state, rng });
          if (retry) answerQ(retry);
        }
      }
    }
  }
  M.dayRec(state, day).done = true;
  return stat;
}

test("three days of study: 6 new kanji a day, capped reviews, nothing breaks", () => {
  const state = M.createState();
  const days = [1, 2, 3].map((d) => playDay(state, T0 + d - 1, { seed: 1, acc: 0.9 }));
  assert.equal(state.introduced.length, 18);
  assert.equal(days[0].plan.review.kanji.length, 0, "no reviews on day 1");
  assert.equal(days[1].plan.review.kanji.length, 6, "day 2 reviews all of day 1");
  assert.ok(days[2].plan.review.kanji.length <= state.settings.reviewCap);
  for (const d of days) assert.ok(d.answered <= 60, `day ${d.day - T0 + 1}: ${d.answered} questions is too many for one sitting`);
  assert.deepEqual(Object.keys(state.units).sort(), ["1", "2", "3"], "all three passages were read");
  const counts = M.stateCounts(state, data.curriculum, T0 + 2);
  assert.equal(counts.mastered, 0, "three days is not enough for mastery");
});

test("a consistent learner reaches mastery — but only after weeks, via spaced reviews", () => {
  const state = M.createState();
  let firstMastered = null, maxReview = 0;
  for (let i = 0; i < 45; i++) {
    const st = playDay(state, T0 + i, { seed: 3, acc: 0.95 });
    maxReview = Math.max(maxReview, st.reviewQs);
    const n = M.stateCounts(state, data.curriculum, T0 + i).mastered;
    if (n > 0 && firstMastered == null) firstMastered = i;
  }
  const counts = M.stateCounts(state, data.curriculum, T0 + 44);
  assert.ok(firstMastered >= 5, `first mastered kanji on day ${firstMastered + 1}: mastery must take repeated, spaced practice`);
  assert.ok(counts.mastered >= 12, `after 45 days only ${counts.mastered}/18 are mastered: ${JSON.stringify(counts)}`);
  assert.ok(maxReview <= state.settings.reviewCap, `review load ${maxReview} exceeded the cap`);
});

test("a learner who leans on hints never gets credit for mastery", () => {
  const state = M.createState();
  for (let i = 0; i < 70; i++) playDay(state, T0 + i, { seed: 4, acc: 0.97, hinted: true });
  const counts = M.stateCounts(state, data.curriculum, T0 + 69);
  assert.equal(counts.mastered, 0, JSON.stringify(counts));
  assert.equal(counts.review, 0, "and nothing even reaches 'review' on hinted answers alone");
});

test("a struggling learner sees weak kanji far more often than strong ones", () => {
  const state = M.createState();
  for (let i = 0; i < 3; i++) playDay(state, T0 + i, { seed: 5, acc: 0.95 });
  // make 人 and 日 the learner's weak spots
  for (const k of ["人", "日"]) for (let r = 0; r < 6; r++) M.record(state, { kanji: [k], skill: "meaning", area: "vocabulary", kind: "choice", correct: false, hinted: false, qid: `weak${k}${r}`, type: "kanji-meaning" }, T0 + 3);
  const plan = C.compose({ data, state, today: T0 + 4 });
  assert.ok(plan.review.kanji.slice(0, 3).includes("人") && plan.review.kanji.slice(0, 3).includes("日"), `weak kanji should lead the review: ${plan.review.kanji}`);
});

test("a forgotten kanji returns naturally: a lapse puts it back in the next review", () => {
  const state = M.createState();
  for (let i = 0; i < 12; i++) playDay(state, T0 + i, { seed: 6, acc: 1 });
  const day = T0 + 12;
  const before = state.kanji["火"].box;
  M.record(state, { kanji: ["火"], skill: "reading", area: "kanjiReading", kind: "choice", correct: false, hinted: false, qid: "lapse", type: "x" }, day);
  assert.ok(state.kanji["火"].box < before || before === 0);
  const plan = C.compose({ data, state, today: day + 1 });
  assert.ok(plan.review.kanji.includes("火"), "the forgotten kanji is reviewed the very next day");
});

test("skipping days does not pile up an unmanageable review", () => {
  const state = M.createState();
  for (let i = 0; i < 3; i++) playDay(state, T0 + i, { seed: 7, acc: 0.9 });
  const plan = C.compose({ data, state, today: T0 + 40 });
  assert.ok(plan.review.kanji.length <= state.settings.reviewCap);
  assert.ok(plan.review.overflow >= 0);
  assert.ok(plan.estimateMinutes <= 25, `a returning learner's session is ${plan.estimateMinutes} min`);
  const st = playDay(state, T0 + 40, { seed: 7, acc: 0.9 });
  assert.ok(st.answered <= 25, `${st.answered} questions after a long break`);
});

test("changing the daily amount mid-course keeps the curriculum order", () => {
  const state = M.createState();
  playDay(state, T0, { seed: 8, acc: 0.9 });
  state.settings.newPerDay = 3;
  const plan = C.compose({ data, state, today: T0 + 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(plan.newKanji)), data.units[1].kanji.slice(0, 3));
  playDay(state, T0 + 1, { seed: 8, acc: 0.9 });
  state.settings.newPerDay = 10;
  const next = C.compose({ data, state, today: T0 + 2 });
  assert.equal(next.newKanji.length, 9, "only 9 kanji remain in this release's curriculum");
});
