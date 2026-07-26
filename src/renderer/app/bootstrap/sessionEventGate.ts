import { useProjectStore } from '../../stores/projectStore';

/** True when sessionId matches the renderer active session. */
export function isActiveSessionEvent(sessionId: string | null | undefined): boolean {
  const active = useProjectStore.getState().currentSession?.sessionId;
  return Boolean(active && sessionId && active === sessionId);
}

/** Resolve active session id, or null when none selected. */
export function getActiveSessionId(): string | null {
  return useProjectStore.getState().currentSession?.sessionId ?? null;
}
