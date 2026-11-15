# Agent handoff: where the project stands

Updated 2026-11-15 for the next agent. The repository state was verified on `main` at commit
`a2fa9407bfcdaf18239df3558be1a0683fcc8881`. The remote branch `feature/register-order-and-handoff` was deleted at the user's request; this repository operation did not create a commit. Only `main` remains locally and on GitHub. The working tree contains the uncommitted handoff-policy updates to `AGENTS.md` and this file.

## Latest handoff action
- Added a permanent repository rule requiring `docs/HANDOFF.md` to be refreshed before every completed task ends.
- Future handoffs must include the exact `HEAD` SHA, branch and working-tree state, completed work, verification, and remaining work or blockers.
- Verification: `git branch -r --list` showed only `origin/main`; `git rev-parse HEAD` returned the SHA above.
- Remaining step: these documentation changes are intentionally uncommitted because the user did not request a commit.

## 1. The project in one paragraph
A free static Japanese study site (GitHub Pages) for *Book Hakase 2*, Lessons 16–30 (498 words). Learners take a 4-choice vocabulary quiz with game
mechanics (XP, levels, combos, streaks, stars). Two big features sit on top: the **N5 Kanji track** (JLPT-readiness oriented) and the **Vocabulary
study tools** (a study register and a voice practice). Owner: Ali / @iNuman. No backend, no accounts, progress in `localStorage`.

## 2. How to run, build and test
```
npm start                      # static server → http://localhost:8000   (serve.mjs; only serves index.html, css/, js/, data/)
npm run build                  # src/lessons/*.txt + src/examples/*.txt → data/lessons.js   (fails with a clear message on any problem)
npm run build:n5               # src/n5/* → data/n5.js   (CI uses `node tools/build-n5.mjs --strict`)
npm run verify:n5              # checks N5 readings against KANJIDIC2/JMdict (needs network)
npm run test:study             # unit tests for js/study/*   (≈40 tests)
npm run test:n5                # unit tests for js/n5/*      (≈100 tests)      → together: 138 pass
```
Browser (end-to-end) tests drive real Chrome/Edge through a tiny DevTools-protocol client (`tests/n5/cdp.mjs`, no dependencies; finds Chrome/Edge on Windows):
```
node serve.mjs 8001 &                                   # any free port
BASE=http://localhost:8001 node tests/study/browser-smoke.mjs     # 125 checks: register, speak practice, auto-listen, timer pause…
BASE=http://localhost:8001 node tests/n5/browser-smoke.mjs        # 73 checks: N5 track
SHOTS=<dir> …                                            # optional: saves screenshots of key screens
```
CI (`.github/workflows/check.yml`): syntax-checks `js/*.js js/n5/*.js js/study/*.js tools/*.mjs`, rebuilds both data files and fails if they differ
from what is committed, then runs both unit test folders. `tests/e2e.js` is an old Playwright script for the vocabulary quiz; Playwright is not installed
here, so it was **not run** in this work.

## 3. Repository map
| Path | What |
| --- | --- |
| `index.html`, `css/styles.css` | page + styles; tokens (`--bg`, `--accent`, `--grad` …) with automatic dark mode |
| `js/quiz-engine.js` | pure quiz logic (no DOM) · `js/game.js` XP/levels/combos/sounds · `js/app.js` rendering, routing, timer, Hint/Romaji helpers |
| `src/lessons/<n>.txt` → `data/lessons.js` | vocabulary (**generated file; never edit by hand**) |
| `src/examples/<n>.txt` | one example sentence per word + other written forms (see §5) |
| `js/study/` + `css/study.css` | the study tools: `forms.js`, `matcher.js`, `practice.js`, `speech.js` (all pure/injectable) and `ui.js` (the only DOM file) |
| `js/n5/`, `css/n5.css`, `src/n5/`, `data/n5.js`, `docs/n5.md` | the N5 Kanji track (separate modules; see `docs/n5.md`) |
| `tools/` | build scripts (`build-data.mjs` also validates examples), furigana (`furigana.mjs`), grammar labels, N5 verification |
| `tests/study/`, `tests/n5/` | unit + browser tests |
| `docs/vocab-study.md` | the full spec for the study tools: rules and every corner case (read this before touching `js/study/`) |

## 4. What is done (all merged to `main`)
1. **Vocabulary quiz** (pre-existing): 15 lessons, timer mode, Hint (grammar label) and Romaji helper (half XP), fancy transitions, HUD.
2. **N5 Kanji track, Phases 1–2 of 5** (approved by the user; 18 kanji over 3 days; spaced review; mastery per kanji). Phases 3–5 are **not** approved yet (§7).
3. **Study tools** (this session):
   - Two pills **📖 Vocab** and **🎙 Speak** inside the quiz card, in the same row as Hint/Romaji (`data-study="vocab|speak"`, listened to by `ui.js` through a
     document-level click handler because the quiz re-renders its card).
   - **Vocabulary register**: full-page dialog, two newspaper-style columns (`column-count`), compact cards showing word + furigana, romaji, meaning, example
     sentence + English. "Red sheet" cover modes (cover meaning / cover Japanese, tap a card to peek), ✓ known ticks (remembered per lesson in
     `localStorage`), hide-known, shuffle, **reading order toggle** (⇆ Across = 1 2 / 3 4, the default, or ⇅ Down = 1 3 / 2 4; CSS grid vs `column-count`, remembered), text size, 🔊 buttons (only with a Japanese voice). Text sizes depend on word length so nothing overflows.
   - **Speak practice**: two directions (hear English → say Japanese, hear Japanese → say English), voice via the Web Speech API, typed fallback, queue that repeats
     misses (miss → back after 3 cards, needs 2 correct in a row), streak chip, summary with ring/stars/hardest words, **auto-listen** (mic opens by itself once the
     assistant finished speaking; once per prompt; tap always works; on/off link, remembered), "I said it right" override after a spoken miss.
   - **Answer judging**: Japanese is exact (kana/kanji/ます-or-dictionary form/optional parts/katakana↔hiragana/romaji) **plus every kanji↔kana mix** of each spelling,
     derived from the word's reading (the recogniser writes 甘いもの for あまい物). English ignores articles/"to"/notes, allows 1 letter of noise in words ≥5 letters.
   - 498 example sentences with furigana; 22+179 `alt` spellings. Build validates them.

