import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '../types/providerCapability';
import { evaluateModelControls } from './modelControls';

const model = (patch: Partial<EffectiveModel> = {}): EffectiveModel => ({
  providerId: 'provider',
  modelId: 'model',
  label: 'Model',
  aliases: [],
  enabled: true,
  route: { protocol: 'OpenAIResponses', source: 'preset' },
  availability: 'available',
  contextTiers: [
    { id: 'default', label: 'Default', maxPromptTokens: 200_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
    { id: 'max', label: 'Max', maxPromptTokens: 1_000_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
  ],
  defaultBudgetTokens: 200_000,
  fast: { kind: 'request-param', patch: { service_tier: 'priority' }, entitlement: 'granted' },
  reasoning: {
    kind: 'levels', supportsOff: true, levels: ['low', 'high'], defaultSelection: 'low', wireProfile: { kind: 'none' },
  },
  toolCalling: { state: 'supported' },
  visionInput: { state: 'unknown' },
  structuredOutput: { state: 'unknown' },
  provenance: [],
  ...patch,
});

describe('evaluateModelControls', () => {
  it('applies the same capability and declarative clamps for UI and planner callers', () => {
    expect(evaluateModelControls(model({
      constraints: [{
        id: 'max-disables-fast',
        when: { maxContextMode: true, fast: true },
        action: { kind: 'clamp', control: 'fastModel', value: false },
        reason: 'Fast and Max are mutually exclusive.',
      }],
    }), {
      reasoningLevel: 'max',
      maxContextMode: true,
      fastModel: true,
    })).toEqual({
      controls: { reasoningLevel: 'high', maxContextMode: true, fastModel: false },
    });
  });

  it('returns a typed reject without mutating unsupported controls back on', () => {
    expect(evaluateModelControls(model({
      fast: { kind: 'unsupported' },
      constraints: [{
        id: 'reject-high',
        when: { reasoningSelections: ['high'] },
        action: { kind: 'reject', code: 'HIGH_DENIED' },
        reason: 'High reasoning is denied.',
      }],
    }), { reasoningLevel: 'high', fastModel: true })).toEqual({
      controls: { reasoningLevel: 'high', maxContextMode: false, fastModel: false },
      error: { code: 'HIGH_DENIED', message: 'High reasoning is denied.' },
    });
  });
});
