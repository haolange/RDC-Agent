import { useProjectStore } from './projectStore';
import type { SessionScope } from '@shared/types/session';

export function isActiveSessionEvent(sessionId: string | null | undefined): boolean {
  const active = useProjectStore.getState().currentSession?.sessionId;
  return Boolean(active && sessionId && active === sessionId);
}

export function isActiveSessionScope(scope: SessionScope | null | undefined): boolean {
  const { currentProject, currentSession } = useProjectStore.getState();
  return Boolean(
    scope
    && currentProject?.projectId === scope.projectId
    && currentSession?.sessionId === scope.sessionId,
  );
}

export function getActiveSessionId(): string | null {
  return useProjectStore.getState().currentSession?.sessionId ?? null;
}
