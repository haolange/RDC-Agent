import { describe, expect, it } from 'vitest';
import type { ContextTier } from '../types/providerCapability';
import {
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

describe('resolveContextTierChoices', () => {
  it('keeps prompt cap and complete window as separate contracts', () => {
    const copilot = tier('long', { maxPromptTokens: 922_000, maxOutputTokens: 128_000 }, 'granted');
    expect(contextTierPromptCap(copilot)).toBe(922_000);
    expect(contextTierWindowTokens(copilot)).toBe(1_050_000);

    const total = tier('total', { maxTotalTokens: 1_000_000, maxOutputTokens: 64_000 }, 'granted');
    expect(contextTierPromptCap(total)).toBe(936_000);
    expect(contextTierWindowTokens(total)).toBe(1_000_000);

    const bounded = tier('bounded', {
      maxPromptTokens: 200_000,
      maxOutputTokens: 128_000,
      maxTotalTokens: 200_000,
    }, 'granted');
    expect(contextTierPromptCap(bounded)).toBe(72_000);
    expect(contextTierWindowTokens(bounded)).toBe(200_000);
  });

  it('lets one 1M-class tier serve normal and 1M modes', () => {
    const choices = resolveContextTierChoices({ contextTiers: [
      tier('default', { maxPromptTokens: 922_000, maxOutputTokens: 128_000 }, 'granted'),
    ] });
    expect(choices.normalTier?.id).toBe('default');
    expect(choices.oneMillionTier?.id).toBe('default');
    expect(choices.oneMillionUnverified).toBe(false);
  });

  it('uses an eligible long tier and keeps unknown entitlement explicit', () => {
    const choices = resolveContextTierChoices({ contextTiers: [
      tier('default', { maxTotalTokens: 200_000 }, 'granted'),
      tier('long', { maxPromptTokens: 922_000, maxOutputTokens: 128_000 }, 'unknown'),
    ] });
    expect(choices.normalTier?.id).toBe('default');
    expect(choices.oneMillionTier?.id).toBe('long');
    expect(choices.oneMillionUnverified).toBe(true);
  });

  it('does not expose denied or sub-1M tiers as 1M', () => {
    for (const candidate of [
      tier('denied', { maxTotalTokens: 1_000_000 }, 'denied'),
      tier('grok-4.5', { maxTotalTokens: 500_000 }, 'granted'),
      tier('glm-5', { maxPromptTokens: 200_000 }, 'unknown'),
    ]) {
      expect(resolveContextTierChoices({ contextTiers: [candidate] }).oneMillionTier).toBeUndefined();
    }
  });

  it('keeps future windows capped to the same explicit 1M product mode', () => {
    const choices = resolveContextTierChoices({ contextTiers: [
      tier('future', { maxTotalTokens: 2_000_000, maxOutputTokens: 128_000 }, 'granted'),
    ] });
    expect(choices.oneMillionTier?.id).toBe('future');
  });
});
