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

const installProviderNetworkMock = async (ctx: AppContext): Promise<void> => {
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
      if (url.includes('api.openai.com') && url.endsWith('/models') && bearer.includes('openai-oauth-token')) {
        return json({
          object: 'list',
          data: [
            { id: 'gpt-5.2' },
            { id: 'gpt-5-mini' },
            { id: 'text-embedding-3-small' },
          ],
        });
      }
      if (url.includes('api.openai.com') && url.endsWith('/models')) {
        return json({
          object: 'list',
          data: [
            { id: 'gpt-test-1' },
            { id: 'text-embedding-3-small' },
            { id: 'deprecated-gpt-test' },
          ],
        });
      }
      if (url.includes('openrouter.ai') && url.endsWith('/models')) {
        return json({
          object: 'list',
          data: [
            { id: 'anthropic/claude-haiku-latest' },
            { id: 'text-embedding-openrouter' },
          ],
        });
      }
      if (url.includes('api.groq.com') && url.endsWith('/models')) {
        return json({ object: 'list', data: [{ id: 'llama-3.3-70b-versatile' }] });
      }
      if (url.includes('generativelanguage.googleapis.com') && url.includes('/models')) {
        return json({
          models: [
            { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
          ],
        });
      }
      if (url.includes('azure.test') && url.includes('/chat/completions')) {
        return json({ id: 'azure-probe-ok', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
      }
      if (url.includes('api.kimi.com') && url.endsWith('/messages')) {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { model?: string } : {};
        return body.model === 'sonnet'
          ? json({ id: 'kimi-probe-ok', content: [{ type: 'text', text: 'ok' }] })
          : json({ error: 'not found' }, { status: 404 });
      }
      if (url.includes('api.anthropic.com') && url.endsWith('/models') && anthropicKey) {
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
      if (url.includes('api.siliconflow.cn')) {
        return json({ object: 'list', data: [] });
      }
      if (url.includes('api.deepseek.com')) {
        return json({ object: 'list', data: [] });
      }
      if (url.includes('platform.claude.com') && url.endsWith('/oauth/token')) {
        return json({
          access_token: 'claude-oauth-token',
          refresh_token: 'claude-refresh-token',
          expires_in: 3600,
          scope: 'user:inference',
        });
      }
      if (url.includes('auth.openai.com') && url.endsWith('/oauth/token')) {
        return json({
          access_token: 'openai-oauth-token',
          refresh_token: 'openai-refresh-token',
          expires_in: 3600,
        });
      }
      if (url.includes('api.anthropic.com') && bearer.includes('claude-oauth-token')) {
        return json({
          data: [
            { id: 'claude-test-1', display_name: 'Claude Test 1' },
          ],
        });
      }
      if (url.includes('github.com/login/device/code')) {
        return json({
          device_code: 'device-code',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 1,
        });
      }
      if (url.includes('github.com/login/oauth/access_token')) {
        return json({
          access_token: 'gho-copilot-test',
          token_type: 'bearer',
          scope: 'read:user',
        });
      }
      if (url.includes('api.github.com/copilot_internal/v2/token')) {
        const state = globalThis as typeof globalThis & { __rdcCopilotTokenCalls?: number };
        state.__rdcCopilotTokenCalls = (state.__rdcCopilotTokenCalls ?? 0) + 1;
        return json({
          token: 'copilot-api-token',
          expires_at: Math.floor(Date.now() / 1000) + 30,
          endpoints: {
            api: 'https://api.githubcopilot.com',
          },
        });
      }
      if (url.includes('api.githubcopilot.com/models')) {
        (globalThis as typeof globalThis & { __rdcCopilotModelHeaders?: Record<string, string> }).__rdcCopilotModelHeaders = Object.fromEntries(headers.entries());
        return json({
          data: [
            { id: 'gpt-4.1' },
          ],
        });
      }
      if (url.includes('api.githubcopilot.com/chat/completions')) {
        (globalThis as typeof globalThis & { __rdcCopilotChatHeaders?: Record<string, string> }).__rdcCopilotChatHeaders = Object.fromEntries(headers.entries());
        return new Response([
          'data: {"id":"copilot-chat-test","model":"gpt-4.1","choices":[{"delta":{"content":"copilot ok"},"finish_reason":"stop"}]}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return json({ error: 'not found' }, { status: 404 });
    };
  });
};

test('provider page separates OAuth accounts and shows one alphabetized provider catalog', async () => {
  const ctx = await launchApp();

  try {
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();

    const oauthSection = ctx.page.locator('[data-testid="settings-oauth-accounts"]');
    const addSection = ctx.page.locator('[data-testid="settings-add-provider"]');

    await expect(oauthSection).toContainText('Claude Account');
    await expect(oauthSection).toContainText('ChatGPT Account');
    await expect(oauthSection).toContainText('GitHub Copilot');
    await expect(ctx.page.locator('[data-testid="settings-connected-providers"]')).toHaveCount(0);
    for (const label of [
      'Anthropic',
      'Anthropic Third-party API',
      'Azure OpenAI',
      'OpenRouter',
      'GLM (CN)',
      'GLM (Global)',
      'Google AI Studio',
      'Groq',
      'Mistral',
      'Cerebras',
      'Hugging Face',
      'Kimi Coding Plan',
      'Moonshot',
      'MiniMax (CN)',
      'MiniMax (Global)',
      'DeepSeek',
      'Vercel AI Gateway',
      'Manifest',
      'Volcengine Ark',
      'Xiaomi MiMo',
      'Xiaomi MiMo Token Plan',
      'Aliyun Bailian',
      'AWS Bedrock',
      'Google Vertex',
      'Ollama',
      'LiteLLM',
      'Custom Endpoint',
      'OpenAI EU',
      'OpenAI US',
    ]) {
      await expect(addSection).toContainText(label);
    }
    for (const label of ['OpenAI', 'xAI Grok', 'Qwen / DashScope', '302.AI', 'SiliconFlow']) {
      await expect(addSection).toContainText(label);
      await expect(oauthSection).not.toContainText(label);
    }
    await expect(addSection).not.toContainText('Gemini');
    await expect(addSection).not.toContainText('GitHub Copilot');
    const catalog = await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      return settings.llm.providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        kind: provider.kind,
        authMode: provider.authMode,
        catalogGroup: provider.catalogGroup,
        modelDiscovery: provider.modelDiscovery,
        baseUrl: provider.baseUrl,
        baseUrlEditable: provider.baseUrlEditable,
      }));
    });
    expect(new Set(catalog.map((provider) => provider.id)).size).toBe(catalog.length);
    const vertex = catalog.find((provider) => provider.id === 'vertex');
    expect(vertex).toMatchObject({
      label: 'Google Vertex',
      kind: 'vertex',
      authMode: 'environment',
      catalogGroup: 'environment',
      modelDiscovery: 'static',
    });
    expect(vertex?.baseUrl).toBeUndefined();
    expect(catalog.some((provider) => provider.id === 'gemini')).toBe(false);
    expect(catalog.find((provider) => provider.id === 'openai')).toMatchObject({
      label: 'OpenAI',
      kind: 'openai-compatible',
      authMode: 'api-key',
      catalogGroup: 'api-key',
    });
    expect(catalog.find((provider) => provider.id === 'google-ai-studio')).toMatchObject({
      label: 'Google AI Studio',
      kind: 'google-ai-studio',
      authMode: 'api-key',
      modelDiscovery: 'google-ai-studio',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    });
    expect(catalog.find((provider) => provider.id === 'azure-openai')).toMatchObject({
      label: 'Azure OpenAI',
      kind: 'azure-openai',
      authMode: 'api-key',
      modelDiscovery: 'azure-openai',
      baseUrlEditable: true,
    });
    expect(catalog.find((provider) => provider.id === 'custom-endpoint')).toMatchObject({
      label: 'Custom Endpoint',
      kind: 'openai-compatible',
      authMode: 'api-key',
      baseUrlEditable: true,
    });
    const providerLabels = await addSection.locator('.settings-provider-item-label').allTextContents();
    expect(providerLabels).toEqual([...providerLabels].sort((left, right) => (
      left.localeCompare(right, undefined, { sensitivity: 'base' })
    )));

    await expect(ctx.page.locator('[data-testid="settings-provider-template-select"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-provider-add-template"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-provider-add"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-provider-kind"]')).toHaveCount(0);

    await ctx.page.locator('[data-testid="settings-provider-connect-vertex"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toBeVisible();
    await expect(ctx.page.locator('.settings-provider-connect-kicker')).toContainText('Environment');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-api-key"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-provider-environment-notice"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('sonnet');
    await ctx.page.locator('[data-testid="settings-provider-connect-dialog"] .settings-modal-close').click();
  } finally {
    await closeApp(ctx);
  }
});

