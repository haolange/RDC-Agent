import type {
  ControlDefinition,
  ContextTier,
  EffectiveModel,
} from '../types/providerCapability';

export interface ContextTierChoices {
  normalTier?: ContextTier;
  maxTier?: ContextTier;
  maxTierUnverified: boolean;
}

/** Prompt/input ceiling. Does not subtract the model's max output. */
export function contextTierPromptCap(tier: ContextTier): number | undefined {
  if (typeof tier.maxPromptTokens === 'number' && tier.maxPromptTokens > 0) {
    return tier.maxPromptTokens;
  }
  if (typeof tier.maxTotalTokens === 'number' && tier.maxTotalTokens > 0) {
    return tier.maxTotalTokens;
  }
  return undefined;
}

/**
 * Declared output ceiling. A split window (prompt + output) can also derive it.
 * Missing means “no explicit cap” — callers should use the remaining window.
 */
export function contextTierOutputTokens(tier: ContextTier): number | undefined {
  if (typeof tier.maxOutputTokens === 'number' && tier.maxOutputTokens > 0) {
    return tier.maxOutputTokens;
  }
  const window = contextTierWindowTokens(tier);
  const promptCap = contextTierPromptCap(tier);
  if (window !== undefined && promptCap !== undefined && window > promptCap) {
    return window - promptCap;
  }
  return undefined;
}

/**
 * Output cap used by RequestPlanner / Composer. Explicit or derived output
 * wins; otherwise the complete window. Callers must already have a positive window.
 */
export function resolvePlanningOutputTokens(tier: ContextTier, windowTokens: number): number {
  return contextTierOutputTokens(tier) ?? windowTokens;
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

/**
 * Prompt/input budget after applying the selected context mode.
 * Matches RequestPlanner: `tierCap ? min(requestedBudget, tierCap) : requestedBudget`.
 */
export function contextTierBudgetTokens(tier: ContextTier, requestedBudget: number): number {
  const tierCap = contextTierPromptCap(tier);
  return tierCap ? Math.min(requestedBudget, tierCap) : requestedBudget;
}

/**
 * Distinct Max tier: the control-pointed tier exists, is not denied, both sides have
 * numeric windows, and the Max window is strictly larger than the normal tier.
 * A single always-on tier may still serve both modes when the control points at it.
 */
export function isEligibleMaxContextTier(
  maxTier: ContextTier,
  normalTier: ContextTier,
): boolean {
  if (maxTier.entitlement === 'denied') return false;
  const maxWindow = contextTierWindowTokens(maxTier);
  const normalWindow = contextTierWindowTokens(normalTier);
  if (maxWindow === undefined || normalWindow === undefined) return false;
  if (maxTier.id === normalTier.id) return true;
  return maxWindow > normalWindow;
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
 * Resolves normal and explicit Max modes. A distinct Max tier must have a numeric
 * window strictly larger than the normal tier. A control may also point at the
 * sole/normal tier for always-on Max.
 */
export function resolveContextTierChoices(
  model: {
    contextTiers: readonly ContextTier[];
    controls: Pick<EffectiveModel['controls'], 'maxContext'>;
  },
): ContextTierChoices {
  const usable = model.contextTiers.filter((tier) => tier.entitlement !== 'denied');
  const sourceOrder = new Map(model.contextTiers.map((tier, index) => [tier.id, index]));
  const granted = usable.filter((tier) => tier.entitlement === 'granted');
  const unknown = usable.filter((tier) => tier.entitlement === 'unknown');
  const normalTier = granted.find((tier) => tier.id === 'default')
    ?? granted[0]
    ?? unknown.find((tier) => tier.id === 'default')
    ?? unknown[0];

  if (!normalTier) return { maxTierUnverified: false };

  const contextControl = model.controls.maxContext;
  const explicitTierId = contextControl.state === 'fixed' || contextControl.state === 'selectable'
    ? contextControl.tierId
    : undefined;
  const explicitTier = explicitTierId
    ? usable.find((tier) => tier.id === explicitTierId)
    : undefined;
  const eligible = explicitTier && isEligibleMaxContextTier(explicitTier, normalTier)
    ? [explicitTier]
    : [];
  const grantedEligible = eligible.filter((tier) => tier.entitlement === 'granted');
  const unknownEligible = eligible.filter((tier) => tier.entitlement === 'unknown');
  const maxTier = highestTier(grantedEligible, sourceOrder)
    ?? highestTier(unknownEligible, sourceOrder);

  return {
    normalTier,
    maxTier,
    maxTierUnverified: maxTier?.entitlement === 'unknown',
  };
}

export function getMaxContextControl(
  model: Pick<EffectiveModel, 'controls'>,
): ControlDefinition {
  return model.controls.maxContext;
}
