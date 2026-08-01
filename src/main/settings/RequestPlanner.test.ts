import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { resolveModelControls } from '@shared/utils/modelControls';
import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';
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

  it('keeps conditional provider headers out of the request body', () => {
    const base = model({
      controls: {
        ...model().controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
      },
      executionBindings: [{
        id: 'fast:anthropic-speed',
        when: { fast: true },
        actions: [
          { kind: 'request-patch', patch: { speed: 'fast' } },
          { kind: 'request-headers', headers: { 'anthropic-beta': 'fast-mode-2026-02-01' } },
        ],
        entitlement: 'granted',
      }],
    });

    const result = planModelRequest({ model: base, catalogModels: [base], controls: { fastModel: true } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.headers).toEqual({ 'anthropic-beta': 'fast-mode-2026-02-01' });
    expect(result.plan.bodyPatch).toEqual({ speed: 'fast' });
    expect(result.plan.bodyPatch).not.toHaveProperty('headers');
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
  it('prefers a model-level cache contract over the route default', () => {
    const routeContracts = {
      ...createFailClosedProviderContracts('OpenAIResponses'),
      cache: {
        mode: 'implicit-prefix' as const,
        keyCarrier: 'prompt-cache-key' as const,
        breakpointCarrier: 'none' as const,
        telemetry: ['cached-input-tokens' as const],
        ttl: 'five-minutes' as const,
      },
    };
    const cacheContract = {
      mode: 'automatic-and-explicit-breakpoints' as const,
      keyCarrier: 'prompt-cache-key' as const,
      breakpointCarrier: 'openai-prompt-cache' as const,
      telemetry: ['cached-input-tokens' as const, 'cache-write-input-tokens' as const],
      ttl: 'thirty-minutes' as const,
    };
    const cached = model({
      cacheContract,
      route: { ...model().route, contracts: routeContracts },
      routeOptions: [{
        id: 'responses',
        route: { ...model().route, contracts: routeContracts },
        availability: 'available',
      }],
    });

    const result = planModelRequest({ model: cached, catalogModels: [cached] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.contracts.cache).toEqual(cacheContract);
    expect(result.plan.cachePlan).toEqual({ enabled: true, ...cacheContract });
  });

  it('defaults to secret-free local stateless execution even when the route supports provider state', () => {
    const contracts: ReturnType<typeof createFailClosedProviderContracts> = {
      ...createFailClosedProviderContracts('OpenAIResponses'),
      compatibilityGroup: 'openai-responses:test',
      state: {
        supportedModes: ['local-stateless', 'provider-managed'],
        defaultMode: 'local-stateless' as const,
        carrier: 'previous-response-id' as const,
        retention: 'provider' as const,
        crossModel: 'never' as const,
      },
    };
    const stateful = model({
      route: { ...model().route, contracts },
      routeOptions: [{
        id: 'responses',
        route: { ...model().route, contracts },
        availability: 'available',
      }],
    });
    const secretScope = 'account-secret-that-must-not-be-persisted';
    const result = planModelRequest({ model: stateful, credentialScopeId: secretScope });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.statePlan).toEqual({
      mode: 'local-stateless',
      carrier: 'none',
      store: false,
      reuseProviderState: false,
    });
    expect(result.plan.contextTransitionPlan).toMatchObject({
      strategy: 'semantic-replay',
      portable: true,
    });
    expect(result.plan.executionIdentity.credentialScopeHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.plan.executionIdentity.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(result.plan)).not.toContain(secretScope);
  });

  it('enables provider-managed state only through an explicit supported request mode', () => {
    const contracts: ReturnType<typeof createFailClosedProviderContracts> = {
      ...createFailClosedProviderContracts('OpenAIResponses'),
      compatibilityGroup: 'openai-responses:test',
      state: {
        supportedModes: ['local-stateless', 'provider-managed'],
        defaultMode: 'local-stateless' as const,
        carrier: 'previous-response-id' as const,
        retention: 'provider' as const,
        crossModel: 'never' as const,
      },
    };
    const stateful = model({
      route: { ...model().route, contracts },
      routeOptions: [{
        id: 'responses',
        route: { ...model().route, contracts },
        availability: 'available',
      }],
    });
    const enabled = planModelRequest({ model: stateful, stateMode: 'provider-managed' });
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;
    expect(enabled.plan.statePlan).toEqual({
      mode: 'provider-managed',
      carrier: 'previous-response-id',
      store: true,
      reuseProviderState: true,
    });
    expect(enabled.plan.contextTransitionPlan).toMatchObject({
      strategy: 'provider-managed',
      portable: false,
    });

    expect(planModelRequest({ model: model(), stateMode: 'provider-managed' }))
      .toMatchObject({ ok: false, code: 'CONSTRAINT_REJECTED' });
  });

  it('changes execution identity for account, endpoint, control, and binding changes', () => {
    const getPlan = (
      selected: EffectiveModel,
      options: Parameters<typeof planModelRequest>[0] = { model: selected },
    ) => {
      const result = planModelRequest({ ...options, model: selected });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      return result.plan;
    };
    const base = model();
    const accountA = getPlan(base, { model: base, credentialScopeId: 'account-a' });
    const accountB = getPlan(base, { model: base, credentialScopeId: 'account-b' });
    const endpoint = model({
      route: { ...base.route, baseUrl: 'https://other.example.test/v1' },
      routeOptions: [{
        id: 'responses',
        route: { ...base.route, baseUrl: 'https://other.example.test/v1' },
        availability: 'available',
      }],
    });
    const endpointPlan = getPlan(endpoint);
    const high = getPlan(base, { model: base, controls: { reasoningLevel: 'high' } });
    const fastModel = model({
      controls: {
        ...base.controls,
        fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
      },
      executionBindings: [{
        id: 'fast:priority',
        when: { fast: true },
        actions: [{ kind: 'request-patch', patch: { service_tier: 'priority' } }],
        entitlement: 'granted',
      }],
    });
    const fast = getPlan(fastModel, {
      model: fastModel,
      catalogModels: [fastModel],
      controls: { fastModel: true },
    });

    expect(new Set([
      accountA.executionIdentity.fingerprint,
      accountB.executionIdentity.fingerprint,
      endpointPlan.executionIdentity.fingerprint,
      high.executionIdentity.fingerprint,
      fast.executionIdentity.fingerprint,
    ]).size).toBe(5);
    expect(accountA.executionIdentity.variantKey).not.toBe(high.executionIdentity.variantKey);
    expect(accountA.executionIdentity.variantKey).not.toBe(fast.executionIdentity.variantKey);
  });

});
