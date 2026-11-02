import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadN5, root } from "./load.mjs";

const { data } = loadN5();

/* Runs the real build tool against a copy of the content that has been broken on purpose. */
function buildWith(mutate, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n5-content-"));
  fs.cpSync(path.join(root, "src", "n5"), dir, { recursive: true });
  if (mutate) mutate(dir);
  const out = path.join(dir, "out.js");
  const r = spawnSync(process.execPath, [path.join(root, "tools", "build-n5.mjs"), ...args], { env: { ...process.env, N5_SRC: dir, N5_OUT: out }, encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, text: (r.stdout || "") + (r.stderr || "") };
}
const edit = (rel, fn) => (dir) => {
  const f = path.join(dir, rel);
  const before = fs.readFileSync(f, "utf8");
  const after = fn(before);
  assert.notEqual(before, after, `test setup: ${rel} was not changed`);
  fs.writeFileSync(f, after);
};
const json = (rel, fn) => edit(rel, (t) => { const o = JSON.parse(t); fn(o); return JSON.stringify(o, null, 1); });

test("control: the unmodified content builds under --strict", () => {
  const r = buildWith(null, ["--strict"]);
  assert.equal(r.code, 0, r.text);
});

const BROKEN = [
  ["a kanji without a reading", edit("days/01.json", (t) => t.replace("日本{にほん}に すんで", "日本に すんで")), /kanji without a reading/],
  ["a katakana reading", edit("days/01.json", (t) => t.replace("日本{にほん}に すんで", "日本{ニホン}に すんで")), /must be hiragana/],
  ["unbalanced markup", edit("days/01.json", (t) => t.replace("日本{にほん}に すんで", "日本{にほん に すんで")), /malformed|kanji without a reading/],
  ["a cloze with a duplicate option", json("days/01.json", (o) => { o.cloze[0].options[0] = o.cloze[0].blank; }), /distinct spellings|share a reading/],
  ["an answer index out of range", json("days/01.json", (o) => { o.passage.questions[0].answer = 9; }), /answer index/],
  ["duplicate passage options", json("days/01.json", (o) => { o.passage.questions[0].options[1] = o.passage.questions[0].options[0]; }), /4 distinct options/],
  ["too few look-alikes", json("vocab.json", (o) => { o[0].lookalikes = ["入"]; }), /at least 3 look-alike/],
  ["a look-alike equal to the word", json("vocab.json", (o) => { o[0].lookalikes[0] = "人"; }), /differ from/],
  ["two kanji with the same meaning", json("kanji.json", (o) => { o[1].meaning = o[0].meaning; }), /share the meaning/],
  ["a sentence missing its focus word", json("days/01.json", (o) => { o.sentences[0].focus = ["v-hon"]; }), /exact markup/],
  ["a sentence with no translation", json("days/01.json", (o) => { o.sentences[0].en = ""; }), /no English translation/],
  ["a kanji that no sentence uses", json("days/01.json", (o) => { o.sentences = o.sentences.filter((s) => !s.ja.includes("二")); o.cloze = o.cloze.filter((c) => o.sentences.some((s) => s.id === c.sentence)); }), /sentence\(s\) use it/],
  ["a reading that contradicts the kanji", json("vocab.json", (o) => { o[0].ruby = "人{にく}"; }), /not a taught reading/],
  ["a vocab word using a kanji from a later unit's list that is not in the curriculum", json("vocab.json", (o) => { o[0].ruby = "犬{いぬ}"; }), /outside the curriculum/],
  ["a kanji that nothing tests in context", json("days/01.json", (o) => { o.cloze = o.cloze.filter((c) => c.id !== "c1-7"); }), /could never be mastered/],
  ["an unknown kanji tag on a question", json("days/01.json", (o) => { o.passage.questions[0].kanji = ["猫"]; }), /not in the curriculum/],
  ["a passage that omits a unit kanji", json("days/01.json", (o) => { o.passage.paragraphs = o.passage.paragraphs.map((p) => p.replace(/二人\{ふたり\}とも /, "")); }), /does not use/],
];
for (const [name, mutate, expect] of BROKEN) {
  test(`the build rejects ${name}`, () => {
    const r = buildWith(mutate);
    assert.notEqual(r.code, 0, "the build should fail");
    assert.match(r.text, expect);
  });
}

test("changed content makes the source verification stale — fatal under --strict, a warning otherwise", () => {
  const stale = json("vocab.json", (o) => { o[0].en = "human being"; });
  const strict = buildWith(stale, ["--strict"]);
  assert.notEqual(strict.code, 0);
  assert.match(strict.text, /STALE/);
  const lax = buildWith(stale);
  assert.equal(lax.code, 0, lax.text);
  assert.match(lax.text, /STALE/);
});

test("a missing verification file is fatal under --strict", () => {
  const r = buildWith((dir) => fs.rmSync(path.join(dir, "verification.json")), ["--strict"]);
  assert.notEqual(r.code, 0);
  assert.match(r.text, /missing/);
});

/* ---------------- the generated data itself ---------------- */
test("the curriculum is ordered, complete and 6 kanji per unit", () => {
  assert.equal(data.curriculum.length, 18);
  assert.equal(new Set(data.curriculum).size, 18);
  for (const u of data.units) assert.equal(u.kanji.length, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(data.curriculum)), data.units.flatMap((u) => u.kanji));
});

test("no sentence, word or cloze needs a kanji from a later unit than its own", () => {
  for (const s of Object.values(data.sentences)) for (const k of s.requires) assert.ok(data.kanji[k].unit <= s.unit, `${s.id} needs ${k}`);
  for (const v of Object.values(data.vocab)) for (const k of v.kanji) assert.ok(data.kanji[k].unit <= v.unit);
  for (const c of Object.values(data.cloze)) for (const k of c.requires) assert.ok(data.kanji[k].unit <= c.unit, `${c.id} needs ${k}`);
});

test("every kanji has vocabulary, at least two sentences and a passage appearance", () => {
  for (const k of data.curriculum) {
    assert.ok(Object.values(data.vocab).some((v) => v.kanji.includes(k)), `${k}: vocab`);
    assert.ok(Object.values(data.sentences).filter((s) => s.requires.includes(k)).length >= 2, `${k}: sentences`);
    assert.ok(data.passages[data.kanji[k].unit].requires.includes(k), `${k}: passage`);
  }
});

test("every answer in every authored question is one of its options, and options are unique", () => {
  for (const p of Object.values(data.passages)) for (const q of p.questions) {
    assert.ok(q.answer >= 0 && q.answer < 4);
    assert.equal(new Set(q.options).size, 4, q.id);
  }
});

test("content carries source and review information", () => {
  assert.ok(data.meta.sources.some((s) => s.id === "kanjidic2") && data.meta.sources.some((s) => s.id === "jmdict"));
  assert.match(data.meta.review.sentences, /NEEDS REVIEW/);
  assert.match(data.meta.review.passages, /NEEDS REVIEW/);
  assert.ok(data.verification && data.verification.current, "verification must be current");
  assert.match(data.meta.sources.find((s) => s.id === "original").use, /NOT copied/);
});

test("vocabulary records which JMdict readings must never be used as wrong choices", () => {
  assert.ok(data.vocab["v-ichigatsu"].otherReadings.includes("ひとつき"));
  assert.ok(data.vocab["v-sangatsu"].otherReadings.includes("みつき"));
});

test("listening is not offered, and the schema leaves room for it", () => {
  assert.equal(data.meta.capabilities.listening, false);
  assert.equal(data.meta.capabilities.mockExam, false);
});
