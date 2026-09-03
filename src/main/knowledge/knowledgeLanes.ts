import type { KnowledgeCardRecord, KnowledgeScope } from '@shared/types/knowledge';

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

export type {
  KnowledgeLaneHit,
  KnowledgeLaneResult,
  KnowledgeQueryRequest,
  KnowledgeQueryResult,
  KnowledgeRetrievalLane,
} from '@shared/types/knowledge';

export interface KnowledgeIndexEntry {
  cardId: string;
  spaceId: string;
  relativePath: string;
  title: string;
  type?: KnowledgeCardRecord['type'];
  lifecycle?: KnowledgeCardRecord['lifecycle'];
  scope: KnowledgeScope;
  relations: KnowledgeCardRecord['relations'];
  headings: string[];
  lexical: string;
  updatedAt: number;
  contentHash: string;
  sourceStatus?: string;
  caseId?: string;
}

export const KNOWLEDGE_INDEX_SCHEMA_VERSION = 1 as const;

export interface KnowledgeIndexSnapshot {
  schemaVersion: typeof KNOWLEDGE_INDEX_SCHEMA_VERSION;
  revision: string;
  builtAt: string;
  cards: KnowledgeIndexEntry[];
}
