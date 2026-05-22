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
    const providers = settings.llm.providers.map((provider, index) => ({
      ...provider,
      enabled: true,
      apiKey: `key-${index}`,
      models: Array.from({ length: index === 0 ? 28 : 2 }, (_, modelIndex) => ({
        id: `model-${index}-${modelIndex}`,
        label: `Model ${index}-${modelIndex}`,
        enabled: true,
      })),
      status: 'verified' as const,
      lastTestedAt: new Date().toISOString(),
      lastModelRefreshAt: new Date().toISOString(),
      isConfigured: true,
    }));

    const agentRoutes = settings.llm.agentRoutes.map((route) => ({
      ...route,
      providerId: providers[0]?.id ?? '',
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
  const backdropFilter = await page.locator('.settings-modal-backdrop').evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return styles.backdropFilter
      || (styles as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter
      || '';
  });
  expect(backdropFilter).not.toBe('none');
  expect(backdropFilter).toContain('blur(18px)');
  expect(backdropFilter).not.toContain('brightness');
  const backdropPaint = await page.locator('.settings-modal-backdrop').evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      backgroundColor: styles.backgroundColor,
      backgroundImage: styles.backgroundImage,
    };
  });
  expect(backdropPaint.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(backdropPaint.backgroundImage).toBe('none');

  await page.locator('[data-testid="settings-nav-models"]').click();
  await expect(page.locator('[data-testid="settings-oauth-accounts"]')).toBeVisible();
  await expect(page.locator('[data-testid="settings-connected-providers"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="settings-add-provider"]')).toBeVisible();
  await expect(page.locator('[data-testid="settings-provider-template-select"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="settings-add-provider"]')).not.toContainText('API Base URL');
  const providerLayout = await page.locator('[data-testid="settings-modal"]').evaluate((modal) => {
    const oauth = modal.querySelector('[data-testid="settings-oauth-accounts"]')?.getBoundingClientRect();
    const add = modal.querySelector('[data-testid="settings-add-provider"]')?.getBoundingClientRect();
    return {
      oauthTop: oauth?.top ?? 0,
      addTop: add?.top ?? 0,
      addWidth: add?.width ?? 0,
      addHeight: add?.height ?? 0,
    };
  });
  expect(providerLayout.addTop).toBeGreaterThan(providerLayout.oauthTop);
  expect(providerLayout.addWidth).toBeGreaterThan(520);
  expect(providerLayout.addHeight).toBeGreaterThan(120);

  await ctx.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(760, 720);
  });
  await page.waitForTimeout(300);
  await page.locator('[data-testid="settings-provider-connect-vertex"]').click();
  const providerDialog = page.locator('[data-testid="settings-provider-connect-dialog"]');
  await expect(providerDialog).toBeVisible();
  await expect(page.locator('[data-testid="settings-provider-environment-notice"]')).toBeVisible();
  const narrowProviderLayout = await providerDialog.evaluate((dialog) => {
    const dialogBox = dialog.getBoundingClientRect();
    const actions = Array.from(dialog.querySelectorAll('.settings-provider-connect-actions .button'))
      .map((button) => button.getBoundingClientRect());
    const sortedActions = [...actions].sort((left, right) => left.left - right.left);
    return {
      viewportWidth: window.innerWidth,
      left: dialogBox.left,
      right: dialogBox.right,
      width: dialogBox.width,
      actionCount: actions.length,
      actionsWrapCleanly: actions.every((rect) => rect.width >= 44 && rect.left >= dialogBox.left - 1 && rect.right <= dialogBox.right + 1),
      actionsDoNotOverlap: sortedActions.every((rect, index) => index === 0 || rect.left >= sortedActions[index - 1].right),
    };
  });
  expect(narrowProviderLayout.left).toBeGreaterThanOrEqual(0);
  expect(narrowProviderLayout.right).toBeLessThanOrEqual(narrowProviderLayout.viewportWidth);
  expect(narrowProviderLayout.width).toBeGreaterThan(320);
  expect(narrowProviderLayout.actionCount).toBe(3);
  expect(narrowProviderLayout.actionsWrapCleanly).toBe(true);
  expect(narrowProviderLayout.actionsDoNotOverlap).toBe(true);
  await page.locator('[data-testid="settings-provider-connect-dialog"] .settings-modal-close').click();
  await ctx.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1320, 720);
  });
  await page.waitForTimeout(300);

  await page.locator('[data-testid="settings-nav-workspace"]').click();
  await expect(page.locator('[data-testid="settings-workspace-body"]')).toBeVisible();
  await expect(page.locator('.settings-workspace-root-value')).toContainText('very-long-workspace-segment-17');
  const workspaceLayout = await page.locator('[data-testid="settings-modal"]').evaluate((modal) => {
    const root = modal.querySelector('.settings-workspace-root-value')?.getBoundingClientRect();
    const derived = modal.querySelector('.settings-derived-paths-card')?.getBoundingClientRect();
    return {
      rootHeight: root?.height ?? 0,
      derivedTop: derived?.top ?? 0,
      rootBottom: root?.bottom ?? 0,
    };
  });
  expect(workspaceLayout.rootHeight).toBeGreaterThan(30);
  expect(workspaceLayout.derivedTop).toBeGreaterThan(workspaceLayout.rootBottom);

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

  await page.locator('.settings-modal-backdrop').click({ position: { x: 4, y: 4 } });
  await expect(page.locator('[data-testid="settings-modal"]')).toBeHidden();
});
