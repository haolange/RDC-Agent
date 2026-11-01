import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import { isAgentToolExecutableModel, classifyAgentToolEligibility, describeAgentToolIneligibility } from '@shared/utils/agentToolCapability';

export type CapabilityUnavailableReason =
  | 'missing-model'
  | 'missing-revision'
  | 'route-mismatch';
// Provider availability is evaluated before a cached catalog may be used.

export type CapabilityResolutionState =
  | { status: 'unconfigured' }
  | { status: 'syncing-route' }
  | { status: 'loading' }
  | { status: 'ready'; model: EffectiveModel }
  | { status: 'refreshing'; model: EffectiveModel }
  | { status: 'unavailable'; reason: CapabilityUnavailableReason | 'provider-unavailable'; message: string }
  | { status: 'error'; message: string };

export interface ExpectedCapabilityRoute {
  providerId: string;
  modelId: string;
}

export function resolveCatalogCapability(
  expected: ExpectedCapabilityRoute,
  projection: { snapshot: EffectiveCatalogSnapshot | null; loading: boolean; error?: string } | undefined,
): CapabilityResolutionState {
  const model = projection?.snapshot?.models.find((entry) => entry.modelId === expected.modelId) ?? null;
  if (!projection || ((projection.loading || projection.snapshot?.refreshing) && (!model || model.availability === 'unknown'))) {
    return { status: 'loading' };
  }
  if (projection.error && (!model || model.availability === 'unknown')) return { status: 'error', message: projection.error };
  const next = validateCapabilityResolution(expected, model);
  return next.status === 'ready' && (projection.loading || projection.snapshot?.refreshing)
    ? { status: 'refreshing', model: next.model } : next;
}

export function resolvedCapability(state: CapabilityResolutionState): EffectiveModel | null {
  return state.status === 'ready' || state.status === 'refreshing' ? state.model : null;
}

export function validateCapabilityResolution(
  expected: ExpectedCapabilityRoute,
  resolved: EffectiveModel | null,
): CapabilityResolutionState {
  if (!resolved) {
    return {
      status: 'unavailable',
      reason: 'missing-model',
      message: 'The committed model is not available in the effective catalog.',
    };
  }
  if (!isAgentToolExecutableModel(resolved)) {
    const eligibility = classifyAgentToolEligibility(resolved);
    return { status: 'unavailable', reason: 'missing-model', message: resolved.unavailableReason
      || (eligibility !== 'executable' ? describeAgentToolIneligibility(eligibility, expected.providerId, expected.modelId).userMessage
        : 'The selected model is not executable.') };
  }
  if (!resolved.catalogRevision || !resolved.routeRevision) {
    return {
      status: 'unavailable',
      reason: 'missing-revision',
      message: 'The effective model is missing its catalog or route revision.',
    };
  }
  if (resolved.providerId !== expected.providerId || resolved.modelId !== expected.modelId) {
    return {
      status: 'unavailable',
      reason: 'route-mismatch',
      message: 'The committed Agent route changed while capability was resolving.',
    };
  }
  return { status: 'ready', model: resolved };
}
