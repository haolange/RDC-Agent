import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('Debugger idle state keeps the unified prompt entry instead of a legacy Start button', async () => {
  const page = ctx.page;
  await expect(page.locator('button:has-text("Start")')).toHaveCount(0);
  await expect(page.locator('textarea.chat-input').first()).toBeVisible();
});

test('Replay Device stays in the main utility area while the left sidebar can fully disappear', async () => {
  const page = ctx.page;
  const userTrigger = page.locator('[data-testid="sidebar-user-settings-trigger"]');
  const deviceTrigger = page.locator('[data-testid="utility-device-selector-trigger"]');
  const leftToggle = page.locator('[data-testid="titlebar-left-panel-toggle"]');

  await expect(userTrigger).toBeVisible();
  await expect(deviceTrigger).toBeVisible();

  const [userBox, deviceBox] = await Promise.all([
    userTrigger.boundingBox(),
    deviceTrigger.boundingBox(),
  ]);

  expect(userBox).not.toBeNull();
  expect(deviceBox).not.toBeNull();
  expect((deviceBox?.x ?? 0)).toBeGreaterThan((userBox?.x ?? 0) + (userBox?.width ?? 0));

  await leftToggle.click();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveClass(/collapsed/);
  await expect(deviceTrigger).toBeVisible();
  await expect(userTrigger).toHaveCount(0);
});

test('Starting without selecting a project shows a clear assistant explanation instead of entering the plan flow', async () => {
  const page = ctx.page;
  await page.locator('textarea.chat-input').first().fill('你好');
  await page.locator('button.chat-send-button').first().click();
  await expect(page.locator('[data-testid="chat-messages"]')).toContainText('你好');
  await expect(page.locator('[data-testid="plan-intake-panel"]')).toHaveCount(0);
});

test('Expressing debug intent without a selected project still yields a natural boundary explanation first', async () => {
  const page = ctx.page;
  await page.locator('textarea.chat-input').first().fill('请开始一次调试');
  await page.locator('button.chat-send-button').first().click();
  await expect(page.locator('[data-testid="chat-messages"]')).toContainText('项目');
  await expect(page.locator('[data-testid="plan-intake-panel"]')).toHaveCount(0);
});
