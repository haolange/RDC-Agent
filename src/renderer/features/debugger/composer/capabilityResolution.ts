import type { EffectiveModel } from '@shared/types/providerCapability';

export type CapabilityUnavailableReason =
  | 'missing-model'
  | 'missing-revision'
  | 'route-mismatch';

export type CapabilityResolutionState =
  | { status: 'unconfigured' }
  | { status: 'syncing-route' }
  | { status: 'loading' }
  | { status: 'ready'; model: EffectiveModel }
  | { status: 'refreshing'; model: EffectiveModel }
  | { status: 'unavailable'; reason: CapabilityUnavailableReason; message: string }
  | { status: 'error'; message: string };

export interface ExpectedCapabilityRoute {
  providerId: string;
  modelId: string;
}

export class CapabilityRequestGate {
  private currentRevision = 0;

  begin(): number {
    this.currentRevision += 1;
    return this.currentRevision;
  }

  invalidate(): void {
    this.currentRevision += 1;
  }

  isCurrent(revision: number): boolean {
    return revision === this.currentRevision;
  }
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
