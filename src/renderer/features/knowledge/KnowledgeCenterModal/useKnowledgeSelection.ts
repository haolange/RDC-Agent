import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeCardDetail, KnowledgeCardRecord, KnowledgeLaneHit, KnowledgePack } from '@shared/types/knowledge';
import { createRequestSeq, knowledgeErrorMessage } from './knowledgeCenterModel';
import { useKnowledgeConflicts } from './useKnowledgeConflicts';

/** Card and conflict details share one selection/request owner. */
export function useKnowledgeSelection({ open, queryKey, hits, pack, onShowDetail, setError }: {
  open: boolean;
  queryKey: string;
  hits: KnowledgeLaneHit[];
  pack: KnowledgePack | null;
  onShowDetail: () => void;
  setError: (error: string | null) => void;
}) {
  const detailSeq = useRef(createRequestSeq());
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<KnowledgeCardDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const clearCardSelection = useCallback(() => {
    detailSeq.current.next();
    setSelectedCardId(null);
    setSelectedCard(null);
    setLoadingDetail(false);
  }, []);

  const selectCard = useCallback(async (spaceId: string, relativePath: string, cardId: string) => {
    const seq = detailSeq.current.next();
    setSelectedCardId(cardId);
    setSelectedCard(null);
    setLoadingDetail(true);
    setError(null);
    onShowDetail();
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
  }, [onShowDetail, setError]);
  const { selectedConflict, conflictCards, selectConflict, clearConflict } = useKnowledgeConflicts({
    hits,
    pack,
    detailSeq: detailSeq.current,
    onBeginSelect: () => {
      setSelectedCardId(null);
      setSelectedCard(null);
      setLoadingDetail(true);
      setError(null);
      onShowDetail();
    },
    onEndSelect: (seq) => {
      if (detailSeq.current.isCurrent(seq)) setLoadingDetail(false);
    },
    loadCard: async (spaceId, relativePath) => (await window.electronAPI.knowledge.card(spaceId, relativePath)).card,
  });

  const selectRecord = useCallback((record: KnowledgeCardRecord) => {
    detailSeq.current.next();
    setLoadingDetail(false);
    setError(null);
    setSelectedCardId(record.cardId);
    setSelectedCard({ ...record, content: record.body, body: record.body });
    onShowDetail();
  }, [onShowDetail, setError]);

  useEffect(() => {
    const sequence = detailSeq.current;
    clearCardSelection();
    clearConflict();
    return () => { sequence.next(); };
  }, [clearCardSelection, clearConflict, open, queryKey]);
  return { selectedCardId, selectedCard, loadingDetail, clearCardSelection,
    selectedConflict, conflictCards, selectConflict, clearConflict, selectCard, selectRecord };
}
