import { test, expect } from '@playwright/test';
import path from 'path';
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
  const longWorkspaceRoot = path.join(
    ctx.tempDir,
    'rdc-agent-long-workspace',
    ...Array.from({ length: 18 }, (_, index) => `very-long-workspace-segment-${index}`),
  );

  await ctx.page.evaluate(async ({ workspaceRoot }) => {
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
        rootPath: workspaceRoot,
      },
      llm: {
        providers,
        agentRoutes,
      },
      configuration: {
        lastMigrationSummary: Array.from({ length: 8 }, (_, index) => `migration-${index}-completed`),
      },
    });
  }, { workspaceRoot: longWorkspaceRoot });

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
  await expect(page.locator('.settings-workspace-root-value')).toContainText('very-long-workspace-segment-17');
  await expect(page.locator('[data-testid="settings-modal"]')).toHaveScreenshot('settings-workspace.png', {
    mask: [
      page.locator('.settings-workspace-root-value'),
      page.locator('.settings-derived-path-value'),
    ],
  });

  await page.locator('[data-testid="settings-nav-agents"]').click();
  await expect(page.locator('[data-testid="settings-agent-list"]')).toBeVisible();
  await expect(page.locator('[data-testid="settings-agent-save"]')).toBeVisible();
  await expect(page.locator('.settings-agent-grid-header')).toBeVisible();
  const firstAgentCard = page.locator('[data-testid^="settings-agent-card-"]').first();
  await expect(firstAgentCard.locator('.settings-field-label')).toHaveCount(0);
  const agentRowLayout = await firstAgentCard.evaluate((element) => {
    const controls = Array.from(element.querySelectorAll('.settings-agent-route-control'));
    const head = element.querySelector('.settings-agent-card-head');
    const headBox = head?.getBoundingClientRect();
    const providerBox = controls[0]?.getBoundingClientRect();
    const modelBox = controls[1]?.getBoundingClientRect();

    return {
      controlCount: controls.length,
      providerY: providerBox?.y ?? 0,
      modelY: modelBox?.y ?? 99,
      headCenterY: headBox ? headBox.y + headBox.height / 2 : 0,
      providerCenterY: providerBox ? providerBox.y + providerBox.height / 2 : 99,
    };
  });
  expect(agentRowLayout.controlCount).toBe(2);
  expect(Math.abs(agentRowLayout.providerY - agentRowLayout.modelY)).toBeLessThanOrEqual(2);
  expect(Math.abs(agentRowLayout.headCenterY - agentRowLayout.providerCenterY)).toBeLessThanOrEqual(14);
  await expect(page.locator('[data-testid="settings-modal"]')).toHaveScreenshot('settings-agents.png');
});
