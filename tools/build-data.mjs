// Builds data/lessons.js from src/lessons/*.txt
//   line format:  japanese | romaji | english | pos-or-group | (optional) d1,d2,d3
//   d1..d3 are 1-based entry numbers inside the same lesson (hand-curated distractors).
// Entries without curated distractors get three auto-picked, similarity-ranked ones
// from the SAME lesson. Everything is validated; the build fails on any problem.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRuby } from "./furigana.mjs";
import { grammarOf } from "./grammar.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src", "lessons");
const exampleDir = path.join(root, "src", "examples");
const outFile = path.join(root, "data", "lessons.js");

// The study tools' own word-form rules (js/study/forms.js) are reused to check that an example really uses its word.
const sandbox = vm.createContext({ console });
sandbox.window = sandbox;
for (const f of ["js/n5/kana.js", "js/study/forms.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), sandbox, { filename: f });
const Forms = sandbox.Study.Forms;

const STOP = new Set(["to", "a", "an", "the", "of", "be", "in", "on", "for", "your", "my", "someone", "someones", "s"]);
const norm = (s) => s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9~ ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => norm(s).split(" ").filter((w) => w && !STOP.has(w));
const isKana = (c) => /[぀-ヿｦ-ﾟ～・ー\s()（）]/.test(c);
const kanji = (s) => [...s].filter((c) => !isKana(c) && /[㐀-鿿]/.test(c));

// FNV-1a: deterministic tie-breaker so the build is reproducible
function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

function tooClose(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return na === nb;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;   // e.g. "Information" vs "Information center"
  return false;
}

function parse(file) {
  const n = Number(path.basename(file, ".txt"));
  const entries = [];
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    if (!raw.trim() || raw.startsWith("#")) continue;
    const p = raw.split("|").map((x) => x.trim());
    if (p.length < 4) throw new Error(`L${n}: bad line: ${raw}`);
    const e = { id: `${n}-${entries.length + 1}`, ja: p[0], romaji: p[1], en: p[2], group: p[3] };
    // Grammar label for the Hint button (Verb · Group II, i-adjective, …), derived from the word itself.
    Object.assign(e, grammarOf(e));
    // Furigana: derived from the romaji so every kanji shows its hiragana reading above it.
    if (/[㐀-鿿0-9]/.test(e.ja)) {
      const ruby = makeRuby(e.ja, e.romaji);
      if (ruby) e.ruby = ruby; else console.warn(`No furigana for L${n} "${e.ja}" (${e.romaji}): romaji does not line up with the kana`);
    }
    if (p[4]) e.curated = p[4].split(",").map((x) => Number(x));
    entries.push(e);
  }
  return { n, entries };
}

/* ---------- example sentences: src/examples/<n>.txt ----------
   line format:  headword | sentence | English | (optional) other written forms, comma separated
   - headword is the word's Japanese exactly as in src/lessons/<n>.txt (it pairs the line with its entry, in order)
   - sentence marks readings as  漢字{かんじ}  (hiragana only); every kanji must have one
   - "=" instead of a sentence means the entry is itself a whole sentence and needs no example
   - other written forms are what a speech recogniser may print for a kana word (まど → 窓) */
const KANJI = "\u3400-\u9FFF々〆";
const RUBY = new RegExp(String.raw`[${KANJI}]+\{[ぁ-ゖー]+\}`, "g");
const HAS_KANJI = new RegExp(String.raw`[${KANJI}]`);
const plainOf = (m) => m.replace(new RegExp(String.raw`([${KANJI}]+)\{[^}]*\}`, "g"), "$1");
const readingOf = (m) => m.replace(new RegExp(String.raw`[${KANJI}]+\{([^}]*)\}`, "g"), "$1");

// Does the sentence use the word? Verbs and adjectives conjugate, so their stem is enough.
function usesWord(e, sentence) {
  const text = [plainOf(sentence), readingOf(sentence)].map((s) => s.replace(/\s+/g, ""));
  const conjugates = e.pos === "Verb" || e.pos === "Adjective";
  const variants = [...Forms.japaneseVariants(e.ja), ...Forms.japaneseVariants(Forms.readingOf(e))];
  const candidates = new Set();
  for (const v of variants) {
    candidates.add(v);
    if (!conjugates) continue;
    let stem = v.replace(/ます$/, "");
    candidates.add(stem);
    for (let cut = 1; cut <= 2 && stem.length > cut; cut++) candidates.add(stem.slice(0, stem.length - cut));
  }
  return [...candidates].some((c) => c && text.some((s) => s.includes(c)));
}

function parseExamples(n, entries, problems) {
  const file = path.join(exampleDir, `${n}.txt`);
  if (!fs.existsSync(file)) { problems.push(`L${n}: missing src/examples/${n}.txt`); return; }
  const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  const used = new Set();
  for (const raw of lines) {
    const p = raw.split("|").map((x) => x.trim());
    const where = `L${n} example "${p[0]}"`;
    if (p.length < 3) { problems.push(`${where}: expected  headword | sentence | English`); continue; }
    const e = entries.find((x) => x.ja === p[0] && !used.has(x));
    if (!e) { problems.push(`${where}: no matching (unused) entry in src/lessons/${n}.txt`); continue; }
    used.add(e);
    if (p[3]) {
      const alt = p[3].split(",").map((x) => x.trim()).filter(Boolean);
      const known = new Set(Forms.japaneseForms(e));
      if (alt.some((x) => known.has(Forms.normalizeJapanese(x)))) problems.push(`${where}: an other-written-form is already accepted`);
      e.alt = alt;
    }
    if (p[1] === "=") continue;
    const [, sentence, en] = p;
    const bare = sentence.replace(RUBY, "");
    if (/[{}]/.test(bare)) problems.push(`${where}: a reading must be hiragana directly after kanji: ${sentence}`);
    else if (HAS_KANJI.test(bare)) problems.push(`${where}: kanji without a reading: ${sentence}`);
    if (!en) problems.push(`${where}: English is empty`);
    if (!/[。？！」]$/.test(sentence)) problems.push(`${where}: a sentence ends with 。 ？ or ！`);
    if (!usesWord(e, sentence)) problems.push(`${where}: the sentence does not use the word: ${sentence}`);
    e.example = { ja: sentence, en };
  }
  for (const e of entries) {
    if (!used.has(e)) problems.push(`L${n} ${e.id} ${e.ja}: no line in src/examples/${n}.txt (use "=" if the entry is a whole sentence)`);
  }
}

function score(target, cand) {
  let s = 0;
  if (target.group === cand.group) s += 3;
  const tw = new Set(words(target.en)), cw = words(cand.en);
  s += Math.min(1.5, cw.filter((w) => tw.has(w)).length * 0.75);                         // shared English words
  const tk = new Set(kanji(target.ja));
  s += Math.min(2, kanji(cand.ja).filter((c) => tk.has(c)).length);                      // shared kanji
  s += 1 - Math.abs(target.en.length - cand.en.length) / Math.max(target.en.length, cand.en.length); // similar length
  const verb = (x) => /(ます|る)(\)|）)?$/.test(x.ja.replace(/[～\s]/g, "").split("・").pop());
  if (verb(target) === verb(cand)) s += 0.5;
  return s + (hash(target.id + cand.id) % 1000) / 100000;
}

