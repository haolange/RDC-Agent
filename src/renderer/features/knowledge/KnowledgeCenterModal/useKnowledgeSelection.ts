import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeCardDetail, KnowledgeCardRecord, KnowledgeLaneHit, KnowledgePack, KnowledgeReadRequest, KnowledgeReadResult } from '@shared/types/knowledge';
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
  const [reading, setReading] = useState<KnowledgeReadResult | null>(null);
  const [readingBusy, setReadingBusy] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const clearCardSelection = useCallback(() => {
    detailSeq.current.next();
    setSelectedCardId(null);
    setSelectedCard(null);
    setReading(null);
    setReadingBusy(false);
    setLoadingDetail(false);
  }, []);

  const selectCard = useCallback(async (spaceId: string, relativePath: string, cardId: string, contentHash?: string) => {
    const seq = detailSeq.current.next();
    setSelectedCardId(cardId);
    setSelectedCard(null);
    setReading(null);
    setReadingBusy(false);
    setLoadingDetail(true);
    setError(null);
    onShowDetail();
    try {
      const result = await window.electronAPI.knowledge.read({ spaceId, relativePath, mode: 'summary', ...(contentHash ? { contentHash } : {}) });
      if (!detailSeq.current.isCurrent(seq)) return;
      if (result.card.cardId !== cardId) throw new Error('KNOWLEDGE_CARD_IDENTITY_CHANGED: refresh the search.');
      setSelectedCard({ ...result.card, body: '', content: '' });
      setReading(result);
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
      setReading(null);
      setReadingBusy(false);
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
    setReading(null);
    setReadingBusy(false);
    onShowDetail();
  }, [onShowDetail, setError]);

  const readSelection = useCallback(async (selection: Pick<KnowledgeReadRequest, 'mode' | 'heading' | 'headingLine' | 'startLine' | 'endLine'>) => {
    if (!selectedCard?.contentHash || !reading) return;
    const seq = detailSeq.current.next();
    setReadingBusy(true); setError(null);
    try {
      const result = await window.electronAPI.knowledge.read({ ...selection, spaceId: selectedCard.spaceId,
        relativePath: selectedCard.relativePath, contentHash: selectedCard.contentHash });
      if (!detailSeq.current.isCurrent(seq)) return;
      if (result.card.cardId !== selectedCard.cardId) throw new Error('KNOWLEDGE_CARD_IDENTITY_CHANGED: refresh the search.');
      setReading(result);
    } catch (error) { if (detailSeq.current.isCurrent(seq)) setError(knowledgeErrorMessage(error)); }
    finally { if (detailSeq.current.isCurrent(seq)) setReadingBusy(false); }
  }, [reading, selectedCard, setError]);

  const ensureFullCard = useCallback(async (): Promise<KnowledgeCardDetail | null> => {
    if (!selectedCard) return null;
    if (!reading) return selectedCard;
    const seq = detailSeq.current.next();
    setReadingBusy(true); setError(null);
    try {
      const result = await window.electronAPI.knowledge.card(selectedCard.spaceId, selectedCard.relativePath);
      if (!detailSeq.current.isCurrent(seq)) return null;
      if (!result.card || result.card.cardId !== selectedCard.cardId || result.card.contentHash !== selectedCard.contentHash) {
        throw new Error('KNOWLEDGE_VERSION_CHANGED: refresh the card before writing.');
      }
      return result.card;
    } catch (error) { if (detailSeq.current.isCurrent(seq)) setError(knowledgeErrorMessage(error)); return null; }
    finally { if (detailSeq.current.isCurrent(seq)) setReadingBusy(false); }
  }, [reading, selectedCard, setError]);

  useEffect(() => {
    const sequence = detailSeq.current;
    clearCardSelection();
    clearConflict();
    return () => { sequence.next(); };
  }, [clearCardSelection, clearConflict, open, queryKey]);
  return { selectedCardId, selectedCard, reading, readingBusy, readSelection, ensureFullCard, loadingDetail, clearCardSelection,
    selectedConflict, conflictCards, selectConflict, clearConflict, selectCard, selectRecord };
}
