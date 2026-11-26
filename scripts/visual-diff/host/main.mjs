// Visual-diff host: renders the built renderer (out/renderer) in Electron with the unchanged built preload. Every IPC
// channel is answered by the host itself:
//   record  forwards each call to a running Browser QA bridge (the real product backend) and stores the responses;
//   replay  serves the stored responses, with a frozen clock and stopped animations. Each scenario renders once per
//           variant (theme × width) in a fresh in-memory session. While its steps run, a per-frame sampler records
//           the visible interaction state (L3); afterwards the host captures a DOM fingerprint (L1) and the window
//           bitmap (L2).
// Started by scripts/visual-diff/run.mjs; never shipped.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';

const argv = Object.fromEntries(
  process.argv
    .slice(process.argv.indexOf('--') + 1)
    .reduce(
      (pairs, value, index, all) => (index % 2 === 0 ? [...pairs, [value.replace(/^--/, ''), all[index + 1]]] : pairs),
      [],
    ),
);
const mode = argv.mode;
if (mode === 'diff') diffImages();
const root = mode === 'diff' ? null : path.resolve(argv.build);
const FROZEN_NOW = Date.parse('2026-11-25T09:30:00.000Z');
/** Every scenario renders in each of these unless it declares `variants`. */
const VARIANTS = ['dark-1440', 'light-1440', 'dark-720', 'light-720'];
/** In replay the answers are immediate and animations end at once, so record-time waits are capped. */
const REPLAY_STEP_WAIT_MS = 400;
const REPLAY_SETTLE_MS = 600;
/**
 * Every replayed answer arrives a few frames after the call, as a real backend's would: work the renderer schedules
 * for the next frame (focus moves, measurements) then always runs before the answer, not only on a fast machine.
 */
