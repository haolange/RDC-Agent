import type { RequestPlan } from '@shared/types/providerCapability';
import type { ThinkingArtifactSource } from '@shared/types/reasoning';

export type ReasoningProjectionKind = 'summary' | 'raw' | 'opaque';

export function reasoningProjectionSource(
  requestPlan: RequestPlan,
  kind: ReasoningProjectionKind,
): ThinkingArtifactSource {
  return requestPlan.contracts.reasoning.projectionSources?.[kind] ?? 'unknown';
}
