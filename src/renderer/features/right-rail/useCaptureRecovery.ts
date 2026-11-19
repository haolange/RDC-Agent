import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptureRecoveryStatus, CaptureReplayState } from '@shared/types/captureReplay';
import { getCaptureRecovery, restorePreviousCapture, type CaptureScope } from './capturePanelActions';

export function useCaptureRecovery(scope: CaptureScope, revision: number | undefined) {
  const [status, setStatus] = useState<CaptureRecoveryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const next = await getCaptureRecovery(scope);
      if (current === sequence.current) { setStatus(next); setError(null); }
    } catch (reason) {
      if (current === sequence.current) setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [scope]);
  useEffect(() => { void refresh(); return () => { sequence.current += 1; }; }, [refresh, revision]);
  const restore = useCallback(async (bindingGeneration: number): Promise<CaptureReplayState | null> => {
    setError(null);
    try {
      const result = await restorePreviousCapture({ ...scope, bindingGeneration });
      if (!result.success || !result.state) throw new Error(result.error ?? 'Capture recovery failed.');
      await refresh();
      return result.state;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null; }
  }, [refresh, scope]);
  return { status, error, restore };
}
