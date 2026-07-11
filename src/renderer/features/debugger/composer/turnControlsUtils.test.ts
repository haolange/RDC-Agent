import { describe, expect, it } from 'vitest';
import type { ResolvedModelCapability } from '@shared/types/modelCapability';
import {
  buildInitialTurnControls,
  sanitizeTurnControls,
} from './turnControlsUtils';

const levelsCapability: ResolvedModelCapability = {
  providerId: 'openai',
  modelId: 'gpt-5.5',
  catalogSource: 'managed-catalog',
  nominalContextWindowTokens: 1_050_000,
  defaultContextWindowTokens: 256_000,
  maxContextWindowTokens: 1_050_000,
  reasoningControl: {
    kind: 'levels',
    supportsOff: true,
    levels: ['low', 'medium', 'high', 'extra'],
    defaultSelection: 'medium',
    wireProfile: { kind: 'none' },
  },
  maxContextAvailable: true,
  fastVariantModelId: 'gpt-5.5-fast',
  fastModelAvailable: true,
  fixedTemperature: null,
  toolCalling: true,
  visionInput: true,
  structuredOutput: true,
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
      maxContextAvailable: false,
      fastModelAvailable: false,
      maxContextWindowTokens: null,
      fastVariantModelId: null,
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
      reasoningControl: {
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
