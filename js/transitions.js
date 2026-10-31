/* Showpiece question-to-question transitions. Every effect is built from transform/opacity animations
   (Web Animations API), so it runs on the GPU. An effect calls commit(settleMs) at the moment the next
   question should be rendered; settleMs is how long the arrival still takes (the quiz clock waits for it). */
(function () {
  "use strict";

  const SPRING = "cubic-bezier(.34, 1.56, .64, 1)";
  const GRADS = [
    "linear-gradient(135deg, #c0392b, #e8643c, #f0a04b)",
    "linear-gradient(135deg, #7b2ff7, #f107a3)",
    "linear-gradient(135deg, #0ea5a4, #4cc9f0)",
    "linear-gradient(135deg, #f59e0b, #ef4444)",
  ];
  const CHEERS = ["すごい！", "いいね！", "やった！", "つぎ！", "がんばれ！", "その調子！", "かんぺき！"];
  const EMOJI = ["⭐", "🔥", "✨", "🌸", "⚡", "🎌"];

  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fin = (anim) => anim.finished.catch(() => {});
  function el(cls, style, html) {
    const d = document.createElement("div");
    d.className = cls;
    if (style) Object.assign(d.style, style);
    if (html != null) d.innerHTML = html;
    return d;
  }
  function layer() {
    const l = el("fx-layer");
    l.setAttribute("aria-hidden", "true");
    document.body.appendChild(l);
    return l;
  }
  const centerOf = (card) => { const r = card.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; };

  /* 1. Theatre curtains close over the page, a 博士 seal pops at the seam, then they open on the next question. */
  async function curtains(card, commit, o) {
    const l = layer(), g = pick(GRADS);
    const L = el("fx-curtain left", { background: g }), R = el("fx-curtain right", { background: g });
    const seal = el("fx-seal", null, "博士");
    l.append(L, R, seal);
    o.whoosh();
    const close = { duration: 300, easing: "cubic-bezier(.2, .8, .2, 1)", fill: "forwards" };
    const a = [
      L.animate([{ transform: "translate3d(-101%, 0, 0)" }, { transform: "translate3d(0, 0, 0)" }], close),
      R.animate([{ transform: "translate3d(101%, 0, 0)" }, { transform: "translate3d(0, 0, 0)" }], close),
    ];
    seal.animate([{ transform: "scale(0) rotate(-120deg)", opacity: 0 }, { transform: "scale(1) rotate(0)", opacity: 1 }], { duration: 380, delay: 140, easing: SPRING, fill: "both" });
    await Promise.all(a.map(fin));
    commit(360);
    await wait(140);
    const open = { duration: 380, easing: "cubic-bezier(.6, 0, .9, .4)", fill: "forwards" };
    L.animate([{ transform: "translate3d(0, 0, 0)" }, { transform: "translate3d(-101%, 0, 0)" }], open);
    R.animate([{ transform: "translate3d(0, 0, 0)" }, { transform: "translate3d(101%, 0, 0)" }], open);
    await fin(seal.animate([{ transform: "scale(1) rotate(0)", opacity: 1 }, { transform: "scale(1.8) rotate(40deg)", opacity: 0 }], { duration: 300, fill: "forwards" }));
    l.remove();
  }

  /* 2. A colour circle explodes from the card, a big emoji bursts in the middle, then the circle shrinks away. */
  async function iris(card, commit, o) {
    const { x, y } = centerOf(card);
    const l = layer(), size = Math.ceil(Math.hypot(innerWidth, innerHeight) * 2.1);
    const c = el("fx-iris", { width: size + "px", height: size + "px", left: x - size / 2 + "px", top: y - size / 2 + "px", background: pick(GRADS) });
    const e = el("fx-emoji", { left: x + "px", top: y + "px" }, pick(EMOJI));
    l.append(c, e);
    o.whoosh();
    await fin(c.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: 340, easing: "cubic-bezier(.55, 0, .9, .45)", fill: "forwards" }));
    e.animate([{ transform: "translate(-50%, -50%) scale(0) rotate(-60deg)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(1) rotate(0)", opacity: 1 }], { duration: 300, easing: SPRING, fill: "forwards" });
    o.burst(x, y, 50, 11);
    commit(430);
    await wait(180);
    e.animate([{ opacity: 1 }, { opacity: 0, transform: "translate(-50%, -50%) scale(2)" }], { duration: 260, fill: "forwards" });
    await fin(c.animate([{ transform: "scale(1)" }, { transform: "scale(0)" }], { duration: 480, easing: "cubic-bezier(.3, .7, .2, 1)", fill: "forwards" }));
    l.remove();
  }

  /* 3. A Japanese cheer is stamped onto the screen with a shockwave and confetti while the card swaps. */
  async function stamp(card, commit, o) {
    const { x, y } = centerOf(card);
    const l = layer();
    const ring = el("fx-ring", { left: x + "px", top: y + "px" });
    const s = el("fx-stamp", { left: x + "px", top: y + "px", background: pick(GRADS) }, pick(CHEERS));
    l.append(ring, s);
    o.whoosh();
    card.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.82) rotate(-5deg)" }], { duration: 260, easing: "ease-in", fill: "forwards" });
    s.animate([{ transform: "translate(-50%, -50%) scale(3) rotate(-26deg)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(1) rotate(-7deg)", opacity: 1 }], { duration: 340, easing: SPRING, fill: "forwards" });
    ring.animate([{ transform: "translate(-50%, -50%) scale(.2)", opacity: .9 }, { transform: "translate(-50%, -50%) scale(2.6)", opacity: 0 }], { duration: 620, easing: "ease-out", fill: "forwards" });
    o.burst(x, y, 70, 13);
    await wait(300);
    commit(480);
    await wait(320);
    await fin(s.animate([{ transform: "translate(-50%, -50%) scale(1) rotate(-7deg)", opacity: 1 }, { transform: "translate(-50%, -190%) scale(.7) rotate(-14deg)", opacity: 0 }], { duration: 300, easing: "ease-in", fill: "forwards" }));
    l.remove();
  }

  /* 4. The card shatters into tiles that explode outward while the next card pops in underneath. */
  async function shatter(card, commit, o) {
    const r = card.getBoundingClientRect();
    const box = el("fx-shards", { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    box.setAttribute("aria-hidden", "true");
    const cols = 4, rows = 3, tiles = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const t = card.cloneNode(true);
        t.removeAttribute("id");
        t.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
        t.classList.remove("enter", "swap", "shake", "go");
        t.setAttribute("inert", "");
        const top = (i / rows) * 100, left = (j / cols) * 100;
        Object.assign(t.style, { position: "absolute", left: "0", top: "0", width: r.width + "px", height: r.height + "px", margin: "0", animation: "none", clipPath: `inset(${top}% ${100 - left - 100 / cols}% ${100 - top - 100 / rows}% ${left}%)` });
        box.appendChild(t);
        tiles.push({ t, dx: (j + .5) / cols - .5, dy: (i + .5) / rows - .5 });
      }
    }
    document.body.appendChild(box);
    card.style.visibility = "hidden";
    o.whoosh();
    commit(520);
    const next = document.querySelector("#app .card");
    if (next) next.animate([{ opacity: 0, transform: "scale(.82) translate3d(0, 24px, 0)" }, { opacity: 1, transform: "none" }], { duration: 560, delay: 120, easing: SPRING, fill: "backwards" });
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    o.burst(cx, cy, 36, 10);
    tiles.forEach(({ t, dx, dy }) => {
      const dist = Math.hypot(dx, dy);
      const push = 220 + Math.random() * 260;
      t.animate(
        [{ transform: "none", opacity: 1 }, { transform: `translate3d(${dx * push * 2}px, ${dy * push * 2 + 120}px, 0) rotate(${(Math.random() - .5) * 200}deg) scale(${.4 + Math.random() * .3})`, opacity: 0 }],
        { duration: 650 + Math.random() * 250, delay: dist * 90, easing: "cubic-bezier(.2, .7, .3, 1)", fill: "forwards" }
      );
    });
    await wait(1000);
    box.remove();
  }

  /* Quick mode: a short, simple slide for people who want speed. */
  async function quick(card, commit) {
    await fin(card.animate([{ transform: "none", opacity: 1 }, { transform: "translate3d(-40px, 0, 0)", opacity: 0 }], { duration: 140, fill: "forwards" }));
    commit(0);
    const next = document.querySelector("#app .card");
    if (next) next.animate([{ transform: "translate3d(40px, 0, 0)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 200, easing: "ease-out" });
  }

  const FANCY = [curtains, iris, stamp, shatter];
  let last = -1, busy = false;

  // opts: { fancy, burst(x, y, n, power), whoosh() }
  function run(card, commit, opts) {
    if (busy) { commit(0); return; }
    busy = true;
    let i;
    do { i = Math.floor(Math.random() * FANCY.length); } while (i === last);
    last = i;
    const effect = opts.fancy ? FANCY[i] : quick;
    effect(card, commit, opts).catch(() => commit(0)).finally(() => { busy = false; });
  }

  window.Transitions = { run };
})();
