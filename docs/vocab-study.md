# Vocabulary study tools (Vocabulary list + Speak practice)

Two lesson-level tools for the vocabulary track, placed under the lesson title:

- **Vocabulary** opens a dialog that lists every word of the lesson: Japanese (hiragana over kanji), romaji, meaning and a short example
  sentence (also with hiragana over kanji), so the learner can read and remember *before* taking the quiz.
- **Speak practice** is a voice drill with two directions, chosen by the learner:
  - *Hear English, say Japanese* — the assistant says the meaning, the learner says the Japanese word.
  - *Hear Japanese, say English* — the assistant says the Japanese word, the learner says the meaning.
  The answer is judged right or wrong, the assistant moves on, and every miss comes back until it is answered correctly.

The buttons sit at lesson level (not next to Hint/Romaji) because those two are per-question helpers: a vocabulary list shown mid-question would
reveal the answer. Nothing in the existing quiz changes except two buttons, one keyboard guard and one small hook in `app.js`.

## Architecture

| File | Role | DOM? | Tested |
| --- | --- | --- | --- |
| `src/examples/<n>.txt` | one example per word: `headword \| sentence{よみ} \| English \| other written forms` | – | build + `examples.test.mjs` |
| `tools/build-data.mjs` | validates and merges `example` / `alt` into `data/lessons.js` (the build fails on any problem) | – | CI |
| `js/study/forms.js` | pure: every form a word can be said or typed in (kana, kanji, English alternatives) | no | yes |
| `js/study/matcher.js` | pure: judges a Japanese or English answer against a word | no | yes |
| `js/study/practice.js` | pure: the repeat-until-learned queue | no | yes |
| `js/study/speech.js` | thin adapter over `speechSynthesis` / `SpeechRecognition`; plain result values, never throws; injectable | window only | yes (fakes) |
| `js/study/ui.js` | the two dialogs; the only study file that touches the DOM | yes | `tests/study/browser-smoke.mjs` (real browser, scripted fake speech) |
| `css/study.css` | styles (light and dark through the existing tokens) | – | – |

Logic is separated from the browser, so every rule is a plain function unit-tested under `node --test` (`npm run test:study`).

## Rules

**Vocabulary list**
- All words of the lesson in lesson order, each as a card: word with furigana, romaji, meaning, example (Japanese with furigana, English).
- It is a full-page **register**: all words at once in compact cards, two columns on a phone (3-4 on wide screens), so one scroll covers the lesson.
  Reading order is **across** by default (1 2 / 3 4) with a button to switch to **down** (1 3 / 2 4); the choice is remembered.
- Memorising without leaving the page: a red-sheet cover (meaning or Japanese; tap a card to peek), ✓ known ticks per lesson (remembered), hide-known, shuffle and text size.
- Text is sized by word length and wraps only at natural points (the ・ between variants, spaces in sentences); nothing may leave its card (checked for every word in the browser test).
- Entries that are themselves whole sentences (greetings such as `おなかが すきました。`) show no separate example.
- A speaker button says the word / the sentence when the browser has a Japanese voice (hidden otherwise).
- Opening it pauses the quiz countdown; closing it restarts the question with a fresh clock. Reading before the first answer is free (that is the
  point of the list). Opening it after the quiz has started counts like the Romaji helper (half XP for that question), so it is not a free peek.
- Native `<dialog>`: focus trap, Esc closes, focus returns to the button, scrolls on phones, readable in dark mode. Quiz shortcuts (1-4, H, R) are
  ignored while a dialog is open or while typing in a field. Changing lesson closes the dialog.

**Judging a Japanese answer** (spoken or typed)
- Accepted: the kana reading, the kanji form, other written forms from the `alt` column (a recogniser prints 窓 for まど), the ます-form or the
  dictionary form (`急ぎます・急ぐ` accepts both), with or without optional parts `(お)`, `(な)`, and without `～`.
- Katakana/hiragana, width, spaces, punctuation and long-vowel spelling (コーヒー = こおひい = koohii) are normalised. Typed romaji works.
- The recogniser returns several candidates; the answer is right if any of them matches.
- Wrong readings are never forgiven (no fuzzy matching in Japanese). Two words with the same meaning (主人 / おっと: "My husband") are both accepted.

**Judging an English answer**
- Case, punctuation, a leading "to/a/an/the" and bracketed usage notes `(respectful)` are ignored; short bracketed words are optional (`(I'm) hungry`).
- Alternatives split on `,` `/` `;` are each acceptable (`Early, quickly` accepts "early" or "quickly").
- Tolerates one letter of recogniser noise only in words of five letters or more. "My father" and "Your father" stay different answers.
- Meanings too long to say aloud ("Suffix often added to a child's name") are left out of *hear Japanese, say English*; the summary says how many.

**Practice queue**
- A word answered correctly on its first try is cleared at once. A missed word (wrong answer or "I don't know") comes back after 3 other cards
  and must then be answered correctly twice in a row; every further miss starts that count again.
- The same word is never asked twice in a row unless it is the only one left.
- The session ends when every word is cleared, or when the learner ends it. The summary lists first-try accuracy and the hardest words.
- No XP, no effect on stars, streaks or the daily goal: practice is study, the quiz is the score.

**Voice corner cases** (each has a visible message and a way forward)

| Case | Behaviour |
| --- | --- |
| Browser cannot listen (Firefox) | typed answers are used automatically, with a message |
| Microphone blocked or missing | message, typed answers, and a "try the microphone again" button |
| Silence / nothing heard | "I didn't hear anything": not a miss, tap to retry; after two silences it suggests typing |
| Recognition service unreachable | message and typed answers |
| No Japanese voice installed | the Japanese prompt is shown as text instead of spoken |
| Browser cannot speak at all | prompts are shown as text, with a note |
| Tab hidden, dialog closed, lesson changed mid-listen | speaking and listening are cancelled; nothing is judged; late results from the old listen are ignored |
| Tapping the mic twice, or Skip while listening | one job at a time; a new job cancels the previous one |
| The assistant is speaking when the mic opens | the mic is tap-to-speak and silences the assistant first, so it never hears itself |
| A right answer the recogniser wrote differently (homophones) | after a spoken miss, **I said it right** counts it as correct; the summary reports how often it was used |
| Storage unavailable (private window) | the chosen direction is simply not remembered |
| Reduced motion, screen readers, keyboard | no required animation, `aria-live` status messages, real buttons, Enter moves on |

## Content rules (same spirit as the N5 track)
- Example sentences are original, short, polite-form and use the lesson's own vocabulary where possible.
- Every kanji in an example has a hiragana reading; readings must be hiragana; the build rejects bare kanji and stray braces.
- Each sentence must use its headword (kanji form, reading, or the stem of a conjugated verb/adjective); the build rejects ones that do not.
- The `alt` column lists written forms a recogniser may print for a kana word. The build rejects forms that are already accepted.
- Sentences, their English and the `alt` spellings are **not yet reviewed by a proficient Japanese speaker**; the dialog footer says so
  until they are. Review them (`src/examples/*.txt`) before relying on them for teaching.

## Known limits
- Speech recognition needs a browser that supports it. Chrome and Edge send the audio to their own online service, so it needs a connection.
- Recognisers choose their own kanji for homophones; `alt` covers the common spellings and **I said it right** covers the rest.
- A Japanese voice must be installed on the device for the assistant to speak Japanese (Windows: Settings → Time & language → Speech).
- Not done (can follow): saving weak words across sessions, pronunciation scoring, hands-free mode where the mic opens by itself.
