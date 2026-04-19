import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

const openSettings = async (ctx: AppContext): Promise<void> => {
  await ctx.page.locator('[data-testid="sidebar-user-settings-trigger"]').click();
  await ctx.page.locator('[data-testid="open-settings-entry"]').click();
  await expect(ctx.page.locator('[data-testid="settings-modal"]')).toBeVisible();
};

const readDropdownOptionLabels = async (ctx: AppContext, testId: string): Promise<string[]> => {
  const trigger = ctx.page.locator(`[data-testid="${testId}"]`).first();
  await trigger.click();
  const menu = ctx.page.locator(`[data-testid="${testId}-menu"]`).first();
  await expect(menu).toBeVisible();
  const labels = await menu.locator('.dropdown-select-option-label').allTextContents();
  await trigger.click();
  await expect(menu).toBeHidden();
  return labels;
};

const openDropdownMenu = async (ctx: AppContext, testId: string) => {
  const trigger = ctx.page.locator(`[data-testid="${testId}"]`).first();
  await trigger.click();
  const menu = ctx.page.locator(`[data-testid="${testId}-menu"]`).first();
  await expect(menu).toBeVisible();
  return { trigger, menu };
};

test('模型页展示内置 Provider 模板源，默认不自动注入已保存 provider', async () => {
  const ctx = await launchApp();

  try {
    await openSettings(ctx);
    const providerList = ctx.page.locator('[data-testid="settings-provider-list"]');
    await expect(providerList).not.toContainText('OpenRouter');
    await expect(providerList).not.toContainText('OpenAI');
    const templateOptions = await readDropdownOptionLabels(ctx, 'settings-provider-template-select');
    expect(templateOptions).toContain('OpenRouter');
    expect(templateOptions).toContain('OpenAI');
    await ctx.page.locator('[data-testid="settings-nav-workspace"]').click();
    await expect(ctx.page.locator('text=Profiles').first()).toBeVisible();
    await expect(ctx.page.locator('text=Policies').first()).toBeVisible();
  } finally {
    await closeApp(ctx);
  }
});

test('Settings 下拉菜单展开后可见且可点击', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const tempDir = ctx.tempDir;

  try {
    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();

      await window.electronAPI.settings.set({
        llm: {
          providers: [
            {
              id: 'openrouter',
              kind: 'openrouter',
              label: 'OpenRouter',
              enabled: true,
              apiKey: 'sk-or-test-1234567890',
              secretRef: 'provider-openrouter-api-key',
              hasStoredSecret: false,
              baseUrl: 'https://openrouter.ai/api/v1',
              models: [
                { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', enabled: true },
                { id: 'openai/gpt-5.2', label: 'GPT-5.2', enabled: true },
              ],
              recommendedModels: [],
              docsUrl: 'https://openrouter.ai/keys',
              isConfigured: true,
            },
            {
              id: 'sirius',
              kind: 'openai-compatible',
              label: 'Sirius',
              enabled: true,
              apiKey: 'sirius-secret-123456',
              secretRef: 'provider-sirius-api-key',
              hasStoredSecret: false,
              baseUrl: 'https://api.sirius.dev/v1',
              models: [{ id: 'sirius-model', label: 'Sirius Model', enabled: true }],
              recommendedModels: [],
              docsUrl: '',
              isConfigured: true,
            },
          ],
          agentRoutes: settings.llm.agentRoutes.map((route) => ({
            ...route,
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4.5',
          })),
        },
      });
    });

    await closeApp(ctx, { cleanup: false });
    ctx = await launchApp({ tempDir, cleanupOnClose: false });

    await ctx.app.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      mainWindow.setSize(1360, 820);
    });
    await ctx.page.waitForTimeout(300);

    await openSettings(ctx);

    const providerTemplateDropdown = await openDropdownMenu(ctx, 'settings-provider-template-select');
    await expect(providerTemplateDropdown.menu).toHaveScreenshot('settings-provider-template-menu.png');
    await providerTemplateDropdown.menu.locator('[data-testid="settings-provider-template-select-option-openai"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-template-select"]')).toContainText('OpenAI');

    await ctx.page.locator('[data-testid="settings-provider-item-sirius"]').click();
    const providerKindDropdown = await openDropdownMenu(ctx, 'settings-provider-kind');
    await expect(providerKindDropdown.menu).toHaveScreenshot('settings-provider-kind-menu.png');
    await providerKindDropdown.menu.locator('[data-testid="settings-provider-kind-option-anthropic"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-kind"]')).toContainText('anthropic');

    await ctx.page.locator('[data-testid="settings-nav-agents"]').click();
    const providerDropdown = await openDropdownMenu(ctx, 'settings-agent-provider-curator_agent');
    await expect(providerDropdown.menu).toHaveScreenshot('settings-agent-provider-menu.png', { maxDiffPixels: 80 });
    await providerDropdown.menu.locator('[data-testid="settings-agent-provider-curator_agent-option-sirius"]').click();
    await expect(ctx.page.locator('[data-testid="settings-agent-provider-curator_agent"]')).toContainText('Sirius');

    const modelDropdown = await openDropdownMenu(ctx, 'settings-agent-model-curator_agent');
    await expect(modelDropdown.menu).toHaveScreenshot('settings-agent-model-menu.png');
    await modelDropdown.menu.locator('[data-testid="settings-agent-model-curator_agent-option-sirius-model"]').click();
    await expect(ctx.page.locator('[data-testid="settings-agent-model-curator_agent"]')).toContainText('Sirius Model');
  } finally {
    await closeApp(ctx, { cleanup: true });
  }
});

