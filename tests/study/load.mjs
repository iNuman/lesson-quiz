// Loads the browser-side study modules and the lesson data into a sandbox so they can be unit-tested with node:test.
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");

/** @param extraGlobals objects made available to the modules as globals (fakes for tests). */
export function loadStudy() {
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  for (const f of ["js/n5/kana.js", "js/study/forms.js", "js/study/matcher.js", "js/study/practice.js", "js/study/speech.js"]) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  vm.runInContext(read("data/lessons.js"), ctx, { filename: "lessons.js" });
  return { Study: ctx.Study, lessons: JSON.parse(JSON.stringify(ctx.LESSON_DATA)) };
}
export const allWords = (lessons) => Object.values(lessons).flatMap((l) => l.words);
export const wordOf = (lessons, n, ja) => lessons[n].words.find((w) => w.ja === ja);
