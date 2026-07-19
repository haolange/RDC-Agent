import { createHash } from 'node:crypto';
import type { RequestPlan } from '@shared/types/providerCapability';
import type {
  ContinuationArtifactMetadata,
  ContinuationArtifactMutationPolicy,
  ProviderContinuationArtifact,
} from '@shared/types/reasoning';

export interface ContinuationArtifactPayload {
  type: string;
  id?: string;
  encryptedContent?: string;
  signature?: string;
  thoughtSignature?: string;
  reasoningContent?: string;
  redactedContent?: string;
  opaqueState?: string;
  raw?: Record<string, unknown>;
  containerBinding?: ProviderContinuationArtifact['containerBinding'];
}

export function createContinuationArtifact(
  requestPlan: RequestPlan,
  payload: ContinuationArtifactPayload,
): ProviderContinuationArtifact | undefined {
  const admittedModels = requestPlan.contracts.reasoning.continuationModelIds;
  if (admittedModels && !admittedModels.includes(requestPlan.effectiveModelId)) {
    return undefined;
  }
  const contract = requestPlan.contracts;
  if (
    contract.reasoning.continuation === 'none'
    || contract.reasoning.continuation === 'unknown'
    || contract.toolLoop.artifactPolicy === 'discard'
    || contract.toolLoop.artifactPolicy === 'unknown'
  ) return undefined;

  const canonicalPayload = {
    type: payload.type,
    id: payload.id,
    encryptedContent: payload.encryptedContent,
    signature: payload.signature,
    thoughtSignature: payload.thoughtSignature,
    reasoningContent: payload.reasoningContent,
    redactedContent: payload.redactedContent,
    opaqueState: payload.opaqueState,
    raw: payload.raw,
    containerBinding: payload.containerBinding,
  };
  const envelope = {
    carrier: contract.reasoning.carrier,
    format: contract.reasoning.artifactFormat,
    version: contract.reasoning.artifactVersion,
    compatibilityGroup: contract.reasoning.compatibilityGroup,
    continuationPolicy: contract.reasoning.continuation,
    requirement: contract.toolLoop.artifactPolicy === 'provider-managed' ? 'optional' as const : 'required' as const,
    scope: contract.toolLoop.artifactScope,
    mutationPolicy: resolveMutationPolicy(contract.toolLoop.artifactPolicy),
    originFingerprint: requestPlan.executionIdentity.fingerprint,
    origin: {
      ...requestPlan.executionIdentity,
      bindingIds: [...requestPlan.executionIdentity.bindingIds],
    },
    ...canonicalPayload,
  };
  return {
    ...envelope,
    integrityHash: hashCanonical(continuationIntegrityEnvelope(envelope)),
  };
}

export function toContinuationMetadata(
  artifact: ProviderContinuationArtifact | undefined,
): ContinuationArtifactMetadata | undefined {
  if (!artifact) return undefined;
  return {
    type: artifact.type,
    carrier: artifact.carrier,
    format: artifact.format,
    version: artifact.version,
    compatibilityGroup: artifact.compatibilityGroup,
    continuationPolicy: artifact.continuationPolicy,
    requirement: artifact.requirement,
    scope: artifact.scope,
    mutationPolicy: artifact.mutationPolicy,
    originFingerprint: artifact.originFingerprint,
    integrityHash: artifact.integrityHash,
  };
}

export function verifyContinuationArtifact(artifact: ProviderContinuationArtifact): boolean {
  return artifact.originFingerprint === artifact.origin.fingerprint
    && artifact.integrityHash === hashCanonical(continuationIntegrityEnvelope(artifact));
}

export function normalizeContinuationArtifact(value: unknown): ProviderContinuationArtifact | undefined {
  if (!isRecord(value) || !isExecutionIdentity(value.origin)) return undefined;
  if (
    typeof value.type !== 'string'
    || typeof value.carrier !== 'string'
    || typeof value.format !== 'string'
    || typeof value.version !== 'string'
    || typeof value.compatibilityGroup !== 'string'
    || typeof value.continuationPolicy !== 'string'
    || typeof value.originFingerprint !== 'string'
    || typeof value.integrityHash !== 'string'
    || (value.requirement !== 'optional' && value.requirement !== 'required')
    || !isMutationPolicy(value.mutationPolicy)
  ) return undefined;
  const artifact = value as unknown as ProviderContinuationArtifact;
  return verifyContinuationArtifact(artifact) ? artifact : undefined;
}

function continuationIntegrityEnvelope(
  artifact: Omit<ProviderContinuationArtifact, 'integrityHash'> | ProviderContinuationArtifact,
): unknown {
  return {
    carrier: artifact.carrier,
    format: artifact.format,
    version: artifact.version,
    compatibilityGroup: artifact.compatibilityGroup,
    continuationPolicy: artifact.continuationPolicy,
    requirement: artifact.requirement,
    scope: artifact.scope,
    mutationPolicy: artifact.mutationPolicy,
    originFingerprint: artifact.originFingerprint,
    origin: artifact.origin,
    type: artifact.type,
    id: artifact.id,
    encryptedContent: artifact.encryptedContent,
    signature: artifact.signature,
    thoughtSignature: artifact.thoughtSignature,
    reasoningContent: artifact.reasoningContent,
    redactedContent: artifact.redactedContent,
    opaqueState: artifact.opaqueState,
    raw: artifact.raw,
    containerBinding: artifact.containerBinding,
  };
}

function resolveMutationPolicy(
  policy: RequestPlan['contracts']['toolLoop']['artifactPolicy'],
): ContinuationArtifactMutationPolicy {
  if (policy === 'preserve-thought-signature') return 'container-bound';
  if (policy === 'provider-managed') return 'provider-managed';
  if (policy === 'preserve-exact') return 'verbatim-ordered';
  return 'verbatim';
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (isRecord(value)) {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + stableJson(value[key]))
      .join(',') + '}';
  }
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isExecutionIdentity(value: unknown): boolean {
  return isRecord(value)
    && value.schemaVersion === 1
    && typeof value.providerId === 'string'
    && typeof value.fingerprint === 'string'
    && typeof value.contractHash === 'string';
}

function isMutationPolicy(value: unknown): value is ContinuationArtifactMutationPolicy {
  return value === 'verbatim'
    || value === 'verbatim-ordered'
    || value === 'container-bound'
    || value === 'provider-managed';
}
