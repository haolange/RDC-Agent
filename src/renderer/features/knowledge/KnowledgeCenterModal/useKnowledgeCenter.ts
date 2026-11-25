import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorDetail } from '../../../lib/errorDetail';
import { useProjectStore } from '../../../stores/projectStore';
import {
  createRequestSeq, knowledgeQueryKey, toggleSetValue,
  type KnowledgeViewMode,
} from './knowledgeCenterModel';
import { buildKnowledgeCenterQueryRequest, includeSelectedSpaceId, nextSelectedSpaceIds, SEARCH_DEBOUNCE_MS } from './knowledgeCenterQuery';
import { useKnowledgeSelection } from './useKnowledgeSelection';
import { useKnowledgeViewport } from './useKnowledgeViewport';
import { useKnowledgeFilters } from './useKnowledgeFilters';
import { useKnowledgeLoadMore } from './useKnowledgeLoadMore';
import { useKnowledgeQueryRunner } from './useKnowledgeQueryRunner';
import type {
  KnowledgeCardDetail, KnowledgeIndexOverview, KnowledgeLaneHit, KnowledgePack, KnowledgeSpace,
} from '@shared/types/knowledge';

export function useKnowledgeCenter(open: boolean) {
  const sessionId = useProjectStore((state) => state.currentSession?.sessionId ?? null);
  const querySeq = useRef(createRequestSeq());
  const overviewSeq = useRef(createRequestSeq());
  const rebuildSeq = useRef(createRequestSeq());
  const [viewMode, setViewMode] = useState<KnowledgeViewMode>('cards');
  const viewport = useKnowledgeViewport();
  const { narrow, setNarrowPane, navigateToPane } = viewport;
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [index, setIndex] = useState<KnowledgeIndexOverview | null>(null);
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([]);
  const { types, lifecycles, toggleType, toggleLifecycle } = useKnowledgeFilters();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [hits, setHits] = useState<KnowledgeLaneHit[]>([]);
  const [page, setPage] = useState<{ revision?: string; total?: number; nextOffset?: number }>({});
  const [pack, setPack] = useState<KnowledgePack | null>(null);
  const [packQueryKey, setPackQueryKey] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingQuery, setLoadingQuery] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const refreshOverview = useCallback(async () => {
    const seq = overviewSeq.current.next();
    setLoadingOverview(true);
    setError(null);
    try {
      const result = await window.electronAPI.knowledge.overview();
      if (!overviewSeq.current.isCurrent(seq)) return;
      setSpaces(result.spaces);
      setIndex(result.index);
      setSelectedSpaceIds((current) => nextSelectedSpaceIds(current, result.spaces));
    } catch (err) {
      if (overviewSeq.current.isCurrent(seq)) setError(errorDetail(err));
    } finally {
      if (overviewSeq.current.isCurrent(seq)) setLoadingOverview(false);
    }
  }, []);

  const queryRequest = useMemo(() => buildKnowledgeCenterQueryRequest({
    spaceIds: selectedSpaceIds,
    text: debouncedSearch,
    type: types,
    lifecycle: lifecycles,
  }), [debouncedSearch, lifecycles, selectedSpaceIds, types]);
  const runQuery = useKnowledgeQueryRunner({ querySeq, setLoadingQuery, setPage, setHits, setPack, setPackQueryKey, setError });
  const refreshQuery = useCallback(async () => { await runQuery(viewMode, queryRequest); }, [queryRequest, runQuery, viewMode]);

  const { loadingMore, loadMore, resetLoadingMore } = useKnowledgeLoadMore({
    querySeq, queryRequest, page, setHits, setPage, setError,
  });

  const showDetail = useCallback(() => navigateToPane('detail'), [navigateToPane]);
  const { selectedCardId, selectedCard, loadingDetail, clearCardSelection,
    selectedConflict, conflictCards, selectConflict, clearConflict, selectCard, selectRecord } =
    useKnowledgeSelection({ open, queryKey: knowledgeQueryKey(queryRequest), hits, pack,
      onShowDetail: showDetail, setError });

  /** Jump from a conflict pair to one of its cards in the Cards view. */
  const openRelatedCard = useCallback((card: Pick<KnowledgeCardDetail, 'spaceId' | 'relativePath' | 'cardId'>) => {
    clearConflict();
    setViewMode('cards');
    void selectCard(card.spaceId, card.relativePath, card.cardId);
  }, [clearConflict, selectCard]);
  /** Resolves once the rebuilt index is shown; a failure rejects, so the dialog that asked keeps it in view. */
  const rebuildIndex = useCallback(async () => {
    const seq = rebuildSeq.current.next();
    setRebuilding(true);
    try {
      await window.electronAPI.knowledge.indexRebuild();
      if (!rebuildSeq.current.isCurrent(seq)) return;
      await refreshOverview();
      if (!rebuildSeq.current.isCurrent(seq)) return;
      await refreshQuery();
    } finally {
      if (rebuildSeq.current.isCurrent(seq)) setRebuilding(false);
    }
  }, [refreshOverview, refreshQuery]);
  useEffect(() => {
    if (!open) {
      querySeq.current.next();
      overviewSeq.current.next();
      rebuildSeq.current.next();
      setLoadingOverview(false);
      setLoadingQuery(false);
      setRebuilding(false);
      setHits([]);
      setPage({}); resetLoadingMore();
      setPack(null);
      setPackQueryKey(null);
      setSearchQuery('');
      clearCardSelection();
      clearConflict();
      setError(null);
      setViewMode('cards');
      setNarrowPane('spaces');
      return;
    }
    const overview = overviewSeq.current;
    const rebuild = rebuildSeq.current;
    void refreshOverview();
    return () => { overview.next(); rebuild.next(); };
  }, [clearCardSelection, clearConflict, open, refreshOverview, resetLoadingMore, setNarrowPane]);

  useEffect(() => {
    if (!open) return;
    if (spaces.length === 0 && selectedSpaceIds.length === 0) return;
    const query = querySeq.current;
    void refreshQuery();
    return () => { query.next(); };
  }, [open, refreshQuery, selectedSpaceIds.length, spaces.length]);
  const toggleSpace = useCallback((id: string) => setSelectedSpaceIds((cur) => toggleSetValue(cur, id)), []);
  const changeViewMode = useCallback((next: KnowledgeViewMode) => {
    clearCardSelection();
    clearConflict();
    setViewMode(next);
  }, [clearCardSelection, clearConflict]);

  const revealImportedCard = useCallback(async (card: Pick<KnowledgeCardDetail, 'spaceId' | 'relativePath' | 'cardId'>) => {
    clearConflict();
    setViewMode('cards');
    const revealRequest = {
      ...queryRequest,
      spaceIds: includeSelectedSpaceId(queryRequest.spaceIds ?? [], card.spaceId),
    };
    await refreshOverview();
    setSelectedSpaceIds((current) => includeSelectedSpaceId(current, card.spaceId));
    if (!await runQuery('cards', revealRequest)) return;
    await selectCard(card.spaceId, card.relativePath, card.cardId);
    if (narrow) setNarrowPane('detail');
  }, [clearConflict, narrow, queryRequest, refreshOverview, runQuery, selectCard, setNarrowPane]);

  return {
    sessionId, viewMode, setViewMode: changeViewMode, ...viewport, spaces, index,
    selectedSpaceIds, types, lifecycles,
    searchQuery, setSearchQuery, hits, page, loadingMore, loadMore, pack, packQueryKey, selectedCardId, selectedCard, loadingOverview,
    loadingQuery, loadingDetail, rebuilding, error, setError, toggleSpace, toggleType,
    toggleLifecycle, selectCard, selectRecord, rebuildIndex, refreshOverview, refreshQuery, queryRequest,
    selectedConflict, conflictCards, selectConflict, openRelatedCard, revealImportedCard,
  };
}
