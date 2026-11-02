/* N5 track — reading markup. A kanji run followed by its hiragana reading in braces, e.g. 日本人{にほんじん},
   becomes <ruby>. Pure string functions, no DOM access. Window.N5.Markup. */
(function (root) {
  "use strict";
  const N5 = (root.N5 = root.N5 || {});

  const KANJI = "[\\u3400-\\u9FFF々〆]";
  const RUBY = new RegExp(`(${KANJI}+)\\{([^{}]*)\\}`, "g");
  const KANJI_G = new RegExp(KANJI, "g");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function parse(markup) {
    const out = [];
    let last = 0, m;
    RUBY.lastIndex = 0;
    while ((m = RUBY.exec(markup))) {
      if (m.index > last) out.push({ t: "text", s: markup.slice(last, m.index) });
      out.push({ t: "ruby", base: m[1], rt: m[2] });
      last = m.index + m[0].length;
    }
    if (last < markup.length) out.push({ t: "text", s: markup.slice(last) });
    return out;
  }
  const plain = (markup) => parse(markup).map((t) => (t.t === "ruby" ? t.base : t.s)).join("");
  const reading = (markup) => parse(markup).map((t) => (t.t === "ruby" ? t.rt : t.s)).join("");
  const kanjiIn = (markup) => [...new Set(plain(markup).match(KANJI_G) || [])];

  /**
   * Markup → HTML. A run is "known" when every kanji in it is in `opts.known` (the learner has met it); known runs
   * can have their reading hidden by the learner, unknown runs ALWAYS keep furigana.
   *   opts.known  Set of kanji the learner has met
   *   opts.noRt   leave the readings out of the DOM entirely (used when the reading is the answer)
   */
  function toHtml(markup, opts) {
    const known = (opts && opts.known) || new Set();
    const noRt = !!(opts && opts.noRt);
    return parse(markup).map((t) => {
      if (t.t === "text") return esc(t.s);
      if (noRt) return esc(t.base);
      const kn = [...t.base].every((k) => known.has(k));
      return `<ruby class="${kn ? "kn" : "uk"}">${esc(t.base)}<rt>${esc(t.rt)}</rt></ruby>`;
    }).join("");
  }

  /** Renders `markup` with its first occurrence of `mark` replaced by `replacementHtml`. Falls back to plain rendering. */
  function replaceMark(markup, mark, replacementHtml, opts) {
    const i = markup.indexOf(mark);
    if (i < 0) return toHtml(markup, opts);
    return toHtml(markup.slice(0, i), opts) + replacementHtml + toHtml(markup.slice(i + mark.length), opts);
  }

  N5.Markup = { parse, plain, reading, kanjiIn, toHtml, replaceMark, esc };
  if (typeof module !== "undefined" && module.exports) module.exports = N5.Markup;
})(typeof window !== "undefined" ? window : globalThis);
