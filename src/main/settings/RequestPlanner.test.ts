import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { planModelRequest } from './RequestPlanner';

function model(overrides: Partial<EffectiveModel> = {}): EffectiveModel {
  return {
    providerId: 'provider-a',
    modelId: 'model-a',
    label: 'Model A',
    aliases: [],
    route: {
      protocol: 'OpenAIResponses',
      baseUrl: 'https://example.test/v1',
      source: 'preset',
    },
    availability: 'available',
    contextTiers: [{
      id: 'default',
      label: 'Default',
      maxPromptTokens: 256_000,
      activation: { kind: 'implicit' },
      entitlement: 'granted',
    }],
    defaultBudgetTokens: 128_000,
    fast: { kind: 'unsupported' },
    reasoning: {
      kind: 'levels',
      supportsOff: true,
      levels: ['low', 'high'],
      defaultSelection: 'low',
      wireProfile: {
        kind: 'openai-responses',
        on: 'low',
        levels: { low: 'low', high: 'high' },
      },
    },
    toolCalling: { state: 'supported' },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'supported' },
    provenance: [],
    ...overrides,
  };
}

describe('planModelRequest', () => {
  it('creates the conservative default plan', () => {
    expect(planModelRequest({ model: model() })).toEqual({
      ok: true,
      controls: { reasoningLevel: 'low', maxContextMode: false, fastModel: false },
      warnings: [],
      plan: {
        providerId: 'provider-a',
        effectiveModelId: 'model-a',
        route: {
          protocol: 'OpenAIResponses',
          baseUrl: 'https://example.test/v1',
          source: 'preset',
          headers: undefined,
        },
        headers: {},
        bodyPatch: {},
        contextBudgetTokens: 128_000,
        activeTierId: 'default',
        reasoningWire: {
          selection: 'low',
          control: model().reasoning,
        },
        temperature: undefined,
      },
    });
  });

  it('selects an unverified header-activated Max tier and clamps its budget', () => {
    const result = planModelRequest({
      model: model({
        contextTiers: [
          ...model().contextTiers,
          {
            id: 'long',
            label: '1M',
            maxPromptTokens: 1_000_000,
            activation: { kind: 'header', headers: { 'anthropic-beta': 'context-1m' } },
            entitlement: 'unknown',
          },
        ],
      }),
      controls: { maxContextMode: true, reasoningLevel: 'high' },
      clientBudgetTokens: 2_000_000,
    });
    expect(result).toMatchObject({
      ok: true,
      controls: { maxContextMode: true, reasoningLevel: 'high' },
      warnings: ['Context tier 1M is unverified'],
      plan: {
        activeTierId: 'long',
        headers: { 'anthropic-beta': 'context-1m' },
        contextBudgetTokens: 1_000_000,
      },
    });
  });

  it('compiles model-variant Fast and fixed temperature', () => {
    const result = planModelRequest({
      model: model({
        fast: { kind: 'model-variant', modelId: 'model-a-fast', entitlement: 'granted' },
        fixedTemperature: 1,
      }),
      controls: { fastModel: true },
      requestedTemperature: 0.2,
    });
    expect(result).toMatchObject({
      ok: true,
      controls: { fastModel: true },
      plan: { effectiveModelId: 'model-a-fast', temperature: 1 },
    });
  });

  it('uses request and body tier patches when they do not conflict', () => {
    const result = planModelRequest({
      model: model({
        contextTiers: [
          ...model().contextTiers,
          {
            id: 'long',
            label: 'Long',
            activation: { kind: 'body', patch: { context: { tier: 'long' } } },
            entitlement: 'granted',
          },
        ],
        fast: { kind: 'request-param', patch: { latency: 'fast' }, entitlement: 'granted' },
      }),
      controls: { maxContextMode: true, fastModel: true },
    });
    expect(result).toMatchObject({
      ok: true,
      plan: { bodyPatch: { latency: 'fast', context: { tier: 'long' } } },
    });
  });

  it('fails closed when two activations conflict', () => {
    const result = planModelRequest({
      model: model({
        contextTiers: [
          ...model().contextTiers,
          {
            id: 'long',
            label: 'Long',
            activation: { kind: 'body', patch: { mode: 'long' } },
            entitlement: 'granted',
          },
        ],
        fast: { kind: 'request-param', patch: { mode: 'fast' }, entitlement: 'granted' },
      }),
      controls: { maxContextMode: true, fastModel: true },
    });
    expect(result).toMatchObject({ ok: false, code: 'PLAN_CONFLICT' });
  });

  it('applies declarative constraint clamps before planning', () => {
    const result = planModelRequest({
      model: model({
        fast: { kind: 'model-variant', modelId: 'model-a-fast', entitlement: 'granted' },
        constraints: [{
          id: 'fast-no-high',
          when: { fast: true, reasoningSelections: ['high'] },
          action: { kind: 'clamp', control: 'reasoningLevel', value: 'off' },
          reason: 'Fast does not support high reasoning',
        }],
      }),
      controls: { fastModel: true, reasoningLevel: 'high' },
    });
    expect(result).toMatchObject({
      ok: true,
      controls: { fastModel: true, reasoningLevel: 'off' },
      plan: { reasoningWire: { selection: 'off' } },
    });
  });

  it('returns typed errors for unavailable models and tiers', () => {
    expect(planModelRequest({
      model: model({ availability: 'unavailable', unavailableReason: 'coming soon' }),
    })).toMatchObject({ ok: false, code: 'MODEL_UNAVAILABLE', message: 'coming soon' });

    expect(planModelRequest({
      model: model({ contextTiers: model().contextTiers.map((tier) => ({ ...tier, entitlement: 'denied' })) }),
    })).toMatchObject({ ok: false, code: 'NO_USABLE_CONTEXT_TIER' });
  });
});
