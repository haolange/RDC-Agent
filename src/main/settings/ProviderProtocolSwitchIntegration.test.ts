import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@shared/types/settings';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';

const mocks = vi.hoisted(() => ({
  invalidateDiscovery: vi.fn(),
  updateSession: vi.fn(),
  sessions: [{
    sessionId: 'session-1',
    turnControls: { reasoningLevel: 'high', maxContextMode: true, fastModel: true },
  }],
}));

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: () => '', encryptString: (value: string) => Buffer.from(value) },
}));

vi.mock('./EffectiveCatalogService', async () => {
  const actual = await vi.importActual<typeof import('./EffectiveCatalogService')>('./EffectiveCatalogService');
  return {
    ...actual,
    effectiveCatalogService: { invalidateDiscovery: mocks.invalidateDiscovery },
  };
});

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: {
    listProjects: () => [{ projectId: 'project-1' }],
    listSessions: () => mocks.sessions,
    updateSession: mocks.updateSession,
  },
}));

import { reprojectProviderProtocolChange } from './ProviderProtocolSwitchService';

function effectiveModel(): EffectiveModel {
  return {
    providerId: 'dual-provider', modelId: 'model-current', label: 'Current', aliases: ['model-old'], enabled: true,
    route: { protocol: 'AnthropicMessages', baseUrl: 'https://fixed.example/v1', source: 'model' },
    availability: 'available',
    contextTiers: [{ id: 'default', label: 'Default', maxPromptTokens: 200_000, activation: { kind: 'implicit' }, entitlement: 'granted' }],
    defaultBudgetTokens: 200_000,
    fast: { kind: 'unsupported' },
    reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', lockedSelection: 'off', wireProfile: { kind: 'none' } },
    toolCalling: { state: 'supported' }, visionInput: { state: 'unsupported' }, structuredOutput: { state: 'supported' },
    provenance: [],
  };
}

describe('protocol reprojection integration', () => {
  beforeEach(() => {
    mocks.invalidateDiscovery.mockReset();
    mocks.updateSession.mockReset();
  });

  it('invalidates the old protocol cache, preserves fixed model routes, and clamps persisted turn controls', async () => {
    const settings = {
      llm: {
        providers: [{
          id: 'dual-provider', protocol: 'OpenAIResponses', activeAccountId: 'account-1',
          catalogOwnership: 'app-managed', models: [],
        }],
        agentRoutes: [{ agentId: 'debugger', providerId: 'dual-provider', modelId: 'model-old' }],
      },
    } as unknown as AppSettings;
    const snapshot: EffectiveCatalogSnapshot = {
      providerId: 'dual-provider', accountId: 'account-1', protocol: 'OpenAIResponses',
      generatedAt: '2026-07-13T00:00:00.000Z', stale: false, refreshing: false,
      models: [effectiveModel()],
    };

    const result = await reprojectProviderProtocolChange({
      providerId: 'dual-provider', previousProtocol: 'AnthropicMessages', settings, snapshot,
    });

    expect(result.models[0].route).toMatchObject({ protocol: 'AnthropicMessages', source: 'model' });
    expect(mocks.invalidateDiscovery).toHaveBeenCalledOnce();
    expect(mocks.invalidateDiscovery).toHaveBeenCalledWith({
      providerId: 'dual-provider', accountId: 'account-1', protocol: 'AnthropicMessages',
    });
    expect(mocks.updateSession).toHaveBeenCalledWith('session-1', {
      turnControls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
    });
  });
});