function autoDistractors(entry, all) {
  const pool = all
    .filter((c) => c !== entry && !tooClose(entry.en, c.en))
    .map((c) => ({ c, s: score(entry, c) }))
    .sort((a, b) => b.s - a.s);
  const picked = [];
  for (const { c } of pool) {
    if (picked.some((p) => tooClose(p.en, c.en))) continue;
    picked.push(c);
    if (picked.length === 3) break;
  }
  return picked;
}

const lessons = {};
const problems = [];
const files = fs.readdirSync(srcDir).filter((f) => /^\d+\.txt$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
for (const f of files) {
  const { n, entries } = parse(path.join(srcDir, f));
  entries.forEach((e, i) => {
    let d;
    if (e.curated) d = e.curated.map((k) => entries[k - 1]);
    else d = autoDistractors(e, entries);
    if (d.length !== 3 || d.some((x) => !x)) problems.push(`L${n} ${e.id} ${e.ja}: needs 3 distractors, got ${d.length}`);
    const opts = [e.en, ...d.map((x) => x?.en)];
    if (new Set(opts.map((o) => o?.toLowerCase())).size !== 4) problems.push(`L${n} ${e.id} ${e.ja}: duplicate options ${JSON.stringify(opts)}`);
    if (d.some((x) => x && x === e)) problems.push(`L${n} ${e.id}: distractor is itself`);
    if (d.some((x) => x && x.en === e.en)) problems.push(`L${n} ${e.id}: distractor shares the correct meaning`);
    e.distractors = d.map((x) => entries.indexOf(x) + 1);
    delete e.curated;
  });
  parseExamples(n, entries, problems);
  lessons[n] = { lesson: n, title: `Lesson ${n}`, words: entries };
}

if (problems.length) { console.error("BUILD FAILED:\n" + problems.join("\n")); process.exit(1); }

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, "/* Generated by tools/build-data.mjs from src/lessons/*.txt — do not edit by hand. */\nwindow.LESSON_DATA = " + JSON.stringify(lessons, null, 1) + ";\n");
const total = Object.values(lessons).reduce((a, l) => a + l.words.length, 0);
console.log(`Built ${Object.keys(lessons).length} lessons, ${total} words → ${path.relative(root, outFile)}`);
for (const l of Object.values(lessons)) console.log(`  Lesson ${l.lesson}: ${l.words.length}`);
