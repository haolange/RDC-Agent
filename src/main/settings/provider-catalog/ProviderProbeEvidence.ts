import type { AssistantMessage } from '../../agent-runtime/core/types';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { LlmModelCapabilityProbeRequest, LlmModelCapabilityProbeResult } from '@shared/types/settings';
import type { CatalogModelContribution } from './effectiveCatalogTypes';
import type { ResolvedProbeTarget } from './ProviderCapabilityProbeService';

export type CapabilityProbeFailureKind =
  | 'entitlement-denied'
  | 'quota-exhausted'
  | 'authentication-failed'
  | 'route-unavailable'
  | 'unknown';

export function classifyCapabilityProbeFailure(
  status: number,
  manifestDeclaresEntitlementDenial = false,
  detail = '',
): CapabilityProbeFailureKind {
  if (manifestDeclaresEntitlementDenial) return 'entitlement-denied';
  if (status === 401) return 'authentication-failed';
  if (status === 404) return 'route-unavailable';
  if (status === 429) return 'quota-exhausted';
  const normalizedDetail = detail.toLowerCase();
  if (status === 402 && (
    normalizedDetail.includes('quota_exceeded')
    || normalizedDetail.includes('quota exceeded')
    || normalizedDetail.includes('usage limit')
    || normalizedDetail.includes('out of budget')
    || normalizedDetail.includes('insufficient balance')
    || normalizedDetail.includes('insufficient_balance')
  )) return 'quota-exhausted';
  return 'unknown';
}


export const PROBE_AVAILABILITY_DENIAL = 'capability-probe:availability-denied';

export function isProbeAvailabilityDenied(model: EffectiveModel): boolean {
  return model.availability === 'unavailable' && model.provenance.filter(e => e.field === 'availability')
    .at(-1)?.sourceRevision === PROBE_AVAILABILITY_DENIAL;
}

export function buildProbeSuccessPatch(
  request: LlmModelCapabilityProbeRequest,
  target: ResolvedProbeTarget,
  plan: RequestPlan,
): CatalogModelContribution | null {
  const patch: CatalogModelContribution = { modelId: target.model.modelId };
  if (target.model.availability === 'unknown' || isProbeAvailabilityDenied(target.model)) patch.availability = 'available';
  const fast = request.mode === 'fast' || request.mode === 'fast-max-context';
  const max = request.mode === 'max-context' || request.mode === 'fast-max-context';
  if (fast && target.model.controls.fast.state === 'selectable') {
    patch.controls = { fast: { ...target.model.controls.fast, entitlement: 'granted' } };
  }
  if (max) {
    if (target.model.controls.maxContext.state === 'selectable') {
      patch.controls = { ...patch.controls, maxContext: { ...target.model.controls.maxContext, entitlement: 'granted' } };
    }
    patch.contextTiers = target.model.contextTiers.map(tier => (
      tier.id === plan.activeTierId ? { ...tier, entitlement: 'granted' } : tier
    ));
  }
  if (fast || max) patch.executionBindings = target.model.executionBindings?.map(binding => (
    plan.appliedBindingIds.includes(binding.id) ? { ...binding, entitlement: 'granted' } : binding
  ));
  return patch.availability || patch.controls || patch.contextTiers || patch.executionBindings ? patch : null;
}

