#!/usr/bin/env node
// Browser QA walkthrough: drives one disposable QA instance through the running states that matter for
// visual acceptance and saves one screenshot per state. It uses the real Settings UI to connect the
// deterministic Ollama stub, the real Composer to send each scenario, and checks that wheel scrolling moves
// the transcript through a long Work Process.
//
// Usage (each instance's bootstrap token is single-use):
//   node scripts/qa-ollama-stub.mjs &
//   RDC_AGENT_BROWSER_QA_FULL_ACCESS=1 TMPDIR=/dev/shm pnpm run start:agent-browser > <log> 2>&1 &
//   node scripts/qa-walkthrough.mjs <log> <shot-dir> [--capture <file.rdc>]
// Screenshots go to <shot-dir>, which should live outside the repository.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { closeOverlays, openApp, openSettings, scanSurfaceForbidden, useTheme } from './qa-browser-shared.mjs';

const args = process.argv.slice(2);
const [logPath, shotDir] = args;
if (!logPath || !shotDir) throw new Error('usage: qa-walkthrough.mjs <qa-log> <shot-dir> [--capture <file.rdc>]');
const capture = args.includes('--capture') ? args[args.indexOf('--capture') + 1] : null;
fs.mkdirSync(shotDir, { recursive: true });

const { browser, page } = await openApp(logPath);
const failures = [];
/** A real raster image for the Markdown media path: a dark-to-accent gradient, encoded as RGB PNG. */
function gradientPng(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([length, Buffer.from(type), data, crc]);
  };
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      rows[offset] = Math.round(20 + (x / width) * 40);
      rows[offset + 1] = Math.round(30 + (y / height) * 90);
      rows[offset + 2] = Math.round(60 + (x / width) * 160);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const startedAt = Date.now();
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotDir, `${name}.png`) });
  // The elapsed time lines a shot up with a recorded video (QA_VIDEO_DIR) for cutting motion clips.
  console.log(`[walkthrough] shot ${name} t=${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  // Pseudo-locale shots stretch copy on purpose; every other default screen must keep 诊断 facts off the surface.
  const forbidden = name.includes('pseudo') ? [] : await page.evaluate(scanSurfaceForbidden);
  if (forbidden.length) {
    failures.push(`surface:${name}`);
    for (const hit of forbidden) console.log(`[walkthrough] SURFACE ${name} ${hit}`);
  }
};
const step = async (name, action) => {
  try {
    await action();
  } catch (error) {
    failures.push(name);
    console.log(`[walkthrough] FAILED ${name}: ${String(error?.message ?? error).split('\n')[0]}`);
  }
};
const composer = () => page.locator('.composer-textarea').first();
const send = async (text) => {
  await closeOverlays(page);
  // A turn still settling (a plan execution, a background delegation) keeps the Composer busy.
  await page.getByTestId('debugger-start-button').waitFor({ timeout: 90_000 });
  await composer().click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
};
const waitForText = (text, timeout = 90_000) => page.getByText(text, { exact: false }).last().waitFor({ timeout });

const KNOWLEDGE_CASES = [
  ['qa-hair-darkening', 'Adreno 740 头发偏暗 / KajiyaDiffuse', '头发比参考静帧暗一档，只在 Adreno 740 上出现。'],
  ['qa-shadow-acne', '阴影贴图条纹 / 深度偏移过小', '地面出现斜向条纹，随相机距离变化。'],
];
const knowledgeCase = (caseId, title, symptom) => [
  `case_id: ${caseId}`, `title: ${title}`, 'meta:', '  status: fixed', '  severity: high',
  'environment:', '  platform: Android', '  api: Vulkan', '  gpu_vendor: Qualcomm',
  'symptoms:', `  visual: ${symptom}`,
  'root_cause:', '  phenomenon: 输出偏暗', '  first_bad_event: 着色阶段', '  responsible_layer: shader',
  'fix:', '  summary: 调整能量项并在同一 capture 上复核。',
  'verification_plan:', '  - 回放相同 pass 并与参考图对比',
].join('\n');

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-qa-project-'));
fs.mkdirSync(path.join(projectRoot, 'docs'));
fs.writeFileSync(path.join(projectRoot, 'docs', 'frame.png'), gradientPng(480, 270));
if (capture) fs.copyFileSync(capture, path.join(projectRoot, path.basename(capture)));

try {
  await step('home', () => shot('01-home-empty'));
  await step('knowledge', async () => {
    await page.getByTestId('sidebar-knowledge-center-trigger').click();
    await shot('02-knowledge');
    // Two pasted cases give the list and the reader real content to show.
    for (const [caseId, title, symptom] of KNOWLEDGE_CASES) {
      await page.getByTestId('knowledge-center-import-open').first().click();
      await page.getByRole('tab', { name: /粘贴|Paste/ }).click();
      await page.getByTestId('knowledge-center-import-source').fill(knowledgeCase(caseId, title, symptom));
      await page.getByTestId('knowledge-center-import-run').click();
      await page.getByTestId('knowledge-center-import-run').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => undefined);
      await closeOverlays(page, 1);
    }
    await page.locator('.knowledge-center-card-button').first().click();
    await page.getByTestId('knowledge-center-detail').waitFor({ timeout: 30_000 });
    await shot('02b-knowledge-cards');
    await closeOverlays(page);
  });

  await step('project', async () => {
    const result = await page.evaluate((root) => window.electronAPI.project.add(root), projectRoot);
    if (!result?.success) throw new Error(result?.error ?? 'project:add failed');
    await page.reload();
    await page.waitForURL(/\/app/);
    await page.waitForTimeout(1500);
  });

  await step('connect-ollama', async () => {
    await openSettings(page, 'models');
    await page.getByTestId('settings-provider-row-ollama').click();
    const detail = page.getByTestId('settings-provider-detail');
    await detail.getByRole('button', { name: /^(检查连接|Check connection)$/ }).click();
    await page.waitForTimeout(3000);
    await detail.getByRole('button', { name: /^(保存|连接|Save|Connect)$/ }).click();
    await page.waitForTimeout(2500);
    await shot('03-settings-models');
  });
  await step('settings-agents', async () => {
    await openSettings(page, 'agents');
    // Delegated Agents run on their own configured route, so the stub model becomes the default model.
    await page.getByTestId('settings-agent-default-model').getByTestId('settings-model-cascade-trigger').click();
    await page.locator('.settings-model-option[data-model-id="qa-stub:4b"]').first().click();
    await page.waitForTimeout(1500);
    await shot('04-settings-agents');
    await openSettings(page, 'tools');
    await shot('04d-settings-tools');
    await openSettings(page, 'hooks');
    await shot('04e-settings-hooks');
    await openSettings(page, 'general');
    await shot('04b-settings-general');
    await openSettings(page, 'appearance');
    await shot('04c-settings-appearance');
    await closeOverlays(page);
  });

  await step('select-model', async () => {
    await page.getByTestId('composer-model-effort-pill').click();
    await shot('05-effort-panel');
    await page.getByTestId('composer-model-effort-open-picker').click();
    await shot('06-model-picker');
    await page.locator('[data-testid^="composer-model-item-"]').first().click();
    await closeOverlays(page);
  });

  await step('loops', async () => {
    await send('qa:loops 列出工作区的文件，并整理结论。');
    await page.waitForTimeout(2600);
    await shot('07-turn-running');
    await waitForText('它验证流式推理');
    await page.waitForTimeout(1200);
    await shot('08-turn-settled');
  });
  await step('rail-tasks', async () => {
    await page.getByRole('tab', { name: /任务|进度|Tasks|Progress/ }).first().click();
    await shot('09-rail-tasks');
  });
  await step('context-usage', async () => {
    await page.getByTestId('composer-usage-indicator').click();
    await shot('10-context-usage');
    await closeOverlays(page);
  });

  await step('long', async () => {
    await send('qa:long 多轮核对工作区文件。');
    await waitForText('导入这个 capture 后');
    await page.waitForTimeout(1200);
    await shot('11-long-settled');
  });
  await step('scroll', async () => {
    const scroller = page.locator('.chat-messages').first();
    await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const box = await scroller.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const positions = [await scroller.evaluate((node) => node.scrollTop)];
    for (let index = 0; index < 8; index += 1) {
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(150);
      positions.push(await scroller.evaluate((node) => node.scrollTop));
    }
    const stuck = positions.slice(1).some((value, index) => value >= positions[index] && positions[index] > 0);
    console.log(`[walkthrough] wheel positions ${positions.map(Math.round).join(' → ')}`);
    if (stuck) throw new Error('wheel scrolling did not move the transcript upward');
  });

  await step('markdown', async () => {
    await send('qa:markdown 展示一份排版样例。');
    await waitForText('结论来自同一 capture');
    await page.waitForTimeout(1500);
    const answer = page.locator('[data-testid="message-bubble-assistant"]').last();
    await answer.locator('.markdown-body h1').first().scrollIntoViewIfNeeded();
    await shot('11b-markdown-top');
    await answer.locator('[data-testid="markdown-code-block"]').first().scrollIntoViewIfNeeded();
    await shot('11c-markdown-code');
    await answer.locator('.markdown-media, .markdown-media-missing').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await shot('11d-markdown-media');
  });

  await step('subagent', async () => {
    await send('qa:subagent 请让一个子代理核对工作区里有没有 capture。');
    const card = page.locator('[data-testid="work-process-subagent"]').last();
    await card.waitFor({ timeout: 90_000 });
    await page.waitForTimeout(1500);
    await card.scrollIntoViewIfNeeded();
    await shot('14b-subagent-running');
    await waitForText('Verifier 核对完了');
    await page.waitForTimeout(1200);
    // A settled turn folds its work process; open it once so the settled card is in view.
    if (!(await page.locator('[data-testid="work-process-subagent"]').last().isVisible())) {
      await page.locator('.work-process-header').last().click();
      await page.waitForTimeout(400);
    }
    await page.locator('.work-process-header').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot('14c-subagent-settled');
  });

  await step('plan', async () => {
    await page.getByTestId('composer-mode-pill').click();
    await page.getByRole('menuitemradio', { name: /Debugger/ }).or(page.getByRole('option', { name: /Debugger/ })).first().click();
    await send('qa:plan 定位这一帧唯一的 draw 调用。');
    await page.getByTestId('plan-review-request-panel').waitFor({ timeout: 90_000 });
    await page.waitForTimeout(800);
    await shot('12-plan-gate');
    await page.getByTestId('plan-card').last().click();
    await shot('13-plan-reader');
    await closeOverlays(page);
    await page.getByTestId('plan-review-request-panel').getByTestId('handoff-action-row').getByRole('button').first().click();
    await waitForText('它验证流式推理');
    await page.waitForTimeout(1200);
    await shot('14-plan-handoff');
  });

  await step('light', async () => {
    await useTheme(page, 'light');
    await shot('15-light-conversation');
    await openSettings(page, 'models');
    await shot('16-light-settings-models');
    await closeOverlays(page);
    await page.getByTestId('sidebar-knowledge-center-trigger').click();
    await shot('17-light-knowledge');
    await closeOverlays(page);
  });
  await step('english', async () => {
    await openSettings(page, 'general');
    await page.locator('.settings-page-general').getByRole('tab', { name: /^English$/ }).click();
    await page.waitForTimeout(800);
    await shot('19-en-settings-general');
    await closeOverlays(page);
    await shot('20-en-conversation');
    await page.getByTestId('sidebar-knowledge-center-trigger').click();
    await page.locator('.knowledge-center-card-button').first().click();
    await shot('21-en-knowledge');
    await closeOverlays(page);
    // Pseudo-localized English: accented and 40% longer, so an untranslated literal or a cramped layout shows.
    const pseudo = new URL(page.url());
    pseudo.searchParams.set('pseudoLocale', '1');
    await page.goto(pseudo.toString());
    await page.waitForTimeout(1500);
    await shot('22-pseudo-conversation');
    await openSettings(page, 'agents');
    await shot('23-pseudo-settings-agents');
    await closeOverlays(page);
    pseudo.searchParams.delete('pseudoLocale');
    await page.goto(pseudo.toString());
    await page.waitForTimeout(1500);
    await openSettings(page, 'general');
    await page.locator('.settings-page-general').getByRole('tab', { name: /^简体中文$/ }).click();
    await closeOverlays(page);
  });

  await step('command-palette', async () => {
    await useTheme(page, 'dark');
    await page.keyboard.press('Control+k');
    await page.getByTestId('command-palette').waitFor();
    await page.waitForTimeout(600);
    await shot('24-command-palette');
    await page.keyboard.press('Escape');
    await page.getByTestId('command-palette').waitFor({ state: 'detached' });
  });

  await step('narrow', async () => {
    await useTheme(page, 'dark');
    await page.setViewportSize({ width: 720, height: 900 });
    await page.waitForTimeout(500);
    await shot('18-narrow-conversation');
  });
} finally {
  await browser.close();
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

console.log(failures.length ? `[walkthrough] ${failures.length} step(s) failed: ${failures.join(', ')}` : '[walkthrough] OK');
process.exit(failures.length ? 1 : 0);
