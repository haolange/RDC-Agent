import type { TranslationKey } from '../../../i18n';
import type {
  KnowledgeCardType,
  KnowledgeCaseChapter,
  KnowledgeLifecycle,
  KnowledgeRetrievalLane,
  KnowledgeScopeAxis,
} from '@shared/types/knowledge';

export const SCOPE_LABELS: Record<KnowledgeScopeAxis, readonly [string, string]> = {
  project: ['Project', '项目'], engine: ['Engine', '引擎'], engineVersion: ['Engine version', '引擎版本'],
  api: ['API', 'API'], platform: ['Platform', '平台'], gpuVendor: ['GPU vendor', 'GPU 厂商'],
  gpuArch: ['GPU architecture', 'GPU 架构'], device: ['Device', '设备'], driver: ['Driver', '驱动'],
  capture: ['Capture', '抓帧'], pipelineStage: ['Pipeline stage', '管线阶段'], pass: ['Pass', '渲染通道'],
  shaderFamily: ['Shader family', '着色器族'], materialFamily: ['Material family', '材质族'],
  quality: ['Quality', '质量'], resolution: ['Resolution', '分辨率'],
  featureConfiguration: ['Configuration', '功能配置'],
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
  deprecated: 'knowledgeCenter.lifecycleDeprecated',
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
