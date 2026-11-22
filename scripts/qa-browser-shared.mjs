// Shared Playwright helpers for the Browser QA scripts (qa-readability, qa-walkthrough). They enter a running
// disposable QA instance through its single-use bootstrap URL and drive the real product UI. Playwright comes
// from the QA environment, not from this repository's dependencies.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

/** The newest single-use bootstrap URL in a QA launcher log. The token is never printed. */
export function readBootstrapUrl(logPath) {
  const url = fs.readFileSync(logPath, 'utf8').match(/https?:\/\/\S+qaBootstrap=\S+/g)?.at(-1);
  if (!url) throw new Error(`no QA bootstrap url found in ${logPath}`);
  return url;
}

export async function openApp(logPath, viewport = { width: 1440, height: 900 }) {
  const browser = await chromium.launch();
  // QA_VIDEO_DIR records the whole run (for motion clips); without it nothing is written.
  const recordVideo = process.env.QA_VIDEO_DIR ? { recordVideo: { dir: process.env.QA_VIDEO_DIR, size: viewport } } : {};
  const page = await (await browser.newContext({ viewport, ...recordVideo })).newPage();
  page.setDefaultTimeout(8000);
  await page.goto(readBootstrapUrl(logPath));
  await page.waitForURL(/\/app/, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  return { browser, page };
}

/** Escape closes the topmost overlay per press; `layers` bounds how many to close. */
export async function closeOverlays(page, layers = 3) {
  for (let index = 0; index < layers; index += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
}

export async function openSettings(page, section) {
  await closeOverlays(page);
  await page.getByTestId('sidebar-user-settings-trigger').click();
  await page.getByTestId('open-settings-entry').click();
  await page.getByTestId('settings-nav-search').waitFor();
  if (section) await page.getByTestId(`settings-nav-${section}`).click();
  await page.waitForTimeout(300);
}

/**
 * Switches the app's own theme setting and proves it applied. Writing settings is a high-impact bridge
 * channel, so a QA instance started without RDC_AGENT_BROWSER_QA_FULL_ACCESS=1 rejects it; failing here
 * keeps a dark-only pass from being reported as a light-theme result.
 */
export async function useTheme(page, theme) {
  await openSettings(page, 'appearance');
  // The mode tabs, not the editor's light/dark switch below them.
  await page.getByTestId('settings-appearance-page').locator('.appearance-mode-tabs')
    .getByRole('tab', { name: theme === 'light' ? /^(浅色|Light)$/ : /^(深色|Dark)$/ }).click();
  await page.waitForFunction((expected) => document.documentElement.dataset.resolvedTheme === expected, theme, { timeout: 4000 })
    .catch(() => {
      throw new Error(`theme "${theme}" did not apply; start the QA instance with RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`);
    });
  await closeOverlays(page);
}

/** Runs in the page: visible text below 12px, contrast below WCAG AA, and horizontal overflow. */
export function inspectPage() {
  const parse = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const [r, g, b, a = 1] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const background = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color && color.a >= 0.95) return color;
    }
    return parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
  };
  const small = new Set();
  const lowContrast = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.trim();
    if (!text) continue;
    const element = walker.currentNode.parentElement;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (!rect.width || !rect.height || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    if (element.closest('[aria-hidden="true"], [disabled], .is-disabled')) continue;
    const size = parseFloat(style.fontSize);
    const label = `${element.className || element.tagName}: ${text.slice(0, 32)}`;
    if (size < 12) small.add(`${size}px ${label}`);
    const foreground = parse(style.color);
    if (!foreground || foreground.a < 0.5) continue;
    const bg = background(element);
    const [light, dark] = [luminance(foreground), luminance(bg)].sort((a, b) => b - a);
    const ratio = (light + 0.05) / (dark + 0.05);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) lowContrast.add(`${ratio.toFixed(2)} ${label}`);
  }
  const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  return { small: [...small], lowContrast: [...lowContrast], overflow };
}

/**
 * Runs in the page: technical traces that must never reach a product surface — internal addresses, hashes, HTTP
 * status codes, raw identifiers and enums, byte counts, receipt sentences and diagnostics disclosures. Content the
 * person or the model wrote, code, the raw receipt layer of a work card and the run log are not the surface.
 */
export function scanSurfaceForbidden() {
  const EXCLUDED = [
    '.markdown-body', '.message-bubble-user', 'textarea', 'input', 'code', 'pre', '.knowledge-center-markdown',
    '.runtime-terminal-drawer', '.work-process-tool-card-raw', '.work-process-subagent-raw', '.work-process-tool-card-expand',
  ].join(', ');
  const PATTERNS = [
    ['internal-address', /session:\/\//u],
    ['hash', /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/iu],
    ['http-status', /\bHTTP\s?[1-5]\d\d\b/u],
    ['raw-identifier', /\b[a-z]{2,}(?:_[a-z0-9]{2,})+\b/u],
    ['byte-count', /\b\d+(?:\.\d+)?\s?(?:B|KB|MB|GB|KiB|MiB|bytes)\b/u],
    ['diagnostics-disclosure', /^(诊断|诊断详情|技术详情|Diagnostics|Technical details)$/u],
    ['receipt-sentence', /已应用事件|Applied event|设备画面已同步|Device display synchronized|生效证据|Winning evidence/u],
  ];
  const hits = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.trim();
    if (!text) continue;
    const element = walker.currentNode.parentElement;
    if (!element || element.closest(EXCLUDED)) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden') continue;
    for (const [kind, pattern] of PATTERNS) if (pattern.test(text)) hits.add(`${kind}: ${text.slice(0, 60)}`);
  }
  return [...hits];
}