export function buildProbeFailurePatch(
  request: LlmModelCapabilityProbeRequest,
  target: ResolvedProbeTarget,
  plan: RequestPlan,
  status: number,
  manifestMatchesDenial = false,
): CatalogModelContribution | null {
  const kind = classifyCapabilityProbeFailure(status, manifestMatchesDenial);
  if (request.mode === 'default' && kind === 'entitlement-denied') {
    return { modelId: target.model.modelId, availability: 'unavailable',
      controls: {
        ...(target.model.controls.fast.state === 'selectable' ? { fast: { ...target.model.controls.fast, entitlement: 'denied' as const } } : {}),
        ...(target.model.controls.maxContext.state === 'selectable' ? { maxContext: { ...target.model.controls.maxContext, entitlement: 'denied' as const } } : {}),
      },
      unavailableReason: 'Current account subscription does not have access to this model.',
      factSource: { sourceKind: 'runtime-observation', sourceRevision: PROBE_AVAILABILITY_DENIAL } };
  }
  if (request.mode === 'fast-max-context' && kind === 'entitlement-denied') {
    return { modelId: target.model.modelId, executionBindings: target.model.executionBindings?.map(binding =>
      plan.appliedBindingIds.includes(binding.id) && binding.when.fast === true && binding.when.maxContext === true
        ? { ...binding, entitlement: 'denied' as const } : binding) };
  }
  if (request.mode === 'max-context' && kind === 'entitlement-denied') {
    return {
      modelId: target.model.modelId,
      controls: target.model.controls.maxContext.state === 'selectable'
        ? { maxContext: { ...target.model.controls.maxContext, entitlement: 'denied' } }
        : undefined,
      contextTiers: [{ id: plan.activeTierId, entitlement: 'denied' }],
      executionBindings: target.model.executionBindings?.map((binding) => (
        plan.appliedBindingIds.includes(binding.id)
          ? { ...binding, entitlement: 'denied' }
          : binding
      )),
    };
  }
  if (request.mode === 'fast' && kind === 'entitlement-denied'
    && target.model.controls.fast.state === 'selectable') {
    return {
      modelId: target.model.modelId,
      controls: { fast: { ...target.model.controls.fast, entitlement: 'denied' } },
      executionBindings: target.model.executionBindings?.map((binding) => (
        plan.appliedBindingIds.includes(binding.id)
          ? { ...binding, entitlement: 'denied' }
          : binding
      )),
    };
  }
  return null;
}


/** A short successful request cannot prove a larger implicit/client-only context. */
export function probeConfirmation(
  request: LlmModelCapabilityProbeRequest, target: ResolvedProbeTarget, plan: RequestPlan, message: AssistantMessage,
): Pick<LlmModelCapabilityProbeResult, 'detail' | 'detailCode'> | undefined {
  if (message.stopReason !== 'stop' || !message.content.some(part => part.type === 'text' && part.text.trim())) {
    return { detail: `Provider did not complete the minimal response (${message.stopReason}).` };
  }
  if (request.mode === 'fast' || request.mode === 'fast-max-context') {
    const actions = target.model.executionBindings?.filter(b => plan.appliedBindingIds.includes(b.id) && b.when.fast === true)
      .flatMap(b => b.actions) ?? [];
    const confirmed = actions.some(action => {
      if (action.kind === 'model-switch') return message.execution?.modelId === action.targetModelId;
      if (action.kind === 'request-patch') {
        if (action.patch.service_tier === 'priority') return message.execution?.serviceTier === 'priority';
        if (action.patch.speed === 'fast') return message.usage.speed === 'fast';
      }
      return false;
    });
    if (!confirmed) {
      if (plan.bodyPatch.service_tier === 'priority') {
        const tier = message.execution?.serviceTier;
        if (tier === 'default') return { detailCode: 'fast-tier-default', detail: 'The provider reported default; actual Fast processing is unconfirmed.' };
        if (!tier) return { detailCode: 'fast-tier-missing', detail: 'The provider did not report the actual service tier.' };
        return { detailCode: 'fast-tier-other', detail: 'The provider returned a different service tier from the requested priority tier.' };
      }
      return { detail: 'Provider did not confirm the selected Fast speed or target model.' };
    }
  }
  if (request.mode === 'max-context' || request.mode === 'fast-max-context') {
    const tier = target.model.contextTiers.find(t => t.id === plan.activeTierId);
    if (!tier || (tier.entitlement !== 'granted' && tier.activation.kind === 'implicit')) {
      return { detail: 'Minimal request completed; no authoritative account evidence confirms the larger context window.' };
    }
  }
  return undefined;
}
