import { useCallback, useEffect, useRef, useState } from 'react';
import { errorCodeOf } from '@shared/errors/appError';
import type { KnowledgeOperationProgress } from '@shared/types/knowledgeOperation';

/** How a long knowledge task ended: with its value, or stopped by the person between items. */
export type KnowledgeOperationOutcome<T> = { cancelled: false; value: T } | { cancelled: true };

interface RunningKnowledgeOperation {
  operationId: string;
  progress: KnowledgeOperationProgress | null;
  cancelling: boolean;
}

/**
 * Follows one main-process knowledge task at a time (import, export or index rebuild). Each run gets a fresh id that
 * main reports progress under; `cancel` asks main to stop that run. A cancelled run settles as `{ cancelled: true }`,
 * a neutral outcome: main has already put things back, so it is never shown as a failure. Other failures still reject.
 */
export function useKnowledgeOperation() {
  const current = useRef<string | null>(null);
  const [running, setRunning] = useState<RunningKnowledgeOperation | null>(null);

  useEffect(() => window.electronAPI.events.onKnowledgeProgress((progress) => {
    if (progress.operationId !== current.current) return;
    setRunning((state) => (state?.operationId === progress.operationId ? { ...state, progress } : state));
  }), []);

  const run = useCallback(async <T>(start: (operationId: string) => Promise<T>): Promise<KnowledgeOperationOutcome<T>> => {
    const operationId = crypto.randomUUID();
    current.current = operationId;
    setRunning({ operationId, progress: null, cancelling: false });
    try {
      return { cancelled: false, value: await start(operationId) };
    } catch (error) {
      if (errorCodeOf(error) === 'KNOWLEDGE_OPERATION_CANCELLED') return { cancelled: true };
      throw error;
    } finally {
      if (current.current === operationId) {
        current.current = null;
        setRunning(null);
      }
    }
  }, []);

  /** Stays pending until main answers; a request that could not be delivered lets the person ask again. */
  const cancel = useCallback(() => {
    const operationId = current.current;
    if (!operationId) return;
    const settle = (cancelling: boolean) => setRunning((state) => (
      state?.operationId === operationId ? { ...state, cancelling } : state
    ));
    settle(true);
    void window.electronAPI.knowledge.cancel({ operationId }).catch((error: unknown) => {
      console.warn('[knowledge] could not cancel the operation', error);
      settle(false);
    });
  }, []);

  return {
    running: running !== null,
    progress: running?.progress ?? null,
    cancelling: running?.cancelling ?? false,
    run,
    cancel,
  };
}

export type KnowledgeOperationControl = ReturnType<typeof useKnowledgeOperation>;
