import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('Debugger 空闲态没有旧 Start 按钮，而是统一输入条入口', async () => {
  const page = ctx.page;
  await expect(page.locator('button:has-text("Start")')).toHaveCount(0);
await expect(page.locator('textarea.chat-input').first()).toBeVisible();
});

test('左侧栏展开时在用户卡片下显示 Replay Device，收起后保留紧凑入口', async () => {
  const page = ctx.page;
  const userTrigger = page.locator('[data-testid="sidebar-user-settings-trigger"]');
  const deviceTrigger = page.locator('[data-testid="sidebar-device-selector-trigger"]');
  const leftToggle = page.locator('[data-testid="titlebar-left-panel-toggle"]');

  await expect(userTrigger).toBeVisible();
  await expect(deviceTrigger).toBeVisible();

  const [userBox, deviceBox] = await Promise.all([
    userTrigger.boundingBox(),
    deviceTrigger.boundingBox(),
  ]);

  expect(userBox).not.toBeNull();
  expect(deviceBox).not.toBeNull();
  expect(Math.abs((userBox?.width ?? 0) - (deviceBox?.width ?? 0))).toBeLessThanOrEqual(1);
  expect((deviceBox?.y ?? 0)).toBeGreaterThan((userBox?.y ?? 0) + (userBox?.height ?? 0) - 1);

  await leftToggle.click();
  await expect(deviceTrigger).toBeVisible();
  await expect(userTrigger).toBeVisible();

  const [collapsedUserBox, collapsedDeviceBox] = await Promise.all([
    userTrigger.boundingBox(),
    deviceTrigger.boundingBox(),
  ]);

  expect(collapsedUserBox?.width ?? 0).toBeGreaterThanOrEqual(43);
  expect(collapsedDeviceBox?.width ?? 0).toBeGreaterThanOrEqual(43);
  expect(Math.abs((collapsedUserBox?.width ?? 0) - (collapsedDeviceBox?.width ?? 0))).toBeLessThanOrEqual(2);
});

test('未选择项目时尝试启动会得到明确提示', async () => {
  const page = ctx.page;
await page.locator('textarea.chat-input').first().fill('你好');
  await page.locator('button.chat-send-button').first().click();
  await expect(page.locator('[data-testid="chat-messages"]')).toContainText('你好，我是 RDC Debugger');
  await expect(page.locator('[data-testid="plan-intake-panel"]')).toHaveCount(0);
});

test('未选择项目时表达调试意图，会先得到自然语言边界说明而不是直接进流程', async () => {
  const page = ctx.page;
await page.locator('textarea.chat-input').first().fill('请开始一次调试');
  await page.locator('button.chat-send-button').first().click();
  await expect(page.locator('[data-testid="chat-messages"]')).toContainText('正式调试要先选一个项目');
  await expect(page.locator('[data-testid="plan-intake-panel"]')).toHaveCount(0);
});
