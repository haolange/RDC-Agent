import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

test.beforeAll(async () => {
  ctx = await launchApp();
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow.setSize(1320, 720);
  });
  await ctx.page.waitForTimeout(300);
});

test.afterAll(async () => {
  await closeApp(ctx, { cleanup: true });
});

test('设置弹窗中的 Workspace、Model 与 Agent 面板保持可访问的滚动布局', async () => {
  await ctx.page.evaluate(async () => {
    const settings = await window.electronAPI.settings.get();
    const providers = Array.from({ length: 24 }, (_, index) => ({
      id: `custom.scroll-${index}`,
      kind: 'openai-compatible' as const,
      label: `Provider ${index}`,
      enabled: true,
      apiKey: `key-${index}`,
      baseUrl: `https://scroll-${index}.local/v1`,
      models: Array.from({ length: index === 0 ? 28 : 2 }, (_, modelIndex) => ({
        id: `model-${index}-${modelIndex}`,
        label: `Model ${index}-${modelIndex}`,
        enabled: true,
      })),
      recommendedModels: index === 0
        ? Array.from({ length: 24 }, (_, modelIndex) => `recommended-model-${modelIndex}`)
        : [],
      docsUrl: '',
      isConfigured: true,
    }));

    const agentRoutes = settings.llm.agentRoutes.map((route) => ({
      ...route,
      providerId: 'custom.scroll-0',
      modelId: 'model-0-0',
    }));

    await window.electronAPI.settings.set({
      workspace: {
        rootPath: [
          'D:',
          'RDC-Agent',
          ...Array.from({ length: 18 }, (_, index) => `very-long-workspace-segment-${index}`),
        ].join('\\'),
      },
      llm: {
        providers,
        agentRoutes,
      },
      configuration: {
        lastMigrationSummary: Array.from({ length: 8 }, (_, index) => `migration-${index}-completed`),
      },
    });
  });

  const tempDir = ctx.tempDir;
  await closeApp(ctx, { cleanup: false });
  ctx = await launchApp({ tempDir, cleanupOnClose: false });
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow.setSize(1320, 720);
  });
  await ctx.page.waitForTimeout(300);

  const page = ctx.page;

  await ctx.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('settings:open');
  });

  await expect(page.locator('[data-testid="settings-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="settings-center-panel"]')).toBeVisible();

  await page.locator('[data-testid="settings-nav-models"]').click();
  await expect(page.locator('[data-testid="settings-provider-list"]')).toBeVisible();
  await expect(page.locator('[data-testid="settings-model-detail"]')).toBeVisible();
  await expect(page.locator('[data-testid="settings-modal"]')).toHaveScreenshot('settings-models.png');

  await page.locator('[data-testid="settings-nav-workspace"]').click();
  await expect(page.locator('[data-testid="settings-workspace-body"]')).toBeVisible();
  await expect(page.locator('[data-testid="settings-modal"]')).toHaveScreenshot('settings-workspace.png');

  await page.locator('[data-testid="settings-nav-agents"]').click();
  await expect(page.locator('[data-testid="settings-agent-list"]')).toBeVisible();
  await expect(page.locator('[data-testid="settings-agent-save"]')).toBeVisible();
  await expect(page.locator('[data-testid="settings-modal"]')).toHaveScreenshot('settings-agents.png');
});
