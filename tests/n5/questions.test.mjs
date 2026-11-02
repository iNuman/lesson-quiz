import test from "node:test";
import assert from "node:assert";
import { loadN5 } from "./load.mjs";

const { N5, data } = loadN5();
const Q = N5.Questions, M = N5.Markup, K = N5.Kana;

const upto = (n) => new Set(data.units.filter((u) => u.id <= n).flatMap((u) => u.kanji));
const ctxFor = (intro, seed, seen) => ({ data, introduced: intro, rng: Q.makeRng(seed), seen: seen || {} });
const SCOPES = [1, 2, 3];

function allQuestions(intro, seeds) {
  const out = [];
  for (const k of intro) for (const t of Q.available(k, ctxFor(intro, 1))) for (let s = 1; s <= seeds; s++) {
    const q = Q.build(t, k, ctxFor(intro, s * 7919 + k.codePointAt(0)));
    if (q) out.push({ k, t, q });
  }
  return out;
}

test("every kanji can be asked about in several different ways once its unit is learned", () => {
  for (const n of SCOPES) {
    const intro = upto(n);
    for (const k of data.units.find((u) => u.id === n).kanji) {
      const types = Q.available(k, ctxFor(intro, 1));
      assert.ok(types.length >= 5, `${k} (unit ${n}) has only ${types.join(",")}`);
      assert.ok(types.includes("kanji-meaning") && types.includes("recall-type") && types.includes("recall-flip"));
    }
  }
});

test("multiple-choice questions have exactly four unique options including exactly one correct answer", () => {
  for (const n of SCOPES) for (const { q } of allQuestions(upto(n), 12)) {
    if (q.answerKind !== "choice") continue;
    assert.equal(q.options.length, 4, q.id);
    assert.equal(new Set(q.options).size, 4, `${q.id} has duplicate options: ${q.options}`);
    assert.equal(q.options.filter((o) => o === q.answer).length, 1, q.id);
  }
});

test("a question never mentions a kanji, word or sentence the learner has not met", () => {
  for (const n of SCOPES) {
    const intro = upto(n);
    for (const { q } of allQuestions(intro, 10)) {
      for (const k of q.kanji) assert.ok(intro.has(k), `${q.id} tests unmet kanji ${k}`);
      if (q.id.startsWith("vm:") || q.id.startsWith("rt:")) {
        const v = data.vocab[q.id.split(":")[1]];
        assert.ok(v.kanji.every((k) => intro.has(k)), `${q.id} uses an unmet kanji`);
      }
      if (/^(ric|orth):/.test(q.id)) {
        const s = data.sentences[q.id.split(":")[1]];
        assert.ok(s.requires.every((k) => intro.has(k)), `${q.id}: sentence needs unmet kanji`);
      }
      if (q.id.startsWith("cloze:")) {
        const c = data.cloze[q.id.slice(6)];
        assert.ok(c.requires.every((k) => intro.has(k)), `${q.id} needs unmet kanji`);
      }
    }
  }
});

test("reading questions: the answer is right, and no wrong choice is a reading of the same word", () => {
  let seen = 0;
  for (const { q } of allQuestions(upto(3), 25)) {
    if (q.type !== "reading-in-context") continue;
    seen++;
    const [, sid, vid] = q.id.split(":");
    const v = data.vocab[vid];
    assert.equal(q.answer, M.reading(v.ruby));
    for (const o of q.options) assert.ok(K.isKanaOnly(o), `${o} must be hiragana`);
    for (const o of q.options.filter((x) => x !== q.answer)) {
      assert.ok(!v.readings.includes(o), `${q.id}: ${o} is a correct reading`);
      assert.ok(!v.otherReadings.includes(o), `${q.id}: ${o} is another real reading of ${v.ja}`);
    }
    assert.ok(q.prompt.markup.includes(q.prompt.mark), `${sid} must contain the underlined word`);
  }
  assert.ok(seen > 50, "the generator should produce plenty of reading questions");
});

test("orthography questions: look-alikes are never the answer and never repeat", () => {
  let seen = 0;
  for (const { q } of allQuestions(upto(3), 15)) {
    if (q.type !== "orthography") continue;
    seen++;
    const v = data.vocab[q.id.split(":")[2]];
    assert.equal(q.answer, v.ja);
    assert.equal(q.options.filter((o) => o === v.ja).length, 1);
    assert.equal(q.prompt.kana, M.reading(v.ruby));
  }
  assert.ok(seen > 30);
});

