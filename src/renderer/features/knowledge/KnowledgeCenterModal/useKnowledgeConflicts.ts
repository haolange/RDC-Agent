import { useCallback, useState } from 'react';
import type { KnowledgeCardDetail, KnowledgeLaneHit, KnowledgePack, KnowledgePackConflict } from '@shared/types/knowledge';

interface UseKnowledgeConflictsOptions {
  hits: KnowledgeLaneHit[];
  pack: KnowledgePack | null;
  /** Detail request sequence shared with card selection so a late conflict load never overwrites a newer selection. */
  detailSeq: { next(): number; isCurrent(value: number): boolean };
  onBeginSelect: () => void;
  onEndSelect: (seq: number) => void;
  loadCard: (spaceId: string, relativePath: string) => Promise<KnowledgeCardDetail | null>;
}

export interface ConflictCardPair {
  left: KnowledgeCardDetail | null;
  right: KnowledgeCardDetail | null;
}

/**
 * Conflicts view selection: resolves both ids of a contradicts pair through the compiled
 * pack (fallback: current hits) and loads the cards via the existing card IPC.
 */
export function useKnowledgeConflicts({ hits, pack, detailSeq, onBeginSelect, onEndSelect, loadCard }: UseKnowledgeConflictsOptions) {
  const [selectedConflict, setSelectedConflict] = useState<KnowledgePackConflict | null>(null);
  const [conflictCards, setConflictCards] = useState<ConflictCardPair>({ left: null, right: null });

  const selectConflict = useCallback(async (conflict: KnowledgePackConflict) => {
    const seq = detailSeq.next();
    setSelectedConflict(conflict);
    setConflictCards({ left: null, right: null });
    onBeginSelect();
    const locate = (cardId: string) => pack?.hits.find((hit) => hit.cardId === cardId)
      ?? hits.find((hit) => hit.cardId === cardId)
      ?? null;
    const load = async (cardId: string): Promise<KnowledgeCardDetail | null> => {
      const hit = locate(cardId);
      if (!hit) return null;
      try {
        return await loadCard(hit.spaceId, hit.relativePath);
      } catch {
        return null;
      }
    };
    try {
      const [left, right] = await Promise.all([load(conflict.leftCardId), load(conflict.rightCardId)]);
      if (!detailSeq.isCurrent(seq)) return;
      setConflictCards({ left, right });
    } finally {
      onEndSelect(seq);
    }
  }, [detailSeq, hits, loadCard, onBeginSelect, onEndSelect, pack]);

  const clearConflict = useCallback(() => {
    setSelectedConflict(null);
    setConflictCards({ left: null, right: null });
  }, []);

  return { selectedConflict, conflictCards, selectConflict, clearConflict };
}
