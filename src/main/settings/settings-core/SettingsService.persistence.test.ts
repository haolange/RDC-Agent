import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE, DEFAULT_LAYOUT } from '@shared/constants/appSettingsDefaults';
import { providerConnectionIdentity } from '@shared/utils/providerConnectionIdentity';
import { isolateHome } from '../../testing/isolatedHome';
import type {
  SettingsView,
  LlmProviderEntry,
  LlmProviderModel,
  ProviderDefinitionSaveRequest,
} from '@shared/types/settings';

/** A model-choice save for `provider` as the renderer sends it. */
const modelChoices = (
  provider: LlmProviderEntry,
  models: LlmProviderModel[],
  clientRevision: number,
): ProviderDefinitionSaveRequest => ({
  providerId: provider.id,
  connectionIdentity: providerConnectionIdentity(provider),
  models,
  clientRevision,
});

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
    getSelectedStorageBackend: () => 'gnome_libsecret',
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
  let restoreHome: () => void = () => undefined;

  beforeEach(() => {
    previousUserDataEnv = process.env.RDC_AGENT_USER_DATA;
    userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-settings-'));
    process.env.RDC_AGENT_USER_DATA = userDataRoot;
    restoreHome = isolateHome(userDataRoot);
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
    restoreHome();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  });

  const settingsPathFor = () => path.join(userDataRoot, '.rdc-agent', 'config.json');

  /** Starts a service and returns the settings view the renderer would receive. */
  const started = (service: { initialize(): unknown; settingsView(): SettingsView }): SettingsView => {
    service.initialize();
    return service.settingsView();
  };

  /** Writes a v9 settings file whose sections are the defaults, with the given overrides. */
  async function writeSettingsFixture(overrides: Record<string, unknown> = {}): Promise<string> {
    const { createDefaultSettingsFile } = await import('./settingsDefaults');
    const settingsPath = settingsPathFor();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ ...createDefaultSettingsFile(), ...overrides }), 'utf8');
    return settingsPath;
  }

  /** DeepSeek connected with an API key account whose secret is not in the secret store. */
  async function createVerifiedPersistedSettings(): Promise<{ settingsPath: string }> {
    const settingsPath = await writeSettingsFixture({
      providers: {
        deepseek: {
          authMode: 'api-key',
          authAccountIds: { 'api-key': 'account-stored' },
          configuredAuthMode: 'api-key',
          lastTestedAt: '2026-11-01T00:00:00.000Z',
          models: { 'deepseek-flash': {} },
        },
      },
    });
    return { settingsPath };
  }

  it('publishes permission mode only after durable settings commit and survives notification failures', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { runtimePermissionStateService } = await import('../../runtime/RuntimePermissionStateService');
    const service = new SettingsService();
    service.initialize();
    const before = runtimePermissionStateService.getSnapshot();
    const notifications = vi.fn();
    const stop = runtimePermissionStateService.subscribe(notifications);
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('permission commit failed');
    });
    try {
      expect(() => service.update([{ op: 'agentRuntime', value: { permissions: { mode: 'full-access' } } }])).toThrow(
        'permission commit failed',
      );
      expect(runtimePermissionStateService.getSnapshot()).toBe(before);
      expect(notifications).not.toHaveBeenCalled();
    } finally {
      rename.mockRestore();
    }
    const stopBroken = runtimePermissionStateService.subscribe(() => {
      throw new Error('notification failed');
    });
    try {
      expect(
        service.update([{ op: 'agentRuntime', value: { permissions: { mode: 'full-access' } } }]).changed.agentRuntime
          ?.permissions.mode,
      ).toBe('full-access');
      expect(runtimePermissionStateService.getSnapshot()).toEqual({
        mode: 'full-access',
        revision: before.revision + 1,
      });
      expect(notifications).toHaveBeenCalledOnce();
      expect(service.settingsView().agentRuntime.permissions.mode).toBe('full-access');
    } finally {
      stop();
      stopBroken();
    }
  });

  it('sends connection state without catalog facts, and the catalog joins it back into the composed entries', async () => {
    await createVerifiedPersistedSettings();
    const { SettingsService } = await import('./SettingsService');
    const { joinProviderEntry } = await import('@shared/utils/providerEntryView');
    const { LLM_PROVIDER_CATALOG_FIELDS } = await import('@shared/types/settings');
    const service = new SettingsService();
    const view = started(service);
    const catalog = new Map(service.getProviderCatalog().providers.map((entry) => [entry.id, entry]));
    expect(view.llm.connections.map((state) => joinProviderEntry(catalog.get(state.id)!, state))).toEqual(
      service.providerConnections.list(),
    );
    for (const state of view.llm.connections) {
      for (const field of LLM_PROVIDER_CATALOG_FIELDS) expect(state).not.toHaveProperty(field);
    }
    expect(view).toMatchObject({ revision: service.snapshot().revision, agents: { projectId: null } });
    expect(view.agents).not.toHaveProperty('modelOptions');
  });

  it('reads a configured provider without its secret as unconfigured and writes nothing at startup', async () => {
    const { settingsPath } = await createVerifiedPersistedSettings();
    const before = fs.readFileSync(settingsPath, 'utf8');
    const beforeMtime = fs.statSync(settingsPath).mtimeMs;
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();

    const runtime = started(service);
    service.settingsView();

    expect(runtime.llm.connections.find((provider) => provider.id === 'deepseek')).toMatchObject({
      isConfigured: false,
      configuredAuthMode: 'api-key',
      activeAccountId: 'account-stored',
      lastTestedAt: '2026-11-01T00:00:00.000Z',
    });
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(before);
    expect(fs.statSync(settingsPath).mtimeMs).toBe(beforeMtime);
  });

  it('serves reads from a frozen snapshot and commits each real change once with a revision and its sections', async () => {
    await createVerifiedPersistedSettings();
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const initial = service.initialize();
    const changes: unknown[] = [];
    service.onChanged((change) => changes.push(change));
    const reads = vi.spyOn(fs, 'readFileSync');
    try {
      for (let index = 0; index < 5; index += 1) {
        expect(service.snapshot()).toBe(initial);
        service.providerConnections.get('deepseek');
        service.agentModelRoutes.resolve('general');
      }
      expect(reads.mock.calls.filter(([file]) => file === settingsPathFor())).toHaveLength(0);
    } finally {
      reads.mockRestore();
    }
    expect(Object.isFrozen(initial.user.appearance)).toBe(true);
    expect(service.providerConnections.list()).toBe(service.providerConnections.list());

    expect(service.update([{ op: 'appearance', value: { theme: initial.user.appearance.theme } }])).toEqual({
      revision: initial.revision,
      changed: {},
    });
    expect(service.snapshot()).toBe(initial);
    expect(changes).toEqual([]);

    const next = service.update([
      { op: 'appearance', value: { theme: 'light' } },
      { op: 'agentModels.setDefault', field: 'model', value: 'deepseek:deepseek-flash' },
    ]);
    expect(next.revision).toBe(initial.revision + 1);
    expect(next.changed).toEqual({
      appearance: service.snapshot().user.appearance,
      agentModels: { default: { model: 'deepseek:deepseek-flash' } },
    });
    expect(JSON.stringify(next).length, 'a patch answers with what changed only').toBeLessThan(2048);
    expect(changes).toEqual([{ revision: next.revision, sections: ['appearance', 'agentModels'] }]);
    expect(service.agentModelRoutes.resolve('general')).toEqual({
      agentId: 'general',
      providerId: 'deepseek',
      modelId: 'deepseek-flash',
    });
  });

  it('picks up a secret written outside the app only when external inputs are re-checked', async () => {
    await createVerifiedPersistedSettings();
    const { SettingsService } = await import('./SettingsService');
    const { SecretStorageService, secretStorageService } = await import('./SecretStorageService');
    const service = new SettingsService();
    service.initialize();
    expect(service.providerConnections.get('deepseek')?.isConfigured).toBe(false);

    // Another writer of the same secret file stands in for an edit made outside the app.
    const secretRef = secretStorageService.createProviderAccountSecretRef('deepseek', 'account-stored', 'api-key');
    new SecretStorageService().setSecret(secretRef, 'sk-written-elsewhere');
    expect(service.providerConnections.get('deepseek')?.isConfigured).toBe(false);

    service.revalidateExternalInputs();
    expect(service.providerConnections.get('deepseek')?.isConfigured).toBe(true);
    expect(service.getProviderSecret('deepseek')).toBe('sk-written-elsewhere');
  });

  it('starts from defaults without creating the settings file', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const runtime = started(service);
    service.settingsView();

    expect(runtime.appearance.theme).toBe('dark');
    expect(runtime.llm.connections.length).toBeGreaterThan(0);
    expect(fs.existsSync(settingsPathFor())).toBe(false);
    service.update([{ op: 'appearance', value: { theme: 'dark' } }]);
    expect(fs.existsSync(settingsPathFor()), 'an unchanged patch writes nothing').toBe(false);
    service.update([{ op: 'appearance', value: { theme: 'light' } }]);
    const written = fs.readFileSync(settingsPathFor(), 'utf8');
    expect(written).not.toContain('\n');
    expect(JSON.parse(written)).toMatchObject({ appearance: { theme: 'light' }, providers: {} });
    expect(JSON.parse(written)).not.toHaveProperty('schemaVersion');
  });

  it('keeps stored providers byte-identical when saving an unrelated settings patch', async () => {
    const { settingsPath } = await createVerifiedPersistedSettings();
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();

    service.initialize();
    const providersBefore = (JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { providers: unknown }).providers;
    service.update([{ op: 'appearance', value: { theme: 'light' } }]);

    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      appearance: { theme: string };
      providers: unknown;
    };
    expect(persisted.appearance.theme).toBe('light');
    expect(persisted.providers).toEqual(providersBefore);
  });

  it('keeps a provider the catalog no longer lists untouched and reports it', async () => {
    const orphan = {
      authMode: 'api-key',
      configuredAuthMode: 'api-key',
      models: { 'retired-model': { label: 'Retired' } },
    };
    const settingsPath = await writeSettingsFixture({ providers: { 'retired-provider': orphan } });
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();

    const runtime = started(service);
    expect(runtime.llm.connections.some((provider) => provider.id === 'retired-provider')).toBe(false);
    expect(runtime.resourceCatalog.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'settings_provider_not_in_catalog',
        severity: 'warning',
        path: settingsPath,
      }),
    );
    service.update([{ op: 'appearance', value: { theme: 'light' } }]);
    service.saveProviderConnection('deepseek', 'sk-deepseek', [
      { id: 'deepseek-flash', label: 'Flash', enabled: true },
    ]);
    expect(
      (JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { providers: Record<string, unknown> }).providers[
        'retired-provider'
      ],
    ).toEqual(orphan);
  });

  it.each([
    ['a top-level field', { llm: { providers: [] } }],
    ['a field inside a section', { appearance: { ...DEFAULT_APPEARANCE, embedding: true } }],
    ['a catalog fact on a provider', { providers: { deepseek: { authMode: 'api-key', label: 'DeepSeek' } } }],
    [
      'a catalog fact on a model',
      { providers: { deepseek: { models: { 'deepseek-flash': { contextWindow: 128000 } } } } },
    ],
    ['a wrong type', { layout: { ...DEFAULT_LAYOUT, terminal: { height: '300' } } }],
  ])('rejects %s as an unusable settings file without changing its bytes', async (_label, overrides) => {
    const settingsPath = await writeSettingsFixture(overrides);
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const { SettingsService } = await import('./SettingsService');
    const { SettingsFileError } = await import('./settingsFileSchema');

    const failure = (() => {
      try {
        new SettingsService().initialize();
      } catch (error) {
        return error;
      }
      return null;
    })();
    expect(failure).toBeInstanceOf(SettingsFileError);
    expect(failure).toMatchObject({ code: 'STORAGE_CORRUPT', filePath: settingsPath, params: { file: 'config.json' } });
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(raw);
  });

  it('takes a settings file that still carries a format version to the startup failure without converting it', async () => {
    const settingsPath = settingsPathFor();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const { createDefaultSettingsFile } = await import('./settingsDefaults');
    const raw = JSON.stringify({ schemaVersion: 9, ...createDefaultSettingsFile() }, null, 2);
    fs.writeFileSync(settingsPath, raw, 'utf8');
    const { SettingsService } = await import('./SettingsService');
    const { SettingsFileError } = await import('./settingsFileSchema');
    const { settingsStartupFailureText } = await import('../../window/settingsStartupFailure');

    const failure = (() => {
      try {
        new SettingsService().initialize();
      } catch (error) {
        return error;
      }
      return null;
    })();
    expect(failure).toBeInstanceOf(SettingsFileError);
    expect(failure).toMatchObject({ code: 'STORAGE_CORRUPT', filePath: settingsPath });
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(raw);
    const dataDirectory = path.join(os.tmpdir(), 'rdc-agent-user-data');
    const text = settingsStartupFailureText(
      'en-US',
      (failure as InstanceType<typeof SettingsFileError>).filePath,
      dataDirectory,
    );
    expect(text.detail).toContain(`${dataDirectory}\n${settingsPath}`);
  });

  it('keeps a configured standard install small and free of catalog facts', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { getProviderModelSummaries } = await import('../../provider-catalog/ProviderCatalogRegistry');
    const service = new SettingsService();
    const settings = started(service);
    service.saveProviderConnection('deepseek', 'sk-deepseek-test', getProviderModelSummaries('deepseek'));
    service.saveProviderAccountConnection(
      'chatgpt-account',
      JSON.stringify({ providerId: 'chatgpt-account', accountId: 'acct-size', accessToken: 'token' }),
      getProviderModelSummaries('chatgpt-account'),
    );
    service.update([
      { op: 'appearance', value: { theme: 'light' } },
      { op: 'agentModels.setDefault', field: 'model', value: 'deepseek:deepseek-flash' },
      { op: 'agentModels.setDefault', field: 'reasoningLevel', value: 'high' },
    ]);

    const raw = fs.readFileSync(settings.paths.settingsPath, 'utf8');
    expect(raw.length).toBeLessThan(8 * 1024);
    const file = JSON.parse(raw) as { providers: Record<string, unknown> };
    expect(Object.keys(file.providers).sort()).toEqual(['chatgpt-account', 'deepseek']);
    const keys = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key);
          collect(child);
        }
      }
    };
    collect(file.providers);
    for (const catalogField of [
      'label',
      'displayName',
      'contextWindow',
      'protocol',
      'catalogProvenance',
      'connectionSchema',
      'capabilities',
      'docsUrl',
      'serviceOperator',
      'endpointClass',
      'authModeOptions',
      'recommendedModels',
      'apiKey',
      'secretRef',
    ]) {
      expect(keys.has(catalogField), catalogField).toBe(false);
    }
    expect(
      service
        .settingsView()
        .llm.connections.filter((provider) => provider.isConfigured)
        .map((provider) => provider.id)
        .sort(),
    ).toEqual(['chatgpt-account', 'deepseek']);
  });

  it('never imports an unkeyed credential', async () => {
    const { secretStorageService } = await import('./SecretStorageService');
    const workspaceRoot = path.join(userDataRoot, '.rdc-agent');
    await writeSettingsFixture({
      providers: { 'chatgpt-account': { authMode: 'account', configuredAuthMode: 'account' } },
    });
    const unkeyedRef = secretStorageService.createProviderOAuthSecretRef('chatgpt-account');
    secretStorageService.setSecret(unkeyedRef, JSON.stringify({ accessToken: 'unkeyed' }), workspaceRoot);

    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const runtime = started(service);

    expect(runtime.llm.connections.find((entry) => entry.id === 'chatgpt-account')).toMatchObject({
      activeAccountId: undefined,
      hasStoredSecret: false,
      isConfigured: false,
    });
    expect(service.getProviderOAuthSecret('chatgpt-account')).toBe('');
    expect(secretStorageService.hasSecret(unkeyedRef, workspaceRoot)).toBe(true);
  });

  it('does not advertise subscription models without account discovery', async () => {
    const settingsPath = await writeSettingsFixture({
      providers: {
        'grok-account': {
          authMode: 'account',
          models: { 'grok-4.5': {}, 'grok-composer-2.5-fast': {} },
        },
      },
    });
    const raw = fs.readFileSync(settingsPath, 'utf8');

    const { SettingsService } = await import('./SettingsService');
    const runtime = started(new SettingsService());

    expect(
      runtime.llm.connections.find((entry) => entry.id === 'grok-account')?.models.map((model) => model.id),
    ).toEqual([]);
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(raw);
  });

  it('keeps only admitted live subscription models and excludes generated media', async () => {
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

    const connected = service.providerConnections.get('grok-account');
    expect(connected).toMatchObject({ isConfigured: true });
    expect(connected?.models.map((model) => model.id)).toEqual(['grok-composer-2.5-fast']);
    expect(connected?.models.some((model) => model.id === 'grok-imagine-video-1.5')).toBe(false);
  });

  it('stages account-keyed secrets without deleting the source before settings commit', async () => {
    const { secretStorageService } = await import('./SecretStorageService');
    const workspaceRoot = path.join(userDataRoot, '.rdc-agent');
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
    const { getProviderModelSummaries } = await import('../../provider-catalog/ProviderCatalogRegistry');
    const service = new SettingsService();
    const settings = started(service);
    const models = getProviderModelSummaries('chatgpt-account').slice(0, 2);
    service.saveProviderAccountConnection(
      'chatgpt-account',
      JSON.stringify({
        providerId: 'chatgpt-account',
        accountId: 'acct-rotate',
        accessToken: 'old',
        refreshToken: 'refresh-old',
      }),
      models,
    );
    const modelIdsBeforeRotation = service
      .settingsView()
      .llm.connections.find((entry) => entry.id === 'chatgpt-account')
      ?.models.map((model) => model.id);

    service.rotateProviderAccountCredential(
      'chatgpt-account',
      JSON.stringify({
        providerId: 'chatgpt-account',
        accountId: 'acct-rotate',
        accessToken: 'new',
        refreshToken: 'refresh-new',
      }),
      { oauthExpiresAt: '2026-07-13T01:00:00.000Z', oauthRefreshAvailable: true },
    );

    const provider = service.providerConnections.get('chatgpt-account');
    const secretRef = secretStorageService.createProviderAccountSecretRef('chatgpt-account', 'acct-rotate', 'oauth');
    expect(provider?.models.map((model) => model.id)).toEqual(modelIdsBeforeRotation);
    expect(
      JSON.parse(secretStorageService.getSecret(secretRef, settings.paths.userRdcRoot)) as { refreshToken: string },
    ).toMatchObject({ refreshToken: 'refresh-new' });
  });

  it('keeps current Volc Coding Plan rows and drops retired candidate ids when validation returns a subset', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { getProviderModelSummaries } = await import('../../provider-catalog/ProviderCatalogRegistry');
    const service = new SettingsService();
    service.initialize();

    service.saveProviderConnection('volcengine-coding-plan', 'test-key', [
      { id: 'doubao-seed-2.1-turbo', label: 'Doubao Seed 2.1 Turbo', enabled: true, availability: 'available' },
      { id: 'glm-4.7', label: 'GLM 4.7', enabled: true, availability: 'available' },
      { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', enabled: true, availability: 'available' },
    ]);

    const reloaded = service.settingsView();
    const models = reloaded.llm.connections.find((provider) => provider.id === 'volcengine-coding-plan')?.models ?? [];
    expect(models.map((model) => model.id)).toEqual(
      getProviderModelSummaries('volcengine-coding-plan').map((model) => model.id),
    );
    expect(models.find((model) => model.id === 'doubao-seed-2.1-turbo')?.availability).toBe('available');
    expect(models.find((model) => model.id === 'glm-4.7')).toBeUndefined();
    expect(models.find((model) => model.id === 'kimi-k2.7-code')).toMatchObject({
      availability: 'available',
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

    const provider = service.providerConnections.get('kimi-coding-plan');
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

    const provider = service.providerConnections.get('kimi-coding-plan');
    expect(provider?.models.map((model) => model.id)).toEqual(['kimi-for-coding', 'k3']);
    expect(provider?.models.find((model) => model.id === 'k3')).toMatchObject({
      label: 'Kimi K3',
      availability: 'available',
    });
  });
  it('persists user-owned model preferences and preserves them across discovery refresh', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { getProviderModelSummaries } = await import('../../provider-catalog/ProviderCatalogRegistry');
    const service = new SettingsService();
    service.initialize();
    const discovered = getProviderModelSummaries('deepseek');
    const target = discovered[0];
    expect(target).toBeDefined();

    service.saveProviderConnection('deepseek', 'test-key', discovered, '', undefined, undefined, [
      {
        id: target!.id,
        enabled: false,
        defaultReasoningSelection: 'high',
        defaultBudgetTokens: 180_000,
        preferredRouteOptionId: 'OpenAICompatibleChatCompletions',
      },
    ]);
    expect(service.providerConnections.get('deepseek')?.models.find((model) => model.id === target!.id)).toMatchObject({
      enabled: false,
      defaultReasoningSelection: 'high',
      defaultBudgetTokens: 180_000,
      preferredRouteOptionId: 'OpenAICompatibleChatCompletions',
    });

    service.saveProviderConnection('deepseek', '', discovered);
    expect(service.providerConnections.get('deepseek')?.models.find((model) => model.id === target!.id)).toMatchObject({
      enabled: false,
      defaultReasoningSelection: 'high',
      defaultBudgetTokens: 180_000,
      preferredRouteOptionId: 'OpenAICompatibleChatCompletions',
    });
  });

  it('atomically persists an unconfigured provider model route preference', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    started(service);
    const provider = service.providerConnections.get('longcat');
    expect(provider).toBeDefined();

    const result = await service.saveProviderDefinition(
      modelChoices(
        provider!,
        provider!.models.map((model) =>
          model.id === 'LongCat-2.0' ? { ...model, preferredRouteOptionId: 'AnthropicMessages' } : model,
        ),
        1,
      ),
    );

    expect(result.status).toBe('committed');
    expect(
      service.providerConnections.get('longcat')?.models.find((model) => model.id === 'LongCat-2.0')
        ?.preferredRouteOptionId,
    ).toBe('AnthropicMessages');
  });

  it('commits only the model choices a save carries and keeps every other row', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const provider = service.providerConnections.get('longcat')!;
    expect(provider.models.length).toBeGreaterThan(1);
    const [first, ...rest] = provider.models;

    const result = await service.saveProviderDefinition(modelChoices(provider, [{ ...first!, enabled: false }], 1));

    expect(result.status).toBe('committed');
    const saved = service.providerConnections.get('longcat')!;
    expect(saved.models.find((model) => model.id === first!.id)?.enabled).toBe(false);
    expect(saved.models.filter((model) => model.id !== first!.id)).toEqual(rest);
    expect(providerConnectionIdentity(saved)).toBe(providerConnectionIdentity(provider));
  });

  it('keeps a verified account and its discovery identity after the last model is disabled', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { buildEffectiveCatalogRequest } = await import('../provider-catalog/EffectiveModelResolver');
    const service = new SettingsService();
    service.initialize();
    service.saveProviderAccountConnection(
      'openrouter',
      JSON.stringify({ providerId: 'openrouter', accountId: 'account-under-test', apiKey: 'sk-or-oauth' }),
      [{ id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', enabled: true }],
    );
    const openRouter = () => service.providerConnections.get('openrouter')!;
    const connected = openRouter();
    const model = connected.models.find((entry) => entry.enabled)!;
    const result = await service.saveProviderDefinition(
      modelChoices(
        connected,
        connected.models.map((entry) => ({ ...entry, enabled: false })),
        1,
      ),
    );
    expect(result.status).toBe('committed');
    expect(openRouter()).toMatchObject({
      enabled: false,
      isConfigured: true,
      status: 'verified',
      activeAccountId: 'account-under-test',
    });
    expect(buildEffectiveCatalogRequest(openRouter()).configurationRevision).toBe(
      buildEffectiveCatalogRequest(connected).configurationRevision,
    );

    await service.saveProviderDefinition(
      modelChoices(
        openRouter(),
        openRouter().models.map((entry) => ({ ...entry, enabled: entry.id === model.id })),
        2,
      ),
    );
    expect(openRouter()).toMatchObject({
      enabled: true,
      isConfigured: true,
      status: 'verified',
      activeAccountId: 'account-under-test',
    });
  });

  it('commits concurrent model choices and an independent settings write without replacing either provider', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    started(service);
    const change = (id: string) => {
      const provider = service.providerConnections.get(id)!;
      return service.saveProviderDefinition(
        modelChoices(
          provider,
          provider.models.map((model) => ({ ...model, enabled: false })),
          1,
        ),
      );
    };
    const first = change('deepseek');
    const second = change('longcat');
    const window = { width: 1600, height: 1000, x: 10, y: 20, isMaximized: true };
    service.persistWindowLayout(window);
    service.update([{ op: 'appearance', value: { contextBreakdownExpanded: true } }]);

    expect((await Promise.all([first, second])).map((item) => item.status)).toEqual(['committed', 'committed']);
    const persisted = service.settingsView();
    expect(persisted.layout.window).toEqual(window);
    expect(persisted.appearance.contextBreakdownExpanded).toBe(true);
    for (const providerId of ['deepseek', 'longcat']) {
      const models = service.providerConnections.get(providerId)!.models;
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((model) => !model.enabled)).toBe(true);
    }
  });

  it('rejects a queued model edit from a connection that was disconnected before commit', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    service.initialize();
    service.saveProviderAccountConnection(
      'openrouter',
      JSON.stringify({ providerId: 'openrouter', accountId: 'account-under-test', apiKey: 'sk-or-oauth' }),
      [{ id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', enabled: true }],
    );
    const connected = service.providerConnections.get('openrouter')!;
    const pending = service.saveProviderDefinition(
      modelChoices(
        connected,
        connected.models.map((model) => ({ ...model, enabled: false })),
        1,
      ),
    );
    const disconnected = service.disconnectProvider('openrouter', 'account');

    await expect(pending).resolves.toMatchObject({ status: 'superseded' });
    expect(service.providerConnections.get('openrouter')).toEqual(disconnected);
  });

  it('returns the prior model choices and keeps config bytes after a provider commit fails', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    service.initialize();
    service.update([{ op: 'appearance', value: { theme: 'light' } }]);
    const settings = service.settingsView();
    const provider = service.providerConnections.get('deepseek')!;
    const filePath = path.join(settings.paths.userRdcRoot, 'config.json');
    const before = fs.readFileSync(filePath, 'utf8');
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('model preference commit failed');
    });
    try {
      const result = await service.saveProviderDefinition(
        modelChoices(
          provider,
          provider.models.map((model) => ({ ...model, enabled: false })),
          1,
        ),
      );
      expect(result).toMatchObject({
        status: 'failed',
        error: 'model preference commit failed',
        lastSuccessful: { provider },
      });
      expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
      expect(fs.readdirSync(settings.paths.userRdcRoot).some((name) => name.endsWith('.tmp'))).toBe(false);
    } finally {
      rename.mockRestore();
    }
  });

  it('preserves an invalid Volc route id so Settings can require an explicit reselection', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const initialized = started(service);
    service.saveProviderConnection('volcengine-coding-plan', 'test-key', [
      { id: 'glm-4.7', label: 'GLM 4.7', enabled: true, availability: 'available' },
    ]);

    expect(initialized.agents.definitions.some((definition) => definition.id === 'general')).toBe(true);
    service.update([
      { op: 'agentModels.setAgentField', agentId: 'general', field: 'model', value: 'volcengine-coding-plan:glm-5.2' },
    ]);

    expect(service.settingsView().llm.agentRoutes).toContainEqual({
      agentId: 'general',
      providerId: 'volcengine-coding-plan',
      modelId: 'glm-5.2',
    });
  });

  it('switches OpenRouter auth modes without deleting the inactive credential', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { secretStorageService } = await import('./SecretStorageService');
    const service = new SettingsService();
    const initialized = started(service);
    const models = [{ id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', enabled: true }];

    service.saveProviderConnection(
      'openrouter',
      'sk-or-api-key',
      models,
      'https://openrouter.ai/api/v1',
      'OpenRouterChatCompletions',
      'api-key',
    );
    const apiProvider = service.providerConnections.get('openrouter');
    const apiSecretRef = apiProvider?.secretRef;
    expect(apiProvider).toMatchObject({
      authMode: 'api-key',
      configuredAuthMode: 'api-key',
      hasStoredSecretByAuthMode: { 'api-key': true, account: false },
    });

    service.saveProviderAccountConnection(
      'openrouter',
      JSON.stringify({ providerId: 'openrouter', accountId: 'or-user', apiKey: 'sk-or-oauth' }),
      models,
    );
    const accountProvider = service.providerConnections.get('openrouter');
    expect(accountProvider).toMatchObject({
      authMode: 'account',
      configuredAuthMode: 'account',
      activeAccountId: 'or-user',
      hasStoredSecretByAuthMode: { 'api-key': true, account: true },
      secretRef: apiSecretRef,
    });
    expect(service.getProviderSecret('openrouter')).toBe('sk-or-api-key');

    service.disconnectProvider('openrouter', 'account');
    expect(service.getProviderOAuthSecret('openrouter')).toBe('');
    expect(secretStorageService.getSecret(apiSecretRef, initialized.paths.userRdcRoot)).toBe('sk-or-api-key');
    service.saveProviderConnection(
      'openrouter',
      '',
      models,
      'https://openrouter.ai/api/v1',
      'OpenRouterChatCompletions',
      'api-key',
    );
    expect(service.providerConnections.get('openrouter')).toMatchObject({
      authMode: 'api-key',
      configuredAuthMode: 'api-key',
      isConfigured: true,
      hasStoredSecretByAuthMode: { 'api-key': true, account: false },
    });
  });

  it('preserves invalid routes so model removal requires explicit reselection', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const initialized = started(service);
    expect(initialized.agents.definitions.some((definition) => definition.id === 'general')).toBe(true);
    service.update([
      { op: 'agentModels.setAgentField', agentId: 'general', field: 'model', value: 'missing-provider:missing-model' },
    ]);
    expect(service.settingsView().llm.agentRoutes).toContainEqual({
      agentId: 'general',
      providerId: 'missing-provider',
      modelId: 'missing-model',
    });
  });

  it('coalesces A -> B -> C so only C is committed and settings never mirrors the route', async () => {
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    const initialized = started(service);
    const ask = initialized.agents.definitions.find((definition) => definition.id === 'general');
    expect(ask).toBeDefined();
    const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...draft } = ask!;
    service.update([
      { op: 'agentModels.setAgentField', agentId: 'general', field: 'model', value: 'deepseek:model-c' },
    ]);
    const settingsBeforeSave = fs.readFileSync(initialized.paths.settingsPath, 'utf8');

    const first = service.saveAgentDefinition({
      draft: {
        ...draft,
        instructions: `${draft.instructions}\nPersist an explicit user route override.`,
      },
      clientRevision: 100,
      scope: 'user',
    });
    const middle = service.saveAgentDefinition({
      draft: {
        ...draft,
        instructions: `${draft.instructions}\nPersist an explicit user route override.`,
      },
      clientRevision: 200,
      scope: 'user',
    });
    const newest = service.saveAgentDefinition({
      draft: {
        ...draft,
        instructions: `${draft.instructions}\nPersist an explicit user route override.`,
      },
      clientRevision: 300,
      scope: 'user',
    });
    const [firstResult, middleResult, newestResult] = await Promise.all([first, middle, newest]);
    expect(firstResult.status).toBe('superseded');
    expect(middleResult.status).toBe('superseded');
    expect(newestResult).toMatchObject({
      status: 'committed',
      clientRevision: 300,
      route: { agentId: 'general', providerId: 'deepseek', modelId: 'model-c' },
    });
    expect(newestResult.commitHash).toMatch(/^[a-f0-9]{64}$/);
    expect(newestResult.lastSuccessful?.commitHash).toBe(newestResult.commitHash);
    expect(service.settingsView().llm.agentRoutes).toContainEqual({
      agentId: 'general',
      providerId: 'deepseek',
      modelId: 'model-c',
    });
    const saved = service.settingsView().agents.definitions.find((definition) => definition.id === 'general');
    expect(saved?.compiledRoute).toEqual({ agentId: 'general', providerId: 'deepseek', modelId: 'model-c' });
    expect(fs.readdirSync(initialized.paths.agentsPath).some((entry) => entry.endsWith('.tmp'))).toBe(false);
    const persisted = JSON.parse(fs.readFileSync(initialized.paths.settingsPath, 'utf8')) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('llm');
    expect(fs.readFileSync(initialized.paths.settingsPath, 'utf8')).toBe(settingsBeforeSave);
  });

  it('returns the last successful snapshot when the latest manifest commit fails', async () => {
    const { SettingsService } = await import('./SettingsService');
    const { agentManifestService } = await import('../agent-manifests/AgentManifestService');
    const service = new SettingsService();
    const initialized = started(service);
    const ask = initialized.agents.definitions.find((definition) => definition.id === 'general');
    expect(ask).toBeDefined();
    const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...draft } = ask!;
    service.update([
      { op: 'agentModels.setAgentField', agentId: 'general', field: 'model', value: 'deepseek:model-c' },
    ]);
    const committed = await service.saveAgentDefinition({
      draft: {
        ...draft,
        instructions: `${draft.instructions}\nPersist an explicit user route override.`,
      },
      clientRevision: 300,
      scope: 'user',
    });
    const saveSpy = vi
      .spyOn(agentManifestService, 'saveDefinition')
      .mockRejectedValueOnce(new Error('simulated atomic rename failure'));

    const failed = await service.saveAgentDefinition({
      draft: { ...draft },
      clientRevision: 400,
      scope: 'user',
    });

    expect(failed).toMatchObject({
      status: 'failed',
      error: 'simulated atomic rename failure',
      commitHash: committed.commitHash,
      route: { agentId: 'general', providerId: 'deepseek', modelId: 'model-c' },
    });
    expect(failed.lastSuccessful?.commitHash).toBe(committed.commitHash);
    expect(
      service.settingsView().agents.definitions.find((definition) => definition.id === 'general')?.compiledRoute,
    ).toEqual({ agentId: 'general', providerId: 'deepseek', modelId: 'model-c' });
    saveSpy.mockRestore();
  });

  it('persistWindowLayout patches only layout.window without touching providers', async () => {
    const { settingsPath } = await createVerifiedPersistedSettings();
    const { SettingsService } = await import('./SettingsService');
    const service = new SettingsService();
    service.initialize();

    const before = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { providers: unknown };
    const providersBefore = JSON.stringify(before.providers);

    service.persistWindowLayout({
      width: 1440,
      height: 900,
      x: 120,
      y: 80,
      isMaximized: false,
    });

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      providers: unknown;
      layout: { window: { width: number; height: number; x: number; y: number; isMaximized: boolean } };
    };

    expect(JSON.stringify(after.providers)).toBe(providersBefore);
    expect(after.layout.window).toEqual({
      width: 1440,
      height: 900,
      x: 120,
      y: 80,
      isMaximized: false,
    });
  });

  it('preserves valid custom chrome themes in the current settings schema', async () => {
    const { createDefaultChromeThemes } = await import('../../../shared/theme/presets');
    const custom = {
      ...createDefaultChromeThemes().dark,
      accent: '#ff0000',
      surface: '#112233',
      ink: '#abcdef',
      presetId: 'dracula',
    };
    const settingsPath = await writeSettingsFixture({
      appearance: { ...DEFAULT_APPEARANCE, theme: 'dark', chromeThemes: { light: custom, dark: custom } },
    });
    const raw = fs.readFileSync(settingsPath, 'utf8');

    const { SettingsService } = await import('./SettingsService');
    const runtime = started(new SettingsService());
    expect(runtime.appearance.chromeThemes.dark.accent).toBe('#ff0000');
    expect(runtime.appearance.chromeThemes.light.presetId).toBe('dracula');
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(raw);
  });

  it.each([30_000, 600_000, 3_600_000])(
    'preserves an explicit RDC no-progress patience of %ims',
    async (noProgressTimeoutMs) => {
      const { DEFAULT_TOOLING } = await import('@shared/constants/appSettingsDefaults');
      const settingsPath = await writeSettingsFixture({
        tooling: { ...DEFAULT_TOOLING, rdcCli: { ...DEFAULT_TOOLING.rdcCli, noProgressTimeoutMs } },
      });

      const { SettingsService } = await import('./SettingsService');
      const runtime = started(new SettingsService());
      expect(runtime.tooling.rdcCli.noProgressTimeoutMs).toBe(noProgressTimeoutMs);
      expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).tooling.rdcCli.noProgressTimeoutMs).toBe(
        noProgressTimeoutMs,
      );
    },
  );

  it('rejects malformed settings JSON without replacing the file with defaults', async () => {
    const settingsPath = settingsPathFor();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const raw = '{"providers":';
    fs.writeFileSync(settingsPath, raw, 'utf8');

    const { SettingsService } = await import('./SettingsService');
    expect(() => new SettingsService().initialize()).toThrow(/STORAGE_CORRUPT/);
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(raw);
  });
});