test('API Key dialog has separate Test and Connect actions; failed Test does not save', async () => {
  const ctx = await launchApp();

  try {
    await installProviderNetworkMock(ctx);
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();
    await ctx.page.locator('[data-testid="settings-provider-connect-openai"]').click();

    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-test"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-save"]')).toContainText(/Connect|连接/);

    await ctx.page.locator('[data-testid="settings-provider-connect-api-key"]').fill('bad-key');
    await ctx.page.locator('[data-testid="settings-provider-connect-test"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-error"]')).toContainText(/无效|权限|Invalid|permission|API Key/);

    let settings = await ctx.page.evaluate(async () => window.electronAPI.settings.get());
    let openai = settings.llm.providers.find((provider) => provider.id === 'openai');
    expect(openai?.apiKey).toBe('');
    expect(openai?.hasStoredSecret).toBe(false);
    expect(openai?.isConfigured).toBe(false);

    await ctx.page.locator('[data-testid="settings-provider-connect-api-key"]').fill('sk-good-key');
    await ctx.page.locator('[data-testid="settings-provider-connect-save"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toHaveCount(0);
    const providerCatalog = ctx.page.locator('[data-testid="settings-add-provider"]');
    await expect(ctx.page.locator('[data-testid="settings-connected-providers"]')).toHaveCount(0);
    await expect(providerCatalog).toContainText('OpenAI');
    await expect(providerCatalog).toContainText('gpt-test-1');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-openai"]')).toContainText(/Edit|编辑/);

    await ctx.page.locator('[data-testid="settings-provider-connect-openai"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-api-key"]')).toHaveValue(/••••/);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-api-key-toggle"]')).toContainText(/Replace|替换/);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('gpt-test-1');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-save"]')).toContainText(/Save|保存/);
    await ctx.page.locator('[data-testid="settings-provider-connect-save"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toHaveCount(0);

    await ctx.page.locator('[data-testid="settings-provider-connect-openai"]').click();
    await ctx.page.locator('[data-testid="settings-provider-connect-api-key-toggle"]').click();
    await ctx.page.locator('[data-testid="settings-provider-connect-api-key"]').fill('sk-better-key');
    await ctx.page.locator('[data-testid="settings-provider-connect-api-key-toggle"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-api-key"]')).toHaveAttribute('type', 'text');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-api-key"]')).toHaveValue('sk-better-key');
    await ctx.page.locator('[data-testid="settings-provider-connect-save"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toHaveCount(0);

    settings = await ctx.page.evaluate(async () => window.electronAPI.settings.get());
    openai = settings.llm.providers.find((provider) => provider.id === 'openai');
    const storedOpenAiSecret = await ctx.page.evaluate(async () => window.electronAPI.settings.getProviderSecret('openai'));
    expect(openai?.apiKey).toBe('');
    expect(openai?.hasStoredSecret).toBe(true);
    expect(openai?.status).toBe('verified');
    expect(openai?.models.map((model) => model.id)).toEqual(['gpt-test-1']);
    expect(storedOpenAiSecret).toBe('sk-better-key');
  } finally {
    await closeApp(ctx);
  }
});

