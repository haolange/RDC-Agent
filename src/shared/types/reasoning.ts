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

type ContinuationArtifactRequirement = 'optional' | 'required';
type ContinuationArtifactScope = ProviderContractBundle['toolLoop']['artifactScope'];
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

export interface ThinkingArtifact {
  text?: string;
  kind: ThinkingArtifactKind;
  source: ThinkingArtifactSource;
  visibility: ThinkingArtifactVisibility;
  continuation?: ContinuationArtifactMetadata;
  providerOutputRef?: ProviderOutputRef;
}

/**
 * Event-level shape of one provider response's reasoning stream: how many of each reasoning event arrived and,
 * per summary part, how much text streamed versus what the completion events carried. Lengths only, never text.
 */
export interface ReasoningEventSummary {
  events: Record<string, number>;
  summaryParts: Array<{ itemKey: string; index: number; streamedChars: number; completedChars?: number; recovered: boolean }>;
}
