import type {
  KnowledgeLaneHit,
  KnowledgePack,
  KnowledgeQueryRequest,
  KnowledgeRetrievalLane,
  KnowledgeSpace,
} from '@shared/types/knowledge';
import type { KnowledgeViewMode } from './knowledgeCenterModel';

export const SEARCH_DEBOUNCE_MS = 300;

export function assignKnowledgeCenterList(
  viewMode: KnowledgeViewMode,
  queryHits: KnowledgeLaneHit[],
  compiled: KnowledgePack,
): { hits: KnowledgeLaneHit[]; pack: KnowledgePack } {
  if (viewMode === 'conflicts') {
    return { hits: compiled.hits, pack: compiled };
  }
  return { hits: queryHits, pack: compiled };
}

export function buildKnowledgeCenterQueryRequest(input: {
  spaceIds: string[];
  text: string;
  type: KnowledgeQueryRequest['type'];
  lifecycle: KnowledgeQueryRequest['lifecycle'];
  lanes: KnowledgeRetrievalLane[];
}): KnowledgeQueryRequest {
  return {
    spaceIds: input.spaceIds,
    text: input.text.trim() || undefined,
    type: input.type,
    lifecycle: input.lifecycle,
    lanes: input.lanes,
  };
}

export function nextSelectedSpaceIds(current: string[], spaces: KnowledgeSpace[]): string[] {
  return current.length === 0
    ? spaces.map((space) => space.spaceId)
    : current.filter((id) => spaces.some((space) => space.spaceId === id));
}

export async function runKnowledgeCenterQuery(input: {
  viewMode: KnowledgeViewMode;
  queryRequest: KnowledgeQueryRequest;
  query: (request: KnowledgeQueryRequest) => Promise<{
    hits: KnowledgeLaneHit[];
  }>;
  compile: (request: KnowledgeQueryRequest & { limit?: number }) => Promise<KnowledgePack>;
  isCurrent?: () => boolean;
}): Promise<{ hits: KnowledgeLaneHit[]; pack: KnowledgePack } | null> {
  const stale = () => input.isCurrent != null && !input.isCurrent();
  if (input.viewMode === 'conflicts') {
    const compiled = await input.compile({ ...input.queryRequest, limit: 50 });
    if (stale()) return null;
    return assignKnowledgeCenterList(input.viewMode, compiled.hits, compiled);
  }
  const result = await input.query(input.queryRequest);
  if (stale()) return null;
  const compiled = await input.compile({ ...input.queryRequest, limit: 50 });
  if (stale()) return null;
  return assignKnowledgeCenterList(input.viewMode, result.hits, compiled);
}
