import { resolvePermissionReviewModel } from '@shared/utils/agentModelRoute';
import {
  planEffectiveModelRequest,
  resolveEffectiveModel,
} from '../../settings/provider-catalog/EffectiveModelResolver';
import {
  freezeProviderRuntimeCredentials,
  releaseProviderRuntimeCredentials,
} from '../../settings/provider-auth/ProviderRuntimeCredentialLease';
import { resolveAgentRouteCapability } from '../capabilities/RouteCapabilityResolver';
import { resolveCompactionPercentForProject } from '../context/compactionPercent';
import { PermissionReviewError } from './PermissionReviewRuntime';
import type { AgentModelSettings } from '@shared/types/settings';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { ProviderLookup } from '../../settings/settings-core/providerUserState';

/**
 * The auto-review route of one turn, frozen with the turn: the review model from Settings (its own binding, else the
 * default), its request plan and reasoning contract. It never falls back to the turn's own model.
 */
export type PermissionReviewRoute =
  | {
      status: 'ready';
      requestPlan: RequestPlan;
      reasoning: AgentRouteCapability['reasoningContract'];
    }
  | { status: 'unavailable'; reason: string };

export function freezePermissionReviewRoute(input: {
  agentModels: AgentModelSettings;
  providers: ProviderLookup;
  projectRootPath: string | null | undefined;
}): PermissionReviewRoute {
  const resolved = resolvePermissionReviewModel(input.agentModels);
  if (!resolved.route) return { status: 'unavailable', reason: 'no review or default model is set in Settings.' };
  const { providerId, modelId } = resolved.route;
  const effectiveModel = resolveEffectiveModel(providerId, modelId, input.providers);
  if (!effectiveModel) return { status: 'unavailable', reason: `${providerId}/${modelId} is not an available model.` };
  const planning = planEffectiveModelRequest({
    providerId,
    modelId,
    providers: input.providers,
    controls: resolved.reasoningLevel ? { reasoningLevel: resolved.reasoningLevel } : {},
    compactionThresholdPercent: resolveCompactionPercentForProject(input.projectRootPath ?? null),
  });
  if (!planning.ok) return { status: 'unavailable', reason: `${planning.code}: ${planning.message}` };
  const capability = resolveAgentRouteCapability(
    input.providers.get(providerId),
    modelId,
    effectiveModel,
    planning.plan,
  );
  return { status: 'ready', requestPlan: planning.plan, reasoning: capability.reasoningContract };
}

/**
 * Runs one review on the frozen route with a credential leased for this request alone; the turn's own lease is reused
 * when the review uses the same provider. An unavailable route refuses; it never borrows the turn's model.
 */
export async function withPermissionReviewRoute<T>(
  route: PermissionReviewRoute,
  turn: { providerId: string; credentialHandle: string },
  review: (ready: Extract<PermissionReviewRoute, { status: 'ready' }>, credentialHandle: string) => Promise<T>,
  lease: (providerId: string) => Promise<string> = async (providerId) =>
    (await freezeProviderRuntimeCredentials(providerId)).handle,
): Promise<T> {
  if (route.status === 'unavailable')
    throw new PermissionReviewError('PERMISSION_REVIEW_ROUTE_UNAVAILABLE', route.reason);
  if (route.requestPlan.providerId === turn.providerId) return review(route, turn.credentialHandle);
  let handle: string;
  try {
    handle = await lease(route.requestPlan.providerId);
  } catch (error) {
    throw new PermissionReviewError(
      'PERMISSION_REVIEW_ROUTE_UNAVAILABLE',
      `review credentials are unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return await review(route, handle);
  } finally {
    releaseProviderRuntimeCredentials(handle);
  }
}