const REPLAY_LATENCY_MS = 120;
const debug = (...parts) => {
  if (process.env.VISUAL_DIFF_DEBUG) console.log('[visual-diff]', ...parts);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pixels whose channels moved by more than the antialiasing noise of software rendering (a few levels) between two
 * captures; written as JSON to stdout.
 */
function diffImages() {
  const NOISE = 16;
  app.whenReady().then(() => {
    const [a, b] = [argv.a, argv.b].map((file) => nativeImage.createFromPath(file));
    const [sizeA, sizeB] = [a.getSize(), b.getSize()];
    if (sizeA.width !== sizeB.width || sizeA.height !== sizeB.height) {
      process.stdout.write(`${JSON.stringify({ pixels: sizeA.width * sizeA.height, sizeChanged: true })}\n`);
      app.exit(0);
      return;
    }
    const [bitsA, bitsB] = [a.toBitmap(), b.toBitmap()];
    let pixels = 0;
    for (let offset = 0; offset < bitsA.length; offset += 4) {
      if (
        Math.abs(bitsA[offset] - bitsB[offset]) > NOISE ||
        Math.abs(bitsA[offset + 1] - bitsB[offset + 1]) > NOISE ||
        Math.abs(bitsA[offset + 2] - bitsB[offset + 2]) > NOISE
      )
        pixels += 1;
    }
    process.stdout.write(`${JSON.stringify({ pixels })}\n`);
    app.exit(0);
  });
}

if (mode !== 'diff') {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('lang', 'en-US');
  // A throwaway Electron profile per run, created and removed by run.mjs.
  app.setPath('userData', path.resolve(argv.profile));
}

/** Channel names come from the built preload, which compiles the shared channel table in. */
function channelsFromPreload() {
  const source = fs.readFileSync(path.join(root, 'out/preload/index.js'), 'utf8');
  return [...new Set([...source.matchAll(/["']([a-z][a-zA-Z-]*:[a-zA-Z][a-zA-Z:-]*)["']/g)].map((match) => match[1]))];
}

/** Window chrome the bridge does not serve; the desktop answers are fixed so both modes agree. */
const DESKTOP_ANSWERS = { 'window:isMaximized': false };

/** Record: one bridge session; every renderer call goes to the real backend and its answer is kept in call order. */
function createRecorder(bootstrapUrl) {
  const origin = new URL(bootstrapUrl).origin;
  const recorded = {};
  // The bootstrap URL is single-use: every concurrent call waits on the one login.
  let session = null;
  const login = () =>
    (session ??= fetch(bootstrapUrl, { redirect: 'manual' }).then((response) => {
      const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
      if (!cookie) throw new Error('bridge bootstrap returned no session cookie');
      return cookie;
    }));
  const latest = { answers: new Map(), calls: new Map() };
  return {
    recorded,
    latest,
    unanswered: new Set(),
    release() {},
    async answer(channel, args) {
      latest.calls.set(channel, args);
      const cookie = await login();
      const response = await fetch(`${origin}/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
        body: JSON.stringify({ channel, args }),
      });
      const body = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
      // A handler failure is an answer like any other: the desktop host hands the same error result to the renderer.
      const entry = body.appError
        ? { result: { __rdcIpcError: body.appError } }
        : body.success
          ? { result: body.result ?? null }
          : { error: String(body.error ?? `HTTP ${response.status}`) };
      (recorded[channel] ??= []).push(entry);
      if (entry.error) throw new Error(entry.error);
      latest.answers.set(channel, entry.result);
      return entry.result;
    },
  };
}

/** The variant's theme replaces the recorded appearance theme wherever an answer carries one. */
function withTheme(value, theme, depth = 0) {
  if (depth > 3 || value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const copy = { ...value };
  for (const [key, child] of Object.entries(copy)) {
    if (key === 'appearance' && child && typeof child === 'object' && typeof child.theme === 'string')
      copy.appearance = { ...child, theme };
    else if (key === 'systemTheme' && typeof child === 'string') copy.systemTheme = theme;
    else copy[key] = withTheme(child, theme, depth + 1);
  }
  return copy;
}

/**
 * Replay: the n-th call of a channel gets its n-th recorded answer; calls past the end repeat the last one. A
 * scenario's `respond` entries change one answer ({channel, call}: n-th call, default 1): `delayMs` answers late,
 * `hold` keeps the answer until a `release` step names the channel (oldest held first, or the one its `call` names,
 * so releasing call 2 before call 1 delivers a reordered pair), `error` answers with that IPC error payload and
 * `result` with that value instead of the recorded one (the state a failed write leaves behind).
 */
function createReplayer(responses, respond, theme) {
  const calls = {};
  const unanswered = new Set();
  const held = [];
  const latest = { answers: new Map(), calls: new Map() };
  let pending = 0;
  return {
    unanswered,
    latest,
    /** Answers on their way, not counting held ones: those wait for a step, not for time. */
    get pending() {
      return pending - held.length;
    },
    release(channel, call) {
      const index = held.findIndex((entry) => entry.channel === channel && (call === undefined || entry.call === call));
      if (index < 0) throw new Error(`release ${channel}${call ? ` call ${call}` : ''}: no held answer`);
      held.splice(index, 1)[0].resolve();
    },
    async answer(channel, args) {
      latest.calls.set(channel, args);
      const entries = responses?.[channel];
      if (!entries?.length) {
        unanswered.add(channel);
        throw new Error(`VISUAL_DIFF_UNRECORDED: ${channel}`);
      }
      calls[channel] = (calls[channel] ?? 0) + 1;
      const call = calls[channel];
      const entry = entries[Math.min(call, entries.length) - 1];
      const change = respond.find((item) => item.channel === channel && (item.call ?? 1) === call);
      pending += 1;
      try {
        if (change?.hold) await new Promise((resolve) => held.push({ channel, call, resolve }));
        await sleep(change?.delayMs ?? REPLAY_LATENCY_MS);
      } finally {
        pending -= 1;
      }
      if (change?.error) return { __rdcIpcError: change.error };
      if (change && 'result' in change) return withTheme(change.result, theme);
      if (entry.error) throw new Error(entry.error);
      latest.answers.set(channel, entry.result);
      return withTheme(entry.result, theme);
    },
  };
}

// Page-world script run before any renderer code: a fixed clock, so relative times and durations never drift.
const FREEZE_SCRIPT = `(() => {
  const now = ${FROZEN_NOW};
  const RealDate = Date;
  class FrozenDate extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  globalThis.Date = FrozenDate;
})();`;

/**
 * L3 sampler, installed on every document: between begin() and end() it reads the visible interaction state on each
 * animation frame — focus, the overlay stack, every aria-expanded value, the rect of each data-testid element and the
 * scroll offset of scrolled containers. end() returns the settled state after the step and the keys that flickered:
 * a key whose value went back to one it had already left within the step (a layout jump that springs back, a
 * popover that closes and reopens, a label that reverts). Missing keys read as "-"; an element that only appears
 * for a while (a progress row) is not a flicker, one that disappears and comes back is. An intermediate value seen on a
 * single frame does not count: whether an answer lands before or after a given frame is scheduling, not intent, so
 * only states that stayed on screen for two frames or more take part.
 */
const L3_SCRIPT = `(() => {
  const describe = (el) => [el.tagName.toLowerCase(), el.getAttribute('data-testid') || '', el.getAttribute('role') || ''].join(':');
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0; };
  const OVERLAYS = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="tooltip"],[aria-modal="true"],[popover]';
  const sample = () => {
    const state = {};
    const active = document.activeElement;
    state.focus = active && active !== document.body ? describe(active) + ':' + (active.getAttribute('aria-label') || '') : 'body';
    state.overlays = [...document.querySelectorAll(OVERLAYS)].filter(visible).map(describe).join(' ') || '-';
    const count = new Map();
    const key = (prefix, name) => { const n = count.get(prefix + name) || 0; count.set(prefix + name, n + 1); return prefix + name + (n ? '#' + n : ''); };
    for (const el of document.querySelectorAll('[aria-expanded]')) if (visible(el)) state[key('expanded ', describe(el))] = el.getAttribute('aria-expanded');
    for (const el of document.querySelectorAll('[data-testid]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const id = key('rect ', el.getAttribute('data-testid'));
      state[id] = [r.x, r.y, r.width, r.height].map(Math.round).join(',');
      if (el.scrollTop) state['scroll ' + id.slice(5)] = String(Math.round(el.scrollTop));
    }
    return state;
  };
  let step = null;
  const record = () => {
    const state = sample();
    for (const name of new Set([...Object.keys(step.last), ...Object.keys(state)])) {
      const value = state[name] ?? '-';
      const runs = (step.seqs[name] ??= [[step.last[name] ?? '-', 1]]);
      if (runs[runs.length - 1][0] === value) runs[runs.length - 1][1] += 1;
      else runs.push([value, 1]);
    }
    step.last = state;
  };
  const steady = (runs) => runs
    .filter(([, frames], index) => index === 0 || index === runs.length - 1 || frames >= 2)
    .map(([value]) => value)
    .filter((value, index, values) => index === 0 || values[index - 1] !== value);
  const frame = () => { if (!step) return; record(); step.raf = requestAnimationFrame(frame); };
  window.__visualDiffL3 = {
    begin() { const last = sample(); step = { last, seqs: {}, raf: 0 }; step.raf = requestAnimationFrame(frame); },
    end() {
      if (!step) return null;
      cancelAnimationFrame(step.raf);
      record();
      const seqs = Object.entries(step.seqs).map(([name, runs]) => [name, steady(runs)]);
      const shown = (seq) => seq.filter((value) => value !== '-');
      const flicker = seqs.filter(([, seq]) => new Set(shown(seq)).size < shown(seq).length).map(([name]) => name).sort();
      const changes = Object.fromEntries(seqs.filter(([, seq]) => seq.length > 1));
      const settled = step.last;
      step = null;
      return { settled, flicker, changes };
    },
  };
})();`;

const SETTLE_CSS = `*, *::before, *::after {
  animation-delay: 0s !important; animation-duration: 0s !important; animation-iteration-count: 1 !important;
  transition-delay: 0s !important; transition-duration: 0s !important; caret-color: transparent !important;
}`;

const FINGERPRINT_SCRIPT = `(() => {
  const props = ['display', 'position', 'color', 'background-color', 'font-size', 'font-weight', 'line-height', 'opacity',
    'border-top-color', 'border-radius', 'gap', 'padding-top', 'padding-left', 'visibility'];
  const nodes = [];
  for (const element of document.querySelectorAll('body *')) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const style = getComputedStyle(element);
    nodes.push([
      element.tagName.toLowerCase(), element.getAttribute('data-testid') ?? '', element.getAttribute('role') ?? '',
      [...element.classList].filter((name) => name.startsWith('is-')).sort().join('.'),
      Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height),
      props.map((name) => style.getPropertyValue(name)).join('|'),
      element.childElementCount === 0 ? (element.textContent ?? '').trim().slice(0, 80) : '',
    ].join(' '));
  }
  return nodes;
})()`;

const selectorOf = (step) => (step.testId ? `[data-testid="${step.testId}"]` : step.selector);

async function waitForSelector(contents, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!(await contents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`))) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${selector}`);
    await sleep(100);
  }
}

/**
 * An `emit` payload with its bindings resolved: a string `$<channel>.<path>` is that path in the latest answer the
 * scenario got on the channel and `$call:<channel>.<path>` that path in the arguments of its latest call (ids the
 * renderer generates, such as a send's request id, differ between recording and replay), so the payload follows the
 * page whenever a scenario is re-recorded. `{ "$concat": [...] }` joins its resolved entries, `{ "$now": <ms> }` is
 * the page clock plus that offset, `{ "$max": [...] }` the largest of its entries (a replayed page runs on the frozen
 * clock, older than the recorded answers), `{ "$add": [...] }` their sum, and `{ "$merge": "$<channel>.<path>",
 * ...fields }` that object with the fields replaced.
 */
function resolveEmit(value, latest, now) {
  const bound = (reference) => {
    const call = reference.startsWith('$call:');
    const [channel, ...keys] = reference.slice(call ? 6 : 1).split('.');
    const source = call ? latest.calls : latest.answers;
    if (!source.has(channel))
      throw new Error(`emit binds ${reference}, but ${channel} was never ${call ? 'called' : 'answered'}`);
    return keys.reduce((object, key) => object?.[key], source.get(channel));
  };
  if (typeof value === 'string' && value.startsWith('$')) return bound(value);
  if (Array.isArray(value)) return value.map((entry) => resolveEmit(entry, latest, now));
  if (!value || typeof value !== 'object') return value;
  if ('$now' in value) return now + value.$now;
  if ('$concat' in value) return value.$concat.map((entry) => resolveEmit(entry, latest, now)).join('');
  if ('$max' in value) return Math.max(...value.$max.map((entry) => resolveEmit(entry, latest, now)));
  if ('$add' in value) return value.$add.reduce((sum, entry) => sum + resolveEmit(entry, latest, now), 0);
  const { $merge: base, ...fields } = value;
  const resolved = Object.fromEntries(
    Object.entries(fields).map(([key, entry]) => [key, resolveEmit(entry, latest, now)]),
  );
  return base ? { ...bound(base), ...resolved } : resolved;
}

/**
 * Steps address the UI by test id or selector, the same handles Browser QA uses. A step may wait for an element,
 * click (`optional` when only some variants show the target), hover, type, press a key (with `modifiers`), release a
 * held answer, emit a main-process event (`emit`: channel and payload, see resolveEmit), pin focus (`focus` with a
 * `reason`), or reload (setup only, with `project`).
 */
async function runStep(window, step, context) {
  const contents = window.webContents;
  const selector = JSON.stringify(selectorOf(step) ?? '');
  if (step.waitFor) await waitForSelector(contents, step.waitFor, step.timeoutMs ?? 15_000);
  // Setup only: a small project inside the instance's disposable userData (recordings name it /visual-diff/...).
  if (step.project) {
    const projectRoot = path.join(argv.userdata, 'visual-diff-project');
    fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'notes.md'), '# Notes\n\n- One draw call in this frame.\n');
    await contents.executeJavaScript(`window.electronAPI.project.add(${JSON.stringify(projectRoot)})`);
  }
  // The host forwards no main-process events, so setup reloads to read what a step changed (a saved provider, a turn).
  if (step.project || step.reload) contents.reload();
  if (step.release) context.answerer.release(step.release, step.call);
  // A main-process event the host would otherwise never forward (a running tool's progress).
  if (step.emit) {
    const now = await contents.executeJavaScript('Date.now()');
    contents.send(step.emit.channel, resolveEmit(step.emit.payload, context.answerer.latest, now));
  }
  // Pins focus where the product leaves it to frame timing; the step's `reason` names the race.
  if (step.focus) {
    if (!step.reason) throw new Error(`focus step on ${step.focus} needs a reason`);
    const focused = await contents.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(step.focus)}); el?.focus(); return Boolean(el); })()`,
    );
    if (!focused) throw new Error(`nothing to focus for ${step.focus}`);
  }
  if (step.click) {
    const clicked = await contents.executeJavaScript(
      // el.click() activates without moving focus, so a focus-triggered tooltip never races the capture.
      `(() => { const el = document.querySelector(${selector}); el?.click(); return Boolean(el); })()`,
    );
    // An optional click addresses UI only some variants show (the narrow layout's pane tabs).
    if (!clicked && step.optional) return;
    if (!clicked) throw new Error(`nothing to click for ${selectorOf(step)}`);
  }
  if (step.hover) {
    const point = await contents.executeJavaScript(`(() => {
      const el = document.querySelector(${selector});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (!point) throw new Error(`nothing to hover for ${selectorOf(step)}`);
    contents.sendInputEvent({ type: 'mouseMove', ...point });
  }
  if (step.type !== undefined) {
    await contents.executeJavaScript(`(() => {
      const el = document.querySelector(${selector});
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
      setter.call(el, ${JSON.stringify(step.type)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  }
  if (step.key) {
    const modifiers = step.modifiers ?? [];
    contents.sendInputEvent({ type: 'keyDown', keyCode: step.key, modifiers });
    if (step.key.length === 1) contents.sendInputEvent({ type: 'char', keyCode: step.key, modifiers });
    contents.sendInputEvent({ type: 'keyUp', keyCode: step.key, modifiers });
  }
  const wait = step.waitMs ?? 150;
  await sleep(context.replay ? Math.min(step.replayWaitMs ?? wait, REPLAY_STEP_WAIT_MS) : wait);
}

async function openWindow({ theme, width, height, freeze, partition, answerer, query }) {
  const window = new BrowserWindow({
    // Shown on the (virtual) display: a hidden window may hand capturePage its last painted frame instead of the DOM.
    width,
    height,
    show: true,
    useContentSize: true,
    frame: false,
    x: 0,
    y: 0,
    webPreferences: {
      preload: path.join(root, 'out/preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: !freeze,
      // A fresh in-memory session per render, so no variant or scenario sees another's storage.
      ...(partition ? { partition } : {}),
    },
  });
  // Registered before the first load: the renderer asks for settings as soon as it starts.
  answerers.set(window.webContents.id, answerer);
  window.webContents.on('console-message', (event) => debug('renderer:', event.message));
  // The DevTools target exists once a document is loaded; the page scripts then apply to the next navigation.
  await window.loadURL('about:blank');
  const cdp = window.webContents.debugger;
  cdp.attach('1.3');
  await cdp.sendCommand('Page.enable');
  await cdp.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  if (freeze) {
    // Parallel replay hosts share the Windows desktop. Keep each fixture's DOM focus independent of window activation.
    await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: FREEZE_SCRIPT });
    await cdp.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: L3_SCRIPT });
  }
  // A scenario's `query` adds entry parameters main would pass (the failure page's crash facts).
  await window.loadFile(path.join(root, 'out/renderer/index.html'), { query: { ...query, theme } });
  // Every animation and transition shows its end state at once, and no caret blinks, so a capture is one frame.
  if (freeze) await window.webContents.insertCSS(SETTLE_CSS, { cssOrigin: 'user' });
  return window;
}

// Closing a window must not end the run; the host exits explicitly when it is done.
app.on('window-all-closed', () => undefined);

/** IPC answers go to the answerer of the window that asked. */
const answerers = new Map();
function registerChannels() {
  for (const channel of channelsFromPreload()) {
    ipcMain.handle(channel, (event, ...args) =>
      channel in DESKTOP_ANSWERS ? DESKTOP_ANSWERS[channel] : answerers.get(event.sender.id).answer(channel, args),
    );
  }
}

async function record() {
  const scenario = JSON.parse(fs.readFileSync(argv.scenario, 'utf8'));
  const recorder = createRecorder(argv.bridge);
  const [width, height] = scenario.viewport ?? [1440, 900];
  const context = { answerer: recorder, replay: false };
  // Setup builds the state (connect a provider, send a turn) in a window whose calls are not kept.
  if (scenario.setup?.length) {
    const setupWindow = await openWindow({ theme: 'dark', width, height, freeze: false, answerer: recorder });
    for (const step of scenario.setup) await runStep(setupWindow, step, context);
    setupWindow.destroy();
    for (const key of Object.keys(recorder.recorded)) delete recorder.recorded[key];
  }
  const window = await openWindow({
    theme: 'dark',
    width,
    height,
    freeze: false,
    answerer: recorder,
    query: scenario.query,
  });
  for (const step of scenario.steps ?? []) await runStep(window, step, context);
  await sleep(scenario.settleMs ?? 800);
  await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  const { setup: _setup, ...definition } = scenario;
  fs.writeFileSync(argv.out, `${JSON.stringify({ ...definition, responses: recorder.recorded }, null, 1)}\n`);
  debug('recorded', scenario.id, Object.keys(recorder.recorded).length, 'channels');
}

/**
 * A scenario's `l3Ignore` ({keys: [prefix...], reason}) leaves keys out of its L3 result where the product leaves
 * them to frame timing; the reason names the race.
 */
function ignoreKeys(sampled, ignore) {
  if (!ignore) return sampled;
  if (!ignore.reason) throw new Error('l3Ignore needs a reason');
  const kept = (name) => !ignore.keys.some((prefix) => name.startsWith(prefix));
  const pick = (object) => object && Object.fromEntries(Object.entries(object).filter(([name]) => kept(name)));
  return {
    settled: pick(sampled.settled),
    flicker: sampled.flicker.filter(kept),
    changes: pick(sampled.changes),
  };
}

/** Waits until no answer has been in flight for a while (bounded), so the next step starts from a quiet page. */
async function quiesce(answerer) {
  const deadline = Date.now() + 5000;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if (answerer.pending > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= 250) return;
    await sleep(25);
  }
}

let renders = 0;

/** One scenario in one variant: the steps under the L3 sampler, then the L1 fingerprint and the L2 bitmap. */
async function renderVariant(scenario, variant) {
  const [theme, widthText] = variant.split('-');
  const answerer = createReplayer(scenario.responses, scenario.respond ?? [], theme);
  const window = await openWindow({
    theme,
    width: Number(widthText),
    height: scenario.viewport?.[1] ?? 900,
    freeze: true,
    partition: `visual-diff-${(renders += 1)}`,
    answerer,
    query: scenario.query,
  });
  try {
    const context = { answerer, replay: true };
    const l3 = [];
    await quiesce(answerer);
    for (const [index, step] of (scenario.steps ?? []).entries()) {
      // Only steps that act are sampled: a bare wait covers the page's own start-up, whose frame timing is not intent.
      const acts = step.click || step.hover || step.type !== undefined || step.key || step.release || step.emit;
      if (!acts) {
        await runStep(window, step, context);
        continue;
      }
      await window.webContents.executeJavaScript('window.__visualDiffL3?.begin()');
      await runStep(window, step, context);
      await quiesce(answerer);
      const sampled = await window.webContents.executeJavaScript('window.__visualDiffL3?.end() ?? null');
      l3.push({
        step: index,
        ...ignoreKeys(sampled ?? { settled: null, flicker: [], changes: {} }, scenario.l3Ignore),
      });
    }
    await sleep(Math.min(scenario.settleMs ?? 800, REPLAY_SETTLE_MS));
    await quiesce(answerer);
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    const fingerprint = await window.webContents.executeJavaScript(FINGERPRINT_SCRIPT);
    window.webContents.invalidate();
    await window.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const image = await window.webContents.capturePage();
    const id = `${scenario.id}@${variant}`;
    fs.writeFileSync(path.join(argv.out, `${id}.png`), image.toPNG());
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    fs.writeFileSync(
      path.join(argv.out, `${id}.json`),
      `${JSON.stringify(
        {
          id,
          scenario: scenario.id,
          variant,
          l1: hash(fingerprint.join('\n')),
          l2: hash(image.toBitmap()),
          l3: hash(JSON.stringify(l3.map(({ settled, flicker }) => ({ settled, flicker })))),
          size: image.getSize(),
          unanswered: [...answerer.unanswered].sort(),
          nodes: fingerprint,
          steps: l3,
        },
        null,
        1,
      )}\n`,
    );
  } catch (error) {
    // What the window showed when the scenario failed, for the CI artifact.
    const image = await window.webContents.capturePage().catch(() => null);
    if (image) fs.writeFileSync(path.join(argv.out, `${scenario.id}@${variant}.failed.png`), image.toPNG());
    throw error;
  } finally {
    answerers.delete(window.webContents.id);
    window.destroy();
  }
}

/** Every listed scenario in each of its variants; a scenario that fails is reported and the rest still render. */
async function replay() {
  const files = JSON.parse(fs.readFileSync(argv.scenarios, 'utf8'));
  fs.mkdirSync(argv.out, { recursive: true });
  const failed = [];
  for (const file of files) {
    const scenario = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const variant of scenario.variants ?? VARIANTS) {
      try {
        await renderVariant(scenario, variant);
      } catch (error) {
        failed.push(scenario.id);
        console.error(
          `[visual-diff] ${scenario.id}@${variant}: ${error instanceof Error ? error.stack : String(error)}`,
        );
        break;
      }
    }
  }
  process.stdout.write(`${JSON.stringify({ failed })}\n`);
}

if (mode !== 'diff') {
  app
    .whenReady()
    .then(() => {
      registerChannels();
      return mode === 'record' ? record() : replay();
    })
    .then(
      () => app.exit(0),
      (error) => {
        console.error(`[visual-diff] ${error instanceof Error ? error.stack : String(error)}`);
        app.exit(1);
      },
    );
}
