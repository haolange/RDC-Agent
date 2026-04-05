import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

const getScrollTop = async (selector: string, page: AppContext['page']) =>
  page.locator(selector).evaluate((element) => element.scrollTop);

const isChildWithinContainer = async (
  containerSelector: string,
  childSelector: string,
  page: AppContext['page'],
) => page.evaluate(({ containerSelector, childSelector }) => {
  const container = document.querySelector(containerSelector);
  const child = document.querySelector(childSelector);
  if (!(container instanceof HTMLElement) || !(child instanceof HTMLElement)) {
    return false;
  }
  const containerRect = container.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  return childRect.top >= containerRect.top && childRect.bottom <= containerRect.bottom;
}, { containerSelector, childSelector });

test.beforeAll(async () => {
  ctx = await launchApp();
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow.setSize(1320, 760);
  });
  await ctx.page.waitForTimeout(300);
});

test.afterAll(async () => {
  await closeApp(ctx, { cleanup: true });
});

test('设置弹窗支持模型页与 Agent 页滚轮滚动', async () => {
  await ctx.page.evaluate(async () => {
    const settings = await window.electronAPI.settings.get();
    const providers = Array.from({ length: 10 }, (_, index) => ({
      id: `provider-${index}`,
      kind: 'openai-compatible' as const,
      label: `Provider ${index}`,
      enabled: true,
      apiKey: `key-${index}`,
      baseUrl: 'https://example.com/v1',
      models: [
        { id: `model-${index}-a`, label: `Model ${index}A`, enabled: true },
        { id: `model-${index}-b`, label: `Model ${index}B`, enabled: true },
      ],
      recommendedModels: [],
      docsUrl: '',
      isConfigured: true,
    }));

    const agentRoutes = settings.llm.agentRoutes.map((route) => ({
      ...route,
      providerId: 'provider-0',
      modelId: 'model-0-a',
    }));

    await window.electronAPI.settings.set({
      llm: {
        providers,
        agentRoutes,
      },
    });
  });

  const tempDir = ctx.tempDir;
  await closeApp(ctx, { cleanup: false });
  ctx = await launchApp({ tempDir, cleanupOnClose: false });
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow.setSize(1320, 760);
  });
  await ctx.page.waitForTimeout(300);

  const page = ctx.page;

  await ctx.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('settings:open');
  });
  await expect(page.locator('[data-testid="settings-modal"]')).toBeVisible();

  const providerList = page.locator('[data-testid="settings-provider-list"]');
  const modelDetail = page.locator('[data-testid="settings-model-detail"]');

  await providerList.hover();
  const providerScrollBefore = await getScrollTop('[data-testid="settings-provider-list"]', page);
  await page.mouse.wheel(0, 720);
  await expect.poll(async () => getScrollTop('[data-testid="settings-provider-list"]', page)).toBeGreaterThan(providerScrollBefore);

  await modelDetail.evaluate((element) => {
    element.scrollTop = 0;
  });
  await modelDetail.hover();
  await page.mouse.wheel(0, 1200);
  await expect.poll(async () => getScrollTop('[data-testid="settings-model-detail"]', page)).toBeGreaterThan(0);
  await expect.poll(async () => isChildWithinContainer(
    '[data-testid="settings-model-detail"]',
    '[data-testid="settings-provider-save"]',
    page,
  )).toBe(true);

  await page.locator('[data-testid="settings-nav-agents"]').click();
  const agentList = page.locator('[data-testid="settings-agent-list"]');

  await agentList.hover();
  const agentScrollBefore = await getScrollTop('[data-testid="settings-agent-list"]', page);
  await page.mouse.wheel(0, 1200);
  await expect.poll(async () => getScrollTop('[data-testid="settings-agent-list"]', page)).toBeGreaterThan(agentScrollBefore);
  await expect(page.locator('[data-testid="settings-agent-save"]')).toBeVisible();
});
