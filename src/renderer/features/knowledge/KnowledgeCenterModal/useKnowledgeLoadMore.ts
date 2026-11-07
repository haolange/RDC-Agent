import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { KnowledgeLaneHit, KnowledgeQueryRequest } from '@shared/types/knowledge';
import { createRequestSeq, knowledgeErrorMessage } from './knowledgeCenterModel';

type Page = { revision?: string; total?: number; nextOffset?: number };

export function useKnowledgeLoadMore(input: {
  querySeq: { current: ReturnType<typeof createRequestSeq> };
  queryRequest: KnowledgeQueryRequest;
  page: Page;
  setHits: Dispatch<SetStateAction<KnowledgeLaneHit[]>>;
  setPage: Dispatch<SetStateAction<Page>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const { querySeq, queryRequest, page, setHits, setPage, setError } = input;
  const [loadingMore, setLoadingMore] = useState(false);
  const resetLoadingMore = useCallback(() => setLoadingMore(false), []);
  const loadMore = useCallback(async () => {
    if (loadingMore || page.nextOffset === undefined || !page.revision) return;
    const seq = querySeq.current.next();
    setLoadingMore(true);
    setError(null);
    try {
      const result = await window.electronAPI.knowledge.query({
        ...queryRequest, offset: page.nextOffset, limit: 50, expectedRevision: page.revision,
      });
      if (!querySeq.current.isCurrent(seq)) return;
      setHits(current => [...current, ...result.hits]);
      setPage({ revision: result.revision, total: result.total, nextOffset: result.nextOffset });
    } catch (error) {
      if (querySeq.current.isCurrent(seq)) setError(knowledgeErrorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, page.nextOffset, page.revision, queryRequest, querySeq, setError, setHits, setPage]);
  return { loadingMore, loadMore, resetLoadingMore };
}
