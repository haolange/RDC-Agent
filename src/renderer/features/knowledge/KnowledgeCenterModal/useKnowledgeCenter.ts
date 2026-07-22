import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  KnowledgeCardDetail,
  KnowledgeCardSummary,
  KnowledgeSpace,
} from '@shared/types/knowledge';

export interface KnowledgeCenterState {
  spaces: KnowledgeSpace[];
  cardsBySpace: Record<string, KnowledgeCardSummary[]>;
  expandedSpaceIds: Set<string>;
  selectedCardId: string | null;
  selectedCard: KnowledgeCardDetail | null;
  searchQuery: string;
  loadingSpaces: boolean;
  loadingCards: boolean;
  loadingDetail: boolean;
  error: string | null;
  setSearchQuery: (value: string) => void;
  toggleSpace: (spaceId: string) => void;
  selectCard: (spaceId: string, relativePath: string, cardId: string) => Promise<void>;
  refresh: () => Promise<void>;
  filteredSpaces: Array<KnowledgeSpace & { cards: KnowledgeCardSummary[] }>;
}

export function useKnowledgeCenter(open: boolean): KnowledgeCenterState {
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [cardsBySpace, setCardsBySpace] = useState<Record<string, KnowledgeCardSummary[]>>({});
  const [expandedSpaceIds, setExpandedSpaceIds] = useState<Set<string>>(new Set(['user']));
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<KnowledgeCardDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadingCards, setLoadingCards] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCardsForSpaces = useCallback(async (nextSpaces: KnowledgeSpace[]) => {
    setLoadingCards(true);
    try {
      const entries = await Promise.all(
        nextSpaces.map(async (space) => {
          const result = await window.electronAPI.knowledge.listCards(space.spaceId);
          return [space.spaceId, result.cards] as const;
        }),
      );
      const nextMap: Record<string, KnowledgeCardSummary[]> = {};
      for (const [spaceId, cards] of entries) {
        nextMap[spaceId] = cards;
      }
      setCardsBySpace(nextMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingCards(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoadingSpaces(true);
    setError(null);
    try {
      const result = await window.electronAPI.knowledge.listSpaces();
      setSpaces(result.spaces);
      await loadCardsForSpaces(result.spaces);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSpaces(false);
    }
  }, [loadCardsForSpaces]);

  const toggleSpace = useCallback((spaceId: string) => {
    setExpandedSpaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      return next;
    });
  }, []);

  const selectCard = useCallback(async (spaceId: string, relativePath: string, cardId: string) => {
    setSelectedCardId(cardId);
    setLoadingDetail(true);
    setError(null);
    try {
      const result = await window.electronAPI.knowledge.getCard(spaceId, relativePath);
      setSelectedCard(result.card);
      if (!result.card) {
        setError('Knowledge card not found.');
      }
    } catch (err) {
      setSelectedCard(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setSelectedCardId(null);
      setSelectedCard(null);
      setError(null);
      return;
    }
    void refresh();
  }, [open, refresh]);

  const filteredSpaces = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase();
    return spaces.map((space) => {
      const cards = cardsBySpace[space.spaceId] ?? [];
      const filteredCards = !needle
        ? cards
        : cards.filter((card) =>
          [card.title, card.preview ?? '', card.relativePath, space.label]
            .join('\n')
            .toLocaleLowerCase()
            .includes(needle));
      return { ...space, cards: filteredCards };
    }).filter((space) => {
      if (!needle) return true;
      if (space.label.toLocaleLowerCase().includes(needle)) return true;
      return space.cards.length > 0;
    });
  }, [cardsBySpace, searchQuery, spaces]);

  return {
    spaces,
    cardsBySpace,
    expandedSpaceIds,
    selectedCardId,
    selectedCard,
    searchQuery,
    loadingSpaces,
    loadingCards,
    loadingDetail,
    error,
    setSearchQuery,
    toggleSpace,
    selectCard,
    refresh,
    filteredSpaces,
  };
}
