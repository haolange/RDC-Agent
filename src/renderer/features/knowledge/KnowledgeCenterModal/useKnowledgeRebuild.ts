import { useCallback, useRef, useState } from 'react';
import { createRequestSeq } from './knowledgeCenterModel';
import { useKnowledgeOperation } from './useKnowledgeOperation';

/** Rebuilds the knowledge index as a cancellable operation, then shows the rebuilt overview and query. */
export function useKnowledgeRebuild(refreshOverview: () => Promise<void>, refreshQuery: () => Promise<void>) {
  const rebuildSeq = useRef(createRequestSeq());
  const [rebuilding, setRebuilding] = useState(false);
  const { run, cancel, progress, cancelling } = useKnowledgeOperation();
  /**
   * Resolves `rebuilt` once the rebuilt index is shown, or `cancelled` when the person stopped it (the previous index
   * stays in use). A failure rejects, so the dialog that asked keeps it in view.
   */
  const rebuildIndex = useCallback(async (): Promise<'rebuilt' | 'cancelled'> => {
    const seq = rebuildSeq.current.next();
    setRebuilding(true);
    try {
      const outcome = await run((operationId) => window.electronAPI.knowledge.indexRebuild({ operationId }));
      if (outcome.cancelled) return 'cancelled';
      if (!rebuildSeq.current.isCurrent(seq)) return 'rebuilt';
      await refreshOverview();
      if (!rebuildSeq.current.isCurrent(seq)) return 'rebuilt';
      await refreshQuery();
      return 'rebuilt';
    } finally {
      if (rebuildSeq.current.isCurrent(seq)) setRebuilding(false);
    }
  }, [refreshOverview, refreshQuery, run]);
  /** Lets a rebuild in flight finish without showing its result, as closing the Knowledge Center does. */
  const stopRebuild = useCallback(() => {
    rebuildSeq.current.next();
    setRebuilding(false);
  }, []);

  return {
    rebuildSeq,
    stopRebuild,
    view: { rebuilding, rebuildIndex, rebuildProgress: progress, rebuildCancelling: cancelling, cancelRebuild: cancel },
  };
}
