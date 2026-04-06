import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('应用启动后显示三模式入口，默认选中 Debugger', async () => {
  const page = ctx.page;
  await expect(page.getByRole('tab', { name: 'Debugger' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('tab', { name: 'Analyzer' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Optimizer' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Debugger' })).toHaveAttribute('aria-selected', 'true');
});

test('空闲壳层仍保留 Debugger 启动输入条', async () => {
  const page = ctx.page;
  const promptInput = page.locator('input.chat-input').first();
  await expect(promptInput).toBeVisible();
  await expect(promptInput).toHaveValue('');
});

test('切换到 Analyzer 和 Optimizer 时只显示独立空白占位页', async () => {
  const page = ctx.page;

  await page.getByRole('tab', { name: 'Analyzer' }).click();
  await expect(page.locator('[data-testid="analyzer-placeholder-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveCount(0);
  await expect(page.locator('input.chat-input')).toHaveCount(0);
  await expect(page.locator('[data-testid="app-sidebar-right"]')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Optimizer' }).click();
  await expect(page.locator('[data-testid="optimizer-placeholder-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveCount(0);
  await expect(page.locator('input.chat-input')).toHaveCount(0);
  await expect(page.locator('[data-testid="app-sidebar-right"]')).toHaveCount(0);
});
