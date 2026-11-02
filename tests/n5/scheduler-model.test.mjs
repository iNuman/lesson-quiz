import test from "node:test";
import assert from "node:assert";
import { loadN5, plain, memoryStorage } from "./load.mjs";

const { N5 } = loadN5();
const S = N5.Scheduler, M = N5.Model;
const T0 = 20000;   // an arbitrary "day number"

const fresh = () => { const s = M.createState(); M.introduce(s, ["人", "日", "本"], T0); return s; };
const ev = (o) => Object.assign({ kanji: ["人"], skill: "meaning", area: "vocabulary", kind: "choice", correct: true, hinted: false, qid: "q" + Math.random(), type: "kanji-meaning" }, o);

/* ---------------- scheduler ---------------- */
test("passing advances one box; the interval grows", () => {
  let r = { box: 0, interval: 1, next: 1, lapses: 0 };
  const seen = [];
  for (let d = 0; d < 6; d++) { const p = S.schedule(r, "pass", T0 + d * 100); Object.assign(r, p); seen.push(r.interval); }
  assert.deepEqual(seen, [2, 4, 7, 14, 30, 60]);
  assert.equal(S.schedule({ ...r, box: 6 }, "pass", T0 + 900).box, 6, "capped at the top box");
});

test("a box advances at most once per calendar day", () => {
  const r = { box: 0, interval: 1, next: T0 + 1, lapses: 0, boxDay: null };
  Object.assign(r, S.schedule(r, "pass", T0));
  const box1 = r.box;
  for (let i = 0; i < 5; i++) Object.assign(r, S.schedule(r, "pass", T0));
  assert.equal(r.box, box1, "five more passes the same day must not climb further");
});

test("answers on the day a kanji is introduced always bring it back tomorrow", () => {
  const r = { firstSeen: T0, box: 0, interval: 1, next: T0 + 1, lapses: 0, boxDay: null };
  for (let i = 0; i < 6; i++) Object.assign(r, S.schedule(r, "pass", T0));
  assert.equal(r.box, 0); assert.equal(r.next, T0 + 1);
  Object.assign(r, S.schedule(r, "pass", T0 + 1));
  assert.equal(r.box, 1, "the first real review advances the box");
});

test("practising early (not yet due) never pushes the interval out", () => {
  const r = { firstSeen: T0 - 9, box: 2, interval: 4, next: T0 + 3, lapses: 0, boxDay: null };
  Object.assign(r, S.schedule(r, "pass", T0));
  assert.equal(r.box, 2); assert.equal(r.next, T0 + 3);
  Object.assign(r, S.schedule(r, "pass", T0 + 3));
  assert.equal(r.box, 3, "once it is due, a pass advances it");
});

test("mastery targets: the weakest required skill is what gets practised next", () => {
  const st = M.createState(); M.introduce(st, ["人"], T0);
  const r = st.kanji["人"];
  Object.assign(r.skills, { meaning: 0.9, reading: 0.9, context: 0.9, recall: 0.2 });
  assert.equal(M.weakestNeeded(r), "recall");
  Object.assign(r.skills, { meaning: 0.2, reading: 0.9, context: 0.9, recall: 0.9 });
  assert.equal(M.weakestNeeded(r), "meaning");
  Object.assign(r.skills, { meaning: 1, reading: 1, context: 1, recall: 1 });
  assert.equal(M.weakestNeeded(r), "recall", "no verified typed recall yet");
  r.verifiedRecall = 1;
  assert.equal(M.weakestNeeded(r), null);
});

test("a failure drops two boxes, counts a lapse and returns tomorrow", () => {
  const p = S.schedule({ box: 4, lapses: 1 }, "fail", T0);
  assert.equal(p.box, 2); assert.equal(p.lapses, 2); assert.equal(p.next, T0 + 1);
  assert.equal(S.schedule({ box: 1, lapses: 0 }, "fail", T0).box, 0);
});

