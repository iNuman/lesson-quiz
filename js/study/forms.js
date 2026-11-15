/* Vocabulary study — the forms a word can be said or typed in. Pure (no DOM). Window.Study.Forms.
   Needs window.N5.Kana (js/n5/kana.js) for kana normalisation.

   A word entry looks like { ja, romaji, en, ruby?, alt? } (see data/lessons.js):
     ja     "急ぎます・急ぐ", "(お)酒", "ひつよう(な)", "～ぐらい"      ・ separates variants, (…) is optional, ～ is a placeholder
     ruby   [[text, reading], …]  present when ja contains kanji
     alt    other accepted written forms, e.g. ["窓"] for まど            */
(function (root) {
  "use strict";
  const Study = (root.Study = root.Study || {});

  const kana = () => root.N5.Kana;
  const uniq = (list) => [...new Set(list)];

  /* ---------- Japanese ---------- */

  const PAREN = /[(（]([^()（）]*)[)）]/;
  // A "(…)" holding a ～ is a grammar complement ("(薬を～)") and is dropped; any other "(…)" is optional.
  function expandOptional(text) {
    const m = PAREN.exec(text);
    if (!m) return [text];
    const head = text.slice(0, m.index), tail = text.slice(m.index + m[0].length);
    const inner = /[～~]/.test(m[1]) ? [""] : [m[1], ""];
    return inner.flatMap((x) => expandOptional(head + x + tail));
  }
  const stripMarks = (s) => s.replace(/[～~―\-\s。、！？!?「」]/g, "");

  /** "急ぎます・急ぐ" → ["急ぎます", "急ぐ"]; "(お)酒" → ["酒", "お酒"]; "飲む(薬を～)" → ["飲む"]. */
  const japaneseVariants = (text) =>
    String(text || "").split("・").flatMap(expandOptional).map(stripMarks).filter(Boolean);

  const readingOf = (w) => (w.ruby ? w.ruby.map(([t, r]) => r || t).join("") : w.ja);

  // Katakana words write long vowels with ー but romaji (and some recognisers) spell them out: コーヒー = こおひい = koohii.
  // Both sides of a comparison are brought to the spelled-out form.
  const VOWEL_OF = {};
  [["あ", "ぁあかがさざただなはばぱまゃやらゎわ"], ["い", "ぃいきぎしじちぢにひびぴみり"], ["う", "ぅうくぐすずっつづぬふぶぷむゅゆるゔ"], ["え", "ぇえけげせぜてでねへべぺめれ"], ["お", "ぉおこごそぞとどのほぼぽもょよろを"]]
    .forEach(([v, chars]) => [...chars].forEach((c) => { VOWEL_OF[c] = v; }));
  const spellOutLongVowels = (s) => { let out = ""; for (const c of s) out += c === "ー" ? VOWEL_OF[out[out.length - 1]] || c : c; return out; };
  /** Brings a Japanese answer (any script, width or romaji) to one comparable spelling. */
  const normalizeJapanese = (s) => spellOutLongVowels(kana().normalize(s));

  /* A speech recogniser writes a word however it likes: 甘い物, 甘いもの, あまい物 or あまいもの are all "sweets". So every
     spelling of a word is accepted in every kanji/kana mix: each kanji run may stand as itself or as its reading. */
  // digits count as "kanji" here: they have a reading too (2 = に)
  const KANJI_RUN = /[\u3400-\u9FFF々〆0-9０-９]+|[^\u3400-\u9FFF々〆0-9０-９]+/g;
  const isKanji = (s) => /^[\u3400-\u9FFF々〆0-9０-９]/.test(s);
  const MAX_MIXED_RUNS = 6;                  // 2^6 = 64 spellings at most per form

  // [[kanji, reading] or [kana, ""] …] → every spelling with each kanji run either kept or replaced by its reading
  function mixSegments(segments) {
    const runs = segments.filter(([, r]) => r).length;
    if (runs === 0 || runs > MAX_MIXED_RUNS) return [segments.map(([text, r]) => r || text).join(""), segments.map(([text]) => text).join("")];
    let out = [""];
    for (const [text, r] of segments) out = out.flatMap((s) => (r ? [s + text, s + r] : [s + text]));
    return out;
  }

  /** Splits a written form such as 甘い物 into [[甘, あま], [い, ""], [物, もの]] using a known reading (あまいもの); null if they do not line up. */
  function alignReading(written, reading) {
    const toHira = kana().kataToHira;
    const tokens = written.match(KANJI_RUN) || [];
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = tokens.map((tk) => (isKanji(tk) ? "(.+?)" : escape(toHira(tk)))).join("");
    const m = new RegExp("^" + pattern + "$").exec(toHira(reading));
    if (!m) return null;
    let k = 0;
    return tokens.map((tk) => (isKanji(tk) ? [tk, m[++k]] : [tk, ""]));
  }

  /** Every normalised string that counts as the right Japanese answer for the word. */
  function japaneseForms(w) {
    const readings = japaneseVariants(readingOf(w));
    const written = [...japaneseVariants(w.ja), ...readings];
    // 1. the word's own kanji / kana segments, mixed
    if (w.ruby) {
      const joined = w.ruby.map(([text]) => text).join("");
      if (joined === w.ja) written.push(...mixSegments(w.ruby).flatMap(japaneseVariants));
    }
    // 2. other written forms (窓 for まど), mixed using the word's reading to find each kanji run's sound
    for (const alt of w.alt || []) {
      for (const variant of japaneseVariants(alt)) {
        written.push(variant);
        const aligned = readings.map((r) => alignReading(variant, r)).find(Boolean);
        if (aligned) written.push(...mixSegments(aligned));
      }
    }
    return uniq(written.map(normalizeJapanese).filter(Boolean));
  }

  /** Kana for the assistant to say: the first variant, optional parts left out. Kana is read reliably, kanji is not. */
  function spokenJapanese(w) {
    const first = readingOf(w).split("・")[0];
    const plain = stripMarks(first.replace(/[(（][^()（）]*[)）]/g, ""));
    return plain || stripMarks(first);
  }

  /* ---------- English ---------- */

  // Bracketed notes about usage are not part of the meaning; short ones like "(I'm)" or "(a bath)" are optional words.
  const NOTE = /\b(used|respectful|humble|polite|casual|informal|expression|name|equivalent|often)\b/i;
  const keepsMeaning = (inner) => inner.trim().split(/\s+/).length <= 2 && !NOTE.test(inner);
  function expandEnglish(text) {
    const m = PAREN.exec(text);
    if (!m) return [text];
    const head = text.slice(0, m.index), tail = text.slice(m.index + m[0].length);
    const inner = keepsMeaning(m[1]) ? [m[1], ""] : [""];
    return inner.flatMap((x) => expandEnglish(head + " " + x + " " + tail));
  }
  const normalizeEnglish = (s) =>
    String(s).normalize("NFKC").toLowerCase()
      .replace(/[’‘]/g, "'").replace(/'/g, "")                  // I'm → im, child's → childs
      .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()
      .replace(/^(to|a|an|the) /, "");
  const JUNK = new Set(["", "etc", "s"]);

  /** Every normalised string that counts as the right English answer ("Early, quickly" → "early" and "quickly"). */
  function englishForms(w) {
    const parts = expandEnglish(w.en).flatMap((t) => t.split(/[,;/]/));
    const forms = parts.map(normalizeEnglish).filter((f) => !JUNK.has(f));
    return uniq(forms);
  }

  /** Text for the assistant to say: notes dropped, short optional words kept, placeholder marks removed. */
  function spokenEnglish(w) {
    const text = w.en.replace(/[(（]([^()（）]*)[)）]/g, (all, inner) => (keepsMeaning(inner) ? inner : ""))
      .replace(/[~～―]/g, " ").replace(/(^|\s)-(?=\w)/g, " ").replace(/\s+/g, " ").trim();
    return text.replace(/\s+([,.;!?])/g, "$1") || w.en;
  }

  const MAX_SPOKEN_WORDS = 5;
  /** True when the meaning is short enough to be answered aloud ("Suffix often added to a child's name" is not). */
  const canAnswerInEnglish = (w) => englishForms(w).some((f) => f.split(" ").length <= MAX_SPOKEN_WORDS);

  Study.Forms = { japaneseVariants, normalizeJapanese, readingOf, japaneseForms, spokenJapanese, englishForms, normalizeEnglish, spokenEnglish, canAnswerInEnglish };
  if (typeof module !== "undefined" && module.exports) module.exports = Study.Forms;
})(typeof window !== "undefined" ? window : globalThis);
