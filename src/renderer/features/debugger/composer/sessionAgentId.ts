import type { SessionRecord } from '@shared/types/session';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useLayoutStore } from '../../../stores/layoutStore';
import { applySessionRecordToStore } from './sessionModelOverride';

export function hydrateComposerAgentFromSession(session: SessionRecord | null | undefined): void {
  const agentId = session?.agentId?.trim() || 'general';
  useLayoutStore.getState().setSelectedAgentId(agentId);
}

export async function persistSessionAgentId(
  sessionId: string | null | undefined,
  agentId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!sessionId) {
    useLayoutStore.getState().setSelectedAgentId(agentId);
    return { ok: true };
  }
  const api = getElectronApi();
  if (!api) return { ok: false, error: 'BRIDGE_UNAVAILABLE' };
  const result = await api.session.setAgentId(sessionId, agentId);
  if (!result.success || !result.session) {
    return { ok: false, error: result.error || 'AGENT_UNAVAILABLE' };
  }
  applySessionRecordToStore(result.session);
  useLayoutStore.getState().setSelectedAgentId(result.session.agentId || agentId);
  return { ok: true };
}
