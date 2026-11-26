import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../../../stores/projectStore';
import { knowledgeQueryKey, type KnowledgeViewMode } from './knowledgeCenterModel';
import { includeSelectedSpaceId } from './knowledgeCenterQuery';
import { useKnowledgeSelection } from './useKnowledgeSelection';
import { useKnowledgeViewport } from './useKnowledgeViewport';
import { useKnowledgeFilters } from './useKnowledgeFilters';
import { useKnowledgeQuery } from './useKnowledgeQuery';
import { useKnowledgeOverview } from './useKnowledgeOverview';
import { useKnowledgeRebuild } from './useKnowledgeRebuild';
import type { KnowledgeCardDetail } from '@shared/types/knowledge';

export function useKnowledgeCenter(open: boolean) {
  const sessionId = useProjectStore((state) => state.currentSessionId);
  const [viewMode, setViewMode] = useState<KnowledgeViewMode>('cards');
  const viewport = useKnowledgeViewport();
  const { narrow, setNarrowPane, navigateToPane } = viewport;
  const { types, lifecycles, toggleType, toggleLifecycle } = useKnowledgeFilters();
  const [error, setError] = useState<string | null>(null);
  const overview = useKnowledgeOverview(setError);
  const { overviewSeq, setSelectedSpaceIds, stopOverview } = overview;
  const { selectedSpaceIds, refreshOverview, spaces } = overview.view;
  const query = useKnowledgeQuery({ viewMode, selectedSpaceIds, types, lifecycles, setError });
  const { querySeq, runQuery, resetQuery } = query;
  const { queryRequest, hits, pack, refreshQuery } = query.view;

  const showDetail = useCallback(() => navigateToPane('detail'), [navigateToPane]);
  const selection = useKnowledgeSelection({
    open,
    queryKey: knowledgeQueryKey(queryRequest),
    hits,
    pack,
    onShowDetail: showDetail,
    setError,
  });
  const { clearCardSelection, clearConflict, selectCard } = selection;

  /** Jump from a conflict pair to one of its cards in the Cards view. */
  const openRelatedCard = useCallback(
    (card: Pick<KnowledgeCardDetail, 'spaceId' | 'relativePath' | 'cardId'>) => {
      clearConflict();
      setViewMode('cards');
      void selectCard(card.spaceId, card.relativePath, card.cardId);
    },
    [clearConflict, selectCard],
  );
  const rebuild = useKnowledgeRebuild(refreshOverview, refreshQuery);
  const { rebuildSeq, stopRebuild } = rebuild;
  useEffect(() => {
    if (!open) {
      resetQuery();
      stopOverview();
      stopRebuild();
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
    return () => {
      overview.next();
      rebuild.next();
    };
  }, [
    clearCardSelection,
    clearConflict,
    open,
    overviewSeq,
    rebuildSeq,
    refreshOverview,
    resetQuery,
    setNarrowPane,
    stopOverview,
    stopRebuild,
  ]);

  useEffect(() => {
    if (!open) return;
    if (spaces.length === 0 && selectedSpaceIds.length === 0) return;
    const query = querySeq.current;
    void refreshQuery();
    return () => {
      query.next();
    };
  }, [open, querySeq, refreshQuery, selectedSpaceIds.length, spaces.length]);
  const changeViewMode = useCallback(
    (next: KnowledgeViewMode) => {
      clearCardSelection();
      clearConflict();
      setViewMode(next);
    },
    [clearCardSelection, clearConflict],
  );

  const revealImportedCard = useCallback(
    async (card: Pick<KnowledgeCardDetail, 'spaceId' | 'relativePath' | 'cardId'>) => {
      clearConflict();
      setViewMode('cards');
      const revealRequest = {
        ...queryRequest,
        spaceIds: includeSelectedSpaceId(queryRequest.spaceIds ?? [], card.spaceId),
      };
      await refreshOverview();
      setSelectedSpaceIds((current) => includeSelectedSpaceId(current, card.spaceId));
      if (!(await runQuery('cards', revealRequest))) return;
      await selectCard(card.spaceId, card.relativePath, card.cardId);
      if (narrow) setNarrowPane('detail');
    },
    [clearConflict, narrow, queryRequest, refreshOverview, runQuery, selectCard, setNarrowPane, setSelectedSpaceIds],
  );

  const { selectedCardId, selectedCard, loadingDetail, selectedConflict, conflictCards, selectConflict, selectRecord } =
    selection;
  return {
    sessionId,
    viewMode,
    setViewMode: changeViewMode,
    ...viewport,
    ...overview.view,
    ...query.view,
    ...rebuild.view,
    types,
    lifecycles,
    toggleType,
    toggleLifecycle,
    error,
    setError,
    selectCard,
    selectRecord,
    selectedCardId,
    selectedCard,
    loadingDetail,
    selectedConflict,
    conflictCards,
    selectConflict,
    openRelatedCard,
    revealImportedCard,
  };
}
