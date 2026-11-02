// Shared helpers for the N5 content tools (build + source verification). Pure Node, no dependencies.
//
// Reading markup: a run of kanji directly followed by its hiragana reading in braces, e.g.
//   日本人{にほんじん}です   →   <ruby>日本人<rt>にほんじん</rt></ruby>です
// Every kanji in authored text MUST carry a reading, so the app can show or hide readings freely.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// N5_SRC lets the tests point the tools at a deliberately broken copy of the content.
export const srcDir = process.env.N5_SRC ? path.resolve(process.env.N5_SRC) : path.join(root, "src", "n5");

export const KANJI = "[\\u3400-\\u9FFF々〆]";
const RUBY_RE = new RegExp(`(${KANJI}+)\\{([^{}]*)\\}`, "g");
const KANJI_RE = new RegExp(KANJI, "g");
export const isHiragana = (s) => /^[ぁ-ゖー]+$/.test(s);

/** Tokens: {t:"text", s} | {t:"ruby", base, rt}. */
export function parse(markup) {
  const out = [];
  let last = 0;
  for (const m of markup.matchAll(RUBY_RE)) {
    if (m.index > last) out.push({ t: "text", s: markup.slice(last, m.index) });
    out.push({ t: "ruby", base: m[1], rt: m[2] });
    last = m.index + m[0].length;
  }
  if (last < markup.length) out.push({ t: "text", s: markup.slice(last) });
  return out;
}
export const plain = (markup) => parse(markup).map((t) => (t.t === "ruby" ? t.base : t.s)).join("");
export const kana = (markup) => parse(markup).map((t) => (t.t === "ruby" ? t.rt : t.s)).join("");
export const kanjiIn = (markup) => [...new Set(plain(markup).match(KANJI_RE) || [])];
/** Kanji that appear in the text without a reading (an authoring error). */
export function bareKanji(markup) {
  return parse(markup).filter((t) => t.t === "text").flatMap((t) => t.s.match(KANJI_RE) || []);
}
export const runsOf = (markup) => parse(markup).filter((t) => t.t === "ruby");
/** Brace characters left over after parsing mean the markup is malformed. */
export const malformed = (markup) => parse(markup).some((t) => t.t === "text" && /[{}]/.test(t.s));

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

export function loadContent() {
  const meta = readJson(path.join(srcDir, "meta.json"));
  const kanji = readJson(path.join(srcDir, "kanji.json"));
  const vocab = readJson(path.join(srcDir, "vocab.json"));
  const days = fs.readdirSync(path.join(srcDir, "days")).filter((f) => /^\d+\.json$/.test(f)).sort()
    .map((f) => ({ file: f, ...readJson(path.join(srcDir, "days", f)) }));
  return { meta, kanji, vocab, days };
}

/** Every distinct "kanji-run|reading" in sentences, passages, questions and titles (what the verifier checks). */
export function collectRuns(c) {
  const texts = [];
  for (const u of c.meta.units) texts.push(u.titleJa);
  for (const d of c.days) {
    for (const s of d.sentences) texts.push(s.ja);
    const p = d.passage;
    texts.push(p.title, ...p.paragraphs);
    for (const q of p.questions) texts.push(q.q, ...q.options);
  }
  const runs = new Set();
  for (const t of texts) for (const r of runsOf(t)) runs.add(`${r.base}|${r.rt}`);
  return [...runs].sort();
}

/** Hash of everything that the source verification vouches for. */
export function contentHash(c) {
  const payload = JSON.stringify({
    kanji: c.kanji.map((k) => [k.id, k.meaning, k.meanings, k.on, k.kun]),
    vocab: c.vocab.map((v) => [v.id, v.ruby, v.alt || [], v.en, v.lookalikes || []]),
    runs: collectRuns(c),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/* ---- kana helpers shared by the verifier ---- */
export const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const VOICE = { か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご", さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ", た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど", は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ" };
/** Readings a dictionary reading may legitimately take inside a compound (stem, voiced, geminated). */
export function readingForms(dict) {
  const forms = new Set();
  for (const raw of [].concat(dict)) {
    const r = kataToHira(raw.replace(/^-|-$/g, ""));
    const stem = r.split(".")[0];
    const whole = r.replace(".", "");
    for (const f of [stem, whole]) {
      if (!f) continue;
      forms.add(f);
      if (VOICE[f[0]]) forms.add(VOICE[f[0]] + f.slice(1));
      if (f.length >= 2) forms.add(f.slice(0, -1) + "っ");   // ガク → がっ (学校 がっこう), ニチ → にっ
    }
  }
  return forms;
}
