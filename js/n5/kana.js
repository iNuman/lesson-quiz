/* N5 track — kana utilities: typed-answer normalisation, romaji → hiragana, and reading forms.
   Pure (no DOM). Loaded in the browser as window.N5.Kana and in tests through a vm sandbox. */
(function (root) {
  "use strict";
  const N5 = (root.N5 = root.N5 || {});

  const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

  /* ---- romaji → hiragana (Hepburn plus the common Nihon/Kunrei spellings) ---- */
  const T = {};
  const add = (romaji, kana) => String(romaji).split(" ").forEach((r) => { T[r] = kana; });
  add("a", "あ"); add("i", "い"); add("u", "う"); add("e", "え"); add("o", "お");
  const rows = {
    k: "か き く け こ", s: "さ し す せ そ", t: "た ち つ て と", n: "な に ぬ ね の", h: "は ひ ふ へ ほ", m: "ま み む め も",
    r: "ら り る れ ろ", g: "が ぎ ぐ げ ご", z: "ざ じ ず ぜ ぞ", d: "だ ぢ づ で ど", b: "ば び ぶ べ ぼ", p: "ぱ ぴ ぷ ぺ ぽ",
  };
  for (const [c, ks] of Object.entries(rows)) ks.split(" ").forEach((k, i) => { T[c + "aiueo"[i]] = k; });
  add("shi si", "し"); add("chi ti", "ち"); add("tsu tu", "つ"); add("fu hu", "ふ"); add("ji zi", "じ"); add("di", "ぢ"); add("du", "づ");
  add("ya", "や"); add("yu", "ゆ"); add("yo", "よ"); add("wa", "わ"); add("wo", "を");
  add("fa", "ふぁ"); add("fi", "ふぃ"); add("fe", "ふぇ"); add("fo", "ふぉ");
  add("je", "じぇ"); add("che", "ちぇ"); add("she", "しぇ"); add("thi", "てぃ"); add("dhi", "でぃ");
  const youon = { ky: "き", sh: "し", sy: "し", ch: "ち", ty: "ち", ny: "に", hy: "ひ", my: "み", ry: "り", gy: "ぎ", by: "び", py: "ぴ", j: "じ", jy: "じ", zy: "じ", dy: "ぢ" };
  for (const [c, base] of Object.entries(youon)) {
    for (const [v, small] of [["a", "ゃ"], ["u", "ゅ"], ["o", "ょ"]]) {
      if (c === "j" || c === "jy" || c === "zy") T[c + v] = "じ" + small;
      else if (c === "dy") T[c + v] = "ぢ" + small;
      else T[c + v] = base + small;
    }
  }
  const isVowel = (c) => "aiueo".includes(c);

  /** Converts the Latin letters in `s` to hiragana. Anything it cannot convert is left as it is. */
  function romajiToHiragana(s) {
    let out = "";
    for (let i = 0; i < s.length;) {
      const c = s[i];
      if (!/[a-z']/.test(c)) { out += c; i++; continue; }
      if (c === "'") { out += c; i++; continue; }
      const nx = s[i + 1];
      if (c === "n") {
        if (nx === "'") { out += "ん"; i += 2; continue; }
        if (nx === "y" && T[s.slice(i, i + 3)]) { out += T[s.slice(i, i + 3)]; i += 3; continue; }   // nya, nyu, nyo
        if (nx && isVowel(nx)) { out += T["n" + nx]; i += 2; continue; }
        if (nx === "n") { const after = s[i + 2]; out += "ん"; i += after && (isVowel(after) || after === "y") ? 1 : 2; continue; }
        out += "ん"; i++; continue;   // n before a consonant, or at the end
      }
      if (c === nx && !isVowel(c) && /[a-z]/.test(c)) { out += "っ"; i++; continue; }              // kk, ss, tt, pp …
      if (c === "t" && s.startsWith("tch", i)) { out += "っ"; i++; continue; }                     // matcha → まっちゃ
      let hit = null;
      for (const len of [3, 2, 1]) { const k = s.slice(i, i + len); if (T[k]) { hit = [k, T[k]]; break; } }
      if (hit) { out += hit[1]; i += hit[0].length; } else { out += c; i++; }
    }
    return out;
  }

  /**
   * Normalises a typed answer so that the same reading always compares equal:
   * full-width → ASCII (NFKC), whitespace/punctuation removed, romaji → hiragana, katakana → hiragana.
   * It never changes WHICH reading was typed — では/にっぽん/にほん stay different.
   */
  function normalize(input) {
    let s = String(input == null ? "" : input).normalize("NFKC").toLowerCase();
    s = s.replace(/[\s　・､。、，．,.]+/g, "");
    s = romajiToHiragana(s);
    return kataToHira(s);
  }
  /** True when every character is hiragana (or the long-vowel mark) — i.e. it is a typed reading. */
  const isKanaOnly = (s) => /^[ぁ-ゖー]+$/.test(s);

  /**
   * Checks a typed reading against the accepted readings.
   * reason: "empty" | "not-kana" (cannot be judged — do not count as an attempt) | "wrong" | null (correct)
   */
  function checkTyped(input, accepted) {
    const n = normalize(input);
    if (!n) return { ok: false, valid: false, reason: "empty", normalized: n };
    if (!isKanaOnly(n)) return { ok: false, valid: false, reason: "not-kana", normalized: n };
    const ok = accepted.some((a) => normalize(a) === n);
    return { ok, valid: true, reason: ok ? null : "wrong", normalized: n };
  }

  /* ---- reading forms of a kanji (used for plausible-but-wrong reading choices) ---- */
  const VOICE = { か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご", さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ", た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど", は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ" };
  /** Hiragana forms a dictionary reading can take (stem, with okurigana, voiced, geminated). */
  function readingForms(dict) {
    const forms = new Set();
    for (const raw of [].concat(dict)) {
      const r = kataToHira(raw.replace(/^-|-$/g, ""));
      for (const f of [r.split(".")[0], r.replace(".", "")]) {
        if (!f) continue;
        forms.add(f);
        if (VOICE[f[0]]) forms.add(VOICE[f[0]] + f.slice(1));
        if (f.length >= 2) forms.add(f.slice(0, -1) + "っ");
      }
    }
    return forms;
  }
  /** The reading shown above a lone kanji: its first kun'yomi, else its first on'yomi, in hiragana. */
  function primaryReading(k) {
    const r = (k.kun && k.kun[0]) || (k.on && k.on[0]) || "";
    return kataToHira(r.replace(/^-|-$/g, "").split(".")[0]);
  }
  /** Display form of a dictionary reading: 'ひと.つ' → 'ひと・つ', '-び' → '〜び'. */
  const displayReading = (r) => r.replace(/^-/, "〜").replace(/-$/, "〜").replace(".", "・");

  N5.Kana = { kataToHira, romajiToHiragana, normalize, isKanaOnly, checkTyped, readingForms, primaryReading, displayReading };
  if (typeof module !== "undefined" && module.exports) module.exports = N5.Kana;
})(typeof window !== "undefined" ? window : globalThis);
