/**
 * Repeatable performance baseline for the installed AIRWAYS APK on a USB-connected Android phone.
 *
 *   npm run perf:android -- --label low-120hz --refresh 120 --minutes 15
 *   npm run perf:android -- --label low-60hz  --refresh 60  --minutes 6
 *
 * What it does
 *  - (optionally) pins the display refresh rate via `settings`, restoring the previous values afterwards
 *  - cold-starts the app, attaches to its WebView over ADB (debug APKs expose a DevTools socket)
 *  - selects the requested quality, then flies the real game with an autopilot that drives the same
 *    keyboard events a player would, restarting after each landing until the time is up
 *  - every 10 s records frame-time statistics (from requestAnimationFrame), the game's own FPS counter,
 *    draw calls, JS heap, device temperatures, thermal status and battery; every 60 s process memory (PSS)
 *  - writes perf/results/<timestamp>-<label>.json and prints a summary
 *
 * Requirements: adb (Android SDK platform-tools), a debug build of the app, phone unlocked with the
 * screen on. Node 22+ (global WebSocket/fetch).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = 'com.tomasthur.airways';
const ACTIVITY = `${PKG}/.MainActivity`;
const PORT = 9339;
const SAMPLE_S = 10;
const MEM_EVERY_S = 60;

// ------------------------------------------------------------------ args

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, []),
);
const LABEL = args.label ?? 'run';
const MINUTES = Number(args.minutes ?? 6);
const REFRESH = args.refresh ?? 'keep'; // '60' | '90' | '120' | 'keep'
const QUALITY = (args.quality ?? 'low').toLowerCase();
const OUT_DIR = path.join(ROOT, 'perf', 'results');

// ------------------------------------------------------------------ adb

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const ADB = fs.existsSync(path.join(sdk, 'platform-tools', 'adb.exe')) ? path.join(sdk, 'platform-tools', 'adb.exe') : 'adb';
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sh = (cmd) => {
  try {
    return adb('shell', cmd);
  } catch (e) {
    return String(e.stdout ?? '');
  }
};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Refresh-rate keys used by stock Android and MIUI/HyperOS. Only keys that already exist are changed,
// plus the two stock keys; all are restored to their previous state on exit.
const REFRESH_KEYS = [
  ['system', 'peak_refresh_rate'],
  ['system', 'min_refresh_rate'],
  ['system', 'user_refresh_rate'],
  ['secure', 'user_refresh_rate'],
  ['secure', 'miui_refresh_rate'],
];
const savedRefresh = [];

function pinRefresh(hz) {
  for (const [ns, key] of REFRESH_KEYS) {
    const prev = sh(`settings get ${ns} ${key}`);
    const exists = prev !== '' && prev !== 'null';
    const stock = ns === 'system' && (key === 'peak_refresh_rate' || key === 'min_refresh_rate');
    if (!exists && !stock) continue;
    savedRefresh.push([ns, key, exists ? prev : null]);
    sh(`settings put ${ns} ${key} ${hz}`);
  }
}

function restoreRefresh() {
  for (const [ns, key, prev] of savedRefresh.splice(0)) {
    if (prev === null) sh(`settings delete ${ns} ${key}`);
    else sh(`settings put ${ns} ${key} ${prev}`);
  }
}

function readThermal() {
  const out = sh('dumpsys thermalservice');
  const status = Number(/Thermal Status:\s*(\d+)/.exec(out)?.[1] ?? NaN);
  const section = out.split('Current temperatures from HAL:')[1] ?? out;
  const byType = { cpu: -Infinity, gpu: -Infinity, battery: -Infinity, skin: -Infinity };
  const names = ['cpu', 'gpu', 'battery', 'skin'];
  let sensorStatus = 0;
  for (const m of section.matchAll(/mValue=([\d.\-]+), mType=(\d+), mName=[^,]+, mStatus=(\d+)/g)) {
    const type = names[Number(m[2])];
    if (type) byType[type] = Math.max(byType[type], Number(m[1]));
    sensorStatus = Math.max(sensorStatus, Number(m[3]));
  }
  for (const k of names) if (!Number.isFinite(byType[k])) byType[k] = null;
  // `status` is the service-wide value, which MIUI can leave latched from an earlier event;
  // `sensorStatus` is the worst status reported by the live HAL readings.
  return { status, sensorStatus, ...byType };
}

function readBattery() {
  const out = sh('dumpsys battery');
  const n = (re) => Number(re.exec(out)?.[1] ?? NaN);
  return {
    level: n(/level:\s*(\d+)/),
    tempC: n(/temperature:\s*(\d+)/) / 10,
    usbPowered: /USB powered:\s*true/.test(out),
    acPowered: /AC powered:\s*true/.test(out),
  };
}

function readMemoryKb() {
  const out = sh('dumpsys meminfo');
  let app = 0;
  let renderer = 0;
  for (const line of out.split('\n')) {
    const m = /([\d,]+)K:\s+(\S+)/.exec(line);
    if (!m) continue;
    const kb = Number(m[1].replace(/,/g, ''));
    if (m[2] === PKG) app = Math.max(app, kb);
    else if (m[2].includes('sandboxed_process') && line.includes('webview')) renderer = Math.max(renderer, kb);
  }
  return { appPssKb: app || null, rendererPssKb: renderer || null };
}

function readCpu() {
  const out = sh('top -b -n 1');
  let app = 0;
  let renderer = 0;
  const lines = out.split('\n');
  const header = lines.find((l) => l.includes('%CPU'));
  if (!header) return null;
  const cols = header.trim().split(/\s+/);
  const cpuIdx = cols.findIndex((c) => c.includes('%CPU'));
  for (const l of lines) {
    const parts = l.trim().split(/\s+/);
    const name = parts[parts.length - 1] ?? '';
    const cpu = Number(parts[cpuIdx]);
    if (!Number.isFinite(cpu)) continue;
    if (name.startsWith(PKG)) app += cpu;
    else if (name.includes('sandboxed_process') || name.includes('webview')) renderer += cpu;
  }
  return { appCpuPct: app, rendererCpuPct: renderer };
}

// ------------------------------------------------------------------ CDP

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const p = msg.id && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('WebSocket connection failed')), { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  close() {
    this.ws.close();
  }
}

async function attach() {
  let pid = '';
  for (let i = 0; i < 40 && !pid; i++) {
    pid = sh(`pidof ${PKG}`).split(/\s+/)[0] ?? '';
    if (!pid) await sleep(250);
  }
  if (!pid) throw new Error('App process not found');
  let socket = '';
  for (let i = 0; i < 60 && !socket; i++) {
    const unix = sh('cat /proc/net/unix');
    socket = (unix.match(new RegExp(`@(webview_devtools_remote_${pid})\\b`)) ?? [])[1] ?? '';
    if (!socket) await sleep(250);
  }
  if (!socket) throw new Error('WebView DevTools socket not found (is this a debug APK?)');
  try {
    adb('forward', '--remove', `tcp:${PORT}`);
  } catch {}
  adb('forward', `tcp:${PORT}`, `localabstract:${socket}`);
  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('No debuggable page in the WebView');
  return { pid, cdp: await Cdp.connect(page.webSocketDebuggerUrl) };
}

// ------------------------------------------------------------------ in-page probe + autopilot

const PROBE = String.raw`(async (quality) => {
  for (let i = 0; i < 120 && !window.airways; i++) await new Promise((r) => setTimeout(r, 250));
  const g = window.airways;
  if (!g) throw new Error('game not ready');

  // Quality: cycle the real toolbar button until the requested level is active.
  const qb = document.querySelector('[data-action=quality]');
  for (let i = 0; i < 3 && g.quality !== quality; i++) qb.click();

  const gl = g.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const info = {
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    devicePixelRatio: window.devicePixelRatio,
    rendererPixelRatio: g.renderer.getPixelRatio(),
    css: [innerWidth, innerHeight],
    canvas: [g.renderer.domElement.width, g.renderer.domElement.height],
    screen: [screen.width, screen.height],
    userAgent: navigator.userAgent,
    quality: g.quality,
  };

  // Frame-time ring buffer fed by requestAnimationFrame (independent of the game's own counter).
  const N = 8192;
  const ring = new Float64Array(N);
  let n = 0;
  let last = performance.now();
  const tick = (t) => {
    if (n < N) ring[n++] = t - last;
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Autopilot driving the same keyboard events a player uses; restarts after every report.
  const fm = g.fm;
  const held = new Set();
  const key = (code, down) => {
    if (down === held.has(code)) return;
    down ? held.add(code) : held.delete(code);
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
  };
  const tap = (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  };
  const deg = Math.PI / 180, AIM = 11800, SLOPE = Math.tan(3.5 * deg);
  let phase = 'takeoff';
  const flights = [];
  const pitchTo = (t) => { const e = t - fm.pitch - fm.pitchRate * 0.25; key('KeyW', e > 0.004); key('KeyS', e < -0.004); };
  const thrTo = (t) => { key('ShiftLeft', fm.throttleLever < t - 0.02); key('KeyX', fm.throttleLever > t + 0.02); };
  const start = () => {
    phase = 'takeoff';
    document.querySelector('[data-iata="VIE"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    setTimeout(() => document.querySelector('[data-hub="fly"]')?.click(), 120);
  };
  start();
  setInterval(() => {
    if (g.state === 'report') {
      const q = (s) => document.querySelector('[data-ref=' + s + ']')?.textContent ?? '';
      flights.push({ title: q('reportTitle'), score: q('reportScore'), stats: q('reportStats') });
      for (const c of [...held]) key(c, false);
      document.querySelector('[data-ref=reportButton]')?.click();
      phase = 'takeoff';
      return;
    }
    if (g.state === 'menu') { start(); return; }
    if (g.state !== 'flying') return;
    const V = fm.airspeed;
    if (g.phase === 'preflight') {
      const p = g.plane, pax = g.passengers;
      if (!g.boardingStarted) { if (!p.doorOpen) tap('KeyO'); }
      else if (pax.boarded < pax.total) { /* boarding */ }
      else if (p.doorOpen) tap('KeyO');
      else if (!p.doorFullyClosed) { /* door closing */ }
      else if (!p.lightsOn) tap('KeyL');
      else if (fm.flapIndex < 1) tap('KeyF');
      else if (!g.belts) tap('KeyN');
      else if (fm.engine.state === 'off') tap('KeyI');
      return;
    }
    if (phase === 'takeoff') { thrTo(1.1); if (V > 28) pitchTo(9 * deg); else { key('KeyW', false); key('KeyS', false); } if (!fm.onGround && fm.y > 3) phase = 'climb'; }
    else if (phase === 'climb') { thrTo(1.1); pitchTo(8 * deg); if (fm.y > 15 && fm.gearTarget > 0.5) tap('KeyG'); if (fm.y > 100 && fm.flapIndex > 0) tap('KeyV'); if (fm.y > 330) phase = 'cruise'; }
    else if (phase === 'cruise') { thrTo(0.7); pitchTo((350 - fm.y) * 0.002 - fm.vy * 0.01 + 0.5 * deg); if ((AIM - fm.x) * SLOPE < fm.y) phase = 'descent'; }
    else if (phase === 'descent') { const ta = (AIM - fm.x) * SLOPE, tv = -fm.vx * SLOPE; pitchTo((ta - fm.y) * 0.004 + (tv - fm.vy) * 0.02 + 1 * deg); const ts = AIM - fm.x < 3000 ? 32 : 45; thrTo(Math.max(0, Math.min(1, 0.35 + (ts - V) * 0.08))); if (AIM - fm.x < 4500 && fm.gearTarget < 0.5) tap('KeyG'); if (AIM - fm.x < 3200 && fm.flapIndex < 3) tap('KeyF'); if (fm.y < 7) phase = 'flare'; }
    else if (phase === 'flare') { thrTo(-0.1); pitchTo(6 * deg); if (fm.onGround) phase = 'rollout'; }
    else if (phase === 'rollout') { thrTo(-0.1); key('KeyW', false); key('KeyS', true); }
  }, 1000 / 60);

  window.__perf = {
    info,
    snapshot() {
      const count = n;
      const a = Array.from(ring.subarray(0, count)).sort((x, y) => x - y);
      n = 0;
      const pct = (p) => (count ? a[Math.min(count - 1, Math.floor(p * count))] : null);
      let sum = 0, over20 = 0, over33 = 0, over50 = 0;
      for (const v of a) { sum += v; if (v > 20) over20++; if (v > 33.4) over33++; if (v > 50) over50++; }
      const mem = performance.memory;
      const r = g.renderer.info.render;
      return {
        frames: count,
        meanMs: count ? sum / count : null,
        p50Ms: pct(0.5), p95Ms: pct(0.95), p99Ms: pct(0.99), maxMs: count ? a[count - 1] : null,
        over20: over20, over33: over33, over50: over50,
        gameFps: g.fps,
        drawCalls: r.calls, triangles: r.triangles,
        geometries: g.renderer.info.memory.geometries, textures: g.renderer.info.memory.textures,
        heapUsedMB: mem ? mem.usedJSHeapSize / 1048576 : null,
        state: g.state, phase, x: Math.round(fm.x), alt: Math.round(fm.y),
        flightsCompleted: flights.length,
        lastFlight: flights[flights.length - 1] ?? null,
        visible: document.visibilityState,
      };
    },
    flights,
  };
  return info;
})`;

// ------------------------------------------------------------------ run

const stats = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return { min: s[0], max: s[s.length - 1], mean: v.reduce((a, b) => a + b, 0) / v.length, median: s[Math.floor(s.length / 2)] };
};
const f1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(1));

async function main() {
  const devices = adb('devices').split('\n').slice(1).filter((l) => /\tdevice$/.test(l));
  if (devices.length !== 1) throw new Error(`Expected exactly one connected device, found ${devices.length}. Connect the phone and allow USB debugging.`);
  const device = {
    model: sh('getprop ro.product.model'),
    marketName: sh('getprop ro.product.marketname'),
    android: sh('getprop ro.build.version.release'),
    soc: sh('getprop ro.soc.model') || sh('getprop ro.board.platform'),
    webview: (/versionName=(\S+)/.exec(sh('dumpsys package com.google.android.webview')) ?? [])[1] ?? null,
  };
  const wake = sh('dumpsys power');
  if (!/mWakefulness=Awake/.test(wake)) throw new Error('Screen is off. Unlock the phone and keep the screen on.');

  const cleanup = () => {
    restoreRefresh();
    try {
      adb('forward', '--remove', `tcp:${PORT}`);
    } catch {}
  };
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  try {
    if (REFRESH !== 'keep') pinRefresh(Number(REFRESH));
    const refreshSettings = Object.fromEntries(REFRESH_KEYS.map(([ns, k]) => [`${ns}.${k}`, sh(`settings get ${ns} ${k}`)]));

    sh(`am force-stop ${PKG}`);
    await sleep(800);
    const startOut = sh(`am start -W -n ${ACTIVITY}`);
    const coldStartMs = Number(/TotalTime:\s*(\d+)/.exec(startOut)?.[1] ?? NaN);
    const { pid, cdp } = await attach();
    const t0 = Date.now();
    const info = await cdp.eval(`${PROBE}(${JSON.stringify(QUALITY)})`);
    const gameReadyMs = Date.now() - t0;

    console.log(`AIRWAYS perf · ${LABEL} · ${device.marketName || device.model} · Android ${device.android} · WebView ${device.webview}`);
    console.log(`GPU ${info.renderer} · WebGL2 ${info.webgl2} · DPR ${info.devicePixelRatio} · canvas ${info.canvas.join('×')} · quality ${info.quality}`);
    console.log(`refresh request: ${REFRESH} · cold start ${coldStartMs} ms · pid ${pid}`);

    const samples = [];
    const memory = [];
    const battery0 = readBattery();
    const end = Date.now() + MINUTES * 60_000;
    let nextMem = 0;
    await sleep(SAMPLE_S * 1000);
    await cdp.eval('window.__perf.snapshot()'); // drop the warm-up window (shader compilation, first flight start)

    while (Date.now() < end) {
      await sleep(SAMPLE_S * 1000);
      const t = (Date.now() - t0) / 1000;
      const frame = await cdp.eval('window.__perf.snapshot()');
      const thermal = readThermal();
      const bat = readBattery();
      const cpu = readCpu();
      const s = { t: Math.round(t), ...frame, thermal, batteryLevel: bat.level, batteryTempC: bat.tempC, cpu };
      samples.push(s);
      if (t >= nextMem) {
        memory.push({ t: Math.round(t), ...readMemoryKb(), heapUsedMB: frame.heapUsedMB });
        nextMem = t + MEM_EVERY_S;
      }
      const fps = s.meanMs ? 1000 / s.meanMs : null;
      console.log(
        `${String(s.t).padStart(5)}s fps ${f1(fps).padStart(5)} p95 ${f1(s.p95Ms).padStart(5)}ms p99 ${f1(s.p99Ms).padStart(5)}ms max ${f1(s.maxMs).padStart(6)}ms ` +
          `>33ms ${String(s.over33).padStart(3)} · cpu ${f1(thermal.cpu)}° gpu ${f1(thermal.gpu)}° skin ${f1(thermal.skin)}° bat ${f1(bat.tempC)}° st ${thermal.sensorStatus}/${thermal.status} · ${s.phase} alt ${s.alt}`,
      );
    }
    memory.push({ t: Math.round((Date.now() - t0) / 1000), ...readMemoryKb() });
    const battery1 = readBattery();
    const flights = await cdp.eval('window.__perf.flights');
    cdp.close();

    // Summary
    const fpsWin = samples.map((s) => (s.meanMs ? 1000 / s.meanMs : NaN));
    const firstMin = fpsWin.slice(0, Math.max(1, Math.round(60 / SAMPLE_S)));
    const lastMin = fpsWin.slice(-Math.max(1, Math.round(60 / SAMPLE_S)));
    const totalFrames = samples.reduce((a, s) => a + s.frames, 0);
    const summary = {
      fps: stats(fpsWin),
      fpsFirstMinute: stats(firstMin),
      fpsLastMinute: stats(lastMin),
      p95Ms: stats(samples.map((s) => s.p95Ms)),
      p99Ms: stats(samples.map((s) => s.p99Ms)),
      worstFrameMs: Math.max(...samples.map((s) => s.maxMs ?? 0)),
      framesOver20MsPct: (100 * samples.reduce((a, s) => a + s.over20, 0)) / totalFrames,
      framesOver33MsPct: (100 * samples.reduce((a, s) => a + s.over33, 0)) / totalFrames,
      framesOver50MsPct: (100 * samples.reduce((a, s) => a + s.over50, 0)) / totalFrames,
      drawCalls: stats(samples.map((s) => s.drawCalls)),
      triangles: stats(samples.map((s) => s.triangles)),
      cpuTempC: stats(samples.map((s) => s.thermal.cpu)),
      gpuTempC: stats(samples.map((s) => s.thermal.gpu)),
      skinTempC: stats(samples.map((s) => s.thermal.skin)),
      batteryTempC: stats(samples.map((s) => s.batteryTempC)),
      thermalStatusMax: Math.max(...samples.map((s) => s.thermal.status).filter(Number.isFinite)),
      sensorStatusMax: Math.max(...samples.map((s) => s.thermal.sensorStatus)),
      batteryLevel: { start: battery0.level, end: battery1.level, charging: battery0.usbPowered || battery0.acPowered },
      appCpuPct: stats(samples.map((s) => s.cpu?.appCpuPct)),
      rendererCpuPct: stats(samples.map((s) => s.cpu?.rendererCpuPct)),
      heapUsedMB: stats(samples.map((s) => s.heapUsedMB)),
      appPssMB: stats(memory.map((m) => (m.appPssKb ?? NaN) / 1024)),
      rendererPssMB: stats(memory.map((m) => (m.rendererPssKb ?? NaN) / 1024)),
      flightsCompleted: flights.length,
    };

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(OUT_DIR, `${stamp}-${LABEL}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({ label: LABEL, refreshRequest: REFRESH, quality: QUALITY, minutes: MINUTES, device, refreshSettings, coldStartMs, gameReadyMs, info, summary, flights, memory, samples }, null, 2) + '\n',
    );

    console.log('\nSummary');
    console.log(`  FPS mean ${f1(summary.fps?.mean)} (min window ${f1(summary.fps?.min)}) · first minute ${f1(summary.fpsFirstMinute?.mean)} · last minute ${f1(summary.fpsLastMinute?.mean)}`);
    console.log(`  frame p95 ${f1(summary.p95Ms?.median)} ms · p99 ${f1(summary.p99Ms?.median)} ms · worst ${f1(summary.worstFrameMs)} ms`);
    console.log(`  frames >20 ms ${summary.framesOver20MsPct.toFixed(2)} % · >33 ms ${summary.framesOver33MsPct.toFixed(2)} % · >50 ms ${summary.framesOver50MsPct.toFixed(2)} %`);
    console.log(`  temps max: cpu ${f1(summary.cpuTempC?.max)}° gpu ${f1(summary.gpuTempC?.max)}° skin ${f1(summary.skinTempC?.max)}° battery ${f1(summary.batteryTempC?.max)}° · sensor status max ${summary.sensorStatusMax} (service ${summary.thermalStatusMax})`);
    console.log(`  battery ${battery0.level}% → ${battery1.level}% (charging: ${summary.batteryLevel.charging})`);
    console.log(`  memory: app PSS ${f1(summary.appPssMB?.max)} MB · WebView renderer PSS ${f1(summary.rendererPssMB?.max)} MB · JS heap ${f1(summary.heapUsedMB?.max)} MB`);
    console.log(`  draw calls ${summary.drawCalls?.min}–${summary.drawCalls?.max} · flights completed ${summary.flightsCompleted}`);
    console.log(`\nWritten ${path.relative(ROOT, file)}`);
  } finally {
    cleanup();
  }
}

main().catch((e) => {
  restoreRefresh();
  console.error(`\nperf:android failed: ${e.message}`);
  process.exitCode = 1;
});
