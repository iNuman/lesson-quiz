import test from "node:test";
import assert from "node:assert";
import { loadN5, plain } from "./load.mjs";

const { N5, data } = loadN5();
const C = N5.Composer, M = N5.Model, Q = N5.Questions, R = N5.Readiness;
const T0 = 20000;
const ids = (steps) => steps.map((s) => s.id);
const rng = (n) => Q.makeRng(n);

/** What the UI does when the learner finishes the "New kanji" step. */
function learn(state, plan, today) {
  M.introduce(state, plan.newKanji, today);
  M.dayRec(state, today).newKanji = plan.newKanji.slice();
}
const answer = (state, q, today, o) => M.record(state, Object.assign({ kanji: q.kanji, skill: q.skill, area: q.area, kind: q.kind === "self" ? "self" : q.kind, correct: true, hinted: false, rating: "good", qid: q.id, type: q.type }, o), today);

test("the first day: six new kanji, no review, and the full learning journey in order", () => {
  const state = M.createState();
  const plan = C.compose({ data, state, today: T0 });
  assert.deepEqual(plain(plan.newKanji), data.units[0].kanji);
  assert.deepEqual(ids(plan.steps), ["learn", "sentences", "passage", "comprehension", "practice", "recall", "finish"]);
  assert.equal(plan.review.kanji.length, 0);
  assert.equal(plan.finished, false);
  assert.ok(plan.estimateMinutes >= 5 && plan.estimateMinutes <= 30);
});

test("the daily amount is configurable and the passage unlocks only when all its kanji are known", () => {
  const state = M.createState();
  state.settings.newPerDay = 4;
  let plan = C.compose({ data, state, today: T0 });
  assert.equal(plan.newKanji.length, 4);
  assert.ok(!ids(plan.steps).includes("passage"), "unit 1 needs 6 kanji, only 4 are being met");
  learn(state, plan, T0);
  plan = C.compose({ data, state, today: T0 + 1 });
  assert.deepEqual(plain(plan.newKanji), ["二", "三", "月", "火"], "continues in curriculum order across units");
  assert.deepEqual(C.unreadUnits(data, state, plan.newKanji), [1], "unit 1 is complete once 一二三 are met");
  assert.ok(ids(plan.steps).includes("passage"));
});

test("today's set is stable when the learner returns mid-lesson", () => {
  const state = M.createState();
  const plan = C.compose({ data, state, today: T0 });
  learn(state, plan, T0);
  const again = C.compose({ data, state, today: T0 });
  assert.deepEqual(plain(again.newKanji), plain(plan.newKanji));
  assert.equal(again.hasNew, true);
});

test("the next day continues with the next unit and brings reviews", () => {
  const state = M.createState();
  const p1 = C.compose({ data, state, today: T0 });
  learn(state, p1, T0);
  for (const k of p1.newKanji) M.record(state, { kanji: [k], skill: "meaning", area: "vocabulary", kind: "choice", correct: true, hinted: false, qid: "k" + k, type: "kanji-meaning" }, T0);
  const p2 = C.compose({ data, state, today: T0 + 1 });
  assert.deepEqual(plain(p2.newKanji), data.units[1].kanji);
  assert.equal(p2.steps[0].id, "review");
  assert.deepEqual(plain(p2.review.kanji.slice().sort()), plain(p1.newKanji.slice().sort()));
});

test("daily review stays manageable: capped, with the overflow reported and nothing lost", () => {
  const state = M.createState();
  M.introduce(state, data.curriculum, T0);
  for (const k of data.curriculum) M.record(state, { kanji: [k], skill: "meaning", area: "vocabulary", kind: "choice", correct: false, hinted: false, qid: "w" + k, type: "kanji-meaning" }, T0);
  state.settings.reviewCap = 5;
  const r = C.reviewFor(data, state, T0 + 3, []);
  assert.equal(r.kanji.length, 5);
  assert.equal(r.due, 18);
  assert.equal(r.overflow, 13);
  assert.equal(new Set(r.kanji).size, 5);
});