## 5. Decisions and rules (do not undo without asking the user)
- **Quality bar from the user:** "highest level clean code, not random complex AI code": every piece has a clear purpose, is tested, no regressions to existing
  quiz/N5 behaviour; plan use cases and corner cases before coding. Cosmetics matter a lot: *simple, eye-catching, addictive*; text must never overflow cards.
- **Practice is not scored:** no XP/stars/streak effect. Opening the register mid-quiz pauses the countdown; after the first answer it counts like using Romaji
  (`ui(current).used = true` in the `onOpen` hook in `js/app.js`); reading before the first answer is free.
- **Logic stays out of the DOM:** `forms/matcher/practice/speech` are pure or injectable and unit-tested under `node --test` (they load into a `vm` sandbox, see
  `tests/study/load.mjs`). `ui.js` only draws and wires. Each dialog clears only its own state on `close` (the event is asynchronous; this was a real bug).
- **Example file format** (`src/examples/<n>.txt`): `headword | sentence with 漢字{よみ} | English | other written forms (optional)`. `=` instead of a sentence marks an
  entry that is itself a sentence. The headword must equal the entry's Japanese in `src/lessons/<n>.txt` (pairs lines with entries). The build rejects: bare
  kanji, non-hiragana readings, a sentence that doesn't use its word (stems allowed for verbs/adjectives), empty English, an `alt` that is already accepted.
  To fix a recogniser miss, add the kanji spelling in the last column; mixed spellings are derived automatically.
- **N5 track rules (from the user, keep holding):** never equate recognition with mastery (a hinted answer is half credit and never advances the schedule); readiness
  = demonstrated performance per area, never lessons completed; content verified against KANJIDIC2/JMdict, never invent readings or force unnatural Japanese,
  flag content needing review; listening is out of the first release but the architecture must allow it; default 6 new kanji/day; existing vocabulary lessons stay untouched.
- **Process:** do not commit, push or delete branches unless asked; `main` is protected (PRs). Ask before destructive actions.

## 6. Gotchas learned the hard way
- **Line endings:** the repo mixes CRLF and LF. Running `npm run build` / `build:n5` on Windows rewrites `data/lessons.js` / `data/n5.js` with LF, which shows up as a
  whole-file diff. If `git diff --ignore-cr-at-eol --stat` is empty, just `git checkout -- data/lessons.js data/n5.js`. When editing `js/app.js` programmatically, keep CRLF.
- **`String.replace` with `$&`/`$1` in the replacement** silently corrupts code (it happened once). Use a function replacement or the editor tool.
- **Bash tool + heredocs** with quotes/backticks broke twice; write scripts to a file with the editor tool, then run them.
- `<dialog>`'s `close` event is async; `window.speechSynthesis` is a read-only accessor (use `Object.defineProperty` when faking it); Chrome needs the utterance
  referenced until `end` (done in `speech.js`).
- Browser tests are timing-sensitive on purpose-built waits; if a test fails, first check you started a server on the port `BASE` points to.
- The dev machine's Windows has no Japanese voice by default (Settings → Time & language → Speech), so the 🔊 buttons stay hidden there.

## 7. Open items / what to do next (in priority order; ask the user before starting any)
1. **N5 Phases 3–5 need explicit user approval first:** full kanji set + mastery map + export/import; JLPT-format question banks + mock exams; grammar/listening.
2. **Native-speaker review** of `src/examples/*.txt` (sentences, English, `alt` spellings) and of N5 sentences/passages (`docs/n5-review-sheet.md`). The UI says they are unreviewed.
3. **Real-device verification** (never done): a real microphone, a real Japanese voice, phone swipe/scroll of the register, Safari (it may refuse auto-listen without a tap;
   the code then shows the normal message and the tap still works), Firefox (no recognition → typed answers).
4. Possible follow-ups the user has not asked for: remember weak words across practice sessions; pronunciation scoring; ticks from the register feeding the quiz.
5. `README.md` still calls the N5 track "a 3-day vertical slice (18 kanji)". That is accurate today; update it when Phase 3 lands.

## 8. How to resume in two minutes
```
git checkout main && git pull
npm run test:study && npm run test:n5          # expect 138 passing
npm start                                       # open http://localhost:8000, open a lesson, try 📖 Vocab and 🎙 Speak
```
Then read `docs/vocab-study.md` (study tools) or `docs/n5.md` (N5 track) depending on the task, and ask the user what to do next. The last thing the user asked for
before this handoff was branch clean-up (done: only `main` exists). The last product change was fixing recogniser mismatches such as 甘いもの for あまい物.
