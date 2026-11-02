/* N5 track — question generators (pure). Window.N5.Questions.
   Every question is a plain object:
     { id, type, section, area, skill, kind, kanji:[…], prompt:{kind,…}, answerKind:"choice"|"typed"|"self",
       options?, answer?, accepted?, hints:[{id,label,…}], explain, media:null }
   `prompt.kind` and `section` are open-ended on purpose: a listening exercise is just another type with
   section "listening", prompt.kind "audio" and `media:{src,transcript}`; nothing else in the app needs restructuring. */
(function (root) {
  "use strict";
  const N5 = (root.N5 = root.N5 || {});
  const M = () => N5.Markup;
  const K = () => N5.Kana;

  /** Registry: what each question type measures. `area` feeds readiness; `skill` feeds the per-kanji mastery model. */
  const TYPES = {
    "kanji-meaning":      { section: "language-knowledge", area: "vocabulary",   skill: "meaning", kind: "choice" },
    "vocab-meaning":      { section: "language-knowledge", area: "vocabulary",   skill: "vocab",   kind: "choice" },
    "reading-in-context": { section: "language-knowledge", area: "kanjiReading", skill: "reading", kind: "choice" },
    "orthography":        { section: "language-knowledge", area: "orthography",  skill: "vocab",   kind: "choice" },
    "cloze":              { section: "language-knowledge", area: "vocabulary",   skill: "context", kind: "choice" },
    "passage":            { section: "language-knowledge", area: "comprehension", skill: "context", kind: "choice" },
    "recall-type":        { section: "language-knowledge", area: "kanjiReading", skill: "recall",  kind: "typed" },
    "recall-flip":        { section: "language-knowledge", area: "selfCheck",    skill: "recall",  kind: "self" },
  };

  /* ---------- randomness ---------- */
  function makeRng(seed) {   // mulberry32 — deterministic for tests
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const pickOne = (arr, rng) => arr[Math.floor(rng() * arr.length)];

  /* ---------- what the learner can be asked about right now ---------- */
  // ctx = { data, introduced:Set, rng, seen:{id:count} }
  function index(ctx) {
    if (ctx._ix) return ctx._ix;
    const d = ctx.data, intro = ctx.introduced;
    const ok = (ks) => ks.every((k) => intro.has(k));
    const vocab = Object.values(d.vocab).filter((v) => ok(v.kanji));
    const vocabIds = new Set(vocab.map((v) => v.id));
    const sentences = Object.values(d.sentences).filter((s) => ok(s.requires));
    const cloze = Object.values(d.cloze).filter((c) => ok(c.requires));
    const passages = Object.values(d.passages).filter((p) => ok(d.units.find((u) => u.id === p.unit).kanji));
    ctx._ix = { vocab, vocabIds, sentences, cloze, passages };
    return ctx._ix;
  }
  const seenCount = (ctx, id) => (ctx.seen && ctx.seen[id]) || 0;
  /** Prefers the content the learner has met least, then a random one — varied, never the same item twice in a row. */
  function pickFresh(items, idOf, ctx, exclude) {
    const pool = items.filter((x) => !(exclude && exclude.has(idOf(x))));
    if (!pool.length) return null;
    const min = Math.min(...pool.map((x) => seenCount(ctx, idOf(x))));
    return pickOne(pool.filter((x) => seenCount(ctx, idOf(x)) === min), ctx.rng);
  }

  /* ---------- distractors ---------- */
  function misreadings(v, ctx, want) {
    const d = ctx.data, rng = ctx.rng;
    const banned = new Set([...v.readings, ...(v.otherReadings || [])]);
    const toks = M().parse(v.ruby);
    const join = (swap) => toks.map((t, i) => (t.t === "ruby" ? (swap[i] != null ? swap[i] : t.rt) : t.s)).join("");
    const cands = new Set();
    const formsOf = (base) => { const k = d.kanji[base]; return k ? [...K().readingForms([...k.on, ...k.kun])] : []; };
    const idx = [];
    toks.forEach((t, i) => { if (t.t === "ruby" && [...t.base].length === 1 && d.kanji[t.base]) idx.push(i); });
    for (const i of idx) for (const f of formsOf(toks[i].base)) if (f !== toks[i].rt) cands.add(join({ [i]: f }));
    for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
      const fa = formsOf(toks[idx[a]].base).filter((f) => f !== toks[idx[a]].rt);
      const fb = formsOf(toks[idx[b]].base).filter((f) => f !== toks[idx[b]].rt);
      if (fa.length && fb.length) cands.add(join({ [idx[a]]: pickOne(fa, rng), [idx[b]]: pickOne(fb, rng) }));
    }
    let list = shuffle([...cands].filter((c) => !banned.has(c) && !c.endsWith("っ") && c.length >= 2), rng);
    const out = list.slice(0, want);
    if (out.length < want) {   // whole-word readings of other words the learner knows are still plausible wrong answers
      const pool = shuffle(Object.values(d.vocab).filter((o) => o.id !== v.id), rng)
        .sort((a, b) => Math.abs(a.readings[0].length - v.readings[0].length) - Math.abs(b.readings[0].length - v.readings[0].length));
      for (const o of pool) {
        const r = o.readings[0];
        if (out.length >= want) break;
        if (!banned.has(r) && !out.includes(r)) out.push(r);
      }
    }
    return out.length === want ? out : null;
  }

  /* ---------- builders (each returns a question or null) ---------- */
  const base = (type, id, kanji, extra) => Object.assign({ id, type, section: TYPES[type].section, area: TYPES[type].area, skill: TYPES[type].skill, kind: TYPES[type].kind, kanji, media: null, hints: [] }, extra);
  const englishHint = (text) => ({ id: "english", label: "Show English", text });
  const eliminateHint = { id: "eliminate", label: "Remove one wrong choice" };

  const BUILD = {
    "kanji-meaning"(k, ctx, ex) {
      const id = `km:${k}`;
      if (ex && ex.has(id)) return null;
      const d = ctx.data, me = d.kanji[k];
      const others = shuffle(Object.values(d.kanji).filter((x) => x.id !== k), ctx.rng);
      const intro = others.filter((x) => ctx.introduced.has(x.id)), rest = others.filter((x) => !ctx.introduced.has(x.id));
      const wrong = [...intro, ...rest].slice(0, 3).map((x) => x.meaning);
      const ixv = index(ctx).vocab.find((v) => v.kanji.includes(k));
      const hints = [eliminateHint];
      if (ixv) hints.unshift({ id: "example", label: "Show an example word", markup: ixv.ruby, en: ixv.en });
      return base("kanji-meaning", id, [k], {
        prompt: { kind: "kanji", glyph: k, ask: "What does this kanji mean?" }, answerKind: "choice",
        options: shuffle([me.meaning, ...wrong], ctx.rng), answer: me.meaning, hints,
        explain: `${k} means “${me.meaning}”. Readings: ${me.on.join("・")}${me.kun.length ? " / " + me.kun.map(K().displayReading).join("・") : ""}.`,
      });
    },

    "vocab-meaning"(k, ctx, ex) {
      const ix = index(ctx);
      const v = pickFresh(ix.vocab.filter((x) => x.kanji.includes(k)), (x) => `vm:${x.id}`, ctx, ex);
      if (!v) return null;
      const lower = (s) => s.toLowerCase();
      const pool = shuffle(ix.vocab.filter((x) => x.id !== v.id && lower(x.en) !== lower(v.en)), ctx.rng).sort((a, b) => (b.pos === v.pos) - (a.pos === v.pos));
      let wrong = pool.slice(0, 3).map((x) => x.en);
      if (wrong.length < 3) wrong = shuffle(Object.values(ctx.data.vocab).filter((x) => x.id !== v.id), ctx.rng).slice(0, 3).map((x) => x.en);
      return base("vocab-meaning", `vm:${v.id}`, v.kanji, {
        prompt: { kind: "vocab", markup: v.ruby, ask: "What does this word mean?" }, answerKind: "choice",
        options: shuffle([v.en, ...wrong], ctx.rng), answer: v.en,
        hints: [{ id: "readings", label: "Show reading" }, eliminateHint],
        explain: `${v.ja} (${v.readings[0]}) means “${v.en}”.`,
      });
    },

    "reading-in-context"(k, ctx, ex) {
      const ix = index(ctx);
      const cands = [];
      for (const s of ix.sentences) for (const fid of s.focus) {
        const f = ctx.data.vocab[fid];
        if (f && f.kanji.includes(k) && ix.vocabIds.has(fid)) cands.push({ s, f });
      }
      const c = pickFresh(cands, (x) => `ric:${x.s.id}:${x.f.id}`, ctx, ex);
      if (!c) return null;
      const wrong = misreadings(c.f, ctx, 3);
      if (!wrong) return null;
      const answer = M().reading(c.f.ruby);
      return base("reading-in-context", `ric:${c.s.id}:${c.f.id}`, c.f.kanji, {
        prompt: { kind: "sentence", markup: c.s.ja, mark: c.f.ruby, markAs: "underline", ask: "How do you read the underlined word?" }, answerKind: "choice",
        options: shuffle([answer, ...wrong], ctx.rng), answer, hints: [englishHint(c.s.en), { id: "first-kana", label: "Show the first kana", text: answer[0] + "…" }],
        explain: `${c.f.ja} is read ${answer} (“${c.f.en}”). ${c.s.ja ? M().plain(c.s.ja) + " — " + c.s.en : ""}`,
      });
    },

    "orthography"(k, ctx, ex) {
      const ix = index(ctx);
      const cands = [];
      for (const s of ix.sentences) for (const fid of s.focus) {
        const f = ctx.data.vocab[fid];
        if (f && f.kanji.includes(k) && ix.vocabIds.has(fid) && f.lookalikes.length >= 3) cands.push({ s, f });
      }
      const c = pickFresh(cands, (x) => `orth:${x.s.id}:${x.f.id}`, ctx, ex);
      if (!c) return null;
      const wrong = shuffle(c.f.lookalikes, ctx.rng).slice(0, 3);
      return base("orthography", `orth:${c.s.id}:${c.f.id}`, c.f.kanji, {
        prompt: { kind: "sentence", markup: c.s.ja, mark: c.f.ruby, markAs: "kana", kana: M().reading(c.f.ruby), ask: "Which kanji writing is correct for the underlined word?" }, answerKind: "choice",
        options: shuffle([c.f.ja, ...wrong], ctx.rng), answer: c.f.ja, hints: [englishHint(c.s.en), eliminateHint],
        explain: `${M().reading(c.f.ruby)} is written ${c.f.ja} (“${c.f.en}”).`,
      });
    },

    "cloze"(k, ctx, ex) {
      const ix = index(ctx);
      const d = ctx.data;
      const cs = ix.cloze.filter((c) => d.vocab[c.blank].kanji.includes(k));
      const c = pickFresh(cs, (x) => `cloze:${x.id}`, ctx, ex);
      if (!c) return null;
      const s = d.sentences[c.sentence], v = d.vocab[c.blank];
      return base("cloze", `cloze:${c.id}`, v.kanji, {
        prompt: { kind: "sentence", markup: s.ja, mark: v.ruby, markAs: "blank", ask: "Choose the word that fits the blank." }, answerKind: "choice",
        options: shuffle([v.ja, ...c.options.map((o) => d.vocab[o].ja)], ctx.rng), answer: v.ja,
        hints: [{ id: "readings", label: "Show readings" }, englishHint(s.en), eliminateHint], explain: c.explain,
      });
    },

    "passage"(k, ctx, ex) {
      const ix = index(ctx);
      const qs = [];
      for (const p of ix.passages) for (const q of p.questions) if (q.kanji.includes(k)) qs.push({ p, q });
      const c = pickFresh(qs, (x) => `pq:${x.q.id}`, ctx, ex);
      return c ? passageQuestion(c.p, c.q, ctx) : null;
    },

    "recall-type"(k, ctx, ex) {
      const ix = index(ctx);
      const v = pickFresh(ix.vocab.filter((x) => x.kanji.includes(k)), (x) => `rt:${x.id}`, ctx, ex);
      if (!v) return null;
      return base("recall-type", `rt:${v.id}`, v.kanji, {
        prompt: { kind: "recall-vocab", ja: v.ja, en: v.en, ask: "Type the reading in hiragana." }, answerKind: "typed",
        accepted: v.readings, answer: v.readings[0],
        hints: [{ id: "first-kana", label: "Show the first kana", text: v.readings[0][0] + "…" }, { id: "reveal", label: "Show the reading", text: v.readings[0], markup: v.ruby }],
        explain: `${v.ja} is read ${v.readings.join(" / ")} (“${v.en}”).`,
      });
    },

    "recall-flip"(k, ctx, ex) {
      const id = `rf:${k}`;
      if (ex && ex.has(id)) return null;
      const me = ctx.data.kanji[k];
      const ws = index(ctx).vocab.filter((v) => v.kanji.includes(k)).slice(0, 3);
      return base("recall-flip", id, [k], {
        prompt: { kind: "kanji", glyph: k, ask: "Recall the meaning and the readings, then check yourself." }, answerKind: "self",
        back: { meaning: me.meaning, on: me.on, kun: me.kun.map(K().displayReading), note: me.note || "", words: ws.map((v) => ({ markup: v.ruby, en: v.en })) },
        explain: "",
      });
    },
  };

  /** A reading-comprehension question from the authored bank, with its options shuffled. */
  function passageQuestion(p, q, ctx) {
    const answer = q.options[q.answer];
    return base("passage", `pq:${q.id}`, q.kanji, {
      target: q.kanji[0],
      prompt: { kind: "text", markup: q.q, passage: p.unit, ask: "" }, answerKind: "choice", optionsAreMarkup: true,
      options: shuffle(q.options, ctx.rng), answer, hints: [{ id: "readings", label: "Show readings" }, englishHint(q.qEn), eliminateHint], explain: q.explain,
    });
  }

  /* ---------- public ---------- */
  function build(type, kanji, ctx, exclude) {
    const fn = BUILD[type];
    const q = fn ? fn(kanji, ctx, exclude) : null;
    if (q) q.target = kanji;   // the kanji this question was requested for (q.kanji lists everything it credits)
    return q;
  }

  /** Which question types can be built for this kanji with what the learner has met so far? */
  function available(k, ctx) {
    const ix = index(ctx), d = ctx.data;
    const has = {
      "kanji-meaning": true, "recall-flip": true,
      "vocab-meaning": ix.vocab.some((v) => v.kanji.includes(k)) && ix.vocab.length >= 4,
      "recall-type": ix.vocab.some((v) => v.kanji.includes(k)),
      "reading-in-context": ix.sentences.some((s) => s.focus.some((f) => d.vocab[f].kanji.includes(k) && ix.vocabIds.has(f))),
      "orthography": ix.sentences.some((s) => s.focus.some((f) => d.vocab[f].kanji.includes(k) && ix.vocabIds.has(f) && d.vocab[f].lookalikes.length >= 3)),
      "cloze": ix.cloze.some((c) => d.vocab[c.blank].kanji.includes(k)),
      "passage": ix.passages.some((p) => p.questions.some((q) => q.kanji.includes(k))),
    };
    return Object.keys(has).filter((t) => has[t]);
  }

  /**
   * Picks a question for `k`, weighting toward the skill the learner is weakest in and away from types just used,
   * so reviews do not become predictable.
   *   o.allow    restrict to these types      o.skills  the kanji record's skills (0..1)
   *   o.avoid    Set of recently used types   o.exclude Set of content ids already asked in this step
   */
  function choose(k, ctx, o) {
    o = o || {};
    let types = available(k, ctx);
    if (o.allow) types = types.filter((t) => o.allow.includes(t));
    const skills = o.skills || {};
    const weighted = types.map((t) => {
      let w = 1 + 3 * (1 - (skills[TYPES[t].skill] || 0));
      if (o.avoid && o.avoid.has(t)) w *= 0.2;
      return { t, w };
    });
    while (weighted.length) {
      const total = weighted.reduce((a, x) => a + x.w, 0);
      let r = ctx.rng() * total, i = 0;
      for (; i < weighted.length - 1; i++) { r -= weighted[i].w; if (r <= 0) break; }
      const q = build(weighted[i].t, k, ctx, o.exclude);
      if (q) return q;
      weighted.splice(i, 1);
    }
    return null;
  }

  N5.Questions = { TYPES, makeRng, shuffle, available, build, choose, passageQuestion, index, misreadings };
  if (typeof module !== "undefined" && module.exports) module.exports = N5.Questions;
})(typeof window !== "undefined" ? window : globalThis);
