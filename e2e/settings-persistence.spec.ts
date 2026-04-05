import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

const openSettings = async (ctx: AppContext): Promise<void> => {
  await ctx.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('settings:open');
  });
  await expect(ctx.page.locator('[data-testid="settings-modal"]')).toBeVisible();
};

const hasOverlap = async (ctx: AppContext): Promise<boolean> => ctx.page.evaluate(() => {
  const input = document.querySelector('[data-testid="settings-api-key-input"]');
  const toggle = document.querySelector('[data-testid="settings-api-key-toggle"]');
  if (!(input instanceof HTMLElement) || !(toggle instanceof HTMLElement)) {
    return true;
  }

  const inputRect = input.getBoundingClientRect();
  const toggleRect = toggle.getBoundingClientRect();
  return !(
    toggleRect.left >= inputRect.right
    || toggleRect.right <= inputRect.left
    || toggleRect.top >= inputRect.bottom
    || toggleRect.bottom <= inputRect.top
  );
});

test('新工作区首次打开模型页时默认无预置 Provider，新增条目显示为未命名 Provider', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const tempDir = ctx.tempDir;

  try {
    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1320, 760);
    });

    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      await window.electronAPI.settings.set({
        llm: {
          providers: [],
          agentRoutes: settings.llm.agentRoutes.map((route) => ({
            ...route,
            providerId: '',
            modelId: '',
          })),
        },
      });
    });

    await closeApp(ctx, { cleanup: false });
    ctx = await launchApp({ tempDir, cleanupOnClose: false });
    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1320, 760);
    });

    await openSettings(ctx);

    const providerList = ctx.page.locator('[data-testid="settings-provider-list"]');
    const providerLabels = providerList.locator('.settings-provider-item-label');
    const initialCount = await providerLabels.count();
    await expect(providerList).not.toContainText('OpenRouter');
    await expect(providerList).not.toContainText('MiniMax');
    await expect(providerList).not.toContainText('Z.ai');

    for (let index = 0; index < 3; index += 1) {
      await ctx.page.locator('[data-testid="settings-provider-add"]').click();
    }

    await expect(providerLabels).toHaveCount(initialCount + 3);
    const labels = await providerLabels.allTextContents();
    expect(labels.slice(-3)).toEqual([
      '未命名 Provider',
      '未命名 Provider',
      '未命名 Provider',
    ]);
  } finally {
    await closeApp(ctx, { cleanup: true });
  }
});

test('自定义 Provider 与模型路由在重启后保持，空标签显示为未命名 Provider，且 API Key 切换按钮不遮挡输入内容', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const tempDir = ctx.tempDir;

  try {
    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1320, 760);
    });

    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      const agentRoutes = settings.llm.agentRoutes.map((route) => (
        route.agentId === 'curator_agent'
          ? { ...route, providerId: 'provider-alpha', modelId: 'model-b' }
          : route
      ));

      await window.electronAPI.settings.set({
        llm: {
          providers: [
            {
              id: 'provider-alpha',
              kind: 'openai-compatible',
              label: 'Alpha',
              enabled: true,
              apiKey: 'persisted-alpha-key',
              baseUrl: 'https://example.com/v1',
              models: [
                { id: 'model-a', label: 'Model A', enabled: true },
                { id: 'model-b', label: 'Model B', enabled: true },
              ],
              recommendedModels: [],
              docsUrl: '',
              isConfigured: true,
            },
            {
              id: 'provider-empty-name',
              kind: 'openai-compatible',
              label: '',
              enabled: false,
              apiKey: '',
              baseUrl: '',
              models: [],
              recommendedModels: [],
              docsUrl: '',
              isConfigured: false,
            },
          ],
          agentRoutes,
        },
      });
    });

    await closeApp(ctx, { cleanup: false });

    ctx = await launchApp({ tempDir, cleanupOnClose: false });
    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1320, 760);
    });

    const persistedSettings = await ctx.page.evaluate(async () => window.electronAPI.settings.get());
    expect(persistedSettings.llm.providers).toHaveLength(2);

    const alphaProvider = persistedSettings.llm.providers.find((provider) => provider.id === 'provider-alpha');
    expect(alphaProvider?.label).toBe('Alpha');
    expect(alphaProvider?.apiKey).toBe('persisted-alpha-key');
    expect(alphaProvider?.models.map((model) => model.id)).toEqual(['model-a', 'model-b']);

    const unnamedProvider = persistedSettings.llm.providers.find((provider) => provider.id === 'provider-empty-name');
    expect(unnamedProvider?.label).toBe('');

    const curatorRoute = persistedSettings.llm.agentRoutes.find((route) => route.agentId === 'curator_agent');
    expect(curatorRoute).toMatchObject({
      providerId: 'provider-alpha',
      modelId: 'model-b',
    });

    await openSettings(ctx);
    await expect(ctx.page.locator('[data-testid="settings-provider-list"]')).toContainText('Alpha');
    await expect(ctx.page.locator('[data-testid="settings-provider-list"]')).toContainText('未命名 Provider');
    await expect(ctx.page.locator('[data-testid="settings-model-detail"]')).toContainText('Model A');
    await expect(ctx.page.locator('[data-testid="settings-model-detail"]')).toContainText('Model B');
    await expect(ctx.page.locator('[data-testid="settings-api-key-input"]')).toHaveValue('persisted-alpha-key');
    await expect.poll(async () => hasOverlap(ctx)).toBe(false);
  } finally {
    await closeApp(ctx, { cleanup: true });
  }
});