test('model discovery normalizes OpenAI-compatible, Anthropic, and Ollama payloads', async () => {
  const ctx = await launchApp();

  try {
    await installProviderNetworkMock(ctx);

    const result = await ctx.page.evaluate(async () => {
      const openai = await window.electronAPI.llm.testProviderDraft({ providerId: 'openai', apiKey: 'good-key' });
      const anthropic = await window.electronAPI.llm.testProviderDraft({ providerId: 'anthropic', apiKey: 'sk-ant-test' });
      const ollama = await window.electronAPI.llm.testProviderDraft({ providerId: 'ollama' });
      const openrouter = await window.electronAPI.llm.testProviderDraft({ providerId: 'openrouter', apiKey: 'sk-or-test' });
      const groq = await window.electronAPI.llm.testProviderDraft({ providerId: 'groq', apiKey: 'gsk-test' });
      const google = await window.electronAPI.llm.testProviderDraft({ providerId: 'google-ai-studio', apiKey: 'AIza-test' });
      const azure = await window.electronAPI.llm.testProviderDraft({
        providerId: 'azure-openai',
        apiKey: 'azure-key',
        baseUrl: 'https://azure.test/openai/deployments/rdc',
      });
      const empty = await window.electronAPI.llm.connectProvider({ providerId: 'siliconflow', apiKey: 'siliconflow-key' });
      const settings = await window.electronAPI.settings.get();
      return {
        openai,
        anthropic,
        ollama,
        openrouter,
        groq,
        google,
        azure,
        empty,
        siliconflow: settings.llm.providers.find((provider) => provider.id === 'siliconflow'),
      };
    });

    expect(result.openai.success).toBe(true);
    expect(result.openai.models.map((model) => model.id)).toEqual(['gpt-test-1']);
    expect(result.anthropic.success).toBe(true);
    expect(result.anthropic.models.map((model) => model.id)).toEqual(['claude-test-1']);
    expect(result.ollama.success).toBe(true);
    expect(result.ollama.models.map((model) => model.id)).toEqual(['qwen-test:latest']);
    expect(result.openrouter.success).toBe(true);
    expect(result.openrouter.models.map((model) => model.id)).toEqual(['anthropic/claude-haiku-latest']);
    expect(result.groq.success).toBe(true);
    expect(result.groq.models.map((model) => model.id)).toEqual(['llama-3.3-70b-versatile']);
    expect(result.google.success).toBe(true);
    expect(result.google.models.map((model) => model.id)).toEqual(['gemini-2.5-pro']);
    expect(result.azure.success).toBe(true);
    expect(result.azure.models.map((model) => model.id)).toEqual(['gpt-4.1', 'gpt-5-mini']);
    expect(result.empty.success).toBe(false);
    expect(result.empty.error).toMatch(/可用于 Agent 路由|No models/i);
    expect(result.siliconflow?.hasStoredSecret).toBe(false);
    expect(result.siliconflow?.isConfigured).toBe(false);
  } finally {
    await closeApp(ctx);
  }
});

