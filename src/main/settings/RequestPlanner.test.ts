import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type { ReasoningControl, ReasoningSelection } from '@shared/types/modelCapability';
import { planModelRequest } from './RequestPlanner';

function model(overrides: Partial<EffectiveModel> = {}): EffectiveModel {
  return {
    providerId: 'provider-a',
    modelId: 'model-a',
    label: 'Model A',
    aliases: [],
    enabled: true,
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
        contextMode: 'normal',
        contextWindowTokens: 256_000,
        activeTierId: 'default',
        fastMode: false,
        reasoningWire: {
          selection: 'low',
          control: model().reasoning,
        },
        temperature: undefined,
      },
    });
  });

  it('selects the Anthropic unverified header-activated 1M tier and clamps its budget', () => {
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
      warnings: ['1M context entitlement is unverified'],
      plan: {
        activeTierId: 'long',
        headers: { 'anthropic-beta': 'context-1m' },
        contextBudgetTokens: 1_000_000,
        contextMode: 'one-million',
        contextWindowTokens: 1_000_000,
      },
    });
  });

  it('recognizes Copilot 922K prompt plus 128K output as a 1M-class window', () => {
    const result = planModelRequest({
      model: model({
        providerId: 'github-copilot',
        modelId: 'gpt-5.4',
        contextTiers: [
          {
            id: 'default', label: 'Default', maxPromptTokens: 272_000,
            activation: { kind: 'implicit' }, entitlement: 'granted',
          },
          {
            id: 'long_context', label: 'Long context', maxPromptTokens: 922_000, maxOutputTokens: 128_000,
            activation: { kind: 'implicit' }, entitlement: 'unknown',
          },
        ],
        defaultBudgetTokens: 272_000,
      }),
      controls: { maxContextMode: true },
    });
    expect(result).toMatchObject({
      ok: true,
      warnings: ['1M context entitlement is unverified'],
      plan: {
        providerId: 'github-copilot',
        effectiveModelId: 'gpt-5.4',
        activeTierId: 'long_context',
        contextBudgetTokens: 922_000,
        contextMode: 'one-million',
        contextWindowTokens: 1_050_000,
        headers: {},
        bodyPatch: {},
      },
    });
  });

  it('selects a granted 1M tier instead of a larger unknown tier', () => {
    const result = planModelRequest({
      model: model({
        contextTiers: [
          ...model().contextTiers,
          {
            id: 'long',
            label: '1M',
            maxPromptTokens: 1_000_000,
            activation: { kind: 'implicit' },
            entitlement: 'granted',
          },
          {
            id: 'experimental',
            label: '1.5M',
            maxPromptTokens: 1_500_000,
            activation: { kind: 'implicit' },
            entitlement: 'unknown',
          },
        ],
      }),
      controls: { maxContextMode: true },
    });
    expect(result).toMatchObject({
      ok: true,
      warnings: [],
      plan: {
        activeTierId: 'long',
        contextBudgetTokens: 1_000_000,
        contextMode: 'one-million',
        contextWindowTokens: 1_000_000,
      },
    });
  });

  it('lets a single 1M-class tier serve normal and explicit 1M budgets', () => {
    const result = planModelRequest({
      model: model({
        contextTiers: [{
          id: 'default',
          label: 'Default',
          maxPromptTokens: 1_050_000,
          activation: { kind: 'implicit' },
          entitlement: 'granted',
        }],
        defaultBudgetTokens: 272_000,
      }),
      controls: { maxContextMode: true },
    });
    expect(result).toMatchObject({
      ok: true,
      controls: { maxContextMode: true },
      plan: {
        activeTierId: 'default',
        contextBudgetTokens: 1_000_000,
        contextMode: 'one-million',
        contextWindowTokens: 1_050_000,
      },
    });
    expect(planModelRequest({
      model: model({
        contextTiers: [{
          id: 'default', label: 'Default', maxPromptTokens: 1_050_000,
          activation: { kind: 'implicit' }, entitlement: 'granted',
        }],
        defaultBudgetTokens: 272_000,
      }),
    })).toMatchObject({
      ok: true,
      plan: { contextBudgetTokens: 272_000, contextMode: 'normal', contextWindowTokens: 1_050_000 },
    });
  });

  it('fails closed when EffectiveModel has no positive default budget', () => {
    expect(planModelRequest({ model: model({ defaultBudgetTokens: 0 }) })).toMatchObject({
      ok: false,
      code: 'NO_USABLE_CONTEXT_TIER',
    });
  });

  it('compiles Kimi model-variant Fast and fixed temperature', () => {
    const result = planModelRequest({
      model: model({
        providerId: 'kimi-coding-plan',
        modelId: 'kimi-for-coding',
        fast: { kind: 'model-variant', modelId: 'kimi-for-coding-highspeed', entitlement: 'granted' },
        fixedTemperature: 1,
      }),
      controls: { fastModel: true },
      requestedTemperature: 0.2,
    });
    expect(result).toMatchObject({
      ok: true,
      controls: { fastModel: true },
      plan: {
        providerId: 'kimi-coding-plan',
        effectiveModelId: 'kimi-for-coding-highspeed',
        temperature: 1,
      },
    });
  });

  it('switches a reasoning model-variant family without emitting a reasoning wire parameter', () => {
    const reasoning: ReasoningControl = {
      kind: 'toggle',
      supportsOff: true,
      levels: [],
      defaultSelection: 'off',
      modelVariants: {
        offModelId: 'grok-4.20-0309-non-reasoning',
        onModelId: 'grok-4.20-0309-reasoning',
      },
      wireProfile: {
        kind: 'openai-compatible',
        on: 'high',
        onMode: 'enable-thinking-true',
        offMode: 'enable-thinking-false',
      },
    };
    const result = planModelRequest({
      model: model({ modelId: 'grok-4.20-0309-non-reasoning', reasoning }),
      controls: { reasoningLevel: 'on' },
    });
    expect(result).toMatchObject({
      ok: true,
      plan: {
        effectiveModelId: 'grok-4.20-0309-reasoning',
        bodyPatch: {},
        reasoningWire: {
          selection: 'on',
          control: { modelVariants: reasoning.modelVariants, wireProfile: { kind: 'none' } },
        },
      },
    });
  });

  it.each(([
    ['none', { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } }, 'off'],
    ['openai-responses', { kind: 'levels', supportsOff: true, levels: ['high'], defaultSelection: 'high', wireProfile: { kind: 'openai-responses', on: 'high', levels: { high: 'high' } } }, 'high'],
    ['openai-compatible', { kind: 'toggle', supportsOff: true, levels: [], defaultSelection: 'on', wireProfile: { kind: 'openai-compatible', on: 'high', onMode: 'enable-thinking-true', offMode: 'enable-thinking-false' } }, 'on'],
    ['anthropic', { kind: 'levels', supportsOff: true, levels: ['high'], defaultSelection: 'high', wireProfile: { kind: 'anthropic', on: 'high', levels: { high: 'high' }, onMode: 'adaptive', offMode: 'disabled' } }, 'high'],
    ['gemini-thinking-level', { kind: 'levels', supportsOff: false, levels: ['high'], defaultSelection: 'high', wireProfile: { kind: 'gemini-thinking-level', on: 'high', levels: { high: 'high' } } }, 'high'],
    ['gemini-thinking-budget', { kind: 'levels', supportsOff: true, levels: ['medium'], defaultSelection: 'medium', wireProfile: { kind: 'gemini-thinking-budget', on: 'medium', levels: { medium: 8192 }, offBudget: 0 } }, 'medium'],
    ['moonshot-thinking', { kind: 'toggle', supportsOff: true, levels: [], defaultSelection: 'on', wireProfile: { kind: 'moonshot-thinking', onMode: 'enabled', offMode: 'disabled' } }, 'on'],
  ] satisfies Array<[string, ReasoningControl, ReasoningSelection]>))(
    'preserves the %s reasoning wire contract in the closed plan',
    (_kind, reasoning, selection) => {
      const result = planModelRequest({ model: model({ reasoning }), controls: { reasoningLevel: selection } });
      expect(result).toMatchObject({
        ok: true,
        plan: { reasoningWire: { selection, control: reasoning } },
      });
    },
  );

  it('uses request and body tier patches when they do not conflict', () => {
    const result = planModelRequest({
      model: model({
        contextTiers: [
          ...model().contextTiers,
          {
            id: 'long',
            label: 'Long',
            maxTotalTokens: 1_000_000,
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
            maxTotalTokens: 1_000_000,
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

  it('returns a typed error for a declarative constraint rejection', () => {
    expect(planModelRequest({
      model: model({
        constraints: [{
          id: 'reject-high',
          when: { reasoningSelections: ['high'] },
          action: { kind: 'reject', code: 'HIGH_DENIED' },
          reason: 'High reasoning is unavailable for this route.',
        }],
      }),
      controls: { reasoningLevel: 'high' },
    })).toMatchObject({
      ok: false,
      code: 'CONSTRAINT_REJECTED',
      message: 'High reasoning is unavailable for this route.',
    });
  });

  it('returns typed errors for unavailable models and tiers', () => {
    expect(planModelRequest({
      model: model({ availability: 'unavailable', unavailableReason: 'coming soon' }),
    })).toMatchObject({ ok: false, code: 'MODEL_UNAVAILABLE', message: 'coming soon' });

    expect(planModelRequest({
      model: model({ availability: 'unknown' }),
    })).toMatchObject({ ok: false, code: 'MODEL_UNAVAILABLE', message: 'model-a is not yet verified' });

    expect(planModelRequest({
      model: model({ contextTiers: model().contextTiers.map((tier) => ({ ...tier, entitlement: 'denied' })) }),
    })).toMatchObject({ ok: false, code: 'NO_USABLE_CONTEXT_TIER' });
  });
});
