import { createHash } from 'node:crypto';
import type { KnowledgeCardRecord, KnowledgeScope } from '@shared/types/knowledge';

/** Six retrieval lanes. Order is the walk-pattern contract. */
export const KNOWLEDGE_RETRIEVAL_LANES = [
  'Identity/Path',
  'Scope/Metadata',
  'Lexical',
  'Structural',
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
  preview?: string;
}

export const KNOWLEDGE_INDEX_SCHEMA_VERSION = 1 as const;

export interface KnowledgeIndexSnapshot {
  schemaVersion: typeof KNOWLEDGE_INDEX_SCHEMA_VERSION;
  revision: string;
  builtAt: string;
  cards: KnowledgeIndexEntry[];
}

export function knowledgeCorpusHash(
  cards: readonly Pick<KnowledgeIndexEntry, 'cardId' | 'contentHash' | 'relativePath'>[],
): string {
  const ordered = [...cards].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return createHash('sha256')
    .update(ordered.map((card) => `${card.cardId}:${card.contentHash}`).join('|'), 'utf8')
    .digest('hex');
}
