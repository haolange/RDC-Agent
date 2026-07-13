import { describe, expect, it } from 'vitest';
import type { ContextTier } from '../types/providerCapability';
import { resolveContextTierChoices } from './contextTiers';

const tier = (
  id: string,
  maxPromptTokens: number | undefined,
  entitlement: ContextTier['entitlement'],
): ContextTier => ({
  id,
  label: id,
  ...(maxPromptTokens ? { maxPromptTokens } : {}),
  activation: { kind: 'implicit' },
  entitlement,
});

describe('resolveContextTierChoices', () => {
  it('selects the highest granted tier before an even higher unknown tier', () => {
    const choices = resolveContextTierChoices({ contextTiers: [
      tier('default', 272_000, 'granted'),
      tier('long', 922_000, 'granted'),
      tier('experimental', 1_500_000, 'unknown'),
    ] });
    expect(choices.baseTier?.id).toBe('default');
    expect(choices.maxTier?.id).toBe('long');
    expect(choices.maxTierUnverified).toBe(false);
  });

  it('exposes one strictly higher unknown tier as unverified', () => {
    const choices = resolveContextTierChoices({ contextTiers: [
      tier('default', 200_000, 'granted'),
      tier('long', 1_000_000, 'unknown'),
    ] });
    expect(choices.maxTier?.id).toBe('long');
    expect(choices.maxTierUnverified).toBe(true);
  });

  it('hides denied, lower, and unrankable unknown alternatives', () => {
    for (const candidate of [
      tier('denied', 1_000_000, 'denied'),
      tier('lower', 100_000, 'unknown'),
      tier('unranked', undefined, 'unknown'),
    ]) {
      expect(resolveContextTierChoices({ contextTiers: [
        tier('default', 200_000, 'granted'),
        candidate,
      ] }).maxTier).toBeUndefined();
    }
  });

  it('never turns a single large tier into Max mode', () => {
    const choices = resolveContextTierChoices({
      contextTiers: [tier('default', 1_050_000, 'granted')],
    });
    expect(choices.baseTier?.id).toBe('default');
    expect(choices.maxTier).toBeUndefined();
  });

  it('does not expose a lower granted tier when the default tier is already highest', () => {
    const choices = resolveContextTierChoices({ contextTiers: [
      tier('default', 1_000_000, 'granted'),
      tier('legacy', 200_000, 'granted'),
    ] });
    expect(choices.baseTier?.id).toBe('default');
    expect(choices.maxTier).toBeUndefined();
  });
});
