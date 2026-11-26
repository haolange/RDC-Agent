import { useProjectStore } from './projectStore';
import type { SessionScope } from '@shared/types/session';

export function isActiveSessionEvent(sessionId: string | null | undefined): boolean {
  const active = useProjectStore.getState().currentSessionId;
  return Boolean(active && sessionId && active === sessionId);
}

export function isActiveSessionScope(scope: SessionScope | null | undefined): boolean {
  const { currentProject, currentSessionId } = useProjectStore.getState();
  return Boolean(scope && currentProject?.projectId === scope.projectId && currentSessionId === scope.sessionId);
}

export function getActiveSessionId(): string | null {
  return useProjectStore.getState().currentSessionId;
}
