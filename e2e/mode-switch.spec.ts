import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('应用启动后默认显示 Debugger 壳层且只保留单一模式入口', async () => {
  const page = ctx.page;
  await expect(page.locator('text=Debugger').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('text=Analyzer')).toHaveCount(0);
  await expect(page.locator('text=Optimizer')).toHaveCount(0);
});

test('空闲壳层仍保留 Debugger 启动输入条', async () => {
  const page = ctx.page;
  const promptInput = page.locator('input.chat-input').first();
  await expect(promptInput).toBeVisible();
  await expect(promptInput).toHaveValue('');
});
