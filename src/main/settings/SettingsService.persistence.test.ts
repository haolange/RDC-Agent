import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  userDataRoot: '',
  encryptionAvailable: false,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.userDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => electronMock.encryptionAvailable,
    decryptString: () => {
      throw new Error('safeStorage unavailable');
    },
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
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
    electronMock.encryptionAvailable = false;
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
    const { createProviderEntryFromPreset } = await import('./ProviderPresetRegistry');
    const workspaceRoot = path.join(userDataRoot, '.rdx');
    const settingsPath = path.join(workspaceRoot, 'config.json');
    const provider = {
      ...createProviderEntryFromPreset('deepseek'),
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
      llm: {
        providers: [provider],
        agentRoutes: [
          {
            agentId: 'ask',
            providerId: 'deepseek',
            modelId: 'deepseek-v4-flash',
          },
        ],
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
        agentRoutes: Array<{ agentId: string; providerId: string; modelId: string }>;
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
    expect(persisted.llm.agentRoutes).toContainEqual({
      agentId: 'ask',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
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
        agentRoutes: Array<{ agentId: string; providerId: string; modelId: string }>;
      };
    };
    const persistedProvider = persisted.llm.providers.find((provider) => provider.id === 'deepseek');

    expect(persisted.appearance.theme).toBe('light');
    expect(persistedProvider).toMatchObject({
      isConfigured: true,
      status: 'verified',
      hasStoredSecret: true,
    });
    expect(persisted.llm.agentRoutes).toContainEqual({
      agentId: 'ask',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
  });

  it('migrates an existing API key to an account-keyed secret without losing it', async () => {
    const { settingsPath, workspaceRoot } = await createVerifiedPersistedSettings();
    const { secretStorageService } = await import('./SecretStorageService');
    secretStorageService.setSecret('provider-deepseek-api-key', 'sk-migrated', workspaceRoot);
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();

    const runtime = service.initialize();
    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      llm: { providers: Array<{ id: string; activeAccountId?: string; secretRef?: string }> };
    };
    const provider = persisted.llm.providers.find((entry) => entry.id === 'deepseek');

    expect(provider?.activeAccountId).toMatch(/^account-/);
    expect(provider?.secretRef).toContain('-account-');
    expect(secretStorageService.getSecret('provider-deepseek-api-key', workspaceRoot)).toBe('');
    expect(secretStorageService.getSecret(provider?.secretRef, workspaceRoot)).toBe('sk-migrated');
    expect(runtime.llm.providers.find((entry) => entry.id === 'deepseek')?.isConfigured).toBe(true);
  });

  it('migrates an encrypted secret record even when safeStorage is temporarily unavailable', async () => {
    const { settingsPath, workspaceRoot } = await createVerifiedPersistedSettings();
    const { secretStorageService } = await import('./SecretStorageService');
    electronMock.encryptionAvailable = true;
    const sourceRef = secretStorageService.createProviderSecretRef('deepseek');
    secretStorageService.setSecret(sourceRef, 'sk-encrypted', workspaceRoot);
    electronMock.encryptionAvailable = false;

    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const runtime = service.initialize();
    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      schemaVersion?: number;
      llm: { providers: Array<{ id: string; activeAccountId?: string; secretRef?: string }> };
    };
    const provider = persisted.llm.providers.find((entry) => entry.id === 'deepseek');

    expect(persisted.schemaVersion).toBe(2);
    expect(provider?.activeAccountId).toMatch(/^account-/);
    expect(provider?.secretRef).toContain('-account-');
    expect(secretStorageService.hasSecretRecord(sourceRef, workspaceRoot)).toBe(false);
    expect(secretStorageService.hasSecretRecord(provider?.secretRef, workspaceRoot)).toBe(true);
    expect(runtime.llm.providers.find((entry) => entry.id === 'deepseek')?.isConfigured).toBe(false);
  });

  it('migrates an OAuth bundle using its upstream account id', async () => {
    const { createProviderEntryFromPreset } = await import('./ProviderPresetRegistry');
    const { secretStorageService } = await import('./SecretStorageService');
    const workspaceRoot = path.join(userDataRoot, '.rdx');
    const settingsPath = path.join(workspaceRoot, 'config.json');
    const provider = {
      ...createProviderEntryFromPreset('chatgpt-account'),
      enabled: true,
      hasStoredSecret: true,
      isConfigured: true,
      status: 'verified' as const,
    };
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      llm: { providers: [provider], agentRoutes: [] },
    }), 'utf8');
    const bundle = JSON.stringify({ accessToken: 'oauth-token', accountId: 'acct-upstream' });
    const unkeyedRef = secretStorageService.createProviderOAuthSecretRef('chatgpt-account');
    secretStorageService.setSecret(unkeyedRef, bundle, workspaceRoot);

    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    service.initialize();
    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      llm: { providers: Array<{ id: string; activeAccountId?: string }> };
    };

    expect(persisted.llm.providers.find((entry) => entry.id === 'chatgpt-account')?.activeAccountId)
      .toBe('acct-upstream');
    expect(secretStorageService.getSecret(unkeyedRef, workspaceRoot)).toBe('');
    expect(service.getProviderOAuthSecret('chatgpt-account', workspaceRoot)).toBe(bundle);
  });

  it('never reactivates an unkeyed credential after the canonical schema marker is committed', async () => {
    const { createProviderEntryFromPreset } = await import('./ProviderPresetRegistry');
    const { secretStorageService } = await import('./SecretStorageService');
    const workspaceRoot = path.join(userDataRoot, '.rdx');
    const settingsPath = path.join(workspaceRoot, 'config.json');
    const provider = {
      ...createProviderEntryFromPreset('chatgpt-account'),
      enabled: true,
      hasStoredSecret: true,
      isConfigured: true,
      status: 'verified' as const,
    };
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      schemaVersion: 2,
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

  it('removes a stale dynamic Super Grok catalog when no account credential exists', async () => {
    const { createProviderEntryFromPreset } = await import('./ProviderPresetRegistry');
    const workspaceRoot = path.join(userDataRoot, '.rdx');
    const settingsPath = path.join(workspaceRoot, 'config.json');
    const provider = {
      ...createProviderEntryFromPreset('grok-account'),
      models: [{ id: 'grok-4.5', label: 'Grok 4.5', enabled: true }],
      hasStoredSecret: false,
      hasStoredSecretByAuthMode: { account: false },
      status: 'unconfigured' as const,
      isConfigured: false,
    };
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      schemaVersion: 2,
      llm: { providers: [provider], agentRoutes: [] },
    }), 'utf8');

    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const runtime = service.initialize();
    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      llm: { providers: Array<{ id: string; models: unknown[] }> };
    };

    expect(runtime.llm.providers.find((entry) => entry.id === 'grok-account')?.models).toEqual([]);
    expect(persisted.llm.providers.find((entry) => entry.id === 'grok-account')?.models).toEqual([]);
  });

  it('retains a live Super Grok catalog while its account credential is connected', async () => {
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

    expect(service.getAll().llm.providers.find((entry) => entry.id === 'grok-account')).toMatchObject({
      isConfigured: true,
      models: [{ id: 'grok-composer-2.5-fast', label: 'Composer 2.5', enabled: true }],
    });
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
    const { getProviderSeedModels } = await import('./ProviderPresetRegistry');
    const service = new SettingsService();
    const settings = service.initialize();
    const models = getProviderSeedModels('chatgpt-account').slice(0, 2);
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

  it('preserves only the verified Volc Coding Plan model subset after saving and reloading', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    service.initialize();

    service.saveProviderConnection('volcengine-coding-plan', 'test-key', [
      { id: 'doubao-seed-2.0-code', label: 'Doubao Seed 2.0 Code', enabled: true, availability: 'available' },
      { id: 'glm-4.7', label: 'GLM 4.7', enabled: true, availability: 'available' },
    ]);

    const reloaded = service.getAll();
    expect(reloaded.llm.providers
      .find((provider) => provider.id === 'volcengine-coding-plan')
      ?.models.map((model) => model.id)).toEqual(['doubao-seed-2.0-code', 'glm-4.7']);
  });

  it('persists user-owned model preferences and preserves them across discovery refresh', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { getProviderSeedModels } = await import('./ProviderPresetRegistry');
    const service = new SettingsService();
    service.initialize();
    const discovered = getProviderSeedModels('deepseek');
    const target = discovered[0];
    expect(target).toBeDefined();

    service.saveProviderConnection(
      'deepseek', 'test-key', discovered, '', undefined, undefined,
      [{
        id: target!.id,
        enabled: false,
        defaultReasoningSelection: 'high',
        defaultBudgetTokens: 180_000,
      }],
    );
    expect(service.getAll().llm.providers.find((provider) => provider.id === 'deepseek')
      ?.models.find((model) => model.id === target!.id)).toMatchObject({
        enabled: false,
        defaultReasoningSelection: 'high',
        defaultBudgetTokens: 180_000,
      });

    service.saveProviderConnection('deepseek', '', discovered);
    expect(service.getAll().llm.providers.find((provider) => provider.id === 'deepseek')
      ?.models.find((model) => model.id === target!.id)).toMatchObject({
        enabled: false,
        defaultReasoningSelection: 'high',
        defaultBudgetTokens: 180_000,
      });
  });

  it('preserves an invalid Volc route id so Settings can require an explicit reselection', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    service.initialize();
    service.saveProviderConnection('volcengine-coding-plan', 'test-key', [
      { id: 'glm-4.7', label: 'GLM 4.7', enabled: true, availability: 'available' },
    ]);

    service.setAll({
      llm: {
        agentRoutes: [{ agentId: 'ask', providerId: 'volcengine-coding-plan', modelId: 'glm-5.2' }],
      },
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
    service.initialize();
    service.setAll({
      llm: {
        agentRoutes: [{ agentId: 'ask', providerId: 'missing-provider', modelId: 'missing-model' }],
      },
    });
    expect(service.getAll().llm.agentRoutes).toContainEqual({
      agentId: 'ask', providerId: 'missing-provider', modelId: 'missing-model',
    });
  });

  it('saves one agent definition without a full settings rewrite and rejects stale revisions', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const initialized = service.initialize();
    const ask = initialized.agents.definitions.find((definition) => definition.id === 'ask');
    expect(ask).toBeDefined();
    const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...draft } = ask!;

    const first = service.saveAgentDefinition({
      draft: { ...draft, models: ['deepseek:model-a'] },
      clientRevision: 100,
    });
    expect(first).toMatchObject({
      applied: true,
      clientRevision: 100,
      route: { agentId: 'ask', providerId: 'deepseek', modelId: 'model-a' },
    });

    const newest = service.saveAgentDefinition({
      draft: { ...draft, models: ['deepseek:model-c'] },
      clientRevision: 300,
    });
    const stale = service.saveAgentDefinition({
      draft: { ...draft, models: ['deepseek:model-b'] },
      clientRevision: 200,
    });
    expect(newest.applied).toBe(true);
    expect(stale.applied).toBe(false);
    expect(service.getAll().llm.agentRoutes).toContainEqual({
      agentId: 'ask', providerId: 'deepseek', modelId: 'model-c',
    });
    const saved = service.getAll().agents.definitions.find((definition) => definition.id === 'ask');
    expect(saved?.models).toEqual(['deepseek:model-c']);
    expect(fs.readdirSync(initialized.paths.agentsPath).some((entry) => entry.endsWith('.tmp'))).toBe(false);
  });
});
