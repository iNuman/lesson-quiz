// A tiny Chrome DevTools Protocol driver (no dependencies; needs Node 22+ for the built-in WebSocket and a local Chrome/Edge).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CANDIDATES = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 390, height = 844, port = 9333 } = {}) {
  const exe = CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error("No Chrome/Edge found. Set CHROME=/path/to/chrome");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n5-chrome-"));
  const proc = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${width},${height}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some((t) => t.type === "page")) break; } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  const target = targets && targets.find((t) => t.type === "page");
  if (!target) { proc.kill(); throw new Error("Chrome did not start"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const errors = [], logs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text);
    else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("console.error: " + msg.params.args.map((a) => a.value || a.description).join(" "));
    else if (msg.method === "Runtime.consoleAPICalled") logs.push(msg.params.args.map((a) => a.value).join(" "));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });

  const api = {
    errors, logs,
    send,
    async goto(url) {
      // Always a real page load (navigating to the same URL with only a #fragment would not reload anything).
      await send("Page.navigate", { url: "about:blank" });
      await sleep(150);
      await send("Page.navigate", { url });
      await sleep(400);
      await api.waitFor("document.readyState === 'complete'");
    },
    async eval(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error("eval failed: " + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text) + "\n" + expr);
      return r.result.value;
    },
    async waitFor(expr, ms = 5000) {
      const end = Date.now() + ms;
      while (Date.now() < end) { try { if (await api.eval(expr)) return true; } catch (e) { /* retry */ } await sleep(60); }
      throw new Error("timeout waiting for: " + expr);
    },
    async click(sel) { await api.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no element ' + ${JSON.stringify(sel)}); e.click(); return true; })()`); await sleep(40); },
    async shot(file) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    },
    async resize(w, h) { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }); await sleep(150); },
    /** Makes the page believe it is `n` days later (persisted in localStorage so it survives reloads). */
    async installClock() {
      await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { let off = 0; try { off = Number(localStorage.getItem('__shift') || 0) * 864e5; } catch (e) {} const D = Date; function F(...a) { if (!(this instanceof F)) return new D(D.now() + off).toString(); if (a.length === 0) return new D(D.now() + off); return new D(...a); } F.prototype = D.prototype; F.now = () => D.now() + off; F.UTC = D.UTC; F.parse = D.parse; window.Date = F; })();` });
    },
    async close() { try { ws.close(); } catch (e) { /* ignore */ } proc.kill(); await sleep(200); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } },
  };
  return api;
}
