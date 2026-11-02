// Verifies the N5 content against authoritative sources and writes src/n5/verification.json.
//   node tools/verify-n5-sources.mjs [--kanjidic path/to/kanjidic2.xml]
// Needs network access (Jisho API = JMdict) and KANJIDIC2 (downloaded to the OS temp dir if no path is given).
// Run it whenever kanji.json, vocab.json or any reading in a sentence/passage changes; the build compares a content
// hash and flags a stale verification.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { loadContent, contentHash, collectRuns, plain, readingForms, kataToHira, srcDir, kana } from "./n5-lib.mjs";

const args = process.argv.slice(2);
const argOf = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const c = loadContent();
const issues = [];
const warn = [];

/* ---------------- KANJIDIC2 ---------------- */
async function loadKanjidic() {
  let p = argOf("--kanjidic");
  if (!p) {
    const dir = path.join(os.tmpdir(), "n5-kanjidic");
    fs.mkdirSync(dir, { recursive: true });
    p = path.join(dir, "kanjidic2.xml");
    if (!fs.existsSync(p)) {
      console.log("Downloading KANJIDIC2 …");
      const res = await fetch("http://www.edrdg.org/kanjidic/kanjidic2.xml.gz");
      if (!res.ok) throw new Error(`KANJIDIC2 download failed: ${res.status}`);
      fs.writeFileSync(p, zlib.gunzipSync(Buffer.from(await res.arrayBuffer())));
    }
  }
  return fs.readFileSync(p, "utf8");
}
function kanjidicEntry(xml, k) {
  const i = xml.indexOf(`<literal>${k}</literal>`);
  if (i < 0) return null;
  const blk = xml.slice(i, xml.indexOf("</character>", i));
  const all = (re) => [...blk.matchAll(new RegExp(re, "g"))].map((m) => m[1]);
  return {
    jlptOld: Number(all("<jlpt>(\\d)")[0] || 0) || null,
    grade: Number(all("<grade>(\\d+)")[0] || 0) || null,
    on: all('<reading r_type="ja_on">([^<]+)'),
    kun: all('<reading r_type="ja_kun">([^<]+)'),
    meanings: all("<meaning>([^<]+)</meaning>").map((m) => m.toLowerCase()),
  };
}

/* ---------------- Jisho (JMdict) ---------------- */
const cacheDir = path.join(os.tmpdir(), "n5-jisho-cache");
fs.mkdirSync(cacheDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jisho(keyword) {
  const f = path.join(cacheDir, Buffer.from(keyword).toString("hex") + ".json");
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(320);
    try {
      const res = await fetch("https://jisho.org/api/v1/search/words?keyword=" + encodeURIComponent(keyword), { headers: { "User-Agent": "lesson-quiz-n5-content-verifier/1.0 (+https://github.com/iNuman/lesson-quiz)", Accept: "application/json" } });
      if (res.ok) { const j = await res.json(); fs.writeFileSync(f, JSON.stringify(j.data)); return j.data; }
    } catch (e) { /* retry */ }
    await sleep(1000 * (attempt + 1));
  }
  throw new Error(`Jisho lookup failed for ${keyword}`);
}
/** Entries whose written form equals `word` → list of {reading, glosses}. */
function exact(data, word) {
  const out = [];
  for (const e of data) for (const j of e.japanese) {
    if ((j.word || j.reading) === word) out.push({ reading: j.reading, glosses: e.senses.flatMap((s) => s.english_definitions.map((g) => g.toLowerCase())), tags: e.senses.flatMap((s) => s.tags), common: e.is_common });
  }
  return out;
}

const STOP = new Set(["a", "an", "the", "of", "to", "be", "day", "(thing)", "thing", "month"]);
const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w && !STOP.has(w));