test('static provider recommendations are not shown as discovered before validation', async () => {
  const ctx = await launchApp();

  try {
    await installProviderNetworkMock(ctx);
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();
    await ctx.page.locator('[data-testid="settings-provider-connect-kimi-coding-plan"]').click();

    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"] .settings-model-row')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).not.toContainText('sonnet');

    await ctx.page.locator('[data-testid="settings-provider-connect-api-key"]').fill('sk-kimi-test');
    await ctx.page.locator('[data-testid="settings-provider-connect-test"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText(/Verified|已验证/);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('sonnet');
  } finally {
    await closeApp(ctx);
  }
});

test('OAuth account providers expose Connect, Test, code/device states, and Sign out', async () => {
  const ctx = await launchApp();

  try {
    await installProviderNetworkMock(ctx);
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();

    await ctx.page.locator('[data-testid="settings-provider-connect-claude-account"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toBeVisible();
    await ctx.page.locator('[data-testid="settings-provider-oauth-start"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-oauth-code"]')).toBeVisible();
    await ctx.page.locator('[data-testid="settings-provider-oauth-code"]').fill('mock-claude-code');
    await ctx.page.locator('[data-testid="settings-provider-connect-save"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-claude-account"]')).toContainText(/Connected|已连接/);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-claude-account"]')).toContainText(/Edit|编辑/);

    await ctx.page.locator('[data-testid="settings-provider-connect-claude-account"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-provider-oauth-start"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-save"]')).toContainText(/Save|保存|淇濆瓨/);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('Claude Test 1');
    await ctx.page.locator('[data-testid="settings-provider-connect-dialog"] .settings-modal-close').click();

    await ctx.page.locator('[data-testid="settings-provider-test-claude-account"]').click();
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-claude-account"]')).toContainText('Claude Test 1');
    await ctx.page.locator('[data-testid="settings-provider-disconnect-claude-account"]').click();
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-claude-account"]')).toContainText(/Connect|连接/);

    await ctx.page.locator('[data-testid="settings-provider-connect-chatgpt-account"]').click();
    await ctx.page.locator('[data-testid="settings-provider-oauth-start"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-oauth-code"]')).toBeVisible();
    await ctx.page.locator('[data-testid="settings-provider-oauth-code"]').fill('mock-openai-code');
    await ctx.page.locator('[data-testid="settings-provider-connect-save"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-chatgpt-account"]')).toContainText('gpt-5.2');
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-chatgpt-account"]')).toContainText('gpt-5-mini');

    await ctx.page.locator('[data-testid="settings-provider-connect-chatgpt-account"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('gpt-5.2');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('gpt-5-mini');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).not.toContainText('text-embedding-3-small');
    await ctx.page.locator('[data-testid="settings-provider-connect-dialog"] .settings-modal-close').click();

    await ctx.page.locator('[data-testid="settings-provider-connect-github-copilot"]').click();
    await ctx.page.locator('[data-testid="settings-provider-oauth-start"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-oauth-device-code"]')).toContainText('ABCD-1234');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-github-copilot"]')).toContainText('gpt-4.1');
    await ctx.page.locator('[data-testid="settings-provider-test-github-copilot"]').click();
    const copilotTokenCalls = await ctx.app.evaluate(() => (
      globalThis as typeof globalThis & { __rdcCopilotTokenCalls?: number }
    ).__rdcCopilotTokenCalls ?? 0);
    expect(copilotTokenCalls).toBeGreaterThanOrEqual(2);
    const copilotHeaders = await ctx.app.evaluate(() => (
      globalThis as typeof globalThis & { __rdcCopilotModelHeaders?: Record<string, string> }
    ).__rdcCopilotModelHeaders ?? {});
    expect(copilotHeaders.authorization).toContain('copilot-api-token');
    expect(copilotHeaders['copilot-integration-id']).toBe('vscode-chat');

    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      await window.electronAPI.settings.set({
        llm: {
          providers: settings.llm.providers,
          agentRoutes: settings.llm.agentRoutes.map((route) => (
            route.agentId === 'curator_agent'
              ? { ...route, providerId: 'github-copilot', modelId: 'gpt-4.1' }
              : route
          )),
        },
      });
    });
    const agentResult = await ctx.page.evaluate(async () => window.electronAPI.agent.sendMessage('curator_agent', 'Say copilot ok.'));
    expect(agentResult.error).toBeUndefined();
    expect(agentResult.response).toContain('copilot ok');
    const copilotChatHeaders = await ctx.app.evaluate(() => (
      globalThis as typeof globalThis & { __rdcCopilotChatHeaders?: Record<string, string> }
    ).__rdcCopilotChatHeaders ?? {});
    expect(copilotChatHeaders.authorization).toContain('copilot-api-token');
    expect(copilotChatHeaders['copilot-integration-id']).toBe('vscode-chat');
  } finally {
    await closeApp(ctx);
  }
});

