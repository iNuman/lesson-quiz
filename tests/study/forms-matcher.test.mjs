import test from "node:test";
import assert from "node:assert";
import { loadStudy, allWords, wordOf } from "./load.mjs";

const { Study, lessons } = loadStudy();
const { Forms: F, Matcher: M } = Study;
const w = (n, ja) => { const x = wordOf(lessons, n, ja); assert.ok(x, `${n} ${ja} exists`); return x; };
const ja = (word, ...said) => M.judgeJapanese([word], said).ok;
const en = (word, ...said) => M.judgeEnglish(word, said).ok;

test("Japanese variants: ・ separates forms, (…) is optional, complements and marks are dropped", () => {
  assert.deepEqual(F.japaneseVariants("急ぎます・急ぐ"), ["急ぎます", "急ぐ"]);
  assert.deepEqual(F.japaneseVariants("(お)酒").sort(), ["お酒", "酒"]);
  assert.deepEqual(F.japaneseVariants("ひつよう(な)").sort(), ["ひつよう", "ひつような"]);
  assert.deepEqual(F.japaneseVariants("飲みます・飲む(薬を～)"), ["飲みます", "飲む"]);
  assert.deepEqual(F.japaneseVariants("～ぐらい"), ["ぐらい"]);
  assert.deepEqual(F.japaneseVariants("―キロ"), ["キロ"]);
  assert.deepEqual(F.japaneseVariants("おなかが すきました。"), ["おなかがすきました"]);
});

test("a word is accepted by its kana reading, its kanji form, either verb form, with or without optional parts", () => {
  const isogu = w(16, "急ぎます・急ぐ");
  for (const ok of ["いそぎます", "いそぐ", "急ぎます", "急ぐ", "イソグ", "いそ ぐ", "isogu", "isogimasu"]) assert.equal(ja(isogu, ok), true, ok);
  for (const bad of ["いそげ", "いそぎ", "いぞぐ", "", "   "]) assert.equal(ja(isogu, bad), false, bad);
  const sake = w(16, "(お)酒");
  for (const ok of ["さけ", "おさけ", "酒", "お酒"]) assert.equal(ja(sake, ok), true, ok);
  assert.equal(ja(w(16, "ひつよう(な)"), "ひつよう"), true);
  assert.equal(ja(w(16, "ひつよう(な)"), "ひつような"), true);
  assert.equal(ja(w(16, "ひつよう(な)"), "ひつようだ"), false);
});

test("katakana words are accepted in hiragana, katakana and romaji", () => {
  const ice = w(16, "アイスクリーム");
  for (const ok of ["アイスクリーム", "あいすくりーむ", "ｱｲｽｸﾘｰﾑ", "aisukuriimu"]) assert.equal(ja(ice, ok), true, ok);
  assert.equal(ja(ice, "あいすくりむ"), false);
});

test("the answer is right when ANY recogniser candidate matches; heard text is the matching one", () => {
  const kusuri = w(16, "薬");
  const r = M.judgeJapanese([kusuri], ["草", "くすり", "癖"]);
  assert.deepEqual({ ok: r.ok, heard: r.heard }, { ok: true, heard: "くすり" });
  const miss = M.judgeJapanese([kusuri], ["草", "癖"]);
  assert.deepEqual({ ok: miss.ok, heard: miss.heard }, { ok: false, heard: "草" });
  assert.deepEqual(JSON.parse(JSON.stringify(M.judgeJapanese([kusuri], []))), { ok: false, heard: "" });
  assert.equal(M.judgeJapanese([kusuri], null).ok, false);
});

test("words with the same meaning are interchangeable answers to an English prompt", () => {
  const shujin = w(19, "主人"), otto = w(19, "おっと");
  const group = M.sameMeaning(shujin, lessons[19].words);
  assert.ok(group.some((x) => x.id === shujin.id) && group.some((x) => x.id === otto.id));
  assert.equal(M.judgeJapanese(group, ["おっと"]).ok, true);
  assert.equal(M.sameMeaning(w(19, "ご主人"), lessons[19].words).length, 1, "'Your husband' is a different meaning");
});

test("English forms: notes dropped, short optional words optional, alternatives split", () => {
  assert.deepEqual(F.englishForms(w(16, "早く")), ["early", "quickly"]);
  assert.deepEqual([...F.englishForms(w(16, "おなかが すきました。"))].sort(), ["hungry", "im hungry"]);
  assert.ok(F.englishForms(w(16, "もしもし")).includes("hello"));
  assert.ok(F.englishForms(w(16, "もしもし")).every((f) => !f.includes("phone")));
  assert.ok(F.englishForms(w(20, "入ります・入る(部屋に～)")).includes("enter"));
  assert.ok(F.englishForms(w(16, "―キロ")).includes("kilometer"));
});

