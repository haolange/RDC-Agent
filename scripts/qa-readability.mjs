#!/usr/bin/env node
// Browser QA readability pass: visits a running disposable QA instance once and checks the main screens
// in both themes and at a narrow width for text below 12px, text contrast below WCAG AA and horizontal
// overflow. Usage: node scripts/qa-readability.mjs <file-holding-the-qa-bootstrap-url> [screenshot-dir]
// Start a fresh instance per run (the bootstrap token is single-use) with RDC_AGENT_BROWSER_QA_FULL_ACCESS=1,
// since switching the theme writes settings. CI enforces the static half (typography roles only) through
// check:design-tokens.
import fs from 'node:fs';
import path from 'node:path';
import { inspectPage, openApp, openSettings, closeOverlays, useTheme } from './qa-browser-shared.mjs';

const [logPath, shotDir] = process.argv.slice(2);
if (!logPath) throw new Error('usage: qa-readability.mjs <file-with-qa-bootstrap-url> [screenshot-dir]');
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const { browser, page } = await openApp(logPath);
let failures = 0;
const check = async (name) => {
  if (shotDir) await page.screenshot({ path: path.join(shotDir, `${name}.png`) });
  const report = await page.evaluate(inspectPage);
  const problems = report.small.length + report.lowContrast.length + (report.overflow ? 1 : 0);
  failures += problems;
  console.log(
    `[readability] ${name}: small=${report.small.length} contrast=${report.lowContrast.length} overflow=${report.overflow}`,
  );
  for (const line of [...report.small, ...report.lowContrast].slice(0, 12)) console.log(`  - ${line}`);
};

for (const theme of ['dark', 'light']) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useTheme(page, theme);
  await check(`${theme}-home`);
  await openSettings(page);
  await check(`${theme}-settings`);
  await closeOverlays(page);
  await page.setViewportSize({ width: 720, height: 900 });
  await page.waitForTimeout(400);
  await check(`${theme}-home-narrow`);
}
await browser.close();
console.log(failures ? `[readability] ${failures} problem(s)` : '[readability] OK');
process.exit(failures ? 1 : 0);
