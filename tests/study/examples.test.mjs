// The example sentences: the build already rejects bad lines; these tests pin the data the browser receives.
import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { loadStudy, allWords, root } from "./load.mjs";

const { Study, lessons } = loadStudy();
const markup = (() => {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(root, "js/n5/markup.js"), "utf8"), ctx);
  return ctx.N5.Markup;
})();
const KANJI = /[㐀-鿿々〆]/;

test("every word has an example, except entries that are whole sentences themselves", () => {
  const without = allWords(lessons).filter((w) => !w.example);
  assert.ok(without.length > 0 && without.length <= 25, `${without.length} entries without an example`);
  for (const w of without) assert.equal(w.group, "exp", `${w.id} ${w.ja} is not an expression but has no example`);
  for (const w of allWords(lessons).filter((x) => x.example)) {
    assert.ok(w.example.ja && w.example.en, `${w.id} has both Japanese and English`);
  }
});

test("every kanji in every example has a hiragana reading", () => {
  for (const w of allWords(lessons).filter((x) => x.example)) {
    const bare = markup.parse(w.example.ja).filter((t) => t.t === "text").map((t) => t.s).join("");
    assert.ok(!KANJI.test(bare), `${w.id}: kanji without reading in ${w.example.ja}`);
    for (const t of markup.parse(w.example.ja).filter((x) => x.t === "ruby")) {
      assert.match(t.rt, /^[ぁ-ゖー]+$/, `${w.id}: reading of ${t.base} must be hiragana`);
    }
  }
});

test("the plain sentence reads back as the reading with the kanji replaced (text for the voice)", () => {
  const w = lessons[16].words[0];
  assert.equal(markup.plain(w.example.ja), "まどを 開けて ください。");
  assert.equal(markup.reading(w.example.ja), "まどを あけて ください。");
});

test("every example sentence is only one or two sentences long and is not a copy of its English", () => {
  for (const w of allWords(lessons).filter((x) => x.example)) {
    const plain = markup.plain(w.example.ja);
    assert.ok(plain.length <= 40, `${w.id}: too long for a learner example (${plain.length})`);
    assert.notEqual(plain, w.example.en);
    assert.match(w.example.en, /[.?!]$/, `${w.id}: English ends like a sentence`);
  }
});

test("other written forms: unique per word, never already accepted, always recognisable as the same word", () => {
  const F = Study.Forms;
  for (const w of allWords(lessons).filter((x) => x.alt)) {
    assert.equal(new Set(w.alt).size, w.alt.length, `${w.id} duplicate alternatives`);
    const base = F.japaneseForms({ ...w, alt: [] });
    for (const a of w.alt) assert.ok(!base.includes(F.normalizeJapanese(a)), `${w.id} ${a} is already accepted`);
  }
});

test("a speech recogniser that prints the kanji spelling of a kana word is still judged correct", () => {
  const M = Study.Matcher;
  const find = (n, ja) => lessons[n].words.find((w) => w.ja === ja);
  assert.equal(M.judgeJapanese([find(16, "まど")], ["窓"]).ok, true);
  assert.equal(M.judgeJapanese([find(16, "おなか")], ["お腹"]).ok, true);
  assert.equal(M.judgeJapanese([find(29, "かみ")], ["髪"]).ok, true);
  assert.equal(M.judgeJapanese([find(29, "かみ")], ["紙"]).ok, false, "a different word with the same sound is not guessed");
  assert.equal(M.judgeJapanese([find(17, "2ばん目の かど")], ["二番目の角"]).ok, true);
});

test("any kanji/kana mix a recogniser may print for a word is accepted (甘いもの for あまい物)", () => {
  const M = Study.Matcher;
  const find = (n, ja) => lessons[n].words.find((w) => w.ja === ja);
  const accepts = (n, ja, ...said) => said.forEach((s) => assert.equal(M.judgeJapanese([find(n, ja)], [s]).ok, true, `${ja} <- ${s}`));
  accepts(16, "あまい物", "あまい物", "あまいもの", "甘い物", "甘いもの", "amai mono");
  accepts(16, "おなかが すきました。", "お腹が空きました", "お腹がすきました", "おなかが空きました", "おなかがすきました");
  accepts(16, "しつれいします。", "失礼します", "しつれいします");
  accepts(16, "あとで", "後で", "あとで");
  accepts(29, "よろしく おねがいします。", "よろしくお願いします", "よろしくおねがいします", "よろしく お願い します");
  accepts(17, "おじゃまします。", "お邪魔します", "おじゃまします");
  accepts(17, "わかりました。", "分かりました", "わかりました");
  accepts(26, "よく", "良く", "よく");
  accepts(16, "(お)酒", "お酒", "おさけ", "さけ", "酒");
  const wrong = (n, ja, s) => assert.equal(M.judgeJapanese([find(n, ja)], [s]).ok, false, `${ja} must not accept ${s}`);
  wrong(16, "あまい物", "甘い本");
  wrong(16, "あまい物", "あまいもん");
  wrong(16, "しつれいします。", "失礼しました");
});

test("every written form that mixes kanji and kana lines up with the reading, so its mixed spellings exist", () => {
  const F = Study.Forms;
  for (const w of allWords(lessons).filter((x) => x.alt)) {
    const without = new Set(F.japaneseForms({ ...w, alt: [] }));
    for (const alt of w.alt) for (const v of F.japaneseVariants(alt)) {
      const mixes = /[㐀-鿿々〆0-9０-９]/.test(v) && /[^㐀-鿿々〆]/.test(v);
      if (!mixes) continue;
      const gained = F.japaneseForms({ ...w, alt: [v] }).filter((f) => !without.has(f));
      const runs = (v.match(/[㐀-鿿々〆0-9０-９]+/g) || []).length;
      assert.ok(gained.length >= (runs >= 2 ? 2 : 1), `${w.id} ${w.ja}: ${v} did not line up with the reading (only ${gained.length} new forms)`);
    }
  }
});
