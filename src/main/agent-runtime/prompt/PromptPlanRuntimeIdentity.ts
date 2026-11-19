import type { PromptPlan } from '@shared/types/rdcRuntime';
import { charsToTokens } from '@shared/utils/tokens';
import type { RdcContextLease } from '../../rdc/RdcRuntimeContextRegistry';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { runtimeIdentityContent } from './RuntimeIdentity';

/** A new replay identity changes only the volatile identity segment of the frozen PromptPlan. */
export function refreshPromptPlanRuntimeIdentity(plan: PromptPlan, sessionId: string, permissionRevision: number | null, lease: RdcContextLease | null): PromptPlan {
  const identity = plan.segments.filter(segment => segment.id === 'runtime:identity');
  if (identity.length !== 1 || identity[0].stability !== 'volatile') throw new Error('RDC_REPREPARE_IDENTITY_MISSING');
  const content = runtimeIdentityContent(sessionId, permissionRevision, lease);
  const segments = plan.segments.map(segment => segment === identity[0]
    ? { ...segment, content, sourceHash: hashScopedResource(content), tokenEstimate: charsToTokens(content.length) } : segment);
  const systemPrompt = segments.map(segment => segment.content).join('\n\n');
  return { ...plan, segments, systemPrompt, totalTokenEstimate: segments.reduce((sum, segment) => sum + segment.tokenEstimate, 0),
    metrics: { ...plan.metrics, systemPrompt: plan.metrics.systemPrompt + content.length - identity[0].content.length } };
}