test('Agent 路由只展示可用 Provider，并只展示当前 Provider 下的启用模型', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const tempDir = ctx.tempDir;

  try {
    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1320, 760);
    });

    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      await window.electronAPI.settings.set({
        llm: {
          providers: [
            {
              id: 'provider-alpha',
              kind: 'openai-compatible',
              label: 'Alpha',
              enabled: true,
              apiKey: 'alpha-key',
              baseUrl: 'https://example.com/v1',
              models: [
                { id: 'alpha-enabled', label: 'Alpha Enabled', enabled: true },
                { id: 'alpha-disabled', label: 'Alpha Disabled', enabled: false },
                { id: 'alpha-second', label: 'Alpha Second', enabled: true },
              ],
              recommendedModels: [],
              docsUrl: '',
              isConfigured: true,
            },
            {
              id: 'provider-no-key',
              kind: 'openai-compatible',
              label: 'No Key',
              enabled: true,
              apiKey: '',
              baseUrl: 'https://example.com/v1',
              models: [{ id: 'beta-model', label: 'Beta Model', enabled: true }],
              recommendedModels: [],
              docsUrl: '',
              isConfigured: false,
            },
            {
              id: 'provider-no-models',
              kind: 'openai-compatible',
              label: 'No Models',
              enabled: true,
              apiKey: 'gamma-key',
              baseUrl: 'https://example.com/v1',
              models: [{ id: 'gamma-disabled', label: 'Gamma Disabled', enabled: false }],
              recommendedModels: [],
              docsUrl: '',
              isConfigured: true,
            },
          ],
          agentRoutes: settings.llm.agentRoutes,
        },
      });
    });

    await closeApp(ctx, { cleanup: false });
    ctx = await launchApp({ tempDir, cleanupOnClose: false });
    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1320, 760);
    });

    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-agents"]').click();

    const providerSelect = ctx.page.locator('[data-testid="settings-agent-provider-curator_agent"]');
    const providerOptions = await providerSelect.locator('option').allTextContents();
    expect(providerOptions).toEqual(['选择供应商', 'Alpha']);

    await providerSelect.selectOption('provider-alpha');

    const modelSelect = ctx.page.locator('[data-testid="settings-agent-model-curator_agent"]');
    const modelOptions = await modelSelect.locator('option').allTextContents();
    expect(modelOptions).toEqual(['Alpha Enabled', 'Alpha Second']);

    await expect(ctx.page.locator('[data-testid="settings-agent-card-curator_agent"]')).not.toContainText('Alpha Disabled');
    await expect(ctx.page.locator('[data-testid="settings-agent-save"]')).toBeDisabled();
  } finally {
    await closeApp(ctx, { cleanup: true });
  }
});
