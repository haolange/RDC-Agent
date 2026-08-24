import type { SessionModelOverride, SessionRecord } from '@shared/types/session';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useProjectStore } from '../../../stores/projectStore';
import {
  clearComposerDraftModel,
  readComposerDraftModel,
  writeComposerDraftModel,
} from './composerModelDraft';

export function applySessionRecordToStore(session: SessionRecord): void {
  const store = useProjectStore.getState();
  if (!store.currentSession || store.currentSession.sessionId === session.sessionId) {
    store.setCurrentSession(session);
  }
  const sessions = store.sessions.some((entry) => entry.sessionId === session.sessionId)
    ? store.sessions.map((entry) => (entry.sessionId === session.sessionId ? session : entry))
    : [session, ...store.sessions];
  store.setSessions(sessions);
}

export async function persistSessionModelOverride(
  sessionId: string | null | undefined,
  modelOverride: SessionModelOverride | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!sessionId) return { ok: false, error: 'SESSION_MISSING' };
  const api = getElectronApi();
  if (!api) return { ok: false, error: 'BRIDGE_UNAVAILABLE' };
  const result = await api.session.setModelOverride(sessionId, modelOverride);
  if (!result.success || !result.session) {
    return { ok: false, error: result.error || 'MODEL_UNAVAILABLE' };
  }
  applySessionRecordToStore(result.session);
  return { ok: true };
}

export async function commitComposerModelChoice(
  model: SessionModelOverride,
  sessionId: string | null | undefined,
  projectId: string | null | undefined,
): Promise<{ ok: boolean; error?: string }> {
  if (sessionId) {
    return persistSessionModelOverride(sessionId, model);
  }
  writeComposerDraftModel(projectId, model);
  return { ok: true };
}

export async function clearComposerModelChoice(
  sessionId: string | null | undefined,
  projectId: string | null | undefined,
): Promise<{ ok: boolean; error?: string }> {
  if (sessionId) {
    return persistSessionModelOverride(sessionId, null);
  }
  clearComposerDraftModel(projectId);
  return { ok: true };
}

export async function persistComposerDraftToSession(
  sessionId: string | null | undefined,
  projectId: string | null | undefined,
): Promise<void> {
  if (!sessionId) return;
  const draft = readComposerDraftModel(projectId);
  if (!draft) return;
  const result = await persistSessionModelOverride(sessionId, draft);
  if (result.ok) {
    clearComposerDraftModel(projectId);
  }
}
