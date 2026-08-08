import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  userDataRoot: '',
  encryptionAvailable: true,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.userDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => electronMock.encryptionAvailable,
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString('utf8');
      if (!text.startsWith('enc:')) {
        throw new Error('safeStorage unavailable');
      }
      return text.slice(4);
    },
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
  },
}));

describe('SettingsService provider persistence', () => {
  let userDataRoot = '';
  let previousUserDataEnv: string | undefined;
  let previousRdxHomeEnv: string | undefined;

  beforeEach(() => {
    previousUserDataEnv = process.env.RDC_AGENT_USER_DATA;
    previousRdxHomeEnv = process.env.RDC_AGENT_HOME;
    userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-settings-'));
    process.env.RDC_AGENT_USER_DATA = userDataRoot;
    process.env.RDC_AGENT_HOME = path.join(userDataRoot, '.rdx');
    electronMock.userDataRoot = userDataRoot;
    electronMock.encryptionAvailable = true;
    vi.resetModules();
  });

  afterEach(() => {
    if (previousUserDataEnv === undefined) {
      delete process.env.RDC_AGENT_USER_DATA;
    } else {
      process.env.RDC_AGENT_USER_DATA = previousUserDataEnv;
    }
    if (previousRdxHomeEnv === undefined) {
      delete process.env.RDC_AGENT_HOME;
    } else {
      process.env.RDC_AGENT_HOME = previousRdxHomeEnv;
    }
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  });

  async function createVerifiedPersistedSettings(): Promise<{
    settingsPath: string;
    workspaceRoot: string;
  }> {
    const { createProviderEntryFromCatalog } = await import('../provider-catalog/ProviderCatalogRegistry');
    const workspaceRoot = path.join(userDataRoot, '.rdx');
    const settingsPath = path.join(workspaceRoot, 'config.json');
    const provider = {
      ...createProviderEntryFromCatalog('deepseek'),
      enabled: true,
      hasStoredSecret: true,
      isConfigured: true,
      secretRef: 'provider-deepseek-api-key',
      status: 'verified' as const,
      models: [
        {
          id: 'deepseek-v4-flash',
          label: 'DeepSeek V4 Flash',
          enabled: true,
        },
      ],
    };

    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      schemaVersion: 4,
      llm: {
        providers: [provider],
      },
    }, null, 2), 'utf8');

    return { settingsPath, workspaceRoot };
  }

  it('keeps persisted provider metadata during startup rebuild when secrets are temporarily unavailable', async () => {
    const { settingsPath } = await createVerifiedPersistedSettings();
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();

    const runtime = service.initialize();
    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      llm: {
        providers: Array<{ id: string; isConfigured: boolean; status: string; hasStoredSecret: boolean }>;
      };
    };

    const runtimeProvider = runtime.llm.providers.find((provider) => provider.id === 'deepseek');
    const persistedProvider = persisted.llm.providers.find((provider) => provider.id === 'deepseek');

    expect(runtimeProvider?.isConfigured).toBe(false);
    expect(persistedProvider).toMatchObject({
      isConfigured: true,
      status: 'verified',
      hasStoredSecret: true,
    });
    expect(persisted.llm).not.toHaveProperty('agentRoutes');
  });

  it('does not persist credential demotion when saving an unrelated settings patch', async () => {
    const { settingsPath } = await createVerifiedPersistedSettings();
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();

    service.initialize();
    service.setAll({ appearance: { theme: 'light' } });

    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      appearance: { theme: string };
      llm: {
        providers: Array<{ id: string; isConfigured: boolean; status: string; hasStoredSecret: boolean }>;
      };
    };
    const persistedProvider = persisted.llm.providers.find((provider) => provider.id === 'deepseek');

    expect(persisted.appearance.theme).toBe('light');
    expect(persistedProvider).toMatchObject({
      isConfigured: true,
      status: 'verified',
      hasStoredSecret: true,
    });
    expect(persisted.llm).not.toHaveProperty('agentRoutes');
  });

  it('invalidates the removed persisted agentRoutes field instead of using it as a fallback', async () => {
    const workspaceRoot = path.join(userDataRoot, '.rdx');
    const settingsPath = path.join(workspaceRoot, 'config.json');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      schemaVersion: 2,
      llm: {
        providers: [],
        agentRoutes: [{ agentId: 'ask', providerId: 'retired-provider', modelId: 'retired-model' }],
      },
    }), 'utf8');
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();

    const runtime = service.initialize();
    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { llm: Record<string, unknown> };

    expect(runtime.llm.agentRoutes.find((route) => route.agentId === 'ask')).toMatchObject({
      providerId: '',
      modelId: '',
    });
    expect(persisted.llm).not.toHaveProperty('agentRoutes');
  });

  it('never imports an unkeyed credential after the single-schema cutover', async () => {
    const { createProviderEntryFromCatalog } = await import('../provider-catalog/ProviderCatalogRegistry');
    const { secretStorageService } = await import('./SecretStorageService');
    const workspaceRoot = path.join(userDataRoot, '.rdx');
    const settingsPath = path.join(workspaceRoot, 'config.json');
    const provider = {
      ...createProviderEntryFromCatalog('chatgpt-account'),
      enabled: true,
      hasStoredSecret: true,
      isConfigured: true,
      status: 'verified' as const,
    };
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      schemaVersion: 4,
      llm: { providers: [provider], agentRoutes: [] },
    }), 'utf8');
    const unkeyedRef = secretStorageService.createProviderOAuthSecretRef('chatgpt-account');
    secretStorageService.setSecret(unkeyedRef, JSON.stringify({ accessToken: 'unkeyed' }), workspaceRoot);

    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const runtime = service.initialize();

    expect(runtime.llm.providers.find((entry) => entry.id === 'chatgpt-account')).toMatchObject({
      activeAccountId: undefined,
      hasStoredSecret: false,
      isConfigured: false,
    });
    expect(service.getProviderOAuthSecret('chatgpt-account', workspaceRoot)).toBe('');
    expect(secretStorageService.hasSecret(unkeyedRef, workspaceRoot)).toBe(true);
  });

  it('restores the maintained Super Grok structure when no account credential exists', async () => {
    const { createProviderEntryFromCatalog } = await import('../provider-catalog/ProviderCatalogRegistry');
    const workspaceRoot = path.join(userDataRoot, '.rdx');
    const settingsPath = path.join(workspaceRoot, 'config.json');
    const provider = {
      ...createProviderEntryFromCatalog('grok-account'),
      models: [
        { id: 'grok-4.5', label: 'Grok 4.5', enabled: true },
        { id: 'grok-composer-2.5-fast', label: 'Composer 2.5', enabled: true },
      ],
      hasStoredSecret: false,
      hasStoredSecretByAuthMode: { account: false },
      status: 'unconfigured' as const,
      isConfigured: false,
    };
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      schemaVersion: 4,
      llm: { providers: [provider], agentRoutes: [] },
    }), 'utf8');

    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const runtime = service.initialize();
    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      llm: { providers: Array<{ id: string; models: unknown[] }> };
    };

    const expectedIds = [
      'grok-4.20-0309-non-reasoning',
      'grok-4.20-0309-reasoning',
      'grok-4.20-multi-agent-0309',
      'grok-4.3',
      'grok-4.5',
      'grok-build-0.1',
    ];
    expect(runtime.llm.providers.find((entry) => entry.id === 'grok-account')?.models.map((model) => model.id))
      .toEqual(expectedIds);
    expect(persisted.llm.providers.find((entry) => entry.id === 'grok-account')?.models)
      .toEqual(expect.arrayContaining(expectedIds.map((id) => expect.objectContaining({ id }))));
  });

  it('keeps structural Super Grok facts and appends admitted live account models', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    service.initialize();
    service.saveProviderAccountConnection(
      'grok-account',
      JSON.stringify({ providerId: 'grok-account', accountId: 'grok-user', accessToken: 'oauth-token' }),
      [
        { id: 'grok-composer-2.5-fast', label: 'Composer 2.5', enabled: true },
        { id: 'grok-imagine-video-1.5', label: 'Grok Imagine Video', enabled: true },
      ],
    );

    const connected = service.getAll().llm.providers.find((entry) => entry.id === 'grok-account');
    expect(connected).toMatchObject({ isConfigured: true });
    expect(connected?.models.map((model) => model.id)).toEqual([
      'grok-4.20-0309-non-reasoning',
      'grok-4.20-0309-reasoning',
      'grok-4.20-multi-agent-0309',
      'grok-4.3',
      'grok-4.5',
      'grok-build-0.1',
      'grok-composer-2.5-fast',
    ]);
    expect(connected?.models.some((model) => model.id === 'grok-imagine-video-1.5')).toBe(false);
  });

  it('stages account-keyed secrets without deleting the source before settings commit', async () => {
    const { secretStorageService } = await import('./SecretStorageService');
    const workspaceRoot = path.join(userDataRoot, '.rdx');
    const sourceRef = secretStorageService.createProviderSecretRef('deepseek');
    const targetRef = secretStorageService.createProviderAccountSecretRef('deepseek', 'account-staged', 'api-key');
    secretStorageService.setSecret(sourceRef, 'sk-staged', workspaceRoot);

    expect(secretStorageService.copySecret(sourceRef, targetRef, workspaceRoot)).toBe(true);
    expect(secretStorageService.hasSecret(sourceRef, workspaceRoot)).toBe(true);
    expect(secretStorageService.hasSecret(targetRef, workspaceRoot)).toBe(true);
  });

  it('atomically rotates account tokens without replacing the current model catalog', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { secretStorageService } = await import('./SecretStorageService');
    const { getProviderModelSummaries } = await import('../provider-catalog/ProviderCatalogRegistry');
    const service = new SettingsService();
    const settings = service.initialize();
    const models = getProviderModelSummaries('chatgpt-account').slice(0, 2);
    service.saveProviderAccountConnection(
      'chatgpt-account',
      JSON.stringify({ providerId: 'chatgpt-account', accountId: 'acct-rotate', accessToken: 'old', refreshToken: 'refresh-old' }),
      models,
    );
    const modelIdsBeforeRotation = service.getAll().llm.providers
      .find((entry) => entry.id === 'chatgpt-account')?.models.map((model) => model.id);

    service.rotateProviderAccountCredential(
      'chatgpt-account',
      JSON.stringify({ providerId: 'chatgpt-account', accountId: 'acct-rotate', accessToken: 'new', refreshToken: 'refresh-new' }),
      { oauthExpiresAt: '2026-07-13T01:00:00.000Z', oauthRefreshAvailable: true },
    );

    const provider = service.getAll().llm.providers.find((entry) => entry.id === 'chatgpt-account');
    const secretRef = secretStorageService.createProviderAccountSecretRef('chatgpt-account', 'acct-rotate', 'oauth');
    expect(provider?.models.map((model) => model.id)).toEqual(modelIdsBeforeRotation);
    expect(JSON.parse(secretStorageService.getSecret(secretRef, settings.paths.userRdxRoot)) as { refreshToken: string })
      .toMatchObject({ refreshToken: 'refresh-new' });
  });

  it('keeps maintained Volc Coding Plan rows and their explicit catalog denials when candidate validation returns a subset', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { getProviderModelSummaries } = await import('../provider-catalog/ProviderCatalogRegistry');
    const service = new SettingsService();
    service.initialize();

    service.saveProviderConnection('volcengine-coding-plan', 'test-key', [
      { id: 'doubao-seed-2.0-code', label: 'Doubao Seed 2.0 Code', enabled: true, availability: 'available' },
      { id: 'glm-4.7', label: 'GLM 4.7', enabled: true, availability: 'available' },
      { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', enabled: true, availability: 'available' },
    ]);

    const reloaded = service.getAll();
    const models = reloaded.llm.providers
      .find((provider) => provider.id === 'volcengine-coding-plan')?.models ?? [];
    expect(models.map((model) => model.id))
      .toEqual(getProviderModelSummaries('volcengine-coding-plan').map((model) => model.id));
    expect(models.find((model) => model.id === 'doubao-seed-2.0-code')?.availability).toBe('available');
    expect(models.find((model) => model.id === 'glm-4.7')).toMatchObject({
      availability: 'unavailable',
      availabilityReason: expect.stringContaining('does not support the Coding Plan feature'),
    });
    expect(models.find((model) => model.id === 'kimi-k2.7-code')).toMatchObject({
      availability: 'unavailable',
      availabilityReason: expect.stringContaining('user-observed'),
    });
  });

  it('drops undeclared Kimi rows under strict authoritative discovery', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    service.initialize();

    service.saveProviderConnection('kimi-coding-plan', 'test-key', [
      { id: 'kimi-for-coding', label: 'kimi-for-coding', enabled: true, availability: 'available' },
      { id: 'kimi-for-coding-highspeed', label: 'kimi-for-coding-highspeed', enabled: true, availability: 'available' },
      { id: 'k2p7', label: 'Kimi K2.7 Code', enabled: true, availability: 'available' },
      { id: 'k2p6', label: 'Kimi K2.6', enabled: true, availability: 'available' },
      { id: 'k2p5', label: 'Kimi K2.5', enabled: true, availability: 'available' },
      { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking', enabled: true, availability: 'available' },
    ]);

    const provider = service.getAll().llm.providers.find((entry) => entry.id === 'kimi-coding-plan');
    expect(provider?.models.map((model) => model.id)).toEqual(['kimi-for-coding']);
    expect(provider?.recommendedModels).toEqual(['kimi-for-coding']);
  });

  it('persists exact live Kimi K3 without persisting the internal HighSpeed target', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    service.initialize();

    service.saveProviderConnection('kimi-coding-plan', 'test-key', [
      { id: 'kimi-for-coding', label: 'Kimi for Coding', enabled: true, availability: 'available' },
      { id: 'k3', label: 'Kimi K3', enabled: true, availability: 'available' },
      { id: 'kimi-for-coding-highspeed', label: 'Kimi for Coding HighSpeed', enabled: true, availability: 'available' },
    ]);

    const provider = service.getAll().llm.providers.find((entry) => entry.id === 'kimi-coding-plan');
    expect(provider?.models.map((model) => model.id)).toEqual(['kimi-for-coding', 'k3']);
    expect(provider?.models.find((model) => model.id === 'k3')).toMatchObject({
      label: 'Kimi K3',
      availability: 'available',
    });
  });
  it('persists user-owned model preferences and preserves them across discovery refresh', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { getProviderModelSummaries } = await import('../provider-catalog/ProviderCatalogRegistry');
    const service = new SettingsService();
    service.initialize();
    const discovered = getProviderModelSummaries('deepseek');
    const target = discovered[0];
    expect(target).toBeDefined();

    service.saveProviderConnection(
      'deepseek', 'test-key', discovered, '', undefined, undefined,
      [{
        id: target!.id,
        enabled: false,
        defaultReasoningSelection: 'high',
        defaultBudgetTokens: 180_000,
        preferredRouteOptionId: 'OpenAICompatibleChatCompletions',
      }],
    );
    expect(service.getAll().llm.providers.find((provider) => provider.id === 'deepseek')
      ?.models.find((model) => model.id === target!.id)).toMatchObject({
        enabled: false,
        defaultReasoningSelection: 'high',
        defaultBudgetTokens: 180_000,
        preferredRouteOptionId: 'OpenAICompatibleChatCompletions',
      });

    service.saveProviderConnection('deepseek', '', discovered);
    expect(service.getAll().llm.providers.find((provider) => provider.id === 'deepseek')
      ?.models.find((model) => model.id === target!.id)).toMatchObject({
        enabled: false,
        defaultReasoningSelection: 'high',
        defaultBudgetTokens: 180_000,
        preferredRouteOptionId: 'OpenAICompatibleChatCompletions',
      });
  });

  it('atomically persists an unconfigured provider model route preference', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const initialized = service.initialize();
    const provider = initialized.llm.providers.find((entry) => entry.id === 'longcat');
    expect(provider).toBeDefined();

    const result = await service.saveProviderDefinition({
      provider: {
        ...provider!,
        models: provider!.models.map((model) => model.id === 'LongCat-2.0'
          ? { ...model, preferredRouteOptionId: 'AnthropicMessages' }
          : model),
      },
      clientRevision: 1,
    });

    expect(result.status).toBe('committed');
    expect(service.getAll().llm.providers.find((entry) => entry.id === 'longcat')
      ?.models.find((model) => model.id === 'LongCat-2.0')?.preferredRouteOptionId)
      .toBe('AnthropicMessages');
  });

  it('preserves an invalid Volc route id so Settings can require an explicit reselection', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const initialized = service.initialize();
    service.saveProviderConnection('volcengine-coding-plan', 'test-key', [
      { id: 'glm-4.7', label: 'GLM 4.7', enabled: true, availability: 'available' },
    ]);

    const ask = initialized.agents.definitions.find((definition) => definition.id === 'ask');
    expect(ask).toBeDefined();
    const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...draft } = ask!;
    await service.saveAgentDefinition({
      draft: { ...draft, models: ['volcengine-coding-plan:glm-5.2'] },
      clientRevision: 1,
    });

    expect(service.getAll().llm.agentRoutes).toContainEqual({
      agentId: 'ask',
      providerId: 'volcengine-coding-plan',
      modelId: 'glm-5.2',
    });
  });

  it('switches OpenRouter auth modes without deleting the inactive credential', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { secretStorageService } = await import('./SecretStorageService');
    const service = new SettingsService();
    const initialized = service.initialize();
    const models = [{ id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', enabled: true }];

    service.saveProviderConnection(
      'openrouter', 'sk-or-api-key', models, 'https://openrouter.ai/api/v1',
      'OpenRouterChatCompletions', 'api-key',
    );
    const apiProvider = service.getAll().llm.providers.find((entry) => entry.id === 'openrouter');
    const apiSecretRef = apiProvider?.secretRef;
    expect(apiProvider).toMatchObject({
      authMode: 'api-key', configuredAuthMode: 'api-key',
      hasStoredSecretByAuthMode: { 'api-key': true, account: false },
    });

    service.saveProviderAccountConnection(
      'openrouter',
      JSON.stringify({ providerId: 'openrouter', accountId: 'or-user', apiKey: 'sk-or-oauth' }),
      models,
    );
    const accountProvider = service.getAll().llm.providers.find((entry) => entry.id === 'openrouter');
    expect(accountProvider).toMatchObject({
      authMode: 'account', configuredAuthMode: 'account', activeAccountId: 'or-user',
      hasStoredSecretByAuthMode: { 'api-key': true, account: true },
      secretRef: apiSecretRef,
    });
    expect(service.getProviderSecret('openrouter')).toBe('sk-or-api-key');

    service.disconnectProvider('openrouter', 'account');
    expect(service.getProviderOAuthSecret('openrouter')).toBe('');
    expect(secretStorageService.getSecret(apiSecretRef, initialized.paths.userRdxRoot)).toBe('sk-or-api-key');
    service.saveProviderConnection(
      'openrouter', '', models, 'https://openrouter.ai/api/v1',
      'OpenRouterChatCompletions', 'api-key',
    );
    expect(service.getAll().llm.providers.find((entry) => entry.id === 'openrouter')).toMatchObject({
      authMode: 'api-key', configuredAuthMode: 'api-key', isConfigured: true,
      hasStoredSecretByAuthMode: { 'api-key': true, account: false },
    });
  });

  it('preserves invalid routes so model removal requires explicit reselection', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const initialized = service.initialize();
    const ask = initialized.agents.definitions.find((definition) => definition.id === 'ask');
    expect(ask).toBeDefined();
    const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...draft } = ask!;
    await service.saveAgentDefinition({
      draft: { ...draft, models: ['missing-provider:missing-model'] },
      clientRevision: 1,
    });
    expect(service.getAll().llm.agentRoutes).toContainEqual({
      agentId: 'ask', providerId: 'missing-provider', modelId: 'missing-model',
    });
  });

  it('coalesces A -> B -> C so only C is committed and settings never mirrors the route', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const initialized = service.initialize();
    const ask = initialized.agents.definitions.find((definition) => definition.id === 'ask');
    expect(ask).toBeDefined();
    const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...draft } = ask!;
    const settingsBeforeSave = fs.readFileSync(initialized.paths.settingsPath, 'utf8');

    const first = service.saveAgentDefinition({
      draft: { ...draft, models: ['deepseek:model-a'] },
      clientRevision: 100,
    });
    const middle = service.saveAgentDefinition({
      draft: { ...draft, models: ['deepseek:model-b'] },
      clientRevision: 200,
    });
    const newest = service.saveAgentDefinition({
      draft: { ...draft, models: ['deepseek:model-c'] },
      clientRevision: 300,
    });
    const [firstResult, middleResult, newestResult] = await Promise.all([first, middle, newest]);
    expect(firstResult.status).toBe('superseded');
    expect(middleResult.status).toBe('superseded');
    expect(newestResult).toMatchObject({
      status: 'committed',
      clientRevision: 300,
      route: { agentId: 'ask', providerId: 'deepseek', modelId: 'model-c' },
    });
    expect(newestResult.commitHash).toMatch(/^[a-f0-9]{64}$/);
    expect(newestResult.lastSuccessful?.commitHash).toBe(newestResult.commitHash);
    expect(service.getAll().llm.agentRoutes).toContainEqual({
      agentId: 'ask', providerId: 'deepseek', modelId: 'model-c',
    });
    const saved = service.getAll().agents.definitions.find((definition) => definition.id === 'ask');
    expect(saved?.models).toEqual(['deepseek:model-c']);
    expect(fs.readdirSync(initialized.paths.agentsPath).some((entry) => entry.endsWith('.tmp'))).toBe(false);
    const persisted = JSON.parse(fs.readFileSync(initialized.paths.settingsPath, 'utf8')) as { llm: Record<string, unknown> };
    expect(persisted.llm).not.toHaveProperty('agentRoutes');
    expect(fs.readFileSync(initialized.paths.settingsPath, 'utf8')).toBe(settingsBeforeSave);
  });

  it('returns the last successful snapshot when the latest manifest commit fails', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { agentManifestService } = await import('./AgentManifestService');
    const service = new SettingsService();
    const initialized = service.initialize();
    const ask = initialized.agents.definitions.find((definition) => definition.id === 'ask');
    expect(ask).toBeDefined();
    const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...draft } = ask!;
    const committed = await service.saveAgentDefinition({
      draft: { ...draft, models: ['deepseek:model-c'] },
      clientRevision: 300,
    });
    const saveSpy = vi.spyOn(agentManifestService, 'saveDefinition')
      .mockRejectedValueOnce(new Error('simulated atomic rename failure'));

    const failed = await service.saveAgentDefinition({
      draft: { ...draft, models: ['deepseek:model-d'] },
      clientRevision: 400,
    });

    expect(failed).toMatchObject({
      status: 'failed',
      error: 'simulated atomic rename failure',
      commitHash: committed.commitHash,
      route: { agentId: 'ask', providerId: 'deepseek', modelId: 'model-c' },
    });
    expect(failed.lastSuccessful?.commitHash).toBe(committed.commitHash);
    expect(service.getAll().agents.definitions.find((definition) => definition.id === 'ask')?.models)
      .toEqual(['deepseek:model-c']);
    saveSpy.mockRestore();
  });

  it('persistWindowLayout patches only layout.window without touching llm providers', async () => {
    const { settingsPath } = await createVerifiedPersistedSettings();
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    service.initialize();

    const before = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      llm: { providers: unknown[] };
      layout?: { window?: unknown };
    };
    const providersBefore = JSON.stringify(before.llm.providers);

    service.persistWindowLayout({
      width: 1440,
      height: 900,
      x: 120,
      y: 80,
      isMaximized: false,
    });

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      llm: { providers: unknown[] };
      layout: { window: { width: number; height: number; x: number; y: number; isMaximized: boolean } };
    };

    expect(JSON.stringify(after.llm.providers)).toBe(providersBefore);
    expect(after.layout.window).toEqual({
      width: 1440,
      height: 900,
      x: 120,
      y: 80,
      isMaximized: false,
    });
  });

  it('persistWindowLayoutAsync patches only layout.window without touching llm providers', async () => {
    const { settingsPath } = await createVerifiedPersistedSettings();
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    service.initialize();

    const before = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      llm: { providers: unknown[] };
    };
    const providersBefore = JSON.stringify(before.llm.providers);

    await service.persistWindowLayoutAsync({
      width: 1600,
      height: 1000,
      x: 10,
      y: 20,
      isMaximized: true,
    });

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      llm: { providers: unknown[] };
      layout: { window: { width: number; height: number; x: number; y: number; isMaximized: boolean } };
    };

    expect(JSON.stringify(after.llm.providers)).toBe(providersBefore);
    expect(after.layout.window).toEqual({
      width: 1600,
      height: 1000,
      x: 10,
      y: 20,
      isMaximized: true,
    });
  });

  it('schema 6 upgrade irreversibly resets chromeThemes to RDC defaults', async () => {
    const { createDefaultChromeThemes } = await import('../../shared/theme/presets');
    const workspaceRoot = path.join(userDataRoot, '.rdx');
    const settingsPath = path.join(workspaceRoot, 'config.json');
    const polluted = {
      ...createDefaultChromeThemes().dark,
      accent: '#ff0000',
      surface: '#112233',
      ink: '#abcdef',
      presetId: 'dracula',
    };
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      schemaVersion: 5,
      appearance: {
        theme: 'dark',
        chromeThemes: {
          light: polluted,
          dark: polluted,
        },
      },
      llm: { providers: [] },
    }, null, 2), 'utf8');

    const { SettingsService, SETTINGS_SCHEMA_VERSION } = await import('./SettingsService');
    const service = new SettingsService();
    const runtime = service.initialize();
    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      schemaVersion: number;
      appearance: { chromeThemes: { light: { accent: string; presetId: string }; dark: { accent: string; presetId: string } } };
    };
    const defaults = createDefaultChromeThemes();

    expect(SETTINGS_SCHEMA_VERSION).toBe(6);
    expect(persisted.schemaVersion).toBe(6);
    expect(runtime.appearance.chromeThemes.dark.accent).toBe(defaults.dark.accent);
    expect(runtime.appearance.chromeThemes.dark.presetId).toBe('rdc');
    expect(persisted.appearance.chromeThemes.dark.accent).toBe(defaults.dark.accent);
    expect(persisted.appearance.chromeThemes.light.presetId).toBe('rdc');
    expect(persisted.appearance.chromeThemes.dark.accent).not.toBe('#ff0000');
  });
});
