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
import {
  effectiveCatalogService,
  type CatalogModelContribution,
} from './EffectiveCatalogService';
import {
  planEffectiveModelRequest,
  recordEffectivePlanSuccess,
  resolveEffectiveModel,
} from './EffectiveModelResolver';
import { settingsService } from './SettingsService';
import {
  executeCapabilityProbe,
  type CapabilityProbeExecution,
} from './ProviderCapabilityProbeRuntime';

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
  recordSuccess: (request: LlmModelCapabilityProbeRequest, target: ResolvedProbeTarget, plan: RequestPlan) => void;
  recordFailure: (
    request: LlmModelCapabilityProbeRequest,
    target: ResolvedProbeTarget,
    plan: RequestPlan,
    status: number,
  ) => boolean;
}

function identity(target: ResolvedProbeTarget, plan: RequestPlan) {
  return {
    providerId: target.provider.id,
    accountId: target.provider.activeAccountId ?? `anonymous:${target.provider.id}`,
    protocol: plan.route.protocol,
  };
}

export function buildProbeFailurePatch(
  request: LlmModelCapabilityProbeRequest,
  target: ResolvedProbeTarget,
  plan: RequestPlan,
  status: number,
): CatalogModelContribution | null {
  if (status === 404) {
    return {
      modelId: target.model.modelId,
      availability: 'unavailable',
      unavailableReason: 'Explicit model probe returned HTTP 404.',
    };
  }
  if (request.mode === 'max-context' && (status === 400 || status === 403)) {
    return { modelId: target.model.modelId, contextTiers: [{ id: plan.activeTierId, entitlement: 'denied' }] };
  }
  if (request.mode === 'fast' && (status === 400 || status === 403)
    && target.model.fast.kind !== 'unknown' && target.model.fast.kind !== 'unsupported') {
    return { modelId: target.model.modelId, fast: { ...target.model.fast, entitlement: 'denied' } };
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
  plan: (request, controls) => planEffectiveModelRequest({
    providerId: request.providerId,
    modelId: request.modelId,
    settings: settingsService.getAll(),
    controls,
  }),
  execute: executeCapabilityProbe,
  recordSuccess: (request, target, plan) => {
    recordEffectivePlanSuccess(request.providerId, request.modelId, settingsService.getAll(), plan);
    if (target.model.availability === 'unknown') {
      effectiveCatalogService.recordObserved(identity(target, plan), [{
        modelId: target.model.modelId,
        availability: 'available',
      }], 'Explicit model capability probe succeeded');
    }
  },
  recordFailure: (request, target, plan, status) => {
    const patch = buildProbeFailurePatch(request, target, plan, status);
    if (!patch) return false;
    effectiveCatalogService.recordObserved(
      identity(target, plan),
      [patch],
      `Explicit ${request.mode} capability probe rejected with HTTP ${status}`,
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

export class ProviderCapabilityProbeService {
  constructor(private readonly dependencies = productionDependencies) {}

  async test(request: LlmModelCapabilityProbeRequest): Promise<LlmModelCapabilityProbeResult> {
    const target = this.dependencies.resolve(request);
    if (!target || target.model.availability === 'unavailable' || !target.model.enabled) {
      return { success: false, status: 'failed', requestSent: false, detail: 'Model is not configured and available.' };
    }
    const choices = resolveContextTierChoices(target.model);
    if (request.mode === 'max-context') {
      if (!choices.maxTier) {
        return { success: false, status: 'denied', requestSent: false, detail: 'No selectable Max tier.' };
      }
      if (choices.maxTier.entitlement === 'unknown' && choices.maxTier.activation.kind === 'implicit') {
        return {
          success: false,
          status: 'inconclusive',
          requestSent: false,
          detail: 'An implicit long-context tier requires a real request that crosses the default service threshold.',
        };
      }
    }
    if (request.mode === 'fast'
      && (target.model.fast.kind === 'unknown'
        || target.model.fast.kind === 'unsupported'
        || target.model.fast.entitlement === 'denied')) {
      return { success: false, status: 'denied', requestSent: false, detail: 'Fast activation is not selectable.' };
    }

    const controls = {
      reasoningLevel: target.model.reasoning.supportsOff ? 'off' : target.model.reasoning.defaultSelection,
      maxContextMode: request.mode === 'max-context',
      fastModel: request.mode === 'fast',
    };
    const planning = this.dependencies.plan(request, controls);
    if (!planning.ok) {
      return { success: false, status: 'failed', requestSent: false, detail: planning.message };
    }
    if ((request.mode === 'max-context' && !planning.controls.maxContextMode)
      || (request.mode === 'fast' && !planning.controls.fastModel)) {
      return { success: false, status: 'denied', requestSent: false, detail: 'The active model constraints rejected this mode.' };
    }

    try {
      await this.dependencies.execute({ request, ...target, plan: planning.plan });
      this.dependencies.recordSuccess(request, target, planning.plan);
      return { success: true, status: 'verified', requestSent: true };
    } catch (error) {
      const status = statusFromError(error);
      const recorded = status !== undefined
        && this.dependencies.recordFailure(request, target, planning.plan, status);
      return {
        success: false,
        status: recorded ? 'denied' : 'failed',
        requestSent: true,
        detail: errorDetail(error),
      };
    }
  }
}

export const providerCapabilityProbeService = new ProviderCapabilityProbeService();
