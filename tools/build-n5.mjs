// Builds data/n5.js from src/n5/*.json and validates the curriculum.
//   node tools/build-n5.mjs            validate + build (warns if source verification is missing or stale)
//   node tools/build-n5.mjs --strict   also fail on a missing/stale src/n5/verification.json (used by CI)
// Vocabulary lessons (tools/build-data.mjs, data/lessons.js) are untouched by this file.
import fs from "node:fs";
import path from "node:path";
import {
  root, srcDir, loadContent, contentHash, parse, plain, kana, kanjiIn, bareKanji, malformed, isHiragana, readingForms,
} from "./n5-lib.mjs";

const strict = process.argv.includes("--strict");
const c = loadContent();
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);

/* ---------- curriculum ---------- */
const unitOf = new Map();          // kanji -> unit id
const order = [];                  // curriculum order
const unitIds = new Set();
for (const u of c.meta.units) {
  if (unitIds.has(u.id)) err(`duplicate unit ${u.id}`);
  unitIds.add(u.id);
  if (u.kanji.length !== 6) warnings.push(`unit ${u.id} has ${u.kanji.length} kanji (6 is the default daily amount)`);
  for (const k of u.kanji) {
    if (unitOf.has(k)) err(`kanji ${k} is in two units`);
    unitOf.set(k, u.id); order.push(k);
  }
}
const kanjiById = new Map();
for (const k of c.kanji) {
  if (kanjiById.has(k.id)) err(`duplicate kanji ${k.id}`);
  kanjiById.set(k.id, k);
  if (!unitOf.has(k.id)) err(`kanji ${k.id} is in kanji.json but in no unit`);
  if (!k.meaning || !k.meanings?.length) err(`kanji ${k.id}: meaning missing`);
  if (!k.on?.length && !k.kun?.length) err(`kanji ${k.id}: no readings`);
}
for (const k of order) if (!kanjiById.has(k)) err(`unit lists ${k} but kanji.json has no entry`);
// The quiz offers a kanji's meaning as one of four options, so meanings must not collide.
const meaningSet = new Set();
for (const k of c.kanji) { if (meaningSet.has(k.meaning)) err(`two kanji share the meaning "${k.meaning}"`); meaningSet.add(k.meaning); }

/** Which curriculum kanji does `markup` need (units <= unit) and which are extras that always keep furigana? */
function classify(markup, unit, where) {
  if (malformed(markup)) err(`${where}: malformed {reading} markup in "${markup}"`);
  const bare = bareKanji(markup);
  if (bare.length) err(`${where}: kanji without a reading: ${[...new Set(bare)].join("")} in "${markup}"`);
  for (const r of parse(markup)) if (r.t === "ruby" && !isHiragana(r.rt)) err(`${where}: reading "${r.rt}" for ${r.base} must be hiragana`);
  const requires = [], extras = [];
  for (const k of kanjiIn(markup)) (unitOf.has(k) && unitOf.get(k) <= unit ? requires : extras).push(k);
  return { requires, extras };
}

/* ---------- vocabulary ---------- */
const vocab = new Map();
for (const v of c.vocab) {
  const w = `vocab ${v.id}`;
  if (vocab.has(v.id)) err(`duplicate ${w}`);
  const ks = kanjiIn(v.ruby);
  const ja = plain(v.ruby), primary = kana(v.ruby);
  if (!ks.length) err(`${w}: has no kanji`);
  if (!ks.every((k) => unitOf.has(k))) err(`${w}: uses kanji outside the curriculum (${ks.filter((k) => !unitOf.has(k)).join("")})`);
  classify(v.ruby, 99, w);
  const unit = Math.max(...ks.map((k) => unitOf.get(k) || 0));
  if (!v.en) err(`${w}: no English gloss`);
  const lookalikes = v.lookalikes || [];
  if (lookalikes.length < 3) err(`${w}: needs at least 3 look-alike spellings (has ${lookalikes.length})`);
  if (new Set(lookalikes).size !== lookalikes.length || lookalikes.includes(ja)) err(`${w}: look-alikes must be distinct and differ from ${ja}`);
  // Single-kanji segments must agree with the readings taught in kanji.json.
  for (const r of parse(v.ruby)) {
    if (r.t !== "ruby" || [...r.base].length !== 1) continue;
    const k = kanjiById.get(r.base);
    if (k && !readingForms([...k.on, ...k.kun]).has(r.rt)) err(`${w}: ${r.base}{${r.rt}} is not a taught reading of ${r.base} (${[...k.on, ...k.kun].join(" ")})`);
  }
  vocab.set(v.id, { id: v.id, unit, ja, ruby: v.ruby, readings: [primary, ...(v.alt || [])], en: v.en, pos: v.pos, kanji: ks, lookalikes });
}
const jaSeen = new Map();
for (const v of vocab.values()) { if (jaSeen.has(v.ja)) err(`vocab ${v.id} and ${jaSeen.get(v.ja)} share the spelling ${v.ja}`); jaSeen.set(v.ja, v.id); }
const meaningVocab = new Map();
for (const v of vocab.values()) { const k = v.en.toLowerCase(); if (meaningVocab.has(k)) err(`vocab ${v.id} and ${meaningVocab.get(k)} share the gloss "${v.en}"`); meaningVocab.set(k, v.id); }

