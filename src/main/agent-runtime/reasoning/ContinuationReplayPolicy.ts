import type { RequestPlan } from '@shared/types/providerCapability';
import type { ProviderContinuationArtifact } from '@shared/types/reasoning';
import { verifyContinuationArtifact } from './ContinuationArtifacts';

export type ContinuationReplayAction = 'replay' | 'provider-managed' | 'drop';
export type ContinuationReplayReason =
  | 'exact-execution'
  | 'same-provider-model'
  | 'same-compatibility-group'
  | 'provider-managed'
  | 'no-artifact'
  | 'invalid-integrity'
  | 'contract-discard'
  | 'scope-ended'
  | 'container-mismatch'
  | 'execution-mismatch'
  | 'model-not-admitted'
  | 'retention-expired'
  | 'unsupported-policy';

export interface ContinuationReplayContext {
  sameToolLoop: boolean;
  providerBlockKey?: string;
  itemId?: string;
  toolCallIds?: string[];
}

export interface ContinuationReplayDecision {
  action: ContinuationReplayAction;
  reason: ContinuationReplayReason;
}

export function decideContinuationReplay(
  artifact: ProviderContinuationArtifact | undefined,
  target: RequestPlan,
  context: ContinuationReplayContext,
): ContinuationReplayDecision {
  if (!artifact) return drop('no-artifact');
  if (!verifyContinuationArtifact(artifact)) return drop('invalid-integrity');
  const admittedModels = target.contracts.reasoning.continuationModelIds;
  if (admittedModels && !admittedModels.includes(target.effectiveModelId)) {
    return drop('model-not-admitted');
  }
  if (
    target.contracts.toolLoop.artifactPolicy === 'discard'
    || artifact.scope === 'none'
    || artifact.scope === 'unknown'
  ) return drop('contract-discard');
  if (artifact.scope === 'tool-call-turn' && !context.sameToolLoop) return drop('scope-ended');
  if (!containerMatches(artifact, context)) return drop('container-mismatch');

  switch (artifact.continuationPolicy) {
    case 'exact-execution':
      return exactExecutionMatches(artifact, target) ? replay('exact-execution') : drop('execution-mismatch');
    case 'same-provider-model':
      return sameProviderModelMatches(artifact, target) ? replay('same-provider-model') : drop('execution-mismatch');
    case 'same-compatibility-group':
      return sameCompatibilityGroupMatches(artifact, target)
        ? replay('same-compatibility-group')
        : drop('execution-mismatch');
    case 'provider-managed':
      return providerStateMatches(artifact, target)
        ? { action: 'provider-managed', reason: 'provider-managed' }
        : drop('execution-mismatch');
    default:
      return drop('unsupported-policy');
  }
}

function exactExecutionMatches(artifact: ProviderContinuationArtifact, target: RequestPlan): boolean {
  const source = artifact.origin;
  const next = target.executionIdentity;
  return source.providerId === next.providerId
    && source.credentialScopeHash === next.credentialScopeHash
    && source.endpointHash === next.endpointHash
    && source.protocolFamily === next.protocolFamily
    && source.protocolDialect === next.protocolDialect
    && source.protocolVersion === next.protocolVersion
    && source.catalogRevision === next.catalogRevision
    && source.routeRevision === next.routeRevision
    && source.selectedModelId === next.selectedModelId
    && source.effectiveModelId === next.effectiveModelId
    && source.canonicalModelId === next.canonicalModelId
    && source.modelSnapshotId === next.modelSnapshotId
    && source.variantKey === next.variantKey
    && equalArray(source.bindingIds, next.bindingIds)
    && source.reasoningMode === next.reasoningMode
    && source.contextMode === next.contextMode
    && source.stateMode === next.stateMode
    && source.artifactFormat === next.artifactFormat
    && source.artifactVersion === next.artifactVersion
    && source.contractHash === next.contractHash;
}

function sameProviderModelMatches(artifact: ProviderContinuationArtifact, target: RequestPlan): boolean {
  const source = artifact.origin;
  const next = target.executionIdentity;
  return sameProviderBoundary(artifact, target)
    && source.effectiveModelId === next.effectiveModelId
    && source.canonicalModelId === next.canonicalModelId
    && source.modelSnapshotId === next.modelSnapshotId
    && source.variantKey === next.variantKey
    && source.reasoningMode === next.reasoningMode;
}

function sameCompatibilityGroupMatches(artifact: ProviderContinuationArtifact, target: RequestPlan): boolean {
  const next = target.executionIdentity;
  return sameProviderBoundary(artifact, target)
    && artifact.compatibilityGroup === target.contracts.reasoning.compatibilityGroup
    && artifact.compatibilityGroup === next.compatibilityGroup;
}

function sameProviderBoundary(artifact: ProviderContinuationArtifact, target: RequestPlan): boolean {
  const source = artifact.origin;
  const next = target.executionIdentity;
  return source.providerId === next.providerId
    && source.credentialScopeHash === next.credentialScopeHash
    && source.endpointHash === next.endpointHash
    && source.protocolFamily === next.protocolFamily
    && source.protocolDialect === next.protocolDialect
    && source.protocolVersion === next.protocolVersion
    && artifact.format === next.artifactFormat
    && artifact.version === next.artifactVersion;
}

function providerStateMatches(artifact: ProviderContinuationArtifact, target: RequestPlan): boolean {
  return target.statePlan.mode === 'provider-managed'
    && target.contracts.reasoning.continuation === 'provider-managed'
    && sameProviderBoundary(artifact, target);
}

function containerMatches(
  artifact: ProviderContinuationArtifact,
  context: ContinuationReplayContext,
): boolean {
  if (artifact.mutationPolicy !== 'container-bound') return true;
  const binding = artifact.containerBinding;
  if (!binding || binding.providerBlockKey !== context.providerBlockKey) return false;
  if (binding.itemId && binding.itemId !== context.itemId) return false;
  return !binding.toolCallIds || equalArray(binding.toolCallIds, context.toolCallIds ?? []);
}

function equalArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const replay = (reason: ContinuationReplayReason): ContinuationReplayDecision => ({ action: 'replay', reason });
const drop = (reason: ContinuationReplayReason): ContinuationReplayDecision => ({ action: 'drop', reason });
