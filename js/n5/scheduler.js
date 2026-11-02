/* N5 track — spaced-repetition scheduler (pure). A small Leitner/SM-2 hybrid working in whole days.
   `today` is a day number (days since 1970-01-01, local calendar day), so it is trivial to test. Window.N5.Scheduler. */
(function (root) {
  "use strict";
  const N5 = (root.N5 = root.N5 || {});

  // Review interval in days for each box. Box 0 = new/forgotten.
  const INTERVALS = [1, 2, 4, 7, 14, 30, 60];
  const MAX_BOX = INTERVALS.length - 1;

  /** Local calendar day as a number. */
  function dayNumber(date) {
    const d = date || new Date();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  }
  const dayToIso = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

  /**
   * outcome: "pass"    answered correctly with no help   → advance a box
   *          "partial" correct with a hint / unsure     → stay in the box, come back sooner (never counts as mastery)
   *          "fail"    wrong                             → drop two boxes (lapse), see it again tomorrow
   * Returns a patch for the kanji record. A box advances at most once per calendar day, so answering the same kanji
   * five times in one session cannot launch it to a 60-day interval.
   */
  function schedule(rec, outcome, today) {
    const box = rec.box || 0;
    // The day a kanji is introduced is the learning phase: whatever happens, it must come back tomorrow.
    if (rec.firstSeen === today && outcome !== "fail") return { box, interval: 1, next: today + 1, boxDay: rec.boxDay == null ? null : rec.boxDay };
    if (outcome === "fail") {
      return { box: Math.max(0, box - 2), interval: INTERVALS[0], next: today + 1, lapses: (rec.lapses || 0) + 1, boxDay: today };
    }
    if (outcome === "partial") {
      const interval = Math.max(1, Math.floor(INTERVALS[box] / 2));
      const next = Math.min(rec.next == null ? today + interval : rec.next, today + interval);
      return { box, interval, next: Math.max(next, today + 1), boxDay: rec.boxDay };
    }
    // pass — practising something that is not due yet is welcome, but it must not push the interval out
    if (rec.next != null && rec.next > today) return { box, interval: INTERVALS[box], next: rec.next, boxDay: rec.boxDay };
    if (rec.boxDay === today) return { box, interval: INTERVALS[box], next: Math.max(rec.next || 0, today + INTERVALS[box]), boxDay: today };
    const nb = Math.min(box + 1, MAX_BOX);
    return { box: nb, interval: INTERVALS[nb], next: today + INTERVALS[nb], boxDay: today };
  }

  /** How many days late a kanji is (0 when not due). */
  const overdueDays = (rec, today) => Math.max(0, today - (rec.next == null ? today : rec.next));
  const isDue = (rec, today) => rec.next != null && rec.next <= today;

  N5.Scheduler = { INTERVALS, MAX_BOX, dayNumber, dayToIso, schedule, overdueDays, isDue };
  if (typeof module !== "undefined" && module.exports) module.exports = N5.Scheduler;
})(typeof window !== "undefined" ? window : globalThis);
