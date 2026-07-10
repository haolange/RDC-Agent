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
    const { createBuiltinProviderEntry } = await import('@shared/constants/llm');
    const workspaceRoot = path.join(userDataRoot, '.rdx');
    const settingsPath = path.join(workspaceRoot, 'config.json');
    const provider = {
      ...createBuiltinProviderEntry('deepseek'),
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
});
