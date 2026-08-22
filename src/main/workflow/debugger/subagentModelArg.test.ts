import { describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@shared/types/settings';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  assertSubagentModelAvailable,
  parseSubagentModelArg,
  resolveSubagentModelOverride,
} from './subagentModelArg';

vi.mock('../../settings/EffectiveModelResolver', () => ({
  resolveEffectiveModel: (providerId: string, modelId: string) => {
    if (providerId === 'openai' && modelId === 'gpt-5.6-sol') {
      return {
        providerId,
        modelId,
        enabled: true,
        availability: 'available',
        selection: { pickerVisibility: 'primary' },
      };
    }
    if (providerId === 'openai' && modelId === 'hidden') {
      return {
        providerId,
        modelId,
        enabled: true,
        availability: 'available',
        selection: { pickerVisibility: 'internal' },
      };
    }
    return null;
  },
}));

describe('subagentModelArg', () => {
  it('parses canonical providerId:modelId and rejects other shapes', () => {
    expect(parseSubagentModelArg('openai:gpt-5.6-sol')).toEqual({
      providerId: 'openai',
      modelId: 'gpt-5.6-sol',
    });
    expect(() => parseSubagentModelArg('gpt-5.6-sol')).toThrow(/MODEL_INVALID/);
    expect(() => parseSubagentModelArg('')).toThrow(/MODEL_INVALID/);
  });

  it('fail-closes unavailable and internal models', () => {
    expect(() => assertSubagentModelAvailable(null, { providerId: 'openai', modelId: 'missing' }))
      .toThrow(/MODEL_UNAVAILABLE/);
    expect(() => assertSubagentModelAvailable({
      enabled: false,
      availability: 'available',
    } as EffectiveModel, { providerId: 'openai', modelId: 'off' })).toThrow(/MODEL_UNAVAILABLE/);
  });

  it('resolves an available catalog model and ignores empty input', () => {
    const settings = {} as AppSettings;
    expect(resolveSubagentModelOverride(undefined, settings)).toBeUndefined();
    expect(resolveSubagentModelOverride('openai:gpt-5.6-sol', settings)).toEqual({
      providerId: 'openai',
      modelId: 'gpt-5.6-sol',
    });
    expect(() => resolveSubagentModelOverride('openai:hidden', settings)).toThrow(/MODEL_UNAVAILABLE/);
  });
});
