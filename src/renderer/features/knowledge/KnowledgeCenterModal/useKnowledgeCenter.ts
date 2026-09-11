import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  KnowledgeCardDetail,
  KnowledgeCardRecord,
  KnowledgeIndexOverview,
  KnowledgeLaneHit,
  KnowledgePack,
  KnowledgeSpace,
} from '@shared/types/knowledge';
import { KNOWLEDGE_RETRIEVAL_LANES, type KnowledgeRetrievalLane } from '@shared/types/knowledge';
import { useProjectStore } from '../../../stores/projectStore';
import {
  ALL_CARD_TYPES,
  ALL_LANES,
  ALL_LIFECYCLES,
  createRequestSeq,
  knowledgeErrorMessage,
  knowledgeQueryKey,
  toggleSetValue,
  type KnowledgeNarrowPane,
  type KnowledgeViewMode,
} from './knowledgeCenterModel';
import {
  buildKnowledgeCenterQueryRequest,
  nextSelectedSpaceIds,
  runKnowledgeCenterQuery,
  SEARCH_DEBOUNCE_MS,
} from './knowledgeCenterQuery';

export function useKnowledgeCenter(open: boolean) {
  const sessionId = useProjectStore((state) => state.currentSession?.sessionId ?? null);
  const querySeq = useRef(createRequestSeq());
  const detailSeq = useRef(createRequestSeq());
  const [viewMode, setViewMode] = useState<KnowledgeViewMode>('cards');
  const [narrow, setNarrow] = useState(false);
  const [narrowPane, setNarrowPane] = useState<KnowledgeNarrowPane>('spaces');
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [index, setIndex] = useState<KnowledgeIndexOverview | null>(null);
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([]);
  const [types, setTypes] = useState(ALL_CARD_TYPES);
  const [lifecycles, setLifecycles] = useState(ALL_LIFECYCLES);
  const [lanes, setLanes] = useState<KnowledgeRetrievalLane[]>([...ALL_LANES]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [hits, setHits] = useState<KnowledgeLaneHit[]>([]);
  const [pack, setPack] = useState<KnowledgePack | null>(null);
  const [packQueryKey, setPackQueryKey] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<KnowledgeCardDetail | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingQuery, setLoadingQuery] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const refreshOverview = useCallback(async () => {
    setLoadingOverview(true);
    setError(null);
    try {
      const result = await window.electronAPI.knowledge.overview();
      setSpaces(result.spaces);
      setIndex(result.index);
      setSelectedSpaceIds((current) => nextSelectedSpaceIds(current, result.spaces));
    } catch (err) {
      setError(knowledgeErrorMessage(err));
    } finally {
      setLoadingOverview(false);
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

  const selectCard = useCallback(async (spaceId: string, relativePath: string, cardId: string) => {
    const seq = detailSeq.current.next();
    setSelectedCardId(cardId);
    setLoadingDetail(true);
    setError(null);
    if (narrow) setNarrowPane('detail');
    try {
      const result = await window.electronAPI.knowledge.card(spaceId, relativePath);
      if (!detailSeq.current.isCurrent(seq)) return;
      setSelectedCard(result.card);
      if (!result.card) setError('KNOWLEDGE_CARD_NOT_FOUND');
    } catch (err) {
      if (!detailSeq.current.isCurrent(seq)) return;
      setSelectedCard(null);
      setError(knowledgeErrorMessage(err));
    } finally {
      if (detailSeq.current.isCurrent(seq)) setLoadingDetail(false);
    }
  }, [narrow]);

  const rebuildIndex = useCallback(async () => {
    setRebuilding(true);
    try {
      await window.electronAPI.knowledge.indexRebuild();
      await refreshOverview();
      await refreshQuery();
    } catch (err) {
      setError(knowledgeErrorMessage(err));
    } finally {
      setRebuilding(false);
    }
  }, [refreshOverview, refreshQuery]);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setSelectedCardId(null);
      setSelectedCard(null);
      setError(null);
      setViewMode('cards');
      setNarrowPane('spaces');
      return;
    }
    void refreshOverview();
  }, [open, refreshOverview]);

  useEffect(() => {
    if (!open) return;
    if (spaces.length === 0 && selectedSpaceIds.length === 0) return;
    void refreshQuery();
  }, [open, refreshQuery, selectedSpaceIds.length, spaces.length]);

  const selectRecord = useCallback((record: KnowledgeCardRecord) => {
    setSelectedCardId(record.cardId);
    setSelectedCard({ ...record, content: record.body, body: record.body });
    if (narrow) setNarrowPane('detail');
  }, [narrow]);

  const toggleSpace = useCallback((id: string) => setSelectedSpaceIds((cur) => toggleSetValue(cur, id)), []);
  const toggleType = useCallback((value: (typeof ALL_CARD_TYPES)[number]) => setTypes((cur) => toggleSetValue(cur, value)), []);
  const toggleLifecycle = useCallback((value: (typeof ALL_LIFECYCLES)[number]) => setLifecycles((cur) => toggleSetValue(cur, value)), []);
  const toggleLane = useCallback((value: (typeof ALL_LANES)[number]) => {
    setLanes((cur) => toggleSetValue(cur, value));
  }, []);

  return {
    sessionId, viewMode, setViewMode, narrow, narrowPane, setNarrowPane, spaces, index,
    selectedSpaceIds, types, lifecycles, lanes, allLanes: KNOWLEDGE_RETRIEVAL_LANES,
    searchQuery, setSearchQuery, hits, pack, packQueryKey, selectedCardId, selectedCard, loadingOverview,
    loadingQuery, loadingDetail, rebuilding, error, setError, toggleSpace, toggleType,
    toggleLifecycle, toggleLane, selectCard, selectRecord, rebuildIndex, refreshOverview, refreshQuery, queryRequest,
  };
}
