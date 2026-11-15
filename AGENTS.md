# Agent instructions (lesson-quiz)

Read **[docs/HANDOFF.md](docs/HANDOFF.md)** first: it has the current state, decisions, rules, gotchas and next steps, so you can continue
from exactly where the previous agent stopped instead of re-exploring the project.

Quick facts
- Static site (plain HTML/CSS/JS, no build step for the browser). Node 22+ only for tools and tests. Run: `npm start` → http://localhost:8000
- Tests: `npm run test:study` and `npm run test:n5` (unit); browser tests need a local server (see HANDOFF.md §6).
- Generated files (`data/lessons.js`, `data/n5.js`) are never edited by hand: change `src/` and run `npm run build` / `npm run build:n5`.
- Do not commit, push, or delete branches unless the user asks. `main` is protected: changes go through a pull request.

Handoff protocol
- Before ending every completed task, update `docs/HANDOFF.md` so the next agent can resume without reconstructing what happened.
- Record the exact verified `HEAD` commit SHA, current branch and working-tree state, what changed (including repository operations that did not create a commit), verification performed, and any remaining next step or blocker.
- If the task did not create a commit, say so explicitly and retain the existing `HEAD` SHA. Never create a commit solely to obtain a new handoff SHA unless the user asks for a commit.