test("English answers: case, articles, 'to' and punctuation do not matter; a different word does", () => {
  const hurry = w(16, "急ぎます・急ぐ");
  for (const ok of ["To hurry", "hurry", "HURRY!", "to hurry."]) assert.equal(en(hurry, ok), true, ok);
  for (const bad of ["worry", "to rush", "hurry up now please", ""]) assert.equal(en(hurry, bad), false, bad);
  assert.equal(en(w(16, "早く"), "quickly"), true);
  assert.equal(en(w(16, "早く"), "early"), true);
  assert.equal(en(w(16, "おなかが すきました。"), "I'm hungry"), true);
  assert.equal(en(w(16, "おなかが すきました。"), "hungry"), true);
});

test("English tolerates one letter of recogniser noise only in words of five letters or more", () => {
  assert.equal(en(w(16, "薬"), "medicin"), true);
  assert.equal(en(w(16, "薬"), "medicene"), true);
  assert.equal(en(w(16, "薬"), "medic"), false);
  assert.equal(en(w(16, "暗い"), "dork"), false, "'dark' is 4 letters: no fuzziness");
  assert.equal(en(w(16, "暗い"), "dark"), true);
  assert.equal(en(w(19, "お父さん"), "my father"), false, "'Your father' and 'My father' are different answers");
  assert.equal(en(w(19, "お父さん"), "your father"), true);
  assert.equal(en(w(19, "父"), "my father"), true);
});

test("distanceAtMostOne", () => {
  const d = M.distanceAtMostOne;
  assert.ok(d("abc", "abc") && d("abc", "abd") && d("abc", "ab") && d("ab", "abc") && d("abc", "xabc") && d("abc", "axc"));
  assert.ok(!d("abc", "axd") && !d("abc", "a") && !d("abcd", "dcba") && !d("abc", "xabcx"));
});

test("spoken prompts are clean", () => {
  assert.equal(F.spokenJapanese(w(16, "急ぎます・急ぐ")), "いそぎます");
  assert.equal(F.spokenJapanese(w(16, "(お)酒")), "さけ");
  assert.equal(F.spokenJapanese(w(16, "～夫人")), "ふじん");
  assert.equal(F.spokenJapanese(w(16, "飲みます・飲む(薬を～)")), "のみます");
  assert.equal(F.spokenEnglish(w(16, "おなかが すきました。")), "I'm hungry.");
  assert.equal(F.spokenEnglish(w(16, "もしもし")), "Hello");
  assert.equal(F.spokenEnglish(w(16, "―キロ")), "kilometer, kilogram");
});

test("every word in every lesson has a Japanese answer, a spoken prompt and an English answer", () => {
  for (const x of allWords(lessons)) {
    assert.ok(F.japaneseForms(x).length > 0, `${x.id} ${x.ja}: Japanese forms`);
    assert.ok(F.spokenJapanese(x).length > 0, `${x.id} ${x.ja}: spoken Japanese`);
    assert.ok(F.englishForms(x).length > 0, `${x.id} ${x.en}: English forms`);
    assert.ok(F.spokenEnglish(x).length > 0, `${x.id} ${x.en}: spoken English`);
    assert.equal(ja(x, F.spokenJapanese(x)), true, `${x.id} ${x.ja}: the spoken form is itself accepted`);
  }
});

test("a word's own answer is always accepted in both directions (self-consistency over all words)", () => {
  for (const x of allWords(lessons)) {
    for (const v of F.japaneseVariants(x.ja)) assert.equal(ja(x, v), true, `${x.id} ${v}`);
    for (const v of F.japaneseVariants(F.readingOf(x))) assert.equal(ja(x, v), true, `${x.id} reading ${v}`);
    for (const f of F.englishForms(x)) assert.equal(en(x, f), true, `${x.id} ${f}`);
  }
});

test("the entries too long to answer aloud in English are few and known", () => {
  const skipped = allWords(lessons).filter((x) => !F.canAnswerInEnglish(x)).map((x) => `${x.id} ${x.en}`);
  console.log("not answerable aloud in English:", skipped);
  assert.ok(skipped.length <= 12, `${skipped.length} entries skipped`);
});
