import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { resolveModelControls } from '@shared/utils/modelControls';
import { planModelRequest } from './RequestPlanner';

const reasoning = {
  kind: 'levels' as const,
  supportsOff: false,
  levels: ['low', 'medium', 'high', 'xhigh', 'max'] as const,
  defaultSelection: 'medium' as const,
  wireProfile: {
    kind: 'openai-responses' as const,
    on: 'medium' as const,
    levels: { low: 'low' as const, medium: 'medium' as const, high: 'high' as const, xhigh: 'xhigh' as const, max: 'max' as const },
  },
};

function model(overrides: Partial<EffectiveModel> = {}): EffectiveModel {
  return {
    providerId: 'provider',
    modelId: 'base',
    label: 'Base',
    aliases: [],
    enabled: true,
    route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test/v1', source: 'catalog' },
    routeOptions: [{
      id: 'responses',
      route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test/v1', source: 'catalog' },
      availability: 'available',
    }],
    availability: 'available',
    presencePolicy: 'maintained',
    contextTiers: [{
      id: 'default',
      label: 'Default',
      maxTotalTokens: 256_000,
      maxOutputTokens: 16_000,
      activation: { kind: 'implicit' },
      entitlement: 'granted',
    }],
    defaultBudgetTokens: 240_000,
    controls: {
      fast: { state: 'unsupported', fixedValue: false },
      context1m: { state: 'unsupported', fixedValue: false },
      reasoning: { ...reasoning, levels: [...reasoning.levels] },
    },
    toolCalling: { state: 'supported' },
    visionInput: { state: 'unsupported' },
    structuredOutput: { state: 'supported' },
    provenance: [],
    ...overrides,
  };
}