test("the most overdue/weakest kanji are reviewed first", () => {
  const state = M.createState();
  M.introduce(state, ["人", "日", "本"], T0);
  for (let i = 0; i < 4; i++) M.record(state, { kanji: ["日"], skill: "meaning", area: "vocabulary", kind: "choice", correct: true, hinted: false, qid: "g" + i, type: "x" }, T0);
  M.record(state, { kanji: ["人"], skill: "meaning", area: "vocabulary", kind: "choice", correct: false, hinted: false, qid: "b", type: "x" }, T0);
  M.record(state, { kanji: ["本"], skill: "meaning", area: "vocabulary", kind: "choice", correct: true, hinted: false, qid: "m", type: "x" }, T0);
  state.settings.reviewCap = 5;
  const r = C.reviewFor(data, state, T0 + 2, []);
  assert.equal(r.kanji[0], "人");
});

test("a light day is topped up with the weakest kanji so early sessions still consolidate", () => {
  const state = M.createState();
  M.introduce(state, ["人", "日", "本", "一"], T0);
  for (const k of ["人", "日", "本", "一"]) M.record(state, { kanji: [k], skill: "meaning", area: "vocabulary", kind: "choice", correct: true, hinted: false, qid: "t" + k, type: "x" }, T0);
  // Nothing is due yet (next review is tomorrow or later) but the floor still brings a few back.
  const r = C.reviewFor(data, state, T0, []);
  assert.equal(r.due, 0);
  assert.equal(r.kanji.length, 4, "all four unmastered kanji (the floor is half the review cap)");
  assert.deepEqual(plain(r.extra.slice().sort()), plain(r.kanji.slice().sort()), "and they are flagged as extra practice, not as due");
});

test("when everything is learned and nothing is due there is nothing left to do", () => {
  const state = M.createState();
  M.introduce(state, data.curriculum, T0);
  const plan = C.compose({ data, state, today: T0 });
  assert.equal(plan.hasNew, false);
  assert.equal(plan.finished, true);
});

function prepared(today) {
  const state = M.createState();
  const plan = C.compose({ data, state, today });
  learn(state, plan, today);
  return { state, plan };
}

test("practice: two questions per new kanji, no repeats, the same kanji not back-to-back", () => {
  for (let seed = 1; seed <= 15; seed++) {
    const { state, plan } = prepared(T0);
    const qs = C.buildStep({ id: "practice" }, plan, { data, state, rng: rng(seed) });
    assert.equal(qs.length, 12, "6 kanji × 2");
    assert.equal(new Set(qs.map((q) => q.id)).size, 12);
    for (let i = 1; i < qs.length; i++) assert.notEqual(qs[i].target, qs[i - 1].target, `seed ${seed}: consecutive questions on ${qs[i].target}`);
    assert.equal(qs.filter((q) => q.type === "kanji-meaning").length, 6, "round one is recognition");
    assert.ok(new Set(qs.map((q) => q.type)).size >= 3, "a mix of question types");
  }
});

test("recall: typed retrieval first, then a self-check for every kanji", () => {
  const { state, plan } = prepared(T0);
  const qs = C.buildStep({ id: "recall" }, plan, { data, state, rng: rng(5) });
  const typed = qs.filter((q) => q.type === "recall-type"), flips = qs.filter((q) => q.type === "recall-flip");
  assert.equal(typed.length, 3);
  assert.equal(flips.length, 6);
  assert.deepEqual(qs.slice(0, 3).map((q) => q.type), ["recall-type", "recall-type", "recall-type"]);
  assert.deepEqual(plain(flips.map((q) => q.kanji[0]).sort()), plain(plan.newKanji.slice().sort()));
});

test("comprehension: every authored question of the passage, with its passage link", () => {
  const { state, plan } = prepared(T0);
  const step = plan.steps.find((s) => s.id === "comprehension");
  const qs = C.buildStep(step, plan, { data, state, rng: rng(2) });
  assert.equal(qs.length, data.passages[1].questions.length);
  assert.ok(qs.every((q) => q.type === "passage" && q.prompt.passage === 1));
});

test("review: only due kanji; typed recall only for solid ones; never an unverified flip card", () => {
  const state = M.createState();
  const p = C.compose({ data, state, today: T0 });
  learn(state, p, T0);
  for (const k of p.newKanji) for (let i = 0; i < 3; i++) M.record(state, { kanji: [k], skill: "meaning", area: "vocabulary", kind: "choice", correct: true, hinted: false, qid: `r${k}${i}`, type: "x" }, T0 + i * 2);
  const plan = C.compose({ data, state, today: T0 + 7 });
  for (let seed = 1; seed <= 10; seed++) {
    const qs = C.buildStep(plan.steps[0], plan, { data, state, rng: rng(seed) });
    assert.ok(qs.length > 0);
    for (const q of qs) {
      assert.ok(plan.review.kanji.includes(q.kanji[0]) || plan.review.kanji.some((k) => q.kanji.includes(k)));
      assert.notEqual(q.type, "recall-flip");
    }
  }
});

