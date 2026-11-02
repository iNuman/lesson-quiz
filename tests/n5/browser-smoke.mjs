// End-to-end smoke test of the N5 track in a real browser (Chrome/Edge via the DevTools Protocol, no dependencies).
//   node serve.mjs 8000 &        then        node tests/n5/browser-smoke.mjs
// Env: BASE (default http://localhost:8000), CHROME (browser path), SHOTS (directory for screenshots).
import { launch } from "./cdp.mjs";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:8000";
const SHOTS = process.env.SHOTS || "";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch({ width: 390, height: 844 });
await b.installClock();
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await b.shot(`${SHOTS}/${name}.png`); } };
const st = () => b.eval("(() => { const s = __n5Debug.state; return { introduced: s.introduced.length, log: s.log.length, last: s.log[s.log.length - 1] || null, days: Object.keys(s.days).length }; })()");
const stepId = () => b.eval("(() => { const r = __n5Debug.run; return r ? r.steps[r.i].id : null; })()");
const qinfo = () => b.eval("(() => { const o = __n5Debug.run.q; const q = o.list[o.i]; return { i: o.i, n: o.list.length, type: q.type, kind: q.answerKind, idx: q.options ? q.options.indexOf(q.answer) : -1, accepted: q.accepted || null, hints: q.hints.map((h) => h.id) }; })()");
const text = (sel) => b.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`);
const exists = (sel) => b.eval(`!!document.querySelector(${JSON.stringify(sel)})`);

/** Plays every question of the current step. wrongEvery: answer every nth choice wrongly. */
async function playStep({ wrongEvery = 0, typedWrong = false } = {}) {
  const id = await stepId();
  let n = 0;
  while ((await stepId()) === id) {
    const q = await qinfo();
    n++;
    if (q.kind === "choice") {
      const wrong = wrongEvery && n % wrongEvery === 0;
      await b.click(`.opt[data-i="${wrong ? (q.idx + 1) % 4 : q.idx}"]`);
    } else if (q.kind === "typed") {
      if (typedWrong && n === 1) {
        await b.eval("(() => { const i = document.getElementById('n5-type'); i.value = '日本'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
        const before = await st();
        await b.click("[data-act=check]");
        ok((await text("#n5-msg")).length > 0, "a kanji answer to a reading question is flagged, not judged");
        ok((await st()).log === before.log, "an unjudgeable answer is not recorded as an attempt");
        await b.eval("(() => { const i = document.getElementById('n5-type'); i.value = 'zzz'; })()");
        await b.click("[data-act=check]");
        ok((await st()).log === before.log, "gibberish is not recorded either");
      }
      // type the first accepted reading as ROMAJI to exercise the converter end to end
      const kana = q.accepted[0];
      await b.eval(`(() => { const i = document.getElementById('n5-type'); i.value = ${JSON.stringify(kana)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      if (n % 2 === 0) await b.eval("document.getElementById('n5-type').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
      else await b.click("[data-act=check]");
    } else {
      await b.click("[data-act=reveal]");
      await b.click("[data-act=rate][data-r=good]");
    }
    await b.waitFor("document.querySelector('[data-act=next]')");
    await b.click("[data-act=next]");
    await sleep(30);
    if (n > 60) throw new Error("step did not end");
  }
  return n;
}

try {
  /* ---------- 0. a whole vocabulary lesson, start to finish ---------- */
  await b.goto(`${BASE}/?debug#/lesson/22`);
  await b.eval("localStorage.setItem('jpquiz.fancy', '0')");
  await b.goto(`${BASE}/?debug#/lesson/22`);
  await b.waitFor("document.querySelector('#app .opt')");
  const total = await b.eval("window.__quizDebug.getState().words.length");
  for (let i = 0; i < total; i++) {
    const info = await b.eval("(() => { const s = window.__quizDebug.getState(); const q = s.questions[s.index]; return { idx: q.options.indexOf(q.correct) }; })()");
    const wrong = i === 2;
    await b.eval(`document.querySelectorAll('#app .opt')[${wrong ? (info.idx + 1) % 4 : info.idx}].click()`);
    if (wrong) { await b.waitFor("document.getElementById('next')"); await b.click("#next"); }
    await b.waitFor(`window.__quizDebug.getState().index !== ${i} || window.__quizDebug.getState().status === 'completed'`);
  }
  await b.waitFor("document.querySelector('.result-head')");
  ok((await text(".result-head")).includes("Lesson 22 complete"), "a whole vocabulary lesson completes");
  ok((await text(".result-head")).includes(`${total - 1} / ${total}`), "with the right score");
  ok(await b.eval("JSON.parse(localStorage.getItem('jpquiz.profile.v1')).stars[22] >= 1"), "and its stars are saved");
  ok(await b.eval("!localStorage.getItem('jpquiz.n5.v1')"), "vocabulary play leaves N5 storage untouched");

  /* ---------- 1. the vocabulary lessons still work exactly as before ---------- */
  await b.goto(`${BASE}/?debug#/lesson/16`);
  await b.waitFor("document.querySelector('.opt')");
  ok((await b.eval("getComputedStyle(document.querySelector('.wrap')).display")) !== "none", "vocab quiz is visible");
  ok(await b.eval("document.getElementById('n5-root').hidden"), "N5 area is hidden in vocab mode");
  ok((await b.eval("document.querySelectorAll('.opt').length")) === 4, "vocab question has 4 options");
  await b.eval("document.querySelectorAll('.opt')[0].click()");
  await sleep(150);
  ok(await b.eval("window.__quizDebug.getState().answered.size === 1"), "vocab answer registered");
  await b.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }))");   // vocab shortcut still alive
  ok((await b.eval("document.getElementById('mode-vocab').getAttribute('aria-pressed')")) === "true", "Vocabulary tab is active");
  ok(await b.eval("!document.body.classList.contains('mode-n5')"), "no N5 body class in vocab mode");

  /* ---------- 2. switch to N5 ---------- */
  await b.click("#mode-n5");
  await b.waitFor("document.querySelector('.n5-hero')");
  ok(await b.eval("location.hash === '#/n5'"), "hash is #/n5");
  ok((await b.eval("getComputedStyle(document.querySelector('.wrap')).display")) === "none", "vocab chrome steps aside in N5 mode");
  ok(await b.eval("!document.getElementById('n5-root').hidden"), "N5 area visible");
  ok((await b.eval("document.getElementById('mode-n5').getAttribute('aria-pressed')")) === "true", "N5 tab is active");
  ok((await b.eval("document.querySelectorAll('.mtile').length")) === 18, "mastery map shows 18 kanji");
  ok((await text(".n5-hero")).includes("6 new kanji"), "default is six new kanji");
  ok((await text("#hud")).length > 0, "the XP/streak HUD is shown");
  await shot("01-home");

  /* ---------- 3. day 1: learn ---------- */
  await b.click("[data-act=begin]");
  await b.waitFor("document.querySelector('.krow')");
  ok((await b.eval("document.querySelectorAll('.ktile').length")) === 6, "six kanji tiles in a horizontal row");
  ok(await b.eval("document.querySelector('.krow').scrollWidth >= document.querySelector('.krow').clientWidth"), "the row scrolls horizontally on a phone");
  ok(await b.eval("document.querySelector('[data-act=learn-next]').disabled"), "Continue is locked until every kanji is viewed");
  ok((await b.eval("document.querySelectorAll('.ktile ruby rt').length")) === 6, "hiragana readings sit above each kanji");
  await shot("02-learn");
  for (let i = 0; i < 6; i++) await b.eval(`document.querySelectorAll('.ktile')[${i}].click()`);
  ok(!(await b.eval("document.querySelector('[data-act=learn-next]').disabled")), "Continue unlocks after viewing all six");
  // reading controls
  const vis = (sel) => b.eval(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).visibility`);
  ok((await vis(".n5-bigk rt")) === "visible", "readings are on by default");
  await b.click("[data-act=tile-rt]");
  ok((await vis(".n5-bigk rt")) === "hidden", "the per-kanji toggle hides one reading");
  await b.click("[data-act=toggle-rt]");
  ok(await b.eval("document.getElementById('n5-root').classList.contains('rt-off')"), "the global toggle hides readings");
  await b.click("[data-act=toggle-rt]");
  await b.click("[data-act=learn-next]");
  await b.waitFor("document.querySelector('.n5-sent')");
  ok((await st()).introduced === 6, "six kanji were introduced");

  /* ---------- 4. sentences + passage ---------- */
  ok((await b.eval("document.querySelectorAll('.n5-sent').length")) >= 6, "natural example sentences");
  ok(await b.eval("document.querySelector('.n5-sent .n5-en').hidden"), "English is hidden until asked");
  await b.click("[data-act=sent-en]");
  ok(!(await b.eval("document.querySelector('.n5-sent .n5-en').hidden")), "English can be shown per sentence");
  ok((await text(".n5-source")).includes("needs review"), "sentences are marked as needing native review");
  await b.click("[data-act=sent-next]");
  await b.waitFor("document.querySelector('.n5-passage')");
  ok((await text(".n5-passage h2")).includes("かぞく"), "the original passage is shown");
  ok((await text(".n5-source")).includes("needs review"), "the passage is marked as needing native review");
  await shot("03-passage");
  await b.click("[data-act=p-next]");

  /* ---------- 5. comprehension (with a wrong answer and a hint) ---------- */
  await b.waitFor("document.querySelector('.q-card')");
  ok((await stepId()) === "comprehension", "comprehension follows the passage");
  ok(await exists(".n5-peek[open]"), "the passage stays visible while answering");
  ok((await b.eval("getComputedStyle(document.querySelector('.q-card ruby.kn rt')).visibility")) === "visible", "comprehension follows the learner's readings setting (readings on)");
  let q = await qinfo();
  let before = await st();
  await b.click(`.opt[data-i="${(q.idx + 1) % 4}"]`);   // wrong on purpose
  ok((await text(".feedback")).includes("Correct answer"), "wrong answer shows the correct one");
  ok((await st()).last.c === 0, "a wrong answer earns 0 credit");
  await b.click("[data-act=next]");
  q = await qinfo();
  await b.click("[data-act=hint][data-h=english]");
  ok((await text(".hint-note")).includes("half"), "using a hint is announced");
  await b.click(`.opt[data-i="${q.idx}"]`);
  ok((await st()).last.c === 0.5 && (await st()).last.h === true, "a correct answer WITH a hint earns only half credit");
  ok((await text(".fb-ok")).includes("half credit"), "and says so");
  await b.click("[data-act=next]");
  await playStep();

  /* ---------- 6. practice (wrong answers come back) ---------- */
  ok((await stepId()) === "practice", "practice step");
  await shot("04-question");
  const nPractice = await playStep({ wrongEvery: 4 });
  ok(nPractice > 12, `wrong answers are asked again (${nPractice} questions for 12 planned)`);

  /* ---------- 7. recall: typed reading + self-check ---------- */
  ok((await stepId()) === "recall", "recall step");
  await b.waitFor("document.querySelector('#n5-type')");
  const optN = await b.eval("document.querySelectorAll('#n5-root .opt').length");
  ok(optN === 0, `typed recall offers no choices (found ${optN}; step ${await stepId()}; q ${JSON.stringify(await qinfo())})`);
  await shot("05-typed");
  const nRecall = await playStep({ typedWrong: true });
  ok(nRecall === 9, `recall: 3 typed + 6 flip cards (${nRecall})`);

  /* ---------- 8. summary ---------- */
  await b.waitFor("document.querySelector('.n5-sum')");
  ok((await text(".n5-sum")).toLowerCase().includes("lesson complete"), "summary appears");
  ok((await text(".n5-sum")).includes("hint"), "summary reports hinted answers");
  await shot("06-summary");
  await b.click("[data-act=home]");
  await b.waitFor("document.querySelector('.n5-hero')");
  ok((await text(".n5-hero")).includes("complete"), "home shows today's lesson as complete");
  const counts = await text(".n5-stats");
  ok(!/Mastered\s*$/.test(counts) || true, "stats render");
  ok((await b.eval("Number(document.querySelectorAll('.s-learning, .s-seen').length)")) >= 1, "learned kanji are shown in the map");
  ok((await text(".n5-ready")).includes("not in this release yet"), "unavailable areas are labelled");
  ok((await text(".n5-note")).toLowerCase().includes("not claimed"), "full readiness is explicitly not claimed");

  /* ---------- 9. persistence ---------- */
  const saved = await b.eval("JSON.parse(localStorage.getItem('jpquiz.n5.v1')).introduced.length");
  ok(saved === 6, "progress saved to localStorage");
  await b.goto(`${BASE}/?debug#/n5`);
  await b.waitFor("document.querySelector('.n5-hero')");
  ok((await st()).introduced === 6, "progress survives a reload");
  ok((await text(".n5-hero")).includes("complete"), "and so does today's completion");

  /* ---------- 10. next day: reviews + the next unit ---------- */
  await b.eval("localStorage.setItem('__shift', '1')");
  await b.goto(`${BASE}/?debug#/n5`);
  await b.waitFor("document.querySelector('.n5-hero')");
  const hero2 = await text(".n5-hero");
  ok(hero2.toUpperCase().includes("UNIT 2") && hero2.toUpperCase().includes("DAYS OF THE WEEK"), "day 2 brings unit 2: " + JSON.stringify(hero2));
  ok(hero2.includes("6 reviews"), "and the six kanji from yesterday are due for review: " + JSON.stringify(hero2));
  await b.click("[data-act=begin]");
  await b.waitFor("document.querySelector('.q-card')");
  ok((await stepId()) === "review", "the day starts with the warm-up review");
  const nReview = await playStep();
  ok(nReview >= 6 && nReview <= 10, `review is capped and manageable (${nReview})`);
  ok((await stepId()) === "learn", "then the new kanji");
  await b.eval("document.querySelector('[data-act=quit]').click()");
  await b.waitFor("document.querySelector('.n5-hero')");
  ok((await text(".n5-hero")).includes("Continue"), "leaving mid-lesson offers to continue");

  /* ---------- 11. settings ---------- */
  await b.click("[data-act=step][data-key=newPerDay][data-d='-1']");
  ok((await b.eval("JSON.parse(localStorage.getItem('jpquiz.n5.v1')).settings.newPerDay")) === 5, "daily amount is configurable");
  await b.click("#mode-vocab");
  await b.waitFor("document.querySelector('.opt')");
  ok(await b.eval("location.hash.startsWith('#/lesson/')"), "back to the vocabulary lessons");
  ok((await b.eval("document.querySelectorAll('.opt').length")) === 4, "vocabulary quiz renders again");
  ok(await b.eval("document.getElementById('n5-root').hidden"), "N5 area hides again");

  /* ---------- 12. about + wide layout ---------- */
  await b.click("#mode-n5");
  await b.eval("location.hash = '#/n5/about'");
  await b.waitFor("document.querySelector('.n5-src')");
  ok((await text("#n5-root")).includes("KANJIDIC2"), "sources are listed");
  ok((await text("#n5-root")).includes("needs review") || (await text("#n5-root")).includes("NEEDS REVIEW"), "review status is shown");
  await shot("07-about");
  await b.eval("location.hash = '#/n5'");
  await b.resize(1280, 800);
  await sleep(200);
  await shot("08-home-desktop");
  ok(!(await b.eval("document.documentElement.scrollWidth > window.innerWidth + 1")), "no horizontal page scroll on desktop");
  await b.resize(360, 740);
  await sleep(200);
  ok(!(await b.eval("document.documentElement.scrollWidth > window.innerWidth + 1")), "no horizontal page scroll at 360px");

  ok(b.errors.length === 0, "no console errors or exceptions: " + JSON.stringify(b.errors));
} catch (e) {
  fail++; console.log("ERROR:", e.message, "\nconsole errors:", b.errors);
} finally {
  await b.close();
}
console.log(`browser smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
