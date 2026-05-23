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
      if (url.includes('api.openai.com') && url.endsWith('/chat/completions') && bearer.includes('openai-oauth-token')) {
        const state = globalThis as typeof globalThis & { __rdcChatGptPlatformChatCalls?: number };
        state.__rdcChatGptPlatformChatCalls = (state.__rdcChatGptPlatformChatCalls ?? 0) + 1;
        return json({ error: 'wrong endpoint' }, { status: 500 });
      }
      if (url.includes('api.openai.com') && url.endsWith('/models') && bearer.includes('openai-oauth-token')) {
        const state = globalThis as typeof globalThis & { __rdcOpenAiOAuthModelsCalls?: number };
        state.__rdcOpenAiOAuthModelsCalls = (state.__rdcOpenAiOAuthModelsCalls ?? 0) + 1;
        return json({ error: 'missing scope' }, { status: 403 });
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
      if (url.includes('api.kimi.com')) {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { model?: string } : {};
        const state = globalThis as typeof globalThis & {
          __rdcKimiProbeRequests?: Array<{ url: string; model?: string }>;
        };
        state.__rdcKimiProbeRequests = [
          ...(state.__rdcKimiProbeRequests ?? []),
          { url, ...(body.model ? { model: body.model } : {}) },
        ];
        return url === 'https://api.kimi.com/coding/v1/models'
          ? json({ object: 'list', data: [{ id: 'kimi-for-coding' }] })
          : json({ error: 'wrong kimi endpoint' }, { status: 500 });
      }
      if (url.includes('api.anthropic.com') && url.endsWith('/models') && anthropicKey) {
        return json({
          data: [
            { id: 'claude-test-1', display_name: 'Claude Test 1' },
          ],
        });
      }
      if (url.includes('api.anthropic.com') && url.endsWith('/models') && bearer.includes('claude-oauth-token')) {
        const state = globalThis as typeof globalThis & { __rdcClaudeOAuthModelsCalls?: number };
        state.__rdcClaudeOAuthModelsCalls = (state.__rdcClaudeOAuthModelsCalls ?? 0) + 1;
        return json({ error: 'Claude account model discovery should use account catalog' }, { status: 500 });
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
        const encode = (payload: unknown) => Buffer.from(JSON.stringify(payload))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        return json({
          access_token: 'openai-oauth-token',
          refresh_token: 'openai-refresh-token',
          id_token: `${encode({ alg: 'none' })}.${encode({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' } })}.`,
          expires_in: 3600,
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
            { id: 'gpt-5-disabled', policy: { state: 'disabled' } },
          ],
        });
      }
      if (url.includes('api.githubcopilot.com/chat/completions')) {
        (globalThis as typeof globalThis & { __rdcCopilotChatHeaders?: Record<string, string> }).__rdcCopilotChatHeaders = Object.fromEntries(headers.entries());
        return new Response([
          'data: {"id":"copilot-chat-test","model":"gpt-5.4","choices":[{"delta":{"content":"copilot ok"},"finish_reason":"stop"}]}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      if (url.includes('chatgpt.com/backend-api/codex/responses')) {
        const state = globalThis as typeof globalThis & {
          __rdcChatGptCodexBody?: unknown;
          __rdcChatGptCodexHeaders?: Record<string, string>;
        };
        state.__rdcChatGptCodexHeaders = Object.fromEntries(headers.entries());
        state.__rdcChatGptCodexBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        return new Response([
          'event: response.output_text.delta',
          'data: {"delta":"chatgpt ok"}',
          '',
          'event: response.completed',
          'data: {"response":{"id":"chatgpt-codex-test","model":"gpt-5.5","usage":{"input_tokens":1,"output_tokens":2}}}',
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

const finishChatGptBrowserCallback = async (ctx: AppContext, code = 'mock-openai-code'): Promise<void> => {
  const authUrl = await ctx.page.locator('.settings-provider-oauth-panel a.settings-link').getAttribute('href');
  expect(authUrl).toBeTruthy();
  const state = new URL(authUrl ?? '').searchParams.get('state');
  expect(state).toBeTruthy();
  const callback = await fetch(`http://127.0.0.1:1455/auth/callback?state=${encodeURIComponent(state ?? '')}&code=${encodeURIComponent(code)}`);
  const response = { status: callback.status, text: await callback.text() };
  expect(response.status, response.text).toBe(200);
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
      'Kimi Code',
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
      'Google Vertex AI',
      'Ollama',
      'LiteLLM',
      'Custom Endpoint',
      'OpenAI EU',
      'OpenAI US',
    ]) {
      await expect(addSection).toContainText(label);
    }
    for (const label of ['OpenAI', 'xAI (Grok)', 'Qwen / DashScope', '302.AI', 'SiliconFlow']) {
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
        recommendedModels: provider.recommendedModels,
      }));
    });
    expect(new Set(catalog.map((provider) => provider.id)).size).toBe(catalog.length);
    const vertex = catalog.find((provider) => provider.id === 'vertex');
    expect(vertex).toMatchObject({
      label: 'Google Vertex AI',
      kind: 'vertex',
      authMode: 'environment',
      catalogGroup: 'environment',
      modelDiscovery: 'static',
    });
    expect(vertex?.baseUrl).toBeUndefined();
    expect(catalog.some((provider) => provider.id === 'gemini')).toBe(false);
    expect(catalog.find((provider) => provider.id === 'kimi-code')).toMatchObject({
      label: 'Kimi Code',
      kind: 'anthropic',
      authMode: 'api-key',
      modelDiscovery: 'anthropic-candidate-validation',
      baseUrl: 'https://api.kimi.com/coding/v1',
      recommendedModels: ['kimi-for-coding'],
    });
    expect(catalog.find((provider) => provider.id === 'xai')).toMatchObject({
      label: 'xAI (Grok)',
      kind: 'openai-compatible',
      authMode: 'api-key',
      modelDiscovery: 'openai-compatible',
      baseUrl: 'https://api.x.ai/v1',
    });
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
    expect(catalog.find((provider) => provider.id === 'claude-account')).toMatchObject({
      label: 'Claude Account',
      authMode: 'account',
      modelDiscovery: 'account-catalog',
    });
    expect(catalog.find((provider) => provider.id === 'github-copilot')).toMatchObject({
      label: 'GitHub Copilot',
      authMode: 'account',
      modelDiscovery: 'account-catalog',
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
    await ctx.page.locator('[data-testid="settings-provider-connect-kimi-code"]').click();

    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"] .settings-model-row')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).not.toContainText('kimi-for-coding');

    await ctx.page.locator('[data-testid="settings-provider-connect-api-key"]').fill('sk-kimi-test');
    await ctx.page.locator('[data-testid="settings-provider-connect-test"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText(/Verified|已验证/);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('kimi-for-coding');
  } finally {
    await closeApp(ctx);
  }
});