describe('planModelRequest', () => {
  it('records unknown provider reasoning without emitting an Off selection or wire patch', () => {
    const result = planModelRequest({
      model: model({
        controls: {
          ...model().controls,
          reasoning: {
            kind: 'unknown',
            supportsOff: false,
            levels: [],
            defaultSelection: 'off',
            defaultState: 'unknown',
            wireProfile: { kind: 'none' },
          },
        },
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.reasoningWire.selection).toBe('unknown');
    expect(result.plan.bodyPatch).not.toHaveProperty('reasoning_effort');
  });

  it('applies request-patch Fast from one execution binding', () => {
    const base = model({
      controls: {
        ...model().controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
      },
      executionBindings: [{
        id: 'fast:priority',
        when: { fast: true },
        actions: [{ kind: 'request-patch', patch: { service_tier: 'priority' } }],
        entitlement: 'granted',
      }],
    });
    const result = planModelRequest({ model: base, catalogModels: [base], controls: { fastModel: true } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({
      adapterId: 'openai-responses',
      selectedModelId: 'base',
      effectiveModelId: 'base',
      appliedBindingIds: ['fast:priority'],
      fastMode: true,
      bodyPatch: { service_tier: 'priority' },
    });
  });

  it('applies an unconditional route parameter policy without inventing a UI control', () => {
    const base = model({
      executionBindings: [{
        id: 'route:chatgpt-codex-parameter-policy',
        when: {},
        actions: [{
          kind: 'request-patch',
          patch: { temperature: null, top_p: null, max_output_tokens: null },
        }],
        entitlement: 'granted',
      }],
    });
    const result = planModelRequest({ model: base, catalogModels: [base] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.appliedBindingIds).toEqual(['route:chatgpt-codex-parameter-policy']);
    expect(result.plan.bodyPatch).toEqual({ temperature: null, top_p: null, max_output_tokens: null });
  });
  it('switches Kimi Fast to its hidden highspeed target on the selected protocol', () => {
    const routes: EffectiveModel['routeOptions'] = [
      { id: 'anthropic', route: { protocol: 'AnthropicMessages', baseUrl: 'https://kimi.test/v1', source: 'catalog' }, availability: 'available' },
      { id: 'openai', route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://kimi.test/v1', source: 'catalog' }, availability: 'available' },
    ];
    const base = model({
      modelId: 'kimi-for-coding',
      routeRevision: 'kimi-selected-route',
      route: routes[0].route,
      routeOptions: routes,
      preferredRouteOptionId: 'openai',
      controls: {
        ...model().controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
      },
      executionBindings: [{
        id: 'fast:kimi-highspeed',
        when: { fast: true },
        actions: [{ kind: 'model-switch', targetModelId: 'kimi-for-coding-highspeed' }],
        entitlement: 'granted',
      }],
    });
    const highspeed = model({
      modelId: 'kimi-for-coding-highspeed',
      routeRevision: 'kimi-fast-target-route',
      route: routes[0].route,
      routeOptions: routes,
      selection: { pickerVisibility: 'internal', relatedPrimaryModelIds: ['kimi-for-coding'] },
    });
    const result = planModelRequest({
      model: base,
      catalogModels: [base, highspeed],
      controls: { fastModel: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.effectiveModelId).toBe('kimi-for-coding-highspeed');
    expect(result.plan.routeRevision).toBe('kimi-fast-target-route');
    expect(result.plan.routeRevision).not.toBe(base.routeRevision);
    expect(result.plan.adapterId).toBe('openai-compatible');
    expect(result.plan.route.protocol).toBe('OpenAICompatibleChatCompletions');
    expect(result.plan.appliedBindingIds).toEqual(['fast:kimi-highspeed']);
  });

  it('returns the same blocked reason as the shared control resolver', () => {
    const base = model({
      controls: {
        ...model().controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
      },
      executionBindings: [{
        id: 'fast:missing',
        when: { fast: true },
        actions: [{ kind: 'model-switch', targetModelId: 'missing' }],
        entitlement: 'granted',
      }],
    });
    const controls = resolveModelControls(base, { fastModel: true }, [base]);
    const result = planModelRequest({ model: base, catalogModels: [base], controls: { fastModel: true } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(controls.error?.message);
    expect(result.code).toBe('MODEL_UNAVAILABLE');
  });

  it('returns the same protocol-conflict reason in Composer resolution and planning', () => {
    const openAi = {
      id: 'openai',
      route: { protocol: 'OpenAICompatibleChatCompletions' as const, baseUrl: 'https://example.test/v1', source: 'catalog' as const },
      availability: 'available' as const,
    };
    const base = model({
      route: openAi.route,
      routeOptions: [openAi],
      preferredRouteOptionId: 'openai',
      controls: {
        ...model().controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
      },
      executionBindings: [{
        id: 'fast:anthropic-only',
        when: { fast: true },
        actions: [{ kind: 'model-switch', targetModelId: 'anthropic-only' }],
        entitlement: 'granted',
      }],
    });
    const target = model({
      modelId: 'anthropic-only',
      route: { protocol: 'AnthropicMessages', baseUrl: 'https://example.test/v1', source: 'catalog' },
      routeOptions: [{
        id: 'anthropic',
        route: { protocol: 'AnthropicMessages', baseUrl: 'https://example.test/v1', source: 'catalog' },
        availability: 'available',
      }],
    });
    const controls = resolveModelControls(base, { fastModel: true }, [base, target]);
    const result = planModelRequest({ model: base, catalogModels: [base, target], controls: { fastModel: true } });
    expect(controls.resolved.fast).toMatchObject({ state: 'blocked', disabled: true });
    expect(result).toMatchObject({ ok: false, code: 'MODEL_UNAVAILABLE', message: controls.error?.message });
  });

  it('fails closed when an internal target route is still unverified', () => {
    const base = model({
      controls: {
        ...model().controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
      },
      executionBindings: [{
        id: 'fast:unverified-route',
        when: { fast: true },
        actions: [{ kind: 'model-switch', targetModelId: 'target' }],
        entitlement: 'granted',
      }],
    });
    const target = model({
      modelId: 'target',
      routeOptions: [{
        id: 'responses',
        route: model().route,
        availability: 'unknown',
      }],
    });
    expect(planModelRequest({ model: base, catalogModels: [base, target], controls: { fastModel: true } }))
      .toMatchObject({ ok: false, code: 'MODEL_UNAVAILABLE', message: expect.stringContaining('unknown') });
  });

  it('keeps fixed Max mode enabled and disabled in UI while planning the explicit tier', () => {
    const fixed = model({
      contextTiers: [{
        id: 'fixed-1m',
        label: 'Max mode',
        maxTotalTokens: 1_000_000,
        maxOutputTokens: 64_000,
        activation: { kind: 'implicit' },
        entitlement: 'granted',
      }],
      controls: {
        ...model().controls,
        context1m: { state: 'fixed', fixedValue: true, tierId: 'fixed-1m' },
      },
    });
    const result = planModelRequest({ model: fixed, catalogModels: [fixed] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.maxContextMode).toBe(true);
    expect(result.plan).toMatchObject({ contextMode: 'one-million', activeTierId: 'fixed-1m' });
    expect(result.plan.contextWindowTokens).toBe(1_000_000);
  });

  it('activates selectable Max mode through its tier body patch', () => {
    const long = model({
      contextTiers: [
        model().contextTiers[0],
        {
          id: 'long',
          label: '1M',
          maxTotalTokens: 1_000_000,
          maxOutputTokens: 64_000,
          activation: { kind: 'body', patch: { context_mode: '1m' } },
          entitlement: 'granted',
        },
      ],
      controls: {
        ...model().controls,
        context1m: { state: 'selectable', defaultValue: false, entitlement: 'granted', tierId: 'long' },
      },
    });
    const result = planModelRequest({ model: long, catalogModels: [long], controls: { maxContextMode: true } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.bodyPatch).toEqual({ context_mode: '1m' });
    expect(result.plan.contextMode).toBe('one-million');
  });

  it('uses a model-switch reasoning Max binding and suppresses duplicate wire effort', () => {
    const base = model({
      executionBindings: [{
        id: 'reasoning:max-model',
        when: { reasoning: ['max'] },
        actions: [{ kind: 'model-switch', targetModelId: 'max-model', suppressReasoningWire: true }],
        entitlement: 'granted',
      }],
    });
    const max = model({
      modelId: 'max-model',
      selection: { pickerVisibility: 'internal', relatedPrimaryModelIds: ['base'] },
    });
    const result = planModelRequest({
      model: base,
      catalogModels: [base, max],
      controls: { reasoningLevel: 'max' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.effectiveModelId).toBe('max-model');
    expect(result.plan.reasoningWire.control.wireProfile).toEqual({ kind: 'none' });
  });

  it('chooses a single most-specific Fast + Max mode binding', () => {
    const combined = model({
      contextTiers: [
        model().contextTiers[0],
        { id: 'long', label: '1M', maxTotalTokens: 1_000_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
      ],
      controls: {
        ...model().controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
        context1m: { state: 'selectable', defaultValue: false, entitlement: 'granted', tierId: 'long' },
      },
      executionBindings: [
        { id: 'fast', when: { fast: true }, actions: [{ kind: 'request-patch', patch: { mode: 'fast' } }], entitlement: 'granted' },
        { id: 'fast+1m', when: { fast: true, context1m: true }, actions: [{ kind: 'request-patch', patch: { mode: 'fast-long' } }], entitlement: 'granted' },
      ],
    });
    const result = planModelRequest({
      model: combined,
      catalogModels: [combined],
      controls: { fastModel: true, maxContextMode: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.appliedBindingIds).toEqual(['fast+1m']);
    expect(result.plan.bodyPatch).toEqual({ mode: 'fast-long' });
  });

  it('fails closed for an invalid persisted route preference', () => {
    const result = planModelRequest({
      model: model({ preferredRouteOptionId: 'removed-route' }),
      catalogModels: [],
    });
    expect(result).toMatchObject({ ok: false, code: 'PLAN_CONFLICT' });
  });
});
