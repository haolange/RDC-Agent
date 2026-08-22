import { describe, expect, it } from 'vitest';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { resolveSelectedContextProfile } from './selectedContextProfile';

const noReasoning = {
  kind: 'none' as const,
  supportsOff: true,
  levels: [],
  defaultSelection: 'off' as const,
  lockedSelection: 'off' as const,
  wireProfile: { kind: 'none' as const },
};

const controls = (overrides: Partial<ConversationTurnControls> = {}): ConversationTurnControls => ({
  reasoningLevel: 'off',
  maxContextMode: false,
  fastModel: false,
  ...overrides,
});

function model(overrides: Partial<EffectiveModel> = {}): EffectiveModel {
  return {
    providerId: 'provider',
    modelId: 'base',
    label: 'Base',
    aliases: [],
    enabled: true,
    route: { protocol: 'AnthropicMessages', source: 'catalog' },
    availability: 'available',
    presencePolicy: 'maintained',
    contextTiers: [{
      id: 'default',
      label: 'Default',
      maxTotalTokens: 256_000,
      activation: { kind: 'implicit' },
      entitlement: 'granted',
    }],
    defaultBudgetTokens: 256_000,
    controls: {
      fast: { state: 'unsupported', fixedValue: false },
      maxContext: { state: 'unsupported', fixedValue: false },
      reasoning: noReasoning,
    },
    toolCalling: { state: 'supported' },
    visionInput: { state: 'unsupported' },
    structuredOutput: { state: 'supported' },
    provenance: [],
    ...overrides,
  };
}

describe('resolveSelectedContextProfile', () => {
  it('returns the normal tier budget and window', () => {
    expect(resolveSelectedContextProfile(model(), controls())).toEqual({
      providerId: 'provider',
      modelId: 'base',
      contextWindowTokens: 256_000,
      contextBudgetTokens: 256_000,
      maxOutputTokens: 256_000,
      compactionThresholdTokens: 204_800,
    });
  });

  it('uses the 1M tier budget when Max mode is selected', () => {
    const oneMillion = model({
      contextTiers: [
        {
          id: 'default',
          label: 'Default',
          maxTotalTokens: 256_000,
          activation: { kind: 'implicit' },
          entitlement: 'granted',
        },
        {
          id: 'long',
          label: 'Long',
          maxTotalTokens: 1_000_000,
          maxOutputTokens: 64_000,
          activation: { kind: 'implicit' },
          entitlement: 'granted',
        },
      ],
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        maxContext: {
          state: 'selectable',
          defaultValue: false,
          entitlement: 'granted',
          tierId: 'long',
        },
        reasoning: noReasoning,
      },
    });

    expect(resolveSelectedContextProfile(oneMillion, controls({ maxContextMode: true }))).toEqual({
      providerId: 'provider',
      modelId: 'base',
      contextWindowTokens: 1_000_000,
      contextBudgetTokens: 1_000_000,
      maxOutputTokens: 64_000,
      compactionThresholdTokens: 800_000,
    });
  });

  it('fails closed when the default budget is missing', () => {
    expect(resolveSelectedContextProfile(model({ defaultBudgetTokens: 0 }), controls())).toBeNull();
  });
});
