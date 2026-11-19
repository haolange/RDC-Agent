import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { KnowledgeLaneHit, KnowledgePack, KnowledgeQueryRequest } from '@shared/types/knowledge';
import { createRequestSeq, knowledgeErrorMessage, knowledgeQueryKey, type KnowledgeViewMode } from './knowledgeCenterModel';
import { runKnowledgeCenterQuery } from './knowledgeCenterQuery';

type Page = { revision?: string; total?: number; nextOffset?: number };
export function useKnowledgeQueryRunner(input: {
  querySeq: { current: ReturnType<typeof createRequestSeq> };
  setLoadingQuery: Dispatch<SetStateAction<boolean>>;
  setPage: Dispatch<SetStateAction<Page>>;
  setHits: Dispatch<SetStateAction<KnowledgeLaneHit[]>>;
  setPack: Dispatch<SetStateAction<KnowledgePack | null>>;
  setPackQueryKey: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const { querySeq, setLoadingQuery, setPage, setHits, setPack, setPackQueryKey, setError } = input;
  return useCallback(async (viewMode: KnowledgeViewMode, queryRequest: KnowledgeQueryRequest): Promise<boolean> => {
    const seq = querySeq.current.next();
    setLoadingQuery(true);
    setPage({});
    try {
      const next = await runKnowledgeCenterQuery({ viewMode, queryRequest,
        query: request => window.electronAPI.knowledge.query({ ...request, limit: 50 }),
        compile: request => window.electronAPI.knowledge.compile(request),
        isCurrent: () => querySeq.current.isCurrent(seq) });
      if (!next || !querySeq.current.isCurrent(seq)) return false;
      setHits(next.hits); setPage(next.page ?? {}); setPack(next.pack);
      setPackQueryKey(knowledgeQueryKey(queryRequest));
      return true;
    } catch (error) {
      if (querySeq.current.isCurrent(seq)) setError(knowledgeErrorMessage(error));
      return false;
    } finally {
      if (querySeq.current.isCurrent(seq)) setLoadingQuery(false);
    }
  }, [querySeq, setError, setHits, setLoadingQuery, setPack, setPackQueryKey, setPage]);
}
