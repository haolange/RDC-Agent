import { describe, expect, it, vi } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: () => '', encryptString: (value: string) => Buffer.from(value) },
}));

import { clampControlsForProtocolModels } from './ProviderProtocolSwitchService';

function model(id: string, patch: Partial<EffectiveModel>): EffectiveModel {
  return {
    providerId: 'dual-provider', modelId: id, label: id, aliases: [],
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
});
