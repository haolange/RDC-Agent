import { describe, expect, it } from 'vitest';
import type { ContextTier, EffectiveModel } from '../types/providerCapability';
import {
  contextTierBudgetTokens,
  contextTierOutputTokens,
  contextTierPromptCap,
  contextTierWindowTokens,
  resolveContextTierChoices,
  resolvePlanningOutputTokens,
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

function input(contextTiers: ContextTier[], maxContext: EffectiveModel['controls']['maxContext']) {
  return {
    contextTiers,
    controls: {
      fast: { state: 'unsupported' as const, fixedValue: false },
      maxContext,
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
    expect(contextTierOutputTokens(copilot)).toBe(128_000);
    expect(contextTierOutputTokens(total)).toBe(64_000);
    expect(contextTierOutputTokens(tier('prompt-only', { maxPromptTokens: 272_000 }, 'granted'))).toBeUndefined();
    expect(resolvePlanningOutputTokens(copilot, 1_050_000)).toBe(128_000);
    expect(resolvePlanningOutputTokens(
      tier('prompt-only', { maxPromptTokens: 272_000 }, 'granted'),
      272_000,
    )).toBe(272_000);
  });

  it('uses the requested budget when a tier has no prompt cap', () => {
    const uncapped = tier('open', {}, 'granted');
    expect(contextTierPromptCap(uncapped)).toBeUndefined();
    expect(contextTierBudgetTokens(uncapped, 256_000)).toBe(256_000);
  });

  it('resolves Max only from the explicitly referenced tier', () => {
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
    expect(choices.maxTier?.id).toBe('long');
    expect(choices.maxTierUnverified).toBe(true);
  });

  it('allows a fixed Max tier to be both normal and Max', () => {
    const choices = resolveContextTierChoices(input([
      tier('default', { maxTotalTokens: 1_000_000 }, 'granted'),
    ], { state: 'fixed', fixedValue: true, tierId: 'default' }));
    expect(choices.normalTier?.id).toBe('default');
    expect(choices.maxTier?.id).toBe('default');
  });

  it('does not infer Max from a numeric window when the control is unsupported', () => {
    const choices = resolveContextTierChoices(input([
      tier('future', { maxTotalTokens: 2_000_000 }, 'granted'),
    ], { state: 'unsupported', fixedValue: false }));
    expect(choices.normalTier?.id).toBe('future');
    expect(choices.maxTier).toBeUndefined();
  });

  it('fails closed when the pointed Max tier is not larger than the default window', () => {
    const choices = resolveContextTierChoices(input([
      tier('default', { maxTotalTokens: 256_000 }, 'granted'),
      tier('max', { maxTotalTokens: 200_000 }, 'granted'),
    ], {
      state: 'selectable', defaultValue: false, entitlement: 'granted', tierId: 'max',
    }));
    expect(choices.normalTier?.id).toBe('default');
    expect(choices.maxTier).toBeUndefined();
  });

  it('accepts a sub-million Max tier when it is strictly larger than the default window', () => {
    const choices = resolveContextTierChoices(input([
      tier('default', { maxTotalTokens: 272_000 }, 'granted'),
      tier('max', { maxTotalTokens: 872_000 }, 'unknown'),
    ], {
      state: 'selectable', defaultValue: false, entitlement: 'unknown', tierId: 'max',
    }));
    expect(choices.normalTier?.id).toBe('default');
    expect(choices.maxTier?.id).toBe('max');
    expect(choices.maxTierUnverified).toBe(true);
  });

  it('fails closed when the explicit tier is missing or denied', () => {
    expect(resolveContextTierChoices(input([
      tier('default', { maxTotalTokens: 256_000 }, 'granted'),
    ], {
      state: 'selectable', defaultValue: false, entitlement: 'granted', tierId: 'missing',
    })).maxTier).toBeUndefined();
    expect(resolveContextTierChoices(input([
      tier('long', { maxTotalTokens: 1_000_000 }, 'denied'),
    ], {
      state: 'fixed', fixedValue: true, tierId: 'long',
    })).maxTier).toBeUndefined();
  });
});