test('Kimi Code ignores stale Kimi Moonshot metadata when validating models', async () => {
  const ctx = await launchApp();

  try {
    await installProviderNetworkMock(ctx);
    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      await window.electronAPI.settings.set({
        llm: {
          ...settings.llm,
          providers: [
            {
              id: 'kimi-code',
              kind: 'anthropic',
              authMode: 'api-key',
              catalogGroup: 'api-key',
              modelDiscovery: 'anthropic-candidate-validation',
              label: 'Kimi / Moonshot',
              enabled: false,
              apiKey: '',
              secretRef: 'provider-kimi-code-api-key',
              hasStoredSecret: false,
              baseUrl: 'https://api.kimi.com/coding/',
              models: [],
              recommendedModels: ['kimi-k2-0711-preview', 'moonshot-v1-128k'],
              docsUrl: 'https://platform.moonshot.cn/console/api-keys',
              status: 'unconfigured',
              isConfigured: false,
            },
          ],
        },
      });
    });
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();
    await ctx.page.locator('[data-testid="settings-provider-connect-kimi-code"]').click();

    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toBeVisible();
    await expect(ctx.page.locator('#settings-provider-connect-title')).toContainText('Kimi Code');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).not.toContainText('Kimi / Moonshot');

    await ctx.page.locator('[data-testid="settings-provider-connect-api-key"]').fill('sk-kimi-test');
    await ctx.page.locator('[data-testid="settings-provider-connect-test"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('kimi-for-coding');

    const probeRequests = await ctx.app.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __rdcKimiProbeRequests?: Array<{ url: string; model?: string }>;
      };
      return state.__rdcKimiProbeRequests ?? [];
    });
    expect(probeRequests).toEqual([
      { url: 'https://api.kimi.com/coding/v1/models' },
    ]);
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
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText(/Account Models|账号模型目录|璐﹀彿妯″瀷鐩綍/);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('claude-opus-4-7');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('claude-sonnet-4-6');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('claude-haiku-4-5-20251001');
    await ctx.page.locator('[data-testid="settings-provider-connect-dialog"] .settings-modal-close').click();

    await ctx.page.locator('[data-testid="settings-provider-test-claude-account"]').click();
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-claude-account"]')).toContainText('claude-opus-4-7');
    const claudeOAuthModelCalls = await ctx.app.evaluate(() => (
      globalThis as typeof globalThis & { __rdcClaudeOAuthModelsCalls?: number }
    ).__rdcClaudeOAuthModelsCalls ?? 0);
    expect(claudeOAuthModelCalls).toBe(0);
    await ctx.page.locator('[data-testid="settings-provider-disconnect-claude-account"]').click();
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-claude-account"]')).toContainText(/Connect|连接/);

    await ctx.page.locator('[data-testid="settings-provider-connect-chatgpt-account"]').click();
    await ctx.page.locator('[data-testid="settings-provider-oauth-start"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-oauth-code"]')).toHaveCount(0);
    await expect(ctx.page.locator('.settings-provider-oauth-panel a.settings-link')).toBeVisible();
    await finishChatGptBrowserCallback(ctx);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-chatgpt-account"]')).toContainText('gpt-5.5');
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-chatgpt-account"]')).toContainText('gpt-5.4');
    const openAiOauthModelCalls = await ctx.app.evaluate(() => (
      globalThis as typeof globalThis & { __rdcOpenAiOAuthModelsCalls?: number }
    ).__rdcOpenAiOAuthModelsCalls ?? 0);
    expect(openAiOauthModelCalls).toBe(0);

    await ctx.page.locator('[data-testid="settings-provider-connect-chatgpt-account"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText(/Account Models|账号模型目录/);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('gpt-5.5');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).toContainText('gpt-5.3-codex');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"]')).not.toContainText('text-embedding-3-small');
    await ctx.page.locator('[data-testid="settings-provider-connect-dialog"] .settings-modal-close').click();

    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      await window.electronAPI.settings.set({
        llm: {
          providers: settings.llm.providers,
          agentRoutes: settings.llm.agentRoutes.map((route) => (
            route.agentId === 'curator_agent'
              ? { ...route, providerId: 'chatgpt-account', modelId: 'gpt-5.5' }
              : route
          )),
        },
      });
    });
    const chatgptAgentResult = await ctx.page.evaluate(async () => window.electronAPI.agent.sendMessage('curator_agent', 'Say chatgpt ok.'));
    expect(chatgptAgentResult.error).toBeUndefined();
    expect(chatgptAgentResult.response).toContain('chatgpt ok');
    const chatgptCodexHeaders = await ctx.app.evaluate(() => (
      globalThis as typeof globalThis & { __rdcChatGptCodexHeaders?: Record<string, string> }
    ).__rdcChatGptCodexHeaders ?? {});
    expect(chatgptCodexHeaders.authorization).toContain('openai-oauth-token');
    expect(chatgptCodexHeaders['chatgpt-account-id']).toBe('acct-test');
    const chatgptPlatformChatCalls = await ctx.app.evaluate(() => (
      globalThis as typeof globalThis & { __rdcChatGptPlatformChatCalls?: number }
    ).__rdcChatGptPlatformChatCalls ?? 0);
    expect(chatgptPlatformChatCalls).toBe(0);

    await ctx.page.locator('[data-testid="settings-provider-connect-github-copilot"]').click();
    await ctx.page.locator('[data-testid="settings-provider-oauth-start"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-oauth-device-code"]')).toContainText('ABCD-1234');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-github-copilot"]')).toContainText('gpt-5.5');
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-github-copilot"]')).toContainText('gpt-5.4');
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
    expect(copilotHeaders['editor-version']).toBe('vscode/1.107.0');
    expect(copilotHeaders['editor-plugin-version']).toBe('copilot-chat/0.35.0');
    const copilotModels = await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      return settings.llm.providers
        .find((provider) => provider.id === 'github-copilot')
        ?.models.map((model) => model.id) ?? [];
    });
    expect(copilotModels).toEqual(expect.arrayContaining([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.3-codex',
      'claude-sonnet-4-6',
      'gpt-4.1',
    ]));
    expect(copilotModels).not.toContain('gpt-5-disabled');

    await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      await window.electronAPI.settings.set({
        llm: {
          providers: settings.llm.providers,
          agentRoutes: settings.llm.agentRoutes.map((route) => (
            route.agentId === 'curator_agent'
              ? { ...route, providerId: 'github-copilot', modelId: 'gpt-5.4' }
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
    expect(copilotChatHeaders['editor-version']).toBe('vscode/1.107.0');
    expect(copilotChatHeaders['editor-plugin-version']).toBe('copilot-chat/0.35.0');
  } finally {
    await closeApp(ctx);
  }
});

test('ChatGPT OAuth saves account catalog when Platform model discovery is unavailable', async () => {
  const ctx = await launchApp();

  try {
    await ctx.app.evaluate(() => {
      const json = (payload: unknown, init?: ResponseInit) => new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('auth.openai.com') && url.endsWith('/oauth/token')) {
          return json({
            access_token: 'openai-oauth-token',
            refresh_token: 'openai-refresh-token',
            expires_in: 3600,
          });
        }
        if (url.includes('api.openai.com') && url.endsWith('/models')) {
          const state = globalThis as typeof globalThis & { __rdcOpenAiOAuthModelsCalls?: number };
          state.__rdcOpenAiOAuthModelsCalls = (state.__rdcOpenAiOAuthModelsCalls ?? 0) + 1;
          return json({ error: 'missing scope' }, { status: 403 });
        }
        if (url.includes('chatgpt.com/backend-api/codex/responses')) {
          const headers = new Headers(init?.headers);
          (globalThis as typeof globalThis & { __rdcChatGptCodexHeaders?: Record<string, string> }).__rdcChatGptCodexHeaders = Object.fromEntries(headers.entries());
          return json({ id: 'chatgpt-codex-test', model: 'gpt-5.5', output_text: 'ok' });
        }
        return json({ error: 'not found' }, { status: 404 });
      };
    });
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();

    await ctx.page.locator('[data-testid="settings-provider-connect-chatgpt-account"]').click();
    await ctx.page.locator('[data-testid="settings-provider-oauth-start"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-oauth-code"]')).toHaveCount(0);
    await expect(ctx.page.locator('.settings-provider-oauth-panel a.settings-link')).toBeVisible();
    await finishChatGptBrowserCallback(ctx);

    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-chatgpt-account"]')).toContainText('gpt-5.5');
    const settings = await ctx.page.evaluate(async () => window.electronAPI.settings.get());
    const chatgpt = settings.llm.providers.find((provider) => provider.id === 'chatgpt-account');
    expect(chatgpt?.isConfigured).toBe(true);
    expect(chatgpt?.models.map((model) => model.id)).toEqual([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.2-codex',
      'gpt-5.1-codex',
      'gpt-5',
      'o4-mini',
      'o3',
      'gpt-4o',
    ]);
    const openAiOauthModelCalls = await ctx.app.evaluate(() => (
      globalThis as typeof globalThis & { __rdcOpenAiOAuthModelsCalls?: number }
    ).__rdcOpenAiOAuthModelsCalls ?? 0);
    expect(openAiOauthModelCalls).toBe(0);
  } finally {
    await closeApp(ctx);
  }
});

