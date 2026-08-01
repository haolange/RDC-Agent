import type { AssistantMessage } from '../agent-runtime/core/types';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import type {
  EffectiveModel,
  RequestPlan,
  RequestPlanningResult,
} from '@shared/types/providerCapability';
import type {
  LlmModelCapabilityProbeRequest,
  LlmModelCapabilityProbeResult,
  LlmProviderEntry,
} from '@shared/types/settings';
import { resolveContextTierChoices } from '@shared/utils/contextTiers';
import { effectiveCatalogService } from './EffectiveCatalogService';
import type { CatalogModelContribution } from './effectiveCatalogTypes';
import {
  planEffectiveModelCapabilityProbe,
  recordEffectivePlanSuccess,
  resolveEffectiveModel,
} from './EffectiveModelResolver';
import { getLoadedProviderSurface } from '../provider-catalog/ProviderCatalogRegistry';
import { settingsService } from './SettingsService';
import {
  executeCapabilityProbe,
  type CapabilityProbeExecution,
} from './ProviderCapabilityProbeRuntime';
import {
  freezeProviderRuntimeCredentials,
  releaseProviderRuntimeCredentials,
} from './ProviderRuntimeCredentialLease';
const OBSERVED_ENTITLEMENT_TTL_MS = 24 * 60 * 60 * 1000;
const PROBE_QUOTA_RETRY_MS = 60 * 1000;

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
  )) return 'quota-exhausted';
  return 'unknown';
}


export interface ResolvedProbeTarget {
  provider: LlmProviderEntry;
  model: EffectiveModel;
}

export interface ProviderCapabilityProbeDependencies {
  resolve: (request: LlmModelCapabilityProbeRequest) => ResolvedProbeTarget | null;
  plan: (
    request: LlmModelCapabilityProbeRequest,
    controls: { reasoningLevel: ReasoningSelection; maxContextMode: boolean; fastModel: boolean },
  ) => RequestPlanningResult;
  execute: (input: CapabilityProbeExecution) => Promise<AssistantMessage>;
  freezeCredentials: (providerId: LlmProviderEntry['id']) => Promise<string>;
  releaseCredentials: (handle: string | undefined) => void;
  recordSuccess: (request: LlmModelCapabilityProbeRequest, target: ResolvedProbeTarget, plan: RequestPlan) => void;
  recordFailure: (
    request: LlmModelCapabilityProbeRequest,
    target: ResolvedProbeTarget,
    plan: RequestPlan,
    status: number,
    detail: string,
  ) => boolean;
}

function identity(target: ResolvedProbeTarget, plan: RequestPlan) {
  return {
    providerId: target.provider.id,
    accountId: target.provider.activeAccountId ?? `anonymous:${target.provider.id}`,
    protocol: plan.route.protocol,
  };
}

function manifestDeclaresEntitlementDenial(
  request: LlmModelCapabilityProbeRequest,
  plan: RequestPlan,
  status: number,
  detail: string,
): boolean {
  const model = getLoadedProviderSurface(request.providerId)?.models
    .find((candidate) => candidate.modelId === request.modelId);
  return model?.liveProjection?.entitlementDenialMatchers?.some((matcher) => (
    matcher.mode === request.mode
    && matcher.statuses.includes(status)
    && (!matcher.protocols || matcher.protocols.includes(plan.route.protocol))
    && (!matcher.messageIncludes || detail.toLowerCase().includes(matcher.messageIncludes.toLowerCase()))
  )) ?? false;
}