test('Models 已配置态在长字段场景下保持稳定布局', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const tempDir = ctx.tempDir;

  try {
    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();

      await window.electronAPI.settings.set({
        llm: {
          providers: [
            {
              id: 'openrouter',
              kind: 'openrouter',
              label: 'Open Router Enterprise Routing Workspace Alpha',
              enabled: true,
              apiKey: 'sk-or-v1-f291e84aebc1c0c8b5db6b44de8074cefeba3444053740821019283746501',
              secretRef: 'provider-openrouter-api-key',
              hasStoredSecret: false,
              baseUrl: 'https://openrouter.ai/api/v1/enterprise/control-plane/with/a/very/long/path/segment',
              models: [
                {
                  id: 'moonshotai/kimi-k2.5-enterprise-preview-with-very-long-suffix',
                  label: 'moonshotai/kimi-k2.5-enterprise-preview-with-very-long-suffix',
                  enabled: true,
                },
                {
                  id: 'anthropic/claude-sonnet-4.5-long-context-enterprise',
                  label: 'anthropic/claude-sonnet-4.5-long-context-enterprise',
                  enabled: true,
                },
              ],
              recommendedModels: [
                'openai/gpt-5.2',
                'google/gemini-2.5-pro',
              ],
              docsUrl: 'https://openrouter.ai/keys',
              isConfigured: false,
            },
          ],
          agentRoutes: settings.llm.agentRoutes,
        },
      });
    });

    await closeApp(ctx, { cleanup: false });
    ctx = await launchApp({ tempDir, cleanupOnClose: false });

    await ctx.app.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      mainWindow.setSize(1360, 820);
    });
    await ctx.page.waitForTimeout(300);

    await openSettings(ctx);

    const modal = ctx.page.locator('[data-testid="settings-modal"]');
    const detail = ctx.page.locator('[data-testid="settings-model-detail"]');
    const detailBody = ctx.page.locator('[data-testid="settings-model-detail-body"]');

    await expect(ctx.page.locator('[data-testid="settings-provider-savebar"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-api-key-input"]')).toHaveAttribute('type', 'password');
    await expect(modal).toHaveScreenshot('settings-models-configured-provider.png');
    await detailBody.evaluate((node) => {
      node.scrollTop = 420;
    });
    await ctx.page.waitForTimeout(150);
    await expect(detail).toHaveScreenshot('settings-models-configured-detail.png');

    await ctx.page.locator('[data-testid="settings-api-key-toggle"]').click();
    await expect(ctx.page.locator('[data-testid="settings-api-key-input"]')).toHaveAttribute('type', 'text');
    await expect(detail).toHaveScreenshot('settings-models-configured-detail-revealed.png');
  } finally {
    await closeApp(ctx, { cleanup: true });
  }
});

