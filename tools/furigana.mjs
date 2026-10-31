// Builds furigana ("ruby") segments for a word from its Japanese text and its romaji.
//   makeRuby("病気", "byōki")  →  [["病気", "びょうき"]]
//   makeRuby("急ぎます", "isogimasu") → [["急", "いそ"], ["ぎます", ""]]
// Returns null when the kana in the word cannot be lined up with the romaji (the build reports those).

const BASE = {
  a: "あ", i: "い", u: "う", e: "え", o: "お",
  ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ", ga: "が", gi: "ぎ", gu: "ぐ", ge: "げ", go: "ご",
  sa: "さ", shi: "し", si: "し", su: "す", se: "せ", so: "そ", za: "ざ", ji: "じ", zi: "じ", zu: "ず", ze: "ぜ", zo: "ぞ",
  ta: "た", chi: "ち", ti: "ち", tsu: "つ", tu: "つ", te: "て", to: "と", da: "だ", di: "ぢ", du: "づ", de: "で", do: "ど",
  na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の", ha: "は", hi: "ひ", fu: "ふ", hu: "ふ", he: "へ", ho: "ほ",
  ba: "ば", bi: "び", bu: "ぶ", be: "べ", bo: "ぼ", pa: "ぱ", pi: "ぴ", pu: "ぷ", pe: "ぺ", po: "ぽ",
  ma: "ま", mi: "み", mu: "む", me: "め", mo: "も", ya: "や", yu: "ゆ", yo: "よ",
  ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ", wa: "わ", wo: "を",
  kya: "きゃ", kyu: "きゅ", kyo: "きょ", gya: "ぎゃ", gyu: "ぎゅ", gyo: "ぎょ",
  sha: "しゃ", shu: "しゅ", sho: "しょ", ja: "じゃ", ju: "じゅ", jo: "じょ", jya: "じゃ", jyu: "じゅ", jyo: "じょ",
  cha: "ちゃ", chu: "ちゅ", cho: "ちょ", nya: "にゃ", nyu: "にゅ", nyo: "にょ", hya: "ひゃ", hyu: "ひゅ", hyo: "ひょ",
  bya: "びゃ", byu: "びゅ", byo: "びょ", pya: "ぴゃ", pyu: "ぴゅ", pyo: "ぴょ", mya: "みゃ", myu: "みゅ", myo: "みょ",
  rya: "りゃ", ryu: "りゅ", ryo: "りょ",
  fa: "ふぁ", fi: "ふぃ", fe: "ふぇ", fo: "ふぉ", she: "しぇ", che: "ちぇ", je: "じぇ", ti2: "てぃ", di2: "でぃ", wi: "うぃ", we: "うぇ", vu: "ゔ",
};
const MACRON = { ā: "aa", ī: "ii", ū: "uu", ē: "ee" };
const LONG_O = "ー";   // placeholder unit: the "u"/"o" that follows an "o" in "ō"
const VOWELS = "あいうえお";

// One word of romaji (no separators) → array of kana units.
function kanaOfChunk(chunk) {
  let s = chunk.toLowerCase().replace(/[āīūē]/g, (c) => MACRON[c]).replace(/ō/g, "o" + LONG_O);
  const out = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === LONG_O) { out.push(LONG_O); i++; continue; }
    // doubled consonant → small っ  (also "tch" → っち)
    if (/[kstpcgzdbfhjmr]/.test(s[i]) && s[i] === s[i + 1]) { out.push("っ"); i++; continue; }
    if (s.startsWith("tch", i)) { out.push("っ"); i++; continue; }
    // ん: "n" not followed by a vowel/y, or "n'" form
    if (s[i] === "n" && (i + 1 === s.length || !/[aiueoy]/.test(s[i + 1]))) { out.push("ん"); i++; continue; }
    let hit = null;
    for (const len of [3, 2, 1]) {
      const k = s.slice(i, i + len);
      if (BASE[k]) { hit = [k, BASE[k]]; break; }
    }
    if (!hit) return null;
    for (const ch of hit[1]) out.push(ch);
    i += hit[0].length;
  }
  return out;
}

function readingUnits(romaji) {
  const chunks = romaji.toLowerCase().split(/[^A-Za-zāīūēō]+/).filter(Boolean);
  const units = [];
  for (const c of chunks) {
    const k = kanaOfChunk(c);
    if (!k) return null;
    units.push(...k);
  }
  return units;
}

const toHira = (c) => (c >= "ァ" && c <= "ヶ" ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c);
const SAME = { は: "わ", わ: "は", を: "お", お: "を", へ: "え", え: "へ" };
const isKanjiLike = (c) => /[㐀-鿿々0-9０-９]/.test(c);
const isKana = (c) => c !== "・" && /[぀-ヿ]/.test(c);

function unitMatchesKana(u, c) {
  c = toHira(c);
  if (u === c || SAME[u] === c) return true;
  if (u === LONG_O) return c === "う" || c === "お" || c === "ー";
  if (c === "ー") return VOWELS.includes(u);
  return false;
}

export function makeRuby(ja, romaji) {
  const units = readingUnits(romaji);
  if (!units) return null;

  // Tokens: runs of kanji/digits, single kana, and "other" characters (spaces, ・, brackets, ～ …) that carry no reading.
  const chars = [...ja];
  const tokens = [];
  for (let i = 0; i < chars.length;) {
    if (isKanjiLike(chars[i])) {
      let j = i; while (j < chars.length && isKanjiLike(chars[j])) j++;
      tokens.push({ t: "k", text: chars.slice(i, j).join("") });
      i = j;
    } else {
      tokens.push({ t: isKana(chars[i]) ? "a" : "x", text: chars[i] });
      i++;
    }
  }

  const readings = new Map();
  function align(ti, ui) {
    if (ti === tokens.length) return ui === units.length;
    const tok = tokens[ti];
    if (tok.t === "x") return align(ti + 1, ui);
    if (tok.t === "a") return ui < units.length && unitMatchesKana(units[ui], tok.text) && align(ti + 1, ui + 1);
    const min = [...tok.text].length;
    for (let end = ui + min; end <= units.length; end++) {
      readings.set(ti, units.slice(ui, end));
      if (align(ti + 1, end)) return true;
    }
    readings.delete(ti);
    return false;
  }
  if (!align(0, 0)) return null;

  // Merge into [text, reading] segments; kana/other text has an empty reading.
  const segs = [];
  const push = (text, reading) => {
    const last = segs[segs.length - 1];
    if (last && !reading && !last[1]) last[0] += text; else segs.push([text, reading]);
  };
  tokens.forEach((tok, ti) => {
    if (tok.t !== "k") return push(tok.text, "");
    const longO = /[大多遠通十氷]/.test(tok.text) ? "お" : "う";
    push(tok.text, readings.get(ti).map((u) => (u === LONG_O ? longO : u)).join(""));
  });
  return segs;
}
