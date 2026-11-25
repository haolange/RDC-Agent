import { receiptConfirmsFast, receiptConfirmsModelSwitch, receiptExceedsSmallerTiers } from './ProviderProbeEvidence';
import { effectiveCatalogService } from './EffectiveCatalogService';
import { resolveEffectiveModel } from './EffectiveModelResolver';
import type { ProviderLookup } from '../settings-core/providerUserState';
import type { AssistantMessage } from '../../agent-runtime/core/types';
import type { ExecutionBindingDefinition, RequestPlan } from '@shared/types/providerCapability';
import type { LlmProviderProtocol } from '@shared/types/settings';

/**
 * ObservedModelEvidence — catalog facts proven by what the provider actually returned: entitlements
 * confirmed by a response receipt, and structured tool calling that worked or was explicitly rejected.
 * Each observation is recorded per provider account and protocol and lapses after its TTL.
 */

function executionBindingMatchesPlan(binding: ExecutionBindingDefinition, plan: RequestPlan): boolean {
  if (binding.when.fast !== undefined && binding.when.fast !== plan.fastMode) return false;
  if (
    binding.when.maxContext !== undefined
    && binding.when.maxContext !== (plan.contextMode === 'one-million')
  ) return false;
  return !binding.when.reasoning
    || (plan.reasoningWire.selection !== 'unknown'
      && binding.when.reasoning.includes(plan.reasoningWire.selection));
}

/** Entitlements read off a response receipt lapse so a changed subscription is noticed again. */
export const OBSERVED_ENTITLEMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Records what a completed response proves about the account. Only receipt facts count: the model that
 * answered, the service tier or speed the provider reported, and a prompt larger than any smaller tier.
 * A request succeeding never grants Fast, a binding or a tier on its own.
 */
export function recordResponseReceipt(
  providerId: string,
  modelId: string,
  providers: ProviderLookup,
  plan: RequestPlan,
  message: AssistantMessage,
): void {
  const provider = providers.get(providerId);
  const model = resolveEffectiveModel(providerId, modelId, providers);
  if (!provider || !model) return;
  const activeTier = model.contextTiers.find((tier) => tier.id === plan.activeTierId);
  const grantsTier = activeTier?.entitlement === 'unknown' && receiptExceedsSmallerTiers(model, activeTier.id, message);
  const fastControl = model.controls.fast;
  const grantsFast = plan.fastMode
    && fastControl.state === 'selectable'
    && fastControl.entitlement === 'unknown'
    && receiptConfirmsFast(model, plan, message);
  const switchedBinding = model.executionBindings?.find((binding) => (
    binding.entitlement === 'unknown'
    && plan.appliedBindingIds.includes(binding.id)
    && executionBindingMatchesPlan(binding, plan)
    && receiptConfirmsModelSwitch(binding, message)
  ));
  if (!grantsTier && !grantsFast && !switchedBinding) return;
  const proven = [
    grantsTier && activeTier ? `context tier ${activeTier.id}` : '',
    grantsFast ? 'Fast mode' : '',
    switchedBinding ? `execution binding ${switchedBinding.id}` : '',
  ].filter(Boolean);
  effectiveCatalogService.recordObserved({
    providerId,
    accountId: provider.activeAccountId ?? `anonymous:${providerId}`,
    protocol: plan.route.protocol,
  }, `receipt:${model.modelId}:${plan.route.protocol}:${plan.appliedBindingIds.join(',') || plan.activeTierId}`, [{
    modelId: model.modelId,
    ...(grantsTier && activeTier
      ? {
          contextTiers: model.contextTiers.map((tier) => (
            tier.id === activeTier.id ? { ...tier, entitlement: 'granted' as const } : tier
          )),
        }
      : {}),
    ...(grantsFast && fastControl.state === 'selectable'
      ? { controls: { fast: { ...fastControl, entitlement: 'granted' as const } } }
      : {}),
    ...(switchedBinding
      ? {
          executionBindings: model.executionBindings?.map((binding) => (
            binding.id === switchedBinding.id
              ? { ...binding, entitlement: 'granted' as const }
              : binding
          )),
        }
      : {}),
  }], `Response receipt confirmed ${proven.join(' and ')}`, OBSERVED_ENTITLEMENT_TTL_MS);
}

export const OBSERVED_TOOL_CALLING_UNSUPPORTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function recordObservedToolCallingSupport(
  providerId: string,
  modelId: string,
  providers: ProviderLookup,
  protocol: LlmProviderProtocol,
): boolean {
  const provider = providers.get(providerId);
  const model = resolveEffectiveModel(providerId, modelId, providers);
  if (!provider || !model) return false;
  effectiveCatalogService.recordObserved({
    providerId,
    accountId: provider.activeAccountId ?? `anonymous:${providerId}`,
    protocol,
  }, `tool-calling:${model.modelId}:${protocol}`, [{
    modelId: model.modelId,
    toolCalling: { state: 'supported' },
  }], 'Structured tool call completed through the active provider adapter.');
  return true;
}

export function recordObservedToolCallingUnsupported(
  providerId: string,
  modelId: string,
  providers: ProviderLookup,
  protocol: LlmProviderProtocol,
  reason: string,
): boolean {
  const provider = providers.get(providerId);
  const model = resolveEffectiveModel(providerId, modelId, providers);
  if (!provider || !model) return false;
  effectiveCatalogService.recordObserved({
    providerId,
    accountId: provider.activeAccountId ?? `anonymous:${providerId}`,
    protocol,
  }, `tool-calling:${model.modelId}:${protocol}`, [{
    modelId: model.modelId,
    toolCalling: { state: 'unsupported', reason },
  }], reason, OBSERVED_TOOL_CALLING_UNSUPPORTED_TTL_MS);
  return true;
}
