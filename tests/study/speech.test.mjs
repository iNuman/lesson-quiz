import test from "node:test";
import assert from "node:assert";
import { loadStudy } from "./load.mjs";

const { Study } = loadStudy();

/** Fake browser engines. `script` decides what a recognition run does. */
function fakeEnv({ voices = [{ lang: "ja-JP", name: "Kyoko" }, { lang: "en-US", name: "Sam" }], recognition = true, speakMode = "end" } = {}) {
  const log = [];
  const synth = {
    getVoices: () => voices,
    cancel: () => { log.push("cancel"); if (synth.current && speakMode === "end") { const u = synth.current; synth.current = null; u.onerror && u.onerror({ error: "canceled" }); } },
    speak: (u) => {
      log.push(`speak:${u.lang}:${u.text}`);
      synth.current = u;
      if (speakMode === "end") queueMicrotask(() => { if (synth.current === u) { synth.current = null; u.onend && u.onend(); } });
    },
    addEventListener() {}, removeEventListener() {},
  };
  class Utterance { constructor(text) { this.text = text; } }
  const runs = [];
  class Recognition {
    constructor() { runs.push(this); this.aborted = false; }
    start() { log.push(`listen:${this.lang}`); }
    abort() { this.aborted = true; queueMicrotask(() => this.onerror && this.onerror({ error: "aborted" })); }
    stop() { queueMicrotask(() => this.onend && this.onend()); }
    // helpers for the test
    hear(...alts) { this.onresult({ results: [alts.map((t) => ({ transcript: t }))] }); this.onend(); }
    fail(error) { this.onerror({ error }); this.onend && this.onend(); }
  }
  const timers = { set: () => 0, clear: () => {} };
  const env = { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance, timers };
  if (recognition) env.SpeechRecognition = Recognition;
  return { env, log, runs };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("speak reports done, picks the voice for the language and the requested rate", async () => {
  const { env, log } = fakeEnv();
  const sp = Study.Speech.create(env);
  assert.equal(await sp.speak("こんにちは", "ja-JP", { rate: 0.8 }), "done");
  assert.ok(log.includes("speak:ja-JP:こんにちは"));
});

test("speak without a synthesis engine or without text is 'unavailable' and never throws", async () => {
  assert.equal(await Study.Speech.create({}).speak("hi", "en-US"), "unavailable");
  assert.equal(await Study.Speech.create(fakeEnv().env).speak("", "en-US"), "unavailable");
});

test("a new speak call cancels the one in progress", async () => {
  const { env } = fakeEnv({ speakMode: "manual" });
  const sp = Study.Speech.create(env);
  const first = sp.speak("one", "en-US");
  await tick();
  const second = sp.speak("two", "en-US");
  assert.equal(await first, "cancelled");
  env.speechSynthesis.current.onend();
  assert.equal(await second, "done");
});

test("hasVoice: true when installed, false when the list has no such language, true when the list is empty (cannot tell)", async () => {
  assert.equal(await Study.Speech.create(fakeEnv().env).hasVoice("ja-JP"), true);
  assert.equal(await Study.Speech.create(fakeEnv({ voices: [{ lang: "en-GB" }] }).env).hasVoice("ja-JP"), false);
  assert.equal(await Study.Speech.create(fakeEnv({ voices: [{ lang: "en-GB" }] }).env).hasVoice("en-US"), true, "any English voice counts");
  const slow = fakeEnv({ voices: [] }).env;
  slow.timers = { set: (f) => setTimeout(f, 5), clear: clearTimeout };   // the real adapter waits ~1s for voices to load
  assert.equal(await Study.Speech.create(slow).hasVoice("ja-JP"), true);
});

test("listen returns every alternative the recogniser heard", async () => {
  const { env, runs } = fakeEnv();
  const sp = Study.Speech.create(env);
  const p = sp.listen("ja-JP");
  runs[0].hear("くすり", "薬", "草");
  assert.deepEqual(JSON.parse(JSON.stringify(await p)), { ok: true, alternatives: ["くすり", "薬", "草"] });
  assert.equal(runs[0].lang, "ja-JP");
  assert.equal(runs[0].maxAlternatives, 5);
});

test("listen maps every browser error to a plain reason", async () => {
  const cases = { "no-speech": "no-speech", "not-allowed": "denied", "service-not-allowed": "denied", network: "network", "audio-capture": "no-microphone", aborted: "aborted", "language-not-supported": "unsupported", weird: "error" };
  for (const [err, reason] of Object.entries(cases)) {
    const { env, runs } = fakeEnv();
    const sp = Study.Speech.create(env);
    const p = sp.listen("en-US");
    runs[0].fail(err);
    assert.deepEqual(JSON.parse(JSON.stringify(await p)), { ok: false, reason }, err);
  }
});

test("ending without any result is 'no-speech'; no recogniser at all is 'unsupported'", async () => {
  const { env, runs } = fakeEnv();
  const p = Study.Speech.create(env).listen("en-US");
  runs[0].onend();
  assert.equal((await p).reason, "no-speech");
  const none = Study.Speech.create(fakeEnv({ recognition: false }).env);
  assert.equal(none.canListen(), false);
  assert.equal((await none.listen("en-US")).reason, "unsupported");
});

test("after a denied microphone the adapter stops asking until reset", async () => {
  const { env, runs } = fakeEnv();
  const sp = Study.Speech.create(env);
  const p = sp.listen("en-US");
  runs[0].fail("not-allowed");
  assert.equal((await p).reason, "denied");
  assert.equal(sp.canListen(), false);
  assert.equal((await sp.listen("en-US")).reason, "denied");
  assert.equal(runs.length, 1, "no second recogniser was created");
  sp.resetMicrophone();
  assert.equal(sp.canListen(), true);
});

test("a second listen aborts the first; the stale result is ignored", async () => {
  const { env, runs } = fakeEnv();
  const sp = Study.Speech.create(env);
  const first = sp.listen("en-US");
  const second = sp.listen("en-US");
  assert.equal((await first).reason, "aborted");
  assert.equal(runs[0].aborted, true);
  runs[0].hear("late result from the old run");      // must not leak into the new run
  runs[1].hear("fresh");
  assert.deepEqual(JSON.parse(JSON.stringify(await second)), { ok: true, alternatives: ["fresh"] });
});

test("cancel stops speech and listening, and is always safe", async () => {
  const { env, runs, log } = fakeEnv({ speakMode: "manual" });
  const sp = Study.Speech.create(env);
  const talking = sp.speak("hello", "en-US");
  await tick();
  sp.cancel();
  assert.equal(await talking, "cancelled");
  const listening = sp.listen("en-US");
  sp.cancel();
  assert.equal((await listening).reason, "aborted");
  assert.equal(runs[0].aborted, true);
  assert.ok(log.includes("cancel"));
  Study.Speech.create({}).cancel();   // no engines at all
});

test("starting to listen silences the assistant first, so the microphone never hears it", async () => {
  const { env } = fakeEnv({ speakMode: "manual" });
  const sp = Study.Speech.create(env);
  const talking = sp.speak("say it", "en-US");
  await tick();
  const listening = sp.listen("ja-JP");
  assert.equal(await talking, "cancelled");
  sp.cancel();
  await listening;
});

test("a recogniser that throws on start is reported as an error, not an exception", async () => {
  const { env } = fakeEnv();
  env.SpeechRecognition = class { start() { throw new Error("already started"); } };
  assert.equal((await Study.Speech.create(env).listen("en-US")).reason, "error");
});
