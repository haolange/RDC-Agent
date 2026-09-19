import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KNOWLEDGE_RETRIEVAL_LANES,
  type KnowledgeCardDetail, type KnowledgeIndexOverview,
  type KnowledgeLaneHit, type KnowledgePack, type KnowledgeSpace,
} from '@shared/types/knowledge';
import { useProjectStore } from '../../../stores/projectStore';
import {
  createRequestSeq, knowledgeErrorMessage, knowledgeQueryKey, toggleSetValue,
  type KnowledgeViewMode,
} from './knowledgeCenterModel';
import { buildKnowledgeCenterQueryRequest, includeSelectedSpaceId, nextSelectedSpaceIds, runKnowledgeCenterQuery, SEARCH_DEBOUNCE_MS } from './knowledgeCenterQuery';
import { useKnowledgeSelection } from './useKnowledgeSelection';
import { useKnowledgeViewport } from './useKnowledgeViewport';
import { useKnowledgeFilters } from './useKnowledgeFilters';

export function useKnowledgeCenter(open: boolean) {
  const sessionId = useProjectStore((state) => state.currentSession?.sessionId ?? null);
  const querySeq = useRef(createRequestSeq());
  const overviewSeq = useRef(createRequestSeq());
  const rebuildSeq = useRef(createRequestSeq());
  const [viewMode, setViewMode] = useState<KnowledgeViewMode>('cards');
  const { narrow, narrowPane, setNarrowPane } = useKnowledgeViewport();
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [index, setIndex] = useState<KnowledgeIndexOverview | null>(null);
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([]);
  const { types, lifecycles, lanes, toggleType, toggleLifecycle, toggleLane } = useKnowledgeFilters();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [hits, setHits] = useState<KnowledgeLaneHit[]>([]);
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
      if (overviewSeq.current.isCurrent(seq)) setError(knowledgeErrorMessage(err));
    } finally {
      if (overviewSeq.current.isCurrent(seq)) setLoadingOverview(false);
    }
  }, []);

  const queryRequest = useMemo(() => buildKnowledgeCenterQueryRequest({
    spaceIds: selectedSpaceIds,
    text: debouncedSearch,
    type: types,
    lifecycle: lifecycles,
    lanes,
  }), [debouncedSearch, lanes, lifecycles, selectedSpaceIds, types]);
  const refreshQuery = useCallback(async () => {
    const seq = querySeq.current.next();
    setLoadingQuery(true);
    try {
      const next = await runKnowledgeCenterQuery({
        viewMode,
        queryRequest,
        query: (request) => window.electronAPI.knowledge.query(request),
        compile: (request) => window.electronAPI.knowledge.compile(request),
        isCurrent: () => querySeq.current.isCurrent(seq),
      });
      if (!next || !querySeq.current.isCurrent(seq)) return;
      setHits(next.hits);
      setPack(next.pack);
      setPackQueryKey(knowledgeQueryKey(queryRequest));
    } catch (err) {
      if (!querySeq.current.isCurrent(seq)) return;
      setError(knowledgeErrorMessage(err));
    } finally {
      if (querySeq.current.isCurrent(seq)) setLoadingQuery(false);
    }
  }, [queryRequest, viewMode]);

  const showDetail = useCallback(() => { if (narrow) setNarrowPane('detail'); }, [narrow, setNarrowPane]);
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
  const rebuildIndex = useCallback(async () => {
    const seq = rebuildSeq.current.next();
    setRebuilding(true);
    try {
      await window.electronAPI.knowledge.indexRebuild();
      if (!rebuildSeq.current.isCurrent(seq)) return;
      await refreshOverview();
      if (!rebuildSeq.current.isCurrent(seq)) return;
      await refreshQuery();
    } catch (err) {
      if (rebuildSeq.current.isCurrent(seq)) setError(knowledgeErrorMessage(err));
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
  }, [clearCardSelection, clearConflict, open, refreshOverview, setNarrowPane]);

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
    const seq = querySeq.current.next();
    setLoadingQuery(true);
    try {
      const next = await runKnowledgeCenterQuery({
        viewMode: 'cards',
        queryRequest: revealRequest,
        query: (request) => window.electronAPI.knowledge.query(request),
        compile: (request) => window.electronAPI.knowledge.compile(request),
        isCurrent: () => querySeq.current.isCurrent(seq),
      });
      if (!next || !querySeq.current.isCurrent(seq)) return;
      setHits(next.hits);
      setPack(next.pack);
      setPackQueryKey(knowledgeQueryKey(revealRequest));
      await selectCard(card.spaceId, card.relativePath, card.cardId);
      if (narrow) setNarrowPane('detail');
    } catch (err) {
      if (querySeq.current.isCurrent(seq)) setError(knowledgeErrorMessage(err));
    } finally {
      if (querySeq.current.isCurrent(seq)) setLoadingQuery(false);
    }
  }, [clearConflict, narrow, queryRequest, refreshOverview, selectCard, setNarrowPane]);

  return {
    sessionId, viewMode, setViewMode: changeViewMode, narrow, narrowPane, setNarrowPane, spaces, index,
    selectedSpaceIds, types, lifecycles, lanes, allLanes: KNOWLEDGE_RETRIEVAL_LANES,
    searchQuery, setSearchQuery, hits, pack, packQueryKey, selectedCardId, selectedCard, loadingOverview,
    loadingQuery, loadingDetail, rebuilding, error, setError, toggleSpace, toggleType,
    toggleLifecycle, toggleLane, selectCard, selectRecord, rebuildIndex, refreshOverview, refreshQuery, queryRequest,
    selectedConflict, conflictCards, selectConflict, openRelatedCard, revealImportedCard,
  };
}
