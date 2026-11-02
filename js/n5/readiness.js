/* N5 track — readiness model (pure). Window.N5.Readiness.
   Readiness is NEVER derived from lessons completed or kanji counts. It is demonstrated performance, per exam area,
   from the answer log: unhinted correct = 1, hinted correct = 0.5, wrong = 0, using only DISTINCT questions (repeating
   the same familiar question cannot raise it) and only recent evidence. Self-ratings are ignored.
   Areas that this release cannot test report "unavailable", and no overall figure is produced until every area and
   the exam sections (listening, mock exams) are supported — so a full-readiness claim is impossible by construction. */
(function (root) {
  "use strict";
  const N5 = (root.N5 = root.N5 || {});

  const AREAS = [
    { id: "vocabulary",    label: "Vocabulary",        needs: 12 },
    { id: "kanjiReading",  label: "Kanji reading",     needs: 12 },
    { id: "orthography",   label: "Orthography",       needs: 8 },
    { id: "grammar",       label: "Grammar",           needs: 12, requires: "grammarLessons" },
    { id: "comprehension", label: "Unfamiliar reading", needs: 8, requires: "unfamiliarPassages", unfamiliarOnly: true },
  ];
  const WINDOW = 80;   // only the most recent evidence counts, so old knowledge that faded does not inflate the score

  function compute(state, capabilities) {
    capabilities = capabilities || {};
    const entries = state.log.filter((e) => e.t !== "recall-flip");
    const areas = AREAS.map((a) => {
      if (a.requires && !capabilities[a.requires]) return { id: a.id, label: a.label, status: "unavailable", score: null, items: 0, needs: a.needs };
      const mine = entries.filter((e) => e.a === a.id || (a.id === "comprehension" && e.a === "comprehension"));
      // One vote per distinct question: its most recent result.
      const latest = new Map();
      for (const e of mine) latest.set(e.q, e);
      let items = [...latest.values()].slice(-WINDOW);
      if (a.unfamiliarOnly) items = items.filter((e) => e.f);
      if (items.length < a.needs) return { id: a.id, label: a.label, status: "building", score: null, items: items.length, needs: a.needs };
      const score = items.reduce((s, e) => s + e.c, 0) / items.length;
      return { id: a.id, label: a.label, status: "measured", score, items: items.length, needs: a.needs };
    });
    const complete = areas.every((a) => a.status === "measured") && !!capabilities.listening && !!capabilities.mockExam;
    return {
      areas,
      overall: complete ? Math.min(...areas.map((a) => a.score)) : null,   // the weakest area limits readiness
      claim: complete ? "measured" : "not-claimed",
      note: complete ? "" : "Listening and timed mock exams are not part of this release, so JLPT N5 readiness is not claimed. The figures below show demonstrated performance in each area that can be measured.",
    };
  }

  N5.Readiness = { AREAS, WINDOW, compute };
  if (typeof module !== "undefined" && module.exports) module.exports = N5.Readiness;
})(typeof window !== "undefined" ? window : globalThis);