test('GitHub Copilot OAuth saves account catalog when model endpoint is unavailable', async () => {
  const ctx = await launchApp();

  try {
    await ctx.app.evaluate(() => {
      const json = (payload: unknown, init?: ResponseInit) => new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
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
          return json({
            token: 'copilot-api-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            endpoints: {
              api: 'https://api.githubcopilot.com',
            },
          });
        }
        if (url.includes('api.githubcopilot.com/models')) {
          const state = globalThis as typeof globalThis & { __rdcCopilotModelsFailureCalls?: number };
          state.__rdcCopilotModelsFailureCalls = (state.__rdcCopilotModelsFailureCalls ?? 0) + 1;
          return json({ error: 'models unavailable' }, { status: 503 });
        }
        return json({ error: 'not found' }, { status: 404 });
      };
    });
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();

    await ctx.page.locator('[data-testid="settings-provider-connect-github-copilot"]').click();
    await ctx.page.locator('[data-testid="settings-provider-oauth-start"]').click();
    await expect(ctx.page.locator('[data-testid="settings-provider-oauth-device-code"]')).toContainText('ABCD-1234');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-oauth-row-github-copilot"]')).toContainText('gpt-5.5');
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-error"]')).toHaveCount(0);

    const result = await ctx.page.evaluate(async () => {
      const settings = await window.electronAPI.settings.get();
      return settings.llm.providers.find((provider) => provider.id === 'github-copilot');
    });
    expect(result?.isConfigured).toBe(true);
    expect(result?.models.map((model) => model.id)).toEqual(expect.arrayContaining([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.3-codex',
      'claude-sonnet-4-6',
    ]));
    const modelCalls = await ctx.app.evaluate(() => (
      globalThis as typeof globalThis & { __rdcCopilotModelsFailureCalls?: number }
    ).__rdcCopilotModelsFailureCalls ?? 0);
    expect(modelCalls).toBeGreaterThanOrEqual(1);
  } finally {
    await closeApp(ctx);
  }
});

