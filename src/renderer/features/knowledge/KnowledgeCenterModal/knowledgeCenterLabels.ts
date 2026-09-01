import type { TranslationKey } from '../../../i18n';
import type {
  KnowledgeCardType,
  KnowledgeCaseChapter,
  KnowledgeLifecycle,
  KnowledgeRetrievalLane,
} from '@shared/types/knowledge';
import type { SemanticLaneStatus } from '@shared/types/embedding';

export const TYPE_LABEL_KEYS: Record<KnowledgeCardType, TranslationKey> = {
  fact: 'knowledgeCenter.typeFact',
  constraint: 'knowledgeCenter.typeConstraint',
  pattern: 'knowledgeCenter.typePattern',
  procedure: 'knowledgeCenter.typeProcedure',
  case: 'knowledgeCenter.typeCase',
  model: 'knowledgeCenter.typeModel',
};

export const LIFECYCLE_LABEL_KEYS: Record<KnowledgeLifecycle, TranslationKey> = {
  draft: 'knowledgeCenter.lifecycleDraft',
  candidate: 'knowledgeCenter.lifecycleCandidate',
  verified: 'knowledgeCenter.lifecycleVerified',
  promoted: 'knowledgeCenter.lifecyclePromoted',
  deprecated: 'knowledgeCenter.lifecycleDeprecated',
};

export const LANE_LABEL_KEYS: Record<KnowledgeRetrievalLane, TranslationKey> = {
  'Identity/Path': 'knowledgeCenter.laneIdentityPath',
  'Scope/Metadata': 'knowledgeCenter.laneScopeMetadata',
  Lexical: 'knowledgeCenter.laneLexical',
  Structural: 'knowledgeCenter.laneStructural',
  Semantic: 'knowledgeCenter.laneSemantic',
  'Relation/Graph': 'knowledgeCenter.laneRelationGraph',
  'Temporal/Version': 'knowledgeCenter.laneTemporalVersion',
};

export const CHAPTER_LABEL_KEYS: Record<KnowledgeCaseChapter, TranslationKey> = {
  claim: 'knowledgeCenter.chapterClaim',
  scopeExclusions: 'knowledgeCenter.chapterScopeExclusions',
  symptoms: 'knowledgeCenter.chapterSymptoms',
  evidence: 'knowledgeCenter.chapterEvidence',
  rootCause: 'knowledgeCenter.chapterRootCause',
  experimentVerification: 'knowledgeCenter.chapterExperiment',
  fix: 'knowledgeCenter.chapterFix',
  negative: 'knowledgeCenter.chapterNegative',
  openChallenges: 'knowledgeCenter.chapterOpenChallenges',
  derived: 'knowledgeCenter.chapterDerived',
};

export function semanticReasonKey(status: SemanticLaneStatus): TranslationKey {
  switch (status.reason) {
    case 'unconfigured':
      return 'knowledgeCenter.semanticReasonUnconfigured';
    case 'consent-denied':
      return 'knowledgeCenter.semanticReasonConsentDenied';
    case 'model-unknown':
      return 'knowledgeCenter.semanticReasonModelUnknown';
    case 'provider-unconfigured':
      return 'knowledgeCenter.semanticReasonProviderUnconfigured';
    case 'missing-snapshot':
      return 'knowledgeCenter.semanticReasonMissingSnapshot';
    case 'identity-mismatch':
      return 'knowledgeCenter.semanticReasonIdentityMismatch';
    case 'dimension-mismatch':
      return 'knowledgeCenter.semanticReasonDimensionMismatch';
    case 'rebuild-required':
      return 'knowledgeCenter.semanticReasonRebuildRequired';
    default:
      return status.availability === 'stale'
        ? 'knowledgeCenter.semanticStale'
        : 'knowledgeCenter.semanticUnavailable';
  }
}
