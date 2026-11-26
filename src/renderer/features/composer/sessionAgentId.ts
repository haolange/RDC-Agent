import { getElectronApi } from '../../platform/getElectronApi';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionRecordStore } from '../../stores/sessionRecordStore';
import { writeComposerDraftAgent } from '../../stores/composerModelDraftStore';
import type { PlanReviewHandoffSuggestion } from '@shared/types/planReview';

/**
 * Switches the session's Agent. The choice shows at once as a pending intent; main's answer replaces it only when its
 * revision is newer than the record held, so a late answer to an earlier switch cannot undo a later one. A failure
 * drops the intent and the record's Agent shows again.
 */
export async function persistSessionAgentId(
  sessionId: string | null | undefined,
  agentId: string,
): Promise<{ ok: boolean; error?: unknown }> {
  if (!sessionId) {
    writeComposerDraftAgent(useProjectStore.getState().currentProject?.projectId, agentId);
    return { ok: true };
  }
  const api = getElectronApi();
  if (!api) return { ok: false, error: 'BRIDGE_UNAVAILABLE' };
  const records = useSessionRecordStore.getState();
  const intentId = records.beginIntent(sessionId, { agentId });
  try {
    records.accept((await api.session.setAgentId(sessionId, agentId)).session);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  } finally {
    records.settleIntent(sessionId, intentId);
  }
}

export async function applyDeclaredHandoffOnClient(
  sessionId: string,
  agent: string,
  label: string,
  isCurrent: () => boolean,
  expectedPlanHash?: string,
): Promise<{ ok: boolean; error?: string; suggestion?: PlanReviewHandoffSuggestion }> {
  const api = getElectronApi();
  if (!api) return { ok: false, error: 'BRIDGE_UNAVAILABLE' };
  // A failed switch rejects with the main process's coded error; the caller words it.
  const result = await api.session.applyDeclaredHandoff(sessionId, agent, label, expectedPlanHash);
  useSessionRecordStore.getState().accept(result.session);
  if (!isCurrent()) return { ok: false, error: 'HANDOFF_CONTEXT_CHANGED' };
  return { ok: true, suggestion: result.suggestion };
}