test('自定义 Provider 会持久化，API key 不再明文出现在 settings.get 中', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const tempDir = ctx.tempDir;

  try {
    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      await window.electronAPI.settings.set({
        llm: {
          providers: [
            ...settings.llm.providers,
            {
              id: 'sirius',
              kind: 'openai-compatible',
              label: 'Sirius',
              enabled: true,
              apiKey: 'sirius-secret-123456',
              secretRef: 'provider-sirius-api-key',
              hasStoredSecret: false,
              baseUrl: 'https://api.sirius.dev/v1',
              models: [{ id: 'sirius-model', label: 'Sirius Model', enabled: true }],
              recommendedModels: [],
              docsUrl: '',
              isConfigured: false,
            },
          ],
        },
      });
    });

    await closeApp(ctx, { cleanup: false });
    ctx = await launchApp({ tempDir, cleanupOnClose: false });

    const persistedSettings = await ctx.page.evaluate(async () => window.electronAPI.settings.get());
    const vendorProvider = persistedSettings.llm.providers.find((provider) => provider.id === 'sirius');
    expect(vendorProvider).toBeTruthy();
    expect(vendorProvider?.apiKey).toBe('');
    expect(vendorProvider?.hasStoredSecret).toBe(true);
    expect(persistedSettings.llm.providers).toHaveLength(1);

    await openSettings(ctx);
    await expect(ctx.page.locator('[data-testid="settings-provider-list"]')).toContainText('Sirius');
    await ctx.page.locator('[data-testid="settings-provider-item-sirius"]').click();
    await expect(ctx.page.locator('[data-testid="settings-model-detail"]')).toContainText('已存储');
    await expect(ctx.page.locator('[data-testid="settings-model-detail"]')).not.toContainText('sirius-secret-123456');
    await expect(ctx.page.locator('[data-testid="settings-api-key-input"]')).toHaveValue('sirius-secret-123456');
    await expect(ctx.page.locator('[data-testid="settings-api-key-input"]')).toHaveAttribute('type', 'password');
    await expect(ctx.page.locator('[data-testid="settings-provider-auth-status"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-provider-clear-secret"]')).toBeVisible();
    await ctx.page.locator('[data-testid="settings-api-key-toggle"]').click();
    await expect(ctx.page.locator('[data-testid="settings-api-key-input"]')).toHaveAttribute('type', 'text');
  } finally {
    await closeApp(ctx, { cleanup: true });
  }
});

test('点击 Provider 行会直接切换详情', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const tempDir = ctx.tempDir;

  try {
    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();

      await window.electronAPI.settings.set({
        llm: {
          providers: [
            {
              id: 'alpha',
              kind: 'openai-compatible',
              label: 'Alpha',
              enabled: true,
              apiKey: 'alpha-secret-123',
              secretRef: 'provider-alpha-api-key',
              hasStoredSecret: false,
              baseUrl: 'https://alpha.local/v1',
              models: [{ id: 'alpha-model', label: 'Alpha Model', enabled: true }],
              recommendedModels: [],
              docsUrl: '',
              isConfigured: true,
            },
            {
              id: 'beta',
              kind: 'openai-compatible',
              label: 'Beta',
              enabled: true,
              apiKey: 'beta-secret-123',
              secretRef: 'provider-beta-api-key',
              hasStoredSecret: false,
              baseUrl: 'https://beta.local/v1',
              models: [{ id: 'beta-model', label: 'Beta Model', enabled: true }],
              recommendedModels: [],
              docsUrl: '',
              isConfigured: true,
            },
          ],
        },
      });
    });

    await closeApp(ctx, { cleanup: false });
    ctx = await launchApp({ tempDir, cleanupOnClose: false });

    await openSettings(ctx);

    const modelDetail = ctx.page.locator('[data-testid="settings-model-detail"]');
    await expect(modelDetail).toContainText('Alpha');
    await expect(modelDetail).not.toContainText('Beta Model');

    await ctx.page.locator('[data-testid="settings-provider-item-beta"]').click();
    await expect(modelDetail).toContainText('Beta');
    await expect(modelDetail).toContainText('Beta Model');
  } finally {
    await closeApp(ctx, { cleanup: true });
  }
});

