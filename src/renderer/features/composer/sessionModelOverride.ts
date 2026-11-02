import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { SessionModelOverride, SessionRecord } from '@shared/types/session';
import { getElectronApi } from '../../platform/getElectronApi';
import { useProjectStore } from '../../stores/projectStore';
import {
  clearComposerDraftModel,
  readComposerDraftModel,
  writeComposerDraftModel,
} from '../../stores/composerModelDraftStore';

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

async function saveSessionModelOverride(
  sessionId: string | null | undefined,
  modelOverride: SessionModelOverride | null | undefined,
  turnControls?: ConversationTurnControls,
  isCurrent: () => boolean = () => true,
): Promise<{ ok: boolean; error?: string }> {
  if (!sessionId) return { ok: false, error: 'SESSION_MISSING' };
  const api = getElectronApi();
  if (!api) return { ok: false, error: 'BRIDGE_UNAVAILABLE' };
  try {
    const latest = useProjectStore.getState().currentSession;
    if (modelOverride === undefined && latest?.sessionId !== sessionId) return { ok: false, error: 'MODEL_SAVE_CANCELLED' };
    const override = modelOverride === undefined ? latest?.modelOverride ?? null : modelOverride;
    const result = turnControls
      ? await api.session.setModelOverride(sessionId, override, turnControls)
      : await api.session.setModelOverride(sessionId, override);
    if (!result.success || !result.session) return { ok: false, error: result.error || 'MODEL_UNAVAILABLE' };
    if (isCurrent()) applySessionRecordToStore(result.session);
    return { ok: true };
  } catch {
    return { ok: false, error: 'MODEL_SAVE_FAILED' };
  }
}

const sessionSaves = new Map<string, Promise<{ ok: boolean; error?: string }>>();
function enqueueSessionModelSave(
  sessionId: string | null | undefined,
  modelOverride: SessionModelOverride | null | undefined,
  turnControls?: ConversationTurnControls,
): Promise<{ ok: boolean; error?: string }> {
  if (!sessionId) return Promise.resolve({ ok: false, error: 'SESSION_MISSING' });
  const initial = useProjectStore.getState();
  const projectId = initial.currentProject?.projectId;
  const selectedSessionId = initial.currentSession?.sessionId;
  let invalidated = false;
  const off = useProjectStore.subscribe((state) => {
    if (state.currentProject?.projectId !== projectId || state.currentSession?.sessionId !== selectedSessionId) invalidated = true;
  });
  const save = () => invalidated ? Promise.resolve({ ok: false, error: 'MODEL_SAVE_CANCELLED' })
    : saveSessionModelOverride(sessionId, modelOverride, turnControls, () => !invalidated);
  const previous = sessionSaves.get(sessionId);
  const pending = previous ? previous.then(save) : save();
  sessionSaves.set(sessionId, pending);
  void pending.finally(() => { off(); if (sessionSaves.get(sessionId) === pending) sessionSaves.delete(sessionId); });
  return pending;
}

export function persistSessionModelOverride(
  sessionId: string | null | undefined,
  modelOverride: SessionModelOverride | null,
  turnControls?: ConversationTurnControls,
): Promise<{ ok: boolean; error?: string }> {
  return enqueueSessionModelSave(sessionId, modelOverride, turnControls);
}

/** Resolve the model at queue execution time so an earlier model edit is retained. */
export function persistSessionTurnControls(sessionId: string, turnControls: ConversationTurnControls) {
  return enqueueSessionModelSave(sessionId, undefined, turnControls);
}

export function flushSessionModelSaves(sessionId: string): Promise<void> | undefined {
  const first = sessionSaves.get(sessionId);
  if (!first) return undefined;
  return (async () => {
    let pending: typeof first | undefined = first;
    while (pending) {
      const result = await pending;
      if (!result.ok) throw new Error(result.error || 'MODEL_SAVE_FAILED');
      const latest = sessionSaves.get(sessionId);
      if (latest === pending) return;
      pending = latest;
    }
  })();
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
