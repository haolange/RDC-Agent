// Visual-diff host: renders the built renderer (out/renderer) in Electron with the unchanged built preload. Every IPC
// channel is answered by the host itself:
//   record  forwards each call to a running Browser QA bridge (the real product backend) and stores the responses;
//   replay  serves the stored responses, with a frozen clock and stopped animations, then captures a DOM fingerprint
//           (L1) and the window bitmap (L2).
// Started by scripts/visual-diff/run.mjs; never shipped.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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
const scenario = mode === 'diff' ? null : JSON.parse(fs.readFileSync(argv.scenario, 'utf8'));
const root = path.resolve(argv.build);
const FROZEN_NOW = Date.parse('2026-11-25T09:30:00.000Z');
const debug = (...parts) => {
  if (process.env.VISUAL_DIFF_DEBUG) console.log('[visual-diff]', ...parts);
};

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
  app.commandLine.appendSwitch('lang', scenario.locale ?? 'en-US');
  // A throwaway Electron profile per run, removed on exit.
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-visual-diff-host-'));
  app.setPath('userData', profileDir);
  process.on('exit', () => fs.rmSync(profileDir, { recursive: true, force: true }));
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
  return {
    recorded,
    unanswered: new Set(),
    async answer(channel, args) {
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
      return entry.result;
    },
  };
}

/** Replay: the n-th call of a channel gets its n-th recorded answer; calls past the end repeat the last one. */
function createReplayer(responses) {
  const calls = {};
  const unanswered = new Set();
  return {
    unanswered,
    async answer(channel) {
      const entries = responses?.[channel];
      if (!entries?.length) {
        unanswered.add(channel);
        throw new Error(`VISUAL_DIFF_UNRECORDED: ${channel}`);
      }
      calls[channel] = (calls[channel] ?? 0) + 1;
      const entry = entries[Math.min(calls[channel], entries.length) - 1];
      if (entry.error) throw new Error(entry.error);
      return entry.result;
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

/** Steps address the UI by test id or selector, the same handles Browser QA uses. */
async function runStep(window, step) {
  const contents = window.webContents;
  const selector = JSON.stringify(selectorOf(step) ?? '');
  if (step.waitFor) {
    const deadline = Date.now() + (step.timeoutMs ?? 15_000);
    while (!(await contents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(step.waitFor)}))`))) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${step.waitFor}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  // Setup only: a small project inside the instance's disposable userData (recordings name it /visual-diff/...).
  if (step.project) {
    const projectRoot = path.join(argv.userdata, 'visual-diff-project');
    fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'notes.md'), '# Notes\n\n- One draw call in this frame.\n');
    await contents.executeJavaScript(`window.electronAPI.project.add(${JSON.stringify(projectRoot)})`);
  }
  // The host forwards no main-process events, so setup reloads to read what a step changed (a saved provider, a turn).
  if (step.project || step.reload) contents.reload();
  if (step.click) {
    const clicked = await contents.executeJavaScript(
      `(() => { const el = document.querySelector(${selector}); el?.click(); return Boolean(el); })()`,
    );
    if (!clicked) throw new Error(`nothing to click for ${selectorOf(step)}`);
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
    contents.sendInputEvent({ type: 'keyDown', keyCode: step.key });
    contents.sendInputEvent({ type: 'keyUp', keyCode: step.key });
  }
  await new Promise((resolve) => setTimeout(resolve, step.waitMs ?? 150));
}

async function openWindow(freeze) {
  const [width, height] = scenario.viewport ?? [1440, 900];
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
    },
  });
  window.webContents.on('console-message', (event) => debug('renderer:', event.message));
  // The DevTools target exists once a document is loaded; the freeze script then applies to the next navigation.
  await window.loadURL('about:blank');
  const cdp = window.webContents.debugger;
  cdp.attach('1.3');
  await cdp.sendCommand('Page.enable');
  await cdp.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scenario.theme ?? 'dark' }],
  });
  if (freeze) await cdp.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: FREEZE_SCRIPT });
  await window.loadFile(path.join(root, 'out/renderer/index.html'), { query: { theme: scenario.theme ?? 'dark' } });
  // Every animation and transition shows its end state at once, and no caret blinks, so a capture is one frame.
  if (freeze) await window.webContents.insertCSS(SETTLE_CSS, { cssOrigin: 'user' });
  return window;
}

// Closing the setup window must not end the run; the host exits explicitly when it is done.
app.on('window-all-closed', () => undefined);

async function run() {
  await app.whenReady();
  const answerer = mode === 'record' ? createRecorder(argv.bridge) : createReplayer(scenario.responses);
  for (const channel of channelsFromPreload()) {
    ipcMain.handle(channel, (_event, ...args) =>
      channel in DESKTOP_ANSWERS ? DESKTOP_ANSWERS[channel] : answerer.answer(channel, args),
    );
  }

  // Setup builds the state (connect a provider, send a turn) in a window whose calls are not kept.
  if (mode === 'record' && scenario.setup?.length) {
    const setupWindow = await openWindow(false);
    for (const step of scenario.setup) await runStep(setupWindow, step);
    setupWindow.destroy();
    for (const key of Object.keys(answerer.recorded)) delete answerer.recorded[key];
  }
  const window = await openWindow(mode === 'replay');
  for (const step of scenario.steps ?? []) await runStep(window, step);
  await new Promise((resolve) => setTimeout(resolve, scenario.settleMs ?? 800));
  await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');

  if (mode === 'record') {
    const { setup: _setup, ...definition } = scenario;
    fs.writeFileSync(argv.out, `${JSON.stringify({ ...definition, responses: answerer.recorded }, null, 1)}\n`);
    debug('recorded', scenario.id, Object.keys(answerer.recorded).length, 'channels');
    app.exit(0);
    return;
  }
  const fingerprint = await window.webContents.executeJavaScript(FINGERPRINT_SCRIPT);
  window.webContents.invalidate();
  await window.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const image = await window.webContents.capturePage();
  fs.mkdirSync(argv.out, { recursive: true });
  fs.writeFileSync(path.join(argv.out, `${scenario.id}.png`), image.toPNG());
  fs.writeFileSync(
    path.join(argv.out, `${scenario.id}.json`),
    `${JSON.stringify(
      {
        id: scenario.id,
        l1: createHash('sha256').update(fingerprint.join('\n')).digest('hex'),
        l2: createHash('sha256').update(image.toBitmap()).digest('hex'),
        size: image.getSize(),
        unanswered: [...answerer.unanswered].sort(),
        nodes: fingerprint,
      },
      null,
      1,
    )}\n`,
  );
  app.exit(0);
}

if (mode !== 'diff') {
  run().catch((error) => {
    console.error(`[visual-diff] ${scenario.id}: ${error instanceof Error ? error.stack : String(error)}`);
    app.exit(1);
  });
}