test('Agent 路由只展示当前可用 Provider 与启用模型', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const tempDir = ctx.tempDir;

  try {
    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();

      await window.electronAPI.settings.set({
        llm: {
          providers: [
            {
              id: 'openrouter',
              kind: 'openrouter',
              label: 'OpenRouter',
              enabled: true,
              apiKey: 'sk-or-test-1234567890',
              secretRef: 'provider-openrouter-api-key',
              hasStoredSecret: false,
              baseUrl: 'https://openrouter.ai/api/v1',
              models: [
                { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', enabled: true },
                { id: 'openai/gpt-5.2', label: 'GPT-5.2', enabled: false },
              ],
              recommendedModels: [],
              docsUrl: 'https://openrouter.ai/keys',
              isConfigured: false,
            },
          ],
          agentRoutes: settings.llm.agentRoutes.map((route) => (
            route.agentId === 'curator_agent'
              ? { ...route, providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4.5' }
              : route
          )),
        },
      });
    });

    await closeApp(ctx, { cleanup: false });
    ctx = await launchApp({ tempDir, cleanupOnClose: false });

    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-agents"]').click();

    const providerOptions = await readDropdownOptionLabels(ctx, 'settings-agent-provider-curator_agent');
    expect(providerOptions).toContain('OpenRouter');

    const modelOptions = await readDropdownOptionLabels(ctx, 'settings-agent-model-curator_agent');
    expect(modelOptions).toContain('Claude Sonnet 4.5');
    expect(modelOptions).not.toContain('GPT-5.2');
  } finally {
    await closeApp(ctx, { cleanup: true });
  }
});

test('通用设置修改后停留在当前面板，不跳回模型页', async () => {
  const ctx = await launchApp();

  try {
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-general"]').click();
    await expect(ctx.page.locator('[data-testid="settings-nav-general"]')).toHaveClass(/active/);

    await ctx.page.getByRole('button', { name: /浅色|Light/, exact: false }).click();

    await expect(ctx.page.locator('[data-testid="settings-nav-general"]')).toHaveClass(/active/);
    await expect(ctx.page.locator('[data-testid="settings-nav-models"]')).not.toHaveClass(/active/);
    await expect(ctx.page.locator('[data-testid="settings-model-detail"]')).toHaveCount(0);

    await ctx.page.getByRole('button', { name: /English|简体中文/, exact: false }).nth(1).click();

    await expect(ctx.page.locator('[data-testid="settings-nav-general"]')).toHaveClass(/active/);
    await expect(ctx.page.locator('[data-testid="settings-nav-models"]')).not.toHaveClass(/active/);
  } finally {
    await closeApp(ctx);
  }
});

