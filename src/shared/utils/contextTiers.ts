import type { ContextTier, EffectiveModel } from '../types/providerCapability';

export interface ContextTierChoices {
  baseTier?: ContextTier;
  maxTier?: ContextTier;
  maxTierUnverified: boolean;
}

export function contextTierPromptCap(tier: ContextTier): number | undefined {
  if (typeof tier.maxPromptTokens === 'number' && tier.maxPromptTokens > 0) {
    return tier.maxPromptTokens;
  }
  if (typeof tier.maxTotalTokens === 'number' && tier.maxTotalTokens > 0) {
    const outputReserve = typeof tier.maxOutputTokens === 'number' && tier.maxOutputTokens > 0
      ? tier.maxOutputTokens
      : 0;
    return Math.max(1, tier.maxTotalTokens - outputReserve);
  }
  return undefined;
}

function highestTier(tiers: ContextTier[], sourceOrder: Map<string, number>): ContextTier | undefined {
  return [...tiers].sort((left, right) => {
    const leftCap = contextTierPromptCap(left);
    const rightCap = contextTierPromptCap(right);
    if (leftCap !== undefined && rightCap !== undefined && leftCap !== rightCap) {
      return rightCap - leftCap;
    }
    // Tier order is authoritative when either side has no numeric ceiling.
    // This keeps header/body/model-variant tiers usable without inventing a cap.
    return (sourceOrder.get(right.id) ?? 0) - (sourceOrder.get(left.id) ?? 0);
  })[0];
}

/**
 * Resolves the only two context choices exposed by the product.
 *
 * Max is a tier relationship, never a token threshold:
 * - two or more granted tiers select the highest granted alternative;
 * - one granted tier may expose a strictly larger unknown tier as unverified;
 * - denied tiers and unrankable unknown tiers are never selectable.
 */
export function resolveContextTierChoices(
  model: Pick<EffectiveModel, 'contextTiers'>,
): ContextTierChoices {
  const usable = model.contextTiers.filter((tier) => tier.entitlement !== 'denied');
  const sourceOrder = new Map(model.contextTiers.map((tier, index) => [tier.id, index]));
  const granted = usable.filter((tier) => tier.entitlement === 'granted');
  const unknown = usable.filter((tier) => tier.entitlement === 'unknown');
  const baseTier = granted.find((tier) => tier.id === 'default')
    ?? granted[0]
    ?? unknown.find((tier) => tier.id === 'default')
    ?? unknown[0];

  if (!baseTier) return { maxTierUnverified: false };

  if (granted.length >= 2) {
    const highestGranted = highestTier(granted, sourceOrder);
    const maxTier = highestGranted?.id === baseTier.id ? undefined : highestGranted;
    return { baseTier, maxTier, maxTierUnverified: false };
  }

  if (granted.length === 1) {
    const baseCap = contextTierPromptCap(baseTier);
    const higherUnknown = baseCap === undefined
      ? []
      : unknown.filter((tier) => {
          const cap = contextTierPromptCap(tier);
          return cap !== undefined && cap > baseCap;
        });
    const maxTier = highestTier(higherUnknown, sourceOrder);
    return { baseTier, maxTier, maxTierUnverified: Boolean(maxTier) };
  }

  return { baseTier, maxTierUnverified: false };
}
