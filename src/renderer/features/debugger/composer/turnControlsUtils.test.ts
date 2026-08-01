import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  buildInitialTurnControls,
  hasSelectableFastMode,
  hasSelectableOneMillionContext,
  isFastModeDenied,
  isFastModeUnverified,
  isOneMillionContextDenied,
  isOneMillionContextUnverified,
  sanitizeTurnControls,
} from './turnControlsUtils';

const levelsCapability: EffectiveModel = {
  providerId: 'openai',
  modelId: 'gpt-5.5',
  label: 'GPT-5.5', aliases: [], enabled: true,
  route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test', source: 'catalog' },
  availability: 'available',
  presencePolicy: 'maintained',
  contextTiers: [
    { id: 'default', label: 'Default', maxPromptTokens: 256_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
    { id: 'max', label: 'Max', maxPromptTokens: 1_050_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
  ],
  defaultBudgetTokens: 256_000,
  controls: {
    reasoning: {
      kind: 'levels',
      supportsOff: true,
      levels: ['low', 'medium', 'high', 'xhigh'],
      defaultSelection: 'medium',
      wireProfile: { kind: 'none' },
    },
    fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
    context1m: { state: 'selectable', defaultValue: false, entitlement: 'granted', tierId: 'max' },
  },
  executionBindings: [{
    id: 'fast:priority', when: { fast: true }, actions: [{ kind: 'request-patch', patch: { service_tier: 'priority' } }], entitlement: 'granted',
  }],
  toolCalling: { state: 'supported' }, visionInput: { state: 'supported' }, structuredOutput: { state: 'supported' },
  provenance: [],
};

describe('turnControlsUtils', () => {
  it('clamps unsupported reasoning levels to the nearest supported level', () => {
    expect(sanitizeTurnControls({
      reasoningLevel: 'max',
      maxContextMode: true,
      fastModel: true,
    }, levelsCapability)).toEqual({
      reasoningLevel: 'xhigh',
      maxContextMode: true,
      fastModel: true,
    });
  });

  it('disables unavailable fast and 1M toggles when capability is absent', () => {
    expect(sanitizeTurnControls({
      reasoningLevel: 'medium',
      maxContextMode: true,
      fastModel: true,
    }, {
      ...levelsCapability,
      contextTiers: levelsCapability.contextTiers.slice(0, 1),
      controls: {
        ...levelsCapability.controls,
        fast: { state: 'unsupported', fixedValue: false },
        context1m: { state: 'unsupported', fixedValue: false },
      },
    })).toEqual({
      reasoningLevel: 'medium',
      maxContextMode: false,
      fastModel: false,
    });
  });

  it('rejects noncanonical reasoning values instead of translating removed aliases', () => {
    expect(sanitizeTurnControls({
      reasoningLevel: 'noncanonical',
      maxContextMode: false,
      fastModel: false,
    }, levelsCapability)).toEqual({
      reasoningLevel: 'medium',
      maxContextMode: false,
      fastModel: false,
    });

    expect(sanitizeTurnControls({
      reasoningLevel: 'auto',
      maxContextMode: false,
      fastModel: false,
    }, {
      ...levelsCapability,
      controls: {
        ...levelsCapability.controls,
        reasoning: {
          kind: 'toggle',
          supportsOff: true,
          levels: [],
          defaultSelection: 'off',
          wireProfile: { kind: 'none' },
        },
      },
    })).toEqual({
      reasoningLevel: 'off',
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

    const fixedModes = {
      ...levelsCapability,
      controls: {
        ...levelsCapability.controls,
        context1m: { state: 'fixed' as const, fixedValue: true, tierId: 'max' },
        fast: { state: 'fixed' as const, fixedValue: true, entitlement: 'granted' as const },
      },
    };
    expect(buildInitialTurnControls(fixedModes)).toEqual({
      reasoningLevel: 'medium',
      maxContextMode: true,
      fastModel: true,
    });
    expect(hasSelectableOneMillionContext(fixedModes)).toBe(false);
  });

  it('shows a higher unknown tier as unverified while keeping it non-selectable', () => {
    const unknownTier = {
      ...levelsCapability,
      controls: {
        ...levelsCapability.controls,
        context1m: { ...levelsCapability.controls.context1m, entitlement: 'unknown' as const },
      },
      contextTiers: levelsCapability.contextTiers.map((tier, index) => (
        index === 1 ? { ...tier, entitlement: 'unknown' as const } : tier
      )),
    };
    expect(hasSelectableOneMillionContext(unknownTier)).toBe(false);
    expect(isOneMillionContextUnverified(unknownTier)).toBe(true);
    expect(hasSelectableOneMillionContext({
      ...unknownTier,
      contextTiers: unknownTier.contextTiers.map((tier, index) => (
        index === 1 ? { ...tier, entitlement: 'denied' as const } : tier
      )),
    })).toBe(false);
  });

  it('keeps structural Fast/Max visible when entitlement is denied or unverified', () => {
    const deniedFast = {
      ...levelsCapability,
      controls: {
        ...levelsCapability.controls,
        fast: { state: 'selectable' as const, defaultValue: false, entitlement: 'denied' as const },
        context1m: { state: 'selectable' as const, defaultValue: false, entitlement: 'denied' as const, tierId: 'max' },
      },
    };
    expect(hasSelectableFastMode(deniedFast)).toBe(false);
    expect(isFastModeDenied(deniedFast)).toBe(true);
    expect(isOneMillionContextDenied(deniedFast)).toBe(true);

    const unverifiedFast = {
      ...levelsCapability,
      controls: {
        ...levelsCapability.controls,
        fast: { state: 'selectable' as const, defaultValue: false, entitlement: 'unknown' as const },
      },
    };
    expect(hasSelectableFastMode(unverifiedFast)).toBe(false);
    expect(isFastModeUnverified(unverifiedFast)).toBe(true);

    const unsupported = {
      ...levelsCapability,
      controls: {
        ...levelsCapability.controls,
        fast: { state: 'unsupported' as const, fixedValue: false },
        context1m: { state: 'unsupported' as const, fixedValue: false },
      },
    };
    expect(hasSelectableFastMode(unsupported)).toBe(false);
    expect(hasSelectableOneMillionContext(unsupported)).toBe(false);
  });
});
