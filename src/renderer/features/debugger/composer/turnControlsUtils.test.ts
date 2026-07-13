import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  buildInitialTurnControls,
  sanitizeTurnControls,
} from './turnControlsUtils';

const levelsCapability: EffectiveModel = {
  providerId: 'openai',
  modelId: 'gpt-5.5',
  label: 'GPT-5.5', aliases: [],
  route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test', source: 'preset' },
  availability: 'available',
  contextTiers: [
    { id: 'default', label: 'Default', maxPromptTokens: 256_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
    { id: 'max', label: 'Max', maxPromptTokens: 1_050_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
  ],
  defaultBudgetTokens: 256_000,
  reasoning: {
    kind: 'levels',
    supportsOff: true,
    levels: ['low', 'medium', 'high', 'extra'],
    defaultSelection: 'medium',
    wireProfile: { kind: 'none' },
  },
  fast: { kind: 'model-variant', modelId: 'gpt-5.5-fast', entitlement: 'granted' },
  toolCalling: { state: 'supported' }, visionInput: { state: 'supported' }, structuredOutput: { state: 'supported' },
  provenance: [],
};

describe('turnControlsUtils', () => {
  it('clamps unsupported reasoning levels to the nearest supported level', () => {
    expect(sanitizeTurnControls({
      reasoningLevel: 'max',
      maxContextMode: true,
      fastModel: true,
    }, levelsCapability)).toEqual({
      reasoningLevel: 'extra',
      maxContextMode: true,
      fastModel: true,
    });
  });

  it('disables unavailable fast and max-context toggles when capability is absent', () => {
    expect(sanitizeTurnControls({
      reasoningLevel: 'medium',
      maxContextMode: true,
      fastModel: true,
    }, {
      ...levelsCapability,
      contextTiers: levelsCapability.contextTiers.slice(0, 1),
      fast: { kind: 'unsupported' },
    })).toEqual({
      reasoningLevel: 'medium',
      maxContextMode: false,
      fastModel: false,
    });
  });

  it('maps legacy extHigh and auto values through the shared normalization path', () => {
    expect(sanitizeTurnControls({
      effort: 'extHigh',
      maxContextMode: false,
      fastModel: false,
    }, levelsCapability)).toEqual({
      reasoningLevel: 'extra',
      maxContextMode: false,
      fastModel: false,
    });

    expect(sanitizeTurnControls({
      reasoningLevel: 'auto',
      maxContextMode: false,
      fastModel: false,
    }, {
      ...levelsCapability,
      reasoning: {
        kind: 'toggle',
        supportsOff: true,
        levels: [],
        defaultSelection: 'on',
        wireProfile: { kind: 'none' },
      },
    })).toEqual({
      reasoningLevel: 'on',
      maxContextMode: false,
      fastModel: false,
    });
  });

  it('builds initial controls from the capability default or session snapshot', () => {
    expect(buildInitialTurnControls(levelsCapability)).toEqual({
      reasoningLevel: 'medium',
      maxContextMode: false,
      fastModel: false,
    });

    expect(buildInitialTurnControls(levelsCapability, {
      reasoningLevel: 'off',
      maxContextMode: true,
      fastModel: true,
    })).toEqual({
      reasoningLevel: 'off',
      maxContextMode: true,
      fastModel: true,
    });
  });
});
