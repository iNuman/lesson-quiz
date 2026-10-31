// Run:  node serve.mjs 8000 &   then   NODE_PATH=$(npm root -g) node tests/e2e.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8000";
const SHOTS = process.env.SHOTS || "/tmp";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXPECTED = { 16: 65, 17: 52, 18: 52, 19: 63, 20: 24, 21: 30, 22: 12, 23: 32, 24: 25, 25: 28, 26: 18, 27: 28, 28: 12, 29: 40, 30: 17 };

// ---- source files (the .txt transcription) ----
function parseSrc(n) {
  return fs.readFileSync(path.join(__dirname, "..", "src", "lessons", `${n}.txt`), "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("|").map((x) => x.trim()));
}

const st = (p) => p.evaluate(() => { const s = window.__quizDebug.getState(); return { lesson: s.lesson, status: s.status, index: s.index, score: s.score, wrong: s.wrong.map((w) => ({ ...w })), total: s.words.length, options: s.questions.map((q) => q.options), correct: s.questions.map((q) => q.correct), ja: s.words.map((w) => w.ja) }; });
const waitMove = (p, i) => p.waitForFunction((i) => { const s = window.__quizDebug.getState(); return s.index !== i || s.status === "completed"; }, i, { timeout: 4000 });
const prompt = async (p) => (await p.textContent("#prompt")).trim();

async function play(p, pattern, { rapid = false, checkFeedback = true } = {}) {
  const s0 = await st(p);
  const seen = [];
  for (let i = 0; i < s0.total; i++) {
    const s = await st(p);
    ok(s.status === "question" && s.index === i, `L${s.lesson} expected question ${i}, got ${s.status}/${s.index}`);
    seen.push(await prompt(p));
    const label = (await p.textContent(".progress-label")).trim();
    ok(label.startsWith(`Question ${i + 1} of ${s.total}`), `progress label "${label}"`);
    const correct = s.correct[i];
    const choice = pattern(i) ? correct : s.options[i].find((o) => o !== correct);
    const btn = p.locator(".opt").nth(s.options[i].indexOf(choice));
    if (rapid) await btn.evaluate((el) => { el.click(); el.click(); el.click(); });
    else await btn.click();
    if (pattern(i)) {
      ok((await p.locator("#next").count()) === 0, `no Next button after correct (q${i})`);
      await waitMove(p, i);
    } else {
      const a = await st(p);
      ok(a.status === "wrong_answer_feedback" && a.index === i, `wrong stays on q${i}`);
      if (i < 2 || i === s.total - 1) { await sleep(550); ok((await st(p)).index === i, `no auto-advance after wrong q${i}`); }
      if (checkFeedback) {
        const fb = await p.textContent(".feedback");
        const src = parseSrc(s.lesson)[i];
        ok(fb.includes(src[0]) && fb.includes(src[1]) && fb.includes(correct) && fb.includes(choice), `feedback content L${s.lesson} q${i}`);
      }
      if (rapid) await p.locator("#next").evaluate((el) => { el.click(); el.click(); el.click(); });
      else await p.locator("#next").click();
      await waitMove(p, i);
    }
    ok((await st(p)).score <= s.total, "score never exceeds total");
  }
  return seen;
}

async function checkDone(p, pattern) {
  const s = await st(p);
  const exp = [...Array(s.total).keys()].filter(pattern).length;
  ok(s.status === "completed", `L${s.lesson} completed`);
  ok(s.score === exp, `L${s.lesson} score ${s.score} vs ${exp}`);
  ok((await p.textContent("#final-score")).trim() === `${exp} / ${s.total}`, "final score text");
  ok((await p.textContent("#n-wrong")).trim() === String(s.total - exp), "incorrect count");
  ok((await p.textContent("#final-pct")).includes(`${Math.round((exp / s.total) * 100)}%`), "percentage");
  const ids = s.wrong.map((w) => w.id);
  ok(new Set(ids).size === ids.length, "no duplicate wrong records");
  ok(ids.length === s.total - exp, `wrong records ${ids.length}`);
  ok((await p.locator(".review li").count()) === s.total - exp, "review rows");
  if (exp === s.total) { ok((await p.locator(".perfect").count()) === 1, "perfect message"); ok((await p.locator(".review").count()) === 0, "no empty review"); }
  ok((await p.locator(".opt").count()) === 0, "no empty question after the end");
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const go = async (n) => { await p.goto(`${BASE}/?debug#/lesson/${n}`); await p.reload(); await p.waitForSelector("#prompt"); };

  // ================= DATA, ALL LESSONS =================
  await go(16);
  const DATA = await p.evaluate(() => window.__quizDebug.DATA);
  ok(Object.keys(DATA).map(Number).join() === Object.keys(EXPECTED).join(), "lessons 16–30 present");
  let totalWords = 0;
  for (const n of Object.keys(EXPECTED)) {
    const L = DATA[n], src = parseSrc(n);
    ok(L.words.length === EXPECTED[n], `L${n} has ${L.words.length}, expected ${EXPECTED[n]}`);
    ok(L.words.length === src.length, `L${n} data matches source line count`);
    totalWords += L.words.length;
    const seenJa = new Set();
    L.words.forEach((w, i) => {
      ok(w.ja === src[i][0] && w.romaji === src[i][1] && w.en === src[i][2], `L${n} #${i + 1} matches source`);
      ok(w.distractors.length === 3 && new Set(w.distractors).size === 3 && !w.distractors.includes(i + 1), `L${n} #${i + 1} distractor shape`);
      const opts = [w.en, ...w.distractors.map((k) => L.words[k - 1].en)];
      ok(new Set(opts.map((o) => o.toLowerCase())).size === 4, `L${n} #${i + 1} options unique`);
      w.distractors.forEach((k) => ok(L.words[k - 1].en !== w.en, `L${n} #${i + 1} distractor repeats correct meaning`));
      seenJa.add(w.id);
    });
    ok(seenJa.size === L.words.length, `L${n} each entry once`);
  }
  console.log(`Data: 15 lessons, ${totalWords} words validated`);

  // ================= HEADER / ROUTING =================
  const tabs = await p.$$eval("#lesson-nav button", (bs) => bs.map((b) => b.textContent));
  ok(tabs.length === 15 && tabs[0] === "Lesson 16" && tabs[14] === "Lesson 30", "header has Lesson 16…30");
  await p.click('#lesson-nav button[data-lesson="23"]');
  await p.waitForFunction(() => window.__quizDebug.getState().lesson === 23);
  ok(p.url().endsWith("#/lesson/23"), "tab updates URL hash");
  ok((await p.getAttribute('#lesson-nav button[data-lesson="23"]', "aria-current")) === "true", "active tab marked");
  ok((await p.textContent("#lesson-title")).trim() === "Lesson 23", "title shows lesson");
  ok(await p.evaluate(() => { const s = window.__quizDebug.getState(); return s.words[0].ja; }) === (await prompt(p)), "prompt is the first word");
  await p.goto(`${BASE}/?debug#/lesson/99`); await p.waitForSelector("#prompt");
  ok((await st(p)).lesson === 16 || (await st(p)).lesson === 23, "invalid hash falls back to a real lesson");

  // prompt shows Japanese only (no romaji / latin letters under it)
  await go(18);
  ok(!/[A-Za-z]/.test(await p.textContent(".prompt")), "prompt has no latin letters (romaji hidden)");

  // ================= EVERY LESSON: perfect run + restart =================
  for (const n of Object.keys(EXPECTED)) {
    await go(n);
    const before = (await st(p)).options;
    const seen = await play(p, () => true, { rapid: n % 2 === 0 });
    ok(JSON.stringify(seen) === JSON.stringify((await st(p)).ja), `L${n} order = textbook order, nothing skipped`);
    await checkDone(p, () => true);
    await p.click("#restart");
    const s = await st(p);
    ok(s.status === "question" && s.index === 0 && s.score === 0 && s.wrong.length === 0, `L${n} restart resets`);
    if (EXPECTED[n] > 12) ok(JSON.stringify(s.options) !== JSON.stringify(before), `L${n} restart reshuffles`);
    ok(JSON.stringify(s.correct) === JSON.stringify(DATA[n].words.map((w) => w.en)), `L${n} restart keeps order/answers`);
  }
  console.log("Perfect run + restart: all 15 lessons");

  // ================= EVERY LESSON: all wrong =================
  for (const n of Object.keys(EXPECTED)) {
    await go(n);
    await play(p, () => false, { rapid: n % 2 === 1 });
    await checkDone(p, () => false);
    const rv = await p.textContent(".review");
    ok(DATA[n].words.every((w) => rv.includes(w.ja)), `L${n} review lists every word`);
    await p.click("#restart");
    const s = await st(p);
    ok(s.index === 0 && s.score === 0 && s.wrong.length === 0 && (await p.locator(".review").count()) === 0, `L${n} restart clears review`);
  }
  console.log("All-wrong run: all 15 lessons");

  // ================= MIXED: wrong on Q1, consecutive wrongs, wrong on last =================
  for (const n of [16, 19, 22, 30]) {
    await go(n);
    const total = EXPECTED[n];
    const wrongSet = new Set([0, 3, 4, 5, total - 1]);
    await play(p, (i) => !wrongSet.has(i));
    await checkDone(p, (i) => !wrongSet.has(i));
    const rv = await p.textContent(".review");
    ok(rv.includes(DATA[n].words[0].ja) && rv.includes(DATA[n].words[total - 1].ja), `L${n} Q1 and last in review`);
  }

  // ================= LESSON SWITCHING KEEPS PROGRESS =================
  await go(17);
  for (let i = 0; i < 3; i++) { const s = await st(p); await p.locator(".opt").nth(s.options[i].indexOf(s.correct[i])).click(); await waitMove(p, i); }
  const wrongIdx = 3; let s = await st(p);
  await p.locator(".opt").nth(s.options[wrongIdx].findIndex((o) => o !== s.correct[wrongIdx])).click();
  await p.click('#lesson-nav button[data-lesson="20"]');
  await p.waitForFunction(() => window.__quizDebug.getState().lesson === 20);
  ok((await st(p)).index === 0 && (await st(p)).score === 0, "other lesson starts fresh");
  await p.click('#lesson-nav button[data-lesson="17"]');
  await p.waitForFunction(() => window.__quizDebug.getState().lesson === 17);
  s = await st(p);
  ok(s.index === 3 && s.score === 3 && s.wrong.length === 1 && s.status === "wrong_answer_feedback", "returning to a lesson resumes it (wrong answers not lost)");
  ok((await p.locator("#next").count()) === 1, "Next button still shown on resume");
  // switch away during the 'Correct' flash → resumes on the next question
  await p.click("#next"); await waitMove(p, 3);
  s = await st(p);
  await p.locator(".opt").nth(s.options[4].indexOf(s.correct[4])).click();
  await p.click('#lesson-nav button[data-lesson="21"]');
  await p.click('#lesson-nav button[data-lesson="17"]');
  await p.waitForFunction(() => window.__quizDebug.getState().lesson === 17);
  await sleep(700);
  s = await st(p);
  ok(s.index === 5 && s.score === 4 && s.status === "question", `switching during correct flash advances once (idx ${s.index}, score ${s.score})`);

  // ================= RAPID TAPS (real clicks) =================
  await go(22);
  s = await st(p);
  const right = p.locator(".opt").nth(s.options[0].indexOf(s.correct[0]));
  await Promise.all([right.click({ force: true, timeout: 800 }).catch(() => {}), right.click({ force: true, timeout: 800 }).catch(() => {}), right.click({ force: true, timeout: 800 }).catch(() => {})]);
  await sleep(900);
  s = await st(p);
  ok(s.score === 1 && s.index === 1, `rapid tapping the right answer scores once (score ${s.score}, idx ${s.index})`);

  // ================= POSITION DISTRIBUTION =================
  const pos = [0, 0, 0, 0];
  for (let k = 0; k < 15; k++) { await p.reload(); await p.waitForSelector("#prompt"); const x = await st(p); x.options.forEach((o, i) => pos[o.indexOf(x.correct[i])]++); }
  ok(pos.every((c) => c > 0.15 * pos.reduce((a, b) => a + b)), `correct answer lands in A–D: ${pos}`);
  console.log("Correct-position distribution (A,B,C,D):", pos.join(", "));

  // ================= LAYOUT: phone / tablet / desktop =================
  for (const [w, h, name] of [[375, 740, "phone"], [820, 1180, "tablet"], [1280, 800, "desktop"]]) {
    await p.setViewportSize({ width: w, height: h });
    for (const n of [16, 19, 29]) {
      await go(n);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      ok(sw <= w, `${name} L${n}: no horizontal page scroll (${sw}>${w})`);
      const hs = await p.$$eval(".opt", (bs) => bs.map((b) => b.getBoundingClientRect().height));
      ok(hs.length === 4 && hs.every((x) => x >= 44), `${name} L${n}: four tap targets >= 44px`);
      const nav = await p.$$eval("#lesson-nav button", (bs) => bs.map((b) => b.getBoundingClientRect().height));
      ok(nav.every((x) => x >= 44), `${name}: header buttons >= 44px`);
      const radii = await p.$$eval(".opt", (bs) => bs.map((b) => { const c = getComputedStyle(b); return [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomLeftRadius, c.borderBottomRightRadius].join(); }));
      ok(new Set(radii).size === 1 && radii[0] === "12px,12px,12px,12px", `${name}: all option corners share one radius`);
    }
    await go(19);
    await p.screenshot({ path: `${SHOTS}/${name}-quiz.png` });
  }
  // long prompt + wrong feedback + results on phone
  await p.setViewportSize({ width: 375, height: 740 });
  await go(21);
  await p.screenshot({ path: `${SHOTS}/phone-lesson21.png` });
  s = await st(p);
  await p.locator(".opt").nth(s.options[0].findIndex((o) => o !== s.correct[0])).click();
  await p.screenshot({ path: `${SHOTS}/phone-wrong.png` });
  await p.click("#next");
  await go(22);
  await play(p, (i) => i % 4 !== 0, { checkFeedback: false });
  await p.screenshot({ path: `${SHOTS}/phone-results.png`, fullPage: true });
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 375, "phone results: no horizontal scroll");

  // ================= TOUCH: no sticky hover on next question =================
  const tctx = await browser.newContext({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });
  const t = await tctx.newPage();
  await t.goto(`${BASE}/?debug#/lesson/18`); await t.waitForSelector("#prompt");
  s = await st(t);
  await t.locator(".opt").nth(s.options[0].indexOf(s.correct[0])).tap();
  await t.waitForFunction(() => window.__quizDebug.getState().index === 1);
  const cols = await t.$$eval(".opt", (bs) => bs.map((b) => getComputedStyle(b).borderTopColor));
  ok(new Set(cols).size === 1, `touch: no dark hover border after tap (${[...new Set(cols)]})`);

  // ================= persistence of last lesson + no console errors =================
  await p.goto(`${BASE}/?debug#/lesson/27`); await p.reload();
  await p.goto(`${BASE}/?debug`); await p.waitForSelector("#prompt");
  ok((await st(p)).lesson === 27, "remembers last opened lesson");
  ok(errors.length === 0, "no console/page errors: " + errors.join("; "));

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
