import type { SessionRecord } from '@shared/types/session';
import { useLayoutStore } from './layoutStore';

export function hydrateComposerAgentFromSession(session: SessionRecord | null | undefined): void {
  const agentId = session?.agentId?.trim() || 'general';
  useLayoutStore.getState().setSelectedAgentId(agentId);
}