test('Account、Workspace、Models 写回设置后都停留在当前面板', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const tempDir = ctx.tempDir;

  try {
    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();

      await window.electronAPI.settings.set({
        profile: {
          nickname: settings.profile.nickname || 'RDC Operator',
        },
        workspace: {
          rootPath: settings.workspace.rootPath || settings.paths.defaultWorkspaceRoot,
        },
        llm: {
          providers: [
            {
              id: 'sirius',
              kind: 'openai-compatible',
              label: 'Sirius',
              enabled: true,
              apiKey: 'sirius-secret-123456',
              secretRef: 'provider-sirius-api-key',
              hasStoredSecret: false,
              baseUrl: 'https://api.sirius.dev/v1',
              models: [{ id: 'sirius-model', label: 'Sirius Model', enabled: true }],
              recommendedModels: [],
              docsUrl: '',
              isConfigured: false,
            },
          ],
          agentRoutes: settings.llm.agentRoutes,
        },
      });
    });

    await closeApp(ctx, { cleanup: false });
    ctx = await launchApp({ tempDir, cleanupOnClose: false });

    await openSettings(ctx);

    await ctx.page.locator('[data-testid="settings-nav-account"]').click();
    await expect(ctx.page.locator('[data-testid="settings-nav-account"]')).toHaveClass(/active/);
    await ctx.page.locator('input').first().fill('Operator Prime');
    await ctx.page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(ctx.page.locator('[data-testid="settings-nav-account"]')).toHaveClass(/active/);
    await expect(ctx.page.locator('[data-testid="settings-nav-models"]')).not.toHaveClass(/active/);

    await ctx.page.locator('[data-testid="settings-nav-workspace"]').click();
    await expect(ctx.page.locator('[data-testid="settings-nav-workspace"]')).toHaveClass(/active/);
    await ctx.page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(ctx.page.locator('[data-testid="settings-nav-workspace"]')).toHaveClass(/active/);
    await expect(ctx.page.locator('[data-testid="settings-nav-models"]')).not.toHaveClass(/active/);

    await ctx.page.locator('[data-testid="settings-nav-models"]').click();
    await ctx.page.locator('[data-testid="settings-provider-item-sirius"]').click();
    await expect(ctx.page.locator('[data-testid="settings-nav-models"]')).toHaveClass(/active/);
    await ctx.page.locator('[data-testid="settings-provider-save"]').click();
    await expect(ctx.page.locator('[data-testid="settings-nav-models"]')).toHaveClass(/active/);
    await expect(ctx.page.locator('[data-testid="settings-provider-item-sirius"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-model-detail"]')).toContainText('Sirius');
  } finally {
    await closeApp(ctx, { cleanup: true });
  }
});

test('Agent 保存后停留在 Agent 面板，不跳回模型页', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const tempDir = ctx.tempDir;

  try {
    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();

      await window.electronAPI.settings.set({
        llm: {
          providers: [
            {
              id: 'openrouter',
              kind: 'openrouter',
              label: 'OpenRouter',
              enabled: true,
              apiKey: 'sk-or-test-1234567890',
              secretRef: 'provider-openrouter-api-key',
              hasStoredSecret: false,
              baseUrl: 'https://openrouter.ai/api/v1',
              models: [
                { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', enabled: true },
              ],
              recommendedModels: [],
              docsUrl: 'https://openrouter.ai/keys',
              isConfigured: false,
            },
          ],
          agentRoutes: settings.llm.agentRoutes.map((route) => ({
            ...route,
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4.5',
          })),
        },
      });
    });

    await closeApp(ctx, { cleanup: false });
    ctx = await launchApp({ tempDir, cleanupOnClose: false });

    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-agents"]').click();
    await expect(ctx.page.locator('[data-testid="settings-nav-agents"]')).toHaveClass(/active/);

    await ctx.page.locator('[data-testid="settings-agent-save"]').click();

    await expect(ctx.page.locator('[data-testid="settings-nav-agents"]')).toHaveClass(/active/);
    await expect(ctx.page.locator('[data-testid="settings-nav-models"]')).not.toHaveClass(/active/);
    await expect(ctx.page.locator('[data-testid="settings-agent-list"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-model-detail"]')).toHaveCount(0);
  } finally {
    await closeApp(ctx, { cleanup: true });
  }
});