export function buildProbeSuccessPatch(
  request: LlmModelCapabilityProbeRequest,
  target: ResolvedProbeTarget,
  plan: RequestPlan,
): CatalogModelContribution | null {
  const availability = target.model.availability === 'unknown' ? 'available' as const : undefined;
  if (request.mode === 'fast' && target.model.controls.fast.state === 'selectable') {
    return {
      modelId: target.model.modelId,
      ...(availability ? { availability } : {}),
      controls: { fast: { ...target.model.controls.fast, entitlement: 'granted' } },
      executionBindings: target.model.executionBindings?.map((binding) => (
        plan.appliedBindingIds.includes(binding.id)
          ? { ...binding, entitlement: 'granted' }
          : binding
      )),
    };
  }
  if (request.mode === 'one-million-context') {
    return {
      modelId: target.model.modelId,
      ...(availability ? { availability } : {}),
      controls: target.model.controls.context1m.state === 'selectable'
        ? { context1m: { ...target.model.controls.context1m, entitlement: 'granted' } }
        : undefined,
      contextTiers: target.model.contextTiers.map((tier) => (
        tier.id === plan.activeTierId ? { ...tier, entitlement: 'granted' } : tier
      )),
      executionBindings: target.model.executionBindings?.map((binding) => (
        plan.appliedBindingIds.includes(binding.id)
          ? { ...binding, entitlement: 'granted' }
          : binding
      )),
    };
  }
  return availability ? { modelId: target.model.modelId, availability } : null;
}

