import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptureReplaySelection, CaptureReplayState } from '@shared/types/captureReplay';
import { getReplaySelection, getReplayState, subscribeReplay, type CaptureScope } from './capturePanelActions';

export function acceptsReplayState(current: CaptureReplayState | null, next: CaptureReplayState, scope: CaptureScope) {
  return next.projectId === scope.projectId && next.sessionId === scope.sessionId
    && (!current || next.generation > current.generation || (next.generation === current.generation && next.revision >= current.revision));
}

export function useCaptureReplay(scope: CaptureScope) {
  const [state, setState] = useState<CaptureReplayState | null>(null);
  const [selection, setSelection] = useState<CaptureReplaySelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const receive = useCallback((next: CaptureReplayState) => {
    if (active.current) setState((current) => acceptsReplayState(current, next, scope) ? next : current);
  }, [scope]);
  const reload = useCallback(async () => {
    try {
      const [next, remembered] = await Promise.all([getReplayState(scope), getReplaySelection(scope)]);
      if (!active.current) return;
      receive(next); setSelection(remembered); setError(null);
    } catch (reason) { if (active.current) setError(String(reason instanceof Error ? reason.message : reason)); }
  }, [scope, receive]);
  useEffect(() => {
    active.current = true;
    const unsubscribe = subscribeReplay(receive);
    void reload();
    return () => { active.current = false; unsubscribe(); };
  }, [reload, receive]);
  return { state, selection, error, reload, receive };
}
