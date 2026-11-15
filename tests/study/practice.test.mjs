import test from "node:test";
import assert from "node:assert";
import { loadStudy } from "./load.mjs";

const { Study } = loadStudy();
const P = Study.Practice;
const words = (n) => Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}` }));
const noShuffle = () => 0.999999;                       // Fisher-Yates with this value keeps the order
const make = (n, o) => P.create(words(n), { rand: noShuffle, ...o });
const id = (s) => P.current(s).word.id;

test("a first-try correct answer clears the word; a lesson answered perfectly ends after one pass", () => {
  const s = make(4);
  const seen = [];
  while (!P.isDone(s)) { seen.push(id(s)); assert.deepEqual({ ...P.answer(s, true) }, { cleared: true }); }
  assert.deepEqual(seen, ["w1", "w2", "w3", "w4"]);
  assert.equal(P.summary(s).firstTry, 4);
  assert.equal(P.current(s), null);
});

test("a missed word comes back after GAP other cards and needs NEED correct answers in a row", () => {
  const s = make(6);
  assert.equal(id(s), "w1");
  assert.deepEqual({ ...P.answer(s, false) }, { cleared: false });
  const order = [];
  for (let i = 0; i < 4; i++) { order.push(id(s)); P.answer(s, true); }
  assert.deepEqual(order, ["w2", "w3", "w4", "w1"], "w1 returns after exactly 3 other cards");
  assert.equal(id(s), "w5");
});

test("a miss during relearning restarts the count; two correct in a row finally clear it", () => {
  const s = make(2, { gap: 1 });
  P.answer(s, false);                       // w1 missed -> queue: w2, w1
  assert.equal(id(s), "w2"); P.answer(s, true);
  assert.equal(id(s), "w1"); P.answer(s, true);         // streak 1, not cleared
  assert.equal(P.cleared(s), 1);
  assert.equal(id(s), "w1", "only one left: it is asked again");
  P.answer(s, false);                       // streak reset
  assert.equal(id(s), "w1"); P.answer(s, true);
  assert.equal(P.isDone(s), false);
  P.answer(s, true);
  assert.equal(P.isDone(s), true);
  const sum = P.summary(s);
  assert.deepEqual({ total: sum.total, cleared: sum.cleared, remaining: sum.remaining, firstTry: sum.firstTry }, { total: 2, cleared: 2, remaining: 0, firstTry: 1 });
  assert.deepEqual(sum.hardest.map((h) => [h.word.id, h.misses]), [["w1", 2]]);
});

test("the same word is never asked twice in a row while another word is waiting", () => {
  for (let seed = 1; seed <= 50; seed++) {
    let x = seed;
    const rand = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    const s = P.create(words(5), { rand });
    let last = null, guard = 0;
    while (!P.isDone(s) && guard++ < 500) {
      const now = id(s);
      if (last !== null && s.queue.length > 0) assert.notEqual(now, last, `seed ${seed}`);
      last = now;
      P.answer(s, Math.random() < 0.5);
    }
    assert.ok(guard < 500, "always terminates when the learner eventually answers correctly");
  }
});

test("a session where every answer is wrong never ends by itself and keeps cycling every word", () => {
  const s = make(3);
  const asked = new Set();
  for (let i = 0; i < 30; i++) { asked.add(id(s)); P.answer(s, false); }
  assert.deepEqual([...asked].sort(), ["w1", "w2", "w3"]);
  assert.equal(P.isDone(s), false);
  assert.equal(P.summary(s).cleared, 0);
});

test("ending early reports what is left; answering after the end does nothing", () => {
  const s = make(4);
  P.answer(s, true); P.answer(s, false);
  P.end(s);
  assert.equal(P.isDone(s), true);
  assert.equal(P.answer(s, true), null);
  const sum = P.summary(s);
  assert.deepEqual({ cleared: sum.cleared, remaining: sum.remaining, attempted: sum.attempted, answers: sum.answers }, { cleared: 1, remaining: 3, attempted: 2, answers: 2 });
});

test("an empty or single-word lesson behaves", () => {
  const empty = make(0);
  assert.equal(P.isDone(empty), true);
  assert.equal(P.answer(empty, true), null);
  assert.equal(P.summary(empty).total, 0);
  const one = make(1);
  P.answer(one, false); P.answer(one, true);
  assert.equal(P.isDone(one), false);
  P.answer(one, true);
  assert.equal(P.isDone(one), true);
});

test("the queue never loses or duplicates a word", () => {
  const s = make(7);
  let guard = 0;
  while (!P.isDone(s) && guard++ < 300) {
    const live = [s.current, ...s.queue];
    assert.equal(new Set(live).size, live.length, "no duplicates");
    const pending = [...s.cards.values()].filter((c) => !c.done).map((c) => c.word.id).sort();
    assert.deepEqual([...live].sort(), pending, "exactly the not-cleared words are queued");
    P.answer(s, guard % 3 !== 0);
  }
  assert.ok(P.isDone(s));
});
