# Contributing to lesson-quiz

Thanks for helping! Ideas, bug reports and pull requests are all welcome.

- **Suggest an idea / report a bug:** [open an issue](https://github.com/iNuman/lesson-quiz/issues/new).
- **Fix or add something:** fork the repo, create a branch, and open a pull request.

## Setup
    npm start            # serves the site at http://localhost:8000

No dependencies or build step. The code is plain HTML/CSS/JS:
- `js/quiz-engine.js` – pure quiz logic (no DOM)
- `js/game.js` – XP, levels, combos, streaks, sounds and effects
- `js/app.js` – rendering and routing
- `css/styles.css` – all styling

## Vocabulary changes
Edit `src/lessons/<n>.txt` (`japanese | romaji | english | type`), then run
`node tools/build-data.mjs` to regenerate `data/lessons.js`. See the README for details.

## Pull request tips
Keep changes small and focused, match the surrounding style, and play through a lesson in the
browser before submitting.

Maintainer: Ali Noman · [GitHub](https://github.com/iNuman) · [LinkedIn](https://www.linkedin.com/in/-inuman/) · inuumaan@gmail.com
