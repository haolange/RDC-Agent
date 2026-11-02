import { useEffect } from 'react';
import type { SessionScope } from '@shared/types/session';
import { useSessionDeviceStore, sessionDeviceKey } from '../stores/sessionDeviceStore';
import { useDeviceStore } from '../stores/deviceStore';

export function usePreparedSessionDevice(projectId?: string, sessionId?: string) {
  const devices = useDeviceStore((state) => state.devices);
  const deviceId = useSessionDeviceStore((state) => {
    if (!projectId || !sessionId) return null;
    const replay = state.states[sessionDeviceKey({ projectId, sessionId })];
    return replay?.preparation.phase === 'ready' ? replay.preparation.targetDeviceId : null;
  });
  return devices.find((device) => device.id === deviceId);
}

export function useSessionDevicePreparation(scope: SessionScope | null) {
  const key = scope ? sessionDeviceKey(scope) : '';
  const state = useSessionDeviceStore((value) => value.states[key] ?? null);
  const error = useSessionDeviceStore((value) => value.errors[key] ?? null);
  const actionFailure = useSessionDeviceStore((value) => value.actionFailures[key] ?? null);
  const projectId = scope?.projectId; const sessionId = scope?.sessionId;
  useEffect(() => {
    if (!projectId || !sessionId) return;
    const activeScope = { projectId, sessionId };
    let active = true;
    const unsubscribe = window.electronAPI.events.onCaptureReplayChanged((next) => {
      if (active && next.projectId === projectId && next.sessionId === sessionId) useSessionDeviceStore.getState().receive(next);
    });
    void useSessionDeviceStore.getState().load(activeScope);
    return () => { active = false; unsubscribe(); };
  }, [projectId, sessionId]);
  return { state, error, actionFailure };
}
