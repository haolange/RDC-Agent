import { getElectronApi } from '../../platform/getElectronApi';
import { RevisionLanes } from '../../lib/revisionLanes';
import { useSessionRecordStore } from '../../stores/sessionRecordStore';
import {
  clearComposerDraftModel,
  readComposerDraftModel,
  writeComposerDraftAgent,
  writeComposerDraftModel,
} from '../../stores/composerModelDraftStore';
import type { SessionModelOverride, SessionModelWriteRequest } from '@shared/types/session';
import type { ConversationTurnControls } from '@shared/types/modelCapability';

type SessionModelField = 'modelOverride' | 'turnControls';

export interface SessionModelSaveResult {
  ok: boolean;
  error?: string;
  /** Whether this was still the newest intent of its field when main answered. */
  latest: boolean;
}

/**
 * A session's model override and its turn controls are two revision lanes. Each choice goes to main at once with the
 * lane's next revision; main writes a field only for a revision newer than the last one it wrote for that field, so
 * a late answer to an earlier choice never undoes a later one and nothing waits in a renderer queue. The flush lane
 * of a session holds every save in flight for it.
 */
const lanes = new RevisionLanes();
const laneOf = (sessionId: string, field: SessionModelField): string => `${sessionId}\u0000${field}`;

async function saveSessionModelField(
  sessionId: string | null | undefined,
  field: SessionModelField,
  write: Omit<SessionModelWriteRequest, 'clientRevision'>,
): Promise<SessionModelSaveResult> {
  if (!sessionId) return { ok: false, error: 'SESSION_MISSING', latest: true };
  const api = getElectronApi();
  if (!api) return { ok: false, error: 'BRIDGE_UNAVAILABLE', latest: true };
  const lane = laneOf(sessionId, field);
  const clientRevision = lanes.begin(lane);
  const records = useSessionRecordStore.getState();
  // The chosen model shows while its save is in flight; a failed save drops it again.
  const intentId = field === 'modelOverride' ? records.beginIntent(sessionId, write) : null;
  const saved = api.session.setModelOverride(sessionId, { ...write, clientRevision }).then((result) => {
    if (!result.success || !result.session) throw new Error(result.error || 'MODEL_UNAVAILABLE');
    records.accept(result.session);
  });
  void lanes.track(lane, clientRevision, saved);
  void lanes.track(sessionId, clientRevision, saved);
  try {
    await saved;
    return { ok: true, latest: lanes.isLatest(lane, clientRevision) };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'MODEL_SAVE_FAILED';
    return { ok: false, error: message, latest: lanes.isLatest(lane, clientRevision) };
  } finally {
    if (intentId !== null) records.settleIntent(sessionId, intentId);
  }
}

export function persistSessionModelOverride(
  sessionId: string | null | undefined,
  modelOverride: SessionModelOverride | null,
): Promise<SessionModelSaveResult> {
  return saveSessionModelField(sessionId, 'modelOverride', { modelOverride });
}

export function persistSessionTurnControls(
  sessionId: string,
  turnControls: ConversationTurnControls,
): Promise<SessionModelSaveResult> {
  return saveSessionModelField(sessionId, 'turnControls', { turnControls });
}

/** Whether a save of the session's turn controls is still in flight. */
export function isSessionTurnControlsSaving(sessionId: string): boolean {
  return lanes.busy(laneOf(sessionId, 'turnControls'));
}

/** Resolves once every model and control save of the session in flight has landed; fails if the newest one failed. */
export function flushSessionModelSaves(sessionId: string): Promise<void> {
  return lanes.settled(sessionId);
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
