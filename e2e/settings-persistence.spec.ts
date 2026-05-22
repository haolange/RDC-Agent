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

const installModelDiscoveryMock = async (ctx: AppContext): Promise<void> => {
  await ctx.app.evaluate(() => {
    const json = (payload: unknown, init?: ResponseInit) => new Response(JSON.stringify(payload), {
      status: init?.status ?? 200,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const bearer = headers.get('authorization') || '';
      const anthropicKey = headers.get('x-api-key') || '';

      if (url.includes('api.openai.com') && bearer.includes('bad-key')) {
        return json({ error: 'bad key' }, { status: 401 });
      }
      if (url.includes('api.openai.com')) {
        return json({
          object: 'list',
          data: [
            { id: 'gpt-test-1' },
            { id: 'deprecated-gpt-test' },
          ],
        });
      }
      if (url.includes('api.anthropic.com') && anthropicKey) {
        return json({
          data: [
            { id: 'claude-test-1', display_name: 'Claude Test 1' },
          ],
        });
      }
      if (url.includes('127.0.0.1:11434') && url.endsWith('/api/tags')) {
        return json({
          models: [
            { name: 'qwen-test:latest' },
          ],
        });
      }
      if (url.includes('api.deepseek.com')) {
        return json({ object: 'list', data: [] });
      }
      return json({ error: 'not found' }, { status: 404 });
    };
  });
};

test('供应商页直接枚举 catalog，并移除旧模板、自定义、Base URL 与手动模型入口', async () => {
  const ctx = await launchApp();

  try {
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();

    await expect(ctx.page.locator('[data-testid="settings-nav-models"]')).toContainText(/供应商|Provider/);
    const providerList = ctx.page.locator('[data-testid="settings-provider-list"]');
    await expect(providerList).toContainText('OpenRouter');
    await expect(providerList).toContainText('OpenAI');
    await expect(providerList).toContainText('Anthropic');
    await expect(providerList).toContainText('Kimi / Moonshot');
    await expect(providerList).toContainText('Ollama');
    await expect(providerList).toContainText('GitHub Copilot');

    await expect(ctx.page.locator('[data-testid="settings-provider-template-select"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-provider-add-template"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-provider-add"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-provider-kind"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-model-detail"]')).not.toContainText('API Base URL');
    await expect(ctx.page.locator('[data-testid="settings-model-detail"]')).not.toContainText(/添加模型|Add Model/);
  } finally {
    await closeApp(ctx);
  }
});

test('连接弹窗测试失败不保存密钥，直接保存会先测试成功后才写入 discovered models', async () => {
  const ctx = await launchApp();

  try {
    await installModelDiscoveryMock(ctx);
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();
    await ctx.page.locator('[data-testid="settings-provider-item-openai"]').click();
    await ctx.page.locator('[data-testid="settings-provider-connect-openai"]').click();

    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toBeVisible();
    await ctx.page.locator('[data-testid="settings-provider-connect-api-key"]').fill('bad-key');
    await ctx.page.locator('[data-testid="settings-provider-connect-test"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-error"]')).toContainText(/无效|权限|Invalid|permission/);

    let settings = await ctx.page.evaluate(async () => window.electronAPI.settings.get());
    let openai = settings.llm.providers.find((provider) => provider.id === 'openai');
    expect(openai?.apiKey).toBe('');
    expect(openai?.hasStoredSecret).toBe(false);
    expect(openai?.isConfigured).toBe(false);

    await ctx.page.locator('[data-testid="settings-provider-connect-api-key"]').fill('sk-good-key');
    await ctx.page.locator('[data-testid="settings-provider-connect-save"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-model-detail"]')).toContainText('gpt-test-1');
    await expect(ctx.page.locator('[data-testid="settings-model-detail"]')).not.toContainText('deprecated-gpt-test');

    settings = await ctx.page.evaluate(async () => window.electronAPI.settings.get());
    openai = settings.llm.providers.find((provider) => provider.id === 'openai');
    expect(openai?.apiKey).toBe('');
    expect(openai?.hasStoredSecret).toBe(true);
    expect(openai?.status).toBe('verified');
    expect(openai?.models.map((model) => model.id)).toEqual(['gpt-test-1']);
  } finally {
    await closeApp(ctx);
  }
});

