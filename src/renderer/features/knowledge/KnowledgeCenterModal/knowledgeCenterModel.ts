import type {
  KnowledgeCardRecord,
  KnowledgeCardType,
  KnowledgeLifecycle,
  KnowledgeQueryRequest,
  KnowledgeRetrievalLane,
} from '@shared/types/knowledge';
import { KNOWLEDGE_CARD_TYPES, KNOWLEDGE_LIFECYCLES, KNOWLEDGE_RETRIEVAL_LANES } from '@shared/types/knowledge';

export type KnowledgeViewMode = 'cards' | 'candidates' | 'conflicts';
export type KnowledgeNarrowPane = 'spaces' | 'list' | 'detail';
export type KnowledgeWriteAction =
  | 'save'
  | 'persist-draft'
  | 'promote-verified'
  | 'promote-promoted'
  | 'deprecate';

export const ALL_CARD_TYPES: KnowledgeCardType[] = [...KNOWLEDGE_CARD_TYPES];
export const ALL_LIFECYCLES: KnowledgeLifecycle[] = [...KNOWLEDGE_LIFECYCLES];
export const ALL_LANES: KnowledgeRetrievalLane[] = [...KNOWLEDGE_RETRIEVAL_LANES];

export function knowledgeErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return error instanceof Error ? error.message : String(error);
}

export function createRequestSeq(): { next(): number; isCurrent(value: number): boolean } {
  let seq = 0;
  return {
    next: () => {
      seq += 1;
      return seq;
    },
    isCurrent: (value) => value === seq,
  };
}

export function toggleSetValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export function knowledgeQueryKey(request: KnowledgeQueryRequest): string {
  return JSON.stringify({
    spaceIds: request.spaceIds ?? [],
    text: request.text ?? '',
    type: request.type ?? [],
    lifecycle: request.lifecycle ?? [],
    lanes: request.lanes ?? [],
    cardId: request.cardId ?? null,
    relativePath: request.relativePath ?? null,
    relationTargetCardId: request.relationTargetCardId ?? null,
    asOf: request.asOf ?? null,
    scope: request.scope ?? {},
  });
}

export function detailToRecord(card: {
  cardId: string;
  spaceId: string;
  relativePath: string;
  title: string;
  type?: KnowledgeCardType;
  lifecycle?: KnowledgeLifecycle;
  preview?: string;
  updatedAt?: number;
  content: string;
  body?: string;
  scope?: KnowledgeCardRecord['scope'];
  relations?: KnowledgeCardRecord['relations'];
  sourceStatus?: string;
  caseId?: string;
  chapters?: KnowledgeCardRecord['chapters'];
}): KnowledgeCardRecord {
  return {
    cardId: card.cardId,
    spaceId: card.spaceId,
    relativePath: card.relativePath,
    type: card.type ?? 'fact',
    lifecycle: card.lifecycle ?? 'draft',
    title: card.title,
    scope: card.scope ?? {},
    relations: card.relations ?? [],
    body: card.body ?? card.content,
    ...(card.preview ? { preview: card.preview } : {}),
    ...(card.updatedAt != null ? { updatedAt: card.updatedAt } : {}),
    ...(card.sourceStatus ? { sourceStatus: card.sourceStatus } : {}),
    ...(card.caseId ? { caseId: card.caseId } : {}),
    ...(card.chapters ? { chapters: card.chapters } : {}),
  };
}
