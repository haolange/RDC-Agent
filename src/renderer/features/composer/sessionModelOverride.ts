import { getElectronApi } from '../../platform/getElectronApi';
import { useProjectStore } from '../../stores/projectStore';
import { getSessionView, useSessionRecordStore } from '../../stores/sessionRecordStore';
import {
  clearComposerDraftModel,
  readComposerDraftModel,
  writeComposerDraftAgent,
  writeComposerDraftModel,
} from '../../stores/composerModelDraftStore';
import type { SessionModelOverride } from '@shared/types/session';
import type { ConversationTurnControls } from '@shared/types/modelCapability';

async function saveSessionModelOverride(
  sessionId: string | null | undefined,
  modelOverride: SessionModelOverride | null | undefined,
  turnControls?: ConversationTurnControls,
): Promise<{ ok: boolean; error?: string }> {
  if (!sessionId) return { ok: false, error: 'SESSION_MISSING' };
  const api = getElectronApi();
  if (!api) return { ok: false, error: 'BRIDGE_UNAVAILABLE' };
  try {
    // A controls-only save carries the model the session shows now, including an earlier model choice still pending.
    const override = modelOverride === undefined ? getSessionView(sessionId)?.modelOverride ?? null : modelOverride;
    const result = turnControls
      ? await api.session.setModelOverride(sessionId, override, turnControls)
      : await api.session.setModelOverride(sessionId, override);
    if (!result.success || !result.session) return { ok: false, error: result.error || 'MODEL_UNAVAILABLE' };
    useSessionRecordStore.getState().accept(result.session);
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
  const selectedSessionId = initial.currentSessionId;
  let invalidated = false;
  const off = useProjectStore.subscribe((state) => {
    if (state.currentProject?.projectId !== projectId || state.currentSessionId !== selectedSessionId) invalidated = true;
  });
  // The chosen model shows while its save is queued or in flight; a failed or cancelled save drops it again.
  const intentId = modelOverride === undefined ? null : useSessionRecordStore.getState().beginIntent(sessionId, { modelOverride });
  const save = () => invalidated ? Promise.resolve({ ok: false, error: 'MODEL_SAVE_CANCELLED' })
    : saveSessionModelOverride(sessionId, modelOverride, turnControls);
  const previous = sessionSaves.get(sessionId);
  const pending = previous ? previous.then(save) : save();
  sessionSaves.set(sessionId, pending);
  void pending.finally(() => {
    off();
    if (intentId !== null) useSessionRecordStore.getState().settleIntent(sessionId, intentId);
    if (sessionSaves.get(sessionId) === pending) sessionSaves.delete(sessionId);
  });
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
  // The first turn carried the draft Agent and main wrote it to the new session.
  writeComposerDraftAgent(projectId, null);
  const draft = readComposerDraftModel(projectId);
  if (!draft) return;
  const result = await persistSessionModelOverride(sessionId, draft);
  if (result.ok) {
    clearComposerDraftModel(projectId);
  }
}