test("a wrong answer gets a different follow-up question on the same kanji", () => {
  const { state, plan } = prepared(T0);
  const qs = C.buildStep({ id: "practice" }, plan, { data, state, rng: rng(4) });
  for (const q of qs) {
    const r = C.retryFor(q, plan, { data, state, rng: rng(11) });
    assert.ok(r, "a retry exists");
    assert.notEqual(r.id, q.id);
    assert.equal(r.target, q.target);
  }
});

test("sentences for the lesson use only kanji met so far and cover every new kanji", () => {
  const { state, plan } = prepared(T0);
  const have = new Set(plan.newKanji);
  const list = C.sentencesFor(plan, { data, state, rng: rng(3) });
  assert.ok(list.length >= 6);
  for (const s of list) assert.ok(s.requires.every((k) => have.has(k)), s.id);
  for (const k of plan.newKanji) assert.ok(list.some((s) => s.requires.includes(k)), `${k} appears in a sentence`);
});

/* ---------------- readiness ---------------- */
test("readiness is never claimed in this release, however well the learner does", () => {
  const state = M.createState();
  M.introduce(state, data.curriculum, T0);
  for (let i = 0; i < 200; i++) state.log.push({ d: T0, k: ["人"], q: "q" + i, t: "x", a: ["vocabulary", "kanjiReading", "orthography", "comprehension"][i % 4], c: 1, h: false, f: true });
  const r = R.compute(state, data.meta.capabilities);
  assert.equal(r.overall, null);
  assert.equal(r.claim, "not-claimed");
  assert.equal(r.areas.find((a) => a.id === "grammar").status, "unavailable");
  assert.equal(r.areas.find((a) => a.id === "comprehension").status, "unavailable", "unfamiliar passages are not part of this release");
  assert.match(r.note, /not claimed/i);
});

test("readiness measures demonstrated performance on DISTINCT questions only", () => {
  const state = M.createState();
  const add = (q, c, a = "vocabulary") => state.log.push({ d: T0, k: ["人"], q, t: "x", a, c, h: c < 1, f: false });
  for (let i = 0; i < 30; i++) add("same-question", 1);          // the same familiar question, repeated 30 times
  let r = R.compute(state, data.meta.capabilities).areas.find((a) => a.id === "vocabulary");
  assert.equal(r.status, "building", "repetition cannot create evidence");
  assert.equal(r.items, 1);
  for (let i = 0; i < 12; i++) add("v" + i, i % 2 ? 1 : 0.5);   // 12 distinct, half of them hinted
  r = R.compute(state, data.meta.capabilities).areas.find((a) => a.id === "vocabulary");
  assert.equal(r.status, "measured");
  assert.ok(r.score < 0.8, "hinted answers pull the score down");
});

test("self-assessment cards are ignored by readiness", () => {
  const state = M.createState();
  for (let i = 0; i < 40; i++) state.log.push({ d: T0, k: ["人"], q: "f" + i, t: "recall-flip", a: "vocabulary", c: 0.75, h: false, f: true });
  assert.equal(R.compute(state, {}).areas.find((a) => a.id === "vocabulary").status, "building");
});

test("readiness is only ever claimed when every area and exam section is supported and measured", () => {
  const state = M.createState();
  for (const a of ["vocabulary", "kanjiReading", "orthography", "grammar", "comprehension"]) for (let i = 0; i < 15; i++) state.log.push({ d: T0, k: ["人"], q: a + i, t: "x", a, c: a === "grammar" ? 0.6 : 1, h: false, f: true });
  const all = { listening: true, mockExam: true, grammarLessons: true, unfamiliarPassages: true };
  const r = R.compute(state, all);
  assert.equal(r.claim, "measured");
  assert.ok(Math.abs(r.overall - 0.6) < 1e-9, "the weakest area limits readiness");
  assert.equal(R.compute(state, { ...all, listening: false }).overall, null);
});
