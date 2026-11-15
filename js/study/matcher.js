/* Vocabulary study — judges an answer (spoken or typed) against a word. Pure (no DOM). Window.Study.Matcher.
   A recogniser returns several candidate transcripts; the answer is right when ANY candidate matches.
   Japanese is judged exactly (a wrong reading is never forgiven). English tolerates one letter of recogniser noise
   in words of five letters or more, nothing else. */
(function (root) {
  "use strict";
  const Study = (root.Study = root.Study || {});
  const F = () => root.Study.Forms;

  const FUZZY_MIN_LENGTH = 5;

  function distanceAtMostOne(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);   // one substitution
    const [long, short] = a.length > b.length ? [a, b] : [b, a];
    return long.slice(i + 1) === short.slice(i);                           // one insertion
  }

  const clean = (candidates) => (Array.isArray(candidates) ? candidates : [candidates]).filter((c) => typeof c === "string" && c.trim());

  /**
   * Judges a Japanese answer. `words` are all words that are acceptable for this prompt (the word itself plus any word
   * in the lesson with the identical meaning, e.g. 主人 / おっと both mean "My husband").
   * Returns { ok, heard } where `heard` is the best candidate to show the learner.
   */
  function judgeJapanese(words, candidates) {
    const heard = clean(candidates);
    const accepted = new Set((Array.isArray(words) ? words : [words]).flatMap(F().japaneseForms));
    const norm = F().normalizeJapanese;
    const hit = heard.find((c) => accepted.has(norm(c)));
    return { ok: hit !== undefined, heard: hit !== undefined ? hit : heard[0] || "" };
  }

  /** Judges an English meaning. */
  function judgeEnglish(word, candidates) {
    const heard = clean(candidates);
    const forms = F().englishForms(word);
    const hit = heard.find((c) => {
      const n = F().normalizeEnglish(c);
      return n && forms.some((f) => f === n || (f.length >= FUZZY_MIN_LENGTH && distanceAtMostOne(f, n)));
    });
    return { ok: hit !== undefined, heard: hit !== undefined ? hit : heard[0] || "" };
  }

  /** The words that are an equally right answer to `word`'s English prompt (same meaning, same lesson). */
  const sameMeaning = (word, lessonWords) => {
    const key = F().normalizeEnglish(word.en);
    return lessonWords.filter((w) => w === word || F().normalizeEnglish(w.en) === key);
  };

  Study.Matcher = { judgeJapanese, judgeEnglish, sameMeaning, distanceAtMostOne };
  if (typeof module !== "undefined" && module.exports) module.exports = Study.Matcher;
})(typeof window !== "undefined" ? window : globalThis);