test("a partial (hinted) answer never advances the schedule", () => {
  const r = { box: 3, interval: 7, next: T0, lapses: 0, boxDay: null };
  const p = S.schedule(r, "partial", T0);
  assert.equal(p.box, 3);
  assert.ok(p.next >= T0 + 1 && p.next <= T0 + 4);
});

test("day numbers follow the local calendar", () => {
  assert.equal(S.dayNumber(new Date(2026, 10, 2)) - S.dayNumber(new Date(2026, 10, 1)), 1);
  assert.equal(S.dayToIso(S.dayNumber(new Date(2026, 10, 2))), "2026-11-02");
});

/* ---------------- credit rules ---------------- */
test("credit: hinted correct is half, self-rating is capped, wrong is zero", () => {
  assert.equal(M.creditFor(ev({})), 1);
  assert.equal(M.creditFor(ev({ hinted: true })), 0.5);
  assert.equal(M.creditFor(ev({ correct: false })), 0);
  assert.equal(M.creditFor(ev({ kind: "self", rating: "good" })), 0.75);
  assert.equal(M.creditFor(ev({ kind: "self", rating: "hard" })), 0.4);
  assert.equal(M.creditFor(ev({ kind: "self", rating: "again" })), 0);
});

test("a hinted answer can never lift a skill above half, however often it is repeated", () => {
  const s = fresh();
  for (let i = 0; i < 20; i++) M.record(s, ev({ hinted: true }), T0 + i);
  assert.ok(s.kanji["人"].skills.meaning <= 0.5 + 1e-9);
  assert.equal(s.kanji["人"].reviewDays.length, 0, "hinted answers do not count as unaided review days");
  assert.equal(s.kanji["人"].box, 0, "and never advance the schedule");
});

test("a correct answer never lowers a skill; a wrong one halves it", () => {
  const s = fresh();
  for (let i = 0; i < 4; i++) M.record(s, ev({}), T0 + i);
  const before = s.kanji["人"].skills.meaning;
  M.record(s, ev({ hinted: true }), T0 + 5);
  assert.equal(s.kanji["人"].skills.meaning, before);
  M.record(s, ev({ correct: false }), T0 + 6);
  assert.ok(Math.abs(s.kanji["人"].skills.meaning - before / 2) < 1e-9);
});

test("a multi-kanji question credits every kanji it tests", () => {
  const s = fresh();
  M.record(s, ev({ kanji: ["日", "本"], skill: "reading", qid: "x" }), T0);
  assert.ok(s.kanji["日"].skills.reading > 0 && s.kanji["本"].skills.reading > 0);
  assert.equal(s.kanji["人"].attempts, 0);
});

/* ---------------- mastery ---------------- */
function drill(s, k, days, opts) {
  for (const d of days) for (const [skill, kind] of [["meaning", "choice"], ["reading", "choice"], ["context", "choice"], ["recall", opts.recallKind || "typed"]]) {
    for (let r = 0; r < 3; r++) M.record(s, ev({ kanji: [k], skill, kind, rating: "good", qid: `${k}-${skill}-${d}-${r}` }), d);
  }
}
test("mastery needs several days, verified typed recall and a solid schedule", () => {
  const s = fresh();
  drill(s, "人", [T0], {});
  assert.notEqual(M.stateOf(s, "人", T0), "mastered", "one intense day is not mastery");
  drill(s, "人", [T0 + 2, T0 + 5, T0 + 12], {});
  assert.equal(M.stateOf(s, "人", T0 + 12), "mastered");
});

test("self-assessed recall alone can never make a kanji mastered", () => {
  const s = fresh();
  drill(s, "人", [T0, T0 + 2, T0 + 5, T0 + 12, T0 + 30], { recallKind: "self" });
  assert.equal(s.kanji["人"].verifiedRecall, 0);
  assert.notEqual(M.stateOf(s, "人", T0 + 30), "mastered");
});

