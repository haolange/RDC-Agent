#!/usr/bin/env node
// Browser QA readability pass: visits a running disposable QA instance once and checks the main screens
// in both themes and at a narrow width for text below 12px, text contrast below WCAG AA and horizontal
// overflow. Usage: node scripts/qa-readability.mjs <file-holding-the-qa-bootstrap-url> [screenshot-dir]
// The bootstrap token is single-use: start a fresh instance (pnpm run start:agent-browser) per run.
// Playwright comes from the QA environment, not from this repository's dependencies; CI enforces the
// static half (typography roles only) through check:design-tokens.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');

const [urlSource, shotDir] = process.argv.slice(2);
if (!urlSource) throw new Error('usage: qa-readability.mjs <file-with-qa-bootstrap-url> [screenshot-dir]');
const bootstrapUrl = fs.readFileSync(urlSource, 'utf8').match(/https?:\/\/\S+qaBootstrap=\S+/)?.[0];
if (!bootstrapUrl) throw new Error('no QA bootstrap url found');
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

function inspectPage() {
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

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(bootstrapUrl);
await page.waitForURL(/\/app/, { timeout: 60_000 });
await page.waitForTimeout(2000);

let failures = 0;
const check = async (name) => {
  if (shotDir) await page.screenshot({ path: path.join(shotDir, `${name}.png`) });
  const report = await page.evaluate(inspectPage);
  const problems = report.small.length + report.lowContrast.length + (report.overflow ? 1 : 0);
  failures += problems;
  console.log(`[readability] ${name}: small=${report.small.length} contrast=${report.lowContrast.length} overflow=${report.overflow}`);
  for (const line of [...report.small, ...report.lowContrast].slice(0, 12)) console.log(`  - ${line}`);
};
const settings = async () => {
  await page.getByTestId('sidebar-user-settings-trigger').click();
  await page.getByTestId('open-settings-entry').click();
  await page.getByTestId('settings-nav-search').waitFor();
  await page.waitForTimeout(400);
};

// The app follows its own theme setting, so switch it in Settings › Appearance rather than emulating the OS.
const useTheme = async (theme) => {
  await settings();
  await page.getByRole('tab', { name: /外观|Appearance/ }).first().click();
  await page.getByTestId('settings-appearance-page').waitFor();
  await page.getByTestId('settings-appearance-page')
    .getByRole('tab', { name: theme === 'light' ? /^(浅色|Light)$/ : /^(深色|Dark)$/ }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
};

for (const theme of ['dark', 'light']) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useTheme(theme);
  await check(`${theme}-home`);
  await settings();
  await check(`${theme}-settings`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 720, height: 900 });
  await page.waitForTimeout(400);
  await check(`${theme}-home-narrow`);
}
await browser.close();
console.log(failures ? `[readability] ${failures} problem(s)` : '[readability] OK');
process.exit(failures ? 1 : 0);
