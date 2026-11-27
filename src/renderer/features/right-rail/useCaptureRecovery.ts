import { useCallback, useEffect, useRef, useState } from 'react';
import { getCaptureRecovery, recoverCapture, type CaptureScope } from './capturePanelActions';
import type { CaptureRecoveryStatus, CaptureReplayState } from '@shared/types/captureReplay';

export function useCaptureRecovery(scope: CaptureScope, revision: number | undefined) {
  const [status, setStatus] = useState<CaptureRecoveryStatus | null>(null);
  /** The last failed read or restore, worded by humanizeError where it shows. */
  const [error, setError] = useState<{ reason: unknown } | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const next = await getCaptureRecovery(scope);
      if (current === sequence.current) {
        setStatus(next);
        setError(null);
      }
    } catch (reason) {
      if (current === sequence.current) setError({ reason });
    }
  }, [scope]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current += 1;
    };
  }, [refresh, revision]);
  const restore = useCallback(
    async (bindingGeneration: number): Promise<CaptureReplayState | null> => {
      setError(null);
      try {
        const state = await recoverCapture({ ...scope, bindingGeneration });
        await refresh();
        return state;
      } catch (reason) {
        setError({ reason });
        return null;
      }
    },
    [refresh, scope],
  );
  return { status, error, recover: restore };
}
