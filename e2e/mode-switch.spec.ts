import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

test.beforeAll(async () => {
  ctx = await launchApp();
});

test.afterAll(async () => {
  await closeApp(ctx);
});

test('应用启动后默认显示 Debugger 页面', async () => {
  // 检查页面中存在 Debugger 相关元素
  const page = ctx.page;
  await expect(page.locator('text=Debugger').first()).toBeVisible({ timeout: 10000 });
});

test('切换到 Analyzer 模式', async () => {
  const page = ctx.page;
  await page.click('text=Analyzer');
  await expect(page.locator('text=Analyzer Mode')).toBeVisible({ timeout: 5000 });
});

test('切换到 Optimizer 模式', async () => {
  const page = ctx.page;
  await page.click('text=Optimizer');
  await expect(page.locator('text=Optimizer Mode')).toBeVisible({ timeout: 5000 });
});

test('切换回 Debugger 模式', async () => {
  const page = ctx.page;
  await page.click('text=Debugger');
  await expect(page.locator('text=Debugger').first()).toBeVisible({ timeout: 5000 });
});