test('GitHub Copilot device flow keeps authorization pending as pending state', async () => {
  const ctx = await launchApp();

  try {
    await ctx.app.evaluate(() => {
      const json = (payload: unknown, init?: ResponseInit) => new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('github.com/login/device/code')) {
          return json({
            device_code: 'device-code',
            user_code: 'C959-FF59',
            verification_uri: 'https://github.com/login/device',
            expires_in: 900,
            interval: 1,
          });
        }
        if (url.includes('github.com/login/oauth/access_token')) {
          const state = globalThis as typeof globalThis & { __rdcGithubPendingPolls?: number };
          state.__rdcGithubPendingPolls = (state.__rdcGithubPendingPolls ?? 0) + 1;
          return json({ error: 'authorization_pending' });
        }
        return json({ error: 'not found' }, { status: 404 });
      };
    });
    await openSettings(ctx);
    await ctx.page.locator('[data-testid="settings-nav-models"]').click();
    await ctx.page.locator('[data-testid="settings-provider-connect-github-copilot"]').click();
    await ctx.page.locator('[data-testid="settings-provider-oauth-start"]').click();

    await expect(ctx.page.locator('[data-testid="settings-provider-connect-dialog"]')).toBeVisible();
    await expect(ctx.page.locator('[data-testid="settings-provider-oauth-device-code"]')).toContainText('C959-FF59');
    await expect(ctx.page.locator('.settings-provider-oauth-panel')).toContainText('https://github.com/login/device');
    await expect(ctx.page.locator('.settings-provider-oauth-panel')).toContainText(/Waiting for GitHub authorization|等待 GitHub 授权/);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-error"]')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-models"] .settings-model-row')).toHaveCount(0);
    await expect(ctx.page.locator('[data-testid="settings-provider-oauth-start"]')).toBeDisabled();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-test"]')).toBeDisabled();
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-save"]')).toBeDisabled();

    await ctx.page.waitForTimeout(1400);
    await expect(ctx.page.locator('[data-testid="settings-provider-connect-error"]')).toHaveCount(0);
    const pendingPolls = await ctx.app.evaluate(() => (
      globalThis as typeof globalThis & { __rdcGithubPendingPolls?: number }
    ).__rdcGithubPendingPolls ?? 0);
    expect(pendingPolls).toBeGreaterThanOrEqual(1);
    const settings = await ctx.page.evaluate(async () => window.electronAPI.settings.get());
    const copilot = settings.llm.providers.find((provider) => provider.id === 'github-copilot');
    expect(copilot?.isConfigured).toBe(false);
    expect(copilot?.models).toEqual([]);
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
