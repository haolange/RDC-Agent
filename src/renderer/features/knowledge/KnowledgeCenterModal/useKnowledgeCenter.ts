import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SemanticLaneStatus } from '@shared/types/embedding';
import type {
  KnowledgeCardDetail,
  KnowledgeCardRecord,
  KnowledgeIndexOverview,
  KnowledgeLaneHit,
  KnowledgePack,
  KnowledgeQueryRequest,
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

const SEARCH_DEBOUNCE_MS = 300;

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

export function useKnowledgeCenter(open: boolean) {
  const sessionId = useProjectStore((state) => state.currentSession?.sessionId ?? null);
  const querySeq = useRef(createRequestSeq());
  const detailSeq = useRef(createRequestSeq());
  const [viewMode, setViewMode] = useState<KnowledgeViewMode>('cards');
  const [narrow, setNarrow] = useState(false);
  const [narrowPane, setNarrowPane] = useState<KnowledgeNarrowPane>('spaces');
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [index, setIndex] = useState<KnowledgeIndexOverview | null>(null);
  const [semantic, setSemantic] = useState<SemanticLaneStatus | null>(null);
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([]);
  const [types, setTypes] = useState(ALL_CARD_TYPES);
  const [lifecycles, setLifecycles] = useState(ALL_LIFECYCLES);
  const [lanes, setLanes] = useState<KnowledgeRetrievalLane[]>(ALL_LANES.filter((lane) => lane !== 'Semantic'));
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

  const semanticReady = semantic?.availability === 'ready';

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
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
      setSemantic(result.semantic);
      setSelectedSpaceIds((current) => (
        current.length === 0 ? result.spaces.map((space) => space.spaceId) : current.filter((id) => (
          result.spaces.some((space) => space.spaceId === id)
        ))
      ));
      if (result.semantic.availability !== 'ready') {
        setLanes((current) => current.filter((lane) => lane !== 'Semantic'));
      }
    } catch (err) {
      setError(knowledgeErrorMessage(err));
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const queryRequest = useMemo<KnowledgeQueryRequest>(() => ({
    spaceIds: selectedSpaceIds,
    text: debouncedSearch.trim() || undefined,
    type: types,
    lifecycle: lifecycles,
    lanes: lanes.filter((lane) => lane !== 'Semantic' || semanticReady),
  }), [debouncedSearch, lanes, lifecycles, selectedSpaceIds, semanticReady, types]);

  const refreshQuery = useCallback(async () => {
    const seq = querySeq.current.next();
    setLoadingQuery(true);
    try {
      if (viewMode === 'conflicts') {
        const compiled = await window.electronAPI.knowledge.compile({ ...queryRequest, limit: 50 });
        if (!querySeq.current.isCurrent(seq)) return;
        const next = assignKnowledgeCenterList(viewMode, compiled.hits, compiled);
        setPack(next.pack);
        setPackQueryKey(knowledgeQueryKey(queryRequest));
        setHits(next.hits);
        return;
      }
      const result = await window.electronAPI.knowledge.query(queryRequest);
      if (!querySeq.current.isCurrent(seq)) return;
      if (result.semantic) setSemantic(result.semantic);
      const compiled = await window.electronAPI.knowledge.compile({ ...queryRequest, limit: 50 });
      if (!querySeq.current.isCurrent(seq)) return;
      const next = assignKnowledgeCenterList(viewMode, result.hits, compiled);
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
    void refreshQuery();
  }, [open, refreshQuery]);

  const selectRecord = useCallback((record: KnowledgeCardRecord) => {
    setSelectedCardId(record.cardId);
    setSelectedCard({ ...record, content: record.body, body: record.body });
    if (narrow) setNarrowPane('detail');
  }, [narrow]);

  const toggleSpace = useCallback((id: string) => setSelectedSpaceIds((cur) => toggleSetValue(cur, id)), []);
  const toggleType = useCallback((value: (typeof ALL_CARD_TYPES)[number]) => setTypes((cur) => toggleSetValue(cur, value)), []);
  const toggleLifecycle = useCallback((value: (typeof ALL_LIFECYCLES)[number]) => setLifecycles((cur) => toggleSetValue(cur, value)), []);
  const toggleLane = useCallback((value: (typeof ALL_LANES)[number]) => {
    if (value === 'Semantic' && !semanticReady) return;
    setLanes((cur) => toggleSetValue(cur, value));
  }, [semanticReady]);

  return {
    sessionId, viewMode, setViewMode, narrow, narrowPane, setNarrowPane, spaces, index, semantic,
    semanticReady, selectedSpaceIds, types, lifecycles, lanes, allLanes: KNOWLEDGE_RETRIEVAL_LANES,
    searchQuery, setSearchQuery, hits, pack, packQueryKey, selectedCardId, selectedCard, loadingOverview,
    loadingQuery, loadingDetail, rebuilding, error, setError, toggleSpace, toggleType,
    toggleLifecycle, toggleLane, selectCard, selectRecord, rebuildIndex, refreshOverview, refreshQuery, queryRequest,
  };
}