export function buildProbeFailurePatch(
  request: LlmModelCapabilityProbeRequest,
  target: ResolvedProbeTarget,
  plan: RequestPlan,
  status: number,
  manifestMatchesDenial = false,
): CatalogModelContribution | null {
  const kind = classifyCapabilityProbeFailure(status, manifestMatchesDenial);
  if (request.mode === 'one-million-context' && kind === 'entitlement-denied') {
    return {
      modelId: target.model.modelId,
      controls: target.model.controls.context1m.state === 'selectable'
        ? { context1m: { ...target.model.controls.context1m, entitlement: 'denied' } }
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

const productionDependencies: ProviderCapabilityProbeDependencies = {
  resolve: (request) => {
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === request.providerId);
    const model = resolveEffectiveModel(request.providerId, request.modelId, settings);
    return provider && provider.isConfigured && model ? { provider, model } : null;
  },
  plan: (request, controls) => planEffectiveModelCapabilityProbe({
    providerId: request.providerId,
    modelId: request.modelId,
    mode: request.mode,
    settings: settingsService.getAll(),
    controls,
  }),
  execute: executeCapabilityProbe,
  freezeCredentials: async (providerId) => (await freezeProviderRuntimeCredentials(providerId)).handle,
  releaseCredentials: releaseProviderRuntimeCredentials,
  recordSuccess: (request, target, plan) => {
    const evidenceId = [
      'capability-probe', target.model.modelId, request.mode, plan.route.protocol,
      plan.appliedBindingIds.join(',') || 'default',
    ].join(':');
    recordEffectivePlanSuccess(request.providerId, request.modelId, settingsService.getAll(), plan);
    const patch = buildProbeSuccessPatch(request, target, plan);
    if (patch) {
      effectiveCatalogService.recordObserved(
        identity(target, plan),
        evidenceId,
        [patch],
        'Explicit model capability probe succeeded',
      );
    }
  },
  recordFailure: (request, target, plan, status, detail) => {
    const manifestMatchesDenial = manifestDeclaresEntitlementDenial(request, plan, status, detail);
    const failureKind = classifyCapabilityProbeFailure(status, manifestMatchesDenial, detail);
    if (failureKind === 'quota-exhausted') {
      effectiveCatalogService.recordTransientQuota(
        identity(target, plan),
        target.model.modelId,
        {
          exhaustedUntil: new Date(Date.now() + PROBE_QUOTA_RETRY_MS).toISOString(),
          note: `Capability probe received HTTP ${status}; retry deferred 60s`,
        },
      );
      return false;
    }
    const patch = buildProbeFailurePatch(request, target, plan, status, manifestMatchesDenial);
    if (!patch) return false;
    const evidenceId = [
      'capability-probe', target.model.modelId, request.mode, plan.route.protocol,
      plan.appliedBindingIds.join(',') || 'default',
    ].join(':');
    effectiveCatalogService.recordObserved(
      identity(target, plan),
      evidenceId,
      [patch],
      `Explicit ${request.mode} capability probe rejected with HTTP ${status}`,
      OBSERVED_ENTITLEMENT_TTL_MS,
    );
    return true;
  },
};

function statusFromError(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function errorDetail(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.slice(0, 400);
}

function probeEvidence(
  target: ResolvedProbeTarget,
  plan: RequestPlan,
  message: AssistantMessage,
): NonNullable<LlmModelCapabilityProbeResult['evidence']> {
  return {
    protocol: plan.route.protocol,
    effectiveModelId: plan.effectiveModelId || target.model.modelId,
    observedAt: new Date().toISOString(),
    usage: {
      inputTokens: message.usage.inputTokens,
      outputTokens: message.usage.outputTokens,
      totalTokens: message.usage.totalTokens,
      ...(message.usage.speed ? { speed: message.usage.speed } : {}),
    },
  };
}

export class ProviderCapabilityProbeService {
  constructor(private readonly dependencies = productionDependencies) {}

  async test(request: LlmModelCapabilityProbeRequest): Promise<LlmModelCapabilityProbeResult> {
    const target = this.dependencies.resolve(request);
    if (!target || target.model.availability === 'unavailable' || !target.model.enabled) {
      return { success: false, status: 'failed', requestSent: false, detail: 'Model is not configured and available.' };
    }
    const choices = resolveContextTierChoices(target.model);
    if (request.mode === 'one-million-context') {
      if (!choices.oneMillionTier) {
        return { success: false, status: 'denied', requestSent: false, detail: 'No selectable Max mode.' };
      }
      const explicitBinding = target.model.executionBindings?.find((binding) => (
        binding.when.context1m === true
        && binding.actions.some((action) => action.kind === 'model-switch' || action.kind === 'request-patch')
      ));
      if (choices.oneMillionTier.entitlement === 'unknown'
        && choices.oneMillionTier.activation.kind === 'implicit' && !explicitBinding) {
        return {
          success: false,
          status: 'inconclusive',
          requestSent: false,
          detail: 'An implicit long-context tier requires a real request that crosses the default service threshold.',
        };
      }
    }
    if (request.mode === 'fast' && target.model.controls.fast.state !== 'selectable') {
      return { success: false, status: 'denied', requestSent: false, detail: 'Fast activation is not selectable.' };
    }

    const controls = {
      reasoningLevel: target.model.controls.reasoning.supportsOff
        ? 'off' as const
        : target.model.controls.reasoning.defaultSelection,
      maxContextMode: request.mode === 'one-million-context',
      fastModel: request.mode === 'fast',
    };
    const planning = this.dependencies.plan(request, controls);
    if (!planning.ok) {
      return { success: false, status: 'failed', requestSent: false, detail: planning.message };
    }
    if ((request.mode === 'one-million-context' && !planning.controls.maxContextMode)
      || (request.mode === 'fast' && !planning.controls.fastModel)) {
      return { success: false, status: 'denied', requestSent: false, detail: 'The active model constraints rejected this mode.' };
    }

    let credentialHandle: string | undefined;
    try {
      credentialHandle = await this.dependencies.freezeCredentials(request.providerId);
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        requestSent: false,
        detail: errorDetail(error),
      };
    }

    try {
      const message = await this.dependencies.execute({ request, ...target, plan: planning.plan, credentialHandle });
      const evidence = probeEvidence(target, planning.plan, message);
      if (request.mode === 'fast' && message.usage.speed !== 'fast') {
        return {
          success: false,
          status: 'inconclusive',
          requestSent: true,
          detail: 'Provider did not confirm usage.speed=fast for this request.',
          evidence,
        };
      }
      this.dependencies.recordSuccess(request, target, planning.plan);
      return { success: true, status: 'verified', requestSent: true, evidence };
    } catch (error) {
      const status = statusFromError(error);
      const detail = errorDetail(error);
      const recorded = status !== undefined
        && this.dependencies.recordFailure(request, target, planning.plan, status, detail);
      return {
        success: false,
        status: recorded ? 'denied' : 'failed',
        requestSent: true,
        detail: recorded ? 'Not available for current account.' : detail,
      };
    } finally {
      this.dependencies.releaseCredentials(credentialHandle);
    }
  }
}

export const providerCapabilityProbeService = new ProviderCapabilityProbeService();
