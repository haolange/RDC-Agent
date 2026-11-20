import { DEFAULT_AGENT_ID } from '@shared/types/agent';
import type { SessionRecord } from '@shared/types/session';
import { useLayoutStore } from './layoutStore';

export function hydrateComposerAgentFromSession(session: SessionRecord | null | undefined): void {
  const agentId = session?.agentId?.trim() || DEFAULT_AGENT_ID;
  useLayoutStore.getState().setSelectedAgentId(agentId);
}