test('ChatGPT OAuth does not save fallback models when model discovery is empty', async () => {
  const ctx = await launchApp();

  try {
    await ctx.app.evaluate(() => {
      const json = (payload: unknown, init?: ResponseInit) => new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('auth.openai.com') && url.endsWith('/oauth/token')) {
          return json({
            access_token: 'openai-oauth-token',
            refresh_token: 'openai-refresh-token',
            expires_in: 3600,
          });
        }
        if (url.includes('api.openai.com') && url.endsWith('/models')) {
          return json({ object: 'list', data: [] });
        }
        return json({ error: 'not found' }, { status: 404 });
      };
    });
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();

    await ctx.page.locator('[data-testid="settings-provider-connect-chatgpt-account"]').click();
    await ctx.page.locator('[data-testid="settings-provider-oauth-start"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-oauth-code"]')).toBeVisible();
    await ctx.page.locator('[data-testid="settings-provider-oauth-code"]').fill('mock-openai-code');
    await ctx.page.locator('[data-testid="settings-provider-connect-save"]').click();

    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-error"]')).toContainText(/no usable models|可用于 Agent 路由|returned no usable/i);
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-chatgpt-account"]')).not.toContainText('gpt-5-mini');
    const settings = await ctx.page.evaluate(async () => window.electronAPI.settings.get());
    const chatgpt = settings.llm.providers.find((provider) => provider.id === 'chatgpt-account');
    expect(chatgpt?.isConfigured).toBe(false);
    expect(chatgpt?.models).toEqual([]);
  } finally {
    await closeApp(ctx);
  }
});