/* ---------- days: sentences, cloze, passages ---------- */
const sentences = {}, cloze = {}, passages = {};
const ids = new Set();
const uniqueId = (id, w) => { if (ids.has(id)) err(`${w}: duplicate id ${id}`); ids.add(id); };
const seenDays = new Set();
for (const d of c.days) {
  const unit = d.unit, W = `day ${d.file}`;
  if (!unitIds.has(unit)) { err(`${W}: unit ${unit} is not in meta.json`); continue; }
  if (seenDays.has(unit)) err(`${W}: unit ${unit} appears in two day files`);
  seenDays.add(unit);

  for (const s of d.sentences) {
    const w = `sentence ${s.id}`;
    uniqueId(s.id, w);
    const { requires, extras } = classify(s.ja, unit, w);
    if (!s.en) err(`${w}: no English translation`);
    for (const f of s.focus || []) {
      const v = vocab.get(f);
      if (!v) { err(`${w}: focus ${f} is not a vocab id`); continue; }
      if (v.unit > unit) err(`${w}: focus ${f} belongs to a later unit`);
      if (!s.ja.includes(v.ruby)) err(`${w}: does not contain the exact markup of ${f} (${v.ruby})`);
    }
    if (!(s.focus || []).length) err(`${w}: needs at least one focus word`);
    sentences[s.id] = { id: s.id, unit, ja: s.ja, en: s.en, focus: s.focus, requires, extras, ...(s.audio ? { audio: s.audio } : {}) };
  }

  for (const q of d.cloze || []) {
    const w = `cloze ${q.id}`;
    uniqueId(q.id, w);
    const s = sentences[q.sentence];
    const ans = vocab.get(q.blank);
    if (!s || s.unit !== unit) { err(`${w}: sentence ${q.sentence} not found in this day`); continue; }
    if (!ans) { err(`${w}: blank ${q.blank} is not a vocab id`); continue; }
    if (!s.ja.includes(ans.ruby)) err(`${w}: sentence does not contain ${ans.ruby}`);
    const opts = [q.blank, ...q.options];
    const vs = opts.map((o) => vocab.get(o));
    if (vs.some((x) => !x)) { err(`${w}: unknown option id`); continue; }
    if (opts.length !== 4 || new Set(vs.map((x) => x.ja)).size !== 4) err(`${w}: needs 4 options with distinct spellings`);
    if (new Set(vs.flatMap((x) => x.readings)).size < 4) err(`${w}: options share a reading`);
    if (vs.some((x) => x.unit > unit)) err(`${w}: an option belongs to a later unit`);
    if (!q.explain) err(`${w}: missing explanation`);
    const req = [...new Set([...s.requires, ...vs.flatMap((x) => x.kanji)])];
    cloze[q.id] = { id: q.id, unit, sentence: q.sentence, blank: q.blank, options: q.options, explain: q.explain, requires: req };
  }

  const p = d.passage;
  uniqueId(p.id, `passage ${p.id}`);
  const pk = new Set(), px = new Set();
  const texts = [p.title, ...p.paragraphs];
  texts.forEach((t, i) => { const r = classify(t, unit, `passage ${p.id} #${i}`); r.requires.forEach((k) => pk.add(k)); r.extras.forEach((k) => px.add(k)); });
  if (p.paragraphs.length < 4) err(`passage ${p.id}: too short`);
  if (p.paragraphsEn?.length !== p.paragraphs.length) err(`passage ${p.id}: paragraphsEn must match paragraphs`);
  const unitKanji = c.meta.units.find((u) => u.id === unit).kanji;
  const missing = unitKanji.filter((k) => !pk.has(k));
  if (missing.length) err(`passage ${p.id}: does not use ${missing.join("")}`);
  if (p.questions.length < 3) err(`passage ${p.id}: needs at least 3 questions`);
  for (const q of p.questions) {
    const w = `question ${q.id}`;
    uniqueId(q.id, w);
    classify(q.q, unit, w); q.options.forEach((o) => classify(o, unit, w));
    if (q.options.length !== 4 || new Set(q.options.map(plain)).size !== 4) err(`${w}: needs 4 distinct options`);
    if (!(q.answer >= 0 && q.answer < q.options.length)) err(`${w}: answer index out of range`);
    if (!q.qEn || !q.explain) err(`${w}: qEn and explain are required`);
    for (const k of q.kanji || []) if (!unitOf.has(k)) err(`${w}: tagged kanji ${k} is not in the curriculum`);
    if (!(q.kanji || []).length) err(`${w}: tag at least one kanji it tests`);
  }
  passages[unit] = { id: p.id, unit, title: p.title, titleEn: p.titleEn, paragraphs: p.paragraphs, paragraphsEn: p.paragraphsEn, questions: p.questions,
    requires: [...pk], extras: [...px], ...(p.audio ? { audio: p.audio } : {}) };
}
for (const u of c.meta.units) {
  classify(u.titleJa, u.id, `unit ${u.id} title`);
  if (!seenDays.has(u.id)) err(`unit ${u.id} has no day file`);
}

