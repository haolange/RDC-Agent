import type {
  ControlDefinition,
  ContextTier,
  EffectiveModel,
} from '../types/providerCapability';

export interface ContextTierChoices {
  normalTier?: ContextTier;
  oneMillionTier?: ContextTier;
  oneMillionUnverified: boolean;
}

export const ONE_MILLION_CONTEXT_TOKENS = 1_000_000;

export function contextTierPromptCap(tier: ContextTier): number | undefined {
  const explicitPromptCap = typeof tier.maxPromptTokens === 'number' && tier.maxPromptTokens > 0
    ? tier.maxPromptTokens
    : undefined;
  if (typeof tier.maxTotalTokens === 'number' && tier.maxTotalTokens > 0) {
    const outputReserve = typeof tier.maxOutputTokens === 'number' && tier.maxOutputTokens > 0
      ? tier.maxOutputTokens
      : 0;
    const totalDerivedCap = Math.max(1, tier.maxTotalTokens - outputReserve);
    return explicitPromptCap === undefined
      ? totalDerivedCap
      : Math.min(explicitPromptCap, totalDerivedCap);
  }
  return explicitPromptCap;
}

/** Full context window, distinct from the prompt/input ceiling. */
export function contextTierWindowTokens(tier: ContextTier): number | undefined {
  if (typeof tier.maxTotalTokens === 'number' && tier.maxTotalTokens > 0) {
    return tier.maxTotalTokens;
  }
  if (typeof tier.maxPromptTokens !== 'number' || tier.maxPromptTokens <= 0) {
    return undefined;
  }
  const outputReserve = typeof tier.maxOutputTokens === 'number' && tier.maxOutputTokens > 0
    ? tier.maxOutputTokens
    : 0;
  return tier.maxPromptTokens + outputReserve;
}

function highestTier(tiers: ContextTier[], sourceOrder: Map<string, number>): ContextTier | undefined {
  return [...tiers].sort((left, right) => {
    const leftCap = contextTierWindowTokens(left);
    const rightCap = contextTierWindowTokens(right);
    if (leftCap !== undefined && rightCap !== undefined && leftCap !== rightCap) {
      return rightCap - leftCap;
    }
    // Tier order is authoritative when either side has no numeric ceiling.
    // This keeps header/body tiers usable without inventing a cap.
    return (sourceOrder.get(right.id) ?? 0) - (sourceOrder.get(left.id) ?? 0);
  })[0];
}

/**
 * Resolves normal and explicit 1M modes. A single tier can serve both modes;
 * eligibility is based on the complete window, not only the input ceiling.
 */
export function resolveContextTierChoices(
  model: Pick<EffectiveModel, 'contextTiers' | 'controls'>,
): ContextTierChoices {
  const usable = model.contextTiers.filter((tier) => tier.entitlement !== 'denied');
  const sourceOrder = new Map(model.contextTiers.map((tier, index) => [tier.id, index]));
  const granted = usable.filter((tier) => tier.entitlement === 'granted');
  const unknown = usable.filter((tier) => tier.entitlement === 'unknown');
  const normalTier = granted.find((tier) => tier.id === 'default')
    ?? granted[0]
    ?? unknown.find((tier) => tier.id === 'default')
    ?? unknown[0];

  if (!normalTier) return { oneMillionUnverified: false };

  const contextControl = model.controls.context1m;
  const explicitTierId = contextControl.state === 'fixed' || contextControl.state === 'selectable'
    ? contextControl.tierId
    : undefined;
  const explicitTier = explicitTierId
    ? usable.find((tier) => tier.id === explicitTierId)
    : undefined;
  const eligible = explicitTier ? [explicitTier] : [];
  const grantedEligible = eligible.filter((tier) => tier.entitlement === 'granted');
  const unknownEligible = eligible.filter((tier) => tier.entitlement === 'unknown');
  const oneMillionTier = highestTier(grantedEligible, sourceOrder)
    ?? highestTier(unknownEligible, sourceOrder);

  return {
    normalTier,
    oneMillionTier,
    oneMillionUnverified: oneMillionTier?.entitlement === 'unknown',
  };
}

export function getOneMillionContextControl(
  model: Pick<EffectiveModel, 'controls'>,
): ControlDefinition {
  return model.controls.context1m;
}
