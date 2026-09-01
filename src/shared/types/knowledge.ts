/**
 * Knowledge Card contract.
 * Projection over scoped `knowledge/` markdown trees: six types, multi-axis
 * scope, relations, and lifecycle. Center consumes Query / Index / Compile /
 * Candidate / Write through thin IPC; list order comes from the service.
 */

import type { SemanticLaneStatus } from './embedding';

export const KNOWLEDGE_CARD_TYPES = [
  'fact',
  'constraint',
  'pattern',
  'procedure',
  'case',
  'model',
] as const;
export type KnowledgeCardType = (typeof KNOWLEDGE_CARD_TYPES)[number];

export const KNOWLEDGE_LIFECYCLES = [
  'draft',
  'candidate',
  'verified',
  'promoted',
  'deprecated',
] as const;
export type KnowledgeLifecycle = (typeof KNOWLEDGE_LIFECYCLES)[number];

export const KNOWLEDGE_RELATION_KINDS = [
  'supports',
  'contradicts',
  'specializes',
  'generalizes',
  'derived_from',
  'validated_by',
  'invalidated_by',
  'applies_to',
  'excludes',
  'supersedes',
  'related_to',
  'recommended_for',
  'failed_in',
] as const;
export type KnowledgeRelationKind = (typeof KNOWLEDGE_RELATION_KINDS)[number];

export const KNOWLEDGE_CASE_CHAPTERS = [
  'claim',
  'scopeExclusions',
  'symptoms',
  'evidence',
  'rootCause',
  'experimentVerification',
  'fix',
  'negative',
  'openChallenges',
  'derived',
] as const;
export type KnowledgeCaseChapter = (typeof KNOWLEDGE_CASE_CHAPTERS)[number];

export const KNOWLEDGE_SCOPE_AXES = [
  'project',
  'engine',
  'engineVersion',
  'api',
  'platform',
  'gpuVendor',
  'gpuArch',
  'device',
  'driver',
  'capture',
  'pipelineStage',
  'pass',
  'shaderFamily',
  'materialFamily',
  'quality',
  'resolution',
  'featureConfiguration',
] as const;
export type KnowledgeScopeAxis = (typeof KNOWLEDGE_SCOPE_AXES)[number];

export type KnowledgeScope = Partial<Record<KnowledgeScopeAxis, string>> & {
  exclusions?: Partial<Record<KnowledgeScopeAxis, string[]>>;
};

export interface KnowledgeRelation {
  kind: KnowledgeRelationKind;
  targetCardId: string;
}

export interface KnowledgeCaseChapters {
  claim?: string;
  scopeExclusions?: string;
  symptoms?: string;
  evidence?: string;
  rootCause?: string;
  experimentVerification?: string;
  fix?: string;
  negative?: string;
  openChallenges?: string;
  derived?: string;
}

export interface KnowledgeCardRecord {
  cardId: string;
  spaceId: string;
  relativePath: string;
  type: KnowledgeCardType;
  lifecycle: KnowledgeLifecycle;
  title: string;
  scope: KnowledgeScope;
  relations: KnowledgeRelation[];
  body: string;
  preview?: string;
  updatedAt?: number;
  /** Source YAML `meta.status`. `fixed` is never treated as verified. */
  sourceStatus?: string;
  caseId?: string;
  chapters?: KnowledgeCaseChapters;
}

export type KnowledgeSpaceKind = 'user' | 'project';

export interface KnowledgeSpace {
  spaceId: string;
  kind: KnowledgeSpaceKind;
  label: string;
  rootPath: string;
  projectId?: string;
}

export interface KnowledgeCardSummary {
  cardId: string;
  spaceId: string;
  relativePath: string;
  title: string;
  preview?: string;
  updatedAt?: number;
  type?: KnowledgeCardType;
  lifecycle?: KnowledgeLifecycle;
}

export interface KnowledgeCardDetail extends KnowledgeCardSummary {
  content: string;
  body: string;
  scope: KnowledgeScope;
  relations: KnowledgeRelation[];
  sourceStatus?: string;
  caseId?: string;
  chapters?: KnowledgeCaseChapters;
}

export interface KnowledgeHumanConfirmation {
  explicitHumanConfirmation: true;
}

/** Seven retrieval lanes. Order is the walk-pattern contract. */
export const KNOWLEDGE_RETRIEVAL_LANES = [
  'Identity/Path',
  'Scope/Metadata',
  'Lexical',
  'Structural',
  'Semantic',
  'Relation/Graph',
  'Temporal/Version',
] as const;

export type KnowledgeRetrievalLane = (typeof KNOWLEDGE_RETRIEVAL_LANES)[number];

export interface KnowledgeLaneHit {
  cardId: string;
  spaceId: string;
  relativePath: string;
  title: string;
  type?: KnowledgeCardType;
  lifecycle?: KnowledgeLifecycle;
  score: number;
  lanes: KnowledgeRetrievalLane[];
}

export interface KnowledgeLaneResult {
  lane: KnowledgeRetrievalLane;
  hits: KnowledgeLaneHit[];
  semantic?: SemanticLaneStatus;
}

export interface KnowledgeQueryRequest {
  spaceIds?: string[];
  text?: string;
  cardId?: string;
  relativePath?: string;
  type?: KnowledgeCardType[];
  lifecycle?: KnowledgeLifecycle[];
  scope?: KnowledgeScope;
  relationTargetCardId?: string;
  asOf?: number;
  lanes?: KnowledgeRetrievalLane[];
}

export interface KnowledgeQueryResult {
  hits: KnowledgeLaneHit[];
  lanes: KnowledgeLaneResult[];
  semantic: SemanticLaneStatus | null;
}

export interface KnowledgeIndexOverview {
  revision: string;
  builtAt: string;
  cardCount: number;
  cardsBySpace: Record<string, number>;
}

export interface KnowledgeOverviewResult {
  spaces: KnowledgeSpace[];
  index: KnowledgeIndexOverview | null;
  semantic: SemanticLaneStatus;
}

export interface KnowledgeCompiledHit extends KnowledgeLaneHit {
  reasons: string[];
}

export interface KnowledgePackConflict {
  leftCardId: string;
  rightCardId: string;
  kind: 'contradicts';
}

export interface KnowledgePack {
  packId: string;
  compiledAt: string;
  hits: KnowledgeCompiledHit[];
  conflicts: KnowledgePackConflict[];
  semanticClaimed: false | { claimed: true; status: SemanticLaneStatus };
}

export interface SessionKnowledgeCandidate {
  candidateId: string;
  sessionId: string;
  card: KnowledgeCardRecord;
  createdAt: string;
  source: 'explicit-user-intent';
}

export interface KnowledgeCandidatesResult {
  candidates: SessionKnowledgeCandidate[];
  drafts: KnowledgeCardRecord[];
}

export type ColdDataIngestStatus = 'draft' | 'quarantine' | 'conflict';

export interface ColdDataIngestResult {
  status: ColdDataIngestStatus;
  candidateCreated: false;
  lifecycle: 'draft' | null;
  sourceStatus?: string;
  verified: false;
  record?: KnowledgeCardRecord;
  missingAssets: string[];
  reason?: string;
  existingCaseId?: string;
}
