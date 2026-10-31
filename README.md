# lesson-quiz — From Book Hakase 2 (Lessons 16–30)

Gamified Japanese vocabulary quiz: XP, levels, combos, daily streak and goal, stars per lesson.
Made by Ali Noman · [GitHub](https://github.com/iNuman) · [LinkedIn](https://www.linkedin.com/in/-inuman/) · inuumaan@gmail.com ·
[Suggest an idea](https://github.com/iNuman/lesson-quiz/issues/new) · see [CONTRIBUTING.md](CONTRIBUTING.md)

A fully static site (no server code, no dependencies). Four-choice Japanese→English quiz for each lesson,
automatic advance on a correct answer, manual "Next Question" after a wrong one, and a wrong-answer review.

**Live:** https://inuman.github.io/lesson-quiz/

## Run locally
    node serve.mjs 8000        # or: npm start
    # then open http://localhost:8000
Any static server works too (`python3 -m http.server 8000`). Opening `index.html` directly also works.

## Deploy later
Upload these to any static host (GitHub Pages, Netlify, Cloudflare Pages, …):
`index.html`, `css/`, `js/`, `data/`. Nothing else is needed. Links like `…/#/lesson/23` open that lesson.

## Editing vocabulary
Words live in `src/lessons/<n>.txt`, one per line: `japanese | romaji | english | type`.
(Lesson 18 also lists hand-picked wrong-answer choices as a 5th column.)
After editing run `node tools/build-data.mjs` — it regenerates `data/lessons.js` and fails if any question
would not have exactly four unique options.

## Tests
    node serve.mjs 8000 &
    NODE_PATH=$(npm root -g) node tests/e2e.js     # needs Playwright
