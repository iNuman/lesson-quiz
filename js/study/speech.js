/* Vocabulary study — the browser's speech engines behind one small, predictable interface. Window.Study.Speech.
   Everything the browser can get wrong becomes a plain result value; nothing here throws and no promise rejects.

     speak(text, lang)  → "done" | "cancelled" | "unavailable"
     listen(lang)       → { ok: true, alternatives: [string…] } | { ok: false, reason }
        reason: "unsupported" | "denied" | "no-speech" | "network" | "no-microphone" | "aborted" | "error"

   One speaking or listening job runs at a time: starting a new one (or calling cancel) ends the previous one with
   "cancelled" / "aborted", and results from an ended job are ignored. `create(env)` takes the browser objects as
   arguments so tests can pass fakes. */
(function (root) {
  "use strict";
  const Study = (root.Study = root.Study || {});

  const LISTEN_LIMIT_MS = 12000;      // a recogniser that never answers must not hang the lesson
  const VOICES_WAIT_MS = 1200;        // browsers fill the voice list a moment after load
  const MAX_ALTERNATIVES = 5;

  const ERROR_REASON = {
    "not-allowed": "denied", "service-not-allowed": "denied", "no-speech": "no-speech", network: "network",
    "audio-capture": "no-microphone", aborted: "aborted", "language-not-supported": "unsupported",
  };
  const langPrefix = (lang) => lang.toLowerCase().split(/[-_]/)[0];

  function create(env) {
    const synth = env.speechSynthesis || null;
    const Utterance = env.SpeechSynthesisUtterance || null;
    const Recognition = env.SpeechRecognition || env.webkitSpeechRecognition || null;
    const timers = env.timers || { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) };

    let job = 0;                 // bumped by every new speak/listen/cancel; callbacks compare against it
    let endCurrent = null;       // settles the running job early
    let keepAlive = null;        // a reference to the utterance in flight: browsers may garbage-collect it mid-speech
    let micOk = true;            // false after the browser said the microphone is blocked / missing

    const finishRunning = () => { if (endCurrent) { const f = endCurrent; endCurrent = null; f(); } };

    const canListen = () => !!Recognition && micOk;
    const canSpeak = () => !!(synth && Utterance);

    /** Resolves with the installed voices; waits briefly when the browser has not filled the list yet. */
    function voices() {
      if (!synth) return Promise.resolve([]);
      const now = synth.getVoices();
      if (now.length) return Promise.resolve(now);
      return new Promise((resolve) => {
        let t = 0;
        const done = () => { timers.clear(t); synth.removeEventListener && synth.removeEventListener("voiceschanged", done); resolve(synth.getVoices()); };
        t = timers.set(done, VOICES_WAIT_MS);
        synth.addEventListener && synth.addEventListener("voiceschanged", done);
      });
    }
    /** Is a voice for this language installed? (An empty list after the wait means "cannot tell" → true.) */
    async function hasVoice(lang) {
      const list = await voices();
      return list.length === 0 || list.some((v) => langPrefix(v.lang || "") === langPrefix(lang));
    }

    async function speak(text, lang, opts) {
      if (!canSpeak() || !text) return "unavailable";
      finishRunning();
      const mine = ++job;
      const list = await voices();
      if (mine !== job) return "cancelled";
      const u = new Utterance(text);
      keepAlive = u;
      u.lang = lang;
      u.rate = (opts && opts.rate) || 1;
      const voice = list.find((v) => (v.lang || "").toLowerCase().replace("_", "-") === lang.toLowerCase()) || list.find((v) => langPrefix(v.lang || "") === langPrefix(lang));
      if (voice) u.voice = voice;
      return new Promise((resolve) => {
        let limit = 0, settled = false;
        const settle = (result) => {
          if (settled) return;
          settled = true;
          timers.clear(limit);
          if (endCurrent === cancelThis) endCurrent = null;
          resolve(result);
        };
        const cancelThis = () => { try { synth.cancel(); } catch (e) { /* ignore */ } settle("cancelled"); };
        endCurrent = cancelThis;
        u.onend = () => settle("done");
        u.onerror = (e) => settle(e && (e.error === "canceled" || e.error === "interrupted") ? "cancelled" : "unavailable");
        // Some browsers never fire `end` for an utterance that cannot be played: do not wait forever.
        limit = timers.set(() => settle("done"), 4000 + text.length * 350);
        try { synth.cancel(); synth.speak(u); } catch (e) { settle("unavailable"); }
      });
    }

    function listen(lang) {
      if (!Recognition) return Promise.resolve({ ok: false, reason: "unsupported" });
      if (!micOk) return Promise.resolve({ ok: false, reason: "denied" });
      finishRunning();
      const mine = ++job;
      return new Promise((resolve) => {
        let rec, limit = 0, settled = false, heard = null;
        const settle = (result) => {
          if (settled) return;
          settled = true;
          timers.clear(limit);
          if (endCurrent === abort) endCurrent = null;
          if (result.reason === "denied" || result.reason === "no-microphone") micOk = false;
          resolve(result);
        };
        const abort = () => { try { rec.abort(); } catch (e) { /* ignore */ } settle({ ok: false, reason: "aborted" }); };
        try {
          rec = new Recognition();
          rec.lang = lang;
          rec.continuous = false;
          rec.interimResults = false;
          rec.maxAlternatives = MAX_ALTERNATIVES;
          rec.onresult = (e) => {
            if (mine !== job) return;
            const first = e.results && e.results[0];
            if (!first) return;
            heard = [];
            for (let i = 0; i < first.length; i++) heard.push(first[i].transcript);
          };
          rec.onerror = (e) => { if (mine === job) settle({ ok: false, reason: ERROR_REASON[e && e.error] || "error" }); };
          rec.onend = () => {
            if (mine !== job) return;
            settle(heard && heard.length ? { ok: true, alternatives: heard } : { ok: false, reason: "no-speech" });
          };
          endCurrent = abort;
          limit = timers.set(() => { try { rec.stop(); } catch (e) { /* ignore */ } }, LISTEN_LIMIT_MS);
          rec.start();
        } catch (e) {
          settle({ ok: false, reason: "error" });
        }
      });
    }

    /** Stops whatever is speaking or listening. Safe to call at any time. */
    function cancel() { job += 1; finishRunning(); if (synth) { try { synth.cancel(); } catch (e) { /* ignore */ } } }
    /** Lets the learner try the microphone again after fixing the browser permission. */
    function resetMicrophone() { micOk = true; }

    return { canListen, canSpeak, hasVoice, speak, listen, cancel, resetMicrophone };
  }

  Study.Speech = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = Study.Speech;
})(typeof window !== "undefined" ? window : globalThis);
