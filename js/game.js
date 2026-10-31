/* Game layer: XP, levels, combos, daily streak/goal, stars, sounds and effects.
   Pure presentation + localStorage; quiz-engine.js stays untouched. app.js calls the hooks below. */
(function () {
  "use strict";

  const KEY = "jpquiz.profile.v1";
  const DAILY_GOAL = 30;
  const GOAL_BONUS = 50;
  const COMBO_CALLS = { 3: "Nice!", 5: "On fire!", 8: "Unstoppable!", 12: "Legendary!", 20: "GODLIKE!" };
  const COLORS = ["#e8643c", "#f0a04b", "#c0392b", "#ffd166", "#06d6a0", "#4cc9f0", "#b388ff"];
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- profile (persisted) ---------- */
  const blank = () => ({ xp: 0, lastDay: "", dayStreak: 0, bestDayStreak: 0, todayCount: 0, goalDay: "", bestCombo: 0, totalCorrect: 0, stars: {}, muted: false });
  let p = blank();
  try { p = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* ignore */ } };

  const pad = (n) => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
  const levelOf = (xp) => Math.floor(Math.sqrt(xp / 50)) + 1;
  const levelFloor = (l) => 50 * (l - 1) * (l - 1);
  const liveStreak = () => (p.lastDay && dayDiff(p.lastDay, today()) <= 1 ? p.dayStreak : 0);
  const todayCount = () => (p.lastDay === today() ? p.todayCount : 0);

  function touchDay() {
    const t = today();
    if (p.lastDay === t) return;
    p.dayStreak = p.lastDay && dayDiff(p.lastDay, t) === 1 ? p.dayStreak + 1 : 1;
    p.bestDayStreak = Math.max(p.bestDayStreak, p.dayStreak);
    p.lastDay = t;
    p.todayCount = 0;
  }
  // Adds XP; returns the new level if it went up, else 0.
  function addXp(n) {
    const before = levelOf(p.xp);
    p.xp += n;
    const after = levelOf(p.xp);
    return after > before ? after : 0;
  }

  /* ---------- sound (WebAudio, no assets) ---------- */
  let ac = null;
  function audio() {
    if (p.muted) return null;
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
    } catch (e) { return null; }
    return ac;
  }
  function tone(freq, at, dur, type, vol) {
    const c = audio();
    if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
    o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const semi = (base, n) => base * Math.pow(2, n / 12);
  const sfx = {
    correct(combo) { const f = semi(523.25, Math.min(combo - 1, 9) * 2); tone(f, 0, 0.12, "triangle", 0.14); tone(f * 1.5, 0.08, 0.2, "triangle", 0.12); },
    wrong() { tone(170, 0, 0.22, "sawtooth", 0.1); tone(120, 0.12, 0.3, "sawtooth", 0.1); },
    level() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.3, "triangle", 0.14)); },
    done(stars) { const n = [523.25, 659.25, 783.99, 1046.5, 1318.5]; n.slice(0, 2 + stars).forEach((f, i) => tone(f, i * 0.11, 0.35, "triangle", 0.14)); },
    tick() { tone(880, 0, 0.06, "sine", 0.08); },
  };
  const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } };

  /* ---------- visual effects ---------- */
  let canvas = null, parts = [], raf = 0;
  function confetti(x, y, count, power) {
    if (reduceMotion()) return;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "fx-canvas"; canvas.setAttribute("aria-hidden", "true");
      document.body.appendChild(canvas);
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = (Math.random() * 0.6 + 0.4) * power;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - power * 0.6, r: Math.random() * 6 + 3, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: COLORS[(Math.random() * COLORS.length) | 0], life: 1 });
    }
    if (!raf) raf = requestAnimationFrame(step.bind(null, canvas.getContext("2d"), dpr));
  }
  function step(ctx, dpr) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts = parts.filter((q) => q.life > 0 && q.y < innerHeight + 40);
    for (const q of parts) {
      q.vy += 0.28; q.vx *= 0.99; q.x += q.vx; q.y += q.vy; q.rot += q.vr; q.life -= 0.008;
      ctx.save();
      ctx.globalAlpha = Math.max(q.life, 0);
      ctx.translate(q.x * dpr, q.y * dpr); ctx.rotate(q.rot);
      ctx.fillStyle = q.c; ctx.fillRect(-q.r * dpr, -q.r * 0.5 * dpr, q.r * 2 * dpr, q.r * dpr);
      ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(step.bind(null, ctx, dpr)) : 0;
    if (!raf) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  function pop(text, x, y, cls) {
    const d = document.createElement("div");
    d.className = "fx-pop " + (cls || "");
    d.textContent = text;
    d.style.left = x + "px"; d.style.top = y + "px";
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }
  let toastEl = null, toastTimer = 0;
  function banner(text, kind) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "fx-banner"; toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.className = "fx-banner show " + (kind || "");
    toastEl.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = "fx-banner " + (kind || ""); }, 1700);
  }
  const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

  /* ---------- HUD ---------- */
  const hudEl = () => document.getElementById("hud");
  function renderHud(s) {
    const el = hudEl();
    if (!el) return;
    const lv = levelOf(p.xp), lo = levelFloor(lv), hi = levelFloor(lv + 1);
    const pct = Math.round(((p.xp - lo) / (hi - lo)) * 100);
    const combo = s ? s.combo || 0 : 0;
    const goal = Math.min(todayCount(), DAILY_GOAL);
    const circ = 2 * Math.PI * 15;
    const streak = liveStreak();
    el.innerHTML = `
      <div class="hud-lv" title="${p.xp - lo} / ${hi - lo} XP to next level">
        <span class="lv-badge">Lv ${lv}</span>
        <div class="xp"><div class="xp-bar" role="progressbar" aria-label="Level progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
        <small>${p.xp - lo} / ${hi - lo} XP</small></div>
      </div>
      <div class="chip combo${combo >= 3 ? " hot" : ""}${combo >= 8 ? " blaze" : ""}" id="combo-chip" title="Answer correctly in a row to build a combo"><span aria-hidden="true">🔥</span> Combo <b>x${combo}</b></div>
      <div class="chip" title="Days in a row you have practised"><span aria-hidden="true">📅</span> <b>${streak}</b> day${streak === 1 ? "" : "s"}</div>
      <div class="chip goal${goal >= DAILY_GOAL ? " done" : ""}" title="Daily goal: ${DAILY_GOAL} correct answers">
        <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" class="g-bg"/><circle cx="18" cy="18" r="15" class="g-fg" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - goal / DAILY_GOAL)}"/></svg>
        <span>Daily <b>${goal}/${DAILY_GOAL}</b></span>
      </div>
      <button type="button" class="chip snd" id="snd" aria-pressed="${!p.muted}" aria-label="Sound effects">${p.muted ? "🔇" : "🔊"}</button>`;
  }
  function bindHud() {
    const el = hudEl();
    if (!el) return;
    el.addEventListener("click", (e) => {
      if (!e.target.closest("#snd")) return;
      p.muted = !p.muted; save();
      e.target.closest("#snd").textContent = p.muted ? "🔇" : "🔊";
      e.target.closest("#snd").setAttribute("aria-pressed", String(!p.muted));
      if (!p.muted) sfx.tick();
    });
  }

  /* ---------- hooks used by app.js ---------- */
  function questionShown(s) { s._qStart = Date.now(); }

  // Call right after QuizEngine.choose() returned "correct" | "wrong". Returns what happened for fx().
  function answered(s, result) {
    touchDay();
    const info = { result, gain: 0, speed: 0, combo: 0, lostCombo: s.combo || 0, levelUp: 0, goal: false };
    if (result === "correct") {
      s.combo = (s.combo || 0) + 1;
      s.maxCombo = Math.max(s.maxCombo || 0, s.combo);
      const secs = (Date.now() - (s._qStart || Date.now())) / 1000;
      info.speed = secs <= 3 ? 5 : secs <= 6 ? 2 : 0;
      info.combo = s.combo;
      info.gain = 10 + info.speed + Math.min(s.combo - 1, 5) * 2;
      s.xpEarned = (s.xpEarned || 0) + info.gain;
      info.levelUp = addXp(info.gain);
      p.totalCorrect += 1; p.todayCount += 1;
      p.bestCombo = Math.max(p.bestCombo, s.combo);
      if (p.todayCount >= DAILY_GOAL && p.goalDay !== today()) {
        p.goalDay = today(); info.goal = true;
        s.xpEarned += GOAL_BONUS; info.levelUp = addXp(GOAL_BONUS) || info.levelUp;
      }
    } else {
      s.combo = 0;
    }
    save();
    return info;
  }

  // Call after render(): sounds, popups, shake, confetti.
  function fx(info) {
    if (!info) return;
    if (info.result === "correct") {
      const el = document.querySelector(".opt.is-correct");
      const c = el ? center(el) : { x: innerWidth / 2, y: innerHeight / 2 };
      sfx.correct(info.combo); buzz(12);
      pop(`+${info.gain} XP`, c.x, c.y - 10, info.speed ? "fast" : "");
      if (info.speed >= 5) setTimeout(() => pop("⚡ Quick!", c.x, c.y - 44, "fast"), 120);
      if (info.combo >= 3) {
        const chip = document.getElementById("combo-chip");
        if (chip) { chip.classList.remove("bump"); void chip.offsetWidth; chip.classList.add("bump"); }
      }
      const call = COMBO_CALLS[info.combo];
      if (call) { banner(`${call}  x${info.combo} combo`, "combo"); confetti(c.x, c.y, 24 + info.combo * 2, 9); }
      if (info.levelUp) setTimeout(() => { sfx.level(); banner(`LEVEL UP!  Lv ${info.levelUp}`, "level"); confetti(innerWidth / 2, innerHeight / 3, 120, 14); }, 250);
      if (info.goal) setTimeout(() => { banner(`Daily goal complete!  +${GOAL_BONUS} XP`, "level"); confetti(innerWidth / 2, innerHeight / 3, 140, 15); }, info.levelUp ? 1900 : 300);
    } else if (info.result === "wrong") {
      sfx.wrong(); buzz([40, 30, 40]);
      const card = document.querySelector(".card");
      if (card) card.classList.add("shake");
      if (info.lostCombo >= 3) {
        const el = document.querySelector(".opt.is-wrong");
        const c = el ? center(el) : { x: innerWidth / 2, y: innerHeight / 2 };
        pop(`Combo lost x${info.lostCombo}`, c.x, c.y - 10, "lost");
      }
    }
  }

  const starsFor = (pct) => (pct >= 90 ? 3 : pct >= 70 ? 2 : 1);

  // Idempotent: scores a finished lesson once and returns the summary shown on the results card.
  function finish(s) {
    if (s._summary) return s._summary;
    touchDay();
    const total = s.words.length, pct = Math.round((s.score / total) * 100);
    const stars = starsFor(pct), perfect = s.wrong.length === 0;
    const bonus = 25 + stars * 10 + (perfect ? 50 : 0);
    const levelUp = addXp(bonus);
    s.xpEarned = (s.xpEarned || 0) + bonus;
    const prev = p.stars[s.lesson] || 0;
    if (stars > prev) p.stars[s.lesson] = stars;
    save();
    s._summary = { stars, bonus, perfect, levelUp, newBest: stars > prev, xp: s.xpEarned, maxCombo: s.maxCombo || 0, fresh: true };
    return s._summary;
  }
  function finishFx(sum) {
    if (!sum || !sum.fresh) return;
    sum.fresh = false;
    sfx.done(sum.stars);
    confetti(innerWidth / 2, innerHeight / 3, 60 + sum.stars * 50, 12 + sum.stars * 2);
    if (sum.levelUp) setTimeout(() => { sfx.level(); banner(`LEVEL UP!  Lv ${sum.levelUp}`, "level"); confetti(innerWidth / 2, innerHeight / 3, 120, 14); }, 700);
  }
  const lessonStars = (n) => p.stars[n] || 0;
  const level = () => levelOf(p.xp);

  window.Game = { questionShown, answered, fx, finish, finishFx, renderHud, bindHud, lessonStars, level, DAILY_GOAL };
})();
