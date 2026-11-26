import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createRequestSeq, type KnowledgeViewMode } from './knowledgeCenterModel';
import { buildKnowledgeCenterQueryRequest, SEARCH_DEBOUNCE_MS } from './knowledgeCenterQuery';
import { useKnowledgeLoadMore } from './useKnowledgeLoadMore';
import { useKnowledgeQueryRunner } from './useKnowledgeQueryRunner';
import type { KnowledgeLaneHit, KnowledgePack } from '@shared/types/knowledge';

/** The list's query: debounced search text with the selected spaces and filters, its pages of hits and its pack. */
export function useKnowledgeQuery({
  viewMode,
  selectedSpaceIds,
  types,
  lifecycles,
  setError,
}: {
  viewMode: KnowledgeViewMode;
  selectedSpaceIds: string[];
  types: Parameters<typeof buildKnowledgeCenterQueryRequest>[0]['type'];
  lifecycles: Parameters<typeof buildKnowledgeCenterQueryRequest>[0]['lifecycle'];
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const querySeq = useRef(createRequestSeq());
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [hits, setHits] = useState<KnowledgeLaneHit[]>([]);
  const [page, setPage] = useState<{ revision?: string; total?: number; nextOffset?: number }>({});
  const [pack, setPack] = useState<KnowledgePack | null>(null);
  const [packQueryKey, setPackQueryKey] = useState<string | null>(null);
  const [loadingQuery, setLoadingQuery] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const queryRequest = useMemo(
    () =>
      buildKnowledgeCenterQueryRequest({
        spaceIds: selectedSpaceIds,
        text: debouncedSearch,
        type: types,
        lifecycle: lifecycles,
      }),
    [debouncedSearch, lifecycles, selectedSpaceIds, types],
  );
  const runQuery = useKnowledgeQueryRunner({
    querySeq,
    setLoadingQuery,
    setPage,
    setHits,
    setPack,
    setPackQueryKey,
    setError,
  });
  const refreshQuery = useCallback(async () => {
    await runQuery(viewMode, queryRequest);
  }, [queryRequest, runQuery, viewMode]);
  const { loadingMore, loadMore, resetLoadingMore } = useKnowledgeLoadMore({
    querySeq,
    queryRequest,
    page,
    setHits,
    setPage,
    setError,
  });
  /** Drops the query in flight and its results, as closing the Knowledge Center does. */
  const resetQuery = useCallback(() => {
    querySeq.current.next();
    setLoadingQuery(false);
    setHits([]);
    setPage({});
    resetLoadingMore();
    setPack(null);
    setPackQueryKey(null);
    setSearchQuery('');
  }, [resetLoadingMore]);

  return {
    querySeq,
    runQuery,
    resetQuery,
    view: {
      searchQuery,
      setSearchQuery,
      queryRequest,
      hits,
      page,
      pack,
      packQueryKey,
      loadingQuery,
      loadingMore,
      loadMore,
      refreshQuery,
    },
  };
}
