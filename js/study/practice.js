/* Vocabulary study — the repeat-until-learned queue for the speaking practice. Pure (no DOM). Window.Study.Practice.

   Rules (see docs/vocab-study.md):
   - A word answered correctly on its FIRST try is cleared at once.
   - A missed word (wrong, skipped, given up) comes back after GAP other cards and must then be answered correctly
     NEED times in a row; every further miss starts that count again.
   - The same word is never asked twice in a row unless it is the only one left.
   The session is a plain object; every function takes it as the first argument.                              */
(function (root) {
  "use strict";
  const Study = (root.Study = root.Study || {});

  const GAP = 3;
  const NEED = 2;

  function shuffle(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** @param words [{id, …}]  @param opts { rand?: () => [0,1), gap?, need? } */
  function create(words, opts) {
    const o = opts || {};
    const rand = o.rand || Math.random;
    const cards = new Map(words.map((w) => [w.id, { word: w, misses: 0, streak: 0, attempts: 0, firstTry: null, done: false }]));
    const s = { cards, queue: shuffle(words.map((w) => w.id), rand), current: null, gap: o.gap || GAP, need: o.need || NEED, answered: 0, ended: false };
    pullNext(s);
    return s;
  }

  function pullNext(s) {
    s.current = s.queue.length ? s.queue.shift() : null;
  }

  const current = (s) => (s.current === null ? null : s.cards.get(s.current));
  const isDone = (s) => s.ended || s.current === null;
  const cleared = (s) => [...s.cards.values()].filter((c) => c.done).length;

  /**
   * Records the result for the card on screen and moves to the next one.
   * Returns { cleared } (was this card cleared by this answer?) or null when there is nothing to answer.
   */
  function answer(s, correct) {
    const card = current(s);
    if (!card || s.ended) return null;
    card.attempts += 1;
    s.answered += 1;
    if (card.firstTry === null) card.firstTry = !!correct;
    if (correct) {
      card.streak += 1;
      card.done = card.firstTry === true && card.attempts === 1 ? true : card.streak >= s.need;
    } else {
      card.misses += 1;
      card.streak = 0;
    }
    if (!card.done) s.queue.splice(Math.min(s.gap, s.queue.length), 0, card.word.id);
    pullNext(s);
    return { cleared: card.done };
  }

  /** Stops the session early; what was not cleared is reported as remaining. */
  function end(s) {
    s.ended = true;
    s.current = null;
  }

  function summary(s) {
    const all = [...s.cards.values()];
    const firstTry = all.filter((c) => c.firstTry === true).length;
    return {
      total: all.length,
      cleared: all.filter((c) => c.done).length,
      remaining: all.filter((c) => !c.done).length,
      attempted: all.filter((c) => c.attempts > 0).length,
      firstTry,
      answers: s.answered,
      hardest: all.filter((c) => c.misses > 0).sort((a, b) => b.misses - a.misses).map((c) => ({ word: c.word, misses: c.misses })),
    };
  }

  Study.Practice = { create, current, answer, end, isDone, cleared, summary, GAP, NEED };
  if (typeof module !== "undefined" && module.exports) module.exports = Study.Practice;
})(typeof window !== "undefined" ? window : globalThis);
