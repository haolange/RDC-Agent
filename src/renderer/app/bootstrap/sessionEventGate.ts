import type { SessionScope } from '@shared/types/session';
import { useProjectStore } from '../../stores/projectStore';

/** True when sessionId matches the renderer active session. */
export function isActiveSessionEvent(sessionId: string | null | undefined): boolean {
  const active = useProjectStore.getState().currentSession?.sessionId;
  return Boolean(active && sessionId && active === sessionId);
}

/** True only when both project and session match the active renderer scope. */
export function isActiveSessionScope(scope: SessionScope | null | undefined): boolean {
  const { currentProject, currentSession } = useProjectStore.getState();
  return Boolean(
    scope
    && currentProject?.projectId === scope.projectId
    && currentSession?.sessionId === scope.sessionId,
  );
}
/** Resolve active session id, or null when none selected. */
export function getActiveSessionId(): string | null {
  return useProjectStore.getState().currentSession?.sessionId ?? null;
}
