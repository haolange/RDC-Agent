import type {
  SemanticLaneAvailability,
  SemanticLaneStatus,
  SemanticLaneStaleReason,
  SemanticLaneUnavailableReason,
} from '@shared/types/embedding';
import type { TranslationKey } from '../../i18n';

export function isSemanticLaneReady(status: SemanticLaneStatus | null | undefined): boolean {
  return status?.availability === 'ready' && status.reason === 'ready';
}

export function embeddingAvailabilityKey(
  status: SemanticLaneStatus | null | undefined,
): TranslationKey {
  if (isSemanticLaneReady(status)) return 'settings.embeddingStatusReady';
  if (status?.availability === 'stale') return 'settings.embeddingStatusStale';
  return 'settings.embeddingStatusUnavailable';
}

const UNAVAILABLE_REASON_KEYS: Record<SemanticLaneUnavailableReason, TranslationKey> = {
  unconfigured: 'knowledgeCenter.semanticReasonUnconfigured',
  'consent-denied': 'knowledgeCenter.semanticReasonConsentDenied',
  'model-unknown': 'knowledgeCenter.semanticReasonModelUnknown',
  'provider-unconfigured': 'knowledgeCenter.semanticReasonProviderUnconfigured',
};

const STALE_REASON_KEYS: Record<SemanticLaneStaleReason, TranslationKey> = {
  'missing-snapshot': 'knowledgeCenter.semanticReasonMissingSnapshot',
  'identity-mismatch': 'knowledgeCenter.semanticReasonIdentityMismatch',
  'dimension-mismatch': 'knowledgeCenter.semanticReasonDimensionMismatch',
  'chunker-mismatch': 'knowledgeCenter.semanticReasonChunkerMismatch',
  'corpus-hash-mismatch': 'knowledgeCenter.semanticReasonCorpusHashMismatch',
  'catalog-revision-mismatch': 'knowledgeCenter.semanticReasonCatalogRevisionMismatch',
  'incomplete-vectors': 'knowledgeCenter.semanticReasonIncompleteVectors',
  'invalid-vectors': 'knowledgeCenter.semanticReasonInvalidVectors',
  'rebuild-required': 'knowledgeCenter.semanticReasonRebuildRequired',
};

export function semanticReasonKey(status: SemanticLaneStatus): TranslationKey {
  if (status.reason === 'ready') return 'settings.embeddingStatusReady';
  if (status.reason in UNAVAILABLE_REASON_KEYS) {
    return UNAVAILABLE_REASON_KEYS[status.reason as SemanticLaneUnavailableReason];
  }
  if (status.reason in STALE_REASON_KEYS) {
    return STALE_REASON_KEYS[status.reason as SemanticLaneStaleReason];
  }
  return status.availability === 'stale'
    ? 'knowledgeCenter.semanticStale'
    : 'knowledgeCenter.semanticUnavailable';
}

export function embeddingAvailabilityOf(
  status: SemanticLaneStatus | null | undefined,
): Exclude<SemanticLaneAvailability, never> {
  if (isSemanticLaneReady(status)) return 'ready';
  if (status?.availability === 'stale') return 'stale';
  return 'unavailable';
}