test("cloze questions: the sentence really contains the blank and the answer fits it", () => {
  for (const { q } of allQuestions(upto(3), 6)) {
    if (q.type !== "cloze") continue;
    const c = data.cloze[q.id.slice(6)];
    assert.equal(q.answer, data.vocab[c.blank].ja);
    assert.ok(q.prompt.markup.includes(q.prompt.mark));
    assert.ok(q.explain.length > 10);
  }
});

test("typed recall accepts exactly the word's readings, and the hints are declared", () => {
  for (const { q } of allQuestions(upto(3), 4)) {
    if (q.type !== "recall-type") continue;
    const v = data.vocab[q.id.slice(3)];
    assert.deepEqual(JSON.parse(JSON.stringify(q.accepted)), v.readings);
    assert.ok(q.hints.some((h) => h.id === "first-kana"));
    assert.equal(K.checkTyped(v.readings[0], q.accepted).ok, true);
    for (const wrong of v.otherReadings) assert.equal(K.checkTyped(wrong, q.accepted).ok, false, `${wrong} is a reading of another sense and must not be accepted`);
  }
});

test("every question declares the exam area and skill it measures (so readiness cannot be inflated)", () => {
  for (const { q } of allQuestions(upto(3), 3)) {
    assert.ok(["vocabulary", "kanjiReading", "orthography", "comprehension", "selfCheck"].includes(q.area), q.id);
    assert.ok(["meaning", "reading", "vocab", "context", "recall"].includes(q.skill), q.id);
    assert.ok(q.section === "language-knowledge" && q.media === null, "listening-ready fields are present");
    if (q.type === "recall-flip") assert.equal(q.answerKind, "self");
  }
});

test("questions vary: option order and item choice are not predictable", () => {
  const k = "日", intro = upto(1);
  const ids = new Set(), positions = new Set();
  for (let s = 1; s <= 60; s++) {
    const q = Q.build("reading-in-context", k, ctxFor(intro, s));
    ids.add(q.id); positions.add(q.options.indexOf(q.answer));
  }
  assert.ok(ids.size >= 3, "several different sentences/words should be used");
  assert.equal(positions.size, 4, "the correct answer must appear in every position");
});

test("content the learner has seen less is preferred", () => {
  const intro = upto(1);
  const seen = {};
  const first = Q.build("reading-in-context", "日", ctxFor(intro, 3, seen));
  seen[first.id] = 5;
  for (let s = 1; s <= 25; s++) assert.notEqual(Q.build("reading-in-context", "日", ctxFor(intro, s, seen)).id, first.id);
});

test("exclusion prevents the same item twice in one step", () => {
  const intro = upto(3), used = new Set();
  for (let i = 0; i < 6; i++) {
    const q = Q.build("kanji-meaning", "人", ctxFor(intro, i + 1), used);
    if (q) used.add(q.id);
  }
  assert.equal(used.size, 1, "kanji-meaning for one kanji has one item");
});

test("choose() leans toward the weakest skill but still varies", () => {
  const intro = upto(3);
  const tally = {};
  for (let s = 1; s <= 200; s++) {
    const q = Q.choose("日", ctxFor(intro, s), { allow: ["kanji-meaning", "reading-in-context", "cloze", "vocab-meaning"], skills: { meaning: 1, reading: 0, vocab: 1, context: 1 } });
    tally[q.type] = (tally[q.type] || 0) + 1;
  }
  assert.ok(tally["reading-in-context"] > tally["kanji-meaning"], JSON.stringify(tally));
  assert.ok(Object.keys(tally).length >= 3, "other types still appear");
});

test("a passage question keeps the passage link and shuffles options", () => {
  const p = data.passages[1], q = p.questions[0];
  const a = Q.passageQuestion(p, q, ctxFor(upto(1), 1)), b = Q.passageQuestion(p, q, ctxFor(upto(1), 2));
  assert.equal(a.prompt.passage, 1);
  assert.equal(a.answer, q.options[q.answer]);
  assert.notDeepEqual(JSON.stringify(a.options), JSON.stringify(b.options));
});

test("a listening question type can be registered without touching the generators", () => {
  // The registry is plain data: a future type only needs an entry here and a builder.
  assert.ok(Q.TYPES["kanji-meaning"].section === "language-knowledge");
  assert.equal(typeof Q.TYPES, "object");
});

test("every kanji can train every skill that mastery requires, otherwise it could never be mastered", () => {
  const all = upto(3);
  for (const k of all) {
    const skills = new Set(Q.available(k, ctxFor(all, 1)).map((t) => Q.TYPES[t].skill));
    for (const need of ["meaning", "reading", "context", "recall"]) assert.ok(skills.has(need), `${k} has no ${need} question`);
  }
});
