import { useCallback, useRef, useState } from 'react';
import { errorDetail } from '../../../lib/errorDetail';
import { createRequestSeq, toggleSetValue } from './knowledgeCenterModel';
import { nextSelectedSpaceIds } from './knowledgeCenterQuery';
import type { KnowledgeIndexOverview, KnowledgeSpace } from '@shared/types/knowledge';

/** The knowledge spaces, the index state and which spaces are selected; a newer read supersedes an older one. */
export function useKnowledgeOverview(setError: (error: string | null) => void) {
  const overviewSeq = useRef(createRequestSeq());
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [index, setIndex] = useState<KnowledgeIndexOverview | null>(null);
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(false);

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
  }, [setError]);
  const toggleSpace = useCallback((id: string) => setSelectedSpaceIds((cur) => toggleSetValue(cur, id)), []);
  /** Drops a read in flight, as closing the Knowledge Center does. */
  const stopOverview = useCallback(() => {
    overviewSeq.current.next();
    setLoadingOverview(false);
  }, []);

  return { overviewSeq, setSelectedSpaceIds, stopOverview, view: { spaces, index, selectedSpaceIds, loadingOverview, refreshOverview, toggleSpace } };
}
