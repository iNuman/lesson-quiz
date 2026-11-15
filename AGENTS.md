# Agent instructions (lesson-quiz)

Read **[docs/HANDOFF.md](docs/HANDOFF.md)** first: it has the current state, decisions, rules, gotchas and next steps, so you can continue
from exactly where the previous agent stopped instead of re-exploring the project.

Quick facts
- Static site (plain HTML/CSS/JS, no build step for the browser). Node 22+ only for tools and tests. Run: `npm start` → http://localhost:8000
- Tests: `npm run test:study` and `npm run test:n5` (unit); browser tests need a local server (see HANDOFF.md §6).
- Generated files (`data/lessons.js`, `data/n5.js`) are never edited by hand: change `src/` and run `npm run build` / `npm run build:n5`.
- Do not commit, push, or delete branches unless the user asks. `main` is protected: changes go through a pull request.
