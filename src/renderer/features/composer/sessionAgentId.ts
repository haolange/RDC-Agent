import type { PlanReviewHandoffSuggestion } from '@shared/types/planReview';
import { getElectronApi } from '../../platform/getElectronApi';
import { useProjectStore } from '../../stores/projectStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { applySessionRecordToStore } from './sessionModelOverride';

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
  if (useProjectStore.getState().currentSession?.sessionId === sessionId) {
    useLayoutStore.getState().setSelectedAgentId(result.session.agentId || agentId);
  }
  return { ok: true };
}

export async function applyDeclaredHandoffOnClient(
  sessionId: string,
  agent: string,
  label: string,
): Promise<{ ok: boolean; error?: string; suggestion?: PlanReviewHandoffSuggestion }> {
  const api = getElectronApi();
  if (!api) return { ok: false, error: 'BRIDGE_UNAVAILABLE' };
  const result = await api.session.applyDeclaredHandoff(sessionId, agent, label);
  if (!result.success) {
    return { ok: false, error: result.error || 'DECLARED_HANDOFF_FAILED' };
  }
  if (result.session) {
    applySessionRecordToStore(result.session);
    if (useProjectStore.getState().currentSession?.sessionId === sessionId) {
      useLayoutStore.getState().setSelectedAgentId(result.session.agentId || agent);
    }
  }
  return { ok: true, suggestion: result.suggestion };
}
