import { describe, expect, it } from 'vitest';
import type { ResolvedModelCapability } from '@shared/types/modelCapability';
import {
  buildInitialTurnControls,
  formatTokenCount,
  sanitizeTurnControls,
} from './turnControlsUtils';

const capability: ResolvedModelCapability = {
  providerId: 'openai',
  modelId: 'gpt-5',
  catalogSource: 'managed-catalog',
  nominalContextWindowTokens: 1_000_000,
  defaultContextWindowTokens: 256_000,
  maxContextWindowTokens: 1_000_000,
  reasoningMode: 'effort-levels',
  supportedReasoningLevels: ['off', 'auto', 'low', 'medium', 'high'],
  defaultReasoningLevel: 'medium',
  maxContextAvailable: true,
  fastVariantModelId: 'gpt-5-fast',
  fastModelAvailable: true,
  toolCalling: true,
  visionInput: true,
  structuredOutput: true,
};

describe('turnControlsUtils', () => {
  it('clamps unsupported reasoning level and disables unavailable toggles', () => {
    const sanitized = sanitizeTurnControls({
      reasoningLevel: 'max',
      maxContextMode: true,
      fastModel: true,
    }, capability);

    expect(sanitized).toEqual({
      reasoningLevel: 'high',
      maxContextMode: true,
      fastModel: true,
    });
  });

  it('forces max/fast off when capability does not expose them', () => {
    const limited: ResolvedModelCapability = {
      ...capability,
      maxContextAvailable: false,
      maxContextWindowTokens: null,
      fastModelAvailable: false,
      fastVariantModelId: null,
      reasoningMode: 'none',
      supportedReasoningLevels: ['off'],
      defaultReasoningLevel: 'off',
    };

    expect(sanitizeTurnControls({
      reasoningLevel: 'medium',
      maxContextMode: true,
      fastModel: true,
    }, limited)).toEqual({
      reasoningLevel: 'off',
      maxContextMode: false,
      fastModel: false,
    });
  });

  it('restores session controls with sanitization', () => {
    expect(buildInitialTurnControls(capability, {
      reasoningLevel: 'extHigh',
      maxContextMode: true,
      fastModel: false,
    })).toEqual({
      reasoningLevel: 'high',
      maxContextMode: true,
      fastModel: false,
    });
  });

  it('uses the capability default for auto-only thinking models', () => {
    const autoOnly: ResolvedModelCapability = {
      ...capability,
      reasoningMode: 'auto-only',
      supportedReasoningLevels: ['off', 'auto'],
      defaultReasoningLevel: 'auto',
      maxContextAvailable: false,
      maxContextWindowTokens: null,
      fastModelAvailable: false,
      fastVariantModelId: null,
    };

    expect(buildInitialTurnControls(autoOnly)).toEqual({
      reasoningLevel: 'auto',
      maxContextMode: false,
      fastModel: false,
    });
  });

  it('reads legacy effort controls into reasoningLevel only', () => {
    expect(buildInitialTurnControls(capability, {
      effort: 'extHigh',
      maxContextMode: false,
      fastModel: false,
    })).toEqual({
      reasoningLevel: 'high',
      maxContextMode: false,
      fastModel: false,
    });
  });

  it('fails closed from unknown legacy reasoning values to the capability default', () => {
    expect(buildInitialTurnControls(capability, {
      reasoningLevel: 'legacy-effort-level',
      maxContextMode: true,
      fastModel: true,
    })).toEqual({
      reasoningLevel: 'medium',
      maxContextMode: true,
      fastModel: true,
    });
  });

  it('formats token counts for composer labels', () => {
    expect(formatTokenCount(256_000)).toBe('256k');
    expect(formatTokenCount(1_000_000)).toBe('1M');
    expect(formatTokenCount(1_250_000)).toBe('1.3M');
  });
});
