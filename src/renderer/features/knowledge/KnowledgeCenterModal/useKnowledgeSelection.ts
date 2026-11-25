import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError } from '@shared/errors/appError';
import { errorDetail } from '../../../lib/errorDetail';
import { createRequestSeq } from './knowledgeCenterModel';
import { useKnowledgeConflicts } from './useKnowledgeConflicts';
import type { KnowledgeCardDetail, KnowledgeCardRecord, KnowledgeLaneHit, KnowledgePack } from '@shared/types/knowledge';

/**
 * Card and conflict details share one selection/request owner. A selected card is read whole: the reader shows the
 * full text, and writes start from the exact version that was read.
 */
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

  const selectCard = useCallback(async (spaceId: string, relativePath: string, cardId: string, contentHash?: string) => {
    const seq = detailSeq.current.next();
    setSelectedCardId(cardId);
    setSelectedCard(null);
    setLoadingDetail(true);
    setError(null);
    onShowDetail();
    try {
      const { card } = await window.electronAPI.knowledge.card(spaceId, relativePath);
      if (!detailSeq.current.isCurrent(seq)) return;
      if (!card || card.cardId !== cardId) throw new AppError('KNOWLEDGE_CARD_IDENTITY_CHANGED', 'refresh the search.');
      // A search hit names the version it matched; a card that changed since must be searched again.
      if (contentHash && card.contentHash !== contentHash) throw new AppError('KNOWLEDGE_VERSION_CHANGED', 'the card has changed; search again before reading.');
      setSelectedCard(card);
    } catch (err) {
      if (!detailSeq.current.isCurrent(seq)) return;
      setSelectedCard(null);
      setError(errorDetail(err));
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
