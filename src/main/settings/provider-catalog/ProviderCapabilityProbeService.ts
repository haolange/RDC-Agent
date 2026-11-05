import { getLoadedProviderSurface } from '../../provider-catalog/ProviderCatalogRegistry';
import { settingsService } from '../settings-core/SettingsService';
import {
  freezeProviderRuntimeCredentials,
  releaseProviderRuntimeCredentials,
} from '../provider-auth/ProviderRuntimeCredentialLease';
import { effectiveCatalogService } from './EffectiveCatalogService';
import { buildProbeFailurePatch, buildProbeSuccessPatch, classifyCapabilityProbeFailure, probeConfirmation, isProbeAvailabilityDenied } from './ProviderProbeEvidence';
import {
  executeCapabilityProbe,
  type CapabilityProbeExecution,
} from './ProviderCapabilityProbeRuntime';
import {
  planEffectiveModelCapabilityProbe,
  resolveEffectiveCatalog,
} from './EffectiveModelResolver';
import type { AssistantMessage } from '../../agent-runtime/core/types';
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
const OBSERVED_ENTITLEMENT_TTL_MS = 24 * 60 * 60 * 1000;
const PROBE_QUOTA_RETRY_MS = 60 * 1000;

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

const productionDependencies: ProviderCapabilityProbeDependencies = {
  resolve: (request) => {
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === request.providerId);
    const model = resolveEffectiveCatalog(request.providerId, settings)?.models.find(candidate =>
      candidate.selection?.pickerVisibility !== 'internal'
      && (candidate.modelId === request.modelId || candidate.aliases.includes(request.modelId)));
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
    const patch = buildProbeSuccessPatch(request, target, plan);
    if (patch) {
      effectiveCatalogService.recordObserved(
        identity(target, plan),
        evidenceId,
        [patch],
        'Explicit model capability probe succeeded',
        OBSERVED_ENTITLEMENT_TTL_MS,
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
    observedModelId: message.execution?.modelId,
    requestedServiceTier: typeof plan.bodyPatch.service_tier === 'string' ? plan.bodyPatch.service_tier : undefined,
    serviceTier: message.execution?.serviceTier,
    usage: {
      inputTokens: message.usage.inputTokens,
      outputTokens: message.usage.outputTokens,
      totalTokens: message.usage.totalTokens,
      ...(message.usage.speed ? { speed: message.usage.speed } : {}),
    },
  };
}

function targetFingerprint(target: ResolvedProbeTarget | null): string {
  if (!target) return '';
  return JSON.stringify([target.provider.activeAccountId, target.provider.secretRef, target.provider.connectionValues,
    target.provider.protocol, target.provider.baseUrl, target.provider.enabled, target.provider.isConfigured,
    target.model.routeRevision, target.model.catalogRevision, target.model.enabled]);
}

export class ProviderCapabilityProbeService {
  private active = false;
  constructor(private readonly dependencies = productionDependencies) {}

  async test(request: LlmModelCapabilityProbeRequest, callerSignal?: AbortSignal): Promise<LlmModelCapabilityProbeResult> {
    if (this.active) return { success: false, status: 'failed', requestSent: false, detail: 'A capability request is already running.' };
    this.active = true;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('Capability request timed out after 60s.')), 60_000);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal;
    try { return await this.run(request, signal); }
    finally { clearTimeout(timer); this.active = false; }
  }

  private async run(request: LlmModelCapabilityProbeRequest, signal: AbortSignal): Promise<LlmModelCapabilityProbeResult> {
    const target = this.dependencies.resolve(request);
    if (!target || (target.model.availability === 'unavailable' && !isProbeAvailabilityDenied(target.model)) || !target.model.enabled) {
      return { success: false, status: 'failed', requestSent: false, detail: 'Model is not configured and available.' };
    }
    const fingerprint = targetFingerprint(target);
    const wantsMax = request.mode === 'max-context' || request.mode === 'fast-max-context';
    const wantsFast = request.mode === 'fast' || request.mode === 'fast-max-context';
    if (wantsMax && !('tierId' in target.model.controls.maxContext)) {
      return { success: false, status: 'denied', requestSent: false, detail: 'No selectable Max mode.' };
    }
    if (wantsFast && target.model.controls.fast.state !== 'selectable') {
      return { success: false, status: 'denied', requestSent: false, detail: 'Fast activation is not selectable.' };
    }
    const reasoning = target.model.controls.reasoning;
    const planning = this.dependencies.plan(request, {
      reasoningLevel: reasoning.supportsOff ? 'off' : reasoning.levels[0] ?? reasoning.defaultSelection,
      maxContextMode: wantsMax,
      fastModel: wantsFast,
    });
    if (!planning.ok) return { success: false, status: 'failed', requestSent: false, detail: planning.message };
    if ((wantsMax && !planning.controls.maxContextMode) || (wantsFast && !planning.controls.fastModel)) {
      return { success: false, status: 'denied', requestSent: false, detail: 'The active model constraints rejected this mode.' };
    }

    let credentialHandle: string | undefined;
    let requestSent = false;
    try {
      signal.throwIfAborted();
      credentialHandle = await this.dependencies.freezeCredentials(request.providerId);
      signal.throwIfAborted();
      if (fingerprint !== targetFingerprint(this.dependencies.resolve(request))) {
        return { success: false, status: 'inconclusive', requestSent, detail: 'Provider configuration changed before dispatch.' };
      }
      requestSent = true;
      const message = await this.dependencies.execute({ request, ...target, plan: planning.plan, credentialHandle, signal });
      const evidence = probeEvidence(target, planning.plan, message);
      signal.throwIfAborted();
      if (fingerprint !== targetFingerprint(this.dependencies.resolve(request))) {
        return { success: false, status: 'inconclusive', requestSent, evidence, detail: 'Provider configuration changed; result discarded.' };
      }
      const issue = probeConfirmation(request, target, planning.plan, message);
      if (issue) return { success: false, status: 'inconclusive', requestSent, ...issue, evidence };
      this.dependencies.recordSuccess(request, target, planning.plan);
      return { success: true, status: 'verified', requestSent, evidence };
    } catch (error) {
      if (signal.aborted) {
        return { success: false, status: signal.reason?.name === 'AbortError' ? 'cancelled' : 'failed', requestSent,
          detail: signal.reason instanceof Error ? signal.reason.message : 'Capability request cancelled.' };
      }
      const status = statusFromError(error);
      const detail = errorDetail(error);
      const current = fingerprint === targetFingerprint(this.dependencies.resolve(request));
      const recorded = current && requestSent && status !== undefined
        && this.dependencies.recordFailure(request, target, planning.plan, status, detail);
      return {
        success: false, status: recorded ? 'denied' : 'failed', requestSent,
        ...(recorded ? { failureKind: 'entitlement-denied' as const } : status
          ? { failureKind: classifyCapabilityProbeFailure(status, false, detail) as LlmModelCapabilityProbeResult['failureKind'] } : {}),
        detail: recorded ? 'Not available for current account.' : detail,
      };
    } finally {
      if (credentialHandle) this.dependencies.releaseCredentials(credentialHandle);
    }
  }
}

export const providerCapabilityProbeService = new ProviderCapabilityProbeService();
