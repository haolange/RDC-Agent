import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '../types/providerCapability';
import { resolveModelControls } from './modelControls';

const noReasoning = {
  kind: 'none' as const,
  supportsOff: true,
  levels: [],
  defaultSelection: 'off' as const,
  lockedSelection: 'off' as const,
  wireProfile: { kind: 'none' as const },
};

function model(overrides: Partial<EffectiveModel> = {}): EffectiveModel {
  return {
    providerId: 'provider',
    modelId: 'base',
    label: 'Base',
    aliases: [],
    enabled: true,
    route: { protocol: 'AnthropicMessages', source: 'catalog' },
    availability: 'available',
    presencePolicy: 'maintained',
    contextTiers: [{
      id: 'default',
      label: 'Default',
      maxTotalTokens: 256_000,
      activation: { kind: 'implicit' },
      entitlement: 'granted',
    }],
    defaultBudgetTokens: 256_000,
    controls: {
      fast: { state: 'unsupported', fixedValue: false },
      maxContext: { state: 'unsupported', fixedValue: false },
      reasoning: noReasoning,
    },
    toolCalling: { state: 'supported' },
    visionInput: { state: 'unsupported' },
    structuredOutput: { state: 'supported' },
    provenance: [],
    ...overrides,
  };
}

describe('resolveModelControls', () => {
  it('uses one binding as the only Fast target truth', () => {
    const base = model({
      controls: {
        fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
        maxContext: { state: 'unsupported', fixedValue: false },
        reasoning: noReasoning,
      },
      executionBindings: [{
        id: 'fast:highspeed',
        when: { fast: true },
        actions: [{ kind: 'model-switch', targetModelId: 'highspeed' }],
        entitlement: 'granted',
      }],
    });
    const highspeed = model({
      modelId: 'highspeed',
      label: 'Highspeed',
      selection: { pickerVisibility: 'internal', relatedPrimaryModelIds: ['base'] },
    });

    const result = resolveModelControls(base, { fastModel: true }, [base, highspeed]);
    expect(result.error).toBeUndefined();
    expect(result.controls.fastModel).toBe(true);
    expect(result.resolved.fast).toMatchObject({
      state: 'selectable',
      value: true,
      bindingId: 'fast:highspeed',
      effectiveModelId: 'highspeed',
    });
    expect(result.binding?.actions).toEqual([{ kind: 'model-switch', targetModelId: 'highspeed' }]);
  });

  it.each([
    ['missing', [] as EffectiveModel[], 'not present'],
    ['denied', [model({ modelId: 'highspeed', availability: 'unavailable' })], 'unavailable'],
    ['protocol', [model({
      modelId: 'highspeed',
      route: { protocol: 'OpenAIResponses', source: 'catalog' },
    })], 'incompatible'],
  ])('blocks Fast when the internal target is %s', (_case, targets, reason) => {
    const base = model({
      controls: {
        fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
        maxContext: { state: 'unsupported', fixedValue: false },
        reasoning: noReasoning,
      },
      executionBindings: [{
        id: 'fast:highspeed',
        when: { fast: true },
        actions: [{ kind: 'model-switch', targetModelId: 'highspeed' }],
        entitlement: 'granted',
      }],
    });
    const result = resolveModelControls(base, { fastModel: true }, [base, ...targets]);
    expect(result.resolved.fast).toMatchObject({ state: 'blocked', value: false, disabled: true });
    expect(result.resolved.fast.reason).toContain(reason);
    expect(result.error?.code).toBe('FAST_BLOCKED');
  });

  it('keeps structurally selectable unverified controls available with an unverified reason', () => {
    const unverified = model({
      controls: {
        fast: { state: 'selectable', defaultValue: false, entitlement: 'unknown' },
        maxContext: { state: 'unsupported', fixedValue: false },
        reasoning: noReasoning,
      },
      executionBindings: [{
        id: 'fast:unverified',
        when: { fast: true },
        actions: [{ kind: 'request-patch', patch: { speed: 'fast' } }],
        entitlement: 'unknown',
      }],
    });

    const result = resolveModelControls(unverified, { fastModel: true }, [unverified]);
    expect(result.controls.fastModel).toBe(true);
    expect(result.resolved.fast).toMatchObject({
      state: 'selectable', value: true, disabled: false, entitlement: 'unknown',
    });
    expect(result.resolved.fast.reason).toContain('not yet verified');
    expect(result.error).toBeUndefined();
  });

  it('projects fixed, selectable and unsupported 1M states without numeric guessing', () => {
    const tier = {
      id: 'one-million',
      label: '1M',
      maxTotalTokens: 1_000_000,
      activation: { kind: 'implicit' as const },
      entitlement: 'granted' as const,
    };
    const fixed = model({
      contextTiers: [tier],
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        maxContext: { state: 'fixed', fixedValue: true, tierId: 'one-million' },
        reasoning: noReasoning,
      },
    });
    const selectable = model({
      contextTiers: [model().contextTiers[0], tier],
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        maxContext: { state: 'selectable', defaultValue: false, entitlement: 'granted', tierId: 'one-million' },
        reasoning: noReasoning,
      },
    });
    expect(resolveModelControls(fixed).resolved.maxContext)
      .toMatchObject({ state: 'fixed', value: true, disabled: true, tierId: 'one-million' });
    expect(resolveModelControls(selectable, { maxContextMode: true }).resolved.maxContext)
      .toMatchObject({ state: 'selectable', value: true, disabled: false, tierId: 'one-million' });
    expect(resolveModelControls(model(), { maxContextMode: true }).resolved.maxContext)
      .toMatchObject({ state: 'unsupported', value: false, disabled: true });
  });

  it('blocks Max mode when the pointed tier is not larger than the default window', () => {
    const smallerMax = model({
      contextTiers: [
        {
          id: 'default',
          label: 'Default',
          maxTotalTokens: 256_000,
          activation: { kind: 'implicit' },
          entitlement: 'granted',
        },
        {
          id: 'max',
          label: 'Max',
          maxTotalTokens: 200_000,
          activation: { kind: 'implicit' },
          entitlement: 'granted',
        },
      ],
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        maxContext: { state: 'selectable', defaultValue: false, entitlement: 'granted', tierId: 'max' },
        reasoning: noReasoning,
      },
    });

    const result = resolveModelControls(smallerMax, { maxContextMode: true });
    expect(result.resolved.maxContext).toMatchObject({
      state: 'blocked',
      value: false,
      disabled: true,
      reason: 'Max mode tier is not larger than the default context window.',
    });
    expect(result.controls.maxContextMode).toBe(false);
    expect(result.error?.code).toBe('MAX_CONTEXT_BLOCKED');
  });

  it('chooses the most specific Fast + Max binding', () => {
    const combined = model({
      contextTiers: [
        model().contextTiers[0],
        {
          id: 'one-million',
          label: '1M',
          maxTotalTokens: 1_000_000,
          activation: { kind: 'implicit' },
          entitlement: 'granted',
        },
      ],
      controls: {
        fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
        maxContext: { state: 'selectable', defaultValue: false, entitlement: 'granted', tierId: 'one-million' },
        reasoning: noReasoning,
      },
      executionBindings: [
        { id: 'fast', when: { fast: true }, actions: [{ kind: 'request-patch', patch: { speed: 'fast' } }], entitlement: 'granted' },
        { id: 'fast+1m', when: { fast: true, maxContext: true }, actions: [{ kind: 'request-patch', patch: { speed: 'fast-long' } }], entitlement: 'granted' },
      ],
    });
    expect(resolveModelControls(combined, { fastModel: true, maxContextMode: true }).binding?.id)
      .toBe('fast+1m');
  });
});