test('OAuth account dialog shows start-login errors inline', async () => {
  const ctx = await launchApp();

  try {
    await ctx.app.evaluate(() => {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: 'device flow unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    });
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();
    await ctx.page.locator('[data-testid="settings-provider-connect-github-copilot"]').click();

    await ctx.page.locator('[data-testid="settings-provider-oauth-start"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-error"]')).toContainText('device flow unavailable');
  } finally {
    await closeApp(ctx);
  }
});

test('agent routing only lists verified providers with enabled models', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const tempDir = ctx.tempDir;

  try {
    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      const confirmed = await window.electronAPI.settings.set({
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
                lastError: 'API Key invalid',
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
      (window as Window & {
        __RDC_AGENT_E2E__?: {
          setAppSettings: (settings: unknown) => void;
        };
      }).__RDC_AGENT_E2E__?.setAppSettings(confirmed);
    });

    await closeApp(ctx, { cleanup: false });
    ctx = await launchApp({ tempDir, cleanupOnClose: false });

    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-chatgpt-account"]')).toContainText(/Connect|连接/);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-chatgpt-account"]')).toBeEnabled();

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

test('general settings changes stay on the current panel', async () => {
  const ctx = await launchApp();

  try {
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-general"]').click();
    await expect(ctx.page.locator('[data-testid="settings-nav-general"]')).toHaveClass(/active/);

    await ctx.page.getByRole('button', { name: /浅色|Light/, exact: false }).click();

    await expect(ctx.page.locator('[data-testid="settings-nav-general"]')).toHaveClass(/active/);
    await expect(ctx.page.locator('[data-testid="settings-nav-models"]')).not.toHaveClass(/active/);
    await expect(ctx.page.locator('[data-testid="settings-oauth-accounts"]')).toHaveCount(0);
  } finally {
    await closeApp(ctx);
  }
});
