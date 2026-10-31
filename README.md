# lesson-quiz

A free, fast Japanese vocabulary quiz for **Lessons 16–30 of *Book Hakase 2***.

**Live:** https://inuman.github.io/lesson-quiz/

## Why this exists

Reading a word list is easy to skim and quick to forget. This quiz makes you recall each word instead:
you see a Japanese word (with hiragana readings above kanji), pick the right English meaning from four
choices, and get instant feedback. At the end you get a review of every word you missed.

To keep you coming back it is built like a game: XP, levels, answer combos, a daily streak and goal,
and up to three stars per lesson. Your progress is saved in your browser only. There are no accounts and no server.

## Run it on your machine

You only need a browser. There is nothing to install.

**Quickest:** download or clone the repo and open `index.html`.

**With a local server** (needs [Node.js](https://nodejs.org) 18 or newer):

```
git clone https://github.com/iNuman/lesson-quiz.git
cd lesson-quiz
npm start
```

Then open http://localhost:8000.

## Project layout

| Path | What it does |
| --- | --- |
| `index.html`, `css/styles.css` | Page and styling |
| `js/quiz-engine.js` | Quiz logic (no DOM) |
| `js/game.js` | XP, levels, combos, streaks, sounds, effects |
| `js/app.js` | Rendering and navigation |
| `src/lessons/<n>.txt` | The vocabulary, one file per lesson |
| `data/lessons.js` | **Generated** from `src/lessons`. Don't edit by hand |

## Contributing

Ideas, fixes and vocabulary corrections are welcome. `main` is protected, so every change goes through a pull request.

1. Fork the repo and create a branch: `git checkout -b my-change`
2. Make your change and try it in the browser.
3. Open a pull request. A short automatic check runs, and the owner reviews before merging.

Not a developer? Use the **Suggestions** button on the site to send an idea by email.

### Editing vocabulary

Each line in `src/lessons/<n>.txt` is:

```
japanese | romaji | english | type
```

For example: `まど | mado | Window | n`. After editing, run the build and commit the result:

```
npm run build
```

This regenerates `data/lessons.js`. It fails with a clear message if any question would not end up with
exactly four unique choices. The automatic check on pull requests fails if you forget to commit
`data/lessons.js`.

## Deploying

The site is plain static files, so any static host works. It is published with GitHub Pages
(Settings → Pages → deploy from branch `main`, folder `/ (root)`).

## Author

Made with love by Ali ([GitHub](https://github.com/iNuman) · [LinkedIn](https://www.linkedin.com/in/-inuman/)).
See [CONTRIBUTING.md](CONTRIBUTING.md) for more on helping out.
