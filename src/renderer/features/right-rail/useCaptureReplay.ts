import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptureReplaySelection, CaptureReplayState } from '@shared/types/captureReplay';
import { useSessionDevicePreparation } from '../../hooks/useSessionDevicePreparation';
import { useSessionDeviceStore } from '../../stores/sessionDeviceStore';
import { getReplaySelection, type CaptureScope } from './capturePanelActions';

export function useCaptureReplay(scope: CaptureScope) {
  const { state, error, actionFailure } = useSessionDevicePreparation(scope);
  const [selection, setSelection] = useState<CaptureReplaySelection | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const active = useRef(true);
  const receive = useCallback((next: CaptureReplayState) => {
    if (active.current) useSessionDeviceStore.getState().receive(next);
  }, []);
  const reload = useCallback(async () => {
    try {
      const [, remembered] = await Promise.all([useSessionDeviceStore.getState().load(scope), getReplaySelection(scope)]);
      if (active.current) { setSelection(remembered); setSelectionError(null); }
    } catch (reason) { if (active.current) setSelectionError(reason instanceof Error ? reason.message : String(reason)); }
  }, [scope]);
  useEffect(() => {
    active.current = true; void reload();
    return () => { active.current = false; };
  }, [reload]);
  return { state, selection, error: error ?? selectionError, actionFailure, reload, receive };
}