async function main() {
  const xml = await loadKanjidic();
  const dbVersion = (xml.match(/<database_version>([^<]+)/) || [])[1];
  const created = (xml.match(/<date_of_creation>([^<]+)/) || [])[1];
  const result = { kanji: {}, vocab: {}, runs: {}, lookalikes: {} };

  /* 1. kanji.json vs KANJIDIC2 */
  for (const k of c.kanji) {
    const e = kanjidicEntry(xml, k.id);
    const r = { ok: true, jlptOld: e?.jlptOld ?? null, grade: e?.grade ?? null, issues: [] };
    if (!e) { r.ok = false; r.issues.push("not found in KANJIDIC2"); }
    else {
      for (const x of k.on) if (!e.on.includes(x)) r.issues.push(`on'yomi ${x} not in KANJIDIC2 (${e.on.join(" ")})`);
      for (const x of k.kun) if (!e.kun.includes(x)) r.issues.push(`kun'yomi ${x} not in KANJIDIC2 (${e.kun.join(" ")})`);
      for (const x of k.meanings) if (!e.meanings.includes(x)) r.issues.push(`meaning "${x}" not in KANJIDIC2 (${e.meanings.join("; ")})`);
      if (r.issues.length) r.ok = false;
      if (e.jlptOld !== 4) r.note = `KANJIDIC2 old JLPT level ${e.jlptOld ?? "none"} (4 = N5-equivalent)`;
    }
    result.kanji[k.id] = r;
    if (!r.ok) issues.push(`kanji ${k.id}: ${r.issues.join("; ")}`);
  }

  /* 2. vocabulary vs JMdict */
  for (const v of c.vocab) {
    const ja = plain(v.ruby), primary = kana(v.ruby), accepted = [primary, ...(v.alt || [])];
    const r = { ok: true, ja, readings: [], allReadings: [...new Set((await jisho(ja)).flatMap((e) => e.japanese.filter((j) => (j.word || j.reading) === ja).map((j) => j.reading)))], gloss: [], issues: [] };
    const hits = exact(await jisho(ja), ja);
    for (const rd of accepted) {
      if (hits.some((h) => h.reading === rd)) r.readings.push(rd);
      else { r.ok = false; r.issues.push(`reading ${rd} not found for ${ja} in JMdict (found: ${[...new Set(hits.map((h) => h.reading))].join(", ") || "no entry"})`); }
    }
    const mine = new Set(words(v.en));
    const gl = hits.filter((h) => accepted.includes(h.reading)).flatMap((h) => h.glosses);
    r.gloss = gl.slice(0, 6);
    if (gl.length && ![...mine].some((w) => gl.some((g) => words(g).includes(w)))) warn.push(`vocab ${v.id} (${ja}): gloss "${v.en}" shares no word with JMdict: ${gl.slice(0, 4).join(" | ")}`);
    result.vocab[v.id] = r;
    if (!r.ok) issues.push(`vocab ${v.id}: ${r.issues.join("; ")}`);
  }

  /* 3. every kanji run used in sentences, passages and questions */
  const kd = new Map();
  const kdOf = (k) => { if (!kd.has(k)) kd.set(k, kanjidicEntry(xml, k)); return kd.get(k); };
  for (const run of collectRuns(c)) {
    const [base, rt] = run.split("|");
    let via = null;
    if ([...base].length === 1) {
      const e = kdOf(base);
      if (e && readingForms([...e.on, ...e.kun]).has(rt)) via = "kanjidic2";
    }
    if (!via) {
      if (exact(await jisho(base), base).some((h) => h.reading === rt)) via = "jmdict";
    }
    result.runs[run] = via ? { ok: true, via } : { ok: false };
    if (!via) issues.push(`reading ${base}{${rt}} not confirmed by KANJIDIC2 or JMdict`);
  }

  /* 4. look-alike spellings must not be real words with the same reading */
  for (const v of c.vocab) {
    const accepted = [kana(v.ruby), ...(v.alt || [])];
    for (const l of v.lookalikes || []) {
      const hits = exact(await jisho(l), l);
      const clash = hits.filter((h) => accepted.includes(h.reading));
      const other = hits.filter((h) => !accepted.includes(h.reading));
      const r = { ok: clash.length === 0, realWordDifferentReading: other.length ? [...new Set(other.map((h) => h.reading))] : [] };
      result.lookalikes[`${v.id}:${l}`] = r;
      if (!r.ok) issues.push(`lookalike ${l} for ${v.id} is a real word read ${clash.map((h) => h.reading).join("/")} — it would be a second correct answer`);
    }
  }

  const count = (o) => Object.values(o).length;
  const pass = (o) => Object.values(o).filter((x) => x.ok).length;
  const out = {
    generatedAt: new Date().toISOString(),
    contentHash: contentHash(c),
    sources: {
      kanjidic2: { databaseVersion: dbVersion, createdOn: created, url: "http://www.edrdg.org/kanjidic/kanjd2index.html" },
      jmdict: { via: "https://jisho.org/api/v1/search/words", queriedOn: new Date().toISOString().slice(0, 10) },
    },
    summary: {
      kanji: `${pass(result.kanji)}/${count(result.kanji)}`, vocabulary: `${pass(result.vocab)}/${count(result.vocab)}`,
      readingRuns: `${pass(result.runs)}/${count(result.runs)}`, lookalikes: `${pass(result.lookalikes)}/${count(result.lookalikes)}`,
      failures: issues.length, warnings: warn.length,
    },
    warnings: warn, failures: issues, ...result,
  };
  fs.writeFileSync(path.join(srcDir, "verification.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify(out.summary));
  warn.forEach((w) => console.log("WARN:", w));
  if (issues.length) { issues.forEach((i) => console.error("FAIL:", i)); process.exit(1); }
  console.log("All N5 source checks passed → src/n5/verification.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