/* ---------- coverage: each kanji needs vocabulary, sentences and a passage ---------- */
const coverage = [];
for (const k of order) {
  const u = unitOf.get(k);
  const row = {
    kanji: k, unit: u,
    vocab: [...vocab.values()].filter((v) => v.kanji.includes(k)).length,
    sentences: Object.values(sentences).filter((s) => s.requires.includes(k)).length,
    cloze: Object.values(cloze).filter((q) => q.blank && vocab.get(q.blank).kanji.includes(k)).length,
    passage: !!passages[u]?.requires.includes(k),
  };
  coverage.push(row);
  if (!row.vocab) err(`kanji ${k}: no vocabulary word uses it`);
  if (row.sentences < 2) err(`kanji ${k}: only ${row.sentences} sentence(s) use it (need 2)`);
  if (!row.passage) err(`kanji ${k}: not used in its passage`);
  // Mastery needs the "context" skill, which only cloze items and passage questions train.
  const ctxItems = row.cloze + Object.values(passages).reduce((a, p) => a + p.questions.filter((q) => q.kanji.includes(k)).length, 0);
  row.context = ctxItems;
  if (!ctxItems) err(`kanji ${k}: no cloze item or passage question tests it in context, so it could never be mastered`);
}
// Every vocab word must be usable in at least one sentence so reading/spelling questions can be built for it.
for (const v of vocab.values()) if (!Object.values(sentences).some((s) => s.focus.includes(v.id))) warnings.push(`vocab ${v.id} (${v.ja}) is in no sentence`);

/* ---------- source verification status ---------- */
let verification = null, verifiedVocab = {};
const vf = path.join(srcDir, "verification.json");
const hash = contentHash(c);
if (fs.existsSync(vf)) {
  const v = JSON.parse(fs.readFileSync(vf, "utf8"));
  verifiedVocab = v.vocab || {};
  verification = { generatedAt: v.generatedAt, sources: v.sources, summary: v.summary, current: v.contentHash === hash };
  if (!verification.current) (strict ? err : (m) => warnings.push(m))("src/n5/verification.json is STALE: the verified content changed. Run: node tools/verify-n5-sources.mjs");
  if (v.failures?.length) err(`verification.json records ${v.failures.length} failure(s)`);
} else (strict ? err : (m) => warnings.push(m))("src/n5/verification.json is missing. Run: node tools/verify-n5-sources.mjs");

if (errors.length) { console.error("N5 BUILD FAILED:\n" + errors.map((e) => "  - " + e).join("\n")); process.exit(1); }

/* ---------- emit ---------- */
const kanjiOut = {};
order.forEach((k, i) => { const x = kanjiById.get(k); kanjiOut[k] = { ...x, unit: unitOf.get(k), order: i }; });
// Readings JMdict lists for the same spelling but that this app does not teach: they must never be used as wrong choices.
const vocabOut = Object.fromEntries([...vocab.values()].map((v) => [v.id, { ...v, otherReadings: ((verifiedVocab[v.id] || {}).allReadings || []).filter((r) => !v.readings.includes(r)) }]));
const data = {
  schema: c.meta.schema,
  meta: { title: c.meta.title, defaults: c.meta.defaults, capabilities: c.meta.capabilities, sources: c.meta.sources, jlptNote: c.meta.jlptNote, review: c.meta.review },
  verification,
  units: c.meta.units,
  curriculum: order,
  kanji: kanjiOut,
  vocab: vocabOut,
  sentences, cloze, passages,
};
const outFile = process.env.N5_OUT ? path.resolve(process.env.N5_OUT) : path.join(root, "data", "n5.js");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, "/* Generated by tools/build-n5.mjs from src/n5/*.json — do not edit by hand. */\nwindow.N5_DATA = " + JSON.stringify(data, null, 1) + ";\n");

console.log(`Built N5 track: ${order.length} kanji, ${vocab.size} words, ${Object.keys(sentences).length} sentences, ${Object.keys(cloze).length} cloze, ${Object.keys(passages).length} passages (${Object.values(passages).reduce((a, p) => a + p.questions.length, 0)} questions) → data/n5.js`);
console.log(verification ? `Source verification: ${verification.current ? "current" : "STALE"} (${verification.generatedAt.slice(0, 10)}) ${JSON.stringify(verification.summary)}` : "Source verification: none");
for (const w of warnings) console.warn("  warning:", w);
console.log("Coverage (vocab / sentences / cloze / passage):");
for (const r of coverage) console.log(`  ${r.kanji}  unit ${r.unit}  ${r.vocab} / ${r.sentences} / ${r.cloze} / ${r.passage ? "yes" : "NO"}`);
