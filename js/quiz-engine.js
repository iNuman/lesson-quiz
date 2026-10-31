/* Pure quiz logic — no DOM. One session object is the single source of truth for a lesson attempt.
   status: "question" | "correct_feedback" | "wrong_answer_feedback" | "completed" */
(function (root) {
  "use strict";

  function randInt(n) {
    if (root.crypto && root.crypto.getRandomValues) {
      const a = new Uint32Array(1);
      root.crypto.getRandomValues(a);
      return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Both the order of the questions and the positions of the four options are shuffled for every
  // attempt, so the answers cannot be memorised by position or sequence.
  function buildQuestions(words) {
    return shuffle(words).map((w) => ({
      wordId: w.id,
      correct: w.en,
      options: shuffle([w.en, ...w.distractors.map((k) => words[k - 1].en)]),
    }));
  }

  function createSession(lesson) {
    return {
      lesson: lesson.lesson,
      words: lesson.words,
      status: "question",
      questions: buildQuestions(lesson.words),
      index: 0,
      score: 0,
      answered: new Set(),
      wrong: [],            // one record per incorrectly answered question
      lastSelected: null,
    };
  }

  function currentWord(s) {
    return s.words.find((w) => w.id === s.questions[s.index].wordId);
  }

  // Returns "correct" | "wrong" | "ignored"
  function choose(s, option) {
    if (s.status !== "question") return "ignored";
    if (s.answered.has(s.index)) return "ignored";
    const q = s.questions[s.index];
    if (!q.options.includes(option)) return "ignored";
    s.answered.add(s.index);
    s.lastSelected = option;
    if (option === q.correct) {
      s.score += 1;
      s.status = "correct_feedback";
      return "correct";
    }
    const w = currentWord(s);
    s.wrong.push({ id: w.id, ja: w.ja, romaji: w.romaji, correct: q.correct, selected: option });
    s.status = "wrong_answer_feedback";
    return "wrong";
  }

  // The countdown ran out: counts as a wrong answer with no selection. Returns "wrong" | "ignored".
  function expire(s) {
    if (s.status !== "question" || s.answered.has(s.index)) return "ignored";
    const q = s.questions[s.index];
    const w = currentWord(s);
    s.answered.add(s.index);
    s.lastSelected = null;
    s.wrong.push({ id: w.id, ja: w.ja, romaji: w.romaji, correct: q.correct, selected: "Time's up" });
    s.status = "wrong_answer_feedback";
    return "wrong";
  }

  // Moves on exactly once, from either feedback state.
  function advance(s) {
    if (s.status !== "correct_feedback" && s.status !== "wrong_answer_feedback") return false;
    s.lastSelected = null;
    if (s.index >= s.words.length - 1) s.status = "completed";
    else { s.index += 1; s.status = "question"; }
    return true;
  }

  const api = { shuffle, buildQuestions, createSession, currentWord, choose, expire, advance };
  root.QuizEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
