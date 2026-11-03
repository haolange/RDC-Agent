import type { TranslationKey } from '../../../i18n';
import type {
  KnowledgeCardType,
  KnowledgeCaseChapter,
  KnowledgeLifecycle,
  KnowledgeRetrievalLane,
  KnowledgeScopeAxis,
} from '@shared/types/knowledge';

export const SCOPE_LABEL_KEYS: Record<KnowledgeScopeAxis, TranslationKey> = {
  project: 'knowledgeCenter.scope.project',
  engine: 'knowledgeCenter.scope.engine',
  engineVersion: 'knowledgeCenter.scope.engineVersion',
  api: 'knowledgeCenter.scope.api',
  platform: 'knowledgeCenter.scope.platform',
  gpuVendor: 'knowledgeCenter.scope.gpuVendor',
  gpuArch: 'knowledgeCenter.scope.gpuArch',
  device: 'knowledgeCenter.scope.device',
  driver: 'knowledgeCenter.scope.driver',
  capture: 'knowledgeCenter.scope.capture',
  pipelineStage: 'knowledgeCenter.scope.pipelineStage',
  pass: 'knowledgeCenter.scope.pass',
  shaderFamily: 'knowledgeCenter.scope.shaderFamily',
  materialFamily: 'knowledgeCenter.scope.materialFamily',
  quality: 'knowledgeCenter.scope.quality',
  resolution: 'knowledgeCenter.scope.resolution',
  featureConfiguration: 'knowledgeCenter.scope.featureConfiguration',
};

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
  retired: 'knowledgeCenter.lifecycleRetired',
};

export const LANE_LABEL_KEYS: Record<KnowledgeRetrievalLane, TranslationKey> = {
  'Identity/Path': 'knowledgeCenter.laneIdentityPath',
  'Scope/Metadata': 'knowledgeCenter.laneScopeMetadata',
  Lexical: 'knowledgeCenter.laneLexical',
  Structural: 'knowledgeCenter.laneStructural',
  'Relation/Graph': 'knowledgeCenter.laneRelationGraph',
  'Temporal/Version': 'knowledgeCenter.laneTemporalVersion',
};

/** Local `YYYY-MM-DD HH:mm`; empty when the card carries no timestamp. */
export function formatKnowledgeTime(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