test('模型发现统一归一化 OpenAI-compatible、Anthropic、Ollama，并阻止空模型保存', async () => {
  const ctx = await launchApp();

  try {
    await installModelDiscoveryMock(ctx);

    const result = await ctx.page.evaluate(async () => {
      const openai = await window.electronAPI.llm.testProviderDraft({ providerId: 'openai', apiKey: 'good-key' });
      const anthropic = await window.electronAPI.llm.testProviderDraft({ providerId: 'anthropic', apiKey: 'sk-ant-test' });
      const ollama = await window.electronAPI.llm.testProviderDraft({ providerId: 'ollama' });
      const empty = await window.electronAPI.llm.connectProvider({ providerId: 'deepseek', apiKey: 'deepseek-key' });
      const settings = await window.electronAPI.settings.get();
      return {
        openai,
        anthropic,
        ollama,
        empty,
        deepseek: settings.llm.providers.find((provider) => provider.id === 'deepseek'),
      };
    });

    expect(result.openai.success).toBe(true);
    expect(result.openai.models.map((model) => model.id)).toEqual(['gpt-test-1']);
    expect(result.anthropic.success).toBe(true);
    expect(result.anthropic.models.map((model) => model.id)).toEqual(['claude-test-1']);
    expect(result.ollama.success).toBe(true);
    expect(result.ollama.models.map((model) => model.id)).toEqual(['qwen-test:latest']);
    expect(result.empty.success).toBe(false);
    expect(result.empty.error).toContain('暂未返回可用模型');
    expect(result.deepseek?.hasStoredSecret).toBe(false);
    expect(result.deepseek?.isConfigured).toBe(false);
  } finally {
    await closeApp(ctx);
  }
});

test('账号 Provider 缺少登录配置时不可连接，Agent 路由只展示 verified 且有模型的 Provider', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const tempDir = ctx.tempDir;

  try {
    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      await window.electronAPI.settings.set({
        llm: {
          providers: settings.llm.providers.map((provider) => {
            if (provider.id === 'openai') {
              return {
                ...provider,
                enabled: true,
                apiKey: 'sk-good-key',
                hasStoredSecret: false,
                models: [{ id: 'gpt-test-1', label: 'GPT Test 1', enabled: true }],
                status: 'verified',
                lastTestedAt: new Date().toISOString(),
                lastModelRefreshAt: new Date().toISOString(),
                isConfigured: true,
              };
            }
            if (provider.id === 'anthropic') {
              return {
                ...provider,
                enabled: false,
                apiKey: '',
                models: [{ id: 'claude-failed', label: 'Claude Failed', enabled: true }],
                status: 'failed',
                lastError: 'API Key 无效',
                isConfigured: false,
              };
            }
            return provider;
          }),
          agentRoutes: settings.llm.agentRoutes.map((route) => (
            route.agentId === 'curator_agent'
              ? { ...route, providerId: 'openai', modelId: 'gpt-test-1' }
              : route
          )),
        },
      });
    });

    await closeApp(ctx, { cleanup: false });
    ctx = await launchApp({ tempDir, cleanupOnClose: false });

    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();
    await ctx.page.locator('[data-testid="settings-provider-item-chatgpt-account"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-account-unavailable-chatgpt-account"]')).toContainText(/未配置登录通道|login channel/);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-chatgpt-account"]')).toBeDisabled();

    await ctx.page.locator('[data-testid="settings-nav-agents"]').click();
    const providerOptions = await readDropdownOptionLabels(ctx, 'settings-agent-provider-curator_agent');
    expect(providerOptions).toContain('OpenAI');
    expect(providerOptions).not.toContain('Anthropic');

    const modelOptions = await readDropdownOptionLabels(ctx, 'settings-agent-model-curator_agent');
    expect(modelOptions).toEqual(['GPT Test 1']);
  } finally {
    await closeApp(ctx, { cleanup: true });
  }
});

test('通用设置修改后停留在当前面板，不跳回供应商页', async () => {
  const ctx = await launchApp();

  try {
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-general"]').click();
    await expect(ctx.page.locator('[data-testid="settings-nav-general"]')).toHaveClass(/active/);

    await ctx.page.getByRole('button', { name: /浅色|Light/, exact: false }).click();

    await expect(ctx.page.locator('[data-testid="settings-nav-general"]')).toHaveClass(/active/);
    await expect(ctx.page.locator('[data-testid="settings-nav-models"]')).not.toHaveClass(/active/);
    await expect(ctx.page.locator('[data-testid="settings-model-detail"]')).toHaveCount(0);
  } finally {
    await closeApp(ctx);
  }
});
