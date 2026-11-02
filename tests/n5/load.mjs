// Loads the browser-side N5 modules and the generated data into a sandbox so they can be unit-tested with node:test.
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILES = ["kana", "markup", "scheduler", "model", "questions", "composer", "readiness"];

export function loadN5() {
  const ctx = vm.createContext({ console });
  ctx.window = ctx;   // the modules attach to window.N5 in a browser
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(root, "js", "n5", `${f}.js`), "utf8"), ctx, { filename: `${f}.js` });
  vm.runInContext(fs.readFileSync(path.join(root, "data", "n5.js"), "utf8"), ctx, { filename: "n5.js" });
  return { N5: ctx.N5, data: ctx.N5_DATA, ctx };
}
/** Objects created inside the sandbox have a different prototype; a JSON round-trip makes them comparable. */
export const plain = (x) => JSON.parse(JSON.stringify(x));

/** A small in-memory stand-in for localStorage. */
export function memoryStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, _m: m };
}
export { root };
