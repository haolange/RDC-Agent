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
  nominalContextWindowTokens: 1_000_000,
  defaultContextWindowTokens: 256_000,
  maxContextWindowTokens: 1_000_000,
  supportedEffortLevels: ['low', 'medium', 'high'],
  defaultEffort: 'medium',
  maxContextAvailable: true,
  fastVariantModelId: 'gpt-5-fast',
  fastModelAvailable: true,
};

describe('turnControlsUtils', () => {
  it('clamps unsupported effort and disables unavailable toggles', () => {
    const sanitized = sanitizeTurnControls({
      effort: 'max',
      maxContextMode: true,
      fastModel: true,
    }, capability);

    expect(sanitized).toEqual({
      effort: 'high',
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
      supportedEffortLevels: [],
      defaultEffort: 'medium',
    };

    expect(sanitizeTurnControls({
      effort: 'medium',
      maxContextMode: true,
      fastModel: true,
    }, limited)).toEqual({
      effort: 'medium',
      maxContextMode: false,
      fastModel: false,
    });
  });

  it('restores session controls with sanitization', () => {
    expect(buildInitialTurnControls(capability, {
      effort: 'extra',
      maxContextMode: true,
      fastModel: false,
    })).toEqual({
      effort: 'high',
      maxContextMode: true,
      fastModel: false,
    });
  });

  it('formats token counts for composer labels', () => {
    expect(formatTokenCount(256_000)).toBe('256k');
    expect(formatTokenCount(1_000_000)).toBe('1M');
    expect(formatTokenCount(1_250_000)).toBe('1.3M');
  });
});
