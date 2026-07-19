import type { ExecutionIdentity } from './providerCapability';
import type {
  ProviderContractBundle,
  ProviderReasoningContract,
  ProviderThinkingProjectionSource,
} from '../provider-catalog/modelManifestSchema';

export interface ProviderOutputRef {
  protocol: string;
  responseId?: string;
  providerBlockKey: string;
  sourceIndex?: number;
  itemId?: string;
  contentIndex: number;
}

export type ThinkingArtifactKind = 'summary' | 'raw' | 'opaque' | 'unknown';
export type ThinkingArtifactVisibility = 'summary' | 'raw-collapsed' | 'hidden';

export type ThinkingArtifactSource = ProviderThinkingProjectionSource;

export type ContinuationArtifactRequirement = 'optional' | 'required';
export type ContinuationArtifactScope = ProviderContractBundle['toolLoop']['artifactScope'];
export type ContinuationArtifactMutationPolicy =
  | 'verbatim'
  | 'verbatim-ordered'
  | 'container-bound'
  | 'provider-managed';

export interface ContinuationArtifactMetadata {
  type: string;
  continuationPolicy: ProviderReasoningContract['continuation'];
  carrier: ProviderReasoningContract['carrier'];
  format: string;
  version: string;
  compatibilityGroup: string;
  requirement: ContinuationArtifactRequirement;
  scope: ContinuationArtifactScope;
  mutationPolicy: ContinuationArtifactMutationPolicy;
  originFingerprint: string;
  integrityHash: string;
}

export interface ProviderStateRef {
  schemaVersion: 1;
  carrier: ProviderContractBundle['state']['carrier'];
  value: string;
  origin: ExecutionIdentity;
  originFingerprint: string;
  integrityHash: string;
}

export interface ProviderContinuationArtifact extends ContinuationArtifactMetadata {
  origin: ExecutionIdentity;
  id?: string;
  encryptedContent?: string;
  signature?: string;
  thoughtSignature?: string;
  redactedContent?: string;
  opaqueState?: string;
  reasoningContent?: string;
  raw?: Record<string, unknown>;
  containerBinding?: {
    providerBlockKey: string;
    itemId?: string;
    toolCallIds?: string[];
  };
}

export interface ThinkingArtifact {
  text?: string;
  kind: ThinkingArtifactKind;
  source: ThinkingArtifactSource;
  visibility: ThinkingArtifactVisibility;
  continuation?: ContinuationArtifactMetadata;
  providerOutputRef?: ProviderOutputRef;
}
