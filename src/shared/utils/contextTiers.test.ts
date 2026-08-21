import { describe, expect, it } from 'vitest';
import type { ContextTier, EffectiveModel } from '../types/providerCapability';
import {
  contextTierBudgetTokens,
  contextTierPromptCap,
  contextTierWindowTokens,
  resolveContextTierChoices,
} from './contextTiers';

const tier = (
  id: string,
  limits: Pick<ContextTier, 'maxPromptTokens' | 'maxOutputTokens' | 'maxTotalTokens'>,
  entitlement: ContextTier['entitlement'],
): ContextTier => ({
  id,
  label: id,
  ...limits,
  activation: { kind: 'implicit' },
  entitlement,
});

const reasoning = {
  kind: 'none' as const,
  supportsOff: true,
  levels: [],
  defaultSelection: 'off' as const,
  lockedSelection: 'off' as const,
  wireProfile: { kind: 'none' as const },
};

function input(contextTiers: ContextTier[], context1m: EffectiveModel['controls']['context1m']) {
  return {
    contextTiers,
    controls: {
      fast: { state: 'unsupported' as const, fixedValue: false },
      context1m,
      reasoning,
    },
  };
}

describe('resolveContextTierChoices', () => {
  it('keeps prompt cap and complete window as separate contracts', () => {
    const copilot = tier('long', { maxPromptTokens: 922_000, maxOutputTokens: 128_000 }, 'granted');
    expect(contextTierPromptCap(copilot)).toBe(922_000);
    expect(contextTierWindowTokens(copilot)).toBe(1_050_000);
    expect(contextTierBudgetTokens(copilot, 1_000_000)).toBe(922_000);
    expect(contextTierBudgetTokens(copilot, 200_000)).toBe(200_000);

    const total = tier('total', { maxTotalTokens: 1_000_000, maxOutputTokens: 64_000 }, 'granted');
    expect(contextTierPromptCap(total)).toBe(1_000_000);
    expect(contextTierWindowTokens(total)).toBe(1_000_000);
    expect(contextTierBudgetTokens(total, 1_000_000)).toBe(1_000_000);
  });

  it('uses the requested budget when a tier has no prompt cap', () => {
    const uncapped = tier('open', {}, 'granted');
    expect(contextTierPromptCap(uncapped)).toBeUndefined();
    expect(contextTierBudgetTokens(uncapped, 256_000)).toBe(256_000);
  });

  it('resolves 1M only from the explicitly referenced tier', () => {
    const choices = resolveContextTierChoices(input([
      tier('default', { maxTotalTokens: 256_000 }, 'granted'),
      tier('long', { maxTotalTokens: 1_000_000 }, 'unknown'),
    ], {
      state: 'selectable',
      defaultValue: false,
      entitlement: 'unknown',
      tierId: 'long',
    }));
    expect(choices.normalTier?.id).toBe('default');
    expect(choices.oneMillionTier?.id).toBe('long');
    expect(choices.oneMillionUnverified).toBe(true);
  });

  it('allows a fixed 1M tier to be both normal and 1M', () => {
    const choices = resolveContextTierChoices(input([
      tier('default', { maxTotalTokens: 1_000_000 }, 'granted'),
    ], { state: 'fixed', fixedValue: true, tierId: 'default' }));
    expect(choices.normalTier?.id).toBe('default');
    expect(choices.oneMillionTier?.id).toBe('default');
  });

  it('does not infer 1M from a numeric window when the control is unsupported', () => {
    const choices = resolveContextTierChoices(input([
      tier('future', { maxTotalTokens: 2_000_000 }, 'granted'),
    ], { state: 'unsupported', fixedValue: false }));
    expect(choices.normalTier?.id).toBe('future');
    expect(choices.oneMillionTier).toBeUndefined();
  });

  it('fails closed when a billing overlay leaves Max mode below one million tokens', () => {
    const choices = resolveContextTierChoices(input([
      tier('default', { maxPromptTokens: 200_000, maxOutputTokens: 64_000 }, 'granted'),
    ], {
      state: 'fixed', fixedValue: true, tierId: 'default',
    }));
    expect(choices.normalTier?.id).toBe('default');
    expect(choices.oneMillionTier).toBeUndefined();
  });

  it('fails closed when the explicit tier is missing or denied', () => {
    expect(resolveContextTierChoices(input([
      tier('default', { maxTotalTokens: 256_000 }, 'granted'),
    ], {
      state: 'selectable', defaultValue: false, entitlement: 'granted', tierId: 'missing',
    })).oneMillionTier).toBeUndefined();
    expect(resolveContextTierChoices(input([
      tier('long', { maxTotalTokens: 1_000_000 }, 'denied'),
    ], {
      state: 'fixed', fixedValue: true, tierId: 'long',
    })).oneMillionTier).toBeUndefined();
  });
});
