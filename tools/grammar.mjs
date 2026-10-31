// Works out the grammar label shown by the Hint button:  { pos: "Verb", sub: "Group II · ru-verb" }
// It looks at the word's real form (ます / る endings, (な), prefixes, family wording), not at the lesson
// topic label, because topic labels like "research" or "daily" also contain verbs.

// Verbs that end in -iru/-eru but still belong to Group I (the classic exceptions).
const GROUP1_EXCEPTIONS = new Set(["帰る", "返る", "入る", "走る", "知る", "切る", "要る", "蹴る", "参る", "減る", "限る", "滑る", "握る", "散る", "照る", "喋る", "しゃべる", "はいる", "はしる", "しる"]);
const PRE_NOUN = new Set(["こんな", "そんな", "あんな", "どんな", "こういう", "そういう", "ああいう", "どういう"]);
const TOPIC_NOUNS = { places: "Place name" };

const strip = (s) => s.replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, " ").trim();

function verbForms(ja) {
  if (!/ます/.test(ja)) return null;
  const parts = ja.split("・");
  if (parts.length < 2) return null;
  const dict = strip(parts[parts.length - 1]).split(" ").pop();   // "気を つける" → "つける"
  return dict || null;
}

function classifyVerb(dict, romaji) {
  if (/する$/.test(dict) || /^(来る|くる)$/.test(dict)) return { pos: "Verb", sub: "Group III · irregular (する / 来る)" };
  const rom = strip(romaji.split("/").pop()).toLowerCase().split(/[\s-]+/).pop();   // last form, last word
  if (/(iru|eru)$/.test(rom) && dict.endsWith("る") && !GROUP1_EXCEPTIONS.has(dict)) return { pos: "Verb", sub: "Group II · ru-verb (drop る)" };
  return { pos: "Verb", sub: "Group I · u-verb" };
}

export function grammarOf(e) {
  const { ja, en, group } = e;
  const dict = verbForms(ja);
  if (dict || group === "v") return dict ? classifyVerb(dict, e.romaji) : { pos: "Verb", sub: "" };

  const bare = strip(ja);
  if (/[（(]な[）)]/.test(ja)) return { pos: "Adjective", sub: "na-adjective · takes な before a noun" };
  if (PRE_NOUN.has(bare)) return { pos: "Adjective", sub: "pre-noun word · always comes before a noun" };
  if (group === "adj") return { pos: "Adjective", sub: /い$/.test(bare) ? "i-adjective · ends in い" : "" };

  if (/^[～―-]/.test(bare) || group === "suf") return { pos: "Suffix", sub: /counter/i.test(en) ? "counter · attaches to a number or word" : "attaches to a word" };
  if (group === "adv") return { pos: "Adverb", sub: "" };
  if (group === "exp") return { pos: "Expression", sub: "set phrase" };
  if (group === "conj") return { pos: "Conjunction", sub: "joins sentences" };
  if (group === "q" || group === "question-words" || /^(どのぐらい|どうして|いかが)/.test(bare)) return { pos: "Question word", sub: "" };

  if (group === "fam") {
    if (/^your/i.test(en)) return { pos: "Noun", sub: "polite · for someone else's family" };
    if (/^my/i.test(en)) return { pos: "Noun", sub: "humble · for your own family" };
    return { pos: "Noun", sub: "family" };
  }
  return { pos: "Noun", sub: TOPIC_NOUNS[group] || "" };
}
