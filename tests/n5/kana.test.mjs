import test from "node:test";
import assert from "node:assert";
import { loadN5, plain } from "./load.mjs";
import { readingForms as toolForms } from "../../tools/n5-lib.mjs";

const { N5, data } = loadN5();
const K = N5.Kana;

test("romaji converts to hiragana (Hepburn and common Nihon/Kunrei spellings)", () => {
  const cases = {
    nihon: "にほん", nippon: "にっぽん", sannin: "さんにん", hitori: "ひとり", futsuka: "ふつか", mikka: "みっか",
    shinbun: "しんぶん", konnichiha: "こんにちは", gakusei: "がくせい", sensei: "せんせい", kyou: "きょう", getsuyoubi: "げつようび",
    nichiyoubi: "にちようび", gakkou: "がっこう", ima: "いま", nani: "なに", nan: "なん", "nan'youbi": "なんようび", nanyoubi: "なにょうび", "kon'ya": "こんや",
    matcha: "まっちゃ", shi: "し", si: "し", tsu: "つ", tu: "つ", fu: "ふ", hu: "ふ", ja: "じゃ", jya: "じゃ", cha: "ちゃ", kyo: "きょ", nya: "にゃ", konna: "こんな",
  };
  for (const [r, k] of Object.entries(cases)) assert.equal(K.romajiToHiragana(r), k, r);
});

test("normalize unifies script and width but keeps the reading itself", () => {
  const same = ["にほん", "ニホン", "ﾆﾎﾝ", "ｎｉｈｏｎ", "nihon", "NIHON", " に ほ ん ", "に・ほ・ん", "にほん。"];
  for (const s of same) assert.equal(K.normalize(s), "にほん", s);
  assert.notEqual(K.normalize("にっぽん"), K.normalize("にほん"));
});

test("a typed reading is accepted only when it equals an accepted reading", () => {
  const acc = ["にほん", "にっぽん"];
  for (const ok of ["にほん", "ニホン", "nihon", "nihonn", "にっぽん", "nippon"]) assert.equal(K.checkTyped(ok, acc).ok, true, ok);
  // wrong readings must never be forgiven
  for (const bad of ["にほ", "にぽん", "にほんん", "にほうん", "にーほん", "にほん人", "ひほん", "nihn", "nihonnn", "nihonx"]) {
    const r = K.checkTyped(bad, acc);
    assert.equal(r.ok, false, `${bad} must not be accepted`);
  }
});

test("input that cannot be judged is flagged, not marked wrong", () => {
  assert.equal(K.checkTyped("", ["ひと"]).reason, "empty");
  assert.equal(K.checkTyped("   ", ["ひと"]).reason, "empty");
  assert.equal(K.checkTyped("日本", ["にほん"]).reason, "not-kana");
  assert.equal(K.checkTyped("zzz", ["ひと"]).reason, "not-kana");
  assert.equal(K.checkTyped("ひと", ["ひと"]).reason, null);
  assert.equal(K.checkTyped("ふ", ["ひと"]).reason, "wrong");
});

test("the long-vowel mark is not silently dropped or added", () => {
  assert.equal(K.checkTyped("おおきい", ["おおきい"]).ok, true);
  assert.equal(K.checkTyped("おーきい", ["おおきい"]).ok, false);
});

test("reading forms agree with the build tool's copy", () => {
  for (const k of Object.values(data.kanji)) {
    const a = [...K.readingForms([...k.on, ...k.kun])].sort();
    const b = [...toolForms([...k.on, ...k.kun])].sort();
    assert.deepEqual(plain(a), b, `forms differ for ${k.id}`);
  }
});

test("primary reading shown above a lone kanji is hiragana", () => {
  assert.equal(K.primaryReading(data.kanji["人"]), "ひと");
  assert.equal(K.primaryReading(data.kanji["曜"]), "よう");   // no kun'yomi → on'yomi in hiragana
  assert.equal(K.primaryReading(data.kanji["学"]), "まな");
  assert.equal(K.displayReading("ひと.つ"), "ひと・つ");
  assert.equal(K.displayReading("-び"), "〜び");
});