test("hinted answers alone can never make a kanji mastered", () => {
  const s = fresh();
  for (const d of [T0, T0 + 2, T0 + 5, T0 + 12, T0 + 30]) for (const skill of ["meaning", "reading", "context", "recall"]) for (let r = 0; r < 5; r++) M.record(s, ev({ skill, hinted: true, kind: skill === "recall" ? "typed" : "choice", qid: `h${d}${skill}${r}` }), d);
  assert.notEqual(M.stateOf(s, "人", T0 + 30), "mastered");
  assert.notEqual(M.stateOf(s, "人", T0 + 30), "review");
});

test("a later failure demotes a mastered kanji, and long neglect marks it fading", () => {
  const s = fresh();
  drill(s, "人", [T0, T0 + 2, T0 + 5, T0 + 12], {});
  assert.equal(M.stateOf(s, "人", T0 + 12), "mastered");
  assert.equal(M.stateOf(s, "人", T0 + 12 + 400), "fading");
  M.record(s, ev({ correct: false, qid: "slip" }), T0 + 13);
  assert.notEqual(M.stateOf(s, "人", T0 + 13), "mastered");
});

test("states: new → seen → learning", () => {
  const s = M.createState();
  assert.equal(M.stateOf(s, "人", T0), "new");
  M.introduce(s, ["人"], T0);
  assert.equal(M.stateOf(s, "人", T0), "seen");
  M.record(s, ev({}), T0);
  assert.equal(M.stateOf(s, "人", T0), "learning");
});

test("weak and overdue kanji are prioritised for review", () => {
  const s = fresh();
  for (let i = 0; i < 4; i++) M.record(s, ev({ kanji: ["日"], qid: "a" + i }), T0);
  M.record(s, ev({ kanji: ["人"], correct: false, qid: "b" }), T0);
  const due = M.dueKanji(s, T0 + 3);
  assert.deepEqual(plain(due.slice(0, 2)), ["人", "日"], "the weak kanji comes first");
  assert.ok(!due.includes("本"), "a kanji never answered is not reviewed yet");
});

/* ---------------- persistence ---------------- */
test("state survives a save/load round trip", () => {
  const s = fresh();
  M.record(s, ev({ qid: "p1" }), T0);
  const st = memoryStorage();
  assert.equal(M.save(st, s), true);
  const back = M.load(st);
  assert.deepEqual(plain(back.introduced), ["人", "日", "本"]);
  assert.deepEqual(plain(back.kanji["人"]), plain(s.kanji["人"]));
});

test("corrupt, partial or hostile saves cannot crash or poison the app", () => {
  for (const bad of ["{not json", "null", "[]", '{"settings":{"newPerDay":"lots","reviewCap":-5},"introduced":"x","kanji":7,"log":5}', '{"introduced":["人"],"kanji":{"人":{"skills":{"meaning":99,"recall":-3},"box":99}}}']) {
    const s = M.load(memoryStorage({ [M.KEY]: bad }));
    assert.ok(s.settings.newPerDay >= 3 && s.settings.newPerDay <= 10);
    assert.ok(s.settings.reviewCap >= 5 && s.settings.reviewCap <= 30);
    for (const r of Object.values(s.kanji)) {
      for (const v of Object.values(r.skills)) assert.ok(v >= 0 && v <= 1);
      assert.ok(r.box >= 0 && r.box <= S.MAX_BOX);
    }
  }
});

test("unavailable storage degrades gracefully", () => {
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
  assert.equal(M.load(broken).introduced.length, 0);
  assert.equal(M.save(broken, M.createState()), false);
});

test("settings are clamped to sensible ranges", () => {
  const s = M.sanitize({ settings: { newPerDay: 99, reviewCap: 1 } });
  assert.equal(s.settings.newPerDay, 10); assert.equal(s.settings.reviewCap, 5);
  assert.equal(M.sanitize({ settings: { newPerDay: 6.4 } }).settings.newPerDay, 6);
});

test("export/import preserves progress", () => {
  const s = fresh(); M.record(s, ev({ qid: "e1" }), T0);
  assert.deepEqual(plain(M.importJson(M.exportJson(s)).kanji), plain(s.kanji));
});
