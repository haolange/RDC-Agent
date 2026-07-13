import { describe, expect, it, vi } from 'vitest';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: () => '', encryptString: (value: string) => Buffer.from(value) },
}));

import { clampControlsForProtocolModels, resolveProtocolRouteModels } from './ProviderProtocolSwitchService';
import type { AppSettings } from '@shared/types/settings';

function model(id: string, patch: Partial<EffectiveModel>): EffectiveModel {
  return {
    providerId: 'dual-provider', modelId: id, label: id, aliases: [], enabled: true,
    route: { protocol: 'AnthropicMessages', baseUrl: 'https://example.test', source: 'user' },
    availability: 'available',
    contextTiers: [{ id: 'default', label: 'Default', maxPromptTokens: 200_000, activation: { kind: 'implicit' }, entitlement: 'granted' }],
    defaultBudgetTokens: 200_000,
    fast: { kind: 'unsupported' },
    reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
    toolCalling: { state: 'supported' }, visionInput: { state: 'unsupported' }, structuredOutput: { state: 'supported' },
    provenance: [], ...patch,
  };
}

describe('protocol switch control clamping', () => {
  it('clamps persisted controls across every affected model projection', () => {
    const controls = clampControlsForProtocolModels(
      { reasoningLevel: 'high', maxContextMode: true, fastModel: true },
      [model('a', {
        reasoning: { kind: 'levels', supportsOff: true, levels: ['low', 'high'], defaultSelection: 'low', wireProfile: { kind: 'none' } },
        contextTiers: [
          { id: 'default', label: 'Default', activation: { kind: 'implicit' }, entitlement: 'granted' },
          { id: 'max', label: 'Max', activation: { kind: 'implicit' }, entitlement: 'granted' },
        ],
        fast: { kind: 'request-param', patch: { fast: true }, entitlement: 'granted' },
      }), model('b', {})],
    );
    expect(controls).toEqual({ reasoningLevel: 'off', maxContextMode: false, fastModel: false });
  });

  it('preserves model-fixed routes, follows proven aliases, and rejects missing routes with recommendations', () => {
    const fixed = model('canonical', {
      aliases: ['previous-model'],
      route: { protocol: 'AnthropicMessages', baseUrl: 'https://fixed.example/v1', source: 'model' },
    });
    const recommended = model('recommended', {
      route: { protocol: 'OpenAIResponses', baseUrl: 'https://default.example/v1', source: 'preset' },
    });
    const snapshot: EffectiveCatalogSnapshot = {
      providerId: 'dual-provider', accountId: 'account', protocol: 'OpenAIResponses',
      stale: false, refreshing: false, models: [fixed, recommended], generatedAt: '2026-07-13T00:00:00.000Z',
    };
    const aliasSettings = {
      llm: { providers: [], agentRoutes: [{ agentId: 'debugger', providerId: 'dual-provider', modelId: 'previous-model' }] },
    } as unknown as AppSettings;
    expect(resolveProtocolRouteModels(aliasSettings, snapshot, 'dual-provider')).toEqual([fixed]);
    expect(resolveProtocolRouteModels(aliasSettings, snapshot, 'dual-provider')[0].route.protocol).toBe('AnthropicMessages');

    const missingSettings = {
      llm: { providers: [], agentRoutes: [{ agentId: 'debugger', providerId: 'dual-provider', modelId: 'gone' }] },
    } as unknown as AppSettings;
    expect(() => resolveProtocolRouteModels(missingSettings, snapshot, 'dual-provider'))
      .toThrow(/MODEL_UNAVAILABLE.*recommended/u);
  });
});
